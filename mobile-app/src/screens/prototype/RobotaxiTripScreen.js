import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { fonts } from '../../theme/runtimeTokens';
import PrototypeScreenTransition from '../../components/prototype/PrototypeScreenTransition';
import PrototypeDismissibleSheet from '../../components/prototype/PrototypeDismissibleSheet';
import PrototypeMapLayer from '../../components/prototype/PrototypeMapLayer';
import PrototypeConnectionStatusPill from '../../components/prototype/PrototypeConnectionStatusPill';
import WooviPaymentModal from '../../components/payment/WooviPaymentModal';
import SecurePaymentBadge from '../../components/payment/SecurePaymentBadge';
import robotaxiPrototypeTokens from '../../components/design-system/robotaxiPrototypeTokens';
import {
  LeafAnimatedPressable,
  LeafDivider,
  LeafProgressBar,
  LeafRouteProgress,
  leafButtonMetrics,
  leafRideColors,
} from '../../components/prototype/LeafRideUI';
import {
  RobotaxiLifecycleButton,
  RobotaxiLifecycleCard,
  RobotaxiLifecycleDisclosure,
  RobotaxiLifecycleIdentity,
  RobotaxiLifecycleMetric,
  RobotaxiLifecycleSection,
  RobotaxiLifecycleSummary,
  robotaxiLifecycleMetrics,
} from '../../components/prototype/RobotaxiLifecycleUI';
import { usePrototypeMapOcclusion } from './prototypeMapOcclusion';
import { usePrototypeRideRuntime } from './prototypeRideRuntime';
import { useLiveRouteTiming } from './liveRouteTiming';
import { formatCurrencyBRL } from './tripFinancialSummary';
import { PROTOTYPE_ORIGIN_COORDINATE, PROTOTYPE_REGION } from './robotaxiPrototypeData';
import { normalizePassengerBookingStatus } from './passengerFlowRouting';
import { resolvePrototypeMapPresentation } from './prototypeMapPresentation';
import {
  buildRouteViewportRegion,
  buildVisibleRouteEdgePadding,
  validateRoadRouteGeometry,
} from './prototypeRouteViewport';
import {
  RIDE_CARD_ROLES,
  RIDE_CARD_STATES,
  createRideCardFieldTestIDs,
  defineRideCardRenderedFields,
} from './rideCardContract';
import useCampaignAssetOverride from '../../hooks/useCampaignAssetOverride';
import {
  getPrototypeMapRoute,
  subscribePrototypeMapRoute,
} from './prototypeMapRoute';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = robotaxiLifecycleMetrics.cardBottomGap;
const FALLBACK_CARD_HEIGHT = 292;
const TRIP_SHEET_MIN_HEIGHT = 332;
const TRIP_SHEET_MAX_HEIGHT_RATIO = 0.66;
const TRIP_SHEET_SCROLL_VERTICAL_CHROME = 32;
const TRIP_MAP_TOP_PADDING = 72;
const TRIP_MAP_SIDE_PADDING = 24;
const TRIP_MAP_BOTTOM_GUTTER = 16;
const TRIP_MAP_MIN_VISIBLE_HEIGHT = 220;
const PASSENGER_TRIP_ROUTE_FIT_SHORT_MAX_DISTANCE_KM = 10;
const PASSENGER_TRIP_ROUTE_FIT_LONG_LATITUDE_MULTIPLIER = 1.08;
const PASSENGER_TRIP_ROUTE_FIT_LONG_LONGITUDE_MULTIPLIER = 1.18;
const PROTECTED_PASSENGER_TRIP_STATUSES = new Set([
  'accepted',
  'arrived',
  'started',
  'operational_interrupted',
  'searching_replacement',
]);

const PASSENGER_ACCEPTED_RENDERED_CARD_FIELD_IDS = Object.freeze([
  'driver_name',
  'driver_photo',
  'driver_rating',
  'vehicle_model',
  'vehicle_color',
  'vehicle_plate',
  'pickup_eta',
  'pickup_distance',
  'pickup_address',
  'destination_address',
  'fare',
  'vehicle_type',
  'contact_actions',
  'share_trip_action',
  'safety_action',
  'cancel_action',
]);

const PASSENGER_ARRIVED_RENDERED_CARD_FIELD_IDS = Object.freeze([
  'driver_name',
  'driver_photo',
  'vehicle_model',
  'vehicle_color',
  'vehicle_plate',
  'boarding_timer',
  'boarding_timer_message',
  'pickup_address',
  'contact_actions',
  'safety_action',
  'cancel_action',
]);

const PASSENGER_STARTED_RENDERED_CARD_FIELD_IDS = Object.freeze([
  'destination_address',
  'eta_final',
  'distance_remaining',
  'route_progress',
  'driver_name',
  'driver_photo',
  'vehicle_model',
  'vehicle_color',
  'vehicle_plate',
  'fare',
  'vehicle_type',
  'share_trip_action',
  'safety_action',
  'support_action',
  'change_destination_action',
  'end_early_action',
]);

const PASSENGER_ACCEPTED_FIELD_TEST_ID_OVERRIDES = Object.freeze({
  cancel_action: 'passenger-trip-cancel-button',
  safety_action: 'passenger-trip-support-button',
  share_trip_action: 'passenger-trip-share-button',
});

const PASSENGER_ARRIVED_FIELD_TEST_ID_OVERRIDES = Object.freeze({
  cancel_action: 'passenger-trip-cancel-button',
  safety_action: 'passenger-trip-support-button',
});

const PASSENGER_STARTED_FIELD_TEST_ID_OVERRIDES = Object.freeze({
  safety_action: 'passenger-trip-support-button',
  share_trip_action: 'passenger-trip-share-button',
  support_action: 'passenger-trip-support-button',
  change_destination_action: 'passenger-trip-change-destination-button',
  end_early_action: 'passenger-trip-end-early-button',
});

const PASSENGER_TRIP_FIELD_TEST_IDS = Object.freeze({
  accepted: createRideCardFieldTestIDs(
    RIDE_CARD_ROLES.PASSENGER,
    RIDE_CARD_STATES.PASSENGER_DRIVER_ACCEPTED,
    PASSENGER_ACCEPTED_RENDERED_CARD_FIELD_IDS,
    PASSENGER_ACCEPTED_FIELD_TEST_ID_OVERRIDES,
  ),
  arrived: createRideCardFieldTestIDs(
    RIDE_CARD_ROLES.PASSENGER,
    RIDE_CARD_STATES.PASSENGER_DRIVER_ARRIVED,
    PASSENGER_ARRIVED_RENDERED_CARD_FIELD_IDS,
    PASSENGER_ARRIVED_FIELD_TEST_ID_OVERRIDES,
  ),
  started: createRideCardFieldTestIDs(
    RIDE_CARD_ROLES.PASSENGER,
    RIDE_CARD_STATES.PASSENGER_IN_TRIP,
    PASSENGER_STARTED_RENDERED_CARD_FIELD_IDS,
    PASSENGER_STARTED_FIELD_TEST_ID_OVERRIDES,
  ),
});

export const PASSENGER_TRIP_RENDERED_CARD_FIELDS = Object.freeze({
  accepted: defineRideCardRenderedFields(
    RIDE_CARD_ROLES.PASSENGER,
    RIDE_CARD_STATES.PASSENGER_DRIVER_ACCEPTED,
    PASSENGER_ACCEPTED_RENDERED_CARD_FIELD_IDS,
    { testIDs: PASSENGER_ACCEPTED_FIELD_TEST_ID_OVERRIDES },
  ),
  arrived: defineRideCardRenderedFields(
    RIDE_CARD_ROLES.PASSENGER,
    RIDE_CARD_STATES.PASSENGER_DRIVER_ARRIVED,
    PASSENGER_ARRIVED_RENDERED_CARD_FIELD_IDS,
    { testIDs: PASSENGER_ARRIVED_FIELD_TEST_ID_OVERRIDES },
  ),
  started: defineRideCardRenderedFields(
    RIDE_CARD_ROLES.PASSENGER,
    RIDE_CARD_STATES.PASSENGER_IN_TRIP,
    PASSENGER_STARTED_RENDERED_CARD_FIELD_IDS,
    { testIDs: PASSENGER_STARTED_FIELD_TEST_ID_OVERRIDES },
  ),
});

function formatCurrency(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return '--';
  }
  return formatCurrencyBRL(amount);
}

function formatDistanceLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return '--';
  }

  if (numeric < 1) {
    const meters = numeric <= 0
      ? 0
      : Math.max(10, Math.round((numeric * 1000) / 10) * 10);
    return `${meters} m`;
  }

  return `${Math.max(1, Math.round(numeric))} km`;
}

function formatStatusLabel(status) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'accepted') {
    return 'A CAMINHO';
  }
  if (normalized === 'arrived') {
    return 'EMBARQUE';
  }
  if (normalized === 'started') {
    return 'EM VIAGEM';
  }
  if (normalized === 'operational_interrupted') {
    return 'INTERROMPIDA';
  }
  if (normalized === 'searching_replacement') {
    return 'CONTINUIDADE';
  }
  return 'VIAGEM';
}

function formatBoardingTimer(seconds) {
  const normalizedSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(normalizedSeconds / 60)}:${String(normalizedSeconds % 60).padStart(2, '0')}`;
}

function buildTripSheetMaxHeight({ mapHeight, windowHeight, bottomOffset = 0 }) {
  const effectiveMapHeight = Math.max(
    1,
    Number(mapHeight) || Number(windowHeight) || 1,
  );
  const availableMapHeight = Math.max(
    1,
    effectiveMapHeight - Math.max(0, Number(bottomOffset) || 0),
  );
  const visibleRouteLimit = Math.max(
    TRIP_SHEET_MIN_HEIGHT,
    availableMapHeight - TRIP_MAP_MIN_VISIBLE_HEIGHT,
  );
  const ratioLimit = Math.max(
    TRIP_SHEET_MIN_HEIGHT,
    Math.round(availableMapHeight * TRIP_SHEET_MAX_HEIGHT_RATIO),
  );

  return Math.max(
    TRIP_SHEET_MIN_HEIGHT,
    Math.min(visibleRouteLimit, ratioLimit),
  );
}

function formatDriverLocationAge(ageSeconds) {
  const normalizedSeconds = Math.max(0, Math.round(Number(ageSeconds) || 0));
  if (normalizedSeconds < 60) {
    return 'há menos de 1 min';
  }

  const minutes = Math.max(1, Math.round(normalizedSeconds / 60));
  return minutes === 1 ? 'há 1 min' : `há ${minutes} min`;
}

function getFirstName(value, fallback = 'Motorista') {
  const firstName = String(value || '').trim().split(/\s+/).filter(Boolean)[0];
  return firstName || fallback;
}

function pickFirstNonEmptyString(...values) {
  return values
    .map(value => String(value || '').trim())
    .find(Boolean) || '';
}

function resolveVehicleColorLabel(...values) {
  const colorLabel = pickFirstNonEmptyString(...values);
  return colorLabel || 'Cor não informada';
}

function normalizeMapCoordinate(value) {
  if (typeof value === 'string') {
    try {
      return normalizeMapCoordinate(JSON.parse(value));
    } catch (_error) {
      return null;
    }
  }

  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

function toPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function toNonNegativeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
}

function normalizeRouteCoordinateList(value) {
  if (typeof value === 'string') {
    try {
      return normalizeRouteCoordinateList(JSON.parse(value));
    } catch (_error) {
      return [];
    }
  }

  return Array.isArray(value)
    ? value.map(normalizeMapCoordinate).filter(Boolean)
    : [];
}

function areMapCoordinatesClose(left, right, tolerance = 0.00002) {
  const normalizedLeft = normalizeMapCoordinate(left);
  const normalizedRight = normalizeMapCoordinate(right);
  return Boolean(
    normalizedLeft &&
      normalizedRight &&
      Math.abs(normalizedLeft.latitude - normalizedRight.latitude) <= tolerance &&
      Math.abs(normalizedLeft.longitude - normalizedRight.longitude) <= tolerance,
  );
}

function resolvePassengerRoadRouteCoordinates(value, origin, destination) {
  const coordinates = normalizeRouteCoordinateList(value);
  const validation = validateRoadRouteGeometry({
    coordinates,
    origin: normalizeMapCoordinate(origin) || coordinates[0],
    destination:
      normalizeMapCoordinate(destination) || coordinates[coordinates.length - 1],
  });
  return validation.valid ? validation.coordinates : [];
}

function normalizeRouteTrafficSegments(value) {
  if (typeof value === 'string') {
    try {
      return normalizeRouteTrafficSegments(JSON.parse(value));
    } catch (_error) {
      return [];
    }
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(segment => {
      const coordinates = normalizeRouteCoordinateList(segment?.coordinates);
      if (coordinates.length < 2) {
        return null;
      }

      return {
        coordinates,
        level: String(segment?.level || segment?.trafficLevel || 'normal').trim() || 'normal',
        color: String(segment?.color || '').trim() || undefined,
      };
    })
    .filter(Boolean);
}

function pickPassengerPaidAmountFromSource(source = {}, { includeFareFallback = false } = {}) {
  if (!source || typeof source !== 'object') {
    return null;
  }

  const nestedPayment =
    source.payment ||
    source.paymentState ||
    source.paymentData ||
    source.paymentBreakdown ||
    {};
  const candidates = [
    source.passengerPaidAmount,
    source.totalPaid,
    source.totalAmount,
    source.totalFare,
    source.paymentAmount,
    source.chargedAmount,
    source.amountPaid,
    source.customerPaid,
    source.customer_paid,
    source.grossAmount,
    source.grossFare,
    nestedPayment.passengerPaidAmount,
    nestedPayment.totalPaid,
    nestedPayment.totalAmount,
    nestedPayment.totalFare,
    nestedPayment.paymentAmount,
    nestedPayment.chargedAmount,
    nestedPayment.amountPaid,
    nestedPayment.customerPaid,
    nestedPayment.amount,
    ...(includeFareFallback
      ? [
          source.selectedFare,
          source.estimatedFare,
          source.fare,
          source.finalFare,
          source.amount,
        ]
      : []),
  ];

  for (const candidate of candidates) {
    const amount = toPositiveNumber(candidate);
    if (amount !== null) {
      return amount;
    }
  }

  const cents = [
    source.paymentAmountCents,
    source.amountPaidCents,
    source.totalAmountCents,
    nestedPayment.paymentAmountCents,
    nestedPayment.amountPaidCents,
    nestedPayment.totalAmountCents,
  ]
    .map(value => Number(value))
    .find(value => Number.isFinite(value) && value > 0);

  return Number.isFinite(cents) ? Number((cents / 100).toFixed(2)) : null;
}

function resolvePassengerTripPaidAmount({
  routeParams,
  activeBooking,
  paymentState,
  selectedFare,
} = {}) {
  return (
    pickPassengerPaidAmountFromSource(routeParams) ??
    pickPassengerPaidAmountFromSource(paymentState) ??
    pickPassengerPaidAmountFromSource(activeBooking) ??
    pickPassengerPaidAmountFromSource(routeParams, { includeFareFallback: true }) ??
    toPositiveNumber(selectedFare) ??
    pickPassengerPaidAmountFromSource(activeBooking, { includeFareFallback: true }) ??
    null
  );
}

function hasPassengerActiveRideIdentity({
  activeBookingId,
  activeBooking,
  driverActiveRide,
  driverInfo,
  routeParams,
} = {}) {
  return Boolean(
    String(
      activeBookingId ||
        activeBooking?.bookingId ||
        activeBooking?.id ||
        activeBooking?.rideId ||
        driverActiveRide?.bookingId ||
        driverActiveRide?.id ||
        routeParams?.bookingId ||
        routeParams?.rideId ||
        routeParams?.tripId ||
        "",
    ).trim() &&
      String(
        driverInfo?.id ||
          driverInfo?.driverId ||
          driverInfo?.driver?.id ||
          activeBooking?.driverId ||
          activeBooking?.driver?.id ||
          driverActiveRide?.driverId ||
          driverActiveRide?.driver?.id ||
          routeParams?.driverId ||
          "",
      ).trim(),
  );
}

function buildFallbackTripRegion(points = []) {
  const normalizedPoints = points
    .map(normalizeMapCoordinate)
    .filter(Boolean);

  if (normalizedPoints.length === 0) {
    return PROTOTYPE_REGION;
  }

  const latitudes = normalizedPoints.map(point => point.latitude);
  const longitudes = normalizedPoints.map(point => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudeDelta = Math.max(0.018, (maxLatitude - minLatitude) * 1.7);
  const longitudeDelta = Math.max(0.018, (maxLongitude - minLongitude) * 1.7);

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta,
    longitudeDelta,
  };
}

function buildExtensionPaymentData(rideExtension, bookingId) {
  if (!rideExtension?.chargeId || !bookingId) {
    return null;
  }

  const qrCodeText =
    rideExtension?.brCode ||
    rideExtension?.pixQRCode ||
    rideExtension?.paymentLink ||
    '';

  return {
    chargeId: rideExtension.chargeId,
    rideId: bookingId,
    qrCodeImage: null,
    qrCodeText,
    paymentLink: rideExtension?.paymentLink || null,
    amount: Number(rideExtension?.diffFare || 0),
    amountInCents: Math.round(Number(rideExtension?.diffFare || 0) * 100),
    expiresAt: rideExtension?.expiresAt || null
  };
}

function IconActionButton({ icon, label, onPress, tone = 'ghost', testID, style, disabled = false }) {
  const isWarning = tone === 'warning';
  const isDanger = tone === 'danger';
  return (
    <LeafAnimatedPressable
      activeScale={0.978}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.iconActionButton,
        isWarning && styles.iconActionButtonWarning,
        isDanger && styles.iconActionButtonDanger,
        disabled && styles.iconActionButtonDisabled,
        style,
        styles.iconOnlyActionButton
      ]}
    >
      <Ionicons
        name={icon}
        size={leafButtonMetrics.iconSize}
        color={
          isDanger
            ? leafRideColors.dangerText
            : isWarning
              ? leafRideColors.warningText
              : disabled
                ? leafRideColors.muted
                : leafRideColors.leaf
        }
      />
    </LeafAnimatedPressable>
  );
}

export default function RobotaxiTripScreen({ navigation, route }) {
  const {
    bookingStatus,
    activeBooking,
    selectedDestination,
    selectedVehicle,
    selectedFare,
    tripDistanceKm,
    tripDurationMin,
    tripArrivalText,
    boardingRemainingSec,
    driverInfo,
    driverActiveRide,
    rideExtension,
    operationalContinuation,
    paymentMethod,
    paymentState,
    activeBookingId,
    currentCoordinate,
    currentHeading,
    currentAddress,
    driverCoordinate,
    driverLocationHeartbeat,
    driverTripMeta,
    rideLocalSync,
    profileUid,
    riderProfile,
    endTripEarlyFlow,
    respondOperationalContinuationFlow
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const mapRef = useRef(null);
  const [mapWidth, setMapWidth] = useState(windowWidth);
  const [mapHeight, setMapHeight] = useState(windowHeight);
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [isBusy, setIsBusy] = useState(false);
  const [isExtensionPaymentVisible, setIsExtensionPaymentVisible] = useState(false);
  const [isTripExpanded, setIsTripExpanded] = useState(false);
  const [publishedMapRoute, setPublishedMapRoute] = useState(() => getPrototypeMapRoute());
  const qaAutoConfirmPix = true;
  const safeBottom = Math.max(0, Number(insets.bottom) || 0);
  const sheetBottom = Math.max(SHEET_BOTTOM_OFFSET, safeBottom + 12);
  const tripSheetMaxHeight = useMemo(
    () => buildTripSheetMaxHeight({
      mapHeight: mapHeight || windowHeight,
      windowHeight,
      bottomOffset: sheetBottom,
    }),
    [mapHeight, sheetBottom, windowHeight],
  );
  const tripSheetScrollMaxHeight = Math.max(
    1,
    tripSheetMaxHeight - TRIP_SHEET_SCROLL_VERTICAL_CHROME - safeBottom,
  );
  const effectiveCardHeight = Math.min(cardHeight, tripSheetMaxHeight);
  const mapOccludedBottom = sheetBottom + effectiveCardHeight;
  const protectedMapOccludedBottom = mapOccludedBottom;
  const tripMapActiveOcclusion = useMemo(
    () => ({
      top: 0,
      bottom: protectedMapOccludedBottom,
    }),
    [protectedMapOccludedBottom],
  );
  const tripMapViewportPadding = useMemo(
    () => buildVisibleRouteEdgePadding({
      mapHeight: mapHeight || windowHeight,
      activeOcclusion: tripMapActiveOcclusion,
      insets,
      sidePadding: TRIP_MAP_SIDE_PADDING,
      topExtraPadding: 34,
      bottomExtraPadding: TRIP_MAP_BOTTOM_GUTTER,
      minVisibleHeight: TRIP_MAP_MIN_VISIBLE_HEIGHT,
      overlayBiasRatio: 0.24,
      topPaddingMin: insets.top + TRIP_MAP_TOP_PADDING,
    }),
    [
      insets,
      insets.top,
      mapHeight,
      tripMapActiveOcclusion,
      windowHeight,
    ],
  );
  useEffect(
    () => subscribePrototypeMapRoute(setPublishedMapRoute),
    [],
  );
  const rideLocalSyncIndicator = useMemo(() => {
    const syncStatus = String(rideLocalSync?.status || '').toLowerCase();
    const isProtectedStatus = PROTECTED_PASSENGER_TRIP_STATUSES.has(
      normalizePassengerBookingStatus(bookingStatus),
    );
    if (
      !isProtectedStatus ||
      !['offline', 'pending', 'syncing', 'error'].includes(syncStatus)
    ) {
      return null;
    }

    if (syncStatus === 'offline') {
      return {
        tone: 'danger',
        icon: 'cloud-offline-outline',
        title: 'Sem conexão',
        message:
          rideLocalSync?.message ||
          'Mantendo o último estado confirmado da corrida.',
      };
    }

    if (syncStatus === 'syncing') {
      return {
        tone: 'warning',
        icon: 'sync-outline',
        title: 'Sincronizando corrida',
        message:
          rideLocalSync?.message ||
          'Validando o estado da corrida com o servidor.',
      };
    }

    return {
      tone: syncStatus === 'error' ? 'danger' : 'warning',
      icon: 'sync-outline',
      title: 'Atualização pendente',
      message:
        rideLocalSync?.message ||
        'Aguardando confirmação do servidor para mudar o estado da corrida.',
    };
  }, [bookingStatus, rideLocalSync]);
  const driverSignalIndicator = useMemo(() => {
    const normalizedTripStatus = normalizePassengerBookingStatus(bookingStatus);
    if (
      !PROTECTED_PASSENGER_TRIP_STATUSES.has(normalizedTripStatus) ||
      driverLocationHeartbeat?.stale !== true
    ) {
      return null;
    }

    const ageSeconds = Number(driverLocationHeartbeat?.ageSeconds);
    const ageLabel = formatDriverLocationAge(ageSeconds);
    return {
      tone: ageSeconds >= 60 ? 'danger' : 'warning',
      icon: 'radio-outline',
      title: 'Sinal do motorista instável',
      message: `Última localização ${ageLabel}. Mantendo o último ponto confirmado.`,
    };
  }, [
    bookingStatus,
    driverLocationHeartbeat?.ageSeconds,
    driverLocationHeartbeat?.stale,
  ]);

  const destination = route?.params?.destination || selectedDestination?.name || 'Destino';
  const destinationAddress = route?.params?.destinationAddress || selectedDestination?.address || destination;
  const vehicle = route?.params?.vehicle || selectedVehicle || 'Leaf Plus';
  const operationalStatus = String(operationalContinuation?.status || 'idle').trim().toLowerCase();
  const isOperationalDecisionPending = operationalStatus === 'passenger_decision_pending';
  const isOperationalSearching = operationalStatus === 'searching_replacement_driver';
  const operationalDriverInfo = isOperationalDecisionPending ? driverInfo : null;
  const fallbackDriverName = pickFirstNonEmptyString(
    route?.params?.driverName,
    activeBooking?.driverName,
    activeBooking?.driver?.name,
    driverActiveRide?.driverName,
    driverActiveRide?.driver?.name,
  );
  const fallbackVehicleModel = pickFirstNonEmptyString(
    route?.params?.vehicleModel,
    route?.params?.vehicleLabel,
    activeBooking?.vehicleModel,
    activeBooking?.vehicleLabel,
    activeBooking?.driverVehicle,
    activeBooking?.driver?.vehicle?.model,
    activeBooking?.vehicle?.model,
    driverActiveRide?.vehicleModel,
    driverActiveRide?.vehicleLabel,
    driverActiveRide?.driverVehicle,
    driverActiveRide?.driver?.vehicle?.model,
    driverActiveRide?.vehicle?.model,
    vehicle,
  );
  const fallbackVehiclePlate = pickFirstNonEmptyString(
    route?.params?.vehiclePlate,
    route?.params?.plate,
    activeBooking?.vehiclePlate,
    activeBooking?.plate,
    activeBooking?.driverVehiclePlate,
    activeBooking?.driver?.vehicle?.plate,
    activeBooking?.vehicle?.plate,
    driverActiveRide?.vehiclePlate,
    driverActiveRide?.plate,
    driverActiveRide?.driverVehiclePlate,
    driverActiveRide?.driver?.vehicle?.plate,
    driverActiveRide?.vehicle?.plate,
  );
  const resolvedTripDistanceKm =
    toPositiveNumber(route?.params?.tripDistanceKm) ??
    toPositiveNumber(tripDistanceKm);
  const resolvedTripDurationMin =
    toPositiveNumber(route?.params?.tripDurationMin) ??
    toPositiveNumber(tripDurationMin);
  const resolvedTripArrivalText =
    route?.params?.tripArrivalText ||
    tripArrivalText ||
    (Number.isFinite(resolvedTripDurationMin) && resolvedTripDurationMin > 0
      ? `Chegada estimada em ${resolvedTripDurationMin} min`
      : '');
  const resolvedFare = resolvePassengerTripPaidAmount({
    routeParams: route?.params,
    activeBooking,
    paymentState,
    selectedFare,
  });
  const driverName = pickFirstNonEmptyString(
    operationalDriverInfo?.name,
    operationalDriverInfo?.driverName,
    operationalDriverInfo?.driver?.name,
    route?.params?.driverName,
    driverInfo?.name,
    driverInfo?.driverName,
    driverInfo?.driver?.name,
    fallbackDriverName,
    'Motorista Leaf',
  ) || 'Motorista Leaf';
  const vehicleModel = pickFirstNonEmptyString(
    operationalDriverInfo?.model,
    operationalDriverInfo?.vehicleModel,
    operationalDriverInfo?.driverVehicle,
    operationalDriverInfo?.vehicle?.model,
    operationalDriverInfo?.driver?.vehicle?.model,
    route?.params?.vehicleModel,
    route?.params?.vehicleLabel,
    driverInfo?.model,
    driverInfo?.vehicleModel,
    driverInfo?.driverVehicle,
    driverInfo?.vehicle?.model,
    driverInfo?.driver?.vehicle?.model,
    fallbackVehicleModel,
    vehicle,
  ) ||
    'Leaf Plus';
  const vehiclePlate = pickFirstNonEmptyString(
    operationalDriverInfo?.plate,
    operationalDriverInfo?.vehiclePlate,
    operationalDriverInfo?.driverVehiclePlate,
    operationalDriverInfo?.vehicle?.plate,
    operationalDriverInfo?.driver?.vehicle?.plate,
    route?.params?.vehiclePlate,
    route?.params?.plate,
    driverInfo?.plate,
    driverInfo?.vehiclePlate,
    driverInfo?.driverVehiclePlate,
    driverInfo?.vehicle?.plate,
    driverInfo?.driver?.vehicle?.plate,
    fallbackVehiclePlate,
  );
  const vehicleColorLabel = resolveVehicleColorLabel(
    route?.params?.vehicleColor,
    route?.params?.carColor,
    route?.params?.color,
    driverInfo?.color,
    driverInfo?.vehicleColor,
    driverInfo?.carColor,
    driverInfo?.vehicle?.color,
    driverInfo?.driver?.vehicle?.color,
    activeBooking?.vehicleColor,
    activeBooking?.carColor,
    activeBooking?.color,
    activeBooking?.vehicle?.color,
    activeBooking?.driver?.vehicle?.color,
    driverActiveRide?.vehicleColor,
    driverActiveRide?.carColor,
    driverActiveRide?.color,
    driverActiveRide?.vehicle?.color,
    driverActiveRide?.driver?.vehicle?.color,
  );
  const vehicleMarkerCampaignAsset = useCampaignAssetOverride({
    surface: 'ride_map',
    placement: 'vehicle_marker',
    role: 'customer',
    userId: profileUid || '',
    context: {
      city: 'rio_de_janeiro',
    },
    eventMetadata: {
      screen: 'robotaxi_trip',
      status: bookingStatus || route?.params?.qaStatus || '',
    },
  });
  const driverPhotoUri =
    String(
      driverInfo?.photo ||
        driverInfo?.photoURL ||
        driverInfo?.profileImage ||
        driverInfo?.avatar ||
        activeBooking?.driverPhoto ||
        activeBooking?.driver?.photo ||
        driverActiveRide?.driverPhoto ||
        route?.params?.driverPhoto ||
        '',
    ).trim() || null;
  const resolvedPickupDistanceKm =
    toNonNegativeNumber(route?.params?.driverDistanceToPickupKm) ??
    toNonNegativeNumber(route?.params?.pickupDistanceKm) ??
    toNonNegativeNumber(activeBooking?.driverDistanceToPickupKm) ??
    toNonNegativeNumber(activeBooking?.pickupDistanceKm) ??
    toNonNegativeNumber(activeBooking?.driverToPickupDistanceKm) ??
    toNonNegativeNumber(driverActiveRide?.driverDistanceToPickupKm) ??
    toNonNegativeNumber(driverActiveRide?.pickupDistanceKm) ??
    toNonNegativeNumber(driverActiveRide?.driverToPickupDistanceKm) ??
    toPositiveNumber(driverTripMeta?.pickupDistanceKm) ??
    null;
  const resolvedPickupEtaMin =
    toPositiveNumber(route?.params?.estimatedArrivalToPickupMin) ??
    toPositiveNumber(route?.params?.pickupEtaMinutes) ??
    toPositiveNumber(activeBooking?.estimatedArrivalToPickupMin) ??
    toPositiveNumber(activeBooking?.pickupEtaMinutes) ??
    toPositiveNumber(activeBooking?.driverToPickupEtaMinutes) ??
    toPositiveNumber(driverActiveRide?.estimatedArrivalToPickupMin) ??
    toPositiveNumber(driverActiveRide?.pickupEtaMinutes) ??
    toPositiveNumber(driverActiveRide?.driverToPickupEtaMinutes) ??
    toPositiveNumber(driverTripMeta?.pickupEtaMinutes) ??
    toPositiveNumber(driverTripMeta?.initialEtaMinutes) ??
    null;
  const tripDistanceLabel = formatDistanceLabel(resolvedTripDistanceKm);
  const pickupDistanceLabel = formatDistanceLabel(resolvedPickupDistanceKm);
  const fareLabel = Number.isFinite(resolvedFare) ? formatCurrency(resolvedFare) : '--';
  const routeQaStatus = String(route?.params?.qaStatus || '').trim();
  const normalizedStatus = normalizePassengerBookingStatus(
    routeQaStatus ||
      bookingStatus ||
      driverActiveRide?.status ||
      activeBooking?.status ||
      route?.params?.status ||
      ''
  );
  const isProtectedStatusWithoutRideIdentity = Boolean(
    PROTECTED_PASSENGER_TRIP_STATUSES.has(normalizedStatus) &&
      !hasPassengerActiveRideIdentity({
        activeBookingId,
        activeBooking,
        driverActiveRide,
        driverInfo,
        routeParams: route?.params,
      }),
  );
  const passengerTripSheetExpansionLocked = [
    'searching_replacement',
  ].includes(normalizedStatus);
  const isAccepted = normalizedStatus === 'accepted' || normalizedStatus === 'arrived';
  const isArrived = normalizedStatus === 'arrived';
  const isStarted = normalizedStatus === 'started';
  const pickupEtaValue =
    Number.isFinite(resolvedPickupEtaMin) && resolvedPickupEtaMin > 0
      ? `${Math.max(1, Math.round(resolvedPickupEtaMin))} min`
      : null;
  const pickupLegDistanceLabel =
    pickupDistanceLabel && pickupDistanceLabel !== '--'
      ? pickupDistanceLabel
      : pickupEtaValue || '--';
  const distanceLabel = isAccepted && !isStarted
    ? pickupLegDistanceLabel
    : tripDistanceLabel;
  const extensionStatus = String(rideExtension?.status || 'idle').trim().toLowerCase();
  const rawBoardingSeconds = Number(boardingRemainingSec);
  const boardingTimerSeconds = Number.isFinite(rawBoardingSeconds)
    ? Math.max(0, Math.round(rawBoardingSeconds))
    : isArrived
      ? 120
      : null;
  const boardingCountdownLabel =
    boardingTimerSeconds === null ? null : formatBoardingTimer(boardingTimerSeconds);
  const boardingTimerMessage =
    boardingTimerSeconds === null || boardingTimerSeconds > 30
      ? 'Prossiga para o embarque'
      : boardingTimerSeconds > 0
        ? 'Embarque urgente'
        : 'Uma taxa poderá ser aplicada';
  const isBoardingTimerUrgent =
    boardingTimerSeconds !== null && boardingTimerSeconds > 0 && boardingTimerSeconds <= 30;
  const isBoardingTimerExpired = boardingTimerSeconds === 0;
  const tripPickupCoordinate =
    normalizeMapCoordinate(route?.params?.pickupCoordinate) ||
    normalizeMapCoordinate(activeBooking?.pickupLocation) ||
    normalizeMapCoordinate(driverActiveRide?.pickupCoordinate) ||
    normalizeMapCoordinate(currentCoordinate) ||
    PROTOTYPE_ORIGIN_COORDINATE;
  const tripDestinationCoordinate =
    normalizeMapCoordinate(route?.params?.destinationCoordinate) ||
    normalizeMapCoordinate(route?.params?.initialSelectedDestination?.coordinate) ||
    normalizeMapCoordinate(selectedDestination?.coordinate) ||
    normalizeMapCoordinate(activeBooking?.destinationLocation) ||
    normalizeMapCoordinate(driverActiveRide?.destinationCoordinate) ||
    normalizeMapCoordinate(driverActiveRide?.dropoffCoordinate) ||
    null;
  const tripDriverCoordinate =
    normalizeMapCoordinate(route?.params?.driverCoordinate) ||
    normalizeMapCoordinate(driverCoordinate) ||
    normalizeMapCoordinate(driverInfo?.coordinate) ||
    null;
  const tripDriverHeading =
    driverCoordinate?.heading ??
    driverCoordinate?.bearing ??
    driverCoordinate?.course ??
    driverInfo?.heading ??
    driverInfo?.bearing ??
    activeBooking?.driverHeading ??
    activeBooking?.driverLocation?.heading ??
    null;
  const publishedRoadRouteCoordinates = useMemo(() => {
    const activeTarget = isAccepted || isArrived
      ? tripPickupCoordinate
      : tripDestinationCoordinate;
    const publishedCoordinates = normalizeRouteCoordinateList(
      publishedMapRoute?.coordinates,
    );
    const matchesActiveTarget = areMapCoordinatesClose(
      publishedMapRoute?.destination,
      activeTarget,
    );
    const isPublishedFallback =
      publishedMapRoute?.synthetic === true ||
      ['fallback', 'recovery', 'backend_partial'].includes(
        String(publishedMapRoute?.routeSource || '').trim().toLowerCase(),
      );

    return matchesActiveTarget && !isPublishedFallback
      ? resolvePassengerRoadRouteCoordinates(
          publishedCoordinates,
          publishedMapRoute?.origin,
          activeTarget,
        )
      : [];
  }, [
    isAccepted,
    isArrived,
    publishedMapRoute,
    tripDestinationCoordinate,
    tripPickupCoordinate,
  ]);
  const tripRouteCoordinates = useMemo(() => {
    const pickupRouteCandidates = [
      publishedRoadRouteCoordinates,
      route?.params?.driverToPickupRouteCoordinates,
      route?.params?.pickupRouteCoordinates,
      activeBooking?.driverToPickupRouteCoordinates,
      activeBooking?.pickupRouteCoordinates,
      activeBooking?.routePlan?.pickupCoordinates,
      activeBooking?.driverTripMeta?.routePlan?.pickupCoordinates,
      driverActiveRide?.driverToPickupRouteCoordinates,
      driverActiveRide?.pickupRouteCoordinates,
      driverActiveRide?.routePlan?.pickupCoordinates,
      driverActiveRide?.driverTripMeta?.routePlan?.pickupCoordinates,
      driverTripMeta?.routePlan?.pickupCoordinates,
    ];
    const destinationRouteCandidates = [
      activeBooking?.routeCoordinates,
      activeBooking?.route,
      activeBooking?.routePlan?.destinationCoordinates,
      activeBooking?.driverTripMeta?.routePlan?.destinationCoordinates,
      driverActiveRide?.routeCoordinates,
      driverActiveRide?.route,
      driverActiveRide?.routePlan?.destinationCoordinates,
      driverActiveRide?.driverTripMeta?.routePlan?.destinationCoordinates,
      driverTripMeta?.routePlan?.destinationCoordinates,
      publishedRoadRouteCoordinates,
    ];
    const candidateRoutes = isAccepted || isArrived
      ? pickupRouteCandidates
      : destinationRouteCandidates;
    const expectedOrigin = isAccepted || isArrived
      ? tripDriverCoordinate
      : tripPickupCoordinate;
    const expectedDestination = isAccepted || isArrived
      ? tripPickupCoordinate
      : tripDestinationCoordinate;
    return candidateRoutes
      .map(candidate =>
        resolvePassengerRoadRouteCoordinates(
          candidate,
          expectedOrigin,
          expectedDestination,
        ),
      )
      .find(coordinates => coordinates.length >= 3) || [];
  }, [
    activeBooking?.route,
    activeBooking?.routeCoordinates,
    activeBooking?.driverToPickupRouteCoordinates,
    activeBooking?.pickupRouteCoordinates,
    activeBooking?.routePlan?.destinationCoordinates,
    activeBooking?.routePlan?.pickupCoordinates,
    activeBooking?.driverTripMeta?.routePlan?.destinationCoordinates,
    activeBooking?.driverTripMeta?.routePlan?.pickupCoordinates,
    driverActiveRide?.route,
    driverActiveRide?.routeCoordinates,
    driverActiveRide?.driverToPickupRouteCoordinates,
    driverActiveRide?.pickupRouteCoordinates,
    driverActiveRide?.routePlan?.destinationCoordinates,
    driverActiveRide?.routePlan?.pickupCoordinates,
    driverActiveRide?.driverTripMeta?.routePlan?.destinationCoordinates,
    driverActiveRide?.driverTripMeta?.routePlan?.pickupCoordinates,
    driverTripMeta?.routePlan?.destinationCoordinates,
    driverTripMeta?.routePlan?.pickupCoordinates,
    isAccepted,
    isArrived,
    publishedRoadRouteCoordinates,
    tripDestinationCoordinate,
    tripDriverCoordinate,
    tripPickupCoordinate,
  ]);
  const tripRouteTrafficSegments = useMemo(() => {
    if (tripRouteCoordinates.length < 3) {
      return [];
    }

    const pickupTrafficCandidates = [
      publishedRoadRouteCoordinates.length >= 3
        ? publishedMapRoute?.trafficSegments
        : null,
      route?.params?.driverToPickupTrafficSegments,
      route?.params?.pickupTrafficSegments,
      activeBooking?.driverToPickupTrafficSegments,
      activeBooking?.pickupTrafficSegments,
      activeBooking?.routePlan?.pickupTrafficSegments,
      activeBooking?.driverTripMeta?.routePlan?.pickupTrafficSegments,
      driverActiveRide?.driverToPickupTrafficSegments,
      driverActiveRide?.pickupTrafficSegments,
      driverActiveRide?.routePlan?.pickupTrafficSegments,
      driverActiveRide?.driverTripMeta?.routePlan?.pickupTrafficSegments,
      driverTripMeta?.routePlan?.pickupTrafficSegments,
    ];
    const destinationTrafficCandidates = [
      publishedRoadRouteCoordinates.length >= 3
        ? publishedMapRoute?.trafficSegments
        : null,
      activeBooking?.routeTrafficSegments,
      activeBooking?.trafficSegments,
      activeBooking?.destinationTrafficSegments,
      activeBooking?.routePlan?.destinationTrafficSegments,
      activeBooking?.driverTripMeta?.routePlan?.destinationTrafficSegments,
      driverActiveRide?.routeTrafficSegments,
      driverActiveRide?.trafficSegments,
      driverActiveRide?.destinationTrafficSegments,
      driverActiveRide?.routePlan?.destinationTrafficSegments,
      driverActiveRide?.driverTripMeta?.routePlan?.destinationTrafficSegments,
      driverTripMeta?.routePlan?.destinationTrafficSegments,
    ];
    const candidateSegments = isAccepted || isArrived
      ? pickupTrafficCandidates
      : destinationTrafficCandidates;

    return candidateSegments
      .map(normalizeRouteTrafficSegments)
      .find(segments => segments.length > 0) || [];
  }, [
    activeBooking?.destinationTrafficSegments,
    activeBooking?.driverToPickupTrafficSegments,
    activeBooking?.pickupTrafficSegments,
    activeBooking?.routeTrafficSegments,
    activeBooking?.trafficSegments,
    activeBooking?.routePlan?.destinationTrafficSegments,
    activeBooking?.routePlan?.pickupTrafficSegments,
    activeBooking?.driverTripMeta?.routePlan?.destinationTrafficSegments,
    activeBooking?.driverTripMeta?.routePlan?.pickupTrafficSegments,
    driverActiveRide?.destinationTrafficSegments,
    driverActiveRide?.driverToPickupTrafficSegments,
    driverActiveRide?.pickupTrafficSegments,
    driverActiveRide?.routeTrafficSegments,
    driverActiveRide?.trafficSegments,
    driverActiveRide?.routePlan?.destinationTrafficSegments,
    driverActiveRide?.routePlan?.pickupTrafficSegments,
    driverActiveRide?.driverTripMeta?.routePlan?.destinationTrafficSegments,
    driverActiveRide?.driverTripMeta?.routePlan?.pickupTrafficSegments,
    driverTripMeta?.routePlan?.destinationTrafficSegments,
    driverTripMeta?.routePlan?.pickupTrafficSegments,
    isAccepted,
    isArrived,
    publishedMapRoute?.trafficSegments,
    publishedRoadRouteCoordinates.length,
    route?.params?.driverToPickupTrafficSegments,
    route?.params?.pickupTrafficSegments,
    tripRouteCoordinates.length,
  ]);
  const tripRouteOriginCoordinate =
    Array.isArray(tripRouteCoordinates) && tripRouteCoordinates.length >= 2
      ? tripRouteCoordinates[0]
      : tripPickupCoordinate;
  const tripRouteDestinationCoordinate =
    isAccepted || isArrived
      ? tripPickupCoordinate
      : tripDestinationCoordinate || tripPickupCoordinate;
  const mapFocusPoints = useMemo(
    () =>
      isAccepted || isArrived
        ? [
            tripDriverCoordinate,
            tripPickupCoordinate,
            ...tripRouteCoordinates,
          ]
        : [
            tripPickupCoordinate,
            tripDestinationCoordinate,
            tripDriverCoordinate,
            ...tripRouteCoordinates,
          ],
    [
      isAccepted,
      isArrived,
      tripDestinationCoordinate,
      tripDriverCoordinate,
      tripPickupCoordinate,
      tripRouteCoordinates,
    ]
  );
  const tripViewportCoordinates = useMemo(
    () => (
      tripRouteCoordinates.length >= 2
        ? [...tripRouteCoordinates, ...mapFocusPoints]
        : []
    ),
    [mapFocusPoints, tripRouteCoordinates],
  );
  const tripVisibleRouteRegion = useMemo(
    () =>
      buildRouteViewportRegion({
        coordinates: tripViewportCoordinates,
        mapWidth: mapWidth || windowWidth,
        mapHeight: mapHeight || windowHeight,
        activeOcclusion: tripMapActiveOcclusion,
        insets,
        viewportPadding: tripMapViewportPadding,
        minVisibleHeight: TRIP_MAP_MIN_VISIBLE_HEIGHT,
        shortRouteMaxDistanceKm: PASSENGER_TRIP_ROUTE_FIT_SHORT_MAX_DISTANCE_KM,
        shortRouteLatitudeDeltaMultiplier: 1.1,
        shortRouteLongitudeDeltaMultiplier: 1.2,
        longRouteLatitudeDeltaMultiplier: PASSENGER_TRIP_ROUTE_FIT_LONG_LATITUDE_MULTIPLIER,
        longRouteLongitudeDeltaMultiplier: PASSENGER_TRIP_ROUTE_FIT_LONG_LONGITUDE_MULTIPLIER,
      }),
    [
      insets,
      mapHeight,
      mapWidth,
      tripMapActiveOcclusion,
      tripMapViewportPadding,
      tripViewportCoordinates,
      windowHeight,
      windowWidth,
    ],
  );
  const tripMapRegion = useMemo(
    () =>
      tripVisibleRouteRegion || buildFallbackTripRegion(mapFocusPoints),
    [
      mapFocusPoints,
      tripVisibleRouteRegion,
    ]
  );
  const arrivalLabel =
    isOperationalDecisionPending
      ? 'Escolha como deseja seguir'
      : isOperationalSearching
        ? 'Procurando outro motorista'
      : isArrived
      ? `Encontre seu motorista em ${boardingCountdownLabel || '2:00'}`
      : Number.isFinite(resolvedTripDurationMin) && resolvedTripDurationMin > 0
        ? `Chegada em ${resolvedTripDurationMin} min`
        : isAccepted
          ? 'Pronto para iniciar a viagem'
          : 'Viagem em andamento';
  const extensionPaymentData = useMemo(
    () => buildExtensionPaymentData(rideExtension, activeBookingId),
    [activeBookingId, rideExtension]
  );
  const pickupLabel =
    String(
      activeBooking?.pickupLocation?.add ||
        activeBooking?.pickupAddress ||
        route?.params?.originAddress ||
        currentAddress ||
        '',
    ).trim() || 'Local combinado';
  const pickupPointLabel =
    pickupLabel.split(',').slice(0, 2).join(',').trim() || pickupLabel;
  const pickupCompactLabel = pickupLabel.split(',')[0]?.trim() || pickupPointLabel;
  const routeTotalMinutes =
    activeBooking?.initialTripDurationMin ||
    activeBooking?.estimatedTotalDurationMin ||
    activeBooking?.totalDurationMin ||
    route?.params?.initialTripDurationMin ||
    resolvedTripDurationMin;
  const routeStartedAt =
    activeBooking?.startedAt ||
    activeBooking?.tripStartedAt ||
    route?.params?.startedAt;
  const liveRouteKey = [
    activeBookingId,
    activeBooking?.bookingId,
    activeBooking?.id,
    driverActiveRide?.bookingId,
    driverActiveRide?.id,
    normalizedStatus,
    routeStartedAt,
    pickupPointLabel,
    destination,
  ]
    .filter(Boolean)
    .join(':');
  const passengerSupportContext = useMemo(() => {
    const bookingId = String(
      activeBookingId ||
        activeBooking?.bookingId ||
        activeBooking?.id ||
        driverActiveRide?.bookingId ||
        driverActiveRide?.id ||
        route?.params?.bookingId ||
        '',
    ).trim();

    return {
      ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
      bookingStatus: normalizedStatus,
      source: 'passenger-trip',
    };
  }, [
    activeBooking?.bookingId,
    activeBooking?.id,
    activeBookingId,
    driverActiveRide?.bookingId,
    driverActiveRide?.id,
    normalizedStatus,
    route?.params?.bookingId,
  ]);
  const completedReceiptParams = useMemo(() => {
    const bookingId = String(
      passengerSupportContext.bookingId ||
        activeBookingId ||
        activeBooking?.bookingId ||
        activeBooking?.id ||
        route?.params?.bookingId ||
        '',
    ).trim();
    const fare = Number(
      activeBooking?.grossFare ||
        activeBooking?.fare ||
        activeBooking?.amount ||
        route?.params?.selectedFare ||
        route?.params?.fare ||
        selectedFare,
    );

    return {
      fromTrip: true,
      ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
      ...(Number.isFinite(fare) && fare > 0 ? { fare, grossAmount: fare } : {}),
      pickupAddress: pickupLabel,
      destinationAddress: destination,
      driverId: driverInfo?.id || null,
      driverName: driverInfo?.name || route?.params?.driverName || null,
      vehicleLabel: selectedVehicle || route?.params?.vehicle || null,
      vehiclePlate: driverInfo?.plate || route?.params?.vehiclePlate || null,
    };
  }, [
    activeBooking?.amount,
    activeBooking?.bookingId,
    activeBooking?.fare,
    activeBooking?.grossFare,
    activeBooking?.id,
    activeBookingId,
    destination,
    driverInfo?.id,
    driverInfo?.name,
    driverInfo?.plate,
    passengerSupportContext.bookingId,
    pickupLabel,
    route?.params?.bookingId,
    route?.params?.driverName,
    route?.params?.fare,
    route?.params?.selectedFare,
    route?.params?.vehicle,
    route?.params?.vehiclePlate,
    selectedFare,
    selectedVehicle,
  ]);
  const handleOpenPassengerChat = useCallback(() => {
    navigation.navigate('RobotaxiPrototypeChat', passengerSupportContext);
  }, [navigation, passengerSupportContext]);
  const handleOpenPassengerCancellation = useCallback(() => {
    navigation.navigate('RobotaxiPrototypeCancellation', {
      ...passengerSupportContext,
      source: 'passenger-trip',
    });
  }, [navigation, passengerSupportContext]);
  const {
    routeProgress,
    arrivalClockLabel,
    displayEtaMinutes,
  } = useLiveRouteTiming({
    routeKey: liveRouteKey || 'passenger-trip-route',
    remainingMinutes: resolvedTripDurationMin,
    totalMinutes: routeTotalMinutes,
    startedAt: routeStartedAt,
    active: isStarted,
  });
  const stableEtaValue =
    Number.isFinite(displayEtaMinutes) && displayEtaMinutes > 0
      ? `${displayEtaMinutes} min`
      : null;
  const compactEtaValue =
    isArrived && boardingCountdownLabel
      ? boardingCountdownLabel
      : isAccepted && !isStarted
        ? pickupEtaValue || stableEtaValue ||
          (Number.isFinite(resolvedTripDurationMin) && resolvedTripDurationMin > 0
            ? `${resolvedTripDurationMin} min`
            : '--')
      : stableEtaValue ||
        (Number.isFinite(resolvedTripDurationMin) && resolvedTripDurationMin > 0
          ? `${resolvedTripDurationMin} min`
          : '--');
  const compactArrivalTime = useMemo(() => {
    const clockMatch = String(arrivalClockLabel || '').match(/\b\d{1,2}:\d{2}\b/);
    return clockMatch?.[0] || compactEtaValue;
  }, [arrivalClockLabel, compactEtaValue]);
  const shouldUseCompactTripCard =
    (isAccepted || isArrived || isStarted || isOperationalDecisionPending) &&
    !isOperationalSearching &&
    !['driver_decision_pending', 'pending_payment', 'confirming', 'expired', 'rejected'].includes(extensionStatus);
  const passengerCardFieldTestIDs = isStarted
    ? PASSENGER_TRIP_FIELD_TEST_IDS.started
    : isArrived
      ? PASSENGER_TRIP_FIELD_TEST_IDS.arrived
      : PASSENGER_TRIP_FIELD_TEST_IDS.accepted;
  const driverInitial = String(driverName || 'C').trim().charAt(0).toUpperCase() || 'C';
  const driverRatingLabel = driverInfo?.rating
    ? `${Number(driverInfo.rating).toFixed(1).replace('.', ',')} · parceiro Leaf`
    : 'parceiro Leaf';
  const plateLabel = vehiclePlate || 'Placa não informada';
  const passengerSheetTitle = isProtectedStatusWithoutRideIdentity
    ? 'Sincronizando corrida'
    : isStarted
    ? 'Progresso da viagem'
    : isArrived
      ? 'Ponto de encontro'
      : 'Seu motorista';
  const passengerSheetKicker = isProtectedStatusWithoutRideIdentity
    ? 'Validando dados da corrida'
    : isStarted
    ? arrivalClockLabel || resolvedTripArrivalText || compactEtaValue
    : isArrived
      ? pickupPointLabel
      : `${compactEtaValue} até o embarque`;
  const boardingPinLabel =
    String(
      activeBooking?.boardingPin ||
        activeBooking?.boardingCode ||
        activeBooking?.pin ||
        route?.params?.boardingPin ||
        '',
    ).trim() || '----';
  const interruptionPickupLabel = useMemo(() => {
    const interruptionPickup =
      operationalContinuation?.pickupLocation?.add ||
      operationalContinuation?.pickupLocation?.address ||
      operationalContinuation?.pickupLocation?.formattedAddress ||
      currentAddress ||
      'Ponto atual';
    return String(interruptionPickup || 'Ponto atual').trim();
  }, [currentAddress, operationalContinuation?.pickupLocation]);
  const isLifecycleNavigationLocked = PROTECTED_PASSENGER_TRIP_STATUSES.has(
    normalizedStatus,
  );
  const tripMapPresentation = useMemo(
    () => resolvePrototypeMapPresentation({ role: 'passenger', status: normalizedStatus }),
    [normalizedStatus],
  );

  const handleDismiss = () => {
    if (isLifecycleNavigationLocked) {
      return;
    }

    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('RobotaxiPrototype');
  };

  useEffect(() => {
    if (
      !isLifecycleNavigationLocked ||
      typeof navigation?.addListener !== 'function'
    ) {
      return undefined;
    }

    // Android back actions and navigator state restoration bypass the sheet
    // backdrop and gesture configuration, so active rides block route removal.
    const unsubscribe = navigation.addListener('beforeRemove', event => {
      event?.preventDefault?.();
    });

    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }, [isLifecycleNavigationLocked, navigation]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || 'prototype-trip',
    occludedBottom: protectedMapOccludedBottom
  });

  const handleCardLayout = useCallback(event => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      const boundedHeight = Math.min(nextHeight, tripSheetMaxHeight);
      setCardHeight(previous => (previous === boundedHeight ? previous : boundedHeight));
    }
  }, [tripSheetMaxHeight]);
  const handleMapLayout = useCallback(event => {
    const nextWidth = event?.nativeEvent?.layout?.width;
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextWidth) && nextWidth > 0) {
      setMapWidth(previous => (previous === nextWidth ? previous : nextWidth));
    }
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setMapHeight(previous => (previous === nextHeight ? previous : nextHeight));
    }
  }, []);

  useEffect(() => {
    if (normalizedStatus === 'completed') {
      navigation.replace('RobotaxiPrototypeReceipt', completedReceiptParams);
    }
  }, [completedReceiptParams, navigation, normalizedStatus]);

  useEffect(() => {
    if (extensionStatus === 'pending_payment' && extensionPaymentData?.chargeId) {
      setIsExtensionPaymentVisible(true);
    }
  }, [extensionPaymentData?.chargeId, extensionStatus]);

  useEffect(() => {
    setIsTripExpanded(passengerTripSheetExpansionLocked);
  }, [
    activeBookingId,
    extensionStatus,
    normalizedStatus,
    operationalStatus,
    passengerTripSheetExpansionLocked,
  ]);

  const handleOpenExtensionFlow = useCallback(() => {
    navigation.navigate('RobotaxiPrototypeDestination', {
      mode: 'extension',
      returnRouteName: 'RobotaxiPrototypeTrip'
    });
  }, [navigation]);

  const handleEndTripEarly = useCallback(() => {
    if (isBusy) {
      return;
    }

    Alert.alert(
      'Encerrar corrida agora',
      'Vamos encerrar a corrida no ponto atual. O reembolso será calculado pelo backend com base no trecho executado e nos custos da corrida.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Encerrar agora',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsBusy(true);
              await endTripEarlyFlow();
            } catch (error) {
              Alert.alert('Não foi possível encerrar', error?.message || 'Falha ao encerrar a corrida agora.');
            } finally {
              setIsBusy(false);
            }
          }
        }
      ]
    );
  }, [endTripEarlyFlow, isBusy]);

  const handleContinueWithOtherDriver = useCallback(() => {
    if (isBusy) {
      return;
    }

    Alert.alert(
      'Continuar com outro motorista',
      'Vamos manter o pagamento já reservado e procurar outro parceiro para seguir do ponto atual.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Continuar viagem',
          onPress: async () => {
            try {
              setIsBusy(true);
              await respondOperationalContinuationFlow(true);
            } catch (error) {
              Alert.alert('Não foi possível continuar', error?.message || 'Falha ao procurar outro motorista agora.');
            } finally {
              setIsBusy(false);
            }
          }
        }
      ]
    );
  }, [isBusy, respondOperationalContinuationFlow]);

  const handleEndAfterInterruption = useCallback(() => {
    if (isBusy) {
      return;
    }

    Alert.alert(
      'Encerrar no ponto atual',
      'Vamos encerrar a corrida aqui e calcular o reembolso líquido com base no trecho executado.',
      [
        { text: 'Voltar', style: 'cancel' },
        {
          text: 'Encerrar aqui',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsBusy(true);
              await respondOperationalContinuationFlow(false);
            } catch (error) {
              Alert.alert('Não foi possível encerrar', error?.message || 'Falha ao encerrar a corrida agora.');
            } finally {
              setIsBusy(false);
            }
          }
        }
      ]
    );
  }, [isBusy, respondOperationalContinuationFlow]);

  const handleShareTrip = useCallback(() => {
    navigation.navigate('RobotaxiPrototypeShareTrip', {
      bookingId: activeBookingId,
      destination,
      driverName,
      vehicleModel,
      vehiclePlate,
      tripArrivalText: resolvedTripArrivalText,
    });
  }, [activeBookingId, destination, driverName, navigation, resolvedTripArrivalText, vehicleModel, vehiclePlate]);

  const renderCompactMoreOptionsButton = (testID, style = styles.compactMoreOptionsButton) => (
    <RobotaxiLifecycleDisclosure
      expanded={false}
      onPress={() => setIsTripExpanded(true)}
      style={style}
      testID={testID}
      accessibilityLabel="Mais opções"
    />
  );

  const renderStartedActionDock = (style, { compact = false } = {}) => (
    <View
      style={[styles.startedActionDock, style]}
      testID="passenger-trip-started-action-dock"
      accessibilityLabel="passenger-trip-started-action-dock"
    >
      {compact ? (
        renderCompactMoreOptionsButton(
          'passenger-trip-more-actions-button',
          styles.compactStartedMoreButton
        )
      ) : (
        <View style={styles.expandedStartedActions}>
          <RobotaxiLifecycleButton
            label="Falar no chat"
            icon="chatbubble-ellipses-outline"
            tone="secondary"
            onPress={handleOpenPassengerChat}
            style={styles.expandedStartedAction}
            testID="passenger-trip-message-button"
            accessibilityLabel="Falar no chat"
          />
          <RobotaxiLifecycleButton
            label="Compartilhar viagem"
            icon="share-social-outline"
            tone="secondary"
            onPress={handleShareTrip}
            style={styles.expandedStartedAction}
            testID={passengerCardFieldTestIDs.share_trip_action}
            accessibilityLabel="Compartilhar viagem"
          />
          <RobotaxiLifecycleButton
            label="Alterar destino"
            icon="navigate-outline"
            tone="secondary"
            onPress={handleOpenExtensionFlow}
            style={styles.expandedStartedAction}
            testID="passenger-trip-change-destination-button"
            accessibilityLabel="Alterar destino"
          />
          <RobotaxiLifecycleButton
            label={isBusy ? 'Encerrando...' : 'Encerrar corrida'}
            icon="flag-outline"
            tone="danger"
            onPress={handleEndTripEarly}
            disabled={isBusy}
            style={styles.expandedStartedAction}
            testID="passenger-trip-end-early-button"
            accessibilityLabel="Encerrar corrida"
          />
        </View>
      )}
    </View>
  );

  const renderPassengerCardStateHeader = () => (
    <>
      <View style={styles.cardStateHeader}>
        <Text style={styles.cardStateTitle} numberOfLines={2}>
          {passengerSheetTitle}
        </Text>
        <RobotaxiLifecycleButton
          label="SOS"
          icon="shield-checkmark-outline"
          tone="safety"
          onPress={() => navigation.navigate('RobotaxiPrototypeSupport', passengerSupportContext)}
          style={styles.headerSafetyAction}
          testID={passengerCardFieldTestIDs.safety_action}
          accessibilityLabel="SOS"
        />
      </View>
      <LeafDivider style={styles.cardStateDivider} />
    </>
  );

  const renderPassengerMissingIdentityState = () => (
    <View
      testID="passenger-trip-missing-identity-card"
      accessibilityLabel="passenger-trip-missing-identity-card"
    >
      <View style={styles.sheetHandle} />
      <View style={styles.cardStateHeader}>
        <Text
          style={styles.cardStateTitle}
          numberOfLines={2}
          testID="passenger-trip-missing-identity-title"
        >
          Sincronizando corrida
        </Text>
      </View>
      <LeafDivider style={styles.cardStateDivider} />
      <View style={styles.extensionNotice}>
        <View style={styles.extensionNoticeHeader}>
          <Ionicons name="sync-outline" size={16} color={color.text.primary} />
          <Text style={styles.extensionTitle}>Validando dados do motorista</Text>
        </View>
        <Text style={styles.extensionMessage}>
          Recebemos um estado ativo, mas a identificação canônica da corrida ainda
          não chegou. Mantemos esta tela travada até o servidor confirmar o booking.
        </Text>
      </View>
      <RobotaxiLifecycleButton
        label="Aguardando servidor"
        tone="primary"
        disabled
        style={styles.acceptedPrimary}
        testID="passenger-trip-missing-identity-button"
        accessibilityLabel="passenger-trip-missing-identity-button"
      />
    </View>
  );

  const renderOperationalDecisionCompactCard = () => (
    <>
      <RobotaxiLifecycleSummary
        eyebrow="VIAGEM INTERROMPIDA"
        title="Como deseja continuar?"
        subtitle={operationalContinuation?.message ||
          'Você pode seguir com outro motorista a partir do ponto atual.'}
        titleTestID="passenger-trip-operational-title"
      />
      <RobotaxiLifecycleIdentity
        initial={driverInitial}
        photoUri={driverPhotoUri}
        name={driverName}
        meta={(
          <>
            <Text testID={passengerCardFieldTestIDs.vehicle_model}>{vehicleModel}</Text>
            <Text> · </Text>
            <Text testID={passengerCardFieldTestIDs.vehicle_color}>{vehicleColorLabel}</Text>
          </>
        )}
        trailing={plateLabel}
        style={styles.compactIdentity}
        testID="passenger-trip-driver-identity"
        fieldTestIDs={{
          avatar: passengerCardFieldTestIDs.driver_photo,
          name: passengerCardFieldTestIDs.driver_name,
          trailing: passengerCardFieldTestIDs.vehicle_plate,
        }}
      />
      <View style={styles.lifecycleDecisionActions}>
        <RobotaxiLifecycleDisclosure
          expanded={false}
          onPress={() => setIsTripExpanded(true)}
          label="Outras opções"
          testID="passenger-trip-operational-details-button"
          accessibilityLabel="Outras opções"
        />
        <RobotaxiLifecycleButton
          label={isBusy ? 'Processando...' : 'Continuar com outro motorista'}
          icon="car-outline"
          tone="primary"
          onPress={handleContinueWithOtherDriver}
          disabled={isBusy}
          testID="passenger-trip-operational-continue-button"
          accessibilityLabel="Continuar com outro motorista"
        />
      </View>
    </>
  );

  const renderOperationalDecisionExpandedCard = () => (
    <View testID="passenger-trip-operational-expanded-summary">
      <RobotaxiLifecycleDisclosure
        expanded
        onPress={() => setIsTripExpanded(false)}
        expandedLabel="Voltar ao resumo"
        testID="passenger-trip-collapse-button"
        accessibilityLabel="passenger-trip-collapse-button"
      />
      <RobotaxiLifecycleSummary
        eyebrow="VIAGEM INTERROMPIDA"
        title="Escolha como seguir"
        subtitle={`Ponto atual: ${interruptionPickupLabel}`}
      />
      <RobotaxiLifecycleSection title="MOTORISTA E VEÍCULO">
        <RobotaxiLifecycleIdentity
          initial={driverInitial}
          photoUri={driverPhotoUri}
          name={driverName}
          meta={driverRatingLabel}
          trailing={plateLabel}
          testID="passenger-trip-expanded-driver-identity"
        />
        <Text style={styles.expandedVehicleLine} numberOfLines={1}>
          {vehicleModel} · {vehicleColorLabel}
        </Text>
      </RobotaxiLifecycleSection>
      <View style={styles.metaRow}>
        <RobotaxiLifecycleMetric
          label="Reembolso estimado"
          value={formatCurrency(operationalContinuation?.estimatedRefund)}
        />
        <RobotaxiLifecycleMetric
          label="Saldo reservado"
          value={formatCurrency(operationalContinuation?.remainingReservedAmount)}
        />
      </View>
      <RobotaxiLifecycleSection title="SUA DECISÃO">
        <View style={styles.lifecycleDecisionActions}>
          <RobotaxiLifecycleButton
            label={isBusy ? 'Processando...' : 'Continuar com outro motorista'}
            icon="car-outline"
            tone="primary"
            onPress={handleContinueWithOtherDriver}
            disabled={isBusy}
            testID="passenger-trip-operational-continue-button"
            accessibilityLabel="Continuar com outro motorista"
          />
          <RobotaxiLifecycleButton
            label={isBusy ? 'Processando...' : 'Encerrar neste ponto'}
            icon="stop-circle-outline"
            tone="danger"
            onPress={handleEndAfterInterruption}
            disabled={isBusy}
            testID="passenger-trip-operational-end-button"
            accessibilityLabel="Encerrar neste ponto"
          />
        </View>
      </RobotaxiLifecycleSection>
    </View>
  );

  const renderCompactTripCard = () => (
    <View
      testID="passenger-trip-compact-summary"
      accessibilityLabel="passenger-trip-compact-summary"
    >
      {isProtectedStatusWithoutRideIdentity ? (
        renderPassengerMissingIdentityState()
      ) : (
        <>
      {isOperationalDecisionPending ? (
        renderOperationalDecisionCompactCard()
      ) : isStarted ? (
        <>
          <RobotaxiLifecycleSummary
            eyebrow="EM VIAGEM"
            title={destination}
            value={compactArrivalTime}
            valueLabel="chegada"
            titleTestID={passengerCardFieldTestIDs.destination_address}
            valueTestID={passengerCardFieldTestIDs.eta_final}
          />
          <View style={styles.startedProgressTrack} testID="passenger-trip-route-progress">
            <LeafProgressBar
              progress={routeProgress}
              fillTestID={passengerCardFieldTestIDs.route_progress}
            />
            <View style={styles.startedProgressMetaRow}>
              <Text style={styles.startedProgressMetaLabel}>Você está a caminho</Text>
              <Text
                style={styles.startedProgressMetaValue}
                numberOfLines={1}
                testID={passengerCardFieldTestIDs.distance_remaining}
              >
                {distanceLabel && distanceLabel !== '--' ? `${distanceLabel} restante` : 'Em rota'}
              </Text>
            </View>
          </View>
          {renderStartedActionDock(styles.startedActionDockCompact, { compact: true })}
        </>
      ) : isArrived ? (
        <>
          <RobotaxiLifecycleSummary
            eyebrow="MOTORISTA CHEGOU"
            title={pickupCompactLabel}
            value={boardingCountdownLabel || '0:00'}
            valueLabel="para embarcar"
            titleTestID={passengerCardFieldTestIDs.pickup_address}
            valueTestID={passengerCardFieldTestIDs.boarding_timer}
          />
          <Text
            style={[
              styles.compactStatusMessage,
              isBoardingTimerUrgent && styles.boardingTimerMessageUrgent,
              isBoardingTimerExpired && styles.boardingTimerMessageExpired,
            ]}
            numberOfLines={1}
            testID={passengerCardFieldTestIDs.boarding_timer_message}
          >
            {boardingTimerMessage}
          </Text>
          <RobotaxiLifecycleIdentity
            initial={driverInitial}
            photoUri={driverPhotoUri}
            name={driverName}
            meta={(
              <>
                <Text testID={passengerCardFieldTestIDs.vehicle_model}>{vehicleModel}</Text>
                <Text> · </Text>
                <Text testID={passengerCardFieldTestIDs.vehicle_color}>{vehicleColorLabel}</Text>
              </>
            )}
            trailing={plateLabel}
            style={styles.compactIdentity}
            testID="passenger-trip-driver-identity"
            fieldTestIDs={{
              avatar: passengerCardFieldTestIDs.driver_photo,
              name: passengerCardFieldTestIDs.driver_name,
              trailing: passengerCardFieldTestIDs.vehicle_plate,
            }}
          />
          <View
            style={styles.compactLifecycleActions}
            testID={passengerCardFieldTestIDs.contact_actions}
          >
            {renderCompactMoreOptionsButton(
              'passenger-trip-arrived-more-options-button',
              styles.compactLifecycleActionFull,
            )}
          </View>
        </>
      ) : (
        <>
          <RobotaxiLifecycleSummary
            eyebrow="MOTORISTA A CAMINHO"
            title={pickupCompactLabel}
            value={compactEtaValue}
            valueLabel="até chegar"
            titleTestID={passengerCardFieldTestIDs.pickup_address}
            valueTestID={passengerCardFieldTestIDs.pickup_eta}
          />
          <Text
            style={styles.compactStatusMessage}
            numberOfLines={1}
            testID={passengerCardFieldTestIDs.pickup_distance}
          >
            {distanceLabel} até o embarque
          </Text>
          <RobotaxiLifecycleIdentity
            initial={driverInitial}
            photoUri={driverPhotoUri}
            name={driverName}
            meta={(
              <>
                <Text testID={passengerCardFieldTestIDs.vehicle_model}>{vehicleModel}</Text>
                <Text> · </Text>
                <Text testID={passengerCardFieldTestIDs.vehicle_color}>{vehicleColorLabel}</Text>
                <Text> · {driverRatingLabel}</Text>
              </>
            )}
            trailing={plateLabel}
            style={styles.compactIdentity}
            testID="passenger-trip-driver-identity"
            fieldTestIDs={{
              avatar: passengerCardFieldTestIDs.driver_photo,
              name: passengerCardFieldTestIDs.driver_name,
              meta: passengerCardFieldTestIDs.driver_rating,
              trailing: passengerCardFieldTestIDs.vehicle_plate,
            }}
          />
          <View
            style={styles.compactLifecycleActions}
            testID={passengerCardFieldTestIDs.contact_actions}
          >
            {renderCompactMoreOptionsButton(
              'passenger-trip-accepted-more-options-button',
              styles.compactLifecycleActionFull,
            )}
          </View>
        </>
      )}
        </>
      )}
    </View>
  );

  const renderExpandedTripCard = () => (
    <View testID="passenger-trip-expanded-summary">
      <RobotaxiLifecycleDisclosure
        expanded
        onPress={() => setIsTripExpanded(false)}
        label="Mais opções"
        expandedLabel="Voltar ao resumo"
        testID="passenger-trip-collapse-button"
        accessibilityLabel="passenger-trip-collapse-button"
      />

      <RobotaxiLifecycleSection>
        <RobotaxiLifecycleSummary
          eyebrow={isStarted ? 'EM VIAGEM' : isArrived ? 'MOTORISTA CHEGOU' : 'MOTORISTA A CAMINHO'}
          title={isStarted ? destination : pickupCompactLabel}
          value={isStarted ? compactArrivalTime : isArrived ? boardingCountdownLabel || '0:00' : compactEtaValue}
          valueLabel={isStarted ? 'chegada' : isArrived ? 'para embarcar' : 'até chegar'}
          titleTestID={isStarted
            ? passengerCardFieldTestIDs.destination_address
            : passengerCardFieldTestIDs.pickup_address}
          valueTestID={isStarted
            ? passengerCardFieldTestIDs.eta_final
            : isArrived
              ? passengerCardFieldTestIDs.boarding_timer
              : passengerCardFieldTestIDs.pickup_eta}
        />
        {isStarted ? (
          <View style={styles.startedProgressTrack} testID="passenger-trip-route-progress">
            <LeafProgressBar
              progress={routeProgress}
              fillTestID={passengerCardFieldTestIDs.route_progress}
            />
            <Text
              style={styles.compactStatusMessage}
              testID={passengerCardFieldTestIDs.distance_remaining}
            >
              {distanceLabel && distanceLabel !== '--' ? `${distanceLabel} restante` : 'Em rota'}
            </Text>
          </View>
        ) : (
          <>
            <Text
              style={styles.compactStatusMessage}
              testID={isArrived
                ? passengerCardFieldTestIDs.boarding_timer_message
                : passengerCardFieldTestIDs.pickup_distance}
            >
              {isArrived ? boardingTimerMessage : `${distanceLabel} até o embarque`}
            </Text>
            {isAccepted ? (
              <Text
                style={styles.compactDestinationLine}
                testID={passengerCardFieldTestIDs.destination_address}
              >
                Destino: {destination}
              </Text>
            ) : null}
          </>
        )}

        <RobotaxiLifecycleIdentity
          initial={driverInitial}
          photoUri={driverPhotoUri}
          name={driverName}
          meta={(
            <>
              <Text testID={passengerCardFieldTestIDs.vehicle_model}>{vehicleModel}</Text>
              <Text> · </Text>
              {passengerCardFieldTestIDs.vehicle_color ? (
                <Text testID={passengerCardFieldTestIDs.vehicle_color}>{vehicleColorLabel}</Text>
              ) : null}
            </>
          )}
          trailing={plateLabel}
          style={styles.expandedIdentity}
          testID="passenger-trip-driver-identity"
          fieldTestIDs={{
            avatar: passengerCardFieldTestIDs.driver_photo,
            name: passengerCardFieldTestIDs.driver_name,
            trailing: passengerCardFieldTestIDs.vehicle_plate,
          }}
        />
      </RobotaxiLifecycleSection>

      <RobotaxiLifecycleSection title="AÇÕES">
        <View
          style={styles.expandedActionGrid}
          testID={passengerCardFieldTestIDs.contact_actions}
        >
          <RobotaxiLifecycleButton
            label="Segurança"
            icon="shield-checkmark-outline"
            tone="safety"
            onPress={() => navigation.navigate('RobotaxiPrototypeSupport', passengerSupportContext)}
            style={styles.expandedGridAction}
            testID={passengerCardFieldTestIDs.safety_action}
            accessibilityLabel="SOS"
          />
          <RobotaxiLifecycleButton
            label="Chat"
            icon="chatbubble-ellipses-outline"
            onPress={handleOpenPassengerChat}
            style={styles.expandedGridAction}
            testID="passenger-trip-message-button"
            accessibilityLabel="Falar no chat"
          />
          <RobotaxiLifecycleButton
            label="Compartilhar"
            icon="share-social-outline"
            onPress={handleShareTrip}
            style={styles.expandedGridAction}
            testID={passengerCardFieldTestIDs.share_trip_action}
            accessibilityLabel="Compartilhar viagem"
          />
          {isStarted ? (
            <RobotaxiLifecycleButton
              label="Alterar destino"
              icon="navigate-outline"
              onPress={handleOpenExtensionFlow}
              style={styles.expandedGridAction}
              testID="passenger-trip-change-destination-button"
              accessibilityLabel="Alterar destino"
            />
          ) : null}
          <RobotaxiLifecycleButton
            label={isStarted ? (isBusy ? 'Encerrando...' : 'Encerrar corrida') : 'Cancelar corrida'}
            icon={isStarted ? 'flag-outline' : 'close-circle-outline'}
            tone="danger"
            disabled={isBusy}
            onPress={isStarted ? handleEndTripEarly : handleOpenPassengerCancellation}
            style={styles.expandedGridActionFull}
            testID={isStarted ? 'passenger-trip-end-early-button' : 'passenger-trip-cancel-button'}
            accessibilityLabel={isStarted ? 'Encerrar corrida' : 'Cancelar corrida'}
          />
        </View>
      </RobotaxiLifecycleSection>
    </View>
  );

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar translucent backgroundColor="transparent" barStyle="dark-content" />
        <PrototypeMapLayer
          mapRef={mapRef}
          region={tripMapRegion}
          forceRegionUpdate
          userCoordinate={normalizeMapCoordinate(currentCoordinate) || tripPickupCoordinate}
          userHeading={currentHeading}
          userAvatarLetter="L"
          driverCoordinate={tripDriverCoordinate}
          driverHeading={tripDriverHeading}
          routeCoordinates={tripRouteCoordinates}
          routeTrafficSegments={tripRouteTrafficSegments}
          showTraffic={tripRouteTrafficSegments.length > 0}
          originCoordinate={tripRouteOriginCoordinate}
          destinationCoordinate={tripRouteDestinationCoordinate}
          destinationLabel={isAccepted || isArrived ? 'Embarque' : destination}
          destinationAddress={destinationAddress}
          originLabel="Partida"
          originAddress={currentAddress || 'Sua localização atual'}
          interactionEnabled={tripMapPresentation.interactionEnabled}
          viewportPadding={tripMapViewportPadding}
          routeViewportRegion={tripVisibleRouteRegion}
          onMapLayout={handleMapLayout}
          animateRoute={tripMapPresentation.animateRoute}
          manualCameraHoldMs={tripMapPresentation.manualCameraHoldMs}
          hideRouteEndpointMarkers
          driverMarkerMode="car"
          driverVehicleColor={vehicleColorLabel}
          driverMarkerAssetUrl={vehicleMarkerCampaignAsset.imageUrl}
          driverMarkerLetter={getFirstName(driverName, 'M')}
          destinationMarkerMode="place"
        />
        <PrototypeConnectionStatusPill
          topOffset={insets.top + 16}
          visible={Boolean(rideLocalSyncIndicator)}
          tone={rideLocalSyncIndicator?.tone}
          icon={rideLocalSyncIndicator?.icon}
          title={rideLocalSyncIndicator?.title}
          message={rideLocalSyncIndicator?.message}
          testID="passenger-trip-local-sync-pill"
        />
        <PrototypeConnectionStatusPill
          topOffset={insets.top + (rideLocalSyncIndicator ? 72 : 16)}
          visible={Boolean(driverSignalIndicator)}
          tone={driverSignalIndicator?.tone}
          icon={driverSignalIndicator?.icon}
          title={driverSignalIndicator?.title}
          message={driverSignalIndicator?.message}
          testID="passenger-trip-driver-signal-pill"
        />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropDismissEnabled={false}
          dragEnabled={false}
          bottomGapFillColor="transparent"
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <RobotaxiLifecycleCard
            onLayout={handleCardLayout}
            style={[
              styles.tripCard,
              shouldUseCompactTripCard &&
                !passengerTripSheetExpansionLocked &&
                !isTripExpanded &&
                styles.compactCard,
              {
                maxHeight: tripSheetMaxHeight,
              },
            ]}
            scrollEnabled
            scrollStyle={[
              styles.tripSheetScroll,
              { maxHeight: tripSheetScrollMaxHeight },
            ]}
            showsVerticalScrollIndicator={
              passengerTripSheetExpansionLocked || isTripExpanded
            }
            testID="passenger-trip-screen"
            accessibilityLabel="passenger-trip-screen"
          >
            {shouldUseCompactTripCard &&
            !passengerTripSheetExpansionLocked &&
            !isTripExpanded ? (
              renderCompactTripCard()
            ) : shouldUseCompactTripCard &&
              !passengerTripSheetExpansionLocked &&
              isTripExpanded ? (
              isOperationalDecisionPending
                ? renderOperationalDecisionExpandedCard()
                : renderExpandedTripCard()
            ) : isProtectedStatusWithoutRideIdentity ? (
              renderPassengerMissingIdentityState()
            ) : (
              <>
            {shouldUseCompactTripCard && !passengerTripSheetExpansionLocked ? (
              <TouchableOpacity
                activeOpacity={0.82}
                onPress={() => setIsTripExpanded(false)}
                style={styles.collapseControl}
                testID="passenger-trip-collapse-button"
                accessibilityLabel="passenger-trip-collapse-button"
              >
                <Ionicons name="chevron-down-outline" size={16} color={color.text.secondary} />
                <Text style={styles.collapseControlText}>Voltar ao resumo</Text>
              </TouchableOpacity>
            ) : null}

            {renderPassengerCardStateHeader()}

            <View style={styles.statusRow}>
              <View
                style={styles.statusChip}
                testID="passenger-trip-status-chip"
                accessibilityLabel="passenger-trip-status-chip"
              >
                <Text style={styles.statusChipText}>{formatStatusLabel(normalizedStatus)}</Text>
              </View>
              <Text
                style={styles.arrivalText}
                testID={
                  isStarted
                    ? passengerCardFieldTestIDs.eta_final
                    : "passenger-trip-arrival-label"
                }
                accessibilityLabel={
                  isStarted
                    ? passengerCardFieldTestIDs.eta_final
                    : "passenger-trip-arrival-label"
                }
              >
                {arrivalLabel}
              </Text>
            </View>

            <Text
              style={styles.destinationText}
              testID={passengerCardFieldTestIDs.destination_address}
              accessibilityLabel={passengerCardFieldTestIDs.destination_address}
            >
              {destination}
            </Text>
            {isStarted ? (
              <LeafRouteProgress
                originLabel={pickupPointLabel}
                destinationLabel={destination}
                progress={routeProgress}
                progressKey={liveRouteKey || 'passenger-trip-route'}
                arrivalLabel={arrivalClockLabel || resolvedTripArrivalText || compactEtaValue}
                style={styles.tripRouteProgress}
                testID="passenger-trip-route-progress"
                fieldTestIDs={{
                  progress: passengerCardFieldTestIDs.route_progress,
                }}
              />
            ) : null}
            {resolvedTripArrivalText ? (
              <Text style={styles.driverText}>{resolvedTripArrivalText}</Text>
            ) : null}
            <RobotaxiLifecycleSection title="Motorista e veículo">
              <RobotaxiLifecycleIdentity
                initial={driverInitial}
                photoUri={driverPhotoUri}
                name={driverName}
                meta={driverRatingLabel}
                trailing={plateLabel}
                testID="passenger-trip-expanded-driver-identity"
                fieldTestIDs={{
                  avatar: passengerCardFieldTestIDs.driver_photo,
                  name: passengerCardFieldTestIDs.driver_name,
                  meta: passengerCardFieldTestIDs.driver_rating,
                  trailing: passengerCardFieldTestIDs.vehicle_plate,
                }}
              />
              <Text style={styles.expandedVehicleLine} numberOfLines={1}>
                <Text testID={passengerCardFieldTestIDs.vehicle_model}>{vehicleModel}</Text>
                <Text> · </Text>
                <Text testID={passengerCardFieldTestIDs.vehicle_color}>{vehicleColorLabel}</Text>
              </Text>
            </RobotaxiLifecycleSection>

            <View style={styles.metaRow}>
              <RobotaxiLifecycleMetric
                label="Categoria"
                value={vehicle}
                testID={passengerCardFieldTestIDs.vehicle_type}
              />
              <RobotaxiLifecycleMetric
                label={isStarted ? "Restante" : "Até o embarque"}
                value={distanceLabel}
                testID={
                  isStarted
                    ? passengerCardFieldTestIDs.distance_remaining
                    : passengerCardFieldTestIDs.pickup_distance
                }
              />
              <RobotaxiLifecycleMetric
                label="Valor"
                value={fareLabel}
                testID={passengerCardFieldTestIDs.fare}
              />
            </View>

            {isStarted ? (
              <View style={styles.extensionNotice}>
                <View style={styles.extensionNoticeHeader}>
                  <Ionicons
                    name={extensionStatus === 'confirmed' ? 'checkmark-circle-outline' : 'swap-horizontal-outline'}
                    size={16}
                    color={extensionStatus === 'confirmed' ? '#1A7A3E' : color.text.primary}
                  />
                  <Text style={styles.extensionTitle}>
                    {extensionStatus === 'driver_decision_pending'
                      ? 'Pedido enviado'
                      : extensionStatus === 'pending_payment' || extensionStatus === 'confirming'
                        ? 'Complemento pendente'
                        : extensionStatus === 'expired'
                          ? 'Complemento expirado'
                        : extensionStatus === 'confirmed'
                          ? 'Novo destino confirmado'
                          : extensionStatus === 'rejected'
                            ? 'Alteração não aprovada'
                            : 'Durante a corrida'}
                  </Text>
                </View>
                <Text style={styles.extensionMessage}>
                  {extensionStatus === 'driver_decision_pending'
                    ? rideExtension?.message || 'Seu pedido de novo destino foi enviado ao motorista.'
                    : extensionStatus === 'pending_payment'
                      ? rideExtension?.message || 'O motorista aceitou. Pague o complemento Pix para seguir ao novo destino.'
                      : extensionStatus === 'confirming'
                        ? rideExtension?.message || 'Pagamento confirmado. Atualizando a corrida...'
                        : extensionStatus === 'expired'
                          ? rideExtension?.message || 'O tempo para pagamento do complemento expirou. O destino original foi mantido.'
                        : extensionStatus === 'confirmed'
                          ? `Novo destino: ${rideExtension?.destination?.name || destinationAddress}`
                          : extensionStatus === 'rejected'
                            ? rideExtension?.message || 'O motorista preferiu manter o destino original.'
                            : 'Você pode solicitar um novo destino ou encerrar a corrida no ponto atual.'}
                </Text>
                {extensionStatus === 'pending_payment' && Number(rideExtension?.diffFare) > 0 ? (
                  <>
                    <TouchableOpacity
                      style={styles.extensionPayAction}
                      activeOpacity={0.86}
                      onPress={() => setIsExtensionPaymentVisible(true)}
                    >
                      <Ionicons name="qr-code-outline" size={16} color="#1A7A3E" />
                      <Text style={styles.extensionPayActionText}>
                        Pagar complemento de {formatCurrency(rideExtension?.diffFare)}
                      </Text>
                    </TouchableOpacity>
                    {Number(rideExtension?.extensionOperationalCost) > 0 ? (
                      <Text style={styles.extensionCostDetail}>
                        Inclui novo Pix e recotação de rota: {formatCurrency(rideExtension?.extensionOperationalCost)}
                      </Text>
                    ) : null}
                    <SecurePaymentBadge style={styles.extensionSecurePaymentBadge} />
                  </>
                ) : null}
              </View>
            ) : null}

            {isOperationalDecisionPending ? (
              <View style={[styles.extensionNotice, styles.operationalNotice]}>
                <View style={styles.extensionNoticeHeader}>
                  <Ionicons name="warning-outline" size={16} color="#8A1F2B" />
                  <Text style={styles.extensionTitle}>Seu motorista não consegue continuar</Text>
                </View>
                <Text style={styles.extensionMessage}>
                  {operationalContinuation?.message ||
                    'Você pode continuar com outro parceiro a partir do ponto atual ou encerrar a corrida aqui.'}
                </Text>
                <Text style={styles.operationalContextText}>Ponto atual: {interruptionPickupLabel}</Text>
                <View style={styles.operationalMetaRow}>
                  <Text style={styles.operationalMetaLabel}>
                    Reembolso estimado: {formatCurrency(operationalContinuation?.estimatedRefund)}
                  </Text>
                  <Text style={styles.operationalMetaLabel}>
                    Saldo reservado: {formatCurrency(operationalContinuation?.remainingReservedAmount)}
                  </Text>
                </View>
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={styles.secondaryAction}
                    activeOpacity={0.86}
                    onPress={handleContinueWithOtherDriver}
                    disabled={isBusy}
                    testID="passenger-trip-operational-continue-button"
                    accessibilityLabel="passenger-trip-operational-continue-button"
                  >
                    <Ionicons
                      name="car-outline"
                      size={leafButtonMetrics.iconSize}
                      color={color.text.primary}
                    />
                    <Text style={styles.secondaryActionText}>
                      {isBusy ? 'Processando...' : 'Continuar com outro'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.secondaryAction, styles.warningAction]}
                    activeOpacity={0.86}
                    onPress={handleEndAfterInterruption}
                    disabled={isBusy}
                    testID="passenger-trip-operational-end-button"
                    accessibilityLabel="passenger-trip-operational-end-button"
                  >
                    <Ionicons
                      name="stop-circle-outline"
                      size={leafButtonMetrics.iconSize}
                      color="#8A1F2B"
                    />
                    <Text style={[styles.secondaryActionText, styles.warningActionText]}>
                      {isBusy ? 'Processando...' : 'Encerrar aqui'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            {isOperationalSearching ? (
              <View style={[styles.extensionNotice, styles.operationalNotice]}>
                <View style={styles.extensionNoticeHeader}>
                  <Ionicons name="search-outline" size={16} color="#365A6D" />
                  <Text style={styles.extensionTitle}>Procurando outro motorista</Text>
                </View>
                <Text style={styles.extensionMessage}>
                  {operationalContinuation?.message ||
                    'Já liberamos a continuidade da corrida. Você seguirá com outro parceiro assim que ele aceitar.'}
                </Text>
                <Text style={styles.operationalContextText}>Retomada a partir de: {interruptionPickupLabel}</Text>
              </View>
            ) : null}

            {!isStarted ? (
              <>
                <View style={styles.actionsRow}>
                  <RobotaxiLifecycleButton
                    label="Falar no chat"
                    icon="chatbubble-ellipses-outline"
                    tone="secondary"
                    style={styles.expandedLifecycleAction}
                    onPress={handleOpenPassengerChat}
                    testID="passenger-trip-message-button"
                  />
                  <RobotaxiLifecycleButton
                    label="Segurança"
                    icon="shield-checkmark-outline"
                    tone="safety"
                    style={styles.expandedLifecycleAction}
                    onPress={() => navigation.navigate('RobotaxiPrototypeSupport', passengerSupportContext)}
                    testID="passenger-trip-expanded-safety-button"
                  />
                </View>
                {isAccepted ? (
                  <RobotaxiLifecycleButton
                    label="Compartilhar viagem"
                    icon="share-social-outline"
                    tone="secondary"
                    onPress={handleShareTrip}
                    style={styles.expandedShareAction}
                    testID="passenger-trip-share-button"
                    accessibilityLabel="passenger-trip-share-button"
                  />
                ) : null}
              </>
            ) : null}

            {isStarted ? (
              renderStartedActionDock(styles.startedActionDockExpanded)
            ) : (
              <RobotaxiLifecycleButton
                label="Cancelar corrida"
                icon="close-circle-outline"
                tone="danger"
                style={styles.cancelAction}
                onPress={handleOpenPassengerCancellation}
                testID="passenger-trip-cancel-button"
                accessibilityLabel="passenger-trip-cancel-button"
              />
            )}

              </>
            )}
          </RobotaxiLifecycleCard>
        </PrototypeDismissibleSheet>

        <WooviPaymentModal
          visible={isExtensionPaymentVisible}
          onClose={() => setIsExtensionPaymentVisible(false)}
          onPaymentConfirmed={() => {}}
          prefilledPaymentData={extensionPaymentData}
          preserveChargeOnClose
          paymentTitle="Complemento PIX"
          qaAutoConfirm={qaAutoConfirmPix}
          tripData={{
            pickup: {
              add: currentAddress || 'Origem atual'
            },
            drop: {
              add: rideExtension?.destination?.address || rideExtension?.destination?.name || destinationAddress
            },
            carType: vehicle,
            estimatedFare: Number(rideExtension?.diffFare || 0)
          }}
          estimates={{ estimateFare: Number(rideExtension?.diffFare || 0) }}
          passengerId={profileUid || riderProfile?.uid || riderProfile?.id || ''}
          passengerName={riderProfile?.name || 'Passageira Leaf'}
          passengerEmail={riderProfile?.email || 'passageiro@leaf.app.br'}
          robotaxiLifecycleCard
        />
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent'
  },
  sheetWrap: {
    position: 'absolute',
    left: 24,
    right: 24,
  },
  tripCard: {
    minHeight: 0,
    borderRadius: robotaxiLifecycleMetrics.cardRadius,
  },
  tripSheetScroll: {
    flexGrow: 0
  },
  compactCard: {
    minHeight: 0,
  },
  lifecycleDecisionActions: {
    marginTop: 16,
    gap: 10,
  },
  sheetHandle: {
    width: 50,
    height: 4,
    borderRadius: 3,
    backgroundColor: '#D8D0C7',
    alignSelf: 'center',
    marginBottom: 24
  },
  cardStateHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  cardStateTitle: {
    flex: 1,
    minWidth: 0,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 19,
    lineHeight: 24
  },
  iconActionButton: {
    minWidth: leafButtonMetrics.height,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: 0
  },
  iconOnlyActionButton: {
    flex: 0,
    width: leafButtonMetrics.height,
    minWidth: leafButtonMetrics.height,
    maxWidth: leafButtonMetrics.height,
  },
  tripActionIcon: {
    minWidth: leafButtonMetrics.height,
    minHeight: leafButtonMetrics.height
  },
  tripHeaderIconAction: {
    minWidth: leafButtonMetrics.height,
    minHeight: leafButtonMetrics.height
  },
  iconActionButtonWarning: {
    backgroundColor: leafRideColors.warning,
    borderColor: 'rgba(139,74,18,0.12)'
  },
  iconActionButtonDanger: {
    backgroundColor: leafRideColors.danger,
    borderColor: '#F5CBD2'
  },
  iconActionButtonDisabled: {
    opacity: 0.5
  },
  cardStateDivider: {
    marginTop: 14,
    marginBottom: 16
  },
  leafSheetHeader: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  leafSheetTitle: {
    flex: 1,
    minWidth: 0,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24
  },
  rideHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14,
    marginBottom: 14
  },
  rideHeaderCopy: {
    flex: 1,
    minWidth: 0
  },
  rideKicker: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15
  },
  rideTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25
  },
  rideRight: {
    minWidth: 58,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: leafRideColors.borderStrong,
    backgroundColor: '#FFFFFF',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: 10,
    marginTop: 2
  },
  rideRightValue: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center'
  },
  rideRouteTimeline: {
    marginTop: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(17,22,17,0.08)',
    paddingVertical: 12,
    gap: 12
  },
  rideRouteStep: {
    flexDirection: 'row',
    alignItems: 'flex-start'
  },
  rideRouteTrack: {
    width: 24,
    alignItems: 'center',
    paddingTop: 5,
    marginRight: 12
  },
  rideRouteDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: leafRideColors.text
  },
  rideRouteDotDestination: {
    backgroundColor: leafRideColors.leaf
  },
  rideRouteLine: {
    width: 1,
    height: 34,
    backgroundColor: 'rgba(17,22,17,0.16)',
    marginTop: 6
  },
  rideRouteCopy: {
    flex: 1,
    minWidth: 0
  },
  rideRouteMeta: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14
  },
  rideRouteAddress: {
    marginTop: 2,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18
  },
  compactTitleRow: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 14
  },
  compactTitleRowStarted: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 4
  },
  compactTitleCopy: {
    flex: 1,
    minWidth: 0
  },
  compactTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 19,
    lineHeight: 24
  },
  compactSubtitleStrong: {
    marginTop: 1,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20
  },
  compactRightValue: {
    minWidth: 62,
    marginTop: 8,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 23,
    textAlign: 'right'
  },
  compactRightValueStarted: {
    marginTop: 0,
    minWidth: 0,
    textAlign: 'left'
  },
  sharePillButton: {
    height: 26,
    borderRadius: 13,
    paddingHorizontal: 12,
    borderColor: 'rgba(221,232,225,0.55)'
  },
  sharePillText: {
    color: leafRideColors.blueText,
    fontSize: 10.5,
    lineHeight: 14
  },
  driverIdentity: {
    marginTop: 0
  },
  acceptedIdentity: {
    marginTop: 12
  },
  vehicleColorText: {
    marginTop: 4,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15
  },
  arrivedIdentity: {
    marginTop: 18
  },
  startedIdentity: {
    marginTop: 12
  },
  routeSummaryRow: {
    marginTop: 14,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center'
  },
  routeSummaryCopy: {
    flex: 1,
    minWidth: 0,
    marginLeft: 22
  },
  routeSummaryTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18
  },
  routeSummaryMeta: {
    marginTop: 4,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 14
  },
  firstLeafRow: {
    marginTop: 0
  },
  leafDivider: {
    marginTop: 20,
    marginBottom: 20
  },
  pickupLeafRow: {
    marginTop: 22
  },
  startedShareRow: {
    marginTop: 22
  },
  passengerSecondaryActionsRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10
  },
  compactLifecycleActions: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  compactLifecycleAction: {
    flex: 1,
    minWidth: 0,
  },
  compactLifecycleActionFull: {
    width: '100%',
  },
  compactIdentity: {
    marginTop: 14,
  },
  compactIdentitySection: {
    marginTop: 14,
    paddingTop: 14,
  },
  compactStatusMessage: {
    marginTop: 5,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
  },
  compactDestinationLine: {
    marginTop: 3,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 17,
  },
  compactVehicleLine: {
    marginTop: 7,
    marginLeft: 56,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  passengerSecondaryActionButton: {
    flex: 1,
    minWidth: 0
  },
  headerSafetyAction: {
    minWidth: 82,
  },
  compactMoreOptionsButton: {
    width: '100%',
  },
  passengerPrimaryActionRow: {
    marginTop: 10
  },
  expandedShareAction: {
    marginTop: 10,
    width: '100%',
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
  },
  startedActionDock: {
    minHeight: leafButtonMetrics.height + 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8
  },
  startedActionDockCompact: {
    marginTop: 16
  },
  startedActionDockExpanded: {
    marginTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(91,105,86,0.1)',
    paddingTop: 12
  },
  startedDockAction: {
    backgroundColor: '#FFFFFF'
  },
  compactSafetyButton: {
    flex: 1,
    minWidth: 0,
  },
  compactStartedMoreButton: {
    width: '100%',
  },
  expandedStartedActions: {
    width: '100%',
    gap: 10,
  },
  expandedStartedAction: {
    width: '100%',
  },
  expandedIdentity: {
    marginTop: 14,
  },
  expandedActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  expandedGridAction: {
    flexBasis: '47%',
    flexGrow: 1,
    minWidth: 0,
  },
  expandedGridActionFull: {
    width: '100%',
  },
  expandedLifecycleAction: {
    flex: 1,
    minWidth: 0,
  },
  expandedVehicleLine: {
    marginTop: 7,
    marginLeft: 56,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  acceptedAction: {
    width: 94
  },
  acceptedCall: {
    width: 78
  },
  acceptedPrimary: {
    width: '100%',
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius
  },
  arrivedAction: {
    flex: 1
  },
  arrivedCancel: {
    width: 82
  },
  startedAction: {
    flex: 1,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius
  },
  startedActionWide: {
    flex: 1.2,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius
  },
  startedActionSmall: {
    width: 88,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius
  },
  boardingTimerPanel: {
    marginTop: 12,
    alignItems: 'flex-start',
    paddingVertical: 0
  },
  boardingTimerCompactPanel: {
    marginTop: 2,
    marginBottom: 12,
    alignItems: 'center',
    paddingVertical: 4
  },
  boardingTimerValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 40,
    lineHeight: 46
  },
  boardingTimerMessage: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18
  },
  boardingTimerMessageUrgent: {
    color: leafRideColors.warningText
  },
  boardingTimerMessageExpired: {
    color: leafRideColors.dangerText
  },
  pinLeafRow: {
    marginTop: 18
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  statusChip: {
    minHeight: 26,
    borderRadius: 13,
    paddingHorizontal: 10,
    justifyContent: 'center',
    backgroundColor: color.surface.activeSoft,
    borderWidth: 1,
    borderColor: color.border.strong
  },
  statusChipText: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    letterSpacing: 0.5
  },
  arrivalText: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  destinationText: {
    marginTop: 8,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.subtitle.size,
    lineHeight: typography.subtitle.lineHeight
  },
  driverText: {
    marginTop: 2,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  metaRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 10,
    paddingTop: 2,
    paddingBottom: 2
  },
  metaBlock: {
    flex: 1,
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 5
  },
  metaLabel: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  extensionNotice: {
    marginTop: 12,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary
  },
  extensionNoticeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  extensionTitle: {
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  extensionMessage: {
    marginTop: 6,
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight + 2
  },
  extensionCostDetail: {
    marginTop: 6,
    color: color.text.muted,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight + 2
  },
  extensionPayAction: {
    marginTop: 10,
    minHeight: 40,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(65, 210, 116, 0.12)'
  },
  extensionPayActionText: {
    color: '#1A7A3E',
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  extensionSecurePaymentBadge: {
    marginTop: 6,
    alignSelf: 'center',
  },
  operationalNotice: {
    backgroundColor: '#FFF8F3',
    borderColor: 'rgba(138,31,43,0.12)'
  },
  operationalContextText: {
    marginTop: 8,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight + 2
  },
  operationalMetaRow: {
    marginTop: 8,
    gap: 2
  },
  operationalMetaLabel: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight + 2
  },
  actionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(91,105,86,0.1)',
    paddingTop: 10
  },
  secondaryAction: {
    flex: 1,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: leafButtonMetrics.iconGap
  },
  secondaryActionText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  warningAction: {
    backgroundColor: 'rgba(255,244,245,0.58)'
  },
  warningActionText: {
    color: '#8A1F2B'
  },
  cancelAction: {
    marginTop: 6,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    backgroundColor: 'transparent',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: leafButtonMetrics.iconGap
  },
  cancelActionText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  finishButton: {
    marginTop: 10
  },
  compactSummaryPressable: {
    gap: 10
  },
  compactTitle: {
    marginTop: 0,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25
  },
  tripCompactMetricRow: {
    marginTop: 14
  },
  tripCompactDivider: {
    marginTop: 12,
    marginBottom: 0
  },
  tripCompactInfoRow: {
    marginTop: 10
  },
  tripRouteProgress: {
    marginTop: 10
  },
  tripRouteProgressCompact: {
    marginTop: 4
  },
  startedProgressHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  startedProgressCopy: {
    flex: 1,
    minWidth: 0,
  },
  startedProgressEyebrow: {
    color: leafRideColors.muted,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.7,
  },
  startedProgressDestination: {
    marginTop: 3,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 22,
    lineHeight: 27,
  },
  startedProgressEta: {
    alignItems: 'flex-end',
  },
  startedProgressEtaValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 22,
  },
  startedProgressEtaLabel: {
    marginTop: 2,
    color: leafRideColors.muted,
    fontFamily: fonts.SemiBold,
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.6,
  },
  startedProgressTrack: {
    marginTop: 16,
  },
  startedProgressMetaRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  startedProgressMetaLabel: {
    flex: 1,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  startedProgressMetaValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  tripRouteMeta: {
    marginTop: 8,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16
  },
  tripCompactHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12
  },
  tripCompactTitleCopy: {
    flex: 1,
    minWidth: 0
  },
  tripCompactEyebrow: {
    marginBottom: 2,
    color: leafRideColors.muted,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.7
  },
  acceptedRoutePair: {
    marginTop: 12,
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(207,216,205,0.74)',
    backgroundColor: 'rgba(242,244,239,0.62)',
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12
  },
  acceptedRouteStop: {
    flex: 1,
    minWidth: 0
  },
  acceptedRouteStopRight: {
    alignItems: 'flex-end'
  },
  acceptedRouteDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(102,107,99,0.18)'
  },
  acceptedRouteLabel: {
    color: leafRideColors.muted,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 13,
    textTransform: 'uppercase',
    letterSpacing: 0.6
  },
  acceptedRouteValue: {
    marginTop: 2,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17
  },
  quietCancelAction: {
    marginTop: 10,
    minHeight: 30,
    alignSelf: 'center',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5
  },
  quietCancelText: {
    color: leafRideColors.muted,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16
  },
  compactSubtitle: {
    color: color.text.secondary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight + 2
  },
  compactMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8
  },
  compactMetaChip: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 0,
    minHeight: 34,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  compactMetaChipText: {
    flex: 1,
    minWidth: 0,
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight + 1
  },
  compactMetricRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap'
  },
  compactMetricPill: {
    flexGrow: 1,
    flexBasis: '48%',
    minWidth: 0,
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8
  },
  compactMetricPillAccent: {
    flexBasis: '100%',
    minHeight: 58,
    backgroundColor: '#FFF9EA',
    borderColor: 'rgba(122,93,22,0.12)'
  },
  compactMetricCopy: {
    flex: 1,
    minWidth: 0
  },
  compactMetricLabel: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight,
    textTransform: 'uppercase',
    letterSpacing: 0.7
  },
  compactMetricValue: {
    marginTop: 2,
    color: color.text.primary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  compactActionsRow: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 8
  },
  compactSecondaryAction: {
    flex: 1,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: color.border.subtle,
    backgroundColor: color.surface.secondary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: leafButtonMetrics.iconGap
  },
  compactSecondaryActionText: {
    color: color.text.primary,
    fontFamily: fonts.Medium,
    fontSize: typography.caption.size,
    lineHeight: typography.caption.lineHeight
  },
  compactCancelAction: {
    borderColor: color.border.strong
  },
  collapseControl: {
    alignSelf: 'flex-end',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: color.surface.secondary,
    borderWidth: 1,
    borderColor: color.border.subtle,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4
  },
  collapseControlText: {
    color: color.text.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: typography.micro.size,
    lineHeight: typography.micro.lineHeight
  }
});
