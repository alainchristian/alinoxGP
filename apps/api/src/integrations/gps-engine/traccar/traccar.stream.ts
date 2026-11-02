import { Logger } from '@nestjs/common';
import WebSocket from 'ws';
import type { EngineStreamMessage, EngineSubscription } from '../port';
import { toEngineDevice, toEnginePosition } from './traccar.mapper';
import { traccarDeviceSchema, traccarPositionSchema, traccarSocketFrameSchema } from './traccar.schemas';

type Handler = (message: EngineStreamMessage) => void | Promise<void>;

export interface StreamDeps {
  baseUrl: string;
  /** Returns the session cookie; `true` forces a fresh login (used after an authentication failure). */
  getCookie(forceRefresh?: boolean): Promise<string>;
}

const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;
const BACKOFF_MIN_MS = 1_000;
const BACKOFF_MAX_MS = 30_000;

/** Exponential backoff with full jitter, capped (skill gps-traccar-integration §5). Exported for tests. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  return Math.round(ceiling / 2 + random() * (ceiling / 2));
}

/**
 * Consumes Traccar's `/api/socket`. Everything received is untrusted: frames and items are validated with zod,
 * malformed ones are reported as `malformed` (and counted by the consumer) and never forwarded.
 *
 * Verified against 6.16.0: auth by session cookie header; frames are separate envelopes
 * (`{positions}`, `{devices}`, optionally `{events}`); only positions that become a device's NEWEST fix are pushed.
 */
export class TraccarStream implements EngineSubscription {
  private readonly logger = new Logger(TraccarStream.name);
  private socket: WebSocket | null = null;
  private stopped = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private pongTimer: NodeJS.Timeout | null = null;
  /** Serialises handler invocations so frames are processed in arrival order. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly deps: StreamDeps,
    private readonly handler: Handler,
  ) {}

  start(): this {
    void this.connect();
    return this;
  }

  private emit(message: EngineStreamMessage) {
    this.queue = this.queue
      .then(() => this.handler(message))
      .catch((err) => this.logger.error(`Stream handler failed: ${err instanceof Error ? err.message : String(err)}`));
  }

  private async connect(forceLogin = false): Promise<void> {
    if (this.stopped) return;
    let cookie: string;
    try {
      cookie = await this.deps.getCookie(forceLogin);
    } catch (err) {
      this.logger.warn(`Cannot authenticate to the GPS engine: ${err instanceof Error ? err.message : String(err)}`);
      this.scheduleReconnect('authentication failed');
      return;
    }
    if (this.stopped) return;

    const url = this.deps.baseUrl.replace(/^http/, 'ws') + '/api/socket';
    const ws = new WebSocket(url, { headers: { Cookie: cookie }, handshakeTimeout: 10_000 });
    this.socket = ws;

    ws.on('open', () => {
      this.attempt = 0;
      this.startHeartbeat(ws);
      this.emit({ kind: 'connection', state: 'connected' });
    });
    ws.on('message', (data) => this.onFrame(data.toString()));
    ws.on('pong', () => this.clearPongTimer());
    ws.on('unexpected-response', (_req, res) => {
      // 401/403 on upgrade: the session expired. Log in again, once per attempt.
      this.logger.warn(`GPS engine refused the WebSocket upgrade (${res.statusCode})`);
      res.resume();
      this.scheduleReconnect(`upgrade refused ${res.statusCode}`, res.statusCode === 401 || res.statusCode === 403);
    });
    ws.on('error', (err) => this.logger.warn(`GPS engine WebSocket error: ${err.message}`));
    ws.on('close', (code) => {
      this.stopHeartbeat();
      if (this.socket === ws) this.socket = null;
      if (!this.stopped) {
        this.emit({ kind: 'connection', state: 'disconnected', detail: `closed ${code}` });
        this.scheduleReconnect(`closed ${code}`);
      }
    });
  }

  private onFrame(text: string) {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.emit({ kind: 'malformed', what: 'frame' });
      return;
    }
    const frame = traccarSocketFrameSchema.safeParse(json);
    if (!frame.success) {
      this.emit({ kind: 'malformed', what: 'frame' });
      return;
    }
    for (const item of frame.data.positions ?? []) {
      const p = traccarPositionSchema.safeParse(item);
      if (p.success) this.emit({ kind: 'position', position: toEnginePosition(p.data) });
      else this.emit({ kind: 'malformed', what: 'position' });
    }
    for (const item of frame.data.devices ?? []) {
      const d = traccarDeviceSchema.safeParse(item);
      if (d.success) this.emit({ kind: 'device', device: toEngineDevice(d.data) });
      else this.emit({ kind: 'malformed', what: 'device' });
    }
  }

  private startHeartbeat(ws: WebSocket) {
    this.stopHeartbeat();
    this.pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      ws.ping();
      this.pongTimer = setTimeout(() => {
        this.logger.warn('No pong from the GPS engine; dropping the connection');
        ws.terminate();
      }, PONG_TIMEOUT_MS);
      this.pongTimer.unref?.();
    }, PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  private clearPongTimer() {
    if (this.pongTimer) clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  private stopHeartbeat() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    this.clearPongTimer();
  }

  private scheduleReconnect(reason: string, forceLogin = false) {
    if (this.stopped || this.reconnectTimer) return;
    const delay = backoffDelay(this.attempt++);
    this.logger.log(`Reconnecting to the GPS engine in ${delay} ms (${reason})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(forceLogin);
    }, delay);
    this.reconnectTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopHeartbeat();
    const ws = this.socket;
    this.socket = null;
    if (ws && ws.readyState !== WebSocket.CLOSED) {
      await new Promise<void>((resolve) => {
        ws.once('close', () => resolve());
        ws.terminate();
        setTimeout(resolve, 500).unref?.();
      });
    }
    await this.queue;
  }
}
