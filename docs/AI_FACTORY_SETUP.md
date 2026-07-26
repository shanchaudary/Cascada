# Codex Pro Delivery Setup for Cascada

This document defines Cascada's delivery setup using Codex authenticated through Shan's ChatGPT Pro account. It replaces the former OpenAI API-key-backed GitHub Actions implementation and repair path.

## Authority

- GitHub issues define approved work.
- `AGENTS.md` is the standing repository law.
- GitHub pull requests hold implementation evidence and review findings.
- `Cascada CI` is the authoritative machine-verifiable gate.
- Codex is the primary implementation and repair agent.
- GLM remains an independent failure-path reviewer.
- Shan retains merge, release, production-write, credential, and roadmap authority.

Codex may create a bounded branch, commits, and a draft pull request. Codex may not merge, deploy, use production credentials, or perform production writes.

## Authentication boundary

Codex engineering work must be authenticated by signing in to Codex with Shan's ChatGPT account through one of these supported surfaces:

- Codex app;
- Codex web/cloud;
- Codex CLI;
- Codex IDE extension.

Do not configure `OPENAI_API_KEY` as a GitHub repository secret for Codex implementation or repair. The former GitHub-hosted Codex Action used API billing and is removed from Cascada.

This delivery rule does not remove or alter any OpenAI credential that Cascada's product runtime may eventually require. Product-provider credentials and software-development-agent authentication are separate authorities.

## Current Pro-plan limitation

A ChatGPT Pro subscription supports Codex app, web/cloud, CLI, IDE, and GitHub code review. It does not currently provide the programmatic access token needed to launch a personal Codex task directly from a GitHub Actions event.

Therefore:

- an `ai:build` label is a queue authorization, not a direct model invocation;
- Codex app automation may poll the queue on a schedule;
- a Codex cloud task may also be delegated from the Codex interface;
- the repository must not pretend that a GitHub label alone starts Pro-backed Codex;
- no API-billed fallback is permitted.

## One-time Codex setup

1. Open the Codex app or Codex web and sign in with the ChatGPT account that has the Pro subscription.
2. If the Codex CLI previously used an API key, update it, run `codex logout`, then sign in with ChatGPT.
3. Connect GitHub and grant Codex access to `shanchaudary/Cascada`.
4. Create or select a Cascada environment/project.
5. Use this repository setup command:

```bash
bash scripts/agent/setup.sh
```

6. Confirm Codex can read `AGENTS.md`, create an isolated branch or worktree, run repository commands, and push a draft pull request.
7. Enable Codex automatic pull-request review for Cascada in Codex GitHub settings.
8. Create the implementation and repair automations from `docs/CODEX_PRO_AUTOMATION.md`.

Do not provide production database credentials, payment credentials, ERP credentials, email credentials, deployment credentials, or unrestricted cloud credentials to the Codex development environment.

## Task authorization

Use the existing task template and labels:

- `ai:build`;
- exactly one of `ai:risk:green`, `ai:risk:yellow`, `ai:risk:red`, or `ai:risk:black`;
- state labels such as `ai:building`, `ai:managed`, `ai:ready-for-shan`, and `ai:needs-shan`.

Authorization sequence:

1. Create a complete issue with objective, acceptance criteria, failure paths, non-goals, allowed effects, and evidence requirements.
2. Apply exactly one non-BLACK risk label.
3. Confirm the issue is assigned to or explicitly authorized by Shan.
4. Apply `ai:build` last.
5. Codex selects only an authorized issue that is not already building, blocked, or completed.

BLACK-risk work must not execute. RED-risk work requires the full review set and explicit Shan approval before merge.

## Verification split

Codex must run the repository-local verification contract:

```bash
bash scripts/agent/verify.sh
```

That contract covers locked installation assumptions, typecheck, strict lint, unit/regression tests, Prisma validation, the production advisory gate, and production build.

`Cascada CI` remains authoritative for:

- disposable PostgreSQL and Redis services;
- committed migrations;
- deterministic seed execution;
- typecheck and lint policy;
- unit/regression tests;
- production advisory verification;
- production build;
- Playwright authentication, dashboard, and tenant smoke.

Codex must diagnose ordinary failures and continue repairing within the governing issue. It may stop only for a genuine product decision, contradictory authority, missing external access, unsafe data operation, or a limit that prevents truthful completion.

## Review and repair

Every implementation requires a second-pass review.

- Codex automatic GitHub review may provide the first fresh-context review.
- GLM remains required for YELLOW/RED failure-path review once the review-only integration is enabled.
- Grok and ChatGPT remain required for the RED-risk areas defined in `docs/DELIVERY_OPERATING_MODEL.md`.
- Blocking findings must be repaired on the same task branch or truthfully escalated.
- New commits invalidate stale reviews.

Until the GLM review-only path is installed without an OpenAI API dependency, M0 remains incomplete and no material Cascada milestone may be called factory-proven.

## Protected main

Protect `main` and require:

- pull requests;
- `Verify application` from `Cascada CI`;
- the applicable independent-review requirements;
- dismissal of stale approvals;
- approval of the latest reviewable push;
- resolution of review conversations;
- rejection of direct pushes, force pushes, branch deletion, and routine administrator bypass.

Do not require the retired `ai-factory/supervision` status check after the API-backed workflow is removed.

## Acceptance sequence

1. Merge the repository-side removal of the API-backed Codex workflows.
2. Connect Cascada to Codex using ChatGPT sign-in.
3. Verify a read-only Codex task against the repository.
4. Install the scheduled implementation/repair automations.
5. Verify automatic Codex PR review.
6. Install or verify a GLM review-only path that does not require an OpenAI API key.
7. Complete issue #12 through Codex implementation, CI, independent review, repair, and a human merge decision.
8. Complete a material non-documentation Cascada pilot before M0 is accepted.

No delivery-system milestone is proof that Cascada itself is production-ready.