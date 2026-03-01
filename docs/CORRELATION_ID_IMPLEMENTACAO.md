# 🎯 CorrelationId + TraceId - Implementação

## ✅ O Que Foi Implementado

### 1. CorrelationId
- ✅ Gerado automaticamente usando `bookingId` ou `rideId`
- ✅ Passado através de todos os spans (socket → command → event → listener)
- ✅ Serializado no evento (metadata)
- ✅ Incluído nos logs

### 2. TraceId
- ✅ Gerado automaticamente pelo OpenTelemetry
- ✅ Herdado através dos spans (parent-child)
- ✅ Linkado nos listeners (não parent, mas link)

### 3. Integração
- ✅ CorrelationId adicionado como atributo em todos os spans
- ✅ Metadata do evento contém: `correlationId`, `traceId`, `spanId`
- ✅ Listeners usam links (não parent) para manter causalidade

## 📋 Padrão de Implementação

### Socket Handler
```javascript
// ✅ Gerar correlationId (negócio)
const correlationId = data.bookingId || `ride_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// ✅ Criar span com correlationId
const socketSpan = createSocketSpan(tracer, 'createBooking', {
    'correlation.id': correlationId,
    'booking.id': data.bookingId
});
```

### Command
```javascript
// ✅ Passar correlationId para o command
const command = new RequestRideCommand({
    ...data,
    correlationId // ✅ Adicionar correlationId
});

// ✅ Span herda correlationId automaticamente
const commandSpan = createCommandSpan(tracer, 'request_ride', activeSpan, {
    'correlation.id': correlationId
});
```

### Event
```javascript
// ✅ Serializar correlationId e traceId no evento
if (event.data) {
    if (!event.data.metadata) {
        event.data.metadata = {};
    }
    event.data.metadata.correlationId = correlationId;
    event.data.metadata.traceId = eventSpanContext.traceId;
    event.data.metadata.spanId = eventSpanContext.spanId;
}
```

### Listener
```javascript
// ✅ Ler correlationId e traceId do evento
const eventMetadata = event.data?.metadata || {};
const correlationId = eventMetadata.correlationId || event.data?.bookingId;
const eventTraceId = eventMetadata.traceId;

// ✅ Criar link (não parent) para o span do evento
const listenerSpan = tracer.startSpan('listener.notify_passenger', {
    links: [{
        context: {
            traceId: eventTraceId,
            spanId: eventMetadata.spanId,
            traceFlags: TraceFlags.SAMPLED
        }
    }],
    attributes: {
        'correlation.id': correlationId
    }
});
```

### Logs
```javascript
// ✅ Logs correlacionados
logStructured('info', 'notifyPassenger iniciado', {
    correlationId, // ✅ Negócio
    traceId: currentTraceId // ✅ Técnico
});
```

## 🎯 Métricas de Negócio

### KPIs Implementados
- ✅ `leaf_rides_requested_total` - Corridas solicitadas
- ✅ `leaf_rides_accepted_total` - Corridas aceitas
- ✅ `leaf_rides_cancelled_total` - Corridas canceladas
- ✅ `leaf_rides_completed_total` - Corridas concluídas
- ✅ `leaf_time_to_accept_seconds` - Tempo até aceite
- ✅ `leaf_ride_total_duration_seconds` - Duração total da corrida
- ✅ `leaf_event_backlog` - Backlog de eventos
- ✅ `leaf_workers_active` - Workers ativos

### Labels Controlados
- ✅ `city` - Cidade (não rideId!)
- ✅ `service_type` - Tipo de serviço
- ✅ `reason` - Motivo de cancelamento

## 📊 Dashboards Criados

1. **Dashboard Executivo** (`leaf-executivo.json`)
   - Corridas/min
   - Taxa de aceitação
   - Taxa de cancelamento
   - Tempo até aceite

2. **Dashboard Operacional** (`leaf-operacional.json`)
   - P95 por command
   - Backlog de eventos
   - Falhas por serviço
   - Latência notifyDrivers

3. **Dashboard Incidentes** (`leaf-incidentes.json`)
   - Circuit breaker status
   - Retry count
   - Latência Redis
   - Command failures

## 🔍 Como Buscar

### No Grafana (Traces)
```
{resource.service.name="leaf-websocket-backend"} | json correlation.id="SEU_BOOKING_ID"
```

### Nos Logs
```
grep "correlationId: SEU_BOOKING_ID" logs/
```

## ✅ Status

- ✅ CorrelationId implementado
- ✅ TraceId integrado
- ✅ Métricas de negócio criadas
- ✅ Dashboards atualizados
- ⏳ Integração automática de métricas (estrutura pronta)



## ✅ O Que Foi Implementado

### 1. CorrelationId
- ✅ Gerado automaticamente usando `bookingId` ou `rideId`
- ✅ Passado através de todos os spans (socket → command → event → listener)
- ✅ Serializado no evento (metadata)
- ✅ Incluído nos logs

### 2. TraceId
- ✅ Gerado automaticamente pelo OpenTelemetry
- ✅ Herdado através dos spans (parent-child)
- ✅ Linkado nos listeners (não parent, mas link)

### 3. Integração
- ✅ CorrelationId adicionado como atributo em todos os spans
- ✅ Metadata do evento contém: `correlationId`, `traceId`, `spanId`
- ✅ Listeners usam links (não parent) para manter causalidade

## 📋 Padrão de Implementação

### Socket Handler
```javascript
// ✅ Gerar correlationId (negócio)
const correlationId = data.bookingId || `ride_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

// ✅ Criar span com correlationId
const socketSpan = createSocketSpan(tracer, 'createBooking', {
    'correlation.id': correlationId,
    'booking.id': data.bookingId
});
```

### Command
```javascript
// ✅ Passar correlationId para o command
const command = new RequestRideCommand({
    ...data,
    correlationId // ✅ Adicionar correlationId
});

// ✅ Span herda correlationId automaticamente
const commandSpan = createCommandSpan(tracer, 'request_ride', activeSpan, {
    'correlation.id': correlationId
});
```

### Event
```javascript
// ✅ Serializar correlationId e traceId no evento
if (event.data) {
    if (!event.data.metadata) {
        event.data.metadata = {};
    }
    event.data.metadata.correlationId = correlationId;
    event.data.metadata.traceId = eventSpanContext.traceId;
    event.data.metadata.spanId = eventSpanContext.spanId;
}
```

### Listener
```javascript
// ✅ Ler correlationId e traceId do evento
const eventMetadata = event.data?.metadata || {};
const correlationId = eventMetadata.correlationId || event.data?.bookingId;
const eventTraceId = eventMetadata.traceId;

// ✅ Criar link (não parent) para o span do evento
const listenerSpan = tracer.startSpan('listener.notify_passenger', {
    links: [{
        context: {
            traceId: eventTraceId,
            spanId: eventMetadata.spanId,
            traceFlags: TraceFlags.SAMPLED
        }
    }],
    attributes: {
        'correlation.id': correlationId
    }
});
```

### Logs
```javascript
// ✅ Logs correlacionados
logStructured('info', 'notifyPassenger iniciado', {
    correlationId, // ✅ Negócio
    traceId: currentTraceId // ✅ Técnico
});
```

## 🎯 Métricas de Negócio

### KPIs Implementados
- ✅ `leaf_rides_requested_total` - Corridas solicitadas
- ✅ `leaf_rides_accepted_total` - Corridas aceitas
- ✅ `leaf_rides_cancelled_total` - Corridas canceladas
- ✅ `leaf_rides_completed_total` - Corridas concluídas
- ✅ `leaf_time_to_accept_seconds` - Tempo até aceite
- ✅ `leaf_ride_total_duration_seconds` - Duração total da corrida
- ✅ `leaf_event_backlog` - Backlog de eventos
- ✅ `leaf_workers_active` - Workers ativos

### Labels Controlados
- ✅ `city` - Cidade (não rideId!)
- ✅ `service_type` - Tipo de serviço
- ✅ `reason` - Motivo de cancelamento

## 📊 Dashboards Criados

1. **Dashboard Executivo** (`leaf-executivo.json`)
   - Corridas/min
   - Taxa de aceitação
   - Taxa de cancelamento
   - Tempo até aceite

2. **Dashboard Operacional** (`leaf-operacional.json`)
   - P95 por command
   - Backlog de eventos
   - Falhas por serviço
   - Latência notifyDrivers

3. **Dashboard Incidentes** (`leaf-incidentes.json`)
   - Circuit breaker status
   - Retry count
   - Latência Redis
   - Command failures

## 🔍 Como Buscar

### No Grafana (Traces)
```
{resource.service.name="leaf-websocket-backend"} | json correlation.id="SEU_BOOKING_ID"
```

### Nos Logs
```
grep "correlationId: SEU_BOOKING_ID" logs/
```

## ✅ Status

- ✅ CorrelationId implementado
- ✅ TraceId integrado
- ✅ Métricas de negócio criadas
- ✅ Dashboards atualizados
- ⏳ Integração automática de métricas (estrutura pronta)




