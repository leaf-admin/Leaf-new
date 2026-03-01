const DockerMonitor = require('./monitoring/docker-monitor');

console.log('🧪 Testando DockerMonitor corrigido...\n');

async function testDockerMonitor() {
    try {
        console.log('1. Criando instância do DockerMonitor...');
        const dockerMonitor = new DockerMonitor();
        
        console.log('2. Aguardando 5 segundos para primeira verificação...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        console.log('3. Obtendo relatório...');
        const report = dockerMonitor.getFullReport();
        
        console.log('4. Relatório obtido:');
        console.log(JSON.stringify(report, null, 2));
        
        console.log('\n5. Obtendo resumo...');
        const summary = dockerMonitor.getSummary();
        console.log(JSON.stringify(summary, null, 2));
        
        console.log('\n✅ Teste concluído com sucesso!');
        
        // Parar monitoramento
        dockerMonitor.destroy();
        
    } catch (error) {
        console.error('❌ Erro no teste:', error);
    }
}

testDockerMonitor(); 

console.log('🧪 Testando DockerMonitor corrigido...\n');

async function testDockerMonitor() {
    try {
        console.log('1. Criando instância do DockerMonitor...');
        const dockerMonitor = new DockerMonitor();
        
        console.log('2. Aguardando 5 segundos para primeira verificação...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        console.log('3. Obtendo relatório...');
        const report = dockerMonitor.getFullReport();
        
        console.log('4. Relatório obtido:');
        console.log(JSON.stringify(report, null, 2));
        
        console.log('\n5. Obtendo resumo...');
        const summary = dockerMonitor.getSummary();
        console.log(JSON.stringify(summary, null, 2));
        
        console.log('\n✅ Teste concluído com sucesso!');
        
        // Parar monitoramento
        dockerMonitor.destroy();
        
    } catch (error) {
        console.error('❌ Erro no teste:', error);
    }
}

testDockerMonitor(); 

console.log('🧪 Testando DockerMonitor corrigido...\n');

async function testDockerMonitor() {
    try {
        console.log('1. Criando instância do DockerMonitor...');
        const dockerMonitor = new DockerMonitor();
        
        console.log('2. Aguardando 5 segundos para primeira verificação...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        console.log('3. Obtendo relatório...');
        const report = dockerMonitor.getFullReport();
        
        console.log('4. Relatório obtido:');
        console.log(JSON.stringify(report, null, 2));
        
        console.log('\n5. Obtendo resumo...');
        const summary = dockerMonitor.getSummary();
        console.log(JSON.stringify(summary, null, 2));
        
        console.log('\n✅ Teste concluído com sucesso!');
        
        // Parar monitoramento
        dockerMonitor.destroy();
        
    } catch (error) {
        console.error('❌ Erro no teste:', error);
    }
}

testDockerMonitor(); 