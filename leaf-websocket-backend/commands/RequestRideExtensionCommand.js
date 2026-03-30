const { Command, CommandResult } = require('./index');
const redisPool = require('../utils/redis-pool');
const RideStateManager = require('../services/ride-state-manager');
const eventSourcing = require('../services/event-sourcing');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured } = require('../utils/logger');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');
const {
  buildExtensionRequest,
  loadBookingContext,
  parseJsonMaybe,
  persistBookingPatch,
  roundMoney
} = require('../services/ride-lifecycle-service');

class RequestRideExtensionCommand extends Command {
  constructor(data) {
    super(data);
    this.bookingId = data.bookingId;
    this.customerId = data.customerId;
    this.newEndLocation = data.newEndLocation;
    this.newFare = data.newFare;
    this.routeDistanceKm = data.routeDistanceKm ?? null;
    this.routeDurationSecs = data.routeDurationSecs ?? null;
    this.traceId = validateAndEnsureTraceIdInCommand(data, 'RequestRideExtension');
    this.correlationId = data.correlationId || this.bookingId;
  }

  validate() {
    if (!this.bookingId) throw new Error('bookingId é obrigatório');
    if (!this.customerId) throw new Error('customerId é obrigatório');
    if (!this.newEndLocation || !this.newEndLocation.lat || !this.newEndLocation.lng) {
      throw new Error('newEndLocation com lat/lng é obrigatório');
    }
    const newFare = Number(this.newFare);
    if (!Number.isFinite(newFare) || newFare <= 0) {
      throw new Error('newFare inválido');
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
          return CommandResult.failure('Usuário não autorizado a solicitar extensão desta corrida');
        }

        const currentState = await RideStateManager.getBookingState(redis, this.bookingId);
        const allowedStates = new Set([
          RideStateManager.STATES.IN_PROGRESS,
          RideStateManager.STATES.REASSIGNED_IN_PROGRESS
        ]);
        if (!allowedStates.has(currentState)) {
          return CommandResult.failure('A corrida precisa estar em andamento para solicitar extensão');
        }

        const activeExtensionRequest = parseJsonMaybe(context.bookingHash.activeExtensionRequest);
        if (
          activeExtensionRequest &&
          ['DRIVER_DECISION_PENDING', 'PENDING_PAYMENT'].includes(activeExtensionRequest.status)
        ) {
          return CommandResult.failure('Já existe uma extensão pendente para esta corrida');
        }

        const extensionRequest = buildExtensionRequest({
          bookingHash: context.bookingHash,
          customerId: this.customerId,
          newEndLocation: this.newEndLocation,
          newFare: this.newFare,
          routeDistanceKm: this.routeDistanceKm,
          routeDurationSecs: this.routeDurationSecs,
          traceId: this.traceId,
          correlationId: this.correlationId
        });

        if (extensionRequest.diffFare <= 0) {
          return CommandResult.failure('O novo destino não aumenta o valor da corrida. Use alteração direta de destino.');
        }

        await persistBookingPatch(redis, this.bookingId, {
          activeExtensionRequest: extensionRequest,
          lastExtensionRequestedAt: extensionRequest.requestedAt
        });

        await eventSourcing.recordEvent('ride.updated', {
          bookingId: this.bookingId,
          type: 'EXTENSION_REQUESTED',
          extensionRequest,
          correlationId: this.correlationId
        });

        metrics.recordCommand('RequestRideExtension', (Date.now() - startedAt) / 1000, true);

        return CommandResult.success({
          success: true,
          bookingId: this.bookingId,
          requestId: extensionRequest.requestId,
          diffFare: roundMoney(extensionRequest.diffFare),
          currentFare: roundMoney(extensionRequest.currentFare),
          newFare: roundMoney(extensionRequest.newFare),
          status: extensionRequest.status,
          newEndLocation: extensionRequest.newEndLocation
        });
      } catch (error) {
        logStructured('error', 'RequestRideExtensionCommand falhou', {
          bookingId: this.bookingId,
          customerId: this.customerId,
          error: error.message
        });
        metrics.recordCommand('RequestRideExtension', (Date.now() - startedAt) / 1000, false);
        return CommandResult.failure(error.message);
      }
    });
  }
}

module.exports = RequestRideExtensionCommand;
