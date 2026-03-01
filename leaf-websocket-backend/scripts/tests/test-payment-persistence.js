/**
 * Script de Teste: Persistência de Pagamentos no Firestore
 * 
 * Testa todos os métodos do PaymentService relacionados à persistência
 * e valida se os dados estão sendo salvos corretamente no Firestore.
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

async function runTests() {
    log('\n🚀 INICIANDO TESTES DE PERSISTÊNCIA DE PAGAMENTOS\n', 'blue');
    log('='.repeat(60), 'blue');
    
    const paymentService = new PaymentService();
    
    // IDs de teste
    const testRideId = `test_payment_${Date.now()}`;
    const testPassengerId = `test_passenger_${Date.now()}`;
    const testDriverId = `test_driver_${Date.now()}`;
    const testChargeId = `charge_${Date.now()}`;
    const testPaymentId = `payment_${Date.now()}`;
    
    // Teste 1: Salvar payment holding
    await test('Salvar payment holding (savePaymentHolding)', async () => {
        const holdingData = {
            status: 'in_holding',
            amount: 2500, // R$ 25,00 em centavos
            paymentMethod: 'pix',
            paymentId: testPaymentId,
            chargeId: testChargeId,
            passengerId: testPassengerId,
            paidAt: new Date().toISOString(),
            confirmedAt: new Date().toISOString()
        };
        
        const result = await paymentService.savePaymentHolding(testRideId, holdingData);
        
        if (!result.success) {
            throw new Error(`Falha ao salvar holding: ${result.error}`);
        }
        
        log(`   RideId: ${testRideId}`);
        log(`   Status: ${holdingData.status}`);
        log(`   Amount: R$ ${(holdingData.amount / 100).toFixed(2)}`);
        
        // Verificar se foi salvo no Firestore
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('payment_holdings').doc(testRideId).get();
        
        if (!doc.exists) {
            throw new Error('Documento não foi criado no Firestore');
        }
        
        const data = doc.data();
        
        if (data.status !== 'in_holding') {
            throw new Error(`Status incorreto. Esperado: 'in_holding', Recebido: '${data.status}'`);
        }
        
        if (data.amount !== 2500) {
            throw new Error(`Amount incorreto. Esperado: 2500, Recebido: ${data.amount}`);
        }
        
        if (data.amountInReais !== 25.00) {
            throw new Error(`AmountInReais incorreto. Esperado: 25.00, Recebido: ${data.amountInReais}`);
        }
        
        log(`   ✅ Payment holding salvo corretamente`);
    });
    
    // Teste 2: Buscar payment holding
    await test('Buscar payment holding (getPaymentHolding)', async () => {
        const holding = await paymentService.getPaymentHolding(testRideId);
        
        if (!holding) {
            throw new Error('Payment holding não encontrado');
        }
        
        if (holding.rideId !== testRideId) {
            throw new Error(`RideId incorreto. Esperado: '${testRideId}', Recebido: '${holding.rideId}'`);
        }
        
        if (holding.status !== 'in_holding') {
            throw new Error(`Status incorreto. Esperado: 'in_holding', Recebido: '${holding.status}'`);
        }
        
        log(`   ✅ Payment holding encontrado e validado`);
        log(`   Status: ${holding.status}`);
        log(`   Amount: R$ ${(holding.amount / 100).toFixed(2)}`);
    });
    
    // Teste 3: Verificar histórico de eventos
    await test('Verificar histórico de eventos (payment_history)', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const firestore = firebaseConfig.getFirestore();
        const historyQuery = await firestore
            .collection('payment_history')
            .where('rideId', '==', testRideId)
            .where('eventType', '==', 'payment_confirmed')
            .limit(1)
            .get();
        
        if (historyQuery.empty) {
            throw new Error('Evento não foi salvo no histórico');
        }
        
        const event = historyQuery.docs[0].data();
        
        if (event.rideId !== testRideId) {
            throw new Error(`RideId incorreto no histórico`);
        }
        
        if (event.eventType !== 'payment_confirmed') {
            throw new Error(`EventType incorreto. Esperado: 'payment_confirmed', Recebido: '${event.eventType}'`);
        }
        
        if (event.amount !== 2500) {
            throw new Error(`Amount incorreto no histórico`);
        }
        
        log(`   ✅ Evento salvo no histórico`);
        log(`   EventType: ${event.eventType}`);
        log(`   Timestamp: ${event.timestamp ? 'Salvo' : 'Não salvo'}`);
    });
    
    // Teste 4: Atualizar payment holding (transição válida)
    await test('Atualizar payment holding com transição válida (updatePaymentHolding)', async () => {
        const result = await paymentService.updatePaymentHolding(testRideId, {
            status: 'distributed',
            driverId: testDriverId,
            distributedAt: new Date().toISOString()
        });
        
        if (!result.success) {
            throw new Error(`Falha ao atualizar: ${result.error}`);
        }
        
        // Verificar no Firestore
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('payment_holdings').doc(testRideId).get();
        
        if (!doc.exists) {
            throw new Error('Documento não encontrado');
        }
        
        const data = doc.data();
        
        if (data.status !== 'distributed') {
            throw new Error(`Status incorreto. Esperado: 'distributed', Recebido: '${data.status}'`);
        }
        
        if (data.driverId !== testDriverId) {
            throw new Error(`DriverId incorreto`);
        }
        
        if (!data.distributedAt) {
            throw new Error('distributedAt não foi salvo');
        }
        
        log(`   ✅ Payment holding atualizado corretamente`);
        log(`   Status: ${data.status}`);
        log(`   DriverId: ${data.driverId}`);
    });
    
    // Teste 5: Verificar evento de distribuição no histórico
    await test('Verificar evento de distribuição no histórico', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const firestore = firebaseConfig.getFirestore();
        const historyQuery = await firestore
            .collection('payment_history')
            .where('rideId', '==', testRideId)
            .where('eventType', '==', 'payment_distributed')
            .limit(1)
            .get();
        
        if (historyQuery.empty) {
            throw new Error('Evento de distribuição não foi salvo no histórico');
        }
        
        const event = historyQuery.docs[0].data();
        
        if (event.eventType !== 'payment_distributed') {
            throw new Error(`EventType incorreto`);
        }
        
        if (event.metadata.previousStatus !== 'in_holding') {
            throw new Error(`PreviousStatus incorreto`);
        }
        
        if (event.metadata.newStatus !== 'distributed') {
            throw new Error(`NewStatus incorreto`);
        }
        
        log(`   ✅ Evento de distribuição salvo no histórico`);
        log(`   PreviousStatus: ${event.metadata.previousStatus}`);
        log(`   NewStatus: ${event.metadata.newStatus}`);
    });
    
    // Teste 6: Testar transição inválida
    await test('Testar transição de estado inválida (deve falhar)', async () => {
        // Tentar voltar de distributed para in_holding (inválido)
        const result = await paymentService.updatePaymentHolding(testRideId, {
            status: 'in_holding'
        });
        
        if (result.success) {
            throw new Error('Transição inválida foi permitida (deveria falhar)');
        }
        
        if (!result.error.includes('Transição de estado inválida')) {
            throw new Error(`Erro incorreto: ${result.error}`);
        }
        
        log(`   ✅ Transição inválida foi bloqueada corretamente`);
        log(`   Erro esperado: ${result.error}`);
    });
    
    // Teste 7: Criar novo holding para testar reembolso
    const testRefundRideId = `test_refund_${Date.now()}`;
    await test('Salvar payment holding para teste de reembolso', async () => {
        const holdingData = {
            status: 'in_holding',
            amount: 2000,
            paymentMethod: 'pix',
            paymentId: `payment_refund_${Date.now()}`,
            chargeId: `charge_refund_${Date.now()}`,
            passengerId: testPassengerId
        };
        
        const result = await paymentService.savePaymentHolding(testRefundRideId, holdingData);
        
        if (!result.success) {
            throw new Error(`Falha ao salvar: ${result.error}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        log(`   ✅ Payment holding criado para teste de reembolso`);
    });
    
    // Teste 8: Marcar como reembolsado
    await test('Marcar payment como reembolsado (markPaymentRefunded)', async () => {
        const result = await paymentService.markPaymentRefunded(testRefundRideId, {
            status: 'REFUNDED',
            refundAmount: 2000,
            cancellationFee: 0,
            refundId: `refund_${Date.now()}`,
            reason: 'Teste de reembolso'
        });
        
        if (!result.success) {
            throw new Error(`Falha ao marcar como reembolsado: ${result.error}`);
        }
        
        // Verificar no Firestore
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('payment_holdings').doc(testRefundRideId).get();
        
        if (!doc.exists) {
            throw new Error('Documento não encontrado');
        }
        
        const data = doc.data();
        
        if (data.status !== 'refunded') {
            throw new Error(`Status incorreto. Esperado: 'refunded', Recebido: '${data.status}'`);
        }
        
        if (!data.refunded) {
            throw new Error('refunded não foi marcado como true');
        }
        
        if (data.refundAmount !== 2000) {
            throw new Error(`RefundAmount incorreto`);
        }
        
        log(`   ✅ Payment marcado como reembolsado`);
        log(`   Status: ${data.status}`);
        log(`   RefundAmount: R$ ${(data.refundAmount / 100).toFixed(2)}`);
    });
    
    // Teste 9: Verificar evento de reembolso no histórico
    await test('Verificar evento de reembolso no histórico', async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const firestore = firebaseConfig.getFirestore();
        const historyQuery = await firestore
            .collection('payment_history')
            .where('rideId', '==', testRefundRideId)
            .where('eventType', '==', 'payment_refunded')
            .limit(1)
            .get();
        
        if (historyQuery.empty) {
            throw new Error('Evento de reembolso não foi salvo no histórico');
        }
        
        const event = historyQuery.docs[0].data();
        
        if (event.eventType !== 'payment_refunded') {
            throw new Error(`EventType incorreto`);
        }
        
        log(`   ✅ Evento de reembolso salvo no histórico`);
    });
    
    // Teste 10: Validar estrutura completa do payment holding
    await test('Validar estrutura completa do payment holding', async () => {
        const firestore = firebaseConfig.getFirestore();
        const doc = await firestore.collection('payment_holdings').doc(testRideId).get();
        
        if (!doc.exists) {
            throw new Error('Documento não encontrado');
        }
        
        const data = doc.data();
        
        // Campos obrigatórios
        const requiredFields = [
            'rideId',
            'status',
            'amount',
            'amountInReais',
            'paymentMethod',
            'createdAt',
            'updatedAt'
        ];
        
        const missingFields = [];
        for (const field of requiredFields) {
            if (data[field] === undefined || data[field] === null) {
                missingFields.push(field);
            }
        }
        
        if (missingFields.length > 0) {
            throw new Error(`Campos faltando: ${missingFields.join(', ')}`);
        }
        
        // Validar tipos
        if (typeof data.amount !== 'number') {
            throw new Error(`amount deve ser number, recebido: ${typeof data.amount}`);
        }
        
        if (typeof data.amountInReais !== 'number') {
            throw new Error(`amountInReais deve ser number, recebido: ${typeof data.amountInReais}`);
        }
        
        log(`   ✅ Estrutura completa validada`);
        log(`   Total de campos: ${Object.keys(data).length}`);
    });
    
    // Teste 11: Validar estrutura do histórico
    await test('Validar estrutura do histórico de eventos', async () => {
        const firestore = firebaseConfig.getFirestore();
        const historyQuery = await firestore
            .collection('payment_history')
            .where('rideId', '==', testRideId)
            .limit(5)
            .get();
        
        if (historyQuery.empty) {
            throw new Error('Nenhum evento encontrado no histórico');
        }
        
        const event = historyQuery.docs[0].data();
        
        const requiredFields = [
            'rideId',
            'eventType',
            'timestamp',
            'actor'
        ];
        
        const missingFields = [];
        for (const field of requiredFields) {
            if (event[field] === undefined || event[field] === null) {
                missingFields.push(field);
            }
        }
        
        if (missingFields.length > 0) {
            throw new Error(`Campos faltando no histórico: ${missingFields.join(', ')}`);
        }
        
        if (!event.metadata) {
            throw new Error('metadata não foi salvo');
        }
        
        log(`   ✅ Estrutura do histórico validada`);
        log(`   Total de eventos para esta corrida: ${historyQuery.size}`);
    });
    
    // Teste 12: Testar getPaymentStatus com holding no Firestore
    await test('Testar getPaymentStatus com holding no Firestore', async () => {
        const status = await paymentService.getPaymentStatus(testRideId);
        
        if (!status.success) {
            throw new Error(`Falha ao buscar status: ${status.error}`);
        }
        
        if (status.status !== 'distributed') {
            throw new Error(`Status incorreto. Esperado: 'distributed', Recebido: '${status.status}'`);
        }
        
        if (status.amount !== 2500) {
            throw new Error(`Amount incorreto`);
        }
        
        log(`   ✅ getPaymentStatus funcionando corretamente`);
        log(`   Status: ${status.status}`);
        log(`   Amount: R$ ${(status.amount / 100).toFixed(2)}`);
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
        log(`\n✅ A persistência de pagamentos está CORRETA!`, 'green');
    } else {
        log(`\n⚠️ ALGUNS TESTES FALHARAM`, 'yellow');
        log(`   Verifique os erros acima`, 'yellow');
    }
    
    log(`\n🧹 Limpando documentos de teste...`, 'cyan');
    
    // Limpar documentos de teste
    try {
        const firestore = firebaseConfig.getFirestore();
        await firestore.collection('payment_holdings').doc(testRideId).delete();
        await firestore.collection('payment_holdings').doc(testRefundRideId).delete();
        
        // Limpar histórico (pode ter múltiplos documentos)
        const historyQuery = await firestore
            .collection('payment_history')
            .where('rideId', 'in', [testRideId, testRefundRideId])
            .get();
        
        const batch = firestore.batch();
        historyQuery.docs.forEach(doc => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        
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



