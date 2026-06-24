const { Command, CommandResult } = require('./index');
const redisPool = require('../utils/redis-pool');
const RideStateManager = require('../services/ride-state-manager');
const eventSourcing = require('../services/event-sourcing');
const fareEstimationService = require('../services/fare-estimation-service');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { logStructured } = require('../utils/logger');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');
const {
  buildExtensionRequest,
  loadBookingContext,
  normalizeLocation,
  parseJsonMaybe,
  persistBookingPatch,
  roundMoney
} = require('../services/ride-lifecycle-service');

const EXTENSION_FARE_AUTHORITY = 'backend_extension_estimate';
const EXTENSION_FARE_TOLERANCE_REAIS = Math.max(
  0.01,
  Number.parseFloat(process.env.RIDE_EXTENSION_FARE_TOLERANCE_REAIS || '1') || 1
);
const EXTENSION_FARE_TOLERANCE_RATIO = Math.max(
  0,
  Number.parseFloat(process.env.RIDE_EXTENSION_FARE_TOLERANCE_RATIO || '0.05') || 0.05
);

function parseJsonSafe(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function normalizeMoney(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? roundMoney(parsed) : null;
}

function resolveContextValue(context = {}, aliases = []) {
  const sources = [
    context.activeBooking || {},
    context.bookingHash || {}
  ];

  for (const source of sources) {
    for (const alias of aliases) {
      const value = source?.[alias];
      if (value !== undefined && value !== null && value !== '') {
        return value;
      }
    }
  }

  return null;
}

function resolveExtensionQuoteOrigin(context = {}) {
  const rawOrigin = resolveContextValue(context, [
    'currentLocation',
    'driverLocation',
    'lastKnownLocation',
    'pickupLocation',
    'pickup'
  ]);
  const parsedOrigin = parseJsonSafe(rawOrigin, rawOrigin);
  return normalizeLocation(parsedOrigin);
}

function resolveExtensionCarType(context = {}) {
  const rawCarType = resolveContextValue(context, [
    'carType',
    'vehicleType',
    'vehicleCategory',
    'category',
    'carDetails'
  ]);

  if (rawCarType && typeof rawCarType === 'object') {
    return rawCarType.name || rawCarType.title || rawCarType.type || null;
  }

  const parsed = parseJsonSafe(rawCarType, null);
  if (parsed && typeof parsed === 'object') {
    return parsed.name || parsed.title || parsed.type || null;
  }

  return rawCarType;
}

function resolveExtensionTollFee(context = {}) {
  return normalizeMoney(resolveContextValue(context, ['tollFee', 'tolls', 'tollAmount'])) || 0;
}

function buildExtensionFareMismatchMessage() {
  return 'Tarifa da extensão diverge da cotação backend. Refaça a cotação para alterar o destino.';
}

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

        const requestedClientFare = normalizeMoney(this.newFare);
        const extensionOrigin = resolveExtensionQuoteOrigin(context);
        const normalizedNewEndLocation = normalizeLocation(this.newEndLocation);

        if (!extensionOrigin || !normalizedNewEndLocation) {
          return CommandResult.failure('Não foi possível validar a rota da extensão no backend');
        }

        const backendFareQuote = await fareEstimationService.estimateRideFare({
          redis,
          pickupLocation: extensionOrigin,
          destinationLocation: normalizedNewEndLocation,
          carType: resolveExtensionCarType(context),
          routeDistanceKm: this.routeDistanceKm,
          routeDurationSecs: this.routeDurationSecs,
          tollFee: resolveExtensionTollFee(context),
          clientEstimatedFare: requestedClientFare,
          pricingContext: null
        });
        const serverEstimatedFare = normalizeMoney(backendFareQuote?.estimatedFare);
        if (!serverEstimatedFare || serverEstimatedFare <= 0) {
          return CommandResult.failure('Não foi possível calcular a tarifa da extensão no backend');
        }

        const fareDiff = roundMoney(Math.abs((requestedClientFare || 0) - serverEstimatedFare));
        const allowedDiff = roundMoney(Math.max(
          EXTENSION_FARE_TOLERANCE_REAIS,
          serverEstimatedFare * EXTENSION_FARE_TOLERANCE_RATIO
        ));
        if (requestedClientFare && fareDiff > allowedDiff) {
          logStructured('warn', 'Tarifa de extensão divergente bloqueada', {
            bookingId: this.bookingId,
            customerId: this.customerId,
            requestedClientFare,
            serverEstimatedFare,
            fareDiff,
            allowedDiff,
            routeDistanceKm: this.routeDistanceKm,
            routeDurationSecs: this.routeDurationSecs
          });
          return CommandResult.failure(buildExtensionFareMismatchMessage());
        }

        const extensionRequest = buildExtensionRequest({
          bookingHash: context.bookingHash,
          customerId: this.customerId,
          newEndLocation: normalizedNewEndLocation,
          newFare: serverEstimatedFare,
          routeDistanceKm: backendFareQuote.routeMetrics?.distanceKm ?? this.routeDistanceKm,
          routeDurationSecs: backendFareQuote.routeMetrics?.durationSecs ?? this.routeDurationSecs,
          requestedClientFare,
          serverEstimatedFare,
          fareAuthority: EXTENSION_FARE_AUTHORITY,
          pricingPayload: backendFareQuote.pricingPayload || null,
          pricingAudit: backendFareQuote.pricingAudit || null,
          traceId: this.traceId,
          correlationId: this.correlationId
        });

        if (extensionRequest.fareDelta <= 0) {
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
          fareDelta: roundMoney(extensionRequest.fareDelta),
          currentFare: roundMoney(extensionRequest.currentFare),
          newFare: roundMoney(extensionRequest.newFare),
          passengerPayableFare: roundMoney(extensionRequest.passengerPayableFare),
          extensionOperationalCost: roundMoney(extensionRequest.extensionOperationalCost),
          routeRecalculationCost: roundMoney(extensionRequest.routeRecalculationCost),
          paymentIntermediationFee: roundMoney(extensionRequest.paymentIntermediationFee),
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
