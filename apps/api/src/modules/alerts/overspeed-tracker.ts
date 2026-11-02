/**
 * Decides when a vehicle has been over the speed limit for long enough (by FIX time, so buffered data cannot
 * pretend to be "now"). Pure and in-memory: it lives on the single ingestion leader; after a leader change the
 * duration simply restarts, which can only delay an alert, never invent one.
 */
export class OverspeedTracker {
  private readonly since = new Map<string, number>();

  /** Returns true while the vehicle has been continuously above `limitKmh` for at least `minDurationSec`. */
  update(key: string, speedKmh: number | null, limitKmh: number, minDurationSec: number, fixMs: number): boolean {
    if (speedKmh === null || speedKmh <= limitKmh) {
      this.since.delete(key); // unknown speed or back under the limit: the streak is broken
      return false;
    }
    const start = this.since.get(key) ?? fixMs;
    this.since.set(key, start);
    return (fixMs - start) / 1000 >= minDurationSec;
  }

  reset(key: string) {
    this.since.delete(key);
  }

  get size() {
    return this.since.size;
  }
}
