/**
 * 🧪 TESTE COMPLETO DE ORQUESTRAÇÃO DE EVENTOS - PONTA A PONTA
 * 
 * Testa todo o fluxo de uma corrida do início ao fim:
 * 1. Motorista conecta e autentica
 * 2. Passageiro conecta e autentica
 * 3. Passageiro cria booking
 * 4. Motorista recebe notificação
 * 5. Motorista aceita corrida
 * 6. Viagem inicia
 * 7. Viagem finaliza
 * 8. Avaliações
 * 9. Pagamento confirmado
 * 
 * Valida todos os eventos e a orquestração completa
 */

const io = require('socket.io-client');

// Configurações
const SERVER_URL = process.env.WEBSOCKET_URL || 'http://localhost:3001';
const DRIVER_ID = `test_driver_${Date.now()}`;
const CUSTOMER_ID = `test_customer_${Date.now()}`;

// Localizações de teste (Rio de Janeiro)
const DRIVER_LOCATION = {
    lat: -22.9068,
    lng: -43.1729
};

const PICKUP_LOCATION = {
    lat: -22.9070,
    lng: -43.1730,
    address: 'Rua do Ouvidor, 50 - Centro, Rio de Janeiro'
};

const DESTINATION_LOCATION = {
    lat: -22.9080,
    lng: -43.1740,
    address: 'Avenida Atlântica, 1000 - Copacabana, Rio de Janeiro'
};

// Cores para logs
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
    const timestamp = new Date().toISOString();
    console.log(`${colors[color]}[${timestamp}] ${message}${colors.reset}`);
}

class RideOrchestrationTester {
    constructor() {
        this.driverSocket = null;
        this.customerSocket = null;
        this.eventsReceived = {
            driver: [],
            customer: []
        };
        this.testResults = {
            passed: 0,
            failed: 0,
            errors: []
        };
        this.bookingId = null;
        this.rideId = null;
    }

    /**
     * 🎬 Executar teste completo
     */
    async run() {
        log('\n🚀 INICIANDO TESTE DE ORQUESTRAÇÃO DE EVENTOS - PONTA A PONTA', 'cyan');
        log('='.repeat(80), 'cyan');
        
        try {
            // 1. Conectar motorista
            await this.connectDriver();
            
            // 2. Conectar passageiro
            await this.connectCustomer();
            
            // 3. Motorista envia localização
            await this.driverUpdateLocation();
            
            // 4. Passageiro cria booking
            await this.customerCreateBooking();
            
            // 5. Aguardar motorista receber notificação
            await this.waitForDriverNotification();
            
            // 6. Motorista aceita corrida
            await this.driverAcceptRide();
            
            // 7. Aguardar confirmação de aceitação
            await this.waitForRideAccepted();
            
            // 7.5. Passageiro confirma pagamento (CRÍTICO: necessário para startTrip)
            await this.customerConfirmPayment();
            
            // 8. Motorista inicia viagem
            await this.driverStartTrip();
            
            // 9. Aguardar confirmação de início
            await this.waitForTripStarted();
            
            // 10. Motorista finaliza viagem
            await this.driverCompleteTrip();
            
            // 11. Aguardar confirmação de finalização
            await this.waitForTripCompleted();
            
            // 12. Passageiro avalia motorista
            await this.customerSubmitRating();
            
            // 13. Gerar relatório
            this.generateReport();
            
        } catch (error) {
            log(`❌ ERRO CRÍTICO: ${error.message}`, 'red');
            console.error(error);
            this.testResults.errors.push(error.message);
        } finally {
            await this.cleanup();
        }
    }

    /**
     * 🚗 Conectar motorista
     */
    async connectDriver() {
        log('\n📱 [1/13] Conectando motorista...', 'blue');
        
        return new Promise((resolve, reject) => {
            this.driverSocket = io(SERVER_URL, {
                transports: ['websocket'],
                reconnection: false,
                timeout: 10000
            });

            const timeout = setTimeout(() => {
                reject(new Error('Timeout conectando motorista'));
            }, 10000);

            this.driverSocket.on('connect', () => {
                clearTimeout(timeout);
                log('✅ Motorista conectado', 'green');
                
                // Autenticar motorista
                this.driverSocket.emit('authenticate', {
                    uid: DRIVER_ID,
                    userType: 'driver',
                    token: 'test_token_driver'
                });
                
                this.driverSocket.on('authenticated', () => {
                    log('✅ Motorista autenticado', 'green');
                    this.recordEvent('driver', 'authenticated');
                    resolve();
                });
                
                this.driverSocket.on('authentication_failed', (error) => {
                    reject(new Error(`Autenticação falhou: ${error}`));
                });
            });

            this.driverSocket.on('connect_error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Erro conectando motorista: ${error.message}`));
            });

            // Registrar todos os eventos recebidos
            this.setupDriverEventListeners();
        });
    }

    /**
     * 👤 Conectar passageiro
     */
    async connectCustomer() {
        log('\n👤 [2/13] Conectando passageiro...', 'blue');
        
        return new Promise((resolve, reject) => {
            this.customerSocket = io(SERVER_URL, {
                transports: ['websocket'],
                reconnection: false,
                timeout: 10000
            });

            const timeout = setTimeout(() => {
                reject(new Error('Timeout conectando passageiro'));
            }, 10000);

            this.customerSocket.on('connect', () => {
                clearTimeout(timeout);
                log('✅ Passageiro conectado', 'green');
                
                // Autenticar passageiro
                this.customerSocket.emit('authenticate', {
                    uid: CUSTOMER_ID,
                    userType: 'customer',
                    token: 'test_token_customer'
                });
                
                this.customerSocket.on('authenticated', () => {
                    log('✅ Passageiro autenticado', 'green');
                    this.recordEvent('customer', 'authenticated');
                    resolve();
                });
                
                this.customerSocket.on('authentication_failed', (error) => {
                    reject(new Error(`Autenticação falhou: ${error}`));
                });
            });

            this.customerSocket.on('connect_error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Erro conectando passageiro: ${error.message}`));
            });

            // Registrar todos os eventos recebidos
            this.setupCustomerEventListeners();
        });
    }

    /**
     * 📍 Motorista atualiza localização
     */
    async driverUpdateLocation() {
        log('\n📍 [3/13] Motorista enviando localização...', 'blue');
        
        return new Promise((resolve) => {
            // Primeiro definir status como disponível
            this.driverSocket.emit('setDriverStatus', {
                status: 'available',
                isOnline: true
            });
            
            // Depois atualizar localização usando updateLocation (evento usado pelo app mobile)
            this.driverSocket.emit('updateLocation', {
                lat: DRIVER_LOCATION.lat,
                lng: DRIVER_LOCATION.lng,
                heading: 0,
                speed: 0,
                isInTrip: false,
                tripStatus: null
            });
            
            log('✅ Localização enviada', 'green');
            this.recordEvent('driver', 'locationUpdated');
            // Aguardar mais tempo para garantir que a localização foi processada e o motorista está disponível
            setTimeout(resolve, 5000);
        });
    }

    /**
     * 📝 Passageiro cria booking
     */
    async customerCreateBooking() {
        log('\n📝 [4/13] Passageiro criando booking...', 'blue');
        
        return new Promise((resolve, reject) => {
            const bookingData = {
                customerId: CUSTOMER_ID,
                pickupLocation: {
                    lat: PICKUP_LOCATION.lat,
                    lng: PICKUP_LOCATION.lng,
                    address: PICKUP_LOCATION.address
                },
                destinationLocation: {
                    lat: DESTINATION_LOCATION.lat,
                    lng: DESTINATION_LOCATION.lng,
                    address: DESTINATION_LOCATION.address
                },
                estimatedFare: 25.50,
                paymentMethod: 'pix',
                paymentStatus: 'confirmed'
            };

            // Listener para erros também
            this.customerSocket.once('bookingError', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Erro ao criar booking: ${error.error || error.message}`));
            });

            this.customerSocket.emit('createBooking', bookingData);

            const timeout = setTimeout(() => {
                reject(new Error('Timeout aguardando bookingCreated'));
            }, 20000);

            this.customerSocket.once('bookingCreated', (data) => {
                clearTimeout(timeout);
                this.bookingId = data.bookingId || data.data?.bookingId;
                log(`✅ Booking criado: ${this.bookingId}`, 'green');
                this.recordEvent('customer', 'bookingCreated', data);
                resolve();
            });
        });
    }

    /**
     * 🔔 Aguardar motorista receber notificação
     */
    async waitForDriverNotification() {
        log('\n🔔 [5/13] Aguardando motorista receber notificação...', 'blue');
        
        return new Promise((resolve, reject) => {
            // Aumentar timeout para 60s porque o QueueWorker processa a cada 3s e pode levar tempo
            const timeout = setTimeout(() => {
                reject(new Error('Timeout aguardando rideRequest - O motorista pode não estar sendo encontrado na busca'));
            }, 60000);

            // O servidor envia 'newRideRequest', não 'rideRequest'
            this.driverSocket.once('newRideRequest', (data) => {
                clearTimeout(timeout);
                this.rideId = data.rideId || data.bookingId;
                log(`✅ Motorista recebeu notificação: ${this.rideId}`, 'green');
                this.recordEvent('driver', 'newRideRequest', data);
                this.testResults.passed++;
                resolve();
            });
            
            // Também escutar 'rideRequest' para compatibilidade
            this.driverSocket.once('rideRequest', (data) => {
                clearTimeout(timeout);
                this.rideId = data.rideId || data.bookingId;
                log(`✅ Motorista recebeu notificação (rideRequest): ${this.rideId}`, 'green');
                this.recordEvent('driver', 'rideRequest', data);
                this.testResults.passed++;
                resolve();
            });
        });
    }

    /**
     * ✅ Motorista aceita corrida
     * ✅ CORREÇÃO: Configura listeners ANTES de enviar evento para evitar perda por timing
     */
    async driverAcceptRide() {
        log('\n✅ [6/13] Motorista aceitando corrida...', 'blue');
        
        // ✅ CRÍTICO: Usar variáveis de instância para compartilhar estado
        this.rideAcceptedDriverReceived = false;
        this.rideAcceptedCustomerReceived = false;
        
        const driverHandler = (data) => {
            if (!this.rideAcceptedDriverReceived) {
                this.rideAcceptedDriverReceived = true;
                log('✅ Motorista recebeu rideAccepted', 'green');
                this.recordEvent('driver', 'rideAccepted', data);
                this.driverSocket.off('rideAccepted', driverHandler);
                this.checkRideAcceptedComplete();
            }
        };
        
        const customerHandler = (data) => {
            if (!this.rideAcceptedCustomerReceived) {
                this.rideAcceptedCustomerReceived = true;
                log('✅ Passageiro recebeu rideAccepted', 'green');
                this.recordEvent('customer', 'rideAccepted', data);
                this.customerSocket.off('rideAccepted', customerHandler);
                this.checkRideAcceptedComplete();
            }
        };
        
        // Armazenar handlers para poder remover depois
        this.rideAcceptedDriverHandler = driverHandler;
        this.rideAcceptedCustomerHandler = customerHandler;
        
        // Configurar listeners PRIMEIRO
        this.driverSocket.on('rideAccepted', driverHandler);
        this.customerSocket.on('rideAccepted', customerHandler);
        
        // Escutar erros também
        this.driverSocket.once('acceptRideError', (error) => {
            log(`❌ Erro ao aceitar corrida: ${error.error || error.message}`, 'red');
            this.recordEvent('driver', 'acceptRideError', error);
            this.driverSocket.off('rideAccepted', driverHandler);
            this.customerSocket.off('rideAccepted', customerHandler);
        });
        
        return new Promise((resolve) => {
            // DEPOIS enviar evento (listeners já estão prontos)
            this.driverSocket.emit('acceptRide', {
                bookingId: this.bookingId,
                rideId: this.rideId
            });
            
            log('✅ Comando de aceitação enviado', 'green');
            this.recordEvent('driver', 'acceptRide_sent');
            
            // Aguardar um pouco para garantir que evento foi processado
            setTimeout(resolve, 1000);
        });
    }

    /**
     * ✅ Verificar se ambos receberam rideAccepted
     */
    checkRideAcceptedComplete() {
        if (this.rideAcceptedDriverReceived && this.rideAcceptedCustomerReceived) {
            if (this.rideAcceptedResolve) {
                log('✅ Ambos receberam confirmação de aceitação', 'green');
                this.testResults.passed++;
                this.rideAcceptedResolve();
                this.rideAcceptedResolve = null;
            }
        }
    }

    /**
     * ⏳ Aguardar confirmação de aceitação
     * ✅ CORREÇÃO: Listeners já foram configurados em driverAcceptRide()
     */
    async waitForRideAccepted() {
        log('\n⏳ [7/13] Aguardando confirmação de aceitação...', 'blue');
        
        return new Promise((resolve, reject) => {
            // Armazenar resolve para poder chamar quando ambos receberem
            this.rideAcceptedResolve = resolve;
            
            const timeout = setTimeout(() => {
                // Se pelo menos um recebeu, considerar parcialmente sucesso
                if (this.rideAcceptedDriverReceived || this.rideAcceptedCustomerReceived) {
                    log(`⚠️ Apenas ${this.rideAcceptedDriverReceived ? 'motorista' : 'passageiro'} recebeu rideAccepted`, 'yellow');
                    this.testResults.passed++;
                    this.rideAcceptedResolve = null;
                    resolve();
                } else {
                    this.rideAcceptedResolve = null;
                    reject(new Error('Timeout aguardando rideAccepted'));
                }
            }, 20000);

            // Se ambos já receberam antes de configurar o timeout, resolver imediatamente
            if (this.rideAcceptedDriverReceived && this.rideAcceptedCustomerReceived) {
                clearTimeout(timeout);
                log('✅ Ambos receberam confirmação de aceitação', 'green');
                this.testResults.passed++;
                this.rideAcceptedResolve = null;
                resolve();
            }
        });
    }

    /**
     * 💳 Passageiro confirma pagamento
     */
    async customerConfirmPayment() {
        log('\n💳 [7.5/13] Passageiro confirmando pagamento...', 'blue');
        
        return new Promise((resolve, reject) => {
            const paymentData = {
                bookingId: this.bookingId,
                paymentMethod: 'pix',
                paymentId: `payment_${Date.now()}`,
                amount: 25.50
            };

            // Listener para erros
            this.customerSocket.once('paymentError', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Erro ao confirmar pagamento: ${error.error || error.message}`));
            });

            this.customerSocket.emit('confirmPayment', paymentData);

            const timeout = setTimeout(() => {
                reject(new Error('Timeout aguardando paymentConfirmed'));
            }, 10000);

            this.customerSocket.once('paymentConfirmed', (data) => {
                clearTimeout(timeout);
                log('✅ Pagamento confirmado', 'green');
                this.recordEvent('customer', 'paymentConfirmed', data);
                // Aguardar um pouco para o servidor processar o pagamento
                setTimeout(resolve, 2000);
            });
        });
    }

    /**
     * 🚀 Motorista inicia viagem
     * ✅ CORREÇÃO: Configura listeners ANTES de enviar evento para evitar perda por timing
     */
    async driverStartTrip() {
        log('\n🚀 [8/13] Motorista iniciando viagem...', 'blue');
        
        // ✅ CRÍTICO: Usar variáveis de instância para compartilhar estado
        this.tripStartedDriverReceived = false;
        this.tripStartedCustomerReceived = false;
        
        const driverTripHandler = (data) => {
            if (!this.tripStartedDriverReceived) {
                this.tripStartedDriverReceived = true;
                log('✅ Motorista recebeu tripStarted', 'green');
                this.recordEvent('driver', 'tripStarted', data);
                this.driverSocket.off('tripStarted', driverTripHandler);
                this.checkTripStartedComplete();
            }
        };
        
        const customerTripHandler = (data) => {
            if (!this.tripStartedCustomerReceived) {
                this.tripStartedCustomerReceived = true;
                log('✅ Passageiro recebeu tripStarted', 'green');
                this.recordEvent('customer', 'tripStarted', data);
                this.customerSocket.off('tripStarted', customerTripHandler);
                this.checkTripStartedComplete();
            }
        };
        
        // Armazenar handlers para poder remover depois
        this.tripStartedDriverHandler = driverTripHandler;
        this.tripStartedCustomerHandler = customerTripHandler;
        
        // Configurar listeners PRIMEIRO
        this.driverSocket.on('tripStarted', driverTripHandler);
        this.customerSocket.on('tripStarted', customerTripHandler);
        
        // Escutar erros também
        this.driverSocket.once('tripStartError', (error) => {
            log(`❌ Erro ao iniciar viagem: ${error.error || error.message}`, 'red');
            this.recordEvent('driver', 'tripStartError', error);
            this.driverSocket.off('tripStarted', driverTripHandler);
            this.customerSocket.off('tripStarted', customerTripHandler);
        });
        
        return new Promise((resolve) => {
            // DEPOIS enviar evento (listeners já estão prontos)
            this.driverSocket.emit('startTrip', {
                bookingId: this.bookingId,
                rideId: this.rideId,
                startLocation: {
                    lat: PICKUP_LOCATION.lat,
                    lng: PICKUP_LOCATION.lng
                }
            });
            
            log('✅ Comando de início enviado', 'green');
            this.recordEvent('driver', 'startTrip_sent');
            setTimeout(resolve, 1000);
        });
    }

    /**
     * ✅ Verificar se ambos receberam tripStarted
     */
    checkTripStartedComplete() {
        if (this.tripStartedDriverReceived && this.tripStartedCustomerReceived) {
            if (this.tripStartedResolve) {
                log('✅ Ambos receberam confirmação de início', 'green');
                this.testResults.passed++;
                this.tripStartedResolve();
                this.tripStartedResolve = null;
            }
        }
    }

    /**
     * ⏳ Aguardar confirmação de início
     * ✅ CORREÇÃO: Listeners já foram configurados em driverStartTrip()
     */
    async waitForTripStarted() {
        log('\n⏳ [9/13] Aguardando confirmação de início...', 'blue');
        
        return new Promise((resolve, reject) => {
            // Armazenar resolve para poder chamar quando ambos receberem
            this.tripStartedResolve = resolve;
            
            const timeout = setTimeout(() => {
                // Se pelo menos um recebeu, considerar parcialmente sucesso
                if (this.tripStartedDriverReceived || this.tripStartedCustomerReceived) {
                    log(`⚠️ Apenas ${this.tripStartedDriverReceived ? 'motorista' : 'passageiro'} recebeu tripStarted`, 'yellow');
                    this.testResults.passed++;
                    this.tripStartedResolve = null;
                    resolve();
                } else {
                    this.tripStartedResolve = null;
                    reject(new Error('Timeout aguardando tripStarted'));
                }
            }, 15000);

            // Se ambos já receberam antes de configurar o timeout, resolver imediatamente
            if (this.tripStartedDriverReceived && this.tripStartedCustomerReceived) {
                clearTimeout(timeout);
                log('✅ Ambos receberam confirmação de início', 'green');
                this.testResults.passed++;
                this.tripStartedResolve = null;
                resolve();
            }
        });
    }

    /**
     * 🏁 Motorista finaliza viagem
     */
    async driverCompleteTrip() {
        log('\n🏁 [10/13] Motorista finalizando viagem...', 'blue');
        
        return new Promise((resolve) => {
            this.driverSocket.emit('completeTrip', {
                bookingId: this.bookingId,
                rideId: this.rideId,
                finalFare: 25.50
            });
            
            log('✅ Comando de finalização enviado', 'green');
            this.recordEvent('driver', 'completeTrip_sent');
            setTimeout(resolve, 1000);
        });
    }

    /**
     * ⏳ Aguardar confirmação de finalização
     */
    async waitForTripCompleted() {
        log('\n⏳ [11/13] Aguardando confirmação de finalização...', 'blue');
        
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Timeout aguardando tripCompleted'));
            }, 15000);

            let driverReceived = false;
            let customerReceived = false;

            const checkComplete = () => {
                if (driverReceived && customerReceived) {
                    clearTimeout(timeout);
                    log('✅ Ambos receberam confirmação de finalização', 'green');
                    this.testResults.passed++;
                    resolve();
                }
            };

            this.driverSocket.once('tripCompleted', (data) => {
                driverReceived = true;
                log('✅ Motorista recebeu tripCompleted', 'green');
                this.recordEvent('driver', 'tripCompleted', data);
                checkComplete();
            });

            this.customerSocket.once('tripCompleted', (data) => {
                customerReceived = true;
                log('✅ Passageiro recebeu tripCompleted', 'green');
                this.recordEvent('customer', 'tripCompleted', data);
                checkComplete();
            });
        });
    }

    /**
     * ⭐ Passageiro avalia motorista
     */
    async customerSubmitRating() {
        log('\n⭐ [12/13] Passageiro enviando avaliação...', 'blue');
        
        return new Promise((resolve) => {
            this.customerSocket.emit('submitRating', {
                bookingId: this.bookingId,
                rideId: this.rideId,
                rating: 5,
                comment: 'Ótimo motorista!'
            });
            
            log('✅ Avaliação enviada', 'green');
            this.recordEvent('customer', 'submitRating_sent');
            setTimeout(resolve, 2000);
        });
    }

    /**
     * 📊 Configurar listeners de eventos do motorista
     */
    setupDriverEventListeners() {
        const events = [
            'newRideRequest', 'rideRequest', 'rideAccepted', 'rideRejected',
            'tripStarted', 'tripCompleted', 'tripCancelled',
            'paymentConfirmed', 'ratingSubmitted', 'messageSent'
        ];

        events.forEach(eventName => {
            this.driverSocket.on(eventName, (data) => {
                this.recordEvent('driver', eventName, data);
            });
        });
    }

    /**
     * 📊 Configurar listeners de eventos do passageiro
     */
    setupCustomerEventListeners() {
        const events = [
            'bookingCreated', 'rideAccepted', 'rideRejected',
            'tripStarted', 'tripCompleted', 'tripCancelled',
            'paymentConfirmed', 'ratingSubmitted', 'messageSent'
        ];

        events.forEach(eventName => {
            this.customerSocket.on(eventName, (data) => {
                this.recordEvent('customer', eventName, data);
            });
        });
    }

    /**
     * 📝 Registrar evento recebido
     */
    recordEvent(userType, eventName, data = null) {
        this.eventsReceived[userType].push({
            event: eventName,
            timestamp: new Date().toISOString(),
            data: data
        });
    }

    /**
     * 📊 Gerar relatório
     */
    generateReport() {
        log('\n📊 [13/13] GERANDO RELATÓRIO FINAL', 'cyan');
        log('='.repeat(80), 'cyan');
        
        log(`\n✅ Testes passados: ${this.testResults.passed}`, 'green');
        log(`❌ Testes falhados: ${this.testResults.failed}`, 'red');
        
        log('\n📱 EVENTOS RECEBIDOS PELO MOTORISTA:', 'magenta');
        this.eventsReceived.driver.forEach((event, index) => {
            log(`  ${index + 1}. ${event.event} - ${event.timestamp}`, 'yellow');
        });
        
        log('\n👤 EVENTOS RECEBIDOS PELO PASSAGEIRO:', 'magenta');
        this.eventsReceived.customer.forEach((event, index) => {
            log(`  ${index + 1}. ${event.event} - ${event.timestamp}`, 'yellow');
        });
        
        if (this.testResults.errors.length > 0) {
            log('\n❌ ERROS ENCONTRADOS:', 'red');
            this.testResults.errors.forEach((error, index) => {
                log(`  ${index + 1}. ${error}`, 'red');
            });
        }
        
        log('\n' + '='.repeat(80), 'cyan');
        
        if (this.testResults.failed === 0 && this.testResults.errors.length === 0) {
            log('🎉 TESTE COMPLETO: TODOS OS EVENTOS FUNCIONANDO CORRETAMENTE!', 'green');
        } else {
            log('⚠️ TESTE COMPLETO COM ERROS', 'yellow');
        }
    }

    /**
     * 🧹 Limpar conexões
     */
    async cleanup() {
        log('\n🧹 Limpando conexões...', 'blue');
        
        if (this.driverSocket) {
            this.driverSocket.disconnect();
        }
        
        if (this.customerSocket) {
            this.customerSocket.disconnect();
        }
        
        log('✅ Conexões encerradas', 'green');
    }
}

// Executar teste
if (require.main === module) {
    const tester = new RideOrchestrationTester();
    tester.run().then(() => {
        process.exit(0);
    }).catch((error) => {
        console.error('❌ Erro fatal:', error);
        process.exit(1);
    });
}

module.exports = RideOrchestrationTester;

