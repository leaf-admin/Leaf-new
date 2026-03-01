/**
 * Script para popular cache de Places com dados do OpenStreetMap (OSM)
 * 
 * Este script busca lugares do Rio de Janeiro via Overpass API e salva no Redis
 * como seed inicial do cache. Dados do Google Places sempre têm prioridade.
 * 
 * Uso:
 *   node scripts/populate-places-osm.js
 * 
 * Requisitos:
 *   - Redis rodando e acessível
 *   - Node.js 18+ (para fetch nativo)
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');
const { normalizeQuery } = require('../utils/places-normalizer');

// Configurações
const redis = redisPool.getConnection();
const CACHE_TTL = 30 * 24 * 60 * 60; // 30 dias em segundos

// Bbox do Rio de Janeiro dividido em 4 quadrantes
// Formato: [south, west, north, east]
const RIO_QUADRANTS = [
  [-23.0823, -43.7958, -22.9123, -43.4474], // Sudoeste
  [-23.0823, -43.4474, -22.9123, -43.0990], // Sudeste
  [-22.9123, -43.7958, -22.7423, -43.4474], // Noroeste
  [-22.9123, -43.4474, -22.7423, -43.0990]  // Nordeste
];

// Lugares conhecidos com endereços manuais (quando OSM não tem dados)
// Chave: alias normalizado, Valor: endereço completo
const KNOWN_ADDRESSES = {
  'barra_shopping': 'Av. das Américas, 4666 - Barra da Tijuca, Rio de Janeiro - RJ, 22640-102',
  'shopping_cidade_copacabana': 'Rua Siqueira Campos, 143 - Copacabana, Rio de Janeiro - RJ',
  'leopoldina_shopping': 'Av. Dom Helder Câmara, 5080 - Cachambi, Rio de Janeiro - RJ',
  'penha_shopping': 'Rua Padre Januário, 100 - Penha, Rio de Janeiro - RJ',
  'caxias_shopping': 'Av. Brasil, 2000 - Duque de Caxias - RJ',
  'rio_sul': 'Av. Lauro Sodré, 446 - Botafogo, Rio de Janeiro - RJ',
  'village_mall': 'Av. das Américas, 3900 - Barra da Tijuca, Rio de Janeiro - RJ',
  'shopping_center_rio': 'Av. Marques de São Vicente, 52 - Gávea, Rio de Janeiro - RJ'
};

/**
 * Formata endereço a partir de tags OSM
 * @param {object} tags - Tags do elemento OSM
 * @returns {string} - Endereço formatado
 */
function formatAddress(tags = {}, alias = null) {
  // Prioridade 0: Verificar se temos endereço conhecido manualmente
  if (alias && KNOWN_ADDRESSES[alias]) {
    return KNOWN_ADDRESSES[alias];
  }
  
  // Prioridade 1: Tags de endereço completas do OSM
  if (tags["addr:street"] || tags["addr:housenumber"]) {
    const parts = [
      tags["addr:street"],
      tags["addr:housenumber"],
      tags["addr:neighborhood"] || tags["addr:suburb"],
      tags["addr:city"] || "Rio de Janeiro",
      tags["addr:state"] || "RJ",
      tags["addr:postcode"]
    ].filter(Boolean);
    
    if (parts.length > 0) {
      return parts.join(", ");
    }
  }
  
  // Prioridade 2: Tentar construir com dados parciais (bairro, cidade, estado)
  const partialParts = [
    tags["addr:neighborhood"] || tags["addr:suburb"],
    tags["addr:city"] || "Rio de Janeiro",
    tags["addr:state"] || "RJ"
  ].filter(Boolean);
  
  // Se tem bairro + cidade, usar
  if (partialParts.length >= 2 && (tags["addr:neighborhood"] || tags["addr:suburb"])) {
    return partialParts.join(", ");
  }
  
  // Prioridade 3: Usar nome do lugar + cidade padrão (sempre melhor que só cidade)
  if (tags.name) {
    return `${tags.name}, Rio de Janeiro, RJ`;
  }
  
  // Fallback: só cidade + estado
  if (partialParts.length > 0) {
    return partialParts.join(", ");
  }
  
  return "Endereço não disponível";
}

/**
 * Gera query Overpass para um bbox
 * @param {array} bbox - [south, west, north, east]
 * @returns {string} - Query Overpass
 */
function generateOverpassQuery(bbox) {
  const [south, west, north, east] = bbox;
  return `
[out:json][timeout:60];
(
  // Busca ampla: ways (áreas) e nodes (pontos)
  // Priorizar ways sobre nodes (ways têm mais dados como endereços)
  way["amenity"]["name"](${south},${west},${north},${east});
  way["shop"]["name"](${south},${west},${north},${east});
  way["leisure"]["name"](${south},${west},${north},${east});
  way["building"~"church|hospital|mall|retail|commercial"]["name"](${south},${west},${north},${east});
  // Nodes para lugares que não têm way correspondente
  node["amenity"]["name"](${south},${west},${north},${east});
  node["shop"]["name"](${south},${west},${north},${east});
  node["leisure"]["name"](${south},${west},${north},${east});
  node["building"~"church|hospital|mall"]["name"](${south},${west},${north},${east});
);
out center;
`;
}

/**
 * Busca dados do Overpass API com retry
 * @param {array} bbox - [south, west, north, east]
 * @param {number} maxRetries - Número máximo de tentativas (padrão: 3)
 * @returns {Promise<array>} - Array de elementos OSM
 */
async function fetchOSMData(bbox, maxRetries = 3) {
  const url = "https://overpass-api.de/api/interpreter";
  const query = generateOverpassQuery(bbox);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 2), 10000); // Backoff exponencial (max 10s)
        logger.info(`🔄 Tentativa ${attempt}/${maxRetries} após ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        logger.info(`🔍 Buscando dados OSM para bbox: ${bbox.join(',')}`);
      }
      
      const res = await fetch(url, {
        method: "POST",
        headers: { 'Content-Type': 'text/plain' },
        body: query,
      });

      if (!res.ok) {
        // Se for 504 (Gateway Timeout) ou 429 (Too Many Requests), tentar novamente
        if ((res.status === 504 || res.status === 429) && attempt < maxRetries) {
          logger.warn(`⚠️ HTTP ${res.status}, tentando novamente...`);
          continue;
        }
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json = await res.json();
      const elements = json.elements || [];
      
      if (attempt > 1) {
        logger.info(`✅ Sucesso na tentativa ${attempt}`);
      }
      
      return elements;
    } catch (error) {
      if (attempt === maxRetries) {
        logger.error(`❌ Erro ao buscar OSM após ${maxRetries} tentativas: ${error.message}`);
        return [];
      }
      // Continuar para próxima tentativa
      logger.warn(`⚠️ Erro na tentativa ${attempt}: ${error.message}`);
    }
  }
  
  return [];
}

/**
 * Salva lugar no Redis
 * @param {object} place - Elemento OSM
 * @returns {Promise<boolean>} - true se salvou com sucesso
 */
async function saveToRedis(place) {
  try {
    if (!place.tags?.name) {
      return false;
    }

    // Filtrar estações de transporte público (bus stop, BRT station, metrô, etc)
    // MAS: não ignorar se for um shopping/estabelecimento com endereço completo
    // (shoppings podem ter estações dentro, mas ainda são shoppings)
    
    const isShopping = place.tags.shop === 'mall' || 
                       place.tags.building === 'mall' || 
                       place.tags.building === 'retail' ||
                       place.tags.building === 'commercial';
    
    const hasOSMAddressTags = place.tags['addr:street'] && place.tags['addr:housenumber'];
    
    // Se é um shopping ou tem tags de endereço no OSM, NÃO ignorar (é um estabelecimento válido)
    if (isShopping || hasOSMAddressTags) {
      // Não filtrar - é um estabelecimento comercial válido
    } else {
      // Filtrar apenas estações de transporte puro (sem estabelecimento comercial)
      if (place.tags.public_transport === 'station' || 
          place.tags.amenity === 'bus_station' || 
          place.tags.amenity === 'subway_entrance' ||
          place.tags.highway === 'bus_stop' ||
          (place.tags.operator === 'BRTRio' || place.tags.operator === 'BRT Rio') ||
          (place.tags.network === 'TransOeste' || place.tags.network === 'TransCarioca' || place.tags.network === 'TransOlímpica') ||
          (place.tags.shop === 'ticket' && place.tags.operator && place.tags.operator.includes('BRT'))) {
        return false; // Ignorar estações de transporte público puro
      }
    }

    const name = place.tags.name.trim();
    if (name.length < 3) {
      return false;
    }

    const alias = normalizeQuery(name);
    if (!alias || alias.length < 3) {
      logger.warn(`⚠️ Alias inválido para: ${name}`);
      return false;
    }

    // Verificar se já existe (não sobrescrever dados do Google)
    const existing = await redis.get(`place:${alias}`);
    if (existing) {
      const existingData = JSON.parse(existing);
      // Se já tem dados do Google, não sobrescrever com OSM
      if (existingData.source === 'google' || existingData.place_id?.startsWith('ChIJ')) {
        logger.debug(`⏭️ Place já existe (Google): ${alias}`);
        return false;
      }
      
      // Se já existe um node (ponto) e estamos salvando um way (área), priorizar o way
      // Ways têm mais dados (endereços completos, etc)
      if (existingData.source === 'osm') {
        const existingOsmType = existingData.osm_type; // node ou way (pode ser undefined para registros antigos)
        const currentOsmType = place.type; // node ou way
        
        // Se o registro antigo não tem osm_type mas o novo é way, substituir (way é melhor)
        if (!existingOsmType && currentOsmType === 'way') {
          logger.info(`🔄 Substituindo registro antigo por way para: ${alias} (way tem mais dados)`);
        } else if (existingOsmType === 'node' && currentOsmType === 'way') {
          // Substituir node por way (way tem mais dados)
          logger.info(`🔄 Substituindo node por way para: ${alias} (way tem mais dados)`);
        } else if (existingOsmType === 'way' && currentOsmType === 'node') {
          // Não substituir way por node (way é melhor)
          logger.debug(`⏭️ Way já existe, ignorando node: ${alias}`);
          return false;
        } else if (existingOsmType === 'way' && currentOsmType === 'way') {
          // Se ambos são ways, verificar qual tem mais dados (endereço completo)
          const existingHasAddress = existingData.address && existingData.address.includes(',') && !existingData.address.includes('Rio de Janeiro, RJ'); // Endereço completo
          const currentHasAddress = place.tags && (place.tags['addr:street'] || place.tags['addr:housenumber']);
          
          if (currentHasAddress && !existingHasAddress) {
            logger.info(`🔄 Substituindo way antigo por way com endereço completo para: ${alias}`);
          } else {
            logger.debug(`⏭️ Way já existe com dados similares: ${alias}`);
            return false;
          }
        }
      }
    }

    const lat = place.lat || place.center?.lat;
    const lng = place.lon || place.center?.lon;

    if (!lat || !lng) {
      logger.warn(`⚠️ Place sem coordenadas: ${name}`);
      return false;
    }

    // Extrair categoria de forma mais inteligente
    const getCategory = (tags) => {
      // Prioridade 1: shop (ex: shop=mall, shop=supermarket)
      if (tags.shop) {
        return `shop:${tags.shop}`;
      }
      // Prioridade 2: amenity (ex: amenity=restaurant, amenity=hospital)
      if (tags.amenity) {
        return `amenity:${tags.amenity}`;
      }
      // Prioridade 3: leisure (ex: leisure=park, leisure=fitness_centre)
      if (tags.leisure) {
        return `leisure:${tags.leisure}`;
      }
      // Prioridade 4: building com valor específico (ex: building=mall, building=hospital)
      if (tags.building && tags.building !== 'yes') {
        return `building:${tags.building}`;
      }
      // Prioridade 5: building genérico
      if (tags.building) {
        return 'building';
      }
      // Prioridade 6: highway (ex: highway=bus_stop)
      if (tags.highway) {
        return `highway:${tags.highway}`;
      }
      // Fallback: primeira tag relevante
      const relevantKey = Object.keys(tags).find(k => 
        k !== 'name' && 
        !k.startsWith('addr:') && 
        !k.startsWith('source:') &&
        !k.startsWith('ref:') &&
        k !== 'operator' &&
        k !== 'phone' &&
        k !== 'website'
      );
      return relevantKey || null;
    };

    // Usar endereço conhecido se disponível, mesmo que OSM tenha dados parciais
    const address = formatAddress(place.tags, alias);
    
    // ✅ VALIDAÇÃO CRÍTICA: Só salvar se tiver endereço completo (rua + número)
    // Lugares sem endereço completo não servem para traçar rotas e vão chamar Google Places de qualquer forma
    const hasCompleteAddress = address && 
                                address !== "Endereço não disponível" &&
                                !address.endsWith(', Rio de Janeiro, RJ') &&
                                address !== `${name}, Rio de Janeiro, RJ` &&
                                (address.includes(',') && address.split(',').length >= 3); // Rua, número, bairro/cidade
    
    if (!hasCompleteAddress) {
      logger.debug(`⏭️ Place sem endereço completo ignorado: ${name} (${address})`);
      return false;
    }
    
    const payload = {
      alias,
      query: name,
      place_id: `osm_${place.id}`,
      name: name,
      address: address,
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      cached_at: new Date().toISOString(),
      source: 'osm',
      category: getCategory(place.tags),
      osm_type: place.type // Adicionar tipo OSM para debug
    };

    await redis.setex(`place:${alias}`, CACHE_TTL, JSON.stringify(payload));
    logger.info(`✅ Place salvo: ${alias} (${name})`);
    
    return true;
  } catch (error) {
    logger.error(`❌ Erro ao salvar place ${place.id}: ${error.message}`);
    return false;
  }
}

/**
 * Processa um quadrante completo
 * @param {array} bbox - [south, west, north, east]
 * @param {number} quadrantNum - Número do quadrante (1-4)
 * @returns {Promise<object>} - Estatísticas {saved, skipped, errors}
 */
async function processQuadrant(bbox, quadrantNum) {
  logger.info(`\n📍 Processando quadrante ${quadrantNum}/4: ${bbox.join(',')}`);
  
  const places = await fetchOSMData(bbox);
  logger.info(`📊 Encontrados ${places.length} lugares no quadrante ${quadrantNum}`);

  let saved = 0;
  let skipped = 0;
  let errors = 0;

  for (const place of places) {
    const result = await saveToRedis(place);
    if (result) {
      saved++;
    } else if (place.tags?.name) {
      skipped++;
    } else {
      errors++;
    }

    // Log progresso a cada 100 lugares
    if ((saved + skipped + errors) % 100 === 0) {
      logger.info(`⏳ Progresso: ${saved} salvos, ${skipped} ignorados, ${errors} erros`);
    }
  }

  logger.info(`✅ Quadrante ${quadrantNum} concluído: ${saved} salvos, ${skipped} ignorados, ${errors} erros`);
  
  return { saved, skipped, errors };
}

/**
 * Função principal
 */
async function main() {
  logger.info('🚀 Iniciando população do cache Places com dados OSM');
  logger.info(`📦 TTL do cache: ${CACHE_TTL / 86400} dias`);

  let totalSaved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (let i = 0; i < RIO_QUADRANTS.length; i++) {
    const result = await processQuadrant(RIO_QUADRANTS[i], i + 1);
    totalSaved += result.saved;
    totalSkipped += result.skipped;
    totalErrors += result.errors;

    // Aguardar entre quadrantes para não sobrecarregar API
    if (i < RIO_QUADRANTS.length - 1) {
      logger.info('⏳ Aguardando 5 segundos antes do próximo quadrante...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  logger.info('\n🎉 População concluída!');
  logger.info(`📊 Estatísticas finais:`);
  logger.info(`   ✅ Salvos: ${totalSaved}`);
  logger.info(`   ⏭️ Ignorados: ${totalSkipped}`);
  logger.info(`   ❌ Erros: ${totalErrors}`);
  logger.info(`   📦 Total processado: ${totalSaved + totalSkipped + totalErrors}`);
}

// Executar se chamado diretamente
if (require.main === module) {
  main().catch(error => {
    logger.error(`❌ Erro fatal: ${error.message}`);
    process.exit(1);
  });
}

// Exportar getCategory para testes
function getCategory(tags) {
  if (tags.shop) {
    return `shop:${tags.shop}`;
  }
  if (tags.amenity) {
    return `amenity:${tags.amenity}`;
  }
  if (tags.leisure) {
    return `leisure:${tags.leisure}`;
  }
  if (tags.building && tags.building !== 'yes') {
    return `building:${tags.building}`;
  }
  if (tags.building) {
    return 'building';
  }
  if (tags.highway) {
    return `highway:${tags.highway}`;
  }
  const relevantKey = Object.keys(tags).find(k => 
    k !== 'name' && 
    !k.startsWith('addr:') && 
    !k.startsWith('source:') &&
    !k.startsWith('ref:') &&
    k !== 'operator' &&
    k !== 'phone' &&
    k !== 'website'
  );
  return relevantKey || null;
}

module.exports = { main, saveToRedis, fetchOSMData, formatAddress, generateOverpassQuery, processQuadrant, getCategory };

