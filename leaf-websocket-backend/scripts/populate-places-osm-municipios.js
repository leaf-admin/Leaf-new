/**
 * Script para popular cache de Places com dados do OpenStreetMap (OSM)
 * VERSÃO EXPANDIDA: Suporta múltiplos municípios da Região Metropolitana do Rio
 * 
 * Uso:
 *   node scripts/populate-places-osm-municipios.js
 * 
 * Municípios incluídos:
 *   - Rio de Janeiro (RJ)
 *   - Niterói (RJ)
 *   - Duque de Caxias (RJ)
 *   - São Gonçalo (RJ)
 *   - Nova Iguaçu (RJ)
 *   - Campos dos Goytacazes (RJ) - opcional
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');
const { normalizeQuery } = require('../utils/places-normalizer');

// Configurações
const redis = redisPool.getConnection();
const CACHE_TTL = 30 * 24 * 60 * 60; // 30 dias em segundos

// Bbox de cada município (formato: [south, west, north, east])
const MUNICIPIOS = {
  'Rio de Janeiro': [
    [-23.0823, -43.7958, -22.9123, -43.4474], // Sudoeste
    [-23.0823, -43.4474, -22.9123, -43.0990], // Sudeste
    [-22.9123, -43.7958, -22.7423, -43.4474], // Noroeste
    [-22.9123, -43.4474, -22.7423, -43.0990]  // Nordeste
  ],
  'Niterói': [
    [-22.9800, -43.1500, -22.8500, -43.0000]  // Bbox único (cidade menor)
  ],
  'Duque de Caxias': [
    [-22.8500, -43.4000, -22.7000, -43.2000]  // Bbox único
  ],
  'São Gonçalo': [
    [-22.9500, -43.1500, -22.7500, -42.9500]  // Bbox único
  ],
  'Nova Iguaçu': [
    [-22.9000, -43.6000, -22.7000, -43.4000]  // Bbox único
  ],
  'Campos dos Goytacazes': [  // Opcional - mais distante
    [-21.9000, -41.4000, -21.6000, -41.0000]  // Bbox único
  ]
};

/**
 * Formata endereço a partir de tags OSM
 */
function formatAddress(tags = {}) {
  if (!tags["addr:street"] && !tags["addr:housenumber"] && !tags["addr:neighborhood"] && 
      !tags["addr:suburb"] && !tags["addr:city"] && !tags["addr:postcode"]) {
    return tags.name || "Endereço não disponível";
  }
  
  const parts = [
    tags["addr:street"],
    tags["addr:housenumber"],
    tags["addr:neighborhood"] || tags["addr:suburb"],
    tags["addr:city"],
    tags["addr:state"],
    tags["addr:postcode"]
  ].filter(Boolean);
  
  return parts.length > 0 ? parts.join(", ") : (tags.name || "Endereço não disponível");
}

/**
 * Gera query Overpass para um bbox
 */
function generateOverpassQuery(bbox) {
  const [south, west, north, east] = bbox;
  return `
[out:json][timeout:60];
(
  node["amenity"]["name"](${south},${west},${north},${east});
  node["shop"]["name"](${south},${west},${north},${east});
  node["leisure"]["name"](${south},${west},${north},${east});
  node["building"~"church|hospital|mall"]["name"](${south},${west},${north},${east});
  way["amenity"]["name"](${south},${west},${north},${east});
  way["shop"]["name"](${south},${west},${north},${east});
);
out center;
`;
}

/**
 * Busca dados do Overpass API com retry
 */
async function fetchOSMData(bbox, maxRetries = 3) {
  const url = "https://overpass-api.de/api/interpreter";
  const query = generateOverpassQuery(bbox);
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 1) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 2), 10000);
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
      logger.warn(`⚠️ Erro na tentativa ${attempt}: ${error.message}`);
    }
  }
  
  return [];
}

/**
 * Salva lugar no Redis
 */
async function saveToRedis(place, municipio) {
  try {
    if (!place.tags?.name) {
      return false;
    }

    const name = place.tags.name.trim();
    if (name.length < 3) {
      return false;
    }

    const alias = normalizeQuery(name);
    if (!alias || alias.length < 3) {
      return false;
    }

    // Verificar se já existe (não sobrescrever dados do Google)
    const existing = await redis.get(`place:${alias}`);
    if (existing) {
      const existingData = JSON.parse(existing);
      if (existingData.source === 'google' || existingData.place_id?.startsWith('ChIJ')) {
        return false;
      }
    }

    const lat = place.lat || place.center?.lat;
    const lng = place.lon || place.center?.lon;

    if (!lat || !lng) {
      return false;
    }

    const payload = {
      alias,
      query: name,
      place_id: `osm_${place.id}`,
      name: name,
      address: formatAddress(place.tags),
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      cached_at: new Date().toISOString(),
      source: 'osm',
      category: Object.keys(place.tags).find(k => k !== 'name' && !k.startsWith('addr:')) || null,
      municipio: municipio  // ✅ Adiciona município ao payload
    };

    await redis.setex(`place:${alias}`, CACHE_TTL, JSON.stringify(payload));
    logger.info(`✅ Place salvo: ${alias} (${name}) - ${municipio}`);
    
    return true;
  } catch (error) {
    logger.error(`❌ Erro ao salvar place ${place.id}: ${error.message}`);
    return false;
  }
}

/**
 * Processa um quadrante completo
 */
async function processQuadrant(bbox, quadrantNum, totalQuadrants, municipio) {
  logger.info(`\n📍 Processando quadrante ${quadrantNum}/${totalQuadrants} de ${municipio}: ${bbox.join(',')}`);
  
  const places = await fetchOSMData(bbox);
  logger.info(`📊 Encontrados ${places.length} lugares no quadrante ${quadrantNum} de ${municipio}`);

  let saved = 0;
  let skipped = 0;
  let errors = 0;

  for (const place of places) {
    const result = await saveToRedis(place, municipio);
    if (result) {
      saved++;
    } else if (place.tags?.name) {
      skipped++;
    } else {
      errors++;
    }

    if ((saved + skipped + errors) % 100 === 0) {
      logger.info(`⏳ Progresso: ${saved} salvos, ${skipped} ignorados, ${errors} erros`);
    }
  }

  logger.info(`✅ Quadrante ${quadrantNum} de ${municipio} concluído: ${saved} salvos, ${skipped} ignorados, ${errors} erros`);
  
  return { saved, skipped, errors };
}

/**
 * Processa um município completo
 */
async function processMunicipio(municipio, quadrantes) {
  logger.info(`\n🏙️ Processando município: ${municipio}`);
  logger.info(`📦 Total de quadrantes: ${quadrantes.length}`);
  
  let totalSaved = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (let i = 0; i < quadrantes.length; i++) {
    const result = await processQuadrant(quadrantes[i], i + 1, quadrantes.length, municipio);
    totalSaved += result.saved;
    totalSkipped += result.skipped;
    totalErrors += result.errors;

    if (i < quadrantes.length - 1) {
      logger.info('⏳ Aguardando 5 segundos antes do próximo quadrante...');
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  logger.info(`\n✅ Município ${municipio} concluído: ${totalSaved} salvos, ${totalSkipped} ignorados, ${totalErrors} erros`);
  
  return { saved: totalSaved, skipped: totalSkipped, errors: totalErrors };
}

/**
 * Função principal
 */
async function main() {
  logger.info('🚀 Iniciando população do cache Places com dados OSM - MÚLTIPLOS MUNICÍPIOS');
  logger.info(`📦 TTL do cache: ${CACHE_TTL / 86400} dias`);
  logger.info(`🏙️ Municípios a processar: ${Object.keys(MUNICIPIOS).join(', ')}`);

  let grandTotalSaved = 0;
  let grandTotalSkipped = 0;
  let grandTotalErrors = 0;

  const resultados = {};

  for (const [municipio, quadrantes] of Object.entries(MUNICIPIOS)) {
    const result = await processMunicipio(municipio, quadrantes);
    resultados[municipio] = result;
    
    grandTotalSaved += result.saved;
    grandTotalSkipped += result.skipped;
    grandTotalErrors += result.errors;

    // Aguardar entre municípios
    logger.info('⏳ Aguardando 10 segundos antes do próximo município...');
    await new Promise(resolve => setTimeout(resolve, 10000));
  }

  logger.info('\n🎉 População concluída!');
  logger.info(`📊 Estatísticas finais:`);
  logger.info(`   ✅ Salvos: ${grandTotalSaved}`);
  logger.info(`   ⏭️ Ignorados: ${grandTotalSkipped}`);
  logger.info(`   ❌ Erros: ${grandTotalErrors}`);
  logger.info(`   📦 Total processado: ${grandTotalSaved + grandTotalSkipped + grandTotalErrors}`);
  
  logger.info('\n📊 Estatísticas por município:');
  for (const [municipio, result] of Object.entries(resultados)) {
    logger.info(`   ${municipio}: ${result.saved} salvos`);
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  main().catch(error => {
    logger.error(`❌ Erro fatal: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { main, MUNICIPIOS };
































