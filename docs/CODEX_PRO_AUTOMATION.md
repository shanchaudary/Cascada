# Codex Pro Automation Contracts

These contracts are designed for Codex app automations authenticated with Shan's ChatGPT Pro account. They do not use an OpenAI API key.

Codex app automations are scheduled tasks. They are not GitHub webhooks. Local automations require the computer to be awake and Codex to be running. Cloud tasks may continue in the Codex cloud after delegation.

## Automation 1 — Cascada implementation queue

Suggested cadence: hourly while development is active.

Paste this instruction into a Codex automation attached to the Cascada project:

```text
MODE: IMPLEMENTATION QUEUE

Repository: shanchaudary/Cascada

At each run, inspect the connected GitHub repository and select at most one task.

ELIGIBILITY

Select the oldest open issue that:
- has label ai:build;
- has exactly one ai:risk:green, ai:risk:yellow, or ai:risk:red label;
- does not have ai:risk:black;
- does not have ai:building, ai:managed, ai:ready-for-shan, or ai:needs-shan;
- is assigned to Shan or contains explicit written authorization from Shan;
- contains a material objective, acceptance criteria, non-goals, failure paths, and evidence requirements.

If no eligible issue exists, do nothing and return a short queue-empty report.

BEFORE EDITING

1. Read AGENTS.md in full.
2. Read the selected issue in full.
3. Read README.md and every truth/governance file relevant to the issue.
4. Verify the current main SHA and repository status.
5. Write the required task contract before changing files.
6. Add ai:building to the issue and comment with the planned branch name and verified base SHA.

IMPLEMENTATION

- Use one isolated worktree or branch named codex/issue-<number>-<short-slug>.
- Do not edit main directly.
- Implement only the governing issue.
- Do not flatten architecture, remove required capabilities, add fake behavior, add broad suppressions, or use TODO/stub success paths.
- Do not touch production credentials or perform production writes.
- Run focused checks during implementation.
- Run bash scripts/agent/verify.sh before publication.
- Inspect the complete diff for scope creep, secrets, generated artifacts, binary files, and accidental governance changes.

PUBLICATION

- Commit the bounded implementation.
- Push the task branch.
- Open a draft pull request linked to the issue.
- Include exact base/head SHA, files changed, behavior, commands, test counts, failures/skips, external effects, known limitations, and final repository status.
- Add ai:managed to the issue.
- Do not merge, approve, enable auto-merge, deploy, or close the issue.

FAILURE

Continue through ordinary code, lint, test, type, build, and CI failures.
Stop and add ai:needs-shan only for:
- contradictory product authority;
- a missing credential or external account that Shan must provide;
- a potentially destructive or production operation;
- an invalid governing issue;
- a ChatGPT/Codex usage limit;
- an inability to produce truthful evidence.

When blocked, report the exact error and the smallest required human decision. Never infer success.
```

## Automation 2 — Cascada PR repair queue

Suggested cadence: hourly, offset from the implementation automation.

```text
MODE: PR REPAIR QUEUE

Repository: shanchaudary/Cascada

At each run, inspect open draft pull requests whose branch begins with codex/issue-.
Select at most one PR that has one of these conditions:
- Cascada CI is failing;
- Codex automatic review has unresolved blocking findings;
- GLM, Grok, ChatGPT, or a human reviewer has unresolved blocking findings;
- the governing issue explicitly requests a bounded follow-up on the same branch.

BEFORE EDITING

1. Read AGENTS.md.
2. Read the governing issue, PR body, complete diff, review threads, and full failed CI logs.
3. Verify the exact current PR head and ensure no newer commit invalidates the evidence.
4. Classify each finding as valid, invalid, duplicate, stale, or outside scope.

REPAIR

- Repair only valid in-scope blockers.
- Do not silently expand the issue.
- Add focused regression tests for each behavioral defect.
- Run bash scripts/agent/verify.sh.
- Push to the existing task branch.
- Update the PR evidence with exact commands and results.
- Resolve conversations only after the correction is present and verified.

READY STATE

When CI is green and all required reviews are clear:
- add ai:ready-for-shan to the governing issue;
- remove ai:building and ai:needs-shan if present;
- post a concise final evidence summary;
- stop at the human merge gate.

Do not merge, approve, enable auto-merge, deploy, or perform production writes.
```

## First live task

Issue #12 remains the bootstrap task. Do not apply `ai:build` until all of the following are verified:

- Codex is signed in through ChatGPT Pro rather than an API key;
- Cascada is connected in Codex;
- the setup command succeeds;
- Codex can create and push a disposable task branch;
- automatic Codex PR review is enabled;
- the API-backed GitHub implementation and repair workflows are absent from `main`;
- the independent-review plan is recorded.

The first task must remain draft and stop before merge.