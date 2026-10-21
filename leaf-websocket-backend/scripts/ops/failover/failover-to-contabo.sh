#!/usr/bin/env bash
# Drill: fail the realtime stack over from Santiago to Contabo (DNS untouched).
# Run from an operator machine with the ssh aliases leaf-scl-test (Santiago)
# and leaf-vps (Contabo). DNS is not touched; see SANTIAGO_CUTOVER_RUNBOOK.md.
set -euo pipefail
t0=$(date +%s); mark() { echo "[+$(( $(date +%s) - t0 ))s] $*"; }
APP="leaf-websocket leaf-websocket-gateway-2 leaf-queue-worker leaf-sideeffects-worker leaf-trip-location-worker leaf-billing-worker leaf-pricing-baseline-worker leaf-ride-health-monitor-worker"
ssh leaf-scl-test "docker stop $APP >/dev/null"; mark "santiago app services stopped"
ssh leaf-vps 'R(){ docker exec leaf-redis sh -c "REDISCLI_AUTH=\$REDIS_PASSWORD redis-cli $*"; }
  for i in $(seq 1 30); do a=$(R INFO replication | tr -d "\r" | awk -F: "/^slave_repl_offset/{print \$2}"); b=$(R INFO replication | tr -d "\r" | awk -F: "/^master_repl_offset/{print \$2}"); [ "$a" = "$b" ] && break; sleep 1; done
  R REPLICAOF NO ONE >/dev/null; R INFO replication | tr -d "\r" | grep "^role"
  # The compose reads REDIS_REPLICAOF; empty keeps Contabo a master if its Redis restarts.
  cd /opt/leaf-app && { grep -v "^REDIS_REPLICAOF=" .env; echo "REDIS_REPLICAOF="; } > .env.tmp && chmod --reference=.env .env.tmp && mv .env.tmp .env'; mark "contabo redis promoted"
ssh leaf-vps 'cd /opt/leaf-app && C="docker compose -p leaf-app -f docker-compose.yml -f docker-compose.gateway-scale.yml -f docker-compose.ops-workers.yml" && $C up -d --no-deps --no-build trip-location-worker websocket websocket-gateway-2 websocket-gateway-3 websocket-gateway-4 queue-worker sideeffects-worker billing-worker pricing-baseline-worker ride-health-monitor-worker >/dev/null 2>&1
  for i in $(seq 1 120); do n=$(docker ps --format "{{.Names}} {{.Status}}" | grep -E "^leaf-(websocket|websocket-gateway-[234]|queue-worker|sideeffects-worker|billing-worker|trip-location-worker|pricing-baseline-worker|ride-health-monitor-worker) " | grep -c "(healthy)"); [ "$n" -ge 10 ] && break; sleep 2; done; echo "healthy=$n/10"'; mark "contabo stack healthy"
ssh leaf-vps 'cd /opt/leaf-app && cp nginx.multi-gateway.local-gateways.conf nginx.multi-gateway.conf && docker exec leaf-nginx nginx -t >/dev/null 2>&1 && docker exec leaf-nginx nginx -s reload >/dev/null 2>&1 && echo reloaded'; mark "contabo nginx -> local gateways"
code=$(curl -s -o /dev/null -w "%{http_code}" --resolve api.leaf.app.br:443:62.169.31.231 https://api.leaf.app.br/health); mark "public https via contabo IP: $code"
