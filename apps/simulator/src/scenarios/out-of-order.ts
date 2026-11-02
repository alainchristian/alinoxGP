import type { Scenario } from '../scenario/types';

export const outOfOrder: Scenario = {
  name: 'out-of-order',
  description: 'Fixes reach the server in the wrong order: t1, t3, then t2, then t4.',
  proves: 'The latest state never goes backwards, and the stored history is in fix-time order regardless of arrival order.',
  async run(ctx) {
    // The engine stores fix times at one-second resolution (OsmAnd timestamps are whole seconds): align ours.
    const base = Math.floor(Date.now() / 1000) * 1000;
    const at = (s: number, lat: number) => ({ time: base + s * 1000, latitude: lat, longitude: 30.0619, speedKmh: 30, ignition: true });
    const t1 = at(0, -1.9441);
    const t2 = at(2, -1.9443);
    const t3 = at(4, -1.9445);
    const t4 = at(6, -1.9447);

    await ctx.send(t1);
    await ctx.sleep(800);
    await ctx.send(t3); // t3 before t2
    await ctx.waitFor('t3 applied', async () => ((await ctx.location())?.latitude === t3.latitude ? true : null));

    await ctx.send(t2); // arrives late: older than what we already show
    await ctx.sleep(6000);
    const afterLate = (await ctx.location())!;
    ctx.check('the late (older) fix does not move the vehicle back', afterLate.latitude === t3.latitude, `latitude ${afterLate.latitude}`);
    ctx.check('the latest fix time is still t3', new Date(afterLate.lastFixAt!).getTime() === t3.time);

    await ctx.send(t4);
    const latest = await ctx.waitFor('t4 applied', async () => ((await ctx.location())?.latitude === t4.latitude ? await ctx.location() : null));
    ctx.check('normal order resumes with t4', new Date(latest!.lastFixAt!).getTime() === t4.time);

    if (ctx.engine) {
      const history = await ctx.waitFor('all four fixes stored', async () => {
        const h = await ctx.engine!.history(ctx.deviceUniqueId);
        return h.length >= 4 ? h : null;
      });
      const lats = history.map((h) => h.latitude);
      ctx.check('history is ordered by fix time, with the late fix in its right place', JSON.stringify(lats) === JSON.stringify([t1.latitude, t2.latitude, t3.latitude, t4.latitude]), lats.join(', '));
    } else ctx.note('History order not checked (no engine access).');
  },
};
