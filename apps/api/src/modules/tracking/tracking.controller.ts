import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { createZodDto } from 'nestjs-zod';
import { P, VEHICLE_STATUSES, pageQuerySchema, type FleetSnapshotDto, type LiveLocationDto, type StatusConfigDto, type StatusSummaryDto, type VehicleLocationResult, type VehicleStatus } from '@gps/shared';
import { Authenticated, RequirePermissions } from '../../common/decorators';
import { notFound } from '../../common/errors';
import { PagedResult } from '../../common/response';
import type { AppClsStore } from '../../common/request-context';
import { ENV, type Env } from '../../infrastructure/config/env';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { toLocationDto } from '../live-state/live-state';
import { LiveStateStore } from '../live-state/live-state.store';
import { StatusConfigService } from '../live-state/status-config.service';

class PageDto extends createZodDto(pageQuerySchema) {}

/**
 * Latest known state from the live-state store (Redis first, PostgreSQL fallback). Status is derived at request time with
 * the one shared `deriveStatus`, so "offline" is right even between sweeper runs and every count uses the same rule.
 * Values the device did not report are `null` — never 0 or false.
 */
@ApiTags('Tracking')
@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly tenant: TenantPrismaService,
    private readonly store: LiveStateStore,
    private readonly status: StatusConfigService,
    private readonly cls: ClsService<AppClsStore>,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get orgId() {
    return this.cls.get('tenant')!.organizationId;
  }

  /** Live states of this organization joined with their (non-deleted) vehicles. */
  private async load(): Promise<LiveLocationDto[]> {
    const now = new Date();
    const states = await this.store.list(this.orgId);
    if (states.length === 0) return [];
    const vehicles = await this.tenant.run((tx) =>
      tx.vehicle.findMany({ where: { id: { in: states.map((s) => s.vehicleId) }, deletedAt: null }, select: { id: true, registrationNumber: true } }),
    );
    const reg = new Map(vehicles.map((v) => [v.id, v.registrationNumber]));
    return states
      .filter((s) => reg.has(s.vehicleId))
      .map((s) => toLocationDto(s, reg.get(s.vehicleId)!, this.status.derive(s, now)))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  }

  /**
   * Every vehicle's latest state of this organization in ONE consistent response, ordered by registration number (stable:
   * paging through a list sorted by "last seen" would skip and repeat vehicles while they move). The live map starts from this,
   * then merges pushed deltas. Cut at TRACKING_SNAPSHOT_LIMIT, and says so.
   */
  @Get('snapshot')
  @RequirePermissions(P.TRACKING_LIVE_VIEW)
  async snapshot(): Promise<FleetSnapshotDto> {
    const all = (await this.load()).sort((a, b) => a.registrationNumber.localeCompare(b.registrationNumber, 'en', { numeric: true }));
    const limit = this.env.TRACKING_SNAPSHOT_LIMIT;
    return { vehicles: all.slice(0, limit), total: all.length, truncated: all.length > limit };
  }

  @Get('positions')
  @RequirePermissions(P.TRACKING_LIVE_VIEW)
  async positions(@Query() q: PageDto): Promise<PagedResult<LiveLocationDto>> {
    const all = await this.load();
    return new PagedResult(all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize), { page: q.page, pageSize: q.pageSize, total: all.length });
  }

  /** Counts per status, computed with the same function as the map and the sockets. Vehicles with a device but no data count as NO_DATA. */
  @Get('summary')
  @RequirePermissions(P.TRACKING_LIVE_VIEW)
  async summary(): Promise<StatusSummaryDto> {
    const byStatus = Object.fromEntries(VEHICLE_STATUSES.map((s) => [s, 0])) as Record<VehicleStatus, number>;
    const live = await this.load();
    for (const l of live) byStatus[l.status]++;
    const withDevice = await this.tenant.run((tx) => tx.deviceAssignment.count({ where: { unassignedAt: null, vehicle: { deletedAt: null } } }));
    byStatus.NO_DATA += Math.max(0, withDevice - live.length);
    return { total: Object.values(byStatus).reduce((a, b) => a + b, 0), byStatus };
  }

  /** The thresholds in force (clients and the scenario runner use them; nothing is hard-coded in the UI). */
  @Get('status-config')
  @Authenticated()
  statusConfig(): StatusConfigDto {
    return { thresholds: this.status.thresholds };
  }

  @Get('vehicles/:id/location')
  @RequirePermissions(P.TRACKING_LIVE_VIEW)
  async location(@Param('id', ParseUUIDPipe) id: string): Promise<VehicleLocationResult> {
    const vehicle = await this.tenant.run((tx) =>
      tx.vehicle.findFirst({ where: { id, deletedAt: null }, include: { assignments: { where: { unassignedAt: null }, select: { id: true } } } }),
    );
    if (!vehicle) throw notFound('VEHICLE_NOT_FOUND'); // also the answer for another organization's vehicle
    const hasDevice = vehicle.assignments.length > 0;
    const state = hasDevice ? await this.store.get(this.orgId, id) : null;
    return {
      vehicleId: vehicle.id,
      registrationNumber: vehicle.registrationNumber,
      location: state ? toLocationDto(state, vehicle.registrationNumber, this.status.derive(state)) : null,
      reason: !hasDevice ? 'NO_DEVICE' : state ? null : 'NO_DATA_YET',
    };
  }
}
