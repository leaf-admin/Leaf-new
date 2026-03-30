import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import mapStyleAppleLike from './mapStyleAppleLike';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';
import profilePic from '../../../assets/images/profilePic.png';

const { color, motion } = robotaxiPrototypeTokens;
const ROUTE_ANIMATION_DURATION = motion.timing.map;
const POINTS_PER_SEGMENT = 18;
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
  onAvatarError
}) {
  return (
    <View style={styles.userMarkerWrap} collapsable={false}>
      <View style={[styles.userArrowOrbit, { transform: [{ rotate: `${rotationDegrees}deg` }] }]} pointerEvents="none">
        <Ionicons name="caret-up" size={14} color={color.accent.primary} style={styles.userArrow} />
      </View>
      <Image
        source={avatarSource}
        defaultSource={profilePic}
        style={styles.avatarImage}
        resizeMode="cover"
        fadeDuration={0}
        onError={onAvatarError}
      />
    </View>
  );
});

const AndroidUserOverlay = React.memo(function AndroidUserOverlay({
  pointX,
  pointY,
  rotationDegrees,
  avatarSource,
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
        <Image
          source={avatarSource}
          defaultSource={profilePic}
          style={styles.androidUserOverlayAvatar}
          resizeMode="cover"
          fadeDuration={0}
          onError={onAvatarError}
        />
      </View>
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
  nearbyVehicles = [],
  routeCoordinates,
  destinationCoordinate,
  destinationLabel,
  destinationAddress,
  onMapLayout,
  onMapPanDrag,
  onRegionChangeComplete,
  mapChildren,
  children
}) {
  const iosMapSafeMode = __DEV__ && Platform.OS === 'ios';
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
  const searchRadiusMeters = hasSearchRadius ? Math.round(searchRadiusKm * 1000) : 0;
  const isExpandedSearchStage = hasSearchRadius && searchRadiusKm >= 4.9;
  const normalizedUserHeading = useMemo(() => {
    const heading = Number(userHeading);
    if (!Number.isFinite(heading)) {
      return 0;
    }

    const normalized = heading % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }, [userHeading]);
  const hasRoute = Array.isArray(routeCoordinates) && routeCoordinates.length >= 2;
  const hasDestination = Boolean(destinationCoordinate) && Number.isFinite(destinationCoordinate?.latitude) && Number.isFinite(destinationCoordinate?.longitude);
  const denseRoute = useMemo(() => densifyPath(routeCoordinates), [routeCoordinates]);
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
    return shouldRenderAvatarImage ? { uri: normalizedAvatarUri } : profilePic;
  }, [normalizedAvatarUri, shouldRenderAvatarImage]);
  const userMarkerTracksViewChanges = Platform.OS === 'android';
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

  const androidUserOverlayPoint = useMemo(() => {
    const projectionRegion = androidVisibleRegion || region;
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

    if (Platform.OS !== 'android' || !hasLayout) {
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

      return {
      x: Math.min(Math.max(x, 28), resolvedWidth - 28),
      y: Math.min(Math.max(y, 28), maxVisibleY)
    };
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
    windowLayout.height,
    windowLayout.width
  ]);

  useEffect(() => {
    if (!hasRoute || denseRoute.length < 2) {
      setAnimatedRouteCoordinates([]);
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
  }, [denseRoute, hasRoute]);

  return (
    <View style={styles.mapArea}>
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
        onPanDrag={onMapPanDrag}
        onLayout={event => {
          onMapLayout?.(event);
          const width = event?.nativeEvent?.layout?.width;
          const height = event?.nativeEvent?.layout?.height;
          if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            setAndroidMapLayout({ width, height });
          }
        }}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
        mapType="standard"
        customMapStyle={mapStyleAppleLike}
        rotateEnabled
        pitchEnabled={false}
        toolbarEnabled={false}
        showsCompass={false}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsTraffic={Boolean(showTraffic)}
      >
        {!iosMapSafeMode && searchingMode && hasSearchCenter && hasSearchRadius && isExpandedSearchStage ? (
          <Circle
            key="search-radius-outer"
            center={searchCenterCoordinate}
            radius={2500}
            strokeWidth={1}
            strokeColor="rgba(54,65,78,0.22)"
            fillColor="rgba(54,65,78,0.06)"
          />
        ) : null}

        {!iosMapSafeMode && searchingMode && hasSearchCenter && hasSearchRadius ? (
          <Circle
            key="search-radius-current"
            center={searchCenterCoordinate}
            radius={searchRadiusMeters}
            strokeWidth={1.2}
            strokeColor="rgba(17,26,39,0.28)"
            fillColor="rgba(17,26,39,0.08)"
          />
        ) : null}

        {!iosMapSafeMode && hasRoute && animatedRouteCoordinates.length >= 2 ? (
          <Polyline
            key="route-shadow"
            coordinates={animatedRouteCoordinates}
            strokeColor="rgba(26,51,14,0.26)"
            strokeWidth={8}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}

        {!iosMapSafeMode && hasRoute && animatedRouteCoordinates.length >= 2 ? (
          <Polyline
            key="route-main"
            coordinates={animatedRouteCoordinates}
            strokeColor={color.accent.primary}
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
          />
        ) : null}

        {!iosMapSafeMode && hasDestination ? (
          <Marker
            key="destination-marker"
            coordinate={{ latitude: destinationCoordinate.latitude, longitude: destinationCoordinate.longitude }}
            zIndex={18}
            tracksViewChanges={false}
          >
            <View style={styles.destinationMarkerWrap}>
              <View style={styles.destinationAvatar}>
                <Ionicons name="business-outline" size={16} color="#667180" />
              </View>
            </View>

            {showMarkerCallouts ? (
              <View style={styles.calloutBubble}>
                <Text style={styles.calloutTitle}>{destinationLabel || 'Destino'}</Text>
                <Text style={styles.calloutAddress}>{destinationAddress || 'Endereço de destino'}</Text>
              </View>
            ) : null}
          </Marker>
        ) : null}

        {!iosMapSafeMode && hasDriverCoordinate ? (
          <Marker
            key="driver-marker"
            coordinate={{ latitude: driverCoordinate.latitude, longitude: driverCoordinate.longitude }}
            zIndex={19}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <View style={styles.driverMarker}>
              <Ionicons name="car-sport" size={16} color="#22303D" />
            </View>
          </Marker>
        ) : null}

        {!iosMapSafeMode && searchingMode
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

        {Platform.OS !== 'android' ? (
          <Marker
            key="user-marker"
            coordinate={{ latitude: markerCoordinate.latitude, longitude: markerCoordinate.longitude }}
            zIndex={20}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={userMarkerTracksViewChanges}
          >
            <IOSUserMarkerContent
              rotationDegrees={normalizedUserHeading}
              avatarSource={resolvedAvatarSource}
              onAvatarError={handleAvatarError}
            />

            {showMarkerCallouts ? (
              <View style={styles.calloutBubble}>
                <Text style={styles.calloutTitle}>Você está aqui</Text>
                <Text style={styles.calloutAddress}>1540 Mission St, San Francisco</Text>
              </View>
            ) : null}
          </Marker>
        ) : null}

        {!iosMapSafeMode ? mapChildren : null}
      </MapView>

      {Platform.OS === 'android' && androidUserOverlayPoint ? (
        <AndroidUserOverlay
          pointX={androidUserOverlayPoint.x}
          pointY={androidUserOverlayPoint.y}
          rotationDegrees={normalizedUserHeading}
          avatarSource={resolvedAvatarSource}
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
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.96)'
  },
  androidUserOverlayLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    elevation: 30
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
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.96)'
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
    maxWidth: 220,
    borderRadius: 14,
    paddingVertical: 8,
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
  }
});
