# 🔍 DIAGNÓSTICO: CAUSAS DE ZERO NOTIFICAÇÕES (TC-002 e TC-005)

**Data:** 01/11/2025  
**Status:** ✅ Causas Identificadas

---

## 📊 RESUMO EXECUTIVO

Investigation completa revelou **3 causas principais** para zero notificações nos testes TC-002 e TC-005:

1. **GradualRadiusExpander não está sendo iniciado** (Causa Principal)
2. **Motoristas de teste podem não estar disponíveis** quando o teste roda
3. **Cache geoespacial pode retornar dados antigos** entre testes

---

## 🔴 CAUSA PRINCIPAL: GradualRadiusExpander Não Iniciado

### **Problema Identificado:**

Nos testes **TC-002** e **TC-005**, após processar as corridas em batch, o código cria um `QueueWorker` e chama `processAllQueues()`, mas **não inicia o `GradualRadiusExpander`** para cada corrida.

### **Código Atual (TC-002):**

```javascript
// 2. Processar todas em batch
await sleep(500);
const processed = await rideQueueManager.processNextRides(regionHash, 10);

// 3. Worker processa e inicia buscas
const queueWorker = new QueueWorker(MockIO);
await queueWorker.processAllQueues(); // ❌ Só processa fila, não inicia busca
await sleep(2000); // Aguardar buscas iniciarem
```

### **O Que Está Faltando:**

O `QueueWorker.processAllQueues()` apenas:
- Move corridas de `PENDING` para `SEARCHING`
- Mas **NÃO inicia o `GradualRadiusExpander`** automaticamente

O `GradualRadiusExpander` precisa ser iniciado **manualmente** após o estado mudar para `SEARCHING`:

```javascript
// ❌ FALTANDO:
const gradualExpander = new GradualRadiusExpander(MockIO);
for (const bookingId of processed) {
    const bookingData = await redis.hgetall(`booking:${bookingId}`);
    const pickupLocation = JSON.parse(bookingData.pickupLocation);
    await gradualExpander.startGradualSearch(bookingId, pickupLocation);
}
```

### **Comparação com TC-001 (Que Funciona):**

TC-001 funciona porque **inicia explicitamente** o `GradualRadiusExpander`:

```javascript
// TC-001 - FUNCIONA ✅
const gradualExpander = new GradualRadiusExpander(MockIO);
await gradualExpander.startGradualSearch(bookingId, pickupLocation);
```

### **Solução:**

**Opção 1: Modificar os testes para iniciar busca gradual**

```javascript
// 3. Iniciar busca gradual para cada corrida processada
const gradualExpander = new GradualRadiusExpander(MockIO);
for (const bookingId of processed) {
    const bookingKey = `booking:${bookingId}`;
    const bookingData = await redis.hgetall(bookingKey);
    
    if (bookingData && bookingData.pickupLocation) {
        const pickupLocation = JSON.parse(bookingData.pickupLocation);
        await gradualExpander.startGradualSearch(bookingId, pickupLocation);
    }
}
```

**Opção 2: Modificar QueueWorker para iniciar busca gradual automaticamente**

```javascript
// Em queue-worker.js
async processRegionQueue(regionHash) {
    const rides = await this.rideQueueManager.processNextRides(regionHash, 5);
    
    for (const bookingId of rides) {
        // Iniciar busca gradual automaticamente
        const bookingData = await this.redis.hgetall(`booking:${bookingId}`);
        if (bookingData && bookingData.pickupLocation) {
            const pickupLocation = JSON.parse(bookingData.pickupLocation);
            await this.gradualExpander.startGradualSearch(bookingId, pickupLocation);
        }
    }
}
```

---

## ⚠️ CAUSA SECUNDÁRIA: Motoristas Não Disponíveis

### **Problema Identificado:**

A investigação mostrou que quando os testes TC-002 e TC-005 rodam, os motoristas criados no `setupTestDrivers()` podem não estar disponíveis:

**Resultados da Investigação:**
```
📋 1. VERIFICANDO MOTORISTAS NO REDIS...
   Total de motoristas em driver_locations: 2  ❌ (deveria ter 10!)
   ✅ Motoristas encontrados:
      - test_driver_002: ...
      - test_driver_001: ...  ❌ (estes são de outros testes!)

   Motorista: test_driver_f9_1
      Localização GEO: [ null ]  ❌
      Dados completos: {}  ❌
      ❌ PROBLEMA: Dados não encontrados para test_driver_f9_1
```

### **Possíveis Causas:**

1. **Limpeza entre testes muito agressiva:**
   - O `cleanupTestData()` pode estar limpando motoristas antes do próximo teste rodar
   - Os testes podem não estar isolados corretamente

2. **Motoristas criados mas não encontrados:**
   - Os motoristas estão sendo criados no `setupTestDrivers()` no início
   - Mas quando TC-002 roda (depois de TC-001), eles podem ter sido "consumidos" ou limpos

3. **Timing issue:**
   - Motoristas podem não estar completamente processados quando o teste verifica

### **Solução:**

**Garantir que motoristas estejam disponíveis antes de cada teste:**

```javascript
// Antes de TC-002 e TC-005:
await setupTestDrivers(redis); // Recriar motoristas se necessário

// Verificar que motoristas estão no Redis:
const driversInRedis = await redis.zcard('driver_locations');
if (driversInRedis < TEST_CONFIG.drivers.length) {
    console.log(`⚠️ Apenas ${driversInRedis} motoristas no Redis, recriando...`);
    await setupTestDrivers(redis);
}
```

---

## ⚠️ CAUSA TERCIÁRIA: Cache Geoespacial

### **Problema Identificado:**

O cache geoespacial pode conter dados de testes anteriores:

**Resultados da Investigação:**
```
📋 7. VERIFICANDO CACHE GEOESPACIAL...
   Total de chaves no cache: 4
   Total de motoristas no cache: 8
   ⚠️ POSSÍVEL PROBLEMA: Cache pode estar retornando dados antigos
```

### **Impacto:**

- Cache pode retornar motoristas que não existem mais
- Cache pode retornar motoristas já notificados em testes anteriores
- Pode causar falsos positivos ou negativos

### **Solução:**

**Limpar cache entre testes:**

```javascript
// Em cleanupTestData() ou antes de cada teste:
const geospatialCache = require('./services/geospatial-cache');
await geospatialCache.clear();
```

---

## 📋 COMPARAÇÃO: TC-001 vs TC-002

### **TC-001 (Funciona):**

```javascript
// 1. Criar corrida
await rideQueueManager.enqueueRide({...});

// 2. Processar
await rideQueueManager.processNextRides(regionHash, 1);

// 3. Iniciar busca gradual ✅ EXPLICITAMENTE
const gradualExpander = new GradualRadiusExpander(MockIO);
await gradualExpander.startGradualSearch(bookingId, pickupLocation);
```

### **TC-002 (Não Notifica):**

```javascript
// 1. Criar 10 corridas
for (let i = 0; i < 10; i++) {
    await rideQueueManager.enqueueRide({...});
}

// 2. Processar em batch
await rideQueueManager.processNextRides(regionHash, 10);

// 3. Worker processa
const queueWorker = new QueueWorker(MockIO);
await queueWorker.processAllQueues();
// ❌ FALTA: Iniciar GradualRadiusExpander!
```

---

## 🔧 SOLUÇÕES PROPOSTAS

### **Solução 1: Corrigir Testes (Recomendado - Mais Rápido)**

**Modificar TC-002 e TC-005 para iniciar busca gradual:**

```javascript
// TC-002: Após processAllQueues()
const gradualExpander = new GradualRadiusExpander(MockIO);
for (const bookingId of processed) {
    const bookingKey = `booking:${bookingId}`;
    const bookingData = await redis.hgetall(bookingKey);
    
    if (bookingData && bookingData.pickupLocation) {
        const pickupLocation = JSON.parse(bookingData.pickupLocation);
        await gradualExpander.startGradualSearch(bookingId, pickupLocation);
    }
}
await sleep(2000); // Aguardar buscas iniciarem
```

### **Solução 2: Modificar QueueWorker (Mais Profundo)**

**Fazer QueueWorker iniciar busca gradual automaticamente:**

```javascript
// Em services/queue-worker.js
async processRegionQueue(regionHash) {
    const rides = await this.rideQueueManager.processNextRides(regionHash, 5);
    
    for (const bookingId of rides) {
        const bookingKey = `booking:${bookingId}`;
        const bookingData = await this.redis.hgetall(bookingKey);
        
        if (bookingData && bookingData.pickupLocation) {
            const pickupLocation = JSON.parse(bookingData.pickupLocation);
            // Iniciar busca gradual automaticamente
            await this.gradualExpander.startGradualSearch(bookingId, pickupLocation);
        }
    }
}
```

**Prós:**
- ✅ Solução mais robusta
- ✅ QueueWorker fica completo
- ✅ Funciona em produção também

**Contras:**
- ⚠️ Pode afetar comportamento em produção
- ⚠️ Requer mais testes

### **Solução 3: Melhorar Isolamento de Testes**

**Garantir que motoristas estejam disponíveis e cache limpo:**

```javascript
// Adicionar antes de TC-002 e TC-005:
async function ensureDriversAvailable(redis) {
    const driversInRedis = await redis.zcard('driver_locations');
    
    if (driversInRedis < TEST_CONFIG.drivers.length) {
        console.log(`⚠️ Recriando motoristas (${driversInRedis} < ${TEST_CONFIG.drivers.length})`);
        await setupTestDrivers(redis);
    }
    
    // Limpar cache
    const geospatialCache = require('./services/geospatial-cache');
    await geospatialCache.clear();
    
    // Limpar locks
    for (const driver of TEST_CONFIG.drivers) {
        await driverLockManager.releaseLock(driver.id);
        await redis.del(`driver_lock:${driver.id}`);
    }
}
```

---

## 📊 RESUMO DAS CAUSAS

| Causa | Severidade | Impacto | Solução |
|-------|------------|---------|---------|
| **GradualRadiusExpander não iniciado** | 🔴 ALTA | Zero notificações | Iniciar explicitamente nos testes |
| **Motoristas não disponíveis** | ⚠️ MÉDIA | Pode causar zero notificações | Recriar motoristas antes de testar |
| **Cache geoespacial antigo** | ⚠️ BAIXA | Pode causar dados incorretos | Limpar cache entre testes |

---

## ✅ PLANO DE CORREÇÃO

### **Prioridade 1 (Imediato):**
1. ✅ Modificar TC-002 para iniciar `GradualRadiusExpander`
2. ✅ Modificar TC-005 para iniciar `GradualRadiusExpander`

### **Prioridade 2 (Melhorias):**
3. 🔧 Adicionar função `ensureDriversAvailable()` antes de TC-002 e TC-005
4. 🔧 Limpar cache geoespacial no `cleanupTestData()`

### **Prioridade 3 (Opcional):**
5. 🔧 Considerar modificar `QueueWorker` para iniciar busca gradual automaticamente

---

## 📝 CONCLUSÃO

**Causa Principal:** `GradualRadiusExpander` não está sendo iniciado nos testes TC-002 e TC-005.

**Solução:** Iniciar explicitamente o `GradualRadiusExpander` após processar as corridas.

**Status:** ✅ Causas identificadas e soluções propostas

---

**Documento gerado em:** 01/11/2025  
**Próximos Passos:** Implementar correções


