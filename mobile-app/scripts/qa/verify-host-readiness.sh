#!/usr/bin/env bash

# Host-only gate for QA/build execution. This script is intentionally fail-fast:
# it may inspect the host and warm a tool's version command, but it must never
# launch an app, seed a state, follow a deep link, or create a ride.

set -uo pipefail

QA_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${QA_SCRIPT_DIR}/../.." && pwd)"
ROOT_DIR="$(cd "${MOBILE_DIR}/.." && pwd)"

QA_PLATFORM="${QA_PLATFORM:-android}"
METRO_PORT="${METRO_PORT:-8097}"
MIN_FREE_GB="${QA_MIN_FREE_GB:-15}"
ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${HOME}/Android/Sdk}"
MAESTRO_BIN="${MAESTRO_BIN:-${HOME}/.maestro/bin/maestro}"
APP_PACKAGE="${APP_PACKAGE:-br.com.leaf.ride}"
DRIVER_AVD="${DRIVER_AVD:-Leaf_API_35_Driver}"
REQUIRE_METRO_READY="${REQUIRE_METRO_READY:-false}"
REQUIRE_IOS_SIGNING="${REQUIRE_IOS_SIGNING:-false}"
OUTPUT_DIR="${QA_HOST_READINESS_OUTPUT_DIR:-${MOBILE_DIR}/test-results/qa-host-readiness-$(date -u +%Y%m%dT%H%M%SZ)}"
CHECKS_FILE="${OUTPUT_DIR}/checks.tsv"

mkdir -p "${OUTPUT_DIR}"
: > "${CHECKS_FILE}"

HOST_STATUS="ready"
JAVA_HOME_RESOLVED=""

log() {
  printf '[host-readiness] %s\n' "$*"
}

sanitize() {
  printf '%s' "$*" | tr '\n\t' '  ' | cut -c 1-500
}

record() {
  local name="$1"
  local status="$2"
  local message
  message="$(sanitize "${3:-}")"
  printf '%s\t%s\t%s\n' "${name}" "${status}" "${message}" >> "${CHECKS_FILE}"
  log "${status}: ${name}${message:+ — ${message}}"
  if [[ "${status}" == "blocked" ]]; then
    HOST_STATUS="blocked"
  fi
}

command_version() {
  local command_name="$1"
  shift
  "$@" 2>&1 | head -n 1
}

java_major_for_home() {
  local candidate_java_home="$1"
  local java_version
  local java_major

  [[ -x "${candidate_java_home}/bin/java" ]] || return 1
  java_version="$("${candidate_java_home}/bin/java" -version 2>&1 | sed -n 's/.*version "\([^"]*\)".*/\1/p' | head -n 1)"
  [[ -n "${java_version}" ]] || return 1

  if [[ "${java_version}" == 1.* ]]; then
    java_major="${java_version#1.}"
    java_major="${java_major%%.*}"
  else
    java_major="${java_version%%.*}"
  fi

  [[ "${java_major}" =~ ^[0-9]+$ ]] || return 1
  printf '%s\t%s\n' "${java_major}" "${java_version}"
}

resolve_java17() {
  local candidate_java_home
  local java_info
  local java_major

  for candidate_java_home in \
    "${JAVA_HOME:-}" \
    "${HOME}/.local/jdks/temurin17/jdk-17.0.18+8/Contents/Home" \
    "${HOME}/.local/mobile-build-tools/jdk-17" \
    "/opt/homebrew/opt/openjdk@17" \
    "/usr/local/opt/openjdk@17" \
    "/opt/homebrew/opt/openjdk@21" \
    "/usr/local/opt/openjdk@21" \
    "/opt/homebrew/opt/java" \
    "/usr/local/opt/java"; do
    [[ -n "${candidate_java_home}" ]] || continue
    java_info="$(java_major_for_home "${candidate_java_home}" 2>/dev/null || true)"
    java_major="${java_info%%$'\t'*}"
    if [[ "${java_major}" =~ ^[0-9]+$ ]] && (( java_major >= 17 )); then
      JAVA_HOME_RESOLVED="${candidate_java_home}"
      return 0
    fi
  done

  if [[ -x /usr/libexec/java_home ]]; then
    candidate_java_home="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
    java_info="$(java_major_for_home "${candidate_java_home}" 2>/dev/null || true)"
    java_major="${java_info%%$'\t'*}"
    if [[ "${java_major}" =~ ^[0-9]+$ ]] && (( java_major >= 17 )); then
      JAVA_HOME_RESOLVED="${candidate_java_home}"
      return 0
    fi
  fi

  return 1
}

check_java() {
  local java_info
  local java_major
  local java_version

  if ! resolve_java17; then
    record "java17" "blocked" "Java 17+ não resolvido; JAVA_HOME e os caminhos locais conhecidos foram verificados"
    return
  fi

  java_info="$(java_major_for_home "${JAVA_HOME_RESOLVED}")"
  java_major="${java_info%%$'\t'*}"
  java_version="${java_info#*$'\t'}"
  export JAVA_HOME="${JAVA_HOME_RESOLVED}"
  export PATH="${JAVA_HOME}/bin:${PATH}"
  record "java17" "pass" "${java_version} em ${JAVA_HOME}"
}

check_command() {
  local command_name="$1"
  local label="$2"

  if command -v "${command_name}" >/dev/null 2>&1; then
    record "${label}" "pass" "$(command -v "${command_name}")"
  else
    record "${label}" "blocked" "comando não encontrado"
  fi
}

check_node() {
  local version
  local major

  if ! command -v node >/dev/null 2>&1; then
    record "node" "blocked" "Node não encontrado"
    return
  fi

  version="$(node --version 2>/dev/null || true)"
  major="${version#v}"
  major="${major%%.*}"
  if [[ "${major}" =~ ^[0-9]+$ ]] && (( major >= 20 )); then
    record "node" "pass" "${version}"
  else
    record "node" "blocked" "${version:-versão desconhecida}; mínimo operacional: Node 20"
  fi
}

check_pod() {
  local version

  if ! command -v pod >/dev/null 2>&1; then
    record "cocoapods" "blocked" "CocoaPods não encontrado"
    return
  fi

  version="$(pod --version 2>/dev/null || true)"
  if [[ -z "${version}" ]]; then
    record "cocoapods" "blocked" "não foi possível ler a versão"
    return
  fi

  if ruby -e 'exit Gem::Version.new(ARGV[0]) >= Gem::Version.new(ARGV[1]) ? 0 : 1' "${version}" "1.15.2" 2>/dev/null; then
    record "cocoapods" "pass" "${version}"
  else
    record "cocoapods" "blocked" "${version}; mínimo operacional: 1.15.2"
  fi
}

check_disk() {
  local available_kb
  local required_kb
  local available_gb

  available_kb="$(df -Pk "${ROOT_DIR}" 2>/dev/null | awk 'NR == 2 { print $4 }')"
  required_kb=$((MIN_FREE_GB * 1024 * 1024))
  available_gb="$(awk -v kb="${available_kb:-0}" 'BEGIN { printf "%.1f", kb / 1024 / 1024 }')"

  if [[ "${available_kb:-0}" =~ ^[0-9]+$ ]] && (( available_kb >= required_kb )); then
    record "disk" "pass" "${available_gb} GB livres; mínimo ${MIN_FREE_GB} GB"
  else
    record "disk" "blocked" "${available_gb} GB livres; mínimo ${MIN_FREE_GB} GB. Liberar espaço antes de build/gravação"
  fi
}

check_android_host() {
  local component
  local adb_output
  local emulator_list
  local required_avd_found="false"

  for component in \
    "${ANDROID_SDK_ROOT}/platform-tools/adb" \
    "${ANDROID_SDK_ROOT}/emulator/emulator" \
    "${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin/sdkmanager" \
    "${ANDROID_SDK_ROOT}/build-tools/35.0.0/aapt" \
    "${ANDROID_SDK_ROOT}/platforms/android-35/android.jar"; do
    if [[ -e "${component}" ]]; then
      record "android:${component##*/}" "pass" "${component}"
    else
      record "android:${component##*/}" "blocked" "ausente: ${component}"
    fi
  done

  if [[ ! -x "${ANDROID_SDK_ROOT}/platform-tools/adb" ]]; then
    return
  fi

  if adb_output="$("${ANDROID_SDK_ROOT}/platform-tools/adb" start-server 2>&1)"; then
    record "adb:daemon" "pass" "daemon inicializado"
  else
    record "adb:daemon" "blocked" "${adb_output}"
    return
  fi

  if emulator_list="$("${ANDROID_SDK_ROOT}/emulator/emulator" -list-avds 2>&1)"; then
    if printf '%s\n' "${emulator_list}" | grep -Fxq "${DRIVER_AVD}"; then
      required_avd_found="true"
    fi
    if [[ "${required_avd_found}" == "true" ]]; then
      record "android:driver-avd" "pass" "${DRIVER_AVD}"
    else
      record "android:driver-avd" "blocked" "AVD ${DRIVER_AVD} não está instalado"
    fi
  else
    record "android:emulator" "blocked" "não foi possível listar AVDs: ${emulator_list}"
  fi
}

check_ios_host() {
  local developer_dir
  local pbxproj="${MOBILE_DIR}/ios/Leaf.xcodeproj/project.pbxproj"
  local team_id
  local identity_count

  developer_dir="${DEVELOPER_DIR:-$(xcode-select -p 2>/dev/null || true)}"
  if [[ "${developer_dir}" == *"/Xcode.app/Contents/Developer" ]] && [[ -x "${developer_dir}/usr/bin/xcodebuild" ]]; then
    record "ios:xcode" "pass" "${developer_dir} ($(xcodebuild -version 2>/dev/null | head -n 1))"
  else
    record "ios:xcode" "blocked" "Xcode completo não está selecionado"
  fi

  if xcrun --find simctl >/dev/null 2>&1; then
    record "ios:simctl" "pass" "$(xcrun --find simctl)"
  else
    record "ios:simctl" "blocked" "simctl não encontrado"
  fi

  if [[ -f "${pbxproj}" ]]; then
    team_id="$(grep -Eo 'DEVELOPMENT_TEAM = [A-Z0-9]{10};' "${pbxproj}" | head -n 1 | awk '{print $3}' | tr -d ';')"
    if [[ -n "${team_id}" ]]; then
      record "ios:team-id" "pass" "${team_id} encontrado no projeto"
    else
      record "ios:team-id" "blocked" "DEVELOPMENT_TEAM não encontrado no projeto"
    fi
  else
    record "ios:project" "blocked" "projeto Xcode ausente: ${pbxproj}"
  fi

  identity_count="$(security find-identity -v -p codesigning 2>/dev/null | awk '/valid identities found/{print $1; exit}' | tr -d '[:space:]')"
  identity_count="${identity_count:-0}"
  if [[ "${REQUIRE_IOS_SIGNING}" == "true" && "${identity_count}" == "0" ]]; then
    record "ios:signing" "blocked" "nenhuma identidade válida de code signing; archive físico não está pronto"
  elif [[ "${identity_count}" =~ ^[0-9]+$ ]] && (( identity_count > 0 )); then
    record "ios:signing" "pass" "${identity_count} identidade(s) válida(s)"
  else
    record "ios:signing" "warn" "sem identidade válida; aceitável apenas para simulator sem archive assinado"
  fi
}

check_maestro() {
  local maestro_output

  if [[ ! -x "${MAESTRO_BIN}" ]]; then
    record "maestro:binary" "blocked" "executável ausente ou sem permissão: ${MAESTRO_BIN}"
    return
  fi

  if maestro_output="$(JAVA_HOME="${JAVA_HOME_RESOLVED}" PATH="${JAVA_HOME_RESOLVED}/bin:${PATH}" "${MAESTRO_BIN}" --version 2>&1)"; then
    record "maestro:runtime" "pass" "${maestro_output}"
  else
    record "maestro:runtime" "blocked" "não inicializou com Java 17: ${maestro_output}"
  fi
}

check_metro() {
  local status_output

  if ! command -v curl >/dev/null 2>&1; then
    record "metro" "blocked" "curl necessário para sondar Metro"
    return
  fi

  status_output="$(curl -fsS --max-time 3 "http://127.0.0.1:${METRO_PORT}/status" 2>/dev/null || true)"
  if [[ -n "${status_output}" ]]; then
    record "metro" "pass" "http://127.0.0.1:${METRO_PORT}/status respondeu"
  elif [[ "${REQUIRE_METRO_READY}" == "true" ]]; then
    record "metro" "blocked" "Metro não respondeu na porta ${METRO_PORT}; iniciar e aquecer antes do app"
  else
    record "metro" "pass" "porta ${METRO_PORT} livre; Metro será validado pelo runner"
  fi
}

write_summary() {
  if command -v node >/dev/null 2>&1; then
    READINESS_STATUS="${HOST_STATUS}" \
    QA_PLATFORM="${QA_PLATFORM}" \
    JAVA_HOME_RESOLVED="${JAVA_HOME_RESOLVED}" \
    ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT}" \
    MAESTRO_BIN="${MAESTRO_BIN}" \
    METRO_PORT="${METRO_PORT}" \
    MIN_FREE_GB="${MIN_FREE_GB}" \
    OUTPUT_DIR="${OUTPUT_DIR}" \
    CHECKS_FILE="${CHECKS_FILE}" \
    node - <<'NODE'
const fs = require('fs');
const path = require('path');

const checks = fs.readFileSync(process.env.CHECKS_FILE, 'utf8')
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => {
    const [name, status, ...message] = line.split('\t');
    return { name, status, message: message.join('\t') || null };
  });

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: process.env.READINESS_STATUS,
  platform: process.env.QA_PLATFORM,
  javaHome: process.env.JAVA_HOME_RESOLVED || null,
  androidSdkRoot: process.env.ANDROID_SDK_ROOT,
  maestroBin: process.env.MAESTRO_BIN,
  metroPort: Number(process.env.METRO_PORT),
  minimumFreeGb: Number(process.env.MIN_FREE_GB),
  checks,
  blockers: checks.filter((check) => check.status === 'blocked'),
  warnings: checks.filter((check) => check.status === 'warn'),
  scenarioStarted: false
};

fs.writeFileSync(
  path.join(process.env.OUTPUT_DIR, 'host-readiness.json'),
  `${JSON.stringify(summary, null, 2)}\n`
);
NODE
  fi
}

trap write_summary EXIT

log "Platform=${QA_PLATFORM}; nenhum app, seed, deep link ou corrida será iniciado"
check_java
check_node
check_command curl curl
check_command jq jq
check_pod
check_disk
check_maestro
check_metro

case "${QA_PLATFORM}" in
  android)
    check_command adb adb
    check_android_host
    ;;
  ios)
    check_ios_host
    ;;
  all)
    check_command adb adb
    check_android_host
    check_ios_host
    ;;
  *)
    record "platform" "blocked" "QA_PLATFORM inválido: ${QA_PLATFORM}; use android, ios ou all"
    ;;
esac

if [[ "${HOST_STATUS}" == "ready" ]]; then
  log "HOST_READY"
  exit 0
fi

log "HOST_BLOCKED — consulte ${OUTPUT_DIR}/host-readiness.json"
exit 1
