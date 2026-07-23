const firebaseConfig = require('../firebase-config');
const {
  resolvePersistenceScope,
  resolveUserPersistenceScope,
  assertStoredRecordMatchesScope
} = require('./sandbox-persistence-context');

const SUPPORT_ROLES = new Set([
  'admin',
  'manager',
  'super-admin',
  'support',
  'development',
  'operator',
  'ops'
]);

const SUPPORT_PERMISSIONS = new Set([
  'support',
  'support:read',
  'support:write',
  'support:chat',
  'tickets:read',
  'tickets:write'
]);
const DEFAULT_TEXT_MESSAGE_MAX_LENGTH = 2000;
const TERMINAL_RIDE_SCOPE_STATUSES = new Set([
  'COMPLETE',
  'COMPLETED',
  'TRIP_COMPLETED',
  'RIDE_COMPLETED',
  'EARLY_ENDED_BY_RIDER',
  'EARLY_ENDED_REVIEW',
  'INTERRUPTED_OPERATIONAL_ENDED'
]);

function normalizeId(value) {
  if (value && typeof value === 'object') {
    return normalizeId(value.id || value.uid || value.userId || value.customerId || value.driverId);
  }
  return String(value || '').trim();
}

function normalizeUserType(userType) {
  const normalized = String(userType || '').trim().toLowerCase();
  if (normalized === 'customer' || normalized === 'rider') return 'passenger';
  if (normalized === 'motorista' || normalized === 'partner') return 'driver';
  if (normalized === 'agent' || normalized === 'support-agent') return 'support';
  return normalized;
}

function normalizeSocketTextMessage(value, {
  maxLength = DEFAULT_TEXT_MESSAGE_MAX_LENGTH
} = {}) {
  if (typeof value !== 'string') {
    return {
      valid: false,
      code: 'MESSAGE_REQUIRED',
      error: 'Mensagem obrigatória',
      text: ''
    };
  }

  const text = value.trim();
  if (!text) {
    return {
      valid: false,
      code: 'MESSAGE_REQUIRED',
      error: 'Mensagem obrigatória',
      text: ''
    };
  }

  if (text.length > maxLength) {
    return {
      valid: false,
      code: 'MESSAGE_TOO_LONG',
      error: `Mensagem muito longa (máximo ${maxLength} caracteres)`,
      text
    };
  }

  return {
    valid: true,
    code: null,
    error: null,
    text
  };
}

function getSocketIdentity(socket = {}) {
  const data = socket.data || {};
  const userId = normalizeId(socket.userId || data.userId || socket.uid || data.uid);
  const userType = normalizeUserType(socket.userType || data.userType || socket.role || data.role);
  const role = String(socket.userRole || data.userRole || socket.role || data.role || userType || '').trim().toLowerCase();
  const permissions = [
    ...(Array.isArray(socket.userPermissions) ? socket.userPermissions : []),
    ...(Array.isArray(data.userPermissions) ? data.userPermissions : []),
    ...(Array.isArray(socket.permissions) ? socket.permissions : []),
    ...(Array.isArray(data.permissions) ? data.permissions : [])
  ].map((permission) => String(permission || '').trim().toLowerCase()).filter(Boolean);

  return {
    userId,
    userType,
    role,
    permissions
  };
}

function isSupportActor(socket = {}) {
  const identity = getSocketIdentity(socket);
  if (SUPPORT_ROLES.has(identity.role) || SUPPORT_ROLES.has(identity.userType)) {
    return true;
  }
  return identity.permissions.some((permission) => SUPPORT_PERMISSIONS.has(permission));
}

function isSupportIdentity(identity = {}) {
  if (SUPPORT_ROLES.has(identity.role) || SUPPORT_ROLES.has(identity.userType)) {
    return true;
  }
  return (identity.permissions || []).some((permission) => SUPPORT_PERMISSIONS.has(permission));
}

function parseMaybeJson(value) {
  if (!value || typeof value !== 'string') return value || null;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function extractRideScope(raw = {}, bookingId = '') {
  const source = raw || {};
  const trip = source.tripData || source.ride || source.booking || {};
  const customerId = normalizeId(
    source.customerId ||
    source.customer ||
    source.passengerId ||
    source.passenger ||
    source.userId ||
    trip.customerId ||
    trip.customer ||
    trip.passengerId ||
    trip.passenger
  );
  const driverId = normalizeId(
    source.driverId ||
    source.driver ||
    source.assignedDriverId ||
    source.acceptedDriverId ||
    trip.driverId ||
    trip.driver ||
    trip.assignedDriverId
  );

  return {
    bookingId: normalizeId(source.bookingId || source.rideId || source.tripId || source.id || bookingId),
    customerId,
    driverId,
    status: String(source.status || source.bookingStatus || source.tripStatus || trip.status || '').trim().toUpperCase(),
    raw: source
  };
}

function isTerminalRideScopeStatus(status) {
  return TERMINAL_RIDE_SCOPE_STATUSES.has(String(status || '').trim().toUpperCase());
}

async function readRedisBooking(redis, bookingId) {
  if (!redis || !bookingId) return null;

  const bookingHash = typeof redis.hgetall === 'function'
    ? await redis.hgetall(`booking:${bookingId}`).catch(() => null)
    : null;
  if (bookingHash && Object.keys(bookingHash).length > 0) {
    return bookingHash;
  }

  if (typeof redis.hget === 'function') {
    const activeRaw = await redis.hget('bookings:active', bookingId).catch(() => null);
    const active = parseMaybeJson(activeRaw);
    if (active && typeof active === 'object') {
      return active;
    }
  }

  return null;
}

async function resolveRideScope({
  io,
  redisPool,
  bookingId,
  preferPersistentTerminal = false,
  actor = null,
  deferPersistenceBoundaryToCaller = false
}) {
  const safeBookingId = normalizeId(bookingId);
  if (!safeBookingId) {
    return { found: false, bookingId: '', customerId: '', driverId: '', status: '', raw: null };
  }

  let persistenceScope;
  try {
    persistenceScope = actor?.userId && !isSupportIdentity(actor)
      ? await resolveUserPersistenceScope({
        userId: actor.userId,
        actor
      })
      : resolvePersistenceScope({}, { allowLegacyOperational: true });
  } catch (error) {
    return {
      found: false,
      bookingId: safeBookingId,
      customerId: '',
      driverId: '',
      status: '',
      raw: null,
      code: error.code || 'RIDE_SCOPE_CLASSIFICATION_UNAVAILABLE',
      error: error.message || 'Não foi possível classificar o escopo da corrida'
    };
  }

  const validateCachedScope = (record) => {
    if (deferPersistenceBoundaryToCaller || isSupportIdentity(actor || {})) {
      return null;
    }
    try {
      assertStoredRecordMatchesScope(record, persistenceScope);
      return null;
    } catch (error) {
      return {
        found: false,
        bookingId: safeBookingId,
        customerId: '',
        driverId: '',
        status: '',
        raw: null,
        code: error.code || 'RIDE_SCOPE_CONTEXT_MISMATCH',
        error: error.message || 'A corrida pertence a outro ambiente'
      };
    }
  };

  const fromMemory = io?.activeBookings?.get?.(safeBookingId);
  const memoryScope = fromMemory
    ? { found: true, ...extractRideScope(fromMemory, safeBookingId), source: 'memory' }
    : null;
  if (memoryScope && !preferPersistentTerminal) {
    const scopeError = validateCachedScope(fromMemory);
    if (scopeError) return scopeError;
    return memoryScope;
  }

  const redis = redisPool?.getConnection?.();
  const fromRedis = await readRedisBooking(redis, safeBookingId);
  if (fromRedis) {
    const scopeError = validateCachedScope(fromRedis);
    if (scopeError) return scopeError;
    const redisScope = { found: true, ...extractRideScope(fromRedis, safeBookingId), source: 'redis' };
    if (!memoryScope || !preferPersistentTerminal || isTerminalRideScopeStatus(redisScope.status)) {
      return redisScope;
    }
  }

  if (memoryScope) {
    const scopeError = validateCachedScope(fromMemory);
    if (scopeError) return scopeError;
    return memoryScope;
  }

  const fromRealtime = await firebaseConfig.getFromRealtimeDB?.(
    `${persistenceScope.collections.bookings}/${safeBookingId}`
  );
  if (fromRealtime) {
    if (!deferPersistenceBoundaryToCaller) {
      try {
        assertStoredRecordMatchesScope(fromRealtime, persistenceScope);
      } catch (error) {
        return {
          found: false,
          bookingId: safeBookingId,
          customerId: '',
          driverId: '',
          status: '',
          raw: null,
          code: error.code || 'RIDE_SCOPE_CONTEXT_MISMATCH',
          error: error.message || 'A corrida pertence a outro ambiente'
        };
      }
    }
    return {
      found: true,
      ...extractRideScope(fromRealtime, safeBookingId),
      source: 'realtime_db',
      persistenceScope
    };
  }

  return { found: false, bookingId: safeBookingId, customerId: '', driverId: '', status: '', raw: null };
}

function getParticipantRole(userId, scope = {}) {
  const safeUserId = normalizeId(userId);
  if (!safeUserId) return null;
  if (safeUserId === normalizeId(scope.customerId)) return 'passenger';
  if (safeUserId === normalizeId(scope.driverId)) return 'driver';
  return null;
}

async function assertRideParticipant({
  socket,
  io,
  redisPool,
  bookingId,
  allowedRoles = ['passenger', 'driver'],
  allowSupport = true,
  preferPersistentTerminal = false,
  deferPersistenceBoundaryToCaller = false
}) {
  const identity = getSocketIdentity(socket);
  if (!identity.userId) {
    return {
      allowed: false,
      code: 'AUTH_REQUIRED',
      error: 'Autenticação obrigatória',
      identity
    };
  }

  const scope = await resolveRideScope({
    io,
    redisPool,
    bookingId,
    preferPersistentTerminal,
    actor: identity,
    deferPersistenceBoundaryToCaller
  });
  if (!scope.found) {
    return {
      allowed: false,
      code: scope.code || 'RIDE_SCOPE_NOT_FOUND',
      error: scope.error || 'Corrida não encontrada para validação de escopo',
      identity,
      scope
    };
  }

  if (allowSupport && isSupportActor(socket)) {
    return {
      allowed: true,
      participantRole: 'support',
      identity,
      scope
    };
  }

  const participantRole = getParticipantRole(identity.userId, scope);
  if (!participantRole) {
    return {
      allowed: false,
      code: 'RIDE_SCOPE_DENIED',
      error: 'Usuário não participa desta corrida',
      identity,
      scope
    };
  }

  const normalizedAllowedRoles = allowedRoles.map(normalizeUserType);
  if (!normalizedAllowedRoles.includes(participantRole)) {
    return {
      allowed: false,
      code: 'RIDE_ROLE_DENIED',
      error: 'Perfil não autorizado para esta ação',
      identity,
      scope,
      participantRole
    };
  }

  return {
    allowed: true,
    participantRole,
    identity,
    scope
  };
}

function resolveSupportChatAuthorization(socket, data = {}) {
  const identity = getSocketIdentity(socket);
  if (!identity.userId) {
    return {
      allowed: false,
      code: 'AUTH_REQUIRED',
      error: 'Autenticação obrigatória',
      identity
    };
  }

  const requestedUserId = normalizeId(data.userId || data.targetUserId || data.customerId || data.passengerId);
  if (isSupportActor(socket)) {
    if (!requestedUserId) {
      return {
        allowed: false,
        code: 'SUPPORT_TARGET_REQUIRED',
        error: 'Usuário do atendimento é obrigatório',
        identity
      };
    }

    return {
      allowed: true,
      userId: requestedUserId,
      senderType: 'agent',
      identity
    };
  }

  if (requestedUserId && requestedUserId !== identity.userId) {
    return {
      allowed: false,
      code: 'SUPPORT_SCOPE_DENIED',
      error: 'Usuário não autorizado para este chat de suporte',
      identity
    };
  }

  return {
    allowed: true,
    userId: identity.userId,
    senderType: 'user',
    identity
  };
}

module.exports = {
  assertRideParticipant,
  extractRideScope,
  getParticipantRole,
  getSocketIdentity,
  isSupportActor,
  normalizeId,
  normalizeSocketTextMessage,
  normalizeUserType,
  resolveRideScope,
  resolveSupportChatAuthorization
};
