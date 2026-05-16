# 🎯 Resumo: Implementação OpenTelemetry - Leaf Backend

## ✅ O Que Foi Implementado

### 1. Infraestrutura Base
- ✅ **Pacotes instalados**: `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-jaeger`
- ✅ **Utils criados**:
  - `utils/tracer.js` - Configuração e inicialização do tracer
  - `utils/span-helpers.js` - Helpers para criação de spans
- ✅ **Inicialização**: Tracer inicializado no `server.js` (modo desenvolvimento)

### 2. Exemplos Implementados (Padrão para Replicar)

#### ✅ Command Span
**Localização**: `server.js` - handler `createBooking`
```javascript
const commandSpan = createCommandSpan(tracer, 'request_ride', activeSpan, {
    'command.customer_id': customerId
});

const result = await runInSpan(commandSpan, async () => {
    return await command.execute();
});
```

#### ✅ Event Publish Span
**Localização**: `server.js` - handler `createBooking`
```javascript
const eventSpan = createEventSpan(tracer, 'ride.requested', activeSpan, {
    'event.booking_id': bookingId
});

await runInSpan(eventSpan, async () => {
    await eventBus.publish({ eventType: 'ride.requested', data: event });
});

// Salvar contexto para linkar com listeners
event.data._otelSpanContext = eventSpan.spanContext();
```

#### ✅ Listener Span
**Localização**: `listeners/onRideAccepted.notifyPassenger.js`
```javascript
const listenerSpan = createListenerSpan(tracer, 'notify_passenger', eventSpanContext, {
    'listener.booking_id': event.data?.bookingId
});

await runInSpan(listenerSpan, async () => {
    // ... código do listener
});
```

## 📋 Próximos Passos (Replicar Padrão)

### 1. Completar Spans em Handlers de Socket

**Arquivo**: `server.js`

Adicionar spans em:
- ✅ `createBooking` (parcial - falta span root do socket)
- ⏳ `acceptRide` (linha ~1846)
- ⏳ `startTrip` (linha ~2135)
- ⏳ `completeTrip` (linha ~2584)
- ⏳ `cancelRide`

**Padrão**:
```javascript
socket.on('acceptRide', async (data) => {
    const traceId = extractTraceIdFromEvent(data, socket);
    const tracer = getTracer();
    const socketSpan = createSocketSpan(tracer, 'acceptRide', {
        'user.id': socket.userId,
        'user.type': socket.userType
    });
    
    await traceContext.runWithTraceId(traceId, async () => {
        await runInSpan(socketSpan, async () => {
            // ... código do handler
        });
    });
});
```

### 2. Completar Spans em Commands

**Arquivos**: `commands/*.js`

Adicionar spans em:
- ✅ `RequestRideCommand` (exemplo implementado)
- ⏳ `AcceptRideCommand`
- ⏳ `StartTripCommand`
- ⏳ `CompleteTripCommand`
- ⏳ `CancelRideCommand`

**Padrão**: Já implementado no `server.js` - replicar para outros commands.

### 3. Completar Spans em Event Publishes

**Arquivo**: `server.js`

Adicionar spans em:
- ✅ `ride.requested` (exemplo implementado)
- ⏳ `ride.accepted`
- ⏳ `ride.started`
- ⏳ `ride.completed`
- ⏳ `ride.cancelled`

**Padrão**: Já implementado - replicar para outros eventos.

### 4. Completar Spans em Listeners

**Arquivos**: `listeners/*.js`

Adicionar spans em:
- ✅ `notify_passenger` (exemplo implementado)
- ⏳ `notify_driver`
- ⏳ `notify_drivers`
- ⏳ `send_push`
- ⏳ `start_trip_timer`

**Padrão**: Já implementado em `notifyPassenger` - replicar para outros listeners.

### 5. Adicionar Spans em Circuit Breakers

**Arquivo**: `services/circuit-breaker-service.js`

Adicionar spans quando circuit breaker muda de estado:
```javascript
const circuitSpan = createCircuitBreakerSpan(tracer, 'firebase_firestore', state, parentSpan, {
    'circuit.failure_count': failureCount
});
```

## 🔧 Configuração

### Variáveis de Ambiente

```bash
# Sampling rate (0.01 = 1% em produção)
OTEL_SAMPLING_RATE=0.01

# Jaeger endpoint
JAEGER_ENDPOINT=http://localhost:14268/api/traces

# Ambiente
NODE_ENV=production
```

### Sampling por Ambiente

- **Development**: 100% (1.0) - todos os traces
- **Staging**: 10% (0.10) - 1 em 10 traces
- **Production**: 1-5% (0.01-0.05) - 1 em 100 a 1 em 20 traces

## 📊 Visualização

### Jaeger UI
1. Instalar Jaeger: `docker run -d -p 16686:16686 -p 14268:14268 jaegertracing/all-in-one:latest`
2. Acessar: `http://localhost:16686`
3. Buscar por: `service.name=leaf-websocket-backend`

### Grafana + Tempo
1. Configurar datasource Tempo no Grafana
2. Query: `{service_name="leaf-websocket-backend"}`

## ⚠️ Regras de Ouro

### ❌ NÃO Instrumentar:
- Funções utilitárias (`formatCurrency`, `calculateDistance`)
- Queries Redis individuais (agrupar em operação lógica)
- Loops/iterações (usar atributos: `span.setAttribute('drivers.count', drivers.length)`)
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

### Volume
- 50k corridas/dia × 1% sampling × ~10 spans/corrida = **~5.000 spans/dia**
- Extremamente baixo para qualquer sistema de tracing

### Infraestrutura
- **Self-hosted** (recomendado): US$ 5-10/mês (1 VPS pequena)
- **SaaS** (opcional): US$ 50-300/mês (Honeycomb/Datadog)

### Overhead de Performance
- +1-3ms por request (com sampling baixo)
- Irrelevante comparado a Redis/Firebase/FCM

## 🎯 Status Atual

- ✅ **Infraestrutura**: 100% completa
- ✅ **Exemplos**: 3 exemplos funcionais (Command, Event, Listener)
- ⏳ **Cobertura**: ~20% dos pontos críticos
- 📋 **Próximo**: Replicar padrão nos demais handlers/commands/events/listeners

## 🚀 Como Continuar

1. **Replicar padrão** nos demais handlers de socket
2. **Replicar padrão** nos demais commands
3. **Replicar padrão** nos demais event publishes
4. **Replicar padrão** nos demais listeners
5. **Adicionar spans** em circuit breakers
6. **Configurar Jaeger/Tempo** para visualização
7. **Criar dashboards** no Grafana

## 📝 Notas Importantes

- **Sampling baixo em produção**: 1-5% é suficiente para observabilidade
- **Manual instrumentation**: Mais controle, menos overhead
- **Foco em fluxo de corrida**: Priorizar spans que respondem perguntas de negócio
- **Links entre spans**: Listeners linkados a eventos permitem rastreamento completo



## ✅ O Que Foi Implementado

### 1. Infraestrutura Base
- ✅ **Pacotes instalados**: `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-jaeger`
- ✅ **Utils criados**:
  - `utils/tracer.js` - Configuração e inicialização do tracer
  - `utils/span-helpers.js` - Helpers para criação de spans
- ✅ **Inicialização**: Tracer inicializado no `server.js` (modo desenvolvimento)

### 2. Exemplos Implementados (Padrão para Replicar)

#### ✅ Command Span
**Localização**: `server.js` - handler `createBooking`
```javascript
const commandSpan = createCommandSpan(tracer, 'request_ride', activeSpan, {
    'command.customer_id': customerId
});

const result = await runInSpan(commandSpan, async () => {
    return await command.execute();
});
```

#### ✅ Event Publish Span
**Localização**: `server.js` - handler `createBooking`
```javascript
const eventSpan = createEventSpan(tracer, 'ride.requested', activeSpan, {
    'event.booking_id': bookingId
});

await runInSpan(eventSpan, async () => {
    await eventBus.publish({ eventType: 'ride.requested', data: event });
});

// Salvar contexto para linkar com listeners
event.data._otelSpanContext = eventSpan.spanContext();
```

#### ✅ Listener Span
**Localização**: `listeners/onRideAccepted.notifyPassenger.js`
```javascript
const listenerSpan = createListenerSpan(tracer, 'notify_passenger', eventSpanContext, {
    'listener.booking_id': event.data?.bookingId
});

await runInSpan(listenerSpan, async () => {
    // ... código do listener
});
```

## 📋 Próximos Passos (Replicar Padrão)

### 1. Completar Spans em Handlers de Socket

**Arquivo**: `server.js`

Adicionar spans em:
- ✅ `createBooking` (parcial - falta span root do socket)
- ⏳ `acceptRide` (linha ~1846)
- ⏳ `startTrip` (linha ~2135)
- ⏳ `completeTrip` (linha ~2584)
- ⏳ `cancelRide`

**Padrão**:
```javascript
socket.on('acceptRide', async (data) => {
    const traceId = extractTraceIdFromEvent(data, socket);
    const tracer = getTracer();
    const socketSpan = createSocketSpan(tracer, 'acceptRide', {
        'user.id': socket.userId,
        'user.type': socket.userType
    });
    
    await traceContext.runWithTraceId(traceId, async () => {
        await runInSpan(socketSpan, async () => {
            // ... código do handler
        });
    });
});
```

### 2. Completar Spans em Commands

**Arquivos**: `commands/*.js`

Adicionar spans em:
- ✅ `RequestRideCommand` (exemplo implementado)
- ⏳ `AcceptRideCommand`
- ⏳ `StartTripCommand`
- ⏳ `CompleteTripCommand`
- ⏳ `CancelRideCommand`

**Padrão**: Já implementado no `server.js` - replicar para outros commands.

### 3. Completar Spans em Event Publishes

**Arquivo**: `server.js`

Adicionar spans em:
- ✅ `ride.requested` (exemplo implementado)
- ⏳ `ride.accepted`
- ⏳ `ride.started`
- ⏳ `ride.completed`
- ⏳ `ride.cancelled`

**Padrão**: Já implementado - replicar para outros eventos.

### 4. Completar Spans em Listeners

**Arquivos**: `listeners/*.js`

Adicionar spans em:
- ✅ `notify_passenger` (exemplo implementado)
- ⏳ `notify_driver`
- ⏳ `notify_drivers`
- ⏳ `send_push`
- ⏳ `start_trip_timer`

**Padrão**: Já implementado em `notifyPassenger` - replicar para outros listeners.

### 5. Adicionar Spans em Circuit Breakers

**Arquivo**: `services/circuit-breaker-service.js`

Adicionar spans quando circuit breaker muda de estado:
```javascript
const circuitSpan = createCircuitBreakerSpan(tracer, 'firebase_firestore', state, parentSpan, {
    'circuit.failure_count': failureCount
});
```

## 🔧 Configuração

### Variáveis de Ambiente

```bash
# Sampling rate (0.01 = 1% em produção)
OTEL_SAMPLING_RATE=0.01

# Jaeger endpoint
JAEGER_ENDPOINT=http://localhost:14268/api/traces

# Ambiente
NODE_ENV=production
```

### Sampling por Ambiente

- **Development**: 100% (1.0) - todos os traces
- **Staging**: 10% (0.10) - 1 em 10 traces
- **Production**: 1-5% (0.01-0.05) - 1 em 100 a 1 em 20 traces

## 📊 Visualização

### Jaeger UI
1. Instalar Jaeger: `docker run -d -p 16686:16686 -p 14268:14268 jaegertracing/all-in-one:latest`
2. Acessar: `http://localhost:16686`
3. Buscar por: `service.name=leaf-websocket-backend`

### Grafana + Tempo
1. Configurar datasource Tempo no Grafana
2. Query: `{service_name="leaf-websocket-backend"}`

## ⚠️ Regras de Ouro

### ❌ NÃO Instrumentar:
- Funções utilitárias (`formatCurrency`, `calculateDistance`)
- Queries Redis individuais (agrupar em operação lógica)
- Loops/iterações (usar atributos: `span.setAttribute('drivers.count', drivers.length)`)
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

### Volume
- 50k corridas/dia × 1% sampling × ~10 spans/corrida = **~5.000 spans/dia**
- Extremamente baixo para qualquer sistema de tracing

### Infraestrutura
- **Self-hosted** (recomendado): US$ 5-10/mês (1 VPS pequena)
- **SaaS** (opcional): US$ 50-300/mês (Honeycomb/Datadog)

### Overhead de Performance
- +1-3ms por request (com sampling baixo)
- Irrelevante comparado a Redis/Firebase/FCM

## 🎯 Status Atual

- ✅ **Infraestrutura**: 100% completa
- ✅ **Exemplos**: 3 exemplos funcionais (Command, Event, Listener)
- ⏳ **Cobertura**: ~20% dos pontos críticos
- 📋 **Próximo**: Replicar padrão nos demais handlers/commands/events/listeners

## 🚀 Como Continuar

1. **Replicar padrão** nos demais handlers de socket
2. **Replicar padrão** nos demais commands
3. **Replicar padrão** nos demais event publishes
4. **Replicar padrão** nos demais listeners
5. **Adicionar spans** em circuit breakers
6. **Configurar Jaeger/Tempo** para visualização
7. **Criar dashboards** no Grafana

## 📝 Notas Importantes

- **Sampling baixo em produção**: 1-5% é suficiente para observabilidade
- **Manual instrumentation**: Mais controle, menos overhead
- **Foco em fluxo de corrida**: Priorizar spans que respondem perguntas de negócio
- **Links entre spans**: Listeners linkados a eventos permitem rastreamento completo




