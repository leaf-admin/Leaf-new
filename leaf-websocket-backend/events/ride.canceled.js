/**
 * EVENTO: ride.canceled
 * 
 * Emitido quando uma corrida é cancelada (por passageiro ou motorista).
 */

const { CanonicalEvent, EVENT_TYPES } = require('./index');
const { validateAndEnsureTraceIdInEvent } = require('../utils/trace-validator');

class RideCanceledEvent extends CanonicalEvent {
    constructor(data) {
        // ✅ OBSERVABILIDADE: Incluir traceId e correlationId no evento
        const traceContext = require('../utils/trace-context');
        const { trace } = require('@opentelemetry/api');
        const activeSpan = trace.getActiveSpan();
        const spanContext = activeSpan?.spanContext();
        
        const validatedTraceId = validateAndEnsureTraceIdInEvent(data, EVENT_TYPES.RIDE_CANCELED);
        
        const eventData = {
            ...data,
            traceId: validatedTraceId(data, EVENT_TYPES.RIDE_CANCELED),
            correlationId: data.correlationId || data.bookingId // ✅ Adicionar correlationId
        };
        
        super(EVENT_TYPES.RIDE_CANCELED, eventData);
        
        // ✅ CRÍTICO: Criar metadata com correlationId e traceId para serialização
        if (!this.data.metadata) {
            this.data.metadata = {};
        }
        this.data.metadata.correlationId = eventData.correlationId;
        this.data.metadata.traceId = spanContext?.traceId || validatedTraceId;
        this.data.metadata.spanId = spanContext?.spanId;
        
        this.validateRideCanceled();
    }

    validateRideCanceled() {
        const { bookingId, canceledBy, reason, cancellationFee } = this.data;
        
        if (!bookingId) {
            throw new Error('RideCanceledEvent: bookingId é obrigatório');
        }
        if (!canceledBy) {
            throw new Error('RideCanceledEvent: canceledBy é obrigatório');
        }
        // reason e cancellationFee são opcionais
    }
}

module.exports = RideCanceledEvent;
