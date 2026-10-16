#!/usr/bin/env bash
set -euo pipefail

# Production rollout to the Santiago realtime host (primary since 2026-10-16).
# Same guarded rollout as deploy-contabo-docker.sh (backup, validation, one
# gateway at a time, workers, public smoke, automatic rollback), with the
# Santiago target: two gateways and the docker-compose.santiago.yml overlay.
# The host's .env sets LEAF_SANTIAGO_PRIMARY=true and COMPOSE_PROFILES=primary.
#
# Required: CONFIRM_PRODUCTION_DEPLOY=true PRODUCTION_RELEASE_SHA=<origin/main SHA>
# Everything else is passed through (DEPLOY_TRACKED_PATHS, UPDATE_WORKERS, ...).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export CONTABO_HOST="${SANTIAGO_HOST:-64.176.9.163}"
export CONTABO_KEY="${SANTIAGO_KEY:-$HOME/.ssh/leaf_vultr_sp_test_ed25519}"
export REMOTE_BASE_COMPOSE="${REMOTE_BASE_COMPOSE:-docker-compose.yml}"
export REMOTE_EXTRA_COMPOSE="docker-compose.santiago.yml"
export GATEWAY_SERVICES="websocket-gateway-2"

exec bash "$SCRIPT_DIR/deploy-contabo-docker.sh" "$@"
