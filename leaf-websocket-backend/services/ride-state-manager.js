/**
 * RIDE STATE MANAGER
 * 
 * Gerencia estados de corridas com validação de transições
 * Implementa State Machine para garantir transições válidas
 */

const { logger } = require('../utils/logger');
const eventSourcing = require('./event-sourcing');

class RideStateManager {
    /**
     * Estados possíveis de uma corrida
     */
    static STATES = {
        PENDING: 'PENDING',
        SEARCHING: 'SEARCHING',
        NOTIFIED: 'NOTIFIED', // ✅ NOVO: Motorista foi notificado, aguardando resposta
        AWAITING_RESPONSE: 'AWAITING_RESPONSE', // ✅ NOVO: Aguardando resposta do motorista (alias para NOTIFIED)
        MATCHED: 'MATCHED',
        ACCEPTED: 'ACCEPTED',
        IN_PROGRESS: 'IN_PROGRESS',
        COMPLETED: 'COMPLETED',
        REJECTED: 'REJECTED',
        CANCELED: 'CANCELED',
        EXPANDED: 'EXPANDED' // Estado intermediário quando raio é expandido
    };

    /**
     * Transições válidas de estado
     * Define quais estados podem transitar para quais outros
     */
    static VALID_TRANSITIONS = {
        [RideStateManager.STATES.PENDING]: [
            RideStateManager.STATES.SEARCHING,
            RideStateManager.STATES.CANCELED
        ],
        [RideStateManager.STATES.SEARCHING]: [
            RideStateManager.STATES.NOTIFIED, // ✅ NOVO: Pode transitar para NOTIFIED quando motorista é notificado
            RideStateManager.STATES.MATCHED,
            RideStateManager.STATES.CANCELED,
            RideStateManager.STATES.EXPANDED
        ],
        [RideStateManager.STATES.NOTIFIED]: [
            RideStateManager.STATES.ACCEPTED, // Motorista aceitou
            RideStateManager.STATES.REJECTED, // Motorista rejeitou
            RideStateManager.STATES.SEARCHING, // Timeout - voltar a buscar
            RideStateManager.STATES.CANCELED
        ],
        [RideStateManager.STATES.AWAITING_RESPONSE]: [
            RideStateManager.STATES.ACCEPTED,
            RideStateManager.STATES.REJECTED,
            RideStateManager.STATES.SEARCHING,
            RideStateManager.STATES.CANCELED
        ],
        [RideStateManager.STATES.EXPANDED]: [
            RideStateManager.STATES.MATCHED,
            RideStateManager.STATES.CANCELED,
            RideStateManager.STATES.SEARCHING
        ],
        [RideStateManager.STATES.MATCHED]: [
            RideStateManager.STATES.ACCEPTED,
            RideStateManager.STATES.REJECTED
        ],
        [RideStateManager.STATES.ACCEPTED]: [
            RideStateManager.STATES.IN_PROGRESS,
            RideStateManager.STATES.CANCELED
        ],
        [RideStateManager.STATES.IN_PROGRESS]: [
            RideStateManager.STATES.COMPLETED,
            RideStateManager.STATES.CANCELED
        ],
        [RideStateManager.STATES.REJECTED]: [
            RideStateManager.STATES.SEARCHING,
            RideStateManager.STATES.CANCELED
        ],
        // Estados finais não podem transitar
        [RideStateManager.STATES.COMPLETED]: [],
        [RideStateManager.STATES.CANCELED]: []
    };

    /**
     * Validar se transição de estado é permitida
     * @param {string} currentState - Estado atual
     * @param {string} newState - Novo estado
     * @returns {boolean} true se transição é válida
     */
    static isValidTransition(currentState, newState) {
        const validNextStates = RideStateManager.VALID_TRANSITIONS[currentState];
        
        if (!validNextStates) {
            logger.warn(`⚠️ Estado desconhecido: ${currentState}`);
            return false;
        }

        return validNextStates.includes(newState);
    }

    /**
     * Atualizar estado de uma corrida com validação
     * @param {Object} redis - Instância do Redis
     * @param {string} bookingId - ID da corrida
     * @param {string} newState - Novo estado
     * @param {Object} metadata - Metadados adicionais (driverId, reason, etc.)
     * @returns {Promise<boolean>} true se estado foi atualizado com sucesso
     */
    static async updateBookingState(redis, bookingId, newState, metadata = {}) {
        try {
            const bookingKey = `booking:${bookingId}`;
            
            // Obter estado atual
            const currentState = await redis.hget(bookingKey, 'state');
            
            // Validar transição
            if (currentState && !RideStateManager.isValidTransition(currentState, newState)) {
                const error = `Transição inválida: ${currentState} → ${newState}`;
                logger.error(`❌ ${error} (booking: ${bookingId})`);
                throw new Error(error);
            }

            // Atualizar estado
            const updateData = {
                state: newState,
                updatedAt: new Date().toISOString(),
                ...metadata
            };

            await redis.hset(bookingKey, updateData);

            // Registrar evento
            await eventSourcing.recordEvent(require('./event-sourcing').EVENT_TYPES.STATE_CHANGED, {
                bookingId,
                fromState: currentState || 'UNKNOWN',
                toState: newState,
                ...metadata
            });

            logger.info(`✅ Estado atualizado: ${bookingId} (${currentState || 'NEW'} → ${newState})`);
            return true;
        } catch (error) {
            logger.error(`❌ Erro ao atualizar estado da corrida ${bookingId}:`, error);
            throw error;
        }
    }

    /**
     * Obter estado atual de uma corrida
     * @param {Object} redis - Instância do Redis
     * @param {string} bookingId - ID da corrida
     * @returns {Promise<string|null>} Estado atual ou null se não encontrado
     */
    static async getBookingState(redis, bookingId) {
        try {
            const bookingKey = `booking:${bookingId}`;
            return await redis.hget(bookingKey, 'state');
        } catch (error) {
            logger.error(`❌ Erro ao obter estado da corrida ${bookingId}:`, error);
            return null;
        }
    }

    /**
     * Verificar se corrida está em um estado específico
     * @param {Object} redis - Instância do Redis
     * @param {string} bookingId - ID da corrida
     * @param {string} state - Estado a verificar
     * @returns {Promise<boolean>} true se está no estado
     */
    static async isInState(redis, bookingId, state) {
        const currentState = await RideStateManager.getBookingState(redis, bookingId);
        return currentState === state;
    }

    /**
     * Verificar se corrida está em um estado final (completada ou cancelada)
     * @param {Object} redis - Instância do Redis
     * @param {string} bookingId - ID da corrida
     * @returns {Promise<boolean>} true se está em estado final
     */
    static async isFinalState(redis, bookingId) {
        const currentState = await RideStateManager.getBookingState(redis, bookingId);
        return currentState === RideStateManager.STATES.COMPLETED ||
               currentState === RideStateManager.STATES.CANCELED;
    }

    /**
     * Obter histórico de estados de uma corrida (via event sourcing)
     * @param {string} bookingId - ID da corrida
     * @returns {Promise<Array>} Array de mudanças de estado
     */
    static async getStateHistory(bookingId) {
        try {
            const events = await eventSourcing.getEventsByBooking(bookingId);
            const { EVENT_TYPES } = require('./event-sourcing');
            return events
                .filter(event => event.type === EVENT_TYPES.STATE_CHANGED)
                .map(event => ({
                    fromState: event.data.fromState,
                    toState: event.data.toState,
                    timestamp: event.timestamp,
                    metadata: event.data
                }));
        } catch (error) {
            logger.error(`❌ Erro ao obter histórico de estados para ${bookingId}:`, error);
            return [];
        }
    }
}

module.exports = RideStateManager;

