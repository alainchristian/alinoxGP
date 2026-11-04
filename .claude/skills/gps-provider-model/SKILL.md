---
name: gps-provider-model
description: The business model and domain rules of the GPS fleet platform — the platform is sold to GPS tracking providers, who register, get approved, brand the app with their logo and colours, create their own end customers, connect devices, and pay the platform per active device. Use for any work on provider registration and approval, provider console, end-customer creation and invitations, per-customer limits, provider staff scopes, branding and login-address resolution, provider suspension, customer transfer between providers, active-device metering and provider invoices — and whenever a requirement says "customer", to decide whether it means the provider or the end customer.
---

# The provider model

The platform's paying customers are **GPS tracking providers**. Providers serve **end customers** (car owners, fleets) and bill them outside the platform. We never sell to end customers and never compete with providers for them. This changes the meaning of many words in the original briefs — see the glossary in `docs/PROJECT_SPEC.md` §0.

```
Platform (us) ──invoice per active device──► Provider ──(their own pricing, outside the platform)──► End customers
```

## 1. Roles of each party

| Party | Does | Never |
|---|---|---|
| Platform staff | Approve providers, run the device catalogue, set plans and prices, bill providers, second-line support, enforce safety rules | Sell to end customers; contact a provider's customers commercially |
| Provider | Create customers, register/import devices, install and verify, configure branding, first-line support, enable vehicle security per verified vehicle, suspend its own customers | See other providers' data; change catalogue verification status; bypass the immobilization safety gate |
| End customer | Track its vehicles, manage its users, geofences, alerts, drivers, reports; request immobilize/restore | See the provider's other customers, stock or billing; sign up publicly; pay the platform |

## 2. Provider lifecycle

`PENDING_VERIFICATION → PENDING_APPROVAL → APPROVED (TRIAL) → ACTIVE → GRACE → SUSPENDED → (ACTIVE | CLOSED)`, plus `REJECTED`.

- Registration (public): company name, registration/TIN, country, contact person, verified email and phone, expected device count. Store in `provider_profiles`.
- Before approval: sandbox only (simulated devices, `isSandbox` org). No real device can be registered.
- Approval by a platform admin with permission `platform.providers.approve`, recording who, when and any licence evidence collected (RURA licensing is an open question — spec Appendix B10; make "licence number" an optional field the admin can require per country).
- Terms and data processing agreement acceptance are recorded with version and timestamp; a new version requires re-acceptance.
- Suspension of a provider (non-payment, abuse): provider console becomes read-only except billing; end customers see a neutral "service temporarily unavailable — contact <provider>" page; **GPS ingestion continues** so no data is lost; nothing is deleted. Reactivation restores access immediately.
- Closure: export of the provider's data offered; retention per policy; devices unregistered from Traccar only after the retention decision.

## 3. End customers

- Created by the provider (`organizations.type = CUSTOMER`, `parentOrganizationId = provider`, `providerId` denormalized on all tenant rows — see `gps-tenant-isolation`).
- Individual customers are organizations with one member; the UI hides "organization" wording for them.
- Users join by invitation link (email or SMS), set their password, and land on the provider-branded app.
- The provider sets **per-customer limits** within its own plan (`customer_entitlements`): e.g. history days, geofence count, driver management on/off, vehicle security on/off, max users. Effective entitlement = min(provider plan, customer limit).
- The provider can suspend a customer (e.g. the customer did not pay the provider). Same behaviour as provider suspension, scoped to that customer, with the provider's message.
- Whether a customer may add vehicles itself is a provider setting (default off).
- **Transfer between providers** (a customer changes provider): platform-admin operation only, requires written consent from the customer's owner and both providers' acknowledgement, creates a `customer_transfers` record. Default history rule: the new provider sees history from the transfer date; the customer keeps its full history. Record the final rule in an ADR.

## 4. Provider staff and scopes

- Provider roles: Owner, Administrator, Operations/Support, Technician, Finance (see `gps-rbac-permissions`).
- Optional **scope** per staff member: all customers (default) or a list/group of customers (`provider_staff_scopes`). Scope is enforced in the service layer on top of RLS.
- Every provider-staff access to a customer's live view, location history, exports or security commands is audit-logged with the customer org ID; the customer's owner can see this access log.
- Provider staff do not automatically become members of customer organizations; they act through the provider console (with "view as customer" read-only preview for support).

## 5. Branding

First release (design for the later items now):

| Item | Release |
|---|---|
| Logo (light/dark), primary + accent colour, display name, favicon | 1 |
| Support phone, email, WhatsApp, website, terms & privacy URLs shown in the customer app | 1 |
| Provider name/logo in notification emails (sent from the platform's domain) and PDF/XLSX exports | 1 |
| Login address on the platform domain: `<slug>.<platform-domain>` (wildcard DNS + certificate) | 1 (proposal — confirm in ADR) |
| Provider's own domain with automatic TLS | later |
| Branded email sender domain, SMS sender ID, branded mobile apps | later |

Rules:

- `GET /branding/resolve` (public) returns only display data for the login page; unknown slug → platform's neutral branding, not an error that reveals which slugs exist.
- After login, branding comes from the user's organization (customer → its provider; provider staff → their provider). A person who belongs to customers of two providers sees the branding of the organization currently selected.
- Logos: PNG/JPEG/WebP only (or sanitized SVG), size-limited, re-encoded, served from the asset domain; colours validated for contrast (warn the provider if text on the primary colour fails WCAG AA, and pick a readable text colour automatically).
- Theme applied with CSS variables (see `gps-fleet-ui`); never inline provider-supplied CSS or HTML.
- End customers see the platform's name only in a small configurable "powered by" line and legal pages where required.

## 6. Active-device billing

- **Definition (default, confirm in ADR):** a device is billable for a month if, at any time in that month, it had an open assignment to a vehicle of a non-sandbox customer **or** sent at least one position. Simulated devices are never billable. A device counts once per month even if reassigned.
- A nightly job writes `billing_usage_snapshots` (provider, date, device IDs, reason per device). The monthly invoice is generated from snapshots, so every invoice line can be explained device by device ("why was I charged for this device?").
- Pricing is data: graduated tiers of price per active device, minimum monthly fee, optional add-ons (e.g. vehicle security per device, **speed-governor compliance per governed vehicle** (rev. 1.2), SMS bundles), trial limits, grace days.
- Providers that are RURA-authorised speed-governor suppliers are flagged on their profile (authorisation reference and expiry, checked by a platform admin) before they can enrol governed vehicles or grant regulator access (see `gps-speed-governor-compliance`). No price or limit in code. Current hypothesis: `docs/PRICING_RESEARCH.md`.
- Currency per provider country (RWF first); amounts in minor units; invoices immutable; credit notes for corrections; payments via MTN MoMo / Flutterwave / bank transfer with verified webhooks (see `gps-external-integrations`).
- Usage is visible to the provider in real time ("billable devices this month so far").

## 7. Provider console essentials (what makes providers choose us)

- Bulk device import (CSV: IMEI, model, serial, SIM ICCID/phone, optional customer + vehicle) with a dry-run preview, row-level errors, idempotent re-upload.
- Onboarding queue: devices registered but never connected, awaiting configuration, configuration errors.
- Per-model configuration instructions and SMS command templates for pointing a device to our server (spec Appendix B12).
- All-customers live map and health dashboard (offline, power cut, no GPS fix).
- Customer management, invitations and resend, password-reset help without seeing passwords.
- Installations, technicians, stock (spec Module 8).
- Usage and invoices.

## 8. Tests that must exist

- Provider registration → approval → trial; rejected provider cannot register real devices; sandbox devices never billable.
- Provider A cannot see provider B (API, sockets, exports, search, branding admin).
- Customer C1 of provider A cannot see C2 of provider A.
- Provider staff scoped to C1 cannot open C2.
- Every provider-staff access to a customer's history appears in that customer's access log.
- Effective entitlement = min(provider plan, customer limit).
- Suspension (provider and customer) keeps ingesting data and restores access on reactivation.
- Duplicate IMEI across providers gives a neutral error and an admin alert.
- Billing: snapshot → invoice reproduces exactly; a device reassigned mid-month is billed once; simulated devices excluded.
- Branding resolve does not leak data and falls back neutrally.
