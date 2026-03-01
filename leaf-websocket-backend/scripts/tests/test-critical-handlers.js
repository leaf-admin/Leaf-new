#!/usr/bin/env node

/**
 * 🧪 TESTE DE HANDLERS CRÍTICOS
 * 
 * Este script testa todos os handlers críticos após a reorganização
 * para validar que não há mais race conditions e que todos funcionam corretamente.
 */

const io = require('socket.io-client');
const { performance } = require('perf_hooks');

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    bold: '\x1b[1m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

const WS_URL = process.env.WS_URL || 'http://localhost:3001';

// Handlers críticos a testar
const CRITICAL_HANDLERS = [
    { name: 'authenticate', event: 'authenticate', response: 'authenticated', required: true },
    { name: 'disconnect', event: 'disconnect', response: null, required: true },
    { name: 'createBooking', event: 'createBooking', response: 'bookingCreated', required: false },
    { name: 'confirmPayment', event: 'confirmPayment', response: 'paymentConfirmed', required: false },
    { name: 'acceptRide', event: 'acceptRide', response: 'rideAccepted', required: false },
    { name: 'rejectRide', event: 'rejectRide', response: 'rideRejected', required: false },
    { name: 'startTrip', event: 'startTrip', response: 'tripStarted', required: false },
    { name: 'updateTripLocation', event: 'updateTripLocation', response: null, required: false },
    { name: 'completeTrip', event: 'completeTrip', response: 'tripCompleted', required: false },
    { name: 'updateDriverLocation', event: 'updateDriverLocation', response: 'locationUpdated', required: false },
    { name: 'driverHeartbeat', event: 'driverHeartbeat', response: null, required: false },
    { name: 'updateLocation', event: 'updateLocation', response: null, required: false },
    { name: 'cancelRide', event: 'cancelRide', response: 'rideCancelled', required: false }
];

async function testHandler(handler, userId, userType) {
    return new Promise((resolve) => {
        const socket = io(WS_URL, {
            transports: ['websocket', 'polling'],
            timeout: 10000
        });

        let handlerRegistered = false;
        let eventReceived = false;
        let errorReceived = false;
        const startTime = performance.now();

        // Timeout geral
        const timeout = setTimeout(() => {
            socket.disconnect();
            resolve({
                handler: handler.name,
                success: false,
                error: 'Timeout',
                latency: performance.now() - startTime,
                handlerRegistered,
                eventReceived
            });
        }, 15000);

        socket.on('connect', () => {
            log(`   ✅ Conectado (Socket ID: ${socket.id})`, 'green');
            handlerRegistered = true;

            // Testar authenticate primeiro (obrigatório)
            if (handler.name === 'authenticate') {
                socket.emit('authenticate', { uid: userId, userType: userType });
            } else {
                // Para outros handlers, autenticar primeiro
                socket.emit('authenticate', { uid: userId, userType: userType });
                
                socket.once('authenticated', () => {
                    // Aguardar um pouco para garantir que handler está registrado
                    setTimeout(() => {
                        if (handler.name === 'disconnect') {
                            socket.disconnect();
                        } else {
                            // Emitir evento de teste
                            const testData = getTestData(handler.name, userId);
                            socket.emit(handler.event, testData);
                        }
                    }, 100);
                });
            }

            // Escutar resposta esperada
            if (handler.response) {
                socket.once(handler.response, (data) => {
                    eventReceived = true;
                    clearTimeout(timeout);
                    socket.disconnect();
                    resolve({
                        handler: handler.name,
                        success: true,
                        latency: performance.now() - startTime,
                        handlerRegistered,
                        eventReceived,
                        data
                    });
                });
            } else {
                // Para handlers sem resposta, apenas verificar se não há erro
                setTimeout(() => {
                    if (!errorReceived) {
                        clearTimeout(timeout);
                        socket.disconnect();
                        resolve({
                            handler: handler.name,
                            success: true,
                            latency: performance.now() - startTime,
                            handlerRegistered,
                            eventReceived: true
                        });
                    }
                }, 2000);
            }

            // Escutar erros
            socket.once('error', (error) => {
                errorReceived = true;
                clearTimeout(timeout);
                socket.disconnect();
                resolve({
                    handler: handler.name,
                    success: false,
                    error: error.message || 'Erro desconhecido',
                    latency: performance.now() - startTime,
                    handlerRegistered,
                    eventReceived
                });
            });
        });

        socket.on('connect_error', (error) => {
            clearTimeout(timeout);
            resolve({
                handler: handler.name,
                success: false,
                error: error.message || 'Erro de conexão',
                latency: performance.now() - startTime,
                handlerRegistered: false,
                eventReceived: false
            });
        });

        // Para authenticate, escutar authenticated
        if (handler.name === 'authenticate') {
            socket.once('authenticated', (data) => {
                eventReceived = true;
                clearTimeout(timeout);
                socket.disconnect();
                resolve({
                    handler: handler.name,
                    success: true,
                    latency: performance.now() - startTime,
                    handlerRegistered,
                    eventReceived,
                    data
                });
            });

            socket.once('auth_error', (error) => {
                errorReceived = true;
                clearTimeout(timeout);
                socket.disconnect();
                resolve({
                    handler: handler.name,
                    success: false,
                    error: error.message || 'Erro de autenticação',
                    latency: performance.now() - startTime,
                    handlerRegistered,
                    eventReceived
                });
            });
        }
    });
}

function getTestData(handlerName, userId) {
    const baseData = {
        customerId: userId,
        driverId: userId,
        bookingId: `test_booking_${Date.now()}`,
        rideId: `test_ride_${Date.now()}`
    };

    switch (handlerName) {
        case 'createBooking':
            return {
                ...baseData,
                pickupLocation: { lat: -23.5505, lng: -46.6333 },
                destinationLocation: { lat: -23.5632, lng: -46.6544 },
                estimatedFare: 25.50,
                paymentMethod: 'pix'
            };
        case 'confirmPayment':
            return {
                ...baseData,
                amount: 25.50,
                paymentId: `payment_${Date.now()}`
            };
        case 'acceptRide':
        case 'rejectRide':
            return {
                ...baseData,
                bookingId: `test_booking_${Date.now()}`
            };
        case 'startTrip':
        case 'completeTrip':
            return {
                ...baseData,
                bookingId: `test_booking_${Date.now()}`,
                startLocation: { lat: -23.5505, lng: -46.6333 }
            };
        case 'updateTripLocation':
        case 'updateDriverLocation':
        case 'updateLocation':
            return {
                ...baseData,
                lat: -23.5505,
                lng: -46.6333,
                heading: 0,
                speed: 0
            };
        case 'driverHeartbeat':
            return {
                ...baseData,
                lat: -23.5505,
                lng: -46.6333,
                tripStatus: 'idle',
                isInTrip: false
            };
        case 'cancelRide':
            return {
                ...baseData,
                bookingId: `test_booking_${Date.now()}`,
                reason: 'Teste de cancelamento'
            };
        default:
            return baseData;
    }
}

async function runTests() {
    log(`\n${colors.bold}🧪 TESTE DE HANDLERS CRÍTICOS${colors.reset}`, 'cyan');
    log(`URL: ${WS_URL}`, 'blue');
    log(`Handlers a testar: ${CRITICAL_HANDLERS.length}\n`, 'blue');

    const results = {
        customer: [],
        driver: []
    };

    // Testar como customer
    log(`\n${colors.bold}👤 TESTANDO COMO CUSTOMER${colors.reset}`, 'cyan');
    for (const handler of CRITICAL_HANDLERS.filter(h => h.name !== 'setDriverStatus')) {
        log(`\n📊 Testando: ${handler.name}`, 'blue');
        const result = await testHandler(handler, 'customer_test_001', 'customer');
        results.customer.push(result);
        
        if (result.success) {
            log(`   ✅ Sucesso (${Math.round(result.latency)}ms)`, 'green');
        } else {
            log(`   ❌ Falha: ${result.error}`, 'red');
        }
        
        // Pequeno delay entre testes
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Testar como driver
    log(`\n${colors.bold}🚗 TESTANDO COMO DRIVER${colors.reset}`, 'cyan');
    for (const handler of CRITICAL_HANDLERS) {
        log(`\n📊 Testando: ${handler.name}`, 'blue');
        const result = await testHandler(handler, 'driver_test_001', 'driver');
        results.driver.push(result);
        
        if (result.success) {
            log(`   ✅ Sucesso (${Math.round(result.latency)}ms)`, 'green');
        } else {
            log(`   ❌ Falha: ${result.error}`, 'red');
        }
        
        // Pequeno delay entre testes
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Relatório final
    log(`\n${colors.bold}📊 RELATÓRIO FINAL${colors.reset}`, 'cyan');
    log(`================================`, 'cyan');

    const customerSuccess = results.customer.filter(r => r.success).length;
    const customerTotal = results.customer.length;
    const driverSuccess = results.driver.filter(r => r.success).length;
    const driverTotal = results.driver.length;

    log(`\n👤 Customer:`, 'blue');
    log(`   ✅ Sucessos: ${customerSuccess}/${customerTotal}`, customerSuccess === customerTotal ? 'green' : 'yellow');
    log(`   ❌ Falhas: ${customerTotal - customerSuccess}/${customerTotal}`, customerSuccess === customerTotal ? 'green' : 'red');

    log(`\n🚗 Driver:`, 'blue');
    log(`   ✅ Sucessos: ${driverSuccess}/${driverTotal}`, driverSuccess === driverTotal ? 'green' : 'yellow');
    log(`   ❌ Falhas: ${driverTotal - driverSuccess}/${driverTotal}`, driverSuccess === driverTotal ? 'green' : 'red');

    const totalSuccess = customerSuccess + driverSuccess;
    const totalTests = customerTotal + driverTotal;

    log(`\n📊 Total:`, 'blue');
    log(`   ✅ Sucessos: ${totalSuccess}/${totalTests}`, totalSuccess === totalTests ? 'green' : 'yellow');
    log(`   ❌ Falhas: ${totalTests - totalSuccess}/${totalTests}`, totalSuccess === totalTests ? 'green' : 'red');

    // Latências médias
    const allResults = [...results.customer, ...results.driver].filter(r => r.success);
    if (allResults.length > 0) {
        const avgLatency = allResults.reduce((sum, r) => sum + r.latency, 0) / allResults.length;
        const minLatency = Math.min(...allResults.map(r => r.latency));
        const maxLatency = Math.max(...allResults.map(r => r.latency));
        
        log(`\n⏱️ Latências:`, 'blue');
        log(`   Média: ${avgLatency.toFixed(2)}ms`, 'cyan');
        log(`   Mín: ${minLatency.toFixed(2)}ms | Máx: ${maxLatency.toFixed(2)}ms`, 'cyan');
    }

    log(`\n${colors.bold}✅ Teste concluído!${colors.reset}\n`, 'green');
}

runTests().catch(error => {
    log(`\n❌ Erro fatal: ${error.message}`, 'red');
    process.exit(1);
});

