/**
 * LISTENER: onRideStarted.startTripTimer
 * 
 * Inicia timer de viagem quando corrida é iniciada.
 */

const { logger, logStructured } = require('../utils/logger');
const traceContext = require('../utils/trace-context');
// ✅ FASE 1.3: OpenTelemetry
const { getTracer } = require('../utils/tracer');
const { createListenerSpan, runInSpan, endSpanSuccess, endSpanError } = require('../utils/span-helpers');
const { metrics } = require('../utils/prometheus-metrics');

function normalizeStartedPayload(event) {
    const rawData = event?.data && typeof event.data === 'object' ? event.data : {};
    const nestedData = rawData?.data && typeof rawData.data === 'object' ? rawData.data : null;
    const payload = (rawData?.bookingId || rawData?.customerId || rawData?.driverId)
        ? rawData
        : (nestedData || rawData);

    return {
        payload,
        traceId: payload?.traceId || rawData?.traceId || null,
        spanContext: payload?._otelSpanContext || rawData?._otelSpanContext || null
    };
}

/**
 * Iniciar timer de viagem
 */
async function startTripTimer(event, io) {
    const startTime = Date.now();
    const eventType = event.eventType || 'ride.started';
    const normalized = normalizeStartedPayload(event);
    const payload = normalized.payload || {};
    // ✅ OBSERVABILIDADE: Extrair traceId do evento
    const traceId = normalized.traceId || traceContext.getCurrentTraceId();
    return await traceContext.runWithTraceId(traceId, async () => {
        // ✅ FASE 1.3: Criar span para Listener (linkado ao evento)
        const tracer = getTracer();
        const eventSpanContext = normalized.spanContext;
        const listenerSpan = createListenerSpan(tracer, 'start_trip_timer', eventSpanContext, {
            'listener.booking_id': payload?.bookingId
        });

        try {
            return await runInSpan(listenerSpan, async () => {
                const { bookingId, driverId, customerId } = payload;

                metrics.recordListener('onRideStarted.startTripTimer', (Date.now() - startTime) / 1000, true);


                metrics.recordEventConsumed(eventType, 'onRideStarted.startTripTimer');


                logStructured('info', 'startTripTimer iniciado', {
                    bookingId,
                    driverId,
                    customerId,
                    listener: 'startTripTimer'
                });

                if (!bookingId || !driverId || !customerId) {
                    logStructured('debug', 'startTripTimer ignorou evento incompleto', {
                        listener: 'startTripTimer',
                        eventType,
                        hasBookingId: Boolean(bookingId),
                        hasDriverId: Boolean(driverId),
                        hasCustomerId: Boolean(customerId)
                    });
                    return;
                }

                // Salvar timestamp de início no Redis
                const redisPool = require('../utils/redis-pool');
                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();

                const timerKey = `trip_timer:${bookingId}`;
                await redis.hset(timerKey, {
                    bookingId,
                    driverId,
                    customerId,
                    startedAt: new Date().toISOString(),
                    startTimestamp: Date.now()
                });

                // TTL de 2 horas (viagem máxima)
                await redis.expire(timerKey, 7200);

                logStructured('info', 'startTripTimer concluído', {
                    bookingId,
                    listener: 'startTripTimer'
                });
            });
        } catch (error) {
            endSpanError(listenerSpan, error);
            logStructured('error', 'startTripTimer falhou', {
                bookingId: payload?.bookingId,
                listener: 'startTripTimer',
                error: error.message
            });
            metrics.recordListener('onRideStarted.startTripTimer', (Date.now() - startTime) / 1000, false);
            throw error;
        }
    });
}

module.exports = startTripTimer;
