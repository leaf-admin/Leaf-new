# Runtime Parity Matrix - server.vps.js vs server.js

Data: 2026-05-24
Escopo: backend realtime/API Leaf em `leaf-websocket-backend`.

## Decisao atual

O gateway de producao foi migrado para o runtime modular (`server.js`) em janela controlada na Contabo.

O processo `sideeffects-worker` segue preservado com `LEAF_SERVER_RUNTIME=vps` por cautela operacional, porque ele roda como processo separado e nao precisava entrar no corte do gateway.

Evidencias locais:

- `scripts/runtime/start-server.sh` aceita `LEAF_SERVER_RUNTIME=modular|vps|custom`.
- `docker-compose.hostinger.yml` ainda fixa `LEAF_SERVER_RUNTIME=vps` para ambientes derivados desse compose.
- Na Contabo, `/opt/leaf-app/docker-compose.yml` esta com `websocket` em `LEAF_SERVER_RUNTIME=modular` e `sideeffects-worker` em `LEAF_SERVER_RUNTIME=vps`.
- `docker-compose.hostinger.yml` roda `RUNTIME_ROLE=gateway`, `LEAF_CLUSTER_ENABLED=true`, `ENABLE_SOCKETIO_REDIS_ADAPTER=true` e flags legacy desligadas por padrao.
- `server.js` e o runtime modular viraram o gateway ativo de producao apos canary especifico, backup e smoke funcional.
- `npm run report:runtime-parity` gera inventario JSON/Markdown em `test-results/runtime-contract-inventory.*`.
- `npm run check:runtime-parity` falha se voltar a existir rota HTTP ou evento Socket.IO presente somente no runtime VPS.
- Resultado atual do inventario:
  - HTTP routes: 59.
  - Socket events: 114.
  - HTTP only in VPS: 0.
  - Socket events only in VPS: 0.
  - HTTP only in modular: `/api/demand`.
  - Socket events only in modular: 14 eventos adicionais concentrados em `register-socket-legacy-bridge-handler.js` e `arriveAtPickup`.

Evidencias de producao pos-cutover:

- Runtime ativo no container `leaf-websocket`: `LEAF_SERVER_RUNTIME=modular`.
- `/health/quick`: `healthy`.
- `socketRedisAdapter.state = ready`.
- `socketRedisAdapter.enabled = true`.
- `socketRedisAdapter.required = true`.
- `socketRedisAdapter.runtimeRole = gateway`.
- Handshake Engine.IO + Socket.IO via WebSocket bruto passou com pacote `40`.
- Smoke funcional de corrida completa passou em producao usando tokens reais Firebase e cache interno de pagamento prevalidado.
- Evidencia: `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/production-modular-cutover-full-flow-1779671491090.json`.

## Matriz

| Area | `server.vps.js` hoje | `server.js` modular | Status | Proxima acao |
| --- | --- | --- | --- | --- |
| Selecao de runtime | Preservado para worker lateral e rollback. | Gateway ativo em producao via `LEAF_SERVER_RUNTIME=modular`. | Cutover executado. | Manter rollback simples e remover dependencia do VPS por dominio, nao por pressa. |
| Cluster/gateway | Fluxo legado preservado para comparacao. | Gateway modular ativo com Redis Adapter obrigatorio e `RUNTIME_ROLE=gateway`. | Validado no corte. | Evoluir para orquestracao horizontal previsivel antes de escalar replicas. |
| HTTP middleware | Configurado inline: CORS, trace, rate limit, body parser, raw body Woovi, timeout. | Usa `bootstrap/http-middleware.js`. | Parcialmente modularizado. | Criar teste de ordem/middleware para webhook Woovi, rate limit, CORS e upload. |
| Rotas HTTP | Grande registro inline, com detalhes e duplicidade de `metricsRoutes` em alguns pontos. | `bootstrap/register-http-routes.js` centraliza rotas. | Melhor no modular, mas precisa inventario. | Gerar inventario automatico de `app.use` por runtime e comparar paths. |
| Woovi webhook | Usa `routes/woovi`; raw body definido no middleware inline. | Usa mesmo `routes/woovi`; raw body vem de `bootstrap/http-middleware.js`. | Rota comum, borda HTTP precisa parity test. | Adicionar teste de assinatura/raw body em app Express montado como producao. |
| Idempotencia Woovi | Agora registra `processing`, reprocessa `failed`/stale e conclui `processed|failed|rejected`. | Mesmo modulo de rota. | Alinhado no modulo compartilhado. | Expandir teste de integracao com replay real de webhook. |
| Metrics/health | `healthRoutes` compartilhado; exposto depois de rotas inline. Adapter Redis Socket.IO publica status global. | `healthRoutes` compartilhado; `create-socket-server` agora publica o mesmo contrato global de status. | Status/readiness alinhado. | Validar comportamento com Redis real no canary. |
| Socket.IO server | Criado inline com redis adapter direto via `@socket.io/redis-adapter`; status requerido em producao gateway. | Criado em `bootstrap/create-socket-server.js` usando `services/socket-io-adapter`; status padronizado. | Implementacao ainda divergente, contrato de health alinhado. | Extrair factory comum ou provar equivalencia antes do cutover. |
| Socket handlers | Parte ainda inline e parte modularizada; arquivo tem superficie grande. | Registra handlers via `bootstrap/register-socket-*`. | Eventos VPS-only zerados no inventario atual. | Manter `report:runtime-parity` como evidencia obrigatoria antes do canary modular. |
| Auth handshake | Ambos usam `register-socket-authenticate-handler` no fluxo atual. | Mesma base modular. | Alinhado no handler principal. | Manter testes de cache/admission e medir p95/p99 no canary. |
| Ride lifecycle | Usa handlers compartilhados/servicos, mas runtime VPS ainda concentra varias responsabilidades. | Usa bootstrap handlers dedicados. | Em transicao. | Migrar por dominio: createBooking, confirmPayment, acceptRide, startTrip, completeTrip, cancelRide. |
| GraphQL | Inicializacao inline com rotas/runtime endpoints. | `bootstrap/start-http-server.js` aplica GraphQL. | Ordem/observabilidade podem divergir. | Teste smoke `/graphql` nos dois runtimes antes do cutover. |
| Workers/listeners embutidos | Controlado por `RUNTIME_ROLE` e flags de worker em compose. | `bootstrap/init-runtime-services.js` e `setup-eventbus-workers.js`. | Similar em conceito, nao provado em runtime. | Separar responsabilidades por processo e bloquear worker embutido em gateway se a flag pedir. |
| Legacy flags | Validador bloqueia legacy/payment bypass em producao. | Mesmo validador antes do start. | Alinhado. | Manter `validate-runtime-config.js` como gate obrigatorio de deploy. |
| Observabilidade | Tem event loop lag, health, metrics e status de adapter. | Tem parte via services/bootstrap, mas status de adapter precisa padrao unico. | Parcial. | Criar contrato unico `runtimeReadiness` para health, adapter, role e listeners. |

## Plano de cutover seguro

1. Congelar explicitamente a decisao atual: producao = gateway modular, worker lateral ainda em VPS.
2. Criar inventario automatico de rotas HTTP dos dois runtimes. Concluido com `scripts/analysis/runtime-contract-inventory.js`.
3. Criar inventario automatico de eventos Socket.IO dos dois runtimes. Concluido com `scripts/analysis/runtime-contract-inventory.js`; VPS-only esta em zero na rodada atual.
4. Padronizar status do Socket.IO Redis Adapter em um modulo comum. Concluido no contrato de health; falta canary com Redis real.
5. Rodar os dois runtimes em teste local com os mesmos envs e smoke de:
   - `/health/liveness`
   - `/health/readiness`
   - `/api/woovi/webhook`
   - `/api/payment/*`
   - `/api/campaign-center/*`
   - handshake socket
   - create/confirm/accept/start/complete ride
6. Fazer canary modular somente em staging ou porta paralela, sem trocar producao. Concluido antes do corte.
7. Migrar dominio por dominio, removendo codigo inline de `server.vps.js` apenas quando o modulo tiver teste e evidencia. Continua como limpeza pos-cutover.

## Criterios de aceite usados para trocar producao para modular

- Nenhuma rota usada pelo mobile/dashboard some do inventario.
- Eventos criticos do socket aceitam o mesmo payload e emitem os mesmos estados.
- Woovi webhook preserva raw body, assinatura, idempotencia e ledger.
- Health/readiness falha se Redis adapter obrigatorio nao estiver pronto.
- Gate de config bloqueia payment bypass e legacy flags em producao.
- Canary com passageiro + motorista valida handshake, corrida completa, pagamento, recibo, suporte e notificacoes.

## Risco principal

O maior risco nao e `server.js` ser ruim; ele e justamente mais facil de manter. O risco era trocar o runtime antes de provar paridade de eventos e ordem de middlewares. A troca foi feita depois de inventario, smoke local, canary remoto e full-flow em producao; agora o risco passa a ser deixar o legado vivo por tempo demais sem uma trilha clara de aposentadoria.

## Atualizacao da rodada

Foram adicionados ao runtime modular:

- `checkRideAvailability` em `bootstrap/register-socket-search-drivers-handler.js`.
- `passengerLocationUpdate` e `confirmBoardingStatus` em `bootstrap/register-socket-trip-integrity-handlers.js`.
- `endTripEarlyByRider` em `bootstrap/register-socket-end-trip-early-handler.js`.

Com isso, a matriz automatica deixou de apontar qualquer evento existente somente no VPS. A validacao funcional inicial tambem passou com `npm run smoke:runtime-critical-events`, cobrindo os eventos `checkRideAvailability`, `passengerLocationUpdate`, `confirmBoardingStatus` e `endTripEarlyByRider` nos dois runtimes com Redis real local.

Artefato:

- `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-critical-events/runtime-critical-events-smoke-1779659581625.json`

A proxima validacao para cutover nao deve ser apenas inventario estatico; precisa smoke funcional de corrida completa/pagamento/socket com payload real antes de mover producao para o runtime modular.

## Atualizacao da rodada funcional

Foi adicionado e executado `npm run smoke:runtime-full-ride-flow`.

O smoke subiu Redis real local e executou o mesmo fluxo em `server.vps.js` e `server.js`:

- autenticacao de passageiro e motorista
- seed de motorista online em Redis/geosearch
- criacao de booking
- confirmacao de pagamento mock controlado
- notificacao da corrida para motorista
- aceite da corrida
- chegada ao embarque via `notificationAction`
- inicio da viagem
- atualizacao de localizacao durante a viagem
- conclusao da viagem
- distribuicao de pagamento
- validacao do booking final em Redis
- limpeza de viagem ativa para passageiro e motorista

Resultado da ultima rodada:

| Runtime | Status | Eventos obrigatorios | Redis final | Artefato |
| --- | --- | --- | --- | --- |
| VPS | passou | todos presentes | `completed`, `in_holding`, `finalFare=27.5`, `driverNetAmount=25.51` | `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/runtime-full-ride-flow-smoke-1779665836495.json` |
| Modular | passou | todos presentes | `completed`, `in_holding`, `finalFare=27.5`, `driverNetAmount=25.51` | `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/runtime-full-ride-flow-smoke-1779665836495.json` |

Com isso, a pendencia local de smoke funcional de corrida completa foi fechada. Em seguida, o canary remoto modular de health/readiness/socket tambem passou na Contabo em porta paralela, sem trocar producao.

O canary remoto funcional com corrida completa tambem foi executado e passou contra `modular-contabo-canary`:

- Booking: `booking_1779669131793_runtime-full-passenger-modular-contabo-canary`
- Eventos obrigatorios: todos presentes.
- Redis final: `completed`, `in_holding`, `finalFare=27.5`, `driverNetAmount=25.51`, `activeBookingCleared=true`, `activeDriverTripCleared=true`.
- Evidencia JSON: `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/contabo-modular-full-flow-canary-2026-05-25T00-32-16-480Z.json`

## Cutover de producao executado

O cutover do gateway para o runtime modular foi executado na Contabo apos canary e backup.

Backups remotos antes da troca:

- `/opt/leaf-backups/leaf-app-pre-modular-cutover-20260525024431.tar.gz`
- `/opt/leaf-backups/env-pre-modular-cutover-20260525024431.env`
- `/opt/leaf-backups/docker-compose-pre-modular-cutover-20260525024431.yml`
- `/opt/leaf-backups/leaf-websocket-inspect-pre-modular-cutover-20260525024431.json`

Sequencia:

- Backend atualizado na Contabo com o gateway ainda em `LEAF_SERVER_RUNTIME=vps`.
- Imagem `websocket` rebuildada e validada ainda no runtime VPS.
- Somente o servico `websocket` foi alterado para `LEAF_SERVER_RUNTIME=modular`.
- `sideeffects-worker` permaneceu em `LEAF_SERVER_RUNTIME=vps`.
- `leaf-websocket` foi recriado isoladamente com `docker compose up -d --no-deps websocket`.

Validacao pos-cutover:

- `/health/quick`: `healthy`.
- `socketRedisAdapter.state = ready`.
- `socketRedisAdapter.enabled = true`.
- `socketRedisAdapter.required = true`.
- `socketRedisAdapter.runtimeRole = gateway`.
- Handshake Engine.IO + Socket.IO bruto passou.
- `validate-runtime-config.js`: `ok=true`, sem blockers.
- Health publico `api` e `socket`: liveness e quick healthy.
- Logs recentes sem erro na janela observada.

Smoke funcional de producao:

- Autenticacao com tokens reais Firebase para passageiro e motorista.
- Pagamento prevalidado via cache interno `payment_status_cache`, sem chamada externa Woovi.
- Booking criado, motorista notificado, aceite, chegada ao embarque, inicio, localizacao, conclusao e `paymentDistributed`.
- Redis final: `status=completed`, `paymentStatus=in_holding`, `finalFare=27.5`, `driverNetAmount=25.51`, `tollFee=0`, viagem ativa limpa.
- Evidencia: `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/production-modular-cutover-full-flow-1779671491090.json`.

Rollback operacional imediato:

- Alterar o `websocket` em `/opt/leaf-app/docker-compose.yml` de `LEAF_SERVER_RUNTIME=modular` para `LEAF_SERVER_RUNTIME=vps`.
- Rodar `cd /opt/leaf-app && docker compose up -d --no-deps websocket`.

## Fechamento do worker lateral

O `sideeffects-worker` tambem foi migrado para semantica modular/dedicada.

Estado final na Contabo:

- `websocket`: `LEAF_SERVER_RUNTIME=modular`, `RUNTIME_ROLE=gateway`, `ENABLE_EMBEDDED_LISTENER_WORKERS=false`.
- `sideeffects-worker`: `LEAF_SERVER_RUNTIME=modular`, `RUNTIME_ROLE=sideeffects`.
- Entry do worker: `bash scripts/runtime/start-sideeffects-worker.sh`.
- Redis Stream `ride_events` / group `listener-workers`: apenas `listener-worker-1`, `pending=0`.

O gateway modular deixou de iniciar `WorkerManager` embutido quando `ENABLE_EMBEDDED_LISTENER_WORKERS=false`. Isso remove o consumo nao deterministico entre `server-worker-*` e `listener-worker-*`.

Evidencia funcional:

- `/Users/izaakdias/Documents/Leaf-new/test-results/runtime-full-ride-flow/production-modular-sideeffects-full-flow-1779674642560.json`

Guardrail novo:

- `npm run check:no-active-vps-runtime` falha se algum compose ativo voltar a declarar `LEAF_SERVER_RUNTIME=vps`.

Status do `server.vps.js`:

- Legado preservado para rollback temporario.
- Nao deve receber feature nova.
- O uso via `LEAF_SERVER_RUNTIME=vps` em `start-server.sh` emite aviso de deprecated.
