import type { Scenario } from '../scenario/types';
import { sendLive } from './helpers';

export const invalidCoordinates: Scenario = {
  name: 'invalid-coordinates',
  description: 'A tracker without a GPS fix reports (0,0), then an impossible latitude, then recovers.',
  proves: 'Junk coordinates never move the marker, but each message still shows the device is alive; the problem is flagged and clears with the next good fix.',
  async run(ctx) {
    await sendLive(ctx, [{ speedKmh: 30, ignition: true, latitude: -1.9441, longitude: 30.0619 }]);
    const base = await ctx.waitFor('first position', () => ctx.location());
    ctx.check('a normal position is applied', base.latitude === -1.9441 && !base.lastFixInvalid);

    // (0,0): Traccar stores it as a VALID position — the platform must not.
    await ctx.send({ latitude: 0, longitude: 0, speedKmh: 0, ignition: true });
    const hb = await ctx.waitFor('(0,0) heartbeat', async () => {
      const l = await ctx.location();
      return l?.lastFixInvalid ? l : null;
    });
    ctx.check('(0,0) does not move the marker', hb.latitude === -1.9441 && hb.longitude === 30.0619);
    ctx.check('the fix is flagged as invalid', hb.lastFixInvalid === true);
    ctx.check('the message still counts as the device being alive (last seen advanced)', new Date(hb.lastSeenAt) > new Date(base.lastSeenAt), `${base.lastSeenAt} -> ${hb.lastSeenAt}`);
    ctx.check('the last good fix time is unchanged', hb.lastFixAt === base.lastFixAt);

    // Latitude 95: the engine's OsmAnd handler closes the connection and stores nothing.
    const bad = await ctx.send({ latitude: 95, longitude: 30, speedKmh: 0 });
    ctx.check('an impossible latitude is refused at the engine', bad.httpStatus !== 200, String(bad.httpStatus));
    await ctx.sleep(4000);
    const after = (await ctx.location())!;
    ctx.check('and changes nothing', after.latitude === -1.9441 && after.lastFixAt === base.lastFixAt);

    if (ctx.stats) ctx.check('heartbeat-only messages were counted for diagnostics', ((await ctx.stats())['heartbeat_invalid'] ?? 0) >= 1);

    // Recovery
    await sendLive(ctx, [{ speedKmh: 30, ignition: true, latitude: -1.9447, longitude: 30.0630 }]);
    const ok = await ctx.waitFor('recovery', async () => {
      const l = await ctx.location();
      return l && l.latitude === -1.9447 ? l : null;
    });
    ctx.check('the next good fix is applied and clears the flag', !ok.lastFixInvalid);
  },
};
