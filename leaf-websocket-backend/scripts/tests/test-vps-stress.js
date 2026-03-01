const axios = require('axios');
const io = require('socket.io-client');
const { performance } = require('perf_hooks');

class VPSStressTestSystem {
    constructor() {
        this.vpsUrl = 'http://216.238.107.59:3001';
        this.results = {
            http: { requests: 0, success: 0, errors: 0, times: [] },
            websocket: { connections: 0, success: 0, errors: 0, times: [] }
        };
        this.startTime = Date.now();
        this.concurrentConnections = 0;
        this.maxConcurrentConnections = 0;
    }

    async testVPSHttpLoad(concurrency = 20, duration = 15000) {
        console.log(`🌐 TESTE VPS HTTP: ${concurrency} usuários simultâneos por ${duration/1000}s`);
        console.log(`🎯 Target: ${this.vpsUrl}`);
        
        const promises = [];
        for (let i = 0; i < concurrency; i++) {
            promises.push(this.simulateVPSHttpUser(i, duration));
        }
        
        await Promise.all(promises);
        
        const httpResults = this.results.http;
        console.log(`📊 HTTP Results: ${httpResults.success}/${httpResults.requests} sucessos`);
        if (httpResults.times.length > 0) {
            console.log(`⚡ Tempo médio: ${(httpResults.times.reduce((a,b) => a+b, 0) / httpResults.times.length).toFixed(2)}ms`);
        }
        console.log(`📈 Requests/s: ${(httpResults.requests / (duration/1000)).toFixed(2)}`);
    }

    async testVPSWebSocketLoad(concurrency = 30, duration = 15000) {
        console.log(`🔌 TESTE VPS WEBSOCKET: ${concurrency} conexões simultâneas por ${duration/1000}s`);
        console.log(`🎯 Target: ${this.vpsUrl}`);
        
        const promises = [];
        for (let i = 0; i < concurrency; i++) {
            promises.push(this.simulateVPSWebSocketUser(i, duration));
        }
        
        await Promise.all(promises);
        
        const wsResults = this.results.websocket;
        console.log(`📊 WebSocket Results: ${wsResults.success}/${wsResults.connections} conexões`);
        if (wsResults.times.length > 0) {
            console.log(`⚡ Tempo médio: ${(wsResults.times.reduce((a,b) => a+b, 0) / wsResults.times.length).toFixed(2)}ms`);
        }
    }

    async simulateVPSHttpUser(userId, duration) {
        const endTime = Date.now() + duration;
        
        while (Date.now() < endTime) {
            const start = performance.now();
            try {
                const response = await axios.get(`${this.vpsUrl}/health`, { 
                    timeout: 5000,
                    headers: {
                        'Connection': 'keep-alive',
                        'User-Agent': `VPS-Test-${userId}`
                    }
                });
                const end = performance.now();
                this.results.http.requests++;
                this.results.http.success++;
                this.results.http.times.push(end - start);
            } catch (error) {
                this.results.http.requests++;
                this.results.http.errors++;
            }
            
            // Intervalo para não sobrecarregar
            await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 100));
        }
    }

    async simulateVPSWebSocketUser(userId, duration) {
        return new Promise((resolve) => {
            const start = performance.now();
            const socket = io(this.vpsUrl, {
                transports: ['websocket'],
                auth: { uid: `vps-user-${userId}`, token: `vps-token-${userId}`, userType: 'passenger' },
                timeout: 10000,
                forceNew: true
            });
            
            socket.on('connect', () => {
                const end = performance.now();
                this.results.websocket.connections++;
                this.results.websocket.success++;
                this.results.websocket.times.push(end - start);
                this.concurrentConnections++;
                this.maxConcurrentConnections = Math.max(this.maxConcurrentConnections, this.concurrentConnections);
                
                console.log(`✅ VPS WebSocket ${userId}: Conectado (${socket.id})`);
                
                // Manter conexão por um tempo
                setTimeout(() => {
                    socket.disconnect();
                    this.concurrentConnections--;
                    resolve();
                }, Math.random() * 8000 + 5000);
            });
            
            socket.on('connect_error', (err) => {
                console.log(`❌ VPS WebSocket ${userId}: ${err.message}`);
                this.results.websocket.connections++;
                this.results.websocket.errors++;
                resolve();
            });
            
            // Timeout
            setTimeout(() => {
                socket.disconnect();
                resolve();
            }, duration);
        });
    }

    async runVPSStressTest() {
        console.log('🚀 INICIANDO TESTE DE STRESS DA VPS VULTR');
        console.log('=========================================');
        console.log(`🎯 Target VPS: ${this.vpsUrl}`);
        console.log(`⏰ Timestamp: ${new Date().toISOString()}`);
        
        // Teste 1: HTTP VPS Load
        await this.testVPSHttpLoad(10, 10000);
        
        console.log('\n');
        
        // Teste 2: WebSocket VPS Load
        await this.testVPSWebSocketLoad(15, 10000);
        
        console.log('\n');
        
        // Teste 3: Mixed VPS Load
        console.log('🔄 TESTE VPS MISTO: HTTP + WebSocket simultâneos');
        const httpPromise = this.testVPSHttpLoad(5, 5000);
        const wsPromise = this.testVPSWebSocketLoad(10, 5000);
        await Promise.all([httpPromise, wsPromise]);
        
        // Relatório final
        this.generateVPSReport();
    }

    generateVPSReport() {
        const totalTime = (Date.now() - this.startTime) / 1000;
        const httpResults = this.results.http;
        const wsResults = this.results.websocket;
        
        console.log('\n📋 RELATÓRIO FINAL DE STRESS TEST - VPS VULTR');
        console.log('==============================================');
        console.log(`🎯 Target VPS: ${this.vpsUrl}`);
        console.log(`⏱️ Tempo total: ${totalTime.toFixed(2)}s`);
        console.log(`🔗 Máximo de conexões simultâneas: ${this.maxConcurrentConnections}`);
        
        console.log('\n🌐 HTTP VPS PERFORMANCE:');
        console.log(`  Total requests: ${httpResults.requests}`);
        console.log(`  Sucessos: ${httpResults.success}`);
        console.log(`  Erros: ${httpResults.errors}`);
        console.log(`  Taxa de sucesso: ${httpResults.requests > 0 ? (httpResults.success / httpResults.requests * 100).toFixed(2) : 0}%`);
        console.log(`  Requests/s: ${(httpResults.requests / totalTime).toFixed(2)}`);
        if (httpResults.times.length > 0) {
            console.log(`  Tempo médio: ${(httpResults.times.reduce((a,b) => a+b, 0) / httpResults.times.length).toFixed(2)}ms`);
            console.log(`  Tempo min: ${Math.min(...httpResults.times).toFixed(2)}ms`);
            console.log(`  Tempo max: ${Math.max(...httpResults.times).toFixed(2)}ms`);
        }
        
        console.log('\n🔌 WEBSOCKET VPS PERFORMANCE:');
        console.log(`  Total conexões: ${wsResults.connections}`);
        console.log(`  Sucessos: ${wsResults.success}`);
        console.log(`  Erros: ${wsResults.errors}`);
        console.log(`  Taxa de sucesso: ${wsResults.connections > 0 ? (wsResults.success / wsResults.connections * 100).toFixed(2) : 0}%`);
        console.log(`  Conexões/s: ${(wsResults.connections / totalTime).toFixed(2)}`);
        if (wsResults.times.length > 0) {
            console.log(`  Tempo médio: ${(wsResults.times.reduce((a,b) => a+b, 0) / wsResults.times.length).toFixed(2)}ms`);
            console.log(`  Tempo min: ${Math.min(...wsResults.times).toFixed(2)}ms`);
            console.log(`  Tempo max: ${Math.max(...wsResults.times).toFixed(2)}ms`);
        }
        
        // Avaliação VPS
        console.log('\n🎯 AVALIAÇÃO DA CAPACIDADE DA VPS VULTR:');
        const httpSuccessRate = httpResults.requests > 0 ? httpResults.success / httpResults.requests * 100 : 0;
        const wsSuccessRate = wsResults.connections > 0 ? wsResults.success / wsResults.connections * 100 : 0;
        const httpRPS = httpResults.requests / totalTime;
        const wsCPS = wsResults.connections / totalTime;
        
        if (httpSuccessRate > 95 && wsSuccessRate > 90 && httpRPS > 50 && wsCPS > 5) {
            console.log('🚀 VPS EXCELENTE: Vultr tem capacidade real!');
        } else if (httpSuccessRate > 90 && wsSuccessRate > 80 && httpRPS > 25 && wsCPS > 2) {
            console.log('✅ VPS BOM: Vultr tem boa capacidade!');
        } else if (httpSuccessRate > 80 && wsSuccessRate > 70 && httpRPS > 10 && wsCPS > 1) {
            console.log('⚠️ VPS REGULAR: Vultr tem capacidade básica!');
        } else {
            console.log('❌ VPS RUIM: Vultr precisa de mais recursos!');
        }
        
        // Projeção para 500k usuários
        console.log('\n📊 PROJEÇÃO PARA 500K USUÁRIOS NA VPS:');
        const projectedRPS = httpRPS * 1000; // Assumindo 1000x mais usuários
        const projectedCPS = wsCPS * 1000;
        console.log(`  Requests/s projetados: ${projectedRPS.toFixed(0)}`);
        console.log(`  Conexões/s projetadas: ${projectedCPS.toFixed(0)}`);
        
        if (projectedRPS > 100000 && projectedCPS > 10000) {
            console.log('🎯 PROJEÇÃO: VPS pode suportar 500k+ usuários!');
        } else {
            console.log('⚠️ PROJEÇÃO: VPS precisa de mais recursos para 500k+ usuários');
        }
    }
}

// Executar teste VPS
const vpsStressTest = new VPSStressTestSystem();
vpsStressTest.runVPSStressTest().catch(console.error);
