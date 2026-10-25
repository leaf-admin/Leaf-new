const DEFAULT_ADVANCE_THRESHOLD_METERS = 35;
const DEFAULT_OFF_ROUTE_THRESHOLD_METERS = 100;
// Match the existing server pickup-arrival default; the backend validates the
// command independently. Destination's visual hint keeps its existing radius.
export const PICKUP_ARRIVAL_METERS = 20;
const DESTINATION_ARRIVAL_BANNER_METERS = 80;
const EARTH_RADIUS_METERS = 6371000;
const CAMERA_LOOK_AHEAD_METERS = 55;
export const NAVIGATION_CAMERA_ANCHOR_Y = 0.72;
export const NAVIGATION_CAMERA_ANIMATION_MS = 800;
// Fixed perspective during driver guidance: no speed-driven pitch oscillation.
export const NAVIGATION_CAMERA_FOLLOW_PITCH = 40;
const NAVIGATION_CAMERA_MAX_ROUTE_ZOOM = 15.8;
// Chegou ao destino: mesmo zoom da navegação, sem fechar de repente no ponto final.
const NAVIGATION_CAMERA_ARRIVAL_ZOOM = NAVIGATION_CAMERA_MAX_ROUTE_ZOOM;

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeNavigationCoordinate(value = null) {
  const latitude = toFiniteNumber(value?.latitude ?? value?.lat);
  const longitude = toFiniteNumber(value?.longitude ?? value?.lng);

  if (latitude === null || longitude === null) {
    return null;
  }

  return { latitude, longitude };
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function toDegrees(value) {
  return (Number(value) * 180) / Math.PI;
}

function normalizeDegrees(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = numeric % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function normalizeNavigationSpeedKmh({
  speedKmh = null,
  speedMetersPerSecond = null,
  coordinate = null,
} = {}) {
  const hasExplicitKmh = speedKmh !== null && speedKmh !== undefined && speedKmh !== '';
  const explicitKmh = Number(speedKmh);
  if (hasExplicitKmh && Number.isFinite(explicitKmh) && explicitKmh >= 0) {
    return explicitKmh;
  }

  const rawMetersPerSecond =
    speedMetersPerSecond !== null &&
    speedMetersPerSecond !== undefined &&
    speedMetersPerSecond !== ''
      ? speedMetersPerSecond
      : coordinate?.speed;
  const hasMetersPerSecond =
    rawMetersPerSecond !== null &&
    rawMetersPerSecond !== undefined &&
    rawMetersPerSecond !== '';
  const explicitMps = Number(rawMetersPerSecond);
  if (hasMetersPerSecond && Number.isFinite(explicitMps) && explicitMps >= 0) {
    return explicitMps * 3.6;
  }

  return 0;
}

// Zoom estável, só pela velocidade. A rampa pela distância restante (15,2 longe do
// ponto até 17,3 perto, 18,6 na chegada) fechava o mapa a cada poucos metros e dava
// um salto ao tocar "Cheguei", quando a câmera de espera volta a 15,8. A partir de ~16
// o mapa base do Android escurece as quadras (visto no Xiaomi de QA a 16,3), então o
// teto é o mesmo 15,8 da espera.
export function resolveNavigationCameraZoom(speedKmh = 0) {
  const normalizedSpeed = Math.max(0, Number(speedKmh) || 0);
  if (normalizedSpeed <= 25) {
    return NAVIGATION_CAMERA_MAX_ROUTE_ZOOM;
  }
  if (normalizedSpeed <= 50) {
    return 15.5;
  }
  if (normalizedSpeed <= 80) {
    return 15.2;
  }
  return 14.9;
}

// A small speed dead band prevents repeated zoom changes around each boundary.
// An explicit stage zoom (e.g. arrival) still takes precedence.
export function resolveStableNavigationCameraZoom(speedKmh, previousZoom, requestedZoom = resolveNavigationCameraZoom(speedKmh)) {
  const speed = Math.max(0, Number(speedKmh) || 0);
  if (requestedZoom !== resolveNavigationCameraZoom(speed)) return requestedZoom;
  const bands = [
    { zoom: 15.8, min: 0, max: 28 },
    { zoom: 15.5, min: 22, max: 53 },
    { zoom: 15.2, min: 47, max: 83 },
    { zoom: 14.9, min: 77, max: Infinity },
  ];
  const previousBand = bands.find(band => band.zoom === previousZoom);
  return previousBand && speed >= previousBand.min && speed <= previousBand.max
    ? previousZoom : requestedZoom;
}

export function shouldRevealNavigationRoute({
  lastRevealedNavigationKey = '',
  navigationKey = '',
  status = '',
  routeCoordinates = [],
} = {}) {
  const normalizedKey = String(navigationKey || '').trim();
  const normalizedStatus = String(status || '').trim().toLowerCase();
  const validRouteCoordinateCount = Array.isArray(routeCoordinates)
    ? routeCoordinates.map(normalizeNavigationCoordinate).filter(Boolean).length
    : 0;

  return Boolean(
    normalizedKey &&
      normalizedKey !== String(lastRevealedNavigationKey || '').trim() &&
      ['accepted', 'started'].includes(normalizedStatus) &&
      validRouteCoordinateCount >= 2
  );
}

export function resolveNavigationCameraPitch() {
  return NAVIGATION_CAMERA_FOLLOW_PITCH;
}

// Google positions camera.center in the centre of its padded viewport, even
// with pitch. Add virtual space above that centre to leave the car lower in
// the *visible* map. Unlike a flat metres-per-pixel offset, this stays correct
// when the perspective changes, without querying screen points every frame.
export function resolveNavigationCameraPadding({
  mapHeight, occludedTop = 0, occludedBottom = 0,
  anchorY = NAVIGATION_CAMERA_ANCHOR_Y,
} = {}) {
  const height = toFiniteNumber(mapHeight);
  if (height === null || height < 180) return null;
  const top = Math.min(height - 120, Math.max(0, toFiniteNumber(occludedTop) || 0));
  const bottom = Math.min(height - top - 120, Math.max(0, toFiniteNumber(occludedBottom) || 0));
  const visibleHeight = height - top - bottom;
  const anchor = Math.max(0.5, Math.min(0.8, toFiniteNumber(anchorY) || NAVIGATION_CAMERA_ANCHOR_Y));
  return {
    top: Math.min(height - bottom - 80, top + (2 * anchor - 1) * visibleHeight),
    bottom,
    left: 0,
    right: 0,
  };
}

export function calculateNavigationDistanceMeters(left, right) {
  const start = normalizeNavigationCoordinate(left);
  const end = normalizeNavigationCoordinate(right);

  if (!start || !end) {
    return Number.POSITIVE_INFINITY;
  }

  const latDelta = toRadians(end.latitude - start.latitude);
  const lonDelta = toRadians(end.longitude - start.longitude);
  const startLat = toRadians(start.latitude);
  const endLat = toRadians(end.latitude);
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(startLat) * Math.cos(endLat) * Math.sin(lonDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function calculateNavigationBearingDegrees(left, right) {
  const start = normalizeNavigationCoordinate(left);
  const end = normalizeNavigationCoordinate(right);

  if (!start || !end) {
    return null;
  }

  const startLat = toRadians(start.latitude);
  const endLat = toRadians(end.latitude);
  const lonDelta = toRadians(end.longitude - start.longitude);
  const y = Math.sin(lonDelta) * Math.cos(endLat);
  const x =
    Math.cos(startLat) * Math.sin(endLat) -
    Math.sin(startLat) * Math.cos(endLat) * Math.cos(lonDelta);

  return normalizeDegrees(toDegrees(Math.atan2(y, x)));
}

export function normalizeNavigationSteps(steps = []) {
  if (!Array.isArray(steps)) {
    return [];
  }

  return steps
    .map((step) => {
      const startLocation = normalizeNavigationCoordinate(step?.startLocation || step?.start_location);
      const endLocation = normalizeNavigationCoordinate(step?.endLocation || step?.end_location);

      if (!startLocation || !endLocation) {
        return null;
      }

      const distanceMeters = toFiniteNumber(step?.distanceMeters ?? step?.distance_meters);
      const durationSeconds = toFiniteNumber(step?.durationSeconds ?? step?.duration_seconds);
      const maneuverLocation = normalizeNavigationCoordinate(step?.maneuverLocation);

      return {
        instruction: String(step?.instruction || '').replace(/\s+/g, ' ').trim() || 'Siga em frente',
        startLocation,
        endLocation,
        ...(maneuverLocation ? { maneuverLocation } : {}),
        ...(step?.maneuver ? { maneuver: String(step.maneuver) } : {}),
        distanceMeters: distanceMeters !== null && distanceMeters >= 0 ? distanceMeters : 0,
        durationSeconds: durationSeconds !== null && durationSeconds >= 0 ? durationSeconds : 0,
        polylinePoints: step?.polylinePoints || null,
        synthetic: Boolean(step?.synthetic),
      };
    })
    .filter(Boolean);
}

function formatDistanceLabel(distanceMeters) {
  if (
    distanceMeters === null ||
    distanceMeters === undefined ||
    distanceMeters === '' ||
    !Number.isFinite(distanceMeters) ||
    distanceMeters < 0
  ) {
    return '--';
  }

  if (distanceMeters < 1000) {
    const roundedMeters =
      distanceMeters <= 0 ? 0 : Math.max(10, Math.round(distanceMeters / 10) * 10);
    return `${roundedMeters} m`;
  }

  return `${Math.max(1, Math.round(distanceMeters / 1000))} km`;
}

function formatEtaLabel(durationMinutes) {
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return '--';
  }

  return `${Math.max(1, Math.round(durationMinutes))} min`;
}

function projectCoordinateToMeters(origin, coordinate) {
  const normalizedOrigin = normalizeNavigationCoordinate(origin);
  const normalizedCoordinate = normalizeNavigationCoordinate(coordinate);

  if (!normalizedOrigin || !normalizedCoordinate) {
    return null;
  }

  const latitudeRad = toRadians(normalizedOrigin.latitude);
  return {
    x:
      toRadians(normalizedCoordinate.longitude - normalizedOrigin.longitude) *
      EARTH_RADIUS_METERS *
      Math.cos(latitudeRad),
    y:
      toRadians(normalizedCoordinate.latitude - normalizedOrigin.latitude) *
      EARTH_RADIUS_METERS,
  };
}

function distancePointToSegmentMeters(point, segmentStart, segmentEnd) {
  const origin = normalizeNavigationCoordinate(point);
  const start = projectCoordinateToMeters(origin, segmentStart);
  const end = projectCoordinateToMeters(origin, segmentEnd);

  if (!origin || !start || !end) {
    return Number.POSITIVE_INFINITY;
  }

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= 0) {
    return Math.sqrt(start.x * start.x + start.y * start.y);
  }

  const ratio = Math.max(0, Math.min(1, -((start.x * dx + start.y * dy) / lengthSquared)));
  const projectionX = start.x + ratio * dx;
  const projectionY = start.y + ratio * dy;
  return Math.sqrt(projectionX * projectionX + projectionY * projectionY);
}

export function calculateDistanceToRouteMeters(currentCoordinate, routeCoordinates = []) {
  const current = normalizeNavigationCoordinate(currentCoordinate);
  const coordinates = Array.isArray(routeCoordinates)
    ? routeCoordinates.map(normalizeNavigationCoordinate).filter(Boolean)
    : [];

  if (!current || coordinates.length < 2) {
    return Number.POSITIVE_INFINITY;
  }

  let nearestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const distance = distancePointToSegmentMeters(current, coordinates[index], coordinates[index + 1]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
    }
  }

  return nearestDistance;
}

function findNearestRouteIndex(currentCoordinate, routeCoordinates = []) {
  const current = normalizeNavigationCoordinate(currentCoordinate);
  const coordinates = Array.isArray(routeCoordinates)
    ? routeCoordinates.map(normalizeNavigationCoordinate).filter(Boolean)
    : [];

  if (!current || coordinates.length === 0) {
    return -1;
  }

  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  coordinates.forEach((coordinate, index) => {
    const distance = calculateNavigationDistanceMeters(current, coordinate);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  return nearestIndex;
}

function interpolateNavigationCoordinate(start, end, ratio) {
  const normalizedStart = normalizeNavigationCoordinate(start);
  const normalizedEnd = normalizeNavigationCoordinate(end);
  const clampedRatio = Math.max(0, Math.min(1, Number(ratio) || 0));

  if (!normalizedStart || !normalizedEnd) {
    return normalizedStart || normalizedEnd || null;
  }

  return {
    latitude:
      normalizedStart.latitude +
      (normalizedEnd.latitude - normalizedStart.latitude) * clampedRatio,
    longitude:
      normalizedStart.longitude +
      (normalizedEnd.longitude - normalizedStart.longitude) * clampedRatio,
  };
}

function calculateRemainingRouteMeters(currentCoordinate, routeCoordinates = [], fallbackMeters = null) {
  const current = normalizeNavigationCoordinate(currentCoordinate);
  const coordinates = Array.isArray(routeCoordinates)
    ? routeCoordinates.map(normalizeNavigationCoordinate).filter(Boolean)
    : [];

  if (!current || coordinates.length < 2) {
    return Number.isFinite(Number(fallbackMeters)) ? Math.max(0, Number(fallbackMeters)) : null;
  }

  const currentMeasure = projectCoordinateToRouteMeasure(current, coordinates);
  if (
    currentMeasure &&
    Number.isFinite(currentMeasure.routeMeters) &&
    Number.isFinite(currentMeasure.totalMeters)
  ) {
    return Math.max(0, currentMeasure.totalMeters - currentMeasure.routeMeters);
  }

  const nearestIndex = findNearestRouteIndex(current, coordinates);
  if (nearestIndex < 0) {
    return Number.isFinite(Number(fallbackMeters)) ? Math.max(0, Number(fallbackMeters)) : null;
  }

  let remainingMeters = calculateNavigationDistanceMeters(current, coordinates[nearestIndex]);
  for (let index = nearestIndex; index < coordinates.length - 1; index += 1) {
    remainingMeters += calculateNavigationDistanceMeters(coordinates[index], coordinates[index + 1]);
  }

  return Number.isFinite(remainingMeters) ? Math.max(0, remainingMeters) : null;
}

function calculateRouteDistanceToCoordinateMeters(
  currentCoordinate,
  routeCoordinates = [],
  targetCoordinate = null,
  fallbackMeters = null,
) {
  const current = normalizeNavigationCoordinate(currentCoordinate);
  const target = normalizeNavigationCoordinate(targetCoordinate);
  const coordinates = Array.isArray(routeCoordinates)
    ? routeCoordinates.map(normalizeNavigationCoordinate).filter(Boolean)
    : [];

  if (!current || !target || coordinates.length < 2) {
    return Number.isFinite(Number(fallbackMeters)) ? Math.max(0, Number(fallbackMeters)) : null;
  }

  const routeMeasure = buildRouteMeasureSegments(coordinates);
  const currentMeasure = projectCoordinateToRouteMeasure(current, coordinates, routeMeasure);
  const targetMeasure = projectCoordinateToRouteMeasure(target, coordinates, routeMeasure);
  if (
    currentMeasure &&
    targetMeasure &&
    Number.isFinite(currentMeasure.routeMeters) &&
    Number.isFinite(targetMeasure.routeMeters)
  ) {
    return Math.max(0, targetMeasure.routeMeters - currentMeasure.routeMeters);
  }

  const currentIndex = findNearestRouteIndex(current, coordinates);
  const targetIndex = findNearestRouteIndex(target, coordinates);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex < currentIndex) {
    return Number.isFinite(Number(fallbackMeters)) ? Math.max(0, Number(fallbackMeters)) : null;
  }

  let distanceMeters = calculateNavigationDistanceMeters(current, coordinates[currentIndex]);
  for (let index = currentIndex; index < targetIndex; index += 1) {
    distanceMeters += calculateNavigationDistanceMeters(coordinates[index], coordinates[index + 1]);
  }
  distanceMeters += calculateNavigationDistanceMeters(coordinates[targetIndex], target);

  return Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : null;
}

function normalizeSignedBearingDeltaDegrees(startBearing, endBearing) {
  const normalizedStart = normalizeDegrees(startBearing);
  const normalizedEnd = normalizeDegrees(endBearing);

  if (normalizedStart === null || normalizedEnd === null) {
    return null;
  }

  const rawDelta = normalizedEnd - normalizedStart;
  if (rawDelta > 180) {
    return rawDelta - 360;
  }
  if (rawDelta < -180) {
    return rawDelta + 360;
  }
  return rawDelta;
}

function calculateRouteDistanceBetweenIndexes(routeCoordinates = [], startIndex = 0, endIndex = 0) {
  const coordinates = Array.isArray(routeCoordinates)
    ? routeCoordinates.map(normalizeNavigationCoordinate).filter(Boolean)
    : [];
  const safeStartIndex = Math.max(0, Math.min(coordinates.length - 1, Number(startIndex) || 0));
  const safeEndIndex = Math.max(safeStartIndex, Math.min(coordinates.length - 1, Number(endIndex) || 0));

  if (coordinates.length < 2 || safeEndIndex <= safeStartIndex) {
    return 0;
  }

  let distanceMeters = 0;
  for (let index = safeStartIndex; index < safeEndIndex; index += 1) {
    distanceMeters += calculateNavigationDistanceMeters(coordinates[index], coordinates[index + 1]);
  }

  return Number.isFinite(distanceMeters) ? Math.max(0, distanceMeters) : 0;
}

function buildRouteMeasureSegments(routeCoordinates = []) {
  const coordinates = Array.isArray(routeCoordinates)
    ? routeCoordinates.map(normalizeNavigationCoordinate).filter(Boolean)
    : [];

  if (coordinates.length < 2) {
    return null;
  }

  const origin = coordinates[0];
  const segments = [];
  let totalMeters = 0;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    const startMeters = projectCoordinateToMeters(origin, start);
    const endMeters = projectCoordinateToMeters(origin, end);
    const meters = calculateNavigationDistanceMeters(start, end);

    if (!startMeters || !endMeters || !Number.isFinite(meters) || meters <= 0) {
      continue;
    }

    segments.push({
      startMeters,
      endMeters,
      routeStartMeters: totalMeters,
      routeEndMeters: totalMeters + meters,
      meters,
    });
    totalMeters += meters;
  }

  if (segments.length === 0 || totalMeters <= 0) {
    return null;
  }

  return { coordinates, origin, segments, totalMeters };
}

function projectCoordinateToRouteMeasure(
  coordinate,
  routeCoordinates = [],
  routeMeasure = buildRouteMeasureSegments(routeCoordinates),
) {
  const current = normalizeNavigationCoordinate(coordinate);

  if (!current || !routeMeasure) {
    return null;
  }

  const currentMeters = projectCoordinateToMeters(routeMeasure.origin, current);
  if (!currentMeters) {
    return null;
  }

  let nearest = null;

  routeMeasure.segments.forEach((segment) => {
    const deltaX = segment.endMeters.x - segment.startMeters.x;
    const deltaY = segment.endMeters.y - segment.startMeters.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;

    if (lengthSquared <= 0) {
      return;
    }

    const ratio = Math.max(
      0,
      Math.min(
        1,
        ((currentMeters.x - segment.startMeters.x) * deltaX +
          (currentMeters.y - segment.startMeters.y) * deltaY) /
          lengthSquared,
      ),
    );
    const projectedX = segment.startMeters.x + deltaX * ratio;
    const projectedY = segment.startMeters.y + deltaY * ratio;
    const offRouteDeltaX = currentMeters.x - projectedX;
    const offRouteDeltaY = currentMeters.y - projectedY;
    const squaredDistance = offRouteDeltaX * offRouteDeltaX + offRouteDeltaY * offRouteDeltaY;
    const routeMeters = segment.routeStartMeters + segment.meters * ratio;

    if (!nearest || squaredDistance < nearest.squaredDistance) {
      nearest = {
        routeMeters,
        squaredDistance,
        totalMeters: routeMeasure.totalMeters,
      };
    }
  });

  return nearest;
}

function buildSyntheticNavigationStepsFromRoute(
  routeCoordinates = [],
  totalDurationMinutes = null,
  phase = 'destination',
) {
  const targetLabel = phase === 'pickup' ? 'o embarque' : 'o destino';
  const coordinates = Array.isArray(routeCoordinates)
    ? routeCoordinates.map(normalizeNavigationCoordinate).filter(Boolean)
    : [];

  if (coordinates.length < 2) {
    return [];
  }

  const totalRouteDistanceMeters = calculateRouteDistanceBetweenIndexes(
    coordinates,
    0,
    coordinates.length - 1,
  );
  const totalDurationSeconds =
    Number.isFinite(Number(totalDurationMinutes)) && Number(totalDurationMinutes) > 0
      ? Number(totalDurationMinutes) * 60
      : null;
  const secondsPerMeter =
    totalDurationSeconds && totalRouteDistanceMeters > 0
      ? totalDurationSeconds / totalRouteDistanceMeters
      : null;
  const steps = [];
  let stepStartIndex = 0;
  let lastTurnIndex = -1;

  for (let index = 1; index < coordinates.length - 1; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    const next = coordinates[index + 1];
    const inboundMeters = calculateNavigationDistanceMeters(previous, current);
    const outboundMeters = calculateNavigationDistanceMeters(current, next);

    if (inboundMeters < 18 || outboundMeters < 18) {
      continue;
    }

    const inboundBearing = calculateNavigationBearingDegrees(previous, current);
    const outboundBearing = calculateNavigationBearingDegrees(current, next);
    const delta = normalizeSignedBearingDeltaDegrees(inboundBearing, outboundBearing);
    const absoluteDelta = Math.abs(Number(delta));

    if (!Number.isFinite(absoluteDelta) || absoluteDelta < 42 || absoluteDelta > 165) {
      continue;
    }

    const metersSinceLastTurn =
      lastTurnIndex >= 0
        ? calculateRouteDistanceBetweenIndexes(coordinates, lastTurnIndex, index)
        : Number.POSITIVE_INFINITY;
    if (metersSinceLastTurn < 80) {
      continue;
    }

    const stepDistanceMeters = calculateRouteDistanceBetweenIndexes(
      coordinates,
      stepStartIndex,
      index,
    );
    if (stepDistanceMeters < 30) {
      continue;
    }

    const durationSeconds = secondsPerMeter
      ? Math.max(1, Math.round(stepDistanceMeters * secondsPerMeter))
      : 0;

    steps.push({
      instruction: delta > 0 ? 'Vire à direita' : 'Vire à esquerda',
      startLocation: coordinates[stepStartIndex],
      endLocation: current,
      maneuverLocation: current,
      distanceMeters: Math.round(stepDistanceMeters),
      durationSeconds,
      polylinePoints: null,
      synthetic: true,
    });

    stepStartIndex = index;
    lastTurnIndex = index;
  }

  const finalDistanceMeters = calculateRouteDistanceBetweenIndexes(
    coordinates,
    stepStartIndex,
    coordinates.length - 1,
  );
  if (finalDistanceMeters > 10 || steps.length === 0) {
    steps.push({
      instruction: steps.length === 0 ? `Siga até ${targetLabel}` : `Siga em frente até ${targetLabel}`,
      startLocation: coordinates[stepStartIndex],
      endLocation: coordinates[coordinates.length - 1],
      distanceMeters: Math.round(finalDistanceMeters),
      durationSeconds: secondsPerMeter
        ? Math.max(1, Math.round(finalDistanceMeters * secondsPerMeter))
        : 0,
      polylinePoints: null,
      synthetic: true,
    });
  }

  return steps;
}

function findRouteCoordinateAhead(currentCoordinate, routeCoordinates = [], lookAheadMeters = CAMERA_LOOK_AHEAD_METERS) {
  const current = normalizeNavigationCoordinate(currentCoordinate);
  const coordinates = Array.isArray(routeCoordinates)
    ? routeCoordinates.map(normalizeNavigationCoordinate).filter(Boolean)
    : [];

  if (!current || coordinates.length < 2) {
    return null;
  }

  const nearestIndex = findNearestRouteIndex(current, coordinates);
  if (nearestIndex < 0) {
    return null;
  }

  let cursor = current;
  let remainingLookAhead = Math.max(12, Number(lookAheadMeters) || CAMERA_LOOK_AHEAD_METERS);
  for (let index = Math.max(0, nearestIndex); index < coordinates.length; index += 1) {
    const nextCoordinate = coordinates[index + 1];
    if (!nextCoordinate) {
      break;
    }

    const segmentMeters = calculateNavigationDistanceMeters(cursor, nextCoordinate);
    if (Number.isFinite(segmentMeters) && segmentMeters >= remainingLookAhead) {
      return interpolateNavigationCoordinate(
        cursor,
        nextCoordinate,
        remainingLookAhead / segmentMeters,
      );
    }

    remainingLookAhead -= Number.isFinite(segmentMeters) ? segmentMeters : 0;
    cursor = nextCoordinate;
  }

  return coordinates[coordinates.length - 1] || null;
}

function buildRouteGeometryCoordinates(routeCoordinates = [], steps = []) {
  const normalizedRouteCoordinates = Array.isArray(routeCoordinates)
    ? routeCoordinates.map(normalizeNavigationCoordinate).filter(Boolean)
    : [];

  if (normalizedRouteCoordinates.length >= 2) {
    return normalizedRouteCoordinates;
  }

  const normalizedSteps = normalizeNavigationSteps(steps);
  const geometry = [];
  normalizedSteps.forEach((step) => {
    if (geometry.length === 0) {
      geometry.push(step.startLocation);
    }
    geometry.push(step.endLocation);
  });

  return geometry;
}

function normalizeInstructionForManeuver(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isCurveInstruction(instruction) {
  const normalized = normalizeInstructionForManeuver(instruction);
  return (
    normalized.includes('direita') ||
    normalized.includes('esquerda') ||
    normalized.includes('retorno') ||
    normalized.includes('meia volta') ||
    normalized.includes('meia-volta') ||
    normalized.includes('rotatoria') ||
    normalized.includes('rotunda')
  );
}

function isTurningStep(step) {
  return isCurveInstruction(step.instruction) || Boolean(
    step.maneuver && !['DEPART', 'STRAIGHT', 'MANEUVER_UNSPECIFIED'].includes(step.maneuver),
  );
}

function resolveUpcomingNavigationTarget({
  current,
  target,
  routeGeometryCoordinates,
  normalizedSteps,
  currentStepIndex,
  remainingMeters,
  fallbackInstruction,
}) {
  const safeCurrentStepIndex = Math.max(0, Number(currentStepIndex) || 0);
  const currentStep =
    currentStepIndex >= 0 ? normalizedSteps[currentStepIndex] : null;
  // Current position and candidate turns share this geometry. Rebuilding all
  // segments for each turn multiplied route normalization/trigonometry work.
  const routeMeasure = buildRouteMeasureSegments(routeGeometryCoordinates);
  const currentMeasure = projectCoordinateToRouteMeasure(current, routeGeometryCoordinates, routeMeasure);
  const routeCursorMeters = Number(currentMeasure?.routeMeters);
  const candidateCurveSteps = normalizedSteps
    .slice(safeCurrentStepIndex)
    .filter(isTurningStep);
  const upcomingCurveStep = candidateCurveSteps.find((step) => {
    const coordinate =
      step?.maneuverLocation ||
      step?.startLocation ||
      step?.endLocation;
    const targetMeasure = projectCoordinateToRouteMeasure(coordinate, routeGeometryCoordinates, routeMeasure);

    if (!Number.isFinite(routeCursorMeters) || !Number.isFinite(targetMeasure?.routeMeters)) {
      return true;
    }

    return targetMeasure.routeMeters > routeCursorMeters + DEFAULT_ADVANCE_THRESHOLD_METERS;
  });
  const upcomingCurveCoordinate =
    upcomingCurveStep?.maneuverLocation ||
    upcomingCurveStep?.startLocation ||
    upcomingCurveStep?.endLocation;

  if (upcomingCurveCoordinate) {
    const fallbackCurveMeters = calculateNavigationDistanceMeters(
      current,
      upcomingCurveCoordinate,
    );
    return {
      instruction: upcomingCurveStep.instruction,
      maneuver: upcomingCurveStep.maneuver || null,
      distanceTargetKind: 'curve',
      distanceTargetLabel: 'a próxima curva',
      distanceTargetCoordinate: upcomingCurveCoordinate,
      distanceMeters: calculateRouteDistanceToCoordinateMeters(
        current,
        routeGeometryCoordinates,
        upcomingCurveCoordinate,
        fallbackCurveMeters,
      ),
    };
  }

  return {
    instruction:
      currentStep && !isTurningStep(currentStep)
        ? currentStep.instruction
        : fallbackInstruction,
    distanceTargetKind: 'destination',
    distanceTargetLabel: 'o destino',
    distanceTargetCoordinate: target,
    distanceMeters: Number.isFinite(Number(remainingMeters))
      ? Math.max(0, Number(remainingMeters))
      : calculateNavigationDistanceMeters(current, target),
  };
}

export function resolveCurrentNavigationStepIndex({
  currentCoordinate,
  steps = [],
  advanceThresholdMeters = DEFAULT_ADVANCE_THRESHOLD_METERS,
} = {}) {
  const current = normalizeNavigationCoordinate(currentCoordinate);
  const normalizedSteps = normalizeNavigationSteps(steps);

  if (!current || normalizedSteps.length === 0) {
    return -1;
  }

  let nearestIndex = 0;
  let nearestDistance = Number.POSITIVE_INFINITY;

  normalizedSteps.forEach((step, index) => {
    const distance = distancePointToSegmentMeters(current, step.startLocation, step.endLocation);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
    }
  });

  const distanceToStepEnd = calculateNavigationDistanceMeters(
    current,
    normalizedSteps[nearestIndex]?.endLocation,
  );

  if (
    distanceToStepEnd <= advanceThresholdMeters &&
    nearestIndex < normalizedSteps.length - 1
  ) {
    return nearestIndex + 1;
  }

  return nearestIndex;
}

export function buildLeafNativeNavigationState({
  bookingId = '',
  phase = 'pickup',
  status = '',
  currentCoordinate = null,
  targetCoordinate = null,
  routeCoordinates = [],
  steps = [],
  remainingDistanceMeters = null,
  totalDistanceMeters = null,
  totalDurationMinutes = null,
  currentSpeedKmh = null,
  currentSpeedMetersPerSecond = null,
  offRouteThresholdMeters = DEFAULT_OFF_ROUTE_THRESHOLD_METERS,
  allowSyntheticSteps = false,
} = {}) {
  const normalizedStatus = String(status || '').trim().toLowerCase();
  const normalizedPhase = phase === 'destination' ? 'destination' : 'pickup';
  const current = normalizeNavigationCoordinate(currentCoordinate);
  const target = normalizeNavigationCoordinate(targetCoordinate);

  if (!['accepted', 'started'].includes(normalizedStatus) || !current || !target) {
    return null;
  }

  // Old cached plans may contain inferred turns. Visual guidance uses provider
  // steps only; missing steps must never trigger a new directions request.
  let normalizedSteps = normalizeNavigationSteps(steps).filter((step) => (
    allowSyntheticSteps || !step.synthetic
  ));
  const routeGeometryCoordinates = buildRouteGeometryCoordinates(
    routeCoordinates,
    normalizedSteps,
  );
  if (allowSyntheticSteps && normalizedSteps.length === 0 && routeGeometryCoordinates.length >= 2) {
    normalizedSteps = buildSyntheticNavigationStepsFromRoute(
      routeGeometryCoordinates,
      totalDurationMinutes,
      normalizedPhase,
    );
  }
  const currentStepIndex = resolveCurrentNavigationStepIndex({
    currentCoordinate: current,
    steps: normalizedSteps,
  });
  const currentStep = currentStepIndex >= 0 ? normalizedSteps[currentStepIndex] : null;
  const fallbackInstruction =
    normalizedPhase === 'destination'
      ? 'Siga até o destino'
      : 'Siga até o embarque';
  const routeRemainingMeters = calculateRemainingRouteMeters(
    current,
    routeGeometryCoordinates,
    remainingDistanceMeters,
  );
  const fallbackRemainingMeters = Number.isFinite(Number(remainingDistanceMeters))
    ? Math.max(0, Number(remainingDistanceMeters))
    : calculateNavigationDistanceMeters(current, target);
  // The caller's value is the one the ride card shows (near the pickup it is
  // the straight-line distance). Never show a longer one in the banner: it
  // said "30 m" while the card under it said "10 m".
  const remainingMeters = Number.isFinite(Number(routeRemainingMeters))
    ? Math.max(
        0,
        Number(remainingDistanceMeters) > 0
          ? Math.min(Number(routeRemainingMeters), Number(remainingDistanceMeters))
          : Number(routeRemainingMeters),
      )
    : fallbackRemainingMeters;
  const upcomingTarget = resolveUpcomingNavigationTarget({
    current,
    target,
    routeGeometryCoordinates,
    normalizedSteps,
    currentStepIndex,
    remainingMeters,
    fallbackInstruction,
  });
  const maneuverDistanceMeters = Number.isFinite(Number(upcomingTarget.distanceMeters))
    ? Math.max(0, Number(upcomingTarget.distanceMeters))
    : calculateNavigationDistanceMeters(current, target);
  const lookAheadCoordinate =
    findRouteCoordinateAhead(current, routeGeometryCoordinates) || target;
  const cameraHeadingDegrees = calculateNavigationBearingDegrees(
    current,
    lookAheadCoordinate,
  );
  const normalizedSpeedKmh = normalizeNavigationSpeedKmh({
    speedKmh: currentSpeedKmh,
    speedMetersPerSecond: currentSpeedMetersPerSecond,
    coordinate: currentCoordinate,
  });
  const baselineMeters = Number.isFinite(Number(totalDistanceMeters)) && Number(totalDistanceMeters) > 0
    ? Number(totalDistanceMeters)
    : null;
  const baselineDurationMinutes =
    Number.isFinite(Number(totalDurationMinutes)) && Number(totalDurationMinutes) > 0
      ? Number(totalDurationMinutes)
      : null;
  const remainingDurationMinutes =
    baselineMeters && baselineDurationMinutes && Number.isFinite(remainingMeters)
      ? Math.max(1, Math.ceil((remainingMeters / baselineMeters) * baselineDurationMinutes))
      : null;
  const distanceToRouteMeters = calculateDistanceToRouteMeters(
    current,
    routeGeometryCoordinates,
  );
  const isOffRoute =
    Number.isFinite(distanceToRouteMeters) &&
    distanceToRouteMeters > offRouteThresholdMeters;

  // Off the route the projected remaining distance can read zero: not an arrival.
  const arrivalBannerMeters = normalizedPhase === 'pickup'
    ? PICKUP_ARRIVAL_METERS : DESTINATION_ARRIVAL_BANNER_METERS;
  const arrivalDistanceMeters = normalizedPhase === 'pickup'
    ? calculateNavigationDistanceMeters(current, target) : remainingMeters;
  const hasArrived =
    !isOffRoute && Number.isFinite(arrivalDistanceMeters) && arrivalDistanceMeters <= arrivalBannerMeters;
  const arrivalInstruction = normalizedPhase === 'destination'
    ? 'Você chegou ao destino'
    : 'Você chegou ao embarque';
  const arrivalHint = normalizedPhase === 'destination'
    ? 'Deslize para encerrar a corrida'
    : 'Toque em Cheguei ao embarque';

  return {
    isVisible: true,
    hasArrived,
    arrivalHint: hasArrived ? arrivalHint : '',
    navigationKey: [
      String(bookingId || 'current'),
      normalizedPhase,
      normalizedStatus,
    ].join(':'),
    phase: normalizedPhase,
    status: normalizedStatus,
    currentCoordinate: current,
    targetCoordinate: target,
    routeCoordinates: routeGeometryCoordinates,
    currentStepIndex,
    currentInstruction: hasArrived ? arrivalInstruction : upcomingTarget.instruction,
    maneuver: hasArrived || isOffRoute ? null : upcomingTarget.maneuver || null,
    maneuverDistanceMeters,
    maneuverDistanceLabel: formatDistanceLabel(maneuverDistanceMeters),
    maneuverDistanceTargetKind: upcomingTarget.distanceTargetKind,
    maneuverDistanceTargetLabel:
      upcomingTarget.distanceTargetKind === 'destination' && normalizedPhase === 'pickup'
        ? 'o embarque'
        : upcomingTarget.distanceTargetLabel,
    remainingDistanceMeters: remainingMeters,
    totalDistanceMeters: baselineMeters,
    remainingDistanceLabel: formatDistanceLabel(remainingMeters),
    remainingDurationMinutes,
    etaLabel: hasArrived ? '' : formatEtaLabel(remainingDurationMinutes),
    cameraHeadingDegrees,
    cameraZoom: hasArrived && normalizedPhase === 'destination'
      ? NAVIGATION_CAMERA_ARRIVAL_ZOOM
      : resolveNavigationCameraZoom(normalizedSpeedKmh),
    cameraPitch: resolveNavigationCameraPitch(),
    cameraAnchorY: NAVIGATION_CAMERA_ANCHOR_Y,
    cameraAnimationDurationMs: NAVIGATION_CAMERA_ANIMATION_MS,
    currentSpeedKmh: normalizedSpeedKmh,
    isOffRoute,
    distanceToRouteMeters,
    offRouteThresholdMeters,
    offRouteMessage: 'Fora da rota. Volte para o traçado no mapa ou abra uma navegação externa.',
    hasSteps: normalizedSteps.length > 0,
  };
}

export default {
  buildLeafNativeNavigationState,
  calculateNavigationBearingDegrees,
  calculateDistanceToRouteMeters,
  calculateNavigationDistanceMeters,
  resolveNavigationCameraPitch,
  resolveNavigationCameraZoom,
  shouldRevealNavigationRoute,
  normalizeNavigationCoordinate,
  normalizeNavigationSteps,
  resolveCurrentNavigationStepIndex,
};
