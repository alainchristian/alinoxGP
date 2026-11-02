import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAPABILITY_KEYS, type CatalogueModelDto, type DeviceCapabilitiesDto, type DeviceDiagnosticsDto, type DeviceDto } from '@gps/shared';
import { AdminDeviceDetailPage } from '@/features/admin/AdminDevicesPage';
import { CataloguePage } from '@/features/admin/CataloguePage';
import { useAuthStore } from '@/lib/auth-store';
import { AddDevicePage } from './AddDevicePage';
import { DeviceDetailPage } from './DeviceDetailPage';
import { DevicesPage } from './DevicesPage';

const res = (status: number, body?: unknown) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const meta = (n: number) => ({ page: 1, pageSize: 100, total: n });

const device = (over: Partial<DeviceDto> = {}): DeviceDto => ({
  id: 'd1', uniqueId: '490154203237518', name: null, lifecycleStatus: 'AWAITING_CONFIGURATION', engineSyncStatus: 'SYNCED', isSimulated: false, firstSignalAt: null, lastSeenAt: null,
  createdAt: '2026-11-02T08:00:00Z', assignment: null, variant: { id: 'var1', label: 'Acme T100 rev A', isSimulatorProfile: false }, firmwareVersion: null, serialNumber: null, simIccid: null,
  connectivity: 'NEVER_CONNECTED', displayStatus: 'Awaiting configuration', ...over,
});
const model = (over: Partial<CatalogueModelDto> = {}): CatalogueModelDto => ({
  id: 'm1', manufacturer: { id: 'mk', name: 'Acme' }, name: 'T100', protocol: 'acme', enginePort: 5027, networkTechnologies: [], identifierType: 'IMEI', reportingNotes: null, configurationNotes: null,
  installationRequirements: null, knownLimitations: null, docsUrl: null, isListed: true, isSimulatorProfile: false,
  variants: [{ id: 'var1', hardwareRevision: 'A', firmwareMin: null, firmwareMax: null, compatibilityStatus: 'SUPPORTED_UNVERIFIED', lastTestedAt: null, notes: null, capabilities: [], verifications: [] }], ...over,
});
const caps = (over: Partial<Record<string, { state: string; reason: string; observed?: string }>> = {}): DeviceCapabilitiesDto => ({
  deviceId: 'd1',
  variant: { id: 'var1', label: 'Acme T100 rev A', compatibilityStatus: 'SUPPORTED_UNVERIFIED', isSimulatorProfile: false },
  computedAt: '2026-11-02T10:00:00Z',
  capabilities: CAPABILITY_KEYS.map((key) => ({ key, state: 'UNKNOWN', observed: 'NOT_OBSERVABLE', reason: 'The catalogue has no information about this for the model.', ...(over[key] ?? {}) })) as DeviceCapabilitiesDto['capabilities'],
});

function signIn(permissions: string[], orgId = 'org-1', type: 'CUSTOMER' | 'PLATFORM' = 'CUSTOMER') {
  useAuthStore.setState({
    accessToken: 't', activeOrganizationId: orgId, status: 'authenticated',
    me: {
      user: { id: 'u', email: 'u@x.co', fullName: 'U', locale: 'en', emailVerified: true, totpEnabled: false },
      memberships: [{ organization: { id: orgId, name: `Org ${orgId}`, type, timezone: 'Africa/Kigali', currencyCode: 'RWF' }, roleKeys: ['ORG_OWNER'], status: 'ACTIVE' }],
      activeOrganizationId: orgId, permissions, entitlements: {},
    } as never,
  });
}

interface Call { url: string; method: string; body: unknown }
function mockApi(routes: Record<string, (c: Call) => Response>) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const call: Call = { url: String(input), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    // longest matching prefix wins, so '/devices/d1/capabilities' beats '/devices/d1'
    const hit = Object.keys(routes).filter((p) => call.url.includes(p)).sort((a, b) => b.length - a.length)[0];
    return hit ? routes[hit]!(call) : res(404, { code: 'NOT_FOUND', status: 404, title: 'x' });
  }));
  return calls;
}

function page(ui: React.ReactElement, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={ui} />
          <Route path="/app/devices/new" element={ui} />
          <Route path="/app/devices/:deviceId" element={ui} />
          <Route path="/admin/devices/:deviceId" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => vi.unstubAllGlobals());

describe('Devices list', () => {
  it('shows status in the spec wording, unknown model honestly, simulated badge and installed vehicle', async () => {
    signIn(['devices.read']);
    mockApi({
      '/devices': () => res(200, { data: [
        device({ id: 'a', name: 'Truck 1', displayStatus: 'Online', lifecycleStatus: 'ACTIVE', connectivity: 'ONLINE', lastSeenAt: new Date().toISOString(), assignment: { vehicleId: 'v9', registrationNumber: 'RAB 9 C', since: '2026-11-01T00:00:00Z' } }),
        device({ id: 'b', uniqueId: 'SIM-0001', isSimulated: true, variant: null, displayStatus: 'Registered', lifecycleStatus: 'REGISTERED' }),
      ], meta: meta(2) }),
    });
    page(<DevicesPage />);
    expect(await screen.findByText('Truck 1')).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'RAB 9 C' })).toHaveAttribute('href', '/app/vehicles/v9');
    expect(screen.getByText('Not identified')).toBeInTheDocument();
    expect(screen.getByText('Simulated')).toBeInTheDocument();
    expect(screen.getByText('Registered')).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument();
  });

  it('hides Add device from a viewer and explains the empty state; offers it to someone who may register', async () => {
    signIn(['devices.read']);
    mockApi({ '/devices': () => res(200, { data: [], meta: meta(0) }) });
    const { unmount } = page(<DevicesPage />);
    expect(await screen.findByText('No devices yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add/i })).not.toBeInTheDocument();
    unmount();
    signIn(['devices.read', 'devices.register']);
    page(<DevicesPage />);
    expect(await screen.findByRole('button', { name: /add your first device/i })).toBeInTheDocument();
  });
});

describe('Add device', () => {
  const notice = { id: 'n1', kind: 'TRACKING_NOTICE', version: 1, title: 'Vehicle tracking notice', body: 'You confirm you may track this vehicle.', isDraftWording: true };
  const routes = (extra: Record<string, (c: Call) => Response> = {}) => ({
    '/catalogue/models': () => res(200, { data: [model(), model({ id: 'sim', name: 'OsmAnd simulator profile', manufacturer: { id: 'ps', name: 'Platform simulator' }, isSimulatorProfile: true, identifierType: 'OTHER', variants: [{ ...model().variants[0]!, id: 'simvar', hardwareRevision: null }] })] }),
    '/consent/current': () => res(200, { data: notice }),
    ...extra,
  });

  it('lists catalogued models with the spec wording for their status, and warns that a simulator is not hardware', async () => {
    signIn(['devices.read', 'devices.register']);
    mockApi(routes());
    page(<AddDevicePage />, '/app/devices/new');
    expect(await screen.findByText('Acme T100')).toBeInTheDocument();
    expect(screen.getAllByText('Supported but not physically verified')).toHaveLength(2);
    expect(screen.getByText(/software simulator, not a physical device/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('checks the IMEI check digit before sending anything', async () => {
    signIn(['devices.read', 'devices.register']);
    const calls = mockApi(routes());
    page(<AddDevicePage />, '/app/devices/new');
    await userEvent.click(await screen.findByLabelText(/Acme T100/));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(await screen.findByLabelText('Device identifier'), '490154203237519');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Register device' }));
    expect(await screen.findByText(/not a valid IMEI/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/devices'))).toBe(false);
  });

  it('will not register until the tracking notice is acknowledged, and says its wording is a draft', async () => {
    signIn(['devices.read', 'devices.register']);
    const calls = mockApi(routes());
    page(<AddDevicePage />, '/app/devices/new');
    await userEvent.click(await screen.findByLabelText(/Acme T100/));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/Draft wording/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Device identifier'), '490154203237518');
    await userEvent.click(screen.getByRole('button', { name: 'Register device' }));
    expect(await screen.findByText(/tick the tracking notice/i)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('registers with the chosen model and the acknowledged notice, then opens the device', async () => {
    signIn(['devices.read', 'devices.register']);
    const calls = mockApi(routes({
      '/devices/d1': () => res(200, { data: device() }),
      '/devices': (c) => (c.method === 'POST' ? res(201, { data: device() }) : res(200, { data: [], meta: meta(0) })),
      '/devices/d1/configuration': () => res(200, { data: { deviceId: 'd1', identifier: '490154203237518', identifierType: 'IMEI', serverHost: 'gps.example.test', port: 5027, protocol: 'acme', notes: null, missing: [] } }),
      '/devices/d1/capabilities': () => res(200, { data: caps() }),
      '/devices/d1/history': () => res(200, { data: [] }),
    }));
    page(<AddDevicePage />, '/app/devices/new');
    await userEvent.click(await screen.findByLabelText(/Acme T100/));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(await screen.findByLabelText('Device identifier'), '490154203237518');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Register device' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/devices'))).toBe(true));
    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/devices'))!;
    expect(post.body).toMatchObject({ uniqueId: '490154203237518', variantId: 'var1', acknowledgedNoticeId: 'n1' });
    expect(JSON.stringify(post.body)).not.toMatch(/organizationId/);
  });

  it('a duplicate identifier gets a generic message that reveals nothing about another owner', async () => {
    signIn(['devices.read', 'devices.register']);
    mockApi(routes({ '/devices': (c) => (c.method === 'POST' ? res(409, { code: 'DEVICE_IDENTIFIER_UNAVAILABLE', status: 409, title: 'x' }) : res(200, { data: [], meta: meta(0) })) }));
    page(<AddDevicePage />, '/app/devices/new');
    await userEvent.click(await screen.findByLabelText(/I do not know the model/));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.type(await screen.findByLabelText('Device identifier'), 'ABC-123');
    await userEvent.click(screen.getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Register device' }));
    expect(await screen.findByText(/cannot be registered/i)).toBeInTheDocument();
  });

  it('"not listed" opens a support request instead of guessing', async () => {
    signIn(['devices.read', 'devices.register']);
    const calls = mockApi(routes({ '/device-support-requests': () => res(201, { data: { id: 'r1' } }) }));
    page(<AddDevicePage />, '/app/devices/new');
    await userEvent.click(await screen.findByRole('button', { name: /ask us to support your device/i }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Manufacturer'), 'Acme');
    await userEvent.type(dialog.getByLabelText('Model'), 'X9');
    await userEvent.click(dialog.getByRole('button', { name: 'Send request' }));
    expect(await dialog.findByText(/Request sent/)).toBeInTheDocument();
    expect(calls.find((c) => c.url.endsWith('/device-support-requests'))!.body).toMatchObject({ manufacturerText: 'Acme', modelText: 'X9' });
  });
});

describe('Device detail', () => {
  const base = (d: DeviceDto, capsOver: Parameters<typeof caps>[0] = {}) => ({
    '/devices/d1/configuration': () => res(200, { data: { deviceId: 'd1', identifier: d.uniqueId, identifierType: 'IMEI', serverHost: null, port: null, protocol: 'acme', notes: 'Set the server in the configurator.', missing: ['The platform GPS server address is not configured on this deployment yet.', 'The catalogue does not record the port this model connects to.'] } }),
    '/devices/d1/capabilities': () => res(200, { data: caps(capsOver) }),
    '/devices/d1/history': () => res(200, { data: [{ id: 'h1', fromStatus: null, toStatus: 'AWAITING_CONFIGURATION', reason: 'Device registered', byUser: true, at: '2026-11-02T08:00:00Z' }] }),
    '/vehicles': () => res(200, { data: [{ id: 'v1', registrationNumber: 'RAB 1 C' }], meta: meta(1) }),
    '/catalogue/models': () => res(200, { data: [model()] }),
    '/devices/d1': () => res(200, { data: d }),
  });

  it('shows setup instructions, says what it does not know, and lets the owner confirm', async () => {
    signIn(['devices.read', 'devices.register', 'devices.capabilities.read']);
    const calls = mockApi({ ...base(device()), '/devices/d1/configured': () => res(200, { data: device({ lifecycleStatus: 'AWAITING_FIRST_SIGNAL' }) }) });
    page(<DeviceDetailPage />, '/app/devices/d1');
    expect(await screen.findByText('Set up the device')).toBeInTheDocument();
    expect(await screen.findByText('Set the server in the configurator.')).toBeInTheDocument();
    expect(screen.getAllByText('Not available yet').length).toBeGreaterThanOrEqual(2); // server address and port are shown as unknown, not invented
    expect(screen.getByText(/We never guess these/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'I have configured the device' }));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/devices/d1/configured') && c.method === 'POST')).toBe(true));
  });

  it('while waiting for the first signal the page says it checks by itself', async () => {
    signIn(['devices.read', 'devices.capabilities.read']);
    mockApi(base(device({ lifecycleStatus: 'AWAITING_FIRST_SIGNAL', displayStatus: 'Awaiting first GPS signal' })));
    page(<DeviceDetailPage />, '/app/devices/d1');
    expect(await screen.findByText('Waiting for the first GPS signal')).toBeInTheDocument();
    expect(screen.getByText(/checks by itself/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been received from this device yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I have configured the device' })).not.toBeInTheDocument();
  });

  it('capabilities: unverified is never shown as verified, unknown stays unknown, immobilization is "Not enabled"', async () => {
    signIn(['devices.read', 'devices.capabilities.read']);
    mockApi(base(device({ lifecycleStatus: 'ACTIVE', displayStatus: 'Online', connectivity: 'ONLINE', lastSeenAt: new Date().toISOString() }), {
      gps_tracking: { state: 'SUPPORTED_UNVERIFIED', reason: 'Expected from the catalogue; the model has not been verified on physical hardware.', observed: 'SEEN' },
      speed_monitoring: { state: 'VERIFIED', reason: 'Verified for this model by a recorded test.', observed: 'SEEN' },
      ignition_detection: { state: 'REQUIRES_CONFIGURATION', reason: 'The device has reported, but has not delivered the data this needs.', observed: 'NOT_SEEN' },
      remote_immobilization: { state: 'DISABLED', reason: 'Switched off until a verified starter-circuit installation and a verified command path exist.' },
    }));
    page(<DeviceDetailPage />, '/app/devices/d1');
    const row = async (label: string) => within((await screen.findByText(label)).closest('tr') as HTMLElement);
    expect((await row('Live vehicle tracking')).getByText('Supported, not yet verified')).toBeInTheDocument();
    expect((await row('Speed monitoring')).getByText('Supported')).toBeInTheDocument();
    expect((await row('Ignition monitoring')).getByText('Needs setup')).toBeInTheDocument();
    expect((await row('Ignition monitoring')).getByText('Not seen although the device reports')).toBeInTheDocument();
    expect((await row('Fuel monitoring')).getByText('Unknown')).toBeInTheDocument();
    expect((await row('Remote immobilization')).getByText('Not enabled')).toBeInTheDocument();
    expect(screen.queryByText(/immobilized/i)).not.toBeInTheDocument();
  });

  it('an unidentified device says nothing can be confirmed and offers to identify it', async () => {
    signIn(['devices.read', 'devices.register', 'devices.capabilities.read']);
    mockApi({ ...base(device({ variant: null, lifecycleStatus: 'REGISTERED', displayStatus: 'Registered' })), '/devices/d1/capabilities': () => res(200, { data: { ...caps(), variant: null } }) });
    page(<DeviceDetailPage />, '/app/devices/d1');
    expect(await screen.findByText(/model of this device has not been identified/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Identify the model')).toBeInTheDocument();
  });

  it('a viewer sees the device but no controls', async () => {
    signIn(['devices.read', 'devices.capabilities.read']);
    mockApi(base(device()));
    page(<DeviceDetailPage />, '/app/devices/d1');
    expect(await screen.findByText('Details')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I have configured the device' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Identify the model')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });

  it('installs on a vehicle that has no tracker, asking only for those', async () => {
    signIn(['devices.read', 'devices.assign', 'devices.capabilities.read']);
    const calls = mockApi({ ...base(device()), '/devices/d1/assign': () => res(200, { data: device() }) });
    page(<DeviceDetailPage />, '/app/devices/d1');
    const select = await screen.findByLabelText(/Install on a vehicle/);
    await waitFor(() => expect(within(select).getByRole('option', { name: 'RAB 1 C' })).toBeInTheDocument());
    expect(calls.some((c) => c.url.includes('hasDevice=false'))).toBe(true);
    await userEvent.selectOptions(select, 'v1');
    await userEvent.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/devices/d1/assign'))?.body).toEqual({ vehicleId: 'v1' }));
  });

  it('another organization’s device is "not found", not an error page', async () => {
    signIn(['devices.read']);
    mockApi({ '/devices/d1': () => res(404, { code: 'DEVICE_NOT_FOUND', status: 404, title: 'x' }) });
    page(<DeviceDetailPage />, '/app/devices/d1');
    expect(await screen.findByText('Device not found')).toBeInTheDocument();
  });
});

describe('Platform pages', () => {
  const diag = (over: Partial<DeviceDiagnosticsDto> = {}): DeviceDiagnosticsDto => ({
    device: { id: 'd1', uniqueId: '490154203237518', name: null, organization: { id: 'o', name: 'Kigali Tours' }, lifecycleStatus: 'AWAITING_FIRST_SIGNAL', connectivity: 'NEVER_CONNECTED', displayStatus: 'Awaiting first GPS signal', isSimulated: false, firmwareVersion: null, serialNumber: null, simIccid: null, variantLabel: null, firstSignalAt: null, lastSeenAt: null, createdAt: '2026-10-30T08:00:00Z', awaitingFirstSignalTooLong: true },
    engine: { reachable: true, known: false, engineStatus: null, lastUpdate: null, syncStatus: 'SYNCED', syncError: null, protocol: null },
    history: [], capabilities: caps().capabilities,
    notes: ['The platform has never received data from this device.', 'Waiting for the first GPS signal for more than 24 hours.'], ...over,
  });

  it('diagnostics lists plain-language findings and shows what the engine does and does not know', async () => {
    signIn(['platform.devices.diagnose', 'platform.catalogue.manage'], 'plat', 'PLATFORM');
    mockApi({ '/admin/catalogue/models': () => res(200, { data: [model()] }), '/admin/devices/d1/diagnostics': () => res(200, { data: diag() }) });
    page(<AdminDeviceDetailPage />, '/admin/devices/d1');
    expect(await screen.findByText('The platform has never received data from this device.')).toBeInTheDocument();
    expect(screen.getByText(/more than 24 hours/)).toBeInTheDocument();
    expect(screen.getByText('Kigali Tours')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change status' })).toBeInTheDocument();
    expect(screen.queryByText(/latitude|longitude/i)).not.toBeInTheDocument();
  });

  it('marking a variant verified without a recorded test shows the server’s plain-language refusal', async () => {
    signIn(['platform.catalogue.manage'], 'plat', 'PLATFORM');
    mockApi({
      '/admin/catalogue/models': () => res(200, { data: [model()] }),
      '/admin/catalogue/variants/var1': () => res(422, { code: 'VERIFICATION_REQUIRED', status: 422, title: 'x' }),
    });
    page(<CataloguePage />);
    const select = await screen.findByLabelText('Compatibility status');
    await userEvent.selectOptions(select, 'VERIFIED');
    expect(await screen.findByText(/Record a test .* before marking a variant as verified/)).toBeInTheDocument();
    expect(screen.getByText('Never')).toBeInTheDocument(); // never tested
  });
});
