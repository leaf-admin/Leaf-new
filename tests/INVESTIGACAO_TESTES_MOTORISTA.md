# 🔍 INVESTIGAÇÃO: TESTES DO MOTORISTA

**Data:** 2025-12-18  
**Status:** 4/8 testes passando (50%)

---

## 📊 PROBLEMA IDENTIFICADO

### **Causa Raiz: Validação de `driver_active_notification`**

O `ResponseHandler` verifica se o motorista tem uma notificação ativa na tela antes de permitir aceitar/rejeitar:

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

**Problema:**
- `DriverNotificationDispatcher` salva `driver_active_notification` quando envia `newRideRequest`
- TTL de 20 segundos
- Se o `bookingId` usado no `acceptRide` não corresponder exatamente ao salvo, a aceitação falha

---

## ✅ CORREÇÕES APLICADAS

### **1. Ajuste no `waitForEvent`**
- Corrigido para usar dados diretamente (não `data.data`)
- `waitForEvent` retorna o dado diretamente, não um objeto com `data`

### **2. Uso do `bookingId` da Notificação**
- Usar `bookingId` da notificação recebida (`newRideRequest`)
- Pode ser diferente do `bookingId` retornado por `createBooking`

### **3. Aumento de Sleep**
- Aumentado de 1s para 2s após receber `newRideRequest`
- Garante que `driver_active_notification` foi salvo no Redis

### **4. Melhorias nos Helpers**
- `acceptRide` e `rejectRide` agora configuram listeners ANTES de emitir
- Usa `on()` ao invés de `once()` para capturar eventos via rooms
- Remove listeners após receber evento

---

## 📈 RESULTADO ATUAL

### **Testes Passando (4/8 - 50%)**
1. ✅ TC-DRIVER-001: Motorista fica online e recebe corrida
2. ✅ TC-DRIVER-004: Motorista finaliza viagem
3. ✅ TC-DRIVER-007: Motorista fica offline
4. ✅ TC-DRIVER-008: Motorista não recebe corrida quando offline

### **Testes Falhando (4/8 - 50%)**
1. ❌ TC-DRIVER-002: Motorista aceita corrida - Timeout em `rideAccepted`
2. ❌ TC-DRIVER-003: Motorista inicia viagem - Timeout em `acceptRide`
3. ❌ TC-DRIVER-005: Motorista rejeita corrida - Timeout em `rideRejected`
4. ❌ TC-DRIVER-006: Motorista atualiza localização durante viagem - Timeout em `rideAccepted`

---

## 🔍 ANÁLISE DOS PROBLEMAS RESTANTES

### **Problema 1: `rideAccepted` não está sendo recebido**

**Causa possível:**
- Evento é emitido via room (`io.to('driver_${driverId}').emit()`)
- Socket pode não estar no room correto
- Evento pode estar chegando antes do listener estar configurado

**Evidência:**
- `ResponseHandler` emite via room (linha 415)
- Driver entra no room durante autenticação (server.js linha 904)
- Mas pode haver problema de timing

### **Problema 2: `driver_active_notification` não corresponde**

**Causa possível:**
- `bookingId` usado no `acceptRide` não corresponde ao salvo
- Pode haver diferença entre `bookingId` retornado por `createBooking` e o da notificação

**Solução aplicada:**
- Usar `bookingId` da notificação (`newRideRequest`)
- Aguardar 2s após receber notificação

---

## 💡 PRÓXIMOS PASSOS RECOMENDADOS

### **1. Verificar Logs do Servidor**
```bash
# Ver logs em tempo real
tail -f /tmp/websocket-server.log | grep -E "(acceptRide|driver_active_notification|ResponseHandler)"
```

### **2. Adicionar Logs de Debug nos Testes**
- Logar `bookingId` usado no `acceptRide`
- Logar `bookingId` recebido na notificação
- Verificar se correspondem

### **3. Verificar se `driver_active_notification` está sendo salvo**
- Adicionar verificação no teste antes de `acceptRide`
- Verificar no Redis se a chave existe

### **4. Aumentar Timeout ou Melhorar Validação**
- Aumentar timeout de `acceptRide` de 15s para 20s
- Melhorar validação de `bookingId` (aceitar prefixo/sufixo)

---

## 📝 NOTAS TÉCNICAS

### **Como o Servidor Emite `rideAccepted`**
1. `ResponseHandler.handleAcceptRide()` processa a aceitação
2. Emite via room: `io.to('driver_${driverId}').emit('rideAccepted', ...)`
3. Driver deve estar no room `driver_${driverId}` (entra durante autenticação)

### **Como o Servidor Emite `rideRejected`**
1. `ResponseHandler.handleRejectRide()` processa a rejeição
2. Emite via room: `io.to('driver_${driverId}').emit('rideRejected', ...)`
3. Também emite via socket direto (server.js linha 1734)

### **Validação de `driver_active_notification`**
- Salvo pelo `DriverNotificationDispatcher` quando envia `newRideRequest`
- TTL de 20 segundos
- Verificado pelo `ResponseHandler` antes de aceitar/rejeitar
- Deve corresponder exatamente ao `bookingId` usado

---

## ✅ CONCLUSÃO

Os testes estão funcionando, mas há problemas de timing e validação de `bookingId`. As correções aplicadas melhoraram a taxa de sucesso de 25% para 50%, mas ainda há trabalho a fazer para chegar a 100%.

**Principais desafios:**
1. Timing entre notificação e aceitação
2. Correspondência exata de `bookingId`
3. Eventos via rooms podem ter delay

**Recomendação:** Continuar investigando os logs do servidor para identificar exatamente onde está falhando.

