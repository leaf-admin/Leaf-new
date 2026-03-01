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

/**
 * Enviar notificação push
 */
async function sendPush(event, io) {
    const startTime = Date.now();
    const eventType = event.eventType || 'ride.accepted';
    // ✅ OBSERVABILIDADE: Extrair traceId do evento
    const traceId = event.data?.traceId || traceContext.getCurrentTraceId();
    return await traceContext.runWithTraceId(traceId, async () => {
        // ✅ FASE 1.3: Criar span para Listener (linkado ao evento)
        const tracer = getTracer();
        const eventSpanContext = event.data?._otelSpanContext;
        const listenerSpan = createListenerSpan(tracer, 'send_push', eventSpanContext, {
            'listener.booking_id': event.data?.bookingId
        });

        try {
            return await runInSpan(listenerSpan, async () => {
                const { customerId, bookingId, driverId } = event.data;

                metrics.recordListener('onRideAccepted.sendPush', (Date.now() - startTime) / 1000, true);


                metrics.recordEventConsumed(eventType, 'onRideAccepted.sendPush');


                logStructured('info', 'sendPush iniciado', {
                    customerId,
                    bookingId,
                    driverId,
                    listener: 'sendPush'
                });

                if (!customerId || !bookingId || !driverId) {
                    logger.warn('⚠️ [sendPush] Dados incompletos no evento');
                    return;
                }

                const FCMService = require('../services/fcm-service');
                const fcmService = new FCMService();

                if (!fcmService.isServiceAvailable()) {
                    await fcmService.initialize();
                }

                // Buscar token FCM do passageiro
                const redisPool = require('../utils/redis-pool');
                await redisPool.ensureConnection();
                const redis = redisPool.getConnection();

                const fcmToken = await redis.hget(`user:${customerId}`, 'fcmToken');

                if (fcmToken) {
                    await fcmService.sendNotificationToUser(
                        customerId,
                        'customer',
                        'Corrida Aceita!',
                        'Um motorista aceitou sua corrida. Em breve ele estará a caminho.',
                        {
                            type: 'RIDE_ACCEPTED',
                            bookingId,
                            driverId
                        }
                    );

                    logStructured('info', 'sendPush concluído', {
                        customerId,
                        bookingId,
                        listener: 'sendPush'
                    });
                } else {
                    logStructured('warn', 'Token FCM não encontrado', {
                        customerId,
                        bookingId,
                        listener: 'sendPush'
                    });
                }
            });
        } catch (error) {
            endSpanError(listenerSpan, error);
            logStructured('error', 'sendPush falhou', {
                customerId: event.data?.customerId,
                bookingId: event.data?.bookingId,
                listener: 'sendPush',
                error: error.message
            });
            metrics.recordListener('onRideAccepted.sendPush', (Date.now() - startTime) / 1000, false);
            throw error;
        }
    });
}

module.exports = sendPush;
