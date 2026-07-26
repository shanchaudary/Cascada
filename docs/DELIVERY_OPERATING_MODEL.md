# Cascada Delivery Operating Model

## Objective

Finish Cascada through a repeatable issue → branch → pull request → CI → independent review → repair → merge-decision process while minimizing founder intervention without reducing product quality.

GitHub is the system of record. Chat summaries are not project authority.

## Fixed roles

### Shan — founder and product authority

Required for:

- roadmap and product-priority decisions;
- external accounts, paid services, and credentials;
- destructive or production data operations;
- RED-risk merge approval;
- releases and deployments.

Shan should not be required for routine coding diagnosis, test repair, lint repair, or ordinary PR iteration.

### ChatGPT — chief architect and final technical judge

Responsibilities:

- convert product goals into bounded GitHub issues;
- inspect repository truth before planning;
- challenge weak architecture and false completion claims;
- define acceptance criteria and risk;
- review high-risk evidence;
- decide whether findings require repair, redesign, or founder escalation.

ChatGPT is not the routine branch implementer.

### Codex — primary implementation and repair agent

Codex must be authenticated through Shan's ChatGPT Pro account in the Codex app, cloud tasks, CLI, or IDE. Cascada development must not use an OpenAI API key as a hidden substitute for the Pro entitlement.

Responsibilities:

- work from one governed GitHub issue;
- create one isolated branch or worktree for one objective;
- read `AGENTS.md`, `README.md`, and relevant truth documents;
- implement production code and tests;
- diagnose and repair ordinary failures;
- open or update a draft PR;
- respond to independent findings;
- stop only for a genuine product decision, missing external access, unsafe operation, contradictory authority, or a real usage limit.

Codex may not merge, deploy, use production credentials, or perform production writes.

### GLM 5.2 — independent failure-path reviewer

Use for:

- missing negative tests;
- producer/consumer contract mismatches;
- schema and migration edge cases;
- retry and idempotency gaps;
- documentation overclaims;
- repetitive test-gap analysis.

GLM reviews the exact PR diff. It does not become a second competing implementer unless a separate issue grants implementation authority.

The GLM review path must not depend on an OpenAI API key. Until a review-only integration is verified, GLM review is a required manual/account-level gate and M0 remains incomplete.

### Grok — security and product red team

Use for authentication, tenant isolation, regulatory boundaries, billing, ERP credentials and sync, architecture, data integrity, and major releases. Grok reviews the exact diff and does not silently edit the implementation branch.

### GitHub Actions — deterministic evidence gate

`Cascada CI` decides whether machine-verifiable requirements passed. Agent summaries cannot override CI. GitHub Actions must not invoke Codex through an OpenAI API key.

## Unit of work

```text
one issue
→ one branch
→ one objective
→ one draft pull request
→ required CI
→ required independent review
→ bounded repair
→ human merge decision
```

Do not combine unrelated features, cleanup, refactors, migrations, and integrations in one task.

## Queue and automation

The `ai:build` label authorizes an issue for Codex work. It does not itself invoke a model.

Initial implementation starts from the Codex app, CLI, IDE, or a delegated cloud task. Once a draft PR exists, the official connected-GitHub controls are primary:

- automatic Codex review or `@codex review`;
- `@codex fix the CI failures` for an in-scope failed-CI repair;
- a specific `@codex` finding-repair instruction for valid blocking review findings.

An optional scheduled Codex app automation may poll the authorized issue queue only after that behavior is tested. A personal Pro plan does not provide a verified token for Cascada GitHub Actions to launch Codex directly, so the repository must not claim label-triggered Pro execution. No API-billed fallback is permitted.

## Risk-based review

### GREEN

Examples: documentation truth correction, isolated test addition, accessibility correction, internal refactor with no behavior or schema change.

Required:

- CI passes;
- fresh-context review;
- no unresolved blocking conversation.

### YELLOW

Examples: ordinary feature, API behavior, query/UI wiring, non-destructive schema addition, CI or development tooling.

Required:

- CI passes;
- one independent technical review;
- all blocking findings repaired;
- no unresolved blocking conversation.

### RED

Examples: authentication, authorization, tenant isolation, destructive migration, regulatory write paths, payment logic, ERP credentials or sync, LLM regulatory conclusions, Temporal production execution, secrets, deployment, backup, or recovery.

Required:

- CI passes;
- Grok red-team review;
- GLM failure-path review;
- ChatGPT final architecture/evidence review;
- explicit Shan approval.

### BLACK

Unsafe, unlawful, secret-exposing, uncontrolled production, or intentionally deceptive work must not execute.

## Agent completion contract

Expected loop:

```text
inspect
→ implement
→ run focused checks
→ diagnose failures
→ repair
→ run complete required checks
→ open/update draft PR
→ address review
→ rerun checks
→ stop at human merge gate
```

Escalation is allowed only when:

- product requirements conflict;
- an external account or credential is required;
- an action may mutate production or paid external systems;
- a migration or repair could destroy data;
- the governing issue is materially wrong;
- a Codex usage limit blocks execution;
- required evidence cannot be produced honestly.

## Pull-request acceptance

A PR must include:

- governing issue;
- exact base and head identity;
- complete changed-file scope;
- production behavior explanation;
- exact commands and results;
- test counts, failures, and skips;
- failure-path coverage;
- external-effect declaration;
- final repository status;
- required independent reviews.

## Merge policy

- No direct pushes to `main`.
- No merge while required CI is pending or failing.
- No unresolved blocking finding.
- New commits invalidate stale review.
- Deployment requires a separate approved release task.
- Codex, GLM, Grok, ChatGPT, and GitHub automation may not merge or deploy.

## Daily founder briefing

```text
Merged
In review
Blocked
Needs Shan
Next queued tasks
Current milestone confidence
```

Raw evidence remains in GitHub rather than being repeatedly relayed through chat.

## Current implementation state

- GitHub CI and protected-PR delivery are repository-defined and exercised.
- The former API-key-backed `ai-implement.yml`, `ai-supervise.yml`, and `.ai-factory/project.json` are absent from PR #35's candidate head. They remain on `main` until that PR is explicitly approved and merged.
- Pro-backed Codex GitHub review is behaviorally proven on PR #35 and has produced exact-head security findings.
- A write-capable Codex cloud environment for implementation and repair is not yet configured or accepted.
- Optional scheduled issue-queue automation is unaccepted until behaviorally proven.
- GLM review-only automation without an OpenAI dependency remains to be verified.
- Issue #12 remains the first bounded implementation proof.

This operating model is not evidence that Cascada is production-ready.