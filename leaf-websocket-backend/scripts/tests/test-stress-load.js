const axios = require('axios');
const io = require('socket.io-client');
const { performance } = require('perf_hooks');

class StressTestSystem {
    constructor() {
        this.results = {
            http: { requests: 0, success: 0, errors: 0, times: [] },
            websocket: { connections: 0, success: 0, errors: 0, times: [] },
            concurrent: { max: 0, current: 0 }
        };
        this.startTime = Date.now();
    }

    async testHttpLoad(concurrency = 50, duration = 30000) {
        console.log(`🌐 Teste HTTP: ${concurrency} usuários simultâneos por ${duration/1000}s`);
        
        const promises = [];
        for (let i = 0; i < concurrency; i++) {
            promises.push(this.simulateHttpUser(i, duration));
        }
        
        await Promise.all(promises);
        
        const httpResults = this.results.http;
        console.log(`📊 HTTP Results: ${httpResults.success}/${httpResults.requests} sucessos`);
        console.log(`⚡ Tempo médio: ${(httpResults.times.reduce((a,b) => a+b, 0) / httpResults.times.length).toFixed(2)}ms`);
        console.log(`📈 Requests/s: ${(httpResults.requests / (duration/1000)).toFixed(2)}`);
    }

    async testWebSocketLoad(concurrency = 100, duration = 30000) {
        console.log(`🔌 Teste WebSocket: ${concurrency} conexões simultâneas por ${duration/1000}s`);
        
        const promises = [];
        for (let i = 0; i < concurrency; i++) {
            promises.push(this.simulateWebSocketUser(i, duration));
        }
        
        await Promise.all(promises);
        
        const wsResults = this.results.websocket;
        console.log(`📊 WebSocket Results: ${wsResults.success}/${wsResults.connections} conexões`);
        console.log(`⚡ Tempo médio: ${(wsResults.times.reduce((a,b) => a+b, 0) / wsResults.times.length).toFixed(2)}ms`);
    }

    async simulateHttpUser(userId, duration) {
        const endTime = Date.now() + duration;
        
        while (Date.now() < endTime) {
            const start = performance.now();
            try {
                await axios.get('http://localhost:8080/health', { timeout: 5000 });
                const end = performance.now();
                this.results.http.requests++;
                this.results.http.success++;
                this.results.http.times.push(end - start);
            } catch (error) {
                this.results.http.requests++;
                this.results.http.errors++;
            }
            
            // Intervalo aleatório
            await new Promise(resolve => setTimeout(resolve, Math.random() * 200 + 50));
        }
    }

    async simulateWebSocketUser(userId, duration) {
        return new Promise((resolve) => {
            const start = performance.now();
            const socket = io('http://localhost:8080', {
                transports: ['websocket'],
                auth: { uid: `stress-user-${userId}`, token: `mock-token-${userId}`, userType: 'passenger' }
            });
            
            socket.on('connect', () => {
                const end = performance.now();
                this.results.websocket.connections++;
                this.results.websocket.success++;
                this.results.websocket.times.push(end - start);
                
                // Manter conexão por um tempo
                setTimeout(() => {
                    socket.disconnect();
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

    async runComprehensiveStressTest() {
        console.log('🚀 INICIANDO TESTE DE STRESS COMPREHENSIVO');
        console.log('==========================================');
        
        // Teste 1: HTTP Load
        await this.testHttpLoad(25, 15000);
        
        console.log('\n');
        
        // Teste 2: WebSocket Load
        await this.testWebSocketLoad(50, 15000);
        
        console.log('\n');
        
        // Teste 3: Mixed Load
        console.log('🔄 Teste Misto: HTTP + WebSocket simultâneos');
        const httpPromise = this.testHttpLoad(15, 10000);
        const wsPromise = this.testWebSocketLoad(25, 10000);
        await Promise.all([httpPromise, wsPromise]);
        
        // Relatório final
        this.generateFinalReport();
    }

    generateFinalReport() {
        const totalTime = (Date.now() - this.startTime) / 1000;
        const httpResults = this.results.http;
        const wsResults = this.results.websocket;
        
        console.log('\n📋 RELATÓRIO FINAL DE STRESS TEST');
        console.log('==================================');
        console.log(`⏱️ Tempo total: ${totalTime.toFixed(2)}s`);
        
        console.log('\n🌐 HTTP PERFORMANCE:');
        console.log(`  Total requests: ${httpResults.requests}`);
        console.log(`  Sucessos: ${httpResults.success}`);
        console.log(`  Erros: ${httpResults.errors}`);
        console.log(`  Taxa de sucesso: ${(httpResults.success / httpResults.requests * 100).toFixed(2)}%`);
        console.log(`  Requests/s: ${(httpResults.requests / totalTime).toFixed(2)}`);
        if (httpResults.times.length > 0) {
            console.log(`  Tempo médio: ${(httpResults.times.reduce((a,b) => a+b, 0) / httpResults.times.length).toFixed(2)}ms`);
            console.log(`  Tempo min: ${Math.min(...httpResults.times).toFixed(2)}ms`);
            console.log(`  Tempo max: ${Math.max(...httpResults.times).toFixed(2)}ms`);
        }
        
        console.log('\n🔌 WEBSOCKET PERFORMANCE:');
        console.log(`  Total conexões: ${wsResults.connections}`);
        console.log(`  Sucessos: ${wsResults.success}`);
        console.log(`  Erros: ${wsResults.errors}`);
        console.log(`  Taxa de sucesso: ${(wsResults.success / wsResults.connections * 100).toFixed(2)}%`);
        console.log(`  Conexões/s: ${(wsResults.connections / totalTime).toFixed(2)}`);
        if (wsResults.times.length > 0) {
            console.log(`  Tempo médio: ${(wsResults.times.reduce((a,b) => a+b, 0) / wsResults.times.length).toFixed(2)}ms`);
            console.log(`  Tempo min: ${Math.min(...wsResults.times).toFixed(2)}ms`);
            console.log(`  Tempo max: ${Math.max(...wsResults.times).toFixed(2)}ms`);
        }
        
        // Avaliação
        console.log('\n🎯 AVALIAÇÃO DE ESCALABILIDADE:');
        const httpSuccessRate = httpResults.success / httpResults.requests * 100;
        const wsSuccessRate = wsResults.success / wsResults.connections * 100;
        const httpRPS = httpResults.requests / totalTime;
        const wsCPS = wsResults.connections / totalTime;
        
        if (httpSuccessRate > 95 && wsSuccessRate > 90 && httpRPS > 50 && wsCPS > 10) {
            console.log('✅ EXCELENTE: Sistema suporta alta carga!');
        } else if (httpSuccessRate > 90 && wsSuccessRate > 80 && httpRPS > 25 && wsCPS > 5) {
            console.log('✅ BOM: Sistema suporta carga moderada!');
        } else if (httpSuccessRate > 80 && wsSuccessRate > 70 && httpRPS > 10 && wsCPS > 2) {
            console.log('⚠️ REGULAR: Sistema suporta carga básica!');
        } else {
            console.log('❌ RUIM: Sistema precisa de otimização!');
        }
    }
}

// Executar teste
const stressTest = new StressTestSystem();
stressTest.runComprehensiveStressTest().catch(console.error);
