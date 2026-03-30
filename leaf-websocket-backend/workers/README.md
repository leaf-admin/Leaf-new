# 🔧 WORKERS - LEAF

## 🎯 Objetivo

Workers dedicados para processar listeners pesados, desacoplando do processo principal do servidor.

## 📁 Estrutura

```
workers/
├── WorkerManager.js        # Gerenciador de workers com Consumer Groups
├── listener-worker.js      # Worker para processar listeners pesados
├── worker-trip-location.js # Worker para consolidar trilha de localização
├── pricing-baseline-worker.js # Worker de baseline operacional de pricing por H3
├── ride-health-monitor-worker.js # Worker de monitoramento operacional de rides
└── README.md              # Esta documentação
```

## 🏗️ Arquitetura

### Listeners Rápidos (Inline no server.js)
- `notifyPassenger` - Notificação WebSocket rápida
- `notifyDriver` - Notificação WebSocket rápida  
- `startTripTimer` - Operação Redis simples

### Listeners Pesados (Workers)
- `notifyDrivers` - Busca motoristas próximos, cálculos de score
- `sendPush` - Chamadas externas FCM, busca de tokens
- `trip.location.v1` - Persistência de rota da corrida em chunks
- `pricing-baseline-worker` - Materialização de baseline e histórico curto de pricing por célula H3
- `ride-health-monitor-worker` - Monitor de `REASSIGNMENT_PENDING` preso e volume de `EARLY_ENDED_REVIEW`

## 🚀 Como Usar

### 1. Executar Worker Manualmente

```bash
node workers/listener-worker.js
```

### 2. Executar com PM2

```bash
# Iniciar
pm2 start workers/listener-worker.js --name listener-worker

# Ver logs
pm2 logs listener-worker

# Parar
pm2 stop listener-worker

# Reiniciar
pm2 restart listener-worker
```

### 2.1 Worker de Localização da Corrida

```bash
# Iniciar worker dedicado de localização
pm2 start workers/worker-trip-location.js --name trip-location-worker

# Logs
pm2 logs trip-location-worker
```

### 2.2 Worker de Baseline de Pricing

```bash
# Execução única manual
ENABLE_PRICING_BASELINE_WORKER=true node workers/pricing-baseline-worker.js --once

# Execução contínua com PM2
pm2 start workers/pm2.pricing-baseline.config.js

# Logs
pm2 logs pricing-baseline-worker
```

### 2.3 Worker de Ride Health

```bash
# Execução única manual
ENABLE_RIDE_HEALTH_MONITOR_WORKER=true node workers/ride-health-monitor-worker.js --once

# Execução contínua com PM2
pm2 start workers/pm2.ride-health-monitor.config.js

# Logs
pm2 logs ride-health-monitor-worker
```

### 3. Executar Múltiplos Workers

```bash
# Worker 1
pm2 start workers/listener-worker.js --name listener-worker-1

# Worker 2
pm2 start workers/listener-worker.js --name listener-worker-2

# Worker 3
pm2 start workers/listener-worker.js --name listener-worker-3
```

## ⚙️ Configuração

### Variáveis de Ambiente

```env
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Worker
WORKER_STREAM_NAME=ride_events
WORKER_GROUP_NAME=listener-workers
WORKER_BATCH_SIZE=10
WORKER_BLOCK_TIME=1000
WORKER_MAX_RETRIES=3

# Trip Location Worker
ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER=true
ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE=true
TRIP_LOCATION_WORKER_GROUP=trip-location-workers
TRIP_LOCATION_WORKER_BATCH_SIZE=40
TRIP_LOCATION_WORKER_BLOCK_TIME=1000
TRIP_LOCATION_WORKER_MAX_RETRIES=4
TRIP_LOCATION_CHUNK_SIZE=30
TRIP_LOCATION_PERIODIC_FLUSH_MS=15000
TRIP_LOCATION_CHUNK_RETENTION_DAYS=30
TRIP_LOCATION_OUT_OF_ORDER_WINDOW=15
TRIP_LOCATION_DEDUP_TTL_SECONDS=21600

# Pricing Baseline Worker
ENABLE_PRICING_BASELINE_WORKER=true
PRICING_BASELINE_WORKER_INTERVAL_MS=300000
PRICING_BASELINE_WORKER_RUN_ON_BOOT=true
PRICING_BASELINE_MAX_CELLS=250

# Ride Health Monitor Worker
ENABLE_RIDE_HEALTH_MONITOR_WORKER=true
RIDE_HEALTH_MONITOR_INTERVAL_MS=60000
RIDE_HEALTH_MONITOR_RUN_ON_BOOT=true
RIDE_HEALTH_REASSIGNMENT_STUCK_THRESHOLD_MS=300000
RIDE_HEALTH_EARLY_REVIEW_WARNING_COUNT=3
RIDE_HEALTH_EARLY_REVIEW_CRITICAL_COUNT=6
```

### Consumer Groups

O WorkerManager usa **Redis Consumer Groups** para distribuir eventos entre múltiplos workers:

- **Stream**: `ride_events`
- **Group**: `listener-workers`
- **Consumer**: `listener-worker-{pid}`

Cada worker consome eventos do mesmo stream, mas cada evento é processado por apenas um worker.

## 🔄 Retry Automático

Workers implementam retry automático com backoff exponencial:

- **Tentativa 1**: Imediata
- **Tentativa 2**: Após 1 segundo
- **Tentativa 3**: Após 2 segundos
- **Tentativa 4**: Após 5 segundos

Após 3 falhas, o evento é movido para **Dead Letter Queue (DLQ)**.

## 💀 Dead Letter Queue (DLQ)

Eventos que falham após todas as tentativas são movidos para:

- **Stream**: `ride_events_dlq`
- **Campos**: 
  - `originalEventId`: ID original do evento
  - `originalStream`: Stream original
  - `eventType`: Tipo do evento
  - `eventData`: Dados do evento
  - `failedAt`: Timestamp da falha
  - `error`: Mensagem de erro
  - `retries`: Número de tentativas

### Monitorar DLQ

```bash
# Ver tamanho da DLQ
redis-cli XLEN ride_events_dlq

# Ver eventos na DLQ
redis-cli XRANGE ride_events_dlq - + COUNT 10
```

### Reprocessar DLQ

```javascript
// Script para reprocessar eventos da DLQ
const redis = require('ioredis');
const workerManager = require('./workers/WorkerManager');

// Ler eventos da DLQ e reprocessar
const events = await redis.xrange('ride_events_dlq', '-', '+');
for (const [id, fields] of events) {
    // Reprocessar...
}
```

## 📊 Monitoramento

### Métricas Prometheus

- `leaf_workers_active{worker_type="listener"}` - Número de workers ativos
- `leaf_listener_total{listener_name, status}` - Total de listeners processados
- `leaf_listener_duration_seconds{listener_name, status}` - Latência dos listeners
- `leaf_event_backlog{event_type="dlq"}` - Tamanho da DLQ
- `leaf_ride_health_state_total{state}` - Corridas monitoradas por estado operacional
- `leaf_ride_health_stuck_total{state}` - Corridas presas em estados operacionais
- `leaf_ride_health_recent_total{state}` - Volume recente de estados operacionais sensíveis

### Estatísticas do Worker

O WorkerManager expõe estatísticas:

```javascript
const stats = workerManager.getStats();
// {
//   processed: 1234,
//   failed: 5,
//   retried: 12,
//   dlq: 2,
//   uptime: 3600,
//   isRunning: true,
//   consumerName: 'listener-worker-12345'
// }
```

## 🔍 Troubleshooting

### Worker não está processando eventos

1. Verificar se Consumer Group foi criado:
   ```bash
   redis-cli XINFO GROUPS ride_events
   ```

2. Verificar se há eventos no stream:
   ```bash
   redis-cli XLEN ride_events
   ```

3. Verificar logs do worker:
   ```bash
   pm2 logs listener-worker
   ```

### Eventos ficando presos (não sendo ACK)

1. Verificar pending events:
   ```bash
   redis-cli XPENDING ride_events listener-workers
   ```

2. Ver detalhes de eventos pendentes:
   ```bash
   redis-cli XPENDING ride_events listener-workers - + 10
   ```

3. Reclamar eventos órfãos:
   ```bash
   redis-cli XCLAIM ride_events listener-workers listener-worker-NEW - 0 <event-id>
   ```

## 🚀 Próximos Passos

- [ ] Adicionar health check endpoint
- [ ] Implementar auto-scaling baseado em lag
- [ ] Adicionar dashboard para monitorar workers
- [ ] Implementar reprocessamento automático de DLQ
