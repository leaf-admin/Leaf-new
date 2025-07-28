#!/usr/bin/env node

// 🧪 TESTE SIMPLES DO WEBHOOK - LEAF APP
const axios = require('axios');

async function testWebhookSimple() {
    console.log('🧪 TESTE SIMPLES DO WEBHOOK');
    console.log('=' .repeat(40));

    const webhookUrl = 'https://us-central1-leaf-reactnative.cloudfunctions.net/woovi_webhook';

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('URL do Webhook:', webhookUrl);

    console.log('\n🔍 TESTE 1: WEBHOOK BÁSICO');
    try {
        const testData = {
            event: 'charge.confirmed',
            charge: {
                identifier: 'test-charge-123',
                correlationID: 'test-correlation-456',
                value: 1000,
                status: 'CONFIRMED'
            }
        };

        const response = await axios.post(webhookUrl, testData, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000 // 10 segundos
        });

        console.log('✅ Webhook funcionando!');
        console.log('Status:', response.status);
        console.log('Resposta:', response.data);
        
    } catch (error) {
        console.log('❌ Erro no webhook:', error.response?.status || error.code);
        console.log('Mensagem:', error.response?.data || error.message);
        
        if (error.code === 'ECONNREFUSED') {
            console.log('\n💡 SOLUÇÃO:');
            console.log('1. Deploy das functions: cd functions && firebase deploy');
            console.log('2. Aguardar alguns minutos para propagação');
            console.log('3. Testar novamente');
        }
    }

    console.log('\n🔍 TESTE 2: VERIFICAR SE ENDPOINT EXISTE');
    try {
        const response = await axios.get(webhookUrl.replace('/woovi_webhook', ''), {
            timeout: 5000
        });
        
        console.log('✅ Endpoint base acessível');
        console.log('Status:', response.status);
        
    } catch (error) {
        console.log('❌ Endpoint não acessível:', error.message);
    }

    console.log('\n🎯 PRÓXIMOS PASSOS:');
    console.log('1. Deploy das functions se necessário');
    console.log('2. Configurar webhook no dashboard da Woovi');
    console.log('3. Testar com dados reais');
}

// Executar teste
testWebhookSimple().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 