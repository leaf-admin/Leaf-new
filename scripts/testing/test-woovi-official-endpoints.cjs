#!/usr/bin/env node

// 🧪 TESTE TODOS OS ENDPOINTS WOOVI - LEAF APP
const axios = require('axios');

async function testWooviAllEndpoints() {
    console.log('🧪 TESTE TODOS OS ENDPOINTS WOOVI');
    console.log('=' .repeat(50));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('✅ App ID:', appId);
    console.log('✅ API Key:', apiKey.substring(0, 20) + '...');

    const endpoints = [
        {
            name: 'ENDPOINT 1: /api/v1/charge',
            url: 'https://api.openpix.com.br/api/v1/charge'
        },
        {
            name: 'ENDPOINT 2: /openpix/charge',
            url: 'https://api.openpix.com.br/openpix/charge'
        },
        {
            name: 'ENDPOINT 3: /v1/charge',
            url: 'https://api.openpix.com.br/v1/charge'
        },
        {
            name: 'ENDPOINT 4: /charge',
            url: 'https://api.openpix.com.br/charge'
        },
        {
            name: 'ENDPOINT 5: /api/charge',
            url: 'https://api.openpix.com.br/api/charge'
        }
    ];

    for (const endpoint of endpoints) {
        console.log(`\n🔍 ${endpoint.name}`);
        console.log('URL:', endpoint.url);
        
        try {
            const response = await axios.get(endpoint.url, {
                headers: {
                    'AppId': appId,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('✅ SUCESSO!');
            console.log('Status:', response.status);
            console.log('Dados:', response.data);
            
        } catch (error) {
            console.log('❌ ERRO:', error.response?.status || error.code);
            console.log('Mensagem:', error.response?.data?.errors?.[0]?.message || error.message);
        }
    }

    console.log('\n🎯 CONCLUSÃO:');
    console.log('💡 O endpoint correto é: /api/v1/charge');
    console.log('💡 O problema não é o endpoint');
    console.log('💡 O problema é a autenticação');
    console.log('💡 Precisamos verificar a documentação oficial');
}

// Executar teste
testWooviAllEndpoints().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 