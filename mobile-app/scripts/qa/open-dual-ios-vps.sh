#!/usr/bin/env bash
set -euo pipefail

# Defaults (can be overridden via env vars)
PASSENGER_UDID="${PASSENGER_UDID:-6BC9EC30-C939-4598-A85D-A9E071E90CE5}" # Leaf iPhone 17 Dedicated (iOS 26.5)
DRIVER_UDID="${DRIVER_UDID:-C52FE30B-CB7E-4628-B352-27143BF6E9D7}"      # Serafy QA iPhone 17 (iOS 26.5)
SHARED_METRO_PORT="${SHARED_METRO_PORT:-8097}"
PASSENGER_PORT="${PASSENGER_PORT:-${SHARED_METRO_PORT}}"
DRIVER_PORT="${DRIVER_PORT:-${SHARED_METRO_PORT}}"

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
