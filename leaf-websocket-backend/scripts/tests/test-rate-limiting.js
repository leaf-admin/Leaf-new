/**
 * Script de Teste: Rate Limiting
 * 
 * Testa se o rate limiting está funcionando corretamente
 */

const rateLimiterService = require('./services/rate-limiter-service');

// Cores para output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

// Contador de testes
let testsPassed = 0;
let testsFailed = 0;
let testsTotal = 0;

function test(name, testFn) {
    testsTotal++;
    try {
        log(`\n🧪 Teste: ${name}`, 'cyan');
        const result = testFn();
        if (result instanceof Promise) {
            return result.then(() => {
                testsPassed++;
                log(`✅ PASSOU: ${name}`, 'green');
            }).catch((error) => {
                testsFailed++;
                log(`❌ FALHOU: ${name}`, 'red');
                log(`   Erro: ${error.message}`, 'red');
                console.error(error);
            });
        } else {
            testsPassed++;
            log(`✅ PASSOU: ${name}`, 'green');
        }
    } catch (error) {
        testsFailed++;
        log(`❌ FALHOU: ${name}`, 'red');
        log(`   Erro: ${error.message}`, 'red');
        console.error(error);
    }
}

async function runTests() {
    log('\n🚀 INICIANDO TESTES DE RATE LIMITING\n', 'blue');
    log('='.repeat(60), 'blue');
    
    const testUserId = `test_user_${Date.now()}`;
    const testEndpoint = 'createBooking';
    const limit = 10; // Limite configurado
    
    // Teste 1: Primeira requisição deve passar
    await test('Primeira requisição deve passar', async () => {
        const result = await rateLimiterService.checkRateLimit(testUserId, testEndpoint);
        
        if (!result.allowed) {
            throw new Error('Primeira requisição foi bloqueada');
        }
        
        if (result.remaining !== limit - 1) {
            throw new Error(`Remaining incorreto. Esperado: ${limit - 1}, Recebido: ${result.remaining}`);
        }
        
        log(`   ✅ Requisição permitida`);
        log(`   Remaining: ${result.remaining}/${limit}`);
    });
    
    // Teste 2: Múltiplas requisições até o limite
    await test(`Fazer ${limit} requisições (deve passar todas)`, async () => {
        // Já fizemos 1, fazer mais limit-1
        for (let i = 0; i < limit - 1; i++) {
            const result = await rateLimiterService.checkRateLimit(testUserId, testEndpoint);
            
            if (!result.allowed) {
                throw new Error(`Requisição ${i + 2} foi bloqueada quando deveria passar`);
            }
        }
        
        log(`   ✅ ${limit} requisições permitidas`);
    });
    
    // Teste 3: Requisição após limite deve ser bloqueada
    await test('Requisição após limite deve ser bloqueada', async () => {
        const result = await rateLimiterService.checkRateLimit(testUserId, testEndpoint);
        
        if (result.allowed) {
            throw new Error('Requisição após limite foi permitida (deveria ser bloqueada)');
        }
        
        if (result.remaining !== 0) {
            throw new Error(`Remaining incorreto. Esperado: 0, Recebido: ${result.remaining}`);
        }
        
        if (!result.resetAt) {
            throw new Error('resetAt não foi fornecido');
        }
        
        log(`   ✅ Requisição bloqueada corretamente`);
        log(`   Remaining: ${result.remaining}`);
        log(`   Reset em: ${new Date(result.resetAt).toISOString()}`);
    });
    
    // Teste 4: Testar diferentes endpoints
    await test('Testar diferentes endpoints com limites diferentes', async () => {
        const testUser2 = `test_user_2_${Date.now()}`;
        
        // confirmPayment: limite 5
        for (let i = 0; i < 5; i++) {
            const result = await rateLimiterService.checkRateLimit(testUser2, 'confirmPayment');
            if (!result.allowed && i < 5) {
                throw new Error(`confirmPayment bloqueado na requisição ${i + 1}`);
            }
        }
        
        // Deve bloquear na 6ª
        const blocked = await rateLimiterService.checkRateLimit(testUser2, 'confirmPayment');
        if (blocked.allowed) {
            throw new Error('confirmPayment não bloqueou após 5 requisições');
        }
        
        log(`   ✅ Limites diferentes funcionando`);
        log(`   confirmPayment: 5/min (bloqueado após 5)`);
    });
    
    // Teste 5: Testar reset
    await test('Resetar rate limit', async () => {
        const testUser3 = `test_user_3_${Date.now()}`;
        
        // Fazer algumas requisições
        await rateLimiterService.checkRateLimit(testUser3, testEndpoint);
        await rateLimiterService.checkRateLimit(testUser3, testEndpoint);
        
        // Resetar
        const resetResult = await rateLimiterService.resetRateLimit(testUser3, testEndpoint);
        
        if (!resetResult.success) {
            throw new Error(`Falha ao resetar: ${resetResult.error}`);
        }
        
        // Verificar info
        const info = await rateLimiterService.getRateLimitInfo(testUser3, testEndpoint);
        
        if (info.count !== 0 && info.count !== undefined) {
            throw new Error(`Count não foi resetado. Esperado: 0, Recebido: ${info.count}`);
        }
        
        log(`   ✅ Rate limit resetado`);
    });
    
    // Teste 6: Testar getRateLimitInfo
    await test('Obter informações de rate limit', async () => {
        const testUser4 = `test_user_4_${Date.now()}`;
        
        // Fazer algumas requisições
        await rateLimiterService.checkRateLimit(testUser4, testEndpoint);
        await rateLimiterService.checkRateLimit(testUser4, testEndpoint);
        
        const info = await rateLimiterService.getRateLimitInfo(testUser4, testEndpoint);
        
        if (info.count !== 2) {
            throw new Error(`Count incorreto. Esperado: 2, Recebido: ${info.count}`);
        }
        
        if (info.remaining !== limit - 2) {
            throw new Error(`Remaining incorreto. Esperado: ${limit - 2}, Recebido: ${info.remaining}`);
        }
        
        if (info.limit !== limit) {
            throw new Error(`Limit incorreto. Esperado: ${limit}, Recebido: ${info.limit}`);
        }
        
        log(`   ✅ Informações corretas`);
        log(`   Count: ${info.count}`);
        log(`   Remaining: ${info.remaining}`);
        log(`   Limit: ${info.limit}`);
    });
    
    // Teste 7: Testar endpoint sem limite configurado
    await test('Endpoint sem limite configurado deve passar', async () => {
        const result = await rateLimiterService.checkRateLimit(testUserId, 'unknownEndpoint');
        
        if (!result.allowed) {
            throw new Error('Endpoint sem limite foi bloqueado');
        }
        
        if (result.remaining !== Infinity) {
            throw new Error(`Remaining incorreto. Esperado: Infinity, Recebido: ${result.remaining}`);
        }
        
        log(`   ✅ Endpoint sem limite permitido`);
    });
    
    // Resumo
    log('\n' + '='.repeat(60), 'blue');
    log(`\n📊 RESUMO DOS TESTES:`, 'blue');
    log(`   Total: ${testsTotal}`, 'cyan');
    log(`   ✅ Passou: ${testsPassed}`, 'green');
    log(`   ❌ Falhou: ${testsFailed}`, 'red');
    log(`   Taxa de sucesso: ${((testsPassed / testsTotal) * 100).toFixed(1)}%`, 
        testsFailed === 0 ? 'green' : 'yellow');
    
    if (testsFailed === 0) {
        log(`\n🎉 TODOS OS TESTES PASSARAM!`, 'green');
        log(`\n✅ O rate limiting está funcionando CORRETAMENTE!`, 'green');
    } else {
        log(`\n⚠️ ALGUNS TESTES FALHARAM`, 'yellow');
        log(`   Verifique os erros acima`, 'yellow');
    }
    
    log(`\n✅ Testes concluídos!\n`, 'green');
    
    process.exit(testsFailed === 0 ? 0 : 1);
}

// Executar testes
runTests().catch((error) => {
    log(`\n❌ ERRO FATAL: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});



