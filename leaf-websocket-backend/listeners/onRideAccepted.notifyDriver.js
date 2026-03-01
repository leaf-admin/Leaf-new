/**
 * LISTENER: onRideAccepted.notifyDriver
 * 
 * Notifica motorista quando corrida é aceita.
 */

const { logger, logStructured } = require('../utils/logger');
const traceContext = require('../utils/trace-context');
// ✅ FASE 1.3: OpenTelemetry
const { getTracer } = require('../utils/tracer');
const { createListenerSpan, runInSpan, endSpanSuccess, endSpanError } = require('../utils/span-helpers');
const { metrics } = require('../utils/prometheus-metrics');

/**
 * Notificar motorista via WebSocket
 */
async function notifyDriver(event, io) {
    const startTime = Date.now();
    const eventType = event.eventType || 'ride.accepted';
    // ✅ OBSERVABILIDADE: Extrair traceId do evento
    const traceId = event.data?.traceId || traceContext.getCurrentTraceId();
    return await traceContext.runWithTraceId(traceId, async () => {
        // ✅ FASE 1.3: Criar span para Listener (linkado ao evento)
        const tracer = getTracer();
        const eventSpanContext = event.data?._otelSpanContext;
        const listenerSpan = createListenerSpan(tracer, 'notify_driver', eventSpanContext, {
            'listener.booking_id': event.data?.bookingId
        });

        try {
            return await runInSpan(listenerSpan, async () => {
                const { driverId, bookingId, customerId } = event.data;

                metrics.recordListener('onRideAccepted.notifyDriver', (Date.now() - startTime) / 1000, true);


                metrics.recordEventConsumed(eventType, 'onRideAccepted.notifyDriver');


                logStructured('info', 'notifyDriver iniciado', {
                    driverId,
                    bookingId,
                    customerId,
                    listener: 'notifyDriver'
                });

                if (!driverId || !bookingId || !customerId) {
                    logger.warn('⚠️ [notifyDriver] Dados incompletos no evento');
                    return;
                }

                if (!io) {
                    logger.warn('⚠️ [notifyDriver] Socket.IO não disponível');
                    return;
                }

                // Emitir para o room do motorista
                io.to(`driver_${driverId}`).emit('rideAccepted', {
                    bookingId,
                    customerId,
                    message: 'Corrida aceita com sucesso!',
                    timestamp: new Date().toISOString()
                });

                logStructured('info', 'notifyDriver concluído', {
                    driverId,
                    bookingId,
                    listener: 'notifyDriver'
                });
            });
        } catch (error) {
            endSpanError(listenerSpan, error);
            logStructured('error', 'notifyDriver falhou', {
                driverId: event.data?.driverId,
                bookingId: event.data?.bookingId,
                listener: 'notifyDriver',
                error: error.message
            });
            metrics.recordListener('onRideAccepted.notifyDriver', (Date.now() - startTime) / 1000, false);
            throw error;
        }
    });
}

module.exports = notifyDriver;
