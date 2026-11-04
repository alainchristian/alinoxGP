# Pricing research — platform for GPS tracking providers

*Revision 3 — 4 November 2026: speed-governor suppliers and add-on added (§4, §5). Revision 2 — 1 November 2026. Revised after the owner decided the platform is sold to **GPS tracking providers**, who serve their own customers. Prices come from public websites and adverts and change often; re-check before launch. Exchange rate used: **USD 1 = RWF 1,474** (Wise mid-market, 1 Nov 2026).*

## 1. Status

- The spec (Module 15) defines the billing **structure**: the platform charges providers per **active device per month**, with graduated tiers, a minimum fee and add-ons, all configurable.
- **No prices have been decided.** Section 5 is a hypothesis to test with providers.

## 2. Who we compete with: platforms that GPS providers use today

A Rwandan provider can already rent a white-label platform from abroad, use a tracker manufacturer's free app, or run open-source Traccar themselves.

| Platform | How it is priced | Price | ≈ RWF per month | Notes |
|---|---|---|---|---|
| **GpsGate Cloud** (Sweden) | Per device | From USD 3/device/month, 5-device minimum | ~4,420 per device | Multi-tenant, provider picks its domain; 30-day trial |
| **GPSWOX** (UK/Lithuania) | Flat monthly fee by object count | USD 99 (1–100 objects; normally 119) · 199 (1–500) · 290 (1–1,000); unlimited by quote; lifetime licence offered | ~145,900 · ~293,300 · ~427,500 | Own domain and logo; branded Android/iOS apps are extra (USD 59–94/month each, ~87,000–138,600); hosted by GPSWOX abroad |
| **Traccar** (open source) | Free self-hosted, or managed branded server | Managed from USD 49.95/month | ~73,600 | Provider must handle setup, updates, support; no provider-to-customer hierarchy or billing in the docs |
| **Wialon** (Gurtam) | Per unit, partners only | Quote only (turnover and feature discounts) | — | Largest ecosystem; branded apps; partner-only sales |
| **Navixy** | Per device, post-paid | Quote only | — | Branded web, emails, SMS; 33 languages |
| **Manufacturer apps** (e.g. TracksolidPro, WhatsGPS) | Usually bundled with the maker's hardware | Not compared | — | Tied to one hardware brand; likely behind many "no monthly fee" trackers sold in Kigali (assumption, to verify) |

**Effective cost per device on GPSWOX (flat plans):** 20 devices ≈ RWF 7,300 each · 50 ≈ 2,900 · 100 ≈ 1,460 · 300 ≈ 980 · 500 ≈ 590 · 1,000 ≈ 430. Flat plans are expensive for small providers and very cheap for large ones.

## 3. What providers charge their own customers in Rwanda

This shows what margin a provider has to work with.

| Seller | Price to vehicle owner |
|---|---|
| Bythron (Track IQ) | RWF 8,000 per device/month (1–3 devices), 12,000 (4–50); devices from RWF 45,000, free installation |
| MotoTrack | From RWF 5,500/month (1–4 vehicles) to 55,999+ (41+); unclear whether per account or per vehicle |
| PrimeTrack, Sator Rwanda, Azimpex | Quote only; contracts (Sator from 12 months) |
| Informal sellers (Instagram/Facebook) | One-off RWF 95,000–180,000, usually installed, often "no monthly fee" |

Our platform fee needs to stay a small share of these prices.

## 4. Who our likely customers are

- **Best fit:** independent installers and small tracking businesses (roughly 10–300 devices) that use manufacturer apps or pay foreign platforms in USD. For them we offer:
  - A professional branded platform.
  - Local hosting.
  - Billing in RWF via Mobile Money.
  - Local support.
  - A way to earn recurring revenue instead of one-off sales.
- **Strong fit (added 4 Nov 2026):** **RURA-authorised speed-governor suppliers**. RURA's 2020 minimum requirements oblige them to run a tracking platform that:
  - stores speed every ≤ 5 s
  - sends violations to RURA in real time
  - gives RURA access
  - sends SMS alerts
  - produces quarterly reports
  - keeps subscriber data in Rwanda

  A Rwanda-hosted platform that does this for them is a compliance need, not a nice-to-have. Ask Sator Rwanda and PrimeTrack (which fits "Arrive Alive" speed limiters) what they use today.
- **Possible:** security and telematics companies without their own platform.
- **Unlikely:** companies with their own platform (Bythron, MotoTrack). They compete with our providers, not with us.

## 5. Price hypothesis for providers (to validate — not a decision)

**Graduated price per active device per month:**

| Active devices in the month | Price per device |
|---|---|
| First 100 | RWF 1,500 |
| 101–500 | RWF 1,000 |
| 501 and above | RWF 700 (larger volumes negotiated) |

- **Minimum monthly fee:** RWF 15,000 (covers 10 devices).
- **Prepaid device-year option:** about RWF 15,000 per device for 12 months. This suits installers who sell trackers for a one-off price: they add the year of service to the device price.
- **Trial:** 30 days, up to 10 real devices. The sandbox with simulated vehicles is free and unlimited in time.
- **Add-ons:**
  - Vehicle security (starter-inhibit), about RWF 300 per enabled vehicle per month.
  - **Speed-governor compliance** *(added 4 Nov 2026)*, about **RWF 1,000 per governed vehicle per month** on top of the device fee. It includes the compliance SMS RURA requires (up to a fair-use limit), violation alarms, quarterly reports and regulator access. Governed vehicles send data every 5 seconds (2–6 times more than a normal tracker) and need mandatory SMS. This price is the least certain number here: ask suppliers what they pay for their current platform and charge operators per year before fixing it.
  - SMS/WhatsApp at cost plus a margin.
  - Later: branded mobile apps and custom domain.

**Monthly bill for a provider, compared with alternatives (RWF):**

| Provider size | This hypothesis | GPSWOX | GpsGate |
|---|---|---|---|
| 10 devices | 15,000 | 145,900 | 44,200 |
| 50 devices | 75,000 | 145,900 | 221,100 |
| 100 devices | 150,000 | 145,900 | 442,200 |
| 300 devices | 350,000 | 293,300 | 1,326,600 |
| 1,000 devices | 900,000 | 427,500 | 4,422,000 |

**What the comparison means:**

- We are much cheaper than every alternative below about 100 devices.
- Above about 100 devices GPSWOX is cheaper on price alone. Larger providers will need negotiated rates, or a value case:
  - Data stays in Rwanda.
  - RWF billing and Mobile Money.
  - Local support.
  - Safe immobilization.
  - Provider console with installations.
- GPSWOX includes branded mobile apps as an add-on; we will not have them at launch.
- **Provider margin:** at RWF 1,500 our fee is about 12–27% of what Rwandan providers charge vehicle owners (RWF 5,500–12,000 per month).

**Revenue sanity check:** at an average of about RWF 1,300 per device:
- 1,000 active devices ≈ RWF 1.3 million per month (~USD 880).
- 5,000 active devices ≈ RWF 6.5 million per month (~USD 4,400).

The business needs volume, so recruiting providers matters as much as the software.

## 6. What is needed before fixing prices

1. **Our cost per active device:**
   - Hosting in Rwanda (data localisation, spec Appendix B1)
   - Backups and Mapbox
   - SMS
   - Gateway fees
   - Support time
2. **Interviews with 5–10 providers:**
   - What software they use now and what it costs
   - How many devices they have
   - How they charge their customers
   - Whether they would switch, and what would make them switch
3. **What PrimeTrack and Sator use** (potential customers or competitors).
4. **RURA licensing** for the platform and/or providers (spec Appendix B10).
5. **Data-protection roles and the data processing agreement** with providers (spec Appendix B11).
6. **Whether manufacturer apps really power the "no monthly fee" trackers** sold in Kigali.

## Sources

- RURA, Public Notice on Minimum Requirements for Road Speed Governor Supply and Installation for Public and Goods Transport (30 July 2020): https://www.rura.rw/fileadmin/user_upload/RURA/Documents/Sectors/Transport/Regulatory_instruments/Transport_Regulations_and_Guidelines/Guideline_requirements_for_road_speed_governor_supply_and_installations_for_public_and_goods_transport.pdf

- GPSWOX white-label plans: https://www.gpswox.com/en/whitelabel-software-order
- Comparison of white-label platforms, checked 21 Oct 2026 (written by Navixy, a competitor in that list): https://navixy.com/blog/top-white-label-gps-tracking-platforms/
- Wialon pricing model: https://wialon.com/en/pricing
- Exchange rate: https://wise.com/us/currency-converter/usd-to-rwf-rate
- Bythron pricing: https://www.bythron.tech/pricing · devices: https://www.bythron.tech/devices/vehicle-gps-trackers
- MotoTrack pricing: https://themototrack.com/pricing
- PrimeTrack: https://primetrack.rw/ · Sator Rwanda: https://www.satorrwanda.rw/ · Azimpex: https://az-impex.com/gps-tracking-system/
- Informal adverts, e.g. https://www.facebook.com/olado.rw/videos/mini-gps-tracker-available-at-95000-frwincluded-installation-delivery-feesdm-us-/1358579789576877/
