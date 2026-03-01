/**
 * EVENT SOURCING
 * 
 * Sistema de registro de eventos para auditoria e rastreabilidade
 * de todas as operações relacionadas a corridas.
 * 
 * Usa Redis Streams (XADD) para armazenamento de eventos.
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');
const { metrics } = require('../utils/prometheus-metrics');

class EventSourcing {
    constructor() {
        this.redis = redisPool.getConnection();
        this.streamName = 'ride_events';
    }

    /**
     * Tipos de eventos suportados
     */
    static EVENT_TYPES = {
        // Criação e gerenciamento de corridas
        RIDE_REQUESTED: 'ride.requested',
        RIDE_QUEUED: 'ride.queued',
        RIDE_DEQUEUED: 'ride.dequeued',

        // Busca e matching
        DRIVER_SEARCH_STARTED: 'driver.search.started',
        DRIVER_NOTIFIED: 'driver.notified',
        RADIUS_EXPANDED: 'radius.expanded',
        RADIUS_EXPANDED_TO_5KM: 'radius.expanded.to.5km',
        DRIVER_SEARCH_STOPPED: 'driver.search.stopped',

        // Respostas de motoristas
        RIDE_ACCEPTED: 'ride.accepted',
        RIDE_REJECTED: 'ride.rejected',
        DRIVER_TIMEOUT: 'driver.timeout',

        // Estados da corrida
        RIDE_MATCHED: 'ride.matched',
        RIDE_STARTED: 'ride.started',
        RIDE_COMPLETED: 'ride.completed',
        RIDE_CANCELED: 'ride.canceled',

        // Sistema
        LOCK_ACQUIRED: 'lock.acquired',
        LOCK_RELEASED: 'lock.released',
        STATE_CHANGED: 'state.changed',

        // Queue Worker
        QUEUE_PROCESSED: 'queue.processed'
    };

    /**
     * Registrar um evento
     * @param {string} eventType - Tipo do evento (usar EventSourcing.EVENT_TYPES)
     * @param {Object} data - Dados do evento
     * @returns {Promise<string>} ID do evento no stream
     */
    async recordEvent(eventType, data) {
        try {
            // Validar tipo de evento
            const validTypes = Object.values(EventSourcing.EVENT_TYPES);
            if (!validTypes.includes(eventType)) {
                logger.warn(`⚠️ Tipo de evento inválido: ${eventType}`);
            }

            // Preparar dados do evento
            const eventData = {
                type: eventType,
                timestamp: new Date().toISOString(),
                data: JSON.stringify(data),
                // Adicionar campos principais para queries rápidas
                bookingId: data.bookingId || '',
                driverId: data.driverId || '',
                customerId: data.customerId || '',
                state: data.state || '',
                region: data.region || ''
            };

            // Adicionar ao stream (usar * para auto-gerar ID)
            const eventId = await this.redis.xadd(
                this.streamName,
                '*',
                ...Object.entries(eventData).flat()
            );

            // ✅ OBSERVABILIDADE: Registrar métrica de evento publicado
            metrics.recordEventPublished(eventType);

            logger.debug(`📝 Evento registrado: ${eventType} (ID: ${eventId})`);
            return eventId;
        } catch (error) {
            logger.error(`❌ Erro ao registrar evento ${eventType}:`, error);
            // Não lançar erro para não quebrar fluxo principal
            return null;
        }
    }

    /**
     * Buscar eventos por bookingId
     * @param {string} bookingId - ID da corrida
     * @param {number} limit - Limite de eventos (padrão 100)
     * @returns {Promise<Array>} Array de eventos
     */
    async getEventsByBooking(bookingId, limit = 100) {
        try {
            // Buscar eventos recentes do stream
            const events = await this.redis.xrevrange(
                this.streamName,
                '+', // Começar do mais recente
                '-', // Até o mais antigo
                'COUNT', limit
            );

            // Filtrar por bookingId
            const filteredEvents = events
                .map(this._parseEvent)
                .filter(event => event.bookingId === bookingId);

            return filteredEvents;
        } catch (error) {
            logger.error(`❌ Erro ao buscar eventos para booking ${bookingId}:`, error);
            return [];
        }
    }

    /**
     * Buscar eventos por driverId
     * @param {string} driverId - ID do motorista
     * @param {number} limit - Limite de eventos
     * @returns {Promise<Array>} Array de eventos
     */
    async getEventsByDriver(driverId, limit = 100) {
        try {
            const events = await this.redis.xrevrange(
                this.streamName,
                '+',
                '-',
                'COUNT', limit
            );

            const filteredEvents = events
                .map(this._parseEvent)
                .filter(event => event.driverId === driverId);

            return filteredEvents;
        } catch (error) {
            logger.error(`❌ Erro ao buscar eventos para driver ${driverId}:`, error);
            return [];
        }
    }

    /**
     * Buscar eventos por tipo
     * @param {string} eventType - Tipo do evento
     * @param {number} limit - Limite de eventos
     * @returns {Promise<Array>} Array de eventos
     */
    async getEventsByType(eventType, limit = 100) {
        try {
            const events = await this.redis.xrevrange(
                this.streamName,
                '+',
                '-',
                'COUNT', limit * 10 // Buscar mais para filtrar
            );

            const filteredEvents = events
                .map(this._parseEvent)
                .filter(event => event.type === eventType)
                .slice(0, limit);

            return filteredEvents;
        } catch (error) {
            logger.error(`❌ Erro ao buscar eventos do tipo ${eventType}:`, error);
            return [];
        }
    }

    /**
     * Buscar eventos recentes
     * @param {number} limit - Limite de eventos
     * @returns {Promise<Array>} Array de eventos
     */
    async getRecentEvents(limit = 50) {
        try {
            const events = await this.redis.xrevrange(
                this.streamName,
                '+',
                '-',
                'COUNT', limit
            );

            return events.map(this._parseEvent);
        } catch (error) {
            logger.error(`❌ Erro ao buscar eventos recentes:`, error);
            return [];
        }
    }

    /**
     * Parsear evento do formato Redis Stream
     * @private
     */
    _parseEvent(redisEvent) {
        const [eventId, fields] = redisEvent;
        const event = {
            id: eventId,
            type: fields[1], // Índice alternado: chave, valor
            timestamp: fields[3],
            data: JSON.parse(fields[5] || '{}'),
            bookingId: fields[7] || '',
            driverId: fields[9] || '',
            customerId: fields[11] || '',
            state: fields[13] || '',
            region: fields[15] || ''
        };

        return event;
    }

    /**
     * Obter estatísticas do stream
     * @returns {Promise<Object>} Estatísticas
     */
    async getStreamStats() {
        try {
            const info = await this.redis.xinfo('STREAM', this.streamName);
            const length = await this.redis.xlen(this.streamName);

            return {
                streamName: this.streamName,
                length,
                info: this._parseStreamInfo(info)
            };
        } catch (error) {
            logger.error(`❌ Erro ao obter estatísticas do stream:`, error);
            return {
                streamName: this.streamName,
                length: 0,
                info: {}
            };
        }
    }

    /**
     * Parsear informações do stream
     * @private
     */
    _parseStreamInfo(info) {
        const parsed = {};
        for (let i = 0; i < info.length; i += 2) {
            parsed[info[i]] = info[i + 1];
        }
        return parsed;
    }
}

// Singleton instance
const eventSourcing = new EventSourcing();

// Exportar tanto a instância quanto a classe (para acesso aos EVENT_TYPES)
module.exports = eventSourcing;
module.exports.EventSourcing = EventSourcing;
module.exports.EVENT_TYPES = EventSourcing.EVENT_TYPES;

