const fetch = require('node-fetch');

async function testDashboardFix() {
    try {
        console.log('🔍 Testando correção do dashboard...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Verificando dados que o dashboard deve mostrar:');
        
        console.log('\n📊 Dados do Container:');
        if (data.container) {
            console.log('✅ Container encontrado:');
            console.log('  - Status:', data.container.status);
            console.log('  - CPU:', data.container.cpu);
            console.log('  - Memory:', data.container.memory);
            console.log('  - Uptime:', data.container.uptime);
        } else {
            console.log('❌ Container não encontrado');
        }
        
        console.log('\n📊 Dados do Redis:');
        if (data.redis) {
            console.log('✅ Redis encontrado:');
            console.log('  - Status:', data.redis.status);
            console.log('  - Connections:', data.redis.connections);
            console.log('  - Operations:', data.redis.operations);
            console.log('  - Latency:', data.redis.latency);
            console.log('  - Errors:', data.redis.errors);
        } else {
            console.log('❌ Redis não encontrado');
        }
        
        console.log('\n📊 Dados do Sistema:');
        if (data.system) {
            console.log('✅ Sistema encontrado:');
            console.log('  - Total Containers:', data.system.totalContainers);
            console.log('  - Running Containers:', data.system.runningContainers);
            console.log('  - Total Images:', data.system.totalImages);
        } else {
            console.log('❌ Sistema não encontrado');
        }
        
        console.log('\n📊 Dados do Host:');
        if (data.host) {
            console.log('✅ Host encontrado:');
            console.log('  - CPU:', data.host.cpu);
            console.log('  - Memory:', data.host.memory);
            console.log('  - Uptime:', data.host.uptime);
        } else {
            console.log('❌ Host não encontrado');
        }
        
        console.log('\n📊 Summary:');
        if (data.summary) {
            console.log('✅ Summary encontrado:');
            console.log('  - Status:', data.summary.status);
            console.log('  - Total Alerts:', data.summary.totalAlerts);
            console.log('  - Uptime:', data.summary.uptime);
            console.log('  - Active Connections:', data.summary.activeConnections);
        } else {
            console.log('❌ Summary não encontrado');
        }
        
        console.log('\n3. Verificando se há alertas:');
        if (data.alerts && Array.isArray(data.alerts)) {
            console.log(`✅ ${data.alerts.length} alertas encontrados`);
            data.alerts.slice(0, 3).forEach((alert, index) => {
                console.log(`  ${index + 1}. ${alert.type}: ${alert.message}`);
            });
        } else {
            console.log('❌ Alertas não encontrados');
        }
        
        console.log('\n🎯 Dashboard deve mostrar:');
        console.log('- Status Geral:', data.summary?.status || 'unknown');
        console.log('- Alertas Ativos:', data.summary?.totalAlerts || 0);
        console.log('- Uptime:', data.summary?.uptime || 0);
        console.log('- Operações Redis:', data.redis?.operations || 0);
        console.log('- Latência Redis:', data.redis?.latency || 0, 'ms');
        console.log('- Conexões Redis:', data.redis?.connections || 0);
        console.log('- Status Container:', data.container?.status || 'unknown');
        console.log('- CPU Container:', data.container?.cpu || 0, '%');
        console.log('- Memory Container:', data.container?.memory?.percentage || 0, '%');
        
        console.log('\n✅ Teste concluído! O dashboard deve estar funcionando corretamente agora.');
        
    } catch (error) {
        console.error('❌ Erro ao testar dashboard:', error.message);
    }
}

testDashboardFix(); 

async function testDashboardFix() {
    try {
        console.log('🔍 Testando correção do dashboard...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Verificando dados que o dashboard deve mostrar:');
        
        console.log('\n📊 Dados do Container:');
        if (data.container) {
            console.log('✅ Container encontrado:');
            console.log('  - Status:', data.container.status);
            console.log('  - CPU:', data.container.cpu);
            console.log('  - Memory:', data.container.memory);
            console.log('  - Uptime:', data.container.uptime);
        } else {
            console.log('❌ Container não encontrado');
        }
        
        console.log('\n📊 Dados do Redis:');
        if (data.redis) {
            console.log('✅ Redis encontrado:');
            console.log('  - Status:', data.redis.status);
            console.log('  - Connections:', data.redis.connections);
            console.log('  - Operations:', data.redis.operations);
            console.log('  - Latency:', data.redis.latency);
            console.log('  - Errors:', data.redis.errors);
        } else {
            console.log('❌ Redis não encontrado');
        }
        
        console.log('\n📊 Dados do Sistema:');
        if (data.system) {
            console.log('✅ Sistema encontrado:');
            console.log('  - Total Containers:', data.system.totalContainers);
            console.log('  - Running Containers:', data.system.runningContainers);
            console.log('  - Total Images:', data.system.totalImages);
        } else {
            console.log('❌ Sistema não encontrado');
        }
        
        console.log('\n📊 Dados do Host:');
        if (data.host) {
            console.log('✅ Host encontrado:');
            console.log('  - CPU:', data.host.cpu);
            console.log('  - Memory:', data.host.memory);
            console.log('  - Uptime:', data.host.uptime);
        } else {
            console.log('❌ Host não encontrado');
        }
        
        console.log('\n📊 Summary:');
        if (data.summary) {
            console.log('✅ Summary encontrado:');
            console.log('  - Status:', data.summary.status);
            console.log('  - Total Alerts:', data.summary.totalAlerts);
            console.log('  - Uptime:', data.summary.uptime);
            console.log('  - Active Connections:', data.summary.activeConnections);
        } else {
            console.log('❌ Summary não encontrado');
        }
        
        console.log('\n3. Verificando se há alertas:');
        if (data.alerts && Array.isArray(data.alerts)) {
            console.log(`✅ ${data.alerts.length} alertas encontrados`);
            data.alerts.slice(0, 3).forEach((alert, index) => {
                console.log(`  ${index + 1}. ${alert.type}: ${alert.message}`);
            });
        } else {
            console.log('❌ Alertas não encontrados');
        }
        
        console.log('\n🎯 Dashboard deve mostrar:');
        console.log('- Status Geral:', data.summary?.status || 'unknown');
        console.log('- Alertas Ativos:', data.summary?.totalAlerts || 0);
        console.log('- Uptime:', data.summary?.uptime || 0);
        console.log('- Operações Redis:', data.redis?.operations || 0);
        console.log('- Latência Redis:', data.redis?.latency || 0, 'ms');
        console.log('- Conexões Redis:', data.redis?.connections || 0);
        console.log('- Status Container:', data.container?.status || 'unknown');
        console.log('- CPU Container:', data.container?.cpu || 0, '%');
        console.log('- Memory Container:', data.container?.memory?.percentage || 0, '%');
        
        console.log('\n✅ Teste concluído! O dashboard deve estar funcionando corretamente agora.');
        
    } catch (error) {
        console.error('❌ Erro ao testar dashboard:', error.message);
    }
}

testDashboardFix(); 

async function testDashboardFix() {
    try {
        console.log('🔍 Testando correção do dashboard...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Verificando dados que o dashboard deve mostrar:');
        
        console.log('\n📊 Dados do Container:');
        if (data.container) {
            console.log('✅ Container encontrado:');
            console.log('  - Status:', data.container.status);
            console.log('  - CPU:', data.container.cpu);
            console.log('  - Memory:', data.container.memory);
            console.log('  - Uptime:', data.container.uptime);
        } else {
            console.log('❌ Container não encontrado');
        }
        
        console.log('\n📊 Dados do Redis:');
        if (data.redis) {
            console.log('✅ Redis encontrado:');
            console.log('  - Status:', data.redis.status);
            console.log('  - Connections:', data.redis.connections);
            console.log('  - Operations:', data.redis.operations);
            console.log('  - Latency:', data.redis.latency);
            console.log('  - Errors:', data.redis.errors);
        } else {
            console.log('❌ Redis não encontrado');
        }
        
        console.log('\n📊 Dados do Sistema:');
        if (data.system) {
            console.log('✅ Sistema encontrado:');
            console.log('  - Total Containers:', data.system.totalContainers);
            console.log('  - Running Containers:', data.system.runningContainers);
            console.log('  - Total Images:', data.system.totalImages);
        } else {
            console.log('❌ Sistema não encontrado');
        }
        
        console.log('\n📊 Dados do Host:');
        if (data.host) {
            console.log('✅ Host encontrado:');
            console.log('  - CPU:', data.host.cpu);
            console.log('  - Memory:', data.host.memory);
            console.log('  - Uptime:', data.host.uptime);
        } else {
            console.log('❌ Host não encontrado');
        }
        
        console.log('\n📊 Summary:');
        if (data.summary) {
            console.log('✅ Summary encontrado:');
            console.log('  - Status:', data.summary.status);
            console.log('  - Total Alerts:', data.summary.totalAlerts);
            console.log('  - Uptime:', data.summary.uptime);
            console.log('  - Active Connections:', data.summary.activeConnections);
        } else {
            console.log('❌ Summary não encontrado');
        }
        
        console.log('\n3. Verificando se há alertas:');
        if (data.alerts && Array.isArray(data.alerts)) {
            console.log(`✅ ${data.alerts.length} alertas encontrados`);
            data.alerts.slice(0, 3).forEach((alert, index) => {
                console.log(`  ${index + 1}. ${alert.type}: ${alert.message}`);
            });
        } else {
            console.log('❌ Alertas não encontrados');
        }
        
        console.log('\n🎯 Dashboard deve mostrar:');
        console.log('- Status Geral:', data.summary?.status || 'unknown');
        console.log('- Alertas Ativos:', data.summary?.totalAlerts || 0);
        console.log('- Uptime:', data.summary?.uptime || 0);
        console.log('- Operações Redis:', data.redis?.operations || 0);
        console.log('- Latência Redis:', data.redis?.latency || 0, 'ms');
        console.log('- Conexões Redis:', data.redis?.connections || 0);
        console.log('- Status Container:', data.container?.status || 'unknown');
        console.log('- CPU Container:', data.container?.cpu || 0, '%');
        console.log('- Memory Container:', data.container?.memory?.percentage || 0, '%');
        
        console.log('\n✅ Teste concluído! O dashboard deve estar funcionando corretamente agora.');
        
    } catch (error) {
        console.error('❌ Erro ao testar dashboard:', error.message);
    }
}

testDashboardFix(); 