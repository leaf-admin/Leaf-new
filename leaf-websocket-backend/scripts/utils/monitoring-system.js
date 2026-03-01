const axios = require('axios');
const { performance } = require('perf_hooks');

class AdvancedMonitoringSystem {
    constructor() {
        this.metrics = {
            requests: { total: 0, success: 0, errors: 0 },
            responseTime: { min: Infinity, max: 0, avg: 0, p95: 0, p99: 0 },
            websockets: { connections: 0, messages: 0, errors: 0 },
            system: { cpu: 0, memory: 0, uptime: 0 },
            instances: {}
        };
        this.responseTimes = [];
        this.startTime = Date.now();
    }

    async collectMetrics() {
        try {
            // Coletar métricas de todas as instâncias
            const instances = ['websocket_1', 'websocket_2'];
            
            for (const instance of instances) {
                try {
                    const response = await axios.get(`http://localhost:8080/health`, { timeout: 5000 });
                    this.metrics.instances[instance] = {
                        status: response.data.status,
                        port: response.data.port,
                        timestamp: response.data.timestamp,
                        healthy: true
                    };
                } catch (error) {
                    this.metrics.instances[instance] = {
                        status: 'unhealthy',
                        error: error.message,
                        healthy: false
                    };
                }
            }

            // Calcular métricas de sistema
            this.metrics.system.uptime = Date.now() - this.startTime;
            this.metrics.system.memory = process.memoryUsage();
            
            return this.metrics;
        } catch (error) {
            console.error('❌ Erro ao coletar métricas:', error);
            return null;
        }
    }

    recordRequest(responseTime, success = true) {
        this.metrics.requests.total++;
        if (success) {
            this.metrics.requests.success++;
        } else {
            this.metrics.requests.errors++;
        }

        this.responseTimes.push(responseTime);
        
        // Manter apenas os últimos 1000 tempos de resposta
        if (this.responseTimes.length > 1000) {
            this.responseTimes.shift();
        }

        // Calcular estatísticas
        this.calculateResponseTimeStats();
    }

    calculateResponseTimeStats() {
        if (this.responseTimes.length === 0) return;

        const sorted = [...this.responseTimes].sort((a, b) => a - b);
        
        this.metrics.responseTime.min = Math.min(...this.responseTimes);
        this.metrics.responseTime.max = Math.max(...this.responseTimes);
        this.metrics.responseTime.avg = this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
        this.metrics.responseTime.p95 = sorted[Math.floor(sorted.length * 0.95)];
        this.metrics.responseTime.p99 = sorted[Math.floor(sorted.length * 0.99)];
    }

    generateReport() {
        const report = {
            timestamp: new Date().toISOString(),
            summary: {
                totalRequests: this.metrics.requests.total,
                successRate: this.metrics.requests.total > 0 ? 
                    (this.metrics.requests.success / this.metrics.requests.total * 100).toFixed(2) + '%' : '0%',
                avgResponseTime: this.metrics.responseTime.avg.toFixed(2) + 'ms',
                p95ResponseTime: this.metrics.responseTime.p95.toFixed(2) + 'ms',
                uptime: Math.floor(this.metrics.system.uptime / 1000) + 's'
            },
            instances: this.metrics.instances,
            performance: {
                min: this.metrics.responseTime.min.toFixed(2) + 'ms',
                max: this.metrics.responseTime.max.toFixed(2) + 'ms',
                avg: this.metrics.responseTime.avg.toFixed(2) + 'ms',
                p95: this.metrics.responseTime.p95.toFixed(2) + 'ms',
                p99: this.metrics.responseTime.p99.toFixed(2) + 'ms'
            }
        };

        return report;
    }

    async runLoadTest(duration = 30000, concurrency = 10) {
        console.log(`🚀 Iniciando teste de carga: ${duration/1000}s, ${concurrency} usuários simultâneos`);
        
        const startTime = Date.now();
        const promises = [];

        for (let i = 0; i < concurrency; i++) {
            promises.push(this.simulateUser(i, duration));
        }

        await Promise.all(promises);
        
        const endTime = Date.now();
        console.log(`✅ Teste de carga concluído em ${(endTime - startTime)/1000}s`);
        
        return this.generateReport();
    }

    async simulateUser(userId, duration) {
        const endTime = Date.now() + duration;
        
        while (Date.now() < endTime) {
            const start = performance.now();
            try {
                await axios.get('http://localhost:8080/health', { timeout: 5000 });
                const end = performance.now();
                this.recordRequest(end - start, true);
            } catch (error) {
                const end = performance.now();
                this.recordRequest(end - start, false);
            }
            
            // Intervalo aleatório entre 100ms e 500ms
            await new Promise(resolve => setTimeout(resolve, Math.random() * 400 + 100));
        }
    }
}

module.exports = AdvancedMonitoringSystem;
