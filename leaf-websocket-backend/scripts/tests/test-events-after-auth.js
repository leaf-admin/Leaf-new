#!/usr/bin/env node

/**
 * 🧪 TESTE DE EVENTOS DEPENDENTES DE AUTENTICAÇÃO
 * 
 * Este script testa eventos que dependem de autenticação para funcionar,
 * validando que não há mais problemas de timing após a correção das race conditions.
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

// Eventos que dependem de autenticação
const AUTH_DEPENDENT_EVENTS = [
    {
        name: 'createBooking',
        event: 'createBooking',
        userType: 'customer',
        response: 'bookingCreated',
        errorResponse: 'bookingError',
        testData: () => ({
            customerId: 'customer_test_001',
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5632, lng: -46.6544 },
            estimatedFare: 25.50,
            paymentMethod: 'pix'
        })
    },
    {
        name: 'confirmPayment',
        event: 'confirmPayment',
        userType: 'customer',
        response: 'paymentConfirmed',
        errorResponse: 'paymentError',
        testData: () => ({
            bookingId: `test_booking_${Date.now()}`,
            amount: 25.50,
            paymentId: `payment_${Date.now()}`
        })
    },
    {
        name: 'acceptRide',
        event: 'acceptRide',
        userType: 'driver',
        response: 'rideAccepted',
        errorResponse: 'acceptRideError',
        testData: () => ({
            bookingId: `test_booking_${Date.now()}`,
            rideId: `test_ride_${Date.now()}`
        })
    },
    {
        name: 'rejectRide',
        event: 'rejectRide',
        userType: 'driver',
        response: 'rideRejected',
        errorResponse: 'rejectRideError',
        testData: () => ({
            bookingId: `test_booking_${Date.now()}`,
            reason: 'Teste de rejeição'
        })
    },
    {
        name: 'startTrip',
        event: 'startTrip',
        userType: 'driver',
        response: 'tripStarted',
        errorResponse: 'tripStartError',
        testData: () => ({
            bookingId: `test_booking_${Date.now()}`,
            startLocation: { lat: -23.5505, lng: -46.6333 }
        })
    },
    {
        name: 'updateTripLocation',
        event: 'updateTripLocation',
        userType: 'driver',
        response: null,
        errorResponse: null,
        testData: () => ({
            bookingId: `test_booking_${Date.now()}`,
            lat: -23.5505,
            lng: -46.6333,
            heading: 0,
            speed: 0
        })
    },
    {
        name: 'completeTrip',
        event: 'completeTrip',
        userType: 'driver',
        response: 'tripCompleted',
        errorResponse: 'tripCompleteError',
        testData: () => ({
            bookingId: `test_booking_${Date.now()}`,
            endLocation: { lat: -23.5632, lng: -46.6544 }
        })
    },
    {
        name: 'updateDriverLocation',
        event: 'updateDriverLocation',
        userType: 'driver',
        response: 'locationUpdated',
        errorResponse: 'locationError',
        testData: () => ({
            lat: -23.5505,
            lng: -46.6333,
            heading: 0,
            speed: 0,
            timestamp: Date.now()
        })
    },
    {
        name: 'driverHeartbeat',
        event: 'driverHeartbeat',
        userType: 'driver',
        response: null,
        errorResponse: null,
        testData: () => ({
            lat: -23.5505,
            lng: -46.6333,
            tripStatus: 'idle',
            isInTrip: false
        })
    },
    {
        name: 'updateLocation',
        event: 'updateLocation',
        userType: 'driver',
        response: 'locationUpdated',
        errorResponse: 'error',
        testData: () => ({
            lat: -23.5505,
            lng: -46.6333,
            tripStatus: 'idle',
            isInTrip: false
        })
    },
    {
        name: 'cancelRide',
        event: 'cancelRide',
        userType: 'customer',
        response: 'rideCancelled',
        errorResponse: 'rideCancellationError',
        testData: () => ({
            bookingId: `test_booking_${Date.now()}`,
            reason: 'Teste de cancelamento'
        })
    },
    {
        name: 'setDriverStatus',
        event: 'setDriverStatus',
        userType: 'driver',
        response: 'driverStatusUpdated',
        errorResponse: 'driverStatusError',
        testData: () => ({
            status: 'online'
        })
    }
];

async function testEventAfterAuth(eventConfig, userId) {
    return new Promise((resolve) => {
        const socket = io(WS_URL, {
            transports: ['websocket', 'polling'],
            timeout: 15000
        });

        let connected = false;
        let authenticated = false;
        let eventEmitted = false;
        let responseReceived = false;
        let errorReceived = false;
        
        const timings = {
            connectStart: performance.now(),
            connectEnd: 0,
            authStart: 0,
            authEnd: 0,
            eventEmitStart: 0,
            eventEmitEnd: 0,
            responseStart: 0,
            responseEnd: 0
        };

        const timeout = setTimeout(() => {
            socket.disconnect();
            resolve({
                event: eventConfig.name,
                success: false,
                error: 'Timeout',
                timings,
                connected,
                authenticated,
                eventEmitted,
                responseReceived
            });
        }, 20000);

        socket.on('connect', () => {
            timings.connectEnd = performance.now();
            connected = true;
            log(`   ✅ Conectado em ${Math.round(timings.connectEnd - timings.connectStart)}ms`, 'green');
            
            // Autenticar imediatamente
            timings.authStart = performance.now();
            socket.emit('authenticate', { 
                uid: userId, 
                userType: eventConfig.userType 
            });
        });

        socket.once('authenticated', (authData) => {
            timings.authEnd = performance.now();
            authenticated = true;
            log(`   ✅ Autenticado em ${Math.round(timings.authEnd - timings.authStart)}ms`, 'green');
            
            // Aguardar um pouco para garantir que handler está pronto
            setTimeout(() => {
                timings.eventEmitStart = performance.now();
                eventEmitted = true;
                const testData = eventConfig.testData();
                log(`   📤 Emitindo '${eventConfig.event}'...`, 'cyan');
                socket.emit(eventConfig.event, testData);
                timings.eventEmitEnd = performance.now();
            }, 100);
        });

        socket.once('auth_error', (error) => {
            clearTimeout(timeout);
            socket.disconnect();
            resolve({
                event: eventConfig.name,
                success: false,
                error: `Erro de autenticação: ${error.message}`,
                timings,
                connected,
                authenticated: false,
                eventEmitted: false,
                responseReceived: false
            });
        });

        // Escutar resposta esperada
        if (eventConfig.response) {
            socket.once(eventConfig.response, (data) => {
                timings.responseEnd = performance.now();
                responseReceived = true;
                clearTimeout(timeout);
                socket.disconnect();
                resolve({
                    event: eventConfig.name,
                    success: true,
                    timings,
                    connected,
                    authenticated,
                    eventEmitted,
                    responseReceived,
                    data
                });
            });
        }

        // Escutar erro
        if (eventConfig.errorResponse) {
            socket.once(eventConfig.errorResponse, (error) => {
                timings.responseEnd = performance.now();
                errorReceived = true;
                clearTimeout(timeout);
                socket.disconnect();
                resolve({
                    event: eventConfig.name,
                    success: false,
                    error: error.message || error.error || 'Erro desconhecido',
                    timings,
                    connected,
                    authenticated,
                    eventEmitted,
                    responseReceived: false,
                    errorReceived: true,
                    errorData: error
                });
            });
        }

        // Para eventos sem resposta específica, aguardar um tempo e considerar sucesso se não houver erro
        if (!eventConfig.response && !eventConfig.errorResponse) {
            setTimeout(() => {
                if (!errorReceived) {
                    timings.responseEnd = performance.now();
                    responseReceived = true;
                    clearTimeout(timeout);
                    socket.disconnect();
                    resolve({
                        event: eventConfig.name,
                        success: true,
                        timings,
                        connected,
                        authenticated,
                        eventEmitted,
                        responseReceived: true
                    });
                }
            }, 2000);
        }

        socket.on('connect_error', (error) => {
            clearTimeout(timeout);
            resolve({
                event: eventConfig.name,
                success: false,
                error: `Erro de conexão: ${error.message}`,
                timings,
                connected: false,
                authenticated: false,
                eventEmitted: false,
                responseReceived: false
            });
        });
    });
}

async function runTests() {
    log(`\n${colors.bold}🧪 TESTE DE EVENTOS DEPENDENTES DE AUTENTICAÇÃO${colors.reset}`, 'cyan');
    log(`URL: ${WS_URL}`, 'blue');
    log(`Eventos a testar: ${AUTH_DEPENDENT_EVENTS.length}\n`, 'blue');

    const results = [];

    for (const eventConfig of AUTH_DEPENDENT_EVENTS) {
        const userId = `${eventConfig.userType}_test_001`;
        log(`\n${colors.bold}📊 Testando: ${eventConfig.name}${colors.reset}`, 'blue');
        log(`   Tipo: ${eventConfig.userType}`, 'cyan');
        log(`   Usuário: ${userId}`, 'cyan');

        const result = await testEventAfterAuth(eventConfig, userId);
        results.push(result);

        if (result.success) {
            const totalTime = Math.round(result.timings.responseEnd - result.timings.connectStart);
            const authTime = Math.round(result.timings.authEnd - result.timings.authStart);
            const eventTime = Math.round(result.timings.responseEnd - result.timings.eventEmitStart);
            
            log(`   ✅ Sucesso!`, 'green');
            log(`   ⏱️ Tempo total: ${totalTime}ms`, 'cyan');
            log(`   🔐 Autenticação: ${authTime}ms`, 'cyan');
            log(`   📤 Evento → Resposta: ${eventTime}ms`, 'cyan');
        } else {
            log(`   ❌ Falha: ${result.error}`, 'red');
            if (result.connected) log(`   📡 Conectado: ✅`, 'yellow');
            if (result.authenticated) log(`   🔐 Autenticado: ✅`, 'yellow');
            if (result.eventEmitted) log(`   📤 Evento emitido: ✅`, 'yellow');
            if (result.errorData) log(`   📦 Erro: ${JSON.stringify(result.errorData).substring(0, 100)}...`, 'yellow');
        }

        // Pequeno delay entre testes
        await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Relatório final
    log(`\n${colors.bold}📊 RELATÓRIO FINAL${colors.reset}`, 'cyan');
    log(`================================`, 'cyan');

    const successes = results.filter(r => r.success).length;
    const failures = results.filter(r => !r.success).length;
    const total = results.length;

    log(`\n✅ Sucessos: ${successes}/${total}`, successes === total ? 'green' : 'yellow');
    log(`❌ Falhas: ${failures}/${total}`, failures === 0 ? 'green' : 'red');

    // Estatísticas de timing
    const successfulResults = results.filter(r => r.success);
    if (successfulResults.length > 0) {
        const avgTotalTime = successfulResults.reduce((sum, r) => {
            return sum + (r.timings.responseEnd - r.timings.connectStart);
        }, 0) / successfulResults.length;

        const avgAuthTime = successfulResults.reduce((sum, r) => {
            return sum + (r.timings.authEnd - r.timings.authStart);
        }, 0) / successfulResults.length;

        const avgEventTime = successfulResults.reduce((sum, r) => {
            return sum + (r.timings.responseEnd - r.timings.eventEmitStart);
        }, 0) / successfulResults.length;

        log(`\n⏱️ Latências Médias:`, 'blue');
        log(`   Tempo total (connect → resposta): ${avgTotalTime.toFixed(2)}ms`, 'cyan');
        log(`   Autenticação: ${avgAuthTime.toFixed(2)}ms`, 'cyan');
        log(`   Evento → Resposta: ${avgEventTime.toFixed(2)}ms`, 'cyan');
    }

    // Análise de problemas
    const connectionFailures = results.filter(r => !r.connected);
    const authFailures = results.filter(r => r.connected && !r.authenticated);
    const eventFailures = results.filter(r => r.authenticated && !r.responseReceived);

    if (connectionFailures.length > 0) {
        log(`\n⚠️ Falhas de Conexão: ${connectionFailures.length}`, 'yellow');
        connectionFailures.forEach(r => {
            log(`   - ${r.event}: ${r.error}`, 'yellow');
        });
    }

    if (authFailures.length > 0) {
        log(`\n⚠️ Falhas de Autenticação: ${authFailures.length}`, 'yellow');
        authFailures.forEach(r => {
            log(`   - ${r.event}: ${r.error}`, 'yellow');
        });
    }

    if (eventFailures.length > 0) {
        log(`\n⚠️ Falhas de Evento: ${eventFailures.length}`, 'yellow');
        eventFailures.forEach(r => {
            log(`   - ${r.event}: ${r.error}`, 'yellow');
        });
    }

    // Detalhes por evento
    log(`\n${colors.bold}📋 Detalhes por Evento:${colors.reset}`, 'cyan');
    results.forEach(r => {
        const status = r.success ? '✅' : '❌';
        const color = r.success ? 'green' : 'red';
        log(`   ${status} ${r.event}`, color);
        if (r.success) {
            const totalTime = Math.round(r.timings.responseEnd - r.timings.connectStart);
            log(`      Tempo total: ${totalTime}ms`, 'cyan');
        } else {
            log(`      Erro: ${r.error}`, 'yellow');
        }
    });

    log(`\n${colors.bold}✅ Teste concluído!${colors.reset}\n`, 'green');
}

runTests().catch(error => {
    log(`\n❌ Erro fatal: ${error.message}`, 'red');
    log(`Stack: ${error.stack}`, 'red');
    process.exit(1);
});

