# 🎯 Grafana + Tempo - Setup Completo

## ✅ O Que Foi Implementado

### 1. Infraestrutura Docker
- ✅ `docker-compose.observability.yml` - Stack completa (Tempo + Grafana + Prometheus)
- ✅ Configuração do Tempo (`tempo-config.yaml`)
- ✅ Data source automático no Grafana
- ✅ Configuração do Prometheus (para depois)

### 2. Backend
- ✅ Tracer modificado para usar OTLP exporter (ao invés de Jaeger)
- ✅ Exportação para Tempo via HTTP (porta 4318)
- ✅ Compatível com variáveis de ambiente padrão do OTel

### 3. Documentação
- ✅ `observability/README.md` - Guia completo de uso
- ✅ Instruções de troubleshooting
- ✅ Queries úteis para buscar traces

## 🚀 Como Usar

### Passo 1: Subir Infraestrutura

```bash
cd /home/izaak-dias/Downloads/leaf-project
docker-compose -f docker-compose.observability.yml up -d
```

### Passo 2: Verificar Serviços

- **Grafana**: http://localhost:3000 (admin/admin)
- **Tempo**: http://localhost:3200
- **Prometheus**: http://localhost:9090

### Passo 3: Iniciar Backend

```bash
cd leaf-websocket-backend
npm start
```

O backend já está configurado para exportar traces automaticamente.

### Passo 4: Visualizar Traces

1. Acessar Grafana: http://localhost:3000
2. Ir em **Explore** (ícone de bússola)
3. Selecionar datasource **Tempo**
4. Buscar traces:
   - `{resource.service.name="leaf-websocket-backend"}`
   - `{trace.id="SEU_TRACE_ID"}`
   - `{booking.id="SEU_BOOKING_ID"}`

## 📊 O Que Você Vê

### Timeline Completa de uma Corrida

```
socket.createBooking (12ms)
 └─ command.request_ride (8ms)
    ├─ redis.write (2ms)
    ├─ event.publish.ride.requested (1ms)
    └─ listener.notify_drivers (180ms) ❌
       └─ circuit.fcm (150ms) ❌
```

### Atributos por Span

- `user.id`: ID do usuário
- `user.type`: customer/driver
- `command.customer_id`: ID do cliente
- `event.booking_id`: ID da corrida
- `circuit.state`: Estado do circuit breaker
- `circuit.failure_count`: Contador de falhas

## 🔍 Queries Úteis

### Buscar por bookingId

```
{resource.service.name="leaf-websocket-backend"} | json booking_id="abc123"
```

### Filtrar por span name

```
{resource.service.name="leaf-websocket-backend"} | json span.name="command.accept_ride"
```

### Buscar erros

```
{resource.service.name="leaf-websocket-backend"} | json status.code="ERROR"
```

## 📈 Próximos Passos

1. ✅ Infraestrutura - **FEITO**
2. ✅ Exportação de traces - **FEITO**
3. ⏳ Criar dashboards essenciais:
   - Visão Executiva (corridas/min, P95, erros)
   - Fluxo de Corrida (duração por etapa)
   - Infra (Redis, Circuit Breakers)
4. ⏳ Configurar métricas (Prometheus)
5. ⏳ Configurar alertas

## 💰 Custo

- **Self-hosted**: US$ 0-10/mês (VPS pequena)
- **Overhead**: +1-3ms por request
- **Volume**: ~5.000 spans/dia (com 1% sampling)

## 🎯 Benefícios

1. **RCA Rápida**: Ver exatamente onde está o gargalo
2. **Performance**: Identificar spans lentos
3. **Erros**: Rastrear erros até a causa raiz
4. **Correlação**: Linkar traces com logs e métricas

## 📝 Notas

- Sampling de 1% em produção é suficiente
- Traces são armazenados por 1h (configurável)
- Grafana já tem data source configurado automaticamente
- Backend exporta automaticamente quando inicia



## ✅ O Que Foi Implementado

### 1. Infraestrutura Docker
- ✅ `docker-compose.observability.yml` - Stack completa (Tempo + Grafana + Prometheus)
- ✅ Configuração do Tempo (`tempo-config.yaml`)
- ✅ Data source automático no Grafana
- ✅ Configuração do Prometheus (para depois)

### 2. Backend
- ✅ Tracer modificado para usar OTLP exporter (ao invés de Jaeger)
- ✅ Exportação para Tempo via HTTP (porta 4318)
- ✅ Compatível com variáveis de ambiente padrão do OTel

### 3. Documentação
- ✅ `observability/README.md` - Guia completo de uso
- ✅ Instruções de troubleshooting
- ✅ Queries úteis para buscar traces

## 🚀 Como Usar

### Passo 1: Subir Infraestrutura

```bash
cd /home/izaak-dias/Downloads/leaf-project
docker-compose -f docker-compose.observability.yml up -d
```

### Passo 2: Verificar Serviços

- **Grafana**: http://localhost:3000 (admin/admin)
- **Tempo**: http://localhost:3200
- **Prometheus**: http://localhost:9090

### Passo 3: Iniciar Backend

```bash
cd leaf-websocket-backend
npm start
```

O backend já está configurado para exportar traces automaticamente.

### Passo 4: Visualizar Traces

1. Acessar Grafana: http://localhost:3000
2. Ir em **Explore** (ícone de bússola)
3. Selecionar datasource **Tempo**
4. Buscar traces:
   - `{resource.service.name="leaf-websocket-backend"}`
   - `{trace.id="SEU_TRACE_ID"}`
   - `{booking.id="SEU_BOOKING_ID"}`

## 📊 O Que Você Vê

### Timeline Completa de uma Corrida

```
socket.createBooking (12ms)
 └─ command.request_ride (8ms)
    ├─ redis.write (2ms)
    ├─ event.publish.ride.requested (1ms)
    └─ listener.notify_drivers (180ms) ❌
       └─ circuit.fcm (150ms) ❌
```

### Atributos por Span

- `user.id`: ID do usuário
- `user.type`: customer/driver
- `command.customer_id`: ID do cliente
- `event.booking_id`: ID da corrida
- `circuit.state`: Estado do circuit breaker
- `circuit.failure_count`: Contador de falhas

## 🔍 Queries Úteis

### Buscar por bookingId

```
{resource.service.name="leaf-websocket-backend"} | json booking_id="abc123"
```

### Filtrar por span name

```
{resource.service.name="leaf-websocket-backend"} | json span.name="command.accept_ride"
```

### Buscar erros

```
{resource.service.name="leaf-websocket-backend"} | json status.code="ERROR"
```

## 📈 Próximos Passos

1. ✅ Infraestrutura - **FEITO**
2. ✅ Exportação de traces - **FEITO**
3. ⏳ Criar dashboards essenciais:
   - Visão Executiva (corridas/min, P95, erros)
   - Fluxo de Corrida (duração por etapa)
   - Infra (Redis, Circuit Breakers)
4. ⏳ Configurar métricas (Prometheus)
5. ⏳ Configurar alertas

## 💰 Custo

- **Self-hosted**: US$ 0-10/mês (VPS pequena)
- **Overhead**: +1-3ms por request
- **Volume**: ~5.000 spans/dia (com 1% sampling)

## 🎯 Benefícios

1. **RCA Rápida**: Ver exatamente onde está o gargalo
2. **Performance**: Identificar spans lentos
3. **Erros**: Rastrear erros até a causa raiz
4. **Correlação**: Linkar traces com logs e métricas

## 📝 Notas

- Sampling de 1% em produção é suficiente
- Traces são armazenados por 1h (configurável)
- Grafana já tem data source configurado automaticamente
- Backend exporta automaticamente quando inicia




