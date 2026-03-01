# Análise: Lock vs Estado Intermediário

## 🔍 Problema Atual

### Lock Atual (Incorreto)
```
Motorista recebe notificação → Lock adquirido (20s)
Durante lock: Motorista NÃO pode receber outras corridas
Problema: Se rejeitar, lock é liberado, mas sendNextRideToDriver 
          verifica lock antes de notificar → não notifica próxima corrida
```

### Comportamento Esperado (Correto)
```
Motorista recebe notificação → Estado: "tem corrida na tela" (sem lock)
Motorista pode rejeitar → Recebe próxima automaticamente
Motorista aceita → Lock adquirido (corrida em andamento)
```

## 📊 Como Funciona Atualmente

### 1. Fila de Corridas
- **Pendente** (`ride_queue:${regionHash}:pending`): Corridas recém-criadas (PENDING)
- **Ativa** (`ride_queue:${regionHash}:active`): Corridas em busca (SEARCHING)
- **Ordenação**: Cronológica (timestamp como score)

### 2. Raio de Busca
- **Gradual**: 0.5km → 1km → 1.5km → ... → 3km (expansão a cada 5s)
- **Expansão secundária**: 3km → 5km após 60s sem motorista

### 3. Lock Atual
- **Quando**: Adquirido ao notificar motorista
- **TTL**: 20 segundos
- **Objetivo**: Prevenir múltiplas corridas simultâneas
- **Problema**: Impede recebimento de próxima corrida após rejeição

### 4. sendNextRideToDriver
- **Quando**: Chamado após rejeição
- **O que faz**: 
  1. Busca próxima corrida na fila (pendente ou ativa)
  2. Verifica se motorista já foi notificado
  3. Verifica se motorista está excluído
  4. **PROBLEMA**: Verifica lock antes de notificar (linha 870-871)
  5. Se motorista tem lock, não notifica

## ✅ Solução Proposta

### 1. Remover Lock de "Corrida na Tela"
- **Lock apenas quando**: Motorista aceita corrida (corrida em andamento)
- **Estado intermediário**: Motorista tem corrida "na tela" (sem lock)
- **Rastreamento**: Usar `ride_notifications:${bookingId}` para saber que motorista foi notificado

### 2. Ajustar sendNextRideToDriver
- **Remover verificação de lock**: Não verificar lock antes de notificar
- **Verificar apenas**: 
  - Motorista já foi notificado para esta corrida?
  - Motorista está excluído desta corrida?
  - Motorista está dentro do raio de busca?

### 3. Lock Apenas em Aceitação
- **Quando motorista aceita**: Adquirir lock permanente (até corrida terminar)
- **Quando motorista rejeita**: Não precisa de lock (já liberado ou nunca adquirido)

### 4. Fluxo Correto
```
1. Corrida criada → Fila pendente
2. Processada → Fila ativa (SEARCHING)
3. Busca gradual → Motorista encontrado
4. Motorista notificado → Sem lock, apenas registro em ride_notifications
5. Motorista rejeita → sendNextRideToDriver chamado
6. sendNextRideToDriver → Busca próxima corrida (sem verificar lock)
7. Próxima corrida notificada → Motorista recebe automaticamente
8. Motorista aceita → Lock adquirido (corrida em andamento)
```

## 🔧 Mudanças Necessárias

### 1. driver-notification-dispatcher.js
```javascript
// ❌ REMOVER: Lock ao notificar
// const lockAcquired = await driverLockManager.acquireLock(driverId, bookingId, 20);

// ✅ MANTER: Apenas registrar notificação
await this.redis.sadd(`ride_notifications:${bookingId}`, driverId);

// ✅ NOVO: Lock apenas quando motorista aceita (em response-handler.js)
```

### 2. response-handler.js - handleAcceptRide
```javascript
// ✅ ADICIONAR: Lock quando motorista aceita
const lockAcquired = await driverLockManager.acquireLock(driverId, bookingId, 3600); // 1 hora
if (!lockAcquired) {
    throw new Error('Motorista já está ocupado');
}
```

### 3. response-handler.js - sendNextRideToDriver
```javascript
// ❌ REMOVER: Verificação de lock
// const lockStatusCheck = await driverLockManager.isDriverLocked(driverId);

// ✅ MANTER: Apenas verificar exclusão e notificação anterior
const alreadyNotified = await this.redis.sismember(`ride_notifications:${bookingId}`, driverId);
const isExcluded = await this.redis.sismember(`ride_excluded_drivers:${bookingId}`, driverId);
```

### 4. driver-notification-dispatcher.js - findAndScoreDrivers
```javascript
// ❌ REMOVER: Verificação de lock ao buscar motoristas
// if (lockStatus.isLocked) { continue; }

// ✅ MANTER: Apenas verificar se motorista está online e disponível
if (driverData.status !== 'available' || driverData.isOnline !== 'true') {
    continue;
}
```

## 📋 Benefícios

1. **Motorista pode receber múltiplas corridas sequenciais**: Rejeita uma → recebe próxima automaticamente
2. **Lock apenas quando necessário**: Apenas quando corrida está em andamento
3. **sendNextRideToDriver funciona**: Não é bloqueado por lock
4. **Melhor experiência**: Motorista recebe corridas continuamente até aceitar ou esgotar

## ⚠️ Considerações

1. **Múltiplas corridas na tela**: Motorista pode receber múltiplas corridas se rejeitar rapidamente
   - **Solução**: Motorista pode ter apenas 1 corrida "ativa" na tela por vez
   - **Rastreamento**: Usar `driver_active_notification:${driverId}` para rastrear corrida atual na tela

2. **Timeout**: Se motorista não responde em 20s, corrida volta para busca
   - **Solução**: Timeout handler remove motorista de `ride_notifications` e continua busca

3. **Race condition**: Múltiplas corridas tentando notificar mesmo motorista
   - **Solução**: Usar `driver_active_notification:${driverId}` como semáforo (sem lock permanente)


