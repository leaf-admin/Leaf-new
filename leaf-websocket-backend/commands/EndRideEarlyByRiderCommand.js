const { Command, CommandResult } = require('./index');
const RideCompletedEvent = require('../events/ride.completed');
const RideStateManager = require('../services/ride-state-manager');
const driverLockManager = require('../services/driver-lock-manager');
const redisPool = require('../utils/redis-pool');
const { logger, logStructured } = require('../utils/logger');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { getTracer } = require('../utils/tracer');
const { SpanStatusCode } = require('@opentelemetry/api');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');
const { clearActiveTripForDriver } = require('../utils/active-trip-index');
const tripLocationPersistenceService = require('../services/trip-location-persistence-service');
const { resolveFinancialContext } = require('../services/financial-runtime-context');
const {
  calculateRiderEarlyEndSettlement,
  loadBookingContext,
  normalizeLocation,
  parseMoneyValue,
  persistBookingPatch
} = require('../services/ride-lifecycle-service');
const {
  buildAuthoritativeCompletionArtifacts
} = require('../services/ride-settlement-service');

async function applyDeferredIdentityReverification(driverId, context = {}) {
  try {
    const kycPolicyService = require('../services/kyc-policy-service');
    if (typeof kycPolicyService.applyDeferredIdentityReverificationIfSafe !== 'function') {
      return;
    }
    await kycPolicyService.applyDeferredIdentityReverificationIfSafe(driverId, context);
  } catch (error) {
    logStructured('warn', 'Falha ao aplicar revalidacao KYC adiada apos encerramento antecipado', {
      service: 'end-ride-early-command',
      bookingId: context.tripId || null,
      driverId,
      error: error.message
    });
  }
}

class EndRideEarlyByRiderCommand extends Command {
  constructor(data) {
    super(data);
    this.bookingId = data.bookingId;
    this.customerId = data.customerId;
    this.endLocation = data.endLocation;
    this.distanceKm = data.distanceKm ?? data.distance ?? 0;
    this.durationSecs = data.durationSecs ?? data.duration ?? 0;
    this.reason = data.reason || 'EARLY_DROPOFF_BY_RIDER';
    this.traceId = validateAndEnsureTraceIdInCommand(data, 'EndRideEarlyByRider');
    this.correlationId = data.correlationId || this.bookingId;
  }

  validate() {
    if (!this.bookingId) {
      throw new Error('EndRideEarlyByRiderCommand: bookingId é obrigatório');
    }
    if (!this.customerId) {
      throw new Error('EndRideEarlyByRiderCommand: customerId é obrigatório');
    }
    if (!this.endLocation || !this.endLocation.lat || !this.endLocation.lng) {
      throw new Error('EndRideEarlyByRiderCommand: endLocation é obrigatório com lat/lng');
    }
    return true;
  }

  async execute() {
    const startTime = Date.now();
    const tracer = getTracer();
    const span = tracer.startSpan('EndRideEarlyByRiderCommand.execute', {
      attributes: {
        'command.name': 'EndRideEarlyByRiderCommand',
        'booking.id': this.bookingId,
        'trace.id': this.traceId
      }
    });

    return traceContext.runWithTraceId(this.traceId, async () => {
      try {
        this.validate();

        await redisPool.ensureConnection();
        const redis = redisPool.getConnection();
        const context = await loadBookingContext(redis, this.bookingId);

        if (!context?.bookingHash) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Corrida não encontrada' });
          span.end();
          metrics.recordCommand('EndRideEarlyByRider', (Date.now() - startTime) / 1000, false);
          return CommandResult.failure('Corrida não encontrada');
        }

        const bookingCustomerId =
          context.bookingHash.customerId ||
          context.bookingHash.passengerId ||
          context.activeBooking?.customerId ||
          null;
        const driverId =
          context.bookingHash.driverId ||
          context.activeBooking?.driverId ||
          null;

        if (!driverId) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Motorista não encontrado para esta corrida' });
          span.end();
          metrics.recordCommand('EndRideEarlyByRider', (Date.now() - startTime) / 1000, false);
          return CommandResult.failure('Motorista não encontrado para esta corrida');
        }

        if (bookingCustomerId && bookingCustomerId !== this.customerId) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Usuário não autorizado' });
          span.end();
          metrics.recordCommand('EndRideEarlyByRider', (Date.now() - startTime) / 1000, false);
          return CommandResult.failure('Passageiro não autorizado a encerrar esta corrida');
        }

        const currentState = await RideStateManager.getBookingState(redis, this.bookingId);
        const allowedStates = new Set([
          RideStateManager.STATES.IN_PROGRESS,
          RideStateManager.STATES.REASSIGNED_IN_PROGRESS
        ]);

        if (!allowedStates.has(currentState)) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid state transition' });
          span.end();
          metrics.recordCommand('EndRideEarlyByRider', (Date.now() - startTime) / 1000, false);
          return CommandResult.failure(`Corrida não pode ser encerrada antecipadamente no estado atual: ${currentState}`);
        }

        const settlement = calculateRiderEarlyEndSettlement(context.bookingHash, {
          distanceKm: this.distanceKm,
          durationSecs: this.durationSecs
        });
        const completedAt = new Date().toISOString();
        const normalizedEndLocation = normalizeLocation(this.endLocation) || this.endLocation;
        const completion = buildAuthoritativeCompletionArtifacts({
          bookingHash: context.bookingHash,
          bookingId: this.bookingId,
          status: 'EARLY_ENDED_BY_RIDER',
          completedAt,
          completionType: 'EARLY_ENDED_BY_RIDER',
          completionReason: this.reason,
          endLocation: normalizedEndLocation,
          finalFare: settlement.executedFare,
          distance: settlement.executedDistanceKm,
          duration: settlement.executedDurationSecs,
          settlement,
          driverId,
          customerId: bookingCustomerId,
          traceId: this.traceId,
          correlationId: this.correlationId
        });

        if (driverId) {
          const lockStatus = await driverLockManager.isDriverLocked(driverId);
          if (lockStatus.isLocked && lockStatus.bookingId === this.bookingId) {
            await driverLockManager.releaseLock(driverId);
            logger.info(`🔓 [EndRideEarlyByRiderCommand] Lock de motorista ${driverId} liberado.`);
          }
        }

        await RideStateManager.updateBookingState(
          redis,
          this.bookingId,
          RideStateManager.STATES.EARLY_ENDED_BY_RIDER,
          completion.stateMetadata
        );

        await persistBookingPatch(redis, this.bookingId, completion.bookingPatch);

        if (bookingCustomerId) {
          const customerActiveBookingKey = `customer_active_booking:${bookingCustomerId}`;
          const activeBookingId = await redis.get(customerActiveBookingKey);
          if (activeBookingId === this.bookingId) {
            await redis.del(customerActiveBookingKey);
          }
        }

        await redis.del(
          `booking_search:${this.bookingId}`,
          `ride_notifications:${this.bookingId}`,
          `ride_excluded_drivers:${this.bookingId}`
        );
        await redis.hdel('bookings:active', this.bookingId);
        if (driverId) {
          const activeTripCleared = await clearActiveTripForDriver(
            redis,
            driverId,
            this.bookingId
          );
          const financialContextResult = resolveFinancialContext(
            context.bookingHash,
            { allowLegacyOperational: true }
          );
          if (
            activeTripCleared
            && financialContextResult.ok
            && financialContextResult.context.namespace === 'operational'
          ) {
            await applyDeferredIdentityReverification(driverId, {
              source: 'ride_early_ended_by_rider',
              tripId: this.bookingId
            });
          } else if (!activeTripCleared) {
            logStructured('warn', 'Revalidacao KYC adiada: indice ativo nao correspondia a corrida encerrada', {
              service: 'end-ride-early-command',
              bookingId: this.bookingId,
              driverId
            });
          } else {
            logStructured('info', 'Revalidacao KYC adiada ignorada fora do namespace operacional', {
              service: 'end-ride-early-command',
              bookingId: this.bookingId,
              driverId
            });
          }
        }

        setImmediate(async () => {
          try {
            await tripLocationPersistenceService.forceFinalizeTrip(this.bookingId, {
              status: 'early_ended_by_rider',
              reason: this.reason,
              financialContext: context.bookingHash.financialContext,
              financialNamespace: context.bookingHash.financialNamespace,
              financialContextId: context.bookingHash.financialContextId,
              providerEnvironment:
                context.bookingHash.paymentProviderEnvironment || context.bookingHash.providerEnvironment,
              paymentProfileId: context.bookingHash.paymentProfileId,
              testUserSandbox: context.bookingHash.testUserSandbox
            });
          } catch (locationFinalizeError) {
            logStructured('warn', 'Falha ao finalizar trilha de localização da corrida', {
              service: 'end-ride-early-command',
              bookingId: this.bookingId,
              error: locationFinalizeError.message
            });
          }
        });

        const event = new RideCompletedEvent(completion.eventData);

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        metrics.recordCommand('EndRideEarlyByRider', (Date.now() - startTime) / 1000, true);

        return CommandResult.success({
          ...completion.resultData,
          event: event.toJSON(),
          endLocation: normalizedEndLocation
        });
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        span.end();
        logStructured('error', 'EndRideEarlyByRiderCommand falhou', {
          bookingId: this.bookingId,
          customerId: this.customerId,
          error: error.message
        });
        metrics.recordCommand('EndRideEarlyByRider', (Date.now() - startTime) / 1000, false);
        return CommandResult.failure(error.message);
      }
    });
  }
}

module.exports = EndRideEarlyByRiderCommand;
