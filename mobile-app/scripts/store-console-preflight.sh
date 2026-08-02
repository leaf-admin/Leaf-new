#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

DATE_TAG="$(date +%Y-%m-%d)"
REPORT_DIR="${ROOT_DIR}/reports/store"
mkdir -p "$REPORT_DIR"
REPORT_FILE="${REPORT_DIR}/store-preflight-${DATE_TAG}.md"

PASS=0
FAIL=0

ok() {
  echo "- ✅ $1" | tee -a "$REPORT_FILE"
  PASS=$((PASS + 1))
}

bad() {
  echo "- ❌ $1" | tee -a "$REPORT_FILE"
  FAIL=$((FAIL + 1))
}

section() {
  echo "" | tee -a "$REPORT_FILE"
  echo "## $1" | tee -a "$REPORT_FILE"
}

resolve_expo_cli() {
  if command -v npx >/dev/null 2>&1; then
    echo "npx expo"
    return 0
  fi

  if [[ -x "${ROOT_DIR}/node_modules/.bin/expo" ]]; then
    echo "${ROOT_DIR}/node_modules/.bin/expo"
    return 0
  fi

  if [[ -x "${ROOT_DIR}/../node_modules/.bin/expo" ]]; then
    echo "${ROOT_DIR}/../node_modules/.bin/expo"
    return 0
  fi

  return 1
}

check_http_200() {
  local url="$1"
  local code
  code="$(curl -sS -m 10 -o /dev/null -w "%{http_code}" "$url" || true)"
  if [[ "$code" == "200" ]]; then
    ok "HTTP 200: $url"
  else
    bad "HTTP $code: $url"
  fi
}

echo "# Store Console Preflight (${DATE_TAG})" > "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
echo "Gerado em: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$REPORT_FILE"

section "Configuração Expo"
TMP_PUBLIC_JSON="$(mktemp "${TMPDIR:-/tmp}/leaf-expo-public.XXXXXX")"
EXPO_CLI="$(resolve_expo_cli || true)"
if [[ -z "$EXPO_CLI" ]]; then
  bad "Expo CLI não encontrado (npx e binários locais indisponíveis)"
  echo "Relatório: $REPORT_FILE"
  exit 2
fi

if [[ "$EXPO_CLI" == "npx expo" ]]; then
  npx expo config --type public --json > "$TMP_PUBLIC_JSON"
else
  "$EXPO_CLI" config --type public --json > "$TMP_PUBLIC_JSON"
fi

PRIVACY_URL="$(jq -r '.extra.privacyPolicyUrl // ""' "$TMP_PUBLIC_JSON")"
TERMS_URL="$(jq -r '.extra.termsOfServiceUrl // ""' "$TMP_PUBLIC_JSON")"
REFUND_URL="$(jq -r '.extra.refundPolicyUrl // ""' "$TMP_PUBLIC_JSON")"
DELETE_URL="$(jq -r '.extra.accountDeletionUrl // ""' "$TMP_PUBLIC_JSON")"
SUPPORT_EMAIL="$(jq -r '.extra.supportEmail // ""' "$TMP_PUBLIC_JSON")"
IS_REVIEW="$(jq -r '.extra.isReview // false' "$TMP_PUBLIC_JSON")"
LAUNCH_PROFILE="$(jq -r '.extra.launchProfile // ""' "$TMP_PUBLIC_JSON")"
PILOT_CONTROLLED="$(jq -r '.extra.pilotControlled // false' "$TMP_PUBLIC_JSON")"
WITHDRAWALS_ENABLED="$(jq -r '.extra.pilotFeatureFlags.driverWithdrawalsEnabled // false' "$TMP_PUBLIC_JSON")"

if [[ -n "$PRIVACY_URL" ]]; then ok "privacyPolicyUrl definido: $PRIVACY_URL"; else bad "privacyPolicyUrl ausente"; fi
if [[ -n "$TERMS_URL" ]]; then ok "termsOfServiceUrl definido: $TERMS_URL"; else bad "termsOfServiceUrl ausente"; fi
if [[ -n "$REFUND_URL" ]]; then ok "refundPolicyUrl definido: $REFUND_URL"; else bad "refundPolicyUrl ausente"; fi
if [[ -n "$DELETE_URL" ]]; then ok "accountDeletionUrl definido: $DELETE_URL"; else bad "accountDeletionUrl ausente"; fi
if [[ -n "$SUPPORT_EMAIL" ]]; then ok "supportEmail definido: $SUPPORT_EMAIL"; else bad "supportEmail ausente"; fi
ok "launchProfile atual: ${LAUNCH_PROFILE:-n/d}"
ok "pilotControlled atual: $PILOT_CONTROLLED"

if [[ "$IS_REVIEW" == "false" ]]; then
  ok "isReview em release: false"
else
  bad "isReview em release está true"
fi

if [[ "$WITHDRAWALS_ENABLED" == "false" ]]; then
  ok "driverWithdrawalsEnabled em release: false"
else
  bad "driverWithdrawalsEnabled em release está true"
fi

section "Links legais públicos"
check_http_200 "$PRIVACY_URL"
check_http_200 "$TERMS_URL"
check_http_200 "$REFUND_URL"
check_http_200 "$DELETE_URL"

section "Hardening runtime"
RUNTIME_FILES=(
  "config/AppConfig.js"
  "config/WooviConfig.js"
  "app.config.js"
  ".env"
  ".env.production"
  "eas.json"
  "src/screens/prototype/RobotaxiHomeScreen.js"
  "src/common-local/api.js"
  "src/common-local/redisConfig.js"
  "src/common-local/config/redisConfig.js"
  "src/common-local/redisLocationService.js"
  "src/common-local/services/redisLocationService.js"
)

if rg -n "147\\.182\\.204\\.181|api\\.147\\.182\\.204\\.181|socket\\.147\\.182\\.204\\.181" "${RUNTIME_FILES[@]}" >/dev/null 2>&1; then
  bad "Host antigo de VPS ainda encontrado em arquivos de runtime/release"
else
  ok "Sem referência ao host antigo nos arquivos de runtime/release"
fi

if rg -n "^EXPO_PUBLIC_ENABLE_DRIVER_WITHDRAWALS=false$" .env .env.production eas.json >/dev/null 2>&1; then
  ok "Saque do motorista desligado por padrão nos artefatos de release"
else
  bad "Saque do motorista não está claramente desligado nos artefatos de release"
fi

if rg -n "allowReviewAccess|allowCustomOtpFallback|allowQaOtpForceFlow" src/config/runtimeAccessPolicy.js >/dev/null 2>&1; then
  ok "Política de review/OTP centralizada em runtimeAccessPolicy"
else
  bad "Política central de review/OTP não encontrada"
fi

STORE_REVIEW_FILES=(
  "docs/STORE_PRIVACY_LOCATION_PACKAGE_2026-05-30.md"
  "docs/PLAY_CONSOLE_READY_RESPONSES_2026-03-23.md"
  "docs/APP_STORE_CONNECT_READY_RESPONSES_2026-03-23.md"
  "app.config.js"
  "eas.json"
)

if rg -n "sslip" "${STORE_REVIEW_FILES[@]}" >/dev/null 2>&1; then
  bad "Referência sslip encontrada em arquivos ativos de loja/release"
else
  ok "Sem sslip nos arquivos ativos de loja/release"
fi

if node <<'NODE' >/tmp/leaf-store-review-otp.log 2>&1
const fs = require('fs');
const files = [
  'docs/STORE_PRIVACY_LOCATION_PACKAGE_2026-05-30.md',
  'docs/PLAY_CONSOLE_READY_RESPONSES_2026-03-23.md',
  'docs/APP_STORE_CONNECT_READY_RESPONSES_2026-03-23.md'
];
const text = files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const auth = require('../leaf-websocket-backend/utils/test-auth-bypass');

const badZeroOtpLines = text
  .split(/\r?\n/)
  .filter((line) => /000000/.test(line))
  .filter((line) => !/(do not|never|not valid|placeholder|nunca|n[aã]o|nao|inv[aá]lido)/i.test(line));

if (badZeroOtpLines.length) {
  throw new Error(`Review docs still contain unsafe 000000 OTP lines: ${badZeroOtpLines.join(' | ')}`);
}

const requiredDocs = [
  ['passenger review OTP', /\+55 21 10293-8475[\s\S]{0,80}992111/],
  ['driver review OTP', /\+55 21 12345-6789[\s\S]{0,80}992000/]
];
for (const [label, pattern] of requiredDocs) {
  if (!pattern.test(text)) {
    throw new Error(`Missing ${label} in active store review docs`);
  }
}

const requiredBackendCodes = {
  '5521102938475': '992111',
  '5521123456789': '992000'
};
for (const [phone, code] of Object.entries(requiredBackendCodes)) {
  if (auth.DEFAULT_BYPASS_PHONE_CODES[phone] !== code) {
    throw new Error(`Backend review OTP mismatch for ${phone}`);
  }
}
NODE
then
  ok "Credenciais/OTP de review conferidos: passageiro 992111, motorista 992000"
else
  bad "Credenciais/OTP de review divergentes ou com 000000 inseguro"
fi

if rg -n "signInWithPhoneNumber" src/components/auth/steps/PhoneInputStep.js >/dev/null 2>&1; then
  ok "Fluxo OTP real via Firebase Phone Auth encontrado"
else
  bad "Fluxo OTP real via Firebase Phone Auth não encontrado"
fi

if rg -n "BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY|driverBackgroundDisclosureVisible|locationType=\"background\"" src/screens/prototype/RobotaxiHomeScreen.js src/services/BackgroundLocationService.js src/components/PermissionExplanationModal.js >/dev/null 2>&1; then
  ok "Disclosure de localização em segundo plano conectado ao fluxo atual do motorista"
else
  bad "Disclosure de localização em segundo plano não encontrado no fluxo atual do motorista"
fi

if rg -n "requestBackgroundPermissionsAsync" src/services/BackgroundLocationService.js >/dev/null 2>&1; then
  ok "Solicitação de background location centralizada em BackgroundLocationService"
else
  bad "Solicitação de background location não encontrada no serviço central"
fi

section "Checks automatizados"
if bash scripts/check-permissions-hardening.sh >/tmp/leaf-store-preflight-perm.log 2>&1; then
  ok "check-permissions-hardening.sh: PASS"
else
  bad "check-permissions-hardening.sh: FAIL"
fi

if bash scripts/check-runtime-endpoints.sh >/tmp/leaf-store-preflight-endpoints.log 2>&1; then
  ok "check-runtime-endpoints.sh: PASS"
else
  bad "check-runtime-endpoints.sh: FAIL"
fi

if node ../scripts/prelaunch/assert-store-go-static.cjs >/tmp/leaf-store-static-gate.log 2>&1; then
  ok "assert-store-go-static.cjs: PASS"
else
  bad "assert-store-go-static.cjs: FAIL"
fi

section "Checklist manual obrigatória"
echo "- [ ] Login OTP real testado em build release Android" | tee -a "$REPORT_FILE"
echo "- [ ] Login OTP real testado em build release iOS" | tee -a "$REPORT_FILE"
echo "- [ ] Pagamento Woovi real ponta a ponta validado no host atual" | tee -a "$REPORT_FILE"
echo "- [ ] Geofence validado dentro e fora da área operacional" | tee -a "$REPORT_FILE"
echo "- [ ] Play Console: Data Safety publicado" | tee -a "$REPORT_FILE"
echo "- [ ] Play Console: account deletion URL preenchida" | tee -a "$REPORT_FILE"
echo "- [ ] Play Console: declaração de background location + vídeo enviados" | tee -a "$REPORT_FILE"
echo "- [ ] App Store Connect: privacy labels revisadas" | tee -a "$REPORT_FILE"
echo "- [ ] App Store Connect: review notes e acesso de review preenchidos" | tee -a "$REPORT_FILE"

rm -f "$TMP_PUBLIC_JSON"

section "Resumo"
echo "- Passou: $PASS" | tee -a "$REPORT_FILE"
echo "- Falhou: $FAIL" | tee -a "$REPORT_FILE"

if [[ "$FAIL" -gt 0 ]]; then
  echo "" | tee -a "$REPORT_FILE"
  echo "Status final: FAIL" | tee -a "$REPORT_FILE"
  echo "Relatório: $REPORT_FILE"
  exit 2
fi

echo "" | tee -a "$REPORT_FILE"
echo "Status final: PASS" | tee -a "$REPORT_FILE"
echo "Relatório: $REPORT_FILE"
