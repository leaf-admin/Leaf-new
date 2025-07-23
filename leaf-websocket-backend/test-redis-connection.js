const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { Redis } = require('ioredis');

console.log('🧪 Testando conexão com Redis...\n');

async function testRedisConnection() {
    try {
        console.log('1. Testando conexão direta com Redis...');
        const redis = new Redis({
            host: 'localhost',
            port: 6379,
            lazyConnect: true,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3
        });
        
        
        console.log('✅ Info obtido com sucesso');
        
        const memory = await redis.info('memory');
        console.log('✅ Memory info obtido');
        
        
const { Redis } = require('ioredis');

console.log('🧪 Testando conexão com Redis...\n');

async function testRedisConnection() {
    try {
        console.log('1. Testando conexão direta com Redis...');
        const redis = new Redis({
            host: 'localhost',
            port: 6379,
            lazyConnect: true,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3
        });
        
        const pingResult = await redis.ping();
        console.log(`✅ Ping direto: ${pingResult}`);
        
        
        console.log('✅ Memory info obtido');
        
        const stats = await redis.info('stats');
        console.log('✅ Stats obtido');
        
        await redis.disconnect();
        console.log('✅ Conexão direta fechada');
        
    } catch (error) {
        console.log('❌ Erro na conexão direta:', error.message);
    }
    
    try {
        console.log('\n2. Testando Redis via Docker container...');
        const { stdout } = await execAsync('docker exec redis-taxi-app redis-cli ping');
        console.log(`✅ Ping via Docker: ${stdout.trim()}`);
        
        const { stdout: info } = await execAsync('docker exec redis-taxi-app redis-cli info');
        console.log('✅ Info via Docker obtido');
        
        const { stdout: memory } = await execAsync('docker exec redis-taxi-app redis-cli info memory');
        console.log('✅ Memory info via Docker obtido');
        
        const { stdout: stats } = await execAsync('docker exec redis-taxi-app redis-cli info stats');
        console.log('✅ Stats via Docker obtido');
        
    } catch (error) {
        console.log('❌ Erro via Docker:', error.message);
    }
    
    console.log('\n🎯 Teste de conexão Redis concluído!');
}

testRedisConnection(); 
const { promisify } = require('util');

        console.log(`✅ Ping direto: ${pingResult}`);
        
        const info = await redis.info();
        console.log('✅ Info obtido com sucesso');
        
        
        console.log('✅ Stats obtido');
        
        await redis.disconnect();
        console.log('✅ Conexão direta fechada');
        
    } catch (error) {
        console.log('❌ Erro na conexão direta:', error.message);
    }
    
    try {
        console.log('\n2. Testando Redis via Docker container...');
        const { stdout } = await execAsync('docker exec redis-taxi-app redis-cli ping');
        console.log(`✅ Ping via Docker: ${stdout.trim()}`);
        
        const { stdout: info } = await execAsync('docker exec redis-taxi-app redis-cli info');
        console.log('✅ Info via Docker obtido');
        
        const { stdout: memory } = await execAsync('docker exec redis-taxi-app redis-cli info memory');
        console.log('✅ Memory info via Docker obtido');
        
        const { stdout: stats } = await execAsync('docker exec redis-taxi-app redis-cli info stats');
        console.log('✅ Stats via Docker obtido');
        
    } catch (error) {
        console.log('❌ Erro via Docker:', error.message);
    }
    
    console.log('\n🎯 Teste de conexão Redis concluído!');
}

testRedisConnection(); 