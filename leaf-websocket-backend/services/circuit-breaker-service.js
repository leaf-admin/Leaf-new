/**
 * CIRCUIT BREAKER SERVICE
 * 
 * Circuit breaker pragmático (sem framework) para proteger chamadas externas.
 * 
 * Estados:
 * - CLOSED: Normal, permitindo chamadas
 * - OPEN: Falhou, bloqueando chamadas (fail-fast)
 * - HALF_OPEN: Testando se serviço recuperou
 */

const { logger } = require('../utils/logger');
const { metrics } = require('../utils/prometheus-metrics');
const redisPool = require('../utils/redis-pool');
const { getTracer } = require('../utils/tracer');
const { createCircuitBreakerSpan, addSpanEvent, endSpanSuccess, endSpanError } = require('../utils/span-helpers');

class CircuitBreaker {
    constructor(name, options = {}) {
        this.name = name;
        this.failureThreshold = options.failureThreshold || 5; // Abrir após 5 falhas
        this.timeout = options.timeout || 60000; // 60 segundos em OPEN antes de tentar HALF_OPEN
        this.resetTimeout = options.resetTimeout || 30000; // 30 segundos para resetar contador
        this.state = 'CLOSED';
            metrics.setCircuitBreakerState(this.name, 'CLOSED'); // CLOSED, OPEN, HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.nextAttemptTime = null;
        this.redis = null;
    }

    /**
     * Inicializar conexão Redis
     */
    async ensureConnection() {
        if (!this.redis) {
            await redisPool.ensureConnection();
            this.redis = redisPool.getConnection();
        }
    }

    /**
     * Carregar estado do Redis
     */
    async loadState() {
        try {
            await this.ensureConnection();
            const stateKey = `circuit_breaker:${this.name}`;
            const state = await this.redis.hgetall(stateKey);
            
            if (state && Object.keys(state).length > 0) {
                this.state = state.state || 'CLOSED';
                this.failureCount = parseInt(state.failureCount || 0);
                this.lastFailureTime = state.lastFailureTime ? parseInt(state.lastFailureTime) : null;
                this.nextAttemptTime = state.nextAttemptTime ? parseInt(state.nextAttemptTime) : null;
            }
        } catch (error) {
            logger.warn(`⚠️ [CircuitBreaker] Erro ao carregar estado: ${error.message}`);
        }
    }

    /**
     * Salvar estado no Redis
     */
    async saveState() {
        try {
            await this.ensureConnection();
            const stateKey = `circuit_breaker:${this.name}`;
            await this.redis.hset(stateKey, {
                state: this.state,
                failureCount: String(this.failureCount),
                lastFailureTime: this.lastFailureTime ? String(this.lastFailureTime) : '',
                nextAttemptTime: this.nextAttemptTime ? String(this.nextAttemptTime) : ''
            });
            await this.redis.expire(stateKey, 3600); // TTL de 1 hora
        } catch (error) {
            logger.warn(`⚠️ [CircuitBreaker] Erro ao salvar estado: ${error.message}`);
        }
    }

    /**
     * Verificar se circuit breaker está aberto
     */
    isOpen() {
        if (this.state === 'OPEN') {
            // Verificar se já pode tentar HALF_OPEN
            if (this.nextAttemptTime && Date.now() >= this.nextAttemptTime) {
                this.state = 'HALF_OPEN';
            metrics.setCircuitBreakerState(this.name, 'HALF_OPEN');
                this.saveState();
                logger.info(`🔄 [CircuitBreaker:${this.name}] Transicionando para HALF_OPEN`);
                return false; // Permitir tentativa
            }
            return true; // Ainda bloqueado
        }
        return false; // CLOSED ou HALF_OPEN - permitir
    }

    /**
     * Registrar sucesso
     */
    async recordSuccess() {
        if (this.state === 'HALF_OPEN') {
            // Sucesso em HALF_OPEN = fechar circuit breaker
            this.state = 'CLOSED';
            metrics.setCircuitBreakerState(this.name, 'CLOSED');
            this.failureCount = 0;
            this.lastFailureTime = null;
            this.nextAttemptTime = null;
            await this.saveState();
            logger.info(`✅ [CircuitBreaker:${this.name}] Circuit breaker fechado (recuperado)`);
        } else if (this.state === 'CLOSED') {
            // Resetar contador de falhas após período sem falhas
            if (this.failureCount > 0) {
                const timeSinceLastFailure = Date.now() - (this.lastFailureTime || 0);
                if (timeSinceLastFailure >= this.resetTimeout) {
                    this.failureCount = 0;
                    await this.saveState();
                }
            }
        }
    }

    /**
     * Registrar falha
     */
    async recordFailure() {
        metrics.recordCircuitBreakerFailure(this.name);
        this.failureCount++;
        this.lastFailureTime = Date.now();

        if (this.state === 'HALF_OPEN') {
            // Falha em HALF_OPEN = abrir novamente
            this.state = 'OPEN';
            metrics.setCircuitBreakerState(this.name, 'OPEN');
            this.nextAttemptTime = Date.now() + this.timeout;
            await this.saveState();
            logger.warn(`❌ [CircuitBreaker:${this.name}] Circuit breaker aberto novamente (falha em HALF_OPEN)`);
        } else if (this.state === 'CLOSED' && this.failureCount >= this.failureThreshold) {
            // Muitas falhas = abrir circuit breaker
            this.state = 'OPEN';
            metrics.setCircuitBreakerState(this.name, 'OPEN');
            this.nextAttemptTime = Date.now() + this.timeout;
            await this.saveState();
            logger.warn(`❌ [CircuitBreaker:${this.name}] Circuit breaker aberto (${this.failureCount} falhas)`);
        } else {
            await this.saveState();
        }
    }

    /**
     * Executar função com circuit breaker
     */
    async execute(fn, fallback = null) {
        // Carregar estado atual
        await this.loadState();

        // ✅ FASE 1.3: Criar span para Circuit Breaker
        const { trace: otelTrace } = require('@opentelemetry/api');
        const tracer = getTracer();
        const activeSpan = otelTrace.getActiveSpan();
        const state = this.getState().state;
        
        const circuitSpan = createCircuitBreakerSpan(tracer, this.name, state, activeSpan, {
            'circuit.failure_count': this.getState().failureCount || 0
        });

        // Verificar se está aberto
        if (this.isOpen()) {
            addSpanEvent(circuitSpan, 'circuit.open', { name: this.name });
            logger.warn(`🚫 [CircuitBreaker:${this.name}] Circuit breaker aberto - usando fallback`);
            if (fallback) {
                const result = await fallback();
                endSpanSuccess(circuitSpan, { 'circuit.used_fallback': true });
                return result;
            }
            endSpanError(circuitSpan, new Error(`Circuit breaker ${this.name} está aberto`));
            throw new Error(`Circuit breaker ${this.name} está aberto`);
        }

        try {
            // Executar função
            const result = await fn();
            
            // Registrar sucesso
            await this.recordSuccess();
            
            endSpanSuccess(circuitSpan, {
                'circuit.state': 'CLOSED',
                'circuit.used_fallback': false
            });
            
            return result;
        } catch (error) {
            // Registrar falha
            await this.recordFailure();
            
            // Atualizar atributos do span
            circuitSpan.setAttribute('circuit.failure_count', this.getState().failureCount || 0);
            
            // Se tiver fallback, usar
            if (fallback) {
                logger.warn(`⚠️ [CircuitBreaker:${this.name}] Erro capturado - usando fallback: ${error.message}`);
                addSpanEvent(circuitSpan, 'circuit.fallback_used', { error: error.message });
                const result = await fallback();
                endSpanSuccess(circuitSpan, { 'circuit.used_fallback': true });
                return result;
            }
            
            endSpanError(circuitSpan, error);
            throw error;
        }
    }

    /**
     * Obter estado atual
     */
    getState() {
        return {
            name: this.name,
            state: this.state,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime,
            nextAttemptTime: this.nextAttemptTime
        };
    }

    /**
     * Resetar circuit breaker manualmente
     */
    async reset() {
        this.state = 'CLOSED';
            metrics.setCircuitBreakerState(this.name, 'CLOSED');
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.nextAttemptTime = null;
        await this.saveState();
        logger.info(`🔄 [CircuitBreaker:${this.name}] Circuit breaker resetado manualmente`);
    }
}

/**
 * Gerenciador de circuit breakers
 */
class CircuitBreakerService {
    constructor() {
        this.breakers = new Map();
    }

    /**
     * Obter ou criar circuit breaker
     */
    getBreaker(name, options = {}) {
        if (!this.breakers.has(name)) {
            this.breakers.set(name, new CircuitBreaker(name, options));
        }
        return this.breakers.get(name);
    }

    /**
     * Executar função com circuit breaker
     */
    async execute(name, fn, fallback = null, options = {}) {
        const breaker = this.getBreaker(name, options);
        return await breaker.execute(fn, fallback);
    }

    /**
     * Verificar se circuit breaker está aberto
     */
    isOpen(name) {
        const breaker = this.breakers.get(name);
        if (!breaker) {
            return false; // Se não existe, não está aberto
        }
        return breaker.isOpen();
    }

    /**
     * Obter estado de um circuit breaker
     */
    getState(name) {
        const breaker = this.breakers.get(name);
        if (!breaker) {
            return null;
        }
        return breaker.getState();
    }

    /**
     * Resetar circuit breaker
     */
    async reset(name) {
        const breaker = this.breakers.get(name);
        if (breaker) {
            await breaker.reset();
        }
    }
}

// Singleton
const circuitBreakerService = new CircuitBreakerService();
module.exports = circuitBreakerService;

