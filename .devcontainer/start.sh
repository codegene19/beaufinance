#!/usr/bin/env bash
# Starts the app in the background whenever the Codespace starts. Logs: /tmp/beaufinance.log
cd "$(dirname "$0")/.."
if ! curl -s -o /dev/null http://localhost:3000; then
  nohup npm run dev -- -p 3000 > /tmp/beaufinance.log 2>&1 &
  echo "BeauFinance is starting on port 3000 (logs: /tmp/beaufinance.log)"
fi
