/**
 * COMMAND: CompleteTripCommand
 * 
 * Processa finalização de viagem.
 * 
 * Responsabilidades:
 * - Validar que viagem pode ser finalizada
 * - Atualizar estado da corrida
 * - Processar pagamento final
 * - Construir evento canônico ride.completed (publicação ocorre no handler/EventBus)
 * 
 * NÃO faz:
 * - Notificar passageiro (isso é responsabilidade de listeners)
 * - Emitir eventos WebSocket (isso é responsabilidade de handlers)
 */

const { Command, CommandResult } = require('./index');
const RideCompletedEvent = require('../events/ride.completed');
const RideStateManager = require('../services/ride-state-manager');
const PaymentService = require('../services/payment-service');
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
const pricingH3ReadModelService = require('../services/pricing-h3-read-model-service');
const driverReferralRewardService = require('../services/driver-referral-reward-service');
const {
    resolveRideLegs,
    resolveOperationalContinuation,
    buildContinuationRideLeg
} = require('../services/ride-lifecycle-service');
const { buildAuthoritativeFinancialSnapshot } = require('../services/ride-financial-contract');
const { resolveFinancialContext } = require('../services/financial-runtime-context');

function toMoney(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.round(parsed * 100) / 100;
}

function toMoneyIfPresent(value) {
    if (value === undefined || value === null || value === '') return null;
    return toMoney(value);
}

function paymentAmountInCentsToReais(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed) / 100;
}

function resolveLockedFareFromBooking(bookingData = {}) {
    const paidAmount = paymentAmountInCentsToReais(bookingData.paymentAmountInCents || bookingData.amountInCents);
    if (paidAmount !== null) return { value: toMoney(paidAmount), source: 'paymentAmountInCents' };

    const estimatedFare = toMoney(bookingData.estimatedFare || bookingData.fare || bookingData.estimate);
    if (estimatedFare !== null && estimatedFare > 0) {
        return { value: estimatedFare, source: 'estimatedFare' };
    }

    return null;
}

function resolveFareToleranceReais() {
    const parsed = Number(process.env.RIDE_FINAL_FARE_TOLERANCE_REAIS || '0.01');
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.01;
}

function buildPendingPaymentDistribution(settlementReview = null) {
    if (settlementReview) {
        return {
            status: 'UNDER_REVIEW',
            message: 'Ajuste financeiro requer liquidação explícita antes do crédito automático do motorista',
            reason: settlementReview.settlementType,
            settlementReviewRequired: true
        };
    }

    return { status: 'PENDING', message: 'Processamento assíncrono em andamento' };
}

function buildDriverOfflineSettlementReview({
    bookingId,
    driverId,
    finalFare,
    duration,
    offlineSeconds
}) {
    const normalizedOfflineSeconds = Math.max(0, Math.floor(Number(offlineSeconds || 0)));
    if (normalizedOfflineSeconds <= 0) return null;

    const originalDurationSecs = Math.max(0, parseInt(duration || 0, 10) || 0);
    const rateCents = Number.parseInt(process.env.DRIVER_OFFLINE_ADJUSTMENT_RATE_CENTS_PER_MINUTE || '50', 10);
    const safeRateCents = Number.isFinite(rateCents) && rateCents >= 0 ? rateCents : 50;
    const estimatedAdjustmentCents = Math.floor((normalizedOfflineSeconds / 60) * safeRateCents);
    const estimatedAdjustmentAmount = toMoney(estimatedAdjustmentCents / 100) || 0;

    return {
        settlementType: 'DRIVER_OFFLINE_TIME_ADJUSTMENT_REVIEW',
        status: 'PENDING_EXPLICIT_LEDGER_SETTLEMENT',
        bookingId,
        driverId,
        reason: 'DRIVER_OFFLINE_DURING_ACTIVE_RIDE',
        offlineSeconds: normalizedOfflineSeconds,
        originalDurationSecs,
        adjustedDurationSecs: Math.max(0, originalDurationSecs - normalizedOfflineSeconds),
        grossFareLocked: toMoney(finalFare) || 0,
        estimatedAdjustmentAmount,
        estimatedAdjustmentCents,
        rateCentsPerMinute: safeRateCents,
        requiresExplicitLedgerSettlement: true,
        createdAt: new Date().toISOString()
    };
}

function safeJsonParse(value, fallback = null) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch (_error) {
        return fallback;
    }
}

function parseCentsField(value) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveConfirmedExtensionRequest(bookingData = {}) {
    const activeExtensionRequest = safeJsonParse(bookingData.activeExtensionRequest, null);
    if (
        activeExtensionRequest &&
        typeof activeExtensionRequest === 'object' &&
        activeExtensionRequest.status === 'CONFIRMED'
    ) {
        return activeExtensionRequest;
    }

    const extensionHistory = safeJsonParse(bookingData.extensionHistory, []);
    if (Array.isArray(extensionHistory)) {
        return [...extensionHistory]
            .reverse()
            .find((entry) => entry && typeof entry === 'object' && entry.status === 'CONFIRMED') || null;
    }

    return null;
}

function resolveExtensionRetainedOperationalFeeCents(bookingData = {}) {
    const confirmedExtension = resolveConfirmedExtensionRequest(bookingData) || {};
    const explicitTotal = parseCentsField(
        confirmedExtension.extensionOperationalCostCents ||
            bookingData.extensionOperationalCostCents
    );
    const routeRecalculationCost = parseCentsField(
        confirmedExtension.routeRecalculationCostCents ||
            bookingData.extensionRouteRecalculationCostCents
    );
    const paymentIntermediationFee = parseCentsField(
        confirmedExtension.paymentIntermediationFeeCents ||
            bookingData.extensionPaymentIntermediationFeeCents
    );
    const roundingBuffer = parseCentsField(
        confirmedExtension.roundingBufferCents ||
            bookingData.extensionRoundingBufferCents
    );

    return Math.max(
        explicitTotal,
        routeRecalculationCost + paymentIntermediationFee + roundingBuffer
    );
}

function resolveCompletedFinancialResultFields(bookingData = {}) {
    const financialSnapshot = safeJsonParse(bookingData.financialSnapshot, null);
    const hasFinancialSnapshot =
        financialSnapshot &&
        typeof financialSnapshot === 'object' &&
        !Array.isArray(financialSnapshot);
    const fields = {};

    if (hasFinancialSnapshot) {
        fields.financialSnapshot = financialSnapshot;
    }

    if (
        hasFinancialSnapshot ||
        bookingData.authoritativeSnapshot !== undefined ||
        bookingData.financialSnapshotSource
    ) {
        fields.authoritativeSnapshot =
            financialSnapshot?.authoritativeSnapshot === true ||
            String(bookingData.authoritativeSnapshot || '').toLowerCase() === 'true';
        fields.financialSnapshotSource =
            financialSnapshot?.financialSnapshotSource ||
            bookingData.financialSnapshotSource ||
            null;
    }

    const moneyFields = [
        'operationalFee',
        'paymentIntermediationFee',
        'subscriptionRetainedFee',
        'totalFees',
        'driverNetAmount'
    ];
    moneyFields.forEach((field) => {
        const value = toMoneyIfPresent(bookingData[field]);
        if (value !== null) {
            fields[field] = value;
        }
    });

    return fields;
}

async function applyDeferredIdentityReverification(driverId, context = {}) {
    try {
        const kycPolicyService = require('../services/kyc-policy-service');
        if (typeof kycPolicyService.applyDeferredIdentityReverificationIfSafe !== 'function') {
            return;
        }
        await kycPolicyService.applyDeferredIdentityReverificationIfSafe(driverId, context);
    } catch (error) {
        logStructured('warn', 'Falha ao aplicar revalidacao KYC adiada apos corrida', {
            service: 'complete-trip-command',
            bookingId: context.tripId || null,
            driverId,
            error: error.message
        });
    }
}

class CompleteTripCommand extends Command {
    constructor(data) {
        super(data);
        this.driverId = data.driverId;
        this.bookingId = data.bookingId;
        this.endLocation = data.endLocation;
        this.finalFare = data.finalFare;
        this.tollFee = data.tollFee || 0; // ✅ Adicionado pedágio
        this.distance = data.distance || 0;
        this.duration = data.duration || 0;
        // ✅ VALIDAÇÃO: Garantir traceId válido
        this.traceId = validateAndEnsureTraceIdInCommand(data, 'CompleteTrip');
        this.correlationId = data.correlationId || this.bookingId; // ✅ Adicionar correlationId
    }

    validate() {
        if (!this.driverId) {
            throw new Error('CompleteTripCommand: driverId é obrigatório');
        }
        if (!this.bookingId) {
            throw new Error('CompleteTripCommand: bookingId é obrigatório');
        }
        if (!this.endLocation || !this.endLocation.lat || !this.endLocation.lng) {
            throw new Error('CompleteTripCommand: endLocation é obrigatório com lat e lng');
        }
        if (this.finalFare === undefined || this.finalFare === null || this.finalFare < 0) {
            throw new Error('CompleteTripCommand: finalFare é obrigatório e deve ser >= 0');
        }
        return true;
    }

    async execute() {
        const startTime = Date.now();
        // ✅ OBSERVABILIDADE: Executar com traceId + OpenTelemetry span
        const tracer = getTracer();
        const span = tracer.startSpan('CompleteTripCommand.execute', {
            attributes: {
                'command.name': 'CompleteTripCommand',
                'booking.id': this.bookingId,
                'trace.id': this.traceId
            }
        });

        return await traceContext.runWithTraceId(this.traceId, async () => {
            try {
                logStructured('info', 'CompleteTripCommand.execute iniciado', {
                    driverId: this.driverId,
                    bookingId: this.bookingId,
                    command: 'CompleteTripCommand'
                });

                // Validar
                this.validate();

                // Garantir conexão Redis
                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();

                // Buscar dados da corrida
                const bookingKey = `booking:${this.bookingId}`;
                const bookingData = await redis.hgetall(bookingKey);

                if (!bookingData || Object.keys(bookingData).length === 0) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Corrida não encontrada' });
                    span.end();
                    metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Corrida não encontrada')
                }

                const financialContextResult = resolveFinancialContext({
                    financialContext: safeJsonParse(bookingData.financialContext, null),
                    financialNamespace: bookingData.financialNamespace,
                    providerEnvironment: bookingData.paymentProviderEnvironment || bookingData.providerEnvironment
                }, { allowLegacyOperational: true });
                if (!financialContextResult.ok) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: financialContextResult.code });
                    span.end();
                    metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure(financialContextResult.error);
                }
                const financialContext = financialContextResult.context;

                // Verificar se motorista é o dono da corrida
                if (bookingData.driverId !== this.driverId) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Motorista não autorizado' });
                    span.end();
                    metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Motorista não autorizado para finalizar esta corrida')
                }

                // Verificar estado atual
                const currentState = await RideStateManager.getBookingState(redis, this.bookingId);

                if (
                    currentState === RideStateManager.STATES.COMPLETED ||
                    String(bookingData.status || '').toUpperCase() === RideStateManager.STATES.COMPLETED
                ) {
                    logStructured('info', 'CompleteTripCommand idempotente: corrida ja finalizada', {
                        bookingId: this.bookingId,
                        driverId: this.driverId,
                        command: 'CompleteTripCommand'
                    });
                    span.end();
                    metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, true);
                    return CommandResult.success({
                        bookingId: this.bookingId,
                        driverId: this.driverId,
                        customerId: bookingData.customerId || null,
                        city: bookingData.city || bookingData.pickupCity || bookingData.destinationCity || 'unknown',
                        serviceType: bookingData.carType || bookingData.serviceType || 'standard',
                        endLocation: safeJsonParse(bookingData.endLocation, this.endLocation),
                        finalFare: toMoney(bookingData.finalFare ?? this.finalFare),
                        tollFee: toMoney(bookingData.tollFee ?? this.tollFee) || 0,
                        distance: toMoney(bookingData.distance ?? bookingData.routeDistanceKm ?? this.distance) || 0,
                        duration: Number.parseInt(String(bookingData.duration || bookingData.routeDurationSecs || this.duration || 0), 10) || 0,
                        paymentDistribution: bookingData.paymentDistribution
                            ? safeJsonParse(bookingData.paymentDistribution, { status: 'PENDING', message: 'Processamento assíncrono em andamento' })
                            : { status: 'PENDING', message: 'Processamento assíncrono em andamento' },
                        ...resolveCompletedFinancialResultFields(bookingData),
                        financialContext,
                        idempotentReplay: true
                    });
                }

                // Validar transição de estado
                if (!RideStateManager.isValidTransition(currentState, RideStateManager.STATES.COMPLETED)) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Invalid state transition' });
                    span.end();
                    metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure(`Corrida não pode ser finalizada no estado atual: ${currentState}`)
                }

                // Parsear dados da corrida
                const customerId = bookingData.customerId;
                const rideCity = bookingData.city || bookingData.pickupCity || bookingData.destinationCity || 'unknown';
                const rideServiceType = bookingData.carType || bookingData.serviceType || 'standard';
                const paymentService = new PaymentService();
                const normalizedFinalFare = toMoney(this.finalFare);
                if (normalizedFinalFare === null || normalizedFinalFare < 0) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Valor final inválido' });
                    span.end();
                    metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Valor final da corrida inválido');
                }

                const lockedFare = resolveLockedFareFromBooking(bookingData);
                const fareTolerance = resolveFareToleranceReais();
                if (lockedFare && lockedFare.value !== null && Math.abs(normalizedFinalFare - lockedFare.value) > fareTolerance) {
                    logStructured('warn', 'CompleteTripCommand bloqueou divergencia de tarifa final', {
                        bookingId: this.bookingId,
                        driverId: this.driverId,
                        command: 'CompleteTripCommand',
                        finalFare: normalizedFinalFare,
                        lockedFare: lockedFare.value,
                        lockedFareSource: lockedFare.source,
                        fareDiff: Math.round(Math.abs(normalizedFinalFare - lockedFare.value) * 100) / 100,
                        tolerance: fareTolerance
                    });
                    span.setStatus({ code: SpanStatusCode.ERROR, message: 'Valor final diverge do valor travado' });
                    span.end();
                    metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Valor final da corrida diverge do valor pago/confirmado');
                }
                this.finalFare = normalizedFinalFare;

                let offlineSettlementReview = null;

                // Offline durante corrida não pode reduzir o bruto Pix/recibo implicitamente.
                // A penalidade fica pendente de liquidação explícita no ledger/refund.
                try {
                    const heartbeatService = require('../services/heartbeat-service');
                    const offlineTimeMs = await heartbeatService.getAndResetOfflineTime(this.driverId);
                    const offlineSeconds = Math.floor(offlineTimeMs / 1000);

                    if (offlineSeconds > 0) {
                        offlineSettlementReview = buildDriverOfflineSettlementReview({
                            bookingId: this.bookingId,
                            driverId: this.driverId,
                            finalFare: this.finalFare,
                            duration: this.duration,
                            offlineSeconds
                        });

                        logger.info('🔌 [CompleteTripCommand] Motorista teve tempo offline; ajuste financeiro enviado para liquidação explícita.', {
                            bookingId: this.bookingId,
                            driverId: this.driverId,
                            offlineSeconds,
                            estimatedAdjustmentAmount: offlineSettlementReview?.estimatedAdjustmentAmount || 0
                        });
                    }
                } catch (hbErr) {
                    logger.warn(`⚠️ [CompleteTripCommand] Falha ao processar resiliência offline: ${hbErr.message}`);
                }

                const paymentDistribution = buildPendingPaymentDistribution(offlineSettlementReview);
                const extensionRetainedOperationalFeeCents = resolveExtensionRetainedOperationalFeeCents(bookingData);
                let completedFareBreakdown = paymentService.calculateFareBreakdownFromReais(
                    Number(this.finalFare || 0),
                    Number(this.tollFee || 0),
                    { subscriptionRetainedFeeCents: extensionRetainedOperationalFeeCents }
                );
                const finalFinancialSnapshot = buildAuthoritativeFinancialSnapshot({
                    passengerPaidCents: Math.round(Number(this.finalFare || 0) * 100),
                    tollFeeCents: Math.round(Number(this.tollFee || 0) * 100),
                    operationalFeeCents: Math.round(Number(completedFareBreakdown.operationalFee || 0) * 100),
                    paymentIntermediationFeeCents: Math.round(
                        Number(completedFareBreakdown.paymentIntermediationFee || 0) * 100
                    ),
                    subscriptionRetainedFeeCents: Math.round(
                        Number(completedFareBreakdown.subscriptionRetainedFee || 0) * 100
                    ),
                    driverNetAmountCents: Math.round(Number(completedFareBreakdown.driverNetAmount || 0) * 100)
                });
                const existingRideLegs = resolveRideLegs(bookingData);
                const operationalContinuation = resolveOperationalContinuation(bookingData);
                const completedAt = new Date().toISOString();
                let rideLegSettlements = existingRideLegs;
                let completedContinuation = operationalContinuation;

                if (existingRideLegs.length > 0 || operationalContinuation) {
                    const finalRideLeg = buildContinuationRideLeg({
                        bookingHash: bookingData,
                        existingRideLegs,
                        driverId: this.driverId,
                        finalFare: this.finalFare,
                        distanceKm: this.distance,
                        durationSecs: this.duration,
                        startLocation: bookingData.startLocation || bookingData.pickupLocation || null,
                        endLocation: this.endLocation,
                        startedAt:
                            operationalContinuation?.currentLegStartedAt ||
                            operationalContinuation?.reassignedStartedAt ||
                            bookingData.startedAt ||
                            null,
                        endedAt: completedAt,
                        metadata: {
                            completionType: existingRideLegs.length > 0 ? 'REASSIGNED_COMPLETION' : 'STANDARD_COMPLETION'
                        }
                    });

                    if (finalRideLeg.grossAmount > 0 || existingRideLegs.length === 0) {
                        rideLegSettlements = [...existingRideLegs, finalRideLeg];
                    }

                    if (operationalContinuation) {
                        completedContinuation = {
                            ...operationalContinuation,
                            status: 'COMPLETED_AFTER_REASSIGNMENT',
                            completedAt,
                            replacementDriverId: this.driverId
                        };
                    }
                }

                // ✅ ARCHITECTURE SHIFT: EDA Refactoring
                // O processamento contábil e distribuição de valor líquido via Woovi
                // agora é realizado ASSINCRONAMENTE pelo `worker-billing.js` que consome
                // o evento `RIDE_COMPLETED`. O request principal de finalização não fica
                // mais bloqueado aguardando chamadas HTTP a gateways de pagamento de terceiros.

                // Liberar lock de motorista
                const lockStatus = await driverLockManager.isDriverLocked(this.driverId);
                if (lockStatus.isLocked && lockStatus.bookingId === this.bookingId) {
                    await driverLockManager.releaseLock(this.driverId, this.bookingId);
                    logger.info(`🔓 [CompleteTripCommand] Lock de motorista ${this.driverId} liberado.`);
                }

                // Atualizar estado da corrida
                await RideStateManager.updateBookingState(
                    redis,
                    this.bookingId,
                    RideStateManager.STATES.COMPLETED,
                    {
                        driverId: this.driverId,
                        endLocation: this.endLocation,
                        finalFare: this.finalFare,
                        tollFee: this.tollFee,
                        distance: this.distance,
                        duration: this.duration,
                        routeDistanceKm: this.distance,
                        routeDurationSecs: this.duration,
                        operationalFee: completedFareBreakdown.operationalFee,
                        paymentIntermediationFee: completedFareBreakdown.paymentIntermediationFee,
                        subscriptionRetainedFee: completedFareBreakdown.subscriptionRetainedFee,
                        totalFees: completedFareBreakdown.totalFees,
                        driverNetAmount: completedFareBreakdown.driverNetAmount,
                        authoritativeSnapshot: true,
                        financialSnapshotSource: 'backend_final',
                        financialSnapshot: finalFinancialSnapshot,
                        completedAt,
                        rideLegs: rideLegSettlements,
                        operationalContinuation: completedContinuation,
                        offlineSettlementReview,
                        settlementReviewRequired: !!offlineSettlementReview,
                        paymentDistribution,
                        financialContext,
                        financialNamespace: financialContext.namespace,
                        financialContextId: financialContext.contextId
                    }
                );

                // Atualizar booking
                await redis.hset(bookingKey, {
                    status: 'COMPLETED',
                    endLocation: JSON.stringify(this.endLocation),
                    finalFare: String(this.finalFare),
                    tollFee: String(this.tollFee),
                    distance: String(this.distance),
                    routeDistanceKm: String(this.distance),
                    duration: String(this.duration),
                    routeDurationSecs: String(this.duration),
                    operationalFee: String(completedFareBreakdown.operationalFee || 0),
                    paymentIntermediationFee: String(completedFareBreakdown.paymentIntermediationFee || 0),
                    subscriptionRetainedFee: String(completedFareBreakdown.subscriptionRetainedFee || 0),
                    totalFees: String(completedFareBreakdown.totalFees || 0),
                    driverNetAmount: String(completedFareBreakdown.driverNetAmount || 0),
                    authoritativeSnapshot: 'true',
                    financialSnapshotSource: 'backend_final',
                    financialSnapshot: JSON.stringify(finalFinancialSnapshot),
                    completedAt,
                    paymentDistribution: JSON.stringify(paymentDistribution),
                    financialContext: JSON.stringify(financialContext),
                    financialNamespace: financialContext.namespace,
                    financialContextId: financialContext.contextId,
                    ...(offlineSettlementReview ? { offlineSettlementReview: JSON.stringify(offlineSettlementReview) } : {}),
                    ...(offlineSettlementReview ? { settlementReviewRequired: 'true' } : {}),
                    ...(rideLegSettlements.length > 0 ? { rideLegs: JSON.stringify(rideLegSettlements) } : {}),
                    ...(completedContinuation ? { operationalContinuation: JSON.stringify(completedContinuation) } : {})
                });

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

                // ✅ NOVO: Remover da lista de corridas ativas
                await redis.hdel('bookings:active', this.bookingId);
                const activeTripCleared = await clearActiveTripForDriver(
                    redis,
                    this.driverId,
                    this.bookingId
                );
                if (activeTripCleared && financialContext.namespace === 'operational') {
                    await applyDeferredIdentityReverification(this.driverId, {
                        source: 'ride_completed',
                        tripId: this.bookingId
                    });
                } else if (!activeTripCleared) {
                    logStructured('warn', 'Revalidacao KYC adiada: indice ativo nao correspondia a corrida concluida', {
                        service: 'complete-trip-command',
                        bookingId: this.bookingId,
                        driverId: this.driverId
                    });
                } else {
                    logStructured('info', 'Revalidacao KYC adiada ignorada em corrida sandbox', {
                        service: 'complete-trip-command',
                        bookingId: this.bookingId,
                        driverId: this.driverId,
                        financialNamespace: financialContext.namespace
                    });
                }
                await pricingH3ReadModelService.clearBookingSnapshot(redis, this.bookingId).catch(() => null);

                const refreshedDriverState = await redis.hgetall(`driver:${this.driverId}`);
                const driverLat = Number(refreshedDriverState?.lat);
                const driverLng = Number(refreshedDriverState?.lng);
                if (Number.isFinite(driverLat) && Number.isFinite(driverLng)) {
                    await pricingH3ReadModelService.applyDriverSnapshot(redis, {
                        driverId: this.driverId,
                        lat: driverLat,
                        lng: driverLng,
                        isOnline: String(refreshedDriverState?.isOnline || 'true') === 'true',
                        available: String(refreshedDriverState?.isOnline || 'true') === 'true'
                    }).catch(() => null);
                }

                // Flush final da trilha de localização fora do caminho crítico.
                // Persistência de trilha é best-effort e não deve atrasar ACK de completeTrip.
                setImmediate(async () => {
                    try {
                        await tripLocationPersistenceService.forceFinalizeTrip(this.bookingId, {
                            status: 'completed',
                            reason: 'ride_completed',
                            financialContext: bookingData.financialContext,
                            financialNamespace: bookingData.financialNamespace,
                            financialContextId: bookingData.financialContextId,
                            providerEnvironment:
                                bookingData.paymentProviderEnvironment || bookingData.providerEnvironment,
                            paymentProfileId: bookingData.paymentProfileId,
                            testUserSandbox: bookingData.testUserSandbox
                        });
                    } catch (locationFinalizeError) {
                        logStructured('warn', 'Falha ao finalizar trilha de localização da corrida', {
                            service: 'complete-trip-command',
                            bookingId: this.bookingId,
                            error: locationFinalizeError.message
                        });
                    }
                });

                if (financialContext.namespace === 'operational') {
                    setImmediate(async () => {
                        try {
                            await driverReferralRewardService.evaluateDriverRewardsForDriver(this.driverId, {
                                source: 'ride_completed',
                                bookingId: this.bookingId
                            });
                        } catch (referralRewardError) {
                            logStructured('warn', 'Falha ao avaliar recompensa automática de indicação de motorista', {
                                service: 'complete-trip-command',
                                bookingId: this.bookingId,
                                driverId: this.driverId,
                                error: referralRewardError.message
                            });
                        }
                    });
                } else {
                    logStructured('info', 'Recompensa de indicação ignorada em corrida sandbox', {
                        service: 'complete-trip-command',
                        bookingId: this.bookingId,
                        driverId: this.driverId,
                        financialNamespace: financialContext.namespace
                    });
                }

                // Criar evento canônico
                const event = new RideCompletedEvent({
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    endLocation: this.endLocation,
                    finalFare: this.finalFare,
                    tollFee: this.tollFee,
                    distance: this.distance,
                    duration: this.duration,
                    rideLegSettlements,
                    operationalContinuation: completedContinuation,
                    offlineSettlementReview,
                    settlementReviewRequired: !!offlineSettlementReview,
                    paymentDistribution,
                    financialSnapshot: finalFinancialSnapshot,
                    financialContext,
                    financialNamespace: financialContext.namespace,
                    financialContextId: financialContext.contextId,
                    traceId: this.traceId, // ✅ Incluir traceId no evento
                    correlationId: this.correlationId || this.bookingId // ✅ Incluir correlationId no evento
                });

                logStructured('info', 'CompleteTripCommand executado com sucesso', {
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    command: 'CompleteTripCommand'
                });

                // ✅ OBSERVABILIDADE: Registrar métrica de sucesso
                metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, true);

                // Retornar resultado com dados da corrida e evento
                return CommandResult.success({
                    bookingId: this.bookingId,
                    driverId: this.driverId,
                    customerId: customerId,
                    city: rideCity,
                    serviceType: rideServiceType,
                    event: event.toJSON(),
                    endLocation: this.endLocation,
                    finalFare: this.finalFare,
                    tollFee: this.tollFee,
                    distance: this.distance,
                    duration: this.duration,
                    offlineSettlementReview,
                    settlementReviewRequired: !!offlineSettlementReview,
                    paymentDistribution,
                    operationalFee: completedFareBreakdown.operationalFee,
                    paymentIntermediationFee: completedFareBreakdown.paymentIntermediationFee,
                    subscriptionRetainedFee: completedFareBreakdown.subscriptionRetainedFee,
                    totalFees: completedFareBreakdown.totalFees,
                    driverNetAmount: completedFareBreakdown.driverNetAmount,
                    authoritativeSnapshot: true,
                    financialSnapshotSource: 'backend_final',
                    financialSnapshot: finalFinancialSnapshot,
                    financialContext
                });

            } catch (error) {
                span.recordException(error);
                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                span.end();

                logStructured('error', 'CompleteTripCommand falhou', {
                    driverId: this.driverId,
                    bookingId: this.bookingId,
                    command: 'CompleteTripCommand',
                    error: error.message
                });
                metrics.recordCommand('CompleteTrip', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(error.message)
            }
        });
    }
}

module.exports = CompleteTripCommand;
