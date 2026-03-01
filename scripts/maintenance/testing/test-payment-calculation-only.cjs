const axios = require('axios');

// Usar o backend real que já está rodando
const BASE_URL = 'http://localhost:3003/api';

// Dados de teste para diferentes valores de corrida
const testRides = [
  {
    id: 'ride_10_00',
    amount: 1000, // R$ 10,00 em centavos
    description: 'Corrida de R$ 10,00 - Taxa baixa',
    expectedOperationalFee: 99, // R$ 0,99
    expectedWooviFee: 50, // R$ 0,50
    expectedNetAmount: 851 // R$ 8,51
  },
  {
    id: 'ride_17_90',
    amount: 1790, // R$ 17,90 em centavos
    description: 'Corrida de R$ 17,90 - Taxa baixa',
    expectedOperationalFee: 99, // R$ 0,99
    expectedWooviFee: 50, // R$ 0,50
    expectedNetAmount: 1641 // R$ 16,41
  },
  {
    id: 'ride_26_00',
    amount: 2600, // R$ 26,00 em centavos
    description: 'Corrida de R$ 26,00 - Taxa alta',
    expectedOperationalFee: 149, // R$ 1,49
    expectedWooviFee: 50, // R$ 0,50
    expectedNetAmount: 2401 // R$ 24,01
  },
  {
    id: 'ride_38_00',
    amount: 3800, // R$ 38,00 em centavos
    description: 'Corrida de R$ 38,00 - Taxa alta',
    expectedOperationalFee: 149, // R$ 1,49
    expectedWooviFee: 50, // R$ 0,50
    expectedNetAmount: 3601 // R$ 36,01
  }
];

async function testPaymentCalculationOnly() {
  console.log('🚀 TESTE DE CÁLCULO DE PAGAMENTO - SISTEMA LEAF');
  console.log('=' .repeat(80));
  console.log('');

  // Primeiro, verificar se o backend está rodando
  console.log('🔍 Verificando se o backend está rodando...');
  try {
    const healthResponse = await axios.get('http://localhost:3003/health');
    console.log('✅ Backend está rodando:', healthResponse.data.status);
  } catch (error) {
    console.log('❌ Backend não está rodando. Iniciando...');
    console.log('   Execute: cd leaf-websocket-backend && node server.js');
    return;
  }

  const results = {
    total: testRides.length,
    passed: 0,
    failed: 0,
    details: []
  };

  for (let i = 0; i < testRides.length; i++) {
    const ride = testRides[i];
    console.log(`\n${i + 1}️⃣ TESTANDO CORRIDA: ${ride.description}`);
    console.log('─'.repeat(60));

    try {
      // Testar cálculo de valor líquido
      console.log('📊 Testando cálculo de valor líquido...');
      const calculationResponse = await axios.get(`${BASE_URL}/payment/calculate-net?amount=${ride.amount}`);
      
      if (!calculationResponse.data.success) {
        throw new Error(`Falha no cálculo: ${calculationResponse.data.error}`);
      }

      const calculation = calculationResponse.data.calculation;
      console.log(`   💰 Total: R$ ${calculation.breakdown.total}`);
      console.log(`   🏢 Taxa operacional (${calculation.breakdown.operationalFeeType}): R$ ${calculation.breakdown.operationalFee}`);
      console.log(`   💳 Taxa Woovi: R$ ${calculation.breakdown.wooviFee}`);
      console.log(`   ✅ Líquido: R$ ${calculation.breakdown.net}`);

      // Validar cálculos
      const isValidCalculation = 
        calculation.operationalFee === ride.expectedOperationalFee &&
        calculation.wooviFee === ride.expectedWooviFee &&
        calculation.netAmount === ride.expectedNetAmount;

      if (!isValidCalculation) {
        throw new Error(`Cálculo incorreto! 
          Esperado: Taxa R$ ${(ride.expectedOperationalFee / 100).toFixed(2)}, Líquido R$ ${(ride.expectedNetAmount / 100).toFixed(2)}
          Recebido: Taxa R$ ${calculation.breakdown.operationalFee}, Líquido R$ ${calculation.breakdown.net}`);
      }

      // Resultado do teste
      results.passed++;
      results.details.push({
        rideId: ride.id,
        amount: ride.amount,
        status: 'PASSED',
        netAmount: calculation.netAmount,
        operationalFee: calculation.operationalFee,
        wooviFee: calculation.wooviFee
      });

      console.log(`   🎉 TESTE ${i + 1} CONCLUÍDO COM SUCESSO!`);

    } catch (error) {
      results.failed++;
      results.details.push({
        rideId: ride.id,
        amount: ride.amount,
        status: 'FAILED',
        error: error.message
      });

      console.log(`   ❌ TESTE ${i + 1} FALHOU: ${error.message}`);
    }

    // Pausa entre testes
    if (i < testRides.length - 1) {
      console.log('   ⏳ Aguardando 1 segundo antes do próximo teste...');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  // Relatório final
  console.log('\n' + '='.repeat(80));
  console.log('📊 RELATÓRIO FINAL DO TESTE DE CÁLCULO');
  console.log('='.repeat(80));
  console.log(`✅ Testes aprovados: ${results.passed}/${results.total}`);
  console.log(`❌ Testes falharam: ${results.failed}/${results.total}`);
  console.log(`📈 Taxa de sucesso: ${((results.passed / results.total) * 100).toFixed(1)}%`);

  console.log('\n📋 DETALHES DOS TESTES:');
  results.details.forEach((detail, index) => {
    const status = detail.status === 'PASSED' ? '✅' : '❌';
    const amount = (detail.amount / 100).toFixed(2);
    
    if (detail.status === 'PASSED') {
      console.log(`   ${status} Teste ${index + 1}: R$ ${amount} → Líquido: R$ ${(detail.netAmount / 100).toFixed(2)} (Taxa: R$ ${(detail.operationalFee / 100).toFixed(2)} + Woovi: R$ ${(detail.wooviFee / 100).toFixed(2)})`);
    } else {
      console.log(`   ${status} Teste ${index + 1}: R$ ${amount} → ERRO: ${detail.error}`);
    }
  });

  console.log('\n🎯 VALIDAÇÕES REALIZADAS:');
  console.log('   ✅ Cálculo de taxas operacionais (R$ 0,99 até R$ 18,00 / R$ 1,49 acima)');
  console.log('   ✅ Taxa fixa Woovi (R$ 0,50)');
  console.log('   ✅ Cálculo correto do valor líquido');
  console.log('   ✅ Threshold correto para mudança de taxa');

  if (results.failed === 0) {
    console.log('\n🎉 TODOS OS TESTES PASSARAM! Sistema de cálculo funcionando perfeitamente!');
  } else {
    console.log(`\n⚠️ ${results.failed} teste(s) falharam. Verifique os erros acima.`);
  }

  console.log('\n' + '='.repeat(80));
}

// Executar teste
testPaymentCalculationOnly().catch(error => {
  console.error('❌ Erro fatal no teste de cálculo:', error);
  process.exit(1);
});










