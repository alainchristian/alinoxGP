# history

**Purpose:** trip history and route playback (spec Module 9, M6a). History stays in the tracking engine (ADR-0004); this module decides WHAT may be asked of it and shapes the answer.
**Tables:** none (reads `device_assignments` of the vehicle through RLS; positions, trips and stops come from the engine port).
**Endpoints:** `GET /vehicles/:vehicleId/trips?from&to` (`trips.read`; ≤ HISTORY_MAX_SPAN_TRIPS_DAYS) · `GET /vehicles/:vehicleId/route?from&to` (`tracking.history.view`; ≤ HISTORY_MAX_SPAN_ROUTE_DAYS, thinned above HISTORY_MAX_ROUTE_POINTS). `from`/`to` are ISO 8601 with an offset.
**Rules (all in `history-windows.ts`, unit-tested):**
- the range is clipped to the history period (HISTORY_DAYS_DEFAULT until plans carry `history_days`, M10) and never reaches into the future; the answer says when it was narrowed;
- each query window is the intersection of the range with ONE tracker's installation on THIS vehicle: a tracker that was moved never reveals the other vehicle's (or customer's) movements; time with no tracker is reported as not covered, never as "parked";
- engine trips shorter than HISTORY_MIN_TRIP_DISTANCE_M (GPS drift while parked, OQ-033) and trips whose distance/duration imply more than HISTORY_MAX_PLAUSIBLE_SPEED_KMH (bad fixes) are hidden and COUNTED (`hiddenTrips`);
- invalid fixes (no GPS fix, impossible or 0,0 coordinates) are left out of the route and counted (`skippedInvalid`); a route that crosses a tracker change has `breaks` so the gap is not drawn;
- an unreachable engine gives 200 with `engineUnavailable: true` — unknown, not empty;
- another organization's vehicle is a 404; provider staff reading a customer's history are written to the customer's access log by the tenant guard (area `vehicles`).
**Not yet:** idle periods inside a trip (OQ-041), reverse-geocoded addresses (the engine does not do it), per-plan history_days (M10), export of trips (M8).
