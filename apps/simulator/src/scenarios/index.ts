import type { Scenario } from '../scenario/types';
import { delayedTransmission } from './delayed-transmission';
import { disconnect } from './disconnect';
import { geofenceEnterExit } from './geofence-enter-exit';
import { ignitionCycle } from './ignition-cycle';
import { implausibleJump } from './implausible-jump';
import { invalidCoordinates } from './invalid-coordinates';
import { movingRoute } from './moving-route';
import { outOfOrder } from './out-of-order';
import { overspeed } from './overspeed';
import { parkedDrift } from './parked-drift';
import { reconnectBuffered } from './reconnect-buffered';
import { stopping } from './stopping';

/** The scenarios of spec §9 (eleven) plus `implausible-jump`, which the pipeline also has to handle. */
export const SCENARIOS: readonly Scenario[] = [
  movingRoute, stopping, ignitionCycle, geofenceEnterExit, disconnect, reconnectBuffered,
  delayedTransmission, invalidCoordinates, outOfOrder, parkedDrift, overspeed, implausibleJump,
];

export const scenarioByName = (name: string) => SCENARIOS.find((s) => s.name === name);
