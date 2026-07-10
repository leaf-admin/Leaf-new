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
  LeafButton,
  LeafDivider,
  LeafDriverIdentity,
  LeafRideSheet,
  LeafRouteProgress,
  LeafStateHeader,
  leafButtonMetrics,
  leafRideColors,
} from '../../components/prototype/LeafRideUI';
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
} from './prototypeRouteViewport';
import {
  RIDE_CARD_ROLES,
  RIDE_CARD_STATES,
  createRideCardFieldTestIDs,
  defineRideCardRenderedFields,
} from './rideCardContract';
import useCampaignAssetOverride from '../../hooks/useCampaignAssetOverride';

const { color, typography } = robotaxiPrototypeTokens;
const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 292;
const TRIP_SHEET_MIN_HEIGHT = 332;
const TRIP_SHEET_MAX_HEIGHT_RATIO = 0.66;
const TRIP_SHEET_SCROLL_VERTICAL_CHROME = 32;
const TRIP_MAP_TOP_PADDING = 128;
const TRIP_MAP_SIDE_PADDING = 44;
const TRIP_MAP_BOTTOM_GUTTER = 28;
const TRIP_MAP_MIN_VISIBLE_HEIGHT = 220;
const PASSENGER_ACTIVE_MAP_MIN_OCCLUDED_BOTTOM = 392;
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
  safety_action: 'passenger-trip-sos-button',
  share_trip_action: 'passenger-trip-share-button',
});

const PASSENGER_ARRIVED_FIELD_TEST_ID_OVERRIDES = Object.freeze({
  cancel_action: 'passenger-trip-cancel-button',
  safety_action: 'passenger-trip-sos-button',
});

const PASSENGER_STARTED_FIELD_TEST_ID_OVERRIDES = Object.freeze({
  safety_action: 'passenger-trip-support-button',
  share_trip_action: 'passenger-trip-share-button',
  support_action: 'passenger-trip-support-button',
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

function buildTripSheetMaxHeight({ mapHeight, windowHeight }) {
  const effectiveMapHeight = Math.max(
    1,
    Number(mapHeight) || Number(windowHeight) || 1,
  );
  const visibleRouteLimit = Math.max(
    TRIP_SHEET_MIN_HEIGHT,
    effectiveMapHeight - TRIP_MAP_MIN_VISIBLE_HEIGHT,
  );
  const ratioLimit = Math.max(
    TRIP_SHEET_MIN_HEIGHT,
    Math.round(effectiveMapHeight * TRIP_SHEET_MAX_HEIGHT_RATIO),
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
  const qaAutoConfirmPix = true;
  const safeBottom = Math.max(0, Number(insets.bottom) || 0);
  const sheetBottom = SHEET_BOTTOM_OFFSET;
  const tripSheetMaxHeight = useMemo(
    () => buildTripSheetMaxHeight({
      mapHeight: mapHeight || windowHeight,
      windowHeight,
    }),
    [mapHeight, windowHeight],
  );
  const tripSheetScrollMaxHeight = Math.max(
    1,
    tripSheetMaxHeight - TRIP_SHEET_SCROLL_VERTICAL_CHROME - safeBottom,
  );
  const effectiveCardHeight = Math.min(cardHeight, tripSheetMaxHeight);
  const mapOccludedBottom = sheetBottom + effectiveCardHeight;
  const protectedMapOccludedBottom = Math.max(
    mapOccludedBottom,
    PASSENGER_ACTIVE_MAP_MIN_OCCLUDED_BOTTOM + safeBottom,
  );
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
    route?.params?.driverName,
    driverInfo?.name,
    driverInfo?.driverName,
    driverInfo?.driver?.name,
    fallbackDriverName,
    'Motorista Leaf',
  ) || 'Motorista Leaf';
  const vehicleModel = pickFirstNonEmptyString(
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
    'operational_interrupted',
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
  const operationalStatus = String(operationalContinuation?.status || 'idle').trim().toLowerCase();
  const isOperationalDecisionPending = operationalStatus === 'passenger_decision_pending';
  const isOperationalSearching = operationalStatus === 'searching_replacement_driver';
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
  const tripRouteCoordinates = useMemo(() => {
    const pickupRouteCandidates = [
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
    ];
    const candidateRoutes = isAccepted || isArrived
      ? pickupRouteCandidates
      : destinationRouteCandidates;
    return candidateRoutes
      .map(normalizeRouteCoordinateList)
      .find(coordinates => coordinates.length >= 2) || [];
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
  ]);
  const tripRouteTrafficSegments = useMemo(() => {
    const pickupTrafficCandidates = [
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
    route?.params?.driverToPickupTrafficSegments,
    route?.params?.pickupTrafficSegments,
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
  const startedTripMeta = [
    distanceLabel && distanceLabel !== '--' ? `${distanceLabel} restante` : null,
    fareLabel ? `valor ${fareLabel}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const shouldUseCompactTripCard =
    (isAccepted || isArrived || isStarted) &&
    !isOperationalDecisionPending &&
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
  const driverFirstName = getFirstName(driverName);
  const passengerHeaderTitle = isProtectedStatusWithoutRideIdentity
    ? 'Sincronizando corrida'
    : isStarted
    ? `A caminho de ${destination}`
    : isArrived
      ? `${driverFirstName} chegou`
      : `${driverFirstName} está a caminho`;
  const passengerIslandSubtitle = isProtectedStatusWithoutRideIdentity
    ? 'Validando dados da corrida'
    : isStarted
    ? distanceLabel && distanceLabel !== '--'
      ? `${distanceLabel} restantes`
      : arrivalClockLabel || resolvedTripArrivalText || 'Viagem em andamento'
    : isArrived
      ? pickupPointLabel
      : '';
  const passengerIslandRightLabel = isProtectedStatusWithoutRideIdentity
    ? 'Sync'
    : isStarted
    ? 'Em rota'
    : isArrived
      ? 'No ponto'
      : compactEtaValue;
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

  const renderCompactMoreOptionsButton = (testID) => (
    <IconActionButton
      icon="ellipsis-horizontal"
      label="Mais opções"
      onPress={() => setIsTripExpanded(true)}
      style={styles.passengerSecondaryActionButton}
      testID={testID}
    />
  );

  const renderStartedActionDock = (style, { compact = false } = {}) => (
    <View
      style={[styles.startedActionDock, style]}
      testID="passenger-trip-started-action-dock"
      accessibilityLabel="passenger-trip-started-action-dock"
    >
      <IconActionButton
        icon="shield-checkmark-outline"
        label="SOS"
        tone="warning"
        onPress={() => navigation.navigate('RobotaxiPrototypeSupport', passengerSupportContext)}
        style={styles.startedDockAction}
        testID={passengerCardFieldTestIDs.safety_action}
      />
      <IconActionButton
        icon="chatbubble-ellipses-outline"
        label="Chat"
        onPress={handleOpenPassengerChat}
        style={styles.startedDockAction}
        testID="passenger-trip-message-button"
      />
      {compact ? (
        <IconActionButton
          icon="ellipsis-horizontal"
          label="Mais opções"
          onPress={() => setIsTripExpanded(true)}
          style={styles.startedDockAction}
          testID="passenger-trip-more-actions-button"
        />
      ) : (
        <>
          <IconActionButton
            icon="share-social-outline"
            label="Compartilhar"
            onPress={handleShareTrip}
            style={styles.startedDockAction}
            testID={passengerCardFieldTestIDs.share_trip_action}
          />
          <IconActionButton
            icon="navigate-outline"
            label="Alterar destino"
            onPress={handleOpenExtensionFlow}
            style={styles.startedDockAction}
            testID="passenger-trip-change-destination-button"
          />
          <IconActionButton
            icon="flag-outline"
            label={isBusy ? 'Encerrando...' : 'Encerrar agora'}
            tone="danger"
            onPress={handleEndTripEarly}
            disabled={isBusy}
            style={styles.startedDockAction}
            testID="passenger-trip-end-early-button"
          />
        </>
      )}
    </View>
  );

  const renderPassengerCardStateHeader = () => (
    <>
      <View style={styles.cardStateHeader}>
        <Text style={styles.cardStateTitle} numberOfLines={2}>
          {passengerSheetTitle}
        </Text>
        <IconActionButton
          icon="shield-checkmark-outline"
          label="SOS"
          tone="warning"
          onPress={() => navigation.navigate('RobotaxiPrototypeSupport', passengerSupportContext)}
          testID={passengerCardFieldTestIDs.safety_action}
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
      <LeafButton
        label="Aguardando servidor"
        tone="primary"
        disabled
        style={styles.acceptedPrimary}
        testID="passenger-trip-missing-identity-button"
        accessibilityLabel="passenger-trip-missing-identity-button"
      />
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
      <View style={styles.sheetHandle} />
      <Text
        style={styles.hiddenText}
        testID="passenger-trip-arrival-label"
        accessibilityLabel="passenger-trip-arrival-label"
      >
        {arrivalLabel}
      </Text>
      <View style={styles.rideHeader}>
        <View style={styles.rideHeaderCopy}>
          <Text style={styles.rideTitle} numberOfLines={2}>
            {passengerSheetTitle}
          </Text>
          {passengerSheetKicker ? (
            <Text
              style={styles.rideKicker}
              numberOfLines={1}
              testID={
                isStarted
                  ? passengerCardFieldTestIDs.eta_final
                  : isArrived
                    ? passengerCardFieldTestIDs.pickup_address
                    : passengerCardFieldTestIDs.pickup_eta
              }
            >
              {passengerSheetKicker}
            </Text>
          ) : null}
          {!isStarted && !isArrived ? (
            <Text style={styles.hiddenText}>{`${compactEtaValue} até chegar`}</Text>
          ) : null}
        </View>
        {!isStarted ? (
          <IconActionButton
            icon="shield-checkmark-outline"
            label="SOS"
            tone="warning"
            onPress={() => navigation.navigate('RobotaxiPrototypeSupport', passengerSupportContext)}
            style={styles.tripHeaderIconAction}
            testID={passengerCardFieldTestIDs.safety_action}
          />
        ) : null}
      </View>

      {isStarted ? (
        <>
          <LeafRouteProgress
            originLabel={pickupPointLabel}
            destinationLabel={destination}
            progress={routeProgress}
            progressKey={liveRouteKey || 'passenger-trip-route'}
            arrivalLabel={null}
            style={styles.tripRouteProgressCompact}
            testID="passenger-trip-route-progress"
            fieldTestIDs={{
              destination: passengerCardFieldTestIDs.destination_address,
              progress: passengerCardFieldTestIDs.route_progress,
            }}
          />
          {startedTripMeta ? (
            <Text
              style={styles.tripRouteMeta}
              numberOfLines={1}
              testID={passengerCardFieldTestIDs.distance_remaining}
            >
              {startedTripMeta}
            </Text>
          ) : null}
          <LeafDriverIdentity
            initial={driverInitial}
            photoUri={driverPhotoUri}
            name={driverName}
            rating={driverRatingLabel}
            vehicle={vehicleModel}
            plate={plateLabel}
            style={styles.startedIdentity}
            testID="passenger-trip-driver-identity"
            fieldTestIDs={{
              avatar: passengerCardFieldTestIDs.driver_photo,
              name: passengerCardFieldTestIDs.driver_name,
              meta: passengerCardFieldTestIDs.driver_rating,
              plate: passengerCardFieldTestIDs.vehicle_plate,
              vehicle: passengerCardFieldTestIDs.vehicle_model,
            }}
          />
          <Text
            style={styles.vehicleColorText}
            numberOfLines={1}
            testID={passengerCardFieldTestIDs.vehicle_color}
          >
            {vehicleColorLabel}
          </Text>
          {renderStartedActionDock(styles.startedActionDockCompact, { compact: true })}
        </>
      ) : isArrived ? (
        <>
          <View style={styles.boardingTimerCompactPanel}>
            <Text
              style={styles.boardingTimerValue}
              testID={passengerCardFieldTestIDs.boarding_timer}
            >
              {boardingCountdownLabel || '0:00'}
            </Text>
            <Text
              style={[
                styles.boardingTimerMessage,
                isBoardingTimerUrgent && styles.boardingTimerMessageUrgent,
                isBoardingTimerExpired && styles.boardingTimerMessageExpired,
              ]}
              numberOfLines={1}
              testID={passengerCardFieldTestIDs.boarding_timer_message}
            >
              {boardingTimerMessage}
            </Text>
          </View>
          <LeafDriverIdentity
            initial={driverInitial}
            photoUri={driverPhotoUri}
            name={driverName}
            rating={`${vehicleModel}${vehiclePlate ? ` · ${vehiclePlate}` : ''}`}
            vehicle={vehicleModel}
            plate={plateLabel}
            style={styles.arrivedIdentity}
            testID="passenger-trip-driver-identity"
            fieldTestIDs={{
              avatar: passengerCardFieldTestIDs.driver_photo,
              name: passengerCardFieldTestIDs.driver_name,
              plate: passengerCardFieldTestIDs.vehicle_plate,
              vehicle: passengerCardFieldTestIDs.vehicle_model,
            }}
          />
          <Text
            style={styles.vehicleColorText}
            numberOfLines={1}
            testID={passengerCardFieldTestIDs.vehicle_color}
          >
            {vehicleColorLabel}
          </Text>
          <View
            style={styles.passengerSecondaryActionsRow}
            testID={passengerCardFieldTestIDs.contact_actions}
          >
            <IconActionButton
              icon="chatbubble-ellipses-outline"
              label="Mensagem"
              onPress={handleOpenPassengerChat}
              style={styles.passengerSecondaryActionButton}
              testID="passenger-trip-message-button"
            />
            {renderCompactMoreOptionsButton('passenger-trip-arrived-more-options-button')}
          </View>
        </>
      ) : (
        <>
          <LeafDriverIdentity
            initial={driverInitial}
            photoUri={driverPhotoUri}
            name={driverName}
            rating={driverRatingLabel}
            vehicle={vehicleModel}
            plate={plateLabel}
            style={styles.acceptedIdentity}
            testID="passenger-trip-driver-identity"
            fieldTestIDs={{
              avatar: passengerCardFieldTestIDs.driver_photo,
              name: passengerCardFieldTestIDs.driver_name,
              meta: passengerCardFieldTestIDs.driver_rating,
              plate: passengerCardFieldTestIDs.vehicle_plate,
              vehicle: passengerCardFieldTestIDs.vehicle_model,
            }}
          />
          <Text
            style={styles.vehicleColorText}
            numberOfLines={1}
            testID={passengerCardFieldTestIDs.vehicle_color}
          >
            {vehicleColorLabel}
          </Text>
          <View
            style={styles.rideRouteTimeline}
            accessibilityLabel={`Embarque ${pickupPointLabel}. Destino ${destination}. Valor ${fareLabel}.`}
          >
            <View style={styles.rideRouteStep}>
              <View style={styles.rideRouteTrack}>
                <View style={styles.rideRouteDot} />
                <View style={styles.rideRouteLine} />
              </View>
              <View style={styles.rideRouteCopy}>
                <Text style={styles.rideRouteMeta} numberOfLines={1}>
                  {distanceLabel} até o embarque
                </Text>
                <Text
                  style={styles.rideRouteAddress}
                  numberOfLines={1}
                  testID={passengerCardFieldTestIDs.pickup_address}
                >
                  {pickupPointLabel}
                </Text>
              </View>
            </View>
            <View style={styles.rideRouteStep}>
              <View style={styles.rideRouteTrack}>
                <View style={[styles.rideRouteDot, styles.rideRouteDotDestination]} />
              </View>
              <View style={styles.rideRouteCopy}>
                <Text style={styles.rideRouteMeta} numberOfLines={1}>
                  {vehicle} · {fareLabel}
                </Text>
                <Text
                  style={styles.rideRouteAddress}
                  numberOfLines={1}
                  testID={passengerCardFieldTestIDs.destination_address}
                >
                  {destination}
                </Text>
              </View>
            </View>
          </View>
          <View
            style={styles.passengerSecondaryActionsRow}
            testID={passengerCardFieldTestIDs.contact_actions}
          >
            <IconActionButton
              icon="chatbubble-ellipses-outline"
              label="Mensagem"
              onPress={handleOpenPassengerChat}
              style={styles.passengerSecondaryActionButton}
              testID="passenger-trip-message-button"
            />
            {renderCompactMoreOptionsButton('passenger-trip-accepted-more-options-button')}
          </View>
        </>
      )}
        </>
      )}
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
        <LeafStateHeader
          title={passengerHeaderTitle}
          subtitle={passengerIslandSubtitle}
          rightLabel={passengerIslandRightLabel}
          rightTone={isStarted ? 'dark' : 'leaf'}
          insetsTop={insets.top}
        />
        <PrototypeConnectionStatusPill
          topOffset={insets.top + 76}
          visible={Boolean(rideLocalSyncIndicator)}
          tone={rideLocalSyncIndicator?.tone}
          icon={rideLocalSyncIndicator?.icon}
          title={rideLocalSyncIndicator?.title}
          message={rideLocalSyncIndicator?.message}
          testID="passenger-trip-local-sync-pill"
        />
        <PrototypeConnectionStatusPill
          topOffset={insets.top + (rideLocalSyncIndicator ? 132 : 76)}
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
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <LeafRideSheet
            onLayout={handleCardLayout}
            style={[
              styles.tripCard,
              shouldUseCompactTripCard &&
                !passengerTripSheetExpansionLocked &&
                !isTripExpanded &&
                styles.compactCard,
              {
                maxHeight: tripSheetMaxHeight,
                paddingBottom: 12 + safeBottom,
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
              testID={
                isStarted
                  ? passengerCardFieldTestIDs.destination_address
                  : "passenger-trip-destination-label"
              }
              accessibilityLabel={
                isStarted
                  ? passengerCardFieldTestIDs.destination_address
                  : "passenger-trip-destination-label"
              }
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
            <Text
              style={styles.driverText}
              testID={isStarted ? passengerCardFieldTestIDs.driver_name : undefined}
            >
              {`Motorista: ${driverName}`}
            </Text>
            <Text
              style={styles.driverText}
              testID={isStarted ? passengerCardFieldTestIDs.vehicle_model : undefined}
            >
              {`${vehicleModel}${vehiclePlate ? ` • ${vehiclePlate}` : ''}`}
            </Text>
            {isStarted ? (
              <>
                <Text
                  style={styles.hiddenText}
                  testID={passengerCardFieldTestIDs.driver_photo}
                >
                  {driverPhotoUri || driverInitial}
                </Text>
                <Text
                  style={styles.hiddenText}
                  testID={passengerCardFieldTestIDs.vehicle_plate}
                >
                  {plateLabel}
                </Text>
              </>
            ) : null}

            <View style={styles.metaRow}>
              <View style={styles.metaBlock}>
                <Ionicons name="car-sport-outline" size={15} color={color.text.primary} />
                <Text style={styles.metaLabel}>{vehicle}</Text>
              </View>

              <View style={styles.metaBlock}>
                <Ionicons name="speedometer-outline" size={15} color={color.text.primary} />
                <Text
                  style={styles.metaLabel}
                  testID={isStarted ? passengerCardFieldTestIDs.distance_remaining : undefined}
                >
                  {distanceLabel}
                </Text>
              </View>

              <View style={styles.metaBlock}>
                <Ionicons name="cash-outline" size={15} color={color.text.primary} />
                <Text style={styles.metaLabel}>{fareLabel}</Text>
              </View>
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
                  <TouchableOpacity
                    style={styles.secondaryAction}
                    activeOpacity={0.86}
                    onPress={handleOpenPassengerChat}
                  >
                    <Ionicons
                      name="chatbubble-ellipses-outline"
                      size={leafButtonMetrics.iconSize}
                      color={color.text.primary}
                    />
                    <Text style={styles.secondaryActionText}>Chat</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.secondaryAction}
                    activeOpacity={0.86}
                    onPress={() => navigation.navigate('RobotaxiPrototypeSupport', passengerSupportContext)}
                  >
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={leafButtonMetrics.iconSize}
                      color={color.text.primary}
                    />
                    <Text style={styles.secondaryActionText}>Suporte</Text>
                  </TouchableOpacity>
                </View>
                {isAccepted ? (
                  <LeafButton
                    label="Compartilhar viagem"
                    tone="ghost"
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
              <TouchableOpacity
                style={styles.cancelAction}
                activeOpacity={0.86}
                onPress={handleOpenPassengerCancellation}
                testID="passenger-trip-cancel-button"
                accessibilityLabel="passenger-trip-cancel-button"
              >
                <Ionicons
                  name="close-circle-outline"
                  size={leafButtonMetrics.iconSize}
                  color={color.text.primary}
                />
                <Text style={styles.cancelActionText}>Cancelar corrida</Text>
              </TouchableOpacity>
            )}

              </>
            )}
          </LeafRideSheet>
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
    left: 0,
    right: 0
  },
  tripCard: {
    minHeight: 332,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 14
  },
  tripSheetScroll: {
    flexGrow: 0
  },
  compactCard: {
    minHeight: 332
  },
  sheetHandle: {
    width: 50,
    height: 4,
    borderRadius: 3,
    backgroundColor: '#D8D0C7',
    alignSelf: 'center',
    marginBottom: 24
  },
  hiddenText: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0
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
  rideRightLabel: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'right'
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
  hiddenRouteProgress: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0
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
  passengerSecondaryActionButton: {
    flex: 1,
    minWidth: 0
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
