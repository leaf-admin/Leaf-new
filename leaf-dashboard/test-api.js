const fetch = require('node-fetch');

async function testApi() {
    try {
        console.log('🧪 Testando API do backend...\n');
        
        // Testar endpoint de saúde
        console.log('1. Testando /health...');
        const healthResponse = await fetch('http://localhost:3001/health');
        const healthData = await healthResponse.json();
        console.log('✅ Health:', healthData);
        
        // Testar endpoint de métricas
        console.log('\n2. Testando /metrics...');
        const metricsResponse = await fetch('http://localhost:3001/metrics');
        const metricsData = await metricsResponse.json();
        console.log('✅ Metrics structure:');
        console.log('- timestamp:', typeof metricsData.timestamp);
        console.log('- container:', typeof metricsData.container);
        console.log('- redis:', typeof metricsData.redis);
        console.log('- system:', typeof metricsData.system);
        console.log('- host:', typeof metricsData.host);
        console.log('- alerts:', Array.isArray(metricsData.alerts));
        console.log('- summary:', typeof metricsData.summary);
        
        console.log('\n3. Dados do Redis:');
        console.log('- status:', metricsData.redis?.status);
        console.log('- connections:', metricsData.redis?.connections);
        console.log('- latency:', metricsData.redis?.latency);
        
        console.log('\n4. Dados do Container:');
        console.log('- status:', metricsData.container?.status);
        console.log('- cpu:', metricsData.container?.cpu);
        console.log('- memory:', metricsData.container?.memory);
        
        console.log('\n🎯 Teste da API concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar API:', error.message);
    }
}

testApi(); 