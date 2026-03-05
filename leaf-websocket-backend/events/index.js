/**
 * EVENTOS CANÔNICOS - LEAF
 * 
 * Contratos imutáveis para eventos do sistema.
 * Todos os eventos seguem o padrão:
 * - eventId: string (UUID)
 * - occurredAt: number (timestamp)
 * - eventType: string (tipo do evento)
 * - data: object (dados específicos do evento)
 */

const { randomUUID } = require('crypto');

/**
 * Classe base para eventos canônicos
 */
class CanonicalEvent {
    constructor(eventType, data) {
        this.eventId = randomUUID();
        this.occurredAt = Date.now();
        this.eventType = eventType;
        this.data = data;
    }

    /**
     * Validar estrutura do evento
     */
    validate() {
        if (!this.eventId || !this.occurredAt || !this.eventType) {
            throw new Error('Evento inválido: campos obrigatórios faltando');
        }
        return true;
    }

    /**
     * Serializar evento para JSON
     */
    toJSON() {
        return {
            eventId: this.eventId,
            occurredAt: this.occurredAt,
            eventType: this.eventType,
            data: this.data
        };
    }
}

/**
 * Tipos de eventos canônicos
 */
const EVENT_TYPES = {
    // Corridas
    RIDE_REQUESTED: 'ride.requested',
    RIDE_ACCEPTED: 'ride.accepted',
    RIDE_REJECTED: 'ride.rejected',
    RIDE_CANCELED: 'ride.canceled',
    RIDE_STARTED: 'ride.started',
    RIDE_COMPLETED: 'ride.completed',
    
    // Motoristas
    DRIVER_ONLINE: 'driver.online',
    DRIVER_OFFLINE: 'driver.offline',
    DRIVER_LOCATION_UPDATED: 'driver.location.updated',
    
    // Pagamentos
    PAYMENT_AUTHORIZED: 'payment.authorized',
    PAYMENT_CONFIRMED: 'payment.confirmed',
    PAYMENT_REFUNDED: 'payment.refunded',
    
    // Sistema
    STATE_CHANGED: 'state.changed',
    LOCK_ACQUIRED: 'lock.acquired',
    LOCK_RELEASED: 'lock.released'
};

module.exports = {
    CanonicalEvent,
    EVENT_TYPES
};
