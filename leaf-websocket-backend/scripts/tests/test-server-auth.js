#!/usr/bin/env node

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = 3002;

// Middleware básico
app.use(cors());
app.use(express.json());

// Testar importação das rotas
try {
    console.log('🔍 Testando importação das rotas...');
    
    const authRoutes = require('./routes/auth-routes');
    console.log('✅ Rotas de autenticação importadas com sucesso');
    
    app.use('/auth', authRoutes);
    console.log('✅ Rotas de autenticação registradas');
    
} catch (error) {
    console.error('❌ Erro ao importar rotas:', error.message);
    console.error('Stack:', error.stack);
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor de teste rodando na porta ${PORT}`);
    console.log(`🔐 Endpoint de login: http://localhost:${PORT}/auth/login`);
});

// Teste automático
setTimeout(async () => {
    console.log('\n🧪 TESTANDO LOGIN AUTOMATICAMENTE...');
    
    const http = require('http');
    const postData = JSON.stringify({
        phone: '+5511999999999',
        password: '123456',
        userType: 'CUSTOMER'
    });
    
    const options = {
        hostname: 'localhost',
        port: PORT,
        path: '/auth/login',
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData)
        }
    };

    const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
            console.log('📊 Resposta do login:', data);
            process.exit(0);
        });
    });
    
    req.on('error', (error) => {
        console.error('❌ Erro na requisição:', error.message);
        process.exit(1);
    });
    
    req.write(postData);
    req.end();
    
}, 2000);




