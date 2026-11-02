import { Module } from '@nestjs/common';
import { OrgClockService } from '../../common/org-clock.service';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

@Module({ controllers: [DriversController], providers: [DriversService, OrgClockService] })
export class DriversModule {}
