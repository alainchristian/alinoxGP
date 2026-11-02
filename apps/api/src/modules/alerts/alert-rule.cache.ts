import { Injectable } from '@nestjs/common';
import type { AlertRule } from '@prisma/client';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';

const TTL_MS = 5_000;

/** Enabled alert rules per organization, cached briefly (the pipeline asks for them on every position). */
@Injectable()
export class AlertRuleCache {
  private readonly cache = new Map<string, { rules: AlertRule[]; expires: number }>();

  constructor(private readonly tenant: TenantPrismaService) {}

  async get(orgId: string, now = Date.now()): Promise<AlertRule[]> {
    const hit = this.cache.get(orgId);
    if (hit && hit.expires > now) return hit.rules;
    const rules = await this.tenant.runInOrganization(orgId, (tx) => tx.alertRule.findMany({ where: { enabled: true } }));
    this.cache.set(orgId, { rules, expires: now + TTL_MS });
    return rules;
  }

  invalidate(orgId: string) {
    this.cache.delete(orgId);
  }
}
