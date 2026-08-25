#!/usr/bin/env bash
set -euo pipefail

KIT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec "$KIT_ROOT/bin/dsh-gildra" web --host 127.0.0.1 --port "${GILDRA_DSH_PORT:-3080}" --no-open
