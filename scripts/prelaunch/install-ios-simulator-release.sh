#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# shellcheck source=/dev/null
source "${ROOT_DIR}/mobile-app/scripts/source-local-build-env.sh"

APP_PATH="${IOS_RELEASE_APP_PATH:-${ROOT_DIR}/mobile-app/ios/build/Build/Products/Release-iphonesimulator/Leaf.app}"
IOS_APP_ID="${IOS_APP_ID:-br.com.leaf.ride}"
IOS_SIMULATOR_UDID="${IOS_SIMULATOR_UDID:-booted}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "[prelaunch][ios] app bundle nao encontrado: $APP_PATH"
  exit 1
fi

if ! command -v xcrun >/dev/null 2>&1; then
  echo "[prelaunch][ios] xcrun nao encontrado"
  exit 1
fi

if ! xcrun simctl help >/dev/null 2>&1; then
  echo "[prelaunch][ios] simctl indisponivel. Selecione o Xcode completo em xcode-select antes de instalar no simulador."
  exit 1
fi

xcrun simctl install "$IOS_SIMULATOR_UDID" "$APP_PATH"
xcrun simctl launch "$IOS_SIMULATOR_UDID" "$IOS_APP_ID"

echo "[prelaunch][ios] release instalado e aberto: $APP_PATH"
