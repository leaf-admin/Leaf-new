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

## Runtime canônico dos workers operacionais
- `pricing-baseline-worker` e `ride-health-monitor-worker` foram promovidos para o runtime Docker canônico da VPS
- o runtime Docker agora usa:
  - compose base `docker-compose.hostinger.yml`
  - overlay operacional `docker-compose.ops-workers.yml`
- o overlay define ambos como servicos dedicados, com:
  - Redis interno do stack
  - restart policy `unless-stopped`
  - healthcheck por conectividade Redis
  - dependência do `websocket` saudável
- o deploy oficial agora:
  - publica o compose canônico para `docker-compose.yml`
  - sobe `websocket`, `pricing-baseline-worker` e `ride-health-monitor-worker` no mesmo ciclo
  - valida se os dois workers ficaram `running`
- PM2 host-side permanece apenas como fallback para ambientes que não usem o runtime Docker oficial

## Observabilidade do legado e auditoria de superfície
- adicionamos instrumentação central de acesso ao Realtime Database no funil compartilhado de `firebase-config.js`
- a nova métrica Prometheus introduzida foi:
  - `leaf_legacy_runtime_access_total`
- labels observadas:
  - `dependency`
  - `operation`
  - `source`
  - `result`
- cobertura instrumentada nesta wave:
  - inicialização do Firebase/RTDB
  - obtenção da instância de RTDB
  - leituras em RTDB
  - escritas em RTDB
- também foi criado um auditor automatizado de superfície legada:
  - `scripts/ops/report-legacy-runtime-surface.cjs`
- artefatos gerados:
  - `reports/legacy-runtime-surface-1774854348616.json`
  - `reports/legacy-runtime-surface-1774854348616.md`
- resumo do scan mais recente:
  - `224` arquivos analisados
  - `48` matches de flags de runtime legado
  - `106` matches de acesso RTDB
  - `4` rotas explicitamente legadas
  - `21` logs/fallbacks legados
- hotspots mapeados:
  - `routes/dashboard.js`: `54` ocorrências agregadas
  - `routes/metrics.js`: `13`
  - `services/referral-program-state-service.js`: `12`
  - `services/promotion-service.js`: `11`
  - `server.vps.js`: `9`
- leitura operacional desta wave:
  - agora temos telemetria central para medir o peso real do legado sem tocar primeiro nos arquivos mistos de maior risco
  - o relatório automatizado cria uma base objetiva para o desligamento progressivo do RTDB e dos fallbacks herdados
  - os maiores alvos de cleanup futuro ficaram identificados com prioridade clara
- fechamento de rollout:
  - o deploy canônico foi ajustado para sincronizar `firebase-config.js` e `scripts/ops/report-legacy-runtime-surface.cjs`
  - validacao remota apos rollout:
    - `firebase-config.js` remoto passou a conter `recordLegacyDependencyAccess`
    - `docker exec leaf-websocket curl http://127.0.0.1:3001/health/liveness` respondeu `{\"status\":\"alive\"...}`
    - `POST /api/pricing/quote` publico permaneceu respondendo `200`

## QA seed lock para a superfície do passageiro
- a trilha de QA do `prototypeRideRuntime` estava sobrescrevendo snapshots seedados ainda durante o bootstrap
- causa raiz confirmada:
  - o runtime persistia novamente a sessão enquanto ainda estava inicializando
  - qualquer patch persistido cedo demais recriava a sessão com `bookingStatus: idle`
- correção aplicada:
  - lock temporário de QA separado da sessão normal
  - adiamento do `ensureSocketReady` enquanto o lock estiver ativo
  - bloqueio da persistência automática enquanto:
    - `runtimeState.initializing === true`
    - `runtimeState.ready === false`
    - o lock QA estiver ativo
- arquivos envolvidos:
  - `mobile-app/src/screens/prototype/prototypeRideRuntime.js`
  - `mobile-app/scripts/qa/seed-prototype-ios-state.cjs`
- validação:
  - parse do runtime e do seed script: `OK`
  - seed executado com sucesso no `iPhone 17 Pro`
  - estado persistido após boot permaneceu:
    - `bookingStatus: operational_interrupted`
    - `operationalContinuation.status: passenger_decision_pending`
    - `activeBookingId: booking-proof-passenger-1`
- leitura honesta:
  - o overwrite destrutivo do snapshot foi corrigido
  - a passada seguinte fechou também a auto-navegação visual do passageiro a partir do `bookingStatus`
  - validacao final no `iPhone 17 Pro`:
    - captura correta da superfície `operational_interrupted / passenger_decision_pending`
    - screenshot: `/tmp/leaf-passenger-operational-17pro-v3.png`
  - com isso, o fluxo de QA passou a cobrir:
    - persistência correta do snapshot seedado
    - preservação do estado durante o bootstrap
    - navegação automática da home para a tela de viagem quando o runtime exigir

## Primeiro corte estrutural do legado no plano macro
- a rota de `waitlist` deixou de ler a configuração de ativação de cidades diretamente do RTDB
- nova camada introduzida:
  - `leaf-websocket-backend/services/city-activation-state-service.js`
- comportamento novo:
  - Firestore-first para configuração operacional
  - fallback controlado ao RTDB legado
  - import automático do snapshot legado para Firestore quando o documento ainda não existir
- rota atualizada:
  - `leaf-websocket-backend/routes/waitlist.js`
- teste novo:
  - `tests/unit/services/city-activation-state-service.unit.test.js`
- validação:
  - `node --check` do serviço e da rota: `OK`
  - Jest: `2/2` testes passando
- impacto medido no relatório de superfície legado:
  - relatório anterior: `106` acessos diretos RTDB
  - relatório novo `legacy-runtime-surface-1774857578397.md`: `104`
  - `routes/waitlist.js` deixou de aparecer entre os top files de acesso direto ao RTDB
- leitura operacional:
  - esse foi o primeiro corte real do plano macro de desligamento progressivo do legado
  - a estratégia comprovada aqui é:
    - mover leitura para serviço dedicado
    - preferir Firestore
    - usar import controlado do legado só quando necessário

## Fechamento do gap de deploy e novo corte no KYC
- o deploy canônico não estava levando o corte de `waitlist` para a VPS
- correção aplicada no script oficial:
  - `leaf-websocket-backend/scripts/ops/deploy-dashboard-rbac-vps.sh`
  - inclusão de validação e sync para:
    - `routes/waitlist.js`
    - `services/city-activation-state-service.js`
- validação remota após o ajuste:
  - `docker exec leaf-websocket curl http://127.0.0.1:3001/health/liveness` respondeu `alive`
  - `POST /api/pricing/quote` permaneceu respondendo `200`
- segundo corte estrutural do legado:
  - `leaf-websocket-backend/services/kyc-policy-service.js` deixou de acessar `getRealtimeDB().ref(...)` diretamente
  - `leaf-websocket-backend/firebase-config.js` ganhou o helper `updateRealtimeDB(path, data)`
  - `kyc-policy-service` passou a usar:
    - `getFromRealtimeDB(...)`
    - `updateRealtimeDB(...)`
- testes cobertos:
  - `tests/unit/firebase-config.unit.test.js`
  - `tests/unit/services/kyc-policy-service.unit.test.js`
- validação:
  - `node --check` de `firebase-config.js` e `kyc-policy-service.js`: `OK`
  - Jest: `9/9` testes passando nas suítes de `firebase-config` + `kyc-policy-service`
- impacto medido no auditor:
  - relatório anterior: `legacy-runtime-surface-1774857578397.md` com `104` acessos diretos RTDB
  - relatório novo: `legacy-runtime-surface-1774858076645.md` com `101`
- leitura operacional:
  - o padrão de extração para helpers centralizados funcionou sem tocar em comportamento de domínio
  - isso abre um caminho seguro para repetir a mesma estratégia em hotspots pequenos antes de entrar em `routes/dashboard.js` e `routes/metrics.js`

## Corte incremental nas rotas KYC
- mais dois acessos pontuais ao RTDB foram removidos das rotas KYC:
  - `leaf-websocket-backend/routes/kyc-onboarding.js`
  - `leaf-websocket-backend/routes/kyc-routes.js`
- comportamento novo:
  - `kyc-onboarding` passou a persistir a âncora device-first via `firebaseConfig.updateRealtimeDB(...)`
  - `kyc-routes` passou a ler a assinatura âncora via `firebaseConfig.getFromRealtimeDB(...)`
- validação:
  - `node --check` das duas rotas: `OK`
- impacto medido no auditor:
  - relatório anterior: `legacy-runtime-surface-1774858076645.md` com `101`
  - relatório novo: `legacy-runtime-surface-1774858237369.md` com `99`
- leitura operacional:
  - essa wave foi pequena, mas importante porque confirma que os cortes incrementais também funcionam em rotas HTTP sem reabrir comportamento
  - o alvo natural seguinte continua sendo um hotspot limpo e versionado, antes de entrar nos arquivos grandes do dashboard

## Corte incremental no rating-service
- `leaf-websocket-backend/services/rating-service.js` deixou de depender diretamente do objeto `db` do RTDB
- `firebase-config.js` ganhou dois helpers adicionais:
  - `isRealtimeDBAvailable()`
  - `updateRealtimeDBRoot(updates)`
- comportamento novo no `rating-service`:
  - leitura de índices e avaliações via `getFromRealtimeDB(...)`
  - escrita em lote das avaliações via `updateRealtimeDBRoot(...)`
  - preservação do retorno de erro quando o RTDB estiver indisponível
- testes cobertos:
  - `tests/unit/firebase-config.unit.test.js`
  - `tests/unit/services/rating-service-kyc.unit.test.js`
- validação:
  - `node --check` de `firebase-config.js` e `rating-service.js`: `OK`
  - Jest: `7/7` testes passando nas suítes de `firebase-config` + `rating-service`
- impacto medido no auditor:
  - relatório anterior: `legacy-runtime-surface-1774858237369.md` com `99`
  - relatório novo: `legacy-runtime-surface-1774878173433.md` com `98`
- leitura operacional:
  - esse corte confirma que serviços de domínio que ainda dependiam de `db.ref(...)` podem migrar para helpers sem perda de comportamento
  - seguimos reduzindo a superfície legada antes de entrar em arquivos mais arriscados como `routes/metrics.js` e `routes/dashboard.js`

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
