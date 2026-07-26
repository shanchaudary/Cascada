## Governing issue

Closes #

## Objective

State the single outcome delivered by this pull request.

## Baseline

- Base branch:
- Base commit:
- Head branch:
- Head commit:
- Initial `git status --short`:
- Implementation surface: Codex app / Codex cloud / Codex CLI / human / other
- Codex authentication: ChatGPT subscription / not applicable

## Scope

### Files changed

-

### Explicitly not changed

-

## Implementation

Describe the production behavior changed. Do not substitute a file list for an explanation.

## Verification

| Check | Command | Result |
|---|---|---|
| Agent contract | `bash scripts/agent/verify.sh` | |
| Typecheck | `npm run typecheck` | |
| Lint | `npm run lint -- --max-warnings=0` | |
| Unit/regression | `npm test` | |
| Prisma | `npx prisma validate` | |
| Production advisory gate | `node scripts/security/audit-production.mjs` | |
| Build | `npm run build` | |
| Browser/E2E | `npm run test:e2e` or `Not applicable — explain` | |

Include exact counts, skips, failures, and errors. Attach logs or artifacts when output is too large.

## Failure paths and boundaries checked

- [ ] unauthenticated request
- [ ] wrong role
- [ ] wrong tenant / cross-tenant access
- [ ] invalid input
- [ ] missing dependency or environment value
- [ ] duplicate/retry/idempotency behavior
- [ ] rollback or atomicity
- [ ] no secret exposure
- [ ] documentation truth updated
- [ ] not applicable items are explained below

Explanation:

## External effects

- Live providers run: NO / YES — explain
- Production data mutation: NO / YES — explain
- Regulatory write-mode ingestion: NO / YES — explain
- Payment/email/ERP/Temporal live operation: NO / YES — explain
- Secrets touched: NO / YES — names only, never values
- OpenAI API used for software-development agent work: NO

## Review requirements

Risk: GREEN / YELLOW / RED / BLACK

Required independent reviewers:

- [ ] Codex automatic or fresh-context review
- [ ] Grok security/product red team
- [ ] GLM failure-path/test review
- [ ] ChatGPT architecture/final review
- [ ] Shan approval

## Final repository proof

```text
git status --short:

git diff --check:

```

## Merge and release

- [ ] All required checks passed
- [ ] All review conversations resolved
- [ ] No direct push to `main`
- [ ] Merge explicitly approved at the required risk level
- [ ] Deployment is not included unless separately approved