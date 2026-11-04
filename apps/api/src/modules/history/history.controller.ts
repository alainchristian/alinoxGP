import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { P, historyQuerySchema } from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import { HistoryService } from './history.service';

class HistoryQueryDto extends createZodDto(historyQuerySchema) {}

/**
 * Trip history and route playback of ONE vehicle. Another organization's vehicle is a 404; the range is clipped to the
 * history period and to the periods a tracker was installed; provider staff reading a customer's history are written to the
 * customer's access log by the tenant guard (area "vehicles").
 */
@ApiTags('History')
@Controller('vehicles/:vehicleId')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  /** Trips and stops in the range (≤ HISTORY_MAX_SPAN_TRIPS_DAYS). Permission: trips.read. */
  @Get('trips')
  @RequirePermissions(P.TRIPS_READ)
  trips(@Param('vehicleId', ParseUUIDPipe) vehicleId: string, @Query() q: HistoryQueryDto) {
    return this.history.trips(vehicleId, new Date(q.from), new Date(q.to));
  }

  /** Route points for playback (≤ HISTORY_MAX_SPAN_ROUTE_DAYS; thinned above HISTORY_MAX_ROUTE_POINTS). Permission: tracking.history.view. */
  @Get('route')
  @RequirePermissions(P.TRACKING_HISTORY_VIEW)
  route(@Param('vehicleId', ParseUUIDPipe) vehicleId: string, @Query() q: HistoryQueryDto) {
    return this.history.route(vehicleId, new Date(q.from), new Date(q.to));
  }
}
