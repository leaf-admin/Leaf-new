#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile-app"
BACKEND_DIR="$ROOT_DIR/leaf-websocket-backend"

BACKEND_URL="${BACKEND_URL:-http://147.182.204.181:3001}"
APP_PACKAGE="${APP_PACKAGE:-br.com.leaf.ride}"
SEED_TEST_USERS="${SEED_TEST_USERS:-true}"

export PATH="$PATH:$HOME/.maestro/bin"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARTIFACTS_DIR="$MOBILE_DIR/.maestro/results/e2e_vps_${TIMESTAMP}"
mkdir -p "$ARTIFACTS_DIR"

FLOWS=(
  ".maestro/flows/auth/01-login-customer-real.yaml"
  ".maestro/flows/rides/01-request-ride-real.yaml"
)

echo "[e2e] artifacts: $ARTIFACTS_DIR"
echo "[e2e] backend: $BACKEND_URL"

check_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[e2e][error] Missing command: $1"
    exit 1
  fi
}

check_cmd adb
check_cmd curl
check_cmd maestro

if ! adb get-state >/dev/null 2>&1; then
  echo "[e2e][error] No Android device connected via adb."
  exit 1
fi

if ! adb shell pm list packages | grep -q "$APP_PACKAGE"; then
  echo "[e2e][error] App package not installed: $APP_PACKAGE"
  exit 1
fi

if ! curl -sS --max-time 12 "$BACKEND_URL/health" > "$ARTIFACTS_DIR/backend-health.json"; then
  echo "[e2e][error] Backend health endpoint unreachable."
  exit 1
fi

if ! curl -sS --max-time 12 "$BACKEND_URL/socket.io/?EIO=4&transport=polling" > "$ARTIFACTS_DIR/backend-socketio-handshake.txt"; then
  echo "[e2e][error] Backend Socket.IO polling handshake failed."
  exit 1
fi

if [[ "$SEED_TEST_USERS" == "true" ]]; then
  if [[ -f "$BACKEND_DIR/scripts/criar-usuarios-teste-completo.js" ]]; then
    echo "[e2e] Seeding test users in Firebase/RTDB..."
    (
      cd "$BACKEND_DIR"
      node scripts/criar-usuarios-teste-completo.js > "$ARTIFACTS_DIR/seed-test-users.log" 2>&1
    ) || {
      echo "[e2e][warn] Could not seed test users automatically. See $ARTIFACTS_DIR/seed-test-users.log"
    }
  else
    echo "[e2e][warn] Seed script not found, skipping test-user seed."
  fi
fi

PASS_COUNT=0
FAIL_COUNT=0

cd "$MOBILE_DIR"
for flow in "${FLOWS[@]}"; do
  flow_name="$(basename "$flow" .yaml)"
  junit="$ARTIFACTS_DIR/${flow_name}.xml"
  log="$ARTIFACTS_DIR/${flow_name}.log"

  echo "[e2e] Running flow: $flow"
  if maestro test "$flow" --format junit --output "$junit" > "$log" 2>&1; then
    echo "[e2e] PASS: $flow"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[e2e] FAIL: $flow"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

{
  echo "timestamp=$TIMESTAMP"
  echo "backend_url=$BACKEND_URL"
  echo "pass=$PASS_COUNT"
  echo "fail=$FAIL_COUNT"
} > "$ARTIFACTS_DIR/summary.txt"

echo "[e2e] Summary:"
cat "$ARTIFACTS_DIR/summary.txt"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "[e2e][error] One or more flows failed."
  exit 2
fi

echo "[e2e] All flows passed."
