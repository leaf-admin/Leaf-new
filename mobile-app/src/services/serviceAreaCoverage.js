import { getSelfHostedApiUrl } from '../config/ApiConfig';

// Consulta se um ponto está na área atendida antes de qualquer busca paga.
// Usa /api/geofence/check (polígono da Leaf, sem Google). Falha aberta: sem
// resposta, o app segue como antes e a cotação continua sendo a trava final.
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6000;
const cache = new Map();

// ~100 m: andar dentro do mesmo quarteirão não refaz a consulta.
export function coverageCacheKey(coordinate) {
  const lat = Number(coordinate?.latitude);
  const lng = Number(coordinate?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat.toFixed(3)},${lng.toFixed(3)}`;
}

// 'inside' | 'outside' | null (desconhecido: não bloqueia nada).
export function interpretCoverageResponse(payload) {
  if (!payload || typeof payload !== 'object' || payload.success !== true) return null;
  if (payload.isAllowed === true) return 'inside';
  if (payload.isAllowed === false && payload.code === 'GEOFENCE_OUTSIDE_REGION') return 'outside';
  return null;
}

export async function checkServiceAreaCoverage(coordinate, { fetchImpl = fetch, now = Date.now } = {}) {
  const key = coverageCacheKey(coordinate);
  if (!key) return null;
  const cached = cache.get(key);
  if (cached && now() - cached.at < CACHE_TTL_MS) return cached.status;

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const query = `lat=${encodeURIComponent(coordinate.latitude)}&lng=${encodeURIComponent(coordinate.longitude)}`;
    const response = await fetchImpl(getSelfHostedApiUrl(`/api/geofence/check?${query}`), {
      method: 'GET',
      signal: controller?.signal,
    });
    const payload = await response.json().catch(() => null);
    const status = interpretCoverageResponse(payload);
    if (status) cache.set(key, { status, at: now() });
    return status;
  } catch (_error) {
    return null;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export function resetServiceAreaCoverageCache() {
  cache.clear();
}
