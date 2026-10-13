#!/bin/sh
set -e
cd /workspace

if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:3000/; then
  exit 0
fi

npm run dev >/tmp/codex-server.log 2>&1 &
