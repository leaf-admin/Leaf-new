#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(cd "${PROJECT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/source-local-build-env.sh"
assert_full_xcode_toolchain "build iOS local" "1"

MODE="${1:-simulator}"
IOS_DEVELOPMENT_TEAM="${IOS_DEVELOPMENT_TEAM:-}"
IOS_CODE_SIGN_STYLE="${IOS_CODE_SIGN_STYLE:-Automatic}"
FORCE_SIGNED_ARCHIVE="${FORCE_SIGNED_ARCHIVE:-0}"
IOS_ALLOW_PROVISIONING_DEVICE_REGISTRATION="${IOS_ALLOW_PROVISIONING_DEVICE_REGISTRATION:-1}"
IOS_SIMULATOR_CONFIGURATION="${IOS_SIMULATOR_CONFIGURATION:-Release}"
IOS_SIMULATOR_UDID="${IOS_SIMULATOR_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}"

ensure_ios_native() {
  if [[ -d "${PROJECT_DIR}/ios" ]]; then
    return
  fi
  echo "➡️  Diretório ios ausente, executando prebuild..."
  (cd "${PROJECT_DIR}" && npx expo prebuild --platform ios)
}

resolve_scheme() {
  local workspace="$1"
  local project="$2"
  local preferred=""
  local list_output=""
  local scheme=""

  if [[ -n "${workspace}" ]]; then
    preferred="$(basename "${workspace}" .xcworkspace)"
    list_output="$(xcodebuild -list -workspace "${workspace}" 2>/dev/null || true)"
  else
    preferred="$(basename "${project}" .xcodeproj)"
    list_output="$(xcodebuild -list -project "${project}" 2>/dev/null || true)"
  fi

  # Prioriza scheme da aplicação (geralmente igual ao nome do workspace/projeto).
  if echo "${list_output}" | awk '/Schemes:/{f=1;next} f && NF {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0); print}' | grep -Fxq "${preferred}"; then
    echo "${preferred}"
    return
  fi

  # Fallback: primeiro scheme disponível.
  scheme="$(echo "${list_output}" | awk '/Schemes:/{f=1;next} f && NF {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0); print; exit}')"
  [[ -n "${scheme}" ]] || scheme="${preferred}"

  echo "${scheme}"
}

resolve_simulator_destination() {
  local preferred_name=""
  local preferred_udid=""
  if [[ -n "${IOS_SIMULATOR_UDID}" ]]; then
    echo "id=${IOS_SIMULATOR_UDID}"
    return
  fi
  preferred_udid="$(xcrun simctl list devices available 2>/dev/null | awk -F '[()]' '/Booted/ && /iPhone/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit}')"
  if [[ -n "${preferred_udid}" ]]; then
    echo "id=${preferred_udid}"
    return
  fi

  preferred_name="$(xcrun simctl list devices available 2>/dev/null | awk -F '[()]' '/Booted/ && /iPhone/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1); print $1; exit}')"
  if [[ -z "${preferred_name}" ]]; then
    preferred_udid="$(xcrun simctl list devices available 2>/dev/null | awk -F '[()]' '/iPhone/ && /Shutdown/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2; exit}')"
    if [[ -n "${preferred_udid}" ]]; then
      echo "id=${preferred_udid}"
      return
    fi
    preferred_name="$(xcrun simctl list devices available 2>/dev/null | awk -F '[()]' '/iPhone/ && /Shutdown/ {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $1); print $1; exit}')"
  fi

  if [[ -z "${preferred_name}" ]]; then
    echo "platform=iOS Simulator,name=iPhone 17"
  else
    echo "platform=iOS Simulator,name=${preferred_name}"
  fi
}

ensure_pods() {
  local ios_dir="${PROJECT_DIR}/ios"
  local generated_dir="${ios_dir}/build/generated/ios"
  local generated_podspec="${generated_dir}/ReactCodegen.podspec"
  if [[ -f "${ios_dir}/Podfile.lock" && -f "${ios_dir}/Pods/Manifest.lock" && -f "${ios_dir}/Podfile" ]] \
    && cmp -s "${ios_dir}/Podfile.lock" "${ios_dir}/Pods/Manifest.lock" \
    && [[ "${ios_dir}/Podfile" -ot "${ios_dir}/Pods/Manifest.lock" ]] \
    && [[ -f "${generated_podspec}" ]]; then
    echo "✅ Pods já sincronizados (pod install não necessário)."
    return
  fi

  if [[ ! -f "${generated_podspec}" ]]; then
    echo "➡️  Codegen iOS ausente em ${generated_dir}; regenerando Pods..."
  fi

  (cd "${ios_dir}" && pod install --repo-update)
}

sync_native_ios_version() {
  local info_plist_path="${PROJECT_DIR}/ios/Leaf/Info.plist"
  local expected_version
  local expected_build_number
  local microphone_usage="A Leaf usa o microfone para capturar o destino por voz quando você tocar no ícone de microfone."
  local speech_usage="A Leaf converte sua fala em texto para preencher o destino com mais rapidez."

  if [[ ! -f "${info_plist_path}" ]]; then
    echo "❌ Info.plist nativo do iOS não encontrado: ${info_plist_path}"
    exit 1
  fi

  expected_version="$(node -e "console.log(require('./config/AppConfig').AppConfig.ios_app_version)")"
  expected_build_number="$(node -e "console.log(require('./config/AppConfig').AppConfig.ios_build_number)")"

  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString ${expected_version}" "${info_plist_path}" >/dev/null 2>&1 \
    || /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string ${expected_version}" "${info_plist_path}"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion ${expected_build_number}" "${info_plist_path}" >/dev/null 2>&1 \
    || /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string ${expected_build_number}" "${info_plist_path}"
  /usr/libexec/PlistBuddy -c "Set :NSMicrophoneUsageDescription ${microphone_usage}" "${info_plist_path}" >/dev/null 2>&1 \
    || /usr/libexec/PlistBuddy -c "Add :NSMicrophoneUsageDescription string ${microphone_usage}" "${info_plist_path}"
  /usr/libexec/PlistBuddy -c "Set :NSSpeechRecognitionUsageDescription ${speech_usage}" "${info_plist_path}" >/dev/null 2>&1 \
    || /usr/libexec/PlistBuddy -c "Add :NSSpeechRecognitionUsageDescription string ${speech_usage}" "${info_plist_path}"

  echo "✅ Info.plist iOS sincronizado: ${expected_version} (${expected_build_number})."
}

count_signing_identities() {
  security find-identity -v -p codesigning 2>/dev/null \
    | awk '/valid identities found/{print $1; exit}' \
    | tr -d '[:space:]'
}

has_connected_ios_device() {
  xcrun xctrace list devices 2>/dev/null \
    | awk '
      /== Devices ==/ { in_devices=1; next }
      /== Simulators ==/ { in_devices=0 }
      in_devices && /iPhone|iPad/ { found=1 }
      END { exit found ? 0 : 1 }
    '
}

assert_ios_app_artifact() {
  local app_path="$1"
  local context="$2"
  local app_config_path="${app_path}/EXConstants.bundle/app.config"
  local info_plist_path="${app_path}/Info.plist"
  local expo_plist_path="${app_path}/Expo.plist"
  local expected_build_number
  local actual_build_number
  local updates_enabled=""
  local updates_channel=""
  local microphone_usage=""

  if [[ ! -d "${app_path}" ]]; then
    echo "❌ Artefato iOS não encontrado para validação (${context}): ${app_path}"
    exit 1
  fi

  if [[ ! -f "${app_config_path}" ]]; then
    echo "❌ EXConstants app.config ausente no artefato iOS (${context})."
    exit 1
  fi

  expected_build_number="$(node -e "console.log(require('./config/AppConfig').AppConfig.ios_build_number)")"

  LEAF_EXPECTED_IOS_BUILD_NUMBER="${expected_build_number}" node - "${app_config_path}" <<'NODE'
const fs = require('fs');

const appConfigPath = process.argv[2];
const config = JSON.parse(fs.readFileSync(appConfigPath, 'utf8'));
const expectedBuildNumber = process.env.LEAF_EXPECTED_IOS_BUILD_NUMBER;
const expected = {
  name: 'Leaf',
  slug: 'leafapp-reactnative',
  version: '1.0.1',
  runtimeVersion: '1.0.1',
};

const failures = [];
for (const [key, value] of Object.entries(expected)) {
  if (config[key] !== value) {
    failures.push(`${key}: esperado ${value}, recebido ${config[key] || '<vazio>'}`);
  }
}

if (config.ios?.bundleIdentifier !== 'br.com.leaf.ride') {
  failures.push(`ios.bundleIdentifier: esperado br.com.leaf.ride, recebido ${config.ios?.bundleIdentifier || '<vazio>'}`);
}

if (config.ios?.buildNumber !== expectedBuildNumber) {
  failures.push(`ios.buildNumber: esperado ${expectedBuildNumber}, recebido ${config.ios?.buildNumber || '<vazio>'}`);
}

if (!config.extra?.eas?.projectId) {
  failures.push('extra.eas.projectId ausente');
}

if (failures.length) {
  console.error('❌ Config Expo inválida embutida no artefato iOS:');
  for (const failure of failures) {
    console.error(`   - ${failure}`);
  }
  console.error('   Isso indica build a partir da raiz do monorepo em vez de mobile-app.');
  process.exit(1);
}

console.log('✅ Config Expo embutida confere com o app Leaf.');
NODE

  if [[ ! -f "${info_plist_path}" ]]; then
    echo "❌ Info.plist ausente no artefato iOS (${context})."
    exit 1
  fi

  actual_build_number="$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "${info_plist_path}" 2>/dev/null || true)"
  if [[ "${actual_build_number}" != "${expected_build_number}" ]]; then
    echo "❌ CFBundleVersion divergente no artefato iOS (${context})."
    echo "   Esperado: ${expected_build_number}"
    echo "   Encontrado: ${actual_build_number:-<vazio>}"
    exit 1
  fi
  echo "✅ CFBundleVersion confere: ${actual_build_number}."

  microphone_usage="$(/usr/libexec/PlistBuddy -c "Print :NSMicrophoneUsageDescription" "${info_plist_path}" 2>/dev/null || true)"
  if [[ -z "${microphone_usage}" ]]; then
    echo "❌ NSMicrophoneUsageDescription ausente no artefato iOS (${context})."
    echo "   A Apple rejeita o upload com ITMS-90683 quando SDKs referenciam microfone."
    exit 1
  fi
  echo "✅ NSMicrophoneUsageDescription presente."

  if [[ -f "${expo_plist_path}" ]]; then
    updates_enabled="$(/usr/libexec/PlistBuddy -c "Print :EXUpdatesEnabled" "${expo_plist_path}" 2>/dev/null || true)"
    if [[ "${updates_enabled}" == "true" || "${updates_enabled}" == "1" ]]; then
      updates_channel="$(/usr/libexec/PlistBuddy -c "Print :EXUpdatesRequestHeaders:expo-channel-name" "${expo_plist_path}" 2>/dev/null || true)"
      if [[ "${updates_channel}" != "production" ]]; then
        echo "❌ Expo Updates ativo sem canal production no artefato iOS (${context})."
        echo "   Canal encontrado: ${updates_channel:-<vazio>}"
        exit 1
      fi
      echo "✅ Expo Updates usa canal production."
    fi
  fi
}

main() {
  echo "══════════════════════════════════════════════════════"
  echo "   Build iOS Local (${MODE})"
  echo "══════════════════════════════════════════════════════"

  command -v pod >/dev/null 2>&1 || { echo "❌ CocoaPods não encontrado. Rode npm run env:local:setup:mac"; exit 1; }

  ensure_ios_native
  sync_native_ios_version
  ensure_pods

  local workspace
  local project
  local scheme
  local sim_destination
  local archive_path
  local identity_count
  local force_unsigned
  local force_signed
  local use_unsigned
  local -a archive_signing_args
  local -a provisioning_flags
  local -a sim_extra_args

  workspace="$(find "${PROJECT_DIR}/ios" -maxdepth 1 -name "*.xcworkspace" | head -n 1)"
  project="$(find "${PROJECT_DIR}/ios" -maxdepth 1 -name "*.xcodeproj" | head -n 1)"
  scheme="$(resolve_scheme "${workspace}" "${project}")"
  archive_path="${PROJECT_DIR}/ios/build/${scheme}.xcarchive"
  identity_count="$(count_signing_identities)"
  force_unsigned="${FORCE_UNSIGNED_ARCHIVE:-0}"
  force_signed="${FORCE_SIGNED_ARCHIVE}"
  use_unsigned="0"
  archive_signing_args=()
  provisioning_flags=("-allowProvisioningUpdates")
  if [[ "${IOS_ALLOW_PROVISIONING_DEVICE_REGISTRATION}" == "1" ]]; then
    provisioning_flags+=("-allowProvisioningDeviceRegistration")
  fi

  [[ -n "${scheme}" ]] || { echo "❌ Não foi possível resolver scheme do iOS."; exit 1; }

  mkdir -p "${PROJECT_DIR}/ios/build"
  sim_destination="$(resolve_simulator_destination)"
  sim_extra_args=("ONLY_ACTIVE_ARCH=YES")
  if [[ "$(uname -m)" == "arm64" ]]; then
    sim_extra_args+=("EXCLUDED_ARCHS=x86_64")
  fi
  # Keep local iOS builds aligned with EAS: Expo config, constants and native
  # manifests must be resolved from mobile-app, not from the monorepo root.
  export PROJECT_ROOT="${PROJECT_DIR}"
  export EAS_BUILD_PROFILE="${EAS_BUILD_PROFILE:-production}"
  export LEAF_BUILD_PROFILE="${LEAF_BUILD_PROFILE:-${EAS_BUILD_PROFILE}}"
  export EXPO_UPDATE_CHANNEL="${EXPO_UPDATE_CHANNEL:-production}"
  if [[ -f "${PROJECT_DIR}/index.js" ]]; then
    # Expo/Metro resolves the bundle entry relative to the workspace server root
    # in this monorepo, while expo-constants must still use mobile-app as root.
    export ENTRY_FILE="$(basename "${PROJECT_DIR}")/index.js"
  fi

  case "${MODE}" in
    simulator)
      export LEAF_DISABLE_UPDATES_FOR_SIMULATOR=1
      local built_app_path="${PROJECT_DIR}/ios/build/Build/Products/${IOS_SIMULATOR_CONFIGURATION}-iphonesimulator/${scheme}.app"
      local expo_plist_path="${built_app_path}/Expo.plist"
      mkdir -p "${PROJECT_DIR}/ios/build/Build/Products/${IOS_SIMULATOR_CONFIGURATION}-iphonesimulator/EXUpdates.bundle"
      if [[ -n "${workspace}" ]]; then
        xcodebuild \
          -workspace "${workspace}" \
          -scheme "${scheme}" \
          -configuration "${IOS_SIMULATOR_CONFIGURATION}" \
          -sdk iphonesimulator \
          -destination "${sim_destination}" \
          -derivedDataPath "${PROJECT_DIR}/ios/build" \
          "${sim_extra_args[@]}" \
          build
      else
        xcodebuild \
          -project "${project}" \
          -scheme "${scheme}" \
          -configuration "${IOS_SIMULATOR_CONFIGURATION}" \
          -sdk iphonesimulator \
          -destination "${sim_destination}" \
          -derivedDataPath "${PROJECT_DIR}/ios/build" \
          "${sim_extra_args[@]}" \
          build
      fi
      if [[ -f "${expo_plist_path}" ]]; then
        /usr/libexec/PlistBuddy -c "Set :EXUpdatesEnabled false" "${expo_plist_path}" >/dev/null 2>&1 || true
        /usr/libexec/PlistBuddy -c "Set :EXUpdatesCheckOnLaunch NEVER" "${expo_plist_path}" >/dev/null 2>&1 || true
        /usr/libexec/PlistBuddy -c "Delete :EXUpdatesURL" "${expo_plist_path}" >/dev/null 2>&1 || true
      fi
      assert_ios_app_artifact "${built_app_path}" "simulator"
      echo "✅ Build iOS simulator concluída em ${PROJECT_DIR}/ios/build"
      ;;
    archive)
      if [[ "${force_signed}" == "1" && "${identity_count:-0}" == "0" ]]; then
        echo "❌ FORCE_SIGNED_ARCHIVE=1 definido, mas nenhuma identidade de assinatura Apple foi encontrada."
        echo "💡 Configure certificado/provisioning local (Xcode > Settings > Accounts > Manage Certificates)."
        exit 1
      fi

      if [[ "${force_unsigned}" == "1" || "${identity_count:-0}" == "0" ]]; then
        use_unsigned="1"
        archive_path="${PROJECT_DIR}/ios/build/${scheme}-unsigned.xcarchive"
        archive_signing_args=("CODE_SIGNING_ALLOWED=NO" "CODE_SIGNING_REQUIRED=NO" "CODE_SIGN_IDENTITY=")
        echo "⚠️  Sem identidade de assinatura Apple local. Gerando archive SEM assinatura para validação técnica."
      else
        archive_signing_args=("CODE_SIGN_STYLE=${IOS_CODE_SIGN_STYLE}")
        if [[ -n "${IOS_DEVELOPMENT_TEAM}" ]]; then
          archive_signing_args+=("DEVELOPMENT_TEAM=${IOS_DEVELOPMENT_TEAM}")
        fi

        if ! has_connected_ios_device; then
          echo "⚠️  Nenhum iPhone/iPad físico detectado neste Mac."
          echo "⚠️  Se o profile for Development, o archive assinado pode falhar por falta de device provisionado."
        fi
      fi

      if [[ -n "${workspace}" ]]; then
        xcodebuild \
          -workspace "${workspace}" \
          -scheme "${scheme}" \
          -configuration Release \
          -destination "generic/platform=iOS" \
          -archivePath "${archive_path}" \
          "${provisioning_flags[@]}" \
          "${archive_signing_args[@]}" \
          archive
      else
        xcodebuild \
          -project "${project}" \
          -scheme "${scheme}" \
          -configuration Release \
          -destination "generic/platform=iOS" \
          -archivePath "${archive_path}" \
          "${provisioning_flags[@]}" \
          "${archive_signing_args[@]}" \
          archive
      fi
      if [[ "${use_unsigned}" == "1" ]]; then
        assert_ios_app_artifact "${archive_path}/Products/Applications/${scheme}.app" "archive"
        echo "✅ Archive iOS sem assinatura gerado em ${archive_path}"
      else
        assert_ios_app_artifact "${archive_path}/Products/Applications/${scheme}.app" "archive"
        echo "✅ Archive iOS assinado gerado em ${archive_path}"
      fi
      ;;
    *)
      echo "❌ Modo inválido: ${MODE}. Use simulator|archive"
      exit 1
      ;;
  esac
}

main "$@"
