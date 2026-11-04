import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { UsersModule } from '../users/users.module';
import { CustomersService } from './customers.service';
import {
  AccessLogController,
  AdminProvidersController,
  BrandingController,
  ProviderConsoleController,
  ProvidersPublicController,
} from './providers.controller';
import { ProviderFleetService } from './provider-fleet.service';
import { ProvidersService } from './providers.service';

@Module({
  imports: [AccessControlModule, UsersModule],
  controllers: [ProvidersPublicController, AdminProvidersController, ProviderConsoleController, BrandingController, AccessLogController],
  providers: [ProvidersService, CustomersService, ProviderFleetService],
  exports: [ProvidersService],
})
export class ProvidersModule {}
