# TC-005: Edge Case - Timeout de Motorista

## 📋 Cenário Proposto

**Objetivo**: Validar que quando um motorista não responde a uma notificação dentro do tempo limite (20 segundos), o sistema:
1. Libera o lock do motorista automaticamente
2. Volta o estado da corrida para SEARCHING
3. Continua a busca gradual (expansão de raio)

## 🔄 Fluxo Esperado

### Passo 1: Setup
- ✅ Criar 1 motorista muito próximo ao pickup (< 100m)
- ✅ Criar 1 corrida
- ✅ Processar corrida e iniciar busca gradual

### Passo 2: Notificação
- ✅ Motorista recebe notificação (estado muda para NOTIFIED)
- ✅ Lock é adquirido para o motorista (TTL: 20s)
- ✅ Timeout handler é agendado (20s)

### Passo 3: Simulação de Timeout
- ⏰ **Motorista NÃO responde** (simular timeout)
- ⏰ Aguardar 20 segundos (TTL do lock)
- ⏰ Aguardar +2s de margem (total: 22s)

### Passo 4: Validações Após Timeout

#### ✅ Critério 1: Lock Liberado
```javascript
const lockStatus = await driverLockManager.isDriverLocked(driverId);
// Esperado: lockStatus.isLocked === false
```

#### ✅ Critério 2: Estado Voltou para SEARCHING
```javascript
const state = await RideStateManager.getBookingState(redis, bookingId);
// Esperado: state === RideStateManager.STATES.SEARCHING
```

**Por quê?**
- Quando o motorista não responde em 20s, o timeout handler deve:
  1. Verificar se estado é NOTIFIED ou AWAITING_RESPONSE
  2. Liberar o lock (se ainda estiver ativo)
  3. Atualizar estado para SEARCHING
  4. Permitir que a busca gradual continue

#### ✅ Critério 3: Busca Continua (Expansão de Raio)
```javascript
const searchData = await redis.hgetall(`booking_search:${bookingId}`);
const currentRadius = parseFloat(searchData.currentRadius || 0);
// Esperado: currentRadius > 0.5km (busca continuou expandindo)
```

**Por quê?**
- Após voltar para SEARCHING, a busca gradual deve continuar
- O raio deve expandir de 0.5km → 1km → 1.5km → ... → 3km
- Cada expansão ocorre a cada 5 segundos

## 🔍 Problema Atual

### O que está acontecendo:
1. ✅ Lock é liberado corretamente (critério 1 passa)
2. ❌ Estado NÃO volta para SEARCHING (critério 2 falha)
3. ❌ Busca não continua (critério 3 falha - consequência do critério 2)

### Diagnóstico:
- O timeout handler está sendo agendado quando o motorista é notificado
- Mas o timeout handler **não está sendo executado** ou **não está atualizando o estado**

### Possíveis Causas:

#### Causa 1: Timeout Handler Não Está Sendo Executado
- O `setTimeout` pode não estar sendo agendado corretamente
- O timeout pode estar sendo cancelado antes de executar
- O processo pode estar sendo encerrado antes do timeout

#### Causa 2: Timeout Handler Executa Mas Não Atualiza Estado
- O estado pode já ter mudado antes do timeout executar
- Pode haver erro silencioso no handler
- A verificação de estado pode estar falhando

#### Causa 3: Múltiplos Motoristas Notificados
- Se múltiplos motoristas foram notificados, apenas o primeiro precisa expirar
- O timeout handler pode estar sendo agendado para todos, mas apenas um precisa executar
- O estado pode estar sendo atualizado por outro processo

## 🛠️ Como o Timeout Handler Deve Funcionar

### Código do Handler (driver-notification-dispatcher.js:492-549)

```javascript
const timeoutId = setTimeout(async () => {
    try {
        const RideStateManager = require('./ride-state-manager');
        const currentState = await RideStateManager.getBookingState(this.redis, bookingId);
        
        // ✅ Verificar estado independente do lock
        if (currentState === RideStateManager.STATES.NOTIFIED || 
            currentState === RideStateManager.STATES.AWAITING_RESPONSE) {
            
            // Liberar lock se ainda estiver ativo
            const lockStatus = await driverLockManager.isDriverLocked(driverId);
            if (lockStatus.isLocked && lockStatus.bookingId === bookingId) {
                await driverLockManager.releaseLock(driverId);
            }
            
            // ✅ ATUALIZAR ESTADO PARA SEARCHING
            await RideStateManager.updateBookingState(
                this.redis,
                bookingId,
                RideStateManager.STATES.SEARCHING,
                { 
                    timeoutDriverId: driverId,
                    timeoutAt: new Date().toISOString(),
                    reason: 'Driver response timeout'
                }
            );
            
            logger.info(`🔄 [Dispatcher] Estado voltou para SEARCHING após timeout de ${driverId}`);
        }
    } catch (error) {
        logger.error(`❌ Erro ao processar timeout para driver ${driverId}:`, error);
    } finally {
        this.timeoutHandlers.delete(timeoutKey);
    }
}, 20 * 1000); // 20 segundos
```

## ✅ Critérios de Sucesso

1. **Lock Liberado**: `lockStatus.isLocked === false` após 22s
2. **Estado SEARCHING**: `state === 'SEARCHING'` após 22s + processamento
3. **Busca Continua**: `currentRadius > 0.5km` após timeout + expansão

## 🔧 O Que Precisa Ser Corrigido

1. **Verificar se timeout handler está sendo agendado**
   - Adicionar log quando `scheduleDriverTimeout` é chamado
   - Verificar se `timeoutHandlers` Map contém a chave

2. **Verificar se timeout handler está sendo executado**
   - Adicionar log no início do handler
   - Verificar se o log `🔄 [Dispatcher] Estado voltou para SEARCHING` aparece

3. **Verificar se há erro silencioso**
   - Verificar logs de erro
   - Verificar se `updateBookingState` está lançando exceção

4. **Verificar se múltiplos motoristas estão interferindo**
   - Se múltiplos motoristas foram notificados, apenas o primeiro precisa expirar
   - O estado deve voltar para SEARCHING quando o primeiro timeout ocorrer

## 📊 Logs Esperados

```
⏰ Aguardando timeout de 20s (lock TTL: 20s)...
[após 20s]
🔄 [Dispatcher] Estado voltou para SEARCHING após timeout de test_driver_timeout_1
✅ Estado voltou para SEARCHING
🔍 Aguardando expansão de raio após timeout...
📊 Busca continuou após timeout (raio: 1.0km)
```

## 🎯 Resumo

**TC-005 valida que:**
- Quando um motorista não responde em 20s, o sistema automaticamente:
  1. Libera o lock ✅
  2. Volta estado para SEARCHING ❌ (falhando)
  3. Continua busca gradual ❌ (falhando - consequência)

**Problema principal**: Timeout handler não está atualizando o estado para SEARCHING.


