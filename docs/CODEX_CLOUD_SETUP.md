# Codex Cloud Setup for Cascada

This document defines the repository-side configuration for using Codex as Cascada's primary implementation agent.

## Authority

- GitHub issues define work.
- `AGENTS.md` is the standing operating law.
- `docs/CURRENT_PRODUCT_TRUTH.md` is the current product-state baseline.
- `docs/CASCADA_MILESTONE_BACKLOG.md` defines milestone order.
- Codex may create branches, commits, and pull requests for an assigned issue.
- Codex may not merge, deploy, use production credentials, or perform production writes.

## Repository connection

Connect the Codex workspace to:

```text
shanchaudary/Cascada
```

The default branch is `main`. Every task must use a separate branch derived from the current remote `main`.

## Environment setup command

Configure the Codex environment to run:

```bash
bash scripts/agent/setup.sh
```

This installs locked dependencies and generates the Prisma client. It does not start external services or use production credentials.

## Recommended task instruction

```text
Work only on GitHub issue #<number> in shanchaudary/Cascada.
Read AGENTS.md, README.md, docs/CURRENT_PRODUCT_TRUTH.md, and the issue before editing.
Verify branch, HEAD, remote alignment, and git status.
Use one task, one branch, one objective.
Implement production code and tests, diagnose failures, and continue until all issue-required checks pass or a genuine product/external-access blocker is proven.
Open or update a pull request. Do not merge or deploy. Do not use production secrets or production writes.
Return exact commands, test counts, failures, changed files, commit SHA, PR URL, and final git status.
```

## Verification command

For tasks that do not require service-backed integration tests:

```bash
bash scripts/agent/verify.sh
```

The pull-request CI remains authoritative and additionally provisions PostgreSQL and Redis, applies migrations, seeds data, builds the production app, and runs the critical browser smoke.

## Environment variables

Do not add real production values to Codex for ordinary implementation tasks.

Repository-only verification uses safe placeholders. External credentials are added only for a separately approved task that explicitly requires a sandbox service.

Never add ordinary task access to:

- production database credentials;
- Stripe live keys;
- production ERP credentials;
- production email credentials;
- production deployment tokens;
- unrestricted cloud credentials.

## Task selection

Codex does not self-select roadmap changes. ChatGPT or Shan creates and prioritizes the issue. Codex may challenge the issue when repository evidence contradicts it, but it must not silently broaden or replace the task.

## Review loop

1. Codex implements and opens the PR.
2. GitHub Actions runs deterministic checks.
3. A separate reviewer evaluates the exact diff.
4. Codex repairs blocking findings on the same branch.
5. Checks and reviews rerun.
6. Merge occurs only at the required risk level and with explicit authority.

## Setup status

Repository-side setup is complete when this document, the agent scripts, issue templates, PR template, and CI workflow are merged.

The Codex account/workspace connection and environment command must still be verified in the Codex user interface because repository files cannot grant account-level access by themselves.
