#!/usr/bin/env bash
# Publica uma OTA (eas update, canal production) em um ou mais runtimes e sobe os mapas do
# Sentry de cada publicação, conferindo pela API que o Sentry achou cada debug ID.
#
# Uso (a partir de um checkout limpo em origin/main, com node_modules e os .env do app):
#   CONFIRM_OTA_PUBLISH=true OTA_NATIVE_BASE=<commit do build das lojas> \
#     bash scripts/publish-ota.sh "mensagem da OTA" 1.0.12 1.0.13
#
# Travas:
# - CONFIRM_OTA_PUBLISH=true é obrigatório (publicar exige o OK do Izaak).
# - Checkout limpo e HEAD == origin/main (OTA_ALLOW_NON_MAIN=true só para hotfix combinado).
# - OTA_NATIVE_BASE: recusa se package.json, app.config, ios/, android/, native/ ou
#   plugins/ mudaram desde o build das lojas; isso exige build nativo, não OTA.
# - Credenciais do Sentry conferidas antes de publicar (SENTRY_ENV_FILE, padrão
#   ~/.leaf-secrets/observability.env). OTA_SKIP_SENTRY=true pula o upload, com aviso.
# - DRY_RUN=true faz todas as checagens e o export com mapas, sem publicar nem subir nada.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PROJECT_DIR}/.." && pwd)"

MESSAGE="${1:-}"
shift || true
RUNTIMES=("$@")
DRY_RUN="${DRY_RUN:-false}"
OTA_SKIP_SENTRY="${OTA_SKIP_SENTRY:-false}"
SENTRY_ENV_FILE="${SENTRY_ENV_FILE:-$HOME/.leaf-secrets/observability.env}"
SENTRY_API_URL="${SENTRY_API_URL:-https://sentry.io}"
OTA_LOG_DIR="${OTA_LOG_DIR:-${TMPDIR:-/tmp}/leaf-ota-$(date +%Y%m%d-%H%M%S)}"

fail() { echo "❌ $*" >&2; exit 1; }
info() { echo "➡️  $*"; }

[[ -n "${MESSAGE}" && ${#RUNTIMES[@]} -gt 0 ]] \
  || fail "Uso: CONFIRM_OTA_PUBLISH=true OTA_NATIVE_BASE=<sha> bash scripts/publish-ota.sh \"mensagem\" <runtime> [runtime...]"
if [[ "${DRY_RUN}" != "true" && "${CONFIRM_OTA_PUBLISH:-}" != "true" ]]; then
  fail "Publicar OTA exige CONFIRM_OTA_PUBLISH=true."
fi
for runtime in "${RUNTIMES[@]}"; do
  [[ "${runtime}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Runtime inválido: ${runtime}"
done

# --- Checkout ---------------------------------------------------------------------------
cd "${REPO_ROOT}"
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || fail "Checkout com alterações. Publique de um checkout limpo."
git fetch -q origin main
HEAD_SHA="$(git rev-parse HEAD)"
if [[ "${OTA_ALLOW_NON_MAIN:-false}" != "true" && "${HEAD_SHA}" != "$(git rev-parse origin/main)" ]]; then
  fail "HEAD (${HEAD_SHA:0:9}) não é origin/main. Faça checkout de origin/main ou use OTA_ALLOW_NON_MAIN=true."
fi

# --- Nada nativo desde o build das lojas -------------------------------------------------
[[ -n "${OTA_NATIVE_BASE:-}" ]] || fail "Informe OTA_NATIVE_BASE (commit do build das lojas) para conferir mudanças nativas."
git cat-file -e "${OTA_NATIVE_BASE}^{commit}" 2>/dev/null || fail "OTA_NATIVE_BASE não existe: ${OTA_NATIVE_BASE}"
NATIVE_CHANGES="$(git diff --name-only "${OTA_NATIVE_BASE}" HEAD -- \
  mobile-app/package.json mobile-app/app.config.js mobile-app/app.json mobile-app/eas.json \
  mobile-app/ios mobile-app/android mobile-app/native mobile-app/plugins package-lock.json || true)"
if [[ -n "${NATIVE_CHANGES}" ]]; then
  echo "${NATIVE_CHANGES}" >&2
  fail "Arquivos nativos mudaram desde ${OTA_NATIVE_BASE:0:9}. Isso pede build nas lojas, não OTA."
fi

# --- Ferramentas e ambiente --------------------------------------------------------------
cd "${PROJECT_DIR}"
EAS_BIN="${EAS_BIN:-$(command -v eas || true)}"
[[ -x "${EAS_BIN}" ]] || fail "eas CLI não encontrado (defina EAS_BIN)."
SENTRY_CLI="${SENTRY_CLI:-}"
for candidate in "${PROJECT_DIR}/node_modules/.bin/sentry-cli" "${REPO_ROOT}/node_modules/.bin/sentry-cli"; do
  [[ -z "${SENTRY_CLI}" && -x "${candidate}" ]] && SENTRY_CLI="${candidate}"
done

export EAS_BUILD_PROFILE=production
export LEAF_BUILD_PROFILE=production
export EXPO_UPDATE_CHANNEL=production
# shellcheck source=/dev/null
source "${SCRIPT_DIR}/source-local-build-env.sh"
load_eas_build_profile_env

if [[ "${OTA_SKIP_SENTRY}" == "true" ]]; then
  echo "⚠️  OTA_SKIP_SENTRY=true: os erros desta OTA chegam ao Sentry sem mapas."
else
  [[ -x "${SENTRY_CLI}" ]] || fail "sentry-cli não encontrado em node_modules."
  [[ -f "${SENTRY_ENV_FILE}" ]] || fail "Arquivo do Sentry não encontrado: ${SENTRY_ENV_FILE}"
  # Só as três chaves; o arquivo inteiro não é carregável com source.
  SENTRY_ORG="$(grep -E '^SENTRY_ORG=' "${SENTRY_ENV_FILE}" | tail -1 | cut -d= -f2- || true)"
  SENTRY_PROJECT="$(grep -E '^SENTRY_PROJECT_MOBILE=' "${SENTRY_ENV_FILE}" | tail -1 | cut -d= -f2- || true)"
  SENTRY_AUTH_TOKEN="$(grep -E '^SENTRY_AUTH_TOKEN=' "${SENTRY_ENV_FILE}" | tail -1 | cut -d= -f2- || true)"
  [[ -n "${SENTRY_ORG}" && -n "${SENTRY_PROJECT}" && -n "${SENTRY_AUTH_TOKEN}" ]] \
    || fail "SENTRY_ORG, SENTRY_PROJECT_MOBILE e SENTRY_AUTH_TOKEN são obrigatórios em ${SENTRY_ENV_FILE}."
  export SENTRY_ORG SENTRY_PROJECT SENTRY_AUTH_TOKEN
  "${SENTRY_CLI}" info >/dev/null 2>&1 || fail "sentry-cli não autenticou com o token do Sentry."
fi

mkdir -p "${OTA_LOG_DIR}"

# --- Funções ----------------------------------------------------------------------------
assert_runtime() {
  local runtime="$1" resolved
  resolved="$(LEAF_RUNTIME_VERSION="${runtime}" npx expo config --json --type public 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const c=JSON.parse(s);process.stdout.write(`${c.runtimeVersion}|${c.updates?.url||""}`)})')"
  [[ "${resolved%%|*}" == "${runtime}" ]] || fail "expo config resolveu runtime ${resolved%%|*}, esperado ${runtime}."
  [[ "${resolved#*|}" == https://u.expo.dev/* ]] || fail "URL de updates inesperada: ${resolved#*|}"
}

# Sobe bundle + mapa de cada plataforma do dist pelo debug ID e confere na API do Sentry.
upload_maps() {
  local runtime="$1" platform map bundle debug_id found
  for platform in ios android; do
    map="$(ls dist/_expo/static/js/${platform}/*.hbc.map 2>/dev/null | head -1 || true)"
    [[ -n "${map}" ]] || fail "Mapa ${platform} não encontrado em dist (runtime ${runtime})."
    bundle="${map%.map}"
    [[ -f "${bundle}" ]] || fail "Bundle ${platform} não encontrado em dist (runtime ${runtime})."
    debug_id="$(node -e '
      const fs=require("fs");const p=process.argv[1];const m=JSON.parse(fs.readFileSync(p,"utf8"));
      const id=m.debugId||m.debug_id; if(!id){process.exit(2)}
      m.debug_id=id; fs.writeFileSync(p, JSON.stringify(m)); process.stdout.write(id);' "${map}")" \
      || fail "Mapa ${platform} sem debugId: o serializer do Sentry no metro.config não rodou."
    if [[ "${DRY_RUN}" == "true" || "${OTA_SKIP_SENTRY}" == "true" ]]; then
      info "[${runtime}/${platform}] mapa pronto (debug id ${debug_id}); upload pulado."
      continue
    fi
    "${SENTRY_CLI}" sourcemaps upload --debug-id-reference "${bundle}" "${map}" \
      > "${OTA_LOG_DIR}/sentry-${runtime}-${platform}.log" 2>&1 \
      || fail "Upload do mapa ${platform} falhou (log em ${OTA_LOG_DIR})."
    found="$(curl -fsS -H "Authorization: Bearer ${SENTRY_AUTH_TOKEN}" \
      "${SENTRY_API_URL}/api/0/projects/${SENTRY_ORG}/${SENTRY_PROJECT}/artifact-lookup/?debug_id=${debug_id}" \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s);process.stdout.write(String(Array.isArray(d)?d.length:0))})' || echo 0)"
    [[ "${found}" -gt 0 ]] || fail "Sentry não achou o debug id ${debug_id} (${platform}) depois do upload."
    info "[${runtime}/${platform}] mapa no Sentry (debug id ${debug_id})."
  done
}

# --- Publicação -------------------------------------------------------------------------
info "Commit ${HEAD_SHA:0:9} · runtimes ${RUNTIMES[*]} · logs em ${OTA_LOG_DIR}"
declare -a SUMMARY=()
for runtime in "${RUNTIMES[@]}"; do
  assert_runtime "${runtime}"
  rm -rf dist
  if [[ "${DRY_RUN}" == "true" ]]; then
    info "[${runtime}] DRY_RUN: export com mapas, sem publicar."
    LEAF_RUNTIME_VERSION="${runtime}" npx expo export --platform all --output-dir dist --source-maps \
      > "${OTA_LOG_DIR}/export-${runtime}.log" 2>&1 || fail "Export falhou (log em ${OTA_LOG_DIR})."
    group="dry-run"
  else
    info "[${runtime}] publicando..."
    LEAF_RUNTIME_VERSION="${runtime}" "${EAS_BIN}" update --branch production --message "${MESSAGE}" --non-interactive \
      > "${OTA_LOG_DIR}/eas-${runtime}.log" 2>&1 || fail "eas update falhou no runtime ${runtime} (log em ${OTA_LOG_DIR})."
    group="$(grep -E 'Update group ID' "${OTA_LOG_DIR}/eas-${runtime}.log" | awk '{print $NF}' | head -1)"
    [[ -n "${group}" ]] || fail "Não achei o update group no log do runtime ${runtime}."
    grep -qE "Runtime version +${runtime//./\\.}\b" "${OTA_LOG_DIR}/eas-${runtime}.log" \
      || fail "O eas update não confirmou o runtime ${runtime}."
  fi
  upload_maps "${runtime}"
  SUMMARY+=("${runtime} → ${group}")
done

echo
if [[ "${DRY_RUN}" == "true" ]]; then echo "✅ Simulação concluída, nada publicado (commit ${HEAD_SHA:0:9}):"; else echo "✅ OTA publicada do commit ${HEAD_SHA:0:9}:"; fi
printf '   %s\n' "${SUMMARY[@]}"
echo "   Rollback: eas update:republish --group <grupo anterior> (por runtime)."
