#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"

source "$ROOT/config/versions.env"

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

rg -F 'github:kuaiyukuaikuai/dsh-agent-sync#$AGENT_SYNC_COMMIT' \
  "$ROOT/install/macos-install.command" >/dev/null
rg -F 'github:kuaiyukuaikuai/dsh-agent-sync#$($Versions.AGENT_SYNC_COMMIT)' \
  "$ROOT/install/windows-install.ps1" >/dev/null
rg -F '@openma/dsh-agents-plugins-bridge@$AGENT_PLUGINS_BRIDGE_VERSION' \
  "$ROOT/install/macos-install.command" >/dev/null
rg -F '@openma/dsh-agents-plugins-bridge@$($Versions.AGENT_PLUGINS_BRIDGE_VERSION)' \
  "$ROOT/install/windows-install.ps1" >/dev/null

"$ROOT/desktop/macos/build.sh" >/dev/null
codesign --verify --deep --strict "$ROOT/desktop/macos/build/Gildra DSH.app"
plutil -lint "$ROOT/desktop/macos/build/Gildra DSH.app/Contents/Info.plist"

echo "Gildra DSH kit verification passed."
