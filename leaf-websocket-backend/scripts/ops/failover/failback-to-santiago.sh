#!/usr/bin/env bash
# Drill: return the realtime stack from Contabo to Santiago.
# Run from an operator machine with the ssh aliases leaf-scl-test (Santiago)
# and leaf-vps (Contabo). DNS is not touched; see SANTIAGO_CUTOVER_RUNBOOK.md.
set -euo pipefail
t0=$(date +%s); mark() { echo "[+$(( $(date +%s) - t0 ))s] $*"; }
ssh leaf-vps 'docker stop leaf-websocket leaf-websocket-gateway-2 leaf-websocket-gateway-3 leaf-websocket-gateway-4 leaf-queue-worker leaf-sideeffects-worker leaf-billing-worker leaf-trip-location-worker leaf-pricing-baseline-worker leaf-ride-health-monitor-worker >/dev/null'; mark "contabo app services stopped"
ssh leaf-scl-test 'R(){ docker exec leaf-redis sh -c "REDISCLI_AUTH=\$REDIS_PASSWORD redis-cli $*"; }
  P=$(docker exec leaf-redis sh -c "REDISCLI_AUTH=\$REDIS_PASSWORD redis-cli CONFIG GET requirepass" | tail -1)
  docker exec leaf-redis sh -c "REDISCLI_AUTH=\$REDIS_PASSWORD redis-cli CONFIG SET masterauth \"$P\"" >/dev/null
  R REPLICAOF 10.77.0.2 6379 >/dev/null
  for i in $(seq 1 60); do R INFO replication | grep -q "master_link_status:up" && break; sleep 1; done
  for i in $(seq 1 30); do a=$(R INFO replication | tr -d "\r" | awk -F: "/^slave_repl_offset/{print \$2}"); b=$(R INFO replication | tr -d "\r" | awk -F: "/^master_repl_offset/{print \$2}"); [ "$a" = "$b" ] && break; sleep 1; done
  R REPLICAOF NO ONE >/dev/null; R INFO replication | tr -d "\r" | grep "^role"; R DBSIZE'; mark "santiago redis synced from contabo and promoted"
ssh leaf-scl-test 'cd /opt/leaf-app && C="docker compose -p leaf-app -f docker-compose.yml -f docker-compose.gateway-scale.yml -f docker-compose.ops-workers.yml -f docker-compose.santiago.yml" && $C up -d --no-build >/dev/null 2>&1
  for i in $(seq 1 120); do n=$(docker ps --format "{{.Names}} {{.Status}}" | grep -E "^leaf-(websocket|websocket-gateway-2|queue-worker|sideeffects-worker|billing-worker|trip-location-worker|pricing-baseline-worker|ride-health-monitor-worker) " | grep -c "(healthy)"); [ "$n" -ge 8 ] && break; sleep 2; done; echo "healthy=$n/8"; docker restart leaf-nginx >/dev/null'; mark "santiago stack healthy"
ssh leaf-vps 'cd /opt/leaf-app && cp nginx.multi-gateway.forward-to-santiago.conf.health nginx.multi-gateway.conf 2>/dev/null || true; docker exec leaf-nginx nginx -t >/dev/null 2>&1 && docker exec leaf-nginx nginx -s reload >/dev/null 2>&1; echo nginx-ok'; mark "contabo nginx -> forward"
ssh leaf-vps 'R(){ docker exec leaf-redis sh -c "REDISCLI_AUTH=\$REDIS_PASSWORD redis-cli $*"; }; R REPLICAOF 10.77.0.1 6379 >/dev/null; for i in $(seq 1 60); do R INFO replication | grep -q "master_link_status:up" && break; sleep 1; done; R INFO replication | tr -d "\r" | grep -E "^role|master_link_status"'; mark "contabo redis is replica again"
code=$(curl -s -o /dev/null -w "%{http_code}" https://api.leaf.app.br/health); mark "public https (DNS -> santiago): $code"
