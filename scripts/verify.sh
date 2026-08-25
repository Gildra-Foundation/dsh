#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"

source "$ROOT/config/versions.env"

node --check "$ROOT/plugins/gildra-dsh-ui-compact/lib/index.js"
node --check "$ROOT/plugins/gildra-dsh-ui-compact/lib/client.js"
node "$ROOT/plugins/gildra-dsh-ui-compact/test.mjs"
node --check "$ROOT/plugins/gildra-skill-installer/lib/index.js"
node "$ROOT/plugins/gildra-skill-installer/test.mjs"
zsh -n "$ROOT/install/macos-install.command"
zsh -n "$ROOT/install/dsh-gildra"
zsh -n "$ROOT/install/Start-GildraDSH.command"
zsh -n "$ROOT/Install Gildra DSH.command"
zsh -n "$ROOT/script/build_and_run.sh"

ruby -ryaml -e 'ARGV.each { |path| YAML.parse_file(path) }' \
  "$ROOT/config/settings.yaml" \
  "$ROOT/config/profile/cordis.patch.yml" \
  "$ROOT/config/profile/pnpm-workspace.yaml" \
  "$ROOT/config/agent-presets/engineering/preset.yml" \
  "$ROOT/config/agent-presets/engineering/agent.cordis.yml"

grep -F 'github:kuaiyukuaikuai/dsh-agent-sync#$AGENT_SYNC_COMMIT' \
  "$ROOT/install/macos-install.command" >/dev/null
grep -F 'github:kuaiyukuaikuai/dsh-agent-sync#$($Versions.AGENT_SYNC_COMMIT)' \
  "$ROOT/install/windows-install.ps1" >/dev/null
grep -F '@openma/dsh-agents-plugins-bridge@$AGENT_PLUGINS_BRIDGE_VERSION' \
  "$ROOT/install/macos-install.command" >/dev/null
grep -F '@openma/dsh-agents-plugins-bridge@$($Versions.AGENT_PLUGINS_BRIDGE_VERSION)' \
  "$ROOT/install/windows-install.ps1" >/dev/null
grep -F 'github:GooDAnDReaDY/dsh-russian-lang#$RUSSIAN_LANG_COMMIT' \
  "$ROOT/install/macos-install.command" >/dev/null
grep -F 'github:GooDAnDReaDY/dsh-russian-lang#$($Versions.RUSSIAN_LANG_COMMIT)' \
  "$ROOT/install/windows-install.ps1" >/dev/null
grep -F "'settings.pluginBridge'" \
  "$ROOT/plugins/gildra-dsh-ui-compact/lib/client.js" >/dev/null
grep -F "['MCP/Skills 管理', 'Управление MCP и навыками']" \
  "$ROOT/plugins/gildra-dsh-ui-compact/lib/client.js" >/dev/null
grep -F '@michengai/dsh-skills-manager@$SKILLS_MANAGER_VERSION' \
  "$ROOT/install/macos-install.command" >/dev/null
grep -F '@michengai/dsh-skills-manager@$($Versions.SKILLS_MANAGER_VERSION)' \
  "$ROOT/install/windows-install.ps1" >/dev/null
grep -F 'dsh-team@$DSH_TEAM_VERSION' \
  "$ROOT/install/macos-install.command" >/dev/null
grep -F 'dsh-team@$($Versions.DSH_TEAM_VERSION)' \
  "$ROOT/install/windows-install.ps1" >/dev/null
grep -F 'gildra/agent-presets' \
  "$ROOT/plugins/gildra-dsh-ui-compact/lib/index.js" >/dev/null
grep -F 'Конструктор агентов' \
  "$ROOT/plugins/gildra-dsh-ui-compact/lib/client.js" >/dev/null
grep -F 'github:GHJIVHIDD/dsh-plugin-canvas#$CANVAS_COMMIT' \
  "$ROOT/install/macos-install.command" >/dev/null
grep -F 'github:GHJIVHIDD/dsh-plugin-canvas#$($Versions.CANVAS_COMMIT)' \
  "$ROOT/install/windows-install.ps1" >/dev/null
grep -F "['画布', 'Карта кода']" \
  "$ROOT/plugins/gildra-dsh-ui-compact/lib/client.js" >/dev/null
grep -F "exec.name !== 'canvas_preview'" \
  "$ROOT/plugins/gildra-dsh-ui-compact/lib/index.js" >/dev/null
grep -F "do not send sandbox_permissions when the requested mode equals" \
  "$ROOT/plugins/gildra-dsh-ui-compact/lib/index.js" >/dev/null
grep -F 'install_skill_from_github' \
  "$ROOT/plugins/gildra-skill-installer/lib/index.js" >/dev/null
grep -F '"--no-open"' \
  "$ROOT/desktop/macos/HarnessService.swift" >/dev/null

"$ROOT/desktop/macos/build.sh" >/dev/null
codesign --verify --deep --strict "$ROOT/desktop/macos/build/Gildra DSH.app"
plutil -lint "$ROOT/desktop/macos/build/Gildra DSH.app/Contents/Info.plist"

echo "Gildra DSH kit verification passed."
