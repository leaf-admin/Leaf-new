#!/usr/bin/env node

// 🚀 SOLUÇÃO FINAL WOOVI - LEAF APP
const axios = require('axios');

async function testWooviFinalSolution() {
    console.log('🚀 SOLUÇÃO FINAL WOOVI');
    console.log('=' .repeat(40));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 CONFIGURAÇÃO FINAL:');
    console.log('✅ App ID:', appId);
    console.log('✅ API Key:', apiKey.substring(0, 20) + '...');

    console.log('\n🔍 TESTE 1: AUTENTICAÇÃO CORRETA (BASIC)');
    try {
        const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
            headers: {
                'Authorization': `Basic ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ AUTENTICAÇÃO BASIC: OK');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO AUTENTICAÇÃO BASIC:', error.response?.data || error.message);
    }

    console.log('\n🔍 TESTE 2: AUTENTICAÇÃO COM APPID CORRETO');
    try {
        const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
            headers: {
                'AppId': appId,
                'Authorization': `Basic ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ AUTENTICAÇÃO COM APPID: OK');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO AUTENTICAÇÃO COM APPID:', error.response?.data || error.message);
    }

    console.log('\n🔍 TESTE 3: CRIAR COBRANÇA PIX FINAL');
    try {
        const chargeData = {
            correlationID: 'test-' + Date.now(),
            value: 1000,
            comment: 'Teste Leaf App - Solução Final'
        };

        const response = await axios.post('https://api.openpix.com.br/api/v1/charge', chargeData, {
            headers: {
                'AppId': appId,
                'Authorization': `Basic ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ COBRANÇA PIX FINAL: CRIADA');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO COBRANÇA PIX:', error.response?.data || error.message);
    }

    console.log('\n🎯 SOLUÇÃO FINAL:');
    console.log('✅ Usar Authorization: Basic + API Key');
    console.log('✅ Usar AppId como header adicional');
    console.log('✅ Endpoint: /api/v1/charge');
    console.log('✅ Ambiente: Produção');
}

// Executar teste
testWooviFinalSolution().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 