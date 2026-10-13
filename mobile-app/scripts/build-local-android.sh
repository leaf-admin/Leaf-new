#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/source-local-build-env.sh"

MODE="${1:-debug}"
ANDROID_BUILD_OUTPUT_PATH="${ANDROID_BUILD_OUTPUT_PATH:-}"
ANDROID_BUILD_INIT_SCRIPT=""
ANDROID_WORKLETS_BUILD_DIR=""
ANDROID_WORKLETS_BUILD_BACKUP=""
ANDROID_WORKLETS_BUILD_LINK_TARGET=""
ANDROID_WORKLETS_BUILD_LINKED=0

cleanup_external_build_script() {
  if [[ "${ANDROID_WORKLETS_BUILD_LINKED}" == "1" && -n "${ANDROID_WORKLETS_BUILD_DIR}" && -L "${ANDROID_WORKLETS_BUILD_DIR}" && "$(readlink "${ANDROID_WORKLETS_BUILD_DIR}")" == "${ANDROID_WORKLETS_BUILD_LINK_TARGET}" ]]; then
    rm "${ANDROID_WORKLETS_BUILD_DIR}"
  fi
  if [[ -n "${ANDROID_WORKLETS_BUILD_BACKUP}" && -e "${ANDROID_WORKLETS_BUILD_BACKUP}" && ! -e "${ANDROID_WORKLETS_BUILD_DIR}" ]]; then
    ln -s "${ANDROID_WORKLETS_BUILD_BACKUP}" "${ANDROID_WORKLETS_BUILD_DIR}"
  fi
  if [[ -n "${ANDROID_BUILD_INIT_SCRIPT}" && -f "${ANDROID_BUILD_INIT_SCRIPT}" ]]; then
    rm -f "${ANDROID_BUILD_INIT_SCRIPT}"
  fi
}

trap cleanup_external_build_script EXIT

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

  expected_version_code="$(cd "${PROJECT_DIR}" && node -e "console.log(require('./config/AppConfig').AppConfig.android_app_version)")"
  expected_version_name="$(cd "${PROJECT_DIR}" && node -e "console.log(require('./config/AppConfig').AppConfig.ios_app_version)")"
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
  local -a gradle_options=(--no-daemon)
  local -a local_qa_signing_options=()

  if [[ "${ANDROID_BUILD_CLEAN:-0}" == "1" ]]; then
    tasks=("clean" "${tasks[@]}")
  fi

  if [[ -n "${ANDROID_BUILD_OUTPUT_PATH}" ]]; then
    gradle_options+=(
      --init-script "${ANDROID_BUILD_INIT_SCRIPT}"
      --project-cache-dir "${ANDROID_BUILD_OUTPUT_PATH}/project-cache"
    )
  fi
  if [[ "${ANDROID_DISABLE_PROBLEMS_REPORT:-0}" == "1" ]]; then
    gradle_options+=(--no-problems-report)
  fi
  if [[ "${ANDROID_BUILD_STACKTRACE:-0}" == "1" ]]; then
    gradle_options+=(--stacktrace)
  fi

  if [[ "${ANDROID_LOCAL_QA_SIGNING:-}" == "debug" ]]; then
    local debug_keystore="${PROJECT_DIR}/android/app/debug.keystore"
    [[ "${MODE}" == "release" ]] || {
      echo "❌ ANDROID_LOCAL_QA_SIGNING=debug só pode assinar assembleRelease local."
      exit 1
    }
    [[ -f "${debug_keystore}" ]] || {
      echo "❌ Keystore debug local ausente: ${debug_keystore}"
      exit 1
    }
    local_qa_signing_options+=(
      "-Pandroid.injected.signing.store.file=${debug_keystore}"
      "-Pandroid.injected.signing.store.password=android"
      "-Pandroid.injected.signing.key.alias=androiddebugkey"
      "-Pandroid.injected.signing.key.password=android"
      "-Pandroid.packagingOptions.pickFirsts=**/libworklets.so"
    )
    echo "ℹ️  Release local assinado com debug.keystore; artefato de QA não publicável."
  fi

  (cd "${PROJECT_DIR}/android" && ./gradlew "${tasks[@]}" "${gradle_options[@]}" "${local_qa_signing_options[@]}")
}

prepare_external_build_output() {
  [[ -n "${ANDROID_BUILD_OUTPUT_PATH}" ]] || return 0

  mkdir -p "${ANDROID_BUILD_OUTPUT_PATH}"
  export ANDROID_BUILD_OUTPUT_PATH
  export ANDROID_GRADLE_PROJECT_DIR="${PROJECT_DIR}/android"
  export GRADLE_USER_HOME="${GRADLE_USER_HOME:-${ANDROID_BUILD_OUTPUT_PATH}/gradle-user-home}"
  mkdir -p "${GRADLE_USER_HOME}"
  ANDROID_BUILD_INIT_SCRIPT="$(mktemp "${ANDROID_BUILD_OUTPUT_PATH}/.leaf-android-build-dir.XXXXXX")"
  cat > "${ANDROID_BUILD_INIT_SCRIPT}" <<'GRADLE'
def externalBuildRoot = new File(System.getenv('ANDROID_BUILD_OUTPUT_PATH'))
def mainAndroidProjectDir = new File(System.getenv('ANDROID_GRADLE_PROJECT_DIR')).canonicalFile

def mainAndroidAppDir = new File(mainAndroidProjectDir, 'app').canonicalFile
def configureExternalNativeStaging = { project, nativeOutputRoot ->
  def androidExtension = project.extensions.findByName('android')
  def externalNativeBuild = androidExtension?.externalNativeBuild
  def projectKey = project.path.substring(1).replace(':', '/')
  def cmake = externalNativeBuild?.cmake
  def ndkBuild = externalNativeBuild?.ndkBuild

  if (cmake != null) {
    cmake.buildStagingDirectory = new File(nativeOutputRoot, "cxx/${projectKey}")
    println "[leaf-android-build] ${project.path} CMake -> ${cmake.buildStagingDirectory}"
  }
  if (ndkBuild != null) {
    ndkBuild.buildStagingDirectory = new File(nativeOutputRoot, "ndk/${projectKey}")
    println "[leaf-android-build] ${project.path} NDK -> ${ndkBuild.buildStagingDirectory}"
  }
}

gradle.projectsLoaded {
  def isMainAndroidBuild = gradle.rootProject.projectDir.canonicalFile == mainAndroidProjectDir
  def includedBuildKey = "${Integer.toHexString(gradle.rootProject.projectDir.canonicalPath.hashCode())}-${Integer.toHexString(System.identityHashCode(gradle))}"
  def nativeOutputRoot = isMainAndroidBuild
    ? externalBuildRoot
    : new File(externalBuildRoot, "included/${includedBuildKey}")

  gradle.rootProject.allprojects { project ->
    if (isMainAndroidBuild && project.path == ':' && project.projectDir.canonicalFile == mainAndroidProjectDir) {
      println "[leaf-android-build] ${project.path} keeps Android root build directory for Expo autolinking"
    } else {
      def projectPath = project.path == ':' ? 'root' : project.path.substring(1).replace(':', '/')
      def projectBuildPath = isMainAndroidBuild
        ? (project.projectDir.canonicalFile == mainAndroidAppDir ? 'app' : "modules/${projectPath}")
        : "included/${includedBuildKey}/${projectPath}"
      project.layout.buildDirectory.set(new File(externalBuildRoot, projectBuildPath))
      println "[leaf-android-build] ${project.path} -> ${project.layout.buildDirectory.get().asFile}"
    }

    project.plugins.withId('com.android.application') { configureExternalNativeStaging(project, nativeOutputRoot) }
    project.plugins.withId('com.android.library') { configureExternalNativeStaging(project, nativeOutputRoot) }
  }
}
GRADLE

  echo "ℹ️  As saídas dos módulos Android, staging CMake/NDK e caches Gradle serão gravados em ${ANDROID_BUILD_OUTPUT_PATH}."
}

prepare_external_worklets_build_link() {
  [[ -n "${ANDROID_BUILD_OUTPUT_PATH}" ]] || return 0

  local worklets_android_dir="${PROJECT_DIR}/../node_modules/react-native-worklets/android"
  [[ -d "${worklets_android_dir}" ]] || return 0

  local worklets_build_dir="${worklets_android_dir}/build"
  local external_worklets_build_dir="${ANDROID_BUILD_OUTPUT_PATH}/modules/react-native-worklets"
  mkdir -p "${external_worklets_build_dir}"
  ANDROID_WORKLETS_BUILD_DIR="${worklets_build_dir}"
  ANDROID_WORKLETS_BUILD_LINK_TARGET="${external_worklets_build_dir}"

  if [[ -L "${worklets_build_dir}" ]]; then
    local existing_link_target
    existing_link_target="$(readlink "${worklets_build_dir}")"
    if [[ "${existing_link_target}" == "${external_worklets_build_dir}" ]]; then
      return 0
    fi
    local preserved_worklets_root="${ANDROID_BUILD_OUTPUT_PATH}/preserved/react-native-worklets/"
    if [[ "${existing_link_target}" == "${preserved_worklets_root}"android-build-* && -d "${existing_link_target}" ]]; then
      ANDROID_WORKLETS_BUILD_BACKUP="${existing_link_target}"
      rm "${worklets_build_dir}"
    else
      echo "❌ O diretório Android de react-native-worklets já é um link para outro destino: ${worklets_build_dir}"
      exit 1
    fi
  fi

  if [[ -e "${worklets_build_dir}" ]]; then
    local backup_root="${ANDROID_BUILD_OUTPUT_PATH}/preserved/react-native-worklets"
    mkdir -p "${backup_root}"
    ANDROID_WORKLETS_BUILD_BACKUP="${backup_root}/android-build-$(date +%Y%m%d%H%M%S)-$$"
    if [[ -e "${ANDROID_WORKLETS_BUILD_BACKUP}" ]]; then
      echo "❌ Destino para preservar o build Android de Worklets já existe: ${ANDROID_WORKLETS_BUILD_BACKUP}"
      exit 1
    fi
    mv "${worklets_build_dir}" "${ANDROID_WORKLETS_BUILD_BACKUP}"
  fi

  ln -s "${external_worklets_build_dir}" "${worklets_build_dir}"
  ANDROID_WORKLETS_BUILD_LINKED=1
  echo "ℹ️  O caminho CMake de react-native-worklets aponta temporariamente para a saída externa."
}

show_artifact_path() {
  local app_build_root="${PROJECT_DIR}/android/app/build"
  if [[ -n "${ANDROID_BUILD_OUTPUT_PATH}" ]]; then
    app_build_root="${ANDROID_BUILD_OUTPUT_PATH}/app"
  fi

  case "${MODE}" in
    debug)
      echo "✅ APK debug: ${app_build_root}/outputs/apk/debug/app-debug.apk"
      ;;
    release)
      echo "✅ APK release: ${app_build_root}/outputs/apk/release/app-release.apk"
      ;;
    aab)
      echo "✅ AAB release: ${app_build_root}/outputs/bundle/release/app-release.aab"
      ;;
  esac
}

main() {
  echo "══════════════════════════════════════════════════════"
  echo "   Build Android Local (${MODE})"
  echo "══════════════════════════════════════════════════════"

  export PROJECT_ROOT="${PROJECT_DIR}"
  export ENTRY_FILE=index.js
  if [[ "${MODE}" == "release" || "${MODE}" == "aab" ]]; then
    export EAS_BUILD_PROFILE="${EAS_BUILD_PROFILE:-production}"
    export LEAF_BUILD_PROFILE="${LEAF_BUILD_PROFILE:-${EAS_BUILD_PROFILE}}"
    export EXPO_UPDATE_CHANNEL="${EXPO_UPDATE_CHANNEL:-production}"
  fi
  load_eas_build_profile_env

  ensure_android_native
  node "${SCRIPT_DIR}/sync-leaf-ui-native.cjs" android
  ensure_local_properties
  sync_native_android_version
  sync_android_inter_fonts
  prepare_external_build_output
  prepare_external_worklets_build_link

  case "${MODE}" in
    debug) run_gradle "assembleDebug" ;;
    release) run_gradle "assembleRelease" ;;
    aab) run_gradle "bundleRelease" ;;
    *) echo "❌ Modo inválido: ${MODE}. Use debug|release|aab"; exit 1 ;;
  esac

  show_artifact_path
}

main "$@"
