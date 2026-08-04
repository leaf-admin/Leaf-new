#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/source-local-build-env.sh"
assert_full_xcode_toolchain "export IPA iOS" "0"

resolve_default_archive() {
  local signed_archive
  local unsigned_archive

  signed_archive="$(find "${PROJECT_DIR}/ios/build" -maxdepth 1 -name "Leaf.xcarchive" -type d 2>/dev/null | head -n 1 || true)"
  unsigned_archive="$(find "${PROJECT_DIR}/ios/build" -maxdepth 1 -name "Leaf-unsigned.xcarchive" -type d 2>/dev/null | head -n 1 || true)"

  if [[ -n "${signed_archive}" ]]; then
    echo "${signed_archive}"
    return
  fi

  if [[ -n "${unsigned_archive}" ]]; then
    echo "${unsigned_archive}"
    return
  fi

  find "${PROJECT_DIR}/ios/build" -maxdepth 1 -name "*.xcarchive" -type d 2>/dev/null | head -n 1 || true
}

resolve_team_id() {
  if [[ -n "${IOS_DEVELOPMENT_TEAM:-}" ]]; then
    echo "${IOS_DEVELOPMENT_TEAM}"
    return
  fi

  local pbxproj="${PROJECT_DIR}/ios/Leaf.xcodeproj/project.pbxproj"
  if [[ -f "${pbxproj}" ]]; then
    local team
    team="$(grep -Eo 'DEVELOPMENT_TEAM = [A-Z0-9]{10};' "${pbxproj}" | head -n 1 | awk '{print $3}' | tr -d ';' || true)"
    if [[ -n "${team}" ]]; then
      echo "${team}"
      return
    fi
  fi

  echo ""
}

assert_exported_ipa() {
  local ipa_path="$1"
  local tmp_dir
  local app_config_path
  local info_plist_path
  local widget_info_plist_path
  local expo_plist_path
  local expected_version
  local expected_build_number
  local actual_version
  local actual_build_number
  local widget_actual_version
  local widget_actual_build_number
  local microphone_usage
  local updates_enabled
  local updates_channel

  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/leaf-ios-ipa.XXXXXX")"

  unzip -q "${ipa_path}" -d "${tmp_dir}"
  app_config_path="$(find "${tmp_dir}/Payload" -path "*/EXConstants.bundle/app.config" -type f | head -n 1)"
  info_plist_path="$(find "${tmp_dir}/Payload" -maxdepth 2 -path "*/Leaf.app/Info.plist" -type f | head -n 1)"
  widget_info_plist_path="$(find "${tmp_dir}/Payload" -path "*/Leaf.app/PlugIns/LeafRideActivityWidget.appex/Info.plist" -type f | head -n 1)"
  expo_plist_path="$(find "${tmp_dir}/Payload" -maxdepth 2 -path "*/Leaf.app/Expo.plist" -type f | head -n 1)"

  if [[ -z "${app_config_path}" ]]; then
    echo "❌ EXConstants app.config ausente no IPA exportado."
    exit 1
  fi

  expected_version="$(node -e "console.log(require('./config/AppConfig').AppConfig.ios_app_version)")"
  expected_build_number="$(node -e "console.log(require('./config/AppConfig').AppConfig.ios_build_number)")"
  expected_runtime_version="${LEAF_RUNTIME_VERSION:-${EXPO_RUNTIME_VERSION:-${expected_version}}}"

  LEAF_EXPECTED_IOS_VERSION="${expected_version}" \
  LEAF_EXPECTED_IOS_BUILD_NUMBER="${expected_build_number}" \
  LEAF_EXPECTED_RUNTIME_VERSION="${expected_runtime_version}" node - "${app_config_path}" <<'NODE'
const fs = require('fs');

const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const failures = [];
const expectedVersion = process.env.LEAF_EXPECTED_IOS_VERSION;
const expectedBuildNumber = process.env.LEAF_EXPECTED_IOS_BUILD_NUMBER;
const expectedRuntimeVersion = process.env.LEAF_EXPECTED_RUNTIME_VERSION || expectedVersion;
const expected = {
  name: 'Leaf',
  slug: 'leafapp-reactnative',
  version: expectedVersion,
  runtimeVersion: expectedRuntimeVersion,
};

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
  console.error('❌ Config Expo inválida no IPA exportado:');
  for (const failure of failures) {
    console.error(`   - ${failure}`);
  }
  console.error('   Esse IPA foi gerado pelo contexto errado. Não envie ao TestFlight.');
  process.exit(1);
}

console.log('✅ Config Expo do IPA exportado confere com o app Leaf.');
NODE

  if [[ -z "${info_plist_path}" ]]; then
    echo "❌ Info.plist ausente no IPA exportado."
    exit 1
  fi

  actual_build_number="$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "${info_plist_path}" 2>/dev/null || true)"
  if [[ "${actual_build_number}" != "${expected_build_number}" ]]; then
    echo "❌ IPA com CFBundleVersion divergente."
    echo "   Esperado: ${expected_build_number}"
    echo "   Encontrado: ${actual_build_number:-<vazio>}"
    echo "   Não envie ao TestFlight."
    exit 1
  fi
  echo "✅ CFBundleVersion do IPA confere: ${actual_build_number}."

  if [[ -z "${widget_info_plist_path}" ]]; then
    echo "❌ Info.plist do widget ausente no IPA exportado."
    exit 1
  fi
  actual_version="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "${info_plist_path}" 2>/dev/null || true)"
  widget_actual_version="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "${widget_info_plist_path}" 2>/dev/null || true)"
  widget_actual_build_number="$(/usr/libexec/PlistBuddy -c "Print :CFBundleVersion" "${widget_info_plist_path}" 2>/dev/null || true)"
  if [[ "${actual_version}" != "${expected_version}" || "${widget_actual_version}" != "${expected_version}" || "${widget_actual_build_number}" != "${expected_build_number}" ]]; then
    echo "❌ Versão do widget divergente do app no IPA exportado."
    echo "   Esperado: ${expected_version} (${expected_build_number})"
    echo "   App: ${actual_version:-<vazio>} (${actual_build_number:-<vazio>})"
    echo "   Widget: ${widget_actual_version:-<vazio>} (${widget_actual_build_number:-<vazio>})"
    echo "   Não envie ao TestFlight."
    exit 1
  fi
  echo "✅ Versão do widget no IPA confere com o app: ${widget_actual_version} (${widget_actual_build_number})."

  microphone_usage="$(/usr/libexec/PlistBuddy -c "Print :NSMicrophoneUsageDescription" "${info_plist_path}" 2>/dev/null || true)"
  if [[ -z "${microphone_usage}" ]]; then
    echo "❌ IPA sem NSMicrophoneUsageDescription."
    echo "   A Apple rejeita o upload com ITMS-90683 quando SDKs referenciam microfone."
    echo "   Não envie ao TestFlight."
    exit 1
  fi
  echo "✅ NSMicrophoneUsageDescription do IPA presente."

  if [[ -n "${expo_plist_path}" ]]; then
    updates_enabled="$(/usr/libexec/PlistBuddy -c "Print :EXUpdatesEnabled" "${expo_plist_path}" 2>/dev/null || true)"
    if [[ "${updates_enabled}" == "true" || "${updates_enabled}" == "1" ]]; then
      updates_channel="$(/usr/libexec/PlistBuddy -c "Print :EXUpdatesRequestHeaders:expo-channel-name" "${expo_plist_path}" 2>/dev/null || true)"
      if [[ "${updates_channel}" != "production" ]]; then
        echo "❌ IPA com Expo Updates ativo sem canal production."
        echo "   Canal encontrado: ${updates_channel:-<vazio>}"
        echo "   Não envie ao TestFlight."
        exit 1
      fi
      echo "✅ Expo Updates do IPA usa canal production."
    fi
  fi

  rm -rf "${tmp_dir}"
}

main() {
  local archive_path
  local export_path
  local export_method
  local team_id
  local export_options

  archive_path="${IOS_ARCHIVE_PATH:-$(resolve_default_archive)}"
  export_path="${IOS_EXPORT_PATH:-${PROJECT_DIR}/ios/build/export-appstore}"
  export_method="${IOS_EXPORT_METHOD:-app-store-connect}"
  team_id="$(resolve_team_id)"

  if [[ -z "${archive_path}" || ! -d "${archive_path}" ]]; then
    echo "❌ Archive iOS não encontrado. Gere primeiro com: FORCE_UNSIGNED_ARCHIVE=1 npm run build:local:ios:archive"
    exit 1
  fi

  if [[ -z "${team_id}" ]]; then
    echo "❌ Team ID não resolvido. Defina IOS_DEVELOPMENT_TEAM=XXXXXXXXXX"
    exit 1
  fi

  mkdir -p "${PROJECT_DIR}/ios/build"
  rm -rf "${export_path}"

  export_options="${PROJECT_DIR}/ios/build/export-options-${export_method}.plist"

  cat > "${export_options}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>${export_method}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>teamID</key>
  <string>${team_id}</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
  <key>stripSwiftSymbols</key>
  <true/>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
PLIST

  echo "══════════════════════════════════════════════════════"
  echo "   Export iOS IPA Local"
  echo "══════════════════════════════════════════════════════"
  echo "📦 Archive: ${archive_path}"
  echo "🏷️  Team ID: ${team_id}"
  echo "🧭 Method: ${export_method}"
  echo "📁 Output: ${export_path}"

  xcodebuild -exportArchive \
    -archivePath "${archive_path}" \
    -exportPath "${export_path}" \
    -exportOptionsPlist "${export_options}" \
    -allowProvisioningUpdates

  if [[ -f "${export_path}/Leaf.ipa" ]]; then
    assert_exported_ipa "${export_path}/Leaf.ipa"
    echo "✅ IPA exportado com sucesso: ${export_path}/Leaf.ipa"
  else
    echo "⚠️  Export finalizado sem Leaf.ipa no diretório esperado"
  fi
}

main "$@"
