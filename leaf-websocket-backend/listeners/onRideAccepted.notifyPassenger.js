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

function normalizeAcceptedPayload(event) {
    const rawData = event?.data && typeof event.data === 'object' ? event.data : {};
    const nestedData = rawData?.data && typeof rawData.data === 'object' ? rawData.data : null;
    const payload = (rawData?.bookingId || rawData?.customerId || rawData?.driverId)
        ? rawData
        : (nestedData || rawData);

    const metadata = payload?.metadata && typeof payload.metadata === 'object'
        ? payload.metadata
        : (rawData?.metadata && typeof rawData.metadata === 'object' ? rawData.metadata : {});

    return {
        payload,
        metadata,
        traceId: payload?.traceId || metadata?.traceId || rawData?.traceId || null,
        spanContext: payload?._otelSpanContext || rawData?._otelSpanContext || null
    };
}

function passengerSocketAlreadyDelivered(metadata) {
    return Boolean(metadata?.socketDelivery?.passengerRideAcceptedEmitted);
}

/**
 * Notificar passageiro via WebSocket
 */
async function notifyPassenger(event, io) {
    const startTime = Date.now();
    const eventType = event.eventType || 'ride.accepted';
    const normalized = normalizeAcceptedPayload(event);
    const payload = normalized.payload || {};
    // ✅ OBSERVABILIDADE: Extrair traceId do evento
    const traceId = normalized.traceId || traceContext.getCurrentTraceId();
    return await traceContext.runWithTraceId(traceId, async () => {
        // ✅ FASE 1.3: Criar span para Listener (linkado ao evento)
        const tracer = getTracer();
        const { trace, context } = require('@opentelemetry/api');

        // ✅ Linkar span usando traceId do evento (não parent)
        const eventMetadata = normalized.metadata || {};
        const eventTraceId = eventMetadata.traceId || normalized.spanContext?.traceId;
        const eventSpanId = eventMetadata.spanId || normalized.spanContext?.spanId;
        const correlationId = eventMetadata.correlationId || payload?.bookingId || payload?.rideId;

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
                'listener.booking_id': payload?.bookingId,
                ...(correlationId && { 'correlation.id': correlationId }) // ✅ Adicionar correlationId
            }
        });

        try {
            return await runInSpan(listenerSpan, async () => {
                const { customerId, bookingId, driverId } = payload;

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
                    logStructured('debug', 'notifyPassenger ignorou evento incompleto', {
                        listener: 'notifyPassenger',
                        eventType,
                        hasCustomerId: Boolean(customerId),
                        hasBookingId: Boolean(bookingId),
                        hasDriverId: Boolean(driverId)
                    });
                    return;
                }

                if (!io) {
                    logger.warn('⚠️ [notifyPassenger] Socket.IO não disponível');
                    return;
                }

                if (passengerSocketAlreadyDelivered(normalized.metadata)) {
                    logStructured('debug', 'notifyPassenger pulou emissão duplicada', {
                        customerId,
                        bookingId,
                        listener: 'notifyPassenger',
                        reason: 'passenger_socket_already_emitted'
                    });
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
                customerId: payload?.customerId,
                bookingId: payload?.bookingId,
                listener: 'notifyPassenger',
                error: error.message
            });
            metrics.recordListener('onRideAccepted.notifyPassenger', (Date.now() - startTime) / 1000, false);
            throw error;
        }
    });
}

module.exports = notifyPassenger;
