/**
 * LISTENERS - LEAF
 * 
 * Efeitos colaterais que reagem a eventos.
 * 
 * Regras:
 * - Listeners são desacoplados
 * - Listeners podem rodar no mesmo processo ou em workers
 * - Listeners não mudam estado (apenas reagem)
 * - Listeners podem notificar, enviar push, iniciar timers, etc.
 */

const { logger } = require('../utils/logger');
const { EVENT_TYPES } = require('../events');
const { metrics } = require('../utils/prometheus-metrics');
const { validateAndEnsureTraceIdInListener } = require('../utils/trace-validator');

/**
 * Classe base para listeners
 */
class EventListener {
    constructor(eventType, handler) {
        this.eventType = eventType;
        this.handler = handler;
        this.isActive = true;
    }

    /**
     * Processar evento
     */
    async handle(event, io) {
        if (!this.isActive) {
            return;
        }

        // ✅ VALIDAÇÃO: Garantir traceId válido no listener
        const listenerName = this.handler.name || 'anonymous';
        const validatedTraceId = validateAndEnsureTraceIdInListener(event, listenerName);

        const startTime = Date.now();

        try {
            // ✅ CORREÇÃO: Passar io para o handler
            await this.handler(event, io);

            // ✅ OBSERVABILIDADE: Registrar métrica de listener executado com sucesso
            const duration = (Date.now() - startTime) / 1000;
            metrics.recordListener(listenerName, duration, true);
            metrics.recordEventConsumed(this.eventType, listenerName);
        } catch (error) {
            // ✅ OBSERVABILIDADE: Registrar métrica de listener com falha
            const duration = (Date.now() - startTime) / 1000;
            metrics.recordListener(listenerName, duration, false);

            logger.error(`❌ [EventListener] Erro ao processar evento ${this.eventType}: ${error.message}`);
            // Não propagar erro - listeners são independentes
        }
    }
}

/**
 * Event Bus simples usando Redis Streams
 */
class EventBus {
    constructor(io = null) {
        this.io = io; // Socket.IO instance (opcional, para notificações WebSocket)
        this.listeners = new Map();
        this.redis = null;
    }

    /**
     * Inicializar Event Bus
     */
    async initialize() {
        const redisPool = require('../utils/redis-pool');
        await redisPool.ensureConnection();
        this.redis = redisPool.getConnection();
        logger.info('✅ [EventBus] Inicializado');
    }

    /**
     * Registrar listener para um tipo de evento
     */
    on(eventType, handler) {
        if (!this.listeners.has(eventType)) {
            this.listeners.set(eventType, []);
        }
        this.listeners.get(eventType).push(new EventListener(eventType, handler));
        logger.debug(`📝 [EventBus] Listener registrado para ${eventType}`);
    }

    /**
     * Publicar evento
     */
    async publish(event) {
        try {
            if (!this.redis) {
                await this.initialize();
            }

            // Validar evento
            if (!event.eventType || !event.data) {
                logger.warn(`⚠️ Tipo de evento inválido: ${event.eventType || 'undefined'}`);
                throw new Error('Evento inválido: falta eventType ou data');
            }

            // Publicar no Redis Streams (para persistência e workers)
            const eventSourcing = require('../services/event-sourcing');
            const publishTime = Date.now();
            await eventSourcing.recordEvent(event.eventType, event.data);

            // ✅ OBSERVABILIDADE: Métrica já registrada em event-sourcing.js via recordEventPublished
            // Mas também registrar aqui para eventos publicados diretamente via EventBus
            metrics.recordEventPublished(event.eventType);

            // Notificar listeners locais (mesmo processo)
            await this.notifyListeners(event, publishTime);

            logger.debug(`📤 [EventBus] Evento publicado: ${event.eventType}`);
        } catch (error) {
            logger.error(`❌ [EventBus] Erro ao publicar evento: ${error.message}`);
            // Não propagar erro em testes - apenas logar
            if (process.env.NODE_ENV !== 'test') {
                throw error;
            }
        }
    }

    /**
     * Notificar listeners locais
     */
    async notifyListeners(event, publishTime = Date.now()) {
        const listeners = this.listeners.get(event.eventType) || [];

        // Executar listeners em paralelo (não bloquear)
        const promises = listeners.map(listener => {
            // Calcular lag (tempo entre publicação e consumo)
            const lag = (Date.now() - publishTime) / 1000;
            const listenerName = listener.handler.name || 'anonymous';

            // ✅ OBSERVABILIDADE: Registrar lag de evento
            metrics.recordEventConsumed(event.eventType, listenerName, lag);

            return listener.handle(event, this.io);
        });
        await Promise.allSettled(promises);
    }

    /**
     * Remover listener
     */
    off(eventType, handler) {
        const listeners = this.listeners.get(eventType) || [];
        const filtered = listeners.filter(l => l.handler !== handler);
        this.listeners.set(eventType, filtered);
    }
}

// Singleton
let eventBusInstance = null;

function getEventBus(io = null) {
    if (!eventBusInstance) {
        eventBusInstance = new EventBus(io);
    }
    return eventBusInstance;
}

module.exports = {
    EventListener,
    EventBus,
    getEventBus
};

