import type { AlertType, LiveLocationDto, VehicleStatus } from '@gps/shared';
import { sendPosition } from '../osmand-client';
import { LiveSocket } from './live-socket';
import { PlatformClient } from './platform-client';
import type { TraccarProbe } from './traccar-probe';
import { ScenarioAssertionError, ScenarioSkipped, type CheckRecord, type Fix, type Scenario, type ScenarioContext, type ScenarioResult } from './types';

export interface RunnerDeps {
  /** Platform client already scoped to a SANDBOX organization (use one organization per scenario when running in parallel). */
  platform: PlatformClient;
  /** Traccar's OsmAnd port, e.g. http://localhost:55055 */
  osmandUrl: string;
  /** Start of the route used by default (lat, lon). */
  home?: { latitude: number; longitude: number };
  engine?: TraccarProbe;
  stats?: () => Promise<Record<string, number>>;
  log?: (line: string) => void;
}

export interface RunOutcome extends ScenarioResult {
  /** Identifiers the scenario created (so a test harness can clean the engine up). */
  deviceUniqueId: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Runs ONE scenario: registers a fresh vehicle + simulated device in the sandbox organization through the public API,
 * listens to the live socket, executes the steps (sending real OsmAnd traffic into the real Traccar), records every
 * check, and always cleans up the alert rules it created.
 */
export async function runScenario(scenario: Scenario, deps: RunnerDeps): Promise<RunOutcome> {
  const started = Date.now();
  const checks: CheckRecord[] = [];
  const notes: string[] = [];
  const createdRules: string[] = [];
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  const deviceUniqueId = `SIM-${scenario.name.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 10)}-${suffix}`;
  const registrationNumber = `S${suffix}`.slice(0, 12);
  const log = deps.log ?? (() => undefined);
  const home = deps.home ?? { latitude: -1.9441, longitude: 30.0619 };
  const live = new LiveSocket(deps.platform.baseUrl, deps.platform.token, deps.platform.organizationId);

  const result = (outcome: ScenarioResult['outcome'], extra: Partial<ScenarioResult> = {}): RunOutcome => ({
    name: scenario.name, outcome, durationMs: Date.now() - started, checks, notes, deviceUniqueId, ...extra,
  });

  try {
    const [thresholds, vehicleId] = await Promise.all([deps.platform.thresholds(), deps.platform.createVehicle(registrationNumber)]);
    const deviceId = await deps.platform.registerDevice(deviceUniqueId);
    await deps.platform.assign(deviceId, vehicleId);
    await live.connect();
    await live.subscribeVehicle(vehicleId);

    const location = async (): Promise<LiveLocationDto | null> => (await deps.platform.location(vehicleId)).location;
    const waitFor: ScenarioContext['waitFor'] = async (what, fn, timeoutMs = 30_000) => {
      const end = Date.now() + timeoutMs;
      for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new ScenarioAssertionError(`Timed out after ${timeoutMs} ms waiting for: ${what}`);
        await sleep(300);
      }
    };

    const ctx: ScenarioContext = {
      scenario: scenario.name,
      thresholds,
      vehicleId,
      registrationNumber,
      deviceUniqueId,
      socket: live.events,
      engine: deps.engine,
      stats: deps.stats,
      send: (fix: Fix = {}) =>
        sendPosition(deps.osmandUrl, {
          id: deviceUniqueId,
          latitude: fix.latitude ?? home.latitude,
          longitude: fix.longitude ?? home.longitude,
          speedKmh: fix.speedKmh ?? 0,
          heading: fix.heading,
          ignition: fix.ignition,
          batteryPercent: fix.batteryPercent ?? 90,
          time: fix.time ?? Date.now(),
        }),
      sleep,
      location,
      alerts: (type?: AlertType) => deps.platform.alerts(vehicleId, type),
      summary: async () => (await deps.platform.summary()) as { total: number; byStatus: Record<VehicleStatus, number> },
      createAlertRule: async (rule) => {
        const id = await deps.platform.createAlertRule(rule);
        createdRules.push(id);
        return id;
      },
      waitFor,
      waitForStatus: (status, timeoutMs = 40_000) => waitFor(`status ${status}`, async () => ((await location())?.status === status ? await location() : null), timeoutMs) as Promise<LiveLocationDto>,
      check: (name, condition, detail) => {
        checks.push({ name, ok: condition, detail });
        log(`  ${condition ? '✓' : '✗'} ${name}${detail ? ` (${detail})` : ''}`);
        if (!condition) throw new ScenarioAssertionError(`${name}${detail ? ` — ${detail}` : ''}`);
      },
      note: (m) => {
        notes.push(m);
        log(`  · ${m}`);
      },
      skip: (reason) => {
        throw new ScenarioSkipped(reason);
      },
    };

    log(`▶ ${scenario.name}: ${scenario.description}`);
    await scenario.run(ctx);
    return result('passed');
  } catch (err) {
    if (err instanceof ScenarioSkipped) return result('skipped', { skipReason: err.message });
    return result('failed', { error: err instanceof Error ? err.message : String(err) });
  } finally {
    live.close();
    for (const id of createdRules) await deps.platform.deleteAlertRule(id).catch(() => undefined);
  }
}

export async function runScenarios(scenarios: Scenario[], deps: RunnerDeps, parallel = false): Promise<RunOutcome[]> {
  if (parallel) return Promise.all(scenarios.map((s) => runScenario(s, deps)));
  const out: RunOutcome[] = [];
  for (const s of scenarios) out.push(await runScenario(s, deps));
  return out;
}
