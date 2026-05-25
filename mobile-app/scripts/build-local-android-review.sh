#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:-release}"

export APP_REVIEW=true
export EXPO_PUBLIC_APP_REVIEW=true

exec "${SCRIPT_DIR}/build-local-android.sh" "${MODE}"
