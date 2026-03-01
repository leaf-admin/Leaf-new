#!/usr/bin/env node

const express = require('express');
const http = require('http');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Middleware básico
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        version: 'test-server'
    });
});

// Testar importação das rotas
console.log('🔍 Testando importação das rotas...');

try {
    const authRoutes = require('./routes/auth-routes');
    console.log('✅ Rotas de autenticação importadas');
    
    app.use('/auth', authRoutes);
    console.log('✅ Rotas de autenticação registradas');
    
} catch (error) {
    console.error('❌ Erro ao importar rotas de auth:', error.message);
}

try {
    const cacheMonitoring = require('./routes/cache-monitoring');
    console.log('✅ Rotas de cache importadas');
    
    app.use('/cache', cacheMonitoring);
    console.log('✅ Rotas de cache registradas');
    
} catch (error) {
    console.error('❌ Erro ao importar rotas de cache:', error.message);
}

// Testar GraphQL
console.log('🔍 Testando GraphQL...');

try {
    const { applyMiddleware } = require('./graphql/server');
    console.log('✅ GraphQL importado');
    
    // Aplicar GraphQL
    applyMiddleware(app).then(() => {
        console.log('✅ GraphQL aplicado com sucesso');
    }).catch(error => {
        console.error('❌ Erro ao aplicar GraphQL:', error.message);
    });
    
} catch (error) {
    console.error('❌ Erro ao importar GraphQL:', error.message);
}

// Iniciar servidor
const PORT = 3005;
server.listen(PORT, () => {
    console.log(`🚀 Servidor de teste rodando na porta ${PORT}`);
    console.log(`🔐 Login: http://localhost:${PORT}/auth/login`);
    console.log(`📊 GraphQL: http://localhost:${PORT}/graphql`);
    console.log(`❤️ Health: http://localhost:${PORT}/health`);
    console.log(`💾 Cache: http://localhost:${PORT}/cache/health`);
});

// Teste automático após 3 segundos
setTimeout(async () => {
    console.log('\n🧪 TESTE AUTOMÁTICO...');
    
    const axios = require('axios');
    
    // Teste 1: Health
    try {
        const healthRes = await axios.get(`http://localhost:${PORT}/health`);
        console.log('✅ Health check:', healthRes.data.status);
    } catch (error) {
        console.log('❌ Health check falhou:', error.message);
    }
    
    // Teste 2: Login
    try {
        const loginRes = await axios.post(`http://localhost:${PORT}/auth/login`, {
            phone: '+5511999999999',
            password: '123456',
            userType: 'CUSTOMER'
        });
        console.log('✅ Login:', loginRes.data.success ? 'Sucesso' : 'Falhou');
    } catch (error) {
        console.log('❌ Login falhou:', error.message);
    }
    
    // Teste 3: Cache Health
    try {
        const cacheRes = await axios.get(`http://localhost:${PORT}/cache/health`);
        console.log('✅ Cache health:', cacheRes.data.status);
    } catch (error) {
        console.log('❌ Cache health falhou:', error.message);
    }
    
    // Teste 4: GraphQL Introspection
    try {
        const graphqlRes = await axios.post(`http://localhost:${PORT}/graphql`, {
            query: '{ __schema { queryType { name } } }'
        });
        console.log('✅ GraphQL:', graphqlRes.data.data ? 'Funcionando' : 'Erro');
    } catch (error) {
        console.log('❌ GraphQL falhou:', error.message);
    }
    
    console.log('\n🎯 TESTE CONCLUÍDO!');
    process.exit(0);
    
}, 3000);