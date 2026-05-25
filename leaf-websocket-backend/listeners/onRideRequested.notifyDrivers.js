/**
 * LISTENER: onRideRequested.notifyDrivers
 * 
 * Notifica motoristas quando uma nova corrida é solicitada.
 */

const { logger, logStructured } = require('../utils/logger');
const traceContext = require('../utils/trace-context');
const GradualRadiusExpander = require('../services/gradual-radius-expander');
// ✅ FASE 1.3: OpenTelemetry
const { getTracer } = require('../utils/tracer');
const { createListenerSpan, runInSpan, endSpanSuccess, endSpanError } = require('../utils/span-helpers');
const { metrics } = require('../utils/prometheus-metrics');
const idempotencyService = require('../services/idempotency-service');
const RideStateManager = require('../services/ride-state-manager');
const RIDE_REQUESTED_MAX_AGE_MS = Number.parseInt(
    process.env.RIDE_REQUESTED_MAX_AGE_MS || '120000',
    10
);

function parseTimestampMs(rawValue) {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        return rawValue;
    }

    if (typeof rawValue === 'string' && rawValue.trim()) {
        const numeric = Number(rawValue);
        if (Number.isFinite(numeric)) {
            return numeric;
        }
        const parsed = Date.parse(rawValue);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }

    return null;
}

function normalizeRideRequestedEvent(event) {
    const rawDataInput = event?.data;
    let rawData = {};

    if (rawDataInput && typeof rawDataInput === 'object') {
        rawData = rawDataInput;
    } else if (typeof rawDataInput === 'string') {
        try {
            const parsed = JSON.parse(rawDataInput);
            rawData = parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_error) {
            rawData = {};
        }
    }

    const nestedData = rawData?.data && typeof rawData.data === 'object' ? rawData.data : null;
    const payload = (rawData?.bookingId || rawData?.pickupLocation) ? rawData : (nestedData || rawData);
    const metadata = payload?.metadata && typeof payload.metadata === 'object' ? payload.metadata : {};

    return {
        payload,
        eventId: event?.eventId || rawData?.eventId || payload?.eventId || null,
        bookingId: event?.bookingId || payload?.bookingId || rawData?.bookingId || metadata?.bookingId || null,
        pickupLocation: payload?.pickupLocation || rawData?.pickupLocation || null,
        skipDriverNotify: payload?.skipDriverNotify === true
            || rawData?.skipDriverNotify === true
            || metadata?.skipDriverNotify === true,
        traceId: payload?.traceId || metadata?.traceId || rawData?.traceId || null,
        otelSpanContext: payload?._otelSpanContext || rawData?._otelSpanContext || null,
        timestampMs: parseTimestampMs(
            event?.timestamp
            || event?.occurredAt
            || payload?.occurredAt
            || payload?.timestamp
            || rawData?.occurredAt
            || rawData?.timestamp
        )
    };
}

/**
 * Notificar motoristas próximos
 */
async function notifyDrivers(event, io) {
    const startTime = Date.now();
    const eventType = event.eventType || 'ride.requested';
    const normalizedEvent = normalizeRideRequestedEvent(event);
    // ✅ OBSERVABILIDADE: Extrair traceId do evento
    const traceId = normalizedEvent.traceId || traceContext.getCurrentTraceId();
    return await traceContext.runWithTraceId(traceId, async () => {
        // ✅ FASE 1.3: Criar span para Listener (linkado ao evento)
        const tracer = getTracer();
        const eventSpanContext = normalizedEvent.otelSpanContext;
        const listenerSpan = createListenerSpan(tracer, 'notify_drivers', eventSpanContext, {
            'listener.booking_id': normalizedEvent.bookingId
        });

        try {
            return await runInSpan(listenerSpan, async () => {
                const { bookingId, pickupLocation } = normalizedEvent;

                metrics.recordListener('onRideRequested.notifyDrivers', (Date.now() - startTime) / 1000, true);


                metrics.recordEventConsumed(eventType, 'onRideRequested.notifyDrivers');


                if (!bookingId || !pickupLocation) {
                    logStructured('debug', 'notifyDrivers ignorou evento incompleto', {
                        listener: 'notifyDrivers',
                        eventType,
                        eventId: normalizedEvent.eventId || null,
                        hasBookingId: Boolean(bookingId),
                        hasPickupLocation: Boolean(pickupLocation)
                    });
                    return;
                }

                if (normalizedEvent.skipDriverNotify === true) {
                    logger.info(`ℹ️ [notifyDrivers] Skip de notificação de motoristas para ${bookingId} (dispatch dedicado)`);
                    return;
                }

                const eventTimestamp = normalizedEvent.timestampMs;
                const now = Date.now();

                if (Number.isFinite(eventTimestamp) && (now - eventTimestamp > RIDE_REQUESTED_MAX_AGE_MS)) {
                    logger.warn(`⚠️ [notifyDrivers] Evento RIDE_REQUESTED muito antigo (${Math.round((now - eventTimestamp) / 1000)}s). Descartando evento fantasma de stream DLQ/XCLAIM.`, { bookingId });
                    return;
                }

                // Proteção de Idempotência: só processar uma notificação de busca por bookingId
                const idempotencyKey = idempotencyService.generateKey('system', 'notify.drivers', bookingId);
                const idempotencyCheck = await idempotencyService.checkAndSet(idempotencyKey, 3600); // Lock 1 hora

                if (!idempotencyCheck.isNew) {
                    logStructured('debug', 'notifyDrivers ignorou evento duplicado por idempotência', {
                        listener: 'notifyDrivers',
                        bookingId,
                        eventType
                    });
                    return;
                }

                logStructured('info', 'notifyDrivers iniciado', {
                    bookingId,
                    listener: 'notifyDrivers'
                });

                // Verificar se a corrida não foi aceita antes de iniciar (caso seja um replay logo após aceitarem)
                const redisPool = require('../utils/redis-pool');
                const redis = redisPool.getConnection();
                const currentState = await RideStateManager.getBookingState(redis, bookingId);
                if (currentState && currentState !== RideStateManager.STATES.SEARCHING && currentState !== RideStateManager.STATES.PENDING) {
                    logger.warn(`⚠️ [notifyDrivers] Corrida ${bookingId} não está mais aguardando motoristas (state: ${currentState}). Abortando busca inicial.`, { bookingId });
                    return;
                }

                if (!io) {
                    logger.warn('⚠️ [notifyDrivers] Socket.IO não disponível');
                    return;
                }

                // Usar GradualRadiusExpander para busca progressiva
                const expander = new GradualRadiusExpander(io);

                // Iniciar busca gradual (começa em 0.5km e expande até 3km)
                await expander.startGradualSearch(bookingId, pickupLocation);

                logStructured('info', 'notifyDrivers concluiu inicialização da busca gradual', {
                    bookingId,
                    listener: 'notifyDrivers'
                });
            });
        } catch (error) {
            endSpanError(listenerSpan, error);
            logStructured('error', 'notifyDrivers falhou', {
                bookingId: normalizedEvent.bookingId,
                listener: 'notifyDrivers',
                error: error.message
            });
            metrics.recordListener('onRideRequested.notifyDrivers', (Date.now() - startTime) / 1000, false);
            throw error;
        }
    });
}

module.exports = notifyDrivers;
