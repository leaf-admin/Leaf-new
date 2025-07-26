#!/usr/bin/env node

/**
 * Script para testar a integração completa com Redis otimizado
 * Verifica se todos os serviços estão funcionando com a nova configuração
 */

const http = require('http');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

const REDIS_HOST = 'localhost';
const REDIS_PORT = 6379;
const WEBSOCKET_PORT = 3001;
const DASHBOARD_PORT = 3000;
const FIREBASE_PORT = 5001;

console.log('🚀 Testando Integração com Redis Otimizado');
console.log('==========================================\n');

// Função para executar comando Redis
async function runRedisCommand(command) {
    try {
        const { stdout } = await execAsync(`redis-cli -h ${REDIS_HOST} -p ${REDIS_PORT} ${command}`);
        return stdout.trim();
    } catch (error) {
        console.error(`❌ Erro ao executar comando Redis: ${error.message}`);
        return null;
    }
}

// Função para fazer requisição HTTP
function makeRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(data);
                    resolve({ status: res.statusCode, data: jsonData });
                } catch (error) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });

        req.on('error', (error) => {
            reject(error);
        });

        req.end();
    });
}

// Teste 1: Verificar Redis otimizado
async function testRedisOptimized() {
    console.log('1️⃣ Testando Redis otimizado...');
    
    try {
        // Testar conexão
        const ping = await runRedisCommand('ping');
        if (ping !== 'PONG') {
            console.log('❌ Redis não está respondendo');
            return false;
        }
        console.log('✅ Redis respondendo');

        // Verificar configurações otimizadas
        const maxmemory = await runRedisCommand('CONFIG_LEAF GET maxmemory');
        const maxmemoryPolicy = await runRedisCommand('CONFIG_LEAF GET maxmemory-policy');
        const activedefrag = await runRedisCommand('CONFIG_LEAF GET activedefrag');
        const appendonly = await runRedisCommand('CONFIG_LEAF GET appendonly');

        if (maxmemory.includes('536870912') && 
            maxmemoryPolicy.includes('allkeys-lru') && 
            activedefrag.includes('yes') && 
            appendonly.includes('yes')) {
            console.log('✅ Configurações otimizadas aplicadas');
            return true;
        } else {
            console.log('❌ Configurações otimizadas não aplicadas');
            return false;
        }
    } catch (error) {
        console.log(`❌ Erro no teste Redis: ${error.message}`);
        return false;
    }
}

// Teste 2: Verificar WebSocket Backend
async function testWebSocketBackend() {
    console.log('\n2️⃣ Testando WebSocket Backend...');
    
    try {
        const response = await makeRequest(`http://localhost:${WEBSOCKET_PORT}/health`);
        
        if (response.status === 200) {
            console.log('✅ WebSocket Backend respondendo');
            console.log(`📊 Status: ${JSON.stringify(response.data, null, 2)}`);
            return true;
        } else {
            console.log(`❌ WebSocket Backend erro: ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ WebSocket Backend não acessível: ${error.message}`);
        return false;
    }
}

// Teste 3: Verificar Dashboard
async function testDashboard() {
    console.log('\n3️⃣ Testando Dashboard...');
    
    try {
        const response = await makeRequest(`http://localhost:${DASHBOARD_PORT}`);
        
        if (response.status === 200) {
            console.log('✅ Dashboard acessível');
            return true;
        } else {
            console.log(`❌ Dashboard erro: ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Dashboard não acessível: ${error.message}`);
        return false;
    }
}

// Teste 4: Verificar Firebase Functions
async function testFirebaseFunctions() {
    console.log('\n4️⃣ Testando Firebase Functions...');
    
    try {
        const response = await makeRequest(`http://127.0.0.1:${FIREBASE_PORT}/leaf-reactnative/us-central1/get_redis_stats`);
        
        if (response.status === 200) {
            console.log('✅ Firebase Functions respondendo');
            return true;
        } else {
            console.log(`❌ Firebase Functions erro: ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Firebase Functions não acessível: ${error.message}`);
        return false;
    }
}

// Teste 5: Verificar métricas do Dashboard
async function testDashboardMetrics() {
    console.log('\n5️⃣ Testando métricas do Dashboard...');
    
    try {
        // Testar métricas de usuários
        const userStats = await makeRequest(`http://localhost:${WEBSOCKET_PORT}/stats/users`);
        if (userStats.status === 200) {
            console.log('✅ Métricas de usuários funcionando');
        } else {
            console.log('❌ Métricas de usuários falharam');
        }

        // Testar métricas financeiras
        const financialStats = await makeRequest(`http://localhost:${WEBSOCKET_PORT}/stats/financial`);
        if (financialStats.status === 200) {
            console.log('✅ Métricas financeiras funcionando');
        } else {
            console.log('❌ Métricas financeiras falharam');
        }

        return userStats.status === 200 && financialStats.status === 200;
    } catch (error) {
        console.log(`❌ Erro ao testar métricas: ${error.message}`);
        return false;
    }
}

// Teste 6: Verificar Docker container
async function testDockerContainer() {
    console.log('\n6️⃣ Testando container Docker...');
    
    try {
        const { stdout } = await execAsync('docker ps | grep redis-leaf');
        
        if (stdout.includes('redis-leaf')) {
            console.log('✅ Container redis-leaf rodando');
            
            // Verificar stats do container
            const { stdout: stats } = await execAsync('docker stats redis-leaf --no-stream');
            console.log('📊 Stats do container:');
            console.log(stats);
            
            return true;
        } else {
            console.log('❌ Container redis-leaf não encontrado');
            return false;
        }
    } catch (error) {
        console.log(`❌ Erro ao verificar container: ${error.message}`);
        return false;
    }
}

// Função principal
async function runIntegrationTests() {
    console.log('🔧 Iniciando testes de integração...\n');
    
    const results = {
        redis: await testRedisOptimized(),
        websocket: await testWebSocketBackend(),
        dashboard: await testDashboard(),
        firebase: await testFirebaseFunctions(),
        metrics: await testDashboardMetrics(),
        docker: await testDockerContainer()
    };
    
    console.log('\n📋 Resumo dos Testes de Integração');
    console.log('==================================');
    console.log(`Redis Otimizado: ${results.redis ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`WebSocket Backend: ${results.websocket ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`Dashboard: ${results.dashboard ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`Firebase Functions: ${results.firebase ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`Métricas Dashboard: ${results.metrics ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`Container Docker: ${results.docker ? '✅ PASSOU' : '❌ FALHOU'}`);
    
    const allPassed = Object.values(results).every(result => result);
    
    if (allPassed) {
        console.log('\n🎉 Todos os testes de integração passaram!');
        console.log('✨ Sistema completamente integrado com Redis otimizado');
        console.log('\n🚀 Serviços disponíveis:');
        console.log('   • Redis Otimizado: localhost:6379');
        console.log('   • WebSocket Backend: localhost:3001');
        console.log('   • Dashboard: localhost:3000');
        console.log('   • Firebase Functions: localhost:5001');
        console.log('\n📊 Métricas em tempo real disponíveis no Dashboard');
    } else {
        console.log('\n⚠️ Alguns testes falharam');
        console.log('🔧 Verifique os serviços que não estão rodando');
        
        if (!results.redis) {
            console.log('   • Redis: Execute docker start redis-leaf');
        }
        if (!results.websocket) {
            console.log('   • WebSocket: Execute cd leaf-websocket-backend && node server.js');
        }
        if (!results.dashboard) {
            console.log('   • Dashboard: Execute cd leaf-dashboard && npm start');
        }
        if (!results.firebase) {
            console.log('   • Firebase: Execute firebase emulators:start');
        }
    }
    
    console.log('\n✨ Teste de integração concluído!');
}

// Executar testes
runIntegrationTests().catch(console.error); 