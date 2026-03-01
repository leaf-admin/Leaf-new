# 🎯 Observabilidade - Leaf Backend

## 📋 Stack

- **Tempo**: Storage de traces (OpenTelemetry)
- **Grafana**: Visualização de traces e métricas
- **Prometheus**: Métricas (opcional, para depois)

## 🚀 Como Iniciar

### 1. Subir infraestrutura

```bash
cd /home/izaak-dias/Downloads/leaf-project
docker-compose -f docker-compose.observability.yml up -d
```

### 2. Verificar serviços

- **Grafana**: http://localhost:3000 (admin/admin)
- **Tempo**: http://localhost:3200
- **Prometheus**: http://localhost:9090

### 3. Configurar backend

O backend já está configurado para exportar traces para Tempo via OTLP.

Variáveis de ambiente (opcional):

```bash
# Endpoint do Tempo (padrão: http://localhost:4318)
TEMPO_ENDPOINT=http://localhost:4318

# Ou usar variável padrão do OTel
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Sampling (1% em produção)
OTEL_SAMPLING_RATE=0.01
```

### 4. Iniciar backend

```bash
cd leaf-websocket-backend
npm start
```

## 📊 Visualizar Traces no Grafana

### 1. Acessar Grafana

1. Abrir http://localhost:3000
2. Login: `admin` / `admin`
3. Data source "Tempo" já está configurado

### 2. Buscar Traces

1. Ir em **Explore** (ícone de bússola)
2. Selecionar datasource **Tempo**
3. Buscar por:
   - `service.name="leaf-websocket-backend"`
   - `trace.id="SEU_TRACE_ID"`
   - `booking.id="SEU_BOOKING_ID"`

### 3. Ver Timeline

- Clicar em um trace
- Ver timeline completa:
  - Socket handlers
  - Commands
  - Events
  - Listeners
  - Circuit breakers

## 🔍 Queries Úteis

### Buscar por bookingId

```
{resource.service.name="leaf-websocket-backend"} | json booking_id="SEU_BOOKING_ID"
```

### Buscar por traceId

```
{resource.service.name="leaf-websocket-backend"} | json trace.id="SEU_TRACE_ID"
```

### Filtrar por span name

```
{resource.service.name="leaf-websocket-backend"} | json span.name="command.accept_ride"
```

## 📈 Dashboards

### Dashboard 1: Visão Executiva (criar depois)

- Corridas/min
- P95 de acceptRide
- Erros/min

### Dashboard 2: Fluxo de Corrida (criar depois)

- Duração média por command
- Duração por listener
- Gargalos

### Dashboard 3: Infra (criar depois)

- Redis latency
- Circuit breaker states
- Event backlog

## 🛠 Troubleshooting

### Traces não aparecem

1. Verificar se backend está rodando
2. Verificar logs do backend: `tail -f /tmp/leaf-server.log | grep -i otel`
3. Verificar se Tempo está recebendo: `docker logs leaf-tempo`
4. Verificar endpoint: `echo $TEMPO_ENDPOINT`

### Grafana não conecta ao Tempo

1. Verificar se Tempo está rodando: `docker ps | grep tempo`
2. Verificar datasource: Grafana → Configuration → Data Sources → Tempo
3. Testar conexão: Clicar em "Save & Test"

### Performance

- Sampling de 1% em produção é suficiente
- Overhead: +1-3ms por request
- Volume estimado: ~5.000 spans/dia

## 📝 Próximos Passos

1. ✅ Infraestrutura (Tempo + Grafana) - **FEITO**
2. ✅ Exportar traces para Tempo - **FEITO**
3. ⏳ Criar dashboards essenciais
4. ⏳ Configurar métricas (Prometheus)
5. ⏳ Configurar alertas

## 🔗 Links Úteis

- [Grafana Tempo Docs](https://grafana.com/docs/tempo/latest/)
- [OpenTelemetry Node.js](https://opentelemetry.io/docs/instrumentation/js/)
- [OTLP Protocol](https://opentelemetry.io/docs/specs/otlp/)



## 📋 Stack

- **Tempo**: Storage de traces (OpenTelemetry)
- **Grafana**: Visualização de traces e métricas
- **Prometheus**: Métricas (opcional, para depois)

## 🚀 Como Iniciar

### 1. Subir infraestrutura

```bash
cd /home/izaak-dias/Downloads/leaf-project
docker-compose -f docker-compose.observability.yml up -d
```

### 2. Verificar serviços

- **Grafana**: http://localhost:3000 (admin/admin)
- **Tempo**: http://localhost:3200
- **Prometheus**: http://localhost:9090

### 3. Configurar backend

O backend já está configurado para exportar traces para Tempo via OTLP.

Variáveis de ambiente (opcional):

```bash
# Endpoint do Tempo (padrão: http://localhost:4318)
TEMPO_ENDPOINT=http://localhost:4318

# Ou usar variável padrão do OTel
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318

# Sampling (1% em produção)
OTEL_SAMPLING_RATE=0.01
```

### 4. Iniciar backend

```bash
cd leaf-websocket-backend
npm start
```

## 📊 Visualizar Traces no Grafana

### 1. Acessar Grafana

1. Abrir http://localhost:3000
2. Login: `admin` / `admin`
3. Data source "Tempo" já está configurado

### 2. Buscar Traces

1. Ir em **Explore** (ícone de bússola)
2. Selecionar datasource **Tempo**
3. Buscar por:
   - `service.name="leaf-websocket-backend"`
   - `trace.id="SEU_TRACE_ID"`
   - `booking.id="SEU_BOOKING_ID"`

### 3. Ver Timeline

- Clicar em um trace
- Ver timeline completa:
  - Socket handlers
  - Commands
  - Events
  - Listeners
  - Circuit breakers

## 🔍 Queries Úteis

### Buscar por bookingId

```
{resource.service.name="leaf-websocket-backend"} | json booking_id="SEU_BOOKING_ID"
```

### Buscar por traceId

```
{resource.service.name="leaf-websocket-backend"} | json trace.id="SEU_TRACE_ID"
```

### Filtrar por span name

```
{resource.service.name="leaf-websocket-backend"} | json span.name="command.accept_ride"
```

## 📈 Dashboards

### Dashboard 1: Visão Executiva (criar depois)

- Corridas/min
- P95 de acceptRide
- Erros/min

### Dashboard 2: Fluxo de Corrida (criar depois)

- Duração média por command
- Duração por listener
- Gargalos

### Dashboard 3: Infra (criar depois)

- Redis latency
- Circuit breaker states
- Event backlog

## 🛠 Troubleshooting

### Traces não aparecem

1. Verificar se backend está rodando
2. Verificar logs do backend: `tail -f /tmp/leaf-server.log | grep -i otel`
3. Verificar se Tempo está recebendo: `docker logs leaf-tempo`
4. Verificar endpoint: `echo $TEMPO_ENDPOINT`

### Grafana não conecta ao Tempo

1. Verificar se Tempo está rodando: `docker ps | grep tempo`
2. Verificar datasource: Grafana → Configuration → Data Sources → Tempo
3. Testar conexão: Clicar em "Save & Test"

### Performance

- Sampling de 1% em produção é suficiente
- Overhead: +1-3ms por request
- Volume estimado: ~5.000 spans/dia

## 📝 Próximos Passos

1. ✅ Infraestrutura (Tempo + Grafana) - **FEITO**
2. ✅ Exportar traces para Tempo - **FEITO**
3. ⏳ Criar dashboards essenciais
4. ⏳ Configurar métricas (Prometheus)
5. ⏳ Configurar alertas

## 🔗 Links Úteis

- [Grafana Tempo Docs](https://grafana.com/docs/tempo/latest/)
- [OpenTelemetry Node.js](https://opentelemetry.io/docs/instrumentation/js/)
- [OTLP Protocol](https://opentelemetry.io/docs/specs/otlp/)




