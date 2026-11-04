---
name: gps-fleet-ui
description: Frontend design and implementation rules for the GPS fleet platform (apps/web, React + Tailwind + shadcn/ui + MapLibre GL / Mapbox GL + Recharts) — the shells (end-customer app, GPS-provider console, platform admin, read-only regulator portal), provider branding/theming with CSS variables, type scale, status colour system, data-honesty rules (no fake numbers, unknown is shown as unknown, simulated badges), the live tracking page and map performance with thousands of vehicles, trip playback, tables, forms, charts, responsiveness and the visual verification required before UI work is called done. Use before creating or editing any page, component, style, map layer or chart, and before saying UI work is complete.
---

# Fleet UI

The target is a calm, dense, trustworthy operations tool in the class of Samsara, Wialon and Geotab — used for hours by dispatchers and security managers. Learn from those products' usability; do not copy their interfaces.

## 1. Structure

- Three shells with separate routes and navigation (spec §12):
  - **Customer app** `/app/*` — end customers, under their provider's brand. Sidebar: Overview · Fleet · Security · Analytics · Settings · Help (contact the provider). No billing screens: end customers do not pay the platform.
  - **Provider console** `/provider/*` — GPS provider staff, under the provider's brand. Sidebar: Overview · Customers · Devices · Field · Support · Business · Settings. A customer picker in the top bar switches the working customer; "All customers" is the default for maps and dashboards.
  - **Platform admin** `/admin/*` — our staff, under the platform's brand, with a visibly different header tag ("Platform admin") so staff never confuse contexts. Sidebar: Providers · End Customers · Device Catalogue · Diagnostics · Plans & Pricing · Usage & Invoices · Payments · Support · Audit · Settings.
  - **Regulator portal** `/regulator/*` *(rev. 1.2)* — read-only, platform-branded, for RURA: governed vehicles, violations, tamper events, inspections, connectivity, quarterly reports, filtered by provider. No buttons that change anything; a visible "Read-only regulator access" tag.
  - Provider console **COMPLIANCE** group for speed-governor suppliers: Governed Vehicles · Installations & Inspections · Violations · Tamper Events · Quarterly Reports · Regulator Deliveries. Governor screens and exports show dates as dd/mm/yyyy and 24-hour time, as RURA requires.
- Navigation items come from one config per shell listing `{ label, path, icon, permission, entitlement? }`, filtered by `GET /auth/me`. Hidden ≠ secured — the API decides.
- Top bar: organization/customer switcher (when the user has several), real-time connection indicator (Live / Reconnecting / Offline), notifications, user menu.

### Provider branding (theming)

- Branding is data from `GET /branding/resolve` (login page, before auth) and from `/auth/me` (after login). See `gps-provider-model` §5.
- Apply it only through CSS variables on `:root` (`--brand-primary`, `--brand-primary-foreground`, `--brand-accent`, logo URLs) mapped to Tailwind tokens. Never inject provider-supplied CSS, HTML or fonts.
- **Status colours are not brandable.** Moving/idling/parked/offline/alert colours stay fixed so a provider's red logo cannot make every button look like an alert. If a provider's primary colour is too close to a status colour, use a neutral for primary actions and the brand colour for the header/logo area only.
- Compute a readable foreground for the brand colour (WCAG AA) automatically.
- Logos: fixed slot sizes (header 32 px high, login 64 px), `object-fit: contain`, light/dark variants, alt text = provider name.
- Test every page with at least three themes: platform default, a dark-coloured brand, a light/yellow brand.
- Code layout: `src/features/<module>/` (pages, components, hooks, api), shared UI in `src/components/`, API client + TanStack Query hooks per feature, zod schemas from `packages/shared`.

## 2. Visual system

- **Type:** one sans family (e.g. Inter or the system UI stack). Scale: 12 / 13 / 14 / 16 / 20 / 24 px. Body and tables 13–14 px; page titles 20 px; 24 px max (no oversized headings). `font-variant-numeric: tabular-nums` for all metrics, speeds, times, money.
- **Spacing:** 4 px base, 8 px rhythm. Dense tables (36–40 px rows).
- **Shape:** radius ≤ 6–8 px; borders and subtle dividers over heavy shadows; no gradients; motion only for state changes (≤ 150 ms), never decorative.
- **Colour:** neutral greys + one brand accent for primary actions. Status colours are reserved for status and nothing else:

| Status | Colour role | Also shown by |
|---|---|---|
| Moving | green | arrow marker rotated to heading |
| Idling | amber | pause-style dot |
| Parked | blue/slate | solid dot |
| Offline / No data | grey | hollow dot + "last seen" |
| Alert (overlay) | red | ring/badge on top of the status marker |

Never rely on colour alone — pair with icon/shape/text (colour-blind users, sunlight on tablets). Define colours as CSS variables / Tailwind tokens; check WCAG AA contrast.

## 3. Data honesty (spec: no invented statistics)

- Every number comes from the API. No placeholder percentages, no demo charts in production builds.
- Unknown is shown as **"Unknown"** or **"—"**, never as 0, "Off" or "No". Ignition `null` → "Unknown".
- Times: relative ("2 min ago") with absolute tooltip in the org timezone; stale data is visibly marked (e.g. greyed "last update 14:02").
- Simulated vehicles always carry a "Simulated" badge (list, marker label, detail panel, reports).
- Security states use the exact backend state names translated to plain language ("Command sent — waiting for the device", "Acknowledged — waiting for confirmation", "Starter inhibited — confirmed"). Never show "Immobilized" before the backend reports EXECUTED.
- Empty states explain what to do next ("No vehicles yet — Register your first vehicle" with the action button). Loading uses skeletons; errors say what failed and offer retry.

## 4. Live tracking page

- Layout (desktop): full-height map as the main area; left panel 320–360 px with search, status filter chips showing counts, group-by, and a **virtualized** vehicle list (TanStack Virtual); right detail panel (or bottom sheet) for the selected vehicle: registration, status, speed, heading, ignition, last fix / last seen, address (if available), driver assigned, device connection, capabilities, quick links (history, trips, security).
- Tablet: list panel collapsible. Mobile: map full-screen with list and details as bottom sheets.
- **Map library (rev. 1.2):** prototype uses **MapLibre GL JS + OpenFreeMap styles** (no key, no cost; show OpenStreetMap/OpenFreeMap attribution; no satellite layer and no reverse geocoding yet — show coordinates). Production may switch to Mapbox GL JS in M11. All map setup (library, style URLs, attribution, token) lives in one module, `src/lib/map/`, and pages never import the map library directly. The two libraries' APIs are close, so the switch stays small.
- **Map performance:** render vehicles as a single GeoJSON source with `cluster: true` and circle/symbol layers — not one DOM marker per vehicle. Update the source with `setData` at most once per animation frame / per socket flush. Clusters can show status breakdown on hover. Selected vehicle drawn in a separate source/layer on top.
- Real-time: initial snapshot via REST, then Socket.IO deltas merged into a Zustand store (or TanStack Query cache) keyed by vehicleId; ignore deltas older than the stored `lastFixAt`. Never refetch the whole list on each update.
- Map features: zoom, pan, follow-selected mode, fit to fleet/filtered set, layer switcher (light/dark streets; satellite once the production map source provides it), full-screen, scale bar. Route visualization of the last N minutes for the selected vehicle.
- Must remain smooth with 1,000+ vehicles (test with the simulator fleet command). The provider's all-customers map is where this matters most: add a customer filter and show the customer name in the vehicle list and info panel.

## 5. Trip history and playback

Vehicle + date range picker (respecting plan history limits — explain the limit if hit); trip list with start/end place and time, distance, duration, max/avg speed; map with route line (optionally coloured by speed band), start/end and stop markers; playback controls: play, pause, stop, speed (1×, 2×, 4×, 8×, 16×), scrubbable timeline with stops/idle segments marked; stats panel beside the map. Invalid or delayed points are skipped or styled, not drawn as jumps.

## 6. Tables, forms, charts

- Tables: TanStack Table, server-side pagination/sort/filter, sticky header, units in column headers (km/h, km), right-aligned numbers, row click → detail.
- Forms: React Hook Form + shared zod schema; inline field errors from server `errors[]`; disabled submit while pending (no double submit); destructive actions confirmed; sensitive actions (immobilize, role change) use a dedicated confirmation dialog with step-up auth.
- Charts: Recharts only with real series; axis labels with units; tooltips with exact values; a proper empty state when there is no data. No decorative or "sample" charts.

## 7. Locale and units

Formats from organization settings (default: Africa/Kigali, 24-hour time, DD/MM/YYYY, RWF). Use `Intl.DateTimeFormat`, `Intl.NumberFormat` (currency with code; RWF without decimals). All user-facing strings through an i18n layer (English first) so languages can be added later.

## 8. Accessibility

Keyboard navigation for lists, dialogs and map controls; visible focus; aria-labels on icon buttons and map controls; announce real-time status changes politely (aria-live) only for the selected vehicle, not every update.

## 9. Avoid

Generic admin templates; KPI card walls with no action; excessive rounded cards; gradients; oversized headings; too many colours; spinners on full pages; tooltips as the only way to see important data; modals for workflows that need context (use side panels).

## 10. Before calling UI work done

1. Run the app against the real API (with simulator data where needed).
2. Check at 1440 px, 1024 px (tablet) and 390 px (mobile) widths.
3. Check empty, loading, error and permission-restricted states; check a user lacking the permission does not see the item; check the page in the right shell(s) and with three provider themes.
4. For maps: test with 1 vehicle and with 1,000 simulated vehicles; confirm updates do not re-render the whole page.
5. Take screenshots (browser tools if available) and look at them critically against this skill before reporting.
6. Run component tests (Vitest + Testing Library) for logic-bearing components (status badges, filters, playback controller).
