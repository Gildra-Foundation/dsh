#!/bin/zsh
set -euo pipefail

MODE="${1:-run}"
ROOT="${0:A:h:h}"
APP_NAME="Gildra DSH"
PROCESS_NAME="DeepSeekHarnessApp"
APP_BUNDLE="$ROOT/desktop/macos/build/$APP_NAME.app"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/$PROCESS_NAME"

osascript -e 'tell application id "net.gildra.dsh" to quit' >/dev/null 2>&1 || true
for attempt in {1..20}; do
  pgrep -x "$PROCESS_NAME" >/dev/null 2>&1 || break
  sleep 0.1
done
pkill -x "$PROCESS_NAME" >/dev/null 2>&1 || true

"$ROOT/desktop/macos/build.sh" >/dev/null

case "$MODE" in
  run)
    open -n "$APP_BUNDLE"
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs|--telemetry|telemetry)
    open -n "$APP_BUNDLE"
    /usr/bin/log stream --info --style compact --predicate "process == \"$PROCESS_NAME\""
    ;;
  --verify|verify)
    open -n "$APP_BUNDLE"
    for attempt in {1..30}; do
      if pgrep -x "$PROCESS_NAME" >/dev/null; then
        echo "Gildra DSH desktop app is running."
        exit 0
      fi
      sleep 0.2
    done
    echo "Gildra DSH desktop app did not start." >&2
    exit 1
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
