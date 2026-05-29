#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

STAMP="$(date +%Y%m%d_%H%M%S)"
RUN_DIR="${ROOT_DIR}/reports/production-real/${STAMP}_production-real-readiness"
mkdir -p "${RUN_DIR}/artifacts" "${RUN_DIR}/logs"

APP_API_URL="${EXPO_PUBLIC_API_URL:-https://api.leaf.app.br}"
APP_WS_URL="${EXPO_PUBLIC_WS_URL:-https://socket.leaf.app.br}"
LEGAL_BASE_URL="${EXPO_PUBLIC_LEGAL_BASE_URL:-${APP_API_URL}}"

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

note_device_tooling() {
  local tool="$1"
  if command_exists "$tool"; then
    printf -- "- %s: disponível\n" "$tool" >> "${RUN_DIR}/environment.md"
  else
    printf -- "- %s: ausente nesta máquina\n" "$tool" >> "${RUN_DIR}/environment.md"
  fi
}

cat > "${RUN_DIR}/environment.md" <<EOF
# Production Real Readiness Environment

- generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- root: ${ROOT_DIR}
- apiUrl: ${APP_API_URL}
- wsUrl: ${APP_WS_URL}
- legalBaseUrl: ${LEGAL_BASE_URL}

## Tooling
EOF

note_device_tooling adb
note_device_tooling xcrun
note_device_tooling eas
note_device_tooling jq

bash "${ROOT_DIR}/scripts/store-console-preflight.sh" > "${RUN_DIR}/logs/store-console-preflight.log" 2>&1
LATEST_PREFLIGHT="$(find "${ROOT_DIR}/reports/store" -maxdepth 1 -type f -name 'store-preflight-*.md' | sort | tail -n 1)"
if [[ -n "${LATEST_PREFLIGHT:-}" ]]; then
  cp "${LATEST_PREFLIGHT}" "${RUN_DIR}/artifacts/"
fi

curl -sk "${APP_API_URL}/health" > "${RUN_DIR}/artifacts/backend-health.json"
curl -sk "${LEGAL_BASE_URL}/privacy-policy" > "${RUN_DIR}/artifacts/privacy-policy.html"
curl -sk "${LEGAL_BASE_URL}/terms-of-service" > "${RUN_DIR}/artifacts/terms-of-service.html"
curl -sk "${LEGAL_BASE_URL}/refund-policy" > "${RUN_DIR}/artifacts/refund-policy.html"
curl -sk "${LEGAL_BASE_URL}/account-deletion" > "${RUN_DIR}/artifacts/account-deletion.html"

if command_exists npx; then
  npx expo config --type public --json > "${RUN_DIR}/artifacts/expo-config-public.json"
fi

cat > "${RUN_DIR}/commands.md" <<'EOF'
# Production Real Validation Commands

## Android release build

```bash
cd /Users/izaakdias/Documents/Leaf-new/mobile-app
eas build --platform android --profile production-apk
```

## iOS release build

```bash
cd /Users/izaakdias/Documents/Leaf-new/mobile-app
eas build --platform ios --profile production
```

## Store preflight

```bash
cd /Users/izaakdias/Documents/Leaf-new/mobile-app
bash scripts/store-console-preflight.sh
```

## Local dashboard for metrics follow-up

```bash
cd /Users/izaakdias/Documents/Leaf-new
npm run start --workspace leaf-dashboard-js -- --hostname 127.0.0.1 --port 3010
```
EOF

cat > "${RUN_DIR}/checklist.md" <<EOF
# Production Real Validation Checklist

- Run directory: ${RUN_DIR}
- API: ${APP_API_URL}
- WS: ${APP_WS_URL}

## Android release

- [ ] Build release gerada com profile production-apk
- [ ] Login OTP real concluído
- [ ] Cadastro/recuperação concluído
- [ ] Corrida criada com sucesso
- [ ] Pagamento Woovi real aprovado
- [ ] Driver recebeu/aceitou corrida
- [ ] Driver chegou ao embarque
- [ ] Corrida iniciada e finalizada
- [ ] Geofence dentro da área: PASS
- [ ] Geofence fora da área: bloqueou corretamente
- [ ] Maps/rotas/navegação: PASS
- [ ] Background location com app minimizado: PASS
- [ ] Evidências anexadas em artifacts/android/

## iOS release

- [ ] Build release gerada com profile production
- [ ] Login OTP real concluído
- [ ] Cadastro/recuperação concluído
- [ ] Corrida criada com sucesso
- [ ] Pagamento Woovi real aprovado
- [ ] Driver recebeu/aceitou corrida
- [ ] Driver chegou ao embarque
- [ ] Corrida iniciada e finalizada
- [ ] Geofence dentro da área: PASS
- [ ] Geofence fora da área: bloqueou corretamente
- [ ] Maps/rotas/navegação: PASS
- [ ] Background location com app minimizado: PASS
- [ ] Evidências anexadas em artifacts/ios/

## Play Console

- [ ] Data Safety publicado
- [ ] Account deletion URL preenchida
- [ ] App Access preenchido com credenciais válidas
- [ ] Background location declaration enviada
- [ ] Vídeo de background location anexado

## App Store Connect

- [ ] App Privacy labels revisadas
- [ ] Review notes preenchidas
- [ ] Acesso de review preenchido
- [ ] URLs finais conferidas

## Go / No-Go

- [ ] Todos os itens Android release: PASS
- [ ] Todos os itens iOS release: PASS
- [ ] Todos os itens Play Console: PASS
- [ ] Todos os itens App Store Connect: PASS
EOF

cat > "${RUN_DIR}/summary.md" <<EOF
# Production Real Readiness Run

- generatedAt: $(date -u +%Y-%m-%dT%H:%M:%SZ)
- api: ${APP_API_URL}
- ws: ${APP_WS_URL}
- artifacts:
  - backend-health.json
  - privacy-policy.html
  - terms-of-service.html
  - refund-policy.html
  - account-deletion.html
  - expo-config-public.json
  - store-preflight report

## Next step

Use checklist.md para fechar Android release, iOS release e consoles. O run só vira GO quando todos os blocos estiverem verdes.
EOF

printf '%s\n' "${RUN_DIR}"
