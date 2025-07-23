const DockerMonitor = require('../leaf-websocket-backend/monitoring/docker-monitor.js');

async function testDockerMonitor() {
    try {
        console.log('🔍 Testando DockerMonitor diretamente...\n');
        
        // Criar instância do monitor
        const dockerMonitor = new DockerMonitor();
        
        console.log('1. Iniciando monitoramento...');
        dockerMonitor.startMonitoring();
        
        // Aguardar um pouco para coletar dados
        console.log('2. Aguardando coleta de dados...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('3. Obtendo relatório...');
        const report = dockerMonitor.getFullReport();
        
        console.log('📊 Relatório do DockerMonitor:');
        console.log(JSON.stringify(report, null, 2));
        
        console.log('\n4. Verificando métricas específicas:');
        console.log('- Container Status:', report.container?.status);
        console.log('- Container CPU:', report.container?.cpu);
        console.log('- Container Memory:', report.container?.memory);
        console.log('- Redis Status:', report.redis?.status);
        console.log('- Redis Connections:', report.redis?.connections);
        console.log('- Redis Operations:', report.redis?.operations);
        console.log('- System Containers:', report.system?.runningContainers);
        
        console.log('\n5. Parando monitoramento...');
        dockerMonitor.stopMonitoring();
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar DockerMonitor:', error.message);
    }
}

testDockerMonitor(); 

async function testDockerMonitor() {
    try {
        console.log('🔍 Testando DockerMonitor diretamente...\n');
        
        // Criar instância do monitor
        const dockerMonitor = new DockerMonitor();
        
        console.log('1. Iniciando monitoramento...');
        dockerMonitor.startMonitoring();
        
        // Aguardar um pouco para coletar dados
        console.log('2. Aguardando coleta de dados...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('3. Obtendo relatório...');
        const report = dockerMonitor.getFullReport();
        
        console.log('📊 Relatório do DockerMonitor:');
        console.log(JSON.stringify(report, null, 2));
        
        console.log('\n4. Verificando métricas específicas:');
        console.log('- Container Status:', report.container?.status);
        console.log('- Container CPU:', report.container?.cpu);
        console.log('- Container Memory:', report.container?.memory);
        console.log('- Redis Status:', report.redis?.status);
        console.log('- Redis Connections:', report.redis?.connections);
        console.log('- Redis Operations:', report.redis?.operations);
        console.log('- System Containers:', report.system?.runningContainers);
        
        console.log('\n5. Parando monitoramento...');
        dockerMonitor.stopMonitoring();
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar DockerMonitor:', error.message);
    }
}

testDockerMonitor(); 

async function testDockerMonitor() {
    try {
        console.log('🔍 Testando DockerMonitor diretamente...\n');
        
        // Criar instância do monitor
        const dockerMonitor = new DockerMonitor();
        
        console.log('1. Iniciando monitoramento...');
        dockerMonitor.startMonitoring();
        
        // Aguardar um pouco para coletar dados
        console.log('2. Aguardando coleta de dados...');
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('3. Obtendo relatório...');
        const report = dockerMonitor.getFullReport();
        
        console.log('📊 Relatório do DockerMonitor:');
        console.log(JSON.stringify(report, null, 2));
        
        console.log('\n4. Verificando métricas específicas:');
        console.log('- Container Status:', report.container?.status);
        console.log('- Container CPU:', report.container?.cpu);
        console.log('- Container Memory:', report.container?.memory);
        console.log('- Redis Status:', report.redis?.status);
        console.log('- Redis Connections:', report.redis?.connections);
        console.log('- Redis Operations:', report.redis?.operations);
        console.log('- System Containers:', report.system?.runningContainers);
        
        console.log('\n5. Parando monitoramento...');
        dockerMonitor.stopMonitoring();
        
        console.log('\n🎯 Teste concluído!');
        
    } catch (error) {
        console.error('❌ Erro ao testar DockerMonitor:', error.message);
    }
}

testDockerMonitor(); 