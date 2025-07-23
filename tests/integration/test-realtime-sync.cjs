const { io } = require('socket.io-client');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get } = require('firebase/database');
const { getAuth, signInAnonymously } = require('firebase/auth');

class RealtimeSyncTest {
    constructor() {
        this.testId = `realtime_sync_test_${Date.now()}`;
        this.driverId = `${this.testId}_driver`;
        this.ws = null;
        this.connected = false;
        
        // Firebase config
        this.firebaseConfig = {
            apiKey: "AIzaSyChYseG1IcmffYHHVYT7MqtLlzfdWKE_fc",
            authDomain: "leaf-reactnative.firebaseapp.com",
            databaseURL: "https://leaf-reactnative-default-rtdb.firebaseio.com",
            projectId: "leaf-reactnative",
            storageBucket: "leaf-reactnative.firebasestorage.app",
            messagingSenderId: "106504629884",
            appId: "1:106504629884:web:ada50a78fcf7bf3ea1a3f9",
            measurementId: "G-22368DBCY9"
        };
        
        this.app = initializeApp(this.firebaseConfig);
        this.database = getDatabase(this.app);
        this.auth = getAuth(this.app);
        this.authenticated = false;
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async authenticateFirebase() {
        this.log('=== AUTENTICANDO NO FIREBASE ===', 'AUTH');
        
        try {
            const userCredential = await signInAnonymously(this.auth);
            this.authenticated = true;
            this.log(`✅ Autenticado: ${userCredential.user.uid}`, 'SUCCESS');
            return true;
        } catch (error) {
            this.log(`❌ Erro na autenticação: ${error.message}`, 'ERROR');
            return false;
        }
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

    async testLocationSync() {
        this.log('=== TESTE DE SINCRONIZAÇÃO DE LOCALIZAÇÃO ===', 'TEST');
        
        try {
            // 1. Autenticar motorista no backend
            this.log('1. Autenticando motorista no backend...');
            await this.sendMessage('authenticate', { uid: this.driverId });
            await this.wait(1000);
            
            // 2. Enviar localização
            this.log('2. Enviando localização...');
            const location = {
                lat: -23.5505,
                lng: -46.6333
            };
            
            await this.sendMessage('updateLocation', location);
            await this.wait(3000); // Aguardar mais tempo para sincronização
            
            // 3. Verificar se foi salvo no Realtime Database
            this.log('3. Verificando sincronização com Realtime Database...');
            
            const locationRef = ref(this.database, `locations/${this.driverId}`);
            const snapshot = await get(locationRef);
            
            if (snapshot.exists()) {
                const data = snapshot.val();
                this.log('✅ Localização encontrada no Realtime Database:', 'SUCCESS');
                this.log(`   Lat: ${data.lat}`, 'INFO');
                this.log(`   Lng: ${data.lng}`, 'INFO');
                this.log(`   Status: ${data.status}`, 'INFO');
                this.log(`   Última atualização: ${data.lastUpdate}`, 'INFO');
                return true;
            } else {
                this.log('❌ Localização NÃO encontrada no Realtime Database', 'ERROR');
                this.log('🔍 Verificando se o backend está processando...', 'INFO');
                
                // Verificar se há outros dados no Realtime Database
                const allLocationsRef = ref(this.database, 'locations');
                const allSnapshot = await get(allLocationsRef);
                
                if (allSnapshot.exists()) {
                    const allData = allSnapshot.val();
                    this.log(`📊 Encontrados ${Object.keys(allData).length} registros de localização`, 'INFO');
                    Object.keys(allData).forEach(uid => {
                        this.log(`   - ${uid}: ${JSON.stringify(allData[uid])}`, 'INFO');
                    });
                } else {
                    this.log('📊 Nenhum registro de localização encontrado no Realtime Database', 'INFO');
                }
                
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro no teste: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testBackendHealth() {
        this.log('=== TESTE DE SAÚDE DO BACKEND ===', 'TEST');
        
        try {
            // Testar se o backend responde
            const response = await fetch('http://localhost:3001/health');
            const data = await response.json();
            
            this.log('✅ Backend respondendo:', 'SUCCESS');
            this.log(`   Status: ${data.status}`, 'INFO');
            this.log(`   Timestamp: ${data.timestamp}`, 'INFO');
            
            return true;
            
        } catch (error) {
            this.log(`❌ Erro ao testar backend: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async wait(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async cleanup() {
        this.log('=== LIMPEZA ===', 'CLEANUP');
        
        try {
            // Limpar dados de teste do Realtime Database
            const locationRef = ref(this.database, `locations/${this.driverId}`);
            await get(locationRef).then(snapshot => {
                if (snapshot.exists()) {
                    this.log('✅ Dados de teste encontrados para limpeza', 'SUCCESS');
                }
            });
            
            // Fechar WebSocket
            if (this.ws && this.connected) {
                this.ws.disconnect();
                this.log('✅ WebSocket desconectado', 'SUCCESS');
            }
            
        } catch (error) {
            this.log(`❌ Erro na limpeza: ${error.message}`, 'ERROR');
        }
    }

    async runRealtimeSyncTest() {
        this.log('🚀 INICIANDO TESTE DE SINCRONIZAÇÃO REALTIME DATABASE', 'START');
        
        const results = {
            auth: false,
            backendHealth: false,
            websocket: false,
            locationSync: false
        };
        
        try {
            // 1. Autenticação Firebase
            results.auth = await this.authenticateFirebase();
            if (!results.auth) {
                this.log('❌ Falha na autenticação Firebase', 'ERROR');
                return results;
            }
            
            // 2. Saúde do Backend
            results.backendHealth = await this.testBackendHealth();
            if (!results.backendHealth) {
                this.log('❌ Backend não está respondendo', 'ERROR');
                return results;
            }
            
            // 3. WebSocket
            results.websocket = await this.connectWebSocket();
            if (!results.websocket) {
                this.log('❌ Falha na conexão WebSocket', 'ERROR');
                return results;
            }
            
            // 4. Sincronização de Localização
            results.locationSync = await this.testLocationSync();
            
            // Relatório final
            this.log('', 'REPORT');
            this.log('=== RESULTADO FINAL ===', 'REPORT');
            this.log(`1. Firebase Auth: ${results.auth ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`2. Backend Health: ${results.backendHealth ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`3. WebSocket: ${results.websocket ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`4. Location Sync: ${results.locationSync ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            
            const passedTests = Object.values(results).filter(r => r).length;
            const totalTests = Object.keys(results).length;
            
            this.log(`\n📊 RESULTADO: ${passedTests}/${totalTests} testes passaram`, 'FINAL');
            
            if (results.locationSync) {
                this.log('🎉 SINCRONIZAÇÃO REALTIME DATABASE FUNCIONANDO!', 'SUCCESS');
            } else {
                this.log('🚨 PROBLEMA NA SINCRONIZAÇÃO REALTIME DATABASE', 'ERROR');
                this.log('🔧 Backend não está sincronizando com Firebase', 'ERROR');
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
async function runRealtimeSyncTest() {
    const tester = new RealtimeSyncTest();
    return await tester.runRealtimeSyncTest();
}

// Executar se chamado diretamente
if (require.main === module) {
    runRealtimeSyncTest()
        .then(results => {
            console.log('\n🏁 Teste de sincronização Realtime Database concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { RealtimeSyncTest, runRealtimeSyncTest }; 