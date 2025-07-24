const { Redis } = require('ioredis');

console.log('🔴 Teste simples do Redis...\n');

async function testRedis() {
    try {
        console.log('1. Criando conexão com Redis...');
        const redis = new Redis({
            host: 'localhost',
            port: 6379,
            lazyConnect: true,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3,
            connectTimeout: 5000
        });
        
        console.log('2. Testando ping...');
        const pingResult = await redis.ping();
        console.log(`✅ Ping: ${pingResult}`);
        
        console.log('3. Obtendo info...');
        const info = await redis.info();
        console.log('✅ Info obtido');
        
        console.log('4. Obtendo info de memória...');
        const memory = await redis.info('memory');
        console.log('✅ Memory info obtido');
        
        console.log('5. Obtendo info de stats...');
        const stats = await redis.info('stats');
        console.log('✅ Stats obtido');
        
        console.log('6. Fechando conexão...');
        await redis.disconnect();
        console.log('✅ Conexão fechada');
        
        console.log('\n🎯 Teste do Redis concluído com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro no teste do Redis:', error.message);
        console.error('Stack:', error.stack);
    }
}

testRedis(); 

console.log('🔴 Teste simples do Redis...\n');

async function testRedis() {
    try {
        console.log('1. Criando conexão com Redis...');
        const redis = new Redis({
            host: 'localhost',
            port: 6379,
            lazyConnect: true,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3,
            connectTimeout: 5000
        });
        
        console.log('2. Testando ping...');
        const pingResult = await redis.ping();
        console.log(`✅ Ping: ${pingResult}`);
        
        console.log('3. Obtendo info...');
        const info = await redis.info();
        console.log('✅ Info obtido');
        
        console.log('4. Obtendo info de memória...');
        const memory = await redis.info('memory');
        console.log('✅ Memory info obtido');
        
        console.log('5. Obtendo info de stats...');
        const stats = await redis.info('stats');
        console.log('✅ Stats obtido');
        
        console.log('6. Fechando conexão...');
        await redis.disconnect();
        console.log('✅ Conexão fechada');
        
        console.log('\n🎯 Teste do Redis concluído com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro no teste do Redis:', error.message);
        console.error('Stack:', error.stack);
    }
}

testRedis(); 

console.log('🔴 Teste simples do Redis...\n');

async function testRedis() {
    try {
        console.log('1. Criando conexão com Redis...');
        const redis = new Redis({
            host: 'localhost',
            port: 6379,
            lazyConnect: true,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3,
            connectTimeout: 5000
        });
        
        console.log('2. Testando ping...');
        const pingResult = await redis.ping();
        console.log(`✅ Ping: ${pingResult}`);
        
        console.log('3. Obtendo info...');
        const info = await redis.info();
        console.log('✅ Info obtido');
        
        console.log('4. Obtendo info de memória...');
        const memory = await redis.info('memory');
        console.log('✅ Memory info obtido');
        
        console.log('5. Obtendo info de stats...');
        const stats = await redis.info('stats');
        console.log('✅ Stats obtido');
        
        console.log('6. Fechando conexão...');
        await redis.disconnect();
        console.log('✅ Conexão fechada');
        
        console.log('\n🎯 Teste do Redis concluído com sucesso!');
        
    } catch (error) {
        console.error('❌ Erro no teste do Redis:', error.message);
        console.error('Stack:', error.stack);
    }
}

testRedis(); 