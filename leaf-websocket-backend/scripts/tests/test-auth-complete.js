#!/usr/bin/env node

const http = require('http');
const { io } = require('socket.io-client');

console.log('🔐 TESTE COMPLETO DE AUTENTICAÇÃO GRAPHQL');
console.log('=========================================');

// Teste 1: Login e geração de token
async function testLogin() {
    return new Promise((resolve) => {
        const postData = JSON.stringify({
            phone: '+5511999999999',
            password: '123456',
            userType: 'CUSTOMER'
        });
        
        const options = {
            hostname: 'localhost',
            port: 3001,
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
                try {
                    const result = JSON.parse(data);
                    if (result.success && result.token) {
                        console.log('✅ Login: Token gerado com sucesso');
                        console.log('   - Usuário:', result.user.name);
                        console.log('   - Tipo:', result.user.userType);
                        resolve(result.token);
                    } else {
                        console.log('❌ Login: Falha na autenticação');
                        resolve(null);
                    }
                } catch (e) {
                    console.log('❌ Login: Erro ao parsear resposta');
                    resolve(null);
                }
            });
        });
        
        req.on('error', () => {
            console.log('❌ Login: Erro de conexão');
            resolve(null);
        });
        
        req.setTimeout(5000, () => {
            console.log('❌ Login: Timeout');
            resolve(null);
        });
        
        req.write(postData);
        req.end();
    });
}

// Teste 2: Verificar token
async function testTokenVerification(token) {
    return new Promise((resolve) => {
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: '/auth/verify',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.success && result.valid) {
                        console.log('✅ Verificação: Token válido');
                        console.log('   - Usuário ID:', result.user.userId);
                        console.log('   - Tipo:', result.user.userType);
                        resolve(true);
                    } else {
                        console.log('❌ Verificação: Token inválido');
                        resolve(false);
                    }
                } catch (e) {
                    console.log('❌ Verificação: Erro ao parsear resposta');
                    resolve(false);
                }
            });
        });
        
        req.on('error', () => {
            console.log('❌ Verificação: Erro de conexão');
            resolve(false);
        });
        
        req.setTimeout(5000, () => {
            console.log('❌ Verificação: Timeout');
            resolve(false);
        });
        
        req.end();
    });
}

// Teste 3: GraphQL com autenticação
async function testGraphQLWithAuth(token) {
    return new Promise((resolve) => {
        const postData = JSON.stringify({
            query: `query {
                financialReport(period: "30d") {
                    period
                    totalRevenue
                    totalCosts
                    profitMargin
                }
            }`
        });
        
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: '/graphql',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Content-Length': Buffer.byteLength(postData)
            }
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const result = JSON.parse(data);
                    if (result.data && result.data.financialReport) {
                        console.log('✅ GraphQL Auth: Query executada com sucesso');
                        console.log('   - Período:', result.data.financialReport.period);
                        console.log('   - Receita:', result.data.financialReport.totalRevenue);
                        resolve(true);
                    } else if (result.errors) {
                        console.log('❌ GraphQL Auth: Erro na query');
                        console.log('   - Erro:', result.errors[0].message);
                        resolve(false);
                    } else {
                        console.log('❌ GraphQL Auth: Resposta inesperada');
                        resolve(false);
                    }
                } catch (e) {
                    console.log('❌ GraphQL Auth: Erro ao parsear resposta');
                    resolve(false);
                }
            });
        });
        
        req.on('error', () => {
            console.log('❌ GraphQL Auth: Erro de conexão');
            resolve(false);
        });
        
        req.setTimeout(5000, () => {
            console.log('❌ GraphQL Auth: Timeout');
            resolve(false);
        });
        
        req.write(postData);
        req.end();
    });
}

// Teste 4: GraphQL sem autenticação (deve falhar)
async function testGraphQLWithoutAuth() {
    return new Promise((resolve) => {
        const postData = JSON.stringify({
            query: `query {
                financialReport(period: "30d") {
                    period
                    totalRevenue
                }
            }`
        });
        
        const options = {
            hostname: 'localhost',
            port: 3001,
            path: '/graphql',
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
                try {
                    const result = JSON.parse(data);
                    if (result.errors && result.errors[0].message.includes('não autenticado')) {
                        console.log('✅ GraphQL No Auth: Acesso negado corretamente');
                        resolve(true);
                    } else {
                        console.log('❌ GraphQL No Auth: Deveria ter negado acesso');
                        resolve(false);
                    }
                } catch (e) {
                    console.log('❌ GraphQL No Auth: Erro ao parsear resposta');
                    resolve(false);
                }
            });
        });
        
        req.on('error', () => {
            console.log('❌ GraphQL No Auth: Erro de conexão');
            resolve(false);
        });
        
        req.setTimeout(5000, () => {
            console.log('❌ GraphQL No Auth: Timeout');
            resolve(false);
        });
        
        req.write(postData);
        req.end();
    });
}

// Teste 5: WebSocket com autenticação
async function testWebSocketAuth(token) {
    return new Promise((resolve) => {
        const socket = io('http://localhost:3001', {
            transports: ['websocket'],
            timeout: 5000,
            auth: {
                token: token
            }
        });

        socket.on('connect', () => {
            console.log('✅ WebSocket Auth: Conectado com token');
            socket.disconnect();
            resolve(true);
        });

        socket.on('connect_error', (error) => {
            console.log('❌ WebSocket Auth: Erro de conexão:', error.message);
            resolve(false);
        });

        socket.on('disconnect', () => {
            // Conexão fechada normalmente
        });

        setTimeout(() => {
            console.log('❌ WebSocket Auth: Timeout de conexão');
            socket.disconnect();
            resolve(false);
        }, 5000);
    });
}

// Executar todos os testes
async function runAllTests() {
    console.log('\n🔍 EXECUTANDO TESTES DE AUTENTICAÇÃO...\n');
    
    // Teste 1: Login
    console.log('1️⃣ Testando Login...');
    const token = await testLogin();
    
    if (!token) {
        console.log('\n❌ FALHA CRÍTICA: Não foi possível obter token');
        process.exit(1);
    }
    
    // Teste 2: Verificação de token
    console.log('\n2️⃣ Testando Verificação de Token...');
    const tokenValid = await testTokenVerification(token);
    
    // Teste 3: GraphQL com autenticação
    console.log('\n3️⃣ Testando GraphQL com Autenticação...');
    const graphqlAuth = await testGraphQLWithAuth(token);
    
    // Teste 4: GraphQL sem autenticação
    console.log('\n4️⃣ Testando GraphQL sem Autenticação...');
    const graphqlNoAuth = await testGraphQLWithoutAuth();
    
    // Teste 5: WebSocket com autenticação
    console.log('\n5️⃣ Testando WebSocket com Autenticação...');
    const websocketAuth = await testWebSocketAuth(token);
    
    // Resultado final
    const results = [tokenValid, graphqlAuth, graphqlNoAuth, websocketAuth];
    const passed = results.filter(r => r).length;
    const total = results.length;
    
    console.log('\n📊 RESULTADO FINAL:');
    console.log('==================');
    console.log(`✅ Testes aprovados: ${passed}/${total}`);
    console.log(`📈 Taxa de sucesso: ${((passed/total)*100).toFixed(1)}%`);
    
    if (passed === total) {
        console.log('\n🎉 MIDDLEWARE DE AUTENTICAÇÃO: SUCESSO TOTAL!');
        console.log('=============================================');
        console.log('✅ Login e geração de token JWT');
        console.log('✅ Verificação de token');
        console.log('✅ GraphQL com autenticação');
        console.log('✅ Proteção contra acesso não autorizado');
        console.log('✅ WebSocket com autenticação');
        console.log('\n🔐 Sistema de autenticação completo e funcional!');
    } else {
        console.log('\n⚠️  MIDDLEWARE PARCIALMENTE FUNCIONAL');
        console.log('=====================================');
        console.log('Alguns testes falharam. Verifique os logs acima.');
    }
    
    process.exit(passed === total ? 0 : 1);
}

runAllTests().catch(console.error);




