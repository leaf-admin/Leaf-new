#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
MOBILE_DIR="$ROOT_DIR/mobile-app"
BACKEND_DIR="$ROOT_DIR/leaf-websocket-backend"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/source-local-build-env.sh"

BACKEND_URL="${BACKEND_URL:-https://api.leaf.app.br}"
APP_PACKAGE="${APP_PACKAGE:-br.com.leaf.ride}"
SEED_TEST_USERS="${SEED_TEST_USERS:-true}"
ADB_BIN="${ADB_BIN:-$(command -v adb || true)}"
ANDROID_SERIAL_ENV="${ANDROID_SERIAL:-}"
MAESTRO_MIN_VERSION="${MAESTRO_MIN_VERSION:-2.5.0}"
MAESTRO_DRIVER_STARTUP_TIMEOUT="${MAESTRO_DRIVER_STARTUP_TIMEOUT:-60000}"
MAESTRO_FLOW_RETRIES="${MAESTRO_FLOW_RETRIES:-2}"
ANDROID_BOOT_TIMEOUT_SECONDS="${ANDROID_BOOT_TIMEOUT_SECONDS:-240}"
ANDROID_START_EMULATOR_IF_MISSING="${ANDROID_START_EMULATOR_IF_MISSING:-true}"
ANDROID_AVD_NAME="${ANDROID_AVD_NAME:-Leaf_API_35}"

export PATH="$PATH:$HOME/.maestro/bin"
export MAESTRO_DRIVER_STARTUP_TIMEOUT

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
ARTIFACTS_DIR="$MOBILE_DIR/.maestro/results/stable_guarded_${TIMESTAMP}"
mkdir -p "$ARTIFACTS_DIR"

FLOWS=(
  ".maestro/flows/auth/01-login-customer-real.yaml"
  ".maestro/flows/rides/01-request-ride-real.yaml"
)

check_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[stable][error] Missing command: $1"
    exit 1
  fi
}

sanitize_semver() {
  local raw="$1"
  raw="${raw#v}"
  raw="${raw%%-*}"
  printf "%s" "$raw"
}

semver_ge() {
  local current target i
  current="$(sanitize_semver "$1")"
  target="$(sanitize_semver "$2")"

  local current_parts=(0 0 0)
  local target_parts=(0 0 0)
  IFS='.' read -r -a current_parts <<<"$current"
  IFS='.' read -r -a target_parts <<<"$target"

  for i in 0 1 2; do
    local c="${current_parts[$i]:-0}"
    local t="${target_parts[$i]:-0}"
    c="${c//[^0-9]/}"
    t="${t//[^0-9]/}"
    c="${c:-0}"
    t="${t:-0}"
    if ((c > t)); then
      return 0
    fi
    if ((c < t)); then
      return 1
    fi
  done
  return 0
}

assert_maestro_version() {
  local current
  current="$(maestro --version 2>/dev/null | head -n1 | tr -d '\r' | tr -d '\n')"
  if [[ -z "$current" ]]; then
    echo "[stable][error] Could not detect Maestro version."
    exit 1
  fi

  if ! semver_ge "$current" "$MAESTRO_MIN_VERSION"; then
    echo "[stable][error] Maestro ${current} is too old for stable Android smoke."
    echo "[stable][error] Required version: >= ${MAESTRO_MIN_VERSION}"
    echo "[stable][hint] Upgrade command: curl -Ls \"https://get.maestro.mobile.dev\" | bash"
    exit 1
  fi

  echo "[stable] maestro_version: ${current}"
}

wait_for_android_boot() {
  local serial="$1"
  local elapsed=0

  "$ADB_BIN" -s "$serial" wait-for-device >/dev/null 2>&1

  while ((elapsed < ANDROID_BOOT_TIMEOUT_SECONDS)); do
    local boot_completed
    boot_completed="$("$ADB_BIN" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' | tr -d '\n' || true)"
    if [[ "$boot_completed" == "1" ]]; then
      "$ADB_BIN" -s "$serial" shell input keyevent 82 >/dev/null 2>&1 || true
      "$ADB_BIN" -s "$serial" shell wm dismiss-keyguard >/dev/null 2>&1 || true
      return 0
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  return 1
}

disable_android_animations() {
  local serial="$1"
  "$ADB_BIN" -s "$serial" shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$serial" shell settings put global transition_animation_scale 0 >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$serial" shell settings put global animator_duration_scale 0 >/dev/null 2>&1 || true
}

start_android_emulator_if_needed() {
  local devices
  devices="$("$ADB_BIN" devices | awk 'NR>1 && $2=="device" {print $1}')"
  if [[ -n "$devices" ]]; then
    return 0
  fi

  if [[ "$ANDROID_START_EMULATOR_IF_MISSING" != "true" ]]; then
    return 0
  fi

  check_cmd emulator

  if ! emulator -list-avds | grep -qx "$ANDROID_AVD_NAME"; then
    echo "[stable][error] No Android device connected and AVD '${ANDROID_AVD_NAME}' not found."
    echo "[stable][hint] Set ANDROID_AVD_NAME or start an emulator manually."
    exit 1
  fi

  local emulator_log="${ARTIFACTS_DIR}/android-emulator.log"
  echo "[stable] Starting Android emulator AVD=${ANDROID_AVD_NAME}"
  nohup emulator -avd "$ANDROID_AVD_NAME" -no-snapshot-load -no-snapshot-save -no-boot-anim > "$emulator_log" 2>&1 &

  local elapsed=0
  while ((elapsed < ANDROID_BOOT_TIMEOUT_SECONDS)); do
    ANDROID_SERIAL_ENV="$("$ADB_BIN" devices | awk 'NR>1 && $1 ~ /^emulator-/ && $2=="device" {print $1; exit}')"
    if [[ -n "$ANDROID_SERIAL_ENV" ]]; then
      if wait_for_android_boot "$ANDROID_SERIAL_ENV"; then
        disable_android_animations "$ANDROID_SERIAL_ENV"
        echo "[stable] emulator_serial: $ANDROID_SERIAL_ENV"
        return 0
      fi
    fi
    sleep 2
    elapsed=$((elapsed + 2))
  done

  echo "[stable][error] Emulator did not boot in ${ANDROID_BOOT_TIMEOUT_SECONDS}s. See $emulator_log"
  exit 1
}

resolve_android_serial() {
  if [[ -z "$ANDROID_SERIAL_ENV" ]]; then
    ANDROID_SERIAL_ENV="$("$ADB_BIN" devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
  fi

  if [[ -z "$ANDROID_SERIAL_ENV" ]]; then
    start_android_emulator_if_needed
  fi

  if [[ -z "$ANDROID_SERIAL_ENV" ]]; then
    ANDROID_SERIAL_ENV="$("$ADB_BIN" devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
  fi

  if [[ -z "$ANDROID_SERIAL_ENV" ]]; then
    echo "[stable][error] Could not resolve ANDROID_SERIAL from connected adb devices."
    exit 1
  fi
}

kill_stale_maestro_processes() {
  pkill -f "maestro.cli.AppKt test" >/dev/null 2>&1 || true
}

recover_android_transport() {
  local flow="$1"
  echo "[stable][warn] Recovering Android transport for flow: $flow"
  kill_stale_maestro_processes
  "$ADB_BIN" kill-server >/dev/null 2>&1 || true
  sleep 1
  "$ADB_BIN" start-server >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$ANDROID_SERIAL" wait-for-device >/dev/null 2>&1 || true
  wait_for_android_boot "$ANDROID_SERIAL" || true
  disable_android_animations "$ANDROID_SERIAL"
  "$ADB_BIN" -s "$ANDROID_SERIAL" reverse --remove-all >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$ANDROID_SERIAL" forward --remove-all >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$ANDROID_SERIAL" shell am force-stop "$APP_PACKAGE" >/dev/null 2>&1 || true
  sleep 2
}

bring_leaf_foreground() {
  "$ADB_BIN" -s "$ANDROID_SERIAL" shell am force-stop com.google.android.apps.maps >/dev/null 2>&1 || true
  "$ADB_BIN" -s "$ANDROID_SERIAL" shell am start -W -n br.com.leaf.ride/.MainActivity >/dev/null 2>&1 \
    || "$ADB_BIN" -s "$ANDROID_SERIAL" shell monkey -p "$APP_PACKAGE" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
}

prepare_flow_runtime() {
  local flow_path="$1"

  if [[ "$flow_path" == *"/auth/"* ]]; then
    echo "[stable] Clearing app data before auth flow (MIUI-safe bootstrap)..."
    "$ADB_BIN" -s "$ANDROID_SERIAL" shell pm clear "$APP_PACKAGE" >/dev/null 2>&1 || true
    sleep 1
  fi

  disable_android_animations "$ANDROID_SERIAL"
  bring_leaf_foreground
  sleep 2
}

is_android_transport_failure() {
  local log_path="$1"
  if [[ ! -f "$log_path" ]]; then
    return 1
  fi
  rg -q "DEADLINE_EXCEEDED|UNAVAILABLE: io exception|driver did not start up in time|Unable to launch app|localhost/127\\.0\\.0\\.1:7001" "$log_path"
}

run_flow_with_retries() {
  local flow="$1"
  local junit="$2"
  local log="$3"
  local attempt=1
  local max_attempts="$MAESTRO_FLOW_RETRIES"

  while ((attempt <= max_attempts)); do
    echo "[stable] Running flow (attempt ${attempt}/${max_attempts}): $flow"
    prepare_flow_runtime "$flow"

    if maestro test "$flow" --format junit --output "$junit" --device "$ANDROID_SERIAL" > "$log" 2>&1; then
      echo "[stable] PASS: $flow"
      return 0
    fi

    echo "[stable][warn] Flow failed: $flow"
    if ((attempt < max_attempts)) && is_android_transport_failure "$log"; then
      recover_android_transport "$flow"
      attempt=$((attempt + 1))
      continue
    fi

    return 1
  done

  return 1
}

echo "[stable] artifacts: $ARTIFACTS_DIR"
echo "[stable] backend: $BACKEND_URL"

check_cmd curl
check_cmd maestro
check_cmd rg

assert_maestro_version

if [[ -z "$ADB_BIN" ]]; then
  echo "[stable][error] Missing command: adb (or ADB_BIN path)."
  exit 1
fi

"$ADB_BIN" start-server >/dev/null 2>&1 || true
resolve_android_serial

export ANDROID_SERIAL="$ANDROID_SERIAL_ENV"
echo "[stable] android_serial: $ANDROID_SERIAL"

if ! wait_for_android_boot "$ANDROID_SERIAL"; then
  echo "[stable][error] Android device did not finish boot in ${ANDROID_BOOT_TIMEOUT_SECONDS}s."
  exit 1
fi

disable_android_animations "$ANDROID_SERIAL"

if ! "$ADB_BIN" -s "$ANDROID_SERIAL" shell pm list packages | grep -q "$APP_PACKAGE"; then
  echo "[stable][error] App package not installed on $ANDROID_SERIAL: $APP_PACKAGE"
  exit 1
fi

if ! curl -sS --max-time 12 "$BACKEND_URL/health" > "$ARTIFACTS_DIR/backend-health.json"; then
  echo "[stable][error] Backend health endpoint unreachable."
  exit 1
fi

if ! curl -sS --max-time 12 "$BACKEND_URL/socket.io/?EIO=4&transport=polling" > "$ARTIFACTS_DIR/backend-socketio-handshake.txt"; then
  echo "[stable][error] Backend Socket.IO polling handshake failed."
  exit 1
fi

if ! bash "${SCRIPT_DIR}/qa/assert-backend-real-sandbox.sh" "$BACKEND_URL" "$ARTIFACTS_DIR/backend-runtime-flags.json"; then
  exit 1
fi

if [[ "$SEED_TEST_USERS" == "true" ]] && [[ -f "$BACKEND_DIR/scripts/criar-usuarios-teste-completo.js" ]]; then
  echo "[stable] Seeding test users in Firebase/RTDB..."
  (
    cd "$BACKEND_DIR"
    node scripts/criar-usuarios-teste-completo.js > "$ARTIFACTS_DIR/seed-test-users.log" 2>&1
  ) || {
    echo "[stable][warn] Could not seed test users automatically." | tee -a "$ARTIFACTS_DIR/_guard.log"
  }
fi

PASS_COUNT=0
FAIL_COUNT=0
cd "$MOBILE_DIR"

for flow in "${FLOWS[@]}"; do
  flow_name="$(basename "$flow" .yaml)"
  junit="$ARTIFACTS_DIR/${flow_name}.xml"
  log="$ARTIFACTS_DIR/${flow_name}.log"

  if run_flow_with_retries "$flow" "$junit" "$log"; then
    PASS_COUNT=$((PASS_COUNT + 1))
    printf "%s|PASS|ok\n" "$flow" >> "$ARTIFACTS_DIR/summary.tsv"
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    printf "%s|FAIL|maestro\n" "$flow" >> "$ARTIFACTS_DIR/summary.tsv"
  fi
done

{
  echo "timestamp=$TIMESTAMP"
  echo "backend_url=$BACKEND_URL"
  echo "pass=$PASS_COUNT"
  echo "fail=$FAIL_COUNT"
} > "$ARTIFACTS_DIR/totals.txt"

echo "[stable] Summary:"
cat "$ARTIFACTS_DIR/totals.txt"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  exit 2
fi
