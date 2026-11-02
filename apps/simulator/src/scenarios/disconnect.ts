import type { Scenario } from '../scenario/types';
import { sendLive } from './helpers';

export const disconnect: Scenario = {
  name: 'disconnect',
  description: 'A driving vehicle stops reporting (tracker loses power or network), comes back, and disappears again.',
  proves: 'The vehicle becomes OFFLINE after the threshold (derived from OUR last-seen time), the browser is told, one offline alert is raised, and flapping inside the cooldown does not raise a second one.',
  async run(ctx) {
    const t = ctx.thresholds;
    await ctx.createAlertRule({ type: 'DEVICE_OFFLINE', cooldownSeconds: 300 });
    const drive = [
      { speedKmh: 40, ignition: true, latitude: -1.9441, longitude: 30.0619 },
      { speedKmh: 40, ignition: true, latitude: -1.9444, longitude: 30.0627 },
      { speedKmh: 40, ignition: true, latitude: -1.9447, longitude: 30.0635 },
    ];
    await sendLive(ctx, drive);
    await ctx.waitForStatus('MOVING');

    // ---- silence: nothing is sent
    const silentSince = Date.now();
    await ctx.waitForStatus('OFFLINE', (t.offlineAfterSec + 20) * 1000);
    const waited = (Date.now() - silentSince) / 1000;
    ctx.check('OFFLINE only after the threshold has passed', waited >= t.offlineAfterSec - 4, `${Math.round(waited)} s of silence, threshold ${t.offlineAfterSec} s`);

    const sawOffline = await ctx.waitFor('OFFLINE pushed to the browser', async () => ctx.socket.deltas.some((d) => d.vehicleId === ctx.vehicleId && d.status === 'OFFLINE'), 15_000);
    ctx.check('the browser received the OFFLINE update (not only a refresh)', sawOffline === true);
    const first = await ctx.waitFor('one offline alert', async () => {
      const a = await ctx.alerts('DEVICE_OFFLINE');
      return a.length >= 1 ? a : null;
    });
    ctx.check('exactly one DEVICE_OFFLINE alert', first.length === 1, `${first.length}`);
    ctx.check('the alert carries the last known position and is simulated', first[0]!.latitude !== null && first[0]!.simulated === true);

    // ---- it comes back, then vanishes again inside the cooldown
    await sendLive(ctx, [{ speedKmh: 40, ignition: true, latitude: -1.9450, longitude: 30.0640 }]);
    const back = await ctx.waitFor('back online', async () => {
      const l = await ctx.location();
      return l && l.status !== 'OFFLINE' ? l : null;
    });
    ctx.check('a new message brings it back from OFFLINE', back.status !== 'OFFLINE', back.status);
    await ctx.waitForStatus('OFFLINE', (t.offlineAfterSec + 20) * 1000);
    await ctx.sleep(3000);
    const all = await ctx.alerts('DEVICE_OFFLINE');
    ctx.check('going offline again inside the cooldown does not raise a second alert', all.length === 1, `${all.length}`);
    if (ctx.stats) ctx.check('the suppression was counted', ((await ctx.stats())['alerts_suppressed_cooldown'] ?? 0) >= 1);
  },
};
