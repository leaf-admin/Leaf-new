# Runtime Hardening Wave - 2026-03-29

## Escopo desta wave
- materializacao inicial de baseline de pricing por microrregiao H3
- persistencia de estado e historico curto de excecao em Redis
- observabilidade de H3 refresh e pricing dinamico
- monitor operacional de `REASSIGNMENT_PENDING` preso e volume de `EARLY_ENDED_REVIEW`
- instrumentacao de auditoria de pricing em `estimateRideFare`, `RequestRideCommand` e `POST /api/pricing/quote`
- primeira rodada segura de higiene de repo sem cleanup destrutivo

## Entregas implementadas

### Settlement autoritativo e review
- servico unificado de settlement para finalizacoes especiais:
  - `services/ride-settlement-service.js`
- `EndRideEarlyByRiderCommand` e `RespondOperationalContinuationCommand` passam a usar o servico autoritativo
- novo comando:
  - `commands/EndRideWithReviewCommand.js`
- novo socket modular:
  - `endRideWithReview`
  - integrado em `bootstrap/register-socket-active-ride-handlers.js`
- socket tambem ligado no runtime canonico:
  - `server.vps.js`
- `tripCompleted` agora aceita `reviewContext`

### Pricing baseline materializado
- store central para baseline/state/history:
  - `services/pricing-context-store.js`
- provider atualizado para usar store dedicado:
  - `services/pricing-context-provider.js`
- materializer batch:
  - `services/pricing-baseline-materializer.js`
- runner operacional:
  - `scripts/ops/materialize-pricing-baselines.cjs`
- worker recorrente e config PM2 dedicada:
  - `workers/pricing-baseline-worker.js`
  - `workers/pm2.pricing-baseline.config.js`

### Ride health operacional
- monitor de estados operacionais sensiveis:
  - `services/ride-health-monitor.js`
- indexacao automatica na state machine:
  - `services/ride-state-manager.js`
- worker recorrente e config PM2 dedicada:
  - `workers/ride-health-monitor-worker.js`
  - `workers/pm2.ride-health-monitor.config.js`
- resumo operacional agora entra no payload do dashboard websocket:
  - `services/dashboard-websocket.js`

### Observabilidade
- metricas Prometheus adicionadas:
  - `leaf_h3_refresh_hint_total`
  - `leaf_pricing_evaluation_total`
  - `leaf_pricing_dynamic_quotes_total`
  - `leaf_pricing_minimum_fare_applied_total`
  - `leaf_pricing_score_pressao`
- `leaf_pricing_score_excecao`
- `leaf_pricing_baseline_materialization_total`
- `leaf_pricing_baseline_materialization_duration_seconds`
- `leaf_pricing_baseline_materialized_cells_total`
- `leaf_ride_health_state_total`
- `leaf_ride_health_stuck_total`
- `leaf_ride_health_recent_total`
- `leaf_ride_health_alert_total`
- integracao de metricas em:
  - `utils/map-h3-refresh-broadcaster.js`
  - `services/dashboard-websocket.js`
  - `services/fare-estimation-service.js`
  - `routes/pricing.js`

### Auditoria de pricing
- `estimateRideFare(...)` agora retorna `pricingAudit` com:
  - celula H3 de origem
  - resolucao
  - sources de baseline/state/history
  - snapshots usados no calculo
  - contagem de vizinhos degradados
- `RequestRideCommand` persiste `pricingAudit` no booking
- `POST /api/pricing/quote` responde `pricingAudit`

### Higiene de repo
- script de diagnostico:
  - `scripts/ops/report-worktree-hygiene.sh`
- `.gitignore` endurecido apenas para artefato temporario claro:
  - `leaf-websocket-backend/coverage/`
  - `leaf-websocket-backend/tmp/`
  - `tmp/`
  - `mobile-app/.tmp-*`
  - `mobile-app/.tmp-qa-evidence/`
  - `mobile-app/.maestro/`
  - `mobile-app/tmp/`

## Validacao rodada
- `node --check`:
  - `services/pricing-context-store.js`
  - `services/pricing-context-provider.js`
  - `services/pricing-baseline-materializer.js`
  - `services/fare-estimation-service.js`
  - `routes/pricing.js`
  - `utils/prometheus-metrics.js`
  - `utils/map-h3-refresh-broadcaster.js`
  - `services/dashboard-websocket.js`
  - `commands/RequestRideCommand.js`
- Jest:
  - `tests/unit/services/pricing-context-store.unit.test.js`
  - `tests/unit/services/pricing-baseline-materializer.unit.test.js`
  - `tests/unit/services/pricing-context-provider.unit.test.js`
  - `tests/unit/services/fare-estimation-service.unit.test.js`
  - `tests/unit/commands/RequestRideCommand.unit.test.js`
  - `tests/unit/services/ride-settlement-service.unit.test.js`
  - `tests/unit/commands/EndRideWithReviewCommand.unit.test.js`
  - `tests/unit/utils/trip-completion-payload.unit.test.js`
  - `tests/unit/services/ride-health-monitor.unit.test.js`
  - `tests/unit/workers/ride-health-monitor-worker.unit.test.js`
  - `tests/unit/services/ride-state-manager-monitoring.unit.test.js`

Resultado acumulado desta wave:
- `12/12` suites
- `24/24` testes
- monitor operacional de `REASSIGNMENT_PENDING` preso e volume de `EARLY_ENDED_REVIEW` adicionado

## Validacao VPS e hotfix de deploy
- durante a primeira tentativa de rollout desta wave, o `leaf-websocket` entrou em restart loop na VPS porque `services/pricing-context-store.js` nao estava incluido no conjunto de arquivos sincronizados pelo deploy seletivo
- o sintoma operacional foi:
  - healthcheck do backend falhando
  - `leaf-websocket` reiniciando em loop
  - stack principal: `Cannot find module './pricing-context-store'`
- correcao aplicada:
  - `scripts/ops/deploy-dashboard-rbac-vps.sh` agora sincroniza tambem:
    - `services/pricing-context-store.js`
    - `services/pricing-baseline-materializer.js`
    - `workers/pricing-baseline-worker.js`
    - `workers/pm2.pricing-baseline.config.js`
    - `scripts/ops/materialize-pricing-baselines.cjs`
  - smoke do backend no deploy passou a ser `docker-aware`, validando `http://127.0.0.1:3001/health/liveness` via `docker exec leaf-websocket ...` quando o runtime canônico estiver em Docker
- recuperacao validada:
  - backend interno respondeu `{\"status\":\"alive\"...}`
  - rota publica `POST /api/pricing/quote` voltou a responder `200`
  - `backfill-ride-health-index.cjs` executou com sucesso dentro do container do backend usando Redis interno do runtime Docker
- resultado final:
  - rerun completo de `bash leaf-websocket-backend/scripts/ops/deploy-dashboard-rbac-vps.sh` terminou em `OK`
  - backend e dashboard voltaram a ficar saudaveis no caminho oficial de rollout

## Riscos que continuam abertos
- `server.vps.js`, `routes/dashboard.js` e `register-socket-create-booking-handler.js` continuam mistos com trabalho paralelo
- baseline agora possui worker dedicado, mas ainda nao foi validado em Redis real local nesta maquina
- histerese do pricing continua dependente de Redis e do provider, mas ainda sem job distribuido formal
- custo por SKU via billing export/BigQuery ainda nao foi implantado
- Android fisico, `EARLY_ENDED_REVIEW` e limpeza final do legado continuam fora desta wave

## Proxima wave recomendada
1. ligar o materializer a um runner operacional controlado
2. fechar `EARLY_ENDED_REVIEW` e settlement autoritativo unico
3. completar a matriz mobile cross-platform
4. atacar desligamento do legado e relatorio tecnico-financeiro final
