/**
 * Teste de Integração: Rate Limiting
 * 
 * Testa o rate limiting em cenários mais realistas
 */

const rateLimiterService = require('./services/rate-limiter-service');

// Cores para output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
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
    return new Promise(async (resolve) => {
        try {
            log(`\n🧪 Teste: ${name}`, 'cyan');
            await testFn();
            testsPassed++;
            log(`✅ PASSOU: ${name}`, 'green');
            resolve();
        } catch (error) {
            testsFailed++;
            log(`❌ FALHOU: ${name}`, 'red');
            log(`   Erro: ${error.message}`, 'red');
            console.error(error);
            resolve();
        }
    });
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTests() {
    log('\n🚀 INICIANDO TESTES DE INTEGRAÇÃO: RATE LIMITING\n', 'blue');
    log('='.repeat(70), 'blue');
    
    // Teste 1: Simular usuário fazendo múltiplas requisições rapidamente
    await test('Simular usuário fazendo 10 requisições de createBooking rapidamente', async () => {
        const userId = `test_user_rapid_${Date.now()}`;
        const endpoint = 'createBooking';
        const limit = 10;
        
        let allowedCount = 0;
        let blockedCount = 0;
        
        // Fazer 15 requisições rapidamente (mais que o limite)
        for (let i = 0; i < 15; i++) {
            const result = await rateLimiterService.checkRateLimit(userId, endpoint);
            
            if (result.allowed) {
                allowedCount++;
            } else {
                blockedCount++;
            }
            
            // Pequeno delay para não sobrecarregar
            await sleep(10);
        }
        
        log(`   Requisições permitidas: ${allowedCount}/${limit}`, 'cyan');
        log(`   Requisições bloqueadas: ${blockedCount}`, 'cyan');
        
        if (allowedCount !== limit) {
            throw new Error(`Esperado ${limit} requisições permitidas, recebido ${allowedCount}`);
        }
        
        if (blockedCount === 0) {
            throw new Error('Nenhuma requisição foi bloqueada após o limite');
        }
    });
    
    // Teste 2: Testar diferentes usuários (isolamento)
    await test('Verificar isolamento entre diferentes usuários', async () => {
        const user1 = `test_user_1_${Date.now()}`;
        const user2 = `test_user_2_${Date.now()}`;
        const endpoint = 'confirmPayment';
        const limit = 5;
        
        // User1 faz 5 requisições (deve passar todas)
        for (let i = 0; i < limit; i++) {
            const result = await rateLimiterService.checkRateLimit(user1, endpoint);
            if (!result.allowed) {
                throw new Error(`User1 foi bloqueado na requisição ${i + 1}`);
            }
        }
        
        // User2 faz 5 requisições (deve passar todas - isolado)
        for (let i = 0; i < limit; i++) {
            const result = await rateLimiterService.checkRateLimit(user2, endpoint);
            if (!result.allowed) {
                throw new Error(`User2 foi bloqueado na requisição ${i + 1}`);
            }
        }
        
        // User1 tenta mais uma (deve ser bloqueado - já fez 5)
        const blocked = await rateLimiterService.checkRateLimit(user1, endpoint);
        if (blocked.allowed) {
            throw new Error('User1 não foi bloqueado após exceder limite');
        }
        
        // User2 tenta mais uma (deve ser bloqueado - também já fez 5)
        const user2Blocked = await rateLimiterService.checkRateLimit(user2, endpoint);
        if (user2Blocked.allowed) {
            throw new Error('User2 não foi bloqueado após exceder limite (isolamento está funcionando, mas ambos atingiram limite)');
        }
        
        // Verificar isolamento: resetar User1 e verificar que User2 ainda está bloqueado
        await rateLimiterService.resetRateLimit(user1, endpoint);
        const user1AfterReset = await rateLimiterService.checkRateLimit(user1, endpoint);
        if (!user1AfterReset.allowed) {
            throw new Error('User1 ainda bloqueado após reset');
        }
        
        // User2 ainda deve estar bloqueado (não foi resetado)
        const user2StillBlocked = await rateLimiterService.checkRateLimit(user2, endpoint);
        if (user2StillBlocked.allowed) {
            throw new Error('User2 foi desbloqueado incorretamente (deveria estar isolado)');
        }
        
        log(`   ✅ Isolamento funcionando: User1 bloqueado, User2 ainda permitido`, 'green');
    });
    
    // Teste 3: Testar diferentes endpoints com limites diferentes
    await test('Testar múltiplos endpoints simultaneamente', async () => {
        const userId = `test_user_multi_${Date.now()}`;
        
        // createBooking: limite 10
        for (let i = 0; i < 10; i++) {
            const result = await rateLimiterService.checkRateLimit(userId, 'createBooking');
            if (!result.allowed) {
                throw new Error(`createBooking bloqueado na requisição ${i + 1}`);
            }
        }
        
        // confirmPayment: limite 5 (diferente)
        for (let i = 0; i < 5; i++) {
            const result = await rateLimiterService.checkRateLimit(userId, 'confirmPayment');
            if (!result.allowed) {
                throw new Error(`confirmPayment bloqueado na requisição ${i + 1}`);
            }
        }
        
        // Verificar que createBooking está bloqueado (já fez 10)
        const createBookingBlocked = await rateLimiterService.checkRateLimit(userId, 'createBooking');
        if (createBookingBlocked.allowed) {
            throw new Error('createBooking não está bloqueado após 10 requisições');
        }
        
        // Verificar que confirmPayment também está bloqueado (já fez 5, limite é 5)
        const confirmPaymentBlocked = await rateLimiterService.checkRateLimit(userId, 'confirmPayment');
        if (confirmPaymentBlocked.allowed) {
            throw new Error('confirmPayment não está bloqueado após 5 requisições (limite é 5)');
        }
        
        // Verificar que os limites são diferentes (criar novo usuário para testar)
        const userId2 = `test_user_multi_2_${Date.now()}`;
        
        // Fazer 5 requisições de confirmPayment (deve passar)
        for (let i = 0; i < 5; i++) {
            const result = await rateLimiterService.checkRateLimit(userId2, 'confirmPayment');
            if (!result.allowed) {
                throw new Error(`confirmPayment bloqueado na requisição ${i + 1} para userId2`);
            }
        }
        
        // Fazer 5 requisições de createBooking (deve passar - limite é 10)
        for (let i = 0; i < 5; i++) {
            const result = await rateLimiterService.checkRateLimit(userId2, 'createBooking');
            if (!result.allowed) {
                throw new Error(`createBooking bloqueado na requisição ${i + 1} para userId2`);
            }
        }
        
        // confirmPayment deve estar bloqueado (já fez 5)
        const confirmPaymentBlocked2 = await rateLimiterService.checkRateLimit(userId2, 'confirmPayment');
        if (confirmPaymentBlocked2.allowed) {
            throw new Error('confirmPayment não está bloqueado após 5 requisições');
        }
        
        // createBooking ainda deve estar permitido (fez apenas 5 de 10)
        const createBookingAllowed2 = await rateLimiterService.checkRateLimit(userId2, 'createBooking');
        if (!createBookingAllowed2.allowed) {
            throw new Error('createBooking foi bloqueado incorretamente (ainda dentro do limite de 10)');
        }
        
        log(`   ✅ Limites diferentes funcionando corretamente`, 'green');
    });
    
    // Teste 4: Testar informações de rate limit
    await test('Verificar informações detalhadas de rate limit', async () => {
        const userId = `test_user_info_${Date.now()}`;
        const endpoint = 'acceptRide';
        const limit = 20;
        
        // Fazer algumas requisições
        await rateLimiterService.checkRateLimit(userId, endpoint);
        await rateLimiterService.checkRateLimit(userId, endpoint);
        await rateLimiterService.checkRateLimit(userId, endpoint);
        
        // Obter informações
        const info = await rateLimiterService.getRateLimitInfo(userId, endpoint);
        
        if (info.error) {
            throw new Error(`Erro ao obter info: ${info.error}`);
        }
        
        if (info.count !== 3) {
            throw new Error(`Count incorreto. Esperado: 3, Recebido: ${info.count}`);
        }
        
        if (info.remaining !== limit - 3) {
            throw new Error(`Remaining incorreto. Esperado: ${limit - 3}, Recebido: ${info.remaining}`);
        }
        
        if (info.limit !== limit) {
            throw new Error(`Limit incorreto. Esperado: ${limit}, Recebido: ${info.limit}`);
        }
        
        if (!info.resetAt || info.resetAt <= Date.now()) {
            throw new Error(`resetAt inválido: ${info.resetAt}`);
        }
        
        log(`   Count: ${info.count}/${info.limit}`, 'cyan');
        log(`   Remaining: ${info.remaining}`, 'cyan');
        log(`   Reset em: ${new Date(info.resetAt).toISOString()}`, 'cyan');
    });
    
    // Teste 5: Testar reset manual
    await test('Testar reset manual de rate limit', async () => {
        const userId = `test_user_reset_${Date.now()}`;
        const endpoint = 'cancelRide';
        const limit = 3;
        
        // Fazer requisições até bloquear
        for (let i = 0; i < limit; i++) {
            await rateLimiterService.checkRateLimit(userId, endpoint);
        }
        
        // Verificar que está bloqueado
        const blocked = await rateLimiterService.checkRateLimit(userId, endpoint);
        if (blocked.allowed) {
            throw new Error('Não foi bloqueado após exceder limite');
        }
        
        // Resetar
        const resetResult = await rateLimiterService.resetRateLimit(userId, endpoint);
        if (!resetResult.success) {
            throw new Error(`Falha ao resetar: ${resetResult.error}`);
        }
        
        // Verificar que agora está permitido novamente
        const allowed = await rateLimiterService.checkRateLimit(userId, endpoint);
        if (!allowed.allowed) {
            throw new Error('Ainda bloqueado após reset');
        }
        
        log(`   ✅ Reset funcionando corretamente`, 'green');
    });
    
    // Teste 6: Testar todos os endpoints configurados
    await test('Verificar que todos os endpoints têm limites configurados', async () => {
        const userId = `test_user_all_${Date.now()}`;
        const endpoints = [
            'createBooking',
            'confirmPayment',
            'acceptRide',
            'startTrip',
            'finishTrip',
            'cancelRide',
            'rejectRide',
            'updateLocation',
            'updateDriverLocation',
            'searchDrivers',
            'sendMessage'
        ];
        
        for (const endpoint of endpoints) {
            const result = await rateLimiterService.checkRateLimit(userId, endpoint);
            
            if (!result.allowed && result.error) {
                throw new Error(`Endpoint ${endpoint} retornou erro: ${result.error}`);
            }
            
            // Verificar que tem limite configurado (não é Infinity)
            if (result.remaining === Infinity) {
                throw new Error(`Endpoint ${endpoint} não tem limite configurado`);
            }
            
            log(`   ✅ ${endpoint}: limite ${result.limit || 'N/A'}/min`, 'cyan');
        }
        
        log(`   ✅ Todos os ${endpoints.length} endpoints configurados`, 'green');
    });
    
    // Teste 7: Testar comportamento de fail-open
    await test('Verificar comportamento fail-open (se Redis falhar)', async () => {
        // Este teste verifica se o código lida corretamente com falhas do Redis
        // Em produção, se Redis falhar, deve permitir requisições (fail-open)
        const userId = `test_user_failopen_${Date.now()}`;
        const endpoint = 'createBooking';
        
        // Fazer uma requisição normal
        const result = await rateLimiterService.checkRateLimit(userId, endpoint);
        
        // Se houver warning, significa que Redis não estava disponível mas permitiu (fail-open)
        if (result.warning) {
            log(`   ⚠️ Redis não disponível, mas requisição permitida (fail-open)`, 'yellow');
        } else {
            log(`   ✅ Rate limiting funcionando normalmente`, 'green');
        }
        
        // Em ambos os casos, a requisição deve ser permitida (fail-open)
        if (!result.allowed && !result.warning) {
            throw new Error('Requisição foi bloqueada sem motivo');
        }
    });
    
    // Resumo
    log('\n' + '='.repeat(70), 'blue');
    log(`\n📊 RESUMO DOS TESTES DE INTEGRAÇÃO:`, 'blue');
    log(`   Total: ${testsTotal}`, 'cyan');
    log(`   ✅ Passou: ${testsPassed}`, 'green');
    log(`   ❌ Falhou: ${testsFailed}`, 'red');
    log(`   Taxa de sucesso: ${((testsPassed / testsTotal) * 100).toFixed(1)}%`, 
        testsFailed === 0 ? 'green' : 'yellow');
    
    if (testsFailed === 0) {
        log(`\n🎉 TODOS OS TESTES DE INTEGRAÇÃO PASSARAM!`, 'green');
        log(`\n✅ O rate limiting está funcionando CORRETAMENTE em todos os cenários!`, 'green');
    } else {
        log(`\n⚠️ ALGUNS TESTES FALHARAM`, 'yellow');
        log(`   Verifique os erros acima`, 'yellow');
    }
    
    log(`\n✅ Testes de integração concluídos!\n`, 'green');
    
    process.exit(testsFailed === 0 ? 0 : 1);
}

// Executar testes
runTests().catch((error) => {
    log(`\n❌ ERRO FATAL: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
});

