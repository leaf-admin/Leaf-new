#!/usr/bin/env bash

set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "${SCRIPT_SOURCE}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

load_env_file() {
  local file_path="$1"
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

    if [[ -n "${key}" ]]; then
      local current_value=""
      eval "current_value=\${${key}:-}"
      if [[ -z "${current_value}" ]]; then
        export "${key}=${value}"
      fi
    fi
  done < "${file_path}"
}

load_env_file "${PROJECT_DIR}/.env"
load_env_file "${PROJECT_DIR}/.env.local"
load_env_file "${PROJECT_DIR}/.env.production"
load_env_file "${PROJECT_DIR}/.env.production.local"

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
