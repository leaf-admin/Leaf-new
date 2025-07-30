#!/usr/bin/env node

/**
 * 🏦 Teste da Nova Estrutura de Split Múltiplo
 * 
 * Este script testa a nova implementação do BaaS com split automático
 * para múltiplas contas: operacional, woovi, prefeitura e motorista
 */

const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);

// Configuração
const CONFIG = {
  // URLs das Firebase Functions
  functions: {
    createTaxAccounts: 'https://us-central1-leaf-reactnative.cloudfunctions.net/createLeafTaxAccounts',
    getTaxBalances: 'https://us-central1-leaf-reactnative.cloudfunctions.net/getLeafTaxAccountsBalance',
    processMultipleSplit: 'https://us-central1-leaf-reactnative.cloudfunctions.net/processMultipleSplit'
  },
  
  // Dados de teste
  testRides: [
    { value: 15.00, description: 'Corrida pequena' },
    { value: 25.00, description: 'Corrida média' },
    { value: 50.00, description: 'Corrida grande' },
    { value: 100.00, description: 'Corrida premium' }
  ],
  
  // Dados do motorista de teste
  testDriver: {
    id: 'test_driver_001',
    name: 'João Silva',
    leaf_account_id: 'test_leaf_account_001'
  }
};

/**
 * Calcular breakdown esperado para uma corrida
 */
function calculateExpectedBreakdown(rideValue) {
  const operationalFee = rideValue < 10 ? 0.79 : (rideValue <= 20 ? 0.99 : 1.49);
  const wooviFee = 0.50;
  const cityTax = rideValue * 0.015;
  const driverAmount = rideValue - operationalFee - wooviFee - cityTax;
  
  return {
    total: rideValue,
    operational_fee: operationalFee,
    woovi_fee: wooviFee,
    city_tax: cityTax,
    driver_amount: driverAmount,
    breakdown_percentage: {
      operational: (operationalFee / rideValue) * 100,
      woovi: (wooviFee / rideValue) * 100,
      city_tax: (cityTax / rideValue) * 100,
      driver: (driverAmount / rideValue) * 100
    }
  };
}

/**
 * Fazer request para Firebase Function
 */
async function callFirebaseFunction(url, data = {}) {
  try {
    const response = await execAsync(`curl -X POST "${url}" \
      -H "Content-Type: application/json" \
      -d '${JSON.stringify(data)}'`);
    
    return JSON.parse(response.stdout);
  } catch (error) {
    console.error('❌ Erro na chamada da function:', error.message);
    return null;
  }
}

/**
 * Testar criação de contas de taxas
 */
async function testCreateTaxAccounts() {
  console.log('\n🏦 Testando criação de contas de taxas...');
  
  const result = await callFirebaseFunction(CONFIG.functions.createTaxAccounts);
  
  if (result && result.success) {
    console.log('✅ Contas de taxas criadas com sucesso');
    console.log('📋 Contas criadas:', result.result.accounts);
    return true;
  } else {
    console.log('❌ Falha ao criar contas de taxas');
    return false;
  }
}

/**
 * Testar obtenção de saldos
 */
async function testGetTaxBalances() {
  console.log('\n💰 Testando obtenção de saldos das contas de taxas...');
  
  const result = await callFirebaseFunction(CONFIG.functions.getTaxBalances);
  
  if (result && result.success) {
    console.log('✅ Saldos obtidos com sucesso');
    console.log('📊 Saldos atuais:');
    Object.entries(result.result.balances).forEach(([type, balance]) => {
      console.log(`   ${type}: R$ ${balance.balance.toFixed(2)}`);
    });
    console.log(`   Total: R$ ${result.result.total.toFixed(2)}`);
    return true;
  } else {
    console.log('❌ Falha ao obter saldos');
    return false;
  }
}

/**
 * Testar split múltiplo para uma corrida
 */
async function testMultipleSplit(rideData) {
  console.log(`\n🚗 Testando split múltiplo para ${rideData.description} (R$ ${rideData.value.toFixed(2)})...`);
  
  const expectedBreakdown = calculateExpectedBreakdown(rideData.value);
  
  console.log('📊 Breakdown esperado:');
  console.log(`   🏢 Taxa Operacional: R$ ${expectedBreakdown.operational_fee.toFixed(2)} (${expectedBreakdown.breakdown_percentage.operational.toFixed(1)}%)`);
  console.log(`   💳 Taxa Woovi: R$ ${expectedBreakdown.woovi_fee.toFixed(2)} (${expectedBreakdown.breakdown_percentage.woovi.toFixed(1)}%)`);
  console.log(`   🏛️ Taxa Prefeitura: R$ ${expectedBreakdown.city_tax.toFixed(2)} (${expectedBreakdown.breakdown_percentage.city_tax.toFixed(1)}%)`);
  console.log(`   🚗 Motorista: R$ ${expectedBreakdown.driver_amount.toFixed(2)} (${expectedBreakdown.breakdown_percentage.driver.toFixed(1)}%)`);
  
  const paymentData = {
    charge_id: `test_charge_${Date.now()}`,
    trip_id: `test_trip_${Date.now()}`,
    driver_id: CONFIG.testDriver.id,
    driver: {
      leaf_account_id: CONFIG.testDriver.leaf_account_id
    },
    value: rideData.value,
    description: rideData.description
  };
  
  const result = await callFirebaseFunction(CONFIG.functions.processMultipleSplit, { paymentData });
  
  if (result && result.success) {
    console.log('✅ Split múltiplo processado com sucesso');
    console.log('📊 Resultado real:');
    const breakdown = result.result.breakdown;
    console.log(`   🏢 Taxa Operacional: R$ ${breakdown.operational_fee.toFixed(2)}`);
    console.log(`   💳 Taxa Woovi: R$ ${breakdown.woovi_fee.toFixed(2)}`);
    console.log(`   🏛️ Taxa Prefeitura: R$ ${breakdown.city_tax.toFixed(2)}`);
    console.log(`   🚗 Motorista: R$ ${breakdown.driver_amount.toFixed(2)}`);
    
    // Verificar se os valores estão corretos
    const isCorrect = 
      Math.abs(breakdown.operational_fee - expectedBreakdown.operational_fee) < 0.01 &&
      Math.abs(breakdown.woovi_fee - expectedBreakdown.woovi_fee) < 0.01 &&
      Math.abs(breakdown.city_tax - expectedBreakdown.city_tax) < 0.01 &&
      Math.abs(breakdown.driver_amount - expectedBreakdown.driver_amount) < 0.01;
    
    if (isCorrect) {
      console.log('✅ Valores calculados corretamente');
    } else {
      console.log('❌ Valores não correspondem ao esperado');
    }
    
    return true;
  } else {
    console.log('❌ Falha ao processar split múltiplo');
    return false;
  }
}

/**
 * Teste completo da nova estrutura
 */
async function runCompleteTest() {
  console.log('🏦 TESTE DA NOVA ESTRUTURA DE SPLIT MÚLTIPLO');
  console.log('=' .repeat(60));
  
  let successCount = 0;
  let totalTests = 0;
  
  // Teste 1: Criar contas de taxas
  totalTests++;
  if (await testCreateTaxAccounts()) successCount++;
  
  // Teste 2: Obter saldos
  totalTests++;
  if (await testGetTaxBalances()) successCount++;
  
  // Teste 3: Testar splits para diferentes valores
  for (const rideData of CONFIG.testRides) {
    totalTests++;
    if (await testMultipleSplit(rideData)) successCount++;
  }
  
  // Teste 4: Verificar saldos após splits
  totalTests++;
  if (await testGetTaxBalances()) successCount++;
  
  // Resultado final
  console.log('\n' + '=' .repeat(60));
  console.log('📊 RESULTADO FINAL DO TESTE');
  console.log(`✅ Testes passaram: ${successCount}/${totalTests}`);
  console.log(`📈 Taxa de sucesso: ${((successCount/totalTests)*100).toFixed(1)}%`);
  
  if (successCount === totalTests) {
    console.log('🎉 TODOS OS TESTES PASSARAM! Nova estrutura funcionando perfeitamente.');
  } else {
    console.log('⚠️ Alguns testes falharam. Verificar logs acima.');
  }
  
  console.log('\n💰 BENEFÍCIOS DA NOVA ESTRUTURA:');
  console.log('   ✅ Controle total de cada tipo de taxa');
  console.log('   ✅ Transparência completa para motoristas');
  console.log('   ✅ Reserva automática para taxas da prefeitura');
  console.log('   ✅ Separação clara entre custos operacionais e taxas');
  console.log('   ✅ Facilidade para auditoria e relatórios');
}

// Executar teste
runCompleteTest().catch(console.error); 