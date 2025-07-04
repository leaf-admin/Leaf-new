console.log('🧪 Teste Simples - Verificando Dependências\n');

// Teste 1: Verificar se Node.js está funcionando
console.log('1️⃣ Node.js funcionando:', process.version);

// Teste 2: Verificar se podemos carregar módulos básicos
try {
    const fs = require('fs');
    console.log('2️⃣ Módulo fs carregado com sucesso');
} catch (error) {
    console.error('❌ Erro ao carregar fs:', error.message);
}

// Teste 3: Verificar se o arquivo de configuração existe
try {
    const configPath = './common/src/config/redisConfig.js';
    if (fs.existsSync(configPath)) {
        console.log('3️⃣ Arquivo de configuração Redis encontrado');
    } else {
        console.log('❌ Arquivo de configuração Redis não encontrado');
    }
} catch (error) {
    console.error('❌ Erro ao verificar arquivo:', error.message);
}

// Teste 4: Tentar carregar configuração Redis
try {
    const { MIGRATION_FLAGS } = require('./common/src/config/redisConfig');
    console.log('4️⃣ Configuração Redis carregada com sucesso');
    console.log('📊 Feature Flags:', MIGRATION_FLAGS);
} catch (error) {
    console.error('❌ Erro ao carregar configuração Redis:', error.message);
}

// Teste 5: Verificar se Redis está rodando
try {
    const redis = require('redis');
    console.log('5️⃣ Cliente Redis disponível');
    
    const client = redis.createClient({
        url: 'redis://localhost:6379'
    });
    
    client.on('error', (err) => {
        console.log('❌ Redis não está rodando:', err.message);
    });
    
    client.on('connect', () => {
        console.log('✅ Redis conectado com sucesso');
        client.quit();
    });
    
    client.connect().catch(err => {
        console.log('❌ Erro ao conectar Redis:', err.message);
    });
    
} catch (error) {
    console.error('❌ Erro ao carregar Redis:', error.message);
}

console.log('\n🎉 Teste simples finalizado!'); 