const AdvancedMonitoringSystem = require('./monitoring-system');

console.log('📊 TESTE DE MONITORAMENTO AVANÇADO');
console.log('===================================');

async function runAdvancedMonitoringTest() {
    const monitoring = new AdvancedMonitoringSystem();
    
    console.log('🔍 Coletando métricas iniciais...');
    const initialMetrics = await monitoring.collectMetrics();
    console.log('📊 Métricas iniciais:', JSON.stringify(initialMetrics, null, 2));
    
    console.log('\n🚀 Executando teste de carga...');
    const report = await monitoring.runLoadTest(15000, 5); // 15s, 5 usuários
    
    console.log('\n📋 RELATÓRIO FINAL DE MONITORAMENTO:');
    console.log('====================================');
    console.log(`⏰ Timestamp: ${report.timestamp}`);
    console.log(`📊 Total de Requests: ${report.summary.totalRequests}`);
    console.log(`✅ Taxa de Sucesso: ${report.summary.successRate}`);
    console.log(`⚡ Tempo Médio de Resposta: ${report.summary.avgResponseTime}`);
    console.log(`📈 P95 Response Time: ${report.summary.p95ResponseTime}`);
    console.log(`⏱️ Uptime: ${report.summary.uptime}`);
    
    console.log('\n🏗️ STATUS DAS INSTÂNCIAS:');
    Object.entries(report.instances).forEach(([instance, data]) => {
        console.log(`  ${instance}: ${data.healthy ? '✅' : '❌'} ${data.status} (${data.port || 'N/A'})`);
    });
    
    console.log('\n📈 PERFORMANCE DETALHADA:');
    console.log(`  Min: ${report.performance.min}`);
    console.log(`  Max: ${report.performance.max}`);
    console.log(`  Avg: ${report.performance.avg}`);
    console.log(`  P95: ${report.performance.p95}`);
    console.log(`  P99: ${report.performance.p99}`);
    
    console.log('\n🎯 AVALIAÇÃO:');
    const avgTime = parseFloat(report.performance.avg);
    const successRate = parseFloat(report.summary.successRate);
    
    if (avgTime < 50 && successRate > 95) {
        console.log('✅ EXCELENTE: Sistema performando muito bem!');
    } else if (avgTime < 100 && successRate > 90) {
        console.log('✅ BOM: Sistema performando bem!');
    } else if (avgTime < 200 && successRate > 80) {
        console.log('⚠️ REGULAR: Sistema com performance aceitável');
    } else {
        console.log('❌ RUIM: Sistema precisa de otimização');
    }
}

runAdvancedMonitoringTest().catch(console.error);
