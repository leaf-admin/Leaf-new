# 🔍 ANÁLISE: O QUE OS TESTES ESTÃO ESPERANDO RECEBER

**Data:** 2025-12-18  
**Objetivo:** Entender exatamente o que cada teste que está falhando espera receber do servidor

---

## 📊 RESUMO DOS TIMEOUTS

### **Testes Falhando com Timeout (4/8)**

1. **TC-DRIVER-002**: Motorista aceita corrida → Timeout em `rideAccepted`
2. **TC-DRIVER-003**: Motorista inicia viagem → Timeout em `acceptRide` 
3. **TC-DRIVER-005**: Motorista rejeita corrida → Timeout em `rideRejected`
4. **TC-DRIVER-006**: Motorista atualiza localização durante viagem → Timeout em `rideAccepted`

---

## 🔍 ANÁLISE DETALHADA

### **1. TC-DRIVER-002: Motorista aceita corrida**

#### **O que o teste faz:**
```javascript
// 1. Driver recebe notificação
const rideRequest = await driver.waitForEvent('newRideRequest', 10);

// 2. Driver aceita corrida
const acceptResult = await driver.acceptRide(finalBookingId, {
    driverId: driver.userId,
    bookingId: finalBookingId
});

// 3. Espera receber 'rideAccepted' (timeout após 15s)
```

#### **O que o teste ESPERA receber:**
- **Evento:** `rideAccepted`
- **Timeout:** 15 segundos (definido em `acceptRide` helper)
- **Formato esperado:**
  ```javascript
  {
    success: true,  // ou ausente (aceita se não tiver error)
    bookingId: "...",
    driver: {...},
    booking: {...},
    message: "Corrida aceita com sucesso"
  }
  ```

#### **Como o servidor emite:**
```javascript
// response-handler.js linha 415
this.io.to(`driver_${driverId}`).emit('rideAccepted', driverNotificationData);
```

#### **Problema identificado:**
- Servidor emite via **room** (`io.to()`)
- Driver deve estar no room `driver_${driverId}` (entra durante autenticação)
- Evento pode não estar chegando por:
  1. Driver não está no room correto
  2. Evento está sendo emitido antes do listener estar configurado
  3. `driver_active_notification` não corresponde ao `bookingId` usado

---

### **2. TC-DRIVER-003: Motorista inicia viagem**

#### **O que o teste faz:**
```javascript
// 1. Driver recebe e aceita corrida
const acceptResult = await driver.acceptRide(finalBookingId, {...});

// 2. Customer confirma pagamento
await customer.confirmPayment(bookingId, 'pix', ...);

// 3. Driver inicia viagem
driver.emit('startTrip', {
    bookingId: bookingId,
    startLocation: {...}
});
await driver.waitForEvent('tripStarted', 10);
```

#### **O que o teste ESPERA receber:**
- **Evento:** `rideAccepted` (durante `acceptRide`) → **TIMEOUT AQUI**
- **Depois:** `tripStarted` (após `startTrip`)

#### **Problema identificado:**
- O timeout está acontecendo em `acceptRide`, não em `startTrip`
- Mesmo problema do TC-DRIVER-002: `rideAccepted` não está chegando

---

### **3. TC-DRIVER-005: Motorista rejeita corrida**

#### **O que o teste faz:**
```javascript
// 1. Driver recebe notificação
const rideRequest = await driver.waitForEvent('newRideRequest', 10);

// 2. Driver rejeita corrida
const rejectResult = await driver.rejectRide(finalBookingId, 'Muito longe');

// 3. Espera receber 'rideRejected' (timeout após 10s)
```

#### **O que o teste ESPERA receber:**
- **Evento:** `rideRejected`
- **Timeout:** 10 segundos (definido em `rejectRide` helper)
- **Formato esperado:**
  ```javascript
  {
    success: true,  // ou ausente (aceita se não tiver error)
    bookingId: "...",
    message: "Corrida rejeitada com sucesso",
    reason: "Muito longe"
  }
  ```

#### **Como o servidor emite:**
```javascript
// response-handler.js linha 600
this.io.to(`driver_${driverId}`).emit('rideRejected', {
    success: true,
    bookingId,
    message: 'Corrida rejeitada com sucesso',
    reason
});

// server.js linha 1734 (também emite via socket direto)
socket.emit('rideRejected', {...});
```

#### **Problema identificado:**
- Servidor emite via **room** E via **socket direto**
- Mas o helper está configurado para receber via room
- Pode haver problema de timing ou `driver_active_notification`

---

### **4. TC-DRIVER-006: Motorista atualiza localização durante viagem**

#### **O que o teste faz:**
```javascript
// 1. Driver recebe e aceita corrida
const acceptResult = await driver.acceptRide(finalBookingId, {...});

// 2. Customer confirma pagamento
await customer.confirmPayment(...);

// 3. Driver inicia viagem
await driver.startTrip(bookingId, {...});

// 4. Driver atualiza localização durante viagem
driver.emit('updateTripLocation', {...});
```

#### **O que o teste ESPERA receber:**
- **Evento:** `rideAccepted` (durante `acceptRide`) → **TIMEOUT AQUI**
- **Depois:** `tripStarted` (após `startTrip`)

#### **Problema identificado:**
- Mesmo problema do TC-DRIVER-002 e TC-DRIVER-003
- `rideAccepted` não está chegando durante `acceptRide`

---

## 🎯 RESUMO: O QUE TODOS ESPERAM RECEBER

### **Evento `rideAccepted` (3 testes falhando aqui)**

**Esperado:**
- Evento: `rideAccepted`
- Via: Room `driver_${driverId}`
- Timeout: 15 segundos
- Formato: Objeto com `bookingId`, `driver`, `booking`, `message`

**Como o servidor emite:**
```javascript
// response-handler.js linha 415
this.io.to(`driver_${driverId}`).emit('rideAccepted', driverNotificationData);
```

**Problema:**
- Evento via room pode não estar chegando
- Driver pode não estar no room correto
- Listener pode não estar configurado a tempo

---

### **Evento `rideRejected` (1 teste falhando aqui)**

**Esperado:**
- Evento: `rideRejected`
- Via: Room `driver_${driverId}` OU socket direto
- Timeout: 10 segundos
- Formato: Objeto com `success`, `bookingId`, `message`, `reason`

**Como o servidor emite:**
```javascript
// response-handler.js linha 600 (via room)
this.io.to(`driver_${driverId}`).emit('rideRejected', {...});

// server.js linha 1734 (via socket direto)
socket.emit('rideRejected', {...});
```

**Problema:**
- Servidor emite duas vezes (room + socket)
- Helper pode não estar capturando nenhum dos dois

---

## 🔧 CAUSA RAIZ IDENTIFICADA

### **Problema Principal: Validação de `driver_active_notification`**

Antes de emitir `rideAccepted` ou `rideRejected`, o `ResponseHandler` verifica:

```javascript
// response-handler.js linha 49-57
const activeNotificationKey = `driver_active_notification:${driverId}`;
const activeBookingId = await this.redis.get(activeNotificationKey);
if (activeBookingId !== bookingId) {
    return {
        success: false,
        error: 'Motorista não tem permissão para aceitar esta corrida'
    };
}
```

**Se esta validação falhar:**
- `ResponseHandler` retorna `{ success: false, error: '...' }`
- **NÃO emite** `rideAccepted` ou `rideRejected`
- Servidor emite apenas `acceptRideError` ou `rejectRideError` (via socket direto)
- Teste não está escutando esses eventos de erro

---

## 💡 SOLUÇÃO PROPOSTA

### **1. Adicionar listener para eventos de erro**

```javascript
// Em acceptRide helper
this.socket.on('acceptRideError', (error) => {
    clearTimeout(timeout);
    this.socket.off('acceptRideError', errorHandler);
    reject(new Error(error.error || 'Accept ride failed'));
});
```

### **2. Verificar `driver_active_notification` antes de aceitar**

```javascript
// No teste, antes de acceptRide
// Verificar se driver_active_notification foi salvo
// Se não foi, aguardar mais tempo ou tentar novamente
```

### **3. Logar o que está sendo recebido**

```javascript
// Adicionar logs para ver todos os eventos recebidos
this.socket.onAny((eventName, data) => {
    console.log(`[TEST] Evento recebido: ${eventName}`, data);
});
```

### **4. Aumentar timeout ou melhorar validação**

- Aumentar timeout de 15s para 20s (TTL do `driver_active_notification`)
- Melhorar validação de `bookingId` (aceitar prefixo/sufixo)

---

## 📝 CONCLUSÃO

**Todos os testes que estão falhando esperam receber:**
1. `rideAccepted` (3 testes) - emitido via room pelo `ResponseHandler`
2. `rideRejected` (1 teste) - emitido via room E socket direto

**Problema comum:**
- Validação de `driver_active_notification` pode estar falhando
- Se falhar, servidor não emite o evento esperado
- Servidor emite apenas eventos de erro que o teste não está escutando

**Próximo passo:**
- Adicionar listeners para eventos de erro (`acceptRideError`, `rejectRideError`)
- Verificar se `driver_active_notification` está sendo salvo corretamente
- Logar todos os eventos recebidos para diagnóstico

