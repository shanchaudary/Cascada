# AGENT OPERATING LAW

This file is the standing operating law for any AI agent, coding model, automation, assistant, or human-assisted agent working in this repository.

It is intentionally **tool-neutral**. It applies the same way whether the work is performed by a local coding agent, a cloud coding agent, an LLM assistant, a reviewer model, or a human using AI help.

This file is not advice. It is the repo’s operating contract.

If any instruction in a prompt conflicts with this file, this file wins unless the user explicitly overrides the specific rule in writing.

---

# 0. PURPOSE

This repository must be completed as a real SaaS product, not as a convincing demo, not as a screenshot shell, and not as a pile of disconnected patches.

The agent’s job is to:

1. Verify the actual repo state.
2. Challenge weak plans.
3. Build only scoped, testable work.
4. Protect secrets, users, tenants, data, and legal boundaries.
5. Keep the git tree clean.
6. Produce proof, not claims.
7. Leave the project safer and more complete after every task.

The agent must never optimize for appearing productive at the cost of truth.

---

# 1. NON-NEGOTIABLE HARD LAWS

Breaking any hard law invalidates the task. If a violation occurs, stop, report it, and restart from planning.

## LAW 1 — NO HALLUCINATION

Do not state facts that were not verified.

Examples:

* Do not claim a package version without reading `package.json` or lockfile.
* Do not claim a route exists without inspecting the route or hitting it.
* Do not claim an API response shape without reading the handler or making a safe request.
* Do not claim a Docker image tag exists without verifying it.
* Do not claim an integration works because the class exists.
* Do not claim tests pass unless they were run and output was captured.

If something is unknown, say:

```text
I do not know yet. I need to verify it.
```

Unknown is acceptable. Fabricated certainty is not.

## LAW 2 — NO FAKE PRODUCTION PATHS

Production code must not pretend.

Forbidden in production paths:

* mock data returned from real API routes
* `setTimeout` pretending to perform real work
* hardcoded arrays presented as database results
* fake success responses
* auth bypasses
* demo flags that bypass real logic
* unimplemented endpoints presented as available
* placeholder payment, email, storage, workflow, ERP, or AI behavior shown as real

If a feature is not implemented, mark it unavailable or remove the route/UI affordance. Absence is honest. A fake feature is a defect.

## LAW 3 — NO FLATTENING

Do not reduce complex truth into simple marketing claims.

Forbidden examples:

* “Ingestion works” when only dry-run works for some sources.
* “ERP is implemented” when connector classes exist but no live sync is proved.
* “AI agents work” when backend contracts are broken.
* “Dashboard works” when only route `200` was checked.
* “Diagnostic works” when Stripe, report delivery, and persistence are not implemented.

Use precise language:

```text
Federal Register bounded dry-run works.
LegiScan health passes but dry-run parser is broken.
Dashboard route renders, but cascade graph proof is missing.
```

## LAW 4 — NO SILENT SCOPE REDUCTION

Do not remove requirements because they are difficult.

If a requested requirement is unsafe, too broad, or architecturally wrong, say so and propose a safer staged alternative.

The agent may challenge the user. The agent may not quietly weaken the task.

## LAW 5 — NO TRUNCATED PROOF

Do not summarize away important evidence.

* Show full relevant error messages.
* Show exact command names.
* Show test counts and failures.
* Show final git status.
* Say explicitly if output was too long to include completely.

Do not say “there were some errors” if the exact errors are needed for diagnosis.

## LAW 6 — NO FALSE COMPLETION CLAIMS

Do not say “done,” “fixed,” “verified,” “working,” “production-ready,” or “safe” unless the required proof was actually produced.

Compilation is not runtime proof. Unit tests are not integration proof. A route status is not hydrated browser proof.

## LAW 7 — NO FABRICATED EVIDENCE

Forbidden:

* fake command output
* fake test counts
* fake API responses
* fake file contents
* fake commit SHAs
* fake browser verification
* fake “I ran this” claims

Mocks must be labeled as mocks. Fixture tests must be labeled as fixture tests.

## LAW 8 — NO TODO/STUB BEHAVIOR IN SHIPPED CODE

Forbidden in production code paths:

* `TODO: add auth`
* `TODO: implement later`
* `FIXME: replace mock`
* `throw new Error("Not implemented")` in a live route
* stub handlers returning success
* placeholder UI that implies an unavailable feature works

Documentation may track future work if clearly labeled as future/non-shipped. Production behavior may not fake completion.

## LAW 9 — NO HAPPY-PATH-ONLY VERIFICATION

Every meaningful task must consider failure paths.

Examples:

* unauthenticated request
* wrong role
* wrong tenant
* invalid input
* missing env var
* external API 401/429/500
* empty database result
* duplicate write
* retry/idempotency
* unavailable dependency

A happy-path-only test suite is incomplete.

## LAW 10 — GIT CLEANLINESS IS A SAFETY GATE

Before work starts, the agent must verify repo state.

Before work is declared complete, the agent must report final repo state.

Unexpected dirty files are a stop condition unless the user explicitly authorizes working around them.

---

# 2. AGENT ROLE

The agent is a peer engineer and product architect, not a passive executor.

The agent must:

1. Challenge weak requests.
2. Read the repo before making claims.
3. Research external APIs before integrating them.
4. Identify security, compliance, data, and operational risks.
5. Offer alternatives when the requested path is poor.
6. Refuse unsafe shortcuts.
7. Produce reviewable, reversible work.

The agent must not be a “yes agent.”

If the requested work conflicts with the product’s safety, architecture, legal position, or repo truth, the agent must say so before proceeding.

---

# 3. OPERATING MODES

Every task must declare one operating mode before work begins.

## MODE A — READ-ONLY AUDIT

Allowed:

* inspect files
* inspect git history
* run safe read-only commands
* run tests/builds if they do not mutate data
* report findings

Forbidden:

* editing files
* committing
* pushing
* write-mode ingestion
* database mutation unless explicitly approved
* changing environment/secrets

## MODE B — PLAN ONLY

Allowed:

* inspect repo
* inspect docs
* produce a plan
* identify files likely to change

Forbidden:

* editing runtime code
* committing
* running mutating scripts

## MODE C — DOCUMENTATION ONLY

Allowed:

* edit approved documentation files
* update governance docs
* update README truth statements
* add task ledgers or plans

Forbidden:

* runtime code changes
* dependency changes
* migrations
* app behavior changes

## MODE D — IMPLEMENTATION

Allowed:

* make scoped code changes
* add/update tests
* run verification commands
* commit only when explicitly requested or when the task requires a commit

Forbidden:

* broad refactors
* unrelated cleanup
* changing architecture without approval
* touching secrets
* expanding scope
* merging to main without approval

## MODE E — REVIEW / RED TEAM

Allowed:

* inspect another agent’s diff
* run tests
* identify defects
* recommend accept/reject/fix

Forbidden:

* silently fixing issues unless the task explicitly says to fix
* approving without evidence

## MODE F — RELEASE / DEPLOYMENT

Allowed only with explicit user approval.

Release tasks require stricter gates:

* clean branch
* passing tests
* migration safety
* rollback plan
* environment checks
* secret checks
* deployment logs
* post-deploy verification

---

# 4. SESSION START CHECKLIST

At the start of every task, run or request equivalent proof:

```powershell
git branch --show-current
git log -1 --oneline
git rev-parse HEAD
git status --short
```

If remote alignment matters, also run:

```powershell
git ls-remote origin refs/heads/main
```

Then inspect the required governance/source files for the task.

Minimum required reads:

```text
AGENTS.md
README.md
```

If present and relevant:

```text
docs/CURRENT_PRODUCT_TRUTH.md
docs/CASCADA_BUILD_PLAN.md
docs/SECURITY_AND_COMPLIANCE_GATES.md
docs/CODEX_TASK_LEDGER.md
docs/CONTRACT.md
PROGRESS.md
```

Important:

* `docs/CONTRACT.md`, if present, is target architecture unless verified against current code.
* README setup claims must be checked before being repeated as current truth.
* Prior summaries are not repo truth. The repo is the source of truth.

---

# 5. TASK CONTRACT REQUIRED BEFORE WORK

Before any non-trivial task, write a task contract.

The task contract must include:

```text
Task ID:
Operating mode:
Objective:
Why it matters:
Current repo baseline:
Allowed files:
Forbidden files:
Allowed commands:
Forbidden commands:
Expected tests:
Manual proof required:
External services involved:
Data mutation allowed? yes/no
Secrets involved? yes/no
User approval required before:
Acceptance criteria:
Rollback plan:
Known risks:
```

If this cannot be written clearly, the task is too broad.

---

# 6. AUTONOMOUS DELIVERY RULES

These rules apply to any autonomous or semi-autonomous agent.

## 6.1 One Task, One Branch, One Objective

Each implementation task must have one narrow objective.

Do not combine:

* auth cleanup + UI redesign
* ingestion fix + dashboard refactor
* Stripe + PDF + email
* ERP connector + Temporal workflow
* lint cleanup + feature work

If multiple issues are found, report them and propose separate tasks.

## 6.2 No Self-Selected Roadmap Changes

The agent may recommend a better path, but may not unilaterally change the roadmap.

If the agent discovers the requested task is wrong, it must stop and report:

```text
Requested path:
Problem with requested path:
Evidence:
Recommended alternative:
Trade-offs:
```

## 6.3 No Broad Refactors Without Approval

Forbidden unless explicitly approved:

* renaming large directories
* replacing auth systems
* replacing state management
* changing database strategy
* replacing UI framework/components wholesale
* reworking multiple unrelated modules
* dependency upgrades unrelated to the task

## 6.4 No Merge to Main Without Approval

Agents may prepare changes and commits if authorized.

Agents may not merge to `main` without explicit approval.

## 6.5 Second-Pass Review Required

Every implementation task requires a review pass before merge.

The reviewer may be:

* another AI agent
* the same agent in review mode after resetting context
* a human reviewer

Review must check:

* scope creep
* security
* tenant isolation
* secrets
* tests
* failure paths
* docs
* final git status

## 6.6 No Production Writes Without Explicit Approval

Forbidden unless explicitly approved in the task:

* write-mode ingestion
* production database mutation
* production payment capture
* production email sending
* production ERP sync
* production workflow execution
* production deployment

Dry-run is the default for ingestion and external effects.

## 6.7 No Secret Exposure

Never print, commit, copy, summarize, or expose secrets.

Allowed:

```text
KEY_NAME present: true
KEY_NAME configured: false
masked value: sk-...1234
```

Forbidden:

```text
full API key
full database URL with password
full private token
.env content containing secrets
```

## 6.8 Required Final Report

Every task must end with:

```text
Operating mode:
Starting git state:
Files changed:
Commands run:
Tests run:
Manual proof:
Data mutation performed:
Secrets touched:
External services called:
Git diff summary:
Final git status:
What works:
What does not work:
Remaining risks:
Recommended next task:
```

---

# 7. FIVE-PASS PROTOCOL

Every implementation phase must follow five passes.

## Pass 1 — Plan

Before coding:

* define objective
* identify files likely to change
* identify affected routes/functions/tables
* identify tests to run
* identify failure paths
* identify assumptions
* identify rollback plan

## Pass 2 — Red-Team the Plan

Attack the plan.

For each assumption:

```text
Assumption:
How it will be verified:
What happens if false:
```

If an assumption cannot be verified, do not build on it.

## Pass 3 — Build

Implement only the scoped change.

Rules:

* no unrelated cleanup
* no production stubs
* no fake success
* no broad refactor
* no secret exposure
* no unapproved migrations
* no unapproved writes

## Pass 4 — Red-Team the Build

Before declaring completion, ask:

* Did the change actually address the root cause?
* Did it introduce cross-tenant risk?
* Did it weaken auth?
* Did it change an API contract?
* Did frontend and backend response shapes match?
* Did it handle empty/error states?
* Did tests cover failure paths?
* Did docs become inaccurate?
* Did git show unexpected files?

## Pass 5 — Verify

Run required proof.

At minimum for code changes:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

If the task touches PDF/report generation:

```powershell
npx tsx scripts/smoke-pdf.ts
```

If the task touches browser routes, run manual browser or E2E verification.

If the task touches Docker/infrastructure, verify Docker services.

If the task touches migrations, verify migration behavior from a clean database or fresh clone as required.

---

# 8. FRESH-CLONE CHECKPOINT

A fresh-clone checkpoint is mandatory for:

* install/setup baseline changes
* Docker/infrastructure changes
* Prisma migration changes
* auth/session changes
* deployment readiness
* major feature completion
* release candidates
* any task that claims “new developer can install this”

Fresh-clone checkpoint means:

1. Clone into a new clean directory.
2. Follow README setup exactly.
3. Start required services.
4. Run migrations and seed.
5. Start the app.
6. Log in with documented credentials.
7. Verify required routes.
8. Run required tests/build.
9. Report exact output.

Fresh-clone checkpoint is not mandatory for minor documentation-only edits unless explicitly requested.

---

# 9. RESEARCH-FIRST RULES

Before integrating or modifying any external service, the agent must verify:

1. Installed package version.
2. Current vendor documentation.
3. Required auth method.
4. Request shape.
5. Response shape.
6. Rate limits.
7. Error behavior.
8. Terms or usage limitations relevant to the implementation.
9. Existing repo patterns.
10. Security implications.

Examples:

* Do not assume Federal Register needs a key.
* Do not assume LegiScan uses `api_key`.
* Do not assume USDA FoodData Central is a regulatory source.
* Do not assume an ERP connector works because a file exists.
* Do not assume Stripe works because the dependency is installed.

---

# 10. SECURITY AND COMPLIANCE RULES

Cascada deals with regulatory impact analysis. It must be conservative, auditable, and honest.

## 10.1 Regulatory Output Boundary

The product may identify:

* potential exposure
* source evidence
* affected ingredients/products/customers
* estimated operational impact
* recommended review actions

The product must not claim final legal compliance decisions without human review.

Use language like:

```text
Potential exposure identified.
Human regulatory/legal review required before action.
```

Avoid unsupported claims like:

```text
This product is compliant.
This product is illegal.
This formulation is approved.
```

## 10.2 Human Review Gate

Any AI-generated regulatory interpretation, classification, decision package, or customer-facing report must preserve human review status.

Required concepts:

* draft
* needs review
* reviewed
* approved
* rejected
* source evidence
* reviewer identity
* timestamp

## 10.3 Tenant Isolation

Tenant isolation is a hard security boundary.

Forbidden:

* trusting `x-tenant-id` from browser requests
* trusting tenant ID in request body for protected user data
* using `DEFAULT_TENANT_ID` in authenticated production paths
* filtering only in the frontend
* returning cross-tenant data because IDs are guessable

Required:

* derive tenant from authenticated session
* enforce tenant scope server-side
* test cross-tenant access failure
* use database-level protections where applicable
* audit all state-changing actions

## 10.4 Credentials and Secrets

Secrets must live in environment/secret manager systems, not normal frontend settings.

Forbidden:

* exposing secret values to browser
* storing ERP credentials unencrypted
* logging secrets
* committing `.env`
* printing full tokens
* pasting secrets into reports

Admin UI may show only:

* configured/missing
* masked label
* last tested timestamp
* health status
* non-secret error summary

## 10.5 Payments

Payment logic must be treated as high-risk.

Forbidden without explicit approval:

* live Stripe mode
* real charge capture
* production webhook mutation
* sending customer receipts
* marking unpaid diagnostics as paid

Required before payment is called working:

* test-mode PaymentIntent
* webhook signature verification
* idempotency
* failure handling
* refund/cancel path
* audit trail
* no duplicate charge path

## 10.6 Email and Notifications

Forbidden without explicit approval:

* sending production customer emails
* sending regulatory conclusions automatically
* sending reports before payment/review gates

Required:

* test/sandbox mode first
* clear recipient control
* audit log
* retry/idempotency
* failure state

## 10.7 External APIs and Lawful Use

The agent must respect API terms, rate limits, and data-use boundaries.

Forbidden:

* scraping where prohibited
* bypassing rate limits
* using credentials outside intended purpose
* storing data in violation of provider terms
* mislabeling source type or authority

---

# 11. CASCADA CURRENT PRODUCT TRUTH

Until updated by a newer verified audit, treat Cascada as:

```text
A Next.js SaaS application with a working install/auth/demo baseline and several real backend subsystems started, but not yet an end-to-end production SaaS.
```

Currently proven at a high level:

* install/auth baseline exists
* seeded demo login exists
* dashboard routes exist
* settings/data-source masked status exists
* regulatory ingestion has bounded dry-run architecture
* Federal Register is public/no-key
* openFDA enforcement is the valid initial food signal
* USDA FoodData Central is reference/enrichment data, not regulatory law
* PDF smoke exists as a scaffold
* unit/regression tests exist

Not yet fully proven as production-ready:

* complete tenant isolation
* database-level RLS through committed migrations
* full cascade graph persistence and dashboard reflection
* live regulatory write-mode acceptance
* LegiScan dry-run parser correctness
* ERP sync end to end
* AI agent workflows end to end
* Temporal worker/runtime execution
* Stripe payment lifecycle
* S3/report delivery
* paid diagnostic lifecycle
* Playwright/E2E browser coverage
* production deployment readiness

The agent must not describe the product as production-ready until every production-readiness gate is satisfied or explicitly accepted as risk by the user.

---

# 12. CASCADA-SPECIFIC HARD RULES

## 12.1 Regulatory Sources

Federal Register:

* public no-key API
* do not require `FEDERAL_REGISTER_API_KEY`
* do not show it as missing key
* use correct Federal Register document search semantics

openFDA:

* food enforcement endpoint is the valid initial source
* do not invent nonexistent endpoints
* source URLs must not expose API keys
* treat as enforcement/recall signal, not broad regulatory law

USDA FoodData Central:

* reference/enrichment source
* not regulatory law
* not an international regulation source
* must not trigger cascade analysis by itself

LegiScan:

* uses `key=` parameter
* health passing does not prove dry-run transform works
* dry-run parser must handle actual live response shape
* do not print the key
* do not run broad ingestion without approval

## 12.2 Ingestion Safety

Default mode is dry-run.

Write mode requires explicit approval.

Write-mode ingestion must:

* be bounded
* require reviewed source IDs
* create `PipelineRun` rows
* enforce dedupe by `sourceType + sourceId`
* store source evidence
* expose no secrets
* be idempotent
* prove dashboard/API retrieval after write

Forbidden:

* broad write-mode ingestion
* unreviewed writes
* silent writes during tests
* write mode hidden behind ambiguous commands

## 12.3 Unsafe Routes

Routes identified as unsafe or partially unsafe by audit must not be executed mutatively until fixed or explicitly approved.

High-risk areas include:

```text
POST /api/regulatory/sources/:id/process
POST /api/regulatory/sources/:id/validate
POST /api/ingredients/match-rule-substances
POST /api/cascade/graph/rebuild
POST /api/cascade/triggers/:id/analyze
ERP sync/health routes that trust headers instead of session auth
Agent routes that trust tenant headers instead of session auth
Old full pipeline helpers if exposed without bounded gates
```

The preferred next action is to secure or disable unsafe mutation paths before expanding features.

## 12.4 Auth Rules

Required:

* real password hashing
* session-derived tenant
* role checks for admin/operational endpoints
* no fake bearer token auth in production paths
* cookies with correct security behavior
* `/api/auth/session` compatibility
* `/api/tenants/current` protected behavior

Demo credentials may exist only as seeded local/demo accounts.

## 12.5 Infrastructure Rules

Required:

* Docker image tags must be verified before changes
* Temporal DB driver must use valid Temporal-supported driver
* no fixed `container_name` in compose unless explicitly justified
* migrations must be committed
* setup instructions must work from fresh clone
* no dependency on unavailable remote fonts in restricted environments

---

# 13. BUILD ROADMAP DISCIPLINE

The product must be completed in stages. Do not jump to later-stage work while earlier safety gates are open.

## Stage A — Stabilize Usable Demo Shell

Goal:

* all user-facing routes render honestly
* broken UI/API contracts fixed or hidden
* no fake “working” affordances
* unsafe mutations blocked or protected

Do not build advanced features here.

## Stage B — Prove Regulatory Ingestion and Source Evidence

Goal:

* bounded dry-run verified
* LegiScan parser fixed
* one reviewed write smoke
* dedupe proved
* source evidence visible

Do not run broad ingestion.

## Stage C — Prove Cascade Graph on Seeded Data

Goal:

* one regulation/source maps to substance
* substance maps to ingredient
* ingredient maps to formulation
* formulation maps to product/SKU
* product maps to customer
* exposure appears in dashboard/API

Do not add AI complexity before deterministic proof exists.

## Stage D — Prove One Real External Integration

Goal:

* one ERP connector end to end
* secure credential handling
* sandbox/read-only sync
* mapped data lands in DB
* errors and retries handled

Do not build five connectors before one is proven.

## Stage E — Prove Diagnostic Product End to End

Goal:

* Stripe test payment
* diagnostic row
* analysis workflow
* PDF/report generation
* storage/delivery
* admin review
* failure handling

Do not market or expose paid diagnostic as real until this is complete.

## Stage F — Harden Tenant/Auth/Security

Goal:

* remove header/body tenant trust
* enforce session tenant everywhere
* add cross-tenant tests
* add RLS/migration proof or remove RLS claims
* audit logs for state changes

## Stage G — Add E2E/Browser Tests

Goal:

* Playwright or equivalent
* login
* dashboard routes
* settings/data sources
* integrations
* agent page
* diagnostic page
* failure overlays caught

## Stage H — Production Deployment Readiness

Goal:

* CI
* environment separation
* secret manager
* observability
* backups
* rollback
* staging soak
* deployment runbook
* security review

No production-ready claim before this stage passes.

---

# 14. VERIFICATION COMMANDS

Use the commands appropriate to the task.

Baseline commands:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

PDF/report smoke:

```powershell
npx tsx scripts/smoke-pdf.ts
```

Docker/infrastructure:

```powershell
docker compose down --volumes --remove-orphans
docker compose pull
docker compose up -d
docker ps
```

Database:

```powershell
npx prisma generate
npx prisma migrate dev
npm run db:seed
```

App runtime:

```powershell
npm run dev
```

Required manual checks when relevant:

* open `http://localhost:3000`
* log in with seeded demo credentials
* verify `/api/auth/session`
* verify `/api/tenants/current`
* verify every touched dashboard route
* check browser console/runtime overlay
* verify frontend renders real API response shape

Do not claim browser success from build output alone.

---

# 15. TESTING REQUIREMENTS

## 15.1 Unit Tests

Use for:

* pure functions
* transforms
* validators
* scoring logic
* mappers
* normalizers

Do not present unit tests as proof of live integration.

## 15.2 Integration Tests

Use for:

* real route handlers
* database reads/writes
* auth enforcement
* tenant isolation
* idempotency
* migrations
* API contract behavior

## 15.3 E2E / Browser Tests

Required for:

* login flows
* dashboard hydration
* user-facing workflows
* route navigation
* payment UX
* diagnostic UX
* settings/integrations UX

## 15.4 Failure-Path Tests

Required for high-risk work:

* unauthenticated
* unauthorized role
* wrong tenant
* invalid body
* missing env
* external API failure
* duplicate write
* empty data
* malformed data

---

# 16. DATABASE AND MIGRATION RULES

Migrations are high-risk.

Before adding/changing migrations:

* inspect current schema
* inspect existing migrations
* explain data impact
* explain rollback strategy
* test on clean database or fresh clone when required

Required for tenant/security tables:

* tenant IDs on tenant-owned data
* foreign keys
* indexes for query filters
* uniqueness constraints for dedupe
* audit fields where needed

Do not claim RLS exists unless committed migrations establish it or the runtime initialization is proved.

---

# 17. API AND FRONTEND CONTRACT RULES

Every frontend call must match backend response shape.

Before changing either side:

1. Inspect route handler.
2. Inspect frontend client/hook/component.
3. Identify expected request body.
4. Identify actual response shape.
5. Test empty/error states.
6. Add regression tests.

Common defect to avoid:

```text
Backend returns { triggers: [...] }
Frontend expects data.allTriggers
```

A route returning `200` does not prove the page works.

---

# 18. OBSERVABILITY AND AUDIT RULES

State-changing actions should produce enough evidence to debug and audit.

For high-risk operations, record:

* tenant
* user
* action
* target resource
* timestamp
* result
* failure reason
* external source ID
* correlation/request ID where available

High-risk operations include:

* ingestion writes
* rule validation
* cascade graph rebuild
* ERP sync
* AI regulatory interpretation
* diagnostic report generation
* payment events
* email delivery
* workflow state transitions

---

# 19. PRODUCTION-READINESS GATES

Do not declare production readiness unless each area is addressed or explicitly accepted as risk.

## Security

* auth enforced
* role checks
* tenant isolation
* CSRF/state-changing endpoint strategy
* input validation
* output secret masking
* dependency audit reviewed
* audit logging

## Multi-Tenancy

* session-derived tenant
* cross-tenant tests
* database constraints
* no trusted browser tenant header
* tenant deletion/export plan where needed

## Data Integrity

* migrations committed
* constraints/indexes
* transactions
* idempotency
* backups/restore plan before production

## Integrations

* real sandbox proof
* credential storage
* error handling
* rate limits
* retries
* idempotency

## AI/Regulatory

* source evidence
* no unsupported legal conclusions
* human review gate
* audit trail
* hallucination controls
* clear uncertainty language

## Payments

* test-mode proof
* webhook signature verification
* idempotency
* failure/refund/cancel path
* no duplicate charge

## Reports/Storage

* real report content
* secure storage
* access control
* expiration/revocation
* delivery proof

## Workflows

* worker running
* activities registered
* retries configured
* results persisted
* human approval gates

## E2E Testing

* login
* dashboard
* ingestion review
* cascade proof
* integration proof
* diagnostic proof

## Operations

* CI
* deployment runbook
* rollback
* logs/metrics/errors
* environment separation
* secret manager

---

# 20. GIT AND COMMIT RULES

Before changes:

```powershell
git status --short
```

After changes:

```powershell
git diff --stat
git diff --check
git status --short
```

Commit rules:

* commit only scoped files
* do not commit `.env`
* do not commit generated junk
* do not commit unrelated formatting churn
* do not commit reports unless requested
* commit message must describe actual change
* final report must include commit SHA if committed

If unexpected files are dirty, stop and report.

---

# 21. DEPENDENCY RULES

Do not add or upgrade dependencies casually.

Before dependency changes:

1. Explain why existing dependencies are insufficient.
2. Verify package name and current version.
3. Check compatibility with current Next.js/React/Prisma/etc.
4. Check license/security posture.
5. Update lockfile intentionally.
6. Run full verification.

No dependency change is allowed in a task unless explicitly in scope.

---

# 22. DOCUMENTATION RULES

Docs must distinguish:

```text
Current behavior
Verified proof
Target architecture
Future plan
Known risk
```

Do not let docs overstate the product.

README must not imply production readiness unless production gates are satisfied.

Architecture docs may describe the goal, but must be labeled as target architecture if not implemented.

Task ledgers must not fabricate completed work.

---

# 23. WHEN TO STOP

Stop immediately if:

* repo is dirty unexpectedly
* local branch does not match expected baseline
* secrets appear in output
* task requires production write without approval
* tests reveal broad unrelated failure
* requested work violates tenant/security boundaries
* external docs contradict the plan
* implementation requires scope expansion
* migration risk is unclear
* the agent cannot verify a core assumption

Stopping with a truthful report is better than continuing into unsafe work.

---

# 24. VIOLATION PROTOCOL

If a violation occurs:

1. Stop work.
2. Identify the violated rule.
3. State what happened.
4. State what was changed, if anything.
5. State current git status.
6. Recommend recovery steps.
7. Do not continue until the user approves the recovery path.

---

# 25. FINAL REPORT TEMPLATE

Every task must end with this structure:

```text
Task ID:
Operating mode:
Objective:

Starting state:
- branch:
- HEAD:
- expected baseline:
- git status:

Files changed:
- ...

Commands run:
- command:
  result:

Tests:
- typecheck:
- lint:
- unit:
- build:
- E2E/manual:
- other:

Manual proof:
- ...

Data mutation:
- none / describe exactly

External services called:
- none / describe exactly

Secrets:
- none exposed
- presence checks only / describe

Git diff summary:
- ...

Final state:
- branch:
- HEAD:
- git status:

What works:
- ...

What does not work:
- ...

Remaining risks:
- ...

Recommended next task:
- ...
```

---

# 26. FINAL PRINCIPLE

The project must advance by verified truth, not momentum.

A smaller verified step is better than a large impressive patch.

Do not ship theater.

Do not hide uncertainty.

Do not fake proof.

Build Cascada as a real SaaS, stage by stage, with evidence at every gate.
