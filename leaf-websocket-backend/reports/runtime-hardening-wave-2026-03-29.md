# Runtime Hardening Wave - 2026-03-29

## Escopo desta wave
- materializacao inicial de baseline de pricing por microrregiao H3
- persistencia de estado e historico curto de excecao em Redis
- observabilidade de H3 refresh e pricing dinamico
- instrumentacao de auditoria de pricing em `estimateRideFare`, `RequestRideCommand` e `POST /api/pricing/quote`
- primeira rodada segura de higiene de repo sem cleanup destrutivo

## Entregas implementadas

### Pricing baseline materializado
- store central para baseline/state/history:
  - `services/pricing-context-store.js`
- provider atualizado para usar store dedicado:
  - `services/pricing-context-provider.js`
- materializer batch:
  - `services/pricing-baseline-materializer.js`
- runner operacional:
  - `scripts/ops/materialize-pricing-baselines.cjs`

### Observabilidade
- metricas Prometheus adicionadas:
  - `leaf_h3_refresh_hint_total`
  - `leaf_pricing_evaluation_total`
  - `leaf_pricing_dynamic_quotes_total`
  - `leaf_pricing_minimum_fare_applied_total`
  - `leaf_pricing_score_pressao`
  - `leaf_pricing_score_excecao`
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

Resultado:
- `5/5` suites
- `9/9` testes

## Riscos que continuam abertos
- `server.vps.js`, `routes/dashboard.js` e `register-socket-create-booking-handler.js` continuam mistos com trabalho paralelo
- baseline ainda nao esta ligado a um scheduler oficial de 5 minutos
- histerese do pricing continua dependente de Redis e do provider, mas ainda sem job distribuido formal
- custo por SKU via billing export/BigQuery ainda nao foi implantado
- Android fisico, `EARLY_ENDED_REVIEW` e limpeza final do legado continuam fora desta wave

## Proxima wave recomendada
1. ligar o materializer a um runner operacional controlado
2. fechar `EARLY_ENDED_REVIEW` e settlement autoritativo unico
3. completar a matriz mobile cross-platform
4. atacar desligamento do legado e relatorio tecnico-financeiro final
