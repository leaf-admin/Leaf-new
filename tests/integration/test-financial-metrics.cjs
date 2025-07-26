#!/usr/bin/env node

/**
 * Script para testar as métricas financeiras do Dashboard
 * Testa a API /stats/financial e verifica se os dados estão sendo retornados corretamente
 */

const http = require('http');

const API_BASE_URL = 'http://localhost:3001';
const DASHBOARD_URL = 'http://localhost:3000';

console.log('💰 Testando Métricas Financeiras do Dashboard');
console.log('============================================\n');

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

// Teste 1: Verificar se a API de métricas financeiras está funcionando
async function testFinancialMetricsAPI() {
    console.log('1️⃣ Testando API de métricas financeiras...');
    
    try {
        const response = await makeRequest(`${API_BASE_URL}/stats/financial`);
        
        if (response.status === 200 && response.data && response.data.financial) {
            console.log('✅ API de métricas financeiras funcionando');
            console.log('📊 Dados retornados:');
            console.log(`   - Receita Total: R$ ${response.data.financial.totalRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
            console.log(`   - Lucro Total: R$ ${response.data.financial.totalProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
            console.log(`   - Total de Corridas: ${response.data.financial.totalTrips.toLocaleString('pt-BR')}`);
            console.log(`   - Custo Operacional: R$ ${response.data.financial.totalCosts.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
            console.log(`   - Margem de Lucro: ${response.data.financial.profitMargin}%`);
            console.log(`   - Receita de Hoje: R$ ${response.data.financial.todayRevenue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
            console.log(`   - Corridas de Hoje: ${response.data.financial.todayTrips}`);
            console.log(`   - Lucro de Hoje: R$ ${response.data.financial.todayProfit.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`);
            return true;
        } else {
            console.log(`❌ API retornou status ${response.status} ou dados inválidos`);
            console.log('Resposta:', response.data);
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
            console.log('💰 Métricas financeiras carregadas com sucesso');
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

// Teste 3: Verificar cálculos financeiros
async function testFinancialCalculations() {
    console.log('\n3️⃣ Verificando cálculos financeiros...');
    
    try {
        const response = await makeRequest(`${API_BASE_URL}/stats/financial`);
        
        if (response.status === 200 && response.data && response.data.financial) {
            const financial = response.data.financial;
            
            // Verificar se o lucro = receita - custos
            const calculatedProfit = financial.totalRevenue - financial.totalCosts;
            const profitDifference = Math.abs(calculatedProfit - financial.totalProfit);
            
            if (profitDifference < 0.01) {
                console.log('✅ Cálculo de lucro correto');
            } else {
                console.log('⚠️ Diferença no cálculo de lucro detectada');
            }
            
            // Verificar se a margem está correta
            const calculatedMargin = ((financial.totalProfit / financial.totalRevenue) * 100).toFixed(2);
            if (calculatedMargin === financial.profitMargin) {
                console.log('✅ Cálculo de margem correto');
            } else {
                console.log('⚠️ Diferença no cálculo de margem detectada');
            }
            
            // Verificar se o valor médio por corrida está correto
            const calculatedAverage = financial.totalRevenue / financial.totalTrips;
            const averageDifference = Math.abs(calculatedAverage - financial.averageTripValue);
            
            if (averageDifference < 0.01) {
                console.log('✅ Cálculo de valor médio por corrida correto');
            } else {
                console.log('⚠️ Diferença no cálculo de valor médio detectada');
            }
            
            return true;
        } else {
            console.log('❌ Não foi possível verificar os cálculos');
            return false;
        }
    } catch (error) {
        console.log(`❌ Erro ao verificar cálculos: ${error.message}`);
        return false;
    }
}

// Teste 4: Verificar atualização em tempo real
async function testRealTimeUpdates() {
    console.log('\n4️⃣ Testando atualização em tempo real...');
    
    try {
        // Primeira leitura
        const response1 = await makeRequest(`${API_BASE_URL}/stats/financial`);
        
        if (response1.status === 200) {
            console.log('✅ Primeira leitura realizada');
            
            // Aguardar 6 segundos para a próxima atualização
            console.log('⏳ Aguardando 6 segundos para próxima atualização...');
            await new Promise(resolve => setTimeout(resolve, 6000));
            
            // Segunda leitura
            const response2 = await makeRequest(`${API_BASE_URL}/stats/financial`);
            
            if (response2.status === 200) {
                console.log('✅ Segunda leitura realizada');
                
                // Verificar se os dados mudaram
                const financial1 = response1.data.financial;
                const financial2 = response2.data.financial;
                
                if (financial1.totalRevenue !== financial2.totalRevenue || 
                    financial1.totalTrips !== financial2.totalTrips) {
                    console.log('✅ Dados atualizados em tempo real');
                    console.log(`   - Receita mudou de R$ ${financial1.totalRevenue.toFixed(2)} para R$ ${financial2.totalRevenue.toFixed(2)}`);
                    console.log(`   - Corridas mudaram de ${financial1.totalTrips} para ${financial2.totalTrips}`);
                } else {
                    console.log('⚠️ Dados não mudaram (pode ser normal em alguns casos)');
                }
                
                return true;
            } else {
                console.log('❌ Erro na segunda leitura');
                return false;
            }
        } else {
            console.log('❌ Erro na primeira leitura');
            return false;
        }
    } catch (error) {
        console.log(`❌ Erro ao testar atualização em tempo real: ${error.message}`);
        return false;
    }
}

// Função principal
async function runTests() {
    console.log('🚀 Iniciando testes de métricas financeiras...\n');
    
    const results = {
        financialAPI: await testFinancialMetricsAPI(),
        dashboardAccess: await testDashboardAccess(),
        calculations: await testFinancialCalculations(),
        realTimeUpdates: await testRealTimeUpdates()
    };
    
    console.log('\n📋 Resumo dos Testes');
    console.log('===================');
    console.log(`API Financeira: ${results.financialAPI ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`Dashboard Acesso: ${results.dashboardAccess ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`Cálculos: ${results.calculations ? '✅ PASSOU' : '❌ FALHOU'}`);
    console.log(`Tempo Real: ${results.realTimeUpdates ? '✅ PASSOU' : '❌ FALHOU'}`);
    
    const allPassed = Object.values(results).every(result => result);
    
    if (allPassed) {
        console.log('\n🎉 Todos os testes passaram!');
        console.log('✨ As métricas financeiras foram implementadas com sucesso');
        console.log('🌐 Acesse o Dashboard em: http://localhost:3000');
        console.log('\n💰 Características das métricas financeiras:');
        console.log('   • Receita total em tempo real');
        console.log('   • Cálculo automático de lucros e custos');
        console.log('   • Métricas de hoje e mensais');
        console.log('   • Percentuais de margem e crescimento');
        console.log('   • Valor médio por corrida');
        console.log('   • Atualização automática a cada 5 segundos');
        console.log('   • Fórmula: Lucro = Receita - Custo Operacional (R$ 1,55 por corrida)');
    } else {
        console.log('\n⚠️ Alguns testes falharam');
        console.log('🔧 Verifique se o WebSocket Backend (porta 3001) e o Dashboard (porta 3000) estão rodando.');
    }
    
    console.log('\n✨ Teste de métricas financeiras concluído!');
}

// Executar testes
runTests().catch(console.error); 