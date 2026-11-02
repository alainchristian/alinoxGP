import type { AuthSessionDto, ProblemDetails } from '@gps/shared';
import { useAuthStore } from './auth-store';

export const API_BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly problem?: ProblemDetails,
  ) {
    super(problem?.title ?? code);
  }
  /** Field errors from a VALIDATION_FAILED response, keyed by path. */
  get fieldErrors(): Record<string, string> {
    return Object.fromEntries((this.problem?.errors ?? []).map((e) => [e.path, e.message]));
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Skip attaching the organization header (auth routes, organization listing). */
  noOrg?: boolean;
  /** Internal: this call already retried after a token refresh. */
  retried?: boolean;
  signal?: AbortSignal;
}

let refreshInFlight: Promise<boolean> | null = null;

/** Single-flight refresh using the HttpOnly cookie. Returns whether a new access token was obtained. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= (async () => {
    try {
      let res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Requested-With': 'gps-web' },
      });
      if (res.status === 401) {
        // Another tab rotated the token an instant ago; the browser now holds its fresh cookie. Retry once.
        const code = ((await res.clone().json().catch(() => null)) as { code?: string } | null)?.code;
        if (code === 'REFRESH_RACE') {
          await new Promise((r) => setTimeout(r, 300));
          res = await fetch(`${API_BASE}/auth/refresh`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'X-Requested-With': 'gps-web' },
          });
        }
      }
      if (!res.ok) return false;
      const body = (await res.json()) as { data: AuthSessionDto };
      useAuthStore.getState().setAccessToken(body.data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      // Callers that joined while this was in flight keep their reference; later callers start a fresh refresh.
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function api<T = void>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { accessToken, activeOrganizationId } = useAuthStore.getState();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  if (activeOrganizationId && !opts.noOrg) headers['X-Organization-Id'] = activeOrganizationId;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include',
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR');
  }

  if ((res.status === 401) && !opts.retried && accessToken && !path.startsWith('/auth/login')) {
    if (await refreshSession()) return api<T>(path, { ...opts, retried: true });
    useAuthStore.getState().clear();
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const problem = json as ProblemDetails | undefined;
    throw new ApiError(res.status, problem?.code ?? `HTTP_${res.status}`, problem);
  }
  return (json as { data: T }).data;
}

/** For list endpoints: returns data and meta. */
export async function apiPaged<T>(path: string): Promise<{ data: T[]; meta: { page: number; pageSize: number; total: number } }> {
  const { accessToken, activeOrganizationId } = useAuthStore.getState();
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(activeOrganizationId ? { 'X-Organization-Id': activeOrganizationId } : {}),
    },
  });
  if (res.status === 401 && (await refreshSession())) return apiPaged<T>(path);
  const json = (await res.json()) as { data: T[]; meta: { page: number; pageSize: number; total: number } } & Partial<ProblemDetails>;
  if (!res.ok) throw new ApiError(res.status, json.code ?? `HTTP_${res.status}`, json as ProblemDetails);
  return json;
}
