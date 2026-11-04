// Área de atendimento como lista de anéis fechados [[lng, lat], ...], um por
// polígono. Lê os formatos que o backend aceita (anel único, vários anéis e
// GeoJSON) e gera o arquivo versionado do backend (config/geofence.json).

const COORDINATE_DECIMALS = 6;
export const POLICY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;

function toPoint(point) {
  let lng = null;
  let lat = null;
  if (Array.isArray(point) && point.length >= 2) {
    lng = Number(point[0]);
    lat = Number(point[1]);
  } else if (point && typeof point === "object") {
    lng = Number(point.lng);
    lat = Number(point.lat);
  }
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return null;
  return [lng, lat];
}

function samePoint(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

// Anel fechado com ao menos 3 pontos distintos; null se não der para formar.
export function normalizeRing(points) {
  if (!Array.isArray(points)) return null;
  const ring = [];
  for (const raw of points) {
    const point = toPoint(raw);
    if (!point) return null;
    if (ring.length && samePoint(ring[ring.length - 1], point)) continue;
    ring.push(point);
  }
  if (ring.length > 1 && samePoint(ring[0], ring[ring.length - 1])) ring.pop();
  if (ring.length < 3) return null;
  return [...ring, [ring[0][0], ring[0][1]]];
}

function isPointLike(value) {
  return (Array.isArray(value) && value.length >= 2 && !Array.isArray(value[0]))
    || (value && typeof value === "object" && !Array.isArray(value) && "lat" in value);
}

// null quando algum anel é inválido; [] quando não há área.
export function normalizeRegionRings(region) {
  if (!region) return [];
  if (region.type === "FeatureCollection") {
    const rings = (region.features || []).map((feature) => normalizeRegionRings(feature));
    return rings.some((entry) => entry === null) ? null : rings.flat();
  }
  if (region.type === "Feature") return normalizeRegionRings(region.geometry);
  if (region.type === "Polygon") {
    const ring = normalizeRing(region.coordinates?.[0]);
    return ring ? [ring] : null;
  }
  if (region.type === "MultiPolygon") {
    const rings = (region.coordinates || []).map((polygon) => normalizeRing(polygon?.[0]));
    return rings.some((ring) => !ring) ? null : rings;
  }
  if (!Array.isArray(region)) return null;
  if (region.length === 0) return [];
  if (isPointLike(region[0])) {
    const ring = normalizeRing(region);
    return ring ? [ring] : null;
  }
  const rings = region.map((candidate) => normalizeRing(candidate));
  return rings.some((ring) => !ring) ? null : rings;
}

export function countRingPoints(ring = []) {
  return Math.max(ring.length - 1, 0);
}

export function countRegionPoints(rings = []) {
  return rings.reduce((total, ring) => total + countRingPoints(ring), 0);
}

function round(value) {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

// Mesmo formato do config/geofence.json: um Feature MultiPolygon, sem buracos.
export function buildGeofenceFile(rings, { policyId, name, generatedAt } = {}) {
  const normalized = normalizeRegionRings(rings);
  if (!normalized || normalized.length === 0) {
    throw new Error("Desenhe ao menos uma área válida antes de gerar o arquivo.");
  }
  const id = String(policyId || "").trim();
  if (!POLICY_ID_PATTERN.test(id)) {
    throw new Error("Versão inválida: use letras minúsculas, números e hífen (ex.: rio-zona-sul-v4).");
  }
  const label = String(name || "").trim() || id;
  const date = String(generatedAt || new Date().toISOString().slice(0, 10));
  const coordinates = normalized.map((ring) => [ring.map(([lng, lat]) => [round(lng), round(lat)])]);
  return {
    type: "FeatureCollection",
    metadata: {
      schemaVersion: 1,
      policyId: id,
      name: label,
      generatedAt: date,
      source: "Desenhado no dashboard Leaf",
      sourceSpatialReference: "EPSG:4326",
      polygonCount: normalized.length,
      pointCount: countRegionPoints(normalized),
    },
    features: [
      {
        type: "Feature",
        properties: {
          policyId: id,
          version: id,
          name: label,
          generatedAt: date,
          source: "Dashboard Leaf",
        },
        geometry: { type: "MultiPolygon", coordinates },
      },
    ],
  };
}

// rio-zona-sul-v3 -> rio-zona-sul-v4; sem número no fim, acrescenta -v2.
export function suggestNextPolicyId(current) {
  const base = String(current || "").trim().toLowerCase();
  if (!base) return "";
  const match = base.match(/^(.*-v)(\d+)$/);
  return match ? `${match[1]}${Number(match[2]) + 1}` : `${base}-v2`;
}
