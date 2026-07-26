# Codex Pro Delivery Controls

These controls use Codex authenticated through Shan's ChatGPT Pro account. They do not use an OpenAI API key for software-development work.

## Supported control plane

GitHub remains the source of truth for issues, branches, pull requests, CI, review findings, and merge decisions.

The primary Pro-backed Codex controls are:

- Codex app, CLI, IDE, or a delegated cloud task for initial implementation;
- automatic Codex review for connected GitHub repositories;
- `@codex review` in a pull-request comment for an explicit fresh review;
- `@codex fix the CI failures` for a bounded CI repair task;
- `@codex fix the P1 issue` or an equally specific finding reference for a bounded review repair;
- another non-review `@codex` PR comment to start a cloud task with that PR's context.

Do not invoke `openai/codex-action`, pass `OPENAI_API_KEY` to a development workflow, or silently fall back to OpenAI API billing.

## Initial implementation contract

For an authorized GitHub issue, start a Codex app, CLI, IDE, or cloud task with this contract:

```text
MODE: IMPLEMENTATION

Repository: shanchaudary/Cascada
Governing issue: #<number>

Read AGENTS.md in full, then read the governing issue, README.md, and every relevant truth or architecture document.

Before editing, report:
- exact main SHA;
- branch or worktree name;
- git status --short;
- the required task contract;
- any contradiction or unsafe requirement.

Use one branch named codex/issue-<number>-<short-slug>.
Do not edit main directly.
Implement only the governing issue.
Do not flatten architecture, remove required capability, add fake behavior, add blanket suppressions, or use TODO/stub success paths.
Do not touch production credentials or perform production writes.

Run focused checks during implementation, then run:

bash scripts/agent/verify.sh

Inspect the complete diff for scope creep, secrets, generated artifacts, binaries, governance changes, and failure-path gaps.

Commit and push the bounded implementation. Open or update a draft pull request linked to the issue. Include exact base/head SHA, files changed, behavior, commands, test counts, failures/skips, external effects, limitations, and final repository status.

Do not merge, approve, enable auto-merge, deploy, close the issue, or perform production writes.
Continue through ordinary code, lint, type, test, build, and CI failures. Stop only for contradictory authority, a genuine product decision, missing external access, unsafe data operation, a Codex usage limit, or inability to produce truthful evidence.
```

## Pull-request review

After the implementation PR is open and CI has produced evidence:

1. Ensure automatic Codex review is enabled for Cascada, or comment:

```text
@codex review
```

2. Codex review must inspect the exact current head. New commits invalidate stale review.
3. GLM independently reviews the exact diff for failure paths and test gaps.
4. RED work also receives Grok and ChatGPT review before Shan's decision.

A Codex review is not merge authority.

## CI repair

For a failing Cascada CI run, post this comment on the draft PR:

```text
@codex fix the CI failures. Read AGENTS.md and the governing issue first. Inspect the complete failed-job logs and exact current PR head. Repair only valid in-scope defects, add focused regression tests, run bash scripts/agent/verify.sh, push to this branch, update the PR evidence, and stop before merge or deployment.
```

Do not post this command until the failure is understood well enough to confirm it belongs to the governing issue.

## Review-finding repair

For verified blocking findings, post one bounded command that identifies the findings explicitly:

```text
@codex fix all valid blocking findings in the latest review on this PR. Read AGENTS.md, the governing issue, the exact current diff, and every unresolved review thread. Reject stale, duplicate, invalid, or outside-scope findings with evidence. Repair valid in-scope blockers, add regression tests, run bash scripts/agent/verify.sh, push to this branch, update the PR evidence, and stop before merge or deployment.
```

A narrower command such as `@codex fix the P1 issue` is preferred when one finding is being addressed.

## Optional scheduled queue automation

Codex app automations may periodically inspect the connected Cascada repository and select at most one authorized issue. This is optional and must be behaviorally tested before it is called unattended automation.

Eligible issues must:

- be open;
- have `ai:build`;
- have exactly one non-BLACK risk label;
- not have `ai:building`, `ai:managed`, `ai:ready-for-shan`, or `ai:needs-shan`;
- be assigned to Shan or contain explicit written authorization from Shan;
- contain a material objective, acceptance criteria, non-goals, failure paths, and evidence requirements.

The scheduled task must apply the initial implementation contract above, select at most one issue per run, and do nothing when the queue is empty. A local app automation requires the computer and Codex app to be available; a delegated cloud task may continue in the background.

## Human merge gate

When CI is green and all required reviews are clear:

- post an evidence summary;
- mark the issue `ai:ready-for-shan`;
- stop.

Codex, GLM, Grok, ChatGPT, and GitHub automation may not merge or deploy.

## First live task

Issue #12 remains the bootstrap task. Do not apply `ai:build` until:

- PR #35 is merged after explicit approval;
- Codex is signed in through ChatGPT Pro rather than an API key;
- Cascada is connected to Codex;
- `bash scripts/agent/setup.sh` succeeds;
- Codex can create and push a disposable draft-PR branch;
- automatic Codex PR review or `@codex review` is verified;
- the API-backed development workflows are absent from `main`;
- the GLM independent-review path is available.

The first implementation must remain draft and stop before merge.