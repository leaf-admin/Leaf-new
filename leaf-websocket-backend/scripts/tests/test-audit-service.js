/**
 * Script de Teste: Audit Service
 * 
 * Testa se o serviço de auditoria está funcionando corretamente
 */

const auditService = require('./services/audit-service');

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

async function runTests() {
    log('\n🚀 INICIANDO TESTES DE AUDIT SERVICE\n', 'blue');
    log('='.repeat(70), 'blue');
    
    const testUserId = `test_user_${Date.now()}`;
    const testBookingId = `booking_${Date.now()}`;
    
    // Teste 1: Registrar evento de corrida
    await test('Registrar evento de criação de corrida', async () => {
        const result = await auditService.logRideAction(
            testUserId,
            'createBooking',
            testBookingId,
            {
                pickupLocation: { lat: -23.5505, lng: -46.6333 },
                destinationLocation: { lat: -23.5515, lng: -46.6343 },
                estimatedFare: 25.50
            },
            true,
            null,
            {
                ip: '192.168.1.1',
                userAgent: 'Test Agent',
                socketId: 'test_socket_123'
            }
        );
        
        if (!result.success) {
            throw new Error(`Falha ao registrar evento: ${result.error}`);
        }
        
        if (!result.logId) {
            throw new Error('logId não foi retornado');
        }
        
        log(`   ✅ Evento registrado com ID: ${result.logId}`, 'green');
    });
    
    // Teste 2: Registrar evento de pagamento
    await test('Registrar evento de confirmação de pagamento', async () => {
        const chargeId = `charge_${Date.now()}`;
        const result = await auditService.logPaymentAction(
            testUserId,
            'confirmPayment',
            testBookingId,
            chargeId,
            {
                amount: 2550,
                paymentMethod: 'pix'
            },
            true,
            null,
            {
                ip: '192.168.1.1',
                userAgent: 'Test Agent',
                socketId: 'test_socket_123'
            }
        );
        
        if (!result.success) {
            throw new Error(`Falha ao registrar evento: ${result.error}`);
        }
        
        log(`   ✅ Evento de pagamento registrado com ID: ${result.logId}`, 'green');
    });
    
    // Teste 3: Registrar evento de segurança
    await test('Registrar evento de segurança (rate limit)', async () => {
        const result = await auditService.logSecurityAction(
            testUserId,
            'rateLimitExceeded',
            'createBooking',
            {
                limit: 10,
                remaining: 0
            },
            {
                ip: '192.168.1.1',
                userAgent: 'Test Agent',
                socketId: 'test_socket_123'
            }
        );
        
        if (!result.success) {
            throw new Error(`Falha ao registrar evento: ${result.error}`);
        }
        
        log(`   ✅ Evento de segurança registrado com ID: ${result.logId}`, 'green');
    });
    
    // Teste 4: Registrar evento com erro
    await test('Registrar evento de erro', async () => {
        const result = await auditService.logRideAction(
            testUserId,
            'createBooking',
            null,
            {
                error: 'Dados incompletos'
            },
            false,
            'Dados incompletos para solicitar corrida',
            {
                ip: '192.168.1.1',
                userAgent: 'Test Agent',
                socketId: 'test_socket_123'
            }
        );
        
        if (!result.success) {
            throw new Error(`Falha ao registrar evento: ${result.error}`);
        }
        
        log(`   ✅ Evento de erro registrado com ID: ${result.logId}`, 'green');
    });
    
    // Teste 5: Buscar logs de auditoria
    await test('Buscar logs de auditoria', async () => {
        const result = await auditService.getAuditLogs({
            userId: testUserId
        }, 10);
        
        if (!result.success) {
            throw new Error(`Falha ao buscar logs: ${result.error}`);
        }
        
        if (!Array.isArray(result.logs)) {
            throw new Error('Logs não é um array');
        }
        
        log(`   ✅ Encontrados ${result.logs.length} logs`, 'green');
        
        if (result.logs.length > 0) {
            const firstLog = result.logs[0];
            log(`   Ação: ${firstLog.action}`, 'cyan');
            log(`   Severidade: ${firstLog.severity}`, 'cyan');
            log(`   Sucesso: ${firstLog.success}`, 'cyan');
        }
    });
    
    // Teste 6: Obter estatísticas
    await test('Obter estatísticas de auditoria', async () => {
        const result = await auditService.getAuditStats();
        
        if (!result.success) {
            throw new Error(`Falha ao obter estatísticas: ${result.error}`);
        }
        
        if (!result.stats) {
            throw new Error('Estatísticas não foram retornadas');
        }
        
        log(`   ✅ Estatísticas obtidas:`, 'green');
        log(`   Total: ${result.stats.total}`, 'cyan');
        log(`   Taxa de sucesso: ${result.stats.successRate.toFixed(1)}%`, 'cyan');
        log(`   Taxa de erro: ${result.stats.errorRate.toFixed(1)}%`, 'cyan');
    });
    
    // Resumo
    log('\n' + '='.repeat(70), 'blue');
    log(`\n📊 RESUMO DOS TESTES:`, 'blue');
    log(`   Total: ${testsTotal}`, 'cyan');
    log(`   ✅ Passou: ${testsPassed}`, 'green');
    log(`   ❌ Falhou: ${testsFailed}`, 'red');
    log(`   Taxa de sucesso: ${((testsPassed / testsTotal) * 100).toFixed(1)}%`, 
        testsFailed === 0 ? 'green' : 'yellow');
    
    if (testsFailed === 0) {
        log(`\n🎉 TODOS OS TESTES PASSARAM!`, 'green');
        log(`\n✅ O serviço de auditoria está funcionando CORRETAMENTE!`, 'green');
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



