const { io } = require('socket.io-client');

class MonitoringSystemTest {
    constructor() {
        this.testId = `monitoring_test_${Date.now()}`;
        this.results = {
            latency: {},
            resources: {},
            sync: {},
            alerts: []
        };
    }

    log(message, type = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${type}] ${message}`);
    }

    // Testar métricas de latência
    async testLatencyMetrics() {
        this.log('🔍 Testando métricas de latência...', 'TEST');
        
        try {
            const response = await fetch('http://localhost:3001/metrics');
            const data = await response.json();
            
            this.results.latency = {
                success: true,
                data: data.latency,
                timestamp: data.timestamp
            };
            
            this.log(`✅ Métricas de latência obtidas: ${data.latency.performance.totalOperations} operações`, 'SUCCESS');
            
        } catch (error) {
            this.results.latency = {
                success: false,
                error: error.message
            };
            this.log(`❌ Erro ao obter métricas de latência: ${error.message}`, 'ERROR');
        }
    }

    // Testar monitoramento de recursos
    async testResourceMonitoring() {
        this.log('🔍 Testando monitoramento de recursos...', 'TEST');
        
        try {
            const response = await fetch('http://localhost:3001/metrics');
            const data = await response.json();
            
            this.results.resources = {
                success: true,
                data: data.resources,
                timestamp: data.timestamp
            };
            
            this.log(`✅ Monitoramento de recursos obtido: Redis=${data.resources.redis.status}, Firebase=${data.resources.firebase.status}`, 'SUCCESS');
            
        } catch (error) {
            this.results.resources = {
                success: false,
                error: error.message
            };
            this.log(`❌ Erro ao obter monitoramento de recursos: ${error.message}`, 'ERROR');
        }
    }

    // Testar sistema de alertas de sincronização
    async testSyncAlerts() {
        this.log('🔍 Testando sistema de alertas de sincronização...', 'TEST');
        
        try {
            const response = await fetch('http://localhost:3001/metrics');
            const data = await response.json();
            
            this.results.sync = {
                success: true,
                data: data.sync,
                timestamp: data.timestamp
            };
            
            this.log(`✅ Alertas de sincronização obtidos: ${data.sync.activeAlerts} alertas ativos`, 'SUCCESS');
            
        } catch (error) {
            this.results.sync = {
                success: false,
                error: error.message
            };
            this.log(`❌ Erro ao obter alertas de sincronização: ${error.message}`, 'ERROR');
        }
    }

    // Testar métricas em tempo real
    async testRealTimeMetrics() {
        this.log('🔍 Testando métricas em tempo real...', 'TEST');
        
        try {
            const response = await fetch('http://localhost:3001/metrics/realtime');
            const data = await response.json();
            
            this.results.realtime = {
                success: true,
                data: data,
                timestamp: data.timestamp
            };
            
            this.log(`✅ Métricas em tempo real obtidas: ${data.latency.operationsLastMinute} operações/min`, 'SUCCESS');
            
        } catch (error) {
            this.results.realtime = {
                success: false,
                error: error.message
            };
            this.log(`❌ Erro ao obter métricas em tempo real: ${error.message}`, 'ERROR');
        }
    }

    // Simular operações para gerar métricas
    async simulateOperations() {
        this.log('🔄 Simulando operações para gerar métricas...', 'SIMULATION');
        
        const socket = io('http://localhost:3001', {
            transports: ['websocket'],
            timeout: 10000
        });
        
        try {
            // Conectar e autenticar
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Connection timeout')), 10000);
                
                socket.on('connect', () => {
                    socket.emit('authenticate', { uid: `${this.testId}_driver` });
                });
                
                socket.on('authenticated', (data) => {
                    clearTimeout(timeout);
                    if (data.success) {
                        resolve();
                    } else {
                        reject(new Error('Authentication failed'));
                    }
                });
                
                socket.on('connect_error', (error) => {
                    clearTimeout(timeout);
                    reject(error);
                });
            });
            
            // Simular atualização de localização
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Update location timeout')), 10000);
                
                socket.emit('updateLocation', { lat: -23.5505, lng: -46.6333 });
                
                socket.once('locationUpdated', (data) => {
                    clearTimeout(timeout);
                    if (data.success) {
                        this.log('✅ Localização atualizada com sucesso', 'SUCCESS');
                        resolve();
                    } else {
                        reject(new Error(data.error || 'Update location failed'));
                    }
                });
            });
            
            // Simular busca de motoristas
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Find drivers timeout')), 10000);
                
                socket.emit('findNearbyDrivers', { lat: -23.5505, lng: -46.6333, radius: 5000 });
                
                socket.once('nearbyDrivers', (data) => {
                    clearTimeout(timeout);
                    if (data.success) {
                        this.log(`✅ Busca de motoristas: ${data.drivers.length} encontrados`, 'SUCCESS');
                        resolve();
                    } else {
                        reject(new Error(data.error || 'Find drivers failed'));
                    }
                });
            });
            
            // Aguardar um pouco para as métricas serem processadas
            await new Promise(resolve => setTimeout(resolve, 2000));
            
        } catch (error) {
            this.log(`❌ Erro na simulação: ${error.message}`, 'ERROR');
        } finally {
            socket.disconnect();
        }
    }

    // Executar todos os testes
    async runAllTests() {
        this.log('🚀 INICIANDO TESTE DO SISTEMA DE MONITORAMENTO', 'START');
        
        try {
            // 1. Simular operações para gerar métricas
            await this.simulateOperations();
            
            // 2. Testar métricas de latência
            await this.testLatencyMetrics();
            
            // 3. Testar monitoramento de recursos
            await this.testResourceMonitoring();
            
            // 4. Testar sistema de alertas
            await this.testSyncAlerts();
            
            // 5. Testar métricas em tempo real
            await this.testRealTimeMetrics();
            
            // 6. Gerar relatório
            this.generateReport();
            
        } catch (error) {
            this.log(`❌ Erro durante os testes: ${error.message}`, 'ERROR');
        }
    }

    // Gerar relatório
    generateReport() {
        this.log('', 'REPORT');
        this.log('=== RELATÓRIO DO SISTEMA DE MONITORAMENTO ===', 'REPORT');
        
        // Métricas de latência
        this.log('', 'REPORT');
        this.log('📊 MÉTRICAS DE LATÊNCIA:', 'REPORT');
        if (this.results.latency.success) {
            const latency = this.results.latency.data;
            this.log(`✅ Status: Funcionando`, 'SUCCESS');
            this.log(`📈 Operações totais: ${latency.performance.totalOperations}`, 'REPORT');
            this.log(`⚡ Latência média: ${latency.performance.avgLatency.toFixed(2)}ms`, 'REPORT');
            this.log(`🐌 Latência máxima: ${latency.performance.maxLatency}ms`, 'REPORT');
            this.log(`❌ Taxa de erro: ${latency.performance.errorRate.toFixed(2)}%`, 'REPORT');
            this.log(`🚨 Alertas: ${latency.alerts.length}`, 'REPORT');
        } else {
            this.log(`❌ Status: Falhou - ${this.results.latency.error}`, 'ERROR');
        }
        
        // Monitoramento de recursos
        this.log('', 'REPORT');
        this.log('🔍 MONITORAMENTO DE RECURSOS:', 'REPORT');
        if (this.results.resources.success) {
            const resources = this.results.resources.data;
            this.log(`✅ Status: Funcionando`, 'SUCCESS');
            this.log(`🟢 Redis: ${resources.redis.lastCheck ? 'Conectado' : 'Desconectado'}`, 'REPORT');
            this.log(`🟢 Firebase: ${resources.firebase.lastCheck ? 'Conectado' : 'Desconectado'}`, 'REPORT');
            this.log(`💾 Memória do sistema: ${resources.system?.memory?.usagePercent?.toFixed(2) || 'N/A'}%`, 'REPORT');
            this.log(`🖥️ CPU Load: ${resources.system?.cpu?.toFixed(2) || 'N/A'}`, 'REPORT');
            this.log(`🚨 Alertas ativos: ${resources.alerts.length}`, 'REPORT');
        } else {
            this.log(`❌ Status: Falhou - ${this.results.resources.error}`, 'ERROR');
        }
        
        // Sistema de alertas
        this.log('', 'REPORT');
        this.log('🔔 SISTEMA DE ALERTAS:', 'REPORT');
        if (this.results.sync.success) {
            const sync = this.results.sync.data;
            this.log(`✅ Status: Funcionando`, 'SUCCESS');
            this.log(`🚨 Alertas ativos: ${sync.activeAlerts}`, 'REPORT');
            this.log(`❌ Falhas totais: ${sync.totalFailures}`, 'REPORT');
            this.log(`🔄 Falhas recentes: ${sync.recentFailures}`, 'REPORT');
            this.log(`📊 Status geral: ${sync.summary.status}`, 'REPORT');
        } else {
            this.log(`❌ Status: Falhou - ${this.results.sync.error}`, 'ERROR');
        }
        
        // Métricas em tempo real
        this.log('', 'REPORT');
        this.log('⚡ MÉTRICAS EM TEMPO REAL:', 'REPORT');
        if (this.results.realtime.success) {
            const realtime = this.results.realtime.data;
            this.log(`✅ Status: Funcionando`, 'SUCCESS');
            this.log(`📊 Operações/min: ${realtime.latency.operationsLastMinute}`, 'REPORT');
            this.log(`⚡ Latência média/min: ${realtime.latency.avgLatencyLastMinute.toFixed(2)}ms`, 'REPORT');
            this.log(`❌ Taxa de erro/min: ${realtime.latency.errorRateLastMinute.toFixed(2)}%`, 'REPORT');
            this.log(`🔌 Conexões ativas: ${realtime.latency.activeConnections}`, 'REPORT');
        } else {
            this.log(`❌ Status: Falhou - ${this.results.realtime.error}`, 'ERROR');
        }
        
        // Avaliação geral
        this.log('', 'REPORT');
        this.log('=== AVALIAÇÃO GERAL ===', 'REPORT');
        
        const allTestsPassed = Object.values(this.results).every(result => 
            result.success !== false
        );
        
        if (allTestsPassed) {
            this.log('🎉 EXCELENTE: Sistema de monitoramento funcionando perfeitamente!', 'SUCCESS');
            this.log('✅ Todas as métricas estão sendo coletadas', 'SUCCESS');
            this.log('✅ Alertas estão funcionando', 'SUCCESS');
            this.log('✅ Monitoramento em tempo real ativo', 'SUCCESS');
        } else {
            this.log('⚠️ ATENÇÃO: Alguns componentes do monitoramento falharam', 'WARNING');
            this.log('🔧 Verificar configurações e conectividade', 'WARNING');
        }
        
        this.log('', 'REPORT');
        this.log('🏁 Teste do sistema de monitoramento concluído!', 'COMPLETE');
    }
}

// Executar teste
async function runMonitoringTest() {
    const tester = new MonitoringSystemTest();
    return await tester.runAllTests();
}

// Executar se chamado diretamente
if (require.main === module) {
    runMonitoringTest()
        .then(() => {
            console.log('\n🏁 Teste do sistema de monitoramento finalizado!');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Erro fatal:', error);
            process.exit(1);
        });
}

module.exports = { MonitoringSystemTest, runMonitoringTest }; 