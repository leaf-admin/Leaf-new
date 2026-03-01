# Correção da Lógica de Estado

## 🎯 Comportamento Correto

### Estado da Corrida
- **Estado SEMPRE é SEARCHING** enquanto busca motoristas
- **Só muda para ACCEPTED** quando motorista aceita
- **NÃO muda** quando motorista é notificado
- **NÃO muda** quando motorista rejeita
- **NÃO muda** quando motorista dá timeout

### Quando Motorista é Notificado
```
Estado: SEARCHING (permanece)
Lock: Adquirido (20s)
Timeout: Agendado (20s)
```

### Quando Motorista NÃO Responde (Timeout 20s)
```
Lock: Liberado ✅
Estado: SEARCHING (permanece) ✅
Motorista: Livre para receber OUTRAS corridas
Se há outra corrida na fila: Motorista recebe próxima
```

### Quando Motorista Rejeita
```
Lock: Liberado ✅
Estado: SEARCHING (permanece) ✅
Motorista: Adicionado à lista de exclusão (não recebe mesma corrida)
Se há outra corrida na fila: Motorista recebe próxima
```

### Quando Motorista Aceita
```
Estado: SEARCHING → ACCEPTED ✅
Lock: Permanece (motorista em viagem)
Busca: Para
```

## 🔧 Correções Necessárias

### 1. Remover mudança de estado para NOTIFIED
**Arquivo**: `driver-notification-dispatcher.js:328`
```javascript
// ❌ REMOVER: Não mudar estado para NOTIFIED
// await RideStateManager.updateBookingState(this.redis, bookingId, RideStateManager.STATES.NOTIFIED, {...});

// ✅ MANTER: Estado continua SEARCHING
// Apenas registrar metadata (notifiedDriverId, notifiedAt) sem mudar estado
```

### 2. Remover mudança de estado para SEARCHING no timeout
**Arquivo**: `driver-notification-dispatcher.js:519`
```javascript
// ❌ REMOVER: Não voltar para SEARCHING (já está em SEARCHING)
// await RideStateManager.updateBookingState(this.redis, bookingId, RideStateManager.STATES.SEARCHING, {...});

// ✅ MANTER: Apenas liberar lock e registrar timeout
await driverLockManager.releaseLock(driverId);
// Estado permanece SEARCHING
```

### 3. Remover mudança de estado para SEARCHING na rejeição
**Arquivo**: `response-handler.js:624`
```javascript
// ❌ REMOVER: Não voltar para SEARCHING (já está em SEARCHING)
// await RideStateManager.updateBookingState(this.redis, bookingId, RideStateManager.STATES.SEARCHING, {...});

// ✅ MANTER: Apenas liberar lock e adicionar à lista de exclusão
await driverLockManager.releaseLock(driverId);
// Estado permanece SEARCHING
```

### 4. Ajustar verificação de estado
**Arquivo**: `queue-worker.js:151`
```javascript
// ❌ REMOVER: Verificação de NOTIFIED (estado não existe mais)
// if (currentState === RideStateManager.STATES.NOTIFIED) { ... }

// ✅ MANTER: Apenas verificar SEARCHING
if (currentState === RideStateManager.STATES.SEARCHING || 
    currentState === RideStateManager.STATES.EXPANDED) {
    // Processar corrida
}
```

### 5. Ajustar teste TC-005
**Arquivo**: `test-queue-system-complete.js`
```javascript
// ❌ REMOVER: Verificação de estado voltar para SEARCHING
// if (stateAfterTimeout !== RideStateManager.STATES.SEARCHING) { ... }

// ✅ CORRIGIR: Verificar que estado PERMANECE SEARCHING
const stateAfterTimeout = await RideStateManager.getBookingState(redis, bookingId);
if (stateAfterTimeout !== RideStateManager.STATES.SEARCHING) {
    throw new Error(`Estado deveria permanecer SEARCHING, encontrado: ${stateAfterTimeout}`);
}
```

## 📋 Resumo das Mudanças

1. **NOTIFIED não é mais um estado** - apenas metadata
2. **Estado sempre SEARCHING** até motorista aceitar
3. **Timeout libera lock** mas não muda estado
4. **Rejeição libera lock** mas não muda estado
5. **Apenas aceitação muda estado** SEARCHING → ACCEPTED


