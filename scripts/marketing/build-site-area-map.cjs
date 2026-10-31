#!/usr/bin/env node

// Gera landing-page/assets/leaf-area-map.json: bairros do Rio em SVG, marcando os que
// estão dentro do geofence versionado no backend. Rode de novo quando o geofence mudar.
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..", "..");
const bairros = require(path.join(root, "leaf-websocket-backend/config/rio-bairros.json")).bairros;
const geofence = require(path.join(root, "leaf-websocket-backend/config/geofence.json"));
const CITY_NAMES = ["Niterói", "Duque de Caxias", "São Gonçalo", "Nova Iguaçu"];
const SIMPLIFY_DEGREES = 0.00045;
const VIEW_WIDTH = 1000;

const regionKey = (name) => name
  .normalize("NFD")
  .replace(/[̀-ͯ]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

function perpendicularDistance([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (!length) return Math.hypot(x - x1, y - y1);
  return Math.abs(dy * x - dx * y + x2 * y1 - y2 * x1) / length;
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  let farthest = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points[points.length - 1]);
    if (distance > farthest) {
      farthest = distance;
      index = i;
    }
  }
  if (farthest <= tolerance) return [points[0], points[points.length - 1]];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

function insideRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const operatingPolygons = geofence.features.flatMap((feature) => feature.geometry.coordinates);
const insideOperation = (lng, lat) => operatingPolygons.some(
  ([outer, ...holes]) => insideRing(lng, lat, outer) && !holes.some((hole) => insideRing(lng, lat, hole)),
);

function isOperating(rings) {
  const ring = rings[0];
  const lat = ring.reduce((sum, point) => sum + point[0], 0) / ring.length;
  const lng = ring.reduce((sum, point) => sum + point[1], 0) / ring.length;
  const samples = ring.map(([pointLat, pointLng]) => [lng + (pointLng - lng) * 0.8, lat + (pointLat - lat) * 0.8]);
  return samples.filter(([x, y]) => insideOperation(x, y)).length / samples.length >= 0.5;
}

const all = bairros.flatMap((bairro) => bairro.rings.flat());
const minLat = Math.min(...all.map((point) => point[0]));
const maxLat = Math.max(...all.map((point) => point[0]));
const minLng = Math.min(...all.map((point) => point[1]));
const maxLng = Math.max(...all.map((point) => point[1]));
const shrink = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
const scale = VIEW_WIDTH / ((maxLng - minLng) * shrink);
const project = ([lat, lng]) => [
  Number((((lng - minLng) * shrink) * scale).toFixed(1)),
  Number(((maxLat - lat) * scale).toFixed(1)),
];

const regions = bairros
  .map((bairro) => ({
    key: regionKey(bairro.name),
    name: bairro.name,
    operating: isOperating(bairro.rings),
    d: bairro.rings
      .map((ring) => simplify(ring, SIMPLIFY_DEGREES).map(project))
      .filter((ring) => ring.length >= 3)
      .map((ring) => `M${ring.map((point) => point.join(" ")).join("L")}Z`)
      .join(""),
  }))
  .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"));

const output = {
  viewBox: `0 0 ${VIEW_WIDTH} ${Math.ceil((maxLat - minLat) * scale)}`,
  policyId: geofence.metadata.policyId,
  regions,
  cities: CITY_NAMES.map((name) => ({ key: regionKey(name), name })),
};
const target = path.join(root, "landing-page/assets/leaf-area-map.json");
fs.writeFileSync(target, `${JSON.stringify(output)}\n`);
console.log(`${regions.length} bairros, ${regions.filter((region) => region.operating).length} em operação, ${fs.statSync(target).size} bytes`);
console.log(regions.filter((region) => region.operating).map((region) => region.name).join(", "));
