const os = require('os');
const Redis = require('ioredis');
const firebaseConfig = require('../firebase-config');

class ResourceMonitor {
    constructor() {
        this.metrics = {
            redis: {
                connections: 0,
                memoryUsage: '0B',
                memoryPeak: '0B',
                operations: 0,
                errors: 0,
                latency: 0,
                lastCheck: 0,
                status: 'unknown',
                keyspace: {}
            },
            firebase: {
                connections: 0,
                operations: 0,
                errors: 0,
                latency: 0,
                lastCheck: 0,
                status: 'unknown'
            },
            system: {
                cpu: 0,
                memory: {
                    total: 0,
                    free: 0,
                    used: 0,
                    usagePercent: 0
                },
                uptime: 0,
                platform: os.platform(),
                arch: os.arch()
            }
        };

        this.alerts = [];
        this.monitoringInterval = null;
    }

    startMonitoring(intervalMs = 30000) {
        if (this.monitoringInterval) {
            return;
        }

        this.monitoringInterval = setInterval(() => {
            this.runChecks().catch((error) => {
                this.addAlert('MONITORING_LOOP_ERROR', `Erro no loop de monitoramento: ${error.message}`, 'error');
            });
        }, intervalMs);
    }

    async runChecks() {
        await Promise.allSettled([
            this.checkRedisHealth(),
            this.checkFirebaseHealth()
        ]);

        this.checkSystemResources();
        this.checkAlerts();
        this.cleanupOldAlerts();
    }

    async checkRedisHealth() {
        const startTime = Date.now();
        let redis;

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
            await redis.ping();

            const memory = await redis.info('memory');
            const stats = await redis.info('stats');
            const memoryInfo = this.parseRedisInfo(memory);
            const statsInfo = this.parseRedisInfo(stats);

            this.metrics.redis = {
                connections: Number.parseInt(statsInfo.connected_clients || '0', 10),
                memoryUsage: memoryInfo.used_memory_human || '0B',
                memoryPeak: memoryInfo.used_memory_peak_human || '0B',
                operations: Number.parseInt(statsInfo.total_commands_processed || '0', 10),
                errors: Number.parseInt(statsInfo.total_error_replies || '0', 10),
                latency: Date.now() - startTime,
                lastCheck: Date.now(),
                status: 'connected',
                keyspace: await this.getRedisKeyspace(redis)
            };
        } catch (error) {
            this.metrics.redis.errors += 1;
            this.metrics.redis.status = 'error';
            this.metrics.redis.lastCheck = Date.now();
            this.addAlert('REDIS_ERROR', `Erro ao conectar com Redis: ${error.message}`, 'error');
        } finally {
            if (redis) {
                try {
                    await redis.quit();
                } catch (_) {
                    // ignore
                }
            }
        }
    }

    async checkFirebaseHealth() {
        const startTime = Date.now();

        try {
            const db = firebaseConfig.getRealtimeDB();
            if (!db) {
                throw new Error('Realtime DB indisponivel');
            }

            const ref = db.ref('health_check/resource_monitor');
            await ref.set({
                ok: true,
                timestamp: Date.now()
            });
            await ref.remove();

            this.metrics.firebase = {
                connections: 1,
                operations: this.metrics.firebase.operations + 1,
                errors: this.metrics.firebase.errors,
                latency: Date.now() - startTime,
                lastCheck: Date.now(),
                status: 'connected'
            };
        } catch (error) {
            this.metrics.firebase.errors += 1;
            this.metrics.firebase.status = 'error';
            this.metrics.firebase.lastCheck = Date.now();
            this.addAlert('FIREBASE_ERROR', `Erro ao conectar com Firebase: ${error.message}`, 'error');
        }
    }

    checkSystemResources() {
        const total = os.totalmem();
        const free = os.freemem();
        const used = total - free;
        const usagePercent = total > 0 ? (used / total) * 100 : 0;

        this.metrics.system = {
            cpu: os.loadavg()[0],
            memory: {
                total,
                free,
                used,
                usagePercent
            },
            uptime: os.uptime(),
            platform: os.platform(),
            arch: os.arch()
        };
    }

    parseRedisInfo(info) {
        const result = {};
        if (!info) return result;

        for (const line of String(info).split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;

            const idx = trimmed.indexOf(':');
            if (idx === -1) continue;

            const key = trimmed.slice(0, idx);
            const value = trimmed.slice(idx + 1);
            result[key] = value;
        }

        return result;
    }

    async getRedisKeyspace(redis) {
        try {
            const keyspace = await redis.info('keyspace');
            return this.parseRedisInfo(keyspace);
        } catch (_) {
            return {};
        }
    }

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
        if (this.alerts.length > 200) {
            this.alerts = this.alerts.slice(-200);
        }

        return alert;
    }

    checkAlerts() {
        const now = Date.now();

        if (this.metrics.system.memory.usagePercent > 85) {
            this.addAlert('HIGH_MEMORY', `Uso de memoria alto: ${this.metrics.system.memory.usagePercent.toFixed(2)}%`, 'warning');
        }

        if (this.metrics.system.cpu > 2.5) {
            this.addAlert('HIGH_CPU', `Carga de CPU alta: ${this.metrics.system.cpu.toFixed(2)}`, 'warning');
        }

        if (this.metrics.redis.status === 'error') {
            this.addAlert('REDIS_UNHEALTHY', 'Redis com falhas de conectividade', 'critical');
        }

        if (this.metrics.firebase.status === 'error') {
            this.addAlert('FIREBASE_UNHEALTHY', 'Firebase com falhas de conectividade', 'critical');
        }

        if (this.metrics.redis.lastCheck && now - this.metrics.redis.lastCheck > 120000) {
            this.addAlert('REDIS_UNRESPONSIVE', 'Redis sem atualizacao recente de healthcheck', 'critical');
        }

        if (this.metrics.firebase.lastCheck && now - this.metrics.firebase.lastCheck > 180000) {
            this.addAlert('FIREBASE_UNRESPONSIVE', 'Firebase sem atualizacao recente de healthcheck', 'critical');
        }
    }

    getFullReport() {
        return {
            timestamp: Date.now(),
            redis: this.metrics.redis,
            firebase: this.metrics.firebase,
            system: this.metrics.system,
            alerts: this.alerts.filter((alert) => !alert.acknowledged),
            summary: this.getSummary()
        };
    }

    getSummary() {
        const activeAlerts = this.alerts.filter((alert) => !alert.acknowledged);
        const criticalAlerts = activeAlerts.filter((alert) => alert.severity === 'critical');
        const errorAlerts = activeAlerts.filter((alert) => alert.severity === 'error');
        const warningAlerts = activeAlerts.filter((alert) => alert.severity === 'warning');

        return {
            status: criticalAlerts.length > 0
                ? 'critical'
                : errorAlerts.length > 0
                    ? 'error'
                    : warningAlerts.length > 0
                        ? 'warning'
                        : 'healthy',
            totalAlerts: activeAlerts.length,
            criticalAlerts: criticalAlerts.length,
            errorAlerts: errorAlerts.length,
            warningAlerts: warningAlerts.length,
            uptime: this.metrics.system.uptime,
            memoryUsage: this.metrics.system.memory.usagePercent,
            cpuLoad: this.metrics.system.cpu
        };
    }

    acknowledgeAlert(alertId) {
        const alert = this.alerts.find((item) => item.id === alertId);
        if (!alert) return false;
        alert.acknowledged = true;
        return true;
    }

    cleanupOldAlerts(maxAgeMs = 24 * 60 * 60 * 1000) {
        const cutoff = Date.now() - maxAgeMs;
        this.alerts = this.alerts.filter((alert) => alert.timestamp >= cutoff);
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
    }

    destroy() {
        this.stopMonitoring();
    }
}

const resourceMonitor = new ResourceMonitor();

module.exports = resourceMonitor;
