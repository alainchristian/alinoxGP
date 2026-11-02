import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../infrastructure/config/env';
import { AlertEvaluatorService } from '../alerts/alert-evaluator.service';
import { toDelta } from '../live-state/live-state';
import { LiveStateStore } from '../live-state/live-state.store';
import { StatusConfigService } from '../live-state/status-config.service';
import { FanoutService } from '../realtime/fanout.service';
import { IngestStatsService } from './ingest-stats.service';
import { PositionPipelineService } from './position-pipeline.service';

/** Vehicles reviewed per range query. */
const PAGE = 500;

/**
 * Detects vehicles whose devices went silent (skill gps-position-pipeline §7). Traccar's own offline signal is only a
 * hint; our status is derived from OUR `lastSeenAt` with the shared `deriveStatus`. A device that keeps sending
 * "invalid fix" heartbeats is alive and never swept offline.
 *
 * Runs on the ingestion leader only, on a timer (the scan is stateless, so a durable BullMQ job adds nothing here).
 * Every state change goes through the pipeline's exclusive lock so a sweep can never overwrite a position that
 * arrived at the same moment.
 */
@Injectable()
export class OfflineSweeperService {
  private readonly logger = new Logger(OfflineSweeperService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: LiveStateStore,
    private readonly status: StatusConfigService,
    private readonly pipeline: PositionPipelineService,
    private readonly fanout: FanoutService,
    private readonly alerts: AlertEvaluatorService,
    private readonly stats: IngestStatsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.sweep().catch((e) => this.logger.error(`Sweep failed: ${String(e)}`)), this.env.SWEEP_INTERVAL_SEC * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Reviews every vehicle whose deadline has passed and returns how many changed status. `now` is injectable for tests.
   *
   * The deadline index (sorted set, score = the next instant a vehicle's status could change by itself) gives everything
   * that is due with ONE range query — not a scan of every vehicle. Each due vehicle is re-read under the pipeline lock (a
   * position may just have arrived), its status re-derived, and its next deadline set. A vehicle is reviewed at most once
   * per sweep, so a deadline that is still pending a write to Redis cannot make the loop spin.
   */
  async sweep(now: Date = new Date()): Promise<number> {
    let changed = 0;
    const reviewed = new Set<string>();
    for (;;) {
      const due = (await this.store.dueForReview(now.getTime(), PAGE)).filter((d) => !reviewed.has(`${d.orgId}|${d.vehicleId}`));
      if (due.length === 0) break;
      for (const { orgId, vehicleId } of due) {
        reviewed.add(`${orgId}|${vehicleId}`);
        await this.pipeline.runExclusive(async () => {
          const fresh = await this.store.get(orgId, vehicleId); // re-read: a position may just have arrived
          if (!fresh) {
            await this.store.remove(orgId, vehicleId); // the vehicle has no state any more (unassigned): drop it from the index
            return;
          }
          const derived = this.status.derive(fresh, now);
          if (derived === fresh.status) {
            await this.store.reschedule(fresh, now); // nothing changed yet: look again at its next deadline
            return;
          }
          const next = { ...fresh, status: derived, statusChangedAt: now };
          await this.store.put(next, true, now);
          this.fanout.queueDelta(orgId, toDelta(next, derived));
          changed++;
          if (derived === 'OFFLINE') {
            await this.stats.incr('offline_detected');
            await this.alerts.onOffline(next, now);
          }
        });
      }
      if (due.length < PAGE) break;
    }
    return changed;
  }
}
