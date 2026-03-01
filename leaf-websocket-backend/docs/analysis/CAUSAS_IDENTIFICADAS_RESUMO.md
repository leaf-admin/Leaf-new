# 🔍 CAUSAS IDENTIFICADAS: Zero Notificações (TC-002 e TC-005)

**Data:** 01/11/2025  
**Investigação:** Completa ✅

---

## 📊 CAUSAS IDENTIFICADAS

### 🔴 **CAUSA PRINCIPAL: GradualRadiusExpander Não Iniciado**

**Problema:** Nos testes TC-002 e TC-005, após processar corridas em batch, o `GradualRadiusExpander` não está sendo iniciado.

**Evidência:**
- ✅ TC-001 funciona porque inicia explicitamente: `await gradualExpander.startGradualSearch(...)`
- ❌ TC-002/TC-005 apenas chamam `queueWorker.processAllQueues()` que **não inicia** busca gradual
- O `QueueWorker.processRegionQueue()` processa a fila mas **não inicia** o `GradualRadiusExpander`

**Análise do Código:**

**TC-002 (Atual):**
```javascript
// 2. Processar todas em batch
const processed = await rideQueueManager.processNextRides(regionHash, 10);

// 3. Worker processa (mas não inicia busca gradual)
const queueWorker = new QueueWorker(MockIO);
await queueWorker.processAllQueues(); // ❌ Só muda estado, não inicia busca
await sleep(2000);
```

**TC-001 (Funciona):**
```javascript
// 3. Iniciar busca gradual EXPLICITAMENTE ✅
const gradualExpander = new GradualRadiusExpander(MockIO);
await gradualExpander.startGradualSearch(bookingId, pickupLocation);
```

**QueueWorker.processRegionQueue() (Código Atual):**
- Processa filas (move PENDING → SEARCHING)
- Mas **NÃO** inicia `GradualRadiusExpander`

---

### ⚠️ **CAUSA SECUNDÁRIA: Motoristas Não Disponíveis**

**Problema:** Motoristas criados no `setupTestDrivers()` podem não estar disponíveis quando TC-002/TC-005 rodam.

**Evidência da Investigação:**
```
📋 1. VERIFICANDO MOTORISTAS NO REDIS...
   Total de motoristas em driver_locations: 2  ❌ (deveria ter 10!)

   Motorista: test_driver_f9_1
      Localização GEO: [ null ]  ❌
      Dados completos: {}  ❌
      ❌ PROBLEMA: Dados não encontrados
```

**Possíveis Causas:**
1. Limpeza entre testes muito agressiva
2. Motoristas "consumidos" por TC-001
3. Motoristas não recriados antes de TC-002/TC-005

---

### ⚠️ **CAUSA TERCIÁRIA: Cache Geoespacial**

**Problema:** Cache pode conter dados de testes anteriores.

**Evidência:**
```
📋 7. VERIFICANDO CACHE GEOESPACIAL...
   Total de chaves no cache: 4
   ⚠️ POSSÍVEL PROBLEMA: Cache pode estar retornando dados antigos
```

---

## 🔧 SOLUÇÕES

### **Solução 1: Corrigir Testes (RECOMENDADO - Mais Rápido)**

Modificar TC-002 e TC-005 para iniciar `GradualRadiusExpander` explicitamente:

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
```

### **Solução 2: Modificar QueueWorker (Mais Profundo)**

Fazer `QueueWorker.processRegionQueue()` iniciar busca gradual automaticamente:

```javascript
async processRegionQueue(regionHash) {
    const rides = await this.rideQueueManager.processNextRides(regionHash, 5);
    
    for (const bookingId of rides) {
        const bookingData = await this.redis.hgetall(`booking:${bookingId}`);
        if (bookingData && bookingData.pickupLocation) {
            const pickupLocation = JSON.parse(bookingData.pickupLocation);
            // Iniciar busca gradual automaticamente
            await this.gradualExpander.startGradualSearch(bookingId, pickupLocation);
        }
    }
}
```

### **Solução 3: Melhorar Isolamento**

- Recriar motoristas antes de TC-002/TC-005
- Limpar cache geoespacial entre testes
- Limpar locks entre testes

---

## 📋 RESUMO

| Causa | Severidade | Solução |
|-------|------------|---------|
| GradualRadiusExpander não iniciado | 🔴 **ALTA** | Iniciar explicitamente nos testes |
| Motoristas não disponíveis | ⚠️ MÉDIA | Recriar antes de testar |
| Cache antigo | ⚠️ BAIXA | Limpar entre testes |

---

## ✅ CONCLUSÃO

**Causa Principal:** `GradualRadiusExpander` não está sendo iniciado nos testes TC-002 e TC-005.

**Solução Imediata:** Adicionar código para iniciar busca gradual após processar corridas.

**Status:** ✅ Causas identificadas e soluções propostas

---

**Documento gerado em:** 01/11/2025


