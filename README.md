# Cascada

Cascada is a Next.js 15 application for food manufacturing regulatory cascade impact analysis. It uses PostgreSQL 16 with Apache AGE, Redis, Temporal, Prisma 6, NextAuth/Auth.js, and Vitest.

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

## Database Migrations

Initial Prisma migrations are committed under `prisma/migrations`. Do not run `prisma migrate dev --name init` for setup; that creates a machine-local migration folder. Use:

```powershell
npx prisma migrate dev
```

For deployment-style migration application, use:

```powershell
npx prisma migrate deploy
```

## Verification

Run:

```powershell
npm run typecheck
npm run lint
npm test
npx tsx scripts/smoke-pdf.ts
```

`npm test` currently runs the committed Vitest unit/regression suite. No Playwright/E2E dependency or config is currently committed, so do not claim browser E2E coverage for this branch.

Current implemented app routes include `/`, `/login`, `/register`, `/dashboard`, `/dashboard/exposure`, `/dashboard/triggers`, `/dashboard/regulations`, `/dashboard/decisions`, `/dashboard/agent`, `/dashboard/settings`, `/dashboard/integrations`, and `/dashboard/diagnostic`.
