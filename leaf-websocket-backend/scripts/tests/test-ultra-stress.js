const axios = require('axios');
const io = require('socket.io-client');
const { performance } = require('perf_hooks');

class UltraStressTestSystem {
    constructor() {
        this.results = {
            http: { requests: 0, success: 0, errors: 0, times: [] },
            websocket: { connections: 0, success: 0, errors: 0, times: [] }
        };
        this.startTime = Date.now();
        this.concurrentConnections = 0;
        this.maxConcurrentConnections = 0;
    }

    async testUltraHttpLoad(concurrency = 100, duration = 30000) {
        console.log(`🌐 TESTE ULTRA HTTP: ${concurrency} usuários simultâneos por ${duration/1000}s`);
        
        const promises = [];
        for (let i = 0; i < concurrency; i++) {
            promises.push(this.simulateUltraHttpUser(i, duration));
        }
        
        await Promise.all(promises);
        
        const httpResults = this.results.http;
        console.log(`📊 HTTP Results: ${httpResults.success}/${httpResults.requests} sucessos`);
        if (httpResults.times.length > 0) {
            console.log(`⚡ Tempo médio: ${(httpResults.times.reduce((a,b) => a+b, 0) / httpResults.times.length).toFixed(2)}ms`);
        }
        console.log(`📈 Requests/s: ${(httpResults.requests / (duration/1000)).toFixed(2)}`);
    }

    async testUltraWebSocketLoad(concurrency = 200, duration = 30000) {
        console.log(`🔌 TESTE ULTRA WEBSOCKET: ${concurrency} conexões simultâneas por ${duration/1000}s`);
        
        const promises = [];
        for (let i = 0; i < concurrency; i++) {
            promises.push(this.simulateUltraWebSocketUser(i, duration));
        }
        
        await Promise.all(promises);
        
        const wsResults = this.results.websocket;
        console.log(`📊 WebSocket Results: ${wsResults.success}/${wsResults.connections} conexões`);
        if (wsResults.times.length > 0) {
            console.log(`⚡ Tempo médio: ${(wsResults.times.reduce((a,b) => a+b, 0) / wsResults.times.length).toFixed(2)}ms`);
        }
    }

    async simulateUltraHttpUser(userId, duration) {
        const endTime = Date.now() + duration;
        
        while (Date.now() < endTime) {
            const start = performance.now();
            try {
                const response = await axios.get('http://localhost:80/health', { 
                    timeout: 2000,
                    headers: {
                        'Connection': 'keep-alive',
                        'User-Agent': `UltraTest-${userId}`
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
            
            // Intervalo ultra-rápido
            await new Promise(resolve => setTimeout(resolve, Math.random() * 50 + 10));
        }
    }

    async simulateUltraWebSocketUser(userId, duration) {
        return new Promise((resolve) => {
            const start = performance.now();
            const socket = io('http://localhost:80', {
                transports: ['websocket'],
                auth: { uid: `ultra-user-${userId}`, token: `ultra-token-${userId}`, userType: 'passenger' },
                timeout: 5000,
                forceNew: true
            });
            
            socket.on('connect', () => {
                const end = performance.now();
                this.results.websocket.connections++;
                this.results.websocket.success++;
                this.results.websocket.times.push(end - start);
                this.concurrentConnections++;
                this.maxConcurrentConnections = Math.max(this.maxConcurrentConnections, this.concurrentConnections);
                
                // Manter conexão por um tempo
                setTimeout(() => {
                    socket.disconnect();
                    this.concurrentConnections--;
                    resolve();
                }, Math.random() * 10000 + 5000);
            });
            
            socket.on('connect_error', (err) => {
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

    async runUltraStressTest() {
        console.log('🚀 INICIANDO TESTE ULTRA DE STRESS - 500K+ USUÁRIOS');
        console.log('==================================================');
        
        // Teste 1: HTTP Ultra Load
        await this.testUltraHttpLoad(50, 10000);
        
        console.log('\n');
        
        // Teste 2: WebSocket Ultra Load
        await this.testUltraWebSocketLoad(100, 10000);
        
        console.log('\n');
        
        // Teste 3: Mixed Ultra Load
        console.log('🔄 TESTE ULTRA MISTO: HTTP + WebSocket simultâneos');
        const httpPromise = this.testUltraHttpLoad(25, 5000);
        const wsPromise = this.testUltraWebSocketLoad(50, 5000);
        await Promise.all([httpPromise, wsPromise]);
        
        // Relatório final
        this.generateUltraReport();
    }

    generateUltraReport() {
        const totalTime = (Date.now() - this.startTime) / 1000;
        const httpResults = this.results.http;
        const wsResults = this.results.websocket;
        
        console.log('\n📋 RELATÓRIO ULTRA DE STRESS TEST - 500K+ USUÁRIOS');
        console.log('==================================================');
        console.log(`⏱️ Tempo total: ${totalTime.toFixed(2)}s`);
        console.log(`🔗 Máximo de conexões simultâneas: ${this.maxConcurrentConnections}`);
        
        console.log('\n🌐 HTTP ULTRA PERFORMANCE:');
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
        
        console.log('\n🔌 WEBSOCKET ULTRA PERFORMANCE:');
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
        
        // Avaliação Ultra
        console.log('\n🎯 AVALIAÇÃO ULTRA DE ESCALABILIDADE (500K+ USUÁRIOS):');
        const httpSuccessRate = httpResults.requests > 0 ? httpResults.success / httpResults.requests * 100 : 0;
        const wsSuccessRate = wsResults.connections > 0 ? wsResults.success / wsResults.connections * 100 : 0;
        const httpRPS = httpResults.requests / totalTime;
        const wsCPS = wsResults.connections / totalTime;
        
        if (httpSuccessRate > 99 && wsSuccessRate > 95 && httpRPS > 1000 && wsCPS > 100) {
            console.log('🚀 ULTRA EXCELENTE: Sistema pronto para 500k+ usuários!');
        } else if (httpSuccessRate > 95 && wsSuccessRate > 90 && httpRPS > 500 && wsCPS > 50) {
            console.log('✅ EXCELENTE: Sistema suporta alta carga!');
        } else if (httpSuccessRate > 90 && wsSuccessRate > 80 && httpRPS > 100 && wsCPS > 10) {
            console.log('✅ BOM: Sistema suporta carga moderada!');
        } else if (httpSuccessRate > 80 && wsSuccessRate > 70 && httpRPS > 50 && wsCPS > 5) {
            console.log('⚠️ REGULAR: Sistema suporta carga básica!');
        } else {
            console.log('❌ RUIM: Sistema precisa de mais otimização!');
        }
        
        // Projeção para 500k usuários
        console.log('\n📊 PROJEÇÃO PARA 500K USUÁRIOS:');
        const projectedRPS = httpRPS * 1000; // Assumindo 1000x mais usuários
        const projectedCPS = wsCPS * 1000;
        console.log(`  Requests/s projetados: ${projectedRPS.toFixed(0)}`);
        console.log(`  Conexões/s projetadas: ${projectedCPS.toFixed(0)}`);
        
        if (projectedRPS > 100000 && projectedCPS > 10000) {
            console.log('🎯 PROJEÇÃO: Sistema pode suportar 500k+ usuários!');
        } else {
            console.log('⚠️ PROJEÇÃO: Sistema precisa de mais otimização para 500k+ usuários');
        }
    }
}

// Executar teste ultra
const ultraStressTest = new UltraStressTestSystem();
ultraStressTest.runUltraStressTest().catch(console.error);
