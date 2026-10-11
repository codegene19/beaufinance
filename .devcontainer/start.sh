#!/usr/bin/env bash
# Starts the app in the background whenever the Codespace starts. Logs: /tmp/beaufinance.log
cd "$(dirname "$0")/.."
if [ ! -d node_modules ]; then npm ci; fi
[ -f .env.local ] || bash .devcontainer/setup-env.sh
if ! curl -s -o /dev/null http://localhost:3000; then
  # setsid detaches from the lifecycle command's session so the server is not killed when it exits
  setsid nohup npm run dev -- -p 3000 > /tmp/beaufinance.log 2>&1 < /dev/null &
  disown || true
  echo "BeauFinance is starting on port 3000 (logs: /tmp/beaufinance.log)"
fi
