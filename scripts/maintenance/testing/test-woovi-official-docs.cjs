#!/usr/bin/env node

// 🧪 TESTE WOOVI SEGUINDO DOCUMENTAÇÃO OFICIAL - LEAF APP
const axios = require('axios');

async function testWooviOfficialDocs() {
    console.log('🧪 TESTE WOOVI SEGUINDO DOCUMENTAÇÃO OFICIAL');
    console.log('=' .repeat(60));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('App ID:', appId);
    console.log('API Key:', apiKey.substring(0, 20) + '...');

    console.log('\n🔍 TESTE 1: AUTENTICAÇÃO BÁSICA');
    try {
        const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
            headers: {
                'Authorization': `Basic ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ AUTENTICAÇÃO BÁSICA: OK');
        console.log('Status:', response.status);
        
    } catch (error) {
        console.log('❌ ERRO AUTENTICAÇÃO BÁSICA:', error.response?.data || error.message);
    }

    console.log('\n🔍 TESTE 2: AUTENTICAÇÃO COM APPID');
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
        
    } catch (error) {
        console.log('❌ ERRO AUTENTICAÇÃO COM APPID:', error.response?.data || error.message);
    }

    console.log('\n🔍 TESTE 3: CRIAR COBRANÇA PIX');
    try {
        const chargeData = {
            correlationID: 'test-' + Date.now(),
            value: 1000,
            comment: 'Teste Leaf App'
        };

        const response = await axios.post('https://api.openpix.com.br/api/v1/charge', chargeData, {
            headers: {
                'AppId': appId,
                'Authorization': `Basic ${apiKey}`,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ COBRANÇA PIX: CRIADA');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO COBRANÇA PIX:', error.response?.data || error.message);
    }

    console.log('\n🎯 DOCUMENTAÇÃO OFICIAL:');
    console.log('📖 https://docs.openpix.com.br');
    console.log('🔑 Autenticação: Basic + API Key');
    console.log('📱 AppId: Header adicional');
    console.log('💡 Pode ser que o AppId seja opcional');
}

// Executar teste
testWooviOfficialDocs().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 