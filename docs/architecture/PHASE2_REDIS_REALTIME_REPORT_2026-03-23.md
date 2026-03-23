# Fase 2 - Redis/Realtime Optimization Report

Date: 2026-03-23  
Scope: websocket backend hot path (Redis coordination, state, location/presence updates, event-loop visibility)

## Objetivo da fase
- Reduzir custo de coordenação no caminho quente.
- Diminuir ruído de updates realtime.
- Melhorar observabilidade de saturação.

## Mudanças implementadas

1) **Métricas novas no Prometheus (hot path/realtime/event-loop)**
- File: `utils/prometheus-metrics.js`
- Added:
  - `leaf_event_loop_lag_mean_ms`
  - `leaf_event_loop_lag_p95_ms`
  - `leaf_event_loop_lag_max_ms`
  - `leaf_realtime_updates_total{channel,result}`
  - `leaf_hotpath_duration_seconds{path,status}`
  - `leaf_redis_hotpath_ops_total{path,operation}`
- Added helpers:
  - `setEventLoopLag`
  - `recordRealtimeUpdate`
  - `recordHotpathLatency`
  - `recordRedisHotpathOp`

2) **Monitor de event loop lag no runtime**
- File: `server.vps.js`
- Added `monitorEventLoopDelay` sampling and periodic publish to Prometheus.

3) **Hot cache de estado do motorista (`driver:<id>`)**
- File: `server.vps.js`
- Added:
  - `driverStateHotCache` (TTL curto)
  - `getDriverStateHot(redis, driverId, fallbackState)`
  - cache helpers (`getCachedDriverState`, `setCachedDriverState`, trim)
- Goal: evitar `hgetall` redundante em `saveDriverLocation`, `driverHeartbeat`, `updateLocation`.

4) **Coalescing/debounce de `updateLocation`**
- File: `server.vps.js`
- Added:
  - `shouldSkipRealtimeUpdate`
  - `markRealtimeUpdateProcessed`
  - threshold por estado (em corrida vs fora de corrida)
- Goal: reduzir updates irrelevantes.

5) **Cache local curto para rate limit de `updateLocation`**
- File: `server.vps.js`
- Added `updateLocationRateLimitCache` and `shouldRunUpdateLocationRateLimit`.
- Goal: reduzir round trips Redis para checks repetidos em janela curta.

6) **Pipeline no `driverHeartbeat` e instrumentação no hot path**
- File: `server.vps.js`
- Consolidado em pipeline (`expire`, `hset`, `geoadd`/`zrem`) + métricas de hot path.

7) **Script isolado de benchmark de localização/presença**
- File: `scripts/stress-test/location-presence-isolation.cjs`
- Cenários:
  - `update_location`
  - `heartbeat`
  - `mixed`

## Benchmark suite (before/after)

Suite:
- `auth_socket_400`
- `e2e_300`
- `location_update_120x30`
- `heartbeat_200x40`
- `e2e_400`

Artifacts:
- Before raw: `/opt/leaf-app/logs/phase2-opt-20260322_232306/before/raw`
- After raw (valid final): `/opt/leaf-app/logs/phase2-opt-20260322_232306/after/raw`
- Summary JSON: `/opt/leaf-app/logs/phase2-opt-20260322_232306/after/parsed/phase2-before-after-summary.json`

## Resultado medido (resumo)

### `location_update_120x30`
- Throughput: `309.28 -> 314.41` updates/s (`+1.66%`)
- Latência p50: `7ms -> 3ms` (`-57.14%`)
- Latência p95: `17ms -> 20ms` (`+17.65%`)
- Latência p99: `31ms -> 58ms` (`+87.10%`)
- Redis ops relevantes:
  - `hgetall`: `4194 -> 800`
  - `get`: `3600 -> 480`
  - `ttl`: `3480 -> 360`
  - `incr`: `3480 -> 360`
- Observação: ganho claro de redução de round trips no caminho quente, com piora de tail (p99).

### `heartbeat_200x40`
- Throughput: `413.44 -> 413.65` updates/s (estável)
- Redis ops relevantes:
  - `zscore`: `8000 -> 0`
  - `hgetall`: `25330 -> 9452`
- Observação: pipeline + redução de leituras redundantes manteve throughput e cortou operações custosas.

### `e2e_300`
- Throughput: `31.85 -> 17.79` rides/s
- Latência p95 total: `9123ms -> 16331ms`
- Stage p95:
  - `auth`: `1819ms -> 15075ms` (regressão forte)
  - `createBooking`: `3004ms -> 2406ms` (melhora)
  - `confirmPayment`: `972ms -> 1131ms` (piora leve)

### `e2e_400`
- Throughput: `32.52 -> 21.10` rides/s
- Latência p95 total: `12065ms -> 18292ms`
- Stage p95:
  - `auth`: `2082ms -> 16693ms` (regressão forte)
  - `createBooking`: `3206ms -> 1554ms` (melhora forte)
  - `confirmPayment`: `1307ms -> 787ms` (melhora)

### `auth_socket_400`
- Baseline before: `throughput 345.13/s`, p95 `995ms`
- After suite run: `throughput 56.44/s`, p95 `2002ms`
- Repeat validation run (isolado): `throughput 241.25/s`, p95 `1491ms`
- Observação: regressão consistente no bloco de auth, porém magnitude varia por rodada (componente externo + fila de autenticação).

## Métricas novas observadas em produção de teste
- Event loop lag (após carga): ~`20-21ms` (`attention`, abaixo de saturação >50ms)
- `leaf_realtime_updates_total` incrementando por canal:
  - `driverheartbeat=processed`
  - `updatelocation=processed/coalesced`
  - `updatelocation_rate_limit=cache_hit`
  - `driver_state_hot_cache=hit/miss/set`
- `leaf_redis_hotpath_ops_total` registrando volume por caminho:
  - `driver_heartbeat/pipeline_ops`
  - `save_driver_location_online/pipeline_ops`
  - `save_driver_location_offline/pipeline_ops`
  - `driver_state_hot_fetch/hgetall`
  - `updateLocation_rate_limit/checkRateLimit`

## Diagnóstico (evolução/regressão)

### Evolução confirmada
- Redução real de round trips no hot path de localização.
- Coalescing e cache local de rate-limit estão ativos e mensuráveis.
- Heartbeat com pipeline reduziu operações custosas sem perder throughput.
- Observabilidade de saturação/hot path foi estabelecida com métricas específicas.

### Regressão confirmada
- Etapa de autenticação (`auth`) piorou significativamente no E2E agregado.
- `createBooking` e `confirmPayment` melhoraram, mas não compensaram o gargalo de auth.

## Pendências para próxima fase
1. Tratar gargalo de auth (fila/admission + verify/token path) com benchmark dedicado.
2. Ajustar thresholds de coalescing para reduzir p99 sem perder ganho de p50.
3. Normalizar coleta de benchmark (janela de medição exatamente igual entre cenários).
4. Tornar benchmark reprodutível sem ajuste manual de ambiente:
   - `FIREBASE_API_KEY` canônica no runtime de teste.
   - dependências de benchmark previsíveis.

