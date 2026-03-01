/**
 * EVENTO: driver.online
 * 
 * Emitido quando um motorista fica online.
 */

const { CanonicalEvent, EVENT_TYPES } = require('./index');
const { validateAndEnsureTraceIdInEvent } = require('../utils/trace-validator');

class DriverOnlineEvent extends CanonicalEvent {
    constructor(data) {
        // ✅ OBSERVABILIDADE: Incluir traceId e correlationId no evento
        const traceContext = require('../utils/trace-context');
        const { trace } = require('@opentelemetry/api');
        const activeSpan = trace.getActiveSpan();
        const spanContext = activeSpan?.spanContext();
        
        const validatedTraceId = validateAndEnsureTraceIdInEvent(data, EVENT_TYPES.DRIVER_ONLINE);
        
        const eventData = {
            ...data,
            traceId: validatedTraceId(data, EVENT_TYPES.DRIVER_ONLINE),
            correlationId: data.correlationId || data.driverId // ✅ Adicionar correlationId
        };
        
        super(EVENT_TYPES.DRIVER_ONLINE, eventData);
        
        // ✅ CRÍTICO: Criar metadata com correlationId e traceId para serialização
        if (!this.data.metadata) {
            this.data.metadata = {};
        }
        this.data.metadata.correlationId = eventData.correlationId;
        this.data.metadata.traceId = spanContext?.traceId || validatedTraceId;
        this.data.metadata.spanId = spanContext?.spanId;
        
        this.validateDriverOnline();
    }

    validateDriverOnline() {
        const { driverId, location, vehiclePlate } = this.data;
        
        if (!driverId) {
            throw new Error('DriverOnlineEvent: driverId é obrigatório');
        }
        if (!location || !location.lat || !location.lng) {
            throw new Error('DriverOnlineEvent: location é obrigatório com lat e lng');
        }
        if (!vehiclePlate) {
            throw new Error('DriverOnlineEvent: vehiclePlate é obrigatório');
        }
    }
}

module.exports = DriverOnlineEvent;
