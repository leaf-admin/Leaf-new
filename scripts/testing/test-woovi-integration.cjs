#!/usr/bin/env node

// 🧪 TESTE INTEGRAÇÃO WOOVI/OPENPIX - LEAF APP
const WooviPixProvider = require('../../functions/providers/woovi/checkout');

async function testWooviIntegration() {
    console.log('🧪 TESTANDO INTEGRAÇÃO WOOVI/OPENPIX');
    console.log('=' .repeat(50));

    // Verificar se as variáveis de ambiente estão configuradas
    const appId = process.env.WOOVI_APP_ID;
    const baseUrl = process.env.WOOVI_BASE_URL || 'https://api.openpix.com.br';

    console.log('\n📋 CONFIGURAÇÃO ATUAL:');
    console.log(`  Base URL: ${baseUrl}`);
    console.log(`  App ID: ${appId ? '✅ Configurado' : '❌ Não configurado'}`);

    if (!appId || appId === 'YOUR_WOOVI_APP_ID') {
        console.log('\n❌ ERRO: App ID do Woovi não configurado!');
        console.log('\n📋 INSTRUÇÕES:');
        console.log('1. Acesse: https://openpix.com.br');
        console.log('2. Crie uma conta ou faça login');
        console.log('3. Vá em "Desenvolvedores" → "Criar Aplicação"');
        console.log('4. Copie o App ID gerado');
        console.log('5. Configure no .env.production:');
        console.log('   WOOVI_APP_ID=seu_app_id_real_aqui');
        console.log('\n🔗 Links úteis:');
        console.log('- Dashboard: https://app.openpix.com.br');
        console.log('- Documentação: https://docs.openpix.com.br');
        console.log('- Suporte: https://app.openpix.com.br/support');
        
        return;
    }

    const wooviProvider = new WooviPixProvider();

    try {
        // 1. Testar conectividade básica
        console.log('\n📡 TESTANDO CONECTIVIDADE...');
        
        const testChargeData = {
            value: 0.01, // R$ 0,01 (valor mínimo para teste)
            comment: 'Teste de conectividade LEAF App',
            correlationID: `test_woovi_${Date.now()}`,
            customerName: 'Teste LEAF',
            customerEmail: 'teste@leaf.app',
            bookingId: 'test_booking_123'
        };

        const result = await wooviProvider.createPixCharge(testChargeData);
        
        if (result.success) {
            console.log('✅ Conectividade OK!');
            console.log(`  Charge ID: ${result.chargeId}`);
            console.log(`  PIX Code: ${result.pixCode ? 'Gerado' : 'Não gerado'}`);
            console.log(`  PIX Copy/Paste: ${result.pixCopyPaste ? 'Disponível' : 'Não disponível'}`);
            
            // 2. Testar consulta de status
            console.log('\n📊 TESTANDO CONSULTA DE STATUS...');
            const statusResult = await wooviProvider.getChargeStatus(result.chargeId);
            
            if (statusResult.success) {
                console.log('✅ Consulta de status OK!');
                console.log(`  Status: ${statusResult.status}`);
            } else {
                console.log('⚠️ Consulta de status falhou');
                console.log(`  Erro: ${statusResult.error}`);
            }

            // 3. Testar webhook (simulação)
            console.log('\n🔗 TESTANDO WEBHOOK...');
            const webhookData = {
                event: 'charge.confirmed',
                data: {
                    correlationID: result.chargeId,
                    value: 0.01,
                    status: 'CONFIRMED',
                    paidAt: new Date().toISOString()
                }
            };

            const webhookResult = wooviProvider.processWebhook(webhookData);
            
            if (webhookResult.success) {
                console.log('✅ Processamento de webhook OK!');
                console.log(`  Status: ${webhookResult.status}`);
                console.log(`  Charge ID: ${webhookResult.chargeId}`);
            } else {
                console.log('⚠️ Processamento de webhook falhou');
                console.log(`  Erro: ${webhookResult.error}`);
            }

            // 4. Testar validação de webhook
            console.log('\n🔐 TESTANDO VALIDAÇÃO DE WEBHOOK...');
            const signature = 'test_signature';
            const timestamp = Date.now().toString();
            const body = JSON.stringify(webhookData);
            
            const validationResult = wooviProvider.validateWebhook(signature, timestamp, body);
            console.log(`  Validação: ${validationResult ? '✅ OK' : '❌ Falhou'}`);

            console.log('\n🎯 RESUMO DOS TESTES:');
            console.log('=' .repeat(30));
            console.log('✅ Conectividade: OK');
            console.log('✅ Criação de cobrança: OK');
            console.log(`✅ Consulta de status: ${statusResult.success ? 'OK' : 'Falhou'}`);
            console.log(`✅ Processamento webhook: ${webhookResult.success ? 'OK' : 'Falhou'}`);
            console.log(`✅ Validação webhook: ${validationResult ? 'OK' : 'Falhou'}`);

            console.log('\n✅ INTEGRAÇÃO WOOVI FUNCIONANDO!');
            console.log('\n📋 PRÓXIMOS PASSOS:');
            console.log('1. Configurar webhook no painel da OpenPix');
            console.log('2. Testar com valores reais');
            console.log('3. Monitorar logs de transação');
            console.log('4. Configurar fallback (AbacatePay)');

        } else {
            console.log('❌ Falha na conectividade');
            console.log(`  Erro: ${result.error}`);
            
            console.log('\n🔧 POSSÍVEIS SOLUÇÕES:');
            console.log('1. Verificar se o App ID está correto');
            console.log('2. Verificar se a conta está ativa');
            console.log('3. Verificar se há saldo para testes');
            console.log('4. Verificar se a API está acessível');
        }

    } catch (error) {
        console.error('❌ ERRO NO TESTE:', error.message);
        console.error(error.stack);
        
        console.log('\n🔧 TROUBLESHOOTING:');
        console.log('1. Verificar conexão com internet');
        console.log('2. Verificar se a API da OpenPix está online');
        console.log('3. Verificar se as credenciais estão corretas');
        console.log('4. Verificar se a conta está habilitada');
    }
}

// Executar teste
testWooviIntegration().then(() => {
    console.log('\n🏁 TESTE CONCLUÍDO');
    process.exit(0);
}).catch(error => {
    console.error('❌ ERRO FATAL:', error);
    process.exit(1);
}); 