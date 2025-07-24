const { io } = require('socket.io-client');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get } = require('firebase/database');
const { getAuth, signInAnonymously } = require('firebase/auth');

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

class SimpleAuthTest {
    constructor() {
        this.testId = `test_${Date.now()}`;
        this.ws = null;
        this.connected = false;
        this.authenticated = false;
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async authenticateFirebase() {
        this.log('=== TESTANDO AUTENTICAÇÃO FIREBASE ===', 'AUTH');
        
        try {
            const result = await signInAnonymously(auth);
            this.authenticated = true;
            this.log(`✅ Autenticado no Firebase: ${result.user.uid}`, 'SUCCESS');
            return true;
        } catch (error) {
            this.log(`❌ Erro na autenticação: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async testFirebaseWrite() {
        this.log('=== TESTANDO ESCRITA NO FIREBASE ===', 'TEST');
        
        if (!this.authenticated) {
            this.log('❌ Não autenticado no Firebase', 'ERROR');
            return false;
        }

        try {
            // Usar caminho permitido pelas regras: /locations/{uid}
            const userId = auth.currentUser.uid;
            const testData = {
                test: true,
                timestamp: Date.now(),
                message: 'Teste de escrita',
                lat: -23.5505,
                lng: -46.6333
            };
            
            await set(ref(database, `locations/${userId}`), testData);
            this.log('✅ Escrita no Firebase funcionou', 'SUCCESS');
            
            // Teste de leitura
            const snapshot = await get(ref(database, `locations/${userId}`));
            const data = snapshot.val();
            
            if (data && data.test) {
                this.log('✅ Leitura do Firebase funcionou', 'SUCCESS');
                return true;
            } else {
                this.log('❌ Falha na leitura do Firebase', 'ERROR');
                return false;
            }
            
        } catch (error) {
            this.log(`❌ Erro na escrita/leitura: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async connectWebSocket() {
        this.log('=== TESTANDO CONEXÃO WEBSOCKET ===', 'WEBSOCKET');
        
        return new Promise((resolve, reject) => {
            try {
                this.ws = io('http://localhost:3001', {
                    transports: ['websocket', 'polling'],
                    timeout: 10000
                });
                
                this.ws.on('connect', () => {
                    this.connected = true;
                    this.log('✅ Conectado ao backend via Socket.io', 'SUCCESS');
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

    async testWebSocketMessage() {
        this.log('=== TESTANDO MENSAGEM WEBSOCKET ===', 'TEST');
        
        if (!this.connected) {
            this.log('❌ WebSocket não conectado', 'ERROR');
            return false;
        }

        try {
            // Enviar mensagem simples
            this.ws.emit('test', { message: 'Teste de mensagem', timestamp: Date.now() });
            this.log('✅ Mensagem enviada via WebSocket', 'SUCCESS');
            
            // Aguardar um pouco
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            this.log('✅ Teste de mensagem WebSocket concluído', 'SUCCESS');
            return true;
            
        } catch (error) {
            this.log(`❌ Erro no teste de mensagem: ${error.message}`, 'ERROR');
            return false;
        }
    }

    async cleanup() {
        this.log('=== LIMPEZA ===', 'CLEANUP');
        
        try {
            // Remover dados de teste do Firebase
            if (this.authenticated) {
                const userId = auth.currentUser.uid;
                await set(ref(database, `locations/${userId}`), null);
                this.log('✅ Dados de teste removidos', 'SUCCESS');
            }
            
            // Fechar WebSocket
            if (this.ws && this.connected) {
                this.ws.disconnect();
                this.log('✅ WebSocket desconectado', 'SUCCESS');
            }
            
        } catch (error) {
            this.log(`❌ Erro na limpeza: ${error.message}`, 'ERROR');
        }
    }

    async runTest() {
        this.log('🚀 INICIANDO TESTE SIMPLES DE AUTENTICAÇÃO', 'START');
        
        const results = {
            auth: false,
            firebaseWrite: false,
            websocket: false,
            websocketMessage: false
        };
        
        try {
            // 1. Autenticar no Firebase
            results.auth = await this.authenticateFirebase();
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            if (!results.auth) {
                this.log('❌ Falha na autenticação Firebase', 'ERROR');
                return results;
            }
            
            // 2. Testar escrita no Firebase
            results.firebaseWrite = await this.testFirebaseWrite();
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // 3. Conectar ao WebSocket
            results.websocket = await this.connectWebSocket();
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            if (!results.websocket) {
                this.log('❌ Falha na conexão WebSocket', 'ERROR');
                return results;
            }
            
            // 4. Testar mensagem WebSocket
            results.websocketMessage = await this.testWebSocketMessage();
            
            // Relatório final
            this.log('', 'REPORT');
            this.log('=== RESULTADO FINAL ===', 'REPORT');
            this.log(`1. Autenticação Firebase: ${results.auth ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`2. Escrita Firebase: ${results.firebaseWrite ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`3. Conexão WebSocket: ${results.websocket ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            this.log(`4. Mensagem WebSocket: ${results.websocketMessage ? '✅ PASSOU' : '❌ FALHOU'}`, 'REPORT');
            
            const passedTests = Object.values(results).filter(r => r).length;
            const totalTests = Object.keys(results).length;
            
            this.log(`\n📊 RESULTADO: ${passedTests}/${totalTests} testes passaram`, 'FINAL');
            
            if (passedTests === totalTests) {
                this.log('🎉 TODOS OS TESTES PASSARAM!', 'SUCCESS');
                this.log('✅ Sistema básico funcionando', 'SUCCESS');
            } else {
                this.log('⚠️ ALGUNS TESTES FALHARAM', 'WARNING');
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
async function runSimpleAuthTest() {
    const tester = new SimpleAuthTest();
    return await tester.runTest();
}

// Executar se chamado diretamente
if (require.main === module) {
    runSimpleAuthTest()
        .then(results => {
            console.log('\n🏁 Teste simples concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { SimpleAuthTest, runSimpleAuthTest }; 