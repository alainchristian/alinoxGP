import { Inject, Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { ENV, type Env } from '../config/env';
import type { AppClsStore } from '../../common/request-context';

/**
 * Application database client. Connects as `gps_app`: NOT the table owner, NO BYPASSRLS.
 * Use it directly only for GLOBAL tables (users, sessions, tokens, roles, reference data).
 * Tenant-owned tables must be accessed through {@link TenantPrismaService}; a direct query on a
 * tenant table without a tenant context matches zero rows because of RLS (fail-safe).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(ENV) env: Env) {
    super({ datasourceUrl: env.DATABASE_URL, log: [{ emit: 'event', level: 'error' }] });
  }
  async onModuleInit() {
    await this.$connect();
  }
  // Disconnect in the LAST shutdown phase: other services (the live-state final save, the ingestion lease release) still need the database in beforeApplicationShutdown.
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}

/**
 * Named cross-tenant client. Connects as `gps_system` (BYPASSRLS). Every use is a reviewed exception.
 * Allowed uses (keep this list current — add a test/comment when extending it):
 *  1. Identity & membership resolution before a tenant context exists (TenantContextGuard, /auth/me,
 *     organization listing, organization creation, invitation acceptance).
 *  2. Audit log writes (platform-level events have no organization).
 *  3. Reference/system seeding and the operator CLI.
 *  4. Platform-staff device tools (diagnostics, lifecycle change, model identification) and the device-support queue: cross-tenant by nature,
 *     guarded by `platform.*` permissions, read-only apart from audited actions (M5b).
 * It must never be used to serve tenant data to a request on behalf of a client-chosen organization.
 */
@Injectable()
export class SystemPrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(ENV) env: Env) {
    super({ datasourceUrl: env.DATABASE_URL_SYSTEM, log: [{ emit: 'event', level: 'error' }] });
  }
  async onModuleInit() {
    await this.$connect();
  }
  // Disconnect in the LAST shutdown phase: other services (the live-state final save, the ingestion lease release) still need the database in beforeApplicationShutdown.
  async onApplicationShutdown() {
    await this.$disconnect();
  }
}

/**
 * Tenant-scoped access. Every call runs in an interactive transaction whose FIRST statement sets
 * `app.current_org_id` (transaction-local `set_config(..., true)`, safe with connection pooling), so
 * PostgreSQL RLS filters every row. Throws when there is no tenant context.
 */
@Injectable()
export class TenantPrismaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** Run with the tenant resolved by TenantContextGuard for this request. */
  run<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const tenant = this.cls.get('tenant');
    if (!tenant) throw new Error('TenantPrismaService.run called without tenant context');
    return this.runInOrganization(tenant.organizationId, fn);
  }

  /**
   * Provider-level access (ADR-0010): every row of the provider and of ALL its customers (`app.current_provider_id`).
   * Only a provider's own staff acting at provider level may call it; staff scoped to some customers must additionally
   * filter by {@link customerScope} (RLS cannot express a staff member's customer list). Customer-level routes keep using
   * {@link run}, which exposes exactly one organization.
   */
  runAsProvider<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const tenant = this.cls.get('tenant');
    if (!tenant) throw new Error('TenantPrismaService.runAsProvider called without tenant context');
    if (tenant.organizationType !== 'PROVIDER' || tenant.actingAs !== 'MEMBER') {
      throw new Error('TenantPrismaService.runAsProvider requires provider staff acting at provider level');
    }
    return this.runInProvider(tenant.organizationId, fn);
  }

  /** The customers the current provider staff member may see: undefined = all, otherwise the allowed ids. */
  customerScope(): readonly string[] | undefined {
    const tenant = this.cls.get('tenant');
    if (!tenant) throw new Error('TenantPrismaService.customerScope called without tenant context');
    return tenant.customerScope === 'ALL' ? undefined : tenant.customerScope;
  }

  /** Explicit provider-level tenant (background jobs, tests). The caller must have authorised `providerId`. */
  runInProvider<T>(providerId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_provider_id', ${providerId}, true)`;
        return fn(tx);
      },
      { maxWait: 5000, timeout: 10000 },
    );
  }

  /**
   * Establish a tenant explicitly (background jobs, tests). The caller is responsible for having
   * authorised `organizationId` (e.g. from a verified membership or a job payload that is re-validated).
   */
  runInOrganization<T>(organizationId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
        return fn(tx);
      },
      // Prisma defaults (2 s wait / 5 s run) are too tight under load spikes; keep transactions short anyway.
      { maxWait: 5000, timeout: 10000 },
    );
  }
}
