#!/usr/bin/env node

// 🧪 TESTE WOOVI COM AUTENTICAÇÃO CORRETA - LEAF APP
const axios = require('axios');

async function testWooviCorrectAuth() {
    console.log('🧪 TESTE WOOVI COM AUTENTICAÇÃO CORRETA');
    console.log('=' .repeat(50));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const appIdClean = '7bd2d925-4878-4c9d-a33a-ed76c3d4e100';

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('App ID Completo:', appId);
    console.log('App ID Limpo:', appIdClean);

    console.log('\n🔍 TESTE 1: AUTENTICAÇÃO CORRETA (AppID Completo)');
    try {
        const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
            headers: {
                'Authorization': appId,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ SUCESSO!');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO:', error.response?.data || error.message);
    }

    console.log('\n🔍 TESTE 2: AUTENTICAÇÃO CORRETA (AppID Limpo)');
    try {
        const response = await axios.get('https://api.openpix.com.br/api/v1/charge', {
            headers: {
                'Authorization': appIdClean,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ SUCESSO!');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO:', error.response?.data || error.message);
    }

    console.log('\n🔍 TESTE 3: CRIAR COBRANÇA PIX (AppID Completo)');
    try {
        const chargeData = {
            correlationID: 'test-' + Date.now(),
            value: 1000,
            comment: 'Teste Leaf App - Auth Correta'
        };

        const response = await axios.post('https://api.openpix.com.br/api/v1/charge', chargeData, {
            headers: {
                'Authorization': appId,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ COBRANÇA CRIADA!');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO:', error.response?.data || error.message);
    }

    console.log('\n🔍 TESTE 4: CRIAR COBRANÇA PIX (AppID Limpo)');
    try {
        const chargeData = {
            correlationID: 'test-' + Date.now(),
            value: 1000,
            comment: 'Teste Leaf App - Auth Correta Limpa'
        };

        const response = await axios.post('https://api.openpix.com.br/api/v1/charge', chargeData, {
            headers: {
                'Authorization': appIdClean,
                'Content-Type': 'application/json'
            }
        });
        
        console.log('✅ COBRANÇA CRIADA!');
        console.log('Status:', response.status);
        console.log('Dados:', response.data);
        
    } catch (error) {
        console.log('❌ ERRO:', error.response?.data || error.message);
    }

    console.log('\n🎯 DOCUMENTAÇÃO OFICIAL:');
    console.log('📖 https://developers.woovi.com/docs/apis/api-getting-started');
    console.log('🔑 Authorization: <AppID>');
    console.log('💡 Sem Bearer, sem Basic, apenas o AppID');
}

// Executar teste
testWooviCorrectAuth().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 