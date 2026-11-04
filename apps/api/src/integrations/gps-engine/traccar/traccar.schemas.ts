import { z } from 'zod';

/**
 * Shapes of Traccar 6.16.0 JSON as RECORDED in test/fixtures/traccar (not invented). Everything that comes
 * from the engine is untrusted input: it is parsed here, and malformed items are dropped and counted by the
 * caller. Unknown fields are ignored (strip) so minor engine additions do not break us.
 */
export const traccarDeviceSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  uniqueId: z.string(),
  status: z.string().nullable().optional(),
  disabled: z.boolean().optional().default(false),
  lastUpdate: z.string().nullable().optional(),
  positionId: z.number().int().nullable().optional(),
  model: z.string().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
});
export type TraccarDevice = z.infer<typeof traccarDeviceSchema>;

export const traccarPositionSchema = z.object({
  id: z.number().int(),
  deviceId: z.number().int(),
  protocol: z.string().nullable().optional(),
  serverTime: z.string(),
  deviceTime: z.string(),
  fixTime: z.string(),
  valid: z.boolean().optional().default(true),
  latitude: z.number(),
  longitude: z.number(),
  altitude: z.number().nullable().optional(),
  /** KNOTS (Traccar's native unit). */
  speed: z.number().nullable().optional(),
  course: z.number().nullable().optional(),
  accuracy: z.number().nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional().default({}),
});
export type TraccarPosition = z.infer<typeof traccarPositionSchema>;

/**
 * One WebSocket frame. Traccar sends separate envelopes: `{positions:[…]}`, `{devices:[…]}` and, for users with
 * web notifications configured, `{events:[…]}`. Items are validated one by one by the caller.
 */
export const traccarSocketFrameSchema = z.object({
  positions: z.array(z.unknown()).optional(),
  devices: z.array(z.unknown()).optional(),
  events: z.array(z.unknown()).optional(),
});

/** One row of /api/reports/trips (recorded fixture report-trips.json). distance is metres; speeds are KNOTS. */
export const traccarTripSchema = z.object({
  deviceId: z.number().int(),
  startTime: z.string(),
  endTime: z.string(),
  duration: z.number().nullable().optional(),
  distance: z.number().nullable().optional(),
  averageSpeed: z.number().nullable().optional(),
  maxSpeed: z.number().nullable().optional(),
  startLat: z.number().nullable().optional(),
  startLon: z.number().nullable().optional(),
  endLat: z.number().nullable().optional(),
  endLon: z.number().nullable().optional(),
  startAddress: z.string().nullable().optional(),
  endAddress: z.string().nullable().optional(),
});
export type TraccarTrip = z.infer<typeof traccarTripSchema>;

/** One row of /api/reports/stops (the coordinate field names were confirmed against a real report by test/history.e2e-spec.ts). */
export const traccarStopSchema = z.object({
  deviceId: z.number().int(),
  startTime: z.string(),
  endTime: z.string(),
  duration: z.number().nullable().optional(),
  /** Stop items name the coordinates in full (trip items use startLat/endLat). Confirmed by the real report in history.e2e-spec.ts. */
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  address: z.string().nullable().optional(),
});
export type TraccarStop = z.infer<typeof traccarStopSchema>;
