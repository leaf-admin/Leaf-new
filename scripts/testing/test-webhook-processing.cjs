#!/usr/bin/env node

// 🧪 TESTE DE PROCESSAMENTO DO WEBHOOK - LEAF APP
const axios = require('axios');

async function testWebhookProcessing() {
    console.log('🧪 TESTE DE PROCESSAMENTO DO WEBHOOK');
    console.log('=' .repeat(50));

    const webhookUrl = 'https://us-central1-leaf-reactnative.cloudfunctions.net/woovi_webhook';

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('URL do Webhook:', webhookUrl);

    console.log('\n🔍 TESTE 1: WEBHOOK COM PROCESSAMENTO SÍNCRONO');
    console.log('Esperado: Processar primeiro, depois retornar 200');
    
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

        console.log('\n📤 Enviando webhook...');
        const startTime = Date.now();
        
        const response = await axios.post(webhookUrl, testData, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 segundos para processamento
        });

        const endTime = Date.now();
        const processingTime = endTime - startTime;

        console.log('✅ Webhook processado com sucesso!');
        console.log('Status:', response.status);
        console.log('Tempo de processamento:', processingTime + 'ms');
        console.log('Resposta:', response.data);
        
        if (processingTime > 1000) {
            console.log('⚠️  Processamento demorou mais de 1 segundo');
        }
        
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

    console.log('\n🔍 TESTE 2: WEBHOOK COM ERRO (DEVE RETORNAR 500)');
    try {
        const invalidData = {
            event: 'charge.confirmed',
            charge: {
                // Dados inválidos para forçar erro
                identifier: 'invalid-charge',
                correlationID: 'invalid-correlation',
                value: 'invalid-value',
                status: 'INVALID'
            }
        };

        const response = await axios.post(webhookUrl, invalidData, {
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 10000
        });

        console.log('✅ Webhook processado mesmo com dados inválidos');
        console.log('Status:', response.status);
        
    } catch (error) {
        if (error.response?.status === 500) {
            console.log('✅ Webhook retornou 500 como esperado para dados inválidos');
            console.log('Status:', error.response.status);
        } else {
            console.log('❌ Erro inesperado:', error.response?.status || error.code);
        }
    }

    console.log('\n🎯 FLUXO CORRETO:');
    console.log('1. Woovi envia webhook');
    console.log('2. Nós processamos os dados');
    console.log('3. Nós atualizamos o banco');
    console.log('4. Nós notificamos o cliente');
    console.log('5. Nós retornamos 200 OK');
    console.log('6. Se houver erro, retornamos 500');
}

// Executar teste
testWebhookProcessing().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 