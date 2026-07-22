import Logger from "../utils/Logger";
import io from "socket.io-client";
import { getApiURL, getWebSocketURL } from "../config/NetworkConfig";
import auth from "@react-native-firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { toUserFriendlyError } from "../utils/friendlyErrorMessages";
import rideCostTelemetryService from "./RideCostTelemetryService";

const CREATE_BOOKING_TIMEOUT_MS = 120000; // 2 minutos mínimo para evitar timeout prematuro em cenários de alta latência
const CREATE_BOOKING_MAX_RETRIES = 4;
const CREATE_BOOKING_RETRY_BASE_DELAY_MS = 800;
const CREATE_BOOKING_RETRY_JITTER_MS = 350;
const WS_CONNECT_TIMEOUT_MS = 30000;
const AUTH_ACK_DEFAULT_TIMEOUT_MS = 18000;
const AUTH_BUSY_MAX_RETRIES = 4;
const AUTH_BUSY_JITTER_MS = 250;
const ACTIVE_RIDE_SYNC_TIMEOUT_MS = 8000;
const TRANSIENT_CONNECT_ERROR_LOG_WINDOW_MS = 15000;
const AVAILABILITY_CACHE_TTL_MS = 5000;
const TEST_MODE_STORAGE_KEY = "@test_mode";
const AUTH_UID_STORAGE_KEY = "@auth_uid";
const USER_DATA_STORAGE_KEY = "@user_data";
const QA_SOCKET_ID_TOKEN_STORAGE_KEY = "@qa_socket_id_token";
const QA_SOCKET_ID_TOKEN_MIN_TTL_MS = 60000;
const QA_SOCKET_BYPASS_TRUTHY_VALUES = new Set(["1", "true", "yes", "on"]);
const TERMINAL_ACTIVE_RIDE_SYNC_STATUSES = new Set([
  "CANCELED",
  "CANCELLED",
  "COMPLETE",
  "COMPLETED",
  "COMPLETED_AFTER_REASSIGNMENT",
  "EARLY_ENDED_BY_RIDER",
  "EARLY_ENDED_REVIEW",
  "EXPIRED",
  "INTERRUPTED_OPERATIONAL_ENDED",
  "NO_DRIVERS",
  "NO_DRIVERS_AVAILABLE",
  "NO_DRIVERS_FOUND",
  "REJECTED",
  "SUPERSEDED",
  "TRIP_CANCELED",
  "TRIP_CANCELLED",
  "TRIP_COMPLETED",
]);

// ✅ CORREÇÃO: Calcular URL dinamicamente para evitar problemas em builds de release
// Não armazenar como constante, calcular sempre que necessário

const buildSocketError = (
  payload,
  fallbackMessage = "Erro desconhecido",
  context = "websocket",
) => {
  let message = fallbackMessage;

  if (typeof payload === "string" && payload.trim()) {
    message = payload;
  } else if (payload && typeof payload === "object") {
    message = payload.message || payload.error || fallbackMessage;
  }

  const error = toUserFriendlyError(
    payload && typeof payload === "object" ? { ...payload, message } : message,
    { context, fallbackMessage },
  );

  if (payload && typeof payload === "object") {
    if (payload.code) error.code = payload.code;
    if (payload.details) error.details = payload.details;
    error.payload = payload;
  }

  return error;
};

const sleepMs = (delayMs) =>
  new Promise((resolve) => setTimeout(resolve, delayMs));

const isTruthyQaSocketFlag = (value) =>
  QA_SOCKET_BYPASS_TRUTHY_VALUES.has(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );

const getProcessEnvValue = (key) =>
  typeof process !== "undefined" ? process?.env?.[key] : undefined;

const canUseClientQaSocketBypass = () =>
  __DEV__ === true ||
  isTruthyQaSocketFlag(getProcessEnvValue("EXPO_PUBLIC_E2E_TEST")) ||
  isTruthyQaSocketFlag(getProcessEnvValue("EXPO_PUBLIC_ENABLE_QA_SOCKET_BYPASS"));

const CREATE_BOOKING_RETRYABLE_CODES = new Set([
  "BOOKING_TIMEOUT",
  "WS_DISCONNECTED",
  "WS_CONNECT_TIMEOUT",
  "DUPLICATE_REQUEST",
  "QUEUE_BACKPRESSURE",
  "AUTH_BUSY",
  "AUTH_TIMEOUT",
  "PAYMENT_NOT_CONFIRMED",
]);

function createSocketRequestId(prefix = "req") {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function buildRideLifecycleCommandMetadata(options = {}) {
  const metadata = {};
  [
    "idempotencyKey",
    "offlineIntent",
    "rideEventOutbox",
    "source",
    "eventType",
    "clientSequence",
    "clientCreatedAt",
  ].forEach((key) => {
    const value = options?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      metadata[key] = value;
    }
  });
  return metadata;
}

function buildSupportScopePayload(context = {}) {
  if (!context || typeof context !== "object") {
    return {};
  }

  const scopedPayload = {};
  [
    "bookingId",
    "rideId",
    "tripId",
    "subject",
    "source",
    "bookingStatus",
    "city",
    "regionHash",
    "severity",
    "kycEvidenceId",
    "kycReviewCaseId",
    "kycChallengeId",
    "requirement",
  ].forEach((key) => {
    const value = String(context[key] ?? "").trim();
    if (value) {
      scopedPayload[key] = value;
    }
  });

  if (typeof context.reviewAvailable === "boolean") {
    scopedPayload.reviewAvailable = context.reviewAvailable;
  }

  return scopedPayload;
}

function roundCoordinateForCache(value, precision = 4) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return "na";
  }
  return numeric.toFixed(precision);
}

function stableAvailabilityPreferenceKey(preferences = {}) {
  if (!preferences || typeof preferences !== "object") {
    return "none";
  }
  const entries = Object.keys(preferences)
    .sort()
    .map((key) => [key, preferences[key]]);
  return JSON.stringify(entries);
}

function cloneSocketPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  try {
    return JSON.parse(JSON.stringify(payload));
  } catch (_error) {
    return payload;
  }
}

function normalizeSocketRideStatus(...values) {
  for (const value of values) {
    const normalized = String(value || "")
      .trim()
      .replace(/[\s-]+/g, "_")
      .toUpperCase();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function isTerminalActiveRideSyncSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return false;
  }

  if (snapshot.terminal === true) {
    return true;
  }

  const status = normalizeSocketRideStatus(
    snapshot.status,
    snapshot.bookingStatus,
    snapshot.state,
    snapshot.tripStatus,
    snapshot.terminalStatus,
  );

  return TERMINAL_ACTIVE_RIDE_SYNC_STATUSES.has(status);
}

function decodeBase64UrlJson(segment) {
  const normalized = String(segment || "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");

  if (typeof globalThis?.atob === "function") {
    return JSON.parse(globalThis.atob(padded));
  }

  if (typeof Buffer !== "undefined") {
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  }

  return null;
}

function getJwtExpirationMs(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = decodeBase64UrlJson(parts[1]);
    const expSeconds = Number(payload?.exp);
    if (!Number.isFinite(expSeconds) || expSeconds <= 0) {
      return null;
    }
    return expSeconds * 1000;
  } catch (_error) {
    return null;
  }
}

function getJwtSubject(token) {
  const parts = String(token || "").split(".");
  if (parts.length < 2) {
    return "";
  }

  try {
    const payload = decodeBase64UrlJson(parts[1]);
    return String(payload?.user_id || payload?.sub || "").trim();
  } catch (_error) {
    return "";
  }
}

function isJwtExpiredOrNearExpiry(token, nowMs = Date.now()) {
  const expirationMs = getJwtExpirationMs(token);
  if (!Number.isFinite(expirationMs)) {
    return false;
  }

  return expirationMs <= nowMs + QA_SOCKET_ID_TOKEN_MIN_TTL_MS;
}

function normalizeSocketCandidateUrl(rawUrl) {
  const raw = String(rawUrl || "").trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw.replace(/\/+$/, "").replace(/\/api$/i, ""));
    parsed.pathname = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch (_error) {
    return null;
  }
}

function buildSocketCandidateUrls() {
  const candidates = [];
  const seen = new Set();

  const pushCandidate = (url) => {
    const normalized = normalizeSocketCandidateUrl(url);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    candidates.push(normalized);
  };

  const primaryUrl = getWebSocketURL();
  pushCandidate(primaryUrl);

  try {
    const parsedPrimary = new URL(primaryUrl);
    if (/^api(?=[.-])/i.test(parsedPrimary.hostname)) {
      parsedPrimary.hostname = parsedPrimary.hostname.replace(
        /^api(?=[.-])/i,
        "socket",
      );
      pushCandidate(parsedPrimary.toString());
    }
  } catch (_error) {
    // ignore invalid primary candidate
  }

  try {
    const parsedApi = new URL(getApiURL());
    if (/^api(?=[.-])/i.test(parsedApi.hostname)) {
      parsedApi.hostname = parsedApi.hostname.replace(/^api(?=[.-])/i, "socket");
      parsedApi.pathname = "";
      parsedApi.search = "";
      parsedApi.hash = "";
      pushCandidate(parsedApi.toString());
    }
  } catch (_error) {
    // ignore invalid API-derived candidate
  }

  return candidates;
}

function resolveTelemetrySourceMeta(userId, userType, overrides = {}) {
  return {
    userId: overrides?.userId || userId || null,
    userType: overrides?.userType || userType || null,
    platform: overrides?.platform || Platform.OS,
    flow: overrides?.flow || "mobile_socket",
    scenario: overrides?.scenario || null,
    surface: overrides?.surface || "websocket",
  };
}

// ✅ FASE 2: EventEmitter interno simples (compatível com React Native)
class SimpleEventEmitter {
  constructor() {
    this.events = new Map();
  }

  on(event, callback) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event).push(callback);
  }

  off(event, callback) {
    if (!this.events.has(event)) return;

    if (callback) {
      const listeners = this.events.get(event);
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
      if (listeners.length === 0) {
        this.events.delete(event);
      }
    } else {
      this.events.delete(event);
    }
  }

  emit(event, ...args) {
    if (!this.events.has(event)) return;

    const listeners = [...this.events.get(event)]; // Cópia para evitar problemas
    listeners.forEach((callback) => {
      try {
        callback(...args);
      } catch (error) {
        Logger.error(`❌ Erro em listener de ${event}:`, error);
      }
    });
  }

  removeAllListeners(event) {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }
}

class WebSocketManager {
  static instance = null;

  constructor() {
    if (!WebSocketManager.instance) {
      this.socket = null;
      this.isConnecting = false;
      this.connectionPromise = null;
      this.connectionAttempts = 0;
      this.maxConnectionAttempts = 20; // manter sessão persistente mesmo com oscilação de rede
      this.eventListeners = new Map(); // ✅ Manter para compatibilidade temporária
      this.pendingListeners = []; // ✅ Inicializar pendingListeners
      this._connectHandlers = new Set(); // ✅ FASE 1: Rastrear handlers de conexão para evitar duplicação
      this.isAuthenticated = false; // ✅ Rastrear estado de autenticação
      this.authenticatedUserId = null; // ✅ ID do usuário autenticado
      this.authenticatedUserType = null; // ✅ Tipo do usuário autenticado
      this.authCredentials = null; // ✅ Armazenar credenciais para auto-reautenticação
      this.isAuthenticating = false; // ✅ Flag para evitar autenticação duplicada
      this.reconnectTimer = null; // Evitar agendamento duplicado de reconexão manual
      this.lastActiveRideSnapshot = null; // Snapshot de corrida ativa para reidratação pós-reconexão
      this.lastAuthenticatedPayload = null; // Snapshot do último auth confirmado pelo backend
      this._lastActiveRideSyncAt = 0;
      this.authAckInFlight = null;
      this.authAckInFlightKey = null;
      this.authRecoveryPromise = null;
      this.lastSocketUrl = null;
      this.lastConnectErrorSignature = null;
      this.lastConnectErrorLoggedAt = 0;
      this.suppressedConnectErrorCount = 0;
      this.qaSocketBypassState = { enabled: false, uid: null };
      this.lastSocketAuthPayload = null;
      this.availabilityRequestCache = new Map();
      this.availabilityInFlight = new Map();
      this.passengerLocationInFlight = new Map();
      this.rehydratedRideLifecycleByBooking = new Map();
      this.dispatchedLifecycleEventsByBooking = new Map();
      this.lastLifecycleBookingByEvent = new Map();
      rideCostTelemetryService.setPublisher(async (payload) => {
        if (!this.socket?.connected) {
          return false;
        }
        this.socket.emit("rideCostTelemetry", payload);
        return true;
      });

      // ✅ FASE 2: EventEmitter interno - única fonte de distribuição de eventos
      this.eventEmitter = new SimpleEventEmitter();
      this.socketListeners = new Set(); // Rastrear quais eventos do servidor estão sendo capturados

      // Configurações de retry
      this.retryConfig = {
        maxAttempts: 5, // Máximo de tentativas (infinito se < 0)
        initialDelay: 1000, // Delay inicial: 1s
        maxDelay: 30000, // Delay máximo: 30s
        multiplier: 1.5, // Multiplicador exponencial
      };

      WebSocketManager.instance = this;
    }
    return WebSocketManager.instance;
  }

  static getInstance() {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  _buildAvailabilityCacheKey(payload = {}) {
    const pickup = payload?.pickupLocation || {};
    const destination = payload?.destinationLocation || {};
    return [
      String(payload?.customerId || this.authenticatedUserId || "anonymous"),
      String(payload?.carType || "default"),
      roundCoordinateForCache(pickup?.lat),
      roundCoordinateForCache(pickup?.lng),
      roundCoordinateForCache(destination?.lat),
      roundCoordinateForCache(destination?.lng),
      stableAvailabilityPreferenceKey(payload?.preferences),
    ].join("|");
  }

  _getCachedAvailabilityResult(cacheKey) {
    const entry = this.availabilityRequestCache.get(cacheKey);
    if (!entry) {
      return null;
    }

    if (Date.now() - entry.createdAt > AVAILABILITY_CACHE_TTL_MS) {
      this.availabilityRequestCache.delete(cacheKey);
      return null;
    }

    return cloneSocketPayload(entry.data);
  }

  _setCachedAvailabilityResult(cacheKey, data) {
    const hasDrivers =
      data?.available === true ||
      data?.hasDrivers === true ||
      String(data?.code || "").toUpperCase() === "DRIVERS_AVAILABLE";
    if (!hasDrivers) {
      this.availabilityRequestCache.delete(cacheKey);
      return;
    }

    this.availabilityRequestCache.set(cacheKey, {
      createdAt: Date.now(),
      data: cloneSocketPayload(data),
    });
  }

  _clearAvailabilityCache() {
    this.availabilityRequestCache.clear();
    this.availabilityInFlight.clear();
  }

  _resolveLifecycleBookingId(eventName, payload = {}) {
    const normalizedEvent = String(eventName || "").trim();
    const lastActiveSnapshotBookingId = this._getLifecycleSnapshotBookingFallback();
    const bookingId = String(
      payload?.bookingId ||
        payload?.rideId ||
        payload?.booking?.bookingId ||
        payload?.booking?.id ||
        lastActiveSnapshotBookingId ||
        this.lastLifecycleBookingByEvent.get(normalizedEvent) ||
        "",
    ).trim();

    return bookingId || null;
  }

  _getLifecycleSnapshotBookingFallback() {
    if (!this.lastActiveRideSnapshot) {
      return "";
    }

    if (this.lastActiveRideSnapshot.hasActiveRide === false) {
      return "";
    }

    if (isTerminalActiveRideSyncSnapshot(this.lastActiveRideSnapshot)) {
      return "";
    }

    return String(this.lastActiveRideSnapshot.bookingId || "").trim();
  }

  _payloadMatchesBookingId(payload = {}, expectedBookingId = null) {
    const expected = String(expectedBookingId || "").trim();
    if (!expected) {
      return true;
    }

    const actual = String(
      payload?.bookingId ||
        payload?.rideId ||
        payload?.booking?.bookingId ||
        payload?.booking?.id ||
        payload?.data?.bookingId ||
        payload?.data?.rideId ||
        "",
    ).trim();

    return !actual || actual === expected;
  }

  _buildLifecycleDispatchKey(eventName, payload = {}) {
    const normalizedEvent = String(eventName || "").trim();
    const bookingId = this._resolveLifecycleBookingId(normalizedEvent, payload);

    if (!normalizedEvent || !bookingId) {
      return null;
    }

    return `${bookingId}:${normalizedEvent}`;
  }

  _clearLifecycleDispatchForBooking(bookingId = null) {
    const normalizedBookingId = String(bookingId || "").trim();
    if (!normalizedBookingId) {
      this.dispatchedLifecycleEventsByBooking.clear();
      this.lastLifecycleBookingByEvent.clear();
      return;
    }

    Array.from(this.dispatchedLifecycleEventsByBooking.keys()).forEach(
      (key) => {
        if (key.startsWith(`${normalizedBookingId}:`)) {
          this.dispatchedLifecycleEventsByBooking.delete(key);
        }
      },
    );

    Array.from(this.lastLifecycleBookingByEvent.entries()).forEach(
      ([eventName, storedBookingId]) => {
        if (storedBookingId === normalizedBookingId) {
          this.lastLifecycleBookingByEvent.delete(eventName);
        }
      },
    );
  }

  _shouldDispatchLifecycleEvent(eventName, payload = {}) {
    const normalizedEvent = String(eventName || "").trim();
    if (
      ![
        "rideAccepted",
        "driverAccepted",
        "driverArrived",
        "arrivedAtPickup",
        "tripStarted",
      ].includes(normalizedEvent)
    ) {
      return true;
    }

    const lifecycleBookingId = this._resolveLifecycleBookingId(
      normalizedEvent,
      payload,
    );
    if (lifecycleBookingId) {
      this.lastLifecycleBookingByEvent.set(normalizedEvent, lifecycleBookingId);
    }

    const lifecycleKey = this._buildLifecycleDispatchKey(
      normalizedEvent,
      payload,
    );
    if (!lifecycleKey) {
      return true;
    }

    if (this.dispatchedLifecycleEventsByBooking.has(lifecycleKey)) {
      return false;
    }

    this.dispatchedLifecycleEventsByBooking.set(lifecycleKey, Date.now());
    return true;
  }

  _emitLifecycleEvent(eventName, payload = {}) {
    const normalizedPayload =
      payload && typeof payload === "object" ? { ...payload } : payload;

    if (!this._shouldDispatchLifecycleEvent(eventName, normalizedPayload)) {
      return false;
    }

    this.eventEmitter.emit(eventName, normalizedPayload);
    return true;
  }

  _emitLifecycleCommandWithAck({
    commandName,
    eventName,
    payload,
    successEvent,
    errorEvent,
    bookingId,
    timeoutMs = 10000,
    fallbackErrorMessage = "Lifecycle command failed",
  }) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const telemetryContext = this._resolveRideTelemetryContext({}, bookingId);
      const startedAt = Date.now();
      let settled = false;
      let timeout = null;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        this.off(successEvent, handleSuccess);
        this.off(errorEvent, handleError);
      };

      const settleSuccess = (data = {}) => {
        if (settled || !this._payloadMatchesBookingId(data, bookingId)) {
          return;
        }
        settled = true;
        cleanup();
        this._recordRideTelemetryCommand(
          commandName,
          {
            phase: "success",
            latencyMs: Date.now() - startedAt,
          },
          telemetryContext,
          bookingId,
        );
        resolve(data);
      };

      const settleError = (data = {}, fallbackMessage = fallbackErrorMessage) => {
        if (settled || !this._payloadMatchesBookingId(data, bookingId)) {
          return;
        }
        settled = true;
        cleanup();
        this._recordRideTelemetryCommand(
          commandName,
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: data?.code || null,
          },
          telemetryContext,
          bookingId,
        );
        reject(buildSocketError(data, fallbackMessage, "ride_lifecycle"));
      };

      const handleSuccess = (data = {}) => {
        if (data?.success === false || data?.error) {
          settleError(data, fallbackErrorMessage);
          return;
        }
        settleSuccess(data);
      };

      const handleError = (data = {}) => {
        settleError(data, fallbackErrorMessage);
      };

      timeout = setTimeout(() => {
        const timeoutCode = String(commandName || "LIFECYCLE")
          .replace(/([a-z])([A-Z])/g, "$1_$2")
          .toUpperCase();
        settleError(
          {
            code: `${timeoutCode}_TIMEOUT`,
            bookingId,
          },
          `${commandName} timeout`,
        );
      }, timeoutMs);

      this.on(successEvent, handleSuccess);
      this.on(errorEvent, handleError);
      this._recordRideTelemetryCommand(
        commandName,
        {
          phase: "attempt",
        },
        telemetryContext,
        bookingId,
      );

      this.socket.emit(eventName, payload, (ack) => {
        if (!ack) {
          return;
        }
        if (ack?.success === false || ack?.error) {
          settleError(ack, fallbackErrorMessage);
        } else {
          settleSuccess(ack);
        }
      });
    });
  }

  _buildRehydratedRideLifecycleKey(snapshot, normalizedStatus) {
    const bookingId = String(snapshot?.bookingId || "").trim();
    const status = String(normalizedStatus || snapshot?.status || "")
      .trim()
      .toUpperCase();

    if (!bookingId || !status) {
      return null;
    }

    return `${bookingId}:${status}`;
  }

  _shouldEmitRehydratedRideLifecycle(snapshot, normalizedStatus) {
    const bookingId = String(snapshot?.bookingId || "").trim();
    const lifecycleKey = this._buildRehydratedRideLifecycleKey(
      snapshot,
      normalizedStatus,
    );

    if (!bookingId || !lifecycleKey) {
      return true;
    }

    const previousKey =
      this.rehydratedRideLifecycleByBooking.get(bookingId) || null;
    if (previousKey === lifecycleKey) {
      return false;
    }

    this.rehydratedRideLifecycleByBooking.set(bookingId, lifecycleKey);
    return true;
  }

  _clearRehydratedRideLifecycle(bookingId = null) {
    const normalizedBookingId = String(bookingId || "").trim();
    if (normalizedBookingId) {
      this.rehydratedRideLifecycleByBooking.delete(normalizedBookingId);
      return;
    }

    this.rehydratedRideLifecycleByBooking.clear();
  }

  async _buildSocketAuthPayload(options = {}) {
    const forceRefresh = options?.forceRefresh === true;
    const qaSocketIdToken = await this._resolveQaSocketIdToken();
    if (qaSocketIdToken) {
      this.qaSocketBypassState = { enabled: false, uid: null };
      this.lastSocketAuthPayload = { token: qaSocketIdToken };
      return this.lastSocketAuthPayload;
    }

    let userToken = null;
    try {
      const currentUser = auth().currentUser;
      if (currentUser) {
        userToken = await currentUser.getIdToken(forceRefresh);
      }
    } catch (tokenError) {
      Logger.warn(
        "⚠️ [WebSocketManager] Erro ao obter token do Firebase:",
        tokenError,
      );
    }

    if (userToken) {
      this.qaSocketBypassState = { enabled: false, uid: null };
      this.lastSocketAuthPayload = { token: userToken };
      return this.lastSocketAuthPayload;
    }

    const qaBypassPayload = canUseClientQaSocketBypass()
      ? await this._resolveQaSocketBypassPayload()
      : null;
    if (qaBypassPayload) {
      this.qaSocketBypassState = { enabled: true, uid: qaBypassPayload.uid };
      this.lastSocketAuthPayload = {
        token: null,
        uid: qaBypassPayload.uid,
        qaAuthBypass: true,
        qaAutomation: true,
      };
      return this.lastSocketAuthPayload;
    }

    this.qaSocketBypassState = { enabled: false, uid: null };
    this.lastSocketAuthPayload = {
      token: null,
      authUnavailable: true,
    };
    return this.lastSocketAuthPayload;
  }

  async _resolveQaSocketIdToken() {
    try {
      const [testModeRaw, qaSocketIdTokenRaw, persistedUidRaw, storedUserDataRaw] = await Promise.all([
        AsyncStorage.getItem(TEST_MODE_STORAGE_KEY),
        AsyncStorage.getItem(QA_SOCKET_ID_TOKEN_STORAGE_KEY),
        AsyncStorage.getItem(AUTH_UID_STORAGE_KEY),
        AsyncStorage.getItem(USER_DATA_STORAGE_KEY),
      ]);

      let storedUserData = null;
      if (storedUserDataRaw) {
        try {
          storedUserData = JSON.parse(storedUserDataRaw);
        } catch (_error) {
          storedUserData = null;
        }
      }

      const qaSocketTokenEnabled =
        String(testModeRaw || "")
          .trim()
          .toLowerCase() === "true";
      const qaSocketIdToken = String(qaSocketIdTokenRaw || "").trim();
      const tokenSubject = getJwtSubject(qaSocketIdToken);
      const persistedUid = String(
        storedUserData?.uid ||
          storedUserData?.id ||
          persistedUidRaw ||
          "",
      ).trim();
      const isPersistedTestUser =
        storedUserData?.isTestUser === true ||
        storedUserData?.qaUser === true ||
        storedUserData?.testUser === true;
      const canUsePersistedTestUserToken =
        Boolean(qaSocketIdToken) &&
        isPersistedTestUser &&
        Boolean(tokenSubject) &&
        Boolean(persistedUid) &&
        tokenSubject === persistedUid;

      if (qaSocketTokenEnabled && qaSocketIdToken) {
        if (isJwtExpiredOrNearExpiry(qaSocketIdToken)) {
          Logger.warn(
            "⚠️ [WebSocketManager] Token QA do socket expirado ou próximo de expirar; usando autenticação alternativa.",
          );
          return null;
        }
        return qaSocketIdToken;
      }

      if (canUsePersistedTestUserToken) {
        if (isJwtExpiredOrNearExpiry(qaSocketIdToken)) {
          Logger.warn(
            "⚠️ [WebSocketManager] Token QA do usuário de teste expirado; usando autenticação alternativa.",
          );
          return null;
        }
        return qaSocketIdToken;
      }
    } catch (qaTokenError) {
      Logger.warn(
        "⚠️ [WebSocketManager] Erro ao recuperar idToken QA do socket:",
        qaTokenError,
      );
    }

    return null;
  }

  async _resolveQaSocketIdentityOverride(requestedUserId = "", requestedUserType = "") {
    try {
      const [testModeRaw, qaSocketIdTokenRaw, persistedUidRaw, storedUserDataRaw] =
        await Promise.all([
          AsyncStorage.getItem(TEST_MODE_STORAGE_KEY),
          AsyncStorage.getItem(QA_SOCKET_ID_TOKEN_STORAGE_KEY),
          AsyncStorage.getItem(AUTH_UID_STORAGE_KEY),
          AsyncStorage.getItem(USER_DATA_STORAGE_KEY),
        ]);

      const qaModeEnabled =
        String(testModeRaw || "")
          .trim()
          .toLowerCase() === "true";
      const qaSocketIdToken = String(qaSocketIdTokenRaw || "").trim();
      if (!qaModeEnabled || !qaSocketIdToken || isJwtExpiredOrNearExpiry(qaSocketIdToken)) {
        return null;
      }

      let storedUserData = null;
      if (storedUserDataRaw) {
        try {
          storedUserData = JSON.parse(storedUserDataRaw);
        } catch (_error) {
          storedUserData = null;
        }
      }

      const tokenSubject = getJwtSubject(qaSocketIdToken);
      const persistedUid = String(
        storedUserData?.uid ||
          storedUserData?.id ||
          persistedUidRaw ||
          "",
      ).trim();
      if (!tokenSubject || !persistedUid || tokenSubject !== persistedUid) {
        return null;
      }

      const persistedUserType = String(
        storedUserData?.usertype ||
          storedUserData?.userType ||
          storedUserData?.type ||
          requestedUserType ||
          "",
      ).trim();
      const normalizedRequestedUserId = String(requestedUserId || "").trim();
      const normalizedRequestedUserType = String(requestedUserType || "").trim();

      if (
        normalizedRequestedUserId === persistedUid &&
        (!persistedUserType || normalizedRequestedUserType === persistedUserType)
      ) {
        return null;
      }

      return {
        userId: persistedUid,
        userType: persistedUserType || normalizedRequestedUserType,
      };
    } catch (identityError) {
      Logger.warn(
        "⚠️ [WebSocketManager] Erro ao resolver identidade QA do socket:",
        identityError,
      );
      return null;
    }
  }

  async _resolveSocketAuthIdentity(userId = "", userType = "") {
    const normalizedUserId = String(userId || "").trim();
    const normalizedUserType = String(userType || "").trim();
    const qaIdentityOverride = await this._resolveQaSocketIdentityOverride(
      normalizedUserId,
      normalizedUserType,
    );

    if (qaIdentityOverride?.userId) {
      Logger.warn(
        "⚠️ [WebSocketManager] Substituindo identidade de socket pela identidade QA assinada.",
        {
          requestedUserId: normalizedUserId || null,
          requestedUserType: normalizedUserType || null,
          qaUserId: qaIdentityOverride.userId,
          qaUserType: qaIdentityOverride.userType || null,
        },
      );
      return qaIdentityOverride;
    }

    return {
      userId: normalizedUserId,
      userType: normalizedUserType,
    };
  }

  async _resolveQaSocketBypassPayload(preferredUserId = "") {
    try {
      const [testModeRaw, persistedUidRaw, storedUserDataRaw] =
        await Promise.all([
          AsyncStorage.getItem(TEST_MODE_STORAGE_KEY),
          AsyncStorage.getItem(AUTH_UID_STORAGE_KEY),
          AsyncStorage.getItem(USER_DATA_STORAGE_KEY),
        ]);
      const qaSocketBypassEnabled =
        String(testModeRaw || "")
          .trim()
          .toLowerCase() === "true";
      let storedUserData = null;
      if (storedUserDataRaw) {
        try {
          storedUserData = JSON.parse(storedUserDataRaw);
        } catch (_error) {
          storedUserData = null;
        }
      }
      const qaSocketBypassUid = String(
        preferredUserId ||
          this.authCredentials?.userId ||
          this.authenticatedUserId ||
          storedUserData?.uid ||
          persistedUidRaw ||
          "",
      ).trim();

      if (qaSocketBypassEnabled && qaSocketBypassUid) {
        return {
          uid: qaSocketBypassUid,
          qaAuthBypass: true,
          qaAutomation: true,
        };
      }
    } catch (qaBypassError) {
      Logger.warn(
        "⚠️ [WebSocketManager] Erro ao montar bypass QA do socket:",
        qaBypassError,
      );
    }

    return null;
  }

  _buildSocketQueryPayload(socketAuth = null) {
    if (socketAuth?.qaAuthBypass && socketAuth?.uid) {
      return {
        uid: socketAuth.uid,
        qaAuthBypass: "true",
        qaAutomation: "true",
      };
    }
    return {};
  }

  _disposeSocketInstance(socketRef = null) {
    const targetSocket = socketRef || this.socket;
    if (!targetSocket) {
      return;
    }

    try {
      targetSocket.removeAllListeners();
    } catch (_error) {
      // noop
    }

    try {
      targetSocket.disconnect();
    } catch (_error) {
      // noop
    }

    try {
      targetSocket.close();
    } catch (_error) {
      // noop
    }

    if (this.socket === targetSocket) {
      this.socket = null;
    }
  }

  _isInvalidAuthPayload(payload = null) {
    const message = String(
      payload?.message || payload?.error || payload || "",
    )
      .trim()
      .toLowerCase();
    const code = String(payload?.code || "")
      .trim()
      .toUpperCase();

    return (
      code === "TOKEN_EXPIRED" ||
      code === "AUTH_INVALID_TOKEN" ||
      message.includes("token inválido ou expirado") ||
      message.includes("token invalido ou expirado")
    );
  }

  _isQaSocketBypassRejected(payload = null) {
    if (!this.qaSocketBypassState?.enabled) {
      return false;
    }

    const source =
      payload?.payload && typeof payload.payload === "object"
        ? payload.payload
        : payload;
    const message = String(
      source?.message || source?.error || payload?.message || payload || "",
    )
      .trim()
      .toLowerCase();

    return (
      message.includes("token de autenticação ausente") ||
      message.includes("token de autenticacao ausente") ||
      message.includes("token ausente")
    );
  }

  async _recoverAuthentication(payload = null) {
    if (this.authRecoveryPromise) {
      return this.authRecoveryPromise;
    }

    const userId = this.authCredentials?.userId || null;
    const userType = this.authCredentials?.userType || null;
    if (!userId || !userType) {
      return false;
    }

    const shouldForceRefresh = this._isInvalidAuthPayload(payload);

    this.authRecoveryPromise = (async () => {
      await sleepMs(250);

      if (shouldForceRefresh) {
        Logger.warn(
          "🔄 [WebSocketManager] Recuperando autenticacao do socket com token renovado...",
          {
            userId,
            userType,
          },
        );
        await this.connect({ forceRefreshAuth: true });
      } else if (!this.socket?.connected) {
        await this.connect();
      }

      await this.authenticateWithAck(
        userId,
        userType,
        AUTH_ACK_DEFAULT_TIMEOUT_MS,
        {
          maxRetries: AUTH_BUSY_MAX_RETRIES,
          forceRefreshToken: shouldForceRefresh,
        },
      );

      return true;
    })().finally(() => {
      this.authRecoveryPromise = null;
    });

    return this.authRecoveryPromise;
  }

  _createSocketClient(url, socketAuth, socketQuery) {
    this.lastSocketUrl = url;
    Logger.log("🔌 [WebSocketManager] Conectando ao WebSocket:", url);

    const transports = ["websocket"];
    const extraHeaders = {};
    if (Platform.OS === "android") {
      extraHeaders["User-Agent"] = "LeafMobile";
    }
    if (Platform.OS !== "web") {
      extraHeaders.Origin = "file://";
    }

    Logger.log("🔌 [WebSocketManager] Configuração de transporte:", {
      transports,
      url,
      isDev: __DEV__,
      origin: extraHeaders.Origin || null,
    });

    return io(url, {
      auth: socketAuth,
      query: socketQuery,
      path: "/socket.io",
      transports,
      reconnection: true,
      reconnectionDelay: 3000,
      reconnectionDelayMax: 10000,
      reconnectionAttempts: 20,
      timeout: WS_CONNECT_TIMEOUT_MS,
      upgrade: false,
      rememberUpgrade: true,
      autoConnect: false,
      forceNew: true,
      multiplex: false,
      pingTimeout: 60000,
      pingInterval: 25000,
      allowEIO3: true,
      ...(Object.keys(extraHeaders).length > 0 ? { extraHeaders } : {}),
    });
  }

  async _connectFreshSocket(options = {}) {
    const socketAuth = await this._buildSocketAuthPayload({
      forceRefresh: options?.forceRefreshAuth === true,
    });
    if (socketAuth?.authUnavailable && !socketAuth?.token) {
      throw buildSocketError(
        {
          code: "AUTH_TOKEN_UNAVAILABLE",
          message:
            "Sessão expirada. Reabra o app para restabelecer os serviços em tempo real.",
        },
        "Sessão expirada. Reabra o app para restabelecer os serviços em tempo real.",
        "websocket",
      );
    }
    const socketQuery = this._buildSocketQueryPayload(socketAuth);
    const candidateUrls = buildSocketCandidateUrls();
    let lastError = null;

    Logger.log("🔐 [WebSocketManager] Meta do handshake do socket:", {
      hasToken: Boolean(socketAuth?.token),
      uid: socketAuth?.uid || null,
      qaAuthBypass: Boolean(socketAuth?.qaAuthBypass),
      qaAutomation: Boolean(socketAuth?.qaAutomation),
      queryKeys: Object.keys(socketQuery || {}),
      candidateUrls,
    });

    for (let index = 0; index < candidateUrls.length; index += 1) {
      const candidateUrl = candidateUrls[index];
      const socket = this._createSocketClient(
        candidateUrl,
        socketAuth,
        socketQuery,
      );
      this.socket = socket;
      this.socketListeners.clear();
      this.setupListeners();

      try {
        Logger.log("🔌 [WebSocketManager] Tentando endpoint de socket", {
          candidateUrl,
          attempt: index + 1,
          totalCandidates: candidateUrls.length,
        });
        this.connectionPromise = this._waitForConnection(
          WS_CONNECT_TIMEOUT_MS,
          socket,
        );
        socket.connect();
        await this.connectionPromise;
        this.lastSocketUrl = candidateUrl;
        return true;
      } catch (error) {
        lastError = error;
        Logger.warn(
          "⚠️ [WebSocketManager] Falha ao conectar no endpoint de socket",
          {
            candidateUrl,
            attempt: index + 1,
            totalCandidates: candidateUrls.length,
            error: error?.message || String(error),
          },
        );
        this._disposeSocketInstance(socket);
        this.connectionPromise = null;
      }
    }

    throw (
      lastError ||
      buildSocketError(
        {
          code: "WS_CONNECT_TIMEOUT",
          message: "Timeout ao conectar WebSocket",
        },
        "A conexao com o servidor demorou mais que o esperado. Tente novamente.",
        "websocket",
      )
    );
  }

  async connect(options = {}) {
    const forceRefreshAuth = options?.forceRefreshAuth === true;

    if (this.socket?.connected && !forceRefreshAuth) {
      Logger.log("✅ [WebSocketManager] Já conectado, ignorando nova conexão");
      return true;
    }

    if (this.connectionPromise && !forceRefreshAuth) {
      Logger.log(
        "⏳ [WebSocketManager] Conexão já em andamento, aguardando...",
      );
      return this.connectionPromise;
    }

    this.connectionPromise = (async () => {
      this.isConnecting = true;
      if (this.socket) {
        Logger.log(
          "🔁 [WebSocketManager] Reinicializando socket para nova tentativa de conexão",
        );
        this._disposeSocketInstance(this.socket);
      }

      this.connectionAttempts = 0;
      return this._connectFreshSocket({ forceRefreshAuth });
    })();

    try {
      return await this.connectionPromise;
    } catch (error) {
      Logger.warn(
        "⚠️ [WebSocketManager] Erro ao inicializar WebSocket:",
        error.message,
      );
      Logger.warn("⚠️ [WebSocketManager] Stack:", error.stack);
      throw error; // ✅ Re-throw para que o chamador possa tratar
    } finally {
      this.isConnecting = false;
      this.connectionPromise = null;
    }
  }

  _serializeConnectErrorDescription(description) {
    if (!description) return "N/A";
    if (typeof description === "string") return description;
    if (typeof description === "object") {
      return (
        description._type || description.type || description.message || "N/A"
      );
    }
    return String(description);
  }

  _isTransientConnectError(error) {
    const errorMessage = String(error?.message || "").toLowerCase();
    const errorType = String(error?.type || "").toLowerCase();
    const descriptionType = String(
      error?.description?._type || error?.description?.type || "",
    ).toLowerCase();

    if (
      errorType === "transporterror" &&
      errorMessage.includes("websocket error")
    ) {
      return true;
    }

    if (errorMessage.includes("xhr poll error")) {
      return true;
    }

    return (
      descriptionType === "error" &&
      (errorMessage.includes("websocket") || errorMessage.includes("network"))
    );
  }

  _logConnectError(error) {
    const errorMessage = error?.message || "Erro desconhecido";
    const errorType = error?.type || "N/A";
    const description = this._serializeConnectErrorDescription(
      error?.description,
    );
    const signature = `${errorType}:${errorMessage}:${description}`;
    const now = Date.now();
    const isTransient = this._isTransientConnectError(error);

    if (isTransient) {
      const shouldLogNow =
        this.lastConnectErrorSignature !== signature ||
        now - this.lastConnectErrorLoggedAt >=
          TRANSIENT_CONNECT_ERROR_LOG_WINDOW_MS;

      if (shouldLogNow) {
        const suppressedSinceLastLog = this.suppressedConnectErrorCount;
        this.suppressedConnectErrorCount = 0;
        this.lastConnectErrorSignature = signature;
        this.lastConnectErrorLoggedAt = now;
        Logger.log(
          "🔄 [WebSocketManager] Conexão instável detectada. Retry automático ativo.",
          {
            message: errorMessage,
            type: errorType,
            url: this.lastSocketUrl || "N/A",
            suppressedSinceLastLog,
          },
        );
      } else {
        this.suppressedConnectErrorCount += 1;
      }

      return;
    }

    this.lastConnectErrorSignature = signature;
    this.lastConnectErrorLoggedAt = now;
    this.suppressedConnectErrorCount = 0;
    Logger.error(
      "❌ [WebSocketManager] Erro de conexão WebSocket:",
      errorMessage,
    );
    Logger.error("❌ [WebSocketManager] Tipo de erro:", errorType);
    Logger.error("❌ [WebSocketManager] URL:", this.lastSocketUrl || "N/A");
    Logger.error("❌ [WebSocketManager] Descrição:", description);
  }

  _waitForConnection(
    timeoutMs = WS_CONNECT_TIMEOUT_MS,
    socketRef = this.socket,
  ) {
    if (!socketRef) {
      this.isConnecting = false;
      this.connectionPromise = null;
      return Promise.reject(
        buildSocketError(
          { code: "WS_NOT_INITIALIZED", message: "Socket nao inicializado" },
          "Nao foi possivel iniciar a conexao com o servidor agora.",
          "websocket",
        ),
      );
    }

    if (socketRef.connected) {
      this.isConnecting = false;
      this.connectionPromise = null;
      return Promise.resolve(true);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      let lastError = null;
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        socketRef?.off("connect", onConnect);
        socketRef?.off("connect_error", onConnectError);
      };

      const finalize = (handler) => (value) => {
        if (settled) return;
        settled = true;
        cleanup();
        this.isConnecting = false;
        this.connectionPromise = null;
        handler(value);
      };

      const onConnect = finalize(() => resolve(true));
      const onConnectError = (error) => {
        lastError = error;
      };

      socketRef.on("connect", onConnect);
      socketRef.on("connect_error", onConnectError);

      timeoutId = setTimeout(() => {
        finalize(() =>
          reject(
            buildSocketError(
              lastError || {
                code: "WS_CONNECT_TIMEOUT",
                message: "Timeout ao conectar WebSocket",
              },
              "A conexao com o servidor demorou mais que o esperado. Tente novamente.",
              "websocket",
            ),
          ),
        )();
      }, timeoutMs);
    });
  }

  setupListeners() {
    if (!this.socket) return;

    const listenerSocket = this.socket;

    // ✅ FASE 2: Registrar eventos do servidor APENAS UMA VEZ
    // Lista de eventos que o servidor pode enviar
    const serverEvents = [
      "rideRequest",
      "newBookingAvailable",
      "newRideRequest", // ✅ Evento do DriverNotificationDispatcher
      "bookingCreated",
      "bookingError",
      "driversFound",
      "noDriversFound",
      "rideAccepted",
      "driverAccepted",
      "rideRejected",
      "rideCancelled",
      "tripStarted",
      "tripCompleted",
      "paymentConfirmed",
      "paymentRefunded",
      "rideExtensionRequestAccepted",
      "rideExtensionApprovalRequested",
      "rideExtensionPaymentRequired",
      "rideExtensionPendingPayment",
      "rideExtensionRejected",
      "rideExtensionExpired",
      "rideExtensionConfirmed",
      "rideExtensionError",
      "rideExtensionResponseError",
      "rideOperationalInterruption",
      "rideOperationalInterrupted",
      "rideOperationalContinuationSearching",
      "rideOperationalReleased",
      "rideOperationalInterruptionError",
      "rideOperationalContinuationError",
      "ratingReceived",
      "authenticated", // ✅ Evento de autenticação confirmada
      "auth_error",
      "authentication_error",
      "driverStatusChanged",
      "driverStatusUpdated",
      "driverStatusError",
      "driverSearchResumed",
      "driver_status_updated",
      "nearbyDrivers",
      "driverLocation",
      "driverArrived",
      "arrivedAtPickup",
      "notificationActionSuccess",
      "notificationActionError",
      "passengerLocationUpdated",
      "passengerLocationError",
      "tripIntegrityCheckRequired",
      "tripIntegrityCancelled",
      "boardingStatusConfirmed",
      "boardingStatusError",
      "activeRideSync",
      "sessionTerminated",
      "locationUpdated",
      "locationBatchUpdated",
      "mapH3Refresh",
      "map_h3_refresh",
      "error",
    ];

    // ✅ Registrar listener para evento 'authenticated' do servidor
    if (!this.socketListeners.has("authenticated")) {
      this.socket.on("authenticated", (data) => {
        Logger.log(
          "✅ [WebSocketManager] Autenticação confirmada pelo servidor:",
          data,
        );
        this.isAuthenticated = true;
        this.isAuthenticating = false; // Resetar flag
        if (data.uid) this.authenticatedUserId = data.uid;
        // ✅ Atualizar userType se vier do servidor, senão manter o que já foi definido
        if (data.userType) {
          this.authenticatedUserType = data.userType;
        } else if (!this.authenticatedUserType && data.uid) {
          // Se não veio userType mas temos UID, tentar inferir do contexto
          // (isso é um fallback, o ideal é sempre enviar userType)
          Logger.warn(
            "⚠️ [WebSocketManager] Servidor não retornou userType no evento authenticated",
          );
        }
        this.lastAuthenticatedPayload = data && typeof data === "object"
          ? { ...data }
          : null;
        // ✅ FASE 2: Retransmitir através do EventEmitter
        this.eventEmitter.emit("authenticated", data);

        const now = Date.now();
        if (now - this._lastActiveRideSyncAt > 1000) {
          this._lastActiveRideSyncAt = now;
          this.syncActiveRideWithAck(ACTIVE_RIDE_SYNC_TIMEOUT_MS).catch(
            (syncError) => {
              Logger.warn(
                "⚠️ [WebSocketManager] Falha ao sincronizar corrida ativa após autenticação:",
                syncError?.message || syncError,
              );
            },
          );
        }

        rideCostTelemetryService
          .flushAllBoundContexts()
          .catch((telemetryError) => {
            Logger.warn(
              "⚠️ [WebSocketManager] Falha ao reenviar telemetria pendente da corrida:",
              telemetryError?.message || telemetryError,
            );
          });
      });
      this.socketListeners.add("authenticated");
    }

    if (!this.socketListeners.has("activeRideSync")) {
      this.socket.on("activeRideSync", (snapshot) => {
        if (snapshot?.success) {
          this.lastActiveRideSnapshot = snapshot;
          if (
            snapshot?.hasActiveRide !== true ||
            isTerminalActiveRideSyncSnapshot(snapshot)
          ) {
            this._clearRehydratedRideLifecycle(snapshot?.bookingId);
            this._clearLifecycleDispatchForBooking(snapshot?.bookingId);
          }
          this._rehydrateRideEventsFromSync(snapshot);
        }
        this.eventEmitter.emit("activeRideSync", snapshot);
      });
      this.socketListeners.add("activeRideSync");
    }

    // ✅ FASE 2: Registrar cada evento do servidor apenas uma vez
    serverEvents.forEach((eventName) => {
      if (!this.socketListeners.has(eventName)) {
        try {
          listenerSocket.on(eventName, (data) => {
            if (eventName === "sessionTerminated") {
              const activeSocketId = String(this.socket?.id || "");
              const sourceSocketId = String(listenerSocket?.id || "");
              const previousSocketId = String(data?.previousSocketId || "");

              const fromStaleSocket =
                Boolean(activeSocketId && sourceSocketId) &&
                activeSocketId !== sourceSocketId;
              const targetsDifferentSocket =
                Boolean(previousSocketId && activeSocketId) &&
                previousSocketId !== activeSocketId;

              if (fromStaleSocket || targetsDifferentSocket) {
                Logger.warn(
                  "⚠️ [WebSocketManager] Ignorando sessionTerminated de socket obsoleto",
                  {
                    activeSocketId,
                    sourceSocketId,
                    previousSocketId,
                    newSocketId: data?.newSocketId || null,
                  },
                );
                return;
              }
            }

            if (["auth_error", "authentication_error"].includes(eventName)) {
              this.isAuthenticated = false;
              this.isAuthenticating = false;

              if (this._isQaSocketBypassRejected(data)) {
                Logger.warn(
                  "⚠️ [WebSocketManager] QA bypass sem token rejeitado pelo backend local. Ative AUTO_TEST_MODE=true ou use um idToken QA para testar socket.",
                );
              } else {
                this._recoverAuthentication(data).catch((recoveryError) => {
                  Logger.warn(
                    "⚠️ [WebSocketManager] Falha ao recuperar autenticacao apos erro do socket:",
                    recoveryError?.message || recoveryError,
                  );
                });
              }
            }

            if (
              [
                "tripCompleted",
                "rideCancelled",
                "rideRejected",
                "boardingWindowExpired",
              ].includes(eventName)
            ) {
              this._clearRehydratedRideLifecycle(
                data?.bookingId || data?.rideId,
              );
              this._clearLifecycleDispatchForBooking(
                data?.bookingId || data?.rideId,
              );
            }

            if (!this._shouldDispatchLifecycleEvent(eventName, data)) {
              return;
            }

            // ✅ FASE 2: Retransmitir APENAS através do EventEmitter interno
            // Nunca usar socket.io diretamente nos componentes
            const emittedData =
              data &&
              typeof data === "object" &&
              String(eventName || "").trim() !== ""
                ? { ...data, __source: data?.__source || "socket_event" }
                : data;
            this.eventEmitter.emit(eventName, emittedData);
            // Logger.log(`📡 Evento ${eventName} recebido e distribuído`); // Desabilitado para reduzir spam
          });
          this.socketListeners.add(eventName);
          // Logger.log(`✅ Listener de servidor registrado: ${eventName}`); // Desabilitado para reduzir spam
        } catch (error) {
          Logger.warn(
            `⚠️ Erro ao registrar listener de servidor (${eventName}):`,
            error.message,
          );
        }
      }
    });

    this.socket.on("connect", () => {
      Logger.log("✅ [WebSocketManager] Conectado ao servidor WebSocket");
      Logger.log(
        "📡 [WebSocketManager] Transport:",
        this.socket.io.engine.transport.name,
      );
      Logger.log("📡 [WebSocketManager] Socket ID:", this.socket.id);
      this.isConnecting = false;
      this.connectionAttempts = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      // ✅ AUTO-REAUTENTICAÇÃO: Se já tínhamos credenciais, re-autenticar automaticamente
      if (this.authCredentials) {
        Logger.log(
          "🔐 [WebSocketManager] Reconectado. Iniciando auto-reautenticação...",
        );
        this.authenticateWithAck(
          this.authCredentials.userId,
          this.authCredentials.userType,
          AUTH_ACK_DEFAULT_TIMEOUT_MS,
          {
            maxRetries: AUTH_BUSY_MAX_RETRIES,
            forceRefreshToken: true,
          },
        ).catch((authError) => {
          Logger.warn(
            "⚠️ [WebSocketManager] Auto-reautenticação com ACK falhou, fallback para emissão simples:",
            authError?.message || authError,
          );
          if (this._isQaSocketBypassRejected(authError)) {
            Logger.warn(
              "⚠️ [WebSocketManager] Backend local rejeitou QA bypass sem token; mantendo socket sem nova tentativa automática.",
            );
            return;
          }
          this.authenticate(
            this.authCredentials.userId,
            this.authCredentials.userType,
            { force: true, forceRefreshToken: true },
          );
        });
      } else {
        // Se não temos credenciais salvas, resetar estado
        this.isAuthenticated = false;
        this.authenticatedUserId = null;
        this.authenticatedUserType = null;
        this.lastAuthenticatedPayload = null;
      }
      this.isAuthenticating = false;

      // ✅ FASE 2: Emitir evento de conexão através do EventEmitter
      this.eventEmitter.emit("connect");
    });

    this.socket.on("disconnect", (reason) => {
      Logger.log(
        `🔌 [WebSocketManager] Desconectado do servidor WebSocket: ${reason}`,
      );
      Logger.log(`🔌 [WebSocketManager] Motivo da desconexão:`, reason);
      this.isConnecting = false;
      // Resetar estado de autenticação (mas MANTER authCredentials para reconexão)
      this.isAuthenticated = false;
      this.isAuthenticating = false;
      this.lastAuthenticatedPayload = null;

      // ✅ FASE 2: Emitir através do EventEmitter
      this.eventEmitter.emit("disconnect", reason);
    });

    this.socket.on("connect_error", (error) => {
      this._logConnectError(error);

      this.isConnecting = false;
      this.connectionAttempts++;

      // ✅ Emitir erro através do EventEmitter
      this.eventEmitter.emit("connect_error", error);

      // Deixar o reconnect automático do socket.io atuar primeiro.
      // Se esgotar tentativas, agenda uma nova janela única com jitter.
      if (
        this.connectionAttempts >= this.maxConnectionAttempts &&
        !this.reconnectTimer
      ) {
        const delay = 25000 + Math.floor(Math.random() * 10000);
        Logger.log(
          `🔌 [WebSocketManager] Janela extra de reconexão em ${delay}ms`,
        );
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.connectionAttempts = 0;
          if (!this.socket?.connected) {
            this.connect();
          }
        }, delay);
      }
    });

    this.socket.on("reconnect", (attemptNumber) => {
      Logger.log(
        `🔌 Reconectado ao WebSocket após ${attemptNumber} tentativas`,
      );
      this.connectionAttempts = 0;
      // ✅ FASE 2: Emitir através do EventEmitter
      this.eventEmitter.emit("reconnect", attemptNumber);
    });
  }

  disconnect() {
    if (this.socket?.connected) {
      this.socket.disconnect();
    }
    this.isConnecting = false;
  }

  clearAuthenticationState(options = {}) {
    const shouldDisconnect = options.disconnect !== false;

    this.authCredentials = null;
    this.authAckInFlight = null;
    this.authAckInFlightKey = null;
    this.authRecoveryPromise = null;
    this.isAuthenticated = false;
    this.isAuthenticating = false;
    this.authenticatedUserId = null;
    this.authenticatedUserType = null;
    this.qaSocketBypassState = { enabled: false, uid: null };
    this.lastSocketAuthPayload = null;
    this.lastAuthenticatedPayload = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (shouldDisconnect) {
      this.disconnect();
    }
  }

  // Método para enviar eventos ao servidor via WebSocket
  emitToServer(event, data) {
    if (this.socket?.connected) {
      this.socket.emit(event, data);
    } else {
      Logger.warn(`⚠️ WebSocket não conectado. Evento '${event}' não enviado.`);
    }
  }

  // ✅ FASE 2: Método on() simplificado - usa apenas EventEmitter interno
  // NUNCA mais acessa socket.io diretamente - elimina completamente race conditions
  on(event, callback) {
    // ✅ FASE 2: Guard 1 - Validar parâmetros
    if (!event || typeof event !== "string") {
      Logger.error("⚠️ WebSocketManager.on() requer event como string");
      return;
    }

    if (typeof callback !== "function") {
      Logger.error("⚠️ WebSocketManager.on() requer callback como function");
      return;
    }

    // ✅ FASE 2: Inicializar EventEmitter se necessário
    if (!this.eventEmitter) {
      this.eventEmitter = new SimpleEventEmitter();
    }

    // ✅ FASE 2: Registrar APENAS no EventEmitter interno
    // NUNCA mais registra diretamente no socket.io!
    this.eventEmitter.on(event, callback);
    // Logger.log(`📡 Listener registrado via EventEmitter: ${event}`); // Desabilitado para reduzir spam

    // ✅ FASE 2: Garantir que o evento do servidor está sendo capturado
    // Se o socket já existe, garantir que o listener do servidor está ativo
    if (this.socket && !this.socketListeners.has(event)) {
      // Tentar registrar o listener do servidor
      this._registerServerEventListener(event);
    }
  }

  once(event, callback) {
    if (!event || typeof event !== "string") {
      Logger.warn("⚠️ WebSocketManager.once() requer event como string");
      return;
    }

    if (typeof callback !== "function") {
      Logger.warn("⚠️ WebSocketManager.once() requer callback como function");
      return;
    }

    const onceCallback = (...args) => {
      this.off(event, onceCallback);
      callback(...args);
    };

    this.on(event, onceCallback);
  }

  // ✅ FASE 2: Método privado para registrar listener do servidor
  _registerServerEventListener(eventName) {
    if (!this.socket || !this.socket.connected) {
      return; // Será registrado quando conectar
    }

    if (this.socketListeners.has(eventName)) {
      return; // Já registrado
    }

    try {
      this.socket.on(eventName, (data) => {
        this.eventEmitter.emit(eventName, data);
      });
      this.socketListeners.add(eventName);
      // Logger.log(`✅ Listener de servidor registrado: ${eventName}`); // Desabilitado para reduzir spam
    } catch (error) {
      Logger.warn(
        `⚠️ Erro ao registrar listener de servidor (${eventName}):`,
        error.message,
      );
    }
  }

  // ✅ FASE 2: Método off() simplificado - usa apenas EventEmitter interno
  off(event, callback = null) {
    // ✅ FASE 2: Guard 1 - Validar parâmetros
    if (!event || typeof event !== "string") {
      Logger.warn("⚠️ WebSocketManager.off() requer event como string");
      return;
    }

    // ✅ FASE 2: Inicializar EventEmitter se necessário
    if (!this.eventEmitter) {
      this.eventEmitter = new SimpleEventEmitter();
      return;
    }

    // ✅ FASE 2: Remover APENAS do EventEmitter interno
    // NUNCA mais remove do socket.io diretamente - não é necessário!
    this.eventEmitter.off(event, callback);

    // Nota: Não removemos do socketListeners porque outros componentes podem estar usando
    // O listener do servidor permanece ativo e distribui para todos via EventEmitter
  }

  // ✅ FASE 2: Método emit() - usar EventEmitter interno
  emit(event, ...args) {
    // ✅ FASE 2: Guard - Validar parâmetros
    if (!event || typeof event !== "string") {
      Logger.warn("⚠️ WebSocketManager.emit() requer event como string");
      return;
    }

    // ✅ FASE 2: Inicializar EventEmitter se necessário
    if (!this.eventEmitter) {
      this.eventEmitter = new SimpleEventEmitter();
      return;
    }

    // ✅ FASE 2: Emitir através do EventEmitter interno
    this.eventEmitter.emit(event, ...args);
  }

  // Verificar se está conectado
  isConnected() {
    return this.socket?.connected || false;
  }

  // Obter status completo da conexão
  getConnectionStatus() {
    return {
      connected: this.isConnected(),
      authenticated: this.isAuthenticated,
      socketId: this.socket?.id || null,
      userId: this.authenticatedUserId,
      userType: this.authenticatedUserType,
      authPayload: this.isAuthenticated ? this.lastAuthenticatedPayload : null,
      isConnecting: this.isConnecting,
    };
  }

  _mergeDriverStatusIntoAuthPayload(payload = {}) {
    if (!payload || typeof payload !== "object") {
      return;
    }

    const payloadDriverId = String(
      payload.driverId || payload.uid || payload.userId || "",
    ).trim();
    const authenticatedDriverId = String(this.authenticatedUserId || "").trim();

    if (
      payloadDriverId &&
      authenticatedDriverId &&
      payloadDriverId !== authenticatedDriverId
    ) {
      return;
    }

    const hasExplicitOnline =
      typeof payload.isOnline === "boolean" ||
      typeof payload.driverOnline === "boolean";
    const nextOnline = hasExplicitOnline
      ? payload.isOnline === true || payload.driverOnline === true
      : null;

    if (!hasExplicitOnline && !payload.driverOnlineDaily && !payload.status) {
      return;
    }

    this.lastAuthenticatedPayload = {
      ...(this.lastAuthenticatedPayload || {}),
      uid: authenticatedDriverId || payloadDriverId || this.lastAuthenticatedPayload?.uid || null,
      userId:
        authenticatedDriverId ||
        payloadDriverId ||
        this.lastAuthenticatedPayload?.userId ||
        null,
      userType:
        this.authenticatedUserType ||
        this.lastAuthenticatedPayload?.userType ||
        "driver",
      ...(hasExplicitOnline
        ? {
            isOnline: nextOnline,
            driverOnline: nextOnline,
          }
        : {}),
      ...(payload.status ? { status: payload.status } : {}),
      ...(payload.driverOnlineDaily
        ? { driverOnlineDaily: payload.driverOnlineDaily }
        : {}),
    };
  }

  _resolveRideTelemetryContext(context = {}, bookingId = null) {
    const sourceMeta = resolveTelemetrySourceMeta(
      this.authenticatedUserId || this.authCredentials?.userId || null,
      this.authenticatedUserType || this.authCredentials?.userType || null,
      context?.sourceMeta,
    );

    return {
      contextId: context?.contextId || null,
      bookingId: context?.bookingId || bookingId || null,
      sourceKey: context?.sourceKey || null,
      sourceMeta,
    };
  }

  _recordRideTelemetryCommand(
    commandName,
    options = {},
    context = {},
    bookingId = null,
  ) {
    const telemetryContext = this._resolveRideTelemetryContext(
      context,
      bookingId,
    );
    rideCostTelemetryService.recordBackendCommand(
      commandName,
      options,
      telemetryContext,
    );
    return telemetryContext;
  }

  // Verificar se pode receber solicitações de corrida
  canReceiveRideRequests() {
    const isConnected = this.isConnected();
    const isAuthenticated = this.isAuthenticated;
    const userType = this.authenticatedUserType;

    // Log para debug (apenas quando houver problema)
    if (isConnected && isAuthenticated && userType !== "driver") {
      Logger.log("⚠️ [canReceiveRideRequests] Status:", {
        connected: isConnected,
        authenticated: isAuthenticated,
        userType: userType,
        userId: this.authenticatedUserId,
      });
    }

    // Para drivers: precisa estar conectado, autenticado e ser do tipo 'driver'
    // Se userType não estiver definido mas estiver autenticado, assumir que é driver
    // (caso o servidor não retorne userType no evento authenticated)
    if (userType === "driver" || (isAuthenticated && !userType)) {
      return isConnected && isAuthenticated;
    }
    // Para outros tipos de usuário, retorna false
    return false;
  }

  // Expor socket para autenticação
  getSocket() {
    return this.socket;
  }

  // Método para autenticar usuário
  async authenticate(userId, userType, options = {}) {
    if (!this.socket?.connected) {
      Logger.warn(
        "⚠️ [WebSocketManager] WebSocket não conectado. Não é possível autenticar.",
      );
      return;
    }

    const force = options?.force === true;
    const forceRefreshToken = options?.forceRefreshToken === true;
    const authIdentity = await this._resolveSocketAuthIdentity(userId, userType);
    const resolvedUserId = authIdentity.userId;
    const resolvedUserType = authIdentity.userType;

    // ✅ Evitar autenticação duplicada se já está autenticado com os mesmos dados
    if (
      this.isAuthenticated &&
      this.authenticatedUserId === resolvedUserId &&
      this.authenticatedUserType === resolvedUserType
    ) {
      Logger.log(
        "✅ [WebSocketManager] Já autenticado com esses dados, ignorando",
      );
      return;
    }

    // ✅ Evitar múltiplas tentativas simultâneas
    if (this.isAuthenticating && !force) {
      Logger.log(
        "⚠️ [WebSocketManager] Autenticação já em andamento, ignorando chamada duplicada",
      );
      return;
    }

    this.isAuthenticating = true;
    Logger.log(
      `🔐 [WebSocketManager] Autenticando usuário: ${resolvedUserId} como ${resolvedUserType}`,
    );

    // ✅ Salvar credenciais para auto-reautenticação em caso de queda
    this.authCredentials = { userId: resolvedUserId, userType: resolvedUserType };

    // ✅ Definir dados locais
    this.authenticatedUserType = resolvedUserType;
    this.authenticatedUserId = resolvedUserId;

    const qaBypassPayload = canUseClientQaSocketBypass()
      ? await this._resolveQaSocketBypassPayload(resolvedUserId)
      : null;
    const shouldUseQaSocketBypass = Boolean(
      qaBypassPayload?.qaAuthBypass &&
      String(qaBypassPayload?.uid || "") === String(resolvedUserId || ""),
    );
    const socketAuthPayload = await this._buildSocketAuthPayload({
      forceRefresh: forceRefreshToken,
    });

    if (shouldUseQaSocketBypass) {
      this.qaSocketBypassState = {
        enabled: true,
        uid: String(resolvedUserId || "").trim(),
      };
    }

    const authenticatePayload = {
      uid: resolvedUserId,
      userType: resolvedUserType,
      ...(shouldUseQaSocketBypass
        ? {
            qaAuthBypass: true,
            qaAutomation: true,
          }
        : {}),
    };

    if (socketAuthPayload?.token) {
      authenticatePayload.token = socketAuthPayload.token;
    }

    this.socket.emit("authenticate", authenticatePayload);

    // Resetar flag após 3 segundos (tempo suficiente para resposta)
    setTimeout(() => {
      this.isAuthenticating = false;
    }, 3000);

    // O listener 'authenticated' já está registrado em setupListeners()
    // e atualizará automaticamente isAuthenticated quando o servidor confirmar
  }

  async authenticateWithAck(
    userId,
    userType,
    timeoutMs = AUTH_ACK_DEFAULT_TIMEOUT_MS,
    options = {},
  ) {
    const authIdentity = await this._resolveSocketAuthIdentity(userId, userType);
    const resolvedUserId = authIdentity.userId;
    const resolvedUserType = authIdentity.userType;
    const requestKey = `${resolvedUserId || ""}:${resolvedUserType || ""}`;
    if (this.authAckInFlight && this.authAckInFlightKey === requestKey) {
      return this.authAckInFlight;
    }

    const maxRetries = Number.isFinite(options?.maxRetries)
      ? Math.max(0, options.maxRetries)
      : AUTH_BUSY_MAX_RETRIES;
    const forceRefreshToken = options?.forceRefreshToken === true;

    const runAuth = async () => {
      let attempt = 0;
      let lastError = null;

      while (attempt <= maxRetries) {
        attempt += 1;
        try {
          const authData = await this._authenticateSingleAttempt(
            resolvedUserId,
            resolvedUserType,
            timeoutMs,
            { forceRefreshToken },
          );
          return authData;
        } catch (error) {
          lastError = error;
          const errorCode = error?.code || error?.payload?.code || null;
          const retryAfterSec = Number(
            error?.retryAfterSec || error?.payload?.retryAfterSec || 0,
          );
          const canRetry = errorCode === "AUTH_BUSY" && attempt <= maxRetries;

          if (!canRetry) {
            throw error;
          }

          const retryDelayMs = Math.max(
            250,
            (retryAfterSec > 0 ? retryAfterSec * 1000 : 1000) +
              Math.floor(Math.random() * AUTH_BUSY_JITTER_MS),
          );

          Logger.warn(
            `⚠️ [WebSocketManager] Auth em alta carga (AUTH_BUSY). Retry ${attempt}/${maxRetries} em ${retryDelayMs}ms`,
          );
          await sleepMs(retryDelayMs);
        }
      }

      throw (
        lastError ||
        buildSocketError(
          {
            code: "AUTH_RETRY_EXHAUSTED",
            message: "Falha ao autenticar após retries",
          },
          "Nao foi possivel validar sua sessao agora. Tente novamente.",
          "auth",
        )
      );
    };

    this.authAckInFlightKey = requestKey;
    this.authAckInFlight = runAuth().finally(() => {
      if (this.authAckInFlightKey === requestKey) {
        this.authAckInFlight = null;
        this.authAckInFlightKey = null;
      }
    });
    return this.authAckInFlight;
  }

  _authenticateSingleAttempt(userId, userType, timeoutMs, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.socket?.connected) {
        reject(
          buildSocketError(
            { code: "WS_DISCONNECTED", message: "WebSocket nao conectado" },
            "Sem conexao com o servidor agora. Verifique sua internet e tente novamente.",
            "auth",
          ),
        );
        return;
      }

      const cleanup = () => {
        this.off("authenticated", onAuthenticated);
        this.off("auth_error", onAuthError);
        this.off("authentication_error", onAuthenticationError);
        clearTimeout(timeout);
      };

      const completeWithError = (
        payload,
        fallbackMessage = "Nao foi possivel validar sua sessao agora. Tente novamente.",
      ) => {
        cleanup();
        const error = buildSocketError(payload, fallbackMessage, "auth");
        if (payload?.retryAfterSec) {
          error.retryAfterSec = payload.retryAfterSec;
        }
        reject(error);
      };

      const onAuthenticated = (data) => {
        if (data?.uid && data.uid !== userId) {
          return;
        }

        if (!data?.success) {
          completeWithError(data);
          return;
        }

        cleanup();
        resolve(data);
      };

      const onAuthError = (payload) => {
        completeWithError(payload);
      };

      const onAuthenticationError = (payload) => {
        completeWithError(payload);
      };

      const timeout = setTimeout(() => {
        completeWithError(
          {
            code: "AUTH_TIMEOUT",
            message: `Timeout de autenticacao (${Math.floor(timeoutMs / 1000)}s)`,
          },
          "A validacao da sessao demorou mais que o esperado. Tente novamente.",
        );
      }, timeoutMs);

      this.on("authenticated", onAuthenticated);
      this.on("auth_error", onAuthError);
      this.on("authentication_error", onAuthenticationError);
      Promise.resolve(
        this.authenticate(userId, userType, {
          force: true,
          forceRefreshToken: options?.forceRefreshToken === true,
        }),
      ).catch((error) => {
        completeWithError(
          {
            code: "AUTH_EMIT_ERROR",
            message: error?.message || "Falha ao iniciar autenticacao",
          },
          "Nao foi possivel iniciar a validacao da sua sessao.",
        );
      });
    });
  }

  _buildCreateBookingIdempotencyKey(bookingData = {}, requestId = "") {
    const customerId =
      bookingData?.customerId ||
      this.authenticatedUserId ||
      this.authCredentials?.userId ||
      "anonymous";
    const stablePaymentReference = String(
      bookingData?.paymentId ||
        bookingData?.paymentData?.chargeId ||
        bookingData?.paymentData?.paymentId ||
        "",
    ).trim();

    if (stablePaymentReference) {
      return `mobile_${customerId}_payment_${stablePaymentReference}`;
    }

    const pickupLat = Number(bookingData?.pickupLocation?.lat || 0).toFixed(5);
    const pickupLng = Number(bookingData?.pickupLocation?.lng || 0).toFixed(5);
    const destinationLat = Number(
      bookingData?.destinationLocation?.lat || 0,
    ).toFixed(5);
    const destinationLng = Number(
      bookingData?.destinationLocation?.lng || 0,
    ).toFixed(5);
    const fare = Number(bookingData?.estimatedFare || 0).toFixed(2);
    const carType = String(bookingData?.carType || "standard").toLowerCase();

    const digestSource = `${customerId}|${pickupLat}|${pickupLng}|${destinationLat}|${destinationLng}|${carType}|${fare}|${requestId}`;
    let digest = 0;
    for (let i = 0; i < digestSource.length; i += 1) {
      digest = (digest << 5) - digest + digestSource.charCodeAt(i);
      digest |= 0;
    }

    return `mobile_${customerId}_${requestId}_${Math.abs(digest).toString(36)}`;
  }

  _isCreateBookingRetryable(error) {
    const code = String(
      error?.code || error?.payload?.code || "",
    ).toUpperCase();
    if (CREATE_BOOKING_RETRYABLE_CODES.has(code)) {
      return true;
    }

    const rawMessage = String(
      error?.message || error?.rawMessage || error?.payload?.message || "",
    ).toLowerCase();

    return (
      rawMessage.includes("timeout ao criar booking") ||
      rawMessage.includes("create booking timeout") ||
      rawMessage.includes("websocket") ||
      rawMessage.includes("desconect")
    );
  }

  _extractCreateBookingRetryDelayMs(error, attempt) {
    const retryAfterSec = Number(
      error?.retryAfterSec || error?.payload?.retryAfterSec || 0,
    );
    const retryAfterDelayMs = retryAfterSec > 0 ? retryAfterSec * 1000 : 0;
    const progressiveDelayMs = Math.min(
      CREATE_BOOKING_RETRY_BASE_DELAY_MS * Math.max(1, attempt),
      5000,
    );
    const baseDelayMs = Math.max(retryAfterDelayMs, progressiveDelayMs);
    return (
      baseDelayMs + Math.floor(Math.random() * CREATE_BOOKING_RETRY_JITTER_MS)
    );
  }

  async _recoverCreateBookingFromSync(idempotencyKey) {
    if (
      !this.socket?.connected ||
      !this.authenticatedUserId ||
      !this.authenticatedUserType
    ) {
      return null;
    }

    try {
      const syncSnapshot = await this.syncActiveRideWithAck(
        Math.max(ACTIVE_RIDE_SYNC_TIMEOUT_MS, 12000),
      );

      if (
        !syncSnapshot?.success ||
        !syncSnapshot?.hasActiveRide ||
        !syncSnapshot?.bookingId
      ) {
        return null;
      }

      Logger.warn(
        "⚠️ [WebSocketManager] createBooking reconciliado via syncActiveRide",
        {
          bookingId: syncSnapshot.bookingId,
          idempotencyKey,
        },
      );

      return {
        success: true,
        bookingId: syncSnapshot.bookingId,
        idempotencyKey,
        rehydrated: true,
        message: "Corrida recuperada após reconexão",
        data: {
          bookingId: syncSnapshot.bookingId,
          customerId: syncSnapshot.customerId || this.authenticatedUserId,
          status: String(syncSnapshot.status || "SEARCHING").toLowerCase(),
          rehydrated: true,
        },
      };
    } catch (syncError) {
      Logger.warn(
        "⚠️ [WebSocketManager] Falha ao reconciliar createBooking via syncActiveRide:",
        syncError?.message || syncError,
      );
      return null;
    }
  }

  _createBookingSingleAttempt(bookingData) {
    return new Promise((resolve, reject) => {
      let timeout = null;

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        this.off("bookingCreated", onBookingCreated);
        this.off("bookingError", onBookingError);
      };

      const onBookingCreated = (data) => {
        const responseCustomerId =
          data?.customerId ||
          data?.data?.customerId ||
          data?.booking?.customerId;
        if (
          bookingData?.customerId &&
          responseCustomerId &&
          responseCustomerId !== bookingData.customerId
        ) {
          return;
        }

        Logger.log(
          "✅ [WebSocketManager] Resposta bookingCreated recebida:",
          data,
        );
        cleanup();
        if (data?.success) {
          resolve(data);
          return;
        }

        const error = buildSocketError(
          data,
          "Nao foi possivel solicitar a viagem agora.",
          "booking",
        );
        Logger.error(
          "❌ [WebSocketManager] Erro na resposta:",
          error.message,
          error.code || "SEM_CODE",
        );
        reject(error);
      };

      const onBookingError = (errorPayload) => {
        Logger.error("❌ [WebSocketManager] Erro do servidor:", errorPayload);
        cleanup();
        const error = buildSocketError(
          errorPayload,
          "Nao foi possivel solicitar a viagem agora.",
          "booking",
        );
        if (errorPayload?.retryAfterSec) {
          error.retryAfterSec = errorPayload.retryAfterSec;
        }
        reject(error);
      };

      timeout = setTimeout(() => {
        Logger.error(
          `❌ [WebSocketManager] Timeout ao criar booking (${CREATE_BOOKING_TIMEOUT_MS}ms)`,
        );
        cleanup();
        reject(
          buildSocketError(
            { code: "BOOKING_TIMEOUT", message: "Create booking timeout" },
            "Estamos com alta demanda no momento. Tente solicitar a viagem novamente.",
            "booking",
          ),
        );
      }, CREATE_BOOKING_TIMEOUT_MS);

      this.on("bookingCreated", onBookingCreated);
      this.on("bookingError", onBookingError);

      Logger.log("📤 [WebSocketManager] Emitindo evento createBooking...");
      this.socket.emit("createBooking", bookingData);
    });
  }

  // Métodos específicos para eventos de viagem
  async createBooking(bookingData, options = {}) {
    const maxRetries = Number.isFinite(options?.maxRetries)
      ? Math.max(0, options.maxRetries)
      : CREATE_BOOKING_MAX_RETRIES;
    const telemetryContext = this._resolveRideTelemetryContext(
      options?.telemetryContext,
      null,
    );
    const requestId =
      options?.requestId ||
      `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const idempotencyKey =
      options?.idempotencyKey ||
      bookingData?.idempotencyKey ||
      this._buildCreateBookingIdempotencyKey(bookingData, requestId);
    const payload = {
      ...bookingData,
      rideCostTelemetry:
        bookingData?.rideCostTelemetry ||
        rideCostTelemetryService.buildCreateBookingPayload(telemetryContext),
      idempotencyKey,
      clientRequestId: requestId,
    };

    Logger.log("📤 [WebSocketManager] Criando booking...", {
      connected: this.socket?.connected,
      socketId: this.socket?.id,
      idempotencyKey,
      bookingData: {
        customerId: payload.customerId,
        carType: payload.carType,
        estimatedFare: payload.estimatedFare,
      },
    });

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      const attemptStartedAt = Date.now();
      this._recordRideTelemetryCommand(
        "createBooking",
        {
          phase: "attempt",
          metadata: {
            attempt,
            requestId,
            idempotencyKey,
          },
        },
        telemetryContext,
      );
      try {
        if (!this.socket?.connected) {
          await this.connect();
        }

        if (!this.isAuthenticated) {
          const authUserId =
            this.authCredentials?.userId ||
            payload.customerId ||
            this.authenticatedUserId;
          const authUserType =
            this.authCredentials?.userType ||
            this.authenticatedUserType ||
            "customer";

          if (authUserId) {
            await this.authenticateWithAck(
              authUserId,
              authUserType,
              AUTH_ACK_DEFAULT_TIMEOUT_MS,
              { maxRetries: AUTH_BUSY_MAX_RETRIES },
            );
          }
        }

        if (attempt > 1) {
          Logger.warn(
            `🔁 [WebSocketManager] Retry createBooking (${attempt}/${maxRetries + 1})`,
            {
              idempotencyKey,
            },
          );
        }

        const response = await this._createBookingSingleAttempt(payload);
        const resolvedBookingId =
          response?.bookingId ||
          response?.data?.bookingId ||
          response?.booking?.bookingId ||
          null;
        const boundTelemetryContext = resolvedBookingId
          ? rideCostTelemetryService.bindContextToBooking({
              ...telemetryContext,
              bookingId: resolvedBookingId,
            }) || telemetryContext
          : telemetryContext;

        this._recordRideTelemetryCommand(
          "createBooking",
          {
            phase: "success",
            latencyMs: Date.now() - attemptStartedAt,
            metadata: {
              attempt,
              requestId,
              idempotencyKey,
            },
          },
          boundTelemetryContext,
          resolvedBookingId,
        );
        rideCostTelemetryService.persistContextSoon(boundTelemetryContext);
        rideCostTelemetryService.flushContextSoon(boundTelemetryContext);
        this._clearAvailabilityCache();

        return {
          ...response,
          idempotencyKey: response?.idempotencyKey || idempotencyKey,
        };
      } catch (error) {
        lastError = error;
        this._recordRideTelemetryCommand(
          "createBooking",
          {
            phase: "error",
            latencyMs: Date.now() - attemptStartedAt,
            errorCode: error?.code || null,
            metadata: {
              attempt,
              requestId,
              idempotencyKey,
            },
          },
          telemetryContext,
        );
        const retryable = this._isCreateBookingRetryable(error);

        if (retryable) {
          const recovered =
            await this._recoverCreateBookingFromSync(idempotencyKey);
          if (recovered) {
            const recoveredBookingId =
              recovered?.bookingId ||
              recovered?.data?.bookingId ||
              recovered?.booking?.bookingId ||
              null;
            const recoveredTelemetryContext = recoveredBookingId
              ? rideCostTelemetryService.bindContextToBooking({
                  ...telemetryContext,
                  bookingId: recoveredBookingId,
                }) || telemetryContext
              : telemetryContext;
            this._recordRideTelemetryCommand(
              "createBooking",
              {
                phase: "success",
                latencyMs: Date.now() - attemptStartedAt,
                metadata: {
                  attempt,
                  requestId,
                  idempotencyKey,
                  recoveredFromSync: true,
                },
              },
              recoveredTelemetryContext,
              recoveredBookingId,
            );
            rideCostTelemetryService.persistContextSoon(
              recoveredTelemetryContext,
            );
            rideCostTelemetryService.flushContextSoon(
              recoveredTelemetryContext,
            );
            this._clearAvailabilityCache();
            return recovered;
          }
        }

        const hasMoreAttempts = attempt <= maxRetries;
        if (!retryable || !hasMoreAttempts) {
          throw error;
        }

        const retryDelayMs = this._extractCreateBookingRetryDelayMs(
          error,
          attempt,
        );
        Logger.warn(
          `⚠️ [WebSocketManager] createBooking falhou (${error?.code || "SEM_CODE"}). Nova tentativa em ${retryDelayMs}ms`,
          { idempotencyKey },
        );
        await sleepMs(retryDelayMs);
      }
    }

    throw (
      lastError ||
      buildSocketError(
        {
          code: "BOOKING_RETRY_EXHAUSTED",
          message: "Falha ao criar booking apos retries",
        },
        "Nao foi possivel solicitar a viagem agora. Tente novamente em instantes.",
        "booking",
      )
    );
  }

  async checkRideAvailability(payload = {}, options = {}) {
    const timeoutMs = Number.isFinite(options?.timeoutMs)
      ? options.timeoutMs
      : 12000;
    const requestId =
      String(options?.requestId || payload?.requestId || "").trim() ||
      createSocketRequestId("availability");
    const telemetryContext = this._resolveRideTelemetryContext(
      options?.telemetryContext,
      null,
    );
    const forceRefresh = options?.forceRefresh === true;
    const cacheKey = this._buildAvailabilityCacheKey(payload);
    if (forceRefresh) {
      this.availabilityRequestCache.delete(cacheKey);
      this.availabilityInFlight.delete(cacheKey);
    }
    const cachedResult = !forceRefresh
      ? this._getCachedAvailabilityResult(cacheKey)
      : null;

    if (cachedResult) {
      return cachedResult;
    }

    if (!forceRefresh && this.availabilityInFlight.has(cacheKey)) {
      return this.availabilityInFlight.get(cacheKey);
    }

    if (!this.socket?.connected) {
      await this.connect();
    }

    if (!this.isAuthenticated) {
      const authUserId =
        this.authCredentials?.userId ||
        payload.customerId ||
        this.authenticatedUserId;
      const authUserType =
        this.authCredentials?.userType ||
        this.authenticatedUserType ||
        "customer";

      if (authUserId) {
        await this.authenticateWithAck(
          authUserId,
          authUserType,
          AUTH_ACK_DEFAULT_TIMEOUT_MS,
          { maxRetries: AUTH_BUSY_MAX_RETRIES },
        );
      }
    }

    const availabilityPromise = new Promise((resolve, reject) => {
      let timeout = null;
      const startedAt = Date.now();

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        this.off("rideAvailabilityResult", onSuccess);
        this.off("rideAvailabilityError", onError);
      };

      const onSuccess = (data) => {
        if (data?.requestId && data.requestId !== requestId) {
          return;
        }
        cleanup();
        if (data?.success) {
          this._setCachedAvailabilityResult(cacheKey, data);
          this._recordRideTelemetryCommand(
            "checkRideAvailability",
            {
              phase: "success",
              latencyMs: Date.now() - startedAt,
              metadata: {
                requestId,
              },
            },
            telemetryContext,
          );
          resolve(data);
          return;
        }
        this._recordRideTelemetryCommand(
          "checkRideAvailability",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: data?.code || null,
            metadata: {
              requestId,
            },
          },
          telemetryContext,
        );
        reject(
          buildSocketError(
            data,
            "Nao foi possivel validar a disponibilidade agora.",
            "availability",
          ),
        );
      };

      const onError = (errorPayload) => {
        if (errorPayload?.requestId && errorPayload.requestId !== requestId) {
          return;
        }
        cleanup();
        this._recordRideTelemetryCommand(
          "checkRideAvailability",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: errorPayload?.code || null,
            metadata: {
              requestId,
            },
          },
          telemetryContext,
        );
        reject(
          buildSocketError(
            errorPayload,
            "Nao foi possivel validar a disponibilidade agora.",
            "availability",
          ),
        );
      };

      timeout = setTimeout(() => {
        cleanup();
        this._recordRideTelemetryCommand(
          "checkRideAvailability",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: "AVAILABILITY_TIMEOUT",
            metadata: {
              requestId,
            },
          },
          telemetryContext,
        );
        reject(
          buildSocketError(
            {
              code: "AVAILABILITY_TIMEOUT",
              message: "Ride availability timeout",
            },
            "Nao foi possivel validar a disponibilidade agora.",
            "availability",
          ),
        );
      }, timeoutMs);

      this.on("rideAvailabilityResult", onSuccess);
      this.on("rideAvailabilityError", onError);
      this._recordRideTelemetryCommand(
        "checkRideAvailability",
        {
          phase: "attempt",
          metadata: {
            requestId,
          },
        },
        telemetryContext,
      );
      this.socket.emit("checkRideAvailability", {
        ...payload,
        requestId,
      });
    });

    this.availabilityInFlight.set(cacheKey, availabilityPromise);

    return availabilityPromise.finally(() => {
      if (this.availabilityInFlight.get(cacheKey) === availabilityPromise) {
        this.availabilityInFlight.delete(cacheKey);
      }
    });
  }

  async driverResponse(bookingId, accepted, reason = null) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Driver response timeout"));
      }, 10000);

      if (accepted) {
        // ✅ NOVO: Listener para erro
        const errorHandler = (error) => {
          clearTimeout(timeout);
          this.socket.off("rideAccepted", successHandler);
          this.socket.off("acceptRideError", errorHandler);
          reject(
            new Error(error.error || error.message || "Driver response failed"),
          );
        };

        // ✅ Listener para sucesso
        const successHandler = (data) => {
          clearTimeout(timeout);
          this.socket.off("rideAccepted", successHandler);
          this.socket.off("acceptRideError", errorHandler);
          if (data.success !== false && !data.error) {
            resolve(data);
          } else {
            reject(new Error(data.error || "Driver response failed"));
          }
        };

        // Configurar listeners ANTES de emitir
        this.socket.on("rideAccepted", successHandler);
        this.socket.on("acceptRideError", errorHandler); // ✅ NOVO
      } else {
        // ✅ NOVO: Listener para erro
        const errorHandler = (error) => {
          clearTimeout(timeout);
          this.socket.off("rideRejected", successHandler);
          this.socket.off("rejectRideError", errorHandler);
          reject(
            new Error(error.error || error.message || "Driver response failed"),
          );
        };

        // ✅ Listener para sucesso
        const successHandler = (data) => {
          clearTimeout(timeout);
          this.socket.off("rideRejected", successHandler);
          this.socket.off("rejectRideError", errorHandler);
          if (data.success !== false && !data.error) {
            resolve(data);
          } else {
            reject(new Error(data.error || "Driver response failed"));
          }
        };

        // Configurar listeners ANTES de emitir
        this.socket.on("rideRejected", successHandler);
        this.socket.on("rejectRideError", errorHandler); // ✅ NOVO
      }

      // Emitir após configurar listeners
      this.socket.emit("driverResponse", { bookingId, accepted, reason });
    });
  }

  // Motorista aceitar corrida (método direto)
  async acceptRide(rideId, driverData = {}) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const telemetryContext = this._resolveRideTelemetryContext(
        driverData?.telemetryContext,
        rideId,
      );
      const { telemetryContext: _ignoredTelemetryContext, ...driverPayload } =
        driverData || {};
      const startedAt = Date.now();
      const expectedRideId = String(rideId || "").trim();
      const expectedDriverId = String(
        driverData?.driver?.id ||
          driverData?.driverId ||
          this.authenticatedUserId ||
          "",
      ).trim();
      const timeout = setTimeout(() => {
        this.socket.off("rideAccepted", successHandler);
        this.socket.off("acceptRideError", errorHandler);
        this._recordRideTelemetryCommand(
          "acceptRide",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: "ACCEPT_RIDE_TIMEOUT",
          },
          telemetryContext,
          rideId,
        );
        reject(new Error("Accept ride timeout"));
      }, 15000);

      // ✅ NOVO: Listener para erro (se validação falhar no servidor)
      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.off("rideAccepted", successHandler);
        this.socket.off("acceptRideError", errorHandler);
        this._recordRideTelemetryCommand(
          "acceptRide",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: error?.code || null,
          },
          telemetryContext,
          rideId,
        );
        reject(new Error(error.error || error.message || "Accept ride failed"));
      };

      // ✅ Listener para sucesso
      const successHandler = (data) => {
        const payloadRideId = String(
          data?.bookingId || data?.rideId || "",
        ).trim();
        const payloadDriverId = String(
          data?.driver?.id || data?.driverId || "",
        ).trim();

        if (
          expectedRideId &&
          payloadRideId &&
          payloadRideId !== expectedRideId
        ) {
          return;
        }

        if (
          expectedDriverId &&
          payloadDriverId &&
          payloadDriverId !== expectedDriverId
        ) {
          return;
        }

        clearTimeout(timeout);
        this.socket.off("rideAccepted", successHandler);
        this.socket.off("acceptRideError", errorHandler);
        if (data.success !== false && !data.error) {
          this._recordRideTelemetryCommand(
            "acceptRide",
            {
              phase: "success",
              latencyMs: Date.now() - startedAt,
            },
            telemetryContext,
            rideId,
          );
          resolve(data);
        } else {
          this._recordRideTelemetryCommand(
            "acceptRide",
            {
              phase: "error",
              latencyMs: Date.now() - startedAt,
              errorCode: data?.code || null,
            },
            telemetryContext,
            rideId,
          );
          reject(new Error(data.error || "Accept ride failed"));
        }
      };

      // Configurar listeners ANTES de emitir (evita race condition)
      this.socket.on("rideAccepted", successHandler);
      this.socket.on("acceptRideError", errorHandler); // ✅ NOVO

      // Emitir após configurar listeners
      this._recordRideTelemetryCommand(
        "acceptRide",
        {
          phase: "attempt",
        },
        telemetryContext,
        rideId,
      );
      this.socket.emit("acceptRide", { rideId, ...driverPayload });
    });
  }

  // Motorista rejeitar corrida (método direto)
  async rejectRide(rideId, reason = "Motorista indisponível") {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const telemetryContext = this._resolveRideTelemetryContext({}, rideId);
      const startedAt = Date.now();
      const timeout = setTimeout(() => {
        this._recordRideTelemetryCommand(
          "rejectRide",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: "REJECT_RIDE_TIMEOUT",
          },
          telemetryContext,
          rideId,
        );
        reject(new Error("Reject ride timeout"));
      }, 10000);

      // ✅ NOVO: Listener para erro (se validação falhar no servidor)
      const errorHandler = (error) => {
        clearTimeout(timeout);
        this.socket.off("rideRejected", successHandler);
        this.socket.off("rejectRideError", errorHandler);
        this._recordRideTelemetryCommand(
          "rejectRide",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: error?.code || null,
          },
          telemetryContext,
          rideId,
        );
        reject(new Error(error.error || error.message || "Reject ride failed"));
      };

      // ✅ Listener para sucesso
      const successHandler = (data) => {
        clearTimeout(timeout);
        this.socket.off("rideRejected", successHandler);
        this.socket.off("rejectRideError", errorHandler);
        if (data.success !== false && !data.error) {
          this._recordRideTelemetryCommand(
            "rejectRide",
            {
              phase: "success",
              latencyMs: Date.now() - startedAt,
            },
            telemetryContext,
            rideId,
          );
          resolve(data);
        } else {
          this._recordRideTelemetryCommand(
            "rejectRide",
            {
              phase: "error",
              latencyMs: Date.now() - startedAt,
              errorCode: data?.code || null,
            },
            telemetryContext,
            rideId,
          );
          reject(new Error(data.error || "Reject ride failed"));
        }
      };

      // Configurar listeners ANTES de emitir (evita race condition)
      this.socket.on("rideRejected", successHandler);
      this.socket.on("rejectRideError", errorHandler); // ✅ NOVO

      // Emitir após configurar listeners
      this._recordRideTelemetryCommand(
        "rejectRide",
        {
          phase: "attempt",
        },
        telemetryContext,
        rideId,
      );
      this.socket.emit("rejectRide", { rideId, reason });
    });
  }

  async sendNotificationAction(action, bookingId, payload = {}) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    const normalizedAction = String(action || "").trim();
    const normalizedBookingId = String(
      bookingId || payload?.bookingId || payload?.rideId || "",
    ).trim();

    if (!normalizedAction) {
      throw new Error("Ação obrigatória para notificação");
    }

    if (!normalizedBookingId) {
      throw new Error("bookingId obrigatório para ação de notificação");
    }

    const normalizedActionKey = normalizedAction.toLowerCase();
    if (normalizedActionKey === "start_trip") {
      const result = await this.startTrip(
        normalizedBookingId,
        payload?.startLocation || payload?.location || null,
      );
      return {
        ...(result || {}),
        success: result?.success !== false,
        bookingId: normalizedBookingId,
        action: normalizedAction,
      };
    }

    if (normalizedActionKey === "end_trip") {
      const result = await this.completeTrip(
        normalizedBookingId,
        payload?.endLocation || payload?.location || null,
        payload?.distance,
        payload?.fare,
      );
      return {
        ...(result || {}),
        success: result?.success !== false,
        bookingId: normalizedBookingId,
        action: normalizedAction,
      };
    }

    if (normalizedActionKey === "cancel_ride") {
      const result = await this.cancelRide(
        normalizedBookingId,
        payload?.reason || "Cancelado pela notificação",
        payload?.cancellationFee || 0,
      );
      return {
        ...(result || {}),
        success: result?.success !== false,
        bookingId: normalizedBookingId,
        action: normalizedAction,
      };
    }

    return new Promise((resolve, reject) => {
      const telemetryContext = this._resolveRideTelemetryContext(
        {},
        normalizedBookingId,
      );
      const startedAt = Date.now();
      let timeout;

      const matchesResponse = (data) => {
        const responseBookingId = String(
          data?.bookingId || data?.rideId || "",
        ).trim();
        if (responseBookingId && responseBookingId !== normalizedBookingId) {
          return false;
        }

        const responseAction = String(data?.action || "").trim().toLowerCase();
        if (responseAction && responseAction !== normalizedActionKey) {
          return false;
        }

        return Boolean(responseBookingId || responseAction);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off("notificationActionSuccess", onSuccess);
        this.off("notificationActionError", onError);
      };

      const onSuccess = (data) => {
        if (!matchesResponse(data)) {
          return;
        }

        cleanup();
        if (data?.success === false || data?.error) {
          this._recordRideTelemetryCommand(
            "notificationAction",
            {
              action: normalizedAction,
              phase: "error",
              latencyMs: Date.now() - startedAt,
              errorCode: data?.code || null,
            },
            telemetryContext,
            normalizedBookingId,
          );
          reject(new Error(data?.error || "Notification action failed"));
          return;
        }

        this._recordRideTelemetryCommand(
          "notificationAction",
          {
            action: normalizedAction,
            phase: "success",
            latencyMs: Date.now() - startedAt,
          },
          telemetryContext,
          normalizedBookingId,
        );
        resolve({
          success: true,
          bookingId: normalizedBookingId,
          action: normalizedAction,
          ...data,
        });
      };

      const onError = (error) => {
        if (!matchesResponse(error)) {
          return;
        }

        cleanup();
        this._recordRideTelemetryCommand(
          "notificationAction",
          {
            action: normalizedAction,
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: error?.code || null,
          },
          telemetryContext,
          normalizedBookingId,
        );
        reject(
          new Error(
            error?.error || error?.message || "Notification action failed",
          ),
        );
      };

      timeout = setTimeout(() => {
        cleanup();
        this._recordRideTelemetryCommand(
          "notificationAction",
          {
            action: normalizedAction,
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: "NOTIFICATION_ACTION_TIMEOUT",
          },
          telemetryContext,
          normalizedBookingId,
        );
        reject(new Error("Notification action timeout"));
      }, 10000);

      this.on("notificationActionSuccess", onSuccess);
      this.on("notificationActionError", onError);
      this._recordRideTelemetryCommand(
        "notificationAction",
        {
          action: normalizedAction,
          phase: "attempt",
        },
        telemetryContext,
        normalizedBookingId,
      );
      this.socket.emit("notificationAction", {
        ...payload,
        action: normalizedAction,
        bookingId: normalizedBookingId,
      });
    });
  }

  // Motorista chegou ao pickup
  async arriveAtPickup(rideId, location, options = {}) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const telemetryContext = this._resolveRideTelemetryContext({}, rideId);
      const startedAt = Date.now();
      const timeout = setTimeout(() => {
        this._recordRideTelemetryCommand(
          "arriveAtPickup",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: "ARRIVE_AT_PICKUP_TIMEOUT",
          },
          telemetryContext,
          rideId,
        );
        reject(new Error("Arrive at pickup timeout"));
      }, 10000);

      const bookingId = rideId;
      const requestId =
        String(options?.requestId || "").trim() ||
        createSocketRequestId("arrive_at_pickup");
      const lifecycleMetadata = buildRideLifecycleCommandMetadata(options);

      const cleanup = () => {
        clearTimeout(timeout);
        this.off("arrivedAtPickup", onArrivedAtPickup);
        this.off("notificationActionSuccess", onNotificationSuccess);
        this.off("notificationActionError", onNotificationError);
      };

      const onArrivedAtPickup = (data) => {
        if (data?.bookingId && bookingId && data.bookingId !== bookingId) {
          return;
        }
        cleanup();
        if (data?.success === false || data?.error) {
          this._recordRideTelemetryCommand(
            "arriveAtPickup",
            {
              phase: "error",
              latencyMs: Date.now() - startedAt,
              errorCode: data?.code || null,
            },
            telemetryContext,
            bookingId,
          );
          reject(new Error(data?.error || "Arrive at pickup failed"));
          return;
        }
        this._recordRideTelemetryCommand(
          "arriveAtPickup",
          {
            phase: "success",
            latencyMs: Date.now() - startedAt,
          },
          telemetryContext,
          bookingId,
        );
        resolve(data || { success: true, bookingId });
      };

      const onNotificationSuccess = (data) => {
        if (String(data?.action || "").toLowerCase() !== "arrived_at_pickup") {
          return;
        }
        if (data?.bookingId && bookingId && data.bookingId !== bookingId) {
          return;
        }
        cleanup();
        this._recordRideTelemetryCommand(
          "arriveAtPickup",
          {
            phase: "success",
            latencyMs: Date.now() - startedAt,
          },
          telemetryContext,
          bookingId,
        );
        resolve({
          success: true,
          bookingId,
          ...data,
        });
      };

      const onNotificationError = (error) => {
        cleanup();
        this._recordRideTelemetryCommand(
          "arriveAtPickup",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: error?.code || null,
          },
          telemetryContext,
          bookingId,
        );
        reject(
          new Error(
            error?.error || error?.message || "Arrive at pickup failed",
          ),
        );
      };

      this.on("arrivedAtPickup", onArrivedAtPickup);
      this.on("notificationActionSuccess", onNotificationSuccess);
      this.on("notificationActionError", onNotificationError);
      this._recordRideTelemetryCommand(
        "arriveAtPickup",
        {
          phase: "attempt",
        },
        telemetryContext,
        bookingId,
      );
      this.socket.emit("notificationAction", {
        action: "arrived_at_pickup",
        bookingId,
        location,
        requestId,
        ...lifecycleMetadata,
      });
    });
  }

  async confirmBoardingStatus(bookingId, boarded = true) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }
    if (!bookingId) {
      throw new Error("bookingId obrigatório para confirmar embarque");
    }

    return new Promise((resolve, reject) => {
      const telemetryContext = this._resolveRideTelemetryContext({}, bookingId);
      const startedAt = Date.now();
      const timeout = setTimeout(() => {
        cleanup();
        this._recordRideTelemetryCommand(
          "confirmBoardingStatus",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: "CONFIRM_BOARDING_TIMEOUT",
          },
          telemetryContext,
          bookingId,
        );
        reject(new Error("Confirm boarding status timeout"));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeout);
        this.off("boardingStatusConfirmed", onSuccess);
        this.off("boardingStatusError", onError);
      };

      const onSuccess = (data) => {
        if (data?.bookingId && String(data.bookingId) !== String(bookingId)) {
          return;
        }
        cleanup();
        if (data?.success === false || data?.error) {
          this._recordRideTelemetryCommand(
            "confirmBoardingStatus",
            {
              phase: "error",
              latencyMs: Date.now() - startedAt,
              errorCode: data?.code || null,
            },
            telemetryContext,
            bookingId,
          );
          reject(new Error(data?.error || "Boarding confirmation failed"));
          return;
        }
        this._recordRideTelemetryCommand(
          "confirmBoardingStatus",
          {
            phase: "success",
            latencyMs: Date.now() - startedAt,
          },
          telemetryContext,
          bookingId,
        );
        resolve(
          data || { success: true, bookingId, boarded: Boolean(boarded) },
        );
      };

      const onError = (error) => {
        cleanup();
        this._recordRideTelemetryCommand(
          "confirmBoardingStatus",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: error?.code || null,
          },
          telemetryContext,
          bookingId,
        );
        reject(
          new Error(
            error?.error || error?.message || "Boarding confirmation failed",
          ),
        );
      };

      this.on("boardingStatusConfirmed", onSuccess);
      this.on("boardingStatusError", onError);
      this._recordRideTelemetryCommand(
        "confirmBoardingStatus",
        {
          phase: "attempt",
        },
        telemetryContext,
        bookingId,
      );
      this.socket.emit("confirmBoardingStatus", {
        bookingId,
        boarded: Boolean(boarded),
      });
    });
  }

  async startTrip(bookingId, startLocation, options = {}) {
    const requestId =
      String(options?.requestId || "").trim() ||
      createSocketRequestId("start_trip");
    const lifecycleMetadata = buildRideLifecycleCommandMetadata(options);
    return this._emitLifecycleCommandWithAck({
      commandName: "startTrip",
      eventName: "startTrip",
      successEvent: "tripStarted",
      errorEvent: "tripStartError",
      bookingId,
      timeoutMs: 10000,
      fallbackErrorMessage: "Não foi possível iniciar a corrida",
      payload: {
        bookingId,
        startLocation,
        requestId,
        ...lifecycleMetadata,
      },
    });
  }

  // Atualizar localização durante corrida
  async updateTripLocation(bookingId, lat, lng, heading = 0, speed = 0) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    this._recordRideTelemetryCommand(
      "updateTripLocation",
      {
        phase: "emit",
      },
      {},
      bookingId,
    );
    this.socket.emit("updateTripLocation", {
      bookingId,
      lat,
      lng,
      heading,
      speed,
    });
  }

  async completeTrip(bookingId, endLocation, distance, fare, options = {}) {
    const requestId =
      String(options?.requestId || "").trim() ||
      createSocketRequestId("complete_trip");
    const lifecycleMetadata = buildRideLifecycleCommandMetadata(options);
    return this._emitLifecycleCommandWithAck({
      commandName: "completeTrip",
      eventName: "completeTrip",
      successEvent: "tripCompleted",
      errorEvent: "tripCompleteError",
      bookingId,
      timeoutMs: 12000,
      fallbackErrorMessage: "Não foi possível encerrar a corrida",
      payload: {
        bookingId,
        endLocation,
        distance,
        fare,
        requestId,
        ...lifecycleMetadata,
      },
    });
  }

  async confirmPayment(bookingIdOrPayload, paymentMethod, paymentId, amount, options = {}) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    const payloadInput =
      bookingIdOrPayload && typeof bookingIdOrPayload === "object"
        ? bookingIdOrPayload
        : {
            bookingId: bookingIdOrPayload,
            paymentMethod,
            paymentId,
            amount,
            ...(options && typeof options === "object" ? options : {}),
          };
    const bookingId =
      payloadInput.bookingId ||
      payloadInput.rideId ||
      payloadInput.temporaryRideId;
    const resolvedPaymentMethod =
      payloadInput.paymentMethod || payloadInput.method || paymentMethod || "pix";
    const resolvedPaymentId =
      payloadInput.paymentId || payloadInput.chargeId || paymentId;
    const resolvedAmount = payloadInput.amount ?? amount;
    const confirmationPayload = {
      ...payloadInput,
      bookingId,
      paymentMethod: resolvedPaymentMethod,
      paymentId: resolvedPaymentId,
      amount: resolvedAmount,
    };

    if (!confirmationPayload.chargeId && resolvedPaymentId) {
      confirmationPayload.chargeId = resolvedPaymentId;
    }

    if (!confirmationPayload.rideId && confirmationPayload.temporaryRideId) {
      confirmationPayload.rideId = confirmationPayload.temporaryRideId;
    }

    return new Promise((resolve, reject) => {
      const telemetryContext = this._resolveRideTelemetryContext({}, bookingId);
      const startedAt = Date.now();
      let settled = false;
      let timeout = null;
      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
          timeout = null;
        }
        this.socket?.off?.("paymentConfirmed", handleConfirmed);
        this.socket?.off?.("paymentError", handleError);
      };
      const rejectWithPaymentError = (data, fallbackMessage) => {
        const error = new Error(data?.message || data?.error || fallbackMessage);
        if (data?.code) {
          error.code = data.code;
        }
        reject(error);
      };
      const handleConfirmed = (data) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (data.success) {
          this._recordRideTelemetryCommand(
            "confirmPayment",
            {
              phase: "success",
              latencyMs: Date.now() - startedAt,
            },
            telemetryContext,
            bookingId,
          );
          resolve(data);
        } else {
          this._recordRideTelemetryCommand(
            "confirmPayment",
            {
              phase: "error",
              latencyMs: Date.now() - startedAt,
              errorCode: data?.code || null,
            },
            telemetryContext,
            bookingId,
          );
          rejectWithPaymentError(data, "Confirm payment failed");
        }
      };
      const handleError = (data) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this._recordRideTelemetryCommand(
          "confirmPayment",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: data?.code || null,
          },
          telemetryContext,
          bookingId,
        );
        rejectWithPaymentError(data, "Confirm payment failed");
      };

      timeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        this._recordRideTelemetryCommand(
          "confirmPayment",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: "CONFIRM_PAYMENT_TIMEOUT",
          },
          telemetryContext,
          bookingId,
        );
        reject(new Error("Confirm payment timeout"));
      }, 10000);

      this._recordRideTelemetryCommand(
        "confirmPayment",
        {
          phase: "attempt",
        },
        telemetryContext,
        bookingId,
      );
      this.socket.once("paymentConfirmed", handleConfirmed);
      this.socket.once("paymentError", handleError);
      this.socket.emit("confirmPayment", confirmationPayload);
    });
  }

  // Submeter avaliação
  async submitRating(ratingData) {
    if (!this.socket?.connected) {
      throw buildSocketError(
        { code: "WS_DISCONNECTED", error: "WebSocket não conectado" },
        "WebSocket não conectado",
        "rating",
      );
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          buildSocketError(
            { code: "RATING_SUBMIT_TIMEOUT", error: "Submit rating timeout" },
            "Não foi possível enviar a avaliação agora.",
            "rating",
          ),
        );
      }, 15000);

      this.socket.emit("submitRating", ratingData);
      this.socket.once("ratingSubmitted", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(buildSocketError(data, "Não foi possível enviar a avaliação agora.", "rating"));
        }
      });
    });
  }

  // Buscar avaliações de uma viagem
  async getTripRatings(tripId) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Get trip ratings timeout"));
      }, 10000);

      this.socket.emit("getTripRatings", { tripId });
      this.socket.once("tripRatings", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Get trip ratings failed"));
        }
      });
    });
  }

  // Buscar avaliações de um usuário
  async getUserRatings(targetUserId, userType) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Get user ratings timeout"));
      }, 10000);

      this.socket.emit("getUserRatings", { targetUserId, userType });
      this.socket.once("userRatings", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Get user ratings failed"));
        }
      });
    });
  }

  // Verificar se usuário já avaliou uma viagem
  async hasUserRatedTrip(tripId, userType) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Has user rated trip timeout"));
      }, 10000);

      this.socket.emit("hasUserRatedTrip", { tripId, userType });
      this.socket.once("userRatedTrip", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Has user rated trip failed"));
        }
      });
    });
  }

  // ===== MÉTODOS DE CHAT =====

  // Criar ou buscar chat
  async createChat(chatData) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Create chat timeout"));
      }, 10000);

      const expectedChatId =
        chatData?.chatId || chatData?.bookingId || chatData?.tripId || chatData?.rideId || null;
      const matchesRequest = (data = {}) => {
        if (!expectedChatId || !data || typeof data !== "object") {
          return true;
        }
        const receivedId = data.chatId || data.bookingId || data.tripId || data.rideId;
        return !receivedId || String(receivedId) === String(expectedChatId);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("chat_created", onSuccess);
        this.socket.off("chatCreated", onSuccess);
        this.socket.off("chatError", onError);
      };
      const onSuccess = (data) => {
        if (!matchesRequest(data)) {
          return;
        }
        cleanup();
        if (data.success) {
          resolve(data);
        } else {
          reject(buildSocketError(data, "Create chat failed", "chat"));
        }
      };
      const onError = (data) => {
        if (!matchesRequest(data)) {
          return;
        }
        cleanup();
        reject(buildSocketError(data, "Create chat failed", "chat"));
      };

      this.socket.once("chatCreated", onSuccess);
      // Compatibilidade com payload/evento legado
      this.socket.once("chat_created", onSuccess);
      this.socket.once("chatError", onError);
      this.socket.emit("createChat", chatData);
    });
  }

  // Enviar mensagem
  async sendMessage(messageData) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Send message timeout"));
      }, 10000);

      const expectedChatId =
        messageData?.chatId || messageData?.bookingId || messageData?.tripId || messageData?.rideId || null;
      const matchesRequest = (data = {}) => {
        if (!expectedChatId || !data || typeof data !== "object") {
          return true;
        }
        const receivedId = data.chatId || data.bookingId || data.tripId || data.rideId;
        return !receivedId || String(receivedId) === String(expectedChatId);
      };
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("message_sent", onSuccess);
        this.socket.off("messageSent", onSuccess);
        this.socket.off("messageError", onError);
        this.socket.off("chatError", onError);
      };
      const onSuccess = (data) => {
        if (!matchesRequest(data)) {
          return;
        }
        cleanup();
        if (data.success) {
          resolve(data);
        } else {
          reject(buildSocketError(data, "Send message failed", "chat"));
        }
      };
      const onError = (data) => {
        if (!matchesRequest(data)) {
          return;
        }
        cleanup();
        reject(buildSocketError(data, "Send message failed", "chat"));
      };

      this.socket.once("messageSent", onSuccess);
      // Compatibilidade com payload/evento legado
      this.socket.once("message_sent", onSuccess);
      this.socket.once("messageError", onError);
      this.socket.once("chatError", onError);
      this.socket.emit("sendMessage", messageData);
    });
  }

  // Carregar mensagens do chat
  async loadChatMessages(chatId, page = 0, limit = 20) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Load messages timeout"));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("messages_loaded", onLoaded);
      };
      const onLoaded = (data) => {
        const responseChatId = data?.chatId || data?.bookingId || data?.tripId || data?.rideId;
        if (responseChatId && String(responseChatId) !== String(chatId)) {
          return;
        }
        cleanup();
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(buildSocketError(data, "Load messages failed", "chat"));
        }
      };
      this.socket.once("messages_loaded", onLoaded);
      this.socket.emit("load_messages", { chatId, page, limit });
    });
  }

  // Marcar mensagens como lidas
  async markMessagesAsRead(chatId, messageIds) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Mark messages read timeout"));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("messages_marked_read", onMarked);
      };
      const onMarked = (data) => {
        const responseChatId = data?.chatId || data?.bookingId || data?.tripId || data?.rideId;
        if (responseChatId && String(responseChatId) !== String(chatId)) {
          return;
        }
        cleanup();
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(buildSocketError(data, "Mark messages read failed", "chat"));
        }
      };
      this.socket.once("messages_marked_read", onMarked);
      this.socket.emit("mark_messages_read", { chatId, messageIds });
    });
  }

  // Definir status de digitação
  async setTypingStatus(chatId, isTyping) {
    if (!this.socket?.connected) {
      return;
    }

    if (isTyping) {
      this.socket.emit("typing_start", { chatId });
    } else {
      this.socket.emit("typing_stop", { chatId });
    }
  }

  // Buscar chats do usuário
  async getUserChats(limit = 20) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Get user chats timeout"));
      }, 10000);

      this.socket.emit("get_user_chats", { limit });
      this.socket.once("user_chats_loaded", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Get user chats failed"));
        }
      });
    });
  }

  // ===== MÉTODOS DE PROMOÇÕES =====

  // Buscar promoções disponíveis
  async getPromos(filters = {}, page = 0, limit = 20) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Get promos timeout"));
      }, 10000);

      this.socket.emit("get_promos", { filters, page, limit });
      this.socket.once("promos_loaded", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error));
        }
      });
    });
  }

  // Buscar promoções do usuário
  async getUserPromos(filters = {}) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Get user promos timeout"));
      }, 10000);

      this.socket.emit("get_user_promos", { filters });
      this.socket.once("user_promos_loaded", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error));
        }
      });
    });
  }

  // Validar código promocional
  async validatePromoCode(code, orderValue = 0) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Validate promo code timeout"));
      }, 10000);

      this.socket.emit("validate_promo_code", { code, orderValue });
      this.socket.once("promo_code_validated", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error));
        }
      });
    });
  }

  // Aplicar promoção
  async applyPromo(promoId, orderData) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Apply promo timeout"));
      }, 10000);

      this.socket.emit("apply_promo", { promoId, orderData });
      this.socket.once("promo_applied", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error));
        }
      });
    });
  }

  // Buscar promoção por código
  async getPromoByCode(code) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Get promo by code timeout"));
      }, 10000);

      this.socket.emit("get_promo_by_code", { code });
      this.socket.once("promo_by_code_loaded", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error));
        }
      });
    });
  }

  // ==================== NOVOS MÉTODOS - GERENCIAMENTO DE STATUS DO DRIVER ====================

  // Definir status do driver
  async setDriverStatus(driverId, status, isOnline = true, options = {}) {
    if (!this.socket?.connected) {
      throw buildSocketError(
        { code: "WS_DISCONNECTED", message: "WebSocket nao conectado" },
        "Sem conexão com o servidor agora. Verifique sua internet e tente novamente.",
        "driver_status",
      );
    }

    const timeoutMs = Number.isFinite(options?.timeoutMs)
      ? options.timeoutMs
      : 12000;
    const location = options?.location || null;
    const heading = Number.isFinite(options?.heading) ? options.heading : 0;
    const speed = Number.isFinite(options?.speed) ? options.speed : 0;
    const payload = {
      driverId,
      status,
      isOnline,
    };

    if (options?.destinationMode && typeof options.destinationMode === "object") {
      payload.destinationMode = options.destinationMode;
    }

    if (
      location &&
      Number.isFinite(location?.lat) &&
      Number.isFinite(location?.lng)
    ) {
      payload.lat = Number(location.lat);
      payload.lng = Number(location.lng);
      payload.heading = Number.isFinite(location?.heading)
        ? Number(location.heading)
        : heading;
      payload.speed = Number.isFinite(location?.speed)
        ? Number(location.speed)
        : speed;
    }

    return new Promise((resolve, reject) => {
      const buildDriverStatusError = (
        payload,
        fallbackCode = "SET_DRIVER_STATUS_FAILED",
        fallbackMessage = "Falha ao atualizar status do motorista.",
      ) => {
        const normalizedPayload =
          payload && typeof payload === "object"
            ? payload
            : {
                code: fallbackCode,
                message: String(payload || fallbackMessage),
              };
        const error = buildSocketError(
          {
            ...normalizedPayload,
            code: normalizedPayload?.code || fallbackCode,
            message:
              normalizedPayload?.message ||
              normalizedPayload?.error ||
              normalizedPayload?.reason ||
              fallbackMessage,
          },
          fallbackMessage,
          "driver_status",
        );
        if (normalizedPayload?.retryAfterSec) {
          error.retryAfterSec = normalizedPayload.retryAfterSec;
        }
        return error;
      };

      const matchesDriverStatusPayload = (data) => {
        if (!data || typeof data !== "object") {
          return true;
        }

        const payloadDriverId = String(
          data.driverId || data.uid || data.userId || "",
        ).trim();

        return (
          !payloadDriverId || payloadDriverId === String(driverId || "").trim()
        );
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("driverStatusError", onError);
        this.socket.off("driverStatusUpdated", onSuccess);
        this.socket.off("driver_status_updated", onSuccess);
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(
          buildDriverStatusError(
            {
              code: "SET_DRIVER_STATUS_TIMEOUT",
              message: "Set driver status timeout",
            },
            "SET_DRIVER_STATUS_TIMEOUT",
            "O servidor demorou para responder ao atualizar seu status. Tente novamente.",
          ),
        );
      }, timeoutMs);

      const onSuccess = (data) => {
        if (!matchesDriverStatusPayload(data)) {
          return;
        }
        cleanup();
        if (data.success) {
          this._mergeDriverStatusIntoAuthPayload({
            driverId,
            status: data.status || status,
            isOnline:
              typeof data.isOnline === "boolean" ? data.isOnline : isOnline,
            driverOnlineDaily: data.driverOnlineDaily || null,
          });
          resolve(data);
        } else {
          reject(buildDriverStatusError(data));
        }
      };

      const onError = (data) => {
        if (!matchesDriverStatusPayload(data)) {
          return;
        }
        cleanup();
        reject(buildDriverStatusError(data));
      };

      this.socket.on("driverStatusUpdated", onSuccess);
      this.socket.on("driver_status_updated", onSuccess);
      this.socket.on("driverStatusError", onError);

      try {
        this.socket.emit("setDriverStatus", payload);
      } catch (error) {
        cleanup();
        reject(
          buildDriverStatusError(
            error,
            "SET_DRIVER_STATUS_EMIT_FAILED",
            "Não foi possível enviar a atualização de status ao servidor.",
          ),
        );
      }
    });
  }

  // Atualizar localização do driver (evento canônico do backend)
  async updateLocation(driverId, lat, lng, heading = 0, speed = 0, metadata = {}) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Update driver location timeout"));
      }, 10000);

      const routeMetadata =
        metadata && typeof metadata === "object"
          ? {
              ...(metadata.bookingId ? { bookingId: String(metadata.bookingId) } : {}),
              ...(metadata.tripId ? { tripId: String(metadata.tripId) } : {}),
              ...(metadata.tripStatus
                ? { tripStatus: String(metadata.tripStatus) }
                : {}),
              ...(metadata.isInTrip !== undefined
                ? { isInTrip: Boolean(metadata.isInTrip) }
                : {}),
              ...(metadata.routePlan ? { routePlan: metadata.routePlan } : {}),
              ...(metadata.routePlanPhase
                ? { routePlanPhase: String(metadata.routePlanPhase) }
                : {}),
              ...(metadata.routePlanSharedAt
                ? { routePlanSharedAt: String(metadata.routePlanSharedAt) }
                : {}),
              ...(metadata.pickupCoordinate
                ? { pickupCoordinate: metadata.pickupCoordinate }
                : {}),
              ...(metadata.destinationCoordinate
                ? { destinationCoordinate: metadata.destinationCoordinate }
                : {}),
              ...(metadata.pickupAddress
                ? { pickupAddress: String(metadata.pickupAddress) }
                : {}),
              ...(metadata.destinationAddress
                ? { destinationAddress: String(metadata.destinationAddress) }
                : {}),
            }
          : {};

      this.socket.emit("updateLocation", {
        uid: driverId,
        driverId,
        lat,
        lng,
        heading,
        speed,
        timestamp: Date.now(),
        ...routeMetadata,
      });
      this.socket.once("locationUpdated", (data) => {
        clearTimeout(timeout);
        if (data?.success !== false) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Update driver location failed"));
        }
      });
    });
  }

  // Compatibilidade temporária para chamadas legadas no app.
  async updateDriverLocation(driverId, lat, lng, heading = 0, speed = 0, metadata = {}) {
    return this.updateLocation(driverId, lat, lng, heading, speed, metadata);
  }

  async updateLocationBatch({
    driverId,
    bookingId,
    tripId,
    tripStatus = "started",
    isInTrip = true,
    source = "location_buffer_batch",
    locations = [],
    batchId = null,
  } = {}) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    const normalizedLocations = Array.isArray(locations)
      ? locations
          .map((item) => {
            const lat = Number(item?.lat ?? item?.latitude);
            const lng = Number(item?.lng ?? item?.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
              return null;
            }
            return {
              eventId: item.eventId || null,
              lat,
              lng,
              accuracy: item.accuracy ?? null,
              heading: item.heading ?? null,
              speed: item.speed ?? null,
              timestamp: item.timestamp || item.capturedAt || Date.now(),
              capturedAt: item.capturedAt || item.timestamp || Date.now(),
              seq: Number.isInteger(Number(item.seq)) ? Number(item.seq) : null,
              source: item.source || source,
              tripStatus: item.tripStatus || tripStatus,
              isInTrip: item.isInTrip !== undefined ? Boolean(item.isInTrip) : Boolean(isInTrip),
              bookingId: item.bookingId || bookingId || tripId || null,
              tripId: item.tripId || tripId || bookingId || null,
            };
          })
          .filter(Boolean)
      : [];

    if (normalizedLocations.length === 0) {
      throw new Error("Nenhuma localização válida para sincronizar");
    }

    return new Promise((resolve, reject) => {
      const resolvedBatchId =
        String(batchId || "").trim() || createSocketRequestId("location_batch");
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Update location batch timeout"));
      }, 15000);

      const cleanup = () => {
        clearTimeout(timeout);
        this.off("locationBatchUpdated", onBatchUpdated);
      };

      const onBatchUpdated = (payload = {}) => {
        if (
          payload?.batchId &&
          resolvedBatchId &&
          String(payload.batchId) !== String(resolvedBatchId)
        ) {
          return;
        }
        cleanup();
        if (payload?.success === false) {
          reject(buildSocketError(payload, "Não foi possível sincronizar localizações.", "location_batch"));
          return;
        }
        resolve(payload);
      };

      this.on("locationBatchUpdated", onBatchUpdated);
      this.socket.emit("updateLocationBatch", {
        batchId: resolvedBatchId,
        driverId,
        uid: driverId,
        bookingId: bookingId || tripId || null,
        tripId: tripId || bookingId || null,
        tripStatus,
        isInTrip,
        source,
        locations: normalizedLocations,
      });
    });
  }

  // Localização do passageiro durante corrida ativa (monitoramento de tripulação)
  async updatePassengerLocation(bookingId, lat, lng, heading = 0, speed = 0) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }
    if (!bookingId) {
      throw new Error("bookingId obrigatório para updatePassengerLocation");
    }

    const normalizedBookingId = String(bookingId);
    const pendingPromise =
      this.passengerLocationInFlight.get(normalizedBookingId);
    if (pendingPromise) {
      return pendingPromise;
    }

    const requestPromise = new Promise((resolve, reject) => {
      const telemetryContext = this._resolveRideTelemetryContext({}, bookingId);
      const startedAt = Date.now();
      const timeout = setTimeout(() => {
        cleanup();
        this._recordRideTelemetryCommand(
          "updatePassengerLocation",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: "PASSENGER_LOCATION_TIMEOUT",
          },
          telemetryContext,
          bookingId,
        );
        reject(new Error("Update passenger location timeout"));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeout);
        this.off("passengerLocationUpdated", onSuccess);
        this.off("passengerLocationError", onError);
      };

      const onSuccess = (data) => {
        if (data?.bookingId && String(data.bookingId) !== String(bookingId)) {
          return;
        }
        cleanup();
        if (data?.success === false || data?.error) {
          this._recordRideTelemetryCommand(
            "updatePassengerLocation",
            {
              phase: "error",
              latencyMs: Date.now() - startedAt,
              errorCode: data?.code || null,
            },
            telemetryContext,
            bookingId,
          );
          reject(new Error(data?.error || "Update passenger location failed"));
          return;
        }
        this._recordRideTelemetryCommand(
          "updatePassengerLocation",
          {
            phase: "success",
            latencyMs: Date.now() - startedAt,
          },
          telemetryContext,
          bookingId,
        );
        resolve(data || { success: true, bookingId });
      };

      const onError = (error) => {
        cleanup();
        this._recordRideTelemetryCommand(
          "updatePassengerLocation",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: error?.code || null,
          },
          telemetryContext,
          bookingId,
        );
        reject(
          new Error(
            error?.error ||
              error?.message ||
              "Update passenger location failed",
          ),
        );
      };

      this.on("passengerLocationUpdated", onSuccess);
      this.on("passengerLocationError", onError);
      this._recordRideTelemetryCommand(
        "updatePassengerLocation",
        {
          phase: "attempt",
        },
        telemetryContext,
        bookingId,
      );
      this.socket.emit("passengerLocationUpdate", {
        bookingId,
        lat,
        lng,
        heading,
        speed,
        timestamp: Date.now(),
      });
    });

    this.passengerLocationInFlight.set(normalizedBookingId, requestPromise);
    return requestPromise.finally(() => {
      if (
        this.passengerLocationInFlight.get(normalizedBookingId) ===
        requestPromise
      ) {
        this.passengerLocationInFlight.delete(normalizedBookingId);
      }
    });
  }

  // ==================== NOVOS MÉTODOS - BUSCA E MATCHING DE DRIVERS ====================

  // Buscar motoristas próximos
  async searchDrivers(
    pickupLocation,
    destinationLocation,
    rideType = "standard",
    estimatedFare = 0,
    preferences = {},
  ) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Search drivers timeout"));
      }, 15000);

      this.socket.emit("searchDrivers", {
        pickupLocation,
        destinationLocation,
        rideType,
        estimatedFare,
        preferences,
      });
      this.socket.once("driversFound", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Search drivers failed"));
        }
      });
    });
  }

  // Cancelar busca de motoristas
  async cancelDriverSearch(bookingId, reason = "Cancelado pelo usuário") {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Cancel driver search timeout"));
      }, 10000);

      this.socket.emit("cancelDriverSearch", { bookingId, reason });
      this.socket.once("driverSearchCancelled", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Cancel driver search failed"));
        }
      });
    });
  }

  // ==================== NOVOS MÉTODOS - GERENCIAMENTO DE CORRIDAS ====================

  // Cancelar corrida (com reembolso automático PIX)
  async cancelRide(
    bookingId,
    reason = "Cancelado pelo usuário",
    cancellationFee = 0,
    options = {},
  ) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const telemetryContext = this._resolveRideTelemetryContext({}, bookingId);
      const startedAt = Date.now();
      const timeout = setTimeout(() => {
        cleanup();
        this._recordRideTelemetryCommand(
          "cancelRide",
          {
            phase: "error",
            latencyMs: Date.now() - startedAt,
            errorCode: "CANCEL_RIDE_TIMEOUT",
          },
          telemetryContext,
          bookingId,
        );
        reject(new Error("Cancel ride timeout"));
      }, 10000);

      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off?.("rideCancelled", onCancelled);
      };

      const onCancelled = (data) => {
        cleanup();
        if (data.success) {
          this._recordRideTelemetryCommand(
            "cancelRide",
            {
              phase: "success",
              latencyMs: Date.now() - startedAt,
            },
            telemetryContext,
            bookingId,
          );
          resolve(data);
        } else {
          this._recordRideTelemetryCommand(
            "cancelRide",
            {
              phase: "error",
              latencyMs: Date.now() - startedAt,
              errorCode: data?.code || null,
            },
            telemetryContext,
            bookingId,
          );
          reject(new Error(data.error || "Cancel ride failed"));
        }
      };

      const requestId =
        String(options?.requestId || "").trim() ||
        createSocketRequestId("cancel_ride");
      const lifecycleMetadata = buildRideLifecycleCommandMetadata(options);

      this._recordRideTelemetryCommand(
        "cancelRide",
        {
          phase: "attempt",
        },
        telemetryContext,
        bookingId,
      );
      this.socket.once("rideCancelled", onCancelled);
      this.socket.emit("cancelRide", {
        bookingId,
        reason,
        cancellationFee,
        requestId,
        ...lifecycleMetadata,
      });
    });
  }

  // ==================== NOVOS MÉTODOS - SISTEMA DE SEGURANÇA ====================

  // Reportar incidente
  async reportIncident(
    type,
    description,
    evidence = [],
    location = null,
    context = {},
  ) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      let timeout = null;
      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        this.socket?.off?.("incidentReported", onReported);
        this.socket?.off?.("incidentReportError", onError);
      };
      const onReported = (data) => {
        cleanup();
        if (data.success) {
          resolve(data);
        } else {
          reject(buildSocketError(data, "Report incident failed", "websocket"));
        }
      };
      const onError = (data) => {
        cleanup();
        reject(buildSocketError(data, "Report incident failed", "websocket"));
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Report incident timeout"));
      }, 10000);

      this.socket.once("incidentReported", onReported);
      this.socket.once("incidentReportError", onError);
      this.socket.emit("reportIncident", {
        type,
        description,
        evidence,
        location,
        ...buildSupportScopePayload(context),
      });
    });
  }

  // Contato de emergência
  async emergencyContact(
    contactType,
    location = null,
    message = "Solicitação de emergência",
    context = {},
  ) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      let timeout = null;
      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        this.socket?.off?.("emergencyContacted", onContacted);
        this.socket?.off?.("emergencyError", onError);
      };
      const onContacted = (data) => {
        cleanup();
        if (data.success) {
          resolve(data);
        } else {
          reject(buildSocketError(data, "Emergency contact failed", "websocket"));
        }
      };
      const onError = (data) => {
        cleanup();
        reject(buildSocketError(data, "Emergency contact failed", "websocket"));
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Emergency contact timeout"));
      }, 10000);

      this.socket.once("emergencyContacted", onContacted);
      this.socket.once("emergencyError", onError);
      this.socket.emit("emergencyContact", {
        contactType,
        location,
        message,
        ...buildSupportScopePayload(context),
      });
    });
  }

  // ==================== NOVOS MÉTODOS - SISTEMA DE SUPORTE ====================

  // Criar ticket de suporte
  async createSupportTicket(
    type,
    priority = "N3",
    description,
    attachments = [],
    context = {},
  ) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      let timeout = null;
      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout);
        }
        this.socket?.off?.("supportTicketCreated", onCreated);
        this.socket?.off?.("supportTicketError", onError);
      };
      const onCreated = (data) => {
        cleanup();
        if (data.success) {
          resolve(data);
        } else {
          reject(buildSocketError(data, "Create support ticket failed", "websocket"));
        }
      };
      const onError = (data) => {
        cleanup();
        reject(buildSocketError(data, "Create support ticket failed", "websocket"));
      };

      timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Create support ticket timeout"));
      }, 10000);

      this.socket.once("supportTicketCreated", onCreated);
      this.socket.once("supportTicketError", onError);
      this.socket.emit("createSupportTicket", {
        type,
        priority,
        description,
        attachments,
        ...buildSupportScopePayload(context),
      });
    });
  }

  // ==================== NOVOS MÉTODOS - NOTIFICAÇÕES AVANÇADAS ====================

  // Atualizar preferências de notificação
  async updateNotificationPreferences(preferences) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Update notification preferences timeout"));
      }, 10000);

      this.socket.emit("updateNotificationPreferences", preferences);
      this.socket.once("notificationPreferencesUpdated", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(
            new Error(data.error || "Update notification preferences failed"),
          );
        }
      });
    });
  }

  // ==================== NOVOS MÉTODOS - ANALYTICS E FEEDBACK ====================

  // Rastrear ação do usuário
  async trackUserAction(action, actionData = {}, timestamp = null) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Track user action timeout"));
      }, 10000);

      this.socket.emit("trackUserAction", {
        action,
        data: actionData,
        timestamp,
      });
      this.socket.once("userActionTracked", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Track user action failed"));
        }
      });
    });
  }

  // Enviar feedback
  async submitFeedback(type, rating, comments = "", suggestions = "") {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Submit feedback timeout"));
      }, 10000);

      this.socket.emit("submitFeedback", {
        type,
        rating,
        comments,
        suggestions,
      });
      this.socket.once("feedbackReceived", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Submit feedback failed"));
        }
      });
    });
  }

  // ==================== NOVOS MÉTODOS - NOTIFICAÇÕES FCM ====================

  // Registrar token FCM
  async registerFCMToken(tokenData) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Register FCM token timeout"));
      }, 10000);

      const onRegistered = (data) => {
        cleanup();
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Register FCM token failed"));
        }
      };

      const onError = (error) => {
        cleanup();
        reject(new Error(error.error || "Register FCM token error event"));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("fcmTokenRegistered", onRegistered);
        this.socket.off("fcmTokenError", onError);
      };

      this.socket.once("fcmTokenRegistered", onRegistered);
      this.socket.once("fcmTokenError", onError);
      this.socket.emit("registerFCMToken", tokenData);
    });
  }

  // Desregistrar token FCM
  async unregisterFCMToken(tokenData) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Unregister FCM token timeout"));
      }, 10000);

      this.socket.emit("unregisterFCMToken", tokenData);
      this.socket.once("fcmTokenUnregistered", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Unregister FCM token failed"));
        }
      });
    });
  }

  async registerRideLiveActivityToken(tokenData) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Register ride Live Activity token timeout"));
      }, 10000);

      const onRegistered = (data) => {
        cleanup();
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Register ride Live Activity token failed"));
        }
      };

      const onError = (error) => {
        cleanup();
        reject(new Error(error.error || "Register ride Live Activity token error event"));
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("rideLiveActivityTokenRegistered", onRegistered);
        this.socket.off("rideLiveActivityTokenError", onError);
      };

      this.socket.once("rideLiveActivityTokenRegistered", onRegistered);
      this.socket.once("rideLiveActivityTokenError", onError);
      this.socket.emit("registerRideLiveActivityToken", tokenData);
    });
  }

  // Enviar notificação
  async sendNotification(notificationData) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Send notification timeout"));
      }, 10000);

      this.socket.emit("sendNotification", notificationData);
      this.socket.once("notificationSent", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Send notification failed"));
        }
      });
    });
  }

  // Enviar notificação para usuário específico
  async sendNotificationToUser(userId, notification) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Send notification to user timeout"));
      }, 10000);

      this.socket.emit("sendNotificationToUser", {
        userId,
        notification,
        timestamp: new Date().toISOString(),
      });
      this.socket.once("notificationSentToUser", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        } else {
          reject(new Error(data.error || "Send notification to user failed"));
        }
      });
    });
  }

  // Enviar notificação para todos os usuários de um tipo
  async sendNotificationToUserType(userType, notification) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Send notification to user type timeout"));
      }, 10000);

      this.socket.emit("sendNotificationToUserType", {
        userType,
        notification,
        timestamp: new Date().toISOString(),
      });
      this.socket.once("notificationSentToUserType", (data) => {
        clearTimeout(timeout);
        if (data.success) {
          resolve(data);
        }
      });
    });
  }

  // ==================== NOVOS MÉTODOS - EXTENSÃO DE CORRIDA (MUDANÇA DE DESTINO) ====================

  /**
   * Solicita extensão de corrida com cobrança adicional via Pix.
   * @param {string} rideId
   * @param {object} newDrop {lat, lng, add}
   * @param {number} newFare
   */
  async requestRideExtension(rideId, newDrop, newFare, options = {}) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("rideExtensionRequestAccepted", onAccepted);
        this.socket.off("rideExtensionError", onError);
      };

      const onAccepted = (data) => {
        cleanup();
        if (data?.success === false || data?.error) {
          reject(new Error(data?.error || "Request ride extension failed"));
          return;
        }
        resolve(data);
      };

      const onError = (data) => {
        cleanup();
        reject(
          new Error(
            data?.error || data?.message || "Request ride extension failed",
          ),
        );
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Request ride extension timeout"));
      }, 10000);

      this.socket.on("rideExtensionRequestAccepted", onAccepted);
      this.socket.on("rideExtensionError", onError);
      this.socket.emit("requestRideExtension", {
        bookingId: rideId,
        newEndLocation: newDrop,
        newFare,
        routeDistanceKm:
          options.routeDistanceKm ?? options.routeDistance ?? null,
        routeDurationSecs:
          options.routeDurationSecs ?? options.routeDuration ?? null,
        quoteLockId: options.quoteLockId || null,
        quoteSessionId: options.quoteSessionId || null,
      });
    });
  }

  async respondRideExtension(rideId, accepted, options = {}) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("rideExtensionPendingPayment", onPendingPayment);
        this.socket.off("rideExtensionRejected", onRejected);
        this.socket.off("rideExtensionResponseError", onError);
      };

      const onPendingPayment = (data) => {
        cleanup();
        resolve(data);
      };

      const onRejected = (data) => {
        cleanup();
        resolve(data);
      };

      const onError = (data) => {
        cleanup();
        reject(
          new Error(
            data?.error || data?.message || "Ride extension response failed",
          ),
        );
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Respond ride extension timeout"));
      }, 10000);

      this.socket.on("rideExtensionPendingPayment", onPendingPayment);
      this.socket.on("rideExtensionRejected", onRejected);
      this.socket.on("rideExtensionResponseError", onError);
      this.socket.emit("respondRideExtension", {
        bookingId: rideId,
        accepted: Boolean(accepted),
        ...options,
      });
    });
  }

  /**
   * Solicita simples mudança de destino (mais barato ou igual)
   * @param {string} rideId
   * @param {object} newDrop {lat, lng, add}
   */
  async changeDestination(rideId, newDrop) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("destinationChanged", onChanged);
        this.socket.off("changeDestinationError", onError);
      };

      const onChanged = (data) => {
        cleanup();
        if (data?.success) {
          resolve(data);
        } else {
          reject(new Error(data?.error || "Change destination failed"));
        }
      };

      const onError = (data) => {
        cleanup();
        reject(
          new Error(
            data?.error || data?.message || "Change destination failed",
          ),
        );
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Change destination timeout"));
      }, 10000);

      this.socket.on("destinationChanged", onChanged);
      this.socket.on("changeDestinationError", onError);
      this.socket.emit("changeDestination", {
        bookingId: rideId,
        newDestination: newDrop,
      });
    });
  }

  async endTripEarlyByRider(
    bookingId,
    endLocation,
    distanceKm = 0,
    durationSecs = 0,
    reason = "EARLY_DROPOFF_BY_RIDER",
  ) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("tripCompleted", onCompleted);
        this.socket.off("tripCompleteError", onError);
      };

      const onCompleted = (data) => {
        cleanup();
        if (data?.success) {
          resolve(data);
        } else {
          reject(new Error(data?.error || "End trip early failed"));
        }
      };

      const onError = (data) => {
        cleanup();
        reject(
          new Error(data?.error || data?.message || "End trip early failed"),
        );
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("End trip early timeout"));
      }, 12000);

      this.socket.on("tripCompleted", onCompleted);
      this.socket.on("tripCompleteError", onError);
      this.socket.emit("endTripEarlyByRider", {
        bookingId,
        endLocation,
        distanceKm,
        durationSecs,
        reason,
      });
    });
  }

  async interruptRideOperational(
    bookingId,
    interruptionLocation,
    distanceKm = 0,
    durationSecs = 0,
    reason = "VEHICLE_BREAKDOWN",
    note = "",
  ) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("rideOperationalInterrupted", onInterrupted);
        this.socket.off("rideOperationalInterruptionError", onError);
      };

      const onInterrupted = (payload) => {
        cleanup();
        if (payload?.success === false || payload?.error) {
          reject(
            new Error(payload?.error || "Operational interruption failed"),
          );
          return;
        }
        resolve(payload);
      };

      const onError = (payload) => {
        cleanup();
        reject(
          new Error(
            payload?.error ||
              payload?.message ||
              "Operational interruption failed",
          ),
        );
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Operational interruption timeout"));
      }, 12000);

      this.socket.on("rideOperationalInterrupted", onInterrupted);
      this.socket.on("rideOperationalInterruptionError", onError);
      this.socket.emit("interruptRideOperational", {
        bookingId,
        interruptionLocation,
        distanceKm,
        durationSecs,
        reason,
        note,
      });
    });
  }

  async respondOperationalContinuation(bookingId, continueTrip) {
    if (!this.socket?.connected) {
      throw new Error("WebSocket não conectado");
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout);
        this.socket.off("rideOperationalContinuationSearching", onSearching);
        this.socket.off("tripCompleted", onTripCompleted);
        this.socket.off("rideOperationalContinuationError", onError);
      };

      const onSearching = (payload) => {
        if (
          payload?.bookingId &&
          String(payload.bookingId) !== String(bookingId)
        ) {
          return;
        }
        cleanup();
        resolve(payload);
      };

      const onTripCompleted = (payload) => {
        if (
          payload?.bookingId &&
          String(payload.bookingId) !== String(bookingId)
        ) {
          return;
        }
        cleanup();
        resolve(payload);
      };

      const onError = (payload) => {
        cleanup();
        reject(
          new Error(
            payload?.error ||
              payload?.message ||
              "Operational continuation failed",
          ),
        );
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Operational continuation timeout"));
      }, 15000);

      this.socket.on("rideOperationalContinuationSearching", onSearching);
      this.socket.on("tripCompleted", onTripCompleted);
      this.socket.on("rideOperationalContinuationError", onError);
      this.socket.emit("respondOperationalContinuation", {
        bookingId,
        continueTrip: Boolean(continueTrip),
      });
    });
  }

  async syncActiveRideWithAck(timeoutMs = ACTIVE_RIDE_SYNC_TIMEOUT_MS) {
    if (!this.socket?.connected) {
      throw buildSocketError(
        { code: "WS_DISCONNECTED", message: "WebSocket nao conectado" },
        "Sem conexao com o servidor agora. Verifique sua internet e tente novamente.",
        "ride_sync",
      );
    }

    if (!this.authenticatedUserId || !this.authenticatedUserType) {
      throw buildSocketError(
        { code: "AUTH_REQUIRED", message: "Usuario nao autenticado" },
        "A sessao ainda nao foi validada. Tente novamente.",
        "ride_sync",
      );
    }

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.off("activeRideSync", onSync);
        clearTimeout(timeout);
      };

      const onSync = (payload) => {
        cleanup();
        if (!payload?.success) {
          reject(
            buildSocketError(
              payload,
              "Nao foi possivel sincronizar sua corrida ativa agora.",
              "ride_sync",
            ),
          );
          return;
        }
        resolve(payload);
      };

      const timeout = setTimeout(() => {
        cleanup();
        reject(
          buildSocketError(
            {
              code: "RIDE_SYNC_TIMEOUT",
              message: `Timeout ao sincronizar corrida ativa (${Math.floor(timeoutMs / 1000)}s)`,
            },
            "A sincronizacao da corrida ativa demorou mais que o esperado.",
            "ride_sync",
          ),
        );
      }, timeoutMs);

      this.on("activeRideSync", onSync);
      this.socket.emit("syncActiveRide", {
        uid: this.authenticatedUserId,
        userType: this.authenticatedUserType,
      });
    });
  }

  _rehydrateRideEventsFromSync(snapshot) {
    if (!snapshot?.success || !snapshot?.hasActiveRide) {
      return;
    }

    if (isTerminalActiveRideSyncSnapshot(snapshot)) {
      this._clearRehydratedRideLifecycle(snapshot?.bookingId);
      this._clearLifecycleDispatchForBooking(snapshot?.bookingId);
      return;
    }

    const status = normalizeSocketRideStatus(
      snapshot.status,
      snapshot.bookingStatus,
      snapshot.state,
      snapshot.tripStatus,
    );
    if (!this._shouldEmitRehydratedRideLifecycle(snapshot, status)) {
      return;
    }
    const payload = {
      success: true,
      bookingId: snapshot.bookingId,
      driverId: snapshot.driverId || null,
      customerId: snapshot.customerId || null,
      location: snapshot.driverLocation || null,
      pickupLocation: snapshot.pickupLocation || null,
      destinationLocation: snapshot.destinationLocation || null,
      estimatedFare: snapshot.estimatedFare,
      finalFare: snapshot.finalFare,
      operationalFee: snapshot.operationalFee ?? null,
      paymentIntermediationFee: snapshot.paymentIntermediationFee ?? null,
      totalFees: snapshot.totalFees ?? null,
      driverNetAmount: snapshot.driverNetAmount ?? null,
      estimatedOperationalFee: snapshot.estimatedOperationalFee ?? null,
      estimatedPaymentIntermediationFee:
        snapshot.estimatedPaymentIntermediationFee ?? null,
      estimatedTotalFees: snapshot.estimatedTotalFees ?? null,
      estimatedDriverNetAmount: snapshot.estimatedDriverNetAmount ?? null,
      pricingSnapshotLocked: snapshot.pricingSnapshotLocked === true,
      pricingSnapshotLockedAt: snapshot.pricingSnapshotLockedAt || null,
      boardingDeadlineAt: snapshot.boardingDeadlineAt || null,
      boardingWindowSec: snapshot.boardingWindowSec ?? null,
      paymentStatus: snapshot.paymentStatus || null,
      rehydrated: true,
      status,
      __source: "active_ride_rehydrated",
      syncedAt: snapshot.syncedAt || new Date().toISOString(),
    };

    this.eventEmitter.emit("activeRideRehydrated", payload);

    if (["MATCHED", "ACCEPTED"].includes(status)) {
      this._emitLifecycleEvent("rideAccepted", payload);
      return;
    }

    if (["IN_PROGRESS", "STARTED"].includes(status)) {
      this._emitLifecycleEvent("tripStarted", payload);
    }
  }
}

export default WebSocketManager;
