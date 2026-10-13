#!/usr/bin/env bash

set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "${SCRIPT_SOURCE}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Leaf's existing Apple Developer organization. This is not a credential.
LEAF_IOS_TEAM_ID="DTA8W5KA5D"

assert_leaf_ios_team() {
  local selected_team="$1"
  local expected_team="DTA8W5KA5D"
  if [[ "${selected_team}" != "${expected_team}" ]]; then
    echo "❌ Assinatura bloqueada: o Team ID deve ser ${expected_team} (Leaf)." >&2
    return 1
  fi
}

load_env_file() {
  local file_path="$1"
  local override="${2:-false}"
  [[ -f "${file_path}" ]] || return 0

  while IFS= read -r raw_line || [[ -n "${raw_line}" ]]; do
    local line="${raw_line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "${line}" || "${line}" == \#* ]] && continue

    line="${line#export }"
    [[ "${line}" == *=* ]] || continue

    local key="${line%%=*}"
    local value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    key="${key#"${key%%[![:space:]]*}"}"

    if [[ "${value}" == \"*\" && "${value}" == *\" ]]; then
      value="${value#\"}"
      value="${value%\"}"
    elif [[ "${value}" == \'*\' && "${value}" == *\' ]]; then
      value="${value#\'}"
      value="${value%\'}"
    fi

    if [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      local current_value=""
      eval "current_value=\${${key}:-}"
      if [[ "${override}" == "true" || -z "${current_value}" ]]; then
        export "${key}=${value}"
      fi
    fi
  done < "${file_path}"
}

if [[ -n "${LEAF_ENV_FILE:-}" ]]; then
  leaf_selected_env_file="${LEAF_ENV_FILE}"
  [[ "${leaf_selected_env_file}" == /* ]] || leaf_selected_env_file="${PROJECT_DIR}/${leaf_selected_env_file}"
  if [[ ! -f "${leaf_selected_env_file}" ]]; then
    echo "❌ LEAF_ENV_FILE aponta para um arquivo inexistente." >&2
    return 1 2>/dev/null || exit 1
  fi
  load_env_file "${leaf_selected_env_file}" true
else
  load_env_file "${PROJECT_DIR}/.env"
  load_env_file "${PROJECT_DIR}/.env.local"
  load_env_file "${PROJECT_DIR}/.env.production"
  load_env_file "${PROJECT_DIR}/.env.production.local"
fi

# Local native builds use the same public values as the selected EAS profile.
# An explicitly selected QA env remains authoritative instead of merging release.
load_eas_build_profile_env() {
  [[ -z "${LEAF_ENV_FILE:-}" ]] || return 0
  local profile="${EAS_BUILD_PROFILE:-${LEAF_BUILD_PROFILE:-}}"
  [[ -n "${profile}" ]] || return 0
  local profile_values
  profile_values="$(node - "${PROJECT_DIR}/eas.json" "${profile}" <<'NODE'
const fs = require('fs');
const eas = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const profile = eas.build?.[process.argv[3]];
if (!profile) {
  console.error('Selected EAS build profile does not exist.');
  process.exit(1);
}
for (const [key, value] of Object.entries(profile.env || {})) {
  console.log(`${key}\t${String(value)}`);
}
NODE
)" || return 1
  local key value
  while IFS=$'\t' read -r key value; do
    [[ -n "${key}" ]] && export "${key}=${value}"
  done <<< "${profile_values}"
  return 0
}

ensure_xcode_developer_dir() {
  local preferred_developer_dir="/Applications/Xcode.app/Contents/Developer"
  local current_developer_dir=""

  current_developer_dir="$(xcode-select -p 2>/dev/null || true)"

  if [[ -n "${DEVELOPER_DIR:-}" && -d "${DEVELOPER_DIR}" ]]; then
    return 0
  fi

  if [[ -d "${preferred_developer_dir}" ]]; then
    if [[ "${current_developer_dir}" == "/Library/Developer/CommandLineTools" || -z "${current_developer_dir}" ]]; then
      export DEVELOPER_DIR="${preferred_developer_dir}"
      return 0
    fi

    if ! xcrun simctl help >/dev/null 2>&1; then
      export DEVELOPER_DIR="${preferred_developer_dir}"
      return 0
    fi
  fi
}

ensure_xcode_developer_dir

assert_full_xcode_toolchain() {
  local context="${1:-build iOS}"
  local require_simctl="${2:-1}"
  local selected_developer_dir=""
  local active_developer_dir=""
  local xcode_version=""

  selected_developer_dir="$(xcode-select -p 2>/dev/null || true)"
  active_developer_dir="${DEVELOPER_DIR:-${selected_developer_dir}}"

  if [[ -z "${active_developer_dir}" || ! -d "${active_developer_dir}" || "${active_developer_dir}" != *"/Xcode.app/Contents/Developer" ]]; then
    echo "❌ Xcode completo não está ativo para ${context}."
    echo "   xcode-select: ${selected_developer_dir:-<vazio>}"
    echo "   DEVELOPER_DIR: ${DEVELOPER_DIR:-<vazio>}"
    echo "   Esperado: /Applications/Xcode.app/Contents/Developer"
    echo "   Não gere build iOS com CommandLineTools."
    exit 1
  fi

  if ! xcode_version="$(xcodebuild -version 2>/dev/null | tr '\n' ' ' | sed 's/[[:space:]]*$//')"; then
    echo "❌ xcodebuild não está funcional para ${context}."
    echo "   xcode-select: ${selected_developer_dir:-<vazio>}"
    echo "   DEVELOPER_DIR: ${DEVELOPER_DIR:-<vazio>}"
    echo "   Use: export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer"
    exit 1
  fi

  if [[ "${require_simctl}" == "1" ]] && ! xcrun --find simctl >/dev/null 2>&1; then
    echo "❌ simctl não está disponível para ${context}."
    echo "   xcode-select: ${selected_developer_dir:-<vazio>}"
    echo "   DEVELOPER_DIR: ${DEVELOPER_DIR:-<vazio>}"
    echo "   Isso costuma acontecer quando o Mac aponta para CommandLineTools."
    exit 1
  fi

  echo "✅ Xcode toolchain ativo (${context}): ${xcode_version}"
}

if [[ -z "${EXPO_PUBLIC_GOOGLE_MAPS_API_KEY:-}" && -n "${GOOGLE_MAPS_API_KEY:-}" ]]; then
  export EXPO_PUBLIC_GOOGLE_MAPS_API_KEY="${GOOGLE_MAPS_API_KEY}"
fi
if [[ -z "${GOOGLE_MAPS_API_KEY:-}" && -n "${EXPO_PUBLIC_GOOGLE_MAPS_API_KEY:-}" ]]; then
  export GOOGLE_MAPS_API_KEY="${EXPO_PUBLIC_GOOGLE_MAPS_API_KEY}"
fi

# Ensure Node from nvm is available for expo/rn tooling.
if [[ -z "${NVM_DIR:-}" ]]; then
  export NVM_DIR="${HOME}/.nvm"
fi
if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  . "${NVM_DIR}/nvm.sh"
  nvm use 24 >/dev/null 2>&1 || true
fi

# Android SDK defaults.
export ANDROID_SDK_ROOT="${ANDROID_SDK_ROOT:-${HOME}/Android/Sdk}"
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT}}"

# Prefer a verified local Java 17+ toolchain. The host may expose Java 8 as
# `java`, while the QA/build tools require Java 17 or newer. Do not preserve a
# pre-existing JAVA_HOME unless it actually satisfies that contract.
java_home_is_compatible() {
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

  [[ "${java_major}" =~ ^[0-9]+$ ]] && (( java_major >= 17 ))
}

resolve_java_home() {
  local candidate_java_home

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
    if java_home_is_compatible "${candidate_java_home}"; then
      export JAVA_HOME="${candidate_java_home}"
      return 0
    fi
  done

  if command -v /usr/libexec/java_home >/dev/null 2>&1; then
    candidate_java_home="$(/usr/libexec/java_home -v 17 2>/dev/null || true)"
    if java_home_is_compatible "${candidate_java_home}"; then
      export JAVA_HOME="${candidate_java_home}"
      return 0
    fi
  fi

  unset JAVA_HOME
  return 1
}

resolve_java_home || true

# CocoaPods installed via --user-install lives in Gem.user_dir/bin.
GEM_USER_BIN="$(ruby -e 'print Gem.user_dir' 2>/dev/null || true)/bin"

export PATH="${GEM_USER_BIN}:${JAVA_HOME:-}/bin:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${ANDROID_SDK_ROOT}/emulator:${PATH}"

# Gradle can be memory intensive on local laptops.
export GRADLE_OPTS="${GRADLE_OPTS:--Dorg.gradle.jvmargs=-Xmx4g -Dkotlin.daemon.jvm.options=-Xmx2g}"
export EXPO_NO_TELEMETRY=1
export CI=1
