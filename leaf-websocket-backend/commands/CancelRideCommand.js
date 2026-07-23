/**
 * COMMAND: CancelRideCommand
 * 
 * Processa cancelamento de corrida.
 * 
 * Responsabilidades:
 * - Validar que corrida pode ser cancelada
 * - Atualizar estado da corrida
 * - Processar reembolso se necessário
 * - Construir evento canônico ride.canceled (publicação ocorre no handler/EventBus)
 * 
 * NÃO faz:
 * - Notificar passageiro/motorista (isso é responsabilidade de listeners)
 * - Emitir eventos WebSocket (isso é responsabilidade de handlers)
 */

const { Command, CommandResult } = require('./index');
const RideCanceledEvent = require('../events/ride.canceled');
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
const { resolveFinancialContext } = require('../services/financial-runtime-context');

const PASSENGER_CANCEL_FIXED_FEE_CENTS = Math.max(
    0,
    Number.parseInt(process.env.PASSENGER_CANCEL_FIXED_FEE_CENTS || '200', 10) || 200
);
const PASSENGER_CANCEL_DRIVER_DISTANCE_RATE_CENTS_PER_KM = Math.max(
    0,
    Number.parseInt(process.env.PASSENGER_CANCEL_DRIVER_DISTANCE_RATE_CENTS_PER_KM || '120', 10) || 120
);
const PASSENGER_CANCEL_DRIVER_TIME_RATE_CENTS_PER_MIN = Math.max(
    0,
    Number.parseInt(process.env.PASSENGER_CANCEL_DRIVER_TIME_RATE_CENTS_PER_MIN || '30', 10) || 30
);
const PASSENGER_CANCEL_FEE_CAP_PERCENT = Math.min(
    1,
    Math.max(0, Number.parseFloat(process.env.PASSENGER_CANCEL_FEE_CAP_PERCENT || '0.7') || 0.7)
);

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function parseLocationCandidate(rawValue) {
    if (!rawValue) return null;
    if (typeof rawValue === 'object') {
        const lat = toFiniteNumber(rawValue.lat);
        const lng = toFiniteNumber(rawValue.lng);
        if (lat === null || lng === null) return null;
        return { lat, lng };
    }

    try {
        const parsed = JSON.parse(rawValue);
        const lat = toFiniteNumber(parsed?.lat);
        const lng = toFiniteNumber(parsed?.lng);
        if (lat === null || lng === null) return null;
        return { lat, lng };
    } catch (_error) {
        return null;
    }
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

function parseTimestampMs(rawValue) {
    if (!rawValue) return null;
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) return rawValue;
    const numeric = Number(rawValue);
    if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
    }
    const dateValue = Date.parse(String(rawValue));
    if (Number.isFinite(dateValue)) {
        return dateValue;
    }
    return null;
}

function isAuthorizedCancellationActor({ canceledBy, userType, customerId, driverId }) {
    const normalizedActorId = String(canceledBy || '').trim();
    const normalizedUserType = String(userType || '').trim().toLowerCase();
    const normalizedCustomerId = String(customerId || '').trim();
    const normalizedDriverId = String(driverId || '').trim();

    if (
        normalizedUserType === 'system' &&
        normalizedActorId === 'system_trip_integrity'
    ) {
        return true;
    }

    if (
        ['customer', 'passenger'].includes(normalizedUserType) &&
        normalizedActorId &&
        normalizedActorId === normalizedCustomerId
    ) {
        return true;
    }

    return (
        normalizedUserType === 'driver' &&
        normalizedActorId &&
        normalizedActorId === normalizedDriverId
    );
}

function normalizeMoneyToCents(rawValue) {
    const parsed = Number.parseFloat(rawValue || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0;
    if (parsed >= 1000) return Math.round(parsed); // já está em centavos
    return Math.round(parsed * 100); // valor em reais
}

function isRefundablePaymentStatus(status) {
    return ['PAID', 'CONFIRMED', 'LEDGER_PENDING', 'IN_HOLDING'].includes(
        String(status || '').trim().toUpperCase()
    );
}

function haversineDistanceKm(lat1, lng1, lat2, lng2) {
    const nLat1 = toFiniteNumber(lat1);
    const nLng1 = toFiniteNumber(lng1);
    const nLat2 = toFiniteNumber(lat2);
    const nLng2 = toFiniteNumber(lng2);
    if ([nLat1, nLng1, nLat2, nLng2].some((entry) => entry === null)) {
        return null;
    }

    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(nLat2 - nLat1);
    const dLng = toRad(nLng2 - nLng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
        + Math.cos(toRad(nLat1)) * Math.cos(toRad(nLat2))
        * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const earthRadiusKm = 6371;
    return earthRadiusKm * c;
}

async function applyDeferredIdentityReverification(driverId, context = {}) {
    try {
        const kycPolicyService = require('../services/kyc-policy-service');
        if (typeof kycPolicyService.applyDeferredIdentityReverificationIfSafe !== 'function') {
            return;
        }
        await kycPolicyService.applyDeferredIdentityReverificationIfSafe(driverId, context);
    } catch (error) {
        logStructured('warn', 'Falha ao aplicar revalidacao KYC adiada apos cancelamento', {
            service: 'cancel-ride-command',
            bookingId: context.tripId || null,
            driverId,
            error: error.message
        });
    }
}

class CancelRideCommand extends Command {
    constructor(data) {
        super(data);
        this.bookingId = data.bookingId;
        this.canceledBy = data.canceledBy; // userId que cancelou
        this.reason = data.reason || 'Cancelado pelo usuário';
        // A taxa nunca vem do cliente. Ela é sempre derivada do estado e dos
        // dados canônicos da corrida dentro deste command.
        this.cancellationFee = 0;
        this.userType = data.userType; // Tipo de usuário (customer/driver)
        // ✅ VALIDAÇÃO: Garantir traceId válido
        this.traceId = validateAndEnsureTraceIdInCommand(data, 'CancelRide');
        this.correlationId = data.correlationId || this.bookingId; // ✅ Adicionar correlationId
    }

    validate() {
        if (!this.bookingId) {
            throw new Error('CancelRideCommand: bookingId é obrigatório');
        }
        if (!this.canceledBy) {
            throw new Error('CancelRideCommand: canceledBy é obrigatório');
        }
        if (this.cancellationFee < 0) {
            throw new Error('CancelRideCommand: cancellationFee deve ser >= 0');
        }
        return true;
    }

    async execute() {
        const startTime = Date.now();
        // ✅ OBSERVABILIDADE: Executar com traceId + OpenTelemetry span
        const tracer = getTracer();
        const span = tracer.startSpan('CancelRideCommand.execute', {
            attributes: {
                'command.name': 'CancelRideCommand',
                'booking.id': this.bookingId,
                'trace.id': this.traceId
            }
        });

        return await traceContext.runWithTraceId(this.traceId, async () => {
            try {
                logStructured('info', 'CancelRideCommand.execute iniciado', {
                    bookingId: this.bookingId,
                    canceledBy: this.canceledBy,
                    command: 'CancelRideCommand'
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
                    metrics.recordCommand('CancelRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Corrida não encontrada')
                }

                const financialContextResult = resolveFinancialContext({
                    financialContext: safeJsonParse(bookingData.financialContext, null),
                    financialNamespace: bookingData.financialNamespace,
                    providerEnvironment:
                        bookingData.paymentProviderEnvironment || bookingData.providerEnvironment,
                    testUserSandbox:
                        bookingData.testUserSandbox === true || bookingData.testUserSandbox === 'true'
                }, { allowLegacyOperational: true });
                if (!financialContextResult.ok) {
                    span.setStatus({ code: SpanStatusCode.ERROR, message: financialContextResult.code });
                    span.end();
                    metrics.recordCommand('CancelRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure(financialContextResult.error);
                }
                const financialContext = financialContextResult.context;

                // Verificar estado atual
                const currentState = await RideStateManager.getBookingState(redis, this.bookingId);

                const customerId = bookingData.customerId || bookingData.passengerId;
                const driverId = bookingData.driverId;
                const isSystemTripIntegrityCancellation =
                    String(this.userType || '').trim().toLowerCase() === 'system' &&
                    this.canceledBy === 'system_trip_integrity';
                if (!isAuthorizedCancellationActor({
                    canceledBy: this.canceledBy,
                    userType: this.userType,
                    customerId,
                    driverId
                })) {
                    metrics.recordCommand('CancelRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Usuário não autorizado para cancelar esta corrida');
                }

                const blockedStatesAfterTripStart = new Set([
                    RideStateManager.STATES.IN_PROGRESS,
                    RideStateManager.STATES.REASSIGNED_IN_PROGRESS,
                    RideStateManager.STATES.COMPLETED,
                    RideStateManager.STATES.EARLY_ENDED_BY_RIDER,
                    RideStateManager.STATES.EARLY_ENDED_REVIEW
                ]);

                // Depois que a corrida começou, o fluxo correto é complete/endEarly/review.
                if (
                    blockedStatesAfterTripStart.has(currentState) &&
                    !isSystemTripIntegrityCancellation
                ) {
                    metrics.recordCommand('CancelRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Após o início da corrida, use o encerramento adequado em vez de cancelamento')
                }

                if (
                    currentState === RideStateManager.STATES.CANCELED ||
                    String(bookingData.status || '').trim().toUpperCase() === RideStateManager.STATES.CANCELED
                ) {
                    metrics.recordCommand('CancelRide', (Date.now() - startTime) / 1000, false);
                    return CommandResult.failure('Corrida já está cancelada');
                }

                // Parsear dados da corrida

                // Liberar lock de motorista se houver
                if (driverId) {
                    const lockStatus = await driverLockManager.isDriverLocked(driverId);
                    if (lockStatus.isLocked && lockStatus.bookingId === this.bookingId) {
                        await driverLockManager.releaseLock(driverId);
                        logger.info(`🔓 [CancelRideCommand] Lock de motorista ${driverId} liberado.`);
                    }
                }

                const paymentService = new PaymentService();

                // ✅ Regra de negócio (passageiro):
                // - sem motorista aceito: estorno integral
                // - com motorista aceito: taxa = woovi + distância + tempo + R$2,00
                if (this.userType === 'customer') {
                    if (currentState === RideStateManager.STATES.SEARCHING || currentState === RideStateManager.STATES.PENDING || currentState === RideStateManager.STATES.NOTIFIED) {
                        this.cancellationFee = 0;
                        logger.info(`💸 [CancelRideCommand] Cancelamento antes de aceite. Estorno integral.`);
                    } else if (currentState === RideStateManager.STATES.ACCEPTED || currentState === RideStateManager.STATES.ARRIVED) {
                        const estimatedFareCents = normalizeMoneyToCents(bookingData.estimatedFare || bookingData.totalAmount || 0);
                        const wooviFee = Math.max(
                            Math.round(estimatedFareCents * paymentService.WOOVI_FEE_PERCENTAGE),
                            paymentService.WOOVI_FEE_MINIMUM
                        );
                        const acceptedAtMs = parseTimestampMs(bookingData.acceptedAt) || Date.now();
                        const elapsedMinutes = Math.max(0, Math.round((Date.now() - acceptedAtMs) / 60000));
                        const driverTimeFee = elapsedMinutes * PASSENGER_CANCEL_DRIVER_TIME_RATE_CENTS_PER_MIN;

                        const acceptedLocation = parseLocationCandidate(bookingData.driverAcceptedLocation);
                        let currentDriverLocation = null;
                        if (driverId) {
                            try {
                                const driverGeo = await redis.geopos('driver_locations', driverId);
                                const driverGeoPoint = Array.isArray(driverGeo) && driverGeo.length > 0
                                    ? driverGeo[0]
                                    : null;
                                const geoLng = toFiniteNumber(driverGeoPoint?.[0]);
                                const geoLat = toFiniteNumber(driverGeoPoint?.[1]);
                                if (geoLat !== null && geoLng !== null) {
                                    currentDriverLocation = { lat: geoLat, lng: geoLng };
                                }
                            } catch (_geoError) {
                                currentDriverLocation = null;
                            }
                        }

                        let traveledDistanceKm = null;
                        if (acceptedLocation && currentDriverLocation) {
                            traveledDistanceKm = haversineDistanceKm(
                                acceptedLocation.lat,
                                acceptedLocation.lng,
                                currentDriverLocation.lat,
                                currentDriverLocation.lng
                            );
                        }
                        if (!Number.isFinite(traveledDistanceKm) || traveledDistanceKm < 0) {
                            traveledDistanceKm = Math.max(
                                0,
                                Number.parseFloat(bookingData.driverDistanceToPickupKm || 0)
                            );
                        }

                        const driverDistanceFee = Math.round(
                            traveledDistanceKm * PASSENGER_CANCEL_DRIVER_DISTANCE_RATE_CENTS_PER_KM
                        );
                        const fixedFee = PASSENGER_CANCEL_FIXED_FEE_CENTS;
                        const rawFee = wooviFee + driverDistanceFee + driverTimeFee + fixedFee;
                        const cappedFee = estimatedFareCents > 0
                            ? Math.min(rawFee, Math.round(estimatedFareCents * PASSENGER_CANCEL_FEE_CAP_PERCENT))
                            : rawFee;

                        this.cancellationFee = Math.max(
                            Math.max(wooviFee + fixedFee, 0),
                            Math.round(cappedFee)
                        );

                        logger.info(
                            `💸 [CancelRideCommand] Cancelamento com motorista aceito. Taxa=R$ ${(this.cancellationFee / 100).toFixed(2)} (woovi=${(wooviFee / 100).toFixed(2)}, dist=${(driverDistanceFee / 100).toFixed(2)}, tempo=${(driverTimeFee / 100).toFixed(2)}, fixo=${(fixedFee / 100).toFixed(2)})`
                        );
                    } else {
                        this.cancellationFee = 0;
                        logger.info(`💸 [CancelRideCommand] Estado ${currentState} sem taxa de cancelamento para passageiro.`);
                    }
                } else if (this.userType === 'driver' && currentState === RideStateManager.STATES.ARRIVED) {
                    // ✅ CAOS SCENARIO: No-Show do Passageiro (Driver No-Show Câncel)
                    const arrivedAtStr = bookingData.driverArrivedAt;
                    if (arrivedAtStr) {
                        const arrivedAt = new Date(parseInt(arrivedAtStr)).getTime();
                        const elapsedMs = Date.now() - arrivedAt;
                        const elapsedMinutes = Math.floor(elapsedMs / 60000);

                        // Threshold de 5 minutos (300.000 ms) de espera
                        if (elapsedMinutes >= 5) {
                            const waitTimeFee = elapsedMinutes * 50; // R$ 0,50 por minuto esperado
                            const wooviFee = 50;
                            const estimatedFare = parseInt(bookingData.estimatedFare || 0);
                            const maxFee = estimatedFare > 0 ? Math.floor(estimatedFare * 0.4) : 500; // Teto de 40%

                            let calculatedFee = wooviFee + waitTimeFee;
                            if (calculatedFee > maxFee && maxFee > 0) calculatedFee = maxFee;

                            this.cancellationFee = calculatedFee;
                            logger.info(`💸 [CancelRideCommand] Driver Cancel (No-Show). Passageiro demorou ${elapsedMinutes} min. Multa de R$ ${(this.cancellationFee / 100).toFixed(2)}.`);
                        } else {
                            this.cancellationFee = 0;
                            logger.info(`💸 [CancelRideCommand] Driver Cancelou prematuramente em ARRIVED (${elapsedMinutes} min). Sem multa.`);
                        }
                    }
                }

                // Processar reembolso se houver pagamento
                let refundResult = null;
                const paymentRecord = await paymentService.getStoredPayment(
                    this.bookingId,
                    financialContext
                );
                const paymentAmount = Number(paymentRecord?.amount || 0);
                const chargeIdToRefund = paymentRecord?.chargeId || paymentRecord?.paymentId;

                if (Number.isFinite(paymentAmount) && paymentAmount > 0) {
                    this.cancellationFee = Math.min(this.cancellationFee, paymentAmount);
                }

                if (
                    paymentRecord &&
                    isRefundablePaymentStatus(paymentRecord.status) &&
                    chargeIdToRefund &&
                    Number.isFinite(paymentAmount) &&
                    paymentAmount > 0
                ) {
                    if (this.cancellationFee && this.cancellationFee > 0) {
                        // Reembolso parcial
                        const refundAmount = paymentAmount - this.cancellationFee;
                        if (refundAmount > 0) {
                            refundResult = await paymentService.processRideRefund({
                                rideId: this.bookingId,
                                chargeId: chargeIdToRefund,
                                amount: refundAmount,
                                cancellationFee: this.cancellationFee,
                                reason: this.reason || 'Cancelado pelo usuário',
                                status: 'REFUNDED_PARTIAL',
                                passengerId: customerId,
                                financialContext,
                                metadata: {
                                    source: 'CancelRideCommand',
                                    cancelledBy: this.canceledBy,
                                    userType: this.userType
                                }
                            });
                            if (!refundResult.success) {
                                throw new Error(refundResult.error || 'Falha ao processar reembolso PIX');
                            }
                        } else {
                            const markResult = await paymentService.markPaymentRefunded(this.bookingId, {
                                refundAmount: 0,
                                cancellationFee: this.cancellationFee,
                                chargeId: chargeIdToRefund,
                                status: 'FEE_ONLY',
                                reason: this.reason || 'Cancelado pelo usuário',
                                passengerId: customerId,
                                financialContext,
                                metadata: {
                                    source: 'CancelRideCommand',
                                    cancelledBy: this.canceledBy,
                                    userType: this.userType
                                }
                            });
                            if (!markResult.success) {
                                throw new Error(markResult.error || 'Falha ao registrar taxa de cancelamento');
                            }
                            refundResult = {
                                success: true,
                                noProviderRefund: true,
                                amount: 0,
                                chargeId: chargeIdToRefund
                            };
                        }
                    } else {
                        // Reembolso total
                        refundResult = await paymentService.processRideRefund({
                            rideId: this.bookingId,
                            chargeId: chargeIdToRefund,
                            amount: paymentAmount,
                            reason: this.reason || 'Cancelado pelo usuário',
                            status: 'REFUNDED_FULL',
                            passengerId: customerId,
                            financialContext,
                            metadata: {
                                source: 'CancelRideCommand',
                                cancelledBy: this.canceledBy,
                                userType: this.userType
                            }
                        });
                        if (!refundResult.success) {
                            throw new Error(refundResult.error || 'Falha ao processar reembolso PIX');
                        }
                    }
                }

                // Atualizar estado da corrida
                await RideStateManager.updateBookingState(
                    redis,
                    this.bookingId,
                    RideStateManager.STATES.CANCELED,
                    {
                        canceledBy: this.canceledBy,
                        reason: this.reason,
                        cancellationFee: this.cancellationFee,
                        cancelledAt: new Date().toISOString()
                    }
                );

                // Atualizar booking
                await redis.hset(bookingKey, {
                    status: 'CANCELED',
                    canceledBy: this.canceledBy,
                    reason: this.reason,
                    cancellationFee: String(this.cancellationFee),
                    cancelledAt: new Date().toISOString()
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
                await pricingH3ReadModelService.clearBookingSnapshot(redis, this.bookingId).catch(() => null);
                if (driverId) {
                    const activeTripCleared = await clearActiveTripForDriver(
                        redis,
                        driverId,
                        this.bookingId
                    );
                    if (activeTripCleared && financialContext.namespace === 'operational') {
                        await applyDeferredIdentityReverification(driverId, {
                            source: 'ride_canceled',
                            tripId: this.bookingId
                        });
                    } else if (!activeTripCleared) {
                        logStructured('warn', 'Revalidacao KYC adiada: indice ativo nao correspondia a corrida cancelada', {
                            service: 'cancel-ride-command',
                            bookingId: this.bookingId,
                            driverId
                        });
                    } else {
                        logStructured('info', 'Revalidacao KYC adiada ignorada em cancelamento sandbox', {
                            service: 'cancel-ride-command',
                            bookingId: this.bookingId,
                            driverId,
                            financialNamespace: financialContext.namespace
                        });
                    }
                    const refreshedDriverState = await redis.hgetall(`driver:${driverId}`);
                    const driverLat = Number(refreshedDriverState?.lat);
                    const driverLng = Number(refreshedDriverState?.lng);
                    if (Number.isFinite(driverLat) && Number.isFinite(driverLng)) {
                        await pricingH3ReadModelService.applyDriverSnapshot(redis, {
                            driverId,
                            lat: driverLat,
                            lng: driverLng,
                            isOnline: String(refreshedDriverState?.isOnline || 'true') === 'true',
                            available: String(refreshedDriverState?.isOnline || 'true') === 'true'
                        }).catch(() => null);
                    }
                }

                // Flush final da trilha de localização (se existirem pontos) para manter integridade histórica
                try {
                    await tripLocationPersistenceService.forceFinalizeTrip(this.bookingId, {
                        status: 'canceled',
                        reason: 'ride_canceled',
                        financialContext: bookingData.financialContext,
                        financialNamespace: bookingData.financialNamespace,
                        financialContextId: bookingData.financialContextId,
                        providerEnvironment:
                            bookingData.paymentProviderEnvironment || bookingData.providerEnvironment,
                        paymentProfileId: bookingData.paymentProfileId,
                        testUserSandbox: bookingData.testUserSandbox
                    });
                } catch (locationFinalizeError) {
                    logStructured('warn', 'Falha ao finalizar trilha de localização da corrida cancelada', {
                        service: 'cancel-ride-command',
                        bookingId: this.bookingId,
                        error: locationFinalizeError.message
                    });
                }

                // Criar evento canônico
                const event = new RideCanceledEvent({
                    bookingId: this.bookingId,
                    canceledBy: this.canceledBy,
                    reason: this.reason,
                    cancellationFee: this.cancellationFee,
                    driverId: driverId, // ✅ Incluir driverId para processamento no billing-worker
                    financialContext,
                    financialNamespace: financialContext.namespace,
                    financialContextId: financialContext.contextId,
                    providerEnvironment: financialContext.providerEnvironment,
                    paymentProviderEnvironment: financialContext.providerEnvironment,
                    paymentProfileId: financialContext.paymentProfileId || null,
                    testUserSandbox: financialContext.testUserSandbox === true,
                    traceId: this.traceId, // ✅ Incluir traceId no evento
                    correlationId: this.correlationId || this.bookingId // ✅ Incluir correlationId no evento
                });

                logStructured('info', 'CancelRideCommand executado com sucesso', {
                    bookingId: this.bookingId,
                    canceledBy: this.canceledBy,
                    reason: this.reason,
                    command: 'CancelRideCommand'
                });

                // ✅ OBSERVABILIDADE: Registrar métrica de sucesso
                metrics.recordCommand('CancelRide', (Date.now() - startTime) / 1000, true);

                // Retornar resultado com dados da corrida e evento
                return CommandResult.success({
                    bookingId: this.bookingId,
                    canceledBy: this.canceledBy,
                    reason: this.reason,
                    cancellationFee: this.cancellationFee,
                    driverId: driverId,
                    financialContext,
                    financialNamespace: financialContext.namespace,
                    financialContextId: financialContext.contextId,
                    event: event.toJSON(),
                    refundResult: refundResult
                });

            } catch (error) {
                span.recordException(error);
                span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
                span.end();

                logStructured('error', 'CancelRideCommand falhou', {
                    bookingId: this.bookingId,
                    canceledBy: this.canceledBy,
                    command: 'CancelRideCommand',
                    error: error.message
                });
                metrics.recordCommand('CancelRide', (Date.now() - startTime) / 1000, false);
                return CommandResult.failure(error.message)
            }
        });
    }
}

module.exports = CancelRideCommand;
module.exports.isAuthorizedCancellationActor = isAuthorizedCancellationActor;
