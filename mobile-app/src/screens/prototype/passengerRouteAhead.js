// What is left of the route from where the driver is now. The passenger map used
// to keep the whole route from where the driver accepted, and the card kept the
// distance and ETA booked at accept: the car reached the pickup on the map while
// the card still said "680 m até o embarque" (device QA, 2026-10-20).

const EARTH_RADIUS_METERS = 6371000;
// A driver farther than this from the line is off it: keep the whole route.
const MAX_SNAP_METERS = 150;
// Without a booked pace, city driving.
const FALLBACK_KM_PER_MIN = 0.45;

function toPoint(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  return Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null;
}

export function distanceMeters(a, b) {
  const from = toPoint(a);
  const to = toPoint(b);
  if (!from || !to) return NaN;
  const rad = (value) => (value * Math.PI) / 180;
  const dLat = rad(to.latitude - from.latitude);
  const dLng = rad(to.longitude - from.longitude);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

export function routeLengthMeters(coordinates = []) {
  let total = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const step = distanceMeters(coordinates[index - 1], coordinates[index]);
    if (Number.isFinite(step)) total += step;
  }
  return total;
}

function nearestRoutePoint(coordinates, position) {
  let index = -1;
  let meters = Infinity;
  coordinates.forEach((coordinate, candidate) => {
    const distance = distanceMeters(position, coordinate);
    if (distance < meters) {
      meters = distance;
      index = candidate;
    }
  });
  return { index, meters };
}

// The route on the map changes in steps of this many points, not on every fix: a
// new polyline per second is what Google Maps on iOS pays for in memory, and the
// car marker covers the few metres between steps.
const ROUTE_AHEAD_STEP_POINTS = 5;

/** Index where the route ahead starts, in steps; 0 when the driver is off the route. */
export function routeAheadStartIndex(coordinates = [], position, maxSnapMeters = MAX_SNAP_METERS) {
  const point = toPoint(position);
  if (!point || !Array.isArray(coordinates) || coordinates.length < 2) return 0;
  const { index, meters } = nearestRoutePoint(coordinates, point);
  if (index < 0 || meters > maxSnapMeters) return 0;
  // Near the end, point by point: the line has to vanish at the arrival.
  if (coordinates.length - index <= ROUTE_AHEAD_STEP_POINTS) {
    return Math.min(index, coordinates.length - 2);
  }
  return Math.floor(index / ROUTE_AHEAD_STEP_POINTS) * ROUTE_AHEAD_STEP_POINTS;
}

/** Metres left along the route from the driver (straight line when off the route). */
export function remainingRouteMeters(coordinates = [], position, maxSnapMeters = MAX_SNAP_METERS) {
  const point = toPoint(position);
  if (!point || !Array.isArray(coordinates) || coordinates.length < 2) return NaN;
  const { index, meters } = nearestRoutePoint(coordinates, point);
  if (index < 0 || meters > maxSnapMeters) return NaN;
  const ahead = coordinates.slice(index + 1);
  return ahead.length > 0 ? distanceMeters(point, ahead[0]) + routeLengthMeters(ahead) : 0;
}

/** Traffic colours of the route from `startIndex` on. */
export function trafficFromIndex(segments = [], coordinates = [], startIndex = 0) {
  if (!Array.isArray(segments) || segments.length === 0 || !(startIndex > 0)) return segments;
  return segments.filter((segment) => {
    const points = Array.isArray(segment?.coordinates) ? segment.coordinates : [];
    if (points.length === 0) return false;
    return nearestRoutePoint(coordinates, points[points.length - 1]).index > startIndex;
  });
}

/**
 * Live distance and ETA of the leg to the pickup. Distance along the route from the
 * car (straight line off the route); ETA keeps the pace booked at accept.
 */
export function resolveLivePickupLeg({
  driverCoordinate,
  pickupCoordinate,
  routeCoordinates = [],
  bookedDistanceKm = null,
  bookedEtaMinutes = null,
} = {}) {
  if (!toPoint(driverCoordinate) || !toPoint(pickupCoordinate)) return null;
  const alongRoute = remainingRouteMeters(routeCoordinates, driverCoordinate);
  const meters = Number.isFinite(alongRoute) ? alongRoute : distanceMeters(driverCoordinate, pickupCoordinate);
  if (!Number.isFinite(meters)) return null;
  const km = meters / 1000;
  const bookedKm = Number(bookedDistanceKm);
  const bookedEta = Number(bookedEtaMinutes);
  const kmPerMin = bookedKm > 0 && bookedEta > 0 ? bookedKm / bookedEta : FALLBACK_KM_PER_MIN;
  return { distanceKm: km, etaMinutes: Math.max(1, Math.round(km / kmPerMin)) };
}
