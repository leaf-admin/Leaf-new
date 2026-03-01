#!/usr/bin/env node
/**
 * STRESS TEST: Peak Scenario
 * 
 * Simula cenário de pico: 10k drivers online, 5k rides em 30 segundos.
 * 
 * Uso:
 *   node scripts/stress-test/peak-scenario.js --drivers 10000 --rides 5000 --duration 30
 */

const io = require('socket.io-client');
const redisPool = require('../../utils/redis-pool');
const { logStructured, logError } = require('../../utils/logger');
const { metrics } = require('../../utils/prometheus-metrics');

// Parse arguments
const args = process.argv.slice(2);
const driverCount = args.includes('--drivers')
    ? parseInt(args[args.indexOf('--drivers') + 1]) || 10000
    : 10000;
const rideCount = args.includes('--rides')
    ? parseInt(args[args.indexOf('--rides') + 1]) || 5000
    : 5000;
const duration = args.includes('--duration')
    ? parseInt(args[args.indexOf('--duration') + 1]) || 30
    : 30; // segundos
const serverUrl = args.includes('--url')
    ? args[args.indexOf('--url') + 1]
    : 'http://localhost:3001';

// Estatísticas
const stats = {
    driversOnline: 0,
    ridesCreated: 0,
    ridesAccepted: 0,
    ridesCompleted: 0,
    ridesFailed: 0,
    startTime: Date.now(),
    endTime: null
};

// Colocar drivers online
async function putDriverOnline(redis, driverId, location) {
    try {
        // Adicionar driver ao set de online
        await redis.sadd('online_drivers', driverId);
        
        // Salvar localização
        await redis.geoadd('drivers:locations', location.lng, location.lat, driverId);
        
        // Salvar dados do driver
        await redis.hset(`driver:${driverId}`, {
            status: 'online',
            location: JSON.stringify(location),
            updatedAt: new Date().toISOString()
        });

        stats.driversOnline++;
        return { success: true };
    } catch (error) {
        logError(error, 'Erro ao colocar driver online', {
            service: 'stress-test',
            driverId
        });
        return { success: false, error: error.message };
    }
}

// Criar ride
async function createRide(socket, customerId, index) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            stats.ridesFailed++;
            resolve({ success: false, error: 'Timeout' });
        }, 15000);

        const bookingData = {
            customerId: `${customerId}_${index}`,
            pickupLocation: {
                lat: -23.5505 + (Math.random() - 0.5) * 0.1,
                lng: -46.6333 + (Math.random() - 0.5) * 0.1
            },
            destinationLocation: {
                lat: -23.5605 + (Math.random() - 0.5) * 0.1,
                lng: -46.6433 + (Math.random() - 0.5) * 0.1
            },
            estimatedFare: 20 + Math.random() * 30,
            paymentMethod: 'pix'
        };

        socket.emit('createBooking', bookingData);

        socket.once('bookingCreated', (data) => {
            clearTimeout(timeout);
            if (data.success) {
                stats.ridesCreated++;
                metrics.recordRideRequested('peak-scenario', 'standard');
            } else {
                stats.ridesFailed++;
            }
            resolve({ success: data.success, bookingId: data.bookingId });
        });

        socket.once('bookingError', (error) => {
            clearTimeout(timeout);
            stats.ridesFailed++;
            resolve({ success: false, error: error.message });
        });
    });
}

// Função principal
async function runPeakScenario() {
    logStructured('info', 'Iniciando peak scenario test', {
        service: 'stress-test',
        driverCount,
        rideCount,
        duration,
        serverUrl
    });

    await redisPool.ensureConnection();
    const redis = redisPool.getConnection();

    // Fase 1: Colocar drivers online
    logStructured('info', 'Fase 1: Colocando drivers online', {
        service: 'stress-test',
        count: driverCount
    });

    const driverPromises = [];
    for (let i = 0; i < driverCount; i++) {
        const driverId = `peak_driver_${i}`;
        const location = {
            lat: -23.5505 + (Math.random() - 0.5) * 0.2,
            lng: -46.6333 + (Math.random() - 0.5) * 0.2
        };

        driverPromises.push(putDriverOnline(redis, driverId, location));

        // Processar em batches de 100
        if (driverPromises.length >= 100) {
            await Promise.allSettled(driverPromises);
            driverPromises.length = 0;
            
            if (i % 1000 === 0) {
                logStructured('info', 'Progresso: drivers online', {
                    service: 'stress-test',
                    progress: `${((i / driverCount) * 100).toFixed(1)}%`,
                    online: stats.driversOnline
                });
            }
        }
    }

    // Finalizar drivers restantes
    if (driverPromises.length > 0) {
        await Promise.allSettled(driverPromises);
    }

    logStructured('info', 'Fase 1 concluída: drivers online', {
        service: 'stress-test',
        online: stats.driversOnline
    });

    // Fase 2: Criar rides na taxa especificada
    logStructured('info', 'Fase 2: Criando rides', {
        service: 'stress-test',
        count: rideCount,
        duration
    });

    const socket = io(serverUrl, {
        transports: ['websocket'],
        reconnection: false,
        timeout: 20000
    });

    await new Promise((resolve) => {
        socket.on('connect', () => {
            logStructured('info', 'WebSocket conectado', {
                service: 'stress-test'
            });
            resolve();
        });
        
        socket.on('connect_error', (error) => {
            logError(error, 'Erro ao conectar WebSocket', {
                service: 'stress-test'
            });
            resolve(); // Continuar mesmo com erro
        });
    });

    // Aguardar autenticação
    await new Promise((resolve) => {
        socket.once('authenticated', () => {
            logStructured('info', 'Autenticado com sucesso', {
                service: 'stress-test'
            });
            resolve();
        });
        
        socket.emit('authenticate', {
            uid: `peak_customer_${Date.now()}`,
            userType: 'customer'
        });
        
        setTimeout(() => resolve(), 5000); // Timeout de segurança
    });

    const rideRate = rideCount / duration; // rides por segundo
    const intervalMs = 1000 / rideRate;
    const endTime = Date.now() + (duration * 1000);
    let rideIndex = 0;

    while (Date.now() < endTime && rideIndex < rideCount) {
        await createRide(socket, `peak_customer`, rideIndex++);
        await new Promise(resolve => setTimeout(resolve, intervalMs));

        // Log de progresso
        if (rideIndex % 100 === 0) {
            const elapsed = (Date.now() - stats.startTime) / 1000;
            logStructured('info', 'Progresso: rides criadas', {
                service: 'stress-test',
                elapsed: `${elapsed.toFixed(1)}s`,
                created: stats.ridesCreated,
                failed: stats.ridesFailed
            });
        }
    }

    stats.endTime = Date.now();
    const actualDuration = (stats.endTime - stats.startTime) / 1000;
    const actualRideRate = stats.ridesCreated / actualDuration;

    // Aguardar um pouco para ver processamento
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Verificar métricas finais
    const finalOnlineDrivers = await redis.scard('online_drivers');
    const activeBookings = await redis.keys('booking:*');
    const streamLength = await redis.xlen('ride_events');

    // Relatório final
    const report = {
        test: 'peak-scenario',
        config: {
            driverCount,
            rideCount,
            duration,
            targetRideRate: rideRate.toFixed(2)
        },
        results: {
            driversOnline: stats.driversOnline,
            finalOnlineDrivers,
            ridesCreated: stats.ridesCreated,
            ridesFailed: stats.ridesFailed,
            successRate: `${((stats.ridesCreated / rideCount) * 100).toFixed(2)}%`,
            actualDuration: `${actualDuration.toFixed(2)}s`,
            actualRideRate: `${actualRideRate.toFixed(2)} rides/s`,
            activeBookings: activeBookings.length,
            streamLength
        },
        timestamp: new Date().toISOString()
    };

    // Salvar relatório
    const fs = require('fs');
    const path = require('path');
    const reportPath = path.join(__dirname, `../../stress-test-peak-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    // Log resumo
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO DE PEAK SCENARIO TEST');
    console.log('='.repeat(60));
    console.log(`Drivers online: ${stats.driversOnline} (final: ${finalOnlineDrivers})`);
    console.log(`Rides criadas: ${stats.ridesCreated}`);
    console.log(`Rides falhadas: ${stats.ridesFailed}`);
    console.log(`Taxa de sucesso: ${((stats.ridesCreated / rideCount) * 100).toFixed(2)}%`);
    console.log(`Duração: ${actualDuration.toFixed(2)}s`);
    console.log(`Taxa real: ${actualRideRate.toFixed(2)} rides/s`);
    console.log(`Bookings ativos: ${activeBookings.length}`);
    console.log(`Eventos no stream: ${streamLength}`);
    console.log(`\nRelatório salvo em: ${reportPath}`);
    console.log('='.repeat(60) + '\n');

    socket.disconnect();
    process.exit(0);
}

// Executar
runPeakScenario().catch(error => {
    logError(error, 'Erro fatal no peak scenario test', {
        service: 'stress-test'
    });
    process.exit(1);
});

