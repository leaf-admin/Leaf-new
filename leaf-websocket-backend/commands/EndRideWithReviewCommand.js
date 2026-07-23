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
  loadBookingContext,
  normalizeLocation,
  parseMoneyValue,
  persistBookingPatch,
  resolveRideLegs,
  resolveOperationalContinuation
} = require('../services/ride-lifecycle-service');
const {
  buildEarlyEndedReviewContext,
  buildEarlyEndedReviewSettlement,
  buildAuthoritativeCompletionArtifacts
} = require('../services/ride-settlement-service');

function createNoopSpan() {
  return {
    setStatus: () => {},
    recordException: () => {},
    end: () => {}
  };
}

async function applyDeferredIdentityReverification(driverId, context = {}) {
  try {
    const kycPolicyService = require('../services/kyc-policy-service');
    if (typeof kycPolicyService.applyDeferredIdentityReverificationIfSafe !== 'function') {
      return;
    }
    await kycPolicyService.applyDeferredIdentityReverificationIfSafe(driverId, context);
  } catch (error) {
    logStructured('warn', 'Falha ao aplicar revalidacao KYC adiada apos encerramento em revisao', {
      service: 'end-ride-with-review-command',
      bookingId: context.tripId || null,
      driverId,
      error: error.message
    });
  }
}

class EndRideWithReviewCommand extends Command {
  constructor(data) {
    super(data);
    this.bookingId = data.bookingId;
    this.actorId = data.actorId || data.userId || data.customerId || data.driverId;
    this.actorType = data.actorType || 'system';
    this.endLocation = data.endLocation;
    this.distanceKm = data.distanceKm ?? data.distance ?? 0;
    this.durationSecs = data.durationSecs ?? data.duration ?? 0;
    this.reviewCategory = data.reviewCategory || 'TECHNICAL_FAILURE';
    this.reason = data.reason || 'MANUAL_REVIEW_REQUIRED';
    this.note = data.note || '';
    this.traceId = validateAndEnsureTraceIdInCommand(data, 'EndRideWithReview');
    this.correlationId = data.correlationId || this.bookingId;
  }

  validate() {
    if (!this.bookingId) {
      throw new Error('EndRideWithReviewCommand: bookingId é obrigatório');
    }
    if (!this.actorId) {
      throw new Error('EndRideWithReviewCommand: actorId é obrigatório');
    }
    if (!this.endLocation?.lat || !this.endLocation?.lng) {
      throw new Error('EndRideWithReviewCommand: endLocation com lat/lng é obrigatório');
    }
    return true;
  }

  async execute() {
    const startTime = Date.now();
    const tracer = getTracer();
    const span = typeof tracer?.startSpan === 'function'
      ? tracer.startSpan('EndRideWithReviewCommand.execute', {
          attributes: {
            'command.name': 'EndRideWithReviewCommand',
            'booking.id': this.bookingId,
            'trace.id': this.traceId
          }
        })
      : createNoopSpan();

    return traceContext.runWithTraceId(this.traceId, async () => {
      try {
        this.validate();

        await redisPool.ensureConnection();
        const redis = redisPool.getConnection();
        const context = await loadBookingContext(redis, this.bookingId);

        if (!context?.bookingHash) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Corrida não encontrada' });
          span.end();
          metrics.recordCommand('EndRideWithReview', (Date.now() - startTime) / 1000, false);
          return CommandResult.failure('Corrida não encontrada');
        }

        const customerId =
          context.bookingHash.customerId ||
          context.bookingHash.passengerId ||
          context.activeBooking?.customerId ||
          null;
        const operationalContinuation = resolveOperationalContinuation(context.bookingHash);
        const rideLegs = resolveRideLegs(context.bookingHash);
        const driverId =
          context.bookingHash.driverId ||
          context.activeBooking?.driverId ||
          operationalContinuation?.interruptedByDriverId ||
          null;

        const currentState = await RideStateManager.getBookingState(redis, this.bookingId);
        const allowedStates = new Set([
          RideStateManager.STATES.IN_PROGRESS,
          RideStateManager.STATES.REASSIGNED_IN_PROGRESS,
          RideStateManager.STATES.INTERRUPTED_OPERATIONAL,
          RideStateManager.STATES.REASSIGNMENT_PENDING
        ]);

        if (!allowedStates.has(currentState)) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid state transition' });
          span.end();
          metrics.recordCommand('EndRideWithReview', (Date.now() - startTime) / 1000, false);
          return CommandResult.failure(`Corrida não pode ir para revisão no estado atual: ${currentState}`);
        }

        if (!driverId) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: 'Motorista não encontrado para esta corrida' });
          span.end();
          metrics.recordCommand('EndRideWithReview', (Date.now() - startTime) / 1000, false);
          return CommandResult.failure('Motorista não encontrado para esta corrida');
        }

        const completedAt = new Date().toISOString();
        const reviewContext = buildEarlyEndedReviewContext({
          actorId: this.actorId,
          actorType: this.actorType,
          reviewCategory: this.reviewCategory,
          reason: this.reason,
          note: this.note,
          triggeredAt: completedAt
        });
        const settlement = buildEarlyEndedReviewSettlement(context.bookingHash, {
          distanceKm: this.distanceKm,
          durationSecs: this.durationSecs,
          actorId: this.actorId,
          actorType: this.actorType,
          reviewCategory: this.reviewCategory,
          reason: this.reason,
          note: this.note
        });
        const normalizedEndLocation = normalizeLocation(this.endLocation) || this.endLocation;
        const completion = buildAuthoritativeCompletionArtifacts({
          bookingHash: context.bookingHash,
          bookingId: this.bookingId,
          status: 'EARLY_ENDED_REVIEW',
          completedAt,
          completionType: 'EARLY_ENDED_REVIEW',
          completionReason: reviewContext.reason,
          endLocation: normalizedEndLocation,
          finalFare: settlement.executedFare,
          distance: settlement.executedDistanceKm,
          duration: settlement.executedDurationSecs,
          settlement,
          rideLegs,
          operationalContinuation,
          reviewContext,
          driverId,
          customerId,
          traceId: this.traceId,
          correlationId: this.correlationId
        });

        const lockStatus = await driverLockManager.isDriverLocked(driverId);
        if (lockStatus.isLocked && lockStatus.bookingId === this.bookingId) {
          await driverLockManager.releaseLock(driverId);
          logger.info(`🔓 [EndRideWithReviewCommand] Lock de motorista ${driverId} liberado.`);
        }

        await RideStateManager.updateBookingState(
          redis,
          this.bookingId,
          RideStateManager.STATES.EARLY_ENDED_REVIEW,
          completion.stateMetadata
        );

        await persistBookingPatch(redis, this.bookingId, completion.bookingPatch);

        if (customerId) {
          const customerActiveBookingKey = `customer_active_booking:${customerId}`;
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
            source: 'ride_early_ended_review',
            tripId: this.bookingId
          });
        } else if (!activeTripCleared) {
          logStructured('warn', 'Revalidacao KYC adiada: indice ativo nao correspondia a corrida em review', {
            service: 'end-ride-with-review-command',
            bookingId: this.bookingId,
            driverId
          });
        } else {
          logStructured('info', 'Revalidacao KYC adiada ignorada fora do namespace operacional', {
            service: 'end-ride-with-review-command',
            bookingId: this.bookingId,
            driverId
          });
        }

        setImmediate(async () => {
          try {
            await tripLocationPersistenceService.forceFinalizeTrip(this.bookingId, {
              status: 'early_ended_review',
              reason: reviewContext.reason,
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
              service: 'end-ride-with-review-command',
              bookingId: this.bookingId,
              error: locationFinalizeError.message
            });
          }
        });

        const event = new RideCompletedEvent(completion.eventData);

        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        metrics.recordCommand('EndRideWithReview', (Date.now() - startTime) / 1000, true);

        return CommandResult.success({
          ...completion.resultData,
          event: event.toJSON()
        });
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        span.end();
        logStructured('error', 'EndRideWithReviewCommand falhou', {
          bookingId: this.bookingId,
          actorId: this.actorId,
          error: error.message
        });
        metrics.recordCommand('EndRideWithReview', (Date.now() - startTime) / 1000, false);
        return CommandResult.failure(error.message);
      }
    });
  }
}

module.exports = EndRideWithReviewCommand;
