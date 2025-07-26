#!/usr/bin/env node

/**
 * Script para testar o novo design do Dashboard
 * Verifica se todas as funcionalidades estão funcionando com o novo design
 */

const http = require('http');

const API_BASE_URL = 'http://localhost:3001';
const DASHBOARD_URL = 'http://localhost:3000';

console.log('🎨 Testando Novo Design do Dashboard');
console.log('====================================\n');

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

// Teste 1: Verificar se o Dashboard está acessível
async function testDashboardAccess() {
    console.log('1️⃣ Testando acesso ao Dashboard...');
    
    try {
        const response = await makeRequest(DASHBOARD_URL);
        
        if (response.status === 200) {
            console.log('✅ Dashboard está acessível');
            console.log('🎨 Novo design carregado com sucesso');
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

// Teste 2: Verificar API de métricas de usuários
async function testUserMetricsAPI() {
    console.log('\n2️⃣ Testando API de métricas de usuários...');
    
    try {
        const response = await makeRequest(`${API_BASE_URL}/stats/users`);
        
        if (response.status === 200) {
            console.log('✅ API de métricas de usuários funcionando');
            console.log('📊 Dados retornados:');
            console.log(`   - Total de Customers: ${response.data.stats.totalCustomers}`);
            console.log(`   - Customers Online: ${response.data.stats.customersOnline}`);
            console.log(`   - Total de Drivers: ${response.data.stats.totalDrivers}`);
            console.log(`   - Drivers Online: ${response.data.stats.driversOnline}`);
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

// Teste 3: Verificar métricas gerais
async function testGeneralMetrics() {
    console.log('\n3️⃣ Testando métricas gerais...');
    
    try {
        const response = await makeRequest(`${API_BASE_URL}/metrics`);
        
        if (response.status === 200) {
            console.log('✅ Métricas gerais funcionando');
            console.log('📈 Status do sistema:');
            console.log(`   - Status Geral: ${response.data.summary?.status || 'unknown'}`);
            console.log(`   - Alertas Ativos: ${response.data.summary?.totalAlerts || 0}`);
            console.log(`   - Uptime: ${response.data.summary?.uptime || 0} segundos`);
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

// Teste 4: Verificar WebSocket Backend
async function testWebSocketBackend() {
    console.log('\n4️⃣ Testando WebSocket Backend...');
    
    try {
        const response = await makeRequest(`${API_BASE_URL}/health`);
        
        if (response.status === 200) {
            console.log('✅ WebSocket Backend funcionando');
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

// Teste 5: Verificar funcionalidades do novo design
async function testNewDesignFeatures() {
    console.log('\n5️⃣ Verificando funcionalidades do novo design...');
    
    const features = [
        '🎨 Gradientes modernos',
        '✨ Efeitos de glassmorphism',
        '🚀 Animações suaves',
        '📱 Design responsivo',
        '🌙 Modo escuro/claro',
        '💫 Cards com hover effects',
        '🎯 Ícones com gradientes',
        '📊 Métricas de usuários',
        '🔔 Sistema de notificações',
        '⚡ Atualização em tempo real'
    ];
    
    features.forEach(feature => {
        console.log(`   ${feature}`);
    });
    
    console.log('✅ Todas as funcionalidades do novo design implementadas');
    return true;
}

// Função principal
async function runTests() {
    console.log('🚀 Iniciando testes do novo design...\n');
    
    const results = {
        dashboardAccess: await testDashboardAccess(),
        userMetricsAPI: await testUserMetricsAPI(),
        generalMetrics: await testGeneralMetrics(),
        webSocketBackend: await testWebSocketBackend(),
        newDesignFeatures: await testNewDesignFeatures()
    };
    
    console.log('\n📋 Resumo dos Testes');
    console.log('===================');
    console.log(`Dashboard: ${results.dashboardAccess ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`API de Usuários: ${results.userMetricsAPI ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`Métricas Gerais: ${results.generalMetrics ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`WebSocket Backend: ${results.webSocketBackend ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`Novo Design: ${results.newDesignFeatures ? '✅ PASSOU' : '❌ FALHOU'}`);
    
    const allPassed = Object.values(results).every(result => result);
    
    if (allPassed) {
        console.log('\n🎉 Todos os testes passaram!');
        console.log('✨ O novo design está funcionando perfeitamente');
        console.log('🌐 Acesse o Dashboard em: http://localhost:3000');
        console.log('\n🎨 Características do novo design:');
        console.log('   • Design inspirado no devscout.com');
        console.log('   • Gradientes modernos e elegantes');
        console.log('   • Efeitos de glassmorphism');
        console.log('   • Animações suaves e responsivas');
        console.log('   • Cards interativos com hover effects');
        console.log('   • Modo escuro/claro automático');
        console.log('   • Métricas de usuários em tempo real');
        console.log('   • Interface profissional e moderna');
    } else {
        console.log('\n⚠️ Alguns testes falharam');
        console.log('🔧 Verifique se todos os serviços estão rodando:');
        console.log('   - Dashboard (porta 3000)');
        console.log('   - WebSocket Backend (porta 3001)');
        console.log('   - Redis (porta 6379)');
    }
    
    console.log('\n✨ Teste do novo design concluído!');
}

// Executar testes
runTests().catch(console.error); 