import { SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@gps/shared';

export const IS_PUBLIC = 'gps:public';
export const IS_AUTHENTICATED = 'gps:authenticated';
export const NO_TENANT = 'gps:no-tenant';
export const REQUIRED_PERMISSIONS = 'gps:permissions';
export const REQUIRE_STEP_UP = 'gps:step-up';

/** No authentication. Must be explicit: the default is protected. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Any authenticated user; no organization context and no permission needed (e.g. /auth/me). */
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED, true);
/** Authenticated route that does not operate inside one organization (listing my organizations, ...). */
export const NoTenant = () => SetMetadata(NO_TENANT, true);
/** All listed permissions are required in the active organization. */
export const RequirePermissions = (...keys: PermissionKey[]) => SetMetadata(REQUIRED_PERMISSIONS, keys);
/** Requires a fresh password/TOTP confirmation (<= 5 min) on the current session. */
export const RequireStepUp = () => SetMetadata(REQUIRE_STEP_UP, true);
