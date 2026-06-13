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

export function isCoordinateInsideRegion(coordinate, region, insetRatio = 0) {
  const latitude = Number(coordinate?.latitude ?? coordinate?.lat);
  const longitude = Number(coordinate?.longitude ?? coordinate?.lng);
  const bbox = bboxFromRegion(region);
  if (!bbox || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }

  const safeInset = clamp(Number(insetRatio) || 0, 0, 0.45);
  const latitudeInset = (bbox.maxLat - bbox.minLat) * safeInset;
  const longitudeInset = (bbox.maxLng - bbox.minLng) * safeInset;

  return latitude >= bbox.minLat + latitudeInset
    && latitude <= bbox.maxLat - latitudeInset
    && longitude >= bbox.minLng + longitudeInset
    && longitude <= bbox.maxLng - longitudeInset;
}

export function resolveH3LabelAnchor(coordinate, region, edgeRatio = 0.16) {
  const latitude = Number(coordinate?.latitude ?? coordinate?.lat);
  const longitude = Number(coordinate?.longitude ?? coordinate?.lng);
  const latitudeDelta = Number(region?.latitudeDelta);
  const longitudeDelta = Number(region?.longitudeDelta);
  const centerLatitude = Number(region?.latitude);
  const centerLongitude = Number(region?.longitude);

  if (
    !Number.isFinite(latitude)
    || !Number.isFinite(longitude)
    || !Number.isFinite(latitudeDelta)
    || !Number.isFinite(longitudeDelta)
    || !Number.isFinite(centerLatitude)
    || !Number.isFinite(centerLongitude)
    || latitudeDelta <= 0
    || longitudeDelta <= 0
  ) {
    return { x: 0.5, y: 0.5 };
  }

  const safeEdgeRatio = clamp(Number(edgeRatio) || 0.16, 0.05, 0.35);
  const minLatitude = centerLatitude - latitudeDelta / 2;
  const maxLatitude = centerLatitude + latitudeDelta / 2;
  const minLongitude = centerLongitude - longitudeDelta / 2;
  const horizontalPosition = (longitude - minLongitude) / longitudeDelta;
  const verticalPosition = (maxLatitude - latitude) / latitudeDelta;

  return {
    x: horizontalPosition <= safeEdgeRatio
      ? 0
      : horizontalPosition >= 1 - safeEdgeRatio
        ? 1
        : 0.5,
    y: verticalPosition <= safeEdgeRatio
      ? 0
      : verticalPosition >= 1 - safeEdgeRatio
        ? 1
        : 0.5
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
  isCoordinateInsideRegion,
  resolveH3LabelAnchor,
  buildH3ViewportParams,
  fetchH3CellsForRegion
};
