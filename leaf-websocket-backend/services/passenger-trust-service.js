const firebaseConfig = require('../firebase-config');

const TRUST_COLLECTION = 'ops_passenger_trust';
const STATUS = {
  ACTIVE: 'ACTIVE',
  WATCHLIST: 'WATCHLIST',
  SOFT_BLOCKED: 'SOFT_BLOCKED',
  HARD_BLOCKED: 'HARD_BLOCKED'
};
const DEFAULT_THRESHOLDS = {
  WATCHLIST: 40,
  SOFT_BLOCKED: 70,
  HARD_BLOCKED: 90
};
const SIGNAL_WEIGHTS = {
  abusive_cancellation: 15,
  confirmed_incident: 30,
  chargeback_abuse: 35,
  confirmed_report: 20,
  payment_fraud_attempt: 50,
  manual_watchlist: 40,
  manual_soft_block: 70,
  manual_hard_block: 100,
  unblock_reset: -100,
  dispute_abuse: 25
};

function clampScore(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

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

function defaultProfile(userId) {
  const now = new Date().toISOString();
  return {
    userId: String(userId || ''),
    trustStatus: STATUS.ACTIVE,
    trustScore: 0,
    thresholds: { ...DEFAULT_THRESHOLDS },
    signals: [],
    manualActions: [],
    linkedRefs: {
      incidents: [],
      tickets: [],
      disputes: []
    },
    blockedUntil: null,
    lastReasonCode: null,
    updatedAt: now,
    createdAt: now
  };
}

function uniqueTail(list = [], nextValue, limit = 20) {
  const merged = [...(Array.isArray(list) ? list : []), nextValue].filter(Boolean);
  return [...new Set(merged)].slice(-limit);
}

function normalizeProfile(userId, raw = {}) {
  const base = defaultProfile(userId);
  return {
    ...base,
    ...raw,
    userId: String(raw.userId || userId || ''),
    trustStatus: Object.values(STATUS).includes(String(raw.trustStatus || '').toUpperCase())
      ? String(raw.trustStatus).toUpperCase()
      : base.trustStatus,
    trustScore: clampScore(raw.trustScore),
    thresholds: {
      ...DEFAULT_THRESHOLDS,
      ...(raw.thresholds && typeof raw.thresholds === 'object' ? raw.thresholds : {})
    },
    signals: Array.isArray(raw.signals) ? raw.signals : [],
    manualActions: Array.isArray(raw.manualActions) ? raw.manualActions : [],
    linkedRefs: {
      incidents: Array.isArray(raw.linkedRefs?.incidents) ? raw.linkedRefs.incidents : [],
      tickets: Array.isArray(raw.linkedRefs?.tickets) ? raw.linkedRefs.tickets : [],
      disputes: Array.isArray(raw.linkedRefs?.disputes) ? raw.linkedRefs.disputes : []
    },
    blockedUntil: toIso(raw.blockedUntil, null),
    updatedAt: toIso(raw.updatedAt, base.updatedAt),
    createdAt: toIso(raw.createdAt, base.createdAt)
  };
}

class PassengerTrustService {
  constructor({ firebase = firebaseConfig } = {}) {
    this.firebase = firebase;
  }

  getFirestore() {
    return this.firebase?.getFirestore ? this.firebase.getFirestore() : null;
  }

  profileDoc(userId) {
    const firestore = this.getFirestore();
    if (!firestore) return null;
    return firestore.collection(TRUST_COLLECTION).doc(String(userId));
  }

  evaluateStatus(score, existingStatus = STATUS.ACTIVE) {
    const numericScore = clampScore(score);
    if (numericScore >= DEFAULT_THRESHOLDS.HARD_BLOCKED) return STATUS.HARD_BLOCKED;
    if (numericScore >= DEFAULT_THRESHOLDS.SOFT_BLOCKED) return STATUS.SOFT_BLOCKED;
    if (numericScore >= DEFAULT_THRESHOLDS.WATCHLIST) return STATUS.WATCHLIST;
    if ([STATUS.SOFT_BLOCKED, STATUS.HARD_BLOCKED].includes(existingStatus)) {
      return STATUS.WATCHLIST;
    }
    return STATUS.ACTIVE;
  }

  async getProfile(userId) {
    if (!userId) {
      throw new Error('userId é obrigatório');
    }

    const docRef = this.profileDoc(userId);
    if (!docRef) {
      return defaultProfile(userId);
    }

    const snapshot = await docRef.get();
    if (!snapshot.exists) {
      return defaultProfile(userId);
    }

    return normalizeProfile(userId, snapshot.data());
  }

  async persistProfile(userId, patch = {}) {
    const docRef = this.profileDoc(userId);
    const nextProfile = normalizeProfile(userId, {
      ...(await this.getProfile(userId)),
      ...patch,
      updatedAt: new Date().toISOString()
    });

    if (docRef) {
      await docRef.set(nextProfile, { merge: true });
    }

    return nextProfile;
  }

  async recordSignal(userId, signalType, {
    weight = null,
    metadata = {},
    reasonCode = null,
    incidentId = null,
    ticketId = null,
    disputeId = null,
    actorId = 'system'
  } = {}) {
    const profile = await this.getProfile(userId);
    const signalWeight = weight != null && Number.isFinite(Number(weight))
      ? Number(weight)
      : (SIGNAL_WEIGHTS[signalType] || 0);
    const nextScore = clampScore(profile.trustScore + signalWeight);
    const nextStatus = this.evaluateStatus(nextScore, profile.trustStatus);
    const signalEntry = {
      type: String(signalType || 'unknown'),
      weight: signalWeight,
      metadata,
      reasonCode: reasonCode || null,
      actorId,
      incidentId: incidentId || null,
      ticketId: ticketId || null,
      disputeId: disputeId || null,
      createdAt: new Date().toISOString()
    };

    return this.persistProfile(userId, {
      trustScore: nextScore,
      trustStatus: nextStatus,
      lastReasonCode: reasonCode || profile.lastReasonCode || null,
      signals: [...profile.signals.slice(-49), signalEntry],
      linkedRefs: {
        incidents: incidentId ? uniqueTail(profile.linkedRefs.incidents, incidentId) : profile.linkedRefs.incidents,
        tickets: ticketId ? uniqueTail(profile.linkedRefs.tickets, ticketId) : profile.linkedRefs.tickets,
        disputes: disputeId ? uniqueTail(profile.linkedRefs.disputes, disputeId) : profile.linkedRefs.disputes
      }
    });
  }

  async applyManualAction(userId, action, {
    operatorId,
    reasonCode,
    evidenceRefs = [],
    expiresAt = null,
    notes = null
  } = {}) {
    const profile = await this.getProfile(userId);
    const now = new Date().toISOString();
    const normalizedAction = String(action || '').toLowerCase();
    const actionEntry = {
      action: normalizedAction,
      operatorId: operatorId || 'unknown',
      reasonCode: reasonCode || null,
      evidenceRefs: Array.isArray(evidenceRefs) ? evidenceRefs : [],
      expiresAt: expiresAt || null,
      notes: notes || null,
      createdAt: now
    };

    let trustStatus = profile.trustStatus;
    let trustScore = profile.trustScore;
    let blockedUntil = profile.blockedUntil;

    if (normalizedAction === 'watchlist') {
      trustScore = Math.max(profile.trustScore, DEFAULT_THRESHOLDS.WATCHLIST);
      trustStatus = STATUS.WATCHLIST;
    } else if (normalizedAction === 'block') {
      trustScore = Math.max(profile.trustScore, DEFAULT_THRESHOLDS.HARD_BLOCKED);
      trustStatus = STATUS.HARD_BLOCKED;
      blockedUntil = expiresAt || null;
    } else if (normalizedAction === 'soft_block') {
      trustScore = Math.max(profile.trustScore, DEFAULT_THRESHOLDS.SOFT_BLOCKED);
      trustStatus = STATUS.SOFT_BLOCKED;
      blockedUntil = expiresAt || null;
    } else if (normalizedAction === 'unblock') {
      trustStatus = STATUS.ACTIVE;
      trustScore = Math.min(profile.trustScore, DEFAULT_THRESHOLDS.WATCHLIST - 1);
      blockedUntil = null;
    }

    return this.persistProfile(userId, {
      trustStatus,
      trustScore,
      blockedUntil,
      lastReasonCode: reasonCode || profile.lastReasonCode || null,
      manualActions: [...profile.manualActions.slice(-49), actionEntry]
    });
  }

  async watchlistPassenger(userId, options = {}) {
    return this.applyManualAction(userId, 'watchlist', options);
  }

  async blockPassenger(userId, options = {}) {
    const action = options.soft === true ? 'soft_block' : 'block';
    return this.applyManualAction(userId, action, options);
  }

  async unblockPassenger(userId, options = {}) {
    return this.applyManualAction(userId, 'unblock', options);
  }

  async checkEligibility(userId) {
    const profile = await this.getProfile(userId);
    const now = Date.now();
    const blockedUntilMs = profile.blockedUntil ? Date.parse(profile.blockedUntil) : null;
    const blockActive = blockedUntilMs && Number.isFinite(blockedUntilMs) ? blockedUntilMs > now : false;

    if (profile.trustStatus === STATUS.HARD_BLOCKED && (!profile.blockedUntil || blockActive)) {
      return {
        allowed: false,
        code: 'PASSENGER_HARD_BLOCKED',
        reason: 'Passageiro bloqueado para novas corridas',
        profile
      };
    }

    if (profile.trustStatus === STATUS.SOFT_BLOCKED && (!profile.blockedUntil || blockActive)) {
      return {
        allowed: false,
        code: 'PASSENGER_SOFT_BLOCKED',
        reason: 'Passageiro temporariamente impedido de solicitar novas corridas',
        profile
      };
    }

    return {
      allowed: true,
      code: profile.trustStatus === STATUS.WATCHLIST ? 'PASSENGER_WATCHLIST' : 'PASSENGER_ACTIVE',
      reason: profile.trustStatus === STATUS.WATCHLIST
        ? 'Passageiro em observação operacional'
        : 'Passageiro apto para novas corridas',
      profile
    };
  }
}

const passengerTrustService = new PassengerTrustService();
module.exports = passengerTrustService;
module.exports.PassengerTrustService = PassengerTrustService;
module.exports.STATUS = STATUS;
module.exports.DEFAULT_THRESHOLDS = DEFAULT_THRESHOLDS;
module.exports.SIGNAL_WEIGHTS = SIGNAL_WEIGHTS;
module.exports.normalizeProfile = normalizeProfile;
