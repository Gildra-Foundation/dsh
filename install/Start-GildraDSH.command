#!/bin/zsh
set -euo pipefail

KIT_ROOT="${0:A:h:h}"
exec "$KIT_ROOT/bin/dsh-gildra" web --host 127.0.0.1 --port 3080
