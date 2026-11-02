import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClsService } from 'nestjs-cls';
import type { PermissionKey } from '@gps/shared';
import { IS_AUTHENTICATED, IS_PUBLIC, NO_TENANT, REQUIRED_PERMISSIONS } from '../../common/decorators';
import { forbidden } from '../../common/errors';
import type { AppClsStore } from '../../common/request-context';

/**
 * Fails closed: a protected route must declare @RequirePermissions(...), @Authenticated() or @NoTenant().
 * A route-scan test also enforces this at build time.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const required = this.reflector.getAllAndOverride<PermissionKey[] | undefined>(REQUIRED_PERMISSIONS, targets);
    if (!required || required.length === 0) {
      const explicitlyOpen =
        this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets) ||
        this.reflector.getAllAndOverride<boolean>(NO_TENANT, targets);
      if (explicitlyOpen) return true;
      throw forbidden('PERMISSION_NOT_DECLARED', 'Route has no declared permission');
    }

    const tenant = this.cls.get('tenant');
    if (!tenant) throw forbidden('PERMISSION_DENIED', 'Forbidden');
    const missing = required.filter((k) => !tenant.permissions.has(k));
    if (missing.length > 0) throw forbidden('PERMISSION_DENIED', 'You do not have permission to do this');
    return true;
  }
}
