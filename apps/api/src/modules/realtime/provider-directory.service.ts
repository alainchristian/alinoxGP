import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { SystemPrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * organization → provider, held in memory so the fan-out can address a provider room without touching the database
 * for every batch (ADR-0010). The table is tiny (one row per customer) and is refreshed on a timer; a customer created
 * a moment ago reaches its provider's room after the next refresh (its customer room works at once, and a provider's
 * client re-reads the fleet snapshot when it sees a vehicle it does not know).
 * Reviewed system-client use: it reads only ids, never tenant data.
 */
@Injectable()
export class ProviderDirectory implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ProviderDirectory.name);
  private providerByOrg = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly system: SystemPrismaService) {}

  async onModuleInit() {
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), 10_000);
    this.timer.unref?.();
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  providerOf(orgId: string): string | undefined {
    return this.providerByOrg.get(orgId);
  }

  async refresh(): Promise<void> {
    try {
      const rows = await this.system.organization.findMany({ where: { type: 'CUSTOMER', providerId: { not: null } }, select: { id: true, providerId: true } });
      this.providerByOrg = new Map(rows.map((r) => [r.id, r.providerId!]));
    } catch (err) {
      this.logger.warn(`Provider directory refresh failed; keeping the previous map (${String(err)})`);
    }
  }
}
