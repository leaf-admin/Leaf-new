const http = require('http');

function testMetrics() {
    console.log('🔍 Testando endpoint de métricas...');
    
    const options = {
        hostname: 'localhost',
        port: 3001,
        path: '/metrics',
        method: 'GET'
    };
    
    const req = http.request(options, (res) => {
        console.log(`📡 Status: ${res.statusCode}`);
        
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        
        res.on('end', () => {
            try {
                const metrics = JSON.parse(data);
                console.log('\n📊 Métricas obtidas:');
                console.log('✅ Servidor respondendo!');
                
                console.log('\n📈 Container:');
                console.log(`- Status: ${metrics.container?.status}`);
                console.log(`- CPU: ${metrics.container?.cpu}%`);
                console.log(`- Memory: ${metrics.container?.memory?.percentage}%`);
                console.log(`- Uptime: ${metrics.container?.uptime}s`);
                
                console.log('\n🔴 Redis:');
                console.log(`- Status: ${metrics.redis?.status}`);
                console.log(`- Operations: ${metrics.redis?.operations}`);
                console.log(`- Latency: ${metrics.redis?.latency}ms`);
                console.log(`- Connections: ${metrics.redis?.connections}`);
                
                console.log('\n🚨 Alertas:');
                console.log(`- Total: ${metrics.summary?.totalAlerts}`);
                console.log(`- Status Geral: ${metrics.summary?.status}`);
                
            } catch (error) {
                console.error('❌ Erro ao parsear JSON:', error.message);
                console.log('Resposta bruta:', data.substring(0, 200) + '...');
            }
        });
    });
    
    req.on('error', (error) => {
        console.error('❌ Erro na requisição:', error.message);
        console.log('💡 Certifique-se de que o servidor está rodando em http://localhost:3001');
    });
    
    req.end();
}

testMetrics(); 