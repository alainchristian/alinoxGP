import type { AlertDto, AlertType, LiveLocationDto, StatusConfigDto, StatusThresholds, VehicleLocationResult } from '@gps/shared';

export class PlatformError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Thin client for the platform REST API, scoped to one organization. It uses only public endpoints (like a browser). */
export class PlatformClient {
  constructor(
    readonly baseUrl: string,
    private readonly accessToken: string,
    readonly organizationId: string,
  ) {}

  /** Signs in with email + password (CLI use). Tests pass a token they already hold. */
  static async login(baseUrl: string, email: string, password: string, organizationId: string): Promise<PlatformClient> {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const body = (await res.json()) as { data?: { accessToken: string }; code?: string };
    if (!res.ok || !body.data) throw new PlatformError(res.status, body.code ?? 'LOGIN_FAILED', `Login failed (${res.status})`);
    return new PlatformClient(baseUrl, body.data.accessToken, organizationId);
  }

  get token() {
    return this.accessToken;
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.accessToken}`, 'X-Organization-Id': this.organizationId, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 204) return undefined as T;
    const json = (await res.json().catch(() => ({}))) as { data?: T; code?: string };
    if (!res.ok) throw new PlatformError(res.status, json.code ?? `HTTP_${res.status}`, `${method} ${path} -> ${res.status} ${json.code ?? ''}`);
    return json.data as T;
  }

  thresholds(): Promise<StatusThresholds> {
    return this.call<StatusConfigDto>('GET', '/tracking/status-config').then((c) => c.thresholds);
  }

  async createVehicle(registrationNumber: string): Promise<string> {
    return (await this.call<{ id: string }>('POST', '/vehicles', { registrationNumber })).id;
  }

  async registerDevice(uniqueId: string): Promise<string> {
    return (await this.call<{ id: string }>('POST', '/devices', { uniqueId })).id;
  }

  assign(deviceId: string, vehicleId: string): Promise<unknown> {
    return this.call('POST', `/devices/${deviceId}/assign`, { vehicleId });
  }

  location(vehicleId: string): Promise<VehicleLocationResult> {
    return this.call('GET', `/tracking/vehicles/${vehicleId}/location`);
  }

  summary() {
    return this.call<{ total: number; byStatus: Record<string, number> }>('GET', '/tracking/summary');
  }

  async alerts(vehicleId: string, type?: AlertType): Promise<AlertDto[]> {
    const q = new URLSearchParams({ vehicleId, pageSize: '100', ...(type ? { type } : {}) });
    return this.call<AlertDto[]>('GET', `/alerts?${q}`);
  }

  async createAlertRule(rule: { type: AlertType; params?: Record<string, unknown>; cooldownSeconds?: number }): Promise<string> {
    return (await this.call<{ id: string }>('POST', '/alert-rules', rule)).id;
  }

  deleteAlertRule(id: string): Promise<void> {
    return this.call('DELETE', `/alert-rules/${id}`);
  }
}

export type { LiveLocationDto };
