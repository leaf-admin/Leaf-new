#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
REPO_ROOT="$(cd "$DASHBOARD_DIR/.." && pwd)"

CONTABO_HOST="${CONTABO_HOST:-${VPS_HOST:-}}"
CONTABO_KEY="${CONTABO_KEY:-${VPS_KEY:-$HOME/.ssh/leaf_contabo_20260412_ed25519}}"
VPS_USER="${VPS_USER:-root}"
REMOTE_DASHBOARD_DIR="${REMOTE_DASHBOARD_DIR:-/opt/leaf-dashboard-js}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3010}"
CONFIRM_DASHBOARD_DEPLOY="${CONFIRM_DASHBOARD_DEPLOY:-false}"
RUN_PUBLIC_SMOKE="${RUN_PUBLIC_SMOKE:-true}"

if [[ "$CONFIRM_DASHBOARD_DEPLOY" != "true" ]]; then
  echo "[dashboard-deploy][error] Set CONFIRM_DASHBOARD_DEPLOY=true." >&2
  exit 2
fi
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
  echo "[dashboard-deploy][error] RC worktree must be clean and immutable." >&2
  exit 2
fi
if [[ -z "$CONTABO_HOST" || ! -f "$CONTABO_KEY" ]]; then
  echo "[dashboard-deploy][error] CONTABO_HOST and CONTABO_KEY are required." >&2
  exit 2
fi

SSH_OPTS=(
  -i "$CONTABO_KEY"
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o ConnectTimeout=15
)
RSYNC_SSH="ssh -i \"$CONTABO_KEY\" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=15"
remote() { ssh "${SSH_OPTS[@]}" "$VPS_USER@$CONTABO_HOST" "$@"; }

echo "[dashboard-deploy] Local validation"
node "$DASHBOARD_DIR/scripts/tests/kyc-identity-review-panel-contract.cjs"
npm --prefix "$DASHBOARD_DIR" run qa:backoffice

STAMP="$(date +%Y%m%d-%H%M%S)"
RC_SHA="$(git -C "$REPO_ROOT" rev-parse --short=12 HEAD)"
REMOTE_BACKUP_DIR="$REMOTE_DASHBOARD_DIR/backups/kyc-review-$STAMP"

echo "[dashboard-deploy] Protected backup and image tag"
remote "
  set -e
  test -d '$REMOTE_DASHBOARD_DIR'
  test -f '$REMOTE_DASHBOARD_DIR/docker-compose.contabo.yml'
  test -f '$REMOTE_DASHBOARD_DIR/.env.production.local'
  mkdir -p '$REMOTE_BACKUP_DIR'
  chmod 700 '$REMOTE_BACKUP_DIR'
  cd '$REMOTE_DASHBOARD_DIR'
  previous_image=\$(docker inspect --format '{{.Image}}' leaf-dashboard)
  test -n \"\$previous_image\"
  docker image tag \"\$previous_image\" 'leaf-dashboard:rollback-$STAMP'
  printf '%s\n' \"\$previous_image\" > '$REMOTE_BACKUP_DIR/dashboard-image-before.txt'
  cp .env.production.local '$REMOTE_BACKUP_DIR/.env.production.local.before'
  chmod 600 '$REMOTE_BACKUP_DIR/.env.production.local.before'
  tar \
    --exclude='./node_modules' \
    --exclude='./.next' \
    --exclude='./backups' \
    --exclude='./.env.local' \
    --exclude='./.env.production' \
    --exclude='./.env.production.local' \
    -czf '$REMOTE_BACKUP_DIR/source-before.tar.gz' .
"

echo "[dashboard-deploy] Synchronizing RC $RC_SHA"
rsync -az --delete-delay \
  --exclude .git \
  --exclude .next \
  --exclude node_modules \
  --exclude backups \
  --exclude '.env*' \
  -e "$RSYNC_SSH" \
  "$DASHBOARD_DIR/" \
  "$VPS_USER@$CONTABO_HOST:$REMOTE_DASHBOARD_DIR/"

echo "[dashboard-deploy] Building and replacing dashboard only"
remote "
  set -e
  cd '$REMOTE_DASHBOARD_DIR'
  compose='docker compose --env-file .env.production.local -f docker-compose.contabo.yml'
  \$compose build leaf-dashboard
  candidate_image=\$(\$compose images -q leaf-dashboard | head -n1)
  test -n \"\$candidate_image\"
  docker image tag \"\$candidate_image\" 'leaf-dashboard:kyc-review-$RC_SHA'
  printf '%s\n' \"\$candidate_image\" > '$REMOTE_BACKUP_DIR/dashboard-image-candidate.txt'
  \$compose up -d --no-deps leaf-dashboard
  for attempt in \$(seq 1 40); do
    if curl -fsS --max-time 5 'http://127.0.0.1:$DASHBOARD_PORT/login' >/dev/null; then
      exit 0
    fi
    sleep 2
  done
  docker logs --tail=120 leaf-dashboard >&2 || true
  exit 1
"

if [[ "$RUN_PUBLIC_SMOKE" == "true" ]]; then
  curl -fsS --max-time 20 https://dashboard.leaf.app.br/login >/dev/null
fi

echo "[dashboard-deploy][done] RC $RC_SHA activated."
echo "[dashboard-deploy][rollback] Retag leaf-dashboard:rollback-$STAMP as leaf-dashboard:contabo and restart leaf-dashboard without build."
