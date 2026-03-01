/**
 * EVENTO: ride.started
 * 
 * Emitido quando uma viagem é iniciada.
 */

const { CanonicalEvent, EVENT_TYPES } = require('./index');
const { validateAndEnsureTraceIdInEvent } = require('../utils/trace-validator');

class RideStartedEvent extends CanonicalEvent {
    constructor(data) {
        // ✅ OBSERVABILIDADE: Incluir traceId e correlationId no evento
        const traceContext = require('../utils/trace-context');
        const { trace } = require('@opentelemetry/api');
        const activeSpan = trace.getActiveSpan();
        const spanContext = activeSpan?.spanContext();
        
        const validatedTraceId = validateAndEnsureTraceIdInEvent(data, EVENT_TYPES.RIDE_STARTED);
        
        const eventData = {
            ...data,
            traceId: validatedTraceId(data, EVENT_TYPES.RIDE_STARTED),
            correlationId: data.correlationId || data.bookingId // ✅ Adicionar correlationId
        };
        
        super(EVENT_TYPES.RIDE_STARTED, eventData);
        
        // ✅ CRÍTICO: Criar metadata com correlationId e traceId para serialização
        if (!this.data.metadata) {
            this.data.metadata = {};
        }
        this.data.metadata.correlationId = eventData.correlationId;
        this.data.metadata.traceId = spanContext?.traceId || validatedTraceId;
        this.data.metadata.spanId = spanContext?.spanId;
        
        this.validateRideStarted();
    }

    validateRideStarted() {
        const { bookingId, driverId, customerId, startLocation } = this.data;
        
        if (!bookingId) {
            throw new Error('RideStartedEvent: bookingId é obrigatório');
        }
        if (!driverId) {
            throw new Error('RideStartedEvent: driverId é obrigatório');
        }
        if (!customerId) {
            throw new Error('RideStartedEvent: customerId é obrigatório');
        }
        if (!startLocation || !startLocation.lat || !startLocation.lng) {
            throw new Error('RideStartedEvent: startLocation é obrigatório com lat e lng');
        }
    }
}

module.exports = RideStartedEvent;
