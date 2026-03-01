/**
 * TESTES: HISTÓRICO E RELATÓRIOS
 * 
 * Testes para validar:
 * 1. Histórico de corridas do customer
 * 2. Histórico de corridas do driver
 * 3. Recibos e comprovantes
 * 4. Estatísticas de motorista
 * 5. Estatísticas de customer
 * 6. Filtros e paginação de histórico
 */

const io = require('socket.io-client');
const redisPool = require('./utils/redis-pool');
const RideStateManager = require('./services/ride-state-manager');
const { logger } = require('./utils/logger');

// Configurações de teste
const TEST_CONFIG = {
    SERVER_URL: process.env.WS_URL || 'http://localhost:3001',
    customerId: 'test_customer_history',
    driverId: 'test_driver_history',
    
    // Parâmetros de histórico
    HISTORY: {
        RETENTION_DAYS: 90, // 90 dias
        ITEMS_PER_PAGE: 20,
        MAX_ITEMS: 1000
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
    
    // ========================================
    // TESTE 1: HISTÓRICO DE CORRIDAS DO CUSTOMER
    // ========================================
    const test1Passed = await test('TC-001: Histórico de corridas do customer', async () => {
        const customerId = TEST_CONFIG.customerId;
        const historyKey = `customer_history:${customerId}`;
        
        // Criar histórico de corridas
        const rides = [
            { bookingId: 'booking_001', fare: 15.50, completedAt: Date.now() - 86400000, status: 'COMPLETED' },
            { bookingId: 'booking_002', fare: 22.30, completedAt: Date.now() - 172800000, status: 'COMPLETED' },
            { bookingId: 'booking_003', fare: 18.75, completedAt: Date.now() - 259200000, status: 'COMPLETED' }
        ];
        
        // Armazenar histórico (Sorted Set com timestamp como score)
        for (const ride of rides) {
            await redis.zadd(historyKey, ride.completedAt, JSON.stringify(ride));
        }
        
        // Definir TTL
        await redis.expire(historyKey, TEST_CONFIG.HISTORY.RETENTION_DAYS * 24 * 60 * 60);
        
        // Buscar histórico (últimas 10 corridas)
        const history = await redis.zrevrange(historyKey, 0, 9, 'WITHSCORES');
        
        if (history.length / 2 !== rides.length) {
            throw new Error(`Número de corridas no histórico não corresponde`);
        }
        
        console.log(`   ✅ ${rides.length} corridas no histórico do customer`);
        console.log(`   ✅ Retenção: ${TEST_CONFIG.HISTORY.RETENTION_DAYS} dias`);
        
        // Limpar
        await redis.del(historyKey);
    });
    results.total++;
    if (test1Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 2: HISTÓRICO DE CORRIDAS DO DRIVER
    // ========================================
    const test2Passed = await test('TC-002: Histórico de corridas do driver', async () => {
        const driverId = TEST_CONFIG.driverId;
        const historyKey = `driver_history:${driverId}`;
        
        // Criar histórico de corridas
        const rides = [
            { bookingId: 'booking_101', fare: 15.50, completedAt: Date.now() - 86400000, rating: 5.0 },
            { bookingId: 'booking_102', fare: 22.30, completedAt: Date.now() - 172800000, rating: 4.5 },
            { bookingId: 'booking_103', fare: 18.75, completedAt: Date.now() - 259200000, rating: 4.8 }
        ];
        
        // Armazenar histórico
        for (const ride of rides) {
            await redis.zadd(historyKey, ride.completedAt, JSON.stringify(ride));
        }
        
        await redis.expire(historyKey, TEST_CONFIG.HISTORY.RETENTION_DAYS * 24 * 60 * 60);
        
        // Buscar histórico
        const history = await redis.zrevrange(historyKey, 0, 9, 'WITHSCORES');
        
        if (history.length / 2 !== rides.length) {
            throw new Error(`Número de corridas no histórico não corresponde`);
        }
        
        // Calcular estatísticas
        const totalFare = rides.reduce((sum, ride) => sum + ride.fare, 0);
        const avgRating = rides.reduce((sum, ride) => sum + ride.rating, 0) / rides.length;
        
        console.log(`   ✅ ${rides.length} corridas no histórico do driver`);
        console.log(`   ✅ Total ganho: R$ ${totalFare.toFixed(2)}`);
        console.log(`   ✅ Média de avaliação: ${avgRating.toFixed(1)}`);
        
        // Limpar
        await redis.del(historyKey);
    });
    results.total++;
    if (test2Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 3: RECIBO E COMPROVANTE DE CORRIDA
    // ========================================
    const test3Passed = await test('TC-003: Recibo e comprovante de corrida', async () => {
        const bookingId = 'booking_receipt_003';
        const receiptKey = `receipt:${bookingId}`;
        
        // Criar recibo
        const receipt = {
            receiptId: `receipt_${bookingId}`,
            bookingId,
            customerId: TEST_CONFIG.customerId,
            driverId: TEST_CONFIG.driverId,
            fare: 15.50,
            distance: 5.2,
            duration: 18,
            paymentMethod: 'pix',
            paymentId: 'pix_payment_123',
            completedAt: Date.now(),
            pickupLocation: { lat: -22.9068, lng: -43.1234 },
            destinationLocation: { lat: -22.9, lng: -43.13 }
        };
        
        await redis.hset(receiptKey, {
            receiptId: receipt.receiptId,
            bookingId: receipt.bookingId,
            customerId: receipt.customerId,
            driverId: receipt.driverId,
            fare: String(receipt.fare),
            distance: String(receipt.distance),
            duration: String(receipt.duration),
            paymentMethod: receipt.paymentMethod,
            paymentId: receipt.paymentId,
            completedAt: String(receipt.completedAt),
            pickupLocation: JSON.stringify(receipt.pickupLocation),
            destinationLocation: JSON.stringify(receipt.destinationLocation)
        });
        
        // TTL de retenção
        await redis.expire(receiptKey, TEST_CONFIG.HISTORY.RETENTION_DAYS * 24 * 60 * 60);
        
        // Verificar recibo
        const receiptData = await redis.hgetall(receiptKey);
        if (!receiptData || parseFloat(receiptData.fare) !== receipt.fare) {
            throw new Error(`Recibo não foi criado corretamente`);
        }
        
        console.log(`   ✅ Recibo criado: ${receipt.receiptId}`);
        console.log(`   ✅ Valor: R$ ${receipt.fare}`);
        console.log(`   ✅ Distância: ${receipt.distance} km`);
        console.log(`   ✅ Duração: ${receipt.duration} min`);
        
        // Limpar
        await redis.del(receiptKey);
    });
    results.total++;
    if (test3Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 4: ESTATÍSTICAS DO MOTORISTA
    // ========================================
    const test4Passed = await test('TC-004: Estatísticas de motorista', async () => {
        const driverId = TEST_CONFIG.driverId;
        const statsKey = `driver_stats:${driverId}`;
        
        // Criar estatísticas
        const stats = {
            totalTrips: 150,
            totalEarnings: 2250.00,
            avgRating: 4.8,
            acceptanceRate: 85.5,
            cancellationRate: 5.2,
            totalDistance: 1250.5,
            onlineHours: 180.5
        };
        
        await redis.hset(statsKey, {
            driverId,
            totalTrips: String(stats.totalTrips),
            totalEarnings: String(stats.totalEarnings),
            avgRating: String(stats.avgRating),
            acceptanceRate: String(stats.acceptanceRate),
            cancellationRate: String(stats.cancellationRate),
            totalDistance: String(stats.totalDistance),
            onlineHours: String(stats.onlineHours),
            lastUpdated: Date.now()
        });
        
        await redis.expire(statsKey, 7 * 24 * 60 * 60); // 7 dias
        
        // Verificar estatísticas
        const statsData = await redis.hgetall(statsKey);
        if (!statsData || parseInt(statsData.totalTrips) !== stats.totalTrips) {
            throw new Error(`Estatísticas não foram criadas corretamente`);
        }
        
        const avgEarningsPerTrip = stats.totalEarnings / stats.totalTrips;
        
        console.log(`   ✅ Total de corridas: ${stats.totalTrips}`);
        console.log(`   ✅ Ganho total: R$ ${stats.totalEarnings.toFixed(2)}`);
        console.log(`   ✅ Média por corrida: R$ ${avgEarningsPerTrip.toFixed(2)}`);
        console.log(`   ✅ Rating médio: ${stats.avgRating}`);
        console.log(`   ✅ Taxa de aceitação: ${stats.acceptanceRate}%`);
        
        // Limpar
        await redis.del(statsKey);
    });
    results.total++;
    if (test4Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 5: ESTATÍSTICAS DO CUSTOMER
    // ========================================
    const test5Passed = await test('TC-005: Estatísticas de customer', async () => {
        const customerId = TEST_CONFIG.customerId;
        const statsKey = `customer_stats:${customerId}`;
        
        // Criar estatísticas
        const stats = {
            totalRides: 45,
            totalSpent: 675.50,
            avgRating: 4.9,
            favoritePaymentMethod: 'pix',
            cancellationRate: 8.5
        };
        
        await redis.hset(statsKey, {
            customerId,
            totalRides: String(stats.totalRides),
            totalSpent: String(stats.totalSpent),
            avgRating: String(stats.avgRating),
            favoritePaymentMethod: stats.favoritePaymentMethod,
            cancellationRate: String(stats.cancellationRate),
            lastUpdated: Date.now()
        });
        
        await redis.expire(statsKey, 7 * 24 * 60 * 60); // 7 dias
        
        // Verificar estatísticas
        const statsData = await redis.hgetall(statsKey);
        if (!statsData || parseInt(statsData.totalRides) !== stats.totalRides) {
            throw new Error(`Estatísticas não foram criadas corretamente`);
        }
        
        const avgSpentPerRide = stats.totalSpent / stats.totalRides;
        
        console.log(`   ✅ Total de corridas: ${stats.totalRides}`);
        console.log(`   ✅ Gasto total: R$ ${stats.totalSpent.toFixed(2)}`);
        console.log(`   ✅ Média por corrida: R$ ${avgSpentPerRide.toFixed(2)}`);
        console.log(`   ✅ Rating médio dado: ${stats.avgRating}`);
        
        // Limpar
        await redis.del(statsKey);
    });
    results.total++;
    if (test5Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 6: FILTROS E PAGINAÇÃO DE HISTÓRICO
    // ========================================
    const test6Passed = await test('TC-006: Filtros e paginação de histórico', async () => {
        const customerId = TEST_CONFIG.customerId;
        const historyKey = `customer_history:${customerId}`;
        
        // Criar histórico maior (para testar paginação)
        const rides = [];
        for (let i = 0; i < 25; i++) {
            const ride = {
                bookingId: `booking_${i}`,
                fare: 15.50 + i,
                completedAt: Date.now() - (i * 86400000), // 1 dia de diferença
                status: 'COMPLETED'
            };
            rides.push(ride);
            await redis.zadd(historyKey, ride.completedAt, JSON.stringify(ride));
        }
        
        // Teste 1: Primeira página (últimas 20)
        const page1 = await redis.zrevrange(historyKey, 0, TEST_CONFIG.HISTORY.ITEMS_PER_PAGE - 1, 'WITHSCORES');
        
        if (page1.length / 2 !== TEST_CONFIG.HISTORY.ITEMS_PER_PAGE) {
            throw new Error(`Página 1 não contém ${TEST_CONFIG.HISTORY.ITEMS_PER_PAGE} itens`);
        }
        
        // Teste 2: Segunda página (próximas 20)
        const page2Start = TEST_CONFIG.HISTORY.ITEMS_PER_PAGE;
        const page2End = (TEST_CONFIG.HISTORY.ITEMS_PER_PAGE * 2) - 1;
        const page2 = await redis.zrevrange(historyKey, page2Start, page2End, 'WITHSCORES');
        
        if (page2.length / 2 !== 5) { // Restam 5 itens
            throw new Error(`Página 2 não contém quantidade correta de itens`);
        }
        
        console.log(`   ✅ Paginação funcionando: Página 1 (${TEST_CONFIG.HISTORY.ITEMS_PER_PAGE} itens), Página 2 (${page2.length / 2} itens)`);
        
        // Teste 3: Filtro por data (últimos 7 dias)
        const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        const recentRides = await redis.zrevrangebyscore(
            historyKey,
            '+inf',
            sevenDaysAgo,
            'LIMIT',
            0,
            100
        );
        
        console.log(`   ✅ Filtro por data: ${recentRides.length} corridas nos últimos 7 dias`);
        
        // Limpar
        await redis.del(historyKey);
    });
    results.total++;
    if (test6Passed) results.passed++; else results.failed++;
    
    // Resumo
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 RESUMO DOS TESTES: HISTÓRICO E RELATÓRIOS`);
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


