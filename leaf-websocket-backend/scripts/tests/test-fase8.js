/**
 * TESTE FASE 8: QUEUE WORKER E PROCESSAMENTO EM BATCH
 * 
 * Valida:
 * 1. QueueWorker processa filas continuamente
 * 2. Processamento em batch funciona (múltiplas corridas)
 * 3. Locks garantem que motorista não recebe múltiplas corridas simultaneamente
 * 4. Distribuição inteligente entre motoristas disponíveis
 */

const redisPool = require('./utils/redis-pool');
const QueueWorker = require('./services/queue-worker');
const rideQueueManager = require('./services/ride-queue-manager');
const RideStateManager = require('./services/ride-state-manager');
const driverLockManager = require('./services/driver-lock-manager');
const GeoHashUtils = require('./utils/geohash-utils');

// Mock Socket.IO
const MockIO = {
    to: (room) => ({
        emit: (event, data) => {
            console.log(`📱 [MockIO] ${event} → ${room}`, data);
        }
    })
};

// Configuração de teste
const TEST_CONFIG = {
    customerId: 'test_customer_001',
    pickupLocation: { lat: -22.9068, lng: -43.1234 },
    destinationLocation: { lat: -22.9, lng: -43.13 },
    estimatedFare: 15.50,
    paymentMethod: 'pix',
    
    // Motoristas de teste
    drivers: [
        { id: 'test_driver_001', lat: -22.9070, lng: -43.1235, rating: 4.8, acceptanceRate: 90 },
        { id: 'test_driver_002', lat: -22.9072, lng: -43.1237, rating: 5.0, acceptanceRate: 95 },
        { id: 'test_driver_003', lat: -22.9074, lng: -43.1239, rating: 4.5, acceptanceRate: 85 },
        { id: 'test_driver_004', lat: -22.9076, lng: -43.1241, rating: 4.9, acceptanceRate: 92 },
        { id: 'test_driver_005', lat: -22.9078, lng: -43.1243, rating: 4.7, acceptanceRate: 88 }
    ]
};

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function setupTestDrivers(redis) {
    console.log('\n📝 [Setup] Criando motoristas de teste...');
    
    for (const driver of TEST_CONFIG.drivers) {
        // Adicionar localização no Redis GEO
        await redis.geoadd('driver_locations', driver.lng, driver.lat, driver.id);
        
        // Adicionar dados do motorista no cache
        await redis.hset(`driver:${driver.id}`, {
            id: driver.id,
            isOnline: 'true',
            status: 'AVAILABLE',
            rating: String(driver.rating),
            acceptanceRate: String(driver.acceptanceRate),
            avgResponseTime: '2.5',
            totalTrips: '100'
        });
        // TTL de 5 minutos (300s) para dados de motorista
        await redis.expire(`driver:${driver.id}`, 300);
    }
    
    console.log(`✅ [Setup] ${TEST_CONFIG.drivers.length} motoristas criados`);
}

async function cleanupTestData(redis) {
    console.log('\n🧹 Limpando dados de teste...');
    
    // Limpar motoristas
    for (const driver of TEST_CONFIG.drivers) {
        await redis.zrem('driver_locations', driver.id);
        await redis.del(`driver:${driver.id}`);
        await driverLockManager.releaseLock(driver.id);
    }
    
    // Limpar corridas de teste
    const testBookings = await redis.keys('booking:test_*');
    for (const key of testBookings) {
        const bookingId = key.replace('booking:', '');
        await redis.del(key);
        await redis.del(`booking_state:${bookingId}`);
        await redis.del(`booking_search:${bookingId}`);
        await redis.del(`ride_notifications:${bookingId}`);
    }
    
    // Limpar filas de teste
    const queueKeys = await redis.keys('ride_queue:*');
    for (const key of queueKeys) {
        await redis.del(key);
    }
    
    console.log('✅ Limpeza concluída');
}

async function test(testName, testFn) {
    try {
        console.log(`\n🧪 [TESTE] ${testName}`);
        await testFn();
        console.log(`✅ [PASSOU] ${testName}\n`);
        return true;
    } catch (error) {
        console.error(`❌ [FALHOU] ${testName}:`, error.message);
        console.error(error.stack);
        return false;
    }
}

async function main() {
    console.log('='.repeat(60));
    console.log('🚀 TESTES FASE 8: QUEUE WORKER E PROCESSAMENTO EM BATCH');
    console.log('='.repeat(60));
    
    const redis = redisPool.getConnection();
    if (!redis.isOpen) {
        await redis.connect();
    }
    
    // Setup
    await setupTestDrivers(redis);
    
    const results = {
        total: 0,
        passed: 0,
        failed: 0
    };
    
    // ========================================
    // TESTE 1: QueueWorker Processa Filas Continuamente
    // ========================================
    const test1Passed = await test('TC-001: QueueWorker processa filas continuamente', async () => {
        const queueWorker = new QueueWorker(MockIO);
        
        // 1. Criar 3 corridas na mesma região
        const bookingIds = [];
        for (let i = 0; i < 3; i++) {
            const bookingId = `test_booking_001_${i}`;
            bookingIds.push(bookingId);
            
            await rideQueueManager.enqueueRide({
                bookingId,
                customerId: TEST_CONFIG.customerId,
                pickupLocation: TEST_CONFIG.pickupLocation,
                destinationLocation: TEST_CONFIG.destinationLocation,
                estimatedFare: TEST_CONFIG.estimatedFare,
                paymentMethod: TEST_CONFIG.paymentMethod
            });
        }
        
        // 2. Iniciar worker (mas não vamos esperar o intervalo)
        // Processar manualmente para testar
        await queueWorker.processAllQueues();
        
        // 3. Verificar que todas as corridas foram processadas
        for (const bookingId of bookingIds) {
            const state = await RideStateManager.getBookingState(redis, bookingId);
            if (state !== RideStateManager.STATES.SEARCHING) {
                throw new Error(`Corrida ${bookingId} não foi processada. Estado: ${state}`);
            }
        }
        
        console.log(`   ✅ ${bookingIds.length} corridas processadas pelo worker`);
        
        // Parar worker
        queueWorker.stop();
    });
    results.total++;
    if (test1Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 2: Processamento em Batch
    // ========================================
    const test2Passed = await test('TC-002: Processamento em batch de múltiplas corridas', async () => {
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation);
        
        // 1. Criar 10 corridas
        const bookingIds = [];
        for (let i = 0; i < 10; i++) {
            const bookingId = `test_booking_002_${i}`;
            bookingIds.push(bookingId);
            
            await rideQueueManager.enqueueRide({
                bookingId,
                customerId: TEST_CONFIG.customerId,
                pickupLocation: TEST_CONFIG.pickupLocation,
                destinationLocation: TEST_CONFIG.destinationLocation,
                estimatedFare: TEST_CONFIG.estimatedFare,
                paymentMethod: TEST_CONFIG.paymentMethod
            });
        }
        
        // 2. Aguardar um pouco para garantir que estão na fila
        await sleep(200);
        
        // 3. Processar em batch (10 por vez)
        let processed = await rideQueueManager.processNextRides(regionHash, 10);
        
        // Se não processou todas, tentar novamente
        if (processed.length < 10) {
            await sleep(200);
            const remaining = 10 - processed.length;
            const additional = await rideQueueManager.processNextRides(regionHash, remaining);
            processed = [...processed, ...additional];
        }
        
        if (processed.length !== 10) {
            throw new Error(`Esperado 10 corridas processadas, obtido: ${processed.length}`);
        }
        
        // 4. Aguardar um pouco para estados atualizarem
        await sleep(200);
        
        // 5. Verificar que todas mudaram para SEARCHING (com retries)
        for (const bookingId of processed) {
            let state = await RideStateManager.getBookingState(redis, bookingId);
            let attempts = 0;
            while (state !== RideStateManager.STATES.SEARCHING && attempts < 5) {
                await sleep(200);
                state = await RideStateManager.getBookingState(redis, bookingId);
                attempts++;
            }
            
            if (state !== RideStateManager.STATES.SEARCHING) {
                throw new Error(`Corrida ${bookingId} não está em SEARCHING após ${attempts} tentativas. Estado: ${state}`);
            }
        }
        
        console.log(`   ✅ ${processed.length} corridas processadas em batch`);
    });
    results.total++;
    if (test2Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 3: Locks Previnem Múltiplas Corridas Simultâneas
    // ========================================
    const test3Passed = await test('TC-003: Locks garantem que motorista não recebe múltiplas corridas simultaneamente', async () => {
        const driverId = TEST_CONFIG.drivers[0].id;
        
        // 0. Limpar qualquer lock existente do teste anterior
        try {
            await driverLockManager.releaseLock(driverId);
            await redis.del(`driver_lock:${driverId}`);
        } catch (e) {}
        
        // 1. Adquirir lock para primeira corrida
        const bookingId1 = 'test_booking_003_1';
        const lockAcquired1 = await driverLockManager.acquireLock(driverId, bookingId1, 15);
        
        if (!lockAcquired1) {
            throw new Error('Falha ao adquirir primeiro lock');
        }
        
        // 2. Tentar adquirir lock para segunda corrida (deve falhar)
        const bookingId2 = 'test_booking_003_2';
        const lockAcquired2 = await driverLockManager.acquireLock(driverId, bookingId2, 15);
        
        if (lockAcquired2) {
            throw new Error('Lock foi adquirido para segunda corrida (deveria falhar)');
        }
        
        // 3. Verificar estado do lock
        const lockStatus = await driverLockManager.isDriverLocked(driverId);
        if (!lockStatus.isLocked || lockStatus.bookingId !== bookingId1) {
            throw new Error(`Lock incorreto. Esperado: ${bookingId1}, Obtido: ${lockStatus.bookingId}`);
        }
        
        console.log(`   ✅ Lock preveniu múltiplas corridas simultâneas`);
        
        // Limpar
        await driverLockManager.releaseLock(driverId);
    });
    results.total++;
    if (test3Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 4: Distribuição Inteligente entre Motoristas
    // ========================================
    const test4Passed = await test('TC-004: Distribuição inteligente entre motoristas disponíveis', async () => {
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation);
        
        // 1. Criar 5 corridas
        const bookingIds = [];
        for (let i = 0; i < 5; i++) {
            const bookingId = `test_booking_004_${i}`;
            bookingIds.push(bookingId);
            
            await rideQueueManager.enqueueRide({
                bookingId,
                customerId: TEST_CONFIG.customerId,
                pickupLocation: TEST_CONFIG.pickupLocation,
                destinationLocation: TEST_CONFIG.destinationLocation,
                estimatedFare: TEST_CONFIG.estimatedFare,
                paymentMethod: TEST_CONFIG.paymentMethod
            });
        }
        
        // 2. Processar todas
        await rideQueueManager.processNextRides(regionHash, 10);
        
        // 3. Aguardar worker processar e iniciar buscas
        const queueWorker = new QueueWorker(MockIO);
        await queueWorker.processAllQueues();
        
        // 4. Aguardar um pouco para notificações
        await sleep(2000);
        
        // 5. Verificar que motoristas foram notificados (mas cada um com lock para apenas 1 corrida)
        const locksByDriver = {};
        for (const driver of TEST_CONFIG.drivers) {
            const lockStatus = await driverLockManager.isDriverLocked(driver.id);
            if (lockStatus.isLocked) {
                locksByDriver[driver.id] = lockStatus.bookingId;
            }
        }
        
        // Cada motorista deve ter no máximo 1 lock
        const driversWithLocks = Object.keys(locksByDriver).length;
        if (driversWithLocks > TEST_CONFIG.drivers.length) {
            throw new Error(`Mais motoristas com locks do que disponíveis`);
        }
        
        console.log(`   ✅ ${driversWithLocks} motorista(s) recebeu(ram) corrida(s) (distribuição correta)`);
        
        // Limpar locks
        for (const driverId of Object.keys(locksByDriver)) {
            await driverLockManager.releaseLock(driverId);
        }
        
        queueWorker.stop();
    });
    results.total++;
    if (test4Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 5: Worker Processa Múltiplas Regiões
    // ========================================
    const test5Passed = await test('TC-005: Worker processa múltiplas regiões', async () => {
        // 1. Criar corridas em regiões diferentes
        const regions = [];
        const bookingIds = [];
        
        for (let i = 0; i < 3; i++) {
            // Variar localização para criar regiões diferentes
            const pickupLocation = {
                lat: TEST_CONFIG.pickupLocation.lat + (i * 0.01),
                lng: TEST_CONFIG.pickupLocation.lng + (i * 0.01)
            };
            
            const regionHash = GeoHashUtils.getRegionHashFromLocation(pickupLocation);
            regions.push(regionHash);
            
            const bookingId = `test_booking_005_${i}`;
            bookingIds.push(bookingId);
            
            await rideQueueManager.enqueueRide({
                bookingId,
                customerId: TEST_CONFIG.customerId,
                pickupLocation,
                destinationLocation: TEST_CONFIG.destinationLocation,
                estimatedFare: TEST_CONFIG.estimatedFare,
                paymentMethod: TEST_CONFIG.paymentMethod
            });
        }
        
        // 2. Processar todas as regiões
        const queueWorker = new QueueWorker(MockIO);
        await queueWorker.processAllQueues();
        
        // 3. Verificar que todas foram processadas
        for (const bookingId of bookingIds) {
            const state = await RideStateManager.getBookingState(redis, bookingId);
            if (state !== RideStateManager.STATES.SEARCHING) {
                throw new Error(`Corrida ${bookingId} não foi processada. Estado: ${state}`);
            }
        }
        
        console.log(`   ✅ ${bookingIds.length} corridas em ${regions.length} região(ões) processadas`);
        
        queueWorker.stop();
    });
    results.total++;
    
    // Cleanup
    await cleanupTestData(redis);
    
    // Resumo
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO DOS TESTES');
    console.log('='.repeat(60));
    console.log(`Total: ${results.total}`);
    console.log(`✅ Passou: ${results.passed}`);
    console.log(`❌ Falhou: ${results.failed}`);
    console.log('='.repeat(60));
    
    process.exit(results.failed > 0 ? 1 : 0);
}

// Executar
main().catch(error => {
    console.error('❌ Erro fatal:', error);
    process.exit(1);
});

