import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DashboardDto, DriverDto, VehicleDto } from '@gps/shared';
import { DashboardPage } from '@/features/organization/DashboardPage';
import { useAuthStore } from '@/lib/auth-store';
import { DriversPage } from './DriversPage';
import { VehicleDetailPage } from './VehicleDetailPage';
import { VehiclesPage } from './VehiclesPage';

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const meta = (n: number) => ({ page: 1, pageSize: 25, total: n });

const vehicle = (over: Partial<VehicleDto> = {}): VehicleDto => ({
  id: 'v1', registrationNumber: 'RAB 123 C', make: 'Toyota', model: 'Hiace', year: 2019, color: null, vehicleType: 'VAN', vin: null, fuelType: null, notes: null,
  insurance: { date: '2026-11-10', daysLeft: 8, status: 'EXPIRING_SOON' }, inspection: null, category: { id: 'c1', name: 'Delivery vans', color: null },
  driver: null, device: null, documentsCount: 0, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', ...over,
});
const driver = (over: Partial<DriverDto> = {}): DriverDto => ({
  id: 'd1', fullName: 'Eric Nshuti', phone: '+250788123456', email: null, licenseNumber: 'LIC-1', licenseClass: 'B', license: { date: '2026-10-01', daysLeft: -32, status: 'EXPIRED' },
  status: 'ACTIVE', notes: null, vehicle: null, createdAt: '2026-11-01T00:00:00Z', ...over,
});
const dashboard = (over: Partial<DashboardDto> = {}): DashboardDto => ({
  generatedAt: '2026-11-02T10:00:00Z',
  vehicles: { total: 3, withDevice: 1, withoutDevice: 2, withDriver: 1, withoutDriver: 2, byCategory: [{ id: null, name: 'No category', count: 3 }] },
  drivers: { total: 2, active: 2, assigned: 1, unassigned: 1 },
  devices: { total: 1, byLifecycle: {}, installed: 1, notInstalled: 0, installedNeverReported: 0 },
  status: { total: 3, byStatus: { MOVING: 2, IDLING: 0, PARKED: 0, STATIONARY: 0, OFFLINE: 1, NO_DATA: 0 } },
  alerts: { unacknowledged: 4, recent: [{ id: 'a1', vehicleId: 'v1', registrationNumber: 'RAB 123 C', type: 'OVERSPEED', severity: 'WARNING', startedAt: '2026-11-02T08:00:00Z', simulated: true, delayed: false, acknowledgedAt: null, latitude: null, longitude: null }] },
  attention: [{ kind: 'VEHICLE_INSURANCE', severity: 'EXPIRED', subject: { type: 'vehicle', id: 'v1', label: 'RAB 123 C' }, title: 'Insurance', date: '2026-10-30', daysLeft: -3 }],
  attentionTotal: 1,
  ...over,
});

function signIn(permissions: string[], orgId = 'org-1') {
  useAuthStore.setState({
    accessToken: 't',
    activeOrganizationId: orgId,
    status: 'authenticated',
    me: {
      user: { id: 'u', email: 'u@x.co', fullName: 'U', locale: 'en', emailVerified: true, totpEnabled: false },
      memberships: [{ organization: { id: orgId, name: `Org ${orgId}`, type: 'CUSTOMER', timezone: 'Africa/Kigali', currencyCode: 'RWF' }, roleKeys: ['FLEET_MANAGER'], status: 'ACTIVE' }],
      activeOrganizationId: orgId,
      permissions,
      entitlements: {},
    } as never,
  });
}

function mockApi(routes: Record<string, () => Response>) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (input: string) => {
    calls.push(String(input));
    for (const [prefix, handler] of Object.entries(routes)) if (String(input).includes(prefix)) return handler();
    return res(404, { code: 'NOT_FOUND', status: 404, title: 'x' });
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

function page(ui: React.ReactElement, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="/app/vehicles/:vehicleId" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.unstubAllGlobals());

describe('Dashboard', () => {
  it('shows only the numbers the API returned, in words, with an attention list', async () => {
    signIn(['vehicles.read', 'drivers.read', 'devices.read', 'alerts.read']);
    mockApi({ '/dashboard': () => res(200, { data: dashboard() }), '/organizations/': () => res(200, { data: { name: 'Org', timezone: 'Africa/Kigali', currencyCode: 'RWF' } }) });
    page(<DashboardPage />);
    expect(await screen.findByText('Needs attention')).toBeInTheDocument();
    expect(screen.getByText('1 with a tracker')).toBeInTheDocument();
    expect(screen.getByText('2 without')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument(); // unacknowledged alerts
    // Live status uses the map's labels; the latest alert names its vehicle and is marked simulated.
    expect(screen.getByText('Vehicle status now')).toBeInTheDocument();
    expect(screen.getByText('Moving')).toBeInTheDocument();
    const alerts = within(screen.getByRole('list', { name: 'Latest alerts' }));
    expect(alerts.getByText('RAB 123 C')).toBeInTheDocument();
    expect(alerts.getByText('Simulated')).toBeInTheDocument();
    expect(alerts.getByText(/Overspeed/)).toBeInTheDocument();
    const link = within(screen.getByText('Needs attention').closest('div[class*="rounded-lg"]') as HTMLElement).getByRole('link', { name: 'RAB 123 C' });
    expect(link).toHaveAttribute('href', '/app/vehicles/v1');
    expect(screen.getByText('Expired 3 days ago')).toBeInTheDocument();
    // What does not exist yet is said plainly, not faked.
    expect(screen.getByText('Not available yet')).toBeInTheDocument();
  });

  it('an empty fleet gets an explanation and a way forward, not zeros dressed as results', async () => {
    signIn(['vehicles.read', 'vehicles.create']);
    mockApi({
      '/dashboard': () => res(200, { data: dashboard({ vehicles: { total: 0, withDevice: 0, withoutDevice: 0, withDriver: 0, withoutDriver: 0, byCategory: [] }, drivers: null, devices: null, status: null, alerts: null, attention: [], attentionTotal: 0 }) }),
      '/organizations/': () => res(200, { data: { name: 'Org', timezone: 'Africa/Kigali', currencyCode: 'RWF' } }),
    });
    page(<DashboardPage />);
    expect(await screen.findByText('Your fleet is empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add your first vehicle' })).toBeInTheDocument();
    expect(screen.queryByText('Alerts')).not.toBeInTheDocument();
  });

  it('leaves out sections the user may not read, and says so when nothing needs attention', async () => {
    signIn(['vehicles.read']);
    mockApi({
      '/dashboard': () => res(200, { data: dashboard({ drivers: null, devices: null, status: null, alerts: null, attention: [], attentionTotal: 0 }) }),
      '/organizations/': () => res(200, { data: { name: 'Org', timezone: 'Africa/Kigali', currencyCode: 'RWF' } }),
    });
    page(<DashboardPage />);
    expect(await screen.findByText('Nothing needs attention')).toBeInTheDocument();
    expect(screen.queryByText('Drivers')).not.toBeInTheDocument();
    expect(screen.queryByText('Trackers')).not.toBeInTheDocument();
    expect(screen.queryByText('Alerts')).not.toBeInTheDocument();
  });

  it('a role without vehicle access gets an explanation and makes no dashboard request', async () => {
    signIn(['organization.read']);
    const calls = mockApi({ '/organizations/': () => res(200, { data: { name: 'Org', timezone: 'Africa/Kigali', currencyCode: 'RWF' } }) });
    page(<DashboardPage />);
    expect(await screen.findByText('Your role cannot see fleet numbers')).toBeInTheDocument();
    expect(calls.some((c) => c.includes('/dashboard'))).toBe(false);
  });

  it('shows a plain-language error with retry when the dashboard fails', async () => {
    signIn(['vehicles.read']);
    mockApi({ '/dashboard': () => res(403, { code: 'PERMISSION_DENIED', status: 403, title: 'x' }), '/organizations/': () => res(200, { data: { name: 'Org', timezone: 'Africa/Kigali', currencyCode: 'RWF' } }) });
    page(<DashboardPage />);
    expect(await screen.findByText(/do not have permission/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('Vehicles list', () => {
  const routes = (list: VehicleDto[] = [vehicle()]) => ({
    '/vehicle-categories': () => res(200, { data: [{ id: 'c1', name: 'Delivery vans', color: null, vehicleCount: 1 }] }),
    '/vehicles': () => res(200, { data: list, meta: meta(list.length) }),
  });

  it('lists vehicles with unknowns shown as dashes or "None", and expiry as words', async () => {
    signIn(['vehicles.read']);
    mockApi(routes());
    page(<VehiclesPage />);
    expect(await screen.findByRole('link', { name: 'RAB 123 C' })).toHaveAttribute('href', '/app/vehicles/v1');
    expect(screen.getByText('Toyota Hiace · 2019')).toBeInTheDocument();
    expect(screen.getByText('Expires in 8 days')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument(); // inspection unknown, not "OK"
    expect(screen.getAllByText('None')).toHaveLength(2); // no driver, no tracker
  });

  it('marks simulated trackers', async () => {
    signIn(['vehicles.read']);
    mockApi(routes([vehicle({ device: { id: 'dev', uniqueId: 'SIM-0001', since: '2026-11-01T00:00:00Z' } })]));
    page(<VehiclesPage />);
    expect(await screen.findByText('Simulated')).toBeInTheDocument();
  });

  it('hides Add vehicle and category management from a read-only user', async () => {
    signIn(['vehicles.read']);
    mockApi(routes());
    page(<VehiclesPage />);
    await screen.findByRole('link', { name: 'RAB 123 C' });
    expect(screen.queryByRole('button', { name: /add vehicle/i })).not.toBeInTheDocument();
    // Categories exist, so a viewer may look at them, but cannot add or delete.
    await userEvent.click(await screen.findByRole('button', { name: /categories/i }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('Delivery vans')).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: /delete delivery vans/i })).not.toBeInTheDocument();
  });

  it('a manager sees the actions, and the first-vehicle prompt when the fleet is empty', async () => {
    signIn(['vehicles.read', 'vehicles.create', 'vehicles.categories.manage']);
    mockApi(routes([]));
    page(<VehiclesPage />);
    expect(await screen.findByText('No vehicles yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add your first vehicle/i })).toBeInTheDocument();
  });

  it('sends search and filters to the server (no client-side filtering of a partial page)', async () => {
    signIn(['vehicles.read']);
    const calls = mockApi(routes());
    page(<VehiclesPage />);
    await screen.findByRole('link', { name: 'RAB 123 C' });
    await userEvent.selectOptions(screen.getByLabelText('Tracker'), 'false');
    await userEvent.type(screen.getByLabelText('Search vehicles'), 'hiace');
    await waitFor(() => expect(calls.some((c) => c.includes('hasDevice=false') && c.includes('q=hiace'))).toBe(true));
  });

  it('says when filters match nothing and offers to clear them', async () => {
    signIn(['vehicles.read']);
    mockApi(routes([]));
    page(<VehiclesPage />);
    await userEvent.type(await screen.findByLabelText('Search vehicles'), 'zzz');
    expect(await screen.findByText('No vehicles match')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('forgets the previous organization when the active organization changes', async () => {
    signIn(['vehicles.read'], 'org-1');
    let current = [vehicle({ id: 'a', registrationNumber: 'ORG-ONE-CAR' })];
    mockApi({ ...routes(), '/vehicles': () => res(200, { data: current, meta: meta(1) }) });
    page(<VehiclesPage />);
    expect(await screen.findByText('ORG-ONE-CAR')).toBeInTheDocument();
    current = [vehicle({ id: 'b', registrationNumber: 'ORG-TWO-CAR' })];
    act(() => signIn(['vehicles.read'], 'org-2'));
    expect(await screen.findByText('ORG-TWO-CAR')).toBeInTheDocument();
    expect(screen.queryByText('ORG-ONE-CAR')).not.toBeInTheDocument();
  });
});

describe('Vehicle detail', () => {
  const base = (v: VehicleDto) => ({
    '/vehicle-categories': () => res(200, { data: [] }),
    '/driver-history': () => res(200, { data: [] }),
    '/documents': () => res(200, { data: [] }),
    '/drivers': () => res(200, { data: [], meta: meta(0) }),
    '/vehicles/v1': () => res(200, { data: v }),
  });

  it('says the driver is ASSIGNED, never that they are driving, and shows the history', async () => {
    signIn(['vehicles.read', 'drivers.read', 'drivers.manage']);
    mockApi({
      ...base(vehicle({ driver: { id: 'd1', fullName: 'Eric Nshuti', since: '2026-11-01T08:00:00Z' } })),
      '/driver-history': () => res(200, { data: [{ id: 'h1', driver: { id: 'd0', fullName: 'Old Driver' }, assignedAt: '2026-10-01T08:00:00Z', unassignedAt: '2026-10-30T08:00:00Z', reason: 'Left the company' }] }),
    });
    page(<VehicleDetailPage />, '/app/vehicles/v1');
    expect(await screen.findByText('Assigned driver')).toBeInTheDocument();
    expect(screen.getByText(/not a statement about who is driving right now/i)).toBeInTheDocument();
    expect(await screen.findByText('Old Driver')).toBeInTheDocument();
    expect(screen.getByText('Left the company')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unassign driver' })).toBeInTheDocument();
    // The only wording about driving is the disclaimer; nothing claims the assigned person is at the wheel.
    expect(screen.queryByText(/currently driving|driving now|is at the wheel/i)).not.toBeInTheDocument();
  });

  it('offers only unassigned active drivers, and none of the controls to a read-only user', async () => {
    signIn(['vehicles.read', 'drivers.read']);
    const calls = mockApi(base(vehicle()));
    page(<VehicleDetailPage />, '/app/vehicles/v1');
    expect(await screen.findByText('No driver is assigned to this vehicle.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    expect(calls.some((c) => c.includes('status=ACTIVE&assigned=false'))).toBe(false); // a viewer does not even ask
  });

  it('a manager chooses from active unassigned drivers only', async () => {
    signIn(['vehicles.read', 'drivers.read', 'drivers.manage']);
    const calls = mockApi({ ...base(vehicle()), '/drivers': () => res(200, { data: [driver({ license: null })], meta: meta(1) }) });
    page(<VehicleDetailPage />, '/app/vehicles/v1');
    const select = await screen.findByLabelText(/No driver assigned/i);
    await waitFor(() => expect(within(select).getByRole('option', { name: 'Eric Nshuti' })).toBeInTheDocument());
    expect(calls.some((c) => c.includes('status=ACTIVE') && c.includes('assigned=false'))).toBe(true);
  });

  it('shows an explanation, not a blank page, when the vehicle belongs to another organization', async () => {
    signIn(['vehicles.read']);
    mockApi({ ...base(vehicle()), '/vehicles/v1': () => res(404, { code: 'VEHICLE_NOT_FOUND', status: 404, title: 'x' }) });
    page(<VehicleDetailPage />, '/app/vehicles/v1');
    expect(await screen.findByText('Vehicle not found')).toBeInTheDocument();
  });

  it('shows unknown details as dashes and "Unknown" rather than defaults', async () => {
    signIn(['vehicles.read']);
    mockApi(base(vehicle({ make: null, model: null, year: null, vehicleType: null, fuelType: null, insurance: null })));
    page(<VehicleDetailPage />, '/app/vehicles/v1');
    expect(await screen.findByText('Details')).toBeInTheDocument();
    expect(screen.getAllByText('Unknown').length).toBeGreaterThanOrEqual(2); // type and fuel
    expect(screen.getByText('No tracker is installed on this vehicle.')).toBeInTheDocument();
  });
});

describe('Drivers list', () => {
  it('shows licence validity in words and the assigned vehicle as a link', async () => {
    signIn(['drivers.read']);
    mockApi({ '/drivers': () => res(200, { data: [driver({ vehicle: { id: 'v1', registrationNumber: 'RAB 123 C', since: '2026-11-01T00:00:00Z' } })], meta: meta(1) }) });
    page(<DriversPage />);
    expect(await screen.findByText('Eric Nshuti')).toBeInTheDocument();
    expect(screen.getByText('Expired 32 days ago')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'RAB 123 C' })).toHaveAttribute('href', '/app/vehicles/v1');
    expect(screen.queryByRole('button', { name: /add driver/i })).not.toBeInTheDocument();
  });
});
