#!/usr/bin/env node

/**
 * 🔍 DIAGNÓSTICO DETALHADO - createBooking
 * 
 * Este script testa cada etapa do createBooking isoladamente
 * para identificar exatamente onde está falhando.
 */

const io = require('socket.io-client');
const validationService = require('../../services/validation-service');
const geofenceService = require('../../services/geofence-service');

// Configuração
const WS_URL = process.env.WS_URL || 'http://localhost:3001'; // Local Docker

// Cores
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function diagnosticoCompleto() {
    log('\n🔍 DIAGNÓSTICO DETALHADO - createBooking\n', 'cyan');
    log('='.repeat(70), 'cyan');

    // Dados de teste
    const bookingData = {
        customerId: 'customer_test_001',
        pickupLocation: {
            lat: -23.5505,
            lng: -46.6333
        },
        destinationLocation: {
            lat: -23.5615,
            lng: -46.6553
        },
        estimatedFare: 25.50,
        paymentMethod: 'pix'
    };

    // 1. Testar validação local
    log('\n1️⃣ TESTANDO VALIDAÇÃO LOCAL...', 'blue');
    try {
        const validation = validationService.validateEndpoint('createBooking', bookingData);
        if (validation.valid) {
            log('   ✅ Validação: OK', 'green');
            log(`   Dados sanitizados: ${JSON.stringify(validation.sanitized, null, 2)}`, 'cyan');
        } else {
            log('   ❌ Validação falhou:', 'red');
            validation.errors.forEach(err => {
                log(`   - ${err.field}: ${err.error}`, 'red');
            });
            return;
        }
    } catch (error) {
        log(`   ❌ Erro na validação: ${error.message}`, 'red');
        log(`   Stack: ${error.stack}`, 'red');
        return;
    }

    // 2. Testar Geofence
    log('\n2️⃣ TESTANDO GEOFENCE...', 'blue');
    try {
        if (geofenceService.isActive()) {
            const geofenceValidation = geofenceService.validateRideLocations(
                bookingData.pickupLocation,
                bookingData.destinationLocation
            );
            if (geofenceValidation.valid) {
                log('   ✅ Geofence: OK', 'green');
            } else {
                log(`   ❌ Geofence falhou: ${geofenceValidation.error}`, 'red');
                return;
            }
        } else {
            log('   ⚠️ Geofence não está ativo', 'yellow');
        }
    } catch (error) {
        log(`   ❌ Erro no Geofence: ${error.message}`, 'red');
        log(`   Stack: ${error.stack}`, 'red');
        return;
    }

    // 3. Testar conexão WebSocket
    log('\n3️⃣ TESTANDO CONEXÃO WEBSOCKET...', 'blue');
    const socket = io(WS_URL, {
        transports: ['websocket', 'polling'],
        timeout: 15000,
        reconnection: false // Desabilitar reconexão automática para testes
    });

    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout ao conectar'));
        }, 15000);

        socket.on('connect', () => {
            clearTimeout(timeout);
            log(`   ✅ Conectado ao WebSocket (ID: ${socket.id})`, 'green');
            resolve();
        });

        socket.on('connect_error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });

        socket.on('disconnect', (reason) => {
            log(`   ⚠️ Desconectado: ${reason}`, 'yellow');
        });
    });

    // 4. Testar autenticação
    log('\n4️⃣ TESTANDO AUTENTICAÇÃO...', 'blue');
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout na autenticação'));
        }, 15000); // Aumentado para 15s

        // Registrar listeners ANTES de emitir
        socket.once('authenticated', (response) => {
            clearTimeout(timeout);
            log('   ✅ Autenticado', 'green');
            resolve(response);
        });

        socket.once('auth_error', (error) => {
            clearTimeout(timeout);
            reject(new Error(error.message || 'Erro de autenticação'));
        });

        // Emitir evento após registrar listeners
        log('   📤 Emitindo authenticate...', 'cyan');
        socket.emit('authenticate', {
            uid: bookingData.customerId,
            userType: 'customer'
        });
    });

    // 5. Testar createBooking com logs detalhados
    log('\n5️⃣ TESTANDO createBooking...', 'blue');
    log(`   Dados enviados: ${JSON.stringify(bookingData, null, 2)}`, 'cyan');

    // Registrar todos os eventos possíveis
    socket.on('bookingCreated', (response) => {
        log('   ✅ bookingCreated recebido:', 'green');
        log(`   ${JSON.stringify(response, null, 2)}`, 'cyan');
    });

    socket.on('bookingError', (error) => {
        log('   ❌ bookingError recebido:', 'red');
        log(`   ${JSON.stringify(error, null, 2)}`, 'red');
    });

    socket.on('error', (error) => {
        log('   ❌ error recebido:', 'red');
        log(`   ${JSON.stringify(error, null, 2)}`, 'red');
    });

    // Emitir createBooking
    try {
        const response = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout ao criar booking'));
            }, 15000);

            socket.once('bookingCreated', (response) => {
                clearTimeout(timeout);
                resolve(response);
            });

            socket.once('bookingError', (error) => {
                clearTimeout(timeout);
                reject(new Error(error.error || error.message || 'Erro ao criar booking'));
            });

            log('   📤 Emitindo createBooking...', 'cyan');
            socket.emit('createBooking', bookingData);
        });

        log('   ✅ createBooking: SUCESSO!', 'green');
        log(`   Response: ${JSON.stringify(response, null, 2)}`, 'cyan');
    } catch (error) {
        log(`   ❌ createBooking: FALHOU - ${error.message}`, 'red');
        log(`   Stack: ${error.stack}`, 'red');
    }

    // 6. Aguardar um pouco para ver se há mais eventos
    log('\n6️⃣ Aguardando eventos adicionais (5s)...', 'blue');
    await new Promise(resolve => setTimeout(resolve, 5000));

    // 7. Fechar conexão
    socket.disconnect();
    log('\n✅ Diagnóstico concluído!\n', 'green');
}

// Executar
diagnosticoCompleto().catch(error => {
    log(`\n❌ Erro fatal: ${error.message}`, 'red');
    log(`Stack: ${error.stack}`, 'red');
    process.exit(1);
});

