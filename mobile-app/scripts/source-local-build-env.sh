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

# Prefer local toolchain Java if present.
LOCAL_JAVA_HOME="${HOME}/.local/mobile-build-tools/jdk-17"
if [[ -d "${LOCAL_JAVA_HOME}" ]]; then
  export JAVA_HOME="${JAVA_HOME:-${LOCAL_JAVA_HOME}}"
fi

# CocoaPods installed via --user-install lives in Gem.user_dir/bin.
GEM_USER_BIN="$(ruby -e 'print Gem.user_dir' 2>/dev/null || true)/bin"

export PATH="${GEM_USER_BIN}:${JAVA_HOME:-}/bin:${ANDROID_SDK_ROOT}/cmdline-tools/latest/bin:${ANDROID_SDK_ROOT}/platform-tools:${ANDROID_SDK_ROOT}/emulator:${PATH}"

# Gradle can be memory intensive on local laptops.
export GRADLE_OPTS="${GRADLE_OPTS:--Dorg.gradle.jvmargs=-Xmx4g -Dkotlin.daemon.jvm.options=-Xmx2g}"
export EXPO_NO_TELEMETRY=1
export CI=1
