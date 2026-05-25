#!/usr/bin/env bash
set -euo pipefail

# Verifica paridade entre runtime local e runtime efetivo na VPS.
# Uso:
#   ./scripts/ops/check-vps-runtime-parity.sh
#   STRICT=false FETCH_REMOTE=true ./scripts/ops/check-vps-runtime-parity.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

RUNTIME_MODE="${RUNTIME_MODE:-vps}"
VPS_HOST="${VPS_HOST:-62.169.31.231}"
VPS_USER="${VPS_USER:-root}"
STRICT="${STRICT:-true}"
FETCH_REMOTE="${FETCH_REMOTE:-false}"

resolve_default_vps_key() {
  local candidates=(
    "$HOME/.ssh/leaf_contabo_20260412_ed25519"
    "$HOME/.ssh/serafy_contabo_ed25519"
    "$BACKEND_DIR/../contabokey"
    "$BACKEND_DIR/../digitaloceankey"
  )
  for candidate in "${candidates[@]}"; do
    if [[ -f "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  echo "$BACKEND_DIR/../digitaloceankey"
}

VPS_KEY="${VPS_KEY:-$(resolve_default_vps_key)}"

case "$RUNTIME_MODE" in
  vps)
    DEFAULT_LOCAL_RUNTIME_FILE="$BACKEND_DIR/server.vps.js"
    DEFAULT_REMOTE_RUNTIME_FILE="/opt/leaf-app/server.vps.js"
    ;;
  modular)
    DEFAULT_LOCAL_RUNTIME_FILE="$BACKEND_DIR/server.js"
    DEFAULT_REMOTE_RUNTIME_FILE="/opt/leaf-app/server.js"
    ;;
  *)
    echo "[parity][error] RUNTIME_MODE inválido: $RUNTIME_MODE (use: vps|modular)"
    exit 2
    ;;
esac

LOCAL_RUNTIME_FILE="${LOCAL_RUNTIME_FILE:-$DEFAULT_LOCAL_RUNTIME_FILE}"
REMOTE_RUNTIME_FILE="${REMOTE_RUNTIME_FILE:-$DEFAULT_REMOTE_RUNTIME_FILE}"

if [[ ! -f "$LOCAL_RUNTIME_FILE" ]]; then
  echo "[parity][error] Arquivo local não encontrado: $LOCAL_RUNTIME_FILE"
  exit 2
fi

if [[ ! -f "$VPS_KEY" ]]; then
  echo "[parity][error] Chave SSH não encontrada: $VPS_KEY"
  exit 2
fi

SSH_OPTS=(
  -i "$VPS_KEY"
  -o IdentitiesOnly=yes
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
)

local_sum="$(shasum -a 256 "$LOCAL_RUNTIME_FILE" | awk '{print $1}')"

remote_sum="$(
  ssh "${SSH_OPTS[@]}" "$VPS_USER@$VPS_HOST" \
    "if command -v sha256sum >/dev/null 2>&1; then sha256sum '$REMOTE_RUNTIME_FILE' | awk '{print \$1}'; else shasum -a 256 '$REMOTE_RUNTIME_FILE' | awk '{print \$1}'; fi"
)"

if [[ -z "${remote_sum// }" ]]; then
  echo "[parity][error] Não foi possível calcular hash remoto para $REMOTE_RUNTIME_FILE"
  exit 2
fi

echo "[parity] local : $LOCAL_RUNTIME_FILE"
echo "[parity] remote: $VPS_USER@$VPS_HOST:$REMOTE_RUNTIME_FILE"
echo "[parity] local_sha256 : $local_sum"
echo "[parity] remote_sha256: $remote_sum"

if [[ "$local_sum" == "$remote_sum" ]]; then
  echo "[parity][ok] Runtime local e runtime da VPS estão em paridade."
  exit 0
fi

echo "[parity][warn] Divergência detectada entre runtime local e VPS."

if [[ "$FETCH_REMOTE" == "true" ]]; then
  target_dir="$BACKEND_DIR/.tmp/vps-runtime"
  mkdir -p "$target_dir"
  target_file="$target_dir/server.vps.current.js"
  scp "${SSH_OPTS[@]}" "$VPS_USER@$VPS_HOST:$REMOTE_RUNTIME_FILE" "$target_file" >/dev/null
  echo "[parity] runtime remoto copiado para: $target_file"
fi

if [[ "$STRICT" == "true" ]]; then
  exit 1
fi

exit 0
