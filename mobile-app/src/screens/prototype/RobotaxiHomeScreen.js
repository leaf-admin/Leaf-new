import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Platform, StatusBar, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused, useNavigationState } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Polygon } from 'react-native-maps';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeMapLayer from '../../components/prototype/PrototypeMapLayer';
import PrototypeConnectionStatusPill from '../../components/prototype/PrototypeConnectionStatusPill';
import { PrototypeBottomIsland, PrototypeTopControls } from '../../components/prototype/PrototypeScaffold';
import PassengerHomeOverlay from './home/PassengerHomeOverlay';
import DriverHomeOverlay from './home/DriverHomeOverlay';
import DriverLiveRideOverlay from './home/DriverLiveRideOverlay';
import DriverTripStatusBanner from './home/DriverTripStatusBanner';
import LeafNativeNavigationBanner from './home/LeafNativeNavigationBanner';
import DriverTransientStateCard from './home/DriverTransientStateCard';
import RobotaxiReceiptScreen from './RobotaxiReceiptScreen';
import { PROTOTYPE_REGION } from './robotaxiPrototypeData';
import { subscribePrototypeMapOcclusion, usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { clearPrototypeMapRoute, subscribePrototypeMapRoute } from './prototypeMapRoute';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { resolvePassengerAutoRoute, shouldAutoSyncPassengerRoute } from './passengerFlowRouting';
import { getSearchPresentation } from './searchPresentation';
import useSearchElapsedClock from './useSearchElapsedClock';
import { openDriverExternalNavigation } from '../../services/DriverExternalNavigationService';
import { fetchH3CellsForRegion } from '../../services/runtime/h3MapService';
import WebSocketManager from '../../services/WebSocketManager';
import { resolveMeaningfulAddress } from './addressLabelUtils';
import { selectDisplayableDriverOffer } from './driverOfferPricingSnapshot';
import {
  resolveDriverHomeAutomationConfig,
  resolveEffectiveDriverHomeAutomationConfig,
} from './driverHomeAutomationConfig';
import {
  normalizePassengerAction,
  resolvePassengerHomeAutomationConfig,
} from './passengerHomeAutomationConfig';
import {
  consumePersistedHomeAutomationCommand,
  persistHomeAutomationCommand,
} from './homeAutomationCommandStore';
import {
  clearPrototypeHomeAutomationPayload,
  getLatestPrototypeHomeAutomationPayload,
  publishPrototypeHomeAutomationPayload,
  subscribePrototypeHomeAutomationPayload,
} from './prototypeHomeAutomationBus';
import { isE2ETestBuild } from '../../config/runtimeAccessPolicy';
import { buildTripFinancialTotals, formatCurrencyBRL } from './tripFinancialSummary';
import {
  buildPrototypeConnectionIndicatorModel,
  resolvePrototypeConnectionAutomationConfig,
  shouldRunPrototypeConnectionAutomation,
} from './prototypeConnectionStatus';

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
const QA_SEEDED_DESTINATION = Object.freeze({
  id: 'qa-copacabana-palace',
  name: 'Copacabana Palace',
  address: 'Av. Atlantica, 1702 - Copacabana, Rio de Janeiro - RJ, 22021-001',
  coordinate: {
    latitude: -22.96722,
    longitude: -43.17874,
  },
});
const ROUTE_SIDE_PADDING = 72;
const ROUTE_TOP_EXTRA_PADDING = 22;
const ROUTE_BOTTOM_EXTRA_PADDING = 28;
const SEARCH_ZOOM_ANIMATION_MS = 1150;
const SEARCH_RADIUS_MARGIN = 1.34;
const MAP_OCCLUSION_REPOSITION_MS = 760;
const MAP_RETURN_REPOSITION_MS = 820;
const DRIVER_H3_VIEWPORT_DEBOUNCE_MS = 420;
const DRIVER_H3_SOCKET_REFRESH_DEBOUNCE_MS = 900;
const HOME_AUTOMATION_POLL_MS = 350;
const HOME_AUTOMATION_WATCHDOG_MS = 250;
const LEAF_NATIVE_NAV_CAMERA_THROTTLE_MS = 1200;
const LEAF_NATIVE_NAV_MANUAL_PAN_PAUSE_MS = 8000;
const LEAF_NATIVE_NAV_CAMERA_ZOOM = Platform.OS === 'ios' ? 15.4 : 17;
const LEAF_NATIVE_NAV_CAMERA_ANIMATION_MS = 920;
const SHOULD_AUTO_OPEN_DRIVER_NAVIGATION = false;
const CONNECTION_STATUS_STABILITY_MS = 10000;
const MAX_DEPTH_DEBUG_STORAGE_KEY = '@prototype_runtime_debug_max_depth';
const RUNTIME_DEBUG_HISTORY_STORAGE_KEY = '@prototype_runtime_debug_history';
let prototypeRuntimeDebugWriteQueue = Promise.resolve();
const prototypeDriverAutomationExecutionKeys = new Set();
const prototypePassengerAutomationExecutionKeys = new Set();
const QA_ROUTE_PARAM_KEYS = Object.freeze([
  'automation',
  'e2e',
  'qaAutomation',
  'qaDriverAction',
  'qaPassengerAction',
  'qaBookingId',
  'qaNonce',
  'qaConnectionScenario',
  'qaTriggerState',
  'qaRecoveryMs',
  'qaDelayMs',
]);

function normalizeConsoleArg(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack || '',
    };
  }

  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return String(value);
  }
}

function extractPrototypeHomeQaParamsFromUrl(url) {
  const rawUrl = String(url || '').trim();
  if (!rawUrl) {
    return null;
  }

  const [urlWithoutHash] = rawUrl.split('#');
  const [urlWithoutQuery, queryString = ''] = urlWithoutHash.split('?');
  const normalizedPath = urlWithoutQuery
    .replace(/^[^:]+:\/\//i, '')
    .replace(/^\/+/, '')
    .trim()
    .toLowerCase();

  if (normalizedPath !== 'robotaxi/home') {
    return null;
  }

  const searchParams = new URLSearchParams(queryString);
  const qaParams = QA_ROUTE_PARAM_KEYS.reduce((accumulator, key) => {
    const value = searchParams.get(key);
    if (value != null && String(value).trim() !== '') {
      accumulator[key] = String(value).trim();
    }
    return accumulator;
  }, {});

  if (!qaParams.qaAutomation) {
    if (
      qaParams.qaDriverAction ||
      qaParams.qaPassengerAction ||
      qaParams.qaConnectionScenario
    ) {
      qaParams.qaAutomation = '1';
    }
  }

  return Object.keys(qaParams).length > 0 ? qaParams : null;
}

function normalizeCameraHeadingDegrees(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = numeric % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function resolveShortestHeadingDeltaDegrees(fromHeading, toHeading) {
  const from = normalizeCameraHeadingDegrees(fromHeading);
  const to = normalizeCameraHeadingDegrees(toHeading);

  if (from === null || to === null) {
    return 0;
  }

  return ((to - from + 540) % 360) - 180;
}

function resolveSmoothedNavigationHeading(previousHeading, nextHeading) {
  const normalizedNext = normalizeCameraHeadingDegrees(nextHeading);
  const normalizedPrevious = normalizeCameraHeadingDegrees(previousHeading);

  if (normalizedNext === null) {
    return normalizedPrevious;
  }

  if (normalizedPrevious === null) {
    return normalizedNext;
  }

  const delta = resolveShortestHeadingDeltaDegrees(normalizedPrevious, normalizedNext);
  if (Math.abs(delta) < 1) {
    return normalizedPrevious;
  }

  return normalizeCameraHeadingDegrees(normalizedPrevious + delta * 0.72);
}

async function appendPrototypeRuntimeDebugStep(step, data = {}) {
  if (!step) {
    return;
  }

  prototypeRuntimeDebugWriteQueue = prototypeRuntimeDebugWriteQueue
    .catch(() => undefined)
    .then(async () => {
      try {
        const raw = await AsyncStorage.getItem(RUNTIME_DEBUG_HISTORY_STORAGE_KEY);
        const history = raw ? JSON.parse(raw) : [];
        const nextHistory = Array.isArray(history) ? history : [];
        nextHistory.push({
          step,
          data,
          at: new Date().toISOString(),
        });
        if (nextHistory.length > 400) {
          nextHistory.splice(0, nextHistory.length - 400);
        }
        await AsyncStorage.setItem(
          RUNTIME_DEBUG_HISTORY_STORAGE_KEY,
          JSON.stringify(nextHistory),
        );
      } catch (_error) {
        // best-effort debug breadcrumb
      }
    });

  return prototypeRuntimeDebugWriteQueue;
}

function tryStartPrototypeDriverAutomationExecution(executionKey) {
  const normalizedExecutionKey = String(executionKey || '').trim();
  if (!normalizedExecutionKey) {
    return false;
  }

  if (prototypeDriverAutomationExecutionKeys.has(normalizedExecutionKey)) {
    return false;
  }

  prototypeDriverAutomationExecutionKeys.add(normalizedExecutionKey);
  if (prototypeDriverAutomationExecutionKeys.size > 80) {
    const [oldestKey] = prototypeDriverAutomationExecutionKeys;
    if (oldestKey) {
      prototypeDriverAutomationExecutionKeys.delete(oldestKey);
    }
  }

  return true;
}

function tryStartPrototypePassengerAutomationExecution(executionKey) {
  const normalizedExecutionKey = String(executionKey || '').trim();
  if (!normalizedExecutionKey) {
    return false;
  }

  if (prototypePassengerAutomationExecutionKeys.has(normalizedExecutionKey)) {
    return false;
  }

  prototypePassengerAutomationExecutionKeys.add(normalizedExecutionKey);
  if (prototypePassengerAutomationExecutionKeys.size > 80) {
    const [oldestKey] = prototypePassengerAutomationExecutionKeys;
    if (oldestKey) {
      prototypePassengerAutomationExecutionKeys.delete(oldestKey);
    }
  }

  return true;
}

if (__DEV__ && !global.__leafPrototypeMaxDepthPatchInstalled) {
  const originalConsoleError = console.error;
  console.error = (...args) => {
    try {
      const combinedMessage = args.map((item) => String(item || '')).join(' ');
      if (combinedMessage.includes('Maximum update depth exceeded')) {
        const payload = {
          capturedAt: new Date().toISOString(),
          args: args.map(normalizeConsoleArg),
        };
        AsyncStorage.setItem(
          MAX_DEPTH_DEBUG_STORAGE_KEY,
          JSON.stringify(payload),
        ).catch(() => {});
      }
    } catch (_error) {
      // no-op
    }

    originalConsoleError(...args);
  };
  global.__leafPrototypeMaxDepthPatchInstalled = true;
}

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

function isFiniteCoordinate(candidate) {
  return (
    Number.isFinite(candidate?.latitude) &&
    Number.isFinite(candidate?.longitude)
  );
}

function distanceBetweenCoordinatesKm(origin, destination) {
  if (!isFiniteCoordinate(origin) || !isFiniteCoordinate(destination)) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusKm = 6371;
  const toRadians = (value) => (value * Math.PI) / 180;
  const latDelta = toRadians(destination.latitude - origin.latitude);
  const lonDelta = toRadians(destination.longitude - origin.longitude);
  const originLat = toRadians(origin.latitude);
  const destinationLat = toRadians(destination.latitude);

  const haversine =
    Math.sin(latDelta / 2) ** 2 +
    Math.cos(originLat) *
      Math.cos(destinationLat) *
      Math.sin(lonDelta / 2) ** 2;

  return 2 * earthRadiusKm * Math.asin(Math.sqrt(haversine));
}

function buildSearchViewportRegion({
  center,
  radiusKm,
  destination
}) {
  if (!isFiniteCoordinate(center) || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return null;
  }

  const baseRegion = buildSearchRegion(center, radiusKm);
  const points = [
    center,
    offsetCoordinateByDistance(center, radiusKm, 0),
    offsetCoordinateByDistance(center, radiusKm, 90),
    offsetCoordinateByDistance(center, radiusKm, 180),
    offsetCoordinateByDistance(center, radiusKm, 270)
  ];
  const shouldIncludeDestination =
    isFiniteCoordinate(destination) &&
    distanceBetweenCoordinatesKm(center, destination) <= Math.max(4.5, radiusKm * 4.25);

  if (shouldIncludeDestination) {
    points.push(destination);
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max(baseRegion.latitudeDelta, (maxLatitude - minLatitude) * 1.18),
    longitudeDelta: Math.max(baseRegion.longitudeDelta, (maxLongitude - minLongitude) * 1.22)
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

function sanitizeRouteText(value) {
  return String(value || '').trim();
}

function compactPlaceLabel(value, fallback = '') {
  const normalized = sanitizeRouteText(value);
  if (!normalized) {
    return fallback;
  }

  const [firstChunk] = normalized.split(',');
  return sanitizeRouteText(firstChunk) || normalized || fallback;
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
    currentAddress,
    currentHeading,
    ready,
    initializing,
    presentationSyncing,
    connecting,
    isSocketConnected,
    isSocketAuthenticated,
    driverCoordinate,
    trafficLayerEnabled,
    clearFlowPreview,
    bookingStatus,
    activeBooking,
    activeBookingId,
    lastRideBookingId,
    selectedDestination,
    selectedFare,
    selectedVehicle,
    tripDistanceKm,
    tripDurationMin,
    tripArrivalText,
    searchingElapsedSeconds,
    unreadNotificationCount,
    profileUid,
    driverOnline,
    driverOnlinePending,
    driverCanGoOnline,
    driverActivationResolved,
    paymentMethod,
    driverInfo,
    requestRide,
    setDriverOnline,
    tripHistory,
    lastReceipt,
    driverOffers,
    driverActiveRide,
    driverTripMeta,
    driverTransientCard,
    driverExtensionRequest,
    driverTripAssist,
    operationalContinuation,
    acceptDriverOffer,
    rejectDriverOffer,
    respondToDriverExtension,
    respondOperationalContinuationFlow,
    interruptRideOperationalFlow,
    cancelRideSearch,
    cancelActiveRideFlow,
    endTripEarlyFlow,
    markDriverArrived,
    startTripFlow,
    completeTripFlow,
    dismissCompletedReceipt,
    recoverCompletedReceipt,
    submitCompletedReceiptRating
  } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const isScreenFocused = useIsFocused();
  const currentRouteName = useNavigationState(state => state.routes[state.index]?.name || 'RobotaxiPrototype');
  const mapRef = useRef(null);
  const lastRouteLayoutKeyRef = useRef('');
  const lastNativeNavigationCameraAtRef = useRef(0);
  const lastNativeNavigationHeadingRef = useRef(null);
  const lastManualMapPanAtRef = useRef(0);
  const wasSearchingRef = useRef(false);
  const lastSearchRadiusRef = useRef(null);
  const lastAutoNavigationPhaseRef = useRef('');
  const lastDriverAutomationExecutionRef = useRef('');
  const lastDriverAutomationSnapshotRef = useRef('');
  const lastPassengerAutomationExecutionRef = useRef('');
  const lastConnectionHealthyRef = useRef(false);
  const hasConnectionSnapshotRef = useRef(false);
  const lastDriverAutomationWatchdogCommandRef = useRef('');
  const latestPrototypeHomeAutomationPayload = useMemo(
    () => getLatestPrototypeHomeAutomationPayload(),
    []
  );
  const [connectionIndicatorArmed, setConnectionIndicatorArmed] = useState(false);
  const [hiddenNativeNavigationKey, setHiddenNativeNavigationKey] = useState('');
  const [liveDriverAutomationCommand, setLiveDriverAutomationCommand] = useState(
    () => latestPrototypeHomeAutomationPayload.driverAutomationCommand
  );
  const [persistedDriverAutomationCommand, setPersistedDriverAutomationCommand] = useState(
    () => latestPrototypeHomeAutomationPayload.driverAutomationCommand
  );
  const [persistedPassengerAutomationCommand, setPersistedPassengerAutomationCommand] =
    useState(null);
  const [liveQaRouteParams, setLiveQaRouteParams] = useState(
    () => latestPrototypeHomeAutomationPayload.qaRouteParams
  );
  const connectionRecoveredTimerRef = useRef(null);
  const connectionAutomationExecutionRef = useRef('');
  const connectionAutomationTimersRef = useRef([]);
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
  const [showRecoveredConnectionHint, setShowRecoveredConnectionHint] = useState(false);
  const [qaConnectionVisualState, setQaConnectionVisualState] = useState(null);
  const [displayedConnectionIndicatorModel, setDisplayedConnectionIndicatorModel] = useState(null);
  const driverH3RefreshTimerRef = useRef(null);
  const connectionIndicatorStableTimerRef = useRef(null);
  const displayedConnectionIndicatorKeyRef = useRef('none');
  const [destination] = useState('Para onde vamos?');
  const explicitProfileRole = normalizeHomeRole(
    profile?.usertype ??
      profile?.userType ??
      profile?.role ??
      profile?.user_role ??
      profile?.accountType
  );
  const resolvedRole =
    normalizeHomeRole(activeRole) ||
    explicitProfileRole ||
    'customer';
  const isDriverRole = resolvedRole === 'driver';
  const effectiveDriverAutomationUid = String(
    profile?.uid || profileUid || ''
  ).trim();
  const normalizedBookingStatus = String(bookingStatus || '')
    .trim()
    .toLowerCase();
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
    currentRouteName === 'RobotaxiPrototypeDriverPanel' ||
    currentRouteName === 'RobotaxiPrototypeDriverActivation' ||
    currentRouteName === 'RobotaxiPrototypeProfile' ||
    currentRouteName === 'RobotaxiPrototypeMenu' ||
    currentRouteName === 'RobotaxiMenuEditProfile' ||
    currentRouteName === 'RobotaxiMenuTripHistory' ||
    currentRouteName === 'RobotaxiMenuMessages' ||
    currentRouteName === 'RobotaxiMenuHelp';
  const isSettingsRoute = currentRouteName === 'RobotaxiPrototypeSettings' || currentRouteName === 'RobotaxiMenuSettings';
  const isDriverRoute =
    currentRouteName === 'RobotaxiPrototypeDriverPanel' ||
    currentRouteName === 'RobotaxiPrototypeDriverActivation' ||
    currentRouteName === 'RobotaxiPrototypeDriverOffer' ||
    currentRouteName === 'RobotaxiPrototypeDriverTrip' ||
    currentRouteName === 'RobotaxiPrototypeDriverSearch';
  const isDriverOfferRoute = currentRouteName === 'RobotaxiPrototypeDriverOffer';
  const isDestinationRoute = currentRouteName === 'RobotaxiPrototypeDestination';
  const shouldSyncPassengerRoute = shouldAutoSyncPassengerRoute(currentRouteName);
  const freezeBackgroundMapCamera = isDestinationRoute || isDriverOfferRoute;
  const showHomeChrome = Boolean(isScreenFocused && isHomeRoute);
  const hasMenuTopAction = isDriverRole || isHomeRoute || isDriverRoute;
  const isSearchingMode = bookingStatus === 'searching' || bookingStatus === 'requesting';
  const searchAnchorTimestamp =
    activeBooking?.timestamp ||
    activeBooking?.createdAt ||
    activeBooking?.requestedAt ||
    activeBooking?.paymentData?.confirmedAt ||
    null;
  const searchElapsedClock = useSearchElapsedClock(
    searchingElapsedSeconds,
    isSearchingMode,
    searchAnchorTimestamp
  );
  const searchPresentation = useMemo(
    () => getSearchPresentation(searchElapsedClock),
    [searchElapsedClock]
  );
  const activeTab = isSettingsRoute ? 'settings' : isProfileRoute ? 'profile' : 'home';
  const hasActiveRoute = Array.isArray(activeRoute.coordinates) && activeRoute.coordinates.length >= 2;
  const effectiveRouteParams = useMemo(
    () => ({
      ...(route?.params || {}),
      ...(liveQaRouteParams || {}),
    }),
    [liveQaRouteParams, route?.params]
  );
  const effectivePassengerRouteParams = useMemo(() => {
    if (isDriverRole) {
      return effectiveRouteParams;
    }

    const routePassengerAction = normalizePassengerAction(
      effectiveRouteParams?.qaPassengerAction ||
        effectiveRouteParams?.passengerAction ||
        effectiveRouteParams?.action
    );
    const routePassengerNonce = String(
      effectiveRouteParams?.qaNonce || effectiveRouteParams?.nonce || ''
    ).trim();
    const persistedPassengerAction = normalizePassengerAction(
      persistedPassengerAutomationCommand?.action
    );
    const persistedPassengerNonce = String(
      persistedPassengerAutomationCommand?.nonce || ''
    ).trim();

    if (!persistedPassengerAction) {
      return effectiveRouteParams;
    }

    if (
      !routePassengerAction ||
      (persistedPassengerNonce && persistedPassengerNonce !== routePassengerNonce)
    ) {
      return {
        ...effectiveRouteParams,
        qaAutomation: '1',
        qaPassengerAction: persistedPassengerAction,
        qaBookingId:
          effectiveRouteParams?.qaBookingId ||
          persistedPassengerAutomationCommand?.bookingId ||
          '',
        qaNonce:
          persistedPassengerNonce || routePassengerNonce || 'persisted-passenger-automation',
      };
    }

    return effectiveRouteParams;
  }, [effectiveRouteParams, isDriverRole, persistedPassengerAutomationCommand]);
  const searchRadiusKm = useMemo(() => {
    if (!isSearchingMode) {
      return null;
    }

    return searchPresentation.radiusKm;
  }, [isSearchingMode, searchPresentation.radiusKm]);
  const searchPreviewRadiusKm = useMemo(() => {
    if (!isSearchingMode) {
      return null;
    }

    return Math.max(
      searchPresentation.radiusKm,
      searchPresentation.previewRadiusKm,
    );
  }, [
    isSearchingMode,
    searchPresentation.previewRadiusKm,
    searchPresentation.radiusKm
  ]);
  const searchCenterCoordinate = currentCoordinate || DEFAULT_USER_COORDINATE;
  const searchRegion = useMemo(() => {
    if (!isSearchingMode || !searchRadiusKm) {
      return null;
    }

    return buildSearchRegion(searchCenterCoordinate, searchRadiusKm);
  }, [isSearchingMode, searchCenterCoordinate, searchRadiusKm]);
  const searchTargetRegion = useMemo(() => {
    if (!isSearchingMode || !searchRadiusKm) {
      return null;
    }

    const viewportRegion = buildSearchViewportRegion({
      center: searchCenterCoordinate,
      radiusKm: searchRadiusKm,
      destination: activeRoute.destination
    });

    if (!viewportRegion) {
      return null;
    }

    const effectiveHeight = Math.max(1, mapHeight || windowHeight);
    const maxTop = Math.max(0, effectiveHeight - MAP_MIN_VISIBLE_HEIGHT);
    const topInset = Math.min(Math.max(0, activeOcclusion.top || 0), maxTop);
    const maxBottom = Math.max(0, effectiveHeight - MAP_MIN_VISIBLE_HEIGHT - topInset);
    const bottomInset = Math.min(Math.max(0, activeOcclusion.bottom || 0), maxBottom);
    const availableHeight = Math.max(MAP_MIN_VISIBLE_HEIGHT, effectiveHeight - topInset - bottomInset);
    const desiredMarkerY = topInset + availableHeight / 2;
    const baseCenterY = effectiveHeight / 2;
    const pixelOffsetY = desiredMarkerY - baseCenterY;
    const latitudeOffset = (viewportRegion.latitudeDelta * pixelOffsetY) / effectiveHeight;

    return {
      ...viewportRegion,
      latitude: viewportRegion.latitude + latitudeOffset
    };
  }, [
    activeOcclusion.bottom,
    activeOcclusion.top,
    activeRoute.destination,
    isSearchingMode,
    mapHeight,
    searchCenterCoordinate,
    searchRadiusKm,
    windowHeight
  ]);
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
  const driverLiveOffer = useMemo(
    () => selectDisplayableDriverOffer(driverOffers),
    [driverOffers]
  );
  const routeDriverAutomationConfig = useMemo(
    () =>
      resolveDriverHomeAutomationConfig(effectiveRouteParams, {
        isDriverRole,
        isHomeRoute,
        isDev: Boolean(__DEV__),
        isE2E: isE2ETestBuild(),
      }),
    [effectiveRouteParams, isDriverRole, isHomeRoute]
  );
  const routeDriverAutomationNeedsPersistedFallback = useMemo(() => {
    if (!routeDriverAutomationConfig.automationEnabled) {
      return false;
    }

    if (
      (routeDriverAutomationConfig.action === 'accept_offer' ||
        routeDriverAutomationConfig.action === 'reject_offer') &&
      !routeDriverAutomationConfig.bookingId
    ) {
      return true;
    }

    return false;
  }, [
    routeDriverAutomationConfig.action,
    routeDriverAutomationConfig.automationEnabled,
    routeDriverAutomationConfig.bookingId,
  ]);
  const driverAutomationConfig = useMemo(
    () =>
      resolveEffectiveDriverHomeAutomationConfig(
        {
          routeParams: effectiveRouteParams,
          routeConfig: routeDriverAutomationConfig,
          liveCommand: liveDriverAutomationCommand,
          persistedCommand: persistedDriverAutomationCommand,
        },
        {
          isDriverRole,
          isHomeRoute,
          isDev: Boolean(__DEV__),
          isE2E: isE2ETestBuild(),
        }
      ),
    [
      effectiveRouteParams,
      isDriverRole,
      isHomeRoute,
      liveDriverAutomationCommand,
      persistedDriverAutomationCommand,
      routeDriverAutomationConfig,
    ]
  );
  const passengerAutomationConfig = useMemo(
    () =>
      resolvePassengerHomeAutomationConfig(effectivePassengerRouteParams, {
        isDriverRole,
        isHomeRoute,
        isDev: Boolean(__DEV__),
        isE2E: isE2ETestBuild(),
      }),
    [effectivePassengerRouteParams, isDriverRole, isHomeRoute]
  );

  useEffect(() => {
    const unsubscribe = subscribePrototypeHomeAutomationPayload(
      ({ qaRouteParams, driverAutomationCommand }) => {
        appendPrototypeRuntimeDebugStep('driver_home_automation_bus_received', {
          qaDriverAction: qaRouteParams?.qaDriverAction || '',
          qaPassengerAction: qaRouteParams?.qaPassengerAction || '',
          qaBookingId: qaRouteParams?.qaBookingId || '',
          qaNonce: qaRouteParams?.qaNonce || '',
          driverAction: driverAutomationCommand?.action || '',
          driverBookingId: driverAutomationCommand?.bookingId || '',
          driverNonce: driverAutomationCommand?.nonce || '',
          isScreenFocused,
          currentRouteName,
        });

        setLiveQaRouteParams((previous) => {
          const previousSerialized = JSON.stringify(previous || {});
          const nextSerialized = JSON.stringify(qaRouteParams || {});
          return previousSerialized === nextSerialized ? previous : qaRouteParams || null;
        });

        if (driverAutomationCommand?.action) {
          setLiveDriverAutomationCommand((previous) => {
            const previousSerialized = JSON.stringify(previous || {});
            const nextSerialized = JSON.stringify(driverAutomationCommand);
            return previousSerialized === nextSerialized
              ? previous
              : driverAutomationCommand;
          });
        }
      }
    );

    return unsubscribe;
  }, [currentRouteName, isScreenFocused]);

  useEffect(() => {
    const handleUrlEvent = ({ url }) => {
      const qaParams = extractPrototypeHomeQaParamsFromUrl(url);
      if (!qaParams) {
        return;
      }

      try {
        const urlText = String(url || '').toLowerCase();
        const shouldOpenReceiptFromUrl =
          urlText.includes('robotaxi/receipt') ||
          urlText.includes('robotaxi%2freceipt');
        if (shouldOpenReceiptFromUrl) {
          const rootNavigation = globalThis?.navigationRef;
          const receiptParams = { fromTrip: true };
          if (rootNavigation?.isReady?.()) {
            rootNavigation.navigate('RobotaxiPrototypeReceipt', receiptParams);
          } else {
            navigation?.navigate?.('RobotaxiPrototypeReceipt', receiptParams);
          }
          appendPrototypeRuntimeDebugStep('passenger_receipt_deep_link_navigate', {
            url: String(url || ''),
            viaRootNavigation: Boolean(rootNavigation?.isReady?.()),
          });
        }

        const liveDriverAutomationCommand = qaParams.qaDriverAction
          ? {
              role: 'driver',
              action:
                resolveDriverHomeAutomationConfig(
                  {
                    qaAutomation: qaParams.qaAutomation || '1',
                    qaDriverAction: qaParams.qaDriverAction,
                    qaBookingId: qaParams.qaBookingId || '',
                    qaNonce: qaParams.qaNonce || '',
                  },
                  {
                    isDriverRole: true,
                    isHomeRoute: true,
                    isDev: Boolean(__DEV__),
                    isE2E: isE2ETestBuild(),
                  }
                ).action || '',
              bookingId: qaParams.qaBookingId || '',
              nonce: qaParams.qaNonce || 'live-url-driver-automation',
            }
          : null;
        const persistedPassengerCommand = qaParams.qaPassengerAction
          ? {
              role: 'customer',
              action: normalizePassengerAction(qaParams.qaPassengerAction),
              bookingId: qaParams.qaBookingId || '',
              nonce: qaParams.qaNonce || 'live-url-passenger-automation',
            }
          : null;
        const isDriverOnlyAutomationCommand = Boolean(
          liveDriverAutomationCommand?.action &&
            !qaParams.qaPassengerAction &&
            !qaParams.qaConnectionScenario
        );
        const publishedQaParams = isDriverOnlyAutomationCommand ? null : qaParams;

        appendPrototypeRuntimeDebugStep('driver_home_automation_url_received', {
          url: String(url || ''),
          qaDriverAction: qaParams.qaDriverAction || '',
          qaPassengerAction: qaParams.qaPassengerAction || '',
          qaBookingId: qaParams.qaBookingId || '',
          qaNonce: qaParams.qaNonce || '',
        });

        if (liveDriverAutomationCommand?.action) {
          appendPrototypeRuntimeDebugStep('driver_home_automation_handler_stage', {
            stage: 'local_command_queue',
            action: liveDriverAutomationCommand.action || '',
            bookingId: liveDriverAutomationCommand.bookingId || '',
            nonce: liveDriverAutomationCommand.nonce || '',
          });

          persistHomeAutomationCommand(liveDriverAutomationCommand)
            .then((persistedCommand) => {
              if (!persistedCommand) {
                appendPrototypeRuntimeDebugStep(
                  'driver_home_automation_persist_failed',
                  {
                    action: liveDriverAutomationCommand.action || '',
                    bookingId: liveDriverAutomationCommand.bookingId || '',
                    nonce: liveDriverAutomationCommand.nonce || '',
                  }
                );
                return;
              }

              appendPrototypeRuntimeDebugStep('driver_home_automation_persist_queued', {
                action: persistedCommand.action || '',
                bookingId: persistedCommand.bookingId || '',
                nonce: persistedCommand.nonce || '',
              });
            })
            .catch((error) => {
              appendPrototypeRuntimeDebugStep('driver_home_automation_persist_failed', {
                action: liveDriverAutomationCommand.action || '',
                bookingId: liveDriverAutomationCommand.bookingId || '',
                nonce: liveDriverAutomationCommand.nonce || '',
                message: String(error?.message || error || ''),
              });
            });
        }

        if (persistedPassengerCommand?.action) {
          persistHomeAutomationCommand(persistedPassengerCommand)
            .then((persistedCommand) => {
              if (!persistedCommand) {
                appendPrototypeRuntimeDebugStep(
                  'passenger_home_automation_persist_failed',
                  {
                    action: persistedPassengerCommand.action || '',
                    bookingId: persistedPassengerCommand.bookingId || '',
                    nonce: persistedPassengerCommand.nonce || '',
                  }
                );
                return;
              }

              setPersistedPassengerAutomationCommand((previous) => {
                const previousSerialized = JSON.stringify(previous || {});
                const nextSerialized = JSON.stringify(persistedCommand);
                return previousSerialized === nextSerialized ? previous : persistedCommand;
              });
            })
            .catch((error) => {
              appendPrototypeRuntimeDebugStep('passenger_home_automation_persist_failed', {
                action: persistedPassengerCommand.action || '',
                bookingId: persistedPassengerCommand.bookingId || '',
                nonce: persistedPassengerCommand.nonce || '',
                message: String(error?.message || error || ''),
              });
            });
        }

        appendPrototypeRuntimeDebugStep('driver_home_automation_handler_stage', {
          stage: 'publish_payload',
          action: liveDriverAutomationCommand?.action || '',
          bookingId: liveDriverAutomationCommand?.bookingId || '',
          nonce: liveDriverAutomationCommand?.nonce || '',
          skippedRouteParams: isDriverOnlyAutomationCommand,
        });

        publishPrototypeHomeAutomationPayload({
          qaRouteParams: publishedQaParams,
          driverAutomationCommand: liveDriverAutomationCommand,
        });

        appendPrototypeRuntimeDebugStep('driver_home_automation_bus_published', {
          qaDriverAction: publishedQaParams?.qaDriverAction || '',
          qaPassengerAction: publishedQaParams?.qaPassengerAction || '',
          qaBookingId: publishedQaParams?.qaBookingId || '',
          qaNonce: publishedQaParams?.qaNonce || '',
          driverAction: liveDriverAutomationCommand?.action || '',
          driverBookingId: liveDriverAutomationCommand?.bookingId || '',
          skippedRouteParams: isDriverOnlyAutomationCommand,
        });

        if (isDriverOnlyAutomationCommand) {
          appendPrototypeRuntimeDebugStep('driver_home_automation_nav_params_skipped', {
            reason: 'driver_only_hot_command',
            action: liveDriverAutomationCommand?.action || '',
            bookingId: liveDriverAutomationCommand?.bookingId || '',
            nonce: liveDriverAutomationCommand?.nonce || '',
          });
          return;
        }

        try {
          navigation?.setParams?.(qaParams);
          appendPrototypeRuntimeDebugStep('driver_home_automation_nav_params_applied', {
            qaDriverAction: qaParams.qaDriverAction || '',
            qaPassengerAction: qaParams.qaPassengerAction || '',
            qaBookingId: qaParams.qaBookingId || '',
            qaNonce: qaParams.qaNonce || '',
          });
        } catch (error) {
          appendPrototypeRuntimeDebugStep('driver_home_automation_nav_params_failed', {
            message: String(error?.message || error || ''),
            qaDriverAction: qaParams.qaDriverAction || '',
            qaBookingId: qaParams.qaBookingId || '',
            qaNonce: qaParams.qaNonce || '',
          });
        }
      } catch (error) {
        appendPrototypeRuntimeDebugStep('driver_home_automation_handler_failed', {
          message: String(error?.message || error || ''),
          url: String(url || ''),
          qaDriverAction: qaParams.qaDriverAction || '',
          qaBookingId: qaParams.qaBookingId || '',
          qaNonce: qaParams.qaNonce || '',
        });
      }
    };

    const subscription = Linking.addEventListener('url', handleUrlEvent);

    return () => {
      subscription?.remove?.();
    };
  }, [navigation]);

  useEffect(() => {
    if (!liveQaRouteParams) {
      return;
    }

    appendPrototypeRuntimeDebugStep('driver_home_automation_live_params_applied', {
      qaDriverAction: liveQaRouteParams.qaDriverAction || '',
      qaPassengerAction: liveQaRouteParams.qaPassengerAction || '',
      qaBookingId: liveQaRouteParams.qaBookingId || '',
      qaNonce: liveQaRouteParams.qaNonce || '',
    });
  }, [liveQaRouteParams]);

  useEffect(() => {
    if (!liveDriverAutomationCommand) {
      return;
    }

    appendPrototypeRuntimeDebugStep('driver_home_automation_live_command_applied', {
      action: liveDriverAutomationCommand.action || '',
      bookingId: liveDriverAutomationCommand.bookingId || '',
      nonce: liveDriverAutomationCommand.nonce || '',
      isScreenFocused,
      currentRouteName,
    });
  }, [currentRouteName, isScreenFocused, liveDriverAutomationCommand]);

  useEffect(() => {
    if (!persistedDriverAutomationCommand) {
      return;
    }

    appendPrototypeRuntimeDebugStep('driver_home_automation_persisted_command_state', {
      action: persistedDriverAutomationCommand.action || '',
      bookingId: persistedDriverAutomationCommand.bookingId || '',
      nonce: persistedDriverAutomationCommand.nonce || '',
      isScreenFocused,
      currentRouteName,
    });
  }, [currentRouteName, isScreenFocused, persistedDriverAutomationCommand]);

  useEffect(() => {
    if (!persistedPassengerAutomationCommand) {
      return;
    }

    appendPrototypeRuntimeDebugStep('passenger_home_automation_persisted_command_state', {
      action: persistedPassengerAutomationCommand.action || '',
      bookingId: persistedPassengerAutomationCommand.bookingId || '',
      nonce: persistedPassengerAutomationCommand.nonce || '',
      isScreenFocused,
      currentRouteName,
    });
  }, [currentRouteName, isScreenFocused, persistedPassengerAutomationCommand]);

  useEffect(() => {
    if (!isDriverRole || !isHomeRoute) {
      return undefined;
    }

    let active = true;

    const syncDriverAutomationWatchdog = async () => {
      const latestPayload = getLatestPrototypeHomeAutomationPayload();
      const latestDriverCommand = latestPayload?.driverAutomationCommand || null;
      const latestQaParams = latestPayload?.qaRouteParams || null;
      const commandSignature = latestDriverCommand
        ? JSON.stringify(latestDriverCommand)
        : '';

      if (
        latestQaParams &&
        JSON.stringify(liveQaRouteParams || {}) !== JSON.stringify(latestQaParams)
      ) {
        setLiveQaRouteParams(latestQaParams);
      }

      if (latestDriverCommand && commandSignature !== lastDriverAutomationWatchdogCommandRef.current) {
        lastDriverAutomationWatchdogCommandRef.current = commandSignature;
        appendPrototypeRuntimeDebugStep('driver_home_automation_watchdog_command', {
          action: latestDriverCommand.action || '',
          bookingId: latestDriverCommand.bookingId || '',
          nonce: latestDriverCommand.nonce || '',
          source: 'bus',
        });
        setLiveDriverAutomationCommand((previous) => {
          const previousSerialized = JSON.stringify(previous || {});
          return previousSerialized === commandSignature ? previous : latestDriverCommand;
        });
      }

      if (liveDriverAutomationCommand || persistedDriverAutomationCommand) {
        return;
      }

      const persistedCommand = await consumePersistedHomeAutomationCommand('driver');
      if (!active || !persistedCommand) {
        return;
      }

      const persistedSignature = JSON.stringify(persistedCommand);
      lastDriverAutomationWatchdogCommandRef.current = persistedSignature;
      appendPrototypeRuntimeDebugStep('driver_home_automation_watchdog_command', {
        action: persistedCommand.action || '',
        bookingId: persistedCommand.bookingId || '',
        nonce: persistedCommand.nonce || '',
        source: 'storage',
      });
      setPersistedDriverAutomationCommand((previous) => {
        const previousSerialized = JSON.stringify(previous || {});
        return previousSerialized === persistedSignature ? previous : persistedCommand;
      });
    };

    syncDriverAutomationWatchdog();
    const timer = setInterval(syncDriverAutomationWatchdog, HOME_AUTOMATION_WATCHDOG_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [
    isDriverRole,
    isHomeRoute,
    liveDriverAutomationCommand,
    liveQaRouteParams,
    persistedDriverAutomationCommand,
  ]);

  useEffect(() => {
    if (isDriverRole || !isHomeRoute) {
      return undefined;
    }

    let active = true;
    let pollTimer = null;

    const syncPersistedPassengerAutomationCommand = async () => {
      const command = await consumePersistedHomeAutomationCommand('customer');
      if (!active || !command) {
        return;
      }

      appendPrototypeRuntimeDebugStep('passenger_home_automation_persisted_loaded', {
        action: command.action || '',
        nonce: command.nonce || '',
        bookingId: command.bookingId || '',
      });

      setPersistedPassengerAutomationCommand((previous) => {
        if (
          previous?.action === command.action &&
          previous?.nonce === command.nonce &&
          previous?.bookingId === command.bookingId
        ) {
          return previous;
        }

        return command;
      });
    };

    syncPersistedPassengerAutomationCommand();
    pollTimer = setInterval(() => {
      if (!active || persistedPassengerAutomationCommand) {
        return;
      }

      syncPersistedPassengerAutomationCommand();
    }, HOME_AUTOMATION_POLL_MS);

    return () => {
      active = false;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    };
  }, [isDriverRole, isHomeRoute, persistedPassengerAutomationCommand]);

  useEffect(() => {
    let active = true;
    let pollTimer = null;

    const syncPersistedDriverAutomationCommand = async () => {
      const command = await consumePersistedHomeAutomationCommand('driver');
      if (!active || !command) {
        return;
      }

      appendPrototypeRuntimeDebugStep('driver_home_automation_persisted_loaded', {
        action: command.action,
        nonce: command.nonce,
        bookingId: command.bookingId || '',
      });

      setPersistedDriverAutomationCommand((previous) => {
        if (
          previous?.action === command.action &&
          previous?.nonce === command.nonce
        ) {
          return previous;
        }

        return command;
      });
    };

    if (
      !isDriverRole ||
      (routeDriverAutomationConfig.automationEnabled &&
        !routeDriverAutomationNeedsPersistedFallback)
    ) {
      if (
        routeDriverAutomationConfig.automationEnabled ||
        persistedDriverAutomationCommand
      ) {
        appendPrototypeRuntimeDebugStep('driver_home_automation_poll_skipped', {
          isDriverRole,
          currentRouteName,
          routeAutomationEnabled: routeDriverAutomationConfig.automationEnabled,
          routeAutomationAction: routeDriverAutomationConfig.action || '',
          routeAutomationBookingId: routeDriverAutomationConfig.bookingId || '',
          routeAutomationNeedsPersistedFallback:
            routeDriverAutomationNeedsPersistedFallback,
          hasPersistedCommand: Boolean(persistedDriverAutomationCommand),
        });
      }
      if (
        routeDriverAutomationConfig.automationEnabled &&
        !routeDriverAutomationNeedsPersistedFallback
      ) {
        setPersistedDriverAutomationCommand(null);
      }
      return () => {
        active = false;
        if (pollTimer) {
          clearInterval(pollTimer);
        }
      };
    }

    syncPersistedDriverAutomationCommand();
    pollTimer = setInterval(() => {
      if (!active || persistedDriverAutomationCommand) {
        return;
      }

      syncPersistedDriverAutomationCommand();
    }, HOME_AUTOMATION_POLL_MS);

    return () => {
      active = false;
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    };
  }, [
    isDriverRole,
    persistedDriverAutomationCommand,
    routeDriverAutomationConfig.automationEnabled,
    routeDriverAutomationConfig.action,
    routeDriverAutomationConfig.bookingId,
    routeDriverAutomationNeedsPersistedFallback,
    currentRouteName,
  ]);
  useEffect(() => {
    if (!isDriverRole || !persistedDriverAutomationCommand?.action) {
      return;
    }

    const persistedAction = String(persistedDriverAutomationCommand.action || '')
      .trim()
      .toLowerCase();
    if (persistedAction === 'set_online' && driverOnline && !driverOnlinePending) {
      setPersistedDriverAutomationCommand(null);
      return;
    }

    if (persistedAction === 'set_offline' && !driverOnline && !driverOnlinePending) {
      setPersistedDriverAutomationCommand(null);
    }
  }, [
    driverOnline,
    driverOnlinePending,
    isDriverRole,
    persistedDriverAutomationCommand,
  ]);
  useEffect(() => {
    if (!isDriverRole) {
      return;
    }

    const hasRelevantAutomation =
      routeDriverAutomationConfig.automationEnabled ||
      Boolean(liveDriverAutomationCommand) ||
      Boolean(persistedDriverAutomationCommand) ||
      Boolean(driverAutomationConfig.action);
    if (!hasRelevantAutomation) {
      return;
    }

    const snapshot = JSON.stringify({
      currentRouteName,
      isScreenFocused,
      isHomeRoute,
      routeAction: routeDriverAutomationConfig.action || '',
      routeBookingId: routeDriverAutomationConfig.bookingId || '',
      routeAutomationEnabled: routeDriverAutomationConfig.automationEnabled,
      routeNeedsFallback: routeDriverAutomationNeedsPersistedFallback,
      liveAction: liveDriverAutomationCommand?.action || '',
      liveBookingId: liveDriverAutomationCommand?.bookingId || '',
      persistedAction: persistedDriverAutomationCommand?.action || '',
      persistedBookingId: persistedDriverAutomationCommand?.bookingId || '',
      configAction: driverAutomationConfig.action || '',
      configBookingId: driverAutomationConfig.bookingId || '',
      executionKey: driverAutomationExecutionKey || '',
      liveOfferBookingId: driverLiveOffer?.bookingId || driverLiveOffer?.id || '',
      activeRideBookingId: driverActiveRide?.bookingId || driverActiveRide?.id || '',
    });
    if (lastDriverAutomationSnapshotRef.current === snapshot) {
      return;
    }
    lastDriverAutomationSnapshotRef.current = snapshot;
    appendPrototypeRuntimeDebugStep('driver_home_automation_state', JSON.parse(snapshot));
  }, [
    currentRouteName,
    driverActiveRide?.bookingId,
    driverActiveRide?.id,
    driverAutomationConfig.action,
    driverAutomationConfig.bookingId,
    driverAutomationExecutionKey,
    driverLiveOffer?.bookingId,
    driverLiveOffer?.id,
    isDriverRole,
    isHomeRoute,
    isScreenFocused,
    liveDriverAutomationCommand,
    persistedDriverAutomationCommand,
    routeDriverAutomationConfig.action,
    routeDriverAutomationConfig.automationEnabled,
    routeDriverAutomationConfig.bookingId,
    routeDriverAutomationNeedsPersistedFallback,
  ]);
  const driverAutomationStatus = useMemo(
    () =>
      String(
        driverTripAssist?.status ||
          bookingStatus ||
          driverActiveRide?.status ||
          ''
      )
        .trim()
        .toLowerCase(),
    [bookingStatus, driverActiveRide?.status, driverTripAssist?.status]
  );
  const operationalContinuationStatus = useMemo(
    () => String(operationalContinuation?.status || '').trim().toLowerCase(),
    [operationalContinuation?.status]
  );
  const driverAutomationBookingKey = useMemo(() => {
    if (
      driverAutomationConfig.action === 'accept_offer' ||
      driverAutomationConfig.action === 'reject_offer'
    ) {
      return (
        driverAutomationConfig.bookingId ||
        driverLiveOffer?.bookingId ||
        driverLiveOffer?.id ||
        ''
      );
    }

    return (
      driverActiveRide?.bookingId ||
      driverActiveRide?.id ||
      ''
    );
  }, [
    driverActiveRide?.bookingId,
    driverActiveRide?.id,
    driverAutomationConfig.action,
    driverLiveOffer?.bookingId,
    driverLiveOffer?.id
  ]);
  const passengerAutomationExecutionKey = useMemo(() => {
    if (!passengerAutomationConfig.automationEnabled || !passengerAutomationConfig.action) {
      return '';
    }

    const normalizedStatus = normalizedBookingStatus || 'idle';
    const passengerAutomationBookingKey =
      passengerAutomationConfig.bookingId ||
      activeBookingId ||
      lastReceipt?.id ||
      lastRideBookingId ||
      '';
    const bookingKey = passengerAutomationBookingKey || 'no-booking';
    const nonce = passengerAutomationConfig.nonce || 'default';
    const hasCleanupTarget =
      normalizedStatus === 'completed' ||
      normalizedStatus === 'operational_interrupted' ||
      normalizedStatus === 'started' ||
      ['requesting', 'searching', 'searching_replacement', 'accepted', 'arrived'].includes(
        normalizedStatus
      ) ||
      Boolean(activeBookingId) ||
      (operationalContinuationStatus && operationalContinuationStatus !== 'idle');

    switch (passengerAutomationConfig.action) {
      case 'request_seeded_destination':
        if (normalizedStatus !== 'idle' || Boolean(activeBookingId)) {
          return '';
        }
        break;
      case 'cleanup_active':
        if (!hasCleanupTarget) {
          return '';
        }
        break;
      case 'cancel_search':
        if (
          !['requesting', 'searching', 'searching_replacement', 'accepted', 'arrived'].includes(
            normalizedStatus
          ) &&
          !Boolean(activeBookingId)
        ) {
          return '';
        }
        break;
      case 'end_trip_early':
        if (normalizedStatus !== 'started') {
          return '';
        }
        break;
      case 'end_after_interruption':
        if (
          normalizedStatus !== 'operational_interrupted' &&
          operationalContinuationStatus !== 'passenger_decision_pending'
        ) {
          return '';
        }
        break;
      case 'dismiss_receipt':
        if (normalizedStatus !== 'completed') {
          return '';
        }
        break;
      case 'open_receipt':
        if (normalizedStatus !== 'completed' && !passengerAutomationBookingKey) {
          return '';
        }
        break;
      case 'rate_last_receipt':
        if (!passengerAutomationBookingKey) {
          return '';
        }
        break;
      default:
        return '';
    }

    return [
      passengerAutomationConfig.action,
      bookingKey,
      normalizedStatus,
      operationalContinuationStatus || 'idle',
      nonce
    ].join(':');
  }, [
    activeBookingId,
    lastRideBookingId,
    lastReceipt?.id,
    normalizedBookingStatus,
    operationalContinuationStatus,
    passengerAutomationConfig.action,
    passengerAutomationConfig.automationEnabled,
    passengerAutomationConfig.bookingId,
    passengerAutomationConfig.nonce
  ]);
  const driverAutomationExecutionKey = useMemo(() => {
    if (!driverAutomationConfig.automationEnabled || !driverAutomationConfig.action) {
      return '';
    }

    if (driverAutomationConfig.action === 'set_online') {
      if (!effectiveDriverAutomationUid || !isDriverRole) {
        return '';
      }

      if (driverOnline && !driverOnlinePending) {
        return '';
      }

      return [
        driverAutomationConfig.action,
        driverAutomationStatus || 'idle',
        driverAutomationConfig.nonce || 'default'
      ].join(':');
    }

    if (driverAutomationConfig.action === 'set_offline') {
      if (!effectiveDriverAutomationUid || !isDriverRole) {
        return '';
      }

      if (!driverOnline && !driverOnlinePending) {
        return '';
      }

      return [
        driverAutomationConfig.action,
        driverAutomationStatus || 'idle',
        driverAutomationConfig.nonce || 'default'
      ].join(':');
    }

    if (driverAutomationConfig.action === 'rate_last_receipt') {
      if (!lastReceipt?.id) {
        return '';
      }
      return [
        driverAutomationConfig.action,
        lastReceipt.id,
        driverAutomationConfig.nonce || 'default'
      ].join(':');
    }

    if (!driverAutomationBookingKey) {
      return '';
    }

    switch (driverAutomationConfig.action) {
      case 'accept_offer':
      case 'reject_offer':
        if (
          (!driverLiveOffer && !driverAutomationConfig.bookingId) ||
          driverActiveRide?.bookingId ||
          driverActiveRide?.id
        ) {
          return '';
        }
        return [
          driverAutomationConfig.action,
          driverAutomationBookingKey,
          'offer',
          driverAutomationConfig.nonce || 'default'
        ].join(':');
      case 'arrive_pickup':
        if (driverAutomationStatus !== 'accepted') {
          return '';
        }
        break;
      case 'start_trip':
        if (driverAutomationStatus !== 'arrived') {
          return '';
        }
        break;
      case 'complete_trip':
        if (driverAutomationStatus !== 'started') {
          return '';
        }
        break;
      case 'interrupt_operational':
        if (driverAutomationStatus !== 'started') {
          return '';
        }
        break;
      case 'accept_extension':
      case 'reject_extension':
        if (
          String(driverExtensionRequest?.status || '').trim().toLowerCase() !==
          'driver_decision_pending'
        ) {
          return '';
        }
        break;
      default:
        return '';
    }

    return [
      driverAutomationConfig.action,
      driverAutomationBookingKey,
      driverAutomationStatus,
      driverAutomationConfig.nonce || 'default'
    ].join(':');
  }, [
    driverActiveRide?.bookingId,
    driverActiveRide?.id,
    driverAutomationBookingKey,
    driverAutomationConfig.action,
    driverAutomationConfig.automationEnabled,
    driverAutomationConfig.nonce,
    driverAutomationStatus,
    driverExtensionRequest?.status,
    driverOnline,
    driverOnlinePending,
    driverLiveOffer,
    effectiveDriverAutomationUid,
    isDriverRole,
    lastReceipt?.id,
  ]);
  const passengerAutoRoute = useMemo(() => {
    if (isDriverRole) {
      return null;
    }

    return resolvePassengerAutoRoute(bookingStatus);
  }, [bookingStatus, isDriverRole]);
  const runtimeVisualStateReady = Boolean(
    ready &&
      !initializing &&
      !presentationSyncing
  );
  const canShowPassengerHomeOverlay = Boolean(
    runtimeVisualStateReady &&
      showHomeChrome &&
      !isDriverRole &&
      !activeBookingId &&
      (!normalizedBookingStatus || normalizedBookingStatus === 'idle') &&
      !passengerAutoRoute
  );
  const shouldRenderRuntimeMapState = runtimeVisualStateReady;
  const presentedSearchingMode = Boolean(
    shouldRenderRuntimeMapState && isSearchingMode,
  );
  const presentedNearbyVehicles = presentedSearchingMode
    ? nearbyDriverCoordinates
    : [];
  const presentedRouteCoordinates = shouldRenderRuntimeMapState
    ? activeRoute.coordinates
    : [];
  const presentedRouteDestination = shouldRenderRuntimeMapState
    ? activeRoute.destination
    : null;
  const presentedRouteDestinationLabel = shouldRenderRuntimeMapState
    ? activeRoute.destinationLabel
    : '';
  const presentedRouteDestinationAddress = shouldRenderRuntimeMapState
    ? activeRoute.destinationAddress
    : '';
  const isLiveTripMapActive = ['accepted', 'arrived', 'started'].includes(
    normalizedBookingStatus
  );
  const driverTripAssistNativeNavigation = driverTripAssist?.nativeNavigation || null;
  const isPickupPhase =
    normalizedBookingStatus === 'accepted' ||
    normalizedBookingStatus === 'arrived';
  const mapShouldHideUserMarker =
    shouldRenderRuntimeMapState && isLiveTripMapActive;
  const activeDriverNavigationCoordinate =
    shouldRenderRuntimeMapState && isDriverRole && isLiveTripMapActive
      ? driverTripAssistNativeNavigation?.currentCoordinate ||
        driverCoordinate ||
        currentCoordinate ||
        null
      : currentCoordinate || null;
  const presentedDriverCoordinate = shouldRenderRuntimeMapState
    ? isDriverRole && isLiveTripMapActive
      ? activeDriverNavigationCoordinate
      : driverCoordinate
    : null;
  const driverMarkerMode =
    shouldRenderRuntimeMapState && isLiveTripMapActive ? 'avatar' : 'car';
  const driverMarkerLetter = useMemo(() => {
    if (isDriverRole) {
      return profileInitial;
    }

    return resolveProfileInitial({
      name: driverInfo?.name || driverActiveRide?.driverName || 'Motorista'
    });
  }, [driverActiveRide?.driverName, driverInfo?.name, isDriverRole, profileInitial]);
  const passengerMarkerLetter = useMemo(
    () =>
      resolveProfileInitial({
        name:
          driverActiveRide?.passenger ||
          activeBooking?.customerName ||
          activeBooking?.passengerName ||
          'Passageiro'
      }),
    [
      activeBooking?.customerName,
      activeBooking?.passengerName,
      driverActiveRide?.passenger
    ]
  );
  const destinationMarkerMode =
    shouldRenderRuntimeMapState && isDriverRole && isPickupPhase
      ? 'avatar'
      : 'place';
  const routeAnimate = !(shouldRenderRuntimeMapState && isLiveTripMapActive);
  const routeMainColor =
    shouldRenderRuntimeMapState && isLiveTripMapActive ? '#1A7F37' : null;
  const routeShadowColor =
    shouldRenderRuntimeMapState && isLiveTripMapActive
      ? 'rgba(26,127,55,0.20)'
      : null;
  const routeHighlightColor =
    shouldRenderRuntimeMapState && isLiveTripMapActive ? null : undefined;
  const hasDriverActiveRideContext = Boolean(
    driverActiveRide?.bookingId || driverActiveRide?.id
  );
  const hasDriverLiveOfferContext = Boolean(
    driverLiveOffer?.bookingId || driverLiveOffer?.id
  );
  const canRenderDriverRideChrome = Boolean(
    driverActivationResolved || hasDriverActiveRideContext
  );
  const hasDriverLiveRideOverlay = Boolean(
    runtimeVisualStateReady &&
      isDriverRole &&
      isHomeRoute &&
      canRenderDriverRideChrome &&
      (hasDriverActiveRideContext ||
        (driverActivationResolved && hasDriverLiveOfferContext))
  );
  const leafNativeNavigationModel = driverTripAssistNativeNavigation;
  const leafNativeNavigationKey = String(leafNativeNavigationModel?.navigationKey || '');
  const leafNativeNavigationCameraHeading = leafNativeNavigationModel?.cameraHeadingDegrees;
  const showLeafNativeNavigation = Boolean(
    runtimeVisualStateReady &&
      showHomeChrome &&
      isDriverRole &&
      isHomeRoute &&
      canRenderDriverRideChrome &&
      leafNativeNavigationModel?.isVisible &&
      leafNativeNavigationKey &&
      hiddenNativeNavigationKey !== leafNativeNavigationKey
  );
  const shouldFreezeBackgroundMapCamera = freezeBackgroundMapCamera;
  const showDriverHomeOverlay = Boolean(
    runtimeVisualStateReady &&
      isDriverRole &&
      isHomeRoute &&
      driverActivationResolved &&
      !hasDriverLiveRideOverlay
  );
  const showDriverH3Overlay = Boolean(
    isDriverRole && isHomeRoute && showDriverHomeOverlay
  );
  const driverLiveRideBottomOffset = hasDriverLiveRideOverlay ? 18 : DRIVER_BOTTOM_CTA_OFFSET + driverBottomCtaHeight + 12;
  const driverLiveRideOccludedBottom = insets.bottom + driverLiveRideBottomOffset + driverLiveRideHeight;
  const qaConnectionAutomationConfig = useMemo(
    () =>
      resolvePrototypeConnectionAutomationConfig(effectiveRouteParams, {
        activeRole: resolvedRole,
        isDev: Boolean(__DEV__),
        isE2E: isE2ETestBuild(),
      }),
    [effectiveRouteParams, resolvedRole]
  );
  const connectionIndicatorModel = useMemo(
    () => {
      if (!connectionIndicatorArmed && !showRecoveredConnectionHint) {
        return null;
      }

      return buildPrototypeConnectionIndicatorModel({
        activeRole: resolvedRole,
        bookingStatus: normalizedBookingStatus,
        driverOnline,
        driverOnlinePending,
        connecting,
        isSocketConnected,
        isSocketAuthenticated,
        requiresAuthentication: Boolean(profile?.uid),
        recentlyRecovered: showRecoveredConnectionHint,
      });
    },
    [
      connectionIndicatorArmed,
      connecting,
      driverOnline,
      driverOnlinePending,
      isSocketAuthenticated,
      isSocketConnected,
      normalizedBookingStatus,
      profile?.uid,
      resolvedRole,
      showRecoveredConnectionHint,
    ]
  );
  const effectiveConnectionIndicatorModel = useMemo(() => {
    if (!qaConnectionVisualState?.mode) {
      return connectionIndicatorModel;
    }

    const indicatorBase = {
      activeRole: resolvedRole,
      bookingStatus: normalizedBookingStatus,
      driverOnline,
      driverOnlinePending,
      requiresAuthentication: Boolean(profile?.uid),
      forceVisible: true,
    };

    if (qaConnectionVisualState.mode === 'lost') {
      return buildPrototypeConnectionIndicatorModel({
        ...indicatorBase,
        connecting: false,
        isSocketConnected: false,
        isSocketAuthenticated: false,
        recentlyRecovered: false,
      });
    }

    if (qaConnectionVisualState.mode === 'reconnecting') {
      return buildPrototypeConnectionIndicatorModel({
        ...indicatorBase,
        connecting: true,
        isSocketConnected: false,
        isSocketAuthenticated: false,
        recentlyRecovered: false,
      });
    }

    if (qaConnectionVisualState.mode === 'recovered') {
      return buildPrototypeConnectionIndicatorModel({
        ...indicatorBase,
        connecting: false,
        isSocketConnected: true,
        isSocketAuthenticated: true,
        recentlyRecovered: true,
      });
    }

    return connectionIndicatorModel;
  }, [
    connectionIndicatorModel,
    driverOnline,
    driverOnlinePending,
    normalizedBookingStatus,
    profile?.uid,
    qaConnectionVisualState?.mode,
    resolvedRole,
  ]);
  const connectionIndicatorTopOffset = useMemo(
    () => insets.top + (showHomeChrome ? 66 : 14),
    [insets.top, showHomeChrome]
  );
  const effectiveConnectionIndicatorKey = useMemo(() => {
    if (!effectiveConnectionIndicatorModel?.title) {
      return 'none';
    }

    return [
      effectiveConnectionIndicatorModel.tone || 'warning',
      effectiveConnectionIndicatorModel.icon || 'sync-outline',
      effectiveConnectionIndicatorModel.title || '',
      effectiveConnectionIndicatorModel.message || '',
    ].join(':');
  }, [
    effectiveConnectionIndicatorModel?.icon,
    effectiveConnectionIndicatorModel?.message,
    effectiveConnectionIndicatorModel?.title,
    effectiveConnectionIndicatorModel?.tone,
  ]);
  const homeOccludedBottom = isHomeRoute
    ? (isDriverRole
        ? Math.max(showDriverHomeOverlay ? driverOccludedBottom : 0, hasDriverLiveRideOverlay ? driverLiveRideOccludedBottom : 0)
        : passengerOccludedBottom)
    : 0;
  const baselineOccludedBottom = isDriverRole ? driverOccludedBottom : passengerOccludedBottom;
  const driverFinancialHistory = useMemo(() => {
    const mergedHistory = [lastReceipt, ...(Array.isArray(tripHistory) ? tripHistory : [])]
      .filter(Boolean);
    const seenIds = new Set();

    return mergedHistory.filter((item, index) => {
      const id = String(
        item?.id ||
          item?.bookingId ||
          item?.completedAt ||
          item?.date ||
          `driver-runtime-history-${index}`
      ).trim();

      if (seenIds.has(id)) {
        return false;
      }

      seenIds.add(id);
      return true;
    });
  }, [lastReceipt, tripHistory]);
  const driverTripTotals = useMemo(
    () => buildTripFinancialTotals(driverFinancialHistory, { role: 'driver' }),
    [driverFinancialHistory]
  );
  const todayEarnings = driverTripTotals.totalNet;
  const todayTrips = driverTripTotals.count;
  const formattedDriverEarnings = useMemo(
    () => formatCurrencyBRL(todayEarnings || 0),
    [todayEarnings]
  );
  const passengerSearchOriginAddress = useMemo(
    () =>
      resolveMeaningfulAddress(
        activeBooking?.pickupLocation?.add,
        currentAddress
      ) || 'Sua localização atual',
    [activeBooking?.pickupLocation?.add, currentAddress]
  );
  const passengerSearchDestinationAddress = useMemo(
    () =>
      sanitizeRouteText(
        selectedDestination?.address ||
          activeBooking?.destinationLocation?.add ||
          selectedDestination?.name
      ),
    [activeBooking?.destinationLocation?.add, selectedDestination?.address, selectedDestination?.name]
  );
  const passengerSearchDestinationLabel = useMemo(
    () =>
      sanitizeRouteText(
        selectedDestination?.name ||
          compactPlaceLabel(passengerSearchDestinationAddress, '') ||
          compactPlaceLabel(activeBooking?.destinationLocation?.add, '')
      ) || 'Destino',
    [
      activeBooking?.destinationLocation?.add,
      passengerSearchDestinationAddress,
      selectedDestination?.name
    ]
  );
  const liveRouteTrackingCoordinate = useMemo(() => {
    if (
      !hasActiveRoute ||
      !hasDriverLiveRideOverlay ||
      !['accepted', 'started'].includes(normalizedBookingStatus)
    ) {
      return null;
    }

    return driverCoordinate || currentCoordinate || activeRoute.origin || null;
  }, [
    activeRoute.origin,
    currentCoordinate,
    driverCoordinate,
    hasActiveRoute,
    hasDriverLiveRideOverlay,
    normalizedBookingStatus
  ]);
  const liveRouteTrackingKey = useMemo(() => {
    if (!liveRouteTrackingCoordinate) {
      return '';
    }

    return [
      Math.round(Number(liveRouteTrackingCoordinate.latitude || 0) * 10000),
      Math.round(Number(liveRouteTrackingCoordinate.longitude || 0) * 10000)
    ].join(':');
  }, [liveRouteTrackingCoordinate]);
  const showPassengerBottomIsland = Boolean(
    runtimeVisualStateReady &&
      showHomeChrome &&
      !isDriverRole &&
      !isDriverRoute &&
      normalizedBookingStatus === 'idle'
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
      if (connectionRecoveredTimerRef.current) {
        clearTimeout(connectionRecoveredTimerRef.current);
      }
      if (connectionIndicatorStableTimerRef.current) {
        clearTimeout(connectionIndicatorStableTimerRef.current);
      }
      if (Array.isArray(connectionAutomationTimersRef.current)) {
        connectionAutomationTimersRef.current.forEach((timer) => clearTimeout(timer));
        connectionAutomationTimersRef.current = [];
      }
    };
  }, []);

  useEffect(() => {
    if (effectiveConnectionIndicatorKey === displayedConnectionIndicatorKeyRef.current) {
      return undefined;
    }

    const nextIndicatorModel = effectiveConnectionIndicatorModel
      ? { ...effectiveConnectionIndicatorModel }
      : null;

    if (connectionIndicatorStableTimerRef.current) {
      clearTimeout(connectionIndicatorStableTimerRef.current);
    }

    connectionIndicatorStableTimerRef.current = setTimeout(() => {
      displayedConnectionIndicatorKeyRef.current = effectiveConnectionIndicatorKey;
      setDisplayedConnectionIndicatorModel(nextIndicatorModel);
      connectionIndicatorStableTimerRef.current = null;
    }, CONNECTION_STATUS_STABILITY_MS);

    return () => {
      if (connectionIndicatorStableTimerRef.current) {
        clearTimeout(connectionIndicatorStableTimerRef.current);
        connectionIndicatorStableTimerRef.current = null;
      }
    };
  }, [effectiveConnectionIndicatorKey]);

  useEffect(() => {
    const isHealthy =
      Boolean(isSocketConnected) && (!profile?.uid || isSocketAuthenticated);
    const wasHealthy = lastConnectionHealthyRef.current;

    if (!hasConnectionSnapshotRef.current) {
      hasConnectionSnapshotRef.current = true;
      lastConnectionHealthyRef.current = isHealthy;
      if (isHealthy) {
        setConnectionIndicatorArmed(true);
      }
      return;
    }

    if (!wasHealthy && isHealthy) {
      setConnectionIndicatorArmed(true);
      if (
        qaConnectionVisualState?.mode === 'lost' ||
        qaConnectionVisualState?.mode === 'reconnecting'
      ) {
        setQaConnectionVisualState({ mode: 'recovered' });
      }
      setShowRecoveredConnectionHint(true);
      if (connectionRecoveredTimerRef.current) {
        clearTimeout(connectionRecoveredTimerRef.current);
      }
      connectionRecoveredTimerRef.current = setTimeout(() => {
        setShowRecoveredConnectionHint(false);
        setQaConnectionVisualState((currentState) =>
          currentState?.mode === 'recovered' ? null : currentState
        );
      }, 2600);
    } else if (!isHealthy) {
      setShowRecoveredConnectionHint(false);
      if (connectionRecoveredTimerRef.current) {
        clearTimeout(connectionRecoveredTimerRef.current);
        connectionRecoveredTimerRef.current = null;
      }
    }

    lastConnectionHealthyRef.current = isHealthy;
  }, [isSocketAuthenticated, isSocketConnected, profile?.uid]);

  useEffect(() => {
    if (
      !shouldRunPrototypeConnectionAutomation(qaConnectionAutomationConfig, {
        activeRole: resolvedRole,
        bookingStatus: normalizedBookingStatus,
        driverOnline,
      })
    ) {
      return undefined;
    }

    const executionKey = [
      qaConnectionAutomationConfig.scenario,
      qaConnectionAutomationConfig.triggerState,
      qaConnectionAutomationConfig.role || resolvedRole,
      normalizedBookingStatus || 'idle',
      driverOnline ? 'online' : 'offline',
      qaConnectionAutomationConfig.nonce || 'default',
    ].join(':');

    if (connectionAutomationExecutionRef.current === executionKey) {
      return undefined;
    }

    connectionAutomationExecutionRef.current = executionKey;
    const socket = WebSocketManager.getInstance();
    const timers = [];
    const reconnectingLeadMs = Math.min(
      Math.max(1200, Math.round(qaConnectionAutomationConfig.recoveryMs * 0.22)),
      4000
    );

    timers.push(
      setTimeout(() => {
        setQaConnectionVisualState({ mode: 'lost' });
        socket.disconnect();

        if (qaConnectionAutomationConfig.scenario === 'drop_and_recover') {
          const reconnectingDelayMs = Math.max(
            0,
            qaConnectionAutomationConfig.recoveryMs - reconnectingLeadMs
          );

          if (reconnectingDelayMs > 0) {
            timers.push(
              setTimeout(() => {
                setQaConnectionVisualState({ mode: 'reconnecting' });
              }, reconnectingDelayMs)
            );
          }

          timers.push(
            setTimeout(() => {
              setQaConnectionVisualState({ mode: 'reconnecting' });
              socket.connect().catch(() => {});
            }, qaConnectionAutomationConfig.recoveryMs)
          );
        }
      }, qaConnectionAutomationConfig.delayMs)
    );

    connectionAutomationTimersRef.current = timers;

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      if (connectionAutomationTimersRef.current === timers) {
        connectionAutomationTimersRef.current = [];
      }
    };
  }, [
    driverOnline,
    normalizedBookingStatus,
    qaConnectionAutomationConfig,
    resolvedRole,
  ]);

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
    const upperAreaBias = Math.round(routeAreaHeight * (hasDriverLiveRideOverlay ? 0.36 : 0.28));
    const maxBottomPadding = Math.max(baseBottomPadding, mapHeight - topPadding - 84);
    const bottomPadding = Math.min(maxBottomPadding, baseBottomPadding + upperAreaBias + ROUTE_BOTTOM_EXTRA_PADDING);

    return {
      top: topPadding,
      right: ROUTE_SIDE_PADDING,
      left: ROUTE_SIDE_PADDING,
      bottom: bottomPadding
    };
  }, [activeOcclusion.bottom, activeOcclusion.top, hasDriverLiveRideOverlay, insets.bottom, insets.top, mapHeight]);

  const focusRoute = useCallback((routePayload, animatedFit = true) => {
    if (!mapRef.current || !routePayload) {
      return;
    }

    const coordinates = Array.isArray(routePayload?.coordinates)
      ? routePayload.coordinates
      : [];
    if (coordinates.length < 2) {
      return;
    }

    const edgePadding = getRouteEdgePadding();
    mapRef.current.animateCamera({ heading: 0, pitch: 0 }, { duration: animatedFit ? 220 : 0 });
    mapRef.current.fitToCoordinates(coordinates, {
      edgePadding,
      animated: animatedFit
    });
  }, [getRouteEdgePadding]);

  const focusSearchArea = useCallback((animatedFit = true) => {
    if (!mapRef.current || !isSearchingMode || !searchTargetRegion) {
      return;
    }

    mapRef.current.animateToRegion(
      searchTargetRegion,
      animatedFit ? SEARCH_ZOOM_ANIMATION_MS : 0
    );
  }, [
    isSearchingMode,
    searchTargetRegion
  ]);

  useEffect(() => {
    if (!mapRef.current || !hasActiveRoute || !routeLayoutKey || isSearchingMode) {
      return;
    }

    const routeFocusTrackingKey = showLeafNativeNavigation
      ? leafNativeNavigationKey || 'leaf-native-navigation'
      : liveRouteTrackingKey;
    const nextRouteFocusKey = `${routeLayoutKey}|${routeFocusTrackingKey}`;
    if (lastRouteLayoutKeyRef.current === nextRouteFocusKey) {
      return;
    }

    lastRouteLayoutKeyRef.current = nextRouteFocusKey;
    focusRoute(activeRoute, true);
  }, [
    activeRoute,
    focusRoute,
    hasActiveRoute,
    isSearchingMode,
    leafNativeNavigationKey,
    liveRouteTrackingKey,
    routeLayoutKey,
    showLeafNativeNavigation,
  ]);

  useEffect(() => {
    if (!mapRef.current || hasActiveRoute || isSearchingMode || shouldFreezeBackgroundMapCamera) {
      return;
    }

    if (!mapFollowingUser) {
      return;
    }

    lastRouteLayoutKeyRef.current = '';
    mapRef.current.animateToRegion(targetRegion, MAP_OCCLUSION_REPOSITION_MS);
  }, [hasActiveRoute, isSearchingMode, mapFollowingUser, shouldFreezeBackgroundMapCamera, targetRegion]);

  useEffect(() => {
    if (!isSearchingMode) {
      setNearbyDriverCoordinates((previous) => (
        Array.isArray(previous) && previous.length === 0 ? previous : []
      ));
      return;
    }

    const innerVehicleCount = Math.min(6, searchPresentation.nearbyVehiclesCount);
    const baseInnerVehicles = buildNearbyVehicleCoordinates(searchCenterCoordinate, {
      minDistanceKm: 0.42,
      maxDistanceKm: Math.max(0.78, Math.min(searchRadiusKm * 0.9, 1.6)),
      count: innerVehicleCount,
      seedBase: 21,
      prefix: 'inner'
    });

    if (!Number.isFinite(searchRadiusKm) || searchRadiusKm <= 1.1) {
      setNearbyDriverCoordinates(baseInnerVehicles);
      return;
    }

    const outerVehicleCount = Math.max(0, searchPresentation.nearbyVehiclesCount - innerVehicleCount);
    const outerVehicles = buildNearbyVehicleCoordinates(searchCenterCoordinate, {
      minDistanceKm: Math.max(1.15, searchRadiusKm * 0.42),
      maxDistanceKm: searchRadiusKm * 0.98,
      count: outerVehicleCount,
      seedBase: 77,
      prefix: 'outer'
    });

    setNearbyDriverCoordinates([...baseInnerVehicles, ...outerVehicles]);
  }, [isSearchingMode, searchCenterCoordinate, searchPresentation.nearbyVehiclesCount, searchRadiusKm]);

  useEffect(() => {
    if (!mapRef.current || !isSearchingMode || !searchRegion) {
      return;
    }

    const changedRadius = lastSearchRadiusRef.current !== searchRadiusKm;
    lastSearchRadiusRef.current = searchRadiusKm;
    focusSearchArea(changedRadius);
  }, [focusSearchArea, isSearchingMode, searchRadiusKm, searchRegion]);

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

    if (hasActiveRoute || shouldFreezeBackgroundMapCamera) {
      if (!hasActiveRoute) {
        return;
      }
      const routeFocusTrackingKey = showLeafNativeNavigation
        ? leafNativeNavigationKey || 'leaf-native-navigation'
        : liveRouteTrackingKey;
      lastRouteLayoutKeyRef.current = `${routeLayoutKey}|${routeFocusTrackingKey}`;
      focusRoute(activeRoute, true);
      return;
    }

    setMapFollowingUser(true);
    lastRouteLayoutKeyRef.current = '';
    mapRef.current.animateToRegion(targetRegion, MAP_RETURN_REPOSITION_MS);
  }, [
    activeRoute,
    focusRoute,
    hasActiveRoute,
    isSearchingMode,
    leafNativeNavigationKey,
    liveRouteTrackingKey,
    routeLayoutKey,
    shouldFreezeBackgroundMapCamera,
    showLeafNativeNavigation,
    targetRegion,
  ]);

  const handleCenterMap = useCallback(() => {
    if (mapRef.current) {
      setMapFollowingUser(true);

      if (isSearchingMode && searchRegion) {
        focusSearchArea(true);
        return;
      }

      if (hasActiveRoute) {
        lastRouteLayoutKeyRef.current = routeLayoutKey;
        focusRoute(activeRoute, true);
        return;
      }
      lastRouteLayoutKeyRef.current = '';
      mapRef.current.animateToRegion(targetRegion, MAP_OCCLUSION_REPOSITION_MS);
    }
  }, [activeRoute, focusRoute, focusSearchArea, hasActiveRoute, isSearchingMode, routeLayoutKey, searchRegion, targetRegion]);

  const handleHideLeafNativeNavigation = useCallback(() => {
    if (!leafNativeNavigationKey) {
      return;
    }

    setHiddenNativeNavigationKey(leafNativeNavigationKey);
  }, [leafNativeNavigationKey]);

  const handleMapPanDrag = useCallback(() => {
    lastManualMapPanAtRef.current = Date.now();

    if (hasActiveRoute || isSearchingMode) {
      return;
    }

    setMapFollowingUser(false);
  }, [hasActiveRoute, isSearchingMode]);

  useEffect(() => {
    lastNativeNavigationCameraAtRef.current = 0;
    lastNativeNavigationHeadingRef.current = null;
  }, [leafNativeNavigationKey]);

  useEffect(() => {
    if (
      !showLeafNativeNavigation ||
      !mapRef.current ||
      !activeDriverNavigationCoordinate ||
      isSearchingMode ||
      shouldFreezeBackgroundMapCamera
    ) {
      return;
    }

    const now = Date.now();
    if (now - lastNativeNavigationCameraAtRef.current < LEAF_NATIVE_NAV_CAMERA_THROTTLE_MS) {
      return;
    }

    if (now - lastManualMapPanAtRef.current < LEAF_NATIVE_NAV_MANUAL_PAN_PAUSE_MS) {
      return;
    }

    lastNativeNavigationCameraAtRef.current = now;
    const resolvedCameraHeading = resolveSmoothedNavigationHeading(
      lastNativeNavigationHeadingRef.current,
      leafNativeNavigationCameraHeading ?? currentHeading,
    );
    lastNativeNavigationHeadingRef.current = resolvedCameraHeading;
    mapRef.current.animateCamera(
      {
        center: {
          latitude: activeDriverNavigationCoordinate.latitude,
          longitude: activeDriverNavigationCoordinate.longitude,
        },
        zoom: LEAF_NATIVE_NAV_CAMERA_ZOOM,
        heading: resolvedCameraHeading ?? 0,
        pitch: 0,
      },
      { duration: LEAF_NATIVE_NAV_CAMERA_ANIMATION_MS }
    );
    appendPrototypeRuntimeDebugStep('leaf_native_camera_follow', {
      key: leafNativeNavigationKey,
      latitude: Number(activeDriverNavigationCoordinate.latitude.toFixed(6)),
      longitude: Number(activeDriverNavigationCoordinate.longitude.toFixed(6)),
      heading: Number.isFinite(Number(resolvedCameraHeading))
        ? Number(Number(resolvedCameraHeading).toFixed(1))
        : 0,
      routeHeading: Number.isFinite(Number(leafNativeNavigationCameraHeading))
        ? Number(Number(leafNativeNavigationCameraHeading).toFixed(1))
        : null,
      zoom: LEAF_NATIVE_NAV_CAMERA_ZOOM,
      throttleMs: LEAF_NATIVE_NAV_CAMERA_THROTTLE_MS,
      animationMs: LEAF_NATIVE_NAV_CAMERA_ANIMATION_MS,
    });
  }, [
    activeDriverNavigationCoordinate,
    currentHeading,
    isSearchingMode,
    leafNativeNavigationCameraHeading,
    leafNativeNavigationKey,
    shouldFreezeBackgroundMapCamera,
    showLeafNativeNavigation,
  ]);

  const handleMapRegionChangeComplete = useCallback((nextRegion) => {
    if (!showDriverH3Overlay || !nextRegion) {
      return;
    }
    setVisibleMapRegion(nextRegion);
  }, [showDriverH3Overlay]);

  const handleMapLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setMapHeight(previous => (previous === nextHeight ? previous : nextHeight));
    }
  }, []);

  const handleSearchCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setHomeCardHeight(previous => (previous === nextHeight ? previous : nextHeight));
    }
  }, []);

  const handleDriverCtaLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setDriverBottomCtaHeight(previous => (previous === nextHeight ? previous : nextHeight));
    }
  }, []);

  const handleOpenDriverActivation = useCallback(() => {
    appendPrototypeRuntimeDebugStep('driver_home_activation_open_requested', {
      driverOnline,
      driverOnlinePending,
      driverCanGoOnline,
      driverActivationResolved
    });
    navigation.navigate('RobotaxiPrototypeDriverActivation');
  }, [
    driverActivationResolved,
    driverCanGoOnline,
    driverOnline,
    driverOnlinePending,
    navigation
  ]);

    const handleDriverOnlineToggle = useCallback(async () => {
      appendPrototypeRuntimeDebugStep('driver_home_toggle_pressed', {
        driverOnline,
        driverOnlinePending,
        driverCanGoOnline,
        driverActivationResolved
      });
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
          return;
        }

        if (result?.success === false) {
          const resultError = result?.error || 'Não foi possível atualizar o status online agora.';
          const isLocationIssue = /localiza|location|permiss/i.test(resultError);
          if (nextValue && isLocationIssue) {
            Alert.alert(
              'Ative a localização para ficar online',
              'A Leaf precisa da sua localização para mostrar corridas próximas e manter a viagem sincronizada com segurança.',
              [
                { text: 'Agora não', style: 'cancel' },
                { text: 'Abrir Ajustes', onPress: () => Linking.openSettings() }
              ],
              { __skipFriendlyAlertPatch: true }
            );
            return;
          }

          Alert.alert(
            'Modo motorista',
            resultError
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
  }, [
    driverActivationResolved,
    driverCanGoOnline,
    driverOnline,
    driverOnlinePending,
    navigation,
    setDriverOnline
  ]);

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
    if (!passengerAutomationExecutionKey || !passengerAutomationConfig.action) {
      return;
    }

    if (lastPassengerAutomationExecutionRef.current === passengerAutomationExecutionKey) {
      return;
    }

    if (!tryStartPrototypePassengerAutomationExecution(passengerAutomationExecutionKey)) {
      return;
    }

    lastPassengerAutomationExecutionRef.current = passengerAutomationExecutionKey;
    if (
      persistedPassengerAutomationCommand &&
      passengerAutomationConfig.nonce === persistedPassengerAutomationCommand.nonce &&
      passengerAutomationConfig.action ===
        normalizePassengerAction(persistedPassengerAutomationCommand.action)
    ) {
      setPersistedPassengerAutomationCommand(null);
    }
    let active = true;

    const runPassengerAutomationAction = async () => {
      try {
        if (passengerAutomationConfig.action === 'request_seeded_destination') {
          const runtimeSelectedDestination = selectedDestination?.coordinate
            ? selectedDestination
            : null;
          const destination = runtimeSelectedDestination || QA_SEEDED_DESTINATION;

          if (!destination?.coordinate) {
            throw new Error('Nenhum destino semeado disponível para a automação QA.');
          }

          const fareValue = Number(selectedFare);
          const resolvedFare =
            Number.isFinite(fareValue) && fareValue > 0 ? fareValue : 74.93;
          const paymentReference = `qa_bypass_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`;

          await appendPrototypeRuntimeDebugStep(
            'passenger_home_automation_request_seeded_destination',
            {
              destinationName: destination?.name || '',
              destinationAddress: destination?.address || '',
              fare: resolvedFare,
              source: runtimeSelectedDestination?.coordinate
                ? 'selected_destination'
                : 'qa_seeded_destination',
            }
          );

          await requestRide({
            destination,
            originAddress: currentAddress || 'Origem atual',
            vehicle: selectedVehicle || 'Leaf Plus',
            fare: resolvedFare,
            paymentMethod: paymentMethod || 'pix',
            paymentConfirmation: {
              chargeId: paymentReference,
              rideId: paymentReference,
              amountInCents: Math.round(resolvedFare * 100),
              bypassed: true,
              mockPayment: true,
            },
          });
          return;
        }

        if (passengerAutomationConfig.action === 'dismiss_receipt') {
          dismissCompletedReceipt();
          return;
        }

        if (passengerAutomationConfig.action === 'open_receipt') {
          const targetReceiptBookingId =
            passengerAutomationConfig.bookingId || lastReceipt?.id || lastRideBookingId || '';
          const recovery = await recoverCompletedReceipt({
            reason: 'passenger_home_automation_open_receipt',
            bookingId: targetReceiptBookingId,
            force: true,
          });
          const rootNavigation = globalThis?.navigationRef;
          const receiptParams = { fromTrip: true };

          if (rootNavigation?.isReady?.()) {
            rootNavigation.navigate('RobotaxiPrototypeReceipt', receiptParams);
          } else {
            navigation.navigate('RobotaxiPrototypeReceipt', receiptParams);
          }

          await appendPrototypeRuntimeDebugStep('passenger_home_automation_open_receipt', {
            bookingStatus: bookingStatus || '',
            requestedBookingId: targetReceiptBookingId,
            recovery,
            viaRootNavigation: Boolean(rootNavigation?.isReady?.()),
          });
          return;
        }

        if (passengerAutomationConfig.action === 'rate_last_receipt') {
          const targetReceiptBookingId =
            passengerAutomationConfig.bookingId || lastReceipt?.id || lastRideBookingId || '';
          const recovery = await recoverCompletedReceipt({
            reason: 'passenger_home_automation_rate_last_receipt',
            bookingId: targetReceiptBookingId,
            force: true,
          });
          await submitCompletedReceiptRating({
            reviewerType: 'passenger',
            rating: 5,
            comment: 'Android Release passageiro',
            airConditioningOk: true,
          });
          await appendPrototypeRuntimeDebugStep('passenger_home_automation_rate_last_receipt', {
            requestedBookingId: targetReceiptBookingId,
            recovery,
            receiptId: lastReceipt?.id || targetReceiptBookingId,
          });
          return;
        }

        if (passengerAutomationConfig.action === 'end_after_interruption') {
          await respondOperationalContinuationFlow(false);
          return;
        }

        if (passengerAutomationConfig.action === 'end_trip_early') {
          await endTripEarlyFlow('QA_CLEANUP');
          return;
        }

        if (passengerAutomationConfig.action === 'cancel_search') {
          await cancelRideSearch();
          return;
        }

        if (passengerAutomationConfig.action === 'cleanup_active') {
          const currentStatus = String(bookingStatus || '').trim().toLowerCase();
          const currentOperationalStatus = String(operationalContinuation?.status || '')
            .trim()
            .toLowerCase();

          if (currentStatus === 'completed') {
            dismissCompletedReceipt();
            return;
          }

          if (
            currentStatus === 'operational_interrupted' ||
            currentOperationalStatus === 'passenger_decision_pending'
          ) {
            await respondOperationalContinuationFlow(false);
            return;
          }

          if (currentStatus === 'started') {
            await endTripEarlyFlow('QA_CLEANUP');
            return;
          }

          if (
            ['requesting', 'searching', 'searching_replacement', 'accepted', 'arrived'].includes(
              currentStatus
            ) ||
            activeBookingId
          ) {
            await cancelRideSearch();
          }
        }
      } catch (error) {
        if (active) {
          console.warn(
            '[passenger-home-qa-automation]',
            passengerAutomationConfig.action,
            error?.message || error
          );
        }
      }
    };

    runPassengerAutomationAction();

    return () => {
      active = false;
    };
  }, [
    activeBookingId,
    bookingStatus,
    cancelRideSearch,
    dismissCompletedReceipt,
    endTripEarlyFlow,
    currentAddress,
    lastRideBookingId,
    lastReceipt?.id,
    navigation,
    operationalContinuation?.status,
    passengerAutomationConfig.action,
    passengerAutomationConfig.bookingId,
    passengerAutomationExecutionKey,
    passengerAutomationConfig.nonce,
    paymentMethod,
    persistedPassengerAutomationCommand,
    respondOperationalContinuationFlow,
    requestRide,
    recoverCompletedReceipt,
    selectedFare,
    selectedVehicle,
    submitCompletedReceiptRating,
  ]);

  useEffect(() => {
    if (!isDriverRole || !isHomeRoute) {
      return;
    }

    if (!driverAutomationExecutionKey || !driverAutomationConfig.action) {
      if (
        routeDriverAutomationConfig.automationEnabled ||
        liveDriverAutomationCommand ||
        persistedDriverAutomationCommand ||
        driverAutomationConfig.action
      ) {
        appendPrototypeRuntimeDebugStep('driver_home_automation_no_execution_key', {
          currentRouteName,
          isScreenFocused,
          isHomeRoute,
          action: driverAutomationConfig.action || '',
          bookingId: driverAutomationConfig.bookingId || '',
          liveAction: liveDriverAutomationCommand?.action || '',
          liveBookingId: liveDriverAutomationCommand?.bookingId || '',
          executionKey: driverAutomationExecutionKey || '',
          liveOfferBookingId: driverLiveOffer?.bookingId || driverLiveOffer?.id || '',
          activeRideBookingId: driverActiveRide?.bookingId || driverActiveRide?.id || '',
        });
      }
      return;
    }

    if (
      lastDriverAutomationExecutionRef.current === driverAutomationExecutionKey ||
      !tryStartPrototypeDriverAutomationExecution(driverAutomationExecutionKey)
    ) {
      return;
    }

    lastDriverAutomationExecutionRef.current = driverAutomationExecutionKey;
    clearPrototypeHomeAutomationPayload();
    appendPrototypeRuntimeDebugStep('driver_home_automation_execute', {
      action: driverAutomationConfig.action,
      nonce: driverAutomationConfig.nonce || '',
      bookingId: driverAutomationConfig.bookingId || '',
      executionKey: driverAutomationExecutionKey,
      liveOfferBookingId: driverLiveOffer?.bookingId || driverLiveOffer?.id || '',
    });
    if (
      liveDriverAutomationCommand &&
      driverAutomationConfig.nonce === liveDriverAutomationCommand.nonce &&
      driverAutomationConfig.action === liveDriverAutomationCommand.action
    ) {
      setLiveDriverAutomationCommand(null);
    }
    if (
      persistedDriverAutomationCommand &&
      driverAutomationConfig.nonce === persistedDriverAutomationCommand.nonce &&
      driverAutomationConfig.action === persistedDriverAutomationCommand.action
    ) {
      setPersistedDriverAutomationCommand(null);
    }
    let active = true;

    const runDriverAutomationAction = async () => {
      try {
        const driverAutomationLocationOverride =
          driverTripAssist?.targetCoordinate ||
          driverTripAssist?.pickupCoordinate ||
          driverTripAssist?.destinationCoordinate ||
          null;
        const targetedDriverOffer =
          driverAutomationConfig.bookingId &&
          String(driverLiveOffer?.bookingId || driverLiveOffer?.id || '') !==
            String(driverAutomationConfig.bookingId || '')
            ? { bookingId: driverAutomationConfig.bookingId }
            : driverLiveOffer ||
              (driverAutomationConfig.bookingId
                ? { bookingId: driverAutomationConfig.bookingId }
                : null);

        if (driverAutomationConfig.action === 'set_online') {
          await setDriverOnline(true);
          return;
        }

        if (driverAutomationConfig.action === 'set_offline') {
          await setDriverOnline(false);
          return;
        }

        if (driverAutomationConfig.action === 'accept_offer') {
          await acceptDriverOffer(targetedDriverOffer);
          return;
        }

        if (driverAutomationConfig.action === 'reject_offer') {
          await rejectDriverOffer(
            targetedDriverOffer,
            'Recusada pela automação QA.',
          );
          return;
        }

        if (driverAutomationConfig.action === 'arrive_pickup') {
          await markDriverArrived(
            driverAutomationLocationOverride
              ? { locationOverride: driverAutomationLocationOverride }
              : undefined
          );
          return;
        }

        if (driverAutomationConfig.action === 'start_trip') {
          await startTripFlow(
            driverAutomationLocationOverride
              ? { locationOverride: driverAutomationLocationOverride }
              : undefined
          );
          return;
        }

        if (driverAutomationConfig.action === 'complete_trip') {
          const result = await completeTripFlow(
            driverAutomationLocationOverride
              ? { locationOverride: driverAutomationLocationOverride }
              : undefined
          );
          if (active && result?.success !== false) {
            navigation.navigate('RobotaxiPrototypeReceipt', { fromTrip: true });
          }
          return;
        }

        if (driverAutomationConfig.action === 'rate_last_receipt') {
          await submitCompletedReceiptRating({
            reviewerType: 'driver',
            rating: 5,
            comment: 'Android Release motorista',
          });
          return;
        }

        if (driverAutomationConfig.action === 'interrupt_operational') {
          await interruptRideOperationalFlow({
            reason: 'VEHICLE_BREAKDOWN'
          });
          return;
        }

        if (driverAutomationConfig.action === 'accept_extension') {
          await respondToDriverExtension(true);
          return;
        }

        if (driverAutomationConfig.action === 'reject_extension') {
          await respondToDriverExtension(false);
        }
      } catch (error) {
        appendPrototypeRuntimeDebugStep('driver_home_automation_error', {
          action: driverAutomationConfig.action || '',
          bookingId: driverAutomationConfig.bookingId || '',
          nonce: driverAutomationConfig.nonce || '',
          message: error?.message || String(error),
        });
        console.warn(
          '[driver-home-qa-automation]',
          driverAutomationConfig.action,
          error?.message || error
        );
      }
    };

    runDriverAutomationAction();

    return () => {
      active = false;
    };
  }, [
    acceptDriverOffer,
    completeTripFlow,
    driverAutomationConfig.action,
    driverAutomationConfig.nonce,
    driverAutomationExecutionKey,
    driverActiveRide?.bookingId,
    driverActiveRide?.id,
    driverTripAssist?.destinationCoordinate?.latitude,
    driverTripAssist?.destinationCoordinate?.longitude,
    driverTripAssist?.pickupCoordinate?.latitude,
    driverTripAssist?.pickupCoordinate?.longitude,
    driverTripAssist?.targetCoordinate?.latitude,
    driverTripAssist?.targetCoordinate?.longitude,
    driverLiveOffer,
    currentRouteName,
    isDriverRole,
    isHomeRoute,
    liveDriverAutomationCommand,
    markDriverArrived,
    navigation,
    persistedDriverAutomationCommand,
    rejectDriverOffer,
    routeDriverAutomationConfig.automationEnabled,
    setDriverOnline,
    startTripFlow,
    submitCompletedReceiptRating
  ]);

  useEffect(() => {
    if (
      !SHOULD_AUTO_OPEN_DRIVER_NAVIGATION ||
      !isDriverRole ||
      !isHomeRoute ||
      !driverTripAssist?.status
    ) {
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

  useEffect(() => {
    if (!runtimeVisualStateReady) {
      return;
    }

    if (isDriverRole) {
      return;
    }

    if (!passengerAutoRoute) {
      return;
    }

    // The destination screen owns its own lifecycle transitions, including
    // in-trip extension flows. Letting the underlying home screen auto-route
    // while Destination is focused causes it to bounce straight back to Trip.
    if (currentRouteName === 'RobotaxiPrototypeDestination') {
      return;
    }

    if (currentRouteName === passengerAutoRoute) {
      return;
    }

    const isReceiptSubflowRoute =
      passengerAutoRoute === 'RobotaxiPrototypeReceipt' &&
      [
        'RobotaxiPrototypeRating',
        'RobotaxiPrototypeComplain',
      ].includes(currentRouteName);

    if (isReceiptSubflowRoute) {
      return;
    }

    const commonParams = {
      destination: passengerSearchDestinationLabel,
      destinationAddress:
        passengerSearchDestinationAddress || passengerSearchDestinationLabel,
      originAddress: passengerSearchOriginAddress,
      vehicle: selectedVehicle || 'Leaf Plus',
      status: bookingStatus || null,
      tripDistanceKm: Number.isFinite(Number(tripDistanceKm))
        ? Number(tripDistanceKm)
        : null,
      tripDurationMin: Number.isFinite(Number(tripDurationMin))
        ? Number(tripDurationMin)
        : null,
      tripArrivalText: tripArrivalText || null,
      selectedFare: Number.isFinite(Number(selectedFare))
        ? Number(selectedFare)
        : null,
      driverName: driverInfo?.name || null,
      vehicleModel: driverInfo?.model || null,
      vehiclePlate: driverInfo?.plate || null,
    };
    const transitionPassengerRoute = (routeName, params) => {
      const rootNavigation = globalThis?.navigationRef;
      if (rootNavigation?.isReady?.()) {
        rootNavigation.navigate(routeName, params);
        return;
      }

      if (isHomeRoute) {
        navigation.navigate(routeName, params);
        return;
      }

      navigation.replace(routeName, params);
    };

    if (passengerAutoRoute === 'RobotaxiPrototypeReceipt') {
      transitionPassengerRoute('RobotaxiPrototypeReceipt', { fromTrip: true });
      return;
    }

    if (passengerAutoRoute === 'RobotaxiPrototypeTrip') {
      transitionPassengerRoute('RobotaxiPrototypeTrip', {
        ...commonParams,
        driverName: driverInfo?.name || 'Motorista'
      });
      return;
    }

    transitionPassengerRoute('RobotaxiPrototypeDriverSearch', commonParams);
  }, [
    bookingStatus,
    currentRouteName,
    driverInfo?.name,
    isDriverRole,
    isHomeRoute,
    navigation,
    passengerAutoRoute,
    passengerSearchDestinationAddress,
    passengerSearchDestinationLabel,
    passengerSearchOriginAddress,
    runtimeVisualStateReady,
    selectedVehicle,
    shouldSyncPassengerRoute
  ]);

  useEffect(() => {
    if (isDriverRole || !isHomeRoute || bookingStatus !== 'idle') {
      return;
    }

    const hasPreviewDestination = Boolean(
      selectedDestination?.coordinate || selectedDestination?.name || selectedDestination?.address
    );
    const hasPreviewRoute =
      Array.isArray(activeRoute.coordinates) && activeRoute.coordinates.length >= 2;

    if (!hasPreviewDestination && !hasPreviewRoute) {
      return;
    }

    clearFlowPreview();
  }, [
    activeRoute.coordinates,
    bookingStatus,
    clearFlowPreview,
    isDriverRole,
    isHomeRoute,
    selectedDestination?.address,
    selectedDestination?.coordinate,
    selectedDestination?.name
  ]);

  if (
    !isDriverRole &&
    isHomeRoute &&
    normalizedBookingStatus === 'completed' &&
    lastReceipt?.id
  ) {
    return (
      <RobotaxiReceiptScreen
        navigation={navigation}
        route={{
          key: 'robotaxi-home-completed-receipt',
          name: 'RobotaxiPrototypeReceipt',
          params: { fromTrip: true },
        }}
      />
    );
  }

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
          driverCoordinate={presentedDriverCoordinate}
          showTraffic={trafficLayerEnabled}
          searchingMode={presentedSearchingMode}
          searchCenterCoordinate={presentedSearchingMode ? searchCenterCoordinate : null}
          searchRadiusKm={presentedSearchingMode ? searchRadiusKm : null}
          searchPreviewRadiusKm={presentedSearchingMode ? searchPreviewRadiusKm : null}
          nearbyVehicles={presentedNearbyVehicles}
          routeCoordinates={presentedRouteCoordinates}
          destinationCoordinate={presentedRouteDestination}
          destinationLabel={presentedRouteDestinationLabel}
          destinationAddress={presentedRouteDestinationAddress}
          originLabel="Partida"
          originAddress={currentAddress || 'Sua localização atual'}
          hideUserMarker={mapShouldHideUserMarker}
          animateRoute={routeAnimate}
          routeMainColor={routeMainColor}
          routeShadowColor={routeShadowColor}
          routeHighlightColor={routeHighlightColor}
          driverMarkerMode={driverMarkerMode}
          driverMarkerLetter={driverMarkerLetter}
          destinationMarkerMode={destinationMarkerMode}
          destinationMarkerLetter={passengerMarkerLetter}
          onMapLayout={handleMapLayout}
          onMapPanDrag={handleMapPanDrag}
          onRegionChangeComplete={handleMapRegionChangeComplete}
          mapChildren={shouldRenderRuntimeMapState ? driverH3MapChildren : null}
          mapSafetyProfile={isDriverRole ? 'driver' : 'default'}
          interactionEnabled={showHomeChrome && shouldRenderRuntimeMapState}
        />

        {showHomeChrome ? (
          <PrototypeTopControls
            insets={insets}
            leftIcon={isHomeRoute ? 'locate' : 'arrow-back'}
            rightIcon={hasMenuTopAction ? 'menu' : 'locate'}
            showRightBadge={hasMenuTopAction && unreadNotificationCount > 0}
            onPressLeft={handleTopLeftPress}
            onPressRight={handleTopRightPress}
          />
        ) : null}

        <PrototypeConnectionStatusPill
          topOffset={connectionIndicatorTopOffset}
          visible={Boolean(displayedConnectionIndicatorModel)}
          tone={displayedConnectionIndicatorModel?.tone}
          icon={displayedConnectionIndicatorModel?.icon}
          title={displayedConnectionIndicatorModel?.title}
          message={displayedConnectionIndicatorModel?.message}
        />

        {showLeafNativeNavigation ? (
          <LeafNativeNavigationBanner
            routeKey={route?.key}
            insetsTop={insets.top}
            navigationModel={leafNativeNavigationModel}
            onHide={handleHideLeafNativeNavigation}
          />
        ) : null}

        {runtimeVisualStateReady &&
        showHomeChrome &&
        isDriverRole &&
        driverActivationResolved &&
        driverTripAssist &&
        !hasDriverLiveRideOverlay ? (
          <DriverTripStatusBanner
            routeKey={route?.key}
            insetsTop={insets.top}
            tripAssist={driverTripAssist}
            onPrimaryAction={handleDriverTripPrimaryAction}
            onOpenNavigation={handleOpenDriverNavigation}
          />
        ) : null}

        {runtimeVisualStateReady &&
        showHomeChrome &&
        isDriverRole &&
        driverActivationResolved &&
        !hasDriverLiveRideOverlay &&
        String(driverTransientCard?.id || '').trim() ? (
          <DriverTransientStateCard
            card={driverTransientCard}
            insetsBottom={insets.bottom}
            bottomOffset={DRIVER_BOTTOM_CTA_OFFSET + driverBottomCtaHeight + 12}
          />
        ) : null}

        {canShowPassengerHomeOverlay ? (
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

        {runtimeVisualStateReady &&
        showHomeChrome &&
        isDriverRole &&
        canRenderDriverRideChrome ? (
          <>
            <DriverLiveRideOverlay
              insetsTop={insets.top}
              insetsBottom={insets.bottom}
              bottomOffset={driverLiveRideBottomOffset}
              onCardLayout={event => {
                const nextHeight = event?.nativeEvent?.layout?.height;
                if (Number.isFinite(nextHeight) && nextHeight > 0) {
                  setDriverLiveRideHeight(previous => (
                    previous === nextHeight ? previous : nextHeight
                  ));
                }
              }}
              driverOffers={driverOffers}
              driverActiveRide={driverActiveRide}
              driverTripMeta={driverTripMeta}
              bookingStatus={bookingStatus}
              tripDistanceKm={tripDistanceKm}
              paymentMethod={paymentMethod}
              driverExtensionRequest={driverExtensionRequest}
              acceptDriverOffer={acceptDriverOffer}
              rejectDriverOffer={rejectDriverOffer}
              respondToDriverExtension={respondToDriverExtension}
              interruptRideOperationalFlow={interruptRideOperationalFlow}
              cancelActiveRideFlow={cancelActiveRideFlow}
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
                driverOnlinePending={driverOnlinePending}
                driverCanGoOnline={driverCanGoOnline}
                driverActivationResolved={driverActivationResolved}
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
                onOpenActivation={handleOpenDriverActivation}
              />
            ) : null}
          </>
        ) : null}

        {showPassengerBottomIsland ? (
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
