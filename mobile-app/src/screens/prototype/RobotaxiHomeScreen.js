import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useNavigationState } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeMapLayer from '../../components/prototype/PrototypeMapLayer';
import { PrototypeBottomIsland, PrototypeTopControls } from '../../components/prototype/PrototypeScaffold';
import { CardHandle, DestinationInput, PrototypeCard } from '../../components/prototype/PrototypeUI';
import { PROTOTYPE_REGION } from './robotaxiPrototypeData';
import { subscribePrototypeMapOcclusion, usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { clearPrototypeMapRoute, subscribePrototypeMapRoute } from './prototypeMapRoute';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';

const { color } = robotaxiPrototypeTokens;
const HOME_CARD_BOTTOM_OFFSET = 102;
const HOME_CARD_FALLBACK_HEIGHT = 96;
const MAP_MIN_VISIBLE_HEIGHT = 180;
const OVERLAY_ZOOM_OUT_GAIN = 0.42;
const MAX_OVERLAY_ZOOM_OUT_RATIO = 0.62;
const DEFAULT_USER_COORDINATE = {
  latitude: PROTOTYPE_REGION.latitude,
  longitude: PROTOTYPE_REGION.longitude
};
const ROUTE_SIDE_PADDING = 72;
const ROUTE_TOP_EXTRA_PADDING = 22;
const ROUTE_BOTTOM_EXTRA_PADDING = 28;
const SEARCH_RADIUS_STAGE_SWITCH_SECONDS = 8;
const SEARCH_RADIUS_NEAR_KM = 2.5;
const SEARCH_RADIUS_FAR_KM = 5;
const SEARCH_NEARBY_INNER_COUNT = 8;
const SEARCH_NEARBY_TOTAL_COUNT = 16;
const SEARCH_ZOOM_ANIMATION_MS = 1150;
const SEARCH_RADIUS_MARGIN = 1.34;
const MAP_OCCLUSION_REPOSITION_MS = 760;
const MAP_RETURN_REPOSITION_MS = 820;

function seededUnit(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function offsetCoordinateByDistance(center, distanceKm, bearingDegrees) {
  const earthRadiusKm = 6371;
  const angularDistance = distanceKm / earthRadiusKm;
  const bearingRad = (bearingDegrees * Math.PI) / 180;
  const latRad = (center.latitude * Math.PI) / 180;
  const lonRad = (center.longitude * Math.PI) / 180;

  const nextLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
  );
  const nextLonRad =
    lonRad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(nextLatRad)
    );

  return {
    latitude: (nextLatRad * 180) / Math.PI,
    longitude: (nextLonRad * 180) / Math.PI
  };
}

function buildNearbyVehicleCoordinates(center, { minDistanceKm, maxDistanceKm, count, seedBase, prefix }) {
  return Array.from({ length: count }).map((_, index) => {
    const seed = seedBase + index + 1;
    const bearing = seededUnit(seed * 3.31) * 360;
    const distance = minDistanceKm + seededUnit(seed * 7.17) * (maxDistanceKm - minDistanceKm);

    return {
      id: `${prefix}-${index + 1}`,
      coordinate: offsetCoordinateByDistance(center, distance, bearing)
    };
  });
}

function buildSearchRegion(center, radiusKm) {
  const latitudeDelta = Math.max(0.015, ((radiusKm * 2) / 111) * SEARCH_RADIUS_MARGIN);
  const latitudeCosine = Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.28);

  return {
    latitude: center.latitude,
    longitude: center.longitude,
    latitudeDelta,
    longitudeDelta: latitudeDelta / latitudeCosine
  };
}

export default function RobotaxiHomeScreen({ navigation, route }) {
  const {
    currentCoordinate,
    currentHeading,
    driverCoordinate,
    trafficLayerEnabled,
    clearFlowPreview,
    bookingStatus,
    searchingElapsedSeconds,
    unreadNotificationCount
  } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const currentRouteName = useNavigationState(state => state.routes[state.index]?.name || 'RobotaxiPrototype');
  const mapRef = useRef(null);
  const lastRouteLayoutKeyRef = useRef('');
  const wasSearchingRef = useRef(false);
  const lastSearchRadiusRef = useRef(null);
  const [homeCardHeight, setHomeCardHeight] = useState(HOME_CARD_FALLBACK_HEIGHT);
  const [mapHeight, setMapHeight] = useState(windowHeight);
  const [activeOcclusion, setActiveOcclusion] = useState({ top: 0, bottom: 0 });
  const [activeRoute, setActiveRoute] = useState({ coordinates: [], destination: null, destinationLabel: '', destinationAddress: '' });
  const [nearbyDriverCoordinates, setNearbyDriverCoordinates] = useState([]);
  const [destination] = useState('Para onde?');

  const isHomeRoute = currentRouteName === 'RobotaxiPrototype';
  const isProfileRoute =
    currentRouteName === 'RobotaxiPrototypeProfile' ||
    currentRouteName === 'RobotaxiPrototypeMenu' ||
    currentRouteName === 'RobotaxiMenuEditProfile' ||
    currentRouteName === 'RobotaxiMenuTripHistory' ||
    currentRouteName === 'RobotaxiMenuMessages' ||
    currentRouteName === 'RobotaxiMenuHelp';
  const isSettingsRoute = currentRouteName === 'RobotaxiPrototypeSettings';
  const isDriverRoute =
    currentRouteName === 'RobotaxiPrototypeDriverPanel' ||
    currentRouteName === 'RobotaxiPrototypeDriverActivation' ||
    currentRouteName === 'RobotaxiPrototypeDriverOffer' ||
    currentRouteName === 'RobotaxiPrototypeDriverTrip' ||
    currentRouteName === 'RobotaxiPrototypeDriverSearch';
  const hasMenuTopAction = isHomeRoute || isDriverRoute;

  const activeTab = isSettingsRoute ? 'settings' : isProfileRoute ? 'profile' : 'home';
  const hasActiveRoute = Array.isArray(activeRoute.coordinates) && activeRoute.coordinates.length >= 2;
  const isSearchingMode = bookingStatus === 'searching' || bookingStatus === 'requesting';
  const searchRadiusKm = useMemo(() => {
    if (!isSearchingMode) {
      return null;
    }

    return searchingElapsedSeconds >= SEARCH_RADIUS_STAGE_SWITCH_SECONDS ? SEARCH_RADIUS_FAR_KM : SEARCH_RADIUS_NEAR_KM;
  }, [isSearchingMode, searchingElapsedSeconds]);
  const searchCenterCoordinate = currentCoordinate || DEFAULT_USER_COORDINATE;
  const searchRegion = useMemo(() => {
    if (!isSearchingMode || !searchRadiusKm) {
      return null;
    }

    return buildSearchRegion(searchCenterCoordinate, searchRadiusKm);
  }, [isSearchingMode, searchCenterCoordinate, searchRadiusKm]);
  const routeSignature = useMemo(() => {
    if (!hasActiveRoute) {
      return '';
    }

    return activeRoute.coordinates
      .map(point => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`)
      .join('|');
  }, [activeRoute.coordinates, hasActiveRoute]);
  const routeLayoutKey = useMemo(() => {
    if (!hasActiveRoute) {
      return '';
    }

    return `${routeSignature}|${Math.round(activeOcclusion.top)}|${Math.round(activeOcclusion.bottom)}|${Math.round(mapHeight)}`;
  }, [activeOcclusion.bottom, activeOcclusion.top, hasActiveRoute, mapHeight, routeSignature]);
  const homeOccludedBottom = isHomeRoute ? insets.bottom + HOME_CARD_BOTTOM_OFFSET + homeCardHeight : 0;
  const baselineOccludedBottom = insets.bottom + HOME_CARD_BOTTOM_OFFSET + homeCardHeight;

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-home',
    occludedBottom: homeOccludedBottom
  });

  useEffect(() => {
    const unsubscribe = subscribePrototypeMapOcclusion(next => {
      setActiveOcclusion(next);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribePrototypeMapRoute(next => {
      setActiveRoute(next);
    });

    return unsubscribe;
  }, []);

  const targetRegion = useMemo(() => {
    const baseCoordinate = currentCoordinate || DEFAULT_USER_COORDINATE;
    const effectiveHeight = Math.max(1, mapHeight || windowHeight);
    const maxTop = Math.max(0, effectiveHeight - MAP_MIN_VISIBLE_HEIGHT);
    const topInset = Math.min(Math.max(0, activeOcclusion.top || 0), maxTop);
    const maxBottom = Math.max(0, effectiveHeight - MAP_MIN_VISIBLE_HEIGHT - topInset);
    const bottomInset = Math.min(Math.max(0, activeOcclusion.bottom || 0), maxBottom);
    const availableHeight = Math.max(MAP_MIN_VISIBLE_HEIGHT, effectiveHeight - topInset - bottomInset);
    const desiredMarkerY = topInset + availableHeight / 2;
    const baseCenterY = effectiveHeight / 2;
    const pixelOffsetY = desiredMarkerY - baseCenterY;
    const extraBottomOcclusion = Math.max(0, bottomInset - baselineOccludedBottom);
    const extraOcclusionRatio = Math.min(MAX_OVERLAY_ZOOM_OUT_RATIO, (extraBottomOcclusion + topInset) / effectiveHeight);
    const zoomOutFactor = 1 + extraOcclusionRatio * OVERLAY_ZOOM_OUT_GAIN;
    const latitudeDelta = PROTOTYPE_REGION.latitudeDelta * zoomOutFactor;
    const longitudeDelta = PROTOTYPE_REGION.longitudeDelta * zoomOutFactor;
    const latitudeOffset = (latitudeDelta * pixelOffsetY) / effectiveHeight;

    return {
      ...PROTOTYPE_REGION,
      latitude: baseCoordinate.latitude + latitudeOffset,
      longitude: baseCoordinate.longitude,
      latitudeDelta,
      longitudeDelta
    };
  }, [activeOcclusion.bottom, activeOcclusion.top, baselineOccludedBottom, currentCoordinate, mapHeight, windowHeight]);

  const getRouteEdgePadding = useCallback(() => {
    const routeAreaTop = Math.max(insets.top + 12, activeOcclusion.top + 12);
    const routeAreaBottom = Math.max(routeAreaTop + 140, mapHeight - Math.max(insets.bottom + 12, activeOcclusion.bottom));
    const routeAreaHeight = Math.max(140, routeAreaBottom - routeAreaTop);

    const topPadding = Math.round(routeAreaTop + routeAreaHeight * 0.08) + ROUTE_TOP_EXTRA_PADDING;
    const baseBottomPadding = Math.max(insets.bottom + 12, mapHeight - routeAreaBottom + 12);
    const upperAreaBias = Math.round(routeAreaHeight * 0.28);
    const maxBottomPadding = Math.max(baseBottomPadding, mapHeight - topPadding - 84);
    const bottomPadding = Math.min(maxBottomPadding, baseBottomPadding + upperAreaBias + ROUTE_BOTTOM_EXTRA_PADDING);

    return {
      top: topPadding,
      right: ROUTE_SIDE_PADDING,
      left: ROUTE_SIDE_PADDING,
      bottom: bottomPadding
    };
  }, [activeOcclusion.bottom, activeOcclusion.top, insets.bottom, insets.top, mapHeight]);

  const focusRoute = useCallback((coordinates, animatedFit = true) => {
    if (!mapRef.current || !Array.isArray(coordinates) || coordinates.length < 2) {
      return;
    }

    const edgePadding = getRouteEdgePadding();
    mapRef.current.animateCamera({ heading: 0, pitch: 0 }, { duration: animatedFit ? 220 : 0 });
    mapRef.current.fitToCoordinates(coordinates, {
      edgePadding,
      animated: animatedFit
    });
  }, [getRouteEdgePadding]);

  useEffect(() => {
    if (!mapRef.current || !hasActiveRoute || !routeLayoutKey || isSearchingMode) {
      return;
    }

    if (lastRouteLayoutKeyRef.current === routeLayoutKey) {
      return;
    }

    lastRouteLayoutKeyRef.current = routeLayoutKey;
    focusRoute(activeRoute.coordinates, true);
  }, [activeRoute.coordinates, focusRoute, hasActiveRoute, isSearchingMode, routeLayoutKey]);

  useEffect(() => {
    if (!mapRef.current || hasActiveRoute || isSearchingMode) {
      return;
    }

    lastRouteLayoutKeyRef.current = '';
    mapRef.current.animateToRegion(targetRegion, MAP_OCCLUSION_REPOSITION_MS);
  }, [hasActiveRoute, isSearchingMode, targetRegion]);

  useEffect(() => {
    if (!isSearchingMode) {
      setNearbyDriverCoordinates([]);
      return;
    }

    const baseInnerVehicles = buildNearbyVehicleCoordinates(searchCenterCoordinate, {
      minDistanceKm: 0.42,
      maxDistanceKm: SEARCH_RADIUS_NEAR_KM * 0.98,
      count: SEARCH_NEARBY_INNER_COUNT,
      seedBase: 21,
      prefix: 'inner'
    });

    if (searchRadiusKm === SEARCH_RADIUS_NEAR_KM) {
      setNearbyDriverCoordinates(baseInnerVehicles);
      return;
    }

    const outerVehicles = buildNearbyVehicleCoordinates(searchCenterCoordinate, {
      minDistanceKm: SEARCH_RADIUS_NEAR_KM + 0.16,
      maxDistanceKm: SEARCH_RADIUS_FAR_KM * 0.98,
      count: SEARCH_NEARBY_TOTAL_COUNT - SEARCH_NEARBY_INNER_COUNT,
      seedBase: 77,
      prefix: 'outer'
    });

    setNearbyDriverCoordinates([...baseInnerVehicles, ...outerVehicles]);
  }, [isSearchingMode, searchCenterCoordinate, searchRadiusKm]);

  useEffect(() => {
    if (!mapRef.current || !isSearchingMode || !searchRegion) {
      return;
    }

    const changedRadius = lastSearchRadiusRef.current !== searchRadiusKm;
    const duration = changedRadius ? SEARCH_ZOOM_ANIMATION_MS : 360;
    lastSearchRadiusRef.current = searchRadiusKm;

    mapRef.current.animateCamera(
      {
        center: {
          latitude: searchCenterCoordinate.latitude,
          longitude: searchCenterCoordinate.longitude
        },
        heading: 0,
        pitch: 0
      },
      { duration }
    );
    mapRef.current.animateToRegion(searchRegion, duration);
  }, [isSearchingMode, searchCenterCoordinate, searchRadiusKm, searchRegion]);

  useEffect(() => {
    if (isSearchingMode) {
      wasSearchingRef.current = true;
      return;
    }

    if (!wasSearchingRef.current || !mapRef.current) {
      return;
    }

    wasSearchingRef.current = false;
    lastSearchRadiusRef.current = null;

    if (hasActiveRoute) {
      lastRouteLayoutKeyRef.current = routeLayoutKey;
      focusRoute(activeRoute.coordinates, true);
      return;
    }

    lastRouteLayoutKeyRef.current = '';
    mapRef.current.animateToRegion(targetRegion, MAP_RETURN_REPOSITION_MS);
  }, [activeRoute.coordinates, focusRoute, hasActiveRoute, isSearchingMode, routeLayoutKey, targetRegion]);

  const handleCenterMap = useCallback(() => {
    if (mapRef.current) {
      if (isSearchingMode && searchRegion) {
        mapRef.current.animateCamera(
          {
            center: {
              latitude: searchCenterCoordinate.latitude,
              longitude: searchCenterCoordinate.longitude
            },
            heading: 0,
            pitch: 0
          },
          { duration: SEARCH_ZOOM_ANIMATION_MS }
        );
        mapRef.current.animateToRegion(searchRegion, SEARCH_ZOOM_ANIMATION_MS);
        return;
      }

      if (hasActiveRoute) {
        lastRouteLayoutKeyRef.current = routeLayoutKey;
        focusRoute(activeRoute.coordinates, true);
        return;
      }
      lastRouteLayoutKeyRef.current = '';
      mapRef.current.animateToRegion(targetRegion, MAP_OCCLUSION_REPOSITION_MS);
    }
  }, [activeRoute.coordinates, focusRoute, hasActiveRoute, isSearchingMode, routeLayoutKey, searchCenterCoordinate, searchRegion, targetRegion]);

  const handleMapLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setMapHeight(nextHeight);
    }
  }, []);

  const handleSearchCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setHomeCardHeight(nextHeight);
    }
  }, []);

  const handleTopLeftPress = () => {
    if (isHomeRoute) {
      handleCenterMap();
      return;
    }

    if (currentRouteName === 'RobotaxiPrototypeDestination') {
      clearPrototypeMapRoute();
      clearFlowPreview();
    }

    if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  const handleTopRightPress = () => {
    if (hasMenuTopAction) {
      navigation.navigate('RobotaxiPrototypeMenu');
      return;
    }

    handleCenterMap();
  };

  const handleBottomHomePress = () => {
    if (isHomeRoute) {
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  return (
    <PrototypeScreenTransition>
      <View style={styles.container}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeMapLayer
          mapRef={mapRef}
          region={targetRegion}
          userCoordinate={currentCoordinate || DEFAULT_USER_COORDINATE}
          userHeading={currentHeading}
          driverCoordinate={driverCoordinate}
          showTraffic={trafficLayerEnabled}
          searchingMode={isSearchingMode}
          searchCenterCoordinate={isSearchingMode ? searchCenterCoordinate : null}
          searchRadiusKm={isSearchingMode ? searchRadiusKm : null}
          nearbyVehicles={isSearchingMode ? nearbyDriverCoordinates : []}
          routeCoordinates={activeRoute.coordinates}
          destinationCoordinate={activeRoute.destination}
          destinationLabel={activeRoute.destinationLabel}
          destinationAddress={activeRoute.destinationAddress}
          onMapLayout={handleMapLayout}
        />

        <PrototypeTopControls
          insets={insets}
          leftIcon={isHomeRoute ? 'locate' : 'arrow-back'}
          rightIcon={hasMenuTopAction ? 'menu' : 'locate'}
          showRightBadge={hasMenuTopAction && unreadNotificationCount > 0}
          onPressLeft={handleTopLeftPress}
          onPressRight={handleTopRightPress}
        />

        {isHomeRoute ? (
          <>
            <PrototypeCard
              onLayout={handleSearchCardLayout}
              style={[styles.searchCard, { bottom: insets.bottom + HOME_CARD_BOTTOM_OFFSET }]}
            >
              <CardHandle />
              <DestinationInput value={destination} editable={false} onPress={() => navigation.navigate('RobotaxiPrototypeDestination')} />
            </PrototypeCard>
          </>
        ) : null}

        <PrototypeBottomIsland
          insets={insets}
          active={activeTab}
          onPressHome={handleBottomHomePress}
          onPressProfile={() => navigation.navigate('RobotaxiPrototypeProfile')}
          onPressSettings={() => navigation.navigate('RobotaxiPrototypeSettings')}
        />
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.bg.map
  },
  searchCard: {
    position: 'absolute',
    left: 10,
    right: 10,
    zIndex: 16,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12
  }
});
