import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, StatusBar, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import PrototypeMapLayer from "../../components/prototype/PrototypeMapLayer";
import {
  LeafButton,
  leafRideColors,
} from "../../components/prototype/LeafRideUI";
import {
  RobotaxiLifecycleButton,
  RobotaxiLifecycleCard,
  RobotaxiLifecycleDisclosure,
  RobotaxiLifecycleIdentity,
  RobotaxiLifecycleSection,
  RobotaxiLifecycleSummary,
  robotaxiLifecycleMetrics,
} from "../../components/prototype/RobotaxiLifecycleUI";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { useHapticFeedback } from "../../hooks/useHapticFeedback";
import { PROTOTYPE_ORIGIN_COORDINATE, PROTOTYPE_REGION } from "./robotaxiPrototypeData";
import {
  buildRouteViewportRegion,
  buildVisibleRouteEdgePadding,
} from "./prototypeRouteViewport";
import {
  getDriverOfferPayoutLabel,
  hasAuthoritativeDriverOfferPricing,
  selectDisplayableDriverOffer,
} from "./driverOfferPricingSnapshot";
import {
  RIDE_CARD_ROLES,
  RIDE_CARD_STATES,
  createRideCardFieldTestIDs,
  defineRideCardRenderedFields,
} from "./rideCardContract";
import useCampaignAssetOverride from "../../hooks/useCampaignAssetOverride";
import { resolvePrototypeMapPresentation } from "./prototypeMapPresentation";
import { useDriverOfferCountdown } from "./driverOfferCountdown";

const SHEET_BOTTOM_OFFSET = 0;
const FALLBACK_CARD_HEIGHT = 356;
const DRIVER_OFFER_MAP_SIDE_PADDING = 24;
const DRIVER_OFFER_MAP_TOP_PADDING = 72;
const DRIVER_OFFER_MAP_MIN_VISIBLE_HEIGHT = 220;

const DRIVER_OFFER_RENDERED_CARD_FIELD_IDS = Object.freeze([
  "net_payout",
  "gross_fare",
  "pickup_address",
  "destination_address",
  "pickup_eta",
  "pickup_distance",
  "trip_distance",
  "trip_duration",
  "passenger_name",
  "passenger_photo",
  "passenger_rating",
  "passenger_verified_badge",
  "ride_preferences",
  "payment_confirmed",
  "response_timer",
  "accept_action",
  "reject_action",
]);

const DRIVER_OFFER_FIELD_TEST_ID_OVERRIDES = Object.freeze({
  accept_action: "driver-offer-screen-accept-button",
  reject_action: "driver-offer-screen-reject-button",
  ride_preferences: "driver-offer-screen-preferences",
});

const DRIVER_OFFER_FIELD_TEST_IDS = createRideCardFieldTestIDs(
  RIDE_CARD_ROLES.DRIVER,
  RIDE_CARD_STATES.DRIVER_NEW_OFFER,
  DRIVER_OFFER_RENDERED_CARD_FIELD_IDS,
  DRIVER_OFFER_FIELD_TEST_ID_OVERRIDES,
);

const GENERIC_OFFER_LABELS = new Set([
  "local combinado",
  "motorista",
  "driver",
  "null",
  "undefined",
]);

export const DRIVER_OFFER_RENDERED_CARD_FIELDS = defineRideCardRenderedFields(
  RIDE_CARD_ROLES.DRIVER,
  RIDE_CARD_STATES.DRIVER_NEW_OFFER,
  DRIVER_OFFER_RENDERED_CARD_FIELD_IDS,
  { testIDs: DRIVER_OFFER_FIELD_TEST_ID_OVERRIDES },
);

function isCompetitiveAcceptLossMessage(message) {
  return String(message || "")
    .trim()
    .toLowerCase()
    .includes("outro motorista aceitou");
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
    normalized.includes("ativacao do motorista pendente")
  );
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function formatCurrency(value) {
  return `R$ ${toNumber(value, 0).toFixed(2).replace(".", ",")}`;
}

function formatDistanceKmValue(valueKm) {
  const numeric = Number(valueKm);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return "--";
  }

  if (numeric < 1) {
    const meters = numeric <= 0
      ? 0
      : Math.max(10, Math.round((numeric * 1000) / 10) * 10);
    return `${meters} m`;
  }

  const digits = numeric >= 10 ? 0 : 1;
  return `${numeric.toFixed(digits).replace(".", ",")} km`;
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

function toRouteNumber(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveRouteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toNonNegativeRouteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function pickPositiveRouteNumber(...values) {
  for (const value of values) {
    const parsed = toPositiveRouteNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function pickNonNegativeRouteNumber(...values) {
  for (const value of values) {
    const parsed = toNonNegativeRouteNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

function normalizeOfferTextValue(value) {
  if (typeof value === "object" && value !== null) {
    return "";
  }
  return String(value ?? "").trim();
}

function isGenericOfferLabel(value) {
  const normalized = normalizeOfferTextValue(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return !normalized || GENERIC_OFFER_LABELS.has(normalized);
}

function pickOfferText(values = [], fallback = "") {
  for (const value of values) {
    const normalized = normalizeOfferTextValue(value);
    if (normalized && !isGenericOfferLabel(normalized)) {
      return normalized;
    }
  }

  return fallback;
}

function toRadians(value) {
  return (Number(value) * Math.PI) / 180;
}

function computeRouteDistanceKm(coordinates = []) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  let totalKm = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = normalizeMapCoordinate(coordinates[index - 1]);
    const current = normalizeMapCoordinate(coordinates[index]);
    if (!previous || !current) {
      continue;
    }

    const deltaLatitude = toRadians(current.latitude - previous.latitude);
    const deltaLongitude = toRadians(current.longitude - previous.longitude);
    const startLatitude = toRadians(previous.latitude);
    const endLatitude = toRadians(current.latitude);
    const haversine =
      Math.sin(deltaLatitude / 2) ** 2 +
      Math.cos(startLatitude) *
        Math.cos(endLatitude) *
        Math.sin(deltaLongitude / 2) ** 2;
    totalKm += 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  }

  return totalKm > 0 ? totalKm : null;
}

function normalizeMapCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }
  return { latitude, longitude };
}

function normalizeMapTrafficSegments(value = []) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((segment) => {
      const coordinates = Array.isArray(segment?.coordinates)
        ? segment.coordinates.map(normalizeMapCoordinate).filter(Boolean)
        : [];
      if (coordinates.length < 2) {
        return null;
      }

      return {
        level: String(segment?.level || segment?.trafficLevel || "normal").trim(),
        color: String(segment?.color || "").trim(),
        coordinates,
      };
    })
    .filter(Boolean);
}

function buildFallbackOfferRegion(points = []) {
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

function buildDriverOfferFromRouteParams(params = {}) {
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
    passengerName: String(params.passengerName || params.passenger || "Passageiro Leaf").trim(),
    passenger: String(params.passengerName || params.passenger || "Passageiro Leaf").trim(),
    pickupAddress: String(params.pickupAddress || params.pickup || "Embarque indisponível").trim(),
    pickup: String(params.pickupAddress || params.pickup || "Embarque indisponível").trim(),
    dropoffAddress: String(params.dropoffAddress || params.dropoff || "Destino indisponível").trim(),
    dropoff: String(params.dropoffAddress || params.dropoff || "Destino indisponível").trim(),
    ...(fare !== null ? { fare, grossFare: fare, totalAmount: fare, amount: fare } : {}),
    ...(driverNetAmount !== null
      ? {
          driverNetAmount,
          estimatedDriverNetAmount: driverNetAmount,
        }
      : {}),
    estimatedOperationalFee: toRouteNumber(params.estimatedOperationalFee, undefined),
    estimatedPaymentIntermediationFee: toRouteNumber(params.estimatedPaymentIntermediationFee, undefined),
    estimatedTotalFees: toRouteNumber(params.estimatedTotalFees, undefined),
    distanceKm: toRouteNumber(params.distanceKm, undefined),
    tripDistanceKm: toRouteNumber(params.tripDistanceKm, undefined),
    pickupEtaMin: toRouteNumber(params.pickupEtaMin, undefined),
    tripDurationMin: toRouteNumber(params.tripDurationMin, undefined),
    passengerRating: toRouteNumber(params.passengerRating, undefined),
    expiresInSec: toRouteNumber(
      params.expiresInSec ?? params.expiresInSeconds ?? params.timeout,
      18,
    ),
    expiresAt: params.expiresAt || params.offerExpiresAt || null,
    timestamp: params.timestamp || params.notifiedAt || null,
    timeout: toRouteNumber(params.timeout, undefined),
    paymentMethod: String(params.paymentMethod || "pix").trim(),
    pricingSnapshotLocked: String(params.pricingSnapshotLocked || "true") !== "false",
  };
}

export default function RobotaxiDriverOfferScreen({ navigation, route }) {
  const {
    currentCoordinate,
    currentHeading,
    driverCoordinate,
    driverOffers,
    driverTripMeta,
    profile,
    acceptDriverOffer,
    rejectDriverOffer,
    lastError,
  } =
    usePrototypeRideRuntime();
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [mapWidth, setMapWidth] = useState(windowWidth);
  const [mapHeight, setMapHeight] = useState(windowHeight);
  const [cardHeight, setCardHeight] = useState(FALLBACK_CARD_HEIGHT);
  const [busyAction, setBusyAction] = useState("");
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const safeBottom = Math.max(0, Number(insets.bottom) || 0);
  const sheetBottom =
    SHEET_BOTTOM_OFFSET + safeBottom + robotaxiLifecycleMetrics.cardBottomGap;
  const offerCardMaxHeight = Math.max(352, Math.round(windowHeight * 0.66));
  const mapRef = useRef(null);
  const routeRequest = useMemo(() => {
    const candidate = buildDriverOfferFromRouteParams(route?.params);
    if (
      (candidate?.bookingId || candidate?.id) &&
      hasAuthoritativeDriverOfferPricing(candidate)
    ) {
      return candidate;
    }
    return null;
  }, [route?.params]);
  const [allowRouteFallback, setAllowRouteFallback] = useState(
    Boolean(routeRequest),
  );
  const qaKeepRouteRequestVisible = Boolean(
    route?.params?.qaKeepVisible || route?.params?.__qaKeepVisible,
  );
  const hadVisibleRequestRef = useRef(false);
  const protectedOfferExitRef = useRef(false);

  const liveRequest = useMemo(
    () => selectDisplayableDriverOffer(driverOffers),
    [driverOffers],
  );

  const request = useMemo(() => {
    return liveRequest || (allowRouteFallback ? routeRequest : null);
  }, [allowRouteFallback, liveRequest, routeRequest]);

  const hasRequest = Boolean(request?.bookingId || request?.id);
  const visibleLastError =
    hasRequest && isActivationOrVehicleStatusError(lastError) ? "" : lastError;

  const pickupDistanceKm = useMemo(() => {
    if (!hasRequest) {
      return null;
    }

    const directKm = pickNonNegativeRouteNumber(
      request?.driverDistanceToPickupKm,
      request?.pickupDistanceKm,
      request?.distanceToPickupKm,
      request?.distanceKm,
    );
    if (directKm !== null) {
      return directKm;
    }

    const directMiles = pickPositiveRouteNumber(
      request?.distanceMi,
      request?.distance,
    );
    return directMiles !== null ? directMiles * 1.60934 : null;
  }, [
    hasRequest,
    request?.distance,
    request?.distanceKm,
    request?.distanceMi,
    request?.distanceToPickupKm,
    request?.driverDistanceToPickupKm,
    request?.pickupDistanceKm,
  ]);

  const passengerRating = useMemo(() => {
    if (!hasRequest) {
      return null;
    }

    const rating = toNumber(request?.passengerRating ?? request?.rating, NaN);
    if (!Number.isFinite(rating)) {
      return null;
    }

    return Math.min(5, Math.max(0, rating));
  }, [hasRequest, request?.passengerRating, request?.rating]);

  const fareLabel = useMemo(() => {
    if (!hasRequest) {
      return "--";
    }

    return getDriverOfferPayoutLabel(request) || "--";
  }, [hasRequest, request]);

  const pickupLabel = pickOfferText(
    [
      request?.pickup,
      request?.pickupAddress,
      request?.pickupLocation?.add,
      request?.pickupLocation?.address,
      request?.originAddress,
      request?.origin?.address,
      request?.origin?.add,
    ],
    "Partida em confirmação",
  );
  const dropoffLabel = pickOfferText(
    [
      request?.dropoff,
      request?.dropoffAddress,
      request?.destinationAddress,
      request?.destinationLocation?.add,
      request?.destinationLocation?.address,
      request?.destination?.address,
      request?.destination?.add,
      request?.destination?.name,
      request?.destinationName,
    ],
    "Destino em confirmação",
  );
  const tripDistanceKm = pickPositiveRouteNumber(
    request?.tripDistanceKm,
    request?.routeDistanceKm,
    request?.estimatedTripDistanceKm,
    route?.params?.tripDistanceKm,
  );
  const pickupEtaMin = pickPositiveRouteNumber(
    request?.pickupEtaMin,
    request?.pickupDurationMin,
    request?.estimatedArrivalToPickupMin,
    request?.routeToPickupDurationMin,
    request?.pickupRoute?.durationMin,
    request?.pickupRoute?.durationMinutes,
    request?.etaMin,
    route?.params?.pickupEtaMin,
  );
  const pickupEtaLabel = pickupEtaMin
    ? `${Math.max(1, Math.round(pickupEtaMin))} min`
    : "ETA em cálculo";
  const tripDurationMin = pickPositiveRouteNumber(
    request?.tripDurationMin,
    request?.durationMin,
    request?.durationMinutes,
    request?.estimatedTripDurationMin,
    request?.estimatedDurationMin,
    request?.route?.durationMin,
    request?.route?.durationMinutes,
    request?.tripRoute?.durationMin,
    request?.tripRoute?.durationMinutes,
    route?.params?.tripDurationMin,
  );
  const tripDurationLabel = tripDurationMin
    ? `${Math.max(1, Math.round(tripDurationMin))} min`
    : "tempo em cálculo";
  const passengerRatingLabel =
    passengerRating == null
      ? "4,9"
      : passengerRating.toFixed(1).replace(".", ",");
  const passengerName = pickOfferText(
    [
      request?.passengerName,
      request?.customerName,
      request?.customer?.name,
      request?.passenger?.name,
      request?.riderName,
      request?.rider?.name,
      request?.passenger,
    ],
    "Passageiro Leaf",
  );
  const passengerInitial = passengerName.charAt(0).toUpperCase() || "P";
  const offerCountdown = useDriverOfferCountdown(request);
  const offerExpired = Boolean(hasRequest && offerCountdown.expired);
  const triggerHaptic = useHapticFeedback();
  const countdownWarningRef = useRef(null);
  const offerKeyForWarning = String(
    request?.bookingId || request?.rideId || request?.id || "",
  ).trim();
  useEffect(() => {
    const remaining = Number(offerCountdown?.remainingSeconds);
    const warningKey = `${offerKeyForWarning}:${remaining}`;
    if (
      hasRequest &&
      Number.isFinite(remaining) &&
      remaining > 0 &&
      remaining <= 5 &&
      countdownWarningRef.current !== warningKey
    ) {
      countdownWarningRef.current = warningKey;
      triggerHaptic("warning");
    }
  }, [
    hasRequest,
    offerCountdown?.remainingSeconds,
    offerKeyForWarning,
    triggerHaptic,
  ]);
  const grossFareLabel = formatCurrency(
    request?.grossFare ||
      request?.totalAmount ||
      request?.amount ||
      request?.fare,
  );
  const ridePreferenceItems = resolveRidePreferenceItems(request);
  const routeDriverCoordinate =
    normalizeMapCoordinate(request?.driverCoordinate) ||
    normalizeMapCoordinate(request?.currentCoordinate) ||
    normalizeMapCoordinate(request?.originCoordinate);
  const pickupRouteCoordinates = useMemo(() => {
    const routePlan = driverTripMeta?.routePlan || {};
    const candidateRoute =
      routePlan.pickupCoordinates ||
      request?.pickupRouteCoordinates ||
      [];
    const normalizedCandidate = Array.isArray(candidateRoute)
      ? candidateRoute.map(normalizeMapCoordinate).filter(Boolean)
      : [];
    return normalizedCandidate.length >= 2 ? normalizedCandidate : [];
  }, [
    driverTripMeta?.routePlan,
    request?.pickupRouteCoordinates,
  ]);
  const pickupRouteTrafficSegments = useMemo(() => {
    const routePlan = driverTripMeta?.routePlan || {};
    return normalizeMapTrafficSegments(
      routePlan.pickupTrafficSegments ||
        request?.pickupTrafficSegments ||
        [],
    );
  }, [
    driverTripMeta?.routePlan,
    request?.pickupTrafficSegments,
  ]);
  const tripRouteCoordinates = useMemo(() => {
    const routePlan = driverTripMeta?.routePlan || {};
    const candidateRoute =
      routePlan.destinationCoordinates ||
      request?.tripRouteCoordinates ||
      request?.destinationRouteCoordinates ||
      request?.routeCoordinates ||
      [];
    const normalizedCandidate = Array.isArray(candidateRoute)
      ? candidateRoute.map(normalizeMapCoordinate).filter(Boolean)
      : [];
    return normalizedCandidate.length >= 2 ? normalizedCandidate : [];
  }, [
    driverTripMeta?.routePlan,
    request?.destinationRouteCoordinates,
    request?.routeCoordinates,
    request?.tripRouteCoordinates,
  ]);
  const tripRouteTrafficSegments = useMemo(() => {
    const routePlan = driverTripMeta?.routePlan || {};
    return normalizeMapTrafficSegments(
      routePlan.destinationTrafficSegments ||
        request?.trafficSegments ||
        request?.tripTrafficSegments ||
        [],
    );
  }, [
    driverTripMeta?.routePlan,
    request?.trafficSegments,
    request?.tripTrafficSegments,
  ]);
  const resolvedPickupDistanceKm =
    pickupDistanceKm ?? computeRouteDistanceKm(pickupRouteCoordinates);
  const resolvedTripDistanceKm =
    tripDistanceKm ?? computeRouteDistanceKm(tripRouteCoordinates);
  const pickupDistanceLabel = formatDistanceKmValue(resolvedPickupDistanceKm);
  const tripDistanceLabel = formatDistanceKmValue(resolvedTripDistanceKm);
  const isTripRoutePreview =
    pickupRouteCoordinates.length < 2 && tripRouteCoordinates.length >= 2;
  const offerRouteCoordinates = isTripRoutePreview
    ? tripRouteCoordinates
    : pickupRouteCoordinates;
  const offerRouteTrafficSegments = isTripRoutePreview
    ? tripRouteTrafficSegments
    : pickupRouteTrafficSegments;
  const offerOriginCoordinate =
    routeDriverCoordinate ||
    normalizeMapCoordinate(driverCoordinate) ||
    normalizeMapCoordinate(currentCoordinate) ||
    pickupRouteCoordinates[0] ||
    PROTOTYPE_ORIGIN_COORDINATE;
  const offerDestinationCoordinate =
    normalizeMapCoordinate(driverTripMeta?.destinationCoordinate) ||
    normalizeMapCoordinate(request?.destinationCoordinate) ||
    normalizeMapCoordinate(request?.destinationLocation) ||
    tripRouteCoordinates[tripRouteCoordinates.length - 1] ||
    null;
  const offerPickupCoordinate =
    normalizeMapCoordinate(driverTripMeta?.pickupCoordinate) ||
    normalizeMapCoordinate(request?.pickupCoordinate) ||
    normalizeMapCoordinate(request?.pickupLocation) ||
    pickupRouteCoordinates[pickupRouteCoordinates.length - 1] ||
    tripRouteCoordinates[0] ||
    offerOriginCoordinate;
  const offerMapOriginCoordinate = isTripRoutePreview
    ? offerPickupCoordinate
    : offerOriginCoordinate;
  const offerMapDestinationCoordinate = isTripRoutePreview
    ? offerDestinationCoordinate || offerPickupCoordinate
    : offerPickupCoordinate;
  const offerMapOriginLabel = isTripRoutePreview ? "Partida" : "Você";
  const offerMapDestinationLabel = isTripRoutePreview
    ? "Chegada"
    : passengerName;
  const offerMapOriginAddress = isTripRoutePreview
    ? pickupLabel
    : "Sua localização atual";
  const offerMapDestinationAddress = isTripRoutePreview
    ? dropoffLabel
    : pickupLabel;
  const offerVehicleColor = String(
    profile?.vehicleColor ||
      profile?.vehicle?.color ||
      profile?.carColor ||
      profile?.car?.color ||
      driverTripMeta?.vehicleColor ||
      driverTripMeta?.vehicle?.color ||
      '',
  ).trim();
  const vehicleMarkerCampaignAsset = useCampaignAssetOverride({
    surface: 'ride_map',
    placement: 'vehicle_marker',
    role: 'driver',
    userId: profile?.uid || '',
    context: {
      city: 'rio_de_janeiro',
    },
    eventMetadata: {
      screen: 'robotaxi_driver_offer',
      state: hasRequest ? 'offer_visible' : 'empty',
    },
  });
  const offerMapOcclusion = useMemo(
    () => ({
      top: 0,
      bottom: sheetBottom + cardHeight,
    }),
    [cardHeight, sheetBottom],
  );
  const offerViewportPadding = useMemo(
    () => buildVisibleRouteEdgePadding({
      mapHeight: mapHeight || windowHeight,
      activeOcclusion: offerMapOcclusion,
      insets,
      sidePadding: DRIVER_OFFER_MAP_SIDE_PADDING,
      topExtraPadding: 28,
      bottomExtraPadding: 26,
      minVisibleHeight: DRIVER_OFFER_MAP_MIN_VISIBLE_HEIGHT,
      topPaddingMin: insets.top + DRIVER_OFFER_MAP_TOP_PADDING,
      overlayBiasRatio: 0.26,
    }),
    [
      insets,
      insets.top,
      mapHeight,
      offerMapOcclusion,
      windowHeight,
    ],
  );
  const offerViewportCoordinates = useMemo(
    () => (
      offerRouteCoordinates.length >= 2
        ? [
            ...offerRouteCoordinates,
            offerOriginCoordinate,
            offerMapOriginCoordinate,
            offerMapDestinationCoordinate,
          ]
        : []
    ),
    [
      offerMapDestinationCoordinate,
      offerMapOriginCoordinate,
      offerOriginCoordinate,
      offerRouteCoordinates,
    ],
  );
  const offerVisibleRouteRegion = useMemo(
    () => buildRouteViewportRegion({
      coordinates: offerViewportCoordinates,
      mapWidth: mapWidth || windowWidth,
      mapHeight: mapHeight || windowHeight,
      activeOcclusion: offerMapOcclusion,
      insets,
      viewportPadding: offerViewportPadding,
      minVisibleHeight: DRIVER_OFFER_MAP_MIN_VISIBLE_HEIGHT,
      shortRouteLatitudeDeltaMultiplier: 1.55,
      shortRouteLongitudeDeltaMultiplier: 1.6,
      longRouteLatitudeDeltaMultiplier: 1.35,
      longRouteLongitudeDeltaMultiplier: 1.4,
    }),
    [
      insets,
      mapHeight,
      mapWidth,
      offerMapOcclusion,
      offerViewportCoordinates,
      offerViewportPadding,
      windowHeight,
      windowWidth,
    ],
  );
  const offerMapRegion = useMemo(
    () =>
      offerVisibleRouteRegion || buildFallbackOfferRegion([
        offerOriginCoordinate,
        offerMapOriginCoordinate,
        offerMapDestinationCoordinate,
        ...offerRouteCoordinates,
      ]),
    [
      offerOriginCoordinate,
      offerMapDestinationCoordinate,
      offerMapOriginCoordinate,
      offerRouteCoordinates,
      offerVisibleRouteRegion,
    ]
  );

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-driver-offer",
    occludedBottom: offerMapOcclusion.bottom,
  });

  const handleDismiss = useCallback(() => {
    if (hasRequest) {
      return;
    }

    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("RobotaxiPrototype");
  }, [hasRequest, navigation]);

  useEffect(() => {
    if (
      !hasRequest ||
      typeof navigation?.addListener !== "function"
    ) {
      return undefined;
    }

    // A paid offer can only leave this surface through accept, reject, expiry,
    // or a competitive resolution acknowledged by the runtime.
    const unsubscribe = navigation.addListener("beforeRemove", event => {
      const expectedExit = protectedOfferExitRef.current;
      const action = event?.data?.action;
      const actionRouteName = action?.payload?.name;
      const isExpectedExit = Boolean(
        expectedExit &&
          ((expectedExit.routeName && actionRouteName === expectedExit.routeName) ||
            (expectedExit.actionType && action?.type === expectedExit.actionType)),
      );
      if (isExpectedExit) {
        protectedOfferExitRef.current = null;
        return;
      }

      event?.preventDefault?.();
    });

    return typeof unsubscribe === "function" ? unsubscribe : undefined;
  }, [hasRequest, navigation]);

  useEffect(() => {
    setAllowRouteFallback(Boolean(routeRequest));
  }, [routeRequest]);

  useEffect(() => {
    if (!routeRequest || liveRequest || qaKeepRouteRequestVisible) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      setAllowRouteFallback(false);
    }, 4000);

    return () => clearTimeout(timeoutId);
  }, [liveRequest, qaKeepRouteRequestVisible, routeRequest]);

  useEffect(() => {
    if (hasRequest) {
      hadVisibleRequestRef.current = true;
      return undefined;
    }

    if (!hadVisibleRequestRef.current || busyAction) {
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      handleDismiss();
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [busyAction, handleDismiss, hasRequest]);

  const handleCardLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setCardHeight(nextHeight);
    }
  }, []);
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

  const handleAccept = useCallback(async () => {
    if (!hasRequest || !request || offerExpired) {
      return;
    }

    triggerHaptic("medium");
    try {
      setBusyAction("accept");
      await acceptDriverOffer(request);
      protectedOfferExitRef.current = { routeName: "RobotaxiPrototype" };
      if (typeof navigation.replace === "function") {
        navigation.replace("RobotaxiPrototype", {
          source: "driver-offer-accepted",
          bookingId: request?.bookingId || request?.id || null,
        });
        return;
      }
      navigation.navigate("RobotaxiPrototype", {
        source: "driver-offer-accepted",
        bookingId: request?.bookingId || request?.id || null,
      });
    } catch (error) {
      if (isCompetitiveAcceptLossMessage(error?.message || error)) {
        protectedOfferExitRef.current = { actionType: "GO_BACK" };
        navigation.goBack();
        return;
      }
      Alert.alert(
        "Não foi possível aceitar",
        error?.message || "Falha ao aceitar corrida.",
      );
    } finally {
      setBusyAction("");
    }
  }, [acceptDriverOffer, hasRequest, navigation, offerExpired, request, triggerHaptic]);

  const handleReject = useCallback(async () => {
    if (!hasRequest || !request || offerExpired) {
      return;
    }

    try {
      setBusyAction("reject");
      await rejectDriverOffer(request, "Recusada pelo motorista.");
      protectedOfferExitRef.current = { actionType: "GO_BACK" };
      navigation.goBack();
    } catch (error) {
      Alert.alert(
        "Não foi possível recusar",
        error?.message || "Falha ao recusar corrida.",
      );
    } finally {
      setBusyAction("");
    }
  }, [hasRequest, navigation, offerExpired, rejectDriverOffer, request]);
  const offerMapPresentation = useMemo(
    () => resolvePrototypeMapPresentation({ role: "driver", status: "offered" }),
    [],
  );

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
          region={offerMapRegion}
          forceRegionUpdate
          userCoordinate={offerOriginCoordinate}
          userHeading={currentHeading}
          userAvatarLetter="M"
          driverCoordinate={offerOriginCoordinate}
          driverHeading={currentHeading}
          routeCoordinates={offerRouteCoordinates}
          routeTrafficSegments={offerRouteTrafficSegments}
          showTraffic={offerRouteTrafficSegments.length > 0}
          originCoordinate={offerMapOriginCoordinate}
          destinationCoordinate={offerMapDestinationCoordinate}
          destinationLabel={offerMapDestinationLabel}
          destinationAddress={offerMapDestinationAddress}
          originLabel={offerMapOriginLabel}
          originAddress={offerMapOriginAddress}
          viewportPadding={offerViewportPadding}
          routeViewportRegion={offerVisibleRouteRegion}
          onMapLayout={handleMapLayout}
          interactionEnabled={offerMapPresentation.interactionEnabled}
          hideRouteEndpointMarkers
          hideUserMarker
          animateRoute={offerMapPresentation.animateRoute}
          manualCameraHoldMs={offerMapPresentation.manualCameraHoldMs}
          driverMarkerMode="car"
          driverVehicleColor={offerVehicleColor}
          driverMarkerAssetUrl={vehicleMarkerCampaignAsset.imageUrl}
          driverMarkerLetter="M"
          destinationMarkerMode="avatar"
          destinationMarkerLetter={passengerInitial}
          mapSafetyProfile="driver"
        />
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          backdropDismissEnabled={!hasRequest}
          dragEnabled={!hasRequest}
          bottomGapFillColor={hasRequest ? "transparent" : "#FFFFFF"}
          sheetStyle={[styles.sheetWrap, { bottom: sheetBottom }]}
        >
          <RobotaxiLifecycleCard
            onLayout={handleCardLayout}
            style={[styles.offerCard, { maxHeight: offerCardMaxHeight }]}
            scrollEnabled
            showsVerticalScrollIndicator={detailsExpanded}
            testID="driver-offer-screen"
            accessibilityLabel="driver-offer-screen"
          >
            {hasRequest ? (
              <>
                <RobotaxiLifecycleSummary
                  eyebrow="NOVA CORRIDA"
                  title="Corrida próxima"
                  subtitle={`${offerCountdown.label} para responder`}
                  value={fareLabel}
                  valueLabel="líquido"
                  subtitleTestID={DRIVER_OFFER_FIELD_TEST_IDS.response_timer}
                  valueTestID={DRIVER_OFFER_FIELD_TEST_IDS.net_payout}
                />

                <RobotaxiLifecycleIdentity
                  name={passengerName}
                  meta={`Passageiro verificado · ${passengerRatingLabel}`}
                  initial={passengerInitial}
                  style={styles.passengerIdentity}
                  testID={DRIVER_OFFER_FIELD_TEST_IDS.passenger_verified_badge}
                  fieldTestIDs={{
                    avatar: DRIVER_OFFER_FIELD_TEST_IDS.passenger_photo,
                    name: DRIVER_OFFER_FIELD_TEST_IDS.passenger_name,
                    meta: DRIVER_OFFER_FIELD_TEST_IDS.passenger_rating,
                  }}
                />

                <View
                  style={styles.routeSummary}
                  testID="driver-offer-screen-summary"
                  accessibilityLabel={`Resumo da corrida. Embarque em ${pickupEtaLabel}, ${pickupDistanceLabel}. Viagem de ${tripDurationLabel}, ${tripDistanceLabel}. Total ${grossFareLabel}.`}
                >
                  <View
                    style={styles.routeStep}
                    testID={DRIVER_OFFER_FIELD_TEST_IDS.pickup_eta}
                  >
                    <Ionicons name="locate-outline" size={17} color={leafRideColors.text} />
                    <View style={styles.routeCopy}>
                      <Text style={styles.routeLabel}>EMBARQUE</Text>
                      <Text
                        style={styles.routeAddress}
                        numberOfLines={1}
                        testID={DRIVER_OFFER_FIELD_TEST_IDS.pickup_address}
                      >
                        {pickupLabel}
                      </Text>
                      <Text
                        style={styles.routeMeta}
                        numberOfLines={1}
                        testID={DRIVER_OFFER_FIELD_TEST_IDS.pickup_distance}
                      >
                        {pickupEtaLabel} · {pickupDistanceLabel} até o embarque
                      </Text>
                    </View>
                  </View>

                  <View
                    style={styles.routeStep}
                    testID={DRIVER_OFFER_FIELD_TEST_IDS.trip_duration}
                  >
                    <Ionicons name="location-outline" size={17} color={leafRideColors.leaf} />
                    <View style={styles.routeCopy}>
                      <Text style={styles.routeLabel}>DESTINO</Text>
                      <Text
                        style={styles.routeAddress}
                        numberOfLines={1}
                        testID={DRIVER_OFFER_FIELD_TEST_IDS.destination_address}
                      >
                        {dropoffLabel}
                      </Text>
                      <Text
                        style={styles.routeMeta}
                        numberOfLines={1}
                        testID={DRIVER_OFFER_FIELD_TEST_IDS.trip_distance}
                      >
                        {tripDurationLabel} · {tripDistanceLabel} de viagem
                      </Text>
                    </View>
                  </View>
                </View>

                <RobotaxiLifecycleDisclosure
                  expanded={detailsExpanded}
                  onPress={() => setDetailsExpanded((current) => !current)}
                  label="Ver detalhes"
                  expandedLabel="Ocultar detalhes"
                  style={styles.detailsButton}
                  testID="driver-offer-details-button"
                />

                {detailsExpanded ? (
                  <RobotaxiLifecycleSection title="DETALHES DA CORRIDA">
                    <View
                      style={styles.confirmedLine}
                      testID={DRIVER_OFFER_FIELD_TEST_IDS.payment_confirmed}
                    >
                      <Ionicons name="checkmark-circle-outline" size={17} color={leafRideColors.leaf} />
                      <View style={styles.confirmedCopy}>
                        <Text style={styles.confirmedTitle}>Pagamento confirmado</Text>
                        <Text
                          style={styles.confirmedText}
                          testID={DRIVER_OFFER_FIELD_TEST_IDS.gross_fare}
                        >
                          Passageiro pagou {grossFareLabel} via Pix
                        </Text>
                      </View>
                    </View>

                    {ridePreferenceItems.length > 0 ? (
                      <View
                        style={styles.preferencePanel}
                        testID={DRIVER_OFFER_FIELD_TEST_IDS.ride_preferences}
                        accessibilityLabel="Preferências do passageiro"
                      >
                        <Text style={styles.preferenceLabel}>Preferências</Text>
                        <Text style={styles.preferenceText}>
                          {ridePreferenceItems.map((item) => item.label).join(" · ")}
                        </Text>
                      </View>
                    ) : null}

                    <RobotaxiLifecycleButton
                      label={busyAction === "reject" ? "Recusando..." : "Recusar"}
                      tone="danger"
                      disabled={Boolean(busyAction) || offerExpired}
                      onPress={handleReject}
                      style={styles.rejectButton}
                      testID={DRIVER_OFFER_FIELD_TEST_IDS.reject_action}
                      accessibilityLabel="driver-offer-screen-reject-button"
                    />
                  </RobotaxiLifecycleSection>
                ) : null}

                <RobotaxiLifecycleButton
                  label={
                    busyAction === "accept"
                      ? "Aceitando..."
                      : "Aceitar corrida"
                  }
                  tone="primary"
                  icon="checkmark-outline"
                  disabled={Boolean(busyAction) || offerExpired}
                  onPress={handleAccept}
                  style={styles.acceptButton}
                  testID={DRIVER_OFFER_FIELD_TEST_IDS.accept_action}
                  accessibilityLabel="driver-offer-screen-accept-button"
                />
              </>
            ) : (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>Sem corrida no momento</Text>
                <Text style={styles.emptyText}>
                  A próxima oferta aparece aqui quando houver solicitação ativa.
                </Text>
                <LeafButton
                  label="Voltar para o mapa"
                  tone="primary"
                  onPress={() => navigation.navigate("RobotaxiPrototype")}
                  style={styles.emptyButton}
                />
              </View>
            )}

            {visibleLastError ? (
              <Text style={styles.errorText}>{visibleLastError}</Text>
            ) : null}
          </RobotaxiLifecycleCard>
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
  offerCard: {
    marginHorizontal: robotaxiLifecycleMetrics.cardHorizontalMargin,
  },
  passengerIdentity: {
    marginTop: 16,
  },
  routeSummary: {
    marginTop: 16,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: leafRideColors.line,
    paddingVertical: 10,
    gap: 8,
  },
  routeStep: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  routeCopy: {
    flex: 1,
    minWidth: 0,
  },
  routeMeta: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14,
    marginTop: 2,
  },
  routeAddress: {
    color: leafRideColors.text,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 18,
  },
  routeLabel: {
    color: leafRideColors.muted,
    fontFamily: fonts.Medium,
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.5,
  },
  detailsButton: {
    marginTop: 16,
  },
  confirmedLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  confirmedCopy: {
    flex: 1,
    minWidth: 0,
  },
  confirmedTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
  },
  confirmedText: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  preferencePanel: {
    marginTop: 14,
  },
  preferenceLabel: {
    color: leafRideColors.muted,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 14,
  },
  preferenceText: {
    marginTop: 3,
    color: leafRideColors.text,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  rejectButton: {
    marginTop: 14,
    width: "100%",
  },
  acceptButton: {
    marginTop: 12,
    width: "100%",
  },
  emptyWrap: {
    paddingTop: 6,
  },
  emptyTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  emptyText: {
    marginTop: 4,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 13,
    lineHeight: 17,
  },
  emptyButton: {
    marginTop: 18,
    alignSelf: "flex-start",
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
