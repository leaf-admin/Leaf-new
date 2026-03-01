const axios = require('axios');
const WebSocket = require('ws');
const { getIntrospectionQuery } = require('graphql');

const BASE_URL = 'http://localhost:3004';
const WS_URL = 'ws://localhost:3004';
const GRAPHQL_URL = `${BASE_URL}/graphql`;
const LOGIN_URL = `${BASE_URL}/auth/login`;
const CACHE_HEALTH_URL = `${BASE_URL}/cache/health`;
const CACHE_STATS_URL = `${BASE_URL}/cache/stats`;

let authToken = '';
let passedTests = 0;
const totalTests = 14;

async function runTest(name, testFunction) {
    process.stdout.write(`${name}... `);
    try {
        const result = await testFunction();
        if (result.passed) {
            console.log('✅ PASSOU');
            passedTests++;
        } else {
            console.log(`❌ FALHOU: ${result.message}`);
        }
    } catch (error) {
        console.log(`❌ FALHOU: ${error.message}`);
    }
}

async function testHealthCheck() {
    try {
        const response = await axios.get(`${BASE_URL}/health`);
        return { passed: response.status === 200 && response.data.status === 'healthy' };
    } catch (error) {
        return { passed: false, message: error.message };
    }
}

async function testMetricsEndpoint() {
    try {
        const response = await axios.get(`${BASE_URL}/metrics`);
        return { passed: response.status === 200 && response.data.performance.memory };
    } catch (error) {
        return { passed: false, message: error.message };
    }
}

async function testStatsEndpoint() {
    try {
        const response = await axios.get(`${BASE_URL}/stats`);
        return { passed: response.status === 200 && response.data.server.status === 'running' };
    } catch (error) {
        return { passed: false, message: error.message };
    }
}

async function testGraphQLIntrospection() {
    try {
        const introspectionQuery = getIntrospectionQuery();
        const response = await axios.post(GRAPHQL_URL, { query: introspectionQuery });
        return { passed: response.status === 200 && response.data.data && response.data.data.__schema };
    } catch (error) {
        return { passed: false, message: error.message };
    }
}

async function testGraphQLUnauthorizedAccess() {
    try {
        const query = `{ financialReport(period: "7d") { totalRevenue } }`;
        const response = await axios.post(GRAPHQL_URL, { query });
        return { passed: response.data.errors && response.data.errors[0].message.includes('Usuário não autenticado') };
    } catch (error) {
        return { passed: false, message: error.message };
    }
}

async function testAuthenticationLogin() {
    try {
        const loginResponse = await axios.post(LOGIN_URL, {
            phone: '+5511999999999',
            password: '123456',
            userType: 'CUSTOMER'
        });
        if (loginResponse.data.success && loginResponse.data.token) {
            authToken = loginResponse.data.token;
            return { passed: true };
        }
        return { passed: false, message: 'Login falhou' };
    } catch (error) {
        return { passed: false, message: `Erro ao fazer login: ${error.message}` };
    }
}

async function testGraphQLAuthorizedAccess() {
    if (!authToken) return { passed: false, message: 'Token de autenticação não disponível' };
    try {
        const query = `{ financialReport(period: "7d") { totalRevenue } }`;
        const response = await axios.post(GRAPHQL_URL, { query }, {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        return { passed: response.data.data && response.data.data.financialReport };
    } catch (error) {
        return { passed: false, message: error.message };
    }
}

async function testWebSocketConnection() {
    return new Promise((resolve) => {
        const ws = new WebSocket(WS_URL);
        ws.onopen = () => {
            ws.close();
            resolve({ passed: true });
        };
        ws.onerror = (err) => {
            resolve({ passed: false, message: err.message });
        };
        ws.onmessage = () => {};
        ws.onclose = () => {};
    });
}

async function testWebSocketAuthentication() {
    if (!authToken) return { passed: false, message: 'Token de autenticação não disponível' };
    return new Promise((resolve) => {
        const ws = new WebSocket(WS_URL);
        ws.onopen = () => {
            ws.send(JSON.stringify({ event: 'authenticate', data: { token: authToken } }));
        };
        ws.onmessage = (event) => {
            const message = JSON.parse(event.data);
            if (message.event === 'authenticated' && message.data.success) {
                ws.close();
                resolve({ passed: true });
            } else if (message.event === 'auth_error') {
                ws.close();
                resolve({ passed: false, message: message.data.message });
            }
        };
        ws.onerror = (err) => {
            resolve({ passed: false, message: err.message });
        };
        ws.onclose = () => {};
    });
}

async function testCacheHealth() {
    try {
        const response = await axios.get(CACHE_HEALTH_URL);
        return { passed: response.status === 200 && response.data.data.status === 'healthy' };
    } catch (error) {
        return { passed: false, message: error.message };
    }
}

async function testCacheStats() {
    try {
        const response = await axios.get(CACHE_STATS_URL);
        return { passed: response.status === 200 && response.data.data.totalKeys !== undefined };
    } catch (error) {
        return { passed: false, message: error.message };
    }
}

async function testPerformance() {
    const numRequests = 10;
    const requests = [];
    const start = Date.now();

    for (let i = 0; i < numRequests; i++) {
        requests.push(axios.get(`${BASE_URL}/health`));
    }

    try {
        await Promise.all(requests);
        const end = Date.now();
        const duration = end - start;
        console.log(`   - ${numRequests} requisições em ${duration}ms`);
        console.log(`   - Média: ${(duration / numRequests).toFixed(2)}ms por requisição`);
        return { passed: true };
    } catch (error) {
        return { passed: false, message: error.message };
    }
}

async function testLoadBalancer() {
    try {
        const responses = await Promise.all([
            axios.get(`${BASE_URL}/health`),
            axios.get(`${BASE_URL}/health`),
            axios.get(`${BASE_URL}/health`)
        ]);
        const instanceIds = new Set(responses.map(res => res.data.instanceId));
        console.log(`   - Instâncias encontradas: ${instanceIds.size}`);
        console.log(`   - IDs: ${Array.from(instanceIds).join(', ')}`);
        return { passed: instanceIds.size > 1, message: `Apenas ${instanceIds.size} instância(s) ativa(s)` };
    } catch (error) {
        return { passed: false, message: error.message };
    }
}

async function testGraphQLMutations() {
    if (!authToken) return { passed: false, message: 'Token de autenticação não disponível' };
    try {
        const mutation = `
            mutation CreateUser($input: CreateUserInput!) {
                createUser(input: $input) {
                    success
                    message
                    user {
                        id
                        name
                    }
                }
            }
        `;
        const variables = {
            input: {
                name: "Test User",
                email: `test${Date.now()}@example.com`,
                phone: `+1${Date.now()}`,
                userType: "CUSTOMER"
            }
        };
        const response = await axios.post(GRAPHQL_URL, { query: mutation, variables }, {
            headers: { Authorization: `Bearer ${authToken}` }
        });
        return { passed: response.data.data && response.data.data.createUser.success };
    } catch (error) {
        return { passed: false, message: error.message };
    }
}

async function runAllTests() {
    console.log('🧪 TESTE PONTA A PONTA COMPLETO - SERVIDOR ULTRA-OTIMIZADO');
    console.log('=========================================================');
    console.log('🔍 Verificando todos os componentes do sistema...\n');

    console.log('🚀 INICIANDO TESTES PONTA A PONTA...\n');

    await runTest('1️⃣ Health Check', testHealthCheck);
    await runTest('2️⃣ Metrics Endpoint', testMetricsEndpoint);
    await runTest('3️⃣ Stats Endpoint', testStatsEndpoint);
    await runTest('4️⃣ GraphQL Introspection', testGraphQLIntrospection);
    await runTest('5️⃣ GraphQL Unauthorized Access', testGraphQLUnauthorizedAccess);
    await runTest('6️⃣ Authentication Login', testAuthenticationLogin);
    await runTest('7️⃣ GraphQL Authorized Access', testGraphQLAuthorizedAccess);
    await runTest('8️⃣ WebSocket Connection', testWebSocketConnection);
    await runTest('9️⃣ WebSocket Authentication', testWebSocketAuthentication);
    await runTest('10️⃣ Cache Health', testCacheHealth);
    await runTest('11️⃣ Cache Stats', testCacheStats);
    await runTest('12️⃣ Performance Test', testPerformance);
    await runTest('13️⃣ Load Balancer', testLoadBalancer);
    await runTest('14️⃣ GraphQL Mutations', testGraphQLMutations);

    console.log('\n📊 RESULTADO FINAL:');
    console.log('==================');
    console.log(`✅ Testes aprovados: ${passedTests}/${totalTests}`);
    console.log(`❌ Testes falharam: ${totalTests - passedTests}/${totalTests}`);
    console.log(`📈 Taxa de sucesso: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

    if (passedTests === totalTests) {
        console.log('\n🎉 SISTEMA 100% FUNCIONAL!');
    } else if (passedTests >= 10) {
        console.log('\n✅ SISTEMA FUNCIONAL COM PEQUENOS AJUSTES');
        console.log('==========================================');
        console.log('✅ Componentes principais funcionando');
        console.log('🔧 Ajustes menores necessários');
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
    console.log(`🔐 Auth Token: ${authToken ? 'Gerado' : 'Não gerado'}`);
    console.log(`⏱️  Tempo total: ${Date.now() - startTestTime}ms`);
}

const startTestTime = Date.now();
runAllTests();



