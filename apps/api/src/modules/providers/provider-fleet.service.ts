import { Inject, Injectable } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { ProviderFleetSnapshotDto, ProviderLiveLocationDto } from '@gps/shared';
import { notFound } from '../../common/errors';
import type { AppClsStore } from '../../common/request-context';
import { ENV, type Env } from '../../infrastructure/config/env';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { ProviderAccessLogService } from '../access-control/provider-access-log.service';
import { toLocationDto } from '../live-state/live-state';
import { LiveStateStore } from '../live-state/live-state.store';
import { StatusConfigService } from '../live-state/status-config.service';

/**
 * The provider-wide live map: the latest state of every vehicle of every customer the staff member may see, in one
 * response (ADR-0010). Customers and vehicles are read through RLS at provider level; live states come from the same
 * store as the customer map, one organization at a time, so each customer's data keeps its own keys.
 */
@Injectable()
export class ProviderFleetService {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly store: LiveStateStore,
    private readonly status: StatusConfigService,
    private readonly accessLog: ProviderAccessLogService,
    private readonly cls: ClsService<AppClsStore>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async snapshot(): Promise<ProviderFleetSnapshotDto> {
    const ctx = this.cls.get('tenant')!;
    if (ctx.organizationType !== 'PROVIDER' || ctx.actingAs !== 'MEMBER') throw notFound('ORGANIZATION_NOT_FOUND');
    const scope = this.tenant.customerScope();
    const customers = await this.tenant.runAsProvider((tx) =>
      tx.organization.findMany({ where: { type: 'CUSTOMER', status: 'ACTIVE', ...(scope ? { id: { in: [...scope] } } : {}) }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    );
    const vehicles = await this.tenant.runAsProvider((tx) =>
      tx.vehicle.findMany({ where: { deletedAt: null, organizationId: { in: customers.map((c) => c.id) } }, select: { id: true, registrationNumber: true, organizationId: true } }),
    );
    const regById = new Map(vehicles.map((v) => [v.id, v]));
    const nameById = new Map(customers.map((c) => [c.id, c.name]));
    const now = new Date();
    const perCustomer = await Promise.all(customers.map((c) => this.store.list(c.id)));
    const all: ProviderLiveLocationDto[] = [];
    perCustomer.forEach((states, i) => {
      const customer = customers[i]!;
      for (const s of states) {
        const v = regById.get(s.vehicleId);
        if (!v || v.organizationId !== customer.id) continue;
        all.push({ ...toLocationDto(s, v.registrationNumber, this.status.derive(s, now)), customerId: customer.id, customerName: nameById.get(customer.id)! });
      }
    });
    all.sort((a, b) => a.registrationNumber.localeCompare(b.registrationNumber, 'en', { numeric: true }));
    await this.accessLog.logCustomers(ctx.userId, ctx.organizationId, customers.map((c) => c.id), 'live', 'GET');
    const limit = this.env.TRACKING_SNAPSHOT_LIMIT;
    return { vehicles: all.slice(0, limit), total: all.length, truncated: all.length > limit, customers };
  }
}
