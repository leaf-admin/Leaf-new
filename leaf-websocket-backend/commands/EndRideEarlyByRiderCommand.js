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
const { summarizeTollCrossings } = require('../services/route-toll-service');
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
const { buildAuthoritativeFinancialSnapshot } = require('../services/ride-financial-contract');
const PaymentService = require('../services/payment-service');
const { acceptedContext } = require('../services/driver-intro-fee-service');
const driverIntroFeeService = require('../services/driver-intro-fee-service');

function parseJsonObject(value) {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

// Snapshot financeiro final do valor executado. Sem ele o worker de billing rejeita o
// ride.completed e a corrida encerrada pelo passageiro fica sem estorno, ledger e crédito.
// Usa o mesmo cálculo de taxas já exibido ao motorista no tripCompleted.
function buildExecutedFareFinancialSnapshot(settlement = {}, booking = {}) {
  const paymentService = new PaymentService();
  const driverIntroFee = acceptedContext(booking);
  const breakdown = paymentService.calculateFareBreakdownFromReais(
    Number(settlement.executedFare || 0),
    Number(settlement.tollFee || 0),
    { driverIntroFee }
  );
  return buildAuthoritativeFinancialSnapshot({
    passengerPaidCents: Math.round(Number(settlement.executedFare || 0) * 100),
    tollFeeCents: Math.round(Number(settlement.tollFee || 0) * 100),
    operationalFeeCents: Math.round(Number(breakdown.operationalFee || 0) * 100),
    paymentIntermediationFeeCents: Math.round(Number(breakdown.paymentIntermediationFee || 0) * 100),
    subscriptionRetainedFeeCents: Math.round(Number(breakdown.subscriptionRetainedFee || 0) * 100),
    driverNetAmountCents: Math.round(Number(breakdown.driverNetAmount || 0) * 100),
    driverIntroFee
  });
}

async function applyDeferredIdentityReverification(driverId, context = {}) {
  try {
    const kycPolicyService = require('../services/kyc-policy-service');
    if (typeof kycPolicyService.applyDeferredIdentityReverificationIfSafe !== 'function') return;
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

        // Pedágio só das praças que a telemetria do servidor viu o carro cruzar.
        // Sem telemetria o pedágio contratado segue cobrado (revisão manual).
        let tollCrossing = null;
        try {
          const startedAtMs = Date.parse(context.bookingHash.startedAt || '') || null;
          const tripMetrics = await tripLocationPersistenceService.resolveCanonicalTripMetrics({
            redis,
            tripId: this.bookingId,
            driverId,
            startedAt: context.bookingHash.startedAt || null,
            startLocation: parseJsonObject(context.bookingHash.startLocation) ||
              parseJsonObject(context.bookingHash.pickupLocation),
            allowPreStartTelemetry: true
          });
          tollCrossing = tripMetrics?.success
            ? summarizeTollCrossings(tripMetrics, { startedAtMs: Number(tripMetrics.startedAtMs) || startedAtMs })
            : null;
        } catch (tollCrossingError) {
          logStructured('warn', 'Travessias de pedágio indisponíveis no encerramento antecipado', {
            service: 'end-ride-early-command',
            bookingId: this.bookingId,
            error: tollCrossingError.message
          });
        }

        const settlement = calculateRiderEarlyEndSettlement(context.bookingHash, {
          distanceKm: this.distanceKm,
          durationSecs: this.durationSecs,
          tollCrossing
        });
        const completedAt = new Date().toISOString();
        const normalizedEndLocation = normalizeLocation(this.endLocation) || this.endLocation;

        let financialSnapshot = null;
        try {
          financialSnapshot = buildExecutedFareFinancialSnapshot(settlement, context.bookingHash);
        } catch (snapshotError) {
          logStructured('error', 'Falha ao gerar snapshot financeiro final do encerramento antecipado', {
            service: 'end-ride-early-command',
            bookingId: this.bookingId,
            driverId,
            executedFare: settlement.executedFare,
            tollFee: settlement.tollFee,
            error: snapshotError.message
          });
        }

        const financialContextResult = resolveFinancialContext({
          financialContext: parseJsonObject(context.bookingHash.financialContext),
          financialNamespace: context.bookingHash.financialNamespace,
          providerEnvironment:
            context.bookingHash.paymentProviderEnvironment || context.bookingHash.providerEnvironment
        }, { allowLegacyOperational: true });
        const financialContext =
          financialContextResult.ok && financialContextResult.legacy !== true
            ? financialContextResult.context
            : null;

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
          financialSnapshot,
          financialContext,
          driverId,
          customerId: bookingCustomerId,
          traceId: this.traceId,
          correlationId: this.correlationId
        });

        await RideStateManager.updateBookingState(
          redis,
          this.bookingId,
          RideStateManager.STATES.EARLY_ENDED_BY_RIDER,
          completion.stateMetadata
        );

        await persistBookingPatch(redis, this.bookingId, completion.bookingPatch);
        await driverIntroFeeService.recordTerminalBooking(redis, this.bookingId, context.bookingHash);
        if (driverId) {
          const lockStatus = await driverLockManager.isDriverLocked(driverId);
          if (lockStatus.isLocked && lockStatus.bookingId === this.bookingId) {
            await driverLockManager.releaseLock(driverId, this.bookingId);
            logger.info(`🔓 [EndRideEarlyByRiderCommand] Lock de motorista ${driverId} liberado.`);
          }
        }

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
          if (activeTripCleared) {
            await applyDeferredIdentityReverification(driverId, {
              source: 'ride_early_ended_by_rider',
              tripId: this.bookingId
            });
          } else {
            logStructured('warn', 'Revalidacao KYC adiada: indice ativo nao correspondia a corrida encerrada', {
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
