#!/usr/bin/env node

/**
 * Script para testar as métricas de usuários do Dashboard
 * Testa a API /stats/users e verifica se os dados estão sendo retornados corretamente
 */

const http = require('http');

const API_BASE_URL = 'http://localhost:3001';
const DASHBOARD_URL = 'http://localhost:3000';

console.log('🧪 Testando Métricas de Usuários do Dashboard');
console.log('=============================================\n');

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

// Teste 1: Verificar se a API /stats/users está funcionando
async function testUserStatsAPI() {
    console.log('1️⃣ Testando API /stats/users...');
    
    try {
        const response = await makeRequest(`${API_BASE_URL}/stats/users`);
        
        if (response.status === 200) {
            console.log('✅ API /stats/users está funcionando');
            console.log('📊 Dados retornados:');
            console.log(`   - Total de Customers: ${response.data.stats.totalCustomers}`);
            console.log(`   - Customers Online: ${response.data.stats.customersOnline}`);
            console.log(`   - Total de Drivers: ${response.data.stats.totalDrivers}`);
            console.log(`   - Drivers Online: ${response.data.stats.driversOnline}`);
            console.log(`   - Total de Usuários: ${response.data.stats.totalUsers}`);
            console.log(`   - Usuários Online: ${response.data.stats.onlineUsers}`);
            console.log(`   - Fonte: ${response.data.source}`);
            console.log(`   - Timestamp: ${response.data.timestamp}`);
            
            return true;
        } else {
            console.log(`❌ API retornou status ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Erro ao testar API: ${error.message}`);
        return false;
    }
}

// Teste 2: Verificar se o Dashboard está acessível
async function testDashboardAccess() {
    console.log('\n2️⃣ Testando acesso ao Dashboard...');
    
    try {
        const response = await makeRequest(DASHBOARD_URL);
        
        if (response.status === 200) {
            console.log('✅ Dashboard está acessível');
            return true;
        } else {
            console.log(`❌ Dashboard retornou status ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Erro ao acessar Dashboard: ${error.message}`);
        return false;
    }
}

// Teste 3: Verificar se o WebSocket Backend está funcionando
async function testWebSocketBackend() {
    console.log('\n3️⃣ Testando WebSocket Backend...');
    
    try {
        const response = await makeRequest(`${API_BASE_URL}/health`);
        
        if (response.status === 200) {
            console.log('✅ WebSocket Backend está funcionando');
            return true;
        } else {
            console.log(`❌ WebSocket Backend retornou status ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Erro ao testar WebSocket Backend: ${error.message}`);
        return false;
    }
}

// Teste 4: Verificar métricas gerais
async function testGeneralMetrics() {
    console.log('\n4️⃣ Testando métricas gerais...');
    
    try {
        const response = await makeRequest(`${API_BASE_URL}/metrics`);
        
        if (response.status === 200) {
            console.log('✅ Métricas gerais estão funcionando');
            console.log('📊 Status do sistema:');
            console.log(`   - Status Geral: ${response.data.summary?.status || 'unknown'}`);
            console.log(`   - Alertas Ativos: ${response.data.summary?.totalAlerts || 0}`);
            console.log(`   - Uptime: ${response.data.summary?.uptime || 0} segundos`);
            console.log(`   - Redis Status: ${response.data.redis?.status || 'unknown'}`);
            console.log(`   - Container Status: ${response.data.container?.status || 'unknown'}`);
            
            return true;
        } else {
            console.log(`❌ Métricas gerais retornaram status ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`❌ Erro ao testar métricas gerais: ${error.message}`);
        return false;
    }
}

// Função principal
async function runTests() {
    console.log('🚀 Iniciando testes...\n');
    
    const results = {
        userStatsAPI: await testUserStatsAPI(),
        dashboardAccess: await testDashboardAccess(),
        webSocketBackend: await testWebSocketBackend(),
        generalMetrics: await testGeneralMetrics()
    };
    
    console.log('\n📋 Resumo dos Testes');
    console.log('===================');
    console.log(`API /stats/users: ${results.userStatsAPI ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`Dashboard: ${results.dashboardAccess ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`WebSocket Backend: ${results.webSocketBackend ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`Métricas Gerais: ${results.generalMetrics ? '✅ PASSOU' : '❌ FALHOU'}`);
    
    const allPassed = Object.values(results).every(result => result);
    
    if (allPassed) {
        console.log('\n🎉 Todos os testes passaram!');
        console.log('✅ As métricas de usuários estão funcionando corretamente');
        console.log('🌐 Acesse o Dashboard em: http://localhost:3000');
    } else {
        console.log('\n⚠️ Alguns testes falharam');
        console.log('🔧 Verifique se todos os serviços estão rodando:');
        console.log('   - WebSocket Backend (porta 3001)');
        console.log('   - Dashboard (porta 3000)');
        console.log('   - Redis (porta 6379)');
    }
    
    console.log('\n✨ Teste concluído!');
}

// Executar testes
runTests().catch(console.error); 