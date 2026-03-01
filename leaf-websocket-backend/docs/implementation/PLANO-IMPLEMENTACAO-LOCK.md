# Plano de Implementação: Lock Apenas na Aceitação

## 🎯 Objetivo
Remover lock ao notificar motorista. Lock apenas quando motorista aceita corrida.

## 📋 Mudanças Necessárias

### 1. driver-notification-dispatcher.js - notifyDriver()
**Linha ~274**: Remover aquisição de lock ao notificar

```javascript
// ❌ REMOVER:
const lockAcquired = await driverLockManager.acquireLock(driverId, bookingId, 20);
if (!lockAcquired) {
    logger.debug(`⚠️ [Dispatcher] Lock não adquirido para driver ${driverId} (ocupado)`);
    return false;
}

// ✅ MANTER: Apenas registrar notificação
await this.redis.sadd(`ride_notifications:${bookingId}`, driverId);
```

**Linha ~285-286**: Remover liberação de lock em caso de erro (não há mais lock)

```javascript
// ❌ REMOVER:
await driverLockManager.releaseLock(driverId); // Liberar lock

// ✅ MANTER: Apenas remover da lista de notificados se necessário
```

**Linha ~316-317**: Remover liberação de lock se motorista não está conectado

```javascript
// ❌ REMOVER:
await driverLockManager.releaseLock(driverId);

// ✅ MANTER: Apenas retornar false
```

**Linha ~379-380**: Remover liberação de lock em caso de erro geral

```javascript
// ❌ REMOVER:
try {
    await driverLockManager.releaseLock(driverId);
} catch (releaseError) {
    logger.error(`❌ Erro ao liberar lock após falha de notificação:`, releaseError);
}

// ✅ MANTER: Apenas retornar false
```

### 2. driver-notification-dispatcher.js - findAndScoreDrivers()
**Linha ~108-111**: Remover verificação de lock ao buscar motoristas

```javascript
// ❌ REMOVER:
const lockStatus = await driverLockManager.isDriverLocked(driverId);
if (lockStatus.isLocked) {
    continue; // Motorista ocupado
}

// ✅ MANTER: Apenas verificar se motorista está online e disponível
if (driverData.status !== 'available' || driverData.isOnline !== 'true') {
    continue;
}
```

### 3. driver-notification-dispatcher.js - scheduleDriverTimeout()
**Linha ~506-518**: Remover liberação de lock no timeout (não há mais lock)

```javascript
// ❌ REMOVER:
const lockStatus = await driverLockManager.isDriverLocked(driverId);
if (lockStatus.isLocked && lockStatus.bookingId === bookingId) {
    await driverLockManager.releaseLock(driverId);
    // ...
}

// ✅ MANTER: Apenas registrar timeout e remover de notificados se necessário
```

### 4. response-handler.js - handleAcceptRide()
**Linha ~47-55**: Adquirir lock quando motorista aceita (não verificar se já tem)

```javascript
// ❌ REMOVER: Verificação de lock existente
const lockStatus = await driverLockManager.isDriverLocked(driverId);
if (!lockStatus.isLocked || lockStatus.bookingId !== bookingId) {
    // ...
}

// ✅ ADICIONAR: Adquirir lock quando aceita
const lockAcquired = await driverLockManager.acquireLock(driverId, bookingId, 3600); // 1 hora
if (!lockAcquired) {
    logger.warn(`⚠️ [ResponseHandler] Motorista ${driverId} já está ocupado (outra corrida em andamento)`);
    return {
        success: false,
        error: 'Motorista já está ocupado com outra corrida'
    };
}
```

### 5. response-handler.js - sendNextRideToDriver()
**Linha ~870-871**: Remover verificação de lock antes de notificar

```javascript
// ❌ REMOVER:
const lockStatusCheck = await driverLockManager.isDriverLocked(driverId);

// ✅ MANTER: Apenas verificar exclusão e notificação anterior
const alreadyNotified = await this.redis.sismember(`ride_notifications:${bookingId}`, driverId);
const isExcluded = await this.redis.sismember(`ride_excluded_drivers:${bookingId}`, driverId);
```

### 6. response-handler.js - handleRejectRide()
**Linha ~619-634**: Remover liberação de lock (não há mais lock)

```javascript
// ❌ REMOVER:
await driverLockManager.releaseLock(driverId);

// ✅ MANTER: Apenas adicionar à lista de exclusão e chamar sendNextRideToDriver
```

### 7. gradual-radius-expander.js - stopSearch()
**Verificar**: Remover liberação de locks ao parar busca (não há mais locks)

```javascript
// ❌ REMOVER: Liberação de locks
// (se houver código que libera locks ao parar busca)

// ✅ MANTER: Apenas parar expansão e remover de notificados se necessário
```

## 🔄 Fluxo Correto Após Mudanças

### Notificação
```
1. Busca gradual encontra motorista
2. Motorista notificado → Registrado em ride_notifications (SEM LOCK)
3. Timeout agendado (20s)
4. Se motorista não responde → Timeout remove de notificados, busca continua
```

### Rejeição
```
1. Motorista rejeita → Adicionado à lista de exclusão
2. sendNextRideToDriver chamado
3. Busca próxima corrida (SEM verificar lock)
4. Próxima corrida notificada → Motorista recebe automaticamente
```

### Aceitação
```
1. Motorista aceita → Lock adquirido (1 hora)
2. Estado: SEARCHING → ACCEPTED
3. Busca para
4. Outros motoristas liberados (se houver locks)
```

## ⚠️ Considerações Importantes

### 1. Múltiplas Corridas na Tela
**Problema**: Motorista pode receber múltiplas corridas se rejeitar rapidamente

**Solução**: Usar `driver_active_notification:${driverId}` para rastrear corrida atual na tela
- Ao notificar: Definir `driver_active_notification:${driverId} = bookingId`
- Ao rejeitar/aceitar: Limpar `driver_active_notification:${driverId}`
- Ao buscar próxima: Verificar se motorista tem corrida ativa na tela

### 2. Timeout
**Problema**: Se motorista não responde, corrida deve continuar buscando

**Solução**: Timeout handler apenas remove de `ride_notifications`, não precisa liberar lock (não há lock)

### 3. Race Condition
**Problema**: Múltiplas corridas tentando notificar mesmo motorista simultaneamente

**Solução**: Usar `driver_active_notification:${driverId}` como semáforo
- Verificar se motorista tem corrida ativa antes de notificar
- Se tiver, aguardar timeout ou rejeição antes de notificar próxima

## 📊 Benefícios Esperados

1. ✅ `sendNextRideToDriver` funciona corretamente
2. ✅ Motorista recebe próxima corrida automaticamente após rejeição
3. ✅ Lock apenas quando necessário (corrida em andamento)
4. ✅ Melhor experiência para motorista (recebe corridas continuamente)


