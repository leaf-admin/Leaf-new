#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_OVERRIDE_DIR="$ROOT_DIR/.hermes-override"
LOCAL_HERMES_BIN="$ROOT_DIR/node_modules/react-native/sdks/hermesc/osx-bin/hermesc"
WORKSPACE_HERMES_BIN="$ROOT_DIR/../node_modules/react-native/sdks/hermesc/osx-bin/hermesc"
LOCAL_EXPO_CLI="$ROOT_DIR/node_modules/expo/bin/cli"
ROOT_EXPO_CLI="$ROOT_DIR/../node_modules/expo/bin/cli"

if [ -x "$LOCAL_HERMES_BIN" ]; then
  HERMES_SOURCE_BIN="$LOCAL_HERMES_BIN"
elif [ -x "$WORKSPACE_HERMES_BIN" ]; then
  HERMES_SOURCE_BIN="$WORKSPACE_HERMES_BIN"
else
  echo "Hermes compiler não encontrado nos caminhos suportados:"
  echo "- $LOCAL_HERMES_BIN"
  echo "- $WORKSPACE_HERMES_BIN"
  echo "Execute: npm install (na raiz do workspace ou dentro de mobile-app)"
  exit 1
fi

mkdir -p "$HERMES_OVERRIDE_DIR/build/bin"
ln -sf "$HERMES_SOURCE_BIN" "$HERMES_OVERRIDE_DIR/build/bin/hermesc"

cd "$ROOT_DIR"
if [ -f "$LOCAL_EXPO_CLI" ]; then
  REACT_NATIVE_OVERRIDE_HERMES_DIR="$HERMES_OVERRIDE_DIR" EXPO_NO_TELEMETRY=1 \
    node "$LOCAL_EXPO_CLI" export --platform android --output-dir dist-export-android-bytecode
elif [ -f "$ROOT_EXPO_CLI" ]; then
  REACT_NATIVE_OVERRIDE_HERMES_DIR="$HERMES_OVERRIDE_DIR" EXPO_NO_TELEMETRY=1 \
    node "$ROOT_EXPO_CLI" export --platform android --output-dir dist-export-android-bytecode
else
  REACT_NATIVE_OVERRIDE_HERMES_DIR="$HERMES_OVERRIDE_DIR" EXPO_NO_TELEMETRY=1 \
    npx expo export --platform android --output-dir dist-export-android-bytecode
fi
