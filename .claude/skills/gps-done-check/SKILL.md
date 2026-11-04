---
name: gps-done-check
description: Verification gate and honest reporting for the GPS fleet platform. Use before claiming any task, feature, module or milestone is done or working, before ending a work session, when the user asks for status or "is it finished", and at every milestone boundary. Runs typecheck, lint, tests, migration checks, build, integration and simulator checks, documentation updates, and produces the completion report with evidence, remaining work and verification still needed.
---

# Done check

The spec says: *do not claim a feature is complete until it has been implemented and tested*, and after each stage run tests, check TypeScript and lint, verify migrations and integrations, update docs, and report completed and remaining work. This skill makes that concrete. Run the parts that apply to the change; at a milestone boundary, run all of it.

## 1. Commands (adapt names to the repo's scripts; record the final list in CLAUDE.md)

```bash
pnpm -r typecheck                 # tsc --noEmit everywhere; zero errors
pnpm -r lint                      # eslint incl. @typescript-eslint/no-explicit-any; zero errors
pnpm -r test                      # unit + component tests
pnpm --filter api test:e2e        # API e2e incl. tenant-isolation and permission suites
pnpm --filter api prisma migrate status
pnpm --filter api prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
                                  # schema and migrations in sync (non-zero exit = missing migration);
                                  # flag names differ between Prisma major versions — check `prisma migrate diff --help`
pnpm -r build
docker compose -f infra/docker-compose.dev.yml up -d && <smoke test script>
pnpm sim scenario <relevant scenarios>   # for anything touching GPS data, tracking, alerts, geofences
pnpm sim smoke                    # steady traffic: 50 devices, 10 s interval, 2 min (100 governed at 5 s from M9)
```

**Steady-traffic smoke test (every milestone from M3a on).** Lesson from M3: a 5-second cache in front of devices reporting every 10 seconds never hit, and M2's tests could not notice because they never sent steady traffic. Pass criteria:
- cache hit rate > 90%
- p95 position-to-socket latency < 2 s
- no errors
- the load generator counts only its own vehicles' deltas

**Test hygiene (lessons from M3):**
- Tests run in a separate compose project with wiped volumes.
- Each suite has its own Redis key prefix and ingestion lease name.
- Every test deletes what it created, and `pnpm test:reset` rebuilds the test stack.
- Load-test data never goes into the development database.
- Profile before optimising.

Check also:

- No new `any`, `@ts-ignore` or disabled lint rules without a justification comment.
- No `TODO`/`FIXME` on critical paths without an issue/ADR reference (Rule 10).
- No secrets, tokens or real customer data committed; `.env.example` updated for new variables.
- Swagger reflects new/changed endpoints.
- For UI changes: the verification list in `gps-fleet-ui` §10.
- For tenant data: the isolation tests in `gps-tenant-isolation` §7 exist for the new endpoints.
- For immobilization: every test in `gps-immobilization-safety` §8 passes.

## 2. Documentation to update

`docs/DEVELOPMENT_ROADMAP.md` (status), plus whichever apply: `ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `API_DESIGN.md`, `GPS_INTEGRATION.md`, `DEVICE_COMPATIBILITY.md`, `SIMULATOR.md`, `VEHICLE_SECURITY.md`, `OPEN_QUESTIONS.md`, new ADRs, module READMEs, `CLAUDE.md` (commands, conventions learned).

## 3. Levels of "done" — use the precise one

| Level | Meaning |
|---|---|
| Implemented | Code written, compiles |
| Tested | Automated tests pass |
| Verified with simulator | Passed through real Traccar + pipeline using simulator scenarios |
| Verified on hardware | Tested with a physical tracker (state model, firmware) |
| Production-ready | Above + security, monitoring, docs, deployment |

Never write "fully working", "complete" or "production-ready" without the evidence for that level.

## 4. Report template

```
## <Milestone / task> — status report (<date>)

### Completed
- <item> — level: <Tested | Verified with simulator | …> — evidence: <tests/commands/results>

### Checks run
- typecheck: pass | lint: pass | unit: N passed | e2e: N passed (incl. M tenant-isolation) | migrations: in sync | build: pass | scenarios: <list> pass

### Not done / remaining
- <item> — why — planned in <milestone>

### Known issues and risks
- <issue> — impact — mitigation

### Deviations from PROJECT_SPEC.md
- <deviation> — reason — ADR-<nnnn>

### Needs verification outside the code
- <hardware / provider / legal item> — see OPEN_QUESTIONS.md #<n>

### Next step
- <proposed next step; at a milestone boundary, wait for the user's go-ahead>
```

## 5. Milestone acceptance criteria (from PROJECT_SPEC §17.4 and §20)

| Milestone | Must be demonstrably true |
|---|---|
| M1 | Provider registers, verifies email, is approved by a platform admin; provider creates two customers and invites their users; invited users log in under the provider's logo/colours; staff roles and scopes enforce permissions; log in/out, reset password, sessions; three-level isolation + permission tests pass (P1/C1/C2 vs P2/C3); docker dev environment starts with one command |
| M2 | Pinned Traccar runs in compose; device registered by a provider (single and CSV dry-run/commit) appears in Traccar; global IMEI uniqueness with neutral error; minimal vehicle for a customer + assignment; a (basic simulated) device's position retrieved through our API; WebSocket consumer maps positions to provider and customer; unknown devices dropped |
| M3a | All simulator scenarios pass against real Traccar; status derivation tested; leader-held latest state with lease-token-guarded batched writes and a failover test; sweeper on a sorted set of offline deadlines; storage ADR written ("pending M3b"); steady-traffic smoke test passes |
| M4 | Customer live map and provider all-customers map (MapLibre + OpenFreeMap, map setup in one module) show vehicles moving from socket updates without page refresh; clustering; filters/search (incl. by customer); info panel; ~1,000 simulated vehicles stay smooth; other customers and other providers cannot see them (UI + API + socket tests) — Success Milestone 1 met |
| M5 | Vehicle (incl. use class), driver, category management; device reassignment with history; catalogue managed by platform admin incl. speed-governor device type; effective capabilities visible to end customers; provider device onboarding with activation statuses and onboarding queue; diagnostics; provider and customer dashboards on real data; per-customer limits |
| M6 | Trip list and playback; geofence CRUD synced to Traccar (lat/lon test); enter/exit/dwell events from scenarios; notification rules |
| M7 | Gate + state machine + restoration + audit implemented with all tests; bench and controlled-vehicle tests recorded; no engine-stop path exists (code search proves it) |
| M8 | In-app + email delivered from real alerts; SMS/WhatsApp adapters behind interfaces; all reports with PDF/XLSX/CSV from real data |
| M9 | Speed governor compliance per `gps-speed-governor-compliance` §9: governed-vehicle 5 s ingestion passes the smoke test; violation episodes and tamper events detected; provider alarm, customer SMS and regulator outbox within target time; inspections with reminders; quarterly report reproducible; Regulator portal scoped and audited; no remote set-speed change path exists — Success Milestone 3 (simulated) met |
| M10 | Provider inventory + installation workflow with verification; provider plans/entitlements configurable (incl. governor add-on); active-device snapshots reproduce the invoice exactly; payments via gateway sandbox with verified webhooks and reconciliation; grace and suspension keep ingesting data; provider management in platform admin; customer transfer with consent and audit |
| M11 | M3b scale proof on a quiet Linux host with the load generator on a separate machine (≥ 200 positions/s, report latency, RLS) and the two ADRs confirmed or amended; production map source chosen; production compose, Nginx, TLS, backups with a tested restore, monitoring/alerting, security review, runbooks; hosting in Rwanda consistent with data-protection and RURA verification |
