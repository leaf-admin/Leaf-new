import apiClient from '../httpClient';

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function estimateZoomFromRegion(region) {
  const longitudeDelta = Number(region?.longitudeDelta || 0);
  if (!Number.isFinite(longitudeDelta) || longitudeDelta <= 0) {
    return 13;
  }

  const zoom = Math.round(Math.log2(360 / longitudeDelta));
  return clamp(zoom, 1, 20);
}

export function bboxFromRegion(region) {
  const latitude = Number(region?.latitude);
  const longitude = Number(region?.longitude);
  const latitudeDelta = Number(region?.latitudeDelta);
  const longitudeDelta = Number(region?.longitudeDelta);

  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitudeDelta) ||
    !Number.isFinite(longitudeDelta) ||
    latitudeDelta <= 0 ||
    longitudeDelta <= 0
  ) {
    return null;
  }

  return {
    minLng: longitude - longitudeDelta / 2,
    minLat: latitude - latitudeDelta / 2,
    maxLng: longitude + longitudeDelta / 2,
    maxLat: latitude + latitudeDelta / 2
  };
}

export function buildH3ViewportParams(region, surface = 'driver', options = {}) {
  const bbox = bboxFromRegion(region);
  if (!bbox) return null;

  return {
    bbox: [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat].join(','),
    zoom: estimateZoomFromRegion(region),
    surface,
    mode: 'supply_demand',
    includeBoundary: true,
    includeEmpty: options.includeEmpty === true
  };
}

export async function fetchH3CellsForRegion(region, options = {}) {
  const surface = options.surface || 'driver';
  const params = buildH3ViewportParams(region, surface, {
    includeEmpty: options.includeEmpty === true || surface === 'driver'
  });
  if (!params) {
    return { cells: [], summary: null };
  }

  const response = await apiClient.get('/api/map/h3-cells', {
    params,
    signal: options.signal
  });

  return response?.data || response;
}

export default {
  estimateZoomFromRegion,
  bboxFromRegion,
  buildH3ViewportParams,
  fetchH3CellsForRegion
};
