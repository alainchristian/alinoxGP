import { BeforeApplicationShutdown, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { nextStatusDeadline } from '@gps/shared';
import type { Prisma, VehicleLiveState } from '@prisma/client';
import Redis from 'ioredis';
import { ENV, type Env } from '../../infrastructure/config/env';
import { TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { parseState, serializeState, type LiveState, type RecentSample } from './live-state';
import { StatusConfigService } from './status-config.service';

/** The ingestion leader's lease. The leader's token is its value; every leader-side write is checked against it. */
export const INGESTION_LEASE_KEY = 'gps:ingestion:leader';
const ORGS_KEY = 'gps:live:orgs';
/**
 * Sorted set: member `orgId|vehicleId`, score = the next instant at which the vehicle's derived status could change by
 * itself (its own offline deadline, or idle/parked for a stopped vehicle). The offline sweeper asks for everything whose
 * score has passed with ONE range query instead of scanning every vehicle. It holds ids only, never tenant data.
 */
const DEADLINES_KEY = 'gps:live:deadlines';
const RING_SIZE = 20;
const RING_TTL_SECONDS = 3600;
/** Rows per upsert statement to PostgreSQL: up to this many vehicles go in ONE statement. */
const FLUSH_CHUNK = 1000;

// Tenant-prefixed keys (gps-tenant-isolation §6): a data key can never be built without knowing the organization.
const liveKey = (orgId: string) => `org:${orgId}:live`;
const recentKey = (orgId: string, vehicleId: string) => `org:${orgId}:vehicle:${vehicleId}:recent`;
const memberOf = (orgId: string, vehicleId: string) => `${orgId}|${vehicleId}`;

/**
 * Applies a batch to Redis ATOMICALLY and only while the caller still holds the ingestion lease.
 * ARGV[1] = lease token ('' = unguarded, used only by single-process/test mode), ARGV[2] = JSON batch.
 * Returns 1 when applied, 0 when the lease is held by someone else (the caller is a stale leader: nothing is written).
 * The batch carries FULL key names (the client's key prefix is added by the caller): only the lease key is declared in
 * KEYS, which is fine on the single Redis instance this platform uses (not on Redis Cluster).
 */
const APPLY_BATCH = `
local token = ARGV[1]
if token ~= '' and redis.call('GET', KEYS[1]) ~= token then return 0 end
local p = cjson.decode(ARGV[2])
for _, h in ipairs(p.hashes) do
  for i = 1, #h.args, 2 do redis.call('HSET', h.key, h.args[i], h.args[i + 1]) end
end
for _, org in ipairs(p.orgs) do redis.call('SADD', p.orgsKey, org) end
for _, z in ipairs(p.zadd) do redis.call('ZADD', p.deadlinesKey, z[1], z[2]) end
for _, m in ipairs(p.zrem) do redis.call('ZREM', p.deadlinesKey, m) end
for _, l in ipairs(p.lists) do
  for _, s in ipairs(l.push) do redis.call('LPUSH', l.key, s) end
  redis.call('LTRIM', l.key, 0, p.ringMax - 1)
  redis.call('EXPIRE', l.key, p.ringTtl)
end
for _, d in ipairs(p.hdel) do redis.call('HDEL', d.key, d.field) end
for _, k in ipairs(p.dels) do redis.call('DEL', k) end
return 1
`;

const fromRow = (r: VehicleLiveState): LiveState => ({
  vehicleId: r.vehicleId,
  organizationId: r.organizationId,
  deviceId: r.deviceId,
  latitude: r.latitude,
  longitude: r.longitude,
  speedKmh: r.speedKmh,
  heading: r.heading,
  ignition: r.ignition,
  motion: r.motion,
  lastFixAt: r.lastFixAt,
  lastSeenAt: r.lastSeenAt,
  lastFixInvalid: r.lastFixInvalid,
  lastFixDelayed: r.lastFixDelayed,
  stationarySince: r.stationarySince,
  status: r.status,
  statusChangedAt: r.statusChangedAt,
  simulated: r.simulated,
});

/** Everything the leader has changed since its last write to Redis (newest value per key wins). */
interface Batch {
  states: Map<string, LiveState>;
  /** member -> score in ms, or null to remove the vehicle from the deadline index. */
  deadlines: Map<string, number | null>;
  /** Oldest -> newest samples to push onto each vehicle's ring buffer. */
  recent: Map<string, { orgId: string; vehicleId: string; samples: RecentSample[] }>;
  removed: Map<string, { orgId: string; vehicleId: string }>;
}
const emptyBatch = (): Batch => ({ states: new Map(), deadlines: new Map(), recent: new Map(), removed: new Map() });
const isEmpty = (b: Batch) => b.states.size === 0 && b.deadlines.size === 0 && b.recent.size === 0 && b.removed.size === 0;

/**
 * Latest state per vehicle (skill gps-position-pipeline §5; ADR-0004).
 *
 * LEADER MODE (ingestion enabled): the ingestion leader owns the state. Every vehicle's latest state lives in the leader's
 * MEMORY, so the serialised position pipeline never waits for Redis or PostgreSQL. Changes are written to Redis in
 * batches (every REDIS_FLUSH_MS) by one atomic script that is rejected unless this instance still holds the lease — an
 * old leader can never overwrite the new one. PostgreSQL gets a coalesced multi-row upsert every
 * STATE_PERSIST_INTERVAL_SEC (and at once on a status change). A new leader warms its memory with ONE bulk read from
 * Redis (or from PostgreSQL if Redis was lost). A crash loses at most one Redis flush interval; the engine backfill
 * repairs that on the next connect.
 *
 * DIRECT MODE (no lease: ingestion disabled, unit/e2e tests): every write goes straight to Redis, no batching.
 *
 * Other API instances only ever READ (Redis), so they can serve the map snapshot while the leader ingests.
 * Redis is only read for an organization whose id came from a verified context or from tenant routing.
 */
@Injectable()
export class LiveStateStore implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(LiveStateStore.name);

  // ---- leader mode
  private leaderToken: string | null = null;
  private fenced = false;
  private readonly mem = new Map<string, Map<string, LiveState>>();
  private readonly loading = new Map<string, Promise<void>>();
  private pending: Batch = emptyBatch();
  private applying: Promise<unknown> = Promise.resolve();
  private redisTimer: NodeJS.Timeout | null = null;

  // ---- PostgreSQL write-through
  private dbTimer: NodeJS.Timeout | null = null;
  private readonly dirty = new Map<string, LiveState>();
  private flushing: Promise<void> = Promise.resolve();

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly tenant: TenantPrismaService,
    private readonly status: StatusConfigService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit() {
    if (!this.env.INGESTION_ENABLED) return;
    this.dbTimer = setInterval(() => void this.flush().catch((err) => this.logger.error(`Live-state save failed: ${String(err)}`)), this.env.STATE_PERSIST_INTERVAL_SEC * 1000);
    this.dbTimer.unref?.();
  }

  async beforeApplicationShutdown() {
    if (this.dbTimer) clearInterval(this.dbTimer);
    this.dbTimer = null;
    if (this.leaderToken) await this.stepDown(true);
    else await this.flush().catch((err) => this.logger.error(`Final live-state save failed: ${String(err)}`));
  }

  // ============================================================ leadership

  get isLeader(): boolean {
    return this.leaderToken !== null;
  }

  /**
   * This instance won the lease with `token`: take ownership of the state. Warms memory with one bulk read (a pipelined
   * HGETALL per organization) and registers every warmed vehicle in the deadline index.
   */
  async becomeLeader(token: string): Promise<void> {
    this.mem.clear();
    this.loading.clear();
    this.pending = emptyBatch();
    const orgs = await this.redis.smembers(ORGS_KEY);
    if (orgs.length > 0) {
      const pipe = this.redis.pipeline();
      for (const org of orgs) pipe.hgetall(liveKey(org));
      const results = (await pipe.exec()) ?? [];
      orgs.forEach((org, i) => {
        const [err, all] = results[i] ?? [null, null];
        if (err || !all) return;
        const states = new Map<string, LiveState>();
        for (const raw of Object.values(all as Record<string, string>)) {
          const s = parseState(raw);
          states.set(s.vehicleId, s);
        }
        this.mem.set(org, states);
      });
    }
    this.leaderToken = token;
    this.fenced = false;
    const now = new Date();
    for (const states of this.mem.values()) for (const s of states.values()) this.pending.deadlines.set(memberOf(s.organizationId, s.vehicleId), this.deadlineOf(s, now));
    this.redisTimer = setInterval(() => void this.flushRedis(), this.env.LIVE_STATE_REDIS_FLUSH_MS);
    this.redisTimer.unref?.();
    this.logger.log(`Live state warmed from Redis: ${[...this.mem.values()].reduce((n, m) => n + m.size, 0)} vehicle(s) in ${this.mem.size} organization(s)`);
  }

  /**
   * Stops being the writer. With `flushFirst` (graceful shutdown) the pending batch is written while the lease is still
   * ours; without it (the lease was lost) nothing is written. Afterwards writes are dropped until `becomeLeader` is called.
   */
  async stepDown(flushFirst: boolean): Promise<void> {
    if (this.redisTimer) clearInterval(this.redisTimer);
    this.redisTimer = null;
    if (this.leaderToken && flushFirst && !this.fenced) {
      await this.flushRedis();
      await this.flush().catch((err) => this.logger.error(`Final live-state save failed: ${String(err)}`));
    }
    this.fence();
  }

  /** Leader-side data is gone and further writes are refused (we are not, or are no longer, the lease holder). */
  private fence(reason?: string) {
    if (this.redisTimer) clearInterval(this.redisTimer);
    this.redisTimer = null;
    if (!this.leaderToken) return; // never led (direct mode) or already stepped down: nothing of a leader to drop
    if (reason) this.logger.warn(`Live-state writer stepped down: ${reason}`);
    this.fenced = true;
    this.leaderToken = null;
    this.mem.clear();
    this.loading.clear();
    this.pending = emptyBatch();
    this.dirty.clear();
  }

  // ============================================================ reads

  async get(orgId: string, vehicleId: string): Promise<LiveState | null> {
    if (this.leaderToken) {
      await this.ensureOrg(orgId);
      return this.mem.get(orgId)?.get(vehicleId) ?? null;
    }
    return this.getFromRedis(orgId, vehicleId);
  }

  /** All live states of an organization (map snapshot / counts). Rehydrates from PostgreSQL if Redis was emptied. */
  async list(orgId: string): Promise<LiveState[]> {
    if (this.leaderToken) {
      await this.ensureOrg(orgId);
      return [...(this.mem.get(orgId)?.values() ?? [])];
    }
    try {
      const all = await this.redis.hgetall(liveKey(orgId));
      const values = Object.values(all);
      if (values.length > 0) return values.map(parseState);
    } catch (err) {
      this.logger.warn(`Redis read failed, falling back to the database: ${String(err)}`);
    }
    return this.rehydrateFromDatabase(orgId);
  }

  /** Organizations that currently have live state. */
  async organizations(): Promise<string[]> {
    if (this.leaderToken) return [...this.mem.keys()];
    try {
      return await this.redis.smembers(ORGS_KEY);
    } catch {
      return [];
    }
  }

  /**
   * Direct-mode single read. A Redis miss does NOT query PostgreSQL per vehicle: if the organization's hash exists the
   * vehicle simply has no state yet. Only a missing hash (Redis emptied or restarted) is rehydrated, once, in bulk.
   */
  private async getFromRedis(orgId: string, vehicleId: string): Promise<LiveState | null> {
    try {
      const raw = await this.redis.hget(liveKey(orgId), vehicleId);
      if (raw) return parseState(raw);
      if ((await this.redis.exists(liveKey(orgId))) === 1) return null;
    } catch (err) {
      this.logger.warn(`Redis read failed, falling back to the database: ${String(err)}`);
      const row = await this.tenant.runInOrganization(orgId, (tx) => tx.vehicleLiveState.findUnique({ where: { vehicleId } }));
      return row ? fromRow(row) : null;
    }
    const states = await this.rehydrateFromDatabase(orgId);
    return states.find((s) => s.vehicleId === vehicleId) ?? null;
  }

  /** Reloads an organization from PostgreSQL into Redis with one read and one atomic write (direct mode). */
  private async rehydrateFromDatabase(orgId: string): Promise<LiveState[]> {
    const rows = await this.tenant.runInOrganization(orgId, (tx) => tx.vehicleLiveState.findMany());
    const states = rows.map(fromRow);
    if (states.length > 0 && !this.fenced) {
      const batch = emptyBatch(); // (a stepped-down instance must not write anything back to Redis)
      const now = new Date();
      for (const s of states) {
        const m = memberOf(orgId, s.vehicleId);
        batch.states.set(m, s);
        batch.deadlines.set(m, this.deadlineOf(s, now));
      }
      try {
        await this.apply(batch, null);
      } catch (err) {
        this.logger.warn(`Redis write failed while rehydrating: ${String(err)}`);
      }
    }
    return states;
  }

  /** Leader mode: make sure an organization's states are in memory (Redis first, PostgreSQL if Redis has nothing). */
  private ensureOrg(orgId: string): Promise<void> {
    if (this.mem.has(orgId)) return Promise.resolve();
    let p = this.loading.get(orgId);
    if (!p) {
      p = this.loadOrg(orgId).finally(() => this.loading.delete(orgId));
      this.loading.set(orgId, p);
    }
    return p;
  }

  private async loadOrg(orgId: string): Promise<void> {
    let states: LiveState[] = [];
    try {
      states = Object.values(await this.redis.hgetall(liveKey(orgId))).map(parseState);
    } catch (err) {
      this.logger.warn(`Redis read failed while loading an organization: ${String(err)}`);
    }
    let fromDb = false;
    if (states.length === 0) {
      states = (await this.tenant.runInOrganization(orgId, (tx) => tx.vehicleLiveState.findMany())).map(fromRow);
      fromDb = states.length > 0;
    }
    if (!this.leaderToken || this.mem.has(orgId)) return; // stepped down, or a concurrent put created it meanwhile
    this.mem.set(orgId, new Map(states.map((s) => [s.vehicleId, s])));
    if (fromDb) {
      const now = new Date();
      for (const s of states) {
        const m = memberOf(orgId, s.vehicleId);
        this.pending.states.set(m, s);
        this.pending.deadlines.set(m, this.deadlineOf(s, now));
      }
    }
  }

  // ============================================================ writes

  /** The next instant this state's derived status could change by itself (see `nextStatusDeadline`), in ms, or null. */
  private deadlineOf(s: LiveState, at: Date): number | null {
    return (
      nextStatusDeadline(
        { everReported: true, lastSeenAt: s.lastSeenAt, speedKmh: s.speedKmh, motion: s.motion, ignition: s.ignition, stationarySince: s.stationarySince },
        at,
        this.status.thresholds,
      )?.getTime() ?? null
    );
  }

  /**
   * Stores a new state. In leader mode this only touches memory and the pending batch (the caller never waits for Redis or
   * PostgreSQL). `persistNow` schedules an IMMEDIATE save to PostgreSQL (status change, first position); saves are coalesced.
   * `at` is the pipeline's clock, so the deadline is computed from the same instant the status was derived at.
   */
  async put(state: LiveState, persistNow = false, at: Date = new Date()): Promise<void> {
    if (this.fenced) return this.dropped('put');
    const m = memberOf(state.organizationId, state.vehicleId);
    const deadline = this.deadlineOf(state, at);
    this.dirty.set(state.vehicleId, state);
    if (this.leaderToken) {
      let states = this.mem.get(state.organizationId);
      if (!states) this.mem.set(state.organizationId, (states = new Map()));
      states.set(state.vehicleId, state);
      this.pending.states.set(m, state);
      this.pending.deadlines.set(m, deadline);
      this.pending.removed.delete(m);
    } else {
      const batch = emptyBatch();
      batch.states.set(m, state);
      batch.deadlines.set(m, deadline);
      await this.apply(batch, null);
    }
    if (persistNow) void this.flush().catch((err) => this.logger.error(`Live-state save failed: ${String(err)}`));
  }

  /** Re-schedules a vehicle's review after the sweeper looked at it. */
  async reschedule(state: LiveState, at: Date): Promise<void> {
    if (this.fenced) return this.dropped('reschedule');
    const m = memberOf(state.organizationId, state.vehicleId);
    const deadline = this.deadlineOf(state, at);
    if (this.leaderToken) {
      this.pending.deadlines.set(m, deadline);
      return;
    }
    const batch = emptyBatch();
    batch.deadlines.set(m, deadline);
    await this.apply(batch, null);
  }

  async remove(orgId: string, vehicleId: string): Promise<void> {
    this.dirty.delete(vehicleId);
    const m = memberOf(orgId, vehicleId);
    if (this.fenced) return this.dropped('remove');
    if (this.leaderToken) {
      this.mem.get(orgId)?.delete(vehicleId);
      this.pending.states.delete(m);
      this.pending.recent.delete(m);
      this.pending.deadlines.set(m, null);
      this.pending.removed.set(m, { orgId, vehicleId });
      return;
    }
    const batch = emptyBatch();
    batch.deadlines.set(m, null);
    batch.removed.set(m, { orgId, vehicleId });
    try {
      await this.apply(batch, null);
    } catch (err) {
      this.logger.warn(`Redis delete failed: ${String(err)}`);
    }
  }

  async pushRecent(orgId: string, vehicleId: string, sample: RecentSample): Promise<void> {
    if (this.fenced) return this.dropped('pushRecent');
    const m = memberOf(orgId, vehicleId);
    if (this.leaderToken) {
      const entry = this.pending.recent.get(m) ?? { orgId, vehicleId, samples: [] };
      entry.samples.push(sample);
      if (entry.samples.length > RING_SIZE) entry.samples.splice(0, entry.samples.length - RING_SIZE);
      this.pending.recent.set(m, entry);
      return;
    }
    const batch = emptyBatch();
    batch.recent.set(m, { orgId, vehicleId, samples: [sample] });
    await this.apply(batch, null).catch((err) => this.logger.warn(`Ring buffer write failed: ${String(err)}`));
  }

  /** Most recent first. */
  async recent(orgId: string, vehicleId: string): Promise<RecentSample[]> {
    let stored: RecentSample[] = [];
    try {
      stored = (await this.redis.lrange(recentKey(orgId, vehicleId), 0, RING_SIZE - 1)).map((s) => JSON.parse(s) as RecentSample);
    } catch {
      /* fall through with what we have */
    }
    const waiting = this.pending.recent.get(memberOf(orgId, vehicleId))?.samples ?? [];
    return [...[...waiting].reverse(), ...stored].slice(0, RING_SIZE);
  }

  private dropped(op: string) {
    this.logger.warn(`Ignored ${op}: this instance is no longer the live-state writer`);
  }

  // ============================================================ sweeper support

  /** Vehicles whose review deadline has passed, soonest first. One range query; the index is made current first. */
  async dueForReview(nowMs: number, limit = 1000): Promise<{ orgId: string; vehicleId: string }[]> {
    if (this.leaderToken) await this.flushRedis();
    const members = await this.redis.zrangebyscore(DEADLINES_KEY, '-inf', String(nowMs), 'LIMIT', 0, limit);
    return members.map((m) => {
      const i = m.indexOf('|');
      return { orgId: m.slice(0, i), vehicleId: m.slice(i + 1) };
    });
  }

  // ============================================================ Redis batch

  /**
   * Writes the pending batch to Redis (leader mode). Serialised. Returns false when the lease was lost (the batch is
   * discarded and this instance steps down) or Redis failed (the batch is kept and retried on the next tick).
   */
  flushRedis(): Promise<boolean> {
    const run = this.applying.then(async () => {
      const token = this.leaderToken;
      if (!token) return true;
      if (isEmpty(this.pending)) return true;
      const batch = this.pending;
      this.pending = emptyBatch();
      try {
        if (await this.apply(batch, token)) return true;
        this.fence('the ingestion lease is held by another instance; this instance\'s pending writes were discarded');
        return false;
      } catch (err) {
        this.requeue(batch);
        this.logger.warn(`Live-state write to Redis failed (kept for retry): ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    });
    this.applying = run.catch(() => undefined);
    return run;
  }

  /** A failed batch goes back UNDER whatever was written to memory since: the newer value of any key wins. */
  private requeue(batch: Batch) {
    if (!this.leaderToken) return;
    for (const [m, s] of batch.states) if (!this.pending.states.has(m)) this.pending.states.set(m, s);
    for (const [m, d] of batch.deadlines) if (!this.pending.deadlines.has(m)) this.pending.deadlines.set(m, d);
    for (const [m, e] of batch.recent) {
      const newer = this.pending.recent.get(m);
      this.pending.recent.set(m, { ...e, samples: [...e.samples, ...(newer?.samples ?? [])].slice(-RING_SIZE) });
    }
    for (const [m, r] of batch.removed) if (!this.pending.removed.has(m)) this.pending.removed.set(m, r);
  }

  private async apply(batch: Batch, token: string | null): Promise<boolean> {
    const p = this.env.REDIS_KEY_PREFIX;
    const byOrg = new Map<string, string[]>();
    for (const s of batch.states.values()) {
      const args = byOrg.get(s.organizationId) ?? [];
      args.push(s.vehicleId, serializeState(s));
      byOrg.set(s.organizationId, args);
    }
    const payload = {
      orgsKey: `${p}${ORGS_KEY}`,
      deadlinesKey: `${p}${DEADLINES_KEY}`,
      ringMax: RING_SIZE,
      ringTtl: RING_TTL_SECONDS,
      orgs: [...byOrg.keys()],
      hashes: [...byOrg].map(([org, args]) => ({ key: `${p}${liveKey(org)}`, args })),
      zadd: [...batch.deadlines].filter(([, d]) => d !== null).map(([m, d]) => [String(d), m]),
      zrem: [...batch.deadlines].filter(([, d]) => d === null).map(([m]) => m),
      lists: [...batch.recent.values()].map((e) => ({ key: `${p}${recentKey(e.orgId, e.vehicleId)}`, push: e.samples.map((x) => JSON.stringify(x)) })),
      hdel: [...batch.removed.values()].map((r) => ({ key: `${p}${liveKey(r.orgId)}`, field: r.vehicleId })),
      dels: [...batch.removed.values()].map((r) => `${p}${recentKey(r.orgId, r.vehicleId)}`),
    };
    const applied = await this.redis.eval(APPLY_BATCH, 1, INGESTION_LEASE_KEY, token ?? '', JSON.stringify(payload));
    return applied === 1;
  }

  // ============================================================ PostgreSQL

  /**
   * Saves all dirty states to PostgreSQL (each organization in its own tenant context, up to FLUSH_CHUNK vehicles per
   * statement). Serialised. In leader mode it first checks that the lease is still ours, and the statement itself never
   * moves a row backwards in time, so a slow or stale writer cannot overwrite newer data.
   */
  flush(): Promise<void> {
    this.flushing = this.flushing.then(async () => {
      if (this.dirty.size === 0) return;
      if (this.leaderToken && (await this.redis.get(INGESTION_LEASE_KEY).catch(() => this.leaderToken)) !== this.leaderToken) {
        this.fence('the ingestion lease is held by another instance; its PostgreSQL save was skipped');
        return;
      }
      const batch = [...this.dirty.values()];
      for (const s of batch) if (this.dirty.get(s.vehicleId) === s) this.dirty.delete(s.vehicleId);
      const byOrg = new Map<string, LiveState[]>();
      for (const s of batch) byOrg.set(s.organizationId, [...(byOrg.get(s.organizationId) ?? []), s]);
      for (const [orgId, states] of byOrg) {
        try {
          for (let i = 0; i < states.length; i += FLUSH_CHUNK) {
            const chunk = states.slice(i, i + FLUSH_CHUNK);
            await this.tenant.runInOrganization(orgId, (tx) => upsertChunk(tx, orgId, chunk));
          }
        } catch (err) {
          for (const s of states) if (!this.dirty.has(s.vehicleId)) this.dirty.set(s.vehicleId, s); // retry next time
          this.logger.error(`Live-state save failed for one organization: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
    return this.flushing;
  }

  /** Test support. */
  async resetForTests(orgId: string): Promise<void> {
    this.dirty.clear();
    this.mem.delete(orgId);
    this.pending = emptyBatch();
    await this.redis.del(liveKey(orgId));
  }
}

/**
 * Upserts many live states with ONE statement (jsonb_to_recordset). Joining `vehicles` skips a vehicle that was
 * unassigned/deleted meanwhile instead of failing the batch (the composite FK would otherwise reject the whole statement),
 * and the WHERE keeps a row from ever moving backwards (a stale writer cannot overwrite newer data).
 * Runs inside the caller's tenant transaction, so forced RLS still applies.
 */
async function upsertChunk(tx: Prisma.TransactionClient, orgId: string, rows: LiveState[]): Promise<void> {
  // Rows travel as ONE JSON parameter and are typed in SQL. Array parameters would break: Prisma binds an all-null JS array
  // as integer[], which cannot be cast to boolean[] / timestamptz[] (e.g. a chunk where no vehicle reports ignition).
  const payload = JSON.stringify(
    rows.map((s) => ({
      vehicle_id: s.vehicleId, device_id: s.deviceId, latitude: s.latitude, longitude: s.longitude, speed_kmh: s.speedKmh, heading: s.heading,
      ignition: s.ignition, motion: s.motion, last_fix_at: s.lastFixAt, last_seen_at: s.lastSeenAt, last_fix_invalid: s.lastFixInvalid,
      last_fix_delayed: s.lastFixDelayed, stationary_since: s.stationarySince, status: s.status, status_changed_at: s.statusChangedAt, simulated: s.simulated,
    })),
  );
  await tx.$executeRaw`
    INSERT INTO vehicle_live_state AS t
      (vehicle_id, organization_id, device_id, latitude, longitude, speed_kmh, heading, ignition, motion, last_fix_at, last_seen_at,
       last_fix_invalid, last_fix_delayed, stationary_since, status, status_changed_at, simulated, updated_at)
    SELECT u.vehicle_id, ${orgId}::uuid, u.device_id, u.latitude, u.longitude, u.speed_kmh, u.heading, u.ignition, u.motion, u.last_fix_at, u.last_seen_at,
           u.last_fix_invalid, u.last_fix_delayed, u.stationary_since, u.status::"VehicleStatus", u.status_changed_at, u.simulated, now()
    FROM jsonb_to_recordset(${payload}::jsonb) AS u(
      vehicle_id uuid, device_id uuid, latitude float8, longitude float8, speed_kmh float8, heading float8, ignition boolean, motion boolean,
      last_fix_at timestamptz, last_seen_at timestamptz, last_fix_invalid boolean, last_fix_delayed boolean, stationary_since timestamptz,
      status text, status_changed_at timestamptz, simulated boolean)
    JOIN vehicles v ON v.id = u.vehicle_id AND v.organization_id = ${orgId}::uuid
    ON CONFLICT (vehicle_id) DO UPDATE SET
      device_id = EXCLUDED.device_id, latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude, speed_kmh = EXCLUDED.speed_kmh,
      heading = EXCLUDED.heading, ignition = EXCLUDED.ignition, motion = EXCLUDED.motion, last_fix_at = EXCLUDED.last_fix_at,
      last_seen_at = EXCLUDED.last_seen_at, last_fix_invalid = EXCLUDED.last_fix_invalid, last_fix_delayed = EXCLUDED.last_fix_delayed,
      stationary_since = EXCLUDED.stationary_since, status = EXCLUDED.status, status_changed_at = EXCLUDED.status_changed_at,
      simulated = EXCLUDED.simulated, updated_at = now()
    WHERE t.last_seen_at <= EXCLUDED.last_seen_at`;
}
