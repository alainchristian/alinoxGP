import { Module } from '@nestjs/common';
import { ConsentModule } from '../consent/consent.module';
import { DeviceCapabilitiesService } from './device-capabilities.service';
import { DeviceEngineSyncService } from './device-engine-sync.service';
import { DeviceRoutingService } from './device-routing.service';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [ConsentModule],
  controllers: [DevicesController],
  providers: [DevicesService, DeviceEngineSyncService, DeviceRoutingService, DeviceCapabilitiesService],
  exports: [DeviceRoutingService, DeviceEngineSyncService, DeviceCapabilitiesService],
})
export class DevicesModule {}
