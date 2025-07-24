const fetch = require('node-fetch');

async function testFixes() {
    try {
        console.log('🔍 Testando correções aplicadas...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Verificando correções:');
        
        console.log('\n📊 Uptime do Container:');
        if (data.container?.uptime) {
            const hours = Math.floor(data.container.uptime / 3600);
            const minutes = Math.floor((data.container.uptime % 3600) / 60);
            console.log(`✅ Uptime: ${hours}h ${minutes}m (${data.container.uptime}s)`);
        } else {
            console.log('❌ Uptime ainda não está funcionando');
        }
        
        console.log('\n📊 Status Geral:');
        console.log(`- Status: ${data.summary?.status}`);
        console.log(`- Total Alerts: ${data.summary?.totalAlerts}`);
        console.log(`- Critical Alerts: ${data.summary?.criticalAlerts}`);
        console.log(`- Error Alerts: ${data.summary?.errorAlerts}`);
        console.log(`- Warning Alerts: ${data.summary?.warningAlerts}`);
        
        console.log('\n📊 Dados do Container:');
        console.log(`- Status: ${data.container?.status}`);
        console.log(`- CPU: ${data.container?.cpu}%`);
        console.log(`- Memory: ${data.container?.memory?.percentage}%`);
        
        console.log('\n📊 Dados do Redis:');
        console.log(`- Status: ${data.redis?.status}`);
        console.log(`- Operations: ${data.redis?.operations}`);
        console.log(`- Latency: ${data.redis?.latency}ms`);
        console.log(`- Connections: ${data.redis?.connections}`);
        
        console.log('\n📊 Alertas (últimos 5):');
        if (data.alerts && Array.isArray(data.alerts)) {
            data.alerts.slice(0, 5).forEach((alert, index) => {
                const timeAgo = Math.floor((Date.now() - alert.timestamp) / 1000);
                console.log(`  ${index + 1}. ${alert.type}: ${alert.message} (${timeAgo}s atrás)`);
            });
        } else {
            console.log('  Nenhum alerta encontrado');
        }
        
        console.log('\n3. Verificando se as correções funcionaram:');
        
        // Verificar se uptime está correto (> 0)
        if (data.container?.uptime > 0) {
            console.log('✅ Uptime corrigido');
        } else {
            console.log('❌ Uptime ainda com problema');
        }
        
        // Verificar se alertas diminuíram
        if (data.summary?.totalAlerts < 20) {
            console.log('✅ Alertas reduzidos');
        } else {
            console.log('❌ Alertas ainda altos');
        }
        
        // Verificar se latência do Redis não está gerando alertas desnecessários
        if (data.redis?.latency < 1000) {
            console.log('✅ Latência do Redis dentro do limite');
        } else {
            console.log('⚠️ Latência do Redis ainda alta');
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar correções:', error.message);
    }
}

testFixes(); 

async function testFixes() {
    try {
        console.log('🔍 Testando correções aplicadas...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Verificando correções:');
        
        console.log('\n📊 Uptime do Container:');
        if (data.container?.uptime) {
            const hours = Math.floor(data.container.uptime / 3600);
            const minutes = Math.floor((data.container.uptime % 3600) / 60);
            console.log(`✅ Uptime: ${hours}h ${minutes}m (${data.container.uptime}s)`);
        } else {
            console.log('❌ Uptime ainda não está funcionando');
        }
        
        console.log('\n📊 Status Geral:');
        console.log(`- Status: ${data.summary?.status}`);
        console.log(`- Total Alerts: ${data.summary?.totalAlerts}`);
        console.log(`- Critical Alerts: ${data.summary?.criticalAlerts}`);
        console.log(`- Error Alerts: ${data.summary?.errorAlerts}`);
        console.log(`- Warning Alerts: ${data.summary?.warningAlerts}`);
        
        console.log('\n📊 Dados do Container:');
        console.log(`- Status: ${data.container?.status}`);
        console.log(`- CPU: ${data.container?.cpu}%`);
        console.log(`- Memory: ${data.container?.memory?.percentage}%`);
        
        console.log('\n📊 Dados do Redis:');
        console.log(`- Status: ${data.redis?.status}`);
        console.log(`- Operations: ${data.redis?.operations}`);
        console.log(`- Latency: ${data.redis?.latency}ms`);
        console.log(`- Connections: ${data.redis?.connections}`);
        
        console.log('\n📊 Alertas (últimos 5):');
        if (data.alerts && Array.isArray(data.alerts)) {
            data.alerts.slice(0, 5).forEach((alert, index) => {
                const timeAgo = Math.floor((Date.now() - alert.timestamp) / 1000);
                console.log(`  ${index + 1}. ${alert.type}: ${alert.message} (${timeAgo}s atrás)`);
            });
        } else {
            console.log('  Nenhum alerta encontrado');
        }
        
        console.log('\n3. Verificando se as correções funcionaram:');
        
        // Verificar se uptime está correto (> 0)
        if (data.container?.uptime > 0) {
            console.log('✅ Uptime corrigido');
        } else {
            console.log('❌ Uptime ainda com problema');
        }
        
        // Verificar se alertas diminuíram
        if (data.summary?.totalAlerts < 20) {
            console.log('✅ Alertas reduzidos');
        } else {
            console.log('❌ Alertas ainda altos');
        }
        
        // Verificar se latência do Redis não está gerando alertas desnecessários
        if (data.redis?.latency < 1000) {
            console.log('✅ Latência do Redis dentro do limite');
        } else {
            console.log('⚠️ Latência do Redis ainda alta');
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar correções:', error.message);
    }
}

testFixes(); 

async function testFixes() {
    try {
        console.log('🔍 Testando correções aplicadas...\n');
        
        // Testar endpoint de métricas
        console.log('1. Fazendo requisição para /metrics...');
        const response = await fetch('http://localhost:3001/metrics');
        
        if (!response.ok) {
            console.error(`❌ Erro HTTP: ${response.status} ${response.statusText}`);
            return;
        }
        
        const data = await response.json();
        
        console.log('2. Verificando correções:');
        
        console.log('\n📊 Uptime do Container:');
        if (data.container?.uptime) {
            const hours = Math.floor(data.container.uptime / 3600);
            const minutes = Math.floor((data.container.uptime % 3600) / 60);
            console.log(`✅ Uptime: ${hours}h ${minutes}m (${data.container.uptime}s)`);
        } else {
            console.log('❌ Uptime ainda não está funcionando');
        }
        
        console.log('\n📊 Status Geral:');
        console.log(`- Status: ${data.summary?.status}`);
        console.log(`- Total Alerts: ${data.summary?.totalAlerts}`);
        console.log(`- Critical Alerts: ${data.summary?.criticalAlerts}`);
        console.log(`- Error Alerts: ${data.summary?.errorAlerts}`);
        console.log(`- Warning Alerts: ${data.summary?.warningAlerts}`);
        
        console.log('\n📊 Dados do Container:');
        console.log(`- Status: ${data.container?.status}`);
        console.log(`- CPU: ${data.container?.cpu}%`);
        console.log(`- Memory: ${data.container?.memory?.percentage}%`);
        
        console.log('\n📊 Dados do Redis:');
        console.log(`- Status: ${data.redis?.status}`);
        console.log(`- Operations: ${data.redis?.operations}`);
        console.log(`- Latency: ${data.redis?.latency}ms`);
        console.log(`- Connections: ${data.redis?.connections}`);
        
        console.log('\n📊 Alertas (últimos 5):');
        if (data.alerts && Array.isArray(data.alerts)) {
            data.alerts.slice(0, 5).forEach((alert, index) => {
                const timeAgo = Math.floor((Date.now() - alert.timestamp) / 1000);
                console.log(`  ${index + 1}. ${alert.type}: ${alert.message} (${timeAgo}s atrás)`);
            });
        } else {
            console.log('  Nenhum alerta encontrado');
        }
        
        console.log('\n3. Verificando se as correções funcionaram:');
        
        // Verificar se uptime está correto (> 0)
        if (data.container?.uptime > 0) {
            console.log('✅ Uptime corrigido');
        } else {
            console.log('❌ Uptime ainda com problema');
        }
        
        // Verificar se alertas diminuíram
        if (data.summary?.totalAlerts < 20) {
            console.log('✅ Alertas reduzidos');
        } else {
            console.log('❌ Alertas ainda altos');
        }
        
        // Verificar se latência do Redis não está gerando alertas desnecessários
        if (data.redis?.latency < 1000) {
            console.log('✅ Latência do Redis dentro do limite');
        } else {
            console.log('⚠️ Latência do Redis ainda alta');
        }
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar correções:', error.message);
    }
}

testFixes(); 