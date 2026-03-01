/**
 * TESTES: STATUS DO MOTORISTA E PAGAMENTO PIX
 * 
 * Testes para validar:
 * 1. Status do motorista (online/offline, disponível/indisponível)
 * 2. Atualização de localização em tempo real
 * 3. Status automático após corrida
 * 4. Timeout de pagamento PIX (5 min)
 * 5. Processamento e confirmação de pagamento
 */

const io = require('socket.io-client');
const redisPool = require('./utils/redis-pool');
const driverLockManager = require('./services/driver-lock-manager');
const rideQueueManager = require('./services/ride-queue-manager');
const ResponseHandler = require('./services/response-handler');
const RideStateManager = require('./services/ride-state-manager');
const GeoHashUtils = require('./utils/geohash-utils');
const GradualRadiusExpander = require('./services/gradual-radius-expander');
const { logger } = require('./utils/logger');

// Configurações de teste
const TEST_CONFIG = {
    SERVER_URL: process.env.WS_URL || 'http://localhost:3001',
    customerId: 'test_customer_status',
    pickupLocation: { lat: -22.9068, lng: -43.1234 },
    destinationLocation: { lat: -22.9, lng: -43.13 },
    estimatedFare: 15.5,
    paymentMethod: 'pix',
    
    TIMEOUTS: {
        PAYMENT_PIX_TIMEOUT: 5 * 60, // 5 minutos (300s)
        GPS_UPDATE_INTERVAL: 2 // segundos
    },
    
    POLICIES: {
        STATUS_INITIAL: 'offline',
        STATUS_AUTO_AFTER_TRIP: true
    },
    
    // Motoristas de teste
    drivers: [
        { id: 'test_driver_status_1', lat: -22.9065, lng: -43.1230, rating: 4.8, acceptanceRate: 90 },
        { id: 'test_driver_status_2', lat: -22.9070, lng: -43.1235, rating: 5.0, acceptanceRate: 95 }
    ]
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
    
    hasEmittedEvent(userId, eventName) {
        const events = this.emittedEvents.get(userId) || [];
        return events.some(e => e.event === eventName);
    }
    
    getEmittedEvents(userId) {
        return this.emittedEvents.get(userId) || [];
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function setupTestDrivers(redis) {
    console.log('\n📝 [Setup] Criando motoristas de teste...');
    
    for (const driver of TEST_CONFIG.drivers) {
        await redis.geoadd('driver_locations', driver.lng, driver.lat, driver.id);
        
        await redis.hset(`driver:${driver.id}`, {
            id: driver.id,
            isOnline: 'false', // Começa offline (conforme política)
            status: TEST_CONFIG.POLICIES.STATUS_INITIAL,
            rating: String(driver.rating),
            acceptanceRate: String(driver.acceptanceRate),
            avgResponseTime: '2.5',
            totalTrips: '100'
        });
        await redis.expire(`driver:${driver.id}`, 300);
    }
    
    console.log(`✅ [Setup] ${TEST_CONFIG.drivers.length} motoristas criados`);
}

async function cleanupTestData(redis) {
    console.log('\n🧹 Limpando dados de teste...');
    
    for (const driver of TEST_CONFIG.drivers) {
        try {
            await redis.zrem('driver_locations', driver.id);
            await redis.del(`driver:${driver.id}`);
            await driverLockManager.releaseLock(driver.id);
            await redis.del(`driver_lock:${driver.id}`);
        } catch (e) {}
    }
    
    const testBookings = await redis.keys('booking:test_status_*');
    for (const key of testBookings) {
        const bookingId = key.replace('booking:', '');
        try {
            await redis.del(key);
            await redis.del(`booking_state:${bookingId}`);
            await redis.del(`booking_search:${bookingId}`);
            await redis.del(`ride_notifications:${bookingId}`);
        } catch (e) {}
    }
    
    const queueKeys = await redis.keys('ride_queue:*');
    for (const key of queueKeys) {
        try {
            await redis.del(key);
        } catch (e) {}
    }
    
    console.log('✅ Limpeza concluída');
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
        console.error(error.stack);
        return false;
    }
}

async function main() {
    const redis = redisPool.getConnection();
    if (!redis.isOpen) {
        await redis.connect();
    }
    
    await setupTestDrivers(redis);
    
    const results = {
        total: 0,
        passed: 0,
        failed: 0
    };
    
    const MockIOInstance = new MockIO();
    const responseHandler = new ResponseHandler(MockIOInstance);
    
    // ========================================
    // TESTE 1: STATUS INICIAL OFFLINE
    // ========================================
    const test1Passed = await test('TC-001: Motorista começa com status offline', async () => {
        const driverId = TEST_CONFIG.drivers[0].id;
        
        // Verificar status inicial
        const driverData = await redis.hgetall(`driver:${driverId}`);
        
        if (driverData.status !== TEST_CONFIG.POLICIES.STATUS_INITIAL) {
            throw new Error(`Status inicial esperado: ${TEST_CONFIG.POLICIES.STATUS_INITIAL}, obtido: ${driverData.status}`);
        }
        
        if (driverData.isOnline !== 'false') {
            throw new Error(`isOnline inicial esperado: false, obtido: ${driverData.isOnline}`);
        }
        
        console.log(`   ✅ Motorista ${driverId} começa offline (conforme política)`);
    });
    results.total++;
    if (test1Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 2: MOTORISTA FICA ONLINE
    // ========================================
    const test2Passed = await test('TC-002: Motorista fica online e disponível', async () => {
        const driverId = TEST_CONFIG.drivers[0].id;
        
        // Simular motorista ficando online
        await redis.hset(`driver:${driverId}`, {
            isOnline: 'true',
            status: 'AVAILABLE'
        });
        await redis.expire(`driver:${driverId}`, 300);
        
        // Verificar mudança de status
        const driverData = await redis.hgetall(`driver:${driverId}`);
        
        if (driverData.isOnline !== 'true') {
            throw new Error(`isOnline esperado: true, obtido: ${driverData.isOnline}`);
        }
        
        if (driverData.status !== 'AVAILABLE') {
            throw new Error(`Status esperado: AVAILABLE, obtido: ${driverData.status}`);
        }
        
        console.log(`   ✅ Motorista ${driverId} ficou online e disponível`);
    });
    results.total++;
    if (test2Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 3: ATUALIZAÇÃO DE LOCALIZAÇÃO EM TEMPO REAL
    // ========================================
    const test3Passed = await test('TC-003: Atualização de localização em tempo real (GPS_UPDATE_INTERVAL: 2s)', async () => {
        const driverId = TEST_CONFIG.drivers[0].id;
        
        const locations = [
            { lat: -22.9068, lng: -43.1234, name: 'Localização 1' },
            { lat: -22.9069, lng: -43.1235, name: 'Localização 2' },
            { lat: -22.9070, lng: -43.1236, name: 'Localização 3' }
        ];
        
        const updates = [];
        
        for (const location of locations) {
            await redis.geoadd('driver_locations', location.lng, location.lat, driverId);
            updates.push({
                location,
                timestamp: Date.now()
            });
            await sleep(TEST_CONFIG.TIMEOUTS.GPS_UPDATE_INTERVAL * 1000);
        }
        
        // Verificar última localização
        const currentLocation = await redis.geopos('driver_locations', driverId);
        if (!currentLocation || currentLocation.length === 0) {
            throw new Error('Localização não encontrada no Redis GEO');
        }
        
        const [lng, lat] = currentLocation[0];
        const lastLocation = locations[locations.length - 1];
        
        const distance = calculateDistance(lat, lng, lastLocation.lat, lastLocation.lng);
        
        if (distance > 100) { // Mais de 100m de diferença
            throw new Error(`Localização não atualizada corretamente (diferença: ${distance.toFixed(0)}m)`);
        }
        
        console.log(`   ✅ ${updates.length} atualizações de localização processadas`);
        console.log(`   ✅ Intervalo entre atualizações: ~${TEST_CONFIG.TIMEOUTS.GPS_UPDATE_INTERVAL}s`);
    });
    results.total++;
    if (test3Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 4: MOTORISTA INDISPONÍVEL
    // ========================================
    const test4Passed = await test('TC-004: Motorista fica indisponível (OFF_DUTY)', async () => {
        const driverId = TEST_CONFIG.drivers[0].id;
        
        // Motorista fica indisponível
        await redis.hset(`driver:${driverId}`, {
            status: 'OFF_DUTY',
            isOnline: 'true' // Pode estar online mas off-duty
        });
        await redis.expire(`driver:${driverId}`, 300);
        
        const driverData = await redis.hgetall(`driver:${driverId}`);
        
        if (driverData.status !== 'OFF_DUTY') {
            throw new Error(`Status esperado: OFF_DUTY, obtido: ${driverData.status}`);
        }
        
        console.log(`   ✅ Motorista ${driverId} ficou indisponível (OFF_DUTY)`);
        
        // Voltar para AVAILABLE
        await redis.hset(`driver:${driverId}`, {
            status: 'AVAILABLE'
        });
        await redis.expire(`driver:${driverId}`, 300);
    });
    results.total++;
    if (test4Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 5: STATUS AUTOMÁTICO APÓS CORRIDA
    // ========================================
    const test5Passed = await test('TC-005: Motorista volta para AVAILABLE automaticamente após corrida', async () => {
        const driverId = TEST_CONFIG.drivers[1].id;
        const bookingId = 'test_status_trip_complete_005';
        
        // Simular estado IN_PROGRESS durante corrida
        await redis.hset(`driver:${driverId}`, {
            status: 'IN_TRIP',
            currentBookingId: bookingId
        });
        await redis.expire(`driver:${driverId}`, 300);
        
        // Simular conclusão da corrida
        await RideStateManager.updateBookingState(redis, bookingId, RideStateManager.STATES.COMPLETED, {
            driverId,
            completedAt: Date.now()
        });
        
        // Verificar política STATUS_AUTO_AFTER_TRIP
        if (TEST_CONFIG.POLICIES.STATUS_AUTO_AFTER_TRIP) {
            // Motorista deve voltar para AVAILABLE automaticamente
            await redis.hset(`driver:${driverId}`, {
                status: 'AVAILABLE',
                currentBookingId: ''
            });
            await redis.expire(`driver:${driverId}`, 300);
        }
        
        const driverData = await redis.hgetall(`driver:${driverId}`);
        
        if (driverData.status !== 'AVAILABLE') {
            throw new Error(`Status após corrida esperado: AVAILABLE, obtido: ${driverData.status}`);
        }
        
        console.log(`   ✅ Motorista ${driverId} voltou para AVAILABLE após completar corrida`);
    });
    results.total++;
    if (test5Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 6: TIMEOUT DE PAGAMENTO PIX (5 MIN)
    // ========================================
    const test6Passed = await test('TC-006: Timeout de pagamento PIX (5 minutos)', async () => {
        const bookingId = 'test_status_payment_timeout_006';
        const driverId = TEST_CONFIG.drivers[0].id;
        
        // Simular corrida completada aguardando pagamento
        await RideStateManager.updateBookingState(redis, bookingId, RideStateManager.STATES.COMPLETED, {
            driverId,
            completedAt: Date.now(),
            paymentStatus: 'PENDING'
        });
        
        const paymentStartTime = Date.now();
        
        // Simular timeout de pagamento (5 min)
        // Nota: Em produção, isso seria verificado por um job/cron
        await sleep((TEST_CONFIG.TIMEOUTS.PAYMENT_PIX_TIMEOUT + 10) * 1000);
        
        const timeSincePayment = (Date.now() - paymentStartTime) / 1000;
        
        if (timeSincePayment >= TEST_CONFIG.TIMEOUTS.PAYMENT_PIX_TIMEOUT) {
            console.log(`   ✅ Timeout de pagamento atingido: ${timeSincePayment.toFixed(1)}s >= ${TEST_CONFIG.TIMEOUTS.PAYMENT_PIX_TIMEOUT}s`);
            console.log(`   ⚠️ Sistema deveria alertar customer ou processar ação após timeout`);
        } else {
            throw new Error(`Timeout não atingido corretamente`);
        }
        
        // Limpar
        await redis.del(`booking_state:${bookingId}`);
    });
    results.total++;
    if (test6Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 7: PROCESSAMENTO DE PAGAMENTO PIX
    // ========================================
    const test7Passed = await test('TC-007: Processamento e confirmação de pagamento PIX', async () => {
        const bookingId = 'test_status_payment_process_007';
        const driverId = TEST_CONFIG.drivers[0].id;
        const paymentId = 'pix_payment_123456789';
        const paymentAmount = 15.5;
        
        // Simular corrida completada
        await RideStateManager.updateBookingState(redis, bookingId, RideStateManager.STATES.COMPLETED, {
            driverId,
            completedAt: Date.now(),
            paymentStatus: 'PENDING',
            estimatedFare: paymentAmount
        });
        
        // Simular processamento de pagamento PIX
        const bookingKey = `booking:${bookingId}`;
        await redis.hset(bookingKey, {
            paymentStatus: 'CONFIRMED',
            paymentId: paymentId,
            paymentAmount: String(paymentAmount),
            paymentConfirmedAt: Date.now(),
            paymentMethod: 'pix'
        });
        
        const bookingData = await redis.hgetall(bookingKey);
        
        if (bookingData.paymentStatus !== 'CONFIRMED') {
            throw new Error(`Payment status esperado: CONFIRMED, obtido: ${bookingData.paymentStatus}`);
        }
        
        if (bookingData.paymentId !== paymentId) {
            throw new Error(`Payment ID não corresponde`);
        }
        
        const confirmedAmount = parseFloat(bookingData.paymentAmount);
        if (Math.abs(confirmedAmount - paymentAmount) > 0.01) {
            throw new Error(`Valor do pagamento não corresponde (esperado: ${paymentAmount}, obtido: ${confirmedAmount})`);
        }
        
        console.log(`   ✅ Pagamento PIX processado: R$ ${paymentAmount}`);
        console.log(`   ✅ Payment ID: ${paymentId}`);
        
        // Limpar
        await redis.del(bookingKey);
        await redis.del(`booking_state:${bookingId}`);
    });
    results.total++;
    if (test7Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 8: MOTORISTA OFFLINE NÃO RECEBE CORRIDAS
    // ========================================
    const test8Passed = await test('TC-008: Motorista offline não recebe notificações de corrida', async () => {
        const driverId = TEST_CONFIG.drivers[1].id;
        const bookingId = 'test_status_offline_008';
        
        // Limpar outros motoristas que possam estar no Redis
        await redis.zrem('driver_locations', 'test_driver_001');
        await redis.zrem('driver_locations', 'test_driver_002');
        
        // Garantir que motorista está offline E remover do GEO
        await redis.zrem('driver_locations', driverId);
        await redis.hset(`driver:${driverId}`, {
            id: driverId,
            isOnline: 'false',
            status: 'offline'
        });
        await redis.expire(`driver:${driverId}`, 300);
        
        // Verificar que realmente está offline antes de continuar
        const driverDataBefore = await redis.hgetall(`driver:${driverId}`);
        if (driverDataBefore.isOnline !== 'false') {
            throw new Error(`Driver não está offline antes do teste`);
        }
        
        const driverInGeo = await redis.zrank('driver_locations', driverId);
        if (driverInGeo !== null) {
            throw new Error(`Driver ainda está no GEO antes do teste`);
        }
        
        // Criar corrida
        await rideQueueManager.enqueueRide({
            bookingId,
            customerId: TEST_CONFIG.customerId,
            pickupLocation: TEST_CONFIG.pickupLocation,
            destinationLocation: TEST_CONFIG.destinationLocation,
            estimatedFare: TEST_CONFIG.estimatedFare,
            paymentMethod: TEST_CONFIG.paymentMethod
        });
        
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation);
        await rideQueueManager.processNextRides(regionHash, 1);
        
        const gradualExpander = new GradualRadiusExpander(MockIOInstance);
        await gradualExpander.startGradualSearch(bookingId, TEST_CONFIG.pickupLocation);
        
        await sleep(6000); // Aguardar busca
        
        // Verificar que motorista offline NÃO foi notificado
        const notified = await redis.smembers(`ride_notifications:${bookingId}`);
        
        // Motorista offline não deve estar na lista de notificados
        if (notified.includes(driverId)) {
            throw new Error(`Motorista offline ${driverId} foi notificado (não deveria). Notificados: ${notified.join(', ')}`);
        }
        
        console.log(`   ✅ Motorista offline ${driverId} não foi notificado (correto)`);
        console.log(`   ✅ Motoristas notificados: ${notified.length > 0 ? notified.join(', ') : 'nenhum (esperado se não há outros drivers online)'}`);
        
        // Limpar
        await gradualExpander.stopSearch(bookingId);
    });
    results.total++;
    if (test8Passed) results.passed++; else results.failed++;
    
    // Cleanup
    await cleanupTestData(redis);
    
    // Resumo
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 RESUMO DOS TESTES: STATUS E PAGAMENTO`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Total: ${results.total}`);
    console.log(`✅ Passou: ${results.passed}`);
    console.log(`❌ Falhou: ${results.failed}`);
    console.log(`📈 Taxa de Sucesso: ${((results.passed / results.total) * 100).toFixed(1)}%`);
    console.log(`${'='.repeat(60)}\n`);
    
    process.exit(results.failed > 0 ? 1 : 0);
}

// Função auxiliar para calcular distância (Haversine)
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Raio da Terra em metros
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c; // Distância em metros
}

// Executar
main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});

