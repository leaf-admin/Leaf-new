#!/usr/bin/env node

// 🧪 TESTE DE TODOS OS EVENTOS WOOVI - LEAF APP
const axios = require('axios');

async function testAllWooviEvents() {
    console.log('🧪 TESTE DE TODOS OS EVENTOS WOOVI');
    console.log('=' .repeat(50));

    const webhookUrl = 'https://us-central1-leaf-reactnative.cloudfunctions.net/woovi_webhook';

    console.log('\n📋 CONFIGURAÇÃO:');
    console.log('URL do Webhook:', webhookUrl);

    const events = [
        {
            name: 'charge.confirmed',
            description: 'Cobrança paga',
            data: {
                event: 'charge.confirmed',
                charge: {
                    identifier: 'test-charge-confirmed-123',
                    correlationID: 'test-correlation-456',
                    value: 1000,
                    status: 'CONFIRMED'
                }
            }
        },
        {
            name: 'charge.expired',
            description: 'Cobrança Expirada',
            data: {
                event: 'charge.expired',
                charge: {
                    identifier: 'test-charge-expired-123',
                    correlationID: 'test-correlation-456',
                    value: 1000,
                    status: 'EXPIRED'
                }
            }
        },
        {
            name: 'charge.created',
            description: 'Nova Cobrança Criada',
            data: {
                event: 'charge.created',
                charge: {
                    identifier: 'test-charge-created-123',
                    correlationID: 'test-correlation-456',
                    value: 1000,
                    status: 'CREATED',
                    comment: 'Corrida Leaf - Teste'
                }
            }
        },
        {
            name: 'refund.received',
            description: 'Reembolso concluído',
            data: {
                event: 'refund.received',
                charge: {
                    identifier: 'test-refund-123',
                    correlationID: 'test-correlation-456',
                    refundAmount: 1000,
                    status: 'REFUNDED'
                }
            }
        },
        {
            name: 'charge.received',
            description: 'Transação Pix Recebida',
            data: {
                event: 'charge.received',
                charge: {
                    identifier: 'test-charge-received-123',
                    correlationID: 'test-correlation-456',
                    value: 1000,
                    status: 'RECEIVED'
                }
            }
        },
        {
            name: 'notthesame',
            description: 'Cobrança paga por outra pessoa',
            data: {
                event: 'notthesame',
                charge: {
                    identifier: 'test-notthesame-123',
                    correlationID: 'test-correlation-456',
                    value: 1000,
                    status: 'PAID_BY_ANOTHER'
                }
            }
        }
    ];

    console.log('\n🔍 TESTANDO TODOS OS EVENTOS:');
    
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        
        console.log(`\n📤 Teste ${i + 1}/${events.length}: ${event.name}`);
        console.log(`Descrição: ${event.description}`);
        
        try {
            const startTime = Date.now();
            
            const response = await axios.post(webhookUrl, event.data, {
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });

            const endTime = Date.now();
            const processingTime = endTime - startTime;

            console.log('✅ Evento processado com sucesso!');
            console.log('Status:', response.status);
            console.log('Tempo:', processingTime + 'ms');
            console.log('Resposta:', response.data);
            
        } catch (error) {
            console.log('❌ Erro no evento:', error.response?.status || error.code);
            console.log('Mensagem:', error.response?.data || error.message);
        }
        
        // Aguardar 1 segundo entre os testes
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\n🎯 RESUMO DOS EVENTOS TESTADOS:');
    events.forEach((event, index) => {
        console.log(`${index + 1}. ${event.name} - ${event.description}`);
    });

    console.log('\n📋 PRÓXIMOS PASSOS:');
    console.log('1. Deploy das functions atualizadas');
    console.log('2. Testar com dados reais no app');
    console.log('3. Monitorar logs no Firebase Console');
}

// Executar teste
testAllWooviEvents().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 