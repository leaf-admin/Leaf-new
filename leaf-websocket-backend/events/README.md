# 📋 EVENTOS CANÔNICOS - LEAF

## 🎯 Objetivo

Definir contratos imutáveis para eventos do sistema, garantindo consistência e validação.

## 📁 Estrutura

```
events/
├── index.js              # Classe base e tipos de eventos
├── ride.requested.js     # Corrida solicitada
├── ride.accepted.js      # Corrida aceita
├── ride.rejected.js      # Corrida rejeitada
├── ride.canceled.js      # Corrida cancelada
├── ride.started.js       # Viagem iniciada
├── ride.completed.js     # Viagem finalizada
├── driver.online.js      # Motorista online
├── driver.offline.js     # Motorista offline
└── payment.confirmed.js  # Pagamento confirmado
```

## 🔧 Uso

### Criar um evento:

```javascript
const RideRequestedEvent = require('./events/ride.requested');

const event = new RideRequestedEvent({
    bookingId: 'booking_123',
    customerId: 'customer_456',
    pickupLocation: { lat: -23.5505, lng: -46.6333 },
    destinationLocation: { lat: -23.5515, lng: -46.6343 },
    estimatedFare: 25.50,
    paymentMethod: 'pix'
});

// Validar
event.validate();

// Serializar
const json = event.toJSON();
```

### Publicar evento:

```javascript
// Via Event Bus (quando implementado)
await eventBus.publish(event);

// Via Event Sourcing (atual)
await eventSourcing.recordEvent(event.eventType, event.data);
```

## ✅ Regras

1. **Todos os eventos devem herdar de `CanonicalEvent`**
2. **Todos os eventos devem validar dados obrigatórios**
3. **Eventos são imutáveis após criação**
4. **Eventos devem ser serializáveis para JSON**

## 📝 Eventos Implementados

- ✅ `ride.requested` - Corrida solicitada
- ✅ `ride.accepted` - Corrida aceita
- ✅ `ride.rejected` - Corrida rejeitada
- ✅ `ride.canceled` - Corrida cancelada
- ✅ `ride.started` - Viagem iniciada
- ✅ `ride.completed` - Viagem finalizada
- ✅ `driver.online` - Motorista online
- ✅ `driver.offline` - Motorista offline
- ✅ `payment.confirmed` - Pagamento confirmado

## 🚀 Próximos Passos

- [ ] Adicionar mais eventos conforme necessário
- [ ] Integrar com Event Bus (Redis Streams)
- [ ] Adicionar validação de tipos (TypeScript ou Joi)
- [ ] Documentar todos os campos de cada evento

