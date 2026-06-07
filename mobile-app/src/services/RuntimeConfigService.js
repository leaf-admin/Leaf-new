import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../utils/Logger';
import { getSelfHostedApiUrl } from '../config/ApiConfig';

const STORAGE_KEY = '@leaf_runtime_config';
const DEFAULT_CACHE_TTL_SECONDS = 60;
const DEFAULT_STALE_TTL_SECONDS = 15 * 60;

const conservativeDefaults = Object.freeze({
  schemaVersion: 1,
  source: 'mobile_conservative_default',
  cacheTtlSeconds: DEFAULT_CACHE_TTL_SECONDS,
  staleTtlSeconds: DEFAULT_STALE_TTL_SECONDS,
  paymentRuntime: {
    appMayCallProviderDirectly: false,
    sandboxControlledByBackend: true,
    splitRealEnabled: false,
    withdrawalsEnabled: false,
  },
  biometricRuntime: {
    strictModeEnabled: false,
    requireTrustedBiometricMatch: false,
  },
  featureGates: {
    driverWithdrawalsEnabled: false,
    referralProgramsEnabled: true,
    leafDelasEnabled: true,
    driverDestinationModeEnabled: true,
    dynamicPricingEnabled: true,
    smartPushEnabled: false,
    softBanEnforcementEnabled: true,
    adminMutationsEnabled: true,
    biometricStrictModeEnabled: false,
  },
  mapsRoutingPolicy: {
    backendOnly: true,
    clientDirectGoogleFallback: false,
    placesCacheEnabled: true,
    routesCacheEnabled: true,
    routeTrafficEnabled: false,
    routeAlternativesEnabled: false,
  },
  notificationPolicy: {
    enabled: true,
    smartPushMode: 'disabled',
    persistentRideNotificationsEnabled: true,
    androidNativePersistentSlotEnabled: true,
    androidPersistentNotificationId: 43001,
    iosLiveActivityEnabled: false,
    iosLiveActivityMode: 'disabled',
    iosNotificationFallbackEnabled: true,
    dedupeWindowSeconds: 60,
    defaultTtlSeconds: 3600,
    androidChannels: ['ride_status', 'driver_actions', 'payments', 'default'],
    iosCategories: ['ride_status_update', 'payment_update', 'identity_reverification'],
    suppressMarketingDuringActiveRide: true,
  },
  driverOnlinePolicy: {
    backendAuthoritative: true,
    neverInterruptActiveRide: true,
    requireApprovedDocuments: true,
    requireApprovedVehicle: true,
    requireLivenessWhenStale: true,
  },
});

function nowMs() {
  return Date.now();
}

function normalizeConfig(payload) {
  const config = payload?.config || payload;
  if (!config || typeof config !== 'object') return null;
  const cachedReceivedAt = Number(config.receivedAt);
  return {
    ...conservativeDefaults,
    ...config,
    paymentRuntime: {
      ...conservativeDefaults.paymentRuntime,
      ...(config.paymentRuntime || {}),
    },
    biometricRuntime: {
      ...conservativeDefaults.biometricRuntime,
      ...(config.biometricRuntime || {}),
    },
    featureGates: {
      ...conservativeDefaults.featureGates,
      ...(config.featureGates || {}),
    },
    mapsRoutingPolicy: {
      ...conservativeDefaults.mapsRoutingPolicy,
      ...(config.mapsRoutingPolicy || {}),
    },
    notificationPolicy: {
      ...conservativeDefaults.notificationPolicy,
      ...(config.notificationPolicy || {}),
    },
    driverOnlinePolicy: {
      ...conservativeDefaults.driverOnlinePolicy,
      ...(config.driverOnlinePolicy || {}),
    },
    receivedAt: Number.isFinite(cachedReceivedAt) && cachedReceivedAt > 0
      ? cachedReceivedAt
      : nowMs(),
  };
}

function isFresh(config) {
  if (!config?.receivedAt) return false;
  const ttlMs = Number(config.cacheTtlSeconds || DEFAULT_CACHE_TTL_SECONDS) * 1000;
  return nowMs() - Number(config.receivedAt) <= ttlMs;
}

function isUsableStale(config) {
  if (!config?.receivedAt) return false;
  const staleTtlMs = Number(config.staleTtlSeconds || DEFAULT_STALE_TTL_SECONDS) * 1000;
  return nowMs() - Number(config.receivedAt) <= staleTtlMs;
}

class RuntimeConfigService {
  constructor() {
    this.config = conservativeDefaults;
    this.initialized = false;
    this.inFlight = null;
  }

  getDefaultConfig() {
    return conservativeDefaults;
  }

  getCachedConfigSync() {
    return this.config || conservativeDefaults;
  }

  hasOperationalConfigSync() {
    const source = String(this.getCachedConfigSync()?.source || '').trim();
    return source !== '' && source !== conservativeDefaults.source;
  }

  getFeatureGatesSync() {
    return this.getCachedConfigSync().featureGates || conservativeDefaults.featureGates;
  }

  getOperationalFeatureGatesSync() {
    return this.hasOperationalConfigSync() ? this.getFeatureGatesSync() : {};
  }

  getMapsRoutingPolicySync() {
    return this.getCachedConfigSync().mapsRoutingPolicy || conservativeDefaults.mapsRoutingPolicy;
  }

  getNotificationPolicySync() {
    return this.getCachedConfigSync().notificationPolicy || conservativeDefaults.notificationPolicy;
  }

  async loadCachedConfig() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return normalizeConfig(JSON.parse(raw));
    } catch (error) {
      Logger.warn('⚠️ [RuntimeConfig] Falha ao ler cache:', error?.message || error);
      return null;
    }
  }

  async saveConfig(config) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (error) {
      Logger.warn('⚠️ [RuntimeConfig] Falha ao salvar cache:', error?.message || error);
    }
  }

  async initialize({ forceRefresh = false } = {}) {
    if (this.initialized && !forceRefresh && isFresh(this.config)) {
      return this.config;
    }

    const cached = await this.loadCachedConfig();
    if (cached && isUsableStale(cached)) {
      this.config = cached;
    }
    this.initialized = true;

    return this.refresh({ forceRefresh }).catch((error) => {
      Logger.warn('⚠️ [RuntimeConfig] Usando cache/default por falha no backend:', error?.message || error);
      return this.config || conservativeDefaults;
    });
  }

  async refresh({ forceRefresh = false } = {}) {
    if (this.inFlight) return this.inFlight;
    if (!forceRefresh && isFresh(this.config)) return this.config;

    this.inFlight = (async () => {
      const url = getSelfHostedApiUrl('/api/app/runtime-config');
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.success === false) {
        throw new Error(payload?.error || `runtime_config_http_${response.status}`);
      }

      const normalized = normalizeConfig(payload);
      if (!normalized) throw new Error('runtime_config_invalid_payload');

      this.config = normalized;
      await this.saveConfig(normalized);
      Logger.log('✅ [RuntimeConfig] Config atualizada pelo backend');
      return normalized;
    })();

    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }
}

const runtimeConfigService = new RuntimeConfigService();

export default runtimeConfigService;
export { RuntimeConfigService, conservativeDefaults as RUNTIME_CONFIG_DEFAULTS };
