import { drive } from '../motion';
import { KIGALI_CITY_LOOP } from '../routes';
import type { Scenario } from '../scenario/types';
import { metresBetween, ownDeltas, sendLive } from './helpers';

export const movingRoute: Scenario = {
  name: 'moving-route',
  description: 'Ignition on, the vehicle drives along a Kigali loop at about 40 km/h.',
  proves: 'A moving vehicle becomes MOVING, its marker advances along the route with plausible speed and heading, simulated data is labelled, and the counts agree.',
  async run(ctx) {
    const points = drive({ route: KIGALI_CITY_LOOP, speedKmh: 40, intervalSec: 1.5, seed: 42, startTime: Date.now() });
    const fixes = Array.from({ length: 8 }, () => {
      const p = points.next().value!;
      return { latitude: p.latitude, longitude: p.longitude, speedKmh: p.speedKmh, heading: p.heading, ignition: true };
    });
    await sendLive(ctx, fixes);

    const moving = await ctx.waitForStatus('MOVING');
    ctx.check('status becomes MOVING', moving.status === 'MOVING');

    // Wait until the LAST fix has landed, then examine the track the browser saw.
    await ctx.waitFor('last fix applied', async () => {
      const l = await ctx.location();
      return l && Math.abs((l.latitude ?? 0) - fixes[7]!.latitude) < 0.0001 ? l : null;
    });
    const last = (await ctx.location())!;
    // The live feed is a separate, coalesced channel: wait until the browser has received the final position too.
    await ctx.waitFor('final position pushed to the browser', async () => (ownDeltas(ctx).some((d) => Math.abs((d.latitude ?? 0) - fixes[7]!.latitude) < 0.0001) ? true : null), 10_000);
    const track = ownDeltas(ctx).filter((d) => d.latitude !== null);
    ctx.check('the marker moved: several position updates reached the browser', track.length >= 4, `${track.length} deltas`);
    const travelled = metresBetween(track[0]!, track[track.length - 1]!);
    ctx.check('it advanced along the route (> 60 m between first and last update)', travelled > 60, `${Math.round(travelled)} m`);
    ctx.check('speed is plausible (30-50 km/h)', last.speedKmh !== null && last.speedKmh >= 30 && last.speedKmh <= 50, `${last.speedKmh} km/h`);
    ctx.check('heading is reported (0-360)', last.heading !== null && last.heading >= 0 && last.heading <= 360, `${last.heading}`);
    ctx.check('ignition is known and on', last.ignition === true);
    ctx.check('data is not marked delayed or invalid', !last.lastFixDelayed && !last.lastFixInvalid);
    ctx.check('simulated data is labelled simulated', last.simulated === true);

    const summary = await ctx.summary();
    ctx.check('dashboard counts agree: exactly this vehicle is moving', summary.byStatus.MOVING === 1 && summary.total === 1, JSON.stringify(summary.byStatus));
    ctx.check('no alerts without rules', (await ctx.alerts()).length === 0);

    if (ctx.engine) {
      const history = await ctx.waitFor('history stored by the engine', async () => {
        const h = await ctx.engine!.history(ctx.deviceUniqueId);
        return h.length >= 8 ? h : null;
      });
      ctx.check('the engine recorded every fix (history is complete)', history.length >= 8, `${history.length} positions`);
    } else ctx.note('Engine history not checked (no engine access). Trips/history in the platform arrive with M6.');
  },
};
