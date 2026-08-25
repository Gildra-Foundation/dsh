#!/bin/zsh
set -euo pipefail

KIT_ROOT="${0:A:h:h}"
exec "$KIT_ROOT/runtime/node/bin/node" "$KIT_ROOT/bin/gildra-update.mjs" \
  --apply \
  --install-root "$KIT_ROOT"
