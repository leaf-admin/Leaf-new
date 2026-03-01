#!/usr/bin/env node

// 🧪 TESTE DIFERENTES FORMATOS DE APPID WOOVI - LEAF APP
const axios = require('axios');

async function testWooviAppIdFormats() {
    console.log('🧪 TESTE DIFERENTES FORMATOS DE APPID WOOVI');
    console.log('=' .repeat(60));

    const appIdOriginal = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 APPID ORIGINAL:', appIdOriginal);
    console.log('📋 API KEY:', apiKey.substring(0, 20) + '...');

    const testFormats = [
        {
            name: 'FORMATO 1: Original',
            appId: appIdOriginal,
            headers: { 'AppId': appIdOriginal }
        },
        {
            name: 'FORMATO 2: Sem Client_Id_',
            appId: '7bd2d925-4878-4c9d-a33a-ed76c3d4e100',
            headers: { 'AppId': '7bd2d925-4878-4c9d-a33a-ed76c3d4e100' }
        },
        {
            name: 'FORMATO 3: Authorization Bearer',
            appId: appIdOriginal,
            headers: { 'Authorization': `Bearer ${appIdOriginal}` }
        },
        {
            name: 'FORMATO 4: X-App-Id',
            appId: appIdOriginal,
            headers: { 'X-App-Id': appIdOriginal }
        },
        {
            name: 'FORMATO 5: API Key como AppId',
            appId: apiKey,
            headers: { 'AppId': apiKey }
        }
    ];

    for (const format of testFormats) {
        console.log(`\n🔍 ${format.name}`);
        console.log('AppID:', format.appId);
        
        try {
            const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
                headers: {
                    ...format.headers,
                    'Content-Type': 'application/json'
                }
            });
            
            console.log('✅ SUCESSO!');
            console.log('Status:', response.status);
            
        } catch (error) {
            console.log('❌ ERRO:', error.response?.data?.errors?.[0]?.message || error.message);
        }
    }

    console.log('\n🎯 VERIFICAÇÃO DASHBOARD:');
    console.log('1. Acesse: https://app.openpix.com.br');
    console.log('2. Vá em: Desenvolvedores → Suas Aplicações');
    console.log('3. Clique em: API_LEAF01');
    console.log('4. Verifique o formato exato do Client ID');
    console.log('5. Compare com o que estamos usando');
}

// Executar teste
testWooviAppIdFormats().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 