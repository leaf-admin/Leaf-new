import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useNavigationState } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Polygon } from 'react-native-maps';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeMapLayer from '../../components/prototype/PrototypeMapLayer';
import { PrototypeBottomIsland, PrototypeTopControls } from '../../components/prototype/PrototypeScaffold';
import PassengerHomeOverlay from './home/PassengerHomeOverlay';
import DriverHomeOverlay from './home/DriverHomeOverlay';
import DriverLiveRideOverlay from './home/DriverLiveRideOverlay';
import DriverTripStatusBanner from './home/DriverTripStatusBanner';
import { PROTOTYPE_REGION } from './robotaxiPrototypeData';
import { subscribePrototypeMapOcclusion, usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { clearPrototypeMapRoute, subscribePrototypeMapRoute } from './prototypeMapRoute';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { openDriverExternalNavigation } from '../../services/DriverExternalNavigationService';
import { fetchH3CellsForRegion } from '../../services/runtime/h3MapService';
import WebSocketManager from '../../services/WebSocketManager';

const { color } = robotaxiPrototypeTokens;
const HOME_CARD_BOTTOM_OFFSET = 102;
const HOME_CARD_FALLBACK_HEIGHT = 96;
const DRIVER_BOTTOM_CTA_OFFSET = 112;
const DRIVER_BOTTOM_CTA_FALLBACK_HEIGHT = 56;
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
const DRIVER_H3_VIEWPORT_DEBOUNCE_MS = 420;
const DRIVER_H3_SOCKET_REFRESH_DEBOUNCE_MS = 900;

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

function normalizeHomeRole(rawRole) {
  const normalized = String(rawRole || '')
    .trim()
    .toLowerCase();

  if (['driver', 'motorista', 'partner', 'parceiro'].includes(normalized)) {
    return 'driver';
  }

  if (['customer', 'passenger', 'rider', 'cliente'].includes(normalized)) {
    return 'customer';
  }

  return null;
}

function resolveProfileInitial(profile = {}) {
  const nameCandidate =
    profile?.name ||
    profile?.fullName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim() ||
    '';
  return String(nameCandidate || 'L').trim().charAt(0).toUpperCase() || 'L';
}

function hexToRgba(hexColor, opacity = 1) {
  const normalized = String(hexColor || '').replace('#', '').trim();
  const expanded = normalized.length === 3
    ? normalized.split('').map((char) => `${char}${char}`).join('')
    : normalized;

  if (expanded.length !== 6) {
    return `rgba(34, 197, 94, ${opacity})`;
  }

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${opacity})`;
}

export default function RobotaxiHomeScreen({ navigation, route }) {
  const {
    activeRole,
    profile,
    currentCoordinate,
    currentHeading,
    driverCoordinate,
    trafficLayerEnabled,
    clearFlowPreview,
    bookingStatus,
    tripDistanceKm,
    searchingElapsedSeconds,
    unreadNotificationCount,
    driverOnline,
    driverCanGoOnline,
    paymentMethod,
    setDriverOnline,
    tripHistory,
    driverOffers,
    driverActiveRide,
    driverExtensionRequest,
    driverTripAssist,
    acceptDriverOffer,
    rejectDriverOffer,
    respondToDriverExtension,
    interruptRideOperationalFlow,
    markDriverArrived,
    startTripFlow,
    completeTripFlow
  } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const currentRouteName = useNavigationState(state => state.routes[state.index]?.name || 'RobotaxiPrototype');
  const mapRef = useRef(null);
  const lastRouteLayoutKeyRef = useRef('');
  const wasSearchingRef = useRef(false);
  const lastSearchRadiusRef = useRef(null);
  const lastAutoNavigationPhaseRef = useRef('');
  const [homeCardHeight, setHomeCardHeight] = useState(HOME_CARD_FALLBACK_HEIGHT);
  const [driverBottomCtaHeight, setDriverBottomCtaHeight] = useState(DRIVER_BOTTOM_CTA_FALLBACK_HEIGHT);
  const [driverLiveRideHeight, setDriverLiveRideHeight] = useState(0);
  const [mapHeight, setMapHeight] = useState(windowHeight);
  const [activeOcclusion, setActiveOcclusion] = useState({ top: 0, bottom: 0 });
  const [activeRoute, setActiveRoute] = useState({ coordinates: [], destination: null, destinationLabel: '', destinationAddress: '' });
  const [nearbyDriverCoordinates, setNearbyDriverCoordinates] = useState([]);
  const [mapFollowingUser, setMapFollowingUser] = useState(true);
  const [visibleMapRegion, setVisibleMapRegion] = useState(PROTOTYPE_REGION);
  const [driverH3Cells, setDriverH3Cells] = useState([]);
  const [driverH3RefreshNonce, setDriverH3RefreshNonce] = useState(0);
  const driverH3RefreshTimerRef = useRef(null);
  const [destination] = useState('Para onde vamos?');
  const resolvedRole =
    normalizeHomeRole(activeRole) ||
    normalizeHomeRole(
      profile?.usertype ??
        profile?.userType ??
        profile?.role ??
        profile?.user_role ??
        profile?.accountType
    ) ||
    'customer';
  const isDriverRole = resolvedRole === 'driver';
  const profileImage = String(
    profile?.profile_image ||
      profile?.profileImage ||
      profile?.photo ||
      profile?.photoURL ||
      ''
  ).trim();
  const profileInitial = useMemo(() => resolveProfileInitial(profile), [profile]);

  const isHomeRoute =
    currentRouteName === 'RobotaxiPrototype' ||
    currentRouteName === 'Map' ||
    currentRouteName === 'MapScreen' ||
    currentRouteName === 'TabRoot';
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
  const isDestinationRoute = currentRouteName === 'RobotaxiPrototypeDestination';
  const freezeBackgroundMapCamera = isDestinationRoute;
  const hasMenuTopAction = isDriverRole || isHomeRoute || isDriverRoute;

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
  const passengerOccludedBottom = insets.bottom + HOME_CARD_BOTTOM_OFFSET + homeCardHeight;
  const driverOccludedBottom = insets.bottom + DRIVER_BOTTOM_CTA_OFFSET + driverBottomCtaHeight;
  const driverLiveOffer = Array.isArray(driverOffers) && driverOffers.length > 0 ? driverOffers[0] : null;
  const hasDriverLiveRideOverlay = Boolean(
    isDriverRole &&
      isHomeRoute &&
      ((driverActiveRide?.bookingId || driverActiveRide?.id) || (driverLiveOffer?.bookingId || driverLiveOffer?.id))
  );
  const showDriverHomeOverlay = Boolean(isDriverRole && isHomeRoute && !hasDriverLiveRideOverlay);
  const showDriverH3Overlay = Boolean(isDriverRole && isHomeRoute && showDriverHomeOverlay);
  const driverLiveRideBottomOffset = hasDriverLiveRideOverlay ? 18 : DRIVER_BOTTOM_CTA_OFFSET + driverBottomCtaHeight + 12;
  const driverLiveRideOccludedBottom = insets.bottom + driverLiveRideBottomOffset + driverLiveRideHeight;
  const homeOccludedBottom = isHomeRoute
    ? (isDriverRole
        ? Math.max(showDriverHomeOverlay ? driverOccludedBottom : 0, hasDriverLiveRideOverlay ? driverLiveRideOccludedBottom : 0)
        : passengerOccludedBottom)
    : 0;
  const baselineOccludedBottom = isDriverRole ? driverOccludedBottom : passengerOccludedBottom;
  const todayEarnings = useMemo(() => {
    if (!Array.isArray(tripHistory) || tripHistory.length === 0) {
      return 0;
    }
    return tripHistory.reduce((sum, trip) => sum + Number(trip?.fare || 0), 0);
  }, [tripHistory]);
  const todayTrips = useMemo(() => {
    if (!Array.isArray(tripHistory) || tripHistory.length === 0) {
      return 0;
    }
    return tripHistory.length;
  }, [tripHistory]);
  const formattedDriverEarnings = useMemo(
    () => `R$ ${Number(todayEarnings || 0).toFixed(2).replace('.', ',')}`,
    [todayEarnings]
  );
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

  useEffect(() => {
    if (!showDriverH3Overlay) {
      return;
    }
    setVisibleMapRegion(targetRegion);
  }, [showDriverH3Overlay, targetRegion]);

  const scheduleDriverH3Refresh = useCallback(() => {
    if (!showDriverH3Overlay) {
      return;
    }

    if (driverH3RefreshTimerRef.current) {
      clearTimeout(driverH3RefreshTimerRef.current);
    }

    driverH3RefreshTimerRef.current = setTimeout(() => {
      setDriverH3RefreshNonce((current) => current + 1);
      driverH3RefreshTimerRef.current = null;
    }, DRIVER_H3_SOCKET_REFRESH_DEBOUNCE_MS);
  }, [showDriverH3Overlay]);

  useEffect(() => {
    if (!showDriverH3Overlay) {
      return undefined;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetchH3CellsForRegion(visibleMapRegion || targetRegion, {
          surface: 'driver',
          signal: controller.signal
        });

        if (controller.signal.aborted) {
          return;
        }

        setDriverH3Cells(Array.isArray(response?.cells) ? response.cells : []);
      } catch (_error) {
        if (!controller.signal.aborted) {
          setDriverH3Cells([]);
        }
      }
    }, DRIVER_H3_VIEWPORT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [driverH3RefreshNonce, showDriverH3Overlay, targetRegion, visibleMapRegion]);

  useEffect(() => {
    return () => {
      if (driverH3RefreshTimerRef.current) {
        clearTimeout(driverH3RefreshTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!showDriverH3Overlay) {
      return undefined;
    }

    const socket = WebSocketManager.getInstance();
    const refreshEvents = [
      'connect',
      'reconnect',
      'mapH3Refresh',
      'map_h3_refresh',
      'newRideRequest'
    ];

    const handleRefreshHint = () => {
      scheduleDriverH3Refresh();
    };

    refreshEvents.forEach((eventName) => {
      socket.on(eventName, handleRefreshHint);
    });

    return () => {
      refreshEvents.forEach((eventName) => {
        socket.off(eventName, handleRefreshHint);
      });
    };
  }, [scheduleDriverH3Refresh, showDriverH3Overlay]);

  const driverH3MapChildren = useMemo(() => {
    if (!showDriverH3Overlay || !Array.isArray(driverH3Cells) || driverH3Cells.length === 0) {
      return null;
    }

    return driverH3Cells
      .filter((cell) => Array.isArray(cell?.boundary) && cell.boundary.length >= 6)
      .map((cell) => (
        <Polygon
          key={cell.h3Index}
          coordinates={cell.boundary.map((point) => ({
            latitude: Number(point.lat),
            longitude: Number(point.lng)
          }))}
          strokeWidth={Number(cell?.style?.strokeWidth ?? 1)}
          strokeColor={hexToRgba(cell?.style?.stroke || '#15803D', Number(cell?.style?.strokeOpacity ?? 0.58))}
          fillColor={hexToRgba(cell?.style?.fill || '#22C55E', Number(cell?.style?.fillOpacity ?? 0.18))}
        />
      ));
  }, [driverH3Cells, showDriverH3Overlay]);

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
    if (!mapRef.current || hasActiveRoute || isSearchingMode || freezeBackgroundMapCamera) {
      return;
    }

    if (!mapFollowingUser) {
      return;
    }

    lastRouteLayoutKeyRef.current = '';
    mapRef.current.animateToRegion(targetRegion, MAP_OCCLUSION_REPOSITION_MS);
  }, [freezeBackgroundMapCamera, hasActiveRoute, isSearchingMode, mapFollowingUser, targetRegion]);

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

    if (hasActiveRoute || freezeBackgroundMapCamera) {
      if (!hasActiveRoute) {
        return;
      }
      lastRouteLayoutKeyRef.current = routeLayoutKey;
      focusRoute(activeRoute.coordinates, true);
      return;
    }

    setMapFollowingUser(true);
    lastRouteLayoutKeyRef.current = '';
    mapRef.current.animateToRegion(targetRegion, MAP_RETURN_REPOSITION_MS);
  }, [activeRoute.coordinates, focusRoute, freezeBackgroundMapCamera, hasActiveRoute, isSearchingMode, routeLayoutKey, targetRegion]);

  const handleCenterMap = useCallback(() => {
    if (mapRef.current) {
      setMapFollowingUser(true);

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

  const handleMapPanDrag = useCallback(() => {
    if (hasActiveRoute || isSearchingMode) {
      return;
    }

    setMapFollowingUser(false);
  }, [hasActiveRoute, isSearchingMode]);

  const handleMapRegionChangeComplete = useCallback((nextRegion) => {
    if (!showDriverH3Overlay || !nextRegion) {
      return;
    }
    setVisibleMapRegion(nextRegion);
  }, [showDriverH3Overlay]);

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

  const handleDriverCtaLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setDriverBottomCtaHeight(nextHeight);
    }
  }, []);

  const handleDriverOnlineToggle = useCallback(async () => {
    const runToggle = async (nextValue) => {
      try {
        const result = await setDriverOnline(nextValue);
        if (result?.blocked) {
          Alert.alert(
            'Ativação pendente',
            'Conclua CNH, CRLV, MEI e consentimento antes de ficar online.',
            [
              { text: 'Depois' },
              {
                text: 'Abrir ativação',
                onPress: () => navigation.navigate('RobotaxiPrototypeDriverActivation')
              }
            ]
          );
        }
      } catch (error) {
        Alert.alert('Modo motorista', error?.message || 'Não foi possível atualizar o status online agora.');
      }
    };

    if (driverOnline) {
      Alert.alert(
        'Ficar offline',
        'Deseja parar de receber corridas agora?',
        [
          { text: 'Não', style: 'cancel' },
          { text: 'Sim', onPress: () => runToggle(false) }
        ]
      );
      return;
    }

    runToggle(true);
  }, [driverOnline, navigation, setDriverOnline]);

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

  const handleOpenDriverNavigation = useCallback(async () => {
    if (!driverTripAssist?.targetCoordinate) {
      Alert.alert('Rota indisponível', 'Ainda não temos a coordenada do próximo trecho da corrida.');
      return;
    }

    try {
      await openDriverExternalNavigation({
        coordinate: driverTripAssist.targetCoordinate,
        destinationLabel:
          driverTripAssist.navigationPhase === 'pickup'
            ? driverTripAssist.pickupAddress
            : driverTripAssist.destinationAddress,
        phase: driverTripAssist.navigationPhase
      });
    } catch (error) {
      Alert.alert('Não foi possível abrir a navegação', error?.message || 'Tente novamente.');
    }
  }, [driverTripAssist]);

  const handleDriverTripPrimaryAction = useCallback(async () => {
    if (!driverTripAssist) {
      return;
    }

    try {
      if (driverTripAssist.status === 'accepted') {
        if (!driverTripAssist.primaryActionEnabled) {
          Alert.alert('Aproxime-se do embarque', 'O botão será liberado quando você estiver a até 20 metros do local de embarque.');
          return;
        }
        await markDriverArrived();
        return;
      }

      if (driverTripAssist.status === 'arrived') {
        await startTripFlow();
        return;
      }

      if (driverTripAssist.status === 'started') {
        const result = await completeTripFlow();
        if (result?.success !== false) {
          navigation.navigate('RobotaxiPrototypeReceipt', { fromTrip: true });
        }
      }
    } catch (error) {
      Alert.alert('Não foi possível atualizar', error?.message || 'Tente novamente.');
    }
  }, [completeTripFlow, driverTripAssist, markDriverArrived, navigation, startTripFlow]);

  useEffect(() => {
    if (!isDriverRole || !isHomeRoute || !driverTripAssist?.status) {
      lastAutoNavigationPhaseRef.current = '';
      return;
    }

    const bookingKey = driverActiveRide?.bookingId || driverActiveRide?.id || 'current';
    const phaseKey =
      driverTripAssist.status === 'accepted'
        ? `pickup:${bookingKey}`
        : driverTripAssist.status === 'started'
          ? `destination:${bookingKey}`
          : '';

    if (!phaseKey || lastAutoNavigationPhaseRef.current === phaseKey) {
      return;
    }

    lastAutoNavigationPhaseRef.current = phaseKey;
    handleOpenDriverNavigation();
  }, [driverActiveRide?.bookingId, driverActiveRide?.id, driverTripAssist?.status, handleOpenDriverNavigation, isDriverRole, isHomeRoute]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeMapLayer
          mapRef={mapRef}
          region={targetRegion}
          userCoordinate={currentCoordinate || DEFAULT_USER_COORDINATE}
          userHeading={currentHeading}
          userAvatarUri={profileImage}
          userAvatarLetter={profileInitial}
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
          onMapPanDrag={handleMapPanDrag}
          onRegionChangeComplete={handleMapRegionChangeComplete}
          mapChildren={driverH3MapChildren}
        />

        <PrototypeTopControls
          insets={insets}
          leftIcon={isHomeRoute ? 'locate' : 'arrow-back'}
          rightIcon={hasMenuTopAction ? 'menu' : 'locate'}
          showRightBadge={hasMenuTopAction && unreadNotificationCount > 0}
          onPressLeft={handleTopLeftPress}
          onPressRight={handleTopRightPress}
        />

        {isHomeRoute && isDriverRole && driverTripAssist ? (
          <DriverTripStatusBanner
            routeKey={route?.key}
            insetsTop={insets.top}
            tripAssist={driverTripAssist}
            onPrimaryAction={handleDriverTripPrimaryAction}
            onOpenNavigation={handleOpenDriverNavigation}
          />
        ) : null}

        {isHomeRoute && !isDriverRole ? (
          <PassengerHomeOverlay
            insetsBottom={insets.bottom}
            destinationLabel={destination}
            onCardLayout={handleSearchCardLayout}
            onDestinationPress={() => navigation.navigate('RobotaxiPrototypeDestination')}
            onMicrophonePress={() =>
              navigation.navigate('RobotaxiPrototypeDestination', {
                autoStartVoice: true
              })
            }
          />
        ) : null}

        {isHomeRoute && isDriverRole ? (
          <>
            <DriverLiveRideOverlay
              insetsTop={insets.top}
              insetsBottom={insets.bottom}
              bottomOffset={driverLiveRideBottomOffset}
              onCardLayout={event => {
                const nextHeight = event?.nativeEvent?.layout?.height;
                if (Number.isFinite(nextHeight) && nextHeight > 0) {
                  setDriverLiveRideHeight(nextHeight);
                }
              }}
              driverOffers={driverOffers}
              driverActiveRide={driverActiveRide}
              bookingStatus={bookingStatus}
              tripDistanceKm={tripDistanceKm}
              paymentMethod={paymentMethod}
              driverExtensionRequest={driverExtensionRequest}
              acceptDriverOffer={acceptDriverOffer}
              rejectDriverOffer={rejectDriverOffer}
              respondToDriverExtension={respondToDriverExtension}
              interruptRideOperationalFlow={interruptRideOperationalFlow}
              markDriverArrived={markDriverArrived}
              startTripFlow={startTripFlow}
              completeTripFlow={completeTripFlow}
              driverTripAssist={driverTripAssist}
              onOpenNavigation={handleOpenDriverNavigation}
              onTripCompletedSuccess={() => navigation.navigate('RobotaxiPrototypeReceipt', { fromTrip: true })}
            />

            {showDriverHomeOverlay ? (
              <DriverHomeOverlay
                driverId={profile?.uid}
                insetsTop={insets.top}
                insetsBottom={insets.bottom}
                driverOnline={driverOnline}
                driverCanGoOnline={driverCanGoOnline}
                ridesCount={todayTrips}
                formattedDriverEarnings={formattedDriverEarnings}
                onCtaLayout={handleDriverCtaLayout}
                onToggleOnline={handleDriverOnlineToggle}
                onOpenEarnings={() =>
                  navigation.navigate('EarningsReport', {
                    source: 'driver-home',
                    defaultRangeDays: 1,
                    maxRangeDays: 7
                  })
                }
                onOpenActivation={() => navigation.navigate('RobotaxiPrototypeDriverActivation')}
              />
            ) : null}
          </>
        ) : null}

        {!(isDriverRole || isDriverRoute) ? (
          <PrototypeBottomIsland
            insets={insets}
            active={activeTab}
            onPressHome={handleBottomHomePress}
            onPressProfile={() => navigation.navigate('RobotaxiPrototypeProfile')}
            onPressSettings={() => navigation.navigate('RobotaxiPrototypeSettings')}
          />
        ) : null}
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.bg.map
  }
});
