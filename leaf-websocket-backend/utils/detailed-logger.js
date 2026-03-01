/**
 * DETAILED LOGGER
 * 
 * Logger aprimorado para debug e monitoramento de performance.
 * 
 * Funcionalidades:
 * - Logs estruturados com contexto
 * - Métricas de latência automáticas
 * - Logs por nível (debug, info, warn, error)
 * - Contexto de requisição/corrida
 * - Exportação de logs para análise
 */

const { logger } = require('./logger');
const { performance } = require('perf_hooks');

class DetailedLogger {
    constructor() {
        this.logs = [];
        this.operationTimes = new Map();
        this.maxLogs = 10000; // Limite de logs em memória
    }

    /**
     * Log estruturado com contexto
     * @param {string} level - Nível (debug, info, warn, error)
     * @param {string} message - Mensagem
     * @param {Object} context - Contexto adicional (bookingId, driverId, etc)
     * @param {number} latency - Latência em ms (opcional)
     */
    log(level, message, context = {}, latency = null) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level,
            message,
            context,
            latency,
            pid: process.pid,
            memory: process.memoryUsage().heapUsed / 1024 / 1024 // MB
        };

        // Adicionar ao array de logs (limitado)
        if (this.logs.length >= this.maxLogs) {
            this.logs.shift(); // Remover mais antigo
        }
        this.logs.push(logEntry);

        // Log usando logger padrão com formatação melhorada
        const contextStr = Object.keys(context).length > 0 
            ? ` [${Object.entries(context).map(([k, v]) => `${k}=${v}`).join(', ')}]`
            : '';
        const latencyStr = latency !== null ? ` (${latency.toFixed(2)}ms)` : '';
        
        const formattedMessage = `${message}${contextStr}${latencyStr}`;

        switch (level) {
            case 'debug':
                logger.debug(formattedMessage);
                break;
            case 'info':
                logger.info(formattedMessage);
                break;
            case 'warn':
                logger.warn(formattedMessage);
                break;
            case 'error':
                logger.error(formattedMessage);
                break;
            default:
                logger.info(formattedMessage);
        }
    }

    /**
     * Iniciar medição de operação
     * @param {string} operationId - ID único da operação
     * @param {string} operationName - Nome da operação
     * @param {Object} context - Contexto
     */
    startOperation(operationId, operationName, context = {}) {
        this.operationTimes.set(operationId, {
            name: operationName,
            startTime: performance.now(),
            context
        });
        
        this.log('debug', `▶️ Iniciando: ${operationName}`, { operationId, ...context });
    }

    /**
     * Finalizar medição de operação
     * @param {string} operationId - ID único da operação
     * @param {Object} result - Resultado da operação (opcional)
     */
    endOperation(operationId, result = {}) {
        const operation = this.operationTimes.get(operationId);
        if (!operation) {
            this.log('warn', `⚠️ Operação não encontrada: ${operationId}`);
            return null;
        }

        const duration = performance.now() - operation.startTime;
        this.operationTimes.delete(operationId);

        this.log('info', `✅ Finalizado: ${operation.name}`, {
            operationId,
            ...operation.context,
            ...result
        }, duration);

        return duration;
    }

    /**
     * Log de métrica de performance
     * @param {string} metricName - Nome da métrica
     * @param {number} value - Valor
     * @param {Object} context - Contexto
     */
    metric(metricName, value, context = {}) {
        this.log('info', `📊 Métrica: ${metricName} = ${value}`, context);
    }

    /**
     * Log de evento de corrida
     * @param {string} event - Nome do evento
     * @param {string} bookingId - ID da corrida
     * @param {Object} data - Dados do evento
     */
    rideEvent(event, bookingId, data = {}) {
        this.log('info', `🚗 ${event}`, {
            bookingId,
            ...data
        });
    }

    /**
     * Log de evento de motorista
     * @param {string} event - Nome do evento
     * @param {string} driverId - ID do motorista
     * @param {Object} data - Dados do evento
     */
    driverEvent(event, driverId, data = {}) {
        this.log('info', `👤 ${event}`, {
            driverId,
            ...data
        });
    }

    /**
     * Obter logs recentes
     * @param {number} limit - Limite de logs
     * @param {string} level - Filtrar por nível (opcional)
     * @returns {Array} Array de logs
     */
    getRecentLogs(limit = 100, level = null) {
        let filtered = this.logs;
        
        if (level) {
            filtered = filtered.filter(log => log.level === level);
        }
        
        return filtered.slice(-limit);
    }

    /**
     * Obter estatísticas de logs
     * @returns {Object} Estatísticas
     */
    getStats() {
        const stats = {
            total: this.logs.length,
            byLevel: {},
            byOperation: {},
            averageLatency: null
        };

        const latencies = [];

        for (const log of this.logs) {
            // Contar por nível
            stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;

            // Coletar latências
            if (log.latency !== null) {
                latencies.push(log.latency);
            }
        }

        // Calcular latência média
        if (latencies.length > 0) {
            stats.averageLatency = latencies.reduce((sum, l) => sum + l, 0) / latencies.length;
        }

        return stats;
    }

    /**
     * Limpar logs antigos
     * @param {number} keepLast - Manter últimos N logs
     */
    clearOldLogs(keepLast = 1000) {
        if (this.logs.length > keepLast) {
            this.logs = this.logs.slice(-keepLast);
        }
    }
}

module.exports = new DetailedLogger();


