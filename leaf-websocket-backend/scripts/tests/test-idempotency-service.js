/**
 * TESTE: Idempotency Service
 * 
 * Valida funcionamento do serviço de idempotency.
 */

const idempotencyService = require('../../services/idempotency-service');
const redisPool = require('../../utils/redis-pool');

console.log('🧪 TESTE: Idempotency Service\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

async function test(name, fn) {
    try {
        await fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (error) {
        console.error(`❌ ${name}: ${error.message}`);
        failed++;
    }
}

async function runTests() {
    // Garantir conexão Redis
    try {
        await redisPool.ensureConnection();
        console.log('✅ Redis conectado\n');
    } catch (error) {
        console.error('❌ Erro ao conectar Redis:', error.message);
        process.exit(1);
    }

    // Teste 1: Gerar chave
    await test('generateKey - Gerar chave válida', () => {
        const key = idempotencyService.generateKey('user123', 'createBooking', 'req456');
        if (key !== 'user123:createBooking:req456') {
            throw new Error(`Chave gerada incorreta: ${key}`);
        }
    });

    // Teste 2: Primeira requisição (deve ser nova)
    await test('checkAndSet - Primeira requisição deve ser nova', async () => {
        const key = idempotencyService.generateKey('user123', 'createBooking', 'test1');
        await idempotencyService.clearKey(key); // Limpar antes
        
        const result = await idempotencyService.checkAndSet(key);
        if (!result.isNew) {
            throw new Error('Primeira requisição deveria ser nova');
        }
        if (result.cachedResult !== null) {
            throw new Error('Primeira requisição não deveria ter resultado cached');
        }
    });

    // Teste 3: Requisição duplicada (deve detectar)
    await test('checkAndSet - Requisição duplicada deve ser detectada', async () => {
        const key = idempotencyService.generateKey('user123', 'createBooking', 'test2');
        await idempotencyService.clearKey(key); // Limpar antes
        
        // Primeira requisição
        const first = await idempotencyService.checkAndSet(key);
        if (!first.isNew) {
            throw new Error('Primeira requisição deveria ser nova');
        }
        
        // Segunda requisição (duplicada)
        const second = await idempotencyService.checkAndSet(key);
        if (second.isNew) {
            throw new Error('Segunda requisição deveria ser detectada como duplicada');
        }
    });

    // Teste 4: Cache de resultado
    await test('cacheResult - Armazenar e recuperar resultado', async () => {
        const key = idempotencyService.generateKey('user123', 'createBooking', 'test3');
        await idempotencyService.clearKey(key); // Limpar antes
        
        // Primeira requisição
        const first = await idempotencyService.checkAndSet(key);
        if (!first.isNew) {
            throw new Error('Primeira requisição deveria ser nova');
        }
        
        // Cachear resultado
        const testResult = { success: true, bookingId: 'booking_123' };
        await idempotencyService.cacheResult(key, testResult);
        
        // Segunda requisição (deve retornar resultado cached)
        const second = await idempotencyService.checkAndSet(key);
        if (second.isNew) {
            throw new Error('Segunda requisição deveria ser detectada como duplicada');
        }
        if (!second.cachedResult || second.cachedResult.bookingId !== 'booking_123') {
            throw new Error('Resultado cached não foi retornado corretamente');
        }
    });

    // Teste 5: TTL customizado
    await test('checkAndSet - TTL customizado', async () => {
        const key = idempotencyService.generateKey('user123', 'createBooking', 'test4');
        await idempotencyService.clearKey(key); // Limpar antes
        
        const result = await idempotencyService.checkAndSet(key, 30); // 30 segundos
        if (!result.isNew) {
            throw new Error('Primeira requisição deveria ser nova');
        }
        
        // Verificar se chave existe com TTL
        const redis = redisPool.getConnection();
        const ttl = await redis.ttl(`idempotency:${key}`);
        if (ttl <= 0 || ttl > 30) {
            throw new Error(`TTL incorreto: ${ttl} (esperado ~30)`);
        }
    });

    // Teste 6: Limpar chave
    await test('clearKey - Limpar chave de idempotency', async () => {
        const key = idempotencyService.generateKey('user123', 'createBooking', 'test5');
        
        // Criar chave
        await idempotencyService.checkAndSet(key);
        
        // Limpar
        await idempotencyService.clearKey(key);
        
        // Verificar se foi limpa (deve permitir nova requisição)
        const result = await idempotencyService.checkAndSet(key);
        if (!result.isNew) {
            throw new Error('Chave deveria ter sido limpa');
        }
    });

    // Limpeza final
    console.log('\n🧹 Limpando chaves de teste...');
    for (let i = 1; i <= 5; i++) {
        const key = idempotencyService.generateKey('user123', 'createBooking', `test${i}`);
        await idempotencyService.clearKey(key);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n📊 RESULTADO: ${passed} passou, ${failed} falhou\n`);

    if (failed === 0) {
        console.log('✅ TODOS OS TESTES PASSARAM!');
        process.exit(0);
    } else {
        console.log('❌ ALGUNS TESTES FALHARAM!');
        process.exit(1);
    }
}

runTests().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});

