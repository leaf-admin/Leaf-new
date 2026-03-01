# 🚀 RESUMO: Implementação de Workers

## ✅ Status: CONCLUÍDO

Data: 2025-01-XX

---

## 📋 O que foi implementado

### 1. **WorkerManager** (`workers/WorkerManager.js`)
- ✅ Gerenciador central de workers
- ✅ Consumer Groups do Redis Streams
- ✅ Retry automático com backoff exponencial (1s, 2s, 5s)
- ✅ Dead Letter Queue (DLQ) para falhas persistentes
- ✅ Integração com métricas Prometheus
- ✅ Suporte a traceId para observabilidade

### 2. **Listener Worker** (`workers/listener-worker.js`)
- ✅ Worker dedicado para processar listeners pesados
- ✅ Processa `notifyDrivers` e `sendPush`
- ✅ Shutdown graceful (SIGTERM/SIGINT)
- ✅ Logs de estatísticas periódicas

### 3. **Health Monitor** (`workers/health-monitor.js`)
- ✅ Monitoramento de saúde dos workers
- ✅ Métricas de lag, consumers ativos, eventos pendentes
- ✅ Tamanho da DLQ
- ✅ Status de saúde (healthy/degraded/unhealthy)

### 4. **Rotas de Health** (`routes/worker-health.js`)
- ✅ `GET /api/workers/health` - Health check completo
- ✅ `GET /api/workers/consumers` - Listar consumers ativos
- ✅ `GET /api/workers/lag` - Lag do stream
- ✅ `GET /api/workers/pending` - Eventos pendentes
- ✅ `GET /api/workers/dlq` - Tamanho da DLQ

### 5. **Scripts de Gerenciamento**
- ✅ `scripts/start-workers.sh` - Iniciar workers com PM2
- ✅ `scripts/reprocess-dlq.js` - Reprocessar eventos da DLQ
- ✅ `workers/pm2.config.js` - Configuração PM2 para 3 workers

### 6. **Integração no Sistema**
- ✅ Listeners pesados removidos do `setupListeners.js` inline
- ✅ Eventos publicados no Redis Stream `ride_events`
- ✅ Workers consomem via Consumer Groups

---

## 🏗️ Arquitetura

### Antes (Tudo Inline)
```
server.js
├── Handlers
├── Commands
└── Listeners (todos inline)
    ├── notifyPassenger (rápido)
    ├── notifyDriver (rápido)
    ├── sendPush (pesado) ❌
    ├── notifyDrivers (pesado) ❌
    └── startTripTimer (rápido)
```

### Depois (Workers Separados)
```
server.js
├── Handlers
├── Commands
└── Listeners rápidos (inline)
    ├── notifyPassenger ✅
    ├── notifyDriver ✅
    └── startTripTimer ✅

workers/listener-worker.js (x3)
└── Listeners pesados
    ├── notifyDrivers ✅
    └── sendPush ✅
```

---

## 📊 Fluxo de Processamento

1. **Evento Publicado**
   - Command/Handler publica evento via `eventSourcing.recordEvent()`
   - Evento vai para Redis Stream `ride_events`

2. **Worker Consome**
   - Worker lê do stream via Consumer Group `listener-workers`
   - Cada evento é processado por apenas um worker

3. **Processamento**
   - Worker executa handler do listener
   - Se sucesso: ACK no stream
   - Se falha: Retry automático (3 tentativas)

4. **DLQ (se necessário)**
   - Após 3 falhas: evento movido para `ride_events_dlq`
   - Pode ser reprocessado manualmente depois

---

## 🚀 Como Usar

### Iniciar Workers

```bash
# Opção 1: Script
./scripts/start-workers.sh

# Opção 2: PM2 direto
pm2 start workers/pm2.config.js

# Opção 3: Worker único (desenvolvimento)
node workers/listener-worker.js
```

### Monitorar Workers

```bash
# Health check
curl http://localhost:3001/api/workers/health

# Listar consumers
curl http://localhost:3001/api/workers/consumers

# Ver lag
curl http://localhost:3001/api/workers/lag

# Ver DLQ
curl http://localhost:3001/api/workers/dlq
```

### Reprocessar DLQ

```bash
# Dry run (ver o que seria reprocessado)
node scripts/reprocess-dlq.js --dry-run

# Reprocessar (limite padrão: 10)
node scripts/reprocess-dlq.js --limit 50
```

---

## 📈 Métricas Prometheus

### Workers
- `leaf_workers_active{worker_type="listener"}` - Workers ativos
- `leaf_listener_total{listener_name, status}` - Total processado
- `leaf_listener_duration_seconds{listener_name, status}` - Latência
- `leaf_event_backlog{event_type="dlq"}` - Tamanho da DLQ
- `leaf_event_backlog{event_type="pending"}` - Eventos pendentes

### Exemplo de Query Grafana
```promql
# Taxa de processamento
rate(leaf_listener_total[5m])

# Latência P95
histogram_quantile(0.95, leaf_listener_duration_seconds_bucket)

# Workers ativos
leaf_workers_active
```

---

## 🔧 Configuração

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

### Ajustar Número de Workers

Editar `workers/pm2.config.js` e adicionar/remover apps conforme necessário.

---

## 🐛 Troubleshooting

### Worker não processa eventos

1. Verificar Consumer Group:
   ```bash
   redis-cli XINFO GROUPS ride_events
   ```

2. Verificar eventos no stream:
   ```bash
   redis-cli XLEN ride_events
   redis-cli XRANGE ride_events - + COUNT 5
   ```

3. Verificar logs:
   ```bash
   pm2 logs listener-worker-1
   ```

### Eventos presos (não ACK)

1. Ver eventos pendentes:
   ```bash
   redis-cli XPENDING ride_events listener-workers
   ```

2. Reclamar eventos órfãos:
   ```bash
   redis-cli XCLAIM ride_events listener-workers worker-NEW - 0 <event-id>
   ```

### DLQ crescendo

1. Verificar tamanho:
   ```bash
   redis-cli XLEN ride_events_dlq
   ```

2. Ver eventos na DLQ:
   ```bash
   redis-cli XRANGE ride_events_dlq - + COUNT 10
   ```

3. Reprocessar:
   ```bash
   node scripts/reprocess-dlq.js --limit 100
   ```

---

## ✅ Checklist de Implementação

- [x] WorkerManager criado
- [x] Listener Worker criado
- [x] Consumer Groups configurados
- [x] Retry automático implementado
- [x] DLQ implementada
- [x] Health Monitor criado
- [x] Rotas de health criadas
- [x] Scripts de gerenciamento criados
- [x] Listeners pesados removidos do inline
- [x] Documentação criada
- [x] Integração com métricas Prometheus
- [x] Suporte a traceId

---

## 🎯 Próximos Passos (Opcional)

- [ ] Auto-scaling baseado em lag
- [ ] Dashboard Grafana para workers
- [ ] Reprocessamento automático de DLQ (agendado)
- [ ] Alertas quando DLQ cresce
- [ ] Métricas de throughput por worker

---

## 📚 Referências

- [Redis Streams Documentation](https://redis.io/docs/data-types/streams/)
- [Consumer Groups](https://redis.io/docs/data-types/streams/#consumer-groups)
- [PM2 Documentation](https://pm2.keymetrics.io/docs/usage/quick-start/)

