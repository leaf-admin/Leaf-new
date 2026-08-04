#!/bin/sh

set -eu

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.contingency-secondary.yml}"

fail() {
    echo "FAIL: $*" >&2
    exit 1
}

docker compose -f "$COMPOSE_FILE" ps --status running >/dev/null

[ "$(cat /proc/sys/vm/overcommit_memory)" = "1" ] \
    || fail "vm.overcommit_memory must be 1 for Redis persistence safety"

running_services="$(docker compose -f "$COMPOSE_FILE" ps --services --status running)"
for service in redis-primary-tunnel redis-replica edge-canary; do
    printf '%s\n' "$running_services" | grep -qx "$service" || fail "$service is not running"
done

edge_status="$(curl -fsS --max-time 5 http://127.0.0.1:18080/contingency-health)"
[ "$edge_status" = "ok" ] || fail "edge canary local health failed"

curl -fsS --max-time 10 -H 'Host: api.leaf.app.br' \
    http://127.0.0.1:18080/health/liveness >/dev/null \
    || fail "primary backend is not reachable through the contingency edge"

replication_info="$(docker compose -f "$COMPOSE_FILE" exec -T redis-replica sh -eu -c \
    'REDISCLI_AUTH="$(cat /run/leaf/redis_password)" redis-cli --no-auth-warning INFO replication')"

printf '%s\n' "$replication_info" | grep -q '^role:slave' \
    || fail "Redis node is not configured as a replica"
printf '%s\n' "$replication_info" | grep -q '^master_link_status:up' \
    || fail "Redis replica is not connected to the primary"
printf '%s\n' "$replication_info" | grep -q '^master_sync_in_progress:0' \
    || fail "Redis replica synchronization is still in progress"

master_last_io="$(printf '%s\n' "$replication_info" | sed -n 's/^master_last_io_seconds_ago:\([0-9][0-9]*\).*/\1/p')"
[ -n "$master_last_io" ] || fail "Redis replication lag could not be read"
[ "$master_last_io" -le 15 ] || fail "Redis replication heartbeat is stale (${master_last_io}s)"

echo "PASS: secondary contingency tunnel, edge and Redis replica are healthy"
