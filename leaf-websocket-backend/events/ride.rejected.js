/**
 * EVENTO: ride.rejected
 * 
 * Emitido quando um motorista rejeita uma corrida.
 */

const { CanonicalEvent, EVENT_TYPES } = require('./index');
const { validateAndEnsureTraceIdInEvent } = require('../utils/trace-validator');

class RideRejectedEvent extends CanonicalEvent {
    constructor(data) {
        // ✅ OBSERVABILIDADE: Incluir traceId e correlationId no evento
        const traceContext = require('../utils/trace-context');
        const { trace } = require('@opentelemetry/api');
        const activeSpan = trace.getActiveSpan();
        const spanContext = activeSpan?.spanContext();
        
        const validatedTraceId = validateAndEnsureTraceIdInEvent(data, EVENT_TYPES.RIDE_REJECTED);
        
        const eventData = {
            ...data,
            traceId: validatedTraceId,
            correlationId: data.correlationId || data.bookingId // ✅ Adicionar correlationId
        };
        
        super(EVENT_TYPES.RIDE_REJECTED, eventData);
        
        // ✅ CRÍTICO: Criar metadata com correlationId e traceId para serialização
        if (!this.data.metadata) {
            this.data.metadata = {};
        }
        this.data.metadata.correlationId = eventData.correlationId;
        this.data.metadata.traceId = spanContext?.traceId || validatedTraceId;
        this.data.metadata.spanId = spanContext?.spanId;
        
        this.validateRideRejected();
    }

    validateRideRejected() {
        const { bookingId, driverId, reason } = this.data;
        
        if (!bookingId) {
            throw new Error('RideRejectedEvent: bookingId é obrigatório');
        }
        if (!driverId) {
            throw new Error('RideRejectedEvent: driverId é obrigatório');
        }
        // reason é opcional
    }
}

module.exports = RideRejectedEvent;
