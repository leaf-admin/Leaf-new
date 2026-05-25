const RideStateManager = require('../services/ride-state-manager');

const pendingTripIntegrityConfirmTimeouts = new Map();

const TRIP_INTEGRITY_ENABLED =
  String(process.env.TRIP_INTEGRITY_ENABLED || 'true').toLowerCase() !== 'false';
const TRIP_INTEGRITY_DISTANCE_THRESHOLD_METERS = Math.max(
  50,
  Number.parseInt(process.env.TRIP_INTEGRITY_DISTANCE_THRESHOLD_METERS || '220', 10) || 220
);
const TRIP_INTEGRITY_LOCATION_STALE_MS = Math.max(
  5000,
  Number.parseInt(process.env.TRIP_INTEGRITY_LOCATION_STALE_MS || '45000', 10) || 45000
);
const TRIP_INTEGRITY_CONSECUTIVE_BREACH_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.TRIP_INTEGRITY_CONSECUTIVE_BREACH_LIMIT || '3', 10) || 3
);
const TRIP_INTEGRITY_CONFIRM_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(process.env.TRIP_INTEGRITY_CONFIRM_TIMEOUT_MS || '20000', 10) || 20000
);
const TRIP_INTEGRITY_SOFT_BAN_SECONDS = Math.max(
  60,
  Number.parseInt(process.env.TRIP_INTEGRITY_SOFT_BAN_SECONDS || '300', 10) || 300
);

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
  const nLat1 = toFiniteNumber(lat1);
  const nLng1 = toFiniteNumber(lng1);
  const nLat2 = toFiniteNumber(lat2);
  const nLng2 = toFiniteNumber(lng2);
  if ([nLat1, nLng1, nLat2, nLng2].some((v) => v === null)) return Number.POSITIVE_INFINITY;

  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(nLat2 - nLat1);
  const dLng = toRad(nLng2 - nLng1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(toRad(nLat1)) * Math.cos(toRad(nLat2))
    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371000 * c;
}

function parseIntegrityTimestampMs(value) {
  if (value == null) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsedDate = Date.parse(String(value));
  return Number.isFinite(parsedDate) ? parsedDate : null;
}

function parseIntegrityLocation(snapshot, prefix) {
  if (!snapshot || !prefix) return null;
  const lat = Number(snapshot[`${prefix}Lat`]);
  const lng = Number(snapshot[`${prefix}Lng`]);
  const at = parseIntegrityTimestampMs(snapshot[`${prefix}At`]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(at)) {
    return null;
  }
  return { lat, lng, at };
}

function isTripIntegrityMonitoringState(stateOrStatus) {
  const normalized = String(stateOrStatus || '').trim().toUpperCase();
  return normalized === 'STARTED' || normalized === 'IN_PROGRESS';
}

function clearTripIntegrityConfirmationTimeout(bookingId) {
  if (!bookingId) return;
  const timeoutId = pendingTripIntegrityConfirmTimeouts.get(bookingId);
  if (timeoutId) {
    clearTimeout(timeoutId);
    pendingTripIntegrityConfirmTimeouts.delete(bookingId);
  }
}

function scheduleTripIntegrityConfirmationTimeout({
  io,
  redisPool,
  bookingId,
  cancelRideForTripIntegrityViolation,
  logStructured,
  timeoutMs
}) {
  if (!TRIP_INTEGRITY_ENABLED || !io || !bookingId) return;
  clearTripIntegrityConfirmationTimeout(bookingId);

  const safeTimeoutMs = Math.max(1000, Number(timeoutMs) || TRIP_INTEGRITY_CONFIRM_TIMEOUT_MS);
  const timeoutId = setTimeout(async () => {
    pendingTripIntegrityConfirmTimeouts.delete(bookingId);

    try {
      await redisPool.ensureConnection?.();
      const redis = redisPool.getConnection();
      const integrityKey = `trip_integrity:${bookingId}`;
      const snapshot = await redis.hgetall(integrityKey);
      if (!snapshot || Object.keys(snapshot).length === 0) {
        return;
      }

      if (snapshot.alertOpenAt && !snapshot.alertResolvedAt && !snapshot.boardingConfirmedAt) {
        const bookingData = await redis.hgetall(`booking:${bookingId}`);
        await cancelRideForTripIntegrityViolation({
          redis,
          bookingId,
          driverId: bookingData?.driverId || null,
          customerId: bookingData?.customerId || null,
          reasonCode: 'TRIP_INTEGRITY_CONFIRMATION_TIMEOUT',
          reasonMessage: 'Corrida cancelada por falta de confirmação de embarque após divergência de localização.'
        });
      }
    } catch (error) {
      logStructured('error', 'Erro ao processar timeout de confirmacao de tripIntegrity', {
        service: 'trip-integrity',
        bookingId,
        error: error.message
      });
    }
  }, safeTimeoutMs);

  pendingTripIntegrityConfirmTimeouts.set(bookingId, timeoutId);
}

function registerSocketTripIntegrityHandlers({
  socket,
  io,
  redisPool,
  logStructured,
  CancelRideCommand,
  traceContext = null,
  eventBus = null
}) {
  const cancelRideForTripIntegrityViolation = async ({
    redis,
    bookingId,
    driverId,
    customerId,
    reasonCode,
    reasonMessage
  }) => {
    if (!TRIP_INTEGRITY_ENABLED || !bookingId || !redis || !io || !CancelRideCommand) {
      return { success: false, skipped: true, reason: 'NOT_ENABLED_OR_INVALID' };
    }

    const cancelLockKey = `trip_integrity_cancel_lock:${bookingId}`;
    const lockAcquired = await redis.set(cancelLockKey, String(Date.now()), 'NX', 'EX', 20);
    if (!lockAcquired) {
      return { success: false, skipped: true, reason: 'LOCK_ALREADY_HELD' };
    }

    clearTripIntegrityConfirmationTimeout(bookingId);
    const bookingData = await redis.hgetall(`booking:${bookingId}`);
    const resolvedDriverId = driverId || bookingData?.driverId || null;
    const resolvedCustomerId = customerId || bookingData?.customerId || null;
    const currentState = await RideStateManager.getBookingState(redis, bookingId);
    const terminalStates = new Set(['COMPLETED', 'CANCELED', 'CANCELLED', 'REJECTED']);
    if (
      terminalStates.has(String(currentState || '').trim().toUpperCase()) ||
      terminalStates.has(String(bookingData?.status || '').trim().toUpperCase())
    ) {
      return { success: false, skipped: true, reason: 'BOOKING_ALREADY_TERMINAL' };
    }

    const command = new CancelRideCommand({
      bookingId,
      canceledBy: 'system_trip_integrity',
      reason: reasonMessage || 'Corrida cancelada por divergência de localização entre motorista e passageiro.',
      cancellationFee: 0,
      traceId: traceContext?.generateTraceId?.('trip_integrity_cancel') || `trip_integrity_cancel_${Date.now()}`,
      correlationId: bookingId,
      userType: 'system'
    });

    const cancelResult = await command.execute();
    if (!cancelResult?.success) {
      logStructured('error', 'CancelRideCommand falhou no cancelamento por tripIntegrity', {
        service: 'trip-integrity',
        bookingId,
        reasonCode,
        error: cancelResult?.error || 'unknown_cancel_command_failure'
      });
      return { success: false, error: cancelResult?.error || 'CANCEL_COMMAND_FAILED' };
    }

    if (cancelResult?.data?.event && eventBus?.publish) {
      try {
        await eventBus.publish({
          eventType: 'ride.canceled',
          data: cancelResult.data.event
        });
      } catch (eventPublishError) {
        logStructured('warn', 'Falha ao publicar ride.canceled no cancelamento por tripIntegrity', {
          service: 'trip-integrity',
          bookingId,
          reasonCode,
          error: eventPublishError.message
        });
      }
    }

    if (resolvedDriverId) {
      await redis.set(`driver_soft_ban:${resolvedDriverId}`, String(Date.now()), 'EX', TRIP_INTEGRITY_SOFT_BAN_SECONDS);
    }

    const payload = {
      success: true,
      bookingId,
      reason: reasonCode || 'TRIP_INTEGRITY_VIOLATION',
      message: reasonMessage || 'Corrida cancelada por divergência de localização.',
      driverSoftBanSec: resolvedDriverId ? TRIP_INTEGRITY_SOFT_BAN_SECONDS : 0,
      timestamp: new Date().toISOString()
    };

    if (resolvedCustomerId) {
      io.to(`customer_${resolvedCustomerId}`).emit('tripIntegrityCancelled', payload);
      io.to(`customer_${resolvedCustomerId}`).emit('rideCancelled', payload);
    }
    if (resolvedDriverId) {
      io.to(`driver_${resolvedDriverId}`).emit('tripIntegrityCancelled', payload);
      io.to(`driver_${resolvedDriverId}`).emit('rideCancelled', payload);
    }

    await redis.hset(`trip_integrity:${bookingId}`, {
      divergenceCount: '0',
      alertOpenAt: '',
      alertResolvedAt: String(Date.now()),
      lastCancellationAt: String(Date.now()),
      lastCancellationReason: payload.reason
    });
    await redis.expire(`trip_integrity:${bookingId}`, 6 * 60 * 60);
    return { success: true, payload };
  };

  const registerTripIntegrityLocationUpdate = async ({
    redis,
    bookingId,
    driverId,
    customerId,
    passengerLocation
  }) => {
    if (!TRIP_INTEGRITY_ENABLED || !io || !redis || !bookingId) {
      return;
    }

    const bookingData = await redis.hgetall(`booking:${bookingId}`);
    if (!bookingData || Object.keys(bookingData).length === 0) {
      return;
    }

    const state = await RideStateManager.getBookingState(redis, bookingId);
    const status = String(bookingData.status || '').trim().toUpperCase();
    if (!isTripIntegrityMonitoringState(state) && !isTripIntegrityMonitoringState(status)) {
      clearTripIntegrityConfirmationTimeout(bookingId);
      return;
    }

    const integrityKey = `trip_integrity:${bookingId}`;
    const nowTs = Date.now();
    const nextFields = {
      updatedAt: String(nowTs),
      driverId: String(driverId || bookingData.driverId || ''),
      customerId: String(customerId || bookingData.customerId || '')
    };

    if (
      passengerLocation &&
      Number.isFinite(Number(passengerLocation.lat)) &&
      Number.isFinite(Number(passengerLocation.lng))
    ) {
      nextFields.passengerLat = String(Number(passengerLocation.lat));
      nextFields.passengerLng = String(Number(passengerLocation.lng));
      nextFields.passengerAt = String(parseIntegrityTimestampMs(passengerLocation.timestamp) || nowTs);
    }

    await redis.hset(integrityKey, nextFields);
    await redis.expire(integrityKey, 6 * 60 * 60);

    const snapshot = await redis.hgetall(integrityKey);
    const driverPoint = parseIntegrityLocation(snapshot, 'driver');
    const passengerPoint = parseIntegrityLocation(snapshot, 'passenger');
    if (!driverPoint || !passengerPoint) {
      return;
    }

    if ((nowTs - driverPoint.at) > TRIP_INTEGRITY_LOCATION_STALE_MS || (nowTs - passengerPoint.at) > TRIP_INTEGRITY_LOCATION_STALE_MS) {
      return;
    }

    const distanceMeters = Math.round(
      haversineDistanceMeters(driverPoint.lat, driverPoint.lng, passengerPoint.lat, passengerPoint.lng)
    );
    if (!Number.isFinite(distanceMeters)) {
      return;
    }

    const parsedCount = Number.parseInt(snapshot.divergenceCount || '0', 10);
    const currentCount = Number.isFinite(parsedCount) ? Math.max(0, parsedCount) : 0;

    if (distanceMeters <= TRIP_INTEGRITY_DISTANCE_THRESHOLD_METERS) {
      await redis.hset(integrityKey, {
        divergenceCount: '0',
        alertOpenAt: '',
        alertResolvedAt: String(nowTs),
        lastDistanceMeters: String(distanceMeters),
        lastEvaluatedAt: String(nowTs)
      });
      clearTripIntegrityConfirmationTimeout(bookingId);
      return;
    }

    const nextCount = currentCount + 1;
    await redis.hset(integrityKey, {
      divergenceCount: String(nextCount),
      lastDistanceMeters: String(distanceMeters),
      lastEvaluatedAt: String(nowTs)
    });

    if (nextCount < TRIP_INTEGRITY_CONSECUTIVE_BREACH_LIMIT) {
      return;
    }

    const alertOpenAt = parseIntegrityTimestampMs(snapshot.alertOpenAt);
    const resolvedDriverId = String(snapshot.driverId || bookingData.driverId || driverId || '');
    const resolvedCustomerId = String(snapshot.customerId || bookingData.customerId || customerId || '');

    if (!alertOpenAt) {
      const payload = {
        success: true,
        bookingId,
        reason: 'TRIP_INTEGRITY_DISTANCE_DIVERGENCE',
        message: 'Detectamos divergência de localização. Você embarcou corretamente?',
        distanceMeters,
        thresholdMeters: TRIP_INTEGRITY_DISTANCE_THRESHOLD_METERS,
        confirmationTimeoutSec: Math.round(TRIP_INTEGRITY_CONFIRM_TIMEOUT_MS / 1000),
        timestamp: new Date().toISOString()
      };

      await redis.hset(integrityKey, {
        alertOpenAt: String(nowTs),
        alertResolvedAt: '',
        lastAlertAt: String(nowTs),
        lastAlertDistanceMeters: String(distanceMeters)
      });
      await redis.expire(integrityKey, 6 * 60 * 60);

      if (resolvedCustomerId) {
        io.to(`customer_${resolvedCustomerId}`).emit('tripIntegrityCheckRequired', payload);
      }
      if (resolvedDriverId) {
        io.to(`driver_${resolvedDriverId}`).emit('tripIntegrityCheckRequired', {
          ...payload,
          message: 'Divergência de localização detectada. Aguarde confirmação do passageiro.'
        });
      }

      scheduleTripIntegrityConfirmationTimeout({
        io,
        redisPool,
        bookingId,
        cancelRideForTripIntegrityViolation,
        logStructured,
        timeoutMs: TRIP_INTEGRITY_CONFIRM_TIMEOUT_MS
      });
      return;
    }

    if ((nowTs - alertOpenAt) >= TRIP_INTEGRITY_CONFIRM_TIMEOUT_MS) {
      await cancelRideForTripIntegrityViolation({
        redis,
        bookingId,
        driverId: resolvedDriverId || null,
        customerId: resolvedCustomerId || null,
        reasonCode: 'TRIP_INTEGRITY_DISTANCE_TIMEOUT',
        reasonMessage: 'Corrida cancelada após divergência de localização não resolvida.'
      });
    }
  };

  socket.on('passengerLocationUpdate', async (data = {}) => {
    try {
      if (!TRIP_INTEGRITY_ENABLED) {
        socket.emit('passengerLocationUpdated', {
          success: true,
          skipped: true,
          reason: 'TRIP_INTEGRITY_DISABLED'
        });
        return;
      }

      const customerId = socket.userId || data.customerId || data.uid || null;
      const socketUserType = String(socket.userType || '').trim().toLowerCase();
      if (!customerId || (socketUserType !== 'customer' && socketUserType !== 'passenger')) {
        socket.emit('passengerLocationError', {
          error: 'Apenas passageiros podem enviar localização de tripulação.',
          code: 'PASSENGER_ONLY'
        });
        return;
      }

      const lat = Number(data.lat);
      const lng = Number(data.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        socket.emit('passengerLocationError', {
          error: 'Latitude e longitude válidas são obrigatórias.',
          code: 'LOCATION_REQUIRED'
        });
        return;
      }

      await redisPool.ensureConnection?.();
      const redis = redisPool.getConnection();
      let bookingId = data.bookingId || null;
      if (!bookingId) {
        bookingId = await redis.get(`customer_active_booking:${customerId}`);
      }
      if (!bookingId) {
        socket.emit('passengerLocationError', {
          error: 'Nenhuma corrida ativa encontrada para este passageiro.',
          code: 'ACTIVE_BOOKING_REQUIRED'
        });
        return;
      }

      const bookingData = await redis.hgetall(`booking:${bookingId}`);
      if (!bookingData || Object.keys(bookingData).length === 0) {
        socket.emit('passengerLocationError', {
          error: 'Corrida não encontrada.',
          code: 'BOOKING_NOT_FOUND'
        });
        return;
      }
      if (String(bookingData.customerId || '') !== String(customerId)) {
        socket.emit('passengerLocationError', {
          error: 'Passageiro não autorizado para esta corrida.',
          code: 'BOOKING_CUSTOMER_MISMATCH'
        });
        return;
      }

      const bookingState = await RideStateManager.getBookingState(redis, bookingId);
      const bookingStatus = String(bookingData.status || '').trim().toUpperCase();
      if (!isTripIntegrityMonitoringState(bookingState) && !isTripIntegrityMonitoringState(bookingStatus)) {
        socket.emit('passengerLocationUpdated', {
          success: true,
          bookingId,
          skipped: true,
          reason: 'BOOKING_NOT_IN_MONITORED_STATE'
        });
        return;
      }

      await registerTripIntegrityLocationUpdate({
        redis,
        bookingId,
        customerId,
        driverId: bookingData.driverId || null,
        passengerLocation: {
          lat,
          lng,
          timestamp: data.timestamp || Date.now()
        }
      });

      socket.emit('passengerLocationUpdated', {
        success: true,
        bookingId,
        location: {
          lat,
          lng,
          timestamp: Date.now()
        }
      });
    } catch (error) {
      logStructured('error', 'Erro ao processar passengerLocationUpdate', {
        service: 'trip-integrity',
        customerId: socket.userId || null,
        socketUserType: socket.userType || null,
        error: error.message
      });
      socket.emit('passengerLocationError', {
        error: 'Falha ao atualizar localização do passageiro.',
        code: 'PASSENGER_LOCATION_UPDATE_ERROR'
      });
    }
  });

  socket.on('confirmBoardingStatus', async (data = {}) => {
    try {
      if (!TRIP_INTEGRITY_ENABLED) {
        socket.emit('boardingStatusConfirmed', {
          success: true,
          skipped: true,
          reason: 'TRIP_INTEGRITY_DISABLED'
        });
        return;
      }

      const customerId = socket.userId || data.customerId || data.uid || null;
      const socketUserType = String(socket.userType || '').trim().toLowerCase();
      if (!customerId || (socketUserType !== 'customer' && socketUserType !== 'passenger')) {
        socket.emit('boardingStatusError', {
          error: 'Apenas passageiros podem confirmar embarque.',
          code: 'PASSENGER_ONLY'
        });
        return;
      }

      const bookingId = data.bookingId || null;
      if (!bookingId) {
        socket.emit('boardingStatusError', {
          error: 'ID da corrida é obrigatório.',
          code: 'BOOKING_ID_REQUIRED'
        });
        return;
      }

      await redisPool.ensureConnection?.();
      const redis = redisPool.getConnection();
      const bookingData = await redis.hgetall(`booking:${bookingId}`);
      if (!bookingData || Object.keys(bookingData).length === 0) {
        socket.emit('boardingStatusError', {
          error: 'Corrida não encontrada.',
          code: 'BOOKING_NOT_FOUND'
        });
        return;
      }
      if (String(bookingData.customerId || '') !== String(customerId)) {
        socket.emit('boardingStatusError', {
          error: 'Passageiro não autorizado para esta corrida.',
          code: 'BOOKING_CUSTOMER_MISMATCH'
        });
        return;
      }

      const driverId = bookingData.driverId || null;
      const nowTs = Date.now();
      const integrityKey = `trip_integrity:${bookingId}`;

      if (Boolean(data.boarded)) {
        clearTripIntegrityConfirmationTimeout(bookingId);
        await redis.hset(integrityKey, {
          divergenceCount: '0',
          alertOpenAt: '',
          alertResolvedAt: String(nowTs),
          boardingConfirmedAt: String(nowTs)
        });
        await redis.expire(integrityKey, 6 * 60 * 60);

        const payload = {
          success: true,
          bookingId,
          boarded: true,
          message: 'Confirmação de embarque recebida.',
          timestamp: new Date().toISOString()
        };
        io.to(`customer_${customerId}`).emit('boardingStatusConfirmed', payload);
        if (driverId) {
          io.to(`driver_${driverId}`).emit('boardingStatusConfirmed', payload);
        }
        return;
      }

      await redis.hset(integrityKey, {
        passengerReportedIssueAt: String(nowTs),
        alertOpenAt: String(nowTs)
      });
      await redis.expire(integrityKey, 6 * 60 * 60);

      await cancelRideForTripIntegrityViolation({
        redis,
        bookingId,
        driverId,
        customerId,
        reasonCode: 'PASSENGER_REPORTED_NOT_BOARDED',
        reasonMessage: 'Corrida cancelada após passageiro informar embarque incorreto.'
      });

      socket.emit('boardingStatusConfirmed', {
        success: true,
        bookingId,
        boarded: false,
        message: 'Corrida cancelada por inconsistência de embarque.',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logStructured('error', 'Erro ao processar confirmação de embarque (tripIntegrity)', {
        service: 'trip-integrity',
        customerId: socket.userId || null,
        error: error.message
      });
      socket.emit('boardingStatusError', {
        error: 'Falha ao confirmar status de embarque.',
        code: 'BOARDING_CONFIRMATION_ERROR'
      });
    }
  });
}

module.exports = registerSocketTripIntegrityHandlers;
