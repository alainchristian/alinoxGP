import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { P } from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Real counts only. Sections the caller may not read (drivers, devices, alerts) come back as null. */
  @Get()
  @RequirePermissions(P.VEHICLES_READ)
  get() {
    return this.dashboard.get();
  }
}
