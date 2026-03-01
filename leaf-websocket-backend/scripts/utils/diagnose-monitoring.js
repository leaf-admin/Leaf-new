const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { Redis } = require('ioredis');

console.log('🔍 DIAGNÓSTICO COMPLETO DO MONITORAMENTO\n');

async function diagnoseMonitoring() {
    console.log('=== 1. TESTANDO COMANDOS DOCKER ===');
    
    try {
        console.log('1.1. Verificando se Docker está rodando...');
        const { stdout: dockerVersion } = await execAsync('docker --version');
        console.log(`✅ Docker: ${dockerVersion.trim()}`);
        
        console.log('\n1.2. Listando containers...');
        const { stdout: containers } = await execAsync('docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"');
        console.log('Containers encontrados:');
        console.log(containers);
        
        console.log('\n1.3. Verificando container redis-leaf...');
        const { stdout: containerInfo } = await execAsync('docker inspect redis-leaf --format="{{.State.Status}}"');
        console.log(`✅ Status do container: ${containerInfo.trim()}`);
        
        console.log('\n1.4. Testando docker stats...');
        const { stdout: stats } = await execAsync('docker stats redis-leaf --no-stream --format "table {{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"');
        console.log('Stats do container:');
        console.log(stats);
        
    } catch (error) {
        console.log(`❌ Erro no Docker: ${error.message}`);
    }
    
    console.log('\n=== 2. TESTANDO REDIS ===');
    
    try {
        console.log('2.1. Testando conexão direta com Redis...');
        const redis = new Redis({
            host: 'redis-master',
            port: 6379,
            lazyConnect: true,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3
        });
        
        await redis.connect();
        const info = await redis.info();
        console.log('✅ Info obtido');
        
        await redis.disconnect();
        
    } catch (error) {
        console.log(`❌ Erro na conexão direta: ${error.message}`);
    }
    
    try {
        console.log('\n2.2. Testando Redis via Docker...');
        const { stdout: pingDocker } = await execAsync('docker exec redis-leaf redis-cli ping');
        console.log(`✅ Ping via Docker: ${pingDocker.trim()}`);
        
        const { stdout: infoDocker } = await execAsync('docker exec redis-leaf redis-cli info');
        console.log('✅ Info via Docker obtido');
        
    } catch (error) {
        console.log(`❌ Erro via Docker: ${error.message}`);
    }
    
    console.log('\n=== 3. TESTANDO COMANDOS DO SISTEMA ===');
    
    try {
        console.log('3.1. Testando comando top...');
        const { stdout: topInfo } = await execAsync('top -bn1 | head -20');
        console.log('Top Info:');
        console.log(topInfo);
        
        console.log('\n3.2. Testando free memory...');
        const { stdout: memoryInfo } = await execAsync('free -h');
        console.log('Memory Info:');
        console.log(memoryInfo);
        
        console.log('\n3.3. Testando uptime...');
        const { stdout: uptimeInfo } = await execAsync('uptime');
        console.log('Uptime Info:');
        console.log(uptimeInfo);
        
    } catch (error) {
        console.log(`❌ Erro nos comandos do sistema: ${error.message}`);
    }
    
    console.log('\n=== 4. TESTANDO DOCKER MONITOR ===');
    
    try {
        console.log('4.1. Importando DockerMonitor...');
        const DockerMonitor = require('./monitoring/docker-monitor');
        console.log('✅ DockerMonitor importado com sucesso');
        
        console.log('\n4.2. Criando instância...');
        const dockerMonitor = new DockerMonitor('redis-leaf');
        console.log('✅ Instância criada');
        
        console.log('\n4.3. Obtendo relatório...');
        const report = await dockerMonitor.getReport();
        console.log('Relatório obtido:');
        console.log(JSON.stringify(report, null, 2));
        
        dockerMonitor.destroy();
        
    } catch (error) {
        console.log(`❌ Erro no DockerMonitor: ${error.message}`);
    }
    
    console.log('\n=== 5. TESTANDO SISTEMA DE ALERTAS ===');
    
    try {
        console.log('5.1. Importando sistema de alertas...');
        const alertSystem = require('./monitoring/smart-sync-alert-system');
        console.log('✅ Sistema de alertas importado');
        
        console.log('\n5.2. Verificando status...');
        const alertStatus = await alertSystem.checkSyncStatus();
        console.log('Status dos alertas:');
        console.log(JSON.stringify(alertStatus, null, 2));
        
    } catch (error) {
        console.log(`❌ Erro no sistema de alertas: ${error.message}`);
    }
    
    console.log('\n🎯 DIAGNÓSTICO CONCLUÍDO!');
}

// Executar diagnóstico
diagnoseMonitoring().catch(console.error); 