const DockerMonitor = require('./monitoring/docker-monitor');

console.log('🧪 Testando DockerMonitor CORRIGIDO...\n');

async function testDockerMonitor() {
    try {
        console.log('1. Criando instância do DockerMonitor...');
        const dockerMonitor = new DockerMonitor();
        
        console.log('2. Aguardando 20 segundos para verificações completas...');
        await new Promise(resolve => setTimeout(resolve, 20000));
        
        console.log('3. Obtendo relatório completo...');
        const report = dockerMonitor.getFullReport();
        
        console.log('4. Relatório obtido:');
        console.log(JSON.stringify(report, null, 2));
        
        console.log('\n5. Obtendo resumo...');
        const summary = dockerMonitor.getSummary();
        console.log(JSON.stringify(summary, null, 2));
        
        console.log('\n6. Verificando alertas...');
        const alerts = report.alerts;
        if (alerts.length > 0) {
            console.log('Alertas ativos:');
            alerts.forEach(alert => {
                console.log(`- [${alert.severity.toUpperCase()}] ${alert.message}`);
            });
        } else {
            console.log('✅ Nenhum alerta ativo');
        }
        
        console.log('\n7. Resumo das métricas:');
        console.log(`🐳 Container Redis: ${report.container.status} (CPU: ${report.container.cpu}%, Mem: ${report.container.memory.percentage.toFixed(1)}%)`);
        console.log(`🔴 Redis: ${report.redis.status} (Conexões: ${report.redis.connections}, Latência: ${report.redis.latency}ms)`);
        console.log(`📊 Sistema Docker: ${report.system.runningContainers} containers rodando`);
        console.log(`🖥️ Host: CPU ${report.host.cpu}%, Memória ${report.host.memory.toFixed(1)}%, Uptime ${Math.floor(report.host.uptime / 3600)}h`);
        
        console.log('\n8. Verificando se as métricas estão sendo obtidas...');
        if (report.container.cpu > 0 || report.container.memory.percentage > 0) {
            console.log('✅ Métricas do container obtidas com sucesso!');
        } else {
            console.log('⚠️ Métricas do container ainda não estão sendo obtidas');
        }
        
        if (report.redis.connections > 0 || report.redis.latency > 0) {
            console.log('✅ Métricas do Redis obtidas com sucesso!');
        } else {
            console.log('⚠️ Métricas do Redis ainda não estão sendo obtidas');
        }
        
        if (report.host.cpu > 0 || report.host.memory > 0) {
            console.log('✅ Métricas do host obtidas com sucesso!');
        } else {
            console.log('⚠️ Métricas do host ainda não estão sendo obtidas');
        }
        
        console.log('\n✅ Teste concluído com sucesso!');
        
        // Parar monitoramento
        dockerMonitor.destroy();
        
    } catch (error) {
        console.error('❌ Erro no teste:', error);
    }
}

testDockerMonitor(); 