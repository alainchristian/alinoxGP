/**
 * GPS-engine port (spec §5.2, skill gps-traccar-integration §2). The rest of the application depends ONLY
 * on this interface and these normalized types; Traccar types never leave `./traccar`.
 *
 * Implemented in M2: device registration/lookup/listing, latest positions, route history and the live
 * stream. Trips, stops, geofences and commands are added to this interface by the milestones that use them
 * (M6 / M7) — not stubbed here.
 */

/** Opaque reference to a device inside the engine. */
export interface EngineDeviceRef {
  /** Engine-side numeric id. */
  engineId: number;
  /** Identifier the physical device transmits (usually the IMEI). */
  uniqueId: string;
}

export interface EngineDevice extends EngineDeviceRef {
  name: string;
  disabled: boolean;
  /** Connectivity as the ENGINE sees it. Our own offline detection is the authority for the product. */
  engineStatus: 'online' | 'offline' | 'unknown';
  lastUpdate: Date | null;
}

/**
 * A position normalized at the adapter boundary (skill gps-position-pipeline §2):
 * speed in km/h, UTC dates, tri-state booleans (`null` = the device did not report it — never `false`).
 */
export interface EnginePosition {
  engineDeviceId: number;
  /** Engine position id; unique per engine, used to de-duplicate redelivery. */
  engineId: number;
  /** When the GPS fix happened (orders positions). */
  fixTime: Date;
  /** When the device says it sent it. */
  deviceTime: Date;
  /** When the engine received it (drives connectivity). */
  serverTime: Date;
  latitude: number;
  longitude: number;
  altitudeM: number | null;
  /** km/h, rounded to 0.1. null if the device did not report speed. */
  speedKmh: number | null;
  /** degrees 0–360 */
  heading: number | null;
  accuracyM: number | null;
  /** The engine's own GPS-validity flag. */
  valid: boolean;
  ignition: boolean | null;
  motion: boolean | null;
  /** External supply voltage in volts, if reported. */
  externalPowerV: number | null;
  /** Backup battery level in percent, if reported. */
  batteryPercent: number | null;
  satellites: number | null;
  /** True if the device flagged itself as simulated (OsmAnd `simulated=true`). Never trusted alone. */
  declaredSimulated: boolean;
  protocol: string;
  /** Unmapped attribute bag, kept for diagnostics only; not exposed through the product API. */
  raw: Record<string, unknown>;
}

export type EngineStreamMessage =
  | { kind: 'position'; position: EnginePosition }
  | { kind: 'device'; device: EngineDevice }
  | { kind: 'connection'; state: 'connected' | 'disconnected'; detail?: string }
  /** An item (or whole frame) that failed validation and was dropped. Counted, never forwarded. */
  | { kind: 'malformed'; what: 'frame' | 'position' | 'device' };

/**
 * A journey as the engine detected it (Traccar's trip report; its start/stop rules are engine configuration, see
 * docs/GPS_INTEGRATION.md). Distances in metres, speeds in km/h, times UTC. Coordinates are `null` when the engine did not give usable ones.
 */
export interface EngineTrip {
  startTime: Date;
  endTime: Date;
  durationMs: number;
  distanceM: number;
  maxSpeedKmh: number | null;
  averageSpeedKmh: number | null;
  startLatitude: number | null;
  startLongitude: number | null;
  endLatitude: number | null;
  endLongitude: number | null;
  /** Reverse-geocoded by the engine when it is configured to; usually null. */
  startAddress: string | null;
  endAddress: string | null;
}

/** A stop (parked period) as the engine detected it. */
export interface EngineStop {
  startTime: Date;
  endTime: Date;
  durationMs: number;
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

export interface EngineSubscription {
  stop(): Promise<void>;
}

export interface GpsEnginePort {
  /** Idempotent: returns the existing device if the unique id is already registered. */
  registerDevice(input: { uniqueId: string; name: string; model?: string }): Promise<EngineDevice>;
  findDeviceByUniqueId(uniqueId: string): Promise<EngineDevice | null>;
  /** All devices the engine knows (used by the reconciliation job). */
  listDevices(): Promise<EngineDevice[]>;
  updateDevice(ref: EngineDeviceRef, patch: Partial<{ name: string; disabled: boolean }>): Promise<void>;
  /** Removes a device from the engine (used only when a registration is rolled back or retired by an admin). */
  removeDevice(ref: EngineDeviceRef): Promise<void>;
  /** Latest position per device, for backfill after a stream reconnect. */
  getLatestPositions(): Promise<EnginePosition[]>;
  /** Raw route history. Callers MUST clip the range to assignment windows / plan limits first. */
  getRoute(ref: EngineDeviceRef, from: Date, to: Date): Promise<EnginePosition[]>;
  /** Trips of one device in the range (the engine's trip report). Same clipping rule as getRoute. */
  getTrips(ref: EngineDeviceRef, from: Date, to: Date): Promise<EngineTrip[]>;
  /** Stops of one device in the range (the engine's stop report). */
  getStops(ref: EngineDeviceRef, from: Date, to: Date): Promise<EngineStop[]>;
  /**
   * Live stream of positions and device status. Reconnects automatically (exponential backoff + jitter). After every
   * reconnect a `connection: connected` message is delivered so the consumer can backfill with getLatestPositions().
   */
  subscribe(handler: (message: EngineStreamMessage) => void | Promise<void>): EngineSubscription;
  /** Engine reachability and version, for the admin health endpoint. */
  health(): Promise<{ reachable: boolean; version: string | null; detail?: string }>;
}

export const GPS_ENGINE = Symbol('GPS_ENGINE');

/** Errors raised by an engine adapter; never contain provider response bodies. */
export class GpsEngineError extends Error {
  constructor(
    public readonly code: 'ENGINE_UNAVAILABLE' | 'ENGINE_AUTH_FAILED' | 'ENGINE_REJECTED' | 'ENGINE_PROTOCOL_ERROR',
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'GpsEngineError';
  }
}
