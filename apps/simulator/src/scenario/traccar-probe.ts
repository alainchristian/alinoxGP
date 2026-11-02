/**
 * ENGINE-LEVEL observer for scenarios: reads what Traccar itself recorded (history, trips, events) and manages a
 * geofence directly in Traccar. It is TEST TOOLING — application code never touches Traccar except through the
 * `GpsEnginePort` adapter. It exists because trips, history and geofence events are exposed by the platform only in
 * Milestone 6; until then these facts can be verified at the engine, which is where they are produced.
 */
export interface ProbeEvent {
  type: string;
  eventTime: string;
  geofenceId: number;
}

export class TraccarProbe {
  private cookie: string | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly user: string,
    private readonly password: string,
  ) {}

  private async login() {
    const res = await fetch(`${this.baseUrl}/api/session`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: this.user, password: this.password }) });
    if (!res.ok) throw new Error(`Engine probe login failed (${res.status})`);
    this.cookie = res.headers.get('set-cookie')!.split(';')[0]!;
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (!this.cookie) await this.login();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Cookie: this.cookie!, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Engine probe ${method} ${path} -> ${res.status}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private async deviceId(uniqueId: string): Promise<number> {
    const list = await this.api<{ id: number; uniqueId: string }[]>('GET', `/api/devices?uniqueId=${encodeURIComponent(uniqueId)}&all=true`);
    const d = list.find((x) => x.uniqueId === uniqueId);
    if (!d) throw new Error(`Device ${uniqueId} is not known to the engine`);
    return d.id;
  }

  private range(deviceId: number) {
    return `deviceId=${deviceId}&from=2020-01-01T00:00:00Z&to=2035-01-01T00:00:00Z`;
  }

  /** Everything the engine stored for the device, in fix-time order (this is the platform's future "history"). */
  async history(uniqueId: string): Promise<{ fixTime: string; latitude: number; longitude: number; speed: number }[]> {
    const id = await this.deviceId(uniqueId);
    const rows = await this.api<{ fixTime: string; latitude: number; longitude: number; speed: number }[]>('GET', `/api/reports/route?${this.range(id)}`);
    return rows;
  }

  async trips(uniqueId: string): Promise<{ distance: number; startTime: string; endTime: string }[]> {
    return this.api('GET', `/api/reports/trips?${this.range(await this.deviceId(uniqueId))}`);
  }

  async stops(uniqueId: string): Promise<unknown[]> {
    return this.api('GET', `/api/reports/stops?${this.range(await this.deviceId(uniqueId))}`);
  }

  async events(uniqueId: string): Promise<ProbeEvent[]> {
    return this.api('GET', `/api/reports/events?${this.range(await this.deviceId(uniqueId))}`);
  }

  /** Creates a circular geofence (WKT is LATITUDE-first) and links it to the device. Returns its id. */
  async createGeofence(uniqueId: string, name: string, centerLat: number, centerLon: number, radiusM: number): Promise<number> {
    const g = await this.api<{ id: number }>('POST', '/api/geofences', { name, area: `CIRCLE (${centerLat} ${centerLon}, ${radiusM})` });
    await this.api('POST', '/api/permissions', { deviceId: await this.deviceId(uniqueId), geofenceId: g.id });
    return g.id;
  }

  async deleteGeofence(id: number): Promise<void> {
    await this.api('DELETE', `/api/geofences/${id}`).catch(() => undefined);
  }
}
