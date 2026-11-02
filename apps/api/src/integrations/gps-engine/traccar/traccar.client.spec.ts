import type { Env } from '../../../infrastructure/config/env';
import { GpsEngineError } from '../port';
import { TraccarClient } from './traccar.client';

const env = { TRACCAR_URL: 'http://traccar.test', TRACCAR_USER: 'svc@x', TRACCAR_PASSWORD: 'pw', TRACCAR_REQUEST_TIMEOUT_MS: 1000 } as Env;

const res = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const loginOk = () => res(200, { id: 1 }, { 'set-cookie': 'JSESSIONID=abc123; Path=/; HttpOnly' });

let calls: { method: string; url: string; cookie?: string }[];
function stubFetch(handler: (req: { method: string; url: string; cookie?: string }) => Response | Promise<Response>) {
  calls = [];
  vi_stub(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const req = { method: init?.method ?? 'GET', url, cookie: (init?.headers as Record<string, string> | undefined)?.['Cookie'] };
    calls.push(req);
    return handler(req);
  });
}
// jest has no `vi`; keep a tiny local helper
function vi_stub(fn: (input: unknown, init?: RequestInit) => Promise<Response>) {
  (globalThis as { fetch: unknown }).fetch = fn;
}
const realFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as { fetch: unknown }).fetch = realFetch;
});

describe('TraccarClient', () => {
  it('logs in with a form post, then sends the session cookie on requests', async () => {
    stubFetch((r) => (r.url.endsWith('/api/session') ? loginOk() : res(200, [{ id: 1 }])));
    const client = new TraccarClient(env);
    const out = await client.request<unknown[]>('GET', '/api/devices', { query: { all: true } });
    expect(out.body).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: 'http://traccar.test/api/session' });
    expect(calls[1]!.cookie).toBe('JSESSIONID=abc123');
    expect(calls[1]!.url).toBe('http://traccar.test/api/devices?all=true');
  });

  it('re-authenticates ONCE on 401 and retries the request; concurrent callers share one login', async () => {
    let devicesCalls = 0;
    stubFetch((r) => {
      if (r.url.endsWith('/api/session')) return loginOk();
      devicesCalls++;
      // First two calls (one per concurrent request) hit an expired session.
      return devicesCalls <= 2 ? res(401) : res(200, []);
    });
    const client = new TraccarClient(env);
    await client.sessionCookie(); // initial login
    const before = calls.filter((c) => c.url.endsWith('/api/session')).length;
    await Promise.all([client.request('GET', '/api/devices'), client.request('GET', '/api/devices')]);
    const logins = calls.filter((c) => c.url.endsWith('/api/session')).length - before;
    expect(logins).toBe(1); // single-flight re-login
  });

  it('never loops: a second 401 after re-login is an authentication failure', async () => {
    stubFetch((r) => (r.url.endsWith('/api/session') ? loginOk() : res(401)));
    const client = new TraccarClient(env);
    await expect(client.request('GET', '/api/devices')).rejects.toMatchObject({ code: 'ENGINE_AUTH_FAILED' });
    expect(calls.filter((c) => c.url.endsWith('/api/devices'))).toHaveLength(2); // original + one retry, no more
  });

  it('reports rejected credentials distinctly from an outage', async () => {
    stubFetch(() => res(401));
    await expect(new TraccarClient(env).request('GET', '/api/devices')).rejects.toMatchObject({ code: 'ENGINE_AUTH_FAILED' });
    stubFetch(() => {
      throw new TypeError('connect ECONNREFUSED');
    });
    await expect(new TraccarClient(env).request('GET', '/api/devices')).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' });
  });

  it('retries an idempotent GET once on a network failure, but never a POST', async () => {
    let n = 0;
    stubFetch((r) => {
      if (r.url.endsWith('/api/session')) return loginOk();
      n++;
      if (n === 1) throw new TypeError('socket hang up');
      return res(200, [{ ok: true }]);
    });
    const client = new TraccarClient(env);
    await expect(client.request('GET', '/api/devices')).resolves.toMatchObject({ status: 200 });
    expect(n).toBe(2);

    n = 0;
    stubFetch((r) => {
      if (r.url.endsWith('/api/session')) return loginOk();
      n++;
      throw new TypeError('socket hang up');
    });
    await expect(new TraccarClient(env).request('POST', '/api/devices', { body: {} })).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE' });
    expect(n).toBe(1);
  });

  it('maps 4xx to ENGINE_REJECTED and 5xx to ENGINE_UNAVAILABLE without leaking response bodies', async () => {
    stubFetch((r) => (r.url.endsWith('/api/session') ? loginOk() : r.method === 'POST' ? res(400, 'SECRET SQL ERROR text') : res(502, 'java.lang.Exception: stack')));
    const client = new TraccarClient(env);
    const rejected = (await client.request('POST', '/api/devices', { body: {} }).catch((e: unknown) => e)) as GpsEngineError;
    expect(rejected.code).toBe('ENGINE_REJECTED');
    expect(rejected.status).toBe(400);
    expect(rejected.message).not.toMatch(/SECRET|java/);
    const down = (await client.request('GET', '/api/devices').catch((e: unknown) => e)) as GpsEngineError;
    expect(down.code).toBe('ENGINE_UNAVAILABLE');
    expect(down.message).not.toMatch(/stack|java/);
  });

  it('opens a circuit breaker after repeated outages and fails fast without calling the network', async () => {
    stubFetch((r) => {
      if (r.url.endsWith('/api/session')) return loginOk();
      return res(503);
    });
    const client = new TraccarClient(env);
    for (let i = 0; i < 5; i++) await client.request('GET', '/api/devices').catch(() => undefined);
    const before = calls.length;
    await expect(client.request('GET', '/api/devices')).rejects.toMatchObject({ code: 'ENGINE_UNAVAILABLE', message: expect.stringMatching(/circuit/i) });
    expect(calls.length).toBe(before);
  });

  it('exposes the session cookie for the WebSocket and can force a fresh login', async () => {
    stubFetch(() => loginOk());
    const client = new TraccarClient(env);
    expect(await client.sessionCookie()).toBe('JSESSIONID=abc123');
    await client.sessionCookie(true);
    expect(calls.filter((c) => c.url.endsWith('/api/session'))).toHaveLength(2);
  });
});
