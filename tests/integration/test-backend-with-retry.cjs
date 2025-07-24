const { io } = require('socket.io-client');

class BackendTestWithRetry {
    constructor() {
        this.testId = `retry_test_${Date.now()}`;
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
                finishTrip: { success: 0, failed: 0 },
                cancelTrip: { success: 0, failed: 0 }
            }
        };
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    // Simular comportamento do app mobile com retry
    async connectWithRetry(driverId, maxRetries = 3) {
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
                                        this.connections.push({ socket, driverId });
                                        this.log(`✅ Motorista conectado (${connectTime}ms) - Tentativa ${attempts}`, 'SUCCESS');
                                        resolve({ socket, driverId, connectTime });
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
                this.log(`❌ Tentativa ${attempts} falhou: ${error.message}`, 'RETRY');
                
                if (attempts < maxRetries) {
                    this.metrics.retryAttempts++;
                    // Backoff exponencial
                    const waitTime = Math.min(1000 * Math.pow(2, attempts - 1), 5000);
                    await new Promise(resolve => setTimeout(resolve, waitTime));
                } else {
                    this.metrics.failedConnections++;
                    this.log(`❌ Motorista falhou após ${maxRetries} tentativas`, 'ERROR');
                    throw error;
                }
            }
        }
    }

    // Simular operações do motorista
    async simulateDriverOperations(driver, testDuration = 30000) {
        const { socket, driverId } = driver;
        
        try {
            // 1. Atualizar localização
            await this.updateLocation(socket, driverId);
            
            // 2. Buscar motoristas próximos
            await this.findNearbyDrivers(socket, driverId);
            
            // 3. Simular viagem
            await this.simulateTrip(socket, driverId);
            
        } catch (error) {
            this.log(`❌ Erro nas operações do motorista ${driverId}: ${error.message}`, 'ERROR');
        }
    }

    async updateLocation(socket, driverId) {
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
                        this.log(`📍 Localização atualizada: ${driverId}`, 'SUCCESS');
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

    async findNearbyDrivers(socket, driverId) {
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
                        this.log(`🔍 Motoristas próximos encontrados: ${data.drivers?.length || 0}`, 'SUCCESS');
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

    async simulateTrip(socket, driverId) {
        try {
            const tripId = `${this.testId}_trip_${driverId}`;
            
            // Simular finalização de viagem
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
                        this.log(`🏁 Viagem finalizada: ${tripId}`, 'SUCCESS');
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

    async runTest(totalDrivers = 10, testDuration = 30000) {
        this.log(`🚀 TESTE DE BACKEND COM RETRY`, 'START');
        this.log(`📊 Total de motoristas: ${totalDrivers}`, 'START');
        this.log(`⏱️  Duração do teste: ${testDuration}ms`, 'START');
        
        const startTime = Date.now();
        
        try {
            // Conectar motoristas
            this.log(`\n📦 Conectando ${totalDrivers} motoristas...`, 'CONNECT');
            
            const connectionPromises = [];
            for (let i = 0; i < totalDrivers; i++) {
                const driverId = `${this.testId}_driver_${i}`;
                const promise = this.connectWithRetry(driverId)
                    .catch(error => {
                        this.log(`❌ Erro final no motorista ${i}: ${error.message}`, 'ERROR');
                    });
                connectionPromises.push(promise);
            }
            
            await Promise.allSettled(connectionPromises);
            
            // Simular operações
            this.log(`\n🔄 Simulando operações por ${testDuration}ms...`, 'OPERATIONS');
            
            const operationPromises = [];
            for (const driver of this.connections) {
                const promise = this.simulateDriverOperations(driver, testDuration);
                operationPromises.push(promise);
            }
            
            await Promise.allSettled(operationPromises);
            
            const totalTime = Date.now() - startTime;
            
            // Relatório
            this.generateReport(totalDrivers, totalTime);
            
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

    generateReport(totalDrivers, totalTime) {
        this.log('', 'REPORT');
        this.log('=== RELATÓRIO DE TESTE COM RETRY ===', 'REPORT');
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
        
        // Estatísticas de operações
        this.log('', 'REPORT');
        this.log('=== OPERAÇÕES ===', 'REPORT');
        for (const [operation, stats] of Object.entries(this.metrics.operationResults)) {
            const total = stats.success + stats.failed;
            const successRate = total > 0 ? (stats.success / total * 100).toFixed(2) : '0.00';
            this.log(`${operation}: ${stats.success}/${total} (${successRate}%)`, 'REPORT');
        }
        
        // Avaliação
        this.log('', 'REPORT');
        this.log('=== AVALIAÇÃO ===', 'REPORT');
        
        const successRate = this.metrics.successfulConnections / totalDrivers * 100;
        
        if (successRate >= 98) {
            this.log('🎉 EXCELENTE: Sistema pronto para produção!', 'SUCCESS');
        } else if (successRate >= 95) {
            this.log('✅ BOM: Sistema funcional com retry', 'SUCCESS');
        } else if (successRate >= 90) {
            this.log('⚠️  ACEITÁVEL: Precisa de otimizações', 'WARNING');
        } else {
            this.log('🚨 PROBLEMÁTICO: Necessárias correções urgentes', 'ERROR');
        }
    }
}

// Executar teste
async function runBackendTestWithRetry() {
    const tester = new BackendTestWithRetry();
    return await tester.runTest(10, 30000); // 10 motoristas, 30 segundos
}

// Executar se chamado diretamente
if (require.main === module) {
    runBackendTestWithRetry()
        .then(() => {
            console.log('\n🏁 Teste com retry concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { BackendTestWithRetry, runBackendTestWithRetry }; 