import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ClsService } from 'nestjs-cls';
import { IS_AUTHENTICATED, IS_PUBLIC, NO_TENANT } from '../../common/decorators';
import { API_PREFIX } from '../../app.setup';
import { AppException, notFound, unauthorized } from '../../common/errors';
import { isUuid } from '../../common/mappers';
import type { AppClsStore } from '../../common/request-context';
import { AccessService } from './access.service';
import { ProviderAccessLogService } from './provider-access-log.service';

/**
 * Resolves the active organization for the request (ADR-0003, ADR-0010). The client may only *request* one:
 *  - `/organizations/:organizationId/...` routes use the path parameter;
 *  - other routes use the `X-Organization-Id` header, or the user's oldest active membership.
 * The request is accepted only if the authenticated user is an active member of it, or is staff of the PROVIDER of that
 * customer organization (and within their customer scope). Anything else is a 404 — a 403 would confirm it exists.
 * Provider staff acting for a customer are written to the audit log (visible to the customer's owner).
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    private readonly cls: ClsService<AppClsStore>,
    private readonly accessLog: ProviderAccessLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(NO_TENANT, targets)) return true;

    const auth = this.cls.get('auth');
    if (!auth) throw unauthorized('UNAUTHENTICATED');

    const req = context.switchToHttp().getRequest<Request>();
    const fromPath = req.params?.['organizationId'];
    const rawHeader = req.headers['x-organization-id'];
    const fromHeader = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (fromPath !== undefined && !isUuid(fromPath)) throw notFound('ORGANIZATION_NOT_FOUND');
    if (fromHeader !== undefined && !isUuid(fromHeader)) throw notFound('ORGANIZATION_NOT_FOUND');
    if (fromPath && fromHeader && fromPath !== fromHeader) {
      throw new AppException('ORGANIZATION_MISMATCH', 400, 'Organization in path and header differ');
    }

    const targetId = fromPath ?? fromHeader ?? (await this.access.defaultOrganizationId(auth.userId));
    if (!targetId) throw new AppException('ORGANIZATION_REQUIRED', 400, 'No active organization');

    const resolved = await this.access.resolve(auth.userId, targetId);
    if (!resolved) throw notFound('ORGANIZATION_NOT_FOUND');
    if (resolved.organization.status !== 'ACTIVE') {
      throw new AppException('ORGANIZATION_SUSPENDED', 403, 'This organization is suspended');
    }

    if (resolved.providerSuspended) {
      throw new AppException('SERVICE_TEMPORARILY_UNAVAILABLE', 403, 'This service is temporarily unavailable. Please contact your provider.');
    }

    this.cls.set('tenant', {
      organizationId: resolved.organization.id,
      organizationType: resolved.organization.type,
      providerId: resolved.organization.providerId,
      userId: auth.userId,
      memberId: resolved.memberId,
      actorOrganizationId: resolved.actorOrganizationId,
      actingAs: resolved.actingAs,
      customerScope: resolved.customerScope,
      permissions: resolved.permissions,
    });

    if (resolved.actingAs === 'PROVIDER_STAFF') {
      await this.accessLog.logCustomer(auth.userId, resolved.actorOrganizationId, resolved.organization.id, this.areaOf(req), req.method);
    }
    return true;
  }

  /** Area = the resource family: /api/v1/vehicles/... and /api/v1/organizations/:id/members/... both name it. */
  private areaOf(req: Request): string {
    const segments = req.path.replace(`/${API_PREFIX}`, '').split('/').filter(Boolean);
    return (segments[0] === 'organizations' ? segments[2] : segments[0]) ?? 'organization';
  }
}
