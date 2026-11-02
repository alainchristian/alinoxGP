#!/usr/bin/env -S npx tsx
/**
 * GPS simulator CLI.
 *
 *   pnpm sim drive --id SIM-DEMO-0001 [--route kigali-city-loop] [--speed 40] [--interval 5] [--duration 120] [--url http://localhost:55055]
 *   pnpm sim scenario list
 *   pnpm sim scenario <name|all> [--parallel]
 *   pnpm sim fleet --count 200 --interval 10 --duration 120    (registers SIM- vehicles, offers load, reports delivery latency)
 *
 * `scenario` registers its own vehicle + SIM- device in a SANDBOX organization through the platform API, sends real
 * OsmAnd traffic into Traccar, and asserts what the platform shows (REST + live socket). Environment:
 *   SIM_API_URL (default http://localhost:3100)   SIM_EMAIL  SIM_PASSWORD  SIM_ORG_ID   (a user of a sandbox organization)
 *   TRACCAR_OSMAND_URL (default http://localhost:55055)
 *   TRACCAR_URL TRACCAR_USER TRACCAR_PASSWORD  (optional: engine-level checks — history, trips, geofence events)
 *   SIM_ADMIN_EMAIL SIM_ADMIN_PASSWORD         (optional: platform admin, to read pipeline counters)
 * The simulator refuses to run when SIMULATOR_ENABLED=false.
 */
import { drive } from './motion';
import { SimulatorGuardError, sendPosition } from './osmand-client';
import { ROUTES } from './routes';
import { PlatformClient } from './scenario/platform-client';
import { runFleet } from './fleet';
import { runScenarios } from './scenario/runner';
import { TraccarProbe } from './scenario/traccar-probe';
import { SCENARIOS, scenarioByName } from './scenarios';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);
const env = (name: string, fallback?: string) => process.env[name] ?? fallback;

async function driveCommand() {
  const id = arg('id');
  if (!id) throw new Error('--id is required');
  const routeName = arg('route', 'kigali-streets')!;
  const route = ROUTES[routeName];
  if (!route) throw new Error(`Unknown route "${routeName}". Available: ${Object.keys(ROUTES).join(', ')}`);
  const url = arg('url', env('TRACCAR_OSMAND_URL', 'http://localhost:55055'))!;
  const intervalSec = Number(arg('interval', '5'));
  const durationSec = Number(arg('duration', '120'));
  const speedFactor = Number(arg('speed-factor', '1'));
  const points = drive({ route, speedKmh: Number(arg('speed', '40')), intervalSec, seed: Number(arg('seed', '42')), startTime: Date.now() });

  console.log(`Simulating ${id} on "${routeName}" for ${durationSec}s (interval ${intervalSec}s) -> ${url}`);
  for (let sent = 0; sent * intervalSec < durationSec; sent++) {
    const p = points.next().value!;
    const result = await sendPosition(url, { id, latitude: p.latitude, longitude: p.longitude, speedKmh: p.speedKmh, heading: p.heading, ignition: p.ignition, batteryPercent: 90, time: p.time });
    console.log(`#${sent + 1} ${new Date(p.time).toISOString()} -> HTTP ${result.httpStatus}`);
    if (result.httpStatus === 400) console.warn('The platform does not know this device id: register it first (sandbox organization).');
    await new Promise((r) => setTimeout(r, (intervalSec * 1000) / speedFactor));
  }
}

async function scenarioCommand() {
  const which = process.argv[3];
  if (!which || which === 'list') {
    for (const s of SCENARIOS) console.log(`${s.name.padEnd(22)} ${s.description}\n${' '.repeat(22)} proves: ${s.proves}\n`);
    return;
  }
  const selected = which === 'all' ? [...SCENARIOS] : [scenarioByName(which)].filter((s) => !!s);
  if (selected.length === 0) throw new Error(`Unknown scenario "${which}". Run "pnpm sim scenario list".`);

  const apiUrl = env('SIM_API_URL', 'http://localhost:3100')!;
  const email = env('SIM_EMAIL');
  const password = env('SIM_PASSWORD');
  const orgId = env('SIM_ORG_ID');
  if (!email || !password || !orgId) throw new Error('Set SIM_EMAIL, SIM_PASSWORD and SIM_ORG_ID (a user of a sandbox organization).');
  const platform = await PlatformClient.login(apiUrl, email, password, orgId);
  const engine = env('TRACCAR_USER') && env('TRACCAR_PASSWORD') ? new TraccarProbe(env('TRACCAR_URL', 'http://localhost:58082')!, env('TRACCAR_USER')!, env('TRACCAR_PASSWORD')!) : undefined;

  const results = await runScenarios(selected, { platform, osmandUrl: env('TRACCAR_OSMAND_URL', 'http://localhost:55055')!, engine, log: console.log }, flag('parallel'));
  console.log('\nResults');
  for (const r of results) {
    const mark = r.outcome === 'passed' ? '✓' : r.outcome === 'skipped' ? '-' : '✗';
    console.log(`${mark} ${r.name.padEnd(22)} ${r.outcome.padEnd(8)} ${(r.durationMs / 1000).toFixed(1)}s  ${r.checks.length} checks${r.error ? `  ${r.error}` : ''}${r.skipReason ? `  (${r.skipReason})` : ''}`);
  }
  if (results.some((r) => r.outcome === 'failed')) process.exitCode = 1;
}

async function fleetCommand() {
  const apiUrl = env('SIM_API_URL', 'http://localhost:3100')!;
  const email = env('SIM_EMAIL');
  const password = env('SIM_PASSWORD');
  const orgId = env('SIM_ORG_ID');
  if (!email || !password || !orgId) throw new Error('Set SIM_EMAIL, SIM_PASSWORD and SIM_ORG_ID (a user of a sandbox organization).');
  const platform = await PlatformClient.login(apiUrl, email, password, orgId);
  const report = await runFleet({
    platform,
    osmandUrl: env('TRACCAR_OSMAND_URL', 'http://localhost:55055')!,
    count: Number(arg('count', '100')),
    intervalSec: Number(arg('interval', '10')),
    durationSec: Number(arg('duration', '120')),
    // With the engine's REST credentials the report also separates the platform's own latency from the engine's.
    engineFeed: env('TRACCAR_USER') && env('TRACCAR_PASSWORD') ? { restUrl: env('TRACCAR_URL', 'http://localhost:58082')!, user: env('TRACCAR_USER')!, password: env('TRACCAR_PASSWORD')! } : undefined,
    log: console.log,
  });
  console.log(JSON.stringify(report, null, 2));
}

async function main() {
  if (process.env['SIMULATOR_ENABLED'] === 'false') throw new SimulatorGuardError('SIMULATOR_ENABLED=false: refusing to run');
  const command = process.argv[2];
  if (command === 'drive') return driveCommand();
  if (command === 'scenario') return scenarioCommand();
  if (command === 'fleet') return fleetCommand();
  console.error('Usage: sim drive --id SIM-… | sim scenario list | sim scenario <name|all> [--parallel]');
  process.exit(2);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
