#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"

node --check "$ROOT/plugins/gildra-dsh-ui-compact/lib/index.js"
node --check "$ROOT/plugins/gildra-dsh-ui-compact/lib/client.js"
zsh -n "$ROOT/install/macos-install.command"
zsh -n "$ROOT/install/dsh-gildra"
zsh -n "$ROOT/install/Start-GildraDSH.command"
zsh -n "$ROOT/Install Gildra DSH.command"

ruby -ryaml -e 'ARGV.each { |path| YAML.parse_file(path) }' \
  "$ROOT/config/settings.yaml" \
  "$ROOT/config/profile/cordis.patch.yml" \
  "$ROOT/config/profile/pnpm-workspace.yaml" \
  "$ROOT/config/agent-presets/engineering/preset.yml" \
  "$ROOT/config/agent-presets/engineering/agent.cordis.yml"

"$ROOT/desktop/macos/build.sh" >/dev/null
codesign --verify --deep --strict "$ROOT/desktop/macos/build/Gildra DSH.app"
plutil -lint "$ROOT/desktop/macos/build/Gildra DSH.app/Contents/Info.plist"

echo "Gildra DSH kit verification passed."
