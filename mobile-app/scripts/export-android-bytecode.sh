#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HERMES_OVERRIDE_DIR="$ROOT_DIR/.hermes-override"
HERMES_SOURCE_BIN="$ROOT_DIR/node_modules/react-native/sdks/hermesc/osx-bin/hermesc"
LOCAL_EXPO_CLI="$ROOT_DIR/node_modules/expo/bin/cli"
ROOT_EXPO_CLI="$ROOT_DIR/../node_modules/expo/bin/cli"

if [ ! -x "$HERMES_SOURCE_BIN" ]; then
  echo "Hermes compiler não encontrado em: $HERMES_SOURCE_BIN"
  echo "Execute: npm install (dentro de mobile-app)"
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
