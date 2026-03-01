/**
 * METRICS COLLECTOR
 * 
 * Coleta e armazena métricas de performance do sistema:
 * - Tempo médio de match (do createBooking até acceptRide)
 * - Taxa de aceitação (aceitações / notificações totais)
 * - Tempo de expansão de raio (tempo até atingir cada raio)
 * - Latências de operações
 * - Estatísticas de distribuição
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');

class MetricsCollector {
    constructor() {
        this.redis = redisPool.getConnection();
        
        // Configurações
        this.config = {
            // Retenção de métricas (em dias)
            retentionDays: 30,
            
            // Intervalo para agregação (em minutos)
            aggregationInterval: 5,
            
            // Prefixos Redis
            prefix: {
                match: 'metrics:match',
                acceptance: 'metrics:acceptance',
                expansion: 'metrics:expansion',
                latency: 'metrics:latency',
                distribution: 'metrics:distribution'
            }
        };
    }

    /**
     * Registrar início de match (quando corrida é criada)
     * @param {string} bookingId - ID da corrida
     * @param {number} timestamp - Timestamp de criação
     */
    async recordMatchStart(bookingId, timestamp = Date.now()) {
        try {
            const key = `${this.config.prefix.match}:${bookingId}`;
            await this.redis.hset(key, {
                bookingId,
                startTime: timestamp,
                createdAt: new Date(timestamp).toISOString()
            });
            
            // Expirar após 1 hora (após match ou timeout)
            await this.redis.expire(key, 3600);
            
            logger.debug(`📊 [Metrics] Match iniciado para ${bookingId}`);
        } catch (error) {
            logger.error(`❌ [Metrics] Erro ao registrar início de match:`, error);
        }
    }

    /**
     * Registrar fim de match (quando motorista aceita)
     * @param {string} bookingId - ID da corrida
     * @param {string} driverId - ID do motorista
     * @param {number} timestamp - Timestamp de aceitação
     */
    async recordMatchEnd(bookingId, driverId, timestamp = Date.now()) {
        try {
            const key = `${this.config.prefix.match}:${bookingId}`;
            const matchData = await this.redis.hgetall(key);
            
            if (!matchData || !matchData.startTime) {
                // Se não encontrou início, criar agora (caso de corrida antiga)
                await this.recordMatchStart(bookingId, timestamp - 30000); // Assume 30s antes
                const retryData = await this.redis.hgetall(key);
                matchData.startTime = retryData.startTime;
            }
            
            const startTime = parseInt(matchData.startTime);
            const matchTime = timestamp - startTime; // ms
            
            // Atualizar dados
            await this.redis.hset(key, {
                endTime: timestamp,
                driverId,
                matchTime,
                status: 'matched'
            });
            
            // Adicionar à lista agregada (para calcular média)
            const aggregatedKey = `${this.config.prefix.match}:aggregated:${this.getHourKey(timestamp)}`;
            await this.redis.lpush(aggregatedKey, matchTime);
            await this.redis.ltrim(aggregatedKey, 0, 9999); // Limitar a 10000 valores
            await this.redis.expire(aggregatedKey, this.config.retentionDays * 24 * 3600);
            
            logger.debug(`📊 [Metrics] Match completado para ${bookingId}: ${matchTime}ms`);
            
            return matchTime;
        } catch (error) {
            logger.error(`❌ [Metrics] Erro ao registrar fim de match:`, error);
            return null;
        }
    }

    /**
     * Registrar notificação de motorista
     * @param {string} bookingId - ID da corrida
     * @param {string} driverId - ID do motorista
     * @param {number} timestamp - Timestamp de notificação
     */
    async recordDriverNotification(bookingId, driverId, timestamp = Date.now()) {
        try {
            const key = `${this.config.prefix.acceptance}:${bookingId}`;
            const notifications = await this.redis.smembers(`${key}:notified`);
            
            // Adicionar motorista à lista de notificados
            await this.redis.sadd(`${key}:notified`, driverId);
            await this.redis.hset(key, {
                bookingId,
                notifiedCount: notifications.length + 1,
                lastNotification: timestamp
            });
            
            await this.redis.expire(key, 3600);
            
            logger.debug(`📊 [Metrics] Notificação registrada: ${bookingId} → ${driverId}`);
        } catch (error) {
            logger.error(`❌ [Metrics] Erro ao registrar notificação:`, error);
        }
    }

    /**
     * Registrar aceitação de motorista
     * @param {string} bookingId - ID da corrida
     * @param {string} driverId - ID do motorista
     * @param {number} timestamp - Timestamp de aceitação
     */
    async recordDriverAcceptance(bookingId, driverId, timestamp = Date.now()) {
        try {
            const key = `${this.config.prefix.acceptance}:${bookingId}`;
            
            // Atualizar contador de aceitações
            await this.redis.hset(key, {
                accepted: true,
                acceptedDriverId: driverId,
                acceptedAt: timestamp,
                acceptanceCount: 1
            });
            
            // Registrar evento para cálculo de taxa de aceitação
            const acceptanceKey = `${this.config.prefix.acceptance}:aggregated:${this.getHourKey(timestamp)}`;
            await this.redis.incr(`${acceptanceKey}:acceptances`);
            await this.redis.expire(`${acceptanceKey}:acceptances`, this.config.retentionDays * 24 * 3600);
            
            logger.debug(`📊 [Metrics] Aceitação registrada: ${bookingId} → ${driverId}`);
        } catch (error) {
            logger.error(`❌ [Metrics] Erro ao registrar aceitação:`, error);
        }
    }

    /**
     * Registrar expansão de raio
     * @param {string} bookingId - ID da corrida
     * @param {number} radius - Raio atingido (km)
     * @param {number} timestamp - Timestamp da expansão
     */
    async recordRadiusExpansion(bookingId, radius, timestamp = Date.now()) {
        try {
            const key = `${this.config.prefix.expansion}:${bookingId}`;
            
            // Buscar primeira expansão (para calcular tempo até este raio)
            const expansionData = await this.redis.hgetall(key);
            const startTime = expansionData.startTime ? parseInt(expansionData.startTime) : timestamp;
            
            const timeToRadius = timestamp - startTime; // ms
            
            // Armazenar expansão
            await this.redis.hset(key, {
                bookingId,
                startTime: startTime,
                [`radius_${radius}`]: timestamp,
                [`time_to_${radius}`]: timeToRadius,
                maxRadius: Math.max(parseFloat(expansionData.maxRadius || 0), radius),
                lastUpdate: timestamp
            });
            
            await this.redis.expire(key, 3600);
            
            // Agregar para estatísticas
            const aggregatedKey = `${this.config.prefix.expansion}:aggregated:${this.getHourKey(timestamp)}`;
            await this.redis.lpush(`${aggregatedKey}:radius_${radius}`, timeToRadius);
            await this.redis.ltrim(`${aggregatedKey}:radius_${radius}`, 0, 9999);
            await this.redis.expire(`${aggregatedKey}:radius_${radius}`, this.config.retentionDays * 24 * 3600);
            
            logger.debug(`📊 [Metrics] Expansão registrada: ${bookingId} → ${radius}km em ${timeToRadius}ms`);
        } catch (error) {
            logger.error(`❌ [Metrics] Erro ao registrar expansão:`, error);
        }
    }

    /**
     * Registrar latência de operação
     * @param {string} operation - Nome da operação
     * @param {number} latency - Latência em ms
     * @param {number} timestamp - Timestamp
     */
    async recordLatency(operation, latency, timestamp = Date.now()) {
        try {
            const aggregatedKey = `${this.config.prefix.latency}:${operation}:${this.getHourKey(timestamp)}`;
            
            // Adicionar à lista
            await this.redis.lpush(aggregatedKey, latency);
            await this.redis.ltrim(aggregatedKey, 0, 9999);
            await this.redis.expire(aggregatedKey, this.config.retentionDays * 24 * 3600);
            
            logger.debug(`📊 [Metrics] Latência registrada: ${operation} = ${latency}ms`);
        } catch (error) {
            logger.error(`❌ [Metrics] Erro ao registrar latência:`, error);
        }
    }

    /**
     * Obter tempo médio de match
     * @param {number} hours - Número de horas para calcular média (padrão: 1 hora)
     * @returns {Promise<number>} Tempo médio em ms
     */
    async getAverageMatchTime(hours = 1) {
        try {
            const keys = [];
            const now = Date.now();
            
            // Buscar chaves agregadas das últimas N horas
            for (let i = 0; i < hours; i++) {
                const hourKey = this.getHourKey(now - (i * 3600000));
                keys.push(`${this.config.prefix.match}:aggregated:${hourKey}`);
            }
            
            // Buscar todos os valores
            let allValues = [];
            for (const key of keys) {
                const values = await this.redis.lrange(key, 0, -1);
                allValues = allValues.concat(values.map(v => parseInt(v)));
            }
            
            if (allValues.length === 0) {
                return null;
            }
            
            const average = allValues.reduce((sum, val) => sum + val, 0) / allValues.length;
            
            return Math.round(average);
        } catch (error) {
            logger.error(`❌ [Metrics] Erro ao calcular tempo médio de match:`, error);
            return null;
        }
    }

    /**
     * Obter taxa de aceitação
     * @param {number} hours - Número de horas para calcular (padrão: 1 hora)
     * @returns {Promise<number>} Taxa de aceitação (0-100)
     */
    async getAcceptanceRate(hours = 1) {
        try {
            const now = Date.now();
            let totalNotifications = 0;
            let totalAcceptances = 0;
            
            // Buscar dados das últimas N horas
            for (let i = 0; i < hours; i++) {
                const hourKey = this.getHourKey(now - (i * 3600000));
                
                // Buscar notificações (contar chaves de acceptance)
                const acceptanceKeys = await this.redis.keys(`${this.config.prefix.acceptance}:*:${hourKey}:notified`);
                for (const key of acceptanceKeys) {
                    const count = await this.redis.scard(key);
                    totalNotifications += count || 0;
                }
                
                // Buscar aceitações
                const acceptanceCount = await this.redis.get(`${this.config.prefix.acceptance}:aggregated:${hourKey}:acceptances`);
                totalAcceptances += parseInt(acceptanceCount || 0);
            }
            
            if (totalNotifications === 0) {
                return null;
            }
            
            const rate = (totalAcceptances / totalNotifications) * 100;
            return Math.round(rate * 100) / 100; // 2 casas decimais
        } catch (error) {
            logger.error(`❌ [Metrics] Erro ao calcular taxa de aceitação:`, error);
            return null;
        }
    }

    /**
     * Obter tempo médio de expansão até raio específico
     * @param {number} radius - Raio em km
     * @param {number} hours - Número de horas (padrão: 1 hora)
     * @returns {Promise<number>} Tempo médio em ms
     */
    async getAverageExpansionTime(radius, hours = 1) {
        try {
            const now = Date.now();
            const keys = [];
            
            // Buscar chaves agregadas das últimas N horas
            for (let i = 0; i < hours; i++) {
                const hourKey = this.getHourKey(now - (i * 3600000));
                keys.push(`${this.config.prefix.expansion}:aggregated:${hourKey}:radius_${radius}`);
            }
            
            // Buscar todos os valores
            let allValues = [];
            for (const key of keys) {
                const values = await this.redis.lrange(key, 0, -1);
                allValues = allValues.concat(values.map(v => parseInt(v)));
            }
            
            if (allValues.length === 0) {
                return null;
            }
            
            const average = allValues.reduce((sum, val) => sum + val, 0) / allValues.length;
            return Math.round(average);
        } catch (error) {
            logger.error(`❌ [Metrics] Erro ao calcular tempo médio de expansão:`, error);
            return null;
        }
    }

    /**
     * Obter todas as métricas consolidadas
     * @param {number} hours - Número de horas
     * @returns {Promise<Object>} Objeto com todas as métricas
     */
    async getAllMetrics(hours = 1) {
        try {
            const [avgMatchTime, acceptanceRate, avgExpansion3km, avgExpansion5km] = await Promise.all([
                this.getAverageMatchTime(hours),
                this.getAcceptanceRate(hours),
                this.getAverageExpansionTime(3, hours),
                this.getAverageExpansionTime(5, hours)
            ]);
            
            return {
                timestamp: new Date().toISOString(),
                period: `${hours} hora(s)`,
                match: {
                    averageTime: avgMatchTime ? `${avgMatchTime}ms (${(avgMatchTime / 1000).toFixed(2)}s)` : 'N/A',
                    averageTimeMs: avgMatchTime
                },
                acceptance: {
                    rate: acceptanceRate ? `${acceptanceRate}%` : 'N/A',
                    rateValue: acceptanceRate
                },
                expansion: {
                    timeTo3km: avgExpansion3km ? `${avgExpansion3km}ms (${(avgExpansion3km / 1000).toFixed(2)}s)` : 'N/A',
                    timeTo5km: avgExpansion5km ? `${avgExpansion5km}ms (${(avgExpansion5km / 1000).toFixed(2)}s)` : 'N/A',
                    timeTo3kmMs: avgExpansion3km,
                    timeTo5kmMs: avgExpansion5km
                }
            };
        } catch (error) {
            logger.error(`❌ [Metrics] Erro ao obter métricas consolidadas:`, error);
            return null;
        }
    }

    /**
     * Gerar chave de hora (YYYYMMDDHH)
     * @private
     */
    getHourKey(timestamp) {
        const date = new Date(timestamp);
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hour = String(date.getHours()).padStart(2, '0');
        return `${year}${month}${day}${hour}`;
    }
}

module.exports = new MetricsCollector();

