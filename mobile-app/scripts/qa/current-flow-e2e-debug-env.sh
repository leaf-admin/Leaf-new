#!/usr/bin/env bash

# Source this file before building/running the debug E2E lab.
# It intentionally does not change backend production flags; payment strategy
# must be chosen explicitly per test round.

SCRIPT_SOURCE="${BASH_SOURCE[0]:-$0}"
SCRIPT_DIR="$(cd "$(dirname "${SCRIPT_SOURCE}")" && pwd)"
MOBILE_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# shellcheck source=/dev/null
source "${MOBILE_DIR}/scripts/source-local-build-env.sh"

export APP_REVIEW="${APP_REVIEW:-false}"
export EXPO_PUBLIC_APP_REVIEW="${EXPO_PUBLIC_APP_REVIEW:-false}"
export EXPO_PUBLIC_E2E_TEST="${EXPO_PUBLIC_E2E_TEST:-1}"
export EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS="${EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS:-1}"
export EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW="${EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW:-1}"
export EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK="${EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK:-1}"
export LEAF_DISABLE_UPDATES_FOR_SIMULATOR="${LEAF_DISABLE_UPDATES_FOR_SIMULATOR:-1}"
export LEAF_INCLUDE_DEV_CLIENT="${LEAF_INCLUDE_DEV_CLIENT:-1}"
export LEAF_LAUNCH_PROFILE="${LEAF_LAUNCH_PROFILE:-ride_flow_validation}"
export EXPO_PUBLIC_LEAF_LAUNCH_PROFILE="${EXPO_PUBLIC_LEAF_LAUNCH_PROFILE:-${LEAF_LAUNCH_PROFILE}}"
export EAS_BUILD_PROFILE="${EAS_BUILD_PROFILE:-development}"
export LEAF_BUILD_PROFILE="${LEAF_BUILD_PROFILE:-development}"
export EXPO_UPDATE_CHANNEL="${EXPO_UPDATE_CHANNEL:-development}"
export EAS_UPDATE_CHANNEL="${EAS_UPDATE_CHANNEL:-development}"
export LEAF_UPDATES_CHANNEL="${LEAF_UPDATES_CHANNEL:-development}"

# Product flags must mirror the controlled-pilot runtime. The lab validates the
# product that can actually ship; optional or disabled surfaces need an explicit
# override in a dedicated test round instead of silently entering the baseline.
export EXPO_PUBLIC_ENABLE_DRIVER_WITHDRAWALS="${EXPO_PUBLIC_ENABLE_DRIVER_WITHDRAWALS:-false}"
export EXPO_PUBLIC_ENABLE_REFERRAL_PROGRAMS="${EXPO_PUBLIC_ENABLE_REFERRAL_PROGRAMS:-false}"
export EXPO_PUBLIC_ENABLE_LEAF_DELAS="${EXPO_PUBLIC_ENABLE_LEAF_DELAS:-false}"
export EXPO_PUBLIC_ENABLE_DRIVER_DESTINATION_MODE="${EXPO_PUBLIC_ENABLE_DRIVER_DESTINATION_MODE:-false}"
export EXPO_PUBLIC_ENABLE_DYNAMIC_PRICING="${EXPO_PUBLIC_ENABLE_DYNAMIC_PRICING:-false}"
export EXPO_PUBLIC_ENABLE_SMART_PUSH="${EXPO_PUBLIC_ENABLE_SMART_PUSH:-false}"
export EXPO_PUBLIC_ENABLE_SOFT_BAN_ENFORCEMENT="${EXPO_PUBLIC_ENABLE_SOFT_BAN_ENFORCEMENT:-false}"
export EXPO_PUBLIC_ENABLE_ADMIN_MUTATIONS="${EXPO_PUBLIC_ENABLE_ADMIN_MUTATIONS:-false}"

# Client-side bypass remains off by default. The doctor is authoritative about
# the remote Woovi environment; never describe production as sandbox here.
export EXPO_PUBLIC_FORCE_PAYMENT_BYPASS="${EXPO_PUBLIC_FORCE_PAYMENT_BYPASS:-false}"
export EXPO_PUBLIC_BYPASS_PAYMENTS="${EXPO_PUBLIC_BYPASS_PAYMENTS:-false}"

export ADB_BIN="${ADB_BIN:-${ANDROID_SDK_ROOT}/platform-tools/adb}"
export SIMCTL_BIN="${SIMCTL_BIN:-/Applications/Xcode.app/Contents/Developer/usr/bin/simctl}"

if [[ "${SCRIPT_SOURCE}" == "$0" ]]; then
  echo "Current-flow E2E debug env loaded values:"
  echo "  EXPO_PUBLIC_E2E_TEST=${EXPO_PUBLIC_E2E_TEST}"
  echo "  EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS=${EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS}"
  echo "  EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW=${EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW}"
  echo "  LEAF_DISABLE_UPDATES_FOR_SIMULATOR=${LEAF_DISABLE_UPDATES_FOR_SIMULATOR}"
  echo "  EXPO_PUBLIC_FORCE_PAYMENT_BYPASS=${EXPO_PUBLIC_FORCE_PAYMENT_BYPASS}"
  echo "  ADB_BIN=${ADB_BIN}"
  echo "  SIMCTL_BIN=${SIMCTL_BIN}"
  echo
  echo "Use with:"
  echo "  source ${SCRIPT_SOURCE}"
fi
