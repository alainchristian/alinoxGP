import { Module } from '@nestjs/common';
import { DevicesModule } from '../devices/devices.module';
import { DeviceAdminController } from './device-admin.controller';
import { DeviceAdminService } from './device-admin.service';

@Module({ imports: [DevicesModule], controllers: [DeviceAdminController], providers: [DeviceAdminService] })
export class DeviceAdminModule {}
