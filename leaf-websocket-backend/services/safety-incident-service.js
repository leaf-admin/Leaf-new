const firebaseConfig = require('../firebase-config');
const redisPool = require('../utils/redis-pool');
const supportQueueService = require('./support-queue-service');
const passengerTrustService = require('./passenger-trust-service');
const {
  resolvePersistenceScope
} = require('./sandbox-persistence-context');

const INCIDENT_COLLECTION = 'ops_incidents';
const OPEN_INCIDENTS_KEY = 'ops:incidents:open';
const INCIDENT_HASH_PREFIX = 'ops:incident';
const OPEN_STATUSES = new Set(['OPEN', 'ACKED', 'IN_TRIAGE', 'DISPATCHED']);
const RESOLUTION_SIGNAL_CODES = new Set(['confirmed_incident', 'confirmed_abuse', 'fraud_confirmed']);

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

function normalizeSeverity(value) {
  const severity = String(value || 'medium').toLowerCase();
  if (['low', 'medium', 'high', 'critical'].includes(severity)) return severity;
  return 'medium';
}

function normalizeCategory(value) {
  const category = String(value || 'safety').toLowerCase();
  if (['safety', 'emergency', 'support', 'payment', 'fraud', 'operational'].includes(category)) {
    return category;
  }
  return 'safety';
}

function inferPriority(category, severity) {
  if (category === 'emergency' || severity === 'critical') return 'N1';
  if (category === 'safety' || severity === 'high') return 'N1';
  if (category === 'fraud') return 'N2';
  return 'N3';
}

function normalizeIncident(incidentId, raw = {}) {
  const openedAt = toIso(raw.openedAt, new Date().toISOString());
  const updatedAt = toIso(raw.updatedAt, openedAt);
  return {
    incidentId,
    bookingId: raw.bookingId || null,
    ticketId: raw.ticketId || null,
    userId: String(raw.userId || ''),
    userType: String(raw.userType || 'passenger'),
    city: String(raw.city || 'default'),
    regionHash: String(raw.regionHash || '*'),
    category: normalizeCategory(raw.category || raw.type),
    severity: normalizeSeverity(raw.severity),
    description: String(raw.description || '').trim(),
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    location: raw.location && typeof raw.location === 'object' ? raw.location : null,
    status: String(raw.status || 'OPEN').toUpperCase(),
    assignedTo: raw.assignedTo || null,
    ackedAt: toIso(raw.ackedAt, null),
    slaTargetAt: toIso(raw.slaTargetAt, null),
    resolutionCode: raw.resolutionCode || null,
    resolvedAt: toIso(raw.resolvedAt, null),
    closedAt: toIso(raw.closedAt, null),
    openedAt,
    updatedAt,
    timeline: Array.isArray(raw.timeline) ? raw.timeline : [],
    financialContext: raw.financialContext || null,
    financialNamespace: raw.financialNamespace || raw.financialContext?.namespace || null,
    financialContextId: raw.financialContextId || raw.financialContext?.contextId || null
  };
}

class SafetyIncidentService {
  constructor({
    firebase = firebaseConfig,
    redis = redisPool,
    queueService = supportQueueService,
    trustService = passengerTrustService
  } = {}) {
    this.firebase = firebase;
    this.redisPool = redis;
    this.queueService = queueService;
    this.trustService = trustService;
  }

  getFirestore() {
    return this.firebase?.getFirestore ? this.firebase.getFirestore() : null;
  }

  getRealtimeDb() {
    return this.firebase?.getRealtimeDB ? this.firebase.getRealtimeDB() : null;
  }

  getRedis() {
    return this.redisPool?.getConnection ? this.redisPool.getConnection() : null;
  }

  incidentDoc(incidentId, persistenceContext = null) {
    const firestore = this.getFirestore();
    if (!firestore) return null;
    const persistenceScope = resolvePersistenceScope(persistenceContext || {}, {
      allowLegacyOperational: true,
      allowExplicitSandboxAccess: true
    });
    return firestore.collection(
      persistenceScope.collections.incidents || INCIDENT_COLLECTION
    ).doc(String(incidentId));
  }

  async updateRedisIndexes(incident, persistenceContext = null) {
    const redis = this.getRedis();
    if (!redis || !incident?.incidentId) return;
    const persistenceScope = resolvePersistenceScope(persistenceContext || incident, {
      allowLegacyOperational: true,
      allowExplicitSandboxAccess: true
    });

    const score = Date.parse(incident.openedAt || new Date().toISOString()) || Date.now();
    const namespacePrefix = persistenceScope.namespace === 'sandbox' ? 'sandbox:' : '';
    const incidentKey = `${namespacePrefix}${INCIDENT_HASH_PREFIX}:${incident.incidentId}`;
    const openIncidentsKey = `${namespacePrefix}${OPEN_INCIDENTS_KEY}`;
    await Promise.resolve(redis.hset(incidentKey, {
      incidentId: incident.incidentId,
      bookingId: incident.bookingId || '',
      ticketId: incident.ticketId || '',
      userId: incident.userId || '',
      city: incident.city || 'default',
      regionHash: incident.regionHash || '*',
      category: incident.category || 'safety',
      severity: incident.severity || 'medium',
      status: incident.status || 'OPEN',
      openedAt: incident.openedAt || '',
      updatedAt: incident.updatedAt || ''
    })).catch(() => null);
    await Promise.resolve(redis.expire(incidentKey, 7 * 24 * 3600)).catch(() => null);

    if (OPEN_STATUSES.has(incident.status)) {
      await Promise.resolve(redis.zadd(openIncidentsKey, score, incident.incidentId)).catch(() => null);
    } else {
      await Promise.resolve(redis.zrem(openIncidentsKey, incident.incidentId)).catch(() => null);
    }
  }

  async markBookingForOpsReview(bookingId, incident, persistenceContext = null) {
    if (!bookingId) return;

    const persistenceScope = resolvePersistenceScope(persistenceContext || incident, {
      allowLegacyOperational: true,
      allowExplicitSandboxAccess: true
    });
    const now = new Date().toISOString();
    const redis = this.getRedis();
    const realtimeDb = this.getRealtimeDb();

    // O lifecycle sandbox ainda usa Redis efêmero compartilhado no runtime.
    // Não anexamos flags operacionais nele; a evidência fica no root RTDB isolado.
    if (redis && persistenceScope.namespace === 'operational') {
      await redis.hset(`booking:${bookingId}`, {
        opsReviewRequired: 'true',
        opsReviewIncidentId: incident.incidentId,
        opsReviewReason: incident.category,
        opsReviewUpdatedAt: now
      }).catch(() => null);
    }

    if (realtimeDb) {
      await realtimeDb.ref(`${persistenceScope.collections.bookings}/${bookingId}`).update({
        opsReviewRequired: true,
        opsReviewIncidentId: incident.incidentId,
        opsReviewReason: incident.category,
        opsReviewUpdatedAt: now
      }).catch(() => null);
    }
  }

  async createIncident({
    bookingId = null,
    userId,
    userType = 'passenger',
    city = 'default',
    regionHash = '*',
    category = 'safety',
    severity = 'medium',
    description,
    evidence = [],
    location = null,
    actorId = null,
    persistenceContext = null
  } = {}) {
    if (!userId) throw new Error('userId é obrigatório');
    if (!description) throw new Error('description é obrigatória');

    const persistenceScope = resolvePersistenceScope(persistenceContext || {}, {
      allowLegacyOperational: true,
      allowExplicitSandboxAccess: true
    });

    const incidentId = `INC-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const openedAt = new Date().toISOString();
    const normalizedCategory = normalizeCategory(category);
    const normalizedSeverity = normalizeSeverity(severity);
    const priority = inferPriority(normalizedCategory, normalizedSeverity);
    const incident = normalizeIncident(incidentId, {
      bookingId,
      userId,
      userType,
      city,
      regionHash,
      category: normalizedCategory,
      severity: normalizedSeverity,
      description,
      evidence,
      location,
      status: 'OPEN',
      openedAt,
      updatedAt: openedAt,
      slaTargetAt: this.queueService.buildQueueMetadata(priority, openedAt).ackTargetAt,
      timeline: [{
        action: 'opened',
        actorId: actorId || userId,
        at: openedAt
      }],
      financialContext: persistenceScope.financialContext,
      financialNamespace: persistenceScope.namespace,
      financialContextId: persistenceScope.financialContextId
    });

    const docRef = this.incidentDoc(incidentId, persistenceScope);
    if (!docRef) {
      throw new Error('Firestore indisponível para incidentes operacionais');
    }

    let ticket = null;
    if (['safety', 'emergency'].includes(normalizedCategory)) {
      const created = await this.queueService.createSupportTicket({
        subject: `[${priority}] Incidente ${normalizedCategory}${bookingId ? ` ${bookingId}` : ''}`.trim(),
        description,
        category: 'general',
        priority,
        requesterId: userId,
        userType,
        metadata: {
          source: 'ops_incident',
          incidentId,
          bookingId,
          city,
          regionHash
        },
        persistenceContext: persistenceScope
      });
      ticket = created.ticket;
      incident.ticketId = ticket.id;
    }

    await docRef.set(incident, { merge: true });
    await this.updateRedisIndexes(incident, persistenceScope);

    if (bookingId) {
      await this.markBookingForOpsReview(bookingId, incident, persistenceScope);
    }

    return {
      ...incident,
      ticketId: ticket?.id || incident.ticketId || null,
      ticket
    };
  }

  async getIncident(incidentId) {
    const docRef = this.incidentDoc(incidentId);
    if (!docRef) return null;
    const snapshot = await docRef.get();
    if (!snapshot.exists) return null;
    return normalizeIncident(snapshot.id, snapshot.data());
  }

  async listIncidents({
    status = null,
    category = null,
    city = null,
    regionHash = null,
    limit = 100
  } = {}) {
    const firestore = this.getFirestore();
    if (!firestore) return [];

    const snapshot = await firestore.collection(INCIDENT_COLLECTION).get();
    let incidents = snapshot.docs.map((doc) => normalizeIncident(doc.id, doc.data()));

    if (status) {
      const allowed = new Set(String(status).split(',').map((item) => item.trim().toUpperCase()).filter(Boolean));
      incidents = incidents.filter((incident) => allowed.has(incident.status));
    }
    if (category) {
      incidents = incidents.filter((incident) => incident.category === normalizeCategory(category));
    }
    if (city) {
      incidents = incidents.filter((incident) => incident.city === city);
    }
    if (regionHash) {
      incidents = incidents.filter((incident) => incident.regionHash === regionHash);
    }

    incidents.sort((left, right) => new Date(right.openedAt || 0).getTime() - new Date(left.openedAt || 0).getTime());
    return incidents.slice(0, Number.parseInt(limit, 10) || 100);
  }

  async transitionIncident(incidentId, patch = {}, timelineEntry = null) {
    const current = await this.getIncident(incidentId);
    if (!current) {
      throw new Error('Incidente não encontrado');
    }

    const next = normalizeIncident(incidentId, {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
      timeline: timelineEntry ? [...current.timeline, timelineEntry] : current.timeline
    });

    const docRef = this.incidentDoc(incidentId);
    await docRef.set(next, { merge: true });
    await this.updateRedisIndexes(next);

    if (next.bookingId) {
      await this.markBookingForOpsReview(next.bookingId, next);
    }

    return next;
  }

  async ackIncident(incidentId, {
    actorId = 'ops',
    assignedTo = null,
    note = null
  } = {}) {
    const now = new Date().toISOString();
    return this.transitionIncident(
      incidentId,
      {
        status: 'ACKED',
        ackedAt: now,
        assignedTo: assignedTo || null
      },
      {
        action: 'acked',
        actorId,
        at: now,
        note: note || null
      }
    );
  }

  async resolveIncident(incidentId, {
    actorId = 'ops',
    resolutionCode = null,
    note = null,
    close = false
  } = {}) {
    const now = new Date().toISOString();
    const nextStatus = close ? 'CLOSED' : 'RESOLVED';
    const incident = await this.transitionIncident(
      incidentId,
      {
        status: nextStatus,
        resolutionCode: resolutionCode || null,
        resolvedAt: now,
        closedAt: close ? now : null
      },
      {
        action: close ? 'closed' : 'resolved',
        actorId,
        at: now,
        note: note || null,
        resolutionCode: resolutionCode || null
      }
    );

    if (
      resolutionCode
      && RESOLUTION_SIGNAL_CODES.has(String(resolutionCode))
      && incident.userType === 'passenger'
    ) {
      await this.trustService.recordSignal(incident.userId, 'confirmed_incident', {
        reasonCode: resolutionCode,
        incidentId: incident.incidentId,
        actorId
      });
    }

    return incident;
  }

  async getOpenSummary({ city = null, regionHash = null } = {}) {
    const incidents = await this.listIncidents({
      status: Array.from(OPEN_STATUSES).join(','),
      city,
      regionHash,
      limit: 500
    });

    return {
      openCount: incidents.length,
      bySeverity: {
        critical: incidents.filter((incident) => incident.severity === 'critical').length,
        high: incidents.filter((incident) => incident.severity === 'high').length,
        medium: incidents.filter((incident) => incident.severity === 'medium').length,
        low: incidents.filter((incident) => incident.severity === 'low').length
      },
      incidents
    };
  }
}

const safetyIncidentService = new SafetyIncidentService();
module.exports = safetyIncidentService;
module.exports.SafetyIncidentService = SafetyIncidentService;
module.exports.normalizeIncident = normalizeIncident;
