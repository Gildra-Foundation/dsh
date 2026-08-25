#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
REPO_DIR="${SCRIPT_DIR:h}"
MANIFEST="$REPO_DIR/config/kit.json"

kit_value() {
  /usr/bin/plutil -extract "$1" raw -o - "$MANIFEST"
}

DSH_COMMIT="$(kit_value runtime.dshCommit)"
KIT_VERSION="$(kit_value distribution.version)"
NODE_VERSION="$(kit_value runtime.nodeVersion)"
PNPM_VERSION="$(kit_value runtime.pnpmVersion)"
CODEGRAPH_COMMIT="$(kit_value runtime.codegraphCommit)"

INSTALL_ROOT="${GILDRA_DSH_INSTALL_ROOT:-$HOME/.gildra-dsh}"
INSTALL_ROOT="${INSTALL_ROOT:A}"
case "$INSTALL_ROOT" in
  ""|/|"$HOME") echo "Unsafe GILDRA_DSH_INSTALL_ROOT: $INSTALL_ROOT" >&2; exit 1 ;;
esac
RUNTIME_DIR="$INSTALL_ROOT/runtime"
DOWNLOAD_DIR="$INSTALL_ROOT/downloads"

mkdir -p "$RUNTIME_DIR" "$DOWNLOAD_DIR" "$INSTALL_ROOT/bin" "$INSTALL_ROOT/vendor" "$INSTALL_ROOT/config" "$HOME/Applications"

arch="$(uname -m)"
case "$arch" in
  arm64)
    node_arch=arm64
    node_sha256="$(kit_value runtime.nodeSha256.darwinArm64)"
    ;;
  x86_64)
    node_arch=x64
    node_sha256="$(kit_value runtime.nodeSha256.darwinX64)"
    ;;
  *) echo "Unsupported macOS architecture: $arch" >&2; exit 1 ;;
esac

node_marker="$RUNTIME_DIR/node/.gildra-version"
installed_node_version="$(test -f "$node_marker" && /bin/cat "$node_marker" || true)"
if [[ ! -x "$RUNTIME_DIR/node/bin/node" || "$installed_node_version" != "$NODE_VERSION" ]]; then
  node_archive="$DOWNLOAD_DIR/node-v$NODE_VERSION-darwin-$node_arch.tar.gz"
  curl -LfsS "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-darwin-$node_arch.tar.gz" -o "$node_archive"
  echo "$node_sha256  $node_archive" | shasum -a 256 -c - >/dev/null
  rm -rf "$RUNTIME_DIR/node"
  mkdir -p "$RUNTIME_DIR/node"
  tar -xzf "$node_archive" --strip-components=1 -C "$RUNTIME_DIR/node"
  print -r -- "$NODE_VERSION" > "$node_marker"
fi

export PATH="$RUNTIME_DIR/node/bin:$PATH"
corepack prepare "pnpm@$PNPM_VERSION" --activate
corepack enable pnpm

source_marker="$INSTALL_ROOT/source/.gildra-commit"
installed_source_commit="$(test -f "$source_marker" && /bin/cat "$source_marker" || true)"
if [[ ! -f "$INSTALL_ROOT/source/apps/cli/lib/bin.js" || "$installed_source_commit" != "$DSH_COMMIT" ]]; then
  source_archive="$DOWNLOAD_DIR/deepseek-harness-$DSH_COMMIT.tar.gz"
  curl -LfsS "https://github.com/deepseek-ai/deepseek-harness/archive/$DSH_COMMIT.tar.gz" -o "$source_archive"
  source_stage="$INSTALL_ROOT/.source-stage-$$"
  source_backup="$INSTALL_ROOT/.source-backup-$$"
  rm -rf "$source_stage" "$source_backup" "$DOWNLOAD_DIR/deepseek-harness-$DSH_COMMIT"
  tar -xzf "$source_archive" -C "$DOWNLOAD_DIR"
  mv "$DOWNLOAD_DIR/deepseek-harness-$DSH_COMMIT" "$source_stage"
  corepack pnpm --dir "$source_stage" install --frozen-lockfile
  DSH_CLIENT_COMMIT_HASH="$DSH_COMMIT" corepack pnpm --dir "$source_stage" run build
  if [[ -d "$INSTALL_ROOT/source" ]]; then mv "$INSTALL_ROOT/source" "$source_backup"; fi
  if ! mv "$source_stage" "$INSTALL_ROOT/source"; then
    if [[ -d "$source_backup" ]]; then mv "$source_backup" "$INSTALL_ROOT/source"; fi
    exit 1
  fi
  print -r -- "$DSH_COMMIT" > "$source_marker"
  rm -rf "$source_backup"
fi

codegraph_marker="$INSTALL_ROOT/vendor/codegraph/.gildra-commit"
installed_codegraph_commit="$(test -f "$codegraph_marker" && /bin/cat "$codegraph_marker" || true)"
if [[ ! -f "$INSTALL_ROOT/vendor/codegraph/index.js" || "$installed_codegraph_commit" != "$CODEGRAPH_COMMIT" ]]; then
  codegraph_archive="$DOWNLOAD_DIR/codegraph-$CODEGRAPH_COMMIT.tar.gz"
  curl -LfsS "https://github.com/JohnXu22786/codegraph/archive/$CODEGRAPH_COMMIT.tar.gz" -o "$codegraph_archive"
  rm -rf "$INSTALL_ROOT/vendor/codegraph" "$DOWNLOAD_DIR/codegraph-$CODEGRAPH_COMMIT"
  tar -xzf "$codegraph_archive" -C "$DOWNLOAD_DIR"
  mv "$DOWNLOAD_DIR/codegraph-$CODEGRAPH_COMMIT" "$INSTALL_ROOT/vendor/codegraph"
  print -r -- "$CODEGRAPH_COMMIT" > "$codegraph_marker"
fi

cp "$REPO_DIR/install/dsh-gildra" "$INSTALL_ROOT/bin/dsh-gildra"
cp "$REPO_DIR/install/Start-GildraDSH.command" "$INSTALL_ROOT/bin/Start-GildraDSH.command"
cp "$REPO_DIR/install/Update-GildraDSH.command" "$INSTALL_ROOT/bin/Update-GildraDSH.command"
cp "$REPO_DIR/scripts/gildra-update.mjs" "$INSTALL_ROOT/bin/gildra-update.mjs"
cp "$REPO_DIR/scripts/sync-server-fleet.mjs" "$INSTALL_ROOT/bin/sync-server-fleet.mjs"
cp "$MANIFEST" "$INSTALL_ROOT/config/kit.json"
chmod +x "$INSTALL_ROOT/bin/dsh-gildra" "$INSTALL_ROOT/bin/Start-GildraDSH.command" \
  "$INSTALL_ROOT/bin/Update-GildraDSH.command" "$INSTALL_ROOT/bin/gildra-update.mjs" \
  "$INSTALL_ROOT/bin/sync-server-fleet.mjs"

"$RUNTIME_DIR/node/bin/node" "$REPO_DIR/scripts/configure-profile.mjs" \
  --repo-dir "$REPO_DIR" \
  --install-root "$INSTALL_ROOT"

if [[ "${GILDRA_DSH_SKIP_REMOTE_SYNC:-0}" != "1" && -f "$INSTALL_ROOT/home/remotes.json" ]]; then
  "$RUNTIME_DIR/node/bin/node" "$REPO_DIR/scripts/sync-server-fleet.mjs" \
    --repo-dir "$REPO_DIR" \
    --install-root "$INSTALL_ROOT" \
    --best-effort
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
  app_target="$HOME/Applications/Gildra DSH.app"
  app_backup="$HOME/Applications/.Gildra DSH.backup-$$.app"
  rm -rf "$app_backup"
  if [[ -d "$app_target" ]]; then mv "$app_target" "$app_backup"; fi
  if ! cp -R "$app_source" "$app_target"; then
    rm -rf "$app_target"
    if [[ -d "$app_backup" ]]; then mv "$app_backup" "$app_target"; fi
    exit 1
  fi
  rm -rf "$app_backup"
  defaults write net.gildra.dsh DSHBinOverride -string "$INSTALL_ROOT/bin/dsh-gildra"
  defaults write net.gildra.dsh DSHPreferredPort -int 3080
  echo "Installed: $app_target"
else
  cp "$INSTALL_ROOT/bin/Start-GildraDSH.command" "$HOME/Applications/Start Gildra DSH.command"
  chmod +x "$HOME/Applications/Start Gildra DSH.command"
  echo "Installed launcher: $HOME/Applications/Start Gildra DSH.command"
fi

cp "$INSTALL_ROOT/bin/Update-GildraDSH.command" "$HOME/Applications/Update Gildra DSH.command"
chmod +x "$HOME/Applications/Update Gildra DSH.command"
print -r -- "$KIT_VERSION" > "$INSTALL_ROOT/.gildra-kit-version"

if [[ "${GILDRA_DSH_NO_LAUNCH:-0}" == "1" ]]; then
  echo "Installed Gildra DSH $KIT_VERSION at $INSTALL_ROOT"
  exit 0
fi

if [[ -n "$app_source" ]]; then
  open "$HOME/Applications/Gildra DSH.app"
else
  open "$HOME/Applications/Start Gildra DSH.command"
fi
