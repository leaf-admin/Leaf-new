const PaymentService = require('../services/payment-service');
const paymentServiceSingleton = new PaymentService();
const {
    collectPaymentReferences,
    normalizePaymentAmountCents,
    resolveAuthoritativePaymentConfirmation
} = require('../services/authoritative-payment-confirmation-service');
const {
    buildRouteSignature,
    normalizeAmountCents: normalizeQuoteAmountCents
} = require('../services/quote-lock-service');
const {
    getOperationsPolicyDriverLimit,
    getOperationsPolicyRadiusKm
} = require('../utils/dispatch-config');
const { normalizeOperationalCarType } = require('../utils/operational-car-type');
const {
    evaluateRideFlowValidationPaymentBinding
} = require('../services/ride-flow-validation-guard');

function normalizeText(value) {
    return String(value || '').trim();
}

function normalizePositiveNumber(value, fallback = 0) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : fallback;
}

function normalizeRouteCoordinate(value) {
    const lat = Number(value?.lat ?? value?.latitude);
    const lng = Number(value?.lng ?? value?.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat, lng };
}

function normalizeRouteCoordinates(value = []) {
    if (!Array.isArray(value)) return [];
    return value
        .map(normalizeRouteCoordinate)
        .filter(Boolean)
        .slice(0, 800);
}

function normalizeTrafficSegments(value = []) {
    if (!Array.isArray(value)) return [];
    return value
        .slice(0, 80)
        .map((segment) => {
            const coordinates = normalizeRouteCoordinates(segment?.coordinates);
            if (coordinates.length < 2) return null;
            return {
                level: normalizeText(segment?.level || segment?.trafficLevel || 'normal').slice(0, 32),
                color: normalizeText(segment?.color || '').slice(0, 32),
                coordinates
            };
        })
        .filter(Boolean);
}

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeComparableCarType(value) {
    return normalizeOperationalCarType(value, '');
}

function isTruthyEnv(value) {
    return ['1', 'true', 'yes', 'on', 'sim'].includes(
        String(value || '').trim().toLowerCase()
    );
}

function isSandboxOrSmokePaymentIntent(advancePaymentIntent = {}) {
    if (isTruthyEnv(process.env.REAL_SMOKE_DISABLE_TTLS)) return true;
    if (isTruthyEnv(process.env.ALLOW_SANDBOX_PAYMENT_DRIVER_RESERVATION_RECOVERY)) return true;

    const haystack = [
        advancePaymentIntent.providerEnvironment,
        advancePaymentIntent.paymentProfileId,
        advancePaymentIntent.paymentProfileReason,
        advancePaymentIntent.paymentProfileSource
    ].map((value) => String(value || '').trim().toLowerCase());

    return haystack.some((value) =>
        value === 'sandbox' ||
        value.includes('sandbox') ||
        value.includes('smoke') ||
        value.includes('test')
    );
}

function isRecoverablePaymentDriverReservationCode(code) {
    return new Set([
        'PAYMENT_DRIVER_RESERVATION_MISSING',
        'PAYMENT_DRIVER_RESERVATION_EXPIRED',
        'PAYMENT_DRIVER_RESERVATION_RELEASED'
    ]).has(String(code || '').trim().toUpperCase());
}

function availabilityContainsDriver(availability = {}, driverId) {
    const safeDriverId = normalizeText(driverId);
    if (!safeDriverId) return false;
    return Array.isArray(availability.drivers) && availability.drivers.some((driver) =>
        normalizeText(driver?.id || driver?.driverId || driver) === safeDriverId
    );
}

async function recoverSandboxPaymentDriverReservation({
    redis,
    validationCode,
    advancePaymentIntent,
    paymentIntentBinding,
    customerId,
    paymentReferenceRideId,
    pickupLocation,
    destinationLocation,
    requestedCarType,
    preferences,
    checkAvailability,
    logStructured = () => {},
    logContext = {}
} = {}) {
    if (!isRecoverablePaymentDriverReservationCode(validationCode)) {
        return { success: false, code: validationCode || 'PAYMENT_DRIVER_RESERVATION_INVALID' };
    }

    if (!isSandboxOrSmokePaymentIntent(advancePaymentIntent)) {
        return { success: false, code: validationCode || 'PAYMENT_DRIVER_RESERVATION_INVALID' };
    }

    const driverId = normalizeText(
        paymentIntentBinding?.paymentDriverReservationDriverId ||
        advancePaymentIntent?.paymentDriverReservationDriverId
    );
    const reservationId = normalizeText(
        paymentIntentBinding?.paymentDriverReservationId ||
        advancePaymentIntent?.paymentDriverReservationId
    );
    if (!driverId || !reservationId || typeof checkAvailability !== 'function') {
        return { success: false, code: validationCode || 'PAYMENT_DRIVER_RESERVATION_INVALID' };
    }

    const availability = await checkAvailability(pickupLocation, {
        destinationLocation,
        preferences,
        carType: requestedCarType
    });

    if (!availability?.success || !availabilityContainsDriver(availability, driverId)) {
        logStructured('warn', 'Recuperação sandbox da reserva de motorista negada: motorista não está elegível', {
            ...logContext,
            validationCode,
            driverId,
            reservationId,
            availabilityCode: availability?.code || null
        });
        return { success: false, code: 'PAYMENT_DRIVER_RESERVATION_RECOVERY_DRIVER_UNAVAILABLE' };
    }

    const { reservePaymentDriver } = require('../services/payment-driver-reservation-service');
    const ttlSeconds = parsePositiveInteger(
        process.env.SANDBOX_PAYMENT_DRIVER_RESERVATION_RECOVERY_TTL_SECONDS ||
        process.env.REAL_SMOKE_PAYMENT_DRIVER_RESERVATION_TTL_SECONDS,
        6 * 60 * 60
    );
    const reservationResult = await reservePaymentDriver({
        redis,
        driverId,
        reservationId,
        passengerId: customerId,
        rideId: paymentReferenceRideId || advancePaymentIntent?.rideId || null,
        paymentSessionId: paymentIntentBinding?.paymentSessionId || advancePaymentIntent?.paymentSessionId || null,
        paymentContextKey: paymentIntentBinding?.paymentContextKey || advancePaymentIntent?.paymentContextKey || null,
        quoteSessionId: paymentIntentBinding?.quoteSessionId || advancePaymentIntent?.quoteSessionId || null,
        quoteLockId: paymentIntentBinding?.quoteLockId || advancePaymentIntent?.quoteLockId || null,
        pickupLocation,
        destinationLocation,
        carType: requestedCarType,
        paymentIntentId: advancePaymentIntent?.paymentIntentId || null,
        ttlSeconds
    });

    if (!reservationResult?.success) {
        return {
            success: false,
            code: reservationResult?.code || 'PAYMENT_DRIVER_RESERVATION_RECOVERY_FAILED'
        };
    }

    logStructured('warn', 'Reserva de motorista recuperada para smoke sandbox após TTL', {
        ...logContext,
        validationCode,
        driverId,
        reservationId: reservationResult.reservationId,
        ttlSeconds
    });

    return {
        success: true,
        reservation: reservationResult.reservation,
        code: 'PAYMENT_DRIVER_RESERVATION_RECOVERED_FOR_SANDBOX'
    };
}

function resolvePaymentIntentValue(intent = {}, snapshot = {}, ...keys) {
    for (const key of keys) {
        const value = intent?.[key] ?? snapshot?.[key];
        if (value !== undefined && value !== null && normalizeText(value)) {
            return normalizeText(value);
        }
    }
    return '';
}

function resolveIncomingPaymentBinding(data = {}) {
    const paymentData = data?.paymentData && typeof data.paymentData === 'object'
        ? data.paymentData
        : {};

    return {
        paymentSessionId: normalizeText(
            paymentData.paymentSessionId ||
            paymentData.sessionId ||
            data.paymentSessionId
        ),
        paymentContextKey: normalizeText(
            paymentData.paymentContextKey ||
            paymentData.contextKey ||
            data.paymentContextKey
        ),
        quoteSessionId: normalizeText(
            paymentData.quoteSessionId ||
            data.quoteSessionId
        ),
        quoteLockId: normalizeText(
            paymentData.quoteLockId ||
            data.quoteLockId
        ),
        paymentDriverReservationId: normalizeText(
            paymentData.paymentDriverReservationId ||
            data.paymentDriverReservationId
        ),
        payableAmountInCents: normalizeQuoteAmountCents(
            paymentData.amountInCents ??
            data.paymentAmountInCents ??
            data.amountInCents,
            0
        ),
        grossAmountInCents: normalizeQuoteAmountCents(
            paymentData.grossAmountInCents ??
            data.grossAmountInCents,
            0
        )
    };
}

function validateAdvancePaymentIntentBinding({
    advancePaymentIntent,
    data,
    customerId,
    pickupLocation,
    destinationLocation,
    requestedCarType,
    resolvedPaymentAmountInCents
} = {}) {
    if (!advancePaymentIntent?.found) {
        return { success: true, binding: {} };
    }

    const quoteLockSnapshot = advancePaymentIntent.quoteLockSnapshot || {};
    const incoming = resolveIncomingPaymentBinding(data);
    const expectedPassengerId = normalizeText(advancePaymentIntent.passengerId);
    const incomingPassengerId = normalizeText(customerId);
    if (expectedPassengerId && expectedPassengerId !== incomingPassengerId) {
        return {
            success: false,
            code: 'PAYMENT_INTENT_PASSENGER_MISMATCH',
            message: 'Este pagamento pertence a outro passageiro.'
        };
    }

    const expectedQuoteLockId = resolvePaymentIntentValue(
        advancePaymentIntent,
        quoteLockSnapshot,
        'quoteLockId',
        'quote_lock_id'
    );
    if (expectedQuoteLockId && incoming.quoteLockId !== expectedQuoteLockId) {
        return {
            success: false,
            code: 'PAYMENT_INTENT_QUOTE_LOCK_MISMATCH',
            message: 'O pagamento não pertence à cotação desta corrida.'
        };
    }

    const expectedQuoteSessionId = resolvePaymentIntentValue(
        advancePaymentIntent,
        quoteLockSnapshot,
        'quoteSessionId'
    );
    if (expectedQuoteSessionId && incoming.quoteSessionId !== expectedQuoteSessionId) {
        return {
            success: false,
            code: 'PAYMENT_INTENT_QUOTE_SESSION_MISMATCH',
            message: 'A sessão de cotação do pagamento não confere com a corrida.'
        };
    }

    const expectedPaymentSessionId = normalizeText(advancePaymentIntent.paymentSessionId);
    if (expectedPaymentSessionId && incoming.paymentSessionId !== expectedPaymentSessionId) {
        return {
            success: false,
            code: 'PAYMENT_INTENT_SESSION_MISMATCH',
            message: 'A sessão de pagamento não confere com a corrida.'
        };
    }

    const expectedPaymentContextKey = normalizeText(advancePaymentIntent.paymentContextKey);
    if (expectedPaymentContextKey && incoming.paymentContextKey !== expectedPaymentContextKey) {
        return {
            success: false,
            code: 'PAYMENT_INTENT_CONTEXT_MISMATCH',
            message: 'O contexto de pagamento não confere com a corrida.'
        };
    }

    const expectedPaymentDriverReservationId = normalizeText(
        advancePaymentIntent.paymentDriverReservationId
    );
    if (
        expectedPaymentDriverReservationId &&
        incoming.paymentDriverReservationId &&
        incoming.paymentDriverReservationId !== expectedPaymentDriverReservationId
    ) {
        return {
            success: false,
            code: 'PAYMENT_DRIVER_RESERVATION_MISMATCH',
            message: 'A reserva de motorista do pagamento não confere com esta corrida.'
        };
    }

    const expectedCarType = normalizeComparableCarType(
        quoteLockSnapshot.carType ||
        advancePaymentIntent.carType
    );
    if (expectedCarType && normalizeComparableCarType(requestedCarType) !== expectedCarType) {
        return {
            success: false,
            code: 'PAYMENT_INTENT_CAR_TYPE_MISMATCH',
            message: 'A categoria do pagamento não confere com a corrida.'
        };
    }

    const expectedRouteSignature =
        normalizeText(quoteLockSnapshot.routeSignature || advancePaymentIntent.routeSignature) ||
        buildRouteSignature({
            pickupLocation: quoteLockSnapshot.pickupLocation || advancePaymentIntent.pickupLocation,
            destinationLocation: quoteLockSnapshot.destinationLocation || advancePaymentIntent.destinationLocation,
            carType: expectedCarType || requestedCarType
        });
    const incomingRouteSignature = buildRouteSignature({
        pickupLocation,
        destinationLocation,
        carType: requestedCarType
    });
    if (expectedRouteSignature && incomingRouteSignature && expectedRouteSignature !== incomingRouteSignature) {
        return {
            success: false,
            code: 'PAYMENT_INTENT_ROUTE_MISMATCH',
            message: 'A rota do pagamento não confere com a corrida solicitada.'
        };
    }

    const expectedPayableAmountInCents = normalizeQuoteAmountCents(
        quoteLockSnapshot.payableAmountInCents ||
        quoteLockSnapshot.passengerPayableAmountInCents ||
        advancePaymentIntent.payableAmountInCents ||
        advancePaymentIntent.amountCents ||
        advancePaymentIntent.amount,
        0
    );
    const incomingPayableAmountInCents =
        normalizeQuoteAmountCents(resolvedPaymentAmountInCents, 0) ||
        incoming.payableAmountInCents;
    if (
        expectedPayableAmountInCents > 0 &&
        incomingPayableAmountInCents > 0 &&
        expectedPayableAmountInCents !== incomingPayableAmountInCents
    ) {
        return {
            success: false,
            code: 'PAYMENT_INTENT_AMOUNT_MISMATCH',
            message: 'O valor pago não confere com a corrida solicitada.'
        };
    }

    const expectedGrossAmountInCents = normalizeQuoteAmountCents(
        quoteLockSnapshot.grossAmountInCents ||
        advancePaymentIntent.grossAmountInCents,
        0
    );
    if (
        expectedGrossAmountInCents > 0 &&
        incoming.grossAmountInCents > 0 &&
        expectedGrossAmountInCents !== incoming.grossAmountInCents
    ) {
        return {
            success: false,
            code: 'PAYMENT_INTENT_GROSS_AMOUNT_MISMATCH',
            message: 'O valor bruto da cotação não confere com o pagamento.'
        };
    }
    if (
        expectedGrossAmountInCents > 0 &&
        expectedPayableAmountInCents > 0 &&
        expectedGrossAmountInCents !== expectedPayableAmountInCents &&
        incoming.grossAmountInCents <= 0
    ) {
        return {
            success: false,
            code: 'PAYMENT_INTENT_GROSS_AMOUNT_REQUIRED',
            message: 'O valor bruto da cotação precisa acompanhar o pagamento.'
        };
    }

    return {
        success: true,
        binding: {
            paymentSessionId: expectedPaymentSessionId || incoming.paymentSessionId || null,
            paymentContextKey: expectedPaymentContextKey || incoming.paymentContextKey || null,
            quoteSessionId: expectedQuoteSessionId || incoming.quoteSessionId || null,
            quoteLockId: expectedQuoteLockId || incoming.quoteLockId || null,
            paymentDriverReservationId: expectedPaymentDriverReservationId || incoming.paymentDriverReservationId || null,
            paymentDriverReservationDriverId: normalizeText(advancePaymentIntent.paymentDriverReservationDriverId) || null,
            paymentDriverReservationExpiresAt: normalizeText(advancePaymentIntent.paymentDriverReservationExpiresAt) || null,
            paymentDriverReservationTtlSeconds: advancePaymentIntent.paymentDriverReservationTtlSeconds || null,
            providerEnvironment: normalizeText(advancePaymentIntent.providerEnvironment) || null,
            paymentProviderEnvironment: normalizeText(advancePaymentIntent.providerEnvironment) || null,
            paymentProfileId: normalizeText(advancePaymentIntent.paymentProfileId) || null,
            paymentProfileReason: normalizeText(advancePaymentIntent.paymentProfileReason) || null,
            paymentProfileSource: normalizeText(advancePaymentIntent.paymentProfileSource) || null,
            payableAmountInCents: expectedPayableAmountInCents || incomingPayableAmountInCents || null,
            grossAmountInCents: expectedGrossAmountInCents || incoming.grossAmountInCents || null,
            passengerName: normalizeText(
                advancePaymentIntent.passengerName ||
                advancePaymentIntent.customerName ||
                quoteLockSnapshot.passengerName ||
                quoteLockSnapshot.customerName
            ) || null,
            customerName: normalizeText(
                advancePaymentIntent.customerName ||
                advancePaymentIntent.passengerName ||
                quoteLockSnapshot.customerName ||
                quoteLockSnapshot.passengerName
            ) || null,
            routeDistanceKm: normalizePositiveNumber(
                quoteLockSnapshot.routeDistanceKm ||
                quoteLockSnapshot.distanceKm ||
                advancePaymentIntent.routeDistanceKm ||
                advancePaymentIntent.distanceKm,
                null
            ),
            routeDurationSecs: normalizePositiveNumber(
                quoteLockSnapshot.routeDurationSecs ||
                quoteLockSnapshot.durationSecs ||
                advancePaymentIntent.routeDurationSecs ||
                advancePaymentIntent.durationSecs,
                null
            ),
            routeSignature: expectedRouteSignature || incomingRouteSignature || null
        }
    };
}

function getFirestoreSafely() {
    try {
        const firebaseConfig = require('../firebase-config');
        return firebaseConfig.getFirestore?.() || null;
    } catch (_error) {
        return null;
    }
}

function registerSocketCreateBookingHandler({
    socket,
    io,
    extractTraceIdFromEvent,
    traceContext,
    getTracer,
    createSocketSpan,
    runInSpan,
    logStructured,
    rateLimiterService,
    getSocketMetadata,
    auditService,
    validationService,
    GeoHashUtils,
    redisPool,
    idempotencyService,
    RequestRideCommand,
    createCommandSpan,
    endSpanError,
    logCommand,
    createEventSpan,
    endSpanSuccess,
    logEvent,
    eventBus,
    metricsCollector,
    findAvailableDriversForPickup,
    rideCostTelemetryService
}) {
    const { performCreateBookingAvailabilityPrecheck } = require('../services/create-booking-availability-precheck');
    const { buildCanonicalCreateBookingIdempotencyKey } = require('../services/create-booking-idempotency-service');
    const { countNearbyEligibleDriversApprox } = require('../services/driver-availability-snapshot-service');
    const pricingH3ReadModelService = require('../services/pricing-h3-read-model-service');
    const { metrics } = require('../utils/prometheus-metrics');
    const normalizeFlag = (value) => String(value || '').trim().toLowerCase() === 'true';
    const CUSTOMER_ACTIVE_BOOKING_TTL_SECONDS = Number.parseInt(
        process.env.CUSTOMER_ACTIVE_BOOKING_TTL_SECONDS || '21600',
        10
    );
    const CREATE_BOOKING_BACKGROUND_EVENT_PUBLISH = process.env.CREATE_BOOKING_BACKGROUND_EVENT_PUBLISH !== 'false';
    const SKIP_EVENTBUS_NOTIFY_FOR_PAID_BOOKINGS = process.env.SKIP_EVENTBUS_NOTIFY_FOR_PAID_BOOKINGS !== 'false';
    const REQUIRE_PAYMENT_BEFORE_BOOKING =
        String(process.env.REQUIRE_PAYMENT_BEFORE_BOOKING || 'true').trim().toLowerCase() !== 'false';
    const VERIFY_PAYMENT_BEFORE_BOOKING =
        String(process.env.VERIFY_PAYMENT_BEFORE_BOOKING || 'true').trim().toLowerCase() !== 'false';
    const REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING =
        String(process.env.REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING || 'true').trim().toLowerCase() !== 'false';
    const PAID_PAYMENT_STATUSES = new Set(['confirmed', 'paid', 'in_holding']);
    const APP_REVIEW_MODE = normalizeFlag(process.env.APP_REVIEW);
    const ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING =
        APP_REVIEW_MODE && normalizeFlag(process.env.ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING);
    const INCLUDE_CREATE_BOOKING_PERF_DEBUG = process.env.INCLUDE_CREATE_BOOKING_PERF_DEBUG === 'true';
    const CREATE_BOOKING_JOIN_WAIT_MS = Number.parseInt(
        process.env.IDEMPOTENCY_CREATE_BOOKING_JOIN_WAIT_MS
        || process.env.IDEMPOTENCY_JOIN_WAIT_MS
        || '25000',
        10
    );
    const CREATE_BOOKING_INFLIGHT_FOLLOWUP_WAIT_MS = Number.parseInt(
        process.env.IDEMPOTENCY_CREATE_BOOKING_INFLIGHT_FOLLOWUP_WAIT_MS
        || process.env.IDEMPOTENCY_CREATE_BOOKING_FOLLOWUP_WAIT_MS
        || '20000',
        10
    );

    const SEARCH_STATES = new Set(['PENDING', 'AWAITING_PAYMENT', 'SEARCHING', 'NOTIFIED', 'AWAITING_RESPONSE', 'EXPANDED', 'REJECTED']);
    const BLOCKING_STATES = new Set(['MATCHED', 'ACCEPTED', 'IN_PROGRESS']);
    const FINAL_STATES = new Set(['COMPLETED', 'CANCELED']);

    const cleanupSupersededBookingSearch = async ({
        previousBookingId,
        customerId,
        replacementBookingId,
        redis,
        logStructured
    }) => {
        if (!previousBookingId || previousBookingId === replacementBookingId) {
            return;
        }

        try {
            const GradualRadiusExpander = require('../services/gradual-radius-expander');
            const rideQueueManager = require('../services/ride-queue-manager');
            const RideStateManager = require('../services/ride-state-manager');
            const expander = new GradualRadiusExpander(io);

            // Finaliza o booking anterior para evitar que siga sendo selecionado por monitores paralelos.
            const previousState = await RideStateManager.getBookingState(redis, previousBookingId);
            if (previousState && previousState !== RideStateManager.STATES.CANCELED && previousState !== RideStateManager.STATES.COMPLETED) {
                try {
                    await RideStateManager.updateBookingState(
                        redis,
                        previousBookingId,
                        RideStateManager.STATES.CANCELED,
                        {
                            canceledBy: customerId || 'system',
                            reason: 'SUPERSEDED_BY_NEW_REQUEST',
                            supersededByBookingId: replacementBookingId || '',
                            cancelledAt: new Date().toISOString()
                        }
                    );
                } catch (stateError) {
                    logStructured('warn', 'Falha ao finalizar estado do booking supersedido', {
                        customerId,
                        previousBookingId,
                        replacementBookingId: replacementBookingId || null,
                        eventType: 'createBooking',
                        error: stateError.message
                    });
                }
            }

            await expander.stopSearch(previousBookingId);
            await rideQueueManager.dequeueRide(previousBookingId);

            await redis.hset(`booking:${previousBookingId}`, {
                status: 'SUPERSEDED',
                supersededAt: new Date().toISOString(),
                supersededByBookingId: replacementBookingId || '',
                supersededByCustomerId: customerId || ''
            });

            logStructured('info', 'Busca de booking anterior encerrada por supersedência', {
                customerId,
                previousBookingId,
                replacementBookingId,
                eventType: 'createBooking'
            });
        } catch (supersedeError) {
            logStructured('warn', 'Falha ao encerrar booking anterior supersedido', {
                customerId,
                previousBookingId,
                replacementBookingId,
                eventType: 'createBooking',
                error: supersedeError.message
            });
        }
    };

    socket.on('createBooking', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);

        // ✅ CORRELATION ID: Usar bookingId se disponível, senão gerar
        // correlationId é de negócio (estável por fluxo de corrida)
        const correlationId = data.bookingId || `ride_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // ✅ FASE 1.3: Criar span root para socket handler
        const tracer = getTracer();
        const socketSpan = createSocketSpan(tracer, 'createBooking', {
            'user.id': socket.userId || data.customerId || socket.id,
            'user.type': socket.userType || 'customer',
            'correlation.id': correlationId, // ✅ Adicionar correlationId
            'booking.id': data.bookingId || correlationId
        });
        let outerStartTime = Date.now();
        let outerReleaseIdempotencyLock = null;

        await traceContext.runWithTraceId(traceId, async () => {
            try {
                return await runInSpan(socketSpan, async () => {
                    logStructured('info', 'createBooking iniciado', {
                        userId: socket.userId || data.customerId || socket.id,
                        eventType: 'createBooking'
                    });

                    const startTime = Date.now();
                    const hotpathPath = 'create_booking';
                    const includePerfBreakdown =
                        INCLUDE_CREATE_BOOKING_PERF_DEBUG ||
                        data?.debugPerf === true ||
                        data?.includePerfBreakdown === true;
                    const perfTrace = {
                        start: startTime
                    };
                    let hotpathCursor = startTime;
                    let idempotencyKey = null;
                    let idempotencyOwner = false;

                    const recordStage = (stage, checkpoint = Date.now(), success = true) => {
                        metrics.recordHotpathStageLatency(
                            hotpathPath,
                            stage,
                            Math.max(0, (checkpoint - hotpathCursor) / 1000),
                            success
                        );
                        hotpathCursor = checkpoint;
                    };

                    const recordFailure = (stage, reason) => {
                        const checkpoint = Date.now();
                        if (reason) {
                            metrics.recordHotpathReason(hotpathPath, reason);
                        }
                        metrics.recordHotpathStageLatency(
                            hotpathPath,
                            stage,
                            Math.max(0, (checkpoint - hotpathCursor) / 1000),
                            false
                        );
                        metrics.recordHotpathLatency(
                            hotpathPath,
                            Math.max(0, (checkpoint - startTime) / 1000),
                            false
                        );
                        hotpathCursor = checkpoint;
                    };

                    const recordSuccess = () => {
                        metrics.recordHotpathLatency(
                            hotpathPath,
                            Math.max(0, (Date.now() - startTime) / 1000),
                            true
                        );
                    };

                    const releaseIdempotencyLock = async () => {
                        if (!idempotencyKey || !idempotencyOwner) return;
                        idempotencyOwner = false;
                        await idempotencyService.releaseInflight(idempotencyKey);
                    };
                    outerStartTime = startTime;
                    outerReleaseIdempotencyLock = releaseIdempotencyLock;

                    const userId = socket.userId || data.customerId || socket.id;
                    const metadata = getSocketMetadata(socket);

                    logStructured('info', 'Solicitação de corrida recebida', {
                        socketId: socket.id,
                        userId,
                        eventType: 'createBooking'
                    });

                    // ✅ Segurança: forçar customerId autenticado no payload antes da validação
                    const authCustomerId = socket.userId || null;
                    const validationPayload = authCustomerId
                        ? { ...data, customerId: authCustomerId }
                        : data;

                    // ✅ NOVO: Validação e sanitização de dados
                    const validation = validationService.validateEndpoint('createBooking', validationPayload);

                    if (!validation.valid) {
                        const metadata = getSocketMetadata(socket);
                        await auditService.logRideAction(userId, 'createBooking', null, {
                            error: 'Validação falhou',
                            validationErrors: validation.errors
                        }, false, 'Dados de entrada inválidos', metadata);

                        logStructured('warn', 'Validação falhou', {
                            userId,
                            eventType: 'createBooking',
                            validationErrors: validation.errors
                        });

                        socket.emit('bookingError', {
                            error: 'Dados inválidos',
                            message: 'Os dados fornecidos não são válidos',
                            details: validation.errors,
                            code: 'VALIDATION_ERROR'
                        });
                        recordFailure('validate', 'validation_error');
                        return;
                    }
                    perfTrace.afterValidation = Date.now();
                    recordStage('validate', perfTrace.afterValidation);

                    // Usar dados sanitizados
                    const {
                        customerId: sanitizedCustomerId,
                        pickupLocation,
                        destinationLocation,
                        estimatedFare,
                        routeDistanceKm,
                        routeDurationSecs,
                        routeCoordinates,
                        trafficSegments,
                        tollFee,
                        carType: sanitizedCarType,
                        paymentMethod
                    } = validation.sanitized;
                    const sanitizedRouteCoordinates = normalizeRouteCoordinates(routeCoordinates);
                    const sanitizedTrafficSegments = normalizeTrafficSegments(trafficSegments);
                    const customerId = authCustomerId || sanitizedCustomerId;
                    const ridePreferences =
                        data?.preferences && typeof data.preferences === 'object'
                            ? { ...data.preferences }
                            : {};
                    const customerActiveBookingKey = customerId
                        ? `customer_active_booking:${customerId}`
                        : null;
                    let supersededBookingId = null;

                    if (authCustomerId && sanitizedCustomerId && sanitizedCustomerId !== authCustomerId) {
                        logStructured('warn', 'createBooking com customerId divergente do usuário autenticado', {
                            userId,
                            socketUserId: authCustomerId,
                            payloadCustomerId: sanitizedCustomerId,
                            eventType: 'createBooking'
                        });
                    }

                    if (customerId) {
                        try {
                            const passengerTrustService = require('../services/passenger-trust-service');
                            const trustDecision = await passengerTrustService.checkEligibility(customerId);
                            if (!trustDecision.allowed) {
                                socket.emit('bookingError', {
                                    error: 'Solicitação bloqueada',
                                    message: trustDecision.reason,
                                    code: trustDecision.code,
                                    trustStatus: trustDecision.profile?.trustStatus || null,
                                    trustScore: trustDecision.profile?.trustScore ?? null
                                });

                                logStructured('warn', 'createBooking bloqueado por trust & safety', {
                                    customerId,
                                    trustStatus: trustDecision.profile?.trustStatus || null,
                                    trustScore: trustDecision.profile?.trustScore ?? null,
                                    trustCode: trustDecision.code,
                                    eventType: 'createBooking'
                                });
                                recordFailure('active_guard', 'passenger_trust_blocked');
                                return;
                            }
                        } catch (trustGuardError) {
                            logStructured('error', 'Falha no guard de trust do passageiro (fail-closed)', {
                                customerId,
                                eventType: 'createBooking',
                                error: trustGuardError.message
                            });
                            socket.emit('bookingError', {
                                error: 'Solicitação temporariamente indisponível',
                                message: 'Não foi possível validar a segurança da solicitação agora. Tente novamente em instantes.',
                                code: 'PASSENGER_TRUST_GUARD_UNAVAILABLE'
                            });
                            recordFailure('active_guard', 'passenger_trust_guard_unavailable');
                            return;
                        }
                    }

                    if (customerActiveBookingKey) {
                        try {
                            const redis = redisPool.getConnection();
                            const activeBookingId = await redis.get(customerActiveBookingKey);

                            if (activeBookingId) {
                                const RideStateManager = require('../services/ride-state-manager');
                                const activeState = await RideStateManager.getBookingState(redis, activeBookingId);

                                if (BLOCKING_STATES.has(activeState)) {
                                    socket.emit('bookingError', {
                                        error: 'Você já possui uma corrida ativa',
                                        message: 'Finalize a corrida atual antes de solicitar uma nova.',
                                        code: 'ACTIVE_RIDE_EXISTS',
                                        activeBookingId
                                    });
                                    return;
                                }

                                if (FINAL_STATES.has(activeState)) {
                                    await redis.del(customerActiveBookingKey);
                                } else if (SEARCH_STATES.has(activeState)) {
                                    supersededBookingId = activeBookingId;
                                    await cleanupSupersededBookingSearch({
                                        previousBookingId: activeBookingId,
                                        customerId,
                                        replacementBookingId: null,
                                        redis,
                                        logStructured
                                    });
                                }
                            }
                        } catch (activeBookingGuardError) {
                            logStructured('error', 'Falha ao validar/superseder booking ativo do cliente (fail-closed)', {
                                customerId,
                                eventType: 'createBooking',
                                error: activeBookingGuardError.message
                            });
                            socket.emit('bookingError', {
                                error: 'Não foi possível validar sua corrida atual',
                                message: 'Tente novamente em instantes para evitar corridas duplicadas.',
                                code: 'ACTIVE_RIDE_GUARD_UNAVAILABLE'
                            });
                            recordFailure('active_guard', 'active_ride_guard_unavailable');
                            return;
                        }
                    }
                    perfTrace.afterActiveGuard = Date.now();
                    let normalizedPaymentStatus = (data?.paymentStatus || 'pending_payment').toString().toLowerCase();
                    const clientRequestedConfirmedPayment = PAID_PAYMENT_STATUSES.has(normalizedPaymentStatus);
                    let hasConfirmedPayment = false;
                    let paymentServerValidated = false;
                    let paymentProviderProofSource = null;
                    let advancePaymentIntent = null;
                    let paymentIntentBinding = {};
                    const paymentChargeId = String(data?.paymentData?.chargeId || data?.paymentId || '').trim();
                    const paymentReferenceRideId = String(data?.paymentData?.rideId || data?.rideId || '').trim();
                    const parsedPaymentAmountInCents = Number.parseInt(
                        String(data?.paymentData?.amountInCents ?? data?.paymentAmountInCents ?? data?.amountInCents ?? ''),
                        10
                    );
                    let resolvedPaymentAmountInCents =
                        Number.isFinite(parsedPaymentAmountInCents) && parsedPaymentAmountInCents > 0
                            ? parsedPaymentAmountInCents
                            : null;
                    const requestedCarType = sanitizedCarType || data?.carType || null;

                    if (paymentReferenceRideId) {
                        advancePaymentIntent =
                            await paymentServiceSingleton.getAdvancePaymentIntent(paymentReferenceRideId);
                        if (advancePaymentIntent?.unavailable) {
                            socket.emit('bookingError', {
                                error: 'Validação de pagamento indisponível',
                                message: 'Não foi possível validar o vínculo deste pagamento agora. Tente novamente em alguns segundos.',
                                code: advancePaymentIntent.code || 'PAYMENT_INTENT_VALIDATION_UNAVAILABLE',
                                retryAfterSec: 2
                            });
                            recordFailure('active_guard', 'payment_intent_validation_unavailable');
                            return;
                        }
                        if (String(advancePaymentIntent?.status || '').trim().toLowerCase() === 'consumed') {
                            socket.emit('bookingError', {
                                error: 'Pagamento já utilizado',
                                message: 'Este pagamento já está vinculado a uma corrida. Sincronize a corrida ativa antes de tentar novamente.',
                                code: 'PAYMENT_ALREADY_CONSUMED',
                                activeBookingId: advancePaymentIntent?.bookingId || null,
                                chargeId: advancePaymentIntent?.chargeId || paymentChargeId || null
                            });
                            recordFailure('active_guard', 'payment_already_consumed');
                            return;
                        }
                    }

                    if (
                        (!advancePaymentIntent?.found) &&
                        paymentChargeId &&
                        typeof paymentServiceSingleton.getAdvancePaymentIntentByChargeId === 'function'
                    ) {
                        advancePaymentIntent =
                            await paymentServiceSingleton.getAdvancePaymentIntentByChargeId(paymentChargeId);
                        if (advancePaymentIntent?.unavailable) {
                            socket.emit('bookingError', {
                                error: 'Validação de pagamento indisponível',
                                message: 'Não foi possível validar o vínculo deste pagamento agora. Tente novamente em alguns segundos.',
                                code: advancePaymentIntent.code || 'PAYMENT_INTENT_VALIDATION_UNAVAILABLE',
                                retryAfterSec: 2
                            });
                            recordFailure('active_guard', 'payment_intent_validation_unavailable');
                            return;
                        }
                        if (String(advancePaymentIntent?.status || '').trim().toLowerCase() === 'consumed') {
                            socket.emit('bookingError', {
                                error: 'Pagamento já utilizado',
                                message: 'Este pagamento já está vinculado a uma corrida. Sincronize a corrida ativa antes de tentar novamente.',
                                code: 'PAYMENT_ALREADY_CONSUMED',
                                activeBookingId: advancePaymentIntent?.bookingId || null,
                                chargeId: advancePaymentIntent?.chargeId || paymentChargeId || null
                            });
                            recordFailure('active_guard', 'payment_already_consumed');
                            return;
                        }
                    }

                    if (REQUIRE_PAYMENT_BEFORE_BOOKING && !clientRequestedConfirmedPayment) {
                        socket.emit('bookingError', {
                            error: 'Pagamento obrigatório',
                            message: 'Finalize o pagamento PIX antes de solicitar a corrida.',
                            code: 'PAYMENT_REQUIRED'
                        });
                        recordFailure('active_guard', 'payment_required');
                        return;
                    }

                    if (
                        REQUIRE_PAYMENT_BEFORE_BOOKING &&
                        REQUIRE_PAYMENT_CHARGE_REF_BEFORE_BOOKING &&
                        !paymentChargeId
                    ) {
                        socket.emit('bookingError', {
                            error: 'Referência de pagamento ausente',
                            message: 'Não foi possível validar o pagamento desta solicitação. Gere um novo PIX e tente novamente.',
                            code: 'PAYMENT_REFERENCE_REQUIRED'
                        });
                        recordFailure('active_guard', 'payment_reference_required');
                        return;
                    }

                    if (
                        String(paymentChargeId).startsWith('mock_review_') &&
                        !ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING
                    ) {
                        socket.emit('bookingError', {
                            error: 'Referência de pagamento inválida',
                            message: 'Cobrança de teste não permitida neste ambiente.',
                            code: 'PAYMENT_REFERENCE_INVALID'
                        });
                        recordFailure('active_guard', 'payment_reference_invalid');
                        return;
                    }

                    if (clientRequestedConfirmedPayment && VERIFY_PAYMENT_BEFORE_BOOKING && paymentChargeId) {
                        try {
                            const isAllowedReviewMockPayment =
                                String(paymentChargeId).startsWith('mock_review_') &&
                                ALLOW_REVIEW_MOCK_PAYMENT_ON_CREATE_BOOKING;

                            if (isAllowedReviewMockPayment) {
                                const paymentStatusCheck = await paymentServiceSingleton.getPaymentStatus(paymentChargeId);
                                const verifiedPaymentStatus = String(paymentStatusCheck?.status || '').trim().toLowerCase();

                                if (!paymentStatusCheck?.success || !PAID_PAYMENT_STATUSES.has(verifiedPaymentStatus)) {
                                    socket.emit('bookingError', {
                                        error: 'Pagamento não confirmado',
                                        message: 'O pagamento desta corrida ainda não foi confirmado.',
                                        code: 'PAYMENT_NOT_CONFIRMED',
                                        paymentStatus: verifiedPaymentStatus || null,
                                        retryAfterSec: 2
                                    });
                                    recordFailure('active_guard', 'payment_not_confirmed');
                                    return;
                                }

                                normalizedPaymentStatus = verifiedPaymentStatus;
                                hasConfirmedPayment = true;
                                paymentServerValidated = true;
                                paymentProviderProofSource = 'app_review_mock_payment';

                                const amountFromPaymentStatus = Number(paymentStatusCheck.amount);
                                if (
                                    (!Number.isFinite(resolvedPaymentAmountInCents) || resolvedPaymentAmountInCents <= 0) &&
                                    Number.isFinite(amountFromPaymentStatus) &&
                                    amountFromPaymentStatus > 0
                                ) {
                                    resolvedPaymentAmountInCents = Math.round(amountFromPaymentStatus);
                                }
                            } else {
                                const paymentReferences = collectPaymentReferences(
                                    paymentChargeId,
                                    paymentReferenceRideId,
                                    data?.paymentData?.paymentId,
                                    data?.paymentData?.paymentIntentId,
                                    data?.paymentIntentId
                                );
                                const expectedAmountInCents =
                                    Number.isFinite(resolvedPaymentAmountInCents) && resolvedPaymentAmountInCents > 0
                                        ? normalizePaymentAmountCents(resolvedPaymentAmountInCents)
                                        : 0;
                                const providerConfirmation = await resolveAuthoritativePaymentConfirmation({
                                    paymentService: paymentServiceSingleton,
                                    firestore: getFirestoreSafely(),
                                    bookingId: paymentReferenceRideId || paymentChargeId,
                                    references: paymentReferences,
                                    expectedAmountInCents
                                });

                                if (!providerConfirmation?.success) {
                                    socket.emit('bookingError', {
                                        error: 'Pagamento não confirmado',
                                        message: providerConfirmation?.message || 'O pagamento desta corrida ainda não foi confirmado pelo provedor.',
                                        code: 'PAYMENT_NOT_CONFIRMED',
                                        providerCode: providerConfirmation?.code || 'PAYMENT_NOT_PROVIDER_CONFIRMED',
                                        retryAfterSec: 2
                                    });
                                    recordFailure('active_guard', 'payment_not_provider_confirmed');
                                    return;
                                }

                                const paymentProofRecord = providerConfirmation.record || {};
                                const verifiedPaymentStatus = String(
                                    paymentProofRecord.status ||
                                    paymentProofRecord.paymentStatus ||
                                    normalizedPaymentStatus
                                ).trim().toLowerCase();

                                normalizedPaymentStatus = PAID_PAYMENT_STATUSES.has(verifiedPaymentStatus)
                                    ? verifiedPaymentStatus
                                    : 'in_holding';
                                hasConfirmedPayment = true;
                                paymentServerValidated = true;
                                paymentProviderProofSource = providerConfirmation.source || paymentProofRecord.source || null;

                                const amountFromPaymentProof = Number(
                                    paymentProofRecord.amountInCents ??
                                    paymentProofRecord.amount ??
                                    paymentProofRecord.metadata?.amountInCents ??
                                    paymentProofRecord.metadata?.amount
                                );
                                if (
                                    (!Number.isFinite(resolvedPaymentAmountInCents) || resolvedPaymentAmountInCents <= 0) &&
                                    Number.isFinite(amountFromPaymentProof) &&
                                    amountFromPaymentProof > 0
                                ) {
                                    resolvedPaymentAmountInCents = normalizePaymentAmountCents(amountFromPaymentProof);
                                }
                            }
                        } catch (paymentVerificationError) {
                            logStructured('warn', 'Falha ao validar status do pagamento antes do createBooking', {
                                userId,
                                eventType: 'createBooking',
                                paymentChargeId,
                                error: paymentVerificationError.message
                            });
                            socket.emit('bookingError', {
                                error: 'Erro ao validar pagamento',
                                message: 'Não foi possível validar o pagamento agora. Tente novamente em instantes.',
                                code: 'PAYMENT_VERIFICATION_ERROR',
                                retryAfterSec: 2
                            });
                            recordFailure('active_guard', 'payment_verification_error');
                            return;
                        }
                    }

                    if (REQUIRE_PAYMENT_BEFORE_BOOKING && !hasConfirmedPayment) {
                        socket.emit('bookingError', {
                            error: 'Pagamento não confirmado',
                            message: 'O pagamento desta corrida ainda não foi confirmado pelo servidor.',
                            code: 'PAYMENT_NOT_CONFIRMED',
                            retryAfterSec: 2
                        });
                        recordFailure('active_guard', 'payment_not_confirmed');
                        return;
                    }

                    const paymentIntentValidation = validateAdvancePaymentIntentBinding({
                        advancePaymentIntent,
                        data,
                        customerId,
                        pickupLocation,
                        destinationLocation,
                        requestedCarType,
                        resolvedPaymentAmountInCents
                    });
                    if (!paymentIntentValidation.success) {
                        socket.emit('bookingError', {
                            error: 'Pagamento incompatível',
                            message: paymentIntentValidation.message || 'O pagamento não confere com esta corrida.',
                            code: paymentIntentValidation.code || 'PAYMENT_INTENT_BINDING_MISMATCH',
                            retryAfterSec: 0
                        });
                        recordFailure('active_guard', paymentIntentValidation.code || 'payment_intent_binding_mismatch');
                        return;
                    }
                    paymentIntentBinding = paymentIntentValidation.binding || {};
                    const rideFlowValidationGuard = evaluateRideFlowValidationPaymentBinding(
                        paymentIntentBinding
                    );
                    if (!rideFlowValidationGuard.allowed) {
                        socket.emit('bookingError', {
                            error: 'Pagamento sandbox obrigatório',
                            message: rideFlowValidationGuard.message,
                            code: rideFlowValidationGuard.code,
                            retryAfterSec: 0
                        });
                        recordFailure('active_guard', rideFlowValidationGuard.code);
                        return;
                    }
                    if (
                        (!Number.isFinite(resolvedPaymentAmountInCents) || resolvedPaymentAmountInCents <= 0) &&
                        Number.isFinite(paymentIntentBinding.payableAmountInCents) &&
                        paymentIntentBinding.payableAmountInCents > 0
                    ) {
                        resolvedPaymentAmountInCents = paymentIntentBinding.payableAmountInCents;
                    }

                    let paymentDriverReservation = null;
                    if (hasConfirmedPayment && advancePaymentIntent?.found) {
                        const paymentDriverReservationId = normalizeText(
                            paymentIntentBinding.paymentDriverReservationId ||
                            advancePaymentIntent.paymentDriverReservationId ||
                            data?.paymentData?.paymentDriverReservationId ||
                            data?.paymentDriverReservationId
                        );

                        if (!paymentDriverReservationId) {
                            socket.emit('bookingError', {
                                error: 'Reserva de motorista ausente',
                                message: 'Atualize a cotação e gere um novo Pix para confirmar disponibilidade antes do pagamento.',
                                code: 'PAYMENT_DRIVER_RESERVATION_REQUIRED',
                                retryAfterSec: 0
                            });
                            recordFailure('active_guard', 'payment_driver_reservation_required');
                            return;
                        }

                        try {
                            const {
                                validatePaymentDriverReservation
                            } = require('../services/payment-driver-reservation-service');
                            const redis = redisPool.getConnection();
                            const reservationValidation = await validatePaymentDriverReservation({
                                redis,
                                reservationId: paymentDriverReservationId,
                                passengerId: customerId,
                                rideId: paymentReferenceRideId,
                                paymentSessionId: paymentIntentBinding.paymentSessionId,
                                quoteLockId: paymentIntentBinding.quoteLockId
                            });

                            if (!reservationValidation.success) {
                                const recoveryResult = await recoverSandboxPaymentDriverReservation({
                                    redis,
                                    validationCode: reservationValidation.code,
                                    advancePaymentIntent,
                                    paymentIntentBinding,
                                    customerId,
                                    paymentReferenceRideId,
                                    pickupLocation,
                                    destinationLocation,
                                    requestedCarType,
                                    preferences: ridePreferences,
                                    checkAvailability: findAvailableDriversForPickup,
                                    logStructured,
                                    logContext: {
                                        userId,
                                        customerId,
                                        eventType: 'createBooking',
                                        paymentDriverReservationId
                                    }
                                });
                                if (recoveryResult?.success) {
                                    paymentDriverReservation = recoveryResult.reservation;
                                } else {
                                socket.emit('bookingError', {
                                    error: 'Reserva de motorista expirada',
                                    message: 'A reserva do motorista expirou ou não confere com este pagamento. Gere um novo Pix.',
                                    code: recoveryResult?.code || reservationValidation.code || 'PAYMENT_DRIVER_RESERVATION_INVALID',
                                    retryAfterSec: 0
                                });
                                recordFailure('active_guard', recoveryResult?.code || reservationValidation.code || 'payment_driver_reservation_invalid');
                                return;
                                }
                            } else {
                                paymentDriverReservation = reservationValidation.reservation;
                            }
                        } catch (reservationError) {
                            logStructured('warn', 'Falha ao validar reserva de motorista antes do createBooking', {
                                userId,
                                eventType: 'createBooking',
                                paymentDriverReservationId,
                                error: reservationError.message
                            });
                            socket.emit('bookingError', {
                                error: 'Reserva de motorista indisponível',
                                message: 'Não foi possível validar a reserva do motorista agora. Tente novamente em instantes.',
                                code: 'PAYMENT_DRIVER_RESERVATION_CHECK_FAILED',
                                retryAfterSec: 2
                            });
                            recordFailure('active_guard', 'payment_driver_reservation_check_failed');
                            return;
                        }
                    }

                    if (!hasConfirmedPayment) {
                        normalizedPaymentStatus = 'pending_payment';
                    }

                    // Backpressure no início do fluxo: evita empilhar corrida quando fila regional já está saturada.
                    const queueBackpressureEnabled = process.env.ENABLE_QUEUE_BACKPRESSURE !== 'false';
                    if (queueBackpressureEnabled) {
                        try {
                            const regionHashForGuard = GeoHashUtils.getRegionHash(
                                pickupLocation.lat,
                                pickupLocation.lng
                            );
                            const queueKey = `ride_queue:${regionHashForGuard}:pending`;
                            const redis = redisPool.getConnection();
                            const pendingRides = await redis.zcard(queueKey);
                            const pendingLimit = Number.parseInt(process.env.QUEUE_PENDING_LIMIT_PER_REGION || '5000', 10);
                            const onlineDrivers = await redis.scard('online_drivers');
                            const minOnlineDriversBypass = Number.parseInt(process.env.QUEUE_BACKPRESSURE_MIN_ONLINE_DRIVERS_BYPASS || '200', 10);

                            if (pendingRides >= pendingLimit && onlineDrivers < minOnlineDriversBypass) {
                                const retryAfterSec = Number.parseInt(process.env.QUEUE_BACKPRESSURE_RETRY_AFTER_SEC || '3', 10);
                                socket.emit('bookingError', {
                                    error: 'Sistema temporariamente congestionado',
                                    message: 'Estamos com alta demanda na sua região. Tente novamente em alguns segundos.',
                                    code: 'QUEUE_BACKPRESSURE',
                                    retryAfterSec,
                                    pendingRides,
                                    pendingLimit,
                                    onlineDrivers,
                                    minOnlineDriversBypass,
                                    regionHash: regionHashForGuard
                                });

                                logStructured('warn', 'createBooking bloqueado por backpressure', {
                                    userId,
                                    regionHash: regionHashForGuard,
                                    pendingRides,
                                    pendingLimit,
                                    onlineDrivers,
                                    minOnlineDriversBypass,
                                    retryAfterSec
                                });
                                recordFailure('active_guard', 'queue_backpressure');
                                return;
                            }
                        } catch (backpressureError) {
                            logStructured('warn', 'Falha na validação de backpressure (seguindo fluxo)', {
                                userId,
                                error: backpressureError.message
                            });
                        }
                    }
                    perfTrace.afterBackpressure = Date.now();
                    recordStage('active_guard', perfTrace.afterBackpressure);

                    let areaPolicyDecision = null;
                    const areaPolicyCity = String(
                        pickupLocation?.city
                        || pickupLocation?.cityName
                        || data?.city
                        || process.env.DEFAULT_OPERATIONS_CITY
                        || 'default'
                    ).trim();
                    const areaPolicyRegionHash = GeoHashUtils.getRegionHash(
                        pickupLocation.lat,
                        pickupLocation.lng
                    );

                    try {
                        const operationalAreaPolicyService = require('../services/operational-area-policy-service');
                        const redis = redisPool.getConnection();
                        const queueKey = `ride_queue:${areaPolicyRegionHash}:pending`;
                        const pendingRides = await redis.zcard(queueKey).catch(() => 0);
                        const availabilitySnapshot = await countNearbyEligibleDriversApprox(pickupLocation, {
                            regionHash: areaPolicyRegionHash,
                            limit: getOperationsPolicyDriverLimit(),
                            radiusKm: getOperationsPolicyRadiusKm()
                        }).catch(() => ({ success: false, availableDrivers: 0, source: 'error' }));

                        areaPolicyDecision = await operationalAreaPolicyService.evaluateCreateBooking({
                            city: areaPolicyCity,
                            regionHash: areaPolicyRegionHash,
                            openRequests: pendingRides,
                            availableDrivers: availabilitySnapshot?.availableDrivers || 0
                        });

                        if (!areaPolicyDecision.allowed) {
                            socket.emit('bookingError', {
                                error: 'Solicitações temporariamente restritas na sua área',
                                message: 'A operação está controlando novas corridas nesta região neste momento.',
                                code: 'AREA_POLICY_RESTRICTED',
                                dispatchMode: areaPolicyDecision.dispatchMode,
                                reasons: areaPolicyDecision.reasons,
                                policyId: areaPolicyDecision.policy?.policyId || null,
                                regionHash: areaPolicyRegionHash
                            });

                            logStructured('warn', 'createBooking bloqueado por política operacional', {
                                customerId,
                                city: areaPolicyCity,
                                regionHash: areaPolicyRegionHash,
                                dispatchMode: areaPolicyDecision.dispatchMode,
                                reasons: areaPolicyDecision.reasons,
                                policyId: areaPolicyDecision.policy?.policyId || null,
                                eventType: 'createBooking'
                            });
                            recordFailure('policy', 'policy_restricted');
                            return;
                        }
                    } catch (areaPolicyError) {
                        logStructured('error', 'Falha na política operacional de área (fail-closed)', {
                            customerId,
                            city: areaPolicyCity,
                            regionHash: areaPolicyRegionHash,
                            eventType: 'createBooking',
                            error: areaPolicyError.message
                        });
                        socket.emit('bookingError', {
                            error: 'Não foi possível validar a área de atendimento',
                            message: 'Tente novamente em instantes para confirmar a cobertura operacional.',
                            code: 'AREA_POLICY_GUARD_UNAVAILABLE',
                            regionHash: areaPolicyRegionHash
                        });
                        recordFailure('policy', 'area_policy_guard_unavailable');
                        return;
                    }
                    perfTrace.afterPolicy = Date.now();
                    recordStage('policy', perfTrace.afterPolicy);

                    // ✅ NOVO: Idempotency - Verificar se requisição já foi processada
                    const fallbackIdempotencyKey = String(
                        data.idempotencyKey ||
                        `${userId}:createBooking:route:${Number.parseFloat(pickupLocation.lat).toFixed(5)}:${Number.parseFloat(pickupLocation.lng).toFixed(5)}:${Number.parseFloat(destinationLocation.lat).toFixed(5)}:${Number.parseFloat(destinationLocation.lng).toFixed(5)}:${String(paymentMethod || 'unknown').trim().toLowerCase()}`
                    ).trim();
                    idempotencyKey = buildCanonicalCreateBookingIdempotencyKey({
                        userId,
                        data: {
                            ...data,
                            paymentMethod,
                            pickupLocation,
                            destinationLocation
                        },
                        fallbackIdempotencyKey
                    });

                    const idempotencyCheck = await idempotencyService.beginRequest(idempotencyKey, {
                        joinWaitMs: CREATE_BOOKING_JOIN_WAIT_MS
                    });
                    perfTrace.afterIdempotency = Date.now();

                    if (!idempotencyCheck.isNew) {
                        // Requisição duplicada - retornar resultado cached ou erro
                        if (idempotencyCheck.cachedResult) {
                            logStructured('info', 'Resultado cached retornado (idempotency)', {
                                userId,
                                eventType: 'createBooking',
                                idempotencyKey,
                                action: 'return_cached'
                            });
                            // ✅ Garantir que traceId esteja no resultado cached
                            const cachedResult = {
                                ...idempotencyCheck.cachedResult,
                                traceId: idempotencyCheck.cachedResult.traceId || traceId || traceContext.getCurrentTraceId() || 'CACHED-TRACE-ID'
                            };
                            // ✅ FORÇAR traceId também em data se não estiver
                            if (cachedResult.data && !cachedResult.data.traceId) {
                                cachedResult.data.traceId = cachedResult.traceId;
                            }
                            if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                                logStructured('debug', 'cachedResult antes de emit', {
                                    service: 'websocket',
                                    operation: 'createBooking',
                                    cachedResult
                                });
                            }
                            socket.emit('bookingCreated', cachedResult);
                            metrics.recordHotpathReason(hotpathPath, 'duplicate_joined');
                            recordStage('idempotency', perfTrace.afterIdempotency);
                            recordSuccess();
                            return;
                        } else {
                            // Requisição duplicada ainda em voo.
                            // Fazemos uma segunda espera para "grudar" no resultado da primeira
                            // tentativa em vez de devolver erro cedo demais sob carga.
                            const inflightJoinedResult = await idempotencyService.waitForCachedResult(idempotencyKey, {
                                waitMs: CREATE_BOOKING_INFLIGHT_FOLLOWUP_WAIT_MS,
                                pollIntervalMs: 100
                            });

                            if (inflightJoinedResult) {
                                logStructured('info', 'Resultado joined retornado após espera complementar', {
                                    userId,
                                    eventType: 'createBooking',
                                    idempotencyKey,
                                    action: 'return_joined_after_followup_wait'
                                });
                                const joinedResult = {
                                    ...inflightJoinedResult,
                                    traceId: inflightJoinedResult.traceId || traceId || traceContext.getCurrentTraceId() || 'JOINED-TRACE-ID'
                                };
                                if (joinedResult.data && !joinedResult.data.traceId) {
                                    joinedResult.data.traceId = joinedResult.traceId;
                                }
                                socket.emit('bookingCreated', joinedResult);
                                metrics.recordHotpathReason(hotpathPath, 'duplicate_joined');
                                recordStage('idempotency', Date.now());
                                recordSuccess();
                                return;
                            }

                            logStructured('warn', 'Requisição duplicada detectada sem resultado joined', {
                                userId,
                                eventType: 'createBooking',
                                idempotencyKey
                            });
                            socket.emit('bookingError', {
                                error: 'Requisição duplicada',
                                message: 'Esta requisição já está sendo processada. Aguarde...',
                                code: 'DUPLICATE_REQUEST',
                                retryAfterSec: 1
                            });
                            recordFailure('idempotency', 'duplicate_rejected');
                            return;
                        }
                    }
                    idempotencyOwner = true;
                    recordStage('idempotency', perfTrace.afterIdempotency);

                    const rateLimitCheck = await rateLimiterService.checkRateLimit(userId, 'createBooking', {
                        ip: metadata.ip
                    });

                    if (!rateLimitCheck.allowed) {
                        await auditService.logSecurityAction(userId, 'rateLimitExceeded', 'createBooking', {
                            limit: rateLimitCheck.limit,
                            remaining: rateLimitCheck.remaining,
                            resetAt: rateLimitCheck.resetAt
                        }, metadata);

                        socket.emit('bookingError', {
                            error: 'Muitas requisições',
                            message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                            code: 'RATE_LIMIT_EXCEEDED',
                            limit: rateLimitCheck.limit,
                            remaining: rateLimitCheck.remaining,
                            resetAt: rateLimitCheck.resetAt
                        });
                        logStructured('warn', 'Rate limit excedido', {
                            userId,
                            eventType: 'createBooking',
                            limit: rateLimitCheck.limit
                        });
                        recordFailure('validate', 'rate_limit_exceeded');
                        await releaseIdempotencyLock();
                        return;
                    }
                    perfTrace.afterRateLimit = Date.now();

                    if (areaPolicyDecision?.policy) {
                        try {
                            const operationalAreaPolicyService = require('../services/operational-area-policy-service');
                            await operationalAreaPolicyService.recordAcceptedRequest(
                                areaPolicyDecision.policy,
                                areaPolicyRegionHash
                            );
                        } catch (areaPolicyRecordError) {
                            logStructured('warn', 'Falha ao registrar request em política operacional', {
                                customerId,
                                regionHash: areaPolicyRegionHash,
                                policyId: areaPolicyDecision.policy?.policyId || null,
                                eventType: 'createBooking',
                                error: areaPolicyRecordError.message
                            });
                        }
                    }

                    // Guarda de negócio: corrida paga só pode virar busca se ainda houver
                    // motorista elegível no momento de materializar o booking canônico.
                    const createBookingAvailabilityTimeoutMs = Number.parseInt(
                        process.env.CREATE_BOOKING_AVAILABILITY_TIMEOUT_MS || '1200',
                        10
                    );
                    const createBookingAvailability = await performCreateBookingAvailabilityPrecheck({
                        hasConfirmedPayment,
                        pickupLocation,
                        destinationLocation,
                        preferences: ridePreferences,
                        requestedCarType,
                        checkAvailability: findAvailableDriversForPickup,
                        logStructured,
                        logContext: {
                            userId,
                            eventType: 'createBooking'
                        },
                        timeoutMs: createBookingAvailabilityTimeoutMs
                    });

                    if (!createBookingAvailability.skipped) {
                        if (createBookingAvailability.code === 'NO_DRIVERS_AVAILABLE') {
                            socket.emit('bookingError', {
                                error: 'Não há motorista disponível',
                                message: 'Não há motorista disponível para essa corrida agora. Nenhuma nova busca foi iniciada.',
                                code: 'NO_DRIVERS_AVAILABLE',
                                retryAfterSec: 15
                            });
                            logStructured('warn', 'createBooking bloqueado por ausência de motorista elegível', {
                                userId,
                                customerId,
                                eventType: 'createBooking',
                                code: 'NO_DRIVERS_AVAILABLE'
                            });
                            recordFailure('availability_guard', 'no_drivers_available');
                            await releaseIdempotencyLock();
                            return;
                        }

                        if (!createBookingAvailability.success) {
                            socket.emit('bookingError', {
                                error: 'Não foi possível validar disponibilidade agora',
                                message: 'Não foi possível validar disponibilidade agora. Tente novamente em instantes.',
                                code: createBookingAvailability.code || 'AVAILABILITY_CHECK_FAILED',
                                retryAfterSec: 5
                            });
                            logStructured('warn', 'createBooking bloqueado por falha no guard de disponibilidade', {
                                userId,
                                customerId,
                                eventType: 'createBooking',
                                code: createBookingAvailability.code || 'AVAILABILITY_CHECK_FAILED',
                                error: createBookingAvailability.error || null
                            });
                            recordFailure('availability_guard', 'availability_check_failed');
                            await releaseIdempotencyLock();
                            return;
                        }
                    } else if (hasConfirmedPayment && createBookingAvailability.reason !== 'payment_not_confirmed') {
                        socket.emit('bookingError', {
                            error: 'Não foi possível validar disponibilidade agora',
                            message: 'Não foi possível validar disponibilidade agora. Tente novamente em instantes.',
                            code: 'AVAILABILITY_CHECK_SKIPPED',
                            reason: createBookingAvailability.reason || null,
                            retryAfterSec: 5
                        });
                        logStructured('warn', 'createBooking bloqueado por pre-check de disponibilidade ignorado', {
                            userId,
                            customerId,
                            eventType: 'createBooking',
                            reason: createBookingAvailability.reason || null
                        });
                        recordFailure('availability_guard', 'availability_check_skipped');
                        await releaseIdempotencyLock();
                        return;
                    }

                    perfTrace.afterAvailabilityGuard = Date.now();
                    recordStage('availability_guard', perfTrace.afterAvailabilityGuard);

                    // ✅ REFATORAÇÃO: Usar RequestRideCommand
                    logStructured('info', 'Executando RequestRideCommand', {
                        customerId,
                        eventType: 'createBooking'
                    });

                    // ✅ FASE 1.3: Criar span para Command
                    const tracer = getTracer();
                    const { context, trace: otelTrace } = require('@opentelemetry/api');
                    const activeSpan = otelTrace.getActiveSpan();

                    const commandSpan = createCommandSpan(tracer, 'request_ride', activeSpan, {
                        'command.customer_id': customerId,
                        'command.pickup_lat': pickupLocation.lat,
                        'command.pickup_lng': pickupLocation.lng,
                        'correlation.id': correlationId // ✅ Passar correlationId
                    });

                    // ✅ MÉTRICAS: Registrar corrida solicitada
                    const city = data.city || 'unknown';
                    metrics.recordRideRequested(city, 'standard');

                    // Executar command dentro do span
                    const commandStartTime = Date.now();
                    perfTrace.commandStart = commandStartTime;
                    let result;
                    let commandLatency;
                    const commandPaymentData =
                        data?.paymentData && typeof data.paymentData === 'object'
                            ? { ...data.paymentData }
                            : {};

                    if (paymentChargeId) {
                        commandPaymentData.chargeId = paymentChargeId;
                    }
                    if (paymentReferenceRideId) {
                        commandPaymentData.rideId = paymentReferenceRideId;
                    }
                    [
                        'paymentSessionId',
                        'paymentContextKey',
                        'quoteSessionId',
                        'quoteLockId',
                        'paymentDriverReservationId',
                        'paymentDriverReservationDriverId',
                        'paymentDriverReservationExpiresAt',
                        'paymentDriverReservationTtlSeconds',
                        'providerEnvironment',
                        'paymentProviderEnvironment',
                        'paymentProfileId',
                        'paymentProfileReason',
                        'paymentProfileSource',
                        'passengerName',
                        'customerName',
                        'routeDistanceKm',
                        'routeDurationSecs'
                    ].forEach((key) => {
                        if (!commandPaymentData[key] && paymentIntentBinding[key]) {
                            commandPaymentData[key] = paymentIntentBinding[key];
                        }
                    });
                    commandPaymentData.paymentStatus = normalizedPaymentStatus;
                    commandPaymentData.serverValidated = paymentServerValidated;
                    if (paymentProviderProofSource) {
                        commandPaymentData.providerProofSource = paymentProviderProofSource;
                    }
                    if (Number.isFinite(resolvedPaymentAmountInCents) && resolvedPaymentAmountInCents > 0) {
                        commandPaymentData.amountInCents = resolvedPaymentAmountInCents;
                    }
                    if (
                        (!Number.isFinite(Number(commandPaymentData.grossAmountInCents)) ||
                            Number(commandPaymentData.grossAmountInCents) <= 0) &&
                        Number.isFinite(paymentIntentBinding.grossAmountInCents) &&
                        paymentIntentBinding.grossAmountInCents > 0
                    ) {
                        commandPaymentData.grossAmountInCents = paymentIntentBinding.grossAmountInCents;
                    }
                    const effectiveRouteDistanceKm =
                        normalizePositiveNumber(paymentIntentBinding.routeDistanceKm) ||
                        normalizePositiveNumber(routeDistanceKm) ||
                        0;
                    const effectiveRouteDurationSecs =
                        normalizePositiveNumber(paymentIntentBinding.routeDurationSecs) ||
                        normalizePositiveNumber(routeDurationSecs) ||
                        0;
                    const passengerDisplayName = normalizeText(
                        data?.passengerName ||
                        data?.customerName ||
                        data?.riderName ||
                        commandPaymentData.passengerName ||
                        commandPaymentData.customerName
                    );

                    try {
                        const command = new RequestRideCommand({
                            customerId,
                            pickupLocation,
                            destinationLocation,
	                            estimatedFare: estimatedFare || 0,
	                            routeDistanceKm: effectiveRouteDistanceKm,
	                            routeDurationSecs: effectiveRouteDurationSecs,
	                            routeCoordinates: sanitizedRouteCoordinates,
	                            trafficSegments: sanitizedTrafficSegments,
	                            tollFee: tollFee || 0,
                            passengerName: passengerDisplayName || null,
                            customerName: passengerDisplayName || null,
                            carType: requestedCarType,
                            paymentMethod: paymentMethod || 'pix',
                            paymentStatus: normalizedPaymentStatus,
                            paymentId: paymentChargeId || data?.paymentId || null,
                            paymentData: commandPaymentData,
                            preferences: ridePreferences,
                            pricingContext: data.pricingContext || data.operational || null,
                            traceId, // ✅ Passar traceId para o command
                            correlationId // ✅ Passar correlationId para o command
                        });

                        result = await runInSpan(commandSpan, async () => {
                            return await command.execute();
                        });

                        // ✅ MÉTRICAS: Registrar latência do command
                        commandLatency = (Date.now() - commandStartTime) / 1000;
                    } catch (error) {
                        endSpanError(commandSpan, error);
                        commandLatency = (Date.now() - commandStartTime) / 1000;
                        throw error;
                    }

                    // ✅ Log de command
                    logCommand('RequestRideCommand', result.success, commandLatency, {
                        customerId,
                        bookingId: result.data?.bookingId
                    });

                    if (!result.success) {
                        // Erro no command
                        const metadata = getSocketMetadata(socket);
                        await auditService.logRideAction(userId, 'createBooking', null, {
                            error: result.error
                        }, false, result.error, metadata);

                        logStructured('error', 'RequestRideCommand falhou', {
                            userId,
                            eventType: 'createBooking',
                            error: result.error
                        });

                        socket.emit('bookingError', {
                            error: result.error,
                            message: result.error,
                            code: 'COMMAND_ERROR'
                        });
                        recordFailure('command', 'command_error');
                        await releaseIdempotencyLock();
                        return;
                    }

                    // Command executado com sucesso
                    const {
                        bookingId,
                        bookingData: commandBookingData,
                        event,
                        regionHash,
                        perfBreakdownMs: commandPerfBreakdown = null
                    } = result.data;
                    perfTrace.afterCommand = Date.now();
                    recordStage('command', perfTrace.afterCommand);

                    setImmediate(async () => {
                        try {
                            const redis = redisPool.getConnection();
                            await pricingH3ReadModelService.applyBookingSnapshot(redis, {
                                bookingId,
                                ...(commandBookingData || {}),
                                status: commandBookingData?.status || (hasConfirmedPayment ? 'SEARCHING' : 'AWAITING_PAYMENT'),
                                state: commandBookingData?.state || (hasConfirmedPayment ? 'SEARCHING' : 'AWAITING_PAYMENT')
                            });
                        } catch (pricingReadModelError) {
                            logStructured('warn', 'Falha ao atualizar read-model H3 de pricing após createBooking', {
                                bookingId,
                                eventType: 'createBooking',
                                error: pricingReadModelError.message
                            });
                        }
                    });

                    if (supersededBookingId && supersededBookingId !== bookingId) {
                        try {
                            const redis = redisPool.getConnection();
                            await redis.hset(`booking:${supersededBookingId}`, {
                                supersededByBookingId: bookingId,
                                supersededAt: new Date().toISOString()
                            });
                        } catch (supersededUpdateError) {
                            logStructured('warn', 'Falha ao atualizar vínculo de supersedência com booking final', {
                                bookingId,
                                supersededBookingId,
                                eventType: 'createBooking',
                                error: supersededUpdateError.message
                            });
                        }
                    }

                    // ✅ REFATORAÇÃO: Publicar evento no EventBus (listeners vão notificar motoristas)
                    if (event) {
                        if (!event.data) {
                            event.data = {};
                        }
                        if (!event.data.metadata) {
                            event.data.metadata = {};
                        }
                        if (!hasConfirmedPayment) {
                            event.data.skipDriverNotify = true;
                            event.data.metadata.skipDriverNotify = true;
                            event.data.metadata.dispatchStrategy = 'await_payment_webhook';
                        } else if (SKIP_EVENTBUS_NOTIFY_FOR_PAID_BOOKINGS) {
                            // Corridas pagas usam dispatch imediato dedicado; evita notificação duplicada.
                            event.data.skipDriverNotify = true;
                            event.data.metadata.skipDriverNotify = true;
                            event.data.metadata.dispatchStrategy = 'payment_dispatch_only';
                        }

                        const publishRideRequestedEvent = async () => {
                            // ✅ FASE 1.3: Criar span para Event publish
                            const { trace: otelTrace } = require('@opentelemetry/api');
                            const activeSpan = otelTrace.getActiveSpan();
                            const eventSpan = createEventSpan(tracer, 'ride.requested', activeSpan, {
                                'event.booking_id': bookingId,
                                'correlation.id': correlationId // ✅ Passar correlationId
                            });

                            const eventStartTime = Date.now();
                            await runInSpan(eventSpan, async () => {
                                await eventBus.publish({
                                    eventType: 'ride.requested',
                                    data: event
                                });
                            });

                            // ✅ Salvar contexto do evento para linkar com listeners
                            const eventSpanContext = eventSpan.spanContext();
                            event.data._otelSpanContext = eventSpanContext;
                            // ✅ CRÍTICO: Serializar correlationId e traceId no evento
                            event.data.metadata.correlationId = correlationId;
                            event.data.metadata.traceId = eventSpanContext.traceId;
                            event.data.metadata.spanId = eventSpanContext.spanId;

                            endSpanSuccess(eventSpan, {
                                'event.latency_ms': Date.now() - eventStartTime
                            });

                            const eventLatency = Date.now() - eventStartTime;
                            logEvent('ride.requested', 'published', {
                                bookingId,
                                latency_ms: eventLatency
                            });
                        };

                        if (CREATE_BOOKING_BACKGROUND_EVENT_PUBLISH) {
                            setImmediate(async () => {
                                try {
                                    await publishRideRequestedEvent();
                                } catch (publishError) {
                                    logStructured('warn', 'createBooking: falha ao publicar ride.requested em background', {
                                        bookingId,
                                        eventType: 'createBooking',
                                        error: publishError.message
                                    });
                                }
                            });
                        } else {
                            try {
                                await publishRideRequestedEvent();
                            } catch (error) {
                                endSpanError(socketSpan, error);
                                throw error;
                            }
                        }
                    }

                    // Armazenar também em activeBookings (compatibilidade)
                    io.activeBookings.set(bookingId, {
                        bookingId,
                        customerId,
                        pickupLocation,
                        destinationLocation,
	                        estimatedFare: commandBookingData?.estimatedFare || estimatedFare || 0,
	                        routeDistanceKm: commandBookingData?.routeDistanceKm || routeDistanceKm || 0,
	                        routeDurationSecs: commandBookingData?.routeDurationSecs || routeDurationSecs || 0,
	                        routeCoordinates: commandBookingData?.routeCoordinates || sanitizedRouteCoordinates,
	                        trafficSegments: commandBookingData?.trafficSegments || sanitizedTrafficSegments,
	                        paymentMethod,
                        status: 'requested'
                    });

                    // O booking primário já sai autoritativo do command/queue manager.
                    // Aqui mantemos apenas o ponteiro rápido do passageiro para evitar
                    // reconsultas desnecessárias no guard de booking ativo.
                    try {
                        const redis = redisPool.getConnection();
                        if (customerActiveBookingKey) {
                            await redis.set(
                                customerActiveBookingKey,
                                bookingId,
                                'EX',
                                CUSTOMER_ACTIVE_BOOKING_TTL_SECONDS
                            );
                        }
                    } catch (bookingMetaError) {
                        logStructured('warn', 'Falha ao persistir metadados no booking', {
                            bookingId,
                            error: bookingMetaError.message,
                            eventType: 'createBooking'
                        });
                    }
                    perfTrace.beforeResponse = Date.now();
                    recordStage('response_prepare', perfTrace.beforeResponse);

                    // Preparar resposta de sucesso
                    // ✅ Garantir que traceId esteja disponível (pode vir do contexto ou do handler)
                    let currentTraceId = traceId || traceContext.getCurrentTraceId() || extractTraceIdFromEvent(data, socket);

                    // ✅ Garantir que traceId nunca seja undefined ou null
                    if (!currentTraceId) {
                        currentTraceId = traceContext.generateTraceId('booking');
                        logStructured('warn', 'traceId não encontrado, gerando novo', {
                            bookingId,
                            eventType: 'createBooking'
                        });
                    }

                    // ✅ Criar objeto de resposta com traceId garantido
                    const finalTraceId = currentTraceId || traceContext.getCurrentTraceId() || traceContext.generateTraceId('booking');

                    const bookingResponse = {
                        success: true,
                        bookingId,
                        message: 'Corrida solicitada com sucesso',
                        traceId: finalTraceId, // ✅ Incluir traceId no nível raiz
                        data: {
                            bookingId,
                            customerId,
                            pickupLocation,
                            destinationLocation,
                            estimatedFare: commandBookingData?.estimatedFare || estimatedFare || 0,
                            pricingPayload: commandBookingData?.pricingPayload || null,
                            operationalState: commandBookingData?.operationalState || null,
                            scorePressao: commandBookingData?.scorePressao ?? null,
                            scoreExcecao: commandBookingData?.scoreExcecao ?? null,
                            paymentMethod,
                            status: 'requested',
                            timestamp: new Date().toISOString(),
                            traceId: finalTraceId, // ✅ SOLUÇÃO: Incluir também dentro de data (garantido)
                            ...(includePerfBreakdown
                                ? {
                                    perfMs: {
                                        rateLimit: (perfTrace.afterRateLimit || Date.now()) - perfTrace.start,
                                        validation: (perfTrace.afterValidation || Date.now()) - (perfTrace.afterRateLimit || perfTrace.start),
                                        activeGuard: (perfTrace.afterActiveGuard || Date.now()) - (perfTrace.afterValidation || perfTrace.start),
                                        backpressure: (perfTrace.afterBackpressure || Date.now()) - (perfTrace.afterActiveGuard || perfTrace.start),
                                        policy: (perfTrace.afterPolicy || Date.now()) - (perfTrace.afterBackpressure || perfTrace.start),
                                        idempotency: (perfTrace.afterIdempotency || Date.now()) - (perfTrace.afterPolicy || perfTrace.afterBackpressure || perfTrace.start),
                                        preCommand: (perfTrace.afterIdempotency || Date.now()) - perfTrace.start,
                                        command: (perfTrace.afterCommand || Date.now()) - (perfTrace.commandStart || perfTrace.start),
                                        responsePrepare: (perfTrace.beforeResponse || Date.now()) - (perfTrace.afterCommand || perfTrace.start),
                                        postCommandBeforeResponse: (perfTrace.beforeResponse || Date.now()) - (perfTrace.afterCommand || perfTrace.start),
                                        totalToResponse: Date.now() - perfTrace.start,
                                        commandBreakdown: commandPerfBreakdown
                                    }
                                }
                                : {})
                        }
                    };

                    // ✅ Debug: Log para confirmar traceId na resposta
                    logStructured('info', 'bookingResponse criado com traceId', {
                        bookingId,
                        traceId: finalTraceId,
                        eventType: 'createBooking'
                    });

                    // ✅ GARANTIR que traceId esteja presente antes de emitir (dupla verificação)
                    if (!bookingResponse.traceId) {
                        bookingResponse.traceId = finalTraceId;
                    }
                    if (bookingResponse.data && !bookingResponse.data.traceId) {
                        bookingResponse.data.traceId = finalTraceId;
                    }

                    // ✅ DEBUG: Log imediatamente antes de emitir para verificar conteúdo
                    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_TRACEID === 'true') {
                        logStructured('debug', 'bookingResponse antes de emitir', {
                            service: 'server',
                            bookingId: bookingResponse.bookingId,
                            traceId: bookingResponse.traceId,
                            traceIdInData: bookingResponse.data?.traceId,
                            eventType: 'createBooking'
                        });
                    }

                    // ✅ Criar uma cópia explícita do objeto para garantir que traceId não seja perdido
                    const responseToEmit = {
                        success: bookingResponse.success,
                        bookingId: bookingResponse.bookingId,
                        message: bookingResponse.message,
                        traceId: bookingResponse.traceId, // ✅ Forçar inclusão explícita
                        data: {
                            ...bookingResponse.data,
                            traceId: bookingResponse.data?.traceId || bookingResponse.traceId // ✅ Forçar inclusão explícita
                        }
                    };

                    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                        logStructured('debug', 'responseToEmit criado', {
                            service: 'websocket',
                            operation: 'createBooking',
                            responseToEmit
                        });
                    }

                    // Cachear o resultado antes do emit para que retries benignos
                    // consigam "join" de forma estável no caminho quente.
                    try {
                        await idempotencyService.cacheResult(idempotencyKey, bookingResponse);
                    } catch (idempotencyCacheError) {
                        logStructured('warn', 'Falha ao cachear resultado de idempotência antes do emit', {
                            bookingId,
                            eventType: 'createBooking',
                            error: idempotencyCacheError.message
                        });
                    }

                    // Emitir confirmação para o cliente o quanto antes para evitar timeout no app.
                    socket.emit('bookingCreated', responseToEmit);
                    perfTrace.afterEmit = Date.now();
                    recordStage('response_emit', perfTrace.afterEmit);
                    recordSuccess();

                    // Telemetria de custo enviada junto com o createBooking entra em background
                    // para não disputar o tempo crítico de resposta ao cliente.
                    if (rideCostTelemetryService && data?.rideCostTelemetry?.snapshot) {
                        setImmediate(async () => {
                            try {
                                await rideCostTelemetryService.ingestSnapshot({
                                    bookingId,
                                    sourceMeta: {
                                        ...data?.rideCostTelemetry?.sourceMeta,
                                        userId: customerId,
                                        userType: socket.userType || 'customer',
                                        socketId: socket.id
                                    },
                                    snapshot: data.rideCostTelemetry.snapshot,
                                    pricingSheet: data?.rideCostTelemetry?.pricingSheet || null,
                                    requestMeta: {
                                        source: 'createBooking',
                                        socketId: socket.id,
                                        receivedAt: new Date().toISOString()
                                    }
                                });
                            } catch (telemetryError) {
                                logStructured('warn', 'Falha ao persistir telemetria inicial da corrida', {
                                    bookingId,
                                    eventType: 'createBooking',
                                    error: telemetryError.message
                                });
                            }
                        });
                    }

                    // Para corridas já pagas, acionar dispatch imediato e resiliente sem depender de fila/event bus.
                    if (hasConfirmedPayment) {
                        const paymentDispatchService = require('../services/payment-dispatch-service');
                        const paidDispatchMaxAttempts = Number.parseInt(
                            process.env.PAID_BOOKING_DISPATCH_MAX_ATTEMPTS || '120',
                            10
                        );
                        const paidDispatchRetryDelayMs = Number.parseInt(
                            process.env.PAID_BOOKING_DISPATCH_RETRY_DELAY_MS || '1000',
                            10
                        );

                        setImmediate(async () => {
                            try {
                                const materializeResult = await paymentDispatchService.materializePaymentForBooking({
                                    bookingId,
                                    chargeId: paymentChargeId,
                                    temporaryRideId: paymentReferenceRideId,
                                    amountInCents: resolvedPaymentAmountInCents,
                                    passengerId: customerId,
                                    paymentStatus: normalizedPaymentStatus || 'in_holding',
                                    source: 'createBooking_paid_immediate'
                                });

                                const intentConsumed = paymentReferenceRideId
                                    ? await paymentServiceSingleton.markAdvancePaymentIntentConsumed({
                                        rideId: paymentReferenceRideId,
                                        bookingId,
                                        chargeId: paymentChargeId
                                    })
                                    : false;
                                let paymentDriverReservationConsumed = false;
                                if (paymentDriverReservation?.reservationId) {
                                    try {
                                        const {
                                            consumePaymentDriverReservationForBooking
                                        } = require('../services/payment-driver-reservation-service');
                                        const redis = redisPool.getConnection();
                                        const consumeResult = await consumePaymentDriverReservationForBooking({
                                            redis,
                                            reservationId: paymentDriverReservation.reservationId,
                                            bookingId
                                        });
                                        paymentDriverReservationConsumed = Boolean(consumeResult?.success);
                                    } catch (reservationConsumeError) {
                                        logStructured('warn', 'createBooking: falha ao consumir reserva de motorista para booking', {
                                            bookingId,
                                            eventType: 'createBooking',
                                            paymentDriverReservationId: paymentDriverReservation.reservationId,
                                            error: reservationConsumeError.message
                                        });
                                    }
                                }

                                logStructured('info', 'createBooking: pagamento materializado para booking canônico', {
                                    bookingId,
                                    eventType: 'createBooking',
                                    success: Boolean(materializeResult?.success),
                                    skipped: Boolean(materializeResult?.skipped),
                                    reason: materializeResult?.reason || null,
                                    temporaryRideId: paymentReferenceRideId || null,
                                    chargeId: paymentChargeId || null,
                                    amountInCents: materializeResult?.amountInCents || null,
                                    intentConsumed,
                                    paymentDriverReservationConsumed
                                });

                                const dispatchResult = await paymentDispatchService.triggerDispatchAfterPayment({
                                    bookingId,
                                    io,
                                    pickupLocation,
                                    source: 'createBooking_paid_immediate',
                                    force: true,
                                    maxAttempts: paidDispatchMaxAttempts,
                                    retryDelayMs: paidDispatchRetryDelayMs
                                });

                                logStructured('info', 'createBooking: dispatch imediato para corrida paga processado', {
                                    bookingId,
                                    eventType: 'createBooking',
                                    success: Boolean(dispatchResult?.success),
                                    skipped: Boolean(dispatchResult?.skipped),
                                    reason: dispatchResult?.reason || null,
                                    attempts: dispatchResult?.attempts || 1
                                });
                            } catch (dispatchError) {
                                logStructured('warn', 'createBooking: falha ao materializar pagamento ou acionar dispatch imediato', {
                                    bookingId,
                                    eventType: 'createBooking',
                                    error: dispatchError.message
                                });
                            }
                        });
                    }

                    // Link de charge/rideId fica em background. O booking primário já sai com
                    // status de pagamento consistente, então não precisamos bloquear a resposta.
                    if (paymentChargeId || paymentReferenceRideId) {
                        setImmediate(async () => {
                            try {
                                const paymentDispatchService = require('../services/payment-dispatch-service');
                                await paymentDispatchService.linkPaymentToBooking({
                                    bookingId,
                                    chargeId: paymentChargeId,
                                    temporaryRideId: paymentReferenceRideId
                                });
                            } catch (paymentLinkError) {
                                logStructured('warn', 'Falha ao vincular referências de pagamento em background', {
                                    bookingId,
                                    eventType: 'createBooking',
                                    error: paymentLinkError.message
                                });
                            }
                        });
                    }

                    // ✅ DEBUG: Log após emitir para confirmar
                    if (process.env.NODE_ENV === 'development' || process.env.DEBUG_WEBSOCKET === 'true') {
                        logStructured('debug', 'bookingCreated emitido', {
                            service: 'websocket',
                            operation: 'createBooking',
                            traceId: responseToEmit.traceId
                        });
                    }

                    // Pós-processamentos em background (não bloquear bookingCreated / dispatch para motorista).
                    setImmediate(async () => {
                        try {
                            await metricsCollector.recordMatchStart(bookingId, Date.now());
                        } catch (metricsError) {
                            logStructured('warn', 'Falha ao registrar match start (background)', {
                                bookingId,
                                eventType: 'createBooking',
                                error: metricsError.message
                            });
                        }

                        try {
                            await auditService.logRideAction(userId, 'createBooking', bookingId, {
                                pickupLocation,
                                destinationLocation,
                                estimatedFare: commandBookingData?.estimatedFare || estimatedFare || 0,
                                paymentMethod,
                                regionHash
                            }, true, null, metadata);
                        } catch (auditError) {
                            logStructured('warn', 'Falha ao registrar auditoria createBooking (background)', {
                                bookingId,
                                eventType: 'createBooking',
                                error: auditError.message
                            });
                        }

                        try {
                            const redis = redisPool.getConnection();
                            await redisPool.ensureConnection();
                            const queueKey = `ride_queue:${regionHash}:pending`;
                            const pendingRides = await redis.zcard(queueKey);

                            if (pendingRides >= 3) {
                                const demandNotificationService = require('../services/demand-notification-service');
                                await demandNotificationService.checkAndNotifyDemand(
                                    pickupLocation,
                                    pendingRides
                                );
                            }
                        } catch (demandError) {
                            logStructured('error', 'Erro ao verificar demanda (background)', {
                                bookingId,
                                error: demandError.message,
                                eventType: 'createBooking'
                            });
                        }

                        try {
                            const ridePersistenceService = require('../services/ride-persistence-service');
                            await ridePersistenceService.saveRide({
                                rideId: bookingId,
                                bookingId: bookingId,
                                passengerId: customerId,
                                pickupLocation: pickupLocation,
                                destinationLocation: destinationLocation,
	                                estimatedFare: commandBookingData?.estimatedFare || estimatedFare || 0,
	                                routeDistanceKm: commandBookingData?.routeDistanceKm || effectiveRouteDistanceKm || 0,
	                                routeDurationSecs: commandBookingData?.routeDurationSecs || effectiveRouteDurationSecs || 0,
	                                routeCoordinates: commandBookingData?.routeCoordinates || sanitizedRouteCoordinates,
	                                trafficSegments: commandBookingData?.trafficSegments || sanitizedTrafficSegments,
	                                paymentMethod: paymentMethod || 'pix',
                                paymentStatus: data.paymentStatus || 'pending_payment',
                                status: hasConfirmedPayment ? 'pending' : 'awaiting_payment',
                                carType: data.carType || null
                            });
                        } catch (persistError) {
                            logStructured('error', 'Erro ao salvar corrida no Firestore (background)', {
                                bookingId,
                                error: persistError.message,
                                eventType: 'createBooking'
                            });
                        }
                    });

                    const totalLatency = Date.now() - startTime;
                    logStructured('info', 'createBooking concluído com sucesso', {
                        userId,
                        bookingId,
                        eventType: 'createBooking',
                        latency_ms: totalLatency
                    });
                });
            } catch (error) {
                try {
                    if (typeof outerReleaseIdempotencyLock === 'function') {
                        await outerReleaseIdempotencyLock();
                    }
                } catch (_releaseError) {
                    // ignore
                }
                endSpanError(socketSpan, error);
                console.error('🔥 ERRO CRÍTICO EM CREATE_BOOKING:', error); // ✅ DEBUG DIRETO
                logStructured('error', 'Erro ao criar corrida', {
                    userId: socket.userId || data?.customerId || socket.id,
                    eventType: 'createBooking',
                    error: error.message,
                    stack: error.stack
                });
                metrics.recordHotpathReason('create_booking', 'unexpected_error');
                metrics.recordHotpathLatency('create_booking', Math.max(0, (Date.now() - outerStartTime) / 1000), false);

                // ✅ NOVO: Log de auditoria para erro na criação de corrida
                const userId = socket.userId || data?.customerId || socket.id;
                const metadata = getSocketMetadata(socket);
                await auditService.logRideAction(userId, 'createBooking', null, {
                    error: error.message,
                    stack: error.stack
                }, false, error.message, metadata);

                socket.emit('bookingError', { error: 'Erro interno do servidor' });
            }
        });
    });
    // =========================================================================================
}

module.exports = registerSocketCreateBookingHandler;
