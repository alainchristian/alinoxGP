import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ENV, type Env } from '../../../infrastructure/config/env';
import {
  GpsEngineError,
  type EngineDevice,
  type EngineDeviceRef,
  type EnginePosition,
  type EngineStreamMessage,
  type EngineSubscription,
  type GpsEnginePort,
} from '../port';
import { TraccarClient } from './traccar.client';
import { toEngineDevice, toEnginePosition } from './traccar.mapper';
import { traccarDeviceSchema, traccarPositionSchema, type TraccarDevice } from './traccar.schemas';
import { TraccarStream } from './traccar.stream';

/** Parses a list from the engine; malformed items are dropped (logged without payloads), never thrown. */
function parseList<T>(schema: z.ZodType<T>, body: unknown, logger: Logger, what: string): T[] {
  if (!Array.isArray(body)) throw new GpsEngineError('ENGINE_PROTOCOL_ERROR', `GPS engine returned a non-list for ${what}`);
  const out: T[] = [];
  let dropped = 0;
  for (const item of body) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
    else dropped++;
  }
  if (dropped > 0) logger.warn(`Dropped ${dropped} malformed ${what} item(s) from the GPS engine`);
  return out;
}

/** The ONLY class that knows Traccar's API. Everything it returns is normalized (`port.ts`). */
@Injectable()
export class TraccarAdapter implements GpsEnginePort {
  private readonly logger = new Logger(TraccarAdapter.name);

  constructor(
    private readonly client: TraccarClient,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async fetchByUniqueId(uniqueId: string): Promise<TraccarDevice | null> {
    // `all=true`: an administrator otherwise sees only devices linked to its own user.
    const { body } = await this.client.request<unknown>('GET', '/api/devices', { query: { uniqueId, all: true } });
    return parseList(traccarDeviceSchema, body, this.logger, 'device').find((d) => d.uniqueId === uniqueId) ?? null;
  }

  async findDeviceByUniqueId(uniqueId: string): Promise<EngineDevice | null> {
    const d = await this.fetchByUniqueId(uniqueId);
    return d ? toEngineDevice(d) : null;
  }

  /** Idempotent. Duplicate unique ids are refused by Traccar with 400, so a lost race is resolved by re-reading. */
  async registerDevice(input: { uniqueId: string; name: string; model?: string }): Promise<EngineDevice> {
    const existing = await this.fetchByUniqueId(input.uniqueId);
    if (existing) return toEngineDevice(existing);
    try {
      const { body } = await this.client.request<unknown>('POST', '/api/devices', {
        body: { name: input.name, uniqueId: input.uniqueId, ...(input.model ? { model: input.model } : {}) },
      });
      return toEngineDevice(traccarDeviceSchema.parse(body));
    } catch (err) {
      if (err instanceof GpsEngineError && err.code === 'ENGINE_REJECTED') {
        const raced = await this.fetchByUniqueId(input.uniqueId);
        if (raced) return toEngineDevice(raced);
      }
      throw err;
    }
  }

  async listDevices(): Promise<EngineDevice[]> {
    const { body } = await this.client.request<unknown>('GET', '/api/devices', { query: { all: true } });
    return parseList(traccarDeviceSchema, body, this.logger, 'device').map(toEngineDevice);
  }

  async updateDevice(ref: EngineDeviceRef, patch: Partial<{ name: string; disabled: boolean }>): Promise<void> {
    // PUT replaces the whole object: read-modify-write so unrelated fields are never wiped.
    const { body } = await this.client.request<unknown>('GET', '/api/devices', { query: { id: ref.engineId, all: true } });
    const current = parseList(traccarDeviceSchema, body, this.logger, 'device').find((d) => d.id === ref.engineId);
    if (!current) throw new GpsEngineError('ENGINE_REJECTED', 'Device not found in the GPS engine', 404);
    const full = (Array.isArray(body) ? body : []).find((d: { id?: number }) => d.id === ref.engineId) as Record<string, unknown>;
    await this.client.request('PUT', `/api/devices/${ref.engineId}`, { body: { ...full, ...patch } });
  }

  async removeDevice(ref: EngineDeviceRef): Promise<void> {
    await this.client.request('DELETE', `/api/devices/${ref.engineId}`, { acceptStatuses: [404] });
  }

  async getLatestPositions(): Promise<EnginePosition[]> {
    const { body } = await this.client.request<unknown>('GET', '/api/positions', { timeoutMs: this.env.TRACCAR_REPORT_TIMEOUT_MS });
    return parseList(traccarPositionSchema, body, this.logger, 'position').map(toEnginePosition);
  }

  async getRoute(ref: EngineDeviceRef, from: Date, to: Date): Promise<EnginePosition[]> {
    const { body } = await this.client.request<unknown>('GET', '/api/positions', {
      query: { deviceId: ref.engineId, from: from.toISOString(), to: to.toISOString() },
      timeoutMs: this.env.TRACCAR_REPORT_TIMEOUT_MS,
    });
    return parseList(traccarPositionSchema, body, this.logger, 'position').map(toEnginePosition);
  }

  subscribe(handler: (message: EngineStreamMessage) => void | Promise<void>): EngineSubscription {
    return new TraccarStream(
      { baseUrl: this.client.baseUrl, getCookie: (force) => this.client.sessionCookie(force) },
      handler,
    ).start();
  }

  async health(): Promise<{ reachable: boolean; version: string | null; detail?: string }> {
    try {
      const info = await this.client.serverInfo();
      return { reachable: true, version: info.version ?? null };
    } catch (err) {
      return { reachable: false, version: null, detail: err instanceof GpsEngineError ? err.code : 'ENGINE_UNAVAILABLE' };
    }
  }
}
