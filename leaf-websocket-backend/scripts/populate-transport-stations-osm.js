/**
 * Script para popular cache de Places com estações de transporte público do OSM
 * 
 * Este script busca estações de transporte (trem, metrô, BRT, pontos de ônibus) 
 * e salva no Redis com prefixo diferente para evitar conflitos com estabelecimentos comerciais.
 * 
 * Uso:
 *   node scripts/populate-transport-stations-osm.js
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

// Prefixo para estações de transporte (evita conflito com estabelecimentos)
const TRANSPORT_PREFIX = 'transport_';

// Bbox do Rio de Janeiro dividido em 4 quadrantes
// Formato: [south, west, north, east]
const RIO_QUADRANTS = [
  [-23.0823, -43.7958, -22.9123, -43.4474], // Sudoeste
  [-23.0823, -43.4474, -22.9123, -43.0990], // Sudeste
  [-22.9123, -43.7958, -22.7423, -43.4474], // Noroeste
  [-22.9123, -43.4474, -22.7423, -43.0990]  // Nordeste
];

/**
 * Formata endereço a partir de tags OSM
 * @param {object} tags - Tags do elemento OSM
 * @returns {string} - Endereço formatado
 */
function formatAddress(tags = {}) {
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
  
  // Prioridade 3: Usar nome do lugar + cidade padrão
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
 * Extrai categoria do tipo de transporte
 * @param {object} tags - Tags do elemento OSM
 * @returns {string} - Categoria do transporte
 */
function getTransportCategory(tags) {
  if (tags.public_transport === 'station') {
    if (tags.network === 'TransOeste' || tags.network === 'TransCarioca' || tags.network === 'TransOlímpica') {
      return 'brt_station';
    }
    if (tags.railway === 'station' || tags.railway === 'subway_entrance') {
      return 'metro_station';
    }
    if (tags.railway === 'tram_stop') {
      return 'tram_station';
    }
    return 'bus_station';
  }
  
  if (tags.amenity === 'bus_station') {
    return 'bus_station';
  }
  
  if (tags.amenity === 'subway_entrance') {
    return 'metro_station';
  }
  
  if (tags.highway === 'bus_stop') {
    return 'bus_stop';
  }
  
  if (tags.railway === 'station') {
    return 'train_station';
  }
  
  if (tags.railway === 'subway_entrance') {
    return 'metro_station';
  }
  
  return 'transport_station';
}

/**
 * Gera query Overpass para estações de transporte
 * @param {array} bbox - [south, west, north, east]
 * @returns {string} - Query Overpass
 */
function generateOverpassQuery(bbox) {
  const [south, west, north, east] = bbox;
  return `
[out:json][timeout:60];
(
  // Estações de transporte público
  node["public_transport"="station"]["name"](${south},${west},${north},${east});
  way["public_transport"="station"]["name"](${south},${west},${north},${east});
  node["amenity"="bus_station"]["name"](${south},${west},${north},${east});
  way["amenity"="bus_station"]["name"](${south},${west},${north},${east});
  node["amenity"="subway_entrance"]["name"](${south},${west},${north},${east});
  way["amenity"="subway_entrance"]["name"](${south},${west},${north},${east});
  node["railway"="station"]["name"](${south},${west},${north},${east});
  way["railway"="station"]["name"](${south},${west},${north},${east});
  node["railway"="subway_entrance"]["name"](${south},${west},${north},${east});
  way["railway"="subway_entrance"]["name"](${south},${west},${north},${east});
  // Pontos de ônibus (apenas os principais com nome)
  node["highway"="bus_stop"]["name"](${south},${west},${north},${east});
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
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: query
      });

      if (!response.ok) {
        if (response.status === 504 && attempt < maxRetries) {
          logger.warn(`⚠️ HTTP ${response.status}, tentando novamente...`);
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const json = await response.json();
      
      if (json.elements && Array.isArray(json.elements)) {
        logger.info(`✅ Dados OSM recebidos: ${json.elements.length} estações`);
        return json.elements;
      }
      
      throw new Error('Resposta inválida do Overpass API');
    } catch (error) {
      if (attempt === maxRetries) {
        logger.error(`❌ Erro ao buscar OSM após ${maxRetries} tentativas: ${error.message}`);
        throw error;
      }
      logger.warn(`⚠️ Erro na tentativa ${attempt}: ${error.message}`);
    }
  }
  
  return [];
}

/**
 * Salva estação de transporte no Redis
 * @param {object} place - Elemento OSM
 * @returns {Promise<boolean>} - true se salvou com sucesso
 */
async function saveToRedis(place) {
  try {
    if (!place.tags?.name) {
      return false;
    }

    const name = place.tags.name.trim();
    if (name.length < 3) {
      return false;
    }

    // Criar alias com prefixo de transporte
    const baseAlias = normalizeQuery(name);
    const alias = `${TRANSPORT_PREFIX}${baseAlias}`;

    if (!alias || alias.length < 3) {
      logger.warn(`⚠️ Alias inválido para: ${name}`);
      return false;
    }

    // Verificar se já existe (não sobrescrever dados do Google)
    const existing = await redis.get(`place:${alias}`);
    if (existing) {
      const existingData = JSON.parse(existing);
      // Se já tem dados do Google, não sobrescrever
      if (existingData.source === 'google' || existingData.place_id?.startsWith('ChIJ')) {
        logger.debug(`⏭️ Estação já existe (Google): ${alias}`);
        return false;
      }
    }

    const lat = place.lat || place.center?.lat;
    const lng = place.lon || place.center?.lon;

    if (!lat || !lng) {
      logger.warn(`⚠️ Estação sem coordenadas: ${name}`);
      return false;
    }

    const address = formatAddress(place.tags);
    
    // ✅ VALIDAÇÃO: Só salvar se tiver endereço completo ou pelo menos nome + bairro
    // Para estações de transporte, aceitamos endereços parciais (bairro + cidade)
    const hasValidAddress = address && 
                            address !== "Endereço não disponível" &&
                            address !== `${name}, Rio de Janeiro, RJ` &&
                            address.includes(',');

    if (!hasValidAddress) {
      logger.debug(`⏭️ Estação sem endereço válido ignorada: ${name} (${address})`);
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
      category: getTransportCategory(place.tags),
      osm_type: place.type,
      transport_type: getTransportCategory(place.tags) // Campo adicional para filtragem
    };

    await redis.setex(`place:${alias}`, CACHE_TTL, JSON.stringify(payload));
    logger.info(`✅ Estação salva: ${alias} (${name})`);
    
    return true;
  } catch (error) {
    logger.error(`❌ Erro ao salvar estação ${place.id}: ${error.message}`);
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
  logger.info(`📊 Encontradas ${places.length} estações no quadrante ${quadrantNum}`);

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

    // Log progresso a cada 100 estações
    if ((saved + skipped + errors) % 100 === 0) {
      logger.info(`⏳ Progresso: ${saved} salvas, ${skipped} ignoradas, ${errors} erros`);
    }
  }

  logger.info(`✅ Quadrante ${quadrantNum} concluído: ${saved} salvas, ${skipped} ignoradas, ${errors} erros`);
  
  return { saved, skipped, errors };
}

/**
 * Função principal
 */
async function main() {
  logger.info('🚀 Iniciando população do cache Places com estações de transporte OSM');
  logger.info(`📦 TTL do cache: ${CACHE_TTL / 86400} dias`);
  logger.info(`🏷️ Prefixo de transporte: ${TRANSPORT_PREFIX}`);

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
  logger.info(`   ✅ Salvas: ${totalSaved}`);
  logger.info(`   ⏭️ Ignoradas: ${totalSkipped}`);
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

// Exportar para testes
module.exports = {
  processQuadrant,
  saveToRedis,
  formatAddress,
  getTransportCategory,
  generateOverpassQuery,
  fetchOSMData
};
































