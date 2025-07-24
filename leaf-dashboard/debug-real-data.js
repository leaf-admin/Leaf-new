const fetch = require('node-fetch');

async function debugRealData() {
    try {
        console.log('🔍 Debugando dados reais do Docker e Redis...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Verificando dados do Docker:');
        if (data.resources?.container) {
            console.log('✅ Container encontrado:');
            console.log('  - Status:', data.resources.container.status);
            console.log('  - CPU:', data.resources.container.cpu);
            console.log('  - Memory:', data.resources.container.memory);
            console.log('  - Uptime:', data.resources.container.uptime);
        } else {
            console.log('❌ Container não encontrado');
        }
        
        console.log('\n3. Verificando dados do Redis:');
        if (data.resources?.redis) {
            console.log('✅ Redis encontrado:');
            console.log('  - Status:', data.resources.redis.status);
            console.log('  - Connections:', data.resources.redis.connections);
            console.log('  - Operations:', data.resources.redis.operations);
            console.log('  - Latency:', data.resources.redis.latency);
            console.log('  - Errors:', data.resources.redis.errors);
        } else {
            console.log('❌ Redis não encontrado');
        }
        
        console.log('\n4. Verificando dados do Sistema:');
        if (data.resources?.system) {
            console.log('✅ Sistema encontrado:');
            console.log('  - Total Containers:', data.resources.system.totalContainers);
            console.log('  - Running Containers:', data.resources.system.runningContainers);
            console.log('  - Total Images:', data.resources.system.totalImages);
        } else {
            console.log('❌ Sistema não encontrado');
        }
        
        console.log('\n5. Verificando dados do Host:');
        if (data.resources?.host) {
            console.log('✅ Host encontrado:');
            console.log('  - CPU:', data.resources.host.cpu);
            console.log('  - Memory:', data.resources.host.memory);
            console.log('  - Uptime:', data.resources.host.uptime);
        } else {
            console.log('❌ Host não encontrado');
        }
        
        console.log('\n6. Verificando Summary:');
        if (data.summary) {
            console.log('✅ Summary encontrado:');
            console.log('  - Status:', data.summary.status);
            console.log('  - Total Alerts:', data.summary.totalAlerts);
            console.log('  - Uptime:', data.summary.uptime);
            console.log('  - Active Connections:', data.summary.activeConnections);
        } else {
            console.log('❌ Summary não encontrado');
        }
        
        console.log('\n7. Verificando se há alertas:');
        if (data.alerts && Array.isArray(data.alerts)) {
            console.log(`✅ ${data.alerts.length} alertas encontrados`);
            data.alerts.slice(0, 3).forEach((alert, index) => {
                console.log(`  ${index + 1}. ${alert.type}: ${alert.message}`);
            });
        } else {
            console.log('❌ Alertas não encontrados');
        }
        
        console.log('\n🎯 Debug concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao debugar dados:', error.message);
    }
}

debugRealData(); 

async function debugRealData() {
    try {
        console.log('🔍 Debugando dados reais do Docker e Redis...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Verificando dados do Docker:');
        if (data.resources?.container) {
            console.log('✅ Container encontrado:');
            console.log('  - Status:', data.resources.container.status);
            console.log('  - CPU:', data.resources.container.cpu);
            console.log('  - Memory:', data.resources.container.memory);
            console.log('  - Uptime:', data.resources.container.uptime);
        } else {
            console.log('❌ Container não encontrado');
        }
        
        console.log('\n3. Verificando dados do Redis:');
        if (data.resources?.redis) {
            console.log('✅ Redis encontrado:');
            console.log('  - Status:', data.resources.redis.status);
            console.log('  - Connections:', data.resources.redis.connections);
            console.log('  - Operations:', data.resources.redis.operations);
            console.log('  - Latency:', data.resources.redis.latency);
            console.log('  - Errors:', data.resources.redis.errors);
        } else {
            console.log('❌ Redis não encontrado');
        }
        
        console.log('\n4. Verificando dados do Sistema:');
        if (data.resources?.system) {
            console.log('✅ Sistema encontrado:');
            console.log('  - Total Containers:', data.resources.system.totalContainers);
            console.log('  - Running Containers:', data.resources.system.runningContainers);
            console.log('  - Total Images:', data.resources.system.totalImages);
        } else {
            console.log('❌ Sistema não encontrado');
        }
        
        console.log('\n5. Verificando dados do Host:');
        if (data.resources?.host) {
            console.log('✅ Host encontrado:');
            console.log('  - CPU:', data.resources.host.cpu);
            console.log('  - Memory:', data.resources.host.memory);
            console.log('  - Uptime:', data.resources.host.uptime);
        } else {
            console.log('❌ Host não encontrado');
        }
        
        console.log('\n6. Verificando Summary:');
        if (data.summary) {
            console.log('✅ Summary encontrado:');
            console.log('  - Status:', data.summary.status);
            console.log('  - Total Alerts:', data.summary.totalAlerts);
            console.log('  - Uptime:', data.summary.uptime);
            console.log('  - Active Connections:', data.summary.activeConnections);
        } else {
            console.log('❌ Summary não encontrado');
        }
        
        console.log('\n7. Verificando se há alertas:');
        if (data.alerts && Array.isArray(data.alerts)) {
            console.log(`✅ ${data.alerts.length} alertas encontrados`);
            data.alerts.slice(0, 3).forEach((alert, index) => {
                console.log(`  ${index + 1}. ${alert.type}: ${alert.message}`);
            });
        } else {
            console.log('❌ Alertas não encontrados');
        }
        
        console.log('\n🎯 Debug concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao debugar dados:', error.message);
    }
}

debugRealData(); 

async function debugRealData() {
    try {
        console.log('🔍 Debugando dados reais do Docker e Redis...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Verificando dados do Docker:');
        if (data.resources?.container) {
            console.log('✅ Container encontrado:');
            console.log('  - Status:', data.resources.container.status);
            console.log('  - CPU:', data.resources.container.cpu);
            console.log('  - Memory:', data.resources.container.memory);
            console.log('  - Uptime:', data.resources.container.uptime);
        } else {
            console.log('❌ Container não encontrado');
        }
        
        console.log('\n3. Verificando dados do Redis:');
        if (data.resources?.redis) {
            console.log('✅ Redis encontrado:');
            console.log('  - Status:', data.resources.redis.status);
            console.log('  - Connections:', data.resources.redis.connections);
            console.log('  - Operations:', data.resources.redis.operations);
            console.log('  - Latency:', data.resources.redis.latency);
            console.log('  - Errors:', data.resources.redis.errors);
        } else {
            console.log('❌ Redis não encontrado');
        }
        
        console.log('\n4. Verificando dados do Sistema:');
        if (data.resources?.system) {
            console.log('✅ Sistema encontrado:');
            console.log('  - Total Containers:', data.resources.system.totalContainers);
            console.log('  - Running Containers:', data.resources.system.runningContainers);
            console.log('  - Total Images:', data.resources.system.totalImages);
        } else {
            console.log('❌ Sistema não encontrado');
        }
        
        console.log('\n5. Verificando dados do Host:');
        if (data.resources?.host) {
            console.log('✅ Host encontrado:');
            console.log('  - CPU:', data.resources.host.cpu);
            console.log('  - Memory:', data.resources.host.memory);
            console.log('  - Uptime:', data.resources.host.uptime);
        } else {
            console.log('❌ Host não encontrado');
        }
        
        console.log('\n6. Verificando Summary:');
        if (data.summary) {
            console.log('✅ Summary encontrado:');
            console.log('  - Status:', data.summary.status);
            console.log('  - Total Alerts:', data.summary.totalAlerts);
            console.log('  - Uptime:', data.summary.uptime);
            console.log('  - Active Connections:', data.summary.activeConnections);
        } else {
            console.log('❌ Summary não encontrado');
        }
        
        console.log('\n7. Verificando se há alertas:');
        if (data.alerts && Array.isArray(data.alerts)) {
            console.log(`✅ ${data.alerts.length} alertas encontrados`);
            data.alerts.slice(0, 3).forEach((alert, index) => {
                console.log(`  ${index + 1}. ${alert.type}: ${alert.message}`);
            });
        } else {
            console.log('❌ Alertas não encontrados');
        }
        
        console.log('\n🎯 Debug concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao debugar dados:', error.message);
    }
}

debugRealData(); 