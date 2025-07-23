const { io } = require('socket.io-client');

class ConcurrentConnectionTest {
    constructor() {
        this.testId = `concurrent_${Date.now()}`;
        this.connections = [];
        this.metrics = {
            totalAttempts: 0,
            successfulConnections: 0,
            failedConnections: 0,
            retryAttempts: 0,
            maxRetries: 3,
            connectionTimes: []
        };
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async createConnectionWithRetry(driverId, index, maxRetries = 3) {
        let attempts = 0;
        
        while (attempts < maxRetries) {
            attempts++;
            this.metrics.totalAttempts++;
            
            try {
                const startTime = Date.now();
                
                const socket = io('http://localhost:3001', {
                    transports: ['websocket'],
                    timeout: 15000, // 15 segundos
                    forceNew: true,
                    reconnection: false // Desabilitar reconexão automática para teste
                });
                
                const connectionResult = await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        reject(new Error('Connection timeout'));
                    }, 15000);
                    
                    socket.on('connect', async () => {
                        clearTimeout(timeout);
                        const connectTime = Date.now() - startTime;
                        
                        try {
                            // Autenticar motorista
                            socket.emit('authenticate', { uid: driverId });
                            
                            await new Promise((resolveAuth) => {
                                socket.once('authenticated', (data) => {
                                    if (data.success) {
                                        this.metrics.successfulConnections++;
                                        this.metrics.connectionTimes.push(connectTime);
                                        this.connections.push({ socket, driverId, index });
                                        this.log(`✅ Motorista ${index + 1} conectado (${connectTime}ms) - Tentativa ${attempts}`, 'SUCCESS');
                                        resolve({ socket, driverId, index, connectTime });
                                    } else {
                                        reject(new Error('Authentication failed'));
                                    }
                                });
                            });
                            
                        } catch (error) {
                            reject(error);
                        }
                    });
                    
                    socket.on('connect_error', (error) => {
                        clearTimeout(timeout);
                        reject(error);
                    });
                });
                
                return connectionResult;
                
            } catch (error) {
                this.log(`❌ Tentativa ${attempts} falhou para motorista ${index + 1}: ${error.message}`, 'RETRY');
                
                if (attempts < maxRetries) {
                    this.metrics.retryAttempts++;
                    // Aguardar antes de tentar novamente (backoff exponencial)
                    const waitTime = Math.min(1000 * Math.pow(2, attempts - 1), 5000);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    this.metrics.failedConnections++;
                    this.log(`❌ Motorista ${index + 1} falhou após ${maxRetries} tentativas`, 'ERROR');
                    throw error;
                }
            }
        }
    }

    async simulateConcurrentConnections(totalDrivers = 50, batchSize = 10) {
        this.log(`🚀 TESTE DE CONEXÕES SIMULTÂNEAS OTIMIZADO`, 'START');
        this.log(`📊 Total de motoristas: ${totalDrivers}`, 'START');
        this.log(`📦 Tamanho do lote: ${batchSize}`, 'START');
        
        const startTime = Date.now();
        
        try {
            // Conectar em lotes para evitar sobrecarga
            for (let batch = 0; batch < Math.ceil(totalDrivers / batchSize); batch++) {
                const batchStart = batch * batchSize;
                const batchEnd = Math.min((batch + 1) * batchSize, totalDrivers);
                
                this.log(`📦 Processando lote ${batch + 1}: motoristas ${batchStart + 1} a ${batchEnd}`, 'BATCH');
                
                const batchPromises = [];
                for (let i = batchStart; i < batchEnd; i++) {
                    const driverId = `${this.testId}_driver_${i}`;
                    const promise = this.createConnectionWithRetry(driverId, i)
                        .catch(error => {
                            this.log(`❌ Erro final no motorista ${i + 1}: ${error.message}`, 'ERROR');
                        });
                    
                    batchPromises.push(promise);
                }
                
                // Aguardar lote atual terminar
                await Promise.allSettled(batchPromises);
                
                // Pequena pausa entre lotes
                if (batch < Math.ceil(totalDrivers / batchSize) - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
            
            const totalTime = Date.now() - startTime;
            
            // Relatório detalhado
            this.log('', 'REPORT');
            this.log('=== RELATÓRIO DE CONEXÕES SIMULTÂNEAS ===', 'REPORT');
            this.log(`⏱️  Tempo total: ${totalTime}ms`, 'REPORT');
            this.log(`📊 Tentativas totais: ${this.metrics.totalAttempts}`, 'REPORT');
            this.log(`✅ Conexões bem-sucedidas: ${this.metrics.successfulConnections}`, 'REPORT');
            this.log(`❌ Conexões falharam: ${this.metrics.failedConnections}`, 'REPORT');
            this.log(`🔄 Tentativas de retry: ${this.metrics.retryAttempts}`, 'REPORT');
            this.log(`📈 Taxa de sucesso: ${(this.metrics.successfulConnections / totalDrivers * 100).toFixed(2)}%`, 'REPORT');
            
            // Estatísticas de tempo de conexão
            if (this.metrics.connectionTimes.length > 0) {
                const avgTime = this.metrics.connectionTimes.reduce((a, b) => a + b, 0) / this.metrics.connectionTimes.length;
                const minTime = Math.min(...this.metrics.connectionTimes);
                const maxTime = Math.max(...this.metrics.connectionTimes);
                
                this.log('', 'REPORT');
                this.log('=== TEMPO DE CONEXÃO ===', 'REPORT');
                this.log(`📊 Média: ${avgTime.toFixed(2)}ms`, 'REPORT');
                this.log(`⚡ Mínimo: ${minTime}ms`, 'REPORT');
                this.log(`🐌 Máximo: ${maxTime}ms`, 'REPORT');
            }
            
            // Avaliação
            this.log('', 'REPORT');
            this.log('=== AVALIAÇÃO ===', 'REPORT');
            
            const successRate = this.metrics.successfulConnections / totalDrivers * 100;
            
            if (successRate >= 98) {
                this.log('🎉 EXCELENTE: Taxa de sucesso >= 98%', 'SUCCESS');
                this.log('✅ Sistema pronto para produção com alta concorrência', 'SUCCESS');
            } else if (successRate >= 95) {
                this.log('✅ BOM: Taxa de sucesso >= 95%', 'SUCCESS');
                this.log('⚠️  Sistema funcional, mas pode precisar de otimizações', 'WARNING');
            } else if (successRate >= 90) {
                this.log('⚠️  ACEITÁVEL: Taxa de sucesso >= 90%', 'WARNING');
                this.log('🔧 Recomenda-se otimizações para melhorar performance', 'WARNING');
            } else {
                this.log('🚨 PROBLEMÁTICO: Taxa de sucesso < 90%', 'ERROR');
                this.log('🔧 Necessárias otimizações urgentes', 'ERROR');
            }
            
            // Recomendações
            this.log('', 'REPORT');
            this.log('=== RECOMENDAÇÕES ===', 'REPORT');
            
            if (this.metrics.failedConnections > 0) {
                this.log('🔧 Implementar retry automático no app mobile', 'RECOMMENDATION');
                this.log('🔧 Considerar load balancing para múltiplos servidores', 'RECOMMENDATION');
                this.log('🔧 Monitorar recursos do servidor (CPU, RAM, rede)', 'RECOMMENDATION');
            }
            
            if (this.metrics.retryAttempts > 0) {
                this.log('🔧 Implementar backoff exponencial no retry', 'RECOMMENDATION');
                this.log('🔧 Considerar rate limiting para evitar sobrecarga', 'RECOMMENDATION');
            }
            
        } catch (error) {
            this.log(`❌ Erro durante o teste: ${error.message}`, 'ERROR');
        } finally {
            // Limpeza
            for (const connection of this.connections) {
                if (connection.socket) {
                    connection.socket.disconnect();
                }
            }
            this.log(`✅ ${this.connections.length} conexões desconectadas`, 'CLEANUP');
        }
    }
}

// Executar teste
async function runConcurrentConnectionTest() {
    const tester = new ConcurrentConnectionTest();
    return await tester.simulateConcurrentConnections(50, 10);
}

// Executar se chamado diretamente
if (require.main === module) {
    runConcurrentConnectionTest()
        .then(() => {
            console.log('\n🏁 Teste de conexões simultâneas concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { ConcurrentConnectionTest, runConcurrentConnectionTest }; 