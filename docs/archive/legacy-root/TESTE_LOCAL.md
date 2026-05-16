# 🧪 Guia de Teste Local - Observabilidade

## ✅ Pré-requisitos Verificados

- ✅ Node.js instalado
- ✅ Dependências instaladas (`prom-client`, `@opentelemetry/*`)
- ✅ Código sem erros de sintaxe
- ✅ Métricas configuradas
- ✅ Tracer configurado

## 🚀 Passo 1: Iniciar Backend

```bash
cd leaf-websocket-backend
npm start
```

O servidor deve iniciar na porta `3001`.

## 🧪 Passo 2: Testar Endpoint de Métricas

Em outro terminal:

```bash
curl http://localhost:3001/metrics
```

Você deve ver métricas no formato Prometheus, incluindo:
- `leaf_rides_requested_total`
- `leaf_rides_accepted_total`
- `leaf_commands_duration_seconds`
- `leaf_events_published_total`
- etc.

## 🐳 Passo 3: Iniciar Infraestrutura de Observabilidade

```bash
cd /home/izaak-dias/Downloads/leaf-project
docker-compose -f docker-compose.observability.yml up -d
```

Isso vai iniciar:
- **Tempo** (porta 3200) - Armazenamento de traces
- **Grafana** (porta 3000) - Dashboards
- **Prometheus** (porta 9090) - Coleta de métricas

## 📊 Passo 4: Acessar Dashboards

1. **Grafana**: http://localhost:3000
   - Login: `admin` / Senha: `admin` (primeira vez)
   - Dashboards já estão provisionados automaticamente

2. **Prometheus**: http://localhost:9090
   - Verificar se está coletando métricas de `http://host.docker.internal:3001/metrics`

3. **Tempo**: http://localhost:3200
   - Interface de busca de traces

## 🧪 Passo 5: Gerar Tráfego de Teste

### Opção 1: Via WebSocket (cliente real)
Conectar um cliente WebSocket e:
1. Criar um booking (`createBooking`)
2. Aceitar uma corrida (`acceptRide`)

### Opção 2: Via Script de Teste
```bash
cd leaf-websocket-backend
node -e "
const io = require('socket.io-client');
const socket = io('http://localhost:3001');

socket.on('connect', () => {
  console.log('✅ Conectado');
  
  // Criar booking
  socket.emit('createBooking', {
    customerId: 'test-customer-123',
    pickupLocation: { lat: -23.5505, lng: -46.6333 },
    destinationLocation: { lat: -23.5515, lng: -46.6343 },
    city: 'sao-paulo'
  });
  
  socket.on('bookingCreated', (data) => {
    console.log('✅ Booking criado:', data.bookingId);
    console.log('CorrelationId:', data.correlationId);
    console.log('TraceId:', data.traceId);
  });
  
  setTimeout(() => process.exit(0), 2000);
});
"
```

## ✅ Verificações Esperadas

### 1. Métricas no Prometheus
- Acessar http://localhost:9090
- Buscar por `leaf_rides_requested_total`
- Deve mostrar contador incrementado

### 2. Traces no Tempo
- Acessar http://localhost:3200
- Buscar por `correlationId` ou `bookingId`
- Deve mostrar trace completo com spans

### 3. Dashboards no Grafana
- Acessar http://localhost:3000
- Navegar para "Dashboards" → "Leaf"
- Verificar:
  - Dashboard Executivo: KPIs de negócio
  - Dashboard Operacional: Performance
  - Dashboard Commands: Latência de commands

## 🔍 Debug

### Verificar se métricas estão sendo coletadas
```bash
curl http://localhost:3001/metrics | grep leaf_rides
```

### Verificar logs do backend
```bash
tail -f leaf-websocket-backend/logs/leaf-server.log | grep -E "correlationId|traceId"
```

### Verificar containers Docker
```bash
docker-compose -f docker-compose.observability.yml ps
docker-compose -f docker-compose.observability.yml logs -f
```

## ⚠️ Problemas Comuns

### 1. Métricas não aparecem
- Verificar se `prom-client` está instalado: `npm list prom-client`
- Verificar se endpoint `/metrics` está acessível
- Verificar logs do backend

### 2. Traces não aparecem
- Verificar se OTel está inicializado: `grep initializeTracer server.js`
- Verificar se Tempo está rodando: `docker ps | grep tempo`
- Verificar variáveis de ambiente (OTEL_EXPORTER_OTLP_ENDPOINT)

### 3. Grafana não mostra dados
- Verificar data sources: Grafana → Configuration → Data Sources
- Verificar se Prometheus está coletando: http://localhost:9090/targets
- Verificar se dashboards foram importados: Grafana → Dashboards

## ✅ Checklist de Teste

- [ ] Backend inicia sem erros
- [ ] Endpoint `/metrics` retorna dados
- [ ] Containers Docker estão rodando
- [ ] Prometheus está coletando métricas
- [ ] Grafana mostra dashboards
- [ ] Traces aparecem no Tempo
- [ ] CorrelationId aparece nos logs
- [ ] Métricas incrementam ao gerar tráfego

## 🎯 Próximos Passos

Após validar localmente:
1. Testar com carga (múltiplas requisições)
2. Validar alertas
3. Testar circuit breakers
4. Preparar para deploy em VPS



## ✅ Pré-requisitos Verificados

- ✅ Node.js instalado
- ✅ Dependências instaladas (`prom-client`, `@opentelemetry/*`)
- ✅ Código sem erros de sintaxe
- ✅ Métricas configuradas
- ✅ Tracer configurado

## 🚀 Passo 1: Iniciar Backend

```bash
cd leaf-websocket-backend
npm start
```

O servidor deve iniciar na porta `3001`.

## 🧪 Passo 2: Testar Endpoint de Métricas

Em outro terminal:

```bash
curl http://localhost:3001/metrics
```

Você deve ver métricas no formato Prometheus, incluindo:
- `leaf_rides_requested_total`
- `leaf_rides_accepted_total`
- `leaf_commands_duration_seconds`
- `leaf_events_published_total`
- etc.

## 🐳 Passo 3: Iniciar Infraestrutura de Observabilidade

```bash
cd /home/izaak-dias/Downloads/leaf-project
docker-compose -f docker-compose.observability.yml up -d
```

Isso vai iniciar:
- **Tempo** (porta 3200) - Armazenamento de traces
- **Grafana** (porta 3000) - Dashboards
- **Prometheus** (porta 9090) - Coleta de métricas

## 📊 Passo 4: Acessar Dashboards

1. **Grafana**: http://localhost:3000
   - Login: `admin` / Senha: `admin` (primeira vez)
   - Dashboards já estão provisionados automaticamente

2. **Prometheus**: http://localhost:9090
   - Verificar se está coletando métricas de `http://host.docker.internal:3001/metrics`

3. **Tempo**: http://localhost:3200
   - Interface de busca de traces

## 🧪 Passo 5: Gerar Tráfego de Teste

### Opção 1: Via WebSocket (cliente real)
Conectar um cliente WebSocket e:
1. Criar um booking (`createBooking`)
2. Aceitar uma corrida (`acceptRide`)

### Opção 2: Via Script de Teste
```bash
cd leaf-websocket-backend
node -e "
const io = require('socket.io-client');
const socket = io('http://localhost:3001');

socket.on('connect', () => {
  console.log('✅ Conectado');
  
  // Criar booking
  socket.emit('createBooking', {
    customerId: 'test-customer-123',
    pickupLocation: { lat: -23.5505, lng: -46.6333 },
    destinationLocation: { lat: -23.5515, lng: -46.6343 },
    city: 'sao-paulo'
  });
  
  socket.on('bookingCreated', (data) => {
    console.log('✅ Booking criado:', data.bookingId);
    console.log('CorrelationId:', data.correlationId);
    console.log('TraceId:', data.traceId);
  });
  
  setTimeout(() => process.exit(0), 2000);
});
"
```

## ✅ Verificações Esperadas

### 1. Métricas no Prometheus
- Acessar http://localhost:9090
- Buscar por `leaf_rides_requested_total`
- Deve mostrar contador incrementado

### 2. Traces no Tempo
- Acessar http://localhost:3200
- Buscar por `correlationId` ou `bookingId`
- Deve mostrar trace completo com spans

### 3. Dashboards no Grafana
- Acessar http://localhost:3000
- Navegar para "Dashboards" → "Leaf"
- Verificar:
  - Dashboard Executivo: KPIs de negócio
  - Dashboard Operacional: Performance
  - Dashboard Commands: Latência de commands

## 🔍 Debug

### Verificar se métricas estão sendo coletadas
```bash
curl http://localhost:3001/metrics | grep leaf_rides
```

### Verificar logs do backend
```bash
tail -f leaf-websocket-backend/logs/leaf-server.log | grep -E "correlationId|traceId"
```

### Verificar containers Docker
```bash
docker-compose -f docker-compose.observability.yml ps
docker-compose -f docker-compose.observability.yml logs -f
```

## ⚠️ Problemas Comuns

### 1. Métricas não aparecem
- Verificar se `prom-client` está instalado: `npm list prom-client`
- Verificar se endpoint `/metrics` está acessível
- Verificar logs do backend

### 2. Traces não aparecem
- Verificar se OTel está inicializado: `grep initializeTracer server.js`
- Verificar se Tempo está rodando: `docker ps | grep tempo`
- Verificar variáveis de ambiente (OTEL_EXPORTER_OTLP_ENDPOINT)

### 3. Grafana não mostra dados
- Verificar data sources: Grafana → Configuration → Data Sources
- Verificar se Prometheus está coletando: http://localhost:9090/targets
- Verificar se dashboards foram importados: Grafana → Dashboards

## ✅ Checklist de Teste

- [ ] Backend inicia sem erros
- [ ] Endpoint `/metrics` retorna dados
- [ ] Containers Docker estão rodando
- [ ] Prometheus está coletando métricas
- [ ] Grafana mostra dashboards
- [ ] Traces aparecem no Tempo
- [ ] CorrelationId aparece nos logs
- [ ] Métricas incrementam ao gerar tráfego

## 🎯 Próximos Passos

Após validar localmente:
1. Testar com carga (múltiplas requisições)
2. Validar alertas
3. Testar circuit breakers
4. Preparar para deploy em VPS




