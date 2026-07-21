const redisPool = require('../utils/redis-pool');
const { normalizeStreamGroup } = require('../utils/redis-stream-safe-retention');

const APPROVED_MEMORY_THRESHOLDS = Object.freeze({
  warningPercent: 60,
  highPercent: 75,
  criticalPercent: 85
});

const DEFAULT_GENERATION_KEY = 'leaf:runtime:critical-dataset:generation';
const DEFAULT_CACHE_TTL_MS = 5000;
const APPROVED_MAXMEMORY_BYTES = 2304 * 1024 * 1024;
const DEFAULT_TRIP_LOCATION_STREAM_TRIM_THRESHOLD = 500000;
const DEFAULT_TRIP_LOCATION_CONSUMER_MAX_IDLE_MS = 30000;
const DEFAULT_TRIP_LOCATION_WORKER_HEALTH_KEY = 'leaf:runtime:trip-location-worker:health';
const DEFAULT_TRIP_LOCATION_WORKER_HEALTH_MAX_AGE_MS = 45000;
const MIN_TRIP_LOCATION_CONSUMER_MAX_IDLE_MS = 1000;
const MAX_TRIP_LOCATION_CONSUMER_MAX_IDLE_MS = 300000;
const VALID_TRIP_LOCATION_WORKER_HEALTH_STATUSES = new Set(['healthy', 'idle', 'degraded']);

function readBooleanLike(value, fallback = false) {
  if (value == null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'sim'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'nao', 'não'].includes(normalized)) return false;
  return fallback;
}

function parseInfo(rawInfo) {
  const values = {};
  for (const line of String(rawInfo || '').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    values[line.slice(0, separator)] = line.slice(separator + 1).trim();
  }
  return values;
}

function parseConfigGet(rawConfig, expectedKey) {
  if (Array.isArray(rawConfig)) {
    for (let index = 0; index < rawConfig.length - 1; index += 2) {
      if (String(rawConfig[index]).toLowerCase() === expectedKey.toLowerCase()) {
        return String(rawConfig[index + 1] ?? '').trim().toLowerCase();
      }
    }
  }

  if (rawConfig && typeof rawConfig === 'object') {
    const value = rawConfig[expectedKey] ?? rawConfig[expectedKey.toLowerCase()];
    if (value != null) return String(value).trim().toLowerCase();
  }

  return '';
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function strictInfoNumber(values, key, { integer = false, min = null } = {}) {
  if (!Object.prototype.hasOwnProperty.call(values, key)) return null;
  const rawValue = values[key];
  if (typeof rawValue !== 'string' || rawValue.trim() === '') return null;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) return null;
  if (integer && !Number.isInteger(parsed)) return null;
  if (min != null && parsed < min) return null;
  return parsed;
}

function publicErrorCode(error) {
  const code = String(error?.code || '').trim();
  return /^[A-Z0-9_-]{1,64}$/.test(code) ? code : null;
}

function normalizeStreamConsumer(rawConsumer) {
  const consumer = normalizeStreamGroup(rawConsumer);
  const name = String(consumer.name || '').trim();
  const idleMs = Number(consumer.idle);
  const pending = Number(consumer.pending);
  const valid = Boolean(name)
    && Number.isInteger(idleMs)
    && idleMs >= 0
    && Number.isInteger(pending)
    && pending >= 0;

  return {
    valid,
    idleMs: Number.isInteger(idleMs) && idleMs >= 0 ? idleMs : null,
    pending: Number.isInteger(pending) && pending >= 0 ? pending : null
  };
}

class RedisCriticalAuthorityNotReadyError extends Error {
  constructor(attestation) {
    super('Redis critical authority is not ready');
    this.name = 'RedisCriticalAuthorityNotReadyError';
    this.code = 'REDIS_CRITICAL_AUTHORITY_NOT_READY';
    this.statusCode = 503;
    this.retryable = true;
    this.attestation = attestation;
  }
}

class RedisCriticalAuthorityService {
  constructor(options = {}) {
    this.redisPool = options.redisPool || redisPool;
    this.now = options.now || (() => Date.now());
    this.cachedAttestation = null;
    this.inFlight = null;
  }

  getConfiguration(env = process.env) {
    const generation = String(env.REDIS_CRITICAL_DATASET_GENERATION || '').trim();
    const generationKey = String(
      env.REDIS_CRITICAL_DATASET_GENERATION_KEY || DEFAULT_GENERATION_KEY
    ).trim();
    const thresholds = {
      warningPercent: finiteNumber(
        env.REDIS_CRITICAL_MEMORY_WARNING_PERCENT,
        APPROVED_MEMORY_THRESHOLDS.warningPercent
      ),
      highPercent: finiteNumber(
        env.REDIS_CRITICAL_MEMORY_HIGH_PERCENT,
        APPROVED_MEMORY_THRESHOLDS.highPercent
      ),
      criticalPercent: finiteNumber(
        env.REDIS_CRITICAL_MEMORY_CRITICAL_PERCENT,
        APPROVED_MEMORY_THRESHOLDS.criticalPercent
      )
    };
    const thresholdPolicyMatches = Object.entries(APPROVED_MEMORY_THRESHOLDS)
      .every(([key, expected]) => thresholds[key] === expected);
    const tripLocationStreamEnabled = readBooleanLike(
      env.ENABLE_TRIP_LOCATION_STREAM,
      true
    );
    const tripLocationConsumerMaxIdleMs = Number(
      env.TRIP_LOCATION_CONSUMER_MAX_IDLE_MS
        ?? DEFAULT_TRIP_LOCATION_CONSUMER_MAX_IDLE_MS
    );
    const tripLocationConsumerMaxIdleMsValid = !tripLocationStreamEnabled || (
      Number.isInteger(tripLocationConsumerMaxIdleMs)
      && tripLocationConsumerMaxIdleMs >= MIN_TRIP_LOCATION_CONSUMER_MAX_IDLE_MS
      && tripLocationConsumerMaxIdleMs <= MAX_TRIP_LOCATION_CONSUMER_MAX_IDLE_MS
    );
    const tripLocationWorkerHealthKey = String(
      env.TRIP_LOCATION_WORKER_HEALTH_KEY || DEFAULT_TRIP_LOCATION_WORKER_HEALTH_KEY
    ).trim();
    const tripLocationWorkerHealthMaxAgeMs = Number(
      env.TRIP_LOCATION_WORKER_HEALTH_MAX_AGE_MS
        ?? DEFAULT_TRIP_LOCATION_WORKER_HEALTH_MAX_AGE_MS
    );
    const tripLocationWorkerHealthMaxAgeMsValid =
      Number.isInteger(tripLocationWorkerHealthMaxAgeMs)
      && tripLocationWorkerHealthMaxAgeMs >= 1000
      && tripLocationWorkerHealthMaxAgeMs <= 300000;

    return {
      enabled: readBooleanLike(env.REDIS_CRITICAL_AUTHORITY_ATTESTATION_ENABLED, false),
      quarantineEnabled: readBooleanLike(
        env.REDIS_CRITICAL_DATASET_QUARANTINE_ENABLED,
        false
      ),
      generation,
      generationKey,
      generationConfigured: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(generation),
      generationKeyValid: generationKey.length > 0 && generationKey.length <= 256,
      thresholds,
      thresholdPolicyMatches,
      tripLocationStreamEnabled,
      tripLocationStreamName: String(
        env.TRIP_LOCATION_STREAM_NAME || 'trip_location_events'
      ).trim(),
      tripLocationWorkerGroup: String(
        env.TRIP_LOCATION_WORKER_GROUP || 'trip-location-workers'
      ).trim(),
      tripLocationConsumerMaxIdleMs,
      tripLocationConsumerMaxIdleMsValid,
      tripLocationPersistenceWorkerEnabled: readBooleanLike(
        env.ENABLE_TRIP_LOCATION_PERSISTENCE_WORKER,
        true
      ),
      tripLocationFirestorePersistenceEnabled: readBooleanLike(
        env.ENABLE_TRIP_LOCATION_FIRESTORE_PERSISTENCE,
        true
      ),
      tripLocationWorkerHealthKey,
      tripLocationWorkerHealthKeyValid:
        tripLocationWorkerHealthKey.length > 0
        && tripLocationWorkerHealthKey.length <= 256,
      tripLocationWorkerHealthMaxAgeMs,
      tripLocationWorkerHealthMaxAgeMsValid,
      tripLocationStreamTrimThreshold: Math.max(
        100000,
        Math.trunc(finiteNumber(
          env.TRIP_LOCATION_STREAM_SAFE_TRIM_THRESHOLD,
          DEFAULT_TRIP_LOCATION_STREAM_TRIM_THRESHOLD
        ))
      ),
      cacheTtlMs: Math.min(
        30000,
        Math.max(
          0,
          Math.trunc(finiteNumber(
            env.REDIS_CRITICAL_ATTESTATION_CACHE_TTL_MS,
            DEFAULT_CACHE_TTL_MS
          ))
        )
      )
    };
  }

  getLastAttestation() {
    return this.cachedAttestation?.payload || null;
  }

  clearCache() {
    this.cachedAttestation = null;
  }

  getConfigurationCacheKey(config) {
    return JSON.stringify({
      enabled: config.enabled,
      quarantineEnabled: config.quarantineEnabled,
      generation: config.generation,
      generationKey: config.generationKey,
      thresholds: config.thresholds,
      tripLocationStreamEnabled: config.tripLocationStreamEnabled,
      tripLocationStreamName: config.tripLocationStreamName,
      tripLocationWorkerGroup: config.tripLocationWorkerGroup,
      tripLocationConsumerMaxIdleMs: config.tripLocationConsumerMaxIdleMs,
      tripLocationConsumerMaxIdleMsValid: config.tripLocationConsumerMaxIdleMsValid,
      tripLocationPersistenceWorkerEnabled: config.tripLocationPersistenceWorkerEnabled,
      tripLocationFirestorePersistenceEnabled: config.tripLocationFirestorePersistenceEnabled,
      tripLocationWorkerHealthKey: config.tripLocationWorkerHealthKey,
      tripLocationWorkerHealthKeyValid: config.tripLocationWorkerHealthKeyValid,
      tripLocationWorkerHealthMaxAgeMs: config.tripLocationWorkerHealthMaxAgeMs,
      tripLocationWorkerHealthMaxAgeMsValid: config.tripLocationWorkerHealthMaxAgeMsValid,
      tripLocationStreamTrimThreshold: config.tripLocationStreamTrimThreshold
    });
  }

  getCachedAttestation(config) {
    if (!this.cachedAttestation || config.cacheTtlMs <= 0) return null;
    if (this.cachedAttestation.configurationKey !== this.getConfigurationCacheKey(config)) {
      return null;
    }
    if (this.now() - this.cachedAttestation.cachedAtMs > config.cacheTtlMs) return null;
    return {
      ...this.cachedAttestation.payload,
      cache: {
        hit: true,
        ageMs: this.now() - this.cachedAttestation.cachedAtMs,
        ttlMs: config.cacheTtlMs
      }
    };
  }

  setCachedAttestation(payload, config) {
    this.cachedAttestation = {
      cachedAtMs: this.now(),
      configurationKey: this.getConfigurationCacheKey(config),
      payload
    };
  }

  buildDisabledAttestation(config) {
    const blockers = [];
    if (!config.enabled) blockers.push('attestation_disabled');
    if (!config.quarantineEnabled) blockers.push('dataset_quarantine_disabled');
    if (!config.generationConfigured) blockers.push('dataset_generation_not_configured');
    if (!config.generationKeyValid) blockers.push('dataset_generation_key_invalid');
    if (!config.thresholdPolicyMatches) blockers.push('memory_threshold_policy_mismatch');
    if (!config.tripLocationConsumerMaxIdleMsValid) {
      blockers.push('trip_location_consumer_max_idle_invalid');
    }
    if (!config.tripLocationPersistenceWorkerEnabled) {
      blockers.push('trip_location_persistence_worker_disabled');
    }
    if (!config.tripLocationFirestorePersistenceEnabled) {
      blockers.push('trip_location_firestore_persistence_disabled');
    }
    if (config.tripLocationStreamEnabled && !config.tripLocationWorkerHealthKeyValid) {
      blockers.push('trip_location_worker_health_key_invalid');
    }
    if (config.tripLocationStreamEnabled && !config.tripLocationWorkerHealthMaxAgeMsValid) {
      blockers.push('trip_location_worker_health_max_age_invalid');
    }

    return {
      ready: false,
      status: 'quarantined',
      quarantined: true,
      checkedAt: new Date(this.now()).toISOString(),
      blockers,
      configuration: {
        enabled: config.enabled,
        quarantineEnabled: config.quarantineEnabled,
        generationConfigured: config.generationConfigured,
        generationKeyValid: config.generationKeyValid,
        thresholdPolicyMatches: config.thresholdPolicyMatches,
        thresholds: config.thresholds,
        tripLocationStreamEnabled: config.tripLocationStreamEnabled,
        tripLocationConsumerMaxIdleMs: config.tripLocationConsumerMaxIdleMs,
        tripLocationConsumerMaxIdleMsValid: config.tripLocationConsumerMaxIdleMsValid,
        tripLocationPersistenceWorkerEnabled: config.tripLocationPersistenceWorkerEnabled,
        tripLocationFirestorePersistenceEnabled: config.tripLocationFirestorePersistenceEnabled,
        tripLocationWorkerHealthKeyConfigured: config.tripLocationWorkerHealthKeyValid,
        tripLocationWorkerHealthMaxAgeMs: config.tripLocationWorkerHealthMaxAgeMs,
        tripLocationWorkerHealthMaxAgeMsValid: config.tripLocationWorkerHealthMaxAgeMsValid
      },
      dataset: {
        markerPresent: false,
        generationMatches: false,
        markerPersistent: false
      },
      redis: null,
      memory: null,
      streams: null
    };
  }

  async collectTripLocationWorkerHealth(redis, config) {
    if (!config.tripLocationStreamEnabled) {
      return {
        required: false,
        present: false,
        status: null,
        statusValid: true,
        heartbeatAt: null,
        heartbeatAgeMs: null,
        heartbeatFresh: true,
        maxHeartbeatAgeMs: config.tripLocationWorkerHealthMaxAgeMs,
        ttlSeconds: null,
        ttlValid: true,
        counters: {
          processedTrips: null,
          flushedPoints: null,
          failures: null
        },
        countersValid: true,
        formatValid: true,
        degraded: false
      };
    }

    const [rawHealth, healthTtlSeconds] = await Promise.all([
      redis.hgetall(config.tripLocationWorkerHealthKey),
      redis.ttl(config.tripLocationWorkerHealthKey)
    ]);
    const health = rawHealth && typeof rawHealth === 'object' ? rawHealth : {};
    const present = Object.keys(health).length > 0;
    const status = String(health.status || '').trim().toLowerCase();
    const statusValid = VALID_TRIP_LOCATION_WORKER_HEALTH_STATUSES.has(status);
    const heartbeatAt = strictInfoNumber(health, 'heartbeatAt', {
      integer: true,
      min: 1
    });
    const processedTrips = strictInfoNumber(health, 'processedTrips', {
      integer: true,
      min: 0
    });
    const flushedPoints = strictInfoNumber(health, 'flushedPoints', {
      integer: true,
      min: 0
    });
    const failures = strictInfoNumber(health, 'failures', {
      integer: true,
      min: 0
    });
    const countersValid = [processedTrips, flushedPoints, failures]
      .every((value) => value != null);
    const countersConsistent = !['healthy', 'idle'].includes(status) || failures === 0;
    const ttlSeconds = Number(healthTtlSeconds);
    const ttlValid = Number.isInteger(ttlSeconds) && ttlSeconds > 0;
    const heartbeatAgeMs = heartbeatAt == null ? null : this.now() - heartbeatAt;
    const heartbeatValid = heartbeatAt != null
      && heartbeatAgeMs >= 0
      && heartbeatAgeMs <= config.tripLocationWorkerHealthMaxAgeMs;
    const formatValid = present
      && statusValid
      && heartbeatAt != null
      && countersValid
      && countersConsistent
      && ttlValid;

    return {
      required: true,
      present,
      status: status || null,
      statusValid,
      heartbeatAt,
      heartbeatAgeMs,
      heartbeatFresh: heartbeatValid,
      maxHeartbeatAgeMs: config.tripLocationWorkerHealthMaxAgeMs,
      ttlSeconds: ttlValid ? ttlSeconds : null,
      ttlValid,
      counters: {
        processedTrips,
        flushedPoints,
        failures
      },
      countersValid,
      formatValid,
      degraded: status === 'degraded'
    };
  }

  async collectTripLocationStreamAttestation(redis, config) {
    if (!config.tripLocationStreamEnabled) {
      return {
        enabled: false,
        name: config.tripLocationStreamName,
        requiredConsumerGroup: config.tripLocationWorkerGroup,
        consumerGroupPresent: false,
        consumerActive: false,
        consumerStateValid: true,
        consumerCount: 0,
        activeConsumerCount: 0,
        minConsumerIdleMs: null,
        maxConsumerIdleMs: config.tripLocationConsumerMaxIdleMs,
        length: 0,
        trimThreshold: config.tripLocationStreamTrimThreshold
      };
    }

    let length = 0;
    let rawGroups = [];
    try {
      length = Number(await redis.xlen(config.tripLocationStreamName));
      rawGroups = await redis.xinfo('GROUPS', config.tripLocationStreamName);
    } catch (error) {
      if (!/no such key/i.test(String(error?.message || ''))) throw error;
    }

    if (!Number.isFinite(length) || length < 0) {
      const error = new Error('Invalid Redis stream length');
      error.code = 'REDIS_STREAM_LENGTH_INVALID';
      throw error;
    }

    const groups = Array.isArray(rawGroups)
      ? rawGroups.map(normalizeStreamGroup)
      : [];
    const requiredGroup = groups.find((group) => (
      String(group.name || '') === config.tripLocationWorkerGroup
    ));
    const rawConsumers = requiredGroup
      ? await redis.xinfo(
        'CONSUMERS',
        config.tripLocationStreamName,
        config.tripLocationWorkerGroup
      )
      : [];
    const consumerStateValid = Array.isArray(rawConsumers);
    const consumers = consumerStateValid
      ? rawConsumers.map(normalizeStreamConsumer)
      : [];
    const consumerRecordsValid = consumerStateValid
      && consumers.every((consumer) => consumer.valid);
    const activeConsumers = consumerRecordsValid
      ? consumers.filter((consumer) => (
        consumer.idleMs <= config.tripLocationConsumerMaxIdleMs
      ))
      : [];
    const observedIdleValues = consumerRecordsValid
      ? consumers.map((consumer) => consumer.idleMs)
      : [];

    return {
      enabled: true,
      name: config.tripLocationStreamName,
      requiredConsumerGroup: config.tripLocationWorkerGroup,
      consumerGroupPresent: Boolean(requiredGroup),
      consumerActive: activeConsumers.length > 0,
      consumerStateValid: consumerRecordsValid,
      consumerCount: consumers.length,
      activeConsumerCount: activeConsumers.length,
      minConsumerIdleMs: observedIdleValues.length > 0
        ? Math.min(...observedIdleValues)
        : null,
      maxConsumerIdleMs: config.tripLocationConsumerMaxIdleMs,
      length,
      trimThreshold: config.tripLocationStreamTrimThreshold,
      pending: requiredGroup ? Number(requiredGroup.pending || 0) : null,
      lag: requiredGroup && requiredGroup.lag != null
        ? Number(requiredGroup.lag)
        : null
    };
  }

  async collectLiveAttestation(config) {
    const checkedAt = new Date(this.now()).toISOString();

    try {
      await this.redisPool.ensureConnection();
      const redis = this.redisPool.getConnection();

      const [
        maxmemoryPolicyRaw,
        appendonlyRaw,
        appendfsyncRaw,
        persistenceRaw,
        statsRaw,
        memoryRaw,
        observedGeneration,
        generationTtl,
        tripLocationStream,
        tripLocationWorkerHealth
      ] = await Promise.all([
        redis.config('GET', 'maxmemory-policy'),
        redis.config('GET', 'appendonly'),
        redis.config('GET', 'appendfsync'),
        redis.info('persistence'),
        redis.info('stats'),
        redis.info('memory'),
        redis.get(config.generationKey),
        redis.ttl(config.generationKey),
        this.collectTripLocationStreamAttestation(redis, config),
        this.collectTripLocationWorkerHealth(redis, config)
      ]);

      const persistence = parseInfo(persistenceRaw);
      const stats = parseInfo(statsRaw);
      const memory = parseInfo(memoryRaw);
      const maxmemoryPolicy = parseConfigGet(maxmemoryPolicyRaw, 'maxmemory-policy');
      const appendonly = parseConfigGet(appendonlyRaw, 'appendonly');
      const appendfsync = parseConfigGet(appendfsyncRaw, 'appendfsync');
      const aofLastWriteStatus = String(persistence.aof_last_write_status || '').toLowerCase();
      const aofEnabled = strictInfoNumber(persistence, 'aof_enabled', {
        integer: true,
        min: 0
      });
      const evictedKeys = strictInfoNumber(stats, 'evicted_keys', {
        integer: true,
        min: 0
      });
      const usedMemoryBytes = strictInfoNumber(memory, 'used_memory', {
        integer: true,
        min: 0
      });
      const maxmemoryBytes = strictInfoNumber(memory, 'maxmemory', {
        integer: true,
        min: 0
      });
      const maxmemoryMatchesApproved = maxmemoryBytes != null
        && maxmemoryBytes === APPROVED_MAXMEMORY_BYTES;
      const memoryUsagePercent = usedMemoryBytes != null && maxmemoryBytes > 0
        ? Number(((usedMemoryBytes / maxmemoryBytes) * 100).toFixed(2))
        : null;
      const markerPresent = typeof observedGeneration === 'string' && observedGeneration.length > 0;
      const generationMatches = markerPresent && observedGeneration === config.generation;
      const markerPersistent = Number(generationTtl) === -1;
      const blockers = [];

      if (maxmemoryPolicy !== 'noeviction') blockers.push('maxmemory_policy_not_noeviction');
      if (appendonly !== 'yes') blockers.push('appendonly_not_enabled');
      if (appendfsync !== 'everysec') blockers.push('appendfsync_not_everysec');
      if (aofEnabled !== 1) blockers.push('aof_enabled_not_one');
      if (aofLastWriteStatus !== 'ok') blockers.push('aof_last_write_status_not_ok');
      if (evictedKeys == null) blockers.push('evicted_keys_invalid');
      if (evictedKeys != null && evictedKeys !== 0) blockers.push('evicted_keys_nonzero');
      if (usedMemoryBytes == null) blockers.push('used_memory_invalid');
      if (maxmemoryBytes == null) blockers.push('maxmemory_invalid');
      if (maxmemoryBytes === 0) blockers.push('maxmemory_not_configured');
      if (maxmemoryBytes > 0 && !maxmemoryMatchesApproved) {
        blockers.push('maxmemory_not_approved');
      }
      if (memoryUsagePercent == null || memoryUsagePercent >= config.thresholds.criticalPercent) {
        blockers.push('memory_usage_critical');
      }
      if (!markerPresent) blockers.push('dataset_generation_marker_missing');
      if (markerPresent && !generationMatches) blockers.push('dataset_generation_mismatch');
      if (markerPresent && !markerPersistent) blockers.push('dataset_generation_marker_not_persistent');
      if (
        tripLocationStream.enabled
        && !tripLocationStream.consumerGroupPresent
      ) {
        blockers.push('trip_location_stream_consumer_missing');
      }
      if (
        tripLocationStream.enabled
        && tripLocationStream.consumerGroupPresent
        && !tripLocationStream.consumerStateValid
      ) {
        blockers.push('trip_location_stream_consumer_probe_invalid');
      }
      if (
        tripLocationStream.enabled
        && tripLocationStream.consumerGroupPresent
        && tripLocationStream.consumerStateValid
        && !tripLocationStream.consumerActive
      ) {
        blockers.push('trip_location_stream_consumer_inactive');
      }
      if (
        tripLocationStream.enabled
        && tripLocationStream.length > tripLocationStream.trimThreshold
      ) {
        blockers.push('trip_location_stream_backlog_critical');
      }
      if (tripLocationWorkerHealth.required) {
        if (!tripLocationWorkerHealth.present) {
          blockers.push('trip_location_worker_health_missing');
        } else {
          if (!tripLocationWorkerHealth.formatValid) {
            blockers.push('trip_location_worker_health_invalid');
          }
          if (
            tripLocationWorkerHealth.formatValid
            && !tripLocationWorkerHealth.heartbeatFresh
          ) {
            blockers.push('trip_location_worker_health_stale');
          }
          if (tripLocationWorkerHealth.degraded) {
            blockers.push('trip_location_worker_health_degraded');
          }
        }
      }

      let memoryLevel = 'normal';
      if (memoryUsagePercent != null && memoryUsagePercent >= config.thresholds.criticalPercent) {
        memoryLevel = 'critical';
      } else if (memoryUsagePercent != null && memoryUsagePercent >= config.thresholds.highPercent) {
        memoryLevel = 'high';
      } else if (memoryUsagePercent != null && memoryUsagePercent >= config.thresholds.warningPercent) {
        memoryLevel = 'warning';
      }

      const ready = blockers.length === 0;
      const quarantined = !ready && config.quarantineEnabled;
      return {
        ready,
        status: ready
          ? (memoryLevel === 'normal' ? 'healthy' : memoryLevel)
          : (quarantined ? 'quarantined' : 'unhealthy'),
        quarantined,
        checkedAt,
        blockers,
        configuration: {
          enabled: config.enabled,
          quarantineEnabled: config.quarantineEnabled,
          generationConfigured: config.generationConfigured,
          generationKeyValid: config.generationKeyValid,
          thresholdPolicyMatches: config.thresholdPolicyMatches,
          thresholds: config.thresholds,
          tripLocationStreamEnabled: config.tripLocationStreamEnabled,
          tripLocationConsumerMaxIdleMs: config.tripLocationConsumerMaxIdleMs,
          tripLocationConsumerMaxIdleMsValid: config.tripLocationConsumerMaxIdleMsValid,
          tripLocationPersistenceWorkerEnabled: config.tripLocationPersistenceWorkerEnabled,
          tripLocationFirestorePersistenceEnabled: config.tripLocationFirestorePersistenceEnabled,
          tripLocationWorkerHealthKeyConfigured: config.tripLocationWorkerHealthKeyValid,
          tripLocationWorkerHealthMaxAgeMs: config.tripLocationWorkerHealthMaxAgeMs,
          tripLocationWorkerHealthMaxAgeMsValid: config.tripLocationWorkerHealthMaxAgeMsValid
        },
        dataset: {
          markerPresent,
          generationMatches,
          markerPersistent
        },
        redis: {
          maxmemoryPolicy,
          appendonly,
          appendfsync,
          aofEnabled,
          aofLastWriteStatus,
          evictedKeys
        },
        memory: {
          level: memoryLevel,
          usagePercent: memoryUsagePercent,
          usedMemoryBytes,
          maxmemoryBytes,
          approvedMaxmemoryBytes: APPROVED_MAXMEMORY_BYTES,
          maxmemoryMatchesApproved
        },
        streams: {
          tripLocation: {
            ...tripLocationStream,
            persistence: tripLocationWorkerHealth
          }
        }
      };
    } catch (error) {
      return {
        ready: false,
        status: config.quarantineEnabled ? 'quarantined' : 'unhealthy',
        quarantined: config.quarantineEnabled,
        checkedAt,
        blockers: ['redis_attestation_probe_failed'],
        error: {
          code: publicErrorCode(error),
          message: 'Redis attestation probe failed'
        },
        configuration: {
          enabled: config.enabled,
          quarantineEnabled: config.quarantineEnabled,
          generationConfigured: config.generationConfigured,
          generationKeyValid: config.generationKeyValid,
          thresholdPolicyMatches: config.thresholdPolicyMatches,
          thresholds: config.thresholds,
          tripLocationPersistenceWorkerEnabled: config.tripLocationPersistenceWorkerEnabled,
          tripLocationFirestorePersistenceEnabled: config.tripLocationFirestorePersistenceEnabled,
          tripLocationWorkerHealthKeyConfigured: config.tripLocationWorkerHealthKeyValid,
          tripLocationWorkerHealthMaxAgeMs: config.tripLocationWorkerHealthMaxAgeMs,
          tripLocationWorkerHealthMaxAgeMsValid: config.tripLocationWorkerHealthMaxAgeMsValid
        },
        dataset: {
          markerPresent: false,
          generationMatches: false,
          markerPersistent: false
        },
        redis: null,
        memory: null,
        streams: null
      };
    }
  }

  async attest(options = {}) {
    const env = options.env || process.env;
    const config = this.getConfiguration(env);
    const forceRefresh = options.forceRefresh === true;

    if (
      !config.enabled
      || !config.quarantineEnabled
      || !config.generationConfigured
      || !config.generationKeyValid
      || !config.thresholdPolicyMatches
      || !config.tripLocationConsumerMaxIdleMsValid
      || !config.tripLocationPersistenceWorkerEnabled
      || !config.tripLocationFirestorePersistenceEnabled
      || (config.tripLocationStreamEnabled && !config.tripLocationWorkerHealthKeyValid)
      || (config.tripLocationStreamEnabled && !config.tripLocationWorkerHealthMaxAgeMsValid)
    ) {
      const payload = this.buildDisabledAttestation(config);
      this.setCachedAttestation(payload, config);
      return payload;
    }

    if (!forceRefresh) {
      const cached = this.getCachedAttestation(config);
      if (cached) return cached;
    }

    const configurationKey = this.getConfigurationCacheKey(config);
    if (!this.inFlight || this.inFlight.configurationKey !== configurationKey) {
      this.inFlight = {
        configurationKey,
        promise: this.collectLiveAttestation(config)
      };
    }

    const currentInFlight = this.inFlight;
    try {
      const payload = await currentInFlight.promise;
      this.setCachedAttestation(payload, config);
      return payload;
    } finally {
      if (this.inFlight === currentInFlight) {
        this.inFlight = null;
      }
    }
  }

  async assertReady(options = {}) {
    const attestation = await this.attest(options);
    if (!attestation.ready) {
      throw new RedisCriticalAuthorityNotReadyError(attestation);
    }
    return attestation;
  }
}

const redisCriticalAuthorityService = new RedisCriticalAuthorityService();

module.exports = redisCriticalAuthorityService;
module.exports.RedisCriticalAuthorityService = RedisCriticalAuthorityService;
module.exports.RedisCriticalAuthorityNotReadyError = RedisCriticalAuthorityNotReadyError;
module.exports.APPROVED_MEMORY_THRESHOLDS = APPROVED_MEMORY_THRESHOLDS;
module.exports.DEFAULT_GENERATION_KEY = DEFAULT_GENERATION_KEY;
module.exports.APPROVED_MAXMEMORY_BYTES = APPROVED_MAXMEMORY_BYTES;
module.exports.DEFAULT_TRIP_LOCATION_STREAM_TRIM_THRESHOLD = DEFAULT_TRIP_LOCATION_STREAM_TRIM_THRESHOLD;
module.exports.DEFAULT_TRIP_LOCATION_CONSUMER_MAX_IDLE_MS = DEFAULT_TRIP_LOCATION_CONSUMER_MAX_IDLE_MS;
