#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile-app"
BACKEND_DIR="$ROOT_DIR/leaf-websocket-backend"

BACKEND_URL="${BACKEND_URL:-https://api.leaf.app.br}"
APP_PACKAGE="${APP_PACKAGE:-br.com.leaf.ride}"
SEED_TEST_USERS="${SEED_TEST_USERS:-true}"
OPEN_APP="${OPEN_APP:-false}"
CHECK_RUNTIME_ENDPOINTS="${CHECK_RUNTIME_ENDPOINTS:-true}"
REQUIRE_EXPO="${REQUIRE_EXPO:-false}"
NODE_BIN="${NODE_BIN:-$(command -v node || command -v nodejs || true)}"
ADB_BIN="${ADB_BIN:-$(command -v adb || true)}"
FIREBASE_API_KEY="${FIREBASE_API_KEY:-${EXPO_PUBLIC_FIREBASE_API_KEY:-}}"

if [[ -z "$NODE_BIN" ]]; then
  for candidate in \
    $(ls -1d "$HOME/.nvm/versions/node"/*/bin/node 2>/dev/null | sort -Vr) \
    "/opt/homebrew/bin/node" \
    "/usr/local/bin/node"; do
    if [[ -x "$candidate" ]]; then
      NODE_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$ADB_BIN" ]]; then
  for candidate in \
    "$ROOT_DIR/platform-tools/adb" \
    "$ROOT_DIR/android-sdk/platform-tools/adb" \
    "$HOME/Library/Android/sdk/platform-tools/adb" \
    "$HOME/Android/Sdk/platform-tools/adb"; do
    if [[ -x "$candidate" ]]; then
      ADB_BIN="$candidate"
      break
    fi
  done
fi

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

check_cmd curl

if [[ -z "$NODE_BIN" ]]; then
  echo "[qa][error] Missing command: node (or nodejs)"
  exit 1
fi

if [[ -z "$ADB_BIN" ]]; then
  echo "[qa][error] Missing command: adb (or ADB_BIN path)"
  exit 1
fi

if [[ "$CHECK_RUNTIME_ENDPOINTS" == "true" ]]; then
  echo "[qa] checking runtime endpoint hardcodes..."
  bash "$MOBILE_DIR/scripts/check-runtime-endpoints.sh"
fi

if [[ -z "$FIREBASE_API_KEY" ]] && [[ -f "$MOBILE_DIR/google-services.json" ]]; then
  FIREBASE_API_KEY="$(grep -m1 -Eo '"current_key"[[:space:]]*:[[:space:]]*"[^"]+"' "$MOBILE_DIR/google-services.json" | sed -E 's/.*"current_key"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
fi

if [[ -z "$FIREBASE_API_KEY" ]] && [[ -f "$MOBILE_DIR/google-services.example.json" ]]; then
  FIREBASE_API_KEY="$(grep -m1 -Eo '"current_key"[[:space:]]*:[[:space:]]*"[^"]+"' "$MOBILE_DIR/google-services.example.json" | sed -E 's/.*"current_key"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/' || true)"
fi

if [[ -n "$FIREBASE_API_KEY" ]]; then
  export FIREBASE_API_KEY
  export EXPO_PUBLIC_FIREBASE_API_KEY="$FIREBASE_API_KEY"
else
  echo "[qa][warn] Firebase API key ausente; simulação de corrida pode falhar em autenticação."
fi

if ! "$ADB_BIN" get-state >/dev/null 2>&1; then
  echo "[qa][error] No Android device connected via adb."
  exit 1
fi

if ! "$ADB_BIN" shell pm list packages | grep -q "$APP_PACKAGE"; then
  echo "[qa][error] App package not installed: $APP_PACKAGE"
  exit 1
fi

echo "[qa] artifacts: $ARTIFACTS_DIR"
echo "[qa] backend: $BACKEND_URL"

"$ADB_BIN" devices > "$ARTIFACTS_DIR/adb-devices.txt"
"$ADB_BIN" shell getprop ro.product.model > "$ARTIFACTS_DIR/device-model.txt" || true
"$ADB_BIN" shell getprop ro.build.version.release > "$ARTIFACTS_DIR/android-version.txt" || true

if [[ "$REQUIRE_EXPO" == "true" ]]; then
  if ! curl -fsS --max-time 3 "http://127.0.0.1:8081/status" >/dev/null 2>&1; then
    echo "[qa][error] Expo dev server não está rodando."
    echo "[qa][hint] Rode primeiro: npm run android"
    exit 1
  fi
fi

if [[ "$OPEN_APP" == "true" ]]; then
  "$ADB_BIN" shell am force-stop "$APP_PACKAGE" >/dev/null 2>&1 || true
  "$ADB_BIN" shell am start -n "$APP_PACKAGE/.MainActivity" >/dev/null 2>&1 \
    || "$ADB_BIN" shell monkey -p "$APP_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
fi

"$ADB_BIN" logcat -c >/dev/null 2>&1 || true
"$ADB_BIN" logcat -v time > "$LOGCAT_FILE" 2>&1 &
LOGCAT_PID=$!

echo "[qa] running backend checks..."
curl -sS --max-time 12 "$BACKEND_URL/health" > "$ARTIFACTS_DIR/backend-health.json"
"$NODE_BIN" - "$BACKEND_URL" "$ARTIFACTS_DIR/backend-socketio-handshake.json" <<'NODE'
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
    "$NODE_BIN" scripts/criar-usuarios-teste-completo.js > "$ARTIFACTS_DIR/seed-test-users.log" 2>&1
  ) || {
    echo "[qa][warn] seed script failed, continuing"
  }
fi

echo "[qa] running websocket ride simulation (real test users)..."
(
  cd "$MOBILE_DIR"
  "$NODE_BIN" scripts/qa-simulate-ride-flow.cjs \
    --url "$BACKEND_URL" \
    --out "$SIM_JSON"
) > "$SIM_LOG" 2>&1 || true

cleanup

bash "$MOBILE_DIR/scripts/qa-asserts.sh" "$ARTIFACTS_DIR"

echo "[qa] done. report: $ARTIFACTS_DIR/qa-report.md"
