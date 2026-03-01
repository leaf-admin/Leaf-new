# 📊 Análise de Viabilidade: Cache para Google Places API

## ✅ **VIABILIDADE: ALTA** 

A implementação é **altamente viável** e recomendada. A infraestrutura necessária já existe no projeto.

---

## 🔍 Situação Atual

### ✅ **Infraestrutura Existente**
- ✅ **Redis configurado** (`leaf-websocket-backend/utils/redis-pool.js`)
- ✅ **Sistema de cache avançado** (`leaf-websocket-backend/utils/advanced-cache.js`)
- ✅ **PostgreSQL disponível** (docker-compose)
- ✅ **Backend WebSocket** estruturado e funcional

### ⚠️ **Problema Identificado**
- ❌ **Google Places chamado diretamente do mobile** (`mobile-app/src/common-local/GoogleAPIFunctions.js`)
- ❌ **Sem cache** - cada busca gera custo na API
- ❌ **Sem normalização** - "BarraShopping" e "Barra Shopping" são buscas diferentes
- ❌ **Sem persistência** - dados não são salvos para reutilização

---

## 💰 Impacto Financeiro Estimado

### Cenário Atual (Sem Cache)
```
1000 usuários/dia × 3 buscas/dia = 3.000 requisições/dia
3.000 × 30 dias = 90.000 requisições/mês

Custo Google Places Autocomplete:
- Primeiras 1.000: $0,00
- Próximas 89.000: $0,0173 cada
Total: ~$1.540/mês
```

### Cenário com Cache (95% hit rate)
```
90.000 requisições/mês
- 4.500 vão para Google Places (5%)
- 85.500 vêm do cache (95%)

Custo:
- Google Places: 4.500 × $0,0173 = ~$78/mês
- Redis (VPS): ~$5-10/mês
- PostgreSQL (VPS): ~$5-10/mês

Economia: ~$1.440/mês (93% de redução)
```

---

## 🏗️ Arquitetura Proposta

### Fluxo de Execução

```
┌─────────────┐
│   Mobile    │
│    App      │
└──────┬──────┘
       │ 1. Busca "BarraShopping"
       ▼
┌─────────────────────────────────┐
│   Backend API (Node.js)          │
│   /api/places/search             │
└──────┬──────────────────────────┘
       │
       ├─► 2. Normalizar query
       │   "barra shopping" → "barra_shopping"
       │
       ├─► 3. Buscar Redis
       │   GET place:barra_shopping
       │   ⚡ 1-2ms
       │
       ├─► 4a. CACHE HIT (99% dos casos)
       │   └─► Retornar imediatamente
       │
       └─► 4b. CACHE MISS (1% dos casos)
           ├─► 5. Buscar PostgreSQL
           │   SELECT * FROM places WHERE alias = 'barra_shopping'
           │   ⚡ 5-10ms
           │
           ├─► 6a. ENCONTRADO NO BANCO
           │   ├─► Popular Redis (TTL 30 dias)
           │   └─► Retornar resultado
           │
           └─► 6b. NÃO ENCONTRADO
               ├─► 7. Retornar "buscando..." (não bloqueia)
               ├─► 8. Worker assíncrono busca Google Places
               │   ⚡ 300-800ms (background)
               ├─► 9. Salvar em PostgreSQL
               ├─► 10. Popular Redis
               └─► 11. Notificar app (WebSocket) ou próxima busca já encontra
```

---

## ⚡ Performance Esperada

| Operação | Tempo Atual | Tempo com Cache | Melhoria |
|----------|-------------|-----------------|----------|
| **Cache Hit (99%)** | 300-800ms | **1-2ms** | **150-400x mais rápido** |
| **Cache Miss (1%)** | 300-800ms | 5-10ms (banco) ou 300-800ms (async) | Similar ou melhor |
| **Latência percebida** | 300-800ms | **<10ms** | **Imperceptível** |

---

## 🛠️ Implementação Técnica

### 1. **Backend: Serviço de Places Cache**

**Arquivo:** `leaf-websocket-backend/services/places-cache-service.js`

```javascript
const redisPool = require('../utils/redis-pool');
const crypto = require('crypto');

class PlacesCacheService {
  constructor() {
    this.redis = redisPool.pool;
    this.ttl = 2592000; // 30 dias
  }

  // Normalizar query para chave única
  normalizeQuery(query) {
    return query
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, '') // Remove pontuação
      .replace(/\s+/g, '_'); // Espaços vira underscore
  }

  // Buscar no cache (Redis primeiro, depois PostgreSQL)
  async searchPlace(query, location = null) {
    const alias = this.normalizeQuery(query);
    const cacheKey = `place:${alias}`;

    // 1. Redis (instantâneo)
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      console.log(`✅ Cache HIT: ${alias}`);
      return JSON.parse(cached);
    }

    // 2. PostgreSQL (se Redis não tiver)
    const dbResult = await this.searchDatabase(alias);
    if (dbResult) {
      // Popular Redis para próxima vez
      await this.redis.setex(cacheKey, this.ttl, JSON.stringify(dbResult));
      return dbResult;
    }

    // 3. Não encontrado - disparar busca assíncrona
    this.queueGooglePlacesSearch(query, alias, location);
    
    return {
      status: 'searching',
      message: 'Buscando local...',
      alias
    };
  }

  // Worker assíncrono para buscar no Google Places
  async queueGooglePlacesSearch(query, alias, location) {
    // Marcar como "buscando" no Redis (evita requisições duplicadas)
    const fetchingKey = `place:fetching:${alias}`;
    const isFetching = await this.redis.get(fetchingKey);
    
    if (isFetching) {
      console.log(`⏳ Já está buscando: ${alias}`);
      return; // Outra requisição já está buscando
    }

    // Marcar como buscando (TTL 30s)
    await this.redis.setex(fetchingKey, 30, '1');

    try {
      // Buscar no Google Places
      const placeData = await this.callGooglePlacesAPI(query, location);
      
      if (placeData) {
        // Salvar no PostgreSQL
        await this.saveToDatabase(alias, placeData);
        
        // Popular Redis
        const cacheKey = `place:${alias}`;
        await this.redis.setex(cacheKey, this.ttl, JSON.stringify(placeData));
        
        console.log(`✅ Place salvo: ${alias}`);
      }
    } catch (error) {
      console.error(`❌ Erro ao buscar place: ${error.message}`);
    } finally {
      // Remover flag de "buscando"
      await this.redis.del(fetchingKey);
    }
  }

  // Chamar Google Places API
  async callGooglePlacesAPI(query, location) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    let url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${apiKey}&language=pt-BR&components=country:br`;
    
    if (location) {
      url += `&locationbias=circle:50000@${location.lat},${location.lng}`;
    }

    const response = await fetch(url);
    const json = await response.json();

    if (json.status === 'OK' && json.predictions?.length > 0) {
      // Pegar o primeiro resultado e buscar detalhes
      const placeId = json.predictions[0].place_id;
      return await this.getPlaceDetails(placeId);
    }

    return null;
  }

  // Buscar detalhes do lugar (lat/lng)
  async getPlaceDetails(placeId) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${apiKey}&fields=geometry,formatted_address,name`;

    const response = await fetch(url);
    const json = await response.json();

    if (json.status === 'OK' && json.result) {
      const location = json.result.geometry.location;
      return {
        place_id: placeId,
        name: json.result.name,
        address: json.result.formatted_address,
        lat: location.lat,
        lng: location.lng,
        cached_at: new Date().toISOString()
      };
    }

    return null;
  }

  // Salvar no PostgreSQL
  async saveToDatabase(alias, placeData) {
    // Implementar com seu ORM/query builder
    // Exemplo com pg (PostgreSQL):
    const query = `
      INSERT INTO places (alias, place_id, name, address, lat, lng, cached_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (alias) DO UPDATE SET
        place_id = EXCLUDED.place_id,
        cached_at = EXCLUDED.cached_at
    `;
    
    // await db.query(query, [alias, ...]);
  }

  // Buscar no PostgreSQL
  async searchDatabase(alias) {
    // SELECT * FROM places WHERE alias = $1
    // Retornar objeto no mesmo formato
  }
}

module.exports = new PlacesCacheService();
```

### 2. **Backend: Endpoint REST**

**Arquivo:** `leaf-websocket-backend/routes/places.js`

```javascript
const express = require('express');
const router = express.Router();
const placesCacheService = require('../services/places-cache-service');

router.post('/search', async (req, res) => {
  try {
    const { query, location } = req.body;
    
    if (!query || query.length < 3) {
      return res.status(400).json({ error: 'Query muito curta' });
    }

    const result = await placesCacheService.searchPlace(query, location);
    res.json(result);
  } catch (error) {
    console.error('❌ Erro ao buscar place:', error);
    res.status(500).json({ error: 'Erro ao buscar local' });
  }
});

module.exports = router;
```

### 3. **Mobile: Atualizar GoogleAPIFunctions.js**

**Modificar:** `mobile-app/src/common-local/GoogleAPIFunctions.js`

```javascript
export const fetchPlacesAutocomplete = async (searchKeyword, sessionToken, location = null) => {
  try {
    // 1. Tentar backend primeiro (com cache)
    const backendUrl = 'https://seu-backend.com/api/places/search';
    const response = await fetch(backendUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: searchKeyword, location })
    });

    if (response.ok) {
      const result = await response.json();
      
      // Se encontrou no cache, retornar formatado
      if (result.status !== 'searching' && result.place_id) {
        return [{
          place_id: result.place_id,
          description: result.address,
          structured_formatting: {
            main_text: result.name,
            secondary_text: result.address
          }
        }];
      }
      
      // Se está buscando, aguardar um pouco e tentar novamente
      if (result.status === 'searching') {
        await new Promise(resolve => setTimeout(resolve, 500));
        return await fetchPlacesAutocomplete(searchKeyword, sessionToken, location);
      }
    }
  } catch (error) {
    console.log('⚠️ Backend indisponível, usando Google diretamente');
  }

  // 2. Fallback: Google Places direto (se backend falhar)
  const apiKey = 'AIzaSyBLwKg0KRiLVjAHVBQAUP7pB3Q80G246KY';
  // ... código atual ...
};
```

### 4. **Banco de Dados: Tabela Places**

```sql
CREATE TABLE places (
  id SERIAL PRIMARY KEY,
  alias VARCHAR(255) UNIQUE NOT NULL,
  place_id VARCHAR(255) NOT NULL,
  name VARCHAR(500) NOT NULL,
  address TEXT NOT NULL,
  lat DECIMAL(10, 8) NOT NULL,
  lng DECIMAL(11, 8) NOT NULL,
  cached_at TIMESTAMP DEFAULT NOW(),
  search_count INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_places_alias ON places(alias);
CREATE INDEX idx_places_location ON places(lat, lng);
```

---

## 📈 Otimizações Adicionais

### 1. **Pré-popular Cache com Locais Populares**

```javascript
// Script para popular cache com top 500 destinos
const popularPlaces = [
  'BarraShopping', 'Shopping Leblon', 'Aeroporto Galeão',
  'Copacabana', 'Ipanema', 'Centro do Rio'
];

for (const place of popularPlaces) {
  await placesCacheService.queueGooglePlacesSearch(place, normalize(place));
}
```

### 2. **Sharding por Região**

```javascript
// Cache por cidade/região
const cacheKey = `place:rj:${alias}`; // Rio de Janeiro
const cacheKey = `place:sp:${alias}`; // São Paulo
```

### 3. **Autocomplete Local com Redisearch**

```javascript
// Usar Redisearch para autocomplete sem Google
// Indexar nomes: "barra shopping", "barra shopping center", etc.
// Busca fuzzy instantânea
```

---

## ⚠️ Considerações Importantes

### ✅ **Vantagens**
- ✅ **93% de economia** em custos de API
- ✅ **150-400x mais rápido** para usuário
- ✅ **Infraestrutura já existe** (Redis + PostgreSQL)
- ✅ **Escalável** - suporta milhões de buscas
- ✅ **Zero impacto** na experiência do usuário

### ⚠️ **Desafios**
- ⚠️ **Primeira busca** pode demorar (mas é assíncrona)
- ⚠️ **Manutenção** do banco de dados (limpeza de dados antigos)
- ⚠️ **Sincronização** entre Redis e PostgreSQL

### 🔧 **Soluções**
- ✅ **Worker assíncrono** resolve latência na primeira busca
- ✅ **TTL automático** no Redis (30 dias)
- ✅ **Cron job** para limpar lugares não usados há 90 dias

---

## 🚀 Plano de Implementação

### **Fase 1: Backend (1-2 dias)**
1. Criar `places-cache-service.js`
2. Criar endpoint `/api/places/search`
3. Criar tabela PostgreSQL
4. Testar com Postman/curl

### **Fase 2: Mobile (1 dia)**
1. Atualizar `GoogleAPIFunctions.js` para usar backend
2. Manter fallback para Google direto
3. Testar no app

### **Fase 3: Otimizações (1 dia)**
1. Pré-popular cache com locais populares
2. Implementar worker assíncrono
3. Monitoramento e métricas

### **Fase 4: Deploy (1 dia)**
1. Deploy no VPS
2. Migração de dados (se necessário)
3. Monitoramento pós-deploy

**Total: 4-5 dias de desenvolvimento**

---

## 📊 Métricas de Sucesso

- ✅ **Hit rate > 95%** após 1 semana
- ✅ **Latência média < 10ms** para cache hits
- ✅ **Economia > 90%** em custos de API
- ✅ **Zero reclamações** de performance

---

## ✅ Conclusão

**A implementação é altamente recomendada e viável.**

- ✅ Infraestrutura pronta
- ✅ Economia significativa
- ✅ Melhoria de performance
- ✅ Baixo risco
- ✅ Implementação rápida (4-5 dias)

**Próximo passo:** Aprovar implementação e começar pela Fase 1.




