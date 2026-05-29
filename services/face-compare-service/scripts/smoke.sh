#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8008}"
API_KEY="${FACE_API_KEY:-${FACE_API_KEYS:-}}"

if [[ -z "${API_KEY}" ]]; then
  echo "Set FACE_API_KEY or FACE_API_KEYS before running smoke.sh" >&2
  exit 2
fi

curl -fsS "${BASE_URL}/health" >/dev/null

curl -fsS -X POST "${BASE_URL}/compare" \
  -H "Content-Type: application/json" \
  -H "X-Leaf-Biometric-Key: ${API_KEY%%,*}" \
  -d '{"embeddingA":[1,0,0],"embeddingB":[1,0,0]}' | grep -q '"decision":"approve"'

echo "face-compare-service smoke ok"
