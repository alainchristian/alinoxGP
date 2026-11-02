import type { Scenario } from '../scenario/types';
import { sendLive } from './helpers';

export const implausibleJump: Scenario = {
  name: 'implausible-jump',
  description: 'One fix is teleported thousands of kilometres away (latitude and longitude swapped) between two good ones.',
  proves: 'A physically impossible jump is not shown on the map, is flagged, and the next sensible fix recovers immediately — a single glitch never wrecks a journey.',
  async run(ctx) {
    await sendLive(ctx, [{ speedKmh: 40, ignition: true, latitude: -1.9441, longitude: 30.0619 }]);
    await ctx.waitFor('baseline', async () => {
      const l = await ctx.location();
      return l?.latitude === -1.9441 ? l : null;
    });

    // Swapped lat/lon: (30.07, -1.95) is ~3,500 km away, 1.5 s later.
    await ctx.send({ latitude: 30.07, longitude: -1.95, speedKmh: 40, ignition: true });
    const flagged = await ctx.waitFor('jump flagged', async () => {
      const l = await ctx.location();
      return l?.lastFixInvalid ? l : null;
    });
    ctx.check('the teleport is not shown', flagged.latitude === -1.9441 && flagged.longitude === 30.0619);
    ctx.check('it is flagged for diagnostics', flagged.lastFixInvalid === true);

    await ctx.sleep(1500);
    await ctx.send({ latitude: -1.9444, longitude: 30.0627, speedKmh: 40, ignition: true });
    const recovered = await ctx.waitFor('recovery', async () => {
      const l = await ctx.location();
      return l?.latitude === -1.9444 ? l : null;
    });
    ctx.check('the next sensible fix is applied at once', !recovered.lastFixInvalid);
    if (ctx.stats) ctx.check('the jump was counted', ((await ctx.stats())['implausible_jump'] ?? 0) >= 1);
    if (ctx.engine) {
      const trips = await ctx.engine.trips(ctx.deviceUniqueId);
      const longest = Math.max(0, ...trips.map((t) => t.distance));
      ctx.note(`Engine-side the glitch still pollutes reports: its trip distance is ${Math.round(longest / 1000)} km (evaluate filter.maxSpeed/distance — OQ-031).`);
    }
  },
};
