require('dotenv').config();
const redisPool = require('./utils/redis-pool');
const MockSocketIO = require('./test-queue-system-complete').MockSocketIO || class MockSocketIO {
    constructor() {
        this.events = [];
        this.notifications = new Map();
        this.connectedDrivers = new Set();
    }
    _captureNotification(room, event, data) {
        this.events.push({ event, room, data, timestamp: Date.now() });
        if (event === 'newRideRequest') {
            let driverId = null;
            if (room && room.startsWith('driver_')) {
                driverId = room.replace('driver_', '');
            } else if (data && data.driverId) {
                driverId = data.driverId;
            }
            const bookingId = data?.bookingId || data?.notificationData?.bookingId;
            if (driverId && bookingId) {
                if (!this.notifications.has(driverId)) {
                    this.notifications.set(driverId, []);
                }
                const exists = this.notifications.get(driverId).some(n => n.bookingId === bookingId);
                if (!exists) {
                    this.notifications.get(driverId).push({
                        bookingId: bookingId,
                        timestamp: Date.now(),
                        data: data
                    });
                    console.log(`   📱 [MockIO] Notificação capturada: driver=${driverId}, booking=${bookingId}`);
                }
            }
        }
    }
    to(room) {
        const self = this;
        return {
            emit: (event, data) => self._captureNotification(room, event, data)
        };
    }
    in(room) {
        const self = this;
        return {
            fetchSockets: async () => {
                const driverId = room.replace('driver_', '');
                if (self.connectedDrivers.has(driverId)) {
                    return [{ id: 'mock-socket' }];
                }
                return [];
            }
        };
    }
    getNotificationsForDriver(driverId) {
        return this.notifications.get(driverId) || [];
    }
};

const ResponseHandler = require('./services/response-handler');
const RideStateManager = require('./services/ride-state-manager');
const rideQueueManager = require('./services/ride-queue-manager');
const driverLockManager = require('./services/driver-lock-manager');
const GeoHashUtils = require('./utils/geohash-utils');
const GradualRadiusExpander = require('./services/gradual-radius-expander');

const TEST_CONFIG = {
    customerId: 'test_customer_complete',
    pickupLocation: { lat: -23.5505, lng: -46.6333 },
    destinationLocation: { lat: -23.5515, lng: -46.6343 },
    estimatedFare: 15.5,
    paymentMethod: 'pix'
};

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function setupTestDriver(redis, driverId) {
    const driverKey = `driver:${driverId}`;
    await redis.hset(driverKey, {
        id: driverId,
        name: `Test Driver ${driverId}`,
        isOnline: true,
        status: 'AVAILABLE',
        rating: 5.0,
        acceptanceRate: 100.0,
        avgResponseTime: 5.0,
        totalTrips: 100
    });
    
    await redis.geoadd('driver_locations', TEST_CONFIG.pickupLocation.lng, TEST_CONFIG.pickupLocation.lat, driverId);
    
    return { id: driverId };
}

async function cleanup(redis, bookingIds, driverIds) {
    for (const bookingId of bookingIds) {
        await redis.del(`booking:${bookingId}`);
        await redis.del(`booking_search:${bookingId}`);
        await redis.del(`ride_notifications:${bookingId}`);
        await redis.del(`ride_excluded_drivers:${bookingId}`);
    }
    for (const driverId of driverIds) {
        await redis.del(`driver:${driverId}`);
        await redis.zrem('driver_locations', driverId);
        await driverLockManager.releaseLock(driverId);
        await redis.del(`driver_lock:${driverId}`);
        await redis.del(`driver_active_notification:${driverId}`);
    }
}

// PASSO 1: Verificar se sendNextRideToDriver encontra a segunda corrida
async function passo1_sendNextRideToDriverFindsSecondRide() {
    console.log('\n🔍 PASSO 1: sendNextRideToDriver encontra segunda corrida');
    console.log('='.repeat(70));
    const redis = redisPool.getConnection();
    const mockIO = new MockSocketIO();
    const bookingIds = [];
    const driverIds = [];
    
    try {
        // Setup
        const driverId = 'test_driver_step1';
        console.log(`\n📋 Setup: Criando motorista ${driverId}`);
        await setupTestDriver(redis, driverId);
        driverIds.push(driverId);
        mockIO.connectedDrivers.add(driverId);
        
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation, 5);
        console.log(`   ✅ RegionHash: ${regionHash}`);
        
        // Criar 2 corridas
        console.log(`\n📋 Criando 2 corridas...`);
        for (let i = 0; i < 2; i++) {
            const bookingId = `test_step1_${Date.now()}_${i}`;
            bookingIds.push(bookingId);
            await rideQueueManager.enqueueRide({
                bookingId,
                customerId: TEST_CONFIG.customerId,
                pickupLocation: TEST_CONFIG.pickupLocation,
                destinationLocation: TEST_CONFIG.destinationLocation,
                estimatedFare: TEST_CONFIG.estimatedFare,
                paymentMethod: TEST_CONFIG.paymentMethod
            });
            console.log(`   ✅ Corrida ${i + 1} criada: ${bookingId}`);
            await sleep(10);
        }
        
        await sleep(500);
        
        // Processar primeira corrida
        console.log(`\n📋 Processando primeira corrida...`);
        const processed = await rideQueueManager.processNextRides(regionHash, 1);
        const firstBookingId = processed[0];
        console.log(`   ✅ Primeira corrida processada: ${firstBookingId}`);
        
        // Verificar estado
        const firstState = await RideStateManager.getBookingState(redis, firstBookingId);
        console.log(`   📊 Estado da primeira corrida: ${firstState}`);
        
        // Processar segunda corrida
        console.log(`\n📋 Processando segunda corrida...`);
        const processed2 = await rideQueueManager.processNextRides(regionHash, 1);
        const secondBookingId = processed2[0];
        console.log(`   ✅ Segunda corrida processada: ${secondBookingId}`);
        
        // Verificar estado
        const secondState = await RideStateManager.getBookingState(redis, secondBookingId);
        console.log(`   📊 Estado da segunda corrida: ${secondState}`);
        
        // Verificar se está na fila ativa
        const activeQueueKey = `ride_queue:${regionHash}:active`;
        const secondInActive = await redis.hget(activeQueueKey, secondBookingId);
        console.log(`   📊 Segunda corrida na fila ativa: ${secondInActive ? 'sim' : 'não'}`);
        
        await sleep(500);
        
        // Rejeitar primeira corrida
        console.log(`\n📋 Rejeitando primeira corrida...`);
        const responseHandler = new ResponseHandler(mockIO);
        await responseHandler.handleRejectRide(driverId, firstBookingId, 'Teste');
        await sleep(1000);
        
        // Verificar exclusão
        const isExcluded = await redis.sismember(`ride_excluded_drivers:${firstBookingId}`, driverId);
        console.log(`   📊 Motorista excluído da primeira corrida: ${isExcluded ? 'sim' : 'não'}`);
        
        // Verificar se motorista pode receber segunda corrida
        const secondIsExcluded = await redis.sismember(`ride_excluded_drivers:${secondBookingId}`, driverId);
        const secondAlreadyNotified = await redis.sismember(`ride_notifications:${secondBookingId}`, driverId);
        console.log(`   📊 Motorista excluído da segunda corrida: ${secondIsExcluded ? 'sim' : 'não'}`);
        console.log(`   📊 Motorista já notificado para segunda corrida: ${secondAlreadyNotified ? 'sim' : 'não'}`);
        
        // Verificar se sendNextRideToDriver encontra a segunda corrida
        console.log(`\n📋 Chamando sendNextRideToDriver...`);
        const nextRide = await responseHandler.sendNextRideToDriver(driverId);
        
        if (nextRide && nextRide.bookingId === secondBookingId) {
            console.log(`\n   ✅ PASSO 1 PASSOU: sendNextRideToDriver encontrou segunda corrida ${secondBookingId}`);
            return true;
        } else {
            console.log(`\n   ❌ PASSO 1 FALHOU:`);
            console.log(`      - sendNextRideToDriver retornou: ${nextRide ? nextRide.bookingId : 'null'}`);
            console.log(`      - Esperado: ${secondBookingId}`);
            
            // Verificar por que não encontrou
            const activeBookings = await redis.hkeys(activeQueueKey);
            console.log(`      - Corridas na fila ativa: ${activeBookings.length} [${activeBookings.join(', ')}]`);
            
            for (const bookingId of activeBookings) {
                const state = await RideStateManager.getBookingState(redis, bookingId);
                const isExcluded = await redis.sismember(`ride_excluded_drivers:${bookingId}`, driverId);
                const alreadyNotified = await redis.sismember(`ride_notifications:${bookingId}`, driverId);
                console.log(`         - ${bookingId}: estado=${state}, excluído=${isExcluded}, notificado=${alreadyNotified}`);
            }
            
            return false;
        }
    } catch (error) {
        console.log(`\n   ❌ PASSO 1 ERRO: ${error.message}`);
        console.error(error.stack);
        return false;
    } finally {
        await cleanup(redis, bookingIds, driverIds);
    }
}

// PASSO 2: Verificar se notifyDriver envia a notificação
async function passo2_notifyDriverSendsNotification() {
    console.log('\n🔍 PASSO 2: notifyDriver envia notificação');
    console.log('='.repeat(70));
    const redis = redisPool.getConnection();
    const mockIO = new MockSocketIO();
    const bookingIds = [];
    const driverIds = [];
    
    try {
        // Setup
        const driverId = 'test_driver_step2';
        console.log(`\n📋 Setup: Criando motorista ${driverId}`);
        await setupTestDriver(redis, driverId);
        driverIds.push(driverId);
        mockIO.connectedDrivers.add(driverId);
        
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation, 5);
        
        // Criar 1 corrida
        console.log(`\n📋 Criando 1 corrida...`);
        const bookingId = `test_step2_${Date.now()}_0`;
        bookingIds.push(bookingId);
        await rideQueueManager.enqueueRide({
            bookingId,
            customerId: TEST_CONFIG.customerId,
            pickupLocation: TEST_CONFIG.pickupLocation,
            destinationLocation: TEST_CONFIG.destinationLocation,
            estimatedFare: TEST_CONFIG.estimatedFare,
            paymentMethod: TEST_CONFIG.paymentMethod
        });
        console.log(`   ✅ Corrida criada: ${bookingId}`);
        
        await sleep(500);
        await rideQueueManager.processNextRides(regionHash, 1);
        await sleep(500);
        
        // Notificar diretamente
        console.log(`\n📋 Notificando motorista diretamente...`);
        const DriverNotificationDispatcher = require('./services/driver-notification-dispatcher');
        const dispatcher = new DriverNotificationDispatcher(mockIO);
        
        const bookingData = await redis.hgetall(`booking:${bookingId}`);
        const pickupLocation = JSON.parse(bookingData.pickupLocation);
        
        const notified = await dispatcher.notifyDriver(driverId, bookingId, {
            bookingId,
            customerId: bookingData.customerId,
            pickupLocation,
            destinationLocation: JSON.parse(bookingData.destinationLocation),
            estimatedFare: parseFloat(bookingData.estimatedFare),
            paymentMethod: bookingData.paymentMethod
        });
        
        console.log(`   📊 notifyDriver retornou: ${notified}`);
        
        await sleep(200);
        
        // Verificar eventos
        const events = mockIO.events.filter(e => e.event === 'newRideRequest');
        const notifications = mockIO.getNotificationsForDriver(driverId);
        
        console.log(`   📊 Eventos capturados: ${events.length}`);
        console.log(`   📊 Notificações capturadas: ${notifications.length}`);
        
        if (notified && notifications.some(n => n.bookingId === bookingId)) {
            console.log(`\n   ✅ PASSO 2 PASSOU: notifyDriver enviou notificação e foi capturada`);
            return true;
        } else {
            console.log(`\n   ❌ PASSO 2 FALHOU:`);
            console.log(`      - notifyDriver retornou: ${notified}`);
            console.log(`      - Notificações capturadas: ${notifications.map(n => n.bookingId).join(', ')}`);
            console.log(`      - Esperado: ${bookingId}`);
            return false;
        }
    } catch (error) {
        console.log(`\n   ❌ PASSO 2 ERRO: ${error.message}`);
        console.error(error.stack);
        return false;
    } finally {
        await cleanup(redis, bookingIds, driverIds);
    }
}

// PASSO 3: Verificar se segunda corrida está na fila ativa
async function passo3_secondRideInActiveQueue() {
    console.log('\n🔍 PASSO 3: Segunda corrida está na fila ativa');
    console.log('='.repeat(70));
    const redis = redisPool.getConnection();
    const bookingIds = [];
    
    try {
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation, 5);
        
        // Criar 2 corridas
        console.log(`\n📋 Criando 2 corridas...`);
        for (let i = 0; i < 2; i++) {
            const bookingId = `test_step3_${Date.now()}_${i}`;
            bookingIds.push(bookingId);
            await rideQueueManager.enqueueRide({
                bookingId,
                customerId: TEST_CONFIG.customerId,
                pickupLocation: TEST_CONFIG.pickupLocation,
                destinationLocation: TEST_CONFIG.destinationLocation,
                estimatedFare: TEST_CONFIG.estimatedFare,
                paymentMethod: TEST_CONFIG.paymentMethod
            });
            console.log(`   ✅ Corrida ${i + 1} criada: ${bookingId}`);
            await sleep(10);
        }
        
        await sleep(500);
        
        // Processar primeira
        console.log(`\n📋 Processando primeira corrida...`);
        await rideQueueManager.processNextRides(regionHash, 1);
        await sleep(200);
        
        // Processar segunda
        console.log(`\n📋 Processando segunda corrida...`);
        await rideQueueManager.processNextRides(regionHash, 1);
        await sleep(500);
        
        const secondBookingId = bookingIds[1];
        const activeQueueKey = `ride_queue:${regionHash}:active`;
        const secondInActive = await redis.hget(activeQueueKey, secondBookingId);
        const secondState = await RideStateManager.getBookingState(redis, secondBookingId);
        
        console.log(`\n📊 Verificações:`);
        console.log(`   - Segunda corrida: ${secondBookingId}`);
        console.log(`   - Na fila ativa: ${secondInActive ? 'sim' : 'não'}`);
        console.log(`   - Estado: ${secondState}`);
        
        if (secondInActive && secondState === RideStateManager.STATES.SEARCHING) {
            console.log(`\n   ✅ PASSO 3 PASSOU: Segunda corrida está na fila ativa em SEARCHING`);
            return true;
        } else {
            console.log(`\n   ❌ PASSO 3 FALHOU:`);
            console.log(`      - Na fila ativa: ${secondInActive ? 'sim' : 'não'}`);
            console.log(`      - Estado: ${secondState} (esperado: SEARCHING)`);
            return false;
        }
    } catch (error) {
        console.log(`\n   ❌ PASSO 3 ERRO: ${error.message}`);
        console.error(error.stack);
        return false;
    } finally {
        for (const bookingId of bookingIds) {
            await redis.del(`booking:${bookingId}`);
        }
    }
}

// PASSO 4: Verificar se motorista pode receber segunda corrida (não excluído, não notificado)
async function passo4_driverCanReceiveSecondRide() {
    console.log('\n🔍 PASSO 4: Motorista pode receber segunda corrida');
    console.log('='.repeat(70));
    const redis = redisPool.getConnection();
    const bookingIds = [];
    const driverIds = [];
    
    try {
        const driverId = 'test_driver_step4';
        console.log(`\n📋 Setup: Criando motorista ${driverId}`);
        await setupTestDriver(redis, driverId);
        driverIds.push(driverId);
        
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation, 5);
        
        // Criar 2 corridas
        console.log(`\n📋 Criando 2 corridas...`);
        for (let i = 0; i < 2; i++) {
            const bookingId = `test_step4_${Date.now()}_${i}`;
            bookingIds.push(bookingId);
            await rideQueueManager.enqueueRide({
                bookingId,
                customerId: TEST_CONFIG.customerId,
                pickupLocation: TEST_CONFIG.pickupLocation,
                destinationLocation: TEST_CONFIG.destinationLocation,
                estimatedFare: TEST_CONFIG.estimatedFare,
                paymentMethod: TEST_CONFIG.paymentMethod
            });
            console.log(`   ✅ Corrida ${i + 1} criada: ${bookingId}`);
            await sleep(10);
        }
        
        await sleep(500);
        
        // Processar ambas
        console.log(`\n📋 Processando ambas as corridas...`);
        await rideQueueManager.processNextRides(regionHash, 2);
        await sleep(500);
        
        const firstBookingId = bookingIds[0];
        const secondBookingId = bookingIds[1];
        
        // Verificar se motorista foi notificado para alguma
        const firstNotified = await redis.sismember(`ride_notifications:${firstBookingId}`, driverId);
        const secondNotified = await redis.sismember(`ride_notifications:${secondBookingId}`, driverId);
        
        console.log(`\n📊 Antes de rejeitar:`);
        console.log(`   - Primeira corrida notificada: ${firstNotified ? 'sim' : 'não'}`);
        console.log(`   - Segunda corrida notificada: ${secondNotified ? 'sim' : 'não'}`);
        
        // Rejeitar primeira
        console.log(`\n📋 Rejeitando primeira corrida...`);
        const mockIO4 = new MockSocketIO();
        mockIO4.connectedDrivers.add(driverId);
        const responseHandler = new ResponseHandler(mockIO4);
        await responseHandler.handleRejectRide(driverId, firstBookingId, 'Teste');
        await sleep(500);
        
        // Verificar se motorista está excluído da segunda
        const isExcluded = await redis.sismember(`ride_excluded_drivers:${secondBookingId}`, driverId);
        const alreadyNotified = await redis.sismember(`ride_notifications:${secondBookingId}`, driverId);
        
        console.log(`\n📊 Após rejeitar primeira:`);
        console.log(`   - Motorista excluído da segunda: ${isExcluded ? 'sim' : 'não'}`);
        console.log(`   - Motorista já notificado para segunda: ${alreadyNotified ? 'sim' : 'não'}`);
        
        if (!isExcluded && !alreadyNotified) {
            console.log(`\n   ✅ PASSO 4 PASSOU: Motorista não está excluído e não foi notificado para segunda corrida`);
            return true;
        } else {
            console.log(`\n   ❌ PASSO 4 FALHOU:`);
            console.log(`      - Motorista está excluído: ${isExcluded}`);
            console.log(`      - Motorista já foi notificado: ${alreadyNotified}`);
            console.log(`\n   💡 DIAGNÓSTICO:`);
            if (alreadyNotified) {
                console.log(`      - A busca gradual notificou o motorista para a segunda corrida`);
                console.log(`      - ANTES de ele rejeitar a primeira!`);
                console.log(`      - Isso impede que sendNextRideToDriver encontre uma "próxima" corrida`);
            }
            return false;
        }
    } catch (error) {
        console.log(`\n   ❌ PASSO 4 ERRO: ${error.message}`);
        console.error(error.stack);
        return false;
    } finally {
        await cleanup(redis, bookingIds, driverIds);
    }
}

// Executar todos os passos
async function main() {
    console.log('======================================================================');
    console.log('🔍 ANÁLISE PASSO A PASSO - TC-010: Múltiplas Rejeições Consecutivas');
    console.log('======================================================================\n');
    
    const results = {
        total: 4,
        passed: 0,
        failed: 0
    };
    
    const steps = [
        { name: 'sendNextRideToDriver encontra segunda corrida', fn: passo1_sendNextRideToDriverFindsSecondRide },
        { name: 'notifyDriver envia notificação', fn: passo2_notifyDriverSendsNotification },
        { name: 'Segunda corrida está na fila ativa', fn: passo3_secondRideInActiveQueue },
        { name: 'Motorista pode receber segunda corrida', fn: passo4_driverCanReceiveSecondRide }
    ];
    
    for (const step of steps) {
        try {
            const passed = await step.fn();
            if (passed) {
                results.passed++;
            } else {
                results.failed++;
            }
            await sleep(1000); // Pausa entre passos
        } catch (error) {
            console.log(`   ❌ ERRO FATAL: ${error.message}`);
            results.failed++;
        }
    }
    
    console.log('\n======================================================================');
    console.log('📊 RESUMO DA ANÁLISE');
    console.log('======================================================================');
    console.log(`Total de passos: ${results.total}`);
    console.log(`✅ Passou: ${results.passed}`);
    console.log(`❌ Falhou: ${results.failed}`);
    console.log(`📈 Taxa de Sucesso: ${((results.passed / results.total) * 100).toFixed(1)}%`);
    console.log('======================================================================\n');
    
    process.exit(results.failed === 0 ? 0 : 1);
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Erro fatal:', error);
        process.exit(1);
    });
}

module.exports = { main };


