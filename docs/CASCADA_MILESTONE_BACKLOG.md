# Cascada Outcome-Based Milestone Backlog

Milestones are ordered by risk reduction and product proof, not by the number of screens or connector classes implemented.

## M0 — Automated delivery foundation

### Outcome

A bounded issue can travel through branch, PR, deterministic CI, independent review, and merge without direct edits to `main` or repeated founder command relay.

### Required deliverables

- pull-request CI;
- PostgreSQL and Redis test services;
- Prisma migration and seed verification;
- typecheck, lint ceiling, tests, audit, and production build;
- Playwright critical authentication/dashboard smoke;
- implementation/review issue templates;
- PR evidence template;
- current-product-truth document;
- delivery operating model;
- protected-main ruleset;
- Codex Cloud repository/environment verification.

### Exit gate

One low-risk trial issue completes issue → Codex → PR → CI → independent review → explicitly approved merge.

## M1 — Authentication and tenant authority

### Outcome

Tenant identity is derived from authenticated server authority and cannot be supplied or overridden by untrusted request data.

### Deliverables

- inventory every tenant authority source;
- eliminate body/header/query tenant overrides from protected production paths;
- enforce role checks;
- protect every mutation route;
- add database/query tenant boundaries;
- add cross-tenant API, integration, and browser tests;
- audit sensitive actions;
- document session and tenant authority.

### Exit gate

Tenant A cannot read, write, infer, or mutate Tenant B data through any tested path.

## M2 — Core Cascada value chain

### Outcome

One seeded regulatory change produces an explainable, persisted, tenant-bound cascade and decision package.

### Required chain

```text
regulatory source
→ rule
→ affected substance
→ ingredient
→ formulation
→ product
→ customer
→ financial exposure
→ decision package
```

### Exit gate

Every edge is source-cited, inspectable through APIs and UI, covered by integration/browser tests, and reproducible from a clean seed.

## M3 — First real regulatory source

### Outcome

A real public regulatory source reaches the same accepted cascade path.

### Initial source

Federal Register, because it is public and requires no credential.

### Deliverables

- bounded dry-run;
- explicit reviewed candidate selection;
- one-record write mode;
- idempotent replay;
- source URL and raw evidence preservation;
- PipelineRun observability;
- persisted rule processing;
- cascade creation;
- UI and API visibility;
- failure, retry, and duplicate handling.

### Exit gate

One real Federal Register record produces the accepted cascade and decision evidence without duplicate writes.

## M4 — First ERP sandbox integration

### Outcome

One selected ERP supplies real sandbox data that participates in the Cascada cascade.

### Deliverables

- choose one first-customer ERP;
- encrypted credential handling;
- authenticated connection creation;
- read-only test connection;
- bounded sandbox sync;
- idempotent import;
- sync logs and failure evidence;
- mapping into Cascada entities;
- disconnect and credential-rotation flow.

### Exit gate

A sandbox sync populates tenant-bound ingredients/products/customers and those records participate in the accepted cascade.

All other ERP connectors remain explicitly unavailable until separately proven.

## M5 — Paid diagnostic vertical slice

### Outcome

A customer can complete a real test-mode paid diagnostic lifecycle.

### Required chain

```text
request
→ Stripe test payment
→ verified idempotent webhook
→ diagnostic record
→ analysis
→ complete report
→ object storage
→ email delivery
→ customer retrieval
→ failure/refund handling
```

### Exit gate

The complete chain passes test-mode integration and browser acceptance with no fake report, email, or payment behavior.

## M6 — Workflow automation and recovery

### Outcome

Temporal orchestrates business flows that already work manually and recovers safely from interruption.

### Deliverables

- real worker process;
- registered workflows and activities;
- idempotency keys;
- retries and bounded backoff;
- human approval points;
- cancellation;
- persistence and restart recovery;
- observability;
- failure and duplicate-delivery tests.

### Exit gate

An interrupted workflow restarts without duplicate business effects and completes or fails with inspectable evidence.

## M7 — Private beta readiness

### Outcome

Cascada can safely support invited non-production customers in a controlled staging environment.

### Deliverables

- staging deployment;
- secret manager;
- error tracking, logs, and metrics;
- rate limits;
- backups and verified restore;
- rollback runbook;
- dependency and lint debt reduction;
- security review;
- privacy/data lifecycle controls;
- tenant export/deletion;
- regulatory and legal disclaimers;
- support and incident procedures.

### Exit gate

Fresh staging deployment, rollback, backup/restore, security review, and complete critical browser suite all pass.

## M8 — Production release readiness

Production release requires a separate founder-approved plan after private beta evidence exists. It must not be inferred from completion of feature code.
