# 🔔 INTEGRAÇÃO - NOTIFICAÇÃO PERSISTENTE DE CORRIDA

## ✅ O QUE FOI CRIADO

Foi criado o serviço `PersistentRideNotificationService.js` que:
- ✅ Cria notificações persistentes (foreground) que ficam sempre visíveis
- ✅ Atualiza automaticamente o status da corrida
- ✅ Funciona mesmo com app em background
- ✅ Mostra informações relevantes (status, tempo, distância, valor)

## 📱 COMO FUNCIONA

A notificação fica **sempre visível** na barra de notificações (como iFood e Uber), mostrando:
- Status atual da corrida
- Informações relevantes (local, tempo estimado, etc)
- Atualiza automaticamente conforme o status muda

## 🔧 COMO INTEGRAR

### 1. Inicializar no App.js

```javascript
import PersistentRideNotificationService from './src/services/PersistentRideNotificationService';

// No useEffect de inicialização
await PersistentRideNotificationService.initialize();
```

### 2. Usar no DriverUI.js

```javascript
import PersistentRideNotificationService from '../../services/PersistentRideNotificationService';

// Quando aceitar corrida
const acceptRideAndStart = async () => {
    // ... código existente ...
    setRideStatus('accepted');
    
    // ✅ Mostrar notificação persistente
    await PersistentRideNotificationService.showRideNotification({
        bookingId: currentRideRequest.bookingId,
        status: 'accepted',
        userType: 'driver',
        pickup: {
            address: currentRideRequest.pickupAddress,
            lat: currentRideRequest.pickupLat,
            lng: currentRideRequest.pickupLng
        },
        customerName: currentRideRequest.customerName
    });
};

// Quando chegar ao local
const arriveAtPickup = () => {
    setRideStatus('atPickup');
    
    // ✅ Atualizar notificação
    await PersistentRideNotificationService.updateRideNotification({
        bookingId: currentBooking?.bookingId,
        status: 'arrived',
        userType: 'driver',
        pickup: { address: currentRideRequest.pickupAddress },
        customerName: currentRideRequest.customerName
    });
};

// Quando iniciar corrida
const startRide = async () => {
    setRideStatus('inProgress');
    
    // ✅ Atualizar notificação
    await PersistentRideNotificationService.updateRideNotification({
        bookingId: bookingId,
        status: 'started',
        userType: 'driver',
        destination: {
            address: currentBooking?.drop?.add || 'Destino'
        },
        estimatedTime: 15 // minutos
    });
};

// Quando finalizar corrida
const completeRide = async () => {
    setRideStatus('completed');
    
    // ✅ Atualizar e depois remover notificação
    await PersistentRideNotificationService.updateRideNotification({
        bookingId: bookingId,
        status: 'completed',
        userType: 'driver',
        fare: `R$ ${currentBooking?.estimate || '0,00'}`
    });
    
    // Remover após alguns segundos
    setTimeout(() => {
        PersistentRideNotificationService.dismissRideNotification();
    }, 5000);
};
```

### 3. Usar no PassengerUI.js

```javascript
import PersistentRideNotificationService from '../../services/PersistentRideNotificationService';

// Quando motorista aceitar
const handleRideAccepted = (data) => {
    setTripStatus('accepted');
    
    // ✅ Mostrar notificação persistente
    await PersistentRideNotificationService.showRideNotification({
        bookingId: data.bookingId,
        status: 'accepted',
        userType: 'customer',
        driverName: data.driverName,
        estimatedTime: data.estimatedArrival
    });
};

// Quando motorista chegar
const handleDriverArrived = (data) => {
    setTripStatus('arrived');
    
    // ✅ Atualizar notificação
    await PersistentRideNotificationService.updateRideNotification({
        bookingId: data.bookingId,
        status: 'arrived',
        userType: 'customer',
        driverName: data.driverName
    });
};

// Quando viagem iniciar
const handleTripStarted = (data) => {
    setTripStatus('started');
    
    // ✅ Atualizar notificação
    await PersistentRideNotificationService.updateRideNotification({
        bookingId: data.bookingId,
        status: 'started',
        userType: 'customer',
        destination: {
            address: tripdata.drop?.add || 'Destino'
        },
        estimatedTime: 20 // minutos
    });
};

// Quando viagem finalizar
const handleTripCompleted = (data) => {
    setTripStatus('completed');
    
    // ✅ Atualizar e remover notificação
    await PersistentRideNotificationService.updateRideNotification({
        bookingId: data.bookingId,
        status: 'completed',
        userType: 'customer',
        fare: `R$ ${data.fare || '0,00'}`
    });
    
    setTimeout(() => {
        PersistentRideNotificationService.dismissRideNotification();
    }, 5000);
};
```

## 🎯 STATUS POSSÍVEIS

- `searching` - Procurando motorista/corrida
- `accepted` - Corrida aceita
- `arrived` - Motorista chegou ao local
- `started` - Corrida iniciada
- `completed` - Corrida finalizada

## ⚙️ CONFIGURAÇÕES

A notificação é configurada com:
- **sticky: true** - Não pode ser removida pelo usuário
- **ongoing: true** - Sempre visível
- **priority: HIGH** - Alta prioridade
- **Atualização automática** - A cada 10 segundos durante corrida ativa

## 🧹 LIMPEZA

Sempre remover a notificação quando:
- Corrida for cancelada
- Corrida for finalizada
- Usuário sair do app durante corrida (opcional)

```javascript
// Exemplo de limpeza
useEffect(() => {
    return () => {
        // Cleanup ao desmontar componente
        if (rideStatus === 'completed' || rideStatus === 'cancelled') {
            PersistentRideNotificationService.dismissRideNotification();
        }
    };
}, [rideStatus]);
```

