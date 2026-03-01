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

/**
 * Notificar motoristas próximos
 */
async function notifyDrivers(event, io) {
    const startTime = Date.now();
    const eventType = event.eventType || 'ride.requested';
    // ✅ OBSERVABILIDADE: Extrair traceId do evento
    const traceId = event.data?.traceId || traceContext.getCurrentTraceId();
    return await traceContext.runWithTraceId(traceId, async () => {
        // ✅ FASE 1.3: Criar span para Listener (linkado ao evento)
        const tracer = getTracer();
        const eventSpanContext = event.data?._otelSpanContext;
        const listenerSpan = createListenerSpan(tracer, 'notify_drivers', eventSpanContext, {
            'listener.booking_id': event.data?.bookingId
        });

        try {
            return await runInSpan(listenerSpan, async () => {
                const { bookingId, pickupLocation } = event.data;

                metrics.recordListener('onRideRequested.notifyDrivers', (Date.now() - startTime) / 1000, true);


                metrics.recordEventConsumed(eventType, 'onRideRequested.notifyDrivers');


                logStructured('info', 'notifyDrivers iniciado', {
                    bookingId,
                    listener: 'notifyDrivers'
                });

                if (!bookingId || !pickupLocation) {
                    logger.warn('⚠️ [notifyDrivers] Dados incompletos no evento');
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
                bookingId: event.data?.bookingId,
                listener: 'notifyDrivers',
                error: error.message
            });
            metrics.recordListener('onRideRequested.notifyDrivers', (Date.now() - startTime) / 1000, false);
            throw error;
        }
    });
}

module.exports = notifyDrivers;
