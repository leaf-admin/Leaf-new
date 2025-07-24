const Redis = require('ioredis');
const firebaseConfig = require('../firebase-config');

class SmartSyncAlertSystem {
    constructor() {
        this.syncFailures = new Map();
        this.alerts = [];
        this.monitoringInterval = null;
        this.redis = new Redis({
            host: 'localhost',
            port: 6379,
            lazyConnect: true
        });
        
        this.connectionStats = {
            activeConnections: 0,
            lastConnectionCheck: 0,
            totalConnections: 0,
            disconnectedConnections: 0
        };
        
        this.config = {
            maxSyncFailures: 5,
            syncTimeout: 10000,
            checkInterval: 60000,
            connectionThreshold: 1, // Mínimo de conexões para gerar alertas
            alertThresholds: {
                redis: 3,
                firebase: 2,
                sync: 5
            }
        };
        
        this.startMonitoring();
    }

    // Iniciar monitoramento
    startMonitoring() {
        this.monitoringInterval = setInterval(() => {
            this.checkActiveConnections();
            this.checkSyncHealth();
            this.checkDataConsistency();
            this.cleanupOldFailures();
        }, this.config.checkInterval);
        
        console.log('🧠 Sistema de alertas de sincronização inteligente iniciado');
    }

    // Verificar conexões ativas
    async checkActiveConnections() {
        try {
            // Verificar conexões WebSocket ativas
            const socketConnections = await this.getSocketConnections();
            
            // Verificar conexões Redis ativas
            const redisConnections = await this.getRedisConnections();
            
            // Verificar conexões Firebase ativas
            const firebaseConnections = await this.getFirebaseConnections();
            
            this.connectionStats = {
                activeConnections: socketConnections + redisConnections + firebaseConnections,
                lastConnectionCheck: Date.now(),
                totalConnections: this.connectionStats.totalConnections,
                disconnectedConnections: this.connectionStats.disconnectedConnections
            };
            
            console.log(`📊 Conexões ativas: ${this.connectionStats.activeConnections} (WebSocket: ${socketConnections}, Redis: ${redisConnections}, Firebase: ${firebaseConnections})`);
            
        } catch (error) {
            console.error('❌ Erro ao verificar conexões ativas:', error);
        }
    }

    // Obter conexões WebSocket ativas
    async getSocketConnections() {
        try {
            // Verificar se há dados de motoristas ativos no Redis
            const activeDrivers = await this.redis.keys('drivers:*');
            return activeDrivers.length;
        } catch (error) {
            return 0;
        }
    }

    // Obter conexões Redis ativas
    async getRedisConnections() {
        try {
            const info = await this.redis.info('clients');
            const lines = info.split('\r\n');
            
            for (const line of lines) {
                if (line.startsWith('connected_clients:')) {
                    return parseInt(line.split(':')[1]) || 0;
                }
            }
            
            return 0;
        } catch (error) {
            return 0;
        }
    }

    // Obter conexões Firebase ativas
    async getFirebaseConnections() {
        try {
            // Verificar se há dados no Firebase
            const firebaseData = await firebaseConfig.getFromRealtimeDB('drivers');
            return firebaseData ? Object.keys(firebaseData).length : 0;
        } catch (error) {
            return 0;
        }
    }

    // Registrar falha de sincronização (só se houver conexões ativas)
    recordSyncFailure(type, operation, error, data = null) {
        // Só registrar falhas se houver conexões ativas
        if (this.connectionStats.activeConnections < this.config.connectionThreshold) {
            console.log(`ℹ️ Ignorando falha de sincronização - sem conexões ativas (${this.connectionStats.activeConnections}/${this.config.connectionThreshold})`);
            return null;
        }
        
        const failureId = `${type}_${operation}_${Date.now()}`;
        const failure = {
            id: failureId,
            type,
            operation,
            error: error.message || error,
            timestamp: Date.now(),
            data,
            retryCount: 0,
            activeConnections: this.connectionStats.activeConnections
        };
        
        this.syncFailures.set(failureId, failure);
        
        // Verificar se deve gerar alerta
        this.checkFailureThreshold(type, operation);
        
        console.log(`❌ Falha de sincronização registrada: ${type}/${operation} - ${error.message || error} (Conexões: ${this.connectionStats.activeConnections})`);
        
        return failureId;
    }

    // Verificar limiar de falhas
    checkFailureThreshold(type, operation) {
        const recentFailures = Array.from(this.syncFailures.values())
            .filter(f => f.type === type && f.timestamp > Date.now() - 300000); // Últimos 5 minutos
        
        const threshold = this.config.alertThresholds[type] || 5;
        
        if (recentFailures.length >= threshold) {
            this.createAlert(type, operation, recentFailures);
        }
    }

    // Criar alerta
    createAlert(type, operation, failures) {
        const alert = {
            id: `smart_sync_alert_${type}_${Date.now()}`,
            type: 'SMART_SYNC_FAILURE',
            severity: this.getSeverity(type, failures.length),
            message: this.generateAlertMessage(type, operation, failures),
            timestamp: Date.now(),
            acknowledged: false,
            failures: failures.slice(-5),
            recommendations: this.getRecommendations(type, operation),
            activeConnections: this.connectionStats.activeConnections
        };
        
        this.alerts.push(alert);
        
        // Manter apenas os últimos 20 alertas (reduzido de 50)
        if (this.alerts.length > 20) {
            this.alerts = this.alerts.slice(-20);
        }
        
        console.log(`🚨 ALERTA INTELIGENTE [${alert.severity.toUpperCase()}]: ${alert.message} (Conexões: ${this.connectionStats.activeConnections})`);
        
        return alert;
    }

    // Determinar severidade do alerta
    getSeverity(type, failureCount) {
        if (type === 'redis' && failureCount > 10) return 'critical';
        if (type === 'firebase' && failureCount > 5) return 'critical';
        if (failureCount > 15) return 'critical';
        if (failureCount > 8) return 'error';
        return 'warning';
    }

    // Gerar mensagem de alerta
    generateAlertMessage(type, operation, failures) {
        const count = failures.length;
        const lastFailure = failures[failures.length - 1];
        const timeSpan = Math.round((Date.now() - failures[0].timestamp) / 1000);
        const connections = this.connectionStats.activeConnections;
        
        switch (type) {
            case 'redis':
                return `Falhas de Redis: ${count} falhas em ${timeSpan}s (${connections} conexões ativas)`;
            case 'firebase':
                return `Falhas de Firebase: ${count} falhas em ${timeSpan}s (${connections} conexões ativas)`;
            case 'sync':
                return `Falhas de sincronização: ${count} falhas em ${timeSpan}s (${connections} conexões ativas)`;
            default:
                return `Falhas de ${type}: ${count} falhas em ${timeSpan}s (${connections} conexões ativas)`;
        }
    }

    // Obter recomendações
    getRecommendations(type, operation) {
        switch (type) {
            case 'redis':
                return ['Verificar conectividade Redis', 'Reiniciar container Redis', 'Verificar logs Redis'];
            case 'firebase':
                return ['Verificar credenciais Firebase', 'Verificar conectividade de rede', 'Verificar quota Firebase'];
            case 'sync':
                return ['Verificar sincronização de dados', 'Verificar integridade dos dados', 'Reiniciar serviços'];
            default:
                return ['Verificar logs do sistema', 'Verificar conectividade de rede', 'Contatar suporte'];
        }
    }

    // Verificar saúde da sincronização
    async checkSyncHealth() {
        try {
            // Verificar se há falhas recentes
            const recentFailures = Array.from(this.syncFailures.values())
                .filter(f => f.timestamp > Date.now() - 300000); // Últimos 5 minutos
            
            if (recentFailures.length > 0) {
                console.log(`⚠️ ${recentFailures.length} falhas de sincronização recentes detectadas`);
                
                // Verificar se deve criar alerta geral
                if (recentFailures.length >= this.config.maxSyncFailures) {
                    this.createAlert('sync', 'health_check', recentFailures);
                }
            }
            
        } catch (error) {
            console.error('❌ Erro ao verificar saúde da sincronização:', error);
        }
    }

    // Verificar consistência de dados
    async checkDataConsistency() {
        try {
            // Verificar se há dados no Redis
            const redisData = await this.redis.keys('*');
            const redisCount = redisData.length;
            
            // Verificar se há dados no Firebase (se possível)
            let firebaseCount = 0;
            try {
                const firebaseData = await firebaseConfig.getFromRealtimeDB('drivers');
                firebaseCount = firebaseData ? Object.keys(firebaseData).length : 0;
            } catch (error) {
                console.log('⚠️ Não foi possível verificar dados do Firebase');
            }
            
            // Se há dados no Redis mas não no Firebase, pode indicar problema de sincronização
            if (redisCount > 0 && firebaseCount === 0) {
                console.log(`⚠️ Inconsistência de dados detectada: Redis=${redisCount}, Firebase=${firebaseCount}`);
                this.recordSyncFailure('sync', 'data_consistency', new Error('Dados no Redis mas não no Firebase'), {
                    redisCount,
                    firebaseCount
                });
            }
            
        } catch (error) {
            console.error('❌ Erro ao verificar consistência de dados:', error);
        }
    }

    // Obter relatório de alertas
    getAlertsReport() {
        const activeAlerts = this.alerts.filter(alert => !alert.acknowledged);
        
        return {
            alerts: activeAlerts,
            activeAlerts: activeAlerts.length,
            totalAlerts: this.alerts.length,
            activeConnections: this.connectionStats.activeConnections,
            lastCheck: this.connectionStats.lastConnectionCheck
        };
    }

    // Obter resumo
    getSummary() {
        const activeAlerts = this.alerts.filter(alert => !alert.acknowledged);
        const criticalAlerts = activeAlerts.filter(alert => alert.severity === 'critical');
        const errorAlerts = activeAlerts.filter(alert => alert.severity === 'error');
        const warningAlerts = activeAlerts.filter(alert => alert.severity === 'warning');
        
        return {
            status: criticalAlerts.length > 0 ? 'critical' : 
                   errorAlerts.length > 0 ? 'error' : 
                   warningAlerts.length > 0 ? 'warning' : 'healthy',
            totalAlerts: activeAlerts.length,
            criticalAlerts: criticalAlerts.length,
            errorAlerts: errorAlerts.length,
            warningAlerts: warningAlerts.length,
            activeConnections: this.connectionStats.activeConnections
        };
    }

    // Reconhecer alerta
    acknowledgeAlert(alertId) {
        const alert = this.alerts.find(a => a.id === alertId);
        if (alert) {
            alert.acknowledged = true;
            console.log(`✅ Alerta reconhecido: ${alertId}`);
        }
    }

    // Limpar falhas antigas
    cleanupOldFailures() {
        const oneHourAgo = Date.now() - 3600000; // 1 hora atrás
        const beforeCount = this.syncFailures.size;
        
        for (const [id, failure] of this.syncFailures) {
            if (failure.timestamp < oneHourAgo) {
                this.syncFailures.delete(id);
            }
        }
        
        const afterCount = this.syncFailures.size;
        if (beforeCount !== afterCount) {
            console.log(`🧹 Limpas ${beforeCount - afterCount} falhas antigas (mantidas ${afterCount})`);
        }
    }

    // Parar monitoramento
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
            console.log('🛑 Monitoramento de sincronização parado');
        }
    }

    // Destruir instância
    destroy() {
        this.stopMonitoring();
        if (this.redis) {
            this.redis.disconnect();
        }
        this.alerts = [];
        this.syncFailures.clear();
    }
}

module.exports = SmartSyncAlertSystem; 