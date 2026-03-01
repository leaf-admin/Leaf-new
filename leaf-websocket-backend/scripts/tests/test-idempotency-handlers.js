/**
 * TESTE: Idempotency nos Handlers
 * 
 * Valida que idempotency está funcionando nos handlers principais.
 */

const io = require('socket.io-client');
const redisPool = require('../../utils/redis-pool');
const idempotencyService = require('../../services/idempotency-service');

const SERVER_URL = process.env.WEBSOCKET_URL || 'http://localhost:3000';
const TEST_TIMEOUT = 10000;

console.log('🧪 TESTE: Idempotency nos Handlers\n');
console.log('='.repeat(60));
console.log(`🌐 Servidor: ${SERVER_URL}\n`);

let passed = 0;
let failed = 0;
let socket = null;

async function test(name, fn) {
    try {
        await fn();
        console.log(`✅ ${name}`);
        passed++;
    } catch (error) {
        console.error(`❌ ${name}: ${error.message}`);
        console.error(`   Stack: ${error.stack}`);
        failed++;
    }
}

async function connectSocket() {
    return new Promise((resolve, reject) => {
        socket = io(SERVER_URL, {
            transports: ['websocket', 'polling'],
            reconnection: false,
            timeout: 5000
        });

        socket.on('connect', () => {
            console.log('✅ Socket conectado\n');
            resolve();
        });

        socket.on('connect_error', (error) => {
            console.error('❌ Erro ao conectar:', error.message);
            reject(error);
        });

        setTimeout(() => {
            if (!socket.connected) {
                reject(new Error('Timeout ao conectar'));
            }
        }, 5000);
    });
}

async function authenticate(userId, userType = 'customer') {
    return new Promise((resolve, reject) => {
        socket.emit('authenticate', { uid: userId, userType });
        
        socket.once('authenticated', (data) => {
            if (data.success) {
                resolve(data);
            } else {
                reject(new Error('Autenticação falhou'));
            }
        });

        socket.once('auth_error', (error) => {
            reject(new Error(error.message || 'Erro de autenticação'));
        });

        setTimeout(() => {
            reject(new Error('Timeout na autenticação'));
        }, 5000);
    });
}

async function clearIdempotencyKeys() {
    try {
        await redisPool.ensureConnection();
        // Limpar chaves de teste
        const testKeys = [
            'test_customer:createBooking',
            'test_customer:confirmPayment',
            'test_driver:acceptRide'
        ];
        
        for (const key of testKeys) {
            await idempotencyService.clearKey(key);
        }
    } catch (error) {
        console.warn('⚠️ Erro ao limpar chaves:', error.message);
    }
}

async function runTests() {
    try {
        // Garantir conexão Redis
        await redisPool.ensureConnection();
        console.log('✅ Redis conectado\n');

        // Conectar socket
        await connectSocket();

        // Limpar chaves de teste
        await clearIdempotencyKeys();

        // Teste 1: createBooking - Primeira requisição deve funcionar
        await test('createBooking - Primeira requisição deve ser processada', async () => {
            const testId = `test_${Date.now()}`;
            const idempotencyKey = `test_customer:createBooking:${testId}`;
            
            // Limpar chave antes
            await idempotencyService.clearKey(idempotencyKey);
            
            // Autenticar
            await authenticate('test_customer', 'customer');
            
            // Criar booking
            const bookingData = {
                pickupLocation: { lat: -23.5505, lng: -46.6333, address: 'Test Pickup' },
                destinationLocation: { lat: -23.5515, lng: -46.6343, address: 'Test Destination' },
                estimatedFare: 25.50,
                paymentMethod: 'pix',
                idempotencyKey: idempotencyKey
            };
            
            const response = await new Promise((resolve, reject) => {
                socket.emit('createBooking', bookingData);
                
                socket.once('bookingCreated', (data) => {
                    resolve(data);
                });
                
                socket.once('bookingError', (error) => {
                    reject(new Error(error.message || 'Erro ao criar booking'));
                });
                
                setTimeout(() => {
                    reject(new Error('Timeout ao criar booking'));
                }, TEST_TIMEOUT);
            });
            
            if (!response.success || !response.bookingId) {
                throw new Error('Booking não foi criado corretamente');
            }
        });

        // Teste 2: createBooking - Requisição duplicada deve retornar cached
        await test('createBooking - Requisição duplicada deve retornar resultado cached', async () => {
            const testId = `test_${Date.now()}`;
            const idempotencyKey = `test_customer:createBooking:${testId}`;
            
            // Limpar chave antes
            await idempotencyService.clearKey(idempotencyKey);
            
            // Primeira requisição
            const bookingData = {
                pickupLocation: { lat: -23.5505, lng: -46.6333, address: 'Test Pickup' },
                destinationLocation: { lat: -23.5515, lng: -46.6343, address: 'Test Destination' },
                estimatedFare: 25.50,
                paymentMethod: 'pix',
                idempotencyKey: idempotencyKey
            };
            
            const firstResponse = await new Promise((resolve, reject) => {
                socket.emit('createBooking', bookingData);
                
                socket.once('bookingCreated', (data) => {
                    resolve(data);
                });
                
                socket.once('bookingError', (error) => {
                    reject(new Error(error.message));
                });
                
                setTimeout(() => {
                    reject(new Error('Timeout na primeira requisição'));
                }, TEST_TIMEOUT);
            });
            
            // Aguardar um pouco para garantir que foi processado
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Segunda requisição (duplicada)
            const secondResponse = await new Promise((resolve, reject) => {
                socket.emit('createBooking', bookingData);
                
                socket.once('bookingCreated', (data) => {
                    resolve(data);
                });
                
                socket.once('bookingError', (error) => {
                    if (error.code === 'DUPLICATE_REQUEST') {
                        // Isso também é válido (se ainda estiver processando)
                        resolve({ duplicate: true, error });
                    } else {
                        reject(new Error(error.message));
                    }
                });
                
                setTimeout(() => {
                    reject(new Error('Timeout na segunda requisição'));
                }, TEST_TIMEOUT);
            });
            
            // Verificar se retornou resultado cached ou erro de duplicata
            if (secondResponse.duplicate) {
                // OK - requisição duplicada detectada
                return;
            }
            
            // Se retornou bookingCreated, deve ser o mesmo bookingId
            if (secondResponse.bookingId !== firstResponse.bookingId) {
                throw new Error('Resultado cached não retornou o mesmo bookingId');
            }
        });

        // Teste 3: confirmPayment - Primeira requisição deve funcionar
        await test('confirmPayment - Primeira requisição deve ser processada', async () => {
            const testId = `test_${Date.now()}`;
            const idempotencyKey = `test_customer:confirmPayment:${testId}`;
            const bookingId = `booking_${Date.now()}`;
            
            // Limpar chave antes
            await idempotencyService.clearKey(idempotencyKey);
            
            const paymentData = {
                bookingId: bookingId,
                paymentId: `payment_${Date.now()}`,
                amount: 25.50,
                currency: 'BRL',
                status: 'PAID',
                paymentMethod: 'pix',
                idempotencyKey: idempotencyKey
            };
            
            const response = await new Promise((resolve, reject) => {
                socket.emit('confirmPayment', paymentData);
                
                socket.once('paymentConfirmed', (data) => {
                    resolve(data);
                });
                
                socket.once('paymentError', (error) => {
                    reject(new Error(error.message || 'Erro ao confirmar pagamento'));
                });
                
                setTimeout(() => {
                    reject(new Error('Timeout ao confirmar pagamento'));
                }, TEST_TIMEOUT);
            });
            
            if (!response.success) {
                throw new Error('Pagamento não foi confirmado corretamente');
            }
        });

        // Teste 4: confirmPayment - Requisição duplicada
        await test('confirmPayment - Requisição duplicada deve retornar resultado cached', async () => {
            const testId = `test_${Date.now()}`;
            const idempotencyKey = `test_customer:confirmPayment:${testId}`;
            const bookingId = `booking_${Date.now()}`;
            
            // Limpar chave antes
            await idempotencyService.clearKey(idempotencyKey);
            
            const paymentData = {
                bookingId: bookingId,
                paymentId: `payment_${Date.now()}`,
                amount: 25.50,
                currency: 'BRL',
                status: 'PAID',
                paymentMethod: 'pix',
                idempotencyKey: idempotencyKey
            };
            
            // Primeira requisição
            const firstResponse = await new Promise((resolve, reject) => {
                socket.emit('confirmPayment', paymentData);
                
                socket.once('paymentConfirmed', (data) => {
                    resolve(data);
                });
                
                socket.once('paymentError', (error) => {
                    reject(new Error(error.message));
                });
                
                setTimeout(() => {
                    reject(new Error('Timeout na primeira requisição'));
                }, TEST_TIMEOUT);
            });
            
            // Aguardar um pouco
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Segunda requisição (duplicada)
            const secondResponse = await new Promise((resolve, reject) => {
                socket.emit('confirmPayment', paymentData);
                
                socket.once('paymentConfirmed', (data) => {
                    resolve(data);
                });
                
                socket.once('paymentError', (error) => {
                    if (error.code === 'DUPLICATE_REQUEST') {
                        resolve({ duplicate: true, error });
                    } else {
                        reject(new Error(error.message));
                    }
                });
                
                setTimeout(() => {
                    reject(new Error('Timeout na segunda requisição'));
                }, TEST_TIMEOUT);
            });
            
            // Verificar se retornou resultado cached ou erro de duplicata
            if (secondResponse.duplicate) {
                return; // OK
            }
            
            if (secondResponse.bookingId !== firstResponse.bookingId) {
                throw new Error('Resultado cached não retornou o mesmo bookingId');
            }
        });

        // Limpeza final
        console.log('\n🧹 Limpando chaves de teste...');
        await clearIdempotencyKeys();

    } catch (error) {
        console.error('❌ Erro fatal:', error);
        failed++;
    } finally {
        if (socket) {
            socket.disconnect();
            console.log('\n🔌 Socket desconectado');
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n📊 RESULTADO: ${passed} passou, ${failed} falhou\n`);

    if (failed === 0) {
        console.log('✅ TODOS OS TESTES PASSARAM!');
        process.exit(0);
    } else {
        console.log('❌ ALGUNS TESTES FALHARAM!');
        process.exit(1);
    }
}

// Verificar se servidor está rodando
runTests().catch(error => {
    console.error('❌ Erro fatal:', error);
    console.error('\n💡 Dica: Certifique-se de que o servidor está rodando em', SERVER_URL);
    process.exit(1);
});

