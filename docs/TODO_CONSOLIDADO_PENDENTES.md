# 📋 TODO CONSOLIDADO - Tarefas Pendentes

**Data de Atualização:** 2026-01-XX  
**Status Geral:** Em Progresso  
**Prioridade:** Alta

---

## 🔥 PRIORIDADE ALTA - Observabilidade

### ✅ FASE 1.1: Logs Estruturados (Em Progresso - ~40% completo)

#### Substituição de console.log
- [x] **obs-8-remove-console-log-server-inicial** - Substituídos ~22 console.log iniciais no server.js
- [ ] **obs-8-remove-console-log-server-restantes** - Substituir ~93 console.log restantes no server.js (46 substituídos - 33% completo)
  - ✅ Substituídos (46): 
    - Logs de reinicialização, driver location, FCM tokens, conexões
    - Idempotency (createBooking, acceptRide)
    - Debug traceId, teste automático
    - Handlers: driverResponse, rejectRide, startTrip, submitRating
    - notificationAction (arrived_at_pickup, start_trip, cancel_ride)
    - setDriverStatus (lock de veículo, status online/offline)
    - updateLocation, driverHeartbeat
    - searchDrivers, cancelDriverSearch
    - cancelRide (reembolso)
    - reportIncident, emergencyContact, supportChat
  - ⏳ Pendente: ~93 logs em handlers de WebSocket, operações de negócio, eventos de corrida
- [ ] **obs-8-remove-console-log-services** - Substituir console.log em ~15 arquivos em services/
  - Arquivos identificados:
    - payment-service.js
    - kyc-service.js
    - woovi-driver-service.js
    - driver-notification-dispatcher.js
    - chat-service.js
    - audit-service.js
    - rate-limiter-service.js
    - chat-persistence-service.js
    - dashboard-websocket.js
    - IntegratedKYCService.js
    - kyc-vps-client.js
    - firebase-storage-service.js
    - KYCFaceWorker.js
    - driver-approval-service.js
    - KYCRetryService.js
- [ ] **obs-8-remove-console-log-routes** - Substituir console.log em arquivos de routes/

#### Validação de traceId
- [ ] **obs-9-validate-traceid** - Validar traceId em todos os pontos
  - Handlers de WebSocket
  - Commands (RequestRide, AcceptRide, StartTrip, CompleteTrip, CancelRide)
  - Events canônicos
  - Listeners
  - Operações Redis
  - Operações Firebase
  - Operações Woovi
  - Operações FCM

### ⏳ FASE 1.3: OpenTelemetry (Parcial - 40% completo)

#### Spans para Commands
- [x] **obs-16-spans-request-ride** - ✅ RequestRideCommand com spans
- [x] **obs-16-spans-accept-ride** - ✅ AcceptRideCommand com spans
- [ ] **obs-16-spans-start-trip** - Configurar spans para StartTripCommand
- [ ] **obs-16-spans-complete-trip** - Configurar spans para CompleteTripCommand
- [ ] **obs-16-spans-cancel-ride** - Configurar spans para CancelRideCommand

#### Spans para Redis
- [ ] **obs-17-spans-redis** - Configurar spans para operações Redis
  - Operações GET/SET
  - Operações GEOADD/GEORADIUS
  - Operações HASH
  - Operações STREAMS

#### Spans para Events
- [x] **obs-18-spans-ride-requested** - ✅ ride.requested com spans
- [x] **obs-18-spans-ride-accepted** - ✅ ride.accepted com spans
- [ ] **obs-18-spans-ride-rejected** - Configurar spans para ride.rejected
- [ ] **obs-18-spans-ride-canceled** - Configurar spans para ride.canceled
- [ ] **obs-18-spans-ride-started** - Configurar spans para ride.started
- [ ] **obs-18-spans-ride-completed** - Configurar spans para ride.completed
- [ ] **obs-18-spans-driver-online** - Configurar spans para driver.online
- [ ] **obs-18-spans-driver-offline** - Configurar spans para driver.offline
- [ ] **obs-18-spans-payment-confirmed** - Configurar spans para payment.confirmed

---

## 📊 PRIORIDADE ALTA - Métricas (Infraestrutura Criada, Integração Pendente)

### FASE 2.1: Métricas Prometheus

- [x] **metrics-1-prom-client** - ✅ Instalado e configurado
- [ ] **metrics-2-command-metrics** - Integrar registro automático de métricas nos Commands
  - Latência (latency_ms)
  - Sucesso/Falha (success_total, failure_total)
  - Por tipo de command
- [ ] **metrics-3-event-metrics** - Integrar registro automático de métricas nos Events
  - Eventos publicados (published_total)
  - Eventos consumidos (consumed_total)
  - Lag de processamento (lag_ms)
- [ ] **metrics-4-listener-metrics** - Integrar registro automático de métricas nos Listeners
  - Latência de execução (execution_latency_ms)
  - Falhas (failure_total)
  - Por tipo de listener
- [ ] **metrics-5-redis-metrics** - Criar e integrar métricas de Redis
  - Latência de operações (op_latency_ms)
  - Erros (errors_total)
  - Operações por tipo (get_total, set_total, geoadd_total, etc.)
- [ ] **metrics-6-circuit-metrics** - Integrar métricas de Circuit Breakers
  - Estado atual (state: closed/open/half_open)
  - Falhas totais (failures_total)
  - Transições de estado
- [ ] **metrics-7-idempotency-metrics** - Criar e integrar métricas de Idempotency
  - Hits (hit_total) - requisições duplicadas detectadas
  - Misses (miss_total) - requisições novas
  - Cache hits/misses

### FASE 2.2: Dashboards Adicionais

- [x] **metrics-10-grafana-setup** - ✅ Grafana configurado
- [x] **metrics-11-dashboard-commands** - ✅ Dashboard básico criado
- [ ] **metrics-14-dashboard-redis** - Criar dashboard Grafana para Redis
  - Operações por segundo
  - Latência média/p95/p99
  - Uso de memória
  - Conexões ativas
- [ ] **metrics-16-dashboard-sistema** - Criar dashboard Grafana para Sistema
  - CPU usage
  - RAM usage
  - Conexões WebSocket ativas
  - Uptime
  - Throughput de requisições

---

## ⚙️ PRIORIDADE MÉDIA - Workers e Escalabilidade

### FASE 3.1: Workers Separados

- [ ] **workers-1-listener-worker** - Criar `workers/listener-worker.js`
  - Worker separado para processar eventos do EventBus
  - Consumir do Redis Streams
- [ ] **workers-2-identify-heavy** - Identificar listeners pesados
  - Analisar latência de cada listener
  - Identificar: notifyDrivers, sendPush (mais pesados)
- [ ] **workers-3-move-heavy** - Mover listeners pesados para workers
  - notifyDrivers → worker
  - sendPush → worker
- [ ] **workers-4-keep-fast** - Manter listeners rápidos inline
  - notifyPassenger (rápido - WebSocket direto)
  - notifyDriver (rápido - WebSocket direto)
  - startTripTimer (rápido - operação local)
- [ ] **workers-5-test-workers** - Testar workers separados
  - Testar processamento assíncrono
  - Validar que eventos são processados corretamente
- [ ] **workers-6-doc-architecture** - Documentar arquitetura de workers
  - Diagrama de arquitetura
  - Fluxo de processamento
  - Como escalar workers

### FASE 3.2: Consumer Groups e Distribuição

- [ ] **workers-7-consumer-groups** - Configurar Consumer Groups no Redis Streams
  - Criar consumer group "listener-workers"
  - Configurar auto-ack
- [ ] **workers-8-multiple-workers** - Criar múltiplos workers consumindo o mesmo stream
  - Worker 1, Worker 2, Worker 3...
  - Distribuição automática de eventos
- [ ] **workers-9-retry-auto** - Implementar retry automático
  - 3 tentativas por evento
  - Backoff exponencial
- [ ] **workers-10-test-distribution** - Testar distribuição de carga entre workers
  - Enviar 1000 eventos
  - Verificar que são distribuídos entre workers
- [ ] **workers-11-monitor-lag** - Monitorar lag por consumer
  - Métricas de lag por worker
  - Alertas se lag > threshold

### FASE 3.3: Dead Letter Queue (DLQ)

- [ ] **workers-12-create-dlq** - Criar stream `ride-events-dlq`
  - Stream para eventos que falharam 3x
- [ ] **workers-13-move-failed** - Mover eventos que falham 3x para DLQ
  - Após 3 tentativas, mover para DLQ
  - Manter metadata do erro
- [ ] **workers-14-dashboard-dlq** - Criar dashboard para monitorar DLQ
  - Eventos na DLQ
  - Taxa de falhas
  - Eventos mais frequentes
- [ ] **workers-15-reprocess** - Criar processo de reprocessamento manual de DLQ
  - Script para reprocessar eventos da DLQ
  - Interface admin para reprocessar

---

## 🧪 PRIORIDADE BAIXA - Stress Testing

### FASE 4.1: Scripts de Stress Test

- [ ] **stress-1-command-flood** - Criar `scripts/stress-test/command-flood.js`
  - 1k createBooking em 10s
  - 5k createBooking em 30s
  - 10k createBooking em 60s
- [ ] **stress-2-backpressure** - Criar `scripts/stress-test/listener-backpressure.js`
  - Eventos publicados mais rápido que consumo
  - Medir lag de processamento
- [ ] **stress-3-external-failure** - Criar `scripts/stress-test/external-failure.js`
  - Simular Firebase down
  - Simular Woovi down
  - Simular FCM down
  - Verificar circuit breakers
- [ ] **stress-4-peak-scenario** - Criar `scripts/stress-test/peak-scenario.js`
  - 10k drivers online
  - 5k rides em 30s
  - Medir latência e throughput

### FASE 4.2: Ferramentas e Documentação

- [ ] **stress-5-k6-config** - Configurar k6 para testes HTTP
  - Scripts k6 para endpoints REST
- [ ] **stress-6-artillery-config** - Configurar Artillery para testes WebSocket
  - Scripts Artillery para eventos WebSocket
- [ ] **stress-7-node-scripts** - Criar scripts Node.js para testes específicos
  - Testes de carga customizados
- [ ] **stress-8-documentation** - Documentar como executar todos os stress tests
  - README com instruções
  - Exemplos de uso
- [ ] **stress-9-capacity-report** - Criar relatório de capacidade do sistema
  - Limites identificados
  - Gargalos encontrados
  - Recomendações de escala

---

## 📊 RESUMO POR CATEGORIA

| Categoria | Total | Concluídas | Pendentes | % Completo |
|-----------|-------|------------|-----------|------------|
| **Observabilidade - Logs** | 4 | 1 | 3 | 25% |
| **Observabilidade - OpenTelemetry** | 12 | 4 | 8 | 33% |
| **Métricas** | 9 | 2 | 7 | 22% |
| **Workers** | 15 | 0 | 15 | 0% |
| **Stress Testing** | 9 | 0 | 9 | 0% |
| **TOTAL** | **49** | **7** | **42** | **14%** |

---

## 🎯 PRÓXIMOS PASSOS RECOMENDADOS

### Semana 1-2: Finalizar Observabilidade (PRIORIDADE MÁXIMA)
1. ✅ Substituir console.log restantes no server.js (~128 restantes)
2. ⏳ Substituir console.log em services/ (~15 arquivos)
3. ⏳ Completar spans OpenTelemetry para todos os Commands
4. ⏳ Completar spans OpenTelemetry para todos os Events
5. ⏳ Adicionar spans para operações Redis
6. ⏳ Validar traceId em todos os pontos

### Semana 3-4: Métricas e Dashboards
1. Integrar métricas automáticas nos Commands
2. Integrar métricas automáticas nos Events
3. Integrar métricas automáticas nos Listeners
4. Criar métricas de Redis
5. Criar métricas de Circuit Breakers
6. Criar métricas de Idempotency
7. Criar dashboard Redis
8. Criar dashboard Sistema

### Semana 5-6: Workers (Opcional - para escala)
1. Implementar workers separados
2. Configurar consumer groups
3. Implementar DLQ
4. Testar distribuição de carga

### Semana 7-8: Stress Testing (Opcional)
1. Criar scripts de stress test
2. Executar testes de capacidade
3. Identificar gargalos
4. Documentar resultados

---

## ✅ O QUE JÁ ESTÁ PRONTO

### Observabilidade
- ✅ TraceId implementado e propagado
- ✅ OpenTelemetry configurado (Tempo)
- ✅ Spans em Listeners (100%)
- ✅ Spans em Circuit Breakers (100%)
- ✅ Stack Docker completa (Tempo, Prometheus, Grafana)
- ✅ Dashboards Grafana provisionados
- ✅ CorrelationId implementado
- ✅ Logger estruturado configurado (Winston)
- ✅ Spans em RequestRideCommand e AcceptRideCommand
- ✅ Spans em ride.requested e ride.accepted

### Métricas
- ✅ Endpoint `/metrics` funcionando
- ✅ Utils de métricas criado
- ✅ Métricas definidas (Commands, Events, Listeners, etc.)
- ✅ Prometheus configurado
- ✅ Dashboards básicos criados

---

## 📝 NOTAS TÉCNICAS

### Estratégia de Substituição de console.log

1. **Logs de Debug**: Substituir por `logStructured('debug', ...)` condicionado a `NODE_ENV=development` ou variável de ambiente específica
2. **Logs de Info**: Substituir por `logStructured('info', ...)` com contexto apropriado
3. **Logs de Erro**: Substituir por `logStructured('error', ...)` ou `logError(...)`
4. **Logs de Performance**: Substituir por `logPerformance(...)` quando relevante
5. **Logs de WebSocket**: Usar `logWebSocket(...)` quando apropriado
6. **Logs de Redis**: Usar `logRedis(...)` quando apropriado

### Padrão de Contexto nos Logs

Sempre incluir:
- `service`: Nome do serviço/módulo
- `traceId`: ID de rastreamento (automático via traceContext)
- Contexto específico: `userId`, `bookingId`, `driverId`, `eventType`, etc.

---

**Última atualização:** 2026-01-XX

