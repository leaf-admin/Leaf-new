#!/usr/bin/env node

// 🔍 DIAGNÓSTICO DETALHADO WOOVI/OPENPIX - LEAF APP
const axios = require('axios');

async function diagnoseWoovi() {
    console.log('🔍 DIAGNÓSTICO DETALHADO WOOVI/OPENPIX');
    console.log('=' .repeat(50));

    const baseURL = 'https://api.openpix.com.br';
    const appId = process.env.WOOVI_APP_ID;
    const apiKey = process.env.WOOVI_API_KEY;

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log(`  Base URL: ${baseURL}`);
    console.log(`  App ID: ${appId}`);
    console.log(`  API Key: ${apiKey ? 'Configurado' : 'Não configurado'}`);

    // Teste 1: Verificar conectividade básica
    console.log('\n🌐 TESTE 1: CONECTIVIDADE BÁSICA');
    try {
        const response = await axios.get(`${baseURL}/health`, { timeout: 5000 });
        console.log('✅ API está online');
    } catch (error) {
        console.log('❌ API não está acessível:', error.message);
    }

    // Teste 2: Tentar com App ID
    console.log('\n🔑 TESTE 2: AUTENTICAÇÃO COM APP ID');
    try {
        const response = await axios.get(`${baseURL}/api/v1/charge`, {
            headers: {
                'AppId': appId,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        console.log('✅ App ID funcionando');
        console.log('  Status:', response.status);
        console.log('  Data:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.log('❌ App ID falhou');
        console.log('  Status:', error.response?.status);
        console.log('  Error:', error.response?.data);
    }

    // Teste 3: Tentar com Token
    console.log('\n🔑 TESTE 3: AUTENTICAÇÃO COM TOKEN');
    try {
        const response = await axios.get(`${baseURL}/api/v1/charge`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        console.log('✅ Token funcionando');
        console.log('  Status:', response.status);
        console.log('  Data:', JSON.stringify(response.data, null, 2));
    } catch (error) {
        console.log('❌ Token falhou');
        console.log('  Status:', error.response?.status);
        console.log('  Error:', error.response?.data);
    }

    // Teste 4: Tentar criar uma cobrança de teste
    console.log('\n💰 TESTE 4: CRIAR COBRANÇA DE TESTE');
    try {
        const chargeData = {
            correlationID: `test_${Date.now()}`,
            value: 0.01,
            comment: 'Teste de diagnóstico LEAF App',
            expiresIn: 3600
        };

        const response = await axios.post(`${baseURL}/api/v1/charge`, chargeData, {
            headers: {
                'AppId': appId,
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });
        console.log('✅ Cobrança criada com sucesso');
        console.log('  Charge ID:', response.data.correlationID);
        console.log('  Status:', response.data.status);
    } catch (error) {
        console.log('❌ Falha ao criar cobrança');
        console.log('  Status:', error.response?.status);
        console.log('  Error:', error.response?.data);
    }

    // Teste 5: Verificar documentação da API
    console.log('\n📚 TESTE 5: VERIFICAR DOCUMENTAÇÃO');
    console.log('🔗 Links úteis:');
    console.log('  - Dashboard: https://app.openpix.com.br');
    console.log('  - Documentação: https://docs.openpix.com.br');
    console.log('  - Suporte: https://app.openpix.com.br/support');

    console.log('\n💡 POSSÍVEIS SOLUÇÕES:');
    console.log('1. Verificar se a conta está ativa no dashboard');
    console.log('2. Verificar se há saldo para testes');
    console.log('3. Verificar se as credenciais estão corretas');
    console.log('4. Verificar se a API está em modo sandbox/produção');
    console.log('5. Contatar suporte da OpenPix');

    console.log('\n🎯 PRÓXIMOS PASSOS:');
    console.log('1. Acessar https://app.openpix.com.br');
    console.log('2. Verificar status da conta');
    console.log('3. Verificar configurações da API');
    console.log('4. Testar com valores reais');
}

// Executar diagnóstico
diagnoseWoovi().then(() => {
    console.log('\n🏁 DIAGNÓSTICO CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO NO DIAGNÓSTICO:', error);
    process.exit(1);
}); 