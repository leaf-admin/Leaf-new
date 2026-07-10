import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Linking, Modal, Platform, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useIsFocused, useNavigationState } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Marker, Polygon } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import polyline from '@mapbox/polyline';
import { fonts } from '../../theme/runtimeTokens';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeMapLayer from '../../components/prototype/PrototypeMapLayer';
import PrototypeConnectionStatusPill from '../../components/prototype/PrototypeConnectionStatusPill';
import { PrototypeBottomIsland, PrototypeTopControls } from '../../components/prototype/PrototypeScaffold';
import PermissionExplanationModal from '../../components/PermissionExplanationModal';
import PassengerHomeOverlay, {
  PASSENGER_HOME_CARD_METRICS,
  PassengerHomeOverlaySkeleton,
} from './home/PassengerHomeOverlay';
import DriverHomeOverlay from './home/DriverHomeOverlay';
import DriverLiveRideOverlay from './home/DriverLiveRideOverlay';
import DriverTripStatusBanner from './home/DriverTripStatusBanner';
import LeafNativeNavigationBanner from './home/LeafNativeNavigationBanner';
import DriverTransientStateCard from './home/DriverTransientStateCard';
import RobotaxiReceiptScreen from './RobotaxiReceiptScreen';
import { PROTOTYPE_REGION } from './robotaxiPrototypeData';
import { subscribePrototypeMapOcclusion, usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import {
  clearPrototypeMapRoute,
  getPrototypeMapRoute,
  publishPrototypeMapCamera,
  setPrototypeMapRoute,
  subscribePrototypeMapRoute,
} from './prototypeMapRoute';
import {
  buildRouteViewportRegion,
  buildVisibleRouteEdgePadding,
  distanceBetweenCoordinatesKm,
} from './prototypeRouteViewport';
import {
  PROTOTYPE_TRAFFIC_SEGMENT_COLORS,
  resolveTrafficFareStatusPresentation,
  resolveTrafficSegmentLevelForLeg,
  resolveWorstTrafficSegmentLevel,
} from './prototypeTrafficRoute';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { resolvePassengerAutoRoute, shouldAutoSyncPassengerRoute } from './passengerFlowRouting';
import { normalizeRuntimeRideStatus } from './rideLifecycleContract';
import { resolvePrototypeMapPresentation } from './prototypeMapPresentation';
import { SEARCH_MAX_RADIUS_KM, getSearchPresentation } from './searchPresentation';
import useSearchElapsedClock from './useSearchElapsedClock';
import { openDriverExternalNavigation } from '../../services/DriverExternalNavigationService';
import {
  fetchH3CellsForRegion,
  isCoordinateInsideRegion,
  resolveH3LabelAnchor,
  selectSeparatedH3Labels,
} from '../../services/runtime/h3MapService';
import WebSocketManager from '../../services/WebSocketManager';
import driverAvailabilityService from '../../services/DriverAvailabilityService';
import { getSelfHostedApiUrl } from '../../config/ApiConfig';
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
import { isE2ETestBuild, isSimulatorBuild } from '../../config/runtimeAccessPolicy';
import {
  buildTripFinancialTotals,
  formatCurrencyBRL,
  resolveTripTollAmount,
} from './tripFinancialSummary';
import {
  NAVIGATION_CAMERA_ANCHOR_Y,
  NAVIGATION_CAMERA_ANIMATION_MS,
  resolveNavigationCameraPitch,
  resolveNavigationCameraZoom,
} from '../../services/LeafNativeNavigationEngine';
import {
  buildPrototypeConnectionIndicatorModel,
  resolvePrototypeConnectionAutomationConfig,
  shouldRunPrototypeConnectionAutomation,
} from './prototypeConnectionStatus';
import useCampaignAssetOverride from '../../hooks/useCampaignAssetOverride';
import kycService from '../../services/KYCService';
import nativeAwsLivenessService from '../../services/NativeAwsLivenessService';
import { BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY } from '../../services/BackgroundLocationService';
import {
  fetchCoordsfromPlace,
  fetchPlacesAutocomplete,
} from '../../services/runtime/locationRouteBridge';
import { fetchDynamicPricingQuote } from '../../services/runtime/pricingQuoteService';
import Logger from '../../utils/Logger';

const { color } = robotaxiPrototypeTokens;
const HOME_CARD_BOTTOM_OFFSET = 16;
const HOME_CARD_FALLBACK_HEIGHT = PASSENGER_HOME_CARD_METRICS.stackHeight;
const HOME_PICKUP_PICKER_BOTTOM_OFFSET = 26;
const HOME_PICKUP_PICKER_FALLBACK_HEIGHT = 122;
const DRIVER_BOTTOM_CTA_OFFSET = 16;
const DRIVER_BOTTOM_CTA_FALLBACK_HEIGHT = 236;
const DRIVER_LIVE_RIDE_FALLBACK_HEIGHT = 312;
const MAP_MIN_VISIBLE_HEIGHT = 180;
const OVERLAY_ZOOM_OUT_GAIN = 0.42;
const MAX_OVERLAY_ZOOM_OUT_RATIO = 0.62;
const IS_TEST_ENV = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
const HOME_MAP_READY_WARMUP_MS = Platform.OS === 'android' ? 1400 : 180;
const HOME_MAP_READY_FROM_READY_MS = Platform.OS === 'android' ? 2600 : 320;
const HOME_MAP_READY_FALLBACK_MS = Platform.OS === 'android' ? 9000 : 4500;
const SHOULD_BLOCK_HOME_FIRST_PAINT_FOR_MAP = true;
const PLACES_CACHE_LOOKUP_TIMEOUT_MS = 2500;
const HOME_PICKUP_SEARCH_DEBOUNCE_MS = 360;
const HOME_PICKUP_REVERSE_GEOCODE_DEBOUNCE_MS = 900;
const HOME_PICKUP_REVERSE_GEOCODE_TIMEOUT_MS = 5500;
const HOME_PICKUP_REVERSE_GEOCODE_PRECISION = 5;
const HOME_PICKUP_REVERSE_GEOCODE_MAX_DISTANCE_METERS = 180;
const DRIVER_EXECUTION_SURFACE_STATUSES = new Set([
  'accepted',
  'arrived',
  'started',
  'operational_interrupted',
  'searching_replacement',
]);
const PASSENGER_QUOTE_COORDINATE_PRECISION = Math.max(
  2,
  Number.parseInt(
    process.env.EXPO_PUBLIC_QUOTE_LOCK_COORDINATE_PRECISION || '3',
    10,
  ) || 3,
);
let hasPrototypeHomeSurfaceHydratedInSession = IS_TEST_ENV;
const DEFAULT_USER_COORDINATE = {
  latitude: PROTOTYPE_REGION.latitude,
  longitude: PROTOTYPE_REGION.longitude
};
const DEFAULT_DRIVER_H3_VISUAL_POLICY = {
  enabled: true,
  label: {
    enabled: true,
    maxVisible: 5,
    backgroundColor: '#171412',
    backgroundOpacity: 0.9,
    textColor: '#FFFFFF',
    borderColor: '#FFFFFF',
    borderOpacity: 0.82,
    fontSize: 12
  }
};

function pickHomeMapCoordinate(...values) {
  for (const value of values) {
    if (!value) {
      continue;
    }

    const latitude = Number(value.latitude ?? value.lat);
    const longitude = Number(value.longitude ?? value.lng);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  }

  return null;
}

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
const PREBOOKING_ROUTE_TOP_EXTRA_PADDING = 14;
const PREBOOKING_ROUTE_BOTTOM_EXTRA_PADDING = 12;
const PREBOOKING_ROUTE_OVERLAY_BIAS_RATIO = 0.1;
const PREBOOKING_ROUTE_LATITUDE_DELTA_MULTIPLIER = 1.72;
const PREBOOKING_ROUTE_LONGITUDE_DELTA_MULTIPLIER = 1.86;
const PREBOOKING_ROUTE_BOTTOM_OCCLUSION_RELIEF = 160;
const PREBOOKING_ROUTE_VIEWPORT_DELTA_SCALE = 0.74;
const PREBOOKING_ROUTE_VIEWPORT_LATITUDE_OFFSET_RATIO = -0.03;
const SEARCH_ZOOM_ANIMATION_MS = 1150;
const SEARCH_RADIUS_MARGIN = 1.34;
const SEARCH_INITIAL_VIEWPORT_RADIUS_KM = 0.48;
const MAP_OCCLUSION_REPOSITION_MS = 760;
const MAP_RETURN_REPOSITION_MS = 820;
const DRIVER_H3_VIEWPORT_DEBOUNCE_MS = 420;
const DRIVER_H3_SOCKET_REFRESH_DEBOUNCE_MS = 900;
const DRIVER_H3_DEFAULT_FETCH_INTERVAL_MS = 60000;
const DRIVER_H3_MIN_FETCH_INTERVAL_MS = 30000;
const DRIVER_H3_AUTH_COOLDOWN_MS = 120000;
const HOME_AUTOMATION_POLL_MS = 350;
const HOME_AUTOMATION_WATCHDOG_MS = 250;
const LEAF_NATIVE_NAV_CAMERA_THROTTLE_MS = 800;
const LEAF_NATIVE_NAV_MANUAL_PAN_PAUSE_MS = 8000;
const LEAF_NATIVE_NAV_CAMERA_MIN_LOOKAHEAD_KM = 0.045;
const LEAF_NATIVE_NAV_CAMERA_MAX_LOOKAHEAD_KM = 0.28;
const MERCATOR_METERS_PER_PIXEL_AT_ZOOM_0 = 156543.03392;
const DRIVER_DISCLOSURE_STORAGE_TIMEOUT_MS = Math.max(
  600,
  Number.parseInt(
    process.env.EXPO_PUBLIC_DRIVER_DISCLOSURE_STORAGE_TIMEOUT_MS || '1200',
    10,
  ) || 1200,
);

let CachedKYCCameraScreen = null;
let CachedAWSNativeLivenessScreen = null;

function resolveKYCCameraScreen() {
  if (!CachedKYCCameraScreen) {
    CachedKYCCameraScreen = require('../../components/KYC/KYCCameraScreen').default;
  }
  return CachedKYCCameraScreen;
}

function resolveAWSNativeLivenessScreen() {
  if (!CachedAWSNativeLivenessScreen) {
    CachedAWSNativeLivenessScreen = require('../../components/KYC/AWSNativeLivenessScreen').default;
  }
  return CachedAWSNativeLivenessScreen;
}
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

function withDriverDisclosureStorageTimeout(operation, fallbackValue = null) {
  let timeoutId = null;
  return Promise.race([
    Promise.resolve(operation),
    new Promise(resolve => {
      timeoutId = setTimeout(resolve, DRIVER_DISCLOSURE_STORAGE_TIMEOUT_MS, fallbackValue);
    }),
  ]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
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

function DriverHomeHydrationSkeleton({
  insetsBottom = 0,
  onCtaLayout,
}) {
  const safeBottom = Math.max(0, Number(insetsBottom) || 0);

  return (
    <View
      pointerEvents="none"
      onLayout={onCtaLayout}
      style={[
        styles.driverHomeSkeletonStack,
        { bottom: safeBottom + DRIVER_BOTTOM_CTA_OFFSET },
      ]}
      testID="driver-home-overlay-skeleton"
      accessibilityRole="progressbar"
      accessibilityLabel="Carregando área do motorista"
    >
      <View style={styles.driverHomeSkeletonCard}>
        <View style={styles.driverHomeSkeletonTopRow}>
          <View style={styles.driverHomeSkeletonMainColumn}>
            <View style={[styles.driverHomeSkeletonLine, styles.driverHomeSkeletonLabel]} />
            <View style={[styles.driverHomeSkeletonLine, styles.driverHomeSkeletonAmount]} />
            <View style={styles.driverHomeSkeletonProgressTrack}>
              <View style={styles.driverHomeSkeletonProgressFill} />
            </View>
            <View style={styles.driverHomeSkeletonCaptionRow}>
              <View style={[styles.driverHomeSkeletonLine, styles.driverHomeSkeletonCaption]} />
              <View style={[styles.driverHomeSkeletonLine, styles.driverHomeSkeletonPercent]} />
            </View>
            <View style={styles.driverHomeSkeletonPill} />
          </View>

          <View style={styles.driverHomeSkeletonDivider} />

          <View style={styles.driverHomeSkeletonSideColumn}>
            <View style={[styles.driverHomeSkeletonLine, styles.driverHomeSkeletonSideValue]} />
            <View style={[styles.driverHomeSkeletonLine, styles.driverHomeSkeletonSideLabel]} />
            <View style={[styles.driverHomeSkeletonLine, styles.driverHomeSkeletonSideValue]} />
            <View style={[styles.driverHomeSkeletonLine, styles.driverHomeSkeletonSideLabel]} />
          </View>
        </View>

        <View style={styles.driverHomeSkeletonHorizontalDivider} />

        <View style={styles.driverHomeSkeletonActionRow}>
          <View style={styles.driverHomeSkeletonSlider}>
            <View style={styles.driverHomeSkeletonThumb} />
            <View style={[styles.driverHomeSkeletonLine, styles.driverHomeSkeletonActionLabel]} />
          </View>
          <View style={styles.driverHomeSkeletonGear} />
        </View>
      </View>

      <View style={styles.driverHomeSkeletonPromoCard}>
        <View style={[styles.driverHomeSkeletonLine, styles.driverHomeSkeletonPromoTitle]} />
        <View style={[styles.driverHomeSkeletonLine, styles.driverHomeSkeletonPromoBody]} />
        <View style={[styles.driverHomeSkeletonLine, styles.driverHomeSkeletonPromoBodyShort]} />
      </View>
    </View>
  );
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

function resolveNavigationCameraLookAheadKm({
  coordinate,
  zoom,
  mapHeight,
  anchorY = NAVIGATION_CAMERA_ANCHOR_Y,
}) {
  if (!isFiniteCoordinate(coordinate)) {
    return LEAF_NATIVE_NAV_CAMERA_MIN_LOOKAHEAD_KM;
  }

  const safeZoom = Number.isFinite(Number(zoom))
    ? Math.max(1, Math.min(22, Number(zoom)))
    : resolveNavigationCameraZoom(0);
  const safeHeight = Number.isFinite(Number(mapHeight)) && Number(mapHeight) > 0
    ? Number(mapHeight)
    : 760;
  const safeAnchorY = Math.max(0.5, Math.min(0.82, Number(anchorY) || NAVIGATION_CAMERA_ANCHOR_Y));
  const latitudeCosine = Math.max(
    0.18,
    Math.cos((Number(coordinate.latitude) * Math.PI) / 180),
  );
  const metersPerPixel =
    (MERCATOR_METERS_PER_PIXEL_AT_ZOOM_0 * latitudeCosine) / (2 ** safeZoom);
  const anchorOffsetPixels = Math.max(0, safeHeight * (safeAnchorY - 0.5));
  const lookAheadKm = (anchorOffsetPixels * metersPerPixel) / 1000;

  return Math.min(
    LEAF_NATIVE_NAV_CAMERA_MAX_LOOKAHEAD_KM,
    Math.max(LEAF_NATIVE_NAV_CAMERA_MIN_LOOKAHEAD_KM, lookAheadKm),
  );
}

function getSearchViewportRadiusKm(radiusKm) {
  const normalized = Number(radiusKm);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return SEARCH_INITIAL_VIEWPORT_RADIUS_KM;
  }

  if (normalized <= 1) {
    return SEARCH_INITIAL_VIEWPORT_RADIUS_KM;
  }

  if (normalized <= 2) {
    return Math.max(1.36, normalized * 0.92);
  }

  if (normalized <= 3) {
    return normalized * 0.96;
  }

  if (normalized <= 4) {
    return normalized * 1.03;
  }

  if (normalized >= SEARCH_MAX_RADIUS_KM) {
    return normalized * 1.14;
  }

  return normalized * 1.08;
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

function formatDirectionsCoordinate(coordinate) {
  if (!isFiniteCoordinate(coordinate)) {
    return '';
  }

  return `${Number(coordinate.latitude).toFixed(6)},${Number(coordinate.longitude).toFixed(6)}`;
}

function buildHomeRoutePreviewKey(origin, destination) {
  const originKey = formatDirectionsCoordinate(origin);
  const destinationKey = formatDirectionsCoordinate(destination);

  if (!originKey || !destinationKey) {
    return '';
  }

  return `${originKey}|${destinationKey}`;
}

export function buildDestinationFareQuoteRouteKey(origin, destination) {
  if (!isFiniteCoordinate(origin) || !isFiniteCoordinate(destination)) {
    return '';
  }

  return [
    Number(origin.latitude).toFixed(PASSENGER_QUOTE_COORDINATE_PRECISION),
    Number(origin.longitude).toFixed(PASSENGER_QUOTE_COORDINATE_PRECISION),
    Number(destination.latitude).toFixed(PASSENGER_QUOTE_COORDINATE_PRECISION),
    Number(destination.longitude).toFixed(PASSENGER_QUOTE_COORDINATE_PRECISION),
  ].join('|');
}

function decodeRoutePolyline(polylinePoints) {
  if (!polylinePoints) {
    return [];
  }

  try {
    const decoded = polyline.decode(polylinePoints);
    if (!Array.isArray(decoded) || decoded.length < 2) {
      return [];
    }

    return decoded
      .map(([latitude, longitude]) => ({ latitude, longitude }))
      .filter(isFiniteCoordinate);
  } catch (error) {
    Logger.warn('[PassengerHome] Falha ao decodificar polyline da rota:', error?.message || error);
    return [];
  }
}

function normalizeDirectionsCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

function resolveStepCoordinates(step) {
  const decoded = decodeRoutePolyline(step?.polylinePoints);
  if (decoded.length >= 2) {
    return decoded;
  }

  const start = normalizeDirectionsCoordinate(step?.startLocation || step?.start_location);
  const end = normalizeDirectionsCoordinate(step?.endLocation || step?.end_location);
  return start && end ? [start, end] : [];
}

function buildRouteCoordinatesFromDirectionsRoute(route) {
  const decodedOverview = decodeRoutePolyline(
    route?.polylinePoints ||
      route?.overviewPolyline ||
      route?.overview_polyline?.points ||
      route?.polyline?.encodedPolyline ||
      route?.encodedPolyline,
  );
  if (decodedOverview.length >= 2) {
    return decodedOverview;
  }

  const explicitCoordinates = Array.isArray(route?.coordinates)
    ? route.coordinates
        .map(normalizeDirectionsCoordinate)
        .filter(Boolean)
    : [];
  if (explicitCoordinates.length >= 2) {
    return explicitCoordinates;
  }

  const routeSteps = [
    ...(Array.isArray(route?.steps) ? route.steps : []),
    ...(Array.isArray(route?.legs)
      ? route.legs.flatMap((leg) => (Array.isArray(leg?.steps) ? leg.steps : []))
      : []),
  ];
  const coordinates = [];
  routeSteps.forEach((step) => {
    resolveStepCoordinates(step).forEach((coordinate) => {
      const previous = coordinates[coordinates.length - 1];
      if (
        !previous ||
        previous.latitude !== coordinate.latitude ||
        previous.longitude !== coordinate.longitude
      ) {
        coordinates.push(coordinate);
      }
    });
  });

  if (coordinates.length >= 2) {
    return coordinates;
  }

  return [];
}

async function fetchPassengerHomeRoutePreview({
  startLoc,
  destLoc,
  routeKey,
  signal,
}) {
  const response = await fetch(getSelfHostedApiUrl('/api/places/directions'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      startLoc,
      destLoc,
      waypoints: null,
      forceFresh: false,
      routeScope: 'passenger_home_preview',
      telemetry: {
        sourceKey: routeKey,
        sourceMeta: {
          surface: 'passenger_home_category_preview',
        },
      },
    }),
    signal,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.status !== 'success' || !payload?.data) {
    throw new Error(
      payload?.message ||
        `Directions backend indisponível para preview (${response.status}).`,
    );
  }

  return payload.data;
}

export function buildTrafficSegmentsFromDirectionsRoute(route, routeCoordinates = []) {
  if (Array.isArray(route?.trafficSegments) && route.trafficSegments.length > 0) {
    return route.trafficSegments;
  }

  const routeSteps = Array.isArray(route?.steps) ? route.steps : [];
  const explicitLegs = Array.isArray(route?.legs) ? route.legs : [];
  const legs = explicitLegs.length > 0
    ? explicitLegs
    : routeSteps.length > 0 || route?.duration_in_traffic || route?.duration_without_traffic
      ? [route]
      : [];
  const segments = [];

  legs.forEach((leg) => {
    const level = resolveTrafficSegmentLevelForLeg(leg, route, legs.length);
    if (!level) {
      return;
    }

    const color =
      PROTOTYPE_TRAFFIC_SEGMENT_COLORS[level] ||
      PROTOTYPE_TRAFFIC_SEGMENT_COLORS.normal;
    const legSteps = Array.isArray(leg?.steps) ? leg.steps : [];
    const steps = legSteps.length > 0
      ? legSteps
      : legs.length === 1
        ? routeSteps
        : [];
    steps.forEach((step) => {
      const coordinates = resolveStepCoordinates(step);
      if (coordinates.length >= 2) {
        segments.push({ coordinates, level, color });
      }
    });

    if (steps.length === 0 && Array.isArray(routeCoordinates) && routeCoordinates.length >= 2) {
      segments.push({ coordinates: routeCoordinates, level, color });
    }
  });

  if (segments.length === 0 && Array.isArray(routeCoordinates) && routeCoordinates.length >= 2) {
    const routeLevel = resolveTrafficSegmentLevelForLeg(route, route, 1);
    if (routeLevel) {
      segments.push({
        coordinates: routeCoordinates,
        level: routeLevel,
        color:
          PROTOTYPE_TRAFFIC_SEGMENT_COLORS[routeLevel] ||
          PROTOTYPE_TRAFFIC_SEGMENT_COLORS.normal,
      });
    }
  }

  return segments;
}

function buildSearchViewportRegion({
  center,
  radiusKm
}) {
  if (!isFiniteCoordinate(center) || !Number.isFinite(radiusKm) || radiusKm <= 0) {
    return null;
  }

  const viewportRadiusKm = getSearchViewportRadiusKm(radiusKm);
  const baseRegion = buildSearchRegion(center, viewportRadiusKm);
  const points = [
    center,
    offsetCoordinateByDistance(center, viewportRadiusKm, 0),
    offsetCoordinateByDistance(center, viewportRadiusKm, 90),
    offsetCoordinateByDistance(center, viewportRadiusKm, 180),
    offsetCoordinateByDistance(center, viewportRadiusKm, 270)
  ];

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

function normalizePickupAddressText(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLocalPlacesCacheQuery(value = '') {
  return normalizePickupAddressText(value).toLowerCase();
}

function normalizePickupCompareText(value = '') {
  return normalizePickupAddressText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function isGenericPickupAddress(value = '') {
  const normalized = normalizePickupCompareText(value);
  return (
    !normalized ||
    normalized === 'minha localizacao' ||
    normalized === 'sua localizacao atual' ||
    normalized === 'localizacao atual' ||
    normalized === 'origem atual'
  );
}

function hasStreetNumber(value = '') {
  return /\b\d{1,6}[a-zA-Z]?\b/.test(String(value || ''));
}

function formatPickupStreetNumberLabel(value = '', fallback = 'Local atual') {
  const normalized = normalizePickupAddressText(value);
  if (!normalized || isGenericPickupAddress(normalized)) {
    return fallback;
  }

  const parts = normalized
    .split(',')
    .map(part => normalizePickupAddressText(part))
    .filter(Boolean);
  const [firstPart, secondPart] = parts;

  if (/^\d{1,6}[a-zA-Z]?$/.test(firstPart) && secondPart) {
    return `${secondPart}, ${firstPart}`;
  }

  if (firstPart && secondPart && hasStreetNumber(secondPart)) {
    return `${firstPart}, ${secondPart}`;
  }

  if (firstPart && hasStreetNumber(firstPart)) {
    return firstPart;
  }

  return firstPart || normalized || fallback;
}

function resolvePickupAddressCandidate(...values) {
  for (const value of values) {
    const normalized = normalizePickupAddressText(value);
    if (normalized && !isGenericPickupAddress(normalized)) {
      return normalized;
    }
  }

  return '';
}

function resolveCachedPickupAddress(place = null) {
  if (!place || typeof place !== 'object') {
    return '';
  }

  return resolvePickupAddressCandidate(
    place.address,
    place.formatted_address,
    place.description,
    place.structured_formatting?.secondary_text,
    place.name,
  );
}

async function fetchCachedPickupPlaceOnly(query, location = null) {
  const normalizedQuery = normalizeLocalPlacesCacheQuery(query);
  if (normalizedQuery.length < 3) {
    return null;
  }

  try {
    const localCached = await AsyncStorage.getItem(`@places_cache:${normalizedQuery}`);
    if (localCached) {
      return JSON.parse(localCached);
    }
  } catch (_error) {
    // Cache lookup is opportunistic; never block the home surface on it.
  }

  if (typeof fetch !== 'function') {
    return null;
  }

  try {
    const canAbort = typeof AbortController !== 'undefined';
    const controller = canAbort ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), PLACES_CACHE_LOOKUP_TIMEOUT_MS)
      : null;

    try {
      const response = await fetch(getSelfHostedApiUrl('/api/places/search'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          location,
        }),
        ...(controller ? { signal: controller.signal } : {}),
      });

      if (!response?.ok) {
        return null;
      }

      const payload = await response.json();
      return payload?.data || null;
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  } catch (_error) {
    return null;
  }
}

function createHomePickupSearchSessionToken(createdAt = Date.now()) {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `pickup_search_${createdAt}_${randomSuffix}`;
}

function normalizeHomePlaceSearchLocation(coordinate = null) {
  const latitude = Number(coordinate?.latitude ?? coordinate?.lat);
  const longitude = Number(coordinate?.longitude ?? coordinate?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    lat: latitude,
    lng: longitude,
  };
}

function parsePlaceNameFromDescription(description = '') {
  const normalized = normalizePickupAddressText(description);
  if (!normalized) {
    return '';
  }

  return normalizePickupAddressText(normalized.split(',')[0]) || normalized;
}

function parsePlaceAddressFromDescription(description = '') {
  const normalized = normalizePickupAddressText(description);
  if (!normalized) {
    return '';
  }

  const [, ...addressParts] = normalized.split(',');
  return normalizePickupAddressText(addressParts.join(',')) || normalized;
}

function normalizeHomePickupSearchResult(item = {}, fallbackQuery = '', sessionToken = null) {
  const description = normalizePickupAddressText(item.description || item.address || item.name || fallbackQuery);
  const name = normalizePickupAddressText(
    item.name ||
      item.structured_formatting?.main_text ||
      parsePlaceNameFromDescription(description) ||
      fallbackQuery,
  );
  const address = normalizePickupAddressText(
    item.address ||
      item.formatted_address ||
      item.structured_formatting?.secondary_text ||
      parsePlaceAddressFromDescription(description),
  );
  const lat = Number(item?.coordinate?.latitude ?? item?.location?.lat ?? item?.lat);
  const lng = Number(item?.coordinate?.longitude ?? item?.location?.lng ?? item?.lng);
  const coordinate = Number.isFinite(lat) && Number.isFinite(lng)
    ? {
        latitude: lat,
        longitude: lng,
      }
    : null;
  const placeId = normalizePickupAddressText(item.place_id || item.placeId || '');

  return {
    id: placeId || item.id || description || `${name}-${address}`,
    place_id: placeId || null,
    name: name || address || description || 'Partida',
    address: address || description || name || '',
    description: description || address || name || '',
    coordinate,
    searchSessionToken: item.searchSessionToken || sessionToken || null,
  };
}

function buildHomePickupReverseCacheKey(coordinate = null) {
  const latitude = Number(coordinate?.latitude ?? coordinate?.lat);
  const longitude = Number(coordinate?.longitude ?? coordinate?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return '';
  }

  return [
    '@pickup_reverse_geocode',
    latitude.toFixed(HOME_PICKUP_REVERSE_GEOCODE_PRECISION),
    longitude.toFixed(HOME_PICKUP_REVERSE_GEOCODE_PRECISION),
  ].join(':');
}

function calculateHomePickupDistanceMeters(origin = null, destination = null) {
  const originLatitude = Number(origin?.latitude ?? origin?.lat);
  const originLongitude = Number(origin?.longitude ?? origin?.lng);
  const destinationLatitude = Number(destination?.latitude ?? destination?.lat);
  const destinationLongitude = Number(destination?.longitude ?? destination?.lng);
  if (
    !Number.isFinite(originLatitude) ||
    !Number.isFinite(originLongitude) ||
    !Number.isFinite(destinationLatitude) ||
    !Number.isFinite(destinationLongitude)
  ) {
    return null;
  }

  const toRadians = value => (Number(value) * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const latitudeDelta = toRadians(destinationLatitude - originLatitude);
  const longitudeDelta = toRadians(destinationLongitude - originLongitude);
  const originLatitudeRadians = toRadians(originLatitude);
  const destinationLatitudeRadians = toRadians(destinationLatitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(originLatitudeRadians) *
      Math.cos(destinationLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function isHomePickupReverseGeocodeMatch(coordinate = null, result = null) {
  const latitude = Number(result?.latitude ?? result?.lat);
  const longitude = Number(result?.longitude ?? result?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }

  const distanceMeters = calculateHomePickupDistanceMeters(coordinate, {
    latitude,
    longitude,
  });

  return (
    Number.isFinite(distanceMeters) &&
    distanceMeters <= HOME_PICKUP_REVERSE_GEOCODE_MAX_DISTANCE_METERS
  );
}

async function fetchHomePickupReverseGeocode(coordinate, telemetry = null) {
  const location = normalizeHomePlaceSearchLocation(coordinate);
  if (!location || typeof fetch !== 'function') {
    return null;
  }

  const canAbort = typeof AbortController !== 'undefined';
  const controller = canAbort ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), HOME_PICKUP_REVERSE_GEOCODE_TIMEOUT_MS)
    : null;

  try {
    const response = await fetch(getSelfHostedApiUrl('/api/places/reverse-geocode'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location,
        telemetry,
      }),
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!response?.ok) {
      return null;
    }

    const payload = await response.json();
    const data = payload?.data || {};
    const address = resolvePickupAddressCandidate(
      data.address,
      data.formatted_address,
      data.name,
    );
    return address
      ? {
          address,
          name: data.name || compactPlaceLabel(address, 'Partida'),
          lat: Number(data.lat),
          lng: Number(data.lng),
          cached: payload.cached === true,
        }
      : null;
  } catch (_error) {
    return null;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function resolveProfileInitial(profile = {}) {
  const nameCandidate =
    profile?.name ||
    profile?.fullName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim() ||
    '';
  return String(nameCandidate || 'L').trim().charAt(0).toUpperCase() || 'L';
}

function resolveProfileFirstName(profile = {}) {
  const nameCandidate =
    profile?.firstName ||
    profile?.name ||
    profile?.fullName ||
    profile?.displayName ||
    [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim() ||
    '';
  const [firstName] = String(nameCandidate || '').trim().split(/\s+/);
  return String(firstName || '').trim();
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

const HOME_CATEGORY_RATE_CARDS = Object.freeze({
  plus: {
    title: 'Leaf Plus',
    label: 'Plus',
    description: 'Confortável e acessível',
    base_fare: 2.79,
    fixed_fee: 1.1,
    rate_per_hour: 15.6,
    rate_per_unit_distance: 1.53,
    min_fare: 8.5,
  },
  elite: {
    title: 'Leaf Elite',
    label: 'Elite',
    description: 'Mais conforto para sua viagem',
    base_fare: 4.98,
    fixed_fee: 1.8,
    rate_per_hour: 17.4,
    rate_per_unit_distance: 2.41,
    min_fare: 10.5,
  },
  moto: {
    title: 'Leaf Moto',
    label: 'Moto',
    description: 'Mais rápido para ir sozinho',
    base_fare: 2.18,
    fixed_fee: 0.86,
    rate_per_hour: 12.17,
    rate_per_unit_distance: 1.19,
    min_fare: 6.9,
  },
});

function calculateHomeCategoryFare(distanceKm, durationMin, rateCard) {
  const distance = Number(distanceKm) || 0;
  const durationHours = (Number(durationMin) || 0) / 60;
  const subtotal =
    (Number(rateCard?.base_fare) || 0) +
    (Number(rateCard?.fixed_fee) || 0) +
    distance * (Number(rateCard?.rate_per_unit_distance) || 0) +
    durationHours * (Number(rateCard?.rate_per_hour) || 0);

  return Number(Math.max(subtotal, Number(rateCard?.min_fare) || 0).toFixed(2));
}

export function resolveHomeCategoryFarePresentation({
  isSelectedCategory = false,
  quotePending = false,
  backendQuoteRequired = false,
  quoteUnavailable = false,
  backendFare = null,
  localFare = 0,
  allowLocalEstimateWhilePending = false,
} = {}) {
  const normalizedBackendFare = Number(backendFare);
  const normalizedLocalFare = Number(localFare);
  const hasLocalEstimate =
    Number.isFinite(normalizedLocalFare) && normalizedLocalFare > 0;

  if (isSelectedCategory && quotePending) {
    if (allowLocalEstimateWhilePending && hasLocalEstimate) {
      return {
        fare: normalizedLocalFare,
        priceLabel: formatCurrencyBRL(normalizedLocalFare),
      };
    }

    return {
      fare: null,
      priceLabel: 'Calculando',
    };
  }

  if (
    isSelectedCategory &&
    backendQuoteRequired &&
    !(Number.isFinite(normalizedBackendFare) && normalizedBackendFare > 0)
  ) {
    if (!quoteUnavailable && allowLocalEstimateWhilePending && hasLocalEstimate) {
      return {
        fare: normalizedLocalFare,
        priceLabel: formatCurrencyBRL(normalizedLocalFare),
      };
    }

    return {
      fare: null,
      priceLabel: quoteUnavailable ? '--' : 'Calculando',
    };
  }

  const fare =
    Number.isFinite(normalizedBackendFare) && normalizedBackendFare > 0
      ? normalizedBackendFare
      : Number.isFinite(normalizedLocalFare)
        ? normalizedLocalFare
        : 0;

  return {
    fare,
    priceLabel: formatCurrencyBRL(fare),
  };
}

function createHomeQuoteSessionId(createdAt = Date.now()) {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `passenger_home_quote_${createdAt}_${randomSuffix}`;
}

function buildHomeBackendQuoteKey({
  routeKey,
  categoryId,
  quoteSessionId,
}) {
  if (!routeKey || !categoryId || !quoteSessionId) {
    return '';
  }
  return [routeKey, categoryId, quoteSessionId].join('|');
}

function getHomeQuoteLockExpiresAtMs(record = null) {
  return Date.parse(
    String(record?.quoteLockExpiresAt || record?.quote?.quoteLockExpiresAt || ''),
  );
}

function isHomeBackendQuoteRecordFresh(record = null, expectedKey = '', nowMs = Date.now()) {
  const expiresAtMs = getHomeQuoteLockExpiresAtMs(record);
  return Boolean(
    record?.key === expectedKey &&
      record?.quote &&
      String(record?.quoteLockId || record?.quote?.quoteLockId || '').trim() &&
      Number.isFinite(expiresAtMs) &&
      expiresAtMs > nowMs &&
      Number(record.quote.estimatedFare) > 0,
  );
}

function hasExpiredHomeBackendQuoteRecord(records = {}, nowMs = Date.now()) {
  return Object.values(records || {}).some((record) => {
    const expiresAtMs = getHomeQuoteLockExpiresAtMs(record);
    return Boolean(record?.quote && Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs);
  });
}

function formatHomeArrivalTime(durationMin) {
  const now = new Date();
  now.setMinutes(now.getMinutes() + Math.max(1, Math.round(Number(durationMin) || 1)));
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}

function isDriverKycRequiredResult(result = {}) {
  const payload = result?.payload && typeof result.payload === 'object'
    ? result.payload
    : {};
  const code = String(result?.code || payload?.code || '').trim().toLowerCase();
  const message = String(
    result?.reason ||
    result?.error ||
    result?.message ||
    payload?.reason ||
    payload?.error ||
    payload?.message ||
    ''
  ).trim().toLowerCase();

  return Boolean(result?.kycRequired || payload?.kycRequired) ||
    ['kycrequired', 'kyc_required', 'kyccheckfailed', 'kyc_check_failed', 'kyc_liveness_required'].includes(code) ||
    /verifica[cç][aã]o.*(facial|kyc|di[aá]ria|encontrada)/i.test(message);
}

const DRIVER_IDENTITY_REVERIFICATION_REASON = 'Por segurança, precisamos validar sua identidade.';

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
    driverOnlineStartedAt,
    driverOnlineDaily,
    driverCanGoOnline,
    driverActivationResolved,
    driverDestinationMode,
    paymentMethod,
    driverInfo,
    loadDestinationSuggestions,
    loadRecentDestinations,
    resolveDestinationInput,
    selectDestination,
    requestRide,
    setDriverOnline,
    setDriverDestinationMode,
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
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
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
  const homeRoutePreviewRequestRef = useRef('');
  const homePickupSearchSessionTokenRef = useRef('');
  const homePickupReverseRequestKeyRef = useRef('');
  const homeCurrentPickupReverseRequestKeyRef = useRef('');
  const passengerHomeResetTokenRef = useRef('');
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
  const [homePickupPickerVisible, setHomePickupPickerVisible] = useState(false);
  const [homePickupSearchActive, setHomePickupSearchActive] = useState(false);
  const [homePickupSearchQuery, setHomePickupSearchQuery] = useState('');
  const [homePickupSearchResults, setHomePickupSearchResults] = useState([]);
  const [homePickupSearching, setHomePickupSearching] = useState(false);
  const [homeDestinationSearchActive, setHomeDestinationSearchActive] = useState(false);
  const [homeDestinationQuery, setHomeDestinationQuery] = useState('');
  const [homeDestinationResults, setHomeDestinationResults] = useState([]);
  const [homeDestinationSearching, setHomeDestinationSearching] = useState(false);
  const [homeSelectedDestination, setHomeSelectedDestination] = useState(null);
  const [homeSelectedCategoryId, setHomeSelectedCategoryId] = useState('plus');
  const [homeLeafDelasEnabled] = useState(false);
  const [homeRoutePreview, setHomeRoutePreview] = useState(null);
  const [homeBackendQuotesByCategory, setHomeBackendQuotesByCategory] = useState({});
  const homeBackendQuote = homeBackendQuotesByCategory[homeSelectedCategoryId] || null;
  const [, setHomeBackendQuoteLoading] = useState(false);
  const [homeBackendQuoteError, setHomeBackendQuoteError] = useState('');
  const [homeQuoteRefreshNonce, setHomeQuoteRefreshNonce] = useState(0);
  const [homeAvailabilityNotice, setHomeAvailabilityNotice] = useState('');
  const [homeDriverAvailabilityOverride, setHomeDriverAvailabilityOverride] =
    useState(null);
  const [homeDriverAvailabilityRefreshing, setHomeDriverAvailabilityRefreshing] =
    useState(false);
  const homeAvailabilityAutoRefreshKeyRef = useRef('');
  const [homePickupCoordinate, setHomePickupCoordinate] = useState(null);
  const [homePickupAddress, setHomePickupAddress] = useState('');
  const [cachedHomePickupAddress, setCachedHomePickupAddress] = useState('');
  const [homePickupAdjustedOnMap, setHomePickupAdjustedOnMap] = useState(false);
  const homePickupDraftBeforePickerRef = useRef(null);
  const [homePickupPickerCardHeight, setHomePickupPickerCardHeight] = useState(HOME_PICKUP_PICKER_FALLBACK_HEIGHT);
  const [driverBottomCtaHeight, setDriverBottomCtaHeight] = useState(DRIVER_BOTTOM_CTA_FALLBACK_HEIGHT);
  const [driverLiveRideHeight, setDriverLiveRideHeight] = useState(DRIVER_LIVE_RIDE_FALLBACK_HEIGHT);
  const lastPassengerHomeAvailabilityNoticeRef = useRef('');
  const [mapWidth, setMapWidth] = useState(windowWidth);
  const [mapHeight, setMapHeight] = useState(windowHeight);
  const [activeOcclusion, setActiveOcclusion] = useState({ top: 0, bottom: 0 });
  const [activeRoute, setActiveRoute] = useState({ coordinates: [], destination: null, destinationLabel: '', destinationAddress: '' });
  const [nearbyDriverCoordinates, setNearbyDriverCoordinates] = useState([]);
  const [mapFollowingUser, setMapFollowingUser] = useState(true);
  const [visibleMapRegion, setVisibleMapRegion] = useState(PROTOTYPE_REGION);
  const [homeMapReady, setHomeMapReady] = useState(hasPrototypeHomeSurfaceHydratedInSession);
  const [homeMapLayoutReady, setHomeMapLayoutReady] = useState(IS_TEST_ENV);
  const [homeSurfaceHydrated, setHomeSurfaceHydrated] = useState(
    hasPrototypeHomeSurfaceHydratedInSession
  );
  const [driverH3Cells, setDriverH3Cells] = useState([]);
  const [driverH3VisualPolicy, setDriverH3VisualPolicy] = useState(DEFAULT_DRIVER_H3_VISUAL_POLICY);
  const [driverH3RefreshPolicy, setDriverH3RefreshPolicy] = useState({
    pollIntervalMs: DRIVER_H3_DEFAULT_FETCH_INTERVAL_MS,
    staleAfterMs: DRIVER_H3_DEFAULT_FETCH_INTERVAL_MS * 2,
    trafficLayerEnabled: true,
  });
  const [driverH3RefreshNonce, setDriverH3RefreshNonce] = useState(0);
  const [showRecoveredConnectionHint, setShowRecoveredConnectionHint] = useState(false);
  const [qaConnectionVisualState, setQaConnectionVisualState] = useState(null);
  const [displayedConnectionIndicatorModel, setDisplayedConnectionIndicatorModel] = useState(null);
  const [driverKycModalVisible, setDriverKycModalVisible] = useState(false);
  const [driverKycPendingReason, setDriverKycPendingReason] = useState('');
  const [driverKycChallengeContext, setDriverKycChallengeContext] = useState({
    challengeId: null,
    requirement: null,
  });
  const [driverKycLivenessMode, setDriverKycLivenessMode] = useState('local');
  const [driverKycAwsSessionId, setDriverKycAwsSessionId] = useState(null);
  const [driverKycProviderLoading, setDriverKycProviderLoading] = useState(false);
  const [driverKycProcessing, setDriverKycProcessing] = useState(false);
  const [driverBackgroundDisclosureVisible, setDriverBackgroundDisclosureVisible] = useState(false);
  const driverH3RefreshTimerRef = useRef(null);
  const driverH3OverlayWasVisibleRef = useRef(false);
  const driverH3LastFetchKeyRef = useRef('');
  const driverH3LastFetchAtRef = useRef(0);
  const driverH3DisabledUntilRef = useRef(0);
  const homeMapReadyWarmupTimerRef = useRef(null);
  const homeMapReadyFallbackTimerRef = useRef(null);
  const connectionIndicatorStableTimerRef = useRef(null);
  const displayedConnectionIndicatorKeyRef = useRef('none');

  useEffect(() => {
    const notice = String(route?.params?.passengerHomeAvailabilityNotice || '').trim();
    const noticeAt = String(route?.params?.passengerHomeAvailabilityNoticeAt || notice);
    if (!notice || lastPassengerHomeAvailabilityNoticeRef.current === noticeAt) {
      return;
    }
    lastPassengerHomeAvailabilityNoticeRef.current = noticeAt;
    setHomeAvailabilityNotice(notice);
  }, [
    route?.params?.passengerHomeAvailabilityNotice,
    route?.params?.passengerHomeAvailabilityNoticeAt,
  ]);

  const [destination] = useState('Para onde vamos?');
  const resetPassengerHomeSearchSurface = useCallback(() => {
    setHomePickupPickerVisible(false);
    setHomePickupSearchActive(false);
    setHomePickupSearchQuery('');
    setHomePickupSearchResults([]);
    setHomePickupSearching(false);
    homePickupSearchSessionTokenRef.current = '';
    setHomeDestinationSearchActive(false);
    setHomeDestinationQuery('');
    setHomeDestinationResults([]);
    setHomeDestinationSearching(false);
    setHomeSelectedDestination(null);
    setHomeRoutePreview(null);
    setHomeBackendQuotesByCategory({});
    setHomeBackendQuoteError('');
    setHomeAvailabilityNotice('');
    setHomeDriverAvailabilityOverride(null);
    setHomeDriverAvailabilityRefreshing(false);
    Keyboard.dismiss();
  }, []);

  useEffect(() => {
    const shouldReset = route?.params?.resetPassengerHomeSearch === true ||
      String(route?.params?.resetPassengerHomeSearch || '')
        .trim()
        .toLowerCase() === 'true';
    if (!shouldReset) {
      return;
    }

    const resetToken = String(
      route?.params?.resetPassengerHomeSearchAt ||
        route?.params?.source ||
        'reset',
    );
    if (passengerHomeResetTokenRef.current === resetToken) {
      return;
    }

    passengerHomeResetTokenRef.current = resetToken;
    resetPassengerHomeSearchSurface();

    if (typeof navigation?.setParams === 'function') {
      navigation.setParams({
        resetPassengerHomeSearch: undefined,
        resetPassengerHomeSearchAt: undefined,
        source: undefined,
      });
    }
  }, [
    navigation,
    resetPassengerHomeSearchSurface,
    route?.params?.resetPassengerHomeSearch,
    route?.params?.resetPassengerHomeSearchAt,
    route?.params?.source,
  ]);
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
  const normalizedBookingStatus = normalizeRuntimeRideStatus(bookingStatus);
  const profileImage = String(
    profile?.profile_image ||
      profile?.profileImage ||
      profile?.photo ||
      profile?.photoURL ||
      ''
  ).trim();
  const profileInitial = useMemo(() => resolveProfileInitial(profile), [profile]);
  const profileFirstName = useMemo(() => resolveProfileFirstName(profile), [profile]);
  const effectiveHomePickupCoordinate = useMemo(() => {
    if (homePickupAdjustedOnMap && isFiniteCoordinate(homePickupCoordinate)) {
      return homePickupCoordinate;
    }

    if (isFiniteCoordinate(currentCoordinate)) {
      return currentCoordinate;
    }

    return null;
  }, [currentCoordinate, homePickupAdjustedOnMap, homePickupCoordinate]);
  const currentPickupAddressCandidate = useMemo(() => {
    return resolvePickupAddressCandidate(cachedHomePickupAddress);
  }, [cachedHomePickupAddress]);
  const effectiveHomePickupAddress = useMemo(() => {
    if (homePickupAdjustedOnMap && homePickupAddress) {
      return homePickupAddress;
    }

    return currentPickupAddressCandidate || 'Local atual';
  }, [
    currentPickupAddressCandidate,
    homePickupAddress,
    homePickupAdjustedOnMap,
  ]);
  const homePickupDisplayLabel = useMemo(() => {
    if (homePickupAdjustedOnMap) {
      return formatPickupStreetNumberLabel(homePickupAddress, 'Ponto ajustado');
    }

    return formatPickupStreetNumberLabel(effectiveHomePickupAddress, 'Local atual');
  }, [effectiveHomePickupAddress, homePickupAddress, homePickupAdjustedOnMap]);
  const homePickupDisplayAddress = useMemo(() => {
    if (homePickupAdjustedOnMap) {
      return homePickupAddress || 'Ponto definido no mapa';
    }

    return effectiveHomePickupAddress;
  }, [effectiveHomePickupAddress, homePickupAddress, homePickupAdjustedOnMap]);
  const destinationRoutePickupParams = useMemo(
    () => ({
      initialPickupCoordinate: effectiveHomePickupCoordinate,
      initialPickupAddress: effectiveHomePickupAddress,
      initialPickupLabel: homePickupDisplayLabel,
      initialPickupAdjustedOnMap: homePickupAdjustedOnMap,
    }),
    [
      effectiveHomePickupAddress,
      effectiveHomePickupCoordinate,
      homePickupAdjustedOnMap,
      homePickupDisplayLabel,
    ]
  );
  const homeQuoteDestinationCoordinate = homeSelectedDestination?.coordinate || null;
  const homePickupRouteLatitude = effectiveHomePickupCoordinate?.latitude;
  const homePickupRouteLongitude = effectiveHomePickupCoordinate?.longitude;
  const homeDestinationRouteLatitude = homeQuoteDestinationCoordinate?.latitude;
  const homeDestinationRouteLongitude = homeQuoteDestinationCoordinate?.longitude;
  const homeRoutePreviewKey = useMemo(
    () => buildHomeRoutePreviewKey(effectiveHomePickupCoordinate, homeQuoteDestinationCoordinate),
    [
      homeDestinationRouteLatitude,
      homeDestinationRouteLongitude,
      homePickupRouteLatitude,
      homePickupRouteLongitude,
    ],
  );
  const homeRoutePreviewCoordinates = Array.isArray(homeRoutePreview?.coordinates)
    ? homeRoutePreview.coordinates
    : [];
  const homeCanonicalRouteReady = Boolean(
    homeRoutePreviewKey &&
      homeRoutePreview?.key === homeRoutePreviewKey &&
      homeRoutePreviewCoordinates.length >= 2,
  );
  const homeDestinationFareQuoteRouteKey = useMemo(
    () =>
      buildDestinationFareQuoteRouteKey(
        effectiveHomePickupCoordinate,
        homeQuoteDestinationCoordinate,
      ),
    [
      homeDestinationRouteLatitude,
      homeDestinationRouteLongitude,
      homePickupRouteLatitude,
      homePickupRouteLongitude,
    ],
  );
  const homeQuoteDistanceKm = useMemo(() => {
    if (
      homeRoutePreview?.key === homeRoutePreviewKey &&
      Number.isFinite(homeRoutePreview?.distanceKm) &&
      homeRoutePreview.distanceKm > 0
    ) {
      return Number(homeRoutePreview.distanceKm.toFixed(1));
    }

    if (!isFiniteCoordinate(effectiveHomePickupCoordinate) || !isFiniteCoordinate(homeQuoteDestinationCoordinate)) {
      return 3.8;
    }

    const straightDistance = distanceBetweenCoordinatesKm(
      effectiveHomePickupCoordinate,
      homeQuoteDestinationCoordinate,
    );
    if (!Number.isFinite(straightDistance)) {
      return 3.8;
    }

    return Math.max(1.2, Number((straightDistance * 1.32).toFixed(1)));
  }, [
    homeDestinationRouteLatitude,
    homeDestinationRouteLongitude,
    homeRoutePreview?.distanceKm,
    homeRoutePreview?.key,
    homeRoutePreviewKey,
    homePickupRouteLatitude,
    homePickupRouteLongitude,
  ]);
  const homeQuoteDurationMin = useMemo(() => {
    if (
      homeRoutePreview?.key === homeRoutePreviewKey &&
      Number.isFinite(homeRoutePreview?.durationMin) &&
      homeRoutePreview.durationMin > 0
    ) {
      return Math.max(4, Math.round(homeRoutePreview.durationMin));
    }

    const destinationEta = Number.parseInt(homeSelectedDestination?.eta || '', 10);
    if (Number.isFinite(destinationEta) && destinationEta > 0) {
      return Math.max(4, destinationEta + 4);
    }

    return Math.max(6, Math.round(homeQuoteDistanceKm * 4.2));
  }, [
    homeQuoteDistanceKm,
    homeRoutePreview?.durationMin,
    homeRoutePreview?.key,
    homeRoutePreviewKey,
    homeSelectedDestination?.eta,
  ]);
  const homePickupEtaBaseMin = useMemo(() => {
    const destinationEta = Number.parseInt(homeSelectedDestination?.eta || '', 10);
    return Number.isFinite(destinationEta) && destinationEta > 0
      ? Math.max(3, destinationEta)
      : 4;
  }, [homeSelectedDestination?.eta]);
  const homeArrivalTime = useMemo(
    () => formatHomeArrivalTime(homeQuoteDurationMin),
    [homeQuoteDurationMin],
  );
  const homeBackendQuoteSessionId = useMemo(() => {
    if (!homeRoutePreviewKey) {
      return '';
    }
    return createHomeQuoteSessionId();
  }, [homeQuoteRefreshNonce, homeRoutePreviewKey]);
  const homeBackendQuoteKey = useMemo(
    () =>
      buildHomeBackendQuoteKey({
        routeKey: homeRoutePreviewKey,
        categoryId: homeSelectedCategoryId,
        quoteSessionId: homeBackendQuoteSessionId,
      }),
    [homeBackendQuoteSessionId, homeRoutePreviewKey, homeSelectedCategoryId],
  );
  useEffect(() => {
    setHomeDriverAvailabilityOverride(null);
    setHomeDriverAvailabilityRefreshing(false);
  }, [homeBackendQuoteKey]);
  const selectedHomeRateCard = HOME_CATEGORY_RATE_CARDS[homeSelectedCategoryId] || HOME_CATEGORY_RATE_CARDS.plus;
  const selectedHomeFallbackFare = useMemo(
    () =>
      calculateHomeCategoryFare(
        homeQuoteDistanceKm,
        homeQuoteDurationMin,
        selectedHomeRateCard,
      ),
    [homeQuoteDistanceKm, homeQuoteDurationMin, selectedHomeRateCard],
  );
  const homeSelectedDestinationAddress = useMemo(
    () =>
      homeSelectedDestination?.address ||
      homeSelectedDestination?.description ||
      homeSelectedDestination?.name ||
      'Destino',
    [
      homeSelectedDestination?.address,
      homeSelectedDestination?.description,
      homeSelectedDestination?.name,
    ],
  );

  useEffect(() => {
    if (
      !homeBackendQuoteSessionId ||
      !homeCanonicalRouteReady ||
      !Number.isFinite(Number(homePickupRouteLatitude)) ||
      !Number.isFinite(Number(homePickupRouteLongitude)) ||
      !Number.isFinite(Number(homeDestinationRouteLatitude)) ||
      !Number.isFinite(Number(homeDestinationRouteLongitude))
    ) {
      setHomeBackendQuotesByCategory({});
      setHomeBackendQuoteLoading(false);
      setHomeBackendQuoteError('');
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;

    setHomeBackendQuotesByCategory({});
    setHomeBackendQuoteLoading(true);
    setHomeBackendQuoteError('');

    const homePricingPickupLocation = {
      lat: homePickupRouteLatitude,
      lng: homePickupRouteLongitude,
      latitude: homePickupRouteLatitude,
      longitude: homePickupRouteLongitude,
      add: effectiveHomePickupAddress,
      address: effectiveHomePickupAddress,
    };
    const homePricingDestinationLocation = {
      lat: homeDestinationRouteLatitude,
      lng: homeDestinationRouteLongitude,
      latitude: homeDestinationRouteLatitude,
      longitude: homeDestinationRouteLongitude,
      add: homeSelectedDestinationAddress,
      address: homeSelectedDestinationAddress,
    };
    const routePolyline =
      homeRoutePreview?.key === homeRoutePreviewKey
        ? homeRoutePreview?.polylinePoints || null
        : null;
    const routeTollFee =
      homeRoutePreview?.key === homeRoutePreviewKey
        ? Number(homeRoutePreview?.tollFee || 0)
        : 0;
    const routeTolls =
      homeRoutePreview?.key === homeRoutePreviewKey && Array.isArray(homeRoutePreview?.tolls)
        ? homeRoutePreview.tolls
        : [];

    Promise.all(
      Object.entries(HOME_CATEGORY_RATE_CARDS).map(async ([categoryId, rateCard]) => {
        const fallbackFare = calculateHomeCategoryFare(
          homeQuoteDistanceKm,
          homeQuoteDurationMin,
          rateCard,
        );
        const quoteKey = buildHomeBackendQuoteKey({
          routeKey: homeRoutePreviewKey,
          categoryId,
          quoteSessionId: homeBackendQuoteSessionId,
        });
        const routeSnapshot = {
          pickupLocation: homePricingPickupLocation,
          destinationLocation: homePricingDestinationLocation,
          carType: rateCard.title,
          routePolyline,
          tollFee: routeTollFee,
          tolls: routeTolls,
        };
        const quote = await fetchDynamicPricingQuote(
          {
            pickupLocation: homePricingPickupLocation,
            destinationLocation: homePricingDestinationLocation,
            carType: rateCard.title,
            routeDistanceKm: homeQuoteDistanceKm,
            routeDurationSecs: Math.max(60, Math.round(homeQuoteDurationMin * 60)),
            routePolyline,
            requireRouteGeometry: true,
            tollFee: routeTollFee,
            clientEstimatedFare: fallbackFare,
            quoteSessionId: homeBackendQuoteSessionId,
            passengerId: profile?.uid || profileUid || '',
          },
          {
            signal: controller.signal,
            headers: { 'x-leaf-quote-session-id': homeBackendQuoteSessionId },
          },
        );
        const quoteLockId = String(quote?.quoteLockId || '').trim() || null;
        const quoteLockExpiresAt = String(quote?.quoteLockExpiresAt || '').trim() || null;

        return [
          categoryId,
          {
            key: quoteKey,
            categoryId,
            routeKey: homeRoutePreviewKey,
            quoteSessionId: homeBackendQuoteSessionId,
            quoteLockId,
            quoteLockExpiresAt,
            quote: quote && typeof quote === 'object'
              ? {
                  ...quote,
                  quoteLockId,
                  quoteLockExpiresAt,
                  quoteRouteSnapshot: routeSnapshot,
                }
              : null,
            routeSnapshot,
            distanceKm: homeQuoteDistanceKm,
            durationMin: homeQuoteDurationMin,
            arrivalTime: homeArrivalTime,
            fallbackFare,
            expiresAt: Number(quote?.expiresAt) || Date.now() + 120000,
          },
        ];
      }),
    )
      .then((entries) => {
        if (!cancelled) {
          setHomeBackendQuotesByCategory(Object.fromEntries(entries));
        }
      })
      .catch((error) => {
        if (!cancelled && error?.name !== 'AbortError') {
          setHomeBackendQuotesByCategory({});
          setHomeBackendQuoteError(
            error?.message || 'Não foi possível calcular a tarifa agora.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setHomeBackendQuoteLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    effectiveHomePickupAddress,
    homeDestinationRouteLatitude,
    homeDestinationRouteLongitude,
    homeArrivalTime,
    homeBackendQuoteSessionId,
    homeCanonicalRouteReady,
    homeQuoteDistanceKm,
    homeQuoteDurationMin,
    homeRoutePreview?.key,
    homeRoutePreview?.polylinePoints,
    homeRoutePreview?.tollFee,
    homeRoutePreview?.tolls,
    homeRoutePreviewKey,
    homePickupRouteLatitude,
    homePickupRouteLongitude,
    homeSelectedDestinationAddress,
    profile?.uid,
    profileUid,
  ]);

  const selectedHomeBackendQuoteReady = Boolean(
    homeCanonicalRouteReady &&
      isHomeBackendQuoteRecordFresh(homeBackendQuote, homeBackendQuoteKey),
  );
  const selectedHomeBackendQuoteExpired = Boolean(
    homeBackendQuote?.quote &&
      getHomeQuoteLockExpiresAtMs(homeBackendQuote) <= Date.now(),
  );
  const homeCategorySurfaceVisible = Boolean(
    homeSelectedDestination?.coordinate && homeCanonicalRouteReady
  );
  const selectedHomeBackendPricingPayload = selectedHomeBackendQuoteReady
    ? homeBackendQuote.quote?.pricingPayload || null
    : null;
  const activeHomeDriverAvailabilityOverride =
    selectedHomeBackendQuoteReady &&
    homeDriverAvailabilityOverride?.key === homeBackendQuoteKey &&
    homeDriverAvailabilityOverride?.categoryId === homeSelectedCategoryId
      ? homeDriverAvailabilityOverride.availability
      : null;
  const selectedHomeDriverAvailability = selectedHomeBackendQuoteReady
    ? activeHomeDriverAvailabilityOverride ||
      homeBackendQuote.quote?.driverAvailability ||
      null
    : null;
  const selectedHomeDriverAvailabilityKnown = Boolean(
    selectedHomeDriverAvailability &&
      selectedHomeDriverAvailability.hasDrivers !== null &&
      selectedHomeDriverAvailability.hasDrivers !== undefined,
  );
  const selectedHomeDriverUnavailable = Boolean(
    selectedHomeDriverAvailabilityKnown &&
      selectedHomeDriverAvailability.hasDrivers === false,
  );
  const selectedHomeDriverPickupEtaMin = selectedHomeDriverAvailabilityKnown
    ? Number(selectedHomeDriverAvailability?.pickupEtaMin)
    : NaN;
  const selectedHomeBackendPickupEtaAuthoritative = Boolean(
    selectedHomeBackendPricingPayload?.pickup_eta_authoritative === true ||
      selectedHomeBackendPricingPayload?.eta_pickup_authoritative === true
  );
  const selectedHomeBackendPickupEtaMin = selectedHomeBackendQuoteReady
    && selectedHomeBackendPickupEtaAuthoritative
    ? Number(
        selectedHomeBackendPricingPayload?.eta_pickup_pricing_min ??
          selectedHomeBackendPricingPayload?.eta_pickup_min ??
          selectedHomeBackendPricingPayload?.pickup_eta_min,
      )
    : NaN;
  const selectedHomeQuotePending = Boolean(
    homeSelectedDestination?.coordinate &&
      homeBackendQuoteKey &&
      !selectedHomeBackendQuoteReady &&
      !homeBackendQuoteError,
  );
  const homeCategoryOptions = useMemo(
    () =>
      Object.entries(HOME_CATEGORY_RATE_CARDS).map(([id, rateCard]) => {
        const localFare = calculateHomeCategoryFare(
          homeQuoteDistanceKm,
          homeQuoteDurationMin,
          rateCard,
        );
        const categoryBackendQuote = homeBackendQuotesByCategory[id]?.quote || null;
        const categoryBackendFare = Number(categoryBackendQuote?.estimatedFare);
        const backendFare =
          Number.isFinite(categoryBackendFare) && categoryBackendFare > 0
            ? categoryBackendFare
            : null;
        const pickupEta =
          id === 'elite'
            ? homePickupEtaBaseMin + 2
            : id === 'moto'
              ? Math.max(2, homePickupEtaBaseMin - 1)
              : homePickupEtaBaseMin;
        const isSelectedCategory = id === homeSelectedCategoryId;
        const displayedPickupEta =
          isSelectedCategory &&
          selectedHomeDriverUnavailable
            ? null
            : isSelectedCategory &&
          Number.isFinite(selectedHomeBackendPickupEtaMin) &&
          selectedHomeBackendPickupEtaMin > 0
            ? Math.max(1, Math.round(selectedHomeBackendPickupEtaMin))
            : isSelectedCategory &&
              Number.isFinite(selectedHomeDriverPickupEtaMin) &&
              selectedHomeDriverPickupEtaMin > 0
              ? Math.max(1, Math.round(selectedHomeDriverPickupEtaMin))
            : pickupEta;
        const farePresentation = resolveHomeCategoryFarePresentation({
          isSelectedCategory,
          quotePending: selectedHomeQuotePending,
          backendQuoteRequired: Boolean(
            isSelectedCategory &&
              homeSelectedDestination?.coordinate &&
              homeBackendQuoteKey
          ),
          quoteUnavailable: Boolean(homeBackendQuoteError),
          backendFare,
          localFare,
          allowLocalEstimateWhilePending: true,
        });
        return {
          id,
          title: rateCard.title,
          label: rateCard.label,
          description: rateCard.description,
          pickupEtaLabel: isSelectedCategory && selectedHomeDriverUnavailable
            ? 'Sem motorista'
            : Number.isFinite(displayedPickupEta)
            ? `${displayedPickupEta} min`
            : '--',
          arrivalLabel: homeArrivalTime,
          fare: farePresentation.fare,
          priceLabel: farePresentation.priceLabel,
          rateCard,
          fareBreakdown: {
            rateCard,
            distanceKm: homeQuoteDistanceKm,
            durationMin: homeQuoteDurationMin,
            localFare,
            backendFare,
            pricingPayload:
              categoryBackendQuote?.pricingPayload ||
              (id === homeSelectedCategoryId ? selectedHomeBackendPricingPayload : null),
            tollFee: resolveTripTollAmount(categoryBackendQuote),
          },
        };
      }),
    [
      homeArrivalTime,
      homePickupEtaBaseMin,
      homeQuoteDistanceKm,
      homeQuoteDurationMin,
      homeBackendQuoteError,
      homeBackendQuoteKey,
      homeBackendQuotesByCategory,
      homeSelectedCategoryId,
      homeSelectedDestination?.coordinate,
      selectedHomeBackendPickupEtaAuthoritative,
      selectedHomeBackendPickupEtaMin,
      selectedHomeBackendPricingPayload,
      selectedHomeDriverPickupEtaMin,
      selectedHomeDriverUnavailable,
      selectedHomeQuotePending,
    ],
  );
  const homeSelectedCategory =
    homeCategoryOptions.find((item) => item.id === homeSelectedCategoryId) ||
    homeCategoryOptions[0] ||
    null;
  const refreshSelectedHomeDriverAvailability = useCallback(async () => {
    if (
      !homeSelectedDestination?.coordinate ||
      !selectedHomeBackendQuoteReady ||
      !homeBackendQuoteKey
    ) {
      return false;
    }

    const pickupLat = Number(homePickupRouteLatitude);
    const pickupLng = Number(homePickupRouteLongitude);
    const destinationLat = Number(homeDestinationRouteLatitude);
    const destinationLng = Number(homeDestinationRouteLongitude);
    if (
      !Number.isFinite(pickupLat) ||
      !Number.isFinite(pickupLng) ||
      !Number.isFinite(destinationLat) ||
      !Number.isFinite(destinationLng)
    ) {
      return false;
    }

    setHomeDriverAvailabilityRefreshing(true);
    setHomeAvailabilityNotice('');

    try {
      const socket = WebSocketManager.getInstance();
      const availability = await socket.checkRideAvailability(
        {
          customerId: profile?.uid || profileUid || '',
          pickupLocation: {
            lat: pickupLat,
            lng: pickupLng,
            latitude: pickupLat,
            longitude: pickupLng,
            address: effectiveHomePickupAddress,
            add: effectiveHomePickupAddress,
          },
          destinationLocation: {
            lat: destinationLat,
            lng: destinationLng,
            latitude: destinationLat,
            longitude: destinationLng,
            address: homeSelectedDestinationAddress,
            add: homeSelectedDestinationAddress,
          },
          carType: selectedHomeRateCard.title,
          vehicle: selectedHomeRateCard.title,
          preferences: {
            leafDelas: Boolean(homeLeafDelasEnabled),
          },
        },
        {
          forceRefresh: true,
          requestId: `home-availability-${homeSelectedCategoryId}-${Date.now()}`,
          timeoutMs: 12000,
        },
      );
      const hasDrivers =
        availability?.available === true || availability?.hasDrivers === true;
      const pickupEtaMin = Number(
        availability?.estimatedPickupEtaMin ??
          availability?.pickupEtaMin ??
          availability?.etaPickupMin,
      );
      setHomeDriverAvailabilityOverride({
        key: homeBackendQuoteKey,
        categoryId: homeSelectedCategoryId,
        refreshedAt: Date.now(),
        availability: {
          ...availability,
          hasDrivers,
          pickupEtaMin: Number.isFinite(pickupEtaMin) ? pickupEtaMin : null,
        },
      });
      if (hasDrivers) {
        setHomeAvailabilityNotice('');
      }
      return hasDrivers;
    } catch (error) {
      Logger.warn(
        '[RobotaxiHomeScreen] Falha ao revalidar disponibilidade do motorista',
        error?.message || error,
      );
      setHomeAvailabilityNotice('Não foi possível validar motoristas agora.');
      return false;
    } finally {
      setHomeDriverAvailabilityRefreshing(false);
    }
  }, [
    effectiveHomePickupAddress,
    homeBackendQuoteKey,
    homeDestinationRouteLatitude,
    homeDestinationRouteLongitude,
    homeLeafDelasEnabled,
    homePickupRouteLatitude,
    homePickupRouteLongitude,
    homeSelectedCategoryId,
    homeSelectedDestination?.coordinate,
    homeSelectedDestinationAddress,
    profile?.uid,
    profileUid,
    selectedHomeBackendQuoteReady,
    selectedHomeRateCard.title,
  ]);

  useEffect(() => {
    if (
      !selectedHomeBackendQuoteReady ||
      !selectedHomeDriverUnavailable ||
      homeDriverAvailabilityRefreshing ||
      !homeBackendQuoteKey
    ) {
      return;
    }

    const quoteLockId = String(
      homeBackendQuote?.quoteLockId ||
        homeBackendQuote?.quote?.quoteLockId ||
        '',
    ).trim();
    const refreshKey = `${homeBackendQuoteKey}:${homeSelectedCategoryId}:${quoteLockId || 'no-lock'}`;
    if (homeAvailabilityAutoRefreshKeyRef.current === refreshKey) {
      return;
    }

    homeAvailabilityAutoRefreshKeyRef.current = refreshKey;
    refreshSelectedHomeDriverAvailability().catch((error) => {
      Logger.warn(
        '[RobotaxiHomeScreen] Falha no refresh automatico de disponibilidade',
        error?.message || error,
      );
    });
  }, [
    homeBackendQuote?.quote?.quoteLockId,
    homeBackendQuote?.quoteLockId,
    homeBackendQuoteKey,
    homeDriverAvailabilityRefreshing,
    homeSelectedCategoryId,
    refreshSelectedHomeDriverAvailability,
    selectedHomeBackendQuoteReady,
    selectedHomeDriverUnavailable,
  ]);

  useEffect(() => {
    if (homePickupAdjustedOnMap || !isFiniteCoordinate(currentCoordinate)) {
      setCachedHomePickupAddress(previous => (previous ? '' : previous));
      return undefined;
    }

    let cancelled = false;

    const cacheKey = buildHomePickupReverseCacheKey(currentCoordinate);
    if (!cacheKey) {
      setCachedHomePickupAddress(previous => (previous ? '' : previous));
      return undefined;
    }

    homeCurrentPickupReverseRequestKeyRef.current = cacheKey;
    setCachedHomePickupAddress(previous => (previous ? '' : previous));

    const resolveCurrentPickupAddress = async () => {
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cancelled || homeCurrentPickupReverseRequestKeyRef.current !== cacheKey) {
          return;
        }

        if (cached) {
          const parsed = JSON.parse(cached);
          const cachedAddress = resolvePickupAddressCandidate(
            parsed?.address,
            parsed?.formatted_address,
            parsed?.name,
          );
          if (
            cachedAddress &&
            isHomePickupReverseGeocodeMatch(currentCoordinate, parsed)
          ) {
            setCachedHomePickupAddress(cachedAddress);
            return;
          }
        }
      } catch (_error) {
        // Local cache failure should not block current pickup resolution.
      }

      const resolved = await fetchHomePickupReverseGeocode(
        currentCoordinate,
        {
          sourceKey: `mobile:current_pickup_reverse:${profileUid || profile?.uid || 'anonymous'}`,
          sourceMeta: {
            userId: profileUid || profile?.uid || null,
            userType: normalizeHomeRole(activeRole) || 'customer',
            platform: Platform.OS,
            flow: 'passenger_home',
            surface: 'current_pickup_reverse_geocode',
          },
        },
      );

      if (cancelled || homeCurrentPickupReverseRequestKeyRef.current !== cacheKey) {
        return;
      }

      const resolvedAddress = resolvePickupAddressCandidate(
        resolved?.address,
        resolved?.name,
      );
      if (
        resolvedAddress &&
        isHomePickupReverseGeocodeMatch(currentCoordinate, resolved)
      ) {
        setCachedHomePickupAddress(resolvedAddress);
        AsyncStorage.setItem(
          cacheKey,
          JSON.stringify({ ...resolved, address: resolvedAddress }),
        ).catch(() => {});
        return;
      }

      setCachedHomePickupAddress('');
    };

    const timer = setTimeout(
      resolveCurrentPickupAddress,
      HOME_PICKUP_REVERSE_GEOCODE_DEBOUNCE_MS,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeRole,
    currentCoordinate?.latitude,
    currentCoordinate?.longitude,
    homePickupAdjustedOnMap,
    profile?.uid,
    profileUid,
  ]);

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
  const freezeBackgroundMapCamera = isDriverOfferRoute;
  const showHomeChrome = Boolean(isScreenFocused && isHomeRoute);
  const vehicleMarkerCampaignAsset = useCampaignAssetOverride({
    enabled: showHomeChrome,
    surface: 'ride_map',
    placement: 'vehicle_marker',
    role: isDriverRole ? 'driver' : 'customer',
    userId: profile?.uid || profileUid || '',
    context: {
      city: 'rio_de_janeiro',
    },
    eventMetadata: {
      screen: 'robotaxi_home',
      role: isDriverRole ? 'driver' : 'customer',
    },
  });
  const hasMenuTopAction = isDriverRole || isHomeRoute || isDriverRoute;
  const isSearchingMode =
    normalizedBookingStatus === 'searching' ||
    normalizedBookingStatus === 'requesting';
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
  const passengerHomePreviewRouteActive = Boolean(
    !isDriverRole &&
      !activeBookingId &&
      normalizedBookingStatus === 'idle' &&
      homeCanonicalRouteReady,
  );
  const activeRouteCoordinates = Array.isArray(activeRoute.coordinates)
    ? activeRoute.coordinates
    : [];
  const hasActiveRoute = activeRouteCoordinates.length >= 2 || passengerHomePreviewRouteActive;
  const homeRoutePreviewReady = Boolean(
    homeCanonicalRouteReady &&
      homeRoutePreview?.key === homeRoutePreviewKey &&
      Number.isFinite(homeRoutePreview?.distanceKm) &&
      Number.isFinite(homeRoutePreview?.durationMin)
  );
  const passengerHomeRoutePending = Boolean(
    homeSelectedDestination?.coordinate &&
      homeRoutePreviewKey &&
      !homeRoutePreviewReady
  );
  const activeRouteTrafficLevel = useMemo(
    () =>
      resolveWorstTrafficSegmentLevel(
        passengerHomePreviewRouteActive
          ? homeRoutePreview?.trafficSegments
          : activeRoute?.trafficSegments,
      ),
    [
      activeRoute?.trafficSegments,
      homeRoutePreview?.trafficSegments,
      passengerHomePreviewRouteActive,
    ],
  );
  const passengerHomeEffectiveTrafficLevel =
    homeRoutePreviewReady && homeRoutePreview?.trafficLevel
      ? homeRoutePreview.trafficLevel
      : activeRouteTrafficLevel;
  const activeRouteTrafficPresentation = useMemo(
    () => resolveTrafficFareStatusPresentation(passengerHomeEffectiveTrafficLevel),
    [passengerHomeEffectiveTrafficLevel],
  );
  const passengerHomeTrafficStatusLabel = selectedHomeQuotePending || passengerHomeRoutePending
    ? passengerHomeRoutePending
      ? 'Calculando rota'
      : 'Calculando preço'
    : activeRouteTrafficPresentation.label;
  const passengerHomeTrafficHigh =
    !selectedHomeDriverUnavailable &&
    !selectedHomeQuotePending &&
    !passengerHomeRoutePending &&
    activeRouteTrafficPresentation.tariffHigh;
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
      radiusKm: searchPreviewRadiusKm || searchRadiusKm,
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
    isSearchingMode,
    mapHeight,
    searchCenterCoordinate,
    searchPreviewRadiusKm,
    searchRadiusKm,
    windowHeight
  ]);
  const routeSignature = useMemo(() => {
    if (!hasActiveRoute) {
      return '';
    }

    const signatureCoordinates = passengerHomePreviewRouteActive
      ? homeRoutePreviewCoordinates
      : activeRouteCoordinates;

    return signatureCoordinates
      .map(point => `${point.latitude.toFixed(6)},${point.longitude.toFixed(6)}`)
      .join('|');
  }, [
    activeRouteCoordinates,
    hasActiveRoute,
    homeRoutePreviewCoordinates,
    passengerHomePreviewRouteActive,
  ]);
  const routeLayoutKey = useMemo(() => {
    if (!hasActiveRoute) {
      return '';
    }

    const isPassengerPreBookingPreview =
      !isDriverRole && !activeBookingId && normalizedBookingStatus === 'idle';
    if (isPassengerPreBookingPreview) {
      return routeSignature;
    }

    const effectiveMapHeight = Math.max(1, Number(mapHeight || windowHeight) || 1);
    return `${routeSignature}|${Math.round(activeOcclusion.top)}|${Math.round(activeOcclusion.bottom)}|${Math.round(effectiveMapHeight)}`;
  }, [
    activeBooking?.bookingId,
    activeBooking?.id,
    activeBookingId,
    activeOcclusion.bottom,
    activeOcclusion.top,
    hasActiveRoute,
    isDriverRole,
    mapHeight,
    normalizedBookingStatus,
    routeSignature,
    windowHeight,
  ]);
  const passengerOccludedBottom = insets.bottom + HOME_CARD_BOTTOM_OFFSET + homeCardHeight;
  const driverOccludedBottom = insets.bottom + DRIVER_BOTTOM_CTA_OFFSET + driverBottomCtaHeight;
  const driverLiveOffer = useMemo(
    () => selectDisplayableDriverOffer(driverOffers),
    [driverOffers]
  );
  const buildHomeReceiptParams = useCallback((overrides = {}) => {
    const receipt = overrides.receipt || overrides.lastReceipt || null;
    const bookingId = String(
      overrides.bookingId ||
        overrides.rideId ||
        overrides.tripId ||
        receipt?.bookingId ||
        receipt?.rideId ||
        receipt?.tripId ||
        receipt?.id ||
        activeBookingId ||
        activeBooking?.bookingId ||
        activeBooking?.id ||
        driverActiveRide?.bookingId ||
        driverActiveRide?.id ||
        lastRideBookingId ||
        lastReceipt?.bookingId ||
        lastReceipt?.id ||
        ''
    ).trim();
    const grossAmount = Number(
      overrides.grossAmount ??
        overrides.fare ??
        receipt?.grossAmount ??
        receipt?.fare ??
        receipt?.amount ??
        activeBooking?.grossFare ??
        activeBooking?.fare ??
        activeBooking?.amount ??
        driverActiveRide?.grossFare ??
        driverActiveRide?.grossAmount ??
        driverActiveRide?.fare ??
        driverActiveRide?.amount ??
        driverTripMeta?.grossFare ??
        driverTripMeta?.grossAmount ??
        selectedFare
    );
    const pickupAddress = String(
      overrides.pickupAddress ||
        overrides.originAddress ||
        receipt?.pickupAddress ||
        receipt?.originAddress ||
        activeBooking?.pickupLocation?.add ||
        activeBooking?.pickupAddress ||
        driverActiveRide?.pickupAddress ||
        driverTripMeta?.pickupAddress ||
        currentAddress ||
        ''
    ).trim();
    const destinationAddress = String(
      overrides.destinationAddress ||
        overrides.dropoffAddress ||
        receipt?.destinationAddress ||
        receipt?.dropoffAddress ||
        activeBooking?.destinationLocation?.add ||
        activeBooking?.destinationAddress ||
        driverActiveRide?.dropoffAddress ||
        driverActiveRide?.destinationAddress ||
        driverTripMeta?.destinationAddress ||
        driverTripMeta?.dropoffAddress ||
        selectedDestination?.address ||
        selectedDestination?.name ||
        'Destino'
    ).trim();

    return {
      fromTrip: true,
      ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
      ...(receipt ? { receipt } : {}),
      ...(Number.isFinite(grossAmount) && grossAmount > 0
        ? {
            fare: Number(grossAmount.toFixed(2)),
            grossAmount: Number(grossAmount.toFixed(2)),
          }
        : {}),
      originAddress: pickupAddress,
      pickupAddress,
      destinationAddress,
      destination: destinationAddress,
      status: overrides.status || bookingStatus || null,
      driverName:
        overrides.driverName ||
        receipt?.driverName ||
        driverInfo?.name ||
        driverActiveRide?.driverName ||
        null,
      vehicle:
        overrides.vehicle ||
        selectedVehicle ||
        driverActiveRide?.vehicle ||
        driverActiveRide?.vehicleModel ||
        null,
      vehicleModel:
        overrides.vehicleModel ||
        driverInfo?.model ||
        driverActiveRide?.vehicleModel ||
        driverActiveRide?.vehicle?.model ||
        null,
      vehiclePlate:
        overrides.vehiclePlate ||
        driverInfo?.plate ||
        driverActiveRide?.vehiclePlate ||
        driverActiveRide?.plate ||
        driverActiveRide?.vehicle?.plate ||
        null,
    };
  }, [
    activeBooking?.amount,
    activeBooking?.bookingId,
    activeBooking?.destinationAddress,
    activeBooking?.destinationLocation?.add,
    activeBooking?.fare,
    activeBooking?.grossFare,
    activeBooking?.id,
    activeBooking?.pickupAddress,
    activeBooking?.pickupLocation?.add,
    activeBookingId,
    bookingStatus,
    currentAddress,
    driverActiveRide?.amount,
    driverActiveRide?.bookingId,
    driverActiveRide?.destinationAddress,
    driverActiveRide?.driverName,
    driverActiveRide?.dropoffAddress,
    driverActiveRide?.fare,
    driverActiveRide?.grossAmount,
    driverActiveRide?.grossFare,
    driverActiveRide?.id,
    driverActiveRide?.pickupAddress,
    driverActiveRide?.plate,
    driverActiveRide?.vehicle,
    driverActiveRide?.vehicle?.model,
    driverActiveRide?.vehicle?.plate,
    driverActiveRide?.vehicleModel,
    driverActiveRide?.vehiclePlate,
    driverInfo?.model,
    driverInfo?.name,
    driverInfo?.plate,
    driverTripMeta?.destinationAddress,
    driverTripMeta?.dropoffAddress,
    driverTripMeta?.grossAmount,
    driverTripMeta?.grossFare,
    driverTripMeta?.pickupAddress,
    lastReceipt?.bookingId,
    lastReceipt?.id,
    lastRideBookingId,
    selectedDestination?.address,
    selectedDestination?.name,
    selectedFare,
    selectedVehicle,
  ]);
  const routeDriverAutomationConfig = useMemo(
    () =>
      resolveDriverHomeAutomationConfig(effectiveRouteParams, {
        isDriverRole,
        isHomeRoute,
        isDev: Boolean(__DEV__),
        isE2E: isE2ETestBuild(),
        isSimulator: isSimulatorBuild(),
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
          isSimulator: isSimulatorBuild(),
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
        isSimulator: isSimulatorBuild(),
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
          const receiptParams = buildHomeReceiptParams({
            bookingId: qaParams.qaBookingId || qaParams.bookingId || '',
          });
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
                    isSimulator: isSimulatorBuild(),
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
  }, [buildHomeReceiptParams, navigation]);

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
  const runtimeHomeSurfaceReady = Boolean(
    ready &&
      !initializing
  );
  const canShowPassengerHomeOverlay = Boolean(
    runtimeHomeSurfaceReady &&
      showHomeChrome &&
      !isDriverRole &&
      !homePickupPickerVisible &&
      !activeBookingId &&
      (!normalizedBookingStatus || normalizedBookingStatus === 'idle') &&
      !passengerAutoRoute
  );

  useEffect(() => {
    if (
      canShowPassengerHomeOverlay ||
      (!homeDestinationSearchActive && !homePickupSearchActive)
    ) {
      return;
    }

    setHomePickupSearchActive(false);
    setHomePickupSearchQuery('');
    setHomePickupSearchResults([]);
    setHomePickupSearching(false);
    homePickupSearchSessionTokenRef.current = '';
    setHomeDestinationSearchActive(false);
    setHomeDestinationQuery('');
    setHomeDestinationResults([]);
    setHomeDestinationSearching(false);
    Keyboard.dismiss();
  }, [canShowPassengerHomeOverlay, homeDestinationSearchActive, homePickupSearchActive]);

  useEffect(() => {
    if (!homePickupSearchActive) {
      return undefined;
    }

    let cancelled = false;
    const trimmedQuery = homePickupSearchQuery.trim();

    const loadResults = async () => {
      if (trimmedQuery.length < 3) {
        setHomePickupSearching(false);
        setHomePickupSearchResults([]);
        return;
      }

      const sessionToken =
        homePickupSearchSessionTokenRef.current ||
        createHomePickupSearchSessionToken();
      homePickupSearchSessionTokenRef.current = sessionToken;
      const location = normalizeHomePlaceSearchLocation(effectiveHomePickupCoordinate);
      const telemetryContext = {
        sourceKey: `mobile:pickup_search:${profileUid || profile?.uid || 'anonymous'}`,
        sourceMeta: {
          userId: profileUid || profile?.uid || null,
          userType: normalizeHomeRole(activeRole) || 'customer',
          platform: Platform.OS,
          flow: 'passenger_home',
          surface: 'pickup_search',
        },
      };

      setHomePickupSearching(true);
      try {
        const predictions = await fetchPlacesAutocomplete(
          trimmedQuery,
          sessionToken,
          location,
          telemetryContext,
        );
        if (!cancelled) {
          setHomePickupSearchResults(
            Array.isArray(predictions)
              ? predictions
                  .map((item) => normalizeHomePickupSearchResult(item, trimmedQuery, sessionToken))
                  .filter((item) => item.name || item.address || item.description)
                  .slice(0, 3)
              : [],
          );
        }
      } catch (_error) {
        if (!cancelled) {
          setHomePickupSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setHomePickupSearching(false);
        }
      }
    };

    const timer = setTimeout(loadResults, HOME_PICKUP_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeRole,
    effectiveHomePickupCoordinate,
    homePickupSearchActive,
    homePickupSearchQuery,
    profile?.uid,
    profileUid,
  ]);

  useEffect(() => {
    if (!homeDestinationSearchActive) {
      return undefined;
    }

    let cancelled = false;
    const trimmedQuery = homeDestinationQuery.trim();

    const loadResults = async () => {
      if (!trimmedQuery) {
        setHomeDestinationSearching(false);
        if (typeof loadRecentDestinations !== 'function') {
          setHomeDestinationResults([]);
          return;
        }

        try {
          const recent = await loadRecentDestinations();
          if (!cancelled) {
            setHomeDestinationResults(
              Array.isArray(recent) ? recent.slice(0, 3) : [],
            );
          }
        } catch (_error) {
          if (!cancelled) {
            setHomeDestinationResults([]);
          }
        }
        return;
      }

      if (trimmedQuery.length < 3) {
        setHomeDestinationSearching(false);
        setHomeDestinationResults([]);
        return;
      }

      if (typeof loadDestinationSuggestions !== 'function') {
        setHomeDestinationSearching(false);
        setHomeDestinationResults([]);
        return;
      }

      setHomeDestinationSearching(true);
      try {
        const suggestions = await loadDestinationSuggestions(trimmedQuery, {
          location: effectiveHomePickupCoordinate,
        });
        if (!cancelled) {
          setHomeDestinationResults(
            Array.isArray(suggestions) ? suggestions.slice(0, 3) : [],
          );
        }
      } catch (_error) {
        if (!cancelled) {
          setHomeDestinationResults([]);
        }
      } finally {
        if (!cancelled) {
          setHomeDestinationSearching(false);
        }
      }
    };

    const timer = setTimeout(loadResults, trimmedQuery ? 360 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    homeDestinationQuery,
    homeDestinationSearchActive,
    effectiveHomePickupCoordinate,
    loadDestinationSuggestions,
    loadRecentDestinations,
  ]);

  const shouldRenderRuntimeMapState = runtimeVisualStateReady;
  const presentedSearchingMode = Boolean(
    shouldRenderRuntimeMapState && !isDriverRole && isSearchingMode,
  );
  const presentedNearbyVehicles = presentedSearchingMode
    ? nearbyDriverCoordinates
    : [];
  const shouldPresentMapRoute = Boolean(
    shouldRenderRuntimeMapState || passengerHomePreviewRouteActive,
  );
  const presentedRouteCoordinates = shouldPresentMapRoute
    ? passengerHomePreviewRouteActive
      ? homeRoutePreviewCoordinates
      : activeRouteCoordinates
    : [];
  const presentedRouteTrafficSegments = shouldPresentMapRoute
    ? passengerHomePreviewRouteActive
      ? homeRoutePreview?.trafficSegments || []
      : activeRoute.trafficSegments
    : [];
  const presentedRouteOrigin = shouldPresentMapRoute
    ? passengerHomePreviewRouteActive
      ? homeRoutePreview?.origin || null
      : activeRoute.origin
    : null;
  const presentedRouteDestination = shouldPresentMapRoute
    ? passengerHomePreviewRouteActive
      ? homeRoutePreview?.destination || null
      : activeRoute.destination || null
    : null;
  const presentedRouteDestinationLabel = shouldPresentMapRoute
    ? passengerHomePreviewRouteActive
      ? homeRoutePreview?.destinationLabel || ''
      : activeRoute.destinationLabel || ''
    : '';
  const presentedRouteDestinationAddress = shouldPresentMapRoute
    ? passengerHomePreviewRouteActive
      ? homeRoutePreview?.destinationAddress || ''
      : activeRoute.destinationAddress || ''
    : '';
  const isLiveTripMapActive = [
    'accepted',
    'arrived',
    'started',
    'operational_interrupted',
    'searching_replacement',
  ].includes(normalizedBookingStatus);
  const isPassengerPreBookingRoutePreview = Boolean(
    !isDriverRole &&
      !activeBookingId &&
      normalizedBookingStatus === 'idle' &&
      !passengerAutoRoute
  );
  const isPassengerRideLifecycleLocked = Boolean(
    !isDriverRole &&
      (
        activeBookingId ||
        passengerAutoRoute ||
        [
          'requesting',
          'searching',
          'searching_replacement',
          'accepted',
          'arrived',
          'started',
          'operational_interrupted',
        ].includes(normalizedBookingStatus)
      )
  );
  const shouldShowTrafficLayer = Boolean(
    isDriverRole
    && shouldRenderRuntimeMapState
    && driverH3RefreshPolicy?.trafficLayerEnabled !== false
  );
  const driverTripAssistNativeNavigation = driverTripAssist?.nativeNavigation || null;
  const isPickupPhase =
    normalizedBookingStatus === 'accepted' ||
    normalizedBookingStatus === 'arrived';
  const mapShouldHideUserMarker =
    isDriverRole ||
    (shouldRenderRuntimeMapState && (isLiveTripMapActive || hasActiveRoute));
  const shouldRenderDriverCurrentLocationCar = Boolean(isDriverRole && isHomeRoute);
  const activeDriverNavigationCoordinate =
    shouldRenderRuntimeMapState && isDriverRole
      ? isLiveTripMapActive
        ? pickHomeMapCoordinate(
            driverTripAssistNativeNavigation?.currentCoordinate,
            driverCoordinate,
            currentCoordinate,
          )
        : pickHomeMapCoordinate(driverCoordinate, currentCoordinate)
      : pickHomeMapCoordinate(currentCoordinate);
  const fallbackDriverMapCoordinate =
    pickHomeMapCoordinate(
      currentCoordinate,
      driverCoordinate,
      targetRegion,
      DEFAULT_USER_COORDINATE,
    );
  const presentedDriverCoordinate = isDriverRole
    ? activeDriverNavigationCoordinate
      || fallbackDriverMapCoordinate
    : shouldRenderRuntimeMapState
      ? driverCoordinate
      : null;
  const presentedDriverHeading = isDriverRole
    ? isLiveTripMapActive
      ? driverTripAssistNativeNavigation?.heading ??
        driverTripAssistNativeNavigation?.bearing ??
        driverTripAssistNativeNavigation?.cameraHeadingDegrees ??
        driverCoordinate?.heading ??
        driverCoordinate?.bearing ??
        driverCoordinate?.course ??
        null
      : 0
    : shouldRenderRuntimeMapState
      ? driverCoordinate?.heading ??
        driverCoordinate?.bearing ??
        driverCoordinate?.course ??
        driverInfo?.heading ??
        driverInfo?.bearing ??
        null
      : null;
  const presentedDriverVehicleColor = useMemo(() => {
    const candidates = [
      driverInfo?.color,
      driverInfo?.vehicleColor,
      driverInfo?.vehicle?.color,
      activeBooking?.vehicleColor,
      activeBooking?.vehicle?.color,
      driverActiveRide?.vehicleColor,
      driverActiveRide?.vehicle?.color,
      profile?.vehicleColor,
      profile?.vehicle?.color,
      profile?.carColor,
      profile?.car?.color,
    ];

    return (
      candidates
        .map((candidate) => String(candidate || '').trim())
        .find(Boolean) || ''
    );
  }, [
    activeBooking?.vehicle?.color,
    activeBooking?.vehicleColor,
    driverActiveRide?.vehicle?.color,
    driverActiveRide?.vehicleColor,
    driverInfo?.color,
    driverInfo?.vehicle?.color,
    driverInfo?.vehicleColor,
    profile?.car?.color,
    profile?.carColor,
    profile?.vehicle?.color,
    profile?.vehicleColor,
  ]);
  const driverMarkerMode = 'car';
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
  const routeAnimate =
    passengerHomePreviewRouteActive ||
    (!isPassengerPreBookingRoutePreview &&
      !(shouldRenderRuntimeMapState && isLiveTripMapActive));
  const homeMapPresentation = useMemo(
    () =>
      resolvePrototypeMapPresentation({
        role: isDriverRole ? 'driver' : 'passenger',
        status: isDriverRole
          ? driverActiveRide?.status || normalizedBookingStatus
          : normalizedBookingStatus,
      }),
    [driverActiveRide?.status, isDriverRole, normalizedBookingStatus],
  );
  const routeMainColor =
    shouldRenderRuntimeMapState && hasActiveRoute && !isPassengerPreBookingRoutePreview
      ? '#2B5B21'
      : hasActiveRoute
        ? PROTOTYPE_TRAFFIC_SEGMENT_COLORS[passengerHomeEffectiveTrafficLevel] || null
        : null;
  const routeShadowColor =
    shouldRenderRuntimeMapState && hasActiveRoute
      ? '#FFFFFF'
      : null;
  const routeHighlightColor =
    shouldRenderRuntimeMapState && isLiveTripMapActive ? null : undefined;
  const hasDriverActiveRideContext = Boolean(
    driverActiveRide?.bookingId || driverActiveRide?.id
  );
  const hasDriverLiveOfferContext = Boolean(
    driverLiveOffer?.bookingId || driverLiveOffer?.id
  );
  const driverActiveSurfaceStatus = normalizeRuntimeRideStatus(
    driverActiveRide?.status || normalizedBookingStatus || ''
  );
  const driverHasAcceptedOrActiveWork = Boolean(
    isDriverRole &&
      (
        (hasDriverActiveRideContext &&
          DRIVER_EXECUTION_SURFACE_STATUSES.has(driverActiveSurfaceStatus)) ||
        (hasDriverLiveOfferContext &&
          DRIVER_EXECUTION_SURFACE_STATUSES.has(normalizedBookingStatus))
      )
  );
  const canRenderDriverRideChrome = Boolean(
    driverActivationResolved ||
      driverCanGoOnline ||
      driverOnline ||
      driverOnlinePending ||
      hasDriverActiveRideContext
  );
  const hasDriverLiveRideOverlay = Boolean(
    runtimeHomeSurfaceReady &&
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
  const driverNavigationCameraOwnsMap = Boolean(
    runtimeVisualStateReady &&
      isDriverRole &&
      isHomeRoute &&
      isLiveTripMapActive &&
      driverTripAssist &&
      (
        showLeafNativeNavigation ||
        String(driverTripAssist.status || '').trim().toLowerCase() === 'arrived'
      )
  );
  const shouldFreezeBackgroundMapCamera = freezeBackgroundMapCamera;
  const showDriverHomeOverlay = Boolean(
    runtimeHomeSurfaceReady &&
      isDriverRole &&
      isHomeRoute &&
      canRenderDriverRideChrome &&
      !hasDriverLiveRideOverlay
  );
  const hasPrimaryHomeSurfaceForFirstPaint = Boolean(
    !showHomeChrome ||
      homePickupPickerVisible ||
      canShowPassengerHomeOverlay ||
      hasDriverLiveRideOverlay ||
      showDriverHomeOverlay
  );
  const homeMapInteractiveReady = Boolean(homeMapReady && homeMapLayoutReady);
  const driverHomeCoordinateReady = Boolean(
    !isDriverRole ||
      !isHomeRoute ||
      activeDriverNavigationCoordinate ||
      fallbackDriverMapCoordinate
  );
  const homeMapFirstPaintReady = Boolean(
    homeMapReady &&
      (!isDriverRole ||
        !isHomeRoute ||
        homeMapLayoutReady ||
        hasDriverLiveRideOverlay ||
        showDriverHomeOverlay)
  );
  const homeSurfaceReadyForFirstPaint = Boolean(
    (!SHOULD_BLOCK_HOME_FIRST_PAINT_FOR_MAP || homeMapFirstPaintReady) &&
      runtimeHomeSurfaceReady &&
      hasPrimaryHomeSurfaceForFirstPaint &&
      driverHomeCoordinateReady &&
      (!isDriverRole || !isHomeRoute || canRenderDriverRideChrome)
  );
  const homeRuntimeHydrationPending = Boolean(
    showHomeChrome &&
      !runtimeVisualStateReady &&
      !homeSurfaceHydrated
  );
  const homeSurfaceLoadingVisible = Boolean(
    showHomeChrome &&
      (
        homeRuntimeHydrationPending ||
        (!homeSurfaceHydrated && !homeSurfaceReadyForFirstPaint)
      )
  );
  const homeLoadingTitle = profileFirstName
    ? `Bem vindo(a), ${profileFirstName}`
    : 'Bem vindo(a)';

  const clearHomeMapReadyTimers = useCallback(() => {
    if (homeMapReadyWarmupTimerRef.current) {
      clearTimeout(homeMapReadyWarmupTimerRef.current);
      homeMapReadyWarmupTimerRef.current = null;
    }
    if (homeMapReadyFallbackTimerRef.current) {
      clearTimeout(homeMapReadyFallbackTimerRef.current);
      homeMapReadyFallbackTimerRef.current = null;
    }
  }, []);

  const scheduleHomeMapReady = useCallback((delayMs = HOME_MAP_READY_WARMUP_MS) => {
    if (IS_TEST_ENV) {
      return;
    }

    if (homeMapReadyWarmupTimerRef.current) {
      clearTimeout(homeMapReadyWarmupTimerRef.current);
    }

    homeMapReadyWarmupTimerRef.current = setTimeout(() => {
      homeMapReadyWarmupTimerRef.current = null;
      setHomeMapReady(true);
    }, delayMs);
  }, []);

  const handleHomeMapReady = useCallback(() => {
    scheduleHomeMapReady(HOME_MAP_READY_FROM_READY_MS);
  }, [scheduleHomeMapReady]);

  const handleHomeMapLoaded = useCallback(() => {
    scheduleHomeMapReady();
  }, [scheduleHomeMapReady]);

  useEffect(() => {
    if (IS_TEST_ENV) {
      return undefined;
    }

    clearHomeMapReadyTimers();

    if (!showHomeChrome) {
      if (homeSurfaceHydrated) {
        return undefined;
      }

      setHomeMapReady(false);
      return undefined;
    }

    if (!homeSurfaceHydrated) {
      setHomeMapReady(false);
      homeMapReadyFallbackTimerRef.current = setTimeout(() => {
        homeMapReadyFallbackTimerRef.current = null;
        setHomeMapReady(true);
      }, HOME_MAP_READY_FALLBACK_MS);
    }

    return clearHomeMapReadyTimers;
  }, [clearHomeMapReadyTimers, homeSurfaceHydrated, isDriverRole, showHomeChrome]);

  useEffect(() => {
    const shouldResetHydratedSurface = Boolean(
      !runtimeVisualStateReady &&
        (!ready || initializing)
    );

    if (
      !showHomeChrome ||
      runtimeVisualStateReady ||
      !homeSurfaceHydrated ||
      !shouldResetHydratedSurface
    ) {
      return;
    }

    setHomeSurfaceHydrated(false);
  }, [
    homeSurfaceHydrated,
    initializing,
    ready,
    runtimeVisualStateReady,
    showHomeChrome
  ]);

  useEffect(() => {
    if (showHomeChrome && !homeSurfaceHydrated && homeSurfaceReadyForFirstPaint) {
      hasPrototypeHomeSurfaceHydratedInSession = true;
      setHomeSurfaceHydrated(true);
    }
  }, [homeSurfaceHydrated, homeSurfaceReadyForFirstPaint, showHomeChrome]);

  const showDriverH3Overlay = Boolean(
    isDriverRole && isHomeRoute && showDriverHomeOverlay
  );
  const driverLiveRideBottomOffset = hasDriverLiveRideOverlay ? 0 : DRIVER_BOTTOM_CTA_OFFSET + driverBottomCtaHeight + 12;
  const driverLiveRideOccludedBottom = driverLiveRideBottomOffset + driverLiveRideHeight;
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
        : homePickupPickerVisible
          ? insets.bottom + HOME_PICKUP_PICKER_BOTTOM_OFFSET + homePickupPickerCardHeight
          : passengerOccludedBottom)
    : 0;
  const baselineOccludedBottom = isDriverRole
    ? driverOccludedBottom
    : homePickupPickerVisible
      ? insets.bottom + HOME_PICKUP_PICKER_BOTTOM_OFFSET + homePickupPickerCardHeight
      : passengerOccludedBottom;
  const homeOccludedTop = homePickupPickerVisible ? insets.top + 122 : 0;
  const effectiveRouteOcclusion = useMemo(
    () => ({
      top: Math.max(Number(activeOcclusion.top) || 0, Number(homeOccludedTop) || 0),
      bottom: Math.max(Number(activeOcclusion.bottom) || 0, Number(homeOccludedBottom) || 0),
    }),
    [
      activeOcclusion.bottom,
      activeOcclusion.top,
      homeOccludedBottom,
      homeOccludedTop,
    ],
  );
  const routeViewportOcclusion = useMemo(() => {
    if (!passengerHomePreviewRouteActive) {
      return effectiveRouteOcclusion;
    }

    return {
      ...effectiveRouteOcclusion,
      bottom: Math.max(
        Number(insets.bottom) || 0,
        Number(effectiveRouteOcclusion.bottom || 0) -
          PREBOOKING_ROUTE_BOTTOM_OCCLUSION_RELIEF,
      ),
    };
  }, [
    effectiveRouteOcclusion.bottom,
    effectiveRouteOcclusion.top,
    insets.bottom,
    passengerHomePreviewRouteActive,
  ]);
  const routeViewportLayoutKey = useMemo(() => {
    if (!routeLayoutKey) {
      return '';
    }

    return [
      routeLayoutKey,
      Math.round(Number(mapWidth || windowWidth) || 0),
      Math.round(Number(mapHeight || windowHeight) || 0),
      Math.round(routeViewportOcclusion.top),
      Math.round(routeViewportOcclusion.bottom),
    ].join('|');
  }, [
    mapHeight,
    mapWidth,
    routeViewportOcclusion.bottom,
    routeViewportOcclusion.top,
    routeLayoutKey,
    windowHeight,
    windowWidth,
  ]);
  const homePickupMarkerTop = useMemo(() => {
    const bottomInset = homePickupPickerVisible
      ? insets.bottom + HOME_PICKUP_PICKER_BOTTOM_OFFSET + homePickupPickerCardHeight
      : 0;
    const visibleHeight = Math.max(
      220,
      windowHeight - homeOccludedTop - bottomInset
    );
    return homeOccludedTop + visibleHeight / 2 - 48;
  }, [
    homeOccludedTop,
    homePickupPickerCardHeight,
    homePickupPickerVisible,
    insets.bottom,
    windowHeight
  ]);
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
    runtimeHomeSurfaceReady &&
      showHomeChrome &&
      !isDriverRole &&
      !isDriverRoute &&
      !homePickupPickerVisible &&
      !canShowPassengerHomeOverlay &&
      normalizedBookingStatus === 'idle'
  );
  const hasPassengerLockedRideSurface = Boolean(
    runtimeHomeSurfaceReady &&
      showHomeChrome &&
      !isDriverRole &&
      isPassengerRideLifecycleLocked
  );
  const showPassengerHomeSkeleton = Boolean(
    showHomeChrome &&
      !isDriverRole &&
      !isDriverRoute &&
      !homePickupPickerVisible &&
      !canShowPassengerHomeOverlay &&
      !showPassengerBottomIsland &&
      !hasPassengerLockedRideSurface
  );
  const showDriverHomeSkeleton = Boolean(
    showHomeChrome &&
      isDriverRole &&
      isHomeRoute &&
      !homePickupPickerVisible &&
      !hasDriverLiveRideOverlay &&
      !showDriverHomeOverlay
  );
  const hasPrimaryHomeBottomSurface = Boolean(
    homePickupPickerVisible ||
      hasPassengerLockedRideSurface ||
      canShowPassengerHomeOverlay ||
      showPassengerHomeSkeleton ||
      showDriverHomeSkeleton ||
      hasDriverLiveRideOverlay ||
      showDriverHomeOverlay
  );
  const shouldCoverBareHomeMap = Boolean(
    showHomeChrome &&
      !hasPrimaryHomeBottomSurface
  );
  const effectiveHomeSurfaceLoadingVisible = Boolean(
    homeRuntimeHydrationPending ||
      (
        (homeSurfaceLoadingVisible || shouldCoverBareHomeMap) &&
        !showPassengerHomeSkeleton &&
        !showDriverHomeSkeleton
      )
  );
  const homeSurfaceInteractionBlocked = Boolean(
    effectiveHomeSurfaceLoadingVisible ||
      showPassengerHomeSkeleton ||
      showDriverHomeSkeleton
  );
  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-home',
    occludedTop: homeOccludedTop,
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
    const baseCoordinate =
      effectiveHomePickupCoordinate || currentCoordinate || DEFAULT_USER_COORDINATE;
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
  }, [
    activeOcclusion.bottom,
    activeOcclusion.top,
    baselineOccludedBottom,
    currentCoordinate,
    effectiveHomePickupCoordinate,
    homePickupPickerVisible,
    mapHeight,
    windowHeight
  ]);

  const resolveVisibleMapCenterCoordinate = useCallback((nextRegion) => {
    const latitude = Number(nextRegion?.latitude);
    const longitude = Number(nextRegion?.longitude);
    const latitudeDelta = Number(nextRegion?.latitudeDelta);
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitudeDelta)
    ) {
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
    const latitudeOffset = (latitudeDelta * pixelOffsetY) / effectiveHeight;

    return {
      latitude: latitude - latitudeOffset,
      longitude
    };
  }, [activeOcclusion.bottom, activeOcclusion.top, mapHeight, windowHeight]);

  useEffect(() => {
    if (!showDriverH3Overlay) {
      driverH3OverlayWasVisibleRef.current = false;
      driverH3LastFetchKeyRef.current = '';
      driverH3LastFetchAtRef.current = 0;
      driverH3DisabledUntilRef.current = 0;
      setDriverH3Cells([]);
      setDriverH3VisualPolicy(DEFAULT_DRIVER_H3_VISUAL_POLICY);
      return;
    }

    if (!driverH3OverlayWasVisibleRef.current) {
      driverH3OverlayWasVisibleRef.current = true;
      setVisibleMapRegion(targetRegion);
    }
  }, [showDriverH3Overlay, targetRegion]);

  const buildDriverH3RequestKey = useCallback((region) => {
    const latitude = Number(region?.latitude);
    const longitude = Number(region?.longitude);
    const latitudeDelta = Number(region?.latitudeDelta);
    const longitudeDelta = Number(region?.longitudeDelta);

    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      !Number.isFinite(latitudeDelta) ||
      !Number.isFinite(longitudeDelta)
    ) {
      return '';
    }

    return [
      latitude.toFixed(3),
      longitude.toFixed(3),
      latitudeDelta.toFixed(3),
      longitudeDelta.toFixed(3),
    ].join(':');
  }, []);

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
      const regionForFetch = visibleMapRegion || targetRegion;
      const requestKey = buildDriverH3RequestKey(regionForFetch);
      const now = Date.now();

      if (!requestKey || driverH3DisabledUntilRef.current > now) {
        return;
      }

      const fetchedRecently =
        now - driverH3LastFetchAtRef.current < Math.max(
          DRIVER_H3_MIN_FETCH_INTERVAL_MS,
          Number(driverH3RefreshPolicy?.pollIntervalMs || DRIVER_H3_DEFAULT_FETCH_INTERVAL_MS)
        );
      if (fetchedRecently) {
        return;
      }

      try {
        const response = await fetchH3CellsForRegion(regionForFetch, {
          surface: 'driver',
          signal: controller.signal
        });

        if (controller.signal.aborted) {
          return;
        }

        driverH3LastFetchKeyRef.current = requestKey;
        driverH3LastFetchAtRef.current = Date.now();
        setDriverH3Cells(Array.isArray(response?.cells) ? response.cells : []);
        setDriverH3VisualPolicy(response?.visualPolicy || DEFAULT_DRIVER_H3_VISUAL_POLICY);
        setDriverH3RefreshPolicy({
          pollIntervalMs: Math.max(
            DRIVER_H3_MIN_FETCH_INTERVAL_MS,
            Number(response?.refreshPolicy?.pollIntervalMs || DRIVER_H3_DEFAULT_FETCH_INTERVAL_MS)
          ),
          staleAfterMs: Math.max(
            DRIVER_H3_DEFAULT_FETCH_INTERVAL_MS,
            Number(response?.refreshPolicy?.staleAfterMs || DRIVER_H3_DEFAULT_FETCH_INTERVAL_MS * 2)
          ),
          trafficLayerEnabled: response?.refreshPolicy?.trafficLayerEnabled !== false,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          const status = Number(error?.status || error?.response?.status || 0);
          if (status === 401 || status === 403) {
            driverH3DisabledUntilRef.current = Date.now() + DRIVER_H3_AUTH_COOLDOWN_MS;
          }
          setDriverH3Cells([]);
          setDriverH3VisualPolicy(DEFAULT_DRIVER_H3_VISUAL_POLICY);
        }
      }
    }, DRIVER_H3_VIEWPORT_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [
    buildDriverH3RequestKey,
    driverH3RefreshNonce,
    driverH3RefreshPolicy?.pollIntervalMs,
    showDriverH3Overlay,
    targetRegion,
    visibleMapRegion
  ]);

  useEffect(() => {
    if (!showDriverH3Overlay) {
      return undefined;
    }

    const intervalMs = Math.max(
      DRIVER_H3_MIN_FETCH_INTERVAL_MS,
      Number(driverH3RefreshPolicy?.pollIntervalMs || DRIVER_H3_DEFAULT_FETCH_INTERVAL_MS)
    );
    const interval = setInterval(() => {
      setDriverH3RefreshNonce((current) => current + 1);
    }, intervalMs);

    return () => clearInterval(interval);
  }, [driverH3RefreshPolicy?.pollIntervalMs, showDriverH3Overlay]);

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
    if (
      !showDriverH3Overlay
      || driverH3VisualPolicy?.enabled === false
      || !Array.isArray(driverH3Cells)
      || driverH3Cells.length === 0
    ) {
      return null;
    }

    const surgeCells = driverH3Cells.filter((cell) => (
      Array.isArray(cell?.boundary)
      && cell.boundary.length >= 6
      && Number(cell?.surge?.percent || 0) > 0
      && Number.isFinite(Number(cell?.center?.lat))
      && Number.isFinite(Number(cell?.center?.lng))
    ));

    if (surgeCells.length === 0) {
      return null;
    }

    const labelCandidates = [...surgeCells]
      .filter((cell) => (
        driverH3VisualPolicy?.label?.enabled !== false
        && cell?.surge?.labelVisible !== false
        && isCoordinateInsideRegion(cell?.center, visibleMapRegion, 0.035)
      ))
      .sort((left, right) => Number(right?.surge?.percent || 0) - Number(left?.surge?.percent || 0));
    const labelCells = selectSeparatedH3Labels(labelCandidates, visibleMapRegion, {
      maxVisible: Math.min(
        5,
        Math.max(0, Number(driverH3VisualPolicy?.label?.maxVisible ?? 5))
      ),
      minDistanceRatio: 0.18,
    });

    return (
      <>
        {surgeCells.map((cell) => (
          <Polygon
            key={`surge-${cell.h3Index}`}
            coordinates={cell.boundary.map((point) => ({
              latitude: Number(point.lat),
              longitude: Number(point.lng)
            }))}
            strokeWidth={0}
            strokeColor="rgba(0,0,0,0)"
            fillColor={hexToRgba(
              cell?.style?.fill || '#FACC15',
              Math.min(Number(cell?.style?.fillOpacity ?? 0.16), 0.2)
            )}
          />
        ))}
        {labelCells.map((cell) => {
          const percent = Number(cell?.surge?.percent || 0);
          const label = cell?.surge?.label || `+${Math.round(percent)}%`;
          const anchor = resolveH3LabelAnchor(cell.center, visibleMapRegion);

          return (
            <Marker
              key={`surge-label-${cell.h3Index}`}
              coordinate={{
                latitude: Number(cell.center.lat),
                longitude: Number(cell.center.lng)
              }}
              anchor={anchor}
              tracksViewChanges={Platform.OS === 'android'}
            >
              <View
                collapsable={false}
                style={[
                  styles.driverSurgeFlag,
                  {
                    backgroundColor: hexToRgba(
                      driverH3VisualPolicy?.label?.backgroundColor || '#171412',
                      Number(driverH3VisualPolicy?.label?.backgroundOpacity ?? 0.9)
                    ),
                    borderColor: hexToRgba(
                      driverH3VisualPolicy?.label?.borderColor || '#FFFFFF',
                      Number(driverH3VisualPolicy?.label?.borderOpacity ?? 0.82)
                    )
                  }
                ]}
              >
                <Text
                  style={[
                    styles.driverSurgeFlagText,
                    {
                      color: driverH3VisualPolicy?.label?.textColor || '#FFFFFF',
                      fontSize: Number(driverH3VisualPolicy?.label?.fontSize || 12),
                      lineHeight: Number(driverH3VisualPolicy?.label?.fontSize || 12) + 2
                    }
                  ]}
                >
                  {label}
                </Text>
              </View>
            </Marker>
          );
        })}
      </>
    );
  }, [driverH3Cells, driverH3VisualPolicy, showDriverH3Overlay, visibleMapRegion]);

  const getRouteEdgePadding = useCallback(() => {
    const isPreBookingRoutePreview = Boolean(passengerHomePreviewRouteActive);
    return buildVisibleRouteEdgePadding({
      mapHeight: mapHeight || windowHeight,
      activeOcclusion: routeViewportOcclusion,
      insets,
      sidePadding: ROUTE_SIDE_PADDING,
      topExtraPadding: isPreBookingRoutePreview
        ? PREBOOKING_ROUTE_TOP_EXTRA_PADDING
        : ROUTE_TOP_EXTRA_PADDING,
      bottomExtraPadding: isPreBookingRoutePreview
        ? PREBOOKING_ROUTE_BOTTOM_EXTRA_PADDING
        : ROUTE_BOTTOM_EXTRA_PADDING,
      minVisibleHeight: MAP_MIN_VISIBLE_HEIGHT,
      overlayBiasRatio: isPreBookingRoutePreview
        ? PREBOOKING_ROUTE_OVERLAY_BIAS_RATIO
        : hasDriverLiveRideOverlay ? 0.36 : 0.28,
    });
  }, [
    hasDriverLiveRideOverlay,
    insets.bottom,
    insets.top,
    mapHeight,
    passengerHomePreviewRouteActive,
    routeViewportOcclusion.bottom,
    routeViewportOcclusion.top,
    windowHeight,
  ]);
  const homeRouteViewportPadding = useMemo(() => {
    if (!hasActiveRoute) {
      return null;
    }

    return getRouteEdgePadding();
  }, [getRouteEdgePadding, hasActiveRoute]);
  const homeRouteViewportRegion = useMemo(() => {
    if (!hasActiveRoute) {
      return null;
    }

    const routeViewportRegion = buildRouteViewportRegion({
      coordinates: presentedRouteCoordinates,
      mapWidth: mapWidth || windowWidth,
      mapHeight: mapHeight || windowHeight,
      activeOcclusion: routeViewportOcclusion,
      insets,
      viewportPadding: homeRouteViewportPadding,
      minVisibleHeight: MAP_MIN_VISIBLE_HEIGHT,
      longRouteLatitudeDeltaMultiplier: passengerHomePreviewRouteActive
        ? PREBOOKING_ROUTE_LATITUDE_DELTA_MULTIPLIER
        : undefined,
      longRouteLongitudeDeltaMultiplier: passengerHomePreviewRouteActive
        ? PREBOOKING_ROUTE_LONGITUDE_DELTA_MULTIPLIER
        : undefined,
    });
    if (!passengerHomePreviewRouteActive || !routeViewportRegion) {
      return routeViewportRegion;
    }

    return {
      ...routeViewportRegion,
      latitude:
        routeViewportRegion.latitude +
        routeViewportRegion.latitudeDelta *
          PREBOOKING_ROUTE_VIEWPORT_LATITUDE_OFFSET_RATIO,
      latitudeDelta:
        routeViewportRegion.latitudeDelta *
        PREBOOKING_ROUTE_VIEWPORT_DELTA_SCALE,
      longitudeDelta:
        routeViewportRegion.longitudeDelta *
        PREBOOKING_ROUTE_VIEWPORT_DELTA_SCALE,
    };
  }, [
    hasActiveRoute,
    homeRouteViewportPadding,
    insets,
    mapHeight,
    mapWidth,
    passengerHomePreviewRouteActive,
    presentedRouteCoordinates,
    routeViewportOcclusion.bottom,
    routeViewportOcclusion.top,
    windowHeight,
    windowWidth,
  ]);

  const focusRoute = useCallback((routePayload, animatedFit = true) => {
    if (!mapRef.current || !homeMapInteractiveReady || !routePayload) {
      return;
    }

    const coordinates = Array.isArray(routePayload?.coordinates)
      ? routePayload.coordinates
      : [];
    if (coordinates.length < 2) {
      return;
    }

    const routeViewportRegion = buildRouteViewportRegion({
      coordinates,
      mapWidth: mapWidth || windowWidth,
      mapHeight: mapHeight || windowHeight,
      activeOcclusion: routeViewportOcclusion,
      insets,
      viewportPadding: getRouteEdgePadding(),
      minVisibleHeight: MAP_MIN_VISIBLE_HEIGHT,
      longRouteLatitudeDeltaMultiplier: passengerHomePreviewRouteActive
        ? PREBOOKING_ROUTE_LATITUDE_DELTA_MULTIPLIER
        : undefined,
      longRouteLongitudeDeltaMultiplier: passengerHomePreviewRouteActive
        ? PREBOOKING_ROUTE_LONGITUDE_DELTA_MULTIPLIER
        : undefined,
    });
    const edgePadding = getRouteEdgePadding();
    mapRef.current.animateCamera({ heading: 0, pitch: 0 }, { duration: animatedFit ? 220 : 0 });
    if (routeViewportRegion) {
      const adjustedRouteViewportRegion = passengerHomePreviewRouteActive
        ? {
            ...routeViewportRegion,
            latitude:
              routeViewportRegion.latitude +
              routeViewportRegion.latitudeDelta *
                PREBOOKING_ROUTE_VIEWPORT_LATITUDE_OFFSET_RATIO,
            latitudeDelta:
              routeViewportRegion.latitudeDelta *
              PREBOOKING_ROUTE_VIEWPORT_DELTA_SCALE,
            longitudeDelta:
              routeViewportRegion.longitudeDelta *
              PREBOOKING_ROUTE_VIEWPORT_DELTA_SCALE,
          }
        : routeViewportRegion;
      mapRef.current.animateToRegion(
        adjustedRouteViewportRegion,
        animatedFit ? MAP_OCCLUSION_REPOSITION_MS : 0,
      );
      return;
    }

    if (typeof mapRef.current.fitToCoordinates === 'function') {
      try {
        mapRef.current.fitToCoordinates(coordinates, {
          edgePadding,
          animated: animatedFit
        });
      } catch (_error) {
        // No fallback available when native fit and computed region both fail.
      }
    }
  }, [
    getRouteEdgePadding,
    homeMapInteractiveReady,
    insets,
    mapHeight,
    mapWidth,
    passengerHomePreviewRouteActive,
    routeViewportOcclusion,
    windowHeight,
    windowWidth,
  ]);

  const focusSearchArea = useCallback((animatedFit = true) => {
    if (!mapRef.current || !homeMapInteractiveReady || !isSearchingMode || !searchTargetRegion) {
      return;
    }

    mapRef.current.animateToRegion(
      searchTargetRegion,
      animatedFit ? SEARCH_ZOOM_ANIMATION_MS : 0
    );
  }, [
    homeMapInteractiveReady,
    isSearchingMode,
    searchTargetRegion
  ]);

  useEffect(() => {
    if (
      !mapRef.current ||
      !homeMapInteractiveReady ||
      !hasActiveRoute ||
      !routeViewportLayoutKey ||
      isSearchingMode ||
      driverNavigationCameraOwnsMap
    ) {
      return;
    }

    const routeFocusTrackingKey = showLeafNativeNavigation
      ? leafNativeNavigationKey || 'leaf-native-navigation'
      : liveRouteTrackingKey;
    const nextRouteFocusKey = `${routeViewportLayoutKey}|${routeFocusTrackingKey}`;
    if (lastRouteLayoutKeyRef.current === nextRouteFocusKey) {
      return;
    }

    lastRouteLayoutKeyRef.current = nextRouteFocusKey;
    focusRoute(activeRoute, true);
  }, [
    activeRoute,
    driverNavigationCameraOwnsMap,
    focusRoute,
    hasActiveRoute,
    homeMapInteractiveReady,
    isSearchingMode,
    leafNativeNavigationKey,
    liveRouteTrackingKey,
    routeViewportLayoutKey,
    showLeafNativeNavigation,
  ]);

  useEffect(() => {
    if (!mapRef.current || !homeMapInteractiveReady || hasActiveRoute || isSearchingMode || shouldFreezeBackgroundMapCamera) {
      return;
    }

    if (!mapFollowingUser) {
      return;
    }

    lastRouteLayoutKeyRef.current = '';
    mapRef.current.animateToRegion(targetRegion, MAP_OCCLUSION_REPOSITION_MS);
  }, [hasActiveRoute, homeMapInteractiveReady, isSearchingMode, mapFollowingUser, shouldFreezeBackgroundMapCamera, targetRegion]);

  useEffect(() => {
    if (!isSearchingMode) {
      setNearbyDriverCoordinates((previous) => (
        Array.isArray(previous) && previous.length === 0 ? previous : []
      ));
      driverAvailabilityService.stopMonitoring();
      return;
    }

    const latitude = Number(searchCenterCoordinate?.latitude);
    const longitude = Number(searchCenterCoordinate?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setNearbyDriverCoordinates([]);
      driverAvailabilityService.stopMonitoring();
      return;
    }

    const unsubscribe = driverAvailabilityService.subscribe((drivers = []) => {
      const mappedDrivers = Array.isArray(drivers)
        ? drivers
            .map((driver, index) => {
              const driverLatitude = Number(driver?.location?.lat);
              const driverLongitude = Number(driver?.location?.lng);
              if (!Number.isFinite(driverLatitude) || !Number.isFinite(driverLongitude)) {
                return null;
              }

              return {
                id: String(driver?.id || `driver-${index}`),
                coordinate: {
                  latitude: driverLatitude,
                  longitude: driverLongitude,
                },
                heading: Number.isFinite(Number(driver?.heading))
                  ? Number(driver.heading)
                  : 0,
                color:
                  driver?.vehicleColor ||
                  driver?.carColor ||
                  driver?.color ||
                  undefined,
                vehicleColor:
                  driver?.vehicleColor ||
                  driver?.carColor ||
                  driver?.color ||
                  undefined,
                source: driver?.source || 'drivers_nearby',
              };
            })
            .filter(Boolean)
        : [];
      setNearbyDriverCoordinates(mappedDrivers);
    });

    driverAvailabilityService.startMonitoring(
      { lat: latitude, lng: longitude },
      Math.max(1, Math.min(SEARCH_MAX_RADIUS_KM, Number(searchRadiusKm) || 5)),
      6000,
    );

    return () => {
      unsubscribe();
      driverAvailabilityService.stopMonitoring();
      setNearbyDriverCoordinates([]);
    };
  }, [isSearchingMode, searchCenterCoordinate?.latitude, searchCenterCoordinate?.longitude, searchRadiusKm]);

  useEffect(() => {
    if (!mapRef.current || !homeMapInteractiveReady || !isSearchingMode || !searchRegion) {
      return;
    }

    const cameraRadiusKey = `${searchRadiusKm || 0}:${searchPreviewRadiusKm || 0}`;
    const changedRadius = lastSearchRadiusRef.current !== cameraRadiusKey;
    lastSearchRadiusRef.current = cameraRadiusKey;
    focusSearchArea(changedRadius);
  }, [
    focusSearchArea,
    homeMapInteractiveReady,
    isSearchingMode,
    searchPreviewRadiusKm,
    searchRadiusKm,
    searchRegion,
  ]);

  useEffect(() => {
    if (isSearchingMode) {
      wasSearchingRef.current = true;
      return;
    }

    if (!wasSearchingRef.current || !mapRef.current || !homeMapInteractiveReady) {
      return;
    }

    wasSearchingRef.current = false;
    lastSearchRadiusRef.current = null;

    if (hasActiveRoute || shouldFreezeBackgroundMapCamera) {
      if (!hasActiveRoute) {
        return;
      }
      if (driverNavigationCameraOwnsMap) {
        return;
      }
      const routeFocusTrackingKey = showLeafNativeNavigation
        ? leafNativeNavigationKey || 'leaf-native-navigation'
        : liveRouteTrackingKey;
      lastRouteLayoutKeyRef.current = `${routeViewportLayoutKey}|${routeFocusTrackingKey}`;
      focusRoute(activeRoute, true);
      return;
    }

    setMapFollowingUser(true);
    lastRouteLayoutKeyRef.current = '';
    mapRef.current.animateToRegion(targetRegion, MAP_RETURN_REPOSITION_MS);
  }, [
    activeRoute,
    driverNavigationCameraOwnsMap,
    focusRoute,
    hasActiveRoute,
    homeMapInteractiveReady,
    isSearchingMode,
    leafNativeNavigationKey,
    liveRouteTrackingKey,
    routeViewportLayoutKey,
    shouldFreezeBackgroundMapCamera,
    showLeafNativeNavigation,
    targetRegion,
  ]);

  const handleCenterMap = useCallback(() => {
    if (mapRef.current && homeMapInteractiveReady) {
      setMapFollowingUser(true);

      if (isSearchingMode && searchRegion) {
        focusSearchArea(true);
        return;
      }

      if (hasActiveRoute) {
        lastRouteLayoutKeyRef.current = routeViewportLayoutKey;
        focusRoute(activeRoute, true);
        return;
      }
      lastRouteLayoutKeyRef.current = '';
      mapRef.current.animateToRegion(targetRegion, MAP_OCCLUSION_REPOSITION_MS);
    }
  }, [activeRoute, focusRoute, focusSearchArea, hasActiveRoute, homeMapInteractiveReady, isSearchingMode, routeViewportLayoutKey, searchRegion, targetRegion]);

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
      !homeMapInteractiveReady ||
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
      leafNativeNavigationCameraHeading,
    );
    lastNativeNavigationHeadingRef.current = resolvedCameraHeading;
    const navigationSpeedKmh = Number(driverTripAssistNativeNavigation?.currentSpeedKmh);
    const resolvedCameraZoom = Number.isFinite(Number(driverTripAssistNativeNavigation?.cameraZoom))
      ? Number(driverTripAssistNativeNavigation.cameraZoom)
      : resolveNavigationCameraZoom(navigationSpeedKmh);
    const resolvedCameraPitch = Number.isFinite(Number(driverTripAssistNativeNavigation?.cameraPitch))
      ? Number(driverTripAssistNativeNavigation.cameraPitch)
      : resolveNavigationCameraPitch(navigationSpeedKmh);
    const resolvedCameraAnchorY = Number.isFinite(Number(driverTripAssistNativeNavigation?.cameraAnchorY))
      ? Number(driverTripAssistNativeNavigation.cameraAnchorY)
      : NAVIGATION_CAMERA_ANCHOR_Y;
    const lookAheadKm = Number.isFinite(Number(resolvedCameraHeading))
      ? resolveNavigationCameraLookAheadKm({
          coordinate: activeDriverNavigationCoordinate,
          zoom: resolvedCameraZoom,
          mapHeight,
          anchorY: resolvedCameraAnchorY,
        })
      : 0;
    const cameraCenterCoordinate = Number.isFinite(Number(resolvedCameraHeading))
      ? offsetCoordinateByDistance(
          activeDriverNavigationCoordinate,
          lookAheadKm,
          resolvedCameraHeading,
        )
      : activeDriverNavigationCoordinate;
    const animationDurationMs = Number.isFinite(Number(driverTripAssistNativeNavigation?.cameraAnimationDurationMs))
      ? Number(driverTripAssistNativeNavigation.cameraAnimationDurationMs)
      : NAVIGATION_CAMERA_ANIMATION_MS;
    mapRef.current.animateCamera(
      {
        center: {
          latitude: cameraCenterCoordinate.latitude,
          longitude: cameraCenterCoordinate.longitude,
        },
        zoom: resolvedCameraZoom,
        heading: resolvedCameraHeading ?? 0,
        pitch: resolvedCameraPitch,
      },
      { duration: animationDurationMs }
    );
    appendPrototypeRuntimeDebugStep('leaf_native_camera_follow', {
      key: leafNativeNavigationKey,
      latitude: Number(activeDriverNavigationCoordinate.latitude.toFixed(6)),
      longitude: Number(activeDriverNavigationCoordinate.longitude.toFixed(6)),
      cameraLatitude: Number(cameraCenterCoordinate.latitude.toFixed(6)),
      cameraLongitude: Number(cameraCenterCoordinate.longitude.toFixed(6)),
      heading: Number.isFinite(Number(resolvedCameraHeading))
        ? Number(Number(resolvedCameraHeading).toFixed(1))
        : 0,
      routeHeading: Number.isFinite(Number(leafNativeNavigationCameraHeading))
        ? Number(Number(leafNativeNavigationCameraHeading).toFixed(1))
        : null,
      zoom: resolvedCameraZoom,
      pitch: resolvedCameraPitch,
      anchorY: resolvedCameraAnchorY,
      speedKmh: Number.isFinite(navigationSpeedKmh)
        ? Number(navigationSpeedKmh.toFixed(1))
        : 0,
      lookAheadKm,
      throttleMs: LEAF_NATIVE_NAV_CAMERA_THROTTLE_MS,
      animationMs: animationDurationMs,
    });
  }, [
    activeDriverNavigationCoordinate,
    driverTripAssistNativeNavigation?.cameraAnchorY,
    driverTripAssistNativeNavigation?.cameraAnimationDurationMs,
    driverTripAssistNativeNavigation?.cameraPitch,
    driverTripAssistNativeNavigation?.cameraZoom,
    driverTripAssistNativeNavigation?.currentSpeedKmh,
    homeMapInteractiveReady,
    isSearchingMode,
    leafNativeNavigationCameraHeading,
    leafNativeNavigationKey,
    mapHeight,
    shouldFreezeBackgroundMapCamera,
    showLeafNativeNavigation,
  ]);

  const handleMapRegionChangeComplete = useCallback((nextRegion) => {
    if (!nextRegion) {
      return;
    }

    const now = Date.now();
    const source =
      now - Number(lastManualMapPanAtRef.current || 0) < 4500
        ? 'gesture'
        : 'camera';
    const visibleCenterCoordinate = resolveVisibleMapCenterCoordinate(nextRegion);
    publishPrototypeMapCamera({
      ...nextRegion,
      visibleCenterCoordinate,
      source,
      updatedAt: now,
    });

    if (homePickupPickerVisible && source === 'gesture' && isFiniteCoordinate(visibleCenterCoordinate)) {
      setHomePickupCoordinate(visibleCenterCoordinate);
      setHomePickupAddress('Localizando endereço...');
      setHomePickupAdjustedOnMap(true);
    }

    if (!showDriverH3Overlay) {
      return;
    }

    setVisibleMapRegion((previousRegion) => (
      buildDriverH3RequestKey(previousRegion) === buildDriverH3RequestKey(nextRegion)
        ? previousRegion
        : nextRegion
    ));
  }, [
    buildDriverH3RequestKey,
    homePickupPickerVisible,
    resolveVisibleMapCenterCoordinate,
    showDriverH3Overlay,
  ]);

  useEffect(() => {
    if (
      !homePickupAdjustedOnMap ||
      !isFiniteCoordinate(homePickupCoordinate) ||
      (!homePickupPickerVisible && homePickupAddress !== 'Localizando endereço...')
    ) {
      return undefined;
    }

    const cacheKey = buildHomePickupReverseCacheKey(homePickupCoordinate);
    if (!cacheKey) {
      return undefined;
    }

    let cancelled = false;
    homePickupReverseRequestKeyRef.current = cacheKey;

    const resolveAddress = async () => {
      try {
        const cached = await AsyncStorage.getItem(cacheKey);
        if (cancelled || homePickupReverseRequestKeyRef.current !== cacheKey) {
          return;
        }
        if (cached) {
          const parsed = JSON.parse(cached);
          const cachedAddress = resolvePickupAddressCandidate(parsed?.address, parsed?.formatted_address);
          if (
            cachedAddress &&
            isHomePickupReverseGeocodeMatch(homePickupCoordinate, parsed)
          ) {
            setHomePickupAddress(cachedAddress);
            return;
          }
        }
      } catch (_error) {
        // Local cache failure should not block address resolution.
      }

      const telemetryContext = {
        sourceKey: `mobile:pickup_reverse:${profileUid || profile?.uid || 'anonymous'}`,
        sourceMeta: {
          userId: profileUid || profile?.uid || null,
          userType: normalizeHomeRole(activeRole) || 'customer',
          platform: Platform.OS,
          flow: 'passenger_home',
          surface: 'pickup_pin_reverse_geocode',
        },
      };
      const resolved = await fetchHomePickupReverseGeocode(
        homePickupCoordinate,
        telemetryContext,
      );
      if (cancelled || homePickupReverseRequestKeyRef.current !== cacheKey) {
        return;
      }
      if (
        resolved?.address &&
        isHomePickupReverseGeocodeMatch(homePickupCoordinate, resolved)
      ) {
        setHomePickupAddress(resolved.address);
        AsyncStorage.setItem(cacheKey, JSON.stringify(resolved)).catch(() => {});
        return;
      }

      setHomePickupAddress(previous => (
        previous && previous !== 'Localizando endereço...'
          ? previous
          : 'Ponto ajustado no mapa'
      ));
    };

    const timer = setTimeout(resolveAddress, HOME_PICKUP_REVERSE_GEOCODE_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    activeRole,
    homePickupAdjustedOnMap,
    homePickupAddress,
    homePickupCoordinate,
    homePickupPickerVisible,
    profile?.uid,
    profileUid,
  ]);

  const handleMapLayout = useCallback(event => {
    const nextWidth = event?.nativeEvent?.layout?.width;
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextWidth) && nextWidth > 0 && Number.isFinite(nextHeight) && nextHeight > 0) {
      setMapWidth(previous => (previous === nextWidth ? previous : nextWidth));
      setMapHeight(previous => (previous === nextHeight ? previous : nextHeight));
      setHomeMapLayoutReady(true);
    }
  }, []);

  const handleSearchCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setHomeCardHeight(previous => (previous === nextHeight ? previous : nextHeight));
    }
  }, []);

  const handleHomePickupPickerCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setHomePickupPickerCardHeight(previous => (previous === nextHeight ? previous : nextHeight));
    }
  }, []);

  const focusHomePickupCoordinate = useCallback((coordinate = effectiveHomePickupCoordinate) => {
    if (!mapRef.current || !homeMapInteractiveReady || !isFiniteCoordinate(coordinate)) {
      return;
    }

    mapRef.current.animateCamera(
      {
        center: coordinate,
        zoom: Platform.OS === 'ios' ? 16 : 17,
        pitch: 0,
        heading: 0,
      },
      { duration: 520 }
    );
  }, [effectiveHomePickupCoordinate, homeMapInteractiveReady]);

  const handleOpenHomePickupSearch = useCallback(() => {
    setHomeDestinationSearchActive(false);
    setHomeDestinationQuery('');
    setHomeDestinationResults([]);
    setHomeDestinationSearching(false);
    setHomePickupSearchQuery(
      homePickupAdjustedOnMap
        ? homePickupAddress || ''
        : effectiveHomePickupAddress || homePickupDisplayLabel || '',
    );
    setHomePickupSearchResults([]);
    setHomePickupSearching(false);
    homePickupSearchSessionTokenRef.current = createHomePickupSearchSessionToken();
    setHomePickupSearchActive(true);
  }, [
    effectiveHomePickupAddress,
    homePickupAddress,
    homePickupAdjustedOnMap,
    homePickupDisplayLabel,
  ]);

  const handleCloseHomePickupSearch = useCallback(() => {
    setHomePickupSearchActive(false);
    setHomePickupSearchQuery('');
    setHomePickupSearchResults([]);
    setHomePickupSearching(false);
    homePickupSearchSessionTokenRef.current = '';
    Keyboard.dismiss();
  }, []);

  const handleOpenHomePickupPicker = useCallback(() => {
    const nextCoordinate = homePickupAdjustedOnMap && isFiniteCoordinate(homePickupCoordinate)
      ? homePickupCoordinate
      : effectiveHomePickupCoordinate;
    homePickupDraftBeforePickerRef.current = {
      coordinate: homePickupCoordinate,
      address: homePickupAddress,
      adjustedOnMap: homePickupAdjustedOnMap,
    };
    setHomePickupCoordinate(nextCoordinate);
    setHomePickupAddress(effectiveHomePickupAddress);
    setHomePickupPickerVisible(true);
    setHomePickupSearchActive(false);
    setHomePickupSearchQuery('');
    setHomePickupSearchResults([]);
    setHomePickupSearching(false);
    homePickupSearchSessionTokenRef.current = '';
    Keyboard.dismiss();
    setMapFollowingUser(false);
    requestAnimationFrame(() => focusHomePickupCoordinate(nextCoordinate));
  }, [
    effectiveHomePickupAddress,
    effectiveHomePickupCoordinate,
    focusHomePickupCoordinate,
    homePickupAddress,
    homePickupAdjustedOnMap,
    homePickupCoordinate
  ]);

  const handleOpenHomePickupPickerFromSearch = useCallback(() => {
    handleCloseHomePickupSearch();
    requestAnimationFrame(() => handleOpenHomePickupPicker());
  }, [handleCloseHomePickupSearch, handleOpenHomePickupPicker]);

  const handleUseCurrentHomePickup = useCallback(() => {
    const nextCoordinate = isFiniteCoordinate(currentCoordinate)
      ? currentCoordinate
      : null;
    setHomePickupCoordinate(nextCoordinate);
    setHomePickupAddress(currentPickupAddressCandidate || 'Local atual');
    setHomePickupAdjustedOnMap(false);
    focusHomePickupCoordinate(nextCoordinate);
  }, [
    currentCoordinate,
    currentPickupAddressCandidate,
    focusHomePickupCoordinate,
  ]);

  const handleSelectHomePickupResult = useCallback(
    async (item) => {
      const query = String(homePickupSearchQuery || '').trim();
      const fallbackPickup = {
        name: query,
        address: query,
        description: query,
      };
      const normalizedPickup = normalizeHomePickupSearchResult(
        item || fallbackPickup,
        query,
        homePickupSearchSessionTokenRef.current,
      );
      const telemetryContext = {
        sourceKey: `mobile:pickup_details:${profileUid || profile?.uid || 'anonymous'}`,
        sourceMeta: {
          userId: profileUid || profile?.uid || null,
          userType: normalizeHomeRole(activeRole) || 'customer',
          platform: Platform.OS,
          flow: 'passenger_home',
          surface: 'pickup_details',
        },
      };

      try {
        setHomePickupSearching(true);
        let resolvedCoordinate = normalizedPickup.coordinate;
        let resolvedAddress = resolvePickupAddressCandidate(
          normalizedPickup.address,
          normalizedPickup.description,
          normalizedPickup.name,
        );

        if (!resolvedCoordinate && normalizedPickup.place_id) {
          const details = await fetchCoordsfromPlace(
            normalizedPickup.place_id,
            telemetryContext,
            normalizedPickup.searchSessionToken,
            {
              query,
              description: normalizedPickup.description,
              name: normalizedPickup.name,
              address: normalizedPickup.address,
              location: normalizeHomePlaceSearchLocation(effectiveHomePickupCoordinate),
            },
          );
          const lat = Number(details?.lat);
          const lng = Number(details?.lng);
          if (Number.isFinite(lat) && Number.isFinite(lng)) {
            resolvedCoordinate = {
              latitude: lat,
              longitude: lng,
            };
          }
          resolvedAddress = resolvePickupAddressCandidate(
            details?.formatted_address,
            resolvedAddress,
            details?.name,
          );
        }

        if (!resolvedCoordinate) {
          Alert.alert(
            'Partida indisponível',
            'Não consegui confirmar esse local de partida agora. Tente buscar de novo.',
          );
          return;
        }

        const finalAddress =
          resolvedAddress ||
          normalizedPickup.description ||
          normalizedPickup.name ||
          'Ponto de partida';
        setHomePickupCoordinate(resolvedCoordinate);
        setHomePickupAddress(finalAddress);
        setHomePickupAdjustedOnMap(true);
        setHomePickupSearchActive(false);
        setHomePickupSearchQuery('');
        setHomePickupSearchResults([]);
        homePickupSearchSessionTokenRef.current = '';
        Keyboard.dismiss();
        focusHomePickupCoordinate(resolvedCoordinate);
      } catch (_error) {
        Alert.alert(
          'Partida indisponível',
          'Não consegui confirmar esse local de partida agora. Tente buscar de novo.',
        );
      } finally {
        setHomePickupSearching(false);
      }
    },
    [
      activeRole,
      effectiveHomePickupCoordinate,
      focusHomePickupCoordinate,
      homePickupSearchQuery,
      profile?.uid,
      profileUid,
    ],
  );

  const handleConfirmHomePickup = useCallback(() => {
    homePickupDraftBeforePickerRef.current = null;
    setHomePickupPickerVisible(false);
  }, []);

  const handleCancelHomePickupPicker = useCallback(() => {
    const previous = homePickupDraftBeforePickerRef.current;
    if (previous) {
      setHomePickupCoordinate(previous.coordinate);
      setHomePickupAddress(previous.address);
      setHomePickupAdjustedOnMap(Boolean(previous.adjustedOnMap));
    }
    homePickupDraftBeforePickerRef.current = null;
    setHomePickupPickerVisible(false);
  }, []);

  const handleOpenPassengerDestination = useCallback(
    (_extraParams = {}) => {
      setHomePickupSearchActive(false);
      setHomePickupSearchQuery('');
      setHomePickupSearchResults([]);
      setHomePickupSearching(false);
      homePickupSearchSessionTokenRef.current = '';
      setHomeDestinationQuery(
        homeSelectedDestination?.name ||
          homeSelectedDestination?.address ||
          '',
      );
      setHomeDestinationSearchActive(true);
    },
    [homeSelectedDestination?.address, homeSelectedDestination?.name]
  );

  const handleCloseHomeDestinationSearch = useCallback(() => {
    setHomeDestinationSearchActive(false);
    setHomeDestinationQuery('');
    setHomeDestinationResults([]);
    setHomeDestinationSearching(false);
    Keyboard.dismiss();
  }, []);

  const handleSelectHomeDestinationResult = useCallback(
    async (item) => {
      const fallbackDestination = {
        name: String(homeDestinationQuery || '').trim(),
        address: String(homeDestinationQuery || '').trim(),
      };
      const destinationInput = item || fallbackDestination;

      try {
        setHomeDestinationSearching(true);
        const resolvedDestination =
          typeof selectDestination === 'function'
            ? await selectDestination(destinationInput)
            : await resolveDestinationInput(destinationInput);

        if (!resolvedDestination?.coordinate) {
          Alert.alert(
            'Destino indisponível',
            'Não consegui confirmar esse destino agora. Tente buscar de novo.',
          );
          return;
        }

        setHomeDestinationSearchActive(false);
        setHomeDestinationQuery('');
        setHomeDestinationResults([]);
        setHomeSelectedDestination(resolvedDestination);
        setHomeSelectedCategoryId('plus');
        setHomeAvailabilityNotice('');
        Keyboard.dismiss();
      } catch (_error) {
        Alert.alert(
          'Destino indisponível',
          'Não consegui confirmar esse destino agora. Tente buscar de novo.',
        );
      } finally {
        setHomeDestinationSearching(false);
      }
    },
    [
      effectiveHomePickupCoordinate,
      homeDestinationQuery,
      resolveDestinationInput,
      selectDestination,
    ],
  );

  const refreshHomeCategoryQuotes = useCallback(() => {
    setHomeQuoteRefreshNonce((current) => current + 1);
    setHomeBackendQuoteError('');
    setHomeAvailabilityNotice('Preço expirado');
  }, []);

  const handleSelectHomeCategory = useCallback((categoryId) => {
    setHomeSelectedCategoryId(categoryId);
    setHomeAvailabilityNotice('');
    if (hasExpiredHomeBackendQuoteRecord(homeBackendQuotesByCategory)) {
      refreshHomeCategoryQuotes();
    }
  }, [homeBackendQuotesByCategory, refreshHomeCategoryQuotes]);

  const handleConfirmHomeCategory = useCallback(async () => {
    if (!homeSelectedDestination?.coordinate) {
      handleOpenPassengerDestination();
      return;
    }

    if (selectedHomeBackendQuoteExpired) {
      refreshHomeCategoryQuotes();
      return;
    }

    if (homeDriverAvailabilityRefreshing) {
      return;
    }

    if (!selectedHomeBackendQuoteReady || !homeBackendQuote?.quote) {
      return;
    }

    if (selectedHomeDriverUnavailable) {
      const hasDrivers = await refreshSelectedHomeDriverAvailability();
      if (!hasDrivers) {
        return;
      }
    }

    navigation.navigate('RobotaxiPrototypeDestination', {
      ...destinationRoutePickupParams,
      initialSelectedDestination: homeSelectedDestination,
      initialSelectedPlan: homeSelectedCategory?.id || homeSelectedCategoryId || 'plus',
      initialPricingQuote: {
        quote: homeBackendQuote.quote,
        planId: homeSelectedCategory?.id || homeSelectedCategoryId || 'plus',
        carType: selectedHomeRateCard.title,
        quoteSessionId: homeBackendQuote.quoteSessionId,
        quoteLockId:
          homeBackendQuote.quoteLockId ||
          homeBackendQuote.quote?.quoteLockId ||
          null,
        quoteLockExpiresAt:
          homeBackendQuote.quoteLockExpiresAt ||
          homeBackendQuote.quote?.quoteLockExpiresAt ||
          null,
        routeKey: homeDestinationFareQuoteRouteKey,
        quoteRouteSnapshot: homeBackendQuote.routeSnapshot,
        distanceKm: homeBackendQuote.distanceKm,
	        durationMin: homeBackendQuote.durationMin,
	        arrivalTime: homeBackendQuote.arrivalTime,
	        routeCoordinates: Array.isArray(homeRoutePreview?.coordinates)
	          ? homeRoutePreview.coordinates
	          : [],
	        trafficSegments: Array.isArray(homeRoutePreview?.trafficSegments)
	          ? homeRoutePreview.trafficSegments
	          : [],
	        routePolyline: homeRoutePreview?.polylinePoints || null,
	        tollFee: Number(homeBackendQuote.quote?.tollFee || homeRoutePreview?.tollFee || 0),
	        tolls: Array.isArray(homeBackendQuote.quote?.tolls)
	          ? homeBackendQuote.quote.tolls
	          : Array.isArray(homeRoutePreview?.tolls)
	            ? homeRoutePreview.tolls
	            : [],
	        fare: Number(homeBackendQuote.quote.estimatedFare),
	        grossEstimatedFare: Number(homeBackendQuote.quote.grossEstimatedFare),
	        expiresAt: homeBackendQuote.expiresAt,
      },
      leafDelas: homeLeafDelasEnabled,
      startAtConfirmation: true,
      skipDestinationSearch: true,
      openPixOnReady: true,
    });
  }, [
    destinationRoutePickupParams,
    handleOpenPassengerDestination,
    homeBackendQuote,
    homeDriverAvailabilityRefreshing,
	    homeDestinationFareQuoteRouteKey,
	    homeLeafDelasEnabled,
	    homeRoutePreview?.coordinates,
	    homeRoutePreview?.polylinePoints,
	    homeRoutePreview?.trafficSegments,
	    homeRoutePreview?.tollFee,
	    homeRoutePreview?.tolls,
    homeRoutePreviewKey,
    homeSelectedCategory?.id,
    homeSelectedCategoryId,
    homeSelectedDestination,
    navigation,
    refreshHomeCategoryQuotes,
    refreshSelectedHomeDriverAvailability,
    selectedHomeBackendQuoteExpired,
    selectedHomeBackendQuoteReady,
    selectedHomeDriverUnavailable,
    selectedHomeRateCard.title,
  ]);

  useEffect(() => {
    if (!Number.isFinite(homeDestinationRouteLatitude) || !Number.isFinite(homeDestinationRouteLongitude)) {
      homeRoutePreviewRequestRef.current = '';
      setHomeRoutePreview(previous => (previous ? null : previous));
      return;
    }

    const pickupCoordinate = Number.isFinite(homePickupRouteLatitude) &&
      Number.isFinite(homePickupRouteLongitude)
      ? {
          latitude: homePickupRouteLatitude,
          longitude: homePickupRouteLongitude,
        }
      : null;
    const destinationCoordinate = Number.isFinite(homeDestinationRouteLatitude) &&
      Number.isFinite(homeDestinationRouteLongitude)
      ? {
          latitude: homeDestinationRouteLatitude,
          longitude: homeDestinationRouteLongitude,
        }
      : null;
    const routeKey = homeRoutePreviewKey;
    if (!routeKey || !pickupCoordinate || !destinationCoordinate) {
      return;
    }

    homeRoutePreviewRequestRef.current = routeKey;
    const startLoc = formatDirectionsCoordinate(pickupCoordinate);
    const destLoc = formatDirectionsCoordinate(destinationCoordinate);
    const destinationName = homeSelectedDestination.name || 'Destino';
    const destinationAddress =
      homeSelectedDestination.address ||
      homeSelectedDestination.description ||
      homeSelectedDestination.name ||
      '';

    if (!startLoc || !destLoc) {
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    let cancelled = false;
    fetchPassengerHomeRoutePreview({
      startLoc,
      destLoc,
      routeKey,
      signal: controller.signal,
    })
      .then(route => {
        if (cancelled || homeRoutePreviewRequestRef.current !== routeKey) {
          return;
        }

        const coordinates = buildRouteCoordinatesFromDirectionsRoute(route);
        const trafficSegments = buildTrafficSegmentsFromDirectionsRoute(route, coordinates);
        if (coordinates.length >= 2) {
          setPrototypeMapRoute({
            origin: pickupCoordinate,
            destination: destinationCoordinate,
            coordinates,
            trafficSegments,
            destinationLabel: destinationName,
            destinationAddress,
          });
          const publishedRoute = getPrototypeMapRoute();
          if (Array.isArray(publishedRoute?.coordinates) && publishedRoute.coordinates.length >= 2) {
            setActiveRoute(publishedRoute);
          }
        } else {
          Logger.warn('[PassengerHome] Rota recebida sem geometria suficiente para polyline.');
        }

        const distanceKm = Number(route?.distance_in_km);
        const durationMin = Number(route?.time_in_secs) / 60;
        const trafficLevel =
          resolveTrafficSegmentLevelForLeg(route, route, 1) ||
          resolveWorstTrafficSegmentLevel(trafficSegments);
        setHomeRoutePreview({
          key: routeKey,
          origin: pickupCoordinate,
          destination: destinationCoordinate,
          coordinates,
          trafficSegments,
          destinationLabel: destinationName,
          destinationAddress,
          distanceKm: Number.isFinite(distanceKm) && distanceKm > 0 ? distanceKm : null,
          durationMin: Number.isFinite(durationMin) && durationMin > 0 ? durationMin : null,
          polylinePoints: route?.polylinePoints || null,
          tollFee: Number(route?.tollFee || 0),
          tolls: Array.isArray(route?.tolls) ? route.tolls : [],
          tollDetection: route?.tollDetection || null,
          trafficLevel,
        });
      })
      .catch(error => {
        if (!cancelled) {
          Logger.warn('[PassengerHome] Rota real indisponível; aguardando rota válida para exibir polyline.', error?.message || error);
        }
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });

    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, [
    homeDestinationRouteLatitude,
    homeDestinationRouteLongitude,
    homePickupRouteLatitude,
    homePickupRouteLongitude,
    homeRoutePreviewKey,
    homeSelectedDestination?.address,
    homeSelectedDestination?.description,
    homeSelectedDestination?.name,
  ]);

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

  const handleSaveDriverDestinationMode = useCallback(async ({ enabled, query } = {}) => {
    if (typeof setDriverDestinationMode !== 'function') {
      throw new Error('Modo destino indisponível nesta versão.');
    }

    if (!enabled) {
      await setDriverDestinationMode({ active: false });
      return;
    }

    const normalizedQuery = String(query || '').trim();
    if (normalizedQuery.length < 3) {
      throw new Error('Informe um destino válido.');
    }

    if (
      typeof loadDestinationSuggestions !== 'function' ||
      typeof resolveDestinationInput !== 'function'
    ) {
      throw new Error('Busca de destino indisponível agora.');
    }

    const suggestions = await loadDestinationSuggestions(normalizedQuery);
    const destination = Array.isArray(suggestions) && suggestions.length > 0
      ? suggestions[0]
      : { name: normalizedQuery, address: normalizedQuery };
    const resolvedDestination = await resolveDestinationInput(destination);
    if (!resolvedDestination?.coordinate) {
      throw new Error('Não foi possível confirmar esse destino agora.');
    }

    await setDriverDestinationMode({
      active: true,
      destination: resolvedDestination,
    });
  }, [
    loadDestinationSuggestions,
    resolveDestinationInput,
    setDriverDestinationMode,
  ]);

  useEffect(() => {
    let isMounted = true;

    const resolveDriverKycLivenessMode = async () => {
      if (!driverKycModalVisible) {
        setDriverKycProviderLoading(false);
        setDriverKycLivenessMode('local');
        return;
      }

      setDriverKycProviderLoading(true);
      const providerResult = await kycService.getPreferredLivenessMode();
      if (!isMounted) {
        return;
      }

      if (!providerResult?.success) {
        Logger.warn(
          '⚠️ [PrototypeKYC] Provider indisponível, usando fallback local:',
          providerResult?.error
        );
        setDriverKycLivenessMode('local');
        setDriverKycProviderLoading(false);
        return;
      }

      if (providerResult.mode === 'aws' && nativeAwsLivenessService.isAvailable()) {
        setDriverKycLivenessMode('aws');
        setDriverKycProviderLoading(false);
        return;
      }

      if (providerResult.mode === 'aws') {
        Logger.warn(
          '⚠️ [PrototypeKYC] Provider AWS ativo, mas módulo nativo ausente nesta build; usando fallback local.'
        );
        setDriverKycLivenessMode('local');
        setDriverKycProviderLoading(false);
        return;
      }

      setDriverKycLivenessMode('local');
      setDriverKycProviderLoading(false);
    };

    resolveDriverKycLivenessMode();
    return () => {
      isMounted = false;
    };
  }, [driverKycModalVisible]);

  const openDriverKycModal = useCallback((source = {}) => {
    if (driverHasAcceptedOrActiveWork) {
      appendPrototypeRuntimeDebugStep('driver_kyc_modal_suppressed_active_work', {
        bookingStatus: normalizedBookingStatus,
        activeRideBookingId: driverActiveRide?.bookingId || driverActiveRide?.id || '',
        liveOfferBookingId: driverLiveOffer?.bookingId || driverLiveOffer?.id || '',
      });
      setDriverKycProviderLoading(false);
      setDriverKycProcessing(false);
      setDriverKycModalVisible(false);
      return false;
    }

    const requirement =
      source?.requirement ||
      source?.payload?.requirement ||
      'LIVENESS_REQUIRED';
    const isIdentityReverification = requirement === 'IDENTITY_REVERIFICATION' ||
      source?.type === 'kyc_reverification_required' ||
      source?.payload?.type === 'kyc_reverification_required';
    const reason = isIdentityReverification
      ? DRIVER_IDENTITY_REVERIFICATION_REASON
      : (
        source?.reason ||
        source?.error ||
        source?.message ||
        source?.payload?.reason ||
        source?.payload?.error ||
        'Validação facial obrigatória para ficar online.'
      );

    setDriverKycPendingReason(reason);
    setDriverKycChallengeContext({
      challengeId: source?.challengeId || source?.payload?.challengeId || null,
      requirement,
    });
    setDriverKycProcessing(false);
    setDriverKycModalVisible(true);
    return true;
  }, [
    driverActiveRide?.bookingId,
    driverActiveRide?.id,
    driverHasAcceptedOrActiveWork,
    driverLiveOffer?.bookingId,
    driverLiveOffer?.id,
    normalizedBookingStatus,
  ]);

  const handleDriverKycModalCancel = useCallback(() => {
    setDriverKycModalVisible(false);
    setDriverKycPendingReason('');
    setDriverKycLivenessMode('local');
    setDriverKycAwsSessionId(null);
    setDriverKycProviderLoading(false);
    setDriverKycProcessing(false);
    setDriverKycChallengeContext({
      challengeId: null,
      requirement: null,
    });
  }, []);

  useEffect(() => {
    if (!driverHasAcceptedOrActiveWork || !driverKycModalVisible) {
      return;
    }

    appendPrototypeRuntimeDebugStep('driver_kyc_modal_closed_active_work', {
      bookingStatus: normalizedBookingStatus,
      activeRideBookingId: driverActiveRide?.bookingId || driverActiveRide?.id || '',
      liveOfferBookingId: driverLiveOffer?.bookingId || driverLiveOffer?.id || '',
    });
    handleDriverKycModalCancel();
  }, [
    driverActiveRide?.bookingId,
    driverActiveRide?.id,
    driverHasAcceptedOrActiveWork,
    driverKycModalVisible,
    driverLiveOffer?.bookingId,
    driverLiveOffer?.id,
    handleDriverKycModalCancel,
    normalizedBookingStatus,
  ]);

  useEffect(() => {
    const notificationType = route?.params?.notificationType;
    const requirement = route?.params?.requirement;
    const shouldOpenIdentityReverification =
      notificationType === 'kyc_reverification_required' ||
      requirement === 'IDENTITY_REVERIFICATION';
    const shouldOpenActivationLiveness =
      notificationType === 'kyc_activation_required' &&
      requirement === 'LIVENESS_REQUIRED';

    if (
      (!shouldOpenIdentityReverification && !shouldOpenActivationLiveness) ||
      !isDriverRole ||
      driverHasAcceptedOrActiveWork ||
      driverKycModalVisible
    ) {
      return;
    }

    openDriverKycModal({
      type: shouldOpenIdentityReverification
        ? 'kyc_reverification_required'
        : 'kyc_activation_required',
      reason: shouldOpenIdentityReverification
        ? DRIVER_IDENTITY_REVERIFICATION_REASON
        : (route?.params?.reason || 'Conclua a validação facial para finalizar sua ativação.'),
      challengeId: route?.params?.challengeId || null,
      requirement: shouldOpenIdentityReverification
        ? 'IDENTITY_REVERIFICATION'
        : 'LIVENESS_REQUIRED',
    });
    navigation.setParams?.({
      notificationType: null,
      requirement: null,
      challengeId: null,
      reason: null,
    });
  }, [
    driverHasAcceptedOrActiveWork,
    driverKycModalVisible,
    isDriverRole,
    navigation,
    openDriverKycModal,
    route?.params?.challengeId,
    route?.params?.notificationType,
    route?.params?.reason,
    route?.params?.requirement,
  ]);

  const handleDriverKycVerificationSuccess = useCallback(async () => {
    const onlineResult = await setDriverOnline(true);
    if (onlineResult?.success) {
      handleDriverKycModalCancel();
      return;
    }

    if (isDriverKycRequiredResult(onlineResult)) {
      setDriverKycProcessing(false);
      setDriverKycPendingReason(
        onlineResult?.reason ||
        onlineResult?.error ||
        'A validação foi registrada, mas ainda não liberou o online. Tente novamente.'
      );
      return;
    }

    handleDriverKycModalCancel();
    Alert.alert(
      'Modo motorista',
      onlineResult?.error || 'Validação concluída, mas não foi possível ficar online agora.'
    );
  }, [handleDriverKycModalCancel, setDriverOnline]);

  const handleDriverKycCapture = useCallback(async (selfieImageUri) => {
    const driverId = profile?.uid || profileUid;
    if (!driverId) {
      handleDriverKycModalCancel();
      Alert.alert('Validação facial', 'Não foi possível identificar a conta do motorista.');
      return;
    }

    setDriverKycProcessing(true);

    try {
      const kycOptions = {
        challengeId: driverKycChallengeContext.challengeId || undefined,
        requirement: driverKycChallengeContext.requirement || undefined,
        livenessPassed: true,
        awsSessionId: driverKycAwsSessionId || undefined,
      };
      const result = await kycService.verifyDriver(driverId, selfieImageUri, {
        ...kycOptions,
        mode: driverKycAwsSessionId ? 'mobile_arcface_w600k_r50_v1' : 'device_signature_v1',
        allowRawSelfieFallback: true,
        serverSideFallbackOnDeviceEmbeddingUnavailable: Boolean(driverKycAwsSessionId),
      });
      const isMatch = Boolean(result?.success && result?.data?.isMatch);

      if (!isMatch) {
        handleDriverKycModalCancel();
        Alert.alert(
          'Validação não aprovada',
          'Não foi possível validar sua identidade. Tente novamente com boa iluminação e rosto centralizado.'
        );
        return;
      }

      await handleDriverKycVerificationSuccess();
    } catch (error) {
      Logger.error('❌ [PrototypeKYC] Erro ao validar motorista:', error);
      handleDriverKycModalCancel();
      Alert.alert('Validação facial', 'Falha ao validar identidade. Tente novamente.');
    } finally {
      setDriverKycProcessing(false);
    }
  }, [
    driverKycChallengeContext.challengeId,
    driverKycChallengeContext.requirement,
    driverKycAwsSessionId,
    handleDriverKycModalCancel,
    handleDriverKycVerificationSuccess,
    profile?.uid,
    profileUid,
  ]);

  const handleDriverKycAwsSuccess = useCallback(async ({ sessionId }) => {
    const driverId = profile?.uid || profileUid;
    if (!driverId) {
      handleDriverKycModalCancel();
      Alert.alert('Validação facial', 'Não foi possível identificar a conta do motorista.');
      return;
    }

    setDriverKycProcessing(true);

    try {
      setDriverKycAwsSessionId(sessionId);
      setDriverKycLivenessMode('local_after_aws');
      setDriverKycPendingReason('Liveness aprovado. Capture uma selfie rápida para comparar com sua CNH.');
    } catch (error) {
      Logger.error('❌ [PrototypeKYC] Erro ao validar motorista via AWS:', error);
      handleDriverKycModalCancel();
      Alert.alert('Validação facial', 'Falha ao validar identidade. Tente novamente.');
    } finally {
      setDriverKycProcessing(false);
    }
  }, [
    handleDriverKycModalCancel,
    profile?.uid,
    profileUid,
  ]);

  const runDriverOnlineMutation = useCallback(async (nextValue) => {
    try {
      const result = await setDriverOnline(nextValue);
      if (nextValue && isDriverKycRequiredResult(result)) {
        openDriverKycModal(result);
        return;
      }

      if (result?.blocked) {
        Alert.alert(
          'Ativação pendente',
          'Conclua CNH, CRLV e consentimento antes de ficar online.',
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

        if (nextValue && isDriverKycRequiredResult(result)) {
          openDriverKycModal(result);
          return;
        }

        Alert.alert(
          'Modo motorista',
          resultError
        );
      }
    } catch (error) {
      if (nextValue && isDriverKycRequiredResult(error)) {
        openDriverKycModal(error);
        return;
      }
      Alert.alert('Modo motorista', error?.message || 'Não foi possível atualizar o status online agora.');
    }
  }, [navigation, openDriverKycModal, setDriverOnline]);

  const ensureDriverBackgroundLocationDisclosure = useCallback(async () => {
    appendPrototypeRuntimeDebugStep('driver_background_location_disclosure_check_start', {
      driverOnline,
      driverOnlinePending,
    });

    try {
      const hasAcceptedDisclosure =
        (await withDriverDisclosureStorageTimeout(
          AsyncStorage.getItem(BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY),
          null,
        )) === 'true';
      appendPrototypeRuntimeDebugStep('driver_background_location_disclosure_check_finished', {
        accepted: hasAcceptedDisclosure,
      });
      if (hasAcceptedDisclosure) {
        return true;
      }
    } catch (error) {
      appendPrototypeRuntimeDebugStep('driver_background_location_disclosure_check_failed', {
        message: error?.message || String(error || 'unknown'),
      });
      Logger.warn('⚠️ [DriverLocationDisclosure] Falha ao ler aceite:', error?.message || error);
    }

    setDriverBackgroundDisclosureVisible(true);
    appendPrototypeRuntimeDebugStep('driver_background_location_disclosure_opened', {
      driverOnline,
      driverOnlinePending,
    });
    return false;
  }, [driverOnline, driverOnlinePending]);

  const handleDriverBackgroundDisclosureAccept = useCallback(async () => {
    setDriverBackgroundDisclosureVisible(false);
    appendPrototypeRuntimeDebugStep('driver_background_location_disclosure_accepted', {
      driverOnline,
      driverOnlinePending,
    });

    withDriverDisclosureStorageTimeout(
      AsyncStorage.setItem(BACKGROUND_LOCATION_DISCLOSURE_ACCEPTED_KEY, 'true'),
      false,
    )
      .then(result => {
        appendPrototypeRuntimeDebugStep('driver_background_location_disclosure_persisted', {
          persisted: result !== false,
        });
      })
      .catch(error => {
        appendPrototypeRuntimeDebugStep('driver_background_location_disclosure_persist_failed', {
          message: error?.message || String(error || 'unknown'),
        });
        Logger.warn('⚠️ [DriverLocationDisclosure] Falha ao salvar aceite:', error?.message || error);
      });

    await runDriverOnlineMutation(true);
  }, [driverOnline, driverOnlinePending, runDriverOnlineMutation]);

  const handleDriverBackgroundDisclosureCancel = useCallback(() => {
    appendPrototypeRuntimeDebugStep('driver_background_location_disclosure_cancelled', {
      driverOnline,
      driverOnlinePending,
    });
    setDriverBackgroundDisclosureVisible(false);
  }, [driverOnline, driverOnlinePending]);

  const handleDriverOnlineToggle = useCallback(async () => {
    appendPrototypeRuntimeDebugStep('driver_home_toggle_pressed', {
      driverOnline,
      driverOnlinePending,
      driverCanGoOnline,
      driverActivationResolved
    });

    try {
      appendPrototypeRuntimeDebugStep('driver_home_toggle_gate_state', {
        driverHasAcceptedOrActiveWork,
        bookingStatus: normalizedBookingStatus,
        driverOnline,
        driverOnlinePending,
      });

      if (driverHasAcceptedOrActiveWork) {
        appendPrototypeRuntimeDebugStep('driver_home_toggle_ignored_active_work', {
          bookingStatus: normalizedBookingStatus,
          activeRideBookingId: driverActiveRide?.bookingId || driverActiveRide?.id || '',
          liveOfferBookingId: driverLiveOffer?.bookingId || driverLiveOffer?.id || '',
        });
        return;
      }

      if (driverOnline) {
        Alert.alert(
          'Ficar offline',
          'Deseja parar de receber corridas agora?',
          [
            { text: 'Não', style: 'cancel' },
            { text: 'Sim', onPress: () => runDriverOnlineMutation(false) }
          ]
        );
        return;
      }

      const disclosureAccepted = await ensureDriverBackgroundLocationDisclosure();
      appendPrototypeRuntimeDebugStep('driver_home_toggle_disclosure_result', {
        disclosureAccepted,
      });
      if (!disclosureAccepted) {
        return;
      }

      await runDriverOnlineMutation(true);
    } catch (error) {
      appendPrototypeRuntimeDebugStep('driver_home_toggle_failed', {
        message: error?.message || String(error || 'unknown'),
      });
      Alert.alert(
        'Modo motorista',
        error?.message || 'Não foi possível atualizar o status online agora.',
      );
    }
  }, [
    driverActiveRide?.bookingId,
    driverActiveRide?.id,
    driverActivationResolved,
    driverCanGoOnline,
    driverHasAcceptedOrActiveWork,
    driverLiveOffer?.bookingId,
    driverLiveOffer?.id,
    driverOnline,
    driverOnlinePending,
    ensureDriverBackgroundLocationDisclosure,
    navigation,
    normalizedBookingStatus,
    runDriverOnlineMutation
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
    if (isPassengerRideLifecycleLocked) {
      return;
    }

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
          navigation.navigate(
            'RobotaxiPrototypeReceipt',
            buildHomeReceiptParams({
              receipt: result?.receipt || result?.lastReceipt || null,
            })
          );
        }
      }
    } catch (error) {
      Alert.alert('Não foi possível atualizar', error?.message || 'Tente novamente.');
    }
  }, [
    buildHomeReceiptParams,
    completeTripFlow,
    driverTripAssist,
    markDriverArrived,
    navigation,
    startTripFlow,
  ]);

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
          const receiptParams = buildHomeReceiptParams({
            bookingId: targetReceiptBookingId,
            receipt: recovery?.receipt || recovery?.lastReceipt || null,
          });

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
          const automationBookingId = String(
            activeBookingId || activeBooking?.bookingId || activeBooking?.id || ''
          ).trim();
          await cancelRideSearch({
            ...(automationBookingId
              ? {
                  bookingId: automationBookingId,
                  rideId: automationBookingId,
                  tripId: automationBookingId,
                }
              : {}),
            bookingStatus: bookingStatus || '',
            source: 'passenger-home-qa-cancel-search',
          });
          return;
        }

        if (passengerAutomationConfig.action === 'cleanup_active') {
          const currentStatus = normalizeRuntimeRideStatus(bookingStatus);
          const currentOperationalStatus = normalizeRuntimeRideStatus(
            operationalContinuation?.status
          );

          if (currentStatus === 'completed') {
            dismissCompletedReceipt();
            return;
          }

          if (
            currentStatus === 'operational_interrupted' ||
            currentOperationalStatus === 'operational_interrupted'
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
            const automationBookingId = String(
              activeBookingId || activeBooking?.bookingId || activeBooking?.id || ''
            ).trim();
            await cancelRideSearch({
              ...(automationBookingId
                ? {
                    bookingId: automationBookingId,
                    rideId: automationBookingId,
                    tripId: automationBookingId,
                  }
                : {}),
              bookingStatus: bookingStatus || '',
              source: 'passenger-home-qa-cleanup',
            });
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
    buildHomeReceiptParams,
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
            navigation.navigate(
              'RobotaxiPrototypeReceipt',
              buildHomeReceiptParams({
                bookingId: driverAutomationConfig.bookingId || '',
                receipt: result?.receipt || result?.lastReceipt || null,
              })
            );
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
    buildHomeReceiptParams,
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

    if (!shouldSyncPassengerRoute) {
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

    const passengerRouteBookingId = String(
      activeBookingId ||
        activeBooking?.bookingId ||
        activeBooking?.id ||
        lastRideBookingId ||
        '',
    ).trim();
    const commonParams = {
      ...(passengerRouteBookingId
        ? {
            bookingId: passengerRouteBookingId,
            rideId: passengerRouteBookingId,
            tripId: passengerRouteBookingId,
          }
        : {}),
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
      if (typeof navigation.replace === 'function') {
        navigation.replace(routeName, params);
        return;
      }

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
      const receiptFare = Number(commonParams.selectedFare);
      transitionPassengerRoute('RobotaxiPrototypeReceipt', {
        ...commonParams,
        fromTrip: true,
        ...(Number.isFinite(receiptFare) && receiptFare > 0
          ? { fare: receiptFare, grossAmount: receiptFare }
          : {}),
      });
      return;
    }

    if (passengerAutoRoute === 'RobotaxiPrototypeTrip') {
      transitionPassengerRoute('RobotaxiPrototypeTrip', {
        ...commonParams,
        driverName: driverInfo?.name || 'Motorista'
      });
      return;
    }

    if (
      passengerAutoRoute === 'RobotaxiPrototypeCancellation' ||
      passengerAutoRoute === 'RobotaxiPrototypeNoDrivers'
    ) {
      transitionPassengerRoute(passengerAutoRoute, {
        ...commonParams,
        ...(passengerAutoRoute === 'RobotaxiPrototypeCancellation'
          ? { completed: true, source: 'search' }
          : {}),
      });
      return;
    }

    transitionPassengerRoute('RobotaxiPrototypeDriverSearch', commonParams);
  }, [
    activeBooking?.bookingId,
    activeBooking?.id,
    activeBookingId,
    bookingStatus,
    currentRouteName,
    driverInfo?.name,
    isDriverRole,
    isHomeRoute,
    lastRideBookingId,
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
    if (isDriverRole || !isHomeRoute || normalizedBookingStatus !== 'idle') {
      return;
    }

    if (homeSelectedDestination?.coordinate) {
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
    clearFlowPreview,
    homeSelectedDestination?.coordinate,
    normalizedBookingStatus,
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

  const DriverKycCameraScreen = driverKycModalVisible &&
    !driverKycProviderLoading &&
    !driverKycProcessing &&
    driverKycLivenessMode !== 'aws'
    ? resolveKYCCameraScreen()
    : null;
  const DriverKycAWSNativeLivenessScreen = driverKycModalVisible &&
    !driverKycProviderLoading &&
    !driverKycProcessing &&
    driverKycLivenessMode === 'aws'
    ? resolveAWSNativeLivenessScreen()
    : null;
  const presentedMapRegion =
    presentedSearchingMode && searchTargetRegion
      ? searchTargetRegion
      : targetRegion;
  const presentedUserCoordinate =
    !isDriverRole && showHomeChrome && isHomeRoute
      ? effectiveHomePickupCoordinate || currentCoordinate || DEFAULT_USER_COORDINATE
      : currentCoordinate || DEFAULT_USER_COORDINATE;
  const shouldForceHomePickupRegionUpdate = Boolean(
    !isDriverRole &&
      showHomeChrome &&
      isHomeRoute &&
      !homePickupPickerVisible &&
      isFiniteCoordinate(effectiveHomePickupCoordinate)
  );
  const isLiveTripMapInteractionAllowed = Boolean(
    isScreenFocused &&
      shouldRenderRuntimeMapState &&
      isLiveTripMapActive
  );
  const homeMapInteractionEnabled = Boolean(
    (showHomeChrome || isDestinationRoute || isLiveTripMapInteractionAllowed) &&
      shouldRenderRuntimeMapState &&
      !homeSurfaceInteractionBlocked &&
      homeMapPresentation.interactionEnabled &&
      (!isPassengerRideLifecycleLocked || isLiveTripMapInteractionAllowed)
  );

  return (
    <PrototypeScreenTransition>
      <View style={styles.container}>
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />

        <PrototypeMapLayer
          mapRef={mapRef}
          region={presentedMapRegion}
          userCoordinate={presentedUserCoordinate}
          userHeading={isDriverRole ? null : currentHeading}
          userAvatarUri={profileImage}
          userAvatarLetter={profileInitial}
          driverCoordinate={presentedDriverCoordinate}
          driverHeading={presentedDriverHeading}
          mapCameraHeading={showLeafNativeNavigation ? leafNativeNavigationCameraHeading : 0}
          showTraffic={shouldShowTrafficLayer}
          searchingMode={presentedSearchingMode}
          searchCenterCoordinate={presentedSearchingMode ? searchCenterCoordinate : null}
          searchRadiusKm={presentedSearchingMode ? searchRadiusKm : null}
          searchPreviewRadiusKm={presentedSearchingMode ? searchPreviewRadiusKm : null}
          nearbyVehicles={presentedNearbyVehicles}
          routeCoordinates={presentedRouteCoordinates}
          routeTrafficSegments={presentedRouteTrafficSegments}
          routeSynthetic={passengerHomePreviewRouteActive ? false : activeRoute.synthetic === true}
          routeSource={passengerHomePreviewRouteActive ? 'home-preview' : activeRoute.routeSource}
          originCoordinate={presentedRouteOrigin}
          destinationCoordinate={presentedRouteDestination}
          destinationLabel={presentedRouteDestinationLabel}
          destinationAddress={presentedRouteDestinationAddress}
          originLabel="Partida"
          originAddress={homePickupDisplayAddress || 'Sua localização atual'}
          hideUserMarker={
            mapShouldHideUserMarker && !shouldRenderDriverCurrentLocationCar
          }
          currentLocationMarkerMode={
            shouldRenderDriverCurrentLocationCar ? 'car' : 'dot'
          }
          animateRoute={routeAnimate}
          routeMainColor={routeMainColor}
          routeShadowColor={routeShadowColor}
          routeHighlightColor={routeHighlightColor}
          hideRouteEndpointMarkers={isLiveTripMapActive || passengerHomePreviewRouteActive}
          driverMarkerMode={driverMarkerMode}
          driverMarkerOccludedBottom={isDriverRole ? baselineOccludedBottom : 0}
          driverVehicleColor={presentedDriverVehicleColor}
          driverMarkerAssetUrl={vehicleMarkerCampaignAsset.imageUrl}
          driverMarkerLetter={driverMarkerLetter}
          destinationMarkerMode={destinationMarkerMode}
          destinationMarkerLetter={passengerMarkerLetter}
          viewportPadding={homeRouteViewportPadding}
          routeViewportRegion={homeRouteViewportRegion}
          forceRegionUpdate={Boolean(
            (hasActiveRoute && !driverNavigationCameraOwnsMap) ||
              shouldForceHomePickupRegionUpdate
          )}
          onMapLayout={handleMapLayout}
          onMapLoaded={handleHomeMapLoaded}
          onMapPanDrag={handleMapPanDrag}
          onMapReady={handleHomeMapReady}
          onRegionChangeComplete={handleMapRegionChangeComplete}
          mapChildren={shouldRenderRuntimeMapState ? driverH3MapChildren : null}
          mapSafetyProfile={isDriverRole ? 'driver' : 'default'}
          interactionEnabled={homeMapInteractionEnabled}
          manualCameraHoldMs={homeMapPresentation.manualCameraHoldMs}
        />

        {showHomeChrome &&
        !homeSurfaceInteractionBlocked &&
        !isPassengerRideLifecycleLocked &&
        !homePickupPickerVisible &&
        !hasDriverLiveRideOverlay ? (
          <PrototypeTopControls
            insets={insets}
            leftIcon={isHomeRoute ? 'locate' : 'arrow-back'}
            rightIcon={hasMenuTopAction ? 'menu' : 'locate'}
            showRightBadge={false}
            onPressLeft={handleTopLeftPress}
            onPressRight={handleTopRightPress}
          />
        ) : null}

        {homePickupPickerVisible ? (
          <>
            <View
              pointerEvents="none"
              style={[styles.homePickupMarker, { top: homePickupMarkerTop }]}
              testID="passenger-home-pickup-map-marker"
              accessibilityLabel="Marcador do local de partida"
            >
              <View style={styles.homePickupMarkerPin}>
                <View style={styles.homePickupMarkerCore}>
                  <View style={styles.homePickupMarkerDot} />
                </View>
              </View>
            </View>

            <View pointerEvents="box-none" style={styles.homePickupPickerLayer}>
              <View style={[styles.homePickupFloatingCard, { top: insets.top + 14 }]}>
                <TouchableOpacity
                  activeOpacity={0.84}
                  onPress={handleCancelHomePickupPicker}
                  style={styles.homePickupBackButton}
                  testID="passenger-home-pickup-cancel-button"
                  accessibilityLabel="Cancelar alteração de partida"
                >
                  <Ionicons name="chevron-back" size={20} color="#171412" />
                </TouchableOpacity>
                <View style={styles.homePickupFloatingCopy}>
                  <Text style={styles.homePickupEyebrow}>Partida</Text>
                  <Text style={styles.homePickupFloatingTitle}>
                    {homePickupDisplayLabel}
                  </Text>
                  <Text style={styles.homePickupFloatingAddress} numberOfLines={2}>
                    {effectiveHomePickupAddress}
                  </Text>
                </View>
              </View>

              <View
                onLayout={handleHomePickupPickerCardLayout}
                style={[
                  styles.homePickupBottomCard,
                  { bottom: insets.bottom + HOME_PICKUP_PICKER_BOTTOM_OFFSET }
                ]}
                testID="passenger-home-pickup-picker"
                accessibilityLabel="Selecionar local de partida no mapa"
              >
                <View style={styles.homePickupHandle} />
                <Text style={styles.homePickupPickerTitle}>
                  Mova o mapa para posicionar a partida
                </Text>
                <Text style={styles.homePickupPickerText}>
                  O pin marca onde o motorista deve encontrar você.
                </Text>
                <View style={styles.homePickupPickerActions}>
                  <TouchableOpacity
                    activeOpacity={0.86}
                    onPress={handleUseCurrentHomePickup}
                    style={styles.homePickupSecondaryButton}
                    testID="passenger-home-pickup-use-current-button"
                    accessibilityLabel="Usar minha localização atual"
                  >
                    <Text style={styles.homePickupSecondaryButtonText}>Atual</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.88}
                    onPress={handleConfirmHomePickup}
                    style={styles.homePickupPrimaryButton}
                    testID="passenger-home-pickup-confirm-button"
                    accessibilityLabel="Confirmar local de partida"
                  >
                    <Text style={styles.homePickupPrimaryButtonText}>Confirmar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </>
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
            onOpenNavigation={handleOpenDriverNavigation}
            onHide={handleHideLeafNativeNavigation}
          />
        ) : null}

        {runtimeHomeSurfaceReady &&
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

        {runtimeHomeSurfaceReady &&
        showHomeChrome &&
        isDriverRole &&
        driverActivationResolved &&
        !hasDriverLiveRideOverlay &&
        String(driverTransientCard?.id || '').trim() ? (
          <DriverTransientStateCard
            card={driverTransientCard}
            insetsBottom={insets.bottom}
            bottomOffset={DRIVER_BOTTOM_CTA_OFFSET + driverBottomCtaHeight + 12}
            suppressActivationStatusAlerts={driverHasAcceptedOrActiveWork}
          />
        ) : null}

        {canShowPassengerHomeOverlay ? (
          <PassengerHomeOverlay
            insetsBottom={insets.bottom}
            userId={profile?.uid}
            pickupLabel={homePickupDisplayLabel}
            pickupAddress={homePickupDisplayAddress}
            pickupCoordinate={effectiveHomePickupCoordinate}
            destinationLabel={
              homeSelectedDestination?.name ||
              homeSelectedDestination?.address ||
              destination
            }
            onCardLayout={handleSearchCardLayout}
            onPickupPress={handleOpenHomePickupSearch}
            pickupSearchActive={homePickupSearchActive}
            pickupSearchQuery={homePickupSearchQuery}
            pickupSearchResults={homePickupSearchResults}
            pickupSearchSearching={homePickupSearching}
            onPickupSearchChange={setHomePickupSearchQuery}
            onPickupSearchClose={handleCloseHomePickupSearch}
            onPickupResultPress={handleSelectHomePickupResult}
            onPickupMapPress={handleOpenHomePickupPickerFromSearch}
            onDestinationPress={() => handleOpenPassengerDestination()}
            onMicrophonePress={() =>
              handleOpenPassengerDestination({
                autoStartVoice: true
              })
            }
            destinationSearchActive={homeDestinationSearchActive}
            destinationSearchQuery={homeDestinationQuery}
            destinationSearchResults={homeDestinationResults}
            destinationSearchSearching={homeDestinationSearching}
            onDestinationSearchChange={setHomeDestinationQuery}
            onDestinationSearchClose={handleCloseHomeDestinationSearch}
            onDestinationResultPress={handleSelectHomeDestinationResult}
            categoryVisible={Boolean(
              homeCategorySurfaceVisible
            )}
            categoryOptions={homeCategoryOptions}
            selectedCategoryId={homeSelectedCategoryId}
            onCategorySelect={handleSelectHomeCategory}
            onCategoryConfirm={handleConfirmHomeCategory}
            categoryNotice={homeAvailabilityNotice}
            categoryConfirmDisabled={
              !homeSelectedDestination?.coordinate ||
              passengerHomeRoutePending ||
              selectedHomeDriverUnavailable ||
              !selectedHomeBackendQuoteReady
            }
            categoryConfirmSoftDisabled={
              selectedHomeDriverUnavailable && !homeDriverAvailabilityRefreshing
            }
            categoryConfirmLabel={
              passengerHomeRoutePending
                ? 'Calculando rota...'
                : selectedHomeDriverUnavailable
                  ? 'Sem motorista disponível'
                : homeBackendQuoteError && !selectedHomeBackendQuoteReady
                  ? 'Tarifa indisponível'
                  : 'Confirmar'
            }
            tariffStatusLabel={passengerHomeTrafficStatusLabel}
            tariffHigh={passengerHomeTrafficHigh}
          />
        ) : null}

        {showPassengerHomeSkeleton ? (
          <PassengerHomeOverlaySkeleton
            insetsBottom={insets.bottom}
            onCardLayout={handleSearchCardLayout}
          />
        ) : null}

        {showDriverHomeSkeleton ? (
          <DriverHomeHydrationSkeleton
            insetsBottom={insets.bottom}
            onCtaLayout={handleDriverCtaLayout}
          />
        ) : null}

        {runtimeHomeSurfaceReady &&
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
              bookingStatus={normalizedBookingStatus || bookingStatus}
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
              nativeNavigationVisible={showLeafNativeNavigation}
              onTripCompletedSuccess={(result) =>
                navigation.navigate(
                  'RobotaxiPrototypeReceipt',
                  buildHomeReceiptParams({
                    receipt: result?.receipt || result?.lastReceipt || null,
                  })
                )
              }
            />

            {showDriverHomeOverlay ? (
              <DriverHomeOverlay
                driverId={profile?.uid}
                insetsTop={insets.top}
                insetsBottom={insets.bottom}
                driverOnline={driverOnline}
                driverOnlinePending={driverOnlinePending}
                driverOnlineStartedAt={driverOnlineStartedAt}
                driverOnlineDaily={driverOnlineDaily}
                driverRealtimeAuthenticated={isSocketAuthenticated}
                driverCanGoOnline={driverCanGoOnline}
                driverActivationResolved={driverActivationResolved}
                driverWorkInProgress={driverHasAcceptedOrActiveWork}
                suppressDaySummary={driverHasAcceptedOrActiveWork}
                ridesCount={todayTrips}
                formattedDriverEarnings={formattedDriverEarnings}
                driverGrossAmount={driverTripTotals.totalGross}
                driverFeeAmount={driverTripTotals.totalFees}
                driverFinancialHistory={driverFinancialHistory}
                driverDestinationMode={driverDestinationMode}
                onCtaLayout={handleDriverCtaLayout}
                onToggleOnline={handleDriverOnlineToggle}
                onSaveDestinationMode={handleSaveDriverDestinationMode}
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

        <PermissionExplanationModal
          visible={driverBackgroundDisclosureVisible}
          onClose={handleDriverBackgroundDisclosureCancel}
          onAccept={handleDriverBackgroundDisclosureAccept}
          permissionType="location"
          userType="driver"
          locationType="background"
        />

        <Modal
          visible={driverKycModalVisible}
          animationType="slide"
          onRequestClose={handleDriverKycModalCancel}
        >
          {driverKycProviderLoading || driverKycProcessing ? (
            <View style={styles.driverKycLoadingContainer}>
              <ActivityIndicator size="large" color="#1A330E" />
              <Text style={styles.driverKycLoadingText}>
                {driverKycProcessing
                  ? 'Validando sua identidade...'
                  : 'Preparando validação facial...'}
              </Text>
            </View>
          ) : DriverKycAWSNativeLivenessScreen ? (
            <DriverKycAWSNativeLivenessScreen
              driverId={profile?.uid || profileUid}
              challengeId={driverKycChallengeContext.challengeId}
              requirement={driverKycChallengeContext.requirement}
              onSuccess={handleDriverKycAwsSuccess}
              onCancel={handleDriverKycModalCancel}
              onFallbackLocal={() => setDriverKycLivenessMode('local')}
            />
          ) : DriverKycCameraScreen ? (
            <DriverKycCameraScreen
              onCapture={handleDriverKycCapture}
              onCancel={handleDriverKycModalCancel}
              type="selfie"
            />
          ) : (
            <View style={styles.driverKycLoadingContainer}>
              <ActivityIndicator size="large" color="#1A330E" />
              <Text style={styles.driverKycLoadingText}>Preparando validação facial...</Text>
            </View>
          )}

          {driverKycPendingReason ? (
            <View style={styles.driverKycReasonBanner}>
              <Text style={styles.driverKycReasonText}>
                {driverKycPendingReason}
              </Text>
            </View>
          ) : null}
        </Modal>

        {effectiveHomeSurfaceLoadingVisible ? (
          <View
            style={styles.homeLoadingOverlay}
            testID="prototype-home-loading"
            accessibilityRole="progressbar"
            accessibilityLabel={homeLoadingTitle}
          >
            <View style={styles.homeLoadingContent}>
              <Text style={styles.homeLoadingTitle}>{homeLoadingTitle}</Text>
              <ActivityIndicator
                size="small"
                color="#1A330E"
                style={styles.homeLoadingSpinner}
              />
            </View>
          </View>
        ) : null}
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: color.bg.map
  },
  homePickupMarker: {
    position: 'absolute',
    left: '50%',
    marginLeft: -16,
    zIndex: 34,
    elevation: 34,
    alignItems: 'center',
  },
  homePickupMarkerPin: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 214, 10, 0.34)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.92)',
  },
  homePickupMarkerCore: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  homePickupMarkerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#1FA64A',
  },
  homePickupPickerLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 33,
    elevation: 33,
  },
  homePickupFloatingCard: {
    position: 'absolute',
    left: 23,
    right: 23,
    minHeight: 86,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#ECE5DC',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#111611',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 26,
    elevation: Platform.OS === 'android' ? 0 : 10,
  },
  homePickupBackButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EEF4EA',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  homePickupFloatingCopy: {
    flex: 1,
    minWidth: 0,
  },
  homePickupEyebrow: {
    color: '#827B73',
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  homePickupFloatingTitle: {
    marginTop: 2,
    color: '#111611',
    fontFamily: fonts.SemiBold,
    fontSize: 17,
    lineHeight: 23,
  },
  homePickupFloatingAddress: {
    marginTop: 3,
    color: '#756F68',
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
  },
  homePickupBottomCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderWidth: 1,
    borderColor: '#ECE5DC',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingTop: 14,
    paddingBottom: 18,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -14 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: Platform.OS === 'android' ? 0 : 12,
  },
  homePickupHandle: {
    width: 50,
    height: 4,
    borderRadius: 3,
    backgroundColor: '#D8D0C7',
    alignSelf: 'center',
    marginBottom: 18,
  },
  homePickupPickerTitle: {
    color: '#111611',
    fontFamily: fonts.SemiBold,
    fontSize: 17,
    lineHeight: 23,
  },
  homePickupPickerText: {
    marginTop: 4,
    color: '#756F68',
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
  },
  homePickupPickerActions: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 10,
  },
  homePickupSecondaryButton: {
    minWidth: 112,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#E9E2D8',
    backgroundColor: '#F8F6F1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  homePickupSecondaryButtonText: {
    color: '#111611',
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 18,
  },
  homePickupPrimaryButton: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#1A330E',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  homePickupPrimaryButtonText: {
    color: '#FFFFFF',
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 19,
  },
  homeLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 120,
    elevation: 120,
    backgroundColor: '#F8F6F1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  homeLoadingContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeLoadingTitle: {
    color: '#171412',
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 26,
    textAlign: 'center',
  },
  homeLoadingSpinner: {
    marginTop: 18,
  },
  driverKycLoadingContainer: {
    flex: 1,
    backgroundColor: '#F8F6F1',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  driverKycLoadingText: {
    marginTop: 16,
    color: '#171412',
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
    textAlign: 'center',
  },
  driverKycReasonBanner: {
    position: 'absolute',
    top: 52,
    left: 16,
    right: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(17, 20, 18, 0.78)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  driverKycReasonText: {
    color: '#FFFFFF',
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  driverHomeSkeletonStack: {
    position: 'absolute',
    left: 24,
    right: 24,
    zIndex: 16,
    elevation: Platform.OS === 'android' ? 0 : 12,
  },
  driverHomeSkeletonCard: {
    minHeight: DRIVER_BOTTOM_CTA_FALLBACK_HEIGHT,
    borderRadius: 32,
    paddingHorizontal: 28,
    paddingTop: 21,
    paddingBottom: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#ECE5DC',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.12,
    shadowRadius: 17,
  },
  driverHomeSkeletonTopRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: 122,
  },
  driverHomeSkeletonMainColumn: {
    flex: 1,
    minHeight: 118,
    paddingRight: 13,
  },
  driverHomeSkeletonDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: '#E9E2D8',
    marginLeft: 3,
    marginRight: 13,
  },
  driverHomeSkeletonSideColumn: {
    width: 82,
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 4,
  },
  driverHomeSkeletonLine: {
    borderRadius: 999,
    backgroundColor: 'rgba(117,111,104,0.16)',
  },
  driverHomeSkeletonLabel: {
    width: 86,
    height: 12,
  },
  driverHomeSkeletonAmount: {
    width: 136,
    height: 31,
    marginTop: 10,
  },
  driverHomeSkeletonProgressTrack: {
    width: '100%',
    height: 5,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(117,111,104,0.12)',
    marginTop: 8,
  },
  driverHomeSkeletonProgressFill: {
    width: '34%',
    height: '100%',
    borderRadius: 999,
    backgroundColor: 'rgba(26,51,14,0.28)',
  },
  driverHomeSkeletonCaptionRow: {
    marginTop: 5,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  driverHomeSkeletonCaption: {
    width: 104,
    height: 11,
  },
  driverHomeSkeletonPercent: {
    width: 30,
    height: 11,
  },
  driverHomeSkeletonPill: {
    marginTop: 8,
    width: 176,
    height: 24,
    borderRadius: 999,
    backgroundColor: 'rgba(117,111,104,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(233,226,216,0.8)',
  },
  driverHomeSkeletonSideValue: {
    width: 34,
    height: 20,
  },
  driverHomeSkeletonSideLabel: {
    width: 58,
    height: 11,
    marginBottom: 6,
  },
  driverHomeSkeletonHorizontalDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#E9E2D8',
    marginTop: 6,
    marginBottom: 15,
  },
  driverHomeSkeletonActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  driverHomeSkeletonSlider: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#ECE5DC',
    backgroundColor: 'rgba(248,246,241,0.72)',
    justifyContent: 'center',
  },
  driverHomeSkeletonThumb: {
    position: 'absolute',
    left: 8,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(23,20,18,0.18)',
  },
  driverHomeSkeletonActionLabel: {
    width: 108,
    height: 16,
    alignSelf: 'center',
  },
  driverHomeSkeletonGear: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#ECE5DC',
    backgroundColor: 'rgba(248,246,241,0.72)',
  },
  driverHomeSkeletonPromoCard: {
    height: 188,
    marginTop: 12,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#ECE5DC',
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 28,
    paddingTop: 28,
  },
  driverHomeSkeletonPromoTitle: {
    width: '54%',
    height: 24,
  },
  driverHomeSkeletonPromoBody: {
    width: '72%',
    height: 13,
    marginTop: 18,
  },
  driverHomeSkeletonPromoBodyShort: {
    width: '44%',
    height: 13,
    marginTop: 9,
  },
  driverSurgeFlag: {
    minWidth: 52,
    minHeight: 28,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(23,20,18,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 6,
    overflow: 'visible',
    flexShrink: 0,
  },
  driverSurgeFlagText: {
    color: '#FFFFFF',
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 14,
    textAlign: 'center',
    includeFontPadding: false,
    flexShrink: 0,
  }
});
