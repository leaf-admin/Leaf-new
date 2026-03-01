/**
 * LISTENER: onRideAccepted.notifyPassenger
 * 
 * Notifica passageiro quando corrida é aceita.
 */

const { logger, logStructured } = require('../utils/logger');
const traceContext = require('../utils/trace-context');
// ✅ FASE 1.3: OpenTelemetry
const { getTracer } = require('../utils/tracer');
const { createListenerSpan, runInSpan, endSpanSuccess, endSpanError } = require('../utils/span-helpers');
const { metrics } = require('../utils/prometheus-metrics');

/**
 * Notificar passageiro via WebSocket
 */
async function notifyPassenger(event, io) {
    const startTime = Date.now();
    const eventType = event.eventType || 'ride.accepted';
    // ✅ OBSERVABILIDADE: Extrair traceId do evento
    const traceId = event.data?.traceId || traceContext.getCurrentTraceId();
    return await traceContext.runWithTraceId(traceId, async () => {
        // ✅ FASE 1.3: Criar span para Listener (linkado ao evento)
        const tracer = getTracer();
        const { trace, context } = require('@opentelemetry/api');

        // ✅ Linkar span usando traceId do evento (não parent)
        const eventMetadata = event.data?.metadata || {};
        const eventTraceId = eventMetadata.traceId || event.data?._otelSpanContext?.traceId;
        const eventSpanId = eventMetadata.spanId || event.data?._otelSpanContext?.spanId;
        const correlationId = eventMetadata.correlationId || event.data?.bookingId || event.data?.rideId;

        // Criar link para o span do evento
        let links = [];
        if (eventTraceId && eventSpanId) {
            const { TraceFlags, TraceState } = require('@opentelemetry/api');
            links = [{
                context: {
                    traceId: eventTraceId,
                    spanId: eventSpanId,
                    traceFlags: TraceFlags.SAMPLED
                }
            }];
        }

        const listenerSpan = tracer.startSpan('listener.notify_passenger', {
            links: links,
            attributes: {
                'listener.name': 'notify_passenger',
                'listener.booking_id': event.data?.bookingId,
                ...(correlationId && { 'correlation.id': correlationId }) // ✅ Adicionar correlationId
            }
        });

        try {
            return await runInSpan(listenerSpan, async () => {
                const { customerId, bookingId, driverId } = event.data;

                // ✅ Logs correlacionados (correlationId + traceId)
                const { trace } = require('@opentelemetry/api');
                const activeSpan = trace.getActiveSpan();
                const currentTraceId = activeSpan?.spanContext().traceId;

                // ✅ MÉTRICAS: Registrar listener executado

                metrics.recordListener('onRideAccepted.notifyPassenger', (Date.now() - startTime) / 1000, true);


                metrics.recordEventConsumed(eventType, 'onRideAccepted.notifyPassenger');


                logStructured('info', 'notifyPassenger iniciado', {
                    customerId,
                    bookingId,
                    driverId,
                    listener: 'notifyPassenger',
                    correlationId, // ✅ Adicionar correlationId nos logs
                    traceId: currentTraceId // ✅ Adicionar traceId nos logs
                });

                if (!customerId || !bookingId || !driverId) {
                    logger.warn('⚠️ [notifyPassenger] Dados incompletos no evento');
                    return;
                }

                if (!io) {
                    logger.warn('⚠️ [notifyPassenger] Socket.IO não disponível');
                    return;
                }

                // Emitir para o room do passageiro
                io.to(`customer_${customerId}`).emit('rideAccepted', {
                    bookingId,
                    driverId,
                    message: 'Motorista aceitou sua corrida!',
                    timestamp: new Date().toISOString(),
                    traceId // ✅ Incluir traceId na emissão WebSocket
                });

                logStructured('info', 'notifyPassenger concluído', {
                    customerId,
                    bookingId,
                    listener: 'notifyPassenger'
                });
            });
        } catch (error) {
            endSpanError(listenerSpan, error);
            logStructured('error', 'notifyPassenger falhou', {
                customerId: event.data?.customerId,
                bookingId: event.data?.bookingId,
                listener: 'notifyPassenger',
                error: error.message
            });
            metrics.recordListener('onRideAccepted.notifyPassenger', (Date.now() - startTime) / 1000, false);
            throw error;
        }
    });
}

module.exports = notifyPassenger;
