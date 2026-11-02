import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { SystemPrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AppClsStore } from '../../common/request-context';

export interface AuditEntry {
  action: string;
  organizationId?: string | null;
  actorUserId?: string | null;
  actorType?: 'USER' | 'SYSTEM';
  targetType?: string;
  targetId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
}

/**
 * Append-only audit trail (`audit_logs`: UPDATE/DELETE revoked + trigger). Written with the system role
 * because platform-level events (login, registration) have no tenant. Callers must never put secrets,
 * tokens or password material into before/after.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly system: SystemPrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  async record(entry: AuditEntry): Promise<void> {
    const auth = this.cls.get('auth');
    const tenant = this.cls.get('tenant');
    await this.system.auditLog.create({
      data: {
        action: entry.action,
        organizationId: entry.organizationId === undefined ? (tenant?.organizationId ?? null) : entry.organizationId,
        actorUserId: entry.actorUserId === undefined ? (auth?.userId ?? null) : entry.actorUserId,
        actorType: entry.actorType ?? 'USER',
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: entry.before,
        after: entry.after,
        ip: this.cls.get('ip'),
        userAgent: this.cls.get('userAgent')?.slice(0, 300),
        requestId: this.cls.get('requestId'),
      },
    });
  }
}
