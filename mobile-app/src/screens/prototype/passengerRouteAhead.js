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

/** The route from the driver onwards: the driver's point, then the points ahead. */
export function trimRouteAhead(coordinates = [], position, maxSnapMeters = MAX_SNAP_METERS) {
  const point = toPoint(position);
  if (!point || !Array.isArray(coordinates) || coordinates.length < 2) return coordinates;
  const { index: nearestIndex, meters: nearestMeters } = nearestRoutePoint(coordinates, point);
  if (nearestIndex < 0 || nearestMeters > maxSnapMeters) return coordinates;
  const ahead = coordinates.slice(nearestIndex + 1);
  return ahead.length > 0 ? [point, ...ahead] : [point, coordinates[coordinates.length - 1]];
}

/**
 * Live distance and ETA of the leg to the pickup. Distance along the route ahead
 * (straight line without a route); ETA keeps the pace booked at accept.
 */
export function resolveLivePickupLeg({
  driverCoordinate,
  pickupCoordinate,
  routeAhead = [],
  bookedDistanceKm = null,
  bookedEtaMinutes = null,
} = {}) {
  if (!toPoint(driverCoordinate) || !toPoint(pickupCoordinate)) return null;
  const meters = Array.isArray(routeAhead) && routeAhead.length >= 2
    ? routeLengthMeters(routeAhead)
    : distanceMeters(driverCoordinate, pickupCoordinate);
  if (!Number.isFinite(meters)) return null;
  const km = meters / 1000;
  const bookedKm = Number(bookedDistanceKm);
  const bookedEta = Number(bookedEtaMinutes);
  const kmPerMin = bookedKm > 0 && bookedEta > 0 ? bookedKm / bookedEta : FALLBACK_KM_PER_MIN;
  return { distanceKm: km, etaMinutes: Math.max(1, Math.round(km / kmPerMin)) };
}

/** Traffic colours of the route ahead only; the ones behind the car are dropped. */
export function trimTrafficAhead(segments = [], coordinates = [], position, maxSnapMeters = MAX_SNAP_METERS) {
  const point = toPoint(position);
  if (!point || !Array.isArray(segments) || segments.length === 0 || coordinates.length < 2) return segments;
  const driver = nearestRoutePoint(coordinates, point);
  if (driver.index < 0 || driver.meters > maxSnapMeters) return segments;
  return segments.filter((segment) => {
    const points = Array.isArray(segment?.coordinates) ? segment.coordinates : [];
    if (points.length === 0) return false;
    return nearestRoutePoint(coordinates, points[points.length - 1]).index > driver.index;
  });
}
