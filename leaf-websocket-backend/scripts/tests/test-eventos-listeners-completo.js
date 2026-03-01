#!/usr/bin/env node

/**
 * 🧪 TESTE COMPLETO DE EVENTOS E LISTENERS WEBSOCKET
 * 
 * Este script testa:
 * - Todos os eventos emitidos pelo cliente
 * - Todos os eventos recebidos pelo cliente
 * - Todos os listeners registrados
 * - Comunicação bidirecional
 * - Timeouts e erros
 * 
 * Uso: node scripts/tests/test-eventos-listeners-completo.js
 */

const io = require('socket.io-client');

// Configuração
const WS_URL = process.env.WS_URL || 'http://localhost:3001'; // Local Docker
const TEST_TIMEOUT = 30000; // 30 segundos por teste

// Cores ANSI para logs
const colors = {
    reset: '\x1b[0m',
    blue: '\x1b[34m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m',
    bold: '\x1b[1m'
};

// Funções de log com cores
const log = {
    info: (msg) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
    success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
    error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
    warn: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
    test: (msg) => console.log(`${colors.cyan}🧪 ${msg}${colors.reset}`),
    event: (msg) => console.log(`${colors.magenta}📡 ${msg}${colors.reset}`)
};

// Estatísticas
const stats = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    events: {
        emitted: [],
        received: [],
        missing: []
    }
};

/**
 * Classe para testar eventos e listeners
 */
class EventListenerTester {
    constructor(userId, userType) {
        this.userId = userId;
        this.userType = userType;
        this.socket = null;
        this.connected = false;
        this.authenticated = false;
        this.receivedEvents = new Map(); // eventName -> [data1, data2, ...]
        this.expectedEvents = new Map(); // eventName -> {count, timeout, resolve}
        this.listeners = new Map(); // eventName -> [listener1, listener2, ...]
    }

    /**
     * Conectar ao servidor
     */
    async connect() {
        return new Promise((resolve, reject) => {
            log.info(`Conectando ${this.userType} ${this.userId}...`);
            
            this.socket = io(WS_URL, {
                transports: ['websocket', 'polling'],
                reconnection: false,
                timeout: 10000
            });

            this.socket.on('connect', () => {
                this.connected = true;
                log.success(`${this.userType} ${this.userId} conectado (${this.socket.id})`);
                resolve();
            });

            this.socket.on('connect_error', (error) => {
                log.error(`Erro ao conectar ${this.userId}: ${error.message}`);
                reject(error);
            });

            this.socket.on('disconnect', (reason) => {
                this.connected = false;
                log.warn(`${this.userType} ${this.userId} desconectado: ${reason}`);
            });

            // Registrar TODOS os eventos recebidos
            this.socket.onAny((eventName, data) => {
                if (!this.receivedEvents.has(eventName)) {
                    this.receivedEvents.set(eventName, []);
                }
                this.receivedEvents.get(eventName).push({
                    data,
                    timestamp: Date.now()
                });
                
                log.event(`📥 [${this.userType}] Recebido: ${eventName}`);
                
                // Verificar se era um evento esperado
                if (this.expectedEvents.has(eventName)) {
                    const expected = this.expectedEvents.get(eventName);
                    expected.count--;
                    if (expected.count <= 0) {
                        if (expected.resolve) {
                            expected.resolve(data);
                            this.expectedEvents.delete(eventName);
                        }
                    }
                }
            });

            setTimeout(() => {
                if (!this.connected) {
                    reject(new Error('Timeout de conexão'));
                }
            }, 10000);
        });
    }

    /**
     * Autenticar
     */
    async authenticate() {
        return new Promise((resolve, reject) => {
            log.test(`Autenticando ${this.userId}...`);
            
            this.expectEvent('authenticated', 1, 5000).then((data) => {
                this.authenticated = data.success === true;
                if (this.authenticated) {
                    log.success(`${this.userId} autenticado`);
                    resolve(data);
                } else {
                    reject(new Error('Autenticação falhou'));
                }
            }).catch(reject);

            this.socket.emit('authenticate', {
                uid: this.userId,
                userType: this.userType
            });
        });
    }

    /**
     * Esperar por um evento específico
     */
    expectEvent(eventName, count = 1, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.expectedEvents.delete(eventName);
                reject(new Error(`Timeout esperando evento ${eventName} (${timeout}ms)`));
            }, timeout);

            this.expectedEvents.set(eventName, {
                count,
                timeout: timer,
                resolve: (data) => {
                    clearTimeout(timer);
                    resolve(data);
                }
            });
        });
    }

    /**
     * Emitir evento e esperar resposta
     */
    async emitAndWait(eventName, data, expectedResponse, timeout = 5000) {
        return new Promise((resolve, reject) => {
            log.test(`Emitindo ${eventName}...`);
            
            const timer = setTimeout(() => {
                reject(new Error(`Timeout esperando resposta de ${eventName}`));
            }, timeout);

            // Registrar listener temporário
            const listener = (responseData) => {
                clearTimeout(timer);
                this.socket.off(expectedResponse, listener);
                
                if (responseData && responseData.error) {
                    log.error(`Erro na resposta: ${JSON.stringify(responseData, null, 2)}`);
                    reject(new Error(responseData.error || responseData.message || JSON.stringify(responseData)));
                } else {
                    resolve(responseData);
                }
            };
            
            // Também registrar listener para eventos de erro genéricos
            const errorListener = (errorData) => {
                log.error(`Erro recebido: ${JSON.stringify(errorData, null, 2)}`);
            };
            
            // Registrar listeners para possíveis eventos de erro
            const errorEvents = [
                `${eventName}Error`,
                'error',
                'bookingError',
                'driverStatusError',
                'acceptRideError',
                'tripStartError',
                'tripCompleteError'
            ];
            
            errorEvents.forEach(errEvent => {
                this.socket.once(errEvent, (errData) => {
                    if (errData && errData.error) {
                        clearTimeout(timer);
                        this.socket.off(expectedResponse, listener);
                        log.error(`Erro em ${errEvent}: ${JSON.stringify(errData, null, 2)}`);
                        reject(new Error(errData.error || errData.message || `Erro em ${errEvent}`));
                    }
                });
            });

            this.socket.once(expectedResponse, listener);
            this.socket.emit(eventName, data);
            
            stats.events.emitted.push({
                event: eventName,
                user: this.userId,
                timestamp: Date.now()
            });
        });
    }

    /**
     * Verificar se evento foi recebido
     */
    hasReceived(eventName) {
        return this.receivedEvents.has(eventName) && 
               this.receivedEvents.get(eventName).length > 0;
    }

    /**
     * Obter todos os eventos recebidos
     */
    getReceivedEvents() {
        return Array.from(this.receivedEvents.keys());
    }

    /**
     * Desconectar
     */
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.connected = false;
            log.info(`${this.userId} desconectado`);
        }
    }
}

/**
 * Testar eventos de autenticação
 */
async function testAuthentication() {
    log.test('\n📋 TESTE 1: AUTENTICAÇÃO');
    stats.total++;

    try {
        const customer = new EventListenerTester('customer_test_001', 'customer');
        await customer.connect();
        await customer.authenticate();

        const driver = new EventListenerTester('driver_test_001', 'driver');
        await driver.connect();
        await driver.authenticate();

        log.success('✅ Autenticação: PASSED');
        stats.passed++;

        return { customer, driver };
    } catch (error) {
        log.error(`❌ Autenticação: FAILED - ${error.message}`);
        stats.failed++;
        throw error;
    }
}

/**
 * Testar eventos de status do motorista
 */
async function testDriverStatus(driver) {
    log.test('\n📋 TESTE 2: STATUS DO MOTORISTA');
    stats.total++;

    try {
        // Testar setDriverStatus
        const statusResponse = await driver.emitAndWait(
            'setDriverStatus',
            {
                driverId: driver.userId,
                status: 'available',
                isOnline: true
            },
            'driverStatusUpdated',
            5000
        );

        if (!statusResponse || !statusResponse.success) {
            throw new Error('setDriverStatus não retornou sucesso');
        }

        // Testar updateLocation
        const locationResponse = await driver.emitAndWait(
            'updateLocation',
            {
                driverId: driver.userId,
                lat: -23.5505,
                lng: -46.6333,
                heading: 0,
                speed: 0
            },
            'locationUpdated',
            5000
        );

        if (!locationResponse || !locationResponse.success) {
            throw new Error('updateLocation não retornou sucesso');
        }

        log.success('✅ Status do Motorista: PASSED');
        stats.passed++;
    } catch (error) {
        log.error(`❌ Status do Motorista: FAILED - ${error.message}`);
        stats.failed++;
    }
}

/**
 * Testar criação de booking
 */
async function testCreateBooking(customer) {
    log.test('\n📋 TESTE 3: CRIAÇÃO DE BOOKING');
    stats.total++;

    try {
        const bookingData = {
            customerId: customer.userId,
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

        const response = await customer.emitAndWait(
            'createBooking',
            bookingData,
            'bookingCreated',
            10000
        );

        if (!response || !response.bookingId) {
            throw new Error('createBooking não retornou bookingId');
        }

        log.success(`✅ Criação de Booking: PASSED (bookingId: ${response.bookingId})`);
        stats.passed++;

        return response.bookingId;
    } catch (error) {
        log.error(`❌ Criação de Booking: FAILED - ${error.message}`);
        stats.failed++;
        throw error;
    }
}

/**
 * Testar notificação de corrida para motorista
 */
async function testNewRideRequest(driver, bookingId) {
    log.test('\n📋 TESTE 4: NOTIFICAÇÃO DE CORRIDA (newRideRequest)');
    stats.total++;

    try {
        // Esperar por newRideRequest (pode demorar devido ao QueueWorker)
        const response = await driver.expectEvent('newRideRequest', 1, 15000);

        if (!response || !response.bookingId) {
            throw new Error('newRideRequest não contém bookingId');
        }

        if (response.bookingId !== bookingId) {
            throw new Error(`bookingId não corresponde: esperado ${bookingId}, recebido ${response.bookingId}`);
        }

        log.success(`✅ Notificação de Corrida: PASSED`);
        stats.passed++;

        return response;
    } catch (error) {
        log.error(`❌ Notificação de Corrida: FAILED - ${error.message}`);
        stats.failed++;
        throw error;
    }
}

/**
 * Testar aceitação de corrida
 */
async function testAcceptRide(driver, customer, bookingId) {
    log.test('\n📋 TESTE 5: ACEITAÇÃO DE CORRIDA');
    stats.total++;

    try {
        // Motorista aceita
        const acceptResponse = await driver.emitAndWait(
            'acceptRide',
            { bookingId },
            'rideAccepted',
            10000
        );

        if (!acceptResponse || !acceptResponse.bookingId) {
            throw new Error('acceptRide não retornou bookingId');
        }

        // Passageiro deve receber rideAccepted
        const customerResponse = await customer.expectEvent('rideAccepted', 1, 5000);

        if (!customerResponse || customerResponse.bookingId !== bookingId) {
            throw new Error('Passageiro não recebeu rideAccepted');
        }

        log.success('✅ Aceitação de Corrida: PASSED');
        stats.passed++;

        return acceptResponse;
    } catch (error) {
        log.error(`❌ Aceitação de Corrida: FAILED - ${error.message}`);
        stats.failed++;
        throw error;
    }
}

/**
 * Testar confirmação de pagamento
 */
async function testConfirmPayment(customer, bookingId) {
    log.test('\n📋 TESTE 6: CONFIRMAÇÃO DE PAGAMENTO');
    stats.total++;

    try {
        const paymentData = {
            bookingId,
            paymentMethod: 'pix',
            amount: 25.50
        };

        const response = await customer.emitAndWait(
            'confirmPayment',
            paymentData,
            'paymentConfirmed',
            10000
        );

        if (!response || !response.bookingId) {
            throw new Error('confirmPayment não retornou bookingId');
        }

        log.success('✅ Confirmação de Pagamento: PASSED');
        stats.passed++;

        return response;
    } catch (error) {
        log.error(`❌ Confirmação de Pagamento: FAILED - ${error.message}`);
        stats.failed++;
        // Não falhar o teste completo se pagamento falhar (pode ser mock)
    }
}

/**
 * Testar início de viagem
 */
async function testStartTrip(driver, customer, bookingId) {
    log.test('\n📋 TESTE 7: INÍCIO DE VIAGEM');
    stats.total++;

    try {
        const startData = {
            bookingId,
            startLocation: {
                lat: -23.5505,
                lng: -46.6333
            }
        };

        const driverResponse = await driver.emitAndWait(
            'startTrip',
            startData,
            'tripStarted',
            10000
        );

        if (!driverResponse || !driverResponse.bookingId) {
            throw new Error('startTrip não retornou bookingId para motorista');
        }

        // Passageiro deve receber tripStarted
        const customerResponse = await customer.expectEvent('tripStarted', 1, 5000);

        if (!customerResponse || customerResponse.bookingId !== bookingId) {
            throw new Error('Passageiro não recebeu tripStarted');
        }

        log.success('✅ Início de Viagem: PASSED');
        stats.passed++;

        return driverResponse;
    } catch (error) {
        log.error(`❌ Início de Viagem: FAILED - ${error.message}`);
        stats.failed++;
        throw error;
    }
}

/**
 * Testar finalização de viagem
 */
async function testCompleteTrip(driver, customer, bookingId) {
    log.test('\n📋 TESTE 8: FINALIZAÇÃO DE VIAGEM');
    stats.total++;

    try {
        const completeData = {
            bookingId,
            endLocation: {
                lat: -23.5615,
                lng: -46.6553
            },
            distance: 5.2,
            fare: 25.50
        };

        const driverResponse = await driver.emitAndWait(
            'completeTrip',
            completeData,
            'tripCompleted',
            10000
        );

        if (!driverResponse || !driverResponse.bookingId) {
            throw new Error('completeTrip não retornou bookingId para motorista');
        }

        // Passageiro deve receber tripCompleted
        const customerResponse = await customer.expectEvent('tripCompleted', 1, 5000);

        if (!customerResponse || customerResponse.bookingId !== bookingId) {
            throw new Error('Passageiro não recebeu tripCompleted');
        }

        log.success('✅ Finalização de Viagem: PASSED');
        stats.passed++;

        return driverResponse;
    } catch (error) {
        log.error(`❌ Finalização de Viagem: FAILED - ${error.message}`);
        stats.failed++;
        throw error;
    }
}

/**
 * Testar avaliação
 */
async function testRating(customer, driver, bookingId) {
    log.test('\n📋 TESTE 9: AVALIAÇÃO');
    stats.total++;

    try {
        // Passageiro avalia motorista
        const customerRating = await customer.emitAndWait(
            'submitRating',
            {
                bookingId,
                rating: 5,
                comment: 'Ótimo motorista!'
            },
            'ratingSubmitted',
            5000
        );

        if (!customerRating || !customerRating.success) {
            throw new Error('Passageiro não recebeu confirmação de avaliação');
        }

        // Motorista avalia passageiro
        const driverRating = await driver.emitAndWait(
            'submitRating',
            {
                bookingId,
                rating: 5,
                comment: 'Ótimo passageiro!'
            },
            'ratingSubmitted',
            5000
        );

        if (!driverRating || !driverRating.success) {
            throw new Error('Motorista não recebeu confirmação de avaliação');
        }

        log.success('✅ Avaliação: PASSED');
        stats.passed++;
    } catch (error) {
        log.error(`❌ Avaliação: FAILED - ${error.message}`);
        stats.failed++;
    }
}

/**
 * Testar cancelamento
 */
async function testCancelRide(customer, bookingId) {
    log.test('\n📋 TESTE 10: CANCELAMENTO DE CORRIDA');
    stats.total++;

    try {
        const response = await customer.emitAndWait(
            'cancelRide',
            { bookingId },
            'rideCancelled',
            10000
        );

        if (!response || !response.bookingId) {
            throw new Error('cancelRide não retornou bookingId');
        }

        log.success('✅ Cancelamento: PASSED');
        stats.passed++;
    } catch (error) {
        log.error(`❌ Cancelamento: FAILED - ${error.message}`);
        stats.failed++;
        // Não falhar se cancelamento não funcionar (pode estar em estado incorreto)
    }
}

/**
 * Gerar relatório final
 */
function generateReport(customer, driver) {
    console.log('\n' + '='.repeat(80));
    console.log(`${colors.bold}${colors.cyan}📊 RELATÓRIO FINAL DE TESTES${colors.reset}`);
    console.log('='.repeat(80));

    console.log(`\n${colors.bold}Estatísticas:${colors.reset}`);
    console.log(`  Total de Testes: ${stats.total}`);
    console.log(`  ${colors.green}✅ Passed:${colors.reset} ${stats.passed}`);
    console.log(`  ${colors.red}❌ Failed:${colors.reset} ${stats.failed}`);
    console.log(`  ${colors.yellow}⏭️  Skipped:${colors.reset} ${stats.skipped}`);
    console.log(`  Taxa de Sucesso: ${((stats.passed / stats.total) * 100).toFixed(2)}%`);

    console.log(`\n${colors.bold}Eventos Emitidos:${colors.reset} ${stats.events.emitted.length}`);
    stats.events.emitted.forEach(event => {
        console.log(`  - ${event.event} (${event.user})`);
    });

    console.log(`\n${colors.bold}Eventos Recebidos pelo Passageiro:${colors.reset}`);
    const customerEvents = customer.getReceivedEvents();
    customerEvents.forEach(event => {
        const count = customer.receivedEvents.get(event).length;
        console.log(`  - ${event} (${count}x)`);
    });

    console.log(`\n${colors.bold}Eventos Recebidos pelo Motorista:${colors.reset}`);
    const driverEvents = driver.getReceivedEvents();
    driverEvents.forEach(event => {
        const count = driver.receivedEvents.get(event).length;
        console.log(`  - ${event} (${count}x)`);
    });

    // Verificar eventos esperados mas não recebidos
    const allExpectedEvents = [
        'authenticated',
        'bookingCreated',
        'newRideRequest',
        'rideAccepted',
        'paymentConfirmed',
        'tripStarted',
        'tripCompleted',
        'ratingSubmitted'
    ];

    console.log(`\n${colors.bold}Eventos Esperados vs Recebidos:${colors.reset}`);
    allExpectedEvents.forEach(eventName => {
        const customerReceived = customer.hasReceived(eventName);
        const driverReceived = driver.hasReceived(eventName);
        const status = (customerReceived || driverReceived) ? 
            `${colors.green}✅${colors.reset}` : `${colors.red}❌${colors.reset}`;
        console.log(`  ${status} ${eventName}`);
    });

    console.log('\n' + '='.repeat(80));
}

/**
 * Executar todos os testes
 */
async function runAllTests() {
    console.log(`${colors.bold}${colors.cyan}🧪 INICIANDO TESTES DE EVENTOS E LISTENERS${colors.reset}\n`);

    let customer, driver, bookingId;

    try {
        // Teste 1: Autenticação
        const authResult = await testAuthentication();
        customer = authResult.customer;
        driver = authResult.driver;

        // Teste 2: Status do Motorista
        await testDriverStatus(driver);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Aguardar processamento

        // Teste 3: Criação de Booking
        bookingId = await testCreateBooking(customer);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Aguardar QueueWorker

        // Teste 4: Notificação de Corrida
        await testNewRideRequest(driver, bookingId);

        // Teste 5: Aceitação de Corrida
        await testAcceptRide(driver, customer, bookingId);

        // Teste 6: Confirmação de Pagamento (opcional)
        try {
            await testConfirmPayment(customer, bookingId);
        } catch (error) {
            log.warn('Pagamento não testado (pode ser mock)');
        }

        // Teste 7: Início de Viagem
        await testStartTrip(driver, customer, bookingId);

        // Teste 8: Finalização de Viagem
        await testCompleteTrip(driver, customer, bookingId);

        // Teste 9: Avaliação
        await testRating(customer, driver, bookingId);

    } catch (error) {
        log.error(`Erro durante testes: ${error.message}`);
    } finally {
        // Desconectar
        if (customer) customer.disconnect();
        if (driver) driver.disconnect();

        // Gerar relatório
        if (customer && driver) {
            generateReport(customer, driver);
        }
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    runAllTests().then(() => {
        process.exit(stats.failed > 0 ? 1 : 0);
    }).catch((error) => {
        console.error(`${colors.red}❌ Erro fatal: ${error.message}${colors.reset}`);
        process.exit(1);
    });
}

module.exports = { EventListenerTester, runAllTests };

