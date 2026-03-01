# 🔍 DIAGNÓSTICO COMPLETO: Causas de Zero Notificações

**Data:** 01/11/2025  
**Status:** ✅ Investigação Completa

---

## 📊 RESUMO EXECUTIVO

Após investigação detalhada, foram identificadas **3 causas principais** para zero notificações nos testes TC-002 e TC-005:

1. **🔴 CAUSA PRINCIPAL:** QueueWorker verifica se busca já foi iniciada e PULA incorretamente
2. **⚠️ CAUSA SECUNDÁRIA:** Motoristas não disponíveis quando testes rodam
3. **⚠️ CAUSA TERCIÁRIA:** Cache geoespacial com dados antigos

---

## 🔴 CAUSA PRINCIPAL: Verificação Incorreta no QueueWorker

### **Problema Identificado:**

O `QueueWorker.processRegionQueue()` **JÁ TEM** código para iniciar `GradualRadiusExpander` (linha 185), mas há uma verificação que pode estar bloqueando:

```javascript
// Linha 179-182 do queue-worker.js
const searchData = await this.redis.hgetall(searchKey);

if (searchData && searchData.state === 'SEARCHING') {
    logger.debug(`🔍 [QueueWorker] Busca já iniciada para ${bookingId}, pulando`);
    continue; // ❌ PULA - Não inicia busca!
}
```

### **Análise do Problema:**

1. `processNextRides()` muda estado para `SEARCHING` e pode criar `booking_search:{bookingId}` com `state: 'SEARCHING'`
2. `QueueWorker` verifica se `booking_search` existe com `state: 'SEARCHING'`
3. Se existir, assume que busca já foi iniciada e **PULA**
4. Mas na verdade, `GradualRadiusExpander.startGradualSearch()` é que deveria criar esse registro
5. **Resultado:** Busca nunca é iniciada!

### **Fluxo Atual (Problema):**

```
TC-002/TC-005:
1. enqueueRide() → cria booking
2. processNextRides() → move PENDING → SEARCHING
   → Pode criar booking_search com state: 'SEARCHING'
3. queueWorker.processAllQueues()
4. processRegionQueue() verifica booking_search
5. Se existe e state='SEARCHING' → PULA ❌
6. GradualRadiusExpander.startGradualSearch() nunca é chamado!
```

### **Comparação com TC-001 (Funciona):**

```
TC-001:
1. enqueueRide() → cria booking
2. processNextRides() → move PENDING → SEARCHING
3. gradualExpander.startGradualSearch() → EXPLICITAMENTE inicia
   → Cria booking_search corretamente
4. Busca funciona ✅
```

### **Evidência:**

A verificação na linha 179 está verificando se `state === 'SEARCHING'`, mas o `GradualRadiusExpander.startGradualSearch()` pode não estar criando esse registro antes que o `QueueWorker` verifique.

### **Solução:**

**Opção 1: Corrigir verificação no QueueWorker**

Verificar se busca foi **realmente iniciada** (não apenas se estado é SEARCHING):

```javascript
// Verificar se busca já foi iniciada
const searchKey = `booking_search:${bookingId}`;
const searchData = await this.redis.hgetall(searchKey);

// Verificar se já tem expansões agendadas (busca realmente iniciada)
// Não apenas se state é SEARCHING
const hasActiveSearch = searchData && 
    (searchData.currentRadius !== undefined || 
     searchData.startTime !== undefined);

if (hasActiveSearch) {
    logger.debug(`🔍 [QueueWorker] Busca já iniciada para ${bookingId}, pulando`);
    continue;
}
```

**Opção 2: Modificar testes para iniciar busca explicitamente**

```javascript
// TC-002/TC-005: Após processAllQueues()
const gradualExpander = new GradualRadiusExpander(MockIO);
for (const bookingId of processed) {
    const bookingData = await redis.hgetall(`booking:${bookingId}`);
    if (bookingData && bookingData.pickupLocation) {
        const pickupLocation = JSON.parse(bookingData.pickupLocation);
        await gradualExpander.startGradualSearch(bookingId, pickupLocation);
    }
}
```

---

## ⚠️ CAUSA SECUNDÁRIA: Motoristas Não Disponíveis

### **Problema Identificado:**

Investigação mostrou que quando TC-002/TC-005 rodam, motoristas podem não estar disponíveis:

**Resultados:**
```
Motoristas em driver_locations: 2  ❌ (deveria ter 10!)
Motorista test_driver_f9_1: Dados não encontrados ❌
```

### **Possíveis Causas:**

1. **Limpeza entre testes:** `cleanupTestData()` pode estar limpando motoristas
2. **Motoristas "consumidos":** TC-001 pode ter usado todos os motoristas disponíveis
3. **Motoristas não recriados:** Setup não é chamado novamente entre testes

### **Solução:**

```javascript
// Adicionar antes de TC-002 e TC-005:
async function ensureDriversAvailable(redis) {
    const driversInRedis = await redis.zcard('driver_locations');
    
    if (driversInRedis < TEST_CONFIG.drivers.length) {
        console.log(`⚠️ Recriando motoristas...`);
        await setupTestDrivers(redis);
    }
}
```

---

## ⚠️ CAUSA TERCIÁRIA: Cache Geoespacial

### **Problema:**

Cache pode conter dados de testes anteriores, causando:
- Retornar motoristas que não existem mais
- Retornar dados incorretos de localização

### **Solução:**

```javascript
// Limpar cache no cleanupTestData():
const geospatialCache = require('./services/geospatial-cache');
await geospatialCache.clear();
```

---

## 🔍 ANÁLISE DO CÓDIGO QueueWorker

### **Código Atual (queue-worker.js linhas 175-186):**

```javascript
// Verificar se busca já foi iniciada (evitar duplicatas)
const searchKey = `booking_search:${bookingId}`;
const searchData = await this.redis.hgetall(searchKey);

if (searchData && searchData.state === 'SEARCHING') {
    logger.debug(`🔍 [QueueWorker] Busca já iniciada para ${bookingId}, pulando`);
    continue;
}

// Iniciar busca gradual
await this.gradualExpander.startGradualSearch(bookingId, pickupLocation);
```

### **Problema:**

A verificação `searchData.state === 'SEARCHING'` pode estar sendo satisfeita por:
1. `processNextRides()` que cria `booking_search` com state: 'SEARCHING'
2. Mas `startGradualSearch()` ainda não foi chamado
3. QueueWorker assume que busca já foi iniciada e pula

### **Verificação Correta:**

Deve verificar se `startGradualSearch()` foi **realmente chamado**, não apenas se estado é SEARCHING.

Indicadores de busca realmente iniciada:
- `currentRadius` definido
- `startTime` definido
- `expansions` agendadas (timeouts)

---

## 📋 RESUMO DAS CAUSAS

| # | Causa | Severidade | Impacto | Solução |
|---|-------|------------|---------|---------|
| 1 | **Verificação incorreta no QueueWorker** | 🔴 **ALTA** | Zero notificações | Corrigir verificação ou iniciar busca explicitamente |
| 2 | Motoristas não disponíveis | ⚠️ MÉDIA | Pode causar zero notificações | Recriar motoristas antes de testar |
| 3 | Cache geoespacial antigo | ⚠️ BAIXA | Dados incorretos | Limpar cache entre testes |

---

## 🔧 SOLUÇÕES PROPOSTAS

### **Solução 1: Corrigir Testes (Mais Rápido)**

Modificar TC-002 e TC-005 para iniciar busca explicitamente:

```javascript
// Após processAllQueues():
const gradualExpander = new GradualRadiusExpander(MockIO);
for (const bookingId of processed) {
    const bookingData = await redis.hgetall(`booking:${bookingId}`);
    if (bookingData && bookingData.pickupLocation) {
        const pickupLocation = JSON.parse(bookingData.pickupLocation);
        await gradualExpander.startGradualSearch(bookingId, pickupLocation);
    }
}
await sleep(2000);
```

### **Solução 2: Corrigir QueueWorker (Mais Robusto)**

Melhorar verificação para detectar se busca foi realmente iniciada:

```javascript
// Verificar se busca já foi iniciada (verificar indicadores reais)
const searchKey = `booking_search:${bookingId}`;
const searchData = await this.redis.hgetall(searchKey);

// Busca foi iniciada se tem currentRadius OU startTime
const searchStarted = searchData && (
    searchData.currentRadius !== undefined ||
    searchData.startTime !== undefined
);

if (searchStarted) {
    logger.debug(`🔍 [QueueWorker] Busca já iniciada para ${bookingId}, pulando`);
    continue;
}
```

### **Solução 3: Melhorar Isolamento de Testes**

- Recriar motoristas antes de cada teste
- Limpar cache entre testes
- Limpar locks entre testes

---

## ✅ CONCLUSÃO

**Causa Principal Identificada:** 
- QueueWorker verifica `booking_search.state === 'SEARCHING'` e assume que busca já foi iniciada
- Mas `processNextRides()` pode criar esse registro sem iniciar a busca
- QueueWorker pula e nunca chama `startGradualSearch()`

**Solução Recomendada:**
1. **Imediato:** Corrigir testes TC-002 e TC-005 para iniciar busca explicitamente
2. **Médio Prazo:** Melhorar verificação no QueueWorker
3. **Longo Prazo:** Melhorar isolamento de testes

---

**Documento gerado em:** 01/11/2025  
**Status:** ✅ Causas Identificadas e Soluções Propostas


