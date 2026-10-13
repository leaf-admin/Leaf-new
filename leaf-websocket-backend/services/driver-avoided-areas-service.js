// 🚫 Áreas que o motorista evita (filtro duro de despacho).
// Funções puras: a persistência fica na rota e no dispatcher.
const h3 = require('h3-js');

const AVOIDED_AREAS_H3_RESOLUTION = 8;
const MAX_AVOIDED_CELLS = 60;
const MAX_AVOIDED_AREAS = 12;
const MAX_AVOIDED_LABEL_LENGTH = 60;
const MAX_AVOIDED_RING_SIZE = 2;

function toFiniteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Aceita {lat,lng} com números ou strings numéricas, e (para o payload do booking) JSON string.
function normalizeAvoidedPoint(value) {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (error) {
      return null;
    }
  }
  if (!source || typeof source !== 'object') return null;

  const lat = toFiniteNumber(source.lat);
  const lng = toFiniteNumber(source.lng);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function normalizeAvoidedCells(input) {
  if (!Array.isArray(input)) return [];

  const seen = new Set();
  const cells = [];
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const cell = raw.trim();
    if (!cell || seen.has(cell)) continue;
    if (!h3.isValidCell(cell)) continue;
    if (h3.getResolution(cell) !== AVOIDED_AREAS_H3_RESOLUTION) continue;
    seen.add(cell);
    cells.push(cell);
  }
  return cells;
}

function parseAvoidedCells(driverData = {}) {
  const raw = driverData?.avoidedH3Cells;
  if (Array.isArray(raw)) return normalizeAvoidedCells(raw);
  if (typeof raw !== 'string' || raw.trim() === '') return [];

  try {
    return normalizeAvoidedCells(JSON.parse(raw));
  } catch (error) {
    return [];
  }
}

function isDestinationAvoided(driverData = {}, destinationLocation = null) {
  const cells = parseAvoidedCells(driverData);
  if (cells.length === 0) return false;

  const destination = normalizeAvoidedPoint(destinationLocation);
  if (!destination) return false;

  try {
    const destinationCell = h3.latLngToCell(
      destination.lat,
      destination.lng,
      AVOIDED_AREAS_H3_RESOLUTION
    );
    return cells.includes(destinationCell);
  } catch (error) {
    return false;
  }
}

// Bloqueio vale para os dois extremos: o motorista não quer embarcar nem desembarcar ali.
function isRideInAvoidedArea(driverData = {}, { pickupLocation = null, destinationLocation = null } = {}) {
  return (
    isDestinationAvoided(driverData, destinationLocation) ||
    isDestinationAvoided(driverData, pickupLocation)
  );
}

// `driver_avoided_areas:{uid}` é a fonte da verdade (sem TTL). O hash `driver:{uid}` expira
// quando o motorista sai, então o campo `avoidedH3Cells` dele é só uma cópia para o shortlist.
function parseStoredAvoidedCells(rawStored) {
  if (!rawStored) return [];
  let stored = rawStored;
  if (typeof stored === 'string') {
    try {
      stored = JSON.parse(stored);
    } catch (error) {
      return [];
    }
  }
  return normalizeAvoidedCells(stored?.cells);
}

function buildAvoidedAreasPatch(cells, updatedAt = new Date().toISOString()) {
  return {
    avoidedH3Cells: JSON.stringify(normalizeAvoidedCells(cells)),
    avoidedAreasUpdatedAt: updatedAt
  };
}

function cellsAroundPoint(lat, lng, ringSize = 0) {
  const point = normalizeAvoidedPoint({ lat, lng });
  if (!point) return [];

  const parsedRing = Math.trunc(toFiniteNumber(ringSize) ?? 0);
  const ring = Math.min(MAX_AVOIDED_RING_SIZE, Math.max(0, parsedRing));
  return h3.gridDisk(
    h3.latLngToCell(point.lat, point.lng, AVOIDED_AREAS_H3_RESOLUTION),
    ring
  );
}

// Contorno da área para o app desenhar no mapa (anéis externos; o app não carrega h3).
function buildAreaOutline(cells) {
  const valid = normalizeAvoidedCells(cells);
  if (valid.length === 0) return [];

  try {
    return h3.cellsToMultiPolygon(valid, false)
      .map((polygon) => (Array.isArray(polygon?.[0]) ? polygon[0] : []))
      .filter((ring) => ring.length >= 3)
      .map((ring) => ring.map(([latitude, longitude]) => ({
        latitude: Number(latitude.toFixed(6)),
        longitude: Number(longitude.toFixed(6))
      })));
  } catch (error) {
    return [];
  }
}

module.exports = {
  AVOIDED_AREAS_H3_RESOLUTION,
  MAX_AVOIDED_AREAS,
  MAX_AVOIDED_CELLS,
  MAX_AVOIDED_LABEL_LENGTH,
  MAX_AVOIDED_RING_SIZE,
  buildAreaOutline,
  buildAvoidedAreasPatch,
  cellsAroundPoint,
  isDestinationAvoided,
  isRideInAvoidedArea,
  normalizeAvoidedCells,
  normalizeAvoidedPoint,
  parseAvoidedCells,
  parseStoredAvoidedCells
};
