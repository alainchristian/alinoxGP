import { Inject, Injectable } from '@nestjs/common';
import type { StatusThresholds, VehicleStatus } from '@gps/shared';
import { ENV, type Env } from '../../infrastructure/config/env';
import { statusOf, type LiveState } from './live-state';

/** Platform-default thresholds from configuration (per-organization overrides arrive later). */
@Injectable()
export class StatusConfigService {
  readonly thresholds: StatusThresholds;

  constructor(@Inject(ENV) env: Env) {
    this.thresholds = {
      offlineAfterSec: env.STATUS_OFFLINE_AFTER_SEC,
      movingSpeedKmh: env.STATUS_MOVING_SPEED_KMH,
      idleAfterSec: env.STATUS_IDLE_AFTER_SEC,
      parkedAfterSec: env.STATUS_PARKED_AFTER_SEC,
    };
  }

  derive(state: LiveState, now: Date = new Date()): VehicleStatus {
    return statusOf(state, now, this.thresholds);
  }
}
