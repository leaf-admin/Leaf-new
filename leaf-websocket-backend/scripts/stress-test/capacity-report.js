#!/usr/bin/env node
/**
 * CAPACITY REPORT
 * 
 * Gera relatório de capacidade do sistema baseado em métricas Prometheus.
 * 
 * Uso:
 *   node scripts/stress-test/capacity-report.js
 */

const axios = require('axios');
const { logStructured, logError } = require('../../utils/logger');

// Parse arguments
const args = process.argv.slice(2);
const prometheusUrl = args.includes('--prometheus')
    ? args[args.indexOf('--prometheus') + 1]
    : 'http://localhost:9090';
const duration = args.includes('--duration')
    ? args[args.indexOf('--duration') + 1] || '5m'
    : '5m';

// Queries Prometheus
const queries = {
    // Throughput
    commandThroughput: 'rate(leaf_command_total[5m])',
    eventThroughput: 'rate(leaf_event_published_total[5m])',
    listenerThroughput: 'rate(leaf_listener_total[5m])',
    
    // Latência
    commandLatencyP95: 'histogram_quantile(0.95, leaf_command_duration_seconds_bucket)',
    listenerLatencyP95: 'histogram_quantile(0.95, leaf_listener_duration_seconds_bucket)',
    redisLatencyP95: 'histogram_quantile(0.95, leaf_redis_duration_seconds_bucket)',
    
    // Erros
    errorRate: 'rate(leaf_command_total{status="failure"}[5m])',
    redisErrorRate: 'rate(leaf_redis_errors_total[5m])',
    
    // Workers
    activeWorkers: 'leaf_workers_active',
    eventBacklog: 'leaf_event_backlog',
    
    // Circuit Breakers
    circuitBreakerOpen: 'leaf_circuit_breaker_state == 1',
    
    // Sistema
    cpuUsage: 'process_cpu_user_seconds_total',
    memoryUsage: 'process_resident_memory_bytes'
};

// Executar query Prometheus
async function queryPrometheus(query) {
    try {
        const response = await axios.get(`${prometheusUrl}/api/v1/query`, {
            params: { query }
        });
        
        if (response.data.status === 'success' && response.data.data.result.length > 0) {
            return response.data.data.result;
        }
        return [];
    } catch (error) {
        logError(error, 'Erro ao consultar Prometheus', {
            service: 'capacity-report',
            query
        });
        return [];
    }
}

// Calcular capacidade
function calculateCapacity(metrics) {
    const capacity = {
        throughput: {
            commands: 0,
            events: 0,
            listeners: 0
        },
        latency: {
            commands: 0,
            listeners: 0,
            redis: 0
        },
        errors: {
            rate: 0,
            redis: 0
        },
        workers: {
            active: 0,
            backlog: 0
        },
        circuitBreakers: {
            open: 0
        },
        system: {
            cpu: 0,
            memory: 0
        },
        recommendations: []
    };

    // Throughput
    if (metrics.commandThroughput.length > 0) {
        capacity.throughput.commands = parseFloat(metrics.commandThroughput[0].value[1]) || 0;
    }
    if (metrics.eventThroughput.length > 0) {
        capacity.throughput.events = parseFloat(metrics.eventThroughput[0].value[1]) || 0;
    }
    if (metrics.listenerThroughput.length > 0) {
        capacity.throughput.listeners = parseFloat(metrics.listenerThroughput[0].value[1]) || 0;
    }

    // Latência
    if (metrics.commandLatencyP95.length > 0) {
        capacity.latency.commands = parseFloat(metrics.commandLatencyP95[0].value[1]) * 1000 || 0; // ms
    }
    if (metrics.listenerLatencyP95.length > 0) {
        capacity.latency.listeners = parseFloat(metrics.listenerLatencyP95[0].value[1]) * 1000 || 0; // ms
    }
    if (metrics.redisLatencyP95.length > 0) {
        capacity.latency.redis = parseFloat(metrics.redisLatencyP95[0].value[1]) * 1000 || 0; // ms
    }

    // Erros
    if (metrics.errorRate.length > 0) {
        capacity.errors.rate = parseFloat(metrics.errorRate[0].value[1]) || 0;
    }
    if (metrics.redisErrorRate.length > 0) {
        capacity.errors.redis = parseFloat(metrics.redisErrorRate[0].value[1]) || 0;
    }

    // Workers
    if (metrics.activeWorkers.length > 0) {
        capacity.workers.active = parseInt(metrics.activeWorkers[0].value[1]) || 0;
    }
    if (metrics.eventBacklog.length > 0) {
        capacity.workers.backlog = parseInt(metrics.eventBacklog[0].value[1]) || 0;
    }

    // Circuit Breakers
    if (metrics.circuitBreakerOpen.length > 0) {
        capacity.circuitBreakers.open = metrics.circuitBreakerOpen.length;
    }

    // Sistema
    if (metrics.cpuUsage.length > 0) {
        capacity.system.cpu = parseFloat(metrics.cpuUsage[0].value[1]) || 0;
    }
    if (metrics.memoryUsage.length > 0) {
        capacity.system.memory = parseFloat(metrics.memoryUsage[0].value[1]) / 1024 / 1024 || 0; // MB
    }

    // Recomendações
    if (capacity.latency.commands > 1000) {
        capacity.recommendations.push('Latência de commands alta (>1s). Considere otimizar ou escalar.');
    }
    if (capacity.latency.listeners > 5000) {
        capacity.recommendations.push('Latência de listeners alta (>5s). Considere adicionar mais workers.');
    }
    if (capacity.workers.backlog > 1000) {
        capacity.recommendations.push(`Backlog alto (${capacity.workers.backlog}). Adicione mais workers.`);
    }
    if (capacity.circuitBreakers.open > 0) {
        capacity.recommendations.push(`${capacity.circuitBreakers.open} circuit breakers abertos. Verifique serviços externos.`);
    }
    if (capacity.errors.rate > capacity.throughput.commands * 0.1) {
        capacity.recommendations.push('Taxa de erro alta (>10%). Investigar causas.');
    }
    if (capacity.system.memory > 2048) {
        capacity.recommendations.push('Uso de memória alto (>2GB). Considere otimizar ou escalar.');
    }

    return capacity;
}

// Função principal
async function generateCapacityReport() {
    logStructured('info', 'Gerando relatório de capacidade', {
        service: 'capacity-report',
        prometheusUrl,
        duration
    });

    // Executar todas as queries
    const metrics = {};
    for (const [name, query] of Object.entries(queries)) {
        metrics[name] = await queryPrometheus(query);
    }

    // Calcular capacidade
    const capacity = calculateCapacity(metrics);

    // Relatório
    const report = {
        timestamp: new Date().toISOString(),
        duration,
        capacity,
        rawMetrics: metrics
    };

    // Salvar relatório
    const fs = require('fs');
    const path = require('path');
    const reportPath = path.join(__dirname, `../../capacity-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Log resumo
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO DE CAPACIDADE');
    console.log('='.repeat(60));
    console.log(`\nThroughput:`);
    console.log(`  Commands: ${capacity.throughput.commands.toFixed(2)}/s`);
    console.log(`  Events: ${capacity.throughput.events.toFixed(2)}/s`);
    console.log(`  Listeners: ${capacity.throughput.listeners.toFixed(2)}/s`);
    console.log(`\nLatência (P95):`);
    console.log(`  Commands: ${capacity.latency.commands.toFixed(2)}ms`);
    console.log(`  Listeners: ${capacity.latency.listeners.toFixed(2)}ms`);
    console.log(`  Redis: ${capacity.latency.redis.toFixed(2)}ms`);
    console.log(`\nErros:`);
    console.log(`  Taxa: ${capacity.errors.rate.toFixed(2)}/s`);
    console.log(`  Redis: ${capacity.errors.redis.toFixed(2)}/s`);
    console.log(`\nWorkers:`);
    console.log(`  Ativos: ${capacity.workers.active}`);
    console.log(`  Backlog: ${capacity.workers.backlog}`);
    console.log(`\nCircuit Breakers:`);
    console.log(`  Abertos: ${capacity.circuitBreakers.open}`);
    console.log(`\nSistema:`);
    console.log(`  CPU: ${capacity.system.cpu.toFixed(2)}%`);
    console.log(`  Memória: ${capacity.system.memory.toFixed(2)}MB`);
    
    if (capacity.recommendations.length > 0) {
        console.log(`\n⚠️  Recomendações:`);
        capacity.recommendations.forEach((rec, i) => {
            console.log(`  ${i + 1}. ${rec}`);
        });
    }
    
    console.log(`\nRelatório completo salvo em: ${reportPath}`);
    console.log('='.repeat(60) + '\n');

    process.exit(0);
}

// Executar
generateCapacityReport().catch(error => {
    logError(error, 'Erro fatal ao gerar relatório de capacidade', {
        service: 'capacity-report'
    });
    process.exit(1);
});

