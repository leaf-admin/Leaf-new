'use strict';

// Malha de ruas do Rio para a animação de busca do passageiro (a busca "andando" pelas ruas a
// partir do embarque até os carros). Fonte: OpenStreetMap (© OpenStreetMap contributors, ODbL),
// extrato do município baixado uma vez por mês. Nenhuma API paga, nada por busca: o app recebe a
// vizinhança do embarque já pronta do Redis.

const h3 = require('h3-js');
const { readOsmPbf } = require('../utils/osm-pbf-reader');

const toPositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const CELL_RESOLUTION = 8;
const GRAPH_KEY = 'leaf:map:street-graph:v1';
const META_KEY = 'leaf:map:street-graph:v1:meta';
const DEFAULT_SOURCE_URL = 'https://download.bbbike.org/osm/bbbike/RiodeJaneiro/RiodeJaneiro.osm.pbf';
const REBUILD_AFTER_MS = toPositiveInt(process.env.STREET_GRAPH_REBUILD_DAYS, 30) * 24 * 3600 * 1000;
const MAX_RADIUS_M = 4000;

// Só onde passa carro: é por elas que o motorista chega ao embarque.
const DRIVABLE = new Set([
  'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential',
  'living_street', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link',
]);

const round5 = (value) => Math.round(value * 1e5) / 1e5;

function haversineMeters(a, b) {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// Lê o PBF e devolve a malha dividida por célula H3: { cell: { n: {id: [lat, lng]}, e: [[a, b]] } }.
// Cada trecho fica na célula do seu primeiro ponto, com os dois pontos junto.
function buildStreetGraph(buffer) {
  const ways = [];
  const needed = new Set();
  readOsmPbf(buffer, {
    onWay: (id, tags, refs) => {
      if (!DRIVABLE.has(tags.highway) || refs.length < 2) return;
      ways.push(refs);
      for (const ref of refs) needed.add(ref);
    },
  });

  const coords = new Map();
  readOsmPbf(buffer, {
    onNode: (id, lat, lng) => {
      if (needed.has(id)) coords.set(id, [round5(lat), round5(lng)]);
    },
  });

  const cells = new Map();
  let edgeCount = 0;
  for (const refs of ways) {
    for (let i = 0; i < refs.length - 1; i += 1) {
      const a = coords.get(refs[i]);
      const b = coords.get(refs[i + 1]);
      if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
      const cell = h3.latLngToCell(a[0], a[1], CELL_RESOLUTION);
      let bucket = cells.get(cell);
      if (!bucket) {
        bucket = { n: {}, e: [] };
        cells.set(cell, bucket);
      }
      bucket.n[refs[i]] = a;
      bucket.n[refs[i + 1]] = b;
      bucket.e.push([refs[i], refs[i + 1]]);
      edgeCount += 1;
    }
  }
  return { cells, wayCount: ways.length, nodeCount: coords.size, edgeCount };
}

async function storeStreetGraph(redis, graph, meta = {}) {
  const tmpKey = `${GRAPH_KEY}:building`;
  await redis.del(tmpKey);
  const entries = Array.from(graph.cells.entries());
  for (let i = 0; i < entries.length; i += 500) {
    const batch = {};
    for (const [cell, bucket] of entries.slice(i, i + 500)) batch[cell] = JSON.stringify(bucket);
    await redis.hset(tmpKey, batch);
  }
  // Troca atômica: quem estiver lendo nunca vê a malha pela metade.
  await redis.rename(tmpKey, GRAPH_KEY);
  await redis.set(META_KEY, JSON.stringify({
    builtAt: new Date().toISOString(),
    cells: entries.length,
    ways: graph.wayCount,
    nodes: graph.nodeCount,
    edges: graph.edgeCount,
    ...meta,
  }));
  return entries.length;
}

async function getStreetGraphMeta(redis) {
  const raw = await redis.get(META_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

// Vizinhança do ponto, num formato compacto para o app: pontos indexados e trechos por índice.
async function getStreetGraphAround(redis, { lat, lng, radiusM = 1200 }) {
  const center = [Number(lat), Number(lng)];
  if (!Number.isFinite(center[0]) || !Number.isFinite(center[1])) {
    throw Object.assign(new Error('lat e lng são obrigatórios'), { statusCode: 400 });
  }
  const radius = Math.min(MAX_RADIUS_M, Math.max(200, Number(radiusM) || 1200));
  // Centros de células res 8 ficam a ~0,8 km um do outro.
  const ring = Math.ceil(radius / 800) + 1;
  const cells = h3.gridDisk(h3.latLngToCell(center[0], center[1], CELL_RESOLUTION), ring);
  const raws = await redis.hmget(GRAPH_KEY, ...cells);

  const index = new Map();
  const nodes = [];
  const edges = [];
  const idFor = (osmId, coord) => {
    let i = index.get(osmId);
    if (i === undefined) {
      i = nodes.length;
      index.set(osmId, i);
      nodes.push(coord);
    }
    return i;
  };
  for (const raw of raws) {
    if (!raw) continue;
    let bucket;
    try {
      bucket = JSON.parse(raw);
    } catch (_error) {
      continue;
    }
    for (const [a, b] of bucket.e || []) {
      const ca = bucket.n[a];
      const cb = bucket.n[b];
      if (!ca || !cb) continue;
      if (haversineMeters(center, ca) > radius && haversineMeters(center, cb) > radius) continue;
      edges.push([idFor(String(a), ca), idFor(String(b), cb)]);
    }
  }
  return { center, radiusM: radius, nodes, edges };
}

async function downloadSource(url, { axios }) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 120000,
    maxContentLength: 200 * 1024 * 1024,
    headers: { 'User-Agent': 'LeafApp/1.0 (street graph monthly)' },
  });
  return {
    buffer: Buffer.from(response.data),
    lastModified: response.headers?.['last-modified'] || null,
  };
}

// Chamado pelo worker líder: reconstrói só quando não existe ou passou do prazo.
async function rebuildStreetGraphIfStale(redis, { now = Date.now(), axios = require('axios'), force = false } = {}) {
  const meta = await getStreetGraphMeta(redis);
  const builtAt = meta?.builtAt ? Date.parse(meta.builtAt) : 0;
  if (!force && builtAt && now - builtAt < REBUILD_AFTER_MS) {
    return { rebuilt: false, reason: 'fresh', builtAt: meta.builtAt };
  }
  const url = process.env.STREET_GRAPH_SOURCE_URL || DEFAULT_SOURCE_URL;
  const { buffer, lastModified } = await downloadSource(url, { axios });
  const graph = buildStreetGraph(buffer);
  const cells = await storeStreetGraph(redis, graph, { source: url, sourceLastModified: lastModified });
  return { rebuilt: true, cells, edges: graph.edgeCount };
}

// Mesma vizinhança para embarques próximos: a resposta pronta fica 6 h no Redis por célula H3
// res 9 (~170 m), centrada no centro da célula. Montar 4 km leva ~300 ms; servir do cache, ~5 ms.
const AROUND_CACHE_TTL_SECONDS = 6 * 3600;
async function getStreetGraphAroundCached(redis, { lat, lng, radiusM = 1200 }) {
  const latN = Number(lat);
  const lngN = Number(lng);
  if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
    throw Object.assign(new Error('lat e lng são obrigatórios'), { statusCode: 400 });
  }
  const radius = Math.min(MAX_RADIUS_M, Math.max(200, Number(radiusM) || 1200));
  const cell = h3.latLngToCell(latN, lngN, 9);
  const meta = await getStreetGraphMeta(redis);
  const cacheKey = `${GRAPH_KEY}:around:${meta?.builtAt || 'none'}:${cell}:${radius}`;
  const cached = await redis.get(cacheKey);
  if (cached) return cached;
  const [cLat, cLng] = h3.cellToLatLng(cell);
  const graph = await getStreetGraphAround(redis, { lat: cLat, lng: cLng, radiusM: radius });
  const body = JSON.stringify({ success: true, attribution: '© OpenStreetMap contributors', ...graph });
  await redis.set(cacheKey, body, 'EX', AROUND_CACHE_TTL_SECONDS);
  return body;
}

module.exports = {
  buildStreetGraph,
  getStreetGraphAroundCached,
  storeStreetGraph,
  getStreetGraphAround,
  getStreetGraphMeta,
  rebuildStreetGraphIfStale,
  helpers: { GRAPH_KEY, META_KEY, CELL_RESOLUTION, DRIVABLE, haversineMeters },
};
