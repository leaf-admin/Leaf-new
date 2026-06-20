import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  InteractionManager,
  Keyboard,
  LayoutAnimation,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
  useWindowDimensions,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, { Easing, FadeIn } from "react-native-reanimated";
import { useSelector } from "react-redux";
import { ExpoSpeechRecognitionModule } from "expo-speech-recognition";
import { Ionicons } from "@expo/vector-icons";
import { fonts } from "../../theme/runtimeTokens";
import PrototypeScreenTransition from "../../components/prototype/PrototypeScreenTransition";
import PrototypeDismissibleSheet from "../../components/prototype/PrototypeDismissibleSheet";
import PrototypeConnectionStatusPill from "../../components/prototype/PrototypeConnectionStatusPill";
import {
  LeafButton,
  LeafDivider,
  LeafInfoRow,
  LeafRideSheet,
  leafButtonMetrics,
  leafRideColors,
} from "../../components/prototype/LeafRideUI";
import WooviPaymentModal from "../../components/payment/WooviPaymentModal";
import SecurePaymentBadge from "../../components/payment/SecurePaymentBadge";
import robotaxiPrototypeTokens from "../../components/design-system/robotaxiPrototypeTokens";
import { isE2ETestBuild } from "../../config/runtimeAccessPolicy";
import { usePrototypeMapOcclusion } from "./prototypeMapOcclusion";
import { usePrototypeRideRuntime } from "./prototypeRideRuntime";
import { resolvePassengerAutoRoute } from "./passengerFlowRouting";
import { resolveDestinationAutomationConfig } from "./destinationAutomationConfig";
import { resolveMeaningfulAddress } from "./addressLabelUtils";
import WebSocketManager from "../../services/WebSocketManager";
import {
  buildPrototypeConnectionIndicatorModel,
  resolvePrototypeConnectionAutomationConfig,
  shouldRunPrototypeConnectionAutomation,
} from "./prototypeConnectionStatus";
import { PROTOTYPE_ORIGIN_COORDINATE } from "./robotaxiPrototypeData";
import {
  clearPrototypeMapRoute,
  setPrototypeMapRoute,
  subscribePrototypeMapCamera,
} from "./prototypeMapRoute";
import { fetchDynamicPricingQuote } from "../../services/runtime/pricingQuoteService";
import {
  buildRidePaymentRouteContextKey,
  clearRidePaymentSession,
  findRecoverableRidePaymentSession,
} from "../../services/RidePaymentSessionService";

const { motion } = robotaxiPrototypeTokens;
const SEARCH_STEP = "search";
const PICKUP_STEP = "pickup";
const QUOTE_STEP = "quote";
const CONFIRM_STEP = "confirm";
const SEARCH_RESULT_LIMIT = 3;
const SEARCH_BOTTOM_OFFSET = 0;
const SHEET_MIN_BOTTOM_MARGIN = 10;
const SEARCH_KEYBOARD_CLEARANCE = 8;
const SEARCH_FALLBACK_HEIGHT = 266;
const PICKUP_FALLBACK_HEIGHT = 590;
const PICKUP_FLOATING_CARD_FALLBACK_HEIGHT = 144;
const QUOTE_FALLBACK_HEIGHT = 322;
const CONFIRM_FALLBACK_HEIGHT = 392;
const PREFERENCE_CONFIRMATION_TIMEOUT_MS = 5000;
const PREFERENCE_CONFIRMATION_TICK_MS = 80;
const PASSENGER_QUOTE_VALIDITY_MS = Math.max(
  15000,
  Number.parseInt(process.env.EXPO_PUBLIC_QUOTE_VALIDITY_MS || "120000", 10) ||
    120000,
);
const PASSENGER_QUOTE_COORDINATE_PRECISION = Math.max(
  2,
  Number.parseInt(
    process.env.EXPO_PUBLIC_QUOTE_LOCK_COORDINATE_PRECISION || "3",
    10,
  ) || 3,
);
const ORIGIN_ADDRESS = "Rua das Pastorinhas, Taquara, Rio de Janeiro";
const TEMPERATURE_OPTIONS = Object.freeze([
  {
    id: "cool",
    label: "Ar fresco",
    driverLabel: "Ar-condicionado ligado",
    description: "Cabine mais fria",
  },
  {
    id: "neutral",
    label: "Neutro",
    driverLabel: "Temperatura neutra",
    description: "Sem ajuste especial",
  },
  {
    id: "warm",
    label: "Mais quente",
    driverLabel: "Cabine mais quente",
    description: "Reduzir o ar",
  },
]);
const SOUND_OPTIONS = Object.freeze([
  {
    id: "quiet",
    label: "Silêncio",
    driverLabel: "Pouca conversa",
    description: "Sem música",
    musicPreference: "off",
    conversationPreference: "quiet",
  },
  {
    id: "low_music",
    label: "Música baixa",
    driverLabel: "Música baixa",
    description: "Viagem tranquila",
    musicPreference: "low",
    conversationPreference: "quiet",
  },
  {
    id: "open",
    label: "Pode conversar",
    driverLabel: "Conversa liberada",
    description: "Som ambiente",
    musicPreference: "low",
    conversationPreference: "open",
  },
]);
const MAX_OPERATIONAL_ROUTE_DISTANCE_KM = Math.max(
  80,
  Number.parseFloat(
    process.env.EXPO_PUBLIC_MAX_OPERATIONAL_ROUTE_DISTANCE_KM || "120",
  ) || 120,
);
const OUT_OF_COVERAGE_MESSAGE = "Destino fora da area de cobertura da Leaf";
const LEGACY_ROUTE_GUARD_MESSAGE_REGEX =
  /origem e destino inconsistentes para a (área|area) de opera(ç|c)ão da leaf/i;
const REGION_UNAVAILABLE_MESSAGE_REGEX = /regi(ã|a)o indispon(i|í)vel/i;
const stepEasing = Easing.bezier(...motion.bezier.snappy);
const FINAL_AVAILABILITY_RECHECK_DELAY_MS = 900;

const waitForFinalAvailabilityRecheck = () =>
  new Promise((resolve) =>
    setTimeout(resolve, FINAL_AVAILABILITY_RECHECK_DELAY_MS),
  );

function isNoDriversAvailabilityResult(availability) {
  const code = String(availability?.code || "").toUpperCase();
  const message = String(
    availability?.message || availability?.error || "",
  ).toLowerCase();
  return (
    code === "NO_DRIVERS_AVAILABLE" ||
    code === "NO_DRIVERS_FOUND" ||
    /não há motoristas|nao ha motoristas|sem motoristas/.test(message)
  );
}

function buildFinalAvailabilityRequestId(planId, attempt) {
  return `passenger_confirm_${String(planId || "plan")}_${attempt}_${Date.now().toString(36)}`;
}

function resolveLeafDelasRequested(params = {}) {
  return (
    params?.leafDelas === true ||
    params?.leafDelas === "true" ||
    params?.femaleDriverOnly === true ||
    params?.femaleDriverOnly === "true" ||
    params?.preferences?.leafDelas === true ||
    params?.preferences?.femaleDriverOnly === true
  );
}

if (
  Platform.OS === "android" &&
  typeof UIManager.setLayoutAnimationEnabledExperimental === "function"
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const DEFAULT_PLAN_RATE_CARDS = Object.freeze({
  plus: {
    name: "Leaf Plus",
    base_fare: 2.79,
    fixed_fee: 1.1,
    rate_per_hour: 15.6,
    rate_per_unit_distance: 1.53,
    min_fare: 8.5,
  },
  elite: {
    name: "Leaf Elite",
    base_fare: 4.98,
    fixed_fee: 1.8,
    rate_per_hour: 17.4,
    rate_per_unit_distance: 2.41,
    min_fare: 10.5,
  },
  moto: {
    name: "Leaf Moto",
    base_fare: 2.18,
    fixed_fee: 0.86,
    rate_per_hour: 12.17,
    rate_per_unit_distance: 1.19,
    min_fare: 6.9,
  },
});

function getPlanIdFromCarName(name) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase();
  if (normalized.includes("elite") || normalized === "premium") return "elite";
  if (
    normalized.includes("moto") ||
    normalized.includes("motorcycle") ||
    normalized.includes("bike")
  )
    return "moto";
  if (
    normalized.includes("plus") ||
    normalized.includes("standard") ||
    normalized.includes("econ") ||
    normalized === "basic"
  ) {
    return "plus";
  }
  return null;
}

function calculateBusinessFare(distanceKm, durationMin, rateCard) {
  const distance = Number(distanceKm) || 0;
  const durationHours = (Number(durationMin) || 0) / 60;

  const baseFare = Number(rateCard?.base_fare) || 0;
  const fixedFee = Number(rateCard?.fixed_fee) || 0;
  const ratePerKm = Number(rateCard?.rate_per_unit_distance) || 0;
  const ratePerHour = Number(rateCard?.rate_per_hour) || 0;
  const minFare = Number(rateCard?.min_fare) || 0;

  const subtotal =
    baseFare + fixedFee + distance * ratePerKm + durationHours * ratePerHour;
  return Number(Math.max(subtotal, minFare).toFixed(2));
}

function formatCurrency(value) {
  return `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function createPassengerQuoteSessionId(createdAt = Date.now()) {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `passenger_quote_${createdAt}_${randomSuffix}`;
}

function normalizeCoverageMessage(message) {
  const normalized = String(message || "").trim();
  if (!normalized) {
    return "";
  }
  if (LEGACY_ROUTE_GUARD_MESSAGE_REGEX.test(normalized)) {
    return OUT_OF_COVERAGE_MESSAGE;
  }
  if (/destino fora da (área|area) de cobertura da leaf/i.test(normalized)) {
    return OUT_OF_COVERAGE_MESSAGE;
  }
  if (REGION_UNAVAILABLE_MESSAGE_REGEX.test(normalized)) {
    return OUT_OF_COVERAGE_MESSAGE;
  }
  return normalized;
}

function normalizeAddressText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function inferCountryFromAddress(addressText) {
  const normalized = normalizeAddressText(addressText);
  if (!normalized) {
    return null;
  }

  if (/\b(united states|usa|california|san francisco)\b/.test(normalized)) {
    return "US";
  }

  if (
    /\b(brasil|brazil|rio de janeiro|sao paulo|santos dumont|rj)\b/.test(
      normalized,
    )
  ) {
    return "BR";
  }

  return null;
}

function calculateStraightDistanceKm(origin, destination) {
  const originLat = Number(origin?.latitude);
  const originLng = Number(origin?.longitude);
  const destinationLat = Number(destination?.latitude);
  const destinationLng = Number(destination?.longitude);

  if (
    !Number.isFinite(originLat) ||
    !Number.isFinite(originLng) ||
    !Number.isFinite(destinationLat) ||
    !Number.isFinite(destinationLng)
  ) {
    return null;
  }

  const earthRadiusKm = 6371;
  const toRad = (value) => (value * Math.PI) / 180;
  const dLat = toRad(destinationLat - originLat);
  const dLng = toRad(destinationLng - originLng);
  const lat1 = toRad(originLat);
  const lat2 = toRad(destinationLat);
  const haversine =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return Number((earthRadiusKm * arc).toFixed(2));
}

function normalizePreviewCoordinate(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function buildPassengerFareQuoteRouteKey({
  originCoordinate,
  destinationCoordinate,
}) {
  const origin = normalizePreviewCoordinate(originCoordinate);
  const destination = normalizePreviewCoordinate(destinationCoordinate);

  if (!origin || !destination) {
    return "";
  }

  return [
    Number(origin.latitude).toFixed(PASSENGER_QUOTE_COORDINATE_PRECISION),
    Number(origin.longitude).toFixed(PASSENGER_QUOTE_COORDINATE_PRECISION),
    Number(destination.latitude).toFixed(PASSENGER_QUOTE_COORDINATE_PRECISION),
    Number(destination.longitude).toFixed(PASSENGER_QUOTE_COORDINATE_PRECISION),
  ].join("|");
}

function normalizeLockedQuoteNumber(value, fallback = null) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }
  return numericValue;
}

function normalizeInitialSelectedDestination(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const coordinate =
    normalizePreviewCoordinate(value.coordinate) ||
    normalizePreviewCoordinate({
      latitude: value.latitude ?? value.lat,
      longitude: value.longitude ?? value.lng,
    });

  if (!coordinate) {
    return null;
  }

  const name = String(value.name || value.title || value.address || "Destino").trim();
  const address = String(value.address || value.description || name).trim();

  return {
    ...value,
    id: value.id || `${name}-${coordinate.latitude}-${coordinate.longitude}`,
    name,
    address,
    coordinate,
  };
}

function normalizeInitialPricingQuote(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const rawQuote =
    value.quote && typeof value.quote === "object" ? value.quote : value;
  const estimatedFare = normalizeLockedQuoteNumber(
    rawQuote.estimatedFare ?? value.fare,
  );

  if (!estimatedFare) {
    return null;
  }

  const grossEstimatedFare =
    normalizeLockedQuoteNumber(
      rawQuote.grossEstimatedFare ?? value.grossEstimatedFare,
      estimatedFare,
    ) || estimatedFare;
  const createdAt = Number(value.createdAt) || Date.now();

  return {
    quote: {
      ...rawQuote,
      estimatedFare,
      grossEstimatedFare,
    },
    quoteSessionId:
      String(value.quoteSessionId || rawQuote.quoteSessionId || "").trim() ||
      null,
    routeKey: String(value.routeKey || "").trim(),
    distanceKm: normalizeLockedQuoteNumber(value.distanceKm),
    durationMin: normalizeLockedQuoteNumber(value.durationMin),
    arrivalTime: String(value.arrivalTime || "").trim(),
    createdAt,
    expiresAt:
      Number(value.expiresAt) ||
      Number(rawQuote.expiresAt) ||
      createdAt + PASSENGER_QUOTE_VALIDITY_MS,
  };
}

function resolveOption(options, selectedId) {
  return options.find((item) => item.id === selectedId) || options[0];
}

function buildPickupLocationPayload(coordinate, address) {
  const normalizedCoordinate = normalizePreviewCoordinate(coordinate);
  if (!normalizedCoordinate) {
    return null;
  }

  const resolvedAddress =
    resolveMeaningfulAddress(address, ORIGIN_ADDRESS) || ORIGIN_ADDRESS;

  return {
    lat: normalizedCoordinate.latitude,
    lng: normalizedCoordinate.longitude,
    latitude: normalizedCoordinate.latitude,
    longitude: normalizedCoordinate.longitude,
    add: resolvedAddress,
    address: resolvedAddress,
  };
}

function resolveInitialPickupCoordinate(params = {}) {
  const candidate =
    params.initialPickupCoordinate ||
    params.pickupCoordinate ||
    params.pickupLocation ||
    null;

  return normalizePreviewCoordinate({
    latitude: candidate?.latitude ?? candidate?.lat,
    longitude: candidate?.longitude ?? candidate?.lng,
  });
}

function resolveInitialPickupAddress(params = {}) {
  return resolveMeaningfulAddress(
    params.initialPickupAddress ||
      params.pickupAddress ||
      params.pickupLocation?.address ||
      params.pickupLocation?.add ||
      "",
    "",
  );
}

export default function RobotaxiDestinationScreen({ navigation, route }) {
  const {
    bookingStatus,
    currentAddress,
    currentCoordinate,
    driverInfo,
    activeRole,
    connecting,
    profileUid,
    riderProfile,
    isSocketAuthenticated,
    isSocketConnected,
    selectedVehicle,
    selectedFare,
    selectedDestination: runtimeSelectedDestination,
    tripDistanceKm: runtimeTripDistanceKm,
    tripDurationMin: runtimeTripDurationMin,
    tripArrivalText: runtimeTripArrivalText,
    loadDestinationSuggestions,
    loadRecentDestinations,
    resolveDestinationInput,
    selectDestination,
    checkRideAvailability,
    requestRide,
    requestTripExtension,
    clearFlowPreview,
  } = usePrototypeRideRuntime();
  const routeParams = route?.params || {};
  const initialPickupCoordinate = resolveInitialPickupCoordinate(routeParams);
  const initialPickupAddress = resolveInitialPickupAddress(routeParams);
  const initialSelectedDestination = useMemo(
    () => normalizeInitialSelectedDestination(routeParams.initialSelectedDestination),
    [routeParams.initialSelectedDestination],
  );
  const initialPricingQuote = useMemo(
    () => normalizeInitialPricingQuote(routeParams.initialPricingQuote),
    [routeParams.initialPricingQuote],
  );
  const initialSelectedPlan = getPlanIdFromCarName(routeParams.initialSelectedPlan || "");
  const startAtConfirmation =
    routeParams.startAtConfirmation === true ||
    routeParams.startAtConfirmation === "true" ||
    routeParams.startAtConfirmation === "1";
  const initialPickupAdjustedOnMap =
    routeParams.initialPickupAdjustedOnMap === true ||
    routeParams.initialPickupAdjustedOnMap === "true" ||
    routeParams.initialPickupAdjustedOnMap === "1";
  const catalogCars = useSelector((state) => state?.cartypes?.cars || []);
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const [query, setQuery] = useState("");
  const [step, setStep] = useState(SEARCH_STEP);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [selectedPlan, setSelectedPlan] = useState(initialSelectedPlan || "plus");
  const [isPixModalVisible, setPixModalVisible] = useState(false);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [checkingPlanAvailability, setCheckingPlanAvailability] =
    useState(false);
  const [availabilityNotice, setAvailabilityNotice] = useState("");
  const [planAvailabilityById, setPlanAvailabilityById] = useState({});
  const [selectedPricingQuote, setSelectedPricingQuote] = useState(
    () => initialPricingQuote?.quote || null,
  );
  const [pricingQuoteLoading, setPricingQuoteLoading] = useState(false);
  const [pricingQuoteError, setPricingQuoteError] = useState("");
  const [paymentQuoteLock, setPaymentQuoteLock] = useState(null);
  const [submittingRide, setSubmittingRide] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(SEARCH_FALLBACK_HEIGHT);
  const [recentDestinations, setRecentDestinations] = useState([]);
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceStarting, setVoiceStarting] = useState(false);
  const [voiceError, setVoiceError] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [showRecoveredConnectionHint, setShowRecoveredConnectionHint] =
    useState(false);
  const [qaConnectionVisualState, setQaConnectionVisualState] = useState(null);
  const [leafDelasEnabled, setLeafDelasEnabled] = useState(() =>
    resolveLeafDelasRequested(route?.params || {}),
  );
  const [pickupCoordinate, setPickupCoordinate] = useState(
    () => initialPickupCoordinate,
  );
  const [pickupAddress, setPickupAddress] = useState(
    () => initialPickupAddress,
  );
  const [pickupAdjustedOnMap, setPickupAdjustedOnMap] = useState(
    () => initialPickupAdjustedOnMap,
  );
  const [temperaturePreference, setTemperaturePreference] = useState("cool");
  const [soundPreference, setSoundPreference] = useState("quiet");
  const [pickupFloatingCardHeight, setPickupFloatingCardHeight] = useState(
    PICKUP_FLOATING_CARD_FALLBACK_HEIGHT,
  );
  const [fareQuoteLock, setFareQuoteLock] = useState(null);
  const [preferenceModalVisible, setPreferenceModalVisible] = useState(false);
  const [preferenceProgress, setPreferenceProgress] = useState(0);
  const voiceAutoStartedRef = useRef(false);
  const lastAutoRouteRef = useRef("");
  const destinationInputRef = useRef(null);
  const lastConnectionHealthyRef = useRef(true);
  const connectionRecoveredTimerRef = useRef(null);
  const connectionAutomationExecutionRef = useRef("");
  const connectionAutomationTimersRef = useRef([]);
  const latestRidePreferencesRef = useRef(null);
  const pendingPaymentConfirmationRef = useRef(null);
  const paymentRecoveryAttemptedRef = useRef("");
  const initialSelectedDestinationHydratedRef = useRef(false);
  const loadRecentDestinationsRef = useRef(loadRecentDestinations);
  const checkRideAvailabilityRef = useRef(checkRideAvailability);
  const selectedPricingQuoteCacheRef = useRef({});
  const autoStartVoiceRequested =
    route?.params?.autoStartVoice === true ||
    route?.params?.autoStartVoice === "true" ||
    route?.params?.autoStartVoice === "1";
  const isExtensionFlow = route?.params?.mode === "extension";

  useEffect(() => {
    if (resolveLeafDelasRequested(route?.params || {})) {
      setLeafDelasEnabled(true);
    }
  }, [route?.params]);

  useEffect(() => {
    loadRecentDestinationsRef.current = loadRecentDestinations;
  }, [loadRecentDestinations]);

  useEffect(() => {
    checkRideAvailabilityRef.current = checkRideAvailability;
  }, [checkRideAvailability]);

  const selectedTemperatureOption = useMemo(
    () => resolveOption(TEMPERATURE_OPTIONS, temperaturePreference),
    [temperaturePreference],
  );
  const selectedSoundOption = useMemo(
    () => resolveOption(SOUND_OPTIONS, soundPreference),
    [soundPreference],
  );
  const rideComfortPreferences = useMemo(
    () => ({
      comfortMode: "leaf_comfort",
      temperaturePreference: selectedTemperatureOption.id,
      temperatureLabel: selectedTemperatureOption.driverLabel,
      soundPreference: selectedSoundOption.id,
      soundLabel: selectedSoundOption.driverLabel,
      musicPreference: selectedSoundOption.musicPreference,
      conversationPreference: selectedSoundOption.conversationPreference,
      comfort: {
        temperature: {
          id: selectedTemperatureOption.id,
          label: selectedTemperatureOption.driverLabel,
        },
        sound: {
          id: selectedSoundOption.id,
          label: selectedSoundOption.driverLabel,
          musicPreference: selectedSoundOption.musicPreference,
          conversationPreference: selectedSoundOption.conversationPreference,
        },
      },
    }),
    [selectedSoundOption, selectedTemperatureOption],
  );

  const ridePreferences = useMemo(() => {
    const routePreferences =
      route?.params?.preferences && typeof route.params.preferences === "object"
        ? { ...route.params.preferences }
        : {};

    if (!leafDelasEnabled) {
      delete routePreferences.leafDelas;
      delete routePreferences.femaleDriverOnly;
      return {
        ...routePreferences,
        ...rideComfortPreferences,
      };
    }

    return {
      ...routePreferences,
      ...rideComfortPreferences,
      leafDelas: true,
      femaleDriverOnly: true,
    };
  }, [
    leafDelasEnabled,
    rideComfortPreferences,
    route?.params?.preferences,
  ]);

  useEffect(() => {
    latestRidePreferencesRef.current = ridePreferences;
  }, [ridePreferences]);

  const automationConfig = useMemo(
    () =>
      resolveDestinationAutomationConfig(route?.params || {}, {
        isExtensionFlow,
        isDev: __DEV__,
        isE2E: isE2ETestBuild(),
      }),
    [isExtensionFlow, route?.params],
  );
  const qaAutoFlowMode = automationConfig.autoFlowMode;
  const qaAutoSelectFirst = automationConfig.autoSelectFirst;
  const qaAutoOpenPix = automationConfig.autoOpenPix;
  const qaAutoConfirmPix = automationConfig.autoConfirmPix;
  const qaAutomationNonce = automationConfig.nonce;
  const qaPresetQuery = automationConfig.presetQuery;
  const returnRouteName =
    route?.params?.returnRouteName || "RobotaxiPrototypeTrip";
  const qaAutoSelectStartedRef = useRef(false);
  const qaAutoPixOpenedRef = useRef(false);
  const qaAutoPixConfirmedRef = useRef(false);
  const submittingRideGuardRef = useRef(false);
  const lastHandledPaymentChargeIdRef = useRef("");
  const qaPresetQueryAppliedRef = useRef(false);
  const [qaPresetSearchCompleted, setQaPresetSearchCompleted] = useState(
    !automationConfig.presetQuery,
  );
  const passengerAutoRoute = useMemo(
    () => resolvePassengerAutoRoute(bookingStatus),
    [bookingStatus],
  );
  const qaAutomationExecutionKey = useMemo(
    () =>
      [
        automationConfig.automationEnabled ? "1" : "0",
        qaAutoFlowMode || "",
        qaPresetQuery || "",
        qaAutomationNonce || "",
        isExtensionFlow ? "extension" : "request",
      ].join("|"),
    [
      automationConfig.automationEnabled,
      isExtensionFlow,
      qaAutoFlowMode,
      qaAutomationNonce,
      qaPresetQuery,
    ],
  );
  const qaConnectionAutomationConfig = useMemo(
    () =>
      resolvePrototypeConnectionAutomationConfig(route?.params || {}, {
        activeRole: activeRole || "customer",
        isDev: __DEV__,
        isE2E: isE2ETestBuild(),
      }),
    [activeRole, route?.params],
  );
  const connectionIndicatorModel = useMemo(
    () =>
      buildPrototypeConnectionIndicatorModel({
        activeRole: activeRole || "customer",
        bookingStatus: "quote",
        driverOnline: false,
        driverOnlinePending: false,
        connecting,
        isSocketConnected,
        isSocketAuthenticated,
        requiresAuthentication: Boolean(profileUid),
        recentlyRecovered: showRecoveredConnectionHint,
      }),
    [
      activeRole,
      connecting,
      isSocketAuthenticated,
      isSocketConnected,
      profileUid,
      showRecoveredConnectionHint,
    ],
  );
  const effectiveConnectionIndicatorModel = useMemo(() => {
    if (!qaConnectionVisualState?.mode) {
      return connectionIndicatorModel;
    }

    const indicatorBase = {
      activeRole: activeRole || "customer",
      bookingStatus: "quote",
      driverOnline: false,
      driverOnlinePending: false,
      requiresAuthentication: Boolean(profileUid),
      forceVisible: true,
    };

    if (qaConnectionVisualState.mode === "lost") {
      return buildPrototypeConnectionIndicatorModel({
        ...indicatorBase,
        connecting: false,
        isSocketConnected: false,
        isSocketAuthenticated: false,
        recentlyRecovered: false,
      });
    }

    if (qaConnectionVisualState.mode === "reconnecting") {
      return buildPrototypeConnectionIndicatorModel({
        ...indicatorBase,
        connecting: true,
        isSocketConnected: false,
        isSocketAuthenticated: false,
        recentlyRecovered: false,
      });
    }

    if (qaConnectionVisualState.mode === "recovered") {
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
    activeRole,
    connectionIndicatorModel,
    profileUid,
    qaConnectionVisualState?.mode,
  ]);
  const connectionIndicatorTopOffset = useMemo(() => insets.top + 14, [insets.top]);
  const searchContextualStrings = useMemo(
    () => [
      ...recentDestinations.map((item) => item?.name).filter(Boolean),
      ...recentDestinations.map((item) => item?.address).filter(Boolean),
      "Leaf Plus",
      "Leaf Elite",
      "Leaf Moto",
    ],
    [recentDestinations],
  );

  useEffect(() => {
    qaAutoSelectStartedRef.current = false;
    qaAutoPixOpenedRef.current = false;
    qaAutoPixConfirmedRef.current = false;
    qaPresetQueryAppliedRef.current = false;
    setQaPresetSearchCompleted(!qaPresetQuery);
  }, [qaAutomationExecutionKey, qaPresetQuery]);

  useEffect(() => {
    let cancelled = false;

    const hydrateRecentDestinations = async () => {
      try {
        const history = await loadRecentDestinationsRef.current();
        if (cancelled) {
          return;
        }

        const safeHistory = Array.isArray(history)
          ? history.slice(0, SEARCH_RESULT_LIMIT)
          : [];
        setRecentDestinations(safeHistory);
        setResults((current) => (current.length > 0 ? current : safeHistory));
      } catch (_error) {
        if (!cancelled) {
          setRecentDestinations([]);
        }
      }
    };

    hydrateRecentDestinations();

    return () => {
      cancelled = true;
    };
  }, [profileUid]);

  useEffect(() => {
    let cancelled = false;

    const executeSearch = async () => {
      const trimmedQuery = query.trim();
      const normalizedTrimmedQuery = trimmedQuery.toLowerCase();
      const normalizedPresetQuery = String(qaPresetQuery || "")
        .trim()
        .toLowerCase();
      const matchesPresetQuery =
        Boolean(normalizedPresetQuery) &&
        normalizedTrimmedQuery === normalizedPresetQuery;
      if (!trimmedQuery) {
        setSearching(false);
        setResults(recentDestinations);
        if (!normalizedPresetQuery) {
          setQaPresetSearchCompleted(true);
        }
        return;
      }
      if (trimmedQuery.length < 3) {
        setSearching(false);
        setResults([]);
        return;
      }

      try {
        setSearching(true);
        const response = await loadDestinationSuggestions(trimmedQuery);
        if (cancelled) {
          return;
        }

        if (Array.isArray(response) && response.length > 0) {
          setResults(response);
        } else {
          setResults([]);
        }
      } catch (error) {
        if (!cancelled) {
          setResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearching(false);
          if (matchesPresetQuery) {
            setQaPresetSearchCompleted(true);
          }
        }
      }
    };

    const timer = setTimeout(executeSearch, query.trim() ? 520 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [loadDestinationSuggestions, qaPresetQuery, query, recentDestinations]);

  useEffect(() => {
    if (!qaPresetQuery || qaPresetQueryAppliedRef.current) {
      return;
    }

    qaPresetQueryAppliedRef.current = true;
    setQaPresetSearchCompleted(false);
    setQuery(qaPresetQuery);

    const task = InteractionManager.runAfterInteractions(() => {
      destinationInputRef.current?.focus?.();
    });

    return () => {
      if (typeof task?.cancel === "function") {
        task.cancel();
      }
    };
  }, [qaPresetQuery]);

  useEffect(() => {
    const keyboardShowEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const keyboardHideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const handleKeyboardShow = (event) => {
      const nextKeyboardHeight = Math.max(
        0,
        Number(event?.endCoordinates?.height) || 0,
      );
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardHeight(nextKeyboardHeight);
    };

    const handleKeyboardHide = () => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setKeyboardHeight(0);
    };

    const showSubscription = Keyboard.addListener(
      keyboardShowEvent,
      handleKeyboardShow,
    );
    const hideSubscription = Keyboard.addListener(
      keyboardHideEvent,
      handleKeyboardHide,
    );

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (step !== SEARCH_STEP || autoStartVoiceRequested) {
      return undefined;
    }

    let cancelled = false;
    const interaction = InteractionManager.runAfterInteractions(() => {
      const timer = setTimeout(() => {
        if (!cancelled) {
          destinationInputRef.current?.focus?.();
        }
      }, 140);

      if (cancelled) {
        clearTimeout(timer);
      }
    });

    return () => {
      cancelled = true;
      interaction?.cancel?.();
    };
  }, [autoStartVoiceRequested, step]);

  useEffect(() => {
    const onResult = (event) => {
      const transcript = String(event?.results?.[0]?.transcript || "").trim();
      if (transcript) {
        setQuery(transcript);
        setVoiceError("");
      }

      if (event?.isFinal) {
        setVoiceListening(false);
        setVoiceStarting(false);
      }
    };

    const onStart = () => {
      setVoiceListening(true);
      setVoiceStarting(false);
      setVoiceError("");
    };

    const onEnd = () => {
      setVoiceListening(false);
      setVoiceStarting(false);
    };

    const onError = (event) => {
      const message = String(
        event?.message || "Não foi possível capturar voz agora.",
      );
      setVoiceListening(false);
      setVoiceStarting(false);
      setVoiceError(message);
    };

    const resultSubscription = ExpoSpeechRecognitionModule.addListener(
      "result",
      onResult,
    );
    const startSubscription = ExpoSpeechRecognitionModule.addListener(
      "start",
      onStart,
    );
    const endSubscription = ExpoSpeechRecognitionModule.addListener(
      "end",
      onEnd,
    );
    const errorSubscription = ExpoSpeechRecognitionModule.addListener(
      "error",
      onError,
    );

    return () => {
      resultSubscription?.remove();
      startSubscription?.remove();
      endSubscription?.remove();
      errorSubscription?.remove();
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (_error) {
        // no-op
      }
    };
  }, []);

  const handleToggleVoiceSearch = useCallback(async () => {
    if (voiceStarting) {
      return;
    }

    if (voiceListening) {
      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (_error) {
        setVoiceListening(false);
        setVoiceStarting(false);
      }
      return;
    }

    try {
      if (
        typeof ExpoSpeechRecognitionModule.isRecognitionAvailable === "function"
      ) {
        const available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
        if (!available) {
          Alert.alert(
            "Reconhecimento de voz indisponível",
            "Este dispositivo não suporta captura de destino por voz no momento.",
          );
          return;
        }
      }

      const permission =
        await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission?.granted) {
        Alert.alert(
          "Permissão necessária",
          "Autorize o microfone para preencher o destino por voz.",
        );
        return;
      }

      setVoiceStarting(true);
      setVoiceError("");
      ExpoSpeechRecognitionModule.start({
        lang: "pt-BR",
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        addsPunctuation: true,
        contextualStrings: searchContextualStrings,
      });
    } catch (error) {
      setVoiceListening(false);
      setVoiceStarting(false);
      setVoiceError(
        String(error?.message || "Não foi possível iniciar a captura por voz."),
      );
    }
  }, [searchContextualStrings, voiceListening, voiceStarting]);

  useEffect(() => {
    if (!autoStartVoiceRequested || voiceAutoStartedRef.current) {
      return;
    }

    voiceAutoStartedRef.current = true;
    const timer = setTimeout(() => {
      handleToggleVoiceSearch();
    }, 260);

    return () => clearTimeout(timer);
  }, [autoStartVoiceRequested, handleToggleVoiceSearch]);

  const visibleResults = useMemo(() => {
    const fallbackResults =
      !query.trim() && results.length === 0 ? recentDestinations : results;
    return fallbackResults.slice(0, SEARCH_RESULT_LIMIT);
  }, [query, recentDestinations, results]);

  const destinationInfo = selectedDestination || visibleResults[0] || null;
  const originAddress =
    resolveMeaningfulAddress(
      initialPickupAddress || currentAddress,
      ORIGIN_ADDRESS,
    ) || ORIGIN_ADDRESS;
  const resolvedPickupCoordinate = useMemo(
    () =>
      normalizePreviewCoordinate(pickupCoordinate) ||
      normalizePreviewCoordinate(currentCoordinate) ||
      normalizePreviewCoordinate(PROTOTYPE_ORIGIN_COORDINATE),
    [
      currentCoordinate?.latitude,
      currentCoordinate?.longitude,
      pickupCoordinate?.latitude,
      pickupCoordinate?.longitude,
    ],
  );
  const resolvedPickupAddress =
    pickupAdjustedOnMap && pickupAddress
      ? pickupAddress
      : resolveMeaningfulAddress(pickupAddress, originAddress) || originAddress;
  const pickupQaCoordinateLabel = useMemo(() => {
    const latitude = Number(resolvedPickupCoordinate?.latitude);
    const longitude = Number(resolvedPickupCoordinate?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return "";
    }

    return [
      `pickup:${latitude.toFixed(6)},${longitude.toFixed(6)}`,
      `address:${resolvedPickupAddress || ""}`,
    ].join(";");
  }, [
    resolvedPickupAddress,
    resolvedPickupCoordinate?.latitude,
    resolvedPickupCoordinate?.longitude,
  ]);

  useEffect(() => {
    if (
      initialSelectedDestinationHydratedRef.current ||
      isExtensionFlow ||
      !initialSelectedDestination
    ) {
      return;
    }

    initialSelectedDestinationHydratedRef.current = true;
    setSelectedDestination(initialSelectedDestination);
    setQuery(initialSelectedDestination.name || initialSelectedDestination.address || "");
    setPickupCoordinate(resolvedPickupCoordinate);
    setPickupAddress(resolvedPickupAddress);
    setAvailabilityNotice("");
    setPlanAvailabilityById({});
    if (initialSelectedPlan) {
      setSelectedPlan(initialSelectedPlan);
    }
    if (initialPricingQuote?.quote) {
      setSelectedPricingQuote(initialPricingQuote.quote);
      if (initialPricingQuote.routeKey) {
        setFareQuoteLock({
          routeKey: initialPricingQuote.routeKey,
          quoteSessionId: initialPricingQuote.quoteSessionId,
          distanceKm: initialPricingQuote.distanceKm,
          durationMin: initialPricingQuote.durationMin,
          arrivalTime: initialPricingQuote.arrivalTime,
          createdAt: initialPricingQuote.createdAt,
          expiresAt: initialPricingQuote.expiresAt,
        });
      }
    }
    setStep(startAtConfirmation ? CONFIRM_STEP : QUOTE_STEP);
    setSheetHeight(startAtConfirmation ? CONFIRM_FALLBACK_HEIGHT : QUOTE_FALLBACK_HEIGHT);
  }, [
    initialSelectedPlan,
    initialSelectedDestination,
    initialPricingQuote,
    isExtensionFlow,
    resolvedPickupAddress,
    resolvedPickupCoordinate,
    startAtConfirmation,
  ]);

  const pickupLocationPayload = useMemo(
    () => buildPickupLocationPayload(resolvedPickupCoordinate, resolvedPickupAddress),
    [
      resolvedPickupAddress,
      resolvedPickupCoordinate?.latitude,
      resolvedPickupCoordinate?.longitude,
    ],
  );
  const destinationCoordinate =
    destinationInfo?.coordinate || selectedDestination?.coordinate || null;
  const destinationRoutePayload = useMemo(() => {
    if (!destinationInfo && !destinationCoordinate) {
      return null;
    }

    return {
      name: destinationInfo?.name || destinationInfo?.address || "Destino",
      address:
        destinationInfo?.address ||
        destinationInfo?.description ||
        destinationInfo?.name ||
        "Destino",
      coordinate: destinationCoordinate || null,
    };
  }, [
    destinationCoordinate,
    destinationInfo?.address,
    destinationInfo?.description,
    destinationInfo?.name,
  ]);
  const routeGuardState = useMemo(() => {
    if (!destinationInfo) {
      return { blocked: false, message: "" };
    }

    const originCountry = inferCountryFromAddress(originAddress);
    const destinationCountry = inferCountryFromAddress(
      `${destinationInfo?.name || ""} ${destinationInfo?.address || ""}`,
    );

    if (
      originCountry &&
      destinationCountry &&
      originCountry !== destinationCountry
    ) {
      return {
        blocked: true,
        message: OUT_OF_COVERAGE_MESSAGE,
      };
    }

    const straightDistanceKm = calculateStraightDistanceKm(
      resolvedPickupCoordinate,
      destinationCoordinate,
    );
    if (
      Number.isFinite(straightDistanceKm) &&
      straightDistanceKm > MAX_OPERATIONAL_ROUTE_DISTANCE_KM
    ) {
      return {
        blocked: true,
        message: OUT_OF_COVERAGE_MESSAGE,
      };
    }

    return { blocked: false, message: "" };
  }, [
    destinationCoordinate,
    destinationInfo,
    originAddress,
    resolvedPickupCoordinate,
  ]);
  const routeGuardBlocked = routeGuardState.blocked;
  const routeGuardMessage = normalizeCoverageMessage(routeGuardState.message);
  const livePreviewMatchesSelection = useMemo(() => {
    if (!selectedDestination?.coordinate || !runtimeSelectedDestination?.coordinate) {
      return false;
    }

    const localLatitude = Number(selectedDestination.coordinate.latitude);
    const localLongitude = Number(selectedDestination.coordinate.longitude);
    const runtimeLatitude = Number(runtimeSelectedDestination.coordinate.latitude);
    const runtimeLongitude = Number(
      runtimeSelectedDestination.coordinate.longitude,
    );

    if (
      !Number.isFinite(localLatitude) ||
      !Number.isFinite(localLongitude) ||
      !Number.isFinite(runtimeLatitude) ||
      !Number.isFinite(runtimeLongitude)
    ) {
      return false;
    }

    return (
      Math.abs(localLatitude - runtimeLatitude) < 0.000001 &&
      Math.abs(localLongitude - runtimeLongitude) < 0.000001
    );
  }, [runtimeSelectedDestination, selectedDestination]);
  const canRequestRide = Boolean(
    Number.isFinite(destinationCoordinate?.latitude) &&
    Number.isFinite(destinationCoordinate?.longitude) &&
    Number.isFinite(resolvedPickupCoordinate?.latitude) &&
    Number.isFinite(resolvedPickupCoordinate?.longitude),
  );

  const liveDurationMin = useMemo(() => {
    const previewDuration = Number(runtimeTripDurationMin);
    if (
      livePreviewMatchesSelection &&
      Number.isFinite(previewDuration) &&
      previewDuration > 0
    ) {
      return Math.max(1, Math.round(previewDuration));
    }

    const value = Number.parseInt(destinationInfo?.eta || "8", 10);
    return Number.isFinite(value) ? Math.max(4, value + 4) : 9;
  }, [destinationInfo, livePreviewMatchesSelection, runtimeTripDurationMin]);

  const liveDistanceKm = useMemo(() => {
    const previewDistance = Number(runtimeTripDistanceKm);
    if (
      livePreviewMatchesSelection &&
      Number.isFinite(previewDistance) &&
      previewDistance > 0
    ) {
      return Number(previewDistance.toFixed(1));
    }

    const estimate = liveDurationMin * 0.52;
    return Math.max(1.2, Number(estimate.toFixed(1)));
  }, [liveDurationMin, livePreviewMatchesSelection, runtimeTripDistanceKm]);

  const liveArrivalTime = useMemo(() => {
    const previewArrival = String(runtimeTripArrivalText || "").trim();
    if (livePreviewMatchesSelection && previewArrival) {
      return previewArrival;
    }

    const now = new Date();
    now.setMinutes(now.getMinutes() + liveDurationMin);
    return new Intl.DateTimeFormat("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(now);
  }, [liveDurationMin, livePreviewMatchesSelection, runtimeTripArrivalText]);

  const fareQuoteRouteKey = useMemo(
    () =>
      buildPassengerFareQuoteRouteKey({
        originCoordinate: resolvedPickupCoordinate,
        destinationCoordinate,
      }),
    [
      destinationCoordinate?.latitude,
      destinationCoordinate?.longitude,
      resolvedPickupCoordinate?.latitude,
      resolvedPickupCoordinate?.longitude,
    ],
  );

  useEffect(() => {
    const canLockQuote =
      (step === QUOTE_STEP || step === CONFIRM_STEP || step === PICKUP_STEP) &&
      !isExtensionFlow &&
      !routeGuardBlocked &&
      canRequestRide &&
      Boolean(fareQuoteRouteKey);

    if (!canLockQuote) {
      setFareQuoteLock(null);
      return;
    }

    setFareQuoteLock((current) => {
      if (current?.routeKey === fareQuoteRouteKey) {
        return current;
      }

      const createdAt = Date.now();
      return {
        routeKey: fareQuoteRouteKey,
        quoteSessionId: createPassengerQuoteSessionId(createdAt),
        distanceKm: liveDistanceKm,
        durationMin: liveDurationMin,
        arrivalTime: liveArrivalTime,
        createdAt,
        expiresAt: createdAt + PASSENGER_QUOTE_VALIDITY_MS,
      };
    });
  }, [
    canRequestRide,
    fareQuoteRouteKey,
    isExtensionFlow,
    liveArrivalTime,
    liveDistanceKm,
    liveDurationMin,
    routeGuardBlocked,
    step,
  ]);

  const fareQuoteLockMatchesRoute = fareQuoteLock?.routeKey === fareQuoteRouteKey;
  const durationMin = fareQuoteLockMatchesRoute
    ? normalizeLockedQuoteNumber(fareQuoteLock?.durationMin, liveDurationMin)
    : liveDurationMin;
  const distanceKm = fareQuoteLockMatchesRoute
    ? normalizeLockedQuoteNumber(fareQuoteLock?.distanceKm, liveDistanceKm)
    : liveDistanceKm;
  const arrivalTime =
    fareQuoteLockMatchesRoute && fareQuoteLock?.arrivalTime
      ? fareQuoteLock.arrivalTime
      : liveArrivalTime;

  const durationLabel = useMemo(() => {
    return `${durationMin} min`;
  }, [durationMin]);

  const distanceLabel = useMemo(() => {
    return `${Number(distanceKm).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
  }, [distanceKm]);

  const planRateCards = useMemo(() => {
    if (!Array.isArray(catalogCars) || catalogCars.length === 0) {
      return DEFAULT_PLAN_RATE_CARDS;
    }

    const merged = {
      plus: { ...DEFAULT_PLAN_RATE_CARDS.plus },
      elite: { ...DEFAULT_PLAN_RATE_CARDS.elite },
      moto: { ...DEFAULT_PLAN_RATE_CARDS.moto },
    };

    catalogCars.forEach((car) => {
      const planId = getPlanIdFromCarName(car?.name);
      if (!planId) return;

      merged[planId] = {
        ...merged[planId],
        ...car,
        name: car?.name || merged[planId].name,
      };
    });

    return merged;
  }, [catalogCars]);

  const plans = useMemo(() => {
    return [
      {
        id: "plus",
        title: planRateCards.plus?.name || "Leaf Plus",
        value: calculateBusinessFare(
          distanceKm,
          durationMin,
          planRateCards.plus,
        ),
      },
      {
        id: "elite",
        title: planRateCards.elite?.name || "Leaf Elite",
        value: calculateBusinessFare(
          distanceKm,
          durationMin,
          planRateCards.elite,
        ),
      },
      {
        id: "moto",
        title: planRateCards.moto?.name || "Leaf Moto",
        value: calculateBusinessFare(
          distanceKm,
          durationMin,
          planRateCards.moto,
        ),
      },
    ];
  }, [distanceKm, durationMin, planRateCards]);
  const selectedPlanData =
    plans.find((item) => item.id === selectedPlan) || plans[0];
  const selectedQuoteFare = Number(selectedPricingQuote?.estimatedFare);
  const hasSelectedBackendQuote = Boolean(
    selectedPricingQuote &&
      Number.isFinite(selectedQuoteFare) &&
      selectedQuoteFare > 0,
  );
  const selectedPlanFare = routeGuardBlocked
    ? null
    : hasSelectedBackendQuote
      ? selectedQuoteFare
      : isExtensionFlow
        ? selectedPlanData?.value
        : null;
  const selectedDiscountBenefit =
    selectedPricingQuote?.discountBenefit && typeof selectedPricingQuote.discountBenefit === "object"
      ? selectedPricingQuote.discountBenefit
      : null;
  const selectedGrossQuoteFare = Number(selectedPricingQuote?.grossEstimatedFare);
  const selectedGrossEstimatedFare =
    Number.isFinite(selectedGrossQuoteFare) && selectedGrossQuoteFare > 0
      ? selectedGrossQuoteFare
      : selectedPlanFare;
  const selectedBackendQuoteReady = Boolean(
    hasSelectedBackendQuote &&
      Number.isFinite(Number(selectedPlanFare)) &&
      Number(selectedPlanFare) > 0,
  );
  const paymentQuotePending = Boolean(
    !isExtensionFlow &&
      canRequestRide &&
      !routeGuardBlocked &&
      (pricingQuoteLoading || !selectedBackendQuoteReady),
  );
  const lockedPaymentFare =
    Number.isFinite(Number(paymentQuoteLock?.fare)) && Number(paymentQuoteLock?.fare) > 0
      ? Number(paymentQuoteLock.fare)
      : selectedPlanFare;
  const lockedGrossEstimatedFare =
    Number.isFinite(Number(paymentQuoteLock?.grossEstimatedFare)) &&
    Number(paymentQuoteLock?.grossEstimatedFare) > 0
      ? Number(paymentQuoteLock.grossEstimatedFare)
      : selectedGrossEstimatedFare;
  const lockedDiscountBenefit =
    paymentQuoteLock?.discountBenefit !== undefined
      ? paymentQuoteLock.discountBenefit
      : selectedDiscountBenefit;
  const paymentRecoveryRouteContextKey = useMemo(
    () =>
      buildRidePaymentRouteContextKey({
        tripData: {
          pickup: {
            lat: resolvedPickupCoordinate?.latitude,
            lng: resolvedPickupCoordinate?.longitude,
          },
          drop: {
            lat: destinationCoordinate?.latitude,
            lng: destinationCoordinate?.longitude,
          },
          carType: selectedPlanData?.title,
        },
      }),
    [
      destinationCoordinate?.latitude,
      destinationCoordinate?.longitude,
      resolvedPickupCoordinate?.latitude,
      resolvedPickupCoordinate?.longitude,
      selectedPlanData?.title,
    ],
  );

  useEffect(() => {
    const passengerId = profileUid || riderProfile?.uid || riderProfile?.id || "";
    if (
      paymentRecoveryAttemptedRef.current === paymentRecoveryRouteContextKey ||
      isExtensionFlow ||
      !canRequestRide ||
      !passengerId ||
      !paymentRecoveryRouteContextKey ||
      routeGuardBlocked
    ) {
      return undefined;
    }

    paymentRecoveryAttemptedRef.current = paymentRecoveryRouteContextKey;
    let cancelled = false;
    findRecoverableRidePaymentSession({
      passengerId,
      routeContextKey: paymentRecoveryRouteContextKey,
    })
      .then((session) => {
        const recovered = session?.paymentData;
        const amountInCents = Number(recovered?.amountInCents);
        if (
          cancelled ||
          !recovered?.chargeId ||
          !Number.isFinite(amountInCents) ||
          amountInCents <= 0
        ) {
          return;
        }

        const grossAmountInCents = Number(recovered?.grossAmountInCents);
        setPaymentQuoteLock({
          fare: amountInCents / 100,
          grossEstimatedFare:
            Number.isFinite(grossAmountInCents) && grossAmountInCents > 0
              ? grossAmountInCents / 100
              : amountInCents / 100,
          discountBenefit: recovered.discountBenefit || null,
          quoteSessionId: recovered.quoteSessionId || null,
          pricingQuoteRequestKey: null,
        });
        setPixModalVisible(true);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [
    canRequestRide,
    isExtensionFlow,
    paymentRecoveryRouteContextKey,
    profileUid,
    riderProfile?.id,
    riderProfile?.uid,
    routeGuardBlocked,
  ]);
  const selectedPricingPayload = selectedPricingQuote?.pricingPayload || null;
  const selectedDynamicPercentage = Number(
    selectedPricingPayload?.dynamic_percentage ?? 0,
  );
  const selectedDynamicNotice = String(
    selectedPricingPayload?.passenger_notice ||
      (selectedDynamicPercentage > 0
        ? "As tarifas estão mais altas agora."
        : ""),
  ).trim();
  const extensionPlanId = useMemo(() => {
    const fromSelectedVehicle = getPlanIdFromCarName(selectedVehicle);
    if (fromSelectedVehicle) {
      return fromSelectedVehicle;
    }
    return selectedPlan;
  }, [selectedPlan, selectedVehicle]);
  const visiblePlans = useMemo(() => {
    if (!isExtensionFlow) {
      return plans;
    }
    return plans.filter((item) => item.id === extensionPlanId);
  }, [extensionPlanId, isExtensionFlow, plans]);
  const activePlanData =
    visiblePlans.find((item) => item.id === selectedPlan) ||
    visiblePlans[0] ||
    selectedPlanData;
  const visiblePlanSignature = useMemo(
    () => visiblePlans.map((item) => `${item.id}:${item.title}`).join("|"),
    [visiblePlans],
  );
  const hasCoverageBlockedPlan = useMemo(
    () =>
      Object.values(planAvailabilityById || {}).some(
        (entry) =>
          entry?.available === false &&
          normalizeCoverageMessage(entry?.message) === OUT_OF_COVERAGE_MESSAGE,
      ),
    [planAvailabilityById],
  );
  const selectedPlanAvailability =
    planAvailabilityById?.[selectedPlanData?.id] || null;
  const selectedPlanUnavailable =
    hasCoverageBlockedPlan || selectedPlanAvailability?.available === false;
  const categoryOptions = useMemo(() => {
    const rawPickupEta = Number.parseInt(destinationInfo?.eta || "4", 10);
    const basePickupEta = Number.isFinite(rawPickupEta)
      ? Math.max(3, rawPickupEta)
      : 4;

    return visiblePlans.map((plan, index) => {
      const planAvailability = planAvailabilityById?.[plan.id] || null;
      const planUnavailable =
        routeGuardBlocked ||
        hasCoverageBlockedPlan ||
        planAvailability?.available === false;
      const planFare =
        planUnavailable
          ? null
          : plan.id === selectedPlan &&
              selectedPlanFare != null &&
              Number.isFinite(Number(selectedPlanFare))
          ? Number(selectedPlanFare)
          : Number(plan.value);
      const pickupEta =
        plan.id === "elite"
          ? basePickupEta + 2
          : plan.id === "moto"
            ? Math.max(2, basePickupEta - 1)
            : basePickupEta + index;

      return {
        ...plan,
        categoryLabel: String(plan.title || "")
          .replace(/^Leaf\s+/i, "")
          .trim() || plan.title,
        categoryDescription:
          plan.id === "elite"
            ? "Mais conforto para sua viagem"
            : plan.id === "moto"
              ? "Mais rápido para ir sozinho"
              : "Confortável e acessível",
        pickupEtaLabel: `${pickupEta} min`,
        priceLabel:
          planFare != null && Number.isFinite(Number(planFare))
            ? formatCurrency(planFare)
            : "--",
        arrivalLabel: arrivalTime,
        unavailable: planUnavailable,
        unavailableMessage: normalizeCoverageMessage(
          routeGuardBlocked
            ? routeGuardMessage
            : planAvailability?.message || "",
        ),
      };
    });
  }, [
    arrivalTime,
    destinationInfo?.eta,
    hasCoverageBlockedPlan,
    planAvailabilityById,
    routeGuardBlocked,
    routeGuardMessage,
    selectedPlan,
    selectedPlanFare,
    visiblePlans,
  ]);
  const tariffStatusLabel = pricingQuoteLoading
    ? "Atualizando tarifa"
    : selectedDynamicNotice
      ? "Tarifa alta"
      : "Tarifa normal";
  const selectedCategoryOption =
    categoryOptions.find((item) => item.id === selectedPlan) ||
    categoryOptions[0] ||
    null;
  const selectedPricingQuoteRequestKey = useMemo(() => {
    if (!fareQuoteLockMatchesRoute || !fareQuoteRouteKey || !selectedPlanData?.title) {
      return "";
    }

    return [
      fareQuoteRouteKey,
      selectedPlanData.title,
      fareQuoteLock?.quoteSessionId || "no-session",
    ].join("|");
  }, [
    fareQuoteLock?.quoteSessionId,
    fareQuoteLockMatchesRoute,
    fareQuoteRouteKey,
    selectedPlanData?.title,
  ]);

  useEffect(() => {
    if (
      (step !== QUOTE_STEP && step !== CONFIRM_STEP && step !== PICKUP_STEP) ||
      isExtensionFlow ||
      routeGuardBlocked ||
      !canRequestRide ||
      !selectedPlanData?.title ||
      !fareQuoteLockMatchesRoute ||
      !selectedPricingQuoteRequestKey
    ) {
      setSelectedPricingQuote(null);
      setPricingQuoteLoading(false);
      setPricingQuoteError("");
      return;
    }

    const originLatitude = Number(resolvedPickupCoordinate?.latitude);
    const originLongitude = Number(resolvedPickupCoordinate?.longitude);
    const destinationLatitude = Number(destinationCoordinate?.latitude);
    const destinationLongitude = Number(destinationCoordinate?.longitude);

    if (
      !Number.isFinite(originLatitude) ||
      !Number.isFinite(originLongitude) ||
      !Number.isFinite(destinationLatitude) ||
      !Number.isFinite(destinationLongitude)
    ) {
      setSelectedPricingQuote(null);
      setPricingQuoteLoading(false);
      setPricingQuoteError("");
      return;
    }

    const cachedQuote =
      selectedPricingQuoteCacheRef.current[selectedPricingQuoteRequestKey] ||
      null;
    if (cachedQuote?.expiresAt > Date.now()) {
      setSelectedPricingQuote(cachedQuote.quote);
      setPricingQuoteLoading(false);
      setPricingQuoteError("");
      return;
    }

    if (
      initialPricingQuote?.quote &&
      initialPricingQuote.routeKey === fareQuoteRouteKey &&
      initialPricingQuote.quoteSessionId === fareQuoteLock?.quoteSessionId &&
      initialPricingQuote.expiresAt > Date.now()
    ) {
      selectedPricingQuoteCacheRef.current[selectedPricingQuoteRequestKey] = {
        quote: initialPricingQuote.quote,
        expiresAt: initialPricingQuote.expiresAt,
      };
      setSelectedPricingQuote(initialPricingQuote.quote);
      setPricingQuoteLoading(false);
      setPricingQuoteError("");
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    setSelectedPricingQuote(null);
    setPricingQuoteLoading(true);
    setPricingQuoteError("");

    fetchDynamicPricingQuote(
      {
        pickupLocation: {
          lat: originLatitude,
          lng: originLongitude,
          add: resolvedPickupAddress,
        },
        destinationLocation: {
          lat: destinationLatitude,
          lng: destinationLongitude,
          add: destinationInfo?.address || destinationInfo?.name || "Destino",
        },
        carType: selectedPlanData.title,
        routeDistanceKm: distanceKm,
        routeDurationSecs: Math.max(60, Math.round(durationMin * 60)),
        clientEstimatedFare: selectedPlanData.value,
        quoteSessionId: fareQuoteLock?.quoteSessionId,
      },
      {
        signal: controller.signal,
        headers: fareQuoteLock?.quoteSessionId
          ? { "x-leaf-quote-session-id": fareQuoteLock.quoteSessionId }
          : undefined,
      },
    )
      .then((quote) => {
        if (!cancelled) {
          const normalizedQuote =
            quote && typeof quote === "object" ? quote : null;
          selectedPricingQuoteCacheRef.current[selectedPricingQuoteRequestKey] = {
            quote: normalizedQuote,
            expiresAt:
              Number(fareQuoteLock?.expiresAt) ||
              Date.now() + PASSENGER_QUOTE_VALIDITY_MS,
          };
          setSelectedPricingQuote(normalizedQuote);
        }
      })
      .catch((error) => {
        if (!cancelled && error?.name !== "AbortError") {
          setSelectedPricingQuote(null);
          setPricingQuoteError(
            error?.message || "Não foi possível atualizar a tarifa agora.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPricingQuoteLoading(false);
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    canRequestRide,
    destinationCoordinate?.latitude,
    destinationCoordinate?.longitude,
    destinationInfo?.address,
    destinationInfo?.name,
    distanceKm,
    durationMin,
    fareQuoteLock?.expiresAt,
    fareQuoteLock?.quoteSessionId,
    fareQuoteLockMatchesRoute,
    isExtensionFlow,
    initialPricingQuote,
    resolvedPickupAddress,
    resolvedPickupCoordinate?.latitude,
    resolvedPickupCoordinate?.longitude,
    routeGuardBlocked,
    selectedPlanData?.title,
    selectedPlanData?.value,
    selectedPricingQuoteRequestKey,
    step,
  ]);

  useEffect(() => {
    if (!isExtensionFlow) {
      return;
    }
    if (extensionPlanId && extensionPlanId !== selectedPlan) {
      setSelectedPlan(extensionPlanId);
    }
  }, [extensionPlanId, isExtensionFlow, selectedPlan]);

  const baseSearchBottomOffset = insets.bottom + SEARCH_BOTTOM_OFFSET;
  const sheetBottomOffset =
    step === SEARCH_STEP
      ? baseSearchBottomOffset
      : insets.bottom + SHEET_MIN_BOTTOM_MARGIN + 6;
  const effectiveSheetBottomOffset =
    step === SEARCH_STEP && keyboardHeight > 0
      ? Math.max(
          sheetBottomOffset,
          keyboardHeight -
            insets.bottom +
            SHEET_MIN_BOTTOM_MARGIN +
            SEARCH_KEYBOARD_CLEARANCE,
        )
      : sheetBottomOffset;
  const pickupFloatingTop = insets.top + 12;
  const pickupMapTopOcclusion =
    step === PICKUP_STEP
      ? pickupFloatingTop + pickupFloatingCardHeight + 16
      : 0;
  const pickupMarkerTop = useMemo(() => {
    const visibleMapHeight = Math.max(
      220,
      windowHeight - pickupMapTopOcclusion - insets.bottom - 24,
    );
    return pickupMapTopOcclusion + visibleMapHeight / 2 - 34;
  }, [insets.bottom, pickupMapTopOcclusion, windowHeight]);
  const searchSurfaceMaxHeight = Math.max(
    SEARCH_FALLBACK_HEIGHT,
    windowHeight - insets.top - effectiveSheetBottomOffset - 24,
  );
  const mapOccludedBottom =
    step === PICKUP_STEP ? 0 : effectiveSheetBottomOffset + sheetHeight;

  usePrototypeMapOcclusion({
    routeKey: route?.key,
    layerId: route?.key || "prototype-destination",
    occludedTop: pickupMapTopOcclusion,
    occludedBottom: mapOccludedBottom,
  });

  useEffect(() => {
    if (
      step !== PICKUP_STEP ||
      typeof subscribePrototypeMapCamera !== "function"
    ) {
      return undefined;
    }

    return subscribePrototypeMapCamera((nextCamera) => {
      if (nextCamera?.source !== "gesture") {
        return;
      }

      const nextCoordinate = normalizePreviewCoordinate(
        nextCamera.visibleCenterCoordinate || nextCamera,
      );
      if (!nextCoordinate) {
        return;
      }

      setPickupCoordinate((current) => {
        const currentCoordinateValue = normalizePreviewCoordinate(current);
        if (
          currentCoordinateValue &&
          Math.abs(currentCoordinateValue.latitude - nextCoordinate.latitude) <
            0.000001 &&
          Math.abs(currentCoordinateValue.longitude - nextCoordinate.longitude) <
            0.000001
        ) {
          return current;
        }

        return nextCoordinate;
      });
      setPickupAddress("Ponto ajustado no mapa");
      setPickupAdjustedOnMap(true);
    });
  }, [step]);

  const handleDismiss = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch (_error) {
      // no-op
    }
    setVoiceListening(false);
    setVoiceStarting(false);
    setPixModalVisible(false);
    setPreferenceModalVisible(false);
    pendingPaymentConfirmationRef.current = null;
    clearPrototypeMapRoute();
    if (!isExtensionFlow) {
      clearFlowPreview();
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate("RobotaxiPrototype");
  }, [clearFlowPreview, isExtensionFlow, navigation]);

  const handleSelectDestination = useCallback(
    async (item) => {
      const resolved = isExtensionFlow
        ? await resolveDestinationInput(item)
        : await selectDestination(item);
      if (!resolved?.coordinate) {
        Alert.alert(
          "Destino indisponível",
          "Não foi possível carregar as coordenadas desse destino agora.",
        );
        return;
      }

      try {
        ExpoSpeechRecognitionModule.stop();
      } catch (_error) {
        // no-op
      }
      destinationInputRef.current?.blur?.();
      Keyboard.dismiss();
      setVoiceListening(false);
      setVoiceStarting(false);
      setSelectedDestination(resolved);
      setQuery(resolved.name);
      setPickupCoordinate(resolvedPickupCoordinate);
      setPickupAddress(resolvedPickupAddress);
      setAvailabilityNotice("");
      setPlanAvailabilityById({});
      setStep(QUOTE_STEP);
      setSheetHeight(QUOTE_FALLBACK_HEIGHT);
    },
    [
      isExtensionFlow,
      resolveDestinationInput,
      resolvedPickupCoordinate,
      resolvedPickupAddress,
      selectDestination,
    ],
  );

  const handleBackToSearch = useCallback(() => {
    setStep(SEARCH_STEP);
    setSheetHeight(SEARCH_FALLBACK_HEIGHT);
    setAvailabilityNotice("");
    setPlanAvailabilityById({});
    setPickupAdjustedOnMap(false);
    setPreferenceModalVisible(false);
    pendingPaymentConfirmationRef.current = null;
    clearPrototypeMapRoute();
    qaAutoPixOpenedRef.current = false;
    qaAutoPixConfirmedRef.current = false;
    if (!isExtensionFlow) {
      clearFlowPreview();
    }
  }, [clearFlowPreview, isExtensionFlow]);

  const handleBackToCategories = useCallback(() => {
    setStep(QUOTE_STEP);
    setSheetHeight(QUOTE_FALLBACK_HEIGHT);
    setAvailabilityNotice("");
  }, []);

  const handleSelectCategory = useCallback(
    (plan) => {
      if (!plan || plan.unavailable) {
        if (plan?.unavailableMessage) {
          setAvailabilityNotice(plan.unavailableMessage);
        }
        return;
      }

      setSelectedPlan(plan.id);
      setAvailabilityNotice("");
      setSheetHeight(QUOTE_FALLBACK_HEIGHT);
    },
    [],
  );

  useEffect(() => {
    if (step === PICKUP_STEP) {
      clearPrototypeMapRoute();
      return undefined;
    }

    if (step !== QUOTE_STEP && step !== CONFIRM_STEP) {
      return undefined;
    }

    const originCoordinate = resolvedPickupCoordinate;
    const previewDestinationCoordinate =
      normalizePreviewCoordinate(destinationCoordinate);

    if (!originCoordinate || !previewDestinationCoordinate) {
      return undefined;
    }

    setPrototypeMapRoute({
      origin: originCoordinate,
      destination: previewDestinationCoordinate,
      allowFallback: false,
      destinationLabel: destinationInfo?.name || "Destino",
      destinationAddress:
        destinationInfo?.address || destinationInfo?.name || "Destino",
    });

    return () => {
      clearPrototypeMapRoute();
    };
  }, [
    destinationCoordinate,
    destinationInfo?.address,
    destinationInfo?.name,
    resolvedPickupCoordinate,
    step,
  ]);

  useEffect(() => {
    if (
      (step !== QUOTE_STEP && step !== CONFIRM_STEP && step !== PICKUP_STEP) ||
      visiblePlans.length === 0
    ) {
      return;
    }

    let cancelled = false;

    const validateVisiblePlans = async () => {
      setCheckingPlanAvailability(true);
      if (!routeGuardBlocked) {
        setAvailabilityNotice("");
      }

      const nextAvailability = {};
      let coverageBlockedByAvailability = false;

      if (routeGuardBlocked) {
        visiblePlans.forEach((plan) => {
          nextAvailability[plan.id] = {
            available: false,
            message: routeGuardMessage,
            code: "ROUTE_GUARD_BLOCKED",
          };
        });
        if (!cancelled) {
          setPlanAvailabilityById(nextAvailability);
          setAvailabilityNotice(routeGuardMessage);
          setCheckingPlanAvailability(false);
        }
        return;
      }

      for (const plan of visiblePlans) {
        try {
          const availability = await checkRideAvailabilityRef.current({
            destination: {
              name: destinationInfo?.name || "Destino",
              address: destinationInfo?.address || "",
              coordinate: destinationCoordinate,
            },
            vehicle: plan.title,
            pickupLocation: pickupLocationPayload,
            originCoordinate: resolvedPickupCoordinate,
            preferences: ridePreferences,
          });

          const normalizedMessage = availability?.available
            ? ""
            : normalizeCoverageMessage(
                availability?.message || "Não há motorista disponível",
              );
          if (normalizedMessage === OUT_OF_COVERAGE_MESSAGE) {
            coverageBlockedByAvailability = true;
          }
          const shouldBlockPlan =
            !availability?.available &&
            normalizedMessage === OUT_OF_COVERAGE_MESSAGE;
          nextAvailability[plan.id] = {
            available: availability?.available ? true : shouldBlockPlan ? false : null,
            message: normalizedMessage,
            code: availability?.code || null,
          };
        } catch (error) {
          const normalizedMessage = normalizeCoverageMessage(
            error?.message || "Não foi possível validar disponibilidade.",
          );
          if (normalizedMessage === OUT_OF_COVERAGE_MESSAGE) {
            coverageBlockedByAvailability = true;
          }
          nextAvailability[plan.id] = {
            available:
              normalizedMessage === OUT_OF_COVERAGE_MESSAGE ? false : null,
            message: normalizedMessage,
            code: error?.code || "AVAILABILITY_CHECK_FAILED",
          };
        }

        if (cancelled) {
          return;
        }
      }

      if (coverageBlockedByAvailability) {
        visiblePlans.forEach((plan) => {
          nextAvailability[plan.id] = {
            available: false,
            message: OUT_OF_COVERAGE_MESSAGE,
            code:
              nextAvailability[plan.id]?.code ||
              "ROUTE_GUARD_BLOCKED_BY_AVAILABILITY",
          };
        });
      }

      setPlanAvailabilityById(nextAvailability);
      if (coverageBlockedByAvailability) {
        setAvailabilityNotice(OUT_OF_COVERAGE_MESSAGE);
      }
      setCheckingPlanAvailability(false);
    };

    validateVisiblePlans().catch(() => {
      if (!cancelled) {
        setCheckingPlanAvailability(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    destinationCoordinate,
    destinationInfo?.address,
    destinationInfo?.name,
    pickupLocationPayload,
    resolvedPickupCoordinate,
    ridePreferences,
    routeGuardBlocked,
    routeGuardMessage,
    step,
    visiblePlanSignature,
    visiblePlans,
  ]);

  useEffect(() => {
    if (
      (step !== QUOTE_STEP && step !== CONFIRM_STEP && step !== PICKUP_STEP) ||
      visiblePlans.length === 0
    ) {
      return;
    }

    const currentPlanState = planAvailabilityById?.[selectedPlan];
    if (currentPlanState?.available !== false) {
      return;
    }

    const firstAvailablePlan = visiblePlans.find(
      (item) => planAvailabilityById?.[item.id]?.available === true,
    );

    if (firstAvailablePlan && firstAvailablePlan.id !== selectedPlan) {
      setSelectedPlan(firstAvailablePlan.id);
    }
  }, [planAvailabilityById, selectedPlan, step, visiblePlans]);

  const handleCardLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setSheetHeight(nextHeight);
    }
  }, []);

  const handlePickupFloatingCardLayout = useCallback((event) => {
    const nextHeight = event?.nativeEvent?.layout?.height;
    if (Number.isFinite(nextHeight) && nextHeight > 0) {
      setPickupFloatingCardHeight(nextHeight);
    }
  }, []);

  const handleUseCurrentPickup = useCallback(() => {
    setPickupCoordinate(
      normalizePreviewCoordinate(currentCoordinate) ||
        normalizePreviewCoordinate(PROTOTYPE_ORIGIN_COORDINATE),
    );
    setPickupAddress(originAddress);
    setPickupAdjustedOnMap(false);
  }, [currentCoordinate, originAddress]);

  const handleOpenPixModal = useCallback(async () => {
    if (!canRequestRide) {
      Alert.alert(
        "Selecione um destino",
        "Defina um destino válido antes de solicitar.",
      );
      return;
    }

    if (checkingAvailability || submittingRide || preferenceModalVisible) {
      return;
    }

    if (isExtensionFlow) {
      try {
        setSubmittingRide(true);
        setAvailabilityNotice("");
        const result = await requestTripExtension({
          destination: {
            name: destinationInfo?.name || "Destino",
            address: destinationInfo?.address || "",
            coordinate: destinationCoordinate,
          },
          newFare: activePlanData?.value,
        });

        if (result?.directChange) {
          Alert.alert(
            "Destino atualizado",
            "O novo destino ficou registrado e a corrida seguirá com a nova rota.",
            [
              {
                text: "OK",
                onPress: () => navigation.navigate(returnRouteName),
              },
            ],
          );
          return;
        }

        Alert.alert(
          "Solicitação enviada",
          "O motorista foi avisado. Se ele aceitar, o complemento Pix será exibido na tela da corrida.",
          [
            {
              text: "OK",
              onPress: () => navigation.navigate(returnRouteName),
            },
          ],
        );
      } catch (error) {
        setAvailabilityNotice(
          error?.message ||
            "Não foi possível solicitar a alteração de destino agora.",
        );
      } finally {
        setSubmittingRide(false);
      }
      return;
    }

    try {
      setCheckingAvailability(true);
      setAvailabilityNotice("");

      if (routeGuardBlocked) {
        setAvailabilityNotice(
          routeGuardMessage || OUT_OF_COVERAGE_MESSAGE,
        );
        return;
      }

      if (
        pricingQuoteLoading ||
        !selectedBackendQuoteReady ||
        !Number.isFinite(Number(selectedPlanFare)) ||
        Number(selectedPlanFare) <= 0
      ) {
        setAvailabilityNotice(
          pricingQuoteError ||
            "Aguarde a cotação da tarifa antes de solicitar a corrida.",
        );
        return;
      }

      const availabilityPayload = {
        destination: {
          name: destinationInfo?.name || "Destino",
          address: destinationInfo?.address || "",
          coordinate: destinationCoordinate,
        },
        vehicle: selectedPlanData.title,
        pickupLocation: pickupLocationPayload,
        originCoordinate: resolvedPickupCoordinate,
        preferences: ridePreferences,
      };
      const checkFinalAvailability = (attempt) =>
        checkRideAvailabilityRef.current(availabilityPayload, {
          forceRefresh: true,
          requestId: buildFinalAvailabilityRequestId(
            selectedPlanData.id,
            attempt,
          ),
        });

      let availability = await checkFinalAvailability(1);
      if (!availability?.available && isNoDriversAvailabilityResult(availability)) {
        await waitForFinalAvailabilityRecheck();
        availability = await checkFinalAvailability(2);
      }

      if (!availability?.available) {
        const normalizedMessage = normalizeCoverageMessage(
          availability?.message ||
            "Não há motorista disponível para essa categoria.",
        );
        setAvailabilityNotice(normalizedMessage);
        setPlanAvailabilityById((current) => ({
          ...current,
          [selectedPlanData.id]: {
            available:
              normalizedMessage === OUT_OF_COVERAGE_MESSAGE ? false : null,
            message: normalizedMessage,
            code: availability?.code || null,
          },
        }));
        if (normalizedMessage === OUT_OF_COVERAGE_MESSAGE) {
          const nextAvailability = {};
          visiblePlans.forEach((plan) => {
            nextAvailability[plan.id] = {
              available: false,
              message: OUT_OF_COVERAGE_MESSAGE,
              code: "ROUTE_GUARD_BLOCKED_BY_AVAILABILITY",
            };
          });
          setPlanAvailabilityById(nextAvailability);
        }
        return;
      }

      setPaymentQuoteLock({
        fare: Number(selectedPlanFare),
        grossEstimatedFare:
          Number.isFinite(Number(selectedGrossEstimatedFare)) &&
          Number(selectedGrossEstimatedFare) > 0
            ? Number(selectedGrossEstimatedFare)
            : Number(selectedPlanFare),
        discountBenefit: selectedDiscountBenefit,
        quoteSessionId: fareQuoteLock?.quoteSessionId || null,
        pricingQuoteRequestKey: selectedPricingQuoteRequestKey || null,
      });
      setPlanAvailabilityById((current) => ({
        ...current,
        [selectedPlanData.id]: {
          available: true,
          message: "",
          code: availability?.code || null,
        },
      }));
      setPixModalVisible(true);
    } catch (error) {
      setAvailabilityNotice(
        error?.message || "Não foi possível validar disponibilidade agora.",
      );
    } finally {
      setCheckingAvailability(false);
    }
  }, [
    activePlanData?.value,
    canRequestRide,
    checkingAvailability,
    destinationCoordinate,
    destinationInfo?.address,
    destinationInfo?.name,
    isExtensionFlow,
    navigation,
    pickupLocationPayload,
    preferenceModalVisible,
    pricingQuoteError,
    pricingQuoteLoading,
    requestTripExtension,
    resolvedPickupCoordinate,
    returnRouteName,
    ridePreferences,
    routeGuardBlocked,
    routeGuardMessage,
    selectedBackendQuoteReady,
    selectedDiscountBenefit,
    selectedGrossEstimatedFare,
    selectedPlanData.id,
    selectedPlanData.title,
    selectedPlanFare,
    selectedPricingQuoteRequestKey,
    fareQuoteLock?.quoteSessionId,
    visiblePlans,
    submittingRide,
  ]);

  const handleClosePixModal = useCallback(() => {
    if (submittingRide) {
      return;
    }
    setPixModalVisible(false);
    setPaymentQuoteLock(null);
  }, [submittingRide]);

  useEffect(() => {
    if (!isPixModalVisible || submittingRide) {
      return;
    }

    if (
      routeGuardBlocked ||
      hasCoverageBlockedPlan ||
      selectedPlanUnavailable ||
      paymentQuotePending
    ) {
      setPixModalVisible(false);
      setPaymentQuoteLock(null);
      setAvailabilityNotice(
        routeGuardBlocked || hasCoverageBlockedPlan
          ? OUT_OF_COVERAGE_MESSAGE
          : paymentQuotePending
            ? "Aguarde a cotação da tarifa antes de solicitar a corrida."
            : normalizeCoverageMessage(
                selectedPlanAvailability?.message ||
                  "Categoria indisponível nesta região no momento.",
              ),
      );
    }
  }, [
    hasCoverageBlockedPlan,
    isPixModalVisible,
    paymentQuotePending,
    routeGuardBlocked,
    selectedPlanAvailability?.message,
    selectedPlanUnavailable,
    submittingRide,
  ]);

  useEffect(() => {
    if (step === QUOTE_STEP || step === CONFIRM_STEP || step === PICKUP_STEP) {
      setAvailabilityNotice("");
    }
  }, [selectedPlan, selectedDestination, step]);

  useEffect(() => {
    if (isExtensionFlow || !passengerAutoRoute) {
      lastAutoRouteRef.current = "";
      return;
    }

    const routeKey = `${passengerAutoRoute}:${bookingStatus || "idle"}:${
      destinationInfo?.name || ""
    }`;
    if (lastAutoRouteRef.current === routeKey) {
      return;
    }

    lastAutoRouteRef.current = routeKey;
    const commonParams = {
      destination: destinationRoutePayload?.name || destinationInfo?.name || "Destino",
      destinationAddress:
        destinationRoutePayload?.address ||
        destinationInfo?.address ||
        destinationInfo?.name ||
        "Destino",
      destinationCoordinate: destinationRoutePayload?.coordinate || null,
      initialSelectedDestination: destinationRoutePayload,
      initialSelectedPlan: selectedPlan,
      selectedFare: selectedPlanFare,
      fare: selectedPlanFare,
      originAddress: resolvedPickupAddress,
      vehicle: selectedPlanData.title || selectedVehicle || "Leaf Plus",
    };

    if (passengerAutoRoute === "RobotaxiPrototypeReceipt") {
      navigation.replace("RobotaxiPrototypeReceipt", { fromTrip: true });
      return;
    }

    if (passengerAutoRoute === "RobotaxiPrototypeTrip") {
      navigation.replace("RobotaxiPrototypeTrip", {
        ...commonParams,
        driverName: driverInfo?.name || "Motorista",
      });
      return;
    }

    navigation.replace("RobotaxiPrototypeDriverSearch", commonParams);
  }, [
    bookingStatus,
    destinationInfo?.address,
    destinationInfo?.name,
    destinationRoutePayload,
    driverInfo?.name,
    isExtensionFlow,
    navigation,
    resolvedPickupAddress,
    passengerAutoRoute,
    selectedPlan,
    selectedPlanData.title,
    selectedPlanFare,
    selectedVehicle,
  ]);

  const submitRideAfterPreferences = useCallback(
    async (paymentConfirmation = null, preferencesOverride = null) => {
      const confirmedChargeId = String(paymentConfirmation?.chargeId || "").trim();
      const confirmedAmountInCents = Number(paymentConfirmation?.amountInCents);
      const fallbackFare = Number(paymentQuoteLock?.fare ?? selectedPlanFare);
      const confirmedFare =
        Number.isFinite(confirmedAmountInCents) && confirmedAmountInCents > 0
          ? confirmedAmountInCents / 100
          : Number.isFinite(fallbackFare) && fallbackFare > 0
            ? fallbackFare
            : selectedPlanFare;

      if (submittingRideGuardRef.current || submittingRide) {
        return;
      }

      if (!canRequestRide) {
        Alert.alert(
          "Selecione um destino",
          "Defina um destino válido antes de confirmar o pagamento.",
        );
        return;
      }

      if (routeGuardBlocked) {
        Alert.alert(
          "Região indisponível",
          routeGuardMessage || OUT_OF_COVERAGE_MESSAGE,
        );
        return;
      }

      try {
        submittingRideGuardRef.current = true;
        if (confirmedChargeId) {
          lastHandledPaymentChargeIdRef.current = confirmedChargeId;
        }
        setSubmittingRide(true);
        setPixModalVisible(false);
        setPreferenceModalVisible(false);

        await requestRide({
          destination: {
            name: destinationInfo?.name || "Destino",
            address: destinationInfo?.address || "",
            coordinate: destinationCoordinate,
          },
          originAddress: resolvedPickupAddress,
          originCoordinate: resolvedPickupCoordinate,
          pickupLocation: pickupLocationPayload,
          vehicle: selectedPlanData.title,
          fare: confirmedFare,
          paymentMethod: "pix",
          paymentConfirmation,
          preferences:
            preferencesOverride ||
            latestRidePreferencesRef.current ||
            {},
        });

        await clearRidePaymentSession({
          passengerId: profileUid || riderProfile?.uid || riderProfile?.id || "",
          paymentSessionId: paymentConfirmation?.paymentSessionId,
          contextKey: paymentConfirmation?.paymentContextKey,
          chargeId: confirmedChargeId,
        }).catch(() => false);

        pendingPaymentConfirmationRef.current = null;
        navigation.replace("RobotaxiPrototypePaymentSuccess", {
          destination: destinationRoutePayload?.name || destinationInfo?.name || "Destino",
          destinationAddress:
            destinationRoutePayload?.address ||
            destinationInfo?.address ||
            destinationInfo?.name ||
            "Destino",
          destinationCoordinate: destinationRoutePayload?.coordinate || null,
          initialSelectedDestination: destinationRoutePayload,
          initialSelectedPlan: selectedPlan,
          selectedFare: confirmedFare,
          fare: confirmedFare,
          originAddress: resolvedPickupAddress,
          vehicle: selectedPlanData.title,
          autoAdvance: true,
        });
        setPaymentQuoteLock(null);
      } catch (error) {
        pendingPaymentConfirmationRef.current = null;
        setPaymentQuoteLock(null);
        if (confirmedChargeId) {
          lastHandledPaymentChargeIdRef.current = "";
        }
        navigation.replace("RobotaxiPrototypePaymentFailed", {
          errorMessage:
            error?.message || "Falha ao enviar a corrida para o servidor.",
          retryRouteName: "RobotaxiPrototypeDestination",
          retryParams: {
            initialPickupCoordinate: resolvedPickupCoordinate,
            initialPickupAddress: resolvedPickupAddress,
            initialPickupAdjustedOnMap: pickupAdjustedOnMap,
            initialSelectedDestination: destinationRoutePayload,
            initialSelectedPlan: selectedPlan,
            selectedFare: confirmedFare,
          },
        });
      } finally {
        submittingRideGuardRef.current = false;
        setSubmittingRide(false);
      }
    },
    [
      canRequestRide,
      destinationCoordinate,
      destinationInfo?.address,
      destinationInfo?.name,
      destinationRoutePayload,
      navigation,
      paymentQuoteLock?.fare,
      profileUid,
      pickupAdjustedOnMap,
      pickupLocationPayload,
      requestRide,
      riderProfile?.id,
      riderProfile?.uid,
      resolvedPickupAddress,
      resolvedPickupCoordinate,
      routeGuardBlocked,
      routeGuardMessage,
      selectedPlan,
      selectedPlanData.title,
      selectedPlanFare,
      submittingRide,
    ],
  );

  const handleConfirmPreferencesNow = useCallback(() => {
    const paymentConfirmation = pendingPaymentConfirmationRef.current;
    if (!paymentConfirmation) {
      return;
    }

    pendingPaymentConfirmationRef.current = null;
    setPreferenceProgress(1);
    setPreferenceModalVisible(false);
    submitRideAfterPreferences(
      paymentConfirmation,
      latestRidePreferencesRef.current || {},
    );
  }, [submitRideAfterPreferences]);

  const handlePixPaymentConfirmed = useCallback(
    (paymentConfirmation = null) => {
      const confirmedChargeId = String(paymentConfirmation?.chargeId || "").trim();

      if (
        confirmedChargeId &&
        lastHandledPaymentChargeIdRef.current === confirmedChargeId
      ) {
        return;
      }

      if (
        submittingRideGuardRef.current ||
        submittingRide ||
        preferenceModalVisible
      ) {
        return;
      }

      if (!canRequestRide) {
        Alert.alert(
          "Selecione um destino",
          "Defina um destino válido antes de confirmar o pagamento.",
        );
        return;
      }

      if (routeGuardBlocked) {
        Alert.alert(
          "Região indisponível",
          routeGuardMessage || OUT_OF_COVERAGE_MESSAGE,
        );
        return;
      }

      if (confirmedChargeId) {
        lastHandledPaymentChargeIdRef.current = confirmedChargeId;
      }
      pendingPaymentConfirmationRef.current = paymentConfirmation || {};
      setPixModalVisible(false);
      setPreferenceProgress(0);
      setPreferenceModalVisible(true);
    },
    [
      canRequestRide,
      preferenceModalVisible,
      routeGuardBlocked,
      routeGuardMessage,
      submittingRide,
    ],
  );

  useEffect(() => {
    if (!preferenceModalVisible || !pendingPaymentConfirmationRef.current) {
      return undefined;
    }

    const startedAt = Date.now();
    setPreferenceProgress(0);
    const timer = setInterval(() => {
      const nextProgress = Math.min(
        1,
        (Date.now() - startedAt) / PREFERENCE_CONFIRMATION_TIMEOUT_MS,
      );
      setPreferenceProgress(nextProgress);
      if (nextProgress >= 1) {
        clearInterval(timer);
        handleConfirmPreferencesNow();
      }
    }, PREFERENCE_CONFIRMATION_TICK_MS);

    return () => {
      clearInterval(timer);
    };
  }, [handleConfirmPreferencesNow, preferenceModalVisible]);

  useEffect(() => {
    if (!qaAutoSelectFirst || step !== SEARCH_STEP || qaAutoSelectStartedRef.current) {
      return;
    }

    if (qaPresetQuery && !qaPresetSearchCompleted) {
      return;
    }

    const firstResult = Array.isArray(visibleResults) ? visibleResults[0] : null;
    if (!firstResult?.id) {
      return;
    }

    qaAutoSelectStartedRef.current = true;
    const timer = setTimeout(() => {
      handleSelectDestination(firstResult).catch((error) => {
        console.warn(
          "[RobotaxiDestinationScreen] qaAutoSelectFirst failed",
          error?.message || error,
        );
        qaAutoSelectStartedRef.current = false;
      });
    }, 450);

    return () => clearTimeout(timer);
  }, [
    handleSelectDestination,
    qaAutoSelectFirst,
    qaPresetQuery,
    qaPresetSearchCompleted,
    step,
    visibleResults,
  ]);

  useEffect(() => {
    if (
      !qaAutoOpenPix ||
      (step !== QUOTE_STEP && step !== CONFIRM_STEP && step !== PICKUP_STEP) ||
      !canRequestRide ||
      checkingAvailability ||
      checkingPlanAvailability ||
      paymentQuotePending ||
      submittingRide ||
      qaAutoPixOpenedRef.current
    ) {
      return;
    }

    const timer = setTimeout(() => {
      qaAutoPixOpenedRef.current = true;
      Promise.resolve(handleOpenPixModal()).catch((error) => {
        qaAutoPixOpenedRef.current = false;
        console.warn(
          "[RobotaxiDestinationScreen] qaAutoOpenPix failed",
          error?.message || error,
        );
      });
    }, 900);

    return () => clearTimeout(timer);
  }, [
    canRequestRide,
    checkingAvailability,
    checkingPlanAvailability,
    handleOpenPixModal,
    paymentQuotePending,
    qaAutoOpenPix,
    step,
    submittingRide,
  ]);

  useEffect(() => {
    if (!qaAutoConfirmPix || !isPixModalVisible || submittingRide) {
      return;
    }

    qaAutoPixConfirmedRef.current = true;
  }, [isPixModalVisible, qaAutoConfirmPix, submittingRide]);

  useEffect(() => {
    const isHealthy =
      Boolean(isSocketConnected) && (!profileUid || isSocketAuthenticated);
    const wasHealthy = lastConnectionHealthyRef.current;

    if (typeof wasHealthy !== "boolean") {
      lastConnectionHealthyRef.current = isHealthy;
      return;
    }

    if (!wasHealthy && isHealthy) {
      if (
        qaConnectionVisualState?.mode === "lost" ||
        qaConnectionVisualState?.mode === "reconnecting"
      ) {
        setQaConnectionVisualState({ mode: "recovered" });
      }
      setShowRecoveredConnectionHint(true);
      if (connectionRecoveredTimerRef.current) {
        clearTimeout(connectionRecoveredTimerRef.current);
      }
      connectionRecoveredTimerRef.current = setTimeout(() => {
        setShowRecoveredConnectionHint(false);
        setQaConnectionVisualState((currentState) =>
          currentState?.mode === "recovered" ? null : currentState,
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
  }, [
    isSocketAuthenticated,
    isSocketConnected,
    profileUid,
    qaConnectionVisualState?.mode,
  ]);

  useEffect(() => {
    if (
      !shouldRunPrototypeConnectionAutomation(qaConnectionAutomationConfig, {
        activeRole: activeRole || "customer",
        bookingStatus: "quote",
        driverOnline: false,
      })
    ) {
      return undefined;
    }

    const executionKey = [
      qaConnectionAutomationConfig.scenario,
      qaConnectionAutomationConfig.triggerState,
      qaConnectionAutomationConfig.role || activeRole || "customer",
      "quote",
      qaConnectionAutomationConfig.nonce || "default",
    ].join(":");

    if (connectionAutomationExecutionRef.current === executionKey) {
      return undefined;
    }

    connectionAutomationExecutionRef.current = executionKey;
    const socket = WebSocketManager.getInstance();
    const timers = [];
    const reconnectingLeadMs = Math.min(
      Math.max(
        1200,
        Math.round(qaConnectionAutomationConfig.recoveryMs * 0.22),
      ),
      4000,
    );

    timers.push(
      setTimeout(() => {
        setQaConnectionVisualState({ mode: "lost" });
        socket.disconnect();

        if (qaConnectionAutomationConfig.scenario === "drop_and_recover") {
          const reconnectingDelayMs = Math.max(
            0,
            qaConnectionAutomationConfig.recoveryMs - reconnectingLeadMs,
          );

          if (reconnectingDelayMs > 0) {
            timers.push(
              setTimeout(() => {
                setQaConnectionVisualState({ mode: "reconnecting" });
              }, reconnectingDelayMs),
            );
          }

          timers.push(
            setTimeout(() => {
              setQaConnectionVisualState({ mode: "reconnecting" });
              socket.connect().catch(() => {});
            }, qaConnectionAutomationConfig.recoveryMs),
          );
        }
      }, qaConnectionAutomationConfig.delayMs),
    );

    connectionAutomationTimersRef.current = timers;

    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      if (connectionAutomationTimersRef.current === timers) {
        connectionAutomationTimersRef.current = [];
      }
    };
  }, [activeRole, qaConnectionAutomationConfig]);

  return (
    <PrototypeScreenTransition>
      <View style={styles.container}>
        <StatusBar
          translucent
          backgroundColor="transparent"
          barStyle="dark-content"
        />
        <PrototypeConnectionStatusPill
          topOffset={connectionIndicatorTopOffset}
          visible={Boolean(effectiveConnectionIndicatorModel)}
          tone={effectiveConnectionIndicatorModel?.tone}
          icon={effectiveConnectionIndicatorModel?.icon}
          title={effectiveConnectionIndicatorModel?.title}
          message={effectiveConnectionIndicatorModel?.message}
        />
        {step === PICKUP_STEP ? (
          <View
            pointerEvents="none"
            style={[styles.pickupMapMarker, { top: pickupMarkerTop }]}
            testID="passenger-pickup-map-marker"
            accessibilityLabel="Marcador do ponto de embarque"
          >
            <View style={styles.pickupMapMarkerPin}>
              <Ionicons name="location-sharp" size={28} color={leafRideColors.leaf} />
            </View>
            <View style={styles.pickupMapMarkerStem} />
          </View>
        ) : null}
        {step === PICKUP_STEP ? (
          <View pointerEvents="box-none" style={styles.pickupFloatingLayer}>
            <Animated.View
              key="pickup-floating"
              entering={FadeIn.duration(motion.timing.standard).easing(
                stepEasing,
              )}
              onLayout={handlePickupFloatingCardLayout}
              style={[styles.pickupFloatingCard, { top: pickupFloatingTop }]}
              testID="passenger-pickup-confirmation-card"
              accessibilityLabel="Confirmar ponto de embarque"
            >
              <View style={styles.pickupFloatingMainRow}>
                <TouchableOpacity
                  activeOpacity={0.84}
                  onPress={handleBackToSearch}
                  style={styles.pickupFloatingBackButton}
                  testID="passenger-pickup-back-button"
                  accessibilityLabel="Voltar para buscar destino"
                >
                  <Ionicons name="chevron-back" size={19} color={leafRideColors.text} />
                </TouchableOpacity>

                <View style={styles.pickupFloatingCopy}>
                  <Text style={styles.pickupFloatingEyebrow}>
                    Confirmar partida aqui
                  </Text>
                  <Text style={styles.pickupFloatingAddress} numberOfLines={2}>
                    {resolvedPickupAddress}
                  </Text>
                  {selectedPlanFare != null &&
                  Number.isFinite(Number(selectedPlanFare)) ? (
                    <>
                      <Text style={styles.pickupFloatingMeta} numberOfLines={1}>
                        {formatCurrency(selectedPlanFare)} via Pix
                      </Text>
                      <SecurePaymentBadge style={styles.pickupSecurePaymentBadge} />
                    </>
                  ) : null}
                  <Text style={styles.pickupFloatingHint}>
                    Arraste o mapa para ajustar o pin.
                  </Text>
                </View>
              </View>

              {selectedPlanUnavailable || routeGuardBlocked || availabilityNotice ? (
                <Text
                  style={styles.pickupFloatingNotice}
                  testID="passenger-destination-availability-notice"
                  accessibilityLabel="Aviso de disponibilidade da categoria"
                >
                  {routeGuardBlocked || hasCoverageBlockedPlan
                    ? OUT_OF_COVERAGE_MESSAGE
                    : normalizeCoverageMessage(
                        availabilityNotice ||
                          selectedPlanAvailability?.message ||
                          "Não há motorista disponível",
                      )}
                </Text>
              ) : null}

              {!selectedPlanUnavailable &&
              !routeGuardBlocked &&
              !availabilityNotice &&
              selectedDynamicNotice ? (
                <Text
                  style={styles.pickupFloatingDynamicText}
                  testID="passenger-destination-dynamic-pricing-badge"
                  accessibilityLabel="Aviso de tarifa dinâmica"
                >
                  {selectedDynamicNotice}
                </Text>
              ) : null}

              <View style={styles.pickupFloatingActions}>
                <TouchableOpacity
                  activeOpacity={0.86}
                  onPress={handleUseCurrentPickup}
                  style={styles.pickupFloatingSecondaryButton}
                  testID="passenger-pickup-use-current-button"
                  accessibilityLabel="Usar localização atual"
                >
                  <Text style={styles.pickupFloatingSecondaryButtonText}>
                    Atual
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.88}
                  disabled={
                    checkingAvailability ||
                    checkingPlanAvailability ||
                    paymentQuotePending ||
                    submittingRide ||
                    routeGuardBlocked ||
                    hasCoverageBlockedPlan ||
                    selectedPlanUnavailable
                  }
                  onPress={handleOpenPixModal}
                  style={[
                    styles.pickupFloatingPrimaryButton,
                    (checkingAvailability ||
                      checkingPlanAvailability ||
                      paymentQuotePending ||
                      submittingRide ||
                      routeGuardBlocked ||
                      hasCoverageBlockedPlan ||
                      selectedPlanUnavailable) &&
                      styles.pickupFloatingPrimaryButtonDisabled,
                  ]}
                  testID="passenger-pickup-confirm-button"
                  accessibilityLabel="Confirmar ponto de embarque"
                >
                  <Text style={styles.pickupFloatingPrimaryButtonText}>
                    {checkingAvailability || checkingPlanAvailability
                      ? "Verificando..."
                      : paymentQuotePending
                        ? "Calculando tarifa..."
                        : routeGuardBlocked ||
                          hasCoverageBlockedPlan ||
                          selectedPlanUnavailable
                        ? "Indisponível"
                        : "Confirmar"}
                  </Text>
                </TouchableOpacity>
              </View>
            </Animated.View>
          </View>
        ) : null}
        {step !== PICKUP_STEP ? (
        <PrototypeDismissibleSheet
          onClose={handleDismiss}
          sheetStyle={[
            styles.sheetWrap,
            { bottom: effectiveSheetBottomOffset },
          ]}
          dragHandleZoneHeight={48}
        >
          {step === SEARCH_STEP ? (
            <Animated.View
              key={SEARCH_STEP}
              onLayout={handleCardLayout}
              entering={FadeIn.duration(motion.timing.standard).easing(
                stepEasing,
              )}
              style={[
                styles.searchSurface,
                { maxHeight: searchSurfaceMaxHeight },
              ]}
            >
              <View style={styles.sheetHandle} />
              <View style={styles.searchHeaderRow}>
                <View style={styles.searchHeaderCopy}>
                  <Text style={styles.searchTitle}>Para onde vamos?</Text>
                  <Text style={styles.searchSubtitle}>
                    Busque um endereço ou escolha um destino recente.
                  </Text>
                </View>
                <TouchableOpacity
                  activeOpacity={0.82}
                  onPress={handleDismiss}
                  style={styles.searchCloseButton}
                  accessibilityRole="button"
                  accessibilityLabel="Fechar busca de destino"
                >
                  <Ionicons name="close" size={17} color={leafRideColors.text} />
                </TouchableOpacity>
              </View>

              <View style={styles.searchInputShell}>
                <Ionicons
                  name="search-outline"
                  size={17}
                  color={leafRideColors.secondary}
                  style={styles.searchInputIcon}
                />
                <TextInput
                  ref={destinationInputRef}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Buscar destino"
                  placeholderTextColor={leafRideColors.secondary}
                  autoFocus={!autoStartVoiceRequested}
                  style={styles.searchInput}
                  testID="passenger-destination-search-input"
                  accessibilityLabel="Digite o destino da viagem"
                />
                <TouchableOpacity
                  activeOpacity={0.86}
                  onPress={handleToggleVoiceSearch}
                  disabled={voiceStarting}
                  style={styles.searchMicButton}
                  testID="passenger-destination-search-mic"
                  accessibilityLabel="Ditar destino por voz"
                >
                  <Ionicons
                    name={voiceListening ? "mic" : "mic-outline"}
                    size={18}
                    color={voiceListening ? leafRideColors.leaf : leafRideColors.secondary}
                  />
                </TouchableOpacity>
              </View>

              {voiceListening || voiceError ? (
                <Text style={voiceError ? styles.voiceErrorText : styles.voiceHint}>
                  {voiceError || "Ouvindo... toque no microfone para finalizar."}
                </Text>
              ) : null}

              <FlatList
                data={visibleResults}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                style={styles.list}
                keyboardShouldPersistTaps="always"
                renderItem={({ item, index }) => {
                  return (
                    <TouchableOpacity
                      style={styles.destinationRow}
                      activeOpacity={0.88}
                      onPress={() => handleSelectDestination(item)}
                      testID={`passenger-destination-result-${index}`}
                      accessibilityLabel={`Resultado de destino ${index + 1}: ${item.name}`}
                      accessibilityHint={item.address || "Seleciona este destino para cotar a corrida"}
                    >
                      <View style={styles.destinationDot}>
                        <Ionicons
                          name={index % 2 === 0 ? "location-outline" : "locate-outline"}
                          size={18}
                          color={index % 2 === 0 ? leafRideColors.accent : leafRideColors.text}
                        />
                      </View>
                      <View style={styles.destinationTextWrap}>
                        <Text numberOfLines={1} style={styles.destinationName}>
                          {item.name}
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={styles.destinationAddress}
                        >
                          {item.address}
                        </Text>
                      </View>

                      <Text style={styles.destinationEta}>
                        {index === 0 && !query.trim() ? "Rec." : item.eta}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  searching ? (
                    <View style={styles.searchingWrap}>
                      <ActivityIndicator size="small" color={leafRideColors.leaf} />
                      <Text style={styles.searchingText}>
                        Buscando destinos...
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.emptyStateWrap}>
                      <View style={styles.emptyStateIcon}>
                        <Ionicons
                          name={query.trim() ? "search-outline" : "time-outline"}
                          size={18}
                          color={leafRideColors.secondary}
                        />
                      </View>
                      <Text style={styles.emptyText}>
                        {query.trim()
                          ? "Nenhum destino encontrado."
                          : "Sem destinos recentes por aqui."}
                      </Text>
                    </View>
                  )
                }
              />
            </Animated.View>
          ) : step === PICKUP_STEP ? (
            <Animated.View
              key={PICKUP_STEP}
              entering={FadeIn.duration(motion.timing.standard).easing(
                stepEasing,
              )}
              style={styles.pickupStack}
              onLayout={handleCardLayout}
            >
              <LeafRideSheet
                style={styles.pickupCard}
                testID="passenger-pickup-confirmation-card"
                accessibilityLabel="Confirmar ponto de embarque"
              >
                <ScrollView
                  bounces={false}
                  showsVerticalScrollIndicator={false}
                  style={styles.pickupScroll}
                  contentContainerStyle={styles.pickupScrollContent}
                >
                <View style={styles.pickupHeader}>
                  <View style={styles.pickupHeaderCopy}>
                    <Text style={styles.pickupEyebrow}>Antes do Pix</Text>
                    <Text style={styles.pickupTitle}>Confirme o embarque</Text>
                    <Text style={styles.pickupSubtitle}>
                      Ajuste no mapa se precisar.
                    </Text>
                  </View>
                  <Text style={styles.pickupFare} numberOfLines={1}>
                    {selectedPlanFare != null &&
                    Number.isFinite(Number(selectedPlanFare))
                      ? formatCurrency(selectedPlanFare)
                      : "--"}
                  </Text>
                </View>

                <View style={styles.pickupPointPanel}>
                  <View style={styles.pickupPointIcon}>
                    <Ionicons name="navigate-outline" size={18} color={leafRideColors.leaf} />
                  </View>
                  <View style={styles.pickupPointCopy}>
                    <Text style={styles.pickupPointLabel}>Local de partida</Text>
                    <Text style={styles.pickupPointAddress} numberOfLines={2}>
                      {resolvedPickupAddress}
                    </Text>
                    <Text style={styles.pickupPointHint}>
                      Arraste o mapa para mudar o ponto de embarque.
                    </Text>
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.86}
                    onPress={() => {
                      setPickupCoordinate(
                        normalizePreviewCoordinate(currentCoordinate) ||
                          normalizePreviewCoordinate(PROTOTYPE_ORIGIN_COORDINATE),
                      );
                      setPickupAddress(originAddress);
                      setPickupAdjustedOnMap(false);
                    }}
                    style={styles.pickupResetButton}
                    testID="passenger-pickup-use-current-button"
                    accessibilityLabel="Usar localização atual"
                  >
                    <Text style={styles.pickupResetButtonText}>Atual</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.comfortIndicator}>
                  <View style={styles.comfortIndicatorIcon}>
                    <Ionicons name="sparkles-outline" size={17} color={leafRideColors.leaf} />
                  </View>
                  <View style={styles.comfortIndicatorCopy}>
                    <Text style={styles.comfortIndicatorTitle}>Leaf Comfort</Text>
                    <Text style={styles.comfortIndicatorText} numberOfLines={1}>
                      {selectedTemperatureOption.label} · {selectedSoundOption.label}
                    </Text>
                  </View>
                </View>

                <View style={styles.preferenceBlock}>
                  <Text style={styles.preferenceLabel}>Temperatura</Text>
                  <View style={styles.preferenceOptions}>
                    {TEMPERATURE_OPTIONS.map((item) => {
                      const selected = item.id === selectedTemperatureOption.id;
                      return (
                        <TouchableOpacity
                          key={item.id}
                          activeOpacity={0.86}
                          onPress={() => setTemperaturePreference(item.id)}
                          style={[
                            styles.preferenceChip,
                            selected && styles.preferenceChipSelected,
                          ]}
                          testID={`passenger-temperature-option-${item.id}`}
                          accessibilityLabel={`Temperatura ${item.label}`}
                        >
                          <Text
                            style={[
                              styles.preferenceChipText,
                              selected && styles.preferenceChipTextSelected,
                            ]}
                          >
                            {item.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <View style={styles.preferenceBlock}>
                  <Text style={styles.preferenceLabel}>Som e conversa</Text>
                  <View style={styles.preferenceOptions}>
                    {SOUND_OPTIONS.map((item) => {
                      const selected = item.id === selectedSoundOption.id;
                      return (
                        <TouchableOpacity
                          key={item.id}
                          activeOpacity={0.86}
                          onPress={() => setSoundPreference(item.id)}
                          style={[
                            styles.preferenceChip,
                            selected && styles.preferenceChipSelected,
                          ]}
                          testID={`passenger-sound-option-${item.id}`}
                          accessibilityLabel={`Som ${item.label}`}
                        >
                          <Text
                            style={[
                              styles.preferenceChipText,
                              selected && styles.preferenceChipTextSelected,
                            ]}
                          >
                            {item.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                <TouchableOpacity
                  activeOpacity={0.86}
                  style={styles.leafDelasRow}
                  onPress={() => setLeafDelasEnabled((current) => !current)}
                  testID="passenger-destination-leaf-delas-toggle"
                  accessibilityRole="switch"
                  accessibilityLabel="Leaf Delas"
                  accessibilityState={{ checked: leafDelasEnabled }}
                >
                  <View style={styles.leafDelasCopy}>
                    <Text style={styles.leafDelasTitle}>Leaf Delas</Text>
                    <Text style={styles.leafDelasSubtitle}>
                      Motorista mulher, quando disponível.
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.leafDelasSwitch,
                      leafDelasEnabled && styles.leafDelasSwitchActive,
                    ]}
                  >
                    <View
                      style={[
                        styles.leafDelasSwitchKnob,
                        leafDelasEnabled && styles.leafDelasSwitchKnobActive,
                      ]}
                    />
                  </View>
                </TouchableOpacity>

                {selectedDynamicNotice ? (
                  <View
                    style={styles.dynamicPricingBadge}
                    testID="passenger-destination-dynamic-pricing-badge"
                    accessibilityLabel="Aviso de tarifa dinâmica"
                  >
                    <Text style={styles.dynamicPricingBadgeTitle}>
                      Tarifas mais altas agora
                    </Text>
                    <Text style={styles.dynamicPricingBadgeText}>
                      {selectedDynamicNotice}
                    </Text>
                  </View>
                ) : pricingQuoteLoading ? (
                  <Text style={styles.pricingQuoteStatus}>
                    Atualizando tarifa...
                  </Text>
                ) : pricingQuoteError ? (
                  <Text style={styles.pricingQuoteStatus}>
                    Tarifa atualizada no pagamento.
                  </Text>
                ) : null}

                {selectedPlanUnavailable || routeGuardBlocked ? (
                  <View style={styles.unavailableWrap}>
                    <Text
                      style={styles.unavailableTitle}
                      testID={`passenger-destination-plan-unavailable-label-${selectedPlanData?.id}`}
                      accessibilityLabel={`passenger-destination-plan-unavailable-label-${selectedPlanData?.id}`}
                    >
                      {routeGuardBlocked ? "Indisponível" : "Categoria indisponível"}
                    </Text>
                    <Text
                      style={styles.unavailableText}
                      testID={`passenger-destination-plan-unavailable-message-${selectedPlanData?.id}`}
                      accessibilityLabel={`passenger-destination-plan-unavailable-message-${selectedPlanData?.id}`}
                    >
                      {routeGuardBlocked || hasCoverageBlockedPlan
                        ? OUT_OF_COVERAGE_MESSAGE
                        : normalizeCoverageMessage(
                            routeGuardMessage ||
                              selectedPlanAvailability?.message ||
                              "Não há motorista disponível",
                          )}
                    </Text>
                  </View>
                ) : availabilityNotice ? (
                  <Text
                    style={styles.availabilityNotice}
                    testID="passenger-destination-availability-notice"
                    accessibilityLabel="Aviso de disponibilidade da categoria"
                  >
                    {availabilityNotice}
                  </Text>
                ) : null}
                </ScrollView>

                <View style={styles.quoteActionsRow}>
                  <LeafButton
                    label="Editar"
                    tone="ghost"
                    onPress={handleBackToSearch}
                    style={styles.editButton}
                  />
                  <LeafButton
                    label={
                      checkingPlanAvailability
                        ? "Verificando..."
                        : checkingAvailability
                          ? "Verificando..."
                          : paymentQuotePending
                            ? "Calculando tarifa..."
                            : routeGuardBlocked ||
                            hasCoverageBlockedPlan ||
                            selectedPlanUnavailable
                          ? "Indisponível"
                        : "Confirmar"
                    }
                    tone="primary"
                    style={styles.submitButton}
                    onPress={
                      checkingAvailability ||
                      checkingPlanAvailability ||
                      paymentQuotePending ||
                      submittingRide ||
                      routeGuardBlocked ||
                      hasCoverageBlockedPlan ||
                      selectedPlanUnavailable
                        ? undefined
                        : handleOpenPixModal
                    }
                    testID="passenger-pickup-confirm-button"
                    accessibilityLabel="Confirmar ponto de embarque"
                  />
                </View>
              </LeafRideSheet>
            </Animated.View>
          ) : step === QUOTE_STEP ? (
            <Animated.View
              key={QUOTE_STEP}
              entering={FadeIn.duration(motion.timing.standard).easing(
                stepEasing,
              )}
              style={styles.categoryStack}
              onLayout={handleCardLayout}
            >
              <LeafRideSheet style={styles.categoryCard}>
                <View style={styles.categoryHandle} />
                <View style={styles.categoryTopRow}>
                  <Text style={styles.categoryEyebrow}>Escolha a categoria</Text>
                  <TouchableOpacity
                    activeOpacity={0.84}
                    onPress={handleDismiss}
                    style={styles.categoryCloseButton}
                    accessibilityRole="button"
                    accessibilityLabel="Fechar categorias"
                  >
                    <Ionicons name="close" size={15} color={leafRideColors.text} />
                  </TouchableOpacity>
                </View>

                <View style={styles.categoryTabs}>
                  {categoryOptions.map((plan) => {
                    const selected = plan.id === selectedPlan;
                    return (
                      <TouchableOpacity
                        key={plan.id}
                        activeOpacity={plan.unavailable ? 1 : 0.82}
                        onPress={() => handleSelectCategory(plan)}
                        style={[
                          styles.categoryTab,
                          selected && styles.categoryTabActive,
                          plan.unavailable && styles.categoryTabDisabled,
                        ]}
                        testID={`passenger-destination-category-${plan.id}`}
                        accessibilityLabel={`Categoria ${plan.categoryLabel}, embarque em ${plan.pickupEtaLabel}, ${plan.priceLabel}`}
                        accessibilityState={{ selected, disabled: plan.unavailable }}
                      >
                        <Text
                          style={[
                            styles.categoryTabText,
                            selected && styles.categoryTabTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {plan.categoryLabel}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <LeafDivider style={styles.categoryDivider} />

                <View style={styles.categorySelectedRow}>
                  <View style={styles.categorySelectedLeft}>
                    <View style={styles.categorySelectedCopy}>
                      <Text style={styles.categorySelectedTitle} numberOfLines={1}>
                        {selectedCategoryOption?.categoryLabel || "Plus"}
                      </Text>
                      <Text style={styles.categorySelectedSubtitle} numberOfLines={1}>
                        {selectedCategoryOption?.categoryDescription || "Confortável e acessível"}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.categorySelectedPriceWrap}>
                    <Text
                      style={styles.categorySelectedPrice}
                      numberOfLines={1}
                      testID={`passenger-destination-quote-price-${selectedCategoryOption?.id || selectedPlan || "selected"}`}
                      accessibilityLabel={`Valor da corrida ${selectedCategoryOption?.priceLabel || "--"}`}
                    >
                      {selectedCategoryOption?.priceLabel || "--"}
                    </Text>
                    <Text style={styles.categorySelectedPriceCaption}>
                      valor da corrida
                    </Text>
                  </View>
                </View>

                <LeafDivider style={styles.categoryDividerCompact} />

                <View style={styles.categoryMetaRow}>
                  <View style={styles.categoryMetaItem}>
                    <Text style={styles.categoryMetaLabel}>Tempo estimado</Text>
                    <View style={styles.categoryMetaValueRow}>
                      <Ionicons name="time-outline" size={13} color={leafRideColors.text} />
                      <Text style={styles.categoryMetaValue}>
                        {selectedCategoryOption?.pickupEtaLabel || "--"}
                      </Text>
                    </View>
                  </View>
                  <View style={[styles.categoryMetaItem, styles.categoryMetaItemRight]}>
                    <Text style={styles.categoryMetaLabel}>Horário de chegada</Text>
                    <View style={styles.categoryMetaValueRow}>
                      <Ionicons name="location-outline" size={13} color={leafRideColors.text} />
                      <Text style={styles.categoryMetaValue}>
                        {selectedCategoryOption?.arrivalLabel || arrivalTime}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.categoryStatusRow}>
                  <View
                    style={[
                      styles.categoryStatusPill,
                      selectedDynamicNotice && styles.categoryStatusPillHigh,
                    ]}
                    testID="passenger-destination-dynamic-pricing-badge"
                    accessibilityLabel={tariffStatusLabel}
                  >
                    <Text
                      style={[
                        styles.categoryStatusText,
                        selectedDynamicNotice && styles.categoryStatusTextHigh,
                      ]}
                    >
                      {tariffStatusLabel}
                    </Text>
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.84}
                    onPress={() => setLeafDelasEnabled((current) => !current)}
                    style={[
                      styles.categoryStatusPill,
                      leafDelasEnabled && styles.categoryLeafDelasPillActive,
                    ]}
                    testID="passenger-destination-leaf-delas-toggle"
                    accessibilityRole="switch"
                    accessibilityLabel="Leaf Delas"
                    accessibilityState={{ checked: leafDelasEnabled }}
                  >
                    <Text
                      style={[
                        styles.categoryStatusText,
                        leafDelasEnabled && styles.categoryLeafDelasTextActive,
                      ]}
                    >
                      {leafDelasEnabled ? "Leaf Delas ativa" : "Leaf Delas"}
                    </Text>
                  </TouchableOpacity>
                </View>

                {selectedPlanUnavailable || routeGuardBlocked || availabilityNotice ? (
                  <Text
                    style={styles.availabilityNotice}
                    testID="passenger-destination-availability-notice"
                    accessibilityLabel="Aviso de disponibilidade da categoria"
                  >
                    {routeGuardBlocked || hasCoverageBlockedPlan
                      ? OUT_OF_COVERAGE_MESSAGE
                      : normalizeCoverageMessage(
                          availabilityNotice ||
                            selectedPlanAvailability?.message ||
                            selectedCategoryOption?.unavailableMessage ||
                            "Categoria indisponível nesta região no momento.",
                        )}
                  </Text>
                ) : null}

                <LeafButton
                  label={
                    isExtensionFlow
                      ? submittingRide
                        ? "Solicitando alteração..."
                        : "Confirmar"
                      : checkingPlanAvailability
                        ? "Verificando..."
                      : checkingAvailability
                        ? "Buscando motorista..."
                      : paymentQuotePending
                        ? "Calculando tarifa..."
                      : routeGuardBlocked || hasCoverageBlockedPlan || selectedPlanUnavailable
                          ? "Indisponível"
                        : "Confirmar"
                  }
                  tone="primary"
                  style={styles.categoryConfirmButton}
                  onPress={
                    checkingAvailability ||
                    checkingPlanAvailability ||
                    paymentQuotePending ||
                    submittingRide ||
                    routeGuardBlocked ||
                    hasCoverageBlockedPlan ||
                    selectedPlanUnavailable
                      ? undefined
                      : handleOpenPixModal
                  }
                  testID="passenger-destination-confirm-button"
                  accessibilityLabel="Confirmar categoria"
                />

                <Text style={styles.hiddenText}>{resolvedPickupAddress}</Text>
                <Text style={styles.hiddenText}>{destinationInfo?.name || "Destino"}</Text>
              </LeafRideSheet>
            </Animated.View>
          ) : (
            <Animated.View
              key={CONFIRM_STEP}
              entering={FadeIn.duration(motion.timing.standard).easing(
                stepEasing,
              )}
              style={styles.confirmStack}
              onLayout={handleCardLayout}
            >
              <LeafRideSheet style={styles.confirmCard}>
                <View style={styles.sheetHandle} />
                <View style={styles.confirmHeader}>
                  <View style={styles.confirmHeaderCopy}>
                    <Text style={styles.confirmEyebrow}>Categoria escolhida</Text>
                    <Text style={styles.confirmTitle} numberOfLines={1}>
                      {selectedPlanData?.title || "Leaf"}
                    </Text>
                  </View>
                  <Text style={styles.confirmPrice} numberOfLines={1}>
                    {selectedPlanFare != null &&
                    Number.isFinite(Number(selectedPlanFare))
                      ? formatCurrency(selectedPlanFare)
                      : "--"}
                  </Text>
                </View>

                <View style={styles.confirmMetricRow}>
                  <View style={styles.confirmMetric}>
                    <Text style={styles.confirmMetricValue}>
                      {selectedCategoryOption?.pickupEtaLabel || "--"}
                    </Text>
                    <Text style={styles.confirmMetricLabel}>embarque</Text>
                  </View>
                  <View style={styles.confirmMetric}>
                    <Text style={styles.confirmMetricValue}>{arrivalTime}</Text>
                    <Text style={styles.confirmMetricLabel}>chegada</Text>
                  </View>
                  <View style={styles.confirmMetric}>
                    <Text style={styles.confirmMetricValue}>
                      {tariffStatusLabel}
                    </Text>
                    <Text style={styles.confirmMetricLabel}>tarifa</Text>
                  </View>
                </View>

                <LeafDivider style={styles.confirmDivider} />

                <LeafInfoRow
                  marker="$"
                  title="Pagamento via PIX"
                  subtitle="QR Code no próximo passo"
                  style={styles.paymentRow}
                  markerTone="leaf"
                />
                <SecurePaymentBadge style={styles.quoteSecurePaymentBadge} />
                {pickupQaCoordinateLabel ? (
                  <Text
                    style={styles.hiddenText}
                    testID="passenger-destination-pickup-coordinate"
                    accessibilityLabel={`passenger-destination-pickup-coordinate ${pickupQaCoordinateLabel}`}
                  >
                    {pickupQaCoordinateLabel}
                  </Text>
                ) : null}

                {selectedPlanUnavailable || routeGuardBlocked ? (
                  <View style={styles.unavailableWrap}>
                    <Text
                      style={styles.unavailableTitle}
                      testID={`passenger-destination-plan-unavailable-label-${selectedPlanData?.id}`}
                      accessibilityLabel={`passenger-destination-plan-unavailable-label-${selectedPlanData?.id}`}
                    >
                      {routeGuardBlocked ? "Indisponível" : "Categoria indisponível"}
                    </Text>
                    <Text
                      style={styles.unavailableText}
                      testID={`passenger-destination-plan-unavailable-message-${selectedPlanData?.id}`}
                      accessibilityLabel={`passenger-destination-plan-unavailable-message-${selectedPlanData?.id}`}
                    >
                      {routeGuardBlocked || hasCoverageBlockedPlan
                        ? OUT_OF_COVERAGE_MESSAGE
                        : normalizeCoverageMessage(
                            routeGuardMessage ||
                              selectedPlanAvailability?.message ||
                              "Não há motorista disponível",
                          )}
                    </Text>
                  </View>
                ) : availabilityNotice ? (
                  <Text
                    style={styles.availabilityNotice}
                    testID="passenger-destination-availability-notice"
                    accessibilityLabel="Aviso de disponibilidade da categoria"
                  >
                    {availabilityNotice}
                  </Text>
                ) : null}

                <View style={styles.quoteActionsRow}>
                  <LeafButton
                    label="Trocar"
                    tone="ghost"
                    onPress={handleBackToCategories}
                    style={styles.editButton}
                  />
                  <LeafButton
                    label={
                      isExtensionFlow
                        ? submittingRide
                          ? "Solicitando alteração..."
                          : "Confirmar"
                        : checkingPlanAvailability
                          ? "Verificando categorias..."
                          : checkingAvailability
                            ? "Verificando motoristas..."
                            : paymentQuotePending
                              ? pricingQuoteLoading
                                ? "Calculando tarifa..."
                                : "Tarifa indisponível"
                              : routeGuardBlocked || hasCoverageBlockedPlan
                                ? "Indisponível"
                                : selectedPlanUnavailable
                                  ? "Indisponível"
                                  : "Confirmar"
                    }
                    tone="primary"
                    style={styles.submitButton}
                    onPress={
                      checkingAvailability ||
                      checkingPlanAvailability ||
                      paymentQuotePending ||
                      submittingRide ||
                      routeGuardBlocked ||
                      hasCoverageBlockedPlan ||
                      selectedPlanUnavailable
                        ? undefined
                        : handleOpenPixModal
                    }
                    testID="passenger-destination-confirm-button"
                    accessibilityLabel="Confirmar viagem"
                  />
                </View>
              </LeafRideSheet>
            </Animated.View>
          )}
        </PrototypeDismissibleSheet>
        ) : null}

        {!isExtensionFlow ? (
          <WooviPaymentModal
            visible={isPixModalVisible}
            onClose={handleClosePixModal}
            onPaymentConfirmed={handlePixPaymentConfirmed}
            tripData={{
              pickup: {
                add: resolvedPickupAddress,
                lat: resolvedPickupCoordinate?.latitude,
                lng: resolvedPickupCoordinate?.longitude,
              },
              drop: {
                add:
                  destinationInfo?.address ||
                  destinationInfo?.name ||
                  "Destino",
                lat: destinationCoordinate?.latitude,
                lng: destinationCoordinate?.longitude,
              },
              carType: selectedPlanData.title,
              estimatedFare: lockedPaymentFare,
              grossEstimatedFare: lockedGrossEstimatedFare,
              preferences: ridePreferences,
            }}
            estimates={{ estimateFare: lockedPaymentFare }}
            grossEstimatedFare={lockedGrossEstimatedFare}
            discountBenefit={lockedDiscountBenefit}
            quoteSessionId={paymentQuoteLock?.quoteSessionId || fareQuoteLock?.quoteSessionId || null}
            passengerId={profileUid || riderProfile?.uid || riderProfile?.id || ""}
            passengerName={riderProfile?.name || "Passageira Leaf"}
            passengerEmail={riderProfile?.email || "passageiro@leaf.app.br"}
            passengerPhone={
              riderProfile?.phoneNumber ||
              riderProfile?.phone ||
              riderProfile?.profile?.phoneNumber ||
              riderProfile?.profile?.phone ||
              ""
            }
            qaAutoConfirm={qaAutoConfirmPix}
          />
        ) : null}

        {preferenceModalVisible ? (
          <View
            style={[
              styles.preferenceModalLayer,
              { paddingBottom: Math.max(insets.bottom + 18, 26) },
            ]}
            testID="passenger-preference-countdown-modal"
          >
            <Animated.View
              entering={FadeIn.duration(180).easing(stepEasing)}
              style={styles.preferenceModalCard}
            >
              <View style={styles.preferenceModalHeader}>
                <View style={styles.preferenceModalHeaderCopy}>
                  <Text style={styles.preferenceModalEyebrow}>
                    Antes de buscar
                  </Text>
                  <Text style={styles.preferenceModalTitle}>
                    Preferências da viagem
                  </Text>
                  <Text style={styles.preferenceModalSubtitle}>
                    Ajuste agora ou seguimos automaticamente.
                  </Text>
                </View>
                <View style={styles.preferenceModalCountdown}>
                  <Text style={styles.preferenceModalCountdownText}>
                    {Math.max(0, Math.ceil((1 - preferenceProgress) * 5))}s
                  </Text>
                </View>
              </View>

              <View style={styles.preferenceModalSection}>
                <Text style={styles.preferenceModalSectionLabel}>
                  Temperatura
                </Text>
                <View style={styles.preferenceModalOptions}>
                  {TEMPERATURE_OPTIONS.map((item) => {
                    const selected = item.id === selectedTemperatureOption.id;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        activeOpacity={0.88}
                        onPress={() => setTemperaturePreference(item.id)}
                        style={[
                          styles.preferenceModalOption,
                          selected && styles.preferenceModalOptionSelected,
                        ]}
                        testID={`passenger-temperature-option-${item.id}`}
                        accessibilityLabel={`Temperatura ${item.label}`}
                      >
                        <View style={styles.preferenceModalOptionHeader}>
                          <Text
                            style={[
                              styles.preferenceModalOptionText,
                              selected &&
                                styles.preferenceModalOptionTextSelected,
                            ]}
                          >
                            {item.label}
                          </Text>
                          <View
                            style={[
                              styles.preferenceModalOptionCheck,
                              selected &&
                                styles.preferenceModalOptionCheckSelected,
                            ]}
                          >
                            {selected ? (
                              <Ionicons
                                name="checkmark"
                                size={13}
                                color="#FFFFFF"
                              />
                            ) : null}
                          </View>
                        </View>
                        <Text
                          style={[
                            styles.preferenceModalOptionHint,
                            selected && styles.preferenceModalOptionHintSelected,
                          ]}
                          numberOfLines={1}
                        >
                          {item.description}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.preferenceModalSection}>
                <Text style={styles.preferenceModalSectionLabel}>
                  Som e conversa
                </Text>
                <View style={styles.preferenceModalOptions}>
                  {SOUND_OPTIONS.map((item) => {
                    const selected = item.id === selectedSoundOption.id;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        activeOpacity={0.88}
                        onPress={() => setSoundPreference(item.id)}
                        style={[
                          styles.preferenceModalOption,
                          selected && styles.preferenceModalOptionSelected,
                        ]}
                        testID={`passenger-sound-option-${item.id}`}
                        accessibilityLabel={`Som ${item.label}`}
                      >
                        <View style={styles.preferenceModalOptionHeader}>
                          <Text
                            style={[
                              styles.preferenceModalOptionText,
                              selected &&
                                styles.preferenceModalOptionTextSelected,
                            ]}
                          >
                            {item.label}
                          </Text>
                          <View
                            style={[
                              styles.preferenceModalOptionCheck,
                              selected &&
                                styles.preferenceModalOptionCheckSelected,
                            ]}
                          >
                            {selected ? (
                              <Ionicons
                                name="checkmark"
                                size={13}
                                color="#FFFFFF"
                              />
                            ) : null}
                          </View>
                        </View>
                        <Text
                          style={[
                            styles.preferenceModalOptionHint,
                            selected && styles.preferenceModalOptionHintSelected,
                          ]}
                          numberOfLines={1}
                        >
                          {item.description}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.preferenceModalProgressHeader}>
                <Text style={styles.preferenceModalProgressLabel}>
                  Confirmação automática
                </Text>
                <Text style={styles.preferenceModalProgressTime}>
                  {Math.max(0, Math.ceil((1 - preferenceProgress) * 5))}s
                </Text>
              </View>
              <View style={styles.preferenceModalProgressTrack}>
                <View
                  style={[
                    styles.preferenceModalProgressFill,
                    {
                      width: `${Math.round(preferenceProgress * 100)}%`,
                    },
                  ]}
                />
              </View>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={handleConfirmPreferencesNow}
                style={styles.preferenceModalConfirmButton}
                testID="passenger-preference-confirm-button"
                accessibilityLabel="Continuar com preferências"
              >
                <Text style={styles.preferenceModalConfirmButtonText}>
                  Continuar
                </Text>
              </TouchableOpacity>
            </Animated.View>
          </View>
        ) : null}
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
  sheetHandle: {
    width: 50,
    height: 4,
    borderRadius: 3,
    backgroundColor: "#D8D0C7",
    alignSelf: "center",
  },
  searchSurface: {
    minHeight: SEARCH_FALLBACK_HEIGHT,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    backgroundColor: leafRideColors.sheet,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 14,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: -14 },
    shadowOpacity: 0.08,
    shadowRadius: 30,
    elevation: 12,
  },
  searchHeaderRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  searchHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  searchCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8F6F1",
    borderWidth: 1,
    borderColor: "rgba(39,74,54,0.08)",
  },
  searchTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25,
  },
  searchSubtitle: {
    marginTop: 3,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11.5,
    lineHeight: 15,
  },
  searchInputShell: {
    marginTop: 14,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: "#E9E2D8",
    backgroundColor: leafRideColors.field,
    justifyContent: "center",
    paddingLeft: 42,
    paddingRight: 48,
  },
  searchInputIcon: {
    position: "absolute",
    left: 16,
  },
  searchInput: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 13.5,
    lineHeight: 18,
    paddingVertical: 0,
  },
  searchMicButton: {
    position: "absolute",
    right: 6,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(246,250,247,0.9)",
  },
  voiceHint: {
    marginTop: 8,
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  voiceErrorText: {
    marginTop: 8,
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  list: {
    marginTop: 12,
    maxHeight: SEARCH_RESULT_LIMIT * 54 + 6,
  },
  listContent: {
    paddingBottom: 2,
  },
  destinationRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E9E2D8",
  },
  destinationDot: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(246,250,247,0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
  destinationTextWrap: {
    flex: 1,
    minWidth: 0,
    marginLeft: 14,
  },
  destinationName: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  destinationAddress: {
    marginTop: 3,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 13,
  },
  destinationEta: {
    marginLeft: 10,
    width: 56,
    color: leafRideColors.muted,
    fontFamily: fonts.Medium,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "right",
  },
  emptyText: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
    textAlign: "center",
  },
  emptyStateWrap: {
    minHeight: 50,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  emptyStateIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(246,250,247,0.96)",
    borderWidth: 1,
    borderColor: "rgba(39,74,54,0.08)",
  },
  searchingWrap: {
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  searchingText: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 17,
  },
  searchConfirmButton: {
    marginTop: 20,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
  },
  pickupMapMarker: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 20,
    elevation: 20,
  },
  pickupMapMarkerPin: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(23,74,43,0.12)",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 18,
    elevation: 6,
  },
  pickupMapMarkerStem: {
    width: 2,
    height: 20,
    marginTop: -3,
    borderRadius: 999,
    backgroundColor: leafRideColors.leaf,
  },
  pickupFloatingLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 24,
    elevation: 24,
  },
  pickupFloatingCard: {
    position: "absolute",
    left: 14,
    right: 14,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.7)",
    backgroundColor: "rgba(255,255,255,0.92)",
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 13,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.14,
    shadowRadius: 24,
    elevation: 8,
  },
  pickupFloatingMainRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
  },
  pickupFloatingBackButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(242,247,244,0.9)",
    borderWidth: 1,
    borderColor: "rgba(39,74,54,0.08)",
  },
  pickupFloatingCopy: {
    flex: 1,
    minWidth: 0,
    paddingTop: 1,
  },
  pickupFloatingEyebrow: {
    color: leafRideColors.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 13,
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  pickupFloatingAddress: {
    marginTop: 3,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  pickupFloatingHint: {
    marginTop: 3,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  pickupFloatingMeta: {
    marginTop: 5,
    color: leafRideColors.leaf,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  pickupSecurePaymentBadge: {
    marginTop: 2,
  },
  pickupFloatingNotice: {
    marginTop: 10,
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  pickupFloatingDynamicText: {
    marginTop: 6,
    color: leafRideColors.leaf,
    fontFamily: fonts.Medium,
    fontSize: 10.5,
    lineHeight: 14,
  },
  pickupFloatingActions: {
    marginTop: 12,
    flexDirection: "row",
    gap: 10,
  },
  pickupFloatingSecondaryButton: {
    minWidth: 78,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(242,247,244,0.96)",
    borderWidth: 1,
    borderColor: "rgba(39,74,54,0.1)",
  },
  pickupFloatingSecondaryButtonText: {
    color: leafRideColors.leaf,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  pickupFloatingPrimaryButton: {
    flex: 1,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: leafRideColors.leaf,
  },
  pickupFloatingPrimaryButtonDisabled: {
    backgroundColor: "#9BAB9F",
  },
  pickupFloatingPrimaryButtonText: {
    color: "#FFFFFF",
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  pickupStack: {
    height: PICKUP_FALLBACK_HEIGHT,
  },
  pickupCard: {
    height: PICKUP_FALLBACK_HEIGHT,
    overflow: "hidden",
  },
  pickupScroll: {
    flex: 1,
  },
  pickupScrollContent: {
    paddingBottom: 10,
  },
  pickupHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
  },
  pickupHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  pickupEyebrow: {
    color: leafRideColors.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  pickupTitle: {
    marginTop: 4,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 26,
  },
  pickupSubtitle: {
    marginTop: 6,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 12,
    lineHeight: 16,
  },
  pickupFare: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 26,
    textAlign: "right",
  },
  pickupPointPanel: {
    marginTop: 18,
    minHeight: 92,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#E9E2D8",
    backgroundColor: "#F8F6F1",
    paddingHorizontal: 14,
    paddingVertical: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  pickupPointIcon: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5EE",
  },
  pickupPointCopy: {
    flex: 1,
    minWidth: 0,
  },
  pickupPointLabel: {
    color: leafRideColors.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  pickupPointAddress: {
    marginTop: 3,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  pickupPointHint: {
    marginTop: 4,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  pickupResetButton: {
    minWidth: 52,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(39,74,54,0.12)",
  },
  pickupResetButtonText: {
    color: leafRideColors.leaf,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 15,
  },
  comfortIndicator: {
    marginTop: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E9E2D8",
    backgroundColor: "#F8F6F1",
    paddingHorizontal: 13,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  comfortIndicatorIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F1F5EE",
  },
  comfortIndicatorCopy: {
    flex: 1,
    minWidth: 0,
  },
  comfortIndicatorTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17,
  },
  comfortIndicatorText: {
    marginTop: 1,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  preferenceBlock: {
    marginTop: 14,
  },
  preferenceLabel: {
    color: leafRideColors.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 8,
  },
  preferenceOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  preferenceChip: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E9E2D8",
    backgroundColor: "rgba(255,255,255,0.82)",
  },
  preferenceChipSelected: {
    backgroundColor: leafRideColors.leaf,
    borderColor: leafRideColors.leaf,
  },
  preferenceChipText: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 15,
  },
  preferenceChipTextSelected: {
    color: "#FFFFFF",
  },
  categoryStack: {
    minHeight: QUOTE_FALLBACK_HEIGHT,
  },
  categoryCard: {
    minHeight: QUOTE_FALLBACK_HEIGHT,
    marginHorizontal: 24,
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 18,
  },
  categoryHandle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(23,20,18,0.18)",
    marginBottom: 12,
  },
  categoryTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  categoryEyebrow: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 15,
    letterSpacing: 0,
    textTransform: "uppercase",
  },
  categoryCloseButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8F6F1",
    borderWidth: 1,
    borderColor: "#E9E2D8",
  },
  categoryTabs: {
    marginTop: 14,
    minHeight: 55,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  categoryTab: {
    flex: 1,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: "#E9E2D8",
  },
  categoryTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: leafRideColors.text,
  },
  categoryTabDisabled: {
    opacity: 0.42,
  },
  categoryTabText: {
    color: leafRideColors.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 12.5,
    lineHeight: 16,
  },
  categoryTabTextActive: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
  },
  categoryDivider: {
    marginTop: 0,
    marginBottom: 14,
  },
  categoryDividerCompact: {
    marginTop: 12,
    marginBottom: 12,
  },
  categorySelectedRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  categorySelectedLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 0,
  },
  categorySelectedCopy: {
    flex: 1,
    minWidth: 0,
  },
  categorySelectedTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 15.5,
    lineHeight: 20,
  },
  categorySelectedSubtitle: {
    marginTop: 1,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  categorySelectedPriceWrap: {
    alignItems: "flex-end",
    minWidth: 96,
  },
  categorySelectedPrice: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 17,
    lineHeight: 22,
    textAlign: "right",
  },
  categorySelectedPriceCaption: {
    marginTop: 1,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 13,
  },
  categoryMetaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
  },
  categoryMetaItem: {
    flex: 1,
    minWidth: 0,
  },
  categoryMetaItemRight: {
    alignItems: "flex-end",
  },
  categoryMetaLabel: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14,
  },
  categoryMetaValueRow: {
    marginTop: 3,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  categoryMetaValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  categoryStatusRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  categoryStatusPill: {
    minHeight: 25,
    borderRadius: 13,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F8F6F1",
    borderWidth: 1,
    borderColor: "#E9E2D8",
  },
  categoryStatusPillHigh: {
    backgroundColor: "#FFF7ED",
    borderColor: "rgba(194,106,24,0.18)",
  },
  categoryLeafDelasPillActive: {
    backgroundColor: "#1A330E",
    borderColor: "#1A330E",
  },
  categoryStatusText: {
    color: leafRideColors.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 13,
  },
  categoryStatusTextHigh: {
    color: "#8A5A17",
  },
  categoryLeafDelasTextActive: {
    color: "#FFFFFF",
  },
  categoryConfirmButton: {
    marginTop: 14,
    minHeight: 48,
    borderRadius: 24,
  },
  confirmStack: {
    minHeight: CONFIRM_FALLBACK_HEIGHT,
  },
  confirmCard: {
    minHeight: CONFIRM_FALLBACK_HEIGHT,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 14,
  },
  confirmHeader: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  confirmHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  confirmEyebrow: {
    color: leafRideColors.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 14,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  confirmTitle: {
    marginTop: 2,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25,
  },
  confirmPrice: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 19,
    lineHeight: 24,
    textAlign: "right",
  },
  confirmMetricRow: {
    marginTop: 16,
    flexDirection: "row",
    borderRadius: 20,
    backgroundColor: "#F8F6F1",
    borderWidth: 1,
    borderColor: "#E9E2D8",
    paddingVertical: 12,
  },
  confirmMetric: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 9,
  },
  confirmMetricValue: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17,
    textAlign: "center",
  },
  confirmMetricLabel: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10,
    lineHeight: 13,
    textAlign: "center",
  },
  confirmDivider: {
    marginTop: 16,
    marginBottom: 14,
  },
  quoteStack: {
    minHeight: QUOTE_FALLBACK_HEIGHT,
  },
  quoteCard: {
    minHeight: QUOTE_FALLBACK_HEIGHT,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 16,
  },
  quoteHeader: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  quoteTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 20,
    lineHeight: 25,
  },
  quotePrice: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 24,
    textAlign: "right",
  },
  quoteDivider: {
    marginTop: 16,
    marginBottom: 26,
  },
  quoteDividerLarge: {
    marginTop: 18,
    marginBottom: 14,
  },
  dynamicPricingBadge: {
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 18,
    backgroundColor: "#F8F6F1",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E9E2D8",
  },
  dynamicPricingBadgeTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 12.5,
    lineHeight: 17,
  },
  dynamicPricingBadgeText: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  pricingQuoteStatus: {
    marginTop: 12,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
  },
  leafDelasRow: {
    marginTop: 14,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(221,232,225,0.8)",
  },
  leafDelasCopy: {
    flex: 1,
    minWidth: 0,
    paddingTop: 13,
    paddingRight: 14,
  },
  leafDelasTitle: {
    color: leafRideColors.text,
    fontFamily: fonts.Medium,
    fontSize: 13,
    lineHeight: 18,
  },
  leafDelasSubtitle: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14,
  },
  leafDelasSwitch: {
    marginTop: 13,
    width: 42,
    height: 24,
    borderRadius: 12,
    padding: 3,
    backgroundColor: "#E9E2D8",
  },
  leafDelasSwitchActive: {
    backgroundColor: leafRideColors.leaf,
  },
  leafDelasSwitchKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#FFFFFF",
  },
  leafDelasSwitchKnobActive: {
    transform: [{ translateX: 18 }],
  },
  paymentRow: {
    minHeight: 40,
  },
  quoteSecurePaymentBadge: {
    marginTop: 4,
  },
  hiddenText: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
  unavailableWrap: {
    marginTop: 10,
  },
  unavailableTitle: {
    color: leafRideColors.dangerText,
    fontFamily: fonts.SemiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  unavailableText: {
    marginTop: 2,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 10.5,
    lineHeight: 14,
  },
  availabilityNotice: {
    marginTop: 10,
    color: leafRideColors.dangerText,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
    textAlign: "center",
  },
  quoteActionsRow: {
    marginTop: 16,
    flexDirection: "row",
    gap: 16,
  },
  editButton: {
    flex: 0.54,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
  },
  submitButton: {
    flex: 1,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
  },
  preferenceModalLayer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    paddingHorizontal: 14,
    paddingBottom: 26,
    backgroundColor: "rgba(14,24,18,0.18)",
    zIndex: 40,
    elevation: 40,
  },
  preferenceModalCard: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(31,57,42,0.08)",
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.14,
    shadowRadius: 28,
    elevation: 12,
  },
  preferenceModalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 14,
  },
  preferenceModalHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  preferenceModalEyebrow: {
    color: leafRideColors.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 10,
    lineHeight: 13,
    textTransform: "uppercase",
    letterSpacing: 0.9,
  },
  preferenceModalTitle: {
    marginTop: 4,
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 18,
    lineHeight: 23,
  },
  preferenceModalSubtitle: {
    marginTop: 4,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11.5,
    lineHeight: 16,
  },
  preferenceModalCountdown: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EFF7F2",
    borderWidth: 1,
    borderColor: "rgba(34,139,84,0.18)",
  },
  preferenceModalCountdownText: {
    color: leafRideColors.leaf,
    fontFamily: fonts.SemiBold,
    fontSize: 14,
    lineHeight: 18,
  },
  preferenceModalSection: {
    marginTop: 18,
  },
  preferenceModalSectionLabel: {
    color: leafRideColors.secondary,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 15,
    marginBottom: 9,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  preferenceModalOptions: {
    gap: 8,
  },
  preferenceModalOption: {
    minHeight: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E7ECE8",
    backgroundColor: "#FAFBFA",
    paddingHorizontal: 13,
    paddingVertical: 10,
    overflow: "hidden",
  },
  preferenceModalOptionSelected: {
    borderColor: "rgba(23,74,43,0.38)",
    backgroundColor: "#F0F7F2",
  },
  preferenceModalOptionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  preferenceModalOptionText: {
    color: leafRideColors.text,
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17,
    flex: 1,
  },
  preferenceModalOptionTextSelected: {
    color: leafRideColors.leaf,
  },
  preferenceModalOptionCheck: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#D8E1DB",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  preferenceModalOptionCheckSelected: {
    borderColor: leafRideColors.leaf,
    backgroundColor: leafRideColors.leaf,
  },
  preferenceModalOptionHint: {
    marginTop: 4,
    color: leafRideColors.secondary,
    fontFamily: fonts.Regular,
    fontSize: 11,
    lineHeight: 15,
  },
  preferenceModalOptionHintSelected: {
    color: "#466755",
  },
  preferenceModalProgressHeader: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  preferenceModalProgressLabel: {
    color: leafRideColors.secondary,
    fontFamily: fonts.Medium,
    fontSize: 11,
    lineHeight: 15,
  },
  preferenceModalProgressTime: {
    color: leafRideColors.leaf,
    fontFamily: fonts.SemiBold,
    fontSize: 11,
    lineHeight: 15,
  },
  preferenceModalProgressTrack: {
    marginTop: 7,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(23,74,43,0.1)",
    overflow: "hidden",
  },
  preferenceModalProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: leafRideColors.leaf,
  },
  preferenceModalConfirmButton: {
    marginTop: 16,
    minHeight: leafButtonMetrics.height,
    borderRadius: leafButtonMetrics.radius,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: leafRideColors.leaf,
  },
  preferenceModalConfirmButtonText: {
    color: "#FFFFFF",
    fontFamily: fonts.SemiBold,
    fontSize: 13,
    lineHeight: 17,
  },
});
