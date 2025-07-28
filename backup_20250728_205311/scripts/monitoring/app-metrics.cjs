// 📊 SISTEMA DE MÉTRICAS DO APP MOBILE - LEAF
const axios = require('axios');
const fs = require('fs');
const path = require('path');

class AppMetrics {
    constructor() {
        this.baseUrl = 'http://147.93.66.253:3000';
        this.metrics = {
            performance: {},
            errors: {},
            usage: {},
            connectivity: {}
        };
        this.startTime = Date.now();
    }

    // Testar latência das APIs
    async testApiLatency() {
        const apis = [
            '/api/health',
            '/api/update_user_location',
            '/api/update_driver_location',
            '/api/nearby_drivers',
            '/api/start_trip_tracking',
            '/api/update_trip_location',
            '/api/end_trip_tracking',
            '/api/get_trip_data'
        ];

        const results = {};

        for (const api of apis) {
            try {
                const start = Date.now();
                await axios.get(`${this.baseUrl}${api}`);
                const latency = Date.now() - start;
                results[api] = latency;
            } catch (error) {
                results[api] = -1; // Error
            }
        }

        return results;
    }

    // Testar conectividade WebSocket
    async testWebSocket() {
        try {
            const WebSocket = require('ws');
            const ws = new WebSocket('ws://147.93.66.253:3001');
            
            return new Promise((resolve) => {
                const start = Date.now();
                
                ws.on('open', () => {
                    const latency = Date.now() - start;
                    ws.close();
                    resolve({ status: 'connected', latency });
                });
                
                ws.on('error', () => {
                    resolve({ status: 'error', latency: -1 });
                });
                
                setTimeout(() => {
                    resolve({ status: 'timeout', latency: -1 });
                }, 2000);
            });
        } catch (error) {
            return { status: 'error', latency: -1 };
        }
    }

    // Simular uso do app
    async simulateAppUsage() {
        const usage = {
            userSessions: 0,
            locationUpdates: 0,
            tripStarts: 0,
            tripEnds: 0,
            payments: 0,
            errors: 0
        };

        try {
            // Simular atualização de localização
            await axios.post(`${this.baseUrl}/api/update_user_location`, {
                userId: 'test-user-123',
                lat: -23.5505,
                lng: -46.6333,
                timestamp: Date.now()
            });
            usage.locationUpdates++;

            // Simular busca de motoristas
            await axios.get(`${this.baseUrl}/api/nearby_drivers?lat=-23.5505&lng=-46.6333&radius=5`);
            usage.userSessions++;

            // Simular início de corrida
            await axios.post(`${this.baseUrl}/api/start_trip_tracking`, {
                tripId: 'test-trip-123',
                userId: 'test-user-123',
                driverId: 'test-driver-456',
                startLocation: { lat: -23.5505, lng: -46.6333 },
                endLocation: { lat: -23.5505, lng: -46.6333 }
            });
            usage.tripStarts++;

            // Simular atualização de localização durante corrida
            await axios.post(`${this.baseUrl}/api/update_trip_location`, {
                tripId: 'test-trip-123',
                lat: -23.5505,
                lng: -46.6333,
                timestamp: Date.now()
            });
            usage.locationUpdates++;

            // Simular fim de corrida
            await axios.post(`${this.baseUrl}/api/end_trip_tracking`, {
                tripId: 'test-trip-123',
                endLocation: { lat: -23.5505, lng: -46.6333 },
                totalDistance: 5.2,
                totalTime: 1200
            });
            usage.tripEnds++;

        } catch (error) {
            usage.errors++;
        }

        return usage;
    }

    // Coletar métricas do sistema
    async collectSystemMetrics() {
        const { exec } = require('child_process');
        const util = require('util');
        const execAsync = util.promisify(exec);

        try {
            // CPU e RAM da VPS
            const { stdout: cpuRam } = await execAsync('ssh root@147.93.66.253 "top -bn1 | grep -E \'(Cpu|Mem)\'"');
            
            // Redis info
            const { stdout: redisInfo } = await execAsync('ssh root@147.93.66.253 "redis-cli info"');
            
            // PM2 status
            const { stdout: pm2Status } = await execAsync('ssh root@147.93.66.253 "pm2 status"');

            return {
                cpuRam,
                redisInfo,
                pm2Status
            };
        } catch (error) {
            return {
                error: error.message
            };
        }
    }

    // Gerar relatório completo
    async generateReport() {
        console.log('📊 Coletando métricas do Leaf App...\n');

        // 1. Testar latência das APIs
        console.log('🔧 Testando latência das APIs...');
        const apiLatency = await this.testApiLatency();
        
        // 2. Testar WebSocket
        console.log('🔌 Testando WebSocket...');
        const wsTest = await this.testWebSocket();
        
        // 3. Simular uso do app
        console.log('📱 Simulando uso do app...');
        const appUsage = await this.simulateAppUsage();
        
        // 4. Coletar métricas do sistema
        console.log('💻 Coletando métricas do sistema...');
        const systemMetrics = await this.collectSystemMetrics();

        // 5. Gerar relatório
        const report = {
            timestamp: new Date().toISOString(),
            uptime: Date.now() - this.startTime,
            performance: {
                apiLatency,
                websocket: wsTest,
                averageLatency: Object.values(apiLatency).filter(l => l > 0).reduce((a, b) => a + b, 0) / Object.values(apiLatency).filter(l => l > 0).length
            },
            usage: appUsage,
            system: systemMetrics,
            summary: {
                totalApis: Object.keys(apiLatency).length,
                workingApis: Object.values(apiLatency).filter(l => l > 0).length,
                websocketStatus: wsTest.status,
                appSimulationSuccess: appUsage.errors === 0
            }
        };

        // Salvar relatório
        const reportPath = path.join(__dirname, 'app-metrics-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

        // Mostrar resumo
        console.log('\n📊 RESUMO DAS MÉTRICAS:');
        console.log('========================');
        console.log(`⏱️  Tempo de execução: ${Math.round(report.uptime / 1000)}s`);
        console.log(`📡 APIs funcionando: ${report.summary.workingApis}/${report.summary.totalApis}`);
        console.log(`🔌 WebSocket: ${report.summary.websocketStatus}`);
        console.log(`📱 Simulação do app: ${report.summary.appSimulationSuccess ? '✅ Sucesso' : '❌ Falha'}`);
        console.log(`⚡ Latência média: ${Math.round(report.performance.averageLatency)}ms`);
        console.log(`🔄 Atualizações de localização: ${appUsage.locationUpdates}`);
        console.log(`🚗 Corridas simuladas: ${appUsage.tripStarts}`);
        console.log(`❌ Erros: ${appUsage.errors}`);

        console.log(`\n📄 Relatório salvo em: ${reportPath}`);

        return report;
    }

    // Monitoramento contínuo
    async startMonitoring(interval = 30000) { // 30 segundos
        console.log(`🔄 Iniciando monitoramento a cada ${interval/1000}s...`);
        console.log('Pressione Ctrl+C para parar\n');

        const monitor = setInterval(async () => {
            try {
                await this.generateReport();
                console.log(`\n⏰ Próxima verificação em ${interval/1000}s...\n`);
            } catch (error) {
                console.error('❌ Erro no monitoramento:', error.message);
            }
        }, interval);

        // Parar monitoramento com Ctrl+C
        process.on('SIGINT', () => {
            clearInterval(monitor);
            console.log('\n🛑 Monitoramento parado.');
            process.exit(0);
        });
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const metrics = new AppMetrics();
    
    const args = process.argv.slice(2);
    
    if (args.includes('--monitor')) {
        const interval = parseInt(args[args.indexOf('--interval') + 1]) || 30000;
        metrics.startMonitoring(interval);
    } else {
        metrics.generateReport();
    }
}

module.exports = AppMetrics; 