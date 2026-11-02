import type { Scenario } from '../scenario/types';
import { sendLive } from './helpers';

export const overspeed: Scenario = {
  name: 'overspeed',
  description: 'The vehicle exceeds a 60 km/h limit for longer than the minimum duration, slows down, and speeds again.',
  proves: 'One alert per speeding episode that lasts long enough; repeated speeding inside the cooldown does not alert again; brief spikes never do.',
  async run(ctx) {
    await ctx.createAlertRule({ type: 'OVERSPEED', params: { speedLimitKmh: 60, minDurationSec: 4 }, cooldownSeconds: 300 });
    const at = (i: number, speedKmh: number) => ({ speedKmh, ignition: true, latitude: -1.9441 - i * 0.0003, longitude: 30.0619 + i * 0.0006 });

    // A brief spike (one fix) is not an episode.
    await sendLive(ctx, [at(0, 40), at(1, 90), at(2, 40)]);
    await ctx.sleep(4000);
    ctx.check('a single fast fix does not alert', (await ctx.alerts('OVERSPEED')).length === 0);

    // A sustained episode: > 60 km/h for ~9 s.
    await sendLive(ctx, Array.from({ length: 7 }, (_, i) => at(3 + i, 85)));
    const first = await ctx.waitFor('overspeed alert', async () => {
      const a = await ctx.alerts('OVERSPEED');
      return a.length >= 1 ? a : null;
    });
    await ctx.sleep(3000);
    ctx.check('exactly one alert during the continuing episode', (await ctx.alerts('OVERSPEED')).length === 1);
    const alert = first[0]!;
    ctx.check('the alert says what, how bad and for which vehicle', alert.type === 'OVERSPEED' && alert.severity === 'WARNING' && alert.registrationNumber === ctx.registrationNumber);
    ctx.check('it records where it happened and is labelled simulated and live', alert.latitude !== null && alert.longitude !== null && alert.simulated && !alert.delayed);
    await ctx.waitFor('alert pushed to the browser', async () => (ctx.socket.alerts.length >= 1 ? true : null), 10_000).catch(() => undefined);
    ctx.check('the browser received it live', ctx.socket.alerts.length === 1 && ctx.socket.alerts[0]!.id === alert.id);

    // Slow down, then speed again INSIDE the cooldown: no second alert.
    await sendLive(ctx, [at(10, 40), at(11, 40)]);
    await sendLive(ctx, Array.from({ length: 7 }, (_, i) => at(12 + i, 90)));
    await ctx.sleep(4000);
    ctx.check('a second episode inside the cooldown is not alerted again', (await ctx.alerts('OVERSPEED')).length === 1);
    if (ctx.stats) ctx.check('the suppression was counted', ((await ctx.stats())['alerts_suppressed_cooldown'] ?? 0) >= 1);
  },
};
