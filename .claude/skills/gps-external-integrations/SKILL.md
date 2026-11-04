---
name: gps-external-integrations
description: External service integrations for the GPS fleet platform behind ports/adapters — payment gateways (MTN Mobile Money, Flutterwave, future gateways) used by GPS providers to pay platform invoices, email/SMS/WhatsApp messaging with provider branding, maps and geocoding (MapLibre + OpenFreeMap prototype, Mapbox or alternative in production), the RURA regulator gateway and outbox for speed-governor violations, clearly-labelled development adapters, per-country configuration, webhook verification, idempotent payment state, money in minor units (RWF), notification queues and retries, resilience, secrets and data-protection considerations. Use for any work on payments, invoices, webhooks, notification delivery, map tokens, geocoding, or adding/replacing an external service.
---

# External integrations

Naming rule: in this codebase **"provider" means a GPS tracking provider** (our customer). External services are **gateways** (payments, SMS, email, WhatsApp) or **integrations** (maps, geocoding). Never name a class `PaymentProvider` — it will be confused with GPS providers.

Every external service sits behind a port defined in our domain. Business modules depend on the port; one adapter per external service implements it. This lets Rwanda launch with MTN MoMo and Flutterwave and another country add its own gateway by configuration.

## 1. Ports

```
integrations/
  payments/   PaymentGateway { initiate(), getStatus(), parseWebhook(), verifyWebhook(), refund?() }
  messaging/  EmailGateway, SmsGateway, WhatsAppGateway  (send(), getDeliveryStatus?())
  maps/       GeocodingService { forward(), reverse() }   (frontend map SDK is configured separately)
  regulator/  RegulatorGateway { sendViolation(), sendTamper()?, health() }  (RURA — interface unknown, spec B13)
  gps-engine/ GpsEnginePort (see gps-traccar-integration)
```

- A registry resolves adapters per **country configuration** (e.g. `country_settings.paymentGateways = ['mtn_momo_rw', 'flutterwave']`).
- Config is validated at boot with zod; a misconfigured gateway disables that gateway (with a clear admin-visible status), not the whole app.

## 2. Development adapters (spec Rule 4)

`DevEmailGateway` (sends to Mailpit in docker compose), `DevSmsGateway` / `DevWhatsAppGateway` (log + in-app inbox for developers), `DevPaymentGateway` (simulates success/failure/pending via a dev-only page), `DevRegulatorGateway` (records what would be sent to RURA and simulates acknowledgements and failures; used until RURA supplies its interface — see `gps-speed-governor-compliance`). Names start with `Dev`, they refuse to load when `NODE_ENV=production`, and everything they produce is labelled as development output.

## 3. Payments — GPS providers paying platform invoices

Who pays whom: **providers pay the platform**; end customers never pay through the platform in the first release (see `gps-provider-model`). The monthly invoice comes from active-device usage snapshots.

Flow:

1. Server creates a `payment` (provider, invoice, amount, currency, gateway, status `PENDING`, idempotency key) and calls `initiate()`.
2. The provider's finance user completes it on the gateway side (MoMo prompt on phone / Flutterwave checkout). Bank transfer is recorded manually by platform finance with evidence.
3. Gateway webhook → `POST /api/v1/webhooks/payments/:gateway`: verify authenticity (signature/secret header as the gateway documents), reject if invalid, store the raw event, deduplicate on the gateway event ID.
4. **Re-query the gateway's status API server-side** before marking success — the webhook body alone is not trusted. A reconciliation job also polls pending payments (webhooks get lost).
5. Transition `PENDING → SUCCEEDED | FAILED | EXPIRED` idempotently; on success, mark the invoice paid, clear grace/suspension state, emit an event, send a receipt.
6. The frontend's "success" redirect only triggers a status refresh; it never marks anything paid.

Money:

- Integer minor units + ISO 4217 code; store the currency exponent table (RWF has no minor unit in practice — verify against gateway expectations).
- Invoices are immutable once issued (numbered sequentially per issuing entity); corrections via credit notes. Payments and transactions are append-only.
- Taxes come from `country_settings` tax rules, never hardcoded. Invoice legal requirements are an open question to verify (spec Appendix B9).

Gateway specifics (MTN MoMo collection API, Flutterwave API versions, webhook signing scheme, sandbox access, phone number formats) must be read from current gateway documentation at implementation time and summarised in `docs/` — they change.

## 4. Notifications

- Domain modules emit notification intents (`alert.raised`, `immobilization.executed`, `invoice.issued`, `device.activated`, `customer.invited` …) — they never call a gateway.
- `NotificationService`: resolves recipients (members with permission + preferences, at customer and/or provider level), renders per-channel templates **with the recipient's provider branding** (name, logo, support contacts; locale-aware; English first, i18n-ready keys), writes in-app notifications, enqueues one BullMQ job per external channel.
- Emails to end customers are sent from the platform's domain with the provider's display name ("SecureTrack via <platform>") until branded sender domains are supported.
- SMS/WhatsApp cost money: charge against the provider's included allowance or credits per plan settings; when exhausted, fall back to in-app + email and tell the provider.
- Jobs: retries with exponential backoff, dead-letter queue, per-channel rate limits, delivery status stored. Failing SMS never blocks email or in-app.
- Channel order of introduction (spec): in-app + email first; SMS and WhatsApp behind the same interface, enabled by configuration later. WhatsApp business-initiated messages typically require pre-approved templates — verify current Meta rules. SMS sender ID registration in Rwanda — verify with operators.
- Safety-critical notifications (immobilization outcomes, SOS) are sent on every configured channel and never suppressed by quiet hours or exhausted SMS credits (use the platform's allowance).
- **Speed-governor compliance SMS** (RURA requires automated SMS to the customer on changes such as a device going offline) are treated the same way: never suppressed, and use the platform allowance when credits run out. This makes an SMS gateway in Rwanda a requirement for M9, not an option.

## 5. Maps and geocoding

- **Prototype (rev. 1.2):** MapLibre GL JS + OpenFreeMap. No account or key; commercial use allowed; no guarantee or support, so it is not the production plan. No reverse geocoding yet (show coordinates). The public Nominatim service may be used only for light manual testing (at most 1 request/s), never in production.
- **Production (decided in M11):** Mapbox GL JS (free up to 50,000 map loads/month, then paid) or another vendor. Mapbox uses a **public token restricted to our domains** (including provider login subdomains) with minimal scopes; any secret token lives only on the server.
- Sending vehicle coordinates to a foreign geocoding service may conflict with data localisation (spec B1, Module 18). Decide this with B6 before enabling geocoding in production.
- Reverse geocoding (trip start/end addresses) goes through our `GeocodingService`, server-side, with caching **only as far as the map vendor's terms allow** (some vendors forbid permanent storage of standard geocoding results — check Mapbox's current terms; spec Appendix B6).
- Keep the map layer swappable (MapLibre GL + another tile source) by isolating map setup in one frontend module.

## 6. Resilience

Timeouts on every call, retries only where idempotent, circuit breakers, health status per gateway on an admin page, graceful degradation (e.g. no addresses shown if geocoding is down — coordinates instead).

## 7. Secrets and data protection

- Credentials only in environment / secret store; never in code, logs, error messages or the frontend bundle.
- Send gateways the minimum personal data needed (no vehicle locations to email/SMS gateways beyond what the message requires).
- Many gateways process data outside Rwanda. Under Rwanda's data protection law, cross-border transfer and storage may need authorisation (spec Appendix B1), and in the provider model we likely act as processor for providers (Appendix B11). Keep a register of sub-processors (service, data sent, location, legal basis) in `docs/`, share it with providers, and flag it for legal review before production.

## 8. Tests

Webhook: valid signature accepted, invalid rejected, replayed event ignored, webhook claiming success but status API saying pending → stays pending. Reconciliation resolves lost webhooks. Paying an invoice lifts grace/suspension. Invoice immutability. Dev adapters refuse to load in production. Notification fan-out respects permissions, preferences and provider branding; one failing channel does not affect others; SMS credit exhaustion falls back without losing safety-critical messages.
