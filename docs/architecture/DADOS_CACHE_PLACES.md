# 💾 Dados Salvos no Cache de Places

## 📊 **ESTRUTURA DE DADOS SALVOS**

### Dados Salvos no Redis (Cache Rápido)

O cache salva os seguintes campos em formato JSON:

```javascript
{
  alias: "barra_shopping",              // Chave normalizada (única)
  query: "BarraShopping",                // Query original do usuário
  place_id: "ChIJ...",                  // Place ID do Google Places
  name: "BarraShopping",                // Nome do lugar
  address: "Av. das Américas, 4666...", // Endereço completo
  lat: -22.9708,                        // Latitude
  lng: -43.3656,                        // Longitude
  cached_at: "2025-01-15T10:30:00.000Z" // Data/hora do cache
}
```

---

## 🔑 **CHAVE DE CACHE (Redis)**

### Formato da Chave:
```
place:{alias}
```

### Exemplo:
```
place:barra_shopping
```

### TTL (Time To Live):
- **30 dias** (2.592.000 segundos)
- Após 30 dias, o cache expira automaticamente

---

## 📋 **DETALHAMENTO DOS CAMPOS**

### 1. **alias** (String)
- **Tipo**: String normalizada
- **Exemplo**: `"barra_shopping"`
- **Função**: Chave única para identificar o lugar no cache
- **Normalização**: 
  - Remove acentos
  - Converte para minúsculas
  - Remove pontuação
  - Substitui espaços por underscore
  - Remove múltiplos underscores

**Exemplos de normalização:**
- `"BarraShopping"` → `"barra_shopping"`
- `"Barra Shopping"` → `"barra_shopping"`
- `"barra shopping center"` → `"barra_shopping_center"`
- `"Aeroporto Galeão"` → `"aeroporto_galeao"`

---

### 2. **query** (String)
- **Tipo**: String original
- **Exemplo**: `"BarraShopping"`
- **Função**: Preserva a query original do usuário para referência
- **Uso**: Pode ser útil para logs ou debug

---

### 3. **place_id** (String)
- **Tipo**: String (Place ID do Google Places)
- **Exemplo**: `"ChIJN1t_tDeuEmsRUsoyG83frY4"`
- **Função**: Identificador único do Google Places
- **Importante**: Usado para buscar detalhes adicionais se necessário

---

### 4. **name** (String)
- **Tipo**: String
- **Exemplo**: `"BarraShopping"`
- **Função**: Nome oficial do lugar
- **Fonte**: Google Places API

---

### 5. **address** (String)
- **Tipo**: String (endereço completo)
- **Exemplo**: `"Av. das Américas, 4666 - Barra da Tijuca, Rio de Janeiro - RJ, 22640-100, Brasil"`
- **Função**: Endereço formatado do lugar
- **Fonte**: Google Places API (`formatted_address`)

---

### 6. **lat** (Number)
- **Tipo**: Decimal (10, 8)
- **Exemplo**: `-22.9708`
- **Função**: Latitude do lugar
- **Precisão**: 8 casas decimais (precisão de ~1mm)

---

### 7. **lng** (Number)
- **Tipo**: Decimal (11, 8)
- **Exemplo**: `-43.3656`
- **Função**: Longitude do lugar
- **Precisão**: 8 casas decimais (precisão de ~1mm)

---

### 8. **cached_at** (String ISO 8601)
- **Tipo**: String (ISO 8601 timestamp)
- **Exemplo**: `"2025-01-15T10:30:00.000Z"`
- **Função**: Data/hora em que o lugar foi salvo no cache
- **Uso**: Útil para monitoramento e limpeza de cache antigo

---

## 🗄️ **ESTRUTURA PROPOSTA PARA POSTGRESQL**

### Tabela: `places`

```sql
CREATE TABLE places (
  id SERIAL PRIMARY KEY,
  alias VARCHAR(255) UNIQUE NOT NULL,    -- Chave normalizada (índice único)
  place_id VARCHAR(255) NOT NULL,        -- Place ID do Google
  name VARCHAR(500) NOT NULL,            -- Nome do lugar
  address TEXT NOT NULL,                  -- Endereço completo
  lat DECIMAL(10, 8) NOT NULL,           -- Latitude
  lng DECIMAL(11, 8) NOT NULL,           -- Longitude
  cached_at TIMESTAMP DEFAULT NOW(),     -- Data do cache
  search_count INTEGER DEFAULT 1,        -- Contador de buscas
  created_at TIMESTAMP DEFAULT NOW(),    -- Data de criação
  updated_at TIMESTAMP DEFAULT NOW()     -- Última atualização
);

-- Índices para performance
CREATE INDEX idx_places_alias ON places(alias);
CREATE INDEX idx_places_location ON places(lat, lng);
CREATE INDEX idx_places_place_id ON places(place_id);
```

### Campos Adicionais no PostgreSQL (não no Redis):

- **id**: ID sequencial (auto-incremento)
- **search_count**: Contador de quantas vezes foi buscado
- **created_at**: Data de criação no banco
- **updated_at**: Data da última atualização

---

## 📝 **EXEMPLO PRÁTICO**

### Entrada do Usuário:
```
Query: "BarraShopping"
```

### Processo de Normalização:
```javascript
normalizeQuery("BarraShopping")
// 1. trim() → "BarraShopping"
// 2. replace(/([a-z])([A-Z])/g, '$1_$2') → "Barra_Shopping"
// 3. toLowerCase() → "barra_shopping"
// 4. normalize('NFD') → "barra_shopping"
// 5. replace(/[\u0300-\u036f]/g, '') → "barra_shopping" (sem acentos)
// 6. replace(/[^\w\s]/g, '') → "barra_shopping" (sem pontuação)
// 7. replace(/\s+/g, '_') → "barra_shopping" (espaços → underscore)
// 8. replace(/_+/g, '_') → "barra_shopping" (underscores múltiplos)
// 9. replace(/^_|_$/g, '') → "barra_shopping" (remove início/fim)
// Resultado: "barra_shopping"
```

### Dados Salvos no Redis:

**Chave:** `place:barra_shopping`

**Valor (JSON):**
```json
{
  "alias": "barra_shopping",
  "query": "BarraShopping",
  "place_id": "ChIJN1t_tDeuEmsRUsoyG83frY4",
  "name": "BarraShopping",
  "address": "Av. das Américas, 4666 - Barra da Tijuca, Rio de Janeiro - RJ, 22640-100, Brasil",
  "lat": -22.9708,
  "lng": -43.3656,
  "cached_at": "2025-01-15T10:30:00.000Z"
}
```

### Dados Salvos no PostgreSQL (quando implementado):

```sql
INSERT INTO places (
  alias, 
  place_id, 
  name, 
  address, 
  lat, 
  lng, 
  cached_at,
  search_count
) VALUES (
  'barra_shopping',
  'ChIJN1t_tDeuEmsRUsoyG83frY4',
  'BarraShopping',
  'Av. das Américas, 4666 - Barra da Tijuca, Rio de Janeiro - RJ, 22640-100, Brasil',
  -22.9708,
  -43.3656,
  '2025-01-15 10:30:00',
  1
);
```

---

## 🔄 **FLUXO DE SALVAMENTO**

### 1. Usuário busca "BarraShopping"
```
Query original: "BarraShopping"
```

### 2. Sistema normaliza a query
```
Alias gerado: "barra_shopping"
Chave Redis: "place:barra_shopping"
```

### 3. Busca no cache (Redis)
```
GET place:barra_shopping
```

### 4. Se não encontrar (cache miss):
- Busca no Google Places API
- Recebe dados do Google
- Salva no Redis com TTL de 30 dias
- (Futuro) Salva no PostgreSQL para persistência

### 5. Dados salvos:
```javascript
{
  alias: "barra_shopping",           // Chave normalizada
  query: "BarraShopping",             // Query original
  place_id: "...",                    // Do Google Places
  name: "...",                        // Do Google Places
  address: "...",                     // Do Google Places
  lat: -22.9708,                      // Do Google Places
  lng: -43.3656,                      // Do Google Places
  cached_at: "2025-01-15T10:30:00.000Z" // Timestamp atual
}
```

---

## ✅ **RESUMO DOS DADOS NECESSÁRIOS**

### Mínimo Necessário para Funcionar:

1. ✅ **alias** - Chave única normalizada
2. ✅ **place_id** - ID do Google Places
3. ✅ **name** - Nome do lugar
4. ✅ **address** - Endereço completo
5. ✅ **lat** - Latitude
6. ✅ **lng** - Longitude
7. ✅ **cached_at** - Timestamp do cache

### Dados Opcionais (mas úteis):

- **query** - Query original (para referência)
- **search_count** - Contador de buscas (PostgreSQL)
- **created_at** - Data de criação (PostgreSQL)
- **updated_at** - Data de atualização (PostgreSQL)

---

## 🎯 **POR QUE ESSES DADOS?**

### Dados Essenciais:
- **alias**: Identifica o lugar de forma única
- **lat/lng**: Coordenadas necessárias para calcular rotas
- **address**: Exibição para o usuário
- **name**: Nome do lugar para exibição
- **place_id**: Pode ser usado para buscar mais detalhes se necessário

### Dados de Metadados:
- **cached_at**: Monitoramento e limpeza de cache antigo
- **query**: Referência para debug/logs

---

## 📊 **TAMANHO ESTIMADO DOS DADOS**

### Por registro no Redis:
- **alias**: ~20 bytes
- **query**: ~20 bytes
- **place_id**: ~30 bytes
- **name**: ~30 bytes
- **address**: ~100 bytes
- **lat/lng**: ~20 bytes
- **cached_at**: ~30 bytes
- **Overhead JSON**: ~50 bytes

**Total estimado: ~300 bytes por lugar**

### Capacidade:
- **1.000 lugares**: ~300 KB
- **10.000 lugares**: ~3 MB
- **100.000 lugares**: ~30 MB

**Muito eficiente para Redis!** ✅

---

## 🔍 **EXEMPLOS DE NORMALIZAÇÃO**

| Query Original | Alias Normalizado |
|----------------|-------------------|
| `"BarraShopping"` | `"barra_shopping"` |
| `"Barra Shopping"` | `"barra_shopping"` |
| `"barra shopping center"` | `"barra_shopping_center"` |
| `"Aeroporto Galeão"` | `"aeroporto_galeao"` |
| `"Copacabana Beach"` | `"copacabana_beach"` |
| `"Shopping Leblon"` | `"shopping_leblon"` |
| `"Ipanema - RJ"` | `"ipanema_rj"` |
| `"Centro do Rio"` | `"centro_do_rio"` |

**Todas essas variações apontam para o mesmo lugar no cache!** ✅

---

## ✅ **CONCLUSÃO**

### Dados Salvos no Cache:

**Redis (Cache Rápido):**
- 7 campos essenciais
- TTL de 30 dias
- Formato JSON
- Chave: `place:{alias}`

**PostgreSQL (Persistência - Futuro):**
- Mesmos 7 campos + campos adicionais (id, search_count, timestamps)
- Índices para performance
- Persistência permanente

### Essenciais para Funcionar:
1. ✅ Alias normalizado (chave única)
2. ✅ Coordenadas (lat/lng)
3. ✅ Endereço e nome (exibição)
4. ✅ Place ID (referência Google)

**Com esses dados, o cache funciona perfeitamente!** 🚀






