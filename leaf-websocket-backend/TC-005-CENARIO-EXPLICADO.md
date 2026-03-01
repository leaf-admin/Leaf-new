# TC-005: Cenário Explicado - Timeout de Motorista

## 🎯 O Que É Um Lock?

Quando um motorista recebe uma notificação de corrida:
1. **Lock é adquirido**: Motorista fica "ocupado" por 20 segundos
2. **Durante o lock**: Motorista **NÃO pode receber OUTRAS corridas**
3. **Objetivo do lock**: Prevenir que motorista receba múltiplas corridas simultaneamente enquanto decide

## 📋 Cenário do TC-005

### Situação Inicial
```
Corrida: test_ride_123
Estado: SEARCHING (buscando motoristas)
Motorista: test_driver_1 (disponível, sem lock)
```

### Passo 1: Motorista Recebe Notificação
```
1. Sistema encontra motorista próximo
2. Sistema adquire LOCK para motorista (20s)
   → driver_lock:test_driver_1 = test_ride_123 (TTL: 20s)
3. Sistema envia notificação via WebSocket
4. Estado da corrida muda: SEARCHING → NOTIFIED
5. Timeout handler é agendado (20s)
```

**Estado após notificação:**
```
Corrida: test_ride_123
Estado: NOTIFIED (aguardando resposta do motorista)
Motorista: test_driver_1
  - Lock: ATIVO (20s)
  - Status: Ocupado (não pode receber outras corridas)
  - Tempo para responder: 20s
```

### Passo 2: Motorista NÃO Responde (Timeout)

**O que acontece:**
- Motorista não aceita nem rejeita em 20s
- Sistema assume: motorista não está disponível/responsivo

**Após 20s (timeout):**
```
1. Timeout handler executa
2. Lock é liberado automaticamente
   → driver_lock:test_driver_1 = DELETADO
3. Estado da corrida volta: NOTIFIED → SEARCHING
4. Busca gradual continua (expansão de raio)
```

**Estado após timeout:**
```
Corrida: test_ride_123
Estado: SEARCHING (buscando outros motoristas)
Motorista: test_driver_1
  - Lock: LIBERADO ✅
  - Status: Disponível (pode receber OUTRAS corridas)
  - Pode receber test_ride_123 novamente? NÃO (já foi notificado)
```

## 🔍 O Que Significa "Voltar para SEARCHING"?

### Para a CORRIDA:
- **Estado NOTIFIED**: "Estou aguardando resposta de um motorista específico"
- **Estado SEARCHING**: "Estou buscando motoristas disponíveis"
- **Voltar para SEARCHING**: A corrida volta a buscar outros motoristas porque o primeiro não respondeu

### Para o MOTORISTA:
- **Lock liberado**: Motorista fica livre para receber **OUTRAS corridas**
- **Mas**: Motorista NÃO recebe a mesma corrida novamente (já está na lista de notificados)
- **Após 30s**: Motorista pode receber a mesma corrida novamente (se ainda estiver disponível)

## ✅ Critérios do TC-005

### 1. Lock Liberado ✅
```javascript
// Motorista fica livre para receber OUTRAS corridas
const lockStatus = await driverLockManager.isDriverLocked(driverId);
// Esperado: lockStatus.isLocked === false
```

**Por quê?**
- Motorista não respondeu em 20s
- Sistema assume que motorista não está disponível
- Libera o lock para que motorista possa receber outras corridas

### 2. Estado Volta para SEARCHING ✅
```javascript
// Corrida volta a buscar outros motoristas
const state = await RideStateManager.getBookingState(redis, bookingId);
// Esperado: state === 'SEARCHING'
```

**Por quê?**
- Motorista não respondeu
- Corrida precisa continuar buscando outros motoristas
- Estado NOTIFIED significa "aguardando resposta", mas não há mais resposta esperada
- Volta para SEARCHING para continuar a busca

### 3. Busca Continua (Expansão de Raio) ✅
```javascript
// Busca gradual continua expandindo o raio
const searchData = await redis.hgetall(`booking_search:${bookingId}`);
const currentRadius = parseFloat(searchData.currentRadius || 0);
// Esperado: currentRadius > 0.5km (expansão continua)
```

**Por quê?**
- Após voltar para SEARCHING, a busca gradual deve continuar
- Raio expande: 0.5km → 1km → 1.5km → ... → 3km
- Cada expansão ocorre a cada 5 segundos
- Mais motoristas são notificados conforme o raio expande

## 🔄 Fluxo Completo

```
T=0s:  Corrida criada (SEARCHING)
       Motorista encontrado próximo
       
T=1s:  Motorista notificado
       Lock adquirido (20s)
       Estado: SEARCHING → NOTIFIED
       Timeout agendado (20s)
       
T=2s:  Motorista ainda não respondeu
       (aguardando resposta...)
       
T=20s: TIMEOUT! Motorista não respondeu
       Timeout handler executa:
       1. Libera lock ✅
       2. Estado: NOTIFIED → SEARCHING ✅
       3. Busca gradual continua ✅
       
T=25s: Busca gradual expande raio
       (0.5km → 1km)
       Outros motoristas são notificados
```

## 🎯 Resumo

**TC-005 valida que:**
- Quando motorista não responde em 20s:
  1. ✅ Lock é liberado (motorista fica livre para OUTRAS corridas)
  2. ✅ Estado volta para SEARCHING (corrida continua buscando)
  3. ✅ Busca continua (expansão de raio para encontrar outros motoristas)

**Não significa:**
- ❌ Motorista recebe a mesma corrida novamente imediatamente
- ❌ Motorista fica bloqueado permanentemente
- ❌ Corrida para de buscar motoristas

**Significa:**
- ✅ Motorista fica livre para receber OUTRAS corridas
- ✅ Corrida continua buscando OUTROS motoristas
- ✅ Sistema continua funcionando mesmo se motorista não responder


