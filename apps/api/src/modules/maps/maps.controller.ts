import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { P, type MapConfigDto } from '@gps/shared';
import { RequirePermissions } from '../../common/decorators';
import { MAP_PROVIDER, type MapProviderPort } from './map-provider.port';

@ApiTags('Maps')
@Controller('maps')
export class MapsController {
  constructor(@Inject(MAP_PROVIDER) private readonly provider: MapProviderPort) {}

  /** How the browser should draw the map (provider, tiles or styles, public token). Same for every tenant: no tenant data. */
  @Get('config')
  @RequirePermissions(P.TRACKING_LIVE_VIEW)
  config(): MapConfigDto {
    return this.provider.config();
  }
}
