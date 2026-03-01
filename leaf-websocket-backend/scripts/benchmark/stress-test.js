#!/usr/bin/env node

/**
 * Stress Test - Simulação de Carga de Pico
 * 
 * Simula cenário real com:
 * - 2 vCPU
 * - 4GB RAM
 * 
 * Testa limites do sistema:
 * - Conexões WebSocket simultâneas
 * - Queries Redis em paralelo
 * - Cache hits/misses
 * - Uso de memória e CPU
 */

const redisPool = require('../../utils/redis-pool');
const RedisScan = require('../../utils/redis-scan');
const intelligentCache = require('../../utils/intelligent-cache');
const { performance } = require('perf_hooks');
const os = require('os');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

// Configuração de recursos simulados
const TARGET_CONFIG = {
    vCPU: 2,
    RAM_GB: 4,
    RAM_BYTES: 4 * 1024 * 1024 * 1024 // 4GB em bytes
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatTime(ms) {
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}

function getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
        rss: usage.rss,
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external,
        percentage: (usage.rss / TARGET_CONFIG.RAM_BYTES) * 100
    };
}

function getCPUUsage() {
    const usage = process.cpuUsage();
    return {
        user: usage.user / 1000000, // segundos
        system: usage.system / 1000000
    };
}

/**
 * Teste 1: Conexões WebSocket simultâneas (simulado)
 */
async function testWebSocketConnections(numConnections) {
    log(`\n🔌 Teste: ${numConnections} conexões WebSocket simultâneas`, 'cyan');
    
    const startTime = performance.now();
    const startMemory = getMemoryUsage();
    const startCPU = getCPUUsage();
    
    // Simular conexões (cada conexão consome ~50KB de memória)
    const connections = [];
    const connectionMemory = 50 * 1024; // 50KB por conexão
    
    for (let i = 0; i < numConnections; i++) {
        connections.push({
            id: `socket_${i}`,
            userId: `user_${i}`,
            userType: i % 2 === 0 ? 'driver' : 'customer',
            memory: connectionMemory
        });
    }
    
    // Simular operações por conexão
    const operations = [];
    for (const conn of connections) {
        operations.push(
            redisPool.getConnection().hset(`connection:${conn.id}`, {
                userId: conn.userId,
                userType: conn.userType,
                connectedAt: Date.now()
            })
        );
    }
    
    await Promise.all(operations);
    
    const endTime = performance.now();
    const endMemory = getMemoryUsage();
    const endCPU = getCPUUsage();
    
    const totalTime = endTime - startTime;
    const memoryIncrease = endMemory.rss - startMemory.rss;
    const estimatedMemory = numConnections * connectionMemory;
    
    log(`   ⏱️ Tempo: ${formatTime(totalTime)}`, 'yellow');
    log(`   💾 Memória usada: ${formatBytes(memoryIncrease)}`, 'yellow');
    log(`   💾 Memória estimada por conexão: ${formatBytes(estimatedMemory)}`, 'yellow');
    log(`   💾 RSS atual: ${formatBytes(endMemory.rss)} (${endMemory.percentage.toFixed(2)}% de ${TARGET_CONFIG.RAM_GB}GB)`, 'yellow');
    log(`   🖥️ CPU: User ${endCPU.user.toFixed(2)}s, System ${endCPU.system.toFixed(2)}s`, 'yellow');
    
    // Verificar limites
    const maxConnections = Math.floor((TARGET_CONFIG.RAM_BYTES * 0.7) / connectionMemory); // 70% da RAM
    const isWithinLimits = endMemory.rss < TARGET_CONFIG.RAM_BYTES * 0.8; // 80% de segurança
    
    if (isWithinLimits) {
        log(`   ✅ Dentro dos limites (máximo estimado: ${maxConnections} conexões)`, 'green');
    } else {
        log(`   ⚠️ Próximo do limite (máximo estimado: ${maxConnections} conexões)`, 'red');
    }
    
    return {
        connections: numConnections,
        time: totalTime,
        memoryIncrease,
        estimatedMemory,
        currentRSS: endMemory.rss,
        memoryPercentage: endMemory.percentage,
        maxConnections,
        isWithinLimits
    };
}

/**
 * Teste 2: Queries Redis em paralelo
 */
async function testRedisQueries(numQueries) {
    log(`\n📊 Teste: ${numQueries} queries Redis em paralelo`, 'cyan');
    
    const redis = redisPool.getConnection();
    
    // Criar chaves de teste
    const testKeys = [];
    for (let i = 0; i < 1000; i++) {
        await redis.set(`stress:test:${i}`, `value${i}`);
        testKeys.push(`stress:test:${i}`);
    }
    
    const startTime = performance.now();
    const startMemory = getMemoryUsage();
    
    // Executar queries em paralelo
    const queries = [];
    for (let i = 0; i < numQueries; i++) {
        queries.push(
            RedisScan.scanKeys(redis, 'stress:test:*')
        );
    }
    
    const results = await Promise.all(queries);
    
    const endTime = performance.now();
    const endMemory = getMemoryUsage();
    
    const totalTime = endTime - startTime;
    const avgTime = totalTime / numQueries;
    const memoryIncrease = endMemory.rss - startMemory.rss;
    
    // Limpar
    await redis.del(...testKeys);
    
    log(`   ⏱️ Tempo total: ${formatTime(totalTime)}`, 'yellow');
    log(`   ⏱️ Tempo médio por query: ${formatTime(avgTime)}`, 'yellow');
    log(`   💾 Memória usada: ${formatBytes(memoryIncrease)}`, 'yellow');
    log(`   📊 Queries por segundo: ${(numQueries / (totalTime / 1000)).toFixed(2)}`, 'yellow');
    
    const isWithinLimits = avgTime < 100; // Menos de 100ms por query
    
    if (isWithinLimits) {
        log(`   ✅ Performance dentro dos limites`, 'green');
    } else {
        log(`   ⚠️ Performance degradada (${formatTime(avgTime)} por query)`, 'red');
    }
    
    return {
        queries: numQueries,
        totalTime,
        avgTime,
        queriesPerSecond: numQueries / (totalTime / 1000),
        memoryIncrease,
        isWithinLimits
    };
}

/**
 * Teste 3: Cache hits/misses em alta frequência
 */
async function testCachePerformance(numOperations) {
    log(`\n💾 Teste: ${numOperations} operações de cache`, 'cyan');
    
    const startTime = performance.now();
    const startMemory = getMemoryUsage();
    
    // Misturar hits e misses (70% hits, 30% misses)
    const operations = [];
    const cacheKeys = [];
    
    for (let i = 0; i < numOperations; i++) {
        const isHit = i % 10 < 7; // 70% hits
        const key = `stress:cache:${i % 100}`; // Reutilizar 100 chaves
        
        if (!isHit && !cacheKeys.includes(key)) {
            cacheKeys.push(key);
        }
        
        operations.push(
            intelligentCache.getOrSet(
                key,
                async () => ({
                    data: `test_${i}`,
                    timestamp: Date.now(),
                    largeData: 'x'.repeat(1000) // 1KB de dados
                }),
                'CACHE'
            )
        );
    }
    
    await Promise.all(operations);
    
    const endTime = performance.now();
    const endMemory = getMemoryUsage();
    
    const totalTime = endTime - startTime;
    const avgTime = totalTime / numOperations;
    const memoryIncrease = endMemory.rss - startMemory.rss;
    const opsPerSecond = numOperations / (totalTime / 1000);
    
    // Limpar cache
    for (const key of cacheKeys) {
        await intelligentCache.invalidate(key, 'CACHE');
    }
    
    log(`   ⏱️ Tempo total: ${formatTime(totalTime)}`, 'yellow');
    log(`   ⏱️ Tempo médio por operação: ${formatTime(avgTime)}`, 'yellow');
    log(`   💾 Memória usada: ${formatBytes(memoryIncrease)}`, 'yellow');
    log(`   📊 Operações por segundo: ${opsPerSecond.toFixed(2)}`, 'yellow');
    
    const isWithinLimits = avgTime < 1 && opsPerSecond > 1000;
    
    if (isWithinLimits) {
        log(`   ✅ Performance excelente`, 'green');
    } else {
        log(`   ⚠️ Performance pode melhorar`, 'yellow');
    }
    
    return {
        operations: numOperations,
        totalTime,
        avgTime,
        opsPerSecond,
        memoryIncrease,
        isWithinLimits
    };
}

/**
 * Teste 4: Carga mista (cenário real)
 */
async function testMixedLoad(durationSeconds = 60) {
    log(`\n🔥 Teste: Carga mista por ${durationSeconds} segundos`, 'cyan');
    log(`   Simulando: 1000 conexões, 100 queries/s, 1000 cache ops/s`, 'yellow');
    
    const startTime = performance.now();
    const startMemory = getMemoryUsage();
    const startCPU = getCPUUsage();
    
    const connections = 1000;
    const queriesPerSecond = 100;
    const cacheOpsPerSecond = 1000;
    
    let totalQueries = 0;
    let totalCacheOps = 0;
    let errors = 0;
    
    const redis = redisPool.getConnection();
    
    // Criar chaves de teste
    for (let i = 0; i < 500; i++) {
        await redis.set(`mixed:test:${i}`, `value${i}`);
    }
    
    const interval = setInterval(async () => {
        const elapsed = (performance.now() - startTime) / 1000;
        
        if (elapsed >= durationSeconds) {
            clearInterval(interval);
            return;
        }
        
        // Executar queries
        for (let i = 0; i < queriesPerSecond; i++) {
            RedisScan.scanKeys(redis, 'mixed:test:*')
                .then(() => totalQueries++)
                .catch(() => errors++);
        }
        
        // Executar cache ops
        for (let i = 0; i < cacheOpsPerSecond; i++) {
            intelligentCache.getOrSet(
                `mixed:cache:${i % 50}`,
                async () => ({ data: `test_${i}`, timestamp: Date.now() }),
                'CACHE'
            )
                .then(() => totalCacheOps++)
                .catch(() => errors++);
        }
    }, 1000); // A cada segundo
    
    // Aguardar duração do teste
    await new Promise(resolve => setTimeout(resolve, durationSeconds * 1000));
    clearInterval(interval);
    
    const endTime = performance.now();
    const endMemory = getMemoryUsage();
    const endCPU = getCPUUsage();
    
    const totalTime = (endTime - startTime) / 1000;
    const memoryIncrease = endMemory.rss - startMemory.rss;
    const cpuIncrease = {
        user: endCPU.user - startCPU.user,
        system: endCPU.system - startCPU.system
    };
    
    // Limpar
    const testKeys = await RedisScan.scanKeys(redis, 'mixed:test:*');
    if (testKeys.length > 0) {
        await redis.del(...testKeys);
    }
    
    log(`   ⏱️ Tempo total: ${totalTime.toFixed(2)}s`, 'yellow');
    log(`   📊 Queries executadas: ${totalQueries}`, 'yellow');
    log(`   📊 Cache ops executadas: ${totalCacheOps}`, 'yellow');
    log(`   ❌ Erros: ${errors}`, errors > 0 ? 'red' : 'green');
    log(`   💾 Memória usada: ${formatBytes(memoryIncrease)}`, 'yellow');
    log(`   💾 RSS atual: ${formatBytes(endMemory.rss)} (${endMemory.percentage.toFixed(2)}% de ${TARGET_CONFIG.RAM_GB}GB)`, 'yellow');
    log(`   🖥️ CPU: User ${cpuIncrease.user.toFixed(2)}s, System ${cpuIncrease.system.toFixed(2)}s`, 'yellow');
    
    const isWithinLimits = endMemory.rss < TARGET_CONFIG.RAM_BYTES * 0.8 && errors === 0;
    
    if (isWithinLimits) {
        log(`   ✅ Sistema aguentou a carga!`, 'green');
    } else {
        log(`   ⚠️ Sistema próximo do limite ou com erros`, 'red');
    }
    
    return {
        duration: totalTime,
        connections,
        totalQueries,
        totalCacheOps,
        errors,
        memoryIncrease,
        currentRSS: endMemory.rss,
        memoryPercentage: endMemory.percentage,
        cpuIncrease,
        isWithinLimits
    };
}

async function runStressTest() {
    log('\n═══════════════════════════════════════════════════════════', 'blue');
    log('🔥 STRESS TEST - SIMULAÇÃO DE CARGA DE PICO', 'blue');
    log('═══════════════════════════════════════════════════════════', 'blue');
    log(`\n🎯 Configuração Alvo:`, 'cyan');
    log(`   vCPU: ${TARGET_CONFIG.vCPU}`, 'yellow');
    log(`   RAM: ${TARGET_CONFIG.RAM_GB}GB`, 'yellow');
    log(`   Sistema Real: ${os.cpus().length} CPUs, ${formatBytes(os.totalmem())} RAM`, 'yellow');
    
    const results = {
        timestamp: new Date().toISOString(),
        targetConfig: TARGET_CONFIG,
        actualConfig: {
            cpus: os.cpus().length,
            totalMemory: os.totalmem()
        },
        tests: {}
    };
    
    try {
        // Teste 1: Conexões WebSocket (crescente)
        log('\n═══════════════════════════════════════════════════════════', 'magenta');
        log('FASE 1: TESTE DE CONEXÕES WEBSOCKET', 'magenta');
        log('═══════════════════════════════════════════════════════════', 'magenta');
        
        const connectionTests = [100, 500, 1000, 2000, 5000];
        results.tests.websocketConnections = [];
        
        for (const numConn of connectionTests) {
            const result = await testWebSocketConnections(numConn);
            results.tests.websocketConnections.push(result);
            
            if (!result.isWithinLimits) {
                log(`\n⚠️ Limite atingido em ${numConn} conexões`, 'red');
                break;
            }
            
            // Aguardar um pouco entre testes
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Teste 2: Queries Redis
        log('\n═══════════════════════════════════════════════════════════', 'magenta');
        log('FASE 2: TESTE DE QUERIES REDIS', 'magenta');
        log('═══════════════════════════════════════════════════════════', 'magenta');
        
        const queryTests = [10, 50, 100, 500, 1000];
        results.tests.redisQueries = [];
        
        for (const numQueries of queryTests) {
            const result = await testRedisQueries(numQueries);
            results.tests.redisQueries.push(result);
            
            if (!result.isWithinLimits) {
                log(`\n⚠️ Limite atingido em ${numQueries} queries`, 'red');
                break;
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Teste 3: Cache
        log('\n═══════════════════════════════════════════════════════════', 'magenta');
        log('FASE 3: TESTE DE CACHE', 'magenta');
        log('═══════════════════════════════════════════════════════════', 'magenta');
        
        const cacheTests = [100, 500, 1000, 5000, 10000];
        results.tests.cache = [];
        
        for (const numOps of cacheTests) {
            const result = await testCachePerformance(numOps);
            results.tests.cache.push(result);
            
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Teste 4: Carga mista (cenário real)
        log('\n═══════════════════════════════════════════════════════════', 'magenta');
        log('FASE 4: TESTE DE CARGA MISTA (CENÁRIO REAL)', 'magenta');
        log('═══════════════════════════════════════════════════════════', 'magenta');
        
        results.tests.mixedLoad = await testMixedLoad(30); // 30 segundos
        
        // Resumo final
        log('\n═══════════════════════════════════════════════════════════', 'blue');
        log('📊 RESUMO DO STRESS TEST', 'blue');
        log('═══════════════════════════════════════════════════════════', 'blue');
        
        const finalMemory = getMemoryUsage();
        log(`\n💾 Memória Final:`, 'cyan');
        log(`   RSS: ${formatBytes(finalMemory.rss)} (${finalMemory.percentage.toFixed(2)}% de ${TARGET_CONFIG.RAM_GB}GB)`, 'yellow');
        log(`   Heap Used: ${formatBytes(finalMemory.heapUsed)}`, 'yellow');
        
        // Calcular limites
        const maxConnections = results.tests.websocketConnections
            .filter(r => r.isWithinLimits)
            .map(r => r.connections)
            .reduce((a, b) => Math.max(a, b), 0);
        
        const maxQueries = results.tests.redisQueries
            .filter(r => r.isWithinLimits)
            .map(r => r.queries)
            .reduce((a, b) => Math.max(a, b), 0);
        
        log(`\n🎯 LIMITES IDENTIFICADOS:`, 'cyan');
        log(`   ✅ Máximo de conexões: ~${maxConnections}`, 'green');
        log(`   ✅ Máximo de queries paralelas: ~${maxQueries}`, 'green');
        log(`   ✅ Carga mista: ${results.tests.mixedLoad.isWithinLimits ? 'AGUENTOU' : 'LIMITE ATINGIDO'}`, 
            results.tests.mixedLoad.isWithinLimits ? 'green' : 'red');
        
        // Salvar resultados
        const fs = require('fs');
        const filename = `stress-test-results-${Date.now()}.json`;
        fs.writeFileSync(filename, JSON.stringify(results, null, 2));
        log(`\n📄 Resultados salvos em: ${filename}`, 'green');
        
    } catch (error) {
        log(`\n❌ ERRO: ${error.message}`, 'red');
        console.error(error);
        process.exit(1);
    }
}

// Executar stress test
runStressTest().catch(error => {
    log(`\n❌ ERRO FATAL: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});

