#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile-app"
BACKEND_DIR="$ROOT_DIR/leaf-websocket-backend"

BACKEND_URL="${BACKEND_URL:-http://147.182.204.181:3001}"
APP_PACKAGE="${APP_PACKAGE:-br.com.leaf.ride}"
SEED_TEST_USERS="${SEED_TEST_USERS:-true}"
OPEN_APP="${OPEN_APP:-false}"
REQUIRE_EXPO="${REQUIRE_EXPO:-true}"

TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
ARTIFACTS_DIR="$MOBILE_DIR/test-results/qa_run_${TIMESTAMP}"
mkdir -p "$ARTIFACTS_DIR"

LOGCAT_FILE="$ARTIFACTS_DIR/android-logcat.txt"
SIM_LOG="$ARTIFACTS_DIR/simulated-ride.log"
SIM_JSON="$ARTIFACTS_DIR/simulated-ride.json"

cleanup() {
  if [[ -n "${LOGCAT_PID:-}" ]] && kill -0 "$LOGCAT_PID" >/dev/null 2>&1; then
    kill "$LOGCAT_PID" >/dev/null 2>&1 || true
    wait "$LOGCAT_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

check_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[qa][error] Missing command: $1"
    exit 1
  fi
}

check_cmd adb
check_cmd curl
check_cmd node

if ! adb get-state >/dev/null 2>&1; then
  echo "[qa][error] No Android device connected via adb."
  exit 1
fi

if ! adb shell pm list packages | grep -q "$APP_PACKAGE"; then
  echo "[qa][error] App package not installed: $APP_PACKAGE"
  exit 1
fi

echo "[qa] artifacts: $ARTIFACTS_DIR"
echo "[qa] backend: $BACKEND_URL"

adb devices > "$ARTIFACTS_DIR/adb-devices.txt"
adb shell getprop ro.product.model > "$ARTIFACTS_DIR/device-model.txt" || true
adb shell getprop ro.build.version.release > "$ARTIFACTS_DIR/android-version.txt" || true

if [[ "$REQUIRE_EXPO" == "true" ]]; then
  if ! curl -fsS --max-time 3 "http://127.0.0.1:8081/status" >/dev/null 2>&1; then
    echo "[qa][error] Expo dev server não está rodando."
    echo "[qa][hint] Rode primeiro: npm run android"
    exit 1
  fi
fi

if [[ "$OPEN_APP" == "true" ]]; then
  adb shell am force-stop "$APP_PACKAGE" >/dev/null 2>&1 || true
  adb shell am start -n "$APP_PACKAGE/.MainActivity" >/dev/null 2>&1 \
    || adb shell monkey -p "$APP_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
fi

adb logcat -c >/dev/null 2>&1 || true
adb logcat -v time > "$LOGCAT_FILE" 2>&1 &
LOGCAT_PID=$!

echo "[qa] running backend checks..."
curl -sS --max-time 12 "$BACKEND_URL/health" > "$ARTIFACTS_DIR/backend-health.json"
node - "$BACKEND_URL" "$ARTIFACTS_DIR/backend-socketio-handshake.json" <<'NODE'
const fs = require('fs');
const io = require('socket.io-client');
const [,, backendUrl, out] = process.argv;

const socket = io(backendUrl, {
  transports: ['websocket', 'polling'],
  timeout: 10000,
  reconnection: false,
  forceNew: true
});

let done = false;
const finish = (payload, code) => {
  if (done) return;
  done = true;
  try { socket.disconnect(); } catch (_) {}
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  process.exit(code);
};

socket.on('connect', () => finish({ ok: true, transport: socket.io.engine.transport.name }, 0));
socket.on('connect_error', (e) => finish({ ok: false, error: e?.message || 'connect_error' }, 1));
setTimeout(() => finish({ ok: false, error: 'timeout' }, 1), 12000);
NODE

if [[ "$SEED_TEST_USERS" == "true" ]] && [[ -f "$BACKEND_DIR/scripts/criar-usuarios-teste-completo.js" ]]; then
  echo "[qa] seeding test users..."
  (
    cd "$BACKEND_DIR"
    node scripts/criar-usuarios-teste-completo.js > "$ARTIFACTS_DIR/seed-test-users.log" 2>&1
  ) || {
    echo "[qa][warn] seed script failed, continuing"
  }
fi

echo "[qa] running websocket ride simulation (real test users)..."
(
  cd "$MOBILE_DIR"
  node scripts/qa-simulate-ride-flow.cjs \
    --url "$BACKEND_URL" \
    --out "$SIM_JSON"
) > "$SIM_LOG" 2>&1 || true

cleanup

bash "$MOBILE_DIR/scripts/qa-asserts.sh" "$ARTIFACTS_DIR"

echo "[qa] done. report: $ARTIFACTS_DIR/qa-report.md"
