const fetch = require('node-fetch');

async function testMetricsEndpoint() {
    try {
        console.log('🔍 Testando endpoint /metrics diretamente...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Estrutura completa dos dados:');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n3. Verificando campos específicos:');
        console.log('- container direto:', data.container ? 'PRESENTE' : 'AUSENTE');
        console.log('- redis direto:', data.redis ? 'PRESENTE' : 'AUSENTE');
        console.log('- system direto:', data.system ? 'PRESENTE' : 'AUSENTE');
        console.log('- host direto:', data.host ? 'PRESENTE' : 'AUSENTE');
        console.log('- resources:', data.resources ? 'PRESENTE' : 'AUSENTE');
        console.log('- summary:', data.summary ? 'PRESENTE' : 'AUSENTE');
        
        if (data.resources) {
            console.log('\n4. Dados em resources:');
            console.log('- resources.container:', data.resources.container ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.redis:', data.resources.redis ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.system:', data.resources.system ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.host:', data.resources.host ? 'PRESENTE' : 'AUSENTE');
            
            if (data.resources.container) {
                console.log('\n5. Dados do Container:');
                console.log('- Status:', data.resources.container.status);
                console.log('- CPU:', data.resources.container.cpu);
                console.log('- Memory:', data.resources.container.memory);
                console.log('- Uptime:', data.resources.container.uptime);
            }
            
            if (data.resources.redis) {
                console.log('\n6. Dados do Redis:');
                console.log('- Status:', data.resources.redis.status);
                console.log('- Connections:', data.resources.redis.connections);
                console.log('- Operations:', data.resources.redis.operations);
                console.log('- Latency:', data.resources.redis.latency);
                console.log('- Errors:', data.resources.redis.errors);
            }
        }
        
        console.log('\n7. Verificando Summary:');
        if (data.summary) {
            console.log('- Status:', data.summary.status);
            console.log('- Total Alerts:', data.summary.totalAlerts);
            console.log('- Uptime:', data.summary.uptime);
            console.log('- Active Connections:', data.summary.activeConnections);
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar endpoint:', error.message);
    }
}

testMetricsEndpoint(); 

async function testMetricsEndpoint() {
    try {
        console.log('🔍 Testando endpoint /metrics diretamente...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Estrutura completa dos dados:');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n3. Verificando campos específicos:');
        console.log('- container direto:', data.container ? 'PRESENTE' : 'AUSENTE');
        console.log('- redis direto:', data.redis ? 'PRESENTE' : 'AUSENTE');
        console.log('- system direto:', data.system ? 'PRESENTE' : 'AUSENTE');
        console.log('- host direto:', data.host ? 'PRESENTE' : 'AUSENTE');
        console.log('- resources:', data.resources ? 'PRESENTE' : 'AUSENTE');
        console.log('- summary:', data.summary ? 'PRESENTE' : 'AUSENTE');
        
        if (data.resources) {
            console.log('\n4. Dados em resources:');
            console.log('- resources.container:', data.resources.container ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.redis:', data.resources.redis ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.system:', data.resources.system ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.host:', data.resources.host ? 'PRESENTE' : 'AUSENTE');
            
            if (data.resources.container) {
                console.log('\n5. Dados do Container:');
                console.log('- Status:', data.resources.container.status);
                console.log('- CPU:', data.resources.container.cpu);
                console.log('- Memory:', data.resources.container.memory);
                console.log('- Uptime:', data.resources.container.uptime);
            }
            
            if (data.resources.redis) {
                console.log('\n6. Dados do Redis:');
                console.log('- Status:', data.resources.redis.status);
                console.log('- Connections:', data.resources.redis.connections);
                console.log('- Operations:', data.resources.redis.operations);
                console.log('- Latency:', data.resources.redis.latency);
                console.log('- Errors:', data.resources.redis.errors);
            }
        }
        
        console.log('\n7. Verificando Summary:');
        if (data.summary) {
            console.log('- Status:', data.summary.status);
            console.log('- Total Alerts:', data.summary.totalAlerts);
            console.log('- Uptime:', data.summary.uptime);
            console.log('- Active Connections:', data.summary.activeConnections);
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar endpoint:', error.message);
    }
}

testMetricsEndpoint(); 

async function testMetricsEndpoint() {
    try {
        console.log('🔍 Testando endpoint /metrics diretamente...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Estrutura completa dos dados:');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n3. Verificando campos específicos:');
        console.log('- container direto:', data.container ? 'PRESENTE' : 'AUSENTE');
        console.log('- redis direto:', data.redis ? 'PRESENTE' : 'AUSENTE');
        console.log('- system direto:', data.system ? 'PRESENTE' : 'AUSENTE');
        console.log('- host direto:', data.host ? 'PRESENTE' : 'AUSENTE');
        console.log('- resources:', data.resources ? 'PRESENTE' : 'AUSENTE');
        console.log('- summary:', data.summary ? 'PRESENTE' : 'AUSENTE');
        
        if (data.resources) {
            console.log('\n4. Dados em resources:');
            console.log('- resources.container:', data.resources.container ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.redis:', data.resources.redis ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.system:', data.resources.system ? 'PRESENTE' : 'AUSENTE');
            console.log('- resources.host:', data.resources.host ? 'PRESENTE' : 'AUSENTE');
            
            if (data.resources.container) {
                console.log('\n5. Dados do Container:');
                console.log('- Status:', data.resources.container.status);
                console.log('- CPU:', data.resources.container.cpu);
                console.log('- Memory:', data.resources.container.memory);
                console.log('- Uptime:', data.resources.container.uptime);
            }
            
            if (data.resources.redis) {
                console.log('\n6. Dados do Redis:');
                console.log('- Status:', data.resources.redis.status);
                console.log('- Connections:', data.resources.redis.connections);
                console.log('- Operations:', data.resources.redis.operations);
                console.log('- Latency:', data.resources.redis.latency);
                console.log('- Errors:', data.resources.redis.errors);
            }
        }
        
        console.log('\n7. Verificando Summary:');
        if (data.summary) {
            console.log('- Status:', data.summary.status);
            console.log('- Total Alerts:', data.summary.totalAlerts);
            console.log('- Uptime:', data.summary.uptime);
            console.log('- Active Connections:', data.summary.activeConnections);
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar endpoint:', error.message);
    }
}

testMetricsEndpoint(); 