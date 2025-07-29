#!/usr/bin/env node

/**
 * Teste de Split Automático BaaS
 * 
 * Este script testa o sistema de split automático que transfere
 * 100% do valor das corridas para a conta Leaf do motorista.
 */

const axios = require('axios');
const admin = require('firebase-admin');

// Configuração
const FIREBASE_CONFIG = {
  projectId: 'leaf-reactnative',
  databaseURL: 'https://leaf-reactnative-default-rtdb.firebaseio.com'
};

const WOOVI_CONFIG = {
  apiKey: process.env.WOOVI_API_KEY,
  appId: process.env.WOOVI_APP_ID,
  baseURL: 'https://api.openpix.com.br'
};

// Inicializar Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp(FIREBASE_CONFIG);
}

const db = admin.firestore();

/**
 * Teste de split automático
 */
async function testAutomaticSplit() {
  console.log('🧪 TESTE DE SPLIT AUTOMÁTICO BaaS');
  console.log('====================================\n');

  try {
    // Dados de teste
    const testData = {
      trip_id: 'test_trip_' + Date.now(),
      charge_id: 'test_charge_' + Date.now(),
      value: 25.50,
      driver_id: 'test_driver_split',
      driver: {
        leaf_account_id: 'test_account_123',
        firstName: 'Maria',
        lastName: 'Santos'
      }
    };

    console.log('📋 Dados de teste:');
    console.log(JSON.stringify(testData, null, 2));
    console.log('');

    // Teste 1: Criar cobrança PIX simulada
    console.log('💳 Teste 1: Criar cobrança PIX simulada');
    console.log('----------------------------------------');
    
    const chargeResponse = await axios.post(`${WOOVI_CONFIG.baseURL}/api/v1/charge`, {
      value: testData.value,
      correlationID: testData.trip_id,
      comment: `Teste Split - Corrida ${testData.trip_id}`,
      expiresIn: 3600,
      metadata: {
        trip_id: testData.trip_id,
        driver_id: testData.driver_id,
        test_mode: true
      }
    }, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Cobrança PIX criada:');
    console.log(JSON.stringify(chargeResponse.data, null, 2));
    console.log('');

    const chargeId = chargeResponse.data.id;

    // Teste 2: Processar split automático
    console.log('🔄 Teste 2: Processar split automático');
    console.log('--------------------------------------');
    
    const splitData = {
      main_charge_id: chargeId,
      splits: [
        {
          account_id: testData.driver.leaf_account_id,
          percentage: 100, // 100% para motorista
          amount: testData.value,
          description: `Corrida ${testData.trip_id} - 100% para motorista`
        }
      ]
    };

    const splitResponse = await axios.post(`${WOOVI_CONFIG.baseURL}/api/v1/split`, splitData, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Split automático processado:');
    console.log(JSON.stringify(splitResponse.data, null, 2));
    console.log('');

    // Teste 3: Salvar dados da corrida no Firestore
    console.log('💾 Teste 3: Salvar dados da corrida');
    console.log('-----------------------------------');
    
    await db.collection('trips').doc(testData.trip_id).set({
      trip_id: testData.trip_id,
      charge_id: chargeId,
      value: testData.value,
      driver_id: testData.driver_id,
      driver: testData.driver,
      status: 'PAYMENT_CONFIRMED',
      split_processed: true,
      split_result: splitResponse.data,
      driver_amount: testData.value,
      split_processed_at: admin.firestore.FieldValue.serverTimestamp(),
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('✅ Dados da corrida salvos');
    console.log('');

    // Teste 4: Verificar dados salvos
    console.log('🔍 Teste 4: Verificar dados salvos');
    console.log('-----------------------------------');
    
    const savedTrip = await db.collection('trips').doc(testData.trip_id).get();
    const tripData = savedTrip.data();

    console.log('✅ Dados da corrida:');
    console.log(JSON.stringify(tripData, null, 2));
    console.log('');

    // Teste 5: Log da transação
    console.log('📝 Teste 5: Log da transação');
    console.log('-----------------------------');
    
    await db.collection('baas_transactions').add({
      type: 'PAYMENT_SPLIT_PROCESSED',
      trip_id: testData.trip_id,
      driver_id: testData.driver_id,
      amount: testData.value,
      split_result: splitResponse.data,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('✅ Transação logada com sucesso');
    console.log('');

    // Teste 6: Simular notificação para motorista
    console.log('📱 Teste 6: Simular notificação');
    console.log('--------------------------------');
    
    const notificationData = {
      type: 'payment_received',
      amount: testData.value,
      trip_id: testData.trip_id,
      message: `Você recebeu R$ ${testData.value.toFixed(2)} pela corrida!`
    };

    console.log('✅ Notificação simulada:');
    console.log(JSON.stringify(notificationData, null, 2));
    console.log('');

    console.log('🎉 TODOS OS TESTES PASSARAM!');
    console.log('=============================');
    console.log('');
    console.log('📊 RESUMO:');
    console.log(`- Corrida ID: ${testData.trip_id}`);
    console.log(`- Cobrança ID: ${chargeId}`);
    console.log(`- Valor: R$ ${testData.value.toFixed(2)}`);
    console.log(`- Motorista: ${testData.driver.firstName} ${testData.driver.lastName}`);
    console.log(`- Split: 100% para motorista`);
    console.log(`- Status: Processado`);
    console.log('');

    return {
      success: true,
      trip_id: testData.trip_id,
      charge_id: chargeId,
      amount: testData.value,
      driver_id: testData.driver_id
    };

  } catch (error) {
    console.error('❌ ERRO NO TESTE:');
    console.error('==================');
    console.error('Mensagem:', error.message);
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Dados:', JSON.stringify(error.response.data, null, 2));
    }
    
    console.error('Stack:', error.stack);
    console.log('');

    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Teste de cenários de erro
 */
async function testErrorScenarios() {
  console.log('🚨 TESTE DE CENÁRIOS DE ERRO');
  console.log('==============================\n');

  const scenarios = [
    {
      name: 'Conta Leaf inválida',
      data: {
        trip_id: 'error_test_1',
        charge_id: 'error_charge_1',
        value: 20.00,
        driver_id: 'error_driver_1',
        driver: {
          leaf_account_id: 'invalid_account_123',
          firstName: 'Teste',
          lastName: 'Erro'
        }
      }
    },
    {
      name: 'Valor zero',
      data: {
        trip_id: 'error_test_2',
        charge_id: 'error_charge_2',
        value: 0,
        driver_id: 'error_driver_2',
        driver: {
          leaf_account_id: 'test_account_123',
          firstName: 'Teste',
          lastName: 'Zero'
        }
      }
    },
    {
      name: 'Dados incompletos',
      data: {
        trip_id: 'error_test_3',
        charge_id: 'error_charge_3',
        value: 15.00,
        driver_id: 'error_driver_3',
        driver: {
          // Sem leaf_account_id
          firstName: 'Teste',
          lastName: 'Incompleto'
        }
      }
    }
  ];

  for (const scenario of scenarios) {
    console.log(`🔍 Testando: ${scenario.name}`);
    console.log('--------------------------------');
    
    try {
      // Tentar processar split com dados inválidos
      const splitData = {
        main_charge_id: scenario.data.charge_id,
        splits: [
          {
            account_id: scenario.data.driver.leaf_account_id || 'invalid',
            percentage: 100,
            amount: scenario.data.value,
            description: `Teste erro - ${scenario.name}`
          }
        ]
      };

      await axios.post(`${WOOVI_CONFIG.baseURL}/api/v1/split`, splitData, {
        headers: {
          'Authorization': WOOVI_CONFIG.apiKey,
          'Content-Type': 'application/json'
        }
      });

      console.log('❌ ERRO: Split deveria ter falhado');
      
    } catch (error) {
      console.log('✅ Erro esperado capturado:');
      console.log(`   Status: ${error.response?.status || 'N/A'}`);
      console.log(`   Mensagem: ${error.message}`);
    }
    
    console.log('');
  }
}

/**
 * Teste de performance
 */
async function testPerformance() {
  console.log('⚡ TESTE DE PERFORMANCE');
  console.log('=======================\n');

  const iterations = 5;
  const results = [];

  console.log(`Executando ${iterations} splits simultâneos...`);
  console.log('');

  for (let i = 0; i < iterations; i++) {
    const startTime = Date.now();
    
    try {
      const testData = {
        trip_id: `perf_test_${i}_${Date.now()}`,
        charge_id: `perf_charge_${i}_${Date.now()}`,
        value: 10 + (i * 5), // Valores diferentes
        driver_id: `perf_driver_${i}`,
        driver: {
          leaf_account_id: 'test_account_123',
          firstName: `Motorista`,
          lastName: `${i}`
        }
      };

      // Criar cobrança
      const chargeResponse = await axios.post(`${WOOVI_CONFIG.baseURL}/api/v1/charge`, {
        value: testData.value,
        correlationID: testData.trip_id,
        comment: `Teste Performance ${i}`,
        expiresIn: 3600
      }, {
        headers: {
          'Authorization': WOOVI_CONFIG.apiKey,
          'Content-Type': 'application/json'
        }
      });

      // Processar split
      const splitResponse = await axios.post(`${WOOVI_CONFIG.baseURL}/api/v1/split`, {
        main_charge_id: chargeResponse.data.id,
        splits: [
          {
            account_id: testData.driver.leaf_account_id,
            percentage: 100,
            amount: testData.value
          }
        ]
      }, {
        headers: {
          'Authorization': WOOVI_CONFIG.apiKey,
          'Content-Type': 'application/json'
        }
      });

      const endTime = Date.now();
      const duration = endTime - startTime;

      results.push({
        iteration: i + 1,
        duration,
        success: true,
        trip_id: testData.trip_id,
        amount: testData.value
      });

      console.log(`✅ Iteração ${i + 1}: ${duration}ms - R$ ${testData.value.toFixed(2)}`);

    } catch (error) {
      const endTime = Date.now();
      const duration = endTime - startTime;

      results.push({
        iteration: i + 1,
        duration,
        success: false,
        error: error.message
      });

      console.log(`❌ Iteração ${i + 1}: ${duration}ms - ERRO`);
    }
  }

  console.log('');
  console.log('📊 RESULTADOS DE PERFORMANCE:');
  console.log('==============================');
  
  const successfulResults = results.filter(r => r.success);
  const failedResults = results.filter(r => !r.success);
  
  if (successfulResults.length > 0) {
    const avgDuration = successfulResults.reduce((sum, r) => sum + r.duration, 0) / successfulResults.length;
    const minDuration = Math.min(...successfulResults.map(r => r.duration));
    const maxDuration = Math.max(...successfulResults.map(r => r.duration));
    
    console.log(`✅ Sucessos: ${successfulResults.length}/${iterations}`);
    console.log(`⏱️  Tempo médio: ${avgDuration.toFixed(0)}ms`);
    console.log(`⚡ Tempo mínimo: ${minDuration}ms`);
    console.log(`🐌 Tempo máximo: ${maxDuration}ms`);
  }
  
  if (failedResults.length > 0) {
    console.log(`❌ Falhas: ${failedResults.length}/${iterations}`);
  }
  
  console.log('');
}

/**
 * Função principal
 */
async function main() {
  console.log('🏦 LEAF APP - TESTE BaaS SPLIT AUTOMÁTICO');
  console.log('===========================================\n');

  // Verificar variáveis de ambiente
  if (!process.env.WOOVI_API_KEY) {
    console.error('❌ ERRO: WOOVI_API_KEY não configurada');
    process.exit(1);
  }

  if (!process.env.WOOVI_APP_ID) {
    console.error('❌ ERRO: WOOVI_APP_ID não configurada');
    process.exit(1);
  }

  console.log('✅ Variáveis de ambiente configuradas');
  console.log('');

  // Executar testes
  const args = process.argv.slice(2);
  
  if (args.includes('--errors')) {
    await testErrorScenarios();
  } else if (args.includes('--performance')) {
    await testPerformance();
  } else {
    const result = await testAutomaticSplit();

    if (result.success) {
      console.log('🎯 TESTE CONCLUÍDO COM SUCESSO!');
      console.log('================================');
      console.log('');
      console.log('📋 PRÓXIMOS PASSOS:');
      console.log('1. Integrar no fluxo de pagamento');
      console.log('2. Implementar notificações push');
      console.log('3. Criar dashboard de splits');
      console.log('4. Testar com dados reais');
      console.log('');
    } else {
      console.log('❌ TESTE FALHOU!');
      console.log('================');
      console.log('');
      console.log('🔧 VERIFICAÇÕES:');
      console.log('1. Verificar configuração da API Woovi');
      console.log('2. Verificar permissões de split');
      console.log('3. Verificar conectividade de rede');
      console.log('4. Verificar logs do Firebase');
      console.log('');
    }
  }

  process.exit(0);
}

// Executar se chamado diretamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testAutomaticSplit,
  testErrorScenarios,
  testPerformance
}; 