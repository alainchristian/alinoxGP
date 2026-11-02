import { ENV } from '../src/infrastructure/config/env';
import { DeviceRoutingService } from '../src/modules/devices/device-routing.service';
import { IngestionService } from '../src/modules/tracking/ingestion.service';
import { IngestStatsService } from '../src/modules/tracking/ingest-stats.service';
import { PlatformClient, runFleet, type FleetReport } from '@gps/simulator';
import { addMemberAndLogin, createOrg, createTestApp, type TestCtx } from './helpers';

/**
 * STEADY-TRAFFIC SMOKE TEST — part of the done-check (skill gps-done-check §1). 50 simulated devices report every 10 s for
 * 2 minutes through the real chain (OsmAnd -> Traccar -> ingestion -> live state -> Socket.IO) with the production defaults
 * for caching, fan-out and persistence. It catches the class of defect that functional tests cannot: a cache that never
 * hits, a write path that falls behind, a latency that grows with time.
 *
 * It measures only its OWN vehicles, and splits the latency: the engine's own buffering is not the platform's, so
 * "position-to-socket" is taken from the moment the ENGINE emits a position on its feed to the moment the browser-side
 * socket receives the matching delta.
 */
const DEVICES = 50;
const INTERVAL_SEC = 10;
const DURATION_SEC = 120;

describe('Steady-traffic smoke test (50 devices, 10 s interval, 2 min)', () => {
  let ctx: TestCtx;
  let report: FleetReport;
  let cacheHitRate: number | null;
  let cacheHits = 0;
  let cacheMisses = 0;
  let counters: Record<string, number>;

  beforeAll(async () => {
    ctx = await createTestApp({ INGESTION_ENABLED: 'true' }); // everything else at its production default
    await ctx.app.listen(0);
    const baseUrl = `http://127.0.0.1:${(ctx.app.getHttpServer().address() as { port: number }).port}`;
    const ingestion = ctx.app.get(IngestionService);
    const start = Date.now();
    while (!ingestion.state.streamConnected) {
      if (Date.now() - start > 40_000) throw new Error('Ingestion did not connect to Traccar (is the test stack up? `pnpm test:infra:up`)');
      await new Promise((r) => setTimeout(r, 300));
    }

    const org = await createOrg(ctx, { name: 'Smoke steady traffic' });
    await ctx.system.organization.update({ where: { id: org.id }, data: { isSandbox: true } });
    const owner = await addMemberAndLogin(ctx, org.id, 'ORG_OWNER');
    const platform = new PlatformClient(baseUrl, owner.accessToken, org.id);

    const routing = ctx.app.get(DeviceRoutingService);
    routing.resetStats();
    report = await runFleet({
      platform,
      osmandUrl: process.env['TRACCAR_OSMAND_URL']!,
      count: DEVICES,
      intervalSec: INTERVAL_SEC,
      durationSec: DURATION_SEC,
      engineFeed: { restUrl: process.env['TRACCAR_URL']!, user: process.env['TRACCAR_USER']!, password: process.env['TRACCAR_PASSWORD']! },
      log: () => undefined,
    });
    ({ hits: cacheHits, misses: cacheMisses, hitRate: cacheHitRate } = routing.stats());
    counters = await ctx.app.get(IngestStatsService).all();
    console.log(`SMOKE REPORT ${JSON.stringify({ report, routingCache: { hits: cacheHits, misses: cacheMisses, hitRate: cacheHitRate }, counters })}`);
  }, 420_000);

  afterAll(() => ctx.close(), 60_000);

  it('offers the intended load and the engine accepts all of it', () => {
    expect(report.devices).toBe(DEVICES);
    expect(report.sent).toBeGreaterThanOrEqual(DEVICES * (DURATION_SEC / INTERVAL_SEC) * 0.95);
    expect(report.httpFailed).toEqual({});
    expect(report.httpOk).toBe(report.sent);
  });

  it('routing cache hit rate is above 90 %', () => {
    expect(cacheHitRate).not.toBeNull();
    expect(cacheHitRate!).toBeGreaterThan(0.9);
  });

  it('cache lifetimes come from configuration and are longer than the reporting interval', () => {
    const env = ctx.app.get(ENV);
    expect(env.ROUTING_CACHE_TTL_SEC).toBeGreaterThan(INTERVAL_SEC);
    expect(env.STATUS_OFFLINE_AFTER_SEC).toBeGreaterThan(INTERVAL_SEC * 2); // a healthy device must never look offline between two reports
    expect(env.STATE_PERSIST_INTERVAL_SEC).toBeGreaterThanOrEqual(1);
  });

  it('p95 position-to-socket latency (engine emit -> browser socket) is under 2 s', () => {
    expect(report.positionToSocketMs).not.toBeNull();
    expect(report.matchedDeltas).toBeGreaterThan(DEVICES * 6); // enough samples to mean something (the warm-up is excluded)
    expect(report.positionToSocketMs!.p95).toBeLessThan(2000);
  });

  it('delivers the positions to the browser, for its own vehicles only', () => {
    expect(report.distinctVehiclesSeen).toBe(DEVICES);
    expect(report.deltasReceived).toBeGreaterThanOrEqual(report.httpOk * 0.95);
  });

  it('has no errors: no failed requests, no socket drops, nothing dropped or failed in the pipeline', () => {
    expect(report.socketDisconnects).toBe(0);
    for (const bad of ['processing_errors', 'dropped_malformed', 'dropped_unmapped', 'blocked_simulated']) expect(counters[bad] ?? 0).toBe(0);
    expect(counters['accepted'] ?? 0).toBeGreaterThanOrEqual(report.httpOk * 0.95);
  });
});
