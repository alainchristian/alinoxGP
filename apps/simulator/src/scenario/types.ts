import type { AlertDto, AlertType, LiveLocationDto, StatusThresholds, VehicleDeltaDto, VehicleStatus } from '@gps/shared';
import type { SendResult } from '../osmand-client';
import type { TraccarProbe } from './traccar-probe';

/** One position a simulated device sends. Anything left out falls back to a sensible default for the scenario's vehicle. */
export interface Fix {
  latitude?: number;
  longitude?: number;
  speedKmh?: number;
  heading?: number;
  /** undefined = not reported (the platform must show "unknown", never "off"). */
  ignition?: boolean;
  /** Device clock in epoch ms. Defaults to now. Use this to build delayed / buffered / out-of-order data. */
  time?: number;
  batteryPercent?: number;
}

export interface SocketEvents {
  deltas: VehicleDeltaDto[];
  alerts: AlertDto[];
  engineStatus: { connected: boolean }[];
}

export class ScenarioAssertionError extends Error {}
export class ScenarioSkipped extends Error {}

export interface CheckRecord {
  name: string;
  ok: boolean;
  detail?: string;
}

/** What a scenario can do and observe. It talks to the platform exactly like a customer's browser would. */
export interface ScenarioContext {
  readonly scenario: string;
  readonly thresholds: StatusThresholds;
  readonly vehicleId: string;
  readonly registrationNumber: string;
  readonly deviceUniqueId: string;
  readonly socket: SocketEvents;
  /** Engine-level observer (Traccar reports/events). Absent when the runner has no engine credentials. */
  readonly engine?: TraccarProbe;
  /** Internal pipeline counters. Absent when the runner has no platform-admin access. */
  readonly stats?: () => Promise<Record<string, number>>;

  /** Sends one position as the device. Returns what the OsmAnd endpoint answered. */
  send(fix?: Fix): Promise<SendResult>;
  sleep(ms: number): Promise<void>;
  location(): Promise<LiveLocationDto | null>;
  alerts(type?: AlertType): Promise<AlertDto[]>;
  summary(): Promise<{ total: number; byStatus: Record<VehicleStatus, number> }>;
  /** Alert rules created here are deleted when the scenario ends. */
  createAlertRule(rule: { type: AlertType; params?: Record<string, unknown>; cooldownSeconds?: number }): Promise<string>;
  /** Polls until `fn` returns something truthy. Throws a ScenarioAssertionError naming `what` on timeout. */
  waitFor<T>(what: string, fn: () => Promise<T | false | undefined | null>, timeoutMs?: number): Promise<T>;
  waitForStatus(status: VehicleStatus, timeoutMs?: number): Promise<LiveLocationDto>;
  /** Records an assertion and fails the scenario immediately when it does not hold. */
  check(name: string, condition: boolean, detail?: string): void;
  note(message: string): void;
  skip(reason: string): never;
}

export interface Scenario {
  name: string;
  /** One line: what is simulated. */
  description: string;
  /** What passing proves about the system. */
  proves: string;
  run(ctx: ScenarioContext): Promise<void>;
}

export interface ScenarioResult {
  name: string;
  outcome: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  checks: CheckRecord[];
  notes: string[];
  error?: string;
  skipReason?: string;
}
