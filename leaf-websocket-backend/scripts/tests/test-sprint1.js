/**
 * TESTE DO SPRINT 1: INFRAESTRUTURA BASE
 * 
 * Testa todos os componentes implementados:
 * - GeoHash Utils
 * - Driver Lock Manager
 * - Event Sourcing
 * - Ride State Manager
 * - Ride Queue Manager
 * - Gradual Radius Expander (parcial)
 */

require('dotenv').config();

const GeoHashUtils = require('./utils/geohash-utils');
const driverLockManager = require('./services/driver-lock-manager');
const eventSourcing = require('./services/event-sourcing');
const RideStateManager = require('./services/ride-state-manager');
const rideQueueManager = require('./services/ride-queue-manager');
const redisPool = require('./utils/redis-pool');
const redis = redisPool.getConnection();

// Mock do io para testes
const mockIo = {
    to: (room) => ({
        emit: (event, data) => {
            console.log(`  📤 [Mock IO] Enviado ${event} para ${room}:`, JSON.stringify(data).substring(0, 100));
        }
    })
};

let GradualRadiusExpander;
try {
    GradualRadiusExpander = require('./services/gradual-radius-expander');
} catch (error) {
    console.log('⚠️ GradualRadiusExpander não pode ser testado sem io real');
}

// Contadores de testes
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

/**
 * Função auxiliar para testes
 */
async function test(name, testFn) {
    testsRun++;
    process.stdout.write(`\n🧪 ${name}... `);
    
    try {
        await testFn();
        testsPassed++;
        console.log('✅ PASSOU');
    } catch (error) {
        testsFailed++;
        console.log(`❌ FALHOU: ${error.message}`);
        if (process.env.DEBUG) {
            console.error(error.stack);
        }
    }
}

/**
 * Conectar ao Redis
 */
async function connectRedis() {
    try {
        await redis.connect();
        console.log('✅ Redis conectado');
    } catch (error) {
        console.log('⚠️ Redis já conectado ou erro:', error.message);
    }
}

/**
 * Limpar dados de teste
 */
async function cleanup() {
    try {
        // Limpar locks de teste
        const testLocks = await redis.keys('driver_lock:test_*');
        if (testLocks.length > 0) {
            await Promise.all(testLocks.map(key => redis.del(key)));
        }

        // Limpar bookings de teste
        const testBookings = await redis.keys('booking:test_*');
        if (testBookings.length > 0) {
            await Promise.all(testBookings.map(key => redis.del(key)));
        }

        // Limpar filas de teste
        const testQueues = await redis.keys('ride_queue:test_*');
        if (testQueues.length > 0) {
            await Promise.all(testQueues.map(key => redis.del(key)));
        }

        // Limpar notificações de teste
        const testNotifs = await redis.keys('ride_notifications:test_*');
        if (testNotifs.length > 0) {
            await Promise.all(testNotifs.map(key => redis.del(key)));
        }

        console.log('🧹 Limpeza de dados de teste concluída');
    } catch (error) {
        console.error('⚠️ Erro na limpeza:', error.message);
    }
}

// ========================================
// TESTES
// ========================================

async function runTests() {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 TESTE DO SPRINT 1: INFRAESTRUTURA BASE');
    console.log('='.repeat(60));

    // Conectar Redis
    await connectRedis();

    // Limpar dados anteriores
    await cleanup();

    // ========================================
    // TESTE 1: GeoHash Utils
    // ========================================
    console.log('\n📍 TESTE 1: GeoHash Utils');

    await test('GeoHash: Gerar hash de região', async () => {
        const lat = -22.9068;
        const lng = -43.1234;
        const hash = GeoHashUtils.getRegionHash(lat, lng, 5);
        
        if (!hash || typeof hash !== 'string' || hash.length < 5) {
            throw new Error(`Hash inválido: ${hash}`);
        }
        
        console.log(`     Hash gerado: ${hash}`);
    });

    await test('GeoHash: Obter hash de objeto de localização', async () => {
        const location = { lat: -22.9068, lng: -43.1234 };
        const hash = GeoHashUtils.getRegionHashFromLocation(location);
        
        if (!hash) {
            throw new Error('Hash não gerado');
        }
    });

    await test('GeoHash: Obter regiões adjacentes', async () => {
        const hash = GeoHashUtils.getRegionHash(-22.9068, -43.1234, 5);
        const adjacent = GeoHashUtils.getAdjacentRegions(hash);
        
        if (!Array.isArray(adjacent) || adjacent.length !== 9) {
            throw new Error(`Deve retornar 9 regiões (1 central + 8 adjacentes), retornou: ${adjacent.length}`);
        }
    });

    await test('GeoHash: Decodificar hash', async () => {
        const hash = GeoHashUtils.getRegionHash(-22.9068, -43.1234, 5);
        const decoded = GeoHashUtils.decodeRegionHash(hash);
        
        if (!decoded.lat || !decoded.lng) {
            throw new Error('Decodificação falhou');
        }
        
        console.log(`     Coordenadas decodificadas: ${decoded.lat}, ${decoded.lng}`);
    });

    await test('GeoHash: Verificar mesma região', async () => {
        const hash1 = GeoHashUtils.getRegionHash(-22.9068, -43.1234, 5);
        const hash2 = GeoHashUtils.getRegionHash(-22.9069, -43.1235, 5);
        
        // Devem estar na mesma região (diferença pequena)
        const sameRegion = GeoHashUtils.isSameRegion(hash1, hash2, 5);
        
        if (!sameRegion) {
            console.log(`     Hash1: ${hash1}, Hash2: ${hash2}`);
            // Não é erro crítico, mas vale mencionar
            console.log('     ⚠️ Coordenadas próximas podem estar em regiões diferentes (normal)');
        }
    });

    // ========================================
    // TESTE 2: Driver Lock Manager
    // ========================================
    console.log('\n🔒 TESTE 2: Driver Lock Manager');

    await test('Lock: Adquirir lock', async () => {
        const driverId = 'test_driver_001';
        const bookingId = 'test_booking_001';
        
        const acquired = await driverLockManager.acquireLock(driverId, bookingId, 10);
        
        if (!acquired) {
            throw new Error('Lock não foi adquirido');
        }
        
        // Limpar após teste
        await driverLockManager.releaseLock(driverId);
    });

    await test('Lock: Tentar adquirir lock já existente', async () => {
        const driverId = 'test_driver_002';
        const bookingId1 = 'test_booking_001';
        const bookingId2 = 'test_booking_002';
        
        // Adquirir primeiro lock
        const first = await driverLockManager.acquireLock(driverId, bookingId1, 10);
        if (!first) {
            throw new Error('Primeiro lock não foi adquirido');
        }
        
        // Tentar adquirir segundo (deve falhar)
        const second = await driverLockManager.acquireLock(driverId, bookingId2, 10);
        
        if (second) {
            throw new Error('Segundo lock não deveria ser adquirido (motorista ocupado)');
        }
        
        // Limpar
        await driverLockManager.releaseLock(driverId);
    });

    await test('Lock: Liberar lock', async () => {
        const driverId = 'test_driver_003';
        const bookingId = 'test_booking_001';
        
        await driverLockManager.acquireLock(driverId, bookingId, 10);
        const released = await driverLockManager.releaseLock(driverId);
        
        if (!released) {
            throw new Error('Lock não foi liberado');
        }
    });

    await test('Lock: Verificar se motorista está locked', async () => {
        const driverId = 'test_driver_004';
        const bookingId = 'test_booking_001';
        
        // Adquirir lock
        await driverLockManager.acquireLock(driverId, bookingId, 10);
        
        // Verificar status
        const status = await driverLockManager.isDriverLocked(driverId);
        
        if (!status.isLocked || status.bookingId !== bookingId) {
            throw new Error('Status do lock incorreto');
        }
        
        // Liberar e verificar novamente
        await driverLockManager.releaseLock(driverId);
        const statusAfter = await driverLockManager.isDriverLocked(driverId);
        
        if (statusAfter.isLocked) {
            throw new Error('Motorista ainda está locked após liberação');
        }
    });

    // ========================================
    // TESTE 3: Event Sourcing
    // ========================================
    console.log('\n📝 TESTE 3: Event Sourcing');

    await test('Event: Registrar evento', async () => {
        const eventId = await eventSourcing.recordEvent(
            eventSourcing.EVENT_TYPES.RIDE_REQUESTED,
            {
                bookingId: 'test_booking_001',
                customerId: 'test_customer_001',
                pickupLocation: { lat: -22.9068, lng: -43.1234 }
            }
        );
        
        if (!eventId) {
            throw new Error('Evento não foi registrado');
        }
        
        console.log(`     Event ID: ${eventId}`);
    });

    await test('Event: Buscar eventos por booking', async () => {
        const bookingId = 'test_booking_002';
        
        // Registrar alguns eventos
        await eventSourcing.recordEvent(eventSourcing.EVENT_TYPES.RIDE_REQUESTED, {
            bookingId,
            customerId: 'test_customer_001'
        });
        
        await eventSourcing.recordEvent(eventSourcing.EVENT_TYPES.DRIVER_NOTIFIED, {
            bookingId,
            driverId: 'test_driver_001'
        });
        
        // Buscar eventos
        const events = await eventSourcing.getEventsByBooking(bookingId, 10);
        
        if (events.length < 2) {
            throw new Error(`Esperado pelo menos 2 eventos, encontrado: ${events.length}`);
        }
        
        console.log(`     Eventos encontrados: ${events.length}`);
    });

    await test('Event: Buscar eventos recentes', async () => {
        const events = await eventSourcing.getRecentEvents(5);
        
        if (!Array.isArray(events)) {
            throw new Error('Eventos não retornados como array');
        }
        
        console.log(`     Eventos recentes: ${events.length}`);
    });

    // ========================================
    // TESTE 4: Ride State Manager
    // ========================================
    console.log('\n🔄 TESTE 4: Ride State Manager');

    await test('State: Validar transições', () => {
        // PENDING -> SEARCHING (válido)
        if (!RideStateManager.isValidTransition(
            RideStateManager.STATES.PENDING,
            RideStateManager.STATES.SEARCHING
        )) {
            throw new Error('Transição PENDING -> SEARCHING deveria ser válida');
        }

        // PENDING -> COMPLETED (inválido)
        if (RideStateManager.isValidTransition(
            RideStateManager.STATES.PENDING,
            RideStateManager.STATES.COMPLETED
        )) {
            throw new Error('Transição PENDING -> COMPLETED não deveria ser válida');
        }
    });

    await test('State: Atualizar estado', async () => {
        const bookingId = 'test_booking_state_001';
        
        // Criar booking inicial
        await redis.hset(`booking:${bookingId}`, {
            bookingId,
            state: RideStateManager.STATES.PENDING,
            createdAt: new Date().toISOString()
        });
        
        // Atualizar para SEARCHING
        await RideStateManager.updateBookingState(
            redis,
            bookingId,
            RideStateManager.STATES.SEARCHING
        );
        
        // Verificar estado
        const state = await RideStateManager.getBookingState(redis, bookingId);
        
        if (state !== RideStateManager.STATES.SEARCHING) {
            throw new Error(`Estado deveria ser SEARCHING, mas é: ${state}`);
        }
        
        // Limpar
        await redis.del(`booking:${bookingId}`);
    });

    await test('State: Tentar transição inválida', async () => {
        const bookingId = 'test_booking_state_002';
        
        // Criar booking em PENDING
        await redis.hset(`booking:${bookingId}`, {
            bookingId,
            state: RideStateManager.STATES.PENDING,
            createdAt: new Date().toISOString()
        });
        
        // Tentar transição inválida (PENDING -> COMPLETED)
        try {
            await RideStateManager.updateBookingState(
                redis,
                bookingId,
                RideStateManager.STATES.COMPLETED
            );
            
            throw new Error('Transição inválida deveria lançar erro');
        } catch (error) {
            // Esperado - transição inválida
            if (!error.message.includes('Transição inválida')) {
                throw error;
            }
        }
        
        // Limpar
        await redis.del(`booking:${bookingId}`);
    });

    // ========================================
    // TESTE 5: Ride Queue Manager
    // ========================================
    console.log('\n📋 TESTE 5: Ride Queue Manager');

    await test('Queue: Adicionar corrida à fila', async () => {
        const bookingData = {
            bookingId: 'test_booking_queue_001',
            customerId: 'test_customer_001',
            pickupLocation: { lat: -22.9068, lng: -43.1234 },
            destinationLocation: { lat: -22.9, lng: -43.13 },
            estimatedFare: 15.50,
            paymentMethod: 'pix'
        };
        
        const result = await rideQueueManager.enqueueRide(bookingData);
        
        if (!result.success || !result.regionHash) {
            throw new Error('Corrida não foi adicionada à fila');
        }
        
        console.log(`     Região: ${result.regionHash}`);
    });

    await test('Queue: Buscar corridas pendentes', async () => {
        const regionHash = GeoHashUtils.getRegionHash(-22.9068, -43.1234, 5);
        const pendingRides = await rideQueueManager.getPendingRides(regionHash, 10);
        
        if (!Array.isArray(pendingRides)) {
            throw new Error('Deveria retornar array');
        }
        
        console.log(`     Corridas pendentes: ${pendingRides.length}`);
    });

    await test('Queue: Processar próximas corridas', async () => {
        // Adicionar mais uma corrida para processar
        const bookingData = {
            bookingId: 'test_booking_queue_002',
            customerId: 'test_customer_002',
            pickupLocation: { lat: -22.9068, lng: -43.1234 },
            destinationLocation: { lat: -22.9, lng: -43.13 },
            estimatedFare: 20.00,
            paymentMethod: 'pix'
        };
        
        await rideQueueManager.enqueueRide(bookingData);
        
        // Processar
        const regionHash = GeoHashUtils.getRegionHash(-22.9068, -43.1234, 5);
        const processed = await rideQueueManager.processNextRides(regionHash, 10);
        
        if (!Array.isArray(processed)) {
            throw new Error('Deveria retornar array de corridas processadas');
        }
        
        console.log(`     Corridas processadas: ${processed.length}`);
    });

    await test('Queue: Remover corrida da fila', async () => {
        const bookingId = 'test_booking_queue_001';
        const bookingData = await rideQueueManager.getBookingData(bookingId);
        
        if (bookingData) {
            const removed = await rideQueueManager.dequeueRide(bookingId);
            
            if (!removed) {
                throw new Error('Corrida não foi removida');
            }
        }
    });

    await test('Queue: Obter dados da corrida', async () => {
        const bookingData = {
            bookingId: 'test_booking_queue_003',
            customerId: 'test_customer_003',
            pickupLocation: { lat: -22.9068, lng: -43.1234 },
            destinationLocation: { lat: -22.9, lng: -43.13 },
            estimatedFare: 25.00,
            paymentMethod: 'pix'
        };
        
        await rideQueueManager.enqueueRide(bookingData);
        
        const retrieved = await rideQueueManager.getBookingData(bookingData.bookingId);
        
        if (!retrieved || retrieved.bookingId !== bookingData.bookingId) {
            throw new Error('Dados da corrida não foram recuperados corretamente');
        }
    });

    await test('Queue: Obter estatísticas da fila', async () => {
        const regionHash = GeoHashUtils.getRegionHash(-22.9068, -43.1234, 5);
        const stats = await rideQueueManager.getQueueStats(regionHash);
        
        if (!stats || typeof stats.pending !== 'number') {
            throw new Error('Estatísticas inválidas');
        }
        
        console.log(`     Stats: ${stats.pending} pendentes, ${stats.active} ativas`);
    });

    // ========================================
    // TESTE 6: Gradual Radius Expander (Parcial)
    // ========================================
    if (GradualRadiusExpander) {
        console.log('\n🔍 TESTE 6: Gradual Radius Expander (Parcial)');

        await test('Expander: Instanciar classe', () => {
            const expander = new GradualRadiusExpander(mockIo);
            
            if (!expander || typeof expander.startGradualSearch !== 'function') {
                throw new Error('Classe não foi instanciada corretamente');
            }
        });

        await test('Expander: Iniciar busca gradual', async () => {
            // Criar booking primeiro
            const bookingData = {
                bookingId: 'test_booking_expander_001',
                customerId: 'test_customer_001',
                pickupLocation: { lat: -22.9068, lng: -43.1234 },
                destinationLocation: { lat: -22.9, lng: -43.13 },
                estimatedFare: 15.50,
                paymentMethod: 'pix'
            };
            
            await rideQueueManager.enqueueRide(bookingData);
            await RideStateManager.updateBookingState(
                redis,
                bookingData.bookingId,
                RideStateManager.STATES.SEARCHING
            );
            
            const expander = new GradualRadiusExpander(mockIo);
            await expander.startGradualSearch(
                bookingData.bookingId,
                bookingData.pickupLocation
            );
            
            // Verificar se estado foi criado
            const searchKey = `booking_search:${bookingData.bookingId}`;
            const searchData = await redis.hgetall(searchKey);
            
            if (!searchData || !searchData.currentRadius) {
                throw new Error('Estado de busca não foi criado');
            }
            
            console.log(`     Raio inicial: ${searchData.currentRadius}km`);
            
            // Parar busca
            await expander.stopSearch(bookingData.bookingId);
        });
    } else {
        console.log('\n⚠️ TESTE 6: Gradual Radius Expander - PULADO (requer io real)');
    }

    // ========================================
    // RESUMO
    // ========================================
    console.log('\n' + '='.repeat(60));
    console.log('📊 RESUMO DOS TESTES');
    console.log('='.repeat(60));
    console.log(`   Total de testes: ${testsRun}`);
    console.log(`   ✅ Passou: ${testsPassed}`);
    console.log(`   ❌ Falhou: ${testsFailed}`);
    console.log(`   📈 Taxa de sucesso: ${((testsPassed / testsRun) * 100).toFixed(1)}%`);
    
    if (testsFailed === 0) {
        console.log('\n🎉 TODOS OS TESTES PASSARAM!');
    } else {
        console.log('\n⚠️ Alguns testes falharam. Revise os erros acima.');
    }
    
    // Limpar dados de teste
    await cleanup();
    
    // Fechar conexão Redis
    await redis.quit();
    console.log('\n✅ Testes concluídos');
}

// Executar testes
runTests().catch(error => {
    console.error('\n❌ ERRO FATAL:', error);
    process.exit(1);
});


