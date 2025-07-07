console.log('🧪 Teste Básico - Verificando Ambiente\n');

// Teste 1: Verificar Node.js
console.log('1️⃣ Node.js version:', process.version);

// Teste 2: Verificar se podemos fazer require básico
try {
    const path = require('path');
    console.log('2️⃣ Módulo path carregado:', path.resolve('.'));
} catch (error) {
    console.error('❌ Erro ao carregar path:', error.message);
}

// Teste 3: Verificar se o arquivo existe
try {
    const fs = require('fs');
    const configPath = './common/src/config/redisConfig.js';
    const exists = fs.existsSync(configPath);
    console.log('3️⃣ Arquivo de config existe:', exists);
} catch (error) {
    console.error('❌ Erro ao verificar arquivo:', error.message);
}

// Teste 4: Tentar carregar Redis diretamente
try {
    const redis = require('redis');
    console.log('4️⃣ Redis carregado com sucesso');
} catch (error) {
    console.error('❌ Erro ao carregar Redis:', error.message);
}

console.log('\n🎉 Teste básico finalizado!'); 