/**
 * EVENTO: ride.accepted
 * 
 * Emitido quando um motorista aceita uma corrida.
 */

const { CanonicalEvent, EVENT_TYPES } = require('./index');
const { validateAndEnsureTraceIdInEvent } = require('../utils/trace-validator');

class RideAcceptedEvent extends CanonicalEvent {
    constructor(data) {
        // ✅ OBSERVABILIDADE: Incluir traceId e correlationId no evento
        const traceContext = require('../utils/trace-context');
        const { trace } = require('@opentelemetry/api');
        const activeSpan = trace.getActiveSpan();
        const spanContext = activeSpan?.spanContext();

        const validatedTraceId = validateAndEnsureTraceIdInEvent(data, EVENT_TYPES.RIDE_ACCEPTED);

        const eventData = {
            ...data,
            traceId: validatedTraceId,
            correlationId: data.correlationId || data.bookingId // ✅ Adicionar correlationId
        };

        super(EVENT_TYPES.RIDE_ACCEPTED, eventData);

        // ✅ CRÍTICO: Criar metadata com correlationId e traceId para serialização
        if (!this.data.metadata) {
            this.data.metadata = {};
        }
        this.data.metadata.correlationId = eventData.correlationId;
        this.data.metadata.traceId = spanContext?.traceId || validatedTraceId;
        this.data.metadata.spanId = spanContext?.spanId;

        this.validateRideAccepted();
    }

    validateRideAccepted() {
        const { bookingId, driverId, customerId } = this.data;

        if (!bookingId) {
            throw new Error('RideAcceptedEvent: bookingId é obrigatório');
        }
        if (!driverId) {
            throw new Error('RideAcceptedEvent: driverId é obrigatório');
        }
        if (!customerId) {
            throw new Error('RideAcceptedEvent: customerId é obrigatório');
        }
    }
}

module.exports = RideAcceptedEvent;
