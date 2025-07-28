#!/usr/bin/env node

// 🧪 TESTE WOOVI CONTA ATIVADA - LEAF APP
const axios = require('axios');

async function testWooviActivatedAccount() {
    console.log('🧪 TESTE WOOVI CONTA ATIVADA');
    console.log('=' .repeat(50));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 STATUS CONFIRMADO:');
    console.log('✅ API: API_LEAF01');
    console.log('✅ Status: ATIVADA');
    console.log('✅ Client ID: Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100');
    console.log('✅ Conta bancária: Conta 15717');

    console.log('\n🔍 TESTE 1: VERIFICAR SE O TOKEN ESTÁ CORRETO');
    try {
        const decoded = Buffer.from(apiKey, 'base64').toString();
        console.log('✅ Token decodificado:', decoded);
        
        const parts = decoded.split(':');
        if (parts.length === 2) {
            console.log('✅ Client ID no token:', parts[0]);
            console.log('✅ Client Secret:', parts[1].substring(0, 20) + '...');
            
            if (parts[0] === appId) {
                console.log('✅ Token e AppID: CORRETOS');
            } else {
                console.log('❌ Token e AppID: DIFERENTES');
            }
        }
    } catch (error) {
        console.log('❌ ERRO AO DECODIFICAR TOKEN:', error.message);
    }

    console.log('\n🔍 TESTE 2: TESTAR COM HEADERS DIFERENTES');
    const testCases = [
        {
            name: 'CASE 1: AppId apenas',
            headers: { 'AppId': appId }
        },
        {
            name: 'CASE 2: Authorization Basic',
            headers: { 'Authorization': `Basic ${apiKey}` }
        },
        {
            name: 'CASE 3: AppId + Authorization',
            headers: { 
                'AppId': appId,
                'Authorization': `Basic ${apiKey}`
            }
        },
        {
            name: 'CASE 4: X-App-Id',
            headers: { 'X-App-Id': appId }
        },
        {
            name: 'CASE 5: Authorization Bearer',
            headers: { 'Authorization': `Bearer ${appId}` }
        }
    ];

    for (const testCase of testCases) {
        console.log(`\n🔍 ${testCase.name}`);
        
        try {
            const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
                headers: {
                    ...testCase.headers,
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

    console.log('\n🎯 POSSÍVEIS CAUSAS:');
    console.log('1. Token expirado (mesmo sendo regenerado)');
    console.log('2. Configuração de IPs permitidos');
    console.log('3. Limite de transações atingido');
    console.log('4. Problema temporário da API');
    console.log('5. Necessário regenerar token novamente');

    console.log('\n💡 PRÓXIMOS PASSOS:');
    console.log('1. Regenerar token novamente');
    console.log('2. Verificar logs de erro no dashboard');
    console.log('3. Contatar suporte da OpenPix');
    console.log('4. Verificar se há manutenção na API');
}

// Executar teste
testWooviActivatedAccount().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 