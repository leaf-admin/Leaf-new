# Post-store Operational Gates - 2026-06-04

Branch: `codex/auth-push-hardening`

Objetivo: avançar em baby steps nos itens 1, 2 e 3 do backlog imediato, sem mexer em `main` e sem criar chamadas externas pagas durante validacoes locais.

## Ordem de execucao

1. Auth/OTP, Push/FCM e Universal/App Links.
2. Canary assistido com dashboard.
3. Pagamentos/split/saldo motorista.

## Gate 1 - Auth/OTP, Push/FCM e Links

Status local: aprovado.

Validacoes executadas:

- `node -c leaf-websocket-backend/routes/auth-otp.js`
- `node -c leaf-websocket-backend/services/fcm-service.js`
- `node -c leaf-websocket-backend/routes/notifications.js`
- `node -c leaf-websocket-backend/services/backoffice-command-center-service.js`
- JSON parse de:
  - `landing-page/.well-known/apple-app-site-association`
  - `landing-page/.well-known/assetlinks.json`
- Backend Jest:
  - `tests/unit/routes/auth-otp.unit.test.js`
  - `tests/unit/services/fcm-service.unit.test.js`
  - `tests/unit/bootstrap/register-socket-fcm-handlers.unit.test.js`
  - `tests/unit/routes/notifications-routes-auth.unit.test.js`
  - `tests/unit/services/backoffice-command-center-service.unit.test.js`
- Mobile Jest:
  - `__tests__/otp-step.auth.test.js`
  - `__tests__/websocket-manager-fcm-actions.test.js`
  - `__tests__/fcm-notification-service.test.js`
- `npm --prefix mobile-app run qa:production-guards`
- `npm --prefix leaf-websocket-backend run config:validate`
- `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime`
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`
- `npm run prelaunch:app-links`
- `cd mobile-app && npx expo config --json`
- `cd mobile-app && npm test -- --runTestsByPath __tests__/prototype-new-surfaces.test.js __tests__/otp-step.auth.test.js __tests__/websocket-manager-fcm-actions.test.js __tests__/fcm-notification-service.test.js --runInBand`

Resultados:

- Backend: 6 suites, 28 tests passando.
- Mobile auth/push/share: 4 suites, 37 tests passando.
- Production guards: PASS.
- Runtime config: `ok=true`.
- Secret scan: PASS.
- App links contract: PASS.

Ajuste aplicado durante este gate:

- `https://leaf.app.br/viagem/*` e `https://www.leaf.app.br/viagem/*` passaram a estar cobertos por:
  - AASA iOS;
  - Android intent filters em `app.config.js`;
  - fallback web em `landing-page/viagem/index.html`;
  - `_redirects` e `_headers`;
  - parser do app em `RobotaxiPrototypePublicTracking`.

Nota: a arvore nativa `mobile-app/android` e ignorada no Git. Quando presente localmente, o novo guard tambem valida o Manifest como diagnostico, mas a fonte versionada canonica para App Links e `mobile-app/app.config.js`.

Observacao relevante:

- `config:validate` reportou apenas warning esperado de biometria: `KYC_PRODUCTION_BIOMETRICS_ENABLED=false`.
- `wooviEnv` atual do backend local carregado no `.env` esta como `production`; canary de pagamento deve confirmar runtime profile antes de gerar cobranca real.

Dependencias obrigatorias de device/loja:

- LEA-7 so fecha com app instalado pela Play Internal Testing, nao por `adb`.
- FCM so fecha como Done com token real em device, refresh de token e entrega passageiro/motorista.
- Universal Links/App Links precisam do deploy dos arquivos `.well-known` e validacao em iOS/Android reais.

## Gate 2 - Canary assistido

Status: preflight non-device aprovado com skips conscientes.

Validacao executada:

- `npm run canary:preflight:non-device -- --skip-woovi-sandbox --skip-financial-live --skip-backend-test --skip-mobile-unit`

Resultado:

- Status final: `GO`.
- Relatorio gerado em `reports/canary-preflight/canary-preflight-20260604T140820Z/report.md`.

Motivo dos skips:

- Backend e mobile unit foram rodados de forma focada no Gate 1.
- Woovi sandbox e financeiro live nao foram executados porque o `.env` local carregado no `config:validate` aponta `wooviEnv=production`. Antes de qualquer smoke de Pix, o runtime profile precisa ser confirmado como sandbox.

Checklist minimo:

- Confirmar ambiente de pagamento no dashboard antes do Pix.
- Confirmar `externalPaidApisCalled=false` no command center durante navegacao de backoffice.
- Abrir `/dashboard`, `/support`, `/campaign-center`, `/drivers/review-queue`, `/financial-reconciliation`.
- Validar login passageiro/motorista.
- Validar OTP Android por Play Internal Testing.
- Validar push/in-app notification.
- Validar campanha/banner sem fallback visual.
- Validar suporte/chat entrando no painel.
- Validar corrida mock ou real, separando claramente APIs reais de mocks.

Critério de bloqueio:

- Qualquer falha em OTP real, payment runtime, ledger, push em device ou custo inesperado bloqueia avanco para Gate 3.

## Gate 3 - Split/saldo motorista

Status local: aprovado para manter modelo atual; implementacao de split real continua bloqueada por feature flag/decisao operacional.

Validacoes executadas:

- Backend:
  - `tests/unit/services/payment-service.payment-status-cache.unit.test.js`
  - `tests/unit/services/financial-ledger-service.unit.test.js`
  - `tests/unit/routes/woovi-webhook-guards.unit.test.js`
  - `tests/unit/routes/payment-withdrawal-password.unit.test.js`
  - `tests/unit/workers/worker-billing.unit.test.js`
- Mobile:
  - `__tests__/driver-balance-service-pilot.test.js`
  - `__tests__/woovi-payment-modal.test.js`

Resultados:

- Backend financeiro: 5 suites, 64 tests passando.
- Mobile financeiro: 2 suites, 6 tests passando.

Regra:

- Pagamento antecipado Pix nao deve fazer split na cobranca inicial.
- A cobranca inicial deve seguir com `splitDeferred: true` e `settlementPolicy: post_ride_ledger`.
- O credito do motorista nasce no encerramento/liquidacao da corrida, via ledger interno.
- Saque usa saldo canonico, taxa aplicavel e bloqueio por senha/KYC/ledger antes de Pix Out.
- Qualquer split real Woovi deve ficar atras de feature flag e runtime profile backend.
- Mobile deve exibir saldo/saque sem assumir repasse externo se o ledger interno ainda for a fonte de verdade.
