/**
 * 🧪 TESTE AUTOMATIZADO DE FLUXO DE CORRIDA
 * 
 * Este script testa todo o fluxo de corrida de forma automatizada
 * Simula múltiplos clientes e motoristas simultaneamente
 */

const io = require('socket.io-client');

class AutomatedRideTester {
    constructor(options = {}) {
        this.baseUrl = options.baseUrl || 'http://216.238.107.59:3001';
        this.testResults = [];
        this.activeConnections = new Map();
        this.testConfig = {
            customerCount: options.customerCount || 3,
            driverCount: options.driverCount || 2,
            testDuration: options.testDuration || 60000, // 1 minuto
            delayBetweenTests: options.delayBetweenTests || 5000
        };
    }

    /**
     * 🎬 Executar teste completo
     */
    async runCompleteTest() {
        console.log('🎬 INICIANDO TESTE AUTOMATIZADO DE FLUXO DE CORRIDA');
        console.log(`📊 Configuração: ${this.testConfig.customerCount} clientes, ${this.testConfig.driverCount} motoristas`);
        
        const startTime = Date.now();
        
        try {
            // 1. Criar conexões de clientes e motoristas
            await this.createTestConnections();
            
            // 2. Executar testes de corrida
            await this.executeRideTests();
            
            // 3. Aguardar conclusão dos testes
            await this.waitForTestCompletion();
            
            // 4. Gerar relatório
            this.generateReport();
            
        } catch (error) {
            console.error('❌ Erro no teste:', error);
        } finally {
            // Limpar conexões
            this.cleanupConnections();
            
            const duration = Date.now() - startTime;
            console.log(`⏱️ Teste concluído em ${duration}ms`);
        }
    }

    /**
     * 🔌 Criar conexões de teste
     */
    async createTestConnections() {
        console.log('🔌 Criando conexões de teste...');
        
        // Criar clientes
        for (let i = 0; i < this.testConfig.customerCount; i++) {
            await this.createCustomerConnection(i);
        }
        
        // Criar motoristas
        for (let i = 0; i < this.testConfig.driverCount; i++) {
            await this.createDriverConnection(i);
        }
        
        console.log(`✅ ${this.activeConnections.size} conexões criadas`);
    }

    /**
     * 👤 Criar conexão de cliente
     */
    async createCustomerConnection(index) {
        const customerId = `test_customer_${index}_${Date.now()}`;
        const socket = io(this.baseUrl, {
            transports: ['websocket', 'polling'],
            reconnection: false
        });

        return new Promise((resolve) => {
            socket.on('connect', () => {
                console.log(`👤 Cliente ${index} conectado: ${socket.id}`);
                
                // Autenticar como cliente
                socket.emit('authenticate', {
                    uid: customerId,
                    userType: 'customer'
                });

                this.activeConnections.set(customerId, {
                    socket,
                    type: 'customer',
                    index,
                    testData: {
                        customerId,
                        rideId: null,
                        status: 'idle'
                    }
                });

                resolve();
            });

            socket.on('disconnect', () => {
                console.log(`👤 Cliente ${index} desconectado`);
            });

            socket.on('error', (error) => {
                console.error(`❌ Erro cliente ${index}:`, error);
            });

            // Eventos específicos do cliente
            socket.on('bookingCreated', (data) => {
                const connection = this.activeConnections.get(customerId);
                if (connection) {
                    connection.testData.rideId = data.bookingId;
                    connection.testData.status = 'ride_created';
                    console.log(`✅ Cliente ${index}: Corrida criada - ${data.bookingId}`);
                }
            });

            socket.on('paymentConfirmed', (data) => {
                const connection = this.activeConnections.get(customerId);
                if (connection) {
                    connection.testData.status = 'payment_confirmed';
                    console.log(`💳 Cliente ${index}: Pagamento confirmado`);
                }
            });

            socket.on('rideAccepted', (data) => {
                const connection = this.activeConnections.get(customerId);
                if (connection) {
                    connection.testData.status = 'ride_accepted';
                    console.log(`✅ Cliente ${index}: Corrida aceita`);
                }
            });

            socket.on('tripStarted', (data) => {
                const connection = this.activeConnections.get(customerId);
                if (connection) {
                    connection.testData.status = 'trip_started';
                    console.log(`🚀 Cliente ${index}: Viagem iniciada`);
                }
            });

            socket.on('tripCompleted', (data) => {
                const connection = this.activeConnections.get(customerId);
                if (connection) {
                    connection.testData.status = 'trip_completed';
                    console.log(`🏁 Cliente ${index}: Viagem finalizada`);
                }
            });
        });
    }

    /**
     * 🚗 Criar conexão de motorista
     */
    async createDriverConnection(index) {
        const driverId = `test_driver_${index}_${Date.now()}`;
        const socket = io(this.baseUrl, {
            transports: ['websocket', 'polling'],
            reconnection: false
        });

        return new Promise((resolve) => {
            socket.on('connect', () => {
                console.log(`🚗 Motorista ${index} conectado: ${socket.id}`);
                
                // Autenticar como motorista
                socket.emit('authenticate', {
                    uid: driverId,
                    userType: 'driver'
                });

                this.activeConnections.set(driverId, {
                    socket,
                    type: 'driver',
                    index,
                    testData: {
                        driverId,
                        acceptedRides: [],
                        status: 'online'
                    }
                });

                resolve();
            });

            socket.on('disconnect', () => {
                console.log(`🚗 Motorista ${index} desconectado`);
            });

            socket.on('error', (error) => {
                console.error(`❌ Erro motorista ${index}:`, error);
            });

            // Eventos específicos do motorista
            socket.on('rideRequest', (data) => {
                const connection = this.activeConnections.get(driverId);
                if (connection) {
                    console.log(`📱 Motorista ${index}: Nova corrida disponível - ${data.rideId}`);
                    // Simular aceitação automática após delay
                    setTimeout(() => {
                        this.acceptRide(driverId, data.rideId);
                    }, Math.random() * 3000 + 1000); // 1-4 segundos
                }
            });

            socket.on('rideAccepted', (data) => {
                const connection = this.activeConnections.get(driverId);
                if (connection) {
                    connection.testData.acceptedRides.push(data.rideId);
                    console.log(`✅ Motorista ${index}: Corrida aceita - ${data.rideId}`);
                }
            });
        });
    }

    /**
     * 🎯 Executar testes de corrida
     */
    async executeRideTests() {
        console.log('🎯 Executando testes de corrida...');
        
        const customers = Array.from(this.activeConnections.values())
            .filter(conn => conn.type === 'customer');
        
        for (let i = 0; i < customers.length; i++) {
            const customer = customers[i];
            
            // Delay entre testes
            if (i > 0) {
                await this.delay(this.testConfig.delayBetweenTests);
            }
            
            await this.executeSingleRideTest(customer);
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
            // 1. Solicitar corrida
            await this.requestRide(customer, testId);
            
            // 2. Aguardar criação da corrida
            await this.waitForEvent(customer.testData, 'ride_created', 5000);
            
            // 3. Processar pagamento
            await this.processPayment(customer, testId);
            
            // 4. Aguardar confirmação de pagamento
            await this.waitForEvent(customer.testData, 'payment_confirmed', 5000);
            
            // 5. Aguardar aceitação da corrida
            await this.waitForEvent(customer.testData, 'ride_accepted', 10000);
            
            // 6. Iniciar viagem
            await this.startTrip(customer, testId);
            
            // 7. Aguardar início da viagem
            await this.waitForEvent(customer.testData, 'trip_started', 5000);
            
            // 8. Finalizar viagem
            await this.completeTrip(customer, testId);
            
            // 9. Aguardar conclusão da viagem
            await this.waitForEvent(customer.testData, 'trip_completed', 5000);
            
            const duration = Date.now() - startTime;
            
            this.testResults.push({
                testId,
                customerIndex: customer.index,
                success: true,
                duration,
                steps: [
                    'ride_requested',
                    'ride_created', 
                    'payment_confirmed',
                    'ride_accepted',
                    'trip_started',
                    'trip_completed'
                ],
                timestamp: new Date().toISOString()
            });
            
            console.log(`✅ Teste ${testId} concluído em ${duration}ms`);
            
        } catch (error) {
            const duration = Date.now() - startTime;
            
            this.testResults.push({
                testId,
                customerIndex: customer.index,
                success: false,
                duration,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            
            console.error(`❌ Teste ${testId} falhou:`, error.message);
        }
    }

    /**
     * 🚗 Solicitar corrida
     */
    async requestRide(customer, testId) {
        const rideData = {
            customerId: customer.testData.customerId,
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
            paymentMethod: 'PIX'
        };

        customer.socket.emit('createBooking', rideData);
        console.log(`🚗 Cliente ${customer.index}: Corrida solicitada`);
    }

    /**
     * 💳 Processar pagamento
     */
    async processPayment(customer, testId) {
        if (!customer.testData.rideId) {
            throw new Error('Ride ID não disponível para pagamento');
        }

        const paymentData = {
            bookingId: customer.testData.rideId,
            paymentMethod: 'PIX',
            paymentId: `pix_${testId}_${Date.now()}`,
            amount: 20 + Math.random() * 20
        };

        customer.socket.emit('confirmPayment', paymentData);
        console.log(`💳 Cliente ${customer.index}: Pagamento enviado`);
    }

    /**
     * ✅ Aceitar corrida (motorista)
     */
    async acceptRide(driverId, rideId) {
        const driver = this.activeConnections.get(driverId);
        if (!driver) return;

        driver.socket.emit('driverResponse', {
            bookingId: rideId,
            accepted: true,
            reason: null
        });
        
        console.log(`✅ Motorista ${driver.index}: Aceitando corrida ${rideId}`);
    }

    /**
     * 🚀 Iniciar viagem
     */
    async startTrip(customer, testId) {
        if (!customer.testData.rideId) {
            throw new Error('Ride ID não disponível para iniciar viagem');
        }

        customer.socket.emit('startTrip', {
            bookingId: customer.testData.rideId,
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
        if (!customer.testData.rideId) {
            throw new Error('Ride ID não disponível para finalizar viagem');
        }

        customer.socket.emit('completeTrip', {
            bookingId: customer.testData.rideId,
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
     * ⏳ Aguardar evento específico
     */
    async waitForEvent(testData, expectedStatus, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const checkStatus = () => {
                if (testData.status === expectedStatus) {
                    resolve();
                } else if (Date.now() - startTime > timeout) {
                    reject(new Error(`Timeout aguardando ${expectedStatus}`));
                } else {
                    setTimeout(checkStatus, 100);
                }
            };
            
            checkStatus();
        });
    }

    /**
     * ⏳ Aguardar conclusão dos testes
     */
    async waitForTestCompletion() {
        console.log('⏳ Aguardando conclusão dos testes...');
        
        const maxWaitTime = this.testConfig.testDuration;
        const startTime = Date.now();
        
        while (Date.now() - startTime < maxWaitTime) {
            const activeTests = this.testResults.filter(r => !r.success && !r.completed);
            if (activeTests.length === 0) {
                break;
            }
            
            await this.delay(1000);
        }
    }

    /**
     * 📊 Gerar relatório
     */
    generateReport() {
        console.log('\n📊 RELATÓRIO DE TESTE AUTOMATIZADO');
        console.log('='.repeat(50));
        
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
        
        // Salvar relatório em arquivo
        this.saveReportToFile();
    }

    /**
     * 💾 Salvar relatório em arquivo
     */
    saveReportToFile() {
        const fs = require('fs');
        const path = require('path');
        
        const reportData = {
            timestamp: new Date().toISOString(),
            config: this.testConfig,
            summary: {
                totalTests: this.testResults.length,
                successfulTests: this.testResults.filter(r => r.success).length,
                failedTests: this.testResults.filter(r => !r.success).length,
                successRate: (this.testResults.filter(r => r.success).length / this.testResults.length) * 100
            },
            results: this.testResults
        };
        
        const filename = `ride-test-report-${Date.now()}.json`;
        const filepath = path.join(__dirname, filename);
        
        fs.writeFileSync(filepath, JSON.stringify(reportData, null, 2));
        console.log(`💾 Relatório salvo em: ${filepath}`);
    }

    /**
     * 🧹 Limpar conexões
     */
    cleanupConnections() {
        console.log('🧹 Limpando conexões...');
        
        this.activeConnections.forEach((connection, id) => {
            if (connection.socket) {
                connection.socket.disconnect();
            }
        });
        
        this.activeConnections.clear();
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
    const tester = new AutomatedRideTester({
        customerCount: 3,
        driverCount: 2,
        testDuration: 60000,
        delayBetweenTests: 5000
    });
    
    tester.runCompleteTest().catch(console.error);
}

module.exports = AutomatedRideTester;






