import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ClsService } from 'nestjs-cls';
import { P, ROLE_SCOPE_FOR_ORG_TYPE, type RoleDto } from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import type { AppClsStore } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@ApiTags('Roles')
@Controller()
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<AppClsStore>,
  ) {}

  /** Roles assignable inside the organization (scope matches the organization type). Permission: roles.read. */
  @Get('organizations/:organizationId/roles')
  @RequirePermissions(P.ROLES_READ)
  async list(@Param('organizationId') _organizationId: string): Promise<RoleDto[]> {
    const tenant = this.cls.get('tenant')!;
    const roles = await this.prisma.role.findMany({
      where: { scope: ROLE_SCOPE_FOR_ORG_TYPE[tenant.organizationType] },
      include: { permissions: { include: { permission: true } } },
      orderBy: { name: 'asc' },
    });
    return roles.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      scope: r.scope,
      permissions: r.permissions.map((p) => p.permission.key).sort(),
    }));
  }
}
