const Redis = require('ioredis');

            
            // Testar conexão
            const redis = new Redis({
                host: 'localhost',
                port: 6379,
                lazyConnect: true
            });
            
            await redis.ping();
            
            // Obter informações do Redis
            const info = await redis.info();
            
            
            // Parsear informações
            const memoryInfo = this.parseRedisInfo(memory);
            
            
            // Testar operação simples no Firebase
            const testData = { test: true, timestamp: Date.now() };
            await firebaseConfig.syncToRealtimeDB('health_check', testData);
            
            // Remover dados de teste
            await firebaseConfig.deleteFromRealtimeDB('health_check');
            
            this.metrics.firebase = {
                connections: 1, // Firebase mantém pool de conexões
                operations: this.metrics.firebase.operations + 1,
                errors: this.metrics.firebase.errors,
                latency: Date.now() - startTime,
                lastCheck: Date.now(),
                status: 'connected'
            };
            
        } catch (error) {
            this.metrics.firebase.errors++;
            this.addAlert('FIREBASE_ERROR', `Erro ao conectar com Firebase: ${error.message}`);
            console.error('❌ Erro ao verificar Firebase:', error);
        }

    // Verificar recursos do sistema
    async checkSystemResources() {
        try {
            
        const result = {};
        
        for (const line of lines) {
            if (line.includes(':')) {
                const [key, value] = line.split(':');
                result[key] = value;
            }
        
        return result;
    }

    // Obter keyspace do Redis
    async getRedisKeyspace(redis) {
        try {
            
            const result = {};
            
            for (const line of lines) {
                if (line.startsWith('db')) {
                    const [db, info] = line.split(':');
                    result[db] = info;
                }
            
            return result;
        } catch (error) {
            return {};
        }

    // Adicionar alerta
    addAlert(type, message, severity = 'warning') {
        const alert = {
            id: `${type}_${Date.now()}`,
            type,
            message,
            severity,
            timestamp: Date.now(),
            acknowledged: false
        };
        
        this.alerts.push(alert);
        
        // Manter apenas os últimos 100 alertas
        if (this.alerts.length > 100) {
            this.alerts = this.alerts.slice(-100);
        }
        
        console.log(`🚨 ALERTA [${severity.toUpperCase()}]: ${message}`);
        
        return alert;
    }

    // Verificar alertas
    checkAlerts() {
        
        const criticalAlerts = activeAlerts.filter(alert => alert.severity === 'critical');
        
        
        return {
            status: criticalAlerts.length > 0 ? 'critical' : 
                   errorAlerts.length > 0 ? 'error' : 
                   warningAlerts.length > 0 ? 'warning' : 'healthy',
            totalAlerts: activeAlerts.length,
            criticalAlerts: criticalAlerts.length,
            errorAlerts: errorAlerts.length,
            warningAlerts: warningAlerts.length,
            uptime: this.metrics.system.uptime,
            memoryUsage: this.metrics.system.memory.usagePercent,
            cpuLoad: this.metrics.system.cpu
        };
    }

    // Reconhecer alerta
    acknowledgeAlert(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.acknowledged = true;
            return true;
        }
        return false;
    }

    // Limpar alertas antigos
    cleanupOldAlerts() {
        

module.exports = resourceMonitor; 
const firebaseConfig = require('../firebase-config');

class ResourceMonitor {
    constructor() {
        this.metrics = {
            redis: {
                connections: 0,
                memory: 0,
                operations: 0,
                errors: 0,
                latency: 0,
                lastCheck: 0
            },
            firebase: {
                connections: 0,
                operations: 0,
                errors: 0,
                latency: 0,
                lastCheck: 0
            },
            system: {
                cpu: 0,
                memory: 0,
                uptime: 0
            }
        };
        
        this.alerts = [];
        this.monitoringInterval = null;
        this.startMonitoring();
    }

    // Iniciar monitoramento
    startMonitoring() {
        this.monitoringInterval = setInterval(() => {
            this.checkRedisHealth();
            this.checkFirebaseHealth();
            this.checkSystemResources();
            this.checkAlerts();
        }, 30000); // Verificar a cada 30 segundos
        
        console.log('🔍 Monitoramento de recursos iniciado');
    }

    // Verificar saúde do Redis
    async checkRedisHealth() {
        try {
            
            const memory = await redis.info('memory');
            
            const statsInfo = this.parseRedisInfo(stats);
            
            this.metrics.redis = {
                connections: parseInt(statsInfo.connected_clients || 0),
                memory: parseInt(memoryInfo.used_memory_human || 0),
                operations: parseInt(statsInfo.total_commands_processed || 0),
                errors: parseInt(statsInfo.total_errors_received || 0),
                latency: Date.now() - startTime,
                lastCheck: Date.now(),
                keyspace: await this.getRedisKeyspace(redis),
                memoryUsage: memoryInfo.used_memory_human,
                memoryPeak: memoryInfo.used_memory_peak_human
            };
            
            await redis.disconnect();
            
        } catch (error) {
            this.metrics.redis.errors++;
            this.addAlert('REDIS_ERROR', `Erro ao conectar com Redis: ${error.message}`);
            console.error('❌ Erro ao verificar Redis:', error);
        }

    // Verificar saúde do Firebase
    async checkFirebaseHealth() {
        try {
            
            await firebaseConfig.syncToRealtimeDB('health_check', testData);
            
            // Remover dados de teste
            await firebaseConfig.deleteFromRealtimeDB('health_check');
            
            this.metrics.firebase = {
                connections: 1, // Firebase mantém pool de conexões
                operations: this.metrics.firebase.operations + 1,
                errors: this.metrics.firebase.errors,
                latency: Date.now() - startTime,
                lastCheck: Date.now(),
                status: 'connected'
            };
            
        } catch (error) {
            this.metrics.firebase.errors++;
            this.addAlert('FIREBASE_ERROR', `Erro ao conectar com Firebase: ${error.message}`);
            console.error('❌ Erro ao verificar Firebase:', error);
        }

    // Verificar recursos do sistema
    async checkSystemResources() {
        try {
            const os = require('os');
            
            this.metrics.system = {
                cpu: os.loadavg()[0], // Load average 1 minuto
                memory: {
                    total: os.totalmem(),
                    free: os.freemem(),
                    used: os.totalmem() - os.freemem(),
                    usagePercent: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
                },
                uptime: os.uptime(),
                platform: os.platform(),
                arch: os.arch()
            };
            
            // Verificar alertas de sistema
            if (this.metrics.system.memory.usagePercent > 80) {
                this.addAlert('HIGH_MEMORY', `Uso de memória alto: ${this.metrics.system.memory.usagePercent.toFixed(2)}%`);
            }
            
            if (this.metrics.system.cpu > 2.0) {
                this.addAlert('HIGH_CPU', `Load de CPU alto: ${this.metrics.system.cpu.toFixed(2)}`);
            }
            
        } catch (error) {
            console.error('❌ Erro ao verificar recursos do sistema:', error);
        }

    // Parsear informações do Redis
    parseRedisInfo(info) {
        
        
        for (const line of lines) {
            if (line.includes(':')) {
                const [key, value] = line.split(':');
                result[key] = value;
            }
        
        return result;
    }

    // Obter keyspace do Redis
    async getRedisKeyspace(redis) {
        try {
            const keyspace = await redis.info('keyspace');
            
            
            for (const line of lines) {
                if (line.startsWith('db')) {
                    const [db, info] = line.split(':');
                    result[db] = info;
                }
            
            return result;
        } catch (error) {
            return {};
        }

    // Adicionar alerta
    addAlert(type, message, severity = 'warning') {
        const alert = {
            id: `${type}_${Date.now()}`,
            type,
            message,
            severity,
            timestamp: Date.now(),
            acknowledged: false
        };
        
        this.alerts.push(alert);
        
        // Manter apenas os últimos 100 alertas
        if (this.alerts.length > 100) {
            this.alerts = this.alerts.slice(-100);
        }
        
        console.log(`🚨 ALERTA [${severity.toUpperCase()}]: ${message}`);
        
        return alert;
    }

    // Verificar alertas
    checkAlerts() {
        const now = Date.now();
        
        // Verificar latência do Redis
        if (this.metrics.redis.latency > 100) {
            this.addAlert('REDIS_HIGH_LATENCY', `Latência do Redis alta: ${this.metrics.redis.latency}ms`, 'warning');
        }
        
        // Verificar latência do Firebase
        if (this.metrics.firebase.latency > 2000) {
            this.addAlert('FIREBASE_HIGH_LATENCY', `Latência do Firebase alta: ${this.metrics.firebase.latency}ms`, 'warning');
        }
        
        // Verificar erros do Redis
        if (this.metrics.redis.errors > 5) {
            this.addAlert('REDIS_ERRORS', `Muitos erros do Redis: ${this.metrics.redis.errors}`, 'error');
        }
        
        // Verificar erros do Firebase
        if (this.metrics.firebase.errors > 3) {
            this.addAlert('FIREBASE_ERRORS', `Muitos erros do Firebase: ${this.metrics.firebase.errors}`, 'error');
        }
        
        // Verificar se o Redis está respondendo
        if (now - this.metrics.redis.lastCheck > 60000) {
            this.addAlert('REDIS_UNRESPONSIVE', 'Redis não está respondendo', 'critical');
        }
        
        // Verificar se o Firebase está respondendo
        if (now - this.metrics.firebase.lastCheck > 120000) {
            this.addAlert('FIREBASE_UNRESPONSIVE', 'Firebase não está respondendo', 'critical');
        }

    // Obter relatório completo
    getFullReport() {
        return {
            timestamp: Date.now(),
            redis: this.metrics.redis,
            firebase: this.metrics.firebase,
            system: this.metrics.system,
            alerts: this.alerts.filter(alert => !alert.acknowledged),
            summary: this.getSummary()
        };
    }

    // Obter resumo
    getSummary() {
        
        const errorAlerts = activeAlerts.filter(alert => alert.severity === 'error');
        
        if (alert) {
            alert.acknowledged = true;
            return true;
        }
        return false;
    }

    // Limpar alertas antigos
    cleanupOldAlerts() {
        const oneDayAgo = Date.now() - 86400000; // 24 horas
        this.alerts = this.alerts.filter(alert => alert.timestamp > oneDayAgo);
    }

    // Parar monitoramento
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        console.log('🛑 Monitoramento de recursos parado');
    }

    // Destruir monitor
    destroy() {
        this.stopMonitoring();
    }

// Instância singleton


class ResourceMonitor {
    constructor() {
        this.metrics = {
            redis: {
                connections: 0,
                memory: 0,
                operations: 0,
                errors: 0,
                latency: 0,
                lastCheck: 0
            },
            firebase: {
                connections: 0,
                operations: 0,
                errors: 0,
                latency: 0,
                lastCheck: 0
            },
            system: {
                cpu: 0,
                memory: 0,
                uptime: 0
            }
        };
        
        this.alerts = [];
        this.monitoringInterval = null;
        this.startMonitoring();
    }

    // Iniciar monitoramento
    startMonitoring() {
        this.monitoringInterval = setInterval(() => {
            this.checkRedisHealth();
            this.checkFirebaseHealth();
            this.checkSystemResources();
            this.checkAlerts();
        }, 30000); // Verificar a cada 30 segundos
        
        console.log('🔍 Monitoramento de recursos iniciado');
    }

    // Verificar saúde do Redis
    async checkRedisHealth() {
        try {
            const startTime = Date.now();
            
            // Testar conexão
            const redis = new Redis({
                host: 'localhost',
                port: 6379,
                lazyConnect: true
            });
            
            await redis.ping();
            
            // Obter informações do Redis
            
            const stats = await redis.info('stats');
            
            // Parsear informações
            
            
            this.metrics.redis = {
                connections: parseInt(statsInfo.connected_clients || 0),
                memory: parseInt(memoryInfo.used_memory_human || 0),
                operations: parseInt(statsInfo.total_commands_processed || 0),
                errors: parseInt(statsInfo.total_errors_received || 0),
                latency: Date.now() - startTime,
                lastCheck: Date.now(),
                keyspace: await this.getRedisKeyspace(redis),
                memoryUsage: memoryInfo.used_memory_human,
                memoryPeak: memoryInfo.used_memory_peak_human
            };
            
            await redis.disconnect();
            
        } catch (error) {
            this.metrics.redis.errors++;
            this.addAlert('REDIS_ERROR', `Erro ao conectar com Redis: ${error.message}`);
            console.error('❌ Erro ao verificar Redis:', error);
        }

    // Verificar saúde do Firebase
    async checkFirebaseHealth() {
        try {
            const startTime = Date.now();
            
            // Testar operação simples no Firebase
            
            
            this.metrics.system = {
                cpu: os.loadavg()[0], // Load average 1 minuto
                memory: {
                    total: os.totalmem(),
                    free: os.freemem(),
                    used: os.totalmem() - os.freemem(),
                    usagePercent: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
                },
                uptime: os.uptime(),
                platform: os.platform(),
                arch: os.arch()
            };
            
            // Verificar alertas de sistema
            if (this.metrics.system.memory.usagePercent > 80) {
                this.addAlert('HIGH_MEMORY', `Uso de memória alto: ${this.metrics.system.memory.usagePercent.toFixed(2)}%`);
            }
            
            if (this.metrics.system.cpu > 2.0) {
                this.addAlert('HIGH_CPU', `Load de CPU alto: ${this.metrics.system.cpu.toFixed(2)}`);
            }
            
        } catch (error) {
            console.error('❌ Erro ao verificar recursos do sistema:', error);
        }

    // Parsear informações do Redis
    parseRedisInfo(info) {
        const lines = info.split('\r\n');
        
            const lines = keyspace.split('\r\n');
            
        
        // Verificar latência do Redis
        if (this.metrics.redis.latency > 100) {
            this.addAlert('REDIS_HIGH_LATENCY', `Latência do Redis alta: ${this.metrics.redis.latency}ms`, 'warning');
        }
        
        // Verificar latência do Firebase
        if (this.metrics.firebase.latency > 2000) {
            this.addAlert('FIREBASE_HIGH_LATENCY', `Latência do Firebase alta: ${this.metrics.firebase.latency}ms`, 'warning');
        }
        
        // Verificar erros do Redis
        if (this.metrics.redis.errors > 5) {
            this.addAlert('REDIS_ERRORS', `Muitos erros do Redis: ${this.metrics.redis.errors}`, 'error');
        }
        
        // Verificar erros do Firebase
        if (this.metrics.firebase.errors > 3) {
            this.addAlert('FIREBASE_ERRORS', `Muitos erros do Firebase: ${this.metrics.firebase.errors}`, 'error');
        }
        
        // Verificar se o Redis está respondendo
        if (now - this.metrics.redis.lastCheck > 60000) {
            this.addAlert('REDIS_UNRESPONSIVE', 'Redis não está respondendo', 'critical');
        }
        
        // Verificar se o Firebase está respondendo
        if (now - this.metrics.firebase.lastCheck > 120000) {
            this.addAlert('FIREBASE_UNRESPONSIVE', 'Firebase não está respondendo', 'critical');
        }

    // Obter relatório completo
    getFullReport() {
        return {
            timestamp: Date.now(),
            redis: this.metrics.redis,
            firebase: this.metrics.firebase,
            system: this.metrics.system,
            alerts: this.alerts.filter(alert => !alert.acknowledged),
            summary: this.getSummary()
        };
    }

    // Obter resumo
    getSummary() {
        const activeAlerts = this.alerts.filter(alert => !alert.acknowledged);
        
        const warningAlerts = activeAlerts.filter(alert => alert.severity === 'warning');
        
        return {
            status: criticalAlerts.length > 0 ? 'critical' : 
                   errorAlerts.length > 0 ? 'error' : 
                   warningAlerts.length > 0 ? 'warning' : 'healthy',
            totalAlerts: activeAlerts.length,
            criticalAlerts: criticalAlerts.length,
            errorAlerts: errorAlerts.length,
            warningAlerts: warningAlerts.length,
            uptime: this.metrics.system.uptime,
            memoryUsage: this.metrics.system.memory.usagePercent,
            cpuLoad: this.metrics.system.cpu
        };
    }

    // Reconhecer alerta
    acknowledgeAlert(alertId) {
         // 24 horas
        this.alerts = this.alerts.filter(alert => alert.timestamp > oneDayAgo);
    }

    // Parar monitoramento
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        console.log('🛑 Monitoramento de recursos parado');
    }

    // Destruir monitor
    destroy() {
        this.stopMonitoring();
    }

// Instância singleton
const resourceMonitor = new ResourceMonitor();

module.exports = resourceMonitor; 