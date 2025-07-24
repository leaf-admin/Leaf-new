const fetch = require('node-fetch');

async function debugMetrics() {
    try {
        console.log('🔍 Debugando dados das métricas...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        console.log('✅ Dados recebidos:');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n2. Verificando estrutura dos dados:');
        console.log('- timestamp:', typeof data.timestamp, data.timestamp);
        console.log('- container:', typeof data.container, data.container ? 'presente' : 'ausente');
        console.log('- redis:', typeof data.redis, data.redis ? 'presente' : 'ausente');
        console.log('- system:', typeof data.system, data.system ? 'presente' : 'ausente');
        console.log('- host:', typeof data.host, data.host ? 'presente' : 'ausente');
        console.log('- alerts:', Array.isArray(data.alerts), data.alerts ? data.alerts.length : 'N/A');
        console.log('- summary:', typeof data.summary, data.summary ? 'presente' : 'ausente');
        
        if (data.redis) {
            console.log('\n3. Dados do Redis:');
            console.log('- status:', data.redis.status);
            console.log('- connections:', data.redis.connections);
            console.log('- operations:', data.redis.operations);
            console.log('- latency:', data.redis.latency);
            console.log('- errors:', data.redis.errors);
        }
        
        if (data.container) {
            console.log('\n4. Dados do Container:');
            console.log('- status:', data.container.status);
            console.log('- cpu:', data.container.cpu);
            console.log('- memory:', data.container.memory);
        }
        
        if (data.summary) {
            console.log('\n5. Dados do Summary:');
            console.log('- status:', data.summary.status);
            console.log('- totalAlerts:', data.summary.totalAlerts);
            console.log('- uptime:', data.summary.uptime);
        }
        
        console.log('\n🎯 Debug concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao debugar métricas:', error.message);
    }
}

debugMetrics(); 

async function debugMetrics() {
    try {
        console.log('🔍 Debugando dados das métricas...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        console.log('✅ Dados recebidos:');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n2. Verificando estrutura dos dados:');
        console.log('- timestamp:', typeof data.timestamp, data.timestamp);
        console.log('- container:', typeof data.container, data.container ? 'presente' : 'ausente');
        console.log('- redis:', typeof data.redis, data.redis ? 'presente' : 'ausente');
        console.log('- system:', typeof data.system, data.system ? 'presente' : 'ausente');
        console.log('- host:', typeof data.host, data.host ? 'presente' : 'ausente');
        console.log('- alerts:', Array.isArray(data.alerts), data.alerts ? data.alerts.length : 'N/A');
        console.log('- summary:', typeof data.summary, data.summary ? 'presente' : 'ausente');
        
        if (data.redis) {
            console.log('\n3. Dados do Redis:');
            console.log('- status:', data.redis.status);
            console.log('- connections:', data.redis.connections);
            console.log('- operations:', data.redis.operations);
            console.log('- latency:', data.redis.latency);
            console.log('- errors:', data.redis.errors);
        }
        
        if (data.container) {
            console.log('\n4. Dados do Container:');
            console.log('- status:', data.container.status);
            console.log('- cpu:', data.container.cpu);
            console.log('- memory:', data.container.memory);
        }
        
        if (data.summary) {
            console.log('\n5. Dados do Summary:');
            console.log('- status:', data.summary.status);
            console.log('- totalAlerts:', data.summary.totalAlerts);
            console.log('- uptime:', data.summary.uptime);
        }
        
        console.log('\n🎯 Debug concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao debugar métricas:', error.message);
    }
}

debugMetrics(); 

async function debugMetrics() {
    try {
        console.log('🔍 Debugando dados das métricas...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        console.log('✅ Dados recebidos:');
        console.log(JSON.stringify(data, null, 2));
        
        console.log('\n2. Verificando estrutura dos dados:');
        console.log('- timestamp:', typeof data.timestamp, data.timestamp);
        console.log('- container:', typeof data.container, data.container ? 'presente' : 'ausente');
        console.log('- redis:', typeof data.redis, data.redis ? 'presente' : 'ausente');
        console.log('- system:', typeof data.system, data.system ? 'presente' : 'ausente');
        console.log('- host:', typeof data.host, data.host ? 'presente' : 'ausente');
        console.log('- alerts:', Array.isArray(data.alerts), data.alerts ? data.alerts.length : 'N/A');
        console.log('- summary:', typeof data.summary, data.summary ? 'presente' : 'ausente');
        
        if (data.redis) {
            console.log('\n3. Dados do Redis:');
            console.log('- status:', data.redis.status);
            console.log('- connections:', data.redis.connections);
            console.log('- operations:', data.redis.operations);
            console.log('- latency:', data.redis.latency);
            console.log('- errors:', data.redis.errors);
        }
        
        if (data.container) {
            console.log('\n4. Dados do Container:');
            console.log('- status:', data.container.status);
            console.log('- cpu:', data.container.cpu);
            console.log('- memory:', data.container.memory);
        }
        
        if (data.summary) {
            console.log('\n5. Dados do Summary:');
            console.log('- status:', data.summary.status);
            console.log('- totalAlerts:', data.summary.totalAlerts);
            console.log('- uptime:', data.summary.uptime);
        }
        
        console.log('\n🎯 Debug concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao debugar métricas:', error.message);
    }
}

debugMetrics(); 