#!/usr/bin/env bash
set -euo pipefail

# Defaults (can be overridden via env vars)
PASSENGER_UDID="${PASSENGER_UDID:-195D2C57-87DC-4953-ABF1-4FD351ADBBEF}" # iPhone 17 Pro (iOS 26.4)
DRIVER_UDID="${DRIVER_UDID:-2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C}"      # iPhone 17 Pro Max (iOS 26.4)
PASSENGER_PORT="${PASSENGER_PORT:-8081}"
DRIVER_PORT="${DRIVER_PORT:-8082}"

LAN_IP="${LAN_IP:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo 127.0.0.1)}"

if [[ "${LAN_IP}" == "127.0.0.1" ]]; then
  echo "[warn] LAN IP não detectado; usando 127.0.0.1."
fi

echo "[info] IP LAN: ${LAN_IP}"
echo "[info] Passageiro: ${PASSENGER_UDID} -> :${PASSENGER_PORT}"
echo "[info] Motorista: ${DRIVER_UDID} -> :${DRIVER_PORT}"

open -a Simulator

# Boot simulators if needed
xcrun simctl boot "${PASSENGER_UDID}" >/dev/null 2>&1 || true
xcrun simctl boot "${DRIVER_UDID}" >/dev/null 2>&1 || true

# Prevent Expo dev-menu onboarding popup from blocking app start
for UDID in "${PASSENGER_UDID}" "${DRIVER_UDID}"; do
  xcrun simctl spawn "${UDID}" defaults write br.com.leaf.ride EXDevMenuIsOnboardingFinished -bool YES || true
  xcrun simctl spawn "${UDID}" defaults write br.com.leaf.ride EXDevMenuShowsAtLaunch -bool NO || true
  xcrun simctl terminate "${UDID}" br.com.leaf.ride >/dev/null 2>&1 || true
done

sleep 1

PASSENGER_ENCODED_URL="http%3A%2F%2F${LAN_IP}%3A${PASSENGER_PORT}"
DRIVER_ENCODED_URL="http%3A%2F%2F${LAN_IP}%3A${DRIVER_PORT}"

PASSENGER_DEEPLINK="exp+leafapp-reactnative://expo-development-client/?url=${PASSENGER_ENCODED_URL}"
DRIVER_DEEPLINK="exp+leafapp-reactnative://expo-development-client/?url=${DRIVER_ENCODED_URL}"

xcrun simctl openurl "${PASSENGER_UDID}" "${PASSENGER_DEEPLINK}"
xcrun simctl openurl "${DRIVER_UDID}" "${DRIVER_DEEPLINK}"

echo "[ok] Deep links enviados."
echo "[note] Isso só muda a origem do bundle (Metro local). O backend permanece na VPS via EXPO_PUBLIC_API_URL."
