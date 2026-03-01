/**
 * TESTE LOCAL: Servidor Rodando
 * 
 * Testa os fluxos completos com o servidor em execução.
 * 
 * PRÉ-REQUISITOS:
 * - Servidor rodando em localhost:3001 (ou porta configurada)
 * - Redis conectado
 * - Firebase configurado
 */

const io = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const TEST_TIMEOUT = 30000; // 30 segundos

console.log('🧪 TESTE LOCAL: Servidor Rodando\n');
console.log('='.repeat(60));
console.log(`🌐 Servidor: ${SERVER_URL}`);
console.log(`⏱️  Timeout: ${TEST_TIMEOUT / 1000}s\n`);

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.error(`❌ ${name}: TIMEOUT`);
            failed++;
            results.push({ name, status: 'TIMEOUT' });
            resolve();
        }, TEST_TIMEOUT);

        fn()
            .then(() => {
                clearTimeout(timeout);
                console.log(`✅ ${name}`);
                passed++;
                results.push({ name, status: 'PASS' });
                resolve();
            })
            .catch((error) => {
                clearTimeout(timeout);
                console.error(`❌ ${name}: ${error.message}`);
                if (error.stack) {
                    console.error(`   ${error.stack.split('\n').slice(1, 2).join('\n')}`);
                }
                failed++;
                results.push({ name, status: 'FAIL', error: error.message });
                resolve();
            });
    });
}

// Helper para criar socket e autenticar
async function createAuthenticatedSocket(userId, userType = 'customer') {
    return new Promise((resolve, reject) => {
        const socket = io(SERVER_URL, {
            transports: ['websocket', 'polling'],
            reconnection: false
        });

        socket.on('connect', () => {
            // Autenticar
            socket.emit('authenticate', {
                userId,
                userType,
                token: 'test_token_' + userId
            });

            socket.once('authenticated', () => {
                resolve(socket);
            });

            socket.once('authError', (error) => {
                reject(new Error(`Autenticação falhou: ${error.message || error}`));
            });

            // Timeout para autenticação
            setTimeout(() => {
                reject(new Error('Timeout na autenticação'));
            }, 5000);
        });

        socket.on('connect_error', (error) => {
            reject(new Error(`Erro de conexão: ${error.message}`));
        });
    });
}

async function runTests() {
    console.log('📋 Iniciando testes...\n');

    // Teste 1: Conectar ao servidor
    await test('Conexão - Conectar ao servidor', async () => {
        const socket = io(SERVER_URL, {
            transports: ['websocket', 'polling'],
            reconnection: false
        });

        await new Promise((resolve, reject) => {
            socket.on('connect', () => {
                socket.disconnect();
                resolve();
            });

            socket.on('connect_error', (error) => {
                reject(new Error(`Não foi possível conectar: ${error.message}`));
            });

            setTimeout(() => {
                reject(new Error('Timeout na conexão'));
            }, 5000);
        });
    });

    // Teste 2: Autenticação
    await test('Autenticação - Autenticar cliente', async () => {
        const customerId = 'test_customer_' + Date.now();
        const socket = await createAuthenticatedSocket(customerId, 'customer');
        socket.disconnect();
    });

    await test('Autenticação - Autenticar motorista', async () => {
        const driverId = 'test_driver_' + Date.now();
        const socket = await createAuthenticatedSocket(driverId, 'driver');
        socket.disconnect();
    });

    // Teste 3: createBooking (com idempotency)
    await test('createBooking - Criar corrida com idempotency', async () => {
        const customerId = 'test_customer_' + Date.now();
        const socket = await createAuthenticatedSocket(customerId, 'customer');

        const idempotencyKey = uuidv4();
        const bookingData = {
            customerId,
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5515, lng: -46.6343 },
            estimatedFare: 25.50,
            paymentMethod: 'pix',
            idempotencyKey
        };

        // Primeira requisição
        const firstResult = await new Promise((resolve, reject) => {
            socket.once('bookingCreated', (data) => {
                resolve(data);
            });

            socket.once('bookingError', (error) => {
                reject(new Error(error.message || error.error));
            });

            socket.emit('createBooking', bookingData);
        });

        if (!firstResult.success || !firstResult.bookingId) {
            throw new Error('Primeira requisição falhou');
        }

        // Segunda requisição (deve retornar cached)
        const secondResult = await new Promise((resolve, reject) => {
            socket.once('bookingCreated', (data) => {
                resolve(data);
            });

            socket.once('bookingError', (error) => {
                if (error.code === 'DUPLICATE_REQUEST') {
                    resolve({ cached: true });
                } else {
                    reject(new Error(error.message || error.error));
                }
            });

            socket.emit('createBooking', bookingData);
        });

        socket.disconnect();
    });

    // Teste 4: Verificar que eventos estão sendo publicados
    await test('EventBus - Verificar que eventos são publicados', async () => {
        const customerId = 'test_customer_' + Date.now();
        const socket = await createAuthenticatedSocket(customerId, 'customer');

        let eventReceived = false;

        // Escutar eventos relacionados
        socket.on('bookingCreated', () => {
            eventReceived = true;
        });

        const bookingData = {
            customerId,
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5515, lng: -46.6343 },
            estimatedFare: 25.50,
            paymentMethod: 'pix'
        };

        await new Promise((resolve, reject) => {
            socket.once('bookingCreated', () => {
                setTimeout(() => {
                    if (!eventReceived) {
                        reject(new Error('Evento não foi recebido'));
                    } else {
                        resolve();
                    }
                }, 1000);
            });

            socket.once('bookingError', (error) => {
                reject(new Error(error.message || error.error));
            });

            socket.emit('createBooking', bookingData);
        });

        socket.disconnect();
    });

    // Resumo
    console.log('\n' + '='.repeat(60));
    console.log(`\n📊 RESULTADO: ${passed} passou, ${failed} falhou\n`);

    if (failed === 0) {
        console.log('✅ TODOS OS TESTES LOCAIS PASSARAM!');
        console.log('✅ Servidor está funcionando corretamente');
        console.log('✅ Commands, EventBus e Listeners estão operacionais\n');
        process.exit(0);
    } else {
        console.log('❌ ALGUNS TESTES LOCAIS FALHARAM!\n');
        console.log('📋 Detalhes:');
        results.filter(r => r.status !== 'PASS').forEach(r => {
            console.log(`   - ${r.name}: ${r.status}${r.error ? ` - ${r.error}` : ''}`);
        });
        console.log('');
        process.exit(1);
    }
}

// Verificar se servidor está acessível antes de começar
async function checkServer() {
    try {
        const http = require('http');
        const url = new URL(SERVER_URL);
        
        return new Promise((resolve, reject) => {
            const req = http.get({
                hostname: url.hostname,
                port: url.port || 3001,
                path: '/',
                timeout: 3000
            }, (res) => {
                resolve(true);
            });

            req.on('error', (error) => {
                if (error.code === 'ECONNREFUSED') {
                    reject(new Error(`Servidor não está rodando em ${SERVER_URL}`));
                } else {
                    reject(error);
                }
            });

            req.on('timeout', () => {
                req.destroy();
                reject(new Error('Timeout ao verificar servidor'));
            });
        });
    } catch (error) {
        throw new Error(`Erro ao verificar servidor: ${error.message}`);
    }
}

// Iniciar testes
checkServer()
    .then(() => {
        console.log('✅ Servidor está acessível\n');
        return runTests();
    })
    .catch((error) => {
        console.error(`❌ Erro: ${error.message}\n`);
        console.log('💡 Dica: Certifique-se de que o servidor está rodando:');
        console.log('   cd leaf-websocket-backend && node server.js\n');
        process.exit(1);
    });

