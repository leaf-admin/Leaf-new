#!/usr/bin/env node

// Teste completo de otimizações com módulos disponíveis na arquitetura atual.

console.log('INICIANDO TESTE COMPLETO DE OTIMIZACOES...\n');

const IntelligentCache = require('../../intelligent-cache');

class AdvancedAPM {
    constructor() {
        this.metrics = new Map();
    }

    recordMetric(name, value) {
        const existing = this.metrics.get(name) || [];
        existing.push(Number(value) || 0);
        this.metrics.set(name, existing);
    }

    getMetrics() {
        const output = {};
        for (const [name, values] of this.metrics.entries()) {
            const sum = values.reduce((acc, v) => acc + v, 0);
            output[name] = {
                count: values.length,
                average: values.length > 0 ? sum / values.length : 0
            };
        }
        return output;
    }

    getHealthStatus() {
        return {
            status: 'healthy',
            metricsTracked: this.metrics.size
        };
    }
}

class AdvancedAsyncQueue {
    constructor(options = {}) {
        this.maxConcurrency = options.maxConcurrency || 5;
        this.maxQueueSize = options.maxQueueSize || 1000;
        this.retryAttempts = options.retryAttempts || 2;
        this.active = 0;
        this.queue = [];
        this.completed = 0;
        this.failed = 0;
    }

    async add(taskFn) {
        if (this.queue.length >= this.maxQueueSize) {
            throw new Error('queue_full');
        }

        return new Promise((resolve, reject) => {
            const task = { taskFn, resolve, reject };
            this.queue.push(task);
            this._drain();
        });
    }

    _drain() {
        while (this.active < this.maxConcurrency && this.queue.length > 0) {
            const task = this.queue.shift();
            this.active += 1;
            this._runTask(task).finally(() => {
                this.active -= 1;
                this._drain();
            });
        }
    }

    async _runTask(task) {
        let attempts = 0;
        while (attempts <= this.retryAttempts) {
            try {
                const result = await task.taskFn();
                this.completed += 1;
                task.resolve(result);
                return;
            } catch (error) {
                attempts += 1;
                if (attempts > this.retryAttempts) {
                    this.failed += 1;
                    task.reject(error);
                    return;
                }
            }
        }
    }

    getStats() {
        return {
            queued: this.queue.length,
            active: this.active,
            completed: this.completed,
            failed: this.failed
        };
    }
}

async function testCompleteOptimizations() {
    console.log('FASE 1: INICIALIZANDO MODULOS...');

    // 1) Cache inteligente legado (classe dedicada de teste)
    const cache = new IntelligentCache();
    console.log('OK: Cache Inteligente inicializado');

    // 2) APM simples para validação funcional
    const apm = new AdvancedAPM();
    console.log('OK: APM inicializado');

    // 3) Fila assíncrona com controle de concorrência
    const asyncQueue = new AdvancedAsyncQueue({
        maxConcurrency: 5,
        maxQueueSize: 1000,
        retryAttempts: 3
    });
    console.log('OK: Async Queue inicializada');

    console.log('\nFASE 2: TESTANDO CACHE...');
    cache.set('user:123', { id: 123, name: 'Joao', rides: 15 });
    cache.set('ride:456', { id: 456, status: 'active', distance: 5.2 });
    cache.set('stats:daily', { date: '2026-03-15', totalRides: 150, revenue: 1250.5 });
    cache.warmCache(['user:456', 'ride:789', 'stats:weekly']);
    console.log('Cache Status:', cache.getHealthStatus());

    console.log('\nFASE 3: TESTANDO APM...');
    for (let i = 0; i < 10; i += 1) {
        apm.recordMetric('responseTime', Math.random() * 100 + 50);
        apm.recordMetric('cpuUsage', Math.random() * 20 + 10);
        apm.recordMetric('memoryUsage', Math.random() * 30 + 40);
    }
    const apmMetrics = apm.getMetrics();
    console.log('APM Metrics:', {
        responseTime: apmMetrics.responseTime?.average?.toFixed(2),
        cpuUsage: apmMetrics.cpuUsage?.average?.toFixed(2),
        memoryUsage: apmMetrics.memoryUsage?.average?.toFixed(2)
    });

    console.log('\nFASE 4: TESTANDO ASYNC QUEUE...');
    const tasks = [];
    for (let i = 0; i < 20; i += 1) {
        tasks.push(async () => {
            await new Promise((resolve) => setTimeout(resolve, Math.random() * 60));
            return `Task ${i + 1} completed`;
        });
    }
    const results = await Promise.all(tasks.map((task) => asyncQueue.add(task)));
    console.log('OK: Processadas', results.length, 'tarefas');

    console.log('\nFASE 5: TESTANDO INTEGRACAO...');
    const user = cache.get('user:123');
    if (!user) {
        throw new Error('Usuario nao encontrado no cache');
    }

    apm.recordMetric('cacheHit', 1);
    const operationResult = await asyncQueue.add(async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return `Processed user ${user.id}`;
    });
    console.log('OK: Operacao integrada:', operationResult);

    console.log('\nFASE 6: METRICAS FINAIS...');
    console.log('Cache Final:', cache.getHealthStatus());
    console.log('APM Final:', apm.getHealthStatus());
    console.log('Queue Final:', asyncQueue.getStats());

    console.log('\nTESTE COMPLETO FINALIZADO COM SUCESSO');
    process.exit(0);
}

testCompleteOptimizations().catch((error) => {
    console.error('ERRO:', error.message);
    process.exit(1);
});
