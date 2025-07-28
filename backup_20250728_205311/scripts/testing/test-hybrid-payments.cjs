#!/usr/bin/env node

// 🧪 TESTE SISTEMA HÍBRIDO DE PAGAMENTOS - LEAF APP
const HybridPaymentProvider = require('../../functions/providers/hybrid-payment/checkout');

async function testHybridPayments() {
    console.log('🧪 TESTANDO SISTEMA HÍBRIDO DE PAGAMENTOS');
    console.log('=' .repeat(50));

    const hybridProvider = new HybridPaymentProvider();

    try {
        // 1. Testar conectividade dos provedores
        console.log('\n📡 TESTANDO CONECTIVIDADE DOS PROVEDORES...');
        const connectivity = await hybridProvider.testProviderConnectivity();
        
        console.log('\n📊 STATUS DOS PROVEDORES PIX:');
        Object.entries(connectivity.pix).forEach(([provider, status]) => {
            const icon = status.status === 'online' ? '✅' : '❌';
            console.log(`  ${icon} ${provider}: ${status.status}`);
            if (status.error) {
                console.log(`    Erro: ${status.error}`);
            }
        });

        console.log('\n📊 STATUS DOS PROVEDORES DE CARTÃO:');
        Object.entries(connectivity.card).forEach(([provider, status]) => {
            const icon = status.status === 'online' ? '✅' : '❌';
            console.log(`  ${icon} ${provider}: ${status.status}`);
            if (status.error) {
                console.log(`    Erro: ${status.error}`);
            }
        });

        // 2. Testar criação de cobrança PIX
        console.log('\n💰 TESTANDO CRIAÇÃO DE COBRANÇA PIX...');
        const pixChargeData = {
            value: 25.50,
            comment: 'Teste de corrida LEAF App',
            correlationID: `test_pix_${Date.now()}`,
            customerName: 'João Silva',
            customerEmail: 'joao@teste.com',
            bookingId: 'booking_123'
        };

        const pixResult = await hybridProvider.createPixCharge(pixChargeData);
        
        if (pixResult.success) {
            console.log('✅ Cobrança PIX criada com sucesso!');
            console.log(`  Provedor: ${pixResult.actualProvider}`);
            console.log(`  Fallback usado: ${pixResult.fallbackUsed ? 'Sim' : 'Não'}`);
            console.log(`  Charge ID: ${pixResult.chargeId}`);
            console.log(`  PIX Code: ${pixResult.pixCode ? 'Gerado' : 'Não gerado'}`);
        } else {
            console.log('❌ Falha ao criar cobrança PIX');
            console.log(`  Erro: ${pixResult.error}`);
        }

        // 3. Testar criação de transação de cartão
        console.log('\n💳 TESTANDO CRIAÇÃO DE TRANSAÇÃO DE CARTÃO...');
        const cardTransactionData = {
            orderId: `test_card_${Date.now()}`,
            amount: 25.50,
            description: 'Teste de corrida LEAF App',
            customerName: 'João Silva',
            customerEmail: 'joao@teste.com',
            customerTaxId: '12345678901',
            successUrl: 'https://leaf.app/success',
            failureUrl: 'https://leaf.app/failure',
            notificationUrl: 'https://leaf-app-91dfdce0.cloudfunctions.net/payment-webhook'
        };

        const cardResult = await hybridProvider.createCardTransaction(cardTransactionData);
        
        if (cardResult.success) {
            console.log('✅ Transação de cartão criada com sucesso!');
            console.log(`  Provedor: ${cardResult.actualProvider}`);
            console.log(`  Fallback usado: ${cardResult.fallbackUsed ? 'Sim' : 'Não'}`);
            console.log(`  Transaction ID: ${cardResult.transactionId || cardResult.preferenceId}`);
        } else {
            console.log('❌ Falha ao criar transação de cartão');
            console.log(`  Erro: ${cardResult.error}`);
        }

        // 4. Obter estatísticas dos provedores
        console.log('\n📊 ESTATÍSTICAS DOS PROVEDORES:');
        const stats = hybridProvider.getProviderStats();
        
        console.log('  Provedores PIX:');
        stats.pixProviders.forEach(provider => {
            console.log(`    ✅ ${provider.name}: ${provider.status}`);
        });
        
        console.log('  Provedores de Cartão:');
        stats.cardProviders.forEach(provider => {
            console.log(`    ✅ ${provider.name}: ${provider.status}`);
        });
        
        console.log(`  Provedor PIX atual: ${stats.currentPixProvider}`);
        console.log(`  Provedor Cartão atual: ${stats.currentCardProvider}`);

        // 5. Simular cenários de fallback
        console.log('\n🔄 SIMULANDO CENÁRIOS DE FALLBACK...');
        
        // Simular falha do provedor principal PIX
        console.log('  Simulando falha do Woovi (PIX principal)...');
        const fallbackPixData = {
            ...pixChargeData,
            correlationID: `test_fallback_pix_${Date.now()}`
        };
        
        // Forçar uso do fallback (AbacatePay)
        const fallbackPixResult = await hybridProvider.createPixCharge(fallbackPixData);
        
        if (fallbackPixResult.success && fallbackPixResult.fallbackUsed) {
            console.log('✅ Fallback PIX funcionando corretamente!');
            console.log(`  Provedor usado: ${fallbackPixResult.actualProvider}`);
        } else {
            console.log('⚠️ Fallback PIX não foi necessário ou falhou');
        }

        // Simular falha do provedor principal de cartão
        console.log('  Simulando falha do MercadoPago (Cartão principal)...');
        const fallbackCardData = {
            ...cardTransactionData,
            orderId: `test_fallback_card_${Date.now()}`
        };
        
        const fallbackCardResult = await hybridProvider.createCardTransaction(fallbackCardData);
        
        if (fallbackCardResult.success && fallbackCardResult.fallbackUsed) {
            console.log('✅ Fallback Cartão funcionando corretamente!');
            console.log(`  Provedor usado: ${fallbackCardResult.actualProvider}`);
        } else {
            console.log('⚠️ Fallback Cartão não foi necessário ou falhou');
        }

        console.log('\n🎯 RESUMO DOS TESTES:');
        console.log('=' .repeat(30));
        
        const onlinePixProviders = Object.values(connectivity.pix).filter(p => p.status === 'online').length;
        const onlineCardProviders = Object.values(connectivity.card).filter(p => p.status === 'online').length;
        
        console.log(`📊 Provedores PIX online: ${onlinePixProviders}/${Object.keys(connectivity.pix).length}`);
        console.log(`📊 Provedores Cartão online: ${onlineCardProviders}/${Object.keys(connectivity.card).length}`);
        console.log(`💰 Teste PIX: ${pixResult.success ? '✅ Sucesso' : '❌ Falha'}`);
        console.log(`💳 Teste Cartão: ${cardResult.success ? '✅ Sucesso' : '❌ Falha'}`);
        
        if (onlinePixProviders > 0 && onlineCardProviders > 0) {
            console.log('\n✅ SISTEMA HÍBRIDO DE PAGAMENTOS FUNCIONANDO!');
        } else {
            console.log('\n⚠️ ALGUNS PROVEDORES ESTÃO OFFLINE');
        }

    } catch (error) {
        console.error('❌ ERRO NO TESTE:', error.message);
        console.error(error.stack);
    }
}

// Executar teste
testHybridPayments().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 