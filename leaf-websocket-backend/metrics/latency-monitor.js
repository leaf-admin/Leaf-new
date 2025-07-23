const Redis = require('ioredis');

class LatencyMonitor {
    constructor() {
        this.metrics = {
            operations: new Map(),
            connections: new Map(),
            errors: new Map(),
            performance: {
                avgLatency: 0,
                maxLatency: 0,
                minLatency: Infinity,
                totalOperations: 0,
                errorRate: 0
            }
        };
        
        this.redis = new Redis({
            host: 'localhost',
            port: 6379,
            lazyConnect: true
        });
        
        this.startTime = Date.now();
        this.cleanupInterval = setInterval(() => this.cleanupOldMetrics(), 300000); // 5 minutos
    }

    // Iniciar medição de latência
    startOperation(operationType, operationId = null) {
        const startTime = Date.now();
        const id = operationId || `${operationType}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.metrics.operations.set(id, {
            type: operationType,
            startTime,
            endTime: null,
            latency: null,
            status: 'running',
            error: null
        });
        
        return id;
    }

    // Finalizar medição de latência
    endOperation(operationId, success = true, error = null) {
        const operation = this.metrics.operations.get(operationId);
        if (!operation) return;
        
        const endTime = Date.now();
        const latency = endTime - operation.startTime;
        
        operation.endTime = endTime;
        operation.latency = latency;
        operation.status = success ? 'success' : 'error';
        operation.error = error;
        
        // Atualizar métricas de performance
        this.updatePerformanceMetrics(operation);
        
        // Salvar no Redis para persistência
        this.saveToRedis(operation);
        
        return latency;
    }

    // Atualizar métricas de performance
    updatePerformanceMetrics(operation) {
        const { performance } = this.metrics;
        
        performance.totalOperations++;
        performance.avgLatency = ((performance.avgLatency * (performance.totalOperations - 1)) + operation.latency) / performance.totalOperations;
        performance.maxLatency = Math.max(performance.maxLatency, operation.latency);
        performance.minLatency = Math.min(performance.minLatency, operation.latency);
        
        // Calcular taxa de erro
        const errorCount = Array.from(this.metrics.operations.values()).filter(op => op.status === 'error').length;
        performance.errorRate = (errorCount / performance.totalOperations) * 100;
    }

    // Salvar métricas no Redis
    async saveToRedis(operation) {
        try {
            const key = `metrics:latency:${operation.type}:${Date.now()}`;
            await this.redis.setex(key, 3600, JSON.stringify(operation)); // Expira em 1 hora
            
            // Salvar estatísticas agregadas
            const statsKey = `metrics:stats:${operation.type}`;
            const stats = await this.getOperationStats(operation.type);
            await this.redis.setex(statsKey, 3600, JSON.stringify(stats));
            
        } catch (error) {
            console.error('❌ Erro ao salvar métricas no Redis:', error);
        }
    }

    // Obter estatísticas de uma operação
    async getOperationStats(operationType) {
        const operations = Array.from(this.metrics.operations.values())
            .filter(op => op.type === operationType && op.latency !== null);
        
        if (operations.length === 0) return null;
        
        const latencies = operations.map(op => op.latency);
        const errors = operations.filter(op => op.status === 'error');
        
        return {
            type: operationType,
            totalOperations: operations.length,
            avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
            minLatency: Math.min(...latencies),
            maxLatency: Math.max(...latencies),
            errorCount: errors.length,
            errorRate: (errors.length / operations.length) * 100,
            lastUpdated: Date.now()
        };
    }

    // Monitorar latência de WebSocket
    monitorWebSocketLatency(socket) {
        const originalEmit = socket.emit;
        
        socket.emit = (event, data) => {
            const operationId = this.startOperation(`websocket_emit_${event}`);
            
            try {
                originalEmit.call(socket, event, data);
                this.endOperation(operationId, true);
            } catch (error) {
                this.endOperation(operationId, false, error.message);
                throw error;
            }
        };
        
        return socket;
    }

    // Monitorar latência de Redis
    async monitorRedisLatency(operation, redisOperation) {
        const operationId = this.startOperation(`redis_${operation}`);
        
        try {
            const startTime = Date.now();
            const result = await redisOperation();
            const latency = Date.now() - startTime;
            
            this.endOperation(operationId, true);
            return result;
        } catch (error) {
            this.endOperation(operationId, false, error.message);
            throw error;
        }
    }

    // Monitorar latência de Firebase
    async monitorFirebaseLatency(operation, firebaseOperation) {
        const operationId = this.startOperation(`firebase_${operation}`);
        
        try {
            const startTime = Date.now();
            const result = await firebaseOperation();
            const latency = Date.now() - startTime;
            
            this.endOperation(operationId, true);
            return result;
        } catch (error) {
            this.endOperation(operationId, false, error.message);
            throw error;
        }
    }

    // Obter relatório de latência
    async getLatencyReport() {
        const report = {
            uptime: Date.now() - this.startTime,
            performance: this.metrics.performance,
            operations: {},
            alerts: []
        };
        
        // Estatísticas por tipo de operação
        const operationTypes = new Set(Array.from(this.metrics.operations.values()).map(op => op.type));
        
        for (const type of operationTypes) {
            const stats = await this.getOperationStats(type);
            if (stats) {
                report.operations[type] = stats;
                
                // Verificar alertas
                if (stats.avgLatency > 1000) { // Mais de 1 segundo
                    report.alerts.push({
                        type: 'HIGH_LATENCY',
                        operation: type,
                        avgLatency: stats.avgLatency,
                        message: `Latência alta detectada: ${stats.avgLatency}ms`
                    });
                }
                
                if (stats.errorRate > 10) { // Mais de 10% de erro
                    report.alerts.push({
                        type: 'HIGH_ERROR_RATE',
                        operation: type,
                        errorRate: stats.errorRate,
                        message: `Taxa de erro alta: ${stats.errorRate.toFixed(2)}%`
                    });
                }
            }
        }
        
        return report;
    }

    // Limpar métricas antigas
    cleanupOldMetrics() {
        const oneHourAgo = Date.now() - 3600000;
        
        for (const [id, operation] of this.metrics.operations) {
            if (operation.startTime < oneHourAgo) {
                this.metrics.operations.delete(id);
            }
        }
    }

    // Obter métricas em tempo real
    getRealTimeMetrics() {
        return {
            uptime: Date.now() - this.startTime,
            performance: this.metrics.performance,
            activeOperations: this.metrics.operations.size
        };
    }

    // Destruir instância
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        if (this.redis) {
            this.redis.disconnect();
        }
    }
}

module.exports = LatencyMonitor; 