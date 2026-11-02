import { randomUUID } from 'node:crypto';
import { ROLE_KEYS, todayIn } from '@gps/shared';
import { addMemberAndLogin, bearer, createTestApp, http, registerUser, url, type TestCtx, type TestUser } from './helpers';

/** Day `n` days from today in the test organizations' time zone (Africa/Kigali), as YYYY-MM-DD. */
const day = (n: number) => {
  const d = new Date(`${todayIn('Africa/Kigali')}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const uid = () => randomUUID().slice(0, 6).toUpperCase();

/** M5a: vehicles (full record), categories, drivers + assignment history, document records, dashboard. */
describe('Fleet management (e2e)', () => {
  let ctx: TestCtx;
  let a: TestUser & { organizationId?: string };
  let b: TestUser & { organizationId?: string };
  let A: string;
  let B: string;

  const post = (u: TestUser, path: string, body: object = {}) => http(ctx).post(url(path)).set(bearer(u)).send(body);
  const patch = (u: TestUser, path: string, body: object) => http(ctx).patch(url(path)).set(bearer(u)).send(body);
  const get = (u: TestUser, path: string) => http(ctx).get(url(path)).set(bearer(u));
  const del = (u: TestUser, path: string, body?: object) => http(ctx).delete(url(path)).set(bearer(u)).send(body ?? {});
  const vehicle = async (u: TestUser, extra: object = {}) => {
    const res = await post(u, '/vehicles', { registrationNumber: `RA${uid()}`, ...extra });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; registrationNumber: string };
  };
  const driver = async (u: TestUser, extra: object = {}) => {
    const res = await post(u, '/drivers', { fullName: `Driver ${uid()}`, ...extra });
    expect(res.status).toBe(201);
    return res.body.data as { id: string; fullName: string };
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await registerUser(ctx, { organizationName: 'Fleet A' });
    b = await registerUser(ctx, { organizationName: 'Fleet B' });
    A = a.organizationId!;
    B = b.organizationId!;
  });
  afterAll(() => ctx.close());

  describe('vehicles', () => {
    it('creates a full record, derives expiry status in the organization time zone and keeps unset fields null', async () => {
      const res = await post(a, '/vehicles', {
        registrationNumber: `RAB${uid()}`,
        make: 'Toyota',
        model: 'Hiace',
        year: 2019,
        vehicleType: 'VAN',
        fuelType: 'DIESEL',
        vin: ' jtfs h22 p0 00 ',
        insuranceExpiry: day(10),
        inspectionExpiry: day(-3),
        notes: '  runs the Kigali route ',
      });
      expect(res.status).toBe(201);
      const v = res.body.data;
      expect(v).toMatchObject({ make: 'Toyota', year: 2019, vehicleType: 'VAN', vin: 'JTFSH22P0' + '00', color: null, category: null, driver: null, device: null, documentsCount: 0 });
      expect(v.notes).toBe('runs the Kigali route');
      expect(v.insurance).toEqual({ date: day(10), daysLeft: 10, status: 'EXPIRING_SOON' });
      expect(v.inspection).toEqual({ date: day(-3), daysLeft: -3, status: 'EXPIRED' });
      const read = await get(a, `/vehicles/${v.id}`);
      expect(read.body.data).toEqual(v);
    });

    it('rejects invalid input with field errors and stable codes', async () => {
      const bad = await post(a, '/vehicles', { registrationNumber: `RA${uid()}`, vin: 'no!', insuranceExpiry: '02/11/2026', year: 3000 });
      expect(bad.status).toBe(400);
      const none = await patch(a, `/vehicles/${(await vehicle(a)).id}`, {});
      expect(none.status).toBe(400);
    });

    it('refuses duplicates: registration (ignoring case/space) and VIN, per organization only', async () => {
      const reg = `RDU${uid()}`;
      const vin = `VIN${uid()}${uid()}`;
      await vehicle(a, { registrationNumber: reg, vin });
      const dupReg = await post(a, '/vehicles', { registrationNumber: ` ${reg.toLowerCase()} ` });
      expect(dupReg.status).toBe(409);
      expect(dupReg.body.code).toBe('VEHICLE_REGISTRATION_TAKEN');
      const dupVin = await post(a, '/vehicles', { registrationNumber: `RA${uid()}`, vin });
      expect(dupVin.status).toBe(409);
      expect(dupVin.body.code).toBe('VEHICLE_VIN_TAKEN');
      expect((await post(b, '/vehicles', { registrationNumber: reg, vin })).status).toBe(201); // other organization: fine
    });

    it('updates only the fields sent and null clears one', async () => {
      const v = await vehicle(a, { make: 'Isuzu', color: 'White', insuranceExpiry: day(100) });
      const res = await patch(a, `/vehicles/${v.id}`, { color: null, model: 'D-Max' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ make: 'Isuzu', model: 'D-Max', color: null });
      expect(res.body.data.insurance.date).toBe(day(100));
      const cleared = await patch(a, `/vehicles/${v.id}`, { insuranceExpiry: null });
      expect(cleared.body.data.insurance).toBeNull();
    });

    it('lists with search, filters and a whitelisted sort', async () => {
      const tag = uid();
      const cat = (await post(a, '/vehicle-categories', { name: `Cat ${tag}` })).body.data;
      const v1 = await vehicle(a, { registrationNumber: `ZZ${tag}1`, make: `Maker${tag}`, categoryId: cat.id, year: 2010 });
      const v2 = await vehicle(a, { registrationNumber: `ZZ${tag}2`, make: `Maker${tag}`, year: 2022 });
      const byMake = await get(a, `/vehicles?q=maker${tag}&sort=year:desc`);
      expect(byMake.body.data.map((v: { id: string }) => v.id)).toEqual([v2.id, v1.id]);
      expect(byMake.body.meta.total).toBe(2);
      const byCat = await get(a, `/vehicles?categoryId=${cat.id}`);
      expect(byCat.body.data.map((v: { id: string }) => v.id)).toEqual([v1.id]);
      expect(byCat.body.data[0].category).toEqual({ id: cat.id, name: `Cat ${tag}`, color: null });
      const noDriver = await get(a, `/vehicles?q=maker${tag}&hasDriver=false`);
      expect(noDriver.body.meta.total).toBe(2);
      expect((await get(a, '/vehicles?sort=password:asc')).status).toBe(400);
    });

    it('soft-deletes a vehicle; its registration number can be reused', async () => {
      const v = await vehicle(a);
      expect((await del(a, `/vehicles/${v.id}`)).status).toBe(204);
      expect((await get(a, `/vehicles/${v.id}`)).status).toBe(404);
      expect((await post(a, '/vehicles', { registrationNumber: v.registrationNumber })).status).toBe(201);
    });

    it('refuses a category from another organization', async () => {
      const foreign = (await post(b, '/vehicle-categories', { name: `Foreign ${uid()}` })).body.data;
      const res = await post(a, '/vehicles', { registrationNumber: `RA${uid()}`, categoryId: foreign.id });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe('CATEGORY_NOT_FOUND');
    });
  });

  describe('categories', () => {
    it('creates, renames, counts vehicles and refuses duplicate names ignoring case', async () => {
      const name = `Vans ${uid()}`;
      const c = (await post(a, '/vehicle-categories', { name, color: '#1d4ed8' })).body.data;
      expect(c).toMatchObject({ name, color: '#1d4ed8', vehicleCount: 0 });
      const dup = await post(a, '/vehicle-categories', { name: ` ${name.toUpperCase()} ` });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('CATEGORY_NAME_TAKEN');
      expect((await post(a, '/vehicle-categories', { name: 'x', color: 'blue' })).status).toBe(400);
      await vehicle(a, { categoryId: c.id });
      const renamed = await patch(a, `/vehicle-categories/${c.id}`, { name: `${name} 2` });
      expect(renamed.body.data).toMatchObject({ name: `${name} 2`, vehicleCount: 1 });
      expect((await post(b, '/vehicle-categories', { name })).status).toBe(201); // names are per organization
    });

    it('refuses to delete a category in use, deletes an unused one', async () => {
      const c = (await post(a, '/vehicle-categories', { name: `Use ${uid()}` })).body.data;
      const v = await vehicle(a, { categoryId: c.id });
      const refused = await del(a, `/vehicle-categories/${c.id}`);
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('CATEGORY_IN_USE');
      await patch(a, `/vehicles/${v.id}`, { categoryId: null });
      expect((await del(a, `/vehicle-categories/${c.id}`)).status).toBe(204);
      expect((await get(a, '/vehicle-categories')).body.data.find((x: { id: string }) => x.id === c.id)).toBeUndefined();
    });
  });

  describe('drivers and the assigned driver', () => {
    it('creates a driver with minimal data, normalises the phone and flags the licence expiry', async () => {
      const d = await driver(a, { phone: '+250 788 123 456', email: 'Driver@Example.test', licenseNumber: `LIC-${uid()}`, licenseExpiry: day(-1) });
      expect(d).toMatchObject({ phone: '+250788123456', email: 'driver@example.test', status: 'ACTIVE', vehicle: null });
      expect((await get(a, `/drivers/${d.id}`)).body.data.license).toEqual({ date: day(-1), daysLeft: -1, status: 'EXPIRED' });
      expect((await post(a, '/drivers', { fullName: 'X', phone: '0788123456' })).status).toBe(400);
    });

    it('refuses a duplicate licence number within the organization only', async () => {
      const licenseNumber = `DUP-${uid()}`;
      await driver(a, { licenseNumber });
      const dup = await post(a, '/drivers', { fullName: 'Other', licenseNumber: ` ${licenseNumber.toLowerCase()} ` });
      expect(dup.status).toBe(409);
      expect(dup.body.code).toBe('DRIVER_LICENSE_TAKEN');
      expect((await post(b, '/drivers', { fullName: 'Other', licenseNumber })).status).toBe(201);
    });

    it('assigns one driver per vehicle and one vehicle per driver, and keeps the history', async () => {
      const v1 = await vehicle(a);
      const v2 = await vehicle(a);
      const d1 = await driver(a);
      const d2 = await driver(a);

      const assigned = await post(a, `/vehicles/${v1.id}/driver`, { driverId: d1.id, reason: 'Morning shift' });
      expect(assigned.status).toBe(201);
      expect(assigned.body.data.driver).toMatchObject({ id: d1.id, fullName: d1.fullName });
      expect((await get(a, `/drivers/${d1.id}`)).body.data.vehicle).toMatchObject({ id: v1.id, registrationNumber: v1.registrationNumber });

      const second = await post(a, `/vehicles/${v1.id}/driver`, { driverId: d2.id });
      expect(second.status).toBe(409);
      expect(second.body.code).toBe('VEHICLE_HAS_DRIVER');
      const elsewhere = await post(a, `/vehicles/${v2.id}/driver`, { driverId: d1.id });
      expect(elsewhere.status).toBe(409);
      expect(elsewhere.body.code).toBe('DRIVER_ALREADY_ASSIGNED');

      expect((await get(a, `/vehicles?hasDriver=true&q=${v1.registrationNumber}`)).body.meta.total).toBe(1);
      expect((await get(a, '/drivers?assigned=true')).body.data.some((d: { id: string }) => d.id === d1.id)).toBe(true);

      // A driver in use cannot be deleted or deactivated, and neither can the vehicle.
      expect((await del(a, `/drivers/${d1.id}`)).body.code).toBe('DRIVER_ASSIGNED');
      expect((await patch(a, `/drivers/${d1.id}`, { status: 'INACTIVE' })).body.code).toBe('DRIVER_ASSIGNED');
      expect((await del(a, `/vehicles/${v1.id}`)).body.code).toBe('VEHICLE_HAS_DRIVER');

      const freed = await del(a, `/vehicles/${v1.id}/driver`, { reason: 'Shift ended' });
      expect(freed.status).toBe(200);
      expect(freed.body.data.driver).toBeNull();
      expect((await del(a, `/vehicles/${v1.id}/driver`)).body.code).toBe('VEHICLE_HAS_NO_DRIVER');

      // The same vehicle can take another driver; the first stays in the history.
      expect((await post(a, `/vehicles/${v1.id}/driver`, { driverId: d2.id })).status).toBe(201);
      const history = await get(a, `/vehicles/${v1.id}/driver-history`);
      expect(history.body.data).toHaveLength(2);
      expect(history.body.data[0]).toMatchObject({ driver: { id: d2.id }, unassignedAt: null });
      expect(history.body.data[1]).toMatchObject({ driver: { id: d1.id }, reason: 'Shift ended' });
      expect(history.body.data[1].unassignedAt).not.toBeNull();
    });

    it('does not assign an inactive driver, nor a driver of another organization', async () => {
      const v = await vehicle(a);
      const inactive = await driver(a, { status: 'INACTIVE' });
      const res = await post(a, `/vehicles/${v.id}/driver`, { driverId: inactive.id });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('DRIVER_INACTIVE');
      const foreign = await driver(b);
      const other = await post(a, `/vehicles/${v.id}/driver`, { driverId: foreign.id });
      expect(other.status).toBe(404);
      expect(other.body.code).toBe('DRIVER_NOT_FOUND');
    });

    it('the history table is append-only: no delete, closed rows are immutable (database-enforced)', async () => {
      const v = await vehicle(a);
      const d = await driver(a);
      await post(a, `/vehicles/${v.id}/driver`, { driverId: d.id });
      await del(a, `/vehicles/${v.id}/driver`);
      const row = await ctx.system.driverAssignment.findFirstOrThrow({ where: { vehicleId: v.id } });
      await expect(ctx.system.driverAssignment.delete({ where: { id: row.id } })).rejects.toThrow(/never deleted|permission denied/i);
      await expect(ctx.system.driverAssignment.update({ where: { id: row.id }, data: { reason: 'rewritten' } })).rejects.toThrow(/immutable/i);
      await expect(ctx.prisma.driverAssignment.delete({ where: { id: row.id } })).rejects.toThrow();
    });
  });

  describe('vehicle documents (records only)', () => {
    it('creates, lists by soonest expiry, updates and soft-deletes', async () => {
      const v = await vehicle(a);
      const base = `/vehicles/${v.id}/documents`;
      const late = await post(a, base, { type: 'PERMIT', title: 'City permit', expiresOn: day(200), referenceNumber: 'P-1' });
      const soon = await post(a, base, { type: 'INSURANCE', title: 'Policy 2026', issuedOn: day(-300), expiresOn: day(5) });
      const none = await post(a, base, { type: 'REGISTRATION', title: 'Registration book' });
      expect([late.status, soon.status, none.status]).toEqual([201, 201, 201]);
      expect(soon.body.data.expiry).toEqual({ date: day(5), daysLeft: 5, status: 'EXPIRING_SOON' });
      expect(none.body.data.expiry).toBeNull();

      const list = await get(a, base);
      expect(list.body.data.map((d: { title: string }) => d.title)).toEqual(['Policy 2026', 'City permit', 'Registration book']);
      expect((await get(a, `/vehicles/${v.id}`)).body.data.documentsCount).toBe(3);

      const upd = await patch(a, `${base}/${soon.body.data.id}`, { expiresOn: day(-1) });
      expect(upd.body.data.expiry.status).toBe('EXPIRED');
      // The order rule applies to the stored issue date too, not only to the fields sent.
      const bad = await patch(a, `${base}/${soon.body.data.id}`, { expiresOn: day(-400) });
      expect(bad.status).toBe(422);

      expect((await del(a, `${base}/${late.body.data.id}`)).status).toBe(204);
      expect((await get(a, base)).body.data).toHaveLength(2);
      expect((await del(a, `${base}/${late.body.data.id}`)).status).toBe(404);
      expect((await post(a, base, { type: 'OTHER', title: 'x', issuedOn: day(5), expiresOn: day(1) })).status).toBe(400);
    });
  });

  describe('dashboard', () => {
    it('shows real counts for an empty organization and never invents numbers', async () => {
      const fresh = await registerUser(ctx, { organizationName: 'Empty Fleet' });
      const res = await get(fresh, '/dashboard');
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        vehicles: { total: 0, withDevice: 0, withoutDevice: 0, withDriver: 0, withoutDriver: 0, byCategory: [] },
        drivers: { total: 0, active: 0, assigned: 0, unassigned: 0 },
        devices: { total: 0, installed: 0, notInstalled: 0, installedNeverReported: 0 },
        alerts: { unacknowledged: 0, recent: [] },
        status: { total: 0, byStatus: { MOVING: 0, IDLING: 0, PARKED: 0, STATIONARY: 0, OFFLINE: 0, NO_DATA: 0 } },
        attention: [],
        attentionTotal: 0,
      });
      expect(Object.keys(res.body.data).sort()).toEqual(['alerts', 'attention', 'attentionTotal', 'devices', 'drivers', 'generatedAt', 'status', 'vehicles']);
    });

    it('counts vehicles, drivers and categories and lists what needs attention, worst first', async () => {
      const org = await registerUser(ctx, { organizationName: 'Dash Fleet' });
      const cat = (await post(org, '/vehicle-categories', { name: 'Vans' })).body.data;
      const expired = await vehicle(org, { registrationNumber: 'DASH-EXPIRED', insuranceExpiry: day(-5), categoryId: cat.id });
      const soon = await vehicle(org, { registrationNumber: 'DASH-SOON', inspectionExpiry: day(7) });
      await vehicle(org, { registrationNumber: 'DASH-FINE', insuranceExpiry: day(90), inspectionExpiry: day(90) });
      const d = await driver(org, { licenseNumber: 'DASH-LIC', licenseExpiry: day(20) });
      await post(org, `/vehicles/${soon.id}/driver`, { driverId: d.id });
      await post(org, `/vehicles/${soon.id}/documents`, { type: 'PERMIT', title: 'Airport pass', expiresOn: day(-30) });
      // A deleted vehicle's papers must not show up.
      const gone = await vehicle(org, { registrationNumber: 'DASH-GONE', insuranceExpiry: day(-100) });
      await del(org, `/vehicles/${gone.id}`);

      const dash = (await get(org, '/dashboard')).body.data;
      expect(dash.vehicles).toMatchObject({ total: 3, withDevice: 0, withoutDevice: 3, withDriver: 1, withoutDriver: 2 });
      expect(dash.vehicles.byCategory).toEqual([
        { id: null, name: 'No category', count: 2 },
        { id: cat.id, name: 'Vans', count: 1 },
      ]);
      expect(dash.drivers).toEqual({ total: 1, active: 1, assigned: 1, unassigned: 0 });
      expect(dash.attention.map((i: { title: string; subject: { label: string }; severity: string }) => [i.severity, i.subject.label, i.title])).toEqual([
        ['EXPIRED', 'DASH-SOON', 'Permit: Airport pass'],
        ['EXPIRED', 'DASH-EXPIRED', 'Insurance'],
        ['EXPIRING_SOON', 'DASH-SOON', 'Inspection'],
        ['EXPIRING_SOON', dash.attention[3].subject.label, 'Driving licence'],
      ]);
      expect(dash.attentionTotal).toBe(4);
      expect(expired.id).toBeDefined();
    });

    it('flags an installed device that never reported only after a grace period', async () => {
      const org = await registerUser(ctx, { organizationName: 'Silent Fleet' });
      const orgId = org.organizationId!;
      const v = await vehicle(org, { registrationNumber: 'SILENT-1' });
      const dev = await ctx.system.gpsDevice.create({ data: { uniqueId: `IMEI-${uid()}${uid()}`, ownerOrganizationId: orgId, currentOrganizationId: orgId } });
      const assignment = await ctx.system.deviceAssignment.create({ data: { organizationId: orgId, deviceId: dev.id, vehicleId: v.id } });

      const fresh = (await get(org, '/dashboard')).body.data;
      expect(fresh.devices).toMatchObject({ total: 1, installed: 1, notInstalled: 0, installedNeverReported: 0 }); // just installed: not a warning yet
      expect(fresh.attention).toEqual([]);

      // An assignment's start cannot be edited (history is protected), so install the device 3 hours ago instead.
      await ctx.system.deviceAssignment.update({ where: { id: assignment.id }, data: { unassignedAt: new Date(assignment.assignedAt.getTime() + 1000) } });
      await ctx.system.deviceAssignment.create({ data: { organizationId: orgId, deviceId: dev.id, vehicleId: v.id, assignedAt: new Date(Date.now() - 3 * 3_600_000) } });
      const later = (await get(org, '/dashboard')).body.data;
      expect(later.devices.installedNeverReported).toBe(1);
      expect(later.attention).toEqual([expect.objectContaining({ kind: 'DEVICE_NO_SIGNAL', severity: 'WARNING', subject: expect.objectContaining({ type: 'device', label: dev.uniqueId }) })]);

      await ctx.system.gpsDevice.update({ where: { id: dev.id }, data: { lastSeenAt: new Date() } });
      expect((await get(org, '/dashboard')).body.data.devices.installedNeverReported).toBe(0);
    });

    it('counts an installed tracker that has not reported as NO_DATA and lists the latest alerts, newest first', async () => {
      const org = await registerUser(ctx, { organizationName: 'Status Fleet' });
      const orgId = org.organizationId!;
      const v = await vehicle(org, { registrationNumber: 'STAT-1' });
      const dev = await ctx.system.gpsDevice.create({ data: { uniqueId: `IMEI-${uid()}${uid()}`, ownerOrganizationId: orgId, currentOrganizationId: orgId } });
      await ctx.system.deviceAssignment.create({ data: { organizationId: orgId, deviceId: dev.id, vehicleId: v.id } });
      for (const [type, minutesAgo] of [['IGNITION_ON', 30], ['OVERSPEED', 5]] as const) {
        await ctx.system.alert.create({ data: { organizationId: orgId, vehicleId: v.id, type, severity: 'WARNING', startedAt: new Date(Date.now() - minutesAgo * 60_000), simulated: true } });
      }
      const dash = (await get(org, '/dashboard')).body.data;
      expect(dash.status).toEqual({ total: 1, byStatus: { MOVING: 0, IDLING: 0, PARKED: 0, STATIONARY: 0, OFFLINE: 0, NO_DATA: 1 } });
      expect(dash.alerts.unacknowledged).toBe(2);
      expect(dash.alerts.recent.map((a: { type: string }) => a.type)).toEqual(['OVERSPEED', 'IGNITION_ON']);
      expect(dash.alerts.recent[0]).toMatchObject({ registrationNumber: 'STAT-1', simulated: true, acknowledgedAt: null });
    });

    it('omits the status and alert sections for a role that may not see them', async () => {
      // A custom role that can read vehicles only.
      const role = await ctx.system.role.create({ data: { scope: 'ORGANIZATION', key: `VEH_ONLY_${uid()}`, name: 'Vehicles only', isSystem: false } });
      const perm = await ctx.system.permission.findUniqueOrThrow({ where: { key: 'vehicles.read' } });
      await ctx.system.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
      const { addMember, signIn } = await import('./helpers');
      const m = await addMember(ctx, A, ROLE_KEYS.VIEWER);
      await ctx.system.memberRole.deleteMany({ where: { memberId: m.member.id } });
      await ctx.system.memberRole.create({ data: { organizationId: A, memberId: m.member.id, roleId: role.id } });
      const user = await signIn(ctx, m.email);
      const dash = (await get(user, '/dashboard')).body.data;
      expect(dash).toMatchObject({ status: null, alerts: null, drivers: null, devices: null });
      expect(dash.vehicles.total).toBeGreaterThan(0);
    });
  });

  describe('permissions', () => {
    it('Viewer reads but cannot write; Fleet Manager manages everything except deleting vehicles', async () => {
      const viewer = await addMemberAndLogin(ctx, A, ROLE_KEYS.VIEWER);
      const manager = await addMemberAndLogin(ctx, A, ROLE_KEYS.FLEET_MANAGER);
      const v = await vehicle(a);
      const d = await driver(a);

      expect((await get(viewer, '/vehicles')).status).toBe(200);
      expect((await get(viewer, '/drivers')).status).toBe(200);
      expect((await get(viewer, '/vehicle-categories')).status).toBe(200);
      expect((await get(viewer, '/dashboard')).status).toBe(200);
      for (const [method, path, body] of [
        ['post', '/vehicles', { registrationNumber: `RA${uid()}` }],
        ['patch', `/vehicles/${v.id}`, { color: 'Red' }],
        ['post', '/vehicle-categories', { name: `V${uid()}` }],
        ['post', '/drivers', { fullName: 'No' }],
        ['post', `/vehicles/${v.id}/driver`, { driverId: d.id }],
        ['post', `/vehicles/${v.id}/documents`, { type: 'OTHER', title: 'No' }],
      ] as const) {
        const res = await http(ctx)[method](url(path)).set(bearer(viewer)).send(body);
        expect([method, path, res.status, res.body.code]).toEqual([method, path, 403, 'PERMISSION_DENIED']);
      }

      expect((await post(manager, '/vehicles', { registrationNumber: `RA${uid()}` })).status).toBe(201);
      expect((await post(manager, '/vehicle-categories', { name: `M${uid()}` })).status).toBe(201);
      expect((await post(manager, '/drivers', { fullName: 'Manager driver' })).status).toBe(201);
      expect((await post(manager, `/vehicles/${v.id}/documents`, { type: 'OTHER', title: 'Ok' })).status).toBe(201);
      expect((await del(manager, `/vehicles/${v.id}`)).status).toBe(403);
    });

    it('requires authentication on every new route', async () => {
      const v = await vehicle(a);
      for (const path of ['/vehicles', `/vehicles/${v.id}/documents`, `/vehicles/${v.id}/driver-history`, '/drivers', '/vehicle-categories', '/dashboard']) {
        expect((await http(ctx).get(url(path))).status).toBe(401);
      }
    });
  });

  describe('tenant isolation', () => {
    it('another organization’s vehicles, drivers, categories and documents are 404 and never listed', async () => {
      const v = await vehicle(a, { vin: `ISO${uid()}${uid()}` });
      const d = await driver(a);
      const c = (await post(a, '/vehicle-categories', { name: `Iso ${uid()}` })).body.data;
      const doc = (await post(a, `/vehicles/${v.id}/documents`, { type: 'OTHER', title: 'Private' })).body.data;
      await post(a, `/vehicles/${v.id}/driver`, { driverId: d.id });

      const attempts: [string, () => ReturnType<typeof get>][] = [
        ['GET vehicle', () => get(b, `/vehicles/${v.id}`)],
        ['PATCH vehicle', () => patch(b, `/vehicles/${v.id}`, { color: 'Pink' })],
        ['DELETE vehicle', () => del(b, `/vehicles/${v.id}`)],
        ['GET documents', () => get(b, `/vehicles/${v.id}/documents`)],
        ['POST document', () => post(b, `/vehicles/${v.id}/documents`, { type: 'OTHER', title: 'Spy' })],
        ['PATCH document', () => patch(b, `/vehicles/${v.id}/documents/${doc.id}`, { title: 'Spy' })],
        ['DELETE document', () => del(b, `/vehicles/${v.id}/documents/${doc.id}`)],
        ['GET driver history', () => get(b, `/vehicles/${v.id}/driver-history`)],
        ['POST assign driver', () => post(b, `/vehicles/${v.id}/driver`, { driverId: d.id })],
        ['DELETE unassign driver', () => del(b, `/vehicles/${v.id}/driver`)],
        ['GET driver', () => get(b, `/drivers/${d.id}`)],
        ['PATCH driver', () => patch(b, `/drivers/${d.id}`, { fullName: 'Hijacked' })],
        ['DELETE driver', () => del(b, `/drivers/${d.id}`)],
        ['PATCH category', () => patch(b, `/vehicle-categories/${c.id}`, { name: 'Hijacked' })],
        ['DELETE category', () => del(b, `/vehicle-categories/${c.id}`)],
      ];
      for (const [name, call] of attempts) {
        const res = await call();
        expect([name, res.status]).toEqual([name, 404]);
        expect(JSON.stringify(res.body)).not.toContain(v.registrationNumber);
      }

      for (const path of ['/vehicles', '/drivers', '/vehicle-categories']) {
        const list = await get(b, path);
        expect(JSON.stringify(list.body)).not.toContain(v.id);
        expect(JSON.stringify(list.body)).not.toContain(d.id);
        expect(JSON.stringify(list.body)).not.toContain(c.id);
      }
      // …and A's data is untouched.
      expect((await get(a, `/vehicles/${v.id}`)).body.data.color).toBeNull();
      expect((await get(a, `/drivers/${d.id}`)).body.data.fullName).toBe(d.fullName);
    });

    it('a body that names another organization is ignored', async () => {
      const res = await post(a, '/vehicles', { registrationNumber: `RA${uid()}`, organizationId: B });
      expect(res.status).toBe(201);
      const row = await ctx.system.vehicle.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(row.organizationId).toBe(A);
    });

    it('row-level security hides the new tables from another tenant and from a session with no tenant', async () => {
      const v = await vehicle(a);
      const d = await driver(a);
      await post(a, `/vehicles/${v.id}/driver`, { driverId: d.id });
      await post(a, `/vehicles/${v.id}/documents`, { type: 'OTHER', title: 'RLS' });
      await post(a, '/vehicle-categories', { name: `Rls ${uid()}` });

      // Through the application role with no tenant set: nothing, on every new table.
      expect(await ctx.prisma.driver.count()).toBe(0);
      expect(await ctx.prisma.driverAssignment.count()).toBe(0);
      expect(await ctx.prisma.vehicleDocument.count()).toBe(0);
      expect(await ctx.prisma.vehicleCategory.count()).toBe(0);
      // With B's tenant set: still none of A's rows.
      const asB = await ctx.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_org_id', ${B}, true)`;
        return [await tx.driver.count({ where: { organizationId: A } }), await tx.driverAssignment.count({ where: { organizationId: A } }), await tx.vehicleDocument.count({ where: { organizationId: A } })];
      });
      expect(asB).toEqual([0, 0, 0]);
    });

    it('composite foreign keys stop a cross-tenant link even for the system role', async () => {
      const vA = await vehicle(a);
      const dB = await driver(b);
      await expect(ctx.system.driverAssignment.create({ data: { organizationId: A, vehicleId: vA.id, driverId: dB.id } })).rejects.toThrow(/foreign key/i);
      await expect(ctx.system.vehicleDocument.create({ data: { organizationId: B, vehicleId: vA.id, type: 'OTHER', title: 'x' } })).rejects.toThrow(/foreign key/i);
    });
  });
});
