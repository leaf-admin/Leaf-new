/**
 * METRICS HISTORY SERVICE
 * 
 * Serviço para armazenar e recuperar histórico de métricas
 * Salva automaticamente métricas a cada hora para análise histórica
 */

const redisPool = require('../utils/redis-pool');
const { logger } = require('../utils/logger');

class MetricsHistoryService {
    constructor() {
        this.redis = redisPool.getConnection();
        this.config = {
            // Retenção de histórico (em dias)
            retentionDays: 90,
            
            // Prefixo Redis para histórico
            prefix: 'metrics:history',
            
            // Intervalo de salvamento (em minutos)
            saveInterval: 60
        };
        
        // Iniciar salvamento automático
        this.startAutoSave();
    }

    /**
     * Salvar snapshot de métricas atuais
     */
    async saveMetricsSnapshot(metricsData) {
        try {
            const timestamp = new Date().toISOString();
            const dateKey = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const hourKey = new Date().getHours(); // 0-23
            
            // Chave para armazenar: metrics:history:YYYY-MM-DD:HH
            const key = `${this.config.prefix}:${dateKey}:${hourKey}`;
            
            // Salvar métricas com timestamp
            const snapshot = {
                timestamp,
                date: dateKey,
                hour: hourKey,
                metrics: metricsData
            };
            
            await this.redis.setex(key, this.config.retentionDays * 24 * 60 * 60, JSON.stringify(snapshot));
            
            // Adicionar à lista de snapshots do dia
            const dayListKey = `${this.config.prefix}:days:${dateKey}`;
            await this.redis.sadd(dayListKey, hourKey);
            await this.redis.expire(dayListKey, this.config.retentionDays * 24 * 60 * 60);
            
            logger.info(`✅ Snapshot de métricas salvo: ${key}`);
            return { success: true, key, timestamp };
        } catch (error) {
            logger.error(`❌ Erro ao salvar snapshot de métricas: ${error.message}`);
            throw error;
        }
    }

    /**
     * Buscar histórico de métricas por período
     */
    async getHistory(startDate, endDate, granularity = 'hour') {
        try {
            const start = new Date(startDate);
            const end = new Date(endDate);
            const snapshots = [];
            
            // Iterar pelos dias no período
            const currentDate = new Date(start);
            while (currentDate <= end) {
                const dateKey = currentDate.toISOString().split('T')[0];
                
                if (granularity === 'hour') {
                    // Buscar todas as horas do dia
                    const dayListKey = `${this.config.prefix}:days:${dateKey}`;
                    const hours = await this.redis.smembers(dayListKey);
                    
                    for (const hour of hours) {
                        const key = `${this.config.prefix}:${dateKey}:${hour}`;
                        const data = await this.redis.get(key);
                        if (data) {
                            snapshots.push(JSON.parse(data));
                        }
                    }
                } else if (granularity === 'day') {
                    // Agregar por dia (buscar todas as horas e agregar)
                    const dayListKey = `${this.config.prefix}:days:${dateKey}`;
                    const hours = await this.redis.smembers(dayListKey);
                    const daySnapshots = [];
                    
                    for (const hour of hours) {
                        const key = `${this.config.prefix}:${dateKey}:${hour}`;
                        const data = await this.redis.get(key);
                        if (data) {
                            daySnapshots.push(JSON.parse(data));
                        }
                    }
                    
                    if (daySnapshots.length > 0) {
                        // Agregar métricas do dia
                        const aggregated = this.aggregateSnapshots(daySnapshots);
                        snapshots.push({
                            timestamp: `${dateKey}T12:00:00.000Z`,
                            date: dateKey,
                            hour: null,
                            metrics: aggregated
                        });
                    }
                }
                
                // Avançar para o próximo dia
                currentDate.setDate(currentDate.getDate() + 1);
            }
            
            // Ordenar por timestamp
            snapshots.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            
            return snapshots;
        } catch (error) {
            logger.error(`❌ Erro ao buscar histórico: ${error.message}`);
            throw error;
        }
    }

    /**
     * Agregar múltiplos snapshots
     */
    aggregateSnapshots(snapshots) {
        if (snapshots.length === 0) return null;
        
        const aggregated = {
            rides: {
                total: 0,
                completed: 0,
                cancelled: 0,
                active: 0
            },
            revenue: {
                total: 0,
                average: 0
            },
            users: {
                total: 0,
                active: 0,
                new: 0
            },
            drivers: {
                total: 0,
                active: 0,
                online: 0
            },
            system: {
                cpu: 0,
                memory: 0,
                connections: 0
            }
        };
        
        let count = 0;
        
        for (const snapshot of snapshots) {
            if (!snapshot.metrics) continue;
            
            const m = snapshot.metrics;
            
            // Agregar corridas
            if (m.rides) {
                aggregated.rides.total += m.rides.total || 0;
                aggregated.rides.completed += m.rides.completed || 0;
                aggregated.rides.cancelled += m.rides.cancelled || 0;
                aggregated.rides.active += m.rides.active || 0;
            }
            
            // Agregar receita
            if (m.revenue) {
                aggregated.revenue.total += m.revenue.total || 0;
            }
            
            // Agregar usuários
            if (m.users) {
                aggregated.users.total = Math.max(aggregated.users.total, m.users.total || 0);
                aggregated.users.active += m.users.active || 0;
                aggregated.users.new += m.users.new || 0;
            }
            
            // Agregar motoristas
            if (m.drivers) {
                aggregated.drivers.total = Math.max(aggregated.drivers.total, m.drivers.total || 0);
                aggregated.drivers.active = Math.max(aggregated.drivers.active, m.drivers.active || 0);
                aggregated.drivers.online = Math.max(aggregated.drivers.online, m.drivers.online || 0);
            }
            
            // Agregar sistema (média)
            if (m.system) {
                aggregated.system.cpu += m.system.cpu || 0;
                aggregated.system.memory += m.system.memory || 0;
                aggregated.system.connections += m.system.connections || 0;
            }
            
            count++;
        }
        
        // Calcular médias para sistema
        if (count > 0) {
            aggregated.system.cpu = aggregated.system.cpu / count;
            aggregated.system.memory = aggregated.system.memory / count;
            aggregated.revenue.average = aggregated.revenue.total / Math.max(1, aggregated.rides.completed);
        }
        
        return aggregated;
    }

    /**
     * Comparar dois períodos
     */
    async comparePeriods(period1Start, period1End, period2Start, period2End) {
        try {
            const [period1, period2] = await Promise.all([
                this.getHistory(period1Start, period1End, 'day'),
                this.getHistory(period2Start, period2End, 'day')
            ]);
            
            const aggregated1 = this.aggregateSnapshots(period1);
            const aggregated2 = this.aggregateSnapshots(period2);
            
            if (!aggregated1 || !aggregated2) {
                return null;
            }
            
            // Calcular diferenças percentuais
            const comparison = {
                period1: aggregated1,
                period2: aggregated2,
                changes: {
                    rides: {
                        total: this.calculateChange(aggregated1.rides.total, aggregated2.rides.total),
                        completed: this.calculateChange(aggregated1.rides.completed, aggregated2.rides.completed),
                        cancelled: this.calculateChange(aggregated1.rides.cancelled, aggregated2.rides.cancelled)
                    },
                    revenue: {
                        total: this.calculateChange(aggregated1.revenue.total, aggregated2.revenue.total),
                        average: this.calculateChange(aggregated1.revenue.average, aggregated2.revenue.average)
                    },
                    users: {
                        total: this.calculateChange(aggregated1.users.total, aggregated2.users.total),
                        active: this.calculateChange(aggregated1.users.active, aggregated2.users.active),
                        new: this.calculateChange(aggregated1.users.new, aggregated2.users.new)
                    },
                    drivers: {
                        total: this.calculateChange(aggregated1.drivers.total, aggregated2.drivers.total),
                        active: this.calculateChange(aggregated1.drivers.active, aggregated2.drivers.active),
                        online: this.calculateChange(aggregated1.drivers.online, aggregated2.drivers.online)
                    }
                }
            };
            
            return comparison;
        } catch (error) {
            logger.error(`❌ Erro ao comparar períodos: ${error.message}`);
            throw error;
        }
    }

    /**
     * Calcular mudança percentual
     */
    calculateChange(oldValue, newValue) {
        if (oldValue === 0) {
            return newValue > 0 ? 100 : 0;
        }
        return ((newValue - oldValue) / oldValue) * 100;
    }

    /**
     * Limpar histórico antigo
     */
    async cleanupOldHistory() {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.config.retentionDays);
            
            // Buscar todas as chaves de histórico
            const keys = await this.redis.keys(`${this.config.prefix}:*`);
            
            let deleted = 0;
            for (const key of keys) {
                // Extrair data da chave
                const parts = key.split(':');
                if (parts.length >= 4) {
                    const dateStr = parts[2]; // YYYY-MM-DD
                    const keyDate = new Date(dateStr);
                    
                    if (keyDate < cutoffDate) {
                        await this.redis.del(key);
                        deleted++;
                    }
                }
            }
            
            logger.info(`✅ Limpeza de histórico: ${deleted} registros antigos removidos`);
            return { deleted };
        } catch (error) {
            logger.error(`❌ Erro ao limpar histórico: ${error.message}`);
            throw error;
        }
    }

    /**
     * Iniciar salvamento automático
     */
    startAutoSave() {
        // Executar a cada hora
        setInterval(async () => {
            try {
                // Buscar métricas atuais (precisa ser implementado com os dados reais)
                const metricsData = await this.collectCurrentMetrics();
                await this.saveMetricsSnapshot(metricsData);
            } catch (error) {
                logger.error(`❌ Erro no salvamento automático: ${error.message}`);
            }
        }, this.config.saveInterval * 60 * 1000);
        
        logger.info(`✅ Serviço de histórico de métricas iniciado (salvamento a cada ${this.config.saveInterval} minutos)`);
    }

    /**
     * Coletar métricas atuais
     */
    async collectCurrentMetrics() {
        try {
            // Buscar métricas dos endpoints existentes via Redis/Firebase
            const metrics = {
                rides: {
                    total: 0,
                    completed: 0,
                    cancelled: 0,
                    active: 0
                },
                revenue: {
                    total: 0,
                    average: 0
                },
                users: {
                    total: 0,
                    active: 0,
                    new: 0
                },
                drivers: {
                    total: 0,
                    active: 0,
                    online: 0
                },
                system: {
                    cpu: 0,
                    memory: 0,
                    connections: 0
                }
            };
            
            // Buscar corridas ativas do Redis
            try {
                const activeBookings = await this.redis.keys('booking:*');
                metrics.rides.active = activeBookings.length;
                
                // Contar corridas por status (se disponível)
                for (const key of activeBookings.slice(0, 100)) { // Limitar para performance
                    const booking = await this.redis.hgetall(key);
                    if (booking.status === 'COMPLETED' || booking.status === 'PAID') {
                        metrics.rides.completed++;
                    } else if (booking.status === 'CANCELLED') {
                        metrics.rides.cancelled++;
                    }
                }
            } catch (err) {
                logger.warn(`⚠️ Erro ao buscar corridas: ${err.message}`);
            }
            
            // Buscar motoristas online
            try {
                const onlineDrivers = await this.redis.smembers('online_users');
                const driverCount = onlineDrivers.filter(id => id.startsWith('driver_')).length;
                metrics.drivers.online = driverCount;
                metrics.drivers.active = driverCount;
            } catch (err) {
                logger.warn(`⚠️ Erro ao buscar motoristas: ${err.message}`);
            }
            
            // Buscar usuários online
            try {
                const onlineUsers = await this.redis.smembers('online_users');
                metrics.users.active = onlineUsers.length;
            } catch (err) {
                logger.warn(`⚠️ Erro ao buscar usuários: ${err.message}`);
            }
            
            // Buscar informações do sistema (se disponível)
            try {
                const os = require('os');
                const cpuLoad = os.loadavg()[0];
                const totalMem = os.totalmem();
                const freeMem = os.freemem();
                const usedMem = totalMem - freeMem;
                
                metrics.system.cpu = (cpuLoad / os.cpus().length) * 100;
                metrics.system.memory = (usedMem / totalMem) * 100;
                
                // Conexões WebSocket (se disponível via global)
                if (global.io && global.io.engine) {
                    metrics.system.connections = global.io.engine.clientsCount || 0;
                }
            } catch (err) {
                logger.warn(`⚠️ Erro ao buscar métricas do sistema: ${err.message}`);
            }
            
            // Calcular receita média
            if (metrics.rides.completed > 0 && metrics.revenue.total > 0) {
                metrics.revenue.average = metrics.revenue.total / metrics.rides.completed;
            }
            
            return metrics;
        } catch (error) {
            logger.error(`❌ Erro ao coletar métricas: ${error.message}`);
            return null;
        }
    }
}

module.exports = MetricsHistoryService;

