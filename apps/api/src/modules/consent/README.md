# consent

**Purpose:** the acknowledgement MECHANISM, not legal text (ADR-0009, OQ-020, OQ-037). Versioned **notices** (global; a published notice is immutable, only retired) and append-only **records** (tenant: who acknowledged which version, when, for which device).
**Endpoints:** `GET /consent/current` (`devices.register`) · `GET /consent/records` (`organization.read`) · `/admin/consent/notices` list/draft/publish (`platform.settings.manage`).
**Rules:** when `DEVICE_CONSENT_REQUIRED` is true and a notice is published, registering a device needs the CURRENT version's id (`CONSENT_REQUIRED` otherwise; an older version is not enough). Publishing retires the previous version atomically. The seeded development notice is flagged draft wording and says so on screen.
