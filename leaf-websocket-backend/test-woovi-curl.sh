#!/bin/bash

: "${WOOVI_APP_ID:?WOOVI_APP_ID precisa estar definido no ambiente}"
: "${WOOVI_API_TOKEN:?WOOVI_API_TOKEN precisa estar definido no ambiente}"

curl -sS -X GET "https://api.openpix.com.br/api/v1/charge" \
  -H "Authorization: ${WOOVI_API_TOKEN}" \
  -H "x-app-id: ${WOOVI_APP_ID}" \
  -H "Content-Type: application/json"
