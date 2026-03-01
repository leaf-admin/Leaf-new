# 📋 Resumo de TODOs Pendentes - LEAF Project

**Data:** 2026-01-03  
**Status:** Observabilidade configurada, pendências organizadas por prioridade

---

## 🔥 PRIORIDADE ALTA - Observabilidade (Parcialmente Completo)

### FASE 1.1: Logs Estruturados
- [ ] **obs-8-remove-console-log** - Remover todos os `console.log` restantes e substituir por logger estruturado
- [ ] **obs-9-validate-traceid** - Validar traceId em todos os pontos (handlers, commands, events, listeners)

### FASE 1.3: OpenTelemetry (Parcial
- [ ] **obs-16-spans-commands** - Configurar spans para TODOS os Commands (40% completo - apenas RequestRide e AcceptRide)
  - Pendente: StartTripCommand, CompleteTripCommand, CancelRideCommand
- [ ] **obs-17-spans-redis** - Configurar spans para operações Redis
- [ ] **obs-18-spans-events** - Configurar spans para TODOS os Events (40% completo - apenas ride.requested e ride.accepted)
  - Pendente: ride.rejected, ride.canceled, ride.started, ride.completed, driver.online, driver.offline, payment.confirmed

---

## 📊 PRIORIDADE ALTA - Métricas (Infraestrutura Criada, Integração Pendente)

### FASE 2.1: Métricas Prometheus
- [ ] **metrics-1-prom-client** - ✅ Instalado, mas verificar se todas as métricas estão sendo registradas
- [ ] **metrics-2-command-metrics** - Integrar registro automático de métricas nos Commands
- [ ] **metrics-3-event-metrics** - Integrar registro automático de métricas nos Events
- [ ] **metrics-4-listener-metrics** - Integrar registro automático de métricas nos Listeners
- [ ] **metrics-5-redis-metrics** - Criar e integrar métricas de Redis (op_latency_ms, errors_total)
- [ ] **metrics-6-circuit-metrics** - Integrar métricas de Circuit Breakers (já definidas, falta integrar)
- [ ] **metrics-7-idempotency-metrics** - Criar e integrar métricas de Idempotency (hit_total, miss_total)

### FASE 2.2: Dashboards Adicionais
- [ ] **metrics-14-dashboard-redis** - Criar dashboard Grafana para Redis (ops, latência, memória)
- [ ] **metrics-16-dashboard-sistema** - Criar dashboard Grafana para Sistema (CPU, RAM, conexões, uptime)

---

## ⚙️ PRIORIDADE MÉDIA - Workers e Escalabilidade

### FASE 3.1: Workers Separados
- [ ] **workers-1-listener-worker** - Criar `workers/listener-worker.js`
- [ ] **workers-2-identify-heavy** - Identificar listeners pesados (notifyDrivers, sendPush)
- [ ] **workers-3-move-heavy** - Mover listeners pesados para workers
- [ ] **workers-4-keep-fast** - Manter listeners rápidos inline (notifyPassenger, notifyDriver, startTripTimer)
- [ ] **workers-5-test-workers** - Testar workers separados
- [ ] **workers-6-doc-architecture** - Documentar arquitetura de workers

### FASE 3.2: Consumer Groups e Distribuição
- [ ] **workers-7-consumer-groups** - Configurar Consumer Groups no Redis Streams
- [ ] **workers-8-multiple-workers** - Criar múltiplos workers consumindo o mesmo stream
- [ ] **workers-9-retry-auto** - Implementar retry automático (3 tentativas)
- [ ] **workers-10-test-distribution** - Testar distribuição de carga entre workers
- [ ] **workers-11-monitor-lag** - Monitorar lag por consumer

### FASE 3.3: Dead Letter Queue (DLQ)
- [ ] **workers-12-create-dlq** - Criar stream `ride-events-dlq`
- [ ] **workers-13-move-failed** - Mover eventos que falham 3x para DLQ
- [ ] **workers-14-dashboard-dlq** - Criar dashboard para monitorar DLQ
- [ ] **workers-15-reprocess** - Criar processo de reprocessamento manual de DLQ

---

## 🧪 PRIORIDADE BAIXA - Stress Testing

### FASE 4.1: Scripts de Stress Test
- [ ] **stress-1-command-flood** - Criar `scripts/stress-test/command-flood.js` (1k/5k/10k createBooking)
- [ ] **stress-2-backpressure** - Criar `scripts/stress-test/listener-backpressure.js` (eventos mais rápido que consumo)
- [ ] **stress-3-external-failure** - Criar `scripts/stress-test/external-failure.js` (Firebase/Woovi/FCM down)
- [ ] **stress-4-peak-scenario** - Criar `scripts/stress-test/peak-scenario.js` (10k drivers, 5k rides em 30s)

### FASE 4.2: Ferramentas de Teste
- [ ] **stress-5-k6-config** - Configurar k6 para testes HTTP
- [ ] **stress-6-artillery-config** - Configurar Artillery para testes WebSocket
- [ ] **stress-7-node-scripts** - Criar scripts Node.js para testes específicos
- [ ] **stress-8-documentation** - Documentar como executar todos os stress tests
- [ ] **stress-9-capacity-report** - Criar relatório de capacidade do sistema

---

## 📊 RESUMO POR CATEGORIA

| Categoria | Total | Pendentes | % Completo |
|-----------|-------|-----------|------------|
| **Observabilidade** | 22 | 5 | 77% |
| **Métricas** | 17 | 9 | 47% |
| **Workers** | 15 | 15 | 0% |
| **Stress Testing** | 9 | 9 | 0% |
| **TOTAL** | **63** | **38** | **40%** |

---

## 🎯 PRÓXIMOS PASSOS RECOMENDADOS

### Semana 1-2: Finalizar Observabilidade
1. Completar spans para todos os Commands e Events
2. Integrar métricas automáticas nos pontos críticos
3. Remover console.log restantes
4. Validar traceId em todos os pontos

### Semana 3-4: Métricas e Dashboards
1. Criar dashboard Redis
2. Criar dashboard Sistema
3. Integrar todas as métricas definidas
4. Testar coleta de métricas em produção

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

### Métricas
- ✅ Endpoint `/metrics` funcionando
- ✅ Utils de métricas criado
- ✅ Métricas definidas (Commands, Events, Listeners, etc.)
- ✅ Prometheus configurado
- ✅ Dashboards básicos criados

---

**Última atualização:** 2026-01-03


**Data:** 2026-01-03  
**Status:** Observabilidade configurada, pendências organizadas por prioridade

---

## 🔥 PRIORIDADE ALTA - Observabilidade (Parcialmente Completo)

### FASE 1.1: Logs Estruturados
- [ ] **obs-8-remove-console-log** - Remover todos os `console.log` restantes e substituir por logger estruturado
- [ ] **obs-9-validate-traceid** - Validar traceId em todos os pontos (handlers, commands, events, listeners)

### FASE 1.3: OpenTelemetry (Parcial
- [ ] **obs-16-spans-commands** - Configurar spans para TODOS os Commands (40% completo - apenas RequestRide e AcceptRide)
  - Pendente: StartTripCommand, CompleteTripCommand, CancelRideCommand
- [ ] **obs-17-spans-redis** - Configurar spans para operações Redis
- [ ] **obs-18-spans-events** - Configurar spans para TODOS os Events (40% completo - apenas ride.requested e ride.accepted)
  - Pendente: ride.rejected, ride.canceled, ride.started, ride.completed, driver.online, driver.offline, payment.confirmed

---

## 📊 PRIORIDADE ALTA - Métricas (Infraestrutura Criada, Integração Pendente)

### FASE 2.1: Métricas Prometheus
- [ ] **metrics-1-prom-client** - ✅ Instalado, mas verificar se todas as métricas estão sendo registradas
- [ ] **metrics-2-command-metrics** - Integrar registro automático de métricas nos Commands
- [ ] **metrics-3-event-metrics** - Integrar registro automático de métricas nos Events
- [ ] **metrics-4-listener-metrics** - Integrar registro automático de métricas nos Listeners
- [ ] **metrics-5-redis-metrics** - Criar e integrar métricas de Redis (op_latency_ms, errors_total)
- [ ] **metrics-6-circuit-metrics** - Integrar métricas de Circuit Breakers (já definidas, falta integrar)
- [ ] **metrics-7-idempotency-metrics** - Criar e integrar métricas de Idempotency (hit_total, miss_total)

### FASE 2.2: Dashboards Adicionais
- [ ] **metrics-14-dashboard-redis** - Criar dashboard Grafana para Redis (ops, latência, memória)
- [ ] **metrics-16-dashboard-sistema** - Criar dashboard Grafana para Sistema (CPU, RAM, conexões, uptime)

---

## ⚙️ PRIORIDADE MÉDIA - Workers e Escalabilidade

### FASE 3.1: Workers Separados
- [ ] **workers-1-listener-worker** - Criar `workers/listener-worker.js`
- [ ] **workers-2-identify-heavy** - Identificar listeners pesados (notifyDrivers, sendPush)
- [ ] **workers-3-move-heavy** - Mover listeners pesados para workers
- [ ] **workers-4-keep-fast** - Manter listeners rápidos inline (notifyPassenger, notifyDriver, startTripTimer)
- [ ] **workers-5-test-workers** - Testar workers separados
- [ ] **workers-6-doc-architecture** - Documentar arquitetura de workers

### FASE 3.2: Consumer Groups e Distribuição
- [ ] **workers-7-consumer-groups** - Configurar Consumer Groups no Redis Streams
- [ ] **workers-8-multiple-workers** - Criar múltiplos workers consumindo o mesmo stream
- [ ] **workers-9-retry-auto** - Implementar retry automático (3 tentativas)
- [ ] **workers-10-test-distribution** - Testar distribuição de carga entre workers
- [ ] **workers-11-monitor-lag** - Monitorar lag por consumer

### FASE 3.3: Dead Letter Queue (DLQ)
- [ ] **workers-12-create-dlq** - Criar stream `ride-events-dlq`
- [ ] **workers-13-move-failed** - Mover eventos que falham 3x para DLQ
- [ ] **workers-14-dashboard-dlq** - Criar dashboard para monitorar DLQ
- [ ] **workers-15-reprocess** - Criar processo de reprocessamento manual de DLQ

---

## 🧪 PRIORIDADE BAIXA - Stress Testing

### FASE 4.1: Scripts de Stress Test
- [ ] **stress-1-command-flood** - Criar `scripts/stress-test/command-flood.js` (1k/5k/10k createBooking)
- [ ] **stress-2-backpressure** - Criar `scripts/stress-test/listener-backpressure.js` (eventos mais rápido que consumo)
- [ ] **stress-3-external-failure** - Criar `scripts/stress-test/external-failure.js` (Firebase/Woovi/FCM down)
- [ ] **stress-4-peak-scenario** - Criar `scripts/stress-test/peak-scenario.js` (10k drivers, 5k rides em 30s)

### FASE 4.2: Ferramentas de Teste
- [ ] **stress-5-k6-config** - Configurar k6 para testes HTTP
- [ ] **stress-6-artillery-config** - Configurar Artillery para testes WebSocket
- [ ] **stress-7-node-scripts** - Criar scripts Node.js para testes específicos
- [ ] **stress-8-documentation** - Documentar como executar todos os stress tests
- [ ] **stress-9-capacity-report** - Criar relatório de capacidade do sistema

---

## 📊 RESUMO POR CATEGORIA

| Categoria | Total | Pendentes | % Completo |
|-----------|-------|-----------|------------|
| **Observabilidade** | 22 | 5 | 77% |
| **Métricas** | 17 | 9 | 47% |
| **Workers** | 15 | 15 | 0% |
| **Stress Testing** | 9 | 9 | 0% |
| **TOTAL** | **63** | **38** | **40%** |

---

## 🎯 PRÓXIMOS PASSOS RECOMENDADOS

### Semana 1-2: Finalizar Observabilidade
1. Completar spans para todos os Commands e Events
2. Integrar métricas automáticas nos pontos críticos
3. Remover console.log restantes
4. Validar traceId em todos os pontos

### Semana 3-4: Métricas e Dashboards
1. Criar dashboard Redis
2. Criar dashboard Sistema
3. Integrar todas as métricas definidas
4. Testar coleta de métricas em produção

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

### Métricas
- ✅ Endpoint `/metrics` funcionando
- ✅ Utils de métricas criado
- ✅ Métricas definidas (Commands, Events, Listeners, etc.)
- ✅ Prometheus configurado
- ✅ Dashboards básicos criados

---

**Última atualização:** 2026-01-03



