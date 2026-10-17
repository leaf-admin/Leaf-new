#!/usr/bin/env bash
# Keep the Contabo cold standby on the release that Santiago runs.
#
# Copies the Santiago code tree to Contabo (no secrets, compose files, nginx
# configs or certificates), applies it to /opt/leaf-app and rebuilds the
# gateway and worker images. Nothing is started or restarted. The tree is
# small (~20 MB), so it is piped through the operator's two ssh sessions.
# deploy-santiago-docker.sh calls this after a successful rollout.
# See docs/operations/SANTIAGO_CUTOVER_RUNBOOK.md.
set -euo pipefail

SANTIAGO_SSH="${SANTIAGO_SSH:-leaf-scl-test}"
CONTABO_SSH="${CONTABO_SSH:-leaf-vps}"
RELEASE_LABEL="${1:-standby-$(date -u +%Y%m%dT%H%M%SZ)}"
STAGING_DIR=/root/standby-code
SERVICES="websocket websocket-gateway-2 websocket-gateway-3 websocket-gateway-4 queue-worker sideeffects-worker billing-worker trip-location-worker pricing-baseline-worker ride-health-monitor-worker"

EXCLUDES="--exclude=./node_modules --exclude=./logs --exclude=./backups --exclude=./certbot \
  --exclude=./ssl --exclude=./.env* --exclude=./firebase-credentials.json --exclude=./*adminsdk*.json \
  --exclude=./docker-compose*.yml --exclude=./nginx*.conf* --exclude=*.backup-* \
  --exclude=./coverage --exclude=./host-health"

echo "[standby] copying code tree Santiago -> Contabo"
ssh "$SANTIAGO_SSH" "cd /opt/leaf-app && tar cf - $EXCLUDES ." \
  | ssh "$CONTABO_SSH" "rm -rf $STAGING_DIR && mkdir -p $STAGING_DIR && tar xf - -C $STAGING_DIR && test -f $STAGING_DIR/server.js"

ssh "$CONTABO_SSH" "set -e
  rsync -a $STAGING_DIR/ /opt/leaf-app/
  rm -rf $STAGING_DIR
  cd /opt/leaf-app
  if docker ps --format '{{.Names}}' | grep -qx leaf-websocket; then
    echo '[standby][warn] Contabo is serving Leaf (failover active); only images are rebuilt'
  fi
  GIT_SHA='$RELEASE_LABEL' docker compose -p leaf-app -f docker-compose.yml -f docker-compose.gateway-scale.yml \
    -f docker-compose.ops-workers.yml build -q $SERVICES
  echo '[standby] images rebuilt ($RELEASE_LABEL); no containers started'"
