import { Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { PermissionsGuard } from './permissions.guard';
import { RolesController } from './roles.controller';
import { TenantContextGuard } from './tenant-context.guard';

@Module({
  controllers: [RolesController],
  providers: [AccessService, TenantContextGuard, PermissionsGuard],
  exports: [AccessService, TenantContextGuard, PermissionsGuard],
})
export class AccessControlModule {}
