/**
 * EVENTO: payment.confirmed
 * 
 * Emitido quando um pagamento é confirmado.
 */

const { CanonicalEvent, EVENT_TYPES } = require('./index');
const { validateAndEnsureTraceIdInEvent } = require('../utils/trace-validator');

class PaymentConfirmedEvent extends CanonicalEvent {
    constructor(data) {
        // ✅ OBSERVABILIDADE: Incluir traceId e correlationId no evento
        const traceContext = require('../utils/trace-context');
        const { trace } = require('@opentelemetry/api');
        const activeSpan = trace.getActiveSpan();
        const spanContext = activeSpan?.spanContext();
        
        const validatedTraceId = validateAndEnsureTraceIdInEvent(data, EVENT_TYPES.PAYMENT_CONFIRMED);
        
        const eventData = {
            ...data,
            traceId: validatedTraceId(data, EVENT_TYPES.PAYMENT_CONFIRMED),
            correlationId: data.correlationId || data.bookingId || data.paymentId // ✅ Adicionar correlationId
        };
        
        super(EVENT_TYPES.PAYMENT_CONFIRMED, eventData);
        
        // ✅ CRÍTICO: Criar metadata com correlationId e traceId para serialização
        if (!this.data.metadata) {
            this.data.metadata = {};
        }
        this.data.metadata.correlationId = eventData.correlationId;
        this.data.metadata.traceId = spanContext?.traceId || validatedTraceId;
        this.data.metadata.spanId = spanContext?.spanId;
        
        this.validatePaymentConfirmed();
    }

    validatePaymentConfirmed() {
        const { bookingId, customerId, paymentId, amount, currency, status, paymentMethod } = this.data;
        
        if (!bookingId) {
            throw new Error('PaymentConfirmedEvent: bookingId é obrigatório');
        }
        if (!customerId) {
            throw new Error('PaymentConfirmedEvent: customerId é obrigatório');
        }
        if (!paymentId) {
            throw new Error('PaymentConfirmedEvent: paymentId é obrigatório');
        }
        if (amount === undefined || amount === null) {
            throw new Error('PaymentConfirmedEvent: amount é obrigatório');
        }
        if (!currency) {
            throw new Error('PaymentConfirmedEvent: currency é obrigatório');
        }
        if (!status) {
            throw new Error('PaymentConfirmedEvent: status é obrigatório');
        }
        if (!paymentMethod) {
            throw new Error('PaymentConfirmedEvent: paymentMethod é obrigatório');
        }
    }
}

module.exports = PaymentConfirmedEvent;
