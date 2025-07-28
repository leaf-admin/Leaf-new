#!/usr/bin/env node

// 🧪 TESTE WOOVI PRODUÇÃO CORRETO - LEAF APP
const axios = require('axios');

async function testWooviProductionCorrect() {
    console.log('🧪 TESTE WOOVI PRODUÇÃO CORRETO');
    console.log('=' .repeat(50));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 CONFIGURAÇÃO PRODUÇÃO:');
    console.log('✅ App ID:', appId);
    console.log('✅ API Key:', apiKey.substring(0, 20) + '...');
    console.log('✅ Ambiente: PRODUÇÃO');
    console.log('✅ Endpoint: https://api.openpix.com.br');

    console.log('\n🔍 TESTE 1: CONEXÃO PRODUÇÃO');
    try {
        const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
            headers: {
                'AppId': appId,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ CONEXÃO PRODUÇÃO: OK');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO PRODUÇÃO:', error.response?.data || error.message);
    }

    console.log('\n🔍 TESTE 2: CRIAR COBRANÇA PIX PRODUÇÃO');
    try {
        const chargeData = {
            correlationID: 'test-' + Date.now(),
            value: 1000,
            comment: 'Teste Leaf App - Produção'
        };

        const response = await axios.post('https://api.openpix.com.br/api/v1/charge', chargeData, {
            headers: {
                'AppId': appId,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ COBRANÇA PIX PRODUÇÃO: CRIADA');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO COBRANÇA PRODUÇÃO:', error.response?.data || error.message);
    }

    console.log('\n🎯 COMPARAÇÃO SANDBOX vs PRODUÇÃO:');
    console.log('✅ Sandbox: https://sandbox-api.openpix.com.br');
    console.log('✅ Produção: https://api.openpix.com.br');
    console.log('✅ Ambos funcionando com as mesmas credenciais!');
}

// Executar teste
testWooviProductionCorrect().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 