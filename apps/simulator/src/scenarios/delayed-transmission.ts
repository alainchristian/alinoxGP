import type { Scenario } from '../scenario/types';

export const delayedTransmission: Scenario = {
  name: 'delayed-transmission',
  description: 'Positions arrive minutes after they were recorded (poor coverage), including a stretch at 120 km/h.',
  proves: 'Late data is marked delayed and produces no real-time overspeed/ignition alerts, while the same speeding reported live does.',
  async run(ctx) {
    await ctx.createAlertRule({ type: 'OVERSPEED', params: { speedLimitKmh: 60, minDurationSec: 2 }, cooldownSeconds: 0 });
    await ctx.createAlertRule({ type: 'IGNITION_OFF', cooldownSeconds: 0 });

    // Four fixes recorded 45-60 s ago, uploaded now (speeding, and the ignition switches off at the end).
    const now = Date.now();
    const old = [60, 55, 50, 45].map((age, i) => ({
      time: now - age * 1000,
      speedKmh: 120,
      ignition: i < 3,
      latitude: -1.9441 - i * 0.0004,
      longitude: 30.0619 + i * 0.0009,
    }));
    for (const f of old) await ctx.send(f);

    const loc = await ctx.waitFor('delayed fixes applied', async () => {
      const l = await ctx.location();
      return l && l.lastFixDelayed ? l : null;
    });
    ctx.check('the position is marked delayed', loc.lastFixDelayed === true);
    ctx.check('...yet it is still the best known position (data is not discarded)', loc.latitude !== null && loc.speedKmh !== null && loc.speedKmh > 100, `${loc.speedKmh} km/h`);
    await ctx.sleep(6000);
    ctx.check('NO overspeed alert for speeding that happened a minute ago', (await ctx.alerts('OVERSPEED')).length === 0);
    ctx.check('NO ignition-off alert for an ignition change that happened a minute ago', (await ctx.alerts('IGNITION_OFF')).length === 0);
    if (ctx.stats) ctx.check('the suppression was counted', ((await ctx.stats())['alerts_suppressed_delayed'] ?? 0) >= 1);

    // Control: the same speeding, live, must alert.
    for (let i = 0; i < 4; i++) {
      await ctx.send({ speedKmh: 120, ignition: true, latitude: -1.95 - i * 0.0004, longitude: 30.07 + i * 0.0009 });
      await ctx.sleep(1500);
    }
    const alerts = await ctx.waitFor('live overspeed alert', async () => {
      const a = await ctx.alerts('OVERSPEED');
      return a.length >= 1 ? a : null;
    });
    ctx.check('live speeding raises an alert (control)', alerts.length >= 1 && alerts.every((a) => !a.delayed));
  },
};
