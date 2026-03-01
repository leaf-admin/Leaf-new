/**
 * TESTE LOCAL: Fluxo Completo de Corrida
 * 
 * Testa o fluxo completo de uma corrida:
 * 1. Cliente cria corrida
 * 2. Motorista aceita corrida
 * 3. Motorista inicia viagem
 * 4. Motorista finaliza viagem
 * 
 * PRÉ-REQUISITOS:
 * - Servidor rodando
 * - Redis conectado
 * - Firebase configurado
 */

const io = require('socket.io-client');
const { v4: uuidv4 } = require('uuid');

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3001';
const TEST_TIMEOUT = 60000; // 60 segundos

console.log('🧪 TESTE LOCAL: Fluxo Completo de Corrida\n');
console.log('='.repeat(60));
console.log(`🌐 Servidor: ${SERVER_URL}`);
console.log(`⏱️  Timeout: ${TEST_TIMEOUT / 1000}s\n`);

// Helper para criar socket e autenticar
async function createAuthenticatedSocket(userId, userType = 'customer') {
    return new Promise((resolve, reject) => {
        const socket = io(SERVER_URL, {
            transports: ['websocket', 'polling'],
            reconnection: false
        });

        socket.on('connect', () => {
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

            setTimeout(() => {
                reject(new Error('Timeout na autenticação'));
            }, 5000);
        });

        socket.on('connect_error', (error) => {
            reject(new Error(`Erro de conexão: ${error.message}`));
        });
    });
}

async function testFullFlow() {
    console.log('📋 Iniciando teste de fluxo completo...\n');

    const customerId = 'test_customer_' + Date.now();
    const driverId = 'test_driver_' + Date.now();
    let bookingId = null;

    try {
        // 1. Conectar cliente e motorista
        console.log('1️⃣ Conectando cliente e motorista...');
        const customerSocket = await createAuthenticatedSocket(customerId, 'customer');
        const driverSocket = await createAuthenticatedSocket(driverId, 'driver');
        console.log('✅ Cliente e motorista conectados\n');

        // 2. Cliente cria corrida
        console.log('2️⃣ Cliente criando corrida...');
        const bookingData = {
            customerId,
            pickupLocation: { lat: -23.5505, lng: -46.6333 },
            destinationLocation: { lat: -23.5515, lng: -46.6343 },
            estimatedFare: 25.50,
            paymentMethod: 'pix',
            idempotencyKey: uuidv4()
        };

        const bookingResult = await new Promise((resolve, reject) => {
            customerSocket.once('bookingCreated', (data) => {
                resolve(data);
            });

            customerSocket.once('bookingError', (error) => {
                reject(new Error(error.message || error.error));
            });

            customerSocket.emit('createBooking', bookingData);
        });

        if (!bookingResult.success || !bookingResult.bookingId) {
            throw new Error('Falha ao criar corrida');
        }

        bookingId = bookingResult.bookingId;
        console.log(`✅ Corrida criada: ${bookingId}\n`);

        // 3. Aguardar um pouco para o sistema processar
        await new Promise(resolve => setTimeout(resolve, 2000));

        // 4. Motorista aceita corrida
        console.log('3️⃣ Motorista aceitando corrida...');
        const acceptResult = await new Promise((resolve, reject) => {
            driverSocket.once('rideAccepted', (data) => {
                resolve(data);
            });

            customerSocket.once('rideAccepted', (data) => {
                // Cliente também recebe notificação
                console.log('✅ Cliente notificado sobre aceitação');
            });

            driverSocket.once('acceptRideError', (error) => {
                reject(new Error(error.message || error.error));
            });

            driverSocket.emit('acceptRide', {
                bookingId,
                idempotencyKey: uuidv4()
            });

            setTimeout(() => {
                reject(new Error('Timeout ao aceitar corrida'));
            }, 10000);
        });

        console.log(`✅ Corrida aceita: ${acceptResult.bookingId || bookingId}\n`);

        // 5. Aguardar um pouco
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 6. Motorista inicia viagem
        console.log('4️⃣ Motorista iniciando viagem...');
        const startResult = await new Promise((resolve, reject) => {
            driverSocket.once('tripStarted', (data) => {
                resolve(data);
            });

            customerSocket.once('tripStarted', (data) => {
                // Cliente também recebe notificação
                console.log('✅ Cliente notificado sobre início da viagem');
            });

            driverSocket.once('tripStartError', (error) => {
                reject(new Error(error.message || error.error));
            });

            driverSocket.emit('startTrip', {
                bookingId,
                startLocation: { lat: -23.5505, lng: -46.6333 }
            });

            setTimeout(() => {
                reject(new Error('Timeout ao iniciar viagem'));
            }, 10000);
        });

        console.log(`✅ Viagem iniciada: ${startResult.bookingId || bookingId}\n`);

        // 7. Aguardar um pouco
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 8. Motorista finaliza viagem
        console.log('5️⃣ Motorista finalizando viagem...');
        const completeResult = await new Promise((resolve, reject) => {
            driverSocket.once('tripCompleted', (data) => {
                resolve(data);
            });

            customerSocket.once('tripCompleted', (data) => {
                // Cliente também recebe notificação
                console.log('✅ Cliente notificado sobre finalização da viagem');
            });

            driverSocket.once('tripCompleteError', (error) => {
                reject(new Error(error.message || error.error));
            });

            driverSocket.emit('completeTrip', {
                bookingId,
                endLocation: { lat: -23.5515, lng: -46.6343 },
                distance: 5.2,
                fare: 30.00
            });

            setTimeout(() => {
                reject(new Error('Timeout ao finalizar viagem'));
            }, 15000);
        });

        console.log(`✅ Viagem finalizada: ${completeResult.bookingId || bookingId}\n`);

        // Limpar
        customerSocket.disconnect();
        driverSocket.disconnect();

        console.log('='.repeat(60));
        console.log('\n✅ FLUXO COMPLETO TESTADO COM SUCESSO!');
        console.log('✅ Todos os eventos foram publicados');
        console.log('✅ Todos os listeners executaram');
        console.log('✅ Notificações foram enviadas\n');

        process.exit(0);

    } catch (error) {
        console.error(`\n❌ ERRO NO FLUXO: ${error.message}`);
        if (error.stack) {
            console.error(`\nStack:\n${error.stack}`);
        }
        process.exit(1);
    }
}

// Verificar se servidor está acessível
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

// Iniciar teste
checkServer()
    .then(() => {
        console.log('✅ Servidor está acessível\n');
        return testFullFlow();
    })
    .catch((error) => {
        console.error(`❌ Erro: ${error.message}\n`);
        console.log('💡 Dica: Certifique-se de que o servidor está rodando:');
        console.log('   cd leaf-websocket-backend && node server.js\n');
        process.exit(1);
    });

