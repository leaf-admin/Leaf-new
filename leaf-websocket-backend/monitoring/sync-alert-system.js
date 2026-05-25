const Redis = require('ioredis');
const firebaseConfig = require('../firebase-config');

class SyncAlertSystem {
    constructor() {
        this.syncFailures = new Map();
        this.alerts = [];
        this.monitoringInterval = null;

        this.config = {
            alertThresholds: {
                redis: 5,
                firebase: 5,
                sync: 3
            },
            maxFailuresKept: 500,
            maxAlertsKept: 200,
            failureTtlMs: 24 * 60 * 60 * 1000
        };
    }

    startMonitoring(intervalMs = 30000) {
        if (this.monitoringInterval) return;

        this.monitoringInterval = setInterval(() => {
            this.checkSyncHealth().catch((error) => {
                this.recordSyncFailure('sync', 'monitoring_loop', error);
            });
            this.cleanupOldData();
        }, intervalMs);
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }

    recordSyncFailure(type, operation, error, data = null) {
        const failureId = `sync_failure_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const failure = {
            id: failureId,
            type,
            operation,
            error: error?.message || String(error),
            timestamp: Date.now(),
            data,
            retryCount: 0
        };

        this.syncFailures.set(failureId, failure);

        if (this.syncFailures.size > this.config.maxFailuresKept) {
            const entries = Array.from(this.syncFailures.entries()).sort((a, b) => a[1].timestamp - b[1].timestamp);
            const toRemove = entries.slice(0, this.syncFailures.size - this.config.maxFailuresKept);
            for (const [id] of toRemove) {
                this.syncFailures.delete(id);
            }
        }

        this.checkFailureThreshold(type, operation);
        return failureId;
    }

    checkFailureThreshold(type, operation) {
        const now = Date.now();
        const recentFailures = Array.from(this.syncFailures.values()).filter(
            (failure) => failure.type === type && failure.operation === operation && now - failure.timestamp <= 5 * 60 * 1000
        );

        const threshold = this.config.alertThresholds[type] || 5;
        if (recentFailures.length >= threshold) {
            this.createAlert(type, operation, recentFailures);
        }
    }

    createAlert(type, operation, failures) {
        const alert = {
            id: `sync_alert_${type}_${Date.now()}`,
            type: 'SYNC_FAILURE',
            severity: this.getSeverity(type, failures.length),
            message: this.generateAlertMessage(type, operation, failures),
            timestamp: Date.now(),
            acknowledged: false,
            failures: failures.slice(-5),
            recommendations: this.getRecommendations(type, operation)
        };

        this.alerts.push(alert);
        if (this.alerts.length > this.config.maxAlertsKept) {
            this.alerts = this.alerts.slice(-this.config.maxAlertsKept);
        }

        return alert;
    }

    getSeverity(type, failureCount) {
        if (type === 'redis' && failureCount >= 10) return 'critical';
        if (type === 'firebase' && failureCount >= 10) return 'critical';
        if (failureCount >= 8) return 'error';
        return 'warning';
    }

    generateAlertMessage(type, operation, failures) {
        const count = failures.length;
        const first = failures[0];
        const last = failures[failures.length - 1];
        const spanSec = first ? Math.max(1, Math.round((last.timestamp - first.timestamp) / 1000)) : 0;
        const lastError = last?.error || 'erro desconhecido';
        return `${count} falhas de ${type} na operação ${operation} em ${spanSec}s. Último erro: ${lastError}`;
    }

    getRecommendations(type) {
        if (type === 'redis') {
            return [
                'Verificar conectividade com Redis',
                'Validar credenciais e REDIS_URL',
                'Checar saturação de conexões no Redis'
            ];
        }

        if (type === 'firebase') {
            return [
                'Verificar credenciais Firebase Admin',
                'Validar disponibilidade do Realtime DB',
                'Checar permissões de escrita/leitura'
            ];
        }

        return [
            'Verificar integridade dos dados entre Redis e Firebase',
            'Revisar filas/retries de sincronização',
            'Inspecionar logs de erro do backend'
        ];
    }

    async checkSyncHealth() {
        let redis;
        const redisKey = `sync_health:${Date.now()}`;
        const payload = {
            timestamp: Date.now(),
            source: 'sync-alert-system'
        };

        try {
            redis = new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: Number.parseInt(process.env.REDIS_PORT || '6379', 10),
                db: Number.parseInt(process.env.REDIS_DB || '0', 10),
                password: process.env.REDIS_PASSWORD || null,
                lazyConnect: true,
                maxRetriesPerRequest: 1
            });

            await redis.connect();
            await redis.setex(redisKey, 60, JSON.stringify(payload));
            const redisData = await redis.get(redisKey);

            if (!redisData) {
                this.recordSyncFailure('redis', 'health_check', new Error('Falha ao ler chave de teste no Redis'));
                return;
            }

            const db = firebaseConfig.getRealtimeDB();
            if (!db) {
                this.recordSyncFailure('firebase', 'health_check', new Error('Realtime DB indisponivel'));
                return;
            }

            const ref = db.ref('health_check/sync_alert_system');
            await ref.set(payload);
            const snapshot = await ref.once('value');
            const firebaseData = snapshot.val();
            await ref.remove();

            if (!firebaseData || Number(firebaseData.timestamp) !== Number(payload.timestamp)) {
                this.recordSyncFailure('sync', 'health_check', new Error('Dados inconsistentes entre Redis e Firebase'), {
                    redis: JSON.parse(redisData),
                    firebase: firebaseData
                });
            }
        } catch (error) {
            this.recordSyncFailure('sync', 'health_check', error);
        } finally {
            if (redis) {
                try {
                    await redis.del(redisKey);
                    await redis.quit();
                } catch (_) {
                    // ignore
                }
            }
        }
    }

    async checkDataConsistency() {
        // Placeholder leve: em produção pode ser evoluído para checks de entidades críticas.
        return {
            ok: true,
            checkedAt: Date.now(),
            pendingFailures: this.syncFailures.size
        };
    }

    async retrySyncFailure(failureId) {
        const failure = this.syncFailures.get(failureId);
        if (!failure) return false;

        failure.retryCount += 1;
        if (failure.retryCount > 3) {
            return false;
        }

        // Retry genérico não automático para evitar side effects imprevisíveis.
        // Mantemos apenas o contador para observabilidade.
        return true;
    }

    getActiveAlerts() {
        return this.alerts.filter((alert) => !alert.acknowledged);
    }

    getSummary() {
        const active = this.getActiveAlerts();
        const critical = active.filter((alert) => alert.severity === 'critical').length;
        const error = active.filter((alert) => alert.severity === 'error').length;
        const warning = active.filter((alert) => alert.severity === 'warning').length;

        return {
            status: critical > 0 ? 'critical' : error > 0 ? 'error' : warning > 0 ? 'warning' : 'healthy',
            totalAlerts: active.length,
            criticalAlerts: critical,
            errorAlerts: error,
            warningAlerts: warning,
            totalFailures: this.syncFailures.size
        };
    }

    getSyncReport() {
        return {
            timestamp: Date.now(),
            summary: this.getSummary(),
            failures: Array.from(this.syncFailures.values()).sort((a, b) => b.timestamp - a.timestamp).slice(0, 100),
            alerts: this.getActiveAlerts()
        };
    }

    acknowledgeAlert(alertId) {
        const alert = this.alerts.find((item) => item.id === alertId);
        if (!alert) return false;
        alert.acknowledged = true;
        return true;
    }

    cleanupOldData() {
        const cutoff = Date.now() - this.config.failureTtlMs;
        for (const [id, failure] of this.syncFailures.entries()) {
            if (failure.timestamp < cutoff) {
                this.syncFailures.delete(id);
            }
        }

        this.alerts = this.alerts.filter((alert) => alert.timestamp >= cutoff);
    }

    destroy() {
        this.stopMonitoring();
    }
}

const syncAlertSystem = new SyncAlertSystem();

module.exports = syncAlertSystem;
module.exports.SyncAlertSystem = SyncAlertSystem;
