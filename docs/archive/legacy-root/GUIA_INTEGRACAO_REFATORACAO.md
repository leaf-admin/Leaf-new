# 🔧 GUIA DE INTEGRAÇÃO - REFATORAÇÃO INCREMENTAL

**Objetivo:** Integrar Commands, Listeners e EventBus no `server.js` de forma gradual e segura.

---

## 📋 CHECKLIST DE INTEGRAÇÃO

### **Fase 1: Preparação** ✅

- [x] Eventos canônicos criados
- [x] Commands criados
- [x] Listeners criados
- [x] EventBus criado
- [x] Idempotency aplicado
- [x] Circuit breakers aplicados

### **Fase 2: Integração no server.js** ⏳

- [ ] Importar EventBus e setupListeners
- [ ] Configurar EventBus no início do servidor
- [ ] Refatorar `createBooking` para usar `RequestRideCommand`
- [ ] Refatorar `acceptRide` para usar `AcceptRideCommand`
- [ ] Refatorar `startTrip` para usar `StartTripCommand`
- [ ] Refatorar `completeTrip` para usar `CompleteTripCommand`
- [ ] Refatorar `cancelRide` para usar `CancelRideCommand`

### **Fase 3: Testes** ⏳

- [ ] Testar fluxo completo de corrida
- [ ] Validar idempotency em produção
- [ ] Validar circuit breakers em falhas
- [ ] Validar listeners executando

### **Fase 4: Deploy** ⏳

- [ ] Testar localmente
- [ ] Deploy na VPS
- [ ] Monitorar logs e métricas

---

## 🔧 EXEMPLO DE INTEGRAÇÃO

### **1. Configurar EventBus no server.js:**

```javascript
// No início do server.js, após criar io
const setupListeners = require('./listeners/setupListeners');
const { getEventBus } = require('./listeners');

// Configurar listeners
const eventBus = setupListeners(io);
```

### **2. Refatorar createBooking:**

```javascript
// ANTES:
socket.on('createBooking', async (data) => {
    // ... lógica direta ...
    socket.emit('bookingCreated', {...});
});

// DEPOIS:
socket.on('createBooking', async (data) => {
    try {
        // Idempotency (já aplicado)
        const idempotencyCheck = await idempotencyService.checkAndSet(idempotencyKey);
        if (!idempotencyCheck.isNew) {
            // Retornar cached ou erro
            return;
        }
        
        // Executar command
        const RequestRideCommand = require('./commands/RequestRideCommand');
        const command = new RequestRideCommand({
            customerId: data.customerId,
            pickupLocation: data.pickupLocation,
            destinationLocation: data.destinationLocation,
            estimatedFare: data.estimatedFare,
            paymentMethod: data.paymentMethod
        });
        
        const result = await command.execute();
        
        if (result.success) {
            // Command já publicou evento, listeners vão notificar
            // Apenas emitir resposta WebSocket
            socket.emit('bookingCreated', {
                success: true,
                bookingId: result.data.bookingId,
                // ... outros dados ...
            });
            
            // Cachear resultado para idempotency
            await idempotencyService.cacheResult(idempotencyKey, {...});
        } else {
            socket.emit('bookingError', { error: result.error });
        }
    } catch (error) {
        socket.emit('bookingError', { error: error.message });
    }
});
```

### **3. Refatorar acceptRide:**

```javascript
socket.on('acceptRide', async (data) => {
    try {
        // Idempotency (já aplicado)
        // ...
        
        // Executar command
        const AcceptRideCommand = require('./commands/AcceptRideCommand');
        const command = new AcceptRideCommand({
            driverId: socket.userId,
            bookingId: data.bookingId
        });
        
        const result = await command.execute();
        
        if (result.success) {
            // Command já publicou evento, listeners vão notificar passageiro e motorista
            // Apenas cachear resultado
            await idempotencyService.cacheResult(idempotencyKey, {...});
        } else {
            socket.emit('acceptRideError', { error: result.error });
        }
    } catch (error) {
        socket.emit('acceptRideError', { error: error.message });
    }
});
```

---

## ⚠️ NOTAS IMPORTANTES

### **Compatibilidade:**
- ✅ Código antigo continua funcionando
- ✅ Migração pode ser gradual (um handler por vez)
- ✅ Feature flags podem ser usados para ativar/desativar

### **Ordem de Migração Recomendada:**
1. `createBooking` (mais simples)
2. `acceptRide` (médio)
3. `startTrip` (médio)
4. `completeTrip` (complexo)
5. `cancelRide` (complexo)

### **Validação:**
- Testar cada handler após migração
- Validar que eventos estão sendo publicados
- Validar que listeners estão executando
- Validar que idempotency está funcionando

---

## 🚀 PRÓXIMOS PASSOS

1. **Integrar EventBus** no `server.js`
2. **Migrar um handler por vez** (começar com `createBooking`)
3. **Testar localmente** após cada migração
4. **Deploy gradual** na VPS

---

**Última atualização:** 2025-01-XX

