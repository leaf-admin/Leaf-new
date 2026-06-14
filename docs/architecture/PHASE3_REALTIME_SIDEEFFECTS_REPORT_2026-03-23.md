# Fase 3 - Split Gateway/Worker (2026-03-23)

## Escopo desta fase
Separar caminho crítico realtime/E2E de side effects na mesma VPS, sem alterar regras de negócio e mantendo compatibilidade de API/protocolo.

## Topologia textual (novo desenho)
- Processo 1 (`leaf-websocket`): gateway crítico
- Processo 2 (`leaf-sideeffects-worker`): worker de side effects
- Redis único (`leaf-redis`) como stream bus + hot state
- Nginx reverse proxy na mesma VPS

Fluxo alvo:
1. Cliente envia `createBooking` ao gateway
2. Gateway valida e persiste estado essencial
3. Gateway responde e faz dispatch crítico de `ride.requested` inline
4. Eventos de pós-ação seguem para stream Redis
5. Worker consome e executa side effects (`ride.accepted`, `ride.started`, etc.)

## Mapa do que saiu do caminho crítico
- Saiu para worker:
  - notificações/push derivadas de `ride.accepted`
  - ações de `ride.started`
  - side effects de cancelamento
- Permaneceu no gateway:
  - websocket, presença, dispatch crítico
  - `auth`, `createBooking`, `confirmPayment`
  - estado quente da corrida

## Mudanças implementadas (formato obrigatório)

### Mudança 1 - Split de papéis runtime + worker dedicado
1. Hipótese: separar execução reduz contenção no gateway e melhora previsibilidade do caminho crítico.
2. Evidência: antes havia acoplamento de listeners no mesmo runtime e consumo misto de stream.
3. Mudança proposta: `RUNTIME_ROLE=gateway` no websocket e serviço `sideeffects-worker` dedicado.
4. Diff resumido: `docker-compose.production.yml` com novo serviço `sideeffects-worker`, healthcheck próprio, limits e restart policy.
5. Risco: drift de configuração entre gateway/worker.
6. Benchmark antes/depois: funcionalidade manteve 100% de conclusão em todos os cenários da fase.
7. Rollback: remover `sideeffects-worker`, reativar embedded workers no gateway.
8. Decisão: manter.

### Mudança 2 - Redis adapter no gateway para eventos cross-process
1. Hipótese: worker separado precisa do adapter para emitir eventos Socket.IO em salas corretas.
2. Evidência: sem adapter no gateway, houve falha de dispatch no pós-split inicial.
3. Mudança proposta: inicialização do `@socket.io/redis-adapter` no gateway com cleanup no shutdown.
4. Diff resumido: `server.vps.js` com `createAdapter(...)`, `socketIoAdapterPubClient`/`SubClient` e graceful shutdown.
5. Risco: dependência de saúde do Redis para fan-out.
6. Benchmark antes/depois: pós-fix eliminou falha funcional (0 falhas E2E, 100% sucesso funcional).
7. Rollback: desativar adapter via flag e voltar para single-process sem worker externo.
8. Decisão: manter.

### Mudança 3 - `ride.requested` volta ao caminho crítico do gateway
1. Hipótese: dispatch crítico via worker adiciona jitter de stream/consumer e piora `bookingToDispatch`.
2. Evidência: após split inicial, `bookingToDispatch` p95 subiu fortemente.
3. Mudança proposta: dispatch inline no gateway para `ride.requested` mantendo side effects no worker.
4. Diff resumido: `server.vps.js` com `ENABLE_DIRECT_RIDE_REQUESTED_DISPATCH` + `notifyDriversInline(...)`; `listener-worker.js` sem handler de `RIDE_REQUESTED`.
5. Risco: maior carga instantânea no gateway em picos curtos.
6. Benchmark antes/depois:
   - Baseline (antes do split): `bookingToDispatch` p95 = 55ms
   - Pós-split final (run5): `bookingToDispatch` p95 = 64ms
   - Resultado: regressão residual pequena (+9ms), com estabilidade funcional preservada.
7. Rollback: desativar `ENABLE_DIRECT_RIDE_REQUESTED_DISPATCH` e recolocar handler no worker.
8. Decisão: manter.

### Mudança 4 - Worker com parâmetros explícitos e menor bloco de leitura
1. Hipótese: reduzir `blockTime` e tornar params declarativos melhora responsividade operacional.
2. Evidência: defaults implícitos dificultavam ajuste fino sob carga.
3. Mudança proposta: variáveis `WORKER_*` (stream/group/batch/block/retries) no worker.
4. Diff resumido: `listener-worker.js` passa a ler env; compose configura `WORKER_BATCH_SIZE=16`, `WORKER_BLOCK_TIME=150`.
5. Risco: ajuste agressivo pode elevar CPU em cenários vazios.
6. Benchmark antes/depois: sem regressão funcional; consumo do worker ficou estável sob carga.
7. Rollback: voltar defaults anteriores no worker e remover envs.
8. Decisão: manter.

### Mudança 5 - Silenciamento seguro de eventos sem handler no worker
1. Hipótese: warnings de eventos não tratados geravam ruído/log overhead no worker.
2. Evidência: logs mostravam frequência alta de `Nenhum handler registrado` para tipos conhecidos não críticos.
3. Mudança proposta: `WORKER_UNHANDLED_QUIET_EVENTS` + skip silencioso no `WorkerManager`.
4. Diff resumido: `workers/WorkerManager.js` e env no `docker-compose.production.yml`.
5. Risco: ocultar evento relevante por configuração incorreta da lista.
6. Benchmark antes/depois:
   - run3 (pré-quiet): worker CPU p95 = 27.46%
   - run5 (pós-quiet): worker CPU p95 = 4.43%
   - logs: warnings de unhandled em 5 min = 0
7. Rollback: remover `WORKER_UNHANDLED_QUIET_EVENTS` e voltar ao warn padrão.
8. Decisão: manter.

## Benchmarks e métricas

### Baseline de referência
- Arquivo: `leaf-websocket-backend/reports/phase3-baseline-before.json`
- Resultado:
  - sucesso funcional: 100%
  - `createBooking` p95: 225ms
  - `confirmPayment` p95: 206ms
  - `bookingToDispatch` p95: 55ms
  - `fullFlowToStart` p95: 830ms

### Pós-split final validado
- Arquivo principal: `leaf-websocket-backend/reports/phase3-final-after-run5-quiet.json`
- Resultado:
  - sucesso funcional: 100% (19/19)
  - `createBooking` p95: 245ms
  - `confirmPayment` p95: 211ms
  - `bookingToDispatch` p95: 64ms
  - `fullFlowToStart` p95: 884ms

### CPU sob carga (run5, pós-quiet)
- Arquivo: `leaf-websocket-backend/reports/phase3-final-after-run5-quiet-cpu.csv`
- Estatísticas:
  - gateway `leaf-websocket`: avg 18.97%, p95 38.70%
  - worker `leaf-sideeffects-worker`: avg 2.37%, p95 4.43%
  - redis `leaf-redis`: avg 8.63%, p95 16.58%

### Event loop lag
- Arquivo: `leaf-websocket-backend/reports/phase3-final-metrics-after-run5.prom`
- Valores:
  - `leaf_event_loop_lag_mean_ms`: 20.23
  - `leaf_event_loop_lag_p95_ms`: 20.79
  - `leaf_event_loop_lag_max_ms`: 21.54

## Consistência de estado e side effects
- E2E: 100% conclusão nas rodadas finais.
- Side effects ativos: logs do worker mostram processamento contínuo de `ride.accepted` e `ride.started`.
- Dispatch crítico preservado no gateway com latência próxima do baseline.

## Riscos remanescentes
- Consumer órfão em Redis stream ainda aparece (`server-worker-1`) com pendências antigas.
- Observação operacional: credenciais FCM ausentes no worker geram warning em `sendPush` (não quebra o fluxo principal de corrida).

## Rollback operacional simplificado
1. Parar worker dedicado.
2. Reativar embedded workers no gateway.
3. Desativar dispatch inline direto (`ENABLE_DIRECT_RIDE_REQUESTED_DISPATCH=false`) se necessário.
4. Rebuild/recreate `websocket`.

## Prontidão para fase de cluster
- Pronto para fase seguinte com sticky sessions + múltiplos gateways.
- Pré-requisito recomendado antes de cluster:
  - limpar pendências do consumer órfão no Redis stream
  - consolidar estratégia de consumo por tipo/evento para reduzir tráfego inútil em stream
