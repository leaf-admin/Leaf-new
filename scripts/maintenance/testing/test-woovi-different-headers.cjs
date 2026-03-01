#!/usr/bin/env node

// 🧪 TESTE WOOVI COM DIFERENTES FORMATOS DE HEADERS - LEAF APP
const axios = require('axios');

async function testWooviDifferentHeaders() {
    console.log('🧪 TESTE WOOVI COM DIFERENTES FORMATOS DE HEADERS');
    console.log('=' .repeat(60));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('✅ App ID:', appId);
    console.log('✅ API Key:', apiKey.substring(0, 20) + '...');

    const testCases = [
        {
            name: 'TESTE 1: AppId Header',
            headers: {
                'AppId': appId,
                'Content-Type': 'application/json'
            }
        },
        {
            name: 'TESTE 2: appId Header (minúsculo)',
            headers: {
                'appId': appId,
                'Content-Type': 'application/json'
            }
        },
        {
            name: 'TESTE 3: Authorization Bearer',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        },
        {
            name: 'TESTE 4: AppId + Authorization',
            headers: {
                'AppId': appId,
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            }
        },
        {
            name: 'TESTE 5: X-AppId Header',
            headers: {
                'X-AppId': appId,
                'Content-Type': 'application/json'
            }
        },
        {
            name: 'TESTE 6: X-API-Key Header',
            headers: {
                'X-API-Key': apiKey,
                'Content-Type': 'application/json'
            }
        },
        {
            name: 'TESTE 7: AppId + X-API-Key',
            headers: {
                'AppId': appId,
                'X-API-Key': apiKey,
                'Content-Type': 'application/json'
            }
        },
        {
            name: 'TESTE 8: Apenas Content-Type',
            headers: {
                'Content-Type': 'application/json'
            }
        }
    ];

    for (const testCase of testCases) {
        console.log(`\n🔍 ${testCase.name}`);
        try {
            const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
                headers: testCase.headers
            });
            console.log('✅ SUCESSO');
            console.log('📊 Status:', response.status);
            console.log('📊 Headers enviados:', Object.keys(testCase.headers));
        } catch (error) {
            console.log('❌ FALHOU');
            console.log('📊 Status:', error.response?.status);
            console.log('📊 Erro:', error.response?.data?.errors?.[0]?.message || error.response?.data);
            console.log('📊 Headers enviados:', Object.keys(testCase.headers));
        }
    }

    console.log('\n🎯 ANÁLISE:');
    console.log('O erro "appID inválido" persiste em todos os formatos testados.');
    console.log('Isso indica que pode haver um problema com:');
    console.log('1. O AppID em si (formato incorreto)');
    console.log('2. A conta não estar totalmente ativada');
    console.log('3. Necessidade de configuração adicional no dashboard');

    console.log('\n💡 PRÓXIMOS PASSOS:');
    console.log('1. Verificar se a conta está completamente ativada');
    console.log('2. Verificar se há configurações pendentes no dashboard');
    console.log('3. Contatar suporte da OpenPix se necessário');
}

// Executar teste
testWooviDifferentHeaders().then(() => {
    console.log('\n✅ TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 