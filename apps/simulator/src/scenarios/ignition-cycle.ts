import type { Scenario } from '../scenario/types';
import { ownDeltas, sendLive } from './helpers';

export const ignitionCycle: Scenario = {
  name: 'ignition-cycle',
  description: 'While stationary the ignition is switched on and off several times.',
  proves: 'Ignition alerts fire on real transitions only (the first report is not a change), exactly once each, and a parked vehicle never looks like it is moving.',
  async run(ctx) {
    await ctx.createAlertRule({ type: 'IGNITION_ON', cooldownSeconds: 0 });
    await ctx.createAlertRule({ type: 'IGNITION_OFF', cooldownSeconds: 0 });

    // false (first report: no alert) -> true (ON) -> false (OFF) -> true (ON) -> false (OFF)
    const sequence = [false, true, false, true, false];
    await sendLive(ctx, sequence.map((ignition) => ({ ignition, speedKmh: 0, latitude: -1.9441, longitude: 30.0619 })), 4000);

    const alerts = await ctx.waitFor('4 ignition alerts', async () => {
      const a = await ctx.alerts();
      return a.length >= 4 ? a : null;
    });
    await ctx.sleep(3000); // a 5th alert (e.g. from the first report) would show up now
    const all = await ctx.alerts();
    const on = all.filter((a) => a.type === 'IGNITION_ON').length;
    const off = all.filter((a) => a.type === 'IGNITION_OFF').length;
    ctx.check('two IGNITION_ON alerts', on === 2, `${on}`);
    ctx.check('two IGNITION_OFF alerts', off === 2, `${off}`);
    ctx.check('the first report did not raise an alert (null -> value is not a change)', all.length === 4 && alerts.length >= 4, `${all.length} alerts`);
    ctx.check('alerts are labelled simulated and not delayed', all.every((a) => a.simulated && !a.delayed));
    await ctx.waitFor('alerts pushed to the browser', async () => (ctx.socket.alerts.length >= 4 ? true : null), 10_000).catch(() => undefined);
    ctx.check('the browser received exactly those alerts live too', ctx.socket.alerts.length === 4, `${ctx.socket.alerts.length}`);

    ctx.check('a stationary vehicle never looks like it is moving', !ownDeltas(ctx).some((d) => d.status === 'MOVING'));
    const final = (await ctx.location())!;
    ctx.check('final state: ignition off and PARKED', final.ignition === false && final.status === 'PARKED', `${final.status}`);
    if (ctx.engine) ctx.check('no trips for zero-distance cycles', (await ctx.engine.trips(ctx.deviceUniqueId)).length === 0);
  },
};
