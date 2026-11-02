# dashboard

**Purpose:** the organization's start page, from real records only. `GET /dashboard` (`vehicles.read`).
**Returns:** vehicle counts (total, with/without tracker, with/without assigned driver, by category), driver counts (only if the caller has `drivers.read`), tracker counts and installed-but-never-reported (only with `devices.read`), unacknowledged alerts (only with `alerts.read`), and an "attention" list: expired / expiring (≤ 30 days) insurance, inspection, document records and driver licences, plus installed trackers that have never reported after a 1-hour grace. Sections the caller may not read are `null`.
**Also returned:** live status counts of vehicles with a tracker (only with `tracking.live.view`; the same `deriveStatus` rule as the map, a tracker that never reported counts as NO_DATA) and the five latest alerts (only with `alerts.read`).
**Not here (by design):** distance, utilisation, trips, notifications — they do not exist yet (M6 / M8) and are never invented.
