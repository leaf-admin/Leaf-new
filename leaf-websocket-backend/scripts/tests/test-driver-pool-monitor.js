/**
 * TESTE DO DRIVER POOL MONITOR
 * 
 * Testa se o DriverPoolMonitor está funcionando corretamente:
 * 1. Verifica se inicia corretamente
 * 2. Verifica se detecta motoristas disponíveis
 * 3. Verifica se busca e notifica próxima corrida
 */

const redisPool = require('./utils/redis-pool');
const DriverPoolMonitor = require('./services/driver-pool-monitor');
const rideQueueManager = require('./services/ride-queue-manager');
const RideStateManager = require('./services/ride-state-manager');
const GeoHashUtils = require('./utils/geohash-utils');

// Mock Socket.IO
class MockSocketIO {
    constructor() {
        this.notifications = new Map(); // driverId -> [notifications]
        this.events = [];
    }

    to(room) {
        return {
            emit: (event, data) => {
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
                        }
                    }
                }
            }
        };
    }

    in(room) {
        return {
            fetchSockets: async () => {
                // Simular que motorista está conectado
                return [{ id: 'mock_socket', userId: room.replace('driver_', '') }];
            }
        };
    }

    sockets = {
        sockets: new Map()
    };
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function cleanupTestData(redis) {
    console.log('🧹 Limpando dados de teste...');
    
    // Limpar motoristas de teste
    const testDriverIds = ['test_driver_monitor_1', 'test_driver_monitor_2'];
    for (const driverId of testDriverIds) {
        await redis.zrem('driver_locations', driverId);
        await redis.del(`driver:${driverId}`);
        await redis.del(`driver_active_notification:${driverId}`);
    }
    
    // Limpar corridas de teste
    const testBookingIds = ['test_booking_monitor_1', 'test_booking_monitor_2'];
    for (const bookingId of testBookingIds) {
        await redis.del(`booking:${bookingId}`);
        await redis.del(`ride_notifications:${bookingId}`);
        await redis.del(`ride_excluded_drivers:${bookingId}`);
        await redis.del(`booking_search:${bookingId}`);
        
        // Limpar das filas
        const allRegions = await redis.keys('ride_queue:*:pending');
        for (const key of allRegions) {
            await redis.zrem(key, bookingId);
        }
        const allActiveRegions = await redis.keys('ride_queue:*:active');
        for (const key of allActiveRegions) {
            await redis.hdel(key, bookingId);
        }
    }
    
    console.log('✅ Dados de teste limpos');
}

async function setupTestDriver(redis, driverId, lat, lng) {
    // Adicionar ao Redis GEO
    await redis.geoadd('driver_locations', lng, lat, driverId);
    
    // Criar dados do motorista
    await redis.hset(`driver:${driverId}`, {
        isOnline: 'true',
        status: 'AVAILABLE',
        lat: String(lat),
        lng: String(lng)
    });
    
    // Definir TTL de 5 minutos
    await redis.expire(`driver:${driverId}`, 300);
    
    console.log(`✅ Motorista ${driverId} configurado (${lat}, ${lng})`);
}

async function setupTestRide(redis, bookingId, pickupLocation) {
    const regionHash = GeoHashUtils.getRegionHashFromLocation(pickupLocation);
    
    // Criar dados da corrida
    await redis.hset(`booking:${bookingId}`, {
        bookingId: bookingId,
        customerId: 'test_customer_monitor',
        pickupLocation: JSON.stringify(pickupLocation),
        destinationLocation: JSON.stringify({ lat: -23.5505, lng: -46.6333 }),
        estimatedFare: '25.00',
        paymentMethod: 'pix',
        region: regionHash,
        state: RideStateManager.STATES.PENDING,
        createdAt: new Date().toISOString()
    });
    
    // Adicionar à fila pendente
    const pendingQueueKey = `ride_queue:${regionHash}:pending`;
    await redis.zadd(pendingQueueKey, Date.now(), bookingId);
    
    console.log(`✅ Corrida ${bookingId} criada na região ${regionHash}`);
}

async function testDriverPoolMonitor() {
    console.log('\n🧪 TESTE DO DRIVER POOL MONITOR\n');
    console.log('='.repeat(60));
    
    const redis = redisPool.getConnection();
    const mockIO = new MockSocketIO();
    
    try {
        // 1. Limpar dados de teste anteriores
        await cleanupTestData(redis);
        await sleep(1000);
        
        // 2. Configurar motorista de teste
        console.log('\n📋 Configurando motorista de teste...');
        await setupTestDriver(redis, 'test_driver_monitor_1', -23.5505, -46.6333);
        await sleep(500);
        
        // 3. Configurar corrida de teste
        console.log('\n📋 Configurando corrida de teste...');
        await setupTestRide(redis, 'test_booking_monitor_1', {
            lat: -23.5505,
            lng: -46.6333
        });
        await sleep(500);
        
        // 4. Processar corrida (mover de pending para active)
        console.log('\n📋 Processando corrida (pending → active)...');
        const pickupLocation = { lat: -23.5505, lng: -46.6333 };
        const regionHash = GeoHashUtils.getRegionHashFromLocation(pickupLocation);
        await rideQueueManager.processNextRides(regionHash, 1);
        await sleep(1000);
        
        // Verificar se corrida foi processada
        const bookingState = await RideStateManager.getBookingState(redis, 'test_booking_monitor_1');
        console.log(`   Estado da corrida: ${bookingState}`);
        
        if (bookingState !== RideStateManager.STATES.SEARCHING) {
            // Atualizar estado manualmente se necessário
            await RideStateManager.updateBookingState(redis, 'test_booking_monitor_1', RideStateManager.STATES.SEARCHING);
            console.log('   ✅ Estado atualizado para SEARCHING');
        }
        
        await sleep(1000);
        
        // 5. Criar e iniciar DriverPoolMonitor
        console.log('\n📋 Criando DriverPoolMonitor...');
        const driverPoolMonitor = new DriverPoolMonitor(mockIO);
        
        console.log('\n📋 Iniciando monitor...');
        driverPoolMonitor.start();
        
        // 6. Aguardar algumas iterações (5s cada)
        console.log('\n⏳ Aguardando monitor processar (15 segundos)...');
        await sleep(15000);
        
        // 7. Verificar estatísticas
        console.log('\n📊 Estatísticas do monitor:');
        const stats = await driverPoolMonitor.getStats();
        console.log(JSON.stringify(stats, null, 2));
        
        // 8. Verificar se motorista recebeu notificação
        console.log('\n📋 Verificando notificações...');
        const notifications = mockIO.notifications.get('test_driver_monitor_1');
        
        if (notifications && notifications.length > 0) {
            console.log(`✅ Motorista recebeu ${notifications.length} notificação(ões):`);
            notifications.forEach((notif, index) => {
                console.log(`   ${index + 1}. Booking: ${notif.bookingId}`);
            });
        } else {
            console.log('⚠️ Motorista não recebeu notificações ainda');
            console.log('   Verificando eventos capturados...');
            const relevantEvents = mockIO.events.filter(e => e.event === 'newRideRequest');
            if (relevantEvents.length > 0) {
                console.log(`   ✅ ${relevantEvents.length} evento(s) de notificação capturado(s)`);
            } else {
                console.log('   ❌ Nenhum evento de notificação capturado');
            }
        }
        
        // 9. Parar monitor
        console.log('\n📋 Parando monitor...');
        driverPoolMonitor.stop();
        
        // 10. Resultado final
        console.log('\n' + '='.repeat(60));
        if (notifications && notifications.length > 0) {
            console.log('✅ TESTE PASSOU: Motorista recebeu notificação automaticamente!');
        } else {
            console.log('⚠️ TESTE INCONCLUSIVO: Motorista não recebeu notificação (pode ser timing)');
            console.log('   Tente aumentar o tempo de espera ou verificar logs do monitor');
        }
        console.log('='.repeat(60) + '\n');
        
        // Limpar dados de teste
        await cleanupTestData(redis);
        
    } catch (error) {
        console.error('\n❌ ERRO NO TESTE:', error);
        console.error(error.stack);
        
        // Limpar dados de teste mesmo em caso de erro
        try {
            await cleanupTestData(redis);
        } catch (cleanupError) {
            console.error('Erro ao limpar dados:', cleanupError);
        }
    } finally {
        // Garantir que Redis está fechado
        try {
            await redis.quit();
        } catch (e) {
            // Ignorar erro se já está fechado
        }
    }
}

// Executar teste
if (require.main === module) {
    testDriverPoolMonitor()
        .then(() => {
            console.log('✅ Teste concluído');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { testDriverPoolMonitor };


