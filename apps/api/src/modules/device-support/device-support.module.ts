import { Module } from '@nestjs/common';
import { DeviceSupportAdminController, DeviceSupportController } from './device-support.controller';
import { DeviceSupportService } from './device-support.service';

@Module({ controllers: [DeviceSupportController, DeviceSupportAdminController], providers: [DeviceSupportService] })
export class DeviceSupportModule {}
