const { Command, CommandResult } = require('./index');
const redisPool = require('../utils/redis-pool');
const RideStateManager = require('../services/ride-state-manager');
const eventSourcing = require('../services/event-sourcing');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured } = require('../utils/logger');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');
const ExtendRideCommand = require('./ExtendRideCommand');
const {
  parseJsonMaybe,
  loadBookingContext,
  persistBookingPatch,
  appendJsonHistoryField,
  buildRideExtensionExpiresAt
} = require('../services/ride-lifecycle-service');

const EXTENSION_FARE_AUTHORITY = 'backend_extension_estimate';

class RespondRideExtensionCommand extends Command {
  constructor(data) {
    super(data);
    this.bookingId = data.bookingId;
    this.driverId = data.driverId;
    this.accepted = Boolean(data.accepted);
    this.mockPayment = data.mockPayment === true || data.__mockPayment === true;
    this.traceId = validateAndEnsureTraceIdInCommand(data, 'RespondRideExtension');
    this.correlationId = data.correlationId || this.bookingId;
  }

  validate() {
    if (!this.bookingId) throw new Error('bookingId é obrigatório');
    if (!this.driverId) throw new Error('driverId é obrigatório');
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

        const bookingDriverId =
          context.bookingHash.driverId ||
          context.activeBooking?.driverId ||
          null;

        if (bookingDriverId && bookingDriverId !== this.driverId) {
          return CommandResult.failure('Motorista não autorizado a responder esta extensão');
        }

        const currentState = await RideStateManager.getBookingState(redis, this.bookingId);
        const allowedStates = new Set([
          RideStateManager.STATES.IN_PROGRESS,
          RideStateManager.STATES.REASSIGNED_IN_PROGRESS
        ]);
        if (!allowedStates.has(currentState)) {
          return CommandResult.failure('A corrida precisa estar em andamento para responder extensão');
        }

        const activeExtensionRequest = parseJsonMaybe(context.bookingHash.activeExtensionRequest);
        if (!activeExtensionRequest || typeof activeExtensionRequest !== 'object') {
          return CommandResult.failure('Nenhuma extensão pendente encontrada');
        }

        if (activeExtensionRequest.status !== 'DRIVER_DECISION_PENDING') {
          return CommandResult.failure('Esta extensão não está mais aguardando decisão do motorista');
        }

        if (!this.accepted) {
          const declinedRequest = {
            ...activeExtensionRequest,
            status: 'DRIVER_DECLINED',
            decidedAt: new Date().toISOString(),
            decidedBy: this.driverId
          };

          await persistBookingPatch(redis, this.bookingId, {
            activeExtensionRequest: declinedRequest
          });
          await appendJsonHistoryField(redis, this.bookingId, 'extensionHistory', declinedRequest, 20);

          await eventSourcing.recordEvent('ride.updated', {
            bookingId: this.bookingId,
            type: 'EXTENSION_DECLINED',
            extensionRequest: declinedRequest,
            correlationId: this.correlationId
          });

          metrics.recordCommand('RespondRideExtension', (Date.now() - startedAt) / 1000, true);
          return CommandResult.success({
            success: true,
            bookingId: this.bookingId,
            accepted: false,
            status: declinedRequest.status,
            extensionRequest: declinedRequest
          });
        }

        if (activeExtensionRequest.fareAuthority !== EXTENSION_FARE_AUTHORITY) {
          return CommandResult.failure('Extensão sem cotação financeira backend. Passageiro deve refazer a solicitação.');
        }

        const extendRideCommand = new ExtendRideCommand({
          bookingId: this.bookingId,
          customerId: activeExtensionRequest.requestedBy,
          newEndLocation: activeExtensionRequest.newEndLocation,
          newFare: activeExtensionRequest.newFare,
          fareDelta: activeExtensionRequest.fareDelta,
          diffFare: activeExtensionRequest.diffFare,
          extensionChargeAmount: activeExtensionRequest.extensionChargeAmount || activeExtensionRequest.diffFare,
          extensionChargeAmountCents: activeExtensionRequest.extensionChargeAmountCents,
          extensionOperationalCost: activeExtensionRequest.extensionOperationalCost,
          routeRecalculationCost: activeExtensionRequest.routeRecalculationCost,
          paymentIntermediationFee: activeExtensionRequest.paymentIntermediationFee,
          roundingBuffer: activeExtensionRequest.roundingBuffer,
          mockPayment: this.mockPayment,
          correlationId: this.correlationId,
          eventType: 'EXTENSION_PAYMENT_REQUIRED'
        });

        const extensionChargeResult = await extendRideCommand.execute();
        if (!extensionChargeResult.success) {
          return CommandResult.failure(extensionChargeResult.error || 'Falha ao gerar cobrança da extensão');
        }

        const pendingPaymentRequest = {
          ...activeExtensionRequest,
          status: 'PENDING_PAYMENT',
          decidedAt: new Date().toISOString(),
          decidedBy: this.driverId,
          chargeId: extensionChargeResult.data.chargeId,
          pixQRCode: extensionChargeResult.data.pixQRCode || null,
          paymentLink: extensionChargeResult.data.paymentLink || null,
          brCode: extensionChargeResult.data.brCode || null,
          expiresAt:
            extensionChargeResult.data.expiresAt ||
            buildRideExtensionExpiresAt()
        };

        await persistBookingPatch(redis, this.bookingId, {
          activeExtensionRequest: pendingPaymentRequest,
          extensionChargeId: pendingPaymentRequest.chargeId,
          extensionPaymentStatus: 'pending'
        });

        await appendJsonHistoryField(redis, this.bookingId, 'extensionHistory', pendingPaymentRequest, 20);

        await eventSourcing.recordEvent('ride.updated', {
          bookingId: this.bookingId,
          type: 'EXTENSION_DRIVER_ACCEPTED',
          extensionRequest: pendingPaymentRequest,
          correlationId: this.correlationId
        });

        metrics.recordCommand('RespondRideExtension', (Date.now() - startedAt) / 1000, true);
        return CommandResult.success({
          success: true,
          bookingId: this.bookingId,
          accepted: true,
          status: pendingPaymentRequest.status,
          extensionRequest: pendingPaymentRequest,
          payment: extensionChargeResult.data
        });
      } catch (error) {
        logStructured('error', 'RespondRideExtensionCommand falhou', {
          bookingId: this.bookingId,
          driverId: this.driverId,
          accepted: this.accepted,
          error: error.message
        });
        metrics.recordCommand('RespondRideExtension', (Date.now() - startedAt) / 1000, false);
        return CommandResult.failure(error.message);
      }
    });
  }
}

module.exports = RespondRideExtensionCommand;
