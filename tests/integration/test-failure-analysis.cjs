const { io } = require('socket.io-client');

class FailureAnalysisTest {
    constructor() {
        this.testId = `failure_analysis_${Date.now()}`;
        this.connections = [];
        this.metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            failures: [],
            responseTimes: []
        };
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
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
                this.metrics.responseTimes.push({ type: 'connect', time: connectTime, driverId });
                
                try {
                    // Autenticar motorista
                    socket.emit('authenticate', { uid: driverId });
                    
                    await new Promise((resolveAuth) => {
                        socket.once('authenticated', (data) => {
                            if (data.success) {
                                this.metrics.successfulRequests++;
                                this.connections.push({ socket, driverId, index });
                                this.log(`✅ Motorista ${index + 1} conectado (${connectTime}ms)`, 'DRIVER');
                                resolve();
                            } else {
                                this.metrics.failedRequests++;
                                this.metrics.failures.push({
                                    type: 'authentication',
                                    driverId,
                                    error: 'Falha na autenticação',
                                    timestamp: Date.now()
                                });
                                reject(new Error('Falha na autenticação'));
                            }
                        });
                    });
                    
                } catch (error) {
                    this.metrics.failedRequests++;
                    this.metrics.failures.push({
                        type: 'authentication',
                        driverId,
                        error: error.message,
                        timestamp: Date.now()
                    });
                    reject(error);
                }
            });
            
            socket.on('connect_error', (error) => {
                this.metrics.failedRequests++;
                this.metrics.failures.push({
                    type: 'connection',
                    driverId,
                    error: error.message,
                    timestamp: Date.now()
                });
                this.log(`❌ Erro na conexão ${index + 1}: ${error.message}`, 'ERROR');
                reject(error);
            });
            
            setTimeout(() => {
                this.metrics.failedRequests++;
                this.metrics.failures.push({
                    type: 'timeout',
                    driverId,
                    error: 'Timeout na conexão',
                    timestamp: Date.now()
                });
                reject(new Error('Timeout na conexão'));
            }, 10000);
        });
    }

    async simulateDriverActivity(driver, duration = 30000) {
        const { socket, driverId, index } = driver;
        const startTime = Date.now();
        let locationUpdates = 0;
        let locationFailures = 0;
        let searchFailures = 0;
        
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
                        locationFailures++;
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
                            locationFailures++;
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
                locationFailures++;
                this.metrics.failures.push({
                    type: 'location_update_error',
                    driverId,
                    error: error.message,
                    timestamp: Date.now()
                });
                this.log(`❌ Erro no motorista ${index + 1}: ${error.message}`, 'ERROR');
            }
        }, 2000); // Atualizar a cada 2 segundos
        
        // Simular busca de motoristas próximos
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
                        searchFailures++;
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
                            searchFailures++;
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
                searchFailures++;
                this.metrics.failures.push({
                    type: 'driver_search_error',
                    driverId,
                    error: error.message,
                    timestamp: Date.now()
                });
            }
        }, 5000); // Buscar a cada 5 segundos
        
        return new Promise((resolve) => {
            setTimeout(() => {
                clearInterval(locationInterval);
                clearInterval(searchInterval);
                this.log(`✅ Motorista ${index + 1} finalizou: ${locationUpdates} atualizações, ${locationFailures} falhas loc, ${searchFailures} falhas busca`, 'DRIVER');
                resolve();
            }, duration);
        });
    }

    async analyzeFailures() {
        this.log('=== ANÁLISE DETALHADA DE FALHAS ===', 'ANALYSIS');
        
        const failureTypes = {};
        const failureTimeline = [];
        
        this.metrics.failures.forEach(failure => {
            // Contar por tipo
            failureTypes[failure.type] = (failureTypes[failure.type] || 0) + 1;
            
            // Timeline
            failureTimeline.push({
                timestamp: failure.timestamp,
                type: failure.type,
                driverId: failure.driverId,
                error: failure.error
            });
        });
        
        // Ordenar timeline
        failureTimeline.sort((a, b) => a.timestamp - b.timestamp);
        
        this.log('', 'ANALYSIS');
        this.log('=== TIPOS DE FALHA ===', 'ANALYSIS');
        Object.entries(failureTypes).forEach(([type, count]) => {
            this.log(`   ${type}: ${count} falhas`, 'ANALYSIS');
        });
        
        this.log('', 'ANALYSIS');
        this.log('=== TIMELINE DE FALHAS ===', 'ANALYSIS');
        failureTimeline.forEach((failure, index) => {
            const time = new Date(failure.timestamp).toISOString();
            this.log(`   ${index + 1}. ${time} - ${failure.type}: ${failure.error}`, 'ANALYSIS');
        });
        
        // Análise de padrões
        this.log('', 'ANALYSIS');
        this.log('=== ANÁLISE DE PADRÕES ===', 'ANALYSIS');
        
        // Verificar se há falhas concentradas em períodos específicos
        const timeWindows = {};
        failureTimeline.forEach(failure => {
            const minute = Math.floor(failure.timestamp / 60000);
            timeWindows[minute] = (timeWindows[minute] || 0) + 1;
        });
        
        const highFailurePeriods = Object.entries(timeWindows)
            .filter(([minute, count]) => count > 2)
            .sort((a, b) => b[1] - a[1]);
        
        if (highFailurePeriods.length > 0) {
            this.log('⚠️  Períodos com alta concentração de falhas:', 'ANALYSIS');
            highFailurePeriods.forEach(([minute, count]) => {
                const time = new Date(parseInt(minute) * 60000).toISOString();
                this.log(`   ${time}: ${count} falhas`, 'ANALYSIS');
            });
        } else {
            this.log('✅ Falhas distribuídas uniformemente', 'ANALYSIS');
        }
        
        return {
            failureTypes,
            failureTimeline,
            highFailurePeriods
        };
    }

    async runFailureAnalysis() {
        this.log('🚀 INICIANDO ANÁLISE DE FALHAS', 'START');
        
        const concurrentDrivers = 30; // Menos motoristas para análise mais detalhada
        const testDuration = 20000; // 20 segundos
        
        this.log(`📊 Testando ${concurrentDrivers} motoristas por ${testDuration/1000}s`, 'START');
        
        try {
            // Criar conexões simultâneas
            this.log('📡 Criando conexões simultâneas...', 'START');
            
            const driverPromises = [];
            for (let i = 0; i < concurrentDrivers; i++) {
                const driverId = `${this.testId}_driver_${i}`;
                const promise = this.createConnection(driverId, i)
                    .then(driver => {
                        if (driver) {
                            return this.simulateDriverActivity(driver, testDuration);
                        } else {
                            this.log(`❌ Motorista ${i}: Conexão falhou`, 'ERROR');
                        }
                    })
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
            
            // Análise detalhada
            const analysis = await this.analyzeFailures();
            
            // Relatório final
            this.log('', 'REPORT');
            this.log('=== RELATÓRIO DE ANÁLISE DE FALHAS ===', 'REPORT');
            this.log(`📊 Total de requisições: ${this.metrics.totalRequests}`, 'REPORT');
            this.log(`✅ Requisições bem-sucedidas: ${this.metrics.successfulRequests}`, 'REPORT');
            this.log(`❌ Requisições falharam: ${this.metrics.failedRequests}`, 'REPORT');
            this.log(`📈 Taxa de sucesso: ${(this.metrics.successfulRequests / (this.metrics.successfulRequests + this.metrics.failedRequests) * 100).toFixed(2)}%`, 'REPORT');
            this.log(`🔍 Total de falhas analisadas: ${this.metrics.failures.length}`, 'REPORT');
            
            // Recomendações
            this.log('', 'REPORT');
            this.log('=== RECOMENDAÇÕES ===', 'REPORT');
            
            if (analysis.failureTypes['connection']) {
                this.log('🔧 Problema: Falhas de conexão', 'REPORT');
                this.log('   Solução: Verificar estabilidade da rede e configurações do WebSocket', 'REPORT');
            }
            
            if (analysis.failureTypes['timeout']) {
                this.log('🔧 Problema: Timeouts frequentes', 'REPORT');
                this.log('   Solução: Aumentar timeouts ou otimizar processamento', 'REPORT');
            }
            
            if (analysis.failureTypes['location_update_timeout']) {
                this.log('🔧 Problema: Timeouts em atualizações de localização', 'REPORT');
                this.log('   Solução: Verificar performance do Redis e sincronização Firebase', 'REPORT');
            }
            
            if (analysis.failureTypes['driver_search_timeout']) {
                this.log('🔧 Problema: Timeouts em busca de motoristas', 'REPORT');
                this.log('   Solução: Otimizar queries do Redis GEO', 'REPORT');
            }
            
            if (this.metrics.failures.length === 0) {
                this.log('🎉 EXCELENTE: Nenhuma falha detectada!', 'SUCCESS');
            }
            
        } catch (error) {
            this.log(`❌ Erro durante a análise: ${error.message}`, 'ERROR');
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

// Executar análise
async function runFailureAnalysis() {
    const tester = new FailureAnalysisTest();
    return await tester.runFailureAnalysis();
}

// Executar se chamado diretamente
if (require.main === module) {
    runFailureAnalysis()
        .then(() => {
            console.log('\n🏁 Análise de falhas concluída!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { FailureAnalysisTest, runFailureAnalysis }; 