#!/usr/bin/env node
/**
 * Gera config/rio-bairros.json a partir do GeoJSON oficial de limites de bairros da
 * Prefeitura do Rio (camada "Limite de Bairros" do serviço Limites_administrativos,
 * pgeo3.rio.rj.gov.br, dado aberto).
 *
 * Uso: node scripts/data/build-rio-bairros.js <bairros.geojson>
 *
 * Os contornos são simplificados (~12 m) para o arquivo caber no servidor e no app.
 */
const fs = require('fs');
const path = require('path');

const TOLERANCE_DEG = 0.00011; // ~12 m

function perpendicularDistance(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) return Math.hypot(point[0] - start[0], point[1] - start[1]);
  const t = ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy);
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(point[0] - (start[0] + clamped * dx), point[1] - (start[1] + clamped * dy));
}

function simplify(points, tolerance) {
  if (points.length <= 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDistance = 0;
    let index = -1;
    for (let i = first + 1; i < last; i += 1) {
      const distance = perpendicularDistance(points[i], points[first], points[last]);
      if (distance > maxDistance) {
        maxDistance = distance;
        index = i;
      }
    }
    if (index !== -1 && maxDistance > tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

function round(value) {
  return Number(value.toFixed(5));
}

function main() {
  const source = process.argv[2];
  if (!source) {
    console.error('Uso: node scripts/data/build-rio-bairros.js <bairros.geojson>');
    process.exit(1);
  }
  const geojson = JSON.parse(fs.readFileSync(source, 'utf8'));
  const bairros = geojson.features
    .map((feature) => {
      const polygons = feature.geometry.type === 'Polygon'
        ? [feature.geometry.coordinates]
        : feature.geometry.coordinates;
      // Só o anel externo de cada parte; ilhotas minúsculas saem.
      const rings = polygons
        .map((polygon) => polygon[0])
        .filter((ring) => Array.isArray(ring) && ring.length >= 4);
      const largest = Math.max(...rings.map(ringArea));
      const kept = rings
        .filter((ring) => ringArea(ring) >= largest * 0.02)
        .map((ring) => simplify(ring, TOLERANCE_DEG).map(([lng, lat]) => [round(lat), round(lng)]))
        .filter((ring) => ring.length >= 4);
      const lats = kept.flat().map((p) => p[0]);
      const lngs = kept.flat().map((p) => p[1]);
      return {
        id: String(feature.properties.codbairro).trim(),
        name: String(feature.properties.nome).trim(),
        bbox: [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)],
        rings: kept
      };
    })
    .filter((bairro) => bairro.id && bairro.name && bairro.rings.length)
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const output = {
    source: 'Prefeitura do Rio de Janeiro - Limite de Bairros (pgeo3.rio.rj.gov.br, Limites_administrativos/MapServer/4)',
    generatedAt: new Date().toISOString().slice(0, 10),
    coordinateOrder: 'lat,lng',
    bairros
  };
  const target = path.join(__dirname, '..', '..', 'config', 'rio-bairros.json');
  fs.writeFileSync(target, `${JSON.stringify(output)}\n`);
  const points = bairros.reduce((sum, b) => sum + b.rings.reduce((s, r) => s + r.length, 0), 0);
  console.log(`${bairros.length} bairros, ${points} pontos -> ${target} (${fs.statSync(target).size} bytes)`);
}

main();
