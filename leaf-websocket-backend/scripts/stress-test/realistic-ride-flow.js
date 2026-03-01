#!/usr/bin/env node
/**
 * STRESS TEST: Fluxo Realista de Corrida
 * 
 * Simula um fluxo completo e realista de corrida:
 * 1. Cliente solicita corrida
 * 2. Motorista aceita
 * 3. Motorista inicia viagem
 * 4. Motorista completa viagem
 * 5. Pagamento processado
 * 
 * Valida todo o pipeline: commands, events, listeners, métricas, spans
 * 
 * Uso:
 *   node scripts/stress-test/realistic-ride-flow.js --count 50
 */

const io = require('socket.io-client');
const { logStructured, logError } = require('../../utils/logger');
const { metrics } = require('../../utils/prometheus-metrics');
const { getTracer } = require('../../utils/tracer');

const args = process.argv.slice(2);
const count = args.includes('--count')
    ? parseInt(args[args.indexOf('--count') + 1]) || 10
    : 10;
const serverUrl = args.includes('--url')
    ? args[args.indexOf('--url') + 1]
    : 'http://localhost:3001';

const stats = {
    total: count,
    requested: 0,
    accepted: 0,
    started: 0,
    completed: 0,
    paid: 0,
    failed: 0,
    latencies: {
        request: [],
        accept: [],
        start: [],
        complete: [],
        payment: []
    },
    startTime: Date.now()
};

// Gerar localização realista (São Paulo)
function randomLocation() {
    const baseLat = -23.5505;
    const baseLng = -46.6333;
    const radius = 0.1; // ~10km
    
    return {
        lat: baseLat + (Math.random() - 0.5) * radius,
        lng: baseLng + (Math.random() - 0.5) * radius
    };
}

// Simular fluxo completo de corrida
async function simulateRideFlow(index) {
    const customerId = `realistic_customer_${index}_${Date.now()}`;
    const driverId = `realistic_driver_${index}_${Date.now()}`;
    
    return new Promise(async (resolve) => {
        const tracer = getTracer();
        const span = tracer?.startSpan('realistic-ride-flow', {
            attributes: {
                'test.type': 'realistic-flow',
                'customer.id': customerId,
                'driver.id': driverId
            }
        });
        
        try {
            // 1. Conectar cliente
            const customerSocket = io(serverUrl, {
                transports: ['websocket'],
                reconnection: false,
                timeout: 10000
            });
            
            await new Promise((resolve) => {
                customerSocket.on('connect', () => {
                    customerSocket.emit('authenticate', {
                        uid: customerId,
                        userType: 'customer'
                    });
                    resolve();
                });
                customerSocket.on('connect_error', () => resolve());
                setTimeout(() => resolve(), 5000);
            });
            
            // 2. Solicitar corrida
            const requestStart = Date.now();
            const pickup = randomLocation();
            const destination = randomLocation();
            
            const bookingData = {
                customerId,
                pickupLocation: pickup,
                destinationLocation: destination,
                estimatedFare: 20 + Math.random() * 30,
                paymentMethod: 'pix',
                carType: 'standard'
            };
            
            customerSocket.emit('createBooking', bookingData);
            
            const bookingResult = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve({ success: false, error: 'Timeout' });
                }, 15000);
                
                customerSocket.once('bookingCreated', (data) => {
                    clearTimeout(timeout);
                    resolve(data);
                });
                
                customerSocket.once('bookingError', (error) => {
                    clearTimeout(timeout);
                    resolve({ success: false, error: error.message || 'Unknown' });
                });
            });
            
            if (!bookingResult.success) {
                stats.failed++;
                customerSocket.disconnect();
                span?.setStatus({ code: 2, message: 'Booking failed' });
                span?.end();
                resolve({ success: false, step: 'request' });
                return;
            }
            
            stats.requested++;
            stats.latencies.request.push(Date.now() - requestStart);
            metrics.recordRideRequested('realistic-test', 'standard');
            
            const bookingId = bookingResult.bookingId;
            
            // 3. Conectar motorista e aceitar
            const driverSocket = io(serverUrl, {
                transports: ['websocket'],
                reconnection: false,
                timeout: 10000
            });
            
            await new Promise((resolve) => {
                driverSocket.on('connect', () => {
                    driverSocket.emit('authenticate', {
                        uid: driverId,
                        userType: 'driver'
                    });
                    resolve();
                });
                driverSocket.on('connect_error', () => resolve());
                setTimeout(() => resolve(), 5000);
            });
            
            // Aguardar um pouco antes de aceitar (realista)
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
            
            const acceptStart = Date.now();
            driverSocket.emit('acceptRide', { bookingId });
            
            const acceptResult = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve({ success: false, error: 'Timeout' });
                }, 10000);
                
                driverSocket.once('rideAccepted', (data) => {
                    clearTimeout(timeout);
                    resolve(data);
                });
                
                driverSocket.once('rideError', (error) => {
                    clearTimeout(timeout);
                    resolve({ success: false, error: error.message || 'Unknown' });
                });
            });
            
            if (!acceptResult.success) {
                stats.failed++;
                customerSocket.disconnect();
                driverSocket.disconnect();
                span?.setStatus({ code: 2, message: 'Accept failed' });
                span?.end();
                resolve({ success: false, step: 'accept' });
                return;
            }
            
            stats.accepted++;
            stats.latencies.accept.push(Date.now() - acceptStart);
            metrics.recordRideAccepted('realistic-test', 'standard');
            
            // 4. Iniciar viagem
            await new Promise(r => setTimeout(r, 2000 + Math.random() * 3000));
            
            const startStart = Date.now();
            driverSocket.emit('startTrip', { bookingId });
            
            const startResult = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve({ success: false, error: 'Timeout' });
                }, 10000);
                
                driverSocket.once('tripStarted', (data) => {
                    clearTimeout(timeout);
                    resolve(data);
                });
                
                driverSocket.once('tripError', (error) => {
                    clearTimeout(timeout);
                    resolve({ success: false, error: error.message || 'Unknown' });
                });
            });
            
            if (!startResult.success) {
                stats.failed++;
                customerSocket.disconnect();
                driverSocket.disconnect();
                span?.setStatus({ code: 2, message: 'Start failed' });
                span?.end();
                resolve({ success: false, step: 'start' });
                return;
            }
            
            stats.started++;
            stats.latencies.start.push(Date.now() - startStart);
            
            // 5. Simular viagem (atualizar localização algumas vezes)
            for (let i = 0; i < 3; i++) {
                await new Promise(r => setTimeout(r, 2000));
                const currentLocation = {
                    lat: pickup.lat + (destination.lat - pickup.lat) * ((i + 1) / 3),
                    lng: pickup.lng + (destination.lng - pickup.lng) * ((i + 1) / 3)
                };
                driverSocket.emit('updateLocation', {
                    lat: currentLocation.lat,
                    lng: currentLocation.lng
                });
            }
            
            // 6. Completar viagem
            await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
            
            const completeStart = Date.now();
            driverSocket.emit('completeTrip', {
                bookingId,
                endLocation: destination,
                distance: 5 + Math.random() * 10,
                duration: 600 + Math.random() * 1200
            });
            
            const completeResult = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve({ success: false, error: 'Timeout' });
                }, 10000);
                
                driverSocket.once('tripCompleted', (data) => {
                    clearTimeout(timeout);
                    resolve(data);
                });
                
                driverSocket.once('tripError', (error) => {
                    clearTimeout(timeout);
                    resolve({ success: false, error: error.message || 'Unknown' });
                });
            });
            
            if (!completeResult.success) {
                stats.failed++;
                customerSocket.disconnect();
                driverSocket.disconnect();
                span?.setStatus({ code: 2, message: 'Complete failed' });
                span?.end();
                resolve({ success: false, step: 'complete' });
                return;
            }
            
            stats.completed++;
            stats.latencies.complete.push(Date.now() - completeStart);
            metrics.recordRideCompleted('realistic-test', 'standard');
            
            // 7. Processar pagamento
            await new Promise(r => setTimeout(r, 1000));
            
            const paymentStart = Date.now();
            customerSocket.emit('confirmPayment', {
                bookingId,
                paymentMethod: 'pix',
                paymentId: `payment_${Date.now()}`,
                amount: completeResult.fare || 25
            });
            
            const paymentResult = await new Promise((resolve) => {
                const timeout = setTimeout(() => {
                    resolve({ success: false, error: 'Timeout' });
                }, 10000);
                
                customerSocket.once('paymentConfirmed', (data) => {
                    clearTimeout(timeout);
                    resolve(data);
                });
                
                customerSocket.once('paymentError', (error) => {
                    clearTimeout(timeout);
                    resolve({ success: false, error: error.message || 'Unknown' });
                });
            });
            
            if (paymentResult.success) {
                stats.paid++;
                stats.latencies.payment.push(Date.now() - paymentStart);
            }
            
            customerSocket.disconnect();
            driverSocket.disconnect();
            
            span?.setStatus({ code: 1 }); // OK
            span?.end();
            
            resolve({ success: true, bookingId });
            
        } catch (error) {
            logError(error, 'Erro no fluxo de corrida', {
                service: 'stress-test',
                index
            });
            stats.failed++;
            span?.recordException(error);
            span?.setStatus({ code: 2, message: error.message });
            span?.end();
            resolve({ success: false, error: error.message });
        }
    });
}

// Função principal
async function runRealisticFlow() {
    logStructured('info', 'Iniciando teste de fluxo realista', {
        service: 'stress-test',
        count,
        serverUrl
    });
    
    console.log('\n' + '='.repeat(60));
    console.log('🚗 TESTE DE FLUXO REALISTA DE CORRIDA');
    console.log('='.repeat(60));
    console.log(`Total de corridas: ${count}\n`);
    
    // Processar corridas sequencialmente (mais realista)
    for (let i = 0; i < count; i++) {
        const progress = ((i + 1) / count) * 100;
        console.log(`[${progress.toFixed(1)}%] Processando corrida ${i + 1}/${count}...`);
        
        const result = await simulateRideFlow(i);
        
        if (result.success) {
            console.log(`  ✅ Corrida ${i + 1} completada com sucesso`);
        } else {
            console.log(`  ❌ Corrida ${i + 1} falhou: ${result.step || result.error}`);
        }
        
        // Pequena pausa entre corridas
        if (i < count - 1) {
            await new Promise(r => setTimeout(r, 500));
        }
    }
    
    const duration = (Date.now() - stats.startTime) / 1000;
    
    // Calcular estatísticas
    const avgLatency = (arr) => arr.length > 0
        ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2)
        : '0.00';
    
    // Relatório
    console.log('\n' + '='.repeat(60));
    console.log('📊 RELATÓRIO DO FLUXO REALISTA');
    console.log('='.repeat(60));
    console.log(`Total: ${stats.total}`);
    console.log(`Solicitadas: ${stats.requested}`);
    console.log(`Aceitas: ${stats.accepted}`);
    console.log(`Iniciadas: ${stats.started}`);
    console.log(`Completadas: ${stats.completed}`);
    console.log(`Pagas: ${stats.paid}`);
    console.log(`Falhas: ${stats.failed}`);
    console.log(`Duração: ${duration.toFixed(2)}s`);
    console.log(`\nLatências médias:`);
    console.log(`  Solicitação: ${avgLatency(stats.latencies.request)}ms`);
    console.log(`  Aceite: ${avgLatency(stats.latencies.accept)}ms`);
    console.log(`  Início: ${avgLatency(stats.latencies.start)}ms`);
    console.log(`  Conclusão: ${avgLatency(stats.latencies.complete)}ms`);
    console.log(`  Pagamento: ${avgLatency(stats.latencies.payment)}ms`);
    console.log('='.repeat(60) + '\n');
    
    const successRate = (stats.completed / stats.total) * 100;
    process.exit(successRate >= 80 ? 0 : 1);
}

// Executar
runRealisticFlow().catch(error => {
    logError(error, 'Erro fatal no teste de fluxo realista', {
        service: 'stress-test'
    });
    process.exit(1);
});







