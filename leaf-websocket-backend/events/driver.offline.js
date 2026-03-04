/**
 * EVENTO: driver.offline
 * 
 * Emitido quando um motorista fica offline.
 */

const { CanonicalEvent, EVENT_TYPES } = require('./index');
const { validateAndEnsureTraceIdInEvent } = require('../utils/trace-validator');

class DriverOfflineEvent extends CanonicalEvent {
    constructor(data) {
        // ✅ OBSERVABILIDADE: Incluir traceId e correlationId no evento
        const traceContext = require('../utils/trace-context');
        const { trace } = require('@opentelemetry/api');
        const activeSpan = trace.getActiveSpan();
        const spanContext = activeSpan?.spanContext();
        
        const validatedTraceId = validateAndEnsureTraceIdInEvent(data, EVENT_TYPES.DRIVER_OFFLINE);
        
        const eventData = {
            ...data,
            traceId: validatedTraceId,
            correlationId: data.correlationId || data.driverId // ✅ Adicionar correlationId
        };
        
        super(EVENT_TYPES.DRIVER_OFFLINE, eventData);
        
        // ✅ CRÍTICO: Criar metadata com correlationId e traceId para serialização
        if (!this.data.metadata) {
            this.data.metadata = {};
        }
        this.data.metadata.correlationId = eventData.correlationId;
        this.data.metadata.traceId = spanContext?.traceId || validatedTraceId;
        this.data.metadata.spanId = spanContext?.spanId;
        
        this.validateDriverOffline();
    }

    validateDriverOffline() {
        const { driverId } = this.data;
        
        if (!driverId) {
            throw new Error('DriverOfflineEvent: driverId é obrigatório');
        }
    }
}

module.exports = DriverOfflineEvent;
