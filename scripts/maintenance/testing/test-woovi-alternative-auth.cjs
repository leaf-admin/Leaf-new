#!/usr/bin/env node

// 🧪 TESTE WOOVI COM AUTENTICAÇÃO ALTERNATIVA - LEAF APP
const axios = require('axios');

async function testWooviAlternativeAuth() {
    console.log('🧪 TESTE WOOVI COM AUTENTICAÇÃO ALTERNATIVA');
    console.log('=' .repeat(60));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('✅ App ID:', appId);
    console.log('✅ API Key:', apiKey.substring(0, 20) + '...');

    const authMethods = [
        {
            name: 'MÉTODO 1: Apenas AppId',
            headers: { 'AppId': appId }
        },
        {
            name: 'MÉTODO 2: Apenas API Key',
            headers: { 'Authorization': `Bearer ${apiKey}` }
        },
        {
            name: 'MÉTODO 3: AppId + Bearer',
            headers: { 
                'AppId': appId,
                'Authorization': `Bearer ${apiKey}`
            }
        },
        {
            name: 'MÉTODO 4: X-API-Key',
            headers: { 'X-API-Key': apiKey }
        },
        {
            name: 'MÉTODO 5: AppId + X-API-Key',
            headers: { 
                'AppId': appId,
                'X-API-Key': apiKey
            }
        },
        {
            name: 'MÉTODO 6: Basic Auth',
            headers: { 'Authorization': `Basic ${apiKey}` }
        },
        {
            name: 'MÉTODO 7: AppId + Basic Auth',
            headers: { 
                'AppId': appId,
                'Authorization': `Basic ${apiKey}`
            }
        }
    ];

    for (const method of authMethods) {
        console.log(`\n🔍 ${method.name}`);
        
        try {
            const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
                headers: {
                    ...method.headers,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('✅ SUCESSO!');
            console.log('Status:', response.status);
            console.log('Dados:', response.data);
            
        } catch (error) {
            console.log('❌ ERRO:', error.response?.data?.errors?.[0]?.message || error.message);
        }
    }

    console.log('\n🎯 TESTE SANDBOX PARA COMPARAÇÃO:');
    try {
        const response = await axios.get('https://sandbox-api.openpix.com.br/api/v1/charge', {
            headers: {
                'AppId': appId,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ SANDBOX: FUNCIONANDO');
        console.log('Status:', response.status);
        
    } catch (error) {
        console.log('❌ SANDBOX:', error.response?.data || error.message);
    }

    console.log('\n💡 CONCLUSÃO:');
    console.log('Se sandbox funciona mas produção não,');
    console.log('o problema é específico da conta de produção.');
}

// Executar teste
testWooviAlternativeAuth().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 