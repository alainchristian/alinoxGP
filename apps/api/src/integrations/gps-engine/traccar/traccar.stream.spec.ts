import { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import type { EngineStreamMessage } from '../port';
import { TraccarStream } from './traccar.stream';

const position = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  deviceId: 7,
  protocol: 'osmand',
  serverTime: '2026-11-01T10:00:00.000+00:00',
  deviceTime: '2026-11-01T10:00:00.000+00:00',
  fixTime: '2026-11-01T10:00:00.000+00:00',
  valid: true,
  latitude: -1.94,
  longitude: 30.06,
  speed: 20,
  attributes: { ignition: true },
  ...extra,
});

async function until(cond: () => boolean, ms = 6000) {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timed out waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('TraccarStream against a local WebSocket server', () => {
  let server: WebSocketServer;
  let clients: WebSocket[];
  let cookiesSeen: (string | undefined)[];
  let port: number;

  beforeEach(async () => {
    clients = [];
    cookiesSeen = [];
    server = new WebSocketServer({ port: 0 });
    server.on('connection', (ws, req) => {
      cookiesSeen.push(req.headers.cookie);
      clients.push(ws);
    });
    await new Promise<void>((r) => server.once('listening', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterEach(async () => {
    for (const c of clients) c.terminate();
    await new Promise<void>((r) => server.close(() => r()));
  });

  const make = (messages: EngineStreamMessage[]) =>
    new TraccarStream({ baseUrl: `http://127.0.0.1:${port}`, getCookie: async () => 'JSESSIONID=test' }, (m) => void messages.push(m)).start();

  it('authenticates with the session cookie and delivers normalized positions (km/h)', async () => {
    const messages: EngineStreamMessage[] = [];
    const stream = make(messages);
    await until(() => clients.length === 1 && messages.some((m) => m.kind === 'connection'));
    expect(cookiesSeen[0]).toBe('JSESSIONID=test');
    clients[0]!.send(JSON.stringify({ positions: [position(1)] }));
    await until(() => messages.some((m) => m.kind === 'position'));
    const p = messages.find((m) => m.kind === 'position');
    expect(p).toMatchObject({ kind: 'position', position: { engineDeviceId: 7, speedKmh: 37, ignition: true } });
    await stream.stop();
  });

  it('drops malformed frames and items, reports them, and keeps processing valid ones', async () => {
    const messages: EngineStreamMessage[] = [];
    const stream = make(messages);
    await until(() => clients.length === 1);
    const ws = clients[0]!;
    ws.send('this is not json');
    ws.send(JSON.stringify({ positions: [{ id: 'x', latitude: 'north' }, position(2)], devices: [{ nope: true }] }));
    ws.send(JSON.stringify([1, 2, 3]));
    await until(() => messages.filter((m) => m.kind === 'malformed').length >= 4 && messages.some((m) => m.kind === 'position'));
    const bad = messages.filter((m) => m.kind === 'malformed').map((m) => (m as { what: string }).what).sort();
    expect(bad).toEqual(['device', 'frame', 'frame', 'position']);
    expect(messages.filter((m) => m.kind === 'position')).toHaveLength(1);
    await stream.stop();
  });

  it('processes frames strictly in arrival order', async () => {
    const messages: EngineStreamMessage[] = [];
    const order: number[] = [];
    const stream = new TraccarStream(
      { baseUrl: `http://127.0.0.1:${port}`, getCookie: async () => 'JSESSIONID=test' },
      async (m) => {
        if (m.kind !== 'position') return;
        if (m.position.engineId === 1) await new Promise((r) => setTimeout(r, 80)); // slow first handler
        order.push(m.position.engineId);
        messages.push(m);
      },
    ).start();
    await until(() => clients.length === 1);
    clients[0]!.send(JSON.stringify({ positions: [position(1), position(2), position(3)] }));
    await until(() => order.length === 3);
    expect(order).toEqual([1, 2, 3]);
    await stream.stop();
  });

  it('reconnects after the server drops the connection and announces `connected` again (backfill trigger)', async () => {
    const messages: EngineStreamMessage[] = [];
    const stream = make(messages);
    await until(() => clients.length === 1);
    clients[0]!.terminate();
    await until(() => messages.some((m) => m.kind === 'connection' && m.state === 'disconnected'));
    await until(() => clients.length === 2, 8000);
    const states = messages.filter((m) => m.kind === 'connection').map((m) => (m as { state: string }).state);
    expect(states).toEqual(['connected', 'disconnected', 'connected']);
    await stream.stop();
  }, 15000);

  it('stop() ends the connection and does not reconnect', async () => {
    const messages: EngineStreamMessage[] = [];
    const stream = make(messages);
    await until(() => clients.length === 1);
    await stream.stop();
    await new Promise((r) => setTimeout(r, 1800));
    expect(clients).toHaveLength(1);
  });

  it('keeps retrying (with backoff) while the engine is unreachable, then connects when it returns', async () => {
    await new Promise<void>((r) => server.close(() => r()));
    const messages: EngineStreamMessage[] = [];
    const stream = make(messages);
    await new Promise((r) => setTimeout(r, 1200)); // at least one failed attempt
    server = new WebSocketServer({ port });
    server.on('connection', (ws) => clients.push(ws));
    await until(() => clients.length === 1, 12000);
    await until(() => messages.some((m) => m.kind === 'connection' && m.state === 'connected'));
    await stream.stop();
  }, 20000);
});
