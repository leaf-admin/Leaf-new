const DEFAULT_ROUTE = Object.freeze({
  origin: null,
  destination: null,
  coordinates: [],
  destinationLabel: '',
  destinationAddress: ''
});

let currentRoute = DEFAULT_ROUTE;
const listeners = new Set();

function notify() {
  listeners.forEach(listener => listener(currentRoute));
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

  return left.latitude === right.latitude && left.longitude === right.longitude;
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
    String(left.destinationLabel || '') === String(right.destinationLabel || '') &&
    String(left.destinationAddress || '') === String(right.destinationAddress || '')
  );
}

function buildCurvePoints(origin, destination) {
  const latDiff = destination.latitude - origin.latitude;
  const lonDiff = destination.longitude - origin.longitude;
  const curveFactor = 0.2;
  const controlOffsetLat = -lonDiff * curveFactor;
  const controlOffsetLon = latDiff * curveFactor;

  return [
    origin,
    {
      latitude: origin.latitude + latDiff * 0.28 + controlOffsetLat,
      longitude: origin.longitude + lonDiff * 0.28 + controlOffsetLon
    },
    {
      latitude: origin.latitude + latDiff * 0.64 + controlOffsetLat * 0.65,
      longitude: origin.longitude + lonDiff * 0.64 + controlOffsetLon * 0.65
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

  const coordinates =
    Array.isArray(payload?.coordinates) && payload.coordinates.length >= 2
      ? payload.coordinates
      : buildCurvePoints(origin, destination);

  const nextRoute = {
    origin,
    destination,
    coordinates,
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
