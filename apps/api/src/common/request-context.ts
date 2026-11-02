import type { ClsStore } from 'nestjs-cls';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

export interface TenantContext {
  /** The organization whose data this request operates on (RLS tenant). */
  organizationId: string;
  organizationType: 'PLATFORM' | 'RESELLER' | 'CUSTOMER';
  userId: string;
  /** Membership that grants access (in `actorOrganizationId`). */
  memberId: string;
  /** Equals organizationId for a member; the reseller organization when acting for a child customer. */
  actorOrganizationId: string;
  actingAs: 'MEMBER' | 'RESELLER_PARENT';
  permissions: ReadonlySet<string>;
}

export interface AppClsStore extends ClsStore {
  requestId?: string;
  ip?: string;
  userAgent?: string;
  auth?: AuthContext;
  tenant?: TenantContext;
}
