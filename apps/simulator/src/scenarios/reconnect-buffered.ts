import type { Scenario } from '../scenario/types';
import { ownDeltas, sendLive } from './helpers';

export const reconnectBuffered: Scenario = {
  name: 'reconnect-buffered',
  description: 'After an outage the tracker reconnects and uploads what it recorded meanwhile (one stretch at 120 km/h), then reports live again.',
  proves: 'Buffered data fills the history and revives the vehicle, never regresses the latest state, and raises NO real-time alerts as if it were happening now — while live data still does.',
  async run(ctx) {
    const t = ctx.thresholds;
    await ctx.createAlertRule({ type: 'DEVICE_OFFLINE', cooldownSeconds: 0 });
    await ctx.createAlertRule({ type: 'OVERSPEED', params: { speedLimitKmh: 60, minDurationSec: 2 }, cooldownSeconds: 0 });

    const live = await sendLive(ctx, [
      { speedKmh: 40, ignition: true, latitude: -1.9441, longitude: 30.0619 },
      { speedKmh: 40, ignition: true, latitude: -1.9444, longitude: 30.0627 },
      { speedKmh: 40, ignition: true, latitude: -1.9447, longitude: 30.0635 },
    ]);
    const lastLive = live[live.length - 1]!;
    await ctx.waitForStatus('MOVING');
    await ctx.waitForStatus('OFFLINE', (t.offlineAfterSec + 20) * 1000);
    await ctx.waitFor('offline alert', async () => ((await ctx.alerts('DEVICE_OFFLINE')).length >= 1 ? true : null));

    // Make sure the recorded fixes are clearly OLD relative to the moment they are uploaded.
    const needAgeMs = (t.offlineAfterSec + 12) * 1000;
    const wait = lastLive + needAgeMs - Date.now();
    if (wait > 0) await ctx.sleep(wait);

    // ---- the tracker reconnects and uploads its buffer: fixes recorded DURING the outage, newer than the last live one.
    const buffered = [2, 4, 6, 8].map((s, i) => ({
      time: lastLive + s * 1000,
      speedKmh: i >= 1 ? 120 : 50, // a stretch of 120 km/h inside the buffer
      ignition: true,
      latitude: -1.9450 - i * 0.0003,
      longitude: 30.0640 + i * 0.0008,
    }));
    for (const f of buffered) await ctx.send(f);

    const revived = await ctx.waitFor('vehicle revived by buffered data', async () => {
      const l = await ctx.location();
      return l && l.status !== 'OFFLINE' && l.lastFixDelayed ? l : null;
    });
    ctx.check('uploading old data proves the device is alive: no longer OFFLINE', revived.status !== 'OFFLINE', revived.status);
    ctx.check('the latest fix is flagged delayed (it describes the past)', revived.lastFixDelayed === true);
    await ctx.waitFor('delayed flag pushed to the browser', async () => (ownDeltas(ctx).some((d) => d.lastFixDelayed) ? true : null), 10_000).catch(() => undefined);
    ctx.check('the browser was told it is delayed', ownDeltas(ctx).some((d) => d.lastFixDelayed));

    await ctx.sleep(5000);
    ctx.check('NO overspeed alert for the buffered 120 km/h stretch', (await ctx.alerts('OVERSPEED')).length === 0);
    if (ctx.stats) ctx.check('the suppression was counted', ((await ctx.stats())['alerts_suppressed_delayed'] ?? 0) >= 1);

    // ---- live again
    const liveAgain = await sendLive(ctx, [{ speedKmh: 40, ignition: true, latitude: -1.9460, longitude: 30.0700 }]);
    const nowLive = await ctx.waitFor('live fix applied', async () => {
      const l = await ctx.location();
      return l && l.lastFixAt && new Date(l.lastFixAt).getTime() >= liveAgain[0]! - 1500 && !l.lastFixDelayed ? l : null;
    });
    ctx.check('the latest state is the LIVE fix, not regressed to buffered data', nowLive.latitude === -1.946 && !nowLive.lastFixDelayed);

    // control: live speeding DOES alert (so the earlier silence was specific to delayed data)
    await sendLive(ctx, [
      { speedKmh: 120, ignition: true, latitude: -1.9470, longitude: 30.0710 },
      { speedKmh: 120, ignition: true, latitude: -1.9480, longitude: 30.0720 },
      { speedKmh: 120, ignition: true, latitude: -1.9490, longitude: 30.0730 },
    ], 1500);
    const over = await ctx.waitFor('live overspeed alert', async () => {
      const a = await ctx.alerts('OVERSPEED');
      return a.length >= 1 ? a : null;
    });
    ctx.check('live overspeed still raises an alert', over.length >= 1 && over.every((a) => !a.delayed));

    if (ctx.engine) {
      const history = await ctx.engine.history(ctx.deviceUniqueId);
      ctx.check('the engine history contains the buffered fixes in fix-time order', history.length >= 3 + buffered.length && history.every((h, i) => i === 0 || h.fixTime >= history[i - 1]!.fixTime), `${history.length} positions`);
    }
  },
};
