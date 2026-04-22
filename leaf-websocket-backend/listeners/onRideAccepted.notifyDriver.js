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
const redisPool = require('../utils/redis-pool');
const PaymentService = require('../services/payment-service');
const { resolveAcceptRidePayload } = require('../utils/accept-ride-payload');

const paymentService = new PaymentService();

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
        traceId: payload?.traceId || rawData?.traceId || null,
        spanContext: payload?._otelSpanContext || rawData?._otelSpanContext || null
    };
}

function driverSocketAlreadyDelivered(metadata) {
    return Boolean(metadata?.socketDelivery?.driverRideAcceptedEmitted);
}

/**
 * Notificar motorista via WebSocket
 */
async function notifyDriver(event, io) {
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
        const listenerSpan = createListenerSpan(tracer, 'notify_driver', eventSpanContext, {
            'listener.booking_id': payload?.bookingId
        });

        try {
            return await runInSpan(listenerSpan, async () => {
                const { driverId, bookingId, customerId } = payload;

                metrics.recordListener('onRideAccepted.notifyDriver', (Date.now() - startTime) / 1000, true);


                metrics.recordEventConsumed(eventType, 'onRideAccepted.notifyDriver');


                logStructured('info', 'notifyDriver iniciado', {
                    driverId,
                    bookingId,
                    customerId,
                    listener: 'notifyDriver'
                });

                if (!driverId || !bookingId || !customerId) {
                    logStructured('debug', 'notifyDriver ignorou evento incompleto', {
                        listener: 'notifyDriver',
                        eventType,
                        hasDriverId: Boolean(driverId),
                        hasBookingId: Boolean(bookingId),
                        hasCustomerId: Boolean(customerId)
                    });
                    return;
                }

                if (!io) {
                    logger.warn('⚠️ [notifyDriver] Socket.IO não disponível');
                    return;
                }

                if (driverSocketAlreadyDelivered(normalized.metadata)) {
                    logStructured('debug', 'notifyDriver pulou emissão duplicada', {
                        driverId,
                        bookingId,
                        listener: 'notifyDriver',
                        reason: 'driver_socket_already_emitted'
                    });
                    return;
                }

                const redis = redisPool.getConnection();
                const acceptRidePayload = await resolveAcceptRidePayload(redis, bookingId, payload);

                let estimatedBreakdown = null;
                if (Number.isFinite(acceptRidePayload.estimatedFare) && acceptRidePayload.estimatedFare >= 0) {
                    estimatedBreakdown = paymentService.calculateFareBreakdownFromReais(acceptRidePayload.estimatedFare, 0);
                }

                // Emitir para o room do motorista
                io.to(`driver_${driverId}`).emit('rideAccepted', {
                    bookingId,
                    customerId,
                    message: 'Corrida aceita com sucesso!',
                    timestamp: new Date().toISOString(),
                    pickupLocation: acceptRidePayload.pickupLocation || null,
                    destinationLocation: acceptRidePayload.destinationLocation || null,
                    estimatedFare: Number.isFinite(acceptRidePayload.estimatedFare)
                        ? acceptRidePayload.estimatedFare
                        : null,
                    driverDistanceToPickupKm: Number.isFinite(acceptRidePayload.driverDistanceToPickupKm)
                        ? acceptRidePayload.driverDistanceToPickupKm
                        : null,
                    estimatedArrivalToPickupMin: Number.isFinite(acceptRidePayload.estimatedArrivalToPickupMin)
                        ? acceptRidePayload.estimatedArrivalToPickupMin
                        : null,
                    ...(estimatedBreakdown ? {
                        estimatedOperationalFee: estimatedBreakdown.operationalFee,
                        estimatedPaymentIntermediationFee: estimatedBreakdown.paymentIntermediationFee,
                        estimatedTotalFees: estimatedBreakdown.totalFees,
                        estimatedDriverNetAmount: estimatedBreakdown.driverNetAmount
                    } : {})
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
                driverId: payload?.driverId,
                bookingId: payload?.bookingId,
                listener: 'notifyDriver',
                error: error.message
            });
            metrics.recordListener('onRideAccepted.notifyDriver', (Date.now() - startTime) / 1000, false);
            throw error;
        }
    });
}

module.exports = notifyDriver;
