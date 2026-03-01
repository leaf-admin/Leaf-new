# 📋 TODO COMPLETO - PRÓXIMOS PASSOS PARA ESCALA

**Data de Criação:** 2025-01-XX  
**Total de Tarefas:** 49 tarefas  
**Duração Estimada:** 4-6 semanas

---

## 🔥 FASE 1: OBSERVABILIDADE (CRÍTICO - 7-10 dias)

### **1.1 Logs Estruturados + traceId** (3-4 dias)

- [ ] **obs-1-trace-context** - Criar `utils/trace-context.js` - Gerenciador de traceId
- [ ] **obs-2-middleware-traceid** - Criar middleware para gerar traceId automaticamente
- [ ] **obs-3-logger-traceid** - Modificar `utils/logger.js` para incluir traceId no formato de log
- [ ] **obs-4-handlers-traceid** - Adicionar traceId em todos os handlers do `server.js`
- [ ] **obs-5-commands-traceid** - Passar traceId para todos os Commands (RequestRide, AcceptRide, StartTrip, CompleteTrip, CancelRide)
- [ ] **obs-6-events-traceid** - Incluir traceId em todos os Events canônicos
- [ ] **obs-7-listeners-traceid** - Passar traceId para todos os Listeners
- [ ] **obs-8-remove-console-log** - Remover todos os `console.log` restantes e substituir por logger estruturado

### **1.2 Correlation ID Completo** (2-3 dias)

- [ ] **obs-9-validate-traceid** - Validar traceId em todos os pontos (handlers, commands, events, listeners)
- [ ] **obs-10-redis-traceid** - Adicionar traceId em logs de operações Redis
- [ ] **obs-11-firebase-traceid** - Adicionar traceId em logs de operações Firebase
- [ ] **obs-12-woovi-traceid** - Adicionar traceId em logs de operações Woovi
- [ ] **obs-13-fcm-traceid** - Adicionar traceId em logs de operações FCM
- [ ] **obs-14-test-traceid** - Testar rastreamento completo de um ride (do início ao fim)

### **1.3 Distributed Tracing (Opcional)** (2-3 dias)

- [ ] **obs-15-opentelemetry-install** - Instalar `@opentelemetry/api` e `@opentelemetry/sdk-node`
- [ ] **obs-16-spans-commands** - Configurar spans para execução de Commands
- [ ] **obs-17-spans-redis** - Configurar spans para operações Redis
- [ ] **obs-18-spans-events** - Configurar spans para publicação de Events
- [ ] **obs-19-spans-listeners** - Configurar spans para execução de Listeners
- [ ] **obs-20-spans-external** - Configurar spans para chamadas externas (Firebase, Woovi, FCM)
- [ ] **obs-21-export-jaeger** - Configurar exportação para Jaeger ou Tempo
- [ ] **obs-22-grafana-tracing** - Visualizar traces em Grafana

---

## 📊 FASE 2: MÉTRICAS (CRÍTICO - 3-4 dias)

### **2.1 Formato Prometheus** (2-3 dias)

- [ ] **metrics-1-prom-client** - Instalar `prom-client`
- [ ] **metrics-2-command-metrics** - Criar métricas de Commands (latency_ms, success_total, failure_total)
- [ ] **metrics-3-event-metrics** - Criar métricas de Events (published_total, consumed_total, lag_ms)
- [ ] **metrics-4-listener-metrics** - Criar métricas de Listeners (execution_latency_ms, failure_total)
- [ ] **metrics-5-redis-metrics** - Criar métricas de Redis (op_latency_ms, errors_total)
- [ ] **metrics-6-circuit-metrics** - Criar métricas de Circuit Breakers (state, failures_total)
- [ ] **metrics-7-idempotency-metrics** - Criar métricas de Idempotency (hit_total, miss_total)
- [ ] **metrics-8-endpoint-prometheus** - Modificar endpoint `/metrics` para retornar formato Prometheus
- [ ] **metrics-9-prometheus-config** - Configurar Prometheus para scrape do endpoint `/metrics`

### **2.2 Dashboards Grafana** (1 dia)

- [ ] **metrics-10-grafana-setup** - Configurar Grafana e conectar ao Prometheus
- [ ] **metrics-11-dashboard-commands** - Criar dashboard Grafana para Commands (latência, sucesso, erro)
- [ ] **metrics-12-dashboard-events** - Criar dashboard Grafana para Events (throughput, lag)
- [ ] **metrics-13-dashboard-listeners** - Criar dashboard Grafana para Listeners (latência, falhas)
- [ ] **metrics-14-dashboard-redis** - Criar dashboard Grafana para Redis (ops, latência, memória)
- [ ] **metrics-15-dashboard-circuit** - Criar dashboard Grafana para Circuit Breakers (estado, falhas)
- [ ] **metrics-16-dashboard-sistema** - Criar dashboard Grafana para Sistema (CPU, RAM, conexões, uptime)
- [ ] **metrics-17-alertas-basicos** - Configurar alertas básicos no Grafana (latência alta, erros, circuit breakers abertos)

---

## ⚙️ FASE 3: WORKERS (IMPORTANTE - 7-10 dias)

### **3.1 Separação de Workers** (3-4 dias)

- [ ] **workers-1-listener-worker** - Criar `workers/listener-worker.js`
- [ ] **workers-2-identify-heavy** - Identificar listeners pesados (notifyDrivers, sendPush)
- [ ] **workers-3-move-heavy** - Mover listeners pesados para workers
- [ ] **workers-4-keep-fast** - Manter listeners rápidos inline (notifyPassenger, notifyDriver, startTripTimer)
- [ ] **workers-5-test-workers** - Testar workers separados
- [ ] **workers-6-doc-architecture** - Documentar arquitetura de workers

### **3.2 Consumer Groups** (2-3 dias)

- [ ] **workers-7-consumer-groups** - Configurar Consumer Groups no Redis Streams
- [ ] **workers-8-multiple-workers** - Criar múltiplos workers consumindo o mesmo stream
- [ ] **workers-9-retry-auto** - Implementar retry automático (3 tentativas)
- [ ] **workers-10-test-distribution** - Testar distribuição de carga entre workers
- [ ] **workers-11-monitor-lag** - Monitorar lag por consumer

### **3.3 Dead Letter Queue** (1 dia)

- [ ] **workers-12-create-dlq** - Criar stream `ride-events-dlq`
- [ ] **workers-13-move-failed** - Mover eventos que falham 3x para DLQ
- [ ] **workers-14-dashboard-dlq** - Criar dashboard para monitorar DLQ
- [ ] **workers-15-reprocess** - Criar processo de reprocessamento manual de DLQ

---

## 🧪 FASE 4: STRESS TEST (IMPORTANTE - 3-4 dias)

### **4.1 Testes de Carga** (2-3 dias)

- [ ] **stress-1-command-flood** - Criar `scripts/stress-test/command-flood.js` (1k/5k/10k createBooking)
- [ ] **stress-2-backpressure** - Criar `scripts/stress-test/listener-backpressure.js` (eventos mais rápido que consumo)
- [ ] **stress-3-external-failure** - Criar `scripts/stress-test/external-failure.js` (Firebase/Woovi/FCM down)
- [ ] **stress-4-peak-scenario** - Criar `scripts/stress-test/peak-scenario.js` (10k drivers, 5k rides em 30s)

### **4.2 Ferramentas e Documentação** (1 dia)

- [ ] **stress-5-k6-config** - Configurar k6 para testes HTTP
- [ ] **stress-6-artillery-config** - Configurar Artillery para testes WebSocket
- [ ] **stress-7-node-scripts** - Criar scripts Node.js para testes específicos
- [ ] **stress-8-documentation** - Documentar como executar todos os stress tests
- [ ] **stress-9-capacity-report** - Criar relatório de capacidade do sistema

---

## 📊 RESUMO POR FASE

| Fase | Tarefas | Status | Prioridade |
|------|---------|--------|------------|
| **Fase 1: Observabilidade** | 22 | ⏳ 0/22 | 🔥 Crítico |
| **Fase 2: Métricas** | 17 | ⏳ 0/17 | 🔥 Crítico |
| **Fase 3: Workers** | 15 | ⏳ 0/15 | ⚠️ Importante |
| **Fase 4: Stress Test** | 9 | ⏳ 0/9 | ⚠️ Importante |
| **TOTAL** | **63** | **0/63** | - |

---

## 🎯 PRIORIZAÇÃO

### **🔥 CRÍTICO (Fazer Primeiro):**
1. Fase 1.1 - Logs estruturados + traceId
2. Fase 2.1 - Métricas Prometheus
3. Fase 2.2 - Dashboards Grafana

### **⚠️ IMPORTANTE (Fazer Depois):**
4. Fase 3.1 - Separação de Workers
5. Fase 3.2 - Consumer Groups
6. Fase 4.1 - Stress Tests

### **📊 OPCIONAL (Fazer Por Último):**
7. Fase 1.3 - Distributed Tracing
8. Fase 3.3 - Dead Letter Queue

---

## 📅 CRONOGRAMA SUGERIDO

### **Semana 1-2: Observabilidade**
- Fase 1.1: Logs estruturados + traceId
- Fase 1.2: Correlation ID completo
- (Opcional) Fase 1.3: Distributed Tracing

### **Semana 3: Métricas**
- Fase 2.1: Prometheus
- Fase 2.2: Grafana dashboards

### **Semana 4-5: Workers**
- Fase 3.1: Separação de workers
- Fase 3.2: Consumer Groups
- Fase 3.3: DLQ

### **Semana 6: Stress Test**
- Fase 4.1: Testes de carga
- Fase 4.2: Ferramentas e documentação

---

## ✅ CRITÉRIOS DE SUCESSO

### **Fase 1: Observabilidade**
- ✅ 100% dos logs têm traceId
- ✅ Possível rastrear um ride completo
- ✅ Traces visíveis em Jaeger (se implementado)

### **Fase 2: Métricas**
- ✅ Todas as métricas expostas
- ✅ Dashboards funcionais
- ✅ Alertas configurados

### **Fase 3: Workers**
- ✅ Workers separados funcionando
- ✅ Consumer Groups distribuindo carga
- ✅ DLQ capturando falhas

### **Fase 4: Stress Test**
- ✅ Testes executados com sucesso
- ✅ Gargalos identificados
- ✅ Capacidade conhecida

---

**Última atualização:** 2025-01-XX

