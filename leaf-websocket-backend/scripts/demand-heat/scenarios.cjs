#!/usr/bin/env node
'use strict';

// Cenários simulados do mapa de calor.
//
//   node scripts/demand-heat/scenarios.cjs                      relatório de todos os cenários (memória)
//   node scripts/demand-heat/scenarios.cjs --geojson <arquivo>  também grava as células em GeoJSON
//   node scripts/demand-heat/scenarios.cjs --publish-preview <cenário>
//       grava o cenário na chave de prévia do Redis do REDIS_URL (2 h). Só as contas em
//       DEMAND_HEAT_PREVIEW_UIDS veem; o calor real não muda. Exige CONFIRM_PREVIEW_PUBLISH=true.
//   node scripts/demand-heat/scenarios.cjs --clear-preview
//       apaga a prévia. Exige CONFIRM_PREVIEW_PUBLISH=true.

const fs = require('fs');
const { SCENARIOS, PLACES, runScenario } = require('../../services/demand-heat-scenarios');
const { helpers } = require('../../services/demand-history-service');

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function toFeature(scenario, cell) {
  const ring = cell.boundary.map((point) => [point.lng, point.lat]);
  ring.push(ring[0]);
  return {
    type: 'Feature',
    properties: { scenario, place: cell.place, level: cell.level, intensity: cell.intensity },
    geometry: { type: 'Polygon', coordinates: [ring] }
  };
}

async function withRedis(fn) {
  if (process.env.CONFIRM_PREVIEW_PUBLISH !== 'true') {
    console.error('Defina CONFIRM_PREVIEW_PUBLISH=true para escrever no Redis.');
    process.exit(2);
  }
  const Redis = require('ioredis');
  const url = process.env.REDIS_URL;
  if (!url) {
    console.error('REDIS_URL é obrigatório.');
    process.exit(2);
  }
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2 });
  await redis.connect();
  try {
    await fn(redis);
  } finally {
    redis.disconnect();
  }
}

async function main() {
  const previewName = argValue('--publish-preview');
  if (previewName) {
    if (!SCENARIOS[previewName]) throw new Error(`Cenário desconhecido: ${previewName}`);
    const result = await runScenario(previewName);
    // A prévia usa o horário de agora, para o app não mostrar data velha.
    const payload = { ...result.heat, generatedAt: new Date().toISOString(), scenario: previewName };
    await withRedis(async (redis) => {
      await redis.set(helpers.PREVIEW_HEAT_KEY, JSON.stringify(payload), 'EX', helpers.PREVIEW_TTL_SECONDS);
    });
    console.log(`Prévia "${previewName}" publicada com ${payload.cells.length} células (expira em 2 h).`);
    return;
  }
  if (process.argv.includes('--clear-preview')) {
    await withRedis((redis) => redis.del(helpers.PREVIEW_HEAT_KEY));
    console.log('Prévia apagada.');
    return;
  }

  const features = [];
  for (const name of Object.keys(SCENARIOS)) {
    const result = await runScenario(name);
    console.log(`\n${name} — ${result.title}`);
    if (result.heat.cells.length === 0) {
      console.log('  (mapa vazio)');
    }
    for (const cell of result.heat.cells) {
      const label = PLACES[cell.place]?.label || cell.h3Index;
      console.log(`  ${cell.level.padEnd(6)} ${cell.intensity.toFixed(2)}  ${label}`);
      features.push(toFeature(name, cell));
    }
  }
  const geojsonPath = argValue('--geojson');
  if (geojsonPath) {
    fs.writeFileSync(geojsonPath, JSON.stringify({ type: 'FeatureCollection', features }, null, 2));
    console.log(`\nGeoJSON: ${geojsonPath}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
