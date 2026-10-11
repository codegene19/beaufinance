#!/usr/bin/env bash
# Creates a local-only environment for testing in a Codespace (embedded database, local accounts).
set -euo pipefail
if [ ! -f .env.local ]; then
  cat > .env.local <<ENV
AUTH_PROVIDER=local
AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENV
  echo "Created .env.local for this Codespace (embedded database, local accounts)."
fi
