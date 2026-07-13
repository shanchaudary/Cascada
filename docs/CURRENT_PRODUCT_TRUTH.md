# Cascada Current Product Truth

**Truth date:** 2026-07-13  
**Repository:** `shanchaudary/Cascada`  
**Verified main head when this document was created:** `29842d44c6e7344195a99d3d986d4949666f2cb3`

This document separates implemented code from proven product behavior. It must be updated when a milestone changes the evidence below.

## Product purpose

Cascada is intended to help food manufacturers trace a regulatory change through substances, ingredients, formulations, products, customers, financial exposure, and compliance decisions.

The product is not complete until that full chain is proven with tenant-bound persisted data, source evidence, failure handling, and a usable customer workflow.

## Proven baseline

The accepted install/auth baseline recorded in `README.md` is commit:

```text
5b191680c9d35cc3603ce82d635f1b50ed9190fc
```

The repository states that a fresh clone was verified on 2026-07-07 for:

- dependency installation;
- Docker stack startup;
- Prisma generation, migration, and seed;
- TypeScript typecheck;
- ESLint execution with existing warnings;
- Vitest unit/regression tests;
- production build;
- seeded demo login;
- `/dashboard` route;
- authenticated and unauthenticated session/tenant route behavior.

Those claims are baseline evidence, not proof that every feature is complete.

## Implemented and materially exercised

- Next.js application shell and dashboard routes.
- Auth.js/NextAuth credential flow with seeded local users.
- PostgreSQL/Prisma schema and committed migrations.
- Redis, Temporal, Mailpit, PostgreSQL, and Apache AGE local service definitions.
- Dashboard defensive render tests for several API-envelope and empty-state cases.
- Bounded regulatory ingestion dry-run interfaces.
- Federal Register public-source handling.
- openFDA food-enforcement ingestion scope.
- USDA reference-data classification.
- PipelineRun observability for explicit write-mode triggers.
- PDF scaffold smoke.
- Repository-wide agent operating law in `AGENTS.md`.

## Implemented but not yet accepted as complete product behavior

- Regulatory ingestion beyond bounded source-specific checks.
- Cascade graph and exposure calculations across the complete business chain.
- Decision package lifecycle.
- AI-assisted regulatory analysis.
- ERP connector classes and integration surfaces.
- Temporal workflow integration.
- Stripe, report generation, storage, delivery, and retrieval.
- Email delivery.
- Tenant administration and settings.
- Production observability and operational recovery.

A route, class, schema, UI panel, or passing unit test does not by itself prove these capabilities work end to end.

## Known unproven or incomplete areas

- No previously committed GitHub Actions CI workflow was found at the creation of the delivery-foundation branch.
- No previously committed Playwright browser E2E suite was present.
- Cross-tenant isolation has not been accepted through a complete adversarial API and browser suite.
- One full regulation → substance → ingredient → formulation → product → customer → exposure → decision chain has not been accepted end to end.
- No ERP sandbox sync has been accepted.
- No complete Temporal worker/retry/recovery lifecycle has been accepted.
- No complete Stripe test payment → webhook → diagnostic → report → delivery lifecycle has been accepted.
- Production deployment, backups, restore, rollback, alerting, and incident response are not accepted.
- The README records 11 moderate npm audit findings and 148 lint warnings as baseline debt.

## Current release classification

```text
Development prototype with a verified install/auth baseline and partial regulatory capabilities.
Private beta ready: NO
Production ready: NO
Regulated-customer ready: NO
```

## Evidence required to change that classification

1. Automated pull-request CI passes from a fresh checkout.
2. Browser E2E proves authentication and critical protected flows.
3. Tenant isolation is proven across APIs, database queries, and UI flows.
4. The complete Cascada value chain is proven using seeded data.
5. At least one real public regulatory source reaches that value chain.
6. At least one ERP sandbox sync is proven.
7. The paid diagnostic lifecycle is proven in test mode.
8. Temporal recovery and human-approval behavior is proven.
9. Staging deployment, rollback, backup, restore, logging, and alerting are proven.
10. Security, privacy, and regulatory-position reviews are accepted.

## Truth-maintenance rule

Every merged feature must update this file when it changes a claim. Wording must distinguish:

- implemented;
- unit-tested;
- integration-tested;
- browser-tested;
- live sandbox-tested;
- production-tested.

Do not replace those distinctions with “working” or “complete.”
