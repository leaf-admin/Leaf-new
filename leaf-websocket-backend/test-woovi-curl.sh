#!/bin/bash
export WOOVI_APP_ID="f00e572af3872c0c7a5f6e69bedbccdf2dd8880a256dfaae63972236afb5f54cc2ef5d7667926b47c9aa3f3876e5d260ab5c3abdedaf5d65ac8c409cf28965f3fce95a4c9b994f796af29ee6ebcdbc7cf81bb2d6344ccaeabd08eab97022066c"
export WOOVI_API_TOKEN="Q2xpZW50X0lkXzE4YzBkYzI3LTYzMDYtNDFkYy1hMmRlLWI2MzAzMzQ3YzNhZTpDbGllbnRfU2VjcmV0X01ENWpTTW1DMExBYWx2WHhiY0tTSnlrVmYyM0g1Z0FxS0pZaE5zT0tUK1E9"

curl -sS -X GET "https://api.openpix.com.br/api/v1/charge" \
  -H "Authorization: ${WOOVI_API_TOKEN}" \
  -H "x-app-id: ${WOOVI_APP_ID}" \
  -H "Content-Type: application/json"
