#!/bin/sh
# Preview contract: public site + CRM on 0.0.0.0:8080, PHP API on 127.0.0.1:8787.
set -e
cd /workspace

if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/; then
  exit 0
fi

export XDEBUG_MODE=off
export CODEX_API_ORIGIN="${CODEX_API_ORIGIN:-http://127.0.0.1:8787}"

if ! curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8787/api/healthz; then
  /opt/php/bin/php -d display_errors=0 -S 127.0.0.1:8787 -t /workspace/public /workspace/public/dev-router.php >/tmp/codex-php.log 2>&1 &
fi

npm run dev >/tmp/codex-vite.log 2>&1 &
