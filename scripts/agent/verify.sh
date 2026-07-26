#!/usr/bin/env bash
set -euo pipefail

export DATABASE_URL="${DATABASE_URL:-postgresql://cascada:cascada_ci_password@127.0.0.1:5432/cascada}"
export DATABASE_URL_DIRECT="${DATABASE_URL_DIRECT:-$DATABASE_URL}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379}"
export NEXTAUTH_SECRET="${NEXTAUTH_SECRET:-cascada-agent-verification-secret}"
export NEXTAUTH_URL="${NEXTAUTH_URL:-http://127.0.0.1:3000}"
export NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL:-http://127.0.0.1:3000}"
export APP_URL="${APP_URL:-http://127.0.0.1:3000}"
export ENCRYPTION_KEY="${ENCRYPTION_KEY:-cascada-agent-encryption-key-32}"
export LOG_LEVEL="${LOG_LEVEL:-warn}"

node --test tests/security/codex-subscription-boundary.test.mjs
node scripts/security/verify-codex-subscription-boundary.mjs
npm run typecheck
npm run lint -- --max-warnings=0
npm test
node --test tests/security/production-advisory-gate.test.mjs
npx prisma validate
node scripts/security/audit-production.mjs
npm run build

printf 'Bounded Codex verification passed. Service-backed integration and browser proof remain CI responsibilities.\n'
