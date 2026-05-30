#!/bin/bash

AUTHORIZATION_APP_ID="${WOOVI_AUTHORIZATION_APP_ID:-${WOOVI_APP_ID_TOKEN:-${WOOVI_API_TOKEN:-}}}"
CLIENT_ID="${WOOVI_CLIENT_ID:-${WOOVI_APP_ID:-}}"

: "${AUTHORIZATION_APP_ID:?WOOVI_API_TOKEN ou WOOVI_AUTHORIZATION_APP_ID precisa estar definido no ambiente}"

HEADERS=(
  -H "Authorization: ${AUTHORIZATION_APP_ID}"
  -H "Content-Type: application/json"
)

if [[ "${WOOVI_SEND_APP_ID:-false}" == "true" && -n "${CLIENT_ID}" ]]; then
  HEADERS+=(-H "x-app-id: ${CLIENT_ID}")
fi

curl -sS -X GET "https://api.openpix.com.br/api/v1/charge" \
  "${HEADERS[@]}"
