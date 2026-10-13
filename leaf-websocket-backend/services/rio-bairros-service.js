// Limites oficiais dos bairros do Rio (config/rio-bairros.json, gerado por
// scripts/data/build-rio-bairros.js). Usado para o motorista evitar um bairro inteiro.

let cached = null;

function loadBairros() {
  if (!cached) {
    // eslint-disable-next-line global-require
    const data = require('../config/rio-bairros.json');
    const list = Array.isArray(data?.bairros) ? data.bairros : [];
    cached = { list, byId: new Map(list.map((bairro) => [String(bairro.id), bairro])) };
  }
  return cached;
}

function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Ray casting; anéis em [lat, lng].
function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [latI, lngI] = ring[i];
    const [latJ, lngJ] = ring[j];
    if ((latI > lat) !== (latJ > lat) && lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI) {
      inside = !inside;
    }
  }
  return inside;
}

function bairroContains(bairro, lat, lng) {
  const [minLat, minLng, maxLat, maxLng] = bairro.bbox;
  if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) return false;
  return bairro.rings.some((ring) => pointInRing(lat, lng, ring));
}

function getBairroById(id) {
  return loadBairros().byId.get(String(id ?? '').trim()) || null;
}

function findBairroAt(latValue, lngValue) {
  const lat = toNumber(latValue);
  const lng = toNumber(lngValue);
  if (lat === null || lng === null) return null;
  return loadBairros().list.find((bairro) => bairroContains(bairro, lat, lng)) || null;
}

function isPointInBairro(id, latValue, lngValue) {
  const bairro = getBairroById(id);
  const lat = toNumber(latValue);
  const lng = toNumber(lngValue);
  if (!bairro || lat === null || lng === null) return false;
  return bairroContains(bairro, lat, lng);
}

// Formato que o app desenha: contorno e um ponto para centralizar o mapa.
function toBairroView(bairro) {
  if (!bairro) return null;
  const [minLat, minLng, maxLat, maxLng] = bairro.bbox;
  return {
    id: String(bairro.id),
    name: bairro.name,
    center: { lat: Number(((minLat + maxLat) / 2).toFixed(5)), lng: Number(((minLng + maxLng) / 2).toFixed(5)) },
    span: { latDelta: Number((maxLat - minLat).toFixed(5)), lngDelta: Number((maxLng - minLng).toFixed(5)) },
    outline: bairro.rings.map((ring) => ring.map(([latitude, longitude]) => ({ latitude, longitude })))
  };
}

module.exports = {
  findBairroAt,
  getBairroById,
  isPointInBairro,
  toBairroView
};
