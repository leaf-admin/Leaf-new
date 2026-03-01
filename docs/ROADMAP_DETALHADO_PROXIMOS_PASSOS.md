# 🗺️ ROADMAP DETALHADO - PRÓXIMOS PASSOS

**Baseado em:** Análise comparativa com Uber/99  
**Foco:** Operabilidade em escala  
**Duração estimada:** 4-6 semanas

---

## 📅 CRONOGRAMA SUGERIDO

### **SEMANA 1-2: OBSERVABILIDADE (CRÍTICO)**

#### **Dia 1-2: Logs Estruturados + traceId**

**Tarefas:**
1. Criar `utils/trace-context.js` - Gerenciador de traceId
2. Criar middleware para gerar traceId
3. Modificar `utils/logger.js` para incluir traceId
4. Adicionar traceId em handlers do `server.js`
5. Passar traceId para Commands
6. Passar traceId para Events
7. Passar traceId para Listeners
8. Remover `console.log` restantes

**Entregáveis:**
- ✅ Todos os logs têm traceId
- ✅ TraceId passa por toda a cadeia
- ✅ Formato de log padronizado

#### **Dia 3-4: Correlation ID Completo**

**Tarefas:**
1. Validar traceId em todos os pontos
2. Adicionar traceId em logs de Redis
3. Adicionar traceId em logs de Firebase
4. Adicionar traceId em logs de Woovi
5. Adicionar traceId em logs de FCM
6. Testar rastreamento completo de um ride

**Entregáveis:**
- ✅ Um ride = um traceId do início ao fim
- ✅ Possível rastrear todo o fluxo

#### **Dia 5-7: Distributed Tracing (Opcional)**

**Tarefas:**
1. Instalar OpenTelemetry
2. Configurar spans para Commands
3. Configurar spans para Redis
4. Configurar spans para Events
5. Configurar spans para Listeners
6. Exportar para Jaeger
7. Visualizar em Grafana

**Entregáveis:**
- ✅ Traces visíveis em Jaeger
- ✅ Spans para todas as operações

---

### **SEMANA 3: MÉTRICAS (CRÍTICO)**

#### **Dia 1-3: Prometheus**

**Tarefas:**
1. Instalar `prom-client`
2. Criar métricas de Commands:
   - `command_execution_latency_ms{command=}`
   - `command_success_total{command=}`
   - `command_failure_total{command=}`
3. Criar métricas de Events:
   - `events_published_total{eventType=}`
   - `events_consumed_total{eventType=}`
   - `event_lag_ms{eventType=}`
4. Criar métricas de Listeners:
   - `listener_execution_latency_ms{listener=}`
   - `listener_failure_total{listener=}`
5. Criar métricas de Redis:
   - `redis_op_latency_ms{op=}`
   - `redis_errors_total`
6. Criar métricas de Circuit Breakers:
   - `circuit_state{service=}`
   - `circuit_failures_total{service=}`
7. Criar métricas de Idempotency:
   - `idempotency_hit_total`
   - `idempotency_miss_total`
8. Modificar endpoint `/metrics` para formato Prometheus
9. Configurar Prometheus para scrape

**Entregáveis:**
- ✅ Endpoint `/metrics` em formato Prometheus
- ✅ Todas as métricas expostas
- ✅ Prometheus coletando métricas

#### **Dia 4-5: Dashboards Grafana**

**Tarefas:**
1. Configurar Grafana
2. Conectar ao Prometheus
3. Criar dashboard "Commands":
   - Latência média/P95/P99
   - Taxa de sucesso/erro
   - Throughput
4. Criar dashboard "Events":
   - Eventos publicados/consumidos
   - Lag de eventos
   - Throughput por tipo
5. Criar dashboard "Listeners":
   - Latência de execução
   - Taxa de falha
   - Throughput
6. Criar dashboard "Redis":
   - Latência de operações
   - Taxa de erro
   - Uso de memória
7. Criar dashboard "Circuit Breakers":
   - Estado (CLOSED/OPEN/HALF_OPEN)
   - Falhas acumuladas
8. Criar dashboard "Sistema":
   - CPU, RAM, conexões
   - Uptime

**Entregáveis:**
- ✅ 6 dashboards funcionais
- ✅ Visualização em tempo real
- ✅ Alertas básicos configurados

---

### **SEMANA 4-5: WORKERS (IMPORTANTE)**

#### **Dia 1-3: Separação de Workers**

**Tarefas:**
1. Criar `workers/listener-worker.js`
2. Identificar listeners pesados:
   - `notifyDrivers` (matching pesado)
   - `sendPush` (FCM)
3. Mover listeners pesados para workers
4. Manter listeners rápidos inline:
   - `notifyPassenger` (WebSocket)
   - `notifyDriver` (WebSocket)
   - `startTripTimer` (Redis)
5. Testar workers separados
6. Documentar arquitetura

**Entregáveis:**
- ✅ Workers separados funcionando
- ✅ Listeners pesados isolados
- ✅ Processo principal mais leve

#### **Dia 4-5: Consumer Groups**

**Tarefas:**
1. Configurar Consumer Groups no Redis Streams
2. Criar múltiplos workers consumindo
3. Implementar retry automático (3 tentativas)
4. Testar distribuição de carga
5. Monitorar lag por consumer

**Entregáveis:**
- ✅ Consumer Groups funcionando
- ✅ Múltiplos workers processando
- ✅ Retry automático implementado

#### **Dia 6-7: Dead Letter Queue**

**Tarefas:**
1. Criar stream `ride-events-dlq`
2. Mover eventos que falham 3x para DLQ
3. Criar dashboard para monitorar DLQ
4. Criar processo de reprocessamento manual
5. Documentar processo

**Entregáveis:**
- ✅ DLQ funcionando
- ✅ Dashboard de DLQ
- ✅ Processo de reprocessamento

---

### **SEMANA 6: STRESS TEST (IMPORTANTE)**

#### **Dia 1-2: Testes de Carga**

**Tarefas:**
1. Criar `scripts/stress-test/command-flood.js`
   - Simular 1k/5k/10k `createBooking`
   - Medir latência, Redis, event lag
2. Criar `scripts/stress-test/listener-backpressure.js`
   - Eventos mais rápido que consumo
   - Medir stream size, lag, recuperação
3. Criar `scripts/stress-test/external-failure.js`
   - Simular Firebase/Woovi/FCM down
   - Verificar circuit breakers
4. Criar `scripts/stress-test/peak-scenario.js`
   - 10k drivers, 5k rides em 30s
   - Medir match time, notificações, recursos

**Entregáveis:**
- ✅ 4 scripts de stress test
- ✅ Relatórios de performance
- ✅ Identificação de gargalos

#### **Dia 3-4: Ferramentas e Documentação**

**Tarefas:**
1. Configurar k6 para HTTP
2. Configurar Artillery para WebSocket
3. Criar scripts Node.js específicos
4. Documentar como executar
5. Criar relatório de capacidade

**Entregáveis:**
- ✅ Ferramentas configuradas
- ✅ Documentação completa
- ✅ Relatório de capacidade

---

## 📊 MÉTRICAS DE SUCESSO

### **Observabilidade:**
- ✅ 100% dos logs têm traceId
- ✅ Possível rastrear um ride completo
- ✅ Traces visíveis em Jaeger (se implementado)

### **Métricas:**
- ✅ Todas as métricas expostas
- ✅ Dashboards funcionais
- ✅ Alertas configurados

### **Workers:**
- ✅ Workers separados funcionando
- ✅ Consumer Groups distribuindo carga
- ✅ DLQ capturando falhas

### **Stress Test:**
- ✅ Testes executados com sucesso
- ✅ Gargalos identificados
- ✅ Capacidade conhecida

---

## 🎯 RESULTADO FINAL

Após completar todas as fases:

**Sistema Leaf terá:**
- ✅ Observabilidade completa (logs + traces)
- ✅ Métricas em tempo real (Prometheus + Grafana)
- ✅ Escala horizontal (workers distribuídos)
- ✅ Confiança em escala (stress tests validados)

**Pronto para:**
- ✅ Pico real (réveillon, eventos)
- ✅ Crescimento regional
- ✅ Debugging em produção
- ✅ Monitoramento proativo

---

**Última atualização:** 2025-01-XX

