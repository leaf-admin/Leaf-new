#!/usr/bin/env bash
# (Re)starts the local gateway (3101) and the dedicated queue worker (3102)
# against the isolated stack. Logs go to $LEAF_LOADTEST_LOG_DIR.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."
: "${LEAF_LOADTEST_LOG_DIR:?set LEAF_LOADTEST_LOG_DIR}"
. scripts/stress-test/local-isolated/env.sh
node scripts/stress-test/local-isolated/assert-isolated.cjs
# Only processes started from this backend directory are stopped.
for pid in $(pgrep -f "node (server.js|workers/queue-worker-process.js|workers/listener-worker.js)" || true); do
  if [[ "$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')" == "$PWD" ]]; then kill "$pid" || true; fi
done
# Also anything from this backend still holding the stack ports (e.g. a gateway
# started from another directory, like a profiling run).
for port in 3101 3102 3103; do
  for pid in $(lsof -nP -tiTCP:$port -sTCP:LISTEN 2>/dev/null || true); do
    if ps -o command= -p "$pid" | grep -q "leaf-websocket-backend\|server.js\|workers/"; then kill "$pid" || true; fi
  done
done
sleep 2
for port in 3101 3102 3103; do
  for pid in $(lsof -nP -tiTCP:$port -sTCP:LISTEN 2>/dev/null || true); do
    if ps -o command= -p "$pid" | grep -q "leaf-websocket-backend\|server.js\|workers/"; then kill -9 "$pid" 2>/dev/null || true; fi
  done
done
sleep 1
if lsof -nP -iTCP:3101 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[isolated-stack] port 3101 still busy; refusing to start a second gateway" >&2
  exit 1
fi
# Fresh log files each time (a dying process may still write to the old ones).
for name in gateway queue-worker sideeffects-worker; do rm -f "$LEAF_LOADTEST_LOG_DIR/$name.log"; done
RUNTIME_ROLE=gateway nohup node server.js > "$LEAF_LOADTEST_LOG_DIR/gateway.log" 2>&1 &
RUNTIME_ROLE=queue PORT=3102 nohup node workers/queue-worker-process.js > "$LEAF_LOADTEST_LOG_DIR/queue-worker.log" 2>&1 &
RUNTIME_ROLE=sideeffects PORT=3103 nohup node workers/listener-worker.js > "$LEAF_LOADTEST_LOG_DIR/sideeffects-worker.log" 2>&1 &
for _ in $(seq 1 60); do
  curl -sf -m 2 "http://127.0.0.1:${PORT:-3101}/health/liveness" >/dev/null && { echo "[isolated-stack] gateway up on ${PORT:-3101}"; exit 0; }
  sleep 1
done
echo "[isolated-stack] gateway did not start; see $LEAF_LOADTEST_LOG_DIR/gateway.log" >&2
exit 1
