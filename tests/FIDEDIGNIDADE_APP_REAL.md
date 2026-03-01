# ✅ FIDEDIGNIDADE DOS TESTES AO APP REAL

Este documento detalha como os testes replicam **EXATAMENTE** o comportamento do app mobile.

## 🎯 Princípio

Os testes **NÃO simulam** o app - eles **REPLICAM** a comunicação real do app com o servidor, garantindo que:

1. ✅ Os testes validam o comportamento real do sistema
2. ✅ Bugs encontrados nos testes ocorreriam no app real
3. ✅ Mudanças no servidor são detectadas pelos testes
4. ✅ Os testes são confiáveis para validação antes de deploy

---

## 📡 EVENTOS E PAYLOADS - COMPARAÇÃO

### **1. Autenticação**

#### App Real (`WebSocketManager.js` + `PassengerUI.js`):
```javascript
socket.emit('authenticate', { 
    uid: auth.uid, 
    userType: 'passenger' // ou 'driver'
});

socket.once('authenticated', (data) => {
    if (data.success) { /* ... */ }
});
```

#### Testes (`websocket-client.js`):
```javascript
socket.emit('authenticate', {
    uid: this.userId,      // ✅ MESMO CAMPO
    userType: this.userType // ✅ MESMO CAMPO
});

socket.once('authenticated', (data) => {
    if (data.success) { /* ... */ }  // ✅ MESMA VALIDAÇÃO
});
```

✅ **FIDEDÍGNO:** Mesmo evento, mesma estrutura, mesma validação

---

### **2. Criar Booking**

#### App Real (`WebSocketManager.js`):
```javascript
socket.emit('createBooking', bookingData);

socket.once('bookingCreated', (data) => {
    if (data.success) { resolve(data); }
});
```

#### Testes (`websocket-client.js`):
```javascript
socket.emit('createBooking', bookingData);  // ✅ MESMO EVENTO

socket.once('bookingCreated', (data) => {  // ✅ MESMO EVENTO DE RESPOSTA
    if (data.success) { resolve(data); }     // ✅ MESMA VALIDAÇÃO
});
```

✅ **FIDEDÍGNO:** Mesmo evento, mesmo payload, mesmo timeout (15s)

---

### **3. Driver Response**

#### App Real (`WebSocketManager.js`):
```javascript
socket.emit('driverResponse', { 
    bookingId, 
    accepted, 
    reason 
});

if (accepted) {
    socket.once('rideAccepted', (data) => { /* ... */ });
} else {
    socket.once('rideRejected', (data) => { /* ... */ });
}
```

#### Testes (`websocket-client.js`):
```javascript
socket.emit('driverResponse', { 
    bookingId,  // ✅ MESMA ESTRUTURA
    accepted, 
    reason 
});

// ✅ MESMA LÓGICA CONDICIONAL
if (accepted) {
    socket.once('rideAccepted', (data) => { /* ... */ });
} else {
    socket.once('rideRejected', (data) => { /* ... */ });
}
```

✅ **FIDEDÍGNO:** Mesma estrutura, mesma lógica condicional

---

### **4. Aceitar Corrida**

#### App Real (`WebSocketManager.js`):
```javascript
socket.emit('acceptRide', { rideId, ...driverData });

socket.once('rideAccepted', (data) => {
    if (data.success) { resolve(data); }
});
```

#### Testes (`websocket-client.js`):
```javascript
socket.emit('acceptRide', { rideId, ...driverData });  // ✅ MESMO FORMATO

socket.once('rideAccepted', (data) => {
    if (data.success) { resolve(data); }  // ✅ MESMA VALIDAÇÃO
});
```

✅ **FIDEDÍGNO:** Mesmo evento, mesmo timeout (15s)

---

### **5. Iniciar Viagem**

#### App Real (`WebSocketManager.js`):
```javascript
socket.emit('startTrip', { bookingId, startLocation });

socket.once('tripStarted', (data) => {
    if (data.success) { resolve(data); }
});
```

#### Testes (`websocket-client.js`):
```javascript
socket.emit('startTrip', { bookingId, startLocation });  // ✅ MESMO FORMATO

socket.once('tripStarted', (data) => {
    if (data.success) { resolve(data); }  // ✅ MESMA VALIDAÇÃO
});
```

✅ **FIDEDÍGNO:** Mesma estrutura, mesmo timeout (10s)

---

### **6. Completar Viagem**

#### App Real (`WebSocketManager.js`):
```javascript
socket.emit('completeTrip', { 
    bookingId, 
    endLocation, 
    distance, 
    fare 
});

socket.once('tripCompleted', (data) => {
    if (data.success) { resolve(data); }
});
```

#### Testes (`websocket-client.js`):
```javascript
socket.emit('completeTrip', { 
    bookingId,      // ✅ MESMA ESTRUTURA
    endLocation, 
    distance, 
    fare 
});

socket.once('tripCompleted', (data) => {
    if (data.success) { resolve(data); }  // ✅ MESMA VALIDAÇÃO
});
```

✅ **FIDEDÍGNO:** Mesmos campos, mesma ordem

---

### **7. Confirmar Pagamento**

#### App Real (`WebSocketManager.js`):
```javascript
socket.emit('confirmPayment', { 
    bookingId, 
    paymentMethod, 
    paymentId, 
    amount 
});

socket.once('paymentConfirmed', (data) => {
    if (data.success) { resolve(data); }
});
```

#### Testes (`websocket-client.js`):
```javascript
socket.emit('confirmPayment', { 
    bookingId,       // ✅ MESMA ESTRUTURA
    paymentMethod, 
    paymentId, 
    amount 
});

socket.once('paymentConfirmed', (data) => {
    if (data.success) { resolve(data); }  // ✅ MESMA VALIDAÇÃO
});
```

✅ **FIDEDÍGNO:** Mesmos campos, mesmo timeout (10s)

---

## ⏱️ TIMEOUTS - COMPARAÇÃO

| Operação | App Real | Testes | Status |
|----------|----------|--------|--------|
| `authenticate` | 10s | 10s | ✅ |
| `createBooking` | 15s | 15s | ✅ |
| `driverResponse` | 10s | 10s | ✅ |
| `acceptRide` | 15s | 15s | ✅ |
| `rejectRide` | 10s | 10s | ✅ |
| `startTrip` | 10s | 10s | ✅ |
| `completeTrip` | 10s | 10s | ✅ |
| `confirmPayment` | 10s | 10s | ✅ |
| `submitRating` | 15s | 15s | ✅ |

✅ **TODOS OS TIMEOUTS SÃO IDÊNTICOS**

---

## 🔍 VALIDAÇÕES

### App Real:
- Verifica `data.success` antes de aceitar resposta
- Rejeita com erro se `data.success === false`
- Usa `data.error` como mensagem de erro

### Testes:
- ✅ Verifica `data.success` antes de aceitar resposta
- ✅ Rejeita com erro se `data.success === false`
- ✅ Usa `data.error` como mensagem de erro

✅ **VALIDAÇÕES IDÊNTICAS**

---

## 📊 ESTRUTURA DE PAYLOADS

### Exemplo: `createBooking`

#### App Real (`PassengerUI.js`):
```javascript
const bookingData = {
    pickupLocation: {
        lat: ...,
        lng: ...,
        address: ...
    },
    destinationLocation: {
        lat: ...,
        lng: ...,
        address: ...
    },
    vehicleType: 'Leaf Plus',
    estimatedFare: ...,
    paymentMethod: 'pix',
    // ...
};
```

#### Testes (`test-helpers.js`):
```javascript
createBookingPayload(pickup, destination, vehicleType) {
    return {
        pickupLocation: {      // ✅ MESMA ESTRUTURA
            lat: pickup.lat,
            lng: pickup.lng,
            address: pickup.address,
        },
        destinationLocation: {  // ✅ MESMA ESTRUTURA
            lat: destination.lat,
            lng: destination.lng,
            address: destination.address,
        },
        vehicleType: vehicleType,  // ✅ MESMO CAMPO
        estimatedFare: ...,        // ✅ MESMO CAMPO
        paymentMethod: 'pix',       // ✅ MESMO VALOR
        // ...
    };
}
```

✅ **ESTRUTURA IDÊNTICA**

---

## ✅ CONCLUSÃO

Os testes são **100% fidedignos** ao app real:

- ✅ **Mesmos eventos** emitidos e recebidos
- ✅ **Mesma estrutura** de payloads
- ✅ **Mesmos timeouts** e validações
- ✅ **Mesma lógica** de tratamento de erros

**Isso garante que:**
- Os testes validam o comportamento real do sistema
- Bugs encontrados ocorreriam no app real
- Os testes são confiáveis para validação de deploy

---

**Última atualização:** 29/01/2025



