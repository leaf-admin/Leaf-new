import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import * as Device from "expo-device";
import * as Location from "expo-location";
import { AppState, Platform } from "react-native";
import polyline from "@mapbox/polyline";
import auth from "@react-native-firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Logger from "../../utils/Logger";
import { requestForegroundLocationPermissionWithDisclosure } from "../../services/AndroidPermissionDisclosure";
import WebSocketManager from "../../services/WebSocketManager";
import realtimeConnectionOrchestrator from "../../services/RealtimeConnectionOrchestrator";
import receiptService from "../../services/ReceiptService";
import RatingService from "../../services/RatingService";
import interactiveNotificationService from "../../services/InteractiveNotificationService";
import prototypeDriverTripAssistantService, {
  calculateDistanceMeters,
  PICKUP_TOLERANCE_METERS,
} from "../../services/PrototypeDriverTripAssistantService";
import {
  buildLeafNativeNavigationState,
  calculateDistanceToRouteMeters,
  normalizeNavigationSteps,
} from "../../services/LeafNativeNavigationEngine";
import {
  detectInputType,
  fetchGeocodeAddress,
  fetchCoordsfromPlace,
  fetchPlacesAutocomplete,
  getDirectionsApi,
} from "../../services/runtime/locationRouteBridge";
import {
  PROTOTYPE_ORIGIN_COORDINATE,
  resolveOperationalVehicleType,
} from "./robotaxiPrototypeData";
import {
  resolvePrototypeProfileEmail,
  resolvePrototypeProfileName,
  resolvePrototypeProfilePhone,
} from "./prototypeProfileIdentity";
import {
  buildFallbackRouteCoordinates,
  clearPrototypeMapRoute,
  getPrototypeMapRoute,
  setPrototypeMapRoute,
} from "./prototypeMapRoute";
import { shouldIgnoreTransientBookingError } from "./bookingErrorPolicy";
import { resolveDriverOnlineLocationSeed as resolveDriverOnlineLocationSeedHelper } from "./driverOnlineLocationSeed";
import {
  shouldFlushRuntimeSessionImmediately,
  shouldFlushRuntimeSessionOnAppState,
  shouldMaintainRealtimeSessionForSnapshot,
  shouldSyncActiveRideForSnapshot,
  normalizeRuntimeLifecycleStatus,
} from "./runtimeCrashRecovery";
import { resolveMeaningfulAddress } from "./addressLabelUtils";
import {
  getDriverOfferNetAmount,
  mergeDriverOfferEntry as mergeDriverOfferEntryWithLockedPricing,
  mergeDriverOffers as mergeDriverOffersWithLockedPricing,
} from "./driverOfferPricingSnapshot";
import { dismissDriverOfferRuntimeState } from "./driverOfferState";
import { formatCurrencyBRL, resolveTripTollAmount } from "./tripFinancialSummary";
import { SEARCH_TOTAL_DURATION_SECONDS } from "./searchPresentation";
import {
  SEARCH_TIMEOUT_RECONCILING_MESSAGE,
  isPassengerSearchExpired,
  shouldPreservePassengerSearchOnIdleSync,
} from "./passengerSearchLifecycle";
import {
  advanceCoordinateAlongPath,
  buildPlaybackPath,
  resolvePlaybackStepMeters,
} from "./mockRoutePlaybackService";
import {
  DRIVER_ONBOARDING_STAGE_KEYS,
  completeDriverOnboardingStage,
  computeDriverOnboardingState,
  createInitialDriverOnboardingState,
  updateDriverOnboardingChecklist,
} from "../../services/DriverOnboardingService";
import driverActivationService from "../../services/DriverActivationService";
import rideCostTelemetryService from "../../services/RideCostTelemetryService";
import { getApiURL } from "../../config/NetworkConfig";
import { getPrototypePlaybackConfigSnapshot } from "../../config/prototypePlaybackConfig";
import {
  allowCustomOtpFallback,
  allowForcedPaymentBypass,
  allowTestUserTools,
} from "../../config/runtimeAccessPolicy";
import { restoreQaSeedProfile } from "../../utils/qaSeedProfile";

const SEARCH_TIMER_INTERVAL_MS = 1000;
const BOARDING_COUNTDOWN_INTERVAL_MS = 1000;
const DRIVER_ACTIVE_LOCATION_REFRESH_MS = 2500;
const TRIP_HISTORY_LIMIT = 12;
const CHAT_MESSAGE_LIMIT = 80;
const MIN_HEADING_DELTA_DEG = 2;
const NOTIFICATION_LIMIT = 24;
const DRIVER_ACTIVATION_STORAGE_PREFIX = "@prototype_driver_activation_";
const RUNTIME_SESSION_STORAGE_PREFIX = "@prototype_runtime_session_";
const RUNTIME_QA_SEED_STORAGE_PREFIX = "@prototype_runtime_qa_seed_";
const CONFIRMED_DESTINATIONS_STORAGE_KEY = "confirmedDestinations";
const DRIVER_LOCATION_HEARTBEAT_MS = 5000;
const DRIVER_ROUTE_PLAN_SHARE_REFRESH_MS = 15000;
const PASSENGER_LOCATION_HEARTBEAT_MS = 2000;
const PASSENGER_LOCATION_STATIONARY_HEARTBEAT_MS = 4500;
const PASSENGER_LOCATION_STARTED_HEARTBEAT_MS = 3000;
const PASSENGER_LOCATION_MIN_SEND_GAP_MS = 900;
const PASSENGER_LOCATION_MIN_MOVEMENT_METERS = 6;
const PASSENGER_LOCATION_MIN_HEADING_DELTA_DEG = 8;
const MAX_DIRECTIONS_REQUESTS_PER_BOOKING = Math.max(
  1,
  Number.parseInt(
    process.env.EXPO_PUBLIC_MAX_DIRECTIONS_REQUESTS_PER_BOOKING || "6",
    10,
  ) || 6,
);
const RUNTIME_ACTIVE_RIDE_RESYNC_INTERVAL_MS = 6000;
const DRIVER_ROUTE_PLAYBACK_TICK_MS = 2500;
const PASSENGER_ROUTE_PLAYBACK_TICK_MS = 2500;
const PASSENGER_ROUTE_PLAYBACK_STALE_MS = 4500;
const DRIVER_TRANSIENT_CARD_DURATION_MS = 3600;
const DRIVER_COMPETITIVE_TRANSIENT_CARD_DURATION_MS = 8000;
const SUPPRESSED_BOOKING_EVENT_WINDOW_MS = 15000;
const RUNTIME_LIFECYCLE_EVENT_DEDUP_WINDOW_MS = 1500;
const ACTIVE_RIDE_SNAPSHOT_COORDINATE_PRECISION = 4;
const DRIVER_STATUS_RETRY_ATTEMPTS = 2;
const DRIVER_DESTINATION_MODE_DURATION_MINUTES = Math.max(
  15,
  Number.parseInt(
    process.env.EXPO_PUBLIC_DRIVER_DESTINATION_MODE_DURATION_MINUTES || "90",
    10,
  ) || 90,
);
const DRIVER_ACTIVATION_REMOTE_SYNC_INTERVAL_MS = 12000;
const DRIVER_ACTIVATION_SYNC_MIN_GAP_MS = 6000;
const DESTINATION_SEARCH_MIN_QUERY_LENGTH = 3;
const DESTINATION_SEARCH_SESSION_IDLE_MS = 45000;
const DESTINATION_SEARCH_RESULT_CACHE_MS = 15000;
const QUOTE_LOCK_VALIDITY_MS = Math.max(
  15000,
  Number.parseInt(process.env.EXPO_PUBLIC_QUOTE_VALIDITY_MS || "120000", 10) ||
    120000,
);
const QUOTE_LOCK_COORDINATE_PRECISION = Math.max(
  2,
  Number.parseInt(
    process.env.EXPO_PUBLIC_QUOTE_LOCK_COORDINATE_PRECISION || "3",
    10,
  ) || 3,
);
const QUOTE_LOCK_MAX_ROUTE_POINTS = Math.max(
  2,
  Number.parseInt(
    process.env.EXPO_PUBLIC_QUOTE_LOCK_MAX_ROUTE_POINTS || "180",
    10,
  ) || 180,
);
const SESSION_RESTORE_TEST_OTP_CODES = Object.freeze({
  "21102938475": "992111",
  "5521102938475": "992111",
  "21123456789": "992000",
  "5521123456789": "992000",
});
const SESSION_RESTORE_REQUEST_ENDPOINTS = Object.freeze([
  "/api/custom-otp/request-otp",
  "/custom-otp/request-otp",
]);
const SESSION_RESTORE_VERIFY_ENDPOINTS = Object.freeze([
  "/api/custom-otp/verify-otp",
  "/custom-otp/verify-otp",
]);
const QA_SOCKET_ID_TOKEN_STORAGE_KEY = "@qa_socket_id_token";
const RUNTIME_DEBUG_KEY = "@prototype_runtime_debug_last_socket_bootstrap";
const RUNTIME_DEBUG_HISTORY_KEY = "@prototype_runtime_debug_history";
const DRIVER_OFFER_IDLE_SYNC_GRACE_MS = 12000;
const SHOULD_BYPASS_BOOT_LOCATION_PROMPT =
  Platform.OS === "ios" && Device.isDevice === false;
const RUNTIME_BOOTSTRAP_LOCATION_TIMEOUT_MS =
  Platform.OS === "android" ? 2200 : 3500;
const RIDE_REQUEST_IN_FLIGHT_WINDOW_MS = 15000;
let prototypeRideRequestInFlight = null;

function createId(prefix = "runtime") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function isRuntimeCoordinate(candidate) {
  return (
    Number.isFinite(candidate?.latitude) &&
    Number.isFinite(candidate?.longitude)
  );
}

function hasUsableRuntimeLocationSnapshot(snapshot = {}) {
  return Boolean(
    isRuntimeCoordinate(snapshot.currentCoordinate) ||
      isRuntimeCoordinate(snapshot.driverCoordinate) ||
      String(snapshot.currentAddress || "").trim(),
  );
}

async function waitForRuntimeBootstrapLocation(locationPromise, shouldWait) {
  if (!shouldWait) {
    return;
  }

  await Promise.race([
    locationPromise,
    new Promise((resolve) =>
      setTimeout(resolve, RUNTIME_BOOTSTRAP_LOCATION_TIMEOUT_MS),
    ),
  ]);
}

const RUNTIME_PERSISTED_FIELDS = Object.freeze([
  "activeRole",
  "isSocketConnected",
  "isSocketAuthenticated",
  "currentCoordinate",
  "currentHeading",
  "currentAddress",
  "bookingStatus",
  "activeBookingId",
  "lastRideBookingId",
  "activeBooking",
  "searchingElapsedSeconds",
  "selectedDestination",
  "quoteLock",
  "tripDistanceKm",
  "tripDurationMin",
  "tripArrivalText",
  "boardingDeadlineAt",
  "boardingRemainingSec",
  "selectedFare",
  "selectedVehicle",
  "paymentMethod",
  "driverInfo",
  "driverCoordinate",
  "driverTripMeta",
  "driverOnline",
  "driverOnlinePending",
  "driverOnlineMutationSource",
  "driverDestinationMode",
  "driverTransientCard",
  "driverLastTransientCard",
  "driverOffers",
  "driverActiveRide",
  "activeChatId",
  "activeChatBookingId",
  "chatMessages",
  "tripHistory",
  "lastReceipt",
  "terminalRideGuards",
  "paymentState",
  "rideExtension",
  "driverExtensionRequest",
  "operationalContinuation",
  "lastError",
  "socketError",
  "documentAnalysisState",
  "driverActivationRemote",
  "profileUid",
  "profileName",
]);
const DRIVER_DOCUMENT_TYPES = Object.freeze({
  cnh: "cnh",
  crlv: "crlv",
});
const DEFAULT_DRIVER_DESTINATION_MODE = Object.freeze({
  active: false,
  destination: null,
  destinationName: "",
  destinationAddress: "",
  expiresAt: null,
  minProgressKm: 1,
  arrivalRadiusKm: 3,
  updatedAt: null,
});
const AUTH_UID_STORAGE_KEY = "@auth_uid";
const USER_DATA_STORAGE_KEY = "@user_data";
const DEFAULT_RUNTIME_NOTIFICATIONS = Object.freeze([
  {
    id: "notif-welcome",
    title: "Bem-vinda ao Leaf",
    message: "Seu app está pronto para solicitar corridas.",
    kind: "system",
    scope: "both",
    read: false,
    createdAt: "2026-03-18T08:00:00.000Z",
  },
  {
    id: "notif-driver-online",
    title: "Modo motorista disponível",
    message: "Ative o painel para receber novas ofertas.",
    kind: "driver",
    scope: "driver",
    read: false,
    createdAt: "2026-03-18T08:10:00.000Z",
  },
  {
    id: "notif-passenger-tip",
    title: "Dica de embarque",
    message: "Mantenha o telefone por perto para acompanhar a chegada.",
    kind: "trip",
    scope: "passenger",
    read: true,
    createdAt: "2026-03-18T08:15:00.000Z",
  },
]);
const DEFAULT_DRIVER_ACTIVATION = createInitialDriverOnboardingState();
const DEFAULT_RIDE_EXTENSION_STATE = Object.freeze({
  status: "idle",
  bookingId: null,
  requestId: null,
  currentFare: 0,
  newFare: 0,
  diffFare: 0,
  destination: null,
  chargeId: null,
  paymentLink: null,
  pixQRCode: null,
  brCode: null,
  requestedAt: null,
  decidedAt: null,
  expiresAt: null,
  expiredAt: null,
  paidAt: null,
  error: "",
  message: "",
});
const DEFAULT_DRIVER_EXTENSION_REQUEST = Object.freeze({
  status: "idle",
  bookingId: null,
  requestId: null,
  currentFare: 0,
  newFare: 0,
  diffFare: 0,
  destination: null,
  chargeId: null,
  paymentLink: null,
  pixQRCode: null,
  brCode: null,
  requestedAt: null,
  decidedAt: null,
  expiresAt: null,
  expiredAt: null,
  paidAt: null,
  error: "",
  message: "",
});
const DEFAULT_OPERATIONAL_CONTINUATION = Object.freeze({
  status: "idle",
  bookingId: null,
  reason: "",
  note: "",
  previousDriverId: null,
  pickupLocation: null,
  estimatedRefund: 0,
  remainingReservedAmount: 0,
  rideLegs: [],
  error: "",
  message: "",
});
const DEFAULT_DRIVER_TRANSIENT_CARD = Object.freeze({
  id: "",
  type: "",
  title: "",
  message: "",
  bookingId: null,
  shownAt: null,
  visibleUntil: null,
});
const runtimeRoutePlanCache = new Map();
const runtimeRoutePlanInFlight = new Map();
const runtimeDirectionsRequestsByBooking = new Map();
const RUNTIME_TERMINAL_RIDE_GUARD_LIMIT = 12;
const RUNTIME_TERMINAL_STATUSES = new Set(["completed", "canceled"]);
const RUNTIME_LIFECYCLE_ORDER = Object.freeze({
  idle: 0,
  requesting: 1,
  searching: 2,
  searching_replacement: 2,
  accepted: 3,
  arrived: 4,
  started: 5,
  operational_interrupted: 6,
  completed: 100,
  canceled: 100,
});

function createDefaultDriverTripMeta(overrides = {}) {
  return {
    leg: null,
    initialMeters: null,
    initialEtaMinutes: null,
    pickupAddress: "",
    destinationAddress: "",
    pickupCoordinate: null,
    destinationCoordinate: null,
    fare: 0,
    fareLabel: "",
    routePlan: null,
    ...overrides,
  };
}

const DEFAULT_RUNTIME_STATE = Object.freeze({
  ready: false,
  initializing: false,
  presentationSyncing: false,
  connecting: false,
  isSocketConnected: false,
  isSocketAuthenticated: false,
  activeRole: "customer",
  socketError: "",
  currentCoordinate: null,
  currentHeading: 0,
  notifications: DEFAULT_RUNTIME_NOTIFICATIONS,
  currentAddress: "",
  bookingStatus: "idle",
  searchingElapsedSeconds: 0,
  activeBookingId: null,
  lastRideBookingId: null,
  activeBooking: null,
  selectedDestination: null,
  quoteLock: null,
  tripDistanceKm: null,
  tripDurationMin: null,
  tripArrivalText: "",
  boardingDeadlineAt: null,
  boardingRemainingSec: 0,
  selectedFare: null,
  selectedVehicle: "",
  paymentMethod: "pix",
  notificationsEnabled: true,
  trafficLayerEnabled: true,
  voiceGuidanceEnabled: false,
  driverInfo: null,
  driverCoordinate: null,
  driverTripMeta: createDefaultDriverTripMeta(),
  driverOnline: false,
  driverOnlinePending: false,
  driverOnlineMutationSource: "",
  driverDestinationMode: DEFAULT_DRIVER_DESTINATION_MODE,
  driverActivation: DEFAULT_DRIVER_ACTIVATION,
  driverActivationResolved: false,
  driverCanGoOnline: DEFAULT_DRIVER_ACTIVATION.canGoOnline,
  driverOffers: [],
  driverActiveRide: null,
  driverTransientCard: DEFAULT_DRIVER_TRANSIENT_CARD,
  driverLastTransientCard: DEFAULT_DRIVER_TRANSIENT_CARD,
  activeChatId: null,
  activeChatBookingId: null,
  chatMessages: [],
  chatLoading: false,
  chatSending: false,
  chatError: "",
  supportLoading: false,
  supportError: "",
  supportLastTicket: null,
  supportLastIncident: null,
  driverLocationHeartbeat: {
    running: false,
    lastSentAt: null,
    lastError: "",
  },
  passengerLocationHeartbeat: {
    running: false,
    lastSentAt: null,
    lastError: "",
  },
  tripIntegrityAlert: {
    active: false,
    reason: "",
    message: "",
    distanceMeters: null,
    thresholdMeters: null,
    confirmationTimeoutSec: null,
    updatedAt: null,
  },
  driverActivationRemote: null,
  documentAnalysisState: {
    byType: {},
    lastSyncedAt: null,
  },
  profileUid: null,
  profileName: "",
  riderProfile: {
    name: "",
    phone: "",
    email: "",
    preference: "",
  },
  paymentState: {
    status: "idle",
    paymentId: null,
    amount: 0,
    method: "pix",
    error: "",
    refundStatus: null,
    refundAmount: 0,
    cancellationFee: 0,
    refundId: null,
    chargeId: null,
  },
  rideExtension: DEFAULT_RIDE_EXTENSION_STATE,
  driverExtensionRequest: DEFAULT_DRIVER_EXTENSION_REQUEST,
  operationalContinuation: DEFAULT_OPERATIONAL_CONTINUATION,
  lastError: "",
  tripHistory: [],
  lastReceipt: null,
  terminalRideGuards: [],
});

let runtimeState = { ...DEFAULT_RUNTIME_STATE };
const runtimeListeners = new Set();
let runtimeBootstrapPromise = null;
let runtimePresentationSyncCount = 0;
let runtimeSearchTimer = null;
let runtimeSocketListenersAttached = false;
let runtimeChatListenersAttached = false;
let runtimeHeadingSubscription = null;
let runtimeHeadingWatcherStarted = false;
let runtimeForegroundLocationSubscription = null;
let runtimeForegroundLocationWatcherStarted = false;
let runtimeDriverHeartbeatInterval = null;
let runtimeDriverRoutePlaybackInterval = null;
let runtimeDriverRoutePlaybackActive = false;
let runtimePassengerRoutePlaybackInterval = null;
let runtimePassengerRoutePlaybackActive = false;
let runtimePassengerHeartbeatInterval = null;
let runtimePassengerHeartbeatInFlight = false;
let runtimePassengerHeartbeatStartPromise = null;
let runtimePassengerHeartbeatStartKey = "";
let runtimePassengerHeartbeatActiveBookingId = null;
let runtimePassengerHeartbeatActiveProfileUid = null;
let runtimeLastPassengerHeartbeatSentAt = 0;
let runtimeLastPassengerHeartbeatAttemptAt = 0;
let runtimeLastPassengerHeartbeatBookingId = null;
let runtimeLastPassengerHeartbeatStatus = "";
let runtimeLastPassengerHeartbeatLocation = null;
let runtimeLastPassengerHeartbeatHeading = 0;
let runtimeSessionPersistTimer = null;
let runtimeActivationRemoteSyncTimer = null;
let runtimeBoardingCountdownTimer = null;
let runtimeActivationSyncInFlight = null;
let runtimeActivationSyncUid = "";
let runtimeActivationLastSyncAtByUid = Object.create(null);
let runtimeDeferredSocketBootstrapTimer = null;
let runtimeQALockUntil = 0;
let runtimeDriverOnlineEnablePromise = null;
let runtimeLastSocketConnectAt = 0;
let runtimeLastDriverCoordinateUpdateAt = 0;
let runtimeLastSharedDriverRoutePlanKey = "";
let runtimeLastSharedDriverRoutePlanAt = 0;
let runtimeReceiptRecoveryInFlight = null;
let runtimeSuppressedBookingIds = new Map();
let runtimeRideTelemetryDraftContextId = null;
let runtimeLastLifecycleEventKey = "";
let runtimeLastLifecycleEventAt = 0;
const runtimeAppliedLifecycleEventKeysByBooking = new Map();
let runtimeLastSyncedActiveRideFingerprint = "";
let runtimeEffectOwnerId = null;
const runtimeEffectConsumers = new Set();
const runtimeEffectOwnerListeners = new Set();
let runtimeDestinationSearchSessionToken = "";
let runtimeDestinationSearchSessionLastUsedAt = 0;
let runtimeDestinationSearchLastCacheKey = "";
let runtimeDestinationSearchLastResults = [];
let runtimeDestinationSearchLastResultsAt = 0;

function notifyRuntimeEffectOwnerChanged() {
  runtimeEffectOwnerListeners.forEach((listener) => {
    try {
      listener(runtimeEffectOwnerId);
    } catch (error) {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao notificar owner de efeitos do runtime:",
        error?.message || error,
      );
    }
  });
}

function setRuntimeEffectOwner(nextOwnerId = null) {
  const normalizedOwnerId = String(nextOwnerId || "").trim() || null;
  if (runtimeEffectOwnerId === normalizedOwnerId) {
    return;
  }
  runtimeEffectOwnerId = normalizedOwnerId;
  notifyRuntimeEffectOwnerChanged();
}

function registerRuntimeEffectConsumer(consumerId) {
  const normalizedConsumerId = String(consumerId || "").trim();
  if (!normalizedConsumerId) {
    return () => {};
  }

  runtimeEffectConsumers.add(normalizedConsumerId);
  if (!runtimeEffectOwnerId) {
    setRuntimeEffectOwner(normalizedConsumerId);
  } else {
    notifyRuntimeEffectOwnerChanged();
  }

  return () => {
    runtimeEffectConsumers.delete(normalizedConsumerId);
    if (runtimeEffectOwnerId === normalizedConsumerId) {
      const nextOwnerId = runtimeEffectConsumers.values().next().value || null;
      setRuntimeEffectOwner(nextOwnerId);
      return;
    }
    notifyRuntimeEffectOwnerChanged();
  };
}

function subscribeRuntimeEffectOwner(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }
  runtimeEffectOwnerListeners.add(listener);
  try {
    listener(runtimeEffectOwnerId);
  } catch (_error) {
    // ignore listener bootstrap issues
  }
  return () => {
    runtimeEffectOwnerListeners.delete(listener);
  };
}

function reserveRuntimeEffectConsumer(consumerId) {
  const normalizedConsumerId = String(consumerId || "").trim();
  if (!normalizedConsumerId) {
    return null;
  }

  runtimeEffectConsumers.add(normalizedConsumerId);
  if (!runtimeEffectOwnerId) {
    runtimeEffectOwnerId = normalizedConsumerId;
  }

  return runtimeEffectOwnerId;
}

function shouldIgnoreDuplicateLifecycleEvent(eventName, bookingId, status) {
  const normalizedEventName = String(eventName || "").trim().toLowerCase();
  const normalizedBookingId = String(
    bookingId ||
      runtimeState.activeBookingId ||
      runtimeState.driverActiveRide?.bookingId ||
      "",
  ).trim();
  const normalizedStatus = String(status || "").trim().toLowerCase();

  if (!normalizedEventName || !normalizedBookingId || !normalizedStatus) {
    return false;
  }

  const eventKey = `${normalizedEventName}:${normalizedBookingId}:${normalizedStatus}`;
  const lastAppliedEventKey =
    runtimeAppliedLifecycleEventKeysByBooking.get(normalizedBookingId) || "";
  if (lastAppliedEventKey === eventKey) {
    return true;
  }

  const now = Date.now();
  if (
    runtimeLastLifecycleEventKey === eventKey &&
    now - runtimeLastLifecycleEventAt < RUNTIME_LIFECYCLE_EVENT_DEDUP_WINDOW_MS
  ) {
    return true;
  }

  runtimeAppliedLifecycleEventKeysByBooking.set(normalizedBookingId, eventKey);
  runtimeLastLifecycleEventKey = eventKey;
  runtimeLastLifecycleEventAt = now;
  return false;
}

function normalizeTerminalRideGuardStatus(status) {
  const normalized = normalizeRuntimeLifecycleStatus(status);
  if (normalized === "canceled") {
    return "canceled";
  }
  return "completed";
}

function normalizeTerminalRideGuardEntry(entry) {
  const bookingId = String(
    entry?.bookingId || entry?.rideId || entry?.id || "",
  ).trim();
  if (!bookingId) {
    return null;
  }

  const guardedAt = String(
    entry?.guardedAt || entry?.completedAt || entry?.cancelledAt || entry?.at || "",
  ).trim();

  return {
    bookingId,
    status: normalizeTerminalRideGuardStatus(entry?.status),
    guardedAt: guardedAt || new Date().toISOString(),
  };
}

function normalizeTerminalRideGuards(value) {
  const guards = Array.isArray(value) ? value : [];
  const seen = new Set();
  return guards
    .map(normalizeTerminalRideGuardEntry)
    .filter(Boolean)
    .filter((entry) => {
      if (seen.has(entry.bookingId)) {
        return false;
      }
      seen.add(entry.bookingId);
      return true;
    })
    .slice(0, RUNTIME_TERMINAL_RIDE_GUARD_LIMIT);
}

function mergeTerminalRideGuard(previousGuards, bookingId, status = "completed") {
  const normalizedBookingId = String(bookingId || "").trim();
  if (!normalizedBookingId) {
    return normalizeTerminalRideGuards(previousGuards);
  }

  return normalizeTerminalRideGuards([
    {
      bookingId: normalizedBookingId,
      status,
      guardedAt: new Date().toISOString(),
    },
    ...normalizeTerminalRideGuards(previousGuards),
  ]);
}

function getRuntimeLifecycleOrder(status) {
  const normalized = normalizeRuntimeLifecycleStatus(status);
  return RUNTIME_LIFECYCLE_ORDER[normalized] ?? -1;
}

function getKnownRuntimeBookingIdForGuard(bookingId = "") {
  return String(
    bookingId ||
      runtimeState.activeBookingId ||
      runtimeState.driverActiveRide?.bookingId ||
      runtimeState.activeBooking?.bookingId ||
      runtimeState.lastRideBookingId ||
      "",
  ).trim();
}

function hasTerminalRideGuard(bookingId = "") {
  const normalizedBookingId = String(bookingId || "").trim();
  if (!normalizedBookingId) {
    return false;
  }

  if (
    normalizeTerminalRideGuards(runtimeState.terminalRideGuards).some(
      (entry) => entry.bookingId === normalizedBookingId,
    )
  ) {
    return true;
  }

  const lastReceiptId = String(runtimeState.lastReceipt?.id || "").trim();
  const lastRideBookingId = String(runtimeState.lastRideBookingId || "").trim();
  const localStatus = normalizeRuntimeLifecycleStatus(runtimeState.bookingStatus);
  return (
    RUNTIME_TERMINAL_STATUSES.has(localStatus) &&
    (normalizedBookingId === lastReceiptId || normalizedBookingId === lastRideBookingId)
  );
}

function shouldIgnoreLifecycleRegression(eventName, bookingId, nextStatus) {
  const normalizedBookingId = getKnownRuntimeBookingIdForGuard(bookingId);
  const normalizedNextStatus = normalizeRuntimeLifecycleStatus(nextStatus);
  if (!normalizedBookingId || !normalizedNextStatus) {
    return false;
  }

  if (
    hasTerminalRideGuard(normalizedBookingId) &&
    !RUNTIME_TERMINAL_STATUSES.has(normalizedNextStatus)
  ) {
    writeRuntimeDebugProbe("event_lifecycle_regression_ignored_terminal_guard", {
      eventName,
      bookingId: normalizedBookingId,
      nextStatus: normalizedNextStatus,
      localStatus: runtimeState.bookingStatus || null,
    });
    return true;
  }

  const activeBookingId = String(
    runtimeState.activeBookingId ||
      runtimeState.driverActiveRide?.bookingId ||
      runtimeState.activeBooking?.bookingId ||
      "",
  ).trim();
  if (activeBookingId && activeBookingId !== normalizedBookingId) {
    return false;
  }

  const currentStatus = normalizeRuntimeLifecycleStatus(runtimeState.bookingStatus);
  const currentOrder = getRuntimeLifecycleOrder(currentStatus);
  const nextOrder = getRuntimeLifecycleOrder(normalizedNextStatus);
  if (currentOrder > nextOrder && !RUNTIME_TERMINAL_STATUSES.has(normalizedNextStatus)) {
    writeRuntimeDebugProbe("event_lifecycle_regression_ignored_order", {
      eventName,
      bookingId: normalizedBookingId,
      currentStatus,
      nextStatus: normalizedNextStatus,
    });
    return true;
  }

  return false;
}

function normalizeSnapshotFingerprintCoordinate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  const precision = 10 ** ACTIVE_RIDE_SNAPSHOT_COORDINATE_PRECISION;
  return Math.round(numeric * precision) / precision;
}

function buildActiveRideSnapshotFingerprint(snapshot, bookingStatus) {
  const normalizedBookingId = String(snapshot?.bookingId || "").trim();
  const normalizedStatus = String(bookingStatus || "").trim().toLowerCase();
  if (!normalizedBookingId || !normalizedStatus) {
    return "";
  }

  return JSON.stringify({
    bookingId: normalizedBookingId,
    status: normalizedStatus,
    hasActiveRide: snapshot?.hasActiveRide === true,
    fare: Number(
      snapshot?.finalFare ??
        snapshot?.estimatedFare ??
        snapshot?.driverAmount ??
        snapshot?.driverPayout ??
        0,
    ),
    paymentStatus: String(snapshot?.paymentStatus || "").trim().toUpperCase(),
    extensionStatus: String(
      snapshot?.extensionRequest?.status || snapshot?.extensionPaymentStatus || "",
    )
      .trim()
      .toUpperCase(),
    pickupAddress: String(snapshot?.pickupLocation?.add || "").trim(),
    destinationAddress: String(snapshot?.destinationLocation?.add || "").trim(),
    pickupLat: normalizeSnapshotFingerprintCoordinate(snapshot?.pickupLocation?.lat),
    pickupLng: normalizeSnapshotFingerprintCoordinate(snapshot?.pickupLocation?.lng),
    destinationLat: normalizeSnapshotFingerprintCoordinate(
      snapshot?.destinationLocation?.lat,
    ),
    destinationLng: normalizeSnapshotFingerprintCoordinate(
      snapshot?.destinationLocation?.lng,
    ),
    driverLat: normalizeSnapshotFingerprintCoordinate(snapshot?.driverLocation?.lat),
    driverLng: normalizeSnapshotFingerprintCoordinate(snapshot?.driverLocation?.lng),
    boardingDeadlineAt: String(
      snapshot?.boardingDeadlineAt ||
        snapshot?.boardingWindow?.deadlineAt ||
        snapshot?.deadlineAt ||
        "",
    ).trim(),
  });
}

function shouldSkipSyncedActiveRideSnapshot(snapshot, bookingStatus) {
  const fingerprint = buildActiveRideSnapshotFingerprint(snapshot, bookingStatus);
  if (!fingerprint) {
    return {
      fingerprint,
      skip: false,
    };
  }

  const normalizedBookingId = String(snapshot?.bookingId || "").trim();
  const normalizedStatus = String(bookingStatus || "").trim().toLowerCase();
  const runtimeBookingId = String(runtimeState.activeBookingId || "").trim();
  const runtimeStatus = String(runtimeState.bookingStatus || "")
    .trim()
    .toLowerCase();
  const alreadyHydrated =
    normalizedBookingId &&
    runtimeBookingId === normalizedBookingId &&
    runtimeStatus === normalizedStatus;

  return {
    fingerprint,
    skip: alreadyHydrated && runtimeLastSyncedActiveRideFingerprint === fingerprint,
  };
}

function resolveRuntimeRideTelemetrySourceMeta(overrides = {}) {
  const role = String(overrides.role || runtimeState.activeRole || "passenger")
    .trim()
    .toLowerCase();
  const userType =
    overrides.userType ||
    (role === "driver" ? "driver" : "customer");

  return {
    userId: overrides.userId || runtimeState.profileUid || null,
    userType,
    platform: Platform.OS,
    flow: "prototype",
    scenario: "robotaxi_prototype",
    surface: overrides.surface || "prototype_runtime",
  };
}

function resolveRuntimeRideTelemetryContext(overrides = {}) {
  const sourceMeta = resolveRuntimeRideTelemetrySourceMeta(overrides);
  const sourceKey =
    overrides.sourceKey ||
    `${sourceMeta.userType || "unknown"}:${sourceMeta.userId || "anonymous"}`;
  const bookingId =
    overrides.bookingId ||
    runtimeState.activeBookingId ||
    runtimeState.driverActiveRide?.bookingId ||
    null;

  if (bookingId) {
    return {
      ...rideCostTelemetryService.ensureContext({
        bookingId,
        sourceMeta,
        sourceKey,
      }),
      ...(overrides.cacheMode ? { cacheMode: overrides.cacheMode } : {}),
      ...(overrides.routeScope ? { routeScope: overrides.routeScope } : {}),
      ...(overrides.forceFresh === true ? { forceFresh: true } : {}),
      ...(overrides.surface ? { surface: overrides.surface } : {}),
    };
  }

  if (!runtimeRideTelemetryDraftContextId) {
    runtimeRideTelemetryDraftContextId = rideCostTelemetryService.ensureContext({
      sourceMeta,
      sourceKey,
    }).contextId;
  }

  return {
    ...rideCostTelemetryService.ensureContext({
      contextId: runtimeRideTelemetryDraftContextId,
      sourceMeta,
      sourceKey,
    }),
    ...(overrides.cacheMode ? { cacheMode: overrides.cacheMode } : {}),
    ...(overrides.routeScope ? { routeScope: overrides.routeScope } : {}),
    ...(overrides.forceFresh === true ? { forceFresh: true } : {}),
    ...(overrides.surface ? { surface: overrides.surface } : {}),
  };
}

function bindRuntimeRideTelemetryToBooking(bookingId, overrides = {}) {
  const normalizedBookingId = String(bookingId || "").trim();
  if (!normalizedBookingId) {
    return null;
  }

  const sourceMeta = resolveRuntimeRideTelemetrySourceMeta(overrides);
  const boundContext = rideCostTelemetryService.bindContextToBooking({
    contextId: runtimeRideTelemetryDraftContextId,
    bookingId: normalizedBookingId,
    sourceMeta,
    sourceKey: overrides.sourceKey || null,
  });
  runtimeRideTelemetryDraftContextId = null;
  return boundContext;
}

function rotateRuntimeRideTelemetryDraftContext(overrides = {}) {
  const sourceMeta = resolveRuntimeRideTelemetrySourceMeta(overrides);
  const sourceKey =
    overrides.sourceKey ||
    `${sourceMeta.userType || "unknown"}:${sourceMeta.userId || "anonymous"}`;
  const rotatedContext = rideCostTelemetryService.rotateDraftContext({
    sourceMeta,
    sourceKey,
  });
  runtimeRideTelemetryDraftContextId = rotatedContext?.contextId || null;
  return rotatedContext;
}

function cleanupSuppressedBookingIds(now = Date.now()) {
  runtimeSuppressedBookingIds.forEach((expiresAt, bookingId) => {
    if (!Number.isFinite(expiresAt) || expiresAt <= now) {
      runtimeSuppressedBookingIds.delete(bookingId);
    }
  });
}

function suppressBookingEvents(bookingIdInput, reason = "") {
  const bookingId = String(bookingIdInput || "").trim();
  if (!bookingId) {
    return;
  }

  const now = Date.now();
  cleanupSuppressedBookingIds(now);
  runtimeSuppressedBookingIds.set(
    bookingId,
    now + SUPPRESSED_BOOKING_EVENT_WINDOW_MS,
  );
  writeRuntimeDebugProbe("booking_events_suppressed", {
    bookingId,
    reason: reason || null,
    windowMs: SUPPRESSED_BOOKING_EVENT_WINDOW_MS,
  });
}

function isBookingEventSuppressed(bookingIdInput) {
  const bookingId = String(bookingIdInput || "").trim();
  if (!bookingId) {
    return false;
  }

  cleanupSuppressedBookingIds();
  return runtimeSuppressedBookingIds.has(bookingId);
}

function normalizeRuntimeRole(rawRole) {
  const normalized = String(rawRole || "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["driver", "motorista", "partner", "parceiro"].includes(normalized)) {
    return "driver";
  }
  if (["passenger", "customer", "rider", "cliente"].includes(normalized)) {
    return "customer";
  }

  return null;
}

function resolveRuntimeRole(profile = null) {
  const profileRole = normalizeRuntimeRole(
    profile?.usertype ??
      profile?.userType ??
      profile?.role ??
      profile?.user_role ??
      profile?.accountType ??
      profile?.profile?.usertype ??
      profile?.profile?.userType ??
      profile?.profile?.role ??
      profile?.profile?.user_role ??
      profile?.profile?.accountType,
  );
  if (profileRole) {
    return profileRole;
  }
  return normalizeRuntimeRole(runtimeState.activeRole) || "customer";
}

function resolveExplicitProfileRole(profile = null) {
  return (
    normalizeRuntimeRole(
      profile?.usertype ??
        profile?.userType ??
        profile?.role ??
        profile?.user_role ??
        profile?.accountType ??
        profile?.profile?.usertype ??
        profile?.profile?.userType ??
        profile?.profile?.role ??
        profile?.profile?.user_role ??
        profile?.profile?.accountType,
    ) || null
  );
}

function normalizePersistedPrototypeProfile(profile = null, fallbackUid = "") {
  if (!profile || typeof profile !== "object") {
    const uid = String(fallbackUid || "").trim();
    return uid ? { uid } : null;
  }

  const uid = String(profile?.uid || fallbackUid || "").trim();
  if (!uid) {
    return null;
  }

  const normalizedUserType = normalizeRuntimeRole(
    profile?.usertype ??
      profile?.userType ??
      profile?.profile?.usertype ??
      profile?.profile?.userType,
  );

  return {
    ...profile,
    uid,
    ...(normalizedUserType
      ? { usertype: normalizedUserType, userType: normalizedUserType }
      : {}),
  };
}

async function persistPrototypeProfilePatch(patch = {}, fallbackProfile = null) {
  if (!patch || typeof patch !== "object") {
    return null;
  }

  if (shouldSuppressRuntimeStorageWrites()) {
    return normalizePersistedPrototypeProfile(
      {
        ...(fallbackProfile && typeof fallbackProfile === "object"
          ? fallbackProfile
          : {}),
        ...patch,
      },
      patch?.uid || fallbackProfile?.uid || "",
    );
  }

  try {
    const entries = await AsyncStorage.multiGet([
      USER_DATA_STORAGE_KEY,
      AUTH_UID_STORAGE_KEY,
    ]);
    const storedUserData = entries?.[0]?.[1] || null;
    const storedUid = String(entries?.[1]?.[1] || "").trim();

    let parsedProfile = null;
    if (storedUserData) {
      try {
        parsedProfile = JSON.parse(storedUserData);
      } catch (_error) {
        parsedProfile = null;
      }
    }

    const normalizedProfile = normalizePersistedPrototypeProfile(
      parsedProfile || fallbackProfile,
      fallbackProfile?.uid || storedUid,
    );

    if (!normalizedProfile?.uid) {
      return null;
    }

    const nextProfile = normalizePersistedPrototypeProfile(
      {
        ...normalizedProfile,
        ...patch,
        profile: {
          ...(normalizedProfile.profile || {}),
          ...(typeof patch.profile === "object" && patch.profile
            ? patch.profile
            : {}),
          ...(Object.prototype.hasOwnProperty.call(patch, "canGoOnline")
            ? { canGoOnline: patch.canGoOnline }
            : {}),
        },
      },
      normalizedProfile.uid,
    );

    if (!nextProfile?.uid) {
      return null;
    }

    await AsyncStorage.multiSet([
      [USER_DATA_STORAGE_KEY, JSON.stringify(nextProfile)],
      [AUTH_UID_STORAGE_KEY, nextProfile.uid],
    ]);

    return nextProfile;
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao persistir patch do perfil no runtime:",
      error?.message || error,
    );
    return null;
  }
}

async function resolveRuntimeActionProfile(profile = null, expectedRole = null) {
  const normalizedProfile = normalizePersistedPrototypeProfile(
    profile,
    profile?.uid || "",
  );
  const explicitRole = resolveExplicitProfileRole(normalizedProfile);

  if (
    normalizedProfile?.uid &&
    (!expectedRole || explicitRole === expectedRole)
  ) {
    return normalizedProfile;
  }

  try {
    const storedUid = String(
      normalizedProfile?.uid || (await AsyncStorage.getItem(AUTH_UID_STORAGE_KEY)) || "",
    ).trim();
    if (!storedUid) {
      return normalizedProfile;
    }

    const rebuiltQaProfile = await restoreQaSeedProfile({
      AsyncStorage,
      authUidKey: AUTH_UID_STORAGE_KEY,
      userDataKey: USER_DATA_STORAGE_KEY,
      driverActivationKey: `${DRIVER_ACTIVATION_STORAGE_PREFIX}${storedUid}`,
    });
    const resolvedProfile = normalizePersistedPrototypeProfile(
      rebuiltQaProfile || normalizedProfile,
      storedUid,
    );

    return resolvedProfile;
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao reconstruir perfil para ação do runtime:",
      error?.message || error,
    );
    return normalizedProfile;
  }
}

function normalizePhoneForSessionRestore(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }

  const digits = raw.replace(/\D/g, "");
  if (!digits) {
    return "";
  }

  if (raw.startsWith("+")) {
    return `+${digits}`;
  }

  if (digits.startsWith("55")) {
    return `+${digits}`;
  }

  return `+55${digits}`;
}

function resolveSessionRestoreOtpCode(phoneNumber) {
  const digits = String(phoneNumber || "").replace(/\D/g, "");
  return SESSION_RESTORE_TEST_OTP_CODES[digits] || "0".repeat(6);
}

async function hasQaSocketIdTokenForPrototype() {
  if (!allowTestUserTools()) {
    return false;
  }

  try {
    const token = String(
      (await AsyncStorage.getItem(QA_SOCKET_ID_TOKEN_STORAGE_KEY)) || "",
    ).trim();
    return token.length > 0;
  } catch (_error) {
    return false;
  }
}

function resolveProfilePhoneForSessionRestore(profile = null) {
  return normalizePhoneForSessionRestore(
    profile?.phoneNumber ??
      profile?.phone ??
      profile?.mobile ??
      profile?.profile?.phoneNumber ??
      profile?.profile?.phone ??
      profile?.profile?.mobile ??
      "",
  );
}

async function postSessionRestoreRequest(endpoints, payload) {
  const apiBaseUrl = getApiURL();
  let lastError = null;

  for (const endpoint of endpoints) {
    const url = `${apiBaseUrl}${endpoint}`;
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const responseData = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(
          responseData?.error || `HTTP ${response.status}`,
        );
        error.status = response.status;
        error.payload = responseData;
        throw error;
      }

      return responseData;
    } catch (error) {
      lastError = error;
      if (error?.status && error.status !== 404) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Falha ao restaurar sessão Firebase.");
}

async function writeRuntimeDebugProbe(step, data = {}) {
  if (shouldSuppressRuntimeStorageWrites()) {
    return;
  }

  try {
    const entry = {
      step,
      data,
      at: new Date().toISOString(),
    };
    await AsyncStorage.setItem(
      RUNTIME_DEBUG_KEY,
      JSON.stringify(entry),
    );

    const rawHistory = await AsyncStorage.getItem(RUNTIME_DEBUG_HISTORY_KEY);
    const parsedHistory = rawHistory ? JSON.parse(rawHistory) : [];
    const history = Array.isArray(parsedHistory) ? parsedHistory : [];
    history.push(entry);
    await AsyncStorage.setItem(
      RUNTIME_DEBUG_HISTORY_KEY,
      JSON.stringify(history.slice(-40)),
    );
  } catch (_error) {
    // best effort
  }
}

async function ensureFirebaseSessionForPrototype(profile = null) {
  const targetUid = String(profile?.uid || "").trim();
  if (!targetUid) {
    return false;
  }

  const currentUser = auth().currentUser;
  if (currentUser?.uid === targetUid) {
    await writeRuntimeDebugProbe("firebase_session_already_present", {
      uid: targetUid,
    });
    return true;
  }

  if (await hasQaSocketIdTokenForPrototype()) {
    await writeRuntimeDebugProbe("firebase_session_restore_skipped_qa_token", {
      uid: targetUid,
    });
    return false;
  }

  const canAttemptRestore =
    allowCustomOtpFallback() &&
    !targetUid.startsWith("test-user-dev") &&
    !targetUid.startsWith("test-customer-dev");

  if (!canAttemptRestore) {
    await writeRuntimeDebugProbe("firebase_session_restore_skipped", {
      uid: targetUid,
      isTestUser: profile?.isTestUser === true,
    });
    return false;
  }

  const phoneNumber = resolveProfilePhoneForSessionRestore(profile);
  if (!phoneNumber) {
    await writeRuntimeDebugProbe("firebase_session_restore_missing_phone", {
      uid: targetUid,
    });
    Logger.warn(
      "⚠️ [PrototypeRuntime] Perfil sem telefone para restaurar sessão Firebase.",
    );
    return false;
  }

  Logger.log(
    "🔐 [PrototypeRuntime] Restaurando sessão Firebase para o runtime...",
    {
      uid: targetUid,
      phoneNumber,
    },
  );

  if (!allowCustomOtpFallback() && !allowTestUserTools()) {
    Logger.warn(
      "🚫 [PrototypeRuntime] Restauração de sessão por OTP customizado bloqueada fora de dev/review/E2E.",
    );
    return false;
  }

  const requestResponse = await postSessionRestoreRequest(
    SESSION_RESTORE_REQUEST_ENDPOINTS,
    {
      phone: phoneNumber,
    },
  );

  if (!requestResponse?.success || !requestResponse?.verificationId) {
    throw new Error(
      requestResponse?.error || "Falha ao iniciar restauração de sessão.",
    );
  }

  const verifyResponse = await postSessionRestoreRequest(
    SESSION_RESTORE_VERIFY_ENDPOINTS,
    {
      phone: phoneNumber,
      verificationId: requestResponse.verificationId,
      otp: resolveSessionRestoreOtpCode(phoneNumber),
    },
  );

  if (!verifyResponse?.success || !verifyResponse?.customToken) {
    throw new Error(
      verifyResponse?.error || "Falha ao confirmar sessão restaurada.",
    );
  }

  const userCredential = await auth().signInWithCustomToken(
    verifyResponse.customToken,
  );
  const restoredUid = String(userCredential?.user?.uid || "").trim();

  if (!restoredUid) {
    throw new Error("Firebase não retornou usuário após restaurar sessão.");
  }

  if (restoredUid !== targetUid) {
    throw new Error(`Sessão restaurada para UID divergente (${restoredUid}).`);
  }

  Logger.log("✅ [PrototypeRuntime] Sessão Firebase restaurada com sucesso.", {
    uid: restoredUid,
  });
  await writeRuntimeDebugProbe("firebase_session_restored", {
    uid: restoredUid,
  });
  return true;
}

function delay(ms) {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(0, Number(ms) || 0)),
  );
}

function createRuntimeNotification({
  title,
  message,
  kind = "system",
  scope = "both",
  read = false,
}) {
  return {
    id: `notif-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    title: String(title || "Atualização"),
    message: String(message || ""),
    kind,
    scope,
    read: Boolean(read),
    createdAt: new Date().toISOString(),
  };
}

function appendRuntimeNotification(entry) {
  if (!entry || typeof entry !== "object") {
    return;
  }

  setRuntimeState((previous) => {
    const previousNotifications = Array.isArray(previous.notifications)
      ? previous.notifications
      : [];
    return {
      notifications: [entry, ...previousNotifications].slice(
        0,
        NOTIFICATION_LIMIT,
      ),
    };
  });
}

function markNotificationReadInState(notificationId) {
  if (!notificationId) {
    return;
  }

  setRuntimeState((previous) => {
    const previousNotifications = Array.isArray(previous.notifications)
      ? previous.notifications
      : [];
    return {
      notifications: previousNotifications.map((item) =>
        item.id === notificationId && !item.read
          ? {
              ...item,
              read: true,
            }
          : item,
      ),
    };
  });
}

function markAllNotificationsReadInState() {
  setRuntimeState((previous) => {
    const previousNotifications = Array.isArray(previous.notifications)
      ? previous.notifications
      : [];
    return {
      notifications: previousNotifications.map((item) =>
        item.read
          ? item
          : {
              ...item,
              read: true,
            },
      ),
    };
  });
}

function resolveDriverActivationStorageKey(uid) {
  const key = String(uid || "").trim();
  return `${DRIVER_ACTIVATION_STORAGE_PREFIX}${key || "anonymous"}`;
}

function resolveRuntimeSessionStorageKey(uid) {
  const key = String(uid || "").trim();
  return `${RUNTIME_SESSION_STORAGE_PREFIX}${key || "anonymous"}`;
}

function resolveRuntimeQaSeedStorageKey(uid) {
  const key = String(uid || "").trim();
  return `${RUNTIME_QA_SEED_STORAGE_PREFIX}${key || "anonymous"}`;
}

function isRuntimeQALockActive() {
  return Number.isFinite(runtimeQALockUntil) && runtimeQALockUntil > Date.now();
}

function allowRuntimeLocalRideLifecycleFallback() {
  return (
    isRuntimeQALockActive() ||
    allowForcedPaymentBypass() ||
    allowTestUserTools()
  );
}

function shouldSuppressRuntimeStorageWrites() {
  return isRuntimeQALockActive();
}

function hasRuntimeActiveRideContext(source = runtimeState) {
  const normalizedLocalBookingStatus = normalizeRuntimeLifecycleStatus(
    source?.bookingStatus,
  );
  const hasLocalRideContext = Boolean(
    source?.activeBookingId ||
      source?.activeBooking?.bookingId ||
      source?.activeBooking?.id ||
      source?.driverActiveRide?.bookingId ||
      source?.driverActiveRide?.id,
  );

  return (
    hasLocalRideContext &&
    ["accepted", "arrived", "started"].includes(normalizedLocalBookingStatus)
  );
}

function shouldPreserveQALockedRideOnIdleSync() {
  return isRuntimeQALockActive() && hasRuntimeActiveRideContext(runtimeState);
}

function clearDeferredSocketBootstrapTimer() {
  if (runtimeDeferredSocketBootstrapTimer) {
    clearTimeout(runtimeDeferredSocketBootstrapTimer);
    runtimeDeferredSocketBootstrapTimer = null;
  }
}

async function loadPersistedRuntimeQaSeed(uid) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    return null;
  }

  try {
    const raw = await AsyncStorage.getItem(
      resolveRuntimeQaSeedStorageKey(safeUid),
    );
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao carregar lock QA persistido:",
      error?.message || error,
    );
    return null;
  }
}

async function clearPersistedRuntimeQaSeed(uid) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    return;
  }

  try {
    await AsyncStorage.removeItem(resolveRuntimeQaSeedStorageKey(safeUid));
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao limpar lock QA persistido:",
      error?.message || error,
    );
  }
}

function scheduleDeferredSocketBootstrap(profile, freezeUntil) {
  const freezeTimestamp = Number(freezeUntil) || 0;
  const remainingMs = Math.max(0, freezeTimestamp - Date.now());

  runtimeQALockUntil = freezeTimestamp;
  clearDeferredSocketBootstrapTimer();

  if (!profile?.uid || remainingMs <= 0) {
    runtimeQALockUntil = 0;
    return;
  }

  runtimeDeferredSocketBootstrapTimer = setTimeout(() => {
    runtimeDeferredSocketBootstrapTimer = null;
    runtimeQALockUntil = 0;
    clearPersistedRuntimeQaSeed(profile.uid).catch((error) => {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao limpar lock QA expirado:",
        error?.message || error,
      );
    });
    ensureSocketReady(profile).catch((error) => {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao iniciar socket após lock QA:",
        error?.message || error,
      );
    });
  }, remainingMs);
}

function mergeDriverActivation(a, b) {
  const stateA = computeDriverOnboardingState(
    a || createInitialDriverOnboardingState(),
  );
  const stateB = computeDriverOnboardingState(
    b || createInitialDriverOnboardingState(),
  );
  const canGoOnlineA = Boolean(stateA?.canGoOnline);
  const canGoOnlineB = Boolean(stateB?.canGoOnline);
  if (canGoOnlineA !== canGoOnlineB) {
    return canGoOnlineB ? stateB : stateA;
  }
  const dateA = new Date(stateA?.updatedAt || 0).getTime();
  const dateB = new Date(stateB?.updatedAt || 0).getTime();
  return dateB >= dateA ? stateB : stateA;
}

function shouldPreferQaDriverActivation(profile = null) {
  return Boolean(
    allowTestUserTools() &&
      profile?.isTestUser === true &&
      resolveExplicitProfileRole(profile) === "driver" &&
      sanitizeText(profile?.uid, "").length > 0,
  );
}

function createApprovedDriverActivationState(seedState = null) {
  const timestamp = new Date().toISOString();
  const baseState = computeDriverOnboardingState(
    seedState || createInitialDriverOnboardingState(),
  );
  const existingNotifications = Array.isArray(baseState.notifications)
    ? baseState.notifications.filter(
        (item) => item?.id !== "driver-onboarding-started",
      )
    : [];

  return computeDriverOnboardingState({
    ...baseState,
    preRegistrationCompleted: true,
    driverProfileStatus: "approved",
    vehicleProfileStatus: "approved",
    stages: {
      ...baseState.stages,
      [DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]: {
        ...baseState.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA],
        status: "approved",
        completedAt:
          baseState.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]
            ?.completedAt || timestamp,
        updatedAt: timestamp,
        checklist: {
          ...baseState.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]
            ?.checklist,
          cnhEar: true,
          vehicleRegistration: true,
          backgroundCheckConsent: true,
        },
      },
      [DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION]: {
        ...baseState.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION],
        status: "approved",
        completedAt:
          baseState.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION]
            ?.completedAt || timestamp,
        updatedAt: timestamp,
        checklist: {
          ...baseState.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION]
            ?.checklist,
          facialValidation: true,
        },
      },
      [DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA]: {
        ...baseState.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA],
        status: "approved",
        completedAt:
          baseState.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA]
            ?.completedAt || timestamp,
        updatedAt: timestamp,
        checklist: {
          ...baseState.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA]
            ?.checklist,
          crlv: true,
        },
      },
    },
    notifications:
      existingNotifications.length > 0
        ? existingNotifications
        : [
            {
              id: "seed-driver-activation-approved",
              title: "Ativação aprovada",
              message: "Motorista liberado para ficar online.",
              kind: "driver",
              scope: "driver",
              read: false,
              createdAt: timestamp,
            },
          ],
    updatedAt: timestamp,
  });
}

async function loadPersistedDriverActivation(uid) {
  try {
    const raw = await AsyncStorage.getItem(
      resolveDriverActivationStorageKey(uid),
    );
    if (!raw) {
      return computeDriverOnboardingState(createInitialDriverOnboardingState());
    }
    return computeDriverOnboardingState(JSON.parse(raw));
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao carregar ativação do motorista:",
      error?.message || error,
    );
    return computeDriverOnboardingState(createInitialDriverOnboardingState());
  }
}

async function persistDriverActivation(uid, activationState) {
  if (shouldSuppressRuntimeStorageWrites()) {
    return;
  }

  try {
    await AsyncStorage.setItem(
      resolveDriverActivationStorageKey(uid),
      JSON.stringify(computeDriverOnboardingState(activationState)),
    );
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao salvar ativação do motorista:",
      error?.message || error,
    );
  }
}

function buildPersistedRuntimeStateSnapshot(state) {
  const source = state && typeof state === "object" ? state : runtimeState;
  const payload = {};

  RUNTIME_PERSISTED_FIELDS.forEach((field) => {
    payload[field] = source[field];
  });

  return payload;
}

async function loadPersistedRuntimeSession(uid) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    return null;
  }

  try {
    const raw = await AsyncStorage.getItem(
      resolveRuntimeSessionStorageKey(safeUid),
    );
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    const restored = {};
    RUNTIME_PERSISTED_FIELDS.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(parsed, field)) {
        restored[field] = parsed[field];
      }
    });

    return restored;
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao carregar sessão persistida:",
      error?.message || error,
    );
    return null;
  }
}

function sanitizePersistedRuntimeSessionForProfile(session, profile = null) {
  if (!session || typeof session !== "object") {
    return null;
  }

  const restored = { ...session };
  const role = resolveRuntimeRole(profile);
  const normalizedBookingStatus = String(restored.bookingStatus || "")
    .trim()
    .toLowerCase();
  restored.quoteLock = normalizePersistedQuoteLock(restored.quoteLock);
  restored.terminalRideGuards = normalizeTerminalRideGuards(
    restored.terminalRideGuards,
  );
  if (normalizedBookingStatus !== "idle") {
    restored.quoteLock = null;
  }
  const hasPersistedDriverActiveRide = Boolean(
    restored.driverActiveRide?.bookingId || restored.driverActiveRide?.id,
  );
  const hasPersistedDriverOffer = Array.isArray(restored.driverOffers)
    ? restored.driverOffers.some((item) => Boolean(item?.bookingId || item?.id))
    : false;

  restored.isSocketConnected = false;
  restored.isSocketAuthenticated = false;
  restored.driverDestinationMode = buildDriverDestinationModeState(
    restored.driverDestinationMode,
  );

  if (role === "driver") {
    let restoredDriverOnline = Boolean(restored.driverOnline);
    let restoredDriverOnlinePending = Boolean(restored.driverOnlinePending);
    const normalizedOnlineMutationSource = String(
      restored.driverOnlineMutationSource || "",
    )
      .trim()
      .toLowerCase();
    const hasPersistedDriverRideInProgress =
      Boolean(restored.activeBookingId) ||
      ["accepted", "arrived", "started"].includes(normalizedBookingStatus);
    const hasPersistedDriverOnlineIntent =
      restoredDriverOnline ||
      restoredDriverOnlinePending ||
      [
        "bootstrap_restore_online_intent",
        "bootstrap_restore_online_confirmed",
        "bootstrap_promote_stale_online_pending",
        "socket_disconnect_preserve_online_intent",
        "trip_completed_preserve_online_intent",
        "enable_online_remote_confirmed",
        "socket_status_online",
      ].includes(normalizedOnlineMutationSource);

    if (hasPersistedDriverOnlineIntent) {
      if (hasPersistedDriverRideInProgress || hasPersistedDriverActiveRide) {
        restored.driverOnline = true;
        restored.driverOnlinePending = false;
        restored.driverOnlineMutationSource =
          "bootstrap_restore_active_driver_session";
      } else {
        restored.driverOnline = false;
        restored.driverOnlinePending = true;
        restored.driverOnlineMutationSource = "bootstrap_restore_online_intent";
      }
    } else {
      restored.driverOnline = false;
      restored.driverOnlinePending = false;
      restored.driverOnlineMutationSource =
        normalizedOnlineMutationSource || "";
    }
    if (!restored.driverOnlinePending) {
      restored.driverOnlinePending = false;
    }

    if (!hasPersistedDriverRideInProgress && !hasPersistedDriverActiveRide) {
      restored.currentCoordinate = null;
      restored.driverCoordinate = null;
      restored.currentHeading = null;
      restored.currentAddress = "";
    }

    restored.driverLocationHeartbeat = {
      ...DEFAULT_RUNTIME_STATE.driverLocationHeartbeat,
      ...(restored.driverLocationHeartbeat &&
      typeof restored.driverLocationHeartbeat === "object"
        ? restored.driverLocationHeartbeat
        : {}),
      running: false,
      lastError: "",
    };

    const shouldDiscardIdleDriverArtifacts =
      !hasPersistedDriverActiveRide &&
      !restored.activeBookingId &&
      hasPersistedDriverOffer &&
      (normalizedBookingStatus === "" ||
        normalizedBookingStatus === "idle" ||
        normalizedBookingStatus === "completed");

    if (shouldDiscardIdleDriverArtifacts) {
      restored.driverOffers = [];
      restored.activeBooking = null;
      restored.activeBookingId = null;
      restored.bookingStatus = "idle";
      restored.driverCoordinate = null;
      restored.tripArrivalText = "";
      restored.boardingDeadlineAt = null;
      restored.boardingRemainingSec = 0;
    }
  }

  if (
    role === "customer" &&
    ["requesting", "searching", "searching_replacement"].includes(
      normalizedBookingStatus,
    ) &&
    (!Number.isFinite(Number(restored.searchingElapsedSeconds)) ||
      Number(restored.searchingElapsedSeconds) <= 0)
  ) {
    restored.searchingElapsedSeconds =
      resolveSearchElapsedSecondsFromSource(restored);
  }

  if (role === "customer") {
    const shouldPreservePassengerDriverContext = [
      "accepted",
      "arrived",
      "started",
      "completed",
      "operational_interrupted",
      "searching_replacement",
    ].includes(normalizedBookingStatus);

    restored.driverOffers = [];
    restored.driverOnline = false;
    restored.driverOnlinePending = false;
    restored.driverOnlineMutationSource = "activation_sync_non_driver";
    restored.driverDestinationMode = DEFAULT_DRIVER_DESTINATION_MODE;
    restored.driverActivationRemote = null;
    if (!shouldPreservePassengerDriverContext) {
      restored.driverActiveRide = null;
      restored.driverCoordinate = null;
    }
    restored.searchingElapsedSeconds = Math.min(
      SEARCH_TOTAL_DURATION_SECONDS,
      Math.max(0, Math.floor(Number(restored.searchingElapsedSeconds) || 0)),
    );
  }

  if (
    RUNTIME_TERMINAL_STATUSES.has(normalizedBookingStatus) &&
    (restored.lastRideBookingId || restored.lastReceipt?.id)
  ) {
    restored.terminalRideGuards = mergeTerminalRideGuard(
      restored.terminalRideGuards,
      restored.lastRideBookingId || restored.lastReceipt?.id,
      normalizedBookingStatus,
    );
  }

  return restored;
}

async function persistRuntimeSession(uid, statePatch = null) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    return;
  }

  if (shouldSuppressRuntimeStorageWrites()) {
    return;
  }

  try {
    const snapshot = buildPersistedRuntimeStateSnapshot(
      statePatch || runtimeState,
    );
    await AsyncStorage.setItem(
      resolveRuntimeSessionStorageKey(safeUid),
      JSON.stringify(snapshot),
    );
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao salvar sessão persistida:",
      error?.message || error,
    );
  }
}

function clearRuntimeSessionPersistTimer() {
  if (runtimeSessionPersistTimer) {
    clearTimeout(runtimeSessionPersistTimer);
    runtimeSessionPersistTimer = null;
  }
}

async function flushRuntimeSessionNow(reason = "manual", statePatch = null) {
  const snapshot =
    statePatch && typeof statePatch === "object" ? statePatch : runtimeState;
  const safeUid = String(snapshot?.profileUid || runtimeState?.profileUid || "")
    .trim();

  if (!safeUid || snapshot?.initializing || isRuntimeQALockActive()) {
    return false;
  }

  clearRuntimeSessionPersistTimer();
  await persistRuntimeSession(safeUid, snapshot);
  await writeRuntimeDebugProbe("runtime_session_flush", {
    userId: safeUid,
    reason,
    bookingStatus: snapshot?.bookingStatus || null,
    activeBookingId: snapshot?.activeBookingId || null,
    hasDriverOffers: Array.isArray(snapshot?.driverOffers)
      ? snapshot.driverOffers.length > 0
      : false,
    hasDriverActiveRide: Boolean(snapshot?.driverActiveRide?.bookingId),
    driverOnline: Boolean(snapshot?.driverOnline),
    driverOnlinePending: Boolean(snapshot?.driverOnlinePending),
  });
  return true;
}

function scheduleRuntimeSessionPersist() {
  const safeUid = String(runtimeState?.profileUid || "").trim();
  if (!safeUid) {
    clearRuntimeSessionPersistTimer();
    return;
  }

  if (
    runtimeState.initializing ||
    !runtimeState.ready ||
    isRuntimeQALockActive()
  ) {
    clearRuntimeSessionPersistTimer();
    return;
  }

  clearRuntimeSessionPersistTimer();
  runtimeSessionPersistTimer = setTimeout(() => {
    persistRuntimeSession(safeUid).catch((error) => {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Persistência de sessão falhou:",
        error?.message || error,
      );
    });
  }, 420);
}

function normalizeHeading(headingValue) {
  const heading = Number(headingValue);
  if (!Number.isFinite(heading)) {
    return null;
  }

  const normalized = heading % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function resolveSearchElapsedSecondsFromSource(source = null) {
  const normalizedSource =
    source && typeof source === "object" ? source : {};
  const timestampCandidates = [
    normalizedSource?.activeBooking?.timestamp,
    normalizedSource?.activeBooking?.createdAt,
    normalizedSource?.activeBooking?.requestedAt,
    normalizedSource?.activeBooking?.paymentData?.confirmedAt,
    normalizedSource?.paymentState?.confirmedAt,
    normalizedSource?.paymentState?.processedAt,
  ];

  for (const candidate of timestampCandidates) {
    if (!candidate) {
      continue;
    }

    const parsedMs = new Date(candidate).getTime();
    if (Number.isNaN(parsedMs)) {
      continue;
    }

    return Math.min(
      SEARCH_TOTAL_DURATION_SECONDS,
      Math.max(0, Math.floor((Date.now() - parsedMs) / 1000)),
    );
  }

  return 0;
}

function shouldUpdateHeading(nextHeading, previousHeading) {
  if (!Number.isFinite(nextHeading)) {
    return false;
  }

  if (!Number.isFinite(previousHeading)) {
    return true;
  }

  const delta = Math.abs(nextHeading - previousHeading);
  const circularDelta = Math.min(delta, 360 - delta);
  return circularDelta >= MIN_HEADING_DELTA_DEG;
}

function shouldUpdateRuntimeCoordinate(nextCoordinate, previousCoordinate) {
  const nextLatitude = Number(nextCoordinate?.latitude);
  const nextLongitude = Number(nextCoordinate?.longitude);
  const previousLatitude = Number(previousCoordinate?.latitude);
  const previousLongitude = Number(previousCoordinate?.longitude);

  if (!Number.isFinite(nextLatitude) || !Number.isFinite(nextLongitude)) {
    return false;
  }

  if (!Number.isFinite(previousLatitude) || !Number.isFinite(previousLongitude)) {
    return true;
  }

  return (
    Math.abs(nextLatitude - previousLatitude) >= 0.000001 ||
    Math.abs(nextLongitude - previousLongitude) >= 0.000001
  );
}

async function startForegroundLocationWatcher() {
  if (runtimeForegroundLocationWatcherStarted) {
    return;
  }

  runtimeForegroundLocationWatcherStarted = true;

  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      runtimeForegroundLocationWatcherStarted = false;
      return;
    }

    runtimeForegroundLocationSubscription = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 1000,
        distanceInterval: 0,
      },
      (position) => {
        const latitude = Number(position?.coords?.latitude);
        const longitude = Number(position?.coords?.longitude);
        const nextHeading = normalizeHeading(position?.coords?.heading);
        const nextSpeed = Number(position?.coords?.speed);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return;
        }

        const nextCoordinate = {
          latitude,
          longitude,
          ...(Number.isFinite(nextSpeed) && nextSpeed >= 0
            ? { speed: nextSpeed }
            : {}),
        };
        setRuntimeState((previous) => {
          const patch = {};
          const shouldIgnorePlaybackOverride =
            runtimeDriverRoutePlaybackActive &&
            normalizeRuntimeRole(previous.activeRole) === "driver";

          if (
            !shouldIgnorePlaybackOverride &&
            shouldUpdateRuntimeCoordinate(
              nextCoordinate,
              previous.currentCoordinate,
            )
          ) {
            patch.currentCoordinate = nextCoordinate;

            if (normalizeRuntimeRole(previous.activeRole) === "driver") {
              patch.driverCoordinate = nextCoordinate;
            }
          }

          if (
            Number.isFinite(nextHeading) &&
            shouldUpdateHeading(nextHeading, previous.currentHeading)
          ) {
            patch.currentHeading = nextHeading;
          }

          return Object.keys(patch).length > 0 ? patch : null;
        });
      },
    );
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Localização em foreground indisponível:",
      error?.message || error,
    );
    runtimeForegroundLocationWatcherStarted = false;
    runtimeForegroundLocationSubscription = null;
  }
}

function stopForegroundLocationWatcher() {
  if (runtimeForegroundLocationSubscription) {
    runtimeForegroundLocationSubscription.remove();
    runtimeForegroundLocationSubscription = null;
  }
  runtimeForegroundLocationWatcherStarted = false;
}

async function startHeadingWatcher() {
  if (runtimeHeadingWatcherStarted) {
    return;
  }

  runtimeHeadingWatcherStarted = true;

  try {
    runtimeHeadingSubscription = await Location.watchHeadingAsync(
      (headingData) => {
        const nextHeading = normalizeHeading(
          headingData?.trueHeading ?? headingData?.magHeading,
        );
        if (!Number.isFinite(nextHeading)) {
          return;
        }

        setRuntimeState((previous) => {
          if (!shouldUpdateHeading(nextHeading, previous.currentHeading)) {
            return null;
          }

          return {
            currentHeading: nextHeading,
          };
        });
      },
    );
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Heading em tempo real indisponível:",
      error?.message || error,
    );
    runtimeHeadingWatcherStarted = false;
    runtimeHeadingSubscription = null;
  }
}

function notifyRuntime() {
  runtimeListeners.forEach((listener) => {
    try {
      listener(runtimeState);
    } catch (error) {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Erro ao notificar listener:",
        error?.message || error,
      );
    }
  });
}

function resolveKnownRideBookingId(source = {}) {
  if (!source || typeof source !== "object") {
    return "";
  }

  return String(
    source.activeBookingId ||
      source.driverActiveRide?.bookingId ||
      source.driverActiveRide?.id ||
      source.activeBooking?.bookingId ||
      source.activeBooking?.id ||
      source.driverTripMeta?.bookingId ||
      source.activeChatBookingId ||
      "",
  ).trim();
}

function setRuntimeState(next) {
  const previousState = runtimeState;
  const rawPatch = typeof next === "function" ? next(runtimeState) : next;
  let patch = rawPatch;
  if (!patch || typeof patch !== "object") {
    return;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "terminalRideGuards")) {
    patch = {
      ...patch,
      terminalRideGuards: normalizeTerminalRideGuards(patch.terminalRideGuards),
    };
  }
  if (patch.driverTripMeta && typeof patch.driverTripMeta === "object") {
    const mergedStateForRouteHydration = {
      ...runtimeState,
      ...patch,
    };
    patch = {
      ...patch,
      driverTripMeta: hydrateDriverTripMetaRoutePlan(
        patch.driverTripMeta,
        mergedStateForRouteHydration,
        patch.activeBookingId ||
          patch.driverActiveRide?.bookingId ||
          runtimeState.activeBookingId ||
          runtimeState.driverActiveRide?.bookingId ||
          null,
      ),
    };
  }
  if (
    patch.driverCoordinate &&
    Number.isFinite(patch.driverCoordinate.latitude) &&
    Number.isFinite(patch.driverCoordinate.longitude)
  ) {
    runtimeLastDriverCoordinateUpdateAt = Date.now();
  }
  const knownRideBookingId =
    resolveKnownRideBookingId(patch) ||
    resolveKnownRideBookingId(runtimeState) ||
    String(runtimeState.lastRideBookingId || "").trim();
  if (
    knownRideBookingId &&
    String(patch.lastRideBookingId || "").trim() !== knownRideBookingId
  ) {
    patch = {
      ...patch,
      lastRideBookingId: knownRideBookingId,
    };
  }
  const changedKeys = Object.keys(patch);
  const shouldPersist = changedKeys.some((key) =>
    RUNTIME_PERSISTED_FIELDS.includes(key),
  );
  const nextRuntimeState = {
    ...runtimeState,
    ...patch,
  };
  const shouldFlushImmediately =
    shouldPersist &&
    shouldFlushRuntimeSessionImmediately(
      previousState,
      patch,
      nextRuntimeState,
    );
  runtimeState = nextRuntimeState;
  if (shouldPersist) {
    if (shouldFlushImmediately) {
      flushRuntimeSessionNow("critical_state_patch", nextRuntimeState).catch(
        (error) => {
          Logger.warn(
            "⚠️ [PrototypeRuntime] Flush imediato da sessão falhou:",
            error?.message || error,
          );
        },
      );
    } else {
      scheduleRuntimeSessionPersist();
    }
  }
  notifyRuntime();
}

function beginRuntimePresentationSync() {
  runtimePresentationSyncCount += 1;
  if (runtimePresentationSyncCount === 1) {
    setRuntimeState({
      presentationSyncing: true,
    });
  }
}

function endRuntimePresentationSync() {
  runtimePresentationSyncCount = Math.max(0, runtimePresentationSyncCount - 1);
  if (runtimePresentationSyncCount === 0) {
    setRuntimeState({
      presentationSyncing: false,
    });
  }
}

function buildDriverTransientCard(payload = {}) {
  const now = Date.now();
  const type = String(payload.type || "").trim();
  const durationMs =
    type === "accepted_by_other_driver_competitive"
      ? DRIVER_COMPETITIVE_TRANSIENT_CARD_DURATION_MS
      : DRIVER_TRANSIENT_CARD_DURATION_MS;
  return {
    ...DEFAULT_DRIVER_TRANSIENT_CARD,
    id: String(payload.id || `driver-transient-${now}`),
    type,
    title: String(payload.title || "").trim(),
    message: String(payload.message || "").trim(),
    bookingId: payload.bookingId || null,
    shownAt: payload.shownAt || new Date(now).toISOString(),
    visibleUntil:
      payload.visibleUntil ||
      new Date(now + durationMs).toISOString(),
  };
}

function showDriverTransientCard(payload = {}) {
  const nextCard = buildDriverTransientCard(payload);
  setRuntimeState({
    driverTransientCard: nextCard,
    driverLastTransientCard: nextCard,
  });
}

function dismissDriverTransientCard(expectedId = null) {
  setRuntimeState((previous) => {
    const currentId = String(previous.driverTransientCard?.id || "").trim();
    if (!currentId) {
      return null;
    }
    if (expectedId && currentId !== expectedId) {
      return null;
    }
    return {
      driverTransientCard: DEFAULT_DRIVER_TRANSIENT_CARD,
    };
  });
}

function isCompetitiveAcceptErrorMessage(message) {
  const normalized = String(message || "").trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    normalized.includes("já foi aceita por outro motorista") ||
    normalized.includes("ja foi aceita por outro motorista") ||
    normalized.includes("nao está mais disponível") ||
    normalized.includes("não está mais disponível") ||
    normalized.includes("nao esta mais disponível") ||
    normalized.includes("nao esta mais disponivel") ||
    normalized.includes("não está mais disponivel") ||
    normalized.includes("nao tem permissão para aceitar esta corrida") ||
    normalized.includes("não tem permissão para aceitar esta corrida") ||
    normalized.includes("nao tem permissao para aceitar esta corrida") ||
    normalized.includes("não tem permissao para aceitar esta corrida") ||
    normalized.includes("permissão para aceitar esta corrida") ||
    normalized.includes("permissao para aceitar esta corrida")
  );
}

function subscribeRuntime(listener) {
  if (typeof listener !== "function") {
    return () => {};
  }

  runtimeListeners.add(listener);
  listener(runtimeState);

  return () => {
    runtimeListeners.delete(listener);
    if (runtimeListeners.size === 0) {
      clearRuntimeSessionPersistTimer();
      stopDriverLocationHeartbeat();
      stopDriverRoutePlayback();
      stopPassengerRoutePlayback();
      stopPassengerLocationHeartbeat();
      stopDriverActivationRemoteSync();
      stopForegroundLocationWatcher();
    }
  };
}

function stopDriverRoutePlayback() {
  if (runtimeDriverRoutePlaybackInterval) {
    clearInterval(runtimeDriverRoutePlaybackInterval);
    runtimeDriverRoutePlaybackInterval = null;
  }
  runtimeDriverRoutePlaybackActive = false;
}

function stopPassengerRoutePlayback() {
  if (runtimePassengerRoutePlaybackInterval) {
    clearInterval(runtimePassengerRoutePlaybackInterval);
    runtimePassengerRoutePlaybackInterval = null;
  }
  runtimePassengerRoutePlaybackActive = false;
}

function parseNameFromDescription(description = "") {
  const clean = String(description || "").trim();
  if (!clean) {
    return "Destino";
  }

  const separator = clean.indexOf(" - ");
  if (separator > 0) {
    return clean.slice(0, separator).trim();
  }

  const comma = clean.indexOf(",");
  if (comma > 0) {
    return clean.slice(0, comma).trim();
  }

  return clean;
}

function parseAddressFromDescription(description = "") {
  const clean = String(description || "").trim();
  if (!clean) {
    return "";
  }

  const separator = clean.indexOf(" - ");
  if (separator > 0 && separator < clean.length - 3) {
    return clean.slice(separator + 3).trim();
  }

  const comma = clean.indexOf(",");
  if (comma > 0 && comma < clean.length - 2) {
    return clean.slice(comma + 1).trim();
  }

  return clean;
}

function createRuntimeDestinationSearchSessionToken() {
  return `proto-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function resetRuntimeDestinationSearchSession(_reason = "") {
  runtimeDestinationSearchSessionToken = "";
  runtimeDestinationSearchSessionLastUsedAt = 0;
  runtimeDestinationSearchLastCacheKey = "";
  runtimeDestinationSearchLastResults = [];
  runtimeDestinationSearchLastResultsAt = 0;
}

function getRuntimeDestinationSearchSessionToken() {
  const now = Date.now();
  if (
    !runtimeDestinationSearchSessionToken ||
    now - runtimeDestinationSearchSessionLastUsedAt >
      DESTINATION_SEARCH_SESSION_IDLE_MS
  ) {
    runtimeDestinationSearchSessionToken =
      createRuntimeDestinationSearchSessionToken();
  }
  runtimeDestinationSearchSessionLastUsedAt = now;
  return runtimeDestinationSearchSessionToken;
}

function cloneRuntimeDestinationSearchResults(results = []) {
  if (!Array.isArray(results)) {
    return [];
  }
  return results.map((item) => ({ ...item }));
}

function buildRuntimeDestinationSearchCacheKey(query, location) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return "";
  }
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  const normalizedLat = Number.isFinite(lat) ? lat.toFixed(3) : "na";
  const normalizedLng = Number.isFinite(lng) ? lng.toFixed(3) : "na";
  return `${normalizedQuery}:${normalizedLat}:${normalizedLng}`;
}

function getCachedRuntimeDestinationSearchResults({ query, location }) {
  const cacheKey = buildRuntimeDestinationSearchCacheKey(query, location);
  if (!cacheKey || runtimeDestinationSearchLastCacheKey !== cacheKey) {
    return null;
  }

  const now = Date.now();
  if (now - runtimeDestinationSearchLastResultsAt > DESTINATION_SEARCH_RESULT_CACHE_MS) {
    runtimeDestinationSearchLastCacheKey = "";
    runtimeDestinationSearchLastResults = [];
    runtimeDestinationSearchLastResultsAt = 0;
    return null;
  }

  return cloneRuntimeDestinationSearchResults(runtimeDestinationSearchLastResults);
}

function setCachedRuntimeDestinationSearchResults({ query, location, results }) {
  const cacheKey = buildRuntimeDestinationSearchCacheKey(query, location);
  if (!cacheKey) {
    return;
  }
  runtimeDestinationSearchLastCacheKey = cacheKey;
  runtimeDestinationSearchLastResults = cloneRuntimeDestinationSearchResults(results);
  runtimeDestinationSearchLastResultsAt = Date.now();
}

function normalizeDestinationItem(item) {
  const coordinate =
    item?.coordinate ||
    (item?.lat && item?.lng
      ? { latitude: item.lat, longitude: item.lng }
      : null);
  const name =
    item?.name ||
    item?.mainText ||
    parseNameFromDescription(item?.description || item?.address || "Destino");
  const address =
    item?.address ||
    item?.secondaryText ||
    parseAddressFromDescription(item?.description || name);

  return {
    id: item?.id || item?.place_id || `${name}-${address}`,
    name,
    address,
    eta: item?.eta || " -- ",
    place_id: item?.place_id || item?.placeId || null,
    sourceType: sanitizeText(item?.sourceType, ""),
    previewMode: sanitizeText(item?.previewMode, ""),
    skipGooglePreview: item?.skipGooglePreview === true,
    searchSessionToken:
      sanitizeText(item?.searchSessionToken || item?.sessionToken, "") || null,
    coordinate:
      coordinate &&
      Number.isFinite(coordinate.latitude) &&
      Number.isFinite(coordinate.longitude)
        ? {
            latitude: Number(coordinate.latitude),
            longitude: Number(coordinate.longitude),
          }
        : null,
  };
}

function buildDriverDestinationModeState(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rawDestination =
    source.destination ||
    source.destinationLocation ||
    source.target ||
    (Number.isFinite(Number(source.lat)) && Number.isFinite(Number(source.lng))
      ? {
          name: source.destinationName || source.label || "Destino",
          address: source.destinationAddress || source.address || "",
          coordinate: {
            latitude: Number(source.lat),
            longitude: Number(source.lng),
          },
        }
      : null);
  const normalizedDestination = rawDestination
    ? normalizeDestinationItem(rawDestination)
    : null;
  const coordinate = normalizedDestination?.coordinate || null;
  const active = Boolean(source.active) && Boolean(coordinate);
  const durationMinutes = Number(
    source.durationMinutes || source.destinationModeDurationMinutes,
  );
  const fallbackDurationMinutes =
    Number.isFinite(durationMinutes) && durationMinutes > 0
      ? durationMinutes
      : DRIVER_DESTINATION_MODE_DURATION_MINUTES;
  const fallbackExpiresAt =
    Date.now() + Math.max(1, fallbackDurationMinutes) * 60 * 1000;
  const expiresAt = source.expiresAt || source.destinationModeExpiresAt || null;
  const normalizedExpiresAt = active
    ? sanitizeText(expiresAt, "") || new Date(fallbackExpiresAt).toISOString()
    : null;
  const minProgressKm = Number(source.minProgressKm ?? source.destinationModeMinProgressKm);
  const arrivalRadiusKm = Number(source.arrivalRadiusKm ?? source.destinationModeArrivalRadiusKm);

  return {
    ...DEFAULT_DRIVER_DESTINATION_MODE,
    active,
    destination: active ? normalizedDestination : null,
    destinationName: active
      ? sanitizeText(
          source.destinationName || normalizedDestination?.name,
          "Destino",
        )
      : "",
    destinationAddress: active
      ? sanitizeText(
          source.destinationAddress || normalizedDestination?.address,
          "",
        )
      : "",
    expiresAt: normalizedExpiresAt,
    minProgressKm:
      Number.isFinite(minProgressKm) && minProgressKm >= 0
        ? minProgressKm
        : DEFAULT_DRIVER_DESTINATION_MODE.minProgressKm,
    arrivalRadiusKm:
      Number.isFinite(arrivalRadiusKm) && arrivalRadiusKm > 0
        ? arrivalRadiusKm
        : DEFAULT_DRIVER_DESTINATION_MODE.arrivalRadiusKm,
    updatedAt: sanitizeText(source.updatedAt, "") || new Date().toISOString(),
  };
}

function formatCurrencyBR(value) {
  return formatCurrencyBRL(value);
}

function sanitizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function resolveCompletedReceiptPickupLabel(
  source = {},
  previousState = runtimeState,
) {
  return (
    resolveMeaningfulAddress(
      source?.pickupAddress,
      source?.pickupLocation?.add,
      source?.pickup,
      previousState?.driverActiveRide?.pickupAddress,
      previousState?.driverActiveRide?.pickup,
      previousState?.driverTripMeta?.pickupAddress,
      previousState?.activeBooking?.pickupLocation?.add,
      previousState?.currentAddress,
    ) || "Origem"
  );
}

function resolveCompletedReceiptDropoffLabel(
  source = {},
  previousState = runtimeState,
) {
  return (
    resolveMeaningfulAddress(
      source?.destinationAddress,
      source?.destinationLocation?.add,
      source?.destinationLocation?.address,
      source?.dropoffAddress,
      source?.drop,
      previousState?.driverActiveRide?.dropoffAddress,
      previousState?.driverActiveRide?.dropoff,
      previousState?.driverTripMeta?.destinationAddress,
      previousState?.activeBooking?.destinationLocation?.add,
      previousState?.selectedDestination?.address,
      previousState?.selectedDestination?.name,
    ) || "Destino"
  );
}

function buildCompletedReceiptRouteLabel(
  source = {},
  previousState = runtimeState,
) {
  const pickupLabel = resolveCompletedReceiptPickupLabel(source, previousState);
  const dropoffLabel = resolveCompletedReceiptDropoffLabel(
    source,
    previousState,
  );

  return `${pickupLabel} -> ${dropoffLabel}`;
}

function toFiniteRuntimeMoney(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickPreferredRuntimeMoney(...values) {
  const finiteValues = values
    .map((value) => toFiniteRuntimeMoney(value))
    .filter((value) => value !== null);
  return finiteValues.find((value) => value > 0) ?? finiteValues[0] ?? null;
}

function roundCurrencyValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Number(parsed.toFixed(2));
}

function mergeFeeBreakdowns(actualBreakdown, estimatedBreakdown) {
  if (!actualBreakdown && !estimatedBreakdown) {
    return null;
  }

  return {
    ...(estimatedBreakdown || {}),
    ...(actualBreakdown || {}),
  };
}

function extractBestPayloadFeeBreakdown(payload = {}) {
  return mergeFeeBreakdowns(
    extractPayloadFeeBreakdown(payload, { estimated: false }),
    extractPayloadFeeBreakdown(payload, { estimated: true }),
  );
}

export function normalizeCompletedTripDriverNetAmount({
  finalFare,
  driverNetAmount,
  operationalFee,
  paymentIntermediationFee,
  totalFees,
} = {}) {
  const normalizedFinalFare = toFiniteRuntimeMoney(finalFare);
  const normalizedDriverNetAmount = toFiniteRuntimeMoney(driverNetAmount);
  const normalizedTotalFees = toFiniteRuntimeMoney(totalFees);
  const normalizedOperationalFee = toFiniteRuntimeMoney(operationalFee);
  const normalizedPaymentIntermediationFee = toFiniteRuntimeMoney(
    paymentIntermediationFee,
  );

  const feesFromTotal =
    normalizedTotalFees !== null && normalizedTotalFees > 0
      ? normalizedTotalFees
      : null;
  const feesFromParts =
    normalizedOperationalFee !== null || normalizedPaymentIntermediationFee !== null
      ? Number(normalizedOperationalFee || 0) +
        Number(normalizedPaymentIntermediationFee || 0)
      : null;
  const resolvedFees =
    feesFromTotal ?? (feesFromParts !== null && feesFromParts > 0
      ? feesFromParts
      : null);

  if (
    normalizedFinalFare !== null &&
    normalizedFinalFare > 0 &&
    resolvedFees !== null &&
    resolvedFees > 0
  ) {
    return roundCurrencyValue(Math.max(0, normalizedFinalFare - resolvedFees));
  }

  return normalizedDriverNetAmount;
}

function buildDriverOffer({
  bookingId,
  destination,
  fare,
  etaMinutes,
  pickupAddress,
  pickupCoordinate,
  preferences,
  passengerName,
  passengerId,
}) {
  const destinationName = sanitizeText(destination?.name, "Destino");
  const destinationAddress = sanitizeText(
    destination?.address,
    destinationName,
  );
  const nextEta =
    Number.isFinite(etaMinutes) && etaMinutes > 0
      ? Math.max(2, Math.round(etaMinutes))
      : 6;
  const payoutValue = Number.isFinite(Number(fare)) ? Number(fare) : 0;

  return {
    id: bookingId || `driver-offer-${Date.now()}`,
    bookingId: bookingId || null,
    passengerId: sanitizeText(passengerId, ""),
    passenger: sanitizeText(passengerName, "Passageiro Leaf"),
    pickup: sanitizeText(pickupAddress, "Origem atual"),
    dropoff: destinationName,
    dropoffAddress: destinationAddress,
    eta: `${nextEta} min`,
    payout: formatCurrencyBR(payoutValue),
    fare: payoutValue,
    grossFare: payoutValue,
    preferences:
      preferences && typeof preferences === "object" ? { ...preferences } : {},
    destinationCoordinate:
      destination?.coordinate &&
      Number.isFinite(destination.coordinate.latitude) &&
      Number.isFinite(destination.coordinate.longitude)
        ? {
            latitude: Number(destination.coordinate.latitude),
            longitude: Number(destination.coordinate.longitude),
          }
        : null,
    pickupCoordinate:
      pickupCoordinate &&
      Number.isFinite(pickupCoordinate.latitude) &&
      Number.isFinite(pickupCoordinate.longitude)
        ? {
            latitude: Number(pickupCoordinate.latitude),
            longitude: Number(pickupCoordinate.longitude),
          }
        : null,
  };
}

function resolvePassengerIdFromBookingId(bookingId = "") {
  const normalized = String(bookingId || "").trim();
  const match = normalized.match(/^booking_[^_]+_(.+)$/);
  return sanitizeText(match?.[1], "");
}

function resolveReceiptPassengerName(rawName, previousState = runtimeState) {
  const normalizedName = sanitizeText(rawName, "");
  if (!normalizedName) {
    return "";
  }

  const role =
    normalizeRuntimeRole(previousState?.activeRole) ||
    resolveRuntimeRole(previousState?.profile);
  const driverName = sanitizeText(
    previousState?.profileName || previousState?.driverInfo?.name,
    "",
  );

  if (role === "driver" && driverName && normalizedName === driverName) {
    return "Passageiro Leaf";
  }

  return normalizedName;
}

function cloneDefaultRideExtensionState(patch = {}) {
  return {
    ...DEFAULT_RIDE_EXTENSION_STATE,
    ...patch,
  };
}

function cloneDefaultDriverExtensionRequest(patch = {}) {
  return {
    ...DEFAULT_DRIVER_EXTENSION_REQUEST,
    ...patch,
  };
}

function cloneDefaultOperationalContinuation(patch = {}) {
  return {
    ...DEFAULT_OPERATIONAL_CONTINUATION,
    ...patch,
  };
}

function normalizeExtensionDestination(rawValue = null) {
  if (!rawValue || typeof rawValue !== "object") {
    return null;
  }

  const latitude = Number(rawValue?.latitude ?? rawValue?.lat);
  const longitude = Number(rawValue?.longitude ?? rawValue?.lng);
  const hasCoordinate = Number.isFinite(latitude) && Number.isFinite(longitude);
  const address = sanitizeText(
    rawValue?.add ||
      rawValue?.address ||
      rawValue?.formattedAddress ||
      rawValue?.formatted_address,
    "",
  );
  const name = sanitizeText(
    rawValue?.name,
    parseNameFromDescription(address || "Destino"),
  );

  return {
    id:
      rawValue?.id ||
      rawValue?.place_id ||
      `${name}-${address || latitude}-${longitude}`,
    name,
    address: address || name,
    eta: rawValue?.eta || " -- ",
    place_id: rawValue?.place_id || rawValue?.placeId || null,
    coordinate: hasCoordinate
      ? {
          latitude,
          longitude,
        }
      : null,
  };
}

function buildRideExtensionState(payload = {}, overrides = {}) {
  const extensionRequest =
    payload?.extensionRequest && typeof payload.extensionRequest === "object"
      ? payload.extensionRequest
      : payload;
  const destination = normalizeExtensionDestination(
    extensionRequest?.newEndLocation ||
      payload?.newEndLocation ||
      payload?.destinationLocation ||
      payload?.destination,
  );

  return cloneDefaultRideExtensionState({
    bookingId:
      payload?.bookingId ||
      payload?.rideId ||
      extensionRequest?.bookingId ||
      null,
    requestId: extensionRequest?.requestId || payload?.requestId || null,
    status: String(
      overrides.status ||
        extensionRequest?.status ||
        payload?.status ||
        DEFAULT_RIDE_EXTENSION_STATE.status,
    )
      .trim()
      .toLowerCase(),
    currentFare:
      Number(extensionRequest?.currentFare ?? payload?.currentFare ?? 0) || 0,
    newFare: Number(extensionRequest?.newFare ?? payload?.newFare ?? 0) || 0,
    diffFare: Number(extensionRequest?.diffFare ?? payload?.diffFare ?? 0) || 0,
    destination,
    chargeId: sanitizeText(extensionRequest?.chargeId || payload?.chargeId, ""),
    paymentLink: sanitizeText(
      extensionRequest?.paymentLink || payload?.paymentLink,
      "",
    ),
    pixQRCode: sanitizeText(
      extensionRequest?.pixQRCode || payload?.pixQRCode,
      "",
    ),
    brCode: sanitizeText(extensionRequest?.brCode || payload?.brCode, ""),
    requestedAt: extensionRequest?.requestedAt || payload?.requestedAt || null,
    decidedAt: extensionRequest?.decidedAt || payload?.decidedAt || null,
    expiresAt: extensionRequest?.expiresAt || payload?.expiresAt || null,
    expiredAt: extensionRequest?.expiredAt || payload?.expiredAt || null,
    paidAt: extensionRequest?.paidAt || payload?.paidAt || null,
    error: sanitizeText(payload?.error || payload?.message, ""),
    message: sanitizeText(payload?.message, ""),
    ...overrides,
  });
}

function buildDriverExtensionRequest(payload = {}, overrides = {}) {
  const extensionState = buildRideExtensionState(payload, overrides);
  return cloneDefaultDriverExtensionRequest(extensionState);
}

function buildOperationalContinuationState(payload = {}, overrides = {}) {
  const interruption =
    payload?.interruption && typeof payload.interruption === "object"
      ? payload.interruption
      : payload;

  return cloneDefaultOperationalContinuation({
    bookingId: payload?.bookingId || interruption?.bookingId || null,
    status: String(
      overrides.status ||
        interruption?.status ||
        payload?.status ||
        DEFAULT_OPERATIONAL_CONTINUATION.status,
    )
      .trim()
      .toLowerCase(),
    reason: sanitizeText(interruption?.reason || payload?.reason, ""),
    note: sanitizeText(interruption?.note || payload?.note, ""),
    previousDriverId:
      sanitizeText(
        interruption?.interruptedByDriverId || payload?.previousDriverId,
        "",
      ) || null,
    pickupLocation:
      interruption?.pickupLocation || payload?.pickupLocation || null,
    estimatedRefund:
      Number(interruption?.estimatedRefund ?? payload?.estimatedRefund ?? 0) ||
      0,
    remainingReservedAmount:
      Number(
        interruption?.remainingReservedAmount ??
          payload?.remainingReservedAmount ??
          0,
      ) || 0,
    rideLegs: Array.isArray(payload?.rideLegs)
      ? payload.rideLegs
      : Array.isArray(interruption?.rideLegs)
        ? interruption.rideLegs
        : interruption?.closedRideLeg
          ? [interruption.closedRideLeg]
          : [],
    error: sanitizeText(payload?.error || payload?.message, ""),
    message: sanitizeText(payload?.message, ""),
    ...overrides,
  });
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function resolvePickupCoordinateFromRide(ride = {}, activeBooking = {}) {
  const candidates = [
    ride?.pickupCoordinate,
    activeBooking?.pickupLocation,
    activeBooking?.pickup,
    activeBooking?.origin,
  ];

  for (const candidate of candidates) {
    const latitude = Number(candidate?.latitude ?? candidate?.lat);
    const longitude = Number(candidate?.longitude ?? candidate?.lng);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  }

  return null;
}

function resolveDestinationCoordinateFromRide(
  ride = {},
  selectedDestination = null,
  activeBooking = {},
) {
  const candidates = [
    ride?.destinationCoordinate,
    selectedDestination?.coordinate,
    activeBooking?.destinationLocation,
    activeBooking?.destination,
    activeBooking?.dropoffLocation,
  ];

  for (const candidate of candidates) {
    const latitude = Number(candidate?.latitude ?? candidate?.lat);
    const longitude = Number(candidate?.longitude ?? candidate?.lng);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { latitude, longitude };
    }
  }

  return null;
}

function computeDynamicEtaMinutes(
  remainingMeters,
  baselineMeters,
  baselineEtaMinutes,
) {
  if (!Number.isFinite(remainingMeters) || remainingMeters <= 0) {
    return 0;
  }

  const baselineDistanceKm = Number(baselineMeters || 0) / 1000;
  const baselineEta = Number(baselineEtaMinutes || 0);
  const remainingKm = remainingMeters / 1000;

  if (baselineDistanceKm > 0 && baselineEta > 0) {
    const kmPerMinute = baselineDistanceKm / baselineEta;
    if (kmPerMinute > 0.01) {
      return Math.max(1, Math.round(remainingKm / kmPerMinute));
    }
  }

  return Math.max(1, Math.round(remainingKm / 0.45));
}

function normalizeRemainingDistanceKm(remainingMeters) {
  const numericMeters = Number(remainingMeters);
  if (!Number.isFinite(numericMeters) || numericMeters < 0) {
    return Number.NaN;
  }

  const remainingKm = numericMeters / 1000;
  const precision = numericMeters >= 10000 ? 0 : 1;
  return Number(remainingKm.toFixed(precision));
}

function normalizeRuntimeCoordinate(value) {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return { latitude, longitude };
}

function normalizeRuntimeRouteCoordinates(coordinates = []) {
  return Array.isArray(coordinates)
    ? coordinates.map(normalizeRuntimeCoordinate).filter(Boolean)
    : [];
}

function normalizeQuoteLockCoordinate(
  value,
  precision = QUOTE_LOCK_COORDINATE_PRECISION,
) {
  const normalized = normalizeRuntimeCoordinate(value);
  if (!normalized) {
    return null;
  }

  return {
    latitude: Number(normalized.latitude.toFixed(precision)),
    longitude: Number(normalized.longitude.toFixed(precision)),
  };
}

function buildQuoteLockRouteKey(originCoordinate, destinationCoordinate) {
  const normalizedOrigin = normalizeQuoteLockCoordinate(originCoordinate);
  const normalizedDestination = normalizeQuoteLockCoordinate(
    destinationCoordinate,
  );
  if (!normalizedOrigin || !normalizedDestination) {
    return "";
  }

  return [
    normalizedOrigin.latitude.toFixed(QUOTE_LOCK_COORDINATE_PRECISION),
    normalizedOrigin.longitude.toFixed(QUOTE_LOCK_COORDINATE_PRECISION),
    normalizedDestination.latitude.toFixed(QUOTE_LOCK_COORDINATE_PRECISION),
    normalizedDestination.longitude.toFixed(QUOTE_LOCK_COORDINATE_PRECISION),
  ].join(":");
}

function normalizeQuoteLockTimestamp(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }
  return Math.round(numericValue);
}

function normalizePersistedQuoteLock(lockInput = null) {
  if (!lockInput || typeof lockInput !== "object") {
    return null;
  }

  const routeKey = sanitizeText(lockInput.routeKey, "");
  if (!routeKey) {
    return null;
  }

  const createdAt =
    normalizeQuoteLockTimestamp(lockInput.createdAt) || Date.now();
  const fallbackExpiresAt = createdAt + QUOTE_LOCK_VALIDITY_MS;
  const expiresAt =
    normalizeQuoteLockTimestamp(lockInput.expiresAt) || fallbackExpiresAt;

  if (expiresAt <= Date.now()) {
    return null;
  }

  const distanceKm = Number(lockInput.distanceKm);
  const durationMinutes = Number(lockInput.durationMinutes);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    return null;
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return null;
  }

  return {
    routeKey,
    distanceKm: Number(distanceKm.toFixed(1)),
    durationMinutes: Math.max(1, Math.round(durationMinutes)),
    etaText:
      sanitizeText(lockInput.etaText, "") ||
      buildTripEtaText(Math.max(1, Math.round(durationMinutes))),
    createdAt,
    expiresAt,
    coordinates: normalizeRuntimeRouteCoordinates(lockInput.coordinates).slice(
      0,
      QUOTE_LOCK_MAX_ROUTE_POINTS,
    ),
  };
}

function resolveActiveQuoteLock(lockInput = null, routeKey = "") {
  const normalizedRouteKey = sanitizeText(routeKey, "");
  if (!normalizedRouteKey) {
    return null;
  }

  const normalizedLock = normalizePersistedQuoteLock(lockInput);
  if (!normalizedLock) {
    return null;
  }

  if (normalizedLock.routeKey !== normalizedRouteKey) {
    return null;
  }

  return normalizedLock;
}

function buildQuoteLockSnapshot({
  originCoordinate,
  destinationCoordinate,
  distanceKm,
  durationMinutes,
  etaText = "",
  coordinates = [],
}) {
  const routeKey = buildQuoteLockRouteKey(originCoordinate, destinationCoordinate);
  if (!routeKey) {
    return null;
  }

  const normalizedDistanceKm = Number(distanceKm);
  const normalizedDurationMinutes = Number(durationMinutes);
  if (!Number.isFinite(normalizedDistanceKm) || normalizedDistanceKm <= 0) {
    return null;
  }
  if (
    !Number.isFinite(normalizedDurationMinutes) ||
    normalizedDurationMinutes <= 0
  ) {
    return null;
  }

  const createdAt = Date.now();

  return {
    routeKey,
    distanceKm: Number(normalizedDistanceKm.toFixed(1)),
    durationMinutes: Math.max(1, Math.round(normalizedDurationMinutes)),
    etaText:
      sanitizeText(etaText, "") ||
      buildTripEtaText(Math.max(1, Math.round(normalizedDurationMinutes))),
    createdAt,
    expiresAt: createdAt + QUOTE_LOCK_VALIDITY_MS,
    coordinates: normalizeRuntimeRouteCoordinates(coordinates).slice(
      0,
      QUOTE_LOCK_MAX_ROUTE_POINTS,
    ),
  };
}

function resolveCompletedReceiptRouteCoordinates(
  routeCoordinates = [],
  pickupCoordinate = null,
  destinationCoordinate = null,
) {
  const normalizedRoute = normalizeRuntimeRouteCoordinates(routeCoordinates);
  if (normalizedRoute.length >= 2) {
    return normalizedRoute;
  }

  return [pickupCoordinate, destinationCoordinate]
    .map(normalizeRuntimeCoordinate)
    .filter(Boolean);
}

function calculateRouteDistanceKm(routeCoordinates = []) {
  const normalizedRoute = normalizeRuntimeRouteCoordinates(routeCoordinates);
  if (normalizedRoute.length < 2) {
    return null;
  }

  const distanceMeters = normalizedRoute.reduce((total, coordinate, index) => {
    if (index === 0) {
      return total;
    }

    const segmentMeters = calculateDistanceMeters(
      normalizedRoute[index - 1],
      coordinate,
    );
    return Number.isFinite(segmentMeters) ? total + segmentMeters : total;
  }, 0);

  return distanceMeters > 0 ? Number((distanceMeters / 1000).toFixed(1)) : null;
}

function buildTripEtaText(durationMinutes) {
  const numericDuration = Number(durationMinutes);
  if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    return "";
  }

  return `Chegada estimada em ${Math.max(1, Math.round(numericDuration))} min`;
}

function normalizeRouteDistanceKmValue(distanceKm) {
  const numericDistance = Number(distanceKm);
  if (!Number.isFinite(numericDistance) || numericDistance <= 0) {
    return null;
  }

  return Number(numericDistance.toFixed(1));
}

function normalizeRouteDurationMinutesValue(durationMinutes) {
  const numericDuration = Number(durationMinutes);
  if (!Number.isFinite(numericDuration) || numericDuration <= 0) {
    return null;
  }

  return Math.max(1, Math.round(numericDuration));
}

function resolveRouteLegMetrics(leg, fallbackCoordinates = []) {
  const legDistanceKm = normalizeRouteDistanceKmValue(leg?.distance_in_km);
  const legDurationMinutes = normalizeRouteDurationMinutesValue(
    Number(leg?.time_in_secs || 0) / 60,
  );
  const fallbackDistanceKm = calculateRouteDistanceKm(fallbackCoordinates);
  const resolvedDistanceKm =
    legDistanceKm ??
    (Number.isFinite(fallbackDistanceKm) && fallbackDistanceKm > 0
      ? fallbackDistanceKm
      : null);
  const resolvedDurationMinutes =
    legDurationMinutes ??
    (Number.isFinite(resolvedDistanceKm) && resolvedDistanceKm > 0
      ? Math.max(1, Math.round(resolvedDistanceKm / 0.45))
      : null);

  return {
    distanceKm: resolvedDistanceKm,
    durationMinutes: resolvedDurationMinutes,
    etaText: buildTripEtaText(resolvedDurationMinutes),
  };
}

function findNearestRouteCoordinateIndex(routeCoordinates = [], targetCoordinate) {
  if (!Array.isArray(routeCoordinates) || routeCoordinates.length === 0) {
    return -1;
  }

  const normalizedTarget = normalizeRuntimeCoordinate(targetCoordinate);
  if (!normalizedTarget) {
    return -1;
  }

  let nearestIndex = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;

  routeCoordinates.forEach((coordinate, index) => {
    const distanceMeters = calculateDistanceMeters(coordinate, normalizedTarget);
    if (!Number.isFinite(distanceMeters) || distanceMeters >= nearestDistance) {
      return;
    }

    nearestDistance = distanceMeters;
    nearestIndex = index;
  });

  return nearestIndex;
}

function buildFixedRouteCoordinates(
  routeCoordinates = [],
  startCoordinate = null,
  endCoordinate = null,
) {
  const normalizedCoordinates = normalizeRuntimeRouteCoordinates(routeCoordinates);
  const normalizedStart = normalizeRuntimeCoordinate(startCoordinate);
  const normalizedEnd = normalizeRuntimeCoordinate(endCoordinate);
  const nextCoordinates =
    normalizedCoordinates.length >= 2
      ? [...normalizedCoordinates]
      : normalizedStart && normalizedEnd
        ? buildFallbackRouteCoordinates(normalizedStart, normalizedEnd)
        : [normalizedStart, normalizedEnd].filter(Boolean);

  if (nextCoordinates.length === 0) {
    return [];
  }

  if (normalizedStart) {
    if (nextCoordinates.length === 0) {
      nextCoordinates.push(normalizedStart);
    } else {
      nextCoordinates[0] = normalizedStart;
    }
  }

  if (normalizedEnd) {
    if (nextCoordinates.length === 0) {
      nextCoordinates.push(normalizedEnd);
    } else {
      nextCoordinates[nextCoordinates.length - 1] = normalizedEnd;
    }
  }

  if (nextCoordinates.length >= 2) {
    return nextCoordinates;
  }

  return [normalizedStart, normalizedEnd].filter(Boolean);
}

function extractDriverRoutePlan(driverTripMeta = {}) {
  const routePlan =
    driverTripMeta?.routePlan && typeof driverTripMeta.routePlan === "object"
      ? driverTripMeta.routePlan
      : null;
  if (!routePlan) {
    return null;
  }

  const pickupCoordinates = normalizeRuntimeRouteCoordinates(
    routePlan.pickupCoordinates,
  );
  const destinationCoordinates = normalizeRuntimeRouteCoordinates(
    routePlan.destinationCoordinates,
  );
  const combinedCoordinates = normalizeRuntimeRouteCoordinates(
    routePlan.combinedCoordinates,
  );

  if (pickupCoordinates.length < 2 || destinationCoordinates.length < 2) {
    return null;
  }

  return {
    pickupCoordinates,
    destinationCoordinates,
    combinedCoordinates,
    pickupSteps: normalizeNavigationSteps(routePlan.pickupSteps),
    destinationSteps: normalizeNavigationSteps(routePlan.destinationSteps),
    pickupDistanceKm: normalizeRouteDistanceKmValue(routePlan.pickupDistanceKm),
    pickupDurationMinutes: normalizeRouteDurationMinutesValue(
      routePlan.pickupDurationMinutes,
    ),
    destinationDistanceKm: normalizeRouteDistanceKmValue(
      routePlan.destinationDistanceKm,
    ),
    destinationDurationMinutes: normalizeRouteDurationMinutesValue(
      routePlan.destinationDurationMinutes,
    ),
  };
}

function doesDriverRoutePlanMatch(
  driverTripMeta = {},
  pickupCoordinate = null,
  destinationCoordinate = null,
) {
  const routePlan = extractDriverRoutePlan(driverTripMeta);
  if (!routePlan) {
    return false;
  }

  const storedPickup = normalizeRuntimeCoordinate(driverTripMeta?.pickupCoordinate);
  const storedDestination = normalizeRuntimeCoordinate(
    driverTripMeta?.destinationCoordinate,
  );

  return (
    doesRouteDestinationMatchTarget(storedPickup, pickupCoordinate) &&
    doesRouteDestinationMatchTarget(storedDestination, destinationCoordinate)
  );
}

function buildRuntimeRoutePlanCacheKeys(
  bookingId = null,
  pickupCoordinate = null,
  destinationCoordinate = null,
) {
  const normalizedPickup = normalizeRuntimeCoordinate(pickupCoordinate);
  const normalizedDestination = normalizeRuntimeCoordinate(destinationCoordinate);

  if (!normalizedPickup || !normalizedDestination) {
    return [];
  }

  const cacheSuffix = [
    Math.round(normalizedPickup.latitude * 10000),
    Math.round(normalizedPickup.longitude * 10000),
    Math.round(normalizedDestination.latitude * 10000),
    Math.round(normalizedDestination.longitude * 10000),
  ].join(":");
  const normalizedBookingId = String(bookingId || "").trim();
  const keys = [`coords:${cacheSuffix}`];

  if (normalizedBookingId) {
    keys.unshift(`booking:${normalizedBookingId}:${cacheSuffix}`);
  }

  return keys;
}

function buildLiveRoutePlanInFlightKey({
  bookingId = null,
  origin = null,
  pickup = null,
  destination = null,
} = {}) {
  const normalizedBookingId = String(bookingId || "").trim();
  if (normalizedBookingId) {
    return `booking:${normalizedBookingId}`;
  }

  const normalizedOrigin = normalizeRuntimeCoordinate(origin);
  const normalizedPickup = normalizeRuntimeCoordinate(pickup);
  const normalizedDestination = normalizeRuntimeCoordinate(destination);

  if (!normalizedOrigin || !normalizedPickup || !normalizedDestination) {
    return "";
  }

  return [
    "coords",
    Math.round(normalizedOrigin.latitude * 10000),
    Math.round(normalizedOrigin.longitude * 10000),
    Math.round(normalizedPickup.latitude * 10000),
    Math.round(normalizedPickup.longitude * 10000),
    Math.round(normalizedDestination.latitude * 10000),
    Math.round(normalizedDestination.longitude * 10000),
  ].join(":");
}

function registerDirectionsRequestForBooking(bookingIdInput) {
  const bookingId = String(bookingIdInput || "").trim();
  if (!bookingId) {
    return { allowed: true, count: 0 };
  }

  const currentCount = Number(runtimeDirectionsRequestsByBooking.get(bookingId) || 0);
  if (currentCount >= MAX_DIRECTIONS_REQUESTS_PER_BOOKING) {
    return { allowed: false, count: currentCount };
  }

  const nextCount = currentCount + 1;
  runtimeDirectionsRequestsByBooking.set(bookingId, nextCount);
  return { allowed: true, count: nextCount };
}

function clearDirectionsBudgetForBooking(bookingIdInput) {
  const bookingId = String(bookingIdInput || "").trim();
  if (!bookingId) {
    return;
  }
  runtimeDirectionsRequestsByBooking.delete(bookingId);
}

function getCachedDriverRoutePlan({
  bookingId = null,
  pickupCoordinate = null,
  destinationCoordinate = null,
} = {}) {
  const cacheKeys = buildRuntimeRoutePlanCacheKeys(
    bookingId,
    pickupCoordinate,
    destinationCoordinate,
  );
  if (cacheKeys.length === 0) {
    return null;
  }

  for (const cacheKey of cacheKeys) {
    const cachedRoutePlan = runtimeRoutePlanCache.get(cacheKey);
    if (cachedRoutePlan) {
      return extractDriverRoutePlan({ routePlan: cachedRoutePlan });
    }
  }
  return null;
}

function cacheDriverRoutePlan({
  bookingId = null,
  pickupCoordinate = null,
  destinationCoordinate = null,
  routePlan = null,
} = {}) {
  const cacheKeys = buildRuntimeRoutePlanCacheKeys(
    bookingId,
    pickupCoordinate,
    destinationCoordinate,
  );
  const normalizedRoutePlan = extractDriverRoutePlan({ routePlan });
  if (cacheKeys.length === 0 || !normalizedRoutePlan) {
    return null;
  }

  cacheKeys.forEach((cacheKey) => {
    runtimeRoutePlanCache.set(cacheKey, normalizedRoutePlan);
  });
  return normalizedRoutePlan;
}

function ensurePersistedDriverRoutePlan({
  bookingId = null,
  pickupCoordinate = null,
  destinationCoordinate = null,
  routePlan = null,
  fallbackOriginCoordinate = null,
} = {}) {
  const cachedRoutePlan = cacheDriverRoutePlan({
    bookingId,
    pickupCoordinate,
    destinationCoordinate,
    routePlan,
  });
  if (cachedRoutePlan) {
    return cachedRoutePlan;
  }

  const extractedRoutePlan = extractDriverRoutePlan({ routePlan });
  if (extractedRoutePlan) {
    return (
      cacheDriverRoutePlan({
        bookingId,
        pickupCoordinate,
        destinationCoordinate,
        routePlan: extractedRoutePlan,
      }) || extractedRoutePlan
    );
  }

  if (
    fallbackOriginCoordinate &&
    pickupCoordinate &&
    destinationCoordinate &&
    Number.isFinite(fallbackOriginCoordinate.latitude) &&
    Number.isFinite(fallbackOriginCoordinate.longitude)
  ) {
    const fallbackRoutePlan = buildFallbackLiveRoutePlan({
      originCoordinate: fallbackOriginCoordinate,
      pickupCoordinate,
      destinationCoordinate,
    });
    return (
      cacheDriverRoutePlan({
        bookingId,
        pickupCoordinate,
        destinationCoordinate,
        routePlan: fallbackRoutePlan,
      }) ||
      extractDriverRoutePlan({ routePlan: fallbackRoutePlan }) ||
      fallbackRoutePlan
    );
  }

  return null;
}

function resolveDriverRoutePlan({
  bookingId = null,
  driverTripMeta = {},
  pickupCoordinate = null,
  destinationCoordinate = null,
} = {}) {
  return (
    getCachedDriverRoutePlan({
      bookingId,
      pickupCoordinate,
      destinationCoordinate,
    }) || extractDriverRoutePlan(driverTripMeta)
  );
}

function hydrateDriverTripMetaRoutePlan(
  driverTripMeta = {},
  stateSource = runtimeState,
  bookingIdOverride = null,
) {
  if (!driverTripMeta || typeof driverTripMeta !== "object") {
    return driverTripMeta;
  }

  const pickupCoordinate =
    normalizeRuntimeCoordinate(driverTripMeta?.pickupCoordinate) ||
    resolvePickupCoordinateFromRide(
      stateSource?.driverActiveRide,
      stateSource?.activeBooking,
    );
  const destinationCoordinate =
    normalizeRuntimeCoordinate(driverTripMeta?.destinationCoordinate) ||
    resolveDestinationCoordinateFromRide(
      stateSource?.driverActiveRide,
      stateSource?.selectedDestination,
      stateSource?.activeBooking,
    );
  const resolvedRoutePlan = resolveDriverRoutePlan({
    bookingId:
      bookingIdOverride ||
      stateSource?.activeBookingId ||
      stateSource?.driverActiveRide?.bookingId ||
      null,
    driverTripMeta,
    pickupCoordinate,
    destinationCoordinate,
  });

  if (
    !resolvedRoutePlan &&
    !Object.prototype.hasOwnProperty.call(driverTripMeta, "routePlan")
  ) {
    return driverTripMeta;
  }

  return {
    ...driverTripMeta,
    ...(pickupCoordinate ? { pickupCoordinate } : {}),
    ...(destinationCoordinate ? { destinationCoordinate } : {}),
    routePlan: resolvedRoutePlan || null,
  };
}

function buildLiveRoutePlanFromDirections({
  originCoordinate,
  pickupCoordinate,
  destinationCoordinate,
  route,
}) {
  const routeLegs = Array.isArray(route?.legs) ? route.legs : [];
  const combinedCoordinates = buildFixedRouteCoordinates(
    decodePolylineToCoordinates(route?.polylinePoints),
    originCoordinate,
    destinationCoordinate,
  );
  const splitIndex = findNearestRouteCoordinateIndex(
    combinedCoordinates,
    pickupCoordinate,
  );
  const pickupCoordinates = buildFixedRouteCoordinates(
    splitIndex >= 0 ? combinedCoordinates.slice(0, splitIndex + 1) : [],
    originCoordinate,
    pickupCoordinate,
  );
  const destinationCoordinates = buildFixedRouteCoordinates(
    splitIndex >= 0 ? combinedCoordinates.slice(splitIndex) : [],
    pickupCoordinate,
    destinationCoordinate,
  );
  const pickupMetrics = resolveRouteLegMetrics(route?.legs?.[0], pickupCoordinates);
  const destinationMetrics = resolveRouteLegMetrics(
    route?.legs?.[1],
    destinationCoordinates,
  );
  const pickupSteps = normalizeNavigationSteps(routeLegs[0]?.steps);
  const destinationSteps = normalizeNavigationSteps(routeLegs[1]?.steps);

  return {
    combinedCoordinates,
    pickupCoordinates,
    destinationCoordinates,
    pickupSteps,
    destinationSteps,
    pickupDistanceKm: pickupMetrics.distanceKm,
    pickupDurationMinutes: pickupMetrics.durationMinutes,
    destinationDistanceKm: destinationMetrics.distanceKm,
    destinationDurationMinutes: destinationMetrics.durationMinutes,
  };
}

function applyRoutePlanToMap({
  routePlan,
  phase = "pickup",
  pickupCoordinate = null,
  pickupAddress = "",
  destinationCoordinate = null,
  destinationLabel = "",
  destinationAddress = "",
  fallbackOrigin = null,
}) {
  const normalizedRoutePlan = extractDriverRoutePlan({ routePlan });
  if (!normalizedRoutePlan) {
    return null;
  }

  const isDestinationPhase = phase === "destination";
  const activeCoordinates = isDestinationPhase
    ? normalizedRoutePlan.destinationCoordinates
    : normalizedRoutePlan.pickupCoordinates;
  const activeDestination = isDestinationPhase
    ? destinationCoordinate
    : pickupCoordinate;
  const activeOrigin =
    activeCoordinates[0] ||
    normalizeRuntimeCoordinate(fallbackOrigin) ||
    (isDestinationPhase
      ? normalizeRuntimeCoordinate(pickupCoordinate)
      : normalizeRuntimeCoordinate(fallbackOrigin));

  if (!activeOrigin || !normalizeRuntimeCoordinate(activeDestination)) {
    return null;
  }

  setPrototypeMapRoute({
    origin: activeOrigin,
    destination: activeDestination,
    destinationLabel: isDestinationPhase ? destinationLabel || "Destino" : "Embarque",
    destinationAddress: isDestinationPhase
      ? destinationAddress || destinationLabel || "Destino"
      : pickupAddress || "Local de embarque",
    coordinates: activeCoordinates,
  });

  const distanceKm = isDestinationPhase
    ? normalizedRoutePlan.destinationDistanceKm
    : normalizedRoutePlan.pickupDistanceKm;
  const durationMinutes = isDestinationPhase
    ? normalizedRoutePlan.destinationDurationMinutes
    : normalizedRoutePlan.pickupDurationMinutes;
  const fallbackOriginCoordinate = normalizeRuntimeCoordinate(fallbackOrigin);
  const baselineMeters = Number.isFinite(Number(distanceKm))
    ? Math.round(Number(distanceKm) * 1000)
    : Math.round(
        Number(calculateRouteDistanceKm(activeCoordinates) || 0) * 1000,
      );
  const liveProgress =
    fallbackOriginCoordinate && normalizeRuntimeCoordinate(activeDestination)
      ? resolveRouteProgressMetrics({
          currentCoordinate: fallbackOriginCoordinate,
          targetCoordinate: activeDestination,
          baselineMeters,
          baselineEtaMinutes: durationMinutes,
        })
      : null;
  const resolvedDistanceKm =
    Number.isFinite(Number(liveProgress?.distanceKm)) &&
    Number(liveProgress.distanceKm) >= 0
      ? Number(liveProgress.distanceKm)
      : distanceKm;
  const resolvedDurationMinutes =
    Number.isFinite(Number(liveProgress?.etaMinutes)) &&
    Number(liveProgress.etaMinutes) >= 0
      ? Number(liveProgress.etaMinutes)
      : durationMinutes;

  return {
    distanceKm: resolvedDistanceKm,
    durationMinutes: resolvedDurationMinutes,
    etaText: buildTripEtaText(resolvedDurationMinutes),
  };
}

function buildFallbackNavigationSteps({
  coordinates = [],
  instruction = "Siga em frente",
  durationMinutes = null,
} = {}) {
  const normalizedCoordinates = normalizeRuntimeRouteCoordinates(coordinates);
  if (normalizedCoordinates.length < 2) {
    return [];
  }

  const startLocation = normalizedCoordinates[0];
  const endLocation = normalizedCoordinates[normalizedCoordinates.length - 1];
  const distanceMeters = Math.round(calculateDistanceMeters(startLocation, endLocation));
  const durationSeconds =
    Number.isFinite(Number(durationMinutes)) && Number(durationMinutes) > 0
      ? Math.round(Number(durationMinutes) * 60)
      : 0;

  return normalizeNavigationSteps([
    {
      instruction,
      startLocation,
      endLocation,
      distanceMeters,
      durationSeconds,
      polylinePoints: null,
    },
  ]);
}

function syncPassengerActiveRoutePlan({
  routePlan,
  phase = "pickup",
  pickupCoordinate = null,
  pickupAddress = "",
  destinationCoordinate = null,
  destinationLabel = "",
  destinationAddress = "",
  liveDriverCoordinate = null,
} = {}) {
  const activeMetrics = applyRoutePlanToMap({
    routePlan,
    phase,
    pickupCoordinate,
    pickupAddress,
    destinationCoordinate,
    destinationLabel,
    destinationAddress,
    fallbackOrigin: liveDriverCoordinate,
  });
  const normalizedRoutePlan = extractDriverRoutePlan({ routePlan });
  if (!normalizedRoutePlan) {
    return null;
  }

  const metrics =
    activeMetrics ||
    (phase === "destination"
      ? {
          distanceKm: normalizedRoutePlan.destinationDistanceKm,
          durationMinutes: normalizedRoutePlan.destinationDurationMinutes,
          etaText: buildTripEtaText(normalizedRoutePlan.destinationDurationMinutes),
        }
      : {
          distanceKm: normalizedRoutePlan.pickupDistanceKm,
          durationMinutes: normalizedRoutePlan.pickupDurationMinutes,
          etaText: buildTripEtaText(normalizedRoutePlan.pickupDurationMinutes),
        });

  setRuntimeState((previous) => {
    const nextDistanceKm = Number(metrics?.distanceKm);
    const nextDurationMinutes = Number(metrics?.durationMinutes);
    const normalizedPhase = phase === "destination" ? "destination" : "pickup";
    const previousPhase = String(previous.driverTripMeta?.leg || "")
      .trim()
      .toLowerCase();
    const shouldResetPhaseBaseline =
      normalizedPhase === "pickup" &&
      (previousPhase !== "pickup" ||
        !Number.isFinite(Number(previous.driverTripMeta?.initialMeters)) ||
        Number(previous.driverTripMeta?.initialMeters) <= 0 ||
        !Number.isFinite(Number(previous.driverTripMeta?.initialEtaMinutes)) ||
        Number(previous.driverTripMeta?.initialEtaMinutes) <= 0);

    return {
      tripDistanceKm:
        Number.isFinite(nextDistanceKm) && nextDistanceKm > 0
          ? nextDistanceKm
          : previous.tripDistanceKm,
      tripDurationMin:
        Number.isFinite(nextDurationMinutes) && nextDurationMinutes > 0
          ? Math.max(1, Math.round(nextDurationMinutes))
          : previous.tripDurationMin,
      tripArrivalText: metrics?.etaText || previous.tripArrivalText,
      driverActiveRide:
        previous.driverActiveRide &&
        typeof previous.driverActiveRide === "object"
          ? {
              ...previous.driverActiveRide,
              ...(Number.isFinite(nextDistanceKm) && nextDistanceKm >= 0
                ? { distanceKm: nextDistanceKm }
                : {}),
              ...(Number.isFinite(nextDurationMinutes) && nextDurationMinutes >= 0
                ? {
                    etaMinutes: Math.max(0, Math.round(nextDurationMinutes)),
                    durationMin: Math.max(0, Math.round(nextDurationMinutes)),
                  }
                : {}),
            }
          : previous.driverActiveRide,
      driverTripMeta: {
        ...(previous.driverTripMeta || {}),
        leg: normalizedPhase,
        pickupAddress:
          pickupAddress ||
          previous.driverTripMeta?.pickupAddress ||
          "Local de embarque",
        destinationAddress:
          destinationAddress ||
          destinationLabel ||
          previous.driverTripMeta?.destinationAddress ||
          "Destino",
        pickupCoordinate,
        destinationCoordinate,
        ...(shouldResetPhaseBaseline
          ? {
              initialMeters:
                Number.isFinite(nextDistanceKm) && nextDistanceKm > 0
                  ? Math.round(nextDistanceKm * 1000)
                  : previous.driverTripMeta?.initialMeters,
              initialEtaMinutes:
                Number.isFinite(nextDurationMinutes) && nextDurationMinutes > 0
                  ? Math.max(1, Math.round(nextDurationMinutes))
                  : previous.driverTripMeta?.initialEtaMinutes,
            }
          : {}),
        routePlan: normalizedRoutePlan,
      },
    };
  });

  return {
    routePlan: normalizedRoutePlan,
    metrics,
  };
}

function resolveCompletedTripDistanceKm({
  payloadDistance,
  runtimeDistance,
  routeCoordinates = [],
  pickupCoordinate = null,
  destinationCoordinate = null,
  initialMeters = null,
}) {
  const explicitDistance = Number(payloadDistance);
  if (Number.isFinite(explicitDistance) && explicitDistance > 0) {
    return Number(explicitDistance.toFixed(1));
  }

  const routeDistanceKm = calculateRouteDistanceKm(routeCoordinates);
  if (Number.isFinite(routeDistanceKm) && routeDistanceKm > 0) {
    return routeDistanceKm;
  }

  const currentRuntimeDistance = Number(runtimeDistance);
  if (Number.isFinite(currentRuntimeDistance) && currentRuntimeDistance > 0) {
    return Number(currentRuntimeDistance.toFixed(1));
  }

  const initialDistanceKm = Number(initialMeters) / 1000;
  if (Number.isFinite(initialDistanceKm) && initialDistanceKm > 0) {
    return Number(initialDistanceKm.toFixed(1));
  }

  const directMeters = calculateDistanceMeters(
    normalizeRuntimeCoordinate(pickupCoordinate),
    normalizeRuntimeCoordinate(destinationCoordinate),
  );
  if (Number.isFinite(directMeters) && directMeters > 0) {
    return Number((directMeters / 1000).toFixed(1));
  }

  return 0;
}

function resolveCompletedTripDurationMin({
  payloadDurationSeconds,
  runtimeDurationMinutes,
  routeDurationMinutes,
  distanceKm,
}) {
  const durationSeconds = Number(payloadDurationSeconds);
  const runtimeDuration = Number(runtimeDurationMinutes);
  const routeDuration = Number(routeDurationMinutes);
  const resolvedRuntimeDuration =
    Number.isFinite(runtimeDuration) && runtimeDuration > 0
      ? Math.max(1, Math.round(runtimeDuration))
      : 0;
  const resolvedRouteDuration =
    Number.isFinite(routeDuration) && routeDuration > 0
      ? Math.max(1, Math.round(routeDuration))
      : 0;
  const knownLongRouteDuration = Math.max(
    resolvedRuntimeDuration,
    resolvedRouteDuration,
  );
  const distance = Number(distanceKm);

  if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
    const resolvedPayloadDuration = Math.max(1, Math.round(durationSeconds / 60));
    if (
      knownLongRouteDuration >= 10 &&
      resolvedPayloadDuration <= 2 &&
      Number.isFinite(distance) &&
      distance >= 5
    ) {
      return knownLongRouteDuration;
    }
    return resolvedPayloadDuration;
  }

  if (resolvedRuntimeDuration > 0) {
    return resolvedRuntimeDuration;
  }

  if (resolvedRouteDuration > 0) {
    return resolvedRouteDuration;
  }

  if (Number.isFinite(distance) && distance > 0) {
    return Math.max(1, Math.round(distance));
  }

  return 0;
}

function doesRouteDestinationMatchTarget(routeDestination, targetCoordinate) {
  if (!routeDestination || !targetCoordinate) {
    return false;
  }

  const distanceToTarget = calculateDistanceMeters(routeDestination, targetCoordinate);
  return Number.isFinite(distanceToTarget) && distanceToTarget <= 80;
}

function projectCoordinateOntoSegment(coordinate, start, end) {
  if (!coordinate || !start || !end) {
    return null;
  }

  const averageLatitudeRad =
    (((start.latitude + end.latitude + coordinate.latitude) / 3) * Math.PI) / 180;
  const longitudeScale = Math.cos(averageLatitudeRad) || 1;

  const startX = Number(start.longitude) * longitudeScale;
  const startY = Number(start.latitude);
  const endX = Number(end.longitude) * longitudeScale;
  const endY = Number(end.latitude);
  const pointX = Number(coordinate.longitude) * longitudeScale;
  const pointY = Number(coordinate.latitude);

  const deltaX = endX - startX;
  const deltaY = endY - startY;
  const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (segmentLengthSquared <= 0) {
    return null;
  }

  const rawRatio =
    ((pointX - startX) * deltaX + (pointY - startY) * deltaY) /
    segmentLengthSquared;
  const ratio = clamp(rawRatio, 0, 1);
  const projectedX = startX + deltaX * ratio;
  const projectedY = startY + deltaY * ratio;
  const projectedCoordinate = {
    latitude: projectedY,
    longitude: projectedX / longitudeScale,
  };

  return {
    ratio,
    projectedCoordinate,
    squaredDistance:
      (pointX - projectedX) * (pointX - projectedX) +
      (pointY - projectedY) * (pointY - projectedY),
  };
}

function calculateRemainingMetersAlongRoute(currentCoordinate, routeCoordinates = []) {
  if (
    !currentCoordinate ||
    !Array.isArray(routeCoordinates) ||
    routeCoordinates.length < 2
  ) {
    return null;
  }

  let bestMatch = null;

  for (let index = 0; index < routeCoordinates.length - 1; index += 1) {
    const start = routeCoordinates[index];
    const end = routeCoordinates[index + 1];
    const projection = projectCoordinateOntoSegment(currentCoordinate, start, end);

    if (!projection) {
      continue;
    }

    if (
      !bestMatch ||
      projection.squaredDistance < bestMatch.squaredDistance
    ) {
      bestMatch = {
        ...projection,
        segmentIndex: index,
      };
    }
  }

  if (!bestMatch?.projectedCoordinate) {
    return null;
  }

  let remainingMeters = calculateDistanceMeters(
    bestMatch.projectedCoordinate,
    routeCoordinates[bestMatch.segmentIndex + 1],
  );

  for (
    let index = bestMatch.segmentIndex + 1;
    index < routeCoordinates.length - 1;
    index += 1
  ) {
    remainingMeters += calculateDistanceMeters(
      routeCoordinates[index],
      routeCoordinates[index + 1],
    );
  }

  return Number.isFinite(remainingMeters)
    ? Math.max(0, remainingMeters)
    : null;
}

function resolveRouteProgressMetrics({
  currentCoordinate,
  targetCoordinate,
  baselineMeters,
  baselineEtaMinutes,
}) {
  const routeSnapshot = getPrototypeMapRoute();
  const routeCoordinates = Array.isArray(routeSnapshot?.coordinates)
    ? routeSnapshot.coordinates
    : [];
  const canUseRoutePath =
    routeCoordinates.length >= 2 &&
    doesRouteDestinationMatchTarget(routeSnapshot?.destination, targetCoordinate);
  const routeRemainingMeters = canUseRoutePath
    ? calculateRemainingMetersAlongRoute(currentCoordinate, routeCoordinates)
    : null;
  const linearRemainingMeters = calculateDistanceMeters(
    currentCoordinate,
    targetCoordinate,
  );
  const remainingMeters = Number.isFinite(routeRemainingMeters)
    ? routeRemainingMeters
    : linearRemainingMeters;
  const etaMinutes = computeDynamicEtaMinutes(
    remainingMeters,
    baselineMeters,
    baselineEtaMinutes,
  );

  return {
    remainingMeters,
    distanceKm: normalizeRemainingDistanceKm(remainingMeters),
    etaMinutes,
    usesRoutePath: Number.isFinite(routeRemainingMeters),
  };
}

function buildLiveTripProgressModel(snapshot, role) {
  const activeRide =
    snapshot?.driverActiveRide && typeof snapshot.driverActiveRide === "object"
      ? snapshot.driverActiveRide
      : {};
  const activeBooking =
    snapshot?.activeBooking && typeof snapshot.activeBooking === "object"
      ? snapshot.activeBooking
      : {};
  const normalizedStatus = String(
    snapshot?.bookingStatus || activeRide?.status || "",
  )
    .trim()
    .toLowerCase();

  if (!["accepted", "started"].includes(normalizedStatus)) {
    return null;
  }

  const pickupCoordinate = resolvePickupCoordinateFromRide(
    activeRide,
    activeBooking,
  );
  const destinationCoordinate = resolveDestinationCoordinateFromRide(
    activeRide,
    snapshot?.selectedDestination,
    activeBooking,
  );
  const targetCoordinate =
    normalizedStatus === "started" ? destinationCoordinate : pickupCoordinate;
  const movingCoordinate =
    role === "driver"
      ? snapshot?.currentCoordinate || snapshot?.driverCoordinate || null
      : snapshot?.driverCoordinate || null;

  const baselineMeters = Number(
    snapshot?.driverTripMeta?.initialMeters ||
      (Number.isFinite(Number(snapshot?.tripDistanceKm))
        ? Math.round(Number(snapshot.tripDistanceKm) * 1000)
        : 0),
  );
  const baselineEtaMinutes = Number(
    snapshot?.driverTripMeta?.initialEtaMinutes ||
      snapshot?.tripDurationMin ||
      0,
  );
  const routeProgress = resolveRouteProgressMetrics({
    currentCoordinate: movingCoordinate,
    targetCoordinate,
    baselineMeters,
    baselineEtaMinutes,
  });
  const remainingMeters = routeProgress.remainingMeters;
  if (!Number.isFinite(remainingMeters) || remainingMeters < 0) {
    return null;
  }

  return {
    status: normalizedStatus,
    targetCoordinate,
    movingCoordinate,
    remainingMeters,
    distanceKm: routeProgress.distanceKm,
    etaMinutes: routeProgress.etaMinutes,
    arrivalText:
      routeProgress.etaMinutes > 0
        ? `Chegada estimada em ${routeProgress.etaMinutes} min`
        : "",
  };
}

function formatRuntimeNavigationDistanceLabel(distanceMeters) {
  if (
    distanceMeters === null ||
    distanceMeters === undefined ||
    distanceMeters === ""
  ) {
    return "--";
  }

  const numeric = Number(distanceMeters);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return "--";
  }

  if (numeric < 1000) {
    const roundedMeters =
      numeric <= 0 ? 0 : Math.max(10, Math.round(numeric / 10) * 10);
    return `${roundedMeters} m`;
  }

  return `${Math.max(1, Math.round(numeric / 1000))} km`;
}

function formatRuntimeEtaLabel(durationMinutes) {
  const numeric = Number(durationMinutes);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return "--";
  }

  return `${Math.max(1, Math.round(numeric))} min`;
}

function resolveQaLockedNavigationCoordinate({
  rawCoordinate,
  targetCoordinate,
  routeStartCoordinate,
  routeCoordinates = [],
}) {
  const normalizedRawCoordinate = normalizeRuntimeCoordinate(rawCoordinate);

  if (!isRuntimeQALockActive()) {
    return normalizedRawCoordinate;
  }

  const normalizedTargetCoordinate = normalizeRuntimeCoordinate(targetCoordinate);
  const normalizedRouteStartCoordinate =
    normalizeRuntimeCoordinate(routeStartCoordinate);

  if (!normalizedTargetCoordinate || !normalizedRouteStartCoordinate) {
    return normalizedRawCoordinate || normalizedRouteStartCoordinate || null;
  }

  if (!normalizedRawCoordinate) {
    return normalizedRouteStartCoordinate;
  }

  const rawDistanceMeters = calculateDistanceMeters(
    normalizedRawCoordinate,
    normalizedTargetCoordinate,
  );
  const seededDistanceMeters = calculateDistanceMeters(
    normalizedRouteStartCoordinate,
    normalizedTargetCoordinate,
  );
  const rawDistanceToRouteMeters = calculateDistanceToRouteMeters(
    normalizedRawCoordinate,
    routeCoordinates,
  );

  if (
    Number.isFinite(rawDistanceMeters) &&
    Number.isFinite(seededDistanceMeters) &&
    (rawDistanceMeters > 20000 ||
      (Number.isFinite(rawDistanceToRouteMeters) &&
        rawDistanceToRouteMeters > 1000)) &&
    seededDistanceMeters < 10000
  ) {
    return normalizedRouteStartCoordinate;
  }

  return normalizedRawCoordinate;
}

function buildDriverTripAssistModel(snapshot) {
  const activeRide =
    snapshot?.driverActiveRide && typeof snapshot.driverActiveRide === "object"
      ? snapshot.driverActiveRide
      : {};
  const activeBooking =
    snapshot?.activeBooking && typeof snapshot.activeBooking === "object"
      ? snapshot.activeBooking
      : {};
  const status = String(snapshot?.bookingStatus || activeRide?.status || "")
    .trim()
    .toLowerCase();

  if (!["accepted", "arrived", "started"].includes(status)) {
    return null;
  }

  const pickupCoordinate = resolvePickupCoordinateFromRide(
    activeRide,
    activeBooking,
  );
  const destinationCoordinate = resolveDestinationCoordinateFromRide(
    activeRide,
    snapshot?.selectedDestination,
    activeBooking,
  );
  const targetCoordinate =
    status === "started" ? destinationCoordinate : pickupCoordinate;
  const rawCurrentCoordinate =
    snapshot?.driverCoordinate || snapshot?.currentCoordinate || null;
  const baselineMeters = Number(snapshot?.driverTripMeta?.initialMeters || 0);
  const baselineEtaMinutes = Number(
    snapshot?.driverTripMeta?.initialEtaMinutes || 0,
  );
  const navigationPhase = status === "started" ? "destination" : "pickup";
  const routePlan = resolveDriverRoutePlan({
    bookingId: snapshot?.activeBookingId || activeRide?.bookingId || null,
    driverTripMeta: snapshot?.driverTripMeta,
    pickupCoordinate,
    destinationCoordinate,
  });
  const nativeRouteCoordinates =
    navigationPhase === "destination"
      ? routePlan?.destinationCoordinates
      : routePlan?.pickupCoordinates;
  const nativeRouteSteps =
    navigationPhase === "destination"
      ? routePlan?.destinationSteps
      : routePlan?.pickupSteps;
  const currentCoordinate = resolveQaLockedNavigationCoordinate({
    rawCoordinate: rawCurrentCoordinate,
    targetCoordinate,
    routeStartCoordinate: Array.isArray(nativeRouteCoordinates)
      ? nativeRouteCoordinates[0]
      : null,
    routeCoordinates: nativeRouteCoordinates,
  });
  const nativeRouteDistanceKm =
    navigationPhase === "destination"
      ? routePlan?.destinationDistanceKm
      : routePlan?.pickupDistanceKm;
  const nativeRouteDurationMinutes =
    navigationPhase === "destination"
      ? routePlan?.destinationDurationMinutes
      : routePlan?.pickupDurationMinutes;
  const routeProgress = resolveRouteProgressMetrics({
    currentCoordinate,
    targetCoordinate,
    baselineMeters,
    baselineEtaMinutes,
  });
  const remainingMeters = routeProgress.remainingMeters;
  const progressRatio =
    Number.isFinite(remainingMeters) && baselineMeters > 0
      ? clamp(1 - remainingMeters / baselineMeters, 0, 1)
      : status === "arrived"
        ? 1
        : 0;
  const etaMinutes =
    status === "arrived"
      ? 0
      : routeProgress.etaMinutes;
  const pickupAddress = sanitizeText(
    activeRide?.pickup ||
      activeRide?.pickupAddress ||
      snapshot?.driverTripMeta?.pickupAddress ||
      activeBooking?.pickupLocation?.add,
    "Local de embarque",
  );
  const destinationAddress = sanitizeText(
    activeRide?.dropoffAddress ||
      activeRide?.dropoff ||
      snapshot?.driverTripMeta?.destinationAddress ||
      snapshot?.selectedDestination?.address ||
      activeBooking?.destinationLocation?.add,
    "Destino",
  );
  const proximityReached =
    status === "accepted" && Number.isFinite(remainingMeters)
      ? remainingMeters <= PICKUP_TOLERANCE_METERS
      : false;
  const remainingDistanceLabel = formatRuntimeNavigationDistanceLabel(
    remainingMeters,
  );
  const etaLabel =
    status === "arrived"
      ? `${Math.floor(Number(snapshot?.boardingRemainingSec || 0) / 60)}:${String(Number(snapshot?.boardingRemainingSec || 0) % 60).padStart(2, "0")}`
      : etaMinutes > 0
        ? formatRuntimeEtaLabel(etaMinutes)
        : "--";
  const nativeNavigation = buildLeafNativeNavigationState({
    bookingId: snapshot?.activeBookingId || activeRide?.bookingId || "",
    phase: navigationPhase,
    status,
    currentCoordinate,
    targetCoordinate,
    routeCoordinates: nativeRouteCoordinates,
    steps: nativeRouteSteps,
    remainingDistanceMeters: remainingMeters,
    totalDistanceMeters:
      Number.isFinite(Number(nativeRouteDistanceKm)) && Number(nativeRouteDistanceKm) > 0
        ? Math.round(Number(nativeRouteDistanceKm) * 1000)
        : baselineMeters,
    totalDurationMinutes:
      Number.isFinite(Number(nativeRouteDurationMinutes)) && Number(nativeRouteDurationMinutes) > 0
        ? Number(nativeRouteDurationMinutes)
        : baselineEtaMinutes,
    currentSpeedMetersPerSecond: Number(currentCoordinate?.speed),
  });

  return {
    status,
    pickupCoordinate,
    destinationCoordinate,
    targetCoordinate,
    pickupAddress,
    destinationAddress,
    remainingMeters,
    remainingDistanceLabel,
    progressRatio,
    etaMinutes,
    etaLabel,
    proximityReached,
    primaryActionLabel:
      status === "accepted"
        ? proximityReached
          ? "Cheguei ao embarque"
          : "Aproxime-se do embarque"
        : status === "arrived"
          ? "Iniciar corrida"
          : "Encerrar corrida",
    primaryActionEnabled: status === "accepted" ? proximityReached : true,
    title:
      status === "accepted"
        ? "A caminho do embarque"
        : status === "arrived"
          ? "Passageiro em embarque"
          : "Viagem em andamento",
    subtitle:
      status === "accepted"
        ? "Confirme quando chegar ao ponto de embarque."
        : status === "arrived"
          ? "O passageiro foi avisado e tem 2 minutos para embarcar."
          : "Encerre a corrida ao desembarque do passageiro.",
    navigationPhase,
    nativeNavigation,
    usesRoutePath: routeProgress.usesRoutePath,
  };
}

function resolveReceiptParticipants(payload = {}, previousState = runtimeState) {
  const payloadDriver =
    payload?.driver && typeof payload.driver === "object" ? payload.driver : {};
  const payloadPassenger =
    payload?.passenger && typeof payload.passenger === "object"
      ? payload.passenger
      : payload?.customer && typeof payload.customer === "object"
      ? payload.customer
      : {};
  const activeBooking =
    previousState?.activeBooking && typeof previousState.activeBooking === "object"
      ? previousState.activeBooking
      : {};
  const activeRide =
    previousState?.driverActiveRide &&
    typeof previousState.driverActiveRide === "object"
      ? previousState.driverActiveRide
      : {};
  const previousReceipt =
    previousState?.lastReceipt && typeof previousState.lastReceipt === "object"
      ? previousState.lastReceipt
      : {};

  return {
    driverId: sanitizeText(
      payloadDriver?.id ||
        payload?.driverId ||
        activeBooking?.driverId ||
        activeBooking?.driver?.id ||
        previousReceipt?.driverId ||
        previousState?.driverInfo?.id,
      "",
    ),
    driverName: sanitizeText(
      payloadDriver?.name ||
        payload?.driverName ||
        activeBooking?.driverName ||
        activeBooking?.driver?.name ||
        previousReceipt?.driverName ||
        previousState?.driverInfo?.name,
      "",
    ),
    passengerId: sanitizeText(
      payloadPassenger?.id ||
        payload?.customerId ||
        payload?.passengerId ||
        activeRide?.passengerId ||
        activeBooking?.customerId ||
        activeBooking?.customer?.id ||
        activeBooking?.passengerId ||
        previousReceipt?.passengerId ||
        resolvePassengerIdFromBookingId(
          payload?.bookingId ||
            activeRide?.bookingId ||
            activeBooking?.bookingId ||
            activeBooking?.id ||
            previousReceipt?.id,
        ),
      "",
    ),
    passengerName: resolveReceiptPassengerName(
      payloadPassenger?.name ||
        payload?.passengerName ||
        payload?.customerName ||
        activeRide?.passenger ||
        activeBooking?.customerName ||
        activeBooking?.customer?.name ||
        activeBooking?.passengerName ||
        previousReceipt?.passengerName,
      previousState,
    ),
  };
}

function extractPayloadFeeBreakdown(payload = {}, { estimated = false } = {}) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const operationalKey = estimated
    ? "estimatedOperationalFee"
    : "operationalFee";
  const intermediationKey = estimated
    ? "estimatedPaymentIntermediationFee"
    : "paymentIntermediationFee";
  const totalKey = estimated ? "estimatedTotalFees" : "totalFees";
  const netKey = estimated ? "estimatedDriverNetAmount" : "driverNetAmount";
  const tollKey = estimated ? "estimatedTollFee" : "tollFee";

  const operationalFee = pickPreferredRuntimeMoney(
    payload?.[operationalKey],
    payload?.fareBreakdown?.[operationalKey],
    payload?.paymentBreakdown?.[operationalKey],
    payload?.financialBreakdown?.[operationalKey],
  );
  const paymentIntermediationFee = pickPreferredRuntimeMoney(
    payload?.[intermediationKey],
    payload?.fareBreakdown?.[intermediationKey],
    payload?.paymentBreakdown?.[intermediationKey],
    payload?.financialBreakdown?.[intermediationKey],
  );
  const totalFees = pickPreferredRuntimeMoney(
    payload?.[totalKey],
    payload?.retainedFeesInReais,
    payload?.retainedFees,
    payload?.fareBreakdown?.[totalKey],
    payload?.paymentBreakdown?.[totalKey],
    payload?.paymentBreakdown?.retainedFeesInReais,
    payload?.paymentDistribution?.retainedFeesInReais,
    payload?.financialBreakdown?.retainedFees,
  );
  const driverNetAmount = pickPreferredRuntimeMoney(
    payload?.[netKey],
    payload?.netAmount,
    payload?.netAmountInReais,
    payload?.driver_share,
    payload?.fareBreakdown?.[netKey],
    payload?.fareBreakdown?.driverNetAmount,
    payload?.paymentBreakdown?.[netKey],
    payload?.paymentBreakdown?.driverNetAmount,
    payload?.paymentDistribution?.netAmountInReais,
    payload?.financialBreakdown?.netAmount,
  );
  const tollFee = pickPreferredRuntimeMoney(
    payload?.[tollKey],
    payload?.fareBreakdown?.[tollKey],
    payload?.fareBreakdown?.tollFee,
    payload?.paymentBreakdown?.[tollKey],
    payload?.paymentBreakdown?.tollFee,
    payload?.financialBreakdown?.[tollKey],
    payload?.financialBreakdown?.tollFee,
  );

  const hasOperational = operationalFee !== null;
  const hasIntermediation = paymentIntermediationFee !== null;
  const hasTotal = totalFees !== null;
  const hasNet = driverNetAmount !== null;
  const hasToll = tollFee !== null;

  if (!hasOperational && !hasIntermediation && !hasTotal && !hasNet && !hasToll) {
    return null;
  }

  return {
    ...(hasToll ? { tollFee: tollFee } : {}),
    ...(hasOperational ? { operationalFee: operationalFee } : {}),
    ...(hasIntermediation
      ? { paymentIntermediationFee: paymentIntermediationFee }
      : {}),
    ...(hasTotal ? { totalFees: totalFees } : {}),
    ...(hasNet ? { driverNetAmount: driverNetAmount } : {}),
  };
}

function extractPricingSnapshotMetadata(payload = {}) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const locked =
    payload?.pricingSnapshotLocked === true ||
    String(payload?.pricingSnapshotLocked || "")
      .trim()
      .toLowerCase() === "true";

  if (!locked) {
    return null;
  }

  const lockedAt = String(payload?.pricingSnapshotLockedAt || "").trim();
  return {
    pricingSnapshotLocked: true,
    ...(lockedAt ? { pricingSnapshotLockedAt: lockedAt } : {}),
  };
}

function mergeLockedDriverRideSnapshot(...sources) {
  return sources.reduce((merged, source) => {
    if (!source || typeof source !== "object") {
      return merged;
    }
    return mergeDriverOfferEntryWithLockedPricing(merged, source);
  }, {});
}

export function resolveDriverPayoutAmount(...sources) {
  const normalizedSources = sources.filter(
    (source) => source && typeof source === "object",
  );

  for (const source of normalizedSources) {
    const netAmount = getDriverOfferNetAmount(source);
    if (Number.isFinite(netAmount) && netAmount > 0) {
      return netAmount;
    }
  }

  for (const source of [...normalizedSources].reverse()) {
    const fallbackFare = toFiniteRuntimeMoney(
      source?.fare ??
        source?.grossFare ??
        source?.grossAmount ??
        source?.totalAmount ??
        source?.finalFare ??
        source?.finalPrice ??
        source?.amount,
    );
    if (fallbackFare !== null && fallbackFare > 0) {
      return fallbackFare;
    }
  }

  return 0;
}

function resolveDriverExplicitPayoutAmount(...sources) {
  const normalizedSources = sources.filter(
    (source) => source && typeof source === "object",
  );

  for (const source of normalizedSources) {
    const netAmount = getDriverOfferNetAmount(source);
    if (Number.isFinite(netAmount) && netAmount > 0) {
      return netAmount;
    }
  }

  return null;
}

function resolveCompletedTripGrossAmount(source = {}) {
  if (!source || typeof source !== "object") {
    return null;
  }

  const candidates = [
    source?.grossAmount,
    source?.grossFare,
    source?.totalAmount,
    source?.totalFare,
    source?.paymentAmount,
    source?.chargedAmount,
    source?.amountPaid,
    source?.customerPaid,
    source?.customer_paid,
    source?.amount,
    source?.finalFare,
    source?.finalPrice,
    source?.fare,
    source?.estimate,
    source?.estimatedFare,
  ];

  for (const candidate of candidates) {
    const numeric = toFiniteRuntimeMoney(candidate);
    if (numeric !== null) {
      return roundCurrencyValue(Math.max(0, numeric));
    }
  }

  return null;
}

function resolveConfirmedPaymentGrossAmount(previousState = runtimeState) {
  const paymentState = previousState?.paymentState;
  if (!paymentState || typeof paymentState !== "object") {
    return null;
  }

  const paymentAmount = resolveCompletedTripGrossAmount(paymentState);
  if (paymentAmount === null || paymentAmount <= 0) {
    return null;
  }

  const status = String(paymentState?.status || "").trim().toLowerCase();
  const hasConfirmedStatus =
    status.includes("confirmed") ||
    status.includes("paid") ||
    status.includes("settled") ||
    status.includes("completed") ||
    status.includes("approved");
  const hasPaymentId = Boolean(paymentState?.paymentId || paymentState?.chargeId);
  const isRejectedState =
    status.includes("idle") ||
    status.includes("error") ||
    status.includes("failed") ||
    status.includes("refunded") ||
    status.includes("cancel");

  if (hasConfirmedStatus || (hasPaymentId && !isRejectedState)) {
    return paymentAmount;
  }

  return null;
}

export function resolveCompletedTripFinancialSnapshot(
  payload = {},
  previousState = runtimeState,
) {
  const lockedRideSnapshot = mergeLockedDriverRideSnapshot(
    previousState?.lastReceipt,
    previousState?.driverActiveRide,
    previousState?.activeBooking,
    payload,
  );
  const payloadFinalFare = resolveCompletedTripGrossAmount(payload);
  const previousReceiptFinalFare = resolveCompletedTripGrossAmount(
    previousState?.lastReceipt,
  );
  const activeRideFinalFare = resolveCompletedTripGrossAmount(
    previousState?.driverActiveRide,
  );
  const activeBookingFinalFare = resolveCompletedTripGrossAmount(
    previousState?.activeBooking,
  );
  const lockedSnapshotFinalFare = resolveCompletedTripGrossAmount(
    lockedRideSnapshot,
  );
  const confirmedPaymentFinalFare = resolveConfirmedPaymentGrossAmount(
    previousState,
  );
  const lockedCurrentFinalFare =
    [
      confirmedPaymentFinalFare,
      activeRideFinalFare,
      activeBookingFinalFare,
      lockedSnapshotFinalFare,
    ].find((value) => value !== null && value > 0) ?? null;
  const fallbackCompletedFinalFare =
    [
      lockedCurrentFinalFare,
      previousReceiptFinalFare,
      activeRideFinalFare,
      activeBookingFinalFare,
      lockedSnapshotFinalFare,
    ].find((value) => value !== null && value > 0) ??
    [
      lockedCurrentFinalFare,
      previousReceiptFinalFare,
      activeRideFinalFare,
      activeBookingFinalFare,
      lockedSnapshotFinalFare,
    ].find((value) => value !== null) ??
    null;
  const finalFare =
    lockedCurrentFinalFare !== null && lockedCurrentFinalFare > 0
      ? lockedCurrentFinalFare
      : payload?.authoritativeSnapshot === true && payloadFinalFare !== null
      ? payloadFinalFare
      : payloadFinalFare !== null && payloadFinalFare > 0
        ? payloadFinalFare
        : fallbackCompletedFinalFare !== null
          ? fallbackCompletedFinalFare
          : roundCurrencyValue(
              previousState?.selectedFare ??
                previousState?.activeBooking?.estimatedFare ??
                0,
            );
  const payloadFeeBreakdown = extractBestPayloadFeeBreakdown(payload);
  const lockedFeeBreakdown = extractBestPayloadFeeBreakdown(lockedRideSnapshot);
  const payoutFallback = resolveDriverExplicitPayoutAmount(
    previousState?.lastReceipt,
    lockedRideSnapshot,
    previousState?.driverTripMeta,
  );
  const lockedDriverNetAmount = toFiniteRuntimeMoney(
    lockedFeeBreakdown?.driverNetAmount,
  );
  const meaningfulLockedDriverNetAmount =
    lockedDriverNetAmount === 0 && finalFare > 0
      ? null
      : lockedDriverNetAmount;
  const lockedOperationalFee = toFiniteRuntimeMoney(
    lockedFeeBreakdown?.operationalFee,
  );
  const lockedPaymentIntermediationFee = toFiniteRuntimeMoney(
    lockedFeeBreakdown?.paymentIntermediationFee,
  );
  const lockedTotalFees = toFiniteRuntimeMoney(lockedFeeBreakdown?.totalFees);
  const rawPayloadOperationalFee = toFiniteRuntimeMoney(payload?.operationalFee);
  const rawPayloadPaymentIntermediationFee = toFiniteRuntimeMoney(
    payload?.paymentIntermediationFee,
  );
  const rawPayloadDriverNetAmount = toFiniteRuntimeMoney(payload?.driverNetAmount);
  const rawPayloadTotalFees = toFiniteRuntimeMoney(payload?.totalFees);
  const meaningfulPayloadOperationalFee =
    rawPayloadOperationalFee === 0 &&
    finalFare > 0 &&
    Number.isFinite(lockedOperationalFee) &&
    lockedOperationalFee > 0
      ? null
      : rawPayloadOperationalFee;
  const meaningfulPayloadPaymentIntermediationFee =
    rawPayloadPaymentIntermediationFee === 0 &&
    finalFare > 0 &&
    Number.isFinite(lockedPaymentIntermediationFee) &&
    lockedPaymentIntermediationFee > 0
      ? null
      : rawPayloadPaymentIntermediationFee;
  const meaningfulPayloadDriverNetAmount =
    rawPayloadDriverNetAmount === 0 &&
    finalFare > 0 &&
    Number.isFinite(payoutFallback) &&
    payoutFallback > 0
      ? null
      : rawPayloadDriverNetAmount;
  const meaningfulPayloadTotalFees =
    rawPayloadTotalFees === 0 &&
    finalFare > 0 &&
    Number.isFinite(lockedTotalFees) &&
    lockedTotalFees > 0
      ? null
      : rawPayloadTotalFees;

  const operationalFee =
    meaningfulPayloadOperationalFee ??
    toFiniteRuntimeMoney(payloadFeeBreakdown?.operationalFee) ??
    lockedOperationalFee;
  const paymentIntermediationFee =
    meaningfulPayloadPaymentIntermediationFee ??
    toFiniteRuntimeMoney(payloadFeeBreakdown?.paymentIntermediationFee) ??
    lockedPaymentIntermediationFee;
  const provisionalDriverNetAmount =
    meaningfulPayloadDriverNetAmount ??
    toFiniteRuntimeMoney(payloadFeeBreakdown?.driverNetAmount) ??
    meaningfulLockedDriverNetAmount ??
    (Number.isFinite(payoutFallback) && payoutFallback >= 0
      ? roundCurrencyValue(payoutFallback)
      : null);
  const meaningfulLockedTotalFees =
    lockedTotalFees === 0 &&
    finalFare > 0 &&
    Number.isFinite(provisionalDriverNetAmount) &&
    provisionalDriverNetAmount > 0 &&
    finalFare - provisionalDriverNetAmount > 0
      ? null
      : lockedTotalFees;
  const totalFeesFromPayload =
    meaningfulPayloadTotalFees ??
    toFiniteRuntimeMoney(payloadFeeBreakdown?.totalFees) ??
    meaningfulLockedTotalFees;
  const inferredDriverNetFromFees =
    totalFeesFromPayload !== null
      ? roundCurrencyValue(Math.max(0, finalFare - totalFeesFromPayload))
      : Number.isFinite(operationalFee) ||
          Number.isFinite(paymentIntermediationFee)
        ? roundCurrencyValue(
            Math.max(
              0,
              finalFare -
                (Number(operationalFee || 0) +
                  Number(paymentIntermediationFee || 0)),
            ),
          )
        : null;
  const hasUsableFeeBreakdown =
    totalFeesFromPayload !== null ||
    operationalFee !== null ||
    paymentIntermediationFee !== null;
  const resolvedDriverNetAmount =
    hasUsableFeeBreakdown && inferredDriverNetFromFees !== null
      ? inferredDriverNetFromFees
      : provisionalDriverNetAmount === 0 && finalFare > 0
      ? Number.isFinite(inferredDriverNetFromFees) &&
        inferredDriverNetFromFees > 0
        ? inferredDriverNetFromFees
        : null
      : provisionalDriverNetAmount;
  const driverNetAmount = normalizeCompletedTripDriverNetAmount({
    finalFare,
    driverNetAmount: resolvedDriverNetAmount,
    operationalFee,
    paymentIntermediationFee,
    totalFees: totalFeesFromPayload,
  });
  const totalFees =
    totalFeesFromPayload !== null
      ? totalFeesFromPayload
      : driverNetAmount !== null
        ? roundCurrencyValue(Math.max(0, finalFare - driverNetAmount))
        : null;
  const tollFee =
    resolveTripTollAmount(payload) ||
    resolveTripTollAmount(payloadFeeBreakdown) ||
    resolveTripTollAmount(lockedRideSnapshot) ||
    resolveTripTollAmount(lockedFeeBreakdown);
  const baseFare = roundCurrencyValue(finalFare * 0.55);
  const variableFare = roundCurrencyValue(Math.max(0, finalFare - baseFare));
  const hasPayloadSnapshot =
    payload?.authoritativeSnapshot === true || Boolean(payloadFeeBreakdown);

  return {
    finalFare,
    baseFare,
    variableFare,
    ...(operationalFee !== null ? { operationalFee } : {}),
    ...(paymentIntermediationFee !== null
      ? { paymentIntermediationFee }
      : {}),
    ...(tollFee > 0 ? { tollFee } : {}),
    ...(totalFees !== null ? { totalFees } : {}),
    ...(driverNetAmount !== null ? { driverNetAmount } : {}),
    financialSnapshotSource: hasPayloadSnapshot
      ? payload?.financialSnapshotSource || "backend_final"
      : lockedFeeBreakdown
        ? "locked_offer_snapshot"
        : "local_fallback",
    authoritativeSnapshot: Boolean(hasPayloadSnapshot),
  };
}

function hasAuthoritativeTripCompletedSnapshot(payload = {}) {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const bookingId = String(payload?.bookingId || "").trim();
  if (!bookingId) {
    return false;
  }

  const fare = Number(payload?.fare ?? payload?.amount);
  const driverNetAmount = Number(payload?.driverNetAmount);
  const totalFees = Number(payload?.totalFees);
  return (
    payload?.authoritativeSnapshot === true ||
    Number.isFinite(driverNetAmount) ||
    Number.isFinite(totalFees) ||
    Number.isFinite(fare)
  );
}

function mergeDriverOffers(previousOffers = [], incomingOffer) {
  return mergeDriverOffersWithLockedPricing(previousOffers, incomingOffer);
}

function normalizeChatMessage(message) {
  const senderId =
    message?.senderId || message?.userId || message?.fromUserId || "";
  const messageText = sanitizeText(message?.message || message?.text, "");
  const timestampValue =
    message?.timestamp ||
    message?.createdAt ||
    message?.sentAt ||
    new Date().toISOString();
  const timestampDate = new Date(timestampValue);
  const timestamp = Number.isNaN(timestampDate.getTime())
    ? new Date().toISOString()
    : timestampDate.toISOString();
  const messageId =
    message?.messageId ||
    message?.id ||
    `msg-${timestamp}-${Math.random().toString(16).slice(2, 9)}`;
  const isYou =
    runtimeState.profileUid && senderId && senderId === runtimeState.profileUid;

  return {
    id: String(messageId),
    text: messageText,
    senderId: senderId || null,
    author: isYou ? "you" : "driver",
    timestamp,
  };
}

function mergeChatMessages(existing = [], incoming = []) {
  const map = new Map();

  [...existing, ...incoming].forEach((raw) => {
    const item = normalizeChatMessage(raw);
    if (!item.text) {
      return;
    }

    map.set(String(item.id), item);
  });

  return Array.from(map.values())
    .sort((left, right) => {
      const leftTime = new Date(left.timestamp).getTime();
      const rightTime = new Date(right.timestamp).getTime();
      return leftTime - rightTime;
    })
    .slice(-CHAT_MESSAGE_LIMIT);
}

function getOriginCoordinate() {
  return (
    runtimeState.currentCoordinate ||
    runtimeState.driverCoordinate || {
      latitude: PROTOTYPE_ORIGIN_COORDINATE.latitude,
      longitude: PROTOTYPE_ORIGIN_COORDINATE.longitude,
    }
  );
}

function getPayloadOriginCoordinate(payload = {}) {
  return (
    normalizeRuntimeCoordinate(payload?.pickupLocation) ||
    normalizeRuntimeCoordinate(payload?.originCoordinate) ||
    normalizeRuntimeCoordinate(payload?.pickupCoordinate) ||
    getOriginCoordinate()
  );
}

function resolveSyncedBookingStatus(snapshot = {}) {
  const normalizedStatus = normalizeRuntimeLifecycleStatus(snapshot?.status);
  const normalizedStatusKey = String(snapshot?.status || "")
    .trim()
    .toUpperCase()
    .replace(/-/g, "_");

  if (
    [
      "INTERRUPTED_OPERATIONAL",
      "OPERATIONAL_INTERRUPTED",
      "PASSENGER_DECISION_PENDING",
    ].includes(normalizedStatusKey) ||
    normalizedStatus === "operational_interrupted"
  ) {
    return "operational_interrupted";
  }

  if (
    [
      "REASSIGNMENT_PENDING",
      "SEARCHING_REPLACEMENT_DRIVER",
      "REPLACEMENT_DRIVER_SEARCHING",
    ].includes(normalizedStatusKey) ||
    normalizedStatus === "searching_replacement"
  ) {
    return "searching_replacement";
  }

  if (normalizedStatus === "started") {
    return "started";
  }

  if (
    [
      "REASSIGNED_IN_PROGRESS",
      "REPLACEMENT_DRIVER_ACCEPTED",
      "REASSIGNED_STARTED",
      "TRIP_IN_PROGRESS",
    ].includes(normalizedStatusKey)
  ) {
    return "started";
  }

  if (normalizedStatus === "arrived") {
    return "arrived";
  }

  if (normalizedStatus === "accepted") {
    return "accepted";
  }

  if (
    [
      "COMPLETED",
      "EARLY_ENDED_BY_RIDER",
      "INTERRUPTED_OPERATIONAL_ENDED",
      "EARLY_ENDED_REVIEW",
    ].includes(normalizedStatusKey)
  ) {
    return "completed";
  }

  if (
    [
      "REQUESTED",
      "REQUESTING",
      "SEARCHING",
      "PENDING_DRIVER",
      "WAITING_DRIVER",
      "CREATED",
    ].includes(normalizedStatusKey) ||
    normalizedStatus === "requesting" ||
    normalizedStatus === "searching"
  ) {
    return "searching";
  }

  return snapshot?.hasActiveRide ? "searching" : "idle";
}

function buildReceiptFromSyncedSnapshot(
  snapshot = {},
  previousState = runtimeState,
) {
  const receiptId =
    snapshot?.bookingId ||
    previousState?.activeBookingId ||
    `proto-${Date.now()}`;
  const previousReceiptForBooking =
    previousState?.lastReceipt?.id === receiptId &&
    typeof previousState?.lastReceipt === "object"
      ? previousState.lastReceipt
      : null;
  const destination = normalizeDestinationItem({
    name: parseNameFromDescription(snapshot?.destinationLocation?.add || ""),
    address: snapshot?.destinationLocation?.add || "",
    coordinate:
      Number.isFinite(snapshot?.destinationLocation?.lat) &&
      Number.isFinite(snapshot?.destinationLocation?.lng)
        ? {
            latitude: Number(snapshot.destinationLocation.lat),
            longitude: Number(snapshot.destinationLocation.lng),
          }
        : null,
  });
  const pickupLabel = resolveCompletedReceiptPickupLabel(
    {
      pickupAddress: snapshot?.pickupLocation?.add,
      pickup: snapshot?.pickup,
    },
    previousState,
  );
  const dropLabel = resolveCompletedReceiptDropoffLabel(
    {
      destinationAddress: destination?.address,
      destinationLocation: snapshot?.destinationLocation,
      drop: snapshot?.drop,
    },
    previousState,
  );
  const receiptParticipants = resolveReceiptParticipants(snapshot, previousState);
  const receiptPickupCoordinate =
    normalizeRuntimeCoordinate(snapshot?.pickupCoordinate) ||
    normalizeRuntimeCoordinate(snapshot?.pickupLocation) ||
    resolvePickupCoordinateFromRide(
      previousState?.driverActiveRide,
      previousState?.activeBooking,
    ) ||
    previousState?.driverTripMeta?.pickupCoordinate ||
    previousState?.lastReceipt?.pickupCoordinate ||
    null;
  const receiptDestinationCoordinate =
    normalizeRuntimeCoordinate(snapshot?.destinationCoordinate) ||
    normalizeRuntimeCoordinate(snapshot?.destinationLocation) ||
    resolveDestinationCoordinateFromRide(
      previousState?.driverActiveRide,
      previousState?.selectedDestination,
      previousState?.activeBooking,
    ) ||
    previousState?.driverTripMeta?.destinationCoordinate ||
    previousState?.lastReceipt?.destinationCoordinate ||
    null;
  const routePlan = extractDriverRoutePlan(previousState?.driverTripMeta);
  const receiptRouteCoordinates = resolveCompletedReceiptRouteCoordinates(
    normalizeRuntimeRouteCoordinates(snapshot?.routeCoordinates).length >= 2
      ? snapshot.routeCoordinates
      : normalizeRuntimeRouteCoordinates(previousState?.lastReceipt?.routeCoordinates)
            .length >= 2
        ? previousState.lastReceipt.routeCoordinates
        : normalizeRuntimeRouteCoordinates(routePlan?.destinationCoordinates)
              .length >= 2
          ? routePlan.destinationCoordinates
          : routePlan?.combinedCoordinates || [],
    receiptPickupCoordinate,
    receiptDestinationCoordinate,
  );
  const distanceKm = resolveCompletedTripDistanceKm({
    payloadDistance: snapshot?.distance ?? snapshot?.distanceKm,
    runtimeDistance:
      previousState?.lastReceipt?.id === receiptId
        ? previousState?.lastReceipt?.distanceKm
        : previousState?.tripDistanceKm ??
          routePlan?.destinationDistanceKm ??
          snapshot?.routeDistanceKm,
    routeCoordinates: receiptRouteCoordinates,
    pickupCoordinate: receiptPickupCoordinate,
    destinationCoordinate: receiptDestinationCoordinate,
    initialMeters:
      Number(routePlan?.destinationDistanceKm) > 0
        ? Math.round(Number(routePlan.destinationDistanceKm) * 1000)
        : null,
  });
  const durationMin = resolveCompletedTripDurationMin({
    payloadDurationSeconds:
      snapshot?.duration ??
      snapshot?.durationSecs ??
      snapshot?.routeDurationSecs,
    runtimeDurationMinutes:
      previousState?.lastReceipt?.id === receiptId
        ? previousState?.lastReceipt?.durationMin
        : previousState?.tripDurationMin ??
          routePlan?.destinationDurationMinutes,
    routeDurationMinutes:
      routePlan?.destinationDurationMinutes ??
      previousState?.driverTripMeta?.initialEtaMinutes,
    distanceKm,
  });
  const completedPricingSnapshot = resolveCompletedTripFinancialSnapshot(
    snapshot,
    previousState,
  );
  const finalFare = completedPricingSnapshot.finalFare;

  return {
    ...(previousReceiptForBooking || {}),
    completedAt:
      previousReceiptForBooking?.completedAt || new Date().toISOString(),
    id: receiptId,
    date:
      previousReceiptForBooking?.date ||
      new Date().toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
    route: buildCompletedReceiptRouteLabel(
      {
        pickupAddress: pickupLabel,
        destinationAddress: dropLabel,
      },
      previousState,
    ),
    value: formatCurrencyBRL(finalFare),
    fare: finalFare,
    distanceKm,
    durationMin,
    paymentMethod:
      snapshot?.paymentStatus === "paid"
        ? "pix"
        : previousState?.paymentMethod || "pix",
    driverId: receiptParticipants.driverId || null,
    driverName: receiptParticipants.driverName || null,
    passengerId: receiptParticipants.passengerId || null,
    passengerName: receiptParticipants.passengerName || null,
    pickup: pickupLabel,
    pickupAddress: pickupLabel,
    drop: dropLabel,
    dropoffAddress: dropLabel,
    destinationAddress: dropLabel,
    ...(receiptPickupCoordinate ? { pickupCoordinate: receiptPickupCoordinate } : {}),
    ...(receiptDestinationCoordinate
      ? { destinationCoordinate: receiptDestinationCoordinate }
      : {}),
    ...(receiptRouteCoordinates.length >= 2
      ? { routeCoordinates: receiptRouteCoordinates }
      : {}),
    ...completedPricingSnapshot,
  };
}

function isTerminalRecoveredReceipt(receipt = {}) {
  if (!receipt || typeof receipt !== "object") {
    return false;
  }

  if (receipt.savedAt || receipt.savedTimestamp) {
    return true;
  }

  const status = String(
    receipt?.metadata?.status ||
      receipt?.status ||
      receipt?.bookingStatus ||
      receipt?.tripStatus ||
      "",
  )
    .trim()
    .toUpperCase();

  return [
    "COMPLETE",
    "COMPLETED",
    "PAID",
    "FINISHED",
    "DONE",
    "EARLY_ENDED_BY_RIDER",
    "INTERRUPTED_OPERATIONAL_ENDED",
    "EARLY_ENDED_REVIEW",
  ].includes(status);
}

function normalizeRecoveredReceiptDistanceKm(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return null;
  }
  return numeric > 100 ? roundCurrencyValue(numeric / 1000) : numeric;
}

function normalizeRecoveredReceiptCoordinate(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return normalizeRuntimeCoordinate({
    latitude: value.latitude ?? value.lat,
    longitude: value.longitude ?? value.lng,
  });
}

function resolveRecoveredReceiptRideId(receipt = {}, fallbackBookingId = "") {
  const directId = String(
    receipt?.rideId || receipt?.bookingId || receipt?.id || "",
  ).trim();
  if (directId) {
    return directId;
  }

  const receiptId = String(receipt?.receiptId || "").trim();
  if (receiptId.startsWith("LEAF-")) {
    return receiptId.slice(5);
  }

  return String(fallbackBookingId || "").trim();
}

function buildRuntimeReceiptFromRecoveredReceipt(
  receipt = {},
  previousState = runtimeState,
  fallbackBookingId = "",
) {
  const rideId = resolveRecoveredReceiptRideId(receipt, fallbackBookingId);
  if (!rideId) {
    return null;
  }

  const pickupCoordinate = normalizeRecoveredReceiptCoordinate(
    receipt?.trip?.pickup?.coordinates,
  );
  const destinationCoordinate = normalizeRecoveredReceiptCoordinate(
    receipt?.trip?.dropoff?.coordinates,
  );
  const financial = receipt?.financial || {};
  const breakdown = financial?.breakdown || {};
  const totals = financial?.totals || {};
  const totalPaid = pickPreferredRuntimeMoney(
    financial?.totalPaid?.amount,
    totals?.customerPaid,
    breakdown?.tripFare?.amount,
    receipt?.totalAmount,
  );
  const operationalFee = pickPreferredRuntimeMoney(
    breakdown?.operationalCost?.amount,
    totals?.leafOperational,
    receipt?.operationalFee,
  );
  const paymentIntermediationFee = pickPreferredRuntimeMoney(
    breakdown?.wooviFee?.amount,
    totals?.wooviFee,
    receipt?.paymentIntermediationFee,
  );
  const driverNetAmount = pickPreferredRuntimeMoney(
    breakdown?.driverAmount?.amount,
    totals?.driverReceived,
    receipt?.driverNetAmount,
  );
  const tollFee = pickPreferredRuntimeMoney(
    breakdown?.tollFee?.amount,
    breakdown?.toll?.amount,
    financial?.tollFee?.amount,
    totals?.tollFee,
    receipt?.tollFee,
  );
  const totalFees =
    operationalFee !== null || paymentIntermediationFee !== null
      ? roundCurrencyValue(
          Number(operationalFee || 0) + Number(paymentIntermediationFee || 0),
        )
      : totalPaid !== null && driverNetAmount !== null
        ? roundCurrencyValue(Math.max(0, totalPaid - driverNetAmount))
        : null;
  const distanceKm = normalizeRecoveredReceiptDistanceKm(
    receipt?.trip?.distance?.actual ??
      receipt?.trip?.distance?.estimated ??
      receipt?.distanceKm ??
      receipt?.distance,
  );
  const durationMin = Number(receipt?.trip?.duration ?? receipt?.durationMin);

  const snapshot = {
    bookingId: rideId,
    rideId,
    status: "COMPLETED",
    authoritativeSnapshot: true,
    financialSnapshotSource: "stored_receipt_recovery",
    pickupLocation: {
      add: receipt?.trip?.pickup?.address || receipt?.pickupAddress || "",
      ...(pickupCoordinate
        ? {
            lat: pickupCoordinate.latitude,
            lng: pickupCoordinate.longitude,
          }
        : {}),
    },
    destinationLocation: {
      add:
        receipt?.trip?.dropoff?.address ||
        receipt?.destinationAddress ||
        receipt?.dropoffAddress ||
        "",
      ...(destinationCoordinate
        ? {
            lat: destinationCoordinate.latitude,
            lng: destinationCoordinate.longitude,
          }
        : {}),
    },
    ...(pickupCoordinate ? { pickupCoordinate } : {}),
    ...(destinationCoordinate ? { destinationCoordinate } : {}),
    ...(distanceKm !== null ? { distanceKm } : {}),
    ...(Number.isFinite(durationMin)
      ? { duration: Math.max(0, Math.round(durationMin * 60)) }
      : {}),
    ...(totalPaid !== null
      ? {
          fare: totalPaid,
          finalFare: totalPaid,
          amount: totalPaid,
        }
      : {}),
    ...(operationalFee !== null ? { operationalFee } : {}),
    ...(paymentIntermediationFee !== null ? { paymentIntermediationFee } : {}),
    ...(tollFee !== null ? { tollFee } : {}),
    ...(totalFees !== null ? { totalFees } : {}),
    ...(driverNetAmount !== null ? { driverNetAmount } : {}),
    paymentStatus: receipt?.payment?.status || "paid",
    driver: {
      id: receipt?.driver?.id || "",
      name: receipt?.driver?.name || receipt?.driver?.fullName || "",
    },
    customer: {
      id: receipt?.customer?.id || "",
      name: receipt?.customer?.name || "",
    },
  };

  const runtimeReceipt = buildReceiptFromSyncedSnapshot(snapshot, previousState);
  return {
    ...runtimeReceipt,
    receiptId: receipt?.receiptId || runtimeReceipt.receiptId || null,
    completedAt:
      receipt?.trip?.dropoff?.timestamp ||
      receipt?.trip?.dateTime ||
      runtimeReceipt.completedAt,
    authoritativeSnapshot: true,
    financialSnapshotSource: "stored_receipt_recovery",
  };
}

async function recoverCompletedRideFromStoredReceipt({
  bookingId: explicitBookingId = "",
  reason = "manual",
  force = false,
} = {}) {
  const bookingId = String(
    explicitBookingId ||
      runtimeState.activeBookingId ||
      runtimeState.driverActiveRide?.bookingId ||
      runtimeState.lastRideBookingId ||
      runtimeState.activeChatBookingId ||
      runtimeState.lastReceipt?.id ||
      runtimeState.tripHistory?.[0]?.id ||
      "",
  ).trim();
  if (!bookingId) {
    return { recovered: false, code: "NO_BOOKING" };
  }

  const normalizedStatus = String(runtimeState.bookingStatus || "")
    .trim()
    .toLowerCase();
  const canAttempt =
    force ||
    ["accepted", "arrived", "started", "completed"].includes(normalizedStatus);
  if (!canAttempt) {
    return { recovered: false, code: "STATUS_NOT_RECOVERABLE" };
  }

  if (runtimeState.lastReceipt?.id === bookingId) {
    return {
      recovered: true,
      code: "ALREADY_RECOVERED",
      receiptId: bookingId,
    };
  }

  if (runtimeReceiptRecoveryInFlight) {
    return runtimeReceiptRecoveryInFlight;
  }

  runtimeReceiptRecoveryInFlight = (async () => {
    try {
      await writeRuntimeDebugProbe("receipt_recovery_start", {
        bookingId,
        reason,
        bookingStatus: normalizedStatus,
      });

      const recoveredReceipt = await receiptService.getReceiptByRideId(bookingId);
      if (!isTerminalRecoveredReceipt(recoveredReceipt)) {
        await writeRuntimeDebugProbe("receipt_recovery_skipped_not_terminal", {
          bookingId,
          reason,
          receiptStatus:
            recoveredReceipt?.metadata?.status ||
            recoveredReceipt?.status ||
            recoveredReceipt?.bookingStatus ||
            null,
        });
        return { recovered: false, code: "RECEIPT_NOT_TERMINAL" };
      }

      const runtimeReceipt = buildRuntimeReceiptFromRecoveredReceipt(
        recoveredReceipt,
        runtimeState,
        bookingId,
      );
      if (!runtimeReceipt?.id) {
        return { recovered: false, code: "INVALID_RECEIPT" };
      }

      stopSearchingTimer();
      stopBoardingCountdownTimer();
      stopPassengerLocationHeartbeat();
      setRuntimeState({
        bookingStatus: "completed",
        activeBooking: null,
        activeBookingId: null,
        terminalRideGuards: mergeTerminalRideGuard(
          runtimeState.terminalRideGuards,
          bookingId,
          "completed",
        ),
        driverOffers: [],
        driverActiveRide: null,
        tripArrivalText: "",
        boardingDeadlineAt: null,
        boardingRemainingSec: 0,
        tripIntegrityAlert: {
          active: false,
          reason: "",
          message: "",
          distanceMeters: null,
          thresholdMeters: null,
          confirmationTimeoutSec: null,
          updatedAt: null,
        },
        rideExtension: cloneDefaultRideExtensionState(),
        driverExtensionRequest: cloneDefaultDriverExtensionRequest(),
        operationalContinuation: cloneDefaultOperationalContinuation(),
        lastError: "",
      });
      pushTripHistoryItem(runtimeReceipt);

      await writeRuntimeDebugProbe("receipt_recovery_completed", {
        bookingId,
        reason,
        receiptId: runtimeReceipt.id,
        routePoints: Array.isArray(runtimeReceipt.routeCoordinates)
          ? runtimeReceipt.routeCoordinates.length
          : 0,
        fare: runtimeReceipt.fare ?? null,
        driverNetAmount: runtimeReceipt.driverNetAmount ?? null,
      });

      return {
        recovered: true,
        code: "RECOVERED",
        receiptId: runtimeReceipt.id,
      };
    } catch (error) {
      await writeRuntimeDebugProbe("receipt_recovery_error", {
        bookingId,
        reason,
        message: error?.message || String(error),
      });
      return {
        recovered: false,
        code: "ERROR",
        error: error?.message || String(error),
      };
    } finally {
      runtimeReceiptRecoveryInFlight = null;
    }
  })();

  return runtimeReceiptRecoveryInFlight;
}

function clearRuntimeRideStateFromSync() {
  stopSearchingTimer();
  stopBoardingCountdownTimer();
  stopPassengerLocationHeartbeat();

  const bookingIdToClear = String(
    runtimeState.activeBookingId || runtimeState.driverActiveRide?.bookingId || "",
  ).trim();
  if (bookingIdToClear) {
    runtimeAppliedLifecycleEventKeysByBooking.delete(bookingIdToClear);
  }

  setRuntimeState((previous) => ({
    bookingStatus: "idle",
    searchingElapsedSeconds: 0,
    activeBookingId: null,
    activeBooking: null,
    driverOffers: [],
    driverActiveRide: null,
    driverCoordinate: null,
    driverTripMeta: createDefaultDriverTripMeta(),
    tripArrivalText: "",
    boardingDeadlineAt: null,
    boardingRemainingSec: 0,
    tripIntegrityAlert: {
      active: false,
      reason: "",
      message: "",
      distanceMeters: null,
      thresholdMeters: null,
      confirmationTimeoutSec: null,
      updatedAt: null,
    },
    rideExtension: cloneDefaultRideExtensionState(),
    driverExtensionRequest: cloneDefaultDriverExtensionRequest(),
    operationalContinuation: cloneDefaultOperationalContinuation(),
    lastError: "",
  }));
}

function dismissCompletedReceiptState() {
  stopSearchingTimer();
  stopBoardingCountdownTimer();
  stopPassengerLocationHeartbeat();

  const bookingIdToClear = String(
    runtimeState.activeBookingId ||
      runtimeState.driverActiveRide?.bookingId ||
      runtimeState.lastReceipt?.id ||
      runtimeState.lastRideBookingId ||
      "",
  ).trim();
  if (bookingIdToClear) {
    runtimeAppliedLifecycleEventKeysByBooking.delete(bookingIdToClear);
  }

  setRuntimeState((previous) => ({
    bookingStatus: "idle",
    searchingElapsedSeconds: 0,
    activeBookingId: null,
    activeBooking: null,
    terminalRideGuards: mergeTerminalRideGuard(
      previous.terminalRideGuards,
      bookingIdToClear,
      "completed",
    ),
    driverOffers: [],
    driverActiveRide: null,
    driverCoordinate: null,
    driverTripMeta: createDefaultDriverTripMeta(),
    tripArrivalText: "",
    boardingDeadlineAt: null,
    boardingRemainingSec: 0,
    tripIntegrityAlert: {
      active: false,
      reason: "",
      message: "",
      distanceMeters: null,
      thresholdMeters: null,
      confirmationTimeoutSec: null,
      updatedAt: null,
    },
    paymentState: {
      ...DEFAULT_RUNTIME_STATE.paymentState,
    },
    rideExtension: cloneDefaultRideExtensionState(),
    driverExtensionRequest: cloneDefaultDriverExtensionRequest(),
    operationalContinuation: cloneDefaultOperationalContinuation(),
    lastError: "",
  }));
}

function hasLocalPendingDriverOffer(state = runtimeState) {
  if (!state || typeof state !== "object") {
    return false;
  }

  const offers = Array.isArray(state.driverOffers) ? state.driverOffers : [];
  return offers.some((item) => Boolean(item?.bookingId || item?.id));
}

function getLocalDriverOfferFreshnessMs(state = runtimeState) {
  if (!state || typeof state !== "object") {
    return null;
  }

  const offers = Array.isArray(state.driverOffers) ? state.driverOffers : [];
  const latestOffer = offers.find((item) => Boolean(item?.bookingId || item?.id));
  if (!latestOffer) {
    return null;
  }

  const timestampCandidate =
    latestOffer?.runtimeReceivedAt ||
    latestOffer?.receivedAt ||
    latestOffer?.notifiedAt ||
    latestOffer?.requestedAt ||
    latestOffer?.timestamp ||
    latestOffer?.pricingSnapshotLockedAt ||
    latestOffer?.createdAt ||
    null;
  const timestampMs = new Date(timestampCandidate || "").getTime();
  if (!Number.isFinite(timestampMs)) {
    return null;
  }

  return Math.max(0, Date.now() - timestampMs);
}

function isLocalDriverOfferFresh(state = runtimeState) {
  const freshnessMs = getLocalDriverOfferFreshnessMs(state);
  if (freshnessMs === null) {
    return false;
  }

  return freshnessMs <= DRIVER_OFFER_IDLE_SYNC_GRACE_MS;
}

function stopSearchingTimer() {
  if (runtimeSearchTimer) {
    clearInterval(runtimeSearchTimer);
    runtimeSearchTimer = null;
  }
}

function stopBoardingCountdownTimer() {
  if (runtimeBoardingCountdownTimer) {
    clearInterval(runtimeBoardingCountdownTimer);
    runtimeBoardingCountdownTimer = null;
  }
}

function startBoardingCountdown(deadlineInput) {
  const deadlineMs = new Date(deadlineInput || "").getTime();
  if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) {
    stopBoardingCountdownTimer();
    setRuntimeState({
      boardingDeadlineAt: null,
      boardingRemainingSec: 0,
    });
    return;
  }

  stopBoardingCountdownTimer();

  const tick = () => {
    const remainingSec = Math.max(
      0,
      Math.round((deadlineMs - Date.now()) / 1000),
    );
    setRuntimeState({
      boardingDeadlineAt: new Date(deadlineMs).toISOString(),
      boardingRemainingSec: remainingSec,
    });

    if (remainingSec <= 0) {
      stopBoardingCountdownTimer();
    }
  };

  tick();
  runtimeBoardingCountdownTimer = setInterval(
    tick,
    BOARDING_COUNTDOWN_INTERVAL_MS,
  );
}

function startSearchingTimer({ preserveElapsed = false } = {}) {
  stopSearchingTimer();
  if (!preserveElapsed) {
    setRuntimeState({ searchingElapsedSeconds: 0 });
  }

  runtimeSearchTimer = setInterval(() => {
    setRuntimeState((previous) => {
      if (
        previous.bookingStatus !== "searching" &&
        previous.bookingStatus !== "requesting"
      ) {
        stopSearchingTimer();
        return previous;
      }

      const nextElapsed = Math.min(
        SEARCH_TOTAL_DURATION_SECONDS,
        (previous.searchingElapsedSeconds || 0) + 1,
      );

      if (nextElapsed >= SEARCH_TOTAL_DURATION_SECONDS) {
        stopSearchingTimer();
      }

      return {
        searchingElapsedSeconds: nextElapsed,
        ...(nextElapsed >= SEARCH_TOTAL_DURATION_SECONDS
          ? { lastError: SEARCH_TIMEOUT_RECONCILING_MESSAGE }
          : {}),
      };
    });
  }, SEARCH_TIMER_INTERVAL_MS);
}

export function mergeCompletedReceiptForHistory(existingReceipt, incomingReceipt) {
  if (!existingReceipt) {
    return incomingReceipt;
  }
  if (!incomingReceipt) {
    return existingReceipt;
  }

  const existingRouteCoordinates = normalizeRuntimeRouteCoordinates(
    existingReceipt?.routeCoordinates,
  );
  const incomingRouteCoordinates = normalizeRuntimeRouteCoordinates(
    incomingReceipt?.routeCoordinates,
  );
  const preferredRouteCoordinates =
    incomingRouteCoordinates.length >= existingRouteCoordinates.length
      ? incomingRouteCoordinates
      : existingRouteCoordinates;

  const existingHasBackendFinalFinancials =
    existingReceipt?.authoritativeSnapshot === true &&
    existingReceipt?.financialSnapshotSource === "backend_final";
  const incomingHasBackendFinalFinancials =
    incomingReceipt?.authoritativeSnapshot === true &&
    incomingReceipt?.financialSnapshotSource === "backend_final";
  const preferredFinancialReceipt =
    existingHasBackendFinalFinancials && !incomingHasBackendFinalFinancials
      ? existingReceipt
      : incomingReceipt;
  const fallbackFinancialReceipt =
    preferredFinancialReceipt === incomingReceipt
      ? existingReceipt
      : incomingReceipt;
  const finalFare = pickPreferredRuntimeMoney(
    preferredFinancialReceipt?.finalFare,
    preferredFinancialReceipt?.fare,
    fallbackFinancialReceipt?.finalFare,
    fallbackFinancialReceipt?.fare,
  );
  const rawDriverNetAmount = pickPreferredRuntimeMoney(
    preferredFinancialReceipt?.driverNetAmount,
    fallbackFinancialReceipt?.driverNetAmount,
    preferredFinancialReceipt?.estimatedDriverNetAmount,
    fallbackFinancialReceipt?.estimatedDriverNetAmount,
  );
  const operationalFee = pickPreferredRuntimeMoney(
    preferredFinancialReceipt?.operationalFee,
    fallbackFinancialReceipt?.operationalFee,
    preferredFinancialReceipt?.estimatedOperationalFee,
    fallbackFinancialReceipt?.estimatedOperationalFee,
  );
  const paymentIntermediationFee = pickPreferredRuntimeMoney(
    preferredFinancialReceipt?.paymentIntermediationFee,
    fallbackFinancialReceipt?.paymentIntermediationFee,
    preferredFinancialReceipt?.estimatedPaymentIntermediationFee,
    fallbackFinancialReceipt?.estimatedPaymentIntermediationFee,
  );
  const tollFee = pickPreferredRuntimeMoney(
    preferredFinancialReceipt?.tollFee,
    fallbackFinancialReceipt?.tollFee,
    preferredFinancialReceipt?.estimatedTollFee,
    fallbackFinancialReceipt?.estimatedTollFee,
  );
  const totalFees =
    pickPreferredRuntimeMoney(
      preferredFinancialReceipt?.totalFees,
      fallbackFinancialReceipt?.totalFees,
      preferredFinancialReceipt?.estimatedTotalFees,
      fallbackFinancialReceipt?.estimatedTotalFees,
    ) ??
    (finalFare !== null && rawDriverNetAmount !== null
      ? roundCurrencyValue(Math.max(0, finalFare - rawDriverNetAmount))
      : null);
  const driverNetAmount = normalizeCompletedTripDriverNetAmount({
    finalFare,
    driverNetAmount: rawDriverNetAmount,
    operationalFee,
    paymentIntermediationFee,
    totalFees,
  });
  const incomingDistanceKm = toFiniteRuntimeMoney(incomingReceipt?.distanceKm);
  const existingDistanceKm = toFiniteRuntimeMoney(existingReceipt?.distanceKm);
  const distanceKm =
    incomingDistanceKm !== null && existingDistanceKm !== null
      ? Math.max(incomingDistanceKm, existingDistanceKm)
      : incomingDistanceKm ?? existingDistanceKm ?? null;
  const incomingDurationMin = Number(incomingReceipt?.durationMin);
  const existingDurationMin = Number(existingReceipt?.durationMin);
  const durationMin =
    Number.isFinite(incomingDurationMin) && Number.isFinite(existingDurationMin)
      ? Math.max(incomingDurationMin, existingDurationMin)
      : Number.isFinite(incomingDurationMin)
        ? incomingDurationMin
        : Number.isFinite(existingDurationMin)
          ? existingDurationMin
          : null;

  const mergedReceipt = {
    ...existingReceipt,
    ...incomingReceipt,
    driverId: incomingReceipt?.driverId || existingReceipt?.driverId || null,
    driverName:
      incomingReceipt?.driverName || existingReceipt?.driverName || null,
    passengerId:
      incomingReceipt?.passengerId || existingReceipt?.passengerId || null,
    passengerName:
      incomingReceipt?.passengerName || existingReceipt?.passengerName || null,
    pickupAddress:
      incomingReceipt?.pickupAddress ||
      existingReceipt?.pickupAddress ||
      incomingReceipt?.pickup ||
      existingReceipt?.pickup ||
      "",
    pickup:
      incomingReceipt?.pickup ||
      existingReceipt?.pickup ||
      incomingReceipt?.pickupAddress ||
      existingReceipt?.pickupAddress ||
      "",
    destinationAddress:
      incomingReceipt?.destinationAddress ||
      incomingReceipt?.dropoffAddress ||
      existingReceipt?.destinationAddress ||
      existingReceipt?.dropoffAddress ||
      incomingReceipt?.drop ||
      existingReceipt?.drop ||
      "",
    dropoffAddress:
      incomingReceipt?.dropoffAddress ||
      incomingReceipt?.destinationAddress ||
      existingReceipt?.dropoffAddress ||
      existingReceipt?.destinationAddress ||
      incomingReceipt?.drop ||
      existingReceipt?.drop ||
      "",
    drop:
      incomingReceipt?.drop ||
      existingReceipt?.drop ||
      incomingReceipt?.destinationAddress ||
      existingReceipt?.destinationAddress ||
      "",
    paymentMethod:
      incomingReceipt?.paymentMethod ||
      existingReceipt?.paymentMethod ||
      "pix",
    authoritativeSnapshot: Boolean(
      preferredFinancialReceipt?.authoritativeSnapshot ||
        fallbackFinancialReceipt?.authoritativeSnapshot,
    ),
    financialSnapshotSource:
      preferredFinancialReceipt?.financialSnapshotSource ||
      fallbackFinancialReceipt?.financialSnapshotSource ||
      "local_fallback",
  };

  if (finalFare !== null) {
    mergedReceipt.fare = finalFare;
    mergedReceipt.finalFare = finalFare;
    mergedReceipt.value = formatCurrencyBRL(finalFare);
  }
  if (operationalFee !== null) {
    mergedReceipt.operationalFee = operationalFee;
  }
  if (paymentIntermediationFee !== null) {
    mergedReceipt.paymentIntermediationFee = paymentIntermediationFee;
  }
  if (tollFee !== null) {
    mergedReceipt.tollFee = tollFee;
  }
  if (totalFees !== null) {
    mergedReceipt.totalFees = totalFees;
  }
  if (driverNetAmount !== null) {
    mergedReceipt.driverNetAmount = driverNetAmount;
  }
  if (distanceKm !== null) {
    mergedReceipt.distanceKm = distanceKm;
  }
  if (durationMin !== null) {
    mergedReceipt.durationMin = durationMin;
  }

  const pickupCoordinate =
    normalizeRuntimeCoordinate(incomingReceipt?.pickupCoordinate) ||
    normalizeRuntimeCoordinate(existingReceipt?.pickupCoordinate);
  if (pickupCoordinate) {
    mergedReceipt.pickupCoordinate = pickupCoordinate;
  }

  const destinationCoordinate =
    normalizeRuntimeCoordinate(incomingReceipt?.destinationCoordinate) ||
    normalizeRuntimeCoordinate(existingReceipt?.destinationCoordinate);
  if (destinationCoordinate) {
    mergedReceipt.destinationCoordinate = destinationCoordinate;
  }

  if (preferredRouteCoordinates.length >= 2) {
    mergedReceipt.routeCoordinates = preferredRouteCoordinates;
  }

  return mergedReceipt;
}

function pushTripHistoryItem(receipt) {
  if (!receipt) {
    return;
  }

  setRuntimeState((previous) => {
    const existingReceipt =
      previous.lastReceipt?.id === receipt?.id
        ? previous.lastReceipt
        : (previous.tripHistory || []).find((item) => item?.id === receipt?.id) ||
          null;
    const mergedReceipt = mergeCompletedReceiptForHistory(
      existingReceipt,
      receipt,
    );
    const nextHistory = [
      mergedReceipt,
      ...(previous.tripHistory || []).filter(
        (item) => item?.id !== mergedReceipt?.id,
      ),
    ].slice(0, TRIP_HISTORY_LIMIT);
    return {
      tripHistory: nextHistory,
      lastReceipt: mergedReceipt,
    };
  });
}

async function submitCompletedReceiptRating({
  reviewerType = "",
  rating = 5,
  comment = "",
  airConditioningOk = true,
} = {}) {
  const normalizedReviewerType =
    String(reviewerType || runtimeState.activeRole || "")
      .trim()
      .toLowerCase() === "driver"
      ? "driver"
      : "passenger";
  const receipt =
    runtimeState.lastReceipt ||
    (Array.isArray(runtimeState.tripHistory)
      ? runtimeState.tripHistory[0]
      : null);
  const tripId = receipt?.id || null;
  const reviewerId = runtimeState.profileUid || runtimeState.profile?.uid || null;
  const targetUserId =
    normalizedReviewerType === "driver"
      ? receipt?.passengerId || null
      : receipt?.driverId || runtimeState.driverInfo?.id || null;

  if (!tripId) {
    throw new Error("Nenhum recibo disponível para avaliar.");
  }
  if (!reviewerId) {
    throw new Error("Sessão indisponível para enviar avaliação.");
  }
  if (!targetUserId) {
    throw new Error("Usuário avaliado indisponível.");
  }

  const normalizedRating = Math.min(
    5,
    Math.max(1, Number.isFinite(Number(rating)) ? Number(rating) : 5),
  );
  const selectedOptions =
    normalizedReviewerType === "driver"
      ? ["Pontualidade", "Boa comunicacao"]
      : [
          "Conducao segura",
          "Pontualidade",
          `Ar-condicionado: ${airConditioningOk ? "Sim" : "Não"}`,
        ];

  await RatingService.submitRating({
    tripId,
    userId: reviewerId,
    reviewerId,
    reviewerType: normalizedReviewerType,
    userType: normalizedReviewerType,
    targetUserId,
    ...(normalizedReviewerType === "driver"
      ? { passengerId: targetUserId }
      : { driverId: targetUserId }),
    rating: normalizedRating,
    comment: String(comment || "").trim(),
    selectedOptions,
    tripData:
      normalizedReviewerType === "driver"
        ? { passengerId: targetUserId, passenger: targetUserId }
        : { driverId: targetUserId, driver: targetUserId },
  });

  const ratedAt = new Date().toISOString();
  markTripHistoryRating(
    tripId,
    normalizedReviewerType === "driver"
      ? {
          driverRatedPassengerAt: ratedAt,
          driverRatedPassengerValue: normalizedRating,
          driverRatedPassengerComment: String(comment || "").trim(),
        }
      : {
          passengerRatedDriverAt: ratedAt,
          passengerRatedDriverValue: normalizedRating,
          passengerRatedDriverComment: String(comment || "").trim(),
        },
  );

  await writeRuntimeDebugProbe("receipt_rating_submitted", {
    tripId,
    reviewerType: normalizedReviewerType,
    targetUserId,
    rating: normalizedRating,
  });

  return {
    success: true,
    tripId,
    reviewerType: normalizedReviewerType,
    ratedAt,
  };
}

function markTripHistoryRating(tripId, patch = {}) {
  if (!tripId || !patch || typeof patch !== "object") {
    return;
  }

  setRuntimeState((previous) => ({
    tripHistory: (previous.tripHistory || []).map((item) =>
      item?.id === tripId ? { ...item, ...patch } : item,
    ),
    lastReceipt:
      previous.lastReceipt?.id === tripId
        ? { ...previous.lastReceipt, ...patch }
        : previous.lastReceipt,
  }));
}

function decodePolylineToCoordinates(polylinePoints) {
  if (!polylinePoints) {
    return [];
  }

  try {
    const decoded = polyline.decode(polylinePoints);
    if (!Array.isArray(decoded) || decoded.length < 2) {
      return [];
    }

    return decoded.map(([latitude, longitude]) => ({
      latitude,
      longitude,
    }));
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao decodificar polyline:",
      error?.message || error,
    );
    return [];
  }
}

async function ensureCurrentLocation(options = {}) {
  const {
    allowCurrentPosition = true,
    resolveAddress = true,
    forceCurrentPosition = false,
  } = options;

  try {
    let permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      if (SHOULD_BYPASS_BOOT_LOCATION_PROMPT) {
        await writeRuntimeDebugProbe("location_permission_bypassed_simulator", {
          allowCurrentPosition,
          status: permission.status,
        });
        return;
      }
      permission = await requestForegroundLocationPermissionWithDisclosure();
    }

    if (permission.status !== "granted") {
      return;
    }

    let position = null;
    let positionSource = null;
    if (Platform.OS === "android" && !forceCurrentPosition) {
      try {
        position = await Location.getLastKnownPositionAsync({
          maxAge: 60000,
          requiredAccuracy: 250,
        });
        if (position) {
          positionSource = "last_known";
        }
      } catch (lastKnownError) {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Última localização indisponível:",
          lastKnownError?.message || lastKnownError,
        );
      }
    }

    if (!position && !allowCurrentPosition) {
      return;
    }

    if (!position) {
      const currentPositionOptions =
        Platform.OS === "android"
          ? {
              accuracy: forceCurrentPosition
                ? Location.Accuracy.High
                : Location.Accuracy.Balanced,
              maximumAge: forceCurrentPosition ? 0 : 15000,
              timeout: forceCurrentPosition ? 12000 : 8000,
            }
          : {
              accuracy: Location.Accuracy.Balanced,
              maximumAge: 10000,
              timeout: 12000,
            };

      position = await Location.getCurrentPositionAsync(currentPositionOptions);
      positionSource = forceCurrentPosition ? "current_forced" : "current";
    }

    const latitude = Number(position?.coords?.latitude);
    const longitude = Number(position?.coords?.longitude);
    const currentHeading = normalizeHeading(position?.coords?.heading);
    const currentSpeed = Number(position?.coords?.speed);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    await writeRuntimeDebugProbe("location_current_resolved", {
      allowCurrentPosition,
      forceCurrentPosition,
      positionSource,
      platform: Platform.OS,
      latitude,
      longitude,
      accuracy: Number(position?.coords?.accuracy) || null,
      timestamp: Number(position?.timestamp) || null,
    });

    let currentAddress = runtimeState.currentAddress || "";
    if (resolveAddress) {
      try {
        const reverse = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });
        const first =
          Array.isArray(reverse) && reverse.length > 0 ? reverse[0] : null;
        if (first) {
          currentAddress = [first.name, first.street, first.city]
            .filter(Boolean)
            .join(", ");
        }
      } catch (reverseError) {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Reverse geocode indisponível:",
          reverseError?.message || reverseError,
        );
      }
    }

    const normalizedCoordinate = {
      latitude,
      longitude,
      ...(Number.isFinite(currentSpeed) && currentSpeed >= 0
        ? { speed: currentSpeed }
        : {}),
    };
    const shouldMirrorDriverCoordinate =
      normalizeRuntimeRole(runtimeState.activeRole) === "driver";
    const shouldIgnoreCoordinateHydration =
      shouldMirrorDriverCoordinate && runtimeDriverRoutePlaybackActive;
    setRuntimeState({
      ...(!shouldIgnoreCoordinateHydration
        ? {
            currentCoordinate: normalizedCoordinate,
            ...(shouldMirrorDriverCoordinate
              ? { driverCoordinate: normalizedCoordinate }
              : {}),
          }
        : {}),
      ...(Number.isFinite(currentHeading) ? { currentHeading } : {}),
      currentAddress: currentAddress || runtimeState.currentAddress,
    });

    await startHeadingWatcher();
    await startForegroundLocationWatcher();
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Não foi possível obter localização atual:",
      error?.message || error,
    );
  }
}

function attachSocketListeners() {
  if (runtimeSocketListenersAttached) {
    return;
  }

  const socket = WebSocketManager.getInstance();

  const handleConnect = () => {
    runtimeLastSocketConnectAt = Date.now();
    setRuntimeState({
      connecting: false,
      isSocketConnected: true,
      socketError: "",
    });
  };

  const handleDisconnect = () => {
    stopDriverLocationHeartbeat();
    stopPassengerLocationHeartbeat();
    const normalizedRole = resolveRuntimeRole();
    const shouldKeepDriverOnlineIntent =
      normalizedRole === "driver" &&
      (Boolean(runtimeState.driverOnline) ||
        Boolean(runtimeState.driverOnlinePending));

    setRuntimeState({
      connecting: false,
      isSocketConnected: false,
      isSocketAuthenticated: false,
      ...(shouldKeepDriverOnlineIntent
        ? {
            driverOnline: true,
            driverOnlinePending: false,
            driverOnlineMutationSource:
              "socket_disconnect_preserve_online_intent",
          }
        : {}),
    });
  };

  const handleSessionTerminated = (payload = {}) => {
    const payloadRole = normalizeRuntimeRole(
      payload?.userType ??
        payload?.usertype ??
        payload?.role ??
        payload?.accountType,
    );
    const normalizedRole = resolveRuntimeRole();
    const shouldEnforceSessionTermination =
      payloadRole === "driver" || (!payloadRole && normalizedRole === "driver");

    if (!shouldEnforceSessionTermination) {
      writeRuntimeDebugProbe("socket_session_terminated_ignored", {
        userId: payload?.userId || payload?.uid || runtimeState?.profileUid || null,
        payloadRole: payloadRole || null,
        currentRole: normalizedRole || null,
      });
      return;
    }

    const reason =
      payload?.reason ||
      payload?.message ||
      "Sua sessão foi aberta em outro aparelho.";
    const userMessage =
      "Sessão encerrada neste aparelho. Sua conta foi aberta em outro dispositivo.";

    stopDriverLocationHeartbeat();
    stopPassengerLocationHeartbeat();

    writeRuntimeDebugProbe("socket_session_terminated", {
      driverId:
        payload?.driverId || payload?.uid || runtimeState?.profileUid || null,
      reason: String(reason),
      socketId: payload?.socketId || null,
    });

    setRuntimeState({
      connecting: false,
      isSocketConnected: false,
      isSocketAuthenticated: false,
      socketError: userMessage,
      lastError: userMessage,
      ...(normalizedRole === "driver"
        ? {
            driverOnline: false,
            driverOnlinePending: false,
            driverOnlineMutationSource: "socket_session_terminated",
            driverTransientCard: buildDriverTransientCard({
              id: `driver-session-terminated-${Date.now()}`,
              type: "session_terminated",
              title: "Sessão encerrada",
              message: "Sua conta foi aberta em outro aparelho.",
              visibleUntil: new Date(Date.now() + 9000).toISOString(),
            }),
          }
        : {}),
    });
  };

  const handleConnectError = (error) => {
    setRuntimeState({
      connecting: false,
      isSocketConnected: false,
      socketError: error?.message || "Erro de conexão no socket",
    });
  };

  const handleAuthenticated = () => {
    setRuntimeState({
      connecting: false,
      isSocketAuthenticated: true,
      socketError: "",
    });
  };

  const handleActiveRideSync = (payload) => {
    if (!payload?.success) {
      return;
    }

    const syncedBookingId = String(payload?.bookingId || "").trim();
    if (isBookingEventSuppressed(syncedBookingId)) {
      writeRuntimeDebugProbe("event_active_ride_sync_ignored_suppressed", {
        bookingId: syncedBookingId,
        syncedStatus: resolveSyncedBookingStatus(payload),
      });
      return;
    }

    if (isRuntimeQALockActive()) {
      writeRuntimeDebugProbe("event_active_ride_sync_ignored_qa_lock", {
        bookingId: syncedBookingId || runtimeState.activeBookingId || null,
        syncedStatus: resolveSyncedBookingStatus(payload),
        localStatus: runtimeState.bookingStatus || null,
        role: runtimeState.activeRole || null,
        lockUntil: runtimeQALockUntil,
      });
      return;
    }

    const syncedStatus = resolveSyncedBookingStatus(payload);
    if (
      syncedBookingId &&
      shouldIgnoreLifecycleRegression(
        "activeRideSync",
        syncedBookingId,
        syncedStatus,
      )
    ) {
      return;
    }
    const normalizedLocalBookingStatus = String(runtimeState.bookingStatus || "")
      .trim()
      .toLowerCase();
    const hasExpiredPassengerSearch = isPassengerSearchExpired({
      role: runtimeState.activeRole,
      bookingStatus: normalizedLocalBookingStatus,
      elapsedSeconds: runtimeState.searchingElapsedSeconds,
    });
    const hasPendingDriverOfferContext =
      hasLocalPendingDriverOffer(runtimeState) &&
      (normalizedLocalBookingStatus === "searching" ||
        Boolean(runtimeState.activeBookingId));
    const shouldPreserveLocalPassengerSearch =
      shouldPreservePassengerSearchOnIdleSync({
        role: runtimeState.activeRole,
        syncedStatus,
        bookingStatus: normalizedLocalBookingStatus,
        elapsedSeconds: runtimeState.searchingElapsedSeconds,
        activeBookingId: runtimeState.activeBookingId,
        activeBooking: runtimeState.activeBooking,
        paymentStatus: runtimeState.paymentState?.status,
      });
    const shouldPreserveLocalDriverOffer =
      runtimeState.activeRole === "driver" &&
      syncedStatus === "idle" &&
      Boolean(runtimeState.driverOnline) &&
      !runtimeState.driverActiveRide?.bookingId &&
      hasPendingDriverOfferContext &&
      isLocalDriverOfferFresh(runtimeState);

    if (shouldPreserveLocalDriverOffer) {
      const offerAgeMs = getLocalDriverOfferFreshnessMs(runtimeState);
      writeRuntimeDebugProbe("event_active_ride_sync_preserved_driver_offer", {
        bookingId:
          runtimeState.driverOffers?.[0]?.bookingId ||
          runtimeState.driverOffers?.[0]?.id ||
          null,
        reason: "idle_sync_with_local_offer",
        offerAgeMs,
      });
      return;
    }

    if (shouldPreserveLocalPassengerSearch) {
      writeRuntimeDebugProbe("event_active_ride_sync_preserved_passenger_search", {
        bookingId: runtimeState.activeBookingId || null,
        reason: "idle_sync_while_passenger_searching",
        paymentStatus: runtimeState.paymentState?.status || null,
      });
      return;
    }

    if (syncedStatus === "idle" && shouldPreserveQALockedRideOnIdleSync()) {
      writeRuntimeDebugProbe("event_active_ride_sync_preserved_qa_lock", {
        bookingId: runtimeState.activeBookingId || null,
        localStatus: normalizedLocalBookingStatus,
        lockUntil: runtimeQALockUntil,
      });
      return;
    }

    if (syncedStatus === "idle") {
      if (hasExpiredPassengerSearch) {
        handleNoDriversFound({
          bookingId: runtimeState.activeBookingId || null,
          code: "SEARCH_TIMEOUT_RECONCILED",
          message: "Nenhum motorista ficou disponível no tempo de busca.",
        });
        return;
      }

      const localPaymentStatus = String(runtimeState.paymentState?.status || "")
        .trim()
        .toLowerCase();
      const hasConfirmedPayment =
        ["confirmed", "paid", "settled", "completed", "approved"].some(
          (status) => localPaymentStatus.includes(status),
        ) ||
        Boolean(runtimeState.paymentState?.paymentId || runtimeState.paymentState?.chargeId);
      const shouldRecoverPassengerCompletedRide =
        runtimeState.activeRole === "customer" &&
        Boolean(runtimeState.activeBookingId) &&
        normalizedLocalBookingStatus === "started" &&
        hasConfirmedPayment;
      if (shouldRecoverPassengerCompletedRide) {
        const receipt = buildReceiptFromSyncedSnapshot(
          {
            ...payload,
            bookingId: runtimeState.activeBookingId,
            status: "COMPLETED",
            hasActiveRide: false,
            source: payload?.source || "idle_sync_completion_recovery",
            authoritativeSnapshot: false,
          },
          runtimeState,
        );

        writeRuntimeDebugProbe("event_active_ride_sync_recovered_receipt", {
          bookingId: runtimeState.activeBookingId || null,
          localStatus: normalizedLocalBookingStatus,
          paymentStatus: runtimeState.paymentState?.status || null,
          source: payload?.source || null,
        });

        stopSearchingTimer();
        stopBoardingCountdownTimer();
        stopPassengerLocationHeartbeat();
        setRuntimeState({
          bookingStatus: "completed",
          activeBooking: null,
          activeBookingId: null,
          terminalRideGuards: mergeTerminalRideGuard(
            runtimeState.terminalRideGuards,
            runtimeState.activeBookingId,
            "completed",
          ),
          driverOffers: [],
          driverActiveRide: null,
          tripArrivalText: "",
          boardingDeadlineAt: null,
          boardingRemainingSec: 0,
          driverTripMeta: createDefaultDriverTripMeta(),
          tripIntegrityAlert: {
            active: false,
            reason: "",
            message: "",
            distanceMeters: null,
            thresholdMeters: null,
            confirmationTimeoutSec: null,
            updatedAt: null,
          },
          driverCoordinate: null,
          rideExtension: cloneDefaultRideExtensionState(),
          driverExtensionRequest: cloneDefaultDriverExtensionRequest(),
          operationalContinuation: cloneDefaultOperationalContinuation(),
          lastError: "",
        });
        pushTripHistoryItem(receipt);
        return;
      }

      const shouldPreserveActiveRideOnIdleSync =
        hasRuntimeActiveRideContext(runtimeState) &&
        payload?.hasActiveRide !== false &&
        !payload?.stale &&
        !(
          syncedBookingId &&
          runtimeState.activeBookingId &&
          syncedBookingId !== String(runtimeState.activeBookingId)
        ) &&
        !(
          payload?.forceClear === true ||
          payload?.authoritativeTerminal === true ||
          payload?.terminal === true ||
          payload?.reason === "terminal_sync" ||
          payload?.reason === "cancelled" ||
          payload?.reason === "completed"
        );

      if (shouldPreserveActiveRideOnIdleSync) {
        writeRuntimeDebugProbe("event_active_ride_sync_preserved_active_ride", {
          bookingId: runtimeState.activeBookingId || null,
          localStatus: normalizedLocalBookingStatus,
          source: payload?.source || null,
          reason: "idle_sync_without_terminal_authority",
        });
        return;
      }

      if (
        runtimeState.activeBookingId ||
        (runtimeState.activeRole === "driver" &&
          !runtimeState.driverActiveRide?.bookingId &&
          hasLocalPendingDriverOffer(runtimeState)) ||
        ["accepted", "arrived", "started", "searching"].includes(
          normalizedLocalBookingStatus,
        )
      ) {
        clearRuntimeRideStateFromSync();
      }
      return;
    }

    if (syncedStatus === "completed") {
      stopSearchingTimer();
      stopBoardingCountdownTimer();
      stopPassengerLocationHeartbeat();

      const receipt = buildReceiptFromSyncedSnapshot(payload, runtimeState);
      setRuntimeState({
        bookingStatus: "completed",
        activeBooking: null,
        activeBookingId: null,
        terminalRideGuards: mergeTerminalRideGuard(
          runtimeState.terminalRideGuards,
          payload?.bookingId || runtimeState.activeBookingId,
          "completed",
        ),
        driverOffers: [],
        driverActiveRide: null,
        tripArrivalText: "",
        boardingDeadlineAt: null,
        boardingRemainingSec: 0,
        driverTripMeta: createDefaultDriverTripMeta(),
        tripIntegrityAlert: {
          active: false,
          reason: "",
          message: "",
          distanceMeters: null,
          thresholdMeters: null,
          confirmationTimeoutSec: null,
          updatedAt: null,
        },
        driverCoordinate: null,
        rideExtension: cloneDefaultRideExtensionState(),
        driverExtensionRequest: cloneDefaultDriverExtensionRequest(),
        operationalContinuation: cloneDefaultOperationalContinuation(),
        lastError: "",
      });
      pushTripHistoryItem(receipt);
      return;
    }

    applySyncedActiveRideSnapshot(payload);
  };

  const handleBookingCreated = (payload) => {
    if (!payload?.success) {
      return;
    }
    writeRuntimeDebugProbe("event_booking_created", {
      bookingId: payload?.bookingId || payload?.data?.bookingId || null,
    });

    const bookingId =
      payload.bookingId ||
      payload?.data?.bookingId ||
      payload?.booking?.bookingId ||
      null;
    if (shouldIgnoreLifecycleRegression("bookingCreated", bookingId, "searching")) {
      return;
    }
    const serverBooking = payload?.booking || payload?.data || null;
    const nextActiveBooking =
      serverBooking && typeof serverBooking === "object"
        ? {
            ...(runtimeState.activeBooking &&
            typeof runtimeState.activeBooking === "object"
              ? runtimeState.activeBooking
              : {}),
            ...serverBooking,
            bookingId:
              bookingId ||
              serverBooking?.bookingId ||
              runtimeState.activeBookingId ||
              null,
            pickupLocation:
              serverBooking?.pickupLocation ||
              runtimeState.activeBooking?.pickupLocation ||
              null,
            destinationLocation:
              serverBooking?.destinationLocation ||
              runtimeState.activeBooking?.destinationLocation ||
              null,
          }
        : runtimeState.activeBooking;
    const selectedFare = Number(
      serverBooking?.estimatedFare || runtimeState.selectedFare || 0,
    );
    const destination = normalizeDestinationItem({
      name:
        runtimeState.selectedDestination?.name ||
        parseNameFromDescription(
          nextActiveBooking?.destinationLocation?.add || "",
        ),
      address:
        runtimeState.selectedDestination?.address ||
        nextActiveBooking?.destinationLocation?.add ||
        "",
    });
    const createdOffer = buildDriverOffer({
      bookingId,
      destination,
      fare: selectedFare,
      etaMinutes: runtimeState.tripDurationMin,
      pickupAddress:
        serverBooking?.pickupLocation?.add || runtimeState.currentAddress,
      pickupCoordinate: normalizeRuntimeCoordinate(serverBooking?.pickupLocation),
      preferences:
        serverBooking?.preferences ||
        payload?.preferences ||
        runtimeState.activeBooking?.preferences ||
        {},
      passengerName: runtimeState.profileName,
    });
    const bookingFeeBreakdown = extractPayloadFeeBreakdown(
      {
        ...(serverBooking || {}),
        ...(payload || {}),
      },
      { estimated: true },
    );
    const passengerPricingNotice =
      serverBooking?.pricingPayload?.passenger_notice ||
      payload?.pricingPayload?.passenger_notice ||
      null;

    setRuntimeState({
      bookingStatus: "searching",
      activeBookingId: bookingId,
      activeBooking: nextActiveBooking,
      selectedFare: Number.isFinite(selectedFare)
        ? selectedFare
        : runtimeState.selectedFare,
      driverOffers: mergeDriverOffers(
        runtimeState.driverOffers,
        bookingFeeBreakdown
          ? { ...createdOffer, ...bookingFeeBreakdown }
          : createdOffer,
      ),
      driverActiveRide: null,
      lastError: "",
      socketError: "",
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Corrida solicitada",
        message: "Estamos procurando motoristas próximos da sua localização.",
        kind: "trip",
        scope: "passenger",
      }),
    );
    if (passengerPricingNotice) {
      appendRuntimeNotification(
        createRuntimeNotification({
          title: "Tarifa dinâmica",
          message: passengerPricingNotice,
          kind: "info",
          scope: "passenger",
        }),
      );
    }
    startSearchingTimer({ preserveElapsed: true });
  };

  const handleBookingError = (payload) => {
    if (shouldIgnoreTransientBookingError(payload, runtimeState)) {
      writeRuntimeDebugProbe("event_booking_error_ignored", {
        bookingId: payload?.bookingId || null,
        code: payload?.code || null,
        message: payload?.message || payload?.error || null,
        bookingStatus: runtimeState.bookingStatus || null,
        paymentStatus: runtimeState.paymentState?.status || null,
      });
      return;
    }

    writeRuntimeDebugProbe("event_booking_error", {
      bookingId: payload?.bookingId || null,
      code: payload?.code || null,
      message: payload?.message || payload?.error || null,
    });
    const errorMessage =
      payload?.message || payload?.error || "Não foi possível criar a corrida";
    stopSearchingTimer();
    setRuntimeState({
      bookingStatus: "idle",
      activeBookingId: null,
      activeBooking: null,
      driverOffers: [],
      driverActiveRide: null,
      paymentState: {
        status: "failed",
        paymentId: null,
        amount: 0,
        method: runtimeState.paymentMethod || "pix",
        error: errorMessage,
        refundStatus: null,
        refundAmount: 0,
        cancellationFee: 0,
        refundId: null,
        chargeId: null,
      },
      lastError: errorMessage,
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Falha na solicitação",
        message: errorMessage,
        kind: "warning",
        scope: "passenger",
      }),
    );
  };

  const handleNoDriversFound = (payload) => {
    const runtimeRole = resolveRuntimeRole(runtimeState.profile);
    const currentBookingId = String(
      runtimeState.activeBookingId ||
        runtimeState.activeBooking?.bookingId ||
        runtimeState.activeBooking?.id ||
        "",
    ).trim();
    const payloadBookingId = String(payload?.bookingId || "").trim();
    const currentBookingStatus = String(runtimeState.bookingStatus || "")
      .trim()
      .toLowerCase();
    const searchCompatibleStatuses = new Set([
      "idle",
      "requesting",
      "searching",
      "searching_replacement",
    ]);

    if (runtimeRole === "driver") {
      writeRuntimeDebugProbe("event_no_drivers_found_ignored_driver", {
        payloadBookingId,
        currentBookingId,
        currentBookingStatus,
      });
      return;
    }

    if (payloadBookingId && currentBookingId && payloadBookingId !== currentBookingId) {
      writeRuntimeDebugProbe("event_no_drivers_found_ignored_stale", {
        payloadBookingId,
        currentBookingId,
        code: payload?.code || null,
        message: payload?.message || null,
      });
      return;
    }

    if (
      currentBookingId &&
      payloadBookingId &&
      payloadBookingId === currentBookingId &&
      !searchCompatibleStatuses.has(currentBookingStatus)
    ) {
      writeRuntimeDebugProbe("event_no_drivers_found_ignored_non_searching", {
        payloadBookingId,
        currentBookingId,
        currentBookingStatus,
        message: payload?.message || null,
      });
      return;
    }

    writeRuntimeDebugProbe("event_no_drivers_found", {
      bookingId: payload?.bookingId || null,
      code: payload?.code || null,
      message: payload?.message || null,
    });
    const noDriversMessage =
      payload?.message || "Nenhum motorista disponível no momento.";
    stopSearchingTimer();
    setRuntimeState({
      bookingStatus: "idle",
      searchingElapsedSeconds: 0,
      activeBookingId: null,
      activeBooking: null,
      driverOffers: [],
      driverActiveRide: null,
      paymentState: {
        status: "idle",
        paymentId: null,
        amount: 0,
        method: runtimeState.paymentMethod || "pix",
        error: "",
        refundStatus: null,
        refundAmount: 0,
        cancellationFee: 0,
        refundId: null,
        chargeId: null,
      },
      lastError: noDriversMessage,
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Sem motoristas",
        message: noDriversMessage,
        kind: "warning",
        scope: "passenger",
      }),
    );
  };

  const handleDriversFound = () => {
    setRuntimeState({
      bookingStatus: "searching",
      lastError: "",
    });
  };

  const handleNewRideRequest = (payload) => {
    const bookingId = payload?.bookingId || payload?.rideId || null;
    if (!bookingId) {
      return;
    }

    if (isBookingEventSuppressed(bookingId)) {
      writeRuntimeDebugProbe("event_new_ride_request_ignored_suppressed", {
        bookingId,
      });
      return;
    }

    writeRuntimeDebugProbe("event_new_ride_request", {
      bookingId,
      passengerId:
        payload?.customerId ||
        payload?.passengerId ||
        payload?.customer?.id ||
        payload?.passenger?.id ||
        null,
    });

    const destinationPayload = payload?.destinationLocation || {};
    const destination = normalizeDestinationItem({
      name: parseNameFromDescription(destinationPayload?.add || ""),
      address: destinationPayload?.add || "",
      coordinate:
        Number.isFinite(destinationPayload?.lat) &&
        Number.isFinite(destinationPayload?.lng)
          ? {
              latitude: Number(destinationPayload.lat),
              longitude: Number(destinationPayload.lng),
            }
          : null,
    });

    const estimatedFare = Number(
      payload?.estimatedFare ?? payload?.fare ?? runtimeState.selectedFare ?? 0,
    );
    const createdOffer = buildDriverOffer({
      bookingId,
      destination,
      fare: Number.isFinite(estimatedFare) ? estimatedFare : 0,
      etaMinutes: Number(
        payload?.estimatedArrivalToPickupMin ??
          payload?.etaMinutes ??
          runtimeState.tripDurationMin,
      ),
      pickupAddress:
        payload?.pickupLocation?.add || runtimeState.currentAddress,
      pickupCoordinate: normalizeRuntimeCoordinate(payload?.pickupLocation),
      preferences: payload?.preferences || {},
      passengerName:
        payload?.passengerName ||
        payload?.customerName ||
        (resolveRuntimeRole(runtimeState.profile) === "driver"
          ? "Passageiro Leaf"
          : runtimeState.profileName),
      passengerId:
        payload?.customerId ||
        payload?.passengerId ||
        payload?.customer?.id ||
        payload?.passenger?.id ||
        "",
    });
    const pickupCoordinate =
      Number.isFinite(Number(payload?.pickupLocation?.lat)) &&
      Number.isFinite(Number(payload?.pickupLocation?.lng))
        ? {
            latitude: Number(payload.pickupLocation.lat),
            longitude: Number(payload.pickupLocation.lng),
          }
        : null;
    const estimatedFeeBreakdown = extractPayloadFeeBreakdown(payload, {
      estimated: true,
    });
    const pricingSnapshotMetadata = extractPricingSnapshotMetadata(payload);
    const netPayoutFromPayload = Number(
      payload?.estimatedDriverNetAmount ??
        estimatedFeeBreakdown?.driverNetAmount,
    );
    const operationalContinuation =
      payload?.operationalContinuation &&
      typeof payload.operationalContinuation === "object"
        ? payload.operationalContinuation
        : null;
    const isOperationalContinuation =
      payload?.isOperationalContinuation === true ||
      String(payload?.rideMode || "")
        .trim()
        .toLowerCase() === "continuation" ||
      String(payload?.status || "")
        .trim()
        .toUpperCase() === "REASSIGNMENT_PENDING" ||
      Boolean(operationalContinuation);
    const offerWithPricing =
      Number.isFinite(netPayoutFromPayload) && netPayoutFromPayload >= 0
        ? {
            ...createdOffer,
            ...(pickupCoordinate ? { pickupCoordinate } : {}),
            ...(pricingSnapshotMetadata || {}),
            ...(isOperationalContinuation
              ? {
                  isOperationalContinuation: true,
                  continuationMessage:
                    payload?.continuationMessage ||
                    "Corrida em continuidade a partir do ponto de interrupção.",
                  previousDriverId:
                    payload?.previousDriverId ||
                    operationalContinuation?.interruptedByDriverId ||
                    null,
                  remainingReservedAmount:
                    Number(
                      payload?.remainingReservedAmount ??
                        operationalContinuation?.remainingReservedAmount ??
                        0,
                    ) || 0,
                }
              : {}),
            payout: formatCurrencyBR(netPayoutFromPayload),
            grossFare: Number.isFinite(estimatedFare) ? estimatedFare : 0,
          }
        : {
            ...createdOffer,
            ...(pickupCoordinate ? { pickupCoordinate } : {}),
            ...(pricingSnapshotMetadata || {}),
            ...(isOperationalContinuation
              ? {
                  isOperationalContinuation: true,
                  continuationMessage:
                    payload?.continuationMessage ||
                    "Corrida em continuidade a partir do ponto de interrupção.",
                  previousDriverId:
                    payload?.previousDriverId ||
                    operationalContinuation?.interruptedByDriverId ||
                    null,
                  remainingReservedAmount:
                    Number(
                      payload?.remainingReservedAmount ??
                        operationalContinuation?.remainingReservedAmount ??
                        0,
                    ) || 0,
                }
              : {}),
          };

    setRuntimeState((previous) => ({
      bookingStatus:
        previous.bookingStatus === "idle"
          ? "searching"
          : previous.bookingStatus,
      driverOffers: mergeDriverOffers(
        previous.driverOffers,
        estimatedFeeBreakdown
          ? { ...offerWithPricing, ...estimatedFeeBreakdown }
          : offerWithPricing,
      ),
      ...(resolveRuntimeRole(previous.profile || runtimeState.profile) ===
      "driver"
        ? {
            driverOnline: true,
            driverOnlinePending: false,
            driverOnlineMutationSource: "offer_received_online_confirmed",
          }
        : {}),
      lastError: "",
    }));

    appendRuntimeNotification(
      createRuntimeNotification({
        title: isOperationalContinuation
          ? "Corrida em continuidade"
          : "Nova solicitação",
        message: isOperationalContinuation
          ? "Um passageiro precisa continuar a viagem a partir do ponto de interrupção."
          : "Uma nova corrida está disponível para aceite.",
        kind: "trip",
        scope: "driver",
      }),
    );
  };

  const handleRideAccepted = async (payload) => {
    const bookingId =
      payload?.bookingId || runtimeState.activeBookingId || null;
    const runtimeRole = resolveRuntimeRole(runtimeState.profile);
    const payloadDriverId = String(
      payload?.driver?.id || payload?.driverId || "",
    ).trim();
    const currentProfileId = String(runtimeState.profile?.uid || "").trim();
    if (isBookingEventSuppressed(bookingId)) {
      writeRuntimeDebugProbe("event_ride_accepted_ignored_suppressed", {
        bookingId,
        driverId: payloadDriverId || null,
      });
      return;
    }

    if (shouldIgnoreLifecycleRegression("rideAccepted", bookingId, "accepted")) {
      return;
    }

    if (
      runtimeRole === "driver" &&
      bookingId &&
      payloadDriverId &&
      currentProfileId &&
      payloadDriverId !== currentProfileId
    ) {
      writeRuntimeDebugProbe("event_ride_accepted_ignored_other_driver", {
        bookingId,
        driverId: payloadDriverId,
        currentProfileId,
      });
      let didDismissOffer = false;
      setRuntimeState((previous) => {
        const result = dismissDriverOfferRuntimeState(previous, bookingId);
        didDismissOffer = result.didDismissOffer;
        return {
          ...result.patch,
          lastError: "",
        };
      });
      if (didDismissOffer) {
        showDriverTransientCard({
          type: "accepted_by_other_driver_competitive",
          bookingId,
          title: "Outro motorista aceitou a solicitação",
          message:
            "Essa oferta saiu do seu painel porque outro parceiro concluiu o aceite primeiro.",
        });
      }
      return;
    }

    if (shouldIgnoreDuplicateLifecycleEvent("rideAccepted", bookingId, "accepted")) {
      writeRuntimeDebugProbe("event_ride_accepted_ignored_duplicate", {
        bookingId,
        driverId: payloadDriverId || null,
      });
      return;
    }

    writeRuntimeDebugProbe("event_ride_accepted", {
      bookingId,
      driverId: payloadDriverId || null,
    });
    const driver = payload?.driver || {};
    const lat = Number(driver?.location?.lat || payload?.location?.lat);
    const lng = Number(driver?.location?.lng || payload?.location?.lng);
    const coordinate =
      Number.isFinite(lat) && Number.isFinite(lng)
        ? { latitude: lat, longitude: lng }
        : null;
    const routeOriginCoordinate =
      coordinate ||
      runtimeState.currentCoordinate ||
      runtimeState.driverCoordinate ||
      null;
    const etaToPickupMin = Number(
      payload?.estimatedArrivalToPickupMin ??
        payload?.etaMinutes ??
        payload?.estimatedArrivalMin,
    );
    const pickupCoordinate =
      Number.isFinite(Number(payload?.pickupLocation?.lat)) &&
      Number.isFinite(Number(payload?.pickupLocation?.lng))
        ? {
            latitude: Number(payload.pickupLocation.lat),
            longitude: Number(payload.pickupLocation.lng),
          }
        : null;
    const estimatedFeeBreakdown = extractPayloadFeeBreakdown(payload, {
      estimated: true,
    });
    const pricingSnapshotMetadata = extractPricingSnapshotMetadata(payload);
    const isDuplicateAcceptance =
      bookingId &&
      runtimeState.activeBookingId &&
      bookingId === runtimeState.activeBookingId &&
      ["accepted", "arrived", "started"].includes(runtimeState.bookingStatus);

    const matchedOffer =
      (runtimeState.driverOffers || []).find(
        (item) => (item.bookingId || item.id) === bookingId,
      ) || null;
    const destinationCoordinate = resolveDestinationCoordinateFromRide(
      matchedOffer || runtimeState.driverActiveRide,
      runtimeState.selectedDestination,
      runtimeState.activeBooking,
    );
    const acceptedRideBase =
      runtimeState.driverActiveRide ||
      matchedOffer ||
      buildDriverOffer({
        bookingId: bookingId || runtimeState.activeBookingId,
        destination: runtimeState.selectedDestination,
        fare: runtimeState.selectedFare,
        etaMinutes: runtimeState.tripDurationMin,
        pickupAddress: runtimeState.currentAddress,
        preferences:
          payload?.preferences || runtimeState.activeBooking?.preferences || {},
        passengerName:
          payload?.passengerName ||
          payload?.customerName ||
          matchedOffer?.passenger ||
          (runtimeRole === "driver" ? "Passageiro Leaf" : runtimeState.profileName),
        passengerId:
          payload?.customerId ||
          payload?.passengerId ||
          payload?.customer?.id ||
          payload?.passenger?.id ||
          matchedOffer?.passengerId ||
          runtimeState.activeBooking?.customerId ||
          resolvePassengerIdFromBookingId(bookingId || runtimeState.activeBookingId),
      });
    const acceptedRide = mergeLockedDriverRideSnapshot(acceptedRideBase, {
      ...(estimatedFeeBreakdown || {}),
      ...(pricingSnapshotMetadata || {}),
      ...(pickupCoordinate ? { pickupCoordinate } : {}),
      ...(destinationCoordinate ? { destinationCoordinate } : {}),
    });
    const acceptedRideFare = resolveDriverPayoutAmount(
      acceptedRide,
      runtimeState.driverTripMeta,
    );
    const acceptedRideExplicitPayout = resolveDriverExplicitPayoutAmount(
      acceptedRide,
      runtimeState.driverTripMeta,
    );
    const acceptedVehicleMake = sanitizeText(
      driver?.vehicle?.make ||
        driver?.vehicle?.brand ||
        payload?.vehicle?.make ||
        payload?.vehicle?.brand ||
        acceptedRide?.vehicleMake ||
        acceptedRide?.vehicleBrand ||
        acceptedRide?.make ||
        "",
      "",
    );
    const acceptedVehicleModel = sanitizeText(
      driver?.vehicle?.model ||
        payload?.vehicle?.model ||
        acceptedRide?.vehicleModel ||
        acceptedRide?.carModel ||
        acceptedRide?.model ||
        driver?.vehicle?.type ||
        driver?.vehicle?.category ||
        payload?.vehicle?.type ||
        payload?.vehicle?.category ||
        payload?.vehicleType ||
        payload?.vehicleCategory ||
        payload?.carType ||
        acceptedRide?.vehicleType ||
        acceptedRide?.vehicleCategory ||
        acceptedRide?.carType ||
        "",
      "",
    );
    const acceptedVehicleLabel = sanitizeText(
      [acceptedVehicleMake, acceptedVehicleModel].filter(Boolean).join(" "),
      "",
    );

    const isDriverRuntime = runtimeRole === "driver";
    const sharedRoutePlanFromPayload = extractDriverRoutePlan({
      routePlan: payload?.routePlan,
    });

    let pickupPreview = null;
    let liveRoutePlanResult = null;
    if (
      isDriverRuntime &&
      routeOriginCoordinate &&
      pickupCoordinate &&
      destinationCoordinate
    ) {
      liveRoutePlanResult = await buildLiveTripRoutePlan({
        origin: routeOriginCoordinate,
        pickup: pickupCoordinate,
        pickupAddress:
          payload?.pickupLocation?.add ||
          payload?.pickupLocation?.address ||
          runtimeState.currentAddress ||
          "Embarque",
        destination: destinationCoordinate,
        destinationLabel:
          acceptedRide?.dropoff ||
          runtimeState.selectedDestination?.name ||
          "Destino",
        destinationAddress:
          acceptedRide?.dropoffAddress ||
          payload?.destinationLocation?.add ||
          payload?.destinationLocation?.address ||
          runtimeState.selectedDestination?.address ||
          runtimeState.selectedDestination?.name ||
          "Destino",
        telemetryContext: resolveRuntimeRideTelemetryContext({
          bookingId: bookingId || runtimeState.activeBookingId,
          role: "driver",
          surface: "driver_live_route_prefetch",
        }),
      });
    } else if (sharedRoutePlanFromPayload) {
      liveRoutePlanResult = {
        routePlan: sharedRoutePlanFromPayload,
        pickupMetrics: {
          distanceKm: sharedRoutePlanFromPayload.pickupDistanceKm,
          durationMinutes: sharedRoutePlanFromPayload.pickupDurationMinutes,
          etaText: buildTripEtaText(
            sharedRoutePlanFromPayload.pickupDurationMinutes,
          ),
        },
        destinationMetrics: {
          distanceKm: sharedRoutePlanFromPayload.destinationDistanceKm,
          durationMinutes: sharedRoutePlanFromPayload.destinationDurationMinutes,
          etaText: buildTripEtaText(
            sharedRoutePlanFromPayload.destinationDurationMinutes,
          ),
        },
      };
    } else if (isDriverRuntime && routeOriginCoordinate && pickupCoordinate) {
      pickupPreview = await previewDriverPickupRoute({
        origin: routeOriginCoordinate,
        pickup: pickupCoordinate,
        pickupAddress:
          payload?.pickupLocation?.add ||
          payload?.pickupLocation?.address ||
          runtimeState.currentAddress ||
        "Embarque",
      });
    }
    const existingRoutePlan = resolveDriverRoutePlan({
      bookingId: bookingId || runtimeState.activeBookingId,
      driverTripMeta: runtimeState.driverTripMeta,
      pickupCoordinate,
      destinationCoordinate,
    });
    const persistedRoutePlan = ensurePersistedDriverRoutePlan({
      bookingId: bookingId || runtimeState.activeBookingId,
      pickupCoordinate,
      destinationCoordinate,
      routePlan: liveRoutePlanResult?.routePlan || existingRoutePlan,
      fallbackOriginCoordinate: isDriverRuntime ? routeOriginCoordinate : null,
    });
    const previewDistanceKm = Number(
      liveRoutePlanResult?.pickupMetrics?.distanceKm ?? pickupPreview?.distanceKm,
    );
    const previewDurationMinutes = Number(
      liveRoutePlanResult?.pickupMetrics?.durationMinutes ??
        pickupPreview?.durationMinutes,
    );
    const directPickupDistanceKm =
      !isDriverRuntime && routeOriginCoordinate && pickupCoordinate
        ? Number(
            (
              calculateDistanceMeters(routeOriginCoordinate, pickupCoordinate) /
              1000
            ).toFixed(1),
          )
        : null;
    const resolvedPickupDistanceKm =
      Number.isFinite(previewDistanceKm) && previewDistanceKm > 0
        ? previewDistanceKm
        : Number.isFinite(directPickupDistanceKm) && directPickupDistanceKm > 0
          ? directPickupDistanceKm
        : Number.isFinite(Number(runtimeState.tripDistanceKm))
          ? Number(runtimeState.tripDistanceKm)
          : null;
    const resolvedPickupDurationMin =
      Number.isFinite(previewDurationMinutes) && previewDurationMinutes > 0
        ? Math.max(1, Math.round(previewDurationMinutes))
        : Number.isFinite(etaToPickupMin) && etaToPickupMin > 0
          ? Math.max(1, Math.round(etaToPickupMin))
          : Number.isFinite(directPickupDistanceKm) && directPickupDistanceKm > 0
            ? Math.max(1, Math.round(directPickupDistanceKm))
          : Number.isFinite(Number(runtimeState.tripDurationMin))
            ? Math.max(1, Math.round(Number(runtimeState.tripDurationMin)))
            : null;
    const resolvedPickupArrivalText =
      liveRoutePlanResult?.pickupMetrics?.etaText ||
      pickupPreview?.etaText ||
      (Number.isFinite(resolvedPickupDurationMin) && resolvedPickupDurationMin > 0
        ? `Chegada estimada em ${resolvedPickupDurationMin} min`
        : runtimeState.tripArrivalText);
    const nextDriverTripMeta = {
      ...(runtimeState.driverTripMeta || {}),
      leg: "pickup",
      pickupAddress:
        acceptedRide?.pickup ||
        acceptedRide?.pickupAddress ||
        payload?.pickupLocation?.add ||
        payload?.pickupLocation?.address ||
        runtimeState.currentAddress ||
        "Local de embarque",
      destinationAddress:
        acceptedRide?.dropoffAddress ||
        acceptedRide?.dropoff ||
        payload?.destinationLocation?.add ||
        payload?.destinationLocation?.address ||
        runtimeState.selectedDestination?.address ||
        runtimeState.selectedDestination?.name ||
        "Destino",
      ...(pickupCoordinate ? { pickupCoordinate } : {}),
      ...(destinationCoordinate ? { destinationCoordinate } : {}),
      ...(Number.isFinite(resolvedPickupDistanceKm) &&
      resolvedPickupDistanceKm > 0
        ? { initialMeters: Math.round(resolvedPickupDistanceKm * 1000) }
        : {}),
      ...(Number.isFinite(resolvedPickupDurationMin) &&
      resolvedPickupDurationMin > 0
        ? { initialEtaMinutes: resolvedPickupDurationMin }
        : {}),
      ...(runtimeRole === "driver"
        ? {
            ...(Number.isFinite(acceptedRideFare)
              ? {
                  fare: acceptedRideFare,
                  fareLabel: formatCurrencyBR(acceptedRideFare),
                }
              : {}),
            ...(Number.isFinite(acceptedRideExplicitPayout)
              ? {
                  driverNetAmount: acceptedRideExplicitPayout,
                  estimatedDriverNetAmount: acceptedRideExplicitPayout,
                }
              : {}),
          }
        : {}),
      routePlan:
        persistedRoutePlan ||
        runtimeState.driverTripMeta?.routePlan ||
        null,
    };

    stopSearchingTimer();
    stopBoardingCountdownTimer();
    setRuntimeState({
      bookingStatus: "accepted",
      activeBookingId: bookingId || runtimeState.activeBookingId,
      driverInfo: {
        id: driver?.id || payload?.driverId || null,
        name: driver?.name || payload?.driverName || "Motorista",
        plate:
          driver?.vehicle?.plate ||
          payload?.vehicle?.plate ||
          acceptedRide?.vehiclePlate ||
          acceptedRide?.carPlate ||
          acceptedRide?.plate ||
          "",
        model:
          acceptedVehicleLabel ||
          acceptedVehicleModel ||
          "",
        rating: driver?.rating || payload?.rating || null,
      },
      tripDistanceKm:
        Number.isFinite(resolvedPickupDistanceKm) && resolvedPickupDistanceKm > 0
          ? resolvedPickupDistanceKm
          : runtimeState.tripDistanceKm,
      tripDurationMin:
        Number.isFinite(resolvedPickupDurationMin) && resolvedPickupDurationMin > 0
          ? resolvedPickupDurationMin
          : runtimeState.tripDurationMin,
      tripArrivalText: resolvedPickupArrivalText,
      boardingDeadlineAt: null,
      boardingRemainingSec: 0,
      tripIntegrityAlert: {
        active: false,
        reason: "",
        message: "",
        distanceMeters: null,
        thresholdMeters: null,
        confirmationTimeoutSec: null,
        updatedAt: null,
      },
      activeBooking:
        runtimeState.activeBooking &&
        typeof runtimeState.activeBooking === "object"
          ? {
              ...runtimeState.activeBooking,
              ...(payload?.pickupLocation
                ? { pickupLocation: payload.pickupLocation }
                : {}),
              ...(payload?.destinationLocation
                ? { destinationLocation: payload.destinationLocation }
                : {}),
              ...(payload?.estimatedFare
                ? { estimatedFare: Number(payload.estimatedFare) }
                : {}),
            }
          : runtimeState.activeBooking,
      driverOffers: (runtimeState.driverOffers || []).filter(
        (item) => (item.bookingId || item.id) !== bookingId,
      ),
      driverActiveRide: {
        ...acceptedRide,
        bookingId: bookingId || runtimeState.activeBookingId,
        status: "accepted",
      },
      driverCoordinate: routeOriginCoordinate || runtimeState.driverCoordinate,
      driverTripMeta: nextDriverTripMeta,
      ...(runtimeRole === "driver"
        ? {
            ...(routeOriginCoordinate
              ? { currentCoordinate: routeOriginCoordinate }
              : {}),
          }
        : {}),
      lastError: "",
    });
    if (!isDuplicateAcceptance) {
      appendRuntimeNotification(
        createRuntimeNotification({
          title: "Motorista a caminho",
          message:
            "Seu motorista aceitou a corrida e está indo para o embarque.",
          kind: "trip",
          scope: "passenger",
        }),
      );
    }
  };

  const handleRideRejected = (payload) => {
    const bookingId = String(payload?.bookingId || payload?.rideId || "").trim();
    if (!bookingId) {
      return;
    }

    let didDismissOffer = false;
    let clearedActiveBooking = false;

    setRuntimeState((previous) => {
      const result = dismissDriverOfferRuntimeState(previous, bookingId);
      didDismissOffer = result.didDismissOffer;
      clearedActiveBooking = result.clearedActiveBooking;
      return result.patch;
    });

    if (!didDismissOffer) {
      return;
    }

    if (clearedActiveBooking) {
      stopSearchingTimer();
      stopBoardingCountdownTimer();
    }

    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Recusa registrada",
        message:
          payload?.message ||
          payload?.reason ||
          "A oferta foi removida do seu painel.",
        kind: "driver",
        scope: "driver",
      }),
    );
  };

  const handleDriverArrived = (payload) => {
    const bookingId = String(
      payload?.bookingId ||
        payload?.rideId ||
        runtimeState.activeBookingId ||
        runtimeState.driverActiveRide?.bookingId ||
      "",
    ).trim();
    if (shouldIgnoreLifecycleRegression("driverArrived", bookingId, "arrived")) {
      return;
    }
    const alreadyArrivedForSameBooking =
      Boolean(bookingId) &&
      String(runtimeState.activeBookingId || "").trim() === bookingId &&
      String(runtimeState.bookingStatus || "").trim().toLowerCase() === "arrived";
    if (alreadyArrivedForSameBooking) {
      return;
    }
    if (shouldIgnoreDuplicateLifecycleEvent("driverArrived", bookingId, "arrived")) {
      return;
    }

    const configuredWindowSec = Number(payload?.boardingWindowSec || 120);
    const normalizedWindowSec = Math.max(
      30,
      Number.isFinite(configuredWindowSec)
        ? Math.round(configuredWindowSec)
        : 120,
    );
    const deadlineAt = payload?.boardingDeadlineAt
      ? new Date(payload.boardingDeadlineAt).toISOString()
      : new Date(Date.now() + normalizedWindowSec * 1000).toISOString();

    startBoardingCountdown(deadlineAt);
    const runtimeRole = resolveRuntimeRole(runtimeState.profile);
    setRuntimeState((previous) => ({
      bookingStatus: "arrived",
      tripArrivalText:
        runtimeRole === "driver"
          ? "Passageiro embarcando"
          : "Motorista chegou ao embarque",
      boardingDeadlineAt: deadlineAt,
      boardingRemainingSec: normalizedWindowSec,
      driverActiveRide:
        previous.driverActiveRide &&
        typeof previous.driverActiveRide === "object"
          ? {
              ...previous.driverActiveRide,
              status: "arrived",
            }
          : previous.driverActiveRide,
      driverTripMeta: {
        ...(previous.driverTripMeta || {}),
        leg: "boarding",
      },
      tripIntegrityAlert: {
        active: false,
        reason: "",
        message: "",
        distanceMeters: null,
        thresholdMeters: null,
        confirmationTimeoutSec: null,
        updatedAt: null,
      },
      lastError: "",
    }));
    if (runtimeRole !== "driver") {
      appendRuntimeNotification(
        createRuntimeNotification({
          title: "Motorista chegou",
          message:
            "Seu motorista está no embarque. Você tem até 2 minutos para embarcar.",
          kind: "trip",
          scope: "passenger",
        }),
      );
    }
  };

  const handleBoardingWindowExpired = (payload) => {
    stopSearchingTimer();
    stopBoardingCountdownTimer();
    stopPassengerLocationHeartbeat();
    setRuntimeState({
      bookingStatus: "idle",
      activeBooking: null,
      activeBookingId: null,
      driverOffers: [],
      driverActiveRide: null,
      driverInfo: null,
      driverCoordinate: null,
      driverTripMeta: createDefaultDriverTripMeta(),
      boardingDeadlineAt: null,
      boardingRemainingSec: 0,
      tripIntegrityAlert: {
        active: false,
        reason: "",
        message: "",
        distanceMeters: null,
        thresholdMeters: null,
        confirmationTimeoutSec: null,
        updatedAt: null,
      },
      tripArrivalText: "",
      lastError: payload?.message || "Tempo de embarque expirado.",
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Tempo de embarque expirou",
        message: payload?.message || "A corrida foi cancelada automaticamente.",
        kind: "warning",
        scope: "both",
      }),
    );
  };

  const handleTripStarted = async (payload) => {
    const bookingId = String(
      payload?.bookingId ||
        payload?.rideId ||
        runtimeState.activeBookingId ||
        runtimeState.driverActiveRide?.bookingId ||
      "",
    ).trim();
    if (shouldIgnoreLifecycleRegression("tripStarted", bookingId, "started")) {
      return;
    }
    const alreadyStartedForSameBooking =
      Boolean(bookingId) &&
      String(runtimeState.activeBookingId || "").trim() === bookingId &&
      String(runtimeState.bookingStatus || "").trim().toLowerCase() === "started";
    if (alreadyStartedForSameBooking) {
      return;
    }
    if (shouldIgnoreDuplicateLifecycleEvent("tripStarted", bookingId, "started")) {
      return;
    }

    writeRuntimeDebugProbe("event_trip_started", {
      bookingId: bookingId || runtimeState.activeBookingId || null,
      source:
        payload?.__source ||
        (payload?.rehydrated ? "active_ride_rehydrated" : "unknown"),
      rideId: payload?.rideId || null,
      payloadStatus: payload?.status || null,
      rehydrated: payload?.rehydrated === true,
      localBookingStatusBefore: runtimeState.bookingStatus || null,
      localActiveBookingIdBefore: runtimeState.activeBookingId || null,
      localDriverRideBookingIdBefore:
        runtimeState.driverActiveRide?.bookingId || null,
    });
    stopBoardingCountdownTimer();
    const pickupCoordinate = resolvePickupCoordinateFromRide(
      runtimeState.driverActiveRide,
      runtimeState.activeBooking,
    );
    const destinationCoordinate = resolveDestinationCoordinateFromRide(
      runtimeState.driverActiveRide,
      runtimeState.selectedDestination,
      runtimeState.activeBooking,
    );
    const movementOrigin =
      runtimeState.currentCoordinate || runtimeState.driverCoordinate || null;
    const storedRoutePlan = resolveDriverRoutePlan({
      bookingId:
        runtimeState.activeBookingId || runtimeState.driverActiveRide?.bookingId,
      driverTripMeta: runtimeState.driverTripMeta,
      pickupCoordinate,
      destinationCoordinate,
    });
    let destinationPreview = null;

    if (storedRoutePlan) {
      destinationPreview = applyRoutePlanToMap({
        routePlan: storedRoutePlan,
        phase: "destination",
        pickupCoordinate,
        pickupAddress:
          runtimeState.driverTripMeta?.pickupAddress ||
          runtimeState.driverActiveRide?.pickupAddress ||
          runtimeState.driverActiveRide?.pickup ||
          "Local de embarque",
        destinationCoordinate,
        destinationLabel:
          runtimeState.selectedDestination?.name ||
          runtimeState.driverActiveRide?.dropoff ||
          "Destino",
        destinationAddress:
          runtimeState.driverActiveRide?.dropoffAddress ||
          runtimeState.selectedDestination?.address ||
          runtimeState.selectedDestination?.name ||
          "Destino",
        fallbackOrigin: movementOrigin,
      });
    } else if (movementOrigin && pickupCoordinate && destinationCoordinate) {
      try {
        const routePlanResult = await buildLiveTripRoutePlan({
          origin: movementOrigin,
          pickup: pickupCoordinate,
          pickupAddress:
            runtimeState.driverTripMeta?.pickupAddress ||
            runtimeState.driverActiveRide?.pickupAddress ||
            runtimeState.driverActiveRide?.pickup ||
            "Local de embarque",
          destination: destinationCoordinate,
          destinationLabel:
            runtimeState.selectedDestination?.name ||
            runtimeState.driverActiveRide?.dropoff ||
            "Destino",
          destinationAddress:
            runtimeState.driverActiveRide?.dropoffAddress ||
            runtimeState.selectedDestination?.address ||
            runtimeState.selectedDestination?.name ||
            "Destino",
          telemetryContext: resolveRuntimeRideTelemetryContext({
            bookingId:
              runtimeState.activeBookingId || runtimeState.driverActiveRide?.bookingId,
            role: "driver",
            surface: "driver_live_route_prefetch",
          }),
        });
        const persistedRoutePlan = ensurePersistedDriverRoutePlan({
          bookingId:
            runtimeState.activeBookingId || runtimeState.driverActiveRide?.bookingId,
          pickupCoordinate,
          destinationCoordinate,
          routePlan: routePlanResult?.routePlan,
          fallbackOriginCoordinate: movementOrigin,
        });
        if (persistedRoutePlan) {
          destinationPreview = applyRoutePlanToMap({
            routePlan: persistedRoutePlan,
            phase: "destination",
            pickupCoordinate,
            pickupAddress:
              runtimeState.driverTripMeta?.pickupAddress ||
              runtimeState.driverActiveRide?.pickupAddress ||
              runtimeState.driverActiveRide?.pickup ||
              "Local de embarque",
            destinationCoordinate,
            destinationLabel:
              runtimeState.selectedDestination?.name ||
              runtimeState.driverActiveRide?.dropoff ||
              "Destino",
            destinationAddress:
              runtimeState.driverActiveRide?.dropoffAddress ||
              runtimeState.selectedDestination?.address ||
              runtimeState.selectedDestination?.name ||
              "Destino",
            fallbackOrigin: movementOrigin,
          }) || {
            distanceKm: routePlanResult?.destinationMetrics?.distanceKm ?? null,
            durationMinutes:
              routePlanResult?.destinationMetrics?.durationMinutes ?? null,
            etaText: routePlanResult?.destinationMetrics?.etaText || "",
          };
        }
      } catch (error) {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao aplicar rota do destino após início da viagem:",
          error?.message || error,
        );
      }
    }

    setRuntimeState({
      bookingStatus: "started",
      activeBookingId: bookingId || runtimeState.activeBookingId || null,
      boardingDeadlineAt: null,
      boardingRemainingSec: 0,
      tripIntegrityAlert: {
        active: false,
        reason: "",
        message: "",
        distanceMeters: null,
        thresholdMeters: null,
        confirmationTimeoutSec: null,
        updatedAt: null,
      },
      tripDistanceKm:
        Number.isFinite(Number(destinationPreview?.distanceKm)) &&
        Number(destinationPreview.distanceKm) > 0
          ? Number(destinationPreview.distanceKm)
          : runtimeState.tripDistanceKm,
      tripDurationMin:
        Number.isFinite(Number(destinationPreview?.durationMinutes)) &&
        Number(destinationPreview.durationMinutes) > 0
          ? Math.max(1, Math.round(Number(destinationPreview.durationMinutes)))
          : runtimeState.tripDurationMin,
      tripArrivalText: destinationPreview?.etaText || "",
      driverActiveRide: runtimeState.driverActiveRide
        ? {
            ...runtimeState.driverActiveRide,
            status: "started",
          }
        : runtimeState.driverActiveRide,
      driverTripMeta: {
        ...(runtimeState.driverTripMeta || {}),
        leg: "destination",
        initialMeters:
          Number.isFinite(Number(destinationPreview?.distanceKm)) &&
          Number(destinationPreview.distanceKm) > 0
            ? Math.round(Number(destinationPreview.distanceKm) * 1000)
            : runtimeState.driverTripMeta?.initialMeters,
        initialEtaMinutes:
          Number.isFinite(Number(destinationPreview?.durationMinutes)) &&
          Number(destinationPreview.durationMinutes) > 0
            ? Math.max(1, Math.round(Number(destinationPreview.durationMinutes)))
            : runtimeState.driverTripMeta?.initialEtaMinutes,
        routePlan:
          getCachedDriverRoutePlan({
            bookingId:
              runtimeState.activeBookingId || runtimeState.driverActiveRide?.bookingId,
            pickupCoordinate,
            destinationCoordinate,
          }) ||
          runtimeState.driverTripMeta?.routePlan ||
          null,
      },
      ...(resolveRuntimeRole(runtimeState.profile) === "driver" &&
      runtimeState.driverCoordinate
        ? { currentCoordinate: runtimeState.driverCoordinate }
        : {}),
      lastError: "",
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Viagem iniciada",
        message: "Seu trajeto foi iniciado.",
        kind: "trip",
        scope: "both",
      }),
    );
  };

  const handleDriverLocation = (payload) => {
    const lat = Number(
      payload?.location?.lat ??
        payload?.lat ??
        payload?.latitude ??
        payload?.driverLocation?.lat ??
        payload?.driverLocation?.latitude ??
        payload?.driverCoordinate?.lat ??
        payload?.driverCoordinate?.latitude,
    );
    const lng = Number(
      payload?.location?.lng ??
        payload?.lng ??
        payload?.longitude ??
        payload?.driverLocation?.lng ??
        payload?.driverLocation?.longitude ??
        payload?.driverCoordinate?.lng ??
        payload?.driverCoordinate?.longitude,
    );
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }
    const liveDriverHeading = normalizeHeading(
      payload?.location?.heading ??
        payload?.heading ??
        payload?.bearing ??
        payload?.course ??
        payload?.driverLocation?.heading ??
        payload?.driverLocation?.bearing ??
        payload?.driverCoordinate?.heading ??
        payload?.driverCoordinate?.bearing,
    );
    const liveDriverSpeed = Number(
      payload?.location?.speed ??
        payload?.speed ??
        payload?.speedMetersPerSecond ??
        payload?.driverLocation?.speed ??
        payload?.driverCoordinate?.speed,
    );

    const activeBookingId = String(
      runtimeState.activeBookingId ||
        runtimeState.activeBooking?.bookingId ||
        runtimeState.driverActiveRide?.bookingId ||
        "",
    ).trim();
    const payloadBookingId = String(
      payload?.bookingId || payload?.tripId || payload?.rideId || "",
    ).trim();
    if (
      payloadBookingId &&
      shouldIgnoreLifecycleRegression("driverLocation", payloadBookingId, "started")
    ) {
      return;
    }

    if (payloadBookingId && activeBookingId && payloadBookingId !== activeBookingId) {
      writeRuntimeDebugProbe("event_driver_location_ignored_stale_booking", {
        activeBookingId,
        payloadBookingId,
      });
      return;
    }

    const liveDriverCoordinate = {
      latitude: lat,
      longitude: lng,
      ...(Number.isFinite(liveDriverHeading)
        ? { heading: liveDriverHeading }
        : {}),
      ...(Number.isFinite(liveDriverSpeed) && liveDriverSpeed >= 0
        ? { speed: liveDriverSpeed }
        : {}),
    };
    const runtimeRole = resolveRuntimeRole(runtimeState.profile);
    setRuntimeState({
      ...(runtimeRole === "driver"
        ? {
            currentCoordinate: liveDriverCoordinate,
            ...(Number.isFinite(liveDriverHeading)
              ? { currentHeading: liveDriverHeading }
              : {}),
          }
        : {}),
      driverCoordinate: liveDriverCoordinate,
    });

    if (runtimeRole === "customer") {
      const incomingRoutePlan = extractDriverRoutePlan({
        routePlan: payload?.routePlan,
      });
      const pickupCoordinate =
        normalizeRuntimeCoordinate(payload?.pickupCoordinate) ||
        resolvePickupCoordinateFromRide(
          runtimeState.driverActiveRide,
          runtimeState.activeBooking,
        ) ||
        runtimeState.driverTripMeta?.pickupCoordinate;
      const destinationCoordinate =
        normalizeRuntimeCoordinate(payload?.destinationCoordinate) ||
        resolveDestinationCoordinateFromRide(
          runtimeState.driverActiveRide,
          runtimeState.selectedDestination,
          runtimeState.activeBooking,
        ) ||
        runtimeState.driverTripMeta?.destinationCoordinate;

      if (
        incomingRoutePlan &&
        (!payloadBookingId || !activeBookingId || payloadBookingId === activeBookingId)
      ) {
        cacheDriverRoutePlan({
          bookingId: payloadBookingId || activeBookingId || null,
          pickupCoordinate,
          destinationCoordinate,
          routePlan: incomingRoutePlan,
        });
      }

      const activeRoutePlan =
        resolveDriverRoutePlan({
          bookingId: payloadBookingId || activeBookingId || null,
          driverTripMeta: runtimeState.driverTripMeta,
          pickupCoordinate,
          destinationCoordinate,
        }) || incomingRoutePlan;

      if (
        activeRoutePlan &&
        (!payloadBookingId || !activeBookingId || payloadBookingId === activeBookingId)
      ) {
        const phaseFromPayload = String(payload?.routePlanPhase || "")
          .trim()
          .toLowerCase();
        const currentStatus = normalizeRuntimeLifecycleStatus(
          runtimeState.bookingStatus,
        );
        const phase =
          phaseFromPayload === "destination" || currentStatus === "started"
            ? "destination"
            : "pickup";

        syncPassengerActiveRoutePlan({
          routePlan: activeRoutePlan,
          phase,
          pickupCoordinate,
          pickupAddress:
            payload?.pickupAddress ||
            runtimeState.driverTripMeta?.pickupAddress ||
            runtimeState.activeBooking?.pickupLocation?.add ||
            runtimeState.currentAddress ||
            "",
          destinationCoordinate,
          destinationLabel:
            runtimeState.selectedDestination?.name ||
            parseNameFromDescription(payload?.destinationAddress || "Destino"),
          destinationAddress:
            payload?.destinationAddress ||
            runtimeState.driverTripMeta?.destinationAddress ||
            runtimeState.selectedDestination?.address ||
            runtimeState.activeBooking?.destinationLocation?.add ||
            "",
          liveDriverCoordinate,
        });
      }
    }
  };

  const handleTripCompleted = (payload) => {
    const completedBookingId = String(
      payload?.bookingId || runtimeState.activeBookingId || "",
    ).trim();
    if (
      completedBookingId &&
      hasTerminalRideGuard(completedBookingId) &&
      normalizeRuntimeLifecycleStatus(runtimeState.bookingStatus) === "completed"
    ) {
      if (hasAuthoritativeTripCompletedSnapshot(payload)) {
        const enrichedReceipt = buildReceiptFromSyncedSnapshot(
          payload,
          runtimeState,
        );
        pushTripHistoryItem(enrichedReceipt);
        writeRuntimeDebugProbe("event_trip_completed_enriched_terminal_receipt", {
          bookingId: completedBookingId,
          totalFees: enrichedReceipt?.totalFees ?? null,
          driverNetAmount: enrichedReceipt?.driverNetAmount ?? null,
          source: enrichedReceipt?.financialSnapshotSource || null,
        });
      }
      return;
    }
    clearDirectionsBudgetForBooking(completedBookingId);
    writeRuntimeDebugProbe("event_trip_completed", {
      bookingId:
        payload?.bookingId || runtimeState.activeBookingId || null,
      fare: payload?.fare ?? payload?.amount ?? null,
    });
    stopSearchingTimer();
    stopBoardingCountdownTimer();
    stopPassengerLocationHeartbeat();
    const shouldPreserveDriverOnlineAfterCompletion =
      resolveRuntimeRole(runtimeState.profile) === "driver" &&
      runtimeState.driverCanGoOnline !== false;

    const completedPricingSnapshot = resolveCompletedTripFinancialSnapshot(
      payload,
      runtimeState,
    );
    const finalFare = completedPricingSnapshot.finalFare;
    const receiptParticipants = resolveReceiptParticipants(payload);
    const completedRoute = getPrototypeMapRoute();
    const receiptPickupCoordinate =
      resolvePickupCoordinateFromRide(
        runtimeState.driverActiveRide,
        runtimeState.activeBooking,
      ) ||
      runtimeState.driverTripMeta?.pickupCoordinate ||
      null;
    const receiptDestinationCoordinate =
      resolveDestinationCoordinateFromRide(
        runtimeState.driverActiveRide,
        runtimeState.selectedDestination,
        runtimeState.activeBooking,
      ) ||
        runtimeState.driverTripMeta?.destinationCoordinate ||
        null;
    const receiptRouteCoordinates = resolveCompletedReceiptRouteCoordinates(
      completedRoute?.coordinates,
      receiptPickupCoordinate,
      receiptDestinationCoordinate,
    );
    const distance = resolveCompletedTripDistanceKm({
      payloadDistance: payload?.distance ?? payload?.distanceKm,
      runtimeDistance: runtimeState.tripDistanceKm,
      routeCoordinates: receiptRouteCoordinates,
      pickupCoordinate: receiptPickupCoordinate,
      destinationCoordinate: receiptDestinationCoordinate,
      initialMeters: runtimeState.driverTripMeta?.initialMeters,
    });
    const durationMinutes = resolveCompletedTripDurationMin({
      payloadDurationSeconds:
        payload?.duration ??
        payload?.durationSecs ??
        payload?.routeDurationSecs,
      runtimeDurationMinutes: runtimeState.tripDurationMin,
      routeDurationMinutes:
        runtimeState.driverTripMeta?.routePlan?.destinationDurationMinutes ??
        runtimeState.driverTripMeta?.initialEtaMinutes,
      distanceKm: distance,
    });

    const receipt = {
      pickupAddress: resolveCompletedReceiptPickupLabel(payload, runtimeState),
      destinationAddress: resolveCompletedReceiptDropoffLabel(
        payload,
        runtimeState,
      ),
      completedAt: new Date().toISOString(),
      id:
        payload?.bookingId ||
        runtimeState.activeBookingId ||
        `proto-${Date.now()}`,
      date: new Date().toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
      route: buildCompletedReceiptRouteLabel(payload, runtimeState),
      value: formatCurrencyBRL(finalFare),
      fare: finalFare,
      distanceKm: distance,
      durationMin: durationMinutes,
      paymentMethod:
        payload?.paymentMethod || runtimeState.paymentMethod || "pix",
      driverId: receiptParticipants.driverId || null,
      driverName: receiptParticipants.driverName || null,
      passengerId: receiptParticipants.passengerId || null,
      passengerName: receiptParticipants.passengerName || null,
      pickup: resolveCompletedReceiptPickupLabel(payload, runtimeState),
      drop: resolveCompletedReceiptDropoffLabel(payload, runtimeState),
      dropoffAddress: resolveCompletedReceiptDropoffLabel(payload, runtimeState),
      ...(payload?.pickupCoordinate
        ? { pickupCoordinate: payload.pickupCoordinate }
        : receiptPickupCoordinate
          ? { pickupCoordinate: receiptPickupCoordinate }
          : {}),
      ...(payload?.destinationCoordinate
        ? { destinationCoordinate: payload.destinationCoordinate }
        : receiptDestinationCoordinate
          ? { destinationCoordinate: receiptDestinationCoordinate }
          : {}),
      ...(receiptRouteCoordinates.length >= 2
        ? { routeCoordinates: receiptRouteCoordinates }
        : {}),
      ...(Array.isArray(payload?.rideLegs)
        ? { rideLegs: payload.rideLegs }
        : {}),
      ...(payload?.operationalContinuation
        ? { operationalContinuation: payload.operationalContinuation }
        : {}),
      ...completedPricingSnapshot,
    };

    setRuntimeState({
      bookingStatus: "completed",
      activeBooking: null,
      activeBookingId: null,
      terminalRideGuards: mergeTerminalRideGuard(
        runtimeState.terminalRideGuards,
        completedBookingId || payload?.bookingId,
        "completed",
      ),
      driverOffers: [],
      driverActiveRide: null,
      tripDistanceKm: receipt.distanceKm,
      tripDurationMin: receipt.durationMin,
      tripArrivalText: "",
      boardingDeadlineAt: null,
      boardingRemainingSec: 0,
      tripIntegrityAlert: {
        active: false,
        reason: "",
        message: "",
        distanceMeters: null,
        thresholdMeters: null,
        confirmationTimeoutSec: null,
        updatedAt: null,
      },
      driverInfo: runtimeState.driverInfo,
      driverCoordinate: null,
      rideExtension: cloneDefaultRideExtensionState(),
      driverExtensionRequest: cloneDefaultDriverExtensionRequest(),
      operationalContinuation: cloneDefaultOperationalContinuation(),
      ...(shouldPreserveDriverOnlineAfterCompletion
        ? {
            driverOnline: true,
            driverOnlinePending: false,
            driverOnlineMutationSource:
              "trip_completed_preserve_online_confirmed",
          }
        : {}),
      paymentState: {
        ...runtimeState.paymentState,
        ...(payload?.settlement?.estimatedRefund !== undefined
          ? {
              refundAmount: Number(payload.settlement.estimatedRefund || 0),
              refundStatus: "pending",
            }
          : {}),
      },
      lastError: "",
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Viagem concluída",
        message: "Confira seu recibo e avalie a experiência.",
        kind: "trip",
        scope: "both",
      }),
    );

    pushTripHistoryItem(receipt);
    clearPrototypeMapRoute();
  };

  const handleRideOperationalInterruption = (payload) => {
    const role = resolveRuntimeRole();
    const bookingId = payload?.bookingId || payload?.interruption?.bookingId;
    if (
      shouldIgnoreLifecycleRegression(
        "rideOperationalInterruption",
        bookingId,
        "operational_interrupted",
      )
    ) {
      return;
    }
    const message =
      payload?.message ||
      "A corrida foi interrompida e precisa da sua decisão para continuar.";

    setRuntimeState({
      operationalContinuation: buildOperationalContinuationState(payload, {
        status: "passenger_decision_pending",
        message,
      }),
      bookingStatus: "operational_interrupted",
      driverInfo: role === "customer" ? null : runtimeState.driverInfo,
      lastError: "",
    });

    appendRuntimeNotification(
      createRuntimeNotification({
        title:
          role === "customer"
            ? "Corrida interrompida"
            : "Interrupção registrada",
        message,
        kind: "warning",
        scope: role,
      }),
    );
  };

  const handleRideOperationalContinuationSearching = (payload) => {
    const bookingId = payload?.bookingId || payload?.interruption?.bookingId;
    if (
      shouldIgnoreLifecycleRegression(
        "rideOperationalContinuationSearching",
        bookingId,
        "searching_replacement",
      )
    ) {
      return;
    }
    const message =
      payload?.message ||
      "Estamos procurando outro motorista para continuar a corrida.";

    setRuntimeState({
      bookingStatus: "searching_replacement",
      operationalContinuation: buildOperationalContinuationState(payload, {
        status: "searching_replacement_driver",
        message,
      }),
      driverInfo: null,
      driverCoordinate: null,
      driverOffers: [],
      driverActiveRide: null,
      lastError: "",
    });

    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Buscando outro motorista",
        message,
        kind: "trip",
        scope: "passenger",
      }),
    );
  };

  const handleRideOperationalReleased = (payload) => {
    const bookingId = payload?.bookingId || payload?.interruption?.bookingId;
    if (
      shouldIgnoreLifecycleRegression("rideOperationalReleased", bookingId, "idle")
    ) {
      return;
    }
    const message =
      payload?.message || "A corrida seguirá com outro motorista parceiro.";

    setRuntimeState({
      bookingStatus: "idle",
      activeBookingId: null,
      driverActiveRide: null,
      driverOffers: [],
      operationalContinuation: cloneDefaultOperationalContinuation(),
      lastError: "",
    });

    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Corrida transferida",
        message,
        kind: "driver",
        scope: "driver",
      }),
    );
  };

  const handleRideCancelled = (payload) => {
    const cancelMessage = payload?.message || "Corrida cancelada.";
    const runtimeRole = resolveRuntimeRole();
    const cancelledBookingId = String(
      payload?.bookingId || payload?.rideId || runtimeState.activeBookingId || "",
    ).trim();
    clearDirectionsBudgetForBooking(cancelledBookingId);
    if (cancelledBookingId) {
      suppressBookingEvents(cancelledBookingId, "ride_cancelled");
    }
    const hadDriverOfferBeforeCancellation = Boolean(
      runtimeRole === "driver" &&
        Array.isArray(runtimeState.driverOffers) &&
        runtimeState.driverOffers.some(
          (item) => String(item?.bookingId || item?.id || "").trim() === cancelledBookingId,
        ) &&
        !runtimeState.driverActiveRide,
    );
    stopSearchingTimer();
    stopBoardingCountdownTimer();
    stopPassengerLocationHeartbeat();
    setRuntimeState((previous) => {
      const dismissResult = cancelledBookingId
        ? dismissDriverOfferRuntimeState(previous, cancelledBookingId)
        : {
            patch: null,
            clearedActiveBooking: false,
            clearedActiveRide: false,
          };

      return {
        ...(dismissResult.patch || {}),
        bookingStatus: "idle",
        activeBooking: null,
        activeBookingId: null,
        terminalRideGuards: mergeTerminalRideGuard(
          previous.terminalRideGuards,
          cancelledBookingId,
          "cancelled",
        ),
        driverOffers: [],
        driverActiveRide: null,
        driverTripMeta: createDefaultDriverTripMeta(),
        boardingDeadlineAt: null,
        boardingRemainingSec: 0,
        tripArrivalText: "",
        paymentState: {
          status: "idle",
          paymentId: null,
          amount: 0,
          method: previous.paymentMethod || "pix",
          error: "",
          refundStatus:
            payload?.data?.refundStatus || payload?.refundStatus || null,
          refundAmount: Number(
            payload?.data?.refundAmount || payload?.refundAmount || 0,
          ),
          cancellationFee: Number(
            payload?.data?.cancellationFee || payload?.cancellationFee || 0,
          ),
          refundId: payload?.data?.refundId || payload?.refundId || null,
          chargeId: payload?.data?.chargeId || payload?.chargeId || null,
        },
        rideExtension: cloneDefaultRideExtensionState(),
        driverExtensionRequest: cloneDefaultDriverExtensionRequest(),
        operationalContinuation: cloneDefaultOperationalContinuation(),
        driverInfo: null,
        driverCoordinate: null,
        tripIntegrityAlert: {
          active: false,
          reason: "",
          message: "",
          distanceMeters: null,
          thresholdMeters: null,
          confirmationTimeoutSec: null,
          updatedAt: null,
        },
        lastError: cancelMessage,
      };
    });
    if (hadDriverOfferBeforeCancellation) {
      showDriverTransientCard({
        type: "rider_cancelled_before_accept",
        bookingId: cancelledBookingId || null,
        title: "Passageiro cancelou a corrida",
        message:
          "Essa solicitação foi cancelada antes do seu aceite. Você já voltou para o mapa.",
      });
    }
    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Corrida cancelada",
        message: cancelMessage,
        kind: "warning",
        scope: "both",
      }),
    );
    clearPrototypeMapRoute();
  };

  const handleRideExtensionRequestAccepted = (payload) => {
    if (resolveRuntimeRole() !== "customer") {
      return;
    }

    setRuntimeState({
      rideExtension: buildRideExtensionState(payload, {
        status: "driver_decision_pending",
        error: "",
        message:
          payload?.message ||
          "Solicitação enviada. O motorista vai responder pelo app.",
      }),
      lastError: "",
    });

    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Alteração de destino solicitada",
        message:
          "O motorista recebeu o pedido. O complemento Pix aparece depois do aceite.",
        kind: "trip",
        scope: "passenger",
      }),
    );
  };

  const handleDriverExtensionApprovalRequested = (payload) => {
    if (resolveRuntimeRole() !== "driver") {
      return;
    }

    setRuntimeState({
      driverExtensionRequest: buildDriverExtensionRequest(payload, {
        status: "driver_decision_pending",
        error: "",
        message: payload?.message || "O passageiro solicitou um novo destino.",
      }),
      lastError: "",
    });

    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Novo destino solicitado",
        message: "Revise o complemento e aceite somente se quiser seguir.",
        kind: "driver",
        scope: "driver",
      }),
    );
  };

  const handleRideExtensionPaymentRequired = (payload) => {
    const message =
      payload?.message ||
      "Motorista aceitou. Pague o complemento Pix para confirmar o novo destino.";

    if (resolveRuntimeRole() === "customer") {
      setRuntimeState({
        rideExtension: buildRideExtensionState(payload, {
          status: "pending_payment",
          error: "",
          message,
        }),
        lastError: "",
      });

      appendRuntimeNotification(
        createRuntimeNotification({
          title: "Complemento Pix disponível",
          message,
          kind: "trip",
          scope: "passenger",
        }),
      );
      return;
    }

    if (resolveRuntimeRole() === "driver") {
      setRuntimeState({
        driverExtensionRequest: buildDriverExtensionRequest(payload, {
          status: "pending_payment",
          error: "",
          message: "Pagamento do complemento pendente.",
        }),
        lastError: "",
      });
    }
  };

  const handleRideExtensionRejected = (payload) => {
    const role = resolveRuntimeRole();
    const message =
      payload?.message || "A alteração de destino não foi aprovada.";

    if (role === "driver") {
      setRuntimeState({
        driverExtensionRequest: cloneDefaultDriverExtensionRequest({
          status: "rejected",
          bookingId: payload?.bookingId || runtimeState.activeBookingId || null,
          error: message,
          message,
        }),
        lastError: "",
      });
    } else {
      setRuntimeState({
        rideExtension: cloneDefaultRideExtensionState({
          status: "rejected",
          bookingId: payload?.bookingId || runtimeState.activeBookingId || null,
          error: message,
          message,
        }),
        lastError: "",
      });
    }

    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Alteração não aprovada",
        message,
        kind: "warning",
        scope: role === "driver" ? "driver" : "passenger",
      }),
    );
  };

  const handleRideExtensionConfirmed = (payload) => {
    const destination = normalizeExtensionDestination(
      payload?.destinationLocation ||
        payload?.newEndLocation ||
        runtimeState.selectedDestination,
    );
    const newFare = Number(payload?.newFare || runtimeState.selectedFare || 0);

    setRuntimeState((previous) => ({
      selectedDestination: destination?.coordinate
        ? destination
        : previous.selectedDestination,
      selectedFare:
        Number.isFinite(newFare) && newFare > 0
          ? newFare
          : previous.selectedFare,
      activeBooking:
        previous.activeBooking && typeof previous.activeBooking === "object"
          ? {
              ...previous.activeBooking,
              ...(destination?.coordinate
                ? {
                    destinationLocation: {
                      lat: destination.coordinate.latitude,
                      lng: destination.coordinate.longitude,
                      add: destination.address || destination.name,
                    },
                  }
                : {}),
              ...(Number.isFinite(newFare) && newFare > 0
                ? { estimatedFare: newFare }
                : {}),
            }
          : previous.activeBooking,
      driverActiveRide:
        previous.driverActiveRide &&
        typeof previous.driverActiveRide === "object"
          ? {
              ...previous.driverActiveRide,
              ...(destination?.name ? { dropoff: destination.name } : {}),
              ...(destination?.address
                ? { dropoffAddress: destination.address }
                : {}),
              ...(destination?.coordinate
                ? { destinationCoordinate: destination.coordinate }
                : {}),
              ...(Number.isFinite(newFare) && newFare > 0
                ? { fare: newFare }
                : {}),
            }
          : previous.driverActiveRide,
      driverTripMeta: {
        ...(previous.driverTripMeta || {}),
        ...(destination?.address
          ? { destinationAddress: destination.address }
          : {}),
        ...(destination?.coordinate
          ? { destinationCoordinate: destination.coordinate }
          : {}),
        ...(Number.isFinite(newFare) && newFare > 0
          ? {
              fare: newFare,
              fareLabel: formatCurrencyBR(newFare),
            }
          : {}),
      },
      rideExtension: buildRideExtensionState(payload, {
        status: "confirmed",
        destination,
        error: "",
        message: payload?.message || "Novo destino confirmado.",
      }),
      driverExtensionRequest: cloneDefaultDriverExtensionRequest({
        status: "confirmed",
        bookingId: payload?.bookingId || previous.activeBookingId || null,
        destination,
        newFare: Number.isFinite(newFare) && newFare > 0 ? newFare : 0,
        diffFare: Number(payload?.diffFare || 0) || 0,
        message: payload?.message || "Novo destino confirmado.",
      }),
      lastError: "",
    }));

    if (destination?.coordinate) {
      if (resolveRuntimeRole() === "driver") {
        previewDriverDestinationRoute({
          origin:
            runtimeState.currentCoordinate ||
            runtimeState.driverCoordinate ||
            getOriginCoordinate(),
          destination: destination.coordinate,
          destinationLabel: destination.name || "Destino",
          destinationAddress:
            destination.address || destination.name || "Destino",
        }).catch((error) => {
          Logger.warn(
            "⚠️ [PrototypeRuntime] Falha ao atualizar rota do motorista após extensão:",
            error?.message || error,
          );
        });
      } else {
        previewDestinationOnMap(destination).catch((error) => {
          Logger.warn(
            "⚠️ [PrototypeRuntime] Falha ao atualizar rota do passageiro após extensão:",
            error?.message || error,
          );
        });
      }
    }

    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Novo destino confirmado",
        message: payload?.message || "A corrida foi atualizada com sucesso.",
        kind: "trip",
        scope: resolveRuntimeRole() === "driver" ? "driver" : "passenger",
      }),
    );
  };

  const handleRideExtensionExpired = (payload) => {
    const role = resolveRuntimeRole();
    const message =
      payload?.message ||
      "O tempo para pagamento do complemento expirou. Seguiremos com o destino original.";

    if (role === "driver") {
      setRuntimeState({
        driverExtensionRequest: cloneDefaultDriverExtensionRequest({
          status: "expired",
          bookingId: payload?.bookingId || runtimeState.activeBookingId || null,
          chargeId: payload?.chargeId || null,
          expiresAt: payload?.expiresAt || null,
          expiredAt: payload?.expiredAt || null,
          error: message,
          message,
        }),
        lastError: "",
      });
    } else {
      setRuntimeState({
        rideExtension: cloneDefaultRideExtensionState({
          status: "expired",
          bookingId: payload?.bookingId || runtimeState.activeBookingId || null,
          chargeId: payload?.chargeId || null,
          expiresAt: payload?.expiresAt || null,
          expiredAt: payload?.expiredAt || null,
          error: message,
          message,
        }),
        lastError: "",
      });
    }

    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Complemento Pix expirado",
        message,
        kind: "warning",
        scope: role === "driver" ? "driver" : "passenger",
      }),
    );
  };

  const handleRideExtensionError = (payload) => {
    const role = resolveRuntimeRole();
    const message =
      payload?.error ||
      payload?.message ||
      "Não foi possível processar a alteração de destino.";

    if (role === "driver") {
      setRuntimeState({
        driverExtensionRequest: cloneDefaultDriverExtensionRequest({
          status: "error",
          bookingId: payload?.bookingId || runtimeState.activeBookingId || null,
          error: message,
          message,
        }),
        lastError: message,
      });
      return;
    }

    setRuntimeState({
      rideExtension: cloneDefaultRideExtensionState({
        status: "error",
        bookingId: payload?.bookingId || runtimeState.activeBookingId || null,
        error: message,
        message,
      }),
      lastError: message,
    });
  };

  const handlePaymentConfirmed = (payload) => {
    setRuntimeState((previous) => ({
      paymentState: {
        ...previous.paymentState,
        status: "confirmed",
        error: "",
      },
      rideExtension:
        previous.rideExtension?.chargeId &&
        String(previous.rideExtension.chargeId) ===
          String(payload?.chargeId || "")
          ? {
              ...previous.rideExtension,
              status: "confirming",
              error: "",
              message: "Pagamento confirmado. Atualizando o novo destino...",
            }
          : previous.rideExtension,
      lastError: "",
    }));
  };

  const handlePaymentRefunded = (payload) => {
    const refundAmount = Number(payload?.refundAmount || 0);
    const cancellationFee = Number(payload?.cancellationFee || 0);
    setRuntimeState((previous) => ({
      paymentState: {
        ...previous.paymentState,
        status: "refunded",
        error: "",
        refundStatus: payload?.refundStatus || null,
        refundAmount: Number.isFinite(refundAmount) ? refundAmount : 0,
        cancellationFee: Number.isFinite(cancellationFee) ? cancellationFee : 0,
        refundId: payload?.refundId || null,
        chargeId: payload?.chargeId || previous.paymentState?.chargeId || null,
      },
      lastError: "",
    }));
    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Estorno atualizado",
        message:
          payload?.refundStatus === "REFUNDED"
            ? `Estorno de R$ ${Number.isFinite(refundAmount) ? refundAmount.toFixed(2).replace(".", ",") : "0,00"} processado.`
            : "Atualizamos o status do estorno da sua corrida.",
        kind: "system",
        scope: "passenger",
      }),
    );
  };

  const handleTripIntegrityCheckRequired = (payload) => {
    const eventBookingId = payload?.bookingId || null;
    if (
      eventBookingId &&
      runtimeState.activeBookingId &&
      eventBookingId !== runtimeState.activeBookingId
    ) {
      return;
    }

    const distanceMeters = Number(payload?.distanceMeters);
    const thresholdMeters = Number(payload?.thresholdMeters);
    const confirmationTimeoutSec = Number(payload?.confirmationTimeoutSec);

    setRuntimeState({
      tripIntegrityAlert: {
        active: true,
        reason: String(payload?.reason || "TRIP_INTEGRITY_DISTANCE_DIVERGENCE"),
        message:
          payload?.message ||
          "Detectamos divergência de localização. Confirme se você embarcou corretamente.",
        distanceMeters: Number.isFinite(distanceMeters) ? distanceMeters : null,
        thresholdMeters: Number.isFinite(thresholdMeters)
          ? thresholdMeters
          : null,
        confirmationTimeoutSec: Number.isFinite(confirmationTimeoutSec)
          ? confirmationTimeoutSec
          : null,
        updatedAt: new Date().toISOString(),
      },
    });

    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Confirmação de embarque",
        message:
          payload?.message ||
          "Detectamos divergência de localização. Confirme seu embarque no app.",
        kind: "warning",
        scope: "both",
      }),
    );
  };

  const handleTripIntegrityCancelled = (payload) => {
    stopSearchingTimer();
    stopBoardingCountdownTimer();
    stopPassengerLocationHeartbeat();
    setRuntimeState({
      bookingStatus: "idle",
      activeBooking: null,
      activeBookingId: null,
      driverOffers: [],
      driverActiveRide: null,
      driverInfo: null,
      driverCoordinate: null,
      boardingDeadlineAt: null,
      boardingRemainingSec: 0,
      tripArrivalText: "",
      tripIntegrityAlert: {
        active: false,
        reason: "",
        message: "",
        distanceMeters: null,
        thresholdMeters: null,
        confirmationTimeoutSec: null,
        updatedAt: null,
      },
      lastError:
        payload?.message ||
        "Corrida cancelada por inconsistência de localização.",
    });
  };

  const handleBoardingStatusConfirmed = (payload) => {
    if (payload?.boarding !== false && payload?.boarded !== false) {
      setRuntimeState({
        tripIntegrityAlert: {
          active: false,
          reason: "",
          message: "",
          distanceMeters: null,
          thresholdMeters: null,
          confirmationTimeoutSec: null,
          updatedAt: new Date().toISOString(),
        },
      });
      return;
    }
    setRuntimeState({
      tripIntegrityAlert: {
        active: false,
        reason: "",
        message: "",
        distanceMeters: null,
        thresholdMeters: null,
        confirmationTimeoutSec: null,
        updatedAt: new Date().toISOString(),
      },
    });
  };

  const handleDriverDocumentStatusUpdated = (payload) => {
    const documentType = String(payload?.documentType || "")
      .trim()
      .toLowerCase();
    const nextStatus = String(payload?.status || "")
      .trim()
      .toLowerCase();
    if (!documentType) {
      return;
    }

    setRuntimeState((previous) => {
      const byType = previous?.documentAnalysisState?.byType || {};
      return {
        documentAnalysisState: {
          byType: {
            ...byType,
            [documentType]: {
              ...(byType[documentType] || {}),
              documentType,
              status: nextStatus || "pending",
              reason: payload?.reason || "",
              updatedAt: payload?.updatedAt || new Date().toISOString(),
            },
          },
          lastSyncedAt: payload?.updatedAt || new Date().toISOString(),
        },
      };
    });

    if (documentType === "background_check_consent") {
      return;
    }

    const currentProfile = runtimeState?.profileUid
      ? { uid: runtimeState.profileUid, userType: "driver", usertype: "driver" }
      : null;
    if (currentProfile?.uid) {
      syncDriverActivationWithProfile(currentProfile, {
        source: "socket_document_status",
      }).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao sincronizar ativação após evento de documento:",
          error?.message || error,
        );
      });
    }
  };

  const handleDriverStatusUpdated = (payload) => {
    if (resolveRuntimeRole() !== "driver") {
      return;
    }

    if (isRuntimeQALockActive()) {
      writeRuntimeDebugProbe("driver_status_updated_ignored_qa_lock", {
        driverId:
          payload?.driverId || payload?.uid || runtimeState?.profileUid || null,
        status: payload?.status || payload?.driverStatus || payload?.state || null,
        isOnline:
          typeof payload?.isOnline === "boolean" ? payload.isOnline : null,
        lockUntil: runtimeQALockUntil,
      });
      return;
    }

    const normalizedStatus = String(
      payload?.status || payload?.driverStatus || payload?.state || "",
    )
      .trim()
      .toLowerCase();

    const explicitOnline = payload?.isOnline;
    let nextOnline = null;

    if (typeof explicitOnline === "boolean") {
      nextOnline = explicitOnline;
    } else if (normalizedStatus) {
      if (
        ["available", "online", "busy", "on_trip", "on-trip"].includes(
          normalizedStatus,
        )
      ) {
        nextOnline = true;
      } else if (
        ["offline", "inactive", "paused", "unavailable"].includes(
          normalizedStatus,
        )
      ) {
        nextOnline = false;
      }
    }

    if (nextOnline === null) {
      return;
    }

    const shouldIgnoreTransientOfflineBootstrap =
      nextOnline === false &&
      Boolean(runtimeState.driverOnline) &&
      !runtimeState.driverActiveRide?.bookingId &&
      Date.now() - runtimeLastSocketConnectAt < 12000 &&
      [
        "bootstrap_restore_online_intent",
        "bootstrap_restore_online_confirmed",
        "bootstrap_promote_stale_online_pending",
        "socket_disconnect_preserve_online_intent",
        "trip_completed_preserve_online_intent",
        "enable_online_pending",
      ].includes(String(runtimeState.driverOnlineMutationSource || ""));

    if (shouldIgnoreTransientOfflineBootstrap) {
      writeRuntimeDebugProbe("driver_status_offline_ignored_bootstrap", {
        driverId:
          payload?.driverId || payload?.uid || runtimeState?.profileUid || null,
        status: normalizedStatus || null,
        isOnline: nextOnline,
        ready: payload?.ready === true,
      });
      return;
    }

    writeRuntimeDebugProbe("driver_status_updated_event", {
      driverId:
        payload?.driverId || payload?.uid || runtimeState?.profileUid || null,
      status: normalizedStatus || null,
      isOnline: nextOnline,
      ready: payload?.ready === true,
    });

    setRuntimeState({
      driverOnline: nextOnline,
      driverOnlinePending: false,
      driverOnlineMutationSource: nextOnline
        ? "socket_status_online"
        : "socket_status_offline",
      ...(nextOnline ? { lastError: "" } : {}),
    });
  };

  const handleDriverStatusError = (payload) => {
    if (resolveRuntimeRole() !== "driver") {
      return;
    }

    if (isRuntimeQALockActive()) {
      writeRuntimeDebugProbe("driver_status_error_ignored_qa_lock", {
        driverId:
          payload?.driverId || payload?.uid || runtimeState?.profileUid || null,
        code: payload?.code || null,
        reason: payload?.reason || null,
        message: payload?.message || payload?.error || null,
        lockUntil: runtimeQALockUntil,
      });
      return;
    }

    const message =
      payload?.message ||
      payload?.error ||
      "Falha ao atualizar status do motorista.";

    writeRuntimeDebugProbe("driver_status_error_event", {
      driverId:
        payload?.driverId || payload?.uid || runtimeState?.profileUid || null,
      code: payload?.code || null,
      reason: payload?.reason || null,
      message,
      retryAfterSec: Number(payload?.retryAfterSec || 0) || null,
    });

    const normalizedErrorCode = String(payload?.code || payload?.reason || "")
      .trim()
      .toLowerCase();
    const shouldForceOffline =
      Boolean(payload?.eligibilityRequired) ||
      Boolean(payload?.subscriptionRequired) ||
      Boolean(payload?.kycRequired) ||
      Boolean(payload?.blocked) ||
      [
        "drivernoteligible",
        "driver_not_eligible",
        "vehicle_required",
        "vehicle_lock_failed",
        "vehicle_lock_error",
        "location_required",
        "online_not_ready",
        "kycrequired",
        "kyccheckfailed",
        "subscription_required",
      ].includes(normalizedErrorCode);

    setRuntimeState({
      lastError: String(message),
      ...(runtimeState.driverOnlinePending || shouldForceOffline
        ? {
            driverOnline: false,
            driverOnlinePending: false,
            driverOnlineMutationSource: shouldForceOffline
              ? "socket_status_forced_offline_error"
              : "socket_status_error",
          }
        : {}),
    });
  };

  socket.on("connect", handleConnect);
  socket.on("disconnect", handleDisconnect);
  socket.on("sessionTerminated", handleSessionTerminated);
  socket.on("connect_error", handleConnectError);
  socket.on("authenticated", handleAuthenticated);
  socket.on("activeRideSync", handleActiveRideSync);
  socket.on("bookingCreated", handleBookingCreated);
  socket.on("newRideRequest", handleNewRideRequest);
  socket.on("bookingError", handleBookingError);
  socket.on("driversFound", handleDriversFound);
  socket.on("noDriversFound", handleNoDriversFound);
  socket.on("rideAccepted", handleRideAccepted);
  socket.on("driverAccepted", handleRideAccepted);
  socket.on("rideRejected", handleRideRejected);
  socket.on("driverArrived", handleDriverArrived);
  socket.on("arrivedAtPickup", handleDriverArrived);
  socket.on("boardingWindowExpired", handleBoardingWindowExpired);
  socket.on("tripStarted", handleTripStarted);
  socket.on("driverLocation", handleDriverLocation);
  socket.on("tripCompleted", handleTripCompleted);
  socket.on("rideCancelled", handleRideCancelled);
  socket.on("tripIntegrityCheckRequired", handleTripIntegrityCheckRequired);
  socket.on("tripIntegrityCancelled", handleTripIntegrityCancelled);
  socket.on("boardingStatusConfirmed", handleBoardingStatusConfirmed);
  socket.on("rideExtensionRequestAccepted", handleRideExtensionRequestAccepted);
  socket.on(
    "rideExtensionApprovalRequested",
    handleDriverExtensionApprovalRequested,
  );
  socket.on("rideExtensionPaymentRequired", handleRideExtensionPaymentRequired);
  socket.on("rideExtensionPendingPayment", handleRideExtensionPaymentRequired);
  socket.on("rideExtensionRejected", handleRideExtensionRejected);
  socket.on("rideExtensionExpired", handleRideExtensionExpired);
  socket.on("rideExtensionConfirmed", handleRideExtensionConfirmed);
  socket.on("rideExtensionError", handleRideExtensionError);
  socket.on("rideExtensionResponseError", handleRideExtensionError);
  socket.on("rideOperationalInterruption", handleRideOperationalInterruption);
  socket.on("rideOperationalInterrupted", handleRideOperationalInterruption);
  socket.on(
    "rideOperationalContinuationSearching",
    handleRideOperationalContinuationSearching,
  );
  socket.on("rideOperationalReleased", handleRideOperationalReleased);
  socket.on("paymentConfirmed", handlePaymentConfirmed);
  socket.on("paymentRefunded", handlePaymentRefunded);
  socket.on("driverDocumentStatusUpdated", handleDriverDocumentStatusUpdated);
  socket.on("driverStatusUpdated", handleDriverStatusUpdated);
  socket.on("driver_status_updated", handleDriverStatusUpdated);
  socket.on("driverStatusChanged", handleDriverStatusUpdated);
  socket.on("driverStatusError", handleDriverStatusError);

  runtimeSocketListenersAttached = true;
}

function attachChatListeners() {
  if (runtimeChatListenersAttached) {
    return;
  }

  const socket = WebSocketManager.getInstance();

  const handleIncomingMessage = (payload) => {
    const incomingChatId = payload?.chatId || payload?.bookingId || null;
    if (!incomingChatId) {
      return;
    }

    if (!runtimeState.activeChatId && !runtimeState.activeChatBookingId) {
      return;
    }

    if (
      runtimeState.activeChatId &&
      incomingChatId !== runtimeState.activeChatId &&
      incomingChatId !== runtimeState.activeChatBookingId
    ) {
      return;
    }

    const normalized = normalizeChatMessage(payload);
    if (!normalized.text) {
      return;
    }

    setRuntimeState((previous) => ({
      chatMessages: mergeChatMessages(previous.chatMessages, [normalized]),
      chatError: "",
    }));
  };

  socket.on("newMessage", handleIncomingMessage);
  socket.on("messageReceived", handleIncomingMessage);
  runtimeChatListenersAttached = true;
}

function applySyncedActiveRideSnapshot(snapshot) {
  if (!snapshot?.success) {
    return false;
  }

  const runtimeRole = resolveRuntimeRole(runtimeState.profile);
  const normalizedStatus = String(snapshot.status || "").toUpperCase();
  const bookingStatus = resolveSyncedBookingStatus(snapshot);
  if (bookingStatus === "idle") {
    return false;
  }
  if (
    shouldIgnoreLifecycleRegression(
      "applySyncedActiveRideSnapshot",
      snapshot?.bookingId,
      bookingStatus,
    )
  ) {
    return false;
  }
  const { fingerprint, skip } = shouldSkipSyncedActiveRideSnapshot(
    snapshot,
    bookingStatus,
  );
  if (skip) {
    return false;
  }

  const destination = normalizeDestinationItem({
    name: parseNameFromDescription(snapshot?.destinationLocation?.add || ""),
    address: snapshot?.destinationLocation?.add || "",
    coordinate:
      Number.isFinite(snapshot?.destinationLocation?.lat) &&
      Number.isFinite(snapshot?.destinationLocation?.lng)
        ? {
            latitude: Number(snapshot.destinationLocation.lat),
            longitude: Number(snapshot.destinationLocation.lng),
          }
        : null,
  });

  const pickupAddress = String(
    snapshot?.pickupLocation?.add || runtimeState.currentAddress || "",
  ).trim();
  const fare = Number(
    snapshot?.finalFare ??
      snapshot?.estimatedFare ??
      runtimeState.selectedFare ??
      runtimeState.activeBooking?.estimatedFare ??
      0,
  );
  const driverCoordinate =
    Number.isFinite(snapshot?.driverLocation?.lat) &&
    Number.isFinite(snapshot?.driverLocation?.lng)
      ? {
          latitude: Number(snapshot.driverLocation.lat),
          longitude: Number(snapshot.driverLocation.lng),
        }
      : runtimeState.driverCoordinate;
  const syncedOperationalContinuation =
    snapshot?.operationalContinuation &&
    typeof snapshot.operationalContinuation === "object"
      ? buildOperationalContinuationState(snapshot.operationalContinuation, {
          bookingId: snapshot.bookingId || null,
          status:
            bookingStatus === "operational_interrupted"
              ? "passenger_decision_pending"
              : bookingStatus === "searching_replacement"
                ? "searching_replacement_driver"
                : snapshot?.operationalContinuation?.status ||
                  DEFAULT_OPERATIONAL_CONTINUATION.status,
          message:
            snapshot?.message ||
            snapshot?.operationalContinuation?.message ||
            DEFAULT_OPERATIONAL_CONTINUATION.message,
        })
      : bookingStatus === "operational_interrupted" ||
          bookingStatus === "searching_replacement"
        ? buildOperationalContinuationState(snapshot, {
            bookingId: snapshot.bookingId || null,
            status:
              bookingStatus === "operational_interrupted"
                ? "passenger_decision_pending"
                : "searching_replacement_driver",
            message: snapshot?.message || DEFAULT_OPERATIONAL_CONTINUATION.message,
          })
        : cloneDefaultOperationalContinuation();

  const syncedOffer = buildDriverOffer({
    bookingId: snapshot.bookingId,
    destination,
    fare,
    etaMinutes: runtimeState.tripDurationMin,
    pickupAddress,
    pickupCoordinate: normalizeRuntimeCoordinate(snapshot?.pickupLocation),
    preferences:
      snapshot?.preferences ||
      runtimeState.driverActiveRide?.preferences ||
      runtimeState.activeBooking?.preferences ||
      {},
    passengerName:
      snapshot?.passengerName ||
      snapshot?.customerName ||
      runtimeState.driverActiveRide?.passenger ||
      runtimeState.profileName,
    passengerId: snapshot?.customerId || null,
  });
  const syncedFeeBreakdown =
    extractPayloadFeeBreakdown(snapshot, { estimated: false }) ||
    extractPayloadFeeBreakdown(snapshot, { estimated: true });
  const syncedPricingSnapshotMetadata =
    extractPricingSnapshotMetadata(snapshot);
  const syncedOfferWithFees = syncedFeeBreakdown
    ? {
        ...syncedOffer,
        ...syncedFeeBreakdown,
        ...(syncedPricingSnapshotMetadata || {}),
      }
    : {
        ...syncedOffer,
        ...(syncedPricingSnapshotMetadata || {}),
      };
  const boardingDeadlineRaw = snapshot?.boardingDeadlineAt || null;
  const parsedBoardingDeadline = boardingDeadlineRaw
    ? new Date(boardingDeadlineRaw)
    : null;
  const boardingDeadlineIso =
    parsedBoardingDeadline && !Number.isNaN(parsedBoardingDeadline.getTime())
      ? parsedBoardingDeadline.toISOString()
      : null;
  const boardingRemainingSec = boardingDeadlineIso
    ? Math.max(
        0,
        Math.round(
          (new Date(boardingDeadlineIso).getTime() - Date.now()) / 1000,
        ),
      )
    : 0;
  const syncedDistanceKm = Number(
    snapshot?.routeDistanceKm ??
      snapshot?.distanceKm ??
      snapshot?.distance ??
      NaN,
  );
  const syncedDurationSecs = Number(
    snapshot?.routeDurationSecs ??
      snapshot?.durationSecs ??
      snapshot?.duration ??
      NaN,
  );
  const syncedDurationMinutes =
    Number.isFinite(syncedDurationSecs) && syncedDurationSecs > 0
      ? Math.max(1, Math.round(syncedDurationSecs / 60))
      : NaN;
  const syncedExtensionRequest =
    snapshot?.activeExtensionRequest &&
    typeof snapshot.activeExtensionRequest === "object"
      ? snapshot.activeExtensionRequest
      : null;
  const hasSyncedExtensionRequest = Boolean(
    syncedExtensionRequest &&
      String(
        syncedExtensionRequest.requestId ||
          syncedExtensionRequest.status ||
          snapshot?.extensionPaymentStatus ||
          "",
      )
        .trim()
        .length,
  );
  const syncedDriverExtensionState =
    runtimeRole === "driver" && hasSyncedExtensionRequest
      ? buildDriverExtensionRequest(
          {
            bookingId: snapshot.bookingId,
            extensionRequest: syncedExtensionRequest,
            status:
              syncedExtensionRequest?.status ||
              snapshot?.extensionPaymentStatus ||
              null,
            chargeId:
              syncedExtensionRequest?.chargeId ||
              snapshot?.extensionChargeId ||
              null,
          },
          {
            error: "",
            message:
              syncedExtensionRequest?.status === "DRIVER_DECISION_PENDING"
                ? "Passageiro solicitou extensão da rota. Aceite ou recuse a alteração."
                : "",
          },
        )
      : cloneDefaultDriverExtensionRequest();
  const syncedPassengerExtensionState =
    runtimeRole === "customer" && hasSyncedExtensionRequest
      ? buildRideExtensionState(
          {
            bookingId: snapshot.bookingId,
            extensionRequest: syncedExtensionRequest,
            status:
              syncedExtensionRequest?.status ||
              snapshot?.extensionPaymentStatus ||
              null,
            chargeId:
              syncedExtensionRequest?.chargeId ||
              snapshot?.extensionChargeId ||
              null,
          },
          {
            error: "",
          },
        )
      : cloneDefaultRideExtensionState();
  const shouldHydrateDriverOfferOnly =
    runtimeRole === "driver" &&
    bookingStatus === "searching" &&
    (snapshot?.source === "pending_notification" ||
      snapshot?.hasActiveRide !== true);
  const previousOfferForBooking =
    (runtimeState.driverOffers || []).find(
      (item) => (item?.bookingId || item?.id) === snapshot.bookingId,
    ) || null;
  const mergedSyncedRide = mergeLockedDriverRideSnapshot(
    previousOfferForBooking,
    runtimeState.driverActiveRide,
    syncedOfferWithFees,
  );
  const pickupCoordinate = resolvePickupCoordinateFromRide(
    mergedSyncedRide,
    runtimeState.activeBooking,
  );
  const destinationCoordinate = resolveDestinationCoordinateFromRide(
    mergedSyncedRide,
    destination,
    runtimeState.activeBooking,
  );
  const resolvedDriverFare = resolveDriverPayoutAmount(
    mergedSyncedRide,
    runtimeState.driverTripMeta,
  );
  const resolvedDriverExplicitPayout = resolveDriverExplicitPayoutAmount(
    mergedSyncedRide,
    runtimeState.driverTripMeta,
  );
  const syncedDriverRoutePlan = ensurePersistedDriverRoutePlan({
    bookingId: snapshot.bookingId || runtimeState.activeBookingId || null,
    pickupCoordinate,
    destinationCoordinate,
    routePlan: runtimeState.driverTripMeta?.routePlan || null,
    fallbackOriginCoordinate:
      driverCoordinate ||
      runtimeState.currentCoordinate ||
      runtimeState.driverCoordinate ||
      null,
  });
  setRuntimeState((previous) => ({
    bookingStatus,
    activeBookingId: snapshot.bookingId || previous.activeBookingId,
    activeBooking: {
      ...(previous.activeBooking && typeof previous.activeBooking === "object"
        ? previous.activeBooking
        : {}),
      bookingId: snapshot.bookingId,
      status: normalizedStatus,
      estimatedFare: fare,
      pickupLocation:
        snapshot.pickupLocation || previous.activeBooking?.pickupLocation || null,
      destinationLocation:
        snapshot.destinationLocation ||
        previous.activeBooking?.destinationLocation ||
        null,
      paymentStatus:
        snapshot.paymentStatus || previous.activeBooking?.paymentStatus || null,
    },
    selectedDestination:
      destination?.coordinate || destination?.name || destination?.address
        ? {
            ...(previous.selectedDestination &&
            typeof previous.selectedDestination === "object"
              ? previous.selectedDestination
              : {}),
            ...destination,
          }
        : previous.selectedDestination,
    selectedFare: Number.isFinite(fare) ? fare : previous.selectedFare,
    selectedVehicle:
      sanitizeText(
        snapshot?.carType || snapshot?.vehicleCategory || snapshot?.vehicleType,
        "",
      ) || previous.selectedVehicle,
    driverInfo: {
      id: snapshot.driverId || previous.driverInfo?.id || null,
      name:
        sanitizeText(snapshot?.driverName || snapshot?.driver?.name, "") ||
        previous.driverInfo?.name ||
        "Motorista",
      plate: previous.driverInfo?.plate || "",
      model: previous.driverInfo?.model || "",
      rating: previous.driverInfo?.rating || null,
    },
    driverCoordinate,
    driverActiveRide:
      runtimeRole === "driver"
        ? shouldHydrateDriverOfferOnly
          ? null
          : {
              ...mergedSyncedRide,
              status: bookingStatus,
            }
        : null,
    driverOffers:
      runtimeRole === "driver"
        ? mergeDriverOffers(previous.driverOffers, syncedOfferWithFees)
        : [],
    operationalContinuation:
      bookingStatus === "operational_interrupted" ||
      bookingStatus === "searching_replacement"
        ? syncedOperationalContinuation
        : cloneDefaultOperationalContinuation(),
    rideExtension: syncedPassengerExtensionState,
    driverExtensionRequest: syncedDriverExtensionState,
    ...(runtimeRole === "driver" &&
    ["accepted", "arrived", "started"].includes(bookingStatus)
      ? {
          driverTripMeta: {
            ...(previous.driverTripMeta || {}),
            leg:
              bookingStatus === "started"
                ? "destination"
                : bookingStatus === "arrived"
                  ? "boarding"
                  : "pickup",
            pickupAddress:
              mergedSyncedRide?.pickup ||
              mergedSyncedRide?.pickupAddress ||
              snapshot?.pickupLocation?.add ||
              previous.driverTripMeta?.pickupAddress ||
              "Local de embarque",
            destinationAddress:
              mergedSyncedRide?.dropoffAddress ||
              mergedSyncedRide?.dropoff ||
              snapshot?.destinationLocation?.add ||
              previous.driverTripMeta?.destinationAddress ||
              "Destino",
            ...(pickupCoordinate ? { pickupCoordinate } : {}),
            ...(destinationCoordinate ? { destinationCoordinate } : {}),
            ...(Number.isFinite(resolvedDriverFare)
              ? {
                  fare: resolvedDriverFare,
                  fareLabel: formatCurrencyBR(resolvedDriverFare),
                }
              : {}),
            ...(Number.isFinite(resolvedDriverExplicitPayout)
              ? {
                  driverNetAmount: resolvedDriverExplicitPayout,
                  estimatedDriverNetAmount: resolvedDriverExplicitPayout,
                }
              : {}),
            routePlan:
              syncedDriverRoutePlan ||
              previous.driverTripMeta?.routePlan ||
              null,
          },
        }
      : {}),
    tripDistanceKm:
      Number.isFinite(syncedDistanceKm) && syncedDistanceKm >= 0
        ? syncedDistanceKm
        : previous.tripDistanceKm,
    tripDurationMin:
      Number.isFinite(syncedDurationMinutes) && syncedDurationMinutes > 0
        ? syncedDurationMinutes
        : previous.tripDurationMin,
    tripArrivalText:
      bookingStatus === "arrived"
        ? "Motorista chegou ao embarque"
        : previous.tripArrivalText,
    boardingDeadlineAt:
      bookingStatus === "arrived" ? boardingDeadlineIso : null,
    boardingRemainingSec:
      bookingStatus === "arrived" ? boardingRemainingSec : 0,
    searchingElapsedSeconds:
      bookingStatus === "searching"
        ? Math.min(
            SEARCH_TOTAL_DURATION_SECONDS,
            Math.max(
              Number(previous.searchingElapsedSeconds) || 0,
              resolveSearchElapsedSecondsFromSource({
                activeBooking: snapshot,
                paymentState: previous.paymentState,
              }),
            ),
          )
        : previous.searchingElapsedSeconds,
    lastError:
      bookingStatus === "searching" &&
      Number(previous.searchingElapsedSeconds || 0) >=
        SEARCH_TOTAL_DURATION_SECONDS
        ? SEARCH_TIMEOUT_RECONCILING_MESSAGE
        : "",
  }));

  if (bookingStatus === "searching") {
    startSearchingTimer({ preserveElapsed: true });
    stopBoardingCountdownTimer();
  } else {
    stopSearchingTimer();
  }

  if (bookingStatus === "arrived" && boardingDeadlineIso) {
    startBoardingCountdown(boardingDeadlineIso);
  } else if (bookingStatus !== "arrived") {
    stopBoardingCountdownTimer();
  }

  runtimeLastSyncedActiveRideFingerprint = fingerprint;

  return true;
}

async function refreshPrototypeRealtimeSession(
  profile,
  {
    reason = "manual",
    syncActiveRide = false,
    timeoutMs = 10000,
  } = {},
) {
  const userId = String(profile?.uid || "").trim();
  if (!userId) {
    return false;
  }

  if (isRuntimeQALockActive()) {
    await writeRuntimeDebugProbe("socket_realtime_refresh_ignored_qa_lock", {
      userId,
      reason,
      syncActiveRide: Boolean(syncActiveRide),
      role: resolveRuntimeRole(profile),
      bookingStatus: runtimeState.bookingStatus || null,
      activeBookingId: runtimeState.activeBookingId || null,
      lockUntil: runtimeQALockUntil,
    });
    return false;
  }

  const shouldHoldPresentation =
    syncActiveRide &&
    ["appstate_active", "driver_online_initial_sync", "active_flow_initial"].includes(
      reason,
    );
  if (shouldHoldPresentation) {
    beginRuntimePresentationSync();
  }

  try {
    const ready = await ensureSocketReady(profile);
    if (!ready) {
      return false;
    }

    if (!syncActiveRide) {
      await writeRuntimeDebugProbe("socket_keepalive", {
        userId,
        reason,
      });
      return true;
    }

    const socket = WebSocketManager.getInstance();
    const activeRideSnapshot = await socket.syncActiveRideWithAck(timeoutMs);
    const applied = applySyncedActiveRideSnapshot(activeRideSnapshot);
    if (!applied && resolveRuntimeRole(profile) === "customer") {
      const recovered = await recoverCompletedRideFromStoredReceipt({
        reason: `${reason}_sync_fallback`,
      });
      if (recovered?.recovered) {
        await writeRuntimeDebugProbe("socket_active_ride_resync_receipt_recovery", {
          userId,
          reason,
          bookingId: recovered.receiptId || null,
          code: recovered.code || null,
        });
        return true;
      }
    }
    await writeRuntimeDebugProbe("socket_active_ride_resync", {
      userId,
      reason,
      bookingId: activeRideSnapshot?.bookingId || null,
      hasActiveRide: activeRideSnapshot?.hasActiveRide === true,
      status: activeRideSnapshot?.status || null,
      applied,
    });
    return applied;
  } catch (error) {
    if (resolveRuntimeRole(profile) === "customer") {
      const recovered = await recoverCompletedRideFromStoredReceipt({
        reason: `${reason}_socket_error`,
      });
      if (recovered?.recovered) {
        await writeRuntimeDebugProbe("socket_active_ride_resync_recovered_after_error", {
          userId,
          reason,
          bookingId: recovered.receiptId || null,
          message: error?.message || String(error),
        });
        return true;
      }
    }
    await writeRuntimeDebugProbe("socket_active_ride_resync_error", {
      userId,
      reason,
      message: error?.message || String(error),
    });
    throw error;
  } finally {
    if (shouldHoldPresentation) {
      endRuntimePresentationSync();
    }
  }
}

async function waitForAuthenticatedSocketUser(
  socket,
  userId,
  userType,
  timeoutMs = 12000,
) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = socket?.getConnectionStatus?.() || {};
    const authenticatedAsCurrentUser =
      Boolean(status?.connected) &&
      Boolean(status?.authenticated) &&
      status?.userId === userId &&
      (status?.userType === userType || !status?.userType);

    if (authenticatedAsCurrentUser) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return false;
}

async function ensureSocketReady(profile) {
  const userId = profile?.uid;
  const targetUserType = resolveRuntimeRole(profile);
  if (!userId) {
    await writeRuntimeDebugProbe("socket_ready_missing_user", {
      profileUid: profile?.uid || null,
      targetUserType,
    });
    setRuntimeState({
      isSocketConnected: false,
      isSocketAuthenticated: false,
      socketError:
        "Usuário não autenticado para conectar serviços em tempo real.",
    });
    return false;
  }

  if (isRuntimeQALockActive()) {
    await writeRuntimeDebugProbe("socket_ready_blocked_by_qa_lock", {
      userId,
      targetUserType,
      lockUntil: runtimeQALockUntil,
    });
    Logger.log("⏸️ [PrototypeRuntime] Socket adiado por lock QA temporário.");
    return false;
  }

  const socket = WebSocketManager.getInstance();
  attachSocketListeners();
  attachChatListeners();

  const currentStatus = socket.getConnectionStatus?.() || {};
  const alreadyReady =
    socket.isConnected?.() &&
    Boolean(currentStatus?.authenticated) &&
    currentStatus?.userId === userId &&
    (currentStatus?.userType === targetUserType || !currentStatus?.userType);

  if (alreadyReady) {
    if (
      runtimeState.connecting ||
      !runtimeState.isSocketConnected ||
      !runtimeState.isSocketAuthenticated ||
      runtimeState.activeRole !== targetUserType
    ) {
      setRuntimeState({
        connecting: false,
        isSocketConnected: true,
        isSocketAuthenticated: true,
        socketError: "",
        activeRole: targetUserType,
      });
    }
    return true;
  }

  try {
    await writeRuntimeDebugProbe("socket_ready_start", {
      userId,
      targetUserType,
    });
    await ensureFirebaseSessionForPrototype(profile);

    setRuntimeState({
      connecting: true,
      socketError: "",
      activeRole: targetUserType,
    });

    const orchestratorReady = await realtimeConnectionOrchestrator.ensureReady(
      {
        profile,
        userId,
        userType: targetUserType,
      },
      {
        reason: "prototype_runtime",
        authTimeoutMs: 12000,
        forceRefreshToken: true,
      },
    );

    await writeRuntimeDebugProbe("socket_connected", {
      userId,
      targetUserType,
      orchestratorReady,
      status: socket.getConnectionStatus(),
    });

    if (!orchestratorReady) {
      throw new Error("Sessao realtime ainda nao foi preparada.");
    }

    const postAuthStatus = socket.getConnectionStatus?.() || {};
    const finallyAuthenticatedAsCurrentUser =
      Boolean(postAuthStatus?.connected) &&
      Boolean(postAuthStatus?.authenticated) &&
      postAuthStatus?.userId === userId &&
      (postAuthStatus?.userType === targetUserType || !postAuthStatus?.userType);
    if (!finallyAuthenticatedAsCurrentUser) {
      throw new Error("Sessao do socket ainda nao foi autenticada.");
    }

    await writeRuntimeDebugProbe("socket_authenticated", {
      userId,
      targetUserType,
      status: postAuthStatus,
    });

    try {
      const activeRideSnapshot = await socket.syncActiveRideWithAck(10000);
      const applied = applySyncedActiveRideSnapshot(activeRideSnapshot);
      if (!applied && targetUserType === "customer") {
        await recoverCompletedRideFromStoredReceipt({
          reason: "socket_ready_sync_fallback",
        });
      }
      await writeRuntimeDebugProbe("socket_active_ride_sync", {
        userId,
        bookingId: activeRideSnapshot?.bookingId || null,
        hasActiveRide: activeRideSnapshot?.hasActiveRide === true,
        status: activeRideSnapshot?.status || null,
      });
    } catch (syncError) {
      if (targetUserType === "customer") {
        await recoverCompletedRideFromStoredReceipt({
          reason: "socket_ready_sync_error",
        });
      }
      if (syncError?.code !== "RIDE_SYNC_TIMEOUT") {
        Logger.warn(
          "⚠️ [PrototypeRuntime] syncActiveRide indisponível no momento:",
          syncError?.message || syncError,
        );
      }
    }

    setRuntimeState({
      connecting: false,
      isSocketConnected: true,
      isSocketAuthenticated: true,
      socketError: "",
      activeRole: targetUserType,
    });

    if (targetUserType === "driver") {
      const hasDriverRideInProgress =
        Boolean(
          runtimeState.driverActiveRide?.bookingId ||
            runtimeState.driverActiveRide?.id ||
            runtimeState.activeBookingId,
        ) ||
        ["accepted", "arrived", "started"].includes(
          String(runtimeState.bookingStatus || "")
            .trim()
            .toLowerCase(),
        );
      const hasDriverOnlineEnableInFlight = Boolean(
        runtimeDriverOnlineEnablePromise,
      );
      const hasStableOnlineDriverState =
        Boolean(runtimeState.driverOnline) &&
        !Boolean(runtimeState.driverOnlinePending);
      const shouldRestoreDriverOnlineIntent =
        !hasDriverOnlineEnableInFlight &&
        !hasDriverRideInProgress &&
        Boolean(runtimeState.driverOnlinePending);
      const shouldEnsureHeartbeatForOnlineDriver =
        !hasDriverRideInProgress && hasStableOnlineDriverState;

      try {
        if (hasDriverRideInProgress) {
          await startDriverLocationHeartbeat(profile, socket);
        } else if (hasDriverOnlineEnableInFlight) {
          await writeRuntimeDebugProbe("driver_online_restore_skipped_inflight", {
            userId,
            targetUserType,
            bookingStatus: runtimeState.bookingStatus || null,
            driverOnline: Boolean(runtimeState.driverOnline),
            driverOnlinePending: Boolean(runtimeState.driverOnlinePending),
          });
        } else if (shouldRestoreDriverOnlineIntent) {
          await restorePrototypeDriverOnlinePresence(profile, {
            socketInstance: socket,
          });
        } else if (
          shouldEnsureHeartbeatForOnlineDriver ||
          runtimeDriverHeartbeatInterval
        ) {
          await startDriverLocationHeartbeat(profile, socket);
        }
      } catch (heartbeatError) {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao restabelecer presença do motorista:",
          heartbeatError?.message || heartbeatError,
        );
      }
    } else if (targetUserType !== "driver") {
      stopDriverLocationHeartbeat();
    }

    // O heartbeat do passageiro é mantido pelo effect dedicado do runtime.
    // Mantê-lo aqui também faz o mesmo ciclo nascer de múltiplos gatilhos
    // (connect/auth/resync + mudança de fase), o que gera bursts artificiais.

    return true;
  } catch (error) {
    await writeRuntimeDebugProbe("socket_ready_error", {
      userId,
      targetUserType,
      message: error?.message || String(error),
    });
    setRuntimeState({
      connecting: false,
      isSocketConnected: socket.isConnected(),
      isSocketAuthenticated: false,
      socketError: error?.message || "Falha ao conectar serviço de corridas.",
    });
    return false;
  }
}

async function bootstrapRuntime(profile) {
  if (runtimeBootstrapPromise) {
    return runtimeBootstrapPromise;
  }

  runtimeBootstrapPromise = (async () => {
    beginRuntimePresentationSync();
    setRuntimeState({ initializing: true });
    try {
      const bootstrapRole = resolveRuntimeRole(profile);
      const shouldForceFreshBootstrapLocation =
        bootstrapRole === "driver" || bootstrapRole === "customer";
      const initialLocationPromise = ensureCurrentLocation({
        allowCurrentPosition:
          shouldForceFreshBootstrapLocation || Platform.OS !== "android",
        forceCurrentPosition:
          Platform.OS === "android" && shouldForceFreshBootstrapLocation,
      }).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao resolver localização no bootstrap:",
          error?.message || error,
        );
        return null;
      });
      let qaSeedLock = null;
      let hasHydratedLocationSnapshot = hasUsableRuntimeLocationSnapshot(runtimeState);
      if (profile?.uid) {
        qaSeedLock = await loadPersistedRuntimeQaSeed(profile.uid);
        const bootstrapFreezeUntil = Number(qaSeedLock?.freezeUntil || 0);
        if (bootstrapFreezeUntil > Date.now()) {
          runtimeQALockUntil = bootstrapFreezeUntil;
        }

        const persistedSession = await loadPersistedRuntimeSession(profile.uid);
        await writeRuntimeDebugProbe("bootstrap_persisted_session_loaded", {
          userId: profile.uid,
          hasSession: Boolean(persistedSession),
          bookingStatus: persistedSession?.bookingStatus || null,
          activeBookingId: persistedSession?.activeBookingId || null,
        });
        if (persistedSession && typeof persistedSession === "object") {
          const sanitizedPersistedSession =
            sanitizePersistedRuntimeSessionForProfile(persistedSession, profile);
          hasHydratedLocationSnapshot = hasUsableRuntimeLocationSnapshot(
            sanitizedPersistedSession,
          );
          setRuntimeState({
            ...sanitizedPersistedSession,
            profileUid: profile.uid,
            activeRole: resolveRuntimeRole(profile),
          });
        }
        await writeRuntimeDebugProbe("bootstrap_qa_seed_loaded", {
          userId: profile.uid,
          hasSeed: Boolean(qaSeedLock),
          freezeUntil: Number(qaSeedLock?.freezeUntil || 0) || null,
          scenario: qaSeedLock?.scenario || null,
        });
        const freezeUntil = Number(qaSeedLock?.freezeUntil || 0);
        if (freezeUntil > 0 && freezeUntil <= Date.now()) {
          await clearPersistedRuntimeQaSeed(profile.uid);
          qaSeedLock = null;
        }
      }
      await waitForRuntimeBootstrapLocation(
        initialLocationPromise,
        !hasHydratedLocationSnapshot || shouldForceFreshBootstrapLocation,
      );
      setRuntimeState({
        ready: true,
      });
      if (profile?.uid && Number(qaSeedLock?.freezeUntil || 0) > Date.now()) {
        scheduleDeferredSocketBootstrap(profile, Number(qaSeedLock.freezeUntil));
      } else if (profile?.uid) {
        runtimeQALockUntil = 0;
        clearDeferredSocketBootstrapTimer();
        ensureSocketReady(profile).catch((error) => {
          Logger.warn(
            "⚠️ [PrototypeRuntime] Falha ao conectar socket durante bootstrap em background:",
            error?.message || error,
          );
        });
      }
    } finally {
      setRuntimeState({
        initializing: false,
      });
      endRuntimePresentationSync();
    }
  })();

  try {
    await runtimeBootstrapPromise;
  } finally {
    runtimeBootstrapPromise = null;
  }
}

async function resolveDestinationCoordinate(destination) {
  if (
    destination?.coordinate &&
    Number.isFinite(destination.coordinate.latitude) &&
    Number.isFinite(destination.coordinate.longitude)
  ) {
    return destination;
  }

  if (!destination?.place_id) {
    return destination;
  }

  try {
    const sessionToken = sanitizeText(destination?.searchSessionToken, "");
    const telemetryContext = resolveRuntimeRideTelemetryContext({
      surface: "destination_resolution",
    });
    const details = await fetchCoordsfromPlace(
      destination.place_id,
      telemetryContext,
      sessionToken || null,
      {
        query: destination.name || destination.address || null,
        location: destination.coordinate || null,
      },
    );
    if (!Number.isFinite(details?.lat) || !Number.isFinite(details?.lng)) {
      return destination;
    }
    if (sessionToken) {
      resetRuntimeDestinationSearchSession("place_details_resolved");
    }

    return {
      ...destination,
      name:
        destination.name || details?.name || destination.address || "Destino",
      address: destination.address || details?.formatted_address || "",
      coordinate: {
        latitude: Number(details.lat),
        longitude: Number(details.lng),
      },
    };
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao resolver coordenadas do destino:",
      error?.message || error,
    );
    if (sanitizeText(destination?.searchSessionToken, "")) {
      resetRuntimeDestinationSearchSession("place_details_failed");
    }
    return destination;
  }
}

async function previewDestinationOnMap(destination, payload = {}) {
  if (!destination?.coordinate) {
    clearPrototypeMapRoute();
    return null;
  }

  const origin = getPayloadOriginCoordinate(payload);
  let coordinates = null;
  let distanceKm = null;
  let durationMinutes = null;
  let etaText = "";
  const normalizedBookingStatus = String(runtimeState.bookingStatus || "")
    .trim()
    .toLowerCase();
  const isCustomerPreBookingPreview =
    resolveRuntimeRole(runtimeState.profile) === "customer" &&
    !runtimeState.activeBookingId &&
    normalizedBookingStatus === "idle";
  const quoteRouteKey = isCustomerPreBookingPreview
    ? buildQuoteLockRouteKey(origin, destination.coordinate)
    : "";
  const activeQuoteLock = isCustomerPreBookingPreview
    ? resolveActiveQuoteLock(runtimeState.quoteLock, quoteRouteKey)
    : null;
  const shouldUseGooglePreview =
    isCustomerPreBookingPreview &&
    destination?.skipGooglePreview !== true &&
    destination?.previewMode !== "local_only";

  if (activeQuoteLock) {
    const lockedCoordinates = buildFixedRouteCoordinates(
      activeQuoteLock.coordinates,
      origin,
      destination.coordinate,
    );
    const lockedDistanceKm = Number(activeQuoteLock.distanceKm);
    const lockedDurationMinutes = Number(activeQuoteLock.durationMinutes);
    const lockedEtaText =
      sanitizeText(activeQuoteLock.etaText, "") ||
      buildTripEtaText(lockedDurationMinutes);

    setRuntimeState({
      quoteLock: activeQuoteLock,
      tripDistanceKm: Number(lockedDistanceKm.toFixed(1)),
      tripDurationMin: Math.max(1, Math.round(lockedDurationMinutes)),
      tripArrivalText: lockedEtaText,
    });

    setPrototypeMapRoute({
      origin,
      destination: destination.coordinate,
      destinationLabel: destination.name,
      destinationAddress: destination.address,
      coordinates: lockedCoordinates,
    });

    return {
      coordinates: lockedCoordinates,
      distanceKm: Number(lockedDistanceKm.toFixed(1)),
      durationMinutes: Math.max(1, Math.round(lockedDurationMinutes)),
      etaText: lockedEtaText,
    };
  }

  if (shouldUseGooglePreview) {
    try {
      const startLoc = `${origin.latitude},${origin.longitude}`;
      const destLoc = `${destination.coordinate.latitude},${destination.coordinate.longitude}`;
      const telemetryContext = resolveRuntimeRideTelemetryContext({
        surface: "destination_preview",
        cacheMode: "sticky_destination",
        routeScope: [
          "passenger_home_preview",
          Number(origin.latitude).toFixed(3),
          Number(origin.longitude).toFixed(3),
        ].join(":"),
      });
      const route = await getDirectionsApi(
        startLoc,
        destLoc,
        null,
        telemetryContext,
      );
      coordinates = decodePolylineToCoordinates(route?.polylinePoints);

      if (route?.distance_in_km || route?.time_in_secs) {
        const distance = Number(route.distance_in_km || 0);
        durationMinutes = Number(route.time_in_secs || 0) / 60;
        const etaDate = new Date();
        etaDate.setMinutes(
          etaDate.getMinutes() + Math.max(1, Math.round(durationMinutes)),
        );
        distanceKm = Number(distance.toFixed(1));
        etaText = etaDate.toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        });
      }
    } catch (error) {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Não foi possível calcular rota real para preview de destino.",
      );
    }
  }

  if (!coordinates || coordinates.length < 2) {
    if (isCustomerPreBookingPreview) {
      clearPrototypeMapRoute();
      setRuntimeState({
        quoteLock: null,
      });
      return null;
    }

    coordinates = buildFixedRouteCoordinates([], origin, destination.coordinate);
    const fallbackMetrics = resolveRouteLegMetrics(null, coordinates);
    distanceKm =
      Number.isFinite(Number(distanceKm)) && Number(distanceKm) > 0
        ? distanceKm
        : fallbackMetrics.distanceKm;
    durationMinutes =
      Number.isFinite(Number(durationMinutes)) && Number(durationMinutes) > 0
        ? durationMinutes
        : fallbackMetrics.durationMinutes;
    etaText =
      etaText ||
      buildTripEtaText(
        Number.isFinite(Number(durationMinutes)) && Number(durationMinutes) > 0
          ? durationMinutes
          : fallbackMetrics.durationMinutes,
      );
  }

  const normalizedDistanceKm =
    Number.isFinite(Number(distanceKm)) && Number(distanceKm) > 0
      ? Number(Number(distanceKm).toFixed(1))
      : null;
  const normalizedDurationMinutes =
    Number.isFinite(Number(durationMinutes)) && Number(durationMinutes) > 0
      ? Math.max(1, Math.round(Number(durationMinutes)))
      : null;
  const shouldPersistQuoteLock =
    isCustomerPreBookingPreview &&
    Boolean(quoteRouteKey) &&
    Array.isArray(coordinates) &&
    coordinates.length >= 2;
  const nextQuoteLock = shouldPersistQuoteLock
    ? buildQuoteLockSnapshot({
        originCoordinate: origin,
        destinationCoordinate: destination.coordinate,
        distanceKm: normalizedDistanceKm,
        durationMinutes: normalizedDurationMinutes,
        etaText,
        coordinates,
      })
    : null;

  const runtimePatch = {};
  if (normalizedDistanceKm != null) {
    runtimePatch.tripDistanceKm = normalizedDistanceKm;
    runtimePatch.tripDurationMin =
      normalizedDurationMinutes != null
        ? normalizedDurationMinutes
        : runtimeState.tripDurationMin;
    runtimePatch.tripArrivalText = etaText;
  }
  if (shouldPersistQuoteLock) {
    runtimePatch.quoteLock = nextQuoteLock;
  }
  if (Object.keys(runtimePatch).length > 0) {
    setRuntimeState(runtimePatch);
  }

  setPrototypeMapRoute({
    origin,
    destination: destination.coordinate,
    destinationLabel: destination.name,
    destinationAddress: destination.address,
    coordinates,
    allowFallback: !isCustomerPreBookingPreview,
  });

  return {
    coordinates,
    distanceKm: normalizedDistanceKm ?? distanceKm,
    durationMinutes: normalizedDurationMinutes ?? durationMinutes,
    etaText,
  };
}

function buildFallbackLiveRoutePlan({
  originCoordinate,
  pickupCoordinate,
  destinationCoordinate,
}) {
  const pickupCoordinates = buildFixedRouteCoordinates(
    [],
    originCoordinate,
    pickupCoordinate,
  );
  const destinationCoordinates = buildFixedRouteCoordinates(
    [],
    pickupCoordinate,
    destinationCoordinate,
  );
  const pickupMetrics = resolveRouteLegMetrics(null, pickupCoordinates);
  const destinationMetrics = resolveRouteLegMetrics(null, destinationCoordinates);
  const pickupSteps = buildFallbackNavigationSteps({
    coordinates: pickupCoordinates,
    instruction: "Siga até o local de embarque",
    durationMinutes: pickupMetrics.durationMinutes,
  });
  const destinationSteps = buildFallbackNavigationSteps({
    coordinates: destinationCoordinates,
    instruction: "Siga até o destino",
    durationMinutes: destinationMetrics.durationMinutes,
  });

  return {
    combinedCoordinates: [
      ...pickupCoordinates,
      ...destinationCoordinates.slice(1),
    ],
    pickupCoordinates,
    destinationCoordinates,
    pickupSteps,
    destinationSteps,
    pickupDistanceKm: pickupMetrics.distanceKm,
    pickupDurationMinutes: pickupMetrics.durationMinutes,
    destinationDistanceKm: destinationMetrics.distanceKm,
    destinationDurationMinutes: destinationMetrics.durationMinutes,
  };
}

async function buildLiveTripRoutePlan({
  origin,
  pickup,
  pickupAddress,
  destination,
  destinationLabel,
  destinationAddress,
  bookingId = null,
  telemetryContext = null,
}) {
  if (
    !origin ||
    !pickup ||
    !destination ||
    !Number.isFinite(origin.latitude) ||
    !Number.isFinite(origin.longitude) ||
    !Number.isFinite(pickup.latitude) ||
    !Number.isFinite(pickup.longitude) ||
    !Number.isFinite(destination.latitude) ||
    !Number.isFinite(destination.longitude)
  ) {
    return null;
  }

  const resolvedBookingId = String(
    bookingId ||
      telemetryContext?.bookingId ||
      runtimeState.activeBookingId ||
      runtimeState.driverActiveRide?.bookingId ||
      "",
  ).trim();
  const cachedRoutePlan = getCachedDriverRoutePlan({
    bookingId: resolvedBookingId,
    pickupCoordinate: pickup,
    destinationCoordinate: destination,
  });
  if (cachedRoutePlan) {
    const activeMetrics = applyRoutePlanToMap({
      routePlan: cachedRoutePlan,
      phase: "pickup",
      pickupCoordinate: pickup,
      pickupAddress,
      destinationCoordinate: destination,
      destinationLabel,
      destinationAddress,
      fallbackOrigin: origin,
    });

    return {
      routePlan: cachedRoutePlan,
      activeMetrics,
      pickupMetrics: {
        distanceKm: cachedRoutePlan.pickupDistanceKm,
        durationMinutes: cachedRoutePlan.pickupDurationMinutes,
        etaText: buildTripEtaText(cachedRoutePlan.pickupDurationMinutes),
      },
      destinationMetrics: {
        distanceKm: cachedRoutePlan.destinationDistanceKm,
        durationMinutes: cachedRoutePlan.destinationDurationMinutes,
        etaText: buildTripEtaText(cachedRoutePlan.destinationDurationMinutes),
      },
    };
  }

  const inFlightKey = buildLiveRoutePlanInFlightKey({
    bookingId: resolvedBookingId,
    origin,
    pickup,
    destination,
  });
  if (inFlightKey && runtimeRoutePlanInFlight.has(inFlightKey)) {
    return runtimeRoutePlanInFlight.get(inFlightKey);
  }

  const buildPromise = (async () => {
    try {
      const startLoc = `${origin.latitude},${origin.longitude}`;
      const destinationLoc = `${destination.latitude},${destination.longitude}`;
      const waypointLoc = `${pickup.latitude},${pickup.longitude}`;
      const budget = registerDirectionsRequestForBooking(resolvedBookingId);
      if (!budget.allowed) {
        throw new Error(
          `Directions budget exceeded for booking ${resolvedBookingId} (${budget.count}/${MAX_DIRECTIONS_REQUESTS_PER_BOOKING})`,
        );
      }
      const route = await getDirectionsApi(
        startLoc,
        destinationLoc,
        waypointLoc,
        telemetryContext,
      );
      const routePlan = buildLiveRoutePlanFromDirections({
        originCoordinate: origin,
        pickupCoordinate: pickup,
        destinationCoordinate: destination,
        route,
      });
      let effectiveRoutePlan =
        cacheDriverRoutePlan({
          bookingId: resolvedBookingId,
          pickupCoordinate: pickup,
          destinationCoordinate: destination,
          routePlan,
        }) || extractDriverRoutePlan({ routePlan });

      if (!effectiveRoutePlan) {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Rota viva do Google não gerou plano persistível; promovendo fallback local estável.",
        );
        const fallbackRoutePlan = buildFallbackLiveRoutePlan({
          originCoordinate: origin,
          pickupCoordinate: pickup,
          destinationCoordinate: destination,
        });
        effectiveRoutePlan =
          cacheDriverRoutePlan({
            bookingId: resolvedBookingId,
            pickupCoordinate: pickup,
            destinationCoordinate: destination,
            routePlan: fallbackRoutePlan,
          }) || fallbackRoutePlan;
      }

      const activeMetrics = applyRoutePlanToMap({
        routePlan: effectiveRoutePlan,
        phase: "pickup",
        pickupCoordinate: pickup,
        pickupAddress,
        destinationCoordinate: destination,
        destinationLabel,
        destinationAddress,
        fallbackOrigin: origin,
      });

      return {
        routePlan: effectiveRoutePlan,
        activeMetrics,
        pickupMetrics: {
          distanceKm: effectiveRoutePlan.pickupDistanceKm,
          durationMinutes: effectiveRoutePlan.pickupDurationMinutes,
          etaText: buildTripEtaText(effectiveRoutePlan.pickupDurationMinutes),
        },
        destinationMetrics: {
          distanceKm: effectiveRoutePlan.destinationDistanceKm,
          durationMinutes: effectiveRoutePlan.destinationDurationMinutes,
          etaText: buildTripEtaText(effectiveRoutePlan.destinationDurationMinutes),
        },
      };
    } catch (error) {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao montar rota viva com duas pernas, usando fallback local:",
        error?.message || error,
      );

      const routePlan = buildFallbackLiveRoutePlan({
        originCoordinate: origin,
        pickupCoordinate: pickup,
        destinationCoordinate: destination,
      });
      const effectiveRoutePlan =
        cacheDriverRoutePlan({
          bookingId: resolvedBookingId,
          pickupCoordinate: pickup,
          destinationCoordinate: destination,
          routePlan,
        }) || routePlan;
      const activeMetrics = applyRoutePlanToMap({
        routePlan: effectiveRoutePlan,
        phase: "pickup",
        pickupCoordinate: pickup,
        pickupAddress,
        destinationCoordinate: destination,
        destinationLabel,
        destinationAddress,
        fallbackOrigin: origin,
      });

      return {
        routePlan: effectiveRoutePlan,
        activeMetrics,
        pickupMetrics: {
          distanceKm: effectiveRoutePlan.pickupDistanceKm,
          durationMinutes: effectiveRoutePlan.pickupDurationMinutes,
          etaText: buildTripEtaText(effectiveRoutePlan.pickupDurationMinutes),
        },
        destinationMetrics: {
          distanceKm: effectiveRoutePlan.destinationDistanceKm,
          durationMinutes: effectiveRoutePlan.destinationDurationMinutes,
          etaText: buildTripEtaText(effectiveRoutePlan.destinationDurationMinutes),
        },
      };
    }
  })();

  if (!inFlightKey) {
    return buildPromise;
  }

  runtimeRoutePlanInFlight.set(inFlightKey, buildPromise);
  try {
    return await buildPromise;
  } finally {
    runtimeRoutePlanInFlight.delete(inFlightKey);
  }
}

async function previewDriverPickupRoute({ origin, pickup, pickupAddress }) {
  if (
    !origin ||
    !pickup ||
    !Number.isFinite(origin.latitude) ||
    !Number.isFinite(origin.longitude) ||
    !Number.isFinite(pickup.latitude) ||
    !Number.isFinite(pickup.longitude)
  ) {
    return null;
  }

  const bookingId =
    runtimeState.driverActiveRide?.bookingId || runtimeState.activeBookingId || null;
  const destinationCoordinate = resolveDestinationCoordinateFromRide(
    runtimeState.driverActiveRide,
    runtimeState.selectedDestination,
    runtimeState.activeBooking,
  );
  const cachedRoutePlan =
    destinationCoordinate &&
    getCachedDriverRoutePlan({
      bookingId,
      pickupCoordinate: pickup,
      destinationCoordinate,
    });

  if (cachedRoutePlan) {
    const activeMetrics = applyRoutePlanToMap({
      routePlan: cachedRoutePlan,
      phase: "pickup",
      pickupCoordinate: pickup,
      pickupAddress,
      destinationCoordinate,
      destinationLabel:
        runtimeState.selectedDestination?.name ||
        runtimeState.driverActiveRide?.dropoff ||
        "Destino",
      destinationAddress:
        runtimeState.driverActiveRide?.dropoffAddress ||
        runtimeState.selectedDestination?.address ||
        runtimeState.selectedDestination?.name ||
        "Destino",
      fallbackOrigin: origin,
    });

    return {
      coordinates: cachedRoutePlan.pickupCoordinates,
      distanceKm: activeMetrics?.distanceKm ?? cachedRoutePlan.pickupDistanceKm,
      durationMinutes:
        activeMetrics?.durationMinutes ?? cachedRoutePlan.pickupDurationMinutes,
      etaText:
        activeMetrics?.etaText ||
        buildTripEtaText(cachedRoutePlan.pickupDurationMinutes),
    };
  }

  if (destinationCoordinate) {
    const fallbackRoutePlan =
      cacheDriverRoutePlan({
        bookingId,
        pickupCoordinate: pickup,
        destinationCoordinate,
        routePlan: buildFallbackLiveRoutePlan({
          originCoordinate: origin,
          pickupCoordinate: pickup,
          destinationCoordinate,
        }),
      }) ||
      buildFallbackLiveRoutePlan({
        originCoordinate: origin,
        pickupCoordinate: pickup,
        destinationCoordinate,
      });
    const activeMetrics = applyRoutePlanToMap({
      routePlan: fallbackRoutePlan,
      phase: "pickup",
      pickupCoordinate: pickup,
      pickupAddress,
      destinationCoordinate,
      destinationLabel:
        runtimeState.selectedDestination?.name ||
        runtimeState.driverActiveRide?.dropoff ||
        "Destino",
      destinationAddress:
        runtimeState.driverActiveRide?.dropoffAddress ||
        runtimeState.selectedDestination?.address ||
        runtimeState.selectedDestination?.name ||
        "Destino",
      fallbackOrigin: origin,
    });

    return {
      coordinates: fallbackRoutePlan.pickupCoordinates,
      distanceKm:
        activeMetrics?.distanceKm ?? fallbackRoutePlan.pickupDistanceKm,
      durationMinutes:
        activeMetrics?.durationMinutes ??
        fallbackRoutePlan.pickupDurationMinutes,
      etaText:
        activeMetrics?.etaText ||
        buildTripEtaText(fallbackRoutePlan.pickupDurationMinutes),
    };
  }

  const coordinates = buildFixedRouteCoordinates([], origin, pickup);
  const pickupMetrics = resolveRouteLegMetrics(null, coordinates);

  setPrototypeMapRoute({
    origin,
    destination: pickup,
    destinationLabel: "Embarque",
    destinationAddress: pickupAddress || "Local de embarque",
    coordinates,
  });

  return {
    coordinates,
    distanceKm: pickupMetrics.distanceKm,
    durationMinutes: pickupMetrics.durationMinutes,
    etaText: buildTripEtaText(pickupMetrics.durationMinutes),
  };
}

async function previewDriverDestinationRoute({
  origin,
  destination,
  destinationLabel,
  destinationAddress,
}) {
  if (
    !origin ||
    !destination ||
    !Number.isFinite(origin.latitude) ||
    !Number.isFinite(origin.longitude) ||
    !Number.isFinite(destination.latitude) ||
    !Number.isFinite(destination.longitude)
  ) {
    return null;
  }

  const bookingId =
    runtimeState.driverActiveRide?.bookingId || runtimeState.activeBookingId || null;
  const pickupCoordinate = resolvePickupCoordinateFromRide(
    runtimeState.driverActiveRide,
    runtimeState.activeBooking,
  );
  const cachedRoutePlan =
    pickupCoordinate &&
    getCachedDriverRoutePlan({
      bookingId,
      pickupCoordinate,
      destinationCoordinate: destination,
    });

  if (cachedRoutePlan) {
    const activeMetrics = applyRoutePlanToMap({
      routePlan: cachedRoutePlan,
      phase: "destination",
      pickupCoordinate,
      pickupAddress:
        runtimeState.driverTripMeta?.pickupAddress ||
        runtimeState.driverActiveRide?.pickupAddress ||
        runtimeState.driverActiveRide?.pickup ||
        "Local de embarque",
      destinationCoordinate: destination,
      destinationLabel: destinationLabel || "Destino",
      destinationAddress: destinationAddress || destinationLabel || "Destino",
      fallbackOrigin: origin,
    });

    return {
      coordinates: cachedRoutePlan.destinationCoordinates,
      distanceKm:
        activeMetrics?.distanceKm ?? cachedRoutePlan.destinationDistanceKm,
      durationMinutes:
        activeMetrics?.durationMinutes ??
        cachedRoutePlan.destinationDurationMinutes,
      etaText:
        activeMetrics?.etaText ||
        buildTripEtaText(cachedRoutePlan.destinationDurationMinutes),
    };
  }

  if (pickupCoordinate) {
    const fallbackRoutePlan =
      cacheDriverRoutePlan({
        bookingId,
        pickupCoordinate,
        destinationCoordinate: destination,
        routePlan: buildFallbackLiveRoutePlan({
          originCoordinate: origin,
          pickupCoordinate,
          destinationCoordinate: destination,
        }),
      }) ||
      buildFallbackLiveRoutePlan({
        originCoordinate: origin,
        pickupCoordinate,
        destinationCoordinate: destination,
      });
    const activeMetrics = applyRoutePlanToMap({
      routePlan: fallbackRoutePlan,
      phase: "destination",
      pickupCoordinate,
      pickupAddress:
        runtimeState.driverTripMeta?.pickupAddress ||
        runtimeState.driverActiveRide?.pickupAddress ||
        runtimeState.driverActiveRide?.pickup ||
        "Local de embarque",
      destinationCoordinate: destination,
      destinationLabel: destinationLabel || "Destino",
      destinationAddress: destinationAddress || destinationLabel || "Destino",
      fallbackOrigin: origin,
    });

    return {
      coordinates: fallbackRoutePlan.destinationCoordinates,
      distanceKm:
        activeMetrics?.distanceKm ??
        fallbackRoutePlan.destinationDistanceKm,
      durationMinutes:
        activeMetrics?.durationMinutes ??
        fallbackRoutePlan.destinationDurationMinutes,
      etaText:
        activeMetrics?.etaText ||
        buildTripEtaText(fallbackRoutePlan.destinationDurationMinutes),
    };
  }

  const coordinates = buildFixedRouteCoordinates([], origin, destination);
  const destinationMetrics = resolveRouteLegMetrics(null, coordinates);

  setPrototypeMapRoute({
    origin,
    destination,
    destinationLabel: destinationLabel || "Destino",
    destinationAddress: destinationAddress || destinationLabel || "Destino",
    coordinates,
  });

  return {
    coordinates,
    distanceKm: destinationMetrics.distanceKm,
    durationMinutes: destinationMetrics.durationMinutes,
    etaText: buildTripEtaText(destinationMetrics.durationMinutes),
  };
}

async function getRouteMetricsBetween(origin, destination) {
  if (
    !origin ||
    !destination ||
    !Number.isFinite(origin.latitude) ||
    !Number.isFinite(origin.longitude) ||
    !Number.isFinite(destination.latitude) ||
    !Number.isFinite(destination.longitude)
  ) {
    return {
      distanceKm: 0,
      durationSecs: 0,
    };
  }

  try {
    const startLoc = `${origin.latitude},${origin.longitude}`;
    const destLoc = `${destination.latitude},${destination.longitude}`;
    const telemetryContext = resolveRuntimeRideTelemetryContext({
      surface: "route_metrics",
    });
    const route = await getDirectionsApi(
      startLoc,
      destLoc,
      null,
      telemetryContext,
    );
    return {
      distanceKm: Math.max(
        0,
        Number(route?.distance_in_km || route?.distance || 0),
      ),
      durationSecs: Math.max(
        0,
        Number(route?.time_in_secs || route?.time || 0),
      ),
    };
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao obter métricas de rota:",
      error?.message || error,
    );
    return {
      distanceKm: 0,
      durationSecs: 0,
    };
  }
}

async function estimatePassengerEarlyEndMetrics() {
  const originalDistanceKm = Math.max(
    0,
    Number(
      runtimeState.activeBooking?.routeDistanceKm ||
        runtimeState.activeBooking?.distance ||
        runtimeState.tripDistanceKm ||
        0,
    ),
  );
  const originalDurationSecs = Math.max(
    0,
    Number(
      runtimeState.activeBooking?.routeDurationSecs ||
        runtimeState.activeBooking?.duration ||
        Number(runtimeState.tripDurationMin || 0) * 60 ||
        0,
    ),
  );

  const currentLocation = runtimeState.currentCoordinate || null;
  const destinationCoordinate =
    resolveDestinationCoordinateFromRide(
      runtimeState.driverActiveRide,
      runtimeState.selectedDestination,
      runtimeState.activeBooking,
    ) || null;

  const remainingMetrics = await getRouteMetricsBetween(
    currentLocation,
    destinationCoordinate,
  );
  const executedDistanceKm = Math.max(
    0,
    Number((originalDistanceKm - remainingMetrics.distanceKm).toFixed(2)),
  );
  const executedDurationSecs = Math.max(
    0,
    Math.round(originalDurationSecs - remainingMetrics.durationSecs),
  );

  return {
    distanceKm: executedDistanceKm,
    durationSecs: executedDurationSecs,
  };
}

function normalizeRuntimePlaceSearchLocation(locationCandidate = null) {
  if (
    Number.isFinite(locationCandidate?.lat) &&
    Number.isFinite(locationCandidate?.lng)
  ) {
    return {
      lat: Number(locationCandidate.lat),
      lng: Number(locationCandidate.lng),
    };
  }

  if (isRuntimeCoordinate(locationCandidate)) {
    return {
      lat: Number(locationCandidate.latitude),
      lng: Number(locationCandidate.longitude),
    };
  }

  if (runtimeState.currentCoordinate) {
    return {
      lat: runtimeState.currentCoordinate.latitude,
      lng: runtimeState.currentCoordinate.longitude,
    };
  }

  return {
    lat: PROTOTYPE_ORIGIN_COORDINATE.latitude,
    lng: PROTOTYPE_ORIGIN_COORDINATE.longitude,
  };
}

function scoreRuntimeDestinationResult(item, location) {
  const haystack = [
    item?.name,
    item?.address,
    item?.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 0;

  if (haystack.includes("rio de janeiro")) {
    score -= 180;
  }
  if (/\brj\b|-\s*rj\b/.test(haystack)) {
    score -= 90;
  }
  if (haystack.includes("brasil")) {
    score -= 12;
  }
  if (/\bms\b|mato grosso|campo grande/.test(haystack)) {
    score += 140;
  }

  if (item?.coordinate && location) {
    const distanceMeters = calculateDistanceMeters(
      { latitude: location.lat, longitude: location.lng },
      item.coordinate,
    );
    if (Number.isFinite(distanceMeters)) {
      score += Math.min(220, distanceMeters / 1000);
    }
  } else {
    score += 40;
  }

  return score;
}

async function findDestinations(query, options = {}) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    resetRuntimeDestinationSearchSession("query_cleared");
    try {
      const stored = await AsyncStorage.getItem(
        CONFIRMED_DESTINATIONS_STORAGE_KEY,
      );
      if (!stored) {
        return [];
      }

      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .slice(0, 3)
        .map((item) =>
          normalizeDestinationItem({
            ...item,
            sourceType: item?.sourceType || "confirmed_destination",
            previewMode: item?.previewMode || "local_only",
            skipGooglePreview:
              item?.skipGooglePreview !== undefined
                ? item.skipGooglePreview
                : true,
          }),
        )
        .filter((item) => item?.name || item?.address);
    } catch (error) {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao carregar destinos confirmados:",
        error?.message || error,
      );
      return [];
    }
  }
  if (normalizedQuery.length < DESTINATION_SEARCH_MIN_QUERY_LENGTH) {
    return [];
  }

  const location = normalizeRuntimePlaceSearchLocation(options?.location);
  const cachedResults = getCachedRuntimeDestinationSearchResults({
    query: normalizedQuery,
    location,
  });
  if (cachedResults && cachedResults.length > 0) {
    return cachedResults
      .slice()
      .sort((first, second) => (
        scoreRuntimeDestinationResult(first, location) -
        scoreRuntimeDestinationResult(second, location)
      ));
  }
  const telemetryContext = resolveRuntimeRideTelemetryContext({
    surface: "destination_search",
  });

  const inputType = detectInputType(normalizedQuery);
  const sessionToken = getRuntimeDestinationSearchSessionToken();

  let predictions = [];
  try {
    predictions = await fetchPlacesAutocomplete(
      normalizedQuery,
      sessionToken,
      location,
      telemetryContext,
    );
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha no autocomplete de destino:",
      error?.message || error,
    );
  }

  const shouldUseGeocodeFallback =
    inputType === "address" && normalizedQuery.length >= 6;
  if (
    (!Array.isArray(predictions) || predictions.length === 0) &&
    shouldUseGeocodeFallback
  ) {
    try {
      predictions = await fetchGeocodeAddress(
        normalizedQuery,
        location,
        telemetryContext,
      );
    } catch (error) {
      Logger.warn(
        `⚠️ [PrototypeRuntime] Falha no fallback geocode (${inputType}):`,
        error?.message || error,
      );
    }
  }

  if (!Array.isArray(predictions) || predictions.length === 0) {
    return [];
  }

  const normalizedResults = predictions.slice(0, 8).map((item) => {
    const description = item?.description || "";
    return normalizeDestinationItem({
      id: item?.place_id || description,
      place_id: item?.place_id || null,
      name:
        item?.structured_formatting?.main_text ||
        parseNameFromDescription(description),
      address:
        item?.structured_formatting?.secondary_text ||
        parseAddressFromDescription(description),
      description,
      coordinate:
        item?.location &&
        Number.isFinite(item.location?.lat) &&
        Number.isFinite(item.location?.lng)
          ? {
              latitude: Number(item.location.lat),
              longitude: Number(item.location.lng),
            }
          : null,
      searchSessionToken: item?.place_id ? sessionToken : null,
    });
  }).sort((first, second) => (
    scoreRuntimeDestinationResult(first, location) -
    scoreRuntimeDestinationResult(second, location)
  ));
  setCachedRuntimeDestinationSearchResults({
    query: normalizedQuery,
    location,
    results: normalizedResults,
  });
  return normalizedResults;
}

function resolveRuntimeFallbackProfile(profile = null) {
  if (profile?.uid) {
    return profile;
  }

  const uid = sanitizeText(runtimeState.profileUid || "");
  if (!uid) {
    return null;
  }

  const role = normalizeRuntimeRole(runtimeState.activeRole) || "customer";
  return {
    ...(runtimeState.riderProfile && typeof runtimeState.riderProfile === "object"
      ? runtimeState.riderProfile
      : {}),
    uid,
    id: uid,
    usertype: role,
    userType: role,
    role,
    name:
      runtimeState.profileName ||
      resolvePrototypeProfileName(runtimeState.riderProfile) ||
      "Leaf",
    phone: resolvePrototypeProfilePhone(runtimeState.riderProfile),
    phoneNumber: resolvePrototypeProfilePhone(runtimeState.riderProfile),
  };
}

async function requestPrototypeRide(profile, payload) {
  const requestProfile = resolveRuntimeFallbackProfile(profile);
  const userId = requestProfile?.uid;
  if (!userId) {
    throw new Error("Usuário não autenticado para solicitar corrida.");
  }

  const now = Date.now();
  const existingRequest = prototypeRideRequestInFlight;
  if (
    existingRequest?.userId === userId &&
    now - Number(existingRequest.startedAt || 0) < RIDE_REQUEST_IN_FLIGHT_WINDOW_MS
  ) {
    await writeRuntimeDebugProbe("create_booking_duplicate_in_flight_blocked", {
      userId,
      startedAt: existingRequest.startedAt || null,
    });
    throw new Error("Solicitação de corrida já está em andamento.");
  }

  const requestToken = createId("ride_request");
  prototypeRideRequestInFlight = {
    token: requestToken,
    userId,
    startedAt: now,
  };

  try {
  const telemetryContext = resolveRuntimeRideTelemetryContext({
    userId: requestProfile?.uid,
    role: resolveRuntimeRole(requestProfile),
    surface: "ride_request",
  });
  const destinationInput = normalizeDestinationItem(
    payload?.destination || runtimeState.selectedDestination || {},
  );
  const destination = await resolveDestinationCoordinate(destinationInput);

  if (!destination?.coordinate) {
    throw new Error("Destino sem coordenadas válidas.");
  }

  const socketReady = await ensureSocketReady(requestProfile);
  await writeRuntimeDebugProbe("create_booking_socket_ready", {
    userId,
    socketReady,
    status: WebSocketManager.getInstance().getConnectionStatus(),
  });
  if (!socketReady) {
    throw new Error(
      runtimeState.socketError || "Serviço de corridas indisponível.",
    );
  }

  const origin = getPayloadOriginCoordinate(payload);
  const originAddress =
    resolveMeaningfulAddress(
      payload?.pickupLocation?.add ||
        payload?.pickupLocation?.address ||
        payload?.originAddress,
      runtimeState.currentAddress,
    ) || "Origem atual";
  const vehicle =
    payload?.vehicle || runtimeState.selectedVehicle || "Leaf Plus";
  const operationalVehicleType = resolveOperationalVehicleType(vehicle);
  const fare = Number(payload?.fare ?? runtimeState.selectedFare ?? 0);
  const paymentMethod =
    payload?.paymentMethod || runtimeState.paymentMethod || "pix";
  const paymentConfirmation =
    payload?.paymentConfirmation &&
    typeof payload.paymentConfirmation === "object"
      ? payload.paymentConfirmation
      : null;
  const paymentChargeId = sanitizeText(paymentConfirmation?.chargeId, "");
  const paymentReferenceRideId = sanitizeText(paymentConfirmation?.rideId, "");
  const paymentAmountInCentsCandidate = Number(
    paymentConfirmation?.amountInCents,
  );
  const paymentAmountFallbackInCents =
    Number.isFinite(fare) && fare > 0 ? Math.round(Number(fare) * 100) : NaN;
  const paymentAmountInCents =
    Number.isFinite(paymentAmountInCentsCandidate) &&
    paymentAmountInCentsCandidate > 0
      ? Math.round(paymentAmountInCentsCandidate)
      : paymentAmountFallbackInCents;
  const paymentDiscountBenefit =
    paymentConfirmation?.discountBenefit &&
    typeof paymentConfirmation.discountBenefit === "object"
      ? { ...paymentConfirmation.discountBenefit }
      : null;
  const paymentGrossAmountInCentsCandidate = Number(
    paymentConfirmation?.grossAmountInCents,
  );
  const paymentGrossAmountInCents =
    Number.isFinite(paymentGrossAmountInCentsCandidate) &&
    paymentGrossAmountInCentsCandidate > 0
      ? Math.round(paymentGrossAmountInCentsCandidate)
      : paymentAmountInCents;
  const ridePreferences =
    payload?.preferences && typeof payload.preferences === "object"
      ? { ...payload.preferences }
      : {};

  if (!paymentChargeId) {
    throw new Error(
      "Pagamento PIX não confirmado. Gere e confirme o pagamento antes de solicitar a corrida.",
    );
  }

  if (!Number.isFinite(paymentAmountInCents) || paymentAmountInCents <= 0) {
    throw new Error(
      "Valor do pagamento inválido. Confirme o PIX novamente para solicitar a corrida.",
    );
  }

  const bookingData = {
    customerId: userId,
    pickupLocation: {
      lat: Number(origin.latitude),
      lng: Number(origin.longitude),
      add: originAddress,
    },
    destinationLocation: {
      lat: Number(destination.coordinate.latitude),
      lng: Number(destination.coordinate.longitude),
      add: destination.address || destination.name || "Destino",
    },
    estimatedFare: Number.isFinite(fare) ? fare : 0,
    carType: operationalVehicleType,
    paymentMethod,
    paymentStatus: "in_holding",
    paymentId: paymentChargeId,
    paymentData: {
      chargeId: paymentChargeId,
      rideId: paymentReferenceRideId,
      amountInCents: paymentAmountInCents,
      grossAmountInCents: paymentGrossAmountInCents,
      discountBenefit: paymentDiscountBenefit,
      paymentStatus: "in_holding",
      confirmedAt: new Date().toISOString(),
    },
    preferences: ridePreferences,
  };
  const provisionalOffer = buildDriverOffer({
    bookingId: runtimeState.activeBookingId || `pending-${Date.now()}`,
    destination,
    fare,
    etaMinutes: runtimeState.tripDurationMin,
    pickupAddress: originAddress,
    pickupCoordinate: origin,
    preferences: ridePreferences,
    passengerName: runtimeState.profileName,
  });

  stopBoardingCountdownTimer();
  setRuntimeState({
    bookingStatus: "requesting",
    activeBooking: {
      ...(runtimeState.activeBooking && typeof runtimeState.activeBooking === "object"
        ? runtimeState.activeBooking
        : {}),
      bookingId: runtimeState.activeBookingId || null,
      status: "REQUESTING",
      estimatedFare: Number.isFinite(fare) ? fare : 0,
      pickupLocation: bookingData.pickupLocation,
      destinationLocation: bookingData.destinationLocation,
      carType: operationalVehicleType,
      paymentStatus: "in_holding",
      grossEstimatedFare: paymentGrossAmountInCents / 100,
      discountBenefit: paymentDiscountBenefit,
      preferences: ridePreferences,
    },
    selectedDestination: destination,
    selectedFare: Number.isFinite(fare) ? fare : runtimeState.selectedFare,
    selectedVehicle: vehicle,
    paymentMethod,
    paymentState: {
      status: "processing",
      paymentId: paymentChargeId,
      amount: Number.isFinite(fare) ? fare : 0,
      method: paymentMethod,
      error: "",
      refundStatus: null,
      refundAmount: 0,
      cancellationFee: 0,
      refundId: null,
      chargeId: paymentChargeId,
    },
    driverOffers: mergeDriverOffers(
      runtimeState.driverOffers,
      provisionalOffer,
    ),
    driverActiveRide: null,
    tripIntegrityAlert: {
      active: false,
      reason: "",
      message: "",
      distanceMeters: null,
      thresholdMeters: null,
      confirmationTimeoutSec: null,
      updatedAt: null,
    },
    activeChatId: null,
    activeChatBookingId: null,
    chatMessages: [],
    chatError: "",
    lastError: "",
  });

	  const socket = WebSocketManager.getInstance();
	  const shouldMaterializeBypassPaymentHolding =
	    allowForcedPaymentBypass() &&
	    Boolean(paymentChargeId) &&
	    (paymentConfirmation?.bypassed === true ||
	      paymentConfirmation?.mockPayment === true ||
	      String(paymentChargeId).startsWith("qa_bypass_"));
	  if (shouldMaterializeBypassPaymentHolding) {
	    await writeRuntimeDebugProbe("create_booking_confirming_bypass_payment", {
	      userId,
	      paymentChargeId,
	      paymentReferenceRideId,
	      amountInCents: paymentAmountInCents,
	      holdingKey: paymentChargeId,
	    });

	    try {
	      await socket.confirmPayment({
	        bookingId: paymentChargeId,
	        paymentMethod,
	        paymentId: paymentChargeId,
	        chargeId: paymentChargeId,
	        amount: paymentAmountInCents / 100,
	        mockPayment: true,
	        __mockPayment: true,
	        enforceFareLock: false,
	        preBooking: true,
	        idempotencyKey: `mobile_bypass_payment_${paymentChargeId}`,
	      });
	    } catch (error) {
	      await writeRuntimeDebugProbe("create_booking_bypass_payment_error", {
	        userId,
	        paymentChargeId,
	        paymentReferenceRideId,
	        message: error?.message || String(error),
	        code: error?.code || null,
	      });
	      throw new Error(
	        "Não foi possível confirmar o pagamento de teste no servidor.",
	      );
	    }
	  }
	  await writeRuntimeDebugProbe("create_booking_before_await", {
	    userId,
	    bookingData: {
      customerId: bookingData.customerId,
      carType: bookingData.carType,
      estimatedFare: bookingData.estimatedFare,
      paymentId: bookingData.paymentId,
      pickupLocation: bookingData.pickupLocation,
      destinationLocation: bookingData.destinationLocation,
    },
    status: socket.getConnectionStatus(),
  });

  let response = null;
  try {
    response = await socket.createBooking(bookingData, {
      telemetryContext,
    });
  } catch (error) {
    await writeRuntimeDebugProbe("create_booking_error", {
      userId,
      message: error?.message || String(error),
      code: error?.code || null,
      retryAfterSec: error?.retryAfterSec || null,
      status: socket.getConnectionStatus(),
    });
    throw error;
  }

  await writeRuntimeDebugProbe("create_booking_response", {
    userId,
    bookingId:
      response?.bookingId ||
      response?.data?.bookingId ||
      response?.booking?.bookingId ||
      null,
    status: socket.getConnectionStatus(),
  });
  const bookingId =
    response?.bookingId ||
    response?.data?.bookingId ||
    response?.booking?.bookingId ||
    null;
  bindRuntimeRideTelemetryToBooking(bookingId, {
    userId: requestProfile?.uid,
    role: resolveRuntimeRole(requestProfile),
    surface: "ride_request",
  });
  const bookingTimestamp =
    response?.booking?.timestamp ||
    response?.data?.timestamp ||
    response?.booking?.requestedAt ||
    response?.data?.requestedAt ||
    response?.booking?.createdAt ||
    response?.data?.createdAt ||
    response?.booking?.paymentData?.confirmedAt ||
    response?.data?.paymentData?.confirmedAt ||
    new Date().toISOString();
  startSearchingTimer();

  setRuntimeState({
    bookingStatus: "searching",
    activeBookingId: bookingId,
    activeBooking: {
      ...((response?.booking || response?.data) &&
      typeof (response?.booking || response?.data) === "object"
        ? response?.booking || response?.data
        : {}),
      bookingId: bookingId || runtimeState.activeBookingId || null,
      timestamp: bookingTimestamp,
      requestedAt:
        response?.booking?.requestedAt ||
        response?.data?.requestedAt ||
        bookingTimestamp,
      createdAt:
        response?.booking?.createdAt ||
        response?.data?.createdAt ||
        bookingTimestamp,
      pickupLocation:
        response?.booking?.pickupLocation ||
        response?.data?.pickupLocation ||
        bookingData.pickupLocation,
      destinationLocation:
        response?.booking?.destinationLocation ||
        response?.data?.destinationLocation ||
        bookingData.destinationLocation,
      preferences:
        response?.booking?.preferences ||
        response?.data?.preferences ||
        ridePreferences,
    },
    driverOffers: mergeDriverOffers(runtimeState.driverOffers, {
      ...provisionalOffer,
      id: bookingId || provisionalOffer.id,
      bookingId: bookingId || provisionalOffer.bookingId,
      preferences:
        response?.booking?.preferences ||
        response?.data?.preferences ||
        ridePreferences,
    }),
    paymentState: {
      status: "confirmed",
      paymentId: paymentChargeId,
      amount: Number.isFinite(fare) ? fare : 0,
      method: paymentMethod,
      confirmedAt: bookingTimestamp,
      error: "",
      refundStatus: null,
      refundAmount: 0,
      cancellationFee: 0,
      refundId: null,
      chargeId: paymentChargeId,
    },
    lastError: "",
  });

  return {
    success: true,
    bookingId,
    raw: response,
  };
  } finally {
    if (prototypeRideRequestInFlight?.token === requestToken) {
      prototypeRideRequestInFlight = null;
    }
  }
}

async function checkPrototypeRideAvailability(profile, payload) {
  const telemetryContext = resolveRuntimeRideTelemetryContext({
    userId: profile?.uid,
    role: resolveRuntimeRole(profile),
    surface: "availability_check",
  });
  const destinationInput = normalizeDestinationItem(
    payload?.destination || runtimeState.selectedDestination || {},
  );
  const destination = await resolveDestinationCoordinate(destinationInput);
  const userId = profile?.uid;

  if (!userId) {
    throw new Error("Usuário não autenticado para validar disponibilidade.");
  }

  const socketReady = await ensureSocketReady(profile);
  if (!socketReady) {
    throw new Error(
      runtimeState.socketError || "Serviço de corridas indisponível.",
    );
  }

  const origin = getPayloadOriginCoordinate(payload);
  const originAddress =
    resolveMeaningfulAddress(
      payload?.pickupLocation?.add ||
        payload?.pickupLocation?.address ||
        payload?.originAddress,
      runtimeState.currentAddress,
    ) || "Origem atual";
  const vehicle =
    payload?.vehicle || runtimeState.selectedVehicle || "Leaf Plus";
  const operationalVehicleType = resolveOperationalVehicleType(vehicle);
  const socket = WebSocketManager.getInstance();

  return socket.checkRideAvailability({
    customerId: userId,
    pickupLocation: {
      lat: Number(origin.latitude),
      lng: Number(origin.longitude),
      add: originAddress,
    },
    destinationLocation: destination?.coordinate
      ? {
          lat: Number(destination.coordinate.latitude),
          lng: Number(destination.coordinate.longitude),
        }
      : null,
    carType: operationalVehicleType,
    preferences:
      payload?.preferences && typeof payload.preferences === "object"
        ? { ...payload.preferences }
        : {},
  }, {
    telemetryContext,
  });
}

async function cancelPrototypeRide(options = {}) {
  const reason = sanitizeText(
    options?.reason,
    "Cancelado pelo passageiro.",
  );
  const suppressReason = sanitizeText(
    options?.suppressReason,
    "passenger_cancel_request",
  );
  const bookingId = runtimeState.activeBookingId;
  if (!bookingId) {
    throw new Error("Nenhuma busca ativa para cancelar.");
  }

  let cancelResponse = null;
  try {
    const socket = WebSocketManager.getInstance();
    if (!socket.isConnected()) {
      throw new Error(
        "Sem conexão com o servidor. A corrida continua ativa; tente novamente ou fale com o suporte.",
      );
    }
    cancelResponse = await socket.cancelRide(
      bookingId,
      reason,
    );
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao cancelar corrida no backend:",
      error?.message || error,
    );
    setRuntimeState({
      lastError:
        error?.message ||
        "Não foi possível cancelar no servidor. A corrida continua ativa.",
    });
    throw error;
  }

  suppressBookingEvents(bookingId, suppressReason);

  const refundData = cancelResponse?.data || {};
  const refundAmount = Number(refundData?.refundAmount || 0);
  const cancellationFee = Number(refundData?.cancellationFee || 0);

  stopSearchingTimer();
  stopBoardingCountdownTimer();
  stopPassengerLocationHeartbeat();
  setRuntimeState({
    bookingStatus: "idle",
    activeBookingId: null,
    activeBooking: null,
    driverOffers: [],
    driverActiveRide: null,
    boardingDeadlineAt: null,
    boardingRemainingSec: 0,
    tripArrivalText: "",
    paymentState: {
      status: refundData?.refundStatus ? "refunded" : "idle",
      paymentId:
        refundData?.chargeId || runtimeState.paymentState?.paymentId || null,
      amount: Number.isFinite(refundAmount) ? refundAmount : 0,
      method: runtimeState.paymentMethod || "pix",
      error: "",
      refundStatus: refundData?.refundStatus || null,
      refundAmount: Number.isFinite(refundAmount) ? refundAmount : 0,
      cancellationFee: Number.isFinite(cancellationFee) ? cancellationFee : 0,
      refundId: refundData?.refundId || null,
      chargeId:
        refundData?.chargeId || runtimeState.paymentState?.chargeId || null,
    },
    driverInfo: null,
    driverCoordinate: null,
    tripIntegrityAlert: {
      active: false,
      reason: "",
      message: "",
      distanceMeters: null,
      thresholdMeters: null,
      confirmationTimeoutSec: null,
      updatedAt: null,
    },
    searchingElapsedSeconds: 0,
    lastError: cancelResponse?.message || "Corrida cancelada.",
  });

  return cancelResponse;
}

async function arrivePrototypePickup(profile, options = {}) {
  if (resolveRuntimeRole(profile) !== "driver") {
    throw new Error("Somente o motorista pode registrar chegada ao embarque.");
  }
  const bookingId =
    runtimeState.activeBookingId ||
    runtimeState.driverActiveRide?.bookingId ||
    null;
  if (!bookingId) {
    throw new Error("Nenhuma corrida ativa para registrar chegada.");
  }

  const locationPayload = {
    lat:
      Number(options?.locationOverride?.lat) ||
      Number(options?.locationOverride?.latitude) ||
      runtimeState.driverCoordinate?.latitude ||
      runtimeState.currentCoordinate?.latitude,
    lng:
      Number(options?.locationOverride?.lng) ||
      Number(options?.locationOverride?.longitude) ||
      runtimeState.driverCoordinate?.longitude ||
      runtimeState.currentCoordinate?.longitude,
  };
  if (
    !Number.isFinite(locationPayload.lat) ||
    !Number.isFinite(locationPayload.lng)
  ) {
    throw new Error("Não foi possível validar sua localização atual.");
  }

  const socket = await getRealtimeSocket(
    profile,
    "Serviço indisponível para registrar chegada.",
  );
  if (!socket?.isConnected()) {
    throw new Error("Serviço indisponível para registrar chegada.");
  }

  const driverId = sanitizeText(profile?.uid || runtimeState.profileUid, "");
  if (driverId) {
    try {
      await socket.updateDriverLocation(
        driverId,
        Number(locationPayload.lat),
        Number(locationPayload.lng),
        runtimeState.currentHeading || 0,
        0,
      );
    } catch (error) {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao sincronizar localização antes do embarque:",
        error?.message || error,
      );
    }
  }

  let response = null;
  let actionError = null;
  try {
    response = await socket.arriveAtPickup(bookingId, locationPayload);
  } catch (error) {
    actionError = error;
    Logger.warn(
      "⚠️ [PrototypeRuntime] arriveAtPickup sem ACK imediato, tentando ressincronizar:",
      error?.message || error,
    );
  }

  if (!response?.success) {
    try {
      await refreshPrototypeRealtimeSession(profile, {
        reason: "arrive_at_pickup_fallback",
        syncActiveRide: true,
        timeoutMs: 6000,
      });
    } catch (syncError) {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Ressincronização da corrida após chegada falhou:",
        syncError?.message || syncError,
      );
    }

    const recoveredBySync =
      runtimeState.activeBookingId === bookingId &&
      String(runtimeState.bookingStatus || "").trim().toLowerCase() ===
        "arrived";

    if (!recoveredBySync) {
      throw (
        actionError ||
        new Error("Não foi possível registrar chegada ao embarque.")
      );
    }

    response = {
      success: true,
      bookingId,
      boardingWindowSec:
        Number(runtimeState.boardingRemainingSec || 120) || 120,
      boardingDeadlineAt: runtimeState.boardingDeadlineAt || null,
      pickupToleranceReached: true,
      distanceMeters: 0,
      toleranceMeters: PICKUP_TOLERANCE_METERS,
      recoveredFromSync: true,
    };
  }

  const configuredWindowSec = Number(response?.boardingWindowSec || 120);
  const normalizedWindowSec = Math.max(
    30,
    Number.isFinite(configuredWindowSec)
      ? Math.round(configuredWindowSec)
      : 120,
  );
  const deadlineAt = response?.boardingDeadlineAt
    ? new Date(response.boardingDeadlineAt).toISOString()
    : new Date(Date.now() + normalizedWindowSec * 1000).toISOString();
  startBoardingCountdown(deadlineAt);
  setRuntimeState((previous) => ({
    bookingStatus: "arrived",
    tripArrivalText: "Passageiro embarcando",
    boardingDeadlineAt: deadlineAt,
    boardingRemainingSec: normalizedWindowSec,
    driverActiveRide:
      previous.driverActiveRide && typeof previous.driverActiveRide === "object"
        ? {
            ...previous.driverActiveRide,
            status: "arrived",
          }
        : previous.driverActiveRide,
    driverTripMeta: {
      ...(previous.driverTripMeta || {}),
      leg: "boarding",
    },
    lastError: "",
  }));

  return {
    success: true,
    bookingId,
    boardingDeadlineAt: deadlineAt,
    pickupToleranceReached: response?.pickupToleranceReached === true,
    distanceMeters: response?.distanceMeters ?? null,
    toleranceMeters: response?.toleranceMeters ?? null,
  };
}

async function confirmPrototypeBoardingStatus(profile, boarded = true) {
  const bookingId = runtimeState.activeBookingId;
  if (!bookingId) {
    throw new Error("Nenhuma corrida ativa para confirmar embarque.");
  }

  try {
    const socket = await getRealtimeSocket(
      profile,
      "Serviço indisponível para confirmar embarque.",
    );
    if (socket?.isConnected()) {
      const response = await socket.confirmBoardingStatus(bookingId, boarded);
      if (boarded) {
        setRuntimeState({
          tripIntegrityAlert: {
            active: false,
            reason: "",
            message: "",
            distanceMeters: null,
            thresholdMeters: null,
            confirmationTimeoutSec: null,
            updatedAt: new Date().toISOString(),
          },
        });
      }
      return response;
    }
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] confirmBoardingStatus remoto falhou:",
      error?.message || error,
    );
    throw error;
  }

  return { success: false, bookingId, boarded: Boolean(boarded) };
}

async function startPrototypeTrip(options = {}) {
  if (resolveRuntimeRole() !== "driver") {
    throw new Error("Somente o motorista pode iniciar a corrida.");
  }
  const bookingId = runtimeState.activeBookingId;
  const locationOverride = options?.locationOverride || null;
  if (!bookingId) {
    if (!allowRuntimeLocalRideLifecycleFallback()) {
      throw new Error("Nenhuma corrida ativa para iniciar.");
    }
    stopBoardingCountdownTimer();
    setRuntimeState({
      bookingStatus: "started",
      boardingDeadlineAt: null,
      boardingRemainingSec: 0,
      tripArrivalText: "",
      driverTripMeta: {
        ...(runtimeState.driverTripMeta || {}),
        leg: "destination",
      },
      driverActiveRide: runtimeState.driverActiveRide
        ? {
            ...runtimeState.driverActiveRide,
            status: "started",
          }
        : runtimeState.driverActiveRide,
    });
    return { success: true, localOnly: true };
  }

  const allowLocalFallback = allowRuntimeLocalRideLifecycleFallback();

  try {
    const socket = WebSocketManager.getInstance();
    if (!socket.isConnected()) {
      throw new Error("Serviço indisponível para iniciar a corrida.");
    }

    const startLocation = {
      lat:
        Number(locationOverride?.lat) ||
        Number(locationOverride?.latitude) ||
        runtimeState.driverCoordinate?.latitude ||
        runtimeState.currentCoordinate.latitude,
      lng:
        Number(locationOverride?.lng) ||
        Number(locationOverride?.longitude) ||
        runtimeState.driverCoordinate?.longitude ||
        runtimeState.currentCoordinate.longitude,
    };
    await socket.startTrip(bookingId, startLocation);
  } catch (error) {
    if (!allowLocalFallback) {
      Logger.warn(
        "⚠️ [PrototypeRuntime] startTrip remoto falhou; mantendo estado atual:",
        error?.message || error,
      );
      throw error;
    }
    Logger.warn(
      "⚠️ [PrototypeRuntime] startTrip remoto falhou; fallback local permitido por QA:",
      error?.message || error,
    );
  }

  stopBoardingCountdownTimer();

  const pickupCoordinate = resolvePickupCoordinateFromRide(
    runtimeState.driverActiveRide,
    runtimeState.activeBooking,
  );
  const destinationCoordinate = resolveDestinationCoordinateFromRide(
    runtimeState.driverActiveRide,
    runtimeState.selectedDestination,
    runtimeState.activeBooking,
  );
  const startCoordinateOverride =
    Number.isFinite(
      Number(locationOverride?.latitude ?? locationOverride?.lat),
    ) &&
    Number.isFinite(
      Number(locationOverride?.longitude ?? locationOverride?.lng),
    )
      ? {
          latitude: Number(locationOverride?.latitude ?? locationOverride?.lat),
          longitude: Number(
            locationOverride?.longitude ?? locationOverride?.lng,
          ),
        }
      : null;
  const startCoordinate =
    startCoordinateOverride ||
    runtimeState.driverCoordinate ||
    runtimeState.currentCoordinate ||
    null;
  const storedRoutePlan = resolveDriverRoutePlan({
    bookingId,
    driverTripMeta: runtimeState.driverTripMeta,
    pickupCoordinate,
    destinationCoordinate,
  });
  let destinationPreview = null;
  if (storedRoutePlan) {
    destinationPreview = applyRoutePlanToMap({
      routePlan: storedRoutePlan,
      phase: "destination",
      pickupCoordinate,
      pickupAddress:
        runtimeState.driverTripMeta?.pickupAddress ||
        runtimeState.driverActiveRide?.pickupAddress ||
        runtimeState.driverActiveRide?.pickup ||
        "Local de embarque",
      destinationCoordinate,
      destinationLabel:
        runtimeState.selectedDestination?.name ||
        runtimeState.driverActiveRide?.dropoff ||
        "Destino",
      destinationAddress:
        runtimeState.driverActiveRide?.dropoffAddress ||
        runtimeState.selectedDestination?.address ||
        runtimeState.selectedDestination?.name ||
        "Destino",
      fallbackOrigin: startCoordinate,
    });
  } else if (startCoordinate && pickupCoordinate && destinationCoordinate) {
    const routePlanResult = await buildLiveTripRoutePlan({
      origin: startCoordinate,
      pickup: pickupCoordinate,
      pickupAddress:
        runtimeState.driverTripMeta?.pickupAddress ||
        runtimeState.driverActiveRide?.pickupAddress ||
        runtimeState.driverActiveRide?.pickup ||
        "Local de embarque",
      destination: destinationCoordinate,
      destinationLabel:
        runtimeState.selectedDestination?.name ||
        runtimeState.driverActiveRide?.dropoff ||
        "Destino",
      destinationAddress:
        runtimeState.driverActiveRide?.dropoffAddress ||
        runtimeState.selectedDestination?.address ||
        runtimeState.selectedDestination?.name ||
        "Destino",
      telemetryContext: resolveRuntimeRideTelemetryContext({
        bookingId,
        role: "driver",
        surface: "driver_live_route_prefetch",
      }),
    });
    const persistedRoutePlan = ensurePersistedDriverRoutePlan({
      bookingId,
      pickupCoordinate,
      destinationCoordinate,
      routePlan: routePlanResult?.routePlan,
      fallbackOriginCoordinate: startCoordinate,
    });
    if (persistedRoutePlan) {
      destinationPreview = applyRoutePlanToMap({
        routePlan: persistedRoutePlan,
        phase: "destination",
        pickupCoordinate,
        pickupAddress:
          runtimeState.driverTripMeta?.pickupAddress ||
          runtimeState.driverActiveRide?.pickupAddress ||
          runtimeState.driverActiveRide?.pickup ||
          "Local de embarque",
        destinationCoordinate,
        destinationLabel:
          runtimeState.selectedDestination?.name ||
          runtimeState.driverActiveRide?.dropoff ||
          "Destino",
        destinationAddress:
          runtimeState.driverActiveRide?.dropoffAddress ||
          runtimeState.selectedDestination?.address ||
          runtimeState.selectedDestination?.name ||
          "Destino",
        fallbackOrigin: startCoordinate,
      }) || {
        distanceKm: routePlanResult?.destinationMetrics?.distanceKm ?? null,
        durationMinutes: routePlanResult?.destinationMetrics?.durationMinutes ?? null,
        etaText: routePlanResult?.destinationMetrics?.etaText || "",
      };
    }
  }

  const baselineDistanceKm = Number(destinationPreview?.distanceKm);
  const baselineDurationMinutes = Number(destinationPreview?.durationMinutes);

  setRuntimeState({
    bookingStatus: "started",
    boardingDeadlineAt: null,
    boardingRemainingSec: 0,
    ...(startCoordinate ? { currentCoordinate: startCoordinate } : {}),
    tripDistanceKm:
      Number.isFinite(baselineDistanceKm) && baselineDistanceKm > 0
        ? baselineDistanceKm
        : runtimeState.tripDistanceKm,
    tripDurationMin:
      Number.isFinite(baselineDurationMinutes) && baselineDurationMinutes > 0
        ? Math.max(1, Math.round(baselineDurationMinutes))
        : runtimeState.tripDurationMin,
    tripArrivalText: destinationPreview?.etaText || "",
    driverTripMeta: {
      ...(runtimeState.driverTripMeta || {}),
      leg: "destination",
      initialMeters:
        Number.isFinite(baselineDistanceKm) && baselineDistanceKm > 0
          ? Math.round(baselineDistanceKm * 1000)
          : runtimeState.driverTripMeta?.initialMeters,
      initialEtaMinutes:
        Number.isFinite(baselineDurationMinutes) && baselineDurationMinutes > 0
          ? Math.max(1, Math.round(baselineDurationMinutes))
          : runtimeState.driverTripMeta?.initialEtaMinutes,
      routePlan:
        getCachedDriverRoutePlan({
          bookingId,
          pickupCoordinate,
          destinationCoordinate,
        }) ||
        runtimeState.driverTripMeta?.routePlan ||
        null,
      destinationCoordinate,
      destinationAddress:
        runtimeState.driverActiveRide?.dropoffAddress ||
        runtimeState.selectedDestination?.address ||
        runtimeState.selectedDestination?.name ||
        runtimeState.driverTripMeta?.destinationAddress ||
        "Destino",
    },
    driverActiveRide: runtimeState.driverActiveRide
      ? {
          ...runtimeState.driverActiveRide,
          status: "started",
        }
      : runtimeState.driverActiveRide,
  });
  return { success: true };
}

async function completePrototypeTrip(options = {}) {
  if (resolveRuntimeRole() !== "driver") {
    throw new Error("Somente o motorista pode finalizar a corrida.");
  }
  const bookingId = runtimeState.activeBookingId;
  const completedPricingSnapshot = resolveCompletedTripFinancialSnapshot(
    {
      fare:
        runtimeState.selectedFare ||
        runtimeState.activeBooking?.estimatedFare ||
        0,
    },
    runtimeState,
  );
  const fare = completedPricingSnapshot.finalFare;
  const receiptParticipants = resolveReceiptParticipants();
  const locationOverride = options?.locationOverride || null;
  const completedRoute = getPrototypeMapRoute();
  const receiptPickupCoordinate =
    resolvePickupCoordinateFromRide(
      runtimeState.driverActiveRide,
      runtimeState.activeBooking,
    ) ||
    runtimeState.driverTripMeta?.pickupCoordinate ||
    null;
  const receiptDestinationCoordinate =
    resolveDestinationCoordinateFromRide(
      runtimeState.driverActiveRide,
      runtimeState.selectedDestination,
      runtimeState.activeBooking,
    ) ||
    runtimeState.driverTripMeta?.destinationCoordinate ||
    null;
  const receiptRouteCoordinates = resolveCompletedReceiptRouteCoordinates(
    completedRoute?.coordinates,
    receiptPickupCoordinate,
    receiptDestinationCoordinate,
  );
  const distanceKm = resolveCompletedTripDistanceKm({
    runtimeDistance: runtimeState.tripDistanceKm,
    routeCoordinates: receiptRouteCoordinates,
    pickupCoordinate: receiptPickupCoordinate,
    destinationCoordinate: receiptDestinationCoordinate,
    initialMeters: runtimeState.driverTripMeta?.initialMeters,
  });
  const durationMin = resolveCompletedTripDurationMin({
    runtimeDurationMinutes: runtimeState.tripDurationMin,
    routeDurationMinutes:
      runtimeState.driverTripMeta?.routePlan?.destinationDurationMinutes ??
      runtimeState.driverTripMeta?.initialEtaMinutes,
    distanceKm,
  });

  const finalizeLocalCompletion = () => {
    const fallbackReceipt = {
      pickupAddress: resolveCompletedReceiptPickupLabel({}, runtimeState),
      destinationAddress: resolveCompletedReceiptDropoffLabel(
        {},
        runtimeState,
      ),
      completedAt: new Date().toISOString(),
      id: bookingId || `local-${Date.now()}`,
      date: new Date().toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }),
      route: buildCompletedReceiptRouteLabel({}, runtimeState),
      value: formatCurrencyBRL(fare),
      fare,
      distanceKm,
      durationMin,
      paymentMethod: runtimeState.paymentMethod || "pix",
      driverId: receiptParticipants.driverId || null,
      driverName: receiptParticipants.driverName || null,
      passengerId: receiptParticipants.passengerId || null,
      passengerName: receiptParticipants.passengerName || null,
      ...completedPricingSnapshot,
      pickup: resolveCompletedReceiptPickupLabel({}, runtimeState),
      drop: resolveCompletedReceiptDropoffLabel({}, runtimeState),
      dropoffAddress: resolveCompletedReceiptDropoffLabel({}, runtimeState),
      ...(receiptPickupCoordinate
        ? { pickupCoordinate: receiptPickupCoordinate }
        : {}),
      ...(receiptDestinationCoordinate
        ? { destinationCoordinate: receiptDestinationCoordinate }
        : {}),
      ...(receiptRouteCoordinates.length >= 2
        ? { routeCoordinates: receiptRouteCoordinates }
        : {}),
    };

    stopSearchingTimer();
    stopBoardingCountdownTimer();
    stopPassengerLocationHeartbeat();
    setRuntimeState({
      bookingStatus: "completed",
      activeBookingId: null,
      activeBooking: null,
      driverOffers: [],
      driverActiveRide: null,
      paymentState: {
        status: "settled",
        paymentId: runtimeState.paymentState?.paymentId || null,
        amount: fare,
        method: runtimeState.paymentMethod || "pix",
        error: "",
        refundStatus: runtimeState.paymentState?.refundStatus || null,
        refundAmount: runtimeState.paymentState?.refundAmount || 0,
        cancellationFee: runtimeState.paymentState?.cancellationFee || 0,
        refundId: runtimeState.paymentState?.refundId || null,
        chargeId: runtimeState.paymentState?.chargeId || null,
      },
      driverCoordinate: null,
      driverTripMeta: createDefaultDriverTripMeta(),
      boardingDeadlineAt: null,
      boardingRemainingSec: 0,
      tripIntegrityAlert: {
        active: false,
        reason: "",
        message: "",
        distanceMeters: null,
        thresholdMeters: null,
        confirmationTimeoutSec: null,
        updatedAt: null,
      },
      tripArrivalText: "",
      searchingElapsedSeconds: 0,
    });
    pushTripHistoryItem(fallbackReceipt);

    return {
      success: true,
      receipt: fallbackReceipt,
      localFallback: true,
    };
  };

  const allowLocalFallback = allowRuntimeLocalRideLifecycleFallback();

  if (bookingId) {
    const socket = WebSocketManager.getInstance();
    if (!socket.isConnected()) {
      if (!allowLocalFallback) {
        throw new Error("Serviço indisponível para finalizar a corrida.");
      }
      Logger.warn(
        "⚠️ [PrototypeRuntime] Serviço indisponível para finalizar a corrida; fallback local permitido por QA.",
      );
      return finalizeLocalCompletion();
    }

    try {
      const remoteResult = await socket.completeTrip(
        bookingId,
        {
          lat:
            Number(locationOverride?.lat) ||
            Number(locationOverride?.latitude) ||
            runtimeState.currentCoordinate?.latitude ||
            runtimeState.driverCoordinate?.latitude,
          lng:
            Number(locationOverride?.lng) ||
            Number(locationOverride?.longitude) ||
            runtimeState.currentCoordinate?.longitude ||
            runtimeState.driverCoordinate?.longitude,
        },
        distanceKm,
        fare,
      );

      if (remoteResult?.success !== false) {
        return remoteResult;
      }

      if (!allowLocalFallback) {
        throw new Error(
          remoteResult?.error ||
            remoteResult?.message ||
            "Backend não confirmou o encerramento da corrida.",
        );
      }

      Logger.warn(
        "⚠️ [PrototypeRuntime] completeTrip sem confirmação remota; fallback local permitido por QA.",
      );
      return finalizeLocalCompletion();
    } catch (error) {
      if (!allowLocalFallback) {
        Logger.warn(
          "⚠️ [PrototypeRuntime] completeTrip remoto falhou; mantendo corrida ativa:",
          error?.message || error,
        );
        throw error;
      }
      Logger.warn(
        "⚠️ [PrototypeRuntime] completeTrip remoto falhou; fallback local permitido por QA:",
        error?.message || error,
      );
      return finalizeLocalCompletion();
    }
  }

  if (!allowLocalFallback) {
    throw new Error("Nenhuma corrida ativa para finalizar.");
  }

  return finalizeLocalCompletion();
}

function updatePrototypeSettings(patch = {}) {
  const nextPatch = {};

  if (typeof patch.notificationsEnabled === "boolean") {
    nextPatch.notificationsEnabled = patch.notificationsEnabled;
  }
  if (typeof patch.trafficLayerEnabled === "boolean") {
    nextPatch.trafficLayerEnabled = patch.trafficLayerEnabled;
  }
  if (typeof patch.voiceGuidanceEnabled === "boolean") {
    nextPatch.voiceGuidanceEnabled = patch.voiceGuidanceEnabled;
  }

  if (Object.keys(nextPatch).length > 0) {
    setRuntimeState(nextPatch);
  }
}

function updatePrototypeRiderProfile(patch = {}) {
  if (!patch || typeof patch !== "object") {
    return;
  }

  setRuntimeState((previous) => ({
    riderProfile: {
      ...previous.riderProfile,
      ...(typeof patch.name === "string" ? { name: patch.name.trim() } : {}),
      ...(typeof patch.phone === "string" ? { phone: patch.phone.trim() } : {}),
      ...(typeof patch.email === "string" ? { email: patch.email.trim() } : {}),
      ...(typeof patch.preference === "string"
        ? { preference: patch.preference.trim() }
        : {}),
    },
  }));
}

function getRuntimeBookingId() {
  return (
    runtimeState.activeBookingId ||
    runtimeState.driverActiveRide?.bookingId ||
    runtimeState.activeBooking?.bookingId ||
    null
  );
}

async function getRealtimeSocket(
  profile,
  fallbackMessage = "Serviço indisponível no momento.",
) {
  const ready = await ensureSocketReady(profile);
  if (!ready) {
    throw new Error(runtimeState.socketError || fallbackMessage);
  }

  return WebSocketManager.getInstance();
}

async function loadPrototypeChatSession(profile, forceReload = false) {
  const bookingId = getRuntimeBookingId();
  if (!bookingId) {
    setRuntimeState({
      activeChatId: null,
      activeChatBookingId: null,
      chatMessages: [],
      chatLoading: false,
      chatError: "Inicie uma corrida para abrir o chat.",
    });
    return {
      success: false,
      bookingId: null,
      chatId: null,
      messages: [],
    };
  }

  setRuntimeState({
    chatLoading: true,
    chatError: "",
  });

  try {
    const socket = await getRealtimeSocket(
      profile,
      "Serviço de chat indisponível.",
    );
    const shouldCreateChat =
      forceReload ||
      !runtimeState.activeChatId ||
      runtimeState.activeChatBookingId !== bookingId;

    let chatId = runtimeState.activeChatId;
    if (shouldCreateChat) {
      const chatResponse = await socket.createChat({
        bookingId,
        tripId: bookingId,
        participants: [profile?.uid, runtimeState.driverInfo?.id].filter(
          Boolean,
        ),
        type: "trip_chat",
      });
      chatId = chatResponse?.chatId || chatResponse?.id || bookingId;
    }

    const messagesResponse = await socket.loadChatMessages(
      chatId,
      0,
      CHAT_MESSAGE_LIMIT,
    );
    const loadedMessages = Array.isArray(messagesResponse?.messages)
      ? messagesResponse.messages
      : [];
    const mergedMessages = mergeChatMessages(
      runtimeState.chatMessages,
      loadedMessages,
    );

    setRuntimeState({
      activeChatId: chatId,
      activeChatBookingId: bookingId,
      chatMessages: mergedMessages,
      chatLoading: false,
      chatError: "",
    });

    return {
      success: true,
      bookingId,
      chatId,
      messages: mergedMessages,
      raw: messagesResponse,
    };
  } catch (error) {
    setRuntimeState({
      chatLoading: false,
      chatError: error?.message || "Não foi possível carregar o chat.",
    });
    throw error;
  }
}

async function sendPrototypeChatMessage(profile, text) {
  const messageText = sanitizeText(text, "");
  if (!messageText) {
    return {
      success: false,
      ignored: true,
    };
  }

  const bookingId = getRuntimeBookingId();
  if (!bookingId) {
    throw new Error("Inicie uma corrida para enviar mensagens.");
  }

  const optimisticId = `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const optimisticMessage = {
    id: optimisticId,
    text: messageText,
    senderId: profile?.uid || runtimeState.profileUid || null,
    author: "you",
    timestamp: new Date().toISOString(),
  };

  setRuntimeState((previous) => ({
    chatSending: true,
    chatError: "",
    chatMessages: mergeChatMessages(previous.chatMessages, [optimisticMessage]),
  }));

  try {
    const socket = await getRealtimeSocket(
      profile,
      "Serviço de chat indisponível.",
    );
    const needsChatCreation =
      !runtimeState.activeChatId ||
      runtimeState.activeChatBookingId !== bookingId;

    let chatId = runtimeState.activeChatId;
    if (needsChatCreation) {
      const chatResponse = await socket.createChat({
        bookingId,
        tripId: bookingId,
        participants: [profile?.uid, runtimeState.driverInfo?.id].filter(
          Boolean,
        ),
        type: "trip_chat",
      });
      chatId = chatResponse?.chatId || chatResponse?.id || bookingId;
    }

    const response = await socket.sendMessage({
      chatId: chatId || bookingId,
      bookingId,
      tripId: bookingId,
      message: messageText,
      senderId: profile?.uid || runtimeState.profileUid || null,
      receiverId: runtimeState.driverInfo?.id || null,
      senderType: "passenger",
      timestamp: new Date().toISOString(),
      messageType: "text",
    });

    const confirmedId = response?.messageId || response?.id || optimisticId;
    const patchedMessages = runtimeState.chatMessages.map((item) => {
      if (item.id !== optimisticId) {
        return item;
      }
      return {
        ...item,
        id: String(confirmedId),
      };
    });

    setRuntimeState({
      chatSending: false,
      activeChatId: chatId || bookingId,
      activeChatBookingId: bookingId,
      chatMessages: mergeChatMessages(patchedMessages, []),
      chatError: "",
    });

    return {
      success: true,
      chatId: chatId || bookingId,
      messageId: confirmedId,
      raw: response,
    };
  } catch (error) {
    setRuntimeState({
      chatSending: false,
      chatError: error?.message || "Não foi possível enviar a mensagem.",
    });
    throw error;
  }
}

async function createPrototypeSupportTicket(profile, payload = {}) {
  const description = sanitizeText(payload.description, "");
  if (!description) {
    throw new Error("Descreva o problema para abrir um ticket.");
  }

  setRuntimeState({
    supportLoading: true,
    supportError: "",
  });

  try {
    const socket = await getRealtimeSocket(
      profile,
      "Serviço de suporte indisponível.",
    );
    const type = sanitizeText(payload.type, "support");
    const priority = sanitizeText(payload.priority, "N3");
    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments
      : [];
    const response = await socket.createSupportTicket(
      type,
      priority,
      description,
      attachments,
    );
    const ticket = {
      id: response?.ticketId || response?.id || `ticket-${Date.now()}`,
      type,
      priority,
      description,
      createdAt: new Date().toISOString(),
    };

    setRuntimeState({
      supportLoading: false,
      supportError: "",
      supportLastTicket: ticket,
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Ticket enviado",
        message: `Suporte recebeu sua solicitação (#${ticket.id}).`,
        kind: "support",
        scope: "both",
      }),
    );

    return {
      success: true,
      ticket,
      raw: response,
    };
  } catch (error) {
    setRuntimeState({
      supportLoading: false,
      supportError: error?.message || "Não foi possível abrir o ticket.",
    });
    throw error;
  }
}

async function reportPrototypeIncident(profile, payload = {}) {
  const description = sanitizeText(payload.description, "");
  if (!description) {
    throw new Error("Descreva o incidente para continuar.");
  }

  setRuntimeState({
    supportLoading: true,
    supportError: "",
  });

  try {
    const socket = await getRealtimeSocket(
      profile,
      "Serviço de segurança indisponível.",
    );
    const type = sanitizeText(payload.type, "incident");
    const location = runtimeState.currentCoordinate
      ? {
          lat: runtimeState.currentCoordinate.latitude,
          lng: runtimeState.currentCoordinate.longitude,
        }
      : null;
    const response = await socket.reportIncident(
      type,
      description,
      [],
      location,
    );
    const incident = {
      id: response?.incidentId || response?.id || `incident-${Date.now()}`,
      type,
      description,
      createdAt: new Date().toISOString(),
    };

    setRuntimeState({
      supportLoading: false,
      supportError: "",
      supportLastIncident: incident,
    });
    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Incidente registrado",
        message: `Registro de segurança criado (#${incident.id}).`,
        kind: "support",
        scope: "both",
      }),
    );

    return {
      success: true,
      incident,
      raw: response,
    };
  } catch (error) {
    setRuntimeState({
      supportLoading: false,
      supportError: error?.message || "Não foi possível registrar o incidente.",
    });
    throw error;
  }
}

function normalizeDriverActivationDocumentStatus(status) {
  const normalized = String(status || "")
    .trim()
    .toLowerCase();
  if (normalized === "approved") {
    return "approved";
  }
  if (normalized === "failed") {
    return "failed";
  }
  if (normalized === "in_review") {
    return "in_review";
  }
  return "pending";
}

function buildDriverDocumentAnalysisState(remoteSnapshot = null) {
  const byType = {};
  const remoteDocuments = remoteSnapshot?.documents || {};

  Object.values(DRIVER_DOCUMENT_TYPES).forEach((type) => {
    const remoteDoc = remoteDocuments?.[type] || {};
    byType[type] = {
      documentType: type,
      status: normalizeDriverActivationDocumentStatus(remoteDoc?.status),
      reason: String(remoteDoc?.reason || ""),
      updatedAt: remoteDoc?.updatedAt || remoteSnapshot?.updatedAt || null,
    };
  });

  return {
    byType,
    lastSyncedAt: remoteSnapshot?.updatedAt || new Date().toISOString(),
  };
}

function applyRemoteActivationSnapshotToLocal(localState, remoteSnapshot) {
  const normalizedLocal = computeDriverOnboardingState(
    localState || createInitialDriverOnboardingState(),
  );
  const remoteDocuments = remoteSnapshot?.documents || {};
  const remoteChecklist = remoteSnapshot?.checklist || {};
  const remoteUpdatedAt = remoteSnapshot?.updatedAt || new Date().toISOString();

  const cnhApproved =
    normalizeDriverActivationDocumentStatus(remoteDocuments?.cnh?.status) ===
      "approved" || Boolean(remoteChecklist?.cnhEar);
  const crlvApproved =
    normalizeDriverActivationDocumentStatus(remoteDocuments?.crlv?.status) ===
      "approved" || Boolean(remoteChecklist?.vehicleRegistration);
  const consentApproved = Boolean(remoteChecklist?.backgroundCheckConsent);

  const nextState = {
    ...normalizedLocal,
    stages: {
      ...normalizedLocal.stages,
      [DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]: {
        ...normalizedLocal.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA],
        checklist: {
          ...(normalizedLocal.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]
            ?.checklist || {}),
          cnhEar: cnhApproved,
          vehicleRegistration: crlvApproved,
          backgroundCheckConsent: consentApproved,
        },
        status:
          cnhApproved && crlvApproved && consentApproved
            ? "approved"
            : "action_required",
        updatedAt: remoteUpdatedAt,
        completedAt:
          cnhApproved && crlvApproved && consentApproved
            ? normalizedLocal.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.DRIVER_DATA]
                ?.completedAt || remoteUpdatedAt
            : null,
      },
      [DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION]: {
        ...normalizedLocal.stages?.[
          DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION
        ],
        checklist: {
          ...(normalizedLocal.stages?.[
            DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION
          ]?.checklist || {}),
          facialValidation: true,
        },
        status: "approved",
        updatedAt: remoteUpdatedAt,
        completedAt:
          normalizedLocal.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.FACE_VALIDATION]
            ?.completedAt || remoteUpdatedAt,
      },
      [DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA]: {
        ...normalizedLocal.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA],
        checklist: {
          ...(normalizedLocal.stages?.[
            DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA
          ]?.checklist || {}),
          crlv: crlvApproved,
        },
        status: crlvApproved ? "approved" : "action_required",
        updatedAt: remoteUpdatedAt,
        completedAt: crlvApproved
          ? normalizedLocal.stages?.[DRIVER_ONBOARDING_STAGE_KEYS.VEHICLE_DATA]
              ?.completedAt || remoteUpdatedAt
          : null,
      },
    },
    updatedAt: remoteUpdatedAt,
  };

  const computed = computeDriverOnboardingState(nextState);
  return {
    ...computed,
    canGoOnline: Boolean(remoteSnapshot?.canGoOnline ?? computed?.canGoOnline),
  };
}

async function fetchRemoteDriverActivationSnapshot(profile) {
  const uid = sanitizeText(profile?.uid, "");
  if (!uid) {
    return null;
  }

  try {
    const [statusResponse, docsResponse] = await Promise.allSettled([
      driverActivationService.getActivationStatus(),
      driverActivationService.getActivationDocuments(),
    ]);

    const statusPayload =
      statusResponse.status === "fulfilled"
        ? statusResponse?.value?.data || statusResponse?.value || null
        : null;
    const docsPayload =
      docsResponse.status === "fulfilled"
        ? docsResponse?.value?.data || docsResponse?.value || null
        : null;

    if (!statusPayload && !docsPayload) {
      return null;
    }

    const mergedDocuments = {
      ...(statusPayload?.documents || {}),
      ...(docsPayload?.documents || {}),
    };

    return {
      ...(statusPayload || {}),
      documents: mergedDocuments,
      history: Array.isArray(docsPayload?.history) ? docsPayload.history : [],
      summary: statusPayload?.summary || docsPayload?.summary || null,
      updatedAt:
        statusPayload?.updatedAt ||
        docsPayload?.updatedAt ||
        new Date().toISOString(),
    };
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao buscar ativação remota do motorista:",
      error?.message || error,
    );
    return null;
  }
}

function stopDriverActivationRemoteSync() {
  if (runtimeActivationRemoteSyncTimer) {
    clearInterval(runtimeActivationRemoteSyncTimer);
    runtimeActivationRemoteSyncTimer = null;
  }
}

function startDriverActivationRemoteSync(profile) {
  stopDriverActivationRemoteSync();

  const uid = sanitizeText(profile?.uid, "");
  if (!uid) {
    return;
  }

  runtimeActivationRemoteSyncTimer = setInterval(() => {
    syncDriverActivationWithProfile(profile, { source: "timer" }).catch(
      (error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha no sync remoto periódico de ativação:",
          error?.message || error,
        );
      },
    );
  }, DRIVER_ACTIVATION_REMOTE_SYNC_INTERVAL_MS);
}

async function syncDriverActivationWithProfile(profile, options = {}) {
  const force = Boolean(options?.force);
  const source = sanitizeText(options?.source, "unspecified");
  const uid = sanitizeText(profile?.uid, "");
  const profileCanGoOnline = Boolean(
    profile?.canGoOnline ??
      profile?.profile?.canGoOnline ??
      runtimeState.driverCanGoOnline,
  );
  const now = Date.now();
  const lastSyncAt = uid
    ? Number(runtimeActivationLastSyncAtByUid[uid] || 0)
    : 0;

  Logger.log(
    `[PrototypeRuntime] syncDriverActivation requested source=${source} force=${force} uid=${uid || "none"}`,
  );

  if (!force && uid && now - lastSyncAt < DRIVER_ACTIVATION_SYNC_MIN_GAP_MS) {
    Logger.log(
      `[PrototypeRuntime] syncDriverActivation skipped by min gap source=${source} uid=${uid}`,
    );
    return (
      runtimeState.driverActivation || createInitialDriverOnboardingState()
    );
  }

  if (
    runtimeActivationSyncInFlight &&
    uid &&
    runtimeActivationSyncUid === uid
  ) {
    Logger.log(
      `[PrototypeRuntime] syncDriverActivation joined in-flight source=${source} uid=${uid}`,
    );
    return runtimeActivationSyncInFlight;
  }

  runtimeActivationSyncUid = uid;
  runtimeActivationSyncInFlight = (async () => {
    const explicitProfileRole = resolveExplicitProfileRole(profile);
    const isDriverProfile = explicitProfileRole === "driver";
    const isKnownNonDriver = explicitProfileRole === "customer";
    const persistedState = await loadPersistedDriverActivation(uid);

    if (!uid || (!isDriverProfile && !isKnownNonDriver)) {
      const fallbackState = computeDriverOnboardingState(
        persistedState ||
          runtimeState.driverActivation ||
          createInitialDriverOnboardingState(),
      );
      setRuntimeState((previous) => ({
        driverActivation: fallbackState,
        driverActivationResolved: false,
        driverCanGoOnline: Boolean(
          fallbackState?.canGoOnline ?? previous.driverCanGoOnline,
        ),
        driverActivationRemote: previous.driverActivationRemote,
      }));
      return fallbackState;
    }

    if (!isDriverProfile) {
      stopDriverActivationRemoteSync();
      const fallbackState = computeDriverOnboardingState(
        persistedState || createInitialDriverOnboardingState(),
      );
      setRuntimeState({
        driverActivation: fallbackState,
        driverActivationResolved: true,
        driverCanGoOnline: fallbackState.canGoOnline,
        driverOnline: false,
        driverOnlineMutationSource: "activation_sync_non_driver",
        driverActivationRemote: null,
      });
      return fallbackState;
    }

    if (shouldPreferQaDriverActivation(profile)) {
      const approvedState = createApprovedDriverActivationState(
        mergeDriverActivation(
          profile?.driverActivation ||
            profile?.profile?.driverActivation ||
            runtimeState.driverActivation ||
            createInitialDriverOnboardingState(),
          persistedState,
        ),
      );

      setRuntimeState({
        driverActivation: approvedState,
        driverActivationResolved: true,
        driverCanGoOnline: true,
        driverActivationRemote: null,
      });
      await persistDriverActivation(uid, approvedState);
      await persistPrototypeProfilePatch(
        {
          canGoOnline: true,
          driverActivation: approvedState,
        },
        profile,
      );
      return approvedState;
    }

    const profileState = computeDriverOnboardingState(
      profile?.driverActivation ||
        profile?.profile?.driverActivation ||
        createInitialDriverOnboardingState(),
    );
    let mergedState = mergeDriverActivation(profileState, persistedState);
    if (profileCanGoOnline) {
      mergedState = {
        ...mergedState,
        canGoOnline: true,
      };
    }
    const remoteSnapshot = await fetchRemoteDriverActivationSnapshot(profile);

    if (remoteSnapshot) {
      mergedState = applyRemoteActivationSnapshotToLocal(
        mergedState,
        remoteSnapshot,
      );
    }

    const remoteCanGoOnline =
      typeof remoteSnapshot?.canGoOnline === "boolean"
        ? remoteSnapshot.canGoOnline
        : null;
    const nextCanGoOnline =
      remoteCanGoOnline === null
        ? Boolean(
            profileCanGoOnline ||
              mergedState?.canGoOnline ||
              runtimeState.driverCanGoOnline,
          )
        : Boolean(remoteCanGoOnline);
    const nextDocAnalysisState = remoteSnapshot
      ? buildDriverDocumentAnalysisState(remoteSnapshot)
      : runtimeState.documentAnalysisState;

    setRuntimeState((previous) => {
      const existingNotifications = Array.isArray(previous.notifications)
        ? previous.notifications
        : [];
      const activationNotifications = Array.isArray(mergedState?.notifications)
        ? mergedState.notifications
        : [];
      const freshActivationNotifications = activationNotifications.filter(
        (item) =>
          item?.id &&
          !existingNotifications.some((existing) => existing.id === item.id),
      );

      return {
        driverActivation: mergedState,
        driverActivationResolved: true,
        driverCanGoOnline: nextCanGoOnline,
        ...(nextCanGoOnline
          ? {}
          : {
              driverOnline: false,
              driverOnlineMutationSource: "activation_sync_blocked",
            }),
        notifications: [
          ...freshActivationNotifications,
          ...existingNotifications,
        ].slice(0, NOTIFICATION_LIMIT),
        driverActivationRemote:
          remoteSnapshot || previous.driverActivationRemote,
        documentAnalysisState: nextDocAnalysisState,
      };
    });

    await persistDriverActivation(uid, mergedState);
    await persistPrototypeProfilePatch(
      {
        canGoOnline: nextCanGoOnline,
        driverActivation: mergedState,
      },
      profile,
    );
    return mergedState;
  })();

  try {
    const result = await runtimeActivationSyncInFlight;
    if (uid) {
      runtimeActivationLastSyncAtByUid[uid] = Date.now();
    }
    return result;
  } finally {
    runtimeActivationSyncInFlight = null;
    runtimeActivationSyncUid = "";
  }
}

async function updatePrototypeDriverActivation(
  profile,
  updater,
  { appendNotifications = true } = {},
) {
  const current = computeDriverOnboardingState(
    runtimeState.driverActivation || createInitialDriverOnboardingState(),
  );
  const next = typeof updater === "function" ? updater(current) : updater;
  const normalized = computeDriverOnboardingState(next || current);

  setRuntimeState({
    driverActivation: normalized,
    driverActivationResolved: true,
    driverCanGoOnline: Boolean(normalized?.canGoOnline),
    ...(normalized?.canGoOnline
      ? {}
      : {
          driverOnline: false,
          driverOnlineMutationSource: "activation_update_blocked",
        }),
  });

  const uid = sanitizeText(profile?.uid, "");
  await persistDriverActivation(uid, normalized);

  if (
    appendNotifications &&
    Array.isArray(normalized.notifications) &&
    normalized.notifications.length > 0
  ) {
    const latestNotification = normalized.notifications[0];
    const alreadyExists = (runtimeState.notifications || []).some(
      (item) => item.id === latestNotification.id,
    );
    if (!alreadyExists) {
      appendRuntimeNotification(latestNotification);
    }
  }

  return normalized;
}

function resolveDocumentTypeByField(fieldKey) {
  if (fieldKey === "cnhEar") {
    return DRIVER_DOCUMENT_TYPES.cnh;
  }
  if (fieldKey === "vehicleRegistration" || fieldKey === "crlv") {
    return DRIVER_DOCUMENT_TYPES.crlv;
  }
  return null;
}

async function refreshPrototypeDriverActivation(profile) {
  return syncDriverActivationWithProfile(profile, {
    force: true,
    source: "manual_refresh",
  });
}

async function submitPrototypeDriverDocument(profile, fieldKey, pdfAsset) {
  const uid = sanitizeText(profile?.uid, "");
  if (!uid) {
    throw new Error("Usuário não autenticado para envio de documento.");
  }

  const documentType = resolveDocumentTypeByField(fieldKey);
  if (!documentType) {
    throw new Error("Tipo de documento não suportado para ativação.");
  }

  const response = await driverActivationService.submitDocument(
    documentType,
    pdfAsset,
  );
  const responsePayload = response?.data || response || {};
  const updatedAt = responsePayload?.updatedAt || new Date().toISOString();

  setRuntimeState((previous) => ({
    documentAnalysisState: {
      byType: {
        ...(previous.documentAnalysisState?.byType || {}),
        [documentType]: {
          documentType,
          status: "in_review",
          reason: "",
          updatedAt,
        },
      },
      lastSyncedAt: updatedAt,
    },
  }));

  syncDriverActivationWithProfile(profile, {
    force: true,
    source: "post_document_submit",
  }).catch((error) => {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao sincronizar ativação após envio de documento:",
      error?.message || error,
    );
  });

  return response;
}

async function submitPrototypeBackgroundCheckConsent(profile, accepted = true) {
  const uid = sanitizeText(profile?.uid, "");
  if (!uid) {
    throw new Error("Usuário não autenticado para registrar consentimento.");
  }

  const response = await driverActivationService.submitBackgroundCheckConsent(
    Boolean(accepted),
  );
  await syncDriverActivationWithProfile(profile, {
    force: true,
    source: "post_background_consent",
  });
  return response;
}

function getDriverLocationPayload() {
  const fallbackCoordinate =
    runtimeState?.driverCoordinate || runtimeState?.currentCoordinate || null;
  const latitude = Number(fallbackCoordinate?.latitude);
  const longitude = Number(fallbackCoordinate?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const heading = Number(runtimeState?.currentHeading || 0);
  return {
    lat: latitude,
    lng: longitude,
    heading: Number.isFinite(heading) ? heading : 0,
    speed: 0,
  };
}

async function resolveDriverOnlineLocationSeed() {
  return resolveDriverOnlineLocationSeedHelper({
    getCachedSeed: () => getDriverLocationPayload(),
    refreshCurrentLocation: () =>
      ensureCurrentLocation({
        allowCurrentPosition: true,
        resolveAddress: false,
      }),
    preferFresh: true,
    onAsyncRefreshError: (error) => {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao refrescar localização após ativar online com seed local:",
        error?.message || error,
      );
    },
  });
}

async function resolveDriverOnlineLocationSeedWithTimeout(timeoutMs = 1800) {
  const fallbackSeed = getDriverLocationPayload();

  const resolved = await Promise.race([
    resolveDriverOnlineLocationSeed(),
    delay(Math.max(250, Number(timeoutMs) || 1800)).then(() => ({
      statusLocationSeed: fallbackSeed,
      seedSource: "driver_seed_timeout_fallback",
    })),
  ]);

  if (
    resolved?.seedSource === "driver_seed_timeout_fallback" &&
    fallbackSeed
  ) {
    await writeRuntimeDebugProbe("driver_online_seed_timeout_fallback", {
      hasFallbackSeed: true,
    });
  }

  return resolved;
}

function stopDriverLocationHeartbeat() {
  if (runtimeDriverHeartbeatInterval) {
    clearInterval(runtimeDriverHeartbeatInterval);
    runtimeDriverHeartbeatInterval = null;
  }
  runtimeLastSharedDriverRoutePlanKey = "";
  runtimeLastSharedDriverRoutePlanAt = 0;

  setRuntimeState((previous) => ({
    driverLocationHeartbeat: {
      ...previous.driverLocationHeartbeat,
      running: false,
    },
  }));
}

function shouldMonitorPassengerTripulation() {
  return (
    Boolean(runtimeState?.activeBookingId) &&
    ["accepted", "arrived", "started"].includes(
      String(runtimeState?.bookingStatus || "").toLowerCase(),
    )
  );
}

function getPassengerLocationPayload() {
  const latitude = Number(runtimeState?.currentCoordinate?.latitude);
  const longitude = Number(runtimeState?.currentCoordinate?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const heading = Number(runtimeState?.currentHeading || 0);
  return {
    lat: latitude,
    lng: longitude,
    heading: Number.isFinite(heading) ? heading : 0,
    speed: 0,
  };
}

function buildDriverRoutePlanSharePayload() {
  const bookingId = String(
    runtimeState.activeBookingId ||
      runtimeState.driverActiveRide?.bookingId ||
      runtimeState.driverActiveRide?.id ||
      "",
  ).trim();
  const routePlan = extractDriverRoutePlan(runtimeState.driverTripMeta);
  if (!bookingId || !routePlan) {
    return null;
  }

  const pickupCoordinate =
    normalizeRuntimeCoordinate(runtimeState.driverTripMeta?.pickupCoordinate) ||
    resolvePickupCoordinateFromRide(
      runtimeState.driverActiveRide,
      runtimeState.activeBooking,
    );
  const destinationCoordinate =
    normalizeRuntimeCoordinate(runtimeState.driverTripMeta?.destinationCoordinate) ||
    resolveDestinationCoordinateFromRide(
      runtimeState.driverActiveRide,
      runtimeState.selectedDestination,
      runtimeState.activeBooking,
    );
  if (!pickupCoordinate || !destinationCoordinate) {
    return null;
  }

  const phase =
    String(runtimeState.driverTripMeta?.leg || "").trim().toLowerCase() ===
    "destination"
      ? "destination"
      : "pickup";
  const signature = [
    bookingId,
    phase,
    routePlan.pickupCoordinates.length,
    routePlan.destinationCoordinates.length,
    Number(routePlan.pickupDistanceKm || 0).toFixed(2),
    Number(routePlan.destinationDistanceKm || 0).toFixed(2),
  ].join(":");
  const now = Date.now();
  const shouldRefreshUnchangedRoutePlan =
    now - Number(runtimeLastSharedDriverRoutePlanAt || 0) >=
    DRIVER_ROUTE_PLAN_SHARE_REFRESH_MS;
  if (
    runtimeLastSharedDriverRoutePlanKey === signature &&
    !shouldRefreshUnchangedRoutePlan
  ) {
    return null;
  }

  return {
    signature,
    payload: {
      bookingId,
      tripId: bookingId,
      isInTrip: true,
      tripStatus: phase === "destination" ? "started" : "accepted",
      routePlan,
      routePlanPhase: phase,
      routePlanSharedAt: new Date().toISOString(),
      pickupCoordinate,
      destinationCoordinate,
      pickupAddress:
        runtimeState.driverTripMeta?.pickupAddress ||
        runtimeState.driverActiveRide?.pickupAddress ||
        runtimeState.driverActiveRide?.pickup ||
        "",
      destinationAddress:
        runtimeState.driverTripMeta?.destinationAddress ||
        runtimeState.driverActiveRide?.dropoffAddress ||
        runtimeState.driverActiveRide?.dropoff ||
        runtimeState.selectedDestination?.address ||
        "",
    },
  };
}

function stopPassengerLocationHeartbeat(options = {}) {
  const preservePendingStart = options?.preservePendingStart === true;
  if (runtimePassengerHeartbeatInterval) {
    clearInterval(runtimePassengerHeartbeatInterval);
    runtimePassengerHeartbeatInterval = null;
  }
  runtimePassengerHeartbeatInFlight = false;
  if (!preservePendingStart) {
    runtimePassengerHeartbeatStartPromise = null;
    runtimePassengerHeartbeatStartKey = "";
  }
  runtimePassengerHeartbeatActiveBookingId = null;
  runtimePassengerHeartbeatActiveProfileUid = null;
  runtimeLastPassengerHeartbeatAttemptAt = 0;

  setRuntimeState((previous) => ({
    passengerLocationHeartbeat: {
      ...previous.passengerLocationHeartbeat,
      running: false,
    },
  }));
}

function normalizeHeadingDegrees(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }

  const normalized = numeric % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

function calculateHeadingDeltaDegrees(previousHeading, nextHeading) {
  const start = normalizeHeadingDegrees(previousHeading);
  const end = normalizeHeadingDegrees(nextHeading);
  const rawDelta = Math.abs(end - start);
  return Math.min(rawDelta, 360 - rawDelta);
}

function shouldThrottlePassengerLocationPush({
  bookingId,
  bookingStatus,
  location,
  force = false,
}) {
  if (force || !runtimeLastPassengerHeartbeatSentAt) {
    return false;
  }

  const normalizedStatus = String(bookingStatus || "").trim().toLowerCase();
  if (
    String(runtimeLastPassengerHeartbeatBookingId || "") !==
      String(bookingId || "") ||
    runtimeLastPassengerHeartbeatStatus !== normalizedStatus
  ) {
    return false;
  }

  const elapsedMs = Date.now() - runtimeLastPassengerHeartbeatSentAt;
  const minIntervalMs =
    normalizedStatus === "started"
      ? PASSENGER_LOCATION_STARTED_HEARTBEAT_MS
      : PASSENGER_LOCATION_STATIONARY_HEARTBEAT_MS;

  if (elapsedMs >= minIntervalMs) {
    return false;
  }

  const movedMeters = calculateDistanceMeters(
    runtimeLastPassengerHeartbeatLocation,
    location,
  );
  if (
    Number.isFinite(movedMeters) &&
    movedMeters >= PASSENGER_LOCATION_MIN_MOVEMENT_METERS
  ) {
    return false;
  }

  const headingDelta = calculateHeadingDeltaDegrees(
    runtimeLastPassengerHeartbeatHeading,
    location?.heading,
  );
  if (headingDelta >= PASSENGER_LOCATION_MIN_HEADING_DELTA_DEG) {
    return false;
  }

  return true;
}

async function pushPassengerLocationNow(
  profile,
  socketInstance = null,
  options = {},
) {
  if (!profile?.uid) {
    return { success: false, code: "PROFILE_REQUIRED" };
  }

  const role = resolveRuntimeRole(profile);
  if (role !== "customer") {
    return { success: false, code: "PASSENGER_ONLY" };
  }

  const bookingId = runtimeState?.activeBookingId || null;
  if (!bookingId || !shouldMonitorPassengerTripulation()) {
    return { success: false, code: "NO_ACTIVE_TRIP" };
  }

  if (runtimePassengerHeartbeatInFlight) {
    return { success: false, code: "IN_FLIGHT" };
  }

  const location = getPassengerLocationPayload();
  if (!location) {
    return { success: false, code: "LOCATION_REQUIRED" };
  }

  if (runtimePassengerHeartbeatInFlight && options?.force !== true) {
    return { success: false, code: "IN_FLIGHT" };
  }

  const normalizedStatus = String(runtimeState?.bookingStatus || "")
    .trim()
    .toLowerCase();
  if (
    shouldThrottlePassengerLocationPush({
      bookingId,
      bookingStatus: normalizedStatus,
      location,
      force: options?.force === true,
    })
  ) {
    return { success: false, code: "THROTTLED" };
  }

  const now = Date.now();
  if (
    options?.force !== true &&
    String(runtimeLastPassengerHeartbeatBookingId || "") ===
      String(bookingId || "") &&
    runtimeLastPassengerHeartbeatAttemptAt > 0 &&
    now - runtimeLastPassengerHeartbeatAttemptAt <
      PASSENGER_LOCATION_MIN_SEND_GAP_MS
  ) {
    return { success: false, code: "COALESCED" };
  }

  runtimePassengerHeartbeatInFlight = true;
  runtimeLastPassengerHeartbeatAttemptAt = now;
  try {
    const socket =
      socketInstance ||
      (await getRealtimeSocket(
        profile,
        "Serviço de localização indisponível.",
      ));
    await socket.updatePassengerLocation(
      bookingId,
      location.lat,
      location.lng,
      location.heading,
      location.speed,
    );

    setRuntimeState((previous) => ({
      passengerLocationHeartbeat: {
        ...previous.passengerLocationHeartbeat,
        running: true,
        lastSentAt: new Date().toISOString(),
        lastError: "",
      },
    }));

    runtimeLastPassengerHeartbeatSentAt = Date.now();
    runtimeLastPassengerHeartbeatBookingId = bookingId;
    runtimeLastPassengerHeartbeatStatus = normalizedStatus;
    runtimeLastPassengerHeartbeatLocation = {
      latitude: location.lat,
      longitude: location.lng,
    };
    runtimeLastPassengerHeartbeatHeading = Number(location.heading || 0);

    return { success: true, location, bookingId };
  } finally {
    runtimePassengerHeartbeatInFlight = false;
  }
}

async function startPassengerLocationHeartbeat(profile, socketInstance = null) {
  if (!profile?.uid) {
    return;
  }

  const role = resolveRuntimeRole(profile);
  if (role !== "customer") {
    return;
  }

  const bookingId = runtimeState?.activeBookingId || null;
  if (!bookingId) {
    stopPassengerLocationHeartbeat();
    return;
  }

  const startKey = `${profile.uid}:${bookingId}`;
  const hasMatchingActiveHeartbeat =
    Boolean(runtimePassengerHeartbeatInterval) &&
    runtimePassengerHeartbeatActiveProfileUid === profile.uid &&
    runtimePassengerHeartbeatActiveBookingId === bookingId;

  if (hasMatchingActiveHeartbeat) {
    setRuntimeState((previous) => ({
      passengerLocationHeartbeat: {
        ...previous.passengerLocationHeartbeat,
        running: true,
        lastError: "",
      },
    }));
    return;
  }

  if (
    runtimePassengerHeartbeatStartPromise &&
    runtimePassengerHeartbeatStartKey === startKey
  ) {
    return runtimePassengerHeartbeatStartPromise;
  }

  runtimePassengerHeartbeatStartKey = startKey;
  runtimePassengerHeartbeatStartPromise = (async () => {
    stopPassengerLocationHeartbeat({ preservePendingStart: true });
    runtimePassengerHeartbeatActiveProfileUid = profile.uid;
    runtimePassengerHeartbeatActiveBookingId = bookingId;

    runtimePassengerHeartbeatInterval = setInterval(() => {
      pushPassengerLocationNow(profile, socketInstance).catch((error) => {
        setRuntimeState((previous) => ({
          passengerLocationHeartbeat: {
            ...previous.passengerLocationHeartbeat,
            running: true,
            lastError:
              error?.message ||
              "Falha no envio periódico de localização do passageiro.",
          },
        }));
      });
    }, PASSENGER_LOCATION_HEARTBEAT_MS);

    setRuntimeState((previous) => ({
      passengerLocationHeartbeat: {
        ...previous.passengerLocationHeartbeat,
        running: true,
        lastError: "",
      },
    }));

    try {
      await pushPassengerLocationNow(profile, socketInstance);
    } catch (error) {
      setRuntimeState((previous) => ({
        passengerLocationHeartbeat: {
          ...previous.passengerLocationHeartbeat,
          running: true,
          lastError:
            error?.message ||
            "Falha no envio inicial de localização do passageiro.",
        },
      }));
    }
  })();

  try {
    await runtimePassengerHeartbeatStartPromise;
  } finally {
    if (runtimePassengerHeartbeatStartKey === startKey) {
      runtimePassengerHeartbeatStartPromise = null;
      runtimePassengerHeartbeatStartKey = "";
    }
  }
}

async function pushDriverLocationNow(profile, socketInstance = null) {
  if (!profile?.uid) {
    return { success: false, code: "PROFILE_REQUIRED" };
  }

  const location = getDriverLocationPayload();
  if (!location) {
    return { success: false, code: "LOCATION_REQUIRED" };
  }

  const socket =
    socketInstance ||
    (await getRealtimeSocket(profile, "Serviço de localização indisponível."));
  const routePlanShare = buildDriverRoutePlanSharePayload();
  await socket.updateLocation(
    profile.uid,
    location.lat,
    location.lng,
    location.heading,
    location.speed,
    routePlanShare?.payload || {},
  );
  if (routePlanShare?.signature) {
    runtimeLastSharedDriverRoutePlanKey = routePlanShare.signature;
    runtimeLastSharedDriverRoutePlanAt = Date.now();
  }

  setRuntimeState((previous) => ({
    currentCoordinate: {
      latitude: location.lat,
      longitude: location.lng,
    },
    driverCoordinate: {
      latitude: location.lat,
      longitude: location.lng,
    },
    driverLocationHeartbeat: {
      ...previous.driverLocationHeartbeat,
      running: true,
      lastSentAt: new Date().toISOString(),
      lastError: "",
    },
  }));

  return { success: true, location };
}

async function startDriverLocationHeartbeat(profile, socketInstance = null) {
  stopDriverLocationHeartbeat();
  if (!profile?.uid) {
    return;
  }

  runtimeDriverHeartbeatInterval = setInterval(() => {
    pushDriverLocationNow(profile, socketInstance).catch((error) => {
      setRuntimeState((previous) => ({
        driverLocationHeartbeat: {
          ...previous.driverLocationHeartbeat,
          running: true,
          lastError:
            error?.message || "Falha no envio periódico de localização.",
        },
      }));
    });
  }, DRIVER_LOCATION_HEARTBEAT_MS);

  setRuntimeState((previous) => ({
    driverLocationHeartbeat: {
      ...previous.driverLocationHeartbeat,
      running: true,
      lastError: "",
    },
  }));

  try {
    await pushDriverLocationNow(profile, socketInstance);
  } catch (error) {
    setRuntimeState((previous) => ({
      driverLocationHeartbeat: {
        ...previous.driverLocationHeartbeat,
        running: true,
        lastError: error?.message || "Falha no envio inicial de localização.",
      },
    }));
  }
}

async function resolveDriverActivationForOnline(profile) {
  const uid = sanitizeText(profile?.uid, "");
  const currentActivation = computeDriverOnboardingState(
    runtimeState.driverActivation || createInitialDriverOnboardingState(),
  );
  const persistedRemoteSnapshot =
    runtimeState?.driverActivationRemote &&
    typeof runtimeState.driverActivationRemote === "object"
      ? runtimeState.driverActivationRemote
      : null;

  if (
    currentActivation?.canGoOnline ||
    persistedRemoteSnapshot?.canGoOnline === true
  ) {
    const resolvedActivation = persistedRemoteSnapshot
      ? applyRemoteActivationSnapshotToLocal(
          currentActivation,
          persistedRemoteSnapshot,
        )
      : currentActivation;

    setRuntimeState((previous) => ({
      driverActivation: resolvedActivation,
      driverActivationResolved: true,
      driverCanGoOnline: true,
      driverActivationRemote:
        persistedRemoteSnapshot || previous.driverActivationRemote,
    }));
    await persistPrototypeProfilePatch(
      {
        canGoOnline: true,
        driverActivation: resolvedActivation,
      },
      profile,
    );

    return {
      ...resolvedActivation,
      canGoOnline: true,
    };
  }

  if (!uid) {
    return currentActivation;
  }

  const persistedActivation = await loadPersistedDriverActivation(uid);
  let mergedActivation = mergeDriverActivation(
    currentActivation,
    persistedActivation,
  );

  if (persistedRemoteSnapshot) {
    mergedActivation = applyRemoteActivationSnapshotToLocal(
      mergedActivation,
      persistedRemoteSnapshot,
    );
  }

  if (mergedActivation?.canGoOnline) {
    setRuntimeState((previous) => ({
      driverActivation: mergedActivation,
      driverActivationResolved: true,
      driverCanGoOnline: true,
      driverActivationRemote:
        persistedRemoteSnapshot || previous.driverActivationRemote,
    }));
    await persistPrototypeProfilePatch(
      {
        canGoOnline: true,
        driverActivation: mergedActivation,
      },
      profile,
    );
    return {
      ...mergedActivation,
      canGoOnline: true,
    };
  }

  if (
    runtimeState.driverOnline ||
    runtimeState.driverActivationResolved === false
  ) {
    try {
      const refreshedActivation = await syncDriverActivationWithProfile(
        profile,
        {
          force: true,
          source: "enable_online_activation_resolve_sync",
        },
      );
      const refreshedRemoteSnapshot =
        runtimeState?.driverActivationRemote &&
        typeof runtimeState.driverActivationRemote === "object"
          ? runtimeState.driverActivationRemote
          : null;
      const resolvedActivation = refreshedRemoteSnapshot
        ? applyRemoteActivationSnapshotToLocal(
            refreshedActivation,
            refreshedRemoteSnapshot,
          )
        : computeDriverOnboardingState(refreshedActivation || mergedActivation);
      const resolvedCanGoOnline =
        typeof refreshedRemoteSnapshot?.canGoOnline === "boolean"
          ? refreshedRemoteSnapshot.canGoOnline
          : Boolean(
              runtimeState.driverCanGoOnline || resolvedActivation?.canGoOnline,
            );

      if (resolvedCanGoOnline) {
        setRuntimeState((previous) => ({
          driverActivation: resolvedActivation,
          driverActivationResolved: true,
          driverCanGoOnline: true,
          driverActivationRemote:
            refreshedRemoteSnapshot || previous.driverActivationRemote,
        }));
        await persistPrototypeProfilePatch(
          {
            canGoOnline: true,
            driverActivation: resolvedActivation,
          },
          profile,
        );
        return {
          ...resolvedActivation,
          canGoOnline: true,
        };
      }

      return resolvedActivation;
    } catch (error) {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao confirmar ativação do motorista para reabrir online:",
        error?.message || error,
      );
    }
  }

  return mergedActivation;
}

async function enablePrototypeDriverOnline(profile, options = {}) {
  if (runtimeDriverOnlineEnablePromise) {
    return runtimeDriverOnlineEnablePromise;
  }

  const preserveOnlineOnFailure = Boolean(options?.preserveOnlineOnFailure);
  const socketInstance = options?.socketInstance || null;

  runtimeDriverOnlineEnablePromise = (async () => {
    const activationState = await resolveDriverActivationForOnline(profile);
    if (!activationState?.canGoOnline) {
      appendRuntimeNotification(
        createRuntimeNotification({
          title: "Ativação pendente",
          message:
            "Conclua as etapas de ativação do motorista antes de ficar online.",
          kind: "driver",
          scope: "driver",
        }),
      );

      setRuntimeState({
        driverOnline: false,
        driverOnlinePending: false,
        driverCanGoOnline: false,
        driverOnlineMutationSource: "enable_online_activation_blocked",
        lastError: "Ativação do motorista pendente.",
      });

      return {
        success: false,
        blocked: true,
        reason: "Ativação do motorista pendente.",
      };
    }

    setRuntimeState({
      driverOnline: false,
      driverOnlinePending: true,
      driverOnlineMutationSource: "enable_online_pending",
      lastError: "",
    });

    if (!profile?.uid) {
      setRuntimeState({
        driverOnline: false,
        driverOnlinePending: false,
        driverOnlineMutationSource: "enable_online_missing_profile",
        lastError: "Perfil do motorista indisponível para ativação.",
      });
      await writeRuntimeDebugProbe("driver_online_enable_missing_profile", {
        hasProfile: Boolean(profile),
        driverId: profile?.uid || null,
      });
      return {
        success: false,
        localOnly: true,
        isOnline: false,
        error: "Perfil do motorista indisponível para ativação.",
      };
    }

    try {
      const socket =
        socketInstance ||
        (await getRealtimeSocket(profile, "Serviço do motorista indisponível."));
      const { statusLocationSeed, seedSource } =
        await resolveDriverOnlineLocationSeedWithTimeout();

      await writeRuntimeDebugProbe("driver_online_enable_start", {
        driverId: profile?.uid || null,
        seedSource,
        hasLocationSeed: Boolean(statusLocationSeed),
        currentCoordinate:
          runtimeState?.currentCoordinate &&
          Number.isFinite(runtimeState.currentCoordinate.latitude) &&
          Number.isFinite(runtimeState.currentCoordinate.longitude)
            ? runtimeState.currentCoordinate
            : null,
        driverCoordinate:
          runtimeState?.driverCoordinate &&
          Number.isFinite(runtimeState.driverCoordinate.latitude) &&
          Number.isFinite(runtimeState.driverCoordinate.longitude)
            ? runtimeState.driverCoordinate
            : null,
      });

      if (!statusLocationSeed) {
        throw new Error(
          "Localização inicial não disponível para ativar modo online.",
        );
      }

      const statusLocation = {
        lat: Number(statusLocationSeed.lat),
        lng: Number(statusLocationSeed.lng),
        heading: Number(statusLocationSeed.heading || 0),
        speed: Number(statusLocationSeed.speed || 0),
      };

      let onlineAck = null;
      let lastOnlineError = null;

      for (
        let attempt = 1;
        attempt <= DRIVER_STATUS_RETRY_ATTEMPTS;
        attempt += 1
      ) {
        try {
          onlineAck = await socket.setDriverStatus(
            profile.uid,
            "available",
            true,
            {
              timeoutMs: 12000,
              location: statusLocation,
              destinationMode: buildDriverDestinationModeState(
                runtimeState.driverDestinationMode,
              ),
            },
          );
          break;
        } catch (error) {
          lastOnlineError = error;
          const errorCode = String(error?.code || "").toUpperCase();
          const retryAfterSec = Number(error?.retryAfterSec || 0);
          const canRetry =
            attempt < DRIVER_STATUS_RETRY_ATTEMPTS &&
            (errorCode === "LOCATION_REQUIRED" ||
              errorCode === "ONLINE_NOT_READY" ||
              errorCode === "SET_DRIVER_STATUS_TIMEOUT");

          if (!canRetry) {
            break;
          }

          await delay(
            Math.max(700, retryAfterSec > 0 ? retryAfterSec * 1000 : 1000),
          );
          try {
            await pushDriverLocationNow(profile, socket);
          } catch (_locationError) {
            // best effort: o retry abaixo retornará erro detalhado se não ficar pronto.
          }
        }
      }

      if (!onlineAck?.success) {
        throw (
          lastOnlineError ||
          new Error("Não foi possível ativar o modo online agora.")
        );
      }

      await startDriverLocationHeartbeat(profile, socket);
      setRuntimeState({
        driverOnline: true,
        driverOnlinePending: false,
        driverOnlineMutationSource: "enable_online_remote_confirmed",
        lastError: "",
      });
      await writeRuntimeDebugProbe("driver_online_enable_success", {
        driverId: profile?.uid || null,
        seedSource,
        status: onlineAck?.status || null,
        isOnline: onlineAck?.isOnline === true,
        ready: onlineAck?.ready === true,
      });
      return {
        success: true,
        isOnline: true,
      };
    } catch (error) {
      const errorPayload =
        error?.payload && typeof error.payload === "object"
          ? error.payload
          : {};
      const isKycRequired =
        Boolean(error?.kycRequired) ||
        Boolean(errorPayload?.kycRequired) ||
        ["kycrequired", "kyc_required", "kyccheckfailed", "kyc_check_failed"].includes(
          String(error?.code || errorPayload?.code || "")
            .trim()
            .toLowerCase(),
        );
      stopDriverLocationHeartbeat();
      setRuntimeState({
        ...(preserveOnlineOnFailure
          ? {
              driverOnline: true,
              driverOnlinePending: false,
              driverOnlineMutationSource:
                "enable_online_preserved_after_failure",
            }
          : {
              driverOnline: false,
              driverOnlinePending: false,
              driverOnlineMutationSource: "enable_online_failed",
            }),
        lastError: error?.message || "Falha ao atualizar status remoto",
      });
      await writeRuntimeDebugProbe("driver_online_enable_failure", {
        driverId: profile?.uid || null,
        code: error?.code || errorPayload?.code || null,
        message:
          error?.message ||
          errorPayload?.message ||
          errorPayload?.error ||
          "Falha ao atualizar status remoto",
        kycRequired: isKycRequired,
        reason: errorPayload?.reason || null,
        retryAfterSec: Number(error?.retryAfterSec || 0) || null,
      });
      Logger.warn(
        "⚠️ [PrototypeRuntime] setDriverStatus remoto falhou:",
        error?.message || error,
      );
      return {
        success: false,
        isOnline: preserveOnlineOnFailure,
        pendingReconnect: preserveOnlineOnFailure,
        error:
          error?.message ||
          errorPayload?.message ||
          errorPayload?.error ||
          "Falha ao atualizar status remoto",
        reason: errorPayload?.reason || null,
        code: error?.code || errorPayload?.code || null,
        kycRequired: isKycRequired,
        challengeId: errorPayload?.challengeId || null,
        requirement: errorPayload?.requirement || null,
      };
    }
  })();

  try {
    return await runtimeDriverOnlineEnablePromise;
  } finally {
    runtimeDriverOnlineEnablePromise = null;
  }
}

async function restorePrototypeDriverOnlinePresence(profile, options = {}) {
  const socketInstance = options?.socketInstance || null;
  const firstAttempt = await enablePrototypeDriverOnline(profile, {
    preserveOnlineOnFailure: false,
    socketInstance,
  });

  if (firstAttempt?.success || firstAttempt?.blocked) {
    return firstAttempt;
  }

  await writeRuntimeDebugProbe("driver_online_restore_retry_start", {
    driverId: profile?.uid || null,
    firstError: firstAttempt?.error || null,
  });

  try {
    const socket =
      socketInstance ||
      (await getRealtimeSocket(profile, "Serviço do motorista indisponível."));
    await socket.setDriverStatus(profile.uid, "offline", false, {
      timeoutMs: 6000,
    });
  } catch (error) {
    await writeRuntimeDebugProbe("driver_online_restore_retry_offline_failed", {
      driverId: profile?.uid || null,
      message: error?.message || "Falha ao limpar presença online anterior.",
      code: error?.code || null,
    });
  }

  await delay(350);

  return enablePrototypeDriverOnline(profile, {
    preserveOnlineOnFailure: false,
    socketInstance,
  });
}

async function setPrototypeDriverDestinationMode(profile, input = {}) {
  const resolvedProfile = await resolveRuntimeActionProfile(profile, "driver");
  const wantsActive = input?.active === true;
  let nextMode = DEFAULT_DRIVER_DESTINATION_MODE;

  if (wantsActive) {
    const destinationInput = normalizeDestinationItem(input?.destination || {});
    const resolvedDestination =
      await resolveDestinationCoordinate(destinationInput);
    if (
      !resolvedDestination?.coordinate ||
      !Number.isFinite(resolvedDestination.coordinate.latitude) ||
      !Number.isFinite(resolvedDestination.coordinate.longitude)
    ) {
      throw new Error("Escolha um destino válido para ativar esse modo.");
    }

    nextMode = buildDriverDestinationModeState({
      ...input,
      active: true,
      destination: resolvedDestination,
    });
  } else {
    nextMode = {
      ...DEFAULT_DRIVER_DESTINATION_MODE,
      updatedAt: new Date().toISOString(),
    };
  }

  setRuntimeState({
    driverDestinationMode: nextMode,
    lastError: "",
  });

  if (resolvedProfile?.uid && runtimeState.driverOnline) {
    try {
      const socket = await getRealtimeSocket(
        resolvedProfile,
        "Serviço do motorista indisponível.",
      );
      await socket.setDriverStatus(
        resolvedProfile.uid,
        "available",
        true,
        {
          timeoutMs: 12000,
          destinationMode: nextMode,
        },
      );
    } catch (error) {
      setRuntimeState({
        lastError: error?.message || "Falha ao atualizar destino do motorista.",
      });
      throw error;
    }
  }

  return {
    success: true,
    destinationMode: nextMode,
  };
}

async function setPrototypeDriverOnline(profile, isOnline) {
  const resolvedProfile = await resolveRuntimeActionProfile(profile, "driver");
  const nextOnline = Boolean(isOnline);
  await writeRuntimeDebugProbe("driver_online_action_start", {
    requestedOnline: nextOnline,
    hasInputProfile: Boolean(profile),
    inputDriverId: profile?.uid || null,
    hasResolvedProfile: Boolean(resolvedProfile),
    resolvedDriverId: resolvedProfile?.uid || null,
    role: resolveExplicitProfileRole(resolvedProfile),
  });

  if (!nextOnline) {
    setRuntimeState({
      driverOnline: false,
      driverOnlinePending: false,
      driverOnlineMutationSource: "toggle_off_local",
      lastError: "",
    });

    if (!resolvedProfile?.uid) {
      stopDriverLocationHeartbeat();
      return {
        success: true,
        localOnly: true,
        isOnline: false,
      };
    }

    try {
      const socket = await getRealtimeSocket(
        resolvedProfile,
        "Serviço do motorista indisponível.",
      );
      stopDriverLocationHeartbeat();
      await socket.setDriverStatus(resolvedProfile.uid, "offline", false, {
        timeoutMs: 12000,
      });
      setRuntimeState({
        driverOnline: false,
        driverOnlinePending: false,
        driverOnlineMutationSource: "toggle_off_remote_confirmed",
        lastError: "",
      });
      return {
        success: true,
        isOnline: false,
      };
    } catch (error) {
      setRuntimeState({
        driverOnline: false,
        driverOnlinePending: false,
        driverOnlineMutationSource: "toggle_off_remote_error",
        lastError: error?.message || "Falha ao atualizar status remoto",
      });
      Logger.warn(
        "⚠️ [PrototypeRuntime] setDriverStatus remoto falhou:",
        error?.message || error,
      );
      return {
        success: false,
        isOnline: false,
        error: error?.message || "Falha ao atualizar status remoto",
      };
    }
  }

  if (resolveExplicitProfileRole(resolvedProfile) !== "driver") {
    setRuntimeState({
      driverOnline: false,
      driverOnlinePending: false,
      driverOnlineMutationSource: "enable_online_profile_not_ready",
      lastError: "Perfil do motorista ainda está sendo restaurado.",
    });
    await writeRuntimeDebugProbe("driver_online_profile_not_ready", {
      hasProfile: Boolean(resolvedProfile),
      driverId: resolvedProfile?.uid || null,
      role: resolveExplicitProfileRole(resolvedProfile),
    });
    return {
      success: false,
      blocked: true,
      reason: "Perfil do motorista ainda está sendo restaurado.",
    };
  }

  const result = await enablePrototypeDriverOnline(resolvedProfile, {
    preserveOnlineOnFailure: false,
  });
  await writeRuntimeDebugProbe("driver_online_action_finished", {
    driverId: resolvedProfile?.uid || null,
    success: result?.success === true,
    blocked: result?.blocked === true,
    isOnline: result?.isOnline === true,
    error: result?.error || result?.reason || null,
  });
  return result;
}

function resolveOfferInput(offerInput = null) {
  const bookingKey =
    offerInput?.bookingId ||
    offerInput?.id ||
    runtimeState.activeBookingId ||
    null;
  if (!bookingKey) {
    return null;
  }

  const fromQueue =
    (runtimeState.driverOffers || []).find(
      (item) => (item.bookingId || item.id) === bookingKey,
    ) || null;
  if (fromQueue) {
    return fromQueue;
  }

  return offerInput;
}

async function acceptPrototypeDriverOffer(profile, offerInput = null) {
  const offer = resolveOfferInput(offerInput);
  const bookingId = offer?.bookingId || runtimeState.activeBookingId;
  if (!bookingId) {
    await writeRuntimeDebugProbe("driver_accept_offer_missing_booking", {
      runtimeBookingId: runtimeState.activeBookingId || null,
      hasOfferInput: Boolean(offerInput),
      driverOffersCount: Array.isArray(runtimeState.driverOffers)
        ? runtimeState.driverOffers.length
        : 0,
    });
    throw new Error("Nenhuma oferta pendente para aceitar.");
  }

  const driverName = sanitizeText(
    profile?.name || profile?.firstName,
    "Motorista Leaf",
  );
  const driverId = sanitizeText(profile?.uid, `driver-${Date.now()}`);
  const driverCoordinate =
    runtimeState.driverCoordinate ||
    runtimeState.currentCoordinate ||
    getOriginCoordinate();
  const vehicleModel = sanitizeText(
    profile?.vehicleModel ||
      profile?.carModel ||
      profile?.vehicle?.model ||
      profile?.carType,
    "Leaf Plus",
  );
  const vehiclePlate = sanitizeText(
    profile?.vehiclePlate || profile?.carPlate || profile?.vehicle?.plate,
    "LEF-2042",
  );

  await writeRuntimeDebugProbe("driver_accept_offer_attempt", {
    bookingId,
    driverId,
    hasOffer: Boolean(offer),
    bookingStatus: runtimeState.bookingStatus || null,
    driverOffersCount: Array.isArray(runtimeState.driverOffers)
      ? runtimeState.driverOffers.length
      : 0,
  });

  try {
    const socket = await getRealtimeSocket(
      profile,
      "Serviço de aceite indisponível.",
    );
    await socket.acceptRide(bookingId, {
      driverId,
      driverName,
      driver: {
        id: driverId,
        name: driverName,
        location: {
          lat: driverCoordinate.latitude,
          lng: driverCoordinate.longitude,
        },
        vehicle: {
          model: vehicleModel,
          plate: vehiclePlate,
        },
      },
      location: {
        lat: driverCoordinate.latitude,
        lng: driverCoordinate.longitude,
      },
      vehicle: {
        model: vehicleModel,
        plate: vehiclePlate,
      },
    });
    await writeRuntimeDebugProbe("driver_accept_offer_remote_success", {
      bookingId,
      driverId,
    });
  } catch (error) {
    await writeRuntimeDebugProbe("driver_accept_offer_remote_error", {
      bookingId,
      driverId,
      message: error?.message || String(error),
    });
    if (isCompetitiveAcceptErrorMessage(error?.message || error)) {
      setRuntimeState((previous) => {
        const result = dismissDriverOfferRuntimeState(previous, bookingId);
        return {
          ...result.patch,
          lastError: "",
        };
      });
      showDriverTransientCard({
        type: "accepted_by_other_driver_competitive",
        bookingId,
        title: "Outro motorista aceitou a solicitação",
        message:
          "Essa oferta saiu do seu painel porque outro parceiro concluiu o aceite primeiro.",
      });
      throw new Error("Outro motorista aceitou a solicitação primeiro.");
    }
    Logger.warn(
      "⚠️ [PrototypeRuntime] acceptRide remoto falhou, abortando aceite local:",
      error?.message || error,
    );
    throw error instanceof Error
      ? error
      : new Error(error?.message || "Não foi possível aceitar a solicitação.");
  }

  const activeRide =
    offer ||
    buildDriverOffer({
      bookingId,
      destination: runtimeState.selectedDestination,
      fare: runtimeState.selectedFare,
      etaMinutes: runtimeState.tripDurationMin,
      pickupAddress: runtimeState.currentAddress,
      pickupCoordinate:
        offer?.pickupCoordinate ||
        resolvePickupCoordinateFromRide(
          runtimeState.driverActiveRide,
          runtimeState.activeBooking,
        ),
      passengerName:
        runtimeState.driverActiveRide?.passenger ||
        runtimeState.activeBooking?.customerName ||
        runtimeState.activeBooking?.passengerName ||
        runtimeState.profileName,
      passengerId:
        runtimeState.driverActiveRide?.passengerId ||
        runtimeState.activeBooking?.customerId ||
        runtimeState.activeBooking?.passengerId ||
        "",
    });
  const normalizedActiveRide = mergeLockedDriverRideSnapshot(
    runtimeState.driverActiveRide,
    offer,
    activeRide,
  );
  const pickupCoordinate = resolvePickupCoordinateFromRide(
    normalizedActiveRide,
    runtimeState.activeBooking,
  );
  const destinationCoordinate = resolveDestinationCoordinateFromRide(
    normalizedActiveRide,
    runtimeState.selectedDestination,
    runtimeState.activeBooking,
  );
  let pickupPreview = null;
  let liveRoutePlanResult = null;
  if (driverCoordinate && pickupCoordinate && destinationCoordinate) {
    liveRoutePlanResult = await buildLiveTripRoutePlan({
      origin: driverCoordinate,
      pickup: pickupCoordinate,
      pickupAddress:
        normalizedActiveRide?.pickup ||
        normalizedActiveRide?.pickupAddress ||
        runtimeState.currentAddress,
      destination: destinationCoordinate,
      destinationLabel:
        runtimeState.selectedDestination?.name ||
        normalizedActiveRide?.dropoff ||
        "Destino",
      destinationAddress:
        normalizedActiveRide?.dropoffAddress ||
        runtimeState.selectedDestination?.address ||
        runtimeState.selectedDestination?.name ||
        "Destino",
      telemetryContext: resolveRuntimeRideTelemetryContext({
        bookingId,
        role: "driver",
        surface: "driver_live_route_prefetch",
        }),
      });
    } else if (driverCoordinate && pickupCoordinate) {
    pickupPreview = await previewDriverPickupRoute({
      origin: driverCoordinate,
      pickup: pickupCoordinate,
      pickupAddress:
        normalizedActiveRide?.pickup ||
        normalizedActiveRide?.pickupAddress ||
        runtimeState.currentAddress,
      });
    }
  const persistedRoutePlan = ensurePersistedDriverRoutePlan({
    bookingId,
    pickupCoordinate,
    destinationCoordinate,
    routePlan: liveRoutePlanResult?.routePlan,
    fallbackOriginCoordinate: driverCoordinate,
  });
  const baselineDistanceKm = Number(
    liveRoutePlanResult?.pickupMetrics?.distanceKm ?? pickupPreview?.distanceKm,
  );
  const baselineDurationMinutes = Number(
    liveRoutePlanResult?.pickupMetrics?.durationMinutes ??
      pickupPreview?.durationMinutes,
  );
  const fallbackDurationMinutes = Number(runtimeState.tripDurationMin || 0);
  const resolvedFare = resolveDriverPayoutAmount(
    normalizedActiveRide,
    runtimeState.driverTripMeta,
  );
  const resolvedExplicitPayout = resolveDriverExplicitPayoutAmount(
    normalizedActiveRide,
    runtimeState.driverTripMeta,
  );

  setRuntimeState((previous) => ({
    bookingStatus: "accepted",
    activeBookingId: bookingId,
    boardingDeadlineAt: null,
    boardingRemainingSec: 0,
    tripDistanceKm:
      Number.isFinite(baselineDistanceKm) && baselineDistanceKm > 0
        ? baselineDistanceKm
        : previous.tripDistanceKm,
    tripDurationMin:
      Number.isFinite(baselineDurationMinutes) && baselineDurationMinutes > 0
        ? Math.max(1, Math.round(baselineDurationMinutes))
        : fallbackDurationMinutes > 0
          ? Math.max(1, Math.round(fallbackDurationMinutes))
          : previous.tripDurationMin,
    tripArrivalText:
      liveRoutePlanResult?.pickupMetrics?.etaText ||
      pickupPreview?.etaText ||
      (fallbackDurationMinutes > 0
        ? `Chegada estimada em ${Math.max(1, Math.round(fallbackDurationMinutes))} min`
        : previous.tripArrivalText),
    driverInfo: {
      id: driverId,
      name: driverName,
      plate: vehiclePlate,
      model: vehicleModel,
      rating: Number(profile?.rating || 4.9),
    },
    driverCoordinate,
    driverTripMeta: {
      ...(previous.driverTripMeta || {}),
      leg: "pickup",
      initialMeters:
        Number.isFinite(baselineDistanceKm) && baselineDistanceKm > 0
          ? Math.round(baselineDistanceKm * 1000)
          : previous.driverTripMeta?.initialMeters,
      initialEtaMinutes:
        Number.isFinite(baselineDurationMinutes) && baselineDurationMinutes > 0
          ? Math.max(1, Math.round(baselineDurationMinutes))
          : fallbackDurationMinutes > 0
            ? Math.max(1, Math.round(fallbackDurationMinutes))
            : previous.driverTripMeta?.initialEtaMinutes,
      pickupAddress:
        normalizedActiveRide?.pickup ||
        normalizedActiveRide?.pickupAddress ||
        runtimeState.currentAddress ||
        "Local de embarque",
      destinationAddress:
        normalizedActiveRide?.dropoffAddress ||
        normalizedActiveRide?.dropoff ||
        runtimeState.selectedDestination?.address ||
        runtimeState.selectedDestination?.name ||
        "Destino",
      pickupCoordinate,
      destinationCoordinate,
      ...(Number.isFinite(resolvedFare)
        ? {
            fare: resolvedFare,
            fareLabel: formatCurrencyBR(resolvedFare),
          }
        : {}),
      ...(Number.isFinite(resolvedExplicitPayout)
        ? {
            driverNetAmount: resolvedExplicitPayout,
            estimatedDriverNetAmount: resolvedExplicitPayout,
          }
        : {}),
      routePlan:
        persistedRoutePlan ||
        previous.driverTripMeta?.routePlan ||
        null,
    },
    driverOffers: (previous.driverOffers || []).filter(
      (item) => (item.bookingId || item.id) !== bookingId,
    ),
    driverActiveRide: {
      ...normalizedActiveRide,
      bookingId,
      status: "accepted",
    },
    lastError: "",
  }));
  appendRuntimeNotification(
    createRuntimeNotification({
      title: "Corrida aceita",
      message: "Você assumiu uma nova corrida no painel do motorista.",
      kind: "driver",
      scope: "driver",
    }),
  );
  await writeRuntimeDebugProbe("driver_accept_offer_local_success", {
    bookingId,
    driverId,
    bookingStatus: "accepted",
  });
  try {
    const routePlanShareResult = await pushDriverLocationNow(profile);
    const sharedRoutePlan =
      persistedRoutePlan ||
      extractDriverRoutePlan(runtimeState.driverTripMeta) ||
      null;
    await writeRuntimeDebugProbe("driver_route_plan_share_after_accept_success", {
      bookingId,
      driverId,
      result: routePlanShareResult,
      pickupPoints: Array.isArray(sharedRoutePlan?.pickupCoordinates)
        ? sharedRoutePlan.pickupCoordinates.length
        : 0,
      destinationPoints: Array.isArray(sharedRoutePlan?.destinationCoordinates)
        ? sharedRoutePlan.destinationCoordinates.length
        : 0,
    });
  } catch (routeShareError) {
    await writeRuntimeDebugProbe("driver_route_plan_share_after_accept_failed", {
      bookingId,
      driverId,
      message:
        routeShareError?.message ||
        "Falha ao compartilhar rota após aceite do motorista.",
    });
  }

  return {
    success: true,
    bookingId,
    ride: activeRide,
  };
}

async function rejectPrototypeDriverOffer(
  profile,
  offerInput = null,
  reason = "Motorista indisponível",
) {
  const offer = resolveOfferInput(offerInput);
  const bookingId = offer?.bookingId || runtimeState.activeBookingId;
  if (!bookingId) {
    throw new Error("Nenhuma oferta pendente para recusar.");
  }

  try {
    const socket = await getRealtimeSocket(
      profile,
      "Serviço de recusa indisponível.",
    );
    await socket.rejectRide(bookingId, reason);
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] rejectRide remoto falhou, mantendo fluxo local:",
      error?.message || error,
    );
  }

  if (runtimeState.activeBookingId === bookingId) {
    stopSearchingTimer();
    stopBoardingCountdownTimer();
  }

  setRuntimeState((previous) => {
    const result = dismissDriverOfferRuntimeState(previous, bookingId);
    return result.patch;
  });
  appendRuntimeNotification(
    createRuntimeNotification({
      title: "Corrida recusada",
      message: reason || "A oferta foi recusada no painel do motorista.",
      kind: "driver",
      scope: "driver",
    }),
  );

  return {
    success: true,
    bookingId,
  };
}

function clearDestinationPreview() {
  clearPrototypeMapRoute();
  stopBoardingCountdownTimer();
  setRuntimeState({
    selectedDestination: null,
    quoteLock: null,
    tripDistanceKm: null,
    tripDurationMin: null,
    tripArrivalText: "",
    boardingDeadlineAt: null,
    boardingRemainingSec: 0,
  });
}

export function usePrototypeRideRuntime() {
  const authProfile = useSelector((state) => state?.auth?.profile);
  const authUid = useSelector((state) => state?.auth?.uid);
  const [snapshot, setSnapshot] = useState(runtimeState);
  const [persistedProfile, setPersistedProfile] = useState(null);
  const runtimeConsumerIdRef = useRef(createId("runtime_consumer"));
  const reservedRuntimeEffectOwnerId = reserveRuntimeEffectConsumer(
    runtimeConsumerIdRef.current,
  );
  const [isRuntimeEffectOwner, setIsRuntimeEffectOwner] = useState(
    () =>
      String(reservedRuntimeEffectOwnerId || "") ===
      String(runtimeConsumerIdRef.current),
  );
  const lastPassengerQuotePreviewKeyRef = useRef("");
  const lastPassengerQuoteAddressKeyRef = useRef("");
  const lastDriverRoutePreviewKeyRef = useRef("");
  const lastPassengerRoutePreviewKeyRef = useRef("");
  const bootstrapPersistKeyRef = useRef("");

  useEffect(() => {
    const consumerId = runtimeConsumerIdRef.current;
    const syncOwnerState = (ownerId) => {
      setIsRuntimeEffectOwner(String(ownerId || "") === String(consumerId));
    };

    const unsubscribeOwner = subscribeRuntimeEffectOwner(syncOwnerState);
    const unregisterConsumer = registerRuntimeEffectConsumer(consumerId);
    syncOwnerState(runtimeEffectOwnerId);

    return () => {
      unsubscribeOwner();
      unregisterConsumer();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const restorePersistedProfile = async () => {
      if (authProfile?.uid) {
        if (!cancelled) {
          setPersistedProfile(null);
        }
        return;
      }

      try {
        const entries = await AsyncStorage.multiGet([
          USER_DATA_STORAGE_KEY,
          AUTH_UID_STORAGE_KEY,
        ]);
        const storedUserData = entries?.[0]?.[1] || null;
        const storedUid = String(entries?.[1]?.[1] || authUid || "").trim();

        let parsedProfile = null;
        if (storedUserData) {
          try {
            parsedProfile = JSON.parse(storedUserData);
          } catch (parseError) {
            Logger.warn(
              "⚠️ [PrototypeRuntime] Falha ao parsear @user_data persistido:",
              parseError?.message || parseError,
            );
          }
        }

        const normalizedProfile = normalizePersistedPrototypeProfile(
          parsedProfile,
          storedUid,
        );
        const shouldAttemptQaProfileRestore =
          Boolean(storedUid) &&
          (!normalizedProfile ||
            !resolveExplicitProfileRole(normalizedProfile));
        const qaRestoredProfile = shouldAttemptQaProfileRestore
          ? await restoreQaSeedProfile({
              AsyncStorage,
              authUidKey: AUTH_UID_STORAGE_KEY,
              userDataKey: USER_DATA_STORAGE_KEY,
              driverActivationKey: `${DRIVER_ACTIVATION_STORAGE_PREFIX}${storedUid}`,
            })
          : null;
        const finalProfile = normalizePersistedPrototypeProfile(
          qaRestoredProfile || normalizedProfile,
          storedUid,
        );
        if (!cancelled) {
          setPersistedProfile(finalProfile);
        }
      } catch (error) {
        if (!cancelled) {
          setPersistedProfile(null);
        }
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao restaurar perfil persistido do runtime:",
          error?.message || error,
        );
      }
    };

    restorePersistedProfile();

    return () => {
      cancelled = true;
    };
  }, [authProfile?.uid, authUid]);

  const profile = useMemo(() => {
    const sourceProfile = authProfile || persistedProfile;
    if (!sourceProfile) {
      return null;
    }

    return {
      ...sourceProfile,
      uid: sourceProfile.uid || authUid || null,
    };
  }, [authProfile, authUid, persistedProfile]);

  const scopedNotifications = useMemo(() => {
    if (!Array.isArray(snapshot.notifications)) {
      return [];
    }

    const activeRole =
      normalizeRuntimeRole(snapshot.activeRole) || resolveRuntimeRole(profile);
    return snapshot.notifications.filter((item) => {
      const scope = String(item?.scope || "both")
        .trim()
        .toLowerCase();
      if (scope === "both") {
        return true;
      }
      if (scope === "passenger" || scope === "customer") {
        return activeRole === "customer";
      }
      if (scope === "driver") {
        return activeRole === "driver";
      }
      return true;
    });
  }, [profile, snapshot.activeRole, snapshot.notifications]);

  const unreadNotificationCount = useMemo(() => {
    if (!Array.isArray(scopedNotifications)) {
      return 0;
    }
    return scopedNotifications.filter((item) => !item.read).length;
  }, [scopedNotifications]);

  const driverTripAssist = useMemo(
    () => buildDriverTripAssistModel(snapshot),
    [snapshot],
  );
  const liveTripProgress = useMemo(
    () => buildLiveTripProgressModel(snapshot, resolveRuntimeRole(profile)),
    [profile, snapshot],
  );

  useEffect(() => {
    return subscribeRuntime(setSnapshot);
  }, []);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return;
    }

    const incomingName = resolvePrototypeProfileName(profile);
    const incomingEmail = resolvePrototypeProfileEmail(profile);
    const incomingPhone = resolvePrototypeProfilePhone(profile);

    setRuntimeState((previous) => ({
      profileUid: profile?.uid || null,
      profileName: incomingName,
      riderProfile: {
        ...previous.riderProfile,
        name: incomingName,
        email: incomingEmail,
        phone: incomingPhone,
        phoneNumber: incomingPhone,
      },
    }));
  }, [
    isRuntimeEffectOwner,
    profile?.displayName,
    profile?.email,
    profile?.firstName,
    profile?.fullName,
    profile?.lastName,
    profile?.mobile,
    profile?.name,
    profile?.profile?.displayName,
    profile?.profile?.email,
    profile?.profile?.firstName,
    profile?.profile?.fullName,
    profile?.profile?.lastName,
    profile?.profile?.mobile,
    profile?.profile?.name,
    profile?.profile?.phone,
    profile?.profile?.phoneNumber,
    profile?.phone,
    profile?.phoneNumber,
    profile?.uid,
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return;
    }

    const activeRole = resolveRuntimeRole(profile);
    setRuntimeState({
      activeRole,
    });

    if (activeRole === "driver" && profile?.uid) {
      setRuntimeState({
        driverActivationResolved: false,
      });
      syncDriverActivationWithProfile(profile, {
        force: true,
        source: "role_effect",
      }).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao sincronizar ativação do motorista:",
          error?.message || error,
        );
      });
      startDriverActivationRemoteSync(profile);
    } else {
      setRuntimeState({
        driverActivationResolved: false,
      });
      syncDriverActivationWithProfile(profile, {
        force: true,
        source: "role_effect",
      }).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao sincronizar ativação do motorista:",
          error?.message || error,
        );
      });
      stopDriverActivationRemoteSync();
    }
  }, [
    isRuntimeEffectOwner,
    profile?.uid,
    profile?.usertype,
    profile?.userType,
    profile?.role,
    profile?.user_role,
    profile?.accountType,
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return;
    }

    if (!profile?.uid) {
      return;
    }

    if (!runtimeState.ready && !runtimeState.initializing) {
      bootstrapRuntime(profile).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha no bootstrap:",
          error?.message || error,
        );
      });
      return;
    }

    if (profile?.uid) {
      ensureSocketReady(profile).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao garantir conexão:",
          error?.message || error,
        );
      });
    }
  }, [isRuntimeEffectOwner, profile, profile?.uid]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return;
    }

    const profileUid = String(snapshot.profileUid || "").trim();
    const canPersistBootstrapSnapshot =
      Boolean(profileUid) && snapshot.ready && !snapshot.initializing;

    if (!canPersistBootstrapSnapshot) {
      bootstrapPersistKeyRef.current = "";
      return;
    }

    if (bootstrapPersistKeyRef.current === profileUid) {
      return;
    }

    bootstrapPersistKeyRef.current = profileUid;
    if (hasRuntimeActiveRideContext(snapshot)) {
      writeRuntimeDebugProbe("runtime_session_flush_skipped_active_ride", {
        userId: profileUid,
        reason: "ready_profile_bootstrap",
        bookingStatus: snapshot.bookingStatus || null,
        activeBookingId: snapshot.activeBookingId || null,
        hasDriverActiveRide: Boolean(snapshot.driverActiveRide?.bookingId),
      });
      return;
    }

    flushRuntimeSessionNow("ready_profile_bootstrap").catch((error) => {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao persistir bootstrap pronto:",
        error?.message || error,
      );
    });
  }, [
    isRuntimeEffectOwner,
    snapshot.initializing,
    snapshot.profileUid,
    snapshot.ready,
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return undefined;
    }

    if (!profile?.uid) {
      return undefined;
    }

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (shouldFlushRuntimeSessionOnAppState(nextState)) {
        flushRuntimeSessionNow(`appstate_${String(nextState).toLowerCase()}`).catch(
          (error) => {
            Logger.warn(
              "⚠️ [PrototypeRuntime] Falha ao persistir sessão ao trocar estado do app:",
              error?.message || error,
            );
          },
        );
      }

      if (nextState !== "active") {
        return;
      }

      const foregroundRole = resolveRuntimeRole(profile);
      ensureCurrentLocation({
        allowCurrentPosition: true,
        forceCurrentPosition:
          Platform.OS === "android" &&
          foregroundRole === "customer" &&
          !runtimeState.activeBookingId,
      }).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao refrescar localização em foreground:",
          error?.message || error,
        );
      });

      refreshPrototypeRealtimeSession(profile, {
        reason: "appstate_active",
        syncActiveRide: true,
      }).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao ressincronizar em foreground:",
          error?.message || error,
        );
      });
    });

    return () => {
      subscription.remove();
    };
  }, [isRuntimeEffectOwner, profile, profile?.uid]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return undefined;
    }

    const normalizedStatus = normalizeRuntimeLifecycleStatus(
      snapshot.bookingStatus,
    );

    if (!["searching", "requesting"].includes(normalizedStatus)) {
      return undefined;
    }

    if (runtimeSearchTimer) {
      return undefined;
    }

    startSearchingTimer({ preserveElapsed: true });
    return undefined;
  }, [isRuntimeEffectOwner, snapshot.bookingStatus]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return undefined;
    }

    const role = resolveRuntimeRole(profile);
    const shouldRefreshDriverLocation =
      role === "driver" &&
      ["accepted", "started"].includes(driverTripAssist?.status || "");

    if (!shouldRefreshDriverLocation) {
      return undefined;
    }

    const refreshLocation = () => {
      if (AppState.currentState !== "active") {
        return;
      }

      ensureCurrentLocation({
        allowCurrentPosition: true,
        resolveAddress: false,
      }).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao atualizar localização ativa do motorista:",
          error?.message || error,
        );
      });
    };

    refreshLocation();
    const interval = setInterval(
      refreshLocation,
      DRIVER_ACTIVE_LOCATION_REFRESH_MS,
    );

    return () => {
      clearInterval(interval);
    };
  }, [isRuntimeEffectOwner, driverTripAssist?.status, profile]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return undefined;
    }

    const role = resolveRuntimeRole(profile);
    const destination = snapshot.selectedDestination;
    const destinationCoordinate = destination?.coordinate || null;
    const originCoordinate = snapshot.currentCoordinate || null;
    const normalizedBookingStatus = String(snapshot.bookingStatus || "")
      .trim()
      .toLowerCase();
    const canRefreshPreBookingPreview =
      role === "customer" &&
      !snapshot.activeBookingId &&
      normalizedBookingStatus === "idle" &&
      Number.isFinite(originCoordinate?.latitude) &&
      Number.isFinite(originCoordinate?.longitude) &&
      Number.isFinite(destinationCoordinate?.latitude) &&
      Number.isFinite(destinationCoordinate?.longitude);

    if (!canRefreshPreBookingPreview) {
      lastPassengerQuotePreviewKeyRef.current = "";
      return undefined;
    }

    const previewKey = [
      Math.round(Number(destinationCoordinate.latitude) * 10000),
      Math.round(Number(destinationCoordinate.longitude) * 10000),
      sanitizeText(destination?.name || destination?.address || "", "").toLowerCase(),
    ].join(":");
    const originAddressKey = [
      Math.round(Number(originCoordinate.latitude) * 10000),
      Math.round(Number(originCoordinate.longitude) * 10000),
    ].join(":");

    if (lastPassengerQuotePreviewKeyRef.current === previewKey) {
      return undefined;
    }

    lastPassengerQuotePreviewKeyRef.current = previewKey;
    const timer = setTimeout(() => {
      if (lastPassengerQuoteAddressKeyRef.current !== originAddressKey) {
        lastPassengerQuoteAddressKeyRef.current = originAddressKey;
        Location.reverseGeocodeAsync({
          latitude: Number(originCoordinate.latitude),
          longitude: Number(originCoordinate.longitude),
        })
          .then((reverse) => {
            const first =
              Array.isArray(reverse) && reverse.length > 0 ? reverse[0] : null;
            if (!first) {
              return;
            }

            const refreshedAddress = [first.name, first.street, first.city]
              .filter(Boolean)
              .join(", ");

            if (refreshedAddress) {
              setRuntimeState({
                currentAddress: refreshedAddress,
              });
            }
          })
          .catch((error) => {
            Logger.warn(
              "⚠️ [PrototypeRuntime] Falha ao atualizar endereço atual antes do pagamento:",
              error?.message || error,
            );
          });
      }

      previewDestinationOnMap(destination).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao recalcular preview da corrida antes do pagamento:",
          error?.message || error,
        );
      });
    }, 180);

    return () => {
      clearTimeout(timer);
    };
  }, [
    isRuntimeEffectOwner,
    profile,
    profile?.uid,
    profile?.usertype,
    profile?.userType,
    profile?.role,
    profile?.user_role,
    profile?.accountType,
    snapshot.bookingStatus,
    snapshot.activeBookingId,
    snapshot.currentCoordinate,
    snapshot.selectedDestination,
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return undefined;
    }

    if (!profile?.uid) {
      return undefined;
    }

    const role = resolveRuntimeRole(profile);
    const shouldMaintainRealtimeSession =
      shouldMaintainRealtimeSessionForSnapshot(role, snapshot);

    if (!shouldMaintainRealtimeSession) {
      return undefined;
    }

    refreshPrototypeRealtimeSession(profile, {
      reason:
        role === "driver" ? "driver_online_initial_sync" : "active_flow_initial",
      syncActiveRide: shouldSyncActiveRideForSnapshot(role, snapshot),
    }).catch((error) => {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha na ressincronização inicial do runtime:",
        error?.message || error,
      );
    });

    const interval = setInterval(() => {
      refreshPrototypeRealtimeSession(profile, {
        reason:
          role === "driver" ? "driver_online_resync" : "active_flow_poll",
        syncActiveRide: shouldSyncActiveRideForSnapshot(role, snapshot),
      }).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao manter runtime sincronizado:",
          error?.message || error,
        );
      });
    }, RUNTIME_ACTIVE_RIDE_RESYNC_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [
    isRuntimeEffectOwner,
    profile,
    profile?.uid,
    profile?.usertype,
    profile?.userType,
    profile?.role,
    profile?.user_role,
    profile?.accountType,
    snapshot.bookingStatus,
    snapshot.driverActiveRide?.bookingId,
    snapshot.driverOnline,
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return;
    }

    const role = resolveRuntimeRole(profile);
    const shouldKeepHeartbeat =
      role === "driver" &&
      Boolean(profile?.uid) &&
      Boolean(snapshot.driverOnline);

    if (!shouldKeepHeartbeat) {
      stopDriverLocationHeartbeat();
      return;
    }

    ensureSocketReady(profile)
      .then((ready) => {
        if (!ready) {
          return;
        }

        startDriverLocationHeartbeat(profile).catch((error) => {
          Logger.warn(
            "⚠️ [PrototypeRuntime] Falha ao garantir heartbeat contínuo do motorista:",
            error?.message || error,
          );
        });
      })
      .catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao preparar heartbeat do motorista:",
          error?.message || error,
        );
      });
  }, [
    isRuntimeEffectOwner,
    profile,
    profile?.uid,
    profile?.usertype,
    profile?.userType,
    profile?.role,
    profile?.user_role,
    profile?.accountType,
    snapshot.driverOnline,
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return;
    }

    const role = resolveRuntimeRole(profile);
    const shouldKeepPassengerHeartbeat =
      role === "customer" &&
      Boolean(profile?.uid) &&
      Boolean(snapshot.activeBookingId) &&
      ["accepted", "arrived", "started"].includes(
        String(snapshot.bookingStatus || "").toLowerCase(),
      );

    if (!shouldKeepPassengerHeartbeat) {
      stopPassengerLocationHeartbeat();
      return;
    }

    ensureSocketReady(profile)
      .then((ready) => {
        if (!ready) {
          return;
        }

        startPassengerLocationHeartbeat(profile).catch((error) => {
          Logger.warn(
            "⚠️ [PrototypeRuntime] Falha ao garantir heartbeat contínuo do passageiro:",
            error?.message || error,
          );
        });
      })
      .catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao preparar heartbeat do passageiro:",
          error?.message || error,
        );
      });
  }, [
    isRuntimeEffectOwner,
    profile,
    profile?.uid,
    profile?.usertype,
    profile?.userType,
    profile?.role,
    profile?.user_role,
    profile?.accountType,
    snapshot.bookingStatus,
    snapshot.activeBookingId,
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return;
    }

    const role = resolveRuntimeRole(profile);
    if (role !== "driver") {
      return;
    }

    if (
      !snapshot.driverActivationResolved ||
      !snapshot.driverOnline ||
      snapshot.driverCanGoOnline
    ) {
      return;
    }

    if (!profile?.uid) {
      stopDriverLocationHeartbeat();
      return;
    }

    setPrototypeDriverOnline(profile, false).catch((error) => {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao forçar offline após bloqueio de ativação:",
        error?.message || error,
      );
    });
  }, [
    isRuntimeEffectOwner,
    profile,
    profile?.uid,
    profile?.usertype,
    profile?.userType,
    profile?.role,
    profile?.user_role,
    profile?.accountType,
    snapshot.driverActivationResolved,
    snapshot.driverCanGoOnline,
    snapshot.driverOnline,
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return undefined;
    }

    const role = resolveRuntimeRole(profile);
    if (role !== "driver") {
      interactiveNotificationService.clearActionExecutor();
      return undefined;
    }

    interactiveNotificationService.setActionExecutor(
      async ({ actionIdentifier }) => {
        const action = String(actionIdentifier || "")
          .trim()
          .toLowerCase();
        const latestContext =
          await prototypeDriverTripAssistantService.getLatestActionContext();
        const locationOverride =
          latestContext?.lastDriverLocation ||
          latestContext?.currentDriverLocation ||
          null;

        if (action === "arrived_at_pickup") {
          if (!latestContext?.pickupToleranceReached) {
            return true;
          }
          await arrivePrototypePickup(profile, { locationOverride });
          return true;
        }

        if (action === "start_trip") {
          await startPrototypeTrip({ locationOverride });
          return true;
        }

        if (action === "end_trip") {
          await completePrototypeTrip({ locationOverride });
          return true;
        }

        return false;
      },
    );

    return () => {
      interactiveNotificationService.clearActionExecutor();
    };
  }, [isRuntimeEffectOwner, profile]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return;
    }

    const role = resolveRuntimeRole(profile);
    if (role !== "driver") {
      prototypeDriverTripAssistantService.clearSession().catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao limpar assistente de corrida do motorista:",
          error?.message || error,
        );
      });
      return;
    }

    const bookingId =
      snapshot.activeBookingId || snapshot.driverActiveRide?.bookingId || null;
    if (!driverTripAssist || !bookingId) {
      prototypeDriverTripAssistantService.clearSession().catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao limpar sessão de apoio do motorista:",
          error?.message || error,
        );
      });
      return;
    }

    prototypeDriverTripAssistantService
      .syncSession({
        bookingId,
        status: driverTripAssist.status,
        pickupAddress: driverTripAssist.pickupAddress,
        destinationAddress: driverTripAssist.destinationAddress,
        pickupCoordinate: driverTripAssist.pickupCoordinate,
        destinationCoordinate: driverTripAssist.destinationCoordinate,
        currentDriverLocation:
          snapshot.currentCoordinate || snapshot.driverCoordinate || null,
        initialMeters:
          snapshot.driverTripMeta?.initialMeters ||
          (Number.isFinite(Number(snapshot.tripDistanceKm))
            ? Math.round(Number(snapshot.tripDistanceKm) * 1000)
            : null),
        initialEtaMinutes:
          snapshot.driverTripMeta?.initialEtaMinutes ||
          (Number.isFinite(Number(snapshot.tripDurationMin))
            ? Math.max(1, Math.round(Number(snapshot.tripDurationMin)))
            : null),
        remainingMeters: driverTripAssist.remainingMeters,
        etaMinutes: driverTripAssist.etaMinutes,
        boardingRemainingSec: snapshot.boardingRemainingSec,
        passengerName:
          snapshot.driverActiveRide?.passenger ||
          snapshot.activeBooking?.customerName ||
          snapshot.profileName ||
          "Passageiro",
        ...(Number.isFinite(Number(snapshot.driverTripMeta?.driverNetAmount))
          ? {
              fare: Number(snapshot.driverTripMeta.driverNetAmount),
              driverNetAmount: Number(snapshot.driverTripMeta.driverNetAmount),
              fareLabel:
                snapshot.driverTripMeta?.fareLabel ||
                formatCurrencyBR(
                  Number(snapshot.driverTripMeta.driverNetAmount),
                ),
            }
          : Number.isFinite(Number(snapshot.driverTripMeta?.fare))
            ? {
                fare: Number(snapshot.driverTripMeta.fare),
                fareLabel:
                  snapshot.driverTripMeta?.fareLabel ||
                  formatCurrencyBR(Number(snapshot.driverTripMeta.fare)),
              }
          : {}),
      })
      .catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao sincronizar assistência do motorista:",
          error?.message || error,
        );
      });
  }, [
    isRuntimeEffectOwner,
    driverTripAssist?.status,
    driverTripAssist?.pickupAddress,
    driverTripAssist?.destinationAddress,
    driverTripAssist?.pickupCoordinate?.latitude,
    driverTripAssist?.pickupCoordinate?.longitude,
    driverTripAssist?.destinationCoordinate?.latitude,
    driverTripAssist?.destinationCoordinate?.longitude,
    driverTripAssist?.remainingMeters,
    driverTripAssist?.etaMinutes,
    profile?.uid,
    profile?.usertype,
    profile?.userType,
    profile?.role,
    profile?.user_role,
    profile?.accountType,
    snapshot.activeBooking?.customerName,
    snapshot.activeBooking?.estimatedFare,
    snapshot.activeBookingId,
    snapshot.boardingRemainingSec,
    snapshot.currentCoordinate?.latitude,
    snapshot.currentCoordinate?.longitude,
    snapshot.driverActiveRide?.bookingId,
    snapshot.driverActiveRide?.passenger,
    snapshot.driverCoordinate?.latitude,
    snapshot.driverCoordinate?.longitude,
    snapshot.driverTripMeta?.initialMeters,
    snapshot.driverTripMeta?.initialEtaMinutes,
    snapshot.driverTripMeta?.fare,
    snapshot.driverTripMeta?.fareLabel,
    snapshot.profileName,
    snapshot.selectedFare,
    snapshot.tripDistanceKm,
    snapshot.tripDurationMin,
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return undefined;
    }

    const cardId = String(snapshot.driverTransientCard?.id || "").trim();
    const visibleUntil = snapshot.driverTransientCard?.visibleUntil;

    if (!cardId || !visibleUntil) {
      return undefined;
    }

    const remainingMs = new Date(visibleUntil).getTime() - Date.now();
    if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
      dismissDriverTransientCard(cardId);
      return undefined;
    }

    const timer = setTimeout(() => {
      dismissDriverTransientCard(cardId);
    }, remainingMs);

    return () => {
      clearTimeout(timer);
    };
  }, [
    isRuntimeEffectOwner,
    snapshot.driverTransientCard?.id,
    snapshot.driverTransientCard?.visibleUntil,
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return;
    }

    if (!liveTripProgress) {
      return;
    }

    setRuntimeState((previousState) => {
      const nextDistanceKm = liveTripProgress.distanceKm;
      const nextDurationMin = liveTripProgress.etaMinutes;
      const nextArrivalText = liveTripProgress.arrivalText || "";
      const previousDistanceKm = Number(previousState?.tripDistanceKm);
      const previousDurationMin = Number(previousState?.tripDurationMin);
      const previousArrivalText = String(previousState?.tripArrivalText || "");
      const sameDistance =
        Number.isFinite(nextDistanceKm) && Number.isFinite(previousDistanceKm)
          ? Math.abs(previousDistanceKm - nextDistanceKm) < 0.05
          : previousState?.tripDistanceKm === nextDistanceKm;
      const sameDuration =
        Number.isFinite(nextDurationMin) && Number.isFinite(previousDurationMin)
          ? previousDurationMin === nextDurationMin
          : previousState?.tripDurationMin === nextDurationMin;

      if (
        sameDistance &&
        sameDuration &&
        previousArrivalText === nextArrivalText
      ) {
        return null;
      }

      return {
        tripDistanceKm: nextDistanceKm,
        tripDurationMin: nextDurationMin,
        tripArrivalText: nextArrivalText,
      };
    });
  }, [isRuntimeEffectOwner, liveTripProgress]);

  const prototypePlaybackConfig = useMemo(
    () => getPrototypePlaybackConfigSnapshot(),
    [],
  );

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return undefined;
    }

    const role = resolveRuntimeRole(profile);
    const playbackStatus = String(driverTripAssist?.status || "")
      .trim()
      .toLowerCase();
    const driverPlaybackCoordinate =
      snapshot.currentCoordinate || snapshot.driverCoordinate || null;
    const shouldRunPlayback =
      role === "driver" &&
      ["accepted", "started"].includes(playbackStatus) &&
      Boolean(snapshot.activeBookingId || snapshot.driverActiveRide?.bookingId) &&
      Number.isFinite(driverPlaybackCoordinate?.latitude) &&
      Number.isFinite(driverPlaybackCoordinate?.longitude) &&
      Number.isFinite(driverTripAssist?.targetCoordinate?.latitude) &&
      Number.isFinite(driverTripAssist?.targetCoordinate?.longitude);

    if (!shouldRunPlayback) {
      stopDriverRoutePlayback();
      return undefined;
    }

    const runPlaybackTick = () => {
      const currentState = runtimeState;
      const currentStatus = String(
        currentState.driverActiveRide?.status ||
          currentState.bookingStatus ||
          "",
      )
        .trim()
        .toLowerCase();

      if (!["accepted", "started"].includes(currentStatus)) {
        stopDriverRoutePlayback();
        return;
      }

      const currentCoordinate =
        currentState.currentCoordinate || currentState.driverCoordinate || null;
      const nextTripAssist = buildDriverTripAssistModel(currentState);
      const targetCoordinate = nextTripAssist?.targetCoordinate || null;
      const playbackRoute = getPrototypeMapRoute();
      const playbackPath = buildPlaybackPath(
        playbackRoute?.coordinates,
        currentCoordinate,
        targetCoordinate,
      );
      const playbackSpeedMetersPerSecond =
        currentStatus === "accepted"
          ? Number(prototypePlaybackConfig.pickupSpeedMetersPerSecond) || 8
          : Number(prototypePlaybackConfig.tripSpeedMetersPerSecond) || 10;
      const stepMeters = resolvePlaybackStepMeters(currentStatus, {
        tickMs:
          Number(prototypePlaybackConfig.tickMs) || DRIVER_ROUTE_PLAYBACK_TICK_MS,
        qaMultiplier: isRuntimeQALockActive()
          ? Number(prototypePlaybackConfig.qaMultiplier) || 1
          : 1,
        speedMetersPerSecond: playbackSpeedMetersPerSecond,
      });
      const nextPlaybackFrame = advanceCoordinateAlongPath({
        currentCoordinate,
        path: playbackPath,
        stepMeters,
        destinationCoordinate: targetCoordinate,
        arrivalToleranceMeters:
          currentStatus === "accepted" ? PICKUP_TOLERANCE_METERS : 18,
      });

      if (!nextPlaybackFrame?.coordinate) {
        return;
      }

      runtimeDriverRoutePlaybackActive = true;
      setRuntimeState({
        currentCoordinate: {
          ...nextPlaybackFrame.coordinate,
          speed: playbackSpeedMetersPerSecond,
        },
        driverCoordinate: {
          ...nextPlaybackFrame.coordinate,
          speed: playbackSpeedMetersPerSecond,
        },
        ...(Number.isFinite(nextPlaybackFrame.heading)
          ? { currentHeading: nextPlaybackFrame.heading }
          : {}),
      });

      pushDriverLocationNow(profile).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao publicar playback de rota do motorista:",
          error?.message || error,
        );
      });
    };

    stopDriverRoutePlayback();
    runtimeDriverRoutePlaybackActive = true;
    runPlaybackTick();
    runtimeDriverRoutePlaybackInterval = setInterval(
      runPlaybackTick,
      Number(prototypePlaybackConfig.tickMs) || DRIVER_ROUTE_PLAYBACK_TICK_MS,
    );

    return () => {
      stopDriverRoutePlayback();
    };
  }, [
    isRuntimeEffectOwner,
    profile,
    profile?.uid,
    profile?.usertype,
    profile?.userType,
    profile?.role,
    profile?.user_role,
    profile?.accountType,
    driverTripAssist?.status,
    driverTripAssist?.navigationPhase,
    driverTripAssist?.targetCoordinate?.latitude,
    driverTripAssist?.targetCoordinate?.longitude,
    prototypePlaybackConfig.pickupSpeedMetersPerSecond,
    prototypePlaybackConfig.qaMultiplier,
    prototypePlaybackConfig.tickMs,
    prototypePlaybackConfig.tripSpeedMetersPerSecond,
    snapshot.activeBookingId,
    snapshot.driverActiveRide?.bookingId,
    Number.isFinite(
      (snapshot.currentCoordinate || snapshot.driverCoordinate)?.latitude,
    ),
    Number.isFinite(
      (snapshot.currentCoordinate || snapshot.driverCoordinate)?.longitude,
    ),
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return undefined;
    }

    const role = resolveRuntimeRole(profile);
    const playbackStatus = String(liveTripProgress?.status || "")
      .trim()
      .toLowerCase();
    const playbackTargetCoordinate = liveTripProgress?.targetCoordinate || null;
    const shouldRunPlayback =
      role === "customer" &&
      ["accepted", "started"].includes(playbackStatus) &&
      Boolean(snapshot.activeBookingId || snapshot.driverActiveRide?.bookingId) &&
      Number.isFinite(snapshot.driverCoordinate?.latitude) &&
      Number.isFinite(snapshot.driverCoordinate?.longitude) &&
      Number.isFinite(playbackTargetCoordinate?.latitude) &&
      Number.isFinite(playbackTargetCoordinate?.longitude) &&
      (isRuntimeQALockActive() ||
        !snapshot.isSocketConnected ||
        Date.now() - runtimeLastDriverCoordinateUpdateAt >
          PASSENGER_ROUTE_PLAYBACK_STALE_MS);

    if (!shouldRunPlayback) {
      stopPassengerRoutePlayback();
      return undefined;
    }

    const runPlaybackTick = () => {
      const currentState = runtimeState;
      const currentStatus = String(
        currentState.driverActiveRide?.status ||
          currentState.bookingStatus ||
          "",
      )
        .trim()
        .toLowerCase();

      if (!["accepted", "started"].includes(currentStatus)) {
        stopPassengerRoutePlayback();
        return;
      }

      const nextProgress = buildLiveTripProgressModel(currentState, "customer");
      const currentDriverCoordinate = currentState.driverCoordinate || null;
      const targetCoordinate = nextProgress?.targetCoordinate || null;
      const playbackRoute = getPrototypeMapRoute();
      const playbackPath = buildPlaybackPath(
        playbackRoute?.coordinates,
        currentDriverCoordinate,
        targetCoordinate,
      );
      const playbackSpeedMetersPerSecond =
        currentStatus === "accepted"
          ? Number(prototypePlaybackConfig.pickupSpeedMetersPerSecond) || 8
          : Number(prototypePlaybackConfig.tripSpeedMetersPerSecond) || 10;
      const nextPlaybackFrame = advanceCoordinateAlongPath({
        currentCoordinate: currentDriverCoordinate,
        path: playbackPath,
        stepMeters: resolvePlaybackStepMeters(currentStatus, {
          tickMs:
            Number(prototypePlaybackConfig.tickMs) ||
            PASSENGER_ROUTE_PLAYBACK_TICK_MS,
          qaMultiplier: isRuntimeQALockActive()
            ? Number(prototypePlaybackConfig.qaMultiplier) || 1
            : 1,
          speedMetersPerSecond: playbackSpeedMetersPerSecond,
        }),
        destinationCoordinate: targetCoordinate,
        arrivalToleranceMeters:
          currentStatus === "accepted" ? PICKUP_TOLERANCE_METERS : 18,
      });

      if (!nextPlaybackFrame?.coordinate) {
        return;
      }

      runtimePassengerRoutePlaybackActive = true;
      setRuntimeState({
        driverCoordinate: {
          ...nextPlaybackFrame.coordinate,
          speed: playbackSpeedMetersPerSecond,
          ...(Number.isFinite(nextPlaybackFrame.heading)
            ? { heading: nextPlaybackFrame.heading }
            : {}),
        },
      });
    };

    stopPassengerRoutePlayback();
    runtimePassengerRoutePlaybackActive = true;
    runPlaybackTick();
    runtimePassengerRoutePlaybackInterval = setInterval(
      runPlaybackTick,
      Number(prototypePlaybackConfig.tickMs) ||
        PASSENGER_ROUTE_PLAYBACK_TICK_MS,
    );

    return () => {
      stopPassengerRoutePlayback();
    };
  }, [
    isRuntimeEffectOwner,
    profile,
    prototypePlaybackConfig.pickupSpeedMetersPerSecond,
    prototypePlaybackConfig.qaMultiplier,
    prototypePlaybackConfig.tickMs,
    prototypePlaybackConfig.tripSpeedMetersPerSecond,
    liveTripProgress?.status,
    liveTripProgress?.targetCoordinate?.latitude,
    liveTripProgress?.targetCoordinate?.longitude,
    snapshot.activeBookingId,
    snapshot.driverActiveRide?.bookingId,
    Number.isFinite(snapshot.driverCoordinate?.latitude),
    Number.isFinite(snapshot.driverCoordinate?.longitude),
    snapshot.isSocketConnected,
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return;
    }

    const role = resolveRuntimeRole(profile);
    if (role !== "driver") {
      lastDriverRoutePreviewKeyRef.current = "";
      return;
    }

    const previewOrigin =
      snapshot.currentCoordinate || snapshot.driverCoordinate || null;
    const pickupCoordinate = driverTripAssist?.pickupCoordinate || null;
    const destinationCoordinate = driverTripAssist?.destinationCoordinate || null;
    const activePhase =
      driverTripAssist?.navigationPhase === "destination"
        ? "destination"
        : "pickup";

    if (!driverTripAssist || !pickupCoordinate || !destinationCoordinate) {
      lastDriverRoutePreviewKeyRef.current = "";
      if (!driverTripAssist) {
        clearPrototypeMapRoute();
      }
      return;
    }

    const routePreviewKey = [
      snapshot.activeBookingId || snapshot.driverActiveRide?.bookingId || "",
      activePhase,
      Math.round(Number(pickupCoordinate.latitude || 0) * 10000),
      Math.round(Number(pickupCoordinate.longitude || 0) * 10000),
      Math.round(Number(destinationCoordinate.latitude || 0) * 10000),
      Math.round(Number(destinationCoordinate.longitude || 0) * 10000),
      String(driverTripAssist.pickupAddress || ""),
      String(driverTripAssist.destinationAddress || ""),
      String(snapshot.selectedDestination?.name || ""),
    ].join(":");

    const activeBookingId =
      snapshot.activeBookingId || snapshot.driverActiveRide?.bookingId || null;
    const storedRoutePlan = resolveDriverRoutePlan({
      bookingId: activeBookingId,
      driverTripMeta: snapshot.driverTripMeta,
      pickupCoordinate,
      destinationCoordinate,
    });
    if (storedRoutePlan) {
      lastDriverRoutePreviewKeyRef.current = routePreviewKey;
      applyRoutePlanToMap({
        routePlan: storedRoutePlan,
        phase: activePhase,
        pickupCoordinate,
        pickupAddress: driverTripAssist.pickupAddress,
        destinationCoordinate,
        destinationLabel: snapshot.selectedDestination?.name || "Destino",
        destinationAddress: driverTripAssist.destinationAddress,
        fallbackOrigin: previewOrigin,
      });
      return;
    }

    if (!previewOrigin) {
      lastDriverRoutePreviewKeyRef.current = "";
      return;
    }

    if (lastDriverRoutePreviewKeyRef.current === routePreviewKey) {
      return;
    }

    lastDriverRoutePreviewKeyRef.current = routePreviewKey;

    const previewPromise =
      activePhase === "pickup"
        ? buildLiveTripRoutePlan({
            origin: previewOrigin,
            pickup: pickupCoordinate,
            pickupAddress: driverTripAssist.pickupAddress,
            destination: destinationCoordinate,
            destinationLabel: snapshot.selectedDestination?.name || "Destino",
            destinationAddress: driverTripAssist.destinationAddress,
            telemetryContext: resolveRuntimeRideTelemetryContext({
              bookingId:
                snapshot.activeBookingId || snapshot.driverActiveRide?.bookingId,
              role: "driver",
              surface: "driver_live_route_prefetch",
            }),
          }).then((result) => {
            const persistedRoutePlan = ensurePersistedDriverRoutePlan({
              bookingId: activeBookingId,
              pickupCoordinate,
              destinationCoordinate,
              routePlan: result?.routePlan,
              fallbackOriginCoordinate: previewOrigin,
            });
            if (!persistedRoutePlan) {
              return;
            }

            setRuntimeState((previous) => ({
              tripDistanceKm:
                Number.isFinite(Number(result.pickupMetrics?.distanceKm)) &&
                Number(result.pickupMetrics.distanceKm) > 0
                  ? Number(result.pickupMetrics.distanceKm)
                  : previous.tripDistanceKm,
              tripDurationMin:
                Number.isFinite(Number(result.pickupMetrics?.durationMinutes)) &&
                Number(result.pickupMetrics.durationMinutes) > 0
                  ? Math.max(1, Math.round(Number(result.pickupMetrics.durationMinutes)))
                  : previous.tripDurationMin,
              tripArrivalText:
                result.pickupMetrics?.etaText || previous.tripArrivalText,
              driverTripMeta: {
                ...(previous.driverTripMeta || {}),
                pickupAddress:
                  driverTripAssist.pickupAddress ||
                  previous.driverTripMeta?.pickupAddress ||
                  "Local de embarque",
                destinationAddress:
                  driverTripAssist.destinationAddress ||
                  previous.driverTripMeta?.destinationAddress ||
                  "Destino",
                pickupCoordinate,
                destinationCoordinate,
                initialMeters:
                  Number.isFinite(Number(result.pickupMetrics?.distanceKm)) &&
                  Number(result.pickupMetrics.distanceKm) > 0
                    ? Math.round(Number(result.pickupMetrics.distanceKm) * 1000)
                    : previous.driverTripMeta?.initialMeters,
                initialEtaMinutes:
                  Number.isFinite(Number(result.pickupMetrics?.durationMinutes)) &&
                  Number(result.pickupMetrics.durationMinutes) > 0
                    ? Math.max(
                        1,
                        Math.round(Number(result.pickupMetrics.durationMinutes)),
                      )
                    : previous.driverTripMeta?.initialEtaMinutes,
                routePlan: persistedRoutePlan,
              },
            }));
          })
        : buildLiveTripRoutePlan({
            origin: previewOrigin,
            pickup: pickupCoordinate,
            pickupAddress: driverTripAssist.pickupAddress,
            destination: destinationCoordinate,
            destinationLabel: snapshot.selectedDestination?.name || "Destino",
            destinationAddress: driverTripAssist.destinationAddress,
            telemetryContext: resolveRuntimeRideTelemetryContext({
              bookingId: activeBookingId,
              role: "driver",
              surface: "driver_live_route_prefetch",
            }),
          }).then((result) => {
            const persistedRoutePlan = ensurePersistedDriverRoutePlan({
              bookingId: activeBookingId,
              pickupCoordinate,
              destinationCoordinate,
              routePlan: result?.routePlan,
              fallbackOriginCoordinate: previewOrigin,
            });
            if (!persistedRoutePlan) {
              return;
            }

            applyRoutePlanToMap({
              routePlan: persistedRoutePlan,
              phase: "destination",
              pickupCoordinate,
              pickupAddress: driverTripAssist.pickupAddress,
              destinationCoordinate,
              destinationLabel: snapshot.selectedDestination?.name || "Destino",
              destinationAddress: driverTripAssist.destinationAddress,
              fallbackOrigin: previewOrigin,
            });

            setRuntimeState((previous) => ({
              tripDistanceKm:
                Number.isFinite(Number(result?.destinationMetrics?.distanceKm)) &&
                Number(result.destinationMetrics.distanceKm) > 0
                  ? Number(result.destinationMetrics.distanceKm)
                  : previous.tripDistanceKm,
              tripDurationMin:
                Number.isFinite(
                  Number(result?.destinationMetrics?.durationMinutes),
                ) && Number(result.destinationMetrics.durationMinutes) > 0
                  ? Math.max(
                      1,
                      Math.round(Number(result.destinationMetrics.durationMinutes)),
                    )
                  : previous.tripDurationMin,
              tripArrivalText:
                result?.destinationMetrics?.etaText || previous.tripArrivalText,
              driverTripMeta: {
                ...(previous.driverTripMeta || {}),
                pickupAddress:
                  driverTripAssist.pickupAddress ||
                  previous.driverTripMeta?.pickupAddress ||
                  "Local de embarque",
                destinationAddress:
                  driverTripAssist.destinationAddress ||
                  previous.driverTripMeta?.destinationAddress ||
                  "Destino",
                pickupCoordinate,
                destinationCoordinate,
                routePlan: persistedRoutePlan,
              },
            }));
          });

    previewPromise.catch((error) => {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao sincronizar rota ativa do motorista:",
        error?.message || error,
      );
      setPrototypeMapRoute({
        origin: previewOrigin,
        destination: activePhase === "pickup" ? pickupCoordinate : destinationCoordinate,
        destinationLabel:
          activePhase === "pickup"
            ? "Embarque"
            : snapshot.selectedDestination?.name || "Destino",
        destinationAddress:
          activePhase === "pickup"
            ? driverTripAssist.pickupAddress
            : driverTripAssist.destinationAddress,
      });
    });
  }, [
    isRuntimeEffectOwner,
    driverTripAssist?.navigationPhase,
    driverTripAssist?.pickupCoordinate?.latitude,
    driverTripAssist?.pickupCoordinate?.longitude,
    driverTripAssist?.destinationCoordinate?.latitude,
    driverTripAssist?.destinationCoordinate?.longitude,
    driverTripAssist?.pickupAddress,
    driverTripAssist?.destinationAddress,
    profile?.uid,
    profile?.usertype,
    profile?.userType,
    profile?.role,
    profile?.user_role,
    profile?.accountType,
    Number.isFinite(snapshot.currentCoordinate?.latitude),
    Number.isFinite(snapshot.currentCoordinate?.longitude),
    Number.isFinite(snapshot.driverCoordinate?.latitude),
    Number.isFinite(snapshot.driverCoordinate?.longitude),
    snapshot.activeBookingId,
    snapshot.driverActiveRide?.bookingId,
    snapshot.driverTripMeta?.routePlan?.pickupCoordinates?.length,
    snapshot.driverTripMeta?.routePlan?.destinationCoordinates?.length,
    snapshot.selectedDestination?.name,
  ]);

  useEffect(() => {
    if (!isRuntimeEffectOwner) {
      return;
    }

    const role = resolveRuntimeRole(profile);
    if (role !== "customer") {
      lastPassengerRoutePreviewKeyRef.current = "";
      return;
    }

    const normalizedStatus = String(snapshot.bookingStatus || "")
      .trim()
      .toLowerCase();
    const isPassengerTripActive = ["accepted", "arrived", "started"].includes(
      normalizedStatus,
    );

    if (!isPassengerTripActive) {
      lastPassengerRoutePreviewKeyRef.current = "";
      return;
    }

    const pickupCoordinate = resolvePickupCoordinateFromRide(
      snapshot.driverActiveRide,
      snapshot.activeBooking,
    );
    const destinationCoordinate = resolveDestinationCoordinateFromRide(
      snapshot.driverActiveRide,
      snapshot.selectedDestination,
      snapshot.activeBooking,
    );
    const liveDriverCoordinate =
      snapshot.driverCoordinate &&
      Number.isFinite(snapshot.driverCoordinate.latitude) &&
      Number.isFinite(snapshot.driverCoordinate.longitude)
        ? snapshot.driverCoordinate
        : null;

    const liveDestinationCoordinate =
      normalizedStatus === "started" ? destinationCoordinate : pickupCoordinate;
    if (!liveDriverCoordinate || !liveDestinationCoordinate) {
      lastPassengerRoutePreviewKeyRef.current = "";
      return;
    }

    const passengerRoutePreviewKey = [
      normalizedStatus,
      snapshot.activeBookingId || snapshot.driverActiveRide?.bookingId || "",
      Math.round(Number(pickupCoordinate?.latitude || 0) * 10000),
      Math.round(Number(pickupCoordinate?.longitude || 0) * 10000),
      Math.round(Number(destinationCoordinate?.latitude || 0) * 10000),
      Math.round(Number(destinationCoordinate?.longitude || 0) * 10000),
      String(snapshot.selectedDestination?.name || ""),
      String(snapshot.selectedDestination?.address || ""),
      String(snapshot.driverActiveRide?.pickupAddress || ""),
      String(snapshot.driverActiveRide?.dropoffAddress || ""),
    ].join(":");

    const activePhase = normalizedStatus === "started" ? "destination" : "pickup";
    const activeBookingId =
      snapshot.activeBookingId || snapshot.driverActiveRide?.bookingId || null;
    const storedRoutePlan = resolveDriverRoutePlan({
      bookingId: activeBookingId,
      driverTripMeta: snapshot.driverTripMeta,
      pickupCoordinate,
      destinationCoordinate,
    });
    if (storedRoutePlan) {
      lastPassengerRoutePreviewKeyRef.current = passengerRoutePreviewKey;
      applyRoutePlanToMap({
        routePlan: storedRoutePlan,
        phase: activePhase,
        pickupCoordinate,
        pickupAddress:
          snapshot.driverActiveRide?.pickupAddress ||
          snapshot.activeBooking?.pickupLocation?.add ||
          "Local de embarque",
        destinationCoordinate,
        destinationLabel:
          snapshot.selectedDestination?.name ||
          snapshot.driverActiveRide?.dropoff ||
          "Destino",
        destinationAddress:
          snapshot.driverActiveRide?.dropoffAddress ||
          snapshot.selectedDestination?.address ||
          snapshot.selectedDestination?.name ||
          "Destino",
        fallbackOrigin: liveDriverCoordinate,
      });
      return;
    }

    if (lastPassengerRoutePreviewKeyRef.current === passengerRoutePreviewKey) {
      return;
    }

    lastPassengerRoutePreviewKeyRef.current = passengerRoutePreviewKey;

    try {
      const persistedRoutePlan = ensurePersistedDriverRoutePlan({
        bookingId: activeBookingId,
        pickupCoordinate,
        destinationCoordinate,
        routePlan: snapshot.driverTripMeta?.routePlan,
        fallbackOriginCoordinate: liveDriverCoordinate,
      });
      if (persistedRoutePlan) {
        syncPassengerActiveRoutePlan({
          routePlan: persistedRoutePlan,
          phase: activePhase,
          pickupCoordinate,
          pickupAddress:
            snapshot.driverActiveRide?.pickupAddress ||
            snapshot.activeBooking?.pickupLocation?.add ||
            "Local de embarque",
          destinationCoordinate,
          destinationLabel:
            snapshot.selectedDestination?.name ||
            snapshot.driverActiveRide?.dropoff ||
            "Destino",
          destinationAddress:
            snapshot.driverActiveRide?.dropoffAddress ||
            snapshot.selectedDestination?.address ||
            snapshot.selectedDestination?.name ||
            "Destino",
          liveDriverCoordinate,
        });
        return;
      }
    } catch (error) {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao sincronizar rota ativa local do passageiro:",
        error?.message || error,
      );
    }

    setPrototypeMapRoute({
      origin: liveDriverCoordinate,
      destination: liveDestinationCoordinate,
      destinationLabel:
        normalizedStatus === "started"
          ? snapshot.selectedDestination?.name ||
            snapshot.driverActiveRide?.dropoff ||
            "Destino"
          : "Embarque",
      destinationAddress:
        normalizedStatus === "started"
          ? snapshot.driverActiveRide?.dropoffAddress ||
            snapshot.selectedDestination?.address ||
            snapshot.selectedDestination?.name ||
            "Destino"
          : snapshot.driverActiveRide?.pickupAddress ||
            snapshot.activeBooking?.pickupLocation?.add ||
            "Local de embarque",
    });
  }, [
    isRuntimeEffectOwner,
    profile,
    snapshot.bookingStatus,
    snapshot.activeBooking?.pickupLocation?.add,
    snapshot.activeBooking?.pickupLocation?.lat,
    snapshot.activeBooking?.pickupLocation?.lng,
    snapshot.activeBookingId,
    snapshot.activeBooking?.destinationLocation?.lat,
    snapshot.activeBooking?.destinationLocation?.lng,
    snapshot.driverActiveRide?.bookingId,
    snapshot.driverActiveRide?.dropoff,
    snapshot.driverActiveRide?.dropoffAddress,
    snapshot.driverActiveRide?.destinationCoordinate?.latitude,
    snapshot.driverActiveRide?.destinationCoordinate?.longitude,
    snapshot.driverActiveRide?.pickupAddress,
    snapshot.driverActiveRide?.pickupCoordinate?.latitude,
    snapshot.driverActiveRide?.pickupCoordinate?.longitude,
    snapshot.driverTripMeta?.routePlan?.pickupCoordinates?.length,
    snapshot.driverTripMeta?.routePlan?.destinationCoordinates?.length,
    Number.isFinite(snapshot.driverCoordinate?.latitude),
    Number.isFinite(snapshot.driverCoordinate?.longitude),
    snapshot.selectedDestination?.address,
    snapshot.selectedDestination?.name,
  ]);

  const loadDestinationSuggestions = useCallback(async (query, options = {}) => {
    const results = await findDestinations(query, options);
    return results.map((item) => normalizeDestinationItem(item));
  }, []);

  const loadRecentDestinations = useCallback(async () => {
    const results = await findDestinations("");
    return results.map((item) => normalizeDestinationItem(item));
  }, []);

  const resolveDestinationInput = useCallback(async (destination) => {
    const normalized = normalizeDestinationItem(destination || {});
    return resolveDestinationCoordinate(normalized);
  }, []);

  const selectDestination = useCallback(async (destination) => {
    const normalized = normalizeDestinationItem(destination || {});
    const resolved = await resolveDestinationCoordinate(normalized);
    rotateRuntimeRideTelemetryDraftContext({
      surface: "destination_preview",
    });
    setRuntimeState({
      selectedDestination: resolved,
      lastError: "",
    });
    resetRuntimeDestinationSearchSession("destination_selected");
    return resolved;
  }, []);

  const requestRide = useCallback(
    async (payload) => {
      try {
        const result = await requestPrototypeRide(profile, payload);
        return result;
      } catch (error) {
        stopSearchingTimer();
        stopBoardingCountdownTimer();
        setRuntimeState({
          bookingStatus: "idle",
          searchingElapsedSeconds: 0,
          paymentState: {
            status: "failed",
            paymentId: null,
            amount: Number(payload?.fare ?? runtimeState.selectedFare ?? 0),
            method:
              payload?.paymentMethod || runtimeState.paymentMethod || "pix",
            error: error?.message || "Não foi possível confirmar o pagamento.",
            refundStatus: null,
            refundAmount: 0,
            cancellationFee: 0,
            refundId: null,
            chargeId: null,
          },
          lastError: error?.message || "Não foi possível solicitar a corrida.",
        });
        throw error;
      }
    },
    [profile],
  );

  const checkRideAvailability = useCallback(
    async (payload) => {
      return checkPrototypeRideAvailability(profile, payload);
    },
    [profile],
  );

  const cancelRideSearch = useCallback(async () => {
    await cancelPrototypeRide();
  }, []);

  const cancelActiveRideFlow = useCallback(async ({ reason } = {}) => {
    await cancelPrototypeRide({
      reason: reason || "Cancelado pelo motorista.",
      suppressReason: "driver_cancel_request",
    });
  }, []);

  const requestTripExtension = useCallback(
    async ({ destination, newFare } = {}) => {
      if (resolveRuntimeRole(profile) !== "customer") {
        throw new Error(
          "Somente o passageiro pode solicitar alteração de destino.",
        );
      }

      const normalizedStatus = normalizeRuntimeLifecycleStatus(
        runtimeState.bookingStatus,
      );
      if (normalizedStatus !== "started") {
        throw new Error(
          "A alteração de destino só fica disponível com a corrida em andamento.",
        );
      }

      const bookingId = getRuntimeBookingId();
      if (!bookingId) {
        throw new Error("Nenhuma corrida ativa para alterar o destino.");
      }

      const destinationInput = normalizeDestinationItem(
        destination || runtimeState.selectedDestination || {},
      );
      const resolvedDestination =
        await resolveDestinationCoordinate(destinationInput);
      if (!resolvedDestination?.coordinate) {
        throw new Error("Não foi possível carregar esse novo destino agora.");
      }

      const socket = await getRealtimeSocket(
        profile,
        "Serviço indisponível para alterar destino.",
      );
      const contractualFare = Number(
        runtimeState.selectedFare ||
          runtimeState.activeBooking?.estimatedFare ||
          0,
      );
      const destinationDecision = await socket.changeDestination(bookingId, {
        lat: resolvedDestination.coordinate.latitude,
        lng: resolvedDestination.coordinate.longitude,
        add:
          resolvedDestination.address ||
          resolvedDestination.name ||
          "Destino",
      });
      const backendSuggestedFare = Number(destinationDecision?.newFare);
      const fallbackRequestedFare = Number(newFare);
      const normalizedNewFare =
        Number.isFinite(backendSuggestedFare) && backendSuggestedFare > 0
          ? backendSuggestedFare
          : fallbackRequestedFare;
      const requiresExtensionApproval =
        destinationDecision?.requiresPayment === true ||
        destinationDecision?.requiresDriverApproval === true ||
        Number(destinationDecision?.fareDifference || 0) > 0;

      if (!requiresExtensionApproval) {
        setRuntimeState((previous) => ({
          selectedDestination: resolvedDestination,
          selectedFare:
            Number.isFinite(backendSuggestedFare) && backendSuggestedFare > 0
              ? backendSuggestedFare
              : previous.selectedFare,
          activeBooking:
            previous.activeBooking && typeof previous.activeBooking === "object"
              ? {
                  ...previous.activeBooking,
                  destinationLocation: {
                    lat: resolvedDestination.coordinate.latitude,
                    lng: resolvedDestination.coordinate.longitude,
                    add:
                      resolvedDestination.address ||
                      resolvedDestination.name ||
                      "Destino",
                  },
                  ...(Number.isFinite(backendSuggestedFare) &&
                  backendSuggestedFare > 0
                    ? { estimatedFare: backendSuggestedFare }
                    : {}),
                }
              : previous.activeBooking,
          rideExtension: cloneDefaultRideExtensionState({
            status: "confirmed",
            bookingId,
            destination: resolvedDestination,
            currentFare: contractualFare,
            newFare:
              Number.isFinite(backendSuggestedFare) && backendSuggestedFare > 0
                ? backendSuggestedFare
                : contractualFare,
            diffFare: Number(destinationDecision?.fareDifference || 0) || 0,
            message:
              destinationDecision?.message || "Destino alterado com sucesso.",
          }),
          lastError: "",
        }));

        await previewDestinationOnMap(resolvedDestination);
        return {
          success: true,
          directChange: true,
          destination: resolvedDestination,
          response: destinationDecision,
        };
      }

      if (!Number.isFinite(normalizedNewFare) || normalizedNewFare <= 0) {
        throw new Error(
          "Não foi possível calcular o complemento desse novo destino.",
        );
      }

      const response = await socket.requestRideExtension(
        bookingId,
        {
          lat: resolvedDestination.coordinate.latitude,
          lng: resolvedDestination.coordinate.longitude,
          add:
            resolvedDestination.address ||
            resolvedDestination.name ||
            "Destino",
        },
        normalizedNewFare,
      );

      setRuntimeState({
        rideExtension: buildRideExtensionState(response, {
          bookingId,
          status: "driver_decision_pending",
          destination: resolvedDestination,
          currentFare: contractualFare,
          newFare: normalizedNewFare,
          diffFare:
            Number.isFinite(Number(response?.diffFare)) &&
            Number(response.diffFare) > 0
              ? Number(response.diffFare)
              : Math.max(
                  0,
                  Number((normalizedNewFare - contractualFare).toFixed(2)),
                ),
          error: "",
          message:
            response?.message ||
            "Solicitação enviada. O motorista vai responder pelo app.",
        }),
        lastError: "",
      });

      return {
        success: true,
        pendingDriverDecision: true,
        destination: resolvedDestination,
        response,
      };
    },
    [profile],
  );

  const endTripEarlyFlow = useCallback(
    async (reason = "EARLY_DROPOFF_BY_RIDER") => {
      if (resolveRuntimeRole(profile) !== "customer") {
        throw new Error("Somente o passageiro pode encerrar a corrida agora.");
      }

      const normalizedStatus = normalizeRuntimeLifecycleStatus(
        runtimeState.bookingStatus,
      );
      if (normalizedStatus !== "started") {
        throw new Error(
          "A corrida precisa estar em andamento para ser encerrada agora.",
        );
      }

      const bookingId = getRuntimeBookingId();
      if (!bookingId) {
        throw new Error("Nenhuma corrida ativa para encerrar.");
      }

      const socket = await getRealtimeSocket(
        profile,
        "Serviço indisponível para encerrar a corrida.",
      );
      try {
        await pushPassengerLocationNow(profile, socket);
      } catch (_error) {
        // best-effort
      }

      const location = getPassengerLocationPayload();
      if (!location) {
        throw new Error(
          "Não foi possível determinar sua localização atual para encerrar a corrida.",
        );
      }

      const executedMetrics = await estimatePassengerEarlyEndMetrics();
      return socket.endTripEarlyByRider(
        bookingId,
        {
          lat: location.lat,
          lng: location.lng,
          add: runtimeState.currentAddress || "Parada atual",
        },
        executedMetrics.distanceKm,
        executedMetrics.durationSecs,
        reason,
      );
    },
    [profile],
  );

  const startTripFlow = useCallback(async (options = {}) => {
    return startPrototypeTrip(options);
  }, []);

  const markDriverArrived = useCallback(async (options = {}) => {
    return arrivePrototypePickup(profile, options);
  }, [profile]);

  const confirmBoardingStatus = useCallback(
    async (boarded) => {
      return confirmPrototypeBoardingStatus(profile, boarded);
    },
    [profile],
  );

  const completeTripFlow = useCallback(async (options = {}) => {
    return completePrototypeTrip(options);
  }, []);

  const clearFlowPreview = useCallback(() => {
    clearDestinationPreview();
  }, []);

  const updateSettings = useCallback((patch) => {
    updatePrototypeSettings(patch);
  }, []);

  const updateRiderProfile = useCallback((patch) => {
    updatePrototypeRiderProfile(patch);
  }, []);

  const loadChatSession = useCallback(
    async ({ forceReload = false } = {}) => {
      return loadPrototypeChatSession(profile, forceReload);
    },
    [profile],
  );

  const sendChatMessage = useCallback(
    async (text) => {
      return sendPrototypeChatMessage(profile, text);
    },
    [profile],
  );

  const openSupportTicket = useCallback(
    async (payload) => {
      return createPrototypeSupportTicket(profile, payload);
    },
    [profile],
  );

  const reportIncident = useCallback(
    async (payload) => {
      return reportPrototypeIncident(profile, payload);
    },
    [profile],
  );

  const setDriverOnline = useCallback(
    async (isOnline) => {
      return setPrototypeDriverOnline(profile, isOnline);
    },
    [profile],
  );

  const setDriverDestinationMode = useCallback(
    async (input) => {
      return setPrototypeDriverDestinationMode(profile, input);
    },
    [profile],
  );

  const acceptDriverOffer = useCallback(
    async (offer) => {
      return acceptPrototypeDriverOffer(profile, offer);
    },
    [profile],
  );

  const rejectDriverOffer = useCallback(
    async (offer, reason) => {
      return rejectPrototypeDriverOffer(profile, offer, reason);
    },
    [profile],
  );

  const respondToDriverExtension = useCallback(
    async (accepted) => {
      if (resolveRuntimeRole(profile) !== "driver") {
        throw new Error(
          "Somente o motorista pode responder a alteração de destino.",
        );
      }

      const bookingId =
        runtimeState.driverExtensionRequest?.bookingId ||
        runtimeState.activeBookingId ||
        runtimeState.driverActiveRide?.bookingId ||
        null;
      if (!bookingId) {
        throw new Error(
          "Nenhuma alteração de destino pendente para responder.",
        );
      }

      const socket = await getRealtimeSocket(
        profile,
        "Serviço indisponível para responder a alteração.",
      );
      // Prototype extension approvals should follow the same mocked-payment
      // contract used by the rest of the iOS simulator lifecycle validation.
      const shouldMockExtensionPayment =
        accepted === true || allowForcedPaymentBypass();
      const response = await socket.respondRideExtension(bookingId, accepted, {
        mockPayment: shouldMockExtensionPayment,
        __mockPayment: shouldMockExtensionPayment,
      });

      if (!accepted) {
        setRuntimeState({
          driverExtensionRequest: cloneDefaultDriverExtensionRequest({
            status: "rejected",
            bookingId,
            message: "Alteração recusada pelo motorista.",
          }),
          lastError: "",
        });
      } else {
        setRuntimeState((previous) => ({
          driverExtensionRequest: buildDriverExtensionRequest(response, {
            status: "pending_payment",
            bookingId,
            destination:
              previous.driverExtensionRequest?.destination ||
              buildDriverExtensionRequest(response).destination,
            message:
              response?.message ||
              "Pagamento do complemento pendente.",
          }),
          lastError: "",
        }));
      }

      return response;
    },
    [profile],
  );

  const interruptRideOperationalFlow = useCallback(
    async ({ reason = "VEHICLE_BREAKDOWN", note = "" } = {}) => {
      if (resolveRuntimeRole(profile) !== "driver") {
        throw new Error(
          "Somente o motorista pode interromper a corrida por motivo operacional.",
        );
      }

      const normalizedStatus = normalizeRuntimeLifecycleStatus(
        runtimeState.bookingStatus,
      );
      if (normalizedStatus !== "started") {
        throw new Error(
          "A interrupção operacional só pode ser usada com a corrida em andamento.",
        );
      }

      const bookingId = getRuntimeBookingId();
      if (!bookingId) {
        throw new Error("Nenhuma corrida ativa para interromper.");
      }

      const socket = await getRealtimeSocket(
        profile,
        "Serviço indisponível para interromper a corrida.",
      );
      try {
        await pushDriverLocationNow(profile, socket);
      } catch (_error) {
        // best-effort
      }

      const location = getDriverLocationPayload();
      if (!location) {
        throw new Error(
          "Não foi possível determinar a localização atual do motorista.",
        );
      }

      const executedMetrics = await estimatePassengerEarlyEndMetrics();
      return socket.interruptRideOperational(
        bookingId,
        {
          lat: location.lat,
          lng: location.lng,
          add:
            runtimeState.currentAddress ||
            runtimeState.driverTripMeta?.pickupAddress ||
            "Parada atual",
        },
        executedMetrics.distanceKm,
        executedMetrics.durationSecs,
        reason,
        note,
      );
    },
    [profile],
  );

  const respondOperationalContinuationFlow = useCallback(
    async (continueTrip) => {
      if (resolveRuntimeRole(profile) !== "customer") {
        throw new Error(
          "Somente o passageiro pode decidir sobre a continuidade da corrida.",
        );
      }

      const bookingId =
        runtimeState.operationalContinuation?.bookingId ||
        runtimeState.activeBookingId ||
        getRuntimeBookingId();
      if (!bookingId) {
        throw new Error(
          "Nenhuma continuidade operacional pendente para responder.",
        );
      }

      const socket = await getRealtimeSocket(
        profile,
        "Serviço indisponível para responder a continuidade.",
      );
      return socket.respondOperationalContinuation(bookingId, continueTrip);
    },
    [profile],
  );

  const updateDriverActivationChecklistState = useCallback(
    async (stageKey, fieldKey, value) => {
      return updatePrototypeDriverActivation(profile, (current) =>
        updateDriverOnboardingChecklist(current, stageKey, fieldKey, value),
      );
    },
    [profile],
  );

  const completeDriverActivationStageState = useCallback(
    async (stageKey) => {
      return updatePrototypeDriverActivation(profile, (current) =>
        completeDriverOnboardingStage(current, stageKey),
      );
    },
    [profile],
  );

  const refreshDriverActivationRemote = useCallback(async () => {
    return refreshPrototypeDriverActivation(profile);
  }, [profile]);

  const submitDriverActivationDocument = useCallback(
    async (fieldKey, pdfAsset) => {
      return submitPrototypeDriverDocument(profile, fieldKey, pdfAsset);
    },
    [profile],
  );

  const submitDriverBackgroundCheckConsent = useCallback(
    async (accepted) => {
      return submitPrototypeBackgroundCheckConsent(profile, accepted);
    },
    [profile],
  );

  const markNotificationRead = useCallback((notificationId) => {
    markNotificationReadInState(notificationId);
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    markAllNotificationsReadInState();
  }, []);

  const markTripRating = useCallback((tripId, patch) => {
    markTripHistoryRating(tripId, patch);
  }, []);

  const dismissCompletedReceipt = useCallback(() => {
    dismissCompletedReceiptState();
  }, []);

  const recoverCompletedReceipt = useCallback(async (options = {}) => {
    return recoverCompletedRideFromStoredReceipt({
      ...options,
      reason: options?.reason || "manual_receipt_recovery",
    });
  }, []);

  const submitCompletedReceiptRatingFlow = useCallback(async (options = {}) => {
    return submitCompletedReceiptRating(options);
  }, []);

  return {
    ...snapshot,
    driverTripAssist,
    notifications: scopedNotifications,
    unreadNotificationCount,
    profile,
    loadDestinationSuggestions,
    loadRecentDestinations,
    resolveDestinationInput,
    selectDestination,
    checkRideAvailability,
    requestRide,
    requestTripExtension,
    cancelRideSearch,
    cancelActiveRideFlow,
    endTripEarlyFlow,
    markDriverArrived,
    confirmBoardingStatus,
    startTripFlow,
    completeTripFlow,
    clearFlowPreview,
    updateSettings,
    updateRiderProfile,
    loadChatSession,
    sendChatMessage,
    openSupportTicket,
    reportIncident,
    setDriverOnline,
    setDriverDestinationMode,
    acceptDriverOffer,
    rejectDriverOffer,
    respondToDriverExtension,
    interruptRideOperationalFlow,
    respondOperationalContinuationFlow,
    updateDriverActivationChecklist: updateDriverActivationChecklistState,
    completeDriverActivationStage: completeDriverActivationStageState,
    refreshDriverActivationRemote,
    submitDriverActivationDocument,
    submitDriverBackgroundCheckConsent,
    markTripRating,
    dismissCompletedReceipt,
    recoverCompletedReceipt,
    submitCompletedReceiptRating: submitCompletedReceiptRatingFlow,
    markNotificationRead,
    markAllNotificationsRead,
  };
}
