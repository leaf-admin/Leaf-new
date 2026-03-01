const Redis = require('ioredis');
const { logger, logPerformance } = require('./logger');

class HealthChecker {
    constructor() {
        this.redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD || null,
            db: process.env.REDIS_DB || 0,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3
        });
        
        this.healthStatus = {
            redis: { status: 'unknown', lastCheck: null, latency: null },
            api: { status: 'unknown', lastCheck: null, latency: null },
            websocket: { status: 'unknown', lastCheck: null, latency: null },
            system: { status: 'unknown', lastCheck: null, memory: null, cpu: null },
            external: { status: 'unknown', lastCheck: null, latency: null }
        };
        
        this.checkInterval = 30000; // 30 segundos
        this.isRunning = false;
    }
    
    // Verificar Redis
    async checkRedis() {
        const start = Date.now();
        try {
            await this.redis.ping();
            const latency = Date.now() - start;
            
            this.healthStatus.redis = {
                status: 'healthy',
                lastCheck: new Date().toISOString(),
                latency: latency
            };
            
            logPerformance('Redis Health Check', latency, {
                status: 'healthy',
                timestamp: new Date().toISOString()
            });
            
            return true;
        } catch (error) {
            this.healthStatus.redis = {
                status: 'unhealthy',
                lastCheck: new Date().toISOString(),
                error: error.message
            };
            
            logger.error('Redis health check falhou', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            return false;
        }
    }
    
    // Verificar API
    async checkAPI() {
        const start = Date.now();
        try {
            const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3001}/health`);
            const latency = Date.now() - start;
            
            if (response.ok) {
                this.healthStatus.api = {
                    status: 'healthy',
                    lastCheck: new Date().toISOString(),
                    latency: latency
                };
                
                logPerformance('API Health Check', latency, {
                    status: 'healthy',
                    timestamp: new Date().toISOString()
                });
                
                return true;
            } else {
                throw new Error(`HTTP ${response.status}`);
            }
        } catch (error) {
            this.healthStatus.api = {
                status: 'unhealthy',
                lastCheck: new Date().toISOString(),
                error: error.message
            };
            
            logger.error('API health check falhou', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            return false;
        }
    }
    
    // Verificar WebSocket
    async checkWebSocket() {
        const start = Date.now();
        try {
            const WebSocket = require('ws');
            const ws = new WebSocket(`ws://127.0.0.1:${process.env.PORT || 3001}`);
            
            return new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    ws.close();
                    this.healthStatus.websocket = {
                        status: 'unhealthy',
                        lastCheck: new Date().toISOString(),
                        error: 'Timeout'
                    };
                    resolve(false);
                }, 5000);
                
                ws.on('open', () => {
                    const latency = Date.now() - start;
                    clearTimeout(timeout);
                    ws.close();
                    
                    this.healthStatus.websocket = {
                        status: 'healthy',
                        lastCheck: new Date().toISOString(),
                        latency: latency
                    };
                    
                    logPerformance('WebSocket Health Check', latency, {
                        status: 'healthy',
                        timestamp: new Date().toISOString()
                    });
                    
                    resolve(true);
                });
                
                ws.on('error', (error) => {
                    clearTimeout(timeout);
                    this.healthStatus.websocket = {
                        status: 'unhealthy',
                        lastCheck: new Date().toISOString(),
                        error: error.message
                    };
                    
                    logger.error('WebSocket health check falhou', {
                        error: error.message,
                        timestamp: new Date().toISOString()
                    });
                    
                    resolve(false);
                });
            });
        } catch (error) {
            this.healthStatus.websocket = {
                status: 'unhealthy',
                lastCheck: new Date().toISOString(),
                error: error.message
            };
            
            logger.error('WebSocket health check falhou', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            return false;
        }
    }
    
    // Verificar recursos do sistema
    async checkSystem() {
        try {
            const os = require('os');
            const totalMemory = os.totalmem();
            const freeMemory = os.freemem();
            const usedMemory = totalMemory - freeMemory;
            const memoryUsage = (usedMemory / totalMemory) * 100;
            
            const loadAverage = os.loadavg();
            const cpuUsage = loadAverage[0]; // 1 minuto
            
            this.healthStatus.system = {
                status: memoryUsage < 90 && cpuUsage < 5 ? 'healthy' : 'warning',
                lastCheck: new Date().toISOString(),
                memory: {
                    total: totalMemory,
                    used: usedMemory,
                    free: freeMemory,
                    usage: memoryUsage
                },
                cpu: {
                    loadAverage: loadAverage,
                    usage: cpuUsage
                }
            };
            
            if (memoryUsage > 90 || cpuUsage > 5) {
                logger.warn('Recursos do sistema em uso elevado', {
                    memoryUsage: memoryUsage.toFixed(2),
                    cpuUsage: cpuUsage.toFixed(2),
                    timestamp: new Date().toISOString()
                });
            }
            
            return true;
        } catch (error) {
            this.healthStatus.system = {
                status: 'unhealthy',
                lastCheck: new Date().toISOString(),
                error: error.message
            };
            
            logger.error('System health check falhou', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            return false;
        }
    }
    
    // Verificar conectividade externa
    async checkExternal() {
        const start = Date.now();
        try {
            const response = await fetch('https://www.google.com');
            const latency = Date.now() - start;
            
            this.healthStatus.external = {
                status: 'healthy',
                lastCheck: new Date().toISOString(),
                latency: latency
            };
            
            return true;
        } catch (error) {
            this.healthStatus.external = {
                status: 'unhealthy',
                lastCheck: new Date().toISOString(),
                error: error.message
            };
            
            logger.error('External connectivity check falhou', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            return false;
        }
    }
    
    // Executar todos os health checks
    async runAllChecks() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        
        try {
            const results = await Promise.allSettled([
                this.checkRedis(),
                this.checkAPI(),
                this.checkWebSocket(),
                this.checkSystem(),
                this.checkExternal()
            ]);
            
            const allHealthy = results.every(result => result.status === 'fulfilled' && result.value);
            
            if (allHealthy) {
                logger.info('Todos os health checks passaram', {
                    timestamp: new Date().toISOString()
                });
            } else {
                logger.warn('Alguns health checks falharam', {
                    results: results.map((result, index) => ({
                        check: ['redis', 'api', 'websocket', 'system', 'external'][index],
                        status: result.status,
                        value: result.value
                    })),
                    timestamp: new Date().toISOString()
                });
            }
            
            return allHealthy;
        } catch (error) {
            logger.error('Erro durante health checks', {
                error: error.message,
                timestamp: new Date().toISOString()
            });
            return false;
        } finally {
            this.isRunning = false;
        }
    }
    
    // Iniciar health checks periódicos
    startPeriodicChecks() {
        if (this.interval) {
            clearInterval(this.interval);
        }
        
        this.interval = setInterval(async () => {
            await this.runAllChecks();
        }, this.checkInterval);
        
        logger.info('Health checks periódicos iniciados', {
            interval: this.checkInterval,
            timestamp: new Date().toISOString()
        });
    }
    
    // Parar health checks periódicos
    stopPeriodicChecks() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        
        logger.info('Health checks periódicos parados', {
            timestamp: new Date().toISOString()
        });
    }
    
    // Obter status atual
    getStatus() {
        return this.healthStatus;
    }
    
    // Obter status resumido
    getSummary() {
        const checks = Object.values(this.healthStatus);
        const healthy = checks.filter(check => check.status === 'healthy').length;
        const total = checks.length;
        
        return {
            overall: healthy === total ? 'healthy' : 'unhealthy',
            healthy: healthy,
            total: total,
            percentage: (healthy / total) * 100,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = HealthChecker; 