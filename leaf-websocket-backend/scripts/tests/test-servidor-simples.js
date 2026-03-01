const axios = require('axios');

const BASE_URL = 'http://localhost:3001';

async function testarServidor() {
    console.log('🧪 TESTE SIMPLES DO SERVIDOR');
    console.log('=============================');
    
    try {
        // 1. Health Check
        console.log('1️⃣ Testando Health Check...');
        const health = await axios.get(`${BASE_URL}/health`);
        console.log('✅ Health:', health.data.status);
        
        // 2. Teste de Login
        console.log('\n2️⃣ Testando Login...');
        try {
            const login = await axios.post(`${BASE_URL}/auth/login`, {
                phone: '+5511999999999',
                password: 'password123'
            });
            console.log('✅ Login:', login.data.success ? 'Sucesso' : 'Falhou');
        } catch (error) {
            console.log('❌ Login:', error.response ? error.response.status : error.message);
        }
        
        // 3. Teste de Cache
        console.log('\n3️⃣ Testando Cache...');
        try {
            const cache = await axios.get(`${BASE_URL}/cache/health`);
            console.log('✅ Cache:', cache.data.status);
        } catch (error) {
            console.log('❌ Cache:', error.response ? error.response.status : error.message);
        }
        
        // 4. Teste GraphQL
        console.log('\n4️⃣ Testando GraphQL...');
        try {
            const graphql = await axios.post(`${BASE_URL}/graphql`, {
                query: '{ __schema { queryType { name } } }'
            });
            console.log('✅ GraphQL:', graphql.data.data ? 'Schema OK' : 'Erro');
        } catch (error) {
            console.log('❌ GraphQL:', error.response ? error.response.status : error.message);
        }
        
    } catch (error) {
        console.log('❌ Erro geral:', error.message);
    }
}

testarServidor();




