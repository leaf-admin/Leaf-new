const { Command, CommandResult } = require('./index');
const RideStateManager = require('../services/ride-state-manager');
const driverLockManager = require('../services/driver-lock-manager');
const redisPool = require('../utils/redis-pool');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured, logger } = require('../utils/logger');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');
const { clearActiveTripForDriver } = require('../utils/active-trip-index');
const tripLocationPersistenceService = require('../services/trip-location-persistence-service');
const { resolveFinancialContext } = require('../services/financial-runtime-context');
const {
  calculateOperationalInterruptionSettlement,
  loadBookingContext,
  normalizeLocation,
  persistBookingPatch,
  resolveRideLegs,
  resolveOperationalContinuation,
  buildRideLegSettlement,
  buildOperationalInterruptionRecord,
  parseMoneyValue
} = require('../services/ride-lifecycle-service');

async function applyDeferredIdentityReverification(driverId, context = {}) {
  try {
    const kycPolicyService = require('../services/kyc-policy-service');
    if (typeof kycPolicyService.applyDeferredIdentityReverificationIfSafe !== 'function') {
      return;
    }
    await kycPolicyService.applyDeferredIdentityReverificationIfSafe(driverId, context);
  } catch (error) {
    logStructured('warn', 'Falha ao aplicar revalidacao KYC adiada apos interrupcao operacional', {
      service: 'interrupt-ride-operational-command',
      bookingId: context.tripId || null,
      driverId,
      error: error.message
    });
  }
}

class InterruptRideOperationalCommand extends Command {
  constructor(data) {
    super(data);
    this.bookingId = data.bookingId;
    this.driverId = data.driverId;
    this.interruptionLocation = data.interruptionLocation || data.endLocation;
    this.reason = data.reason || 'VEHICLE_BREAKDOWN';
    this.note = data.note || '';
    this.traceId = validateAndEnsureTraceIdInCommand(data, 'InterruptRideOperational');
    this.correlationId = data.correlationId || this.bookingId;
  }

  validate() {
    if (!this.bookingId) {
      throw new Error('InterruptRideOperationalCommand: bookingId é obrigatório');
    }
    if (!this.driverId) {
      throw new Error('InterruptRideOperationalCommand: driverId é obrigatório');
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

        const currentDriverId =
          context.bookingHash.driverId ||
          context.activeBooking?.driverId ||
          null;
        const customerId =
          context.bookingHash.customerId ||
          context.bookingHash.passengerId ||
          context.activeBooking?.customerId ||
          null;

        if (currentDriverId && currentDriverId !== this.driverId) {
          return CommandResult.failure('Motorista não autorizado para interromper esta corrida');
        }

        const currentState = await RideStateManager.getBookingState(redis, this.bookingId);
        const allowedStates = new Set([
          RideStateManager.STATES.IN_PROGRESS,
          RideStateManager.STATES.REASSIGNED_IN_PROGRESS
        ]);

        if (!allowedStates.has(currentState)) {
          return CommandResult.failure(
            `Corrida não pode ser interrompida operacionalmente no estado atual: ${currentState}`
          );
        }

        const existingRideLegs = resolveRideLegs(context.bookingHash);
        const currentContinuation = resolveOperationalContinuation(context.bookingHash);
        const currentLegStartedAt =
          currentContinuation?.currentLegStartedAt ||
          context.bookingHash.startedAt ||
          context.bookingHash.acceptedAt ||
          null;
        const currentLegStartLocation =
          context.bookingHash.startLocation ||
          context.bookingHash.pickupLocation ||
          context.activeBooking?.pickupLocation ||
          null;
        const canonicalMetrics = await tripLocationPersistenceService.resolveCanonicalTripMetrics({
          redis,
          tripId: this.bookingId,
          driverId: this.driverId,
          startedAt: currentLegStartedAt,
          startLocation: currentLegStartLocation,
          nowMs: Date.now()
        });
        if (!canonicalMetrics?.success) {
          return CommandResult.failure(
            'Telemetria canônica indisponível para liquidar a interrupção da corrida'
          );
        }
        const settlement = calculateOperationalInterruptionSettlement(context.bookingHash, {
          distanceKm: canonicalMetrics.distanceKm,
          durationSecs: canonicalMetrics.durationSecs
        });
        const interruptedAt = new Date().toISOString();
        const submittedLocation = normalizeLocation(this.interruptionLocation) || {};
        const normalizedLocation = {
          ...submittedLocation,
          ...canonicalMetrics.endLocation,
          source: canonicalMetrics.source
        };
        const closedRideLeg = buildRideLegSettlement({
          bookingHash: context.bookingHash,
          existingRideLegs,
          driverId: this.driverId,
          grossAmount: settlement.executedFare,
          distanceKm: settlement.executedDistanceKm,
          durationSecs: settlement.executedDurationSecs,
          startedAt:
            currentContinuation?.currentLegStartedAt ||
            context.bookingHash.startedAt ||
            context.bookingHash.acceptedAt ||
            null,
          endedAt: interruptedAt,
          startLocation:
            context.bookingHash.startLocation ||
            context.bookingHash.pickupLocation ||
            context.activeBooking?.pickupLocation ||
            null,
          endLocation: normalizedLocation,
          reason: this.reason,
          legType:
            currentState === RideStateManager.STATES.REASSIGNED_IN_PROGRESS
              ? 'CONTINUATION'
              : 'PRIMARY',
          absorbedOperationalFee: false,
          absorbedPaymentIntermediationFee: false,
          source: 'operational_interrupt',
          metadata: {
            interruptionNote: String(this.note || '').trim(),
            settlementType: settlement.settlementType,
            previousState: currentState,
            metricsSource: canonicalMetrics.source,
            telemetryPointsCount: canonicalMetrics.pointsCount
          }
        });

        const rideLegs = [...existingRideLegs, closedRideLeg];
        const continuationRecord = buildOperationalInterruptionRecord({
          bookingHash: context.bookingHash,
          driverId: this.driverId,
          interruptionLocation: normalizedLocation,
          reason: this.reason,
          note: this.note,
          settlement,
          closedRideLeg,
          currentState
        });

        await RideStateManager.updateBookingState(
          redis,
          this.bookingId,
          RideStateManager.STATES.INTERRUPTED_OPERATIONAL,
          {
            driverId: this.driverId,
            customerId,
            interruptionReason: continuationRecord.reason,
            interruptionLocation: normalizedLocation,
            interruptedAt,
            operationalContinuation: continuationRecord
          }
        );

        await persistBookingPatch(redis, this.bookingId, {
          status: 'INTERRUPTED_OPERATIONAL',
          interruptionReason: continuationRecord.reason,
          interruptionLocation: normalizedLocation,
          interruptedAt,
          pickupLocation: normalizedLocation,
          pickupAddress:
            normalizedLocation?.add ||
            normalizedLocation?.address ||
            normalizedLocation?.formattedAddress ||
            context.bookingHash.pickupAddress ||
            '',
          operationalContinuation: continuationRecord,
          rideLegs,
          currentRideLegNumber: closedRideLeg.legNumber,
          currentRideLegDriverId: this.driverId,
          finalFare: parseMoneyValue(settlement.executedFare, 0),
          distance: parseMoneyValue(settlement.executedDistanceKm, 0),
          duration: parseMoneyValue(settlement.executedDurationSecs, 0)
        });

        const lockStatus = await driverLockManager.isDriverLocked(this.driverId);
        if (lockStatus.isLocked && lockStatus.bookingId === this.bookingId) {
          await driverLockManager.releaseLock(this.driverId);
          logger.info(`🔓 [InterruptRideOperationalCommand] Lock de motorista ${this.driverId} liberado.`);
        }

        const activeTripCleared = await clearActiveTripForDriver(
          redis,
          this.driverId,
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
          await applyDeferredIdentityReverification(this.driverId, {
            source: 'ride_interrupted_operational',
            tripId: this.bookingId
          });
        } else if (!activeTripCleared) {
          logStructured('warn', 'Revalidacao KYC adiada: indice ativo nao correspondia a corrida interrompida', {
            service: 'interrupt-ride-operational-command',
            bookingId: this.bookingId,
            driverId: this.driverId
          });
        } else {
          logStructured('info', 'Revalidacao KYC adiada ignorada fora do namespace operacional', {
            service: 'interrupt-ride-operational-command',
            bookingId: this.bookingId,
            driverId: this.driverId
          });
        }
        await redis.hdel('bookings:active', this.bookingId);

        metrics.recordCommand('InterruptRideOperational', (Date.now() - startedAt) / 1000, true);
        return CommandResult.success({
          bookingId: this.bookingId,
          driverId: this.driverId,
          customerId,
          currentState,
          interruption: continuationRecord,
          closedRideLeg,
          rideLegs,
          settlement,
          canonicalMetrics,
          nextAction: 'PASSENGER_DECISION_REQUIRED'
        });
      } catch (error) {
        logStructured('error', 'InterruptRideOperationalCommand falhou', {
          bookingId: this.bookingId,
          driverId: this.driverId,
          error: error.message
        });
        metrics.recordCommand('InterruptRideOperational', (Date.now() - startedAt) / 1000, false);
        return CommandResult.failure(error.message);
      }
    });
  }
}

module.exports = InterruptRideOperationalCommand;
