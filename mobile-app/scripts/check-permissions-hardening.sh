#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/source-local-build-env.sh"

FAIL=0

ok() {
  echo "✅ $1"
}

fail() {
  echo "❌ $1"
  FAIL=1
}

APP_CONFIG="${PROJECT_DIR}/app.config.js"
ANDROID_MANIFEST="${PROJECT_DIR}/android/app/src/main/AndroidManifest.xml"

if rg -q '"microphonePermission"\s*:\s*false' "${APP_CONFIG}"; then
  ok "expo-audio: microphonePermission=false configurado"
else
  fail "expo-audio: microphonePermission=false ausente em app.config.js"
fi

if rg -q '"recordAudioAndroid"\s*:\s*false' "${APP_CONFIG}"; then
  ok "expo-audio: recordAudioAndroid=false configurado"
else
  fail "expo-audio: recordAudioAndroid=false ausente em app.config.js"
fi

if rg -q 'android.permission.RECORD_AUDIO" tools:node="remove"' "${ANDROID_MANIFEST}"; then
  ok "AndroidManifest remove RECORD_AUDIO"
else
  fail "AndroidManifest não remove RECORD_AUDIO"
fi

if ! command -v npx >/dev/null 2>&1; then
  fail "npx não encontrado para validar config final do Expo"
else
  TMP_JSON="$(mktemp /tmp/leaf-expo-config-hardening.XXXXXX.json)"
  npx expo config --type prebuild --json > "${TMP_JSON}"

  MICROPHONE_VALUE="$(jq -r '.ios.infoPlist.NSMicrophoneUsageDescription // "<none>"' "${TMP_JSON}")"
  if [[ "${MICROPHONE_VALUE}" == "<none>" ]]; then
    ok "Expo config final iOS sem NSMicrophoneUsageDescription"
  else
    fail "Expo config final iOS ainda contém NSMicrophoneUsageDescription (${MICROPHONE_VALUE})"
  fi

  if jq -r '.android.permissions[]?' "${TMP_JSON}" | rg -q '^android.permission.RECORD_AUDIO$'; then
    fail "Expo config final Android ainda contém RECORD_AUDIO"
  else
    ok "Expo config final Android sem RECORD_AUDIO"
  fi

  rm -f "${TMP_JSON}"
fi

if [[ "${FAIL}" -ne 0 ]]; then
  printf "\nHardening de permissões: FALHOU\n"
  exit 1
fi

printf "\nHardening de permissões: PASS\n"
