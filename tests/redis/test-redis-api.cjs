const { io } = require('socket.io-client');
const fetch = require('node-fetch');

class RedisAPITest {
    constructor() {
        this.testId = `redis_api_test_${Date.now()}`;
        this.driverId = `${this.testId}_driver`;
        this.ws = null;
        this.connected = false;
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async connectWebSocket() {
        this.log('=== CONECTANDO AO BACKEND ===', 'WEBSOCKET');
        
        return new Promise((resolve, reject) => {
            try {
                this.ws = io('http://localhost:3001', {
                    transports: ['websocket', 'polling'],
                    timeout: 10000
                });
                
                this.ws.on('connect', () => {
                    this.connected = true;
                    this.log('✅ Conectado ao backend', 'SUCCESS');
                    resolve(true);
                });
                
                this.ws.on('disconnect', () => {
                    this.connected = false;
                    this.log('🔌 Desconectado do backend', 'WEBSOCKET');
                });
                
                this.ws.on('connect_error', (error) => {
                    this.log(`❌ Erro na conexão: ${error.message}`, 'ERROR');
                    reject(error);
                });
                
                setTimeout(() => {
                    if (!this.connected) {
                        reject(new Error('Timeout na conexão WebSocket'));
                    }
                }, 10000);
                
            } catch (error) {
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

    async testLocationUpdate() {
        this.log('=== TESTE 1: Atualização de Localização ===', 'TEST');
        
        try {
            // 1. Autenticar motorista
            this.log('1. Autenticando motorista...');
            await this.sendMessage('authenticate', { uid: this.driverId });
            await this.wait(1000);
            
            // 2. Enviar localização
            this.log('2. Enviando localização...');
            const location = {
                lat: -23.5505,
                lng: -46.6333
            };
            
            await this.sendMessage('updateLocation', location);
            await this.wait(2000);
            
            this.log('✅ Localização enviada via WebSocket', 'SUCCESS');
            return true;
            
        } catch (error) {
            this.log(`❌ Erro no teste 1: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testNearbyDriversAPI() {
        this.log('=== TESTE 2: API de Motoristas Próximos ===', 'TEST');
        
        try {
            // Buscar motoristas próximos via API
            const url = `http://localhost:3001/api/drivers/nearby?lat=-23.5505&lng=-46.6333&radius=5000&limit=10`;
            
            this.log(`3. Buscando motoristas próximos: ${url}`);
            const response = await fetch(url);
            const data = await response.json();
            
            if (response.ok) {
                this.log(`✅ API funcionando: ${data.count} motoristas encontrados`, 'SUCCESS');
                
                if (data.drivers && data.drivers.length > 0) {
                    this.log('📊 Motoristas encontrados:', 'INFO');
                    data.drivers.forEach((driver, index) => {
                        this.log(`   ${index + 1}. ${driver.uid}: ${driver.distance.toFixed(2)}km`, 'INFO');
                    });
                    
                    // Verificar se nosso motorista está na lista
                    const ourDriver = data.drivers.find(d => d.uid === this.driverId);
                    if (ourDriver) {
                        this.log(`✅ Nosso motorista encontrado na API!`, 'SUCCESS');
                        return true;
                    } else {
                        this.log(`❌ Nosso motorista não encontrado na API`, 'ERROR');
                        return false;
                    }
                } else {
                    this.log('⚠️ Nenhum motorista encontrado', 'WARNING');
                    return false;
                }
            } else {
                this.log(`❌ Erro na API: ${data.error}`, 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste 2: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testDriverLocationAPI() {
        this.log('=== TESTE 3: API de Localização Específica ===', 'TEST');
        
        try {
            // Buscar localização específica do motorista
            const url = `http://localhost:3001/api/drivers/${this.driverId}/location`;
            
            this.log(`4. Buscando localização específica: ${url}`);
            const response = await fetch(url);
            const data = await response.json();
            
            if (response.ok) {
                this.log('✅ Localização específica encontrada:', 'SUCCESS');
                this.log(`   UID: ${data.uid}`, 'INFO');
                this.log(`   Lat: ${data.lat}`, 'INFO');
                this.log(`   Lng: ${data.lng}`, 'INFO');
                this.log(`   Status: ${data.status}`, 'INFO');
                this.log(`   Última atualização: ${data.lastUpdate}`, 'INFO');
                return true;
            } else {
                this.log(`❌ Erro na API: ${data.error}`, 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste 3: ${error.message}`, 'ERROR');
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
                this.log('✅ WebSocket desconectado', 'SUCCESS');
            }
            
        } catch (error) {
            this.log(`❌ Erro na limpeza: ${error.message}`, 'ERROR');
        }
    }

    async runAPITest() {
        this.log('🚀 INICIANDO TESTE DA API REDIS', 'START');
        
        const results = {
            websocket: false,
            locationUpdate: false,
            nearbyAPI: false,
            specificAPI: false
        };
        
        try {
            // 1. WebSocket
            results.websocket = await this.connectWebSocket();
            await this.wait(1000);
            
            if (!results.websocket) {
                this.log('❌ Falha na conexão WebSocket', 'ERROR');
                return results;
            }
            
            // 2. Atualização de localização
            results.locationUpdate = await this.testLocationUpdate();
            await this.wait(2000);
            
            // 3. API de motoristas próximos
            results.nearbyAPI = await this.testNearbyDriversAPI();
            await this.wait(1000);
            
            // 4. API de localização específica
            results.specificAPI = await this.testDriverLocationAPI();
            
            // Relatório final
            this.log('', 'REPORT');
            this.log('=== RESULTADO FINAL ===', 'REPORT');
            this.log(`1. WebSocket: ${results.websocket ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`2. Atualização Localização: ${results.locationUpdate ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`3. API Motoristas Próximos: ${results.nearbyAPI ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`4. API Localização Específica: ${results.specificAPI ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            
            const passedTests = Object.values(results).filter(r => r).length;
            const totalTests = Object.keys(results).length;
            
            this.log(`\n📊 RESULTADO: ${passedTests}/${totalTests} testes passaram`, 'FINAL');
            
            if (results.nearbyAPI && results.specificAPI) {
                this.log('🎉 API REDIS FUNCIONANDO!', 'SUCCESS');
                this.log('✅ App mobile pode buscar motoristas via API', 'SUCCESS');
            } else {
                this.log('🚨 API COM PROBLEMAS', 'ERROR');
                this.log('🔧 Backend precisa ser ajustado', 'ERROR');
            }
            
        } catch (error) {
            this.log(`❌ Erro durante os testes: ${error.message}`, 'ERROR');
        } finally {
            await this.cleanup();
        }
        
        return results;
    }
}

// Executar teste
async function runRedisAPITest() {
    const tester = new RedisAPITest();
    return await tester.runAPITest();
}

// Executar se chamado diretamente
if (require.main === module) {
    runRedisAPITest()
        .then(results => {
            console.log('\n🏁 Teste da API Redis concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { RedisAPITest, runRedisAPITest }; 