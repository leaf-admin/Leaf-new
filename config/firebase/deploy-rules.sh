#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)"
FIREBASE_CONFIG="$SCRIPT_DIR/firebase.json"
EXPECTED_PROJECT_ID="leaf-reactnative"
EXPECTED_CONFIRMATION="deploy-leaf-reactnative-rules"
FIREBASE_TOOLS_VERSION="14.22.0"

fail() {
  echo "[firebase-rules-release] $1" >&2
  exit 1
}

PROJECT_ID="${FIREBASE_PROJECT_ID:-}"
CONFIRMATION="${CONFIRM_FIREBASE_RULES_PRODUCTION_DEPLOY:-}"
RELEASE_SHA="${FIREBASE_RULES_RELEASE_SHA:-}"

[ "$PROJECT_ID" = "$EXPECTED_PROJECT_ID" ] || fail \
  "FIREBASE_PROJECT_ID deve ser exatamente $EXPECTED_PROJECT_ID."
[ "$CONFIRMATION" = "$EXPECTED_CONFIRMATION" ] || fail \
  "CONFIRM_FIREBASE_RULES_PRODUCTION_DEPLOY deve ser exatamente $EXPECTED_CONFIRMATION."

CURRENT_BRANCH="$(git -C "$ROOT_DIR" branch --show-current)"
[ "$CURRENT_BRANCH" = "main" ] || fail "A publicação só pode partir da branch main."
[ -z "$(git -C "$ROOT_DIR" status --porcelain)" ] || fail \
  "A árvore Git deve estar limpa antes da publicação."

CURRENT_SHA="$(git -C "$ROOT_DIR" rev-parse HEAD)"
[ "$RELEASE_SHA" = "$CURRENT_SHA" ] || fail \
  "FIREBASE_RULES_RELEASE_SHA deve corresponder ao HEAD atual ($CURRENT_SHA)."

REMOTE_MAIN_SHA="$(git -C "$ROOT_DIR" rev-parse --verify refs/remotes/origin/main 2>/dev/null)" || fail \
  "origin/main não está disponível; atualize as referências remotas antes de publicar."
[ "$CURRENT_SHA" = "$REMOTE_MAIN_SHA" ] || fail \
  "HEAD deve coincidir exatamente com origin/main antes da publicação."

cd "$ROOT_DIR"

echo "[firebase-rules-release] Validando contrato versionado..."
npm run firebase:rules:check

echo "[firebase-rules-release] Executando testes dos emuladores..."
npm run test:firebase:rules

echo "[firebase-rules-release] Evidência SHA-256 das regras:"
shasum -a 256 \
  "$SCRIPT_DIR/firestore.rules" \
  "$SCRIPT_DIR/database.rules.json" \
  "$SCRIPT_DIR/storage.rules"

echo "[firebase-rules-release] Publicando Firestore, RTDB e Storage como um único release..."
npx --yes "firebase-tools@$FIREBASE_TOOLS_VERSION" deploy \
  --project "$PROJECT_ID" \
  --config "$FIREBASE_CONFIG" \
  --only "firestore:rules,database,storage" \
  --non-interactive
