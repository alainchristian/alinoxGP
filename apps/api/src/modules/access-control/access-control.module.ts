import { Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { PermissionsGuard } from './permissions.guard';
import { ProviderAccessLogService } from './provider-access-log.service';
import { RolesController } from './roles.controller';
import { TenantContextGuard } from './tenant-context.guard';

@Module({
  controllers: [RolesController],
  providers: [AccessService, TenantContextGuard, PermissionsGuard, ProviderAccessLogService],
  exports: [AccessService, TenantContextGuard, PermissionsGuard, ProviderAccessLogService],
})
export class AccessControlModule {}
