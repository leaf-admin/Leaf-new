# Soft Release Checklist - 2026-03-06

## 1) Fluxo E2E de corrida (backend)
- Status: PARCIAL (fluxo validado, com contenção em cenário multi-corrida)
- Evidências:
  - `leaf-websocket-backend/stress-test-e2e-rides-1772837316836.json` -> 1/1 corridas completas (100%)
  - `leaf-websocket-backend/stress-test-e2e-rides-1772837056484.json` -> 3/6 (50%)
  - `leaf-websocket-backend/stress-test-e2e-rides-1772837220190.json` -> 2/4 (50%)
- Observação:
  - Em carga concorrente, parte falha por regra de disponibilidade (`NO_DRIVERS_AVAILABLE`) e contenção (`driver already in other ride`).

## 2) Dashboard novo em tempo real
- Status: OK
- Evidência:
  - `node leaf-websocket-backend/scripts/tests/test-dashboard-websocket.js`
  - Login JWT OK, socket autenticado, eventos em tempo real recebidos (`live_stats_update`, `metrics:updated`, `users:stats:updated`, `rides:stats:updated`, `revenue:stats:updated`).

## 3) Woovi sandbox + configuração runtime
- Status: OK (sandbox)
- Evidências:
  - `GET /api/woovi/test-connection` -> success true
  - `POST /api/woovi/create-charge` (value/amount) -> success true
  - `POST /api/woovi/test-webhook` -> success true
  - `npm run config:validate` -> `ok: true`
- Ajustes aplicados:
  - `.env`: `WOOVI_BASE_URL=https://api.woovi-sandbox.com/api/v1`
  - `.env`: `LEAF_PIX_KEY=test@leaf.app.br` (sandbox)
  - Novo validador: `leaf-websocket-backend/scripts/deploy/validate-runtime-config.js`

## 4) Rate limits (soft release)
- Status: OK (congelado em perfil de soft release)
- Arquivos:
  - `leaf-websocket-backend/middleware/rateLimiter.js` (HTTP rate limits por env + defaults de soft release)
  - `leaf-websocket-backend/services/rate-limiter-service.js` (eventos socket ajustados)
  - `leaf-websocket-backend/config/soft-release.env.example` (perfil recomendado)

## 5) Healthcheck VPS
- Status: OK
- Evidência:
  - `bash scripts/healthcheck-vps.sh` -> 17 OK | 0 falhas
- Ajuste aplicado:
  - Script atualizado para comportamento atual de produção (websocket-only sem polling).

## 6) Pré-lojas (Google/Apple)
- Status: PARCIAL
- OK no código/config:
  - Política e termos configurados em `mobile-app/config/AppConfig.js`
  - Pacotes app (`br.com.leaf.ride`) e permissões principais configuradas em `mobile-app/app.config.js`
  - Build dashboard Next passou (`leaf-dashboard-js`)
- Pendências operacionais (manuais):
  - Conteúdo final de store listing (screenshots, descrição curta/longa por loja)
  - Política de privacidade e termos publicados e acessíveis publicamente (verificar URL externa final)
  - Compliance financeiro final em produção (Woovi produção + webhook produção + LEAF_PIX_KEY de produção)
  - Teste final ponta a ponta no app mobile real (com corrida real no dispositivo e usuário motorista/passageiro de teste)
