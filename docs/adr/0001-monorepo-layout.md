# ADR-0001: Monorepo layout and tooling

- **Status:** Proposed (awaiting owner review) — 2026-11-01
- **Deciders:** Alain Christian Majyambere (owner), architect
- **Spec refs:** §4 (stack), §5 (layers), §17 (strategy), §18 rule 17 (keep it simple)

## Context

The product has a React SPA, a NestJS API, a GPS simulator CLI, and code that must be shared between them (zod request/response schemas, permission keys, enums, units helpers). Infrastructure files (Docker Compose, Traccar config, Nginx) are versioned alongside. One developer/AI pair is building it; there is no existing code to preserve.

Forces: the API and web app must share one validation schema (a mismatch between them is a bug class we can remove entirely); permission keys must be a single source of truth (a typo on either side silently breaks authorization or navigation); the simulator needs to call the real API; we want one CI pipeline and atomic cross-cutting changes.

## Options

1. **Monorepo, pnpm workspaces** (`apps/*`, `packages/*`), no build orchestrator initially.
2. **Monorepo, pnpm/npm workspaces + Turborepo (or Nx)** from day one for task caching.
3. **Polyrepo** (api, web, simulator, shared as separate repos, shared published as a package).
4. **Single package** with `server/` and `client/` folders.

## Decision

**Option 1: pnpm workspaces monorepo.** Orchestrate with plain `pnpm -r` / `pnpm --filter` scripts. Adopt Turborepo later if CI time becomes a problem (it is additive and does not change layout).

```
apps/api  apps/web  apps/simulator
packages/shared  packages/config
infra/  docs/  .claude/skills/
```

Details:
- `packages/shared` is TypeScript source consumed directly by `api`, `web` and `simulator` (workspace protocol), contains **zod schemas, DTO types, permission keys, enums, unit helpers**; no Node- or browser-specific code; no Prisma types (the DB model stays private to the API).
- `packages/config` holds ESLint, `tsconfig` bases, Prettier presets.
- Prisma schema and migrations live in `apps/api/prisma/` (the API owns the database).
- Node LTS version pinned via `.nvmrc` and `engines`; pnpm version pinned via `packageManager`. Exact versions are chosen in M1 when the lockfile is created.
- TypeScript `strict: true` everywhere; `any` requires a justification comment (spec rule 6).

## Consequences

- (+) One schema for validation on both sides; permission keys cannot drift; atomic refactors.
- (+) Simplest thing that works; no tooling to learn before value is delivered.
- (−) Everything builds together; CI must use path filters / `--filter ...[origin/main]` to stay fast.
- (−) Shared package needs care: anything added to it ships to the browser bundle. Review rule: nothing secret or server-only in `packages/shared`.
- (−) pnpm's strict `node_modules` can expose undeclared dependencies (a feature, but occasionally surprising with NestJS/Prisma tooling — verify in M1).
- Revisit if: a second team or external SDK needs independent release cycles (then publish `shared` as a package), or CI exceeds ~10 minutes.
