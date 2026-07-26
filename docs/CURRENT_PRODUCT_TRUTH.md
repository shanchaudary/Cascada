# Cascada Current Product Truth

**Truth date:** 2026-07-26  
**Repository:** `shanchaudary/Cascada`  
**Verified `main` before this delivery correction:** `552f0e41033bcab0e82e00b9aff8996105c987f3`

This document separates implemented code from proven product behavior. It must be updated when a milestone changes the evidence below.

## Product purpose

Cascada is intended to help food manufacturers trace a regulatory change through substances, ingredients, formulations, products, customers, financial exposure, and compliance decisions.

The product is not complete until that full chain is proven with tenant-bound persisted data, source evidence, failure handling, and a usable customer workflow.

## Proven repository baseline

The repository has materially exercised:

- locked dependency installation;
- Prisma client generation and schema validation;
- committed migrations against disposable PostgreSQL;
- deterministic seed execution once against a fresh CI database;
- TypeScript typecheck;
- ESLint execution with a measured 133-warning baseline;
- Vitest unit/regression tests;
- a fail-closed production dependency advisory gate;
- production build;
- Playwright Chromium smoke for unauthenticated tenant rejection, seeded login, dashboard rendering, and authenticated tenant access;
- pinned PostgreSQL and Redis CI services.

Cascada CI run `30188294385` passed the production advisory gate with zero HIGH/CRITICAL findings after the patched dependency graph was committed. That does not mean the complete dependency graph is risk-free or that all moderate/low findings are accepted indefinitely.

These claims are baseline evidence, not proof that every feature is complete.

## Implemented and materially exercised

- Next.js application shell and dashboard routes.
- Auth.js/NextAuth credential flow with seeded local users.
- PostgreSQL/Prisma schema and committed migrations.
- Redis, Temporal, Mailpit, PostgreSQL, and Apache AGE local service definitions.
- Dashboard defensive render tests for several API-envelope and empty-state cases.
- Bounded regulatory-ingestion interfaces.
- Federal Register public-source handling.
- openFDA food-enforcement ingestion scope.
- USDA reference-data classification.
- PipelineRun observability for explicit write-mode triggers.
- PDF scaffold smoke.
- Repository-wide agent operating law in `AGENTS.md`.
- Pull-request CI and narrow authentication/dashboard browser smoke.

## Implemented but not accepted as complete product behavior

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

- Cross-tenant isolation has not been accepted through a complete adversarial API and browser suite.
- One full regulation → substance → ingredient → formulation → product → customer → exposure → decision chain has not been accepted end to end.
- No ERP sandbox sync has been accepted.
- No complete Temporal worker/retry/recovery lifecycle has been accepted.
- No complete Stripe test payment → webhook → diagnostic → report → delivery lifecycle has been accepted.
- Production deployment, backups, restore, rollback, alerting, and incident response are not accepted.
- The delivery CI still measures 133 ESLint warnings. The bootstrap issue must reach zero without blanket suppression.
- The API-key-backed Codex implementation and repair workflows and `.ai-factory/project.json` are absent from this candidate PR head. They remain on `main` until PR #35 is explicitly approved and merged.
- Pro-backed Codex GitHub review has been behaviorally exercised on PR #35 and produced actionable exact-head findings.
- A write-capable Codex cloud environment for implementation and repair has not yet been created or accepted for Cascada.
- Optional scheduled queue automation has not been behaviorally accepted.
- A GLM review-only path without an OpenAI API dependency has not yet been accepted.
- No material issue has completed the corrected Codex Pro → CI → independent review → repair → human merge cycle.

## Delivery-system classification

```text
GitHub CI foundation: implemented and exercised
API-backed Codex workflows: absent from PR #35 candidate head; still on main pending merge
Pro-backed Codex GitHub review: exercised on PR #35
Pro-backed Codex implementation environment: not yet behaviorally accepted
GLM review-only integration: not yet behaviorally accepted
M0 supervised delivery exit gate: NOT PASSED
```

## Current product classification

```text
Development prototype with a verified install/auth baseline and partial regulatory capabilities.
Private beta ready: NO
Production ready: NO
Regulated-customer ready: NO
```

## Evidence required to change the product classification

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
11. The corrected supervised delivery loop passes a material, non-documentation Cascada issue with exact CI and independent-review evidence.

## Truth-maintenance rule

Every merged feature must update this file when it changes a claim. Wording must distinguish:

- implemented;
- unit-tested;
- integration-tested;
- browser-tested;
- live sandbox-tested;
- production-tested.

Do not replace those distinctions with “working” or “complete.”