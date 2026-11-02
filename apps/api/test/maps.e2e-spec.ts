import { addMemberAndLogin, bearer, createOrg, createTestApp, http, url, type TestCtx } from './helpers';

describe('Map configuration (e2e)', () => {
  let ctx: TestCtx;
  beforeAll(async () => {
    ctx = await createTestApp();
  }, 60_000);
  afterAll(() => ctx.close());

  it('tells a member who may see live tracking how to draw the map (the development provider in tests)', async () => {
    const org = await createOrg(ctx, { name: 'Maps Org' });
    const owner = await addMemberAndLogin(ctx, org.id, 'ORG_OWNER');
    const res = await http(ctx).get(url('/maps/config')).set(bearer(owner)).set('X-Organization-Id', org.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ provider: 'dev-osm', devOnly: true, accessToken: null });
    expect(res.body.data.tiles[0]).toContain('{z}/{x}/{y}');
  });

  it('refuses an anonymous caller, and a member without the live-tracking permission', async () => {
    expect((await http(ctx).get(url('/maps/config'))).status).toBe(401);

    const org = await createOrg(ctx, { name: 'Maps Org 2' });
    const role = await ctx.system.role.create({ data: { scope: 'ORGANIZATION', key: `NO_MAP_${Date.now()}`, name: 'No map', isSystem: false } });
    const user = await addMemberAndLogin(ctx, org.id, role.key);
    const res = await http(ctx).get(url('/maps/config')).set(bearer(user)).set('X-Organization-Id', org.id);
    expect(res.status).toBe(403);
  });
});
