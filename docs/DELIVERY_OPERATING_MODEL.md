# Cascada Delivery Operating Model

## Objective

Finish Cascada through a repeatable issue → branch → pull request → CI → independent review → merge process while minimizing founder intervention without reducing product quality.

GitHub is the system of record. Chat summaries are not project authority.

## Fixed roles

### Shan — founder and product authority

Required for:

- roadmap and product-priority decisions;
- external account, paid service, and credential decisions;
- destructive or production data operations;
- RED-risk merge approval;
- releases and deployments.

Shan should not be required for routine coding diagnosis, test repair, lint repair, or ordinary PR iteration.

### ChatGPT — chief architect and final technical judge

Responsibilities:

- convert product goals into bounded GitHub issues;
- inspect current repository truth before planning;
- challenge weak architecture and false completion claims;
- define acceptance criteria and risk level;
- review high-risk PR evidence;
- decide whether findings require repair, redesign, or founder escalation.

ChatGPT is not the routine branch implementer.

### Codex — primary implementation agent

Responsibilities:

- work from one governed GitHub issue;
- create one branch for one objective;
- inspect `AGENTS.md`, `README.md`, and relevant truth documents;
- implement production code and tests;
- diagnose and repair its own CI failures;
- open or update the PR;
- respond to independent review findings;
- stop only for a genuine product decision, missing external access, unsafe operation, or contradictory authority.

Codex may not merge or deploy.

### Grok — security and product red team

Use for:

- authentication;
- tenant isolation;
- regulatory-source and interpretation boundaries;
- billing;
- ERP credentials and sync;
- architecture and data integrity;
- major release reviews.

Grok reviews the exact PR diff and acceptance criteria. It does not silently edit the implementation branch.

### GLM 5.2 — test and failure-path reviewer

Use for:

- missing negative tests;
- API producer/consumer contract mismatches;
- schema and migration edge cases;
- retry and idempotency gaps;
- documentation overclaims;
- broad repetitive test generation proposals.

GLM reviews the PR; it does not become a second competing implementer unless a new issue explicitly assigns it implementation authority.

### GitHub Actions — deterministic evidence gate

CI decides whether machine-verifiable requirements passed. Agent summaries cannot override CI.

## Unit of work

Every implementation uses:

```text
one issue
→ one branch
→ one objective
→ one pull request
→ required CI
→ required review
→ merge decision
```

Do not combine unrelated features, cleanup, refactors, migrations, and integrations in one task.

## Risk-based review

### GREEN

Examples:

- documentation truth correction;
- isolated test addition;
- accessibility text or styling correction;
- internal refactor with no behavior or schema change.

Required:

- CI passes;
- fresh-context review;
- no unresolved review conversations.

### YELLOW

Examples:

- ordinary product feature;
- API behavior change;
- query/UI wiring;
- non-destructive schema addition;
- CI or development-tooling change.

Required:

- CI passes;
- one independent technical review;
- all blocking findings repaired;
- no unresolved review conversations.

### RED

Examples:

- authentication or authorization;
- tenant isolation;
- destructive or data-transforming migration;
- regulatory write paths;
- Stripe/payment logic;
- ERP credentials or synchronization;
- LLM regulatory conclusions;
- Temporal production execution;
- secrets, deployment, backup, or recovery.

Required:

- CI passes;
- Grok red-team review;
- GLM failure-path review;
- ChatGPT final architecture/evidence review;
- explicit Shan approval.

### BLACK

Unsafe, unlawful, secret-exposing, uncontrolled production, or intentionally deceptive work must not execute.

## Agent completion contract

An implementation agent must continue through ordinary failures. It may not return after the first error with only a diagnosis.

Expected loop:

```text
inspect
→ implement
→ run focused checks
→ diagnose failures
→ repair
→ run complete required checks
→ open/update PR
→ address review
→ rerun checks
```

Escalation is allowed only when:

- product requirements conflict;
- a credential or external account is required;
- an action may mutate production or paid external systems;
- a migration or repair could destroy data;
- the governing issue is materially wrong;
- required evidence cannot be produced honestly.

## Pull-request acceptance

A PR is not ready merely because code exists.

It must include:

- governing issue;
- exact base and head identity;
- complete changed-file scope;
- production behavior explanation;
- exact test commands and results;
- failure-path coverage;
- external-effect declaration;
- final repository status;
- required independent reviews.

## Merge policy

- No direct pushes to `main`.
- No merge while required CI is pending or failing.
- No unresolved blocking review finding.
- New commits after review invalidate stale approval.
- Deployment requires a separate approved release task.
- Auto-merge may be enabled later only for tightly defined GREEN tasks after the workflow proves reliable.

## Daily founder briefing format

The normal report to Shan should contain only:

```text
Merged
In review
Blocked
Needs Shan
Next queued tasks
Current milestone confidence
```

Raw command logs remain attached to PRs and CI artifacts rather than being repeatedly relayed through chat.

## Current implementation constraint

The GitHub Actions factory adapter is repository-defined and pinned to an exact reviewed factory commit. GitHub repository rulesets and repository secrets remain account-level controls and must be verified separately before calling the delivery system complete.

The adapter requires `OPENAI_API_KEY` and `ZAI_API_KEY` as GitHub repository secrets. Secret values must never be committed, pasted into issues, or relayed through chat. The factory cannot merge or deploy, and a successful generated PR remains draft until the required human decision.

The model runner has no trusted database or Redis service. Its local commands therefore cover install, schema validation, typecheck, strict lint, unit/regression tests, production dependency audit, and build. Cascada CI remains authoritative for disposable PostgreSQL/Redis services, committed migrations, deterministic seed, and Playwright browser proof.
