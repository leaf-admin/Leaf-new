const DESTINATION_SEARCH_SESSION_IDLE_MS = 45000;
const DESTINATION_SEARCH_RESULT_CACHE_MS = 15000;

let runtimeDestinationSearchSessionToken = "";
let runtimeDestinationSearchSessionLastUsedAt = 0;
let runtimeDestinationSearchLastCacheKey = "";
let runtimeDestinationSearchLastResults = [];
let runtimeDestinationSearchLastResultsAt = 0;

function sanitizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

export function parseNameFromDescription(description = "") {
  const clean = String(description || "").trim();
  if (!clean) {
    return "Destino";
  }

  const separator = clean.indexOf(" - ");
  if (separator > 0) {
    return clean.slice(0, separator).trim();
  }

  const comma = clean.indexOf(",");
  if (comma > 0) {
    return clean.slice(0, comma).trim();
  }

  return clean;
}

export function parseAddressFromDescription(description = "") {
  const clean = String(description || "").trim();
  if (!clean) {
    return "";
  }

  const separator = clean.indexOf(" - ");
  if (separator > 0 && separator < clean.length - 3) {
    return clean.slice(separator + 3).trim();
  }

  const comma = clean.indexOf(",");
  if (comma > 0 && comma < clean.length - 2) {
    return clean.slice(comma + 1).trim();
  }

  return clean;
}

function createRuntimeDestinationSearchSessionToken() {
  return `proto-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

export function resetRuntimeDestinationSearchSession(_reason = "") {
  runtimeDestinationSearchSessionToken = "";
  runtimeDestinationSearchSessionLastUsedAt = 0;
  runtimeDestinationSearchLastCacheKey = "";
  runtimeDestinationSearchLastResults = [];
  runtimeDestinationSearchLastResultsAt = 0;
}

export function getRuntimeDestinationSearchSessionToken() {
  const now = Date.now();
  if (
    !runtimeDestinationSearchSessionToken ||
    now - runtimeDestinationSearchSessionLastUsedAt >
      DESTINATION_SEARCH_SESSION_IDLE_MS
  ) {
    runtimeDestinationSearchSessionToken =
      createRuntimeDestinationSearchSessionToken();
  }
  runtimeDestinationSearchSessionLastUsedAt = now;
  return runtimeDestinationSearchSessionToken;
}

function cloneRuntimeDestinationSearchResults(results = []) {
  if (!Array.isArray(results)) {
    return [];
  }
  return results.map((item) => ({ ...item }));
}

export function buildRuntimeDestinationSearchCacheKey(query, location) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return "";
  }
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  const normalizedLat = Number.isFinite(lat) ? lat.toFixed(3) : "na";
  const normalizedLng = Number.isFinite(lng) ? lng.toFixed(3) : "na";
  return `${normalizedQuery}:${normalizedLat}:${normalizedLng}`;
}

export function getCachedRuntimeDestinationSearchResults({ query, location }) {
  const cacheKey = buildRuntimeDestinationSearchCacheKey(query, location);
  if (!cacheKey || runtimeDestinationSearchLastCacheKey !== cacheKey) {
    return null;
  }

  const now = Date.now();
  if (now - runtimeDestinationSearchLastResultsAt > DESTINATION_SEARCH_RESULT_CACHE_MS) {
    runtimeDestinationSearchLastCacheKey = "";
    runtimeDestinationSearchLastResults = [];
    runtimeDestinationSearchLastResultsAt = 0;
    return null;
  }

  return cloneRuntimeDestinationSearchResults(runtimeDestinationSearchLastResults);
}

export function setCachedRuntimeDestinationSearchResults({ query, location, results }) {
  const cacheKey = buildRuntimeDestinationSearchCacheKey(query, location);
  if (!cacheKey) {
    return;
  }
  runtimeDestinationSearchLastCacheKey = cacheKey;
  runtimeDestinationSearchLastResults = cloneRuntimeDestinationSearchResults(results);
  runtimeDestinationSearchLastResultsAt = Date.now();
}

export function normalizeDestinationItem(item = {}) {
  const coordinate =
    item?.coordinate ||
    (item?.lat && item?.lng
      ? { latitude: item.lat, longitude: item.lng }
      : null);
  const name =
    item?.name ||
    item?.mainText ||
    parseNameFromDescription(item?.description || item?.address || "Destino");
  const address =
    item?.address ||
    item?.secondaryText ||
    parseAddressFromDescription(item?.description || name);

  return {
    id: item?.id || item?.place_id || `${name}-${address}`,
    name,
    address,
    eta: item?.eta || " -- ",
    place_id: item?.place_id || item?.placeId || null,
    sourceType: sanitizeText(item?.sourceType, ""),
    previewMode: sanitizeText(item?.previewMode, ""),
    skipGooglePreview: item?.skipGooglePreview === true,
    searchSessionToken:
      sanitizeText(item?.searchSessionToken || item?.sessionToken, "") || null,
    coordinate:
      coordinate &&
      Number.isFinite(coordinate.latitude) &&
      Number.isFinite(coordinate.longitude)
        ? {
            latitude: Number(coordinate.latitude),
            longitude: Number(coordinate.longitude),
          }
        : null,
  };
}
