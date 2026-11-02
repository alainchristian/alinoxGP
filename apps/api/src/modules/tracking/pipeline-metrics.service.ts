import { Injectable } from '@nestjs/common';

export interface Percentiles {
  samples: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

const SIZE = 10_000;

class Reservoir {
  private readonly values = new Float64Array(SIZE);
  private n = 0;
  private i = 0;

  add(v: number) {
    this.values[this.i] = v;
    this.i = (this.i + 1) % SIZE;
    if (this.n < SIZE) this.n++;
  }

  percentiles(): Percentiles {
    const sorted = Array.from(this.values.subarray(0, this.n)).sort((a, b) => a - b);
    const at = (q: number) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! * 10) / 10 : 0);
    return { samples: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.length ? Math.round(sorted[sorted.length - 1]! * 10) / 10 : 0 };
  }

  reset() {
    this.n = 0;
    this.i = 0;
  }
}

/**
 * In-memory latency recorder for the last 10 000 positions (ring buffer). Splits the time a position spends:
 *  - `arrivalLagMs`: engine receipt (Traccar `serverTime`) -> our consumer receives it (engine buffering + WebSocket);
 *  - `processingMs`: our pipeline (routing, state, Redis, fan-out queue, alert evaluation) — the part WE control.
 * Used to validate load targets honestly instead of guessing where the time goes. No personal data.
 */
@Injectable()
export class PipelineMetricsService {
  private readonly arrival = new Reservoir();
  private readonly processing = new Reservoir();

  record(arrivalLagMs: number, processingMs: number) {
    this.arrival.add(Math.max(0, arrivalLagMs));
    this.processing.add(processingMs);
  }

  snapshot() {
    return { arrivalLagMs: this.arrival.percentiles(), processingMs: this.processing.percentiles() };
  }

  reset() {
    this.arrival.reset();
    this.processing.reset();
  }
}
