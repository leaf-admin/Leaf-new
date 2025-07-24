const fetch = require('node-fetch');

async function testBackendData() {
    try {
        console.log('🔍 Testando dados específicos do backend...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Verificando dados específicos:');
        console.log('- Container:', data.container ? 'PRESENTE' : 'AUSENTE');
        if (data.container) {
            console.log('  - Status:', data.container.status);
            console.log('  - CPU:', data.container.cpu);
            console.log('  - Memory:', data.container.memory);
        }
        
        console.log('- Redis:', data.redis ? 'PRESENTE' : 'AUSENTE');
        if (data.redis) {
            console.log('  - Status:', data.redis.status);
            console.log('  - Connections:', data.redis.connections);
            console.log('  - Operations:', data.redis.operations);
            console.log('  - Latency:', data.redis.latency);
        }
        
        console.log('- System:', data.system ? 'PRESENTE' : 'AUSENTE');
        if (data.system) {
            console.log('  - Total Containers:', data.system.totalContainers);
            console.log('  - Running Containers:', data.system.runningContainers);
        }
        
        console.log('- Host:', data.host ? 'PRESENTE' : 'AUSENTE');
        if (data.host) {
            console.log('  - CPU:', data.host.cpu);
            console.log('  - Memory:', data.host.memory);
        }
        
        console.log('- Summary:', data.summary ? 'PRESENTE' : 'AUSENTE');
        if (data.summary) {
            console.log('  - Status:', data.summary.status);
            console.log('  - Total Alerts:', data.summary.totalAlerts);
            console.log('  - Uptime:', data.summary.uptime);
        }
        
        console.log('- Alerts:', Array.isArray(data.alerts) ? `${data.alerts.length} alertas` : 'AUSENTE');
        
        console.log('\n3. Verificando se há dados aninhados...');
        if (data.resources) {
            console.log('- Resources container:', data.resources.container ? 'PRESENTE' : 'AUSENTE');
            console.log('- Resources redis:', data.resources.redis ? 'PRESENTE' : 'AUSENTE');
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar dados:', error.message);
    }
}

testBackendData(); 

async function testBackendData() {
    try {
        console.log('🔍 Testando dados específicos do backend...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Verificando dados específicos:');
        console.log('- Container:', data.container ? 'PRESENTE' : 'AUSENTE');
        if (data.container) {
            console.log('  - Status:', data.container.status);
            console.log('  - CPU:', data.container.cpu);
            console.log('  - Memory:', data.container.memory);
        }
        
        console.log('- Redis:', data.redis ? 'PRESENTE' : 'AUSENTE');
        if (data.redis) {
            console.log('  - Status:', data.redis.status);
            console.log('  - Connections:', data.redis.connections);
            console.log('  - Operations:', data.redis.operations);
            console.log('  - Latency:', data.redis.latency);
        }
        
        console.log('- System:', data.system ? 'PRESENTE' : 'AUSENTE');
        if (data.system) {
            console.log('  - Total Containers:', data.system.totalContainers);
            console.log('  - Running Containers:', data.system.runningContainers);
        }
        
        console.log('- Host:', data.host ? 'PRESENTE' : 'AUSENTE');
        if (data.host) {
            console.log('  - CPU:', data.host.cpu);
            console.log('  - Memory:', data.host.memory);
        }
        
        console.log('- Summary:', data.summary ? 'PRESENTE' : 'AUSENTE');
        if (data.summary) {
            console.log('  - Status:', data.summary.status);
            console.log('  - Total Alerts:', data.summary.totalAlerts);
            console.log('  - Uptime:', data.summary.uptime);
        }
        
        console.log('- Alerts:', Array.isArray(data.alerts) ? `${data.alerts.length} alertas` : 'AUSENTE');
        
        console.log('\n3. Verificando se há dados aninhados...');
        if (data.resources) {
            console.log('- Resources container:', data.resources.container ? 'PRESENTE' : 'AUSENTE');
            console.log('- Resources redis:', data.resources.redis ? 'PRESENTE' : 'AUSENTE');
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar dados:', error.message);
    }
}

testBackendData(); 

async function testBackendData() {
    try {
        console.log('🔍 Testando dados específicos do backend...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Verificando dados específicos:');
        console.log('- Container:', data.container ? 'PRESENTE' : 'AUSENTE');
        if (data.container) {
            console.log('  - Status:', data.container.status);
            console.log('  - CPU:', data.container.cpu);
            console.log('  - Memory:', data.container.memory);
        }
        
        console.log('- Redis:', data.redis ? 'PRESENTE' : 'AUSENTE');
        if (data.redis) {
            console.log('  - Status:', data.redis.status);
            console.log('  - Connections:', data.redis.connections);
            console.log('  - Operations:', data.redis.operations);
            console.log('  - Latency:', data.redis.latency);
        }
        
        console.log('- System:', data.system ? 'PRESENTE' : 'AUSENTE');
        if (data.system) {
            console.log('  - Total Containers:', data.system.totalContainers);
            console.log('  - Running Containers:', data.system.runningContainers);
        }
        
        console.log('- Host:', data.host ? 'PRESENTE' : 'AUSENTE');
        if (data.host) {
            console.log('  - CPU:', data.host.cpu);
            console.log('  - Memory:', data.host.memory);
        }
        
        console.log('- Summary:', data.summary ? 'PRESENTE' : 'AUSENTE');
        if (data.summary) {
            console.log('  - Status:', data.summary.status);
            console.log('  - Total Alerts:', data.summary.totalAlerts);
            console.log('  - Uptime:', data.summary.uptime);
        }
        
        console.log('- Alerts:', Array.isArray(data.alerts) ? `${data.alerts.length} alertas` : 'AUSENTE');
        
        console.log('\n3. Verificando se há dados aninhados...');
        if (data.resources) {
            console.log('- Resources container:', data.resources.container ? 'PRESENTE' : 'AUSENTE');
            console.log('- Resources redis:', data.resources.redis ? 'PRESENTE' : 'AUSENTE');
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar dados:', error.message);
    }
}

testBackendData(); 