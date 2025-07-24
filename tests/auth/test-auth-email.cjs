const { io } = require('socket.io-client');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, set, get } = require('firebase/database');
const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } = require('firebase/auth');

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

class EmailAuthTest {
    constructor() {
        this.testId = `test_${Date.now()}`;
        this.testEmail = `test_${Date.now()}@leaf.com`;
        this.testPassword = 'Test123456!';
        this.ws = null;
        this.connected = false;
        this.authenticated = false;
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async authenticateFirebase() {
        this.log('=== TESTANDO AUTENTICAÇÃO FIREBASE (EMAIL) ===', 'AUTH');
        
        try {
            // Tentar fazer login primeiro
            this.log('Tentando login com usuário de teste...');
            const result = await signInWithEmailAndPassword(auth, this.testEmail, this.testPassword);
            this.authenticated = true;
            this.log(`✅ Login realizado: ${result.user.uid}`, 'SUCCESS');
            return true;
        } catch (error) {
            if (error.code === 'auth/user-not-found') {
                // Usuário não existe, vamos criar
                this.log('Usuário não existe, criando novo usuário...');
                try {
                    const result = await createUserWithEmailAndPassword(auth, this.testEmail, this.testPassword);
                    this.authenticated = true;
                    this.log(`✅ Usuário criado e autenticado: ${result.user.uid}`, 'SUCCESS');
                    return true;
                } catch (createError) {
                    this.log(`❌ Erro ao criar usuário: ${createError.message}`, 'ERROR');
                    return false;
                }
            } else {
                this.log(`❌ Erro na autenticação: ${error.message}`, 'ERROR');
                return false;
            }
        }
    }

    async testFirebaseWrite() {
        this.log('=== TESTANDO ESCRITA NO FIREBASE ===', 'TEST');
        
        if (!this.authenticated) {
            this.log('❌ Não autenticado no Firebase', 'ERROR');
            return false;
        }

        try {
            // Teste simples de escrita
            const testData = {
                test: true,
                timestamp: Date.now(),
                message: 'Teste de escrita',
                user: auth.currentUser.uid
            };
            
            await set(ref(database, `test/${this.testId}`), testData);
            this.log('✅ Escrita no Firebase funcionou', 'SUCCESS');
            
            // Teste de leitura
            const snapshot = await get(ref(database, `test/${this.testId}`));
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
            this.ws.emit('test', { 
                message: 'Teste de mensagem', 
                timestamp: Date.now(),
                user: auth.currentUser.uid
            });
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
                await set(ref(database, `test/${this.testId}`), null);
                this.log('✅ Dados de teste removidos', 'SUCCESS');
            }
            
            // Fechar WebSocket
            if (this.ws && this.connected) {
                this.ws.disconnect();
                this.log('✅ WebSocket desconectado', 'SUCCESS');
            }
            
            // Fazer logout
            if (auth.currentUser) {
                await auth.signOut();
                this.log('✅ Logout realizado', 'SUCCESS');
            }
            
        } catch (error) {
            this.log(`❌ Erro na limpeza: ${error.message}`, 'ERROR');
        }
    }

    async runTest() {
        this.log('🚀 INICIANDO TESTE DE AUTENTICAÇÃO COM EMAIL', 'START');
        this.log(`Email de teste: ${this.testEmail}`, 'INFO');
        
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
async function runEmailAuthTest() {
    const tester = new EmailAuthTest();
    return await tester.runTest();
}

// Executar se chamado diretamente
if (require.main === module) {
    runEmailAuthTest()
        .then(results => {
            console.log('\n🏁 Teste com email concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { EmailAuthTest, runEmailAuthTest }; 