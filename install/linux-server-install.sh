#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$REPO_DIR/config/kit.json"

kit_value() {
  python3 - "$MANIFEST" "$1" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as source:
    value = json.load(source)
for part in sys.argv[2].split("."):
    value = value[part]
print(value)
PY
}

DSH_COMMIT="$(kit_value runtime.dshCommit)"
KIT_VERSION="$(kit_value distribution.version)"
NODE_VERSION="$(kit_value runtime.nodeVersion)"
PNPM_VERSION="$(kit_value runtime.pnpmVersion)"
CODEGRAPH_COMMIT="$(kit_value runtime.codegraphCommit)"
OLLAMA_VERSION="$(kit_value runtime.ollamaVersion)"
OLLAMA_MODEL="$(kit_value runtime.ollamaModel)"

INSTALL_ROOT="${GILDRA_DSH_INSTALL_ROOT:-$HOME/.gildra-dsh}"
# Нормализация перед guard'ом: "$HOME/" или "//" обходили точное сравнение,
# и кит рассыпался прямо в домашний каталог.
while [[ "$INSTALL_ROOT" == */ && "$INSTALL_ROOT" != "/" ]]; do
  INSTALL_ROOT="${INSTALL_ROOT%/}"
done
case "$INSTALL_ROOT" in
  ""|/|"$HOME") echo "Unsafe GILDRA_DSH_INSTALL_ROOT: $INSTALL_ROOT" >&2; exit 1 ;;
esac

RUNTIME_DIR="$INSTALL_ROOT/runtime"
DOWNLOAD_DIR="$INSTALL_ROOT/downloads"
mkdir -p "$RUNTIME_DIR" "$DOWNLOAD_DIR" "$INSTALL_ROOT/bin" "$INSTALL_ROOT/vendor" "$INSTALL_ROOT/config"

ensure_native_build_tools() {
  local missing=()
  command -v make >/dev/null 2>&1 || missing+=(make)
  command -v g++ >/dev/null 2>&1 || missing+=(g++)
  command -v python3 >/dev/null 2>&1 || missing+=(python3)
  if (( ${#missing[@]} == 0 )); then return; fi

  if command -v apt-get >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1 \
      && sudo -n true >/dev/null 2>&1; then
    echo "Installing native build tools required by the terminal plugin: ${missing[*]}"
    sudo -n apt-get update
    sudo -n apt-get install -y build-essential python3
    return
  fi

  echo "Missing native build tools required by the terminal plugin: ${missing[*]}" >&2
  echo "Install make, g++ and python3, then run this installer again." >&2
  exit 1
}

ensure_native_build_tools

server_port="${GILDRA_DSH_PORT:-}"
if [[ -z "$server_port" && -f "$INSTALL_ROOT/config/server.env" ]]; then
  server_port="$(sed -n 's/^CONFIGURED_PORT=//p' "$INSTALL_ROOT/config/server.env" | tail -n 1)"
fi
server_port="${server_port:-3080}"
if [[ ! "$server_port" =~ ^[0-9]+$ ]]; then
  echo "GILDRA_DSH_PORT must be a number from 1024 to 65535." >&2
  exit 1
fi
server_port_number=$((10#$server_port))
if (( server_port_number < 1024 || server_port_number > 65535 )); then
  echo "GILDRA_DSH_PORT must be a number from 1024 to 65535." >&2
  exit 1
fi
server_port="$server_port_number"
printf 'CONFIGURED_PORT=%s\n' "$server_port" > "$INSTALL_ROOT/config/server.env"

case "$(uname -m)" in
  x86_64|amd64)
    node_arch=x64
    node_sha256="$(kit_value runtime.nodeSha256.linuxX64)"
    ollama_arch=amd64
    ollama_sha256="$(kit_value runtime.ollamaSha256.linuxX64)"
    ;;
  aarch64|arm64)
    node_arch=arm64
    node_sha256="$(kit_value runtime.nodeSha256.linuxArm64)"
    ollama_arch=arm64
    ollama_sha256="$(kit_value runtime.ollamaSha256.linuxArm64)"
    ;;
  *) echo "Unsupported Linux architecture: $(uname -m)" >&2; exit 1 ;;
esac

node_marker="$RUNTIME_DIR/node/.gildra-version"
installed_node_version="$(test -f "$node_marker" && tr -d '\r\n' < "$node_marker" || true)"
if [[ ! -x "$RUNTIME_DIR/node/bin/node" || "$installed_node_version" != "$NODE_VERSION" ]]; then
  node_archive="$DOWNLOAD_DIR/node-v$NODE_VERSION-linux-$node_arch.tar.gz"
  curl -LfsS "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$node_arch.tar.gz" -o "$node_archive"
  echo "$node_sha256  $node_archive" | sha256sum -c - >/dev/null
  node_stage="$INSTALL_ROOT/.node-stage-$$"
  rm -rf "$node_stage"
  mkdir -p "$node_stage"
  tar -xzf "$node_archive" --strip-components=1 -C "$node_stage"
  rm -rf "$RUNTIME_DIR/node"
  mv "$node_stage" "$RUNTIME_DIR/node"
  printf '%s\n' "$NODE_VERSION" > "$node_marker"
fi

export PATH="$RUNTIME_DIR/node/bin:$PATH"
corepack prepare "pnpm@$PNPM_VERSION" --activate
corepack enable pnpm

source_marker="$INSTALL_ROOT/source/.gildra-commit"
installed_source_commit="$(test -f "$source_marker" && tr -d '\r\n' < "$source_marker" || true)"
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
  printf '%s\n' "$DSH_COMMIT" > "$source_marker"
  rm -rf "$source_backup"
fi

codegraph_marker="$INSTALL_ROOT/vendor/codegraph/.gildra-commit"
installed_codegraph_commit="$(test -f "$codegraph_marker" && tr -d '\r\n' < "$codegraph_marker" || true)"
if [[ ! -f "$INSTALL_ROOT/vendor/codegraph/index.js" || "$installed_codegraph_commit" != "$CODEGRAPH_COMMIT" ]]; then
  codegraph_archive="$DOWNLOAD_DIR/codegraph-$CODEGRAPH_COMMIT.tar.gz"
  curl -LfsS "https://github.com/JohnXu22786/codegraph/archive/$CODEGRAPH_COMMIT.tar.gz" -o "$codegraph_archive"
  rm -rf "$INSTALL_ROOT/vendor/codegraph" "$DOWNLOAD_DIR/codegraph-$CODEGRAPH_COMMIT"
  tar -xzf "$codegraph_archive" -C "$DOWNLOAD_DIR"
  mv "$DOWNLOAD_DIR/codegraph-$CODEGRAPH_COMMIT" "$INSTALL_ROOT/vendor/codegraph"
  printf '%s\n' "$CODEGRAPH_COMMIT" > "$codegraph_marker"
fi

cp "$REPO_DIR/install/dsh-gildra-server" "$INSTALL_ROOT/bin/dsh-gildra"
cp "$REPO_DIR/install/Start-GildraDSH.server.sh" "$INSTALL_ROOT/bin/Start-GildraDSH.server.sh"
cp "$MANIFEST" "$INSTALL_ROOT/config/kit.json"
chmod +x "$INSTALL_ROOT/bin/dsh-gildra" "$INSTALL_ROOT/bin/Start-GildraDSH.server.sh"

"$RUNTIME_DIR/node/bin/node" "$REPO_DIR/scripts/configure-profile.mjs" \
  --repo-dir "$REPO_DIR" \
  --install-root "$INSTALL_ROOT"

shared_ollama=0
if [[ "${GILDRA_DSH_FORCE_PRIVATE_OLLAMA:-0}" != "1" ]] \
  && curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  shared_ollama=1
  echo "Reusing the shared Ollama service at 127.0.0.1:11434."
fi

if [[ "${GILDRA_DSH_SKIP_OLLAMA:-0}" != "1" && "$shared_ollama" != "1" ]]; then
  command -v zstd >/dev/null 2>&1 || {
    echo "zstd is required to install the pinned Ollama runtime." >&2
    exit 1
  }
  ollama_root="$RUNTIME_DIR/ollama"
  ollama_marker="$ollama_root/.gildra-version"
  installed_ollama_version="$(test -f "$ollama_marker" && tr -d '\r\n' < "$ollama_marker" || true)"
  if [[ ! -x "$ollama_root/bin/ollama" || "$installed_ollama_version" != "$OLLAMA_VERSION" ]]; then
    ollama_archive="$DOWNLOAD_DIR/ollama-v$OLLAMA_VERSION-linux-$ollama_arch.tar.zst"
    curl -LfsS "https://github.com/ollama/ollama/releases/download/v$OLLAMA_VERSION/ollama-linux-$ollama_arch.tar.zst" -o "$ollama_archive"
    echo "$ollama_sha256  $ollama_archive" | sha256sum -c - >/dev/null
    ollama_stage="$INSTALL_ROOT/.ollama-stage-$$"
    ollama_backup="$INSTALL_ROOT/.ollama-backup-$$"
    rm -rf "$ollama_stage" "$ollama_backup"
    mkdir -p "$ollama_stage"
    zstd -dc "$ollama_archive" | tar -xf - -C "$ollama_stage"
    if [[ -d "$ollama_root" ]]; then mv "$ollama_root" "$ollama_backup"; fi
    if ! mv "$ollama_stage" "$ollama_root"; then
      if [[ -d "$ollama_backup" ]]; then mv "$ollama_backup" "$ollama_root"; fi
      exit 1
    fi
    printf '%s\n' "$OLLAMA_VERSION" > "$ollama_marker"
    rm -rf "$ollama_backup"
  fi

  mkdir -p "$INSTALL_ROOT/home/ollama/models" "$HOME/.config/systemd/user"
  python3 - "$REPO_DIR/install/gildra-ollama.service.in" "$HOME/.config/systemd/user/gildra-ollama.service" "$INSTALL_ROOT" <<'PY'
from pathlib import Path
import sys

source, target, install_root = map(Path, sys.argv[1:])
target.write_text(source.read_text(encoding="utf-8").replace("@INSTALL_ROOT@", str(install_root)), encoding="utf-8")
PY
  if systemctl --user daemon-reload >/dev/null 2>&1; then
    systemctl --user enable gildra-ollama.service
    systemctl --user restart gildra-ollama.service
    for _ in {1..30}; do
      if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1; then break; fi
      sleep 1
    done
    curl -fsS http://127.0.0.1:11434/api/version >/dev/null
    OLLAMA_HOST=127.0.0.1:11434 "$ollama_root/bin/ollama" pull "$OLLAMA_MODEL"
  else
    echo "User systemd is unavailable; start Ollama with: $ollama_root/bin/ollama serve" >&2
  fi
fi

if [[ "${GILDRA_DSH_SKIP_OLLAMA:-0}" != "1" && "$shared_ollama" == "1" ]]; then
  curl -fsS http://127.0.0.1:11434/api/pull \
    -H 'content-type: application/json' \
    --data "{\"name\":\"$OLLAMA_MODEL\",\"stream\":false}" >/dev/null
fi

printf '%s\n' "$KIT_VERSION" > "$INSTALL_ROOT/.gildra-kit-version"
echo "Installed Gildra DSH server kit $KIT_VERSION at $INSTALL_ROOT"
echo "Harness port for this Unix user: $server_port"
echo "Start with: $INSTALL_ROOT/bin/Start-GildraDSH.server.sh"
