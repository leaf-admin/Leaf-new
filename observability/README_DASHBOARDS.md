# 📊 Dashboards Grafana - Leaf

## ✅ Dashboards Criados

### 1. **Leaf - Redis Metrics** (`leaf-redis.json`)
Dashboard completo para monitoramento de Redis com:
- **Operações por segundo** (por tipo de operação)
- **Taxa de erros** (por operação)
- **Latência** (P50, P95, P99)
- **Taxa de sucesso** (gauge)
- **Operações por tipo** (bar gauge)
- **Estatísticas** (erros totais, latência média, taxa de erro)

### 2. **Leaf - System Metrics** (`leaf-system.json`)
Dashboard completo para monitoramento do sistema com:
- **CPU Usage** (User + System)
- **Memory Usage** (Resident + Heap)
- **WebSocket Connections** (conexões ativas)
- **System Uptime** (tempo online)
- **Request Throughput** (requests/segundo)
- **Estatísticas** (CPU %, Memory MB, Connections, Uptime)
- **Heap Memory Usage** (gráfico)
- **Event Backlog** (eventos pendentes)
- **Active Workers** (workers ativos)
- **Node.js Event Loop Lag** (lag do event loop)

---

## 📁 Localização

Os dashboards estão em:
```
observability/grafana/dashboards/
├── leaf-redis.json
└── leaf-system.json
```

---

## 🚀 Como Importar no Grafana

### Opção 1: Importação Manual (Recomendado)

1. Acesse o Grafana: `http://localhost:3000` (ou sua URL)
2. Vá em **Dashboards** → **Import**
3. Clique em **Upload JSON file**
4. Selecione o arquivo:
   - `observability/grafana/dashboards/leaf-redis.json`
   - `observability/grafana/dashboards/leaf-system.json`
5. Clique em **Load**
6. Selecione o datasource **Prometheus**
7. Clique em **Import**

### Opção 2: Provisionamento Automático

Se você estiver usando Docker Compose, os dashboards serão carregados automaticamente se o diretório estiver montado corretamente.

Verifique o arquivo `observability/grafana/provisioning/dashboards/dashboards.yml`:

```yaml
apiVersion: 1

providers:
  - name: 'Leaf Dashboards'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: true
```

---

## 📊 Métricas Utilizadas

### Redis Dashboard
- `leaf_redis_duration_seconds_count` - Contador de operações
- `leaf_redis_duration_seconds_bucket` - Histograma para latência
- `leaf_redis_errors_total` - Contador de erros
- `leaf_redis_duration_seconds_sum` - Soma de latências

### System Dashboard
- `process_cpu_user_seconds_total` - CPU user time
- `process_cpu_system_seconds_total` - CPU system time
- `process_resident_memory_bytes` - Memória residente
- `process_heap_bytes` - Heap memory
- `process_uptime_seconds` - Uptime do processo
- `leaf_websocket_connections_total` - Conexões WebSocket (se disponível)
- `leaf_event_backlog` - Backlog de eventos
- `leaf_workers_active` - Workers ativos
- `nodejs_eventloop_lag_seconds` - Lag do event loop (se disponível)

---

## ⚙️ Configuração

### Datasource Prometheus

Certifique-se de que o Prometheus está configurado como datasource no Grafana:

1. Vá em **Configuration** → **Data Sources**
2. Adicione **Prometheus** se não existir
3. URL: `http://prometheus:9090` (ou `http://localhost:9090` em local)
4. Clique em **Save & Test**

### Scrape Config

O Prometheus precisa estar coletando métricas do backend:

```yaml
scrape_configs:
  - job_name: 'leaf-websocket'
    static_configs:
      - targets: ['localhost:3001']  # Ajuste conforme necessário
    metrics_path: '/api/metrics/prometheus'
    scrape_interval: 5s
```

---

## 🎨 Personalização

Os dashboards podem ser personalizados diretamente no Grafana após a importação:

1. Abra o dashboard
2. Clique no ícone de **engrenagem** (⚙️) no topo
3. Selecione **Settings**
4. Faça suas alterações
5. Clique em **Save**

---

## 🔗 Links Úteis

- **Grafana UI:** `http://localhost:3000`
- **Prometheus UI:** `http://localhost:9090`
- **Backend Metrics:** `http://localhost:3001/api/metrics/prometheus`

---

## 📝 Notas

- Os dashboards usam **refresh automático de 30 segundos**
- O período padrão é **última 1 hora** (`now-1h` até `now`)
- Todos os painéis têm **thresholds configurados** para alertas visuais
- As métricas de WebSocket podem não estar disponíveis se não foram implementadas ainda

---

**Última atualização:** 2026-01-08

