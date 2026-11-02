# messaging

**Purpose:** provider abstraction for outbound messages (spec §5.2). M1 has only `EmailPort` with `DevEmailAdapter`.
**DEVELOPMENT ADAPTER:** logs each email and keeps the last 200 in memory (`outbox`) for tests. Environment validation **refuses it in production** (`EMAIL_PROVIDER=dev` + `NODE_ENV=production` fails at boot).
**Templates:** `email-templates.ts` (verify, already-registered, reset, invitation). Links point to `APP_BASE_URL`.
**Next:** real email provider and SMS/WhatsApp ports in M8 (OQ-013, OQ-022).
