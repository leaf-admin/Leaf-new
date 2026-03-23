#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/source-local-build-env.sh"

MODE="${1:-debug}"

ensure_android_native() {
  if [[ -d "${PROJECT_DIR}/android" ]]; then
    return
  fi
  echo "➡️  Diretório android ausente, executando prebuild..."
  (cd "${PROJECT_DIR}" && npx expo prebuild --platform android)
}

ensure_local_properties() {
  local file="${PROJECT_DIR}/android/local.properties"
  cat > "${file}" <<EOF
sdk.dir=${ANDROID_SDK_ROOT}
EOF
}

run_gradle() {
  local task="$1"
  local -a tasks=("generateCodegenArtifactsFromSchema" "${task}")
  if [[ "${ANDROID_BUILD_CLEAN:-0}" == "1" ]]; then
    tasks=("clean" "${tasks[@]}")
  fi
  (cd "${PROJECT_DIR}/android" && ./gradlew "${tasks[@]}" --no-daemon)
}

show_artifact_path() {
  case "${MODE}" in
    debug)
      echo "✅ APK debug: ${PROJECT_DIR}/android/app/build/outputs/apk/debug/app-debug.apk"
      ;;
    release)
      echo "✅ APK release: ${PROJECT_DIR}/android/app/build/outputs/apk/release/app-release.apk"
      ;;
    aab)
      echo "✅ AAB release: ${PROJECT_DIR}/android/app/build/outputs/bundle/release/app-release.aab"
      ;;
  esac
}

main() {
  echo "══════════════════════════════════════════════════════"
  echo "   Build Android Local (${MODE})"
  echo "══════════════════════════════════════════════════════"

  ensure_android_native
  ensure_local_properties

  case "${MODE}" in
    debug) run_gradle "assembleDebug" ;;
    release) run_gradle "assembleRelease" ;;
    aab) run_gradle "bundleRelease" ;;
    *) echo "❌ Modo inválido: ${MODE}. Use debug|release|aab"; exit 1 ;;
  esac

  show_artifact_path
}

main "$@"
