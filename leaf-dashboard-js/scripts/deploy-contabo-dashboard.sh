#!/usr/bin/env bash
set -euo pipefail

# Dashboard rollout on Contabo (/opt/leaf-dashboard-js, container leaf-dashboard).
# Same steps as the manual recipe used since 2026-11-08, so people and the CTO
# bot (via ~/.leaf-bots/bin/leaf-deploy) deploy the same way.
#
#   deploy:   CONFIRM_PRODUCTION_DEPLOY=true PRODUCTION_RELEASE_SHA=<origin/main HEAD> \
#             bash leaf-dashboard-js/scripts/deploy-contabo-dashboard.sh deploy
#   rollback: CONFIRM_PRODUCTION_DEPLOY=true \
#             bash leaf-dashboard-js/scripts/deploy-contabo-dashboard.sh rollback [rollback-YYYYMMDD-HHMMSS]
#
# Deploy: tags the running image as leaf-dashboard:rollback-<stamp>, copies only
# changed files (changed ones are kept in backups/<stamp>/; nothing on the host is
# deleted), builds with .env.production.local (it carries the NEXT_PUBLIC_* build
# values), recreates only leaf-dashboard and checks HTTP 200. A failed build or
# check puts the previous image back by itself.
# Rollback: retags the newest (or the named) rollback image and recreates the
# container. Source files stay as they are; the next deploy rebuilds from them.
# Contabo is a shared host: this touches only /opt/leaf-dashboard-js and the
# leaf-dashboard container, never nginx or other compose projects.

MODE="${1:-}"
TARGET_TAG="${2:-}"
SSH_TARGET="${DASHBOARD_SSH:-leaf-vps}"
REMOTE_DIR="${DASHBOARD_REMOTE_DIR:-/opt/leaf-dashboard-js}"
PUBLIC_URL="${DASHBOARD_PUBLIC_URL:-https://dashboard.leaf.app.br/login}"
CONFIRM_PRODUCTION_DEPLOY="${CONFIRM_PRODUCTION_DEPLOY:-false}"
PRODUCTION_RELEASE_SHA="${PRODUCTION_RELEASE_SHA:-}"
DRY_RUN="${DASHBOARD_DRY_RUN:-false}"   # true: show what would change, change nothing
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE="docker compose -f docker-compose.contabo.yml --env-file .env.production.local"

die() { echo "[dashboard-deploy][error] $*" >&2; exit 2; }

[[ "$MODE" == "deploy" || "$MODE" == "rollback" ]] || die "usage: $0 deploy | rollback [rollback-YYYYMMDD-HHMMSS]"
[[ "$CONFIRM_PRODUCTION_DEPLOY" == "true" ]] || die "Set CONFIRM_PRODUCTION_DEPLOY=true to authorize."
[[ -z "$TARGET_TAG" || "$TARGET_TAG" =~ ^rollback-[0-9]{8}-[0-9]{6}$ ]] || die "Invalid rollback tag: $TARGET_TAG"

remote() { ssh -o StrictHostKeyChecking=yes -o ConnectTimeout=15 "$SSH_TARGET" "$@"; }

wait_public_ok() {
  local code="" elapsed=0
  while (( elapsed < 180 )); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$PUBLIC_URL" || true)
    [[ "$code" == "200" ]] && { echo "[dashboard-deploy] $PUBLIC_URL -> 200"; return 0; }
    sleep 5; elapsed=$((elapsed + 5))
  done
  echo "[dashboard-deploy][error] $PUBLIC_URL answered $code" >&2
  return 1
}

if [[ "$MODE" == "rollback" ]]; then
  tag="$TARGET_TAG"
  if [[ -z "$tag" ]]; then
    tag=$(remote "docker images leaf-dashboard --format '{{.Tag}}' | grep -E '^rollback-[0-9]{8}-[0-9]{6}\$' | sort -r | head -1")
  fi
  [[ -n "$tag" ]] || die "No leaf-dashboard:rollback-* image on the host."
  echo "[dashboard-deploy] Rolling back to leaf-dashboard:$tag"
  if [[ "$DRY_RUN" == "true" ]]; then echo "[dashboard-deploy] Dry run: nothing was changed."; exit 0; fi
  remote "set -e; cd '$REMOTE_DIR'
    docker image inspect 'leaf-dashboard:$tag' >/dev/null
    docker tag leaf-dashboard:contabo 'leaf-dashboard:replaced-$(date +%Y%m%d-%H%M%S)'
    docker tag 'leaf-dashboard:$tag' leaf-dashboard:contabo
    $COMPOSE up -d --no-build leaf-dashboard"
  wait_public_ok
  echo "[dashboard-deploy] Rollback done: leaf-dashboard:$tag is live."
  exit 0
fi

[[ -z "$(git -C "$REPO_ROOT" status --porcelain)" ]] || die "Worktree has uncommitted changes."
[[ "$(git -C "$REPO_ROOT" branch --show-current)" == "main" ]] || die "Production deploy must run from main."
head_sha=$(git -C "$REPO_ROOT" rev-parse HEAD)
[[ "$head_sha" == "$(git -C "$REPO_ROOT" rev-parse refs/remotes/origin/main)" ]] || die "HEAD must match origin/main."
[[ "$PRODUCTION_RELEASE_SHA" == "$head_sha" ]] || die "PRODUCTION_RELEASE_SHA must exactly match HEAD ($head_sha)."

stamp=$(date +%Y%m%d-%H%M%S)
staging=$(mktemp -d)
trap 'rm -rf -- "$staging"' EXIT
git -C "$REPO_ROOT" archive --format=tar "$head_sha:leaf-dashboard-js" | tar -xf - -C "$staging"
test -f "$staging/package.json"

RSYNC_ARGS=(-rc --itemize-changes --no-owner --no-group --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r
  --exclude .env.production.local --exclude 'backups/' --exclude 'node_modules/' --exclude '.next/' --exclude '.git/'
  -e "ssh -o StrictHostKeyChecking=yes -o ConnectTimeout=15")

echo "[dashboard-deploy] Release $head_sha -> $SSH_TARGET:$REMOTE_DIR"
changes=$(rsync "${RSYNC_ARGS[@]}" --dry-run "$staging/" "$SSH_TARGET:$REMOTE_DIR/" | grep -E '^[<>c]f' || true)
if [[ -z "$changes" ]]; then
  echo "[dashboard-deploy] No dashboard file changed; nothing to deploy."
  exit 0
fi
printf '%s\n' "$changes"
if [[ "$DRY_RUN" == "true" ]]; then echo "[dashboard-deploy] Dry run: nothing was changed."; exit 0; fi

remote "set -e; cd '$REMOTE_DIR'; test -f .env.production.local
  docker image inspect leaf-dashboard:contabo >/dev/null
  docker tag leaf-dashboard:contabo 'leaf-dashboard:rollback-$stamp'"
echo "[dashboard-deploy] Rollback image: leaf-dashboard:rollback-$stamp"

restore() {
  echo "[dashboard-deploy][rollback] Restoring leaf-dashboard:rollback-$stamp" >&2
  remote "set -e; cd '$REMOTE_DIR'
    docker tag 'leaf-dashboard:rollback-$stamp' leaf-dashboard:contabo
    $COMPOSE up -d --no-build leaf-dashboard" >&2 || echo "[dashboard-deploy][rollback][error] restore failed" >&2
}

rsync "${RSYNC_ARGS[@]}" --backup --backup-dir="$REMOTE_DIR/backups/$stamp" "$staging/" "$SSH_TARGET:$REMOTE_DIR/" >/dev/null
if ! remote "set -e; cd '$REMOTE_DIR'; $COMPOSE build leaf-dashboard && $COMPOSE up -d leaf-dashboard"; then
  restore; die "Build or start failed; previous image restored."
fi
if ! wait_public_ok; then
  restore; wait_public_ok || true; die "Public check failed; previous image restored."
fi
echo "[dashboard-deploy] Deploy done: $head_sha live. Rollback: CONFIRM_PRODUCTION_DEPLOY=true bash $0 rollback rollback-$stamp"
