# AI Software Factory Setup for Cascada

This document defines Cascada's repository-side installation of the project-agnostic GitHub Actions factory.

## Authority and pin

- GitHub issues define work.
- `AGENTS.md` is the standing repository law.
- `.ai-factory/project.json` defines Cascada's real setup, verification, context, limits, models, and allowed actors.
- Both thin caller workflows must reference the same full 40-character factory commit.
- The current reviewed candidate pin is `98033aa4780fac52a58b6aab7a692489e1e25e96`.
- The pin is not an accepted release until the central factory PR is reviewed and explicitly approved for merge.

Codex may create a bounded branch, commits, and a draft pull request for an authorized issue. The factory may not merge, deploy, access production credentials, or perform production writes.

## Repository files

The installation consists of:

- `.ai-factory/project.json`;
- `.github/workflows/ai-implement.yml`;
- `.github/workflows/ai-supervise.yml`;
- `.github/ISSUE_TEMPLATE/ai-task.yml`;
- optional `factory_pr` and `factory_issue` inputs on `Cascada CI`'s `workflow_dispatch` trigger.

Generated changes to factory configuration, GitHub workflows, `AGENTS.md`, credentials, secrets, symlinks, submodules, and binaries are rejected by the central engine.

## Repository secrets

Add these values through GitHub repository settings only:

- `OPENAI_API_KEY` for Codex implementation and repair;
- `ZAI_API_KEY` for GLM 5.2 independent review.

Never put the values in source, `.env` files, issue text, workflow inputs, logs, comments, screenshots, or chat. Configure provider-side spend caps and alerts before the first live task.

## Authorization

Create the authorization labels in repository settings before the first task:

- `ai:build`;
- `ai:risk:green`, `ai:risk:yellow`, `ai:risk:red`, and `ai:risk:black`.

The factory creates its own `ai:building`, `ai:managed`, `ai:repairing`, `ai:ready-for-shan`, `ai:needs-shan`, and numbered `ai:repair:<n>` state labels when it starts. Missing authorization labels are an installation blocker, not permission to bypass the state machine.

1. Create a complete issue from the AI factory engineering task template.
2. Apply exactly one `ai:risk:green`, `ai:risk:yellow`, or `ai:risk:red` label.
3. Confirm the issue contains objective acceptance criteria, failure paths, non-goals, and evidence.
4. An allowed actor applies `ai:build` last. That label event is the execution authorization.

BLACK-risk tasks are rejected. RED work may be implemented and reviewed but requires explicit founder approval before merge.

## Verification split

The isolated model runner performs the real repository-local gates that do not need services:

```bash
npm ci
npx prisma generate
npx prisma validate
npm run typecheck
npm run lint -- --max-warnings=0
npm test
npm audit --omit=dev --audit-level=high
npm run build
```

The authoritative `Cascada CI` workflow additionally provisions disposable PostgreSQL and Redis services, applies committed migrations, seeds deterministic data, and runs the Playwright critical-flow smoke.

The current 133-warning baseline means a live generated task cannot pass strict factory verification until the bounded lint-debt task reaches zero. The temporary CI ceiling only prevents regression; it is not acceptance.

## Protected main

Before accepting M0, protect `main` and require:

- pull requests and required review;
- `Verify application` from `Cascada CI`;
- `ai-factory/supervision`;
- dismissal of stale approvals and resolution of review conversations;
- rejection of direct pushes, force pushes, branch deletion, and routine administrator bypass.

## Acceptance sequence

1. Merge the central factory release only after explicit approval.
2. Merge this consumer installation only after explicit approval and green review evidence.
3. Add the two repository secrets without exposing their values.
4. Verify unauthorized and BLACK-risk issues are rejected.
5. Complete the bounded zero-warning bootstrap task.
6. Complete a material, non-documentation Cascada pilot through implementation, CI, GLM review, repair, and manual merge decision.

No step above is proof that Cascada itself is production-ready. Product readiness remains governed by `docs/CURRENT_PRODUCT_TRUTH.md` and milestones M1 through M8.
