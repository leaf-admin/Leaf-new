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

sync_native_android_version() {
  local build_gradle_path="${PROJECT_DIR}/android/app/build.gradle"
  local expected_version_code
  local expected_version_name

  if [[ ! -f "${build_gradle_path}" ]]; then
    echo "❌ build.gradle nativo do Android não encontrado: ${build_gradle_path}"
    exit 1
  fi

  expected_version_code="$(node -e "console.log(require('./config/AppConfig').AppConfig.android_app_version)")"
  expected_version_name="$(node -e "console.log(require('./config/AppConfig').AppConfig.ios_app_version)")"
  if ! [[ "${expected_version_code}" =~ ^[0-9]+$ ]]; then
    echo "❌ android_app_version inválido no AppConfig: ${expected_version_code}"
    exit 1
  fi
  if [[ -z "${expected_version_name}" ]]; then
    echo "❌ ios_app_version inválido no AppConfig para versionName Android."
    exit 1
  fi

  perl -0pi -e "s/versionCode\\s+\\d+/versionCode ${expected_version_code}/" "${build_gradle_path}"
  perl -0pi -e "s/versionName\\s+\"[^\"]+\"/versionName \"${expected_version_name}\"/" "${build_gradle_path}"
  echo "✅ build.gradle Android sincronizado: versionCode ${expected_version_code}, versionName ${expected_version_name}."
}

sync_android_inter_fonts() {
  local source_dir="${PROJECT_DIR}/../node_modules/@expo-google-fonts/inter"
  local target_dir="${PROJECT_DIR}/android/app/src/main/assets/fonts"
  local -a font_files=(
    "400Regular/Inter_400Regular.ttf"
    "500Medium/Inter_500Medium.ttf"
    "600SemiBold/Inter_600SemiBold.ttf"
    "700Bold/Inter_700Bold.ttf"
    "300Light/Inter_300Light.ttf"
  )

  mkdir -p "${target_dir}"

  for font_file in "${font_files[@]}"; do
    if [[ ! -f "${source_dir}/${font_file}" ]]; then
      echo "❌ Fonte canônica ausente: ${source_dir}/${font_file}"
      exit 1
    fi
    cp "${source_dir}/${font_file}" "${target_dir}/$(basename "${font_file}")"
  done

  echo "✅ Fontes Inter sincronizadas no Android nativo."
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
  sync_native_android_version
  sync_android_inter_fonts

  case "${MODE}" in
    debug) run_gradle "assembleDebug" ;;
    release) run_gradle "assembleRelease" ;;
    aab) run_gradle "bundleRelease" ;;
    *) echo "❌ Modo inválido: ${MODE}. Use debug|release|aab"; exit 1 ;;
  esac

  show_artifact_path
}

main "$@"
