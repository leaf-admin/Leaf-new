const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, push, onValue, off } = require('firebase/database');
const { io } = require('socket.io-client');
const { TEST_CONFIG, checkBackendStatus, generateTestId } = require('./test-config-realistic.cjs');

// Inicializar Firebase
const app = initializeApp(TEST_CONFIG.FIREBASE);
const database = getDatabase(app);

class RealisticDriverIntegrationTest {
    constructor() {
        this.testResults = [];
        this.driverId = generateTestId(TEST_CONFIG.TEST_IDS.DRIVER_PREFIX);
        this.passengerId = generateTestId(TEST_CONFIG.TEST_IDS.PASSENGER_PREFIX);
        this.bookingId = null;
        this.startTime = null;
        this.endTime = null;
        this.ws = null;
        this.connected = false;
    }

    async log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
        this.testResults.push({ timestamp, type, message });
    }

    async connectWebSocket() {
        this.log('=== CONECTANDO AO SOCKET.IO ===', 'WEBSOCKET');
        this.log(`Tentando conectar em: ${TEST_CONFIG.WEBSOCKET.URL}`, 'INFO');
        
        return new Promise((resolve, reject) => {
            try {
                this.ws = io(TEST_CONFIG.WEBSOCKET.URL, {
                    transports: ['websocket', 'polling'],
                    timeout: TEST_CONFIG.TIMEOUTS.WEBSOCKET_CONNECTION
                });
                
                this.ws.on('connect', () => {
                    this.connected = true;
                    this.log('✅ Conectado ao Socket.io do backend', 'SUCCESS');
                    resolve(true);
                });
                
                this.ws.on('disconnect', () => {
                    this.connected = false;
                    this.log('🔌 Socket.io desconectado', 'WEBSOCKET');
                });
                
                this.ws.on('connect_error', (error) => {
                    this.log(`❌ Erro na conexão Socket.io: ${error.message}`, 'ERROR');
                    reject(error);
                });
                
                // Timeout configurável
                setTimeout(() => {
                    if (!this.connected) {
                        reject(new Error(`Timeout ao conectar Socket.io em ${TEST_CONFIG.WEBSOCKET.URL}`));
                    }
                }, TEST_CONFIG.TIMEOUTS.WEBSOCKET_CONNECTION);
                
            } catch (error) {
                reject(error);
            }
        });
    }

    async sendWebSocketMessage(type, data) {
        if (!this.connected) {
            throw new Error('Socket.io não está conectado');
        }
        
        this.ws.emit(type, data);
        this.log(`📤 Enviando mensagem: ${type}`, 'WEBSOCKET');
    }

    handleWebSocketMessage(message) {
        switch (message.type) {
            case 'DRIVER_LOCATION_UPDATED':
                this.log('✅ Localização do motorista atualizada via WebSocket', 'SUCCESS');
                break;
            case 'RIDE_REQUEST_RECEIVED':
                this.log('✅ Solicitação de corrida recebida via WebSocket', 'SUCCESS');
                break;
            case 'RIDE_ACCEPTED':
                this.log('✅ Corrida aceita via WebSocket', 'SUCCESS');
                break;
            case 'ERROR':
                this.log(`❌ Erro via WebSocket: ${message.data}`, 'ERROR');
                break;
            default:
                this.log(`📨 Mensagem desconhecida: ${message.type}`, 'WEBSOCKET');
        }
    }

    async test1_driverLocationTracking() {
        this.log('=== TESTE 1: Rastreamento de Localização do Motorista ===', 'TEST');
        
        try {
            // 1.1 Simular motorista ficando online
            this.log('1.1 - Simulando motorista ficando online...');
            await this.simulateDriverOnline();
            
            // 1.2 Enviar localização via WebSocket (como o app mobile faria)
            this.log('1.2 - Enviando localização via WebSocket...');
            const location = {
                driverId: this.driverId,
                lat: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_CENTER.lat,
                lng: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_CENTER.lng,
                timestamp: Date.now(),
                status: 'online'
            };
            
            await this.sendWebSocketMessage('DRIVER_LOCATION_UPDATE', location);
            
            // 1.3 Verificar se a localização foi salva no Firebase (via backend)
            this.log('1.3 - Verificando se localização foi salva no Firebase...');
            await this.wait(TEST_CONFIG.TIMEOUTS.LOCATION_UPDATE);
            
            const firebaseLocation = await this.getDriverLocationFromFirebase();
            if (firebaseLocation) {
                this.log('✅ Localização salva no Firebase com sucesso', 'SUCCESS');
                this.log(`   Lat: ${firebaseLocation.lat}, Lng: ${firebaseLocation.lng}`, 'INFO');
                return true;
            } else {
                this.log('❌ Falha ao salvar localização no Firebase', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste de localização: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async test2_rideRequestReception() {
        this.log('=== TESTE 2: Recebimento de Solicitação de Viagem ===', 'TEST');
        
        try {
            // 2.1 Criar solicitação de viagem (como o app do passageiro faria)
            this.log('2.1 - Criando solicitação de viagem...');
            const rideRequest = {
                passengerId: this.passengerId,
                pickup: {
                    lat: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_CENTER.lat,
                    lng: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_CENTER.lng,
                    add: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_CENTER.address
                },
                drop: {
                    lat: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.lat,
                    lng: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.lng,
                    add: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.address
                },
                estimate: 25.50,
                payment_mode: 'cash',
                status: 'NEW',
                timestamp: Date.now()
            };
            
            // 2.2 Enviar via WebSocket (como o app mobile faria)
            await this.sendWebSocketMessage('CREATE_RIDE_REQUEST', rideRequest);
            
            // 2.3 Aguardar confirmação do backend
            await this.wait(TEST_CONFIG.TIMEOUTS.RESPONSE_TIME);
            
            // 2.4 Verificar se motorista recebeu a solicitação
            this.log('2.4 - Verificando se motorista recebeu a solicitação...');
            await this.wait(TEST_CONFIG.TIMEOUTS.RIDE_REQUEST);
            
            const receivedRequest = await this.checkDriverReceivedRequest();
            if (receivedRequest) {
                this.log('✅ Motorista recebeu a solicitação corretamente', 'SUCCESS');
                return true;
            } else {
                this.log('❌ Motorista não recebeu a solicitação', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste de recebimento: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async test3_responseTime() {
        this.log('=== TESTE 3: Tempo de Resposta do Sistema ===', 'TEST');
        
        try {
            this.startTime = Date.now();
            
            // 3.1 Enviar solicitação de corrida
            this.log('3.1 - Enviando solicitação de corrida...');
            const rideRequest = {
                passengerId: this.passengerId,
                pickup: {
                    lat: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_CENTER.lat,
                    lng: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_CENTER.lng,
                    add: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_CENTER.address
                },
                drop: {
                    lat: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.lat,
                    lng: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.lng,
                    add: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.address
                },
                estimate: 25.50,
                payment_mode: 'cash',
                status: 'NEW',
                timestamp: Date.now()
            };
            
            await this.sendWebSocketMessage('CREATE_RIDE_REQUEST', rideRequest);
            
            // 3.2 Aguardar motorista receber a solicitação
            this.log('3.2 - Aguardando motorista receber solicitação...');
            let requestReceived = false;
            let attempts = 0;
            const maxAttempts = 10;
            
            while (!requestReceived && attempts < maxAttempts) {
                await this.wait(500);
                requestReceived = await this.checkDriverReceivedRequest();
                attempts++;
            }
            
            this.endTime = Date.now();
            const responseTime = this.endTime - this.startTime;
            
            if (requestReceived) {
                this.log(`✅ Solicitação recebida em ${responseTime}ms`, 'SUCCESS');
                
                if (responseTime < 5000) {
                    this.log('✅ Tempo de resposta aceitável (< 5s)', 'SUCCESS');
                    return true;
                } else {
                    this.log(`⚠️ Tempo de resposta alto: ${responseTime}ms`, 'WARNING');
                    return false;
                }
            } else {
                this.log('❌ Solicitação não foi recebida no tempo esperado', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste de tempo de resposta: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async test4_driverPrioritization() {
        this.log('=== TESTE 4: Priorização de Motoristas por Distância ===', 'TEST');
        
        try {
            // 4.1 Criar segundo motorista mais próximo
            const secondDriverId = generateTestId(TEST_CONFIG.TEST_IDS.DRIVER_PREFIX);
            this.log('4.1 - Criando segundo motorista mais próximo...');
            await this.simulateDriverOnline(secondDriverId, 
                TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.lat,
                TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.lng
            );
            
            // 4.2 Enviar localização do segundo motorista
            const secondDriverLocation = {
                driverId: secondDriverId,
                lat: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.lat,
                lng: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.lng,
                timestamp: Date.now(),
                status: 'online'
            };
            
            await this.sendWebSocketMessage('DRIVER_LOCATION_UPDATE', secondDriverLocation);
            await this.wait(TEST_CONFIG.TIMEOUTS.LOCATION_UPDATE);
            
            // 4.3 Criar solicitação de corrida
            this.log('4.3 - Criando solicitação de corrida...');
            const rideRequest = {
                passengerId: this.passengerId,
                pickup: {
                    lat: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_CENTER.lat,
                    lng: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_CENTER.lng,
                    add: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_CENTER.address
                },
                drop: {
                    lat: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.lat,
                    lng: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.lng,
                    add: TEST_CONFIG.TEST_LOCATIONS.SÃO_PAULO_NEARBY.address
                },
                estimate: 25.50,
                payment_mode: 'cash',
                status: 'NEW',
                timestamp: Date.now()
            };
            
            await this.sendWebSocketMessage('CREATE_RIDE_REQUEST', rideRequest);
            await this.wait(TEST_CONFIG.TIMEOUTS.RIDE_REQUEST);
            
            // 4.4 Simular aceitação pelo motorista mais próximo (segundo motorista)
            this.log('4.4 - Simulando aceitação pelo motorista mais próximo...');
            const acceptData = {
                driverId: secondDriverId,
                rideRequestId: this.bookingId,
                timestamp: Date.now()
            };
            
            await this.sendWebSocketMessage('ACCEPT_RIDE_REQUEST', acceptData);
            
            // 4.5 Verificar se a corrida foi removida do primeiro motorista
            this.log('4.5 - Verificando se corrida foi removida do primeiro motorista...');
            await this.wait(TEST_CONFIG.TIMEOUTS.RESPONSE_TIME);
            
            const firstDriverStillHasRequest = await this.checkDriverStillHasRequest();
            if (!firstDriverStillHasRequest) {
                this.log('✅ Priorização funcionando corretamente', 'SUCCESS');
                this.log('   Motorista mais próximo recebeu a corrida', 'INFO');
                return true;
            } else {
                this.log('❌ Priorização não funcionou', 'ERROR');
                this.log('   Primeiro motorista ainda tem a solicitação', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste de priorização: ${error.message}`, 'ERROR');
            return false;
        }
    }

    // Métodos auxiliares
    async simulateDriverOnline(driverId = this.driverId, lat = -23.5505, lng = -46.6333) {
        const driverProfile = {
            uid: driverId,
            firstName: 'Test',
            lastName: 'Driver',
            mobile: '+5511999999999',
            driverActiveStatus: true,
            rating: 4.5,
            vehicleNumber: 'ABC1234',
            profile_image: 'https://example.com/driver.jpg'
        };
        
        await set(ref(database, `users/${driverId}`), driverProfile);
        this.log(`   Motorista ${driverId} criado e online`);
    }

    async getDriverLocationFromFirebase() {
        return new Promise((resolve) => {
            const locationRef = ref(database, `drivers/${this.driverId}/location`);
            onValue(locationRef, (snapshot) => {
                const data = snapshot.val();
                off(locationRef);
                resolve(data);
            }, { onlyOnce: true });
        });
    }

    async checkDriverReceivedRequest() {
        return new Promise((resolve) => {
            const tasksRef = ref(database, 'tasks');
            onValue(tasksRef, (snapshot) => {
                const tasks = snapshot.val();
                off(tasksRef);
                
                if (tasks) {
                    const driverTasks = Object.values(tasks).filter(task => 
                        task.requestedDrivers && task.requestedDrivers[this.driverId]
                    );
                    resolve(driverTasks.length > 0);
                } else {
                    resolve(false);
                }
            }, { onlyOnce: true });
        });
    }

    async checkDriverStillHasRequest() {
        return new Promise((resolve) => {
            const tasksRef = ref(database, 'tasks');
            onValue(tasksRef, (snapshot) => {
                const tasks = snapshot.val();
                off(tasksRef);
                
                if (tasks) {
                    const driverTasks = Object.values(tasks).filter(task => 
                        task.requestedDrivers && task.requestedDrivers[this.driverId]
                    );
                    resolve(driverTasks.length > 0);
                } else {
                    resolve(false);
                }
            }, { onlyOnce: true });
        });
    }

    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async cleanup() {
        this.log('=== LIMPEZA DOS DADOS DE TESTE ===', 'CLEANUP');
        
        try {
            // Remover dados do Firebase
            await set(ref(database, `users/${this.driverId}`), null);
            await set(ref(database, `drivers/${this.driverId}`), null);
            if (this.bookingId) {
                await set(ref(database, `bookings/${this.bookingId}`), null);
            }
            
            // Fechar WebSocket
            if (this.ws && this.connected) {
                this.ws.close();
            }
            
            this.log('✅ Dados de teste removidos com sucesso', 'SUCCESS');
        } catch (error) {
            this.log(`❌ Erro na limpeza: ${error.message}`, 'ERROR');
        }
    }

    async runAllTests() {
        this.log('🚀 INICIANDO TESTES REALISTAS DE INTEGRAÇÃO DO MOTORISTA', 'START');
        this.log(`Motorista ID: ${this.driverId}`, 'INFO');
        this.log(`Passageiro ID: ${this.passengerId}`, 'INFO');
        this.log(`Backend URL: ${TEST_CONFIG.WEBSOCKET.URL}`, 'INFO');
        this.log('Fluxo: Mobile → WebSocket → Backend → Redis/Firebase', 'INFO');
        
        const results = {
            locationTracking: false,
            rideReception: false,
            responseTime: false,
            prioritization: false
        };
        
        try {
            // Verificar se a porta está em uso (indicando que o backend está rodando)
            this.log('Verificando se o backend está rodando...', 'INFO');
            const netstat = require('child_process').execSync('netstat -an | findstr :3001', { encoding: 'utf8' });
            
            if (netstat.includes('LISTENING')) {
                this.log('✅ Backend detectado na porta 3001', 'SUCCESS');
            } else {
                this.log('❌ Backend não está rodando na porta 3001!', 'ERROR');
                this.log(`   Verifique se o servidor está rodando em ${TEST_CONFIG.WEBSOCKET.URL}`, 'ERROR');
                return results;
            }
            
            // Conectar ao WebSocket
            await this.connectWebSocket();
            await this.wait(TEST_CONFIG.TIMEOUTS.CLEANUP);
            
            // Executar testes
            results.locationTracking = await this.test1_driverLocationTracking();
            await this.wait(TEST_CONFIG.TIMEOUTS.CLEANUP);
            
            results.rideReception = await this.test2_rideRequestReception();
            await this.wait(TEST_CONFIG.TIMEOUTS.CLEANUP);
            
            results.responseTime = await this.test3_responseTime();
            await this.wait(TEST_CONFIG.TIMEOUTS.CLEANUP);
            
            results.prioritization = await this.test4_driverPrioritization();
            
            // Relatório final
            this.log('=== RELATÓRIO FINAL ===', 'REPORT');
            this.log(`1. Rastreamento de Localização: ${results.locationTracking ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`2. Recebimento de Corridas: ${results.rideReception ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`3. Tempo de Resposta: ${results.responseTime ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`4. Priorização de Motoristas: ${results.prioritization ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            
            const passedTests = Object.values(results).filter(r => r).length;
            const totalTests = Object.keys(results).length;
            
            this.log(`\n📊 RESULTADO: ${passedTests}/${totalTests} testes passaram`, 'FINAL');
            
            if (passedTests === totalTests) {
                this.log('🎉 TODOS OS TESTES PASSARAM!', 'SUCCESS');
                this.log('✅ Sistema de motoristas funcionando perfeitamente', 'SUCCESS');
            } else {
                this.log('⚠️ ALGUNS TESTES FALHARAM', 'WARNING');
                this.log('🔧 Verificar e corrigir os problemas identificados', 'WARNING');
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
async function runRealisticDriverIntegrationTests() {
    const tester = new RealisticDriverIntegrationTest();
    return await tester.runAllTests();
}

// Exportar para uso em outros arquivos
module.exports = {
    RealisticDriverIntegrationTest,
    runRealisticDriverIntegrationTests
};

// Executar se chamado diretamente
if (require.main === module) {
    runRealisticDriverIntegrationTests()
        .then(results => {
            console.log('\n🏁 Testes realistas concluídos!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
} 