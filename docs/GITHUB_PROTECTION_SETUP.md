# GitHub Protected Main Setup

Repository files cannot create account-level branch rules by themselves. Apply and verify the following ruleset for branch `main` before M0 is accepted.

## Target

```text
Repository: shanchaudary/Cascada
Branch: main
```

## Required settings

- Require a pull request before merging.
- Require at least one approving review for YELLOW work.
- Require CODEOWNERS approval for RED work through the operating process.
- Dismiss stale approvals when new commits are pushed.
- Require approval of the most recent reviewable push.
- Require all review conversations to be resolved.
- Require status checks to pass before merging.
- Required check: `Verify application` from workflow `Cascada CI`.
- After the first factory-managed PR creates it, also require `ai-factory/supervision`. Do not accept M0 until both checks are enforced.
- Require the branch to be up to date before merging, unless a merge queue is enabled.
- Block force pushes.
- Block branch deletion.
- Do not allow direct pushes to `main`.
- Do not allow routine administrator bypass.
- Do not enable unrestricted automatic merge.

## Recommended later settings

After the workflow is stable:

- enable a merge queue;
- permit auto-merge only for explicitly classified GREEN work;
- require signed commits if the repository's operating environment supports them consistently;
- add a deployment environment with separate approval for production.

## Verification

Prove the ruleset with a disposable trial branch:

1. Attempt a direct push to `main`; it must be rejected.
2. Open a trial PR with a failing check; merge must be blocked.
3. Repair the check; merge must remain blocked until review requirements are satisfied.
4. Push a new commit after approval; stale approval must be dismissed.
5. Resolve all review conversations and obtain the required approval.
6. Merge through the PR path only.

The factory supervision check cannot be selected in a ruleset until GitHub has observed it at least once. Enable the deterministic CI check first, run the governed bootstrap task, then add `ai-factory/supervision` before accepting M0. This sequencing does not authorize bypassing either check on later factory-managed PRs.

Record screenshots or API output in the M0 pull request or trial issue. Do not mark M0 complete from configuration screenshots alone; the rejection and merge behavior must be exercised.
