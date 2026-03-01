/**
 * Script de Teste: Validação de Pagamento Antes de Iniciar Corrida
 * 
 * Testa se o sistema bloqueia corretamente o início de corrida quando:
 * - Pagamento não existe
 * - Pagamento não está confirmado
 * - Pagamento está em status inválido
 * 
 * E permite quando:
 * - Pagamento está em status 'in_holding'
 */

const PaymentService = require('./services/payment-service');
const firebaseConfig = require('./firebase-config');
const admin = require('firebase-admin');

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

/**
 * Simula a validação de pagamento antes de iniciar corrida
 */
async function validatePaymentBeforeStartTrip(bookingId, driverId) {
    try {
        const PaymentService = require('./services/payment-service');
        const paymentService = new PaymentService();
        
        // Buscar status do pagamento
        const paymentStatus = await paymentService.getPaymentStatus(bookingId);
        
        // VALIDAÇÃO 1: Verificar se a verificação foi bem-sucedida
        if (!paymentStatus.success) {
            // Verificar se é erro de "não encontrado" ou erro real de verificação
            const isNotFound = paymentStatus.error && (
                paymentStatus.error.includes('não encontrado') ||
                paymentStatus.error.includes('not found') ||
                paymentStatus.error.includes('não existe') ||
                paymentStatus.code === 'PAYMENT_NOT_FOUND' ||
                paymentStatus.status === null ||
                paymentStatus.status === undefined
            );
            
            if (isNotFound) {
                return {
                    allowed: false,
                    error: 'Pagamento não encontrado',
                    message: 'Nenhum pagamento foi encontrado para esta corrida. A corrida não pode ser iniciada sem pagamento confirmado.',
                    code: 'PAYMENT_NOT_FOUND',
                    paymentStatus: null
                };
            } else {
                return {
                    allowed: false,
                    error: 'Erro ao verificar pagamento',
                    message: 'Não foi possível verificar o status do pagamento. Tente novamente.',
                    code: 'PAYMENT_VERIFICATION_ERROR'
                };
            }
        }

        // VALIDAÇÃO 2: Verificar se pagamento existe
        if (!paymentStatus.status) {
            return {
                allowed: false,
                error: 'Pagamento não encontrado',
                message: 'Nenhum pagamento foi encontrado para esta corrida. A corrida não pode ser iniciada sem pagamento confirmado.',
                code: 'PAYMENT_NOT_FOUND',
                paymentStatus: null
            };
        }

        // VALIDAÇÃO 3: Verificar se pagamento está em status válido
        const validStatuses = ['in_holding'];
        
        if (!validStatuses.includes(paymentStatus.status)) {
            return {
                allowed: false,
                error: 'Pagamento não confirmado',
                message: `A corrida só pode ser iniciada após confirmação do pagamento. Status atual: ${paymentStatus.status}. Status requerido: in_holding`,
                code: 'PAYMENT_NOT_CONFIRMED',
                paymentStatus: paymentStatus.status,
                requiredStatus: 'in_holding',
                amount: paymentStatus.amount || null
            };
        }

        // VALIDAÇÃO 4: Verificar se há valor do pagamento
        if (paymentStatus.amount && paymentStatus.amount <= 0) {
            return {
                allowed: false,
                error: 'Valor de pagamento inválido',
                message: 'O valor do pagamento é inválido. Entre em contato com o suporte.',
                code: 'INVALID_PAYMENT_AMOUNT',
                paymentStatus: paymentStatus.status
            };
        }

        // Pagamento validado com sucesso
        return {
            allowed: true,
            paymentStatus: paymentStatus.status,
            amount: paymentStatus.amount
        };
        
    } catch (error) {
        return {
            allowed: false,
            error: 'Erro ao verificar pagamento',
            message: 'Não foi possível verificar o status do pagamento. A corrida não pode ser iniciada por segurança.',
            code: 'PAYMENT_VERIFICATION_CRITICAL_ERROR'
        };
    }
}

async function runTests() {
    log('\n🚀 INICIANDO TESTES DE VALIDAÇÃO DE PAGAMENTO ANTES DE INICIAR CORRIDA\n', 'blue');
    log('='.repeat(60), 'blue');
    
    const paymentService = new PaymentService();
    
    // IDs de teste
    const testBookingIdWithoutPayment = `test_booking_no_payment_${Date.now()}`;
    const testBookingIdWithPendingPayment = `test_booking_pending_${Date.now()}`;
    const testBookingIdWithConfirmedPayment = `test_booking_confirmed_${Date.now()}`;
    const testDriverId = `test_driver_${Date.now()}`;
    
    // Teste 1: Bloquear quando pagamento não existe
    await test('Bloquear início quando pagamento não existe', async () => {
        const result = await validatePaymentBeforeStartTrip(testBookingIdWithoutPayment, testDriverId);
        
        if (result.allowed) {
            throw new Error('Início de corrida foi permitido quando deveria ser bloqueado (pagamento não existe)');
        }
        
        if (result.code !== 'PAYMENT_NOT_FOUND') {
            throw new Error(`Código de erro incorreto. Esperado: 'PAYMENT_NOT_FOUND', Recebido: '${result.code}'`);
        }
        
        log(`   ✅ Início bloqueado corretamente`);
        log(`   Código: ${result.code}`);
        log(`   Mensagem: ${result.message}`);
    });
    
    // Teste 2: Criar pagamento em status 'pending'
    await test('Criar pagamento em status pending para teste', async () => {
        const holdingData = {
            status: 'pending',
            amount: 2500,
            paymentMethod: 'pix',
            paymentId: `payment_pending_${Date.now()}`,
            chargeId: `charge_pending_${Date.now()}`,
            passengerId: `test_passenger_${Date.now()}`
        };
        
        const result = await paymentService.savePaymentHolding(testBookingIdWithPendingPayment, holdingData);
        
        if (!result.success) {
            throw new Error(`Falha ao criar payment holding: ${result.error}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        log(`   ✅ Payment holding criado com status 'pending'`);
    });
    
    // Teste 3: Bloquear quando pagamento está em status 'pending'
    await test('Bloquear início quando pagamento está em status pending', async () => {
        const result = await validatePaymentBeforeStartTrip(testBookingIdWithPendingPayment, testDriverId);
        
        if (result.allowed) {
            throw new Error('Início de corrida foi permitido quando deveria ser bloqueado (status: pending)');
        }
        
        if (result.code !== 'PAYMENT_NOT_CONFIRMED') {
            throw new Error(`Código de erro incorreto. Esperado: 'PAYMENT_NOT_CONFIRMED', Recebido: '${result.code}'`);
        }
        
        if (result.paymentStatus !== 'pending') {
            throw new Error(`Status de pagamento incorreto. Esperado: 'pending', Recebido: '${result.paymentStatus}'`);
        }
        
        log(`   ✅ Início bloqueado corretamente`);
        log(`   Status atual: ${result.paymentStatus}`);
        log(`   Status requerido: ${result.requiredStatus}`);
    });
    
    // Teste 4: Criar pagamento em status 'in_holding' (confirmado)
    await test('Criar pagamento em status in_holding (confirmado) para teste', async () => {
        const holdingData = {
            status: 'in_holding',
            amount: 3000,
            paymentMethod: 'pix',
            paymentId: `payment_confirmed_${Date.now()}`,
            chargeId: `charge_confirmed_${Date.now()}`,
            passengerId: `test_passenger_${Date.now()}`,
            confirmedAt: new Date().toISOString()
        };
        
        const result = await paymentService.savePaymentHolding(testBookingIdWithConfirmedPayment, holdingData);
        
        if (!result.success) {
            throw new Error(`Falha ao criar payment holding: ${result.error}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        log(`   ✅ Payment holding criado com status 'in_holding'`);
    });
    
    // Teste 5: Permitir início quando pagamento está em status 'in_holding'
    await test('Permitir início quando pagamento está em status in_holding', async () => {
        const result = await validatePaymentBeforeStartTrip(testBookingIdWithConfirmedPayment, testDriverId);
        
        if (!result.allowed) {
            throw new Error(`Início de corrida foi bloqueado quando deveria ser permitido (status: in_holding). Erro: ${result.error}`);
        }
        
        if (result.paymentStatus !== 'in_holding') {
            throw new Error(`Status de pagamento incorreto. Esperado: 'in_holding', Recebido: '${result.paymentStatus}'`);
        }
        
        if (result.amount !== 3000) {
            throw new Error(`Valor de pagamento incorreto. Esperado: 3000, Recebido: ${result.amount}`);
        }
        
        log(`   ✅ Início permitido corretamente`);
        log(`   Status: ${result.paymentStatus}`);
        log(`   Amount: R$ ${(result.amount / 100).toFixed(2)}`);
    });
    
    // Teste 6: Testar com pagamento em status 'distributed' (já distribuído)
    await test('Bloquear início quando pagamento já foi distribuído', async () => {
        // Atualizar pagamento para 'distributed'
        await paymentService.updatePaymentHolding(testBookingIdWithConfirmedPayment, {
            status: 'distributed',
            driverId: testDriverId
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const result = await validatePaymentBeforeStartTrip(testBookingIdWithConfirmedPayment, testDriverId);
        
        if (result.allowed) {
            throw new Error('Início de corrida foi permitido quando deveria ser bloqueado (status: distributed)');
        }
        
        if (result.code !== 'PAYMENT_NOT_CONFIRMED') {
            throw new Error(`Código de erro incorreto. Esperado: 'PAYMENT_NOT_CONFIRMED', Recebido: '${result.code}'`);
        }
        
        log(`   ✅ Início bloqueado corretamente`);
        log(`   Status atual: ${result.paymentStatus}`);
    });
    
    // Teste 7: Testar com pagamento em status 'refunded' (reembolsado)
    await test('Bloquear início quando pagamento foi reembolsado', async () => {
        // Criar novo pagamento e reembolsar
        const testBookingRefunded = `test_booking_refunded_${Date.now()}`;
        await paymentService.savePaymentHolding(testBookingRefunded, {
            status: 'in_holding',
            amount: 2000,
            paymentMethod: 'pix',
            paymentId: `payment_refunded_${Date.now()}`,
            chargeId: `charge_refunded_${Date.now()}`,
            passengerId: `test_passenger_${Date.now()}`
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await paymentService.markPaymentRefunded(testBookingRefunded, {
            status: 'REFUNDED',
            refundAmount: 2000,
            cancellationFee: 0,
            refundId: `refund_${Date.now()}`,
            reason: 'Teste de reembolso'
        });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const result = await validatePaymentBeforeStartTrip(testBookingRefunded, testDriverId);
        
        if (result.allowed) {
            throw new Error('Início de corrida foi permitido quando deveria ser bloqueado (status: refunded)');
        }
        
        if (result.code !== 'PAYMENT_NOT_CONFIRMED') {
            throw new Error(`Código de erro incorreto. Esperado: 'PAYMENT_NOT_CONFIRMED', Recebido: '${result.code}'`);
        }
        
        log(`   ✅ Início bloqueado corretamente`);
        log(`   Status atual: ${result.paymentStatus}`);
        
        // Limpar
        const firestore = firebaseConfig.getFirestore();
        await firestore.collection('payment_holdings').doc(testBookingRefunded).delete();
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
        log(`\n✅ A validação de pagamento antes de iniciar corrida está CORRETA!`, 'green');
    } else {
        log(`\n⚠️ ALGUNS TESTES FALHARAM`, 'yellow');
        log(`   Verifique os erros acima`, 'yellow');
    }
    
    log(`\n🧹 Limpando documentos de teste...`, 'cyan');
    
    // Limpar documentos de teste
    try {
        const firestore = firebaseConfig.getFirestore();
        await firestore.collection('payment_holdings').doc(testBookingIdWithPendingPayment).delete();
        await firestore.collection('payment_holdings').doc(testBookingIdWithConfirmedPayment).delete();
        
        log(`   ✅ Documentos de teste removidos`, 'green');
    } catch (error) {
        log(`   ⚠️ Erro ao limpar documentos: ${error.message}`, 'yellow');
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

