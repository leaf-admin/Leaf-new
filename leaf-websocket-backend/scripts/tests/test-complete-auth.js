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
        auth: 'enabled'
    });
});

// Testar importação e registro das rotas
console.log('🔍 Testando importação das rotas...');

try {
    const authRoutes = require('./routes/auth-routes');
    console.log('✅ Rotas de autenticação importadas');
    
    app.use('/auth', authRoutes);
    console.log('✅ Rotas de autenticação registradas');
    
} catch (error) {
    console.error('❌ Erro ao importar rotas:', error.message);
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
const PORT = 3004;
server.listen(PORT, () => {
    console.log(`🚀 Servidor de teste rodando na porta ${PORT}`);
    console.log(`🔐 Login: http://localhost:${PORT}/auth/login`);
    console.log(`📊 GraphQL: http://localhost:${PORT}/graphql`);
    console.log(`❤️ Health: http://localhost:${PORT}/health`);
});

// Teste automático após 3 segundos
setTimeout(async () => {
    console.log('\n🧪 TESTE AUTOMÁTICO...');
    
    // Teste 1: Health
    const healthReq = http.get(`http://localhost:${PORT}/health`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log('✅ Health check:', JSON.parse(data).status);
        });
    });
    
    // Teste 2: Login
    setTimeout(() => {
        const loginData = JSON.stringify({
            phone: '+5511999999999',
            password: '123456',
            userType: 'CUSTOMER'
        });
        
        const loginReq = http.request({
            hostname: 'localhost',
            port: PORT,
            path: '/auth/login',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(loginData)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.success) {
                        console.log('✅ Login:', result.user.name);
                        console.log('✅ Token gerado');
                        
                        // Teste 3: GraphQL com token
                        setTimeout(() => {
                            const graphqlData = JSON.stringify({
                                query: '{ __schema { queryType { name } } }'
                            });
                            
                            const graphqlReq = http.request({
                                hostname: 'localhost',
                                port: PORT,
                                path: '/graphql',
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${result.token}`,
                                    'Content-Length': Buffer.byteLength(graphqlData)
                                }
                            }, (res) => {
                                let data = '';
                                res.on('data', chunk => data += chunk);
                                res.on('end', () => {
                                    try {
                                        const result = JSON.parse(data);
                                        if (result.data) {
                                            console.log('✅ GraphQL: Schema acessível');
                                        } else {
                                            console.log('❌ GraphQL: Erro na query');
                                        }
                                    } catch (e) {
                                        console.log('❌ GraphQL: Erro ao parsear');
                                    }
                                    
                                    console.log('\n🎉 TESTE COMPLETO FINALIZADO!');
                                    process.exit(0);
                                });
                            });
                            
                            graphqlReq.write(graphqlData);
                            graphqlReq.end();
                        }, 1000);
                    } else {
                        console.log('❌ Login falhou');
                        process.exit(1);
                    }
                } catch (e) {
                    console.log('❌ Erro ao parsear login:', e.message);
                    process.exit(1);
                }
            });
        });
        
        loginReq.write(loginData);
        loginReq.end();
    }, 1000);
    
}, 3000);




