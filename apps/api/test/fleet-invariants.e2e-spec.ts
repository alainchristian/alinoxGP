import { randomUUID } from 'node:crypto';
import { TenantPrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createOrg, createTestApp, type TestCtx } from './helpers';

/** Database-level guarantees of the M2 tables, exercised with the system role (which bypasses RLS but not constraints/triggers). */
describe('Fleet core invariants (database)', () => {
  let ctx: TestCtx;
  let tenant: TenantPrismaService;
  let A: string, B: string, SANDBOX: string;
  const uid = () => randomUUID().slice(0, 8).toUpperCase();

  const vehicle = (org: string, reg = `V${uid()}`) => ctx.system.vehicle.create({ data: { organizationId: org, registrationNumber: reg } });
  const device = (owner: string, extra: Record<string, unknown> = {}) =>
    ctx.system.gpsDevice.create({ data: { uniqueId: `IMEI-${uid()}`, ownerOrganizationId: owner, currentOrganizationId: owner, ...extra } });
  const assign = (org: string, deviceId: string, vehicleId: string) =>
    ctx.system.deviceAssignment.create({ data: { organizationId: org, deviceId, vehicleId } });

  beforeAll(async () => {
    ctx = await createTestApp();
    tenant = ctx.app.get(TenantPrismaService);
    A = (await createOrg(ctx)).id;
    B = (await createOrg(ctx)).id;
    SANDBOX = (await createOrg(ctx)).id;
    await ctx.system.organization.update({ where: { id: SANDBOX }, data: { isSandbox: true } });
  });
  afterAll(() => ctx.close());

  describe('partial and expression unique indexes (OQ-014)', () => {
    it('a device is on at most one vehicle at a time, a vehicle carries at most one device', async () => {
      const d1 = await device(A);
      const d2 = await device(A);
      const v1 = await vehicle(A);
      const v2 = await vehicle(A);
      await assign(A, d1.id, v1.id);
      await expect(assign(A, d1.id, v2.id)).rejects.toThrow(/unique|duplicate/i);
      await expect(assign(A, d2.id, v1.id)).rejects.toThrow(/unique|duplicate/i);
      await assign(A, d2.id, v2.id); // unrelated pair is fine
    });

    it('once an assignment is closed the device and vehicle become available again', async () => {
      const d = await device(A);
      const v = await vehicle(A);
      const first = await assign(A, d.id, v.id);
      // relative to the DATABASE's assigned_at: the host and the container clock can differ by a fraction of a second
      await ctx.system.deviceAssignment.update({ where: { id: first.id }, data: { unassignedAt: new Date(first.assignedAt.getTime() + 1000) } });
      await expect(assign(A, d.id, v.id)).resolves.toBeDefined();
    });

    it('registration numbers are unique per organization ignoring case/whitespace, only among live vehicles', async () => {
      const reg = `AB${uid()}`;
      const v = await vehicle(A, reg);
      await expect(vehicle(A, ` ${reg.toLowerCase()} `)).rejects.toThrow(/unique|duplicate/i);
      await expect(vehicle(B, reg)).resolves.toBeDefined(); // other organization: fine
      await ctx.system.vehicle.update({ where: { id: v.id }, data: { deletedAt: new Date() } });
      await expect(vehicle(A, reg)).resolves.toBeDefined(); // soft-deleted number can be reused
    });

    it('prisma sees the hand-written indexes as no drift (checked by the CI migration drift step)', async () => {
      const idx = await ctx.system.$queryRaw<{ indexname: string }[]>`
        SELECT indexname FROM pg_indexes WHERE schemaname = 'public'
          AND indexname IN ('vehicles_registration_unique_active','device_assignments_one_open_per_device','device_assignments_one_open_per_vehicle')`;
      expect(idx.map((i) => i.indexname).sort()).toEqual([
        'device_assignments_one_open_per_device',
        'device_assignments_one_open_per_vehicle',
        'vehicles_registration_unique_active',
      ]);
    });
  });

  describe('device assignment history', () => {
    it('cannot reference a vehicle of another organization (composite foreign key)', async () => {
      const d = await device(A);
      const foreign = await vehicle(B);
      await expect(assign(A, d.id, foreign.id)).rejects.toThrow(/foreign key/i);
    });

    it('requires the device to be owned or operated by the assigning organization', async () => {
      const d = await device(A);
      const v = await vehicle(B);
      await expect(assign(B, d.id, v.id)).rejects.toThrow(/not owned or operated/i);
    });

    it('a device owned by one organization can be operated by another, and then it is visible to both (and to no one else)', async () => {
      const d = await ctx.system.gpsDevice.create({ data: { uniqueId: `IMEI-${uid()}`, ownerOrganizationId: A, currentOrganizationId: B } });
      const v = await vehicle(B);
      await expect(assign(B, d.id, v.id)).resolves.toBeDefined();
      const seenBy = async (org: string) => (await tenant.runInOrganization(org, (tx) => tx.gpsDevice.findMany({ where: { id: d.id } }))).length;
      expect(await seenBy(A)).toBe(1); // owner
      expect(await seenBy(B)).toBe(1); // operator
      const stranger = (await createOrg(ctx)).id;
      expect(await seenBy(stranger)).toBe(0);
    });

    it('closed assignments are immutable and no assignment can ever be deleted', async () => {
      const d = await device(A);
      const v = await vehicle(A);
      const a = await assign(A, d.id, v.id);
      await expect(ctx.system.deviceAssignment.update({ where: { id: a.id }, data: { assignedAt: new Date(0) } })).rejects.toThrow(/unassignment fields/i);
      const closed = await ctx.system.deviceAssignment.update({ where: { id: a.id }, data: { unassignedAt: new Date(a.assignedAt.getTime() + 1000), reason: 'test' } });
      await expect(ctx.system.deviceAssignment.update({ where: { id: a.id }, data: { reason: 'edited' } })).rejects.toThrow(/immutable/i);
      await expect(ctx.system.deviceAssignment.delete({ where: { id: a.id } })).rejects.toThrow();
      await expect(tenant.runInOrganization(A, (tx) => tx.deviceAssignment.delete({ where: { id: closed.id } }))).rejects.toThrow();
    });

    it('an assignment cannot end before it starts', async () => {
      const d = await device(A);
      const v = await vehicle(A);
      const a = await assign(A, d.id, v.id);
      await expect(
        ctx.system.deviceAssignment.update({ where: { id: a.id }, data: { unassignedAt: new Date(a.assignedAt.getTime() - 1000) } }),
      ).rejects.toThrow(/window_valid|check/i);
    });
  });

  describe('simulated devices', () => {
    it('the SIM- prefix and the simulated flag can never disagree', async () => {
      await expect(ctx.system.gpsDevice.create({ data: { uniqueId: `SIM-${uid()}`, ownerOrganizationId: SANDBOX, isSimulated: false } })).rejects.toThrow(/simulated_matches_prefix|check/i);
      await expect(ctx.system.gpsDevice.create({ data: { uniqueId: `IMEI-${uid()}`, ownerOrganizationId: SANDBOX, isSimulated: true } })).rejects.toThrow(/simulated_matches_prefix|check/i);
    });

    it('a simulated device can only belong to a sandbox organization — enforced by the database, not just the API', async () => {
      await expect(ctx.system.gpsDevice.create({ data: { uniqueId: `SIM-${uid()}`, ownerOrganizationId: A, isSimulated: true } })).rejects.toThrow(/sandbox/i);
      await expect(ctx.system.gpsDevice.create({ data: { uniqueId: `SIM-${uid()}`, ownerOrganizationId: SANDBOX, isSimulated: true } })).resolves.toBeDefined();
    });
  });

  it('an organization that owns simulated devices cannot be un-sandboxed (so simulated data can never end up in a production organization)', async () => {
    const sb = (await createOrg(ctx)).id;
    await ctx.system.organization.update({ where: { id: sb }, data: { isSandbox: true } });
    await expect(ctx.system.organization.update({ where: { id: sb }, data: { isSandbox: false } })).resolves.toBeDefined(); // no devices yet: allowed
    await ctx.system.organization.update({ where: { id: sb }, data: { isSandbox: true } });
    await ctx.system.gpsDevice.create({ data: { uniqueId: `SIM-${uid()}`, ownerOrganizationId: sb, isSimulated: true } });
    await expect(ctx.system.organization.update({ where: { id: sb }, data: { isSandbox: false } })).rejects.toThrow(/must remain a sandbox/i);
    expect((await ctx.system.organization.findUniqueOrThrow({ where: { id: sb } })).isSandbox).toBe(true);
  });

  describe('identifiers', () => {
    it('device unique ids are globally unique, even across organizations', async () => {
      const id = `IMEI-${uid()}`;
      await ctx.system.gpsDevice.create({ data: { uniqueId: id, ownerOrganizationId: A } });
      await expect(ctx.system.gpsDevice.create({ data: { uniqueId: id, ownerOrganizationId: B } })).rejects.toThrow(/unique/i);
    });

    it('rejects blank or oversized identifiers and registration numbers', async () => {
      await expect(ctx.system.gpsDevice.create({ data: { uniqueId: '  ', ownerOrganizationId: A } })).rejects.toThrow(/check|length/i);
      await expect(ctx.system.gpsDevice.create({ data: { uniqueId: 'x'.repeat(65), ownerOrganizationId: A } })).rejects.toThrow(/check|length/i);
      await expect(vehicle(A, '')).rejects.toThrow(/check|registration_not_blank/i);
    });
  });

  describe('live state', () => {
    it('is tenant-scoped: invisible to other organizations and impossible to write for another one', async () => {
      const d = await device(A);
      const v = await vehicle(A);
      await ctx.system.vehicleLiveState.create({ data: { vehicleId: v.id, organizationId: A, deviceId: d.id, latitude: -1.9, longitude: 30.1, lastSeenAt: new Date() } });
      expect(await tenant.runInOrganization(A, (tx) => tx.vehicleLiveState.count({ where: { vehicleId: v.id } }))).toBe(1);
      expect(await tenant.runInOrganization(B, (tx) => tx.vehicleLiveState.count({ where: { vehicleId: v.id } }))).toBe(0);
      // composite FK: a state row for A's vehicle labelled with B's organization is impossible.
      const v2 = await vehicle(A);
      await expect(
        ctx.system.vehicleLiveState.create({ data: { vehicleId: v2.id, organizationId: B, deviceId: d.id, lastSeenAt: new Date() } }),
      ).rejects.toThrow(/foreign key/i);
    });
  });
});
