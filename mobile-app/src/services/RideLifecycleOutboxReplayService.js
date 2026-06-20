import {
  RIDE_EVENT_TYPES,
  listPendingRideEventIntents,
  markRideEventIntentAcked,
  markRideEventIntentRejected,
} from './RideEventOutboxService';

const normalizeText = (value) => String(value || '').trim();

const normalizeStatus = (value) => {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'cancelled') return 'canceled';
  if (normalized === 'driver_arrived') return 'arrived';
  if (normalized === 'in_progress' || normalized === 'on_trip') return 'started';
  return normalized;
};

const STATUS_ORDER = Object.freeze({
  idle: 0,
  requesting: 1,
  pending: 1,
  searching: 1,
  searching_replacement: 1,
  accepted: 2,
  arrived: 3,
  started: 4,
  completed: 5,
  canceled: 5,
});

const TERMINAL_STATUSES = new Set(['completed', 'canceled']);

const getStatusOrder = (status) => STATUS_ORDER[normalizeStatus(status)] ?? -1;

const coerceCoordinate = (value) => {
  if (!value || typeof value !== 'object') return null;
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
};

export const resolveRideLifecycleReplayBookingId = (state = {}) => {
  return normalizeText(
    state.activeBookingId ||
      state.driverActiveRide?.bookingId ||
      state.activeBooking?.bookingId ||
      state.activeBooking?.id ||
      state.rideLocalSync?.bookingId,
  );
};

export const resolveRideLifecycleReplayStatus = (state = {}) => {
  return normalizeStatus(
    state.bookingStatus ||
      state.driverActiveRide?.status ||
      state.activeBooking?.status ||
      state.rideLocalSync?.status,
  );
};

export const resolveRideLifecycleReplayCoordinate = (...candidates) => {
  for (const candidate of candidates) {
    const coordinate = coerceCoordinate(candidate);
    if (coordinate) return coordinate;
  }
  return null;
};

export const resolveRideLifecycleReplayDecision = (intent = {}, state = {}) => {
  const eventType = normalizeText(intent.eventType).toLowerCase();
  const bookingId = normalizeText(intent.bookingId);
  const activeBookingId = resolveRideLifecycleReplayBookingId(state);
  const status = resolveRideLifecycleReplayStatus(state);
  const statusOrder = getStatusOrder(status);

  if (!bookingId) {
    return { action: 'hold', reason: 'missing_booking_id', status };
  }

  if (activeBookingId && activeBookingId !== bookingId) {
    return { action: 'hold', reason: 'different_active_booking', status };
  }

  if (!activeBookingId && !TERMINAL_STATUSES.has(status)) {
    return { action: 'hold', reason: 'no_active_booking', status };
  }

  if (eventType === RIDE_EVENT_TYPES.ARRIVED_AT_PICKUP) {
    if (statusOrder >= STATUS_ORDER.arrived) {
      return { action: 'ack', reason: 'state_already_arrived', status };
    }
    if (status === 'accepted') {
      return { action: 'replay', reason: 'accepted_can_arrive', status };
    }
    return { action: 'hold', reason: 'arrival_not_eligible', status };
  }

  if (eventType === RIDE_EVENT_TYPES.START_TRIP) {
    if (statusOrder >= STATUS_ORDER.started) {
      return { action: 'ack', reason: 'state_already_started', status };
    }
    if (status === 'arrived') {
      return { action: 'replay', reason: 'arrived_can_start', status };
    }
    return { action: 'hold', reason: 'start_not_eligible', status };
  }

  if (eventType === RIDE_EVENT_TYPES.COMPLETE_TRIP) {
    if (status === 'completed') {
      return { action: 'ack', reason: 'state_already_completed', status };
    }
    if (status === 'started') {
      return { action: 'replay', reason: 'started_can_complete', status };
    }
    return { action: 'hold', reason: 'complete_not_eligible', status };
  }

  if (eventType === RIDE_EVENT_TYPES.CANCEL_RIDE) {
    if (status === 'canceled') {
      return { action: 'ack', reason: 'state_already_canceled', status };
    }
    const cancellableStatuses = [
      'requesting',
      'pending',
      'searching',
      'searching_replacement',
      'accepted',
      'arrived',
      'started',
    ];
    if (cancellableStatuses.includes(status)) {
      return { action: 'replay', reason: 'active_ride_can_cancel', status };
    }
    return { action: 'hold', reason: 'cancel_not_eligible', status };
  }

  return { action: 'hold', reason: 'unsupported_event_type', status };
};

const isSocketConnected = (socket) => {
  if (!socket) return false;
  if (typeof socket.isConnected === 'function') {
    return Boolean(socket.isConnected());
  }
  if (typeof socket.connected === 'boolean') {
    return socket.connected;
  }
  if (typeof socket.socket?.connected === 'boolean') {
    return socket.socket.connected;
  }
  return true;
};

const buildSyncState = (patch = {}) => ({
  status: 'idle',
  bookingId: null,
  pendingEventType: '',
  idempotencyKey: '',
  message: '',
  updatedAt: null,
  ...patch,
});

const executeReplay = async ({ intent, state, socket }) => {
  const payload =
    intent.payload && typeof intent.payload === 'object' ? intent.payload : {};
  const options = { idempotencyKey: intent.idempotencyKey };
  const bookingId = intent.bookingId;

  if (intent.eventType === RIDE_EVENT_TYPES.ARRIVED_AT_PICKUP) {
    const location = resolveRideLifecycleReplayCoordinate(
      payload.location,
      state.driverCoordinate,
      state.currentCoordinate,
    );
    if (!location) {
      throw new Error('missing_location_for_arrival_replay');
    }
    return socket.arriveAtPickup(bookingId, location, options);
  }

  if (intent.eventType === RIDE_EVENT_TYPES.START_TRIP) {
    const startLocation = resolveRideLifecycleReplayCoordinate(
      payload.startLocation,
      payload.location,
      state.driverCoordinate,
      state.currentCoordinate,
    );
    if (!startLocation) {
      throw new Error('missing_location_for_start_replay');
    }
    return socket.startTrip(bookingId, startLocation, options);
  }

  if (intent.eventType === RIDE_EVENT_TYPES.COMPLETE_TRIP) {
    const endLocation = resolveRideLifecycleReplayCoordinate(
      payload.endLocation,
      payload.location,
      state.currentCoordinate,
      state.driverCoordinate,
    );
    if (!endLocation) {
      throw new Error('missing_location_for_complete_replay');
    }
    const distance =
      Number(payload.distanceKm ?? payload.distance ?? state.tripDistanceKm ?? 0) || 0;
    const fare =
      Number(payload.fare ?? state.selectedFare ?? state.activeBooking?.estimatedFare ?? 0) || 0;
    return socket.completeTrip(bookingId, endLocation, distance, fare, options);
  }

  if (intent.eventType === RIDE_EVENT_TYPES.CANCEL_RIDE) {
    return socket.cancelRide(
      bookingId,
      normalizeText(payload.reason) || 'Cancelado pelo usuário.',
      Number(payload.cancellationFee ?? 0) || 0,
      options,
    );
  }

  throw new Error(`unsupported_replay_event:${intent.eventType}`);
};

export const shouldRejectRideLifecycleReplayError = (error) => {
  const message = normalizeText(error?.message || error).toLowerCase();
  const code = normalizeText(error?.code || error?.reason).toLowerCase();
  if (code === 'duplicate_request' || message.includes('duplicada')) {
    return false;
  }
  return [
    'validation_error',
    'booking_not_found',
    'ride_not_found',
    'unauthorized',
    'forbidden',
  ].includes(code) ||
    message.includes('corrida não encontrada') ||
    message.includes('corrida nao encontrada') ||
    message.includes('dados inválidos') ||
    message.includes('dados invalidos');
};

export const replayPendingRideLifecycleIntents = async ({
  state = {},
  socket,
  actorId,
  listPendingIntents = listPendingRideEventIntents,
  markAcked = markRideEventIntentAcked,
  markRejected = markRideEventIntentRejected,
  onSyncState = () => {},
  logger = console,
  breakOnFailure = true,
} = {}) => {
  const report = {
    replayed: 0,
    acked: 0,
    rejected: 0,
    held: 0,
    failed: 0,
  };

  if (!isSocketConnected(socket)) {
    return { ...report, skipped: true, reason: 'socket_not_connected' };
  }

  const resolvedActorId = normalizeText(
    actorId || state.profileUid || socket?.authenticatedUserId,
  );
  const intents = await listPendingIntents({
    ...(resolvedActorId ? { actorId: resolvedActorId } : {}),
  });

  for (const intent of intents) {
    const decision = resolveRideLifecycleReplayDecision(intent, state);

    if (decision.action === 'ack') {
      await markAcked({ idempotencyKey: intent.idempotencyKey });
      onSyncState(buildSyncState());
      report.acked += 1;
      continue;
    }

    if (decision.action !== 'replay') {
      report.held += 1;
      continue;
    }

    try {
      onSyncState(
        buildSyncState({
          status: 'syncing',
          bookingId: intent.bookingId,
          pendingEventType: intent.eventType,
          idempotencyKey: intent.idempotencyKey,
          message: 'Conexão restaurada. Reenviando ação pendente com segurança.',
          updatedAt: new Date().toISOString(),
        }),
      );
      const response = await executeReplay({ intent, state, socket });
      if (response?.success === false) {
        throw new Error(
          response?.error || response?.message || 'ride_lifecycle_replay_rejected',
        );
      }
      await markAcked({ idempotencyKey: intent.idempotencyKey });
      onSyncState(buildSyncState());
      report.replayed += 1;
    } catch (error) {
      if (shouldRejectRideLifecycleReplayError(error)) {
        await markRejected({
          idempotencyKey: intent.idempotencyKey,
          error: error?.message || String(error),
        });
        onSyncState(
          buildSyncState({
            status: 'error',
            bookingId: intent.bookingId,
            pendingEventType: intent.eventType,
            idempotencyKey: intent.idempotencyKey,
            message: error?.message || 'Backend rejeitou a ação pendente.',
            updatedAt: new Date().toISOString(),
          }),
        );
        report.rejected += 1;
      } else {
        onSyncState(
          buildSyncState({
            status: 'pending',
            bookingId: intent.bookingId,
            pendingEventType: intent.eventType,
            idempotencyKey: intent.idempotencyKey,
            message: 'Ação pendente ainda sem confirmação do servidor.',
            updatedAt: new Date().toISOString(),
          }),
        );
        report.failed += 1;
      }
      logger?.warn?.(
        '[RideLifecycleOutboxReplay] Falha ao reenviar evento pendente:',
        error?.message || error,
      );
      if (breakOnFailure) {
        break;
      }
    }
  }

  return report;
};

export default {
  replayPendingRideLifecycleIntents,
  resolveRideLifecycleReplayBookingId,
  resolveRideLifecycleReplayCoordinate,
  resolveRideLifecycleReplayDecision,
  resolveRideLifecycleReplayStatus,
  shouldRejectRideLifecycleReplayError,
};
