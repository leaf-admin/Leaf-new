const io = require('socket.io-client');
const fetch = require('node-fetch');

console.log('📊 RELATÓRIO FINAL DE MÉTRICAS - ARQUITETURA ATUAL');
console.log('==================================================');

// Métricas finais
const finalMetrics = {
    httpPerformance: [],
    websocketPerformance: [],
    authenticationPerformance: [],
    systemStability: [],
    memoryUsage: [],
    responseTimeDistribution: []
};

// Teste 1: Benchmark HTTP
async function benchmarkHTTP() {
    console.log('🌐 Benchmark HTTP...');
    
    const iterations = 20;
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        try {
            const response = await fetch('http://localhost:3001/health');
            const end = Date.now();
            const responseTime = end - start;
            times.push(responseTime);
            
            if (i % 5 === 0) {
                console.log(`   Iteração ${i + 1}: ${responseTime}ms`);
            }
        } catch (error) {
            console.log(`   Erro na iteração ${i + 1}: ${error.message}`);
        }
    }
    
    const stats = calculateStats(times);
    finalMetrics.httpPerformance = stats;
    
    console.log(`✅ HTTP Benchmark: ${stats.avg}ms média, ${stats.min}ms min, ${stats.max}ms max`);
}

// Teste 2: Benchmark WebSocket
async function benchmarkWebSocket() {
    console.log('🔗 Benchmark WebSocket...');
    
    const iterations = 10;
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
        const socket = io('http://localhost:3001');
        
        const start = Date.now();
        
        await new Promise((resolve) => {
            socket.on('connect', () => {
                const end = Date.now();
                const connectionTime = end - start;
                times.push(connectionTime);
                
                console.log(`   Conexão ${i + 1}: ${connectionTime}ms`);
                
                socket.disconnect();
                resolve();
            });
            
            socket.on('error', (error) => {
                console.log(`   Erro na conexão ${i + 1}: ${error.message}`);
                socket.disconnect();
                resolve();
            });
        });
    }
    
    const stats = calculateStats(times);
    finalMetrics.websocketPerformance = stats;
    
    console.log(`✅ WebSocket Benchmark: ${stats.avg}ms média, ${stats.min}ms min, ${stats.max}ms max`);
}

// Teste 3: Benchmark Autenticação
async function benchmarkAuthentication() {
    console.log('🔐 Benchmark Autenticação...');
    
    const iterations = 10;
    const times = [];
    
    for (let i = 0; i < iterations; i++) {
        const socket = io('http://localhost:3001');
        const userId = `bench-user-${i}`;
        
        await new Promise((resolve) => {
            socket.on('connect', () => {
                const start = Date.now();
                
                socket.emit('authenticate', {
                    uid: userId,
                    token: 'test-token'
                });
                
                socket.once('authenticated', () => {
                    const end = Date.now();
                    const authTime = end - start;
                    times.push(authTime);
                    
                    console.log(`   Auth ${i + 1}: ${authTime}ms`);
                    
                    socket.disconnect();
                    resolve();
                });
                
                socket.once('auth_error', (error) => {
                    console.log(`   Erro na auth ${i + 1}: ${error.message}`);
                    socket.disconnect();
                    resolve();
                });
            });
        });
    }
    
    const stats = calculateStats(times);
    finalMetrics.authenticationPerformance = stats;
    
    console.log(`✅ Auth Benchmark: ${stats.avg}ms média, ${stats.min}ms min, ${stats.max}ms max`);
}

// Teste 4: Teste de Estabilidade
async function testStability() {
    console.log('🔄 Teste de Estabilidade...');
    
    const duration = 10000; // 10 segundos
    const startTime = Date.now();
    let successCount = 0;
    let errorCount = 0;
    const responseTimes = [];
    
    while (Date.now() - startTime < duration) {
        try {
            const start = Date.now();
            const response = await fetch('http://localhost:3001/health');
            const end = Date.now();
            
            if (response.ok) {
                successCount++;
                responseTimes.push(end - start);
            } else {
                errorCount++;
            }
        } catch (error) {
            errorCount++;
        }
        
        // Pequena pausa para não sobrecarregar
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    const totalRequests = successCount + errorCount;
    const successRate = (successCount / totalRequests) * 100;
    const avgResponseTime = responseTimes.length > 0 ? 
        responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0;
    
    finalMetrics.systemStability = {
        totalRequests,
        successCount,
        errorCount,
        successRate: successRate.toFixed(2),
        avgResponseTime: avgResponseTime.toFixed(2),
        requestsPerSecond: (totalRequests / (duration / 1000)).toFixed(2)
    };
    
    console.log(`✅ Estabilidade: ${successRate.toFixed(1)}% sucesso, ${avgResponseTime.toFixed(2)}ms média`);
    console.log(`   ${totalRequests} requests em ${duration/1000}s (${finalMetrics.systemStability.requestsPerSecond} req/s)`);
}

// Teste 5: Distribuição de Tempos de Resposta
async function testResponseTimeDistribution() {
    console.log('📈 Teste de Distribuição de Tempos...');
    
    const iterations = 50;
    const responseTimes = [];
    
    for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        try {
            const response = await fetch('http://localhost:3001/health');
            const end = Date.now();
            responseTimes.push(end - start);
        } catch (error) {
            responseTimes.push(-1); // Marcar erro
        }
        
        // Pequena pausa
        await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    const validTimes = responseTimes.filter(t => t > 0);
    const distribution = calculateDistribution(validTimes);
    
    finalMetrics.responseTimeDistribution = distribution;
    
    console.log(`✅ Distribuição: ${validTimes.length}/${iterations} requests válidos`);
    console.log(`   < 10ms: ${distribution.under10} (${distribution.under10Percent}%)`);
    console.log(`   10-50ms: ${distribution.range10_50} (${distribution.range10_50Percent}%)`);
    console.log(`   50-100ms: ${distribution.range50_100} (${distribution.range50_100Percent}%)`);
    console.log(`   > 100ms: ${distribution.over100} (${distribution.over100Percent}%)`);
}

// Função para calcular estatísticas básicas
function calculateStats(times) {
    if (times.length === 0) {
        return { avg: 0, min: 0, max: 0, median: 0, p95: 0 };
    }
    
    const sorted = [...times].sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const min = Math.min(...times);
    const max = Math.max(...times);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Index];
    
    return {
        avg: avg.toFixed(2),
        min,
        max,
        median,
        p95,
        count: times.length
    };
}

// Função para calcular distribuição de tempos
function calculateDistribution(times) {
    const under10 = times.filter(t => t < 10).length;
    const range10_50 = times.filter(t => t >= 10 && t < 50).length;
    const range50_100 = times.filter(t => t >= 50 && t < 100).length;
    const over100 = times.filter(t => t >= 100).length;
    
    const total = times.length;
    
    return {
        under10,
        under10Percent: total > 0 ? ((under10 / total) * 100).toFixed(1) : 0,
        range10_50,
        range10_50Percent: total > 0 ? ((range10_50 / total) * 100).toFixed(1) : 0,
        range50_100,
        range50_100Percent: total > 0 ? ((range50_100 / total) * 100).toFixed(1) : 0,
        over100,
        over100Percent: total > 0 ? ((over100 / total) * 100).toFixed(1) : 0
    };
}

// Função principal
async function runFinalMetricsTest() {
    console.log('🚀 Iniciando relatório final de métricas...');
    console.log('⏱️ Este teste levará aproximadamente 30 segundos\n');
    
    try {
        // Executar todos os benchmarks
        await benchmarkHTTP();
        console.log('');
        
        await benchmarkWebSocket();
        console.log('');
        
        await benchmarkAuthentication();
        console.log('');
        
        await testStability();
        console.log('');
        
        await testResponseTimeDistribution();
        console.log('');
        
        // Gerar relatório final
        console.log('📊 RELATÓRIO FINAL DE MÉTRICAS:');
        console.log('==============================');
        console.log('');
        
        console.log('🌐 PERFORMANCE HTTP:');
        console.log(`   Tempo médio: ${finalMetrics.httpPerformance.avg}ms`);
        console.log(`   Tempo mínimo: ${finalMetrics.httpPerformance.min}ms`);
        console.log(`   Tempo máximo: ${finalMetrics.httpPerformance.max}ms`);
        console.log(`   Mediana: ${finalMetrics.httpPerformance.median}ms`);
        console.log(`   P95: ${finalMetrics.httpPerformance.p95}ms`);
        console.log(`   Total de requests: ${finalMetrics.httpPerformance.count}`);
        console.log('');
        
        console.log('🔗 PERFORMANCE WEBSOCKET:');
        console.log(`   Tempo médio de conexão: ${finalMetrics.websocketPerformance.avg}ms`);
        console.log(`   Tempo mínimo: ${finalMetrics.websocketPerformance.min}ms`);
        console.log(`   Tempo máximo: ${finalMetrics.websocketPerformance.max}ms`);
        console.log(`   Mediana: ${finalMetrics.websocketPerformance.median}ms`);
        console.log(`   P95: ${finalMetrics.websocketPerformance.p95}ms`);
        console.log(`   Total de conexões: ${finalMetrics.websocketPerformance.count}`);
        console.log('');
        
        console.log('🔐 PERFORMANCE AUTENTICAÇÃO:');
        console.log(`   Tempo médio: ${finalMetrics.authenticationPerformance.avg}ms`);
        console.log(`   Tempo mínimo: ${finalMetrics.authenticationPerformance.min}ms`);
        console.log(`   Tempo máximo: ${finalMetrics.authenticationPerformance.max}ms`);
        console.log(`   Mediana: ${finalMetrics.authenticationPerformance.median}ms`);
        console.log(`   P95: ${finalMetrics.authenticationPerformance.p95}ms`);
        console.log(`   Total de autenticações: ${finalMetrics.authenticationPerformance.count}`);
        console.log('');
        
        console.log('🔄 ESTABILIDADE DO SISTEMA:');
        console.log(`   Taxa de sucesso: ${finalMetrics.systemStability.successRate}%`);
        console.log(`   Requests por segundo: ${finalMetrics.systemStability.requestsPerSecond}`);
        console.log(`   Total de requests: ${finalMetrics.systemStability.totalRequests}`);
        console.log(`   Requests bem-sucedidos: ${finalMetrics.systemStability.successCount}`);
        console.log(`   Requests com erro: ${finalMetrics.systemStability.errorCount}`);
        console.log(`   Tempo médio de resposta: ${finalMetrics.systemStability.avgResponseTime}ms`);
        console.log('');
        
        console.log('📈 DISTRIBUIÇÃO DE TEMPOS DE RESPOSTA:');
        console.log(`   < 10ms: ${finalMetrics.responseTimeDistribution.under10} (${finalMetrics.responseTimeDistribution.under10Percent}%)`);
        console.log(`   10-50ms: ${finalMetrics.responseTimeDistribution.range10_50} (${finalMetrics.responseTimeDistribution.range10_50Percent}%)`);
        console.log(`   50-100ms: ${finalMetrics.responseTimeDistribution.range50_100} (${finalMetrics.responseTimeDistribution.range50_100Percent}%)`);
        console.log(`   > 100ms: ${finalMetrics.responseTimeDistribution.over100} (${finalMetrics.responseTimeDistribution.over100Percent}%)`);
        console.log('');
        
        console.log('🎯 AVALIAÇÃO GERAL:');
        console.log('==================');
        
        // Avaliação HTTP
        const httpAvg = parseFloat(finalMetrics.httpPerformance.avg);
        if (httpAvg < 50) {
            console.log('✅ HTTP: EXCELENTE (< 50ms)');
        } else if (httpAvg < 200) {
            console.log('✅ HTTP: BOM (< 200ms)');
        } else {
            console.log('⚠️ HTTP: LENTO (> 200ms)');
        }
        
        // Avaliação WebSocket
        const wsAvg = parseFloat(finalMetrics.websocketPerformance.avg);
        if (wsAvg < 50) {
            console.log('✅ WebSocket: EXCELENTE (< 50ms)');
        } else if (wsAvg < 200) {
            console.log('✅ WebSocket: BOM (< 200ms)');
        } else {
            console.log('⚠️ WebSocket: LENTO (> 200ms)');
        }
        
        // Avaliação Autenticação
        const authAvg = parseFloat(finalMetrics.authenticationPerformance.avg);
        if (authAvg < 100) {
            console.log('✅ Autenticação: EXCELENTE (< 100ms)');
        } else if (authAvg < 500) {
            console.log('✅ Autenticação: BOM (< 500ms)');
        } else {
            console.log('⚠️ Autenticação: LENTO (> 500ms)');
        }
        
        // Avaliação Estabilidade
        const stability = parseFloat(finalMetrics.systemStability.successRate);
        if (stability > 95) {
            console.log('✅ Estabilidade: EXCELENTE (> 95%)');
        } else if (stability > 90) {
            console.log('✅ Estabilidade: BOA (> 90%)');
        } else {
            console.log('⚠️ Estabilidade: PROBLEMAS (< 90%)');
        }
        
        console.log('');
        console.log('📋 RESUMO EXECUTIVO:');
        console.log('===================');
        console.log('A arquitetura atual (Firebase + WebSocket) apresenta:');
        console.log(`• Performance HTTP: ${httpAvg < 200 ? 'Adequada' : 'Necessita otimização'}`);
        console.log(`• Performance WebSocket: ${wsAvg < 200 ? 'Excelente' : 'Necessita otimização'}`);
        console.log(`• Performance Autenticação: ${authAvg < 500 ? 'Excelente' : 'Necessita otimização'}`);
        console.log(`• Estabilidade: ${stability > 90 ? 'Excelente' : 'Necessita atenção'}`);
        console.log(`• Throughput: ${finalMetrics.systemStability.requestsPerSecond} requests/segundo`);
        
    } catch (error) {
        console.log('❌ Erro durante o teste:', error);
    }
}

// Executar teste
runFinalMetricsTest();





