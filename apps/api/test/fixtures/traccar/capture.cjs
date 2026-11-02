/**
 * Captures REAL Traccar responses as test fixtures and records the behaviours the integration depends on.
 *
 *   docker compose -f infra/docker-compose.dev.yml up -d --wait
 *   node --env-file=.env test/fixtures/traccar/capture.cjs
 *
 * Re-run whenever the pinned Traccar version or its configuration changes and review the fixture diff.
 * Secrets (password, cookies) are never written. Everything it creates is deleted afterwards.
 */
const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');

const BASE = process.env.TRACCAR_URL ?? 'http://localhost:58082';
const OSMAND = process.env.TRACCAR_OSMAND_URL ?? 'http://localhost:55055';
const USER = process.env.TRACCAR_USER;
const PASSWORD = process.env.TRACCAR_PASSWORD;
if (!USER || !PASSWORD) throw new Error('TRACCAR_USER and TRACCAR_PASSWORD are required');
const OUT = __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const save = (name, data) => fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2) + '\n');
const nowSec = () => Math.floor(Date.now() / 1000);

let cookie;
async function login() {
  const res = await fetch(`${BASE}/api/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: USER, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  cookie = res.headers.get('set-cookie').split(';')[0];
  return res.json();
}
async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { Cookie: cookie, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text.slice(0, 200); }
  return { status: res.status, body: json };
}
const osmand = async (params) => {
  try {
    return (await fetch(`${OSMAND}/?${new URLSearchParams(params)}`)).status;
  } catch (e) {
    return `connection-closed (${e.cause?.code ?? e.message})`; // handler closes the socket for some inputs
  }
};
const history = async (id) => (await api('GET', `/api/positions?deviceId=${id}&from=2020-01-01T00:00:00Z&to=2030-01-01T00:00:00Z`)).body;
const RANGE = (id) => `deviceId=${id}&from=2020-01-01T00:00:00Z&to=2030-01-01T00:00:00Z`;

(async () => {
  const sessionUser = await login();
  const report = { capturedAt: new Date().toISOString(), notes: {} };
  report.server = (await api('GET', '/api/server')).body;
  report.traccarVersion = report.server.version;
  save('server.json', report.server);
  save('session-user.json', sessionUser);

  for (const uid of ['FIXTURE-1']) {
    for (const d of (await api('GET', `/api/devices?uniqueId=${uid}`)).body ?? []) await api('DELETE', `/api/devices/${d.id}`);
  }

  // ---------------------------------------------------------------- devices
  const created = await api('POST', '/api/devices', { name: 'fixture-device-1', uniqueId: 'FIXTURE-1', model: 'simulator' });
  save('device-created.json', created.body);
  const dev = created.body;
  report.notes.duplicateUniqueIdStatus = (await api('POST', '/api/devices', { name: 'dup', uniqueId: 'FIXTURE-1' })).status;
  report.notes.lookupByUniqueIdCount = (await api('GET', '/api/devices?uniqueId=FIXTURE-1')).body.length;
  report.notes.lookupUnknownUniqueIdCount = (await api('GET', '/api/devices?uniqueId=NOPE-NOPE')).body.length;
  report.notes.putWithoutIdInBodyStatus = (await api('PUT', `/api/devices/${dev.id}`, { name: 'renamed' })).status;
  report.notes.putFullObjectStatus = (await api('PUT', `/api/devices/${dev.id}`, { ...dev, name: 'fixture-device-1' })).status;
  report.notes.disabledDeviceUnknownOsmand = null;

  // ---------------------------------------------------------------- live socket (cookie auth)
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/api/socket`, { headers: { Cookie: cookie } });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  const wsEvents = [];
  ws.on('message', (d) => wsEvents.push({ at: Date.now(), message: JSON.parse(d.toString()) }));
  await sleep(800);

  // ---------------------------------------------------------------- OsmAnd behaviour matrix
  const now = nowSec();
  const cases = [
    ['A valid moving', { lat: -1.9441, lon: 30.0619, speed: 20, bearing: 90, altitude: 1500, accuracy: 5, batt: 90, ignition: 'true', timestamp: now - 100 }],
    ['B speed 10 (unit probe)', { lat: -1.9442, lon: 30.0629, speed: 10, bearing: 90, ignition: 'true', timestamp: now - 95 }],
    ['C ignition=false', { lat: -1.9442, lon: 30.0629, speed: 0, ignition: 'false', timestamp: now - 90 }],
    ['D no ignition param', { lat: -1.9442, lon: 30.0629, speed: 0, timestamp: now - 85 }],
    ['E latitude 95', { lat: 95, lon: 30, speed: 0, timestamp: now - 80 }],
    ['F zero/zero', { lat: 0, lon: 0, speed: 0, timestamp: now - 75 }],
    ['G custom attributes', { lat: -1.9443, lon: 30.063, speed: 0, timestamp: now - 70, hdop: 1.2, sat: 9, power: 12.4, out1: 'true', simulated: 'true' }],
    ['H older than latest (-10 min)', { lat: -1.9, lon: 30.0, speed: 1, timestamp: now - 600 }],
    ['I future +2h', { lat: -1.95, lon: 30.07, speed: 1, timestamp: now + 7200 }],
    ['J future +30 min', { lat: -1.95, lon: 30.07, speed: 1, timestamp: now + 1800 }],
    ['K no timestamp (server time)', { lat: -1.96, lon: 30.08, speed: 1 }],
    ['L exact duplicate of K', { lat: -1.96, lon: 30.08, speed: 1 }],
  ];
  const matrix = [];
  let known = 0;
  for (const [name, params] of cases) {
    const wsBefore = wsEvents.length;
    const sentAt = Date.now();
    const status = await osmand({ id: 'FIXTURE-1', ...params });
    let restVisibleMs = null;
    let h = [];
    for (let i = 0; i < 16; i++) {
      await sleep(500);
      h = await history(dev.id);
      if (h.length > known) { restVisibleMs = Date.now() - sentAt; break; }
    }
    known = h.length;
    const wsPositions = wsEvents.slice(wsBefore).filter((e) => e.message.positions).flatMap((e) => e.message.positions.map((p) => ({ afterMs: e.at - sentAt, fixTime: p.fixTime })));
    matrix.push({ case: name, params, httpStatus: status, storedInHistory: restVisibleMs !== null, restVisibleAfterMs: restVisibleMs, pushedOnWebSocket: wsPositions.length > 0, wsFirstPushAfterMs: wsPositions[0]?.afterMs ?? null });
  }
  await sleep(1500);
  save('osmand-behaviour.json', matrix);
  const finalHistory = await history(dev.id);
  save('positions-history.json', finalHistory);
  save('positions-latest.json', (await api('GET', '/api/positions')).body);
  save('device-after-positions.json', (await api('GET', `/api/devices?uniqueId=FIXTURE-1`)).body);
  report.notes.unknownDeviceOsmandStatus = await osmand({ id: 'NOT-REGISTERED', lat: 1, lon: 1, timestamp: nowSec() });
  report.notes.unknownDeviceWasAutoRegistered = ((await api('GET', '/api/devices?uniqueId=NOT-REGISTERED')).body ?? []).length > 0;

  // ---------------------------------------------------------------- commands
  save('commands-types.json', (await api('GET', `/api/commands/types?deviceId=${dev.id}`)).body);
  const sent = await api('POST', '/api/commands/send', { deviceId: dev.id, type: 'positionSingle', attributes: {} });
  report.notes.sendCommandToOsmandDevice = sent;
  for (const p of ['/api/commands/queue?deviceId=' + dev.id, '/api/commands?deviceId=' + dev.id, '/api/commands/send?deviceId=' + dev.id]) {
    const r = await api('GET', p);
    report.notes['GET ' + p] = { status: r.status, body: typeof r.body === 'string' ? r.body : JSON.stringify(r.body).slice(0, 300) };
  }

  // ---------------------------------------------------------------- geofence: WKT is latitude-first
  const gf = await api('POST', '/api/geofences', { name: 'fixture-circle', area: 'CIRCLE (-1.9500 30.0700, 200)' });
  save('geofence-created.json', gf.body);
  report.notes.geofenceCreateStatus = gf.status;
  report.notes.permissionsLinkStatus = (await api('POST', '/api/permissions', { deviceId: dev.id, geofenceId: gf.body.id })).status;
  // Events are only evaluated for positions that ADVANCE the latest fix, so use fresh (but not future) timestamps.
  const t1 = nowSec();
  await osmand({ id: 'FIXTURE-1', lat: -1.95, lon: 30.07, speed: 5, timestamp: t1 });        // inside (lat-first WKT)
  await sleep(500);
  await osmand({ id: 'FIXTURE-1', lat: -1.97, lon: 30.09, speed: 5, timestamp: t1 + 3 });    // outside
  await sleep(500);
  await osmand({ id: 'FIXTURE-1', lat: 30.07, lon: -1.95, speed: 5, timestamp: t1 + 6 });    // swapped control
  await sleep(5000);

  // ---------------------------------------------------------------- reports
  save('report-route.json', (await api('GET', `/api/reports/route?${RANGE(dev.id)}`)).body);
  save('report-trips.json', (await api('GET', `/api/reports/trips?${RANGE(dev.id)}`)).body);
  save('report-stops.json', (await api('GET', `/api/reports/stops?${RANGE(dev.id)}`)).body);
  save('report-summary.json', (await api('GET', `/api/reports/summary?${RANGE(dev.id)}`)).body);
  save('report-events.json', (await api('GET', `/api/reports/events?${RANGE(dev.id)}`)).body);

  ws.close();
  save('ws-messages.json', wsEvents.map((e) => e.message));

  await api('DELETE', `/api/geofences/${gf.body.id}`);
  await api('DELETE', `/api/devices/${dev.id}`);

  save('capture-report.json', report);
  console.log('Captured fixtures for Traccar', report.traccarVersion);
  console.table(matrix.map((m) => ({ case: m.case, http: m.httpStatus, stored: m.storedInHistory, restMs: m.restVisibleAfterMs, ws: m.pushedOnWebSocket, wsMs: m.wsFirstPushAfterMs })));
  console.log(JSON.stringify(report.notes, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
