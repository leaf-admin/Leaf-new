/**
 * TESTE FASE 4: DRIVER MATCHING E NOTIFICAÇÃO
 * 
 * Valida:
 * 1. DriverNotificationDispatcher - busca e scoring
 * 2. Algoritmo de score (distância, rating, acceptance rate, response time)
 * 3. Prevenção de notificações duplicadas
 * 4. Timeouts de resposta
 * 5. Integração com GradualRadiusExpander
 */

require('dotenv').config();
const { performance } = require('perf_hooks');

const redisPool = require('./utils/redis-pool');
const redis = redisPool.getConnection();
const DriverNotificationDispatcher = require('./services/driver-notification-dispatcher');
const GradualRadiusExpander = require('./services/gradual-radius-expander');
const RideStateManager = require('./services/ride-state-manager');
const driverLockManager = require('./services/driver-lock-manager');
const eventSourcing = require('./services/event-sourcing');
const { EVENT_TYPES } = require('./services/event-sourcing');

// Mock do io para testes
class MockIO {
    constructor() {
        this.emittedEvents = new Map(); // driverId -> events[]
        this.rooms = new Map(); // room -> Set<driverId>
    }

    to(room) {
        this.currentRoom = room;
        return this;
    }

    emit(event, data) {
        if (!this.currentRoom) return;

        const driverId = this.currentRoom.replace('driver_', '');
        if (!this.emittedEvents.has(driverId)) {
            this.emittedEvents.set(driverId, []);
        }
        this.emittedEvents.get(driverId).push({ event, data, timestamp: Date.now() });
        console.log(`📱 [MockIO] Evento ${event} emitido para ${this.currentRoom}`);
    }

    hasEmittedEvent(driverId, eventName) {
        const events = this.emittedEvents.get(driverId) || [];
        return events.some(e => e.event === eventName);
    }

    getEmittedEvents(driverId) {
        return this.emittedEvents.get(driverId) || [];
    }
}

// Estatísticas de teste
const stats = {
    tests: 0,
    passed: 0,
    failed: 0,
    errors: []
};

function test(name, fn) {
    stats.tests++;
    try {
        const result = fn();
        if (result instanceof Promise) {
            return result
                .then(() => {
                    stats.passed++;
                    console.log(`✅ ${name}`);
                })
                .catch((error) => {
                    stats.failed++;
                    stats.errors.push({ test: name, error: error.message });
                    console.log(`❌ ${name}: ${error.message}`);
                });
        } else {
            stats.passed++;
            console.log(`✅ ${name}`);
        }
    } catch (error) {
        stats.failed++;
        stats.errors.push({ test: name, error: error.message });
        console.log(`❌ ${name}: ${error.message}`);
    }
}

async function cleanupLocks(driverIds) {
    // Limpar todos os locks de motoristas de teste
    for (const driverId of driverIds) {
        try {
            await driverLockManager.releaseLock(driverId);
            // Limpar também da Redis diretamente
            await redis.del(`driver_lock:${driverId}`);
        } catch (e) {
            // Ignorar erros
        }
    }
}

async function setupTestDrivers() {
    console.log('\n📍 Configurando motoristas de teste...');
    
    // Limpar dados anteriores
    await redis.del('driver_locations');
    
    // Criar motoristas de teste em diferentes localizações
    const testDrivers = [
        {
            id: 'driver_001',
            lat: -22.9068,
            lng: -43.1234,
            rating: 4.8,
            acceptanceRate: 85.0,
            avgResponseTime: 3.2,
            totalTrips: 100
        },
        {
            id: 'driver_002',
            lat: -22.9070,
            lng: -43.1236,
            rating: 4.5,
            acceptanceRate: 70.0,
            avgResponseTime: 5.5,
            totalTrips: 50
        },
        {
            id: 'driver_003',
            lat: -22.9075,
            lng: -43.1240,
            rating: 5.0,
            acceptanceRate: 90.0,
            avgResponseTime: 2.8,
            totalTrips: 200
        },
        {
            id: 'driver_004',
            lat: -22.9080,
            lng: -43.1245,
            rating: 4.2,
            acceptanceRate: 60.0,
            avgResponseTime: 8.0,
            totalTrips: 30
        },
        {
            id: 'driver_005',
            lat: -22.9050,
            lng: -43.1220,
            rating: 4.9,
            acceptanceRate: 95.0,
            avgResponseTime: 2.5,
            totalTrips: 150
        }
    ];

    // Adicionar ao Redis GEO
    for (const driver of testDrivers) {
        await redis.geoadd('driver_locations', driver.lng, driver.lat, driver.id);
        
        // Cachear dados do motorista
        await redis.hset(`driver:${driver.id}`, {
            id: driver.id,
            isOnline: 'true',
            status: 'AVAILABLE',
            rating: driver.rating.toString(),
            acceptanceRate: driver.acceptanceRate.toString(),
            avgResponseTime: driver.avgResponseTime.toString(),
            totalTrips: driver.totalTrips.toString()
        });
        // TTL de 5 minutos (300s) para dados de motorista
        await redis.expire(`driver:${driver.id}`, 300);
    }

    console.log(`✅ ${testDrivers.length} motoristas de teste configurados`);
    return testDrivers;
}

async function runTests() {
    console.log('\n' + '='.repeat(60));
    console.log('🧪 TESTE FASE 4: DRIVER MATCHING E NOTIFICAÇÃO');
    console.log('='.repeat(60));

    await redis.connect();

    // Limpar dados de teste
    const testKeys = await redis.keys('test_*');
    const bookingKeys = await redis.keys('booking:test_*');
    const notificationKeys = await redis.keys('ride_notifications:test_*');
    if (testKeys.length > 0) await redis.del(...testKeys);
    if (bookingKeys.length > 0) await redis.del(...bookingKeys);
    if (notificationKeys.length > 0) await redis.del(...notificationKeys);

    // Configurar motoristas de teste
    const testDrivers = await setupTestDrivers();
    
    // Criar mock IO
    const mockIO = new MockIO();

    // Criar instâncias dos serviços
    const dispatcher = new DriverNotificationDispatcher(mockIO);
    const expander = new GradualRadiusExpander(mockIO);

    const pickupLocation = { lat: -22.9068, lng: -43.1234 };
    const bookingId = 'test_booking_001';

    // Função helper para limpar antes de cada teste
    const driverIds = testDrivers.map(d => d.id);

    // ========================================
    // TESTE 1: Buscar e Calcular Scores
    // ========================================
    await test('TC-001: Buscar motoristas e calcular scores', async () => {
        await cleanupLocks(driverIds);
        const drivers = await dispatcher.findAndScoreDrivers(
            pickupLocation,
            1.0, // 1km
            10,  // até 10 motoristas
            bookingId
        );

        if (drivers.length === 0) {
            throw new Error('Nenhum motorista encontrado');
        }

        // Verificar se drivers têm score
        const hasScores = drivers.every(d => typeof d.score === 'number' && d.score >= 0 && d.score <= 100);
        if (!hasScores) {
            throw new Error('Drivers não têm scores válidos (0-100)');
        }

        // Verificar se estão ordenados por score (maior primeiro)
        const isSorted = drivers.every((d, i) => 
            i === 0 || drivers[i - 1].score >= d.score
        );
        if (!isSorted) {
            throw new Error('Drivers não estão ordenados por score');
        }

        console.log(`   📊 ${drivers.length} motoristas encontrados`);
        drivers.forEach(d => {
            console.log(`      - ${d.driverId}: score ${d.score.toFixed(2)}, distância ${d.distance.toFixed(2)}km, rating ${d.rating}`);
        });
    });

    // ========================================
    // TESTE 2: Algoritmo de Score
    // ========================================
    await test('TC-002: Algoritmo de score (distância + rating + acceptance + response)', async () => {
        await cleanupLocks(driverIds);
        // Driver mais próximo (driver_001) deve ter score alto
        const drivers = await dispatcher.findAndScoreDrivers(
            pickupLocation,
            0.5, // 0.5km
            5,
            bookingId
        );

        if (drivers.length === 0) {
            throw new Error('Nenhum motorista encontrado');
        }

        const driver001 = drivers.find(d => d.driverId === 'driver_001');
        if (!driver001) {
            throw new Error('driver_001 não encontrado');
        }

        // Verificar se score é calculado corretamente
        // driver_001: distância ~0km, rating 4.8, acceptance 85%, response 3.2s
        // Score esperado: ~(1.0 × 40%) + (0.96 × 20%) + (0.85 × 20%) + (0.893 × 20%) × 100
        // = (0.40) + (0.192) + (0.17) + (0.179) × 100 ≈ 94.1
        
        if (driver001.score < 80 || driver001.score > 100) {
            throw new Error(`Score do driver_001 fora do esperado: ${driver001.score} (esperado: 80-100)`);
        }

        console.log(`   📊 Score calculado para driver_001: ${driver001.score.toFixed(2)}`);
    });

    // ========================================
    // TESTE 3: Prevenção de Notificações Duplicadas
    // ========================================
    await test('TC-003: Prevenção de notificações duplicadas', async () => {
        await cleanupLocks(driverIds);
        // Criar booking
        await redis.hset(`booking:${bookingId}`, {
            bookingId,
            customerId: 'test_customer_001',
            pickupLocation: JSON.stringify(pickupLocation),
            destinationLocation: JSON.stringify({ lat: -22.9, lng: -43.13 }),
            estimatedFare: '15.50',
            paymentMethod: 'pix'
        });

        // Notificar motorista
        const bookingData = {
            bookingId,
            customerId: 'test_customer_001',
            pickupLocation,
            destinationLocation: { lat: -22.9, lng: -43.13 },
            estimatedFare: 15.50,
            paymentMethod: 'pix'
        };

        const notified1 = await dispatcher.notifyDriver('driver_001', bookingId, bookingData);
        if (!notified1) {
            throw new Error('Primeira notificação falhou');
        }

        // Tentar notificar novamente
        const notified2 = await dispatcher.notifyDriver('driver_001', bookingId, bookingData);
        if (notified2) {
            throw new Error('Segunda notificação não deveria ter sucesso (duplicata)');
        }

        // Verificar se está no set de notificados
        const isNotified = await redis.sismember(`ride_notifications:${bookingId}`, 'driver_001');
        if (!isNotified) {
            throw new Error('Driver não está no set de notificados');
        }

        console.log(`   ✅ Duplicata prevenida corretamente`);
    });

    // ========================================
    // TESTE 4: Timeout de Resposta
    // ========================================
    await test('TC-004: Timeout de resposta (15 segundos)', async () => {
        await cleanupLocks(driverIds);
        const testBookingId = 'test_timeout_001';
        
        await redis.hset(`booking:${testBookingId}`, {
            bookingId: testBookingId,
            customerId: 'test_customer_001',
            pickupLocation: JSON.stringify(pickupLocation),
            destinationLocation: JSON.stringify({ lat: -22.9, lng: -43.13 }),
            estimatedFare: '15.50',
            paymentMethod: 'pix'
        });

        const bookingData = {
            bookingId: testBookingId,
            customerId: 'test_customer_001',
            pickupLocation,
            destinationLocation: { lat: -22.9, lng: -43.13 },
            estimatedFare: 15.50,
            paymentMethod: 'pix'
        };

        // Notificar motorista
        const notified = await dispatcher.notifyDriver('driver_002', testBookingId, bookingData);
        if (!notified) {
            throw new Error('Notificação falhou');
        }

        // Verificar se lock foi adquirido
        const lockStatus = await driverLockManager.isDriverLocked('driver_002');
        if (!lockStatus.isLocked || lockStatus.bookingId !== testBookingId) {
            throw new Error('Lock não foi adquirido corretamente');
        }

        // Aguardar timeout (15 segundos)
        console.log(`   ⏰ Aguardando timeout de 15 segundos...`);
        await new Promise(resolve => setTimeout(resolve, 16000)); // 16s para garantir

        // Verificar se lock foi liberado automaticamente
        const lockStatusAfter = await driverLockManager.isDriverLocked('driver_002');
        if (lockStatusAfter.isLocked) {
            throw new Error('Lock não foi liberado após timeout');
        }

        console.log(`   ✅ Timeout funcionou corretamente (lock liberado após 15s)`);
        
        // Limpar
        dispatcher.clearAllTimeouts(testBookingId);
        await driverLockManager.releaseLock('driver_002');
    });

    // ========================================
    // TESTE 5: Integração com GradualRadiusExpander
    // ========================================
    await test('TC-005: Integração GradualRadiusExpander com scoring', async () => {
        await cleanupLocks(driverIds);
        const testBookingId = 'test_expander_001';
        
        await redis.hset(`booking:${testBookingId}`, {
            bookingId: testBookingId,
            customerId: 'test_customer_001',
            pickupLocation: JSON.stringify(pickupLocation),
            destinationLocation: JSON.stringify({ lat: -22.9, lng: -43.13 }),
            estimatedFare: '15.50',
            paymentMethod: 'pix'
        });

        // Definir estado como SEARCHING
        await RideStateManager.updateBookingState(
            redis,
            testBookingId,
            RideStateManager.STATES.SEARCHING
        );

        // Limpar notificações anteriores
        await redis.del(`ride_notifications:${testBookingId}`);

        // Iniciar busca gradual
        await expander.startGradualSearch(testBookingId, pickupLocation);

        // Aguardar um pouco para permitir primeira busca
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Verificar se motoristas foram notificados
        const notifiedDrivers = await redis.smembers(`ride_notifications:${testBookingId}`);
        if (notifiedDrivers.length === 0) {
            throw new Error('Nenhum motorista foi notificado');
        }

        // Verificar se eventos foram emitidos
        let hasNewRideRequest = false;
        for (const driverId of notifiedDrivers) {
            if (mockIO.hasEmittedEvent(driverId, 'newRideRequest')) {
                hasNewRideRequest = true;
                break;
            }
        }

        if (!hasNewRideRequest) {
            throw new Error('Evento newRideRequest não foi emitido');
        }

        console.log(`   ✅ ${notifiedDrivers.length} motoristas notificados via expansão gradual`);

        // Parar busca
        await expander.stopSearch(testBookingId);
    });

    // ========================================
    // TESTE 6: Múltiplas Notificações
    // ========================================
    await test('TC-006: Notificar múltiplos motoristas com scores', async () => {
        const testBookingId = 'test_multiple_001';
        
        await cleanupLocks(driverIds);
        
        await redis.hset(`booking:${testBookingId}`, {
            bookingId: testBookingId,
            customerId: 'test_customer_001',
            pickupLocation: JSON.stringify(pickupLocation),
            destinationLocation: JSON.stringify({ lat: -22.9, lng: -43.13 }),
            estimatedFare: '15.50',
            paymentMethod: 'pix'
        });

        // Limpar notificações anteriores
        await redis.del(`ride_notifications:${testBookingId}`);

        // Buscar motoristas com scores
        const drivers = await dispatcher.findAndScoreDrivers(
            pickupLocation,
            1.0,
            5,
            testBookingId
        );

        if (drivers.length === 0) {
            throw new Error('Nenhum motorista encontrado');
        }

        const bookingData = {
            bookingId: testBookingId,
            customerId: 'test_customer_001',
            pickupLocation,
            destinationLocation: { lat: -22.9, lng: -43.13 },
            estimatedFare: 15.50,
            paymentMethod: 'pix'
        };

        // Notificar múltiplos
        const result = await dispatcher.notifyMultipleDrivers(
            drivers,
            testBookingId,
            bookingData
        );

        if (result.notified === 0) {
            throw new Error('Nenhum motorista foi notificado');
        }

        // Verificar se todos os notificados receberam evento
        const notifiedSet = new Set(await redis.smembers(`ride_notifications:${testBookingId}`));
        for (const driverId of notifiedSet) {
            if (!mockIO.hasEmittedEvent(driverId, 'newRideRequest')) {
                throw new Error(`Driver ${driverId} não recebeu evento newRideRequest`);
            }
        }

        console.log(`   ✅ ${result.notified}/${drivers.length} motoristas notificados`);
        console.log(`   ✅ ${result.failed} falhas`);
    });

    // ========================================
    // LIMPEZA
    // ========================================
    console.log('\n🧹 Limpando dados de teste...');
    const allTestKeys = await redis.keys('test_*');
    const allBookingKeys = await redis.keys('booking:test_*');
    const allNotificationKeys = await redis.keys('ride_notifications:test_*');
    if (allTestKeys.length > 0) await redis.del(...allTestKeys);
    if (allBookingKeys.length > 0) await redis.del(...allBookingKeys);
    if (allNotificationKeys.length > 0) await redis.del(...allNotificationKeys);

    // ========================================
    // RESUMO
    // ========================================
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO DOS TESTES');
    console.log('='.repeat(60));
    console.log(`Total: ${stats.tests}`);
    console.log(`✅ Passou: ${stats.passed}`);
    console.log(`❌ Falhou: ${stats.failed}`);
    
    if (stats.errors.length > 0) {
        console.log('\n❌ ERROS:');
        stats.errors.forEach(({ test, error }) => {
            console.log(`   - ${test}: ${error}`);
        });
    }

    console.log('\n' + '='.repeat(60));
    
    await redis.quit();
    
    process.exit(stats.failed > 0 ? 1 : 0);
}

// Executar testes
runTests().catch(error => {
    console.error('\n❌ ERRO FATAL:', error);
    process.exit(1);
});

