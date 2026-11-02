import { KIGALI_STREETS_LOOP } from './kigali-streets-loop';
import type { LonLat } from './motion';

export { KIGALI_STREETS_LOOP };

/**
 * Hand-drawn closed loop in central Kigali, [longitude, latitude]. Approximate by design (it only needs to look
 * like a plausible city circuit); it is NOT derived from any directions API. Replace with OpenStreetMap-derived
 * routes (ODbL attribution) when scenario realism matters (M3).
 */
export const KIGALI_CITY_LOOP: readonly LonLat[] = [
  [30.0619, -1.9441],
  [30.0665, -1.9423],
  [30.0712, -1.9438],
  [30.0741, -1.9482],
  [30.0725, -1.9534],
  [30.0679, -1.9561],
  [30.0631, -1.9548],
  [30.0594, -1.9509],
  [30.0592, -1.9464],
];

/**
 * `kigali-city-loop` = the rough hand-drawn ring the scenarios and their tests are built on (keep it as it is).
 * `kigali-streets` = a circuit that follows REAL streets (OpenStreetMap, ODbL): use it for demos, screenshots and load runs.
 */
export const ROUTES: Record<string, readonly LonLat[]> = { 'kigali-city-loop': KIGALI_CITY_LOOP, 'kigali-streets': KIGALI_STREETS_LOOP };
