#!/usr/bin/env bash
set -euo pipefail

# Example only. Keep the real script and real secrets outside git.
# Suggested layout:
#   ~/.leaf/secrets/canary/backend/.env
#   ~/.leaf/secrets/canary/mobile/.env.production
#   ~/.leaf/secrets/canary/mobile/google-services.json

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SECRETS_ROOT="${LEAF_SECRETS_ROOT:-$HOME/.leaf/secrets/canary}"

copy_secret() {
  local source_path="$1"
  local target_path="$2"

  if [[ ! -f "$source_path" ]]; then
    echo "[materialize-secrets] missing: $source_path" >&2
    return 1
  fi

  mkdir -p "$(dirname "$target_path")"
  cp "$source_path" "$target_path"
  chmod 600 "$target_path" 2>/dev/null || true
  echo "[materialize-secrets] wrote: ${target_path#$ROOT_DIR/}"
}

copy_secret "$SECRETS_ROOT/dashboard/.env.local" "$ROOT_DIR/leaf-dashboard-js/.env.local"

copy_secret "$SECRETS_ROOT/backend/.env" "$ROOT_DIR/leaf-websocket-backend/.env"
copy_secret "$SECRETS_ROOT/backend/.env.production" "$ROOT_DIR/leaf-websocket-backend/.env.production"
copy_secret "$SECRETS_ROOT/backend/.env.production.sandbox" "$ROOT_DIR/leaf-websocket-backend/.env.production.sandbox"
copy_secret "$SECRETS_ROOT/backend/firebase-credentials.json" "$ROOT_DIR/leaf-websocket-backend/firebase-credentials.json"
copy_secret "$SECRETS_ROOT/backend/firebase-adminsdk.json" "$ROOT_DIR/leaf-websocket-backend/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json"

copy_secret "$SECRETS_ROOT/mobile/.env" "$ROOT_DIR/mobile-app/.env"
copy_secret "$SECRETS_ROOT/mobile/.env.local" "$ROOT_DIR/mobile-app/.env.local"
copy_secret "$SECRETS_ROOT/mobile/.env.production" "$ROOT_DIR/mobile-app/.env.production"
copy_secret "$SECRETS_ROOT/mobile/.env.production.local" "$ROOT_DIR/mobile-app/.env.production.local"
copy_secret "$SECRETS_ROOT/mobile/google-services.json" "$ROOT_DIR/mobile-app/android/app/google-services.json"
copy_secret "$SECRETS_ROOT/mobile/GoogleService-Info.plist" "$ROOT_DIR/mobile-app/ios/Leaf/GoogleService-Info.plist"
copy_secret "$SECRETS_ROOT/mobile/firebase-adminsdk.json" "$ROOT_DIR/mobile-app/config/leaf-reactnative-firebase-adminsdk-fbsvc-456a95e2fc.json"
copy_secret "$SECRETS_ROOT/mobile/leaf-release-key.keystore" "$ROOT_DIR/mobile-app/leaf-release-key.keystore"
copy_secret "$SECRETS_ROOT/mobile/leaf-production-release.keystore" "$ROOT_DIR/mobile-app/leaf-production-release.keystore"
copy_secret "$SECRETS_ROOT/mobile/freedom-tech-leaf.jks" "$ROOT_DIR/mobile-app/@freedom-tech-organization__leaf.jks"

copy_secret "$SECRETS_ROOT/face-compare/.env" "$ROOT_DIR/services/face-compare-service/.env"

echo "[materialize-secrets] done"
