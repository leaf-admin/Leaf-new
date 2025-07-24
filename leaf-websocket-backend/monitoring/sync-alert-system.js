const Redis = require('ioredis');

        const failure = {
            id: failureId,
            type, // 'redis', 'firebase', 'sync'
            operation, // 'updateLocation', 'finishTrip', etc.
            error: error.message || error,
            timestamp: Date.now(),
            data,
            retryCount: 0
        };
        
        this.syncFailures.set(failureId, failure);
        
        // Verificar se deve gerar alerta
        this.checkFailureThreshold(type, operation);
        
        console.log(`❌ Falha de sincronização registrada: ${type}/${operation} - ${error.message || error}`);
        
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

    // Criar alerta
    createAlert(type, operation, failures) {
        const alert = {
            id: `sync_alert_${type}_${Date.now()}`,
            type: 'SYNC_FAILURE',
            severity: this.getSeverity(type, failures.length),
            message: this.generateAlertMessage(type, operation, failures),
            timestamp: Date.now(),
            acknowledged: false,
            failures: failures.slice(-5), // Últimas 5 falhas
            recommendations: this.getRecommendations(type, operation)
        };
        
        this.alerts.push(alert);
        
        // Manter apenas os últimos 50 alertas
        if (this.alerts.length > 50) {
            this.alerts = this.alerts.slice(-50);
        }
        
        console.log(`🚨 ALERTA DE SINCRONIZAÇÃO [${alert.severity.toUpperCase()}]: ${alert.message}`);
        
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
        
        const timeSpan = Math.round((Date.now() - failures[0].timestamp) / 1000);
        
        switch (type) {
            case 'redis':
                return `${count} falhas do Redis na operação ${operation} nos últimos ${timeSpan}s. Último erro: ${lastFailure.error}`;
            case 'firebase':
                return `${count} falhas do Firebase na operação ${operation} nos últimos ${timeSpan}s. Último erro: ${lastFailure.error}`;
            case 'sync':
                return `${count} falhas de sincronização na operação ${operation} nos últimos ${timeSpan}s. Último erro: ${lastFailure.error}`;
            default:
                return `${count} falhas de ${type} na operação ${operation} nos últimos ${timeSpan}s`;
        }

    // Obter recomendações
    getRecommendations(type, operation) {
        
            await this.redis.setex(redisKey, 60, JSON.stringify(testData));
            
            // 2. Sincronizar com Firebase
            await firebaseConfig.syncToRealtimeDB('sync_test', testData);
            
            // 3. Verificar se os dados estão consistentes
            const redisData = await this.redis.get(redisKey);
            
                const firebaseParsed = firebaseData;
                
                if (redisParsed.timestamp === firebaseParsed.timestamp) {
                    console.log('✅ Sincronização Redis <-> Firebase funcionando corretamente');
                } else {
                    this.recordSyncFailure('sync', 'health_check', new Error('Dados inconsistentes entre Redis e Firebase'));
                }
            } else {
                this.recordSyncFailure('sync', 'health_check', new Error('Dados não encontrados em um dos sistemas'));
            }
            
            // Limpar dados de teste
            await this.redis.del(redisKey);
            await firebaseConfig.deleteFromRealtimeDB('sync_test');
            
        } catch (error) {
            this.recordSyncFailure('sync', 'health_check', error);
        }

    // Verificar consistência de dados
    async checkDataConsistency() {
        try {
            // Verificar se há dados órfãos
            
            
            if (redisKeys.length > 0 && !firebaseData) {
                this.recordSyncFailure('sync', 'data_consistency', new Error('Dados no Redis sem correspondência no Firebase'));
            }
            
            // Verificar se há dados muito antigos
            const oneHourAgo = Date.now() - 3600000;
            for (const key of redisKeys) {
                
                    if (parsed.lastUpdate && parsed.lastUpdate < oneHourAgo) {
                        this.recordSyncFailure('sync', 'stale_data', new Error(`Dados antigos detectados: ${key}`));
                    }
            
        } catch (error) {
            this.recordSyncFailure('sync', 'data_consistency', error);
        }

    // Tentar recuperar falha
    async retrySyncFailure(failureId) {
        const failure = this.syncFailures.get(failureId);
        if (!failure) return false;
        
        try {
            failure.retryCount++;
            
            switch (failure.type) {
                case 'redis':
                    await this.retryRedisOperation(failure);
                    break;
                case 'firebase':
                    await this.retryFirebaseOperation(failure);
                    break;
                case 'sync':
                    await this.retrySyncOperation(failure);
                    break;
            }
            
            // Remover falha se recuperada com sucesso
            this.syncFailures.delete(failureId);
            console.log(`✅ Falha recuperada: ${failureId}`);
            return true;
            
        } catch (error) {
            console.log(`❌ Falha na recuperação: ${failureId} - ${error.message}`);
            return false;
        }

    // Tentar recuperar operação do Redis
    async retryRedisOperation(failure) {
        if (failure.data) {
            const { operation, key, value } = failure.data;
            switch (operation) {
                case 'set':
                    await this.redis.set(key, value);
                    break;
                case 'del':
                    await this.redis.del(key);
                    break;
                case 'geoadd':
                    await this.redis.geoadd(key, value.lng, value.lat, value.member);
                    break;
            }

    // Tentar recuperar operação do Firebase
    async retryFirebaseOperation(failure) {
        if (failure.data) {
            const { operation, path, data } = failure.data;
            switch (operation) {
                case 'set':
                    await firebaseConfig.syncToRealtimeDB(path, data);
                    break;
                case 'delete':
                    await firebaseConfig.deleteFromRealtimeDB(path);
                    break;
            }

    // Tentar recuperar operação de sincronização
    async retrySyncOperation(failure) {
        // Implementar lógica de recuperação específica
        console.log(`🔄 Tentativa de recuperação de sincronização: ${failure.operation}`);
    }

    // Obter relatório de alertas
    getAlertsReport() {
        
        const criticalAlerts = activeAlerts.filter(alert => alert.severity === 'critical');
        
        
        return {
            status: criticalAlerts.length > 0 ? 'critical' : 
                   errorAlerts.length > 0 ? 'error' : 
                   warningAlerts.length > 0 ? 'warning' : 'healthy',
            totalAlerts: activeAlerts.length,
            criticalAlerts: criticalAlerts.length,
            errorAlerts: errorAlerts.length,
            warningAlerts: warningAlerts.length
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

    // Limpar falhas antigas
    cleanupOldFailures() {
        

module.exports = syncAlertSystem; 
const firebaseConfig = require('../firebase-config');

class SyncAlertSystem {
    constructor() {
        this.syncFailures = new Map();
        this.alerts = [];
        this.monitoringInterval = null;
        this.redis = new Redis({
            host: 'localhost',
            port: 6379,
            lazyConnect: true
        });
        
        this.config = {
            maxSyncFailures: 5, // Máximo de falhas antes do alerta
            syncTimeout: 10000, // 10 segundos timeout
            checkInterval: 60000, // Verificar a cada 1 minuto
            alertThresholds: {
                redis: 3, // 3 falhas do Redis
                firebase: 2, // 2 falhas do Firebase
                sync: 5 // 5 falhas de sincronização
            }
        };
        
        this.startMonitoring();
    }

    // Iniciar monitoramento
    startMonitoring() {
        this.monitoringInterval = setInterval(() => {
            this.checkSyncHealth();
            this.checkDataConsistency();
            this.cleanupOldFailures();
        }, this.config.checkInterval);
        
        console.log('🔔 Sistema de alertas de sincronização iniciado');
    }

    // Registrar falha de sincronização
    recordSyncFailure(type, operation, error, data = null) {
        
        
        if (recentFailures.length >= threshold) {
            this.createAlert(type, operation, recentFailures);
        }

    // Criar alerta
    createAlert(type, operation, failures) {
        const alert = {
            id: `sync_alert_${type}_${Date.now()}`,
            type: 'SYNC_FAILURE',
            severity: this.getSeverity(type, failures.length),
            message: this.generateAlertMessage(type, operation, failures),
            timestamp: Date.now(),
            acknowledged: false,
            failures: failures.slice(-5), // Últimas 5 falhas
            recommendations: this.getRecommendations(type, operation)
        };
        
        this.alerts.push(alert);
        
        // Manter apenas os últimos 50 alertas
        if (this.alerts.length > 50) {
            this.alerts = this.alerts.slice(-50);
        }
        
        console.log(`🚨 ALERTA DE SINCRONIZAÇÃO [${alert.severity.toUpperCase()}]: ${alert.message}`);
        
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
        
        
        switch (type) {
            case 'redis':
                return `${count} falhas do Redis na operação ${operation} nos últimos ${timeSpan}s. Último erro: ${lastFailure.error}`;
            case 'firebase':
                return `${count} falhas do Firebase na operação ${operation} nos últimos ${timeSpan}s. Último erro: ${lastFailure.error}`;
            case 'sync':
                return `${count} falhas de sincronização na operação ${operation} nos últimos ${timeSpan}s. Último erro: ${lastFailure.error}`;
            default:
                return `${count} falhas de ${type} na operação ${operation} nos últimos ${timeSpan}s`;
        }

    // Obter recomendações
    getRecommendations(type, operation) {
        const recommendations = [];
        
        switch (type) {
            case 'redis':
                recommendations.push('Verificar conectividade com Redis');
                recommendations.push('Verificar uso de memória do Redis');
                recommendations.push('Verificar configurações de timeout');
                break;
            case 'firebase':
                recommendations.push('Verificar conectividade com Firebase');
                recommendations.push('Verificar credenciais do Firebase');
                recommendations.push('Verificar regras de segurança');
                break;
            case 'sync':
                recommendations.push('Verificar latência de rede');
                recommendations.push('Implementar retry automático');
                recommendations.push('Verificar consistência de dados');
                break;
        }
        
        recommendations.push('Monitorar logs do sistema');
        recommendations.push('Verificar recursos do servidor');
        
        return recommendations;
    }

    // Verificar saúde da sincronização
    async checkSyncHealth() {
        try {
            // Testar sincronização Redis -> Firebase
            const testData = {
                test: true,
                timestamp: Date.now(),
                source: 'sync_health_check'
            };
            
            // 1. Salvar no Redis
            
            const firebaseData = await firebaseConfig.getFromRealtimeDB('sync_test');
            
            if (redisData && firebaseData) {
                
                
                if (redisParsed.timestamp === firebaseParsed.timestamp) {
                    console.log('✅ Sincronização Redis <-> Firebase funcionando corretamente');
                } else {
                    this.recordSyncFailure('sync', 'health_check', new Error('Dados inconsistentes entre Redis e Firebase'));
                }
            } else {
                this.recordSyncFailure('sync', 'health_check', new Error('Dados não encontrados em um dos sistemas'));
            }
            
            // Limpar dados de teste
            await this.redis.del(redisKey);
            await firebaseConfig.deleteFromRealtimeDB('sync_test');
            
        } catch (error) {
            this.recordSyncFailure('sync', 'health_check', error);
        }

    // Verificar consistência de dados
    async checkDataConsistency() {
        try {
            // Verificar se há dados órfãos
            const redisKeys = await this.redis.keys('drivers:*');
            
            for (const key of redisKeys) {
                const data = await this.redis.get(key);
                if (data) {
                    
        if (!failure) return false;
        
        try {
            failure.retryCount++;
            
            switch (failure.type) {
                case 'redis':
                    await this.retryRedisOperation(failure);
                    break;
                case 'firebase':
                    await this.retryFirebaseOperation(failure);
                    break;
                case 'sync':
                    await this.retrySyncOperation(failure);
                    break;
            }
            
            // Remover falha se recuperada com sucesso
            this.syncFailures.delete(failureId);
            console.log(`✅ Falha recuperada: ${failureId}`);
            return true;
            
        } catch (error) {
            console.log(`❌ Falha na recuperação: ${failureId} - ${error.message}`);
            return false;
        }

    // Tentar recuperar operação do Redis
    async retryRedisOperation(failure) {
        if (failure.data) {
            const { operation, key, value } = failure.data;
            switch (operation) {
                case 'set':
                    await this.redis.set(key, value);
                    break;
                case 'del':
                    await this.redis.del(key);
                    break;
                case 'geoadd':
                    await this.redis.geoadd(key, value.lng, value.lat, value.member);
                    break;
            }

    // Tentar recuperar operação do Firebase
    async retryFirebaseOperation(failure) {
        if (failure.data) {
            const { operation, path, data } = failure.data;
            switch (operation) {
                case 'set':
                    await firebaseConfig.syncToRealtimeDB(path, data);
                    break;
                case 'delete':
                    await firebaseConfig.deleteFromRealtimeDB(path);
                    break;
            }

    // Tentar recuperar operação de sincronização
    async retrySyncOperation(failure) {
        // Implementar lógica de recuperação específica
        console.log(`🔄 Tentativa de recuperação de sincronização: ${failure.operation}`);
    }

    // Obter relatório de alertas
    getAlertsReport() {
        const activeAlerts = this.alerts.filter(alert => !alert.acknowledged);
        const recentFailures = Array.from(this.syncFailures.values())
            .filter(f => f.timestamp > Date.now() - 3600000); // Última hora
        
        return {
            timestamp: Date.now(),
            activeAlerts: activeAlerts.length,
            totalFailures: this.syncFailures.size,
            recentFailures: recentFailures.length,
            alerts: activeAlerts,
            failures: recentFailures,
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

    // Limpar falhas antigas
    cleanupOldFailures() {
        const oneHourAgo = Date.now() - 3600000;
        
        for (const [id, failure] of this.syncFailures.entries()) {
            if (failure.timestamp < oneHourAgo) {
                this.syncFailures.delete(id);
            }

    // Parar monitoramento
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        console.log('🛑 Sistema de alertas de sincronização parado');
    }

    // Destruir sistema
    destroy() {
        this.stopMonitoring();
        if (this.redis) {
            this.redis.disconnect();
        }

// Instância singleton


class SyncAlertSystem {
    constructor() {
        this.syncFailures = new Map();
        this.alerts = [];
        this.monitoringInterval = null;
        this.redis = new Redis({
            host: 'localhost',
            port: 6379,
            lazyConnect: true
        });
        
        this.config = {
            maxSyncFailures: 5, // Máximo de falhas antes do alerta
            syncTimeout: 10000, // 10 segundos timeout
            checkInterval: 60000, // Verificar a cada 1 minuto
            alertThresholds: {
                redis: 3, // 3 falhas do Redis
                firebase: 2, // 2 falhas do Firebase
                sync: 5 // 5 falhas de sincronização
            }
        };
        
        this.startMonitoring();
    }

    // Iniciar monitoramento
    startMonitoring() {
        this.monitoringInterval = setInterval(() => {
            this.checkSyncHealth();
            this.checkDataConsistency();
            this.cleanupOldFailures();
        }, this.config.checkInterval);
        
        console.log('🔔 Sistema de alertas de sincronização iniciado');
    }

    // Registrar falha de sincronização
    recordSyncFailure(type, operation, error, data = null) {
        const failureId = `${type}_${operation}_${Date.now()}`;
        const failure = {
            id: failureId,
            type, // 'redis', 'firebase', 'sync'
            operation, // 'updateLocation', 'finishTrip', etc.
            error: error.message || error,
            timestamp: Date.now(),
            data,
            retryCount: 0
        };
        
        this.syncFailures.set(failureId, failure);
        
        // Verificar se deve gerar alerta
        this.checkFailureThreshold(type, operation);
        
        console.log(`❌ Falha de sincronização registrada: ${type}/${operation} - ${error.message || error}`);
        
        return failureId;
    }

    // Verificar limiar de falhas
    checkFailureThreshold(type, operation) {
        const recentFailures = Array.from(this.syncFailures.values())
            .filter(f => f.type === type && f.timestamp > Date.now() - 300000); // Últimos 5 minutos
        
        
        const lastFailure = failures[failures.length - 1];
        
        
        switch (type) {
            case 'redis':
                recommendations.push('Verificar conectividade com Redis');
                recommendations.push('Verificar uso de memória do Redis');
                recommendations.push('Verificar configurações de timeout');
                break;
            case 'firebase':
                recommendations.push('Verificar conectividade com Firebase');
                recommendations.push('Verificar credenciais do Firebase');
                recommendations.push('Verificar regras de segurança');
                break;
            case 'sync':
                recommendations.push('Verificar latência de rede');
                recommendations.push('Implementar retry automático');
                recommendations.push('Verificar consistência de dados');
                break;
        }
        
        recommendations.push('Monitorar logs do sistema');
        recommendations.push('Verificar recursos do servidor');
        
        return recommendations;
    }

    // Verificar saúde da sincronização
    async checkSyncHealth() {
        try {
            // Testar sincronização Redis -> Firebase
            const testData = {
                test: true,
                timestamp: Date.now(),
                source: 'sync_health_check'
            };
            
            // 1. Salvar no Redis
            const redisKey = 'sync_test';
            await this.redis.setex(redisKey, 60, JSON.stringify(testData));
            
            // 2. Sincronizar com Firebase
            await firebaseConfig.syncToRealtimeDB('sync_test', testData);
            
            // 3. Verificar se os dados estão consistentes
            
            
            if (redisData && firebaseData) {
                const redisParsed = JSON.parse(redisData);
                
            const firebaseData = await firebaseConfig.getFromRealtimeDB('drivers');
            
            if (redisKeys.length > 0 && !firebaseData) {
                this.recordSyncFailure('sync', 'data_consistency', new Error('Dados no Redis sem correspondência no Firebase'));
            }
            
            // Verificar se há dados muito antigos
            
                if (data) {
                    const parsed = JSON.parse(data);
                    if (parsed.lastUpdate && parsed.lastUpdate < oneHourAgo) {
                        this.recordSyncFailure('sync', 'stale_data', new Error(`Dados antigos detectados: ${key}`));
                    }
            
        } catch (error) {
            this.recordSyncFailure('sync', 'data_consistency', error);
        }

    // Tentar recuperar falha
    async retrySyncFailure(failureId) {
        
        const recentFailures = Array.from(this.syncFailures.values())
            .filter(f => f.timestamp > Date.now() - 3600000); // Última hora
        
        return {
            timestamp: Date.now(),
            activeAlerts: activeAlerts.length,
            totalFailures: this.syncFailures.size,
            recentFailures: recentFailures.length,
            alerts: activeAlerts,
            failures: recentFailures,
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
            warningAlerts: warningAlerts.length
        };
    }

    // Reconhecer alerta
    acknowledgeAlert(alertId) {
        
        
        for (const [id, failure] of this.syncFailures.entries()) {
            if (failure.timestamp < oneHourAgo) {
                this.syncFailures.delete(id);
            }

    // Parar monitoramento
    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        console.log('🛑 Sistema de alertas de sincronização parado');
    }

    // Destruir sistema
    destroy() {
        this.stopMonitoring();
        if (this.redis) {
            this.redis.disconnect();
        }

// Instância singleton
const syncAlertSystem = new SyncAlertSystem();

module.exports = syncAlertSystem; 