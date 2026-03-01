# 🚇 Script de População: Estações de Transporte Público

## 📋 **OBJETIVO**

Popular o cache de Places com estações de transporte público (trem, metrô, BRT, pontos de ônibus) do OpenStreetMap, usando um prefixo diferente para evitar conflitos com estabelecimentos comerciais.

## 🔑 **DIFERENÇA DO SCRIPT PRINCIPAL**

- **Script principal** (`populate-places-osm.js`): Estabelecimentos comerciais (shoppings, restaurantes, etc.)
- **Este script** (`populate-transport-stations-osm.js`): Apenas estações de transporte público

### Prefixo de Transporte

Todas as estações são salvas com prefixo `transport_` no alias:
- Estabelecimento: `place:barra_shopping`
- Estação: `place:transport_barra_shopping`

Isso evita conflitos quando uma estação e um estabelecimento têm o mesmo nome.

## 🚀 **COMO USAR**

```bash
cd leaf-websocket-backend
node scripts/populate-transport-stations-osm.js
```

## 📊 **TIPOS DE ESTAÇÕES CAPTURADAS**

1. **BRT Stations** (`brt_station`)
   - `public_transport=station` + `network=TransOeste/TransCarioca/TransOlímpica`

2. **Metrô** (`metro_station`)
   - `amenity=subway_entrance`
   - `railway=subway_entrance`
   - `railway=station` (com contexto de metrô)

3. **Trem** (`train_station`)
   - `railway=station` (estações de trem)

4. **Pontos de Ônibus** (`bus_stop`)
   - `highway=bus_stop` (apenas os principais com nome)

5. **Terminais de Ônibus** (`bus_station`)
   - `amenity=bus_station`

## ✅ **VALIDAÇÃO**

O script só salva estações que têm:
- Nome válido (mínimo 3 caracteres)
- Coordenadas (lat/lng)
- Endereço válido (nome + bairro + cidade, ou endereço completo)

## 📈 **ESTATÍSTICAS ESPERADAS**

Para o Rio de Janeiro, esperamos capturar:
- ~50-100 estações de BRT
- ~50-80 estações de metrô
- ~20-30 estações de trem
- ~200-500 pontos de ônibus principais (com nome)
- **Total estimado: 300-700 estações**

## 🔄 **INTEGRAÇÃO COM O APP**

O app pode buscar estações usando o prefixo:
```javascript
// Buscar estação específica
const alias = normalizeQuery('Barra Shopping');
const stationAlias = `transport_${alias}`;
const station = await redis.get(`place:${stationAlias}`);
```

Ou filtrar por categoria:
```javascript
// Buscar todas as estações BRT
const keys = await redis.keys('place:transport_*');
const stations = await Promise.all(keys.map(k => redis.get(k)));
const brtStations = stations
  .map(s => JSON.parse(s))
  .filter(s => s.transport_type === 'brt_station');
```

## ⚠️ **NOTAS IMPORTANTES**

1. **Não sobrescreve dados do Google**: Se uma estação já existe com dados do Google, não será sobrescrita
2. **Validação de endereço**: Aceita endereços parciais (bairro + cidade) para estações, diferente do script principal
3. **TTL**: 30 dias (mesmo do script principal)
4. **Conflitos**: O prefixo `transport_` garante que não haverá conflito com estabelecimentos

## 🧪 **TESTES**

Antes de executar o script completo, teste com um quadrante pequeno:

```javascript
const { processQuadrant } = require('./populate-transport-stations-osm');
const testBbox = [-22.98, -43.2, -22.96, -43.18]; // Copacabana
processQuadrant(testBbox, 0).then(console.log);
```
































