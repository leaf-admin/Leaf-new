const WebSocket = require('ws');

// Configuração simples
const BACKEND_URL = 'ws://localhost:3001';

class SimpleWebSocketTest {
    constructor() {
        this.testResults = [];
        this.ws = null;
        this.connected = false;
    }

    async log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
        this.testResults.push({ timestamp, type, message });
    }

    async testConnection() {
        this.log('=== TESTE DE CONEXÃO WEBSOCKET ===', 'TEST');
        
        return new Promise((resolve) => {
            try {
                this.log('Tentando conectar ao WebSocket...', 'INFO');
                
                this.ws = new WebSocket(BACKEND_URL);
                
                this.ws.on('open', () => {
                    this.connected = true;
                    this.log('✅ Conectado ao WebSocket!', 'SUCCESS');
                    this.ws.close();
                    resolve(true);
                });
                
                this.ws.on('error', (error) => {
                    this.log(`❌ Erro na conexão: ${error.message}`, 'ERROR');
                    resolve(false);
                });
                
                this.ws.on('close', () => {
                    this.connected = false;
                    this.log('🔌 Conexão fechada', 'INFO');
                });
                
                // Timeout de 5 segundos
                setTimeout(() => {
                    if (!this.connected) {
                        this.log('❌ Timeout na conexão', 'ERROR');
                        resolve(false);
                    }
                }, 5000);
                
            } catch (error) {
                this.log(`❌ Erro: ${error.message}`, 'ERROR');
                resolve(false);
            }
        });
    }

    async runTest() {
        this.log('🚀 INICIANDO TESTE WEBSOCKET SIMPLES', 'START');
        this.log(`Backend URL: ${BACKEND_URL}`, 'INFO');
        
        const result = await this.testConnection();
        
        this.log('=== RESULTADO ===', 'REPORT');
        if (result) {
            this.log('✅ CONEXÃO WEBSOCKET FUNCIONANDO!', 'SUCCESS');
            this.log('✅ Backend está respondendo corretamente', 'SUCCESS');
        } else {
            this.log('❌ CONEXÃO WEBSOCKET FALHOU!', 'ERROR');
            this.log('❌ Verificar se o backend está rodando', 'ERROR');
        }
        
        return result;
    }
}

// Executar teste
async function runSimpleTest() {
    const tester = new SimpleWebSocketTest();
    return await tester.runTest();
}

// Executar se chamado diretamente
if (require.main === module) {
    runSimpleTest()
        .then(result => {
            console.log('\n🏁 Teste concluído!');
            process.exit(result ? 0 : 1);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { SimpleWebSocketTest, runSimpleTest }; 