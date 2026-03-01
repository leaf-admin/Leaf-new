# 🔧 WORKERS - LEAF

## 🎯 Objetivo

Workers dedicados para processar listeners pesados, desacoplando do processo principal do servidor.

## 📁 Estrutura

```
workers/
├── WorkerManager.js        # Gerenciador de workers com Consumer Groups
├── listener-worker.js      # Worker para processar listeners pesados
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

