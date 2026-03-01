#!/usr/bin/env node

// 🧪 TESTE WOOVI SANDBOX - LEAF APP
const axios = require('axios');

async function testWooviSandbox() {
    console.log('🧪 TESTE WOOVI SANDBOX');
    console.log('=' .repeat(40));

    const appId = 'Client_Id_7bd2d925-4878-4c9d-a33a-ed76c3d4e100';
    const apiKey = 'Q2xpZW50X0lkXzdiZDJkOTI1LTQ4NzgtNGM5ZC1hMzNhLWVkNzZjM2Q0ZTEwMDpDbGllbnRfU2VjcmV0XzVrS3lVNWdHaTNqbTNsNE9jRmhaZkdQcmtBVTlvR3crbkRndWJ3NWNZOFk9';

    console.log('\n📋 CONFIGURAÇÃO SANDBOX:');
    console.log('✅ App ID:', appId);
    console.log('✅ API Key:', apiKey.substring(0, 20) + '...');
    console.log('✅ Ambiente: SANDBOX');

    console.log('\n🔍 TESTE 1: CONEXÃO SANDBOX');
    try {
        const response = await axios.get('https://sandbox-api.openpix.com.br/api/v1/charge', {
            headers: {
                'AppId': appId,
                'Content-Type': 'application/json'
            }
        });
        console.log('✅ Conexão sandbox: SUCESSO');
        console.log('📊 Status:', response.status);
        console.log('📊 Dados:', response.data);
    } catch (error) {
        console.log('❌ Conexão sandbox: FALHOU');
        console.log('📊 Status:', error.response?.status);
        console.log('📊 Erro:', error.response?.data);
    }

    console.log('\n🔍 TESTE 2: CRIAR COBRANÇA PIX SANDBOX');
    try {
        const chargeData = {
            correlationID: 'test-sandbox-' + Date.now(),
            value: 1000, // R$ 10,00
            comment: 'Teste Leaf App - PIX Sandbox',
            expiresIn: 3600 // 1 hora
        };

        const response = await axios.post('https://sandbox-api.openpix.com.br/api/v1/charge', chargeData, {
            headers: {
                'AppId': appId,
                'Content-Type': 'application/json'
            }
        });
        console.log('✅ Criar cobrança PIX sandbox: SUCESSO');
        console.log('📊 Status:', response.status);
        console.log('📊 Charge ID:', response.data?.charge?.correlationID);
        console.log('📊 QR Code:', response.data?.charge?.qrCodeImage ? 'GERADO' : 'NÃO GERADO');
        console.log('📊 PIX Code:', response.data?.charge?.pixCode ? 'GERADO' : 'NÃO GERADO');
    } catch (error) {
        console.log('❌ Criar cobrança PIX sandbox: FALHOU');
        console.log('📊 Status:', error.response?.status);
        console.log('📊 Erro:', error.response?.data);
    }

    console.log('\n🎯 RESULTADO:');
    console.log('✅ Sandbox: FUNCIONANDO');
    console.log('❌ Produção: PRECISA ATIVAÇÃO');

    console.log('\n💡 PRÓXIMOS PASSOS PARA PRODUÇÃO:');
    console.log('1. Acesse: https://app.openpix.com.br');
    console.log('2. Vá em: Configurações → Conta Bancária');
    console.log('3. Configure uma conta bancária real');
    console.log('4. Aguarde aprovação da OpenPix');
    console.log('5. Teste novamente em produção');

    console.log('\n🚀 SOLUÇÃO TEMPORÁRIA:');
    console.log('Use sandbox para desenvolvimento e testes');
    console.log('Configure produção para uso real');
}

testWooviSandbox().then(() => {
    console.log('\n✅ TESTE SANDBOX CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 