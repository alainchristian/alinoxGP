import { Injectable, Logger } from '@nestjs/common';
import { overspeedParamsSchema } from '@gps/shared';
import type { LiveState } from '../live-state/live-state';
import { IngestStatsService } from '../tracking/ingest-stats.service';
import { AlertRuleCache } from './alert-rule.cache';
import { AlertService } from './alert.service';
import { OverspeedTracker } from './overspeed-tracker';

/**
 * Evaluates our own alert rules (skill gps-position-pipeline §8). Rules are the source of truth: no enabled rule of a
 * type, no alert of that type. Fixes flagged DELAYED (buffered after a reconnect, late arrival) are never evaluated:
 * they describe the past, and raising an overspeed/ignition alert for them as if it were happening now would be false.
 */
@Injectable()
export class AlertEvaluatorService {
  private readonly logger = new Logger(AlertEvaluatorService.name);
  private readonly overspeed = new OverspeedTracker();

  constructor(
    private readonly rules: AlertRuleCache,
    private readonly alerts: AlertService,
    private readonly stats: IngestStatsService,
  ) {}

  /** Called for every ACCEPTED fix (one that advanced the latest state). */
  async onAcceptedFix(prev: LiveState | null, next: LiveState, fixTime: Date, delayed: boolean): Promise<void> {
    try {
      const rules = await this.rules.get(next.organizationId);
      if (rules.length === 0) return;
      if (delayed) {
        await this.stats.incr('alerts_suppressed_delayed');
        // A delayed fix also breaks any live overspeed streak: we cannot vouch for what happened in between.
        for (const r of rules) if (r.type === 'OVERSPEED') this.overspeed.reset(`${r.id}:${next.vehicleId}`);
        return;
      }
      const base = { organizationId: next.organizationId, vehicleId: next.vehicleId, startedAt: fixTime, latitude: next.latitude, longitude: next.longitude, simulated: next.simulated, delayed: false };

      // Ignition: only a real transition between two REPORTED values (null -> true on the first message is not a change).
      if (prev && prev.ignition !== null && next.ignition !== null && prev.ignition !== next.ignition) {
        const type = next.ignition ? 'IGNITION_ON' : 'IGNITION_OFF';
        for (const rule of rules.filter((r) => r.type === type)) await this.alerts.raise({ ...base, rule });
      }

      for (const rule of rules.filter((r) => r.type === 'OVERSPEED')) {
        const params = overspeedParamsSchema.safeParse(rule.params);
        if (!params.success) continue;
        const exceeded = this.overspeed.update(`${rule.id}:${next.vehicleId}`, next.speedKmh, params.data.speedLimitKmh, params.data.minDurationSec, fixTime.getTime());
        if (exceeded) await this.alerts.raise({ ...base, rule });
      }
    } catch (err) {
      // Alert evaluation must never break position processing.
      this.logger.error(`Alert evaluation failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Called by the sweeper when a vehicle crosses the offline threshold. */
  async onOffline(state: LiveState, now: Date): Promise<void> {
    try {
      for (const rule of (await this.rules.get(state.organizationId)).filter((r) => r.type === 'DEVICE_OFFLINE')) {
        await this.alerts.raise({
          organizationId: state.organizationId, vehicleId: state.vehicleId, rule, startedAt: now,
          latitude: state.latitude, longitude: state.longitude, simulated: state.simulated, delayed: false,
        });
      }
    } catch (err) {
      this.logger.error(`Offline alert failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
