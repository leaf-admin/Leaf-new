#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# shellcheck source=/dev/null
source "${SCRIPT_DIR}/source-local-build-env.sh"
cd "${PROJECT_DIR}"

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
VOICE_PLUGIN_ENABLED=0

if rg -q '"expo-speech-recognition"' "${APP_CONFIG}"; then
  VOICE_PLUGIN_ENABLED=1
fi

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

if [[ "${VOICE_PLUGIN_ENABLED}" -eq 1 ]]; then
  if rg -q 'android.permission.RECORD_AUDIO"' "${ANDROID_MANIFEST}"; then
    ok "AndroidManifest mantém RECORD_AUDIO (voz habilitada)"
  else
    fail "AndroidManifest sem RECORD_AUDIO apesar de voz habilitada"
  fi
else
  if rg -q 'android.permission.RECORD_AUDIO" tools:node="remove"' "${ANDROID_MANIFEST}"; then
    ok "AndroidManifest remove RECORD_AUDIO (voz desabilitada)"
  else
    fail "AndroidManifest não remove RECORD_AUDIO com voz desabilitada"
  fi
fi

if ! command -v npx >/dev/null 2>&1; then
  fail "npx não encontrado para validar config final do Expo"
else
  TMP_JSON="$(mktemp /tmp/leaf-expo-config-hardening.XXXXXX.json)"
  npx expo config --type prebuild --json > "${TMP_JSON}"

  MICROPHONE_VALUE="$(jq -r '.ios.infoPlist.NSMicrophoneUsageDescription // "<none>"' "${TMP_JSON}")"
  SPEECH_VALUE="$(jq -r '.ios.infoPlist.NSSpeechRecognitionUsageDescription // "<none>"' "${TMP_JSON}")"
  ANDROID_HAS_RECORD_AUDIO=0
  ANDROID_HAS_POST_NOTIFICATIONS=0
  if jq -r '.android.permissions[]?' "${TMP_JSON}" | rg -q '^android.permission.RECORD_AUDIO$'; then
    ANDROID_HAS_RECORD_AUDIO=1
  fi
  if jq -r '.android.permissions[]?' "${TMP_JSON}" | rg -q '^android.permission.POST_NOTIFICATIONS$'; then
    ANDROID_HAS_POST_NOTIFICATIONS=1
  fi
  IOS_HAS_REMOTE_NOTIFICATION=0
  if jq -r '.ios.infoPlist.UIBackgroundModes[]?' "${TMP_JSON}" | rg -q '^remote-notification$'; then
    IOS_HAS_REMOTE_NOTIFICATION=1
  fi

  if [[ "${ANDROID_HAS_POST_NOTIFICATIONS}" -eq 1 ]]; then
    ok "Expo config final Android contém POST_NOTIFICATIONS"
  else
    fail "Expo config final Android sem POST_NOTIFICATIONS"
  fi

  if [[ "${IOS_HAS_REMOTE_NOTIFICATION}" -eq 1 ]]; then
    ok "Expo config final iOS contém UIBackgroundModes remote-notification"
  else
    fail "Expo config final iOS sem UIBackgroundModes remote-notification"
  fi

  if [[ "${VOICE_PLUGIN_ENABLED}" -eq 1 ]]; then
    if [[ "${MICROPHONE_VALUE}" != "<none>" ]]; then
      ok "Expo config final iOS contém NSMicrophoneUsageDescription (voz habilitada)"
    else
      fail "Expo config final iOS sem NSMicrophoneUsageDescription com voz habilitada"
    fi

    if [[ "${SPEECH_VALUE}" != "<none>" ]]; then
      ok "Expo config final iOS contém NSSpeechRecognitionUsageDescription (voz habilitada)"
    else
      fail "Expo config final iOS sem NSSpeechRecognitionUsageDescription com voz habilitada"
    fi

    if [[ "${ANDROID_HAS_RECORD_AUDIO}" -eq 1 ]]; then
      ok "Expo config final Android contém RECORD_AUDIO (voz habilitada)"
    else
      fail "Expo config final Android sem RECORD_AUDIO com voz habilitada"
    fi
  else
    if [[ "${MICROPHONE_VALUE}" == "<none>" ]]; then
      ok "Expo config final iOS sem NSMicrophoneUsageDescription (voz desabilitada)"
    else
      fail "Expo config final iOS contém NSMicrophoneUsageDescription com voz desabilitada (${MICROPHONE_VALUE})"
    fi

    if [[ "${SPEECH_VALUE}" == "<none>" ]]; then
      ok "Expo config final iOS sem NSSpeechRecognitionUsageDescription (voz desabilitada)"
    else
      fail "Expo config final iOS contém NSSpeechRecognitionUsageDescription com voz desabilitada (${SPEECH_VALUE})"
    fi

    if [[ "${ANDROID_HAS_RECORD_AUDIO}" -eq 1 ]]; then
      fail "Expo config final Android contém RECORD_AUDIO com voz desabilitada"
    else
      ok "Expo config final Android sem RECORD_AUDIO (voz desabilitada)"
    fi
  fi

  rm -f "${TMP_JSON}"
fi

if [[ "${FAIL}" -ne 0 ]]; then
  printf "\nHardening de permissões: FALHOU\n"
  exit 1
fi

printf "\nHardening de permissões: PASS\n"
