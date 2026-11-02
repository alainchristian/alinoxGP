import type { Scenario } from '../scenario/types';
import { sendLive } from './helpers';

export const geofenceEnterExit: Scenario = {
  name: 'geofence-enter-exit',
  description: 'A circular geofence (200 m) is created and the vehicle drives through it: outside, inside, outside.',
  proves: 'ENGINE LEVEL ONLY in M3: Traccar raises exactly one enter and one exit event, in order, and the latitude-first WKT is right. Platform geofences, events, dwell and notifications are Milestone 6.',
  async run(ctx) {
    const engine = ctx.engine;
    if (!engine) return ctx.skip('needs engine access (TRACCAR_USER/TRACCAR_PASSWORD): geofences exist only inside the engine until M6');
    const centre = { latitude: -1.95, longitude: 30.07 };
    // The device must be known to the engine first.
    await ctx.send({ latitude: -1.96, longitude: 30.08, speedKmh: 30, ignition: true });
    await ctx.sleep(4500);
    const geofenceId = await engine.createGeofence(ctx.deviceUniqueId, `sim-${ctx.deviceUniqueId}`, centre.latitude, centre.longitude, 200);
    try {
      await sendLive(ctx, [
        { latitude: -1.96, longitude: 30.08, speedKmh: 30, ignition: true }, // outside
        { latitude: centre.latitude, longitude: centre.longitude, speedKmh: 30, ignition: true }, // inside
        { latitude: centre.latitude + 0.0004, longitude: centre.longitude + 0.0004, speedKmh: 30, ignition: true }, // still inside (~60 m)
        { latitude: -1.97, longitude: 30.09, speedKmh: 30, ignition: true }, // outside
      ], 2500);
      const events = await ctx.waitFor('enter and exit events', async () => {
        const e = (await engine.events(ctx.deviceUniqueId)).filter((x) => x.geofenceId === geofenceId);
        return e.some((x) => x.type === 'geofenceEnter') && e.some((x) => x.type === 'geofenceExit') ? e : null;
      }, 25_000);
      const enters = events.filter((e) => e.type === 'geofenceEnter');
      const exits = events.filter((e) => e.type === 'geofenceExit');
      ctx.check('exactly one geofence enter', enters.length === 1, `${enters.length}`);
      ctx.check('exactly one geofence exit', exits.length === 1, `${exits.length}`);
      ctx.check('enter happened before exit', enters[0]!.eventTime < exits[0]!.eventTime);
      ctx.note('Not asserted (M6): platform geofence entity, notification enqueue, dwell events.');
    } finally {
      await engine.deleteGeofence(geofenceId);
    }
  },
};
