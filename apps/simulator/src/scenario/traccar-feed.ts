/**
 * Listens to the GPS engine's OWN WebSocket (the same feed the platform consumes) and records when each position was
 * emitted. Comparing that moment with the moment the browser-side socket receives the matching delta isolates the
 * PLATFORM's share of the latency — position-to-socket — from the engine's own buffering and queueing.
 *
 * Observer only: it never sends anything and never writes.
 */
export interface EngineFeedOptions {
  /** Traccar REST base, e.g. http://localhost:58092 */
  restUrl: string;
  user: string;
  password: string;
}

type WithHeaders = new (url: string, options: { headers: Record<string, string> }) => WebSocket;

export class TraccarFeed {
  /** `engineDeviceId|fixTimeMs` -> when this listener first saw the position (ms since epoch). */
  readonly seenAt = new Map<string, number>();
  private ws: WebSocket | null = null;
  private cookie = '';
  private deviceIds = new Map<string, number>();

  constructor(private readonly opts: EngineFeedOptions) {}

  static key(engineDeviceId: number, fixTimeMs: number): string {
    return `${engineDeviceId}|${fixTimeMs}`;
  }

  async open(): Promise<void> {
    const login = await fetch(`${this.opts.restUrl}/api/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: this.opts.user, password: this.opts.password }),
    });
    if (!login.ok) throw new Error(`Engine feed: login failed (HTTP ${login.status})`);
    this.cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    // Node's global WebSocket (undici) accepts request headers as a second argument; the DOM typings do not know that.
    const Ctor = WebSocket as unknown as WithHeaders;
    const ws = new Ctor(this.opts.restUrl.replace(/^http/, 'ws') + '/api/socket', { headers: { cookie: this.cookie } });
    ws.onmessage = (ev: MessageEvent) => {
      const now = Date.now();
      let frame: { positions?: { deviceId: number; fixTime: string }[] };
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      for (const p of frame.positions ?? []) {
        const k = TraccarFeed.key(p.deviceId, Date.parse(p.fixTime));
        if (!this.seenAt.has(k)) this.seenAt.set(k, now);
      }
    };
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Engine feed: WebSocket could not connect'));
    });
    this.ws = ws;
  }

  /** Engine device id for each of our unique ids (the engine numbers devices itself). */
  async engineIds(uniqueIds: string[]): Promise<Map<string, number>> {
    const res = await fetch(`${this.opts.restUrl}/api/devices`, { headers: { cookie: this.cookie, accept: 'application/json' } });
    const devices = (await res.json()) as { id: number; uniqueId: string }[];
    const wanted = new Set(uniqueIds);
    this.deviceIds = new Map(devices.filter((d) => wanted.has(d.uniqueId)).map((d) => [d.uniqueId, d.id]));
    return this.deviceIds;
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
