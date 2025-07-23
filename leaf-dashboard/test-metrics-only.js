const DockerMonitor = require('../leaf-websocket-backend/monitoring/docker-monitor');

async function testMetricsOnly() {
    try {
        console.log('🔍 Testando métricas do Docker/Redis...\n');
        
        // Criar instância do DockerMonitor
        const dockerMonitor = new DockerMonitor();
        
        console.log('1. Executando verificações...');
        await dockerMonitor.performChecks();
        
        console.log('2. Obtendo relatório completo...');
        const report = dockerMonitor.getFullReport();
        
        console.log('\n📊 RESULTADOS:');
        console.log('==============');
        
        console.log('\n🐳 Container:');
        console.log(`- Status: ${report.container?.status || 'N/A'}`);
        console.log(`- CPU: ${report.container?.cpu || 0}%`);
        console.log(`- Memory: ${report.container?.memory?.percentage || 0}%`);
        console.log(`- Uptime: ${report.container?.uptime || 0}s (${Math.floor((report.container?.uptime || 0) / 3600)}h ${Math.floor(((report.container?.uptime || 0) % 3600) / 60)}m)`);
        
        console.log('\n🔴 Redis:');
        console.log(`- Status: ${report.redis?.status || 'N/A'}`);
        console.log(`- Operations: ${report.redis?.operations || 0}`);
        console.log(`- Latency: ${report.redis?.latency || 0}ms`);
        console.log(`- Connections: ${report.redis?.connections || 0}`);
        console.log(`- Errors: ${report.redis?.errors || 0}`);
        
        console.log('\n🚨 Alertas:');
        console.log(`- Total: ${report.alerts?.length || 0}`);
        if (report.alerts && report.alerts.length > 0) {
            report.alerts.slice(0, 5).forEach((alert, index) => {
                const timeAgo = Math.floor((Date.now() - alert.timestamp) / 1000);
                console.log(`  ${index + 1}. ${alert.type}: ${alert.message} (${timeAgo}s atrás)`);
            });
        }
        
        console.log('\n📈 Summary:');
        console.log(`- Status: ${report.summary?.status || 'N/A'}`);
        console.log(`- Total Alerts: ${report.summary?.totalAlerts || 0}`);
        console.log(`- Critical: ${report.summary?.criticalAlerts || 0}`);
        console.log(`- Error: ${report.summary?.errorAlerts || 0}`);
        console.log(`- Warning: ${report.summary?.warningAlerts || 0}`);
        
        console.log('\n✅ Teste concluído!');
        
        // Limpar recursos
        dockerMonitor.destroy();
        
    } catch (error) {
        console.error('❌ Erro ao testar métricas:', error);
        console.error('Stack:', error.stack);
    }
}

testMetricsOnly(); 