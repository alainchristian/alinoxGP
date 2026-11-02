import { Module } from '@nestjs/common';
import { OrgClockService } from '../../common/org-clock.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({ controllers: [DashboardController], providers: [DashboardService, OrgClockService] })
export class DashboardModule {}
