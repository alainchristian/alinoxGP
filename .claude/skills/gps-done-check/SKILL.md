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
pnpm test:infra:up                # the ISOLATED test stack (compose project gps-test); `pnpm test` starts it itself. `pnpm test:reset` rebuilds it from scratch
pnpm --filter api test:e2e        # API e2e incl. tenant-isolation and permission suites (serial; own stack, own key prefix per suite)
pnpm --filter api test:smoke      # STEADY-TRAFFIC SMOKE TEST (~3 min) — mandatory for any change touching the pipeline, caches, fan-out, persistence, ingestion or the simulator; at a milestone boundary always
pnpm --filter api prisma migrate status
pnpm --filter api prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL" --exit-code
                                  # schema and migrations in sync (non-zero exit = missing migration);
                                  # flag names differ between Prisma major versions — check `prisma migrate diff --help`
pnpm -r build
docker compose -f infra/docker-compose.dev.yml up -d && <smoke test script>
pnpm sim scenario <relevant scenarios>   # for anything touching GPS data, tracking, alerts, geofences
```

**Steady-traffic smoke test (from M3a on).** 50 simulated devices, 10 s interval, 2 minutes, production defaults. Pass criteria, all required: routing-cache hit rate > 90 %; p95 position-to-socket < 2 s (engine feed emit → browser socket, so the engine's own buffering is not counted against the platform); every position delivered, counting only its own vehicles; no failed requests, socket drops or pipeline errors; every cache lifetime comes from configuration and exceeds the reporting interval. Put the measured numbers in the report. A run in which the load generator itself fell behind is invalid, not a pass.

Check also:

- No new `any`, `@ts-ignore` or disabled lint rules without a justification comment.
- No `TODO`/`FIXME` on critical paths without an issue/ADR reference (Rule 10).
- No secrets, tokens or real customer data committed; `.env.example` updated for new variables.
- Swagger reflects new/changed endpoints.
- For UI changes: the verification list in `gps-fleet-ui` §10.
- For tenant data: the isolation tests in `gps-tenant-isolation` §7 exist for the new endpoints.
- Tests ran against the isolated test stack (never the development services), each test file in its own Redis namespace, and no orphaned `jest` processes are left running (a hung run is a failing run that leaked apps).
- No cache on the position path has a lifetime shorter than the reporting interval, and every cache lifetime is configurable.
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
| M1 | Register, verify email, log in/out, reset password; create organization; invite/manage users; roles enforce permissions; tenant isolation + permission tests pass; docker dev environment starts with one command |
| M2 | Pinned Traccar runs in compose; device registered via our API appears in Traccar; minimal vehicle + assignment; a (basic simulated) device's position retrieved through our API; WebSocket consumer receives and maps positions; unknown devices dropped |
| M3a | All simulator scenarios pass in CI against real Traccar; status derivation tested; leader-owned live state with fenced writes, failover test, deadline-indexed sweeper; steady-traffic smoke test passes; storage strategy ADR written and implemented |
| M3b | (before M10, separate Linux host) 200 positions/s at p95 < 2 s ours; Traccar report latency vs dataset size; RLS/transaction overhead; ADR-0003 and ADR-0004 confirmed or amended |
| M4 | Live map shows vehicles moving from socket updates without page refresh; clustering; filters/search; info panel; org B cannot see org A (UI + API + socket tests) — Success Milestone 1 met |
| M5 | Vehicle, driver, category management; device reassignment with history; catalogue managed by platform admin; effective capabilities visible to customers; onboarding paths A and B with activation statuses; diagnostics; dashboard on real data |
| M6 | Trip list and playback; geofence CRUD synced to Traccar (lat/lon test); enter/exit/dwell events from scenarios; notification rules |
| M7 | Gate + state machine + restoration + audit implemented with all tests; bench and controlled-vehicle tests recorded; no engine-stop path exists (code search proves it) |
| M8 | In-app + email delivered from real alerts; SMS/WhatsApp adapters behind interfaces; all reports with PDF/XLSX/CSV from real data |
| M9 | Inventory + installation workflow with verification; plans/entitlements configurable; payments via provider sandbox with verified webhooks and reconciliation; invoices; customer admin; reseller isolation tests |
| M10 | Production compose, Nginx, TLS, backups with a tested restore, monitoring/alerting, security review, load test results, runbooks; hosting decision consistent with data-protection verification |
