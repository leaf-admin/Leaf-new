#!/usr/bin/env node

/**
 * Teste de Status Atual dos Serviços
 * 
 * Verifica o status do Redis, WebSocket Backend e Firebase Functions
 * ATUALIZADO: Redis está na VPS Vultr, não localmente
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

// Função para testar Redis na VPS Vultr (NÃO LOCAL)
async function testRedisVultr() {
    // Testar se o Redis na VPS está respondendo
    return await testHttpConnection(
        'http://216.238.107.59:3001/api/health',
        'Redis VPS Vultr'
    );
}

// Função para testar WebSocket Backend na VPS
async function testWebSocketBackend() {
    return await testHttpConnection(
        'http://216.238.107.59:3001/api/health',
        'WebSocket Backend VPS'
    );
}

// Função para testar Firebase Functions (fallback)
async function testFirebaseFunctions() {
    return await testHttpConnection(
        'https://us-central1-leaf-app-91dfdce0.cloudfunctions.net/health',
        'Firebase Functions (Fallback)'
    );
}

// Função para testar Redis API na VPS (endpoint correto)
async function testRedisAPI() {
    return await testHttpConnection(
        'http://216.238.107.59:3001/api/stats',
        'Redis API VPS (endpoint correto)'
    );
}

// Função para testar todas as APIs da VPS
async function testVultrAPIs() {
    const apis = [
        { url: '/api/health', name: 'Health Check' },
        { url: '/api/stats', name: 'Estatísticas' },
        { url: '/api/nearby_drivers', name: 'Motoristas Próximos' },
        { url: '/api/update_user_location', name: 'Atualizar Localização' }
    ];
    
    const results = [];
    
    for (const api of apis) {
        const result = await testHttpConnection(
            `http://216.238.107.59:3001${api.url}`,
            `API ${api.name}`
        );
        results.push({ ...result, endpoint: api.name });
    }
    
    return results;
}

// Executar todos os testes
async function runAllTests() {
    console.log('🚀 Iniciando testes de status...\n');
    
    const results = {
        redisVultr: await testRedisVultr(),
        websocket: await testWebSocketBackend(),
        firebase: await testFirebaseFunctions(),
        redisApi: await testRedisAPI()
    };
    
    // Testar todas as APIs da VPS
    console.log('\n🔍 Testando todas as APIs da VPS Vultr...');
    const vultrApis = await testVultrAPIs();
    
    console.log('\n📊 RESULTADOS DOS TESTES:');
    console.log('========================');
    
    // Resultados principais
    Object.keys(results).forEach(service => {
        const result = results[service];
        const status = result.success ? '✅ OPERACIONAL' : '❌ NÃO OPERACIONAL';
        console.log(`${service}: ${status}`);
        
        if (!result.success && result.error) {
            console.log(`   Erro: ${result.error}`);
        }
    });
    
    // Resultados das APIs da VPS
    console.log('\n🏠 APIS DA VPS VULTR:');
    console.log('=====================');
    vultrApis.forEach(api => {
        const status = api.success ? '✅' : '❌';
        console.log(`${status} ${api.endpoint}: ${api.success ? 'OK' : api.error}`);
    });
    
    const operationalServices = Object.values(results).filter(r => r.success).length;
    const totalServices = Object.keys(results).length;
    const operationalApis = vultrApis.filter(api => api.success).length;
    const totalApis = vultrApis.length;
    
    console.log(`\n📈 RESUMO: ${operationalServices}/${totalServices} serviços operacionais`);
    console.log(`📊 APIS VPS: ${operationalApis}/${totalApis} APIs funcionando`);
    
    if (operationalServices === totalServices && operationalApis === totalApis) {
        console.log('🎉 TODOS OS SERVIÇOS E APIS ESTÃO OPERACIONAIS!');
    } else if (operationalServices > 0) {
        console.log('⚠️ ALGUNS SERVIÇOS ESTÃO OPERACIONAIS');
    } else {
        console.log('🚨 NENHUM SERVIÇO ESTÁ OPERACIONAL');
    }
    
    return { ...results, vultrApis };
}

// Executar se chamado diretamente
if (require.main === module) {
    runAllTests().then(results => {
        console.log('\n🔧 PRÓXIMOS PASSOS:');
        
        if (!results.redisVultr.success) {
            console.log('1. Verificar se a VPS Vultr está online');
            console.log('2. Verificar se o serviço está rodando na porta 3005');
        }
        
        if (!results.websocket.success) {
            console.log('3. Verificar WebSocket Backend na VPS');
        }
        
        if (!results.firebase.success) {
            console.log('4. Firebase Functions está configurado como fallback');
        }
        
        if (!results.redisApi.success) {
            console.log('5. Verificar endpoint /api/stats na VPS');
        }
        
        // Verificar APIs da VPS
        const failedApis = results.vultrApis.filter(api => !api.success);
        if (failedApis.length > 0) {
            console.log('\n⚠️ APIS COM PROBLEMAS:');
            failedApis.forEach(api => {
                console.log(`   - ${api.endpoint}: ${api.error}`);
            });
        }
        
        console.log('\n✅ Teste de status concluído!');
        console.log('🏠 VPS Vultr: 216.238.107.59:3001');
        console.log('🌐 Firebase: https://us-central1-leaf-app-91dfdce0.cloudfunctions.net');
    });
}

module.exports = {
    testRedisVultr,
    testWebSocketBackend,
    testFirebaseFunctions,
    testRedisAPI,
    testVultrAPIs,
    runAllTests
}; 