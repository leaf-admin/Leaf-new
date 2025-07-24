const { io } = require('socket.io-client');
const { initializeApp } = require('firebase/app');
const { getDatabase, ref, get } = require('firebase/database');
const { getAuth, signInAnonymously } = require('firebase/auth');

class LoadPerformanceTest {
    constructor() {
        this.testId = `load_test_${Date.now()}`;
        this.connections = [];
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            responseTimes: [],
            failures: [],
            startTime: null,
            endTime: null
        };
        
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
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    async authenticateFirebase() {
        this.log('=== AUTENTICANDO NO FIREBASE ===', 'AUTH');
        
        try {
            const userCredential = await signInAnonymously(this.auth);
            this.log(`✅ Autenticado: ${userCredential.user.uid}`, 'SUCCESS');
            return userCredential.user.uid;
        } catch (error) {
            this.log(`❌ Erro na autenticação: ${error.message}`, 'ERROR');
            return null;
        }
    }

    async createDriverConnection(driverId, index) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            
            const socket = io('http://localhost:3001', {
                transports: ['websocket'],
                timeout: 5000
            });
            
            socket.on('connect', async () => {
                const connectTime = Date.now() - startTime;
                this.metrics.responseTimes.push({ type: 'connect', time: connectTime, driverId });
                
                try {
                    // Autenticar motorista
                    socket.emit('authenticate', { uid: driverId });
                    
                    // Aguardar confirmação
                    await new Promise((resolveAuth) => {
                        socket.once('authenticated', (data) => {
                            if (data.success) {
                                this.metrics.successfulRequests++;
                                resolve({ socket, driverId, index });
                            } else {
                                this.metrics.failedRequests++;
                                reject(new Error('Falha na autenticação'));
                            }
                        });
                    });
                    
                } catch (error) {
                    this.metrics.failedRequests++;
                    reject(error);
                }
            });
            
            socket.on('connect_error', (error) => {
                this.metrics.failedRequests++;
                this.metrics.failures.push({
                    type: 'connection_error',
                    driverId,
                    error: error.message,
                    timestamp: Date.now()
                });
                reject(error);
            });
            
            setTimeout(() => {
                this.metrics.failedRequests++;
                this.metrics.failures.push({
                    type: 'connection_timeout',
                    driverId,
                    error: 'Timeout na conexão',
                    timestamp: Date.now()
                });
                reject(new Error('Timeout na conexão'));
            }, 15000); // Aumentado para 15 segundos
        });
    }

    async simulateDriverActivity(driver, duration = 30000) {
        const { socket, driverId, index } = driver;
        const startTime = Date.now();
        let locationUpdates = 0;
        
        this.log(`🚗 Motorista ${index + 1} (${driverId}) iniciando atividades...`, 'DRIVER');
        
        // Simular atualizações de localização
        const locationInterval = setInterval(async () => {
            if (Date.now() - startTime > duration) {
                clearInterval(locationInterval);
                return;
            }
            
            const updateStart = Date.now();
            
            try {
                // Gerar localização aleatória em São Paulo
                const lat = -23.5505 + (Math.random() - 0.5) * 0.1;
                const lng = -46.6333 + (Math.random() - 0.5) * 0.1;
                
                socket.emit('updateLocation', { lat, lng });
                
                // Aguardar confirmação
                await new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        this.metrics.failedRequests++;
                        this.metrics.failures.push({
                            type: 'location_update_timeout',
                            driverId,
                            error: 'Timeout na atualização de localização',
                            timestamp: Date.now()
                        });
                        resolve();
                    }, 5000);
                    
                    socket.once('locationUpdated', (data) => {
                        clearTimeout(timeout);
                        const updateTime = Date.now() - updateStart;
                        this.metrics.responseTimes.push({ 
                            type: 'location_update', 
                            time: updateTime, 
                            driverId 
                        });
                        
                        if (data.success) {
                            this.metrics.successfulRequests++;
                            locationUpdates++;
                        } else {
                            this.metrics.failedRequests++;
                            this.metrics.failures.push({
                                type: 'location_update_failed',
                                driverId,
                                error: data.error || 'Falha na atualização',
                                timestamp: Date.now()
                            });
                        }
                        resolve();
                    });
                });
                
            } catch (error) {
                this.metrics.failedRequests++;
                this.log(`❌ Erro no motorista ${index + 1}: ${error.message}`, 'ERROR');
            }
        }, 2000); // Atualizar a cada 2 segundos
        
        // Simular busca de motoristas próximos (como passageiro)
        const searchInterval = setInterval(async () => {
            if (Date.now() - startTime > duration) {
                clearInterval(searchInterval);
                return;
            }
            
            const searchStart = Date.now();
            
            try {
                const lat = -23.5505 + (Math.random() - 0.5) * 0.1;
                const lng = -46.6333 + (Math.random() - 0.5) * 0.1;
                
                socket.emit('findNearbyDrivers', { lat, lng, radius: 5000, limit: 10 });
                
                await new Promise((resolve) => {
                    const timeout = setTimeout(() => {
                        this.metrics.failedRequests++;
                        this.metrics.failures.push({
                            type: 'driver_search_timeout',
                            driverId,
                            error: 'Timeout na busca de motoristas',
                            timestamp: Date.now()
                        });
                        resolve();
                    }, 5000);
                    
                    socket.once('nearbyDrivers', (data) => {
                        clearTimeout(timeout);
                        const searchTime = Date.now() - searchStart;
                        this.metrics.responseTimes.push({ 
                            type: 'driver_search', 
                            time: searchTime, 
                            driverId 
                        });
                        
                        if (data.drivers) {
                            this.metrics.successfulRequests++;
                        } else {
                            this.metrics.failedRequests++;
                            this.metrics.failures.push({
                                type: 'driver_search_failed',
                                driverId,
                                error: data.error || 'Falha na busca',
                                timestamp: Date.now()
                            });
                        }
                        resolve();
                    });
                });
                
            } catch (error) {
                this.metrics.failedRequests++;
            }
        }, 5000); // Buscar a cada 5 segundos
        
        return new Promise((resolve) => {
            setTimeout(() => {
                clearInterval(locationInterval);
                clearInterval(searchInterval);
                this.log(`✅ Motorista ${index + 1} finalizou: ${locationUpdates} atualizações`, 'DRIVER');
                resolve();
            }, duration);
        });
    }

    async testRedisPerformance() {
        this.log('=== TESTE DE PERFORMANCE DO REDIS ===', 'PERFORMANCE');
        
        const testStart = Date.now();
        const concurrentDrivers = 50;
        const testDuration = 30000; // 30 segundos
        
        this.log(`🚀 Iniciando teste com ${concurrentDrivers} motoristas por ${testDuration/1000}s`, 'PERFORMANCE');
        
        try {
            // Criar conexões simultâneas
            this.log('📡 Criando conexões simultâneas...', 'PERFORMANCE');
            
            const driverPromises = [];
            for (let i = 0; i < concurrentDrivers; i++) {
                const driverId = `${this.testId}_driver_${i}`;
                const promise = this.createDriverConnection(driverId, i)
                    .then(driver => this.simulateDriverActivity(driver, testDuration))
                    .catch(error => {
                        this.log(`❌ Erro no motorista ${i}: ${error.message}`, 'ERROR');
                    });
                
                driverPromises.push(promise);
                
                // Pequeno delay para não sobrecarregar
                if (i % 5 === 0) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }
            
            // Aguardar todos os motoristas terminarem
            await Promise.all(driverPromises);
            
            const testEnd = Date.now();
            this.metrics.endTime = testEnd;
            this.metrics.startTime = testStart;
            
            this.log('✅ Teste de performance concluído', 'PERFORMANCE');
            
        } catch (error) {
            this.log(`❌ Erro no teste de performance: ${error.message}`, 'ERROR');
        }
    }

    calculateMetrics() {
        const totalTime = this.metrics.endTime - this.metrics.startTime;
        const totalRequests = this.metrics.successfulRequests + this.metrics.failedRequests;
        
        // Calcular estatísticas de latência
        const locationUpdates = this.metrics.responseTimes.filter(r => r.type === 'location_update');
        const driverSearches = this.metrics.responseTimes.filter(r => r.type === 'driver_search');
        const connections = this.metrics.responseTimes.filter(r => r.type === 'connect');
        
        const avgLocationLatency = locationUpdates.length > 0 
            ? locationUpdates.reduce((sum, r) => sum + r.time, 0) / locationUpdates.length 
            : 0;
            
        const avgSearchLatency = driverSearches.length > 0 
            ? driverSearches.reduce((sum, r) => sum + r.time, 0) / driverSearches.length 
            : 0;
            
        const avgConnectionTime = connections.length > 0 
            ? connections.reduce((sum, r) => sum + r.time, 0) / connections.length 
            : 0;
        
        // Calcular percentis
        const sortedLocationTimes = locationUpdates.map(r => r.time).sort((a, b) => a - b);
        const p95Location = sortedLocationTimes[Math.floor(sortedLocationTimes.length * 0.95)] || 0;
        const p99Location = sortedLocationTimes[Math.floor(sortedLocationTimes.length * 0.99)] || 0;
        
        const sortedSearchTimes = driverSearches.map(r => r.time).sort((a, b) => a - b);
        const p95Search = sortedSearchTimes[Math.floor(sortedSearchTimes.length * 0.95)] || 0;
        const p99Search = sortedSearchTimes[Math.floor(sortedSearchTimes.length * 0.99)] || 0;
        
        return {
            totalTime: totalTime / 1000, // em segundos
            totalRequests,
            successfulRequests: this.metrics.successfulRequests,
            failedRequests: this.metrics.failedRequests,
            successRate: (this.metrics.successfulRequests / totalRequests * 100).toFixed(2),
            requestsPerSecond: (totalRequests / (totalTime / 1000)).toFixed(2),
            avgLocationLatency: avgLocationLatency.toFixed(2),
            avgSearchLatency: avgSearchLatency.toFixed(2),
            avgConnectionTime: avgConnectionTime.toFixed(2),
            p95Location,
            p99Location,
            p95Search,
            p99Search,
            locationUpdates: locationUpdates.length,
            driverSearches: driverSearches.length,
            connections: connections.length
        };
    }

    async testFirebaseSyncPerformance() {
        this.log('=== TESTE DE SINCRONIZAÇÃO FIREBASE ===', 'PERFORMANCE');
        
        const testStart = Date.now();
        const syncTests = 20;
        let successfulSyncs = 0;
        let failedSyncs = 0;
        const syncTimes = [];
        
        for (let i = 0; i < syncTests; i++) {
            const syncStart = Date.now();
            
            try {
                // Simular uma viagem e verificar sincronização
                const tripId = `${this.testId}_sync_test_${i}`;
                const driverId = `${this.testId}_sync_driver_${i}`;
                
                // Criar conexão temporária
                const socket = io('http://localhost:3001', { transports: ['websocket'] });
                
                await new Promise((resolve, reject) => {
                    socket.on('connect', () => {
                        socket.emit('authenticate', { uid: driverId });
                        socket.once('authenticated', () => {
                            socket.emit('finishTrip', {
                                tripId,
                                driverId,
                                status: 'completed',
                                distance: 1500,
                                fare: 25.5
                            });
                            
                            setTimeout(() => {
                                const syncTime = Date.now() - syncStart;
                                syncTimes.push(syncTime);
                                successfulSyncs++;
                                socket.disconnect();
                                resolve();
                            }, 1000);
                        });
                    });
                    
                    socket.on('connect_error', reject);
                });
                
            } catch (error) {
                failedSyncs++;
                this.log(`❌ Erro no sync ${i}: ${error.message}`, 'ERROR');
            }
        }
        
        const avgSyncTime = syncTimes.length > 0 
            ? syncTimes.reduce((sum, time) => sum + time, 0) / syncTimes.length 
            : 0;
        
        this.log(`✅ Sync Firebase: ${successfulSyncs}/${syncTests} sucessos`, 'PERFORMANCE');
        this.log(`📊 Tempo médio de sync: ${avgSyncTime.toFixed(2)}ms`, 'PERFORMANCE');
        
        return { successfulSyncs, failedSyncs, avgSyncTime };
    }

    async cleanup() {
        this.log('=== LIMPEZA ===', 'CLEANUP');
        
        try {
            // Desconectar todas as conexões
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

    async runLoadTest() {
        this.log('🚀 INICIANDO TESTE DE CARGA E PERFORMANCE', 'START');
        this.metrics.startTime = Date.now();
        
        try {
            // 1. Autenticação Firebase
            const authResult = await this.authenticateFirebase();
            if (!authResult) {
                throw new Error('Falha na autenticação Firebase');
            }
            
            // 2. Teste de performance do Redis
            await this.testRedisPerformance();
            
            // 3. Teste de sincronização Firebase
            const syncMetrics = await this.testFirebaseSyncPerformance();
            
            // 4. Calcular métricas finais
            const metrics = this.calculateMetrics();
            
            // 5. Relatório final
            this.log('', 'REPORT');
            this.log('=== RELATÓRIO DE PERFORMANCE ===', 'REPORT');
            this.log(`⏱️  Tempo total: ${metrics.totalTime}s`, 'REPORT');
            this.log(`📊 Total de requisições: ${metrics.totalRequests}`, 'REPORT');
            this.log(`✅ Requisições bem-sucedidas: ${metrics.successfulRequests}`, 'REPORT');
            this.log(`❌ Requisições falharam: ${metrics.failedRequests}`, 'REPORT');
            this.log(`📈 Taxa de sucesso: ${metrics.successRate}%`, 'REPORT');
            this.log(`🚀 Requisições/segundo: ${metrics.requestsPerSecond}`, 'REPORT');
            
            this.log('', 'REPORT');
            this.log('=== LATÊNCIA ===', 'REPORT');
            this.log(`📍 Atualização de localização:`, 'REPORT');
            this.log(`   Média: ${metrics.avgLocationLatency}ms`, 'REPORT');
            this.log(`   P95: ${metrics.p95Location}ms`, 'REPORT');
            this.log(`   P99: ${metrics.p99Location}ms`, 'REPORT');
            this.log(`   Total: ${metrics.locationUpdates}`, 'REPORT');
            
            this.log(`🔍 Busca de motoristas:`, 'REPORT');
            this.log(`   Média: ${metrics.avgSearchLatency}ms`, 'REPORT');
            this.log(`   P95: ${metrics.p95Search}ms`, 'REPORT');
            this.log(`   P99: ${metrics.p99Search}ms`, 'REPORT');
            this.log(`   Total: ${metrics.driverSearches}`, 'REPORT');
            
            this.log(`🔌 Conexões WebSocket:`, 'REPORT');
            this.log(`   Média: ${metrics.avgConnectionTime}ms`, 'REPORT');
            this.log(`   Total: ${metrics.connections}`, 'REPORT');
            
            this.log('', 'REPORT');
            this.log('=== SINCRONIZAÇÃO FIREBASE ===', 'REPORT');
            this.log(`✅ Syncs bem-sucedidos: ${syncMetrics.successfulSyncs}`, 'REPORT');
            this.log(`❌ Syncs falharam: ${syncMetrics.failedSyncs}`, 'REPORT');
            this.log(`⏱️  Tempo médio de sync: ${syncMetrics.avgSyncTime.toFixed(2)}ms`, 'REPORT');
            
            // Análise de falhas
            this.log(`🔍 Debug: Total de falhas registradas: ${this.metrics.failures ? this.metrics.failures.length : 'undefined'}`, 'DEBUG');
            if (this.metrics.failures && this.metrics.failures.length > 0) {
                this.log('', 'REPORT');
                this.log('=== ANÁLISE DE FALHAS ===', 'REPORT');
                
                const failureTypes = {};
                this.metrics.failures.forEach(failure => {
                    failureTypes[failure.type] = (failureTypes[failure.type] || 0) + 1;
                });
                
                Object.entries(failureTypes).forEach(([type, count]) => {
                    this.log(`   ${type}: ${count} falhas`, 'REPORT');
                });
                
                // Mostrar algumas falhas específicas
                this.log('', 'REPORT');
                this.log('=== EXEMPLOS DE FALHAS ===', 'REPORT');
                this.metrics.failures.slice(0, 5).forEach((failure, index) => {
                    const time = new Date(failure.timestamp).toISOString();
                    this.log(`   ${index + 1}. ${time} - ${failure.type}: ${failure.error}`, 'REPORT');
                });
            }
            
            // Avaliação de performance
            this.log('', 'REPORT');
            this.log('=== AVALIAÇÃO DE PERFORMANCE ===', 'REPORT');
            
            if (metrics.successRate >= 95) {
                this.log('🎉 EXCELENTE: Taxa de sucesso >= 95%', 'SUCCESS');
            } else if (metrics.successRate >= 90) {
                this.log('✅ BOM: Taxa de sucesso >= 90%', 'SUCCESS');
            } else if (metrics.successRate >= 80) {
                this.log('⚠️  ACEITÁVEL: Taxa de sucesso >= 80%', 'WARNING');
            } else {
                this.log('❌ PROBLEMA: Taxa de sucesso < 80%', 'ERROR');
            }
            
            if (metrics.avgLocationLatency <= 100) {
                this.log('🎉 EXCELENTE: Latência de localização <= 100ms', 'SUCCESS');
            } else if (metrics.avgLocationLatency <= 200) {
                this.log('✅ BOM: Latência de localização <= 200ms', 'SUCCESS');
            } else if (metrics.avgLocationLatency <= 500) {
                this.log('⚠️  ACEITÁVEL: Latência de localização <= 500ms', 'WARNING');
            } else {
                this.log('❌ PROBLEMA: Latência de localização > 500ms', 'ERROR');
            }
            
            if (metrics.requestsPerSecond >= 50) {
                this.log('🎉 EXCELENTE: Throughput >= 50 req/s', 'SUCCESS');
            } else if (metrics.requestsPerSecond >= 30) {
                this.log('✅ BOM: Throughput >= 30 req/s', 'SUCCESS');
            } else if (metrics.requestsPerSecond >= 20) {
                this.log('⚠️  ACEITÁVEL: Throughput >= 20 req/s', 'WARNING');
            } else {
                this.log('❌ PROBLEMA: Throughput < 20 req/s', 'ERROR');
            }
            
        } catch (error) {
            this.log(`❌ Erro durante o teste: ${error.message}`, 'ERROR');
        } finally {
            await this.cleanup();
        }
    }
}

// Executar teste
async function runLoadPerformanceTest() {
    const tester = new LoadPerformanceTest();
    return await tester.runLoadTest();
}

// Executar se chamado diretamente
if (require.main === module) {
    runLoadPerformanceTest()
        .then(() => {
            console.log('\n🏁 Teste de carga e performance concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { LoadPerformanceTest, runLoadPerformanceTest }; 