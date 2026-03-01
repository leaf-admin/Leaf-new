/**
 * Script de Teste: Validation Service
 * 
 * Testa se o serviço de validação está funcionando corretamente
 */

const validationService = require('./services/validation-service');

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
    log('\n🚀 INICIANDO TESTES DE VALIDATION SERVICE\n', 'blue');
    log('='.repeat(70), 'blue');
    
    // Teste 1: Validar createBooking com dados válidos
    await test('Validar createBooking com dados válidos', async () => {
        const data = {
            customerId: 'user123',
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5515, lng: -46.6343 },
            estimatedFare: 25.50,
            paymentMethod: 'pix'
        };
        
        const result = validationService.validateEndpoint('createBooking', data);
        
        if (!result.valid) {
            throw new Error(`Validação falhou: ${JSON.stringify(result.errors)}`);
        }
        
        if (!result.sanitized) {
            throw new Error('Dados sanitizados não foram retornados');
        }
        
        log(`   ✅ Dados válidos aceitos`, 'green');
        log(`   customerId: ${result.sanitized.customerId}`, 'cyan');
    });
    
    // Teste 2: Validar createBooking com dados inválidos
    await test('Validar createBooking com dados inválidos', async () => {
        const data = {
            customerId: '', // Inválido: vazio
            pickupLocation: { lat: 200, lng: -46.6333 }, // Inválido: lat > 90
            destinationLocation: { lat: -23.5515 }, // Inválido: falta lng
            estimatedFare: -10 // Inválido: negativo
        };
        
        const result = validationService.validateEndpoint('createBooking', data);
        
        if (result.valid) {
            throw new Error('Validação deveria ter falhado');
        }
        
        if (!result.errors || result.errors.length === 0) {
            throw new Error('Erros não foram retornados');
        }
        
        log(`   ✅ ${result.errors.length} erros detectados`, 'green');
        result.errors.forEach(err => {
            log(`   - ${err.field}: ${err.error}`, 'cyan');
        });
    });
    
    // Teste 3: Validar coordenadas
    await test('Validar coordenadas geográficas', async () => {
        // Coordenadas válidas
        const validCoords = { lat: -23.5505, lng: -46.6333 };
        const result1 = validationService.validateCoordinates(validCoords, 'localização');
        
        if (!result1.valid) {
            throw new Error(`Coordenadas válidas foram rejeitadas: ${result1.error}`);
        }
        
        // Coordenadas inválidas (lat > 90)
        const invalidCoords = { lat: 200, lng: -46.6333 };
        const result2 = validationService.validateCoordinates(invalidCoords, 'localização');
        
        if (result2.valid) {
            throw new Error('Coordenadas inválidas foram aceitas');
        }
        
        log(`   ✅ Validação de coordenadas funcionando`, 'green');
    });
    
    // Teste 4: Sanitizar string
    await test('Sanitizar strings (prevenir XSS)', async () => {
        const malicious = '<script>alert("XSS")</script>Hello';
        const sanitized = validationService.sanitizeString(malicious);
        
        if (sanitized.includes('<script>') || sanitized.includes('</script>')) {
            throw new Error('Tags HTML não foram removidas');
        }
        
        if (sanitized.includes('&lt;') || sanitized.includes('&gt;')) {
            log(`   ✅ Tags HTML escapadas: ${sanitized}`, 'green');
        }
        
        log(`   Original: ${malicious}`, 'cyan');
        log(`   Sanitizado: ${sanitized}`, 'cyan');
    });
    
    // Teste 5: Validar confirmPayment
    await test('Validar confirmPayment com dados válidos', async () => {
        const data = {
            bookingId: 'booking123',
            paymentMethod: 'pix',
            amount: 25.50
        };
        
        const result = validationService.validateEndpoint('confirmPayment', data);
        
        if (!result.valid) {
            throw new Error(`Validação falhou: ${JSON.stringify(result.errors)}`);
        }
        
        log(`   ✅ Pagamento válido aceito`, 'green');
    });
    
    // Teste 6: Validar confirmPayment com amount inválido
    await test('Validar confirmPayment com amount inválido', async () => {
        const data = {
            bookingId: 'booking123',
            paymentMethod: 'pix',
            amount: -10 // Inválido: negativo
        };
        
        const result = validationService.validateEndpoint('confirmPayment', data);
        
        if (result.valid) {
            throw new Error('Validação deveria ter falhado para amount negativo');
        }
        
        log(`   ✅ Amount negativo rejeitado`, 'green');
    });
    
    // Teste 7: Validar startTrip
    await test('Validar startTrip com dados válidos', async () => {
        const data = {
            bookingId: 'booking123',
            startLocation: { lat: -23.5505, lng: -46.6333 }
        };
        
        const result = validationService.validateEndpoint('startTrip', data);
        
        if (!result.valid) {
            throw new Error(`Validação falhou: ${JSON.stringify(result.errors)}`);
        }
        
        log(`   ✅ startTrip válido aceito`, 'green');
    });
    
    // Teste 8: Validar finishTrip
    await test('Validar finishTrip com dados válidos', async () => {
        const data = {
            bookingId: 'booking123',
            endLocation: { lat: -23.5515, lng: -46.6343 },
            distance: 5.5,
            fare: 25.50
        };
        
        const result = validationService.validateEndpoint('finishTrip', data);
        
        if (!result.valid) {
            throw new Error(`Validação falhou: ${JSON.stringify(result.errors)}`);
        }
        
        log(`   ✅ finishTrip válido aceito`, 'green');
    });
    
    // Teste 9: Validar cancelRide
    await test('Validar cancelRide com dados válidos', async () => {
        const data = {
            bookingId: 'booking123',
            reason: 'Mudança de planos'
        };
        
        const result = validationService.validateEndpoint('cancelRide', data);
        
        if (!result.valid) {
            throw new Error(`Validação falhou: ${JSON.stringify(result.errors)}`);
        }
        
        log(`   ✅ cancelRide válido aceito`, 'green');
    });
    
    // Teste 10: Validar tipos de dados
    await test('Validar tipos de dados', async () => {
        // String
        const stringCheck = validationService.validateType('hello', 'string', 'campo');
        if (!stringCheck.valid) {
            throw new Error('String válida foi rejeitada');
        }
        
        // Number
        const numberCheck = validationService.validateType(123, 'number', 'campo');
        if (!numberCheck.valid) {
            throw new Error('Número válido foi rejeitado');
        }
        
        // Boolean
        const boolCheck = validationService.validateType(true, 'boolean', 'campo');
        if (!boolCheck.valid) {
            throw new Error('Booleano válido foi rejeitado');
        }
        
        // Tipo inválido
        const invalidCheck = validationService.validateType('hello', 'number', 'campo');
        if (invalidCheck.valid) {
            throw new Error('Tipo inválido foi aceito');
        }
        
        log(`   ✅ Validação de tipos funcionando`, 'green');
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
        log(`\n✅ O serviço de validação está funcionando CORRETAMENTE!`, 'green');
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



