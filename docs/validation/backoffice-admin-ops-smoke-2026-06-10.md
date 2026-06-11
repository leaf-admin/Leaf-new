# Backoffice Admin Ops Smoke - 2026-06-10

## Objective

Validar a superficie operacional do dashboard Leaf para a rotina diaria de conta, suporte, push e auditoria usando conta admin de smoke e usuarios fixture/canary.

## Admin Session

Uma conta admin operacional de smoke foi provisionada no backend com perfil `development`.

- Email: `codex-dashboard-smoke@leaf.app.br`
- Senha: armazenada fora do Git em `~/.leaf/dashboard-admin.env`
- Sessao local: `~/.leaf/dashboard-session.json`

Comandos:

```bash
npm --prefix leaf-dashboard-js run session:admin
npm --prefix leaf-dashboard-js run session:admin:snippet < ~/.leaf/dashboard-session.json
```

O snippet gerado injeta `leaf_admin_access_token`, `leaf_admin_refresh_token` e `leaf_admin_user` no `sessionStorage` do dashboard local.

## Covered Operations

### User Account Operations

Coberto por:

```bash
cd leaf-websocket-backend
npx jest --config config/jest.unit.config.js tests/unit/services/dashboard-user-management-service.unit.test.js --runInBand
```

Validado:

- suspender/bloquear motorista atualiza Firestore, RTDB e Redis runtime;
- reativar passageiro limpa bloqueio operacional/trust;
- reativar motorista nao aprovado nao o aprova indevidamente;
- solicitacao de documento preserva documento aprovado, registra pedido e envia push quando habilitado;
- gestao operacional grava auditoria persistente via `auditService.logEvent`.
- alteracao cadastral via dashboard grava auditoria persistente via `dashboard.user.profile.update`, com lista de campos alterados e sem copiar valores sensiveis para o audit log.

Smoke HTTP real contra `https://api.leaf.app.br`:

- fixture: `codex_smoke_customer_dashboard_ops`;
- suspender usuario: `200`, `success=true`;
- reativar usuario: `200`, `success=true`;
- atualizar cidade/estado: `200`, `success=true`;
- restaurar cidade/estado: `200`, `success=true`.

Observacao: a auditoria persistida de status/profile foi implementada e coberta em teste unitario local. O backend publico ainda precisa receber deploy desta rodada para o smoke real encontrar os novos eventos `dashboard.user.operational_status.update` e `dashboard.user.profile.update` em `/api/audit/logs`.

### Push From Dashboard

Coberto por:

```bash
cd leaf-websocket-backend
npx jest --config config/jest.unit.config.js tests/unit/routes/notifications-routes-auth.unit.test.js --runInBand
```

Validado:

- envio imediato por `userIds` exige role operacional;
- payload do painel chega ao endpoint `/api/notifications/send`;
- resposta inclui resumo de envio;
- agendamento recorrente continua bloqueado enquanto nao houver worker.

Smoke HTTP real contra `https://api.leaf.app.br`:

- fixture `codex_smoke_customer_dashboard_ops`: rota autenticada respondeu `200`, `sentTo=1`, `success=0`, `failed=1`, motivo operacional: fixture sem token FCM ativo;
- usuario canary `OjML1wSzdNRaynjqMRlSW1Y0LVy2`: rota autenticada respondeu `200`, `sentTo=1`, `success=0`, `failed=1`, motivo operacional: `Nenhum token FCM encontrado`.

Conclusao: RBAC, rota e painel estao funcionais; entrega real exige usuario logado em device com token FCM registrado no backend antes do disparo.

### Support Ticket From App To Dashboard

Coberto por:

```bash
cd leaf-websocket-backend
npx jest --config config/jest.unit.config.js tests/unit/routes/support-routes-admin-ops.unit.test.js --runInBand
```

Validado:

- usuario do app abre ticket em `/support/tickets`;
- dashboard/admin lista ticket em `/support/admin/tickets`;
- operador responde no historico;
- operador resolve ticket;
- historico contem mensagem do usuario e acao do operador.

Smoke real executado contra `https://api.leaf.app.br`:

- script: `leaf-websocket-backend/scripts/tests/smoke-support-two-profiles.cjs`;
- resultado: `14/14` passos passaram;
- ticket: `TICKET-1781113280928-nwlo834du`;
- usuario app/canary: `OjML1wSzdNRaynjqMRlSW1Y0LVy2`;
- coberto: abrir chamado no app, listar no dashboard, assumir, responder, usuario ler resposta, usuario enviar chat, dashboard ler historico, fechar chat, reabrir por nova mensagem.

### Dashboard Shell

Coberto por:

```bash
npm --prefix leaf-dashboard-js run qa:backoffice
```

Validado:

- Basic Auth bloqueia acesso anonimo;
- rotas protegidas redirecionam sem sessao admin;
- `/dashboard`, `/support`, `/campaign-center`, `/drivers/review-queue`, `/financial-reconciliation` e `/runtime-flags` renderizam;
- navegacao superior entre areas principais funciona;
- browser do dashboard nao chama Google, Woovi/OpenPix ou Firebase diretamente.

## Evidence Commands Run

```bash
npx jest --config config/jest.unit.config.js tests/unit/services/dashboard-user-management-service.unit.test.js --runInBand
npx jest --config config/jest.unit.config.js tests/unit/services/dashboard-user-service.unit.test.js --runInBand
npx jest --config config/jest.unit.config.js tests/unit/routes/notifications-routes-auth.unit.test.js tests/unit/routes/support-routes-admin-ops.unit.test.js --runInBand
npm --prefix leaf-dashboard-js run qa:backoffice
npm --prefix leaf-websocket-backend run config:validate
node scripts/maintenance/security/scan-secrets.cjs --tracked-only
bash leaf-websocket-backend/scripts/tests/assert-no-hardcoded-secrets.sh
npm run governance:check
git diff --check
```

## Risks

- O push real pelo painel foi tentado, mas nao houve entrega porque os usuarios testados nao tinham token FCM ativo no backend. Repetir com device logado e token registrado.
- A auditoria nova de status/profile precisa de deploy backend para aparecer no smoke de producao.
- A validacao visual/interativa com dados reais no dashboard deve usar somente usuarios de teste/canary.
- A conta `codex-dashboard-smoke@leaf.app.br` deve permanecer restrita ao perfil `development`.

## Rollback

- Remover a conta `codex-dashboard-smoke@leaf.app.br` da collection `adminUsers` se ela nao for mais necessaria.
- Remover arquivos locais `~/.leaf/dashboard-admin.env` e `~/.leaf/dashboard-session.json`.
- Reverter os commits desta rodada para remover auditoria adicional e scripts de sessao.
