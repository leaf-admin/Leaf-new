const { io } = require('socket.io-client');

// Configuração simplificada para teste WebSocket
const TEST_CONFIG = {
    WEBSOCKET: {
        HOST: 'localhost',
        PORT: 3001,
        URL: 'http://localhost:3001'
    },
    TIMEOUTS: {
        WEBSOCKET_CONNECTION: 10000,
        RESPONSE_TIME: 2000,
        CLEANUP: 1000
    }
};

class WebSocketOnlyTest {
    constructor() {
        this.testResults = [];
        this.driverId = `test_driver_${Date.now()}`;
        this.ws = null;
        this.connected = false;
        this.receivedMessages = [];
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
                
                // Capturar todas as mensagens recebidas
                this.ws.onAny((eventName, ...args) => {
                    this.log(`📨 Mensagem recebida: ${eventName}`, 'WEBSOCKET');
                    this.receivedMessages.push({ event: eventName, data: args, timestamp: Date.now() });
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

    async sendMessage(event, data) {
        if (!this.connected) {
            throw new Error('Socket.io não está conectado');
        }
        
        this.ws.emit(event, data);
        this.log(`📤 Enviando mensagem: ${event}`, 'WEBSOCKET');
    }

    async test1_basicConnection() {
        this.log('=== TESTE 1: Conexão Básica ===', 'TEST');
        
        try {
            // 1.1 Verificar se conectou
            if (this.connected) {
                this.log('✅ Conexão estabelecida com sucesso', 'SUCCESS');
                return true;
            } else {
                this.log('❌ Falha na conexão', 'ERROR');
                return false;
            }
        } catch (error) {
            this.log(`❌ Erro no teste de conexão: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async test2_authentication() {
        this.log('=== TESTE 2: Autenticação ===', 'TEST');
        
        try {
            // 2.1 Enviar autenticação
            this.log('2.1 - Enviando autenticação...');
            await this.sendMessage('authenticate', { uid: this.driverId });
            
            // 2.2 Aguardar resposta
            await this.wait(2000);
            
            // 2.3 Verificar se recebeu confirmação
            const authResponse = this.receivedMessages.find(msg => 
                msg.event === 'authenticated' && msg.data[0]?.uid === this.driverId
            );
            
            if (authResponse) {
                this.log('✅ Autenticação bem-sucedida', 'SUCCESS');
                return true;
            } else {
                this.log('❌ Falha na autenticação', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste de autenticação: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async test3_locationUpdate() {
        this.log('=== TESTE 3: Atualização de Localização ===', 'TEST');
        
        try {
            // 3.1 Enviar localização
            this.log('3.1 - Enviando localização...');
            const location = {
                lat: -23.5505,
                lng: -46.6333
            };
            
            await this.sendMessage('updateLocation', location);
            
            // 3.2 Aguardar resposta
            await this.wait(2000);
            
            // 3.3 Verificar se recebeu confirmação
            const locationResponse = this.receivedMessages.find(msg => 
                msg.event === 'locationUpdated' && msg.data[0]?.success === true
            );
            
            if (locationResponse) {
                this.log('✅ Localização atualizada com sucesso', 'SUCCESS');
                this.log(`   Lat: ${location.lat}, Lng: ${location.lng}`, 'INFO');
                return true;
            } else {
                this.log('❌ Falha ao atualizar localização', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste de localização: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async test4_driverStatus() {
        this.log('=== TESTE 4: Status do Motorista ===', 'TEST');
        
        try {
            // 4.1 Enviar status online
            this.log('4.1 - Enviando status online...');
            const status = {
                status: 'available',
                isOnline: true
            };
            
            await this.sendMessage('updateDriverStatus', status);
            
            // 4.2 Aguardar resposta
            await this.wait(2000);
            
            // 4.3 Verificar se recebeu confirmação
            const statusResponse = this.receivedMessages.find(msg => 
                msg.event === 'driverStatusUpdated' && msg.data[0]?.success === true
            );
            
            if (statusResponse) {
                this.log('✅ Status do motorista atualizado com sucesso', 'SUCCESS');
                return true;
            } else {
                this.log('❌ Falha ao atualizar status', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste de status: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async test5_pingPong() {
        this.log('=== TESTE 5: Ping/Pong ===', 'TEST');
        
        try {
            // 5.1 Enviar ping
            this.log('5.1 - Enviando ping...');
            const pingData = { test: true, timestamp: Date.now() };
            await this.sendMessage('ping', pingData);
            
            // 5.2 Aguardar pong
            await this.wait(2000);
            
            // 5.3 Verificar se recebeu pong
            const pongResponse = this.receivedMessages.find(msg => 
                msg.event === 'pong' && msg.data[0]?.pong === true
            );
            
            if (pongResponse) {
                this.log('✅ Ping/Pong funcionando corretamente', 'SUCCESS');
                return true;
            } else {
                this.log('❌ Falha no ping/pong', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste ping/pong: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async cleanup() {
        this.log('=== LIMPEZA ===', 'CLEANUP');
        
        try {
            // Fechar WebSocket
            if (this.ws && this.connected) {
                this.ws.disconnect();
            }
            
            this.log('✅ Conexão fechada com sucesso', 'SUCCESS');
        } catch (error) {
            this.log(`❌ Erro na limpeza: ${error.message}`, 'ERROR');
        }
    }

    async runAllTests() {
        this.log('🚀 INICIANDO TESTES WEBSOCKET SIMPLIFICADOS', 'START');
        this.log(`Motorista ID: ${this.driverId}`, 'INFO');
        this.log(`Backend URL: ${TEST_CONFIG.WEBSOCKET.URL}`, 'INFO');
        this.log('Foco: Comunicação WebSocket/Socket.io', 'INFO');
        
        const results = {
            connection: false,
            authentication: false,
            locationUpdate: false,
            driverStatus: false,
            pingPong: false
        };
        
        try {
            // Conectar ao WebSocket
            await this.connectWebSocket();
            await this.wait(TEST_CONFIG.TIMEOUTS.CLEANUP);
            
            // Executar testes
            results.connection = await this.test1_basicConnection();
            await this.wait(TEST_CONFIG.TIMEOUTS.CLEANUP);
            
            results.authentication = await this.test2_authentication();
            await this.wait(TEST_CONFIG.TIMEOUTS.CLEANUP);
            
            results.locationUpdate = await this.test3_locationUpdate();
            await this.wait(TEST_CONFIG.TIMEOUTS.CLEANUP);
            
            results.driverStatus = await this.test4_driverStatus();
            await this.wait(TEST_CONFIG.TIMEOUTS.CLEANUP);
            
            results.pingPong = await this.test5_pingPong();
            
            // Relatório final
            this.log('=== RELATÓRIO FINAL ===', 'REPORT');
            this.log(`1. Conexão Básica: ${results.connection ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`2. Autenticação: ${results.authentication ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`3. Atualização de Localização: ${results.locationUpdate ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`4. Status do Motorista: ${results.driverStatus ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`5. Ping/Pong: ${results.pingPong ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            
            const passedTests = Object.values(results).filter(r => r).length;
            const totalTests = Object.keys(results).length;
            
            this.log(`\n📊 RESULTADO: ${passedTests}/${totalTests} testes passaram`, 'FINAL');
            
            if (passedTests === totalTests) {
                this.log('🎉 TODOS OS TESTES PASSARAM!', 'SUCCESS');
                this.log('✅ Comunicação WebSocket funcionando perfeitamente', 'SUCCESS');
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
async function runWebSocketOnlyTests() {
    const tester = new WebSocketOnlyTest();
    return await tester.runAllTests();
}

// Exportar para uso em outros arquivos
module.exports = {
    WebSocketOnlyTest,
    runWebSocketOnlyTests
};

// Executar se chamado diretamente
if (require.main === module) {
    runWebSocketOnlyTests()
        .then(results => {
            console.log('\n🏁 Testes WebSocket simplificados concluídos!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
} 