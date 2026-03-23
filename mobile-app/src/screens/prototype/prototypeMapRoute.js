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
    currentRoute = DEFAULT_ROUTE;
    notify();
    return;
  }

  const coordinates =
    Array.isArray(payload?.coordinates) && payload.coordinates.length >= 2
      ? payload.coordinates
      : buildCurvePoints(origin, destination);

  currentRoute = {
    origin,
    destination,
    coordinates,
    destinationLabel: payload?.destinationLabel || '',
    destinationAddress: payload?.destinationAddress || ''
  };

  notify();
}

export function clearPrototypeMapRoute() {
  currentRoute = DEFAULT_ROUTE;
  notify();
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
