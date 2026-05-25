const firebaseConfig = require('../firebase-config');
const redisPool = require('../utils/redis-pool');

const POLICY_COLLECTION = 'ops_area_policies';
const REQUEST_COUNTER_PREFIX = 'ops:area:requests';
const MODES = new Set(['normal', 'monitoring', 'tight', 'restricted']);

function toIso(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? fallback : dt.toISOString();
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const dt = value.toDate();
    return Number.isNaN(dt.getTime()) ? fallback : dt.toISOString();
  }
  return fallback;
}

function normalizeInteger(value, fallback = null) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inferCity(input = {}) {
  return String(
    input.city
      || input.cityName
      || input.pickupCity
      || input.metadata?.city
      || process.env.DEFAULT_OPERATIONS_CITY
      || 'default'
  ).trim();
}

function normalizePolicy(policyId, raw = {}) {
  const createdAt = toIso(raw.createdAt, new Date().toISOString());
  const updatedAt = toIso(raw.updatedAt, createdAt);

  return {
    policyId,
    city: inferCity(raw),
    regionHash: String(raw.regionHash || '*').trim() || '*',
    dispatchMode: MODES.has(String(raw.dispatchMode || '').toLowerCase())
      ? String(raw.dispatchMode).toLowerCase()
      : 'normal',
    maxNewRequestsPerMinute: normalizeInteger(raw.maxNewRequestsPerMinute, null),
    minAvailableDrivers: normalizeInteger(raw.minAvailableDrivers, null),
    surgeAllowed: raw.surgeAllowed !== false,
    allowQueueExpansion: raw.allowQueueExpansion !== false,
    allowReassignment: raw.allowReassignment !== false,
    active: raw.active === true,
    startsAtHour: normalizeInteger(raw.startsAtHour, null),
    endsAtHour: normalizeInteger(raw.endsAtHour, null),
    notes: raw.notes || '',
    createdBy: raw.createdBy || null,
    updatedBy: raw.updatedBy || null,
    activatedAt: toIso(raw.activatedAt, null),
    deactivatedAt: toIso(raw.deactivatedAt, null),
    createdAt,
    updatedAt,
    auditTrail: Array.isArray(raw.auditTrail) ? raw.auditTrail : []
  };
}

function isHourWithinWindow(policy, date = new Date()) {
  if (!Number.isFinite(policy.startsAtHour) || !Number.isFinite(policy.endsAtHour)) {
    return true;
  }

  const hour = date.getHours();
  if (policy.startsAtHour === policy.endsAtHour) {
    return true;
  }
  if (policy.startsAtHour < policy.endsAtHour) {
    return hour >= policy.startsAtHour && hour < policy.endsAtHour;
  }
  return hour >= policy.startsAtHour || hour < policy.endsAtHour;
}

function sortPolicySpecificity(left, right) {
  const leftScore = (left.regionHash && left.regionHash !== '*') ? 2 : 1;
  const rightScore = (right.regionHash && right.regionHash !== '*') ? 2 : 1;
  if (leftScore !== rightScore) return rightScore - leftScore;
  return new Date(right.updatedAt || 0).getTime() - new Date(left.updatedAt || 0).getTime();
}

class OperationalAreaPolicyService {
  constructor({ firebase = firebaseConfig, redis = redisPool } = {}) {
    this.firebase = firebase;
    this.redisPool = redis;
  }

  getFirestore() {
    return this.firebase?.getFirestore ? this.firebase.getFirestore() : null;
  }

  getRedis() {
    return this.redisPool?.getConnection ? this.redisPool.getConnection() : null;
  }

  policyCollection() {
    const firestore = this.getFirestore();
    return firestore ? firestore.collection(POLICY_COLLECTION) : null;
  }

  async listPolicies({ city = null, regionHash = null, activeOnly = false } = {}) {
    const collection = this.policyCollection();
    if (!collection) return [];

    const snapshot = await collection.get();
    let policies = snapshot.docs.map((doc) => normalizePolicy(doc.id, doc.data()));

    if (city) {
      policies = policies.filter((policy) => policy.city === inferCity({ city }));
    }
    if (regionHash) {
      policies = policies.filter((policy) => policy.regionHash === regionHash || policy.regionHash === '*');
    }
    if (activeOnly) {
      const now = new Date();
      policies = policies.filter((policy) => policy.active && isHourWithinWindow(policy, now));
    }

    policies.sort(sortPolicySpecificity);
    return policies;
  }

  async createPolicy({
    city,
    regionHash = '*',
    dispatchMode = 'normal',
    maxNewRequestsPerMinute = null,
    minAvailableDrivers = null,
    surgeAllowed = true,
    allowQueueExpansion = true,
    allowReassignment = true,
    startsAtHour = null,
    endsAtHour = null,
    notes = '',
    actorId = 'system'
  } = {}) {
    const collection = this.policyCollection();
    if (!collection) {
      throw new Error('Firestore indisponível para políticas operacionais');
    }

    const policyId = `OPS-POLICY-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const now = new Date().toISOString();
    const policy = normalizePolicy(policyId, {
      city,
      regionHash,
      dispatchMode,
      maxNewRequestsPerMinute,
      minAvailableDrivers,
      surgeAllowed,
      allowQueueExpansion,
      allowReassignment,
      startsAtHour,
      endsAtHour,
      notes,
      active: false,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
      auditTrail: [{ action: 'created', actorId, at: now }]
    });

    await collection.doc(policyId).set(policy, { merge: true });
    return policy;
  }

  async getPolicy(policyId) {
    const collection = this.policyCollection();
    if (!collection) return null;

    const snapshot = await collection.doc(String(policyId)).get();
    if (!snapshot.exists) return null;
    return normalizePolicy(snapshot.id, snapshot.data());
  }

  async updatePolicyActivation(policyId, active, actorId = 'system') {
    const collection = this.policyCollection();
    if (!collection) {
      throw new Error('Firestore indisponível para políticas operacionais');
    }

    const current = await this.getPolicy(policyId);
    if (!current) {
      throw new Error('Política operacional não encontrada');
    }

    const now = new Date().toISOString();
    const patch = normalizePolicy(policyId, {
      ...current,
      active,
      activatedAt: active ? now : current.activatedAt,
      deactivatedAt: active ? null : now,
      updatedAt: now,
      updatedBy: actorId,
      auditTrail: [...current.auditTrail, { action: active ? 'activated' : 'deactivated', actorId, at: now }]
    });

    await collection.doc(policyId).set(patch, { merge: true });
    return patch;
  }

  async activatePolicy(policyId, { actorId = 'system' } = {}) {
    return this.updatePolicyActivation(policyId, true, actorId);
  }

  async deactivatePolicy(policyId, { actorId = 'system' } = {}) {
    return this.updatePolicyActivation(policyId, false, actorId);
  }

  async getApplicablePolicy({ city, regionHash, now = new Date() } = {}) {
    const policies = await this.listPolicies({ city, regionHash, activeOnly: true });
    return policies[0] || null;
  }

  buildCounterKey(policy, regionHash, date = new Date()) {
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const day = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
    return `${REQUEST_COUNTER_PREFIX}:${policy?.policyId || 'default'}:${regionHash || '*'}:${day}${hour}${minute}`;
  }

  async getCurrentMinuteRequests(policy, regionHash, now = new Date()) {
    const redis = this.getRedis();
    if (!redis || !policy) return 0;

    const current = await redis.get(this.buildCounterKey(policy, regionHash, now)).catch(() => '0');
    return normalizeInteger(current, 0) || 0;
  }

  async recordAcceptedRequest(policy, regionHash, now = new Date()) {
    if (!policy) return null;

    const redis = this.getRedis();
    if (!redis) return null;

    const key = this.buildCounterKey(policy, regionHash, now);
    const nextValue = await redis.incr(key).catch(() => null);
    await redis.expire(key, 120).catch(() => null);
    return nextValue;
  }

  async evaluateCreateBooking({
    city,
    regionHash,
    openRequests = 0,
    availableDrivers = 0,
    now = new Date()
  } = {}) {
    const policy = await this.getApplicablePolicy({ city, regionHash, now });
    if (!policy) {
      return {
        allowed: true,
        dispatchMode: 'normal',
        policy: null,
        reasons: [],
        metrics: { openRequests, availableDrivers, requestsThisMinute: 0 }
      };
    }

    const requestsThisMinute = await this.getCurrentMinuteRequests(policy, regionHash, now);
    const reasons = [];
    let allowed = true;

    if (Number.isFinite(policy.minAvailableDrivers) && availableDrivers < policy.minAvailableDrivers) {
      reasons.push(`available_drivers_below_min:${availableDrivers}<${policy.minAvailableDrivers}`);
      if (policy.dispatchMode === 'restricted') {
        allowed = false;
      }
    }

    if (Number.isFinite(policy.maxNewRequestsPerMinute) && requestsThisMinute >= policy.maxNewRequestsPerMinute) {
      reasons.push(`requests_per_minute_exceeded:${requestsThisMinute}>=${policy.maxNewRequestsPerMinute}`);
      if (policy.dispatchMode === 'restricted') {
        allowed = false;
      }
    }

    if (!policy.allowQueueExpansion && openRequests > Math.max(1, (policy.maxNewRequestsPerMinute || 1))) {
      reasons.push('queue_expansion_disabled_under_pressure');
      if (policy.dispatchMode === 'restricted') {
        allowed = false;
      }
    }

    return {
      allowed,
      dispatchMode: policy.dispatchMode,
      policy,
      reasons,
      metrics: {
        openRequests,
        availableDrivers,
        requestsThisMinute
      }
    };
  }
}

const operationalAreaPolicyService = new OperationalAreaPolicyService();
module.exports = operationalAreaPolicyService;
module.exports.OperationalAreaPolicyService = OperationalAreaPolicyService;
module.exports.normalizePolicy = normalizePolicy;
module.exports.inferCity = inferCity;
