/**
 * COMMAND: RequestRideCommand
 * 
 * Processa solicitação de corrida.
 * 
 * Responsabilidades:
 * - Validar dados da corrida
 * - Criar booking no Redis
 * - Adicionar à fila
 * - Construir evento canônico ride.requested (publicação ocorre no handler/EventBus)
 * 
 * NÃO faz:
 * - Notificar motoristas (isso é responsabilidade de listeners)
 * - Emitir eventos WebSocket (isso é responsabilidade de handlers)
 */

const { Command, CommandResult } = require('./index');
const RideRequestedEvent = require('../events/ride.requested');
const rideQueueManager = require('../services/ride-queue-manager');
const RideStateManager = require('../services/ride-state-manager');
const redisPool = require('../utils/redis-pool');
const GeoHashUtils = require('../utils/geohash-utils');
const { logStructured } = require('../utils/logger');
const traceContext = require('../utils/trace-context');
const { metrics } = require('../utils/prometheus-metrics');
const { validateAndEnsureTraceIdInCommand } = require('../utils/trace-validator');
const geofenceService = require('../services/geofence-service');
const fareEstimationService = require('../services/fare-estimation-service');
const PaymentService = require('../services/payment-service');
const passengerDiscountBenefitService = require('../services/passenger-discount-benefit-service');
const { resolveEstimatedFareSnapshot } = require('../utils/fare-snapshot-utils');

const paymentService = new PaymentService();
const PAID_PAYMENT_STATUSES = new Set(['confirmed', 'paid', 'in_holding']);

class RequestRideCommand extends Command {
    constructor(data) {
        super(data);
        this.customerId = data.customerId;
        this.pickupLocation = data.pickupLocation;
        this.destinationLocation = data.destinationLocation;
        this.estimatedFare = data.estimatedFare || 0;
        this.routeDistanceKm = data.routeDistanceKm || 0;
        this.routeDurationSecs = data.routeDurationSecs || 0;
        this.routeCoordinates = Array.isArray(data.routeCoordinates)
            ? data.routeCoordinates
            : [];
        this.trafficSegments = Array.isArray(data.trafficSegments)
            ? data.trafficSegments
            : [];
        this.tollFee = data.tollFee || 0;
        this.carType = data.carType || null;
        this.passengerName = String(data.passengerName || data.customerName || '').trim();
        this.paymentMethod = data.paymentMethod || 'pix';
        this.paymentStatus = data.paymentStatus || 'pending_payment';
        this.paymentId = data.paymentId || null;
        this.paymentData =
            data.paymentData && typeof data.paymentData === 'object'
                ? { ...data.paymentData }
                : null;
        this.preferences =
            data.preferences && typeof data.preferences === 'object'
                ? { ...data.preferences }
                : {};
        this.pricingContext = data.pricingContext || data.operational || null;
        // ✅ VALIDAÇÃO: Garantir traceId válido
        this.traceId = validateAndEnsureTraceIdInCommand(data, 'RequestRide');
        this.correlationId = data.correlationId || null; // ✅ Adicionar correlationId
    }

    validate() {
        if (!this.customerId) {
            throw new Error('RequestRideCommand: customerId é obrigatório');
        }
        if (!this.pickupLocation || !this.pickupLocation.lat || !this.pickupLocation.lng) {
            throw new Error('RequestRideCommand: pickupLocation é obrigatório com lat e lng');
        }
        if (!this.destinationLocation || !this.destinationLocation.lat || !this.destinationLocation.lng) {
            throw new Error('RequestRideCommand: destinationLocation é obrigatório com lat e lng');
        }
        if (this.estimatedFare < 0) {
            throw new Error('RequestRideCommand: estimatedFare deve ser >= 0');
        }
        if (this.routeDistanceKm < 0) {
            throw new Error('RequestRideCommand: routeDistanceKm deve ser >= 0');
        }
        if (this.routeDurationSecs < 0) {
            throw new Error('RequestRideCommand: routeDurationSecs deve ser >= 0');
        }
        if (this.tollFee < 0) {
            throw new Error('RequestRideCommand: tollFee deve ser >= 0');
        }

        // Validação dinâmica de geofence (runtime + dashboard)
        if (geofenceService.isActive()) {
            const geofenceValidation = geofenceService.validateRideLocations(
                this.pickupLocation,
                this.destinationLocation
            );

            if (!geofenceValidation.valid) {
                throw new Error(
                    `A Leaf ainda não opera nesta região. Operação negada: ${geofenceValidation.error || 'Fora da área delimitada pelo mapa.'}`
                );
            }
        }

        return true;
    }

    async execute() {
        const startTime = Date.now();
        // ✅ OBSERVABILIDADE: Executar com traceId
        return await traceContext.runWithTraceId(this.traceId, async () => {
            let currentStage = 'validate';
            let stageStartedAt = Date.now();
            const perfBreakdownMs = {};
            const perfKeyMap = {
                fare_estimation: 'fareEstimation',
                booking_payload: 'bookingPayload',
                state_update: 'stateUpdate',
                event_build: 'eventBuild'
            };
            const beginStage = (stage) => {
                currentStage = stage;
                stageStartedAt = Date.now();
            };
            const recordStage = (stage, completedAt = Date.now(), success = true) => {
                const durationMs = Math.max(0, completedAt - stageStartedAt);
                perfBreakdownMs[perfKeyMap[stage] || stage] = durationMs;
                metrics.recordHotpathStageLatency(
                    'create_booking',
                    `command_${stage}`,
                    durationMs / 1000,
                    success
                );
                stageStartedAt = completedAt;
                currentStage = stage;
                return completedAt;
            };
            try {
                logStructured('info', 'RequestRideCommand.execute iniciado', {
                    customerId: this.customerId,
                    command: 'RequestRideCommand'
                });

                // Validar
                beginStage('validate');
                this.validate();
                recordStage('validate');

                // Garantir conexão Redis
                beginStage('prepare');
                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();

                // Gerar bookingId
                const bookingId = `booking_${Date.now()}_${this.customerId}`;

                // Calcular região (GeoHash)
                const regionHash = GeoHashUtils.getRegionHash(
                    this.pickupLocation.lat,
                    this.pickupLocation.lng,
                    5 // Precisão 5 = ~5km x 5km
                );
                recordStage('prepare');

                // Tarifa server-authoritative para evitar divergência de cálculo no cliente.
                beginStage('fare_estimation');
	                const fareEstimation = await fareEstimationService.estimateRideFare({
	                    redis,
                    pickupLocation: this.pickupLocation,
                    destinationLocation: this.destinationLocation,
                    carType: this.carType,
                    routeDistanceKm: this.routeDistanceKm,
                    routeDurationSecs: this.routeDurationSecs,
                    tollFee: this.tollFee,
                    clientEstimatedFare: this.estimatedFare,
	                    pricingContext: this.pricingContext
	                });
	                const farePerfBreakdownMs = fareEstimation?.perfBreakdownMs || {};
	                const farePerfMapping = {
	                    buildPricingContext: 'fareEstimationBuildPricingContext',
	                    contextLoadRedisPricingState: 'fareEstimationContextLoadRedisPricingState',
	                    contextCollectSnapshot: 'fareEstimationContextCollectSnapshot',
	                    contextAggregateCells: 'fareEstimationContextAggregateCells',
	                    contextDeriveContext: 'fareEstimationContextDeriveContext',
	                    contextTotal: 'fareEstimationContextTotal',
	                    runDynamicPricingEngine: 'fareEstimationRunDynamicPricingEngine',
	                    total: 'fareEstimationTotalInternal'
	                };
	                Object.entries(farePerfMapping).forEach(([sourceKey, targetKey]) => {
	                    const value = Number(farePerfBreakdownMs[sourceKey]);
	                    if (Number.isFinite(value) && value >= 0) {
	                        perfBreakdownMs[targetKey] = value;
	                    }
	                });
	                recordStage('fare_estimation');
	                const pricingSnapshotLockedAt = new Date().toISOString();
                const requestedPaymentStatus = String(
                    this.paymentData?.paymentStatus ||
                    this.paymentStatus ||
                    'pending_payment'
                ).trim().toLowerCase();
                const paymentServerValidated = this.paymentData?.serverValidated === true;
                if (!paymentServerValidated && PAID_PAYMENT_STATUSES.has(requestedPaymentStatus)) {
                    logStructured('warn', 'RequestRideCommand recebeu pagamento confirmado sem validação server-side', {
                        customerId: this.customerId,
                        requestedPaymentStatus
                    });
                }
                const hasConfirmedPayment =
                    paymentServerValidated &&
                    PAID_PAYMENT_STATUSES.has(requestedPaymentStatus);
                const normalizedPaymentStatus = hasConfirmedPayment
                    ? requestedPaymentStatus
                    : 'pending_payment';
                const initialRideState = hasConfirmedPayment
                    ? RideStateManager.STATES.PENDING
                    : RideStateManager.STATES.AWAITING_PAYMENT;
                const initialRideStatus = hasConfirmedPayment ? 'REQUESTED' : 'AWAITING_PAYMENT';
                const paymentChargeId = String(
                    this.paymentData?.chargeId ||
                    this.paymentId ||
                    ''
                ).trim();
                const paymentReferenceRideId = String(
                    this.paymentData?.rideId ||
                    ''
                ).trim();
                const paymentSessionId = String(
                    this.paymentData?.paymentSessionId ||
                    ''
                ).trim();
                const paymentContextKey = String(
                    this.paymentData?.paymentContextKey ||
                    this.paymentData?.contextKey ||
                    ''
                ).trim();
                const paymentQuoteSessionId = String(
                    this.paymentData?.quoteSessionId ||
                    ''
                ).trim();
                const paymentQuoteLockId = String(
                    this.paymentData?.quoteLockId ||
                    ''
                ).trim();
                const paymentDriverReservationId = String(
                    this.paymentData?.paymentDriverReservationId ||
                    ''
                ).trim();
                const paymentDriverReservationDriverId = String(
                    this.paymentData?.paymentDriverReservationDriverId ||
                    ''
                ).trim();
                const paymentDriverReservationExpiresAt = String(
                    this.paymentData?.paymentDriverReservationExpiresAt ||
                    ''
                ).trim();
                const paymentDriverReservationTtlSeconds = Number.parseInt(
                    String(this.paymentData?.paymentDriverReservationTtlSeconds || ''),
                    10
                );
                const paymentProviderEnvironment = String(
                    this.paymentData?.paymentProviderEnvironment ||
                    this.paymentData?.providerEnvironment ||
                    ''
                ).trim();
                const paymentProfileId = String(
                    this.paymentData?.paymentProfileId ||
                    ''
                ).trim();
                const paymentProfileReason = String(
                    this.paymentData?.paymentProfileReason ||
                    ''
                ).trim();
                const paymentProfileSource = String(
                    this.paymentData?.paymentProfileSource ||
                    ''
                ).trim();
                const parsedPaymentAmountInCents = Number.parseInt(
                    String(this.paymentData?.amountInCents ?? ''),
                    10
                );
                const paymentAmountInCents =
                    Number.isFinite(parsedPaymentAmountInCents) && parsedPaymentAmountInCents > 0
                        ? parsedPaymentAmountInCents
                        : null;
                const paymentConfirmedAt = this.paymentData?.confirmedAt || null;
                const paymentDiscountBenefit =
                    this.paymentData?.discountBenefit && typeof this.paymentData.discountBenefit === 'object'
                        ? { ...this.paymentData.discountBenefit }
                        : null;
                const parsedPaymentGrossAmountInCents = Number.parseInt(
                    String(this.paymentData?.grossAmountInCents ?? ''),
                    10
                );
                const paymentGrossAmountInCents =
                    Number.isFinite(parsedPaymentGrossAmountInCents) && parsedPaymentGrossAmountInCents > 0
                        ? parsedPaymentGrossAmountInCents
                        : null;
                const lockedEstimatedFareFromPayment =
                    hasConfirmedPayment && paymentAmountInCents
                        ? Number((paymentAmountInCents / 100).toFixed(2))
                        : null;
                const estimatedFareForBooking =
                    lockedEstimatedFareFromPayment !== null
                        ? lockedEstimatedFareFromPayment
                        : fareEstimation.estimatedFare;
                const hasLockedRouteMetrics =
                    hasConfirmedPayment &&
                    Number(this.routeDistanceKm) > 0 &&
                    Number(this.routeDurationSecs) > 0;
                const bookingRouteMetrics = hasLockedRouteMetrics
                    ? {
                        distanceKm: Number(this.routeDistanceKm),
                        durationSecs: Math.max(0, Math.round(Number(this.routeDurationSecs))),
                        source: 'payment_quote_lock'
                    }
                    : fareEstimation.routeMetrics;
                const pricingPayloadForBooking =
                    fareEstimation.pricingPayload &&
                    typeof fareEstimation.pricingPayload === 'object'
                        ? {
                            ...fareEstimation.pricingPayload,
                            ...(lockedEstimatedFareFromPayment !== null
                                ? {
                                    final_price: estimatedFareForBooking,
                                    payment_amount_locked: true,
                                    server_estimated_final_price: fareEstimation.estimatedFare
                                }
                                : {})
                        }
                        : fareEstimation.pricingPayload;
                const estimatedFareSnapshot = resolveEstimatedFareSnapshot({
                    paymentService,
                    estimatedFare: estimatedFareForBooking,
                    tollFee: fareEstimation.tollFee
                });
                const discountApplied =
                    Boolean(paymentDiscountBenefit?.applied) &&
                    Boolean(paymentDiscountBenefit?.benefitId);
                const discountUsageRideId = paymentReferenceRideId || bookingId;
                let consumedDiscount = null;
                if (hasConfirmedPayment && discountApplied) {
                    consumedDiscount = await passengerDiscountBenefitService.consumeDiscountForRide({
                        userId: this.customerId,
                        benefitId: paymentDiscountBenefit.benefitId,
                        rideId: discountUsageRideId,
                        grossAmountInCents:
                            paymentGrossAmountInCents ||
                            paymentDiscountBenefit.grossAmountInCents ||
                            Math.round(Number(fareEstimation.estimatedFare || 0) * 100),
                        payableAmountInCents: paymentAmountInCents,
                        discountAmountInCents: paymentDiscountBenefit.discountAmountInCents || 0
                    });
                    if (!consumedDiscount?.success) {
                        throw new Error('Desconto de convite indisponível para esta corrida.');
                    }
                }

                // Criar dados da corrida
                beginStage('booking_payload');
                const bookingData = {
                    bookingId,
                    customerId: this.customerId,
                    passengerName: this.passengerName || null,
                    customerName: this.passengerName || null,
                    pickupLocation: this.pickupLocation,
                    destinationLocation: this.destinationLocation,
                    estimatedFare: estimatedFareForBooking,
                    grossEstimatedFare:
                        paymentGrossAmountInCents
                            ? Number((paymentGrossAmountInCents / 100).toFixed(2))
                            : fareEstimation.estimatedFare,
                    passengerPayableFare: estimatedFareForBooking,
                    passengerDiscountAmount:
                        paymentDiscountBenefit?.discountAmountInCents
                            ? Number((paymentDiscountBenefit.discountAmountInCents / 100).toFixed(2))
                            : 0,
                    passengerDiscountBenefit: paymentDiscountBenefit || null,
                    passengerDiscountUsage: consumedDiscount?.usage || null,
                    routeDistanceKm: bookingRouteMetrics.distanceKm,
                    routeDurationSecs: bookingRouteMetrics.durationSecs,
                    routeCoordinates: this.routeCoordinates,
                    trafficSegments: this.trafficSegments,
                    tollFee: fareEstimation.tollFee,
                    fareSource: bookingRouteMetrics.source,
                    pricingPayload: pricingPayloadForBooking,
                    pricingAudit: fareEstimation.pricingAudit,
                    operationalState: fareEstimation.operationalState,
                    scorePressao: fareEstimation.scorePressao,
                    scoreExcecao: fareEstimation.scoreExcecao,
                    carType: this.carType,
                    paymentMethod: this.paymentMethod,
                    paymentStatus: normalizedPaymentStatus,
                    paymentChargeId,
                    paymentReferenceRideId,
                    paymentSessionId,
                    paymentContextKey,
                    paymentAmountInCents: paymentAmountInCents || '',
                    paymentGrossAmountInCents: paymentGrossAmountInCents || '',
                    paymentQuoteSessionId,
                    paymentQuoteLockId,
                    paymentDriverReservationId,
                    paymentDriverReservationDriverId,
                    paymentDriverReservationExpiresAt,
                    paymentDriverReservationTtlSeconds:
                        Number.isFinite(paymentDriverReservationTtlSeconds) &&
                        paymentDriverReservationTtlSeconds > 0
                            ? paymentDriverReservationTtlSeconds
                            : '',
                    paymentProviderEnvironment,
                    providerEnvironment: paymentProviderEnvironment,
                    paymentProfileId,
                    paymentProfileReason,
                    paymentProfileSource,
                    paymentConfirmedAt,
                    preferences: { ...(this.preferences || {}) },
                    femaleDriverOnly: this.preferences?.femaleDriverOnly === true ||
                        this.preferences?.leafDelas === true ||
                        this.preferences?.leafDelasEnabled === true,
                    regionHash,
                    state: initialRideState,
                    status: initialRideStatus,
                    ...(estimatedFareSnapshot || {}),
                    pricingSnapshotLocked: Boolean(estimatedFareSnapshot),
                    pricingSnapshotLockedAt
                };
                recordStage('booking_payload');

                // Adicionar à fila (isso também cria o booking no Redis)
                beginStage('enqueue');
                await rideQueueManager.enqueueRide(bookingData, {
                    deferEventSourcing: true
                });
                recordStage('enqueue');

                // Corrida sem pagamento confirmado fica bloqueada em AWAITING_PAYMENT.
                // O webhook/confirmPayment validado promove para SEARCHING e dispara dispatch.
                beginStage('state_update');
                if (hasConfirmedPayment) {
                    await RideStateManager.updateBookingState(
                        redis,
                        bookingId,
                        RideStateManager.STATES.SEARCHING,
                        {},
                        {
                            deferSideEffects: true
                        }
                    );
                    bookingData.state = RideStateManager.STATES.SEARCHING;
                    bookingData.status = 'SEARCHING';
                }
                recordStage('state_update');

                // Criar evento canônico
                beginStage('event_build');
                const event = new RideRequestedEvent({
                    bookingId,
                    customerId: this.customerId,
                    pickupLocation: this.pickupLocation,
                    destinationLocation: this.destinationLocation,
                    estimatedFare: estimatedFareForBooking,
                    carType: this.carType,
                    paymentMethod: this.paymentMethod,
                    paymentStatus: normalizedPaymentStatus,
                    ...(estimatedFareSnapshot || {}),
                    pricingSnapshotLocked: Boolean(estimatedFareSnapshot),
                    pricingSnapshotLockedAt,
                    traceId: this.traceId, // ✅ Incluir traceId no evento
                    correlationId: this.correlationId || bookingId // ✅ Incluir correlationId no evento
                });
                recordStage('event_build');
                perfBreakdownMs.total = Math.max(0, Date.now() - startTime);

                logStructured('info', 'RequestRideCommand executado com sucesso', {
                    bookingId,
                    customerId: this.customerId,
                    command: 'RequestRideCommand'
                });

                // ✅ OBSERVABILIDADE: Registrar métrica de sucesso
                metrics.recordCommand('RequestRide', (Date.now() - startTime) / 1000, true);

                // Retornar resultado com dados da corrida e evento
                return CommandResult.success({
                    bookingId,
                    bookingData,
                    event: event.toJSON(),
                    regionHash,
                    perfBreakdownMs
                });

            } catch (error) {
                metrics.recordHotpathStageLatency(
                    'create_booking',
                    `command_${currentStage}`,
                    Math.max(0, (Date.now() - stageStartedAt) / 1000),
                    false
                );
                logStructured('error', 'RequestRideCommand falhou', {
                    customerId: this.customerId,
                    command: 'RequestRideCommand',
                    error: error.message
                });
                metrics.recordCommand('RequestRide', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(error.message)
            }
        });
    }
}

module.exports = RequestRideCommand;
