/**
 * DIAGNÓSTICO DETALHADO: TC-011 e TC-016
 * 
 * Investiga por que a primeira corrida não está sendo notificada
 */

const redisPool = require('./utils/redis-pool');
const rideQueueManager = require('./services/ride-queue-manager');
const GradualRadiusExpander = require('./services/gradual-radius-expander');
const RideStateManager = require('./services/ride-state-manager');
const driverLockManager = require('./services/driver-lock-manager');
const GeoHashUtils = require('./utils/geohash-utils');

// Mock Socket.IO melhorado
class MockSocketIO {
    constructor() {
        this.notifications = new Map();
        this.events = [];
        this.connectedDrivers = new Set();
    }

    _captureNotification(room, event, data) {
        this.events.push({ event, room, data, timestamp: Date.now() });
        
        if (event === 'newRideRequest') {
            const driverId = room.replace('driver_', '');
            const bookingId = data?.bookingId || data?.booking?.bookingId || data?.rideId;
            
            if (driverId && bookingId) {
                if (!this.notifications.has(driverId)) {
                    this.notifications.set(driverId, []);
                }
                const exists = this.notifications.get(driverId).some(n => n.bookingId === bookingId);
                if (!exists) {
                    this.notifications.get(driverId).push({
                        bookingId,
                        timestamp: Date.now(),
                        data
                    });
                    console.log(`   📢 [MockIO] Notificação capturada: driver=${driverId}, booking=${bookingId}`);
                }
            }
        }
    }

    to(room) {
        return {
            emit: (event, data) => {
                this._captureNotification(room, event, data);
            }
        };
    }

    in(room) {
        return {
            fetchSockets: async () => {
                const driverId = room.replace('driver_', '');
                if (this.connectedDrivers.has(driverId)) {
                    return [{ id: 'mock_socket', userId: driverId }];
                }
                return [];
            }
        };
    }

    sockets = {
        sockets: new Map()
    };

    getNotificationsForDriver(driverId) {
        return this.notifications.get(driverId) || [];
    }

    clear() {
        this.notifications.clear();
        this.events = [];
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function setupTestDriver(redis, driverId, lat, lng) {
    await redis.geoadd('driver_locations', lng, lat, driverId);
    await redis.hset(`driver:${driverId}`, {
        isOnline: 'true',
        status: 'AVAILABLE',
        lat: String(lat),
        lng: String(lng)
    });
    await redis.expire(`driver:${driverId}`, 300);
    console.log(`✅ Motorista ${driverId} configurado`);
}

async function testTC011Diagnostic() {
    console.log('\n🔍 DIAGNÓSTICO TC-011: Timing Entre Rejeição e Nova Corrida\n');
    console.log('='.repeat(60));
    
    const redis = redisPool.getConnection();
    const mockIO = new MockSocketIO();
    const driverId = 'test_driver_tc011';
    const pickupLocation = { lat: -22.9068, lng: -43.1234 };
    
    try {
        // 1. Setup motorista
        console.log('\n📋 1. Configurando motorista...');
        await setupTestDriver(redis, driverId, pickupLocation.lat, pickupLocation.lng);
        mockIO.connectedDrivers.add(driverId);
        await sleep(500);
        
        // 2. Criar primeira corrida
        console.log('\n📋 2. Criando primeira corrida...');
        const firstBookingId = `test_tc011_${Date.now()}_0`;
        await rideQueueManager.enqueueRide({
            bookingId: firstBookingId,
            customerId: 'test_customer',
            pickupLocation,
            destinationLocation: { lat: -22.9068, lng: -43.1234 },
            estimatedFare: 15.5,
            paymentMethod: 'pix'
        });
        console.log(`   ✅ Corrida ${firstBookingId} criada`);
        await sleep(500);
        
        // 3. Processar primeira corrida
        console.log('\n📋 3. Processando primeira corrida...');
        const regionHash = GeoHashUtils.getRegionHashFromLocation(pickupLocation, 5);
        const processed = await rideQueueManager.processNextRides(regionHash, 1);
        console.log(`   ✅ Corridas processadas: ${processed.length}`);
        console.log(`   ✅ Primeira corrida processada: ${processed[0] === firstBookingId}`);
        await sleep(500);
        
        // 4. Verificar estado
        console.log('\n📋 4. Verificando estado da corrida...');
        const state = await RideStateManager.getBookingState(redis, firstBookingId);
        console.log(`   Estado: ${state}`);
        if (state !== 'SEARCHING') {
            console.log(`   ⚠️ Estado incorreto! Esperado: SEARCHING, encontrado: ${state}`);
        }
        
        // 5. Iniciar busca gradual
        console.log('\n📋 5. Iniciando busca gradual...');
        const expander = new GradualRadiusExpander(mockIO);
        await expander.startGradualSearch(firstBookingId, pickupLocation);
        console.log(`   ✅ Busca gradual iniciada`);
        
        // 6. Verificar busca gradual ativa
        console.log('\n📋 6. Verificando busca gradual...');
        const searchData = await redis.hgetall(`booking_search:${firstBookingId}`);
        console.log(`   Busca ativa: ${Object.keys(searchData).length > 0}`);
        console.log(`   Estado: ${searchData?.state || 'none'}`);
        console.log(`   Raio atual: ${searchData?.currentRadius || 'none'}`);
        
        // 7. Aguardar notificação com polling detalhado
        console.log('\n📋 7. Aguardando notificação (polling detalhado)...');
        let notified = false;
        for (let i = 0; i < 20; i++) {
            await sleep(500);
            
            // Verificar notificações
            const notifications = mockIO.getNotificationsForDriver(driverId);
            const hasFirst = notifications.some(n => n.bookingId === firstBookingId);
            
            // Verificar eventos
            const events = mockIO.events.filter(e => e.event === 'newRideRequest');
            const eventsForFirst = events.filter(e => 
                e.data?.bookingId === firstBookingId || 
                e.data?.booking?.bookingId === firstBookingId
            );
            
            // Verificar busca gradual
            const currentSearchData = await redis.hgetall(`booking_search:${firstBookingId}`);
            const currentRadius = currentSearchData?.currentRadius || 'none';
            
            console.log(`   [${i + 1}/20] Notificações: ${notifications.length}, Tem primeira: ${hasFirst}, Eventos: ${eventsForFirst.length}, Raio: ${currentRadius}`);
            
            if (hasFirst) {
                notified = true;
                console.log(`   ✅ Notificação recebida após ${(i + 1) * 500}ms`);
                break;
            }
        }
        
        // 8. Diagnóstico final
        console.log('\n📋 8. Diagnóstico final...');
        const finalNotifications = mockIO.getNotificationsForDriver(driverId);
        const allEvents = mockIO.events.filter(e => e.event === 'newRideRequest');
        
        console.log(`   Notificações capturadas: ${finalNotifications.length}`);
        console.log(`   Eventos capturados: ${allEvents.length}`);
        console.log(`   Notificação recebida: ${notified ? '✅ SIM' : '❌ NÃO'}`);
        
        if (!notified) {
            console.log('\n   🔍 Eventos capturados:');
            allEvents.forEach((e, i) => {
                console.log(`      ${i + 1}. Room: ${e.room}, BookingId: ${e.data?.bookingId || e.data?.booking?.bookingId || 'N/A'}`);
            });
            
            console.log('\n   🔍 Verificando motorista...');
            const driverData = await redis.hgetall(`driver:${driverId}`);
            const location = await redis.geopos('driver_locations', driverId);
            console.log(`      Existe: ${Object.keys(driverData).length > 0}`);
            console.log(`      Online: ${driverData?.isOnline}`);
            console.log(`      Status: ${driverData?.status}`);
            console.log(`      Localização: ${location && location[0] ? 'SIM' : 'NÃO'}`);
            
            const lockStatus = await driverLockManager.isDriverLocked(driverId);
            console.log(`      Lock: ${lockStatus.isLocked ? 'SIM' : 'NÃO'}`);
        }
        
        console.log('\n' + '='.repeat(60));
        if (notified) {
            console.log('✅ TESTE PASSOU: Primeira corrida foi notificada!');
        } else {
            console.log('❌ TESTE FALHOU: Primeira corrida não foi notificada');
        }
        console.log('='.repeat(60) + '\n');
        
    } catch (error) {
        console.error('\n❌ ERRO:', error);
        console.error(error.stack);
    } finally {
        // Limpar
        await redis.zrem('driver_locations', driverId);
        await redis.del(`driver:${driverId}`);
    }
}

async function testTC016Diagnostic() {
    console.log('\n🔍 DIAGNÓSTICO TC-016: Motorista Rejeita e Recebe Corrida Mais Antiga\n');
    console.log('='.repeat(60));
    
    const redis = redisPool.getConnection();
    const mockIO = new MockSocketIO();
    const driverId = 'test_driver_tc016';
    const pickupLocation = { lat: -22.9068, lng: -43.1234 };
    
    try {
        // 1. Setup motorista
        console.log('\n📋 1. Configurando motorista...');
        await setupTestDriver(redis, driverId, pickupLocation.lat, pickupLocation.lng);
        mockIO.connectedDrivers.add(driverId);
        await sleep(500);
        
        // 2. Criar 3 corridas
        console.log('\n📋 2. Criando 3 corridas...');
        const bookingIds = [];
        for (let i = 0; i < 3; i++) {
            const bookingId = `test_tc016_${Date.now()}_${i}`;
            bookingIds.push(bookingId);
            await rideQueueManager.enqueueRide({
                bookingId,
                customerId: 'test_customer',
                pickupLocation,
                destinationLocation: { lat: -22.9068, lng: -43.1234 },
                estimatedFare: 15.5,
                paymentMethod: 'pix'
            });
            if (i < 2) await sleep(100);
        }
        console.log(`   ✅ ${bookingIds.length} corridas criadas`);
        await sleep(500);
        
        // 3. Processar todas
        console.log('\n📋 3. Processando corridas...');
        const regionHash = GeoHashUtils.getRegionHashFromLocation(pickupLocation, 5);
        await rideQueueManager.processNextRides(regionHash, 3);
        console.log(`   ✅ Corridas processadas`);
        await sleep(500);
        
        // 4. Iniciar busca para todas
        console.log('\n📋 4. Iniciando busca gradual para todas as corridas...');
        const expander = new GradualRadiusExpander(mockIO);
        for (const bookingId of bookingIds) {
            await expander.startGradualSearch(bookingId, pickupLocation);
            console.log(`   ✅ Busca iniciada para ${bookingId}`);
        }
        
        // 5. Aguardar notificações
        console.log('\n📋 5. Aguardando notificações (10 segundos)...');
        await sleep(10000);
        
        // 6. Verificar notificações
        console.log('\n📋 6. Verificando notificações...');
        const notifications = mockIO.getNotificationsForDriver(driverId);
        const allEvents = mockIO.events.filter(e => e.event === 'newRideRequest');
        
        console.log(`   Notificações capturadas: ${notifications.length}`);
        console.log(`   Eventos capturados: ${allEvents.length}`);
        
        if (notifications.length > 0) {
            console.log('\n   📋 Notificações recebidas:');
            notifications.forEach((n, i) => {
                console.log(`      ${i + 1}. Booking: ${n.bookingId}, Timestamp: ${new Date(n.timestamp).toISOString()}`);
            });
            
            const firstBookingId = notifications[0].bookingId;
            console.log(`\n   Primeira notificação: ${firstBookingId}`);
            console.log(`   Esperado: ${bookingIds[0]}`);
            console.log(`   ✅ Correto: ${firstBookingId === bookingIds[0] ? 'SIM' : 'NÃO'}`);
        } else {
            console.log('\n   ❌ Nenhuma notificação recebida!');
            console.log('\n   🔍 Eventos capturados:');
            allEvents.forEach((e, i) => {
                console.log(`      ${i + 1}. Room: ${e.room}, BookingId: ${e.data?.bookingId || e.data?.booking?.bookingId || 'N/A'}`);
            });
        }
        
        console.log('\n' + '='.repeat(60));
        if (notifications.length > 0 && notifications[0].bookingId === bookingIds[0]) {
            console.log('✅ TESTE PASSOU: Motorista recebeu primeira corrida (mais antiga)!');
        } else {
            console.log('❌ TESTE FALHOU: Motorista não recebeu primeira corrida');
        }
        console.log('='.repeat(60) + '\n');
        
    } catch (error) {
        console.error('\n❌ ERRO:', error);
        console.error(error.stack);
    } finally {
        // Limpar
        await redis.zrem('driver_locations', driverId);
        await redis.del(`driver:${driverId}`);
    }
}

// Executar diagnósticos
async function main() {
    await testTC011Diagnostic();
    await sleep(2000);
    await testTC016Diagnostic();
    
    process.exit(0);
}

if (require.main === module) {
    main().catch(error => {
        console.error('❌ Erro fatal:', error);
        process.exit(1);
    });
}

module.exports = { testTC011Diagnostic, testTC016Diagnostic };


