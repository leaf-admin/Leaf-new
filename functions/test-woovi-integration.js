const WooviPixProvider = require('./providers/woovi/checkout');

// Teste da integração OpenPix/Woovi
async function testWooviIntegration() {
    console.log('🧪 TESTANDO INTEGRAÇÃO OPENPIX/WOOVI');
    console.log('=====================================');

    // Configurar provider
    const woovi = new WooviPixProvider();

    try {
        // Teste 1: Listar cobranças (teste de conexão)
        console.log('\n📋 Teste 1: Verificando conexão...');
        const listResult = await woovi.listCharges({ limit: 1 });
        
        if (listResult.success) {
            console.log('✅ Conexão estabelecida com sucesso!');
            console.log('📊 Dados recebidos:', listResult.data);
        } else {
            console.log('❌ Erro na conexão:', listResult.error);
            return;
        }

        // Teste 2: Criar cobrança de teste
        console.log('\n💰 Teste 2: Criando cobrança de teste...');
        const chargeResult = await woovi.createPixCharge({
            value: 100, // R$ 1,00
            customerName: 'Teste LEAF',
            customerId: 'test_user_123',
            bookingId: 'test_booking_456',
            comment: 'Teste de integração LEAF App'
        });

        if (chargeResult.success) {
            console.log('✅ Cobrança criada com sucesso!');
            console.log('🆔 Charge ID:', chargeResult.chargeId);
            console.log('📱 QR Code:', chargeResult.pixCode);
            console.log('📋 PIX Copy/Paste:', chargeResult.pixCopyPaste);

            // Teste 3: Consultar status da cobrança
            console.log('\n🔍 Teste 3: Consultando status...');
            const statusResult = await woovi.getChargeStatus(chargeResult.chargeId);
            
            if (statusResult.success) {
                console.log('✅ Status consultado com sucesso!');
                console.log('📊 Status:', statusResult.status);
                console.log('💰 Valor:', statusResult.data.value);
            } else {
                console.log('❌ Erro ao consultar status:', statusResult.error);
            }

        } else {
            console.log('❌ Erro ao criar cobrança:', chargeResult.error);
        }

        // Teste 4: Criar cobrança personalizada
        console.log('\n🎨 Teste 4: Criando cobrança personalizada...');
        const customResult = await woovi.createCustomPixCharge({
            value: 250, // R$ 2,50
            customerName: 'João Silva',
            customerId: 'user_123',
            bookingId: 'booking_456',
            driverId: 'driver_789',
            comment: 'Pagamento LEAF - Viagem teste'
        });

        if (customResult.success) {
            console.log('✅ Cobrança personalizada criada!');
            console.log('🆔 Charge ID:', customResult.qrCode.chargeId);
            console.log('⏰ Expira em:', customResult.qrCode.expiresAt);
            console.log('👤 Cliente:', customResult.qrCode.customerName);
        } else {
            console.log('❌ Erro na cobrança personalizada:', customResult.error);
        }

        console.log('\n🎉 TODOS OS TESTES CONCLUÍDOS!');
        console.log('================================');

    } catch (error) {
        console.error('❌ Erro geral nos testes:', error);
    }
}

// Teste de webhook
function testWebhook() {
    console.log('\n🔗 TESTANDO WEBHOOK');
    console.log('===================');

    const woovi = new WooviPixProvider();
    
    // Simular dados de webhook
    const webhookData = {
        event: 'charge.confirmed',
        charge: {
            correlationID: 'test_charge_123',
            value: 100,
            identifier: 'test_user_123'
        }
    };

    const result = woovi.processWebhook(webhookData);
    
    if (result.success) {
        console.log('✅ Webhook processado com sucesso!');
        console.log('📊 Evento:', result.event);
        console.log('🆔 Charge ID:', result.chargeId);
        console.log('💰 Valor:', result.value);
    } else {
        console.log('❌ Erro no webhook:', result.error);
    }
}

// Executar testes se chamado diretamente
if (require.main === module) {
    testWooviIntegration().then(() => {
        testWebhook();
    });
}

module.exports = {
    testWooviIntegration,
    testWebhook
}; 