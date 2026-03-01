#!/usr/bin/env node

/**
 * 🧪 TESTE SIMPLES DE LISTENERS
 * 
 * Testa se os listeners estão registrados e funcionando
 * 
 * Uso: node scripts/tests/test-listeners-simples.js
 */

const io = require('socket.io-client');

// Cores ANSI
const colors = {
    reset: '\x1b[0m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    bold: '\x1b[1m'
};

const WS_URL = process.env.WS_URL || 'http://147.93.66.253:3001'; // VPS

const log = {
    info: (msg) => console.log(colors.blue(`ℹ️  ${msg}`)),
    success: (msg) => console.log(colors.green(`✅ ${msg}`)),
    error: (msg) => console.log(colors.red(`❌ ${msg}`)),
    test: (msg) => console.log(colors.cyan(`🧪 ${msg}`))
};

// Lista de eventos esperados
const EXPECTED_EVENTS = {
    customer: [
        'authenticated',
        'bookingCreated',
        'bookingError',
        'rideAccepted',
        'paymentConfirmed',
        'paymentError',
        'tripStarted',
        'tripCompleted',
        'rideCancelled',
        'ratingSubmitted',
        'driverLocation',
        'newMessage'
    ],
    driver: [
        'authenticated',
        'driverStatusUpdated',
        'locationUpdated',
        'newRideRequest',
        'rideAccepted',
        'rideRejected',
        'acceptRideError',
        'tripStarted',
        'tripCompleted',
        'paymentDistributed',
        'rideCancelled',
        'ratingSubmitted',
        'newMessage'
    ]
};

async function testListeners(userType) {
    return new Promise((resolve, reject) => {
        log.test(`\nTestando listeners para ${userType}...`);
        
        const userId = `${userType}_test_${Date.now()}`;
        const socket = io(WS_URL, {
            transports: ['websocket', 'polling'],
            reconnection: false
        });

        const receivedEvents = new Set();
        const missingEvents = [];
        let authenticated = false;

        socket.on('connect', () => {
            log.info(`${userType} conectado`);
            
            // Autenticar
            socket.emit('authenticate', {
                uid: userId,
                userType: userType
            });
        });

        socket.on('authenticated', (data) => {
            authenticated = true;
            receivedEvents.add('authenticated');
            log.success('Autenticado');
            
            // Aguardar um pouco para receber outros eventos
            setTimeout(() => {
                checkResults();
            }, 3000);
        });

        // Registrar listener para TODOS os eventos
        const expectedEvents = EXPECTED_EVENTS[userType] || [];
        expectedEvents.forEach(eventName => {
            socket.on(eventName, (data) => {
                receivedEvents.add(eventName);
                log.success(`  ✅ Recebido: ${eventName}`);
            });
        });

        // Capturar qualquer evento não esperado
        socket.onAny((eventName, data) => {
                if (!expectedEvents.includes(eventName)) {
                log.info(`  📡 Evento não esperado: ${eventName}`);
            }
        });

        function checkResults() {
            const expected = EXPECTED_EVENTS[userType] || [];
            expected.forEach(event => {
                if (!receivedEvents.has(event)) {
                    missingEvents.push(event);
                }
            });

            console.log(`\n${colors.bold}Resultados:${colors.reset}`);
            console.log(`  Total esperado: ${expected.length}`);
            console.log(`  Recebidos: ${receivedEvents.size}`);
            console.log(`  Faltando: ${missingEvents.length}`);

            if (missingEvents.length > 0) {
                console.log(`\n${colors.yellow}Eventos não recebidos:${colors.reset}`);
                missingEvents.forEach(event => {
                    console.log(`  - ${event}`);
                });
            }

            socket.disconnect();
            resolve({
                total: expected.length,
                received: receivedEvents.size,
                missing: missingEvents.length,
                missingEvents
            });
        }

        socket.on('connect_error', (error) => {
            log.error(`Erro ao conectar: ${error.message}`);
            reject(error);
        });

        // Timeout
        setTimeout(() => {
            if (!authenticated) {
                log.error('Timeout na autenticação');
                socket.disconnect();
                reject(new Error('Timeout'));
            }
        }, 10000);
    });
}

async function runTests() {
    console.log(`${colors.bold}${colors.cyan}🧪 TESTE DE LISTENERS${colors.reset}\n`);

    try {
        const customerResult = await testListeners('customer');
        const driverResult = await testListeners('driver');

        console.log('\n' + '='.repeat(80));
        console.log(`${colors.bold}${colors.cyan}📊 RESUMO FINAL${colors.reset}`);
        console.log('='.repeat(80));
        
        console.log(`\n${colors.bold}Passageiro:${colors.reset}`);
        console.log(`  Total: ${customerResult.total}`);
        console.log(`  Recebidos: ${customerResult.received}`);
        console.log(`  Faltando: ${customerResult.missing}`);
        
        console.log(`\n${colors.bold}Motorista:${colors.reset}`);
        console.log(`  Total: ${driverResult.total}`);
        console.log(`  Recebidos: ${driverResult.received}`);
        console.log(`  Faltando: ${driverResult.missing}`);

        const totalExpected = customerResult.total + driverResult.total;
        const totalReceived = customerResult.received + driverResult.received;
        const successRate = ((totalReceived / totalExpected) * 100).toFixed(2);

        console.log(`\n${colors.bold}Taxa de Sucesso:${colors.reset} ${successRate}%`);

    } catch (error) {
        log.error(`Erro: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    runTests();
}

module.exports = { testListeners };

