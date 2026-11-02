import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../../../infrastructure/config/env';
import { GpsEngineError } from '../port';

interface RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  timeoutMs?: number;
  /** Treat these statuses as a normal outcome (returned to the caller) instead of an error. */
  acceptStatuses?: number[];
}

export interface TraccarResponse<T> {
  status: number;
  body: T;
}

const BREAKER_THRESHOLD = 5; // consecutive "unavailable" failures
const BREAKER_OPEN_MS = 10_000;

/**
 * HTTP client for the Traccar REST API (verified against 6.16.0, see docs/GPS_INTEGRATION.md).
 *  - Authenticates with a dedicated ADMINISTRATOR account (session cookie via POST /api/session). A static
 *    "service account token" login was tested and rejected: that virtual user cannot own devices.
 *  - Re-authenticates ONCE per request on 401, single-flight (one login shared by concurrent callers). Never loops.
 *  - Timeouts on every call; only idempotent GETs are retried (once, on a network failure).
 *  - A circuit breaker fails fast while the engine is down so the rest of the application keeps working.
 *  - Errors never carry provider response bodies.
 */
@Injectable()
export class TraccarClient {
  private readonly logger = new Logger(TraccarClient.name);
  private cookie: string | null = null;
  private loginInFlight: Promise<void> | null = null;
  private consecutiveFailures = 0;
  private breakerOpenUntil = 0;

  constructor(@Inject(ENV) private readonly env: Env) {}

  get baseUrl() {
    return this.env.TRACCAR_URL.replace(/\/$/, '');
  }

  private noteSuccess() {
    this.consecutiveFailures = 0;
  }

  private noteUnavailable() {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= BREAKER_THRESHOLD) {
      this.breakerOpenUntil = Date.now() + BREAKER_OPEN_MS;
      this.logger.warn(`Traccar unavailable ${this.consecutiveFailures}x in a row; failing fast for ${BREAKER_OPEN_MS / 1000}s`);
    }
  }

  private assertBreakerClosed() {
    if (Date.now() < this.breakerOpenUntil) {
      throw new GpsEngineError('ENGINE_UNAVAILABLE', 'GPS engine temporarily unavailable (circuit open)');
    }
  }

  private async login(): Promise<void> {
    this.loginInFlight ??= (async () => {
      try {
        let res: Response;
        try {
          res = await fetch(`${this.baseUrl}/api/session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ email: this.env.TRACCAR_USER, password: this.env.TRACCAR_PASSWORD }),
            signal: AbortSignal.timeout(this.env.TRACCAR_REQUEST_TIMEOUT_MS),
          });
        } catch {
          throw new GpsEngineError('ENGINE_UNAVAILABLE', 'GPS engine unreachable during login');
        }
        if (res.status === 401 || res.status === 403) {
          throw new GpsEngineError('ENGINE_AUTH_FAILED', 'GPS engine rejected the service account credentials', res.status);
        }
        if (!res.ok) throw new GpsEngineError('ENGINE_UNAVAILABLE', `GPS engine login failed (${res.status})`, res.status);
        const setCookie = res.headers.get('set-cookie');
        const session = setCookie?.split(';')[0];
        if (!session?.startsWith('JSESSIONID=')) throw new GpsEngineError('ENGINE_PROTOCOL_ERROR', 'GPS engine did not return a session');
        this.cookie = session;
      } finally {
        this.loginInFlight = null;
      }
    })();
    return this.loginInFlight;
  }

  /** Cookie header value for the WebSocket connection (logs in first if needed). */
  async sessionCookie(forceRefresh = false): Promise<string> {
    if (forceRefresh || !this.cookie) await this.login();
    return this.cookie!;
  }

  invalidateSession() {
    this.cookie = null;
  }

  async request<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, opts: RequestOptions = {}): Promise<TraccarResponse<T>> {
    this.assertBreakerClosed();
    const attempts = method === 'GET' ? 2 : 1; // retry idempotent reads once on network failure
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        return await this.requestOnce<T>(method, path, opts, true);
      } catch (err) {
        lastError = err;
        const retryable = err instanceof GpsEngineError && err.code === 'ENGINE_UNAVAILABLE' && err.status === undefined;
        if (!retryable) break;
      }
    }
    if (lastError instanceof GpsEngineError && lastError.code === 'ENGINE_UNAVAILABLE') this.noteUnavailable();
    throw lastError;
  }

  private async requestOnce<T>(method: string, path: string, opts: RequestOptions, mayRelogin: boolean): Promise<TraccarResponse<T>> {
    if (!this.cookie) await this.login();
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Cookie: this.cookie!,
          Accept: 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: AbortSignal.timeout(opts.timeoutMs ?? this.env.TRACCAR_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GpsEngineError('ENGINE_UNAVAILABLE', 'GPS engine unreachable or timed out');
    }

    if (res.status === 401 && mayRelogin) {
      this.invalidateSession();
      await this.login();
      return this.requestOnce<T>(method, path, opts, false); // one retry only, never a loop
    }
    if (res.status === 401) throw new GpsEngineError('ENGINE_AUTH_FAILED', 'GPS engine rejected the session', 401);

    const accepted = opts.acceptStatuses?.includes(res.status) ?? false;
    if (res.status >= 500) throw new GpsEngineError('ENGINE_UNAVAILABLE', `GPS engine error (${res.status})`, res.status);
    if (!res.ok && !accepted) throw new GpsEngineError('ENGINE_REJECTED', `GPS engine rejected the request (${res.status})`, res.status);

    this.noteSuccess();
    if (res.status === 204) return { status: 204, body: undefined as T };
    const text = await res.text();
    if (!text) return { status: res.status, body: undefined as T };
    try {
      return { status: res.status, body: JSON.parse(text) as T };
    } catch {
      throw new GpsEngineError('ENGINE_PROTOCOL_ERROR', 'GPS engine returned a non-JSON response', res.status);
    }
  }

  /** Unauthenticated server information (version). */
  async serverInfo(): Promise<{ version?: string }> {
    this.assertBreakerClosed();
    try {
      const res = await fetch(`${this.baseUrl}/api/server`, { signal: AbortSignal.timeout(this.env.TRACCAR_REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new GpsEngineError('ENGINE_UNAVAILABLE', `GPS engine returned ${res.status}`, res.status);
      return (await res.json()) as { version?: string };
    } catch (err) {
      if (err instanceof GpsEngineError) throw err;
      throw new GpsEngineError('ENGINE_UNAVAILABLE', 'GPS engine unreachable');
    }
  }
}
