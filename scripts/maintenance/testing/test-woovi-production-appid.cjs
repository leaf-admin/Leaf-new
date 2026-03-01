#!/usr/bin/env node

// 🧪 TESTE WOOVI PRODUÇÃO APPID - LEAF APP
const axios = require('axios');

async function testWooviProductionAppId() {
    console.log('🧪 TESTE WOOVI PRODUÇÃO APPID');
    console.log('=' .repeat(50));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('✅ App ID:', appId);
    console.log('✅ API Key:', apiKey.substring(0, 20) + '...');

    // Testar diferentes formatos de AppID para produção
    const appIdVariations = [
        {
            name: 'ORIGINAL',
            appId: appId
        },
        {
            name: 'SEM PREFIXO',
            appId: '7bd2d925-4878-4c9d-a33a-ed76c3d4e100'
        },
        {
            name: 'COM PREFIXO DIFERENTE',
            appId: 'App_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100'
        },
        {
            name: 'SEM UNDERSCORE',
            appId: 'ClientId_7bd2d925-4878-4c9d-a33a-ed76c3d4e100'
        }
    ];

    for (const variation of appIdVariations) {
        console.log(`\n🔍 TESTE: ${variation.name}`);
        console.log('AppID:', variation.appId);
        
        try {
            const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
                headers: {
                    'AppId': variation.appId,
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

    console.log('\n🎯 TESTE SEM APPID EM PRODUÇÃO:');
    try {
        const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ SEM APPID: OK');
        console.log('Status:', response.status);
        
    } catch (error) {
        console.log('❌ SEM APPID:', error.response?.data?.errors?.[0]?.message || error.message);
    }

    console.log('\n💡 CONCLUSÃO:');
    console.log('Se nenhum formato funcionar,');
    console.log('o problema é específico da conta de produção.');
    console.log('Necessário verificar configurações no dashboard.');
}

// Executar teste
testWooviProductionAppId().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 