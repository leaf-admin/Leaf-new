/**
 * 🐳 Teste de Redis em Ambiente Docker
 * 
 * Este script testa a conectividade do Redis quando rodando em Docker,
 * verificando se o DockerDetector está funcionando corretamente.
 */

const DockerDetector = require('../../utils/docker-detector');
const redisPool = require('../../utils/redis-pool');
const { logger } = require('../../utils/logger');

// Cores para output
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    blue: '\x1b[34m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

async function testDockerRedis() {
    log('\n🐳 TESTE DE REDIS EM AMBIENTE DOCKER\n', 'cyan');

    // 1. Testar detecção de Docker
    log('1️⃣ Testando detecção de ambiente Docker...', 'blue');
    const inDocker = DockerDetector.isRunningInDocker();
    log(`   Rodando em Docker: ${inDocker ? '✅ Sim' : '❌ Não'}`, inDocker ? 'green' : 'yellow');

    // 2. Testar configuração do Redis
    log('\n2️⃣ Testando configuração do Redis...', 'blue');
    const redisHost = DockerDetector.getRedisHost();
    const redisUrl = DockerDetector.getRedisUrl();
    const redisConfig = DockerDetector.getRedisConfig();

    log(`   Host: ${redisHost}`, 'cyan');
    log(`   Port: ${redisConfig.port}`, 'cyan');
    log(`   DB: ${redisConfig.db}`, 'cyan');
    log(`   Password: ${redisConfig.password ? '✅ Configurada' : '❌ Não configurada'}`, redisConfig.password ? 'green' : 'red');
    log(`   URL: ${redisUrl.replace(/:[^:@]+@/, ':****@')}`, 'cyan'); // Ocultar senha

    // 3. Testar conexão com Redis Pool
    log('\n3️⃣ Testando conexão com Redis Pool...', 'blue');
    try {
        const healthCheck = await redisPool.healthCheck();
        if (healthCheck.status === 'healthy') {
            log(`   ✅ Conexão OK! Latência: ${healthCheck.latency}ms`, 'green');
        } else {
            log(`   ❌ Conexão falhou: ${healthCheck.error}`, 'red');
        }
    } catch (error) {
        log(`   ❌ Erro ao conectar: ${error.message}`, 'red');
    }

    // 4. Testar operações básicas
    log('\n4️⃣ Testando operações básicas do Redis...', 'blue');
    try {
        const redis = redisPool.getConnection();
        
        // SET
        await redis.set('test:docker:key', 'test-value', 'EX', 10);
        log('   ✅ SET executado', 'green');

        // GET
        const value = await redis.get('test:docker:key');
        if (value === 'test-value') {
            log('   ✅ GET executado corretamente', 'green');
        } else {
            log(`   ❌ GET retornou valor incorreto: ${value}`, 'red');
        }

        // DEL
        await redis.del('test:docker:key');
        log('   ✅ DEL executado', 'green');

    } catch (error) {
        log(`   ❌ Erro nas operações: ${error.message}`, 'red');
    }

    // 5. Testar estatísticas do pool
    log('\n5️⃣ Estatísticas do Redis Pool...', 'blue');
    try {
        const stats = redisPool.getPoolStats();
        log(`   Status: ${stats.status}`, stats.connected ? 'green' : 'yellow');
        log(`   Conectado: ${stats.connected ? '✅ Sim' : '❌ Não'}`, stats.connected ? 'green' : 'red');
        log(`   Host: ${stats.options.host}`, 'cyan');
        log(`   Port: ${stats.options.port}`, 'cyan');
        log(`   DB: ${stats.options.db}`, 'cyan');
    } catch (error) {
        log(`   ❌ Erro ao obter estatísticas: ${error.message}`, 'red');
    }

    // 6. Resumo final
    log('\n📋 RESUMO:', 'cyan');
    log(`   Ambiente: ${inDocker ? 'Docker' : 'VPS Direto'}`, 'cyan');
    log(`   Redis Host: ${redisHost}`, 'cyan');
    log(`   Conexão: ${await redisPool.healthCheck().then(r => r.status === 'healthy' ? '✅ OK' : '❌ Falhou').catch(() => '❌ Erro')}`, 'cyan');

    log('\n✅ Teste concluído!\n', 'green');
}

// Executar teste
testDockerRedis().catch(error => {
    log(`\n❌ Erro fatal: ${error.message}`, 'red');
    process.exit(1);
});

