# 🎯 Implementação OpenTelemetry - Leaf Backend

## ✅ Status Atual

### Instalação
- ✅ Pacotes instalados: `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-jaeger`
- ✅ Utils criados: `utils/tracer.js`, `utils/span-helpers.js`
- ✅ Inicialização no `server.js`

### Implementação Parcial
- ✅ Span para Command `request_ride` (exemplo)
- ⏳ Span para Event publish (em progresso)
- ⏳ Spans para Listeners (pendente)
- ⏳ Spans para outros Commands (pendente)
- ⏳ Spans para Circuit Breakers (pendente)

## 📋 Padrão de Implementação

### 1. Socket Handler (Root Span)

```javascript
const tracer = getTracer();
const socketSpan = createSocketSpan(tracer, 'createBooking', {
    'user.id': socket.userId,
    'user.type': socket.userType
});

await runInSpan(socketSpan, async () => {
    // ... código do handler
});
```

### 2. Command Span

```javascript
const commandSpan = createCommandSpan(tracer, 'request_ride', activeSpan, {
    'command.customer_id': customerId
});

const result = await runInSpan(commandSpan, async () => {
    return await command.execute();
});
```

### 3. Event Publish Span

```javascript
const eventSpan = createEventSpan(tracer, 'ride.requested', activeSpan, {
    'event.booking_id': bookingId
});

await runInSpan(eventSpan, async () => {
    await eventBus.publish({ eventType: 'ride.requested', data: event });
});

// Salvar contexto para linkar com listeners
event._otelSpanContext = eventSpan.spanContext();
```

### 4. Listener Span

```javascript
const { getTracer } = require('../utils/tracer');
const { createListenerSpan, runInSpan, endSpanSuccess, endSpanError } = require('../utils/span-helpers');

async function notifyPassenger(event, io) {
    const tracer = getTracer();
    const eventSpanContext = event._otelSpanContext;
    
    const listenerSpan = createListenerSpan(tracer, 'notify_passenger', eventSpanContext, {
        'listener.booking_id': event.data.bookingId
    });
    
    try {
        await runInSpan(listenerSpan, async () => {
            // ... código do listener
        });
    } catch (error) {
        endSpanError(listenerSpan, error);
        throw error;
    }
}
```

## 🎯 Próximos Passos

1. **Completar spans em todos os handlers de socket:**
   - `createBooking` ✅ (parcial)
   - `acceptRide`
   - `startTrip`
   - `completeTrip`
   - `cancelRide`

2. **Adicionar spans em todos os Commands:**
   - `RequestRideCommand` ✅ (exemplo)
   - `AcceptRideCommand`
   - `StartTripCommand`
   - `CompleteTripCommand`
   - `CancelRideCommand`

3. **Adicionar spans em todos os Event publishes:**
   - `ride.requested` ⏳
   - `ride.accepted`
   - `ride.started`
   - `ride.completed`
   - `ride.cancelled`

4. **Adicionar spans em todos os Listeners:**
   - `notify_passenger`
   - `notify_driver`
   - `notify_drivers`
   - `send_push`
   - `start_trip_timer`

5. **Adicionar spans em Circuit Breakers:**
   - `circuit.firebase_firestore`
   - `circuit.woovi`
   - `circuit.fcm`

## 🔧 Configuração

### Variáveis de Ambiente

```bash
# Sampling rate (0.01 = 1%)
OTEL_SAMPLING_RATE=0.01

# Jaeger endpoint
JAEGER_ENDPOINT=http://localhost:14268/api/traces

# Ambiente
NODE_ENV=production
```

### Sampling por Ambiente

- **Development**: 100% (1.0)
- **Staging**: 10% (0.10)
- **Production**: 1-5% (0.01-0.05)

## 📊 Visualização

### Jaeger UI
- URL: `http://localhost:16686`
- Buscar por: `service.name=leaf-websocket-backend`

### Grafana + Tempo
- Configurar datasource Tempo
- Query: `{service_name="leaf-websocket-backend"}`

## ⚠️ Regras Importantes

### ❌ NÃO instrumentar:
- Funções utilitárias (`formatCurrency`, `calculateDistance`)
- Queries Redis individuais (agrupar em operação lógica)
- Loops/iterações (usar atributos)
- WebSocket emits individuais
- Código síncrono/determinístico
- Testes

### ✅ Instrumentar:
- Socket handlers (root spans)
- Commands (1 span cada)
- Event publishes
- Listeners (1 span cada, linkados ao evento)
- Circuit breakers (atributos)
- Operações Redis agrupadas (não granular)

## 📈 Custo Estimado

- **Volume**: ~5.000 spans/dia (com 1% sampling e 50k corridas/dia)
- **Infra**: US$ 5-10/mês (self-hosted)
- **Overhead**: +1-3ms por request (irrelevante)



## ✅ Status Atual

### Instalação
- ✅ Pacotes instalados: `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-jaeger`
- ✅ Utils criados: `utils/tracer.js`, `utils/span-helpers.js`
- ✅ Inicialização no `server.js`

### Implementação Parcial
- ✅ Span para Command `request_ride` (exemplo)
- ⏳ Span para Event publish (em progresso)
- ⏳ Spans para Listeners (pendente)
- ⏳ Spans para outros Commands (pendente)
- ⏳ Spans para Circuit Breakers (pendente)

## 📋 Padrão de Implementação

### 1. Socket Handler (Root Span)

```javascript
const tracer = getTracer();
const socketSpan = createSocketSpan(tracer, 'createBooking', {
    'user.id': socket.userId,
    'user.type': socket.userType
});

await runInSpan(socketSpan, async () => {
    // ... código do handler
});
```

### 2. Command Span

```javascript
const commandSpan = createCommandSpan(tracer, 'request_ride', activeSpan, {
    'command.customer_id': customerId
});

const result = await runInSpan(commandSpan, async () => {
    return await command.execute();
});
```

### 3. Event Publish Span

```javascript
const eventSpan = createEventSpan(tracer, 'ride.requested', activeSpan, {
    'event.booking_id': bookingId
});

await runInSpan(eventSpan, async () => {
    await eventBus.publish({ eventType: 'ride.requested', data: event });
});

// Salvar contexto para linkar com listeners
event._otelSpanContext = eventSpan.spanContext();
```

### 4. Listener Span

```javascript
const { getTracer } = require('../utils/tracer');
const { createListenerSpan, runInSpan, endSpanSuccess, endSpanError } = require('../utils/span-helpers');

async function notifyPassenger(event, io) {
    const tracer = getTracer();
    const eventSpanContext = event._otelSpanContext;
    
    const listenerSpan = createListenerSpan(tracer, 'notify_passenger', eventSpanContext, {
        'listener.booking_id': event.data.bookingId
    });
    
    try {
        await runInSpan(listenerSpan, async () => {
            // ... código do listener
        });
    } catch (error) {
        endSpanError(listenerSpan, error);
        throw error;
    }
}
```

## 🎯 Próximos Passos

1. **Completar spans em todos os handlers de socket:**
   - `createBooking` ✅ (parcial)
   - `acceptRide`
   - `startTrip`
   - `completeTrip`
   - `cancelRide`

2. **Adicionar spans em todos os Commands:**
   - `RequestRideCommand` ✅ (exemplo)
   - `AcceptRideCommand`
   - `StartTripCommand`
   - `CompleteTripCommand`
   - `CancelRideCommand`

3. **Adicionar spans em todos os Event publishes:**
   - `ride.requested` ⏳
   - `ride.accepted`
   - `ride.started`
   - `ride.completed`
   - `ride.cancelled`

4. **Adicionar spans em todos os Listeners:**
   - `notify_passenger`
   - `notify_driver`
   - `notify_drivers`
   - `send_push`
   - `start_trip_timer`

5. **Adicionar spans em Circuit Breakers:**
   - `circuit.firebase_firestore`
   - `circuit.woovi`
   - `circuit.fcm`

## 🔧 Configuração

### Variáveis de Ambiente

```bash
# Sampling rate (0.01 = 1%)
OTEL_SAMPLING_RATE=0.01

# Jaeger endpoint
JAEGER_ENDPOINT=http://localhost:14268/api/traces

# Ambiente
NODE_ENV=production
```

### Sampling por Ambiente

- **Development**: 100% (1.0)
- **Staging**: 10% (0.10)
- **Production**: 1-5% (0.01-0.05)

## 📊 Visualização

### Jaeger UI
- URL: `http://localhost:16686`
- Buscar por: `service.name=leaf-websocket-backend`

### Grafana + Tempo
- Configurar datasource Tempo
- Query: `{service_name="leaf-websocket-backend"}`

## ⚠️ Regras Importantes

### ❌ NÃO instrumentar:
- Funções utilitárias (`formatCurrency`, `calculateDistance`)
- Queries Redis individuais (agrupar em operação lógica)
- Loops/iterações (usar atributos)
- WebSocket emits individuais
- Código síncrono/determinístico
- Testes

### ✅ Instrumentar:
- Socket handlers (root spans)
- Commands (1 span cada)
- Event publishes
- Listeners (1 span cada, linkados ao evento)
- Circuit breakers (atributos)
- Operações Redis agrupadas (não granular)

## 📈 Custo Estimado

- **Volume**: ~5.000 spans/dia (com 1% sampling e 50k corridas/dia)
- **Infra**: US$ 5-10/mês (self-hosted)
- **Overhead**: +1-3ms por request (irrelevante)




