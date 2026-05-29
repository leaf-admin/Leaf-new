# Diagnóstico Redis VPS (2026-03-18)

## Resumo executivo
- Redis na VPS **está saudável** (container `leaf-redis` ativo, baixo uso de CPU/memória, sem slowlog).
- O warning de latência no endpoint `/health` (**~420-580ms**) é **não compatível** com latência real Redis (**~0-20ms** em ping direto container->redis).
- Causa mais provável: medição do health check usando conexão Redis compartilhada do backend (fila/loop do Node), e não gargalo real do Redis.

## Evidências coletadas

### Infra/containers
- `leaf-websocket`: up (healthy), mem ~134 MiB, cpu ~3.18%
- `leaf-redis`: up (healthy), mem ~4.4 MiB, cpu ~0.65%

### Redis real (no container)
- `redis_version`: 7.4.8
- `used_memory_human`: 2.54M
- `used_memory_peak_human`: 2.69M
- `instantaneous_ops_per_sec`: 7
- `slowlog len`: 0
- `evicted_keys`: 0
- `rejected_connections`: 0
- `blocked_clients`: 1 (xreadgroup/subscribe, esperado para consumidores)

### Latência percebida pelo health endpoint
- Amostra `/health/quick` (12 chamadas):
  - média: **488.75ms**
  - min: 421ms
  - max: 578ms

### Latência real Redis (ping direto com ioredis no mesmo network namespace do backend)
- Amostra de 20 pings:
  - média: **1.85ms**
  - min: 0ms
  - max: 20ms

### Métricas de runtime relevantes
- `nodejs_eventloop_lag_max_seconds`: **0.650s**
- `nodejs_eventloop_lag_mean_seconds`: ~0.010s

## Conclusão técnica
1. O problema **não** está no Redis servidor.
2. O warning de Redis no health check está refletindo atraso de execução no processo Node (event loop/queue) e contenção da conexão compartilhada.
3. O status `warning` atual do `/health` é um falso-positivo de infraestrutura Redis.

## Recomendações
1. Ajustar health check para usar **cliente Redis dedicado** (isolado) apenas para medição.
2. Expor no health métricas de fila do cliente Redis (ex.: commandQueue/offlineQueue) para diagnóstico real.
3. Opcional imediato: elevar `HEALTH_REDIS_WARNING_MS` para reduzir alerta falso em produção, até aplicar correção estrutural.
4. Monitorar event-loop lag (já há picos de ~650ms).


## Hotfix aplicado (2026-03-18)
- Código atualizado em `services/health-check-service.js` para usar **cliente Redis dedicado** no health check, com fallback para pool compartilhado.
- Hotfix aplicado no container da VPS (`leaf-websocket`) e serviço reiniciado.

### Resultado pós-hotfix
- `/health/quick` redis latency (12 amostras):
  - média: **0.08ms**
  - min: 0ms
  - max: 1ms
- `/health` agora retorna:
  - `status: healthy`
  - `checks.redis.status: healthy`
  - `checks.redis.source: dedicated`

## Revalidação operacional (2026-03-18 20:23 UTC)
- VPS ativa confirmada: `147.182.204.181`
- Containers:
  - `leaf-websocket`: `Up (healthy)`
  - `leaf-redis`: `Up (healthy)`
- Amostra atual de `/health/quick` (12 chamadas):
  - média: **0.00ms**
  - min: 0ms
  - max: 0ms
  - source: `dedicated`
- Latência real Redis via `ioredis` dentro do container `leaf-websocket` (20 pings):
  - média: **0.29ms**
  - min: 0.17ms
  - max: 0.42ms
- Logs recentes (`leaf-websocket`, últimos 20 min): sem erros Redis/axios, inicialização Redis/Woovi normal.
