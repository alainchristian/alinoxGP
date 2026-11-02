import type Redis from 'ioredis';
import type { Env } from '../../infrastructure/config/env';
import type { SystemPrismaService } from '../../infrastructure/prisma/prisma.service';
import { DeviceRoutingService } from './device-routing.service';

/**
 * The routing cache sits on the hot path of every position. Its TTL must exceed the devices' reporting interval (a 5 s TTL
 * with 10 s reports meant EVERY position ran a 3-table query), and because the TTL is long, a reassignment on any API
 * instance has to clear the cached route on all of them.
 */
describe('DeviceRoutingService', () => {
  const deviceRow = (vehicleId: string | null) => ({
    id: 'dev-1', uniqueId: 'IMEI-1', isSimulated: false, ownerOrganizationId: 'org-a',
    owner: { isSandbox: false },
    assignments: vehicleId ? [{ organizationId: 'org-a', vehicleId }] : [],
  });

  function build(ttlSec = 120) {
    let row: ReturnType<typeof deviceRow> | null = deviceRow('veh-1');
    const findUnique = jest.fn(async () => row);
    const published: string[] = [];
    const publish = jest.fn(async (_channel: string, message: string) => { published.push(message); return 1; });
    const service = new DeviceRoutingService(
      { gpsDevice: { findUnique } } as unknown as SystemPrismaService,
      { publish } as unknown as Redis,
      { ROUTING_CACHE_TTL_SEC: ttlSec, REDIS_URL: 'redis://unused' } as unknown as Env,
    );
    return { service, findUnique, published, setRow: (r: typeof row) => { row = r; } };
  }

  it('answers from the cache across a typical reporting interval (10 s) instead of querying every position', async () => {
    const { service, findUnique } = build();
    const t0 = 1_000_000;
    for (let i = 0; i < 10; i++) await service.resolve(42, t0 + i * 10_000); // a device reporting every 10 s for 100 s
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('queries again once the TTL has passed', async () => {
    const { service, findUnique } = build(30);
    await service.resolve(42, 0);
    await service.resolve(42, 29_999);
    expect(findUnique).toHaveBeenCalledTimes(1);
    await service.resolve(42, 30_001);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('local invalidation forces a fresh lookup and tells the other instances', async () => {
    const { service, findUnique, published, setRow } = build();
    expect((await service.resolve(42, 0))?.assignment?.vehicleId).toBe('veh-1');
    setRow(deviceRow('veh-2')); // reassigned
    service.invalidate(42);
    expect((await service.resolve(42, 1))?.assignment?.vehicleId).toBe('veh-2');
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(published).toHaveLength(1);
    expect(JSON.parse(published[0]!)).toMatchObject({ engineDeviceId: 42 });
  });

  it('a change announced by ANOTHER instance clears the cached route here (no stale tenant for the whole TTL)', async () => {
    const { service, findUnique, setRow } = build();
    await service.resolve(42, 0);
    setRow(deviceRow(null)); // unassigned on a peer
    service.handleInvalidation(JSON.stringify({ from: 'some-other-instance', engineDeviceId: 42 }));
    expect((await service.resolve(42, 1))?.assignment).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('ignores its own announcement (already applied) but clears everything for a global or unreadable message', async () => {
    const { service, findUnique, published } = build();
    await service.resolve(42, 0);
    service.invalidate(7); // announces under this instance id
    service.handleInvalidation(published[0]!); // echoed back to the publisher
    await service.resolve(42, 1);
    expect(findUnique).toHaveBeenCalledTimes(1); // device 42 still cached: neither the local nor the echoed invalidation touched it

    service.handleInvalidation(JSON.stringify({ from: 'peer', engineDeviceId: null })); // "everything"
    await service.resolve(42, 2);
    expect(findUnique).toHaveBeenCalledTimes(2);

    service.handleInvalidation('not json'); // safe reaction to garbage is to forget everything
    await service.resolve(42, 3);
    expect(findUnique).toHaveBeenCalledTimes(3);
  });

  it('caches "unknown device" too, so unmapped devices do not hit the database on every position', async () => {
    const { service, findUnique, setRow } = build();
    setRow(null);
    expect(await service.resolve(99, 0)).toBeNull();
    expect(await service.resolve(99, 10_000)).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});
