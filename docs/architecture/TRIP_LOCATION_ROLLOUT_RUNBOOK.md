# Runbook de Rollout - Tracking 2s com Navegacao Externa

Data: 2026-03-16

## Feature flags

- `ENABLE_ACTIVE_TRIP_INDEX` (default `true`)
- `ENABLE_TRIP_LOCATION_STREAM` (default `true`)
- `ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER` (default `true` no worker dedicado)
- `ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE` (default `true`)

## Parametros operacionais

- `TRIP_LOCATION_CHUNK_SIZE` (default `30`)
- `TRIP_LOCATION_PERIODIC_FLUSH_MS` (default `15000`)
- `TRIP_LOCATION_WORKER_BATCH_SIZE` (default `40`)
- `TRIP_LOCATION_WORKER_MAX_RETRIES` (default `4`)
- `TRIP_LOCATION_OUT_OF_ORDER_WINDOW` (default `15`)
- `TRIP_LOCATION_DEDUP_TTL_SECONDS` (default `21600`)
- `TRIP_LOCATION_CHUNK_RETENTION_DAYS` (default `30`)
- `EXPO_PUBLIC_BACKGROUND_LOCATION_INTERVAL_MS` (default `2000`)
- `EXPO_PUBLIC_BACKGROUND_LOCATION_DISTANCE_M` (default `0`)

## Passo a passo de rollout

1. Deploy backend com flags ligadas e worker desativado:
- `ENABLE_TRIP_LOCATION_STREAM=true`
- `ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER=false`

2. Validar ingestao:
- stream `trip_location_events` recebendo eventos
- `locationUpdated` sem erro de dedupe indevido
- taxa de `orderStatus=stale_ignored` abaixo do limite acordado

3. Ativar worker:
- `ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER=true`

4. Validar persistencia:
- colecao `trip_location_chunks` crescendo por corrida
- colecao `trip_location_summaries` com finalizacao de corridas

5. Validar corrida longa:
- sem gap relevante em trilha
- latencia de update de mapa sem regressao perceptivel

## Sinais de alerta

- crescimento continuo de `trip_loc_buffer:*` sem flush
- aumento de eventos em DLQ do `trip_location_events`
- queda de updates renderizados no app do passageiro
- erros recorrentes de Firestore no worker
- aumento de eventos com `orderStatus=stale_ignored` ou `duplicate_dedupe`

## Rollback rapido

1. Desligar stream:
- `ENABLE_TRIP_LOCATION_STREAM=false`

2. Desligar worker:
- `ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER=false`

3. Manter tracking tempo real basico (Redis GEO + websocket) ativo.
