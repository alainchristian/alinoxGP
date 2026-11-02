import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlertDto, FleetSnapshotDto, LiveLocationDto, OrganizationDto, StatusConfigDto, StatusSummaryDto, VehicleDeltaDto } from '@gps/shared';
import { api, apiPaged } from '@/lib/api';
import { useAuthStore } from '@/lib/auth-store';
import { applyDeltas, mergeSnapshot, type RowMap } from '../monitor/monitor-model';
import { useLiveFeed, type ConnectionState } from '../monitor/useLiveFeed';

const PAGE_SIZE = 100;
export const DEFAULT_TIME_ZONE = 'Africa/Kigali';

export type FleetEventKind = 'delta' | 'alert' | 'engine' | 'connection';

export interface UseLiveFleetOptions {
  /** Start from the whole-fleet snapshot (the map needs every vehicle) instead of the 100 most recently active. */
  snapshot?: boolean;
  /** A new alert was pushed for this organization. */
  onAlert?: (alert: AlertDto) => void;
  /** Deltas were merged into the table (`rows` is the table AFTER the merge). */
  onApplied?: (deltas: readonly VehicleDeltaDto[], rows: RowMap) => void;
  /** Human-readable events (for the monitor's live feed log). */
  onEvent?: (kind: FleetEventKind, text: string, rowsBefore: RowMap) => void;
}

/**
 * The live fleet of the ACTIVE organization, shared by the live page and the pipeline monitor: a REST snapshot, then
 * pushed deltas merged by time (an older message never overwrites a newer one), plus status counts from the server and the
 * connection state. Callers MUST remount it when the organization changes (`key={organizationId}`): nothing from one
 * tenant may linger in memory when another is shown.
 */
export function useLiveFleet(opts: UseLiveFleetOptions = {}) {
  const me = useAuthStore((s) => s.me);
  const orgId = me?.activeOrganizationId ?? null;
  const queryClient = useQueryClient();
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const org = useQuery({ queryKey: ['org', orgId], queryFn: () => api<OrganizationDto>(`/organizations/${orgId}`), enabled: !!orgId });
  const useSnapshot = opts.snapshot === true;
  const positions = useQuery({
    queryKey: ['fleet', 'positions', useSnapshot ? 'snapshot' : 'recent', orgId],
    queryFn: async (): Promise<{ data: LiveLocationDto[]; meta: { total: number; truncated: boolean } }> => {
      if (useSnapshot) {
        const s = await api<FleetSnapshotDto>('/tracking/snapshot');
        return { data: s.vehicles, meta: { total: s.total, truncated: s.truncated } };
      }
      const page = await apiPaged<LiveLocationDto>(`/tracking/positions?page=1&pageSize=${PAGE_SIZE}`);
      return { data: page.data, meta: { total: page.meta.total, truncated: page.meta.total > page.data.length } };
    },
    enabled: !!orgId,
  });
  const summary = useQuery({ queryKey: ['fleet', 'summary', orgId], queryFn: () => api<StatusSummaryDto>('/tracking/summary'), enabled: !!orgId, refetchInterval: 10_000 });
  const config = useQuery({ queryKey: ['fleet', 'config', orgId], queryFn: () => api<StatusConfigDto>('/tracking/status-config'), enabled: !!orgId, staleTime: 60_000 });

  // `rowsRef` always holds the newest table, so socket handlers (which run outside React's render) merge into the latest state.
  const [rows, setRows] = useState<RowMap>(() => new Map());
  const rowsRef = useRef<RowMap>(rows);

  useEffect(() => {
    const snapshot = positions.data?.data;
    if (!snapshot) return;
    const merged = mergeSnapshot(rowsRef.current, snapshot);
    rowsRef.current = merged;
    setRows(merged);
  }, [positions.data]);

  const timers = useRef<{ summary: ReturnType<typeof setTimeout> | null; snapshot: ReturnType<typeof setTimeout> | null }>({ summary: null, snapshot: null });
  const scheduleRefresh = useCallback(
    (what: 'summary' | 'snapshot') => {
      if (timers.current[what]) return;
      timers.current[what] = setTimeout(() => {
        timers.current[what] = null;
        void queryClient.invalidateQueries({ queryKey: ['fleet', what === 'summary' ? 'summary' : 'positions'] });
      }, 2000);
    },
    [queryClient],
  );
  useEffect(() => {
    const t = timers.current;
    return () => {
      for (const x of Object.values(t)) if (x) clearTimeout(x);
    };
  }, []);

  const feed = useLiveFeed(orgId, {
    onDeltas: (deltas) => {
      const before = rowsRef.current;
      const result = applyDeltas(before, deltas);
      rowsRef.current = result.rows;
      setRows(result.rows);
      scheduleRefresh('summary');
      // A delta carries no registration number: a vehicle we have not seen yet needs a fresh snapshot.
      if (result.unknown) scheduleRefresh('snapshot');
      optsRef.current.onApplied?.(deltas, result.rows);
      const shown = deltas.slice(0, 3).map((d) => `${before.get(d.vehicleId)?.registrationNumber ?? 'new vehicle'} ${d.status.toLowerCase()}${d.speedKmh === null ? '' : ` ${d.speedKmh.toFixed(0)} km/h`}`);
      const more = deltas.length > 3 ? ` (+${deltas.length - 3} more)` : '';
      optsRef.current.onEvent?.('delta', `${deltas.length} update${deltas.length === 1 ? '' : 's'}: ${shown.join(', ')}${more}`, before);
    },
    onAlert: (a) => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      optsRef.current.onAlert?.(a);
      optsRef.current.onEvent?.('alert', `Alert: ${a.type} on ${a.registrationNumber}`, rowsRef.current);
    },
    onEngine: (connected) => optsRef.current.onEvent?.('engine', connected ? 'Tracking engine connected' : 'Tracking engine unavailable', rowsRef.current),
    onConnection: (state: ConnectionState, detail?: string) => {
      optsRef.current.onEvent?.('connection', `Live connection: ${state}${detail ? ` (${detail})` : ''}`, rowsRef.current);
      // Messages may have been missed while disconnected: load a fresh snapshot once we are back.
      if (state === 'live') void queryClient.invalidateQueries({ queryKey: ['fleet', 'positions'] });
    },
  });

  return {
    orgId,
    me,
    queryClient,
    timeZone: org.data?.timezone ?? DEFAULT_TIME_ZONE,
    rows,
    total: positions.data?.meta.total ?? rows.size,
    /** More vehicles exist than the table holds (the server's snapshot cap, or the 100-row page of the monitor). */
    truncated: positions.data?.meta.truncated ?? false,
    positions,
    summary,
    config,
    feed,
  };
}
