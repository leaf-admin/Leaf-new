/**
 * LISTENER: onRideAccepted.sendPush
 * 
 * Envia notificação push quando corrida é aceita.
 */

const { logger, logStructured } = require('../utils/logger');
const traceContext = require('../utils/trace-context');
// ✅ FASE 1.3: OpenTelemetry
const { getTracer } = require('../utils/tracer');
const { createListenerSpan, runInSpan, endSpanSuccess, endSpanError } = require('../utils/span-helpers');
const { metrics } = require('../utils/prometheus-metrics');

function normalizeAcceptedPayload(event) {
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
 * Enviar notificação push
 */
async function sendPush(event, io) {
    const startTime = Date.now();
    const eventType = event.eventType || 'ride.accepted';
    const normalized = normalizeAcceptedPayload(event);
    const payload = normalized.payload || {};
    // ✅ OBSERVABILIDADE: Extrair traceId do evento
    const traceId = normalized.traceId || traceContext.getCurrentTraceId();
    return await traceContext.runWithTraceId(traceId, async () => {
        // ✅ FASE 1.3: Criar span para Listener (linkado ao evento)
        const tracer = getTracer();
        const eventSpanContext = normalized.spanContext;
        const listenerSpan = createListenerSpan(tracer, 'send_push', eventSpanContext, {
            'listener.booking_id': payload?.bookingId
        });

        try {
            return await runInSpan(listenerSpan, async () => {
                const { customerId, bookingId, driverId } = payload;

                metrics.recordListener('onRideAccepted.sendPush', (Date.now() - startTime) / 1000, true);


                metrics.recordEventConsumed(eventType, 'onRideAccepted.sendPush');


                logStructured('info', 'sendPush iniciado', {
                    customerId,
                    bookingId,
                    driverId,
                    listener: 'sendPush'
                });

                if (!customerId || !bookingId || !driverId) {
                    logStructured('debug', 'sendPush ignorou evento incompleto', {
                        listener: 'sendPush',
                        eventType,
                        hasCustomerId: Boolean(customerId),
                        hasBookingId: Boolean(bookingId),
                        hasDriverId: Boolean(driverId)
                    });
                    return;
                }

                const FCMService = require('../services/fcm-service');
                const fcmService = new FCMService();

                if (!fcmService.isServiceAvailable()) {
                    await fcmService.initialize();
                }

                const redisPool = require('../utils/redis-pool');
                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();
                fcmService.setRedis(redis);

                const notification = {
                    title: 'Corrida Aceita!',
                    body: 'Um motorista aceitou sua corrida. Em breve ele estará a caminho.',
                    data: {
                        type: 'RIDE_ACCEPTED',
                        bookingId: String(bookingId),
                        driverId: String(driverId)
                    },
                    channelId: 'trip_updates',
                    badge: 1
                };

                const pushResult = await fcmService.sendNotificationToUser(customerId, notification);

                if (pushResult.success) {
                    logStructured('info', 'sendPush concluído', {
                        customerId,
                        bookingId,
                        delivered: pushResult.summary?.success || 1,
                        listener: 'sendPush'
                    });
                } else {
                    logStructured('debug', 'sendPush sem entrega (token ausente ou serviço indisponível)', {
                        customerId,
                        bookingId,
                        reason: pushResult.error || 'unknown',
                        listener: 'sendPush'
                    });
                }
            });
        } catch (error) {
            endSpanError(listenerSpan, error);
            logStructured('error', 'sendPush falhou', {
                customerId: payload?.customerId,
                bookingId: payload?.bookingId,
                listener: 'sendPush',
                error: error.message
            });
            metrics.recordListener('onRideAccepted.sendPush', (Date.now() - startTime) / 1000, false);
            throw error;
        }
    });
}

module.exports = sendPush;
