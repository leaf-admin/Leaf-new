const { Command, CommandResult } = require('./index');
const RideStateManager = require('../services/ride-state-manager');
const driverLockManager = require('../services/driver-lock-manager');
const redisPool = require('../utils/redis-pool');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured, logger } = require('../utils/logger');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');
const { clearActiveTripForDriver } = require('../utils/active-trip-index');
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

class InterruptRideOperationalCommand extends Command {
  constructor(data) {
    super(data);
    this.bookingId = data.bookingId;
    this.driverId = data.driverId;
    this.interruptionLocation = data.interruptionLocation || data.endLocation;
    this.distanceKm = data.distanceKm ?? data.distance ?? 0;
    this.durationSecs = data.durationSecs ?? data.duration ?? 0;
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
    if (!this.interruptionLocation?.lat || !this.interruptionLocation?.lng) {
      throw new Error('InterruptRideOperationalCommand: interruptionLocation com lat/lng é obrigatório');
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
        const settlement = calculateOperationalInterruptionSettlement(context.bookingHash, {
          distanceKm: this.distanceKm,
          durationSecs: this.durationSecs
        });
        const interruptedAt = new Date().toISOString();
        const normalizedLocation =
          normalizeLocation(this.interruptionLocation) || this.interruptionLocation;
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
            previousState: currentState
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

        await clearActiveTripForDriver(redis, this.driverId, this.bookingId);
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
