import type { Scenario } from '../scenario/types';
import { STEP_MS, isSubsequence, sendLive, statusSequence } from './helpers';

export const stopping: Scenario = {
  name: 'stopping',
  description: 'The vehicle drives, stops with the engine running, then switches the ignition off.',
  proves: 'MOVING -> STATIONARY -> IDLING (after the idle threshold) -> PARKED (ignition off), pushed to the browser as they happen.',
  async run(ctx) {
    const t = ctx.thresholds;
    await sendLive(ctx, [
      { speedKmh: 40, ignition: true, latitude: -1.9441, longitude: 30.0619 },
      { speedKmh: 42, ignition: true, latitude: -1.9444, longitude: 30.0627 },
      { speedKmh: 41, ignition: true, latitude: -1.9447, longitude: 30.0635 },
    ]);
    await ctx.waitForStatus('MOVING');

    // Stop with the engine running; keep reporting (a parked tracker still sends) until it is IDLING.
    const stopStarted = Date.now();
    const limit = Date.now() + (t.idleAfterSec + 25) * 1000;
    let idling = false;
    while (Date.now() < limit && !idling) {
      await ctx.send({ speedKmh: 0, ignition: true, latitude: -1.9447, longitude: 30.0635 });
      await ctx.sleep(STEP_MS);
      idling = (await ctx.location())?.status === 'IDLING';
    }
    ctx.check('the stop turns into IDLING after the idle threshold', idling, `threshold ${t.idleAfterSec} s`);
    ctx.check('...but not before it (a brief stop is only STATIONARY)', Date.now() - stopStarted >= (t.idleAfterSec - 1) * 1000, `${Math.round((Date.now() - stopStarted) / 1000)} s`);

    await ctx.send({ speedKmh: 0, ignition: false, latitude: -1.9447, longitude: 30.0635 });
    const parked = await ctx.waitForStatus('PARKED');
    ctx.check('ignition off makes it PARKED', parked.status === 'PARKED' && parked.ignition === false);

    // The REST view and the socket feed are separate channels (the feed is coalesced): wait for the feed like a client would.
    const seen = await ctx.waitFor('every step pushed to the browser', async () => (isSubsequence(['MOVING', 'STATIONARY', 'IDLING', 'PARKED'], statusSequence(ctx)) ? true : null), 10_000).catch(() => false);
    const seq = statusSequence(ctx);
    ctx.check('the browser was told about each step, in order', seen === true, seq.join(' > '));

    if (ctx.engine) {
      const history = await ctx.engine.history(ctx.deviceUniqueId);
      ctx.check('every fix of the journey is in the engine history', history.length >= 5, `${history.length}`);
    }
    ctx.note('"Trip ends / stop recorded" is a trip-report feature (M6); Traccar only records trips above its minimum duration/distance.');
  },
};
