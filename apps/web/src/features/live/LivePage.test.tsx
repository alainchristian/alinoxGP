import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { P, type AlertDto, type LiveLocationDto, type MapConfigDto, type VehicleDeltaDto } from '@gps/shared';
import { useAuthStore } from '@/lib/auth-store';
import type { LiveMapProps } from './LiveMap';
import { LivePage } from './LivePage';

// jsdom has no WebGL: the map is replaced by a stand-in that exposes what the page hands to it and lets a test "click" a vehicle.
vi.mock('./LiveMap', () => ({
  LiveMap: (p: LiveMapProps) => (
    <div data-testid="map" data-vehicles={p.features.features.length} data-selected={p.selectedId ?? ''} data-selected-feature={p.selectedFeature ? 'yes' : 'no'} data-follow={String(p.follow)}>
      {[...p.features.features, ...(p.selectedFeature ? [p.selectedFeature] : [])].map((f) => (
        <button key={f.properties.id} onClick={() => p.onSelect(f.properties.id)}>
          map:{f.properties.reg}
        </button>
      ))}
      <button onClick={() => p.onSelect(null)}>map:background</button>
    </div>
  ),
}));

// jsdom has no layout, so the real virtualizer sees a zero-height list and renders nothing. This stand-in renders every row; the real
// virtualization (only visible rows in the DOM) is verified in a browser with a large fleet.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count, estimateSize }: { count: number; estimateSize: () => number }) => ({
    getTotalSize: () => count * estimateSize(),
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * estimateSize(), size: estimateSize() })),
  }),
}));

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
  vehicleId: id, registrationNumber: `RW-${id}`, deviceId: `device-${id}-xxxxxxxx`, status: 'MOVING', latitude: -1.9441, longitude: 30.0619, speedKmh: 41.2, heading: 90, ignition: true,
  lastFixAt: iso(2), lastSeenAt: iso(2), lastFixInvalid: false, lastFixDelayed: false, simulated: true, ...over,
});
const delta = (id: string, over: Partial<VehicleDeltaDto> = {}): VehicleDeltaDto => {
  const { registrationNumber: _r, deviceId: _d, ...rest } = loc(id);
  return { ...rest, ...over };
};
const devMap: MapConfigDto = { provider: 'dev-osm', devOnly: true, attribution: '© OpenStreetMap contributors', tiles: ['https://t/{z}/{x}/{y}.png'], tileSize: 256, maxZoom: 19, styles: { streets: null, satellite: null }, accessToken: null, notice: 'dev' };
const alert = (vehicleId: string, over: Partial<AlertDto> = {}): AlertDto => ({
  id: `a-${vehicleId}`, vehicleId, registrationNumber: `RW-${vehicleId}`, type: 'OVERSPEED', severity: 'WARNING', startedAt: iso(30), simulated: true, delayed: false, acknowledgedAt: null, latitude: null, longitude: null, ...over,
});

interface World {
  /** Vehicles per organization: the API answers according to the X-Organization-Id header, like the real one. */
  vehicles: Record<string, LiveLocationDto[]>;
  alerts: AlertDto[];
  map: MapConfigDto | 'error';
  calls: string[];
}
function mockApi(w: World) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      w.calls.push(url);
      const org = (init?.headers as Record<string, string> | undefined)?.['X-Organization-Id'] ?? 'none';
      const vehicles = w.vehicles[org] ?? [];
      if (url.includes('/tracking/snapshot')) return res(200, { data: { vehicles, total: vehicles.length, truncated: false } });
      if (url.includes('/tracking/positions')) return res(200, { data: vehicles, meta: { page: 1, pageSize: 100, total: vehicles.length } });
      if (url.includes('/tracking/summary')) {
        const byStatus = { NO_DATA: 0, OFFLINE: 0, MOVING: 0, IDLING: 0, PARKED: 0, STATIONARY: 0 };
        for (const v of vehicles) byStatus[v.status]++;
        return res(200, { data: { total: vehicles.length, byStatus } });
      }
      if (url.includes('/tracking/status-config')) return res(200, { data: { thresholds: { offlineAfterSec: 600, movingSpeedKmh: 5, idleAfterSec: 180, parkedAfterSec: 300 } } });
      if (url.includes('/maps/config')) return w.map === 'error' ? res(500, { code: 'X', status: 500, title: 'x' }) : res(200, { data: w.map });
      if (url.includes('/alerts')) return res(200, { data: w.alerts, meta: { page: 1, pageSize: 50, total: w.alerts.length } });
      if (url.includes('/organizations/')) return res(200, { data: { id: org, name: org, timezone: 'Africa/Kigali', currencyCode: 'RWF' } });
      return res(404, { code: 'NOT_FOUND', status: 404, title: 'x' });
    }),
  );
}

function signIn(orgId: string, permissions: string[]) {
  useAuthStore.setState({
    accessToken: 't',
    activeOrganizationId: orgId,
    status: 'authenticated',
    me: { user: { id: 'u', email: 'a@b.co', fullName: 'A B', locale: 'en', emailVerified: true, totpEnabled: false }, memberships: [], activeOrganizationId: orgId, permissions, entitlements: {} },
  });
}
function renderPage(partial: Partial<World> = {}, permissions: string[] = [P.TRACKING_LIVE_VIEW, P.ALERTS_READ]) {
  const w: World = { vehicles: { 'org-1': [] }, alerts: [], map: devMap, calls: [], ...partial };
  mockApi(w);
  signIn('org-1', permissions);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LivePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return w;
}
const list = () => screen.getByRole('list', { name: 'Vehicle list' });
const item = async (reg: string) => within(await screen.findByRole('list', { name: 'Vehicle list' })).findByRole('button', { name: new RegExp(reg) });

beforeEach(() => {
  vi.unstubAllGlobals();
  socket.handlers.clear();
});

describe('LivePage', () => {
  it('lists vehicles with status text, Simulated and Alert badges, and draws only those with a position on the map', async () => {
    renderPage({
      vehicles: { 'org-1': [loc('1'), loc('2', { latitude: null, longitude: null, lastFixAt: null, status: 'STATIONARY', simulated: false })] },
      alerts: [alert('1')],
    });
    const first = await item('RW-1');
    expect(within(first).getByText('Moving')).toBeInTheDocument();
    expect(within(first).getByText('Simulated')).toBeInTheDocument();
    await waitFor(() => expect(within(first).getByText('Alert')).toBeInTheDocument());
    const second = await item('RW-2');
    expect(within(second).getByText('no position')).toBeInTheDocument();
    expect(within(second).queryByText('Simulated')).not.toBeInTheDocument();

    expect(screen.getByTestId('map')).toHaveAttribute('data-vehicles', '1'); // RW-2 has no position: not drawn, and never at 0,0
    expect(screen.getByText('1 vehicle has no known position and is not on the map.')).toBeInTheDocument();
  });

  it('opens the details of a vehicle picked in the list, with unknown values shown as unknown, and closes them again', async () => {
    renderPage({ vehicles: { 'org-1': [loc('1', { ignition: null, heading: null, speedKmh: null })] } });
    await userEvent.click(await item('RW-1'));
    const panel = await screen.findByRole('complementary', { name: 'Selected vehicle' });
    expect(within(panel).getByText('RW-1')).toBeInTheDocument();
    expect(within(panel).getByText('Unknown')).toBeInTheDocument(); // ignition not reported
    expect(within(panel).queryByText('Off')).not.toBeInTheDocument();
    expect(within(panel).getAllByText('—').length).toBeGreaterThanOrEqual(2); // speed and heading
    expect(within(panel).getByText('Not available')).toBeInTheDocument(); // address: honest, not invented
    expect(within(panel).getByText('Simulated')).toBeInTheDocument();

    await userEvent.click(within(panel).getByRole('button', { name: 'Close vehicle details' }));
    expect(screen.queryByRole('complementary', { name: 'Selected vehicle' })).not.toBeInTheDocument();
  });

  it('selecting a vehicle on the map shows the same details, and takes it out of the clustered set (it is drawn on its own)', async () => {
    renderPage({ vehicles: { 'org-1': [loc('1'), loc('2')] } });
    await item('RW-2');
    const map = screen.getByTestId('map');
    await waitFor(() => expect(map).toHaveAttribute('data-vehicles', '2'));

    await userEvent.click(within(map).getByRole('button', { name: 'map:RW-2' }));
    expect(await screen.findByRole('complementary', { name: 'Selected vehicle' })).toBeInTheDocument();
    expect(map).toHaveAttribute('data-selected-feature', 'yes');
    expect(map).toHaveAttribute('data-vehicles', '1'); // only RW-1 stays in the clustered set

    await userEvent.click(within(map).getByRole('button', { name: 'map:background' })); // clicking empty map deselects
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'Selected vehicle' })).not.toBeInTheDocument());
    expect(map).toHaveAttribute('data-vehicles', '2');
  });

  it('follow mode is available only for a vehicle with a position, and turns off when the selection changes', async () => {
    renderPage({ vehicles: { 'org-1': [loc('1'), loc('2', { latitude: null, longitude: null, lastFixAt: null })] } });
    await userEvent.click(await item('RW-2'));
    const panel = await screen.findByRole('complementary', { name: 'Selected vehicle' });
    expect(within(panel).getByRole('button', { name: /Follow on map/ })).toBeDisabled(); // nothing to follow

    await userEvent.click(await item('RW-1'));
    const follow = within(await screen.findByRole('complementary', { name: 'Selected vehicle' })).getByRole('button', { name: /Follow on map/ });
    await userEvent.click(follow);
    expect(screen.getByTestId('map')).toHaveAttribute('data-follow', 'true');
    await userEvent.click(await item('RW-2'));
    expect(screen.getByTestId('map')).toHaveAttribute('data-follow', 'false');
  });

  it('merges pushed updates into the list and the map, and ignores an older message arriving late', async () => {
    renderPage({ vehicles: { 'org-1': [loc('1', { lastSeenAt: iso(10), lastFixAt: iso(10) })] } });
    const row = await item('RW-1');
    await serverSends('vehicle:delta', { vehicles: [delta('1', { speedKmh: 63.5, lastSeenAt: iso(1), lastFixAt: iso(1) })] });
    expect(within(row).getByText('63.5 km/h')).toBeInTheDocument();
    await serverSends('vehicle:delta', { vehicles: [delta('1', { speedKmh: 12, lastSeenAt: iso(30), lastFixAt: iso(30) })] });
    expect(within(row).getByText('63.5 km/h')).toBeInTheDocument();
  });

  it('filters by status (counts from the server) and by registration', async () => {
    renderPage({ vehicles: { 'org-1': [loc('1'), loc('2', { status: 'PARKED' }), loc('3', { status: 'OFFLINE' })] } });
    await item('RW-1');
    const parked = within(screen.getByRole('group', { name: 'Filter by status' })).getByRole('button', { name: /Parked/ });
    await waitFor(() => expect(within(parked).getByText('1')).toBeInTheDocument());
    await userEvent.click(parked);
    expect(within(list()).queryByRole('button', { name: /RW-1/ })).not.toBeInTheDocument();
    expect(within(list()).getByRole('button', { name: /RW-2/ })).toBeInTheDocument();
    await userEvent.click(parked);
    await userEvent.type(screen.getByLabelText('Search by registration number'), 'rw-3');
    expect(within(list()).getAllByRole('button')).toHaveLength(1);
  });

  it('says honestly what is wrong: engine unavailable, reconnecting, closed by the server; and when there is nothing to show', async () => {
    renderPage();
    expect(await screen.findByText('No vehicle has reported yet')).toBeInTheDocument();
    await serverSends('engine:status', { connected: false });
    expect(screen.getByText(/tracking engine is unavailable/i)).toBeInTheDocument();
    await serverSends('disconnect', 'transport close');
    expect(await screen.findByText(/paused while reconnecting/i)).toBeInTheDocument();
    await serverSends('disconnect', 'io server disconnect');
    expect(await screen.findByText(/closed by the server/i)).toBeInTheDocument();
  });

  it('labels the development map as such', async () => {
    renderPage({ vehicles: { 'org-1': [loc('1')] } });
    expect(await screen.findByText('Development map')).toBeInTheDocument();
    expect(await item('RW-1')).toBeInTheDocument();
  });

  it('a build that cannot draw the configured provider says so — and the vehicle list still works', async () => {
    renderPage({ vehicles: { 'org-1': [loc('1')] }, map: { ...devMap, provider: 'mapbox', devOnly: false, tiles: null, accessToken: 'pk.x' } });
    expect(await screen.findByText('This build cannot draw the configured map')).toBeInTheDocument();
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    expect(await item('RW-1')).toBeInTheDocument();
  });

  it('an unreachable map configuration is reported, and the vehicle list still works', async () => {
    renderPage({ vehicles: { 'org-1': [loc('1')] }, map: 'error' });
    expect(await screen.findByText('The map is unavailable')).toBeInTheDocument();
    expect(await item('RW-1')).toBeInTheDocument();
  });

  it('without alert permission the page neither asks for alerts nor shows any alert badge', async () => {
    const w = renderPage({ vehicles: { 'org-1': [loc('1')] }, alerts: [alert('1')] }, [P.TRACKING_LIVE_VIEW]);
    const row = await item('RW-1');
    expect(within(row).queryByText('Alert')).not.toBeInTheDocument();
    expect(w.calls.some((c) => c.includes('/alerts'))).toBe(false);
  });

  it('TENANT ISOLATION: switching organization removes the previous organization’s vehicles at once and shows only the new one', async () => {
    const w = renderPage({ vehicles: { 'org-1': [loc('a1', { registrationNumber: 'ORG1-ONLY' })], 'org-2': [loc('b1', { registrationNumber: 'ORG2-ONLY' })] } });
    await item('ORG1-ONLY');
    await userEvent.click(await item('ORG1-ONLY'));
    expect(await screen.findByRole('complementary', { name: 'Selected vehicle' })).toBeInTheDocument();

    act(() => signIn('org-2', [P.TRACKING_LIVE_VIEW, P.ALERTS_READ])); // the user switches organization
    await item('ORG2-ONLY');
    expect(screen.queryByText('ORG1-ONLY')).not.toBeInTheDocument(); // nothing of org 1 lingers (list, details, map)
    expect(screen.queryByRole('complementary', { name: 'Selected vehicle' })).not.toBeInTheDocument(); // the old selection is gone
    expect(screen.getByTestId('map')).toHaveAttribute('data-vehicles', '1');
    expect(w.calls.length).toBeGreaterThan(0);
  });
});
