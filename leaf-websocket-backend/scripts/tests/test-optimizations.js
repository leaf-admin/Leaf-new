#!/usr/bin/env node

/**
 * Teste de Otimizações - Validação Pós-Otimização
 * 
 * Testa se as otimizações não quebraram funcionalidades:
 * 1. Redis SCAN (substituição de KEYS)
 * 2. TTLs configurados
 * 3. Cache inteligente
 * 4. Rate limiting
 * 5. DataLoaders otimizados
 */

const redisPool = require('../../utils/redis-pool');
const RedisScan = require('../../utils/redis-scan');
const intelligentCache = require('../../utils/intelligent-cache');
const { getTTL, TTL_CONFIG } = require('../../config/redis-ttl-config');
const OptimizedDataLoader = require('../../utils/optimized-dataloader');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

let testsPassed = 0;
let testsFailed = 0;
const results = [];

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function test(name, fn) {
    return async () => {
        try {
            log(`\n🧪 Testando: ${name}`, 'cyan');
            await fn();
            testsPassed++;
            log(`✅ PASSOU: ${name}`, 'green');
            results.push({ name, status: 'PASSOU', error: null });
        } catch (error) {
            testsFailed++;
            log(`❌ FALHOU: ${name}`, 'red');
            log(`   Erro: ${error.message}`, 'red');
            results.push({ name, status: 'FALHOU', error: error.message });
        }
    };
}

async function runTests() {
    log('\n═══════════════════════════════════════════════════════════', 'blue');
    log('🚀 TESTE DE OTIMIZAÇÕES - VALIDAÇÃO PÓS-OTIMIZAÇÃO', 'blue');
    log('═══════════════════════════════════════════════════════════\n', 'blue');

    const redis = redisPool.getConnection();

    // Teste 1: Redis SCAN funciona
    await test('Redis SCAN - Escanear chaves', async () => {
        // Criar algumas chaves de teste
        await redis.set('test:scan:1', 'value1');
        await redis.set('test:scan:2', 'value2');
        await redis.set('test:scan:3', 'value3');

        const keys = await RedisScan.scanKeys(redis, 'test:scan:*');
        
        if (keys.length < 3) {
            throw new Error(`Esperado pelo menos 3 chaves, encontrado ${keys.length}`);
        }

        // Limpar
        await redis.del('test:scan:1', 'test:scan:2', 'test:scan:3');
    })();

    // Teste 2: Redis SCAN countKeys funciona
    await test('Redis SCAN - Contar chaves', async () => {
        await redis.set('test:count:1', 'value1');
        await redis.set('test:count:2', 'value2');

        const count = await RedisScan.countKeys(redis, 'test:count:*');
        
        if (count < 2) {
            throw new Error(`Esperado pelo menos 2 chaves, encontrado ${count}`);
        }

        await redis.del('test:count:1', 'test:count:2');
    })();

    // Teste 3: TTL Config existe e funciona
    await test('TTL Config - Obter TTLs', async () => {
        const driverLocationTTL = getTTL('DRIVER_LOCATION', 'ONLINE');
        const driverLockTTL = getTTL('DRIVER_LOCK', 'DEFAULT');

        if (!driverLocationTTL || driverLocationTTL <= 0) {
            throw new Error(`TTL inválido para DRIVER_LOCATION: ${driverLocationTTL}`);
        }

        if (!driverLockTTL || driverLockTTL <= 0) {
            throw new Error(`TTL inválido para DRIVER_LOCK: ${driverLockTTL}`);
        }

        log(`   DRIVER_LOCATION.ONLINE: ${driverLocationTTL}s`, 'yellow');
        log(`   DRIVER_LOCK.DEFAULT: ${driverLockTTL}s`, 'yellow');
    })();

    // Teste 4: Cache inteligente funciona
    await test('Cache Inteligente - Get/Set', async () => {
        let callCount = 0;
        
        const result = await intelligentCache.getOrSet(
            'test-cache-key',
            async () => {
                callCount++;
                return { data: 'test', timestamp: Date.now() };
            },
            'CACHE.USER_PROFILE'
        );

        if (!result || !result.data) {
            throw new Error('Cache não retornou dados corretos');
        }

        if (callCount !== 1) {
            throw new Error(`Função de fetch chamada ${callCount} vezes (esperado 1)`);
        }

        // Segunda chamada deve usar cache
        const cachedResult = await intelligentCache.getOrSet(
            'test-cache-key',
            async () => {
                callCount++;
                return { data: 'test', timestamp: Date.now() };
            },
            'CACHE.USER_PROFILE'
        );

        if (callCount !== 1) {
            throw new Error(`Cache não funcionou - função chamada ${callCount} vezes (esperado 1)`);
        }

        // Limpar cache
        await intelligentCache.invalidate('test-cache-key', 'CACHE');
    })();

    // Teste 5: Rate Limiter existe e funciona
    await test('Rate Limiter - Verificar existência', async () => {
        const websocketRateLimiter = require('../../middleware/websocket-rate-limiter');
        
        if (!websocketRateLimiter) {
            throw new Error('Rate limiter não encontrado');
        }

        if (typeof websocketRateLimiter.checkConnection !== 'function') {
            throw new Error('Método checkConnection não encontrado');
        }

        if (typeof websocketRateLimiter.unregisterConnection !== 'function') {
            throw new Error('Método unregisterConnection não encontrado');
        }

        log('   Rate limiter carregado com sucesso', 'yellow');
    })();

    // Teste 6: Connection Cleanup Service existe
    await test('Connection Cleanup Service - Verificar existência', async () => {
        const ConnectionCleanupService = require('../../services/connection-cleanup-service');
        
        if (!ConnectionCleanupService) {
            throw new Error('ConnectionCleanupService não encontrado');
        }

        log('   ConnectionCleanupService carregado com sucesso', 'yellow');
    })();

    // Teste 7: Optimized DataLoader existe
    await test('Optimized DataLoader - Verificar existência', async () => {
        if (typeof OptimizedDataLoader.createUserLoader !== 'function') {
            throw new Error('createUserLoader não encontrado');
        }

        if (typeof OptimizedDataLoader.createDriverLoader !== 'function') {
            throw new Error('createDriverLoader não encontrado');
        }

        if (typeof OptimizedDataLoader.createBookingLoader !== 'function') {
            throw new Error('createBookingLoader não encontrado');
        }

        log('   OptimizedDataLoader carregado com sucesso', 'yellow');
    })();

    // Teste 8: Redis maxmemory-policy configurado
    await test('Redis - maxmemory-policy configurado', async () => {
        const info = await redis.info('memory');
        const maxmemoryPolicy = info.match(/maxmemory_policy:(\w+)/)?.[1];

        if (!maxmemoryPolicy) {
            throw new Error('maxmemory-policy não encontrado na configuração do Redis');
        }

        log(`   maxmemory-policy: ${maxmemoryPolicy}`, 'yellow');
    })();

    // Resumo
    log('\n═══════════════════════════════════════════════════════════', 'blue');
    log('📊 RESUMO DOS TESTES', 'blue');
    log('═══════════════════════════════════════════════════════════\n', 'blue');

    log(`✅ Testes passaram: ${testsPassed}`, 'green');
    log(`❌ Testes falharam: ${testsFailed}`, testsFailed > 0 ? 'red' : 'green');
    log(`📊 Total: ${testsPassed + testsFailed}`, 'cyan');

    if (testsFailed > 0) {
        log('\n❌ TESTES FALHARAM:', 'red');
        results.filter(r => r.status === 'FALHOU').forEach(r => {
            log(`   - ${r.name}: ${r.error}`, 'red');
        });
        process.exit(1);
    } else {
        log('\n✅ TODOS OS TESTES PASSARAM!', 'green');
        process.exit(0);
    }
}

// Executar testes
runTests().catch(error => {
    log(`\n❌ ERRO FATAL: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});
