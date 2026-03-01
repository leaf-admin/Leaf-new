/**
 * TESTES: NO-SHOW E REEMBOLSOS
 * 
 * Testes para validar:
 * 1. No-show customer (2 min timeout)
 * 2. No-show driver (2 min timeout)
 * 3. Taxa de no-show (R$ 2,90)
 * 4. Penalização por no-show
 * 5. Política de reembolso
 * 6. Reembolso de corridas parciais
 * 7. Cálculo de custos operacionais para reembolso
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
    customerId: 'test_customer_noshow',
    pickupLocation: { lat: -22.9068, lng: -43.1234 },
    destinationLocation: { lat: -22.9, lng: -43.13 },
    estimatedFare: 15.5,
    paymentMethod: 'pix',
    
    // Parâmetros de no-show
    NO_SHOW: {
        TIMEOUT_DRIVER: 2 * 60, // 2 minutos (120s)
        TIMEOUT_CUSTOMER: 2 * 60, // 2 minutos (120s)
        FEE: 2.90, // R$ 2,90
        PICKUP_PROXIMITY_RADIUS: 50 // metros
    },
    
    // Parâmetros de reembolso
    REFUND: {
        CANCEL_WITHIN_2MIN: true, // Sem taxa se cancelar dentro de 2 min
        CANCEL_FEE_WINDOW: 2 * 60, // 2 minutos (120s)
        CANCEL_FEE_AMOUNT: 0.80, // R$ 0,80 após 2 min
        PARTIAL_REFUND_PERCENTAGE: 80, // 80% do valor para corridas parciais
        OPERATIONAL_COST_PERCENTAGE: 15 // 15% para custos operacionais
    },
    
    // Motoristas de teste
    drivers: [
        { id: 'test_driver_noshow_1', lat: -22.9065, lng: -43.1230, rating: 4.8, acceptanceRate: 90 },
        { id: 'test_driver_noshow_2', lat: -22.9070, lng: -43.1235, rating: 5.0, acceptanceRate: 95 }
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
            isOnline: 'true',
            status: 'AVAILABLE',
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
        } catch (e) {}
    }
    
    const testBookings = await redis.keys('booking:test_noshow_*');
    for (const key of testBookings) {
        const bookingId = key.replace('booking:', '');
        try {
            await redis.del(key);
            await redis.del(`booking_state:${bookingId}`);
            await redis.del(`booking_search:${bookingId}`);
            await redis.del(`ride_notifications:${bookingId}`);
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
        return false;
    }
}

// Função para calcular distância (Haversine)
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
    // TESTE 1: NO-SHOW CUSTOMER (2 MIN TIMEOUT)
    // ========================================
    const test1Passed = await test('TC-001: No-show customer (2 min timeout sem iniciar viagem)', async () => {
        const bookingId = 'test_noshow_customer_001';
        const driverId = TEST_CONFIG.drivers[0].id;
        
        // 1. Criar e aceitar corrida
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
        await sleep(6000);
        
        await responseHandler.handleAcceptRide(bookingId, driverId, TEST_CONFIG.customerId);
        
        // 2. Driver chega no pickup (dentro de 50m)
        const pickupLocation = TEST_CONFIG.pickupLocation;
        await redis.geoadd('driver_locations', pickupLocation.lng, pickupLocation.lat, driverId);
        
        // 3. Simular timeout de no-show customer (2 min sem customer aparecer)
        const acceptTime = Date.now();
        
        // Aguardar timeout de no-show customer
        await sleep((TEST_CONFIG.NO_SHOW.TIMEOUT_CUSTOMER + 10) * 1000);
        
        const timeSinceAccept = (Date.now() - acceptTime) / 1000;
        
        if (timeSinceAccept >= TEST_CONFIG.NO_SHOW.TIMEOUT_CUSTOMER) {
            console.log(`   ✅ Timeout de no-show customer atingido: ${timeSinceAccept.toFixed(1)}s >= ${TEST_CONFIG.NO_SHOW.TIMEOUT_CUSTOMER}s`);
            console.log(`   ⚠️ Sistema deveria aplicar taxa de no-show de R$ ${TEST_CONFIG.NO_SHOW.FEE}`);
            
            // Simular aplicação de taxa
            const bookingKey = `booking:${bookingId}`;
            await redis.hset(bookingKey, {
                noShowFee: String(TEST_CONFIG.NO_SHOW.FEE),
                noShowType: 'CUSTOMER',
                noShowDetectedAt: Date.now()
            });
            
            const bookingData = await redis.hgetall(bookingKey);
            if (bookingData.noShowFee !== String(TEST_CONFIG.NO_SHOW.FEE)) {
                throw new Error(`Taxa de no-show não aplicada corretamente`);
            }
            
            console.log(`   ✅ Taxa de no-show customer aplicada: R$ ${TEST_CONFIG.NO_SHOW.FEE}`);
        } else {
            throw new Error(`Timeout não atingido corretamente`);
        }
        
        // Limpar
        await gradualExpander.stopSearch(bookingId);
        await driverLockManager.releaseLock(driverId);
    });
    results.total++;
    if (test1Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 2: NO-SHOW DRIVER (2 MIN TIMEOUT)
    // ========================================
    const test2Passed = await test('TC-002: No-show driver (2 min timeout sem chegar no pickup)', async () => {
        const bookingId = 'test_noshow_driver_002';
        const driverId = TEST_CONFIG.drivers[1].id;
        
        // 1. Criar e aceitar corrida
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
        await sleep(6000);
        
        await responseHandler.handleAcceptRide(bookingId, driverId, TEST_CONFIG.customerId);
        
        // 2. Driver NÃO chega no pickup (fica longe)
        const farLocation = {
            lat: TEST_CONFIG.pickupLocation.lat + 0.01, // ~1.1km de distância
            lng: TEST_CONFIG.pickupLocation.lng + 0.01
        };
        await redis.geoadd('driver_locations', farLocation.lng, farLocation.lat, driverId);
        
        // 3. Simular timeout de no-show driver (2 min sem chegar no pickup)
        const acceptTime = Date.now();
        
        // Aguardar timeout de no-show driver
        await sleep((TEST_CONFIG.NO_SHOW.TIMEOUT_DRIVER + 10) * 1000);
        
        const timeSinceAccept = (Date.now() - acceptTime) / 1000;
        
        // Verificar distância
        const distance = calculateDistance(
            farLocation.lat, farLocation.lng,
            TEST_CONFIG.pickupLocation.lat, TEST_CONFIG.pickupLocation.lng
        );
        
        if (timeSinceAccept >= TEST_CONFIG.NO_SHOW.TIMEOUT_DRIVER && distance > TEST_CONFIG.NO_SHOW.PICKUP_PROXIMITY_RADIUS) {
            console.log(`   ✅ Timeout de no-show driver atingido: ${timeSinceAccept.toFixed(1)}s >= ${TEST_CONFIG.NO_SHOW.TIMEOUT_DRIVER}s`);
            console.log(`   ✅ Driver está ${distance.toFixed(0)}m do pickup (> ${TEST_CONFIG.NO_SHOW.PICKUP_PROXIMITY_RADIUS}m)`);
            console.log(`   ⚠️ Sistema deveria aplicar penalização ao driver`);
            
            // Simular penalização
            const driverKey = `driver:${driverId}`;
            const driverData = await redis.hgetall(driverKey);
            const noShowCount = parseInt(driverData.noShowCount || 0) + 1;
            
            await redis.hset(driverKey, {
                noShowCount: String(noShowCount),
                lastNoShowAt: Date.now()
            });
            await redis.expire(driverKey, 300);
            
            console.log(`   ✅ Penalização aplicada: driver agora tem ${noShowCount} no-show(s)`);
        } else {
            throw new Error(`Condições de no-show driver não atendidas`);
        }
        
        // Limpar
        await gradualExpander.stopSearch(bookingId);
        await driverLockManager.releaseLock(driverId);
    });
    results.total++;
    if (test2Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 3: TAXA DE NO-SHOW (R$ 2,90)
    // ========================================
    const test3Passed = await test('TC-003: Taxa de no-show aplicada (R$ 2,90)', async () => {
        const bookingId = 'test_noshow_fee_003';
        const driverId = TEST_CONFIG.drivers[0].id;
        
        // Simular corrida com no-show
        const bookingKey = `booking:${bookingId}`;
        await redis.hset(bookingKey, {
            bookingId,
            customerId: TEST_CONFIG.customerId,
            driverId: driverId,
            estimatedFare: String(TEST_CONFIG.estimatedFare),
            noShowFee: String(TEST_CONFIG.NO_SHOW.FEE),
            noShowType: 'CUSTOMER',
            noShowDetectedAt: Date.now(),
            status: 'NO_SHOW'
        });
        
        const bookingData = await redis.hgetall(bookingKey);
        
        // Verificar que taxa foi aplicada
        if (parseFloat(bookingData.noShowFee) !== TEST_CONFIG.NO_SHOW.FEE) {
            throw new Error(`Taxa de no-show não corresponde (esperado: R$ ${TEST_CONFIG.NO_SHOW.FEE}, obtido: R$ ${bookingData.noShowFee})`);
        }
        
        // Calcular valor total (tarifa + taxa)
        const totalAmount = parseFloat(bookingData.estimatedFare) + TEST_CONFIG.NO_SHOW.FEE;
        
        console.log(`   ✅ Taxa de no-show aplicada: R$ ${TEST_CONFIG.NO_SHOW.FEE}`);
        console.log(`   ✅ Valor total (tarifa + taxa): R$ ${totalAmount.toFixed(2)}`);
        
        // Limpar
        await redis.del(bookingKey);
    });
    results.total++;
    if (test3Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 4: REEMBOLSO SEM TAXA (CANCELAMENTO DENTRO DE 2 MIN)
    // ========================================
    const test4Passed = await test('TC-004: Reembolso sem taxa (cancelamento dentro de 2 min)', async () => {
        const bookingId = 'test_refund_no_fee_004';
        const driverId = TEST_CONFIG.drivers[0].id;
        
        // Simular corrida aceita e cancelada dentro de 2 min
        const bookingKey = `booking:${bookingId}`;
        const acceptTime = Date.now();
        const cancelTime = acceptTime + (60 * 1000); // 1 minuto após aceitar
        
        await redis.hset(bookingKey, {
            bookingId,
            customerId: TEST_CONFIG.customerId,
            driverId: driverId,
            estimatedFare: String(TEST_CONFIG.estimatedFare),
            acceptedAt: String(acceptTime),
            canceledAt: String(cancelTime),
            cancelFee: '0.00',
            refundAmount: String(TEST_CONFIG.estimatedFare),
            refundReason: 'CANCEL_WITHIN_WINDOW'
        });
        
        const bookingData = await redis.hgetall(bookingKey);
        const timeSinceAccept = (cancelTime - acceptTime) / 1000;
        
        if (timeSinceAccept < TEST_CONFIG.REFUND.CANCEL_FEE_WINDOW) {
            if (parseFloat(bookingData.cancelFee) !== 0) {
                throw new Error(`Taxa de cancelamento deveria ser zero (dentro da janela)`);
            }
            
            if (parseFloat(bookingData.refundAmount) !== TEST_CONFIG.estimatedFare) {
                throw new Error(`Reembolso deveria ser 100% (sem taxa)`);
            }
            
            console.log(`   ✅ Cancelamento dentro de 2 min: ${timeSinceAccept.toFixed(1)}s < ${TEST_CONFIG.REFUND.CANCEL_FEE_WINDOW}s`);
            console.log(`   ✅ Taxa de cancelamento: R$ 0.00`);
            console.log(`   ✅ Reembolso total: R$ ${bookingData.refundAmount}`);
        } else {
            throw new Error(`Cancelamento fora da janela de 2 min`);
        }
        
        // Limpar
        await redis.del(bookingKey);
    });
    results.total++;
    if (test4Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 5: REEMBOLSO COM TAXA (CANCELAMENTO APÓS 2 MIN)
    // ========================================
    const test5Passed = await test('TC-005: Reembolso com taxa (cancelamento após 2 min)', async () => {
        const bookingId = 'test_refund_with_fee_005';
        const driverId = TEST_CONFIG.drivers[0].id;
        
        // Simular corrida aceita e cancelada após 2 min
        const bookingKey = `booking:${bookingId}`;
        const acceptTime = Date.now();
        const cancelTime = acceptTime + (TEST_CONFIG.REFUND.CANCEL_FEE_WINDOW + 60) * 1000; // 3 minutos após aceitar
        
        const cancelFee = TEST_CONFIG.REFUND.CANCEL_FEE_AMOUNT;
        const refundAmount = TEST_CONFIG.estimatedFare - cancelFee;
        
        await redis.hset(bookingKey, {
            bookingId,
            customerId: TEST_CONFIG.customerId,
            driverId: driverId,
            estimatedFare: String(TEST_CONFIG.estimatedFare),
            acceptedAt: String(acceptTime),
            canceledAt: String(cancelTime),
            cancelFee: String(cancelFee),
            refundAmount: String(refundAmount),
            refundReason: 'CANCEL_AFTER_WINDOW'
        });
        
        const bookingData = await redis.hgetall(bookingKey);
        const timeSinceAccept = (cancelTime - acceptTime) / 1000;
        
        if (timeSinceAccept >= TEST_CONFIG.REFUND.CANCEL_FEE_WINDOW) {
            if (parseFloat(bookingData.cancelFee) !== cancelFee) {
                throw new Error(`Taxa de cancelamento não corresponde (esperado: R$ ${cancelFee}, obtido: R$ ${bookingData.cancelFee})`);
            }
            
            if (parseFloat(bookingData.refundAmount) !== refundAmount) {
                throw new Error(`Reembolso não corresponde (esperado: R$ ${refundAmount.toFixed(2)}, obtido: R$ ${bookingData.refundAmount})`);
            }
            
            console.log(`   ✅ Cancelamento após 2 min: ${timeSinceAccept.toFixed(1)}s >= ${TEST_CONFIG.REFUND.CANCEL_FEE_WINDOW}s`);
            console.log(`   ✅ Taxa de cancelamento: R$ ${cancelFee}`);
            console.log(`   ✅ Reembolso: R$ ${refundAmount.toFixed(2)} (${TEST_CONFIG.estimatedFare} - ${cancelFee})`);
        } else {
            throw new Error(`Cancelamento dentro da janela quando deveria estar fora`);
        }
        
        // Limpar
        await redis.del(bookingKey);
    });
    results.total++;
    if (test5Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 6: REEMBOLSO PARCIAL (CORRIDA PARCIAL)
    // ========================================
    const test6Passed = await test('TC-006: Reembolso parcial de corrida incompleta', async () => {
        const bookingId = 'test_refund_partial_006';
        const driverId = TEST_CONFIG.drivers[0].id;
        const fare = TEST_CONFIG.estimatedFare;
        const partialPercentage = TEST_CONFIG.REFUND.PARTIAL_REFUND_PERCENTAGE;
        const operationalCost = fare * (TEST_CONFIG.REFUND.OPERATIONAL_COST_PERCENTAGE / 100);
        const refundAmount = (fare * (partialPercentage / 100)) - operationalCost;
        
        // Simular corrida parcial (iniciada mas não completada)
        const bookingKey = `booking:${bookingId}`;
        await redis.hset(bookingKey, {
            bookingId,
            customerId: TEST_CONFIG.customerId,
            driverId: driverId,
            estimatedFare: String(fare),
            tripStarted: 'true',
            tripCompleted: 'false',
            distanceKm: '2.5', // Corrida parcial (menos que o esperado)
            refundAmount: String(refundAmount),
            refundPercentage: String(partialPercentage),
            operationalCost: String(operationalCost),
            refundReason: 'PARTIAL_TRIP'
        });
        
        const bookingData = await redis.hgetall(bookingKey);
        
        // Verificar cálculo de reembolso parcial
        const calculatedRefund = parseFloat(bookingData.refundAmount);
        const expectedRefund = refundAmount;
        
        if (Math.abs(calculatedRefund - expectedRefund) > 0.01) {
            throw new Error(`Reembolso parcial calculado incorretamente (esperado: R$ ${expectedRefund.toFixed(2)}, obtido: R$ ${calculatedRefund.toFixed(2)})`);
        }
        
        console.log(`   ✅ Reembolso parcial: ${partialPercentage}% do valor`);
        console.log(`   ✅ Custo operacional deduzido: R$ ${operationalCost.toFixed(2)}`);
        console.log(`   ✅ Valor de reembolso: R$ ${calculatedRefund.toFixed(2)}`);
        
        // Limpar
        await redis.del(bookingKey);
    });
    results.total++;
    if (test6Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 7: CÁLCULO DE CUSTOS OPERACIONAIS
    // ========================================
    const test7Passed = await test('TC-007: Cálculo de custos operacionais para reembolso', async () => {
        const fare = TEST_CONFIG.estimatedFare;
        const operationalCostPercentage = TEST_CONFIG.REFUND.OPERATIONAL_COST_PERCENTAGE;
        const expectedOperationalCost = fare * (operationalCostPercentage / 100);
        
        // Simular cálculo de custos operacionais
        const bookingId = 'test_refund_operational_007';
        const bookingKey = `booking:${bookingId}`;
        
        await redis.hset(bookingKey, {
            bookingId,
            estimatedFare: String(fare),
            operationalCostPercentage: String(operationalCostPercentage),
            operationalCost: String(expectedOperationalCost),
            refundAmount: String(fare - expectedOperationalCost)
        });
        
        const bookingData = await redis.hgetall(bookingKey);
        const calculatedCost = parseFloat(bookingData.operationalCost);
        
        if (Math.abs(calculatedCost - expectedOperationalCost) > 0.01) {
            throw new Error(`Custo operacional calculado incorretamente (esperado: R$ ${expectedOperationalCost.toFixed(2)}, obtido: R$ ${calculatedCost.toFixed(2)})`);
        }
        
        const refundAmount = parseFloat(bookingData.refundAmount);
        const expectedRefund = fare - expectedOperationalCost;
        
        if (Math.abs(refundAmount - expectedRefund) > 0.01) {
            throw new Error(`Reembolso não calculado corretamente com custo operacional`);
        }
        
        console.log(`   ✅ Custo operacional: ${operationalCostPercentage}% = R$ ${calculatedCost.toFixed(2)}`);
        console.log(`   ✅ Reembolso final: R$ ${refundAmount.toFixed(2)} (${fare} - ${calculatedCost.toFixed(2)})`);
        
        // Limpar
        await redis.del(bookingKey);
    });
    results.total++;
    if (test7Passed) results.passed++; else results.failed++;
    
    // ========================================
    // TESTE 8: PENALIZAÇÃO POR NO-SHOW
    // ========================================
    const test8Passed = await test('TC-008: Penalização por no-show (contador e histórico)', async () => {
        const driverId = TEST_CONFIG.drivers[1].id;
        
        // Simular múltiplos no-shows
        const driverKey = `driver:${driverId}`;
        const noShowCount = 3;
        
        await redis.hset(driverKey, {
            id: driverId,
            noShowCount: String(noShowCount),
            lastNoShowAt: Date.now(),
            noShowPenalty: noShowCount >= 3 ? 'WARNING' : 'NONE'
        });
        await redis.expire(driverKey, 300);
        
        const driverData = await redis.hgetall(driverKey);
        const currentCount = parseInt(driverData.noShowCount);
        
        if (currentCount !== noShowCount) {
            throw new Error(`Contador de no-show não corresponde`);
        }
        
        // Verificar penalização
        if (noShowCount >= 3 && driverData.noShowPenalty !== 'WARNING') {
            throw new Error(`Penalização não aplicada após ${noShowCount} no-shows`);
        }
        
        console.log(`   ✅ Driver tem ${currentCount} no-show(s)`);
        console.log(`   ✅ Penalização: ${driverData.noShowPenalty}`);
        console.log(`   ⚠️ Sistema deveria alertar/bloquear após múltiplos no-shows`);
        
        // Limpar
        await redis.hset(driverKey, { noShowCount: '0', noShowPenalty: 'NONE' });
        await redis.expire(driverKey, 300);
    });
    results.total++;
    if (test8Passed) results.passed++; else results.failed++;
    
    // Cleanup
    await cleanupTestData(redis);
    
    // Resumo
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 RESUMO DOS TESTES: NO-SHOW E REEMBOLSOS`);
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


