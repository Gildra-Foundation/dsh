#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
INSTALL_ROOT="${GILDRA_DSH_INSTALL_ROOT:-$HOME/.gildra-dsh}"
if [[ -x "$INSTALL_ROOT/bin/Update-GildraDSH.command" ]]; then
  exec "$INSTALL_ROOT/bin/Update-GildraDSH.command"
fi

echo "Подключаем безопасные обновления к существующей установке Gildra DSH…"
/usr/bin/osascript -e 'tell application id "net.gildra.dsh" to quit' >/dev/null 2>&1 || true
exec "$SCRIPT_DIR/install/macos-install.command"
