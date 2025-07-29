// Health Check System
// Data: 29/07/2025
// Status: ✅ HEALTH CHECKS

const { logger } = require('./structured-logging');
const redis = require('redis');
const http = require('http');

class HealthCheckSystem {
    constructor() {
        this.checks = new Map();
        this.results = new Map();
        this.alerts = [];
        
        // Configurações
        this.config = {
            checkInterval: 30000, // 30 segundos
            alertThreshold: 3, // 3 falhas consecutivas
            timeout: 10000, // 10 segundos
            retryAttempts: 3
        };
        
        console.log('🏥 Sistema de Health Checks iniciado');
    }
    
    // Registrar um health check
    registerCheck(name, checkFunction, options = {}) {
        this.checks.set(name, {
            function: checkFunction,
            options: {
                critical: options.critical || false,
                timeout: options.timeout || this.config.timeout,
                retryAttempts: options.retryAttempts || this.config.retryAttempts,
                ...options
            }
        });
        
        console.log(`✅ Health check registrado: ${name}`);
    }
    
    // Health check para Redis
    async checkRedis() {
        try {
            const client = redis.createClient();
            await client.connect();
            
            const start = Date.now();
            const result = await client.ping();
            const duration = Date.now() - start;
            
            await client.disconnect();
            
            return {
                status: result === 'PONG' ? 'healthy' : 'unhealthy',
                duration,
                details: {
                    response: result,
                    memory: await this.getRedisMemory()
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                duration: 0
            };
        }
    }
    
    // Health check para API
    async checkAPI() {
        try {
            const start = Date.now();
            
            const response = await this.makeRequest('http://localhost:3000/health', {
                timeout: 5000
            });
            
            const duration = Date.now() - start;
            
            return {
                status: response.status === 200 ? 'healthy' : 'unhealthy',
                duration,
                details: {
                    statusCode: response.status,
                    responseTime: duration
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                duration: 0
            };
        }
    }
    
    // Health check para WebSocket
    async checkWebSocket() {
        try {
            const start = Date.now();
            
            const response = await this.makeRequest('http://localhost:3001/health', {
                timeout: 5000
            });
            
            const duration = Date.now() - start;
            
            return {
                status: response.status === 200 ? 'healthy' : 'unhealthy',
                duration,
                details: {
                    statusCode: response.status,
                    responseTime: duration
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                duration: 0
            };
        }
    }
    
    // Health check para sistema
    async checkSystem() {
        try {
            const os = require('os');
            
            const totalMem = os.totalmem();
            const freeMem = os.freemem();
            const usedMem = totalMem - freeMem;
            const memoryUsage = (usedMem / totalMem) * 100;
            
            const loadAvg = os.loadavg();
            const cpuUsage = loadAvg[0]; // 1 minuto
            
            return {
                status: memoryUsage < 90 && cpuUsage < 5 ? 'healthy' : 'warning',
                details: {
                    memoryUsage: Math.round(memoryUsage * 100) / 100,
                    cpuUsage: Math.round(cpuUsage * 100) / 100,
                    uptime: os.uptime(),
                    platform: os.platform(),
                    arch: os.arch()
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }
    
    // Health check para disco
    async checkDisk() {
        try {
            const { exec } = require('child_process');
            const util = require('util');
            const execAsync = util.promisify(exec);
            
            const { stdout } = await execAsync('df / | awk \'NR==2 {print $5}\' | cut -d\'%\' -f1');
            const diskUsage = parseInt(stdout.trim());
            
            return {
                status: diskUsage < 90 ? 'healthy' : 'warning',
                details: {
                    diskUsage,
                    threshold: 90
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }
    
    // Health check para serviços
    async checkServices() {
        try {
            const { exec } = require('child_process');
            const util = require('util');
            const execAsync = util.promisify(exec);
            
            const services = ['redis-server', 'nginx'];
            const results = {};
            
            for (const service of services) {
                try {
                    await execAsync(`systemctl is-active ${service}`);
                    results[service] = 'active';
                } catch (error) {
                    results[service] = 'inactive';
                }
            }
            
            const allActive = Object.values(results).every(status => status === 'active');
            
            return {
                status: allActive ? 'healthy' : 'unhealthy',
                details: results
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message
            };
        }
    }
    
    // Health check para conectividade
    async checkConnectivity() {
        try {
            const start = Date.now();
            
            const response = await this.makeRequest('https://www.google.com', {
                timeout: 5000
            });
            
            const duration = Date.now() - start;
            
            return {
                status: response.status === 200 ? 'healthy' : 'unhealthy',
                duration,
                details: {
                    externalConnectivity: response.status === 200,
                    responseTime: duration
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                duration: 0
            };
        }
    }
    
    // Fazer request HTTP
    async makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
            const timeout = options.timeout || 5000;
            
            const req = http.get(url, (res) => {
                resolve({
                    status: res.statusCode,
                    headers: res.headers
                });
            });
            
            req.on('error', reject);
            req.setTimeout(timeout, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });
        });
    }
    
    // Obter memória do Redis
    async getRedisMemory() {
        try {
            const client = redis.createClient();
            await client.connect();
            
            const info = await client.info('memory');
            await client.disconnect();
            
            const usedMemory = info.match(/used_memory_human:(\S+)/);
            return usedMemory ? usedMemory[1] : 'unknown';
        } catch (error) {
            return 'error';
        }
    }
    
    // Executar todos os health checks
    async runAllChecks() {
        const results = {};
        const startTime = Date.now();
        
        console.log('🔍 Executando health checks...');
        
        for (const [name, check] of this.checks) {
            try {
                const result = await check.function();
                results[name] = {
                    ...result,
                    timestamp: new Date().toISOString(),
                    duration: Date.now() - startTime
                };
                
                // Log do resultado
                logger.logPerformance('Health Check', Date.now() - startTime, {
                    check: name,
                    status: result.status,
                    details: result.details
                });
                
            } catch (error) {
                results[name] = {
                    status: 'error',
                    error: error.message,
                    timestamp: new Date().toISOString(),
                    duration: Date.now() - startTime
                };
            }
        }
        
        this.results = results;
        this.analyzeResults();
        
        return results;
    }
    
    // Analisar resultados
    analyzeResults() {
        const alerts = [];
        
        for (const [name, result] of this.results) {
            const check = this.checks.get(name);
            
            if (result.status === 'unhealthy' || result.status === 'error') {
                if (check.options.critical) {
                    alerts.push({
                        level: 'CRITICAL',
                        check: name,
                        message: `Critical health check failed: ${name}`,
                        details: result
                    });
                } else {
                    alerts.push({
                        level: 'WARNING',
                        check: name,
                        message: `Health check failed: ${name}`,
                        details: result
                    });
                }
            }
        }
        
        this.alerts = alerts;
        
        // Log de alertas
        for (const alert of alerts) {
            logger.logSecurity('Health Check Alert', {
                level: alert.level,
                check: alert.check,
                message: alert.message,
                details: alert.details
            });
        }
        
        return alerts;
    }
    
    // Obter status geral
    getOverallStatus() {
        const results = Array.from(this.results.values());
        const criticalChecks = results.filter(r => r.status === 'unhealthy' || r.status === 'error');
        
        if (criticalChecks.length > 0) {
            return 'CRITICAL';
        } else if (this.alerts.length > 0) {
            return 'WARNING';
        } else {
            return 'HEALTHY';
        }
    }
    
    // Iniciar monitoramento
    start() {
        // Registrar health checks padrão
        this.registerCheck('redis', this.checkRedis.bind(this), { critical: true });
        this.registerCheck('api', this.checkAPI.bind(this), { critical: true });
        this.registerCheck('websocket', this.checkWebSocket.bind(this), { critical: true });
        this.registerCheck('system', this.checkSystem.bind(this));
        this.registerCheck('disk', this.checkDisk.bind(this));
        this.registerCheck('services', this.checkServices.bind(this));
        this.registerCheck('connectivity', this.checkConnectivity.bind(this));
        
        // Executar checks periodicamente
        setInterval(async () => {
            await this.runAllChecks();
            
            const status = this.getOverallStatus();
            console.log(`🏥 Health Status: ${status} | Checks: ${this.results.size} | Alerts: ${this.alerts.length}`);
        }, this.config.checkInterval);
        
        // Executar primeira verificação
        this.runAllChecks();
        
        console.log('🏥 Health check system iniciado');
    }
    
    // Obter relatório
    getReport() {
        return {
            timestamp: new Date().toISOString(),
            overallStatus: this.getOverallStatus(),
            checks: this.results,
            alerts: this.alerts,
            summary: {
                total: this.results.size,
                healthy: Array.from(this.results.values()).filter(r => r.status === 'healthy').length,
                unhealthy: Array.from(this.results.values()).filter(r => r.status === 'unhealthy').length,
                errors: Array.from(this.results.values()).filter(r => r.status === 'error').length
            }
        };
    }
}

// Criar instância global
const healthCheckSystem = new HealthCheckSystem();

module.exports = {
    healthCheckSystem,
    HealthCheckSystem
}; 