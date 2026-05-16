# 🧪 Guia de Teste Local - Observabilidade

Este documento descreve como configurar e testar toda a stack de observabilidade localmente.

## 📋 Pré-requisitos

- Docker e Docker Compose instalados
- Node.js 18+ instalado
- Backend rodando na porta 3001

## 🚀 Passo a Passo

### 1. Iniciar Stack de Observabilidade

```bash
cd /home/izaak-dias/Downloads/leaf-project
docker-compose -f docker-compose.observability.yml up -d
```

Isso inicia:
- **Tempo** (porta 3200): Storage de traces OpenTelemetry
- **Prometheus** (porta 9090): Coleta de métricas
- **Grafana** (porta 3000): Visualização (admin/admin)

### 2. Verificar Status dos Serviços

```bash
# Verificar containers
docker-compose -f docker-compose.observability.yml ps

# Verificar logs
docker-compose -f docker-compose.observability.yml logs -f

# Testar endpoints
curl http://localhost:3200/ready  # Tempo
curl http://localhost:9090/-/healthy  # Prometheus
curl http://localhost:3000/api/health  # Grafana
```

### 3. Iniciar Backend

```bash
cd leaf-websocket-backend
npm install  # Se necessário
npm start
```

O backend deve:
- Inicializar OpenTelemetry e conectar ao Tempo (localhost:4318)
- Expor endpoint `/metrics` na porta 3001
- Gerar traces para operações críticas

### 4. Executar Script de Teste

```bash
cd /home/izaak-dias/Downloads/leaf-project
node scripts/test-local-observability.js
```

Este script verifica:
- ✅ Serviços Docker rodando
- ✅ Tempo acessível
- ✅ Prometheus coletando métricas
- ✅ Grafana funcionando
- ✅ Backend expondo métricas

### 5. Gerar Tráfego de Teste

Para ver métricas e traces aparecendo:

```bash
# Testar endpoint de métricas
curl http://localhost:3001/metrics

# Fazer algumas requisições WebSocket (usar cliente de teste)
# Ou usar scripts de teste existentes
```

### 6. Acessar Dashboards

1. **Grafana**: http://localhost:3000
   - Login: `admin` / `admin`
   - Dashboards disponíveis:
     - Leaf - Executivo (KPIs de negócio)
     - Leaf - Operacional (performance)
     - Leaf - Incidentes (resiliência)
     - Leaf - Commands
     - Leaf - Events & Listeners
     - Leaf - Circuit Breakers

2. **Prometheus**: http://localhost:9090
   - Query: `leaf_commands_total`
   - Query: `leaf_rides_requested_total`
   - Ver targets em: Status > Targets

3. **Tempo**: http://localhost:3200
   - Ver traces em: Grafana > Explore > Tempo

## 🔧 Configurações Importantes

### Prometheus

O Prometheus está configurado para fazer scrape do backend em `localhost:3001/metrics`.

**Nota**: No Linux, o Prometheus usa `network_mode: host` para acessar o host. Se isso não funcionar, você pode:

1. Usar o IP do gateway Docker:
   ```yaml
   targets: ['172.17.0.1:3001']
   ```

2. Ou adicionar `extra_hosts` no docker-compose:
   ```yaml
   extra_hosts:
     - "host.docker.internal:host-gateway"
   ```

### OpenTelemetry

O backend está configurado para enviar traces para:
- Endpoint: `http://localhost:4318/v1/traces`
- Configurado em: `leaf-websocket-backend/utils/tracer.js`

Variáveis de ambiente opcionais:
```bash
export TEMPO_ENDPOINT=http://localhost:4318
export OTEL_SAMPLING_RATE=1.0  # 100% em dev
```

## 🐛 Troubleshooting

### Prometheus não consegue fazer scrape

1. Verificar se o backend está rodando:
   ```bash
   curl http://localhost:3001/metrics
   ```

2. Verificar logs do Prometheus:
   ```bash
   docker-compose -f docker-compose.observability.yml logs prometheus
   ```

3. Verificar targets no Prometheus:
   - Acesse http://localhost:9090/targets
   - Veja se o target está "UP" ou "DOWN"

### Grafana não carrega dashboards

1. Verificar se os dashboards estão no volume:
   ```bash
   ls -la observability/grafana/dashboards/
   ```

2. Verificar logs do Grafana:
   ```bash
   docker-compose -f docker-compose.observability.yml logs grafana
   ```

3. Verificar provisioning:
   ```bash
   cat observability/grafana/provisioning/dashboards/dashboards.yml
   ```

### Traces não aparecem no Tempo

1. Verificar se o backend está enviando traces:
   - Verificar logs do backend para mensagens de OpenTelemetry
   - Verificar se há erros de conexão

2. Testar endpoint do Tempo:
   ```bash
   curl http://localhost:4318/v1/traces -X POST -H "Content-Type: application/json" -d '[]'
   ```

3. Verificar logs do Tempo:
   ```bash
   docker-compose -f docker-compose.observability.yml logs tempo
   ```

## ✅ Checklist de Validação

- [ ] Todos os containers Docker estão rodando
- [ ] Backend está rodando e expondo `/metrics`
- [ ] Prometheus consegue fazer scrape do backend
- [ ] Grafana está acessível e mostra dashboards
- [ ] Tempo está recebendo traces
- [ ] Métricas aparecem no Prometheus
- [ ] Traces aparecem no Grafana (via Tempo)

## 📚 Próximos Passos

1. Gerar tráfego real para popular métricas
2. Configurar alertas no Grafana
3. Adicionar mais métricas de negócio
4. Configurar retenção de dados no Tempo
5. Adicionar Loki para logs (opcional)


Este documento descreve como configurar e testar toda a stack de observabilidade localmente.

## 📋 Pré-requisitos

- Docker e Docker Compose instalados
- Node.js 18+ instalado
- Backend rodando na porta 3001

## 🚀 Passo a Passo

### 1. Iniciar Stack de Observabilidade

```bash
cd /home/izaak-dias/Downloads/leaf-project
docker-compose -f docker-compose.observability.yml up -d
```

Isso inicia:
- **Tempo** (porta 3200): Storage de traces OpenTelemetry
- **Prometheus** (porta 9090): Coleta de métricas
- **Grafana** (porta 3000): Visualização (admin/admin)

### 2. Verificar Status dos Serviços

```bash
# Verificar containers
docker-compose -f docker-compose.observability.yml ps

# Verificar logs
docker-compose -f docker-compose.observability.yml logs -f

# Testar endpoints
curl http://localhost:3200/ready  # Tempo
curl http://localhost:9090/-/healthy  # Prometheus
curl http://localhost:3000/api/health  # Grafana
```

### 3. Iniciar Backend

```bash
cd leaf-websocket-backend
npm install  # Se necessário
npm start
```

O backend deve:
- Inicializar OpenTelemetry e conectar ao Tempo (localhost:4318)
- Expor endpoint `/metrics` na porta 3001
- Gerar traces para operações críticas

### 4. Executar Script de Teste

```bash
cd /home/izaak-dias/Downloads/leaf-project
node scripts/test-local-observability.js
```

Este script verifica:
- ✅ Serviços Docker rodando
- ✅ Tempo acessível
- ✅ Prometheus coletando métricas
- ✅ Grafana funcionando
- ✅ Backend expondo métricas

### 5. Gerar Tráfego de Teste

Para ver métricas e traces aparecendo:

```bash
# Testar endpoint de métricas
curl http://localhost:3001/metrics

# Fazer algumas requisições WebSocket (usar cliente de teste)
# Ou usar scripts de teste existentes
```

### 6. Acessar Dashboards

1. **Grafana**: http://localhost:3000
   - Login: `admin` / `admin`
   - Dashboards disponíveis:
     - Leaf - Executivo (KPIs de negócio)
     - Leaf - Operacional (performance)
     - Leaf - Incidentes (resiliência)
     - Leaf - Commands
     - Leaf - Events & Listeners
     - Leaf - Circuit Breakers

2. **Prometheus**: http://localhost:9090
   - Query: `leaf_commands_total`
   - Query: `leaf_rides_requested_total`
   - Ver targets em: Status > Targets

3. **Tempo**: http://localhost:3200
   - Ver traces em: Grafana > Explore > Tempo

## 🔧 Configurações Importantes

### Prometheus

O Prometheus está configurado para fazer scrape do backend em `localhost:3001/metrics`.

**Nota**: No Linux, o Prometheus usa `network_mode: host` para acessar o host. Se isso não funcionar, você pode:

1. Usar o IP do gateway Docker:
   ```yaml
   targets: ['172.17.0.1:3001']
   ```

2. Ou adicionar `extra_hosts` no docker-compose:
   ```yaml
   extra_hosts:
     - "host.docker.internal:host-gateway"
   ```

### OpenTelemetry

O backend está configurado para enviar traces para:
- Endpoint: `http://localhost:4318/v1/traces`
- Configurado em: `leaf-websocket-backend/utils/tracer.js`

Variáveis de ambiente opcionais:
```bash
export TEMPO_ENDPOINT=http://localhost:4318
export OTEL_SAMPLING_RATE=1.0  # 100% em dev
```

## 🐛 Troubleshooting

### Prometheus não consegue fazer scrape

1. Verificar se o backend está rodando:
   ```bash
   curl http://localhost:3001/metrics
   ```

2. Verificar logs do Prometheus:
   ```bash
   docker-compose -f docker-compose.observability.yml logs prometheus
   ```

3. Verificar targets no Prometheus:
   - Acesse http://localhost:9090/targets
   - Veja se o target está "UP" ou "DOWN"

### Grafana não carrega dashboards

1. Verificar se os dashboards estão no volume:
   ```bash
   ls -la observability/grafana/dashboards/
   ```

2. Verificar logs do Grafana:
   ```bash
   docker-compose -f docker-compose.observability.yml logs grafana
   ```

3. Verificar provisioning:
   ```bash
   cat observability/grafana/provisioning/dashboards/dashboards.yml
   ```

### Traces não aparecem no Tempo

1. Verificar se o backend está enviando traces:
   - Verificar logs do backend para mensagens de OpenTelemetry
   - Verificar se há erros de conexão

2. Testar endpoint do Tempo:
   ```bash
   curl http://localhost:4318/v1/traces -X POST -H "Content-Type: application/json" -d '[]'
   ```

3. Verificar logs do Tempo:
   ```bash
   docker-compose -f docker-compose.observability.yml logs tempo
   ```

## ✅ Checklist de Validação

- [ ] Todos os containers Docker estão rodando
- [ ] Backend está rodando e expondo `/metrics`
- [ ] Prometheus consegue fazer scrape do backend
- [ ] Grafana está acessível e mostra dashboards
- [ ] Tempo está recebendo traces
- [ ] Métricas aparecem no Prometheus
- [ ] Traces aparecem no Grafana (via Tempo)

## 📚 Próximos Passos

1. Gerar tráfego real para popular métricas
2. Configurar alertas no Grafana
3. Adicionar mais métricas de negócio
4. Configurar retenção de dados no Tempo
5. Adicionar Loki para logs (opcional)



