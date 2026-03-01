# 🧪 TESTES LOCAIS - OBSERVABILIDADE

**Data:** 2026-01-08  
**Objetivo:** Testar implementações de observabilidade antes de subir para VPS

---

## 📋 CHECKLIST DE TESTES

### 1. **Health Checks** ✅

```bash
# Health check completo
curl http://localhost:3001/health | jq

# Health check rápido
curl http://localhost:3001/health/quick | jq

# Readiness probe
curl http://localhost:3001/health/readiness | jq

# Liveness probe
curl http://localhost:3001/health/liveness | jq
```

**Esperado:**
- Status: `healthy` ou `warning`
- Checks: Redis, Firebase, WebSocket, Sistema
- Status HTTP: 200 (se healthy) ou 503 (se unhealthy)

---

### 2. **Alertas** ✅

```bash
# Listar alertas
curl http://localhost:3001/api/alerts | jq

# Estatísticas de alertas
curl http://localhost:3001/api/alerts/stats | jq

# Testar alerta
curl -X POST http://localhost:3001/api/alerts/test \
  -H "Content-Type: application/json" \
  -d '{"severity": "critical", "metric": "test_metric", "service": "test-service"}' | jq
```

**Esperado:**
- Lista de alertas (pode estar vazia inicialmente)
- Estatísticas com contadores
- Alerta de teste criado e enviado (se Slack configurado)

---

### 3. **Métricas Prometheus** ✅

```bash
# Endpoint de métricas
curl http://localhost:3001/api/metrics/prometheus | head -50

# Verificar métricas específicas
curl http://localhost:3001/api/metrics/prometheus | grep -E "leaf_commands_total|leaf_redis_duration|leaf_websocket_connections"
```

**Esperado:**
- Métricas no formato Prometheus
- Contadores e histogramas funcionando

---

### 4. **Logs Estruturados** ✅

```bash
# Verificar logs do servidor
tail -f /tmp/leaf-server.log | grep -E "service|operation" | head -20

# Ou se estiver rodando em terminal
# Verificar que não há console.log nos logs
```

**Esperado:**
- Logs no formato estruturado (JSON)
- Sem `console.log` em arquivos de produção

---

### 5. **Prometheus (Docker)** ✅

```bash
# Verificar se Prometheus está coletando
curl http://localhost:9090/api/v1/targets | jq '.data.activeTargets[] | {job: .labels.job, health: .health}'

# Verificar alertas no Prometheus
curl http://localhost:9090/api/v1/alerts | jq '.data.alerts[] | {name: .labels.alertname, state: .state}'
```

**Esperado:**
- Target `leaf-backend` com health `up`
- Alertas configurados (podem estar `inactive` se não houver violações)

---

### 6. **Grafana (Docker)** ✅

```bash
# Verificar se Grafana está rodando
curl -u admin:admin http://localhost:3000/api/health

# Verificar dashboards
curl -u admin:admin http://localhost:3000/api/dashboards/home | jq '.dashboard.title'
```

**Esperado:**
- Grafana respondendo
- Dashboards carregados (Redis, Sistema)

---

## 🚀 INICIANDO SERVIÇOS

### 1. Iniciar Observabilidade (Docker Compose)

```bash
cd /home/izaak-dias/Downloads/leaf-project
docker-compose -f docker-compose.observability.yml up -d
```

### 2. Iniciar Backend

```bash
cd /home/izaak-dias/Downloads/leaf-project/leaf-websocket-backend
npm start
# ou
node server.js
```

---

## ✅ VALIDAÇÕES

### Health Checks
- [ ] `/health` retorna status completo
- [ ] `/health/quick` retorna apenas críticos
- [ ] `/health/readiness` funciona para Kubernetes
- [ ] `/health/liveness` sempre retorna 200

### Alertas
- [ ] `/api/alerts` lista alertas
- [ ] `/api/alerts/stats` retorna estatísticas
- [ ] `/api/alerts/test` cria alerta de teste
- [ ] Alertas aparecem no Prometheus (se violações)

### Métricas
- [ ] `/api/metrics/prometheus` retorna métricas
- [ ] Prometheus está coletando métricas
- [ ] Grafana consegue visualizar métricas

### Logs
- [ ] Logs estruturados funcionando
- [ ] Sem console.log em produção

---

**Última atualização:** 2026-01-08

