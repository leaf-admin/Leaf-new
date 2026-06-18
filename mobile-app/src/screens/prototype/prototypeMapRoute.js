const DEFAULT_ROUTE = Object.freeze({
  origin: null,
  destination: null,
  coordinates: [],
  trafficSegments: [],
  destinationLabel: '',
  destinationAddress: ''
});

let currentRoute = DEFAULT_ROUTE;
const listeners = new Set();
let currentCamera = null;
const cameraListeners = new Set();
const COORDINATE_EQUALITY_TOLERANCE = 0.00001;

function notify() {
  listeners.forEach(listener => listener(currentRoute));
}

function notifyCamera() {
  cameraListeners.forEach(listener => listener(currentCamera));
}

function isCoordinateValid(value) {
  return Boolean(value) && Number.isFinite(value.latitude) && Number.isFinite(value.longitude);
}

function areCoordinatesEqual(left, right) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    Math.abs(Number(left.latitude) - Number(right.latitude)) <= COORDINATE_EQUALITY_TOLERANCE &&
    Math.abs(Number(left.longitude) - Number(right.longitude)) <= COORDINATE_EQUALITY_TOLERANCE
  );
}

function areCoordinateListsEqual(left = [], right = []) {
  if (left === right) {
    return true;
  }

  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (!areCoordinatesEqual(left[index], right[index])) {
      return false;
    }
  }

  return true;
}

function normalizeTrafficSegments(segments = []) {
  if (!Array.isArray(segments)) {
    return [];
  }

  return segments
    .map(segment => {
      const coordinates = Array.isArray(segment?.coordinates)
        ? segment.coordinates.filter(isCoordinateValid)
        : [];

      if (coordinates.length < 2) {
        return null;
      }

      return {
        coordinates,
        color: String(segment?.color || '').trim() || '#1A330E',
        level: String(segment?.level || segment?.trafficLevel || '').trim() || 'normal'
      };
    })
    .filter(Boolean);
}

function areTrafficSegmentsEqual(left = [], right = []) {
  if (left === right) {
    return true;
  }

  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (
      String(left[index]?.color || '') !== String(right[index]?.color || '') ||
      String(left[index]?.level || '') !== String(right[index]?.level || '') ||
      !areCoordinateListsEqual(left[index]?.coordinates, right[index]?.coordinates)
    ) {
      return false;
    }
  }

  return true;
}

function areRoutesEqual(left, right) {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return (
    areCoordinatesEqual(left.origin, right.origin) &&
    areCoordinatesEqual(left.destination, right.destination) &&
    areCoordinateListsEqual(left.coordinates, right.coordinates) &&
    areTrafficSegmentsEqual(left.trafficSegments, right.trafficSegments) &&
    String(left.destinationLabel || '') === String(right.destinationLabel || '') &&
    String(left.destinationAddress || '') === String(right.destinationAddress || '')
  );
}

export function buildFallbackRouteCoordinates(origin, destination) {
  const latDiff = destination.latitude - origin.latitude;
  const lonDiff = destination.longitude - origin.longitude;
  const curveFactor = 0.14;
  const controlOffsetLat = -lonDiff * curveFactor;
  const controlOffsetLon = latDiff * curveFactor;

  return [
    origin,
    {
      latitude: origin.latitude + latDiff * 0.34 + controlOffsetLat,
      longitude: origin.longitude + lonDiff * 0.34 + controlOffsetLon
    },
    {
      latitude: origin.latitude + latDiff * 0.68 + controlOffsetLat * 0.55,
      longitude: origin.longitude + lonDiff * 0.68 + controlOffsetLon * 0.55
    },
    destination
  ];
}

export function setPrototypeMapRoute(payload) {
  const origin = payload?.origin;
  const destination = payload?.destination;

  if (!isCoordinateValid(origin) || !isCoordinateValid(destination)) {
    if (currentRoute === DEFAULT_ROUTE) {
      return;
    }

    currentRoute = DEFAULT_ROUTE;
    notify();
    return;
  }

  const explicitCoordinates = Array.isArray(payload?.coordinates)
    ? payload.coordinates.filter(isCoordinateValid)
    : [];
  const explicitTrafficSegments = normalizeTrafficSegments(payload?.trafficSegments);
  const canReuseCurrentRouteCoordinates = Boolean(
    explicitCoordinates.length < 2 &&
      currentRoute !== DEFAULT_ROUTE &&
      areCoordinatesEqual(currentRoute.origin, origin) &&
      areCoordinatesEqual(currentRoute.destination, destination) &&
      Array.isArray(currentRoute.coordinates) &&
      currentRoute.coordinates.length >= 2
  );
  const allowFallbackRoute = payload?.allowFallback !== false;
  const coordinates =
    explicitCoordinates.length >= 2
      ? explicitCoordinates
      : canReuseCurrentRouteCoordinates
        ? currentRoute.coordinates
        : allowFallbackRoute
          ? buildFallbackRouteCoordinates(origin, destination)
          : [];
  const trafficSegments =
    explicitTrafficSegments.length > 0
      ? explicitTrafficSegments
      : canReuseCurrentRouteCoordinates
        ? currentRoute.trafficSegments || []
        : [];

  if (coordinates.length < 2) {
    if (currentRoute !== DEFAULT_ROUTE) {
      currentRoute = DEFAULT_ROUTE;
      notify();
    }
    return;
  }

  const nextRoute = {
    origin,
    destination,
    coordinates,
    trafficSegments,
    destinationLabel: payload?.destinationLabel || '',
    destinationAddress: payload?.destinationAddress || ''
  };

  if (areRoutesEqual(currentRoute, nextRoute)) {
    return;
  }

  currentRoute = nextRoute;

  notify();
}

export function clearPrototypeMapRoute() {
  if (currentRoute === DEFAULT_ROUTE) {
    return;
  }

  currentRoute = DEFAULT_ROUTE;
  notify();
}

export function getPrototypeMapRoute() {
  return currentRoute;
}

export function subscribePrototypeMapRoute(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  listeners.add(listener);
  listener(currentRoute);

  return () => {
    listeners.delete(listener);
  };
}

export function publishPrototypeMapCamera(payload) {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  currentCamera = {
    latitude: Number(payload.latitude),
    longitude: Number(payload.longitude),
    latitudeDelta: Number(payload.latitudeDelta),
    longitudeDelta: Number(payload.longitudeDelta),
    visibleCenterCoordinate: isCoordinateValid(payload.visibleCenterCoordinate)
      ? payload.visibleCenterCoordinate
      : null,
    source: payload.source || 'camera',
    updatedAt: payload.updatedAt || Date.now()
  };

  notifyCamera();
}

export function subscribePrototypeMapCamera(listener) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  cameraListeners.add(listener);
  listener(currentCamera);

  return () => {
    cameraListeners.delete(listener);
  };
}
