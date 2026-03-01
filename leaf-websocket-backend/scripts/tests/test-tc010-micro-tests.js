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

// MICRO TESTE 1: Verificar se sendNextRideToDriver encontra a segunda corrida
async function test1_sendNextRideToDriverFindsSecondRide() {
    console.log('\n🧪 MICRO TESTE 1: sendNextRideToDriver encontra segunda corrida');
    const redis = redisPool.getConnection();
    const mockIO = new MockSocketIO();
    const bookingIds = [];
    const driverIds = [];
    
    try {
        // Setup
        const driverId = 'test_driver_micro1';
        await setupTestDriver(redis, driverId);
        driverIds.push(driverId);
        mockIO.connectedDrivers.add(driverId);
        
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation, 5);
        
        // Criar 2 corridas
        for (let i = 0; i < 2; i++) {
            const bookingId = `test_micro1_${Date.now()}_${i}`;
            bookingIds.push(bookingId);
            await rideQueueManager.enqueueRide({
                bookingId,
                customerId: TEST_CONFIG.customerId,
                pickupLocation: TEST_CONFIG.pickupLocation,
                destinationLocation: TEST_CONFIG.destinationLocation,
                estimatedFare: TEST_CONFIG.estimatedFare,
                paymentMethod: TEST_CONFIG.paymentMethod
            });
            await sleep(10);
        }
        
        await sleep(500);
        
        // Processar primeira corrida
        const processed = await rideQueueManager.processNextRides(regionHash, 1);
        const firstBookingId = processed[0];
        console.log(`   ✅ Primeira corrida processada: ${firstBookingId}`);
        
        // Processar segunda corrida
        const processed2 = await rideQueueManager.processNextRides(regionHash, 1);
        const secondBookingId = processed2[0];
        console.log(`   ✅ Segunda corrida processada: ${secondBookingId}`);
        
        await sleep(500);
        
        // Rejeitar primeira corrida
        const responseHandler = new ResponseHandler(mockIO);
        await responseHandler.handleRejectRide(driverId, firstBookingId, 'Teste');
        await sleep(1000);
        
        // Verificar se sendNextRideToDriver encontrou a segunda corrida
        const nextRide = await responseHandler.sendNextRideToDriver(driverId);
        
        if (nextRide && nextRide.bookingId === secondBookingId) {
            console.log(`   ✅ PASSOU: sendNextRideToDriver encontrou segunda corrida ${secondBookingId}`);
            return true;
        } else {
            console.log(`   ❌ FALHOU: sendNextRideToDriver encontrou ${nextRide?.bookingId || 'null'}, esperado ${secondBookingId}`);
            return false;
        }
    } catch (error) {
        console.log(`   ❌ ERRO: ${error.message}`);
        return false;
    } finally {
        await cleanup(redis, bookingIds, driverIds);
    }
}

// MICRO TESTE 2: Verificar se notifyDriver envia a notificação
async function test2_notifyDriverSendsNotification() {
    console.log('\n🧪 MICRO TESTE 2: notifyDriver envia notificação');
    const redis = redisPool.getConnection();
    const mockIO = new MockSocketIO();
    const bookingIds = [];
    const driverIds = [];
    
    try {
        // Setup
        const driverId = 'test_driver_micro2';
        await setupTestDriver(redis, driverId);
        driverIds.push(driverId);
        mockIO.connectedDrivers.add(driverId);
        
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation, 5);
        
        // Criar 1 corrida
        const bookingId = `test_micro2_${Date.now()}_0`;
        bookingIds.push(bookingId);
        await rideQueueManager.enqueueRide({
            bookingId,
            customerId: TEST_CONFIG.customerId,
            pickupLocation: TEST_CONFIG.pickupLocation,
            destinationLocation: TEST_CONFIG.destinationLocation,
            estimatedFare: TEST_CONFIG.estimatedFare,
            paymentMethod: TEST_CONFIG.paymentMethod
        });
        
        await sleep(500);
        await rideQueueManager.processNextRides(regionHash, 1);
        await sleep(500);
        
        // Notificar diretamente
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
        
        if (notified) {
            const notifications = mockIO.getNotificationsForDriver(driverId);
            if (notifications.some(n => n.bookingId === bookingId)) {
                console.log(`   ✅ PASSOU: notifyDriver enviou notificação e foi capturada`);
                return true;
            } else {
                console.log(`   ❌ FALHOU: notifyDriver retornou true mas notificação não foi capturada`);
                console.log(`      Notificações capturadas: ${notifications.map(n => n.bookingId).join(', ')}`);
                return false;
            }
        } else {
            console.log(`   ❌ FALHOU: notifyDriver retornou false`);
            return false;
        }
    } catch (error) {
        console.log(`   ❌ ERRO: ${error.message}`);
        return false;
    } finally {
        await cleanup(redis, bookingIds, driverIds);
    }
}

// MICRO TESTE 3: Verificar se segunda corrida está na fila ativa após processamento
async function test3_secondRideInActiveQueue() {
    console.log('\n🧪 MICRO TESTE 3: Segunda corrida está na fila ativa');
    const redis = redisPool.getConnection();
    const bookingIds = [];
    
    try {
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation, 5);
        
        // Criar 2 corridas
        for (let i = 0; i < 2; i++) {
            const bookingId = `test_micro3_${Date.now()}_${i}`;
            bookingIds.push(bookingId);
            await rideQueueManager.enqueueRide({
                bookingId,
                customerId: TEST_CONFIG.customerId,
                pickupLocation: TEST_CONFIG.pickupLocation,
                destinationLocation: TEST_CONFIG.destinationLocation,
                estimatedFare: TEST_CONFIG.estimatedFare,
                paymentMethod: TEST_CONFIG.paymentMethod
            });
            await sleep(10);
        }
        
        await sleep(500);
        
        // Processar primeira
        await rideQueueManager.processNextRides(regionHash, 1);
        await sleep(200);
        
        // Processar segunda
        await rideQueueManager.processNextRides(regionHash, 1);
        await sleep(500);
        
        const secondBookingId = bookingIds[1];
        const activeQueueKey = `ride_queue:${regionHash}:active`;
        const secondInActive = await redis.hget(activeQueueKey, secondBookingId);
        const secondState = await RideStateManager.getBookingState(redis, secondBookingId);
        
        if (secondInActive && secondState === RideStateManager.STATES.SEARCHING) {
            console.log(`   ✅ PASSOU: Segunda corrida ${secondBookingId} está na fila ativa em SEARCHING`);
            return true;
        } else {
            console.log(`   ❌ FALHOU: Segunda corrida não está na fila ativa ou estado incorreto`);
            console.log(`      Na fila ativa: ${secondInActive ? 'sim' : 'não'}`);
            console.log(`      Estado: ${secondState}`);
            return false;
        }
    } catch (error) {
        console.log(`   ❌ ERRO: ${error.message}`);
        return false;
    } finally {
        for (const bookingId of bookingIds) {
            await redis.del(`booking:${bookingId}`);
        }
    }
}

// MICRO TESTE 4: Verificar se motorista pode receber segunda corrida (não excluído, não notificado)
async function test4_driverCanReceiveSecondRide() {
    console.log('\n🧪 MICRO TESTE 4: Motorista pode receber segunda corrida');
    const redis = redisPool.getConnection();
    const bookingIds = [];
    const driverIds = [];
    
    try {
        const driverId = 'test_driver_micro4';
        await setupTestDriver(redis, driverId);
        driverIds.push(driverId);
        
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation, 5);
        
        // Criar 2 corridas
        for (let i = 0; i < 2; i++) {
            const bookingId = `test_micro4_${Date.now()}_${i}`;
            bookingIds.push(bookingId);
            await rideQueueManager.enqueueRide({
                bookingId,
                customerId: TEST_CONFIG.customerId,
                pickupLocation: TEST_CONFIG.pickupLocation,
                destinationLocation: TEST_CONFIG.destinationLocation,
                estimatedFare: TEST_CONFIG.estimatedFare,
                paymentMethod: TEST_CONFIG.paymentMethod
            });
            await sleep(10);
        }
        
        await sleep(500);
        await rideQueueManager.processNextRides(regionHash, 2);
        await sleep(500);
        
        const firstBookingId = bookingIds[0];
        const secondBookingId = bookingIds[1];
        
        // Rejeitar primeira
        const mockIO4 = new MockSocketIO();
        mockIO4.connectedDrivers.add(driverId);
        const responseHandler = new ResponseHandler(mockIO4);
        await responseHandler.handleRejectRide(driverId, firstBookingId, 'Teste');
        await sleep(500);
        
        // Verificar se motorista está excluído da segunda
        const isExcluded = await redis.sismember(`ride_excluded_drivers:${secondBookingId}`, driverId);
        const alreadyNotified = await redis.sismember(`ride_notifications:${secondBookingId}`, driverId);
        
        if (!isExcluded && !alreadyNotified) {
            console.log(`   ✅ PASSOU: Motorista não está excluído e não foi notificado para segunda corrida`);
            return true;
        } else {
            console.log(`   ❌ FALHOU: Motorista está excluído=${isExcluded}, já notificado=${alreadyNotified}`);
            return false;
        }
    } catch (error) {
        console.log(`   ❌ ERRO: ${error.message}`);
        return false;
    } finally {
        await cleanup(redis, bookingIds, driverIds);
    }
}

// MICRO TESTE 5: Verificar se evento é capturado pelo mockIO
async function test5_eventCapturedByMockIO() {
    console.log('\n🧪 MICRO TESTE 5: Evento é capturado pelo mockIO');
    const redis = redisPool.getConnection();
    const mockIO = new MockSocketIO();
    const bookingIds = [];
    const driverIds = [];
    
    try {
        const driverId = 'test_driver_micro5';
        await setupTestDriver(redis, driverId);
        driverIds.push(driverId);
        mockIO.connectedDrivers.add(driverId);
        
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation, 5);
        
        // Criar 1 corrida
        const bookingId = `test_micro5_${Date.now()}_0`;
        bookingIds.push(bookingId);
        await rideQueueManager.enqueueRide({
            bookingId,
            customerId: TEST_CONFIG.customerId,
            pickupLocation: TEST_CONFIG.pickupLocation,
            destinationLocation: TEST_CONFIG.destinationLocation,
            estimatedFare: TEST_CONFIG.estimatedFare,
            paymentMethod: TEST_CONFIG.paymentMethod
        });
        
        await sleep(500);
        await rideQueueManager.processNextRides(regionHash, 1);
        await sleep(500);
        
        // Notificar
        const DriverNotificationDispatcher = require('./services/driver-notification-dispatcher');
        const dispatcher = new DriverNotificationDispatcher(mockIO);
        
        const bookingData = await redis.hgetall(`booking:${bookingId}`);
        const pickupLocation = JSON.parse(bookingData.pickupLocation);
        
        await dispatcher.notifyDriver(driverId, bookingId, {
            bookingId,
            customerId: bookingData.customerId,
            pickupLocation,
            destinationLocation: JSON.parse(bookingData.destinationLocation),
            estimatedFare: parseFloat(bookingData.estimatedFare),
            paymentMethod: bookingData.paymentMethod
        });
        
        await sleep(200);
        
        // Verificar eventos
        const events = mockIO.events.filter(e => e.event === 'newRideRequest');
        const notifications = mockIO.getNotificationsForDriver(driverId);
        
        if (events.length > 0 && notifications.some(n => n.bookingId === bookingId)) {
            console.log(`   ✅ PASSOU: Evento capturado (${events.length} eventos, ${notifications.length} notificações)`);
            return true;
        } else {
            console.log(`   ❌ FALHOU: Evento não capturado`);
            console.log(`      Eventos: ${events.length}, Notificações: ${notifications.length}`);
            return false;
        }
    } catch (error) {
        console.log(`   ❌ ERRO: ${error.message}`);
        return false;
    } finally {
        await cleanup(redis, bookingIds, driverIds);
    }
}

// MICRO TESTE 6: Fluxo completo - rejeitar primeira e receber segunda
async function test6_completeFlow() {
    console.log('\n🧪 MICRO TESTE 6: Fluxo completo - rejeitar primeira e receber segunda');
    const redis = redisPool.getConnection();
    const mockIO = new MockSocketIO();
    const bookingIds = [];
    const driverIds = [];
    
    try {
        const driverId = 'test_driver_micro6';
        await setupTestDriver(redis, driverId);
        driverIds.push(driverId);
        mockIO.connectedDrivers.add(driverId);
        
        const regionHash = GeoHashUtils.getRegionHashFromLocation(TEST_CONFIG.pickupLocation, 5);
        
        // Criar 2 corridas
        for (let i = 0; i < 2; i++) {
            const bookingId = `test_micro6_${Date.now()}_${i}`;
            bookingIds.push(bookingId);
            await rideQueueManager.enqueueRide({
                bookingId,
                customerId: TEST_CONFIG.customerId,
                pickupLocation: TEST_CONFIG.pickupLocation,
                destinationLocation: TEST_CONFIG.destinationLocation,
                estimatedFare: TEST_CONFIG.estimatedFare,
                paymentMethod: TEST_CONFIG.paymentMethod
            });
            await sleep(10);
        }
        
        await sleep(500);
        
        // Processar ambas
        await rideQueueManager.processNextRides(regionHash, 2);
        await sleep(1000);
        
        const firstBookingId = bookingIds[0];
        const secondBookingId = bookingIds[1];
        
        // Iniciar busca gradual para primeira
        const gradualExpander = new GradualRadiusExpander(mockIO);
        const bookingData = await redis.hgetall(`booking:${firstBookingId}`);
        const pickupLocation = JSON.parse(bookingData.pickupLocation);
        await gradualExpander.startGradualSearch(firstBookingId, pickupLocation);
        await sleep(2000);
        
        // Rejeitar primeira
        const responseHandler = new ResponseHandler(mockIO);
        await responseHandler.handleRejectRide(driverId, firstBookingId, 'Teste');
        await sleep(2000);
        
        // Verificar se segunda foi notificada
        const notifications = mockIO.getNotificationsForDriver(driverId);
        const hasSecondRide = notifications.some(n => n.bookingId === secondBookingId);
        
        if (hasSecondRide) {
            console.log(`   ✅ PASSOU: Segunda corrida ${secondBookingId} foi notificada`);
            return true;
        } else {
            console.log(`   ❌ FALHOU: Segunda corrida não foi notificada`);
            console.log(`      Notificações: ${notifications.map(n => n.bookingId).join(', ')}`);
            console.log(`      Esperado: ${secondBookingId}`);
            
            // Verificar se sendNextRideToDriver foi chamado
            const nextRide = await responseHandler.sendNextRideToDriver(driverId);
            console.log(`      sendNextRideToDriver retornou: ${nextRide?.bookingId || 'null'}`);
            
            return false;
        }
    } catch (error) {
        console.log(`   ❌ ERRO: ${error.message}`);
        console.error(error.stack);
        return false;
    } finally {
        await cleanup(redis, bookingIds, driverIds);
    }
}

// Executar todos os micro testes
async function main() {
    console.log('======================================================================');
    console.log('🧪 MICRO TESTES - TC-010: Múltiplas Rejeições Consecutivas');
    console.log('======================================================================\n');
    
    const results = {
        total: 6,
        passed: 0,
        failed: 0
    };
    
    const tests = [
        { name: 'sendNextRideToDriver encontra segunda corrida', fn: test1_sendNextRideToDriverFindsSecondRide },
        { name: 'notifyDriver envia notificação', fn: test2_notifyDriverSendsNotification },
        { name: 'Segunda corrida está na fila ativa', fn: test3_secondRideInActiveQueue },
        { name: 'Motorista pode receber segunda corrida', fn: test4_driverCanReceiveSecondRide },
        { name: 'Evento é capturado pelo mockIO', fn: test5_eventCapturedByMockIO },
        { name: 'Fluxo completo', fn: test6_completeFlow }
    ];
    
    for (const test of tests) {
        try {
            const passed = await test.fn();
            if (passed) {
                results.passed++;
            } else {
                results.failed++;
            }
        } catch (error) {
            console.log(`   ❌ ERRO FATAL: ${error.message}`);
            results.failed++;
        }
    }
    
    console.log('\n======================================================================');
    console.log('📊 RESUMO DOS MICRO TESTES');
    console.log('======================================================================');
    console.log(`Total: ${results.total}`);
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

module.exports = { main, test1_sendNextRideToDriverFindsSecondRide, test2_notifyDriverSendsNotification, test3_secondRideInActiveQueue, test4_driverCanReceiveSecondRide, test5_eventCapturedByMockIO, test6_completeFlow };

