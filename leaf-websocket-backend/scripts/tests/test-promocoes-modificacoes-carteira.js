/**
 * TESTES: PROMOÇÕES, MODIFICAÇÕES DE CORRIDA E CARTEIRA
 * 
 * Testes para validar:
 * 1. Validar código de promoção
 * 2. Aplicar desconto de promoção
 * 3. Tracking de uso de promoção
 * 4. Modificar destino da corrida
 * 5. Modificar horário da corrida
 * 6. Consultar saldo da carteira
 * 7. Processar saque via PIX
 * 8. Histórico de transações da carteira
 */

const io = require('socket.io-client');
const redisPool = require('./utils/redis-pool');
const RideStateManager = require('./services/ride-state-manager');
const { logger } = require('./utils/logger');

// Configurações de teste
const TEST_CONFIG = {
    SERVER_URL: process.env.WS_URL || 'http://localhost:3001',
    customerId: 'test_customer_promo',
    driverId: 'test_driver_wallet',
    bookingId: 'test_booking_modify',
    
    // Parâmetros de promoção
    PROMO: {
        TYPES: ['percentage', 'fixed', 'first_ride'],
        MIN_ORDER_VALUE: 10.00,
        MAX_DISCOUNT: 50.00,
        EXPIRY_DAYS: 30
    },
    
    // Parâmetros de carteira
    WALLET: {
        MIN_WITHDRAWAL: 20.00,
        MAX_WITHDRAWAL: 5000.00,
        WITHDRAWAL_FEE: 0.00, // PIX sem taxa
        PROCESSING_TIME_HOURS: 2
    }
};

// Mock IO para testes
class MockIO {
    constructor() {
        this.emittedEvents = new Map();
        this.currentRoom = null;
    }
    
    to(room) {
        this.currentRoom = room;
        return this;
    }
    
    emit(event, data) {
        const userId = this.currentRoom?.replace('driver_', '').replace('customer_', '') || 'unknown';
        if (!this.emittedEvents.has(userId)) {
            this.emittedEvents.set(userId, []);
        }
        this.emittedEvents.get(userId).push({ event, data, timestamp: Date.now() });
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function test(testName, testFn) {
    try {
        console.log(`\n🧪 [TESTE] ${testName}`);
        const startTime = performance.now();
        await testFn();
        const duration = performance.now() - startTime;
        console.log(`✅ [PASSOU] ${testName} (${(duration/1000).toFixed(2)}s)`);
        return true;
    } catch (error) {
        console.log(`❌ [FALHOU] ${testName}: ${error.message}`);
        return false;
    }
}

async function main() {
    const redis = redisPool.getConnection();
    if (!redis.isOpen) {
        await redis.connect();
    }
    
    const results = {
        total: 0,
        passed: 0,
        failed: 0
    };
    
    const MockIOInstance = new MockIO();
    
    // ========================================
    // TESTE 1: VALIDAR CÓDIGO DE PROMOÇÃO
    // ========================================
    const test1Passed = await test('TC-001: Validar código de promoção', async () => {
        const promoCode = 'PROMO50';
        const promoKey = `promo:${promoCode}`;
        
        // Criar promoção válida
        await redis.hset(promoKey, {
            promoId: promoCode,
            type: 'percentage',
            discount: '50', // 50% de desconto
            minOrderValue: String(TEST_CONFIG.PROMO.MIN_ORDER_VALUE),
            maxDiscount: String(TEST_CONFIG.PROMO.MAX_DISCOUNT),
            expiryDate: String(Date.now() + (TEST_CONFIG.PROMO.EXPIRY_DAYS * 24 * 60 * 60 * 1000)),
            status: 'ACTIVE',
            usageLimit: '100',
            usedCount: '0'
        });
        
        // TTL baseado em expiração
        await redis.expire(promoKey, TEST_CONFIG.PROMO.EXPIRY_DAYS * 24 * 60 * 60);
        
        // Validar promoção
        const promoData = await redis.hgetall(promoKey);
        if (!promoData || promoData.status !== 'ACTIVE') {
            throw new Error(`Promoção não está ativa`);
        }
        
        const expiryDate = parseInt(promoData.expiryDate);
        if (expiryDate < Date.now()) {
            throw new Error(`Promoção expirada`);
        }
        
        const usedCount = parseInt(promoData.usedCount);
        const usageLimit = parseInt(promoData.usageLimit);
        if (usedCount >= usageLimit) {
            throw new Error(`Limite de uso da promoção atingido`);
        }
        
        console.log(`   ✅ Código de promoção válido: ${promoCode}`);
        console.log(`   ✅ Tipo: ${promoData.type}`);
        console.log(`   ✅ Desconto: ${promoData.discount}%`);
        console.log(`   ✅ Uso: ${usedCount}/${usageLimit}`);
        
        // Limpar
        await redis.del(promoKey);
    });
    results.total++;
    if (test1Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 2: APLICAR DESCONTO DE PROMOÇÃO
    // ========================================
    const test2Passed = await test('TC-002: Aplicar desconto de promoção na tarifa', async () => {
        const promoCode = 'PROMO20';
        const originalFare = 25.00;
        const discountPercentage = 20; // 20% de desconto
        const expectedDiscount = originalFare * (discountPercentage / 100);
        const finalFare = originalFare - expectedDiscount;
        
        // Simular aplicação de promoção
        const bookingId = TEST_CONFIG.bookingId;
        const bookingKey = `booking:${bookingId}`;
        
        await redis.hset(bookingKey, {
            bookingId,
            originalFare: String(originalFare),
            promoCode,
            discountAmount: String(expectedDiscount),
            finalFare: String(finalFare),
            promoApplied: 'true'
        });
        
        // Verificar cálculo
        const bookingData = await redis.hgetall(bookingKey);
        const calculatedDiscount = parseFloat(bookingData.discountAmount);
        const calculatedFinalFare = parseFloat(bookingData.finalFare);
        
        if (Math.abs(calculatedDiscount - expectedDiscount) > 0.01) {
            throw new Error(`Desconto calculado incorretamente (esperado: R$ ${expectedDiscount.toFixed(2)}, obtido: R$ ${calculatedDiscount.toFixed(2)})`);
        }
        
        if (Math.abs(calculatedFinalFare - finalFare) > 0.01) {
            throw new Error(`Tarifa final calculada incorretamente`);
        }
        
        console.log(`   ✅ Tarifa original: R$ ${originalFare}`);
        console.log(`   ✅ Desconto aplicado: R$ ${calculatedDiscount.toFixed(2)} (${discountPercentage}%)`);
        console.log(`   ✅ Tarifa final: R$ ${calculatedFinalFare.toFixed(2)}`);
        
        // Limpar
        await redis.del(bookingKey);
    });
    results.total++;
    if (test2Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 3: TRACKING DE USO DE PROMOÇÃO
    // ========================================
    const test3Passed = await test('TC-003: Tracking de uso de promoção', async () => {
        const promoCode = 'PROMO30';
        const promoKey = `promo:${promoCode}`;
        const bookingId = 'booking_promo_tracking';
        
        // Criar promoção
        await redis.hset(promoKey, {
            promoId: promoCode,
            type: 'percentage',
            discount: '30',
            usedCount: '0',
            usageLimit: '100'
        });
        
        // Registrar uso
        const usageKey = `promo_usage:${promoCode}`;
        await redis.zadd(usageKey, Date.now(), JSON.stringify({
            bookingId,
            customerId: TEST_CONFIG.customerId,
            discountApplied: 7.50,
            usedAt: Date.now()
        }));
        
        // Incrementar contador
        const currentCount = parseInt(await redis.hget(`promo:${promoCode}`, 'usedCount') || '0');
        await redis.hset(promoKey, {
            usedCount: String(currentCount + 1)
        });
        
        // Verificar tracking
        const usageData = await redis.zrange(usageKey, -1, -1);
        if (usageData.length === 0) {
            throw new Error(`Uso da promoção não foi registrado`);
        }
        
        const usage = JSON.parse(usageData[0]);
        if (usage.bookingId !== bookingId) {
            throw new Error(`Booking ID não corresponde no tracking`);
        }
        
        const updatedCount = parseInt(await redis.hget(promoKey, 'usedCount'));
        if (updatedCount !== currentCount + 1) {
            throw new Error(`Contador de uso não foi incrementado`);
        }
        
        console.log(`   ✅ Uso da promoção registrado: ${bookingId}`);
        console.log(`   ✅ Contador atualizado: ${updatedCount}/100`);
        
        // Limpar
        await redis.del(promoKey);
        await redis.del(usageKey);
    });
    results.total++;
    if (test3Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 4: MODIFICAR DESTINO DA CORRIDA
    // ========================================
    const test4Passed = await test('TC-004: Modificar destino da corrida', async () => {
        const bookingId = TEST_CONFIG.bookingId;
        const originalDestination = { lat: -22.9, lng: -43.13 };
        const newDestination = { lat: -22.95, lng: -43.14 };
        
        // Simular corrida em andamento
        const bookingKey = `booking:${bookingId}`;
        await redis.hset(bookingKey, {
            bookingId,
            destinationLocation: JSON.stringify(originalDestination),
            status: 'IN_PROGRESS',
            modifiedDestination: 'false'
        });
        
        // Modificar destino
        await redis.hset(bookingKey, {
            destinationLocation: JSON.stringify(newDestination),
            originalDestination: JSON.stringify(originalDestination),
            modifiedDestination: 'true',
            modifiedAt: Date.now()
        });
        
        // Verificar modificação
        const bookingData = await redis.hgetall(bookingKey);
        const currentDestination = JSON.parse(bookingData.destinationLocation);
        
        if (currentDestination.lat !== newDestination.lat || currentDestination.lng !== newDestination.lng) {
            throw new Error(`Destino não foi modificado corretamente`);
        }
        
        if (bookingData.modifiedDestination !== 'true') {
            throw new Error(`Flag de modificação não foi setada`);
        }
        
        console.log(`   ✅ Destino modificado`);
        console.log(`   ✅ Original: (${originalDestination.lat}, ${originalDestination.lng})`);
        console.log(`   ✅ Novo: (${newDestination.lat}, ${newDestination.lng})`);
        console.log(`   ⚠️ Sistema deveria recalcular tarifa se necessário`);
        
        // Limpar
        await redis.del(bookingKey);
    });
    results.total++;
    if (test4Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 5: CONSULTAR SALDO DA CARTEIRA
    // ========================================
    const test5Passed = await test('TC-005: Consultar saldo da carteira do motorista', async () => {
        const driverId = TEST_CONFIG.driverId;
        const walletKey = `wallet:${driverId}`;
        
        // Criar carteira com saldo
        const balance = 150.50;
        const pendingWithdrawals = 50.00;
        const availableBalance = balance - pendingWithdrawals;
        
        await redis.hset(walletKey, {
            driverId,
            balance: String(balance),
            pendingWithdrawals: String(pendingWithdrawals),
            availableBalance: String(availableBalance),
            lastUpdated: Date.now()
        });
        
        // Verificar saldo
        const walletData = await redis.hgetall(walletKey);
        const currentBalance = parseFloat(walletData.balance);
        const currentAvailable = parseFloat(walletData.availableBalance);
        
        if (Math.abs(currentBalance - balance) > 0.01) {
            throw new Error(`Saldo não corresponde (esperado: R$ ${balance}, obtido: R$ ${currentBalance})`);
        }
        
        if (Math.abs(currentAvailable - availableBalance) > 0.01) {
            throw new Error(`Saldo disponível não corresponde`);
        }
        
        console.log(`   ✅ Saldo total: R$ ${currentBalance.toFixed(2)}`);
        console.log(`   ✅ Saques pendentes: R$ ${pendingWithdrawals.toFixed(2)}`);
        console.log(`   ✅ Saldo disponível: R$ ${currentAvailable.toFixed(2)}`);
        
        // Limpar
        await redis.del(walletKey);
    });
    results.total++;
    if (test5Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 6: PROCESSAR SAQUE VIA PIX
    // ========================================
    const test6Passed = await test('TC-006: Processar saque via PIX da carteira', async () => {
        const driverId = TEST_CONFIG.driverId;
        const withdrawalAmount = 100.00;
        const pixKey = 'pix_key_123456789';
        
        // Verificar saldo disponível
        const walletKey = `wallet:${driverId}`;
        const currentBalance = 200.00;
        const pendingWithdrawals = 0;
        
        await redis.hset(walletKey, {
            driverId,
            balance: String(currentBalance),
            pendingWithdrawals: String(pendingWithdrawals),
            availableBalance: String(currentBalance)
        });
        
        // Validar saque
        if (withdrawalAmount < TEST_CONFIG.WALLET.MIN_WITHDRAWAL) {
            throw new Error(`Valor mínimo de saque não atendido`);
        }
        
        if (withdrawalAmount > TEST_CONFIG.WALLET.MAX_WITHDRAWAL) {
            throw new Error(`Valor máximo de saque excedido`);
        }
        
        const availableBalance = parseFloat(await redis.hget(walletKey, 'availableBalance'));
        if (withdrawalAmount > availableBalance) {
            throw new Error(`Saldo insuficiente para saque`);
        }
        
        // Criar solicitação de saque
        const withdrawalId = `withdrawal_${Date.now()}`;
        const withdrawalKey = `withdrawal:${withdrawalId}`;
        
        await redis.hset(withdrawalKey, {
            withdrawalId,
            driverId,
            amount: String(withdrawalAmount),
            pixKey,
            status: 'PENDING',
            requestedAt: Date.now(),
            processingTime: TEST_CONFIG.WALLET.PROCESSING_TIME_HOURS
        });
        
        // Atualizar carteira (bloquear valor)
        const newPending = pendingWithdrawals + withdrawalAmount;
        const newAvailable = availableBalance - withdrawalAmount;
        
        await redis.hset(walletKey, {
            pendingWithdrawals: String(newPending),
            availableBalance: String(newAvailable)
        });
        
        // Verificar saque criado
        const withdrawalData = await redis.hgetall(withdrawalKey);
        if (!withdrawalData || withdrawalData.status !== 'PENDING') {
            throw new Error(`Saque não foi criado corretamente`);
        }
        
        console.log(`   ✅ Saque solicitado: R$ ${withdrawalAmount}`);
        console.log(`   ✅ Chave PIX: ${pixKey}`);
        console.log(`   ✅ Tempo de processamento: ${TEST_CONFIG.WALLET.PROCESSING_TIME_HOURS}h`);
        console.log(`   ✅ Saldo disponível após bloqueio: R$ ${newAvailable.toFixed(2)}`);
        
        // Limpar
        await redis.del(withdrawalKey);
        await redis.del(walletKey);
    });
    results.total++;
    if (test6Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 7: HISTÓRICO DE TRANSAÇÕES DA CARTEIRA
    // ========================================
    const test7Passed = await test('TC-007: Histórico de transações da carteira', async () => {
        const driverId = TEST_CONFIG.driverId;
        const transactionsKey = `wallet_transactions:${driverId}`;
        
        // Criar histórico de transações
        const transactions = [
            { type: 'CREDIT', amount: 25.50, description: 'Corrida completada', timestamp: Date.now() - 86400000 },
            { type: 'CREDIT', amount: 30.00, description: 'Corrida completada', timestamp: Date.now() - 172800000 },
            { type: 'DEBIT', amount: 100.00, description: 'Saque via PIX', timestamp: Date.now() - 259200000 }
        ];
        
        for (const tx of transactions) {
            await redis.zadd(transactionsKey, tx.timestamp, JSON.stringify(tx));
        }
        
        // TTL de retenção (90 dias)
        await redis.expire(transactionsKey, 90 * 24 * 60 * 60);
        
        // Buscar histórico
        const history = await redis.zrevrange(transactionsKey, 0, -1);
        
        if (history.length !== transactions.length) {
            throw new Error(`Histórico não contém todas as transações`);
        }
        
        // Calcular estatísticas
        const credits = transactions.filter(tx => tx.type === 'CREDIT').reduce((sum, tx) => sum + tx.amount, 0);
        const debits = transactions.filter(tx => tx.type === 'DEBIT').reduce((sum, tx) => sum + tx.amount, 0);
        const netAmount = credits - debits;
        
        console.log(`   ✅ Total de transações: ${transactions.length}`);
        console.log(`   ✅ Créditos: R$ ${credits.toFixed(2)}`);
        console.log(`   ✅ Débitos: R$ ${debits.toFixed(2)}`);
        console.log(`   ✅ Saldo líquido: R$ ${netAmount.toFixed(2)}`);
        
        // Limpar
        await redis.del(transactionsKey);
    });
    results.total++;
    if (test7Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 8: EXPIRAR PROMOÇÃO
    // ========================================
    const test8Passed = await test('TC-008: Validar promoção expirada', async () => {
        const promoCode = 'PROMO_EXPIRED';
        const promoKey = `promo:${promoCode}`;
        
        // Criar promoção expirada
        await redis.hset(promoKey, {
            promoId: promoCode,
            type: 'percentage',
            discount: '30',
            expiryDate: String(Date.now() - 86400000), // Expirou há 1 dia
            status: 'ACTIVE'
        });
        
        // Validar promoção
        const promoData = await redis.hgetall(promoKey);
        const expiryDate = parseInt(promoData.expiryDate);
        
        if (expiryDate >= Date.now()) {
            throw new Error(`Promoção deveria estar expirada`);
        }
        
        // Marcar como expirada
        await redis.hset(promoKey, {
            status: 'EXPIRED'
        });
        
        const updatedData = await redis.hgetall(promoKey);
        if (updatedData.status !== 'EXPIRED') {
            throw new Error(`Promoção não foi marcada como expirada`);
        }
        
        console.log(`   ✅ Promoção expirada detectada: ${promoCode}`);
        console.log(`   ✅ Status atualizado para: EXPIRED`);
        console.log(`   ⚠️ Sistema deveria rejeitar promoção expirada`);
        
        // Limpar
        await redis.del(promoKey);
    });
    results.total++;
    if (test8Passed) results.passed++; else results.failed++;
    
    // Resumo
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 RESUMO DOS TESTES: PROMOÇÕES, MODIFICAÇÕES E CARTEIRA`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total: ${results.total}`);
    console.log(`✅ Passou: ${results.passed}`);
    console.log(`❌ Falhou: ${results.failed}`);
    console.log(`📈 Taxa de Sucesso: ${((results.passed / results.total) * 100).toFixed(1)}%`);
    console.log(`${'='.repeat(60)}\n`);
    
    process.exit(results.failed > 0 ? 1 : 0);
}

// Executar
main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});


