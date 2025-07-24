const { io } = require('socket.io-client');

class QuickLoadTest {
    constructor() {
        this.testId = `quick_load_${Date.now()}`;
        this.connections = [];
        this.metrics = {
            totalConnections: 0,
            successfulConnections: 0,
            failedConnections: 0,
            connectionTimes: []
        };
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async testConcurrentConnections(concurrentCount = 20) {
        this.log(`=== TESTE DE ${concurrentCount} CONEXÕES SIMULTÂNEAS ===`, 'PERFORMANCE');
        
        const startTime = Date.now();
        const connectionPromises = [];
        
        for (let i = 0; i < concurrentCount; i++) {
            const driverId = `${this.testId}_driver_${i}`;
            const promise = this.createConnection(driverId, i);
            connectionPromises.push(promise);
        }
        
        try {
            await Promise.all(connectionPromises);
            const totalTime = Date.now() - startTime;
            
            this.log(`✅ Teste de conexões concluído em ${totalTime}ms`, 'PERFORMANCE');
            this.log(`📊 Conexões bem-sucedidas: ${this.metrics.successfulConnections}/${concurrentCount}`, 'PERPORT');
            
            const avgConnectionTime = this.metrics.connectionTimes.length > 0 
                ? this.metrics.connectionTimes.reduce((sum, time) => sum + time, 0) / this.metrics.connectionTimes.length 
                : 0;
            
            this.log(`⏱️  Tempo médio de conexão: ${avgConnectionTime.toFixed(2)}ms`, 'PERPORT');
            
            return {
                totalConnections: concurrentCount,
                successfulConnections: this.metrics.successfulConnections,
                failedConnections: this.metrics.failedConnections,
                successRate: (this.metrics.successfulConnections / concurrentCount * 100).toFixed(2),
                avgConnectionTime: avgConnectionTime.toFixed(2),
                totalTime: totalTime
            };
            
        } catch (error) {
            this.log(`❌ Erro no teste: ${error.message}`, 'ERROR');
            return null;
        }
    }

    async createConnection(driverId, index) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const socket = io('http://localhost:3001', {
                transports: ['websocket'],
                timeout: 5000
            });
            
            socket.on('connect', async () => {
                const connectTime = Date.now() - startTime;
                this.metrics.connectionTimes.push(connectTime);
                
                try {
                    // Autenticar motorista
                    socket.emit('authenticate', { uid: driverId });
                    
                    await new Promise((resolveAuth) => {
                        socket.once('authenticated', (data) => {
                            if (data.success) {
                                this.metrics.successfulConnections++;
                                this.connections.push({ socket, driverId, index });
                                this.log(`✅ Motorista ${index + 1} conectado (${connectTime}ms)`, 'DRIVER');
                                resolve();
                            } else {
                                this.metrics.failedConnections++;
                                reject(new Error('Falha na autenticação'));
                            }
                        });
                    });
                    
                } catch (error) {
                    this.metrics.failedConnections++;
                    reject(error);
                }
            });
            
            socket.on('connect_error', (error) => {
                this.metrics.failedConnections++;
                this.log(`❌ Erro na conexão ${index + 1}: ${error.message}`, 'ERROR');
                reject(error);
            });
            
            setTimeout(() => {
                this.metrics.failedConnections++;
                reject(new Error('Timeout na conexão'));
            }, 10000);
        });
    }

    async testBasicOperations() {
        this.log('=== TESTE DE OPERAÇÕES BÁSICAS ===', 'PERFORMANCE');
        
        if (this.connections.length === 0) {
            this.log('❌ Nenhuma conexão disponível para teste', 'ERROR');
            return;
        }
        
        const testDriver = this.connections[0];
        const { socket, driverId, index } = testDriver;
        
        try {
            // Teste de atualização de localização
            const locationStart = Date.now();
            socket.emit('updateLocation', { lat: -23.5505, lng: -46.6333 });
            
            await new Promise((resolve) => {
                socket.once('locationUpdated', (data) => {
                    const locationTime = Date.now() - locationStart;
                    this.log(`📍 Atualização de localização: ${locationTime}ms`, 'PERFORMANCE');
                    resolve();
                });
            });
            
            // Teste de busca de motoristas
            const searchStart = Date.now();
            socket.emit('findNearbyDrivers', { lat: -23.5505, lng: -46.6333, radius: 5000, limit: 10 });
            
            await new Promise((resolve) => {
                socket.once('nearbyDrivers', (data) => {
                    const searchTime = Date.now() - searchStart;
                    this.log(`🔍 Busca de motoristas: ${searchTime}ms`, 'PERFORMANCE');
                    this.log(`📊 Motoristas encontrados: ${data.drivers ? data.drivers.length : 0}`, 'PERFORMANCE');
                    resolve();
                });
            });
            
        } catch (error) {
            this.log(`❌ Erro nas operações básicas: ${error.message}`, 'ERROR');
        }
    }

    async cleanup() {
        this.log('=== LIMPEZA ===', 'CLEANUP');
        
        try {
            for (const connection of this.connections) {
                if (connection.socket) {
                    connection.socket.disconnect();
                }
            }
            
            this.log(`✅ ${this.connections.length} conexões desconectadas`, 'SUCCESS');
            
        } catch (error) {
            this.log(`❌ Erro na limpeza: ${error.message}`, 'ERROR');
        }
    }

    async runQuickLoadTest() {
        this.log('🚀 INICIANDO TESTE DE CARGA RÁPIDO', 'START');
        
        try {
            // 1. Teste de conexões simultâneas
            const connectionMetrics = await this.testConcurrentConnections(20);
            
            if (!connectionMetrics) {
                throw new Error('Falha no teste de conexões');
            }
            
            // 2. Teste de operações básicas
            await this.testBasicOperations();
            
            // 3. Relatório final
            this.log('', 'REPORT');
            this.log('=== RELATÓRIO DO TESTE RÁPIDO ===', 'REPORT');
            this.log(`📊 Total de conexões: ${connectionMetrics.totalConnections}`, 'REPORT');
            this.log(`✅ Conexões bem-sucedidas: ${connectionMetrics.successfulConnections}`, 'REPORT');
            this.log(`❌ Conexões falharam: ${connectionMetrics.failedConnections}`, 'REPORT');
            this.log(`📈 Taxa de sucesso: ${connectionMetrics.successRate}%`, 'REPORT');
            this.log(`⏱️  Tempo médio de conexão: ${connectionMetrics.avgConnectionTime}ms`, 'REPORT');
            this.log(`⏱️  Tempo total: ${connectionMetrics.totalTime}ms`, 'REPORT');
            
            // Avaliação
            this.log('', 'REPORT');
            this.log('=== AVALIAÇÃO ===', 'REPORT');
            
            if (parseFloat(connectionMetrics.successRate) >= 95) {
                this.log('🎉 EXCELENTE: Sistema pronto para teste de carga completo!', 'SUCCESS');
                this.log('✅ Pode executar: test-load-performance.bat', 'SUCCESS');
            } else if (parseFloat(connectionMetrics.successRate) >= 80) {
                this.log('✅ BOM: Sistema pode suportar carga moderada', 'SUCCESS');
                this.log('⚠️  Considere otimizações antes do teste completo', 'WARNING');
            } else {
                this.log('❌ PROBLEMA: Sistema não está pronto para carga', 'ERROR');
                this.log('🔧 Verifique configurações do backend e Redis', 'ERROR');
            }
            
        } catch (error) {
            this.log(`❌ Erro durante o teste: ${error.message}`, 'ERROR');
        } finally {
            await this.cleanup();
        }
    }
}

// Executar teste
async function runQuickLoadTest() {
    const tester = new QuickLoadTest();
    return await tester.runQuickLoadTest();
}

// Executar se chamado diretamente
if (require.main === module) {
    runQuickLoadTest()
        .then(() => {
            console.log('\n🏁 Teste de carga rápido concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { QuickLoadTest, runQuickLoadTest }; 