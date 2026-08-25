#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_DIR="${SCRIPT_DIR:h}"
source "$REPO_DIR/config/versions.env"

INSTALL_ROOT="${GILDRA_DSH_INSTALL_ROOT:-$HOME/.gildra-dsh}"
RUNTIME_DIR="$INSTALL_ROOT/runtime"
DOWNLOAD_DIR="$INSTALL_ROOT/downloads"
PROFILE_DIR="$INSTALL_ROOT/home/profiles/web"

mkdir -p "$RUNTIME_DIR" "$DOWNLOAD_DIR" "$INSTALL_ROOT/bin" "$INSTALL_ROOT/vendor" "$HOME/Applications"

arch="$(uname -m)"
case "$arch" in
  arm64) node_arch=arm64 ;;
  x86_64) node_arch=x64 ;;
  *) echo "Unsupported macOS architecture: $arch" >&2; exit 1 ;;
esac

node_archive="$DOWNLOAD_DIR/node-v$NODE_VERSION-darwin-$node_arch.tar.gz"
if [[ ! -x "$RUNTIME_DIR/node/bin/node" ]]; then
  curl -LfsS "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$node_arch.tar.gz" -o "$node_archive"
  rm -rf "$RUNTIME_DIR/node"
  mkdir -p "$RUNTIME_DIR/node"
  tar -xzf "$node_archive" --strip-components=1 -C "$RUNTIME_DIR/node"
fi

export PATH="$RUNTIME_DIR/node/bin:$PATH"
corepack prepare "pnpm@$PNPM_VERSION" --activate

source_archive="$DOWNLOAD_DIR/deepseek-harness-$DSH_COMMIT.tar.gz"
if [[ ! -f "$INSTALL_ROOT/source/apps/cli/lib/bin.js" ]]; then
  curl -LfsS "https://github.com/deepseek-ai/deepseek-harness/archive/$DSH_COMMIT.tar.gz" -o "$source_archive"
  rm -rf "$INSTALL_ROOT/source" "$DOWNLOAD_DIR/deepseek-harness-$DSH_COMMIT"
  tar -xzf "$source_archive" -C "$DOWNLOAD_DIR"
  mv "$DOWNLOAD_DIR/deepseek-harness-$DSH_COMMIT" "$INSTALL_ROOT/source"
fi

pnpm --dir "$INSTALL_ROOT/source" install --frozen-lockfile
DSH_CLIENT_COMMIT_HASH="$DSH_COMMIT" pnpm --dir "$INSTALL_ROOT/source" run build

codegraph_archive="$DOWNLOAD_DIR/codegraph-$CODEGRAPH_COMMIT.tar.gz"
if [[ ! -f "$INSTALL_ROOT/vendor/codegraph/index.js" ]]; then
  curl -LfsS "https://github.com/JohnXu22786/codegraph/archive/$CODEGRAPH_COMMIT.tar.gz" -o "$codegraph_archive"
  rm -rf "$INSTALL_ROOT/vendor/codegraph" "$DOWNLOAD_DIR/codegraph-$CODEGRAPH_COMMIT"
  tar -xzf "$codegraph_archive" -C "$DOWNLOAD_DIR"
  mv "$DOWNLOAD_DIR/codegraph-$CODEGRAPH_COMMIT" "$INSTALL_ROOT/vendor/codegraph"
fi

rm -rf "$INSTALL_ROOT/vendor/gildra-dsh-ui-compact"
cp -R "$REPO_DIR/plugins/gildra-dsh-ui-compact" "$INSTALL_ROOT/vendor/gildra-dsh-ui-compact"
cp "$REPO_DIR/install/dsh-gildra" "$INSTALL_ROOT/bin/dsh-gildra"
cp "$REPO_DIR/install/Start-GildraDSH.command" "$INSTALL_ROOT/bin/Start-GildraDSH.command"
chmod +x "$INSTALL_ROOT/bin/dsh-gildra" "$INSTALL_ROOT/bin/Start-GildraDSH.command"

export DSH_HOME="$INSTALL_ROOT/home"
DSH="$INSTALL_ROOT/bin/dsh-gildra"

"$DSH" plugin --profile web add dsh-plugin-subscriptions@0.5.2
mkdir -p "$PROFILE_DIR"
cp "$REPO_DIR/config/profile/pnpm-workspace.yaml" "$PROFILE_DIR/pnpm-workspace.yaml"

if [[ -f "$PROFILE_DIR/package.json" ]] && grep -q '"@dsh-external/dsh-automation"' "$PROFILE_DIR/package.json"; then
  "$DSH" plugin --profile web remove @dsh-external/dsh-automation
fi

plugins=(
  "@deepseek-ai/dsh-subagent-codex@0.1.1-rc.2"
  "@deepseek-ai/dsh-subagent-claude-code@0.1.1-rc.2"
  "@syncended/dsh-automations@$AUTOMATIONS_VERSION"
  "github:omdsh-dev/dsh-genui#d99c978d4b0b29ba2a6993f8544a24930fc7d25a"
  "github:omdsh-dev/dsh-security-audit#ae927be8c92e483a8c8739b32831c0a237c0ed01"
  "github:Zhenyu98/dsh-context-doctor#f45096dc7a7ad52cfa7cf32cdaccae717faa662d"
  "github:delef/dsh-free-web-search#94bd12880a8f4000374cd25629f5e97c9d5364fd"
  "@tt-a1i/archify-dsh@0.1.0"
  "dsh-at-file@0.6.3"
  "dsh-context@0.31.0"
  "link:$INSTALL_ROOT/vendor/gildra-dsh-ui-compact"
)
for plugin in "${plugins[@]}"; do
  "$DSH" plugin --profile web add "$plugin"
done

if command -v python3 >/dev/null 2>&1; then
  "$DSH" plugin --profile web add "link:$INSTALL_ROOT/vendor/codegraph"
else
  echo "Note: CodeGraph was downloaded but not enabled because python3 is unavailable. Archify remains available."
fi

mkdir -p "$INSTALL_ROOT/home/.agent-presets/engineering"
cp "$REPO_DIR/config/agent-presets/engineering/agent.cordis.yml" "$INSTALL_ROOT/home/.agent-presets/engineering/agent.cordis.yml"
cp "$REPO_DIR/config/agent-presets/engineering/preset.yml" "$INSTALL_ROOT/home/.agent-presets/engineering/preset.yml"
cp "$REPO_DIR/config/settings.yaml" "$INSTALL_ROOT/home/settings.yaml"
cp "$REPO_DIR/config/profile/cordis.patch.yml" "$PROFILE_DIR/cordis.patch.yml"

if [[ "${GILDRA_DSH_NO_LAUNCH:-0}" == "1" ]]; then
  echo "Installed Gildra DSH runtime at $INSTALL_ROOT"
  exit 0
fi

app_source=""
if [[ -d "$REPO_DIR/dist/Gildra DSH.app" ]]; then
  app_source="$REPO_DIR/dist/Gildra DSH.app"
elif [[ -d "$REPO_DIR/desktop/macos/build/Gildra DSH.app" ]]; then
  app_source="$REPO_DIR/desktop/macos/build/Gildra DSH.app"
elif command -v xcrun >/dev/null 2>&1; then
  "$REPO_DIR/desktop/macos/build.sh" >/dev/null
  app_source="$REPO_DIR/desktop/macos/build/Gildra DSH.app"
fi

if [[ -n "$app_source" ]]; then
  rm -rf "$HOME/Applications/Gildra DSH.app"
  cp -R "$app_source" "$HOME/Applications/Gildra DSH.app"
  defaults write net.gildra.dsh DSHBinOverride -string "$INSTALL_ROOT/bin/dsh-gildra"
  defaults write net.gildra.dsh DSHPreferredPort -int 3080
  open "$HOME/Applications/Gildra DSH.app"
  echo "Installed: $HOME/Applications/Gildra DSH.app"
else
  cp "$INSTALL_ROOT/bin/Start-GildraDSH.command" "$HOME/Applications/Start Gildra DSH.command"
  chmod +x "$HOME/Applications/Start Gildra DSH.command"
  open "$HOME/Applications/Start Gildra DSH.command"
  echo "Installed launcher: $HOME/Applications/Start Gildra DSH.command"
fi
