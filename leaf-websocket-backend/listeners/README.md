# 📋 LISTENERS - LEAF

## 🎯 Objetivo

Efeitos colaterais que reagem a eventos, desacoplados da lógica de negócio.

## 📁 Estrutura

```
listeners/
├── index.js                          # EventBus e classe base
├── setupListeners.js                 # Configuração de todos os listeners
├── onRideAccepted.notifyPassenger.js # Notificar passageiro
├── onRideAccepted.notifyDriver.js    # Notificar motorista
├── onRideAccepted.sendPush.js        # Enviar push notification
├── onRideRequested.notifyDrivers.js # Notificar motoristas próximos
└── onRideStarted.startTripTimer.js   # Iniciar timer de viagem
```

## 🔧 Uso

### Configurar listeners:

```javascript
const setupListeners = require('./listeners/setupListeners');
const { getEventBus } = require('./listeners');

// No server.js, após criar io
const eventBus = setupListeners(io);

// Publicar evento
const RideAcceptedEvent = require('./events/ride.accepted');
const event = new RideAcceptedEvent({
    bookingId: 'booking_123',
    driverId: 'driver_456',
    customerId: 'customer_789'
});

await eventBus.publish(event);
// Todos os listeners registrados para ride.accepted serão executados
```

## ✅ Regras dos Listeners

1. **Listeners são desacoplados** - Podem rodar no mesmo processo ou em workers
2. **Listeners não mudam estado** - Apenas reagem a eventos
3. **Listeners são independentes** - Falha em um não afeta outros
4. **Listeners podem notificar** - WebSocket, Push, Email, etc.
5. **Listeners podem iniciar timers** - Para rastreamento, timeouts, etc.

## 📝 Listeners Implementados

- ✅ `onRideAccepted.notifyPassenger` - Notifica passageiro via WebSocket
- ✅ `onRideAccepted.notifyDriver` - Notifica motorista via WebSocket
- ✅ `onRideAccepted.sendPush` - Envia push notification
- ✅ `onRideRequested.notifyDrivers` - Notifica motoristas próximos
- ✅ `onRideStarted.startTripTimer` - Inicia timer de viagem

## 🚀 Próximos Passos

- [ ] Integrar EventBus no server.js
- [ ] Adicionar mais listeners conforme necessário
- [ ] Criar workers para processar listeners em background (opcional)

