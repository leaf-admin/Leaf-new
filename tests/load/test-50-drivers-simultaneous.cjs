const { io } = require('socket.io-client');

class FiftyDriversTest {
    constructor() {
        this.testId = `fifty_drivers_${Date.now()}`;
        this.connections = [];
        this.metrics = {
            totalAttempts: 0,
            successfulConnections: 0,
            failedConnections: 0,
            retryAttempts: 0,
            connectionTimes: [],
            operationResults: {
                updateLocation: { success: 0, failed: 0 },
                findNearbyDrivers: { success: 0, failed: 0 },
                finishTrip: { success: 0, failed: 0 }
            }
        };
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async connectWithRetry(driverId, index, maxRetries = 3) {
        let attempts = 0;
        
        while (attempts < maxRetries) {
            attempts++;
            this.metrics.totalAttempts++;
            
            try {
                const startTime = Date.now();
                
                const socket = io('http://localhost:3001', {
                    transports: ['websocket', 'polling'],
                    timeout: 15000,
                    forceNew: true,
                    reconnection: false
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
                                        this.log(`✅ Motorista ${index + 1}/50 conectado (${connectTime}ms) - Tentativa ${attempts}`, 'SUCCESS');
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
                    // Backoff exponencial
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

    async simulateDriverOperations(driver, testDuration = 10000) {
        const { socket, driverId, index } = driver;
        
        try {
            // 1. Atualizar localização
            await this.updateLocation(socket, driverId, index);
            
            // 2. Buscar motoristas próximos
            await this.findNearbyDrivers(socket, driverId, index);
            
            // 3. Simular viagem
            await this.simulateTrip(socket, driverId, index);
            
        } catch (error) {
            this.log(`❌ Erro nas operações do motorista ${index + 1}: ${error.message}`, 'ERROR');
        }
    }

    async updateLocation(socket, driverId, index) {
        try {
            const lat = -23.5505 + (Math.random() - 0.5) * 0.1;
            const lng = -46.6333 + (Math.random() - 0.5) * 0.1;
            
            socket.emit('updateLocation', { lat, lng });
            
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Update location timeout')), 10000);
                
                socket.once('locationUpdated', (data) => {
                    clearTimeout(timeout);
                    if (data.success) {
                        this.metrics.operationResults.updateLocation.success++;
                        this.log(`📍 Localização atualizada: Motorista ${index + 1}`, 'SUCCESS');
                        resolve(data);
                    } else {
                        this.metrics.operationResults.updateLocation.failed++;
                        reject(new Error(data.error || 'Update location failed'));
                    }
                });
            });
        } catch (error) {
            this.metrics.operationResults.updateLocation.failed++;
            throw error;
        }
    }

    async findNearbyDrivers(socket, driverId, index) {
        try {
            const lat = -23.5505;
            const lng = -46.6333;
            
            socket.emit('findNearbyDrivers', { lat, lng, radius: 5000, limit: 10 });
            
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Find drivers timeout')), 15000);
                
                socket.once('nearbyDrivers', (data) => {
                    clearTimeout(timeout);
                    if (data.success) {
                        this.metrics.operationResults.findNearbyDrivers.success++;
                        this.log(`🔍 Motoristas próximos: ${data.drivers?.length || 0} encontrados (Motorista ${index + 1})`, 'SUCCESS');
                        resolve(data);
                    } else {
                        this.metrics.operationResults.findNearbyDrivers.failed++;
                        reject(new Error(data.error || 'Find drivers failed'));
                    }
                });
            });
        } catch (error) {
            this.metrics.operationResults.findNearbyDrivers.failed++;
            throw error;
        }
    }

    async simulateTrip(socket, driverId, index) {
        try {
            const tripId = `${this.testId}_trip_${driverId}`;
            
            const tripData = {
                tripId,
                driverId,
                status: 'completed',
                distance: 1500 + Math.random() * 1000,
                fare: 25 + Math.random() * 15,
                startTime: Date.now() - 3600000,
                endTime: Date.now(),
                startLocation: { lat: -23.5505, lng: -46.6333 },
                endLocation: { lat: -23.5505 + 0.01, lng: -46.6333 + 0.01 }
            };
            
            socket.emit('finishTrip', tripData);
            
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Finish trip timeout')), 10000);
                
                socket.once('tripFinished', (data) => {
                    clearTimeout(timeout);
                    if (data.success) {
                        this.metrics.operationResults.finishTrip.success++;
                        this.log(`🏁 Viagem finalizada: Motorista ${index + 1}`, 'SUCCESS');
                        resolve(data);
                    } else {
                        this.metrics.operationResults.finishTrip.failed++;
                        reject(new Error(data.error || 'Finish trip failed'));
                    }
                });
            });
        } catch (error) {
            this.metrics.operationResults.finishTrip.failed++;
            throw error;
        }
    }

    async runFiftyDriversTest() {
        this.log(`🚀 TESTE DE 50 MOTORISTAS SIMULTÂNEOS`, 'START');
        this.log(`📊 Total de motoristas: 50`, 'START');
        this.log(`⏱️  Teste de concorrência máxima`, 'START');
        
        const startTime = Date.now();
        
        try {
            // Conectar 50 motoristas simultaneamente
            this.log(`\n📦 Conectando 50 motoristas simultaneamente...`, 'CONNECT');
            
            const connectionPromises = [];
            for (let i = 0; i < 50; i++) {
                const driverId = `${this.testId}_driver_${i}`;
                const promise = this.connectWithRetry(driverId, i)
                    .catch(error => {
                        this.log(`❌ Erro final no motorista ${i + 1}: ${error.message}`, 'ERROR');
                    });
                
                connectionPromises.push(promise);
            }
            
            await Promise.allSettled(connectionPromises);
            
            // Simular operações básicas
            this.log(`\n🔄 Simulando operações básicas...`, 'OPERATIONS');
            
            const operationPromises = [];
            for (const driver of this.connections) {
                const promise = this.simulateDriverOperations(driver, 5000);
                operationPromises.push(promise);
            }
            
            await Promise.allSettled(operationPromises);
            
            const totalTime = Date.now() - startTime;
            
            // Relatório detalhado
            this.generateDetailedReport(totalTime);
            
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

    generateDetailedReport(totalTime) {
        this.log('', 'REPORT');
        this.log('=== RELATÓRIO DE 50 MOTORISTAS SIMULTÂNEOS ===', 'REPORT');
        this.log(`⏱️  Tempo total: ${totalTime}ms`, 'REPORT');
        this.log(`📊 Tentativas totais: ${this.metrics.totalAttempts}`, 'REPORT');
        this.log(`✅ Conexões bem-sucedidas: ${this.metrics.successfulConnections}/50`, 'REPORT');
        this.log(`❌ Conexões falharam: ${this.metrics.failedConnections}/50`, 'REPORT');
        this.log(`🔄 Tentativas de retry: ${this.metrics.retryAttempts}`, 'REPORT');
        this.log(`📈 Taxa de sucesso: ${(this.metrics.successfulConnections / 50 * 100).toFixed(2)}%`, 'REPORT');
        
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
        
        // Estatísticas de operações
        this.log('', 'REPORT');
        this.log('=== OPERAÇÕES ===', 'REPORT');
        for (const [operation, stats] of Object.entries(this.metrics.operationResults)) {
            const total = stats.success + stats.failed;
            const successRate = total > 0 ? (stats.success / total * 100).toFixed(2) : '0.00';
            this.log(`${operation}: ${stats.success}/${total} (${successRate}%)`, 'REPORT');
        }
        
        // Avaliação de produção
        this.log('', 'REPORT');
        this.log('=== AVALIAÇÃO PARA PRODUÇÃO ===', 'REPORT');
        
        const successRate = this.metrics.successfulConnections / 50 * 100;
        
        if (successRate >= 98) {
            this.log('🎉 EXCELENTE: Sistema pronto para produção com alta concorrência!', 'SUCCESS');
            this.log('✅ Pode suportar 50+ motoristas simultâneos sem problemas', 'SUCCESS');
        } else if (successRate >= 95) {
            this.log('✅ BOM: Sistema funcional para produção', 'SUCCESS');
            this.log('⚠️  Pequenas otimizações podem melhorar performance', 'WARNING');
        } else if (successRate >= 90) {
            this.log('⚠️  ACEITÁVEL: Sistema funcional, mas precisa de otimizações', 'WARNING');
            this.log('🔧 Recomenda-se load balancing para produção', 'WARNING');
        } else {
            this.log('🚨 PROBLEMÁTICO: Necessárias otimizações urgentes', 'ERROR');
            this.log('🔧 Load balancing e otimizações críticas necessárias', 'ERROR');
        }
        
        // Recomendações específicas
        this.log('', 'REPORT');
        this.log('=== RECOMENDAÇÕES ===', 'REPORT');
        
        if (this.metrics.failedConnections > 0) {
            this.log('🔧 Implementar retry automático no app mobile', 'RECOMMENDATION');
            this.log('🔧 Considerar múltiplos servidores backend', 'RECOMMENDATION');
            this.log('🔧 Monitorar recursos do servidor (CPU, RAM, rede)', 'RECOMMENDATION');
        }
        
        if (this.metrics.retryAttempts > 0) {
            this.log('🔧 Implementar backoff exponencial no retry', 'RECOMMENDATION');
            this.log('🔧 Considerar rate limiting para evitar sobrecarga', 'RECOMMENDATION');
        }
        
        if (successRate >= 95) {
            this.log('🎉 Sistema está pronto para lançamento!', 'SUCCESS');
        }
    }
}

// Executar teste
async function runFiftyDriversTest() {
    const tester = new FiftyDriversTest();
    return await tester.runFiftyDriversTest();
}

// Executar se chamado diretamente
if (require.main === module) {
    runFiftyDriversTest()
        .then(() => {
            console.log('\n🏁 Teste de 50 motoristas simultâneos concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { FiftyDriversTest, runFiftyDriversTest }; 