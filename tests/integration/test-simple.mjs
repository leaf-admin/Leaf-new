import { createClient } from 'redis';

console.log('🚀 Iniciando teste simples do Redis...');

async function testRedis() {
    try {
        const client = createClient({
            url: 'redis://localhost:6379'
        });

        client.on('error', (err) => {
            console.error('Redis Client Error:', err);
        });

        client.on('connect', () => {
            console.log('Redis connected successfully');
        });

        await client.connect();
        console.log('✅ Conexão estabelecida');

        // Teste básico
        await client.set('test-key', 'test-value');
        const value = await client.get('test-key');
        console.log('✅ Teste básico:', value);

        await client.disconnect();
        console.log('✅ Conexão fechada');
        
    } catch (error) {
        console.error('❌ Erro:', error);
    }
}

testRedis(); 