import { Injectable } from '@nestjs/common';
import {
  GpsEngineError,
  type EngineDevice,
  type EngineDeviceRef,
  type EnginePosition,
  type EngineStop,
  type EngineStreamMessage,
  type EngineSubscription,
  type EngineTrip,
  type GpsEnginePort,
} from '../port';

/**
 * In-memory GPS engine for UNIT tests of code that depends on the port. It is NOT used for any claim that
 * live tracking works — those tests run against a real Traccar fed by the simulator (spec rule 3).
 * Refused in production by environment validation.
 */
@Injectable()
export class FakeEngineAdapter implements GpsEnginePort {
  private nextId = 1;
  private nextPositionId = 1;
  private readonly devices = new Map<number, EngineDevice>();
  private readonly positions: EnginePosition[] = [];
  private readonly handlers = new Set<(m: EngineStreamMessage) => void | Promise<void>>();
  /** Set to make every call fail like an unreachable engine. */
  unavailable = false;

  private guard() {
    if (this.unavailable) throw new GpsEngineError('ENGINE_UNAVAILABLE', 'fake engine unavailable');
  }

  async registerDevice(input: { uniqueId: string; name: string }): Promise<EngineDevice> {
    this.guard();
    const existing = await this.findDeviceByUniqueId(input.uniqueId);
    if (existing) return existing;
    const device: EngineDevice = { engineId: this.nextId++, uniqueId: input.uniqueId, name: input.name, disabled: false, engineStatus: 'offline', lastUpdate: null };
    this.devices.set(device.engineId, device);
    return device;
  }

  async findDeviceByUniqueId(uniqueId: string) {
    this.guard();
    return [...this.devices.values()].find((d) => d.uniqueId === uniqueId) ?? null;
  }

  async listDevices() {
    this.guard();
    return [...this.devices.values()];
  }

  async updateDevice(ref: EngineDeviceRef, patch: Partial<{ name: string; disabled: boolean }>) {
    this.guard();
    const d = this.devices.get(ref.engineId);
    if (!d) throw new GpsEngineError('ENGINE_REJECTED', 'not found', 404);
    Object.assign(d, patch);
  }

  async removeDevice(ref: EngineDeviceRef) {
    this.guard();
    this.devices.delete(ref.engineId);
  }

  async getLatestPositions() {
    this.guard();
    const latest = new Map<number, EnginePosition>();
    for (const p of this.positions) {
      const cur = latest.get(p.engineDeviceId);
      if (!cur || p.fixTime >= cur.fixTime) latest.set(p.engineDeviceId, p);
    }
    return [...latest.values()];
  }

  async getRoute(ref: EngineDeviceRef, from: Date, to: Date) {
    this.guard();
    return this.positions.filter((p) => p.engineDeviceId === ref.engineId && p.fixTime >= from && p.fixTime <= to);
  }

  /** Test data for the report queries. */
  readonly trips = new Map<number, EngineTrip[]>();
  readonly stops = new Map<number, EngineStop[]>();

  async getTrips(ref: EngineDeviceRef, from: Date, to: Date) {
    this.guard();
    return (this.trips.get(ref.engineId) ?? []).filter((t) => t.endTime >= from && t.startTime <= to);
  }

  async getStops(ref: EngineDeviceRef, from: Date, to: Date) {
    this.guard();
    return (this.stops.get(ref.engineId) ?? []).filter((s) => s.endTime >= from && s.startTime <= to);
  }

  subscribe(handler: (m: EngineStreamMessage) => void | Promise<void>): EngineSubscription {
    this.handlers.add(handler);
    void handler({ kind: 'connection', state: 'connected' });
    return { stop: async () => void this.handlers.delete(handler) };
  }

  async health() {
    return this.unavailable ? { reachable: false, version: null } : { reachable: true, version: 'fake' };
  }

  // ---- test helpers -------------------------------------------------------------------------------------
  /** Delivers a position to subscribers the way the real stream would. */
  async emitPosition(engineDeviceId: number, partial: Partial<EnginePosition> = {}): Promise<EnginePosition> {
    const now = new Date();
    const position: EnginePosition = {
      engineDeviceId,
      engineId: this.nextPositionId++,
      fixTime: now,
      deviceTime: now,
      serverTime: now,
      latitude: -1.9441,
      longitude: 30.0619,
      altitudeM: null,
      speedKmh: 0,
      heading: null,
      accuracyM: null,
      valid: true,
      ignition: null,
      motion: null,
      externalPowerV: null,
      batteryPercent: null,
      satellites: null,
      declaredSimulated: false,
      protocol: 'fake',
      raw: {},
      ...partial,
    };
    this.positions.push(position);
    for (const h of this.handlers) await h({ kind: 'position', position });
    return position;
  }
}
