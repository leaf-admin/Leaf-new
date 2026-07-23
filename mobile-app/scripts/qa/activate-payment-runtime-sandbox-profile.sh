#!/usr/bin/env bash
set -euo pipefail

QA_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MOBILE_DIR="$(cd "${QA_SCRIPT_DIR}/../.." && pwd)"
ROOT_DIR="$(cd "${MOBILE_DIR}/.." && pwd)"

BACKEND_URL="${BACKEND_URL:-https://api.leaf.app.br}"
PASSENGER_UID="${PASSENGER_UID:-3tEQ8pQ2QzeWbMKhLGsXHHhnOGL2}"
PASSENGER_PHONE="${PASSENGER_PHONE:-21102938475}"
PROFILE_ID="${PAYMENT_RUNTIME_PROFILE_ID:-real-smoke-passenger-sandbox}"
PROFILE_NAME="${PAYMENT_RUNTIME_PROFILE_NAME:-Real smoke passenger sandbox}"
PROFILE_REASON="${PAYMENT_RUNTIME_PROFILE_REASON:-real_smoke_payment_runtime}"
PROFILE_PRIORITY="${PAYMENT_RUNTIME_PROFILE_PRIORITY:-100}"
TTL_HOURS="${PAYMENT_RUNTIME_PROFILE_TTL_HOURS:-6}"
DRY_RUN="${DRY_RUN:-true}"
CONFIRM_PAYMENT_RUNTIME_MUTATION="${CONFIRM_PAYMENT_RUNTIME_MUTATION:-false}"
VERIFY_AFTER_MUTATION="${VERIFY_AFTER_MUTATION:-true}"
OUTPUT_DIR="${OUTPUT_DIR:-${MOBILE_DIR}/test-results/payment-runtime-sandbox-$(date -u +%Y%m%dT%H%M%SZ)}"
SESSION_FILE="${LEAF_DASHBOARD_SESSION_FILE:-${HOME}/.leaf/dashboard-session.json}"
SUMMARY_FILE="${OUTPUT_DIR}/payment-runtime-sandbox-summary.json"
ACTIVATION_STATUS="running"
ACTIVATION_STEP="init"
ACTIVATION_BLOCKER=""
ACTIVATION_MESSAGE=""
MUTATION_EXECUTED="false"
VERIFY_EXECUTED="false"
SUMMARY_WRITTEN="false"

mkdir -p "${OUTPUT_DIR}"

log() {
  printf '[payment-runtime-sandbox] %s\n' "$*"
}

write_activation_summary() {
  local exit_code="${1:-0}"
  if [[ "${SUMMARY_WRITTEN}" == "true" ]]; then
    return 0
  fi
  SUMMARY_WRITTEN="true"

  if [[ "${ACTIVATION_STATUS}" == "running" ]]; then
    if [[ "${exit_code}" == "0" ]]; then
      ACTIVATION_STATUS="pass"
    else
      ACTIVATION_STATUS="fail"
    fi
  fi

  if ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  ACTIVATION_STATUS="${ACTIVATION_STATUS}" \
  ACTIVATION_STEP="${ACTIVATION_STEP}" \
  ACTIVATION_BLOCKER="${ACTIVATION_BLOCKER}" \
  ACTIVATION_MESSAGE="${ACTIVATION_MESSAGE}" \
  ACTIVATION_EXIT_CODE="${exit_code}" \
  OUTPUT_DIR="${OUTPUT_DIR}" \
  SUMMARY_FILE="${SUMMARY_FILE}" \
  BACKEND_URL="${BACKEND_URL}" \
  PASSENGER_UID="${PASSENGER_UID}" \
  PASSENGER_PHONE="${PASSENGER_PHONE}" \
  PROFILE_ID="${PROFILE_ID}" \
  PROFILE_NAME="${PROFILE_NAME}" \
  PROFILE_REASON="${PROFILE_REASON}" \
  PROFILE_PRIORITY="${PROFILE_PRIORITY}" \
  TTL_HOURS="${TTL_HOURS}" \
  EXPIRES_AT="${EXPIRES_AT:-}" \
  DRY_RUN="${DRY_RUN}" \
  CONFIRM_PAYMENT_RUNTIME_MUTATION="${CONFIRM_PAYMENT_RUNTIME_MUTATION}" \
  VERIFY_AFTER_MUTATION="${VERIFY_AFTER_MUTATION}" \
  MUTATION_EXECUTED="${MUTATION_EXECUTED}" \
  VERIFY_EXECUTED="${VERIFY_EXECUTED}" \
  PAYLOAD_FILE="${PAYLOAD_FILE:-}" \
  RESPONSE_FILE="${RESPONSE_FILE:-}" \
  CANARY_FILE="${CANARY_FILE:-}" \
  node - <<'NODE'
const fs = require('fs');
const path = require('path');

const env = process.env;
const readJson = (file) => {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_error) {
    return null;
  }
};
const fileInfo = (file) => file ? {
  path: file,
  exists: fs.existsSync(file)
} : null;

const payload = readJson(env.PAYLOAD_FILE);
const response = readJson(env.RESPONSE_FILE);
const canary = readJson(env.CANARY_FILE);
const effectiveProfile = canary?.paymentRuntime?.effectiveProfile || null;

const summary = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  status: env.ACTIVATION_STATUS,
  exitCode: Number(env.ACTIVATION_EXIT_CODE || 0),
  step: env.ACTIVATION_STEP || null,
  blocker: env.ACTIVATION_BLOCKER || null,
  message: env.ACTIVATION_MESSAGE || null,
  backendUrl: env.BACKEND_URL,
  dryRun: String(env.DRY_RUN || '').toLowerCase() !== 'false',
  confirmationRequired: true,
  confirmed: String(env.CONFIRM_PAYMENT_RUNTIME_MUTATION || '').toLowerCase() === 'true',
  mutationExecuted: env.MUTATION_EXECUTED === 'true',
  verifyAfterMutation: String(env.VERIFY_AFTER_MUTATION || '').toLowerCase() === 'true',
  verificationExecuted: env.VERIFY_EXECUTED === 'true',
  profile: {
    profileId: env.PROFILE_ID,
    name: env.PROFILE_NAME,
    provider: 'woovi',
    environment: 'sandbox',
    scope: 'canary',
    priority: Number(env.PROFILE_PRIORITY),
    reason: env.PROFILE_REASON,
    ttlHours: Number(env.TTL_HOURS),
    expiresAtIso: env.EXPIRES_AT || payload?.expiresAtIso || null,
    userIds: payload?.userIds || [env.PASSENGER_UID].filter(Boolean),
    phones: payload?.phones || []
  },
  passenger: {
    uid: env.PASSENGER_UID,
    phone: env.PASSENGER_PHONE
  },
  files: {
    payload: fileInfo(env.PAYLOAD_FILE),
    response: fileInfo(env.RESPONSE_FILE),
    canary: fileInfo(env.CANARY_FILE)
  },
  backendResponse: response ? {
    success: response.success ?? response.ok ?? null,
    profileId: response.profile?.profileId || response.data?.profileId || response.profileId || null
  } : null,
  canary: effectiveProfile ? {
    effectiveEnvironment: effectiveProfile.environment || null,
    profileId: effectiveProfile.profileId || null,
    contextMatched: Boolean(effectiveProfile.contextMatched),
    expiresAtIso: effectiveProfile.expiresAtIso || null
  } : null
};

fs.writeFileSync(env.SUMMARY_FILE, `${JSON.stringify(summary, null, 2)}\n`);
NODE
}

fail() {
  if [[ "${ACTIVATION_STATUS}" == "running" ]]; then
    ACTIVATION_STATUS="fail"
  fi
  ACTIVATION_MESSAGE="$*"
  ACTIVATION_BLOCKER="${ACTIVATION_BLOCKER:-$*}"
  printf '[payment-runtime-sandbox][error] %s\n' "$*" >&2
  exit 1
}

trap 'write_activation_summary "$?"' EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

normalize_bool() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

require_cmd curl
require_cmd jq
require_cmd node

ACTIVATION_STEP="validate_inputs"
PHONE_DIGITS="$(printf '%s' "${PASSENGER_PHONE}" | tr -cd '0-9')"
if [[ -z "${PASSENGER_UID}" || -z "${PHONE_DIGITS}" ]]; then
  fail "PASSENGER_UID and PASSENGER_PHONE are required"
fi

if [[ "${PHONE_DIGITS}" == 55* ]]; then
  PHONE_WITH_COUNTRY="${PHONE_DIGITS}"
  PHONE_LOCAL="${PHONE_DIGITS#55}"
else
  PHONE_LOCAL="${PHONE_DIGITS}"
  PHONE_WITH_COUNTRY="55${PHONE_DIGITS}"
fi

PHONE_ALLOWLIST="${PAYMENT_RUNTIME_PHONES:-${PHONE_LOCAL},${PHONE_WITH_COUNTRY}}"

EXPIRES_AT="$(TTL_HOURS="${TTL_HOURS}" node - <<'NODE'
const ttlHours = Number(process.env.TTL_HOURS || 6);
if (!Number.isFinite(ttlHours) || ttlHours <= 0 || ttlHours > 24) {
  console.error('PAYMENT_RUNTIME_PROFILE_TTL_HOURS must be > 0 and <= 24');
  process.exit(2);
}
console.log(new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString());
NODE
)" || fail "Invalid PAYMENT_RUNTIME_PROFILE_TTL_HOURS=${TTL_HOURS}"

PAYLOAD_FILE="${OUTPUT_DIR}/payment-runtime-sandbox-profile-payload.json"
RESPONSE_FILE="${OUTPUT_DIR}/payment-runtime-sandbox-profile-response.json"
CANARY_FILE="${OUTPUT_DIR}/payment-runtime-canary-after-profile.json"
CANARY_LOG="${OUTPUT_DIR}/payment-runtime-canary-after-profile.txt"

ACTIVATION_STEP="write_payload"
jq -n \
  --arg profileId "${PROFILE_ID}" \
  --arg name "${PROFILE_NAME}" \
  --arg reason "${PROFILE_REASON}" \
  --argjson priority "${PROFILE_PRIORITY}" \
  --arg userId "${PASSENGER_UID}" \
  --arg phones "${PHONE_ALLOWLIST}" \
  --arg expiresAtIso "${EXPIRES_AT}" \
  '{
    profileId: $profileId,
    name: $name,
    provider: "woovi",
    environment: "sandbox",
    status: "active",
    scope: "canary",
    priority: $priority,
    reason: $reason,
    userIds: [$userId],
    phones: ($phones | split(",") | map(gsub("[^0-9]"; "")) | unique | map(select(length > 0))),
    expiresAtIso: $expiresAtIso
  }' > "${PAYLOAD_FILE}"

log "Payload written: ${PAYLOAD_FILE}"
log "Profile expires at: ${EXPIRES_AT}"

if [[ "$(normalize_bool "${DRY_RUN}")" != "false" ]]; then
  ACTIVATION_STATUS="dry_run"
  ACTIVATION_STEP="dry_run"
  ACTIVATION_MESSAGE="DRY_RUN=true; no backend mutation was executed."
  log "DRY_RUN=true; no backend mutation was executed."
  log "After explicit approval, rerun with DRY_RUN=false CONFIRM_PAYMENT_RUNTIME_MUTATION=true."
  exit 0
fi

if [[ "$(normalize_bool "${CONFIRM_PAYMENT_RUNTIME_MUTATION}")" != "true" ]]; then
  ACTIVATION_STEP="require_confirmation"
  ACTIVATION_STATUS="blocked"
  ACTIVATION_BLOCKER="blocked_precondition:payment_runtime_mutation_not_confirmed"
  fail "blocked_precondition:payment_runtime_mutation_not_confirmed"
fi

ACTIVATION_STEP="resolve_admin_token"
ADMIN_TOKEN="${ADMIN_TOKEN:-}"
if [[ -z "${ADMIN_TOKEN}" && -f "${SESSION_FILE}" ]]; then
  ADMIN_TOKEN="$(jq -r '.accessToken // .token // .adminAccessToken // .session.accessToken // .session.token // empty' "${SESSION_FILE}")"
fi
if [[ -z "${ADMIN_TOKEN}" ]]; then
  ACTIVATION_STATUS="blocked"
  ACTIVATION_BLOCKER="blocked_precondition:dashboard_auth_missing"
  fail "blocked_precondition:dashboard_auth_missing"
fi

ACTIVATION_STEP="post_runtime_profile"
curl -fsS -X POST "${BACKEND_URL%/}/api/payment/runtime-profiles" \
  -H "authorization: Bearer ${ADMIN_TOKEN}" \
  -H "content-type: application/json" \
  --data-binary "@${PAYLOAD_FILE}" \
  > "${RESPONSE_FILE}"
MUTATION_EXECUTED="true"
jq . "${RESPONSE_FILE}" >/dev/null
log "Backend response written: ${RESPONSE_FILE}"

if [[ "$(normalize_bool "${VERIFY_AFTER_MUTATION}")" == "true" ]]; then
  ACTIVATION_STEP="verify_runtime_profile"
  VERIFY_EXECUTED="true"
  PAYMENT_RUNTIME_USER_ID="${PASSENGER_UID}" \
  PAYMENT_RUNTIME_PHONE="${PASSENGER_PHONE}" \
  PAYMENT_RUNTIME_EXPECTED_ENVIRONMENT=sandbox \
    bash "${QA_SCRIPT_DIR}/assert-backend-payment-runtime-canary.sh" \
      "${BACKEND_URL}" \
      "${CANARY_FILE}" \
    | tee "${CANARY_LOG}"
fi

ACTIVATION_STATUS="pass"
ACTIVATION_STEP="complete"
ACTIVATION_MESSAGE="Sandbox runtime profile activation complete."
log "Sandbox runtime profile activation complete."
