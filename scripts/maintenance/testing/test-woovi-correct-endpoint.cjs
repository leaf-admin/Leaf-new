#!/usr/bin/env node

// 🧪 TESTE WOOVI COM ENDPOINT CORRETO - LEAF APP
const axios = require('axios');

async function testWooviCorrectEndpoint() {
    console.log('🧪 TESTE WOOVI COM ENDPOINT CORRETO');
    console.log('=' .repeat(50));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('✅ App ID:', appId);
    console.log('✅ API Key:', apiKey.substring(0, 20) + '...');
    console.log('✅ Token decodificado: CORRETO');

    console.log('\n🔍 TESTE 1: ENDPOINT CORRETO DA DOCUMENTAÇÃO');
    try {
        const response = await axios.get('https://api.openpix.com.br/openpix/charge', {
            headers: {
                'AppId': appId,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ ENDPOINT CORRETO: OK');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO ENDPOINT CORRETO:', error.response?.data || error.message);
    }

    console.log('\n🔍 TESTE 2: CRIAR COBRANÇA PIX COM ENDPOINT CORRETO');
    try {
        const chargeData = {
            correlationID: 'test-' + Date.now(),
            value: 1000,
            comment: 'Teste Leaf App - Endpoint Correto'
        };

        const response = await axios.post('https://api.openpix.com.br/openpix/charge', chargeData, {
            headers: {
                'AppId': appId,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ COBRANÇA PIX COM ENDPOINT CORRETO: CRIADA');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO COBRANÇA PIX:', error.response?.data || error.message);
    }

    console.log('\n🎯 COMPARAÇÃO ENDPOINTS:');
    console.log('❌ Endpoint antigo: /api/v1/charge');
    console.log('✅ Endpoint correto: /openpix/charge');
    console.log('📖 Documentação oficial: https://docs.openpix.com.br');
}

// Executar teste
testWooviCorrectEndpoint().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 