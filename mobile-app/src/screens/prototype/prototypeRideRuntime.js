import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import * as Device from "expo-device";
import * as Location from "expo-location";
import { AppState, Platform } from "react-native";
import polyline from "@mapbox/polyline";
import auth from "@react-native-firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Logger from "../../utils/Logger";
import WebSocketManager from "../../services/WebSocketManager";
import interactiveNotificationService from "../../services/InteractiveNotificationService";
import prototypeDriverTripAssistantService, {
  calculateDistanceMeters,
  PICKUP_TOLERANCE_METERS,
} from "../../services/PrototypeDriverTripAssistantService";
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
} from "./runtimeCrashRecovery";
import { resolveMeaningfulAddress } from "./addressLabelUtils";
import {
  getDriverOfferNetAmount,
  mergeDriverOfferEntry as mergeDriverOfferEntryWithLockedPricing,
  mergeDriverOffers as mergeDriverOffersWithLockedPricing,
} from "./driverOfferPricingSnapshot";
import { dismissDriverOfferRuntimeState } from "./driverOfferState";
import { formatCurrencyBRL } from "./tripFinancialSummary";
import { SEARCH_TOTAL_DURATION_SECONDS } from "./searchPresentation";
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
import { getApiURL } from "../../config/NetworkConfig";
import { getPrototypePlaybackConfigSnapshot } from "../../config/prototypePlaybackConfig";
import {
  allowCustomOtpFallback,
  allowForcedPaymentBypass,
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
const PASSENGER_LOCATION_HEARTBEAT_MS = 2000;
const RUNTIME_ACTIVE_RIDE_RESYNC_INTERVAL_MS = 6000;
const DRIVER_ROUTE_PLAYBACK_TICK_MS = 2500;
const PASSENGER_ROUTE_PLAYBACK_TICK_MS = 2500;
const PASSENGER_ROUTE_PLAYBACK_STALE_MS = 4500;
const DRIVER_TRANSIENT_CARD_DURATION_MS = 3600;
const DRIVER_COMPETITIVE_TRANSIENT_CARD_DURATION_MS = 8000;
const SUPPRESSED_BOOKING_EVENT_WINDOW_MS = 15000;
const DRIVER_STATUS_RETRY_ATTEMPTS = 2;
const DRIVER_ACTIVATION_REMOTE_SYNC_INTERVAL_MS = 12000;
const DRIVER_ACTIVATION_SYNC_MIN_GAP_MS = 6000;
const SESSION_RESTORE_OTP_CODE = "000000";
const SESSION_RESTORE_REQUEST_ENDPOINTS = Object.freeze([
  "/api/custom-otp/request-otp",
  "/custom-otp/request-otp",
]);
const SESSION_RESTORE_VERIFY_ENDPOINTS = Object.freeze([
  "/api/custom-otp/verify-otp",
  "/custom-otp/verify-otp",
]);
const RUNTIME_DEBUG_KEY = "@prototype_runtime_debug_last_socket_bootstrap";
const RUNTIME_DEBUG_HISTORY_KEY = "@prototype_runtime_debug_history";
const DRIVER_OFFER_IDLE_SYNC_GRACE_MS = 12000;
const SHOULD_BYPASS_BOOT_LOCATION_PROMPT =
  Platform.OS === "ios" && Device.isDevice === false;
const RUNTIME_PERSISTED_FIELDS = Object.freeze([
  "activeRole",
  "isSocketConnected",
  "isSocketAuthenticated",
  "bookingStatus",
  "activeBookingId",
  "activeBooking",
  "searchingElapsedSeconds",
  "selectedDestination",
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
  "driverTransientCard",
  "driverLastTransientCard",
  "driverOffers",
  "driverActiveRide",
  "activeChatId",
  "activeChatBookingId",
  "chatMessages",
  "tripHistory",
  "lastReceipt",
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
  mei: "mei",
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

const DEFAULT_RUNTIME_STATE = Object.freeze({
  ready: false,
  initializing: false,
  connecting: false,
  isSocketConnected: false,
  isSocketAuthenticated: false,
  activeRole: "customer",
  socketError: "",
  currentCoordinate: {
    latitude: PROTOTYPE_ORIGIN_COORDINATE.latitude,
    longitude: PROTOTYPE_ORIGIN_COORDINATE.longitude,
  },
  currentHeading: 0,
  notifications: DEFAULT_RUNTIME_NOTIFICATIONS,
  currentAddress: "",
  bookingStatus: "idle",
  searchingElapsedSeconds: 0,
  activeBookingId: null,
  activeBooking: null,
  selectedDestination: null,
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
  driverTripMeta: {
    leg: null,
    initialMeters: null,
    initialEtaMinutes: null,
    pickupAddress: "",
    destinationAddress: "",
    pickupCoordinate: null,
    destinationCoordinate: null,
    fare: 0,
    fareLabel: "",
  },
  driverOnline: false,
  driverOnlinePending: false,
  driverOnlineMutationSource: "",
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
    name: "Ana Dias",
    phone: "+55 11 9 9999-9999",
    email: "ana.dias@email.com",
    preference: "Corridas silenciosas",
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
});

let runtimeState = { ...DEFAULT_RUNTIME_STATE };
const runtimeListeners = new Set();
let runtimeBootstrapPromise = null;
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
let runtimeSuppressedBookingIds = new Map();

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

  const canAttemptRestore =
    allowCustomOtpFallback() &&
    profile?.isTestUser !== true &&
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
      otp: SESSION_RESTORE_OTP_CODE,
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

function shouldSuppressRuntimeStorageWrites() {
  return isRuntimeQALockActive();
}

function shouldPreserveQALockedRideOnIdleSync() {
  if (!isRuntimeQALockActive()) {
    return false;
  }

  const normalizedLocalBookingStatus = String(runtimeState.bookingStatus || "")
    .trim()
    .toLowerCase();
  const hasLocalRideContext = Boolean(
    runtimeState.activeBookingId ||
      runtimeState.activeBooking?.bookingId ||
      runtimeState.activeBooking?.id ||
      runtimeState.driverActiveRide?.bookingId ||
      runtimeState.driverActiveRide?.id,
  );

  return (
    hasLocalRideContext &&
    ["accepted", "arrived", "started"].includes(normalizedLocalBookingStatus)
  );
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
  const hasPersistedDriverActiveRide = Boolean(
    restored.driverActiveRide?.bookingId || restored.driverActiveRide?.id,
  );
  const hasPersistedDriverOffer = Array.isArray(restored.driverOffers)
    ? restored.driverOffers.some((item) => Boolean(item?.bookingId || item?.id))
    : false;

  restored.isSocketConnected = false;
  restored.isSocketAuthenticated = false;

  if (role === "driver") {
    const restoredDriverOnline = Boolean(restored.driverOnline);
    const restoredDriverOnlinePending = Boolean(restored.driverOnlinePending);

    if (restored.driverOnline) {
      restored.driverOnline = false;
      restored.driverOnlinePending = true;
      restored.driverOnlineMutationSource =
        "bootstrap_restore_online_intent";
    }

    if (restoredDriverOnlinePending && !restoredDriverOnline) {
      restored.driverOnline = false;
      restored.driverOnlinePending = false;
      restored.driverOnlineMutationSource =
        "bootstrap_clear_stale_online_pending";
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

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return;
        }

        const nextCoordinate = { latitude, longitude };
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

function setRuntimeState(next) {
  const previousState = runtimeState;
  const rawPatch = typeof next === "function" ? next(runtimeState) : next;
  const patch = rawPatch;
  if (!patch || typeof patch !== "object") {
    return;
  }
  if (
    patch.driverCoordinate &&
    Number.isFinite(patch.driverCoordinate.latitude) &&
    Number.isFinite(patch.driverCoordinate.longitude)
  ) {
    runtimeLastDriverCoordinateUpdateAt = Date.now();
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

function formatCurrencyBR(value) {
  return formatCurrencyBRL(value);
}

function sanitizeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function toFiniteRuntimeMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundCurrencyValue(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Number(parsed.toFixed(2));
}

function buildDriverOffer({
  bookingId,
  destination,
  fare,
  etaMinutes,
  pickupAddress,
  pickupCoordinate,
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

  const remainingMeters = calculateDistanceMeters(
    movingCoordinate,
    targetCoordinate,
  );
  if (!Number.isFinite(remainingMeters) || remainingMeters < 0) {
    return null;
  }

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
  const etaMinutes = computeDynamicEtaMinutes(
    remainingMeters,
    baselineMeters,
    baselineEtaMinutes,
  );
  const distanceKm = normalizeRemainingDistanceKm(remainingMeters);

  return {
    status: normalizedStatus,
    targetCoordinate,
    movingCoordinate,
    remainingMeters,
    distanceKm,
    etaMinutes,
    arrivalText:
      etaMinutes > 0 ? `Chegada estimada em ${etaMinutes} min` : "",
  };
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
  const currentCoordinate =
    snapshot?.currentCoordinate || snapshot?.driverCoordinate || null;
  const remainingMeters = calculateDistanceMeters(
    currentCoordinate,
    targetCoordinate,
  );
  const baselineMeters = Number(snapshot?.driverTripMeta?.initialMeters || 0);
  const baselineEtaMinutes = Number(
    snapshot?.driverTripMeta?.initialEtaMinutes || 0,
  );
  const progressRatio =
    Number.isFinite(remainingMeters) && baselineMeters > 0
      ? clamp(1 - remainingMeters / baselineMeters, 0, 1)
      : status === "arrived"
        ? 1
        : 0;
  const etaMinutes =
    status === "arrived"
      ? 0
      : computeDynamicEtaMinutes(
          remainingMeters,
          baselineMeters,
          baselineEtaMinutes,
        );
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
  const remainingDistanceLabel =
    Number.isFinite(remainingMeters) && remainingMeters > 0
      ? remainingMeters < 1000
        ? `${Math.max(1, Math.round(remainingMeters))} m`
        : `${(remainingMeters / 1000).toFixed(remainingMeters >= 10000 ? 0 : 1).replace(".", ",")} km`
      : "Em cálculo";
  const etaLabel =
    status === "arrived"
      ? `${Math.floor(Number(snapshot?.boardingRemainingSec || 0) / 60)}:${String(Number(snapshot?.boardingRemainingSec || 0) % 60).padStart(2, "0")}`
      : etaMinutes > 0
        ? `${etaMinutes} min`
        : "Em cálculo";

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
        ? "Siga com Waze ou Google Maps e confirme ao chegar no embarque."
        : status === "arrived"
          ? "O passageiro foi avisado e tem 2 minutos para embarcar."
          : "Siga para o destino com a navegação externa e encerre ao desembarque.",
    navigationPhase: status === "started" ? "destination" : "pickup",
  };
}

function resolveReceiptParticipants(payload = {}) {
  const payloadDriver =
    payload?.driver && typeof payload.driver === "object" ? payload.driver : {};
  const payloadPassenger =
    payload?.passenger && typeof payload.passenger === "object"
      ? payload.passenger
      : payload?.customer && typeof payload.customer === "object"
        ? payload.customer
        : {};
  const activeBooking =
    runtimeState.activeBooking && typeof runtimeState.activeBooking === "object"
      ? runtimeState.activeBooking
      : {};
  const activeRide =
    runtimeState.driverActiveRide &&
    typeof runtimeState.driverActiveRide === "object"
      ? runtimeState.driverActiveRide
      : {};

  return {
    driverId: sanitizeText(
      payloadDriver?.id ||
        payload?.driverId ||
        activeBooking?.driverId ||
        activeBooking?.driver?.id ||
        runtimeState.driverInfo?.id,
      "",
    ),
    driverName: sanitizeText(
      payloadDriver?.name ||
        payload?.driverName ||
        activeBooking?.driverName ||
        activeBooking?.driver?.name ||
        runtimeState.driverInfo?.name,
      "",
    ),
    passengerId: sanitizeText(
      payloadPassenger?.id ||
        payload?.customerId ||
        payload?.passengerId ||
        activeRide?.passengerId ||
        activeBooking?.customerId ||
        activeBooking?.customer?.id ||
        activeBooking?.passengerId,
      "",
    ),
    passengerName: sanitizeText(
      payloadPassenger?.name ||
        payload?.passengerName ||
        payload?.customerName ||
        activeRide?.passenger ||
        activeBooking?.customerName ||
        activeBooking?.customer?.name ||
        activeBooking?.passengerName,
      "",
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

  const operationalFee = Number(payload?.[operationalKey]);
  const paymentIntermediationFee = Number(payload?.[intermediationKey]);
  const totalFees = Number(payload?.[totalKey]);
  const driverNetAmount = Number(payload?.[netKey]);

  const hasOperational = Number.isFinite(operationalFee);
  const hasIntermediation = Number.isFinite(paymentIntermediationFee);
  const hasTotal = Number.isFinite(totalFees);
  const hasNet = Number.isFinite(driverNetAmount);

  if (!hasOperational && !hasIntermediation && !hasTotal && !hasNet) {
    return null;
  }

  return {
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
    if (Number.isFinite(netAmount) && netAmount >= 0) {
      return netAmount;
    }
  }

  for (const source of [...normalizedSources].reverse()) {
    const fallbackFare = toFiniteRuntimeMoney(
      source?.fare ?? source?.grossFare ?? source?.amount,
    );
    if (fallbackFare !== null && fallbackFare >= 0) {
      return fallbackFare;
    }
  }

  return 0;
}

export function resolveCompletedTripFinancialSnapshot(
  payload = {},
  previousState = runtimeState,
) {
  const finalFare = roundCurrencyValue(
    payload?.finalFare ??
      payload?.fare ??
      payload?.amount ??
      previousState?.selectedFare ??
      previousState?.activeBooking?.estimatedFare ??
      0,
  );
  const payloadFeeBreakdown =
    extractPayloadFeeBreakdown(payload, { estimated: false }) ||
    extractPayloadFeeBreakdown(payload, { estimated: true });
  const lockedRideSnapshot = mergeLockedDriverRideSnapshot(
    previousState?.driverActiveRide,
    previousState?.activeBooking,
    payload,
  );
  const lockedFeeBreakdown =
    extractPayloadFeeBreakdown(lockedRideSnapshot, { estimated: false }) ||
    extractPayloadFeeBreakdown(lockedRideSnapshot, { estimated: true });
  const payoutFallback = resolveDriverPayoutAmount(
    lockedRideSnapshot,
    previousState?.driverTripMeta,
  );

  const operationalFee =
    toFiniteRuntimeMoney(payload?.operationalFee) ??
    toFiniteRuntimeMoney(payloadFeeBreakdown?.operationalFee) ??
    toFiniteRuntimeMoney(lockedFeeBreakdown?.operationalFee);
  const paymentIntermediationFee =
    toFiniteRuntimeMoney(payload?.paymentIntermediationFee) ??
    toFiniteRuntimeMoney(payloadFeeBreakdown?.paymentIntermediationFee) ??
    toFiniteRuntimeMoney(lockedFeeBreakdown?.paymentIntermediationFee);
  const driverNetAmount =
    toFiniteRuntimeMoney(payload?.driverNetAmount) ??
    toFiniteRuntimeMoney(payloadFeeBreakdown?.driverNetAmount) ??
    toFiniteRuntimeMoney(lockedFeeBreakdown?.driverNetAmount) ??
    (Number.isFinite(payoutFallback) && payoutFallback >= 0
      ? roundCurrencyValue(payoutFallback)
      : null);
  const totalFeesFromPayload =
    toFiniteRuntimeMoney(payload?.totalFees) ??
    toFiniteRuntimeMoney(payloadFeeBreakdown?.totalFees) ??
    toFiniteRuntimeMoney(lockedFeeBreakdown?.totalFees);
  const totalFees =
    totalFeesFromPayload !== null
      ? totalFeesFromPayload
      : driverNetAmount !== null
        ? roundCurrencyValue(Math.max(0, finalFare - driverNetAmount))
        : null;
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
    runtimeState.currentCoordinate || {
      latitude: PROTOTYPE_ORIGIN_COORDINATE.latitude,
      longitude: PROTOTYPE_ORIGIN_COORDINATE.longitude,
    }
  );
}

function resolveSyncedBookingStatus(snapshot = {}) {
  const normalizedStatus = String(snapshot?.status || "")
    .trim()
    .toUpperCase();

  if (
    [
      "INTERRUPTED_OPERATIONAL",
      "OPERATIONAL_INTERRUPTED",
      "PASSENGER_DECISION_PENDING",
    ].includes(normalizedStatus)
  ) {
    return "operational_interrupted";
  }

  if (
    [
      "REASSIGNMENT_PENDING",
      "SEARCHING_REPLACEMENT_DRIVER",
      "REPLACEMENT_DRIVER_SEARCHING",
    ].includes(normalizedStatus)
  ) {
    return "searching_replacement";
  }

  if (["IN_PROGRESS", "STARTED"].includes(normalizedStatus)) {
    return "started";
  }

  if (
    [
      "REASSIGNED_IN_PROGRESS",
      "REPLACEMENT_DRIVER_ACCEPTED",
      "REASSIGNED_STARTED",
    ].includes(normalizedStatus)
  ) {
    return "started";
  }

  if (["ARRIVED", "DRIVER_ARRIVED"].includes(normalizedStatus)) {
    return "arrived";
  }

  if (["MATCHED", "ACCEPTED"].includes(normalizedStatus)) {
    return "accepted";
  }

  if (
    [
      "COMPLETED",
      "EARLY_ENDED_BY_RIDER",
      "INTERRUPTED_OPERATIONAL_ENDED",
      "EARLY_ENDED_REVIEW",
    ].includes(normalizedStatus)
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
    ].includes(normalizedStatus)
  ) {
    return "searching";
  }

  return snapshot?.hasActiveRide ? "searching" : "idle";
}

function buildReceiptFromSyncedSnapshot(
  snapshot = {},
  previousState = runtimeState,
) {
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
  const pickupLabel =
    snapshot?.pickupLocation?.add ||
    previousState?.driverActiveRide?.pickup ||
    previousState?.driverTripMeta?.pickupAddress ||
    previousState?.currentAddress ||
    "Origem";
  const dropLabel =
    snapshot?.destinationLocation?.add ||
    previousState?.driverActiveRide?.dropoffAddress ||
    destination?.address ||
    destination?.name ||
    previousState?.selectedDestination?.address ||
    previousState?.selectedDestination?.name ||
    "Destino";
  const completedPricingSnapshot = resolveCompletedTripFinancialSnapshot(
    snapshot,
    previousState,
  );
  const finalFare = completedPricingSnapshot.finalFare;

  return {
    completedAt: new Date().toISOString(),
    id:
      snapshot?.bookingId ||
      previousState?.activeBookingId ||
      `proto-${Date.now()}`,
    date: new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    route: `${pickupLabel} -> ${dropLabel}`,
    value: formatCurrencyBRL(finalFare),
    fare: finalFare,
    distanceKm: Number(previousState?.tripDistanceKm || 0),
    durationMin: Number(previousState?.tripDurationMin || 0),
    paymentMethod:
      snapshot?.paymentStatus === "paid"
        ? "pix"
        : previousState?.paymentMethod || "pix",
    driverId: snapshot?.driverId || previousState?.driverInfo?.id || null,
    driverName: previousState?.driverInfo?.name || null,
    passengerId: snapshot?.customerId || previousState?.profileUid || null,
    passengerName: previousState?.profileName || null,
    pickup: pickupLabel,
    drop: dropLabel,
    ...(Number.isFinite(snapshot?.pickupLocation?.lat) &&
    Number.isFinite(snapshot?.pickupLocation?.lng)
      ? {
          pickupCoordinate: {
            latitude: Number(snapshot.pickupLocation.lat),
            longitude: Number(snapshot.pickupLocation.lng),
          },
        }
      : {}),
    ...(Number.isFinite(snapshot?.destinationLocation?.lat) &&
    Number.isFinite(snapshot?.destinationLocation?.lng)
      ? {
          destinationCoordinate: {
            latitude: Number(snapshot.destinationLocation.lat),
            longitude: Number(snapshot.destinationLocation.lng),
          },
        }
      : {}),
    ...completedPricingSnapshot,
  };
}

function clearRuntimeRideStateFromSync() {
  stopSearchingTimer();
  stopBoardingCountdownTimer();
  stopPassengerLocationHeartbeat();

  setRuntimeState((previous) => ({
    bookingStatus: "idle",
    searchingElapsedSeconds: 0,
    activeBookingId: null,
    activeBooking: null,
    driverOffers: [],
    driverActiveRide: null,
    driverCoordinate: null,
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

  setRuntimeState((previous) => ({
    bookingStatus: "idle",
    searchingElapsedSeconds: 0,
    activeBookingId: null,
    activeBooking: null,
    driverOffers: [],
    driverActiveRide: null,
    driverCoordinate: null,
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
      };
    });
  }, SEARCH_TIMER_INTERVAL_MS);
}

function pushTripHistoryItem(receipt) {
  if (!receipt) {
    return;
  }

  setRuntimeState((previous) => {
    const nextHistory = [
      receipt,
      ...(previous.tripHistory || []).filter(
        (item) => item?.id !== receipt?.id,
      ),
    ].slice(0, TRIP_HISTORY_LIMIT);
    return {
      tripHistory: nextHistory,
      lastReceipt: receipt,
    };
  });
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
  const { allowCurrentPosition = true, resolveAddress = true } = options;

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
      permission = await Location.requestForegroundPermissionsAsync();
    }

    if (permission.status !== "granted") {
      return;
    }

    let position = null;
    if (Platform.OS === "android") {
      try {
        position = await Location.getLastKnownPositionAsync({
          maxAge: 60000,
          requiredAccuracy: 250,
        });
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
              accuracy: Location.Accuracy.Balanced,
              maximumAge: 15000,
              timeout: 8000,
            }
          : {
              accuracy: Location.Accuracy.Balanced,
              maximumAge: 10000,
              timeout: 12000,
            };

      position = await Location.getCurrentPositionAsync(currentPositionOptions);
    }

    const latitude = Number(position?.coords?.latitude);
    const longitude = Number(position?.coords?.longitude);
    const currentHeading = normalizeHeading(position?.coords?.heading);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

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

    const normalizedCoordinate = { latitude, longitude };
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

    const syncedStatus = resolveSyncedBookingStatus(payload);
    const normalizedLocalBookingStatus = String(runtimeState.bookingStatus || "")
      .trim()
      .toLowerCase();
    const hasPendingDriverOfferContext =
      hasLocalPendingDriverOffer(runtimeState) &&
      (normalizedLocalBookingStatus === "searching" ||
        Boolean(runtimeState.activeBookingId));
    const shouldPreserveLocalPassengerSearch =
      runtimeState.activeRole === "customer" &&
      syncedStatus === "idle" &&
      ["requesting", "searching", "searching_replacement"].includes(
        normalizedLocalBookingStatus,
      ) &&
      (Boolean(runtimeState.activeBookingId) ||
        Boolean(
          runtimeState.activeBooking &&
            typeof runtimeState.activeBooking === "object",
        ) ||
        ["processing", "confirmed"].includes(
          String(runtimeState.paymentState?.status || "")
            .trim()
            .toLowerCase(),
        ));
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
      passengerName: payload?.passengerName || runtimeState.profileName,
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

  const handleRideAccepted = (payload) => {
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
        passengerName: runtimeState.profileName,
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

    if (coordinate && pickupCoordinate) {
      previewDriverPickupRoute({
        origin: coordinate,
        pickup: pickupCoordinate,
        pickupAddress:
          payload?.pickupLocation?.add ||
          payload?.pickupLocation?.address ||
          runtimeState.currentAddress ||
          "Embarque",
      }).catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao renderizar rota até o embarque:",
          error?.message || error,
        );
      });
    }

    stopSearchingTimer();
    stopBoardingCountdownTimer();
    setRuntimeState({
      bookingStatus: "accepted",
      activeBookingId: bookingId || runtimeState.activeBookingId,
      driverInfo: {
        id: driver?.id || payload?.driverId || null,
        name: driver?.name || payload?.driverName || "Motorista",
        plate: driver?.vehicle?.plate || payload?.vehicle?.plate || "",
        model: driver?.vehicle?.model || payload?.vehicle?.model || "",
        rating: driver?.rating || payload?.rating || null,
      },
      tripDurationMin:
        Number.isFinite(etaToPickupMin) && etaToPickupMin > 0
          ? Math.max(1, Math.round(etaToPickupMin))
          : runtimeState.tripDurationMin,
      tripArrivalText:
        Number.isFinite(etaToPickupMin) && etaToPickupMin > 0
          ? `Chegada estimada em ${Math.max(1, Math.round(etaToPickupMin))} min`
          : runtimeState.tripArrivalText,
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
      driverCoordinate: coordinate || runtimeState.driverCoordinate,
      ...(runtimeRole === "driver"
        ? {
            driverTripMeta: {
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
              fare: acceptedRideFare,
              fareLabel: formatCurrencyBR(acceptedRideFare),
            },
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
          ? "Aguardando embarque do passageiro"
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

  const handleTripStarted = () => {
    writeRuntimeDebugProbe("event_trip_started", {
      bookingId: runtimeState.activeBookingId || null,
    });
    stopBoardingCountdownTimer();
    setRuntimeState({
      bookingStatus: "started",
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
      driverActiveRide: runtimeState.driverActiveRide
        ? {
            ...runtimeState.driverActiveRide,
            status: "started",
          }
        : runtimeState.driverActiveRide,
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
    const lat = Number(payload?.location?.lat);
    const lng = Number(payload?.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return;
    }

    setRuntimeState({
      driverCoordinate: { latitude: lat, longitude: lng },
    });
  };

  const handleTripCompleted = (payload) => {
    writeRuntimeDebugProbe("event_trip_completed", {
      bookingId:
        payload?.bookingId || runtimeState.activeBookingId || null,
      fare: payload?.fare ?? payload?.amount ?? null,
    });
    stopSearchingTimer();
    stopBoardingCountdownTimer();
    stopPassengerLocationHeartbeat();

    const completedPricingSnapshot = resolveCompletedTripFinancialSnapshot(
      payload,
      runtimeState,
    );
    const finalFare = completedPricingSnapshot.finalFare;
    const distance = Number(
      payload?.distance || runtimeState.tripDistanceKm || 0,
    );
    const durationSeconds = Number(payload?.duration || 0);
    const durationMinutes =
      Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Math.round(durationSeconds / 60)
        : runtimeState.tripDurationMin || 0;
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
    const receiptRouteCoordinates =
      Array.isArray(completedRoute?.coordinates) &&
      completedRoute.coordinates.length >= 2
        ? completedRoute.coordinates
        : [];

    const receipt = {
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
      route:
        payload?.pickup && payload?.drop
          ? `${payload.pickup} -> ${payload.drop}`
          : runtimeState.selectedDestination?.name &&
              runtimeState.currentAddress
            ? `${runtimeState.currentAddress} -> ${runtimeState.selectedDestination.name}`
            : runtimeState.selectedDestination?.name || "Corrida finalizada",
      value: formatCurrencyBRL(finalFare),
      fare: finalFare,
      distanceKm: Number.isFinite(distance) ? distance : 0,
      durationMin: Number.isFinite(durationMinutes) ? durationMinutes : 0,
      paymentMethod:
        payload?.paymentMethod || runtimeState.paymentMethod || "pix",
      driverId: receiptParticipants.driverId || null,
      driverName: receiptParticipants.driverName || null,
      passengerId: receiptParticipants.passengerId || null,
      passengerName: receiptParticipants.passengerName || null,
      pickup:
        payload?.pickup ||
        runtimeState.driverActiveRide?.pickup ||
        runtimeState.driverTripMeta?.pickupAddress ||
        runtimeState.currentAddress ||
        "Origem",
      drop:
        payload?.drop ||
        runtimeState.driverActiveRide?.dropoffAddress ||
        runtimeState.selectedDestination?.address ||
        runtimeState.selectedDestination?.name ||
        "Destino",
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
  };

  const handleRideOperationalInterruption = (payload) => {
    const role = resolveRuntimeRole();
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
        driverOffers: [],
        driverActiveRide: null,
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
          "Solicitação enviada. Aguarde a decisão do motorista.",
      }),
      lastError: "",
    });

    appendRuntimeNotification(
      createRuntimeNotification({
        title: "Alteração de destino solicitada",
        message:
          "Aguardando o aceite do motorista para liberar o complemento Pix.",
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
          message: "Aguardando o pagamento do complemento pelo passageiro.",
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
        "socket_disconnect_preserve_online_intent",
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

    setRuntimeState({
      lastError: String(message),
      ...(runtimeState.driverOnlinePending
        ? {
            driverOnline: false,
            driverOnlinePending: false,
            driverOnlineMutationSource: "socket_status_error",
          }
        : {}),
    });
  };

  socket.on("connect", handleConnect);
  socket.on("disconnect", handleDisconnect);
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
            fare: resolvedDriverFare,
            fareLabel: formatCurrencyBR(resolvedDriverFare),
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
    lastError: "",
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

  try {
    const socket = WebSocketManager.getInstance();
    const activeRideSnapshot = await socket.syncActiveRideWithAck(timeoutMs);
    const applied = applySyncedActiveRideSnapshot(activeRideSnapshot);
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
    await writeRuntimeDebugProbe("socket_active_ride_resync_error", {
      userId,
      reason,
      message: error?.message || String(error),
    });
    throw error;
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

    if (!socket.isConnected()) {
      await socket.connect();
    }
    await writeRuntimeDebugProbe("socket_connected", {
      userId,
      targetUserType,
      status: socket.getConnectionStatus(),
    });

    const status = socket.getConnectionStatus();
    const authenticatedAsCurrentUser =
      Boolean(status?.authenticated) &&
      status?.userId === userId &&
      (status?.userType === targetUserType || !status?.userType);

    if (!authenticatedAsCurrentUser) {
      try {
        await socket.authenticateWithAck(userId, targetUserType, 12000);
      } catch (error) {
        socket.authenticate(userId, targetUserType);
        const fallbackAuthenticated = await waitForAuthenticatedSocketUser(
          socket,
          userId,
          targetUserType,
          12000,
        );
        if (!fallbackAuthenticated) {
          throw error;
        }
      }
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
      applySyncedActiveRideSnapshot(activeRideSnapshot);
      await writeRuntimeDebugProbe("socket_active_ride_sync", {
        userId,
        bookingId: activeRideSnapshot?.bookingId || null,
        hasActiveRide: activeRideSnapshot?.hasActiveRide === true,
        status: activeRideSnapshot?.status || null,
      });
    } catch (syncError) {
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
      const shouldRestoreDriverOnlineIntent =
        !hasDriverOnlineEnableInFlight &&
        !hasDriverRideInProgress &&
        (Boolean(runtimeState.driverOnline) ||
          Boolean(runtimeState.driverOnlinePending));

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
        } else if (runtimeDriverHeartbeatInterval) {
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

    if (targetUserType === "customer" && shouldMonitorPassengerTripulation()) {
      try {
        await startPassengerLocationHeartbeat(profile, socket);
      } catch (passengerHeartbeatError) {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao restabelecer heartbeat de localização do passageiro:",
          passengerHeartbeatError?.message || passengerHeartbeatError,
        );
      }
    } else if (targetUserType !== "customer") {
      stopPassengerLocationHeartbeat();
    }

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
    setRuntimeState({ initializing: true });
    const initialLocationPromise = ensureCurrentLocation({
      allowCurrentPosition: Platform.OS !== "android",
    }).catch((error) => {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao resolver localização no bootstrap:",
        error?.message || error,
      );
      return null;
    });
    let qaSeedLock = null;
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
    await initialLocationPromise;
    if (profile?.uid && Number(qaSeedLock?.freezeUntil || 0) > Date.now()) {
      scheduleDeferredSocketBootstrap(profile, Number(qaSeedLock.freezeUntil));
    } else if (profile?.uid) {
      runtimeQALockUntil = 0;
      clearDeferredSocketBootstrapTimer();
      await ensureSocketReady(profile);
    }
    setRuntimeState({
      initializing: false,
      ready: true,
    });
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
    const details = await fetchCoordsfromPlace(destination.place_id);
    if (!Number.isFinite(details?.lat) || !Number.isFinite(details?.lng)) {
      return destination;
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
    return destination;
  }
}

async function previewDestinationOnMap(destination) {
  if (!destination?.coordinate) {
    clearPrototypeMapRoute();
    return null;
  }

  const origin = getOriginCoordinate();
  let coordinates = null;
  let distanceKm = null;
  let durationMinutes = null;
  let etaText = "";

  try {
    const startLoc = `${origin.latitude},${origin.longitude}`;
    const destLoc = `${destination.coordinate.latitude},${destination.coordinate.longitude}`;
    const route = await getDirectionsApi(startLoc, destLoc);
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

      setRuntimeState({
        tripDistanceKm: distanceKm,
        tripDurationMin: Math.max(1, Math.round(durationMinutes)),
        tripArrivalText: etaText,
      });
    }
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Não foi possível calcular rota real, usando fallback curvo.",
    );
  }

  setPrototypeMapRoute({
    origin,
    destination: destination.coordinate,
    destinationLabel: destination.name,
    destinationAddress: destination.address,
    coordinates,
  });

  return {
    coordinates,
    distanceKm,
    durationMinutes,
    etaText,
  };
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

  let coordinates = null;
  let distanceKm = null;
  let durationMinutes = null;
  let etaText = "";
  try {
    const startLoc = `${origin.latitude},${origin.longitude}`;
    const pickupLoc = `${pickup.latitude},${pickup.longitude}`;
    const route = await getDirectionsApi(startLoc, pickupLoc);
    coordinates = decodePolylineToCoordinates(route?.polylinePoints);
    if (route?.distance_in_km || route?.time_in_secs) {
      distanceKm = Number(Number(route.distance_in_km || 0).toFixed(1));
      durationMinutes = Number(route.time_in_secs || 0) / 60;
      etaText = `Chegada estimada em ${Math.max(1, Math.round(durationMinutes))} min`;
    }
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao calcular rota motorista->embarque:",
      error?.message || error,
    );
  }

  setPrototypeMapRoute({
    origin,
    destination: pickup,
    destinationLabel: "Embarque",
    destinationAddress: pickupAddress || "Local de embarque",
    coordinates,
  });

  return {
    coordinates,
    distanceKm,
    durationMinutes,
    etaText,
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

  let coordinates = null;
  let distanceKm = null;
  let durationMinutes = null;
  let etaText = "";

  try {
    const startLoc = `${origin.latitude},${origin.longitude}`;
    const destLoc = `${destination.latitude},${destination.longitude}`;
    const route = await getDirectionsApi(startLoc, destLoc);
    coordinates = decodePolylineToCoordinates(route?.polylinePoints);
    if (route?.distance_in_km || route?.time_in_secs) {
      distanceKm = Number(Number(route.distance_in_km || 0).toFixed(1));
      durationMinutes = Number(route.time_in_secs || 0) / 60;
      etaText = `Chegada estimada em ${Math.max(1, Math.round(durationMinutes))} min`;
    }
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha ao calcular rota motorista->destino:",
      error?.message || error,
    );
  }

  setPrototypeMapRoute({
    origin,
    destination,
    destinationLabel: destinationLabel || "Destino",
    destinationAddress: destinationAddress || destinationLabel || "Destino",
    coordinates,
  });

  return {
    coordinates,
    distanceKm,
    durationMinutes,
    etaText,
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
    const route = await getDirectionsApi(startLoc, destLoc);
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

async function findDestinations(query) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
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
        .map((item) => normalizeDestinationItem(item))
        .filter((item) => item?.name || item?.address);
    } catch (error) {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao carregar destinos confirmados:",
        error?.message || error,
      );
      return [];
    }
  }

  const location = runtimeState.currentCoordinate
    ? {
        lat: runtimeState.currentCoordinate.latitude,
        lng: runtimeState.currentCoordinate.longitude,
      }
    : null;

  const inputType = detectInputType(normalizedQuery);
  const sessionToken = `proto-${Date.now()}`;

  let predictions = [];
  try {
    predictions = await fetchPlacesAutocomplete(
      normalizedQuery,
      sessionToken,
      location,
    );
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] Falha no autocomplete de destino:",
      error?.message || error,
    );
  }

  if ((!Array.isArray(predictions) || predictions.length === 0)) {
    try {
      predictions = await fetchGeocodeAddress(normalizedQuery, location);
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

  return predictions.slice(0, 8).map((item) => {
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
    });
  });
}

async function requestPrototypeRide(profile, payload) {
  const destinationInput = normalizeDestinationItem(
    payload?.destination || runtimeState.selectedDestination || {},
  );
  const destination = await resolveDestinationCoordinate(destinationInput);

  if (!destination?.coordinate) {
    throw new Error("Destino sem coordenadas válidas.");
  }

  const userId = profile?.uid;
  if (!userId) {
    throw new Error("Usuário não autenticado para solicitar corrida.");
  }

  const socketReady = await ensureSocketReady(profile);
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

  const origin = getOriginCoordinate();
  const originAddress =
    resolveMeaningfulAddress(
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
      paymentStatus: "in_holding",
      confirmedAt: new Date().toISOString(),
    },
  };
  const provisionalOffer = buildDriverOffer({
    bookingId: runtimeState.activeBookingId || `pending-${Date.now()}`,
    destination,
    fare,
    etaMinutes: runtimeState.tripDurationMin,
    pickupAddress: originAddress,
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
    response = await socket.createBooking(bookingData);
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
    },
    driverOffers: mergeDriverOffers(runtimeState.driverOffers, {
      ...provisionalOffer,
      id: bookingId || provisionalOffer.id,
      bookingId: bookingId || provisionalOffer.bookingId,
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
}

async function checkPrototypeRideAvailability(profile, payload) {
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

  const origin = getOriginCoordinate();
  const vehicle =
    payload?.vehicle || runtimeState.selectedVehicle || "Leaf Plus";
  const operationalVehicleType = resolveOperationalVehicleType(vehicle);
  const socket = WebSocketManager.getInstance();

  return socket.checkRideAvailability({
    customerId: userId,
    pickupLocation: {
      lat: Number(origin.latitude),
      lng: Number(origin.longitude),
    },
    destinationLocation: destination?.coordinate
      ? {
          lat: Number(destination.coordinate.latitude),
          lng: Number(destination.coordinate.longitude),
        }
      : null,
    carType: operationalVehicleType,
  });
}

async function cancelPrototypeRide() {
  const bookingId = runtimeState.activeBookingId;
  if (bookingId) {
    suppressBookingEvents(bookingId, "passenger_cancel_request");
  }
  let cancelResponse = null;
  if (bookingId) {
    try {
      const socket = WebSocketManager.getInstance();
      if (socket.isConnected()) {
        cancelResponse = await socket.cancelRide(
          bookingId,
          "Cancelado pelo passageiro.",
        );
      }
    } catch (error) {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao cancelar corrida no backend:",
        error?.message || error,
      );
    }
  }

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
    lastError: "",
  });
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
    tripArrivalText: "Aguardando embarque do passageiro",
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
  stopBoardingCountdownTimer();
  const locationOverride = options?.locationOverride || null;
  if (!bookingId) {
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

  try {
    const socket = WebSocketManager.getInstance();
    if (socket.isConnected()) {
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
    }
  } catch (error) {
    Logger.warn(
      "⚠️ [PrototypeRuntime] startTrip remoto falhou, mantendo fluxo local:",
      error?.message || error,
    );
  }

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
  let destinationPreview = null;
  if (startCoordinate && destinationCoordinate) {
    destinationPreview = await previewDriverDestinationRoute({
      origin: startCoordinate,
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
    });
  }

  const baselineDistanceKm = Number(destinationPreview?.distanceKm);
  const baselineDurationMinutes = Number(destinationPreview?.durationMinutes);

  setRuntimeState({
    bookingStatus: "started",
    boardingDeadlineAt: null,
    boardingRemainingSec: 0,
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
  const distanceKm = Number(runtimeState.tripDistanceKm || 0);
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
  const receiptRouteCoordinates =
    Array.isArray(completedRoute?.coordinates) &&
    completedRoute.coordinates.length >= 2
      ? completedRoute.coordinates
      : [];

  if (bookingId) {
    const socket = WebSocketManager.getInstance();
    if (!socket.isConnected()) {
      throw new Error("Serviço indisponível para finalizar a corrida.");
    }

    return socket.completeTrip(
      bookingId,
      {
        lat:
          Number(locationOverride?.lat) ||
          Number(locationOverride?.latitude) ||
          runtimeState.currentCoordinate.latitude,
        lng:
          Number(locationOverride?.lng) ||
          Number(locationOverride?.longitude) ||
          runtimeState.currentCoordinate.longitude,
      },
      distanceKm,
      fare,
    );
  }

  const fallbackReceipt = {
    completedAt: new Date().toISOString(),
    id: bookingId || `local-${Date.now()}`,
    date: new Date().toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }),
    route:
      runtimeState.selectedDestination?.name && runtimeState.currentAddress
        ? `${runtimeState.currentAddress} -> ${runtimeState.selectedDestination.name}`
        : runtimeState.selectedDestination?.name || "Corrida finalizada",
    value: formatCurrencyBRL(fare),
    fare,
    distanceKm,
    durationMin: runtimeState.tripDurationMin || 0,
    paymentMethod: runtimeState.paymentMethod || "pix",
    driverId: receiptParticipants.driverId || null,
    driverName: receiptParticipants.driverName || null,
    passengerId: receiptParticipants.passengerId || null,
    passengerName: receiptParticipants.passengerName || null,
    ...completedPricingSnapshot,
    pickup:
      runtimeState.driverActiveRide?.pickup ||
      runtimeState.driverTripMeta?.pickupAddress ||
      runtimeState.currentAddress ||
      "Origem",
    drop:
      runtimeState.driverActiveRide?.dropoffAddress ||
      runtimeState.selectedDestination?.address ||
      runtimeState.selectedDestination?.name ||
      "Destino",
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
    driverTripMeta: {
      leg: null,
      initialMeters: null,
      initialEtaMinutes: null,
      pickupAddress: "",
      destinationAddress: "",
      pickupCoordinate: null,
      destinationCoordinate: null,
      fare: 0,
      fareLabel: "",
    },
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
  };
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
  const meiApproved =
    normalizeDriverActivationDocumentStatus(remoteDocuments?.mei?.status) ===
      "approved" || Boolean(remoteChecklist?.inssOrMei);
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
          inssOrMei: meiApproved,
          backgroundCheckConsent: consentApproved,
        },
        status:
          cnhApproved && crlvApproved && meiApproved && consentApproved
            ? "approved"
            : "action_required",
        updatedAt: remoteUpdatedAt,
        completedAt:
          cnhApproved && crlvApproved && meiApproved && consentApproved
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

    const profileState = computeDriverOnboardingState(
      profile?.driverActivation || createInitialDriverOnboardingState(),
    );
    let mergedState = mergeDriverActivation(profileState, persistedState);
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
        ? Boolean(mergedState?.canGoOnline)
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
  if (fieldKey === "inssOrMei") {
    return DRIVER_DOCUMENT_TYPES.mei;
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
    runtimeState?.currentCoordinate ||
    runtimeState?.driverCoordinate ||
    getOriginCoordinate();
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

function stopPassengerLocationHeartbeat() {
  if (runtimePassengerHeartbeatInterval) {
    clearInterval(runtimePassengerHeartbeatInterval);
    runtimePassengerHeartbeatInterval = null;
  }
  runtimePassengerHeartbeatInFlight = false;

  setRuntimeState((previous) => ({
    passengerLocationHeartbeat: {
      ...previous.passengerLocationHeartbeat,
      running: false,
    },
  }));
}

async function pushPassengerLocationNow(profile, socketInstance = null) {
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

  runtimePassengerHeartbeatInFlight = true;
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

    return { success: true, location, bookingId };
  } finally {
    runtimePassengerHeartbeatInFlight = false;
  }
}

async function startPassengerLocationHeartbeat(profile, socketInstance = null) {
  stopPassengerLocationHeartbeat();
  if (!profile?.uid) {
    return;
  }

  const role = resolveRuntimeRole(profile);
  if (role !== "customer") {
    return;
  }

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
  await socket.updateLocation(
    profile.uid,
    location.lat,
    location.lng,
    location.heading,
    location.speed,
  );

  setRuntimeState((previous) => ({
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
        code: error?.code || null,
        message: error?.message || "Falha ao atualizar status remoto",
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
        error: error?.message || "Falha ao atualizar status remoto",
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

async function setPrototypeDriverOnline(profile, isOnline) {
  const resolvedProfile = await resolveRuntimeActionProfile(profile, "driver");
  const nextOnline = Boolean(isOnline);

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

  return enablePrototypeDriverOnline(resolvedProfile, {
    preserveOnlineOnFailure: false,
  });
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
  const vehicleModel = sanitizeText(profile?.vehicleModel, "Leaf Plus");
  const vehiclePlate = sanitizeText(profile?.vehiclePlate, "LEF-2042");

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
  if (driverCoordinate && pickupCoordinate) {
    pickupPreview = await previewDriverPickupRoute({
      origin: driverCoordinate,
      pickup: pickupCoordinate,
      pickupAddress:
        normalizedActiveRide?.pickup ||
        normalizedActiveRide?.pickupAddress ||
        runtimeState.currentAddress,
    });
  }
  const baselineDistanceKm = Number(pickupPreview?.distanceKm);
  const baselineDurationMinutes = Number(pickupPreview?.durationMinutes);
  const fallbackDurationMinutes = Number(runtimeState.tripDurationMin || 0);
  const resolvedFare = Number(
    resolveDriverPayoutAmount(
      normalizedActiveRide,
      runtimeState.driverTripMeta,
      { fare: runtimeState.selectedFare ?? 0 },
    ),
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
      fare: resolvedFare,
      fareLabel: formatCurrencyBR(resolvedFare),
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
  const lastPassengerQuotePreviewKeyRef = useRef("");
  const lastPassengerQuoteAddressKeyRef = useRef("");
  const lastDriverRoutePreviewKeyRef = useRef("");
  const lastPassengerRoutePreviewKeyRef = useRef("");
  const bootstrapPersistKeyRef = useRef("");

  useEffect(() => {
    let cancelled = false;

    const restorePersistedProfile = async () => {
      if (authProfile?.uid || authUid) {
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
        const storedUid = String(entries?.[1]?.[1] || "").trim();

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
    const incomingName = sanitizeText(profile?.name || profile?.firstName, "");
    const incomingEmail = sanitizeText(profile?.email, "");
    const incomingPhone = sanitizeText(
      profile?.phoneNumber || profile?.phone,
      "",
    );

    setRuntimeState((previous) => ({
      profileUid: profile?.uid || null,
      profileName: incomingName,
      riderProfile: {
        ...previous.riderProfile,
        ...(incomingName ? { name: incomingName } : {}),
        ...(incomingEmail ? { email: incomingEmail } : {}),
        ...(incomingPhone ? { phone: incomingPhone } : {}),
      },
    }));
  }, [
    profile?.email,
    profile?.firstName,
    profile?.name,
    profile?.phone,
    profile?.phoneNumber,
    profile?.uid,
  ]);

  useEffect(() => {
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
    profile?.uid,
    profile?.usertype,
    profile?.userType,
    profile?.role,
    profile?.user_role,
    profile?.accountType,
  ]);

  useEffect(() => {
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
  }, [profile, profile?.uid]);

  useEffect(() => {
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
    flushRuntimeSessionNow("ready_profile_bootstrap").catch((error) => {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao persistir bootstrap pronto:",
        error?.message || error,
      );
    });
  }, [snapshot.initializing, snapshot.profileUid, snapshot.ready]);

  useEffect(() => {
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

      ensureCurrentLocation({
        allowCurrentPosition: true,
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
  }, [profile, profile?.uid]);

  useEffect(() => {
    const normalizedStatus = String(snapshot.bookingStatus || "")
      .trim()
      .toLowerCase();

    if (!["searching", "requesting"].includes(normalizedStatus)) {
      return undefined;
    }

    if (runtimeSearchTimer) {
      return undefined;
    }

    startSearchingTimer({ preserveElapsed: true });
    return undefined;
  }, [snapshot.bookingStatus]);

  useEffect(() => {
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
  }, [driverTripAssist?.status, profile]);

  useEffect(() => {
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
      Math.round(Number(originCoordinate.latitude) * 10000),
      Math.round(Number(originCoordinate.longitude) * 10000),
      Math.round(Number(destinationCoordinate.latitude) * 10000),
      Math.round(Number(destinationCoordinate.longitude) * 10000),
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
  }, [profile]);

  useEffect(() => {
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
        etaMinutes: driverTripAssist.etaMinutes,
        boardingRemainingSec: snapshot.boardingRemainingSec,
        passengerName:
          snapshot.driverActiveRide?.passenger ||
          snapshot.activeBooking?.customerName ||
          snapshot.profileName ||
          "Passageiro",
        fare: snapshot.driverTripMeta?.fare || snapshot.selectedFare || 0,
        fareLabel:
          snapshot.driverTripMeta?.fareLabel ||
          formatCurrencyBR(
            snapshot.selectedFare || snapshot.activeBooking?.estimatedFare || 0,
          ),
      })
      .catch((error) => {
        Logger.warn(
          "⚠️ [PrototypeRuntime] Falha ao sincronizar assistência do motorista:",
          error?.message || error,
        );
      });
  }, [
    driverTripAssist,
    profile,
    snapshot.activeBooking?.customerName,
    snapshot.activeBooking?.estimatedFare,
    snapshot.activeBookingId,
    snapshot.boardingRemainingSec,
    snapshot.currentCoordinate,
    snapshot.driverActiveRide,
    snapshot.driverCoordinate,
    snapshot.driverTripMeta,
    snapshot.profileName,
    snapshot.selectedFare,
    snapshot.tripDistanceKm,
    snapshot.tripDurationMin,
  ]);

  useEffect(() => {
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
  }, [snapshot.driverTransientCard?.id, snapshot.driverTransientCard?.visibleUntil]);

  useEffect(() => {
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
  }, [liveTripProgress]);

  const prototypePlaybackConfig = useMemo(
    () => getPrototypePlaybackConfigSnapshot(),
    [],
  );

  useEffect(() => {
    const role = resolveRuntimeRole(profile);
    const playbackStatus = String(driverTripAssist?.status || "")
      .trim()
      .toLowerCase();
    const shouldRunPlayback =
      role === "driver" &&
      ["accepted", "started"].includes(playbackStatus) &&
      Boolean(snapshot.activeBookingId || snapshot.driverActiveRide?.bookingId) &&
      Number.isFinite(snapshot.currentCoordinate?.latitude) &&
      Number.isFinite(snapshot.currentCoordinate?.longitude) &&
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
      const stepMeters = resolvePlaybackStepMeters(currentStatus, {
        tickMs:
          Number(prototypePlaybackConfig.tickMs) || DRIVER_ROUTE_PLAYBACK_TICK_MS,
        qaMultiplier: isRuntimeQALockActive()
          ? Number(prototypePlaybackConfig.qaMultiplier) || 1
          : 1,
        speedMetersPerSecond:
          currentStatus === "accepted"
            ? Number(prototypePlaybackConfig.pickupSpeedMetersPerSecond) || 8
            : Number(prototypePlaybackConfig.tripSpeedMetersPerSecond) || 10,
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
        currentCoordinate: nextPlaybackFrame.coordinate,
        driverCoordinate: nextPlaybackFrame.coordinate,
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
    Number.isFinite(snapshot.currentCoordinate?.latitude),
    Number.isFinite(snapshot.currentCoordinate?.longitude),
  ]);

  useEffect(() => {
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
          speedMetersPerSecond:
            currentStatus === "accepted"
              ? Number(prototypePlaybackConfig.pickupSpeedMetersPerSecond) || 8
              : Number(prototypePlaybackConfig.tripSpeedMetersPerSecond) || 10,
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
        driverCoordinate: nextPlaybackFrame.coordinate,
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
    const role = resolveRuntimeRole(profile);
    if (role !== "driver") {
      lastDriverRoutePreviewKeyRef.current = "";
      return;
    }

    if (!driverTripAssist?.targetCoordinate || !snapshot.currentCoordinate) {
      lastDriverRoutePreviewKeyRef.current = "";
      if (!driverTripAssist) {
        clearPrototypeMapRoute();
      }
      return;
    }

    const routePreviewKey = [
      driverTripAssist.navigationPhase || "unknown",
      Math.round(Number(snapshot.currentCoordinate.latitude || 0) * 10000),
      Math.round(Number(snapshot.currentCoordinate.longitude || 0) * 10000),
      Math.round(Number(driverTripAssist.targetCoordinate.latitude || 0) * 10000),
      Math.round(Number(driverTripAssist.targetCoordinate.longitude || 0) * 10000),
      String(driverTripAssist.pickupAddress || ""),
      String(driverTripAssist.destinationAddress || ""),
      String(snapshot.selectedDestination?.name || ""),
    ].join(":");

    if (lastDriverRoutePreviewKeyRef.current === routePreviewKey) {
      return;
    }

    lastDriverRoutePreviewKeyRef.current = routePreviewKey;

    const previewPromise =
      driverTripAssist.navigationPhase === "pickup"
        ? previewDriverPickupRoute({
            origin: snapshot.currentCoordinate,
            pickup: driverTripAssist.targetCoordinate,
            pickupAddress: driverTripAssist.pickupAddress,
          })
        : previewDriverDestinationRoute({
            origin: snapshot.currentCoordinate,
            destination: driverTripAssist.targetCoordinate,
            destinationLabel: snapshot.selectedDestination?.name || "Destino",
            destinationAddress: driverTripAssist.destinationAddress,
          });

    previewPromise.catch((error) => {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao recalcular rota ativa do motorista:",
        error?.message || error,
      );
      setPrototypeMapRoute({
        origin: snapshot.currentCoordinate,
        destination: driverTripAssist.targetCoordinate,
        destinationLabel:
          driverTripAssist.navigationPhase === "pickup"
            ? "Embarque"
            : snapshot.selectedDestination?.name || "Destino",
        destinationAddress:
          driverTripAssist.navigationPhase === "pickup"
            ? driverTripAssist.pickupAddress
            : driverTripAssist.destinationAddress,
      });
    });
  }, [
    driverTripAssist,
    profile,
    snapshot.currentCoordinate,
    snapshot.selectedDestination?.name,
  ]);

  useEffect(() => {
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
      Math.round(Number(liveDriverCoordinate.latitude || 0) * 10000),
      Math.round(Number(liveDriverCoordinate.longitude || 0) * 10000),
      Math.round(Number(liveDestinationCoordinate.latitude || 0) * 10000),
      Math.round(Number(liveDestinationCoordinate.longitude || 0) * 10000),
      String(snapshot.selectedDestination?.name || ""),
      String(snapshot.selectedDestination?.address || ""),
      String(snapshot.driverActiveRide?.pickupAddress || ""),
      String(snapshot.driverActiveRide?.dropoffAddress || ""),
    ].join(":");

    if (lastPassengerRoutePreviewKeyRef.current === passengerRoutePreviewKey) {
      return;
    }

    lastPassengerRoutePreviewKeyRef.current = passengerRoutePreviewKey;

    const passengerPreviewPromise =
      normalizedStatus === "started"
        ? previewDriverDestinationRoute({
            origin: liveDriverCoordinate,
            destination: liveDestinationCoordinate,
            destinationLabel:
              snapshot.selectedDestination?.name ||
              snapshot.driverActiveRide?.dropoff ||
              "Destino",
            destinationAddress:
              snapshot.driverActiveRide?.dropoffAddress ||
              snapshot.selectedDestination?.address ||
              snapshot.selectedDestination?.name ||
              "Destino",
          })
        : previewDriverPickupRoute({
            origin: liveDriverCoordinate,
            pickup: liveDestinationCoordinate,
            pickupAddress:
              snapshot.driverActiveRide?.pickupAddress ||
              snapshot.activeBooking?.pickupLocation?.add ||
              "Local de embarque",
          });

    passengerPreviewPromise.catch((error) => {
      Logger.warn(
        "⚠️ [PrototypeRuntime] Falha ao recalcular rota ativa do passageiro:",
        error?.message || error,
      );
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
    });
  }, [
    profile,
    snapshot.bookingStatus,
    snapshot.activeBooking?.pickupLocation?.add,
    snapshot.activeBookingId,
    snapshot.driverActiveRide?.bookingId,
    snapshot.driverActiveRide?.dropoff,
    snapshot.driverActiveRide?.dropoffAddress,
    snapshot.driverActiveRide?.pickupAddress,
    Number.isFinite(snapshot.driverCoordinate?.latitude),
    Number.isFinite(snapshot.driverCoordinate?.longitude),
    snapshot.selectedDestination?.address,
    snapshot.selectedDestination?.name,
  ]);

  const loadDestinationSuggestions = useCallback(async (query) => {
    const results = await findDestinations(query);
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
    await previewDestinationOnMap(resolved);
    setRuntimeState({
      selectedDestination: resolved,
      lastError: "",
    });
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

  const requestTripExtension = useCallback(
    async ({ destination, newFare } = {}) => {
      if (resolveRuntimeRole(profile) !== "customer") {
        throw new Error(
          "Somente o passageiro pode solicitar alteração de destino.",
        );
      }

      const normalizedStatus = String(runtimeState.bookingStatus || "")
        .trim()
        .toLowerCase();
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
            "Solicitação enviada. Aguarde a decisão do motorista.",
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

      const normalizedStatus = String(runtimeState.bookingStatus || "")
        .trim()
        .toLowerCase();
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
              "Aguardando o pagamento do complemento pelo passageiro.",
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

      const normalizedStatus = String(runtimeState.bookingStatus || "")
        .trim()
        .toLowerCase();
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
    markNotificationRead,
    markAllNotificationsRead,
  };
}
