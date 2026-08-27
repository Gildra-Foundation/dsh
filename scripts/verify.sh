#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h:h}"
TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT

node --check "$ROOT/scripts/kit-config.mjs"
node --check "$ROOT/scripts/configure-profile.mjs"
node --check "$ROOT/scripts/update-profile-lock.mjs"
node --check "$ROOT/scripts/gildra-update.mjs"
node --check "$ROOT/scripts/check-upstream-dsh.mjs"
node --check "$ROOT/scripts/sync-server-fleet.mjs"
node --check "$ROOT/scripts/build-ui-client.mjs"
node "$ROOT/scripts/kit-config.test.mjs"
node "$ROOT/scripts/gildra-update.test.mjs"
node "$ROOT/scripts/sync-server-fleet.test.mjs"
node --check "$ROOT/plugins/gildra-dsh-ui-compact/lib/index.js"
node --check "$ROOT/plugins/gildra-dsh-ui-compact/lib/client.js"
node "$ROOT/scripts/build-ui-client.mjs" --check
node "$ROOT/plugins/gildra-dsh-ui-compact/test.mjs"
# Поведенческие DOM-тесты требуют dev-профиля (npm install → happy-dom);
# verify остаётся работоспособным и без него, CI ставит профиль всегда.
if [[ -d "$ROOT/node_modules/happy-dom" ]]; then
  node "$ROOT/plugins/gildra-dsh-ui-compact/dom.test.mjs"
fi
node --check "$ROOT/plugins/gildra-skill-installer/lib/index.js"
node "$ROOT/plugins/gildra-skill-installer/test.mjs"
for runtime_module in "$ROOT"/plugins/gildra-dsh-runtime/lib/*.js; do
  node --check "$runtime_module"
done
node "$ROOT/plugins/gildra-dsh-runtime/test/unit.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/git-safety.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/store.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/crash-recovery.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/merge.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/runtime-resources.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/projects.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/repo-intel.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/tasks.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/quality.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/review.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/upstream.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/context.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/fetch-race.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/e2e-team-flow.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/architecture.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/modularity.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/capabilities.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/verification-races.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/team.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/team-e2e.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/modularity-e2e.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/multiprocess.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/stress.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/workspaces.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/leases.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/sessions.test.mjs"
node "$ROOT/plugins/gildra-dsh-runtime/test/api.test.mjs"
node --check "$ROOT/patches/workspace-files-explorer-index.js"
node "$ROOT/patches/workspace-files-explorer-index.test.mjs"

for public_file in \
  README.md CHANGELOG.md CONTRIBUTING.md SECURITY.md LICENSE \
  docs/architecture.md docs/release-audit.md docs/assets/gildra-coding-desktop.png \
  .github/pull_request_template.md \
  .github/ISSUE_TEMPLATE/bug_report.yml \
  .github/ISSUE_TEMPLATE/feature_request.yml \
  .github/ISSUE_TEMPLATE/config.yml; do
  test -s "$ROOT/$public_file"
done

zsh -n "$ROOT/install/macos-install.command"
zsh -n "$ROOT/install/dsh-gildra"
zsh -n "$ROOT/install/Start-GildraDSH.command"
zsh -n "$ROOT/install/Update-GildraDSH.command"
zsh -n "$ROOT/Install Gildra DSH.command"
zsh -n "$ROOT/Update Gildra DSH.command"
zsh -n "$ROOT/scripts/build_and_run.sh"
bash -n "$ROOT/install/linux-server-install.sh"
bash -n "$ROOT/install/dsh-gildra-server"
bash -n "$ROOT/install/Start-GildraDSH.server.sh"

node -e "import('$ROOT/scripts/kit-config.mjs').then(async m => process.stdout.write(await m.renderProfilePatch('$ROOT')))" \
  > "$TEMP_DIR/cordis.patch.yml"
node -e "import('$ROOT/scripts/kit-config.mjs').then(async m => { const x = await m.readManifest('$ROOT'); process.stdout.write(m.renderWorkspace(x, m.desiredPlugins(x, '/tmp/gildra', 'darwin', () => true))) })" \
  > "$TEMP_DIR/pnpm-workspace.yaml"

ruby -ryaml -e 'ARGV.each { |path| YAML.parse_file(path) }' \
  "$ROOT/config/settings.yaml" \
  "$ROOT/config/agent-presets"/*/preset.yml \
  "$ROOT/config/agent-presets/engineering/agent.cordis.yml" \
  "$TEMP_DIR/cordis.patch.yml" \
  "$TEMP_DIR/pnpm-workspace.yaml" \
  "$ROOT/config/profile/fragments/10-subscriptions.yml" \
  "$ROOT/config/profile/fragments/20-automations.yml" \
  "$ROOT/config/profile/fragments/30-doublecheck.yml" \
  "$ROOT/config/profile/fragments/40-lsp.yml" \
  "$ROOT/config/profile/fragments/50-checkpoints.yml"

grep -F 'scripts/configure-profile.mjs' "$ROOT/install/macos-install.command" >/dev/null
grep -F 'scripts\configure-profile.mjs' "$ROOT/install/windows-install.ps1" >/dev/null
grep -F 'config/kit.json' "$ROOT/install/macos-install.command" >/dev/null
grep -F 'config\kit.json' "$ROOT/install/windows-install.ps1" >/dev/null
grep -F 'scripts' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'SHA256SUMS.txt' "$ROOT/.github/workflows/release.yml" >/dev/null
grep -F 'scripts/check-upstream-dsh.mjs' "$ROOT/.github/workflows/check-upstream.yml" >/dev/null

# Любой ref у actions, кроме полного commit SHA (включая @vN, @main, теги),
# изменяем и запрещён.
if grep -REn 'uses:[[:space:]]+[^[:space:]#]+@' "$ROOT/.github/workflows" \
  | grep -Ev '@[0-9a-f]{40}([^0-9a-f]|$)'; then
  echo 'GitHub Actions must be pinned to full commit SHAs.' >&2
  exit 1
fi

if grep -Eq 'dsh-(doublecheck|lsp-actions|checkpoint-rewind|auto-review)@|dsh-context-doctor#' \
  "$ROOT/install/macos-install.command" "$ROOT/install/windows-install.ps1"; then
  echo 'Managed plugin specs must live only in config/kit.json.' >&2
  exit 1
fi

"$ROOT/desktop/macos/build.sh" >/dev/null
codesign --verify --deep --strict "$ROOT/desktop/macos/build/Gildra DSH.app"
plutil -lint "$ROOT/desktop/macos/build/Gildra DSH.app/Contents/Info.plist"
test -f "$ROOT/desktop/macos/build/Gildra DSH.app/Contents/Resources/kit.json"
test "$(plutil -extract CFBundleShortVersionString raw -o - "$ROOT/desktop/macos/build/Gildra DSH.app/Contents/Info.plist")" = \
  "$(plutil -extract distribution.version raw -o - "$ROOT/config/kit.json")"

echo "Gildra DSH kit verification passed."
