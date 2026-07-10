const DEFAULT_MIN_VISIBLE_HEIGHT = 180;
const DEFAULT_MIN_ROUTE_AREA_HEIGHT = 140;
const DEFAULT_SHORT_ROUTE_MAX_DISTANCE_KM = 1.8;
const DEFAULT_SHORT_ROUTE_MIN_LAT_DELTA = 0.014;
const DEFAULT_ROUTE_MIN_LAT_DELTA = 0.028;
const DEFAULT_OVERLAY_SHEET_MAX_RATIO = 0.66;
const DEFAULT_OVERLAY_SHEET_MIN_HEIGHT = 236;

export function buildOverlaySheetViewportMetrics({
  windowHeight,
  topOcclusion = 0,
  bottomOffset = 0,
  measuredHeight,
  fallbackHeight = DEFAULT_OVERLAY_SHEET_MIN_HEIGHT,
  minVisibleMapHeight = DEFAULT_MIN_VISIBLE_HEIGHT,
  minSheetHeight = DEFAULT_OVERLAY_SHEET_MIN_HEIGHT,
  maxSheetRatio = DEFAULT_OVERLAY_SHEET_MAX_RATIO,
} = {}) {
  const effectiveWindowHeight = Math.max(1, Number(windowHeight) || 1);
  const safeTopOcclusion = Math.max(0, Number(topOcclusion) || 0);
  const safeBottomOffset = Math.max(0, Number(bottomOffset) || 0);
  const safeMinVisibleMapHeight = Math.max(
    1,
    Number(minVisibleMapHeight) || DEFAULT_MIN_VISIBLE_HEIGHT,
  );
  const safeMinSheetHeight = Math.max(1, Number(minSheetHeight) || 1);
  const safeFallbackHeight = Math.max(
    1,
    Number(fallbackHeight) || safeMinSheetHeight,
  );
  const ratioCap = Math.max(
    1,
    Math.floor(
      effectiveWindowHeight *
        Math.max(0.1, Number(maxSheetRatio) || DEFAULT_OVERLAY_SHEET_MAX_RATIO),
    ),
  );
  const visibleMapCap = Math.max(
    1,
    Math.floor(
      effectiveWindowHeight -
        safeTopOcclusion -
        safeBottomOffset -
        safeMinVisibleMapHeight,
    ),
  );
  const maxSheetHeight = Math.max(
    1,
    Math.min(ratioCap, Math.max(safeMinSheetHeight, visibleMapCap)),
  );
  const normalizedMeasuredHeight = Math.max(
    1,
    Number(measuredHeight) || safeFallbackHeight,
  );
  const effectiveSheetHeight = Math.min(normalizedMeasuredHeight, maxSheetHeight);

  return {
    maxSheetHeight,
    effectiveSheetHeight,
    occludedBottom: safeBottomOffset + effectiveSheetHeight,
    visibleMapHeight: Math.max(
      1,
      effectiveWindowHeight -
        safeTopOcclusion -
        safeBottomOffset -
        effectiveSheetHeight,
    ),
  };
}

export function isFiniteRouteCoordinate(candidate) {
  return (
    Number.isFinite(candidate?.latitude) &&
    Number.isFinite(candidate?.longitude)
  );
}

export function distanceBetweenCoordinatesKm(origin, destination) {
  if (!isFiniteRouteCoordinate(origin) || !isFiniteRouteCoordinate(destination)) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusKm = 6371;
  const originLat = (origin.latitude * Math.PI) / 180;
  const destinationLat = (destination.latitude * Math.PI) / 180;
  const latDelta = ((destination.latitude - origin.latitude) * Math.PI) / 180;
  const lonDelta = ((destination.longitude - origin.longitude) * Math.PI) / 180;
  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(originLat) *
      Math.cos(destinationLat) *
      Math.sin(lonDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
}

function normalizeVisibleInsets({
  mapWidth,
  mapHeight,
  activeOcclusion,
  insets,
  viewportPadding,
}) {
  const effectiveHeight = Math.max(1, Number(mapHeight) || 1);
  const effectiveWidth = Math.max(1, Number(mapWidth) || effectiveHeight * 0.5);
  const maxTop = Math.max(0, effectiveHeight - 1);
  const topInset = Math.min(
    Math.max(
      Number(insets?.top) || 0,
      Number(activeOcclusion?.top) || 0,
      Number(viewportPadding?.top) || 0,
    ),
    maxTop,
  );
  const maxBottom = Math.max(0, effectiveHeight - topInset - 1);
  const bottomInset = Math.min(
    Math.max(
      Number(insets?.bottom) || 0,
      Number(activeOcclusion?.bottom) || 0,
      Number(viewportPadding?.bottom) || 0,
    ),
    maxBottom,
  );
  const leftInset = Math.min(
    Math.max(
      Number(insets?.left) || 0,
      Number(activeOcclusion?.left) || 0,
      Number(viewportPadding?.left) || 0,
    ),
    Math.max(0, effectiveWidth - 1),
  );
  const rightInset = Math.min(
    Math.max(
      Number(insets?.right) || 0,
      Number(activeOcclusion?.right) || 0,
      Number(viewportPadding?.right) || 0,
    ),
    Math.max(0, effectiveWidth - leftInset - 1),
  );
  const availableHeight = Math.max(
    1,
    effectiveHeight - topInset - bottomInset,
  );
  const availableWidth = Math.max(1, effectiveWidth - leftInset - rightInset);

  return {
    effectiveWidth,
    effectiveHeight,
    topInset,
    bottomInset,
    leftInset,
    rightInset,
    availableHeight,
    availableWidth,
  };
}

export function buildVisibleRouteViewportFrame({
  mapWidth,
  mapHeight,
  activeOcclusion,
  insets,
  viewportPadding,
} = {}) {
  const {
    effectiveWidth,
    effectiveHeight,
    topInset,
    bottomInset,
    leftInset,
    rightInset,
    availableHeight,
    availableWidth,
  } = normalizeVisibleInsets({
    mapWidth,
    mapHeight,
    activeOcclusion,
    insets,
    viewportPadding,
  });

  return {
    mapWidth: effectiveWidth,
    mapHeight: effectiveHeight,
    top: topInset,
    left: leftInset,
    right: effectiveWidth - rightInset,
    bottom: effectiveHeight - bottomInset,
    width: availableWidth,
    height: availableHeight,
    insets: {
      top: topInset,
      right: rightInset,
      bottom: bottomInset,
      left: leftInset,
    },
  };
}

function sumRouteDistanceKm(points) {
  return points.reduce((total, point, index) => {
    if (index === 0) {
      return 0;
    }

    const segmentDistanceKm = distanceBetweenCoordinatesKm(points[index - 1], point);
    return total + (Number.isFinite(segmentDistanceKm) ? segmentDistanceKm : 0);
  }, 0);
}

function buildVisibleRouteRegion({
  coordinates,
  mapWidth,
  mapHeight,
  activeOcclusion,
  insets,
  viewportPadding,
  minVisibleHeight,
  minLatitudeDelta,
  latitudeDeltaMultiplier,
  longitudeDeltaMultiplier,
}) {
  const points = Array.isArray(coordinates)
    ? coordinates.filter(isFiniteRouteCoordinate)
    : [];

  if (points.length < 2) {
    return null;
  }

  const latitudes = points.map(point => point.latitude);
  const longitudes = points.map(point => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const centerLatitude = (minLatitude + maxLatitude) / 2;
  const centerLongitude = (minLongitude + maxLongitude) / 2;
  const latitudeCosine = Math.max(Math.cos((centerLatitude * Math.PI) / 180), 0.28);
  const safeMinLatitudeDelta = Math.max(
    0.001,
    Number(minLatitudeDelta) || DEFAULT_SHORT_ROUTE_MIN_LAT_DELTA,
  );
  const {
    effectiveWidth,
    effectiveHeight,
    topInset,
    leftInset,
    availableHeight,
    availableWidth,
  } = normalizeVisibleInsets({
    mapWidth,
    mapHeight,
    activeOcclusion,
    insets,
    viewportPadding,
    minVisibleHeight,
  });
  // A camera region is measured against the full map while the route must fit
  // inside the exposed area above overlays. Expand its span by that ratio first.
  const verticalFitScale = effectiveHeight / availableHeight;
  const horizontalFitScale = effectiveWidth / availableWidth;
  const latitudeDelta = Math.max(
    safeMinLatitudeDelta,
    (maxLatitude - minLatitude) * latitudeDeltaMultiplier,
  ) * verticalFitScale;
  const longitudeDelta = Math.max(
    (maxLongitude - minLongitude) * longitudeDeltaMultiplier * horizontalFitScale,
    (latitudeDelta * effectiveWidth) / (effectiveHeight * latitudeCosine),
  );
  const desiredRouteCenterY = topInset + availableHeight / 2;
  const baseCenterY = effectiveHeight / 2;
  const latitudeOffset = (latitudeDelta * (desiredRouteCenterY - baseCenterY)) / effectiveHeight;
  const desiredRouteCenterX = leftInset + availableWidth / 2;
  const baseCenterX = effectiveWidth / 2;
  const longitudeOffset = (longitudeDelta * (baseCenterX - desiredRouteCenterX)) / effectiveWidth;

  return {
    latitude: centerLatitude + latitudeOffset,
    longitude: centerLongitude + longitudeOffset,
    latitudeDelta,
    longitudeDelta,
  };
}

export function buildShortRouteViewportRegion({
  coordinates,
  mapWidth,
  mapHeight,
  activeOcclusion,
  insets,
  viewportPadding,
  maxDistanceKm = DEFAULT_SHORT_ROUTE_MAX_DISTANCE_KM,
  minLatitudeDelta = DEFAULT_SHORT_ROUTE_MIN_LAT_DELTA,
  minVisibleHeight = DEFAULT_MIN_VISIBLE_HEIGHT,
} = {}) {
  const points = Array.isArray(coordinates)
    ? coordinates.filter(isFiniteRouteCoordinate)
    : [];

  if (points.length < 2) {
    return null;
  }

  const routeDistanceKm = sumRouteDistanceKm(points);
  if (routeDistanceKm > maxDistanceKm) {
    return null;
  }

  return buildVisibleRouteRegion({
    coordinates: points,
    mapWidth,
    mapHeight,
    activeOcclusion,
    insets,
    viewportPadding,
    minVisibleHeight,
    minLatitudeDelta,
    latitudeDeltaMultiplier: 3.1,
    longitudeDeltaMultiplier: 3.25,
  });
}

export function buildRouteViewportRegion({
  coordinates,
  mapWidth,
  mapHeight,
  activeOcclusion,
  insets,
  viewportPadding,
  shortRouteMaxDistanceKm = DEFAULT_SHORT_ROUTE_MAX_DISTANCE_KM,
  shortRouteMinLatitudeDelta = DEFAULT_SHORT_ROUTE_MIN_LAT_DELTA,
  minLatitudeDelta = DEFAULT_ROUTE_MIN_LAT_DELTA,
  minVisibleHeight = DEFAULT_MIN_VISIBLE_HEIGHT,
  shortRouteLatitudeDeltaMultiplier = 3.1,
  shortRouteLongitudeDeltaMultiplier = 3.25,
  longRouteLatitudeDeltaMultiplier = 2.08,
  longRouteLongitudeDeltaMultiplier = 2.18,
} = {}) {
  const points = Array.isArray(coordinates)
    ? coordinates.filter(isFiniteRouteCoordinate)
    : [];

  if (points.length < 2) {
    return null;
  }

  const routeDistanceKm = sumRouteDistanceKm(points);
  if (routeDistanceKm <= shortRouteMaxDistanceKm) {
    return buildVisibleRouteRegion({
      coordinates: points,
      mapWidth,
      mapHeight,
      activeOcclusion,
      insets,
      viewportPadding,
      minVisibleHeight,
      minLatitudeDelta: shortRouteMinLatitudeDelta,
      latitudeDeltaMultiplier: shortRouteLatitudeDeltaMultiplier,
      longitudeDeltaMultiplier: shortRouteLongitudeDeltaMultiplier,
    });
  }

  return buildVisibleRouteRegion({
    coordinates: points,
    mapWidth,
    mapHeight,
    activeOcclusion,
    insets,
    viewportPadding,
    minVisibleHeight,
    minLatitudeDelta,
    latitudeDeltaMultiplier: longRouteLatitudeDeltaMultiplier,
    longitudeDeltaMultiplier: longRouteLongitudeDeltaMultiplier,
  });
}

export function buildVisibleRouteEdgePadding({
  mapHeight,
  activeOcclusion,
  insets,
  sidePadding = 72,
  topExtraPadding = 22,
  bottomExtraPadding = 28,
  minVisibleHeight = DEFAULT_MIN_VISIBLE_HEIGHT,
  minRouteAreaHeight = DEFAULT_MIN_ROUTE_AREA_HEIGHT,
  overlayBiasRatio = 0.28,
  topPaddingMin = 0,
} = {}) {
  const effectiveHeight = Math.max(1, Number(mapHeight) || 1);
  const topInset = Math.max(Number(insets?.top) || 0, Number(activeOcclusion?.top) || 0);
  const bottomInset = Math.max(Number(insets?.bottom) || 0, Number(activeOcclusion?.bottom) || 0);
  const routeAreaTop = Math.max(topInset + 12, 12);
  const routeAreaBottom = Math.max(
    routeAreaTop + minRouteAreaHeight,
    effectiveHeight - Math.max((Number(insets?.bottom) || 0) + 12, bottomInset),
  );
  const routeAreaHeight = Math.max(minRouteAreaHeight, routeAreaBottom - routeAreaTop);
  const computedTop = Math.round(routeAreaTop + routeAreaHeight * 0.08) + topExtraPadding;
  const safeMinVisibleHeight = Math.max(1, Number(minVisibleHeight) || DEFAULT_MIN_VISIBLE_HEIGHT);
  const topPaddingTarget = Math.min(
    Math.max(topPaddingMin, computedTop),
    Math.max(0, effectiveHeight - safeMinVisibleHeight),
  );
  const baseBottomPadding = Math.max((Number(insets?.bottom) || 0) + 12, effectiveHeight - routeAreaBottom + 12);
  const upperAreaBias = Math.round(routeAreaHeight * overlayBiasRatio);
  const maxBottomPaddingWithIdealVisibleHeight = Math.max(
    0,
    effectiveHeight - topPaddingTarget - safeMinVisibleHeight,
  );
  const idealBottomPadding = Math.min(
    maxBottomPaddingWithIdealVisibleHeight,
    baseBottomPadding + upperAreaBias + bottomExtraPadding,
  );
  const bottomPaddingTarget = Math.max(bottomInset, idealBottomPadding);
  const bottomPadding = Math.min(
    bottomPaddingTarget,
    Math.max(0, effectiveHeight - 1),
  );
  const topPadding = Math.min(
    topPaddingTarget,
    Math.max(0, effectiveHeight - bottomPadding - 1),
  );

  return {
    top: topPadding,
    right: sidePadding,
    left: sidePadding,
    bottom: bottomPadding,
  };
}
