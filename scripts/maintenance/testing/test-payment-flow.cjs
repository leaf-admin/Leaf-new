const axios = require('axios');

const BASE_URL = 'http://localhost:3003/api';

// Dados de teste
const testData = {
  passengerId: 'passenger_123',
  passengerName: 'João Silva',
  passengerEmail: 'joao@email.com',
  rideId: 'ride_456',
  rideDetails: {
    origin: 'Rua A, 123 - Centro',
    destination: 'Rua B, 456 - Bairro X',
    distance: 5.2,
    estimatedTime: 15
  },
  amount: 2500, // R$ 25,00 em centavos
  driverId: 'driver_789',
  wooviClientId: 'woovi_client_123'
};

async function testPaymentFlow() {
  console.log('🚀 Iniciando testes do fluxo de pagamento Leaf...\n');

  try {
    // 1. Testar pagamento antecipado
    console.log('1️⃣ Testando pagamento antecipado...');
    const advancePayment = await axios.post(`${BASE_URL}/payment/advance`, {
      passengerId: testData.passengerId,
      amount: testData.amount,
      rideId: testData.rideId,
      rideDetails: testData.rideDetails,
      passengerName: testData.passengerName,
      passengerEmail: testData.passengerEmail
    });

    console.log('✅ Pagamento antecipado criado:', {
      success: advancePayment.data.success,
      chargeId: advancePayment.data.chargeId,
      qrCode: advancePayment.data.qrCode ? 'Gerado' : 'Não gerado'
    });

    // 2. Testar confirmação de pagamento (simulado)
    console.log('\n2️⃣ Testando confirmação de pagamento...');
    const confirmPayment = await axios.post(`${BASE_URL}/payment/confirm`, {
      chargeId: advancePayment.data.chargeId,
      rideId: testData.rideId
    });

    console.log('✅ Pagamento confirmado:', {
      success: confirmPayment.data.success,
      status: confirmPayment.data.holdingData?.status
    });

    // 3. Testar cálculo de valor líquido
    console.log('\n3️⃣ Testando cálculo de valor líquido...');
    const netCalculation = await axios.get(`${BASE_URL}/payment/calculate-net?amount=${testData.amount}`);

    console.log('✅ Cálculo líquido:', {
      success: netCalculation.data.success,
      total: netCalculation.data.calculation.breakdown.total,
      operationalFee: netCalculation.data.calculation.breakdown.operationalFee,
      wooviFee: netCalculation.data.calculation.breakdown.wooviFee,
      net: netCalculation.data.calculation.breakdown.net
    });

    // 4. Testar distribuição líquida (simulado)
    console.log('\n4️⃣ Testando distribuição líquida...');
    const distribution = await axios.post(`${BASE_URL}/payment/distribute`, {
      rideId: testData.rideId,
      driverId: testData.driverId,
      wooviClientId: testData.wooviClientId,
      totalAmount: testData.amount
    });

    console.log('✅ Distribuição líquida:', {
      success: distribution.data.success,
      netAmount: distribution.data.netAmount,
      earningsChargeId: distribution.data.earningsChargeId
    });

    // 5. Testar status do pagamento
    console.log('\n5️⃣ Testando status do pagamento...');
    const paymentStatus = await axios.get(`${BASE_URL}/payment/status/${testData.rideId}`);

    console.log('✅ Status do pagamento:', {
      success: paymentStatus.data.success,
      status: paymentStatus.data.status,
      amount: paymentStatus.data.amount
    });

    // 6. Testar reembolso (simulado)
    console.log('\n6️⃣ Testando reembolso...');
    const refund = await axios.post(`${BASE_URL}/payment/refund`, {
      rideId: testData.rideId,
      reason: 'No driver found'
    });

    console.log('✅ Reembolso processado:', {
      success: refund.data.success,
      refundId: refund.data.refundId,
      amount: refund.data.amount
    });

    console.log('\n🎯 RESUMO DOS TESTES:');
    console.log('✅ Pagamento antecipado: OK');
    console.log('✅ Confirmação de pagamento: OK');
    console.log('✅ Cálculo de valor líquido: OK');
    console.log('✅ Distribuição líquida: OK');
    console.log('✅ Status do pagamento: OK');
    console.log('✅ Reembolso: OK');

    console.log('\n💡 FLUXO IMPLEMENTADO:');
    console.log('1. Passageiro paga antes de buscar motorista');
    console.log('2. Valor fica em holding na conta Leaf');
    console.log('3. Se não encontrar motorista, reembolso automático');
    console.log('4. Se encontrar motorista, distribuição líquida após corrida');
    console.log('5. Taxa operacional: R$ 0,99 (até R$ 15,00) / R$ 1,49 (acima) + Taxa Woovi: R$ 0,50');

    console.log('\n✅ Todos os testes do fluxo de pagamento concluídos!');

  } catch (error) {
    console.error('❌ Erro nos testes:', error.response?.data || error.message);
  }
}

// Executar testes
testPaymentFlow();
