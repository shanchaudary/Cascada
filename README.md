# Cascada

Cascada is a Next.js 15 application for food manufacturing regulatory cascade impact analysis. It uses PostgreSQL 16 with Apache AGE, Redis, Temporal, Prisma 6, NextAuth/Auth.js, and Vitest.

## Install/Auth Baseline

Baseline tag: `install-auth-baseline-2026-07-07`

Accepted baseline commit:

```text
5b191680c9d35cc3603ce82d635f1b50ed9190fc Trust Auth.js host for production session route
```

This baseline was verified on July 7, 2026 from a true fresh GitHub clone with no working-tree overlay. The verification passed:

- Fresh GitHub clone install
- Docker stack startup and health checks
- Prisma generate, migrate, and seed
- TypeScript typecheck
- ESLint command, with existing warnings
- Vitest unit/regression suite
- Production build
- Demo login with `admin@demofoods.com` / `cascada-demo-2026`
- `/dashboard` route
- `/api/auth/session` before and after login
- `/api/tenants/current`, returning `401` before login and `200` after login

Known backlog risks:

- 11 moderate npm audit findings
- 148 lint warnings
- No Playwright/E2E suite
- Docker host ports still require only one local stack on default ports unless a clone overrides ports
- PDF smoke validates a 9-page scaffold, not the full paid diagnostic lifecycle

## Local Setup

Requirements:

- Node.js 20+
- Docker Desktop
- Windows PowerShell or another shell with equivalent commands

From a fresh clone:

```powershell
npm ci
Copy-Item .env.example .env
docker compose down --volumes --remove-orphans
docker compose pull
docker compose up -d
docker ps
npx prisma generate
npx prisma migrate dev
npm run db:seed
npm run dev
```

Open `http://localhost:3000`.

## Demo Login

After `npm run db:seed`, use either seeded local account:

- Demo tenant: `admin@demofoods.com` / `cascada-demo-2026`
- Platform tenant: `admin@cascada.io` / `cascada-demo-2026`

The optional organization slugs are `demo-foods` and `cascada-platform`.

`CASCADA_DEV_AUTH=true` only enables a non-production fallback for old local user records that do not yet have a password hash. Production login requires a stored password hash and does not accept the fallback.

## Docker Services

`docker-compose.yml` pins these local images:

- `apache/age:release_PG16_1.5.0`
- `redis:7-alpine`
- `postgres:16-alpine`
- `temporalio/auto-setup:1.29`
- `temporalio/admin-tools:1.29`
- `axllent/mailpit:latest`

Validation commands:

```powershell
docker compose down --volumes --remove-orphans
docker compose pull
docker compose up -d
docker ps
```

All required containers should be `Up` or `healthy`; none should be `Restarting`.

The compose file intentionally does not set fixed `container_name` values. Docker Compose should namespace containers by project name so fresh clones can use `docker compose -p <project> ...` without global container-name collisions.

## Database Migrations

Initial Prisma migrations are committed under `prisma/migrations`. Do not run `prisma migrate dev --name init` for setup; that creates a machine-local migration folder. Use:

```powershell
npx prisma migrate dev
```

For deployment-style migration application, use:

```powershell
npx prisma migrate deploy
```

## Regulatory API Keys

Local regulatory pipeline credentials go in `.env`, copied from `.env.example`:

```text
LEGISCAN_API_KEY=     # required; use blank or requested until issued
OPENFDA_API_KEY=      # optional; improves openFDA rate limits
USDA_API_KEY=         # required for USDA FoodData Central
# Federal Register uses a public API and does not require an API key.
# Legacy FEDERAL_REGISTER_API_KEY values are ignored if present.
```

These are platform-level data-source credentials. Federal Register is the exception: FederalRegister.gov APIs are public and require no key. The other credentials are not tenant settings and should not be entered into normal frontend-accessible settings screens. For production, configure them in the hosting platform or secret manager used to run Cascada, such as deployment environment variables, Docker secrets, or Kubernetes secrets, then restart the app and background workers that run regulatory pipelines.

The app must never expose the secret values to the browser. Admin UI may show configured/missing status, masked labels, test results, and last successful sync timestamps, but secret value storage and rotation should be handled by the platform secret store.

Regulatory ingestion trigger routes are authenticated operational endpoints. `POST /api/pipelines` and `POST /api/pipelines/[type]` default to `mode: "dry_run"`, require a specific pipeline type, and enforce a maximum bounded limit of 25 records. `mode: "write"` must be explicit and creates `PipelineRun` observability rows. Dry-runs fetch, transform, and dedupe preview records but do not persist source records.

Source semantics:

- Federal Register is a public no-key source that uses Federal Register document search.
- openFDA ingestion is limited to the official food enforcement endpoint first.
- USDA FoodData Central is ingredient/product/nutrition reference data and is stored as `REFERENCE_DATA`, not regulatory law.
- LegiScan remains blocked/not configured until a real key is available, and future requests use LegiScan's `key=` query parameter.

## Verification

Run:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npx tsx scripts/smoke-pdf.ts
```

`npm test` currently runs the committed Vitest unit/regression suite. No Playwright/E2E dependency or config is currently committed, so do not claim browser E2E coverage for this branch.

Dashboard verification must distinguish route availability from hydrated client render:

- `/dashboard` route status `200` only proves the route exists.
- The dashboard is also checked by `tests/unit/dashboard-render.test.ts`, which renders the page with API-envelope-shaped dashboard data and fails if client render assumptions throw.
- `tests/unit/exposure-page-render.test.ts` renders `/dashboard/exposure` with API-envelope-shaped exposure data.
- `tests/unit/dashboard-components.test.ts` verifies defensive empty-state rendering for `DataTable` and `ExposureMap`.
- `tests/unit/dashboard-normalizers.test.ts` covers empty, missing, paginated, and API-envelope trigger, exposure, product, and users payloads before severity/chart/table iteration.
- Manual browser verification on July 7, 2026 used a fresh browser profile, confirmed `/api/tenants/current` returned `401` before login, logged in with `admin@demofoods.com` / `cascada-demo-2026`, confirmed `/api/auth/session` and `/api/tenants/current` returned `200` after login, and loaded `/dashboard`, `/dashboard/exposure`, `/dashboard/triggers`, `/dashboard/regulations`, `/dashboard/decisions`, `/dashboard/agent`, `/dashboard/diagnostic`, `/dashboard/settings`, and `/dashboard/integrations` with no active Next.js runtime dialog and no `allTriggers is not iterable` or `data is not iterable` error text. Settings `Profile`, `Team`, `Plan`, and `Data Sources` tabs were clicked and rendered without a runtime overlay.

Current implemented app routes include `/`, `/login`, `/register`, `/dashboard`, `/dashboard/exposure`, `/dashboard/triggers`, `/dashboard/regulations`, `/dashboard/decisions`, `/dashboard/agent`, `/dashboard/settings`, `/dashboard/integrations`, and `/dashboard/diagnostic`.
