const { EventEmitter } = require('events');
const { logger } = require('./logger');

class AsyncQueue extends EventEmitter {
    constructor(options = {}) {
        super();
        
        this.options = {
            concurrency: options.concurrency || 5,
            maxRetries: options.maxRetries || 3,
            retryDelay: options.retryDelay || 1000,
            timeout: options.timeout || 30000,
            ...options
        };

        this.queue = [];
        this.processing = 0;
        this.paused = false;
        this.stats = {
            total: 0,
            completed: 0,
            failed: 0,
            retries: 0,
            avgProcessingTime: 0
        };

        this.startTime = Date.now();
    }

    // Adicionar tarefa à fila
    add(task, priority = 0) {
        const queueItem = {
            id: Date.now() + Math.random(),
            task,
            priority,
            addedAt: Date.now(),
            retries: 0,
            status: 'pending'
        };

        this.queue.push(queueItem);
        this.queue.sort((a, b) => b.priority - a.priority); // Prioridade alta primeiro
        
        this.stats.total++;
        this.emit('taskAdded', queueItem);
        
        this.process();
        return queueItem.id;
    }

    // Obter estatísticas da fila
    getStats() {
        const uptime = Date.now() - this.startTime;
        const throughput = this.stats.completed / (uptime / 1000); // tarefas por segundo
        
        return {
            ...this.stats,
            queueLength: this.queue.length,
            processing: this.processing,
            paused: this.paused,
            concurrency: this.options.concurrency,
            uptime,
            throughput: Math.round(throughput * 100) / 100,
            avgProcessingTime: Math.round(this.stats.avgProcessingTime * 100) / 100
        };
    }

    // Método para processar fila (simplificado)
    async process() {
        if (this.paused || this.processing >= this.options.concurrency) {
            return;
        }

        if (this.queue.length === 0) {
            return;
        }

        const item = this.queue.shift();
        this.processing++;

        try {
            item.status = 'processing';
            item.startedAt = Date.now();
            
            this.emit('taskStarted', item);
            
            // Executar tarefa
            const result = await item.task();
            
            item.status = 'completed';
            item.completedAt = Date.now();
            item.processingTime = item.completedAt - item.startedAt;
            item.result = result;
            
            this.stats.completed++;
            
            this.emit('taskCompleted', item);
            
        } catch (error) {
            item.status = 'failed';
            item.error = error.message;
            item.failedAt = Date.now();
            
            this.stats.failed++;
            logger.error(`❌ Tarefa ${item.id} falhou: ${error.message}`);
            this.emit('taskFailed', item);
        } finally {
            this.processing--;
            this.process(); // Processar próxima tarefa
        }
    }
}

// Fila específica para operações de corrida
const rideQueue = new AsyncQueue({
    concurrency: 5,
    maxRetries: 2,
    retryDelay: 500,
    timeout: 15000
});

module.exports = {
    AsyncQueue,
    rideQueue
};
