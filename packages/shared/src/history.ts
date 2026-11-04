import { z } from 'zod';

/** Trip history and route playback (M6a, spec Modules 9). Distances in km/m as named, speeds km/h, times ISO 8601 UTC. */

// ISO 8601 strings (not Date objects: the API documentation cannot describe those); the API converts them.
export const historyQuerySchema = z
  .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
  .refine((q) => Date.parse(q.from) < Date.parse(q.to), { message: 'The start must be before the end', path: ['from'] });
export type HistoryQuery = z.infer<typeof historyQuerySchema>;

/** What was actually answered, so the page can say so when a request was narrowed. Never silent. */
export interface HistoryWindowDto {
  requestedFrom: string;
  requestedTo: string;
  from: string;
  to: string;
  /** The start was moved forward because history is kept for `historyDays` only. */
  clippedToHistoryPeriod: boolean;
  historyDays: number;
  /** The periods inside the range during which a tracker was installed on the vehicle. Time outside them is unknown, not "parked". */
  coverage: { from: string; to: string }[];
  /** Largest range one request may cover (days). */
  maxSpanDays: number;
}

export interface PlaceDto {
  latitude: number;
  longitude: number;
  address: string | null;
}

export interface TripDto {
  startTime: string;
  endTime: string;
  durationSec: number;
  distanceKm: number;
  maxSpeedKmh: number | null;
  averageSpeedKmh: number | null;
  start: PlaceDto | null;
  end: PlaceDto | null;
}

export interface StopDto {
  startTime: string;
  endTime: string;
  durationSec: number;
  place: PlaceDto | null;
}

export interface TripListDto {
  vehicleId: string;
  window: HistoryWindowDto;
  trips: TripDto[];
  stops: StopDto[];
  /** Engine trips left out of `trips`: movements too short to be a journey (GPS drift while parked) and impossible ones (bad fixes). Counted, never silently dropped. */
  hiddenTrips: { tooShort: number; implausible: number };
  simulated: boolean;
  /** True when the tracking engine could not be reached: the lists are then empty because they are UNKNOWN, not because nothing happened. */
  engineUnavailable: boolean;
}

export interface RoutePointDto {
  t: string;
  latitude: number;
  longitude: number;
  speedKmh: number | null;
  heading: number | null;
  /** Tri-state: null = the device did not report ignition. */
  ignition: boolean | null;
}

export interface RouteDto {
  vehicleId: string;
  window: HistoryWindowDto;
  /** In time order, usable fixes only. */
  points: RoutePointDto[];
  /** Usable fixes the engine returned before thinning. */
  totalPoints: number;
  /** Fixes left out because they were invalid (no GPS fix, impossible or 0,0 coordinates): never drawn as a jump. */
  skippedInvalid: number;
  /** True when `points` is a thinned copy of `totalPoints` (first and last always kept). */
  thinned: boolean;
  /** Breaks in the line: after these point indexes the vehicle was not tracked (another tracker window began). */
  breaks: number[];
  simulated: boolean;
  engineUnavailable: boolean;
}
