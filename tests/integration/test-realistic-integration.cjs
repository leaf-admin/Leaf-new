const { io } = require('socket.io-client');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get, push, onValue, off } = require('firebase/database');
const { getAuth, signInAnonymously, onAuthStateChanged } = require('firebase/auth');

// Configuração real do Firebase
const firebaseConfig = {
    apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
    authDomain: "leaf-reactnative.firebaseapp.com",
    databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
    projectId: "leaf-reactnative",
    storageBucket: "leaf-reactnative.firebasestorage.app",
    messagingSenderId: "106504629884",
    appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
    measurementId: "G-22368DBCY9"
};

// Inicializar Firebase
const app = initializeApp(firebaseConfig);
const database = getDatabase(app);
const auth = getAuth(app);

class RealisticIntegrationTest {
    constructor() {
        this.testResults = [];
        this.driverId = `test_driver_${Date.now()}`;
        this.passengerId = `test_passenger_${Date.now()}`;
        this.bookingId = `test_booking_${Date.now()}`;
        this.ws = null;
        this.connected = false;
        this.receivedMessages = [];
        this.startTimes = {};
        this.endTimes = {};
        this.latencies = {};
        this.authenticated = false;
    }

    async log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
        this.testResults.push({ timestamp, type, message });
    }

    startTimer(testName) {
        this.startTimes[testName] = Date.now();
        this.log(`⏱️ Iniciando timer para: ${testName}`, 'TIMER');
    }

    endTimer(testName) {
        if (this.startTimes[testName]) {
            this.endTimes[testName] = Date.now();
            this.latencies[testName] = this.endTimes[testName] - this.startTimes[testName];
            this.log(`⏱️ ${testName}: ${this.latencies[testName]}ms`, 'LATENCY');
        }
    }

    async authenticateFirebase() {
        this.startTimer('firebase_auth');
        this.log('=== AUTENTICANDO NO FIREBASE ===', 'AUTH');
        
        return new Promise((resolve, reject) => {
            try {
                // Autenticação anônima para testes
                signInAnonymously(auth)
                    .then((result) => {
                        this.authenticated = true;
                        this.endTimer('firebase_auth');
                        this.log(`✅ Autenticado no Firebase: ${result.user.uid}`, 'SUCCESS');
                        resolve(result.user);
                    })
                    .catch((error) => {
                        this.endTimer('firebase_auth');
                        this.log(`❌ Erro na autenticação: ${error.message}`, 'ERROR');
                        reject(error);
                    });
            } catch (error) {
                this.endTimer('firebase_auth');
                reject(error);
            }
        });
    }

    async connectWebSocket() {
        this.startTimer('websocket_connection');
        this.log('=== CONECTANDO AO BACKEND ===', 'WEBSOCKET');
        
        return new Promise((resolve, reject) => {
            try {
                this.ws = io('http://localhost:3001', {
                    transports: ['websocket', 'polling'],
                    timeout: 10000
                });
                
                this.ws.on('connect', () => {
                    this.connected = true;
                    this.endTimer('websocket_connection');
                    this.log('✅ Conectado ao backend via Socket.io', 'SUCCESS');
                    resolve(true);
                });
                
                this.ws.on('disconnect', () => {
                    this.connected = false;
                    this.log('🔌 Desconectado do backend', 'WEBSOCKET');
                });
                
                this.ws.on('connect_error', (error) => {
                    this.endTimer('websocket_connection');
                    this.log(`❌ Erro na conexão: ${error.message}`, 'ERROR');
                    reject(error);
                });
                
                // Capturar todas as mensagens para análise
                this.ws.onAny((eventName, ...args) => {
                    this.log(`📨 Recebido: ${eventName}`, 'WEBSOCKET');
                    this.receivedMessages.push({ 
                        event: eventName, 
                        data: args, 
                        timestamp: Date.now() 
                    });
                });
                
                setTimeout(() => {
                    if (!this.connected) {
                        this.endTimer('websocket_connection');
                        reject(new Error('Timeout na conexão WebSocket'));
                    }
                }, 10000);
                
            } catch (error) {
                this.endTimer('websocket_connection');
                reject(error);
            }
        });
    }

    async sendMessage(event, data) {
        if (!this.connected) {
            throw new Error('WebSocket não conectado');
        }
        
        this.ws.emit(event, data);
        this.log(`📤 Enviando: ${event}`, 'WEBSOCKET');
    }

    async test1_driverOnlineFlow() {
        this.log('=== TESTE 1: Motorista Ficando Online ===', 'TEST');
        this.startTimer('driver_online_flow');
        
        try {
            // Verificar se está autenticado
            if (!this.authenticated) {
                throw new Error('Firebase não autenticado');
            }

            // 1.1 Criar perfil do motorista no Firebase
            this.log('1.1 - Criando perfil do motorista no Firebase...');
            const driverProfile = {
                uid: this.driverId,
                firstName: 'Test',
                lastName: 'Driver',
                mobile: '+5511999999999',
                usertype: 'driver',
                driverActiveStatus: true,
                rating: 4.5,
                vehicleNumber: 'ABC1234',
                profile_image: 'https://example.com/driver.jpg',
                createdAt: new Date().toISOString()
            };
            
            await set(ref(database, `users/${this.driverId}`), driverProfile);
            this.log('✅ Perfil do motorista criado no Firebase', 'SUCCESS');
            
            // 1.2 Autenticar no backend
            this.log('1.2 - Autenticando no backend...');
            await this.sendMessage('authenticate', { uid: this.driverId });
            await this.wait(2000);
            
            // 1.3 Enviar localização inicial
            this.log('1.3 - Enviando localização inicial...');
            const location = {
                lat: -23.5505,
                lng: -46.6333
            };
            
            await this.sendMessage('updateLocation', location);
            await this.wait(2000);
            
            // 1.4 Atualizar status para online
            this.log('1.4 - Atualizando status para online...');
            await this.sendMessage('updateDriverStatus', {
                status: 'available',
                isOnline: true
            });
            await this.wait(2000);
            
            this.endTimer('driver_online_flow');
            this.log('✅ Motorista online com sucesso', 'SUCCESS');
            return true;
            
        } catch (error) {
            this.endTimer('driver_online_flow');
            this.log(`❌ Erro no fluxo online: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async test2_rideRequestFlow() {
        this.log('=== TESTE 2: Solicitação de Corrida ===', 'TEST');
        this.startTimer('ride_request_flow');
        
        try {
            // Verificar se está autenticado
            if (!this.authenticated) {
                throw new Error('Firebase não autenticado');
            }

            // 2.1 Criar perfil do passageiro
            this.log('2.1 - Criando perfil do passageiro...');
            const passengerProfile = {
                uid: this.passengerId,
                firstName: 'Test',
                lastName: 'Passenger',
                mobile: '+5511888888888',
                usertype: 'customer',
                createdAt: new Date().toISOString()
            };
            
            await set(ref(database, `users/${this.passengerId}`), passengerProfile);
            
            // 2.2 Criar solicitação de corrida
            this.log('2.2 - Criando solicitação de corrida...');
            const rideRequest = {
                id: this.bookingId,
                customer: this.passengerId,
                passengerId: this.passengerId,
                pickup: {
                    lat: -23.5505,
                    lng: -46.6333,
                    add: 'Av. Paulista, 1000'
                },
                drop: {
                    lat: -23.5605,
                    lng: -46.6433,
                    add: 'Rua Augusta, 500'
                },
                estimate: 25.50,
                payment_mode: 'cash',
                status: 'NEW',
                createdAt: new Date().toISOString(),
                requestedDrivers: {
                    [this.driverId]: {
                        timestamp: Date.now(),
                        status: 'requested'
                    }
                }
            };
            
            await set(ref(database, `bookings/${this.bookingId}`), rideRequest);
            this.log('✅ Solicitação de corrida criada no Firebase', 'SUCCESS');
            
            // 2.3 Verificar se motorista recebeu a solicitação
            this.log('2.3 - Verificando se motorista recebeu a solicitação...');
            await this.wait(3000);
            
            const tasksRef = ref(database, 'tasks');
            const snapshot = await get(tasksRef);
            const tasks = snapshot.val();
            
            if (tasks && tasks[this.bookingId]) {
                this.log('✅ Motorista recebeu a solicitação', 'SUCCESS');
                this.endTimer('ride_request_flow');
                return true;
            } else {
                this.log('❌ Motorista não recebeu a solicitação', 'ERROR');
                this.endTimer('ride_request_flow');
                return false;
            }
            
        } catch (error) {
            this.endTimer('ride_request_flow');
            this.log(`❌ Erro no fluxo de solicitação: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async test3_rideAcceptanceFlow() {
        this.log('=== TESTE 3: Aceitação de Corrida ===', 'TEST');
        this.startTimer('ride_acceptance_flow');
        
        try {
            // 3.1 Simular aceitação da corrida
            this.log('3.1 - Simulando aceitação da corrida...');
            const acceptData = {
                bookingId: this.bookingId,
                driverId: this.driverId,
                timestamp: Date.now()
            };
            
            await this.sendMessage('acceptRide', acceptData);
            await this.wait(2000);
            
            // 3.2 Verificar se a corrida foi aceita no Firebase
            this.log('3.2 - Verificando aceitação no Firebase...');
            const bookingRef = ref(database, `bookings/${this.bookingId}`);
            const snapshot = await get(bookingRef);
            const booking = snapshot.val();
            
            if (booking && booking.status === 'ACCEPTED' && booking.driver === this.driverId) {
                this.log('✅ Corrida aceita com sucesso', 'SUCCESS');
                this.endTimer('ride_acceptance_flow');
                return true;
            } else {
                this.log('❌ Falha na aceitação da corrida', 'ERROR');
                this.endTimer('ride_acceptance_flow');
                return false;
            }
            
        } catch (error) {
            this.endTimer('ride_acceptance_flow');
            this.log(`❌ Erro no fluxo de aceitação: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async test4_tripStartFlow() {
        this.log('=== TESTE 4: Início da Viagem ===', 'TEST');
        this.startTimer('trip_start_flow');
        
        try {
            // 4.1 Simular início da viagem
            this.log('4.1 - Simulando início da viagem...');
            const startData = {
                bookingId: this.bookingId,
                driverId: this.driverId,
                startLocation: {
                    lat: -23.5505,
                    lng: -46.6333
                },
                startTime: Date.now()
            };
            
            await this.sendMessage('startTrip', startData);
            await this.wait(2000);
            
            // 4.2 Verificar se a viagem foi iniciada no Firebase
            this.log('4.2 - Verificando início no Firebase...');
            const bookingRef = ref(database, `bookings/${this.bookingId}`);
            const snapshot = await get(bookingRef);
            const booking = snapshot.val();
            
            if (booking && booking.status === 'STARTED') {
                this.log('✅ Viagem iniciada com sucesso', 'SUCCESS');
                this.endTimer('trip_start_flow');
                return true;
            } else {
                this.log('❌ Falha no início da viagem', 'ERROR');
                this.endTimer('trip_start_flow');
                return false;
            }
            
        } catch (error) {
            this.endTimer('trip_start_flow');
            this.log(`❌ Erro no fluxo de início: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async test5_tripEndFlow() {
        this.log('=== TESTE 5: Fim da Viagem ===', 'TEST');
        this.startTimer('trip_end_flow');
        
        try {
            // 5.1 Simular fim da viagem
            this.log('5.1 - Simulando fim da viagem...');
            const endData = {
                bookingId: this.bookingId,
                driverId: this.driverId,
                endLocation: {
                    lat: -23.5605,
                    lng: -46.6433
                },
                endTime: Date.now(),
                distance: 2.5,
                fare: 25.50
            };
            
            await this.sendMessage('finishTrip', endData);
            await this.wait(3000);
            
            // 5.2 Verificar se a viagem foi finalizada no Firebase
            this.log('5.2 - Verificando finalização no Firebase...');
            const bookingRef = ref(database, `bookings/${this.bookingId}`);
            const snapshot = await get(bookingRef);
            const booking = snapshot.val();
            
            if (booking && booking.status === 'COMPLETED') {
                this.log('✅ Viagem finalizada com sucesso', 'SUCCESS');
                this.endTimer('trip_end_flow');
                return true;
            } else {
                this.log('❌ Falha na finalização da viagem', 'ERROR');
                this.endTimer('trip_end_flow');
                return false;
            }
            
        } catch (error) {
            this.endTimer('trip_end_flow');
            this.log(`❌ Erro no fluxo de finalização: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async cleanup() {
        this.log('=== LIMPEZA DOS DADOS DE TESTE ===', 'CLEANUP');
        
        try {
            // Remover dados do Firebase
            await set(ref(database, `users/${this.driverId}`), null);
            await set(ref(database, `users/${this.passengerId}`), null);
            await set(ref(database, `bookings/${this.bookingId}`), null);
            await set(ref(database, `tasks/${this.bookingId}`), null);
            
            // Fechar WebSocket
            if (this.ws && this.connected) {
                this.ws.disconnect();
            }
            
            this.log('✅ Dados de teste removidos com sucesso', 'SUCCESS');
        } catch (error) {
            this.log(`❌ Erro na limpeza: ${error.message}`, 'ERROR');
        }
    }

    generateReport() {
        this.log('=== RELATÓRIO DE LATÊNCIA E OBSERVABILIDADE ===', 'REPORT');
        this.log('', 'REPORT');
        
        // Latências
        this.log('📊 LATÊNCIAS:', 'REPORT');
        Object.entries(this.latencies).forEach(([test, latency]) => {
            const status = latency < 5000 ? '✅' : latency < 10000 ? '⚠️' : '❌';
            this.log(`${status} ${test}: ${latency}ms`, 'REPORT');
        });
        
        // Estatísticas
        const latencies = Object.values(this.latencies);
        const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const maxLatency = Math.max(...latencies);
        const minLatency = Math.min(...latencies);
        
        this.log('', 'REPORT');
        this.log('📈 ESTATÍSTICAS:', 'REPORT');
        this.log(`   Média: ${avgLatency.toFixed(2)}ms`, 'REPORT');
        this.log(`   Máxima: ${maxLatency}ms`, 'REPORT');
        this.log(`   Mínima: ${minLatency}ms`, 'REPORT');
        
        // Observabilidade
        this.log('', 'REPORT');
        this.log('🔍 OBSERVABILIDADE:', 'REPORT');
        this.log(`   Mensagens WebSocket: ${this.receivedMessages.length}`, 'REPORT');
        this.log(`   Testes executados: ${Object.keys(this.latencies).length}`, 'REPORT');
        this.log(`   Logs gerados: ${this.testResults.length}`, 'REPORT');
    }

    async runAllTests() {
        this.log('🚀 INICIANDO TESTE REALISTA DE INTEGRAÇÃO', 'START');
        this.log(`Motorista ID: ${this.driverId}`, 'INFO');
        this.log(`Passageiro ID: ${this.passengerId}`, 'INFO');
        this.log(`Booking ID: ${this.bookingId}`, 'INFO');
        this.log('Fluxo: Mobile → WebSocket → Backend → Firebase', 'INFO');
        
        const results = {
            auth: false,
            connection: false,
            driverOnline: false,
            rideRequest: false,
            rideAcceptance: false,
            tripStart: false,
            tripEnd: false
        };
        
        try {
            // 1. Autenticar no Firebase
            results.auth = await this.authenticateFirebase();
            await this.wait(1000);
            
            if (!results.auth) {
                this.log('❌ Falha na autenticação Firebase', 'ERROR');
                return results;
            }
            
            // 2. Conectar ao WebSocket
            results.connection = await this.connectWebSocket();
            await this.wait(1000);
            
            if (!results.connection) {
                this.log('❌ Falha na conexão WebSocket', 'ERROR');
                return results;
            }
            
            // Executar testes
            results.driverOnline = await this.test1_driverOnlineFlow();
            await this.wait(1000);
            
            results.rideRequest = await this.test2_rideRequestFlow();
            await this.wait(1000);
            
            results.rideAcceptance = await this.test3_rideAcceptanceFlow();
            await this.wait(1000);
            
            results.tripStart = await this.test4_tripStartFlow();
            await this.wait(1000);
            
            results.tripEnd = await this.test5_tripEndFlow();
            
            // Gerar relatório
            this.generateReport();
            
            // Relatório final
            this.log('', 'REPORT');
            this.log('=== RESULTADO FINAL ===', 'REPORT');
            this.log(`1. Autenticação Firebase: ${results.auth ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`2. Conexão WebSocket: ${results.connection ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`3. Motorista Online: ${results.driverOnline ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`4. Solicitação de Corrida: ${results.rideRequest ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`5. Aceitação de Corrida: ${results.rideAcceptance ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`6. Início da Viagem: ${results.tripStart ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`7. Fim da Viagem: ${results.tripEnd ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            
            const passedTests = Object.values(results).filter(r => r).length;
            const totalTests = Object.keys(results).length;
            
            this.log(`\n📊 RESULTADO: ${passedTests}/${totalTests} testes passaram`, 'FINAL');
            
            if (passedTests === totalTests) {
                this.log('🎉 TODOS OS TESTES PASSARAM!', 'SUCCESS');
                this.log('✅ Sistema pronto para produção', 'SUCCESS');
            } else {
                this.log('⚠️ ALGUNS TESTES FALHARAM', 'WARNING');
                this.log('🔧 Ajustes necessários antes da produção', 'WARNING');
            }
            
        } catch (error) {
            this.log(`❌ Erro durante os testes: ${error.message}`, 'ERROR');
        } finally {
            await this.cleanup();
        }
        
        return results;
    }
}

// Função para executar os testes
async function runRealisticIntegrationTests() {
    const tester = new RealisticIntegrationTest();
    return await tester.runAllTests();
}

// Exportar para uso em outros arquivos
module.exports = {
    RealisticIntegrationTest,
    runRealisticIntegrationTests
};

// Executar se chamado diretamente
if (require.main === module) {
    runRealisticIntegrationTests()
        .then(results => {
            console.log('\n🏁 Teste realista de integração concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
} 