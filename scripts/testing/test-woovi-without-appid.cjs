#!/usr/bin/env node

// 🧪 TESTE WOOVI SEM APPID EM PRODUÇÃO - LEAF APP
const axios = require('axios');

async function testWooviWithoutAppId() {
    console.log('🧪 TESTE WOOVI SEM APPID EM PRODUÇÃO');
    console.log('=' .repeat(50));

    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('✅ API Key:', apiKey.substring(0, 20) + '...');
    console.log('❌ App ID: NÃO USADO');
    console.log('✅ Ambiente: PRODUÇÃO');

    console.log('\n🔍 TESTE 1: CONEXÃO SEM APPID');
    try {
        const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
            headers: {
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ CONEXÃO SEM APPID: OK');
        console.log('Status:', response.status);
        
    } catch (error) {
        console.log('❌ ERRO CONEXÃO SEM APPID:', error.response?.data || error.message);
    }

    console.log('\n🔍 TESTE 2: AUTENTICAÇÃO BÁSICA SEM APPID');
    try {
        const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
            headers: {
                'Authorization': `Basic ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ AUTENTICAÇÃO BÁSICA SEM APPID: OK');
        console.log('Status:', response.status);
        
    } catch (error) {
        console.log('❌ ERRO AUTENTICAÇÃO BÁSICA:', error.response?.data || error.message);
    }

    console.log('\n🔍 TESTE 3: CRIAR COBRANÇA PIX SEM APPID');
    try {
        const chargeData = {
            correlationID: 'test-' + Date.now(),
            value: 1000,
            comment: 'Teste Leaf App - Sem AppID'
        };

        const response = await axios.post('https://api.openpix.com.br/api/v1/charge', chargeData, {
            headers: {
                'Authorization': `Basic ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ COBRANÇA PIX SEM APPID: CRIADA');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO COBRANÇA PIX:', error.response?.data || error.message);
    }

    console.log('\n🎯 HYPÓTESE:');
    console.log('💡 Em produção, o AppID pode ser opcional');
    console.log('💡 A API Key pode ser suficiente');
    console.log('💡 O AppID pode ser usado apenas em sandbox');
}

// Executar teste
testWooviWithoutAppId().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 