import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { P, type AlertDto, type AlertRuleDto, type LiveLocationDto, type VehicleDeltaDto } from '@gps/shared';
import { useAuthStore } from '@/lib/auth-store';
import { MonitorPage } from './MonitorPage';

// A fake Socket.IO socket: the test plays the server by calling the handlers the page registered.
const socket = vi.hoisted(() => {
  const handlers = new Map<string, (payload?: unknown) => void>();
  const fake = {
    on: (event: string, handler: (payload?: unknown) => void) => {
      handlers.set(event, handler);
      return fake;
    },
    removeAllListeners: () => handlers.clear(),
    disconnect: () => undefined,
  };
  return { handlers, fake };
});
vi.mock('socket.io-client', () => ({ io: () => socket.fake }));

const serverSends = (event: string, payload?: unknown) => act(() => socket.handlers.get(event)?.(payload));

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const iso = (secAgo: number) => new Date(Date.now() - secAgo * 1000).toISOString();

const loc = (id: string, over: Partial<LiveLocationDto> = {}): LiveLocationDto => ({
  vehicleId: id, registrationNumber: `RW-${id}`, deviceId: `dev-${id}`, status: 'MOVING', latitude: -1.9441, longitude: 30.0619, speedKmh: 41.2, heading: 90, ignition: true,
  lastFixAt: iso(2), lastSeenAt: iso(2), lastFixInvalid: false, lastFixDelayed: false, simulated: true, ...over,
});
const delta = (id: string, over: Partial<VehicleDeltaDto> = {}): VehicleDeltaDto => {
  const { registrationNumber: _r, deviceId: _d, ...rest } = loc(id);
  return { ...rest, ...over };
};

interface World {
  vehicles: LiveLocationDto[];
  alerts: AlertDto[];
  rules: AlertRuleDto[];
  calls: string[];
}
function mockApi(world: World) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    world.calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.includes('/tracking/positions')) return res(200, { data: world.vehicles, meta: { page: 1, pageSize: 100, total: world.vehicles.length } });
    if (url.includes('/tracking/summary')) {
      const byStatus = { NO_DATA: 0, OFFLINE: 0, MOVING: 0, IDLING: 0, PARKED: 0, STATIONARY: 0 };
      for (const v of world.vehicles) byStatus[v.status]++;
      return res(200, { data: { total: world.vehicles.length, byStatus } });
    }
    if (url.includes('/tracking/status-config')) return res(200, { data: { thresholds: { offlineAfterSec: 600, movingSpeedKmh: 5, idleAfterSec: 180, parkedAfterSec: 300 } } });
    if (url.includes('/alert-rules')) return res(200, { data: world.rules });
    if (url.includes('/alerts')) return res(200, { data: world.alerts, meta: { page: 1, pageSize: 8, total: world.alerts.length } });
    if (url.includes('/organizations/')) return res(200, { data: { id: 'org-1', name: 'Demo', timezone: 'Africa/Kigali', currencyCode: 'RWF' } });
    return res(404, { code: 'NOT_FOUND', status: 404, title: 'x' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPage(world: Partial<World> = {}, permissions: string[] = [P.TRACKING_LIVE_VIEW, P.ALERTS_READ, P.ALERTS_ACKNOWLEDGE, P.ALERT_RULES_MANAGE]) {
  const w: World = { vehicles: [], alerts: [], rules: [], calls: [], ...world };
  mockApi(w);
  useAuthStore.setState({
    accessToken: 't',
    activeOrganizationId: 'org-1',
    status: 'authenticated',
    me: { user: { id: 'u', email: 'a@b.co', fullName: 'A B', locale: 'en', emailVerified: true, totpEnabled: false }, memberships: [], activeOrganizationId: 'org-1', permissions, entitlements: {} },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MonitorPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return w;
}

const rowOf = (reg: string) => screen.getByRole('row', { name: new RegExp(reg) });

beforeEach(() => {
  vi.unstubAllGlobals();
  socket.handlers.clear();
});

describe('MonitorPage', () => {
  it('says plainly when no vehicle has reported, and how to get data for a demo', async () => {
    renderPage();
    expect(await screen.findByText('No vehicle has reported yet')).toBeInTheDocument();
    expect(screen.getByText(/pnpm sim fleet/)).toBeInTheDocument();
    expect(screen.getByText(/Diagnostics for the position pipeline/)).toBeInTheDocument();
  });

  it('shows each vehicle with status text, Simulated badge, and unknown values as Unknown / a dash — never 0 or Off', async () => {
    renderPage({ vehicles: [loc('1'), loc('2', { ignition: null, speedKmh: null, latitude: null, longitude: null, lastFixAt: null, status: 'STATIONARY', simulated: false })] });
    const first = await screen.findByRole('row', { name: /RW-1/ });
    expect(within(first).getByText('Moving')).toBeInTheDocument();
    expect(within(first).getByText('Simulated')).toBeInTheDocument();
    expect(within(first).getByText('41.2')).toBeInTheDocument();
    expect(within(first).getByText('On')).toBeInTheDocument();

    const second = rowOf('RW-2');
    expect(within(second).getByText('Unknown')).toBeInTheDocument(); // ignition not reported
    expect(within(second).queryByText('Off')).not.toBeInTheDocument();
    expect(within(second).queryByText('Simulated')).not.toBeInTheDocument(); // a real device is not labelled simulated
    expect(within(second).getAllByText('—').length).toBeGreaterThanOrEqual(3); // speed, position, last fix
    expect(within(second).getByText('Stopped')).toBeInTheDocument();
  });

  it('updates a row live from a pushed delta, and ignores an older one that arrives late', async () => {
    renderPage({ vehicles: [loc('1', { lastSeenAt: iso(10), lastFixAt: iso(10) })] });
    await screen.findByRole('row', { name: /RW-1/ });

    await serverSends('vehicle:delta', { vehicles: [delta('1', { speedKmh: 63.5, status: 'MOVING', lastSeenAt: iso(1), lastFixAt: iso(1) })] });
    expect(within(rowOf('RW-1')).getByText('63.5')).toBeInTheDocument();

    await serverSends('vehicle:delta', { vehicles: [delta('1', { speedKmh: 12, lastSeenAt: iso(30), lastFixAt: iso(30) })] }); // arrives late
    expect(within(rowOf('RW-1')).getByText('63.5')).toBeInTheDocument();
    expect(within(rowOf('RW-1')).queryByText('12.0')).not.toBeInTheDocument();
  });

  it('records what arrives in the live feed and counts the messages', async () => {
    renderPage({ vehicles: [loc('1')] });
    await screen.findByRole('row', { name: /RW-1/ });
    await serverSends('connect');
    await serverSends('vehicle:delta', { vehicles: [delta('1', { speedKmh: 50, lastSeenAt: iso(0), lastFixAt: iso(0) })] });
    expect(await screen.findByText(/1 update: RW-1 moving 50 km\/h/)).toBeInTheDocument();
    expect(screen.getByText(/Live messages received: 1/)).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('asks for a fresh snapshot when a delta names a vehicle it does not know (deltas carry no registration number)', async () => {
    const world = renderPage({ vehicles: [loc('1')] });
    await screen.findByRole('row', { name: /RW-1/ });
    const before = world.calls.filter((c) => c.includes('/tracking/positions')).length;
    world.vehicles.push(loc('2'));
    await serverSends('vehicle:delta', { vehicles: [delta('2')] });
    await waitFor(() => expect(world.calls.filter((c) => c.includes('/tracking/positions')).length).toBeGreaterThan(before), { timeout: 4000 });
    expect(await screen.findByRole('row', { name: /RW-2/ })).toBeInTheDocument();
  });

  it('filters by status chip (counts come from the server summary) and by registration search', async () => {
    renderPage({ vehicles: [loc('1'), loc('2', { status: 'PARKED', speedKmh: 0 }), loc('3', { status: 'OFFLINE' })] });
    await screen.findByRole('row', { name: /RW-1/ });
    const parked = screen.getByRole('button', { name: /Parked/ });
    await waitFor(() => expect(within(parked).getByText('1')).toBeInTheDocument());

    await userEvent.click(parked);
    expect(screen.queryByRole('row', { name: /RW-1/ })).not.toBeInTheDocument();
    expect(rowOf('RW-2')).toBeInTheDocument();

    await userEvent.click(parked); // toggles off
    await userEvent.type(screen.getByLabelText('Search by registration number'), 'rw-3');
    expect(screen.queryByRole('row', { name: /RW-1/ })).not.toBeInTheDocument();
    expect(rowOf('RW-3')).toBeInTheDocument();
  });

  it('warns when the tracking engine is unavailable and when the server closes the live connection', async () => {
    renderPage({ vehicles: [loc('1')] });
    await screen.findByRole('row', { name: /RW-1/ });
    await serverSends('engine:status', { connected: false });
    expect(screen.getByText(/tracking engine is unavailable/i)).toBeInTheDocument();
    expect(screen.getByText('Tracking engine: unavailable')).toBeInTheDocument();

    await serverSends('disconnect', 'io server disconnect');
    expect(await screen.findByText(/live connection was closed by the server/i)).toBeInTheDocument();
  });

  it('shows alerts with their flags, explains an empty list, and offers demo rules only to someone who may manage rules', async () => {
    renderPage({
      alerts: [{ id: 'a1', vehicleId: '1', registrationNumber: 'RW-1', type: 'OVERSPEED', severity: 'WARNING', startedAt: iso(5), simulated: true, delayed: false, acknowledgedAt: null, latitude: null, longitude: null }],
      rules: [{ id: 'r1', type: 'OVERSPEED', params: { speedLimitKmh: 45 }, severity: 'WARNING', cooldownSeconds: 60, enabled: true, createdAt: iso(100) }],
      vehicles: [loc('1')],
    });
    expect(await screen.findByText(/Overspeed/, { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Acknowledge' })).toBeInTheDocument();
    expect(screen.getByText('Overspeed over 45 km/h')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add demo rules/ })).not.toBeInTheDocument(); // rules exist
  });

  it('with no rules, says nothing is alerted and creates the demo rules through the API on request', async () => {
    const world = renderPage({ vehicles: [loc('1')] });
    expect(await screen.findByText(/no alert rules, so no alerts are raised/i)).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /Add demo rules/ }));
    await waitFor(() => expect(world.calls.filter((c) => c.startsWith('POST') && c.includes('/alert-rules'))).toHaveLength(2));
  });

  it('a user without alert permission neither sees the alert sections nor triggers any alert request', async () => {
    const world = renderPage({ vehicles: [loc('1')] }, [P.TRACKING_LIVE_VIEW]);
    await screen.findByRole('row', { name: /RW-1/ });
    expect(screen.queryByText('Alert rules')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Alerts' })).not.toBeInTheDocument();
    expect(world.calls.some((c) => c.includes('/alerts') || c.includes('/alert-rules'))).toBe(false);
  });
});
