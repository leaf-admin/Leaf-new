const { Command, CommandResult } = require('./index');
const RideCompletedEvent = require('../events/ride.completed');
const RideStateManager = require('../services/ride-state-manager');
const redisPool = require('../utils/redis-pool');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured } = require('../utils/logger');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');
const { clearActiveTripForDriver } = require('../utils/active-trip-index');
const tripLocationPersistenceService = require('../services/trip-location-persistence-service');
const {
  loadBookingContext,
  normalizeLocation,
  parseMoneyValue,
  persistBookingPatch,
  resolveRideLegs,
  resolveOperationalContinuation
} = require('../services/ride-lifecycle-service');
const {
  buildAuthoritativeCompletionArtifacts,
  buildInterruptedOperationalEndedSettlement
} = require('../services/ride-settlement-service');

async function applyDeferredIdentityReverification(driverId, context = {}) {
  try {
    const kycPolicyService = require('../services/kyc-policy-service');
    if (typeof kycPolicyService.applyDeferredIdentityReverificationIfSafe !== 'function') return;
    await kycPolicyService.applyDeferredIdentityReverificationIfSafe(driverId, context);
  } catch (error) {
    logStructured('warn', 'Falha ao aplicar revalidacao KYC adiada apos fim da interrupcao operacional', {
      service: 'respond-operational-continuation-command',
      bookingId: context.tripId || null,
      driverId,
      error: error.message
    });
  }
}

class RespondOperationalContinuationCommand extends Command {
  constructor(data) {
    super(data);
    this.bookingId = data.bookingId;
    this.customerId = data.customerId;
    this.continueTrip = data.continueTrip === true || data.accepted === true;
    this.traceId = validateAndEnsureTraceIdInCommand(data, 'RespondOperationalContinuation');
    this.correlationId = data.correlationId || this.bookingId;
  }

  validate() {
    if (!this.bookingId) {
      throw new Error('RespondOperationalContinuationCommand: bookingId é obrigatório');
    }
    if (!this.customerId) {
      throw new Error('RespondOperationalContinuationCommand: customerId é obrigatório');
    }
    return true;
  }

  async execute() {
    const startedAt = Date.now();
    return traceContext.runWithTraceId(this.traceId, async () => {
      try {
        this.validate();

        await redisPool.ensureConnection();
        const redis = redisPool.getConnection();
        const context = await loadBookingContext(redis, this.bookingId);

        if (!context?.bookingHash) {
          return CommandResult.failure('Corrida não encontrada');
        }

        const bookingCustomerId =
          context.bookingHash.customerId ||
          context.bookingHash.passengerId ||
          context.activeBooking?.customerId ||
          null;
        if (bookingCustomerId && bookingCustomerId !== this.customerId) {
          return CommandResult.failure('Passageiro não autorizado para decidir esta continuidade');
        }

        const currentState = await RideStateManager.getBookingState(redis, this.bookingId);
        if (currentState !== RideStateManager.STATES.INTERRUPTED_OPERATIONAL) {
          return CommandResult.failure(
            `Corrida não está aguardando decisão de continuidade: ${currentState}`
          );
        }

        const continuation = resolveOperationalContinuation(context.bookingHash);
        if (!continuation || continuation.status !== 'PASSENGER_DECISION_PENDING') {
          return CommandResult.failure('Não há interrupção operacional pendente para esta corrida');
        }

        const rideLegs = resolveRideLegs(context.bookingHash);
        const nowIso = new Date().toISOString();
        const interruptedDriverId = continuation.interruptedByDriverId || context.bookingHash.driverId || null;
        const interruptionLocation =
          normalizeLocation(continuation.pickupLocation) ||
          normalizeLocation(context.bookingHash.interruptionLocation) ||
          normalizeLocation(context.bookingHash.pickupLocation);

        if (this.continueTrip) {
          const continuationAccepted = {
            ...continuation,
            status: 'SEARCHING_REPLACEMENT_DRIVER',
            passengerDecision: 'CONTINUE',
            decisionAt: nowIso,
            reassignmentRequestedAt: nowIso
          };

          await RideStateManager.updateBookingState(
            redis,
            this.bookingId,
            RideStateManager.STATES.REASSIGNMENT_PENDING,
            {
              customerId: this.customerId,
              previousDriverId: interruptedDriverId,
              interruptionLocation,
              reassignmentRequestedAt: nowIso
            }
          );

          await persistBookingPatch(redis, this.bookingId, {
            status: 'REASSIGNMENT_PENDING',
            driverId: '',
            acceptedAt: '',
            arrivedAt: '',
            startedAt: '',
            startLocation: '',
            pickupLocation: interruptionLocation,
            pickupAddress:
              interruptionLocation?.add ||
              interruptionLocation?.address ||
              interruptionLocation?.formattedAddress ||
              context.bookingHash.pickupAddress ||
              '',
            operationalContinuation: continuationAccepted,
            rideLegs,
            interruptedDriverId,
            reassignmentRequestedAt: nowIso
          });

          await redis.del(
            `booking_search:${this.bookingId}`,
            `ride_notifications:${this.bookingId}`,
            `ride_excluded_drivers:${this.bookingId}`
          );

          if (interruptedDriverId) {
            await redis
              .multi()
              .sadd(`ride_excluded_drivers:${this.bookingId}`, interruptedDriverId)
              .expire(`ride_excluded_drivers:${this.bookingId}`, 3600)
              .set(`driver_soft_ban:${interruptedDriverId}`, String(Date.now()), 'EX', 300)
              .exec();
          }

          metrics.recordCommand('RespondOperationalContinuation', (Date.now() - startedAt) / 1000, true);
          return CommandResult.success({
            bookingId: this.bookingId,
            customerId: this.customerId,
            continueTrip: true,
            interruption: continuationAccepted,
            pickupLocation: interruptionLocation,
            rideLegs,
            previousDriverId: interruptedDriverId,
            dispatchRequired: true
          });
        }

        const closedRideLeg = continuation.closedRideLeg || rideLegs[rideLegs.length - 1] || null;
        const finalFare = parseMoneyValue(closedRideLeg?.grossAmount || continuation.executedFare || 0, 0);
        const distance = parseMoneyValue(
          closedRideLeg?.distanceKm || context.bookingHash.distance || 0,
          0
        );
        const duration = parseMoneyValue(
          closedRideLeg?.durationSecs || context.bookingHash.duration || 0,
          0
        );
        const completedContinuation = {
          ...continuation,
          status: 'PASSENGER_ENDED_RIDE',
          passengerDecision: 'END',
          decisionAt: nowIso
        };
        const settlement = buildInterruptedOperationalEndedSettlement(context.bookingHash, {
          operationalContinuation: completedContinuation,
          rideLegs,
          finalFare,
          distanceKm: distance,
          durationSecs: duration
        });
        const completion = buildAuthoritativeCompletionArtifacts({
          bookingHash: context.bookingHash,
          bookingId: this.bookingId,
          status: 'INTERRUPTED_OPERATIONAL_ENDED',
          completedAt: nowIso,
          completionType: 'INTERRUPTED_OPERATIONAL_ENDED',
          completionReason: completedContinuation.reason,
          endLocation: interruptionLocation,
          finalFare,
          distance,
          duration,
          settlement,
          rideLegs,
          operationalContinuation: completedContinuation,
          driverId: interruptedDriverId,
          customerId: bookingCustomerId,
          traceId: this.traceId,
          correlationId: this.correlationId
        });

        await RideStateManager.updateBookingState(
          redis,
          this.bookingId,
          RideStateManager.STATES.INTERRUPTED_OPERATIONAL_ENDED,
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

        if (interruptedDriverId) {
          const activeTripCleared = await clearActiveTripForDriver(
            redis,
            interruptedDriverId,
            this.bookingId
          );
          if (activeTripCleared) {
            await applyDeferredIdentityReverification(interruptedDriverId, {
              source: 'ride_interrupted_operational_ended',
              tripId: this.bookingId
            });
          } else {
            logStructured('warn', 'Revalidacao KYC adiada: indice ativo nao correspondia a corrida continuada', {
              service: 'respond-operational-continuation-command',
              bookingId: this.bookingId,
              driverId: interruptedDriverId
            });
          }
        }

        setImmediate(async () => {
          try {
            await tripLocationPersistenceService.forceFinalizeTrip(this.bookingId, {
              status: 'interrupted_operational_ended',
              reason: completedContinuation.reason
            });
          } catch (locationFinalizeError) {
            logStructured('warn', 'Falha ao finalizar trilha de localização da corrida', {
              service: 'respond-operational-continuation-command',
              bookingId: this.bookingId,
              error: locationFinalizeError.message
            });
          }
        });

        const event = new RideCompletedEvent(completion.eventData);

        metrics.recordCommand('RespondOperationalContinuation', (Date.now() - startedAt) / 1000, true);
        return CommandResult.success({
          ...completion.resultData,
          continueTrip: false,
          event: event.toJSON(),
          continueTrip: false
        });
      } catch (error) {
        logStructured('error', 'RespondOperationalContinuationCommand falhou', {
          bookingId: this.bookingId,
          customerId: this.customerId,
          continueTrip: this.continueTrip,
          error: error.message
        });
        metrics.recordCommand('RespondOperationalContinuation', (Date.now() - startedAt) / 1000, false);
        return CommandResult.failure(error.message);
      }
    });
  }
}

module.exports = RespondOperationalContinuationCommand;
