# Relatorio de limpeza arquitetural Leaf - 2026-05-24

## Escopo executado

- Guardrails de runtime/backend para bloquear flags perigosas em producao.
- Health/readiness com estado explicito do Socket.IO Redis Adapter.
- Idempotencia do webhook Woovi com estados `processing`, `processed`, `failed` e `rejected`.
- Contrato canonico financeiro para pagamento, pedagio, taxa Leaf, taxa de intermedicao, saldo do motorista e retencao.
- Contrato canonico mobile para lifecycle de corrida ativa/terminal.
- Inventario de paridade entre `server.vps.js` e runtime modular.
- Guardrail mobile de release para profiles EAS de producao/review.
- Dashboard com transporte websocket configuravel por ambiente.
- Canary e deploy controlado do backend na Contabo com Redis Adapter obrigatorio.
- Paridade estatica de eventos socket: eventos existentes somente no VPS zerados.
- Cutover controlado do gateway de producao para runtime modular na Contabo.
- Fechamento do sideeffects-worker como processo dedicado modular, sem worker embutido no gateway.

## Evidencias de validacao local

- Backend Jest focado: 12 suites, 88 testes passando.
- Backend handshake/socket Jest focado incluido na bateria acima.
- Mobile Jest focado: 2 suites, 19 testes passando.
- Mobile orchestrator/socket Jest focado: 2 suites, 16 testes passando.
- Dashboard lint focado: `src/config/index.js` e `src/services/websocket-service.js` passando.
- `production-guard-asserts.sh` passando com validacao dos profiles EAS.
- `runtime-contract-inventory.js` executado:
  - HTTP routes: 59
  - Socket events: 114
  - HTTP by runtime: modular 30, vps 29
  - Socket by runtime: modular 65, vps 49
  - HTTP only in VPS: 0
  - Socket only in VPS: 0
- `smoke:runtime-redis-adapter` passando localmente com Redis real, broadcast cross-instance, runtime VPS e runtime modular saudaveis.
- `smoke:runtime-critical-events` passando localmente com Redis real, runtime VPS e runtime modular saudaveis:
  - `checkRideAvailability` -> `rideAvailabilityError`
  - `passengerLocationUpdate` -> `passengerLocationError`
  - `confirmBoardingStatus` -> `boardingStatusError`
  - `endTripEarlyByRider` -> `tripCompleteError`
  - Artefato: `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-critical-events/runtime-critical-events-smoke-1779659581625.json`
- `smoke:runtime-full-ride-flow` passando localmente com Redis real, runtime VPS e runtime modular saudaveis:
  - autenticacao passageiro + motorista
  - motorista online em Redis/geosearch
  - `createBooking`
  - `confirmPayment` com pagamento mock controlado
  - `newRideRequest`
  - `acceptRide`
  - `notificationAction` para chegada no embarque
  - `startTrip`
  - `updateLocation` com evento de localizacao para passageiro
  - `completeTrip`
  - `paymentDistributed`
  - Redis final com `status=completed`, `paymentStatus=in_holding`, `finalFare=27.5`, `driverNetAmount=25.51`, viagem ativa limpa para passageiro e motorista
  - Artefato: `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/runtime-full-ride-flow-smoke-1779665836495.json`
- Health Contabo pos-deploy:
  - `leaf-websocket Up ... (healthy)`
  - `/health/quick` com Redis saudavel.
  - `socketRedisAdapter.state = ready`
  - logs recentes sem erros.
- Cutover Contabo para gateway modular:
  - `websocket` em `LEAF_SERVER_RUNTIME=modular`.
  - `sideeffects-worker` preservado em `LEAF_SERVER_RUNTIME=vps`.
  - Health publico `api` e `socket` saudavel.
  - Handshake Socket.IO bruto passando.
  - `validate-runtime-config.js` sem blockers.
  - Smoke funcional de corrida completa passando em producao com tokens reais Firebase e pagamento prevalidado por cache interno.
  - Artefato: `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/production-modular-cutover-full-flow-1779671491090.json`
- Fechamento do worker lateral:
  - Gateway modular nao inicializa mais WorkerManager embutido quando `ENABLE_EMBEDDED_LISTENER_WORKERS=false`.
  - `sideeffects-worker` roda via `scripts/runtime/start-sideeffects-worker.sh`.
  - `sideeffects-worker` em `LEAF_SERVER_RUNTIME=modular`.
  - Redis Stream `ride_events` com somente `listener-worker-1` e `pending=0`.
  - Smoke funcional de producao passou apos a troca.
  - Artefato: `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/production-modular-sideeffects-full-flow-1779674642560.json`
- Higiene operacional de compose/env:
  - atributo obsoleto `version` removido dos composes ativos.
  - variaveis opcionais de Woovi OAuth, Maps/LocationIQ e AWS KYC sem valor agora usam default vazio e nao geram warning.
  - `docker compose config --services` na Contabo passou sem warnings.
  - healthcheck do `nginx` corrigido para HTTPS local.
  - `nginx` recriado e validado healthy junto com `websocket`, `sideeffects-worker`, `billing-worker` e `redis`.
  - health publico `api.leaf.app.br/health/liveness` e `socket.leaf.app.br/health/liveness` respondeu `alive`.

## Pontos protegidos

- Release publica mobile falha se payment bypass, test user tools, OTP QA, E2E ou HTTP inseguro estiverem ligados.
- Profile de review exige `APP_REVIEW=true`, mas mantem bypasses perigosos desligados.
- Gateway backend em producao exige Socket.IO Redis Adapter por padrao.
- Readiness passa a falhar quando o adapter obrigatorio nao esta pronto.
- Webhook Woovi pode reprocessar evento `failed` ou stale sem perder idempotencia.
- Settlement financeiro evita linha contabil zerada e preserva pedagio como passthrough do motorista.

## Pendencias pos-cutover

- Rodar monitoramento assistido depois da proxima rodada mobile para observar comportamento real de socket/pagamento/corrida em dispositivo.
- Remover `DatabaseBypass` apenas em canary separado; hoje ele esta sem uso ativo encontrado fora do proprio arquivo.
- Migrar `PaymentBypassService` para uma area explicitamente QA ou remover quando os fluxos legados sairem.
- Continuar extraindo dominios de `prototypeRideRuntime.js` sem alterar comportamento de UI.
- Planejar aposentadoria gradual de `server.vps.js` como arquivo de rollback temporario, agora que gateway e worker lateral estao modulares.

## Decisao atual

Producao esta com gateway e sideeffects-worker em runtime modular na Contabo. O gateway usa `server.js`, Redis Adapter obrigatorio e `ENABLE_EMBEDDED_LISTENER_WORKERS=false`; o sideeffects-worker usa entrypoint dedicado `scripts/runtime/start-sideeffects-worker.sh` e consome sozinho o grupo `listener-workers`. A troca foi feita depois de paridade estatica, smoke local, canary remoto modular, canary funcional completo e smokes de producao com tokens reais Firebase. O rollback imediato do gateway ainda e voltar o `websocket` para `LEAF_SERVER_RUNTIME=vps` no compose da Contabo e recriar apenas esse servico.
