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

## Gate 4 - Public App Links no dominio

Status: backend publicado e validacao publica aprovada; pendente validacao em device real.

Problema encontrado:

- `https://leaf.app.br/.well-known/apple-app-site-association` respondia 404.
- `https://leaf.app.br/.well-known/assetlinks.json` respondia 404.
- `https://leaf.app.br/viagem/teste-canary` respondia 404.
- `https://leaf.app.br/convite/teste` e `https://leaf.app.br/motorista/convite/teste` tambem respondiam 404.

Diagnostico:

- O dominio `leaf.app.br` esta respondendo via Express/backend na estrutura atual.
- A configuracao local da landing page ja tinha os arquivos estaticos, mas eles nao estavam publicados/roteados no host publico.
- Portanto, o ponto seguro de correcao e o backend modular que serve o dominio raiz.

Ajuste aplicado:

- Nova rota publica backend `routes/app-link-association.js`.
- `/.well-known/apple-app-site-association` retorna AASA com:
  - `/convite/*`
  - `/motorista/convite/*`
  - `/viagem/*`
- `/.well-known/assetlinks.json` retorna assetlinks para `br.com.leaf.ride`.
- `/convite/*`, `/motorista/convite/*` e `/viagem/*` retornam fallback HTML leve com deep link para o app.
- A rota foi registrada antes das rotas de dashboard/catch-all em `bootstrap/register-http-routes.js`.

Validacoes executadas:

- `node -c leaf-websocket-backend/routes/app-link-association.js`
- `node -c leaf-websocket-backend/bootstrap/register-http-routes.js`
- `cd leaf-websocket-backend && npx jest --config config/jest.unit.config.js --runTestsByPath tests/unit/routes/app-link-association-routes.unit.test.js --runInBand`
- `npm run prelaunch:app-links`
- `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime`
- `npm --prefix leaf-websocket-backend run config:validate`

Resultados:

- App link route unit: 1 suite, 5 tests passando.
- App links contract: PASS.
- Runtime config: `ok=true`; warning esperado de biometria estrita desligada.

Observacao:

- O wrapper `npm --prefix leaf-websocket-backend test -- --runTestsByPath ...` rodou a suite unit completa em vez de respeitar o alvo e expôs uma falha existente em `tests/unit/routes/ops-ride-cost-telemetry.unit.test.js` relacionada a mock de logger/Redis. A rota nova foi validada por Jest focado e nao depende desse teste.

Deploy/validacao publica:

- Deploy backend Contabo executado em `api.leaf.app.br` com runtime modular.
- `https://leaf.app.br/.well-known/apple-app-site-association`: 200, paths OK.
- `https://leaf.app.br/.well-known/assetlinks.json`: 200, package `br.com.leaf.ride` OK.
- `https://leaf.app.br/viagem/teste-canary`: 200 HTML.
- `https://leaf.app.br/convite/teste`: 200 HTML.
- `https://leaf.app.br/motorista/convite/teste`: 200 HTML.
- `https://www.leaf.app.br/.well-known/apple-app-site-association`: 200.
- `https://www.leaf.app.br/.well-known/assetlinks.json`: 200.
- `https://www.leaf.app.br/viagem/teste-canary`: 200 HTML.
- `https://api.leaf.app.br/health`: 200, Redis/WebSocket/System healthy; Firebase warning por latencia Firestore no primeiro health pos-restart.
- `socket.io-client` em `https://socket.leaf.app.br`: conectado com sucesso via websocket.

Incidente operacional durante deploy:

- O script legado de deploy tentou copiar `.env.production` local incompleto para `/opt/leaf-app/.env`.
- O primeiro `docker compose up` falhou por `REDIS_PASSWORD` ausente.
- Correcao aplicada imediatamente: restaurado `/opt/leaf-app/.env` com `.tmp-contabo.env` local e executado `docker compose up -d --build`.
- Todos os containers principais ficaram healthy apos a correcao.
- O script executou `docker compose down -v` antes da falha, portanto o Redis local da VPS foi recriado. Como Redis e cache/estado operacional volatil, o servico voltou healthy, mas esta rotina precisa ser endurecida antes do proximo deploy.

Follow-up obrigatorio:

- Corrigir o deploy script para nunca sobrescrever `.env` remoto com template incompleto.
- Remover `down -v` da rotina padrao de deploy; usar backup/preflight de env e rollback.
- Revisar containers orfaos `leaf-websocket-gateway-2` e `leaf-websocket-gateway-3` em ticket separado antes de remover.
- Validar Universal Links/App Links em iOS/Android reais apos nova build nativa quando aplicavel.

## Gate 5 - Deploy Contabo sem perda de env/volume

Status: deploy real aprovado na Contabo.

Problema enderecado:

- O script de deploy copiava `.env.production` local para `/opt/leaf-app/.env` sempre que o arquivo existia.
- Em seguida executava `docker compose down -v`, removendo volumes antes de validar se o runtime subiria novamente.
- Essa combinacao permitia indisponibilidade operacional se o `.env.production` local estivesse incompleto.

Ajuste aplicado:

- `DEPLOY_COPY_LOCAL_ENV=false` passa a ser o comportamento padrao.
- O `.env` remoto existente e preservado por padrao.
- Sobrescrever o `.env` remoto agora exige `DEPLOY_COPY_LOCAL_ENV=true`.
- Quando houver sobrescrita explicita, o script valida `.env.production` local e cria backup remoto antes do envio.
- Antes de tocar containers, o script valida no remoto as chaves obrigatorias:
  - `REDIS_PASSWORD`
  - `CORS_ORIGIN`
  - `JWT_SECRET`
- Removido `docker compose down -v` do fluxo padrao.
- O restart passa a usar `docker compose up -d` sem apagar volumes.

Validacoes executadas:

- `bash -n leaf-websocket-backend/scripts/deploy-hostinger-docker.sh`
- `rg` comprovando ausencia de `down -v`.
- SSH read-only em `api.leaf.app.br` confirmando `.env` remoto com `REDIS_PASSWORD`, `CORS_ORIGIN` e `JWT_SECRET`.
- `git diff --check`
- `node scripts/maintenance/security/scan-secrets.cjs --tracked-only`
- `bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh`
- `npm --prefix leaf-websocket-backend run check:no-active-vps-runtime`
- Deploy real via:
  - `CONTABO_HOST=api.leaf.app.br SSH_KEY_PATH=/Users/izaakdias/.ssh/leaf_contabo_20260412_ed25519 CHECK_RUNTIME_PARITY=true ./scripts/deploy-contabo-docker.sh`
- O deploy executado com `DEPLOY_COPY_LOCAL_ENV=false` confirmou:
  - `.env` remoto preservado;
  - `.env` remoto validado antes de tocar containers;
  - `docker compose up -d` executado sem `down -v`;
  - Redis manteve volume/AOF e carregou `10998` chaves no boot observado;
  - Redis, WebSocket, billing-worker e sideeffects-worker ficaram healthy;
  - runtime local/remoto em paridade no pos-deploy.
- Validacao publica pos-deploy:
  - hash do `.env` remoto permaneceu `f841e30cc58e8c6a0174e7a4fca5b9b1cccb687d78294c2f19f5a41510944332`;
  - `https://api.leaf.app.br/health` respondeu; Redis, WebSocket e System healthy;
  - Firebase ficou em warning por latencia momentanea de Firestore pos-restart, com Realtime DB healthy;
  - `socket.io-client` conectou em `https://socket.leaf.app.br` via websocket.

Observacoes operacionais:

- A VPS informa 19 updates pendentes, 2 de seguranca, e `System restart required`; tratar em janela separada.
- Containers orfaos `leaf-queue-worker`, `leaf-websocket-gateway-2` e `leaf-websocket-gateway-3` continuam rodando e nao foram removidos neste gate.
- Compose segue emitindo warnings de env AWS liveness vazias; nao bloqueia o deploy atual, mas deve ser tratado na frente de KYC/liveness.
