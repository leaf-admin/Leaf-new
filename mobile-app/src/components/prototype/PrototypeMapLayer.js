import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import mapStyleAppleLike from './mapStyleAppleLike';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

const { color, motion } = robotaxiPrototypeTokens;
const ROUTE_ANIMATION_DURATION = motion.timing.map;
const POINTS_PER_SEGMENT = 18;

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

const IOSUserMarkerContent = React.memo(function IOSUserMarkerContent({
  rotationDegrees,
  avatarSource,
  avatarLetter,
  onAvatarError
}) {
  return (
    <View style={styles.userMarkerWrap} collapsable={false}>
      <View style={[styles.userArrowOrbit, { transform: [{ rotate: `${rotationDegrees}deg` }] }]} pointerEvents="none">
        <Ionicons name="caret-up" size={14} color={color.accent.primary} style={styles.userArrow} />
      </View>
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
  rotationDegrees,
  avatarSource,
  avatarLetter,
  onAvatarError
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
        <View
          style={[
            styles.androidUserArrowOrbit,
            { transform: [{ rotate: `${rotationDegrees}deg` }] }
          ]}
          pointerEvents="none"
        >
          <Ionicons name="caret-up" size={18} color={color.accent.primary} style={styles.androidUserOverlayArrow} />
        </View>
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

function PrototypeMapLayer({
  mapRef,
  region,
  userCoordinate,
  userHeading = 0,
  userAvatarUri = '',
  userAvatarLetter = 'L',
  driverCoordinate,
  showTraffic = false,
  searchingMode = false,
  searchCenterCoordinate,
  searchRadiusKm = null,
  searchPreviewRadiusKm = null,
  nearbyVehicles = [],
  routeCoordinates,
  destinationCoordinate,
  destinationLabel,
  destinationAddress,
  originLabel = '',
  originAddress = '',
  onMapLayout,
  onMapPanDrag,
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
  driverMarkerMode = 'car',
  driverMarkerLetter = 'D',
  destinationMarkerMode = 'place',
  destinationMarkerLetter = 'P'
}) {
  const iosMapSafeMode = Platform.OS === 'ios' && mapSafetyProfile === 'driver';
  const mapProvider =
    Platform.OS === 'ios' || Platform.OS === 'android'
      ? PROVIDER_GOOGLE
      : undefined;
  const windowLayout = useWindowDimensions();
  const markerCoordinate = userCoordinate || region;
  const hasDriverCoordinate =
    Boolean(driverCoordinate) &&
    Number.isFinite(driverCoordinate?.latitude) &&
    Number.isFinite(driverCoordinate?.longitude);
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
  const iosLifecycleSafeMode =
    Platform.OS === 'ios' && (searchingMode || hasDriverCoordinate || hasRoute);
  const useSimplifiedIosMap = iosMapSafeMode || iosLifecycleSafeMode;
  const hasDestination = Boolean(destinationCoordinate) && Number.isFinite(destinationCoordinate?.latitude) && Number.isFinite(destinationCoordinate?.longitude);
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
  const normalizedNearbyVehicles = useMemo(() => {
    if (!Array.isArray(nearbyVehicles)) {
      return [];
    }

    return nearbyVehicles.filter(item => {
      return Number.isFinite(item?.coordinate?.latitude) && Number.isFinite(item?.coordinate?.longitude);
    });
  }, [nearbyVehicles]);
  const [animatedRouteCoordinates, setAnimatedRouteCoordinates] = useState([]);
  const [androidMapLayout, setAndroidMapLayout] = useState({ width: 0, height: 0 });
  const [androidVisibleRegion, setAndroidVisibleRegion] = useState(region);
  const [userAvatarFailed, setUserAvatarFailed] = useState(false);
  const androidPendingRegionRef = useRef(region);
  const androidRegionFrameRef = useRef(null);
  const showMarkerCallouts = false;
  const normalizedAvatarUri = String(userAvatarUri || '').trim();
  const shouldRenderAvatarImage = Boolean(normalizedAvatarUri) && !userAvatarFailed;
  const resolvedAvatarSource = useMemo(() => {
    return shouldRenderAvatarImage ? { uri: normalizedAvatarUri } : null;
  }, [normalizedAvatarUri, shouldRenderAvatarImage]);
  const userMarkerTracksViewChanges = Platform.OS === 'android';
  const displayedRouteCoordinates = animateRoute
    ? animatedRouteCoordinates
    : staticRouteCoordinates;
  const effectiveRouteShadowColor =
    routeShadowColor || 'rgba(7,22,39,0.24)';
  const effectiveRouteMainColor =
    routeMainColor || (useSimplifiedIosMap ? '#E85D04' : '#F97316');
  const effectiveRouteHighlightColor =
    routeHighlightColor === undefined
      ? '#FED7AA'
      : routeHighlightColor;
  const handleAvatarError = useCallback(() => {
    setUserAvatarFailed(true);
  }, []);

  useEffect(() => {
    setUserAvatarFailed(false);
  }, [normalizedAvatarUri]);

  useEffect(() => {
    return () => {
      if (androidRegionFrameRef.current) {
        cancelAnimationFrame(androidRegionFrameRef.current);
      }
    };
  }, []);

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

  // Keep the user avatar tied to the real map coordinate on iOS.
  // The projected overlay is only needed for the Android screen-space marker path.
  const shouldRenderProjectedUserOverlay = Platform.OS === 'android';
  const projectedUserOverlayPoint = useMemo(() => {
    const projectionRegion =
      Platform.OS === 'android' ? androidVisibleRegion || region : region;
    const resolvedWidth =
      Number.isFinite(androidMapLayout.width) && androidMapLayout.width > 0
        ? androidMapLayout.width
        : windowLayout.width;
    const resolvedHeight =
      Number.isFinite(androidMapLayout.height) && androidMapLayout.height > 0
        ? androidMapLayout.height
        : windowLayout.height;
    const hasLayout =
      Number.isFinite(resolvedWidth) &&
      Number.isFinite(resolvedHeight) &&
      resolvedWidth > 0 &&
      resolvedHeight > 0;
    const maxVisibleY = hasLayout ? Math.max(56, resolvedHeight - 320) : 0;

    if (!shouldRenderProjectedUserOverlay || !hasLayout) {
      return null;
    }

    const centerFallbackPoint = {
      x: resolvedWidth / 2,
      y: Math.min(resolvedHeight * 0.42, maxVisibleY)
    };

    if (
      !Number.isFinite(markerCoordinate?.latitude) ||
      !Number.isFinite(markerCoordinate?.longitude) ||
      !Number.isFinite(projectionRegion?.latitude) ||
      !Number.isFinite(projectionRegion?.longitude) ||
      !Number.isFinite(projectionRegion?.latitudeDelta) ||
      !Number.isFinite(projectionRegion?.longitudeDelta) ||
      projectionRegion.latitudeDelta <= 0 ||
      projectionRegion.longitudeDelta <= 0
    ) {
      return centerFallbackPoint;
    }

    const leftLongitude = projectionRegion.longitude - projectionRegion.longitudeDelta / 2;
    const topLatitude = projectionRegion.latitude + projectionRegion.latitudeDelta / 2;
    const x =
      ((markerCoordinate.longitude - leftLongitude) / projectionRegion.longitudeDelta) * resolvedWidth;
    const y = ((topLatitude - markerCoordinate.latitude) / projectionRegion.latitudeDelta) * resolvedHeight;

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return centerFallbackPoint;
    }

    return resolveProjectedOverlayPointWithinSafeZones({
      x: Math.min(Math.max(x, 28), resolvedWidth - 28),
      y: Math.min(Math.max(y, 28), maxVisibleY)
    }, resolvedWidth, resolvedHeight);
  }, [
    androidMapLayout.height,
    androidMapLayout.width,
    androidVisibleRegion,
    markerCoordinate?.latitude,
    markerCoordinate?.longitude,
    region?.latitude,
    region?.latitudeDelta,
    region?.longitude,
    region?.longitudeDelta,
    shouldRenderProjectedUserOverlay,
    windowLayout.height,
    windowLayout.width
  ]);

  useEffect(() => {
    if (!hasRoute || denseRoute.length < 2) {
      setAnimatedRouteCoordinates([]);
      return undefined;
    }

    if (!animateRoute) {
      setAnimatedRouteCoordinates(denseRoute);
      return undefined;
    }

    let frameId = null;
    const startTime = Date.now();

    const animateStep = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(1, elapsed / ROUTE_ANIMATION_DURATION);
      const eased = 1 - Math.pow(1 - progress, 3);
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
  }, [animateRoute, denseRoute, hasRoute]);

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
          scrollEnabled={interactionEnabled}
          zoomEnabled={interactionEnabled}
          rotateEnabled={interactionEnabled}
          pitchEnabled={false}
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

          {!useSimplifiedIosMap && hasRoute && displayedRouteCoordinates.length >= 2 ? (
            <Polyline
              key="route-shadow"
              coordinates={displayedRouteCoordinates}
              strokeColor={effectiveRouteShadowColor}
              strokeWidth={12}
              lineCap="round"
              lineJoin="round"
            />
          ) : null}

          {hasRoute && displayedRouteCoordinates.length >= 2 ? (
            <Polyline
              key="route-main"
              coordinates={displayedRouteCoordinates}
              strokeColor={effectiveRouteMainColor}
              strokeWidth={useSimplifiedIosMap ? 5 : 7}
              lineCap="round"
              lineJoin="round"
            />
          ) : null}

          {!useSimplifiedIosMap &&
          hasRoute &&
          displayedRouteCoordinates.length >= 2 &&
          effectiveRouteHighlightColor ? (
            <Polyline
              key="route-highlight"
              coordinates={displayedRouteCoordinates}
              strokeColor={effectiveRouteHighlightColor}
              strokeWidth={2.6}
              lineCap="round"
              lineJoin="round"
            />
          ) : null}

          {hasDestination ? (
            <Marker
              key="destination-marker"
              coordinate={{ latitude: destinationCoordinate.latitude, longitude: destinationCoordinate.longitude }}
              zIndex={18}
              tracksViewChanges={false}
              pinColor={undefined}
            >
              <>
                <View style={styles.destinationMarkerWrap}>
                  {destinationMarkerMode === 'avatar' ? (
                    <MapAvatarMarker
                      letter={destinationMarkerLetter}
                      tone="passenger"
                    />
                  ) : (
                    <View style={styles.destinationAvatar}>
                      <Ionicons name="business-outline" size={16} color="#667180" />
                    </View>
                  )}
                </View>

                {showMarkerCallouts ? (
                  <View style={styles.calloutBubble}>
                    <Text style={styles.calloutTitle}>{destinationLabel || 'Chegada'}</Text>
                    <Text style={styles.calloutAddress}>{destinationAddress || 'Endereço de destino'}</Text>
                  </View>
                ) : null}
              </>
            </Marker>
          ) : null}

          {hasDriverCoordinate ? (
            <Marker
              key="driver-marker"
              coordinate={{ latitude: driverCoordinate.latitude, longitude: driverCoordinate.longitude }}
              zIndex={19}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={false}
              pinColor={undefined}
            >
              {driverMarkerMode === 'avatar' ? (
                <MapAvatarMarker letter={driverMarkerLetter} tone="driver" />
              ) : (
                <View style={styles.driverMarker}>
                  <Ionicons name="car-sport" size={16} color="#22303D" />
                </View>
              )}
            </Marker>
          ) : null}

          {!useSimplifiedIosMap && searchingMode
            ? normalizedNearbyVehicles.map((vehicle, index) => {
                const id = String(vehicle.id || '');
                const isOuterVehicle = id.startsWith('outer');
                const lat = Number(vehicle.coordinate.latitude).toFixed(6);
                const lng = Number(vehicle.coordinate.longitude).toFixed(6);
                return (
                  <Marker
                    key={`nearby-${id || 'vehicle'}-${index}-${lat}-${lng}`}
                    coordinate={{
                      latitude: vehicle.coordinate.latitude,
                      longitude: vehicle.coordinate.longitude
                    }}
                    zIndex={16}
                    anchor={{ x: 0.5, y: 0.5 }}
                    tracksViewChanges={false}
                  >
                    <View style={[styles.nearbyVehicleMarker, isOuterVehicle && styles.nearbyVehicleMarkerOuter]}>
                      <Ionicons name="car-sport-outline" size={13} color="#1D2733" />
                    </View>
                  </Marker>
                );
              })
            : null}

          {!hideUserMarker && Platform.OS !== 'android' ? (
            <Marker
              key="user-marker"
              coordinate={{ latitude: markerCoordinate.latitude, longitude: markerCoordinate.longitude }}
              zIndex={20}
              anchor={{ x: 0.5, y: 0.5 }}
              tracksViewChanges={userMarkerTracksViewChanges}
              pinColor={undefined}
            >
              <>
                <IOSUserMarkerContent
                  rotationDegrees={normalizedUserHeading}
                  avatarSource={resolvedAvatarSource}
                  avatarLetter={userAvatarLetter}
                  onAvatarError={handleAvatarError}
                />

                {showMarkerCallouts ? (
                  <View style={styles.calloutBubble}>
                    <Text style={styles.calloutTitle}>{originLabel || 'Partida'}</Text>
                    <Text style={styles.calloutAddress}>{originAddress || 'Sua localização atual'}</Text>
                  </View>
                ) : null}
              </>
            </Marker>
          ) : null}

            {!useSimplifiedIosMap ? mapChildren : null}
        </MapView>
      </View>

      {!hideUserMarker &&
      shouldRenderProjectedUserOverlay &&
      projectedUserOverlayPoint ? (
        <FloatingUserOverlay
          pointX={projectedUserOverlayPoint.x}
          pointY={projectedUserOverlayPoint.y}
          rotationDegrees={normalizedUserHeading}
          avatarSource={resolvedAvatarSource}
          avatarLetter={userAvatarLetter}
          onAvatarError={handleAvatarError}
        />
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
    backgroundColor: '#E85D04',
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
  userArrowOrbit: {
    position: 'absolute',
    width: 66,
    height: 66,
    alignItems: 'center',
    justifyContent: 'flex-start'
  },
  userArrow: {
    marginTop: -2,
    zIndex: 3
  },
  destinationMarkerWrap: {
    alignItems: 'center'
  },
  destinationAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: color.border.strong,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 7
  },
  driverMarker: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1,
    borderColor: color.border.strong,
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8
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
    backgroundColor: '#1A7F37',
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
  nearbyVehicleMarker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(22,31,43,0.16)',
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6
  },
  nearbyVehicleMarkerOuter: {
    backgroundColor: 'rgba(250,252,255,0.9)',
    borderColor: 'rgba(22,31,43,0.12)'
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
  androidUserArrowOrbit: {
    position: 'absolute',
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'flex-start'
  },
  androidUserOverlayArrow: {
    marginTop: -2,
    zIndex: 3
  },
  calloutBubble: {
    maxWidth: 208,
    borderRadius: 14,
    paddingVertical: 7,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
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
