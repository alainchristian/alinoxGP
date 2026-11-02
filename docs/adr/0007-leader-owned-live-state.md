# ADR-0007: Leader-owned live state, lease-fenced batched writes, deadline-indexed sweeper

- **Status:** Accepted — 2026-11-02 (owner decision after the M3 profiling report). Load proof **pending M3b**.
- **Spec refs:** §10.2, §15; skill `gps-position-pipeline` §5–§7; builds on ADR-0004 and ADR-0006.

## Context

All positions are consumed by one **ingestion leader** (Redis lease; ADR-0006). The pipeline had to be serialised per process because a vehicle's new state depends on its previous one, and the offline sweeper changes the same state. The first M3 design kept the latest state **in Redis** and read-modify-wrote it per position, with the database written through behind it.

Profiling at 1,000–2,000 simulated devices (docs/DEVELOPMENT_ROADMAP.md, "M3 as built") showed that Node was idle 60–70 % of the time while the pipeline fell behind: every position paid sequential Redis round trips (5–25 ms each under load on the dev laptop) inside the serialised section. Separately, the sweeper read every vehicle of every organization (`HGETALL`, 7.8 MB for 13 k vehicles) every 30 s. Neither scales by tuning; both are consequences of where the state lives.

## Options

1. **Keep Redis as the working copy** (previous design). Simple; every instance sees the same data. The serialised section is bounded by Redis latency, and the sweeper scans everything.
2. **The leader keeps the state in memory; Redis is a replicated copy written in batches; PostgreSQL is saved periodically.** The pipeline never waits for I/O. Cost: a crash can lose the last batch, and a *stale* leader could overwrite a newer one unless writes are fenced.
3. **Partition the stream** (Redis Streams / Kafka, one consumer per vehicle partition). Scales past one process, but is a different architecture with more moving parts than the platform needs for its stated size (tens of thousands of vehicles). Deferred: revisit if one leader process becomes the limit.

## Decision

Option 2.

- **Memory is authoritative on the leader** (`LiveStateStore` leader mode). Reads and writes in the pipeline are memory operations.
- **Redis writes are batched and fenced**: every `LIVE_STATE_REDIS_FLUSH_MS` (250 ms) the pending changes go out in **one atomic Lua script that first checks that the lease key still holds this instance's token**. If it does not, Redis applies nothing and returns 0, and the instance steps down (drops memory and pending writes, refuses further writes). An old leader can therefore never overwrite the new one. The ring buffer (recent samples) and the deadline index are written by the same script.
- **A new leader warms up with one bulk read** (a pipelined `HGETALL` per organization) before it consumes anything; if Redis has nothing it rebuilds the organization from PostgreSQL with one read. If it cannot warm up it releases the lease.
- **PostgreSQL** gets one multi-row upsert (`jsonb_to_recordset`, up to 1,000 vehicles per statement) every `STATE_PERSIST_INTERVAL_SEC` (30 s) and at once on a status change or a first position. The statement carries `WHERE existing.last_seen_at <= new.last_seen_at`, so a late or stale writer can never move a row backwards, and the leader re-checks the lease before saving.
- **Graceful shutdown** flushes Redis and PostgreSQL while the lease is still held (`beforeApplicationShutdown`), then releases it; database and Redis connections close in `onApplicationShutdown`.
- **Offline sweeper = deadline index.** A Redis sorted set (`gps:live:deadlines`, member `orgId|vehicleId`) is scored by the next instant the vehicle's derived status could change by time alone (`nextStatusDeadline` in `packages/shared`: its offline deadline = last seen + its own threshold, or idle/parked for a stopped vehicle). The sweeper asks for everything whose score has passed with **one** `ZRANGEBYSCORE`, re-derives each under the pipeline lock, and re-schedules. The index holds identifiers only.
- Other API instances only read (Redis) and so serve the map snapshot while the leader ingests. Without a lease (ingestion disabled; unit/e2e tests) the store runs in **direct mode**: every write goes straight to Redis.

## Consequences

- **Throughput no longer depends on Redis or PostgreSQL latency**; the remaining per-position cost is CPU in the leader. Fan-out and engine buffering are separate (see the roadmap).
- **Crash window:** an ungraceful crash loses at most one Redis flush interval of state changes. The next leader's connect-time backfill (latest position of every engine device) repairs positions; derived timers (`stationarySince`) may restart. Accepted.
- **Fail-safe direction:** if Redis is unreachable the leader keeps ingesting from memory and retries the batch (newer values win); if it cannot renew the lease it stops consuming (ADR-0006).
- **Redis must be a single instance** (the script touches keys that are not declared in `KEYS`; not Redis Cluster compatible). This matches the deployment plan; record again if clustering is ever needed.
- **Threshold changes** take effect for a vehicle at its next position or review (deadlines are computed when written); a global change needs the leader to re-warm.
- **Tests:** leader-mode store tests (`test/live-state-leader.e2e-spec.ts`: batching, stale-leader rejection, warm-up from Redis, rebuild from PostgreSQL, monotonic saves, one-query sweep), property test of `nextStatusDeadline`, the failover e2e (a position sent while nobody leads is visible after the takeover), and the steady-traffic smoke test.
- **Not proven yet:** 200 positions/s on production-like hardware — M3b.
