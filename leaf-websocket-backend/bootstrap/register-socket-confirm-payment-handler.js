const {
    performCreateBookingAvailabilityPrecheck
} = require('../services/create-booking-availability-precheck');
const { getFinancialCollections } = require('../services/financial-runtime-context');
const {
    assertStoredRecordMatchesScope,
    resolvePersistenceScope
} = require('../services/sandbox-persistence-context');

function parseBookingPreferences(value) {
    if (!value) {
        return {};
    }
    if (typeof value === 'object') {
        return { ...value };
    }
    try {
        const parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_error) {
        return {};
    }
}

const PAID_PAYMENT_STATUSES = new Set([
    'approved',
    'completed',
    'confirmed',
    'credited',
    'distributed',
    'in_holding',
    'paid',
    'settled'
]);

const AUTHORITATIVE_PAYMENT_RECORD_SOURCES = new Set([
    'provider_verification',
    'sandbox_provider_verification',
    'woovi_provider_verification',
    'woovi_webhook',
    'woovi_extension_webhook',
    'socket_confirmpayment_provider_verified',
    'createbooking_paid_immediate'
]);

const NON_AUTHORITATIVE_PAYMENT_STATUS_SOURCES = new Set([
    'booking_cache',
    'payment_holding_doc',
    'payment_holding_query',
    'payment_holding_retry',
    'payment_status_cache',
    'ride_payments_query'
]);

function boolEnv(name, fallback = false) {
    const raw = process.env[name];
    if (raw === undefined || raw === null || raw === '') {
        return fallback;
    }
    return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

function isProductionRuntime() {
    return [
        process.env.NODE_ENV,
        process.env.APP_ENV,
        process.env.LEAF_ENV,
        process.env.ENVIRONMENT
    ].some((value) => ['production', 'prod'].includes(String(value || '').trim().toLowerCase()));
}

function normalizePaymentStatus(value) {
    return String(value || '').trim().toLowerCase();
}

function isPaidPaymentStatus(value) {
    return PAID_PAYMENT_STATUSES.has(normalizePaymentStatus(value));
}

function normalizePaymentAmountCents(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }
    return numeric < 1000 ? Math.round(numeric * 100) : Math.round(numeric);
}

function collectPaymentReferences(...values) {
    return Array.from(new Set(
        values
            .flat()
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    ));
}

function isSocketMockPaymentAllowed(data = {}) {
    const requestedMockPayment =
        data?.mockPayment === true ||
        data?.__mockPayment === true ||
        boolEnv('MOCK_PAYMENT_FOR_TESTS', false);

    if (!requestedMockPayment) {
        return false;
    }

    if (boolEnv('APP_REVIEW', false)) {
        return true;
    }

    if (boolEnv('MOCK_PAYMENT_FOR_TESTS', false)) {
        return !isProductionRuntime();
    }

    if (boolEnv('ALLOW_SOCKET_MOCK_PAYMENT_CONFIRMATION', false)) {
        return !isProductionRuntime();
    }

    return false;
}

function shouldRequireProviderPaymentConfirmation() {
    return isProductionRuntime() || boolEnv('SOCKET_CONFIRM_PAYMENT_REQUIRE_PROVIDER', false);
}

function recordMatchesAnyReference(record = {}, references = []) {
    if (!references.length) {
        return false;
    }
    const candidates = collectPaymentReferences(
        record.chargeId,
        record.paymentId,
        record.paymentIntentId,
        record.extensionChargeId,
        record.correlationID,
        record.metadata?.chargeId,
        record.metadata?.paymentId,
        record.metadata?.paymentIntentId,
        record.metadata?.correlationID
    );
    return candidates.some((candidate) => references.includes(candidate));
}

function amountMatchesExpected(record = {}, expectedAmountInCents = 0) {
    if (!expectedAmountInCents) {
        return true;
    }
    const recordAmount = normalizePaymentAmountCents(
        record.amountInCents ??
        record.amount ??
        record.metadata?.amountInCents ??
        record.metadata?.amount
    );
    return recordAmount > 0 && recordAmount === expectedAmountInCents;
}

function isAuthoritativePaymentRecord(record = {}, { references = [], expectedAmountInCents = 0 } = {}) {
    const source = normalizePaymentStatus(record.source || record.metadata?.source);
    return (
        isPaidPaymentStatus(record.status || record.paymentStatus) &&
        AUTHORITATIVE_PAYMENT_RECORD_SOURCES.has(source) &&
        recordMatchesAnyReference(record, references) &&
        amountMatchesExpected(record, expectedAmountInCents)
    );
}

function isAuthoritativeProviderStatus(status = {}, expectedAmountInCents = 0) {
    const source = normalizePaymentStatus(status.source);
    if (!status?.success || !isPaidPaymentStatus(status.status)) {
        return false;
    }
    if (NON_AUTHORITATIVE_PAYMENT_STATUS_SOURCES.has(source)) {
        return false;
    }
    if (source && source !== 'woovi_provider' && !AUTHORITATIVE_PAYMENT_RECORD_SOURCES.has(source)) {
        return false;
    }
    if (!amountMatchesExpected(status, expectedAmountInCents)) {
        return false;
    }
    return source === 'woovi_provider' || Boolean(status.providerEnvironment || status.paymentProfileId);
}

function resolvePaymentConfirmationScope(paymentContext) {
    const scopeInput = paymentContext || {};
    const persistenceScope = resolvePersistenceScope(scopeInput, {
        allowLegacyOperational: true
    });
    const { collections } = getFinancialCollections(persistenceScope.financialContext);
    return {
        scopeInput,
        persistenceScope,
        collections
    };
}

function recordMatchesPaymentScope(record, confirmationScope) {
    if (!record) return false;
    if (confirmationScope.persistenceScope.namespace !== 'sandbox') return true;
    try {
        assertStoredRecordMatchesScope(record, confirmationScope.scopeInput);
        return true;
    } catch (_error) {
        return false;
    }
}

function providerStatusMatchesPaymentScope(status, confirmationScope) {
    if (confirmationScope.persistenceScope.namespace !== 'sandbox') return true;
    const expectedContext = confirmationScope.persistenceScope.financialContext;
    if (String(status?.providerEnvironment || '').trim().toLowerCase() !== 'sandbox') {
        return false;
    }
    const providerProfileId = String(status?.paymentProfileId || '').trim();
    return !(
        providerProfileId &&
        expectedContext.paymentProfileId &&
        providerProfileId !== expectedContext.paymentProfileId
    );
}

async function getFirestoreDocData(firestore, collectionName, docId) {
    if (!firestore || !collectionName || !docId) {
        return null;
    }
    const doc = await firestore.collection(collectionName).doc(docId).get();
    return doc?.exists ? doc.data() : null;
}

async function queryFirstDocData(firestore, collectionName, field, value) {
    if (!firestore || !collectionName || !field || !value) {
        return null;
    }
    const collection = firestore.collection(collectionName);
    if (typeof collection?.where !== 'function') {
        return null;
    }
    const query = collection.where(field, '==', value).limit(1);
    const snapshot = await query.get();
    if (!snapshot || snapshot.empty) {
        return null;
    }
    return snapshot.docs?.[0]?.data?.() || null;
}

async function resolveAuthoritativePaymentConfirmation({
    paymentService,
    firestore,
    bookingId,
    references = [],
    expectedAmountInCents = 0,
    paymentContext = null
} = {}) {
    let confirmationScope;
    try {
        confirmationScope = resolvePaymentConfirmationScope(paymentContext);
    } catch (error) {
        return {
            success: false,
            code: error.code || 'FINANCIAL_CONTEXT_INVALID',
            message: error.message || 'Contexto financeiro inválido para confirmar o pagamento.'
        };
    }

    const safeReferences = collectPaymentReferences(references);
    if (!safeReferences.length) {
        return {
            success: false,
            code: 'PAYMENT_PROVIDER_REFERENCE_REQUIRED',
            message: 'Referência de pagamento ausente para confirmação provider-backed.'
        };
    }

    const localRecords = [];
    const localDocIds = collectPaymentReferences(bookingId, safeReferences);
    for (const docId of localDocIds) {
        localRecords.push(await getFirestoreDocData(
            firestore,
            confirmationScope.collections.paymentHoldings,
            docId
        ));
        localRecords.push(await getFirestoreDocData(
            firestore,
            confirmationScope.collections.ridePayments,
            docId
        ));
    }

    for (const reference of safeReferences) {
        localRecords.push(await queryFirstDocData(
            firestore,
            confirmationScope.collections.paymentHoldings,
            'paymentId',
            reference
        ));
        localRecords.push(await queryFirstDocData(
            firestore,
            confirmationScope.collections.paymentHoldings,
            'chargeId',
            reference
        ));
        localRecords.push(await queryFirstDocData(
            firestore,
            confirmationScope.collections.ridePayments,
            'chargeId',
            reference
        ));
    }

    const authoritativeLocalRecord = localRecords.find((record) =>
        recordMatchesPaymentScope(record, confirmationScope) && isAuthoritativePaymentRecord(record, {
            references: safeReferences,
            expectedAmountInCents
        })
    );
    if (authoritativeLocalRecord) {
        return {
            success: true,
            source: authoritativeLocalRecord.source || authoritativeLocalRecord.metadata?.source || 'authoritative_local_record',
            record: authoritativeLocalRecord
        };
    }

    if (paymentService && typeof paymentService.getPaymentStatus === 'function') {
        for (const reference of safeReferences) {
            const providerStatus = paymentContext
                ? await paymentService.getPaymentStatus(reference, paymentContext)
                : await paymentService.getPaymentStatus(reference);
            if (
                providerStatusMatchesPaymentScope(providerStatus, confirmationScope) &&
                isAuthoritativeProviderStatus(providerStatus, expectedAmountInCents)
            ) {
                return {
                    success: true,
                    source: providerStatus.source || 'woovi_provider',
                    record: providerStatus
                };
            }
        }
    }

    return {
        success: false,
        code: 'PAYMENT_NOT_PROVIDER_CONFIRMED',
        message: 'Pagamento ainda não possui confirmação autoritativa do provedor.'
    };
}

function registerSocketConfirmPaymentHandler({
    socket,
    io,
    extractTraceIdFromEvent,
    traceContext,
    logStructured,
    rateLimiterService,
    getSocketMetadata,
    auditService,
    validationService,
    redisPool,
    parseBookingLocation,
    findAvailableDriversForPickup,
    idempotencyService
}) {
    socket.on('confirmPayment', async (data) => {
        // ✅ OBSERVABILIDADE: Gerar traceId no início do handler
        const traceId = extractTraceIdFromEvent(data, socket);
        let outerIdempotencyKey = null;
        let outerIdempotencyOwner = false;
        await traceContext.runWithTraceId(traceId, async () => {
            try {
                logStructured('info', 'confirmPayment iniciado', {
                    userId: socket.userId || data.customerId || socket.id,
                    eventType: 'confirmPayment'
                });

                const startTime = Date.now();

                // ✅ NOVO: Rate Limiting
                const userId = socket.userId || data.customerId || socket.id;
                const metadata = getSocketMetadata(socket);
                const rateLimitCheck = await rateLimiterService.checkRateLimit(userId, 'confirmPayment', {
                    ip: metadata.ip
                });

                if (!rateLimitCheck.allowed) {
                    // ✅ NOVO: Log de auditoria para rate limit excedido
                    await auditService.logSecurityAction(userId, 'rateLimitExceeded', 'confirmPayment', {
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    }, metadata);

                    socket.emit('paymentError', {
                        error: 'Muitas requisições',
                        message: `Você excedeu o limite de ${rateLimitCheck.limit} requisições por minuto. Tente novamente em ${Math.ceil((rateLimitCheck.resetAt - Date.now()) / 1000)} segundos.`,
                        code: 'RATE_LIMIT_EXCEEDED',
                        limit: rateLimitCheck.limit,
                        remaining: rateLimitCheck.remaining,
                        resetAt: rateLimitCheck.resetAt
                    });
                    logStructured('warn', 'Rate limit excedido', {
                        userId,
                        eventType: 'confirmPayment',
                        limit: rateLimitCheck.limit
                    });
                    return;
                }

                logStructured('info', 'Confirmação de pagamento recebida', {
                    userId,
                    bookingId: data.bookingId,
                    eventType: 'confirmPayment'
                });

                // ✅ NOVO: Validação e sanitização de dados
                const validation = validationService.validateEndpoint('confirmPayment', data);

                if (!validation.valid) {
                    await auditService.logPaymentAction(userId, 'confirmPayment', data.bookingId || null, null, {
                        error: 'Validação falhou',
                        validationErrors: validation.errors
                    }, false, 'Dados de entrada inválidos', metadata);

                    socket.emit('paymentError', {
                        error: 'Dados inválidos',
                        message: 'Os dados fornecidos não são válidos',
                        details: validation.errors,
                        code: 'VALIDATION_ERROR'
                    });
                    return;
                }

                // Usar dados sanitizados
                const { bookingId, paymentMethod, paymentId, amount } = validation.sanitized;
                const paymentMockEnabled = isSocketMockPaymentAllowed(data);

                // Guarda de negócio: só confirma pagamento se houver motorista elegível no momento.
                let bookingPickupLocation = null;
                let bookingDestinationLocation = null;
                let bookingPreferences = {};
                let bookingCarType = null;
                let bookingDataForPayment = {};
                try {
                    const redis = redisPool.getConnection();
                    const bookingData = await redis.hgetall(`booking:${bookingId}`);
                    bookingDataForPayment = bookingData || {};
                    bookingPickupLocation = parseBookingLocation(bookingData?.pickupLocation);
                    bookingDestinationLocation = parseBookingLocation(bookingData?.destinationLocation);
                    bookingPreferences = parseBookingPreferences(bookingData?.preferences);
                    bookingCarType = bookingData?.carType || null;
                } catch (bookingLookupError) {
                    logStructured('warn', 'confirmPayment: erro ao buscar booking para validação de disponibilidade', {
                        bookingId,
                        eventType: 'confirmPayment',
                        error: bookingLookupError.message
                    });
                }

                const payloadPickupLocation = data?.pickupLocation;
                const pickupLocationToValidate = bookingPickupLocation || payloadPickupLocation;

                const skipAvailabilityCheck =
                    boolEnv('CONFIRM_PAYMENT_SKIP_AVAILABILITY_CHECK', false);

                if (skipAvailabilityCheck) {
                    logStructured('warn', 'confirmPayment: pre-check de disponibilidade ignorado por flag explícita', {
                        bookingId,
                        eventType: 'confirmPayment',
                        code: 'AVAILABILITY_CHECK_SKIPPED'
                    });
                } else {
                    const availabilityTimeoutMs = Number.parseInt(
                        process.env.CONFIRM_PAYMENT_AVAILABILITY_TIMEOUT_MS || '800',
                        10
                    );
                    const availability = await performCreateBookingAvailabilityPrecheck({
                        hasConfirmedPayment: true,
                        pickupLocation: pickupLocationToValidate,
                        destinationLocation: bookingDestinationLocation,
                        preferences: bookingPreferences,
                        requestedCarType: bookingCarType,
                        checkAvailability: findAvailableDriversForPickup,
                        logStructured,
                        logContext: {
                            userId,
                            bookingId,
                            eventType: 'confirmPayment'
                        },
                        timeoutMs: availabilityTimeoutMs,
                        operationLabel: 'confirmPayment'
                    });

                    if (availability.code === 'NO_DRIVERS_AVAILABLE') {
                        await auditService.logPaymentAction(userId, 'confirmPayment', bookingId || null, paymentId || null, {
                            error: 'Sem motorista elegível antes de confirmar pagamento',
                            code: 'NO_DRIVERS_AVAILABLE',
                            radiusKm: availability.radiusKm || null
                        }, false, 'Sem motorista elegível para confirmar pagamento', metadata);

                        socket.emit('paymentError', {
                            error: 'Não há motorista disponível',
                            message: 'Não há motorista disponível para essa corrida agora. O pagamento não será confirmado.',
                            code: 'NO_DRIVERS_AVAILABLE',
                            retryAfterSec: 15
                        });
                        logStructured('warn', 'confirmPayment bloqueado por ausência de motorista elegível', {
                            bookingId,
                            eventType: 'confirmPayment',
                            code: 'NO_DRIVERS_AVAILABLE'
                        });
                        return;
                    }

                    if (!availability.success || availability.skipped) {
                        const availabilityCode = availability.code || 'AVAILABILITY_CHECK_FAILED';
                        await auditService.logPaymentAction(userId, 'confirmPayment', bookingId || null, paymentId || null, {
                            error: 'Falha ao validar motorista elegível antes de confirmar pagamento',
                            code: availabilityCode,
                            reason: availability.reason || null
                        }, false, 'Falha no guard de disponibilidade antes do pagamento', metadata);

                        socket.emit('paymentError', {
                            error: 'Não foi possível validar disponibilidade agora',
                            message: 'Não foi possível validar motorista disponível agora. Tente novamente em instantes.',
                            code: availabilityCode,
                            retryAfterSec: 5
                        });
                        logStructured('warn', 'confirmPayment bloqueado por falha no guard de disponibilidade', {
                            bookingId,
                            eventType: 'confirmPayment',
                            code: availabilityCode,
                            error: availability.error || null
                        });
                        return;
                    }
                }

                if (paymentMockEnabled) {
                    logStructured('warn', 'confirmPayment executado em modo mock de testes', {
                        bookingId,
                        eventType: 'confirmPayment',
                        mockPayment: true
                    });
                }

                // ✅ NOVO: Idempotency - Verificar se requisição já foi processada
                const idempotencyKey = data.idempotencyKey || idempotencyService.generateKey(
                    userId,
                    'confirmPayment',
                    `${bookingId}_${paymentId || Date.now()}`
                );
                outerIdempotencyKey = idempotencyKey;

                const idempotencyCheck = await idempotencyService.beginRequest(idempotencyKey, {
                    joinWaitMs: Number.parseInt(process.env.IDEMPOTENCY_JOIN_WAIT_MS || '1500', 10)
                });

                if (!idempotencyCheck.isNew) {
                    // Requisição duplicada - retornar resultado cached ou erro
                    if (idempotencyCheck.cachedResult) {
                        logStructured('info', 'Resultado cached retornado', {
                            userId,
                            eventType: 'confirmPayment',
                            idempotencyKey
                        });
                        socket.emit('paymentConfirmed', idempotencyCheck.cachedResult);
                        return;
                    } else {
                        // Requisição duplicada mas sem resultado cached (ainda processando)
                        logStructured('warn', 'Requisição duplicada detectada', {
                            userId,
                            eventType: 'confirmPayment',
                            idempotencyKey
                        });
                        socket.emit('paymentError', {
                            error: 'Requisição duplicada',
                            message: 'Este pagamento já está sendo processado. Aguarde...',
                            code: 'DUPLICATE_REQUEST',
                            retryAfterSec: 1
                        });
                        return;
                    }
                }
                outerIdempotencyOwner = true;

                const PaymentService = require('../services/payment-service');
                const paymentService = new PaymentService();
                const firebaseConfig = require('../firebase-config');
                const firestore = firebaseConfig.getFirestore();
                const amountInCents = normalizePaymentAmountCents(amount);
                const chargeReference = String(data?.chargeId || data?.paymentData?.chargeId || '').trim();
                const paymentIntentReference = String(data?.paymentIntentId || data?.paymentData?.paymentIntentId || '').trim();
                const paymentReferenceRideId = String(data?.rideId || data?.temporaryRideId || data?.paymentData?.rideId || '').trim();
                const paymentConfirmationReferences = collectPaymentReferences(
                    chargeReference,
                    paymentId,
                    paymentIntentReference,
                    bookingDataForPayment?.paymentChargeId,
                    bookingDataForPayment?.paymentId,
                    bookingDataForPayment?.paymentReferenceRideId,
                    paymentReferenceRideId
                );
                const authoritativePaymentContext = Object.keys(bookingDataForPayment || {}).length > 0
                    ? bookingDataForPayment
                    : null;

                if (!paymentMockEnabled && shouldRequireProviderPaymentConfirmation()) {
                    const providerConfirmation = await resolveAuthoritativePaymentConfirmation({
                        paymentService,
                        firestore,
                        bookingId,
                        references: paymentConfirmationReferences,
                        expectedAmountInCents: amountInCents,
                        paymentContext: authoritativePaymentContext
                    });

                    if (!providerConfirmation.success) {
                        await auditService.logPaymentAction(userId, 'confirmPayment', bookingId || null, paymentId || chargeReference || null, {
                            error: providerConfirmation.message,
                            code: providerConfirmation.code,
                            references: paymentConfirmationReferences
                        }, false, 'Pagamento sem confirmação autoritativa do provedor', metadata);

                        socket.emit('paymentError', {
                            error: 'Pagamento não confirmado',
                            message: 'Ainda não recebemos a confirmação autoritativa do provedor para este PIX.',
                            code: providerConfirmation.code || 'PAYMENT_NOT_PROVIDER_CONFIRMED',
                            retryAfterSec: 2
                        });

                        if (outerIdempotencyOwner && outerIdempotencyKey) {
                            outerIdempotencyOwner = false;
                            await idempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                        }

                        logStructured('warn', 'confirmPayment bloqueado sem confirmação provider-backed', {
                            bookingId,
                            eventType: 'confirmPayment',
                            code: providerConfirmation.code,
                            references: paymentConfirmationReferences
                        });
                        return;
                    }
                }

                // ✅ NOVO: Salvar payment holding como "in_holding" para permitir startTrip
                try {
                    const paymentHoldingTimeoutMs = Number.parseInt(process.env.PAYMENT_HOLDING_TIMEOUT_MS || '2500', 10);

                    // Converter amount para centavos se necessário
                    const fareLockValidationEnabled =
                        data?.enforceFareLock === true ||
                        String(
                            process.env.ENFORCE_PAYMENT_FARE_LOCK ||
                            (process.env.NODE_ENV === 'test' ? 'false' : 'true')
                        ).toLowerCase() === 'true';
                    const estimatedFareInCents = Math.round(Number(bookingDataForPayment?.estimatedFare || 0) * 100);
                    const toleranceInCents = Math.max(
                        0,
                        Math.round(Number(process.env.PAYMENT_FARE_LOCK_TOLERANCE_REAIS || '0.01') * 100)
                    );

	                    if (
	                        fareLockValidationEnabled &&
	                        Number.isFinite(estimatedFareInCents) &&
	                        estimatedFareInCents > 0 &&
	                        Math.abs(amountInCents - estimatedFareInCents) > toleranceInCents
                    ) {
                        await auditService.logPaymentAction(userId, 'confirmPayment', bookingId || null, paymentId || null, {
                            error: 'Valor do pagamento diverge da tarifa travada',
                            amountInCents,
                            estimatedFareInCents,
                            toleranceInCents
                        }, false, 'Valor do pagamento divergente', metadata);

                        socket.emit('paymentError', {
                            error: 'Valor do pagamento divergente',
                            message: 'O valor do pagamento não corresponde à tarifa calculada para esta corrida',
                            code: 'PAYMENT_AMOUNT_MISMATCH',
                            amountInCents,
                            estimatedFareInCents
                        });
                        logStructured('warn', 'confirmPayment bloqueou divergencia entre pagamento e tarifa travada', {
                            bookingId,
                            eventType: 'confirmPayment',
                            amountInCents,
                            estimatedFareInCents,
                            toleranceInCents
                        });
                        if (outerIdempotencyOwner && outerIdempotencyKey) {
                            outerIdempotencyOwner = false;
                            await idempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                        }
	                        return;
	                    }

	                    const ledgerValidationEnabled =
	                        !paymentMockEnabled &&
	                        (
	                            data?.enforcePaymentLedger === true ||
	                            String(
	                                process.env.REQUIRE_PAYMENT_LEDGER_BEFORE_DISPATCH ||
	                                (process.env.NODE_ENV === 'test' ? 'false' : 'true')
	                            ).toLowerCase() === 'true'
	                        );

	                    if (ledgerValidationEnabled) {
	                        const paymentLedgerResult = await paymentService.storeConfirmedPayment({
	                            rideId: bookingId,
	                            chargeId: paymentId || chargeReference || '',
	                            amount: amountInCents,
	                            passengerId: bookingDataForPayment?.customerId || userId,
	                            metadata: {
	                                event: 'socket_confirmPayment',
	                                correlationID: data?.correlationId || data?.correlationID || null,
	                                source: 'socket_confirmPayment_provider_verified'
	                            }
	                        });

	                        if (!paymentLedgerResult.success || paymentLedgerResult.ledgerPosted !== true) {
	                            const ledgerError =
	                                paymentLedgerResult.ledgerError ||
	                                paymentLedgerResult.error ||
	                                'PAYMENT_LEDGER_NOT_POSTED';

	                            await auditService.logPaymentAction(userId, 'confirmPayment', bookingId || null, paymentId || chargeReference || null, {
	                                error: 'Pagamento confirmado sem ledger postado',
	                                ledgerStatus: paymentLedgerResult.ledgerStatus || 'pending_retry',
	                                ledgerError
	                            }, false, 'Pagamento sem ledger financeiro canônico', metadata);

	                            try {
	                                const paymentDispatchService = require('../services/payment-dispatch-service');
	                                await paymentDispatchService.markBookingPaymentConfirmed({
	                                    bookingId,
	                                    chargeId: paymentId || chargeReference || '',
	                                    temporaryRideId: data?.rideId || data?.temporaryRideId || '',
	                                    amountInCents,
	                                    paymentStatus: 'ledger_pending',
	                                    source: 'socket_confirmPayment_ledger_pending'
	                                });
	                            } catch (markLedgerPendingError) {
	                                logStructured('warn', 'confirmPayment: falha ao marcar ledger_pending', {
	                                    bookingId,
	                                    eventType: 'confirmPayment',
	                                    error: markLedgerPendingError.message
	                                });
	                            }

	                            socket.emit('paymentError', {
	                                error: 'Ledger financeiro pendente',
	                                message: 'Pagamento recebido, mas a trilha financeira ainda não foi registrada. A corrida não será despachada até a conciliação.',
	                                code: 'PAYMENT_LEDGER_PENDING',
	                                ledgerStatus: paymentLedgerResult.ledgerStatus || 'pending_retry',
	                                retryAfterSec: 3
	                            });

	                            logStructured('error', 'confirmPayment bloqueado porque payment_received ledger não foi postado', {
	                                bookingId,
	                                eventType: 'confirmPayment',
	                                ledgerStatus: paymentLedgerResult.ledgerStatus || 'pending_retry',
	                                ledgerError
	                            });

	                            if (outerIdempotencyOwner && outerIdempotencyKey) {
	                                outerIdempotencyOwner = false;
	                                await idempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
	                            }
	                            return;
	                        }
	                    }

	                    await Promise.race([
	                        paymentService.savePaymentHolding(bookingId, {
                            status: 'in_holding',
                            amount: amountInCents,
                            paymentMethod: paymentMethod,
                            paymentId: paymentId || `payment_${Date.now()}`,
                            chargeId: chargeReference || paymentId || null,
                            paidAt: new Date().toISOString(),
                            confirmedAt: new Date().toISOString(),
                            source: paymentMockEnabled ? 'socket_mock_payment' : 'socket_confirmPayment_provider_verified'
                        }),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('payment_holding_timeout')), paymentHoldingTimeoutMs))
                    ]);

                    logStructured('info', 'Payment holding salvo', {
                        bookingId,
                        eventType: 'confirmPayment'
                    });
                } catch (holdingError) {
                    logStructured('error', 'Erro ao salvar payment holding', {
                        bookingId,
                        eventType: 'confirmPayment',
                        error: holdingError.message
                    });
                    // Não bloquear confirmação se holding falhar
                }

                // Simular processamento do pagamento
                const paymentData = {
                    bookingId,
                    paymentMethod,
                    paymentId,
                    amount,
                    status: 'confirmed',
                    timestamp: new Date().toISOString()
                };

                const paymentDispatchService = require('../services/payment-dispatch-service');
                try {
                    await paymentDispatchService.markBookingPaymentConfirmed({
                        bookingId,
                        chargeId: paymentId || chargeReference || '',
                        temporaryRideId: data?.rideId || data?.temporaryRideId || '',
                        amountInCents,
                        paymentStatus: 'in_holding',
                        source: paymentMockEnabled ? 'socket_mock_payment' : 'socket_confirmPayment_provider_verified'
                    });
                } catch (markPaymentError) {
                    logStructured('warn', 'confirmPayment: falha ao marcar booking como pago', {
                        bookingId,
                        eventType: 'confirmPayment',
                        error: markPaymentError.message
                    });
                }

                try {
                    const { applyConfirmedRideExtension } = require('../services/ride-lifecycle-service');
                    const redis = redisPool.getConnection();
                    await applyConfirmedRideExtension({
                        redis,
                        bookingId,
                        chargeId: paymentId || chargeReference || '',
                        amountInCents,
                        io,
                        source: paymentMockEnabled ? 'socket_mock_payment' : 'socket_confirmPayment_provider_verified'
                    });
                } catch (extensionApplyError) {
                    logStructured('warn', 'confirmPayment: falha ao aplicar extensão confirmada', {
                        bookingId,
                        eventType: 'confirmPayment',
                        error: extensionApplyError.message
                    });
                }

                // Emitir confirmação
                socket.emit('paymentConfirmed', {
                    success: true,
                    bookingId,
                    message: 'Pagamento confirmado com sucesso',
                    data: paymentData
                });

                // Auditoria em background para não bloquear ACK de pagamento.
                setImmediate(async () => {
                    try {
                        const chargeId = paymentId || `payment_${Date.now()}`;
                        await auditService.logPaymentAction(userId, 'confirmPayment', bookingId, chargeId, {
                            paymentMethod,
                            amount,
                            amountInCents
                        }, true, null, metadata);
                    } catch (auditError) {
                        logStructured('warn', 'confirmPayment: falha ao gravar auditoria em background', {
                            bookingId,
                            eventType: 'confirmPayment',
                            error: auditError.message
                        });
                    }
                });

                // Disparar busca de motorista sem esperar o próximo tick para reduzir janela de corrida.
                paymentDispatchService.triggerDispatchAfterPayment({
                    bookingId,
                    io,
                    pickupLocation: pickupLocationToValidate,
                    source: paymentMockEnabled ? 'socket_mock_payment' : 'socket_confirmPayment_provider_verified',
                    force: true
                }).then((dispatchResult) => {
                    logStructured('info', 'confirmPayment: dispatch pós-pagamento processado', {
                        bookingId,
                        eventType: 'confirmPayment',
                        success: Boolean(dispatchResult?.success),
                        skipped: Boolean(dispatchResult?.skipped),
                        reason: dispatchResult?.reason || null,
                        attempts: dispatchResult?.attempts || 1
                    });
                }).catch((dispatchError) => {
                    logStructured('warn', 'confirmPayment: falha ao acionar dispatch pós-pagamento', {
                        bookingId,
                        eventType: 'confirmPayment',
                        error: dispatchError.message
                    });
                });

                const totalLatency = Date.now() - startTime;
                logStructured('info', 'confirmPayment concluído com sucesso', {
                    userId,
                    bookingId,
                    eventType: 'confirmPayment',
                    amount,
                    latency_ms: totalLatency
                });
                await idempotencyService.cacheResult(idempotencyKey, {
                    success: true,
                    bookingId,
                    message: 'Pagamento confirmado com sucesso',
                    data: paymentData
                });
                outerIdempotencyOwner = false;

                // ======================== TESTE AUTOMÁTICO ========================
                // Simular fluxo completo automaticamente após pagamento confirmado
                if (process.env.AUTO_TEST_MODE === 'true') {
                    logStructured('info', 'TESTE AUTOMÁTICO: Simulando fluxo completo', {
                        service: 'server',
                        bookingId,
                        mode: 'auto_test'
                    });

                    // Aguardar 1 segundo e simular motorista aceitando
                    setTimeout(() => {
                        logStructured('info', 'Simulando motorista aceitando corrida', {
                            service: 'server',
                            bookingId,
                            mode: 'auto_test'
                        });

                        // Emitir evento de corrida aceita para o cliente
                        socket.emit('rideAccepted', {
                            success: true,
                            bookingId,
                            message: 'Motorista aceitou sua corrida',
                            driverId: 'simulated_driver',
                            timestamp: new Date().toISOString()
                        });

                        // Aguardar 2 segundos e simular início da viagem
                        setTimeout(() => {
                            logStructured('info', 'Simulando início da viagem', {
                                service: 'server',
                                bookingId,
                                mode: 'auto_test'
                            });

                            socket.emit('tripStarted', {
                                success: true,
                                bookingId,
                                message: 'Viagem iniciada',
                                startLocation: { lat: -23.5505, lng: -46.6333 },
                                timestamp: new Date().toISOString()
                            });

                            // Aguardar 3 segundos e simular finalização
                            setTimeout(() => {
                                logStructured('info', 'Simulando finalização da viagem', {
                                    service: 'server',
                                    bookingId,
                                    mode: 'auto_test'
                                });

                                socket.emit('tripCompleted', {
                                    success: true,
                                    bookingId,
                                    message: 'Viagem finalizada',
                                    endLocation: { lat: -23.5615, lng: -46.6553 },
                                    distance: 5.2,
                                    fare: amount,
                                    timestamp: new Date().toISOString()
                                });

                                if (process.env.AUTO_TEST_MODE === 'true') {
                                    logStructured('info', 'TESTE AUTOMÁTICO COMPLETO', {
                                        service: 'server',
                                        bookingId,
                                        mode: 'auto_test'
                                    });
                                }

                            }, 3000);

                        }, 2000);

                    }, 1000);
                }

            } catch (error) {
                if (outerIdempotencyOwner && outerIdempotencyKey) {
                    outerIdempotencyOwner = false;
                    await idempotencyService.releaseInflight(outerIdempotencyKey).catch(() => null);
                }
                logStructured('error', 'Erro ao confirmar pagamento', {
                    userId: socket.userId || data?.customerId || socket.id,
                    eventType: 'confirmPayment',
                    error: error.message,
                    stack: error.stack
                });
                socket.emit('paymentError', { error: 'Erro ao processar pagamento' });
            }
        });
    });
}

module.exports = registerSocketConfirmPaymentHandler;
module.exports.__private = {
    AUTHORITATIVE_PAYMENT_RECORD_SOURCES,
    NON_AUTHORITATIVE_PAYMENT_STATUS_SOURCES,
    PAID_PAYMENT_STATUSES,
    collectPaymentReferences,
    isAuthoritativePaymentRecord,
    isAuthoritativeProviderStatus,
    isSocketMockPaymentAllowed,
    normalizePaymentAmountCents,
    resolveAuthoritativePaymentConfirmation,
    shouldRequireProviderPaymentConfirmation
};
