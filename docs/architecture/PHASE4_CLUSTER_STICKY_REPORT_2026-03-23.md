# Fase 4 - Node Cluster + Sticky Sessions (2026-03-23)

## Contexto e objetivo
Executar Fase 4 no backend websocket da VPS para melhor uso de 2 vCPU com Node cluster + sticky sessions, sem quebrar protocolo/API e com rollback simples.

## Topologia final implementada
- `Nginx` (sticky por `ip_hash`) -> `websocket backend` em cluster (`2 workers`) -> Redis único (estado/presença/pubsub).
- Processo líder do cluster sem tráfego de app; workers executam runtime.
- Jobs periódicos com liderança única (`LEAF_CLUSTER_SCHEDULER_LEADER_ID=1`) para evitar execução duplicada.
- Política de sessão do usuário com lock Redis curto para evitar corrida entre workers.

Arquivos alterados nesta fase:
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/server.vps.js`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/docker-compose.production.yml`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/nginx.conf`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/tests/e2e/backend/__helpers__/websocket-test-client.js`
- `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/scripts/stress-test/sustained-active-rides-capacity.cjs`
- `/Users/izaakdias/Documents/Leaf-new/docs/TODO_PENDENTES_RESUMO.md`

## Mudanças (formato obrigatório)

### Mudança 1 - Cluster 2 workers com liderança de scheduler
1. Hipótese
- Dividir execução do websocket em 2 workers reduz contenção de event loop e melhora uso de 2 vCPU.
2. Evidência encontrada
- Backend operava com gargalo em fluxo E2E completo e apenas 1 processo principal para caminho crítico.
3. Mudança proposta
- Ativar cluster configurável por env e isolar jobs periódicos em worker líder.
4. Diff resumido
- `server.vps.js`: flags `LEAF_CLUSTER_ENABLED`, `LEAF_CLUSTER_WORKERS`, `LEAF_CLUSTER_SCHEDULER_LEADER_ID`; split `cluster primary/worker`; guarda de jobs periódicos.
- `docker-compose.production.yml`: envs de cluster adicionadas.
5. Risco
- Duplicação de side effects se liderança falhar; mitigado por guard explícito de worker líder.
6. Benchmark antes/depois
- Antes (pre-cluster 300): p95 createBooking `770ms`, p95 confirmPayment `540ms`.
- Depois (cluster 300): p95 createBooking `611ms`, p95 confirmPayment `424ms`.
7. Rollback
- `LEAF_CLUSTER_ENABLED=false` + restart do serviço websocket.
8. Decisão
- **Manter**.

### Mudança 2 - Sticky sessions no Nginx
1. Hipótese
- Afinidade de sessão melhora estabilidade de handshake/reconexão em socket.
2. Evidência encontrada
- Com cluster, sem sticky aumenta chance de churn de sessão entre workers em reconexões curtas.
3. Mudança proposta
- Sticky via `ip_hash` + headers corretos de upgrade.
4. Diff resumido
- `nginx.conf`: `map $http_upgrade $connection_upgrade`, `upstream ... ip_hash`, `Connection $connection_upgrade`.
5. Risco
- `ip_hash` pode distribuir pior sob poucos IPs NAT; aceitável para fase atual.
6. Benchmark antes/depois
- Smoke cluster 100% funcional (`8/8` rides, target hit `96.63%`, p95 fullFlow `990ms`).
7. Rollback
- Remover `ip_hash` e recarregar Nginx.
8. Decisão
- **Manter**.

### Mudança 3 - Lock de sessão por usuário (cross-worker)
1. Hipótese
- Corridas de login/socket entre workers podem manter sessões simultâneas indevidas.
2. Evidência encontrada
- Fluxos de autenticação concorrente exigem arbitragem para política de sessão única.
3. Mudança proposta
- Lock Redis curto (`SESSION_LOCK_TTL_MS`) com aquisição/liberação em autenticação.
4. Diff resumido
- `server.vps.js`: `acquireUserSessionLock`, `releaseUserSessionLock`, uso no handshake auth.
5. Risco
- Lock curto mal calibrado pode aumentar rejeição em picos; mitigado por TTL baixo + fallback.
6. Benchmark antes/depois
- Sem regressão funcional observada em smoke/E2E (100% completion nos cenários executados).
7. Rollback
- Desativar caminho de lock (feature/env) e reiniciar worker.
8. Decisão
- **Manter**.

### Mudança 4 - Determinismo do harness de benchmark
1. Hipótese
- Runner de stress podia ficar preso em promises inflight/token/connect sem timeout e contaminar leitura de capacidade.
2. Evidência encontrada
- Execuções longas sem output final; risco de bloqueio em `allSettled`/auth.
3. Mudança proposta
- Timeouts explícitos para `token generation`, `connect/auth`, `provision` e `allSettled` de inflight.
4. Diff resumido
- `sustained-active-rides-capacity.cjs`: `withTimeout`, `waitAllSettledWithTimeout`, guards em token/provision/connect.
5. Risco
- Timeout agressivo pode reduzir pool efetivo em cenários de latência alta.
6. Benchmark antes/depois
- Sanity pós-fix concluiu determinístico: `15/15` rides, `100%` sucesso.
7. Rollback
- Reverter arquivo `sustained-active-rides-capacity.cjs` para versão anterior.
8. Decisão
- **Manter**.

## Benchmarks executados (cluster)

### Baseline e escada principal
Fonte consolidada: `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/phase4-rollup.json`

- Pre-cluster 300 (`phase4-precluster-300`)
  - success `100%`, avgActive `246.37`, p95 flow `4692ms`, p99 flow `5585ms`.
- Cluster 300 (`phase4-cluster-level-300`)
  - success `100%`, avgActive `216.33`, p95 flow `6564ms`, p99 flow `9806ms`.
- Cluster 350 (`phase4-cluster-level-350`)
  - success `100%`, avgActive `205.45`, p95 flow `7186ms`, p99 flow `9672ms`.
- Cluster 400 (`phase4-cluster-level-400`)
  - success `100%`, avgActive `199.51`, p95 flow `4276ms`, p99 flow `4677ms`.

### Escada 450/500/550/600
Fonte: `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/phase4-cluster-ladder-450-600-short.json`

- Pool solicitado `620/620`, conectado `drivers=619`, `passengers=141`.
- Gargalo real durante a escada: conexão/auth de passageiro (erro dominante `passenger_connect_or_auth_failed`).
- Alvo efetivo limitado por pool: `141` ativos.
- Níveis (alvo solicitado -> alvo efetivo 141):
  - 450: avgActive `114.99`, hit `81.55%`, p95 flow `5239ms`.
  - 500: avgActive `135.13`, hit `95.84%`, p95 flow `2110ms`.
  - 550: avgActive `137.13`, hit `97.26%`, p95 flow `1502ms`.
  - 600: avgActive `135.26`, hit `95.93%`, p95 flow `2237ms`.

### Soak test no maior nível estável considerado
Fonte: `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/phase4-cluster-soak-141.json`

- Cenário soak `target=141` por `240s`.
- Pool conectado `drivers=220`, `passengers=219`, readyDrivers `220`.
- Resultado: success `100%`, avgActive `133.32`, hit `94.55%`, p95 flow `4951ms`, p99 flow `7746ms`.

## Métricas operacionais coletadas
Fonte: `/Users/izaakdias/Documents/Leaf-new/leaf-websocket-backend/reports/phase4-cluster-after-soak.metrics.prom`

- Event loop lag:
  - mean `20.31ms`
  - p95 `20.71ms`
  - max `25.94ms`
- Realtime volume:
  - `updatelocation processed = 114790`
  - `updatelocation coalesced = 72`
- Redis hotpath ops:
  - `save_driver_location_online pipeline_ops = 583665`

Health snapshot pós-teste:
- `/health`: status `healthy`, CPU `36%` (2 cores), memória `33.1%` usada.

## Envelope operacional final (Fase 4)

- **VERDE**
  - Até `~130` corridas ativas sustentadas (targetHit >= 94%, success 100% no soak).
- **AMARELO**
  - `131–141` ativas: funciona, mas p95/p99 sobem e jitter aumenta.
- **VERMELHO**
  - Acima de `141` ativas efetivas no setup atual de auth/conexão em massa.
- **LIMITE FUNCIONAL (não recomendado)**
  - Escada solicitada 450–600 só foi executada com alvo efetivo `141` por limitação de pool conectado de passageiros.

## Comparação antes/depois da VPS (resumo objetivo)
- Melhoras claras no caminho curto:
  - p95 `createBooking`: `770ms` -> `611ms` (300).
  - p95 `confirmPayment`: `540ms` -> `424ms` (300).
- Latência E2E final (booking->dispatch/fullFlow) variou por rodada e não mostrou ganho linear em todos os níveis.
- Cluster trouxe melhor aproveitamento arquitetural e separação operacional para próxima etapa, mas o teto atual passou a ser dominado por auth/conexão em massa de passageiros no benchmark alto.

## Riscos remanescentes
- Gargalo de conexão/auth para passageiros em pools altos (`passenger_connect_or_auth_failed`).
- Falta de série contínua de CPU por worker acoplada ao benchmark final.
- Runner ainda gera ruído de Redis local (não bloqueante, mas polui telemetria de execução).

## Prontidão para escalar horizontalmente
Pronto para próxima fase de escala horizontal com baixo risco:
- Adicionar segundo nó websocket atrás de Nginx (sticky + Redis adapter já em uso).
- Externalizar afinidade para load balancer com política consistente por usuário/sessão.
- Warm pool de autenticação/token para reduzir custo de onboarding de conexão em massa.

## Pendências enviadas para backlog
Incluídas em:
- `/Users/izaakdias/Documents/Leaf-new/docs/TODO_PENDENTES_RESUMO.md`

Itens adicionados:
- `phase4-auth-connect-bottleneck-high-pool`
- `phase4-benchmark-runner-redis-noise-cleanup`
- `phase4-per-worker-cpu-evidence-gap`

