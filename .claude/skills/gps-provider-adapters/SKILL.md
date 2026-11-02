---
name: gps-provider-adapters
description: Provider abstraction for external services in the GPS fleet platform — ports/adapters for payments (MTN Mobile Money, Flutterwave, future providers), email, SMS, WhatsApp, maps and geocoding (Mapbox), plus clearly-labelled development adapters, per-country provider configuration, webhook verification, idempotent payment state, money handling in minor units (RWF), notification dispatch with queues and retries, resilience, secrets and data-protection considerations. Use for any work on payments, invoices, subscriptions billing flow, webhooks, notifications delivery, map tokens, geocoding, or adding/replacing an external provider.
---

# External providers

Every external service sits behind a port defined in our domain. Business modules depend on the port; one adapter per provider implements it. This is what lets Rwanda launch with MTN MoMo and Flutterwave and another country add its own provider by configuration.

## 1. Ports

```
integrations/
  payments/   PaymentProvider { initiate(), getStatus(), parseWebhook(), verifyWebhook(), refund?() }
  messaging/  EmailProvider, SmsProvider, WhatsAppProvider  (send(), getDeliveryStatus?())
  maps/       GeocodingProvider { forward(), reverse() }    (frontend map SDK is configured separately)
  gps-engine/ GpsEnginePort (see gps-traccar-integration)
```

- A registry resolves adapters per **country/organization configuration** (e.g. `country_settings.paymentProviders = ['mtn_momo_rw', 'flutterwave']`).
- Config is validated at boot with zod; a misconfigured provider disables that provider (with a clear admin-visible status), not the whole app.

## 2. Development adapters (Rule 4)

`DevEmailAdapter` (sends to Mailpit in docker compose), `DevSmsAdapter` / `DevWhatsAppAdapter` (log + in-app inbox for developers), `DevPaymentAdapter` (simulates success/failure/pending via a dev-only page). Names start with `Dev`, they refuse to load when `NODE_ENV=production`, and everything they produce is labelled as development output.

## 3. Payments

Flow:

1. Server creates a `payment` (org, invoice, amount, currency, provider, status `PENDING`, idempotency key) and calls `initiate()`.
2. Customer completes on the provider side (MoMo prompt on phone / Flutterwave checkout).
3. Provider webhook → `POST /api/v1/webhooks/payments/:provider`: verify authenticity (signature/secret header as the provider documents), reject if invalid, store the raw event, deduplicate on the provider event ID.
4. **Re-query the provider's status API server-side** before marking success — the webhook body alone is not trusted. A reconciliation job also polls pending payments (webhooks get lost).
5. Transition `PENDING → SUCCEEDED | FAILED | EXPIRED` idempotently; on success, mark invoice paid, extend subscription, emit event, send receipt.
6. The frontend's "success" redirect only triggers a status refresh; it never marks anything paid.

Money:

- Integer minor units + ISO 4217 code; store the currency exponent table (RWF exponent is 0 — no decimals; verify against provider expectations).
- Invoices are immutable once issued (numbered sequentially per issuing entity); corrections via credit notes. Payments and transactions are append-only.
- Taxes come from `country_settings` tax rules, never hardcoded. Invoice legal requirements are an open question to verify (spec Appendix B9).

Provider specifics (MTN MoMo collection API, Flutterwave API versions, webhook signing scheme, sandbox access, phone number formats) must be read from current provider documentation at implementation time and summarised in `docs/` — they change.

## 4. Notifications

- Domain modules emit notification intents (`alert.raised`, `immobilization.executed`, `invoice.issued`, `device.activated` …) — they never call a provider.
- `NotificationService`: resolves recipients (org members with permission + preferences), renders per-channel templates (locale-aware; English first, i18n-ready keys), writes in-app notifications, enqueues one BullMQ job per external channel.
- Jobs: retries with exponential backoff, dead-letter queue, per-channel rate limits, delivery status stored. Failing SMS never blocks email or in-app.
- Channel order of introduction (spec): in-app + email first; SMS and WhatsApp behind the same interface, enabled by configuration later. WhatsApp business-initiated messages typically require pre-approved templates — verify current Meta rules. SMS sender ID registration in Rwanda — verify with operators.
- Safety-critical notifications (immobilization outcomes, SOS) are sent on every configured channel and never suppressed by quiet hours.

## 5. Maps and geocoding

- Frontend: Mapbox GL JS with a **public token restricted to our domains** and minimal scopes. Any secret Mapbox token lives only on the server.
- Reverse geocoding (trip start/end addresses) goes through our `GeocodingProvider`, server-side, with caching **only as far as the provider's terms allow** (some providers forbid permanent storage of standard geocoding results — check Mapbox's current terms; Appendix B6).
- Keep the map layer swappable (MapLibre GL + another tile provider) by isolating map setup in one frontend module.

## 6. Resilience

Timeouts on every call, retries only where idempotent, circuit breakers, health status per provider on an admin page, graceful degradation (e.g. no addresses shown if geocoding is down — coordinates instead).

## 7. Secrets and data protection

- Credentials only in environment / secret store; never in code, logs, error messages or the frontend bundle.
- Send providers the minimum personal data needed (no vehicle locations to email/SMS providers beyond what the message requires).
- Many providers process data outside Rwanda. Under Rwanda's data protection law, cross-border transfer and storage may need authorisation (spec Appendix B1). Keep a register of processors (provider, data sent, location, legal basis) in `docs/` and flag it for legal review before production.

## 8. Tests

Webhook: valid signature accepted, invalid rejected, replayed event ignored, webhook claiming success but status API saying pending → stays pending. Reconciliation resolves lost webhooks. Invoice immutability. Dev adapters refuse to load in production. Notification fan-out respects permissions and preferences; one failing channel does not affect others.
