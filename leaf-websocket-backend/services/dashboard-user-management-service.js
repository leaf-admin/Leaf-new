const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const redisPool = require('../utils/redis-pool');
const { logError, logStructured } = require('../utils/logger');
const passengerTrustService = require('./passenger-trust-service');
const FCMService = require('./fcm-service');
const auditService = require('./audit-service');

const OPERATIONAL_STATUSES = new Set(['active', 'blocked', 'suspended']);
const DRIVER_DOCUMENT_TYPES = new Set(['cnh', 'crlv', 'antecedentes_criminais']);
const ELIGIBLE_DRIVER_GEO_KEY = process.env.ELIGIBLE_DRIVER_GEO_KEY || 'driver_locations_eligible';
const DRIVER_NON_APPROVED_REACTIVATION_STATUS = 'pending_review';

class DashboardUserManagementError extends Error {
  constructor(message, statusCode = 400, code = 'DASHBOARD_USER_MANAGEMENT_ERROR') {
    super(message);
    this.name = 'DashboardUserManagementError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeUserType(raw = {}) {
  const type = String(raw.usertype || raw.userType || raw.role || 'customer').trim().toLowerCase();
  if (type === 'passenger' || type === 'rider') return 'customer';
  return type || 'customer';
}

function sanitizeDocumentType(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, '_')
    .replace(/_+/g, '_');
}

function parseDurationDays(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildExpiresAt(durationDays) {
  const safeDays = parseDurationDays(durationDays);
  if (!safeDays) return null;
  return new Date(Date.now() + safeDays * 24 * 60 * 60 * 1000).toISOString();
}

function resolveDriverReactivationState(currentData = {}) {
  if (currentData.approved === true) {
    return { status: 'approved', accountStatus: 'active' };
  }

  const currentStatus = String(currentData.status || '').trim().toLowerCase();
  const currentAccountStatus = String(currentData.accountStatus || '').trim().toLowerCase();
  const unsafeStatuses = new Set(['active', 'approved', 'blocked', 'suspended']);
  const unsafeAccountStatuses = new Set(['active', 'blocked', 'suspended']);

  return {
    status: currentStatus && !unsafeStatuses.has(currentStatus)
      ? currentStatus
      : DRIVER_NON_APPROVED_REACTIVATION_STATUS,
    accountStatus: currentAccountStatus && !unsafeAccountStatuses.has(currentAccountStatus)
      ? currentAccountStatus
      : DRIVER_NON_APPROVED_REACTIVATION_STATUS
  };
}

async function readRealtimeUser(userId) {
  if (!firebaseConfig?.getRealtimeDB) return { exists: false, data: null, db: null };
  const db = firebaseConfig.getRealtimeDB();
  const snapshot = await db.ref(`users/${userId}`).once('value');
  return {
    exists: Boolean(snapshot?.exists?.()),
    data: snapshot?.val?.() || null,
    db
  };
}

async function readUser(userId) {
  const safeUserId = normalizeId(userId);
  if (!safeUserId) {
    throw new DashboardUserManagementError('userId invalido', 400, 'INVALID_USER_ID');
  }

  const firestore = admin.firestore();
  const userRef = firestore.collection('users').doc(safeUserId);
  const [firestoreDoc, realtime] = await Promise.all([
    userRef.get(),
    readRealtimeUser(safeUserId).catch((error) => {
      logError(error, 'Erro ao ler usuario no RTDB para gestao operacional', {
        service: 'dashboard-user-management-service',
        userId: safeUserId
      });
      return { exists: false, data: null, db: null };
    })
  ]);

  const firestoreData = firestoreDoc.exists ? (firestoreDoc.data() || {}) : null;
  const realtimeData = realtime.data || null;
  const merged = {
    ...(realtimeData || {}),
    ...(firestoreData || {})
  };

  if (!firestoreDoc.exists && !realtime.exists) {
    throw new DashboardUserManagementError('Usuario nao encontrado', 404, 'USER_NOT_FOUND');
  }

  return {
    userId: safeUserId,
    userRef,
    realtimeDb: realtime.db,
    data: merged,
    userType: normalizeUserType(merged)
  };
}

async function clearDriverRuntimeState(userId, status, reasonCode) {
  let redis = null;
  try {
    redis = redisPool.getConnection();
    await redisPool.ensureConnection?.();
  } catch (error) {
    logStructured('warn', 'Redis indisponivel para limpar estado operacional do motorista', {
      service: 'dashboard-user-management-service',
      userId,
      error: error.message
    });
    return;
  }

  const driverKey = `driver:${userId}`;
  const nowIso = new Date().toISOString();
  const shouldForceOffline = status !== 'active';

  try {
    const multi = redis.multi();
    multi.del(`driver_eligibility_profile:${userId}`);
    if (shouldForceOffline) {
      multi.hset(driverKey, {
        driverId: userId,
        status: 'OFFLINE',
        isOnline: 'false',
        dispatchEligible: 'false',
        dispatchEligibilityCode: reasonCode,
        dispatchEligibilityCheckedAt: nowIso,
        updatedAt: nowIso
      });
      multi.zrem(ELIGIBLE_DRIVER_GEO_KEY, userId);
      multi.zrem('driver_locations', userId);
      multi.srem('online_drivers', userId);
    }
    await multi.exec();
  } catch (error) {
    logError(error, 'Erro ao limpar estado operacional do motorista no Redis', {
      service: 'dashboard-user-management-service',
      userId,
      status
    });
  }
}

async function syncPassengerTrust(userId, status, { reason, expiresAt, operator } = {}) {
  try {
    if (status === 'active') {
      await passengerTrustService.unblockPassenger(userId, {
        operatorId: operator?.id || 'dashboard',
        reasonCode: 'dashboard_reactivation',
        notes: reason || 'Conta reativada pelo dashboard'
      });
      return;
    }

    if (status === 'blocked') {
      await passengerTrustService.blockPassenger(userId, {
        operatorId: operator?.id || 'dashboard',
        reasonCode: 'dashboard_block',
        notes: reason || 'Conta bloqueada pelo dashboard',
        expiresAt: null
      });
      return;
    }

    if (status === 'suspended') {
      await passengerTrustService.blockPassenger(userId, {
        soft: true,
        operatorId: operator?.id || 'dashboard',
        reasonCode: 'dashboard_suspension',
        notes: reason || 'Conta suspensa pelo dashboard',
        expiresAt
      });
    }
  } catch (error) {
    logError(error, 'Erro ao sincronizar trust operacional do passageiro', {
      service: 'dashboard-user-management-service',
      userId,
      status
    });
  }
}

function buildOperationalUpdates(status, userType, currentData = {}, { reason, durationDays, operator } = {}) {
  const nowIso = new Date().toISOString();
  const expiresAt = buildExpiresAt(durationDays);
  const base = {
    operationalStatus: status,
    operationalStatusUpdatedAt: nowIso,
    operationalStatusUpdatedBy: operator?.id || null,
    operationalStatusUpdatedByEmail: operator?.email || null,
    updatedAt: nowIso
  };

  if (status === 'active') {
    const activeState = userType === 'driver'
      ? resolveDriverReactivationState(currentData)
      : { status: 'active', accountStatus: 'active' };
    return {
      updates: {
        ...base,
        status: activeState.status,
        accountStatus: activeState.accountStatus,
        operationalBlocked: false,
        blocked: false,
        accountBlocked: false,
        blockedReason: null,
        blockedAt: null,
        blockedBy: null,
        blockedByEmail: null,
        suspended: false,
        accountSuspended: false,
        suspendReason: null,
        suspendedAt: null,
        suspendedUntil: null,
        unsuspendedAt: nowIso,
        unsuspendedBy: operator?.id || null,
        unsuspendedByEmail: operator?.email || null
      },
      expiresAt: null,
      reasonCode: 'USER_STATUS_ACTIVE'
    };
  }

  if (status === 'blocked') {
    return {
      updates: {
        ...base,
        status: 'blocked',
        accountStatus: 'blocked',
        operationalBlocked: true,
        blocked: true,
        accountBlocked: true,
        blockedAt: nowIso,
        blockedReason: reason || 'Bloqueio operacional via dashboard',
        blockedBy: operator?.id || null,
        blockedByEmail: operator?.email || null,
        suspended: false,
        accountSuspended: false,
        suspendReason: null,
        suspendedAt: null,
        suspendedUntil: null
      },
      expiresAt: null,
      reasonCode: 'USER_STATUS_BLOCKED'
    };
  }

  return {
    updates: {
      ...base,
      status: 'suspended',
      accountStatus: 'suspended',
      operationalBlocked: true,
      suspended: true,
      accountSuspended: true,
      suspendedAt: nowIso,
      suspendedUntil: expiresAt,
      suspendReason: reason || 'Suspensao operacional via dashboard',
      suspendedBy: operator?.id || null,
      suspendedByEmail: operator?.email || null,
      blocked: false,
      accountBlocked: false
    },
    expiresAt,
    reasonCode: 'USER_STATUS_SUSPENDED'
  };
}

async function updateUserOperationalStatus(userId, payload = {}, options = {}) {
  const status = String(payload.status || '').trim().toLowerCase();
  if (!OPERATIONAL_STATUSES.has(status)) {
    throw new DashboardUserManagementError(
      'Status invalido. Use active, blocked ou suspended.',
      400,
      'INVALID_OPERATIONAL_STATUS'
    );
  }

  const record = await readUser(userId);
  const operator = options.operator || {};
  const { updates, expiresAt, reasonCode } = buildOperationalUpdates(status, record.userType, record.data, {
    reason: payload.reason,
    durationDays: payload.durationDays,
    operator
  });

  await record.userRef.set(updates, { merge: true });
  if (record.realtimeDb) {
    await record.realtimeDb.ref(`users/${record.userId}`).update(updates);
  }

  if (record.userType === 'driver') {
    await clearDriverRuntimeState(record.userId, status, reasonCode);
  } else {
    await syncPassengerTrust(record.userId, status, {
      reason: payload.reason,
      expiresAt,
      operator
    });
  }

  await auditService.logEvent({
    userId: operator?.id || 'dashboard',
    action: 'dashboard.user.operational_status.update',
    resource: 'user',
    severity: status === 'active' ? 'INFO' : 'WARNING',
    details: {
      targetUserId: record.userId,
      targetUserType: record.userType,
      status,
      reason: payload.reason || null,
      durationDays: payload.durationDays || null,
      expiresAt,
      reasonCode,
      operatorEmail: operator?.email || null,
      operatorRole: operator?.role || null
    },
    success: true
  }).catch((error) => {
    logError(error, 'Erro ao registrar auditoria de status operacional', {
      service: 'dashboard-user-management-service',
      userId: record.userId,
      status
    });
  });

  return {
    success: true,
    userId: record.userId,
    userType: record.userType,
    status,
    expiresAt,
    updatedAt: updates.updatedAt,
    reason: payload.reason || null
  };
}

async function sendDocumentRequestPush(driverId, documentType, reason) {
  try {
    const redis = redisPool.getConnection();
    const fcmService = new FCMService(redis);
    await fcmService.initialize();
    return fcmService.sendNotificationToUser(driverId, {
      title: 'Documento pendente',
      body: reason || 'Precisamos que voce envie ou atualize um documento no app.',
      data: {
        type: 'driver_document_request',
        userType: 'driver',
        driverId: String(driverId),
        documentType: String(documentType),
        screen: 'RobotaxiPrototypeDriverDocuments',
        source: 'dashboard_user_management'
      },
      channelId: 'driver_updates',
      priority: 'high'
    });
  } catch (error) {
    logError(error, 'Erro ao enviar push de documento pendente', {
      service: 'dashboard-user-management-service',
      driverId,
      documentType
    });
    return { success: false, error: error.message };
  }
}

async function requestDriverDocument(driverId, documentType, payload = {}, options = {}) {
  const safeDriverId = normalizeId(driverId);
  const safeDocumentType = sanitizeDocumentType(documentType);
  if (!safeDriverId || !safeDocumentType) {
    throw new DashboardUserManagementError('driverId e documentType sao obrigatorios', 400, 'INVALID_DOCUMENT_REQUEST');
  }
  if (!DRIVER_DOCUMENT_TYPES.has(safeDocumentType)) {
    throw new DashboardUserManagementError('Tipo de documento invalido', 400, 'INVALID_DOCUMENT_TYPE');
  }

  const record = await readUser(safeDriverId);
  if (record.userType !== 'driver') {
    throw new DashboardUserManagementError('Usuario nao e motorista', 400, 'USER_IS_NOT_DRIVER');
  }
  if (!record.realtimeDb) {
    throw new DashboardUserManagementError('Realtime Database nao configurado', 503, 'RTDB_UNAVAILABLE');
  }

  const nowIso = new Date().toISOString();
  const operator = options.operator || {};
  const reason = String(payload.reason || '').trim();
  const documentRef = record.realtimeDb.ref(`users/${safeDriverId}/documents/${safeDocumentType}`);
  const previousSnapshot = await documentRef.once('value');
  const previousDocument = previousSnapshot.val() || {};
  const previousStatus = String(previousDocument.status || '').trim().toLowerCase();
  const requestStatus = 'requested';

  const documentPayload = {
    ...previousDocument,
    type: safeDocumentType,
    status: previousDocument.status || requestStatus,
    requestStatus,
    requiredUpdate: true,
    requestedAt: nowIso,
    requestedBy: operator.id || null,
    requestedByEmail: operator.email || null,
    requestReason: reason || 'Documento solicitado pelo time Leaf',
    updatedAt: nowIso
  };

  const updates = {
    [`users/${safeDriverId}/documents/${safeDocumentType}`]: documentPayload
  };

  await record.realtimeDb.ref().update(updates);

  await record.userRef.set({
    documentRequests: {
      [safeDocumentType]: {
        status: requestStatus,
        requestedAt: nowIso,
        requestedBy: operator.id || null,
        requestReason: documentPayload.requestReason
      }
    },
    updatedAt: nowIso
  }, { merge: true });

  const pushResult = payload.sendPush === false
    ? { success: false, skipped: true }
    : await sendDocumentRequestPush(safeDriverId, safeDocumentType, documentPayload.requestReason);

  await auditService.logEvent({
    userId: operator?.id || 'dashboard',
    action: 'dashboard.driver.document.request',
    resource: 'driver_document',
    severity: 'WARNING',
    details: {
      targetDriverId: safeDriverId,
      documentType: safeDocumentType,
      reason: documentPayload.requestReason,
      previousStatus: previousStatus || null,
      status: requestStatus,
      operatorEmail: operator?.email || null,
      operatorRole: operator?.role || null,
      pushRequested: payload.sendPush !== false,
      pushSuccess: pushResult?.success === true
    },
    success: true
  }).catch((error) => {
    logError(error, 'Erro ao registrar auditoria de solicitacao de documento', {
      service: 'dashboard-user-management-service',
      driverId: safeDriverId,
      documentType: safeDocumentType
    });
  });

  return {
    success: true,
    driverId: safeDriverId,
    documentType: safeDocumentType,
    status: requestStatus,
    previousStatus: previousStatus || null,
    requestedAt: nowIso,
    push: pushResult
  };
}

module.exports = {
  DashboardUserManagementError,
  updateUserOperationalStatus,
  requestDriverDocument,
  resolveDriverReactivationState,
  sanitizeDocumentType,
  OPERATIONAL_STATUSES,
  DRIVER_DOCUMENT_TYPES
};
