import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import mapStyleAppleLike from './mapStyleAppleLike';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { color, motion } = robotaxiPrototypeTokens;
const ROUTE_ANIMATION_DURATION = Math.min(Number(motion.timing.map) || 840, 840);
const POINTS_PER_SEGMENT = 26;
const DRIVER_MARKER_SMOOTH_MS = 850;
const DRIVER_MARKER_HEADING_SMOOTH_MS = 520;
const DRIVER_MARKER_SMOOTH_SNAP_METERS = 3000;
const DRIVER_MARKER_MIN_HEADING_DISTANCE_METERS = 0.85;
const DRIVER_ROUTE_SNAP_MAX_METERS = 42;
const DRIVER_DEAD_RECKONING_MAX_MS = 4200;
const DRIVER_DEAD_RECKONING_DEFAULT_SPEED_MPS = 8;
const DRIVER_DEAD_RECKONING_MAX_SPEED_MPS = 18;
const DRIVER_DEAD_RECKONING_FRAME_MS = 42;
const EARTH_RADIUS_METERS = 6371000;
const USER_RADAR_DURATION_MS = 2200;
const NEARBY_VEHICLE_REVEAL_DELAY_MS = 15000;
const NEARBY_VEHICLE_DOTS_DURATION_MS = 1700;
const NEARBY_VEHICLE_USER_CLEARANCE_PX = 94;
const NEARBY_VEHICLE_CLUSTER_CLEARANCE_PX = 58;
const IS_TEST_ENV = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
const DRIVER_MARKER_IMAGE_SOURCES = Object.freeze({
  black: require('../../assets/map/leaf-map-car-marker-black.png'),
  white: require('../../assets/map/leaf-map-car-marker-white.png'),
  silver: require('../../assets/map/leaf-map-car-marker-silver.png'),
  gray: require('../../assets/map/leaf-map-car-marker-gray.png'),
  red: require('../../assets/map/leaf-map-car-marker-red.png'),
  blue: require('../../assets/map/leaf-map-car-marker-blue.png'),
  green: require('../../assets/map/leaf-map-car-marker-green.png'),
  yellow: require('../../assets/map/leaf-map-car-marker-yellow.png'),
});
const DIRECTIONAL_DRIVER_MARKER_IMAGE_SOURCE = DRIVER_MARKER_IMAGE_SOURCES.black;

function resolveAvatarInitial(value) {
  return String(value || 'L').trim().charAt(0).toUpperCase() || 'L';
}

function resolveProjectedOverlayPointWithinSafeZones(point, width, height) {
  if (!point || !Number.isFinite(width) || !Number.isFinite(height)) {
    return point;
  }

  const nextPoint = { ...point };
  const topSafeMaxY = 124;
  const sideSafeX = 88;
  const minX = 28;
  const maxX = width - 28;
  const minY = 28;
  const maxY = Math.max(56, height - 320);

  if (nextPoint.y <= topSafeMaxY && nextPoint.x <= sideSafeX) {
    nextPoint.x = sideSafeX;
    nextPoint.y = Math.max(topSafeMaxY + 8, nextPoint.y);
  } else if (nextPoint.y <= topSafeMaxY && nextPoint.x >= width - sideSafeX) {
    nextPoint.x = width - sideSafeX;
    nextPoint.y = Math.max(topSafeMaxY + 8, nextPoint.y);
  }

  nextPoint.x = Math.min(Math.max(nextPoint.x, minX), maxX);
  nextPoint.y = Math.min(Math.max(nextPoint.y, minY), maxY);
  return nextPoint;
}

function densifyPath(path = [], pointsPerSegment = POINTS_PER_SEGMENT) {
  if (!Array.isArray(path) || path.length < 2) {
    return [];
  }

  const result = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const start = path[index];
    const end = path[index + 1];
    if (index === 0) {
      result.push(start);
    }

    for (let step = 1; step <= pointsPerSegment; step += 1) {
      const ratio = step / pointsPerSegment;
      result.push({
        latitude: start.latitude + (end.latitude - start.latitude) * ratio,
        longitude: start.longitude + (end.longitude - start.longitude) * ratio
      });
    }
  }

  return result;
}

function normalizeMapCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function resolveVehicleColorToken(value) {
  const normalized = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();

  if (!normalized) {
    return null;
  }

  if (/^#?[0-9a-f]{6}$/i.test(normalized)) {
    const hex = normalized.replace('#', '');
    const red = parseInt(hex.slice(0, 2), 16) / 255;
    const green = parseInt(hex.slice(2, 4), 16) / 255;
    const blue = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;
    const chroma = max - min;

    if (chroma < 0.08) {
      if (lightness > 0.82) {
        return 'white';
      }
      if (lightness > 0.56) {
        return 'silver';
      }
      if (lightness > 0.28) {
        return 'gray';
      }
      return 'black';
    }

    let hue = 0;
    if (max === red) {
      hue = ((green - blue) / chroma) % 6;
    } else if (max === green) {
      hue = (blue - red) / chroma + 2;
    } else {
      hue = (red - green) / chroma + 4;
    }
    hue = (hue * 60 + 360) % 360;

    if (hue < 24 || hue >= 340) {
      return 'red';
    }
    if (hue >= 38 && hue < 70) {
      return 'yellow';
    }
    if (hue >= 70 && hue < 170) {
      return 'green';
    }
    if (hue >= 170 && hue < 260) {
      return 'blue';
    }
    return lightness > 0.42 ? 'gray' : 'black';
  }

  if (normalized.includes('branco') || normalized.includes('white')) {
    return 'white';
  }
  if (normalized.includes('prata') || normalized.includes('silver')) {
    return 'silver';
  }
  if (
    normalized.includes('cinza') ||
    normalized.includes('grafite') ||
    normalized.includes('gray') ||
    normalized.includes('grey')
  ) {
    return 'gray';
  }
  if (normalized.includes('vermelho') || normalized.includes('vinho') || normalized.includes('red')) {
    return 'red';
  }
  if (normalized.includes('azul') || normalized.includes('blue')) {
    return 'blue';
  }
  if (normalized.includes('verde') || normalized.includes('green')) {
    return 'green';
  }
  if (
    normalized.includes('amarelo') ||
    normalized.includes('dourado') ||
    normalized.includes('yellow') ||
    normalized.includes('gold')
  ) {
    return 'yellow';
  }
  if (normalized.includes('preto') || normalized.includes('black')) {
    return 'black';
  }

  return null;
}

function resolveVehicleMarkerImageSource(...values) {
  const token = values.map(resolveVehicleColorToken).find(Boolean) || 'black';
  return DRIVER_MARKER_IMAGE_SOURCES[token] || DIRECTIONAL_DRIVER_MARKER_IMAGE_SOURCE;
}

function resolveRemoteMarkerImageSource(value) {
  const uri = String(value || '').trim();
  return uri ? { uri } : null;
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function toDegrees(value) {
  return (Number(value) * 180) / Math.PI;
}

function calculateCoordinateDistanceMeters(left, right) {
  const start = normalizeMapCoordinate(left);
  const end = normalizeMapCoordinate(right);

  if (!start || !end) {
    return Number.POSITIVE_INFINITY;
  }

  const latitudeDelta = toRadians(end.latitude - start.latitude);
  const longitudeDelta = toRadians(end.longitude - start.longitude);
  const startLatitude = toRadians(start.latitude);
  const endLatitude = toRadians(end.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function projectCoordinateToMeters(origin, coordinate) {
  const normalizedOrigin = normalizeMapCoordinate(origin);
  const normalizedCoordinate = normalizeMapCoordinate(coordinate);

  if (!normalizedOrigin || !normalizedCoordinate) {
    return null;
  }

  const originLatitude = toRadians(normalizedOrigin.latitude);
  return {
    x:
      toRadians(normalizedCoordinate.longitude - normalizedOrigin.longitude) *
      EARTH_RADIUS_METERS *
      Math.cos(originLatitude),
    y:
      toRadians(normalizedCoordinate.latitude - normalizedOrigin.latitude) *
      EARTH_RADIUS_METERS,
  };
}

function projectMetersToCoordinate(origin, point) {
  const normalizedOrigin = normalizeMapCoordinate(origin);

  if (
    !normalizedOrigin ||
    !Number.isFinite(point?.x) ||
    !Number.isFinite(point?.y)
  ) {
    return null;
  }

  const originLatitude = toRadians(normalizedOrigin.latitude);
  const longitudeScale = Math.max(0.18, Math.cos(originLatitude));

  return {
    latitude: normalizedOrigin.latitude + toDegrees(point.y / EARTH_RADIUS_METERS),
    longitude:
      normalizedOrigin.longitude +
      toDegrees(point.x / (EARTH_RADIUS_METERS * longitudeScale)),
  };
}

function normalizeRoutePath(path = []) {
  return Array.isArray(path)
    ? path.map(normalizeMapCoordinate).filter(Boolean)
    : [];
}

function buildRouteMotionMetrics(path = []) {
  const coordinates = normalizeRoutePath(path);

  if (coordinates.length < 2) {
    return null;
  }

  const segments = [];
  let totalMeters = 0;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    const meters = calculateCoordinateDistanceMeters(start, end);

    if (!Number.isFinite(meters) || meters <= 0) {
      continue;
    }

    segments.push({
      start,
      end,
      startMeters: totalMeters,
      endMeters: totalMeters + meters,
      meters,
      heading: calculateHeadingDegrees(start, end),
    });
    totalMeters += meters;
  }

  if (segments.length === 0 || totalMeters <= 0) {
    return null;
  }

  return {
    coordinates,
    origin: coordinates[0],
    segments,
    totalMeters,
  };
}

function findNearestRouteProjection(coordinate, routeMetrics) {
  const current = normalizeMapCoordinate(coordinate);

  if (!current || !routeMetrics?.origin || !Array.isArray(routeMetrics.segments)) {
    return null;
  }

  const currentMeters = projectCoordinateToMeters(routeMetrics.origin, current);
  if (!currentMeters) {
    return null;
  }

  let nearestProjection = null;

  routeMetrics.segments.forEach((segment) => {
    const startMeters = projectCoordinateToMeters(routeMetrics.origin, segment.start);
    const endMeters = projectCoordinateToMeters(routeMetrics.origin, segment.end);

    if (!startMeters || !endMeters) {
      return;
    }

    const dx = endMeters.x - startMeters.x;
    const dy = endMeters.y - startMeters.y;
    const segmentLengthSquared = dx * dx + dy * dy;

    if (segmentLengthSquared <= 0) {
      return;
    }

    const ratio = Math.max(
      0,
      Math.min(
        1,
        ((currentMeters.x - startMeters.x) * dx + (currentMeters.y - startMeters.y) * dy) /
          segmentLengthSquared,
      ),
    );
    const projectedPoint = {
      x: startMeters.x + dx * ratio,
      y: startMeters.y + dy * ratio,
    };
    const deltaX = currentMeters.x - projectedPoint.x;
    const deltaY = currentMeters.y - projectedPoint.y;
    const snappedDistanceMeters = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const projectedCoordinate = projectMetersToCoordinate(routeMetrics.origin, projectedPoint);

    if (!projectedCoordinate) {
      return;
    }

    if (
      !nearestProjection ||
      snappedDistanceMeters < nearestProjection.snappedDistanceMeters
    ) {
      nearestProjection = {
        coordinate: projectedCoordinate,
        heading: segment.heading,
        routeMeters: segment.startMeters + segment.meters * ratio,
        snappedDistanceMeters,
      };
    }
  });

  return nearestProjection;
}

function resolveCoordinateAtRouteMeters(routeMetrics, routeMeters) {
  if (!routeMetrics?.segments?.length || !Number.isFinite(routeMeters)) {
    return null;
  }

  const safeRouteMeters = Math.max(0, Math.min(routeMetrics.totalMeters, routeMeters));
  const segment =
    routeMetrics.segments.find(item => (
      safeRouteMeters >= item.startMeters && safeRouteMeters <= item.endMeters
    )) ||
    routeMetrics.segments[routeMetrics.segments.length - 1];

  if (!segment) {
    return null;
  }

  const ratio =
    segment.meters > 0
      ? (safeRouteMeters - segment.startMeters) / segment.meters
      : 0;

  return {
    coordinate: interpolateCoordinate(segment.start, segment.end, ratio),
    heading: segment.heading,
    routeMeters: safeRouteMeters,
  };
}

function clampDriverSpeedMetersPerSecond(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return DRIVER_DEAD_RECKONING_DEFAULT_SPEED_MPS;
  }

  return Math.min(
    DRIVER_DEAD_RECKONING_MAX_SPEED_MPS,
    Math.max(1.4, numeric),
  );
}

function normalizeHeadingDegrees(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = numeric % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function calculateHeadingDegrees(startCoordinate, endCoordinate) {
  const start = normalizeMapCoordinate(startCoordinate);
  const end = normalizeMapCoordinate(endCoordinate);

  if (!start || !end) {
    return null;
  }

  const distanceMeters = calculateCoordinateDistanceMeters(start, end);
  if (!Number.isFinite(distanceMeters) || distanceMeters < DRIVER_MARKER_MIN_HEADING_DISTANCE_METERS) {
    return null;
  }

  const startLatitude = toRadians(start.latitude);
  const endLatitude = toRadians(end.latitude);
  const longitudeDelta = toRadians(end.longitude - start.longitude);
  const y = Math.sin(longitudeDelta) * Math.cos(endLatitude);
  const x =
    Math.cos(startLatitude) * Math.sin(endLatitude) -
    Math.sin(startLatitude) * Math.cos(endLatitude) * Math.cos(longitudeDelta);

  return normalizeHeadingDegrees(toDegrees(Math.atan2(y, x)));
}

function resolveShortestHeadingDeltaDegrees(fromHeading, toHeading) {
  const from = normalizeHeadingDegrees(fromHeading);
  const to = normalizeHeadingDegrees(toHeading);

  if (from === null || to === null) {
    return 0;
  }

  return ((to - from + 540) % 360) - 180;
}

function interpolateHeadingDegrees(startHeading, endHeading, ratio) {
  const start = normalizeHeadingDegrees(startHeading) ?? 0;
  const end = normalizeHeadingDegrees(endHeading) ?? start;
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  return normalizeHeadingDegrees(
    start + resolveShortestHeadingDeltaDegrees(start, end) * safeRatio,
  );
}

function interpolateCoordinate(start, end, ratio) {
  const safeRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
  return {
    latitude: start.latitude + (end.latitude - start.latitude) * safeRatio,
    longitude: start.longitude + (end.longitude - start.longitude) * safeRatio,
  };
}

function resolveDriverMarkerHeading({
  explicitHeading,
  startCoordinate,
  endCoordinate,
  fallbackHeading
}) {
  const normalizedExplicitHeading = normalizeHeadingDegrees(explicitHeading);
  if (normalizedExplicitHeading !== null) {
    return normalizedExplicitHeading;
  }

  const routeHeading = calculateHeadingDegrees(startCoordinate, endCoordinate);
  if (routeHeading !== null) {
    return routeHeading;
  }

  return normalizeHeadingDegrees(fallbackHeading) ?? 0;
}

function isValidMapRegion(candidate) {
  return (
    Number.isFinite(candidate?.latitude) &&
    Number.isFinite(candidate?.longitude) &&
    Number.isFinite(candidate?.latitudeDelta) &&
    Number.isFinite(candidate?.longitudeDelta) &&
    candidate.latitudeDelta > 0 &&
    candidate.longitudeDelta > 0
  );
}

function projectCoordinateToScreenPoint({
  coordinate,
  projectionRegion,
  width,
  height
}) {
  if (
    !Number.isFinite(coordinate?.latitude) ||
    !Number.isFinite(coordinate?.longitude) ||
    !Number.isFinite(projectionRegion?.latitude) ||
    !Number.isFinite(projectionRegion?.longitude) ||
    !Number.isFinite(projectionRegion?.latitudeDelta) ||
    !Number.isFinite(projectionRegion?.longitudeDelta) ||
    projectionRegion.latitudeDelta <= 0 ||
    projectionRegion.longitudeDelta <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const leftLongitude = projectionRegion.longitude - projectionRegion.longitudeDelta / 2;
  const topLatitude = projectionRegion.latitude + projectionRegion.latitudeDelta / 2;
  const x = ((coordinate.longitude - leftLongitude) / projectionRegion.longitudeDelta) * width;
  const y = ((topLatitude - coordinate.latitude) / projectionRegion.latitudeDelta) * height;

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

function projectScreenPointToCoordinate({
  point,
  projectionRegion,
  width,
  height
}) {
  if (
    !Number.isFinite(point?.x) ||
    !Number.isFinite(point?.y) ||
    !Number.isFinite(projectionRegion?.latitude) ||
    !Number.isFinite(projectionRegion?.longitude) ||
    !Number.isFinite(projectionRegion?.latitudeDelta) ||
    !Number.isFinite(projectionRegion?.longitudeDelta) ||
    projectionRegion.latitudeDelta <= 0 ||
    projectionRegion.longitudeDelta <= 0 ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  const leftLongitude = projectionRegion.longitude - projectionRegion.longitudeDelta / 2;
  const topLatitude = projectionRegion.latitude + projectionRegion.latitudeDelta / 2;

  return {
    latitude: topLatitude - (point.y / height) * projectionRegion.latitudeDelta,
    longitude: leftLongitude + (point.x / width) * projectionRegion.longitudeDelta,
  };
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function calculateScreenDistance(left, right) {
  if (
    !Number.isFinite(left?.x) ||
    !Number.isFinite(left?.y) ||
    !Number.isFinite(right?.x) ||
    !Number.isFinite(right?.y)
  ) {
    return Number.POSITIVE_INFINITY;
  }

  const deltaX = left.x - right.x;
  const deltaY = left.y - right.y;
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY);
}

function resolvePointAwayFromAnchor({
  point,
  anchor,
  minDistance,
  width,
  height,
  fallbackAngle = -Math.PI / 2
}) {
  if (!point || !anchor || !Number.isFinite(minDistance) || minDistance <= 0) {
    return point;
  }

  const distance = calculateScreenDistance(point, anchor);
  if (distance >= minDistance) {
    return point;
  }

  const angle = distance > 0.01
    ? Math.atan2(point.y - anchor.y, point.x - anchor.x)
    : fallbackAngle;
  const edgePadding = 42;
  const maxY = Math.max(edgePadding, height - 300);

  return {
    x: clampNumber(
      anchor.x + Math.cos(angle) * minDistance,
      edgePadding,
      Math.max(edgePadding, width - edgePadding),
    ),
    y: clampNumber(
      anchor.y + Math.sin(angle) * minDistance,
      edgePadding,
      maxY,
    ),
  };
}

function UserRadarRing({ delay = 0 }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let animation;
    const timeout = setTimeout(() => {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(progress, {
            toValue: 1,
            duration: USER_RADAR_DURATION_MS,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(progress, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ])
      );
      animation.start();
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (animation) {
        animation.stop();
      }
    };
  }, [delay, progress]);

  const ringStyle = {
    opacity: progress.interpolate({
      inputRange: [0, 0.72, 1],
      outputRange: [0.34, 0.15, 0],
    }),
    transform: [
      {
        scale: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0.36, 2.35],
        }),
      },
    ],
  };

  return <Animated.View pointerEvents="none" style={[styles.userRadarRing, ringStyle]} />;
}

const UserRadarPulse = React.memo(function UserRadarPulse() {
  return (
    <View pointerEvents="none" style={styles.userRadarLayer}>
      <UserRadarRing delay={0} />
      <UserRadarRing delay={640} />
      <UserRadarRing delay={1280} />
    </View>
  );
});

const CurrentLocationMarkerContent = React.memo(function CurrentLocationMarkerContent() {
  return (
    <View style={styles.currentLocationWrap} collapsable={false}>
      <View style={styles.currentLocationBadge}>
        <View style={styles.currentLocationBadgeInner}>
          <View style={styles.currentLocationDot} />
        </View>
      </View>
    </View>
  );
});

const IOSUserMarkerContent = React.memo(function IOSUserMarkerContent({
  avatarSource,
  avatarLetter,
  onAvatarError,
  showRadar = false
}) {
  return (
    <View style={styles.userMarkerWrap} collapsable={false}>
      {showRadar ? <UserRadarPulse /> : null}
      <View style={styles.avatarFallbackCircle}>
        <Text style={styles.avatarFallbackLetter}>
          {resolveAvatarInitial(avatarLetter)}
        </Text>
        {avatarSource ? (
          <Image
            source={avatarSource}
            style={styles.avatarImage}
            resizeMode="cover"
            fadeDuration={0}
            onError={onAvatarError}
          />
        ) : null}
      </View>
    </View>
  );
});

const FloatingUserOverlay = React.memo(function FloatingUserOverlay({
  pointX,
  pointY,
  avatarSource,
  avatarLetter,
  onAvatarError,
  showRadar = false
}) {
  return (
    <View pointerEvents="none" style={styles.androidUserOverlayLayer}>
      <View
        style={[
          styles.androidUserOverlay,
          {
            left: pointX - 28,
            top: pointY - 28
          }
        ]}
      >
        {showRadar ? <UserRadarPulse /> : null}
        <View style={styles.androidAvatarFallbackCircle}>
          <Text style={styles.avatarFallbackLetter}>
            {resolveAvatarInitial(avatarLetter)}
          </Text>
          {avatarSource ? (
            <Image
              source={avatarSource}
              style={styles.androidUserOverlayAvatar}
              resizeMode="cover"
              fadeDuration={0}
              onError={onAvatarError}
            />
          ) : null}
        </View>
      </View>
    </View>
  );
});

const MapAvatarMarker = React.memo(function MapAvatarMarker({
  letter = 'L',
  tone = 'driver'
}) {
  const isDriverTone = tone === 'driver';
  return (
    <View
      style={[
        styles.tripAvatarMarker,
        isDriverTone ? styles.tripAvatarMarkerDriver : styles.tripAvatarMarkerPassenger
      ]}
    >
      <Text
        style={[
          styles.tripAvatarMarkerLetter,
          isDriverTone
            ? styles.tripAvatarMarkerLetterDriver
            : styles.tripAvatarMarkerLetterPassenger
        ]}
      >
        {resolveAvatarInitial(letter)}
      </Text>
    </View>
  );
});

const NearbyVehicleRequestDots = React.memo(function NearbyVehicleRequestDots({
  sequenceIndex = 0
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.delay(Math.max(0, Number(sequenceIndex) || 0) * 260),
        Animated.timing(progress, {
          toValue: 1,
          duration: NEARBY_VEHICLE_DOTS_DURATION_MS,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 1,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [progress, sequenceIndex]);

  return (
    <View pointerEvents="none" style={styles.nearbyVehicleDotsBubble}>
      {[0, 1, 2].map((dotIndex) => {
        const center = (dotIndex + 1) / 4;
        const opacity = progress.interpolate({
          inputRange: [
            0,
            Math.max(0, center - 0.18),
            center,
            Math.min(1, center + 0.18),
            1,
          ],
          outputRange: [0.32, 0.32, 1, 0.32, 0.32],
        });
        const translateY = progress.interpolate({
          inputRange: [
            0,
            Math.max(0, center - 0.16),
            center,
            Math.min(1, center + 0.16),
            1,
          ],
          outputRange: [0, 0, -2, 0, 0],
        });

        return (
          <Animated.View
            key={`nearby-request-dot-${dotIndex}`}
            style={[
              styles.nearbyVehicleDot,
              {
                opacity,
                transform: [{ translateY }],
              },
            ]}
          />
        );
      })}
    </View>
  );
});

const RouteEndpointMarker = React.memo(function RouteEndpointMarker({
  label,
  tone = 'origin'
}) {
  const isDestination = tone === 'destination';
  return (
    <View collapsable={false} style={styles.routeEndpointMarker}>
      <View
        style={[
          styles.routeEndpointBubble,
          isDestination && styles.routeEndpointBubbleDestination
        ]}
      >
        <View
          style={[
            styles.routeEndpointBubbleDot,
            isDestination && styles.routeEndpointBubbleDotDestination
          ]}
        />
        <Text
          numberOfLines={1}
          style={[
            styles.routeEndpointText,
            isDestination && styles.routeEndpointTextDestination
          ]}
        >
          {label}
        </Text>
      </View>
      <View
        style={[
          styles.routeEndpointDot,
          isDestination && styles.routeEndpointDotDestination
        ]}
      />
    </View>
  );
});

const RouteEndpointDotMarker = React.memo(function RouteEndpointDotMarker({
  tone = 'origin'
}) {
  const isDestination = tone === 'destination';
  return (
    <View
      collapsable={false}
      style={[
        styles.routeEndpointDotMarker,
        isDestination && styles.routeEndpointDotMarkerDestination
      ]}
    >
      <View
        style={[
          styles.routeEndpointDotMarkerCore,
          isDestination && styles.routeEndpointDotMarkerCoreDestination
        ]}
      />
    </View>
  );
});

const AndroidRouteEndpointOverlay = React.memo(function AndroidRouteEndpointOverlay({
  point,
  label,
  tone = 'origin',
  layoutWidth,
  layoutHeight,
  xOffset = 0,
  yOffset = 0
}) {
  if (!point) {
    return null;
  }

  const isDestination = tone === 'destination';
  const overlayWidth = 104;
  const overlayHeight = 31;
  const left = clampNumber(point.x - overlayWidth / 2 + xOffset, 12, Math.max(12, layoutWidth - overlayWidth - 12));
  const top = clampNumber(point.y - 52 + yOffset, 78, Math.max(78, layoutHeight - 410));

  return (
    <View
      pointerEvents="none"
      collapsable={false}
      style={[
        styles.androidRouteEndpointOverlay,
        isDestination && styles.androidRouteEndpointOverlayDestination,
        {
          left,
          top,
          width: overlayWidth,
          height: overlayHeight
        }
      ]}
    >
      <View
        style={[
          styles.androidRouteEndpointOverlayDot,
          isDestination && styles.androidRouteEndpointOverlayDotDestination
        ]}
      />
      <Text
        numberOfLines={1}
        style={[
          styles.androidRouteEndpointOverlayText,
          isDestination && styles.androidRouteEndpointOverlayTextDestination
        ]}
      >
        {label}
      </Text>
    </View>
  );
});

function PrototypeMapLayer({
  mapRef,
  region,
  userCoordinate,
  userHeading = 0,
  userAvatarUri = '',
  userAvatarLetter = 'L',
  driverCoordinate,
  driverHeading = null,
  showTraffic = false,
  searchingMode = false,
  searchCenterCoordinate,
  searchRadiusKm = null,
  searchPreviewRadiusKm = null,
  nearbyVehicles = [],
  routeCoordinates,
  originCoordinate,
  destinationCoordinate,
  destinationLabel,
  destinationAddress,
  originLabel = '',
  originAddress = '',
  onMapLayout,
  onMapLoaded,
  onMapPanDrag,
  onMapReady,
  onRegionChangeComplete,
  mapChildren,
  children,
  mapSafetyProfile = 'default',
  interactionEnabled = true,
  hideUserMarker = false,
  animateRoute = true,
  routeMainColor = null,
  routeShadowColor = null,
  routeHighlightColor = null,
  hideRouteEndpointMarkers = false,
  driverMarkerMode = 'car',
  driverVehicleColor = '',
  driverMarkerAssetUrl = '',
  driverMarkerLetter = 'D',
  destinationMarkerMode = 'place',
  destinationMarkerLetter = 'P',
  forceRegionUpdate = false
}) {
  const iosMapSafeMode = Platform.OS === 'ios' && mapSafetyProfile === 'driver';
  const mapProvider =
    Platform.OS === 'ios' || Platform.OS === 'android'
      ? PROVIDER_GOOGLE
      : undefined;
  const windowLayout = useWindowDimensions();
  const markerCoordinate = userCoordinate || region;
  const normalizedDriverCoordinate = useMemo(
    () => normalizeMapCoordinate(driverCoordinate),
    [
      driverCoordinate?.lat,
      driverCoordinate?.latitude,
      driverCoordinate?.lng,
      driverCoordinate?.longitude,
    ],
  );
  const normalizedDriverHeading = useMemo(
    () =>
      normalizeHeadingDegrees(
        driverHeading ??
          driverCoordinate?.heading ??
          driverCoordinate?.bearing ??
          driverCoordinate?.course,
      ),
    [
      driverCoordinate?.bearing,
      driverCoordinate?.course,
      driverCoordinate?.heading,
      driverHeading,
    ],
  );
  const hasDriverCoordinate = Boolean(normalizedDriverCoordinate);
  const hasSearchCenter =
    Boolean(searchCenterCoordinate) &&
    Number.isFinite(searchCenterCoordinate?.latitude) &&
    Number.isFinite(searchCenterCoordinate?.longitude);
  const hasSearchRadius = Number.isFinite(searchRadiusKm) && searchRadiusKm > 0;
  const hasSearchPreviewRadius =
    Number.isFinite(searchPreviewRadiusKm) &&
    searchPreviewRadiusKm > 0 &&
    searchPreviewRadiusKm > (searchRadiusKm || 0) + 0.04;
  const searchRadiusMeters = hasSearchRadius ? Math.round(searchRadiusKm * 1000) : 0;
  const searchPreviewRadiusMeters = hasSearchPreviewRadius
    ? Math.round(searchPreviewRadiusKm * 1000)
    : 0;
  const normalizedUserHeading = useMemo(() => {
    const heading = Number(userHeading);
    if (!Number.isFinite(heading)) {
      return 0;
    }

    const normalized = heading % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }, [userHeading]);
  const hasRoute = Array.isArray(routeCoordinates) && routeCoordinates.length >= 2;
  const isSyntheticRoutePreview = hasRoute && routeCoordinates.length <= 4;
  const normalizedOriginCoordinate = useMemo(
    () => normalizeMapCoordinate(originCoordinate),
    [
      originCoordinate?.lat,
      originCoordinate?.latitude,
      originCoordinate?.lng,
      originCoordinate?.longitude,
    ],
  );
  const normalizedDestinationCoordinate = useMemo(
    () => normalizeMapCoordinate(destinationCoordinate),
    [
      destinationCoordinate?.lat,
      destinationCoordinate?.latitude,
      destinationCoordinate?.lng,
      destinationCoordinate?.longitude,
    ],
  );
  const iosLifecycleSafeMode =
    Platform.OS === 'ios' && (searchingMode || hasDriverCoordinate || hasRoute);
  const useSimplifiedIosMap = iosMapSafeMode || iosLifecycleSafeMode;
  const hasDestination = Boolean(normalizedDestinationCoordinate);
  const shouldRenderRouteEndpointMarkers = !hideRouteEndpointMarkers;
  const hasOriginMarker = Boolean(
    shouldRenderRouteEndpointMarkers && hasRoute && normalizedOriginCoordinate,
  );
  const hasDestinationMarker = Boolean(
    shouldRenderRouteEndpointMarkers || destinationMarkerMode === 'avatar',
  );
  const denseRoute = useMemo(() => densifyPath(routeCoordinates), [routeCoordinates]);
  const staticRouteCoordinates = useMemo(() => {
    if (denseRoute.length >= 2) {
      return denseRoute;
    }

    if (!Array.isArray(routeCoordinates)) {
      return [];
    }

    return routeCoordinates.filter(item => {
      return Number.isFinite(item?.latitude) && Number.isFinite(item?.longitude);
    });
  }, [denseRoute, routeCoordinates]);
  const routeMotionMetrics = useMemo(
    () => buildRouteMotionMetrics(staticRouteCoordinates),
    [staticRouteCoordinates],
  );
  const projectedDriverRoutePosition = useMemo(
    () => findNearestRouteProjection(normalizedDriverCoordinate, routeMotionMetrics),
    [
      normalizedDriverCoordinate?.latitude,
      normalizedDriverCoordinate?.longitude,
      routeMotionMetrics,
    ],
  );
  const shouldSnapDriverToRoute = Boolean(
    projectedDriverRoutePosition &&
      projectedDriverRoutePosition.snappedDistanceMeters <= DRIVER_ROUTE_SNAP_MAX_METERS,
  );
  const targetDriverCoordinate =
    shouldSnapDriverToRoute
      ? projectedDriverRoutePosition.coordinate
      : normalizedDriverCoordinate;
  const targetDriverHeading =
    normalizedDriverHeading ??
    (shouldSnapDriverToRoute ? projectedDriverRoutePosition.heading : null);
  const targetDriverRouteMeters =
    shouldSnapDriverToRoute &&
    Number.isFinite(projectedDriverRoutePosition?.routeMeters)
      ? projectedDriverRoutePosition.routeMeters
      : null;
  const normalizedNearbyVehicles = useMemo(() => {
    if (!Array.isArray(nearbyVehicles)) {
      return [];
    }

    return nearbyVehicles.filter(item => {
      return Number.isFinite(item?.coordinate?.latitude) && Number.isFinite(item?.coordinate?.longitude);
    });
  }, [nearbyVehicles]);
  const [animatedRouteCoordinates, setAnimatedRouteCoordinates] = useState([]);
  const [nearbyVehiclesVisible, setNearbyVehiclesVisible] = useState(false);
  const [activeNearbyRequestIndex, setActiveNearbyRequestIndex] = useState(0);
  const [androidMapLayout, setAndroidMapLayout] = useState({ width: 0, height: 0 });
  const [androidVisibleRegion, setAndroidVisibleRegion] = useState(region);
  const [userAvatarFailed, setUserAvatarFailed] = useState(false);
  const [smoothedDriverCoordinate, setSmoothedDriverCoordinate] = useState(targetDriverCoordinate);
  const [smoothedDriverHeading, setSmoothedDriverHeading] = useState(
    normalizedDriverHeading ?? normalizedUserHeading,
  );
  const androidPendingRegionRef = useRef(region);
  const androidRegionFrameRef = useRef(null);
  const driverSmoothFrameRef = useRef(null);
  const driverPredictionFrameRef = useRef(null);
  const driverPredictionBaseRef = useRef(null);
  const driverLastRouteSampleRef = useRef(null);
  const driverLastPredictionFrameAtRef = useRef(0);
  const smoothedDriverCoordinateRef = useRef(targetDriverCoordinate);
  const smoothedDriverHeadingRef = useRef(normalizedDriverHeading ?? normalizedUserHeading);
  const showMarkerCallouts = false;
  const normalizedAvatarUri = String(userAvatarUri || '').trim();
  const shouldRenderAvatarImage = Boolean(normalizedAvatarUri) && !userAvatarFailed;
  const resolvedAvatarSource = useMemo(() => {
    return shouldRenderAvatarImage ? { uri: normalizedAvatarUri } : null;
  }, [normalizedAvatarUri, shouldRenderAvatarImage]);
  const shouldShowCurrentLocationMarker = Boolean(!hideUserMarker);
  const shouldShowUserAvatarMarker = Boolean(searchingMode && shouldShowCurrentLocationMarker);
  const userMarkerTracksViewChanges =
    Platform.OS === 'android' || shouldShowCurrentLocationMarker;
  const shouldAnimateRoute = Boolean(animateRoute && !IS_TEST_ENV);
  const visibleNearbyVehicles = nearbyVehiclesVisible
    ? normalizedNearbyVehicles
    : [];
  const displayedRouteCoordinates = shouldAnimateRoute
    ? animatedRouteCoordinates
    : staticRouteCoordinates;
  const routeRenderCoordinates = useMemo(() => {
    if (!hasRoute) {
      return [];
    }

    if (displayedRouteCoordinates.length >= 2) {
      return displayedRouteCoordinates;
    }

    return staticRouteCoordinates.slice(0, 2);
  }, [displayedRouteCoordinates, hasRoute, staticRouteCoordinates]);
  const hasRenderableRoute = routeRenderCoordinates.length >= 2;
  const displayedDriverCoordinate =
    smoothedDriverCoordinate || targetDriverCoordinate || normalizedDriverCoordinate;
  const hasDisplayedDriverCoordinate = Boolean(displayedDriverCoordinate);
  const displayedDriverHeading =
    normalizeHeadingDegrees(smoothedDriverHeading) ??
    normalizedDriverHeading ??
    normalizedUserHeading;
  const driverMarkerCampaignImageSource = useMemo(
    () => resolveRemoteMarkerImageSource(driverMarkerAssetUrl),
    [driverMarkerAssetUrl],
  );
  const driverVehicleMarkerImageSource = useMemo(
    () => {
      if (driverMarkerCampaignImageSource) {
        return driverMarkerCampaignImageSource;
      }

      return resolveVehicleMarkerImageSource(
        driverVehicleColor,
        driverCoordinate?.vehicleColor,
        driverCoordinate?.color,
        driverCoordinate?.vehicle?.color,
      );
    },
    [
      driverCoordinate?.color,
      driverCoordinate?.vehicle?.color,
      driverCoordinate?.vehicleColor,
      driverMarkerCampaignImageSource,
      driverVehicleColor,
    ],
  );
  const mapChildrenCount = useMemo(
    () => React.Children.count(mapChildren),
    [mapChildren],
  );
  const effectiveRouteShadowColor =
    routeShadowColor || 'rgba(255,255,255,0.88)';
  const effectiveRouteMainColor =
    routeMainColor || '#1A330E';
  const effectiveRouteHighlightColor =
    routeHighlightColor === undefined
      ? null
      : routeHighlightColor;
  const shouldRenderExternalMapChildren = !useSimplifiedIosMap && !hasRoute;
  const nativeMapTopologyKey = useMemo(() => {
    if (Platform.OS !== 'ios') {
      return 'prototype-map-native';
    }

    const routeLayerCount =
      hasRenderableRoute
        ? 1 +
          (!useSimplifiedIosMap ? 1 : 0) +
          (!useSimplifiedIosMap && effectiveRouteHighlightColor ? 1 : 0)
        : 0;

    return [
      useSimplifiedIosMap ? 'ios-simple' : 'ios-full',
      searchingMode && hasSearchCenter && hasSearchPreviewRadius ? 'preview-radius' : 'no-preview-radius',
      searchingMode && hasSearchCenter && hasSearchRadius ? 'search-radius' : 'no-search-radius',
      `route:${routeLayerCount}`,
      showTraffic ? 'traffic:on' : 'traffic:off',
      hasDestination && hasDestinationMarker ? 'destination' : 'no-destination',
      hasDisplayedDriverCoordinate ? 'driver' : 'no-driver',
      !useSimplifiedIosMap && searchingMode ? `nearby:${visibleNearbyVehicles.length}` : 'nearby:0',
      !hideUserMarker && Platform.OS !== 'android' ? 'user' : 'no-user',
      shouldRenderExternalMapChildren ? `children:${mapChildrenCount}` : 'children:0',
    ].join('|');
  }, [
    effectiveRouteHighlightColor,
    hasDestination,
    hasDestinationMarker,
    hasDisplayedDriverCoordinate,
    hasRenderableRoute,
    hasSearchCenter,
    hasSearchPreviewRadius,
    hasSearchRadius,
    hideUserMarker,
    mapChildrenCount,
    searchingMode,
    showTraffic,
    shouldRenderExternalMapChildren,
    useSimplifiedIosMap,
    visibleNearbyVehicles.length,
  ]);
  const handleAvatarError = useCallback(() => {
    setUserAvatarFailed(true);
  }, []);

  const commitSmoothedDriverCoordinate = useCallback((nextCoordinate) => {
    smoothedDriverCoordinateRef.current = nextCoordinate;
    setSmoothedDriverCoordinate(nextCoordinate);
  }, []);

  const commitSmoothedDriverHeading = useCallback((nextHeading) => {
    const normalizedHeading = normalizeHeadingDegrees(nextHeading) ?? 0;
    smoothedDriverHeadingRef.current = normalizedHeading;
    setSmoothedDriverHeading(normalizedHeading);
  }, []);

  useEffect(() => {
    setUserAvatarFailed(false);
  }, [normalizedAvatarUri]);

  useEffect(() => {
    if (!searchingMode || normalizedNearbyVehicles.length === 0 || useSimplifiedIosMap) {
      setNearbyVehiclesVisible(false);
      setActiveNearbyRequestIndex(0);
      return undefined;
    }

    setNearbyVehiclesVisible(false);
    setActiveNearbyRequestIndex(0);
    const timer = setTimeout(() => {
      setNearbyVehiclesVisible(true);
    }, NEARBY_VEHICLE_REVEAL_DELAY_MS);

    return () => clearTimeout(timer);
  }, [normalizedNearbyVehicles.length, searchingMode, useSimplifiedIosMap]);

  useEffect(() => {
    if (!nearbyVehiclesVisible || visibleNearbyVehicles.length <= 1) {
      setActiveNearbyRequestIndex(0);
      return undefined;
    }

    const interval = setInterval(() => {
      setActiveNearbyRequestIndex((current) => (
        (current + 1) % visibleNearbyVehicles.length
      ));
    }, 1300);

    return () => clearInterval(interval);
  }, [nearbyVehiclesVisible, visibleNearbyVehicles.length]);

  useEffect(() => {
    return () => {
      if (androidRegionFrameRef.current) {
        cancelAnimationFrame(androidRegionFrameRef.current);
      }
      if (driverSmoothFrameRef.current) {
        cancelAnimationFrame(driverSmoothFrameRef.current);
      }
      if (driverPredictionFrameRef.current) {
        cancelAnimationFrame(driverPredictionFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (driverSmoothFrameRef.current) {
      cancelAnimationFrame(driverSmoothFrameRef.current);
      driverSmoothFrameRef.current = null;
    }

    if (!targetDriverCoordinate) {
      commitSmoothedDriverCoordinate(null);
      commitSmoothedDriverHeading(targetDriverHeading ?? smoothedDriverHeadingRef.current);
      driverPredictionBaseRef.current = null;
      driverLastRouteSampleRef.current = null;
      return undefined;
    }

    const startCoordinate = smoothedDriverCoordinateRef.current || targetDriverCoordinate;
    const startHeading = smoothedDriverHeadingRef.current;
    const targetHeading = resolveDriverMarkerHeading({
      explicitHeading: targetDriverHeading,
      startCoordinate,
      endCoordinate: targetDriverCoordinate,
      fallbackHeading: startHeading,
    });
    const distanceMeters = calculateCoordinateDistanceMeters(
      startCoordinate,
      targetDriverCoordinate,
    );
    const headingDelta = Math.abs(
      resolveShortestHeadingDeltaDegrees(startHeading, targetHeading),
    );
    const now = Date.now();
    const previousRouteSample = driverLastRouteSampleRef.current;

    if (Number.isFinite(targetDriverRouteMeters)) {
      let estimatedSpeed = driverPredictionBaseRef.current?.speedMetersPerSecond;
      if (
        previousRouteSample &&
        Number.isFinite(previousRouteSample.routeMeters) &&
        Number.isFinite(previousRouteSample.at) &&
        now > previousRouteSample.at
      ) {
        const routeDeltaMeters = targetDriverRouteMeters - previousRouteSample.routeMeters;
        const elapsedSeconds = (now - previousRouteSample.at) / 1000;
        const speedCandidate = routeDeltaMeters / elapsedSeconds;
        if (Number.isFinite(speedCandidate) && speedCandidate > 0.3) {
          estimatedSpeed = speedCandidate;
        }
      }

      driverLastRouteSampleRef.current = {
        routeMeters: targetDriverRouteMeters,
        at: now,
      };
      driverPredictionBaseRef.current = {
        routeMeters: targetDriverRouteMeters,
        at: now,
        speedMetersPerSecond: clampDriverSpeedMetersPerSecond(estimatedSpeed),
        heading: targetHeading,
      };
    } else {
      driverPredictionBaseRef.current = null;
      driverLastRouteSampleRef.current = null;
    }

    if (!Number.isFinite(distanceMeters) || distanceMeters > DRIVER_MARKER_SMOOTH_SNAP_METERS) {
      commitSmoothedDriverCoordinate(targetDriverCoordinate);
      commitSmoothedDriverHeading(targetHeading);
      return undefined;
    }

    const shouldAnimateCoordinate = distanceMeters >= 1;
    const shouldAnimateHeading = headingDelta >= 0.6;

    if (!shouldAnimateCoordinate && !shouldAnimateHeading) {
      commitSmoothedDriverCoordinate(targetDriverCoordinate);
      commitSmoothedDriverHeading(targetHeading);
      return undefined;
    }

    const startedAt = Date.now();
    const animationDuration = shouldAnimateCoordinate
      ? DRIVER_MARKER_SMOOTH_MS
      : DRIVER_MARKER_HEADING_SMOOTH_MS;
    const animateDriverMarker = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / animationDuration);
      const eased = 1 - Math.pow(1 - progress, 3);
      commitSmoothedDriverCoordinate(
        shouldAnimateCoordinate
          ? interpolateCoordinate(
              startCoordinate,
              targetDriverCoordinate,
              eased,
            )
          : targetDriverCoordinate,
      );
      commitSmoothedDriverHeading(
        shouldAnimateHeading
          ? interpolateHeadingDegrees(startHeading, targetHeading, eased)
          : targetHeading,
      );

      if (progress < 1) {
        driverSmoothFrameRef.current = requestAnimationFrame(animateDriverMarker);
      } else {
        driverSmoothFrameRef.current = null;
        commitSmoothedDriverCoordinate(targetDriverCoordinate);
        commitSmoothedDriverHeading(targetHeading);
      }
    };

    driverSmoothFrameRef.current = requestAnimationFrame(animateDriverMarker);

    return () => {
      if (driverSmoothFrameRef.current) {
        cancelAnimationFrame(driverSmoothFrameRef.current);
        driverSmoothFrameRef.current = null;
      }
    };
  }, [
    commitSmoothedDriverCoordinate,
    commitSmoothedDriverHeading,
    targetDriverCoordinate,
    targetDriverHeading,
    targetDriverRouteMeters,
  ]);

  useEffect(() => {
    if (driverPredictionFrameRef.current) {
      cancelAnimationFrame(driverPredictionFrameRef.current);
      driverPredictionFrameRef.current = null;
    }

    if (
      IS_TEST_ENV ||
      driverMarkerMode !== 'car' ||
      !routeMotionMetrics ||
      !Number.isFinite(targetDriverRouteMeters)
    ) {
      return undefined;
    }

    const runPredictionFrame = () => {
      const base = driverPredictionBaseRef.current;
      if (
        !base ||
        !Number.isFinite(base.routeMeters) ||
        !Number.isFinite(base.at)
      ) {
        driverPredictionFrameRef.current = null;
        return;
      }

      const now = Date.now();
      const elapsedMs = now - base.at;
      const shouldThrottle =
        now - Number(driverLastPredictionFrameAtRef.current || 0) <
        DRIVER_DEAD_RECKONING_FRAME_MS;

      if (!shouldThrottle && elapsedMs > DRIVER_MARKER_SMOOTH_MS) {
        const predictionMs = elapsedMs - DRIVER_MARKER_SMOOTH_MS;

        if (predictionMs <= DRIVER_DEAD_RECKONING_MAX_MS) {
          const predictedRouteMeters =
            base.routeMeters +
            clampDriverSpeedMetersPerSecond(base.speedMetersPerSecond) *
              (predictionMs / 1000);
          const predictedPosition = resolveCoordinateAtRouteMeters(
            routeMotionMetrics,
            predictedRouteMeters,
          );

          if (predictedPosition?.coordinate) {
            driverLastPredictionFrameAtRef.current = now;
            commitSmoothedDriverCoordinate(predictedPosition.coordinate);
            commitSmoothedDriverHeading(
              predictedPosition.heading ?? base.heading,
            );
          }
        } else {
          driverPredictionFrameRef.current = null;
          return;
        }
      }

      driverPredictionFrameRef.current = requestAnimationFrame(runPredictionFrame);
    };

    driverPredictionFrameRef.current = requestAnimationFrame(runPredictionFrame);

    return () => {
      if (driverPredictionFrameRef.current) {
        cancelAnimationFrame(driverPredictionFrameRef.current);
        driverPredictionFrameRef.current = null;
      }
    };
  }, [
    commitSmoothedDriverCoordinate,
    commitSmoothedDriverHeading,
    driverMarkerMode,
    routeMotionMetrics,
    targetDriverRouteMeters,
  ]);

  const scheduleAndroidVisibleRegionUpdate = useCallback(nextRegion => {
    if (Platform.OS !== 'android' || !isValidMapRegion(nextRegion)) {
      return;
    }

    androidPendingRegionRef.current = nextRegion;
    if (androidRegionFrameRef.current) {
      return;
    }

    androidRegionFrameRef.current = requestAnimationFrame(() => {
      androidRegionFrameRef.current = null;
      setAndroidVisibleRegion(androidPendingRegionRef.current);
    });
  }, []);

  useEffect(() => {
    if (!forceRegionUpdate || !mapRef?.current || !isValidMapRegion(region)) {
      return undefined;
    }

    scheduleAndroidVisibleRegionUpdate(region);
    const timeoutId = setTimeout(() => {
      if (!mapRef?.current) {
        return;
      }
      mapRef.current.animateToRegion(region, Platform.OS === 'android' ? 0 : 180);
    }, Platform.OS === 'android' ? 420 : 80);

    return () => clearTimeout(timeoutId);
  }, [
    forceRegionUpdate,
    mapRef,
    region?.latitude,
    region?.latitudeDelta,
    region?.longitude,
    region?.longitudeDelta,
    scheduleAndroidVisibleRegionUpdate,
  ]);

  // Keep the user avatar tied to the real map coordinate on iOS.
  // The projected overlay is only needed for the Android screen-space marker path.
  const shouldRenderProjectedUserOverlay = Platform.OS === 'android';
  const androidProjectionLayout = useMemo(() => {
    const width =
      Number.isFinite(androidMapLayout.width) && androidMapLayout.width > 0
        ? androidMapLayout.width
        : windowLayout.width;
    const height =
      Number.isFinite(androidMapLayout.height) && androidMapLayout.height > 0
        ? androidMapLayout.height
        : windowLayout.height;

    return {
      width,
      height,
      hasLayout:
        Number.isFinite(width) &&
        Number.isFinite(height) &&
        width > 0 &&
        height > 0
    };
  }, [
    androidMapLayout.height,
    androidMapLayout.width,
    windowLayout.height,
    windowLayout.width
  ]);
  const projectedRouteEndpointOverlayPoints = useMemo(() => {
    if (Platform.OS !== 'android' || !androidProjectionLayout.hasLayout || !hasRoute) {
      return { origin: null, destination: null };
    }

    const projectionRegion = androidVisibleRegion || region;
    const project = coordinate => projectCoordinateToScreenPoint({
      coordinate,
      projectionRegion,
      width: androidProjectionLayout.width,
      height: androidProjectionLayout.height
    });

    return {
      origin: hasOriginMarker ? project(normalizedOriginCoordinate) : null,
      destination:
        hasDestination && hasDestinationMarker && destinationMarkerMode !== 'avatar'
          ? project(normalizedDestinationCoordinate)
          : null
    };
  }, [
    androidProjectionLayout.hasLayout,
    androidProjectionLayout.height,
    androidProjectionLayout.width,
    androidVisibleRegion,
    destinationMarkerMode,
    hasDestination,
    hasDestinationMarker,
    hasOriginMarker,
    hasRoute,
    normalizedDestinationCoordinate,
    normalizedOriginCoordinate,
    region
  ]);
  const shouldSpreadAndroidEndpointOverlays = useMemo(() => {
    const originPoint = projectedRouteEndpointOverlayPoints.origin;
    const destinationPoint = projectedRouteEndpointOverlayPoints.destination;
    if (!originPoint || !destinationPoint) {
      return false;
    }

    const deltaX = originPoint.x - destinationPoint.x;
    const deltaY = originPoint.y - destinationPoint.y;
    return Math.sqrt(deltaX * deltaX + deltaY * deltaY) < 132;
  }, [
    projectedRouteEndpointOverlayPoints.destination,
    projectedRouteEndpointOverlayPoints.origin
  ]);
  const projectedUserOverlayPoint = useMemo(() => {
    const projectionRegion =
      Platform.OS === 'android' ? androidVisibleRegion || region : region;
    const resolvedWidth = androidProjectionLayout.width;
    const resolvedHeight = androidProjectionLayout.height;
    const hasLayout = androidProjectionLayout.hasLayout;
    const maxVisibleY = hasLayout ? Math.max(56, resolvedHeight - 320) : 0;

    if (!shouldRenderProjectedUserOverlay || !hasLayout) {
      return null;
    }

    const centerFallbackPoint = {
      x: resolvedWidth / 2,
      y: Math.min(resolvedHeight * 0.42, maxVisibleY)
    };

    const projectedPoint = projectCoordinateToScreenPoint({
      coordinate: markerCoordinate,
      projectionRegion,
      width: resolvedWidth,
      height: resolvedHeight
    });

    if (!projectedPoint) {
      return centerFallbackPoint;
    }

    return resolveProjectedOverlayPointWithinSafeZones({
      x: Math.min(Math.max(projectedPoint.x, 28), resolvedWidth - 28),
      y: Math.min(Math.max(projectedPoint.y, 28), maxVisibleY)
    }, resolvedWidth, resolvedHeight);
  }, [
    androidProjectionLayout.hasLayout,
    androidProjectionLayout.height,
    androidProjectionLayout.width,
    androidVisibleRegion,
    markerCoordinate?.latitude,
    markerCoordinate?.longitude,
    region?.latitude,
    region?.latitudeDelta,
    region?.longitude,
    region?.longitudeDelta,
    shouldRenderProjectedUserOverlay,
  ]);
  const collisionSafeNearbyVehicles = useMemo(() => {
    if (
      !searchingMode ||
      visibleNearbyVehicles.length === 0 ||
      !androidProjectionLayout.hasLayout
    ) {
      return visibleNearbyVehicles;
    }

    const projectionRegion =
      Platform.OS === 'android' ? androidVisibleRegion || region : region;
    const width = androidProjectionLayout.width;
    const height = androidProjectionLayout.height;
    const userPoint =
      Platform.OS === 'android'
        ? projectedUserOverlayPoint
        : projectCoordinateToScreenPoint({
            coordinate: markerCoordinate,
            projectionRegion,
            width,
            height,
          });

    if (!userPoint) {
      return visibleNearbyVehicles;
    }

    const adjustedPoints = [];

    return visibleNearbyVehicles.map((vehicle, index) => {
      const rawPoint = projectCoordinateToScreenPoint({
        coordinate: vehicle.coordinate,
        projectionRegion,
        width,
        height,
      });

      if (!rawPoint) {
        return vehicle;
      }

      let resolvedPoint = resolvePointAwayFromAnchor({
        point: rawPoint,
        anchor: userPoint,
        minDistance: NEARBY_VEHICLE_USER_CLEARANCE_PX,
        width,
        height,
        fallbackAngle: -Math.PI / 2 + index * 0.82,
      });

      adjustedPoints.forEach((previousPoint, previousIndex) => {
        resolvedPoint = resolvePointAwayFromAnchor({
          point: resolvedPoint,
          anchor: previousPoint,
          minDistance: NEARBY_VEHICLE_CLUSTER_CLEARANCE_PX,
          width,
          height,
          fallbackAngle: -Math.PI / 3 + (index + previousIndex) * 0.72,
        });
      });

      adjustedPoints.push(resolvedPoint);

      const adjustedCoordinate = projectScreenPointToCoordinate({
        point: resolvedPoint,
        projectionRegion,
        width,
        height,
      });

      if (!adjustedCoordinate) {
        return vehicle;
      }

      return {
        ...vehicle,
        coordinate: adjustedCoordinate,
        originalCoordinate: vehicle.coordinate,
      };
    });
  }, [
    androidProjectionLayout.hasLayout,
    androidProjectionLayout.height,
    androidProjectionLayout.width,
    androidVisibleRegion,
    markerCoordinate?.latitude,
    markerCoordinate?.longitude,
    projectedUserOverlayPoint,
    region,
    searchingMode,
    visibleNearbyVehicles,
  ]);

  useEffect(() => {
    if (!hasRoute || denseRoute.length < 2) {
      setAnimatedRouteCoordinates([]);
      return undefined;
    }

    if (!shouldAnimateRoute) {
      setAnimatedRouteCoordinates(denseRoute);
      return undefined;
    }

    let frameId = null;
    const startTime = Date.now();

    const animateStep = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / ROUTE_ANIMATION_DURATION);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      const visibleCount = Math.max(2, Math.floor(denseRoute.length * eased));

      setAnimatedRouteCoordinates(denseRoute.slice(0, visibleCount));

      if (progress < 1) {
        frameId = requestAnimationFrame(animateStep);
      }
    };

    setAnimatedRouteCoordinates(denseRoute.slice(0, 2));
    frameId = requestAnimationFrame(animateStep);

    return () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [denseRoute, hasRoute, shouldAnimateRoute]);

  return (
    <View style={styles.mapArea}>
      <View
        pointerEvents={interactionEnabled ? 'auto' : 'none'}
        style={StyleSheet.absoluteFillObject}
        onLayout={event => {
          onMapLayout?.(event);
          const width = event?.nativeEvent?.layout?.width;
          const height = event?.nativeEvent?.layout?.height;
          if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            setAndroidMapLayout(previous => {
              if (previous.width === width && previous.height === height) {
                return previous;
              }

              return { width, height };
            });
          }
        }}
      >
        <MapView
          // iOS Google Maps can abort in AIRGoogleMap when React inserts/removes
          // native children during route lifecycle transitions. Remount the map
          // only when that native child topology changes.
          key={nativeMapTopologyKey}
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          onRegionChange={scheduleAndroidVisibleRegionUpdate}
          onRegionChangeComplete={nextRegion => {
            scheduleAndroidVisibleRegionUpdate(nextRegion);
            if (typeof onRegionChangeComplete === 'function') {
              onRegionChangeComplete(nextRegion);
            }
          }}
          onPanDrag={interactionEnabled ? onMapPanDrag : undefined}
          provider={mapProvider}
          initialRegion={region}
          mapType="standard"
          customMapStyle={mapStyleAppleLike}
          onMapLoaded={onMapLoaded}
          onMapReady={onMapReady}
          scrollEnabled={interactionEnabled}
          zoomEnabled={interactionEnabled}
          rotateEnabled={interactionEnabled}
          pitchEnabled={interactionEnabled || hasDisplayedDriverCoordinate}
          toolbarEnabled={false}
          showsCompass={false}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsTraffic={Boolean(showTraffic)}
        >
          {!useSimplifiedIosMap && searchingMode && hasSearchCenter && hasSearchPreviewRadius ? (
            <Circle
              key="search-radius-preview"
              center={searchCenterCoordinate}
              radius={searchPreviewRadiusMeters}
              strokeWidth={1}
              strokeColor="rgba(13,148,136,0.20)"
              fillColor="rgba(45,212,191,0.04)"
            />
          ) : null}

          {!useSimplifiedIosMap && searchingMode && hasSearchCenter && hasSearchRadius ? (
            <Circle
              key="search-radius-current"
              center={searchCenterCoordinate}
              radius={searchRadiusMeters}
              strokeWidth={1.7}
              strokeColor="rgba(13,148,136,0.46)"
              fillColor="rgba(45,212,191,0.12)"
            />
          ) : null}

          {!useSimplifiedIosMap && hasRenderableRoute ? (
            <Polyline
              key="route-shadow"
              coordinates={routeRenderCoordinates}
              strokeColor={effectiveRouteShadowColor}
              strokeWidth={isSyntheticRoutePreview ? 7 : 7.5}
              lineCap="round"
              lineJoin="round"
            />
          ) : null}

          {hasRenderableRoute ? (
            <Polyline
              key="route-main"
              coordinates={routeRenderCoordinates}
              strokeColor={effectiveRouteMainColor}
              strokeWidth={useSimplifiedIosMap ? 3.8 : 4}
              lineCap="round"
              lineJoin="round"
            />
          ) : null}

          {!useSimplifiedIosMap &&
          hasRenderableRoute &&
          effectiveRouteHighlightColor ? (
            <Polyline
              key="route-highlight"
              coordinates={routeRenderCoordinates}
              strokeColor={effectiveRouteHighlightColor}
              strokeWidth={2.6}
              lineCap="round"
              lineJoin="round"
            />
          ) : null}

          {hasOriginMarker ? (
            <Marker
              key="origin-marker"
              coordinate={normalizedOriginCoordinate}
              zIndex={17}
              anchor={{ x: 0.5, y: 0.9 }}
              tracksViewChanges={Platform.OS === 'android'}
              pinColor={undefined}
            >
              {Platform.OS === 'android' ? (
                <RouteEndpointDotMarker tone="origin" />
              ) : (
                <RouteEndpointMarker label="Partida" tone="origin" />
              )}
            </Marker>
          ) : null}

          {hasDestination && hasDestinationMarker ? (
            <Marker
              key="destination-marker"
              coordinate={normalizedDestinationCoordinate}
              zIndex={18}
              anchor={{ x: 0.5, y: destinationMarkerMode === 'avatar' ? 0.5 : 0.9 }}
              tracksViewChanges={Platform.OS === 'android' && destinationMarkerMode !== 'avatar'}
              pinColor={undefined}
            >
              <View collapsable={false}>
                <View style={styles.destinationMarkerWrap}>
                  {destinationMarkerMode === 'avatar' ? (
                    <MapAvatarMarker
                      letter={destinationMarkerLetter}
                      tone="passenger"
                    />
                  ) : Platform.OS === 'android' ? (
                    <RouteEndpointDotMarker tone="destination" />
                  ) : (
                    <RouteEndpointMarker label="Chegada" tone="destination" />
                  )}
                </View>

                {showMarkerCallouts ? (
                  <View style={styles.calloutBubble}>
                    <Text style={styles.calloutTitle}>{destinationLabel || 'Chegada'}</Text>
                    <Text style={styles.calloutAddress}>{destinationAddress || 'Endereço de destino'}</Text>
                  </View>
                ) : null}
              </View>
            </Marker>
          ) : null}

          {hasDisplayedDriverCoordinate ? (
            <Marker
              key="driver-marker"
              coordinate={{
                latitude: displayedDriverCoordinate.latitude,
                longitude: displayedDriverCoordinate.longitude,
              }}
              zIndex={19}
              anchor={{ x: 0.5, y: 0.5 }}
              image={driverMarkerMode === 'car' ? driverVehicleMarkerImageSource : undefined}
              flat={driverMarkerMode === 'car'}
              rotation={driverMarkerMode === 'car' ? displayedDriverHeading : 0}
              tracksViewChanges={false}
              pinColor={undefined}
            >
              {driverMarkerMode === 'avatar' ? (
                <MapAvatarMarker letter={driverMarkerLetter} tone="driver" />
              ) : null}
            </Marker>
          ) : null}

          {!useSimplifiedIosMap && searchingMode
            ? collisionSafeNearbyVehicles.map((vehicle, index) => {
                const id = String(vehicle.id || '');
                const isOuterVehicle = id.startsWith('outer');
                const lat = Number(vehicle.coordinate.latitude).toFixed(6);
                const lng = Number(vehicle.coordinate.longitude).toFixed(6);
                const isRequestingVehicle = searchingMode && index === activeNearbyRequestIndex;
                const vehicleMarkerImageSource =
                  driverMarkerCampaignImageSource ||
                  resolveVehicleMarkerImageSource(
                    vehicle.color,
                    vehicle.vehicleColor,
                    vehicle.vehicle?.color,
                  );
                return (
                  <React.Fragment key={`nearby-${id || 'vehicle'}-${index}-${lat}-${lng}`}>
                    <Marker
                      coordinate={{
                        latitude: vehicle.coordinate.latitude,
                        longitude: vehicle.coordinate.longitude
                      }}
                      zIndex={isRequestingVehicle ? 17 : 16}
                      anchor={{ x: 0.5, y: 0.5 }}
                      image={vehicleMarkerImageSource}
                      flat
                      rotation={Number.isFinite(Number(vehicle.heading)) ? Number(vehicle.heading) : 0}
                      opacity={isOuterVehicle ? 0.84 : 1}
                      tracksViewChanges={false}
                    />
                    {isRequestingVehicle ? (
                      <Marker
                        coordinate={{
                          latitude: vehicle.coordinate.latitude,
                          longitude: vehicle.coordinate.longitude
                        }}
                        zIndex={18}
                        anchor={{ x: 0.5, y: 0.82 }}
                        tracksViewChanges
                      >
                        <View style={styles.nearbyVehicleDotsMarker}>
                          <NearbyVehicleRequestDots sequenceIndex={index} />
                        </View>
                      </Marker>
                    ) : null}
                  </React.Fragment>
                );
              })
            : null}

          {shouldShowCurrentLocationMarker && Platform.OS !== 'android' ? (
            <Marker
              key="user-marker"
              coordinate={{ latitude: markerCoordinate.latitude, longitude: markerCoordinate.longitude }}
              zIndex={20}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={userMarkerTracksViewChanges}
              pinColor={undefined}
            >
              <View collapsable={false}>
                {shouldShowUserAvatarMarker ? (
                  <IOSUserMarkerContent
                    avatarSource={resolvedAvatarSource}
                    avatarLetter={userAvatarLetter}
                    onAvatarError={handleAvatarError}
                    showRadar={searchingMode}
                  />
                ) : (
                  <CurrentLocationMarkerContent />
                )}

                {showMarkerCallouts ? (
                  <View style={styles.calloutBubble}>
                    <Text style={styles.calloutTitle}>{originLabel || 'Partida'}</Text>
                    <Text style={styles.calloutAddress}>{originAddress || 'Sua localização atual'}</Text>
                  </View>
                ) : null}
              </View>
            </Marker>
          ) : null}

          {shouldRenderExternalMapChildren ? mapChildren : null}
        </MapView>
      </View>

      {Platform.OS === 'android' && hasRoute && shouldRenderRouteEndpointMarkers ? (
        <View pointerEvents="none" style={styles.androidRouteEndpointOverlayLayer}>
          <AndroidRouteEndpointOverlay
            point={projectedRouteEndpointOverlayPoints.origin}
            label="Partida"
            tone="origin"
            layoutWidth={androidProjectionLayout.width}
            layoutHeight={androidProjectionLayout.height}
            xOffset={shouldSpreadAndroidEndpointOverlays ? 42 : 0}
            yOffset={shouldSpreadAndroidEndpointOverlays ? 18 : 0}
          />
          <AndroidRouteEndpointOverlay
            point={projectedRouteEndpointOverlayPoints.destination}
            label="Chegada"
            tone="destination"
            layoutWidth={androidProjectionLayout.width}
            layoutHeight={androidProjectionLayout.height}
            xOffset={shouldSpreadAndroidEndpointOverlays ? -42 : 0}
            yOffset={shouldSpreadAndroidEndpointOverlays ? -18 : 0}
          />
        </View>
      ) : null}

      {shouldShowCurrentLocationMarker &&
      shouldRenderProjectedUserOverlay &&
      projectedUserOverlayPoint ? (
        shouldShowUserAvatarMarker ? (
          <FloatingUserOverlay
            pointX={projectedUserOverlayPoint.x}
            pointY={projectedUserOverlayPoint.y}
            avatarSource={resolvedAvatarSource}
            avatarLetter={userAvatarLetter}
            onAvatarError={handleAvatarError}
            showRadar={searchingMode}
          />
        ) : (
          <View pointerEvents="none" style={styles.androidUserOverlayLayer}>
            <View
              style={[
                styles.androidCurrentLocationOverlay,
                {
                  left: projectedUserOverlayPoint.x - 21,
                  top: projectedUserOverlayPoint.y - 21
                }
              ]}
            >
              <CurrentLocationMarkerContent />
            </View>
          </View>
        )
      ) : null}

      {children}
    </View>
  );
}

export default React.memo(PrototypeMapLayer);

const styles = StyleSheet.create({
  mapArea: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.bg.map
  },
  simulatorMapFallback: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
    backgroundColor: color.bg.map
  },
  simulatorMapGlowTop: {
    position: 'absolute',
    top: -48,
    left: -24,
    right: '34%',
    height: 180,
    borderRadius: 999,
    backgroundColor: 'rgba(42, 77, 29, 0.12)'
  },
  simulatorMapGlowBottom: {
    position: 'absolute',
    right: -40,
    bottom: 120,
    width: 220,
    height: 220,
    borderRadius: 999,
    backgroundColor: 'rgba(232, 93, 4, 0.10)'
  },
  simulatorMapGrid: {
    ...StyleSheet.absoluteFillObject
  },
  simulatorMapGridLineHorizontal: {
    position: 'absolute',
    left: 20,
    right: 20,
    top: '24%',
    borderTopWidth: 1,
    borderColor: 'rgba(17,26,39,0.08)'
  },
  simulatorMapGridLineHorizontalMid: {
    top: '58%'
  },
  simulatorMapGridLineVertical: {
    position: 'absolute',
    top: 20,
    bottom: 20,
    left: '28%',
    borderLeftWidth: 1,
    borderColor: 'rgba(17,26,39,0.08)'
  },
  simulatorMapGridLineVerticalRight: {
    left: '71%'
  },
  simulatorRouteBand: {
    position: 'absolute',
    left: 48,
    right: 84,
    top: '44%',
    height: 6,
    borderRadius: 999,
    backgroundColor: '#111719',
    transform: [{ rotate: '-18deg' }],
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.14,
    shadowRadius: 16
  },
  simulatorFallbackLegend: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: 18,
    gap: 10
  },
  simulatorFallbackChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.88)',
    borderWidth: 1,
    borderColor: color.border.subtle
  },
  simulatorFallbackChipText: {
    maxWidth: 210,
    color: color.text.secondary,
    fontSize: 12,
    fontWeight: '600'
  },
  simulatorFallbackFootnote: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 22,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.84)',
    borderWidth: 1,
    borderColor: color.border.subtle
  },
  simulatorFallbackFootnoteText: {
    color: color.text.muted,
    fontSize: 11,
    lineHeight: 15
  },
  userMarkerWrap: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible'
  },
  userRadarLayer: {
    position: 'absolute',
    width: 138,
    height: 138,
    borderRadius: 69,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 0
  },
  userRadarRing: {
    position: 'absolute',
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 2,
    borderColor: 'rgba(26,51,14,0.42)',
    backgroundColor: 'rgba(26,51,14,0.08)'
  },
  currentLocationWrap: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible'
  },
  currentLocationBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 2,
    borderColor: 'rgba(26,51,14,0.14)',
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 9,
    elevation: 6
  },
  currentLocationBadgeInner: {
    width: 23,
    height: 23,
    borderRadius: 11.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E8F1E3'
  },
  currentLocationDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#1A330E'
  },
  destinationMarkerWrap: {
    alignItems: 'center'
  },
  routeEndpointMarker: {
    width: 108,
    height: 58,
    alignItems: 'center',
    justifyContent: 'flex-end'
  },
  routeEndpointBubble: {
    minWidth: 88,
    maxWidth: 108,
    minHeight: 31,
    borderRadius: 16,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderWidth: 1,
    borderColor: 'rgba(23,20,18,0.10)',
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 11,
    elevation: 6
  },
  routeEndpointBubbleDestination: {
    borderColor: 'rgba(26,51,14,0.18)'
  },
  routeEndpointBubbleDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 7,
    backgroundColor: '#171412'
  },
  routeEndpointBubbleDotDestination: {
    backgroundColor: '#1A330E'
  },
  routeEndpointDot: {
    width: 11,
    height: 11,
    borderRadius: 5.5,
    marginTop: 4,
    backgroundColor: '#171412',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.98)',
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.14,
    shadowRadius: 6,
    elevation: 5
  },
  routeEndpointDotDestination: {
    backgroundColor: '#1A330E'
  },
  routeEndpointText: {
    color: '#171412',
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700'
  },
  routeEndpointTextDestination: {
    color: '#1A330E'
  },
  routeEndpointDotMarker: {
    width: 25,
    height: 25,
    borderRadius: 12.5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderWidth: 1,
    borderColor: 'rgba(23,20,18,0.12)',
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.14,
    shadowRadius: 7,
    elevation: 6
  },
  routeEndpointDotMarkerDestination: {
    borderColor: 'rgba(26,51,14,0.18)'
  },
  routeEndpointDotMarkerCore: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#171412'
  },
  routeEndpointDotMarkerCoreDestination: {
    backgroundColor: '#1A330E'
  },
  androidRouteEndpointOverlayLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 4,
    elevation: 4
  },
  androidRouteEndpointOverlay: {
    position: 'absolute',
    minHeight: 31,
    borderRadius: 16,
    paddingHorizontal: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderWidth: 1,
    borderColor: 'rgba(23,20,18,0.10)',
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 11,
    elevation: 8
  },
  androidRouteEndpointOverlayDestination: {
    borderColor: 'rgba(26,51,14,0.18)'
  },
  androidRouteEndpointOverlayDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 7,
    backgroundColor: '#171412'
  },
  androidRouteEndpointOverlayDotDestination: {
    backgroundColor: '#1A330E'
  },
  androidRouteEndpointOverlayText: {
    color: '#171412',
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
    includeFontPadding: false
  },
  androidRouteEndpointOverlayTextDestination: {
    color: '#1A330E'
  },
  destinationAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(17,23,25,0.16)',
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 7
  },
  tripAvatarMarker: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 8
  },
  tripAvatarMarkerDriver: {
    backgroundColor: '#1A330E',
    borderColor: 'rgba(255,255,255,0.96)'
  },
  tripAvatarMarkerPassenger: {
    backgroundColor: '#F2E8C9',
    borderColor: 'rgba(255,255,255,0.96)'
  },
  tripAvatarMarkerLetter: {
    fontSize: 15,
    lineHeight: 17,
    fontWeight: '700'
  },
  tripAvatarMarkerLetterDriver: {
    color: '#FFFFFF'
  },
  tripAvatarMarkerLetterPassenger: {
    color: '#314225'
  },
  nearbyVehicleDotsMarker: {
    width: 42,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  nearbyVehicleDotsBubble: {
    position: 'absolute',
    top: -1,
    minWidth: 34,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(26,51,14,0.14)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 7,
  },
  nearbyVehicleDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#1A330E',
  },
  avatarImage: {
    position: 'absolute',
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.96)'
  },
  avatarFallbackCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#DCE7D5',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  avatarFallbackLetter: {
    color: '#203123',
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '700'
  },
  androidUserOverlayLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 12,
    elevation: 12
  },
  androidUserOverlay: {
    position: 'absolute',
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible'
  },
  androidCurrentLocationOverlay: {
    position: 'absolute',
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible'
  },
  androidUserOverlayAvatar: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.96)'
  },
  androidAvatarFallbackCircle: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#DCE7D5',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.96)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden'
  },
  calloutBubble: {
    maxWidth: 208,
    borderRadius: 14,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(250,251,248,0.92)',
    borderWidth: 1,
    borderColor: color.border.strong,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 7
  },
  calloutTitle: {
    color: '#1D2430',
    fontSize: 12,
    fontWeight: '600'
  },
  calloutAddress: {
    marginTop: 2,
    color: '#505B69',
    fontSize: 11
  },
});
