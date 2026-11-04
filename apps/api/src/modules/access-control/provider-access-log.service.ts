import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { AuditService } from '../audit/audit.service';

/** One entry per (staff member, customer, area) per window: a page that polls must not flood the customer's log. */
const WINDOW_SECONDS = 300;

/**
 * Writes "someone at the provider looked at your data" entries (spec §6: every provider-staff access to live view,
 * history, exports or commands is audit-logged and visible to the customer's owner). Best-effort per window; a failure
 * is reported loudly but never blocks the request.
 */
@Injectable()
export class ProviderAccessLogService {
  private readonly logger = new Logger(ProviderAccessLogService.name);

  constructor(
    private readonly audit: AuditService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Staff acting for ONE customer. */
  async logCustomer(userId: string, providerId: string, customerId: string, area: string, method: string): Promise<void> {
    await this.write(userId, providerId, [customerId], area, method, `access-log:${providerId}:${userId}:${customerId}:${area}`);
  }

  /** Staff looking at several customers at once (the provider-wide map): one entry per customer, once per window. */
  async logCustomers(userId: string, providerId: string, customerIds: readonly string[], area: string, method: string): Promise<void> {
    if (customerIds.length === 0) return;
    await this.write(userId, providerId, customerIds, area, method, `access-log:${providerId}:${userId}:*:${area}`);
  }

  private async write(userId: string, providerId: string, customerIds: readonly string[], area: string, method: string, key: string): Promise<void> {
    try {
      const first = await this.redis.set(key, '1', 'EX', WINDOW_SECONDS, 'NX');
      if (first !== 'OK') return;
      for (const customerId of customerIds) {
        await this.audit.record({
          action: 'access.customer_data',
          organizationId: customerId,
          actorUserId: userId,
          targetType: 'area',
          targetId: area.slice(0, 40),
          after: { providerOrganizationId: providerId, method },
        });
      }
    } catch (err) {
      this.logger.error(`Provider access log failed for provider ${providerId}: ${String(err)}`);
    }
  }
}
