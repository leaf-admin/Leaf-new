#!/usr/bin/env bash

# Canonical environment for the bilateral E3 preparation/run.
#
# Source this file from the Leaf root before invoking
# `prepare-real-smoke-env.sh` or the generated Android smoke wrapper. It only
# exports local process variables; it does not contact a provider, mutate
# Firebase/Redis, or start a device. Keep credentials in the operator shell or
# secret manager, never in this file.

set -euo pipefail

SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "${SCRIPT_SOURCE}")" && pwd)"
MOBILE_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ROOT_DIR="$(cd "${MOBILE_DIR}/.." && pwd)"

if [[ -f "${MOBILE_DIR}/scripts/source-local-build-env.sh" ]]; then
  # shellcheck source=/dev/null
  source "${MOBILE_DIR}/scripts/source-local-build-env.sh"
fi

# E3 must exercise the production-shaped app with backend/provider policy as
# the authority. These values are intentionally forced off rather than using
# caller defaults from the debug E2E helper.
export APP_REVIEW=false
export EXPO_PUBLIC_APP_REVIEW=false
export EXPO_PUBLIC_E2E_TEST=false
export EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS=false
export EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW=false
export EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK=false
export EXPO_PUBLIC_FORCE_PAYMENT_BYPASS=false
export EXPO_PUBLIC_BYPASS_PAYMENTS=false
export EXPO_PUBLIC_ALLOW_CLIENT_DIRECT_GOOGLE_FALLBACK=false
export EXPO_PUBLIC_ALLOW_INSECURE_HTTP=false

# Controlled-pilot product profile. Non-core surfaces remain frozen unless the
# approved pilot configuration explicitly enables them in the backend.
export EXPO_PUBLIC_LEAF_LAUNCH_PROFILE=pilot_controlled
export EXPO_PUBLIC_PILOT_CONTROLLED=true
export LEAF_LAUNCH_PROFILE=pilot_controlled
export LEAF_PILOT_CONTROLLED=true
export LEAF_RUNTIME_POLICY_VERSION="${LEAF_RUNTIME_POLICY_VERSION:-pilot-rc-1}"
export PAYMENT_RUNTIME_EXPECTED_ENVIRONMENT=sandbox

export EXPO_PUBLIC_ENABLE_DRIVER_WITHDRAWALS=false
export EXPO_PUBLIC_ENABLE_REFERRAL_PROGRAMS=false
export EXPO_PUBLIC_ENABLE_LEAF_DELAS=false
export EXPO_PUBLIC_ENABLE_DRIVER_DESTINATION_MODE=false
export EXPO_PUBLIC_ENABLE_DYNAMIC_PRICING=false
export EXPO_PUBLIC_ENABLE_SMART_PUSH=false
export EXPO_PUBLIC_ENABLE_SOFT_BAN_ENFORCEMENT=false
export EXPO_PUBLIC_ENABLE_ADMIN_MUTATIONS=false

# Canonical Android L2 pairing: passenger on the approved physical device,
# driver on the dedicated emulator. The physical serial is intentionally not
# filled here; it must be supplied by ADB when the operator connects it.
export APP_PACKAGE="${APP_PACKAGE:-br.com.leaf.ride}"
export PASSENGER_RUNTIME=android_device
export DRIVER_RUNTIME=android_emulator
export PASSENGER_AVD="${PASSENGER_AVD:-Leaf_API_35}"
export DRIVER_AVD="${DRIVER_AVD:-Leaf_API_35_Driver}"
export REQUIRE_ANDROID_ROLE_PAIR=true
export REQUIRE_RUNNING_ANDROID_EMULATOR=true
export REQUIRE_RUNNING_ANDROID_APP=true
export REQUIRE_MATCHING_ANDROID_APP_VERSION=true
export ANDROID_EMULATOR_STABILITY_SECONDS="${ANDROID_EMULATOR_STABILITY_SECONDS:-60}"
export REAL_SMOKE_DRIVER_SURFACE_MODE=app
export REAL_SMOKE_REQUIRE_CANONICAL_PICKUP=true
export REAL_SMOKE_REQUIRE_POST_TRIP=true
export REAL_SMOKE_VERIFY_ACTIVE_TRIP_MAP_TAP=true
export REAL_SMOKE_COMPLETE_EXISTING_RECEIPT=true
export REQUIRE_ANDROID_LOCATION_PROVIDER_CONVERGENCE=true
export USE_DEVICE_LOCATION_FOR_PICKUP=true
export ALLOW_DEVICE_MISSING=false
export PREPARE_DRIVER="${PREPARE_DRIVER:-false}"

# The identifiers below are the documented QA cohort, not credentials. They
# can be overridden from the operator shell when the approved staging cohort
# changes. The phone is used only for the user-scoped sandbox canary.
export PASSENGER_UID="${PASSENGER_UID:-3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2}"
export PASSENGER_PHONE="${PASSENGER_PHONE:-21102938475}"
export DRIVER_UID="${DRIVER_UID:-DV4cwZvql3T3pI3lnKYQwQVALKZ2}"

# Certified route used by the geofence preflight. The app's resolved device
# location still has precedence; divergence remains a blocked precondition.
export PICKUP_LAT="${PICKUP_LAT:--22.97104}"
export PICKUP_LNG="${PICKUP_LNG:--43.18349}"
export DESTINATION_LAT="${DESTINATION_LAT:--22.98488}"
export DESTINATION_LNG="${DESTINATION_LNG:--43.22215}"

export ADB_BIN="${ADB_BIN:-${ANDROID_SDK_ROOT}/platform-tools/adb}"
export MAESTRO_BIN="${MAESTRO_BIN:-${HOME}/.maestro/bin/maestro}"
export METRO_PORT="${METRO_PORT:-8097}"

if [[ "${SCRIPT_SOURCE}" == "$0" ]]; then
  cat <<SUMMARY
[e3-env] Leaf bilateral E3 environment loaded
[e3-env] launch profile: ${EXPO_PUBLIC_LEAF_LAUNCH_PROFILE}
[e3-env] payment bypass: ${EXPO_PUBLIC_FORCE_PAYMENT_BYPASS}
[e3-env] QA OTP force: ${EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW}
[e3-env] custom OTP fallback: ${EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK}
[e3-env] passenger runtime: ${PASSENGER_RUNTIME}
[e3-env] driver runtime: ${DRIVER_RUNTIME} (${DRIVER_AVD})
[e3-env] Metro: ${METRO_PORT}
[e3-env] PREPARE_DRIVER: ${PREPARE_DRIVER}

Next safe step after the host and physical device gates pass:
  source ${ROOT_DIR}/mobile-app/scripts/qa/e3-controlled-env.sh
  bash ${ROOT_DIR}/mobile-app/scripts/qa/prepare-real-smoke-env.sh
SUMMARY
fi
