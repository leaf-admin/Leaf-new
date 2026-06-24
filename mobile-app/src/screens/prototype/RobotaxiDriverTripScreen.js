import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  StatusBar,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import PrototypeConnectionStatusPill from "../../components/prototype/PrototypeConnectionStatusPill";
import PrototypeMapLayer from "../../components/prototype/PrototypeMapLayer";
import {
  LeafAnimatedPressable,
  LeafButton,
  LeafDivider,
  LeafPersonIdentity,
  LeafRideSheet,
  LeafRouteProgress,
  LeafStateHeader,
  leafButtonMetrics,
  leafRideColors,
} from "../../components/prototype/LeafRideUI";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { useLiveRouteTiming } from "./liveRouteTiming";
import { PROTOTYPE_ORIGIN_COORDINATE, PROTOTYPE_REGION } from "./robotaxiPrototypeData";
import {
  buildRouteViewportRegion,
  buildVisibleRouteEdgePadding,
} from "./prototypeRouteViewport";
import {
  RIDE_CARD_ROLES,
  RIDE_CARD_STATES,
  createRideCardFieldTestIDs,
  defineRideCardRenderedFields,
} from "./rideCardContract";
import {
  isTerminalRideStatus,
  normalizeRuntimeRideStatus,
} from "./rideLifecycleContract";
import { getRideLifecycleOrder } from "./rideLifecycleStateGuard";
import { openDriverExternalNavigation } from "../../services/DriverExternalNavigationService";

const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 318;
const DRIVER_TRIP_SHEET_MIN_HEIGHT = 332;
const DRIVER_TRIP_SHEET_MAX_HEIGHT_RATIO = 0.66;
const DRIVER_TRIP_SHEET_SCROLL_VERTICAL_CHROME = 32;
const DRIVER_TRIP_MAP_SIDE_PADDING = 44;
const DRIVER_TRIP_MAP_TOP_PADDING = 118;
const DRIVER_TRIP_MAP_MIN_VISIBLE_HEIGHT = 220;
const DRIVER_TRIP_MIN_OCCLUDED_BOTTOM = 300;
const PROTECTED_DRIVER_TRIP_STATUSES = new Set([
  "accepted",
  "arrived",
  "started",
  "operational_interrupted",
  "searching_replacement",
]);

function buildDriverTripSheetMaxHeight({ mapHeight, windowHeight }) {
  const effectiveMapHeight = Math.max(
    1,
    Number(mapHeight) || Number(windowHeight) || 1,
  );
  const visibleRouteLimit = Math.max(
    DRIVER_TRIP_SHEET_MIN_HEIGHT,
    effectiveMapHeight - DRIVER_TRIP_MAP_MIN_VISIBLE_HEIGHT,
  );
  const ratioLimit = Math.max(
    DRIVER_TRIP_SHEET_MIN_HEIGHT,
    Math.round(effectiveMapHeight * DRIVER_TRIP_SHEET_MAX_HEIGHT_RATIO),
  );

  return Math.max(
    DRIVER_TRIP_SHEET_MIN_HEIGHT,
    Math.min(visibleRouteLimit, ratioLimit),
  );
}
const ACTIONABLE_DRIVER_TRIP_STATUSES = new Set([
  "accepted",
  "arrived",
  "started",
]);
const DRIVER_TRIP_RUNTIME_PRIORITY_STATUSES = new Set([
  "operational_interrupted",
  "searching_replacement",
]);

const DRIVER_TO_PICKUP_RENDERED_CARD_FIELD_IDS = Object.freeze([
  "passenger_name",
  "passenger_photo",
  "pickup_address",
  "pickup_eta",
  "pickup_distance",
  "destination_preview",
  "ride_preferences",
  "navigation_action",
  "contact_actions",
  "arrived_action",
  "cancel_action",
]);

const DRIVER_AT_PICKUP_RENDERED_CARD_FIELD_IDS = Object.freeze([
  "passenger_name",
  "passenger_photo",
  "boarding_pin",
  "boarding_timer",
  "pickup_address",
  "contact_actions",
  "no_show_action",
  "start_trip_action",
]);

const DRIVER_IN_TRIP_RENDERED_CARD_FIELD_IDS = Object.freeze([
  "destination_address",
  "eta_final",
  "distance_remaining",
  "route_progress",
  "net_payout",
  "passenger_name",
  "passenger_photo",
  "contact_actions",
  "navigation_action",
  "report_problem_action",
  "finish_trip_action",
]);

const DRIVER_TO_PICKUP_FIELD_TEST_ID_OVERRIDES = Object.freeze({
  arrived_action: "driver-live-primary-action-arrive-button",
  cancel_action: "driver-trip-cancel-button",
  contact_actions: "driver-trip-chat-button",
  navigation_action: "driver-trip-navigation-button",
});

const DRIVER_AT_PICKUP_FIELD_TEST_ID_OVERRIDES = Object.freeze({
  contact_actions: "driver-trip-chat-button",
  no_show_action: "driver-trip-no-show-button",
  start_trip_action: "driver-live-primary-action-start-button",
});

const DRIVER_IN_TRIP_FIELD_TEST_ID_OVERRIDES = Object.freeze({
  contact_actions: "driver-trip-chat-button",
  finish_trip_action: "driver-live-primary-action-complete-button",
  navigation_action: "driver-trip-navigation-button",
  report_problem_action: "driver-trip-report-button",
});

const DRIVER_TRIP_FIELD_TEST_IDS = Object.freeze({
  accepted: createRideCardFieldTestIDs(
    RIDE_CARD_ROLES.DRIVER,
    RIDE_CARD_STATES.DRIVER_TO_PICKUP,
    DRIVER_TO_PICKUP_RENDERED_CARD_FIELD_IDS,
    DRIVER_TO_PICKUP_FIELD_TEST_ID_OVERRIDES,
  ),
  arrived: createRideCardFieldTestIDs(
    RIDE_CARD_ROLES.DRIVER,
    RIDE_CARD_STATES.DRIVER_AT_PICKUP,
    DRIVER_AT_PICKUP_RENDERED_CARD_FIELD_IDS,
    DRIVER_AT_PICKUP_FIELD_TEST_ID_OVERRIDES,
  ),
  started: createRideCardFieldTestIDs(
    RIDE_CARD_ROLES.DRIVER,
    RIDE_CARD_STATES.DRIVER_IN_TRIP,
    DRIVER_IN_TRIP_RENDERED_CARD_FIELD_IDS,
    DRIVER_IN_TRIP_FIELD_TEST_ID_OVERRIDES,
  ),
});

export const DRIVER_TRIP_RENDERED_CARD_FIELDS = Object.freeze({
  accepted: defineRideCardRenderedFields(
    RIDE_CARD_ROLES.DRIVER,
    RIDE_CARD_STATES.DRIVER_TO_PICKUP,
    DRIVER_TO_PICKUP_RENDERED_CARD_FIELD_IDS,
    { testIDs: DRIVER_TO_PICKUP_FIELD_TEST_ID_OVERRIDES },
  ),
  arrived: defineRideCardRenderedFields(
    RIDE_CARD_ROLES.DRIVER,
    RIDE_CARD_STATES.DRIVER_AT_PICKUP,
    DRIVER_AT_PICKUP_RENDERED_CARD_FIELD_IDS,
    { testIDs: DRIVER_AT_PICKUP_FIELD_TEST_ID_OVERRIDES },
  ),
  started: defineRideCardRenderedFields(
    RIDE_CARD_ROLES.DRIVER,
    RIDE_CARD_STATES.DRIVER_IN_TRIP,
    DRIVER_IN_TRIP_RENDERED_CARD_FIELD_IDS,
    { testIDs: DRIVER_IN_TRIP_FIELD_TEST_ID_OVERRIDES },
  ),
});

function resolveDriverTripPrimaryActionTestID(status) {
  const normalizedStatus = String(status || "")
    .trim()
    .toLowerCase();

  if (normalizedStatus === "accepted") {
    return "driver-live-primary-action-arrive-button";
  }

  if (normalizedStatus === "arrived") {
    return "driver-live-primary-action-start-button";
  }

  if (normalizedStatus === "started") {
    return "driver-live-primary-action-complete-button";
  }

  return "driver-live-primary-action-button";
}

function normalizeDriverStatusError(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function isActivationOrVehicleStatusError(message) {
  const normalized = normalizeDriverStatusError(message);
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("ativar seu status") ||
    normalized.includes("veiculo valido") ||
    normalized.includes("veiculo ativo") ||
    normalized.includes("vehicle_required") ||
    normalized.includes("driver_not_eligible") ||
    normalized.includes("ativacao do motorista pendente") ||
    normalized.includes("verificacao facial") ||
    normalized.includes("liveness") ||
    normalized.includes("kyc") ||
    normalized.includes("ficar online")
  );
}

function formatCurrency(value) {
  return `R$ ${Number(value || 0)
    .toFixed(2)
    .replace(".", ",")}`;
}

function formatDistanceLabel(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "--";
  }

  const fractionDigits = numeric >= 10 ? 0 : numeric >= 2 ? 1 : 2;
  return `${numeric.toFixed(fractionDigits).replace(".", ",")} km`;
}

function formatBoardingTimer(seconds) {
  const normalizedSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(normalizedSeconds / 60)}:${String(normalizedSeconds % 60).padStart(2, "0")}`;
}

function pickDriverTripMoney(...values) {
  const finiteValues = values
    .filter((value) => value !== null && value !== undefined && String(value).trim() !== "")
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  return finiteValues.find((value) => value > 0) ?? finiteValues[0] ?? null;
}

function roundDriverTripMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Number(numeric.toFixed(2));
}

function resolveDriverTripFeeAmount(source = {}) {
  const totalFees = pickDriverTripMoney(
    source?.estimatedTotalFees,
    source?.totalFees,
    source?.retainedFeesInReais,
    source?.fareBreakdown?.estimatedTotalFees,
    source?.fareBreakdown?.totalFees,
    source?.paymentBreakdown?.estimatedTotalFees,
    source?.paymentBreakdown?.totalFees,
    source?.paymentDistribution?.retainedFeesInReais,
  );
  if (totalFees !== null) {
    return totalFees;
  }

  const operationalFee = pickDriverTripMoney(
    source?.estimatedOperationalFee,
    source?.operationalFee,
    source?.fareBreakdown?.estimatedOperationalFee,
    source?.fareBreakdown?.operationalFee,
    source?.paymentBreakdown?.estimatedOperationalFee,
    source?.paymentBreakdown?.operationalFee,
  );
  const paymentIntermediationFee = pickDriverTripMoney(
    source?.estimatedPaymentIntermediationFee,
    source?.paymentIntermediationFee,
    source?.fareBreakdown?.estimatedPaymentIntermediationFee,
    source?.fareBreakdown?.paymentIntermediationFee,
    source?.paymentBreakdown?.estimatedPaymentIntermediationFee,
    source?.paymentBreakdown?.paymentIntermediationFee,
  );

  if (operationalFee !== null || paymentIntermediationFee !== null) {
    return Number(operationalFee || 0) + Number(paymentIntermediationFee || 0);
  }

  return null;
}

function resolveDriverTripGrossAmount(request, driverTripMeta, selectedFare) {
  return pickDriverTripMoney(
    request?.grossFare,
    request?.grossAmount,
    request?.totalAmount,
    request?.finalFare,
    request?.fare,
    request?.amount,
    driverTripMeta?.grossFare,
    driverTripMeta?.grossAmount,
    selectedFare,
  );
}

function resolveDisplayPayoutAmount(request, driverTripMeta, selectedFare) {
  const explicitNetAmount = pickDriverTripMoney(
    request?.estimatedDriverNetAmount,
    request?.driverNetAmount,
    request?.driverNetAmountLocked,
    request?.lockedDriverNetAmount,
    request?.netAmount,
    request?.netAmountInReais,
    request?.driver_share,
    request?.fareBreakdown?.estimatedDriverNetAmount,
    request?.fareBreakdown?.driverNetAmount,
    request?.paymentBreakdown?.estimatedDriverNetAmount,
    request?.paymentBreakdown?.driverNetAmount,
    request?.paymentDistribution?.netAmountInReais,
    driverTripMeta?.estimatedDriverNetAmount,
    driverTripMeta?.driverNetAmount,
    driverTripMeta?.netAmount,
  );
  if (explicitNetAmount !== null) {
    return {
      value: explicitNetAmount,
      label: "líquido",
    };
  }

  const grossAmount = resolveDriverTripGrossAmount(
    request,
    driverTripMeta,
    selectedFare,
  );
  const feeAmount =
    resolveDriverTripFeeAmount(request) ??
    resolveDriverTripFeeAmount(driverTripMeta);
  if (grossAmount !== null && feeAmount !== null) {
    return {
      value: roundDriverTripMoney(Math.max(0, grossAmount - feeAmount)),
      label: "líquido",
    };
  }

  if (grossAmount !== null) {
    return {
      value: grossAmount,
      label: "bruto",
    };
  }

  return {
    value: null,
    label: "valor",
  };
}

function pickCompletedTripReceipt(result) {
  if (!result || typeof result !== "object") {
    return null;
  }

  const candidates = [
    result.receipt,
    result.lastReceipt,
    result.tripReceipt,
    result.data?.receipt,
    result.data?.lastReceipt,
    result.payload?.receipt,
    result.payload?.lastReceipt,
    result.booking?.receipt,
    result.ride?.receipt,
  ];

  return (
    candidates.find(
      (candidate) =>
        candidate &&
        typeof candidate === "object" &&
        String(candidate.id || candidate.bookingId || candidate.rideId || "").trim(),
    ) || null
  );
}

function resolveCompletedTripParticipantId(...values) {
  return (
    values
      .map((value) => String(value || "").trim())
      .find(Boolean) || null
  );
}

function getFirstName(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)[0];
}

function toRouteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeMapCoordinate(value) {
  if (typeof value === "string") {
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

function normalizeRouteCoordinateList(value) {
  if (typeof value === "string") {
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
  if (typeof value === "string") {
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
        level: String(segment?.level || segment?.trafficLevel || "normal").trim() || "normal",
        color: String(segment?.color || "").trim() || undefined,
      };
    })
    .filter(Boolean);
}

function buildFallbackDriverTripRegion(points = []) {
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

  return {
    latitude: (minLatitude + maxLatitude) / 2,
    longitude: (minLongitude + maxLongitude) / 2,
    latitudeDelta: Math.max(0.018, (maxLatitude - minLatitude) * 1.7),
    longitudeDelta: Math.max(0.018, (maxLongitude - minLongitude) * 1.7),
  };
}

function buildDriverTripRequestFromRouteParams(params = {}) {
  if (!params || typeof params !== "object") {
    return null;
  }

  if (params.request && typeof params.request === "object") {
    return params.request;
  }

  if (typeof params.request === "string") {
    try {
      const parsed = JSON.parse(params.request);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (_error) {
      // Continue with scalar deep-link params.
    }
  }

  const bookingId = String(params.bookingId || params.qaBookingId || params.id || "").trim();
  if (!bookingId) {
    return null;
  }

  const driverNetAmount = toRouteNumber(params.driverNetAmount ?? params.estimatedDriverNetAmount, null);
  const fare = toRouteNumber(params.fare ?? params.grossFare ?? params.amount, null);

  return {
    bookingId,
    id: bookingId,
    status: String(params.status || params.qaStatus || "accepted").trim().toLowerCase(),
    passengerName: String(params.passengerName || params.passenger || "Passageiro Leaf").trim(),
    passenger: String(params.passengerName || params.passenger || "Passageiro Leaf").trim(),
    pickupAddress: String(params.pickupAddress || params.pickup || "Embarque indisponível").trim(),
    pickup: String(params.pickupAddress || params.pickup || "Embarque indisponível").trim(),
    dropoffAddress: String(params.dropoffAddress || params.dropoff || "Destino indisponível").trim(),
    dropoff: String(params.dropoffAddress || params.dropoff || "Destino indisponível").trim(),
    ...(fare !== null ? { fare, grossFare: fare } : {}),
    ...(driverNetAmount !== null
      ? {
          driverNetAmount,
          estimatedDriverNetAmount: driverNetAmount,
        }
      : {}),
    distanceKm: toRouteNumber(params.distanceKm, undefined),
    pickupEtaMin: toRouteNumber(params.pickupEtaMin, undefined),
    tripDurationMin: toRouteNumber(params.tripDurationMin, undefined),
    pricingSnapshotLocked: String(params.pricingSnapshotLocked || "true") !== "false",
  };
}

function buildProtectedDriverTripRequest({
  activeBooking,
  activeBookingId,
  bookingStatus,
  currentAddress,
  driverTripMeta,
  selectedDestination,
  selectedFare,
  tripDistanceKm,
  tripDurationMin,
} = {}) {
  const normalizedStatus = normalizeRuntimeRideStatus(bookingStatus);
  if (!PROTECTED_DRIVER_TRIP_STATUSES.has(normalizedStatus)) {
    return null;
  }

  const bookingId = String(
    activeBookingId ||
      activeBooking?.bookingId ||
      activeBooking?.id ||
      activeBooking?.rideId ||
      driverTripMeta?.bookingId ||
      driverTripMeta?.rideId ||
      "",
  ).trim();
  if (!bookingId) {
    return null;
  }

  const pickupAddress = String(
    activeBooking?.pickupAddress ||
      activeBooking?.pickup ||
      driverTripMeta?.pickupAddress ||
      driverTripMeta?.pickup ||
      currentAddress ||
      "Embarque indisponível",
  ).trim();
  const dropoffAddress = String(
    activeBooking?.dropoffAddress ||
      activeBooking?.dropoff ||
      activeBooking?.destinationAddress ||
      activeBooking?.destination ||
      driverTripMeta?.dropoffAddress ||
      driverTripMeta?.destinationAddress ||
      selectedDestination?.name ||
      selectedDestination?.address ||
      "Destino indisponível",
  ).trim();
  const passengerName = String(
    activeBooking?.passengerName ||
      activeBooking?.customerName ||
      activeBooking?.passenger?.name ||
      activeBooking?.customer?.name ||
      driverTripMeta?.passengerName ||
      "Passageiro Leaf",
  ).trim();
  const driverNetAmount = pickDriverTripMoney(
    activeBooking?.estimatedDriverNetAmount,
    activeBooking?.driverNetAmount,
    driverTripMeta?.estimatedDriverNetAmount,
    driverTripMeta?.driverNetAmount,
  );
  const grossFare = pickDriverTripMoney(
    activeBooking?.grossFare,
    activeBooking?.fare,
    activeBooking?.amount,
    driverTripMeta?.grossFare,
    selectedFare,
  );

  return {
    ...(activeBooking && typeof activeBooking === "object" ? activeBooking : {}),
    bookingId,
    id: bookingId,
    status: normalizedStatus,
    passengerName,
    passenger: passengerName,
    pickupAddress,
    pickup: pickupAddress,
    dropoffAddress,
    dropoff: dropoffAddress,
    ...(grossFare !== null ? { fare: grossFare, grossFare } : {}),
    ...(driverNetAmount !== null
      ? {
          driverNetAmount,
          estimatedDriverNetAmount: driverNetAmount,
        }
      : {}),
    distanceKm: tripDistanceKm || activeBooking?.distanceKm || driverTripMeta?.distanceKm,
    tripDistanceKm: tripDistanceKm || activeBooking?.tripDistanceKm || driverTripMeta?.tripDistanceKm,
    tripDurationMin:
      tripDurationMin || activeBooking?.tripDurationMin || driverTripMeta?.tripDurationMin,
    destinationCoordinate:
      activeBooking?.destinationCoordinate ||
      activeBooking?.dropoffCoordinate ||
      driverTripMeta?.destinationCoordinate ||
      selectedDestination?.coordinate ||
      null,
    pickupCoordinate:
      activeBooking?.pickupCoordinate ||
      driverTripMeta?.pickupCoordinate ||
      null,
    pricingSnapshotLocked: true,
    rehydratingFromProtectedState: true,
  };
}

function resolveDriverTripScreenStatus({ requestStatus, runtimeStatus } = {}) {
  const normalizedRequestStatus = normalizeRuntimeRideStatus(requestStatus);
  const normalizedRuntimeStatus = normalizeRuntimeRideStatus(runtimeStatus);

  if (!normalizedRequestStatus) {
    return normalizedRuntimeStatus;
  }
  if (!normalizedRuntimeStatus) {
    return normalizedRequestStatus;
  }
  if (
    isTerminalRideStatus(normalizedRuntimeStatus) ||
    DRIVER_TRIP_RUNTIME_PRIORITY_STATUSES.has(normalizedRuntimeStatus)
  ) {
    return normalizedRuntimeStatus;
  }

  return getRideLifecycleOrder(normalizedRuntimeStatus) >=
    getRideLifecycleOrder(normalizedRequestStatus)
    ? normalizedRuntimeStatus
    : normalizedRequestStatus;
}

function resolveRidePreferenceItems(source = {}) {
  const preferences =
    source?.preferences ||
    source?.ridePreferences ||
    source?.comfortPreferences ||
    {};
  if (!preferences || typeof preferences !== "object") {
    return [];
  }

  const temperatureLabel = String(
    preferences.temperatureLabel ||
      preferences.temperaturePreferenceLabel ||
      preferences.comfort?.temperature?.label ||
      "",
  ).trim();
  const soundLabel = String(
    preferences.soundLabel ||
      preferences.soundPreferenceLabel ||
      preferences.comfort?.sound?.label ||
      "",
  ).trim();

  return [
    temperatureLabel ? { key: "temperature", label: temperatureLabel } : null,
    soundLabel ? { key: "sound", label: soundLabel } : null,
  ].filter(Boolean);
}

function IconActionButton({
  icon,
  label,
  onPress,
  disabled = false,
  tone = "ghost",
  style,
  testID,
}) {
  const isDanger = tone === "danger";
  const isPrimary = tone === "primary";
  const shouldShowLabel = isPrimary;
  return (
    <LeafAnimatedPressable
      activeScale={0.978}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.iconActionButton,
        isDanger && styles.iconActionButtonDanger,
        isPrimary && styles.iconActionButtonPrimary,
        disabled && styles.iconActionButtonDisabled,
        style,
        !shouldShowLabel && styles.iconOnlyActionButton,
      ]}
    >
      <Ionicons
        name={icon}
        size={leafButtonMetrics.iconSize}
        color={isPrimary ? "#FFFFFF" : isDanger ? leafRideColors.dangerText : leafRideColors.leaf}
      />
      {shouldShowLabel ? (
        <Text
          style={[
            styles.iconActionLabel,
            isPrimary && styles.iconActionLabelPrimary,
            isDanger && styles.iconActionLabelDanger,
          ]}
          numberOfLines={1}
        >
          {label}
        </Text>
      ) : null}
    </LeafAnimatedPressable>
  );
}

export default function RobotaxiDriverTripScreen({ navigation, route }) {
  const {
    bookingStatus,
    activeBookingId,
    activeBooking,
    driverActiveRide,
    driverTripMeta,
    selectedDestination,
    selectedFare,
    currentCoordinate,
    currentHeading,
    driverCoordinate,
    currentAddress,
    tripDistanceKm,
    tripDurationMin,
    tripArrivalText,
    boardingRemainingSec,
    operationalContinuation,
    markDriverArrived,
    startTripFlow,
    completeTripFlow,
    rideLocalSync,
    lastError,
  } = usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const mapRef = useRef(null);
  const [mapWidth, setMapWidth] = useState(windowWidth);
  const [mapHeight, setMapHeight] = useState(windowHeight);
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [busyAction, setBusyAction] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const safeBottom = Math.max(0, Number(insets.bottom) || 0);
  const sheetBottom = SHEET_BOTTOM_OFFSET;
  const driverTripSheetMaxHeight = useMemo(
    () => buildDriverTripSheetMaxHeight({
      mapHeight: mapHeight || windowHeight,
      windowHeight,
    }),
    [mapHeight, windowHeight],
  );
  const driverTripSheetScrollMaxHeight = Math.max(
    1,
    driverTripSheetMaxHeight - DRIVER_TRIP_SHEET_SCROLL_VERTICAL_CHROME - safeBottom,
  );

  const directRequest = useMemo(() => {
    if (driverActiveRide?.bookingId || driverActiveRide?.id) {
      return driverActiveRide;
    }

    if (route?.params?.request?.bookingId || route?.params?.request?.id) {
      return route.params.request;
    }

    return buildDriverTripRequestFromRouteParams(route?.params);
  }, [driverActiveRide, route?.params]);
  const protectedRequest = useMemo(
    () =>
      directRequest ||
      buildProtectedDriverTripRequest({
        activeBooking,
        activeBookingId,
        bookingStatus,
        currentAddress,
        driverTripMeta,
        selectedDestination,
        selectedFare,
        tripDistanceKm,
        tripDurationMin,
      }),
    [
      activeBooking,
      activeBookingId,
      bookingStatus,
      currentAddress,
      directRequest,
      driverTripMeta,
      selectedDestination,
      selectedFare,
      tripDistanceKm,
      tripDurationMin,
    ],
  );
  const request = protectedRequest;
  const hasActiveRide = Boolean(request?.bookingId || request?.id);
  const normalizedBookingStatus = resolveDriverTripScreenStatus({
    requestStatus: hasActiveRide ? (request?.status || driverActiveRide?.status) : "",
    runtimeStatus: bookingStatus,
  });
  const isProtectedStatusWithoutRideIdentity =
    !hasActiveRide &&
    PROTECTED_DRIVER_TRIP_STATUSES.has(normalizedBookingStatus);
  const isActiveTripSurface =
    hasActiveRide &&
    ACTIONABLE_DRIVER_TRIP_STATUSES.has(normalizedBookingStatus);
  const isOperationalHoldSurface =
    hasActiveRide &&
    ["operational_interrupted", "searching_replacement"].includes(
      normalizedBookingStatus,
    );
  const isLifecycleNavigationLocked =
    isActiveTripSurface ||
    isOperationalHoldSurface ||
    isProtectedStatusWithoutRideIdentity;
  const isCompactTripSurface = isActiveTripSurface && !detailsExpanded;
  const driverSupportContext = useMemo(() => {
    const bookingId = String(
      request?.bookingId ||
        request?.id ||
        activeBookingId ||
        activeBooking?.bookingId ||
        activeBooking?.id ||
        driverActiveRide?.bookingId ||
        driverActiveRide?.id ||
        route?.params?.bookingId ||
        "",
    ).trim();

    return {
      ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
      bookingStatus: normalizedBookingStatus,
      source: "driver-trip",
    };
  }, [
    activeBooking?.bookingId,
    activeBooking?.id,
    activeBookingId,
    driverActiveRide?.bookingId,
    driverActiveRide?.id,
    normalizedBookingStatus,
    request?.bookingId,
    request?.id,
    route?.params?.bookingId,
  ]);
  const handleOpenDriverChat = useCallback(() => {
    navigation.navigate("RobotaxiPrototypeChat", driverSupportContext);
  }, [driverSupportContext, navigation]);
  const handleOpenDriverCancellation = useCallback(() => {
    navigation.navigate("RobotaxiPrototypeCancellation", driverSupportContext);
  }, [driverSupportContext, navigation]);
  const rideLocalSyncIndicator = useMemo(() => {
    const syncStatus = String(rideLocalSync?.status || "").toLowerCase();
    if (
      !PROTECTED_DRIVER_TRIP_STATUSES.has(normalizedBookingStatus) ||
      !["offline", "pending", "syncing", "error"].includes(syncStatus)
    ) {
      return null;
    }

    if (syncStatus === "offline") {
      return {
        tone: "danger",
        icon: "cloud-offline-outline",
        title: "Sem conexão",
        message:
          rideLocalSync?.message ||
          "Mantendo o último estado confirmado da corrida.",
      };
    }

    if (syncStatus === "syncing") {
      return {
        tone: "warning",
        icon: "sync-outline",
        title: "Sincronizando corrida",
        message:
          rideLocalSync?.message ||
          "Validando o estado da corrida com o servidor.",
      };
    }

    return {
      tone: syncStatus === "error" ? "danger" : "warning",
      icon: "sync-outline",
      title: "Atualização pendente",
      message:
        rideLocalSync?.message ||
        "Aguardando confirmação do servidor para mudar o estado da corrida.",
    };
  }, [normalizedBookingStatus, rideLocalSync]);
  const visibleLastError =
    isLifecycleNavigationLocked && isActivationOrVehicleStatusError(lastError)
      ? ""
      : lastError;
  const pickupLabel =
    String(
      request?.pickup || request?.pickupAddress || currentAddress || "",
    ).trim() || "Embarque indisponível";
  const dropoffLabel =
    String(
      request?.dropoff ||
        request?.dropoffAddress ||
        selectedDestination?.name ||
        "",
    ).trim() || "Destino indisponível";
  const dropoffTitle =
    String(selectedDestination?.name || dropoffLabel.split(",")[0] || dropoffLabel).trim() ||
    dropoffLabel;
  const tripFareDisplay = resolveDisplayPayoutAmount(
    request,
    driverTripMeta,
    selectedFare,
  );
  const tripFareLabel = Number.isFinite(tripFareDisplay.value)
    ? formatCurrency(tripFareDisplay.value)
    : "--";
  const tripFareCaption = tripFareDisplay.label;
  const passengerLabel =
    String(
      request?.passengerName ||
        request?.passenger ||
        request?.customerName ||
        request?.customer?.name ||
        "Passageiro Leaf",
    ).trim() || "Passageiro Leaf";
  const completedDriverReceiptBaseParams = useMemo(() => {
    const bookingId = String(
      request?.bookingId ||
        request?.id ||
        activeBookingId ||
        activeBooking?.bookingId ||
        activeBooking?.id ||
        activeBooking?.rideId ||
        driverActiveRide?.bookingId ||
        driverActiveRide?.id ||
        route?.params?.bookingId ||
        "",
    ).trim();
    const driverId = resolveCompletedTripParticipantId(
      request?.driverId,
      request?.driver?.id,
      activeBooking?.driverId,
      activeBooking?.driver?.id,
      driverActiveRide?.driverId,
      driverActiveRide?.driver?.id,
      route?.params?.driverId,
    );
    const passengerId = resolveCompletedTripParticipantId(
      request?.passengerId,
      request?.customerId,
      request?.passenger?.id,
      request?.customer?.id,
      activeBooking?.passengerId,
      activeBooking?.customerId,
      activeBooking?.passenger?.id,
      activeBooking?.customer?.id,
      driverActiveRide?.passengerId,
      driverActiveRide?.customerId,
      driverActiveRide?.passenger?.id,
      driverActiveRide?.customer?.id,
      route?.params?.passengerId,
      route?.params?.customerId,
    );
    const grossAmount = resolveDriverTripGrossAmount(
      request,
      driverTripMeta,
      selectedFare,
    );

    return {
      fromTrip: true,
      viewerRole: "driver",
      receiptRole: "driver",
      ...(bookingId ? { bookingId, rideId: bookingId, tripId: bookingId } : {}),
      ...(driverId ? { driverId } : {}),
      ...(passengerId ? { passengerId } : {}),
      ...(Number.isFinite(Number(grossAmount)) && Number(grossAmount) > 0
        ? {
            fare: roundDriverTripMoney(grossAmount),
            grossAmount: roundDriverTripMoney(grossAmount),
          }
        : {}),
      pickupAddress: pickupLabel,
      destinationAddress: dropoffLabel,
      passengerName: passengerLabel,
    };
  }, [
    activeBooking?.bookingId,
    activeBooking?.customer?.id,
    activeBooking?.customerId,
    activeBooking?.driver?.id,
    activeBooking?.driverId,
    activeBooking?.id,
    activeBooking?.passenger?.id,
    activeBooking?.passengerId,
    activeBooking?.rideId,
    activeBookingId,
    driverActiveRide?.bookingId,
    driverActiveRide?.customer?.id,
    driverActiveRide?.customerId,
    driverActiveRide?.driver?.id,
    driverActiveRide?.driverId,
    driverActiveRide?.id,
    driverActiveRide?.passenger?.id,
    driverActiveRide?.passengerId,
    driverTripMeta,
    dropoffLabel,
    passengerLabel,
    pickupLabel,
    request,
    route?.params?.bookingId,
    route?.params?.customerId,
    route?.params?.driverId,
    route?.params?.passengerId,
    selectedFare,
  ]);
  const buildCompletedDriverReceiptParams = useCallback(
    (completionResult = null) => {
      const completionReceipt = pickCompletedTripReceipt(completionResult);
      if (!completionReceipt) {
        return completedDriverReceiptBaseParams;
      }

      const receiptBookingId =
        String(
          completionReceipt.bookingId ||
            completionReceipt.rideId ||
            completionReceipt.tripId ||
            completionReceipt.id ||
            completedDriverReceiptBaseParams.bookingId ||
            "",
        ).trim() || null;
      const driverId = resolveCompletedTripParticipantId(
        completionReceipt.driverId,
        completionReceipt.driver?.id,
        completedDriverReceiptBaseParams.driverId,
      );
      const passengerId = resolveCompletedTripParticipantId(
        completionReceipt.passengerId,
        completionReceipt.customerId,
        completionReceipt.passenger?.id,
        completionReceipt.customer?.id,
        completedDriverReceiptBaseParams.passengerId,
      );

      return {
        ...completedDriverReceiptBaseParams,
        ...(receiptBookingId
          ? { bookingId: receiptBookingId, rideId: receiptBookingId, tripId: receiptBookingId }
          : {}),
        receipt: {
          ...completionReceipt,
          viewerRole: "driver",
          receiptRole: "driver",
          ...(receiptBookingId ? { id: completionReceipt.id || receiptBookingId } : {}),
          ...(driverId ? { driverId } : {}),
          ...(passengerId ? { passengerId } : {}),
        },
        viewerRole: "driver",
        receiptRole: "driver",
        ...(driverId ? { driverId } : {}),
        ...(passengerId ? { passengerId } : {}),
      };
    },
    [completedDriverReceiptBaseParams],
  );
  const passengerFirstName = getFirstName(passengerLabel) || "Passageiro";
  const passengerInitial =
    passengerFirstName.trim().charAt(0).toUpperCase() || "P";
  const passengerPhotoUri =
    String(
      request?.passengerPhoto ||
        request?.passenger?.photo ||
        request?.passenger?.photoURL ||
        request?.customerPhoto ||
        request?.customer?.photo ||
        request?.customer?.profileImage ||
        driverTripMeta?.passengerPhoto ||
        route?.params?.passengerPhoto ||
        "",
    ).trim() || null;
  const ridePreferenceItems = resolveRidePreferenceItems(request);
  const ridePreferenceSummary = ridePreferenceItems.length > 0
    ? ridePreferenceItems.map(item => item.label).join(" · ")
    : "Preferências padrão";
  const driverMapCoordinate =
    normalizeMapCoordinate(route?.params?.driverCoordinate) ||
    normalizeMapCoordinate(request?.driverCoordinate) ||
    normalizeMapCoordinate(request?.driverLocation) ||
    normalizeMapCoordinate(driverActiveRide?.driverCoordinate) ||
    normalizeMapCoordinate(driverActiveRide?.driverLocation) ||
    normalizeMapCoordinate(driverTripMeta?.driverCoordinate) ||
    normalizeMapCoordinate(driverCoordinate) ||
    normalizeMapCoordinate(currentCoordinate) ||
    PROTOTYPE_ORIGIN_COORDINATE;
  const pickupCoordinate =
    normalizeMapCoordinate(route?.params?.pickupCoordinate) ||
    normalizeMapCoordinate(request?.pickupCoordinate) ||
    normalizeMapCoordinate(request?.pickupLocation) ||
    normalizeMapCoordinate(request?.originCoordinate) ||
    normalizeMapCoordinate(request?.originLocation) ||
    normalizeMapCoordinate(activeBooking?.pickupCoordinate) ||
    normalizeMapCoordinate(activeBooking?.pickupLocation) ||
    normalizeMapCoordinate(driverActiveRide?.pickupCoordinate) ||
    normalizeMapCoordinate(driverActiveRide?.pickupLocation) ||
    normalizeMapCoordinate(driverTripMeta?.pickupCoordinate) ||
    driverMapCoordinate;
  const dropoffCoordinate =
    normalizeMapCoordinate(route?.params?.destinationCoordinate) ||
    normalizeMapCoordinate(route?.params?.dropoffCoordinate) ||
    normalizeMapCoordinate(request?.destinationCoordinate) ||
    normalizeMapCoordinate(request?.destinationLocation) ||
    normalizeMapCoordinate(request?.dropoffCoordinate) ||
    normalizeMapCoordinate(request?.dropoffLocation) ||
    normalizeMapCoordinate(activeBooking?.destinationCoordinate) ||
    normalizeMapCoordinate(activeBooking?.destinationLocation) ||
    normalizeMapCoordinate(activeBooking?.dropoffCoordinate) ||
    normalizeMapCoordinate(activeBooking?.dropoffLocation) ||
    normalizeMapCoordinate(driverActiveRide?.destinationCoordinate) ||
    normalizeMapCoordinate(driverActiveRide?.destinationLocation) ||
    normalizeMapCoordinate(driverActiveRide?.dropoffCoordinate) ||
    normalizeMapCoordinate(driverActiveRide?.dropoffLocation) ||
    normalizeMapCoordinate(driverTripMeta?.destinationCoordinate) ||
    normalizeMapCoordinate(driverTripMeta?.dropoffCoordinate) ||
    normalizeMapCoordinate(selectedDestination?.coordinate) ||
    null;
  const driverTripRouteCoordinates = useMemo(() => {
    const pickupRouteCandidates = [
      route?.params?.driverToPickupRouteCoordinates,
      route?.params?.pickupRouteCoordinates,
      request?.driverToPickupRouteCoordinates,
      request?.pickupRouteCoordinates,
      request?.routePlan?.pickupCoordinates,
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
      route?.params?.routeCoordinates,
      route?.params?.destinationRouteCoordinates,
      request?.routeCoordinates,
      request?.destinationRouteCoordinates,
      request?.routePlan?.destinationCoordinates,
      activeBooking?.routeCoordinates,
      activeBooking?.destinationRouteCoordinates,
      activeBooking?.routePlan?.destinationCoordinates,
      activeBooking?.driverTripMeta?.routePlan?.destinationCoordinates,
      driverActiveRide?.routeCoordinates,
      driverActiveRide?.destinationRouteCoordinates,
      driverActiveRide?.routePlan?.destinationCoordinates,
      driverActiveRide?.driverTripMeta?.routePlan?.destinationCoordinates,
      driverTripMeta?.routePlan?.destinationCoordinates,
    ];
    const candidateRoutes =
      normalizedBookingStatus === "accepted" || normalizedBookingStatus === "arrived"
        ? pickupRouteCandidates
        : destinationRouteCandidates;

    return candidateRoutes
      .map(normalizeRouteCoordinateList)
      .find(coordinates => coordinates.length >= 2) || [];
  }, [
    activeBooking?.destinationRouteCoordinates,
    activeBooking?.driverToPickupRouteCoordinates,
    activeBooking?.pickupRouteCoordinates,
    activeBooking?.routeCoordinates,
    activeBooking?.driverTripMeta?.routePlan?.destinationCoordinates,
    activeBooking?.driverTripMeta?.routePlan?.pickupCoordinates,
    activeBooking?.routePlan?.destinationCoordinates,
    activeBooking?.routePlan?.pickupCoordinates,
    driverActiveRide?.destinationRouteCoordinates,
    driverActiveRide?.driverToPickupRouteCoordinates,
    driverActiveRide?.pickupRouteCoordinates,
    driverActiveRide?.routeCoordinates,
    driverActiveRide?.driverTripMeta?.routePlan?.destinationCoordinates,
    driverActiveRide?.driverTripMeta?.routePlan?.pickupCoordinates,
    driverActiveRide?.routePlan?.destinationCoordinates,
    driverActiveRide?.routePlan?.pickupCoordinates,
    driverTripMeta?.routePlan?.destinationCoordinates,
    driverTripMeta?.routePlan?.pickupCoordinates,
    normalizedBookingStatus,
    request?.destinationRouteCoordinates,
    request?.driverToPickupRouteCoordinates,
    request?.pickupRouteCoordinates,
    request?.routeCoordinates,
    request?.routePlan?.destinationCoordinates,
    request?.routePlan?.pickupCoordinates,
    route?.params?.destinationRouteCoordinates,
    route?.params?.driverToPickupRouteCoordinates,
    route?.params?.pickupRouteCoordinates,
    route?.params?.routeCoordinates,
  ]);
  const driverTripTrafficSegments = useMemo(() => {
    const pickupTrafficCandidates = [
      route?.params?.driverToPickupTrafficSegments,
      route?.params?.pickupTrafficSegments,
      request?.driverToPickupTrafficSegments,
      request?.pickupTrafficSegments,
      request?.routePlan?.pickupTrafficSegments,
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
      route?.params?.routeTrafficSegments,
      route?.params?.destinationTrafficSegments,
      request?.routeTrafficSegments,
      request?.destinationTrafficSegments,
      request?.routePlan?.destinationTrafficSegments,
      activeBooking?.routeTrafficSegments,
      activeBooking?.destinationTrafficSegments,
      activeBooking?.routePlan?.destinationTrafficSegments,
      activeBooking?.driverTripMeta?.routePlan?.destinationTrafficSegments,
      driverActiveRide?.routeTrafficSegments,
      driverActiveRide?.destinationTrafficSegments,
      driverActiveRide?.routePlan?.destinationTrafficSegments,
      driverActiveRide?.driverTripMeta?.routePlan?.destinationTrafficSegments,
      driverTripMeta?.routePlan?.destinationTrafficSegments,
    ];
    const candidateSegments =
      normalizedBookingStatus === "accepted" || normalizedBookingStatus === "arrived"
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
    activeBooking?.driverTripMeta?.routePlan?.destinationTrafficSegments,
    activeBooking?.driverTripMeta?.routePlan?.pickupTrafficSegments,
    activeBooking?.routePlan?.destinationTrafficSegments,
    activeBooking?.routePlan?.pickupTrafficSegments,
    driverActiveRide?.destinationTrafficSegments,
    driverActiveRide?.driverToPickupTrafficSegments,
    driverActiveRide?.pickupTrafficSegments,
    driverActiveRide?.routeTrafficSegments,
    driverActiveRide?.driverTripMeta?.routePlan?.destinationTrafficSegments,
    driverActiveRide?.driverTripMeta?.routePlan?.pickupTrafficSegments,
    driverActiveRide?.routePlan?.destinationTrafficSegments,
    driverActiveRide?.routePlan?.pickupTrafficSegments,
    driverTripMeta?.routePlan?.destinationTrafficSegments,
    driverTripMeta?.routePlan?.pickupTrafficSegments,
    normalizedBookingStatus,
    request?.destinationTrafficSegments,
    request?.driverToPickupTrafficSegments,
    request?.pickupTrafficSegments,
    request?.routeTrafficSegments,
    request?.routePlan?.destinationTrafficSegments,
    request?.routePlan?.pickupTrafficSegments,
    route?.params?.destinationTrafficSegments,
    route?.params?.driverToPickupTrafficSegments,
    route?.params?.pickupTrafficSegments,
    route?.params?.routeTrafficSegments,
  ]);
  const driverTripMapOcclusion = useMemo(
    () => ({
      top: 0,
      bottom: Math.max(
        sheetBottom + Math.min(cardHeight, driverTripSheetMaxHeight),
        DRIVER_TRIP_MIN_OCCLUDED_BOTTOM + safeBottom,
      ),
    }),
    [cardHeight, driverTripSheetMaxHeight, safeBottom, sheetBottom],
  );
  const driverTripViewportPadding = useMemo(
    () => buildVisibleRouteEdgePadding({
      mapHeight: mapHeight || windowHeight,
      activeOcclusion: driverTripMapOcclusion,
      insets,
      sidePadding: DRIVER_TRIP_MAP_SIDE_PADDING,
      topExtraPadding: 30,
      bottomExtraPadding: 28,
      minVisibleHeight: DRIVER_TRIP_MAP_MIN_VISIBLE_HEIGHT,
      topPaddingMin: insets.top + DRIVER_TRIP_MAP_TOP_PADDING,
      overlayBiasRatio: 0.26,
    }),
    [
      driverTripMapOcclusion,
      insets,
      insets.top,
      mapHeight,
      windowHeight,
    ],
  );
  const driverTripVisibleRouteRegion = useMemo(
    () => buildRouteViewportRegion({
      coordinates: driverTripRouteCoordinates,
      mapWidth: mapWidth || windowWidth,
      mapHeight: mapHeight || windowHeight,
      activeOcclusion: driverTripMapOcclusion,
      insets,
      viewportPadding: driverTripViewportPadding,
      minVisibleHeight: DRIVER_TRIP_MAP_MIN_VISIBLE_HEIGHT,
    }),
    [
      driverTripMapOcclusion,
      driverTripRouteCoordinates,
      driverTripViewportPadding,
      insets,
      mapHeight,
      mapWidth,
      windowHeight,
      windowWidth,
    ],
  );
  const driverTripMapRegion = useMemo(() => (
    driverTripVisibleRouteRegion || buildFallbackDriverTripRegion([
      driverMapCoordinate,
      pickupCoordinate,
      dropoffCoordinate,
      ...driverTripRouteCoordinates,
    ])
  ), [
    driverMapCoordinate,
    driverTripRouteCoordinates,
    driverTripVisibleRouteRegion,
    dropoffCoordinate,
    pickupCoordinate,
  ]);
  const driverTripRouteOriginCoordinate =
    driverTripRouteCoordinates[0] ||
    (normalizedBookingStatus === "started" ? pickupCoordinate : driverMapCoordinate);
  const driverTripRouteDestinationCoordinate =
    normalizedBookingStatus === "started"
      ? dropoffCoordinate || driverTripRouteCoordinates[driverTripRouteCoordinates.length - 1]
      : pickupCoordinate;
  const navigationPhase =
    normalizedBookingStatus === "started" ? "destination" : "pickup";
  const navigationTargetCoordinate =
    navigationPhase === "destination" ? dropoffCoordinate : pickupCoordinate;
  const navigationTargetLabel =
    navigationPhase === "destination" ? dropoffLabel : pickupLabel;
  const driverMapHeading =
    currentHeading ??
    driverCoordinate?.heading ??
    driverCoordinate?.bearing ??
    driverCoordinate?.course ??
    request?.driverHeading ??
    request?.driverLocation?.heading ??
    null;
  const etaMin = Math.max(2, Number(tripDurationMin || request?.pickupEtaMin || 4));
  const effectiveDistanceKm =
    Number.isFinite(Number(tripDistanceKm)) && Number(tripDistanceKm) > 0
      ? Number(tripDistanceKm)
      : normalizedBookingStatus === "accepted" || normalizedBookingStatus === "arrived"
        ? request?.pickupDistanceKm || request?.distanceKm || request?.tripDistanceKm
        : request?.tripDistanceKm || request?.distanceKm;
  const distanceLabel = formatDistanceLabel(effectiveDistanceKm);
  const routeTotalMinutes =
    request?.initialTripDurationMin ||
    request?.estimatedTotalDurationMin ||
    request?.totalDurationMin ||
    driverTripMeta?.initialEtaMinutes;
  const routeStartedAt =
    request?.startedAt ||
    request?.tripStartedAt ||
    driverActiveRide?.startedAt ||
    driverActiveRide?.tripStartedAt;
  const liveRouteKey = [
    request?.bookingId,
    request?.id,
    normalizedBookingStatus,
    routeStartedAt,
    pickupLabel,
    dropoffTitle,
  ]
    .filter(Boolean)
    .join(":");
  const {
    routeProgress,
    arrivalClockLabel,
    displayEtaMinutes,
  } = useLiveRouteTiming({
    routeKey: liveRouteKey || "driver-trip-route",
    remainingMinutes: etaMin,
    totalMinutes: routeTotalMinutes,
    startedAt: routeStartedAt,
    active: normalizedBookingStatus === "started",
  });
  const etaLabel =
    Number.isFinite(displayEtaMinutes) && displayEtaMinutes > 0
      ? `${displayEtaMinutes} min`
      : `${etaMin} min`;
  const driverArrivalSummary = arrivalClockLabel || `chegada ${etaLabel}`;
  const driverStartedSummary = [
    distanceLabel && distanceLabel !== "--" ? `${distanceLabel} restante` : null,
    driverArrivalSummary,
  ]
    .filter(Boolean)
    .join(" · ");
  const boardingPin =
    String(
      request?.boardingPin ||
        request?.boardingCode ||
        request?.pin ||
        route?.params?.boardingPin ||
        "",
    ).trim() || "4821";
  const rawBoardingSeconds = Number(boardingRemainingSec);
  const boardingTimerSeconds = Number.isFinite(rawBoardingSeconds)
    ? Math.max(0, Math.round(rawBoardingSeconds))
    : normalizedBookingStatus === "arrived"
      ? 120
      : null;
  const boardingCountdownLabel =
    boardingTimerSeconds === null ? null : formatBoardingTimer(boardingTimerSeconds);
  const boardingTimerMessage =
    boardingTimerSeconds === null || boardingTimerSeconds > 30
      ? "Inicie quando estiver tudo certo"
      : boardingTimerSeconds > 0
        ? "Embarque urgente"
        : "Uma taxa poderá ser aplicada";
  const isBoardingTimerUrgent =
    boardingTimerSeconds !== null && boardingTimerSeconds > 0 && boardingTimerSeconds <= 30;
  const isBoardingTimerExpired = boardingTimerSeconds === 0;
  const primaryActionTestID =
    resolveDriverTripPrimaryActionTestID(normalizedBookingStatus);
  const driverCardFieldTestIDs = normalizedBookingStatus === "started"
    ? DRIVER_TRIP_FIELD_TEST_IDS.started
    : normalizedBookingStatus === "arrived"
      ? DRIVER_TRIP_FIELD_TEST_IDS.arrived
      : DRIVER_TRIP_FIELD_TEST_IDS.accepted;
  const primaryLabel = busyAction
    ? "Atualizando..."
    : normalizedBookingStatus === "accepted"
      ? "Cheguei"
      : normalizedBookingStatus === "arrived"
        ? "Iniciar"
        : normalizedBookingStatus === "started"
          ? "Finalizar"
          : "Voltar";
  const headerCopy = useMemo(() => {
    if (!hasActiveRide) {
      return {
        title: "Sem corrida ativa",
        subtitle: "Volte ao painel para receber novas solicitações.",
        right: null,
        rightTone: "leaf",
      };
    }

    if (normalizedBookingStatus === "accepted") {
      return {
        title: "Indo buscar",
        subtitle: "Siga até o ponto e confirme quando chegar.",
        right: "Rota",
        rightTone: "blue",
      };
    }

    if (normalizedBookingStatus === "arrived") {
      return {
        title: "No ponto de encontro",
        subtitle: "Confirme o código e inicie a viagem.",
        right: "Ajuda",
        rightTone: "leaf",
      };
    }

    if (normalizedBookingStatus === "started") {
      return {
        title: `A caminho de ${dropoffTitle}`,
        subtitle: "Destino, rota e ações críticas sempre visíveis.",
        right: "SOS",
        rightTone: "warning",
      };
    }

    return {
      title: "Corrida em atualização",
      subtitle: "Sincronizando estado atual da viagem.",
      right: null,
      rightTone: "leaf",
    };
  }, [dropoffTitle, hasActiveRide, normalizedBookingStatus]);
  const driverSheetTitle = !hasActiveRide
    ? "Sem corrida ativa"
    : normalizedBookingStatus === "started"
      ? "Progresso da viagem"
      : normalizedBookingStatus === "arrived"
        ? "Confirmar embarque"
        : normalizedBookingStatus === "accepted"
          ? "Ponto de embarque"
          : "Detalhes da corrida";
  const driverIslandSubtitle = normalizedBookingStatus === "started"
    ? `${distanceLabel} restantes`
    : normalizedBookingStatus === "arrived"
      ? pickupLabel
      : headerCopy.subtitle;
  const driverIslandRightLabel = normalizedBookingStatus === "started"
    ? "Em rota"
    : normalizedBookingStatus === "arrived"
      ? boardingCountdownLabel || "Embarque"
      : headerCopy.right;
  const compactTripTitle = normalizedBookingStatus === "started"
    ? `A caminho de ${dropoffTitle}`
    : normalizedBookingStatus === "arrived"
      ? "Confirmar embarque"
      : normalizedBookingStatus === "accepted"
        ? "Indo buscar"
        : driverSheetTitle;
  const compactTripMetaLabel = normalizedBookingStatus === "started"
    ? "restante"
    : normalizedBookingStatus === "arrived"
      ? "embarque"
      : "até o embarque";
  const compactTripEtaLabel = normalizedBookingStatus === "arrived"
    ? boardingCountdownLabel || "--"
    : etaLabel;
  const compactTripEtaCaption = normalizedBookingStatus === "arrived"
    ? "tempo grátis"
    : normalizedBookingStatus === "started"
      ? "ETA final"
      : "até chegar";

  useEffect(() => {
    if (normalizedBookingStatus === "completed") {
      const completedDriverReceiptParams = buildCompletedDriverReceiptParams();
      if (typeof navigation.replace === "function") {
        navigation.replace("RobotaxiPrototypeReceipt", completedDriverReceiptParams);
        return;
      }

      navigation.navigate("RobotaxiPrototypeReceipt", completedDriverReceiptParams);
    }
  }, [buildCompletedDriverReceiptParams, navigation, normalizedBookingStatus]);

  useEffect(() => {
    setDetailsExpanded(false);
  }, [request?.bookingId, request?.id, normalizedBookingStatus]);

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-driver-trip",
    occludedBottom: driverTripMapOcclusion.bottom,
  });

  const handleDismiss = () => {
    if (isLifecycleNavigationLocked) {
      return;
    }

    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("RobotaxiPrototype");
  };

  useEffect(() => {
    if (
      !isLifecycleNavigationLocked ||
      typeof navigation?.addListener !== "function"
    ) {
      return undefined;
    }

    // Hardware back and restored navigation actions do not pass through the
    // bottom sheet. A live driver ride must stay on its canonical surface.
    const unsubscribe = navigation.addListener("beforeRemove", event => {
      event?.preventDefault?.();
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [isLifecycleNavigationLocked, navigation]);

  const handleCardLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      const boundedHeight = Math.min(nextHeight, driverTripSheetMaxHeight);
      setCardHeight(previous => (previous === boundedHeight ? previous : boundedHeight));
    }
  }, [driverTripSheetMaxHeight]);
  const handleMapLayout = useCallback((event) => {
    const nextWidth = event?.nativeEvent?.layout?.width;
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextWidth) && nextWidth > 0) {
      setMapWidth(previous => (previous === nextWidth ? previous : nextWidth));
    }
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setMapHeight(previous => (previous === nextHeight ? previous : nextHeight));
    }
  }, []);

  const handlePrimaryAction = useCallback(async () => {
    if (busyAction) {
      return;
    }

    if (!hasActiveRide) {
      if (isProtectedStatusWithoutRideIdentity) {
        Alert.alert(
          "Sincronizando corrida",
          "Aguarde a identificação canônica da corrida antes de executar ações.",
        );
        return;
      }

      navigation.navigate("RobotaxiPrototype");
      return;
    }

    try {
      setBusyAction(true);

      if (normalizedBookingStatus === "accepted") {
        await markDriverArrived();
        return;
      }

      if (normalizedBookingStatus === "arrived") {
        await startTripFlow();
        return;
      }

      if (normalizedBookingStatus === "started") {
        const completionResult = await completeTripFlow();
        const completedDriverReceiptParams =
          buildCompletedDriverReceiptParams(completionResult);
        navigation.navigate("RobotaxiPrototypeReceipt", completedDriverReceiptParams);
        return;
      }

      navigation.navigate("RobotaxiPrototype");
    } catch (error) {
      Alert.alert(
        "Não foi possível atualizar",
        error?.message || "Falha ao atualizar corrida.",
      );
    } finally {
      setBusyAction(false);
    }
  }, [
    busyAction,
    buildCompletedDriverReceiptParams,
    completeTripFlow,
    hasActiveRide,
    isProtectedStatusWithoutRideIdentity,
    markDriverArrived,
    navigation,
    normalizedBookingStatus,
    startTripFlow,
  ]);

  const handleOpenNavigation = useCallback(async () => {
    if (!hasActiveRide) {
      Alert.alert(
        "Nenhuma corrida ativa",
        "Receba uma nova solicitação antes de abrir a navegação.",
      );
      return;
    }

    try {
      await openDriverExternalNavigation({
        coordinate: navigationTargetCoordinate,
        destinationLabel: navigationTargetLabel,
        phase: navigationPhase,
      });
    } catch (error) {
      Alert.alert(
        "Não foi possível abrir a navegação",
        error?.message || "Tente novamente.",
      );
    }
  }, [
    hasActiveRide,
    navigationPhase,
    navigationTargetCoordinate,
    navigationTargetLabel,
  ]);

  const handleCallPassenger = useCallback(() => {
    Alert.alert(
      "Ligação pelo app",
      "A chamada direta ainda depende do telefone mascarado do passageiro.",
    );
  }, []);

  const handleNoShow = useCallback(() => {
    Alert.alert(
      "No-show pendente",
      "O design já prevê a ação, mas a confirmação de no-show ainda precisa ser ligada ao runtime principal.",
    );
  }, []);

  const renderCardStateHeader = (rightContent = null) => (
    <>
      <View style={styles.cardStateHeader}>
        <View style={styles.cardStateCopy}>
          <Text style={styles.cardStateTitle} numberOfLines={2}>
            {driverSheetTitle}
          </Text>
        </View>
        {rightContent}
      </View>
      <LeafDivider style={styles.cardStateDivider} />
    </>
  );

  const renderPayoutBlock = () => (
    <View style={styles.driverPayout}>
      <Text style={styles.driverPayoutValue} numberOfLines={1}>
        {tripFareLabel}
      </Text>
      <Text style={styles.driverPayoutLabel} numberOfLines={1}>
        {tripFareCaption}
      </Text>
    </View>
  );

  const renderCompactMetric = (value, label, valueStyle = null, testID = undefined) => (
    <View style={styles.compactMetric}>
      <Text
        style={[styles.compactMetricValue, valueStyle]}
        numberOfLines={1}
        testID={testID}
      >
        {value}
      </Text>
      <Text style={styles.compactMetricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );

  const renderCompactTripDetails = () => {
    if (!detailsExpanded) {
      return null;
    }

    if (normalizedBookingStatus === "started") {
      return null;
    }

    if (normalizedBookingStatus === "accepted") {
      return (
        <>
          <LeafDivider style={styles.compactDetailsDivider} />
          <View style={styles.driverRouteTimeline}>
            <View style={styles.driverRouteStep}>
              <View style={styles.driverRouteTrack}>
                <View style={styles.driverRouteDot} />
                <View style={styles.driverRouteLine} />
              </View>
              <View style={styles.driverRouteCopy}>
                <Text style={styles.driverRouteMeta} numberOfLines={1}>
                  Embarque
                </Text>
                <Text style={styles.driverRouteAddress} numberOfLines={1}>
                  {pickupLabel}
                </Text>
              </View>
            </View>
            <View style={styles.driverRouteStep}>
              <View style={styles.driverRouteTrack}>
                <View style={[styles.driverRouteDot, styles.driverRouteDotDestination]} />
              </View>
              <View style={styles.driverRouteCopy}>
                <Text style={styles.driverRouteMeta} numberOfLines={1}>
                  Destino · {ridePreferenceSummary}
                </Text>
                <Text style={styles.driverRouteAddress} numberOfLines={1}>
                  {dropoffLabel}
                </Text>
              </View>
            </View>
          </View>
        </>
      );
    }

    return null;
  };

  const renderCompactDriverCard = () => {
    const passengerMeta = normalizedBookingStatus === "started"
      ? "A bordo"
      : normalizedBookingStatus === "arrived"
        ? "No ponto de encontro"
        : `${etaLabel} · ${distanceLabel} até o embarque`;
    const shouldShowPickupLine =
      normalizedBookingStatus === "accepted" || normalizedBookingStatus === "arrived";
    const secondaryActions = normalizedBookingStatus === "started"
      ? (
        <>
          <IconActionButton
            icon="navigate-outline"
            label="Navegar"
            onPress={handleOpenNavigation}
            style={styles.compactSecondaryButton}
            testID="driver-trip-navigation-button"
          />
          <IconActionButton
            icon="chatbubble-outline"
            label="Chat"
            onPress={handleOpenDriverChat}
            style={styles.compactSecondaryButton}
            testID="driver-trip-chat-button"
          />
          <IconActionButton
            icon="warning-outline"
            label="Reportar"
            tone="danger"
            onPress={() => navigation.navigate("RobotaxiPrototypeSupport", driverSupportContext)}
            style={styles.compactSecondaryButton}
            testID="driver-trip-report-button"
          />
          <LeafButton
            label={primaryLabel}
            tone="primary"
            disabled={busyAction}
            onPress={handlePrimaryAction}
            style={styles.compactPrimaryButton}
            testID={primaryActionTestID}
            accessibilityLabel={primaryActionTestID}
          />
        </>
      )
      : normalizedBookingStatus === "arrived"
        ? (
          <>
            <IconActionButton
              icon="chatbubble-outline"
              label="Chat"
              onPress={handleOpenDriverChat}
              style={styles.compactSecondaryButton}
              testID="driver-trip-chat-button"
            />
            <IconActionButton
              icon="person-remove-outline"
              label="No-show"
              tone="danger"
              onPress={handleNoShow}
              style={styles.compactSecondaryButton}
              testID="driver-trip-no-show-button"
            />
            <LeafButton
              label={primaryLabel}
              tone="primary"
              disabled={busyAction}
              onPress={handlePrimaryAction}
              style={styles.compactPrimaryButton}
              testID={primaryActionTestID}
              accessibilityLabel={primaryActionTestID}
            />
          </>
        )
        : (
          <>
            <IconActionButton
              icon="navigate-outline"
              label="Navegar"
              onPress={handleOpenNavigation}
              style={styles.compactSecondaryButton}
              testID="driver-trip-navigation-button"
            />
            <IconActionButton
              icon="chatbubble-outline"
              label="Chat"
              onPress={handleOpenDriverChat}
              style={styles.compactSecondaryButton}
              testID="driver-trip-chat-button"
            />
            <IconActionButton
              icon="close-circle-outline"
              label="Cancelar"
              tone="danger"
              onPress={handleOpenDriverCancellation}
              style={styles.compactSecondaryButton}
              testID="driver-trip-cancel-button"
            />
            <LeafButton
              label={primaryLabel}
              tone="primary"
              disabled={busyAction}
              onPress={handlePrimaryAction}
              style={styles.compactPrimaryButton}
              testID={primaryActionTestID}
              accessibilityLabel={primaryActionTestID}
            />
          </>
        );

    return (
      <>
        <View style={styles.sheetHandle} />
        <View style={styles.compactHeaderRow}>
          <View style={styles.compactHeaderCopy}>
            <Text
              style={styles.compactTitle}
              numberOfLines={1}
              testID={
                normalizedBookingStatus === "started"
                  ? driverCardFieldTestIDs.destination_address
                  : undefined
              }
            >
              {compactTripTitle}
            </Text>
            {shouldShowPickupLine ? (
              <Text
                style={styles.compactSubtitle}
                numberOfLines={1}
                testID={driverCardFieldTestIDs.pickup_address}
              >
                {pickupLabel}
              </Text>
            ) : (
              <Text style={styles.compactSubtitle} numberOfLines={1}>
                {driverArrivalSummary}
              </Text>
            )}
          </View>
          <LeafAnimatedPressable
            activeScale={0.96}
            accessibilityRole="button"
            accessibilityLabel={detailsExpanded ? "Ocultar detalhes" : "Ver detalhes"}
            onPress={() => setDetailsExpanded(value => !value)}
            style={styles.compactDetailsButton}
          >
            <Text style={styles.compactDetailsLabel} numberOfLines={1}>
              {detailsExpanded ? "Menos" : "Detalhes"}
            </Text>
            <Ionicons
              name={detailsExpanded ? "chevron-down" : "chevron-up"}
              size={14}
              color={leafRideColors.text}
            />
          </LeafAnimatedPressable>
        </View>

        <LeafPersonIdentity
          initial={passengerInitial}
          photoUri={passengerPhotoUri}
          name={passengerLabel}
          meta={passengerMeta}
          compact
          style={styles.compactPassengerIdentity}
          testID="driver-trip-passenger-identity"
          fieldTestIDs={{
            avatar: driverCardFieldTestIDs.passenger_photo,
            name: driverCardFieldTestIDs.passenger_name,
          }}
        />

        {normalizedBookingStatus === "arrived" ? (
          <View style={styles.compactPinRow}>
            <View style={styles.pinCopy}>
              <Text style={styles.pinLabel} numberOfLines={1}>
                Código da corrida
              </Text>
              <Text
                style={[
                  styles.pinHint,
                  isBoardingTimerUrgent && styles.boardingTimerMessageUrgent,
                  isBoardingTimerExpired && styles.boardingTimerMessageExpired,
                ]}
                numberOfLines={1}
              >
                {boardingTimerMessage}
              </Text>
            </View>
            <Text
              style={styles.pinValue}
              numberOfLines={1}
              testID={driverCardFieldTestIDs.boarding_pin}
            >
              {boardingPin}
            </Text>
          </View>
        ) : null}

        <View style={styles.compactMetricRow}>
          {renderCompactMetric(
            compactTripEtaLabel,
            compactTripEtaCaption,
            null,
            normalizedBookingStatus === "started"
              ? driverCardFieldTestIDs.eta_final
              : normalizedBookingStatus === "arrived"
                ? driverCardFieldTestIDs.boarding_timer
                : driverCardFieldTestIDs.pickup_eta,
          )}
          {normalizedBookingStatus !== "arrived"
            ? renderCompactMetric(
                distanceLabel,
                compactTripMetaLabel,
                null,
                normalizedBookingStatus === "started"
                  ? driverCardFieldTestIDs.distance_remaining
                  : undefined,
              )
            : null}
          {renderCompactMetric(
            tripFareLabel,
            tripFareCaption,
            styles.compactMetricValueLeaf,
            normalizedBookingStatus === "started"
              ? driverCardFieldTestIDs.net_payout
              : undefined,
          )}
        </View>

        {normalizedBookingStatus === "started" ? (
          <>
            <LeafDivider style={styles.compactDetailsDivider} />
            <LeafRouteProgress
              originLabel={pickupLabel}
              destinationLabel={dropoffTitle}
              progress={routeProgress}
              progressKey={liveRouteKey || "driver-trip-route"}
              arrivalLabel={null}
              style={styles.driverRouteProgress}
              testID="driver-trip-route-progress"
              fieldTestIDs={{
                progress: driverCardFieldTestIDs.route_progress,
              }}
            />
            <Text
              style={styles.driverRouteSummaryText}
              numberOfLines={1}
            >
              {driverStartedSummary}
            </Text>
          </>
        ) : null}

        {normalizedBookingStatus === "accepted" ? (
          <Text style={styles.compactPreferenceText} numberOfLines={1}>
            {ridePreferenceSummary}
          </Text>
        ) : null}

        {renderCompactTripDetails()}

        <View style={styles.compactActionsRow}>
          {secondaryActions}
        </View>
      </>
    );
  };

  const renderDriverCard = () => {
    if (!hasActiveRide) {
      if (isProtectedStatusWithoutRideIdentity) {
        return (
          <>
            <View style={styles.sheetHandle} />
            <Text
              style={styles.emptyTitle}
              testID="driver-trip-missing-identity-title"
            >
              Sincronizando corrida
            </Text>
            <Text style={styles.emptyText}>
              Recebemos um estado ativo, mas a identificação da corrida ainda não chegou. Mantemos esta tela travada até o servidor confirmar o booking.
            </Text>
            <View style={styles.primaryActionRow}>
              <LeafButton
                label="Aguardando servidor"
                tone="primary"
                disabled
                style={styles.primaryAction}
                testID="driver-trip-missing-identity-button"
                accessibilityLabel="driver-trip-missing-identity-button"
              />
            </View>
          </>
        );
      }

      return (
        <>
          <View style={styles.sheetHandle} />
          <LeafButton
            label="Voltar"
            tone="primary"
            onPress={handlePrimaryAction}
            style={styles.emptyBackButton}
            testID={primaryActionTestID}
            accessibilityLabel={primaryActionTestID}
          />
          <Text style={styles.emptyTitle}>Nenhuma corrida ativa</Text>
          <Text style={styles.emptyText}>
            Volte ao painel para receber novas solicitações.
          </Text>
        </>
      );
    }

    if (isActiveTripSurface) {
      return renderCompactDriverCard();
    }

    if (isOperationalHoldSurface) {
      const isSearchingReplacement =
        normalizedBookingStatus === "searching_replacement";
      const title = isSearchingReplacement
        ? "Continuidade em andamento"
        : "Corrida interrompida";
      const message =
        operationalContinuation?.message ||
        (isSearchingReplacement
          ? "A continuidade da corrida está sendo tratada pelo servidor. Aguarde a liberação antes de receber uma nova solicitação."
          : "A interrupção foi registrada. Aguarde a decisão do passageiro antes de seguir.");

      return (
        <>
          <View style={styles.sheetHandle} />
          <Text style={styles.emptyTitle} testID="driver-trip-operational-hold-title">
            {title}
          </Text>
          <Text style={styles.emptyText}>{message}</Text>
          <LeafPersonIdentity
            initial={passengerInitial}
            photoUri={passengerPhotoUri}
            name={passengerLabel}
            meta="Estado protegido até confirmação do servidor"
            compact
            style={styles.infoRow}
            testID="driver-trip-passenger-identity"
          />
          <View style={styles.primaryActionRow}>
            <LeafButton
              label="Aguardando confirmação"
              tone="primary"
              disabled
              style={styles.primaryAction}
              testID="driver-trip-operational-hold-button"
              accessibilityLabel="driver-trip-operational-hold-button"
            />
          </View>
        </>
      );
    }

    if (normalizedBookingStatus === "arrived") {
      return (
        <>
          <View style={styles.sheetHandle} />
          {renderCardStateHeader(
            <View style={styles.driverPayout}>
              <Text style={styles.driverPayoutValue} numberOfLines={1}>
                {boardingCountdownLabel || "0:00"}
              </Text>
              <Text style={styles.driverPayoutLabel} numberOfLines={1}>
                embarque
              </Text>
            </View>,
          )}
          <LeafPersonIdentity
            initial={passengerInitial}
            photoUri={passengerPhotoUri}
            name={passengerLabel}
            meta="Confirme antes de iniciar"
            compact
            style={styles.passengerIdentity}
            testID="driver-trip-passenger-identity"
          />

          <View style={styles.pinPanel}>
            <View style={styles.pinCopy}>
              <Text style={styles.pinLabel} numberOfLines={1}>
                Código da corrida
              </Text>
              <Text
                style={[
                  styles.pinHint,
                  isBoardingTimerUrgent && styles.boardingTimerMessageUrgent,
                  isBoardingTimerExpired && styles.boardingTimerMessageExpired,
                ]}
                numberOfLines={1}
              >
                {boardingTimerMessage}
              </Text>
            </View>
            <Text style={styles.pinValue} numberOfLines={1}>
              {boardingPin}
            </Text>
          </View>

          <View style={styles.driverRouteTimeline}>
            <View style={styles.driverRouteStep}>
              <View style={styles.driverRouteTrack}>
                <View style={styles.driverRouteDot} />
              </View>
              <View style={styles.driverRouteCopy}>
                <Text style={styles.driverRouteMeta} numberOfLines={1}>
                  Ponto de encontro
                </Text>
                <Text style={styles.driverRouteAddress} numberOfLines={1}>
                  {pickupLabel}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.secondaryActionsRow}>
            <IconActionButton
              icon="call-outline"
              label="Ligar"
              onPress={handleCallPassenger}
              style={styles.secondaryActionButton}
              testID="driver-trip-call-button"
            />
            <IconActionButton
              icon="chatbubble-outline"
              label="Chat"
              onPress={handleOpenDriverChat}
              style={styles.secondaryActionButton}
              testID="driver-trip-chat-button"
            />
            <IconActionButton
              icon="person-remove-outline"
              label="No-show"
              tone="danger"
              onPress={handleNoShow}
              style={styles.secondaryActionButton}
              testID="driver-trip-no-show-button"
            />
          </View>
          <View style={styles.primaryActionRow}>
            <LeafButton
              label={primaryLabel}
              tone="primary"
              disabled={busyAction}
              onPress={handlePrimaryAction}
              style={styles.primaryAction}
              testID={primaryActionTestID}
              accessibilityLabel={primaryActionTestID}
            />
          </View>
        </>
      );
    }

    if (normalizedBookingStatus === "started") {
      return (
        <>
          <View style={styles.sheetHandle} />
          {renderCardStateHeader(renderPayoutBlock())}

          <LeafRouteProgress
            originLabel={pickupLabel}
            destinationLabel={dropoffTitle}
            progress={routeProgress}
            progressKey={liveRouteKey || "driver-trip-route"}
            arrivalLabel={null}
            style={styles.driverRouteProgress}
            testID="driver-trip-route-progress"
          />
          <Text style={styles.driverRouteSummaryText} numberOfLines={1}>
            {driverStartedSummary}
          </Text>
          <LeafPersonIdentity
            initial={passengerInitial}
            photoUri={passengerPhotoUri}
            name={passengerLabel}
            meta="A bordo"
            compact
            style={styles.infoRow}
            testID="driver-trip-passenger-identity"
          />

          <View style={styles.secondaryActionsRow}>
            <IconActionButton
              icon="navigate-outline"
              label="Navegar"
              onPress={handleOpenNavigation}
              style={styles.secondaryActionButton}
              testID="driver-trip-navigation-button"
            />
            <IconActionButton
              icon="chatbubble-outline"
              label="Chat"
              onPress={handleOpenDriverChat}
              style={styles.secondaryActionButton}
              testID="driver-trip-chat-button"
            />
            <IconActionButton
              icon="warning-outline"
              label="Reportar"
              tone="danger"
              onPress={() => navigation.navigate("RobotaxiPrototypeSupport", driverSupportContext)}
              style={styles.secondaryActionButton}
              testID="driver-trip-report-button"
            />
          </View>
          <View style={styles.primaryActionRow}>
            <LeafButton
              label={primaryLabel}
              tone="primary"
              disabled={busyAction}
              onPress={handlePrimaryAction}
              style={styles.primaryAction}
              testID={primaryActionTestID}
              accessibilityLabel={primaryActionTestID}
            />
          </View>
        </>
      );
    }

    return (
      <>
        <View style={styles.sheetHandle} />
        {renderCardStateHeader(renderPayoutBlock())}

        <LeafPersonIdentity
          initial={passengerInitial}
          photoUri={passengerPhotoUri}
          name={passengerLabel}
          meta={`${etaLabel} · ${distanceLabel} até o embarque`}
          compact
          style={styles.passengerIdentity}
          testID="driver-trip-passenger-identity"
        />

        <View style={styles.driverRouteTimeline}>
          <View style={styles.driverRouteStep}>
            <View style={styles.driverRouteTrack}>
              <View style={styles.driverRouteDot} />
              <View style={styles.driverRouteLine} />
            </View>
            <View style={styles.driverRouteCopy}>
              <Text style={styles.driverRouteMeta} numberOfLines={1}>
                Embarque
              </Text>
              <Text style={styles.driverRouteAddress} numberOfLines={1}>
                {pickupLabel}
              </Text>
            </View>
          </View>
          <View style={styles.driverRouteStep}>
            <View style={styles.driverRouteTrack}>
              <View style={[styles.driverRouteDot, styles.driverRouteDotDestination]} />
            </View>
            <View style={styles.driverRouteCopy}>
              <Text style={styles.driverRouteMeta} numberOfLines={1}>
                Destino · {ridePreferenceSummary}
              </Text>
              <Text style={styles.driverRouteAddress} numberOfLines={1}>
                {dropoffLabel}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.secondaryActionsRow}>
          <IconActionButton
            icon="chatbubble-outline"
            label="Chat"
            onPress={handleOpenDriverChat}
            style={styles.secondaryActionButton}
            testID="driver-trip-chat-button"
          />
          <IconActionButton
            icon="navigate-outline"
            label="Navegar"
            onPress={handleOpenNavigation}
            style={styles.secondaryActionButton}
            testID="driver-trip-navigation-button"
          />
          <IconActionButton
            icon="close-circle-outline"
            label="Cancelar"
            tone="danger"
            onPress={handleOpenDriverCancellation}
            style={styles.secondaryActionButton}
            testID="driver-trip-cancel-button"
          />
        </View>
        <View style={styles.primaryActionRow}>
          <LeafButton
            label={primaryLabel}
            tone="primary"
            disabled={busyAction}
            onPress={handlePrimaryAction}
            style={styles.primaryAction}
            testID={primaryActionTestID}
            accessibilityLabel={primaryActionTestID}
          />
        </View>
      </>
    );
  };

  return (
    <PrototypeScreenTransition>
      <View style={styles.container} pointerEvents="box-none">
        <StatusBar
          translucent
          backgroundColor="transparent"
          barStyle="dark-content"
        />
        <PrototypeMapLayer
          mapRef={mapRef}
          region={driverTripMapRegion}
          forceRegionUpdate
          userCoordinate={driverMapCoordinate}
          userHeading={driverMapHeading}
          userAvatarLetter="M"
          driverCoordinate={driverMapCoordinate}
          driverHeading={driverMapHeading}
          routeCoordinates={driverTripRouteCoordinates}
          routeTrafficSegments={driverTripTrafficSegments}
          showTraffic={driverTripTrafficSegments.length > 0}
          originCoordinate={driverTripRouteOriginCoordinate}
          destinationCoordinate={driverTripRouteDestinationCoordinate}
          destinationLabel={normalizedBookingStatus === "started" ? dropoffTitle : "Embarque"}
          destinationAddress={normalizedBookingStatus === "started" ? dropoffLabel : pickupLabel}
          originLabel={normalizedBookingStatus === "started" ? "Partida" : "Motorista"}
          originAddress={normalizedBookingStatus === "started" ? pickupLabel : "Sua localização atual"}
          viewportPadding={driverTripViewportPadding}
          routeViewportRegion={driverTripVisibleRouteRegion}
          onMapLayout={handleMapLayout}
          interactionEnabled={isLifecycleNavigationLocked}
          hideRouteEndpointMarkers
          hideUserMarker
          animateRoute
          driverMarkerMode="car"
          driverMarkerLetter="M"
          destinationMarkerMode={normalizedBookingStatus === "started" ? "place" : "avatar"}
          destinationMarkerLetter={passengerInitial}
          mapSafetyProfile="driver"
        />
        <PrototypeConnectionStatusPill
          topOffset={insets.top + 18}
          visible={Boolean(rideLocalSyncIndicator)}
          tone={rideLocalSyncIndicator?.tone}
          icon={rideLocalSyncIndicator?.icon}
          title={rideLocalSyncIndicator?.title}
          message={rideLocalSyncIndicator?.message}
          testID="driver-trip-local-sync-pill"
        />
        {!isLifecycleNavigationLocked ? (
          <LeafStateHeader
            title={headerCopy.title}
            subtitle={driverIslandSubtitle}
            rightLabel={driverIslandRightLabel}
            rightTone={normalizedBookingStatus === "started" ? "dark" : headerCopy.rightTone}
            insetsTop={insets.top}
          />
        ) : null}

        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropDismissEnabled={!isLifecycleNavigationLocked}
          dragEnabled={!isLifecycleNavigationLocked}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <LeafRideSheet
            onLayout={handleCardLayout}
            style={[
              styles.tripCard,
              isCompactTripSurface && styles.compactTripCard,
              {
                maxHeight: driverTripSheetMaxHeight,
                paddingBottom: 12 + safeBottom,
              },
            ]}
            scrollEnabled
            scrollStyle={[
              styles.tripSheetScroll,
              { maxHeight: driverTripSheetScrollMaxHeight },
            ]}
            showsVerticalScrollIndicator={
              detailsExpanded || isOperationalHoldSurface || isProtectedStatusWithoutRideIdentity
            }
            testID="driver-live-trip-screen"
            accessibilityLabel="driver-live-trip-screen"
          >
            {renderDriverCard()}

            {visibleLastError ? (
              <Text style={styles.errorText}>{visibleLastError}</Text>
            ) : null}
          </LeafRideSheet>
        </PrototypeDismissibleSheet>
      </View>
    </PrototypeScreenTransition>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "transparent",
  },
  sheetWrap: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  tripCard: {
    backgroundColor: "#FFFFFF",
    minHeight: 332,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 14,
  },
  tripSheetScroll: {
    flexGrow: 0,
  },
  compactTripCard: {
    minHeight: 218,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 50,
    height: 4,
    borderRadius: 3,
    backgroundColor: "#D8D0C7",
    alignSelf: "center",
    marginBottom: 18,
  },
  compactHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  compactHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  compactTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 21,
    lineHeight: 26,
  },
  compactSubtitle: {
    marginTop: 3,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 17,
  },
  compactDetailsButton: {
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  compactDetailsLabel: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 14,
  },
  compactPassengerIdentity: {
    marginTop: 14,
  },
  compactPinRow: {
    marginTop: 12,
    minHeight: 50,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(17,22,17,0.08)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  compactMetricRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "stretch",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: leafRideColors.line,
    paddingVertical: 10,
  },
  compactMetric: {
    flex: 1,
    minWidth: 0,
  },
  compactMetricValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  compactMetricValueLeaf: {
    color: leafRideColors.leaf,
  },
  compactMetricLabel: {
    marginTop: 1,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14,
  },
  compactPreferenceText: {
    marginTop: 8,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  compactDetailsDivider: {
    marginTop: 12,
    marginBottom: 12,
  },
  compactActionsRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  compactSecondaryButton: {
    flex: 0.72,
    minWidth: 74,
  },
  compactPrimaryButton: {
    flex: 1.22,
    minWidth: 112,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
  },
  cardStateHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  cardStateCopy: {
    flex: 1,
    minWidth: 0,
  },
  cardStateTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25,
  },
  driverPayout: {
    minWidth: 82,
    alignItems: "flex-end",
    paddingTop: 2,
  },
  driverPayoutValue: {
    color: leafRideColors.leaf,
    fontFamily: fonts.SemiBold,
    fontSize: 16,
    lineHeight: 21,
    textAlign: "right",
  },
  driverPayoutLabel: {
    marginTop: 1,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "right",
  },
  cardHeaderPill: {
    minWidth: 62,
    marginTop: 2,
  },
  cardStateDivider: {
    marginTop: 8,
    marginBottom: 10,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  sheetHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  sheetTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  sheetSubtitle: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  boardingTimerPanel: {
    marginTop: 8,
    alignItems: "flex-start",
    paddingVertical: 2,
  },
  boardingTimerValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 34,
    lineHeight: 39,
  },
  boardingTimerMessage: {
    marginTop: 3,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  boardingTimerMessageUrgent: {
    color: leafRideColors.warningText,
  },
  boardingTimerMessageExpired: {
    color: leafRideColors.dangerText,
  },
  pinPanel: {
    marginTop: 14,
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(17,22,17,0.08)",
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  pinCopy: {
    flex: 1,
    minWidth: 0,
  },
  pinLabel: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  pinHint: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  pinValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25,
  },
  driverRouteTimeline: {
    marginTop: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: leafRideColors.line,
    paddingVertical: 12,
    gap: 12,
  },
  driverRouteStep: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  driverRouteTrack: {
    width: 24,
    alignItems: "center",
    paddingTop: 5,
    marginRight: 12,
  },
  driverRouteDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: leafRideColors.text,
  },
  driverRouteDotDestination: {
    backgroundColor: leafRideColors.leaf,
  },
  driverRouteLine: {
    width: 1,
    height: 34,
    backgroundColor: "rgba(17,22,17,0.16)",
    marginTop: 6,
  },
  driverRouteCopy: {
    flex: 1,
    minWidth: 0,
  },
  driverRouteMeta: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14,
  },
  driverRouteAddress: {
    marginTop: 2,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  driverRouteProgress: {
    marginTop: 0,
  },
  driverRouteSummaryText: {
    marginTop: 8,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  firstMetricRow: {
    marginTop: 0,
  },
  firstInfoRow: {
    marginTop: 0,
  },
  passengerIdentity: {
    marginTop: 0,
  },
  pinInfoRow: {
    marginTop: 10,
  },
  infoRow: {
    marginTop: 10,
  },
  divider: {
    marginTop: 12,
    marginBottom: 0,
  },
  secondaryActionsRow: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  secondaryActionButton: {
    flex: 0,
    width: leafButtonMetrics.height,
    minWidth: leafButtonMetrics.height,
    maxWidth: leafButtonMetrics.height,
  },
  primaryActionRow: {
    marginTop: 10,
  },
  iconActionButton: {
    minWidth: leafButtonMetrics.height,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    borderWidth: 1,
    borderColor: leafRideColors.line,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: leafButtonMetrics.iconGap,
    paddingHorizontal: 12,
  },
  iconOnlyActionButton: {
    flex: 0,
    width: leafButtonMetrics.height,
    minWidth: leafButtonMetrics.height,
    maxWidth: leafButtonMetrics.height,
    gap: 0,
    paddingHorizontal: 0,
  },
  iconActionButtonDanger: {
    backgroundColor: leafRideColors.danger,
    borderColor: leafRideColors.danger,
  },
  iconActionButtonPrimary: {
    backgroundColor: leafRideColors.leaf,
    borderColor: leafRideColors.leaf,
  },
  iconActionLabel: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 16,
  },
  iconActionLabelPrimary: {
    color: "#FFFFFF",
  },
  iconActionLabelDanger: {
    color: leafRideColors.dangerText,
  },
  iconActionButtonDisabled: {
    opacity: 0.52,
  },
  primaryAction: {
    flex: 1,
    width: "100%",
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
  },
  emptyBackButton: {
    alignSelf: "flex-start",
  },
  emptyTitle: {
    marginTop: 18,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25,
  },
  emptyText: {
    marginTop: 6,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 17,
  },
  errorText: {
    marginTop: 10,
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
    textAlign: "center",
  },
});
