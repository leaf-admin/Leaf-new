import React, { useEffect, useMemo, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Callout, Circle, Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import mapStyleAppleLike from './mapStyleAppleLike';
import robotaxiPrototypeTokens from '../design-system/robotaxiPrototypeTokens';

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

export default function PrototypeMapLayer({
  mapRef,
  region,
  userCoordinate,
  userHeading = 0,
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
  children
}) {
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
  const userArrowRotationStyle = useMemo(() => {
    return {
      transform: [{ rotate: `${normalizedUserHeading}deg` }]
    };
  }, [normalizedUserHeading]);
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
        onLayout={onMapLayout}
        provider={PROVIDER_GOOGLE}
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
        {searchingMode && hasSearchCenter && hasSearchRadius ? (
          <>
            {isExpandedSearchStage ? (
              <Circle
                center={searchCenterCoordinate}
                radius={2500}
                strokeWidth={1}
                strokeColor="rgba(54,65,78,0.22)"
                fillColor="rgba(54,65,78,0.06)"
              />
            ) : null}
            <Circle
              center={searchCenterCoordinate}
              radius={searchRadiusMeters}
              strokeWidth={1.2}
              strokeColor="rgba(17,26,39,0.28)"
              fillColor="rgba(17,26,39,0.08)"
            />
          </>
        ) : null}

        {hasRoute && animatedRouteCoordinates.length >= 2 ? (
          <>
            <Polyline
              coordinates={animatedRouteCoordinates}
              strokeColor="rgba(26,51,14,0.26)"
              strokeWidth={8}
              lineCap="round"
              lineJoin="round"
            />
            <Polyline
              coordinates={animatedRouteCoordinates}
              strokeColor={color.accent.primary}
              strokeWidth={5}
              lineCap="round"
              lineJoin="round"
            />
          </>
        ) : null}

        {hasDestination ? (
          <Marker
            coordinate={{ latitude: destinationCoordinate.latitude, longitude: destinationCoordinate.longitude }}
            zIndex={18}
          >
            <View style={styles.destinationMarkerWrap}>
              <View style={styles.destinationAvatar}>
                <Ionicons name="business-outline" size={16} color="#667180" />
              </View>
            </View>

            <Callout tooltip>
              <View style={styles.calloutBubble}>
                <Text style={styles.calloutTitle}>{destinationLabel || 'Destino'}</Text>
                <Text style={styles.calloutAddress}>{destinationAddress || 'Endereço de destino'}</Text>
              </View>
            </Callout>
          </Marker>
        ) : null}

        {hasDriverCoordinate ? (
          <Marker
            coordinate={{ latitude: driverCoordinate.latitude, longitude: driverCoordinate.longitude }}
            zIndex={19}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.driverMarker}>
              <Ionicons name="car-sport" size={16} color="#22303D" />
            </View>

            <Callout tooltip>
              <View style={styles.calloutBubble}>
                <Text style={styles.calloutTitle}>Motorista</Text>
                <Text style={styles.calloutAddress}>Localização em tempo real</Text>
              </View>
            </Callout>
          </Marker>
        ) : null}

        {searchingMode
          ? normalizedNearbyVehicles.map(vehicle => {
              const id = String(vehicle.id || '');
              const isOuterVehicle = id.startsWith('outer');
              return (
                <Marker
                  key={id || `${vehicle.coordinate.latitude}-${vehicle.coordinate.longitude}`}
                  coordinate={{
                    latitude: vehicle.coordinate.latitude,
                    longitude: vehicle.coordinate.longitude
                  }}
                  zIndex={16}
                  anchor={{ x: 0.5, y: 0.5 }}
                >
                  <View style={[styles.nearbyVehicleMarker, isOuterVehicle && styles.nearbyVehicleMarkerOuter]}>
                    <Ionicons name="car-sport-outline" size={13} color="#1D2733" />
                  </View>
                </Marker>
              );
            })
          : null}

        <Marker
          coordinate={{ latitude: markerCoordinate.latitude, longitude: markerCoordinate.longitude }}
          zIndex={20}
        >
          <View style={styles.userMarkerWrap}>
            <Ionicons
              name="caret-up"
              size={14}
              color={color.accent.primary}
              style={[styles.userArrow, userArrowRotationStyle]}
            />
            <View style={styles.avatarOuter}>
              <Image source={{ uri: 'https://i.pravatar.cc/96?img=47' }} style={styles.avatarImage} />
            </View>
          </View>

          <Callout tooltip>
            <View style={styles.calloutBubble}>
              <Text style={styles.calloutTitle}>Você está aqui</Text>
              <Text style={styles.calloutAddress}>1540 Mission St, San Francisco</Text>
            </View>
          </Callout>
        </Marker>
      </MapView>

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  mapArea: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: color.bg.map
  },
  userMarkerWrap: {
    alignItems: 'center'
  },
  userArrow: {
    marginBottom: -2
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
  avatarOuter: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 0,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.shadow.base,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 9
  },
  avatarImage: {
    width: 42,
    height: 42,
    borderRadius: 21
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
