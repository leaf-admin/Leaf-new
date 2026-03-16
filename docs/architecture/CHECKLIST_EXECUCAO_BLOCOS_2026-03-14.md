# CHECKLIST DE EXECUCAO POR BLOCOS (2026-03-14)

## Bloco 0 - Baseline Estrutural + Smoke Inicial

### Inventario atual do repositorio
- API routes backend: `257`
- Socket handlers/listeners mapeados: `536`
- Paginas dashboard (`app/**/page.*`): `19`
- Arquivos em `mobile-app/src/screens`: `79`
- Arquivos em `mobile-app/src/components`: `98`

### Validacao de configuracao runtime (backend)
- Comando: `npm run config:validate --workspace leaf-websocket-backend`
- Resultado: `falhou` (esperado no ambiente local sem segredos completos)
- Chaves ausentes obrigatorias:
  - `NODE_ENV`
  - `WOOVI_ENVIRONMENT`
  - `WOOVI_BASE_URL`
  - `WOOVI_API_TOKEN`
- Recomendadas opcionais ausentes:
  - `OTEL_EXPORTER_OTLP_ENDPOINT`
  - `CORS_ORIGIN`
  - `ALLOW_PRIVATE_CORS`
  - `ALLOW_NGROK_CORS`

### Smoke local backend
- Inicializacao: `OK` (server sobe, inicializa modulos e health endpoint)
- Endpoint: `GET /api/health`
- HTTP status observado: `503`
- Motivo principal:
  - `redis` em modo `warning` por latencia local (`~453ms` no momento da coleta)
  - `system` em modo `critical` por alta carga da maquina local (CPU/RAM elevadas)

### Observacoes de ambiente
- Shell sem `npm/node` no PATH por padrao; execucao estabilizada via `nvm.sh`.
- Foi encontrado e encerrado processo `npm install` pendurado em background.

### Conclusao do bloco
- Bloco 0 concluido com baseline documentado.
- Proximo: Bloco 1 (hardening backend + fechamento com testes).

## Bloco 1 - Hardening Backend (concluido)

### Mudancas aplicadas
- `routes/dashboard.js`
  - Removidos placeholders com `Math.random()` das métricas de dashboard/monitoramento.
  - `averageWaitTime` e `averageTripTime` passam a usar parsing real de timestamps das corridas.
  - `peakHours` e `cancellationAnalysis.byTimeOfDay` passam a ser calculados de forma determinística.
  - `live stats` trocado de `KEYS bookings:*` para `SCAN/count` via `RedisScan`.
  - Adicionada amostragem de bookings em Redis para cálculo de tempos médios sem bloqueio pesado.
  - Rotas `/api/legacy/promotions*` isoladas por flag `ENABLE_LEGACY_PROMOTIONS_ROUTES` (default desligado, retorna `410`).
- `bootstrap/create-socket-server.js`
  - Removido bloco CORS morto/inconsistente e alinhado ao `corsOptions` central do `server.js`.
- `scripts/deploy/validate-runtime-config.js`
  - Carregamento de env alinhado ao bootstrap real (`ENV_FILE` ou `.env`).
  - Relatório agora mostra `envFilesLoaded`.

### Testes executados no bloco
- `npm run config:validate --workspace leaf-websocket-backend`:
  - `ok: true`
  - `envFilesLoaded: [leaf-websocket-backend/.env]`
- Smoke endpoints:
  - `GET /api/metrics/services` → `200`
  - `GET /api/live/stats` → `200`
  - `GET /api/legacy/promotions` → `410` (desativado por flag)
- Smoke WebSocket:
  - `node scripts/tests/test-basic-connection.js` com server local ativo → conexão `OK`

### Risco residual observado
- Encerrando `server.js` por `SIGTERM` ainda ocorre `ECONNRESET` no shutdown (comportamento pré-existente).

## Bloco 2 - Dashboard Admin (concluido)

### Mudancas aplicadas
- `app/promotions/page.js`
  - `load()` convertido para `useCallback` e `useEffect` ajustado para dependência correta.
- `app/metrics/marketplace/page.js`
  - Reestruturação de memoização para remover warning de dependência instável (`timeline`).
- `src/services/auth-service.js`
  - Tokens/sessão migrados para `sessionStorage` (com migração automática de legado em `localStorage`).
  - Métodos de leitura/escrita/remoção centralizados para reduzir risco de persistência indevida.
- `src/services/api.js`
  - Tratamento de erro HTTP aprimorado para retornar mensagem real da API (`error/message`) e payload.
- `jsconfig.json`
  - Alias `@/*` restaurado para o build do Next (`Module not found` resolvido).

### Testes executados no bloco
- `npm run lint` em `leaf-dashboard-js`:
  - sem warnings/erros após ajustes.
- `npm run build` em `leaf-dashboard-js`:
  - `compiled successfully`.
  - todas as rotas principais geradas (dashboard, metrics, promotions, support, users etc.).

### Observacoes
- Warning de root do Turbopack permanece informativo (múltiplos lockfiles), sem bloquear build.

## Bloco 3 - Mobile App (concluido)

### Mudancas aplicadas
- `src/services/WebSocketManager.js`
  - Removidas duplicidades de métodos `createChat` e `sendMessage`.
  - Mantida implementação mais robusta (compatibilidade com eventos legados `chat_created`/`message_sent`).
- `scripts/tests/mobile-backend-connections-new-format.cjs`
  - Ajustado para cenário local: autenticação com token opcional (`MOBILE_TEST_AUTH_TOKEN`).
  - Health local degradado/unhealthy pode ser tratado como warning controlado (`MOBILE_TEST_ALLOW_UNHEALTHY_HEALTH`).

### Testes executados no bloco
- Checagem estrutural:
  - parser JS sem erro em `WebSocketManager.js`.
  - verificação automática de métodos async duplicados: `NO_DUPLICATE_ASYNC_METHODS`.
- Fluxo completo mobile↔backend (script end-to-end local):
  - backend iniciado com `NODE_ENV=development`.
  - resultado final: `28/28 passed`, `0 failed`, `successRate=100%`.
  - relatório: `mobile-app/reports/mobile-backend-connections-report.json`.

## Bloco 4 - Segurança e Compliance (parcial com hardening aplicado)

### Mudancas aplicadas
- Remoção de fallback com chave hardcoded em pontos ativos:
  - `leaf-websocket-backend/services/places-cache-service.js`
  - `mobile-app/config/GoogleMapApiConfig.js`
  - `mobile-app/config/api-keys.js`
  - `mobile-app/plugins/withGoogleMapsApiKey.js`
  - `mobile-app/src/screens/NewMapScreen.js`
  - `mobile-app/config/FirebaseConfig.js`
  - `mobile-app/src/screens/EditProfile.js`
  - `mobile-app/src/screens/DriverDocumentsScreen.js`
  - `mobile-app/src/screens/MapScreen.js`
- `.gitignore` endurecido para artefatos sensíveis e relatórios locais:
  - `**/google-services.json`
  - `**/GoogleService-Info.plist`
  - `**/firebase-credentials.json`
  - `mobile-app/reports/`

### Validacao executada
- Scan de segredos em caminhos ativos ajustados (backend services + mobile config/plugins/screens):
  - sem ocorrências de chaves hardcoded após patch.
- Observação de baseline do repo completo:
  - ainda existem ocorrências em áreas legadas/duplicadas (`mobile-app/common/**` e `mobile-app/src/common-local/**`).

### Pendencia residual (legado)
- Limpeza completa dos blocos legados de `common` e `common-local` ainda pendente para zerar ocorrências no monorepo inteiro.
