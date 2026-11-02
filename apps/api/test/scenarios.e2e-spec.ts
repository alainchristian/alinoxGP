import { GPS_ENGINE, type GpsEnginePort } from '../src/integrations/gps-engine/port';
import { IngestionService } from '../src/modules/tracking/ingestion.service';
import { IngestStatsService } from '../src/modules/tracking/ingest-stats.service';
import { PlatformClient, SCENARIOS, TraccarProbe, runScenario, type RunOutcome } from '@gps/simulator';
import { addMemberAndLogin, createOrg, createTestApp, type TestCtx } from './helpers';

/**
 * M3 exit criterion: EVERY scenario of spec §9 runs repeatably against a real Traccar and our API, through the same
 * simulator code and the same public endpoints a customer would use (REST + Socket.IO), and passes its assertions.
 *
 * Thresholds are compressed (offline 15 s, idle 6 s, parked 10 s, delayed 10 s) so the suite takes about a minute;
 * the logic under test is identical to production, only the numbers differ. Each scenario gets its own sandbox
 * organization, which also keeps their alert rules and live feeds isolated while they run in parallel.
 */
const OSMAND = process.env['TRACCAR_OSMAND_URL'] ?? 'http://localhost:55055';

describe('Simulator scenarios against real Traccar (e2e)', () => {
  let ctx: TestCtx;
  let baseUrl: string;
  const outcomes = new Map<string, RunOutcome>();

  beforeAll(async () => {
    ctx = await createTestApp({
      INGESTION_ENABLED: 'true',
      STATUS_OFFLINE_AFTER_SEC: '15',
      STATUS_IDLE_AFTER_SEC: '6',
      STATUS_PARKED_AFTER_SEC: '10',
      PIPELINE_DELAYED_AFTER_SEC: '10',
      SWEEP_INTERVAL_SEC: '2',
      FANOUT_FLUSH_MS: '200',
      STATE_PERSIST_INTERVAL_SEC: '2',
    });
    await ctx.app.listen(0);
    const address = ctx.app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${address.port}`;
    const ingestion = ctx.app.get(IngestionService);
    const start = Date.now();
    while (!ingestion.state.streamConnected) {
      if (Date.now() - start > 40_000) throw new Error('Ingestion did not connect to Traccar (is `pnpm infra:up` running?)');
      await new Promise((r) => setTimeout(r, 300));
    }

    const stats = ctx.app.get(IngestStatsService);
    const engine = new TraccarProbe(process.env['TRACCAR_URL'] ?? 'http://localhost:58082', process.env['TRACCAR_USER']!, process.env['TRACCAR_PASSWORD']!);

    const results = await Promise.all(
      SCENARIOS.map(async (scenario) => {
        const org = await createOrg(ctx, { name: `Scenario ${scenario.name}` });
        await ctx.system.organization.update({ where: { id: org.id }, data: { isSandbox: true } });
        const owner = await addMemberAndLogin(ctx, org.id, 'ORG_OWNER');
        const platform = new PlatformClient(baseUrl, owner.accessToken, org.id);
        return runScenario(scenario, { platform, osmandUrl: OSMAND, engine, stats: () => stats.all() });
      }),
    );
    for (const r of results) outcomes.set(r.name, r);
  }, 420_000);

  afterAll(async () => {
    const engine = ctx.app.get<GpsEnginePort>(GPS_ENGINE);
    for (const o of outcomes.values()) {
      const d = await engine.findDeviceByUniqueId(o.deviceUniqueId).catch(() => null);
      if (d) await engine.removeDevice(d).catch(() => undefined);
    }
    await ctx.close();
  }, 60_000);

  it('covers the eleven scenarios of spec §9 plus implausible-jump', () => {
    expect(SCENARIOS.map((s) => s.name).sort()).toEqual(
      ['delayed-transmission', 'disconnect', 'geofence-enter-exit', 'ignition-cycle', 'implausible-jump', 'invalid-coordinates', 'moving-route', 'out-of-order', 'overspeed', 'parked-drift', 'reconnect-buffered', 'stopping'],
    );
  });

  it.each(SCENARIOS.map((s) => [s.name]))('%s', (name) => {
    const o = outcomes.get(name!)!;
    const failed = o.checks.filter((c) => !c.ok).map((c) => c.name);
    expect({ outcome: o.outcome, error: o.error, failed, skip: o.skipReason }).toEqual({ outcome: 'passed', error: undefined, failed: [], skip: undefined });
    expect(o.checks.length).toBeGreaterThanOrEqual(3); // a scenario that asserts nothing proves nothing
  });

  it('no scenario was skipped (all ran with engine access)', () => {
    expect([...outcomes.values()].filter((o) => o.outcome === 'skipped').map((o) => o.name)).toEqual([]);
  });
});
