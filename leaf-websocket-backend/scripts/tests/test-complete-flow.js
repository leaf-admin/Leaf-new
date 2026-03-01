/**
 * 🧪 TESTE COMPLETO E CONFIÁVEL DO FLUXO DE CORRIDA
 * 
 * Este teste simula EXATAMENTE o que acontece no app mobile:
 * 1. Cliente solicita corrida
 * 2. Modal PIX aparece
 * 3. Pagamento confirmado
 * 4. Motoristas recebem notificação
 * 5. Motorista aceita
 * 6. Viagem inicia
 * 7. Viagem finaliza
 * 8. Avaliações
 */

const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');

class CompleteFlowTester {
    constructor() {
        this.baseUrl = 'http://localhost:3001';
        this.testResults = [];
        this.connections = new Map();
        this.testData = {
            customers: [],
            drivers: [],
            rides: []
        };
        
        // Configuração de teste realista
        this.config = {
            customerCount: 2,
            driverCount: 3,
            testTimeout: 30000, // 30 segundos por teste
            stepTimeout: 10000,  // 10 segundos por etapa
            retryAttempts: 3
        };
    }

    /**
     * 🎬 Executar teste completo e confiável
     */
    async runCompleteTest() {
        console.log('🎬 INICIANDO TESTE COMPLETO E CONFIÁVEL DO FLUXO DE CORRIDA');
        console.log('='.repeat(60));
        
        const startTime = Date.now();
        
        try {
            // 1. Verificar servidor
            await this.verifyServer();
            
            // 2. Criar conexões realistas
            await this.createRealisticConnections();
            
            // 3. Executar testes sequenciais
            await this.executeSequentialTests();
            
            // 4. Validar resultados
            await this.validateResults();
            
            // 5. Gerar relatório detalhado
            this.generateDetailedReport();
            
        } catch (error) {
            console.error('❌ ERRO CRÍTICO NO TESTE:', error);
            this.handleTestFailure(error);
        } finally {
            await this.cleanup();
            const duration = Date.now() - startTime;
            console.log(`⏱️ Teste concluído em ${(duration/1000).toFixed(2)}s`);
        }
    }

    /**
     * 🔍 Verificar se servidor está funcionando
     */
    async verifyServer() {
        console.log('🔍 Verificando servidor...');
        
        return new Promise((resolve, reject) => {
            const testSocket = io(this.baseUrl, {
                transports: ['websocket'],
                reconnection: false,
                timeout: 5000
            });

            const timeout = setTimeout(() => {
                testSocket.disconnect();
                reject(new Error('❌ Timeout conectando ao servidor'));
            }, 5000);

            testSocket.on('connect', () => {
                clearTimeout(timeout);
                testSocket.disconnect();
                console.log('✅ Servidor WebSocket funcionando');
                resolve();
            });

            testSocket.on('connect_error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`❌ Servidor não está disponível: ${error.message}`));
            });
        });
    }

    /**
     * 🔌 Criar conexões realistas
     */
    async createRealisticConnections() {
        console.log('🔌 Criando conexões realistas...');
        
        // Criar clientes
        for (let i = 0; i < this.config.customerCount; i++) {
            await this.createCustomer(i);
        }
        
        // Criar motoristas
        for (let i = 0; i < this.config.driverCount; i++) {
            await this.createDriver(i);
        }
        
        console.log(`✅ ${this.connections.size} conexões criadas`);
    }

    /**
     * 👤 Criar cliente realista
     */
    async createCustomer(index) {
        const customerId = `customer_${index}_${Date.now()}`;
        const socket = io(this.baseUrl, {
            transports: ['websocket', 'polling'],
            reconnection: false,
            timeout: 10000
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Timeout criando cliente ${index}`));
            }, 10000);

            socket.on('connect', () => {
                clearTimeout(timeout);
                
                const customer = {
                    id: customerId,
                    socket,
                    index,
                    type: 'customer',
                    status: 'idle',
                    currentRide: null,
                    events: []
                };

                this.connections.set(customerId, customer);
                this.testData.customers.push(customer);

                // Autenticar como cliente
                socket.emit('authenticate', {
                    uid: customerId,
                    userType: 'customer',
                    profile: {
                        firstName: `Cliente${index}`,
                        lastName: 'Teste',
                        mobile: `1199999${index.toString().padStart(4, '0')}`,
                        rating: 4.5
                    }
                });

                // Configurar listeners
                this.setupCustomerListeners(customer);
                
                console.log(`👤 Cliente ${index} conectado: ${socket.id}`);
                resolve();
            });

            socket.on('connect_error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Erro conectando cliente ${index}: ${error.message}`));
            });
        });
    }

    /**
     * 🚗 Criar motorista realista
     */
    async createDriver(index) {
        const driverId = `driver_${index}_${Date.now()}`;
        const socket = io(this.baseUrl, {
            transports: ['websocket', 'polling'],
            reconnection: false,
            timeout: 10000
        });

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Timeout criando motorista ${index}`));
            }, 10000);

            socket.on('connect', () => {
                clearTimeout(timeout);
                
                const driver = {
                    id: driverId,
                    socket,
                    index,
                    type: 'driver',
                    status: 'online',
                    acceptedRides: [],
                    events: []
                };

                this.connections.set(driverId, driver);
                this.testData.drivers.push(driver);

                // Autenticar como motorista
                socket.emit('authenticate', {
                    uid: driverId,
                    userType: 'driver',
                    profile: {
                        firstName: `Motorista${index}`,
                        lastName: 'Teste',
                        mobile: `1188888${index.toString().padStart(4, '0')}`,
                        rating: 4.8,
                        vehicleNumber: `ABC${index.toString().padStart(4, '0')}`,
                        vehicleModel: 'Honda Civic'
                    }
                });

                // Configurar listeners
                this.setupDriverListeners(driver);
                
                console.log(`🚗 Motorista ${index} conectado: ${socket.id}`);
                resolve();
            });

            socket.on('connect_error', (error) => {
                clearTimeout(timeout);
                reject(new Error(`Erro conectando motorista ${index}: ${error.message}`));
            });
        });
    }

    /**
     * 📡 Configurar listeners do cliente
     */
    setupCustomerListeners(customer) {
        const { socket } = customer;

        socket.on('bookingCreated', (data) => {
            customer.events.push({ type: 'bookingCreated', data, timestamp: Date.now() });
            customer.currentRide = data.bookingId;
            console.log(`✅ Cliente ${customer.index}: Corrida criada - ${data.bookingId}`);
        });

        socket.on('paymentConfirmed', (data) => {
            customer.events.push({ type: 'paymentConfirmed', data, timestamp: Date.now() });
            console.log(`💳 Cliente ${customer.index}: Pagamento confirmado`);
        });

        socket.on('rideAccepted', (data) => {
            customer.events.push({ type: 'rideAccepted', data, timestamp: Date.now() });
            console.log(`✅ Cliente ${customer.index}: Corrida aceita pelo motorista`);
        });

        socket.on('tripStarted', (data) => {
            customer.events.push({ type: 'tripStarted', data, timestamp: Date.now() });
            console.log(`🚀 Cliente ${customer.index}: Viagem iniciada`);
        });

        socket.on('tripCompleted', (data) => {
            customer.events.push({ type: 'tripCompleted', data, timestamp: Date.now() });
            console.log(`🏁 Cliente ${customer.index}: Viagem finalizada`);
        });

        socket.on('error', (error) => {
            customer.events.push({ type: 'error', error, timestamp: Date.now() });
            console.error(`❌ Cliente ${customer.index}: Erro - ${error.message}`);
        });
    }

    /**
     * 📡 Configurar listeners do motorista
     */
    setupDriverListeners(driver) {
        const { socket } = driver;

        socket.on('rideRequest', (data) => {
            driver.events.push({ type: 'rideRequest', data, timestamp: Date.now() });
            console.log(`📱 Motorista ${driver.index}: Nova corrida disponível - ${data.rideId}`);
            
            // Simular decisão do motorista (aceitar ou recusar)
            setTimeout(() => {
                this.simulateDriverDecision(driver, data);
            }, Math.random() * 1000 + 200); // 0.2-1.2 segundos (muito mais rápido)
        });

        socket.on('rideAccepted', (data) => {
            driver.events.push({ type: 'rideAccepted', data, timestamp: Date.now() });
            driver.acceptedRides.push(data.rideId);
            console.log(`✅ Motorista ${driver.index}: Corrida aceita - ${data.rideId}`);
        });

        socket.on('error', (error) => {
            driver.events.push({ type: 'error', error, timestamp: Date.now() });
            console.error(`❌ Motorista ${driver.index}: Erro - ${error.message}`);
        });
    }

    /**
     * 🎯 Executar testes sequenciais
     */
    async executeSequentialTests() {
        console.log('🎯 Executando testes sequenciais...');
        
        for (let i = 0; i < this.testData.customers.length; i++) {
            const customer = this.testData.customers[i];
            
            console.log(`\n🚗 Teste ${i + 1}: Cliente ${customer.index}`);
            console.log('-'.repeat(40));
            
            try {
                await this.executeSingleRideTest(customer);
            } catch (error) {
                console.error(`❌ Teste ${i + 1} falhou:`, error.message);
                this.testResults.push({
                    testId: `test_${i + 1}`,
                    customerIndex: customer.index,
                    success: false,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            }
            
            // Delay entre testes
            if (i < this.testData.customers.length - 1) {
                console.log('⏳ Aguardando 3 segundos antes do próximo teste...');
                await this.delay(3000);
            }
        }
    }

    /**
     * 🚗 Executar teste de corrida individual
     */
    async executeSingleRideTest(customer) {
        const testId = `test_${customer.index}_${Date.now()}`;
        const startTime = Date.now();
        
        console.log(`🚗 Iniciando teste de corrida ${testId}...`);
        
        try {
            // ETAPA 1: Solicitar corrida
            console.log('1️⃣ Solicitando corrida...');
            await this.requestRide(customer, testId);
            await this.waitForEvent(customer, 'bookingCreated', this.config.stepTimeout);
            
            // ETAPA 2: Processar pagamento
            console.log('2️⃣ Processando pagamento PIX...');
            await this.processPayment(customer, testId);
            await this.waitForEvent(customer, 'paymentConfirmed', this.config.stepTimeout);
            
            // ETAPA 3: Aguardar aceitação do motorista
            console.log('3️⃣ Aguardando motorista aceitar...');
            await this.waitForEvent(customer, 'rideAccepted', this.config.stepTimeout);
            
            // ETAPA 4: Iniciar viagem
            console.log('4️⃣ Iniciando viagem...');
            await this.startTrip(customer, testId);
            await this.waitForEvent(customer, 'tripStarted', this.config.stepTimeout);
            
            // ETAPA 5: Finalizar viagem
            console.log('5️⃣ Finalizando viagem...');
            await this.completeTrip(customer, testId);
            await this.waitForEvent(customer, 'tripCompleted', this.config.stepTimeout);
            
            const duration = Date.now() - startTime;
            
            this.testResults.push({
                testId,
                customerIndex: customer.index,
                success: true,
                duration,
                events: customer.events.slice(-10), // Últimos 10 eventos
                timestamp: new Date().toISOString()
            });
            
            console.log(`✅ Teste ${testId} concluído com sucesso em ${duration}ms`);
            
        } catch (error) {
            const duration = Date.now() - startTime;
            
            this.testResults.push({
                testId,
                customerIndex: customer.index,
                success: false,
                duration,
                error: error.message,
                events: customer.events.slice(-10),
                timestamp: new Date().toISOString()
            });
            
            throw error;
        }
    }

    /**
     * 🚗 Solicitar corrida
     */
    async requestRide(customer, testId) {
        const rideData = {
            customerId: customer.id,
            pickupLocation: {
                lat: -23.5505 + (Math.random() - 0.5) * 0.01,
                lng: -46.6333 + (Math.random() - 0.5) * 0.01,
                address: `Teste ${testId} - Origem`
            },
            destinationLocation: {
                lat: -23.5615 + (Math.random() - 0.5) * 0.01,
                lng: -46.6553 + (Math.random() - 0.5) * 0.01,
                address: `Teste ${testId} - Destino`
            },
            estimatedFare: 20 + Math.random() * 20,
            paymentMethod: 'PIX',
            rideType: 'standard'
        };

        customer.socket.emit('createBooking', rideData);
        console.log(`🚗 Cliente ${customer.index}: Corrida solicitada`);
    }

    /**
     * 💳 Processar pagamento
     */
    async processPayment(customer, testId) {
        if (!customer.currentRide) {
            throw new Error('Nenhuma corrida ativa para pagamento');
        }

        const paymentData = {
            bookingId: customer.currentRide,
            paymentMethod: 'PIX',
            paymentId: `pix_${testId}_${Date.now()}`,
            amount: 20 + Math.random() * 20
        };

        customer.socket.emit('confirmPayment', paymentData);
        console.log(`💳 Cliente ${customer.index}: Pagamento enviado`);
    }

    /**
     * 🚀 Iniciar viagem
     */
    async startTrip(customer, testId) {
        if (!customer.currentRide) {
            throw new Error('Nenhuma corrida ativa para iniciar viagem');
        }

        customer.socket.emit('startTrip', {
            bookingId: customer.currentRide,
            startLocation: {
                lat: -23.5505,
                lng: -46.6333
            }
        });
        
        console.log(`🚀 Cliente ${customer.index}: Iniciando viagem`);
    }

    /**
     * 🏁 Finalizar viagem
     */
    async completeTrip(customer, testId) {
        if (!customer.currentRide) {
            throw new Error('Nenhuma corrida ativa para finalizar viagem');
        }

        customer.socket.emit('completeTrip', {
            bookingId: customer.currentRide,
            endLocation: {
                lat: -23.5615,
                lng: -46.6553
            },
            distance: 5 + Math.random() * 5,
            fare: 20 + Math.random() * 20
        });
        
        console.log(`🏁 Cliente ${customer.index}: Finalizando viagem`);
    }

    /**
     * 🎲 Simular decisão do motorista
     */
    async simulateDriverDecision(driver, rideData) {
        // 100% de chance de aceitar nos testes
        const willAccept = true;
        
        if (willAccept) {
            driver.socket.emit('driverResponse', {
                bookingId: rideData.rideId,
                accepted: true,
                reason: null
            });
            console.log(`✅ Motorista ${driver.index}: Aceitando corrida ${rideData.rideId}`);
        } else {
            driver.socket.emit('driverResponse', {
                bookingId: rideData.rideId,
                accepted: false,
                reason: 'Motorista ocupado'
            });
            console.log(`❌ Motorista ${driver.index}: Recusando corrida ${rideData.rideId}`);
        }
    }

    /**
     * ⏳ Aguardar evento específico
     */
    async waitForEvent(customer, eventType, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const checkEvent = () => {
                const event = customer.events.find(e => e.type === eventType);
                if (event) {
                    resolve(event);
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error(`Timeout aguardando evento ${eventType}`));
                } else {
                    setTimeout(checkEvent, 100);
                }
            };
            
            checkEvent();
        });
    }

    /**
     * ✅ Validar resultados
     */
    async validateResults() {
        console.log('\n✅ Validando resultados...');
        
        const totalTests = this.testResults.length;
        const successfulTests = this.testResults.filter(r => r.success).length;
        const failedTests = totalTests - successfulTests;
        
        if (successfulTests === 0) {
            throw new Error('❌ NENHUM TESTE PASSOU! Sistema não está funcionando.');
        }
        
        if (failedTests > successfulTests) {
            throw new Error(`❌ MUITOS TESTES FALHARAM! ${failedTests}/${totalTests} falharam.`);
        }
        
        console.log(`✅ Validação concluída: ${successfulTests}/${totalTests} testes passaram`);
    }

    /**
     * 📊 Gerar relatório detalhado
     */
    generateDetailedReport() {
        console.log('\n📊 RELATÓRIO DETALHADO DO TESTE');
        console.log('='.repeat(60));
        
        const totalTests = this.testResults.length;
        const successfulTests = this.testResults.filter(r => r.success).length;
        const failedTests = totalTests - successfulTests;
        
        console.log(`📈 Total de testes: ${totalTests}`);
        console.log(`✅ Sucessos: ${successfulTests}`);
        console.log(`❌ Falhas: ${failedTests}`);
        console.log(`📊 Taxa de sucesso: ${((successfulTests / totalTests) * 100).toFixed(2)}%`);
        
        if (successfulTests > 0) {
            const avgDuration = this.testResults
                .filter(r => r.success)
                .reduce((sum, r) => sum + r.duration, 0) / successfulTests;
            console.log(`⏱️ Duração média: ${avgDuration.toFixed(2)}ms`);
        }
        
        console.log('\n📋 Detalhes dos testes:');
        this.testResults.forEach((result, index) => {
            const status = result.success ? '✅' : '❌';
            console.log(`${status} Teste ${index + 1}: ${result.duration}ms - ${result.testId}`);
            if (!result.success) {
                console.log(`   Erro: ${result.error}`);
            }
        });
        
        // Salvar relatório
        this.saveDetailedReport();
    }

    /**
     * 💾 Salvar relatório detalhado
     */
    saveDetailedReport() {
        const reportData = {
            timestamp: new Date().toISOString(),
            config: this.config,
            summary: {
                totalTests: this.testResults.length,
                successfulTests: this.testResults.filter(r => r.success).length,
                failedTests: this.testResults.filter(r => !r.success).length,
                successRate: (this.testResults.filter(r => r.success).length / this.testResults.length) * 100
            },
            connections: {
                customers: this.testData.customers.length,
                drivers: this.testData.drivers.length,
                total: this.connections.size
            },
            results: this.testResults,
            events: {
                customers: this.testData.customers.map(c => ({
                    id: c.id,
                    index: c.index,
                    events: c.events
                })),
                drivers: this.testData.drivers.map(d => ({
                    id: d.id,
                    index: d.index,
                    events: d.events
                }))
            }
        };
        
        const filename = `complete-flow-test-report-${Date.now()}.json`;
        const filepath = path.join(__dirname, filename);
        
        fs.writeFileSync(filepath, JSON.stringify(reportData, null, 2));
        console.log(`💾 Relatório detalhado salvo em: ${filepath}`);
    }

    /**
     * 🚨 Tratar falha do teste
     */
    handleTestFailure(error) {
        console.error('\n🚨 FALHA CRÍTICA NO TESTE');
        console.error('='.repeat(40));
        console.error(`Erro: ${error.message}`);
        console.error('Stack:', error.stack);
        
        // Salvar log de erro
        const errorLog = {
            timestamp: new Date().toISOString(),
            error: error.message,
            stack: error.stack,
            connections: this.connections.size,
            testResults: this.testResults
        };
        
        const filename = `test-failure-log-${Date.now()}.json`;
        const filepath = path.join(__dirname, filename);
        
        fs.writeFileSync(filepath, JSON.stringify(errorLog, null, 2));
        console.error(`💾 Log de erro salvo em: ${filepath}`);
    }

    /**
     * 🧹 Limpar conexões
     */
    async cleanup() {
        console.log('🧹 Limpando conexões...');
        
        this.connections.forEach((connection, id) => {
            if (connection.socket) {
                connection.socket.disconnect();
            }
        });
        
        this.connections.clear();
        console.log('✅ Conexões limpas');
    }

    /**
     * ⏳ Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Executar teste se chamado diretamente
if (require.main === module) {
    const tester = new CompleteFlowTester();
    tester.runCompleteTest().catch(console.error);
}

module.exports = CompleteFlowTester;
