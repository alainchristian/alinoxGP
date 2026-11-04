import { Inject, Logger, OnApplicationShutdown } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { P } from '@gps/shared';
import { isUuid } from '../../common/mappers';
import { ENV, type Env } from '../../infrastructure/config/env';
import { SystemPrismaService, TenantPrismaService } from '../../infrastructure/prisma/prisma.service';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { AccessService } from '../access-control/access.service';
import { ProviderAccessLogService } from '../access-control/provider-access-log.service';
import { SessionService } from '../auth/session.service';

export const SOCKET_PATH = '/api/v1/socket';
export const orgRoom = (orgId: string) => `org:${orgId}`;
/** All customers of one provider (provider staff with unrestricted scope). */
export const providerRoom = (providerId: string) => `provider:${providerId}`;
export const vehicleRoom = (orgId: string, vehicleId: string) => `org:${orgId}:vehicle:${vehicleId}`;

interface SocketIdentity {
  userId: string;
  sessionId: string;
  organizationId: string;
  /** Rooms this socket may be in: its organization, or (provider staff) the provider room / the rooms of their scoped customers. */
  rooms: string[];
  /** Changes when the staff member's customer scope changes: such a socket is dropped and must reconnect. */
  scopeKey: string;
}

const scopeKeyOf = (scope: 'ALL' | readonly string[]) => (scope === 'ALL' ? 'ALL' : [...scope].sort().join(','));

/**
 * Live updates to browsers (skill gps-tenant-isolation §5, gps-position-pipeline §6).
 *  - The handshake authenticates the ACCESS TOKEN, the session (not revoked) and the membership of the requested
 *    organization, and requires `tracking.live.view`. Failures are generic and never say whether the org exists.
 *  - A socket is placed ONLY in `org:<id>` for the organization it was verified for. There is no global room, so a
 *    broadcast cannot reach another tenant. Vehicle rooms are joined only after checking the vehicle belongs to the org.
 *  - Sockets are re-validated periodically: a revoked session or removed member is disconnected.
 *  - The Redis adapter makes rooms work across API instances (the single ingestion leader emits for everyone).
 */
/** The latest engine status announced by the ingestion leader, so late-connecting clients learn it on connect. */
export const ENGINE_STATUS_KEY = 'gps:engine:status';

@WebSocketGateway({
  path: SOCKET_PATH,
  transports: ['websocket', 'polling'],
  cors: { origin: process.env['APP_BASE_URL'] ?? 'http://localhost:5273', credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeGateway.name);
  @WebSocketServer() server!: Server;
  private adapterClients: Redis[] = [];
  private revalidateTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly jwt: JwtService,
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly tenant: TenantPrismaService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly accessLog: ProviderAccessLogService,
    private readonly system: SystemPrismaService,
  ) {}

  /** Ids of a provider's customers (for the access log of a provider-wide view). */
  private async customerIds(providerId: string): Promise<string[]> {
    const rows = await this.system.organization.findMany({ where: { providerId, type: 'CUSTOMER' }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  afterInit(server: Server) {
    // Dedicated connections with the DEFAULT options: the shared client is configured to fail fast (no offline queue),
    // which is wrong for a pub/sub subscriber that subscribes while still connecting.
    const pub = new Redis(this.env.REDIS_URL);
    const sub = new Redis(this.env.REDIS_URL);
    for (const c of [pub, sub]) c.on('error', (err) => this.logger.warn(`Socket.IO Redis adapter connection: ${err.message}`));
    this.adapterClients = [pub, sub];
    server.adapter(createAdapter(pub, sub, { key: `${this.env.REDIS_KEY_PREFIX}socket.io` }));
    server.use((socket, next) => {
      this.authenticate(socket).then(
        () => next(),
        (err: Error) => next(err),
      );
    });
    this.revalidateTimer = setInterval(() => void this.revalidate(), this.env.SOCKET_REVALIDATE_SEC * 1000);
    this.revalidateTimer.unref?.();
  }

  /** Throws a generic error on any failure: the client learns "no", never "why". */
  private async authenticate(socket: Socket): Promise<void> {
    const auth = (socket.handshake.auth ?? {}) as { token?: unknown; organizationId?: unknown };
    if (typeof auth.token !== 'string' || !isUuid(auth.organizationId)) throw new Error('unauthorized');

    let payload: { sub: string; sid: string };
    try {
      payload = await this.jwt.verifyAsync(auth.token, { secret: this.env.JWT_ACCESS_SECRET, algorithms: ['HS256'] });
    } catch {
      throw new Error('unauthorized');
    }
    if (!payload.sub || !payload.sid || (await this.sessions.isRevoked(payload.sid))) throw new Error('unauthorized');

    const resolved = await this.access.resolve(payload.sub, auth.organizationId);
    if (!resolved || resolved.organization.status !== 'ACTIVE') throw new Error('not_found');
    const org = resolved.organization;
    let rooms: string[];
    if (org.type === 'PROVIDER' && resolved.actingAs === 'MEMBER') {
      // Provider staff watching the provider's customers (provider-wide map).
      if (!resolved.permissions.has(P.PROVIDER_CUSTOMERS_VIEW_DATA)) throw new Error('forbidden');
      rooms = resolved.customerScope === 'ALL' ? [providerRoom(org.id)] : resolved.customerScope.map((id) => orgRoom(id));
      const watched = resolved.customerScope === 'ALL' ? await this.customerIds(org.id) : [...resolved.customerScope];
      await this.accessLog.logCustomers(payload.sub, org.id, watched, 'live', 'SOCKET');
    } else {
      if (!resolved.permissions.has(P.TRACKING_LIVE_VIEW)) throw new Error('forbidden');
      rooms = [orgRoom(org.id)];
      if (resolved.actingAs === 'PROVIDER_STAFF') await this.accessLog.logCustomer(payload.sub, resolved.actorOrganizationId, org.id, 'live', 'SOCKET');
    }

    socket.data.identity = { userId: payload.sub, sessionId: payload.sid, organizationId: org.id, rooms, scopeKey: scopeKeyOf(resolved.customerScope) } satisfies SocketIdentity;
  }

  handleConnection(client: Socket) {
    const identity = client.data.identity as SocketIdentity | undefined;
    if (!identity) return client.disconnect(true); // defence in depth: middleware should have rejected already
    for (const room of identity.rooms) void client.join(room);
    void this.sendEngineStatus(client);
  }

  /** Tells a newly connected client whether the tracking engine is up (nothing is sent when it has never been announced). */
  private async sendEngineStatus(client: Socket) {
    try {
      const raw = await this.redis.get(ENGINE_STATUS_KEY);
      if (raw) client.emit('engine:status', JSON.parse(raw) as { connected: boolean; at: string });
    } catch {
      /* the status is a convenience: a client simply keeps showing "waiting" */
    }
  }

  @SubscribeMessage('subscribe:vehicle')
  async subscribeVehicle(@ConnectedSocket() client: Socket, @MessageBody() body: { vehicleId?: unknown }) {
    const identity = client.data.identity as SocketIdentity | undefined;
    if (!identity || !isUuid(body?.vehicleId)) return { ok: false, error: 'not_found' };
    const vehicleId = body.vehicleId;
    const vehicle = await this.tenant.runInOrganization(identity.organizationId, (tx) => tx.vehicle.findFirst({ where: { id: vehicleId, deletedAt: null }, select: { id: true } }));
    if (!vehicle) return { ok: false, error: 'not_found' }; // also the answer for another organization's vehicle
    await client.join(vehicleRoom(identity.organizationId, vehicleId));
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe:vehicle')
  async unsubscribeVehicle(@ConnectedSocket() client: Socket, @MessageBody() body: { vehicleId?: unknown }) {
    const identity = client.data.identity as SocketIdentity | undefined;
    if (identity && isUuid(body?.vehicleId)) await client.leave(vehicleRoom(identity.organizationId, body.vehicleId));
    return { ok: true };
  }

  // ---------------------------------------------------------------- emission (called by FanoutService)

  emitToOrg(orgId: string, event: string, payload: unknown) {
    this.server?.to(orgRoom(orgId)).emit(event, payload);
  }

  emitToProvider(providerId: string, event: string, payload: unknown) {
    this.server?.to(providerRoom(providerId)).emit(event, payload);
  }

  emitToVehicle(orgId: string, vehicleId: string, event: string, payload: unknown) {
    this.server?.to(vehicleRoom(orgId, vehicleId)).emit(event, payload);
  }

  /** Engine connectivity carries no tenant data, so it may go to every connected client. */
  emitToAll(event: string, payload: unknown) {
    this.server?.emit(event, payload);
  }

  private async revalidate() {
    if (!this.server) return;
    for (const socket of this.server.sockets.sockets.values()) {
      const identity = socket.data.identity as SocketIdentity | undefined;
      if (!identity) continue;
      try {
        const revoked = await this.sessions.isRevoked(identity.sessionId);
        const resolved = revoked ? null : await this.access.resolve(identity.userId, identity.organizationId);
        const needed = resolved?.organization.type === 'PROVIDER' && resolved.actingAs === 'MEMBER' ? P.PROVIDER_CUSTOMERS_VIEW_DATA : P.TRACKING_LIVE_VIEW;
        const ok = !!resolved && resolved.organization.status === 'ACTIVE' && resolved.permissions.has(needed) && !resolved.providerSuspended && scopeKeyOf(resolved.customerScope) === identity.scopeKey;
        if (!ok) socket.disconnect(true);
      } catch (err) {
        this.logger.warn(`Socket re-validation failed: ${String(err)}`); // keep the socket; try again next round
      }
    }
  }

  async onApplicationShutdown() {
    if (this.revalidateTimer) clearInterval(this.revalidateTimer);
    this.revalidateTimer = null;
    for (const c of this.adapterClients) c.disconnect();
  }
}
