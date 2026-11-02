import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { AlertDto, VehicleDeltaDto } from '@gps/shared';
import { refreshSession } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';

/** The platform's live feed (same path the simulator and the API tests use). Browser talks only to NestJS (rule 1). */
const SOCKET_PATH = '/api/v1/socket';

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'refused';

export interface LiveFeedHandlers {
  onDeltas: (deltas: VehicleDeltaDto[]) => void;
  onAlert: (alert: AlertDto) => void;
  onConnection?: (state: ConnectionState, detail?: string) => void;
  onEngine?: (connected: boolean) => void;
}

export interface LiveFeedState {
  connection: ConnectionState;
  /** null = not told yet (never shown as "down"). */
  engineConnected: boolean | null;
  /** Messages received over the socket since the page opened. */
  messages: number;
  lastMessageAt: number | null;
}

/**
 * Connects to the organization's live feed while the page is open. Authenticates in the handshake with the CURRENT access
 * token (read again on every attempt, so a reconnect after a token refresh works) and the active organization; the
 * server decides what the user may see and refuses with one generic message.
 */
export function useLiveFeed(organizationId: string | null | undefined, handlers: LiveFeedHandlers): LiveFeedState {
  const [state, setState] = useState<LiveFeedState>({ connection: 'connecting', engineConnected: null, messages: 0, lastMessageAt: null });
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!organizationId) return;
    const set = (connection: ConnectionState, detail?: string) => {
      setState((s) => ({ ...s, connection }));
      handlersRef.current.onConnection?.(connection, detail);
    };
    const received = () => setState((s) => ({ ...s, messages: s.messages + 1, lastMessageAt: Date.now() }));

    const socket: Socket = io({
      path: SOCKET_PATH,
      transports: ['websocket'],
      auth: (cb) => cb({ token: useAuthStore.getState().accessToken, organizationId }),
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    socket.on('connect', () => set('live'));
    socket.on('disconnect', (reason) => {
      // "io server disconnect": the server ended the session (revoked session, removed membership): do not hammer it.
      if (reason === 'io server disconnect') set('refused', 'The server closed the live connection (your session ended or your access changed).');
      else set('reconnecting', reason);
    });
    socket.on('connect_error', (err) => {
      set('reconnecting', err.message);
      // Anything other than a transport failure is probably an expired access token: refresh it for the next attempt.
      if (err.message !== 'websocket error' && err.message !== 'xhr poll error') void refreshSession();
    });
    socket.on('vehicle:delta', (m: { vehicles: VehicleDeltaDto[] }) => {
      received();
      handlersRef.current.onDeltas(m.vehicles);
    });
    socket.on('alert:new', (a: AlertDto) => {
      received();
      handlersRef.current.onAlert(a);
    });
    socket.on('engine:status', (s: { connected: boolean }) => {
      received();
      setState((prev) => ({ ...prev, engineConnected: s.connected }));
      handlersRef.current.onEngine?.(s.connected);
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [organizationId]);

  return state;
}
