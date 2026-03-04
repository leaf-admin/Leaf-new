/**
 * EVENTO: ride.completed
 * 
 * Emitido quando uma viagem é finalizada.
 */

const { CanonicalEvent, EVENT_TYPES } = require('./index');
const { validateAndEnsureTraceIdInEvent } = require('../utils/trace-validator');

class RideCompletedEvent extends CanonicalEvent {
    constructor(data) {
        // ✅ OBSERVABILIDADE: Incluir traceId e correlationId no evento
        const traceContext = require('../utils/trace-context');
        const { trace } = require('@opentelemetry/api');
        const activeSpan = trace.getActiveSpan();
        const spanContext = activeSpan?.spanContext();

        const validatedTraceId = validateAndEnsureTraceIdInEvent(data, EVENT_TYPES.RIDE_COMPLETED);

        const eventData = {
            ...data,
            traceId: validatedTraceId,
            correlationId: data.correlationId || data.bookingId // ✅ Adicionar correlationId
        };

        super(EVENT_TYPES.RIDE_COMPLETED, eventData);

        // ✅ CRÍTICO: Criar metadata com correlationId e traceId para serialização
        if (!this.data.metadata) {
            this.data.metadata = {};
        }
        this.data.metadata.correlationId = eventData.correlationId;
        this.data.metadata.traceId = spanContext?.traceId || validatedTraceId;
        this.data.metadata.spanId = spanContext?.spanId;

        this.validateRideCompleted();
    }

    validateRideCompleted() {
        const { bookingId, driverId, customerId, endLocation, finalFare, tollFee, distance, duration } = this.data;

        if (!bookingId) {
            throw new Error('RideCompletedEvent: bookingId é obrigatório');
        }
        if (!driverId) {
            throw new Error('RideCompletedEvent: driverId é obrigatório');
        }
        if (!customerId) {
            throw new Error('RideCompletedEvent: customerId é obrigatório');
        }
        if (!endLocation || !endLocation.lat || !endLocation.lng) {
            throw new Error('RideCompletedEvent: endLocation é obrigatório com lat e lng');
        }
        if (finalFare === undefined || finalFare === null) {
            throw new Error('RideCompletedEvent: finalFare é obrigatório');
        }
        // distance e duration são opcionais
    }
}

module.exports = RideCompletedEvent;
