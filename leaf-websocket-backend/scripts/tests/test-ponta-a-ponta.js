#!/usr/bin/env node

const http = require('http');
const { io } = require('socket.io-client');
const axios = require('axios');

console.log('🧪 TESTE PONTA A PONTA COMPLETO - LEAF APP');
console.log('==========================================');
console.log('🔍 Verificando todos os componentes do sistema...\n');

// Configurações
const BASE_URL = 'http://localhost:3001';
const WS_URL = 'ws://localhost:3001';

// Contadores de testes
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

// Função para executar teste
async function runTest(testName, testFunction) {
    totalTests++;
    console.log(`\n${totalTests}️⃣ ${testName}...`);
    
    try {
        const result = await testFunction();
        if (result) {
            console.log(`✅ ${testName}: PASSOU`);
            passedTests++;
        } else {
            console.log(`❌ ${testName}: FALHOU`);
            failedTests++;
        }
        return result;
    } catch (error) {
        console.log(`❌ ${testName}: ERRO - ${error.message}`);
        failedTests++;
        return false;
    }
}

// Teste 1: Health Check
async function testHealthCheck() {
    try {
        const response = await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
        return response.status === 200 && response.data.status === 'healthy';
    } catch (error) {
        return false;
    }
}

// Teste 2: Metrics Endpoint
async function testMetrics() {
    try {
        const response = await axios.get(`${BASE_URL}/metrics`, { timeout: 5000 });
        return response.status === 200 && response.data.graphql && response.data.graphql.enabled;
    } catch (error) {
        return false;
    }
}

// Teste 3: Stats Endpoint
async function testStats() {
    try {
        const response = await axios.get(`${BASE_URL}/stats`, { timeout: 5000 });
        return response.status === 200 && response.data.server && response.data.server.status === 'running';
    } catch (error) {
        return false;
    }
}

// Teste 4: GraphQL Introspection
async function testGraphQLIntrospection() {
    try {
        const introspectionQuery = {
            query: `query IntrospectionQuery {
                __schema {
                    queryType { name }
                    mutationType { name }
                    subscriptionType { name }
                    types {
                        name
                        kind
                    }
                }
            }`
        };
        
        const response = await axios.post(`${BASE_URL}/graphql`, introspectionQuery, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000
        });
        
        return response.status === 200 && response.data.data && response.data.data.__schema;
    } catch (error) {
        return false;
    }
}

// Teste 5: GraphQL Query (sem autenticação - deve falhar)
async function testGraphQLUnauthorized() {
    try {
        const query = {
            query: `query {
                financialReport(period: "30d") {
                    period
                    totalRevenue
                }
            }`
        };
        
        const response = await axios.post(`${BASE_URL}/graphql`, query, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        });
        
        // Deve retornar erro de autenticação
        return response.data.errors && response.data.errors[0].message.includes('não autenticado');
    } catch (error) {
        return false;
    }
}

// Teste 6: Autenticação - Login
async function testAuthentication() {
    try {
        const loginData = {
            phone: '+5511777777777',
            password: '123456',
            userType: 'ADMIN'
        };
        
        const response = await axios.post(`${BASE_URL}/auth/login`, loginData, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        });
        
        if (response.status === 200 && response.data.success && response.data.token) {
            // Armazenar token para próximos testes
            global.authToken = response.data.token;
            return true;
        }
        return false;
    } catch (error) {
        return false;
    }
}

// Teste 7: GraphQL Query (com autenticação)
async function testGraphQLAuthorized() {
    if (!global.authToken) return false;
    
    try {
        const query = {
            query: `query {
                financialReport(period: "30d") {
                    period
                    totalRevenue
                    totalCosts
                    profitMargin
                }
            }`
        };
        
        const response = await axios.post(`${BASE_URL}/graphql`, query, {
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${global.authToken}`
            },
            timeout: 10000
        });
        
        return response.status === 200 && response.data.data && response.data.data.financialReport;
    } catch (error) {
        return false;
    }
}

// Teste 8: WebSocket Connection
async function testWebSocketConnection() {
    return new Promise((resolve) => {
        const socket = io(WS_URL, {
            transports: ['websocket'],
            timeout: 5000
        });

        socket.on('connect', () => {
            console.log('   - WebSocket conectado com sucesso');
            socket.disconnect();
            resolve(true);
        });

        socket.on('connect_error', (error) => {
            console.log(`   - Erro de conexão WebSocket: ${error.message}`);
            resolve(false);
        });

        setTimeout(() => {
            console.log('   - Timeout de conexão WebSocket');
            socket.disconnect();
            resolve(false);
        }, 5000);
    });
}

// Teste 9: WebSocket com Autenticação
async function testWebSocketAuth() {
    if (!global.authToken) return false;
    
    return new Promise((resolve) => {
        const socket = io(WS_URL, {
            transports: ['polling', 'websocket'],
            timeout: 5000
        });

        socket.on('connect', () => {
            console.log('   - WebSocket conectado, testando autenticação');
            socket.emit('authenticate', { token: global.authToken });
        });

        socket.on('authenticated', (data) => {
            console.log('   - WebSocket autenticado com sucesso');
            socket.disconnect();
            resolve(true);
        });

        socket.on('auth_error', (error) => {
            console.log(`   - Erro WebSocket auth: ${error.message}`);
            socket.disconnect();
            resolve(false);
        });

        socket.on('connect_error', (error) => {
            console.log(`   - Erro WebSocket conexão: ${error.message}`);
            resolve(false);
        });

        setTimeout(() => {
            console.log('   - Timeout WebSocket auth');
            socket.disconnect();
            resolve(false);
        }, 5000);
    });
}

// Teste 10: Cache Health
async function testCacheHealth() {
    try {
        const response = await axios.get(`${BASE_URL}/cache/health`, { timeout: 5000 });
        return response.status === 200 && response.data.status === 'healthy';
    } catch (error) {
        return false;
    }
}

// Teste 11: Cache Stats
async function testCacheStats() {
    try {
        const response = await axios.get(`${BASE_URL}/cache/stats`, { timeout: 5000 });
        return response.status === 200 && response.data.hits !== undefined;
    } catch (error) {
        return false;
    }
}

// Teste 12: Performance Test
async function testPerformance() {
    const startTime = Date.now();
    const requests = [];
    
    // Fazer 10 requisições simultâneas
    for (let i = 0; i < 10; i++) {
        requests.push(
            axios.get(`${BASE_URL}/health`, { timeout: 5000 })
        );
    }
    
    try {
        await Promise.all(requests);
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        console.log(`   - 10 requisições em ${duration}ms`);
        console.log(`   - Média: ${(duration/10).toFixed(2)}ms por requisição`);
        
        return duration < 5000; // Menos de 5 segundos
    } catch (error) {
        return false;
    }
}

// Teste 13: GraphQL Mutations
async function testGraphQLMutations() {
    if (!global.authToken) return false;
    
    try {
        const mutation = {
            query: `mutation {
                createUser(input: {
                    name: "Teste Usuário"
                    email: "teste@leaf.com"
                    phone: "+5511999999998"
                    userType: CUSTOMER
                }) {
                    success
                    message
                    user {
                        id
                        name
                        email
                    }
                }
            }`
        };
        
        const response = await axios.post(`${BASE_URL}/graphql`, mutation, {
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${global.authToken}`
            },
            timeout: 10000
        });
        
        return response.status === 200 && response.data.data;
    } catch (error) {
        return false;
    }
}

// Teste 14: Load Balancer (se aplicável)
async function testLoadBalancer() {
    try {
        const responses = [];
        
        // Fazer várias requisições para verificar distribuição
        for (let i = 0; i < 5; i++) {
            const response = await axios.get(`${BASE_URL}/health`, { timeout: 5000 });
            responses.push(response.data.instanceId);
        }
        
        // Verificar se há diferentes instâncias (load balancing)
        const uniqueInstances = [...new Set(responses)];
        console.log(`   - Instâncias encontradas: ${uniqueInstances.length}`);
        console.log(`   - IDs: ${uniqueInstances.join(', ')}`);
        
        return uniqueInstances.length >= 1; // Pelo menos 1 instância ativa
    } catch (error) {
        return false;
    }
}

// Executar todos os testes
async function runAllTests() {
    console.log('🚀 INICIANDO TESTES PONTA A PONTA...\n');
    
    // Testes básicos
    await runTest('Health Check', testHealthCheck);
    await runTest('Metrics Endpoint', testMetrics);
    await runTest('Stats Endpoint', testStats);
    
    // Testes GraphQL
    await runTest('GraphQL Introspection', testGraphQLIntrospection);
    await runTest('GraphQL Unauthorized Access', testGraphQLUnauthorized);
    
    // Testes de Autenticação
    await runTest('Authentication Login', testAuthentication);
    await runTest('GraphQL Authorized Access', testGraphQLAuthorized);
    
    // Testes WebSocket
    await runTest('WebSocket Connection', testWebSocketConnection);
    await runTest('WebSocket Authentication', testWebSocketAuth);
    
    // Testes de Cache
    await runTest('Cache Health', testCacheHealth);
    await runTest('Cache Stats', testCacheStats);
    
    // Testes de Performance
    await runTest('Performance Test', testPerformance);
    await runTest('Load Balancer', testLoadBalancer);
    
    // Testes GraphQL Avançados
    await runTest('GraphQL Mutations', testGraphQLMutations);
    
    // Resultado final
    console.log('\n📊 RESULTADO FINAL:');
    console.log('==================');
    console.log(`✅ Testes aprovados: ${passedTests}/${totalTests}`);
    console.log(`❌ Testes falharam: ${failedTests}/${totalTests}`);
    console.log(`📈 Taxa de sucesso: ${((passedTests/totalTests)*100).toFixed(1)}%`);
    
    if (passedTests === totalTests) {
        console.log('\n🎉 SISTEMA 100% FUNCIONAL!');
        console.log('==========================');
        console.log('✅ Todos os componentes estão operacionais');
        console.log('✅ Autenticação funcionando');
        console.log('✅ GraphQL operacional');
        console.log('✅ WebSocket conectando');
        console.log('✅ Cache ativo');
        console.log('✅ Performance adequada');
        console.log('\n🚀 Sistema pronto para produção!');
    } else if (passedTests >= totalTests * 0.8) {
        console.log('\n⚠️  SISTEMA MAJORITARIAMENTE FUNCIONAL');
        console.log('=====================================');
        console.log('✅ Maioria dos componentes operacionais');
        console.log('⚠️  Alguns ajustes podem ser necessários');
        console.log('\n🔧 Pontos de atenção:');
        
        if (failedTests > 0) {
            console.log('   - Verificar logs de erro acima');
            console.log('   - Revisar configurações de rede');
            console.log('   - Validar credenciais de serviço');
        }
    } else {
        console.log('\n❌ SISTEMA COM PROBLEMAS CRÍTICOS');
        console.log('=================================');
        console.log('❌ Muitos componentes com falha');
        console.log('🔧 Ação necessária:');
        console.log('   - Verificar logs do servidor');
        console.log('   - Validar configurações');
        console.log('   - Reiniciar serviços');
        console.log('   - Verificar conectividade');
    }
    
    console.log('\n📋 RESUMO TÉCNICO:');
    console.log('==================');
    console.log(`🔗 Base URL: ${BASE_URL}`);
    console.log(`🔌 WebSocket: ${WS_URL}`);
    console.log(`🔐 Auth Token: ${global.authToken ? 'Gerado' : 'Não gerado'}`);
    console.log(`⏱️  Tempo total: ${Date.now() - startTime}ms`);
    
    process.exit(passedTests === totalTests ? 0 : 1);
}

// Iniciar testes
const startTime = Date.now();
runAllTests().catch(console.error);

