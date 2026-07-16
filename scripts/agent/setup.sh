#!/usr/bin/env bash
set -euo pipefail

printf 'Cascada agent setup\n'
printf 'Node: '; node --version
printf 'npm: '; npm --version

npm ci
npx prisma generate

printf 'Agent setup complete. No external services or production credentials were used.\n'
