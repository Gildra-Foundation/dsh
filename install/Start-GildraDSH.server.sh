#!/usr/bin/env bash
set -euo pipefail

KIT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIGURED_PORT=3080
if [[ -f "$KIT_ROOT/config/server.env" ]]; then
  saved_port="$(sed -n 's/^CONFIGURED_PORT=//p' "$KIT_ROOT/config/server.env" | tail -n 1)"
  if [[ "$saved_port" =~ ^[0-9]+$ ]]; then
    saved_port_number=$((10#$saved_port))
    if (( saved_port_number >= 1024 && saved_port_number <= 65535 )); then
      CONFIGURED_PORT="$saved_port_number"
    fi
  fi
fi
export DSH_PERMISSION_MODE="${GILDRA_DSH_PERMISSION_MODE:-danger-full-access}"
exec "$KIT_ROOT/bin/dsh-gildra" web --host 127.0.0.1 --port "${GILDRA_DSH_PORT:-$CONFIGURED_PORT}" --no-open
