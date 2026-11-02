import { beforeEach, describe, expect, it, vi } from 'vitest';
import { P } from '@gps/shared';
import { ApiError, api } from './api';
import { useAuthStore } from './auth-store';
import { applyApiError } from './forms';
import { errorMessage } from './i18n';
import { adminNav, customerNav, visibleNav } from './nav';
import { formatDateTime, formatRelative } from './utils';

const json = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

beforeEach(() => {
  vi.unstubAllGlobals();
  useAuthStore.setState({ accessToken: 'tok-1', activeOrganizationId: 'org-1', me: null, status: 'authenticated' });
});

describe('api client', () => {
  it('unwraps the data envelope and sends auth + organization headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { data: { hello: 'world' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api<{ hello: string }>('/things')).resolves.toEqual({ hello: 'world' });
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-1', 'X-Organization-Id': 'org-1' });
    expect(init.credentials).toBe('include');
  });

  it('omits the organization header for auth routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(204));
    vi.stubGlobal('fetch', fetchMock);
    await api('/auth/logout', { method: 'POST', noOrg: true });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).headers).not.toHaveProperty('X-Organization-Id');
  });

  it('turns problem details into ApiError with code and field errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(400, { code: 'VALIDATION_FAILED', title: 'Validation failed', status: 400, errors: [{ path: 'email', message: 'Invalid email' }] })));
    const err = (await api('/x', { method: 'POST', body: {} }).catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.fieldErrors).toEqual({ email: 'Invalid email' });
  });

  it('reports network failures with a stable code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('failed')));
    await expect(api('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('refreshes once on 401 (single-flight) and retries with the new token', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? 'GET'} ${url}`);
        if (url.endsWith('/auth/refresh')) return json(200, { data: { accessToken: 'tok-2', expiresInSeconds: 900, user: {} } });
        const auth = (init?.headers as Record<string, string>)['Authorization'];
        return auth === 'Bearer tok-2' ? json(200, { data: 'ok' }) : json(401, { code: 'INVALID_TOKEN', status: 401, title: 'x' });
      }),
    );
    const [a, b] = await Promise.all([api('/one'), api('/two')]);
    expect([a, b]).toEqual(['ok', 'ok']);
    expect(calls.filter((c) => c.includes('/auth/refresh'))).toHaveLength(1);
    expect(useAuthStore.getState().accessToken).toBe('tok-2');
  });

  it('signs the user out locally when refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/auth/refresh') ? json(401, { code: 'SESSION_ENDED', status: 401, title: 'x' }) : json(401, { code: 'INVALID_TOKEN', status: 401, title: 'x' }))));
    await expect(api('/one')).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().status).toBe('anonymous');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});

describe('error messages', () => {
  it('maps known codes and never leaks raw server text for unknown ones', () => {
    expect(errorMessage('INVALID_CREDENTIALS')).toMatch(/incorrect email or password/i);
    expect(errorMessage('SOME_NEW_CODE', undefined)).toBe('Something went wrong. Please try again.');
  });
  it('applyApiError returns a form message, or maps validation errors inline', () => {
    const setError = vi.fn();
    const validation = new ApiError(400, 'VALIDATION_FAILED', { type: '', title: '', status: 400, code: 'VALIDATION_FAILED', errors: [{ path: 'name', message: 'Too short' }] });
    expect(applyApiError(validation, setError)).toBeNull();
    expect(setError).toHaveBeenCalledWith('name', { message: 'Too short' });
    expect(applyApiError(new ApiError(403, 'PERMISSION_DENIED'))).toMatch(/permission/i);
  });
});

describe('navigation', () => {
  it('shows only items the user has permission for', () => {
    const viewer = visibleNav(customerNav, [P.ORGANIZATION_READ]);
    const labels = viewer.flatMap((g) => g.items.map((i) => i.path));
    expect(labels).toContain('/app');
    expect(labels).toContain('/app/settings/organization');
    expect(labels).not.toContain('/app/settings/users');
  });
  it('drops groups that end up empty', () => {
    expect(visibleNav(adminNav, []).flatMap((g) => g.items.map((i) => i.path))).toEqual(['/admin']);
  });
  it('customer and admin navigation do not share destinations', () => {
    const c = new Set(customerNav.flatMap((g) => g.items.map((i) => i.path)));
    for (const i of adminNav.flatMap((g) => g.items)) expect(c.has(i.path)).toBe(false);
  });
});

describe('formatting', () => {
  it('renders times in the organization time zone, 24-hour', () => {
    expect(formatDateTime('2026-11-01T22:30:00Z', 'Africa/Kigali')).toBe('02/11/2026, 00:30');
  });
  it('renders unknown values as an em dash, never as zero', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatRelative(undefined)).toBe('—');
  });
});
