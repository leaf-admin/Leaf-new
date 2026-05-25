#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/source-local-build-env.sh"

PASS_COUNT=0
FAIL_COUNT=0
WARN_COUNT=0

ok() {
  echo "✅ $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "❌ $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

warn() {
  echo "⚠️  $1"
  WARN_COUNT=$((WARN_COUNT + 1))
}

check_cmd() {
  local cmd="$1"
  local name="$2"
  if command -v "${cmd}" >/dev/null 2>&1; then
    ok "${name}: $(command -v "${cmd}")"
  else
    fail "${name}: comando não encontrado"
  fi
}

check_pod_version() {
  local required_version="1.15.2"
  local current_version
  current_version="$(pod --version 2>/dev/null || true)"
  if [[ -z "${current_version}" ]]; then
    fail "CocoaPods versão não detectada"
    return
  fi

  if ruby -e 'exit Gem::Version.new(ARGV[0]) >= Gem::Version.new(ARGV[1]) ? 0 : 1' "${current_version}" "${required_version}"; then
    ok "CocoaPods versão compatível: ${current_version}"
  else
    fail "CocoaPods ${current_version} incompatível (mínimo ${required_version})"
  fi
}

resolve_bundle_identifier() {
  local pbxproj="${PROJECT_DIR}/ios/Leaf.xcodeproj/project.pbxproj"
  if [[ ! -f "${pbxproj}" ]]; then
    echo ""
    return
  fi

  grep -Eo 'PRODUCT_BUNDLE_IDENTIFIER = [^;]+' "${pbxproj}" \
    | head -n 1 \
    | awk -F '=' '{gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); print $2}' \
    | tr -d ';'
}

count_profile_devices() {
  local plist_path="$1"
  /usr/libexec/PlistBuddy -c 'Print :ProvisionedDevices' "${plist_path}" 2>/dev/null \
    | grep -Ec '^[[:space:]]*[A-Z0-9]+' || true
}

check_ios_signing_assets() {
  local identity_count
  local profile_count
  local dev_cert_count
  local dist_cert_count
  local profile_paths
  local bundle_identifier
  local tmp_profile_plist
  local profile_file
  local profile_app_identifier
  local profile_bundle_identifier
  local profile_devices_count
  local device_profiles_for_bundle
  local distribution_profiles_for_bundle

  identity_count="$(security find-identity -v -p codesigning 2>/dev/null | awk '/valid identities found/{print $1; exit}' | tr -d '[:space:]')"
  profile_paths="$(for dir in \
    "${HOME}/Library/MobileDevice/Provisioning Profiles" \
    "${HOME}/Library/Developer/Xcode/UserData/Provisioning Profiles"; do
      if [[ -d "${dir}" ]]; then
        find "${dir}" -maxdepth 1 -name "*.mobileprovision" 2>/dev/null || true
      fi
    done | sort -u)"
  profile_count="$(echo "${profile_paths}" | sed '/^[[:space:]]*$/d' | wc -l | tr -d '[:space:]')"
  dev_cert_count="$(security find-certificate -a -c "Apple Development" "${HOME}/Library/Keychains/login.keychain-db" 2>/dev/null | grep -c "^keychain:" || true)"
  dist_cert_count="$(security find-certificate -a -c "Apple Distribution" "${HOME}/Library/Keychains/login.keychain-db" 2>/dev/null | grep -c "^keychain:" || true)"
  bundle_identifier="$(resolve_bundle_identifier)"
  tmp_profile_plist="$(mktemp /tmp/leaf-profile-XXXXXX.plist)"
  device_profiles_for_bundle=0
  distribution_profiles_for_bundle=0

  if [[ -z "${identity_count}" ]]; then
    identity_count="0"
  fi
  if [[ -z "${profile_count}" ]]; then
    profile_count="0"
  fi
  if [[ -z "${dev_cert_count}" ]]; then
    dev_cert_count="0"
  fi
  if [[ -z "${dist_cert_count}" ]]; then
    dist_cert_count="0"
  fi

  if [[ "${identity_count}" -gt 0 ]]; then
    ok "Assinatura iOS: ${identity_count} identidade(s) de code signing encontrada(s)"
  else
    if [[ "${dev_cert_count}" -gt 0 || "${dist_cert_count}" -gt 0 ]]; then
      warn "Assinatura iOS: certificados encontrados sem private key local (identidades válidas = 0). Importe um .p12 ou recrie os certificados neste Mac."
    else
      warn "Assinatura iOS: nenhuma identidade de code signing encontrada (archive será gerado sem assinatura)"
    fi
  fi

  if [[ "${profile_count}" -gt 0 ]]; then
    ok "Provisioning profiles iOS: ${profile_count} encontrado(s)"
  else
    warn "Provisioning profiles iOS: nenhum profile encontrado (checado em MobileDevice e Xcode/UserData)"
  fi

  if [[ -n "${bundle_identifier}" && "${profile_count}" -gt 0 ]]; then
    while IFS= read -r profile_file; do
      [[ -n "${profile_file}" ]] || continue

      if ! security cms -D -i "${profile_file}" > "${tmp_profile_plist}" 2>/dev/null; then
        continue
      fi

      profile_app_identifier="$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:application-identifier' "${tmp_profile_plist}" 2>/dev/null || true)"
      profile_bundle_identifier="${profile_app_identifier#*.}"
      profile_devices_count="$(count_profile_devices "${tmp_profile_plist}")"

      if [[ "${profile_bundle_identifier}" == "${bundle_identifier}" || "${profile_bundle_identifier}" == "*" ]]; then
        if [[ "${profile_devices_count}" -gt 0 ]]; then
          device_profiles_for_bundle=$((device_profiles_for_bundle + 1))
        else
          distribution_profiles_for_bundle=$((distribution_profiles_for_bundle + 1))
        fi
      fi
    done <<< "$(echo "${profile_paths}" | sed '/^[[:space:]]*$/d')"
  fi

  rm -f "${tmp_profile_plist}" 2>/dev/null || true

  if [[ -n "${bundle_identifier}" ]]; then
    if [[ "${device_profiles_for_bundle}" -gt 0 ]]; then
      ok "Profiles de desenvolvimento para ${bundle_identifier}: ${device_profiles_for_bundle} com device(s) provisionado(s)"
    else
      warn "Sem profile iOS Development com device para ${bundle_identifier}; build em iPhone físico pode falhar"
      if [[ "${distribution_profiles_for_bundle}" -gt 0 ]]; then
        warn "Foram encontrados apenas profile(s) de distribuição/Store para ${bundle_identifier}: ${distribution_profiles_for_bundle}"
      fi
    fi
  fi
}

check_ios_development_team() {
  local pbxproj="${PROJECT_DIR}/ios/Leaf.xcodeproj/project.pbxproj"
  if [[ ! -f "${pbxproj}" ]]; then
    warn "iOS project file não encontrado para checar DEVELOPMENT_TEAM"
    return
  fi

  if grep -Eq "DEVELOPMENT_TEAM = [A-Z0-9]{10};" "${pbxproj}"; then
    ok "iOS DEVELOPMENT_TEAM configurado no projeto"
  else
    warn "iOS DEVELOPMENT_TEAM não configurado no projeto (assinatura automática pode falhar no archive assinado)"
  fi
}

echo "🔎 Validando ambiente local de build em ${PROJECT_DIR}"

check_cmd node "Node"
check_cmd npm "npm"
check_cmd npx "npx"
check_cmd xcodebuild "Xcode"
check_cmd pod "CocoaPods"
check_pod_version
check_ios_signing_assets
check_ios_development_team
check_cmd java "Java 17+"
check_cmd adb "Android platform-tools (adb)"
check_cmd sdkmanager "Android cmdline-tools (sdkmanager)"

if [[ -d "${ANDROID_SDK_ROOT}" ]]; then
  ok "ANDROID_SDK_ROOT: ${ANDROID_SDK_ROOT}"
else
  fail "ANDROID_SDK_ROOT inexistente: ${ANDROID_SDK_ROOT}"
fi

if [[ -n "${JAVA_HOME:-}" && -d "${JAVA_HOME}" ]]; then
  ok "JAVA_HOME: ${JAVA_HOME}"
else
  fail "JAVA_HOME não definido ou inexistente"
fi

if [[ -f "${PROJECT_DIR}/app.config.js" ]]; then
  ok "app.config.js presente"
else
  fail "app.config.js ausente"
fi

echo
echo "Resumo: ${PASS_COUNT} checks OK, ${WARN_COUNT} alertas, ${FAIL_COUNT} falharam."

if [[ "${FAIL_COUNT}" -gt 0 ]]; then
  echo "💡 Rode: npm run env:local:setup:mac"
  exit 1
fi

echo "🎯 Ambiente pronto para build local sem EAS cloud."
