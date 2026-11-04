import type { ClsStore } from 'nestjs-cls';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

/**
 * The verified tenant of a request (ADR-0010). Resolved by TenantContextGuard from the database — never from the body.
 *
 *  - `organizationId`  the organization whose rows `TenantPrismaService.run` exposes (RLS `app.current_org_id`):
 *                      the user's own organization, or the customer a provider staff member is acting for.
 *  - `providerId`      the provider at the top of that branch (null for the platform).
 *  - `actingAs`        MEMBER: the user belongs to `organizationId`. PROVIDER_STAFF: the user is staff of the provider
 *                      of `organizationId` (a customer) and is not a member of it; permissions are derived.
 *  - `customerScope`   provider staff only: 'ALL' or the customers the member is limited to.
 */
export interface TenantContext {
  organizationId: string;
  organizationType: 'PLATFORM' | 'PROVIDER' | 'CUSTOMER';
  providerId: string | null;
  userId: string;
  /** Membership that grants access (in `actorOrganizationId`). */
  memberId: string;
  /** Equals organizationId for a member; the provider organization when its staff act for a customer. */
  actorOrganizationId: string;
  actingAs: 'MEMBER' | 'PROVIDER_STAFF';
  customerScope: 'ALL' | readonly string[];
  permissions: ReadonlySet<string>;
}

export interface AppClsStore extends ClsStore {
  requestId?: string;
  ip?: string;
  userAgent?: string;
  auth?: AuthContext;
  tenant?: TenantContext;
}
