/**
 * EVENTO: ride.requested
 * 
 * Emitido quando um passageiro solicita uma corrida.
 */

const { CanonicalEvent, EVENT_TYPES } = require('./index');
const { validateAndEnsureTraceIdInEvent } = require('../utils/trace-validator');

class RideRequestedEvent extends CanonicalEvent {
    constructor(data) {
        // ✅ OBSERVABILIDADE: Incluir traceId e correlationId no evento
        const traceContext = require('../utils/trace-context');
        const { trace } = require('@opentelemetry/api');
        const activeSpan = trace.getActiveSpan();
        const spanContext = activeSpan?.spanContext();
        
        // ✅ VALIDAÇÃO: Garantir traceId válido
        const validatedTraceId = validateAndEnsureTraceIdInEvent(data, EVENT_TYPES.RIDE_REQUESTED);
        
        const eventData = {
            ...data,
            traceId: validatedTraceId,
            correlationId: data.correlationId || data.bookingId // ✅ Adicionar correlationId
        };
        
        super(EVENT_TYPES.RIDE_REQUESTED, eventData);
        
        // ✅ CRÍTICO: Criar metadata com correlationId e traceId para serialização
        if (!this.data.metadata) {
            this.data.metadata = {};
        }
        this.data.metadata.correlationId = eventData.correlationId;
        this.data.metadata.traceId = spanContext?.traceId || validatedTraceId;
        this.data.metadata.spanId = spanContext?.spanId;
        
        this.validateRideRequested();
    }

    validateRideRequested() {
        const { bookingId, customerId, pickupLocation, destinationLocation, estimatedFare, paymentMethod } = this.data;
        
        if (!bookingId) {
            throw new Error('RideRequestedEvent: bookingId é obrigatório');
        }
        if (!customerId) {
            throw new Error('RideRequestedEvent: customerId é obrigatório');
        }
        if (!pickupLocation || !pickupLocation.lat || !pickupLocation.lng) {
            throw new Error('RideRequestedEvent: pickupLocation é obrigatório com lat e lng');
        }
        if (!destinationLocation || !destinationLocation.lat || !destinationLocation.lng) {
            throw new Error('RideRequestedEvent: destinationLocation é obrigatório com lat e lng');
        }
        if (estimatedFare === undefined || estimatedFare === null) {
            throw new Error('RideRequestedEvent: estimatedFare é obrigatório');
        }
        if (!paymentMethod) {
            throw new Error('RideRequestedEvent: paymentMethod é obrigatório');
        }
    }
}

module.exports = RideRequestedEvent;
