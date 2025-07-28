#!/usr/bin/env node

/**
 * Teste de Status Atual dos Serviços
 * 
 * Verifica o status do Redis, WebSocket Backend e Firebase Functions
 */

console.log('🔍 TESTE DE STATUS ATUAL DOS SERVIÇOS');
console.log('=====================================\n');

const https = require('https');
const http = require('http');

// Função para testar conexão HTTP
async function testHttpConnection(url, description) {
    return new Promise((resolve) => {
        const client = url.startsWith('https') ? https : http;
        
        const req = client.get(url, { timeout: 5000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                console.log(`✅ ${description}: ${res.statusCode}`);
                resolve({ success: true, status: res.statusCode, data });
            });
        });
        
        req.on('error', (error) => {
            console.log(`❌ ${description}: ${error.message}`);
            resolve({ success: false, error: error.message });
        });
        
        req.on('timeout', () => {
            console.log(`⏰ ${description}: Timeout`);
            req.destroy();
            resolve({ success: false, error: 'Timeout' });
        });
    });
}

// Função para testar Redis via Docker
async function testRedis() {
    const { exec } = require('child_process');
    
    return new Promise((resolve) => {
        exec('docker ps | grep redis-leaf', (error, stdout, stderr) => {
            if (error) {
                console.log('❌ Redis: Container não encontrado');
                resolve({ success: false, error: 'Container não encontrado' });
                return;
            }
            
            if (stdout.includes('redis-leaf')) {
                console.log('✅ Redis: Container rodando');
                resolve({ success: true, container: 'redis-leaf' });
            } else {
                console.log('❌ Redis: Container não está rodando');
                resolve({ success: false, error: 'Container não está rodando' });
            }
        });
    });
}

// Função para testar WebSocket Backend
async function testWebSocketBackend() {
    return await testHttpConnection(
        'http://localhost:3001/health',
        'WebSocket Backend'
    );
}

// Função para testar Firebase Functions
async function testFirebaseFunctions() {
    return await testHttpConnection(
        'http://localhost:5001/leaf-app-91dfdce0/us-central1/get_redis_stats',
        'Firebase Functions'
    );
}

// Função para testar Redis API
async function testRedisAPI() {
    return await testHttpConnection(
        'http://localhost:3001/api/redis/stats',
        'Redis API'
    );
}

// Executar todos os testes
async function runAllTests() {
    console.log('🚀 Iniciando testes de status...\n');
    
    const results = {
        redis: await testRedis(),
        websocket: await testWebSocketBackend(),
        firebase: await testFirebaseFunctions(),
        redisApi: await testRedisAPI()
    };
    
    console.log('\n📊 RESULTADOS DOS TESTES:');
    console.log('========================');
    
    Object.keys(results).forEach(service => {
        const result = results[service];
        const status = result.success ? '✅ OPERACIONAL' : '❌ NÃO OPERACIONAL';
        console.log(`${service}: ${status}`);
        
        if (!result.success && result.error) {
            console.log(`   Erro: ${result.error}`);
        }
    });
    
    const operationalServices = Object.values(results).filter(r => r.success).length;
    const totalServices = Object.keys(results).length;
    
    console.log(`\n📈 RESUMO: ${operationalServices}/${totalServices} serviços operacionais`);
    
    if (operationalServices === totalServices) {
        console.log('🎉 TODOS OS SERVIÇOS ESTÃO OPERACIONAIS!');
    } else if (operationalServices > 0) {
        console.log('⚠️ ALGUNS SERVIÇOS ESTÃO OPERACIONAIS');
    } else {
        console.log('🚨 NENHUM SERVIÇO ESTÁ OPERACIONAL');
    }
    
    return results;
}

// Executar se chamado diretamente
if (require.main === module) {
    runAllTests().then(results => {
        console.log('\n🔧 PRÓXIMOS PASSOS:');
        
        if (!results.redis.success) {
            console.log('1. Iniciar Redis: docker-compose up -d redis');
        }
        
        if (!results.websocket.success) {
            console.log('2. Iniciar WebSocket: cd leaf-websocket-backend && npm start');
        }
        
        if (!results.firebase.success) {
            console.log('3. Iniciar Firebase: cd Sourcecode && firebase emulators:start --only functions');
        }
        
        if (!results.redisApi.success) {
            console.log('4. Verificar APIs Redis no WebSocket Backend');
        }
        
        console.log('\n✅ Teste de status concluído!');
    });
}

module.exports = {
    testRedis,
    testWebSocketBackend,
    testFirebaseFunctions,
    testRedisAPI,
    runAllTests
}; 