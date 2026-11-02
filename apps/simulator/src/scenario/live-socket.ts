import type { AlertDto, VehicleDeltaDto } from '@gps/shared';
import { io, type Socket } from 'socket.io-client';
import type { SocketEvents } from './types';

export const SOCKET_PATH = '/api/v1/socket';

/** Listens to the organization's live feed exactly like the web app will, and records everything it receives. */
export class LiveSocket {
  readonly events: SocketEvents = { deltas: [], alerts: [], engineStatus: [] };
  private socket: Socket | null = null;

  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly organizationId: string,
  ) {}

  connect(timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = io(this.baseUrl, { path: SOCKET_PATH, transports: ['websocket'], auth: { token: this.token, organizationId: this.organizationId }, reconnection: false });
      this.socket = socket;
      const timer = setTimeout(() => reject(new Error('Socket connection timed out')), timeoutMs);
      socket.on('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(new Error(`Socket refused: ${err.message}`));
      });
      socket.on('vehicle:delta', (m: { vehicles: VehicleDeltaDto[] }) => this.events.deltas.push(...m.vehicles));
      socket.on('alert:new', (a: AlertDto) => this.events.alerts.push(a));
      socket.on('engine:status', (s: { connected: boolean }) => this.events.engineStatus.push(s));
    });
  }

  subscribeVehicle(vehicleId: string): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => this.socket?.emit('subscribe:vehicle', { vehicleId }, resolve));
  }

  get connected() {
    return this.socket?.connected ?? false;
  }

  close() {
    this.socket?.disconnect();
  }
}
