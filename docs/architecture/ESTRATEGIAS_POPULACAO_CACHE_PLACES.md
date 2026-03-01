# 🗄️ Estratégias de População do Cache de Places

## 📊 Visão Geral

O cache de Places pode ser populado de **3 formas diferentes**, cada uma com seu propósito:

---

## 🔄 **Estratégia 1: População Reativa (Atual)** ⭐ RECOMENDADA PARA COMEÇAR

### Como Funciona:
Quando o usuário busca no Google Places e **não encontra no cache**, após buscar no Google, **salva automaticamente no cache** para próxima vez.

### Fluxo:
```
1. Usuário busca "BarraShopping"
2. Backend verifica cache → ❌ Não encontra
3. Frontend busca no Google Places diretamente (fallback)
4. Frontend recebe resultado do Google
5. Frontend chama POST /api/places/save para salvar no cache
6. Próxima busca já encontra no cache ✅
```

### Vantagens:
- ✅ **Zero configuração** - funciona automaticamente
- ✅ **Popula apenas lugares que usuários realmente buscam**
- ✅ **Não gasta créditos do Google** com lugares que ninguém busca
- ✅ **Crescimento orgânico** - cache cresce com uso real

### Desvantagens:
- ⚠️ **Primeira busca sempre vai para Google** (até popular)
- ⚠️ **Cache demora para crescer** (depende do uso)

### Implementação:
Já está implementada! O endpoint `/api/places/save` está pronto.

**No mobile app:**
```javascript
// Após buscar no Google Places
const googleResult = await fetchPlacesAutocomplete(query);
if (googleResult && googleResult.length > 0) {
  // Salvar no cache para próxima vez
  await fetch('/api/places/save', {
    method: 'POST',
    body: JSON.stringify({
      query: query,
      placeData: googleResult[0]
    })
  });
}
```

---

## 🚀 **Estratégia 2: População Proativa (Pré-popular)** ⭐ RECOMENDADA PARA ACELERAR

### Como Funciona:
**Antes de lançar**, popular o cache com os **top 100-500 lugares mais buscados** da sua região.

### Fluxo:
```
1. Criar lista de lugares populares (shoppings, aeroportos, etc.)
2. Script roda uma vez e busca todos no Google Places
3. Salva todos no cache
4. Quando usuário busca, já encontra no cache ✅
```

### Vantagens:
- ✅ **Cache "quente" desde o início**
- ✅ **Primeiras buscas já são rápidas**
- ✅ **Melhor experiência do usuário**

### Desvantagens:
- ⚠️ **Custo inicial** (buscar 500 lugares = ~$8-10)
- ⚠️ **Alguns lugares podem nunca ser buscados** (desperdício)

### Implementação:
Criar script `scripts/populate-places-cache.js`:

```javascript
const placesCacheService = require('../services/places-cache-service');

const popularPlaces = [
  // Rio de Janeiro
  'BarraShopping', 'Shopping Leblon', 'Shopping Iguatemi',
  'Aeroporto Galeão', 'Aeroporto Santos Dumont',
  'Copacabana', 'Ipanema', 'Leblon',
  'Centro do Rio', 'Zona Sul',
  
  // São Paulo
  'Shopping Iguatemi SP', 'Shopping Morumbi',
  'Aeroporto Guarulhos', 'Aeroporto Congonhas',
  'Avenida Paulista', 'Centro de São Paulo',
  
  // ... mais lugares
];

async function populateCache() {
  await placesCacheService.initialize();
  
  for (const place of popularPlaces) {
    console.log(`🔍 Buscando: ${place}`);
    
    // Buscar no Google Places
    const result = await placesCacheService.fetchFromGooglePlaces(place);
    
    if (result) {
      // Salvar no cache
      await placesCacheService.savePlace(place, result);
      console.log(`✅ Salvo: ${place}`);
    } else {
      console.log(`❌ Não encontrado: ${place}`);
    }
    
    // Aguardar 100ms entre requisições (respeitar rate limit)
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('🎉 Cache populado com sucesso!');
}

populateCache();
```

**Executar:**
```bash
node scripts/populate-places-cache.js
```

---

## ⚙️ **Estratégia 3: População Assíncrona (Worker Background)** ⭐ RECOMENDADA PARA ESCALA

### Como Funciona:
Quando usuário busca e **não encontra no cache**, backend **dispara worker assíncrono** que busca no Google Places em background e salva no cache.

### Fluxo:
```
1. Usuário busca "BarraShopping"
2. Backend verifica cache → ❌ Não encontra
3. Backend retorna "buscando..." (não bloqueia)
4. Worker assíncrono busca no Google Places
5. Worker salva no cache
6. Próxima busca já encontra no cache ✅
```

### Vantagens:
- ✅ **Usuário não espera** - resposta imediata
- ✅ **Cache populado automaticamente** - sem intervenção do frontend
- ✅ **Escalável** - pode ter múltiplos workers

### Desvantagens:
- ⚠️ **Primeira busca ainda vai para Google** (mas não bloqueia usuário)
- ⚠️ **Mais complexo** - precisa de fila/worker

### Implementação:
Modificar `places-cache-service.js`:

```javascript
async searchPlace(query, location = null) {
  // ... código atual ...
  
  // Se não encontrou no cache
  if (!result) {
    // Disparar worker assíncrono (não bloqueia)
    this.queueGooglePlacesSearch(query, location).catch(err => {
      logger.error(`Erro no worker: ${err.message}`);
    });
    
    return null; // Frontend usa Google direto
  }
  
  return result;
}

async queueGooglePlacesSearch(query, location) {
  const alias = normalizeQuery(query);
  
  // Verificar se já está buscando (evita duplicatas)
  if (await this.isFetching(alias)) {
    return; // Já está sendo buscado
  }
  
  // Marcar como buscando
  await this.setFetching(alias);
  
  try {
    // Buscar no Google Places
    const result = await this.fetchFromGooglePlaces(query, location);
    
    if (result) {
      // Salvar no cache
      await this.savePlace(query, result);
      logger.info(`✅ Place salvo via worker: ${alias}`);
    }
  } catch (error) {
    logger.error(`❌ Erro no worker: ${error.message}`);
  } finally {
    // Remover flag
    await this.clearFetching(alias);
  }
}
```

---

## 📊 Comparação das Estratégias

| Estratégia | Custo Inicial | Velocidade | Complexidade | Recomendação |
|------------|---------------|------------|--------------|--------------|
| **1. Reativa** | $0 | ⭐⭐ | ⭐ | ✅ Começar aqui |
| **2. Proativa** | $8-10 | ⭐⭐⭐ | ⭐ | ✅ Adicionar depois |
| **3. Assíncrona** | $0 | ⭐⭐⭐ | ⭐⭐⭐ | ✅ Quando escalar |

---

## 🎯 Recomendação de Implementação

### **Fase 1: Reativa (AGORA)**
- ✅ Já implementada
- ✅ Zero custo
- ✅ Funciona automaticamente

### **Fase 2: Proativa (DEPOIS)**
- Criar script de pré-população
- Popular top 200 lugares
- Custo: ~$3-4 (uma vez)

### **Fase 3: Assíncrona (FUTURO)**
- Implementar worker background
- Quando volume > 10.000 buscas/mês
- Melhor experiência do usuário

---

## 💡 Estratégia Híbrida (IDEAL)

**Combinar todas as 3:**

1. **Pré-popular** top 200 lugares (proativa)
2. **Worker assíncrono** para lugares novos (assíncrona)
3. **Frontend salva** após buscar no Google (reativa)

**Resultado:**
- ✅ Cache quente desde o início
- ✅ Cache cresce automaticamente
- ✅ Melhor experiência possível

---

## 📝 Próximos Passos

1. ✅ **Fase 1 já está pronta** (reativa via `/api/places/save`)
2. 🔄 **Criar script de pré-população?** (proativa)
3. 🔄 **Implementar worker assíncrono?** (assíncrona)

**Qual estratégia você quer implementar primeiro?**




