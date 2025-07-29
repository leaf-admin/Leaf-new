#!/usr/bin/env node

/**
 * Teste de Criação de Contas Leaf BaaS
 * 
 * Este script testa a criação de contas Leaf para motoristas
 * usando o sistema BaaS (Bank as a Service) da Woovi.
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
 * Teste de criação de conta Leaf
 */
async function testLeafAccountCreation() {
  console.log('🧪 TESTE DE CRIAÇÃO DE CONTA LEAF BaaS');
  console.log('==========================================\n');

  try {
    // Dados de teste do motorista
    const testDriverData = {
      id: 'test_driver_' + Date.now(),
      firstName: 'João',
      lastName: 'Silva',
      email: 'joao.silva@teste.com',
      mobile: '+5511999999999',
      cpf: '12345678901',
      plan_type: 'plus'
    };

    console.log('📋 Dados do motorista de teste:');
    console.log(JSON.stringify(testDriverData, null, 2));
    console.log('');

    // Teste 1: Criar conta Leaf via API Woovi
    console.log('🔧 Teste 1: Criar conta Leaf via API Woovi');
    console.log('--------------------------------------------');
    
    const accountResponse = await axios.post(`${WOOVI_CONFIG.baseURL}/api/v1/subaccount`, {
      name: `Leaf Driver - ${testDriverData.firstName} ${testDriverData.lastName}`,
      document: testDriverData.cpf,
      email: testDriverData.email,
      phone: testDriverData.mobile,
      split_percentage: 100,
      auto_transfer: true,
      transfer_delay: 0,
      account_type: 'driver',
      metadata: {
        driver_id: testDriverData.id,
        plan_type: testDriverData.plan_type,
        created_at: new Date().toISOString()
      }
    }, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Conta Leaf criada com sucesso:');
    console.log(JSON.stringify(accountResponse.data, null, 2));
    console.log('');

    const accountId = accountResponse.data.id;

    // Teste 2: Verificar saldo da conta
    console.log('💰 Teste 2: Verificar saldo da conta');
    console.log('-------------------------------------');
    
    const balanceResponse = await axios.get(`${WOOVI_CONFIG.baseURL}/api/v1/account/${accountId}/balance`, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiKey,
        'Content-Type': 'application/json'
      }
    });

    console.log('✅ Saldo da conta obtido:');
    console.log(JSON.stringify(balanceResponse.data, null, 2));
    console.log('');

    // Teste 3: Salvar no Firestore
    console.log('💾 Teste 3: Salvar dados no Firestore');
    console.log('--------------------------------------');
    
    await db.collection('users').doc(testDriverData.id).set({
      ...testDriverData,
      leaf_account_id: accountId,
      leaf_account_status: 'active',
      leaf_account_created_at: admin.firestore.FieldValue.serverTimestamp(),
      plan_type: testDriverData.plan_type,
      userType: 'driver',
      status: 'active'
    });

    console.log('✅ Dados salvos no Firestore');
    console.log('');

    // Teste 4: Verificar dados salvos
    console.log('🔍 Teste 4: Verificar dados salvos');
    console.log('-----------------------------------');
    
    const savedData = await db.collection('users').doc(testDriverData.id).get();
    const driverData = savedData.data();

    console.log('✅ Dados do motorista salvos:');
    console.log(JSON.stringify(driverData, null, 2));
    console.log('');

    // Teste 5: Log da transação
    console.log('📝 Teste 5: Log da transação');
    console.log('-----------------------------');
    
    await db.collection('baas_transactions').add({
      type: 'LEAF_ACCOUNT_CREATED',
      driver_id: testDriverData.id,
      account_id: accountId,
      plan_type: testDriverData.plan_type,
      created_at: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log('✅ Transação logada com sucesso');
    console.log('');

    console.log('🎉 TODOS OS TESTES PASSARAM!');
    console.log('=============================');
    console.log('');
    console.log('📊 RESUMO:');
    console.log(`- Conta Leaf criada: ${accountId}`);
    console.log(`- Motorista ID: ${testDriverData.id}`);
    console.log(`- Plano: ${testDriverData.plan_type}`);
    console.log(`- Status: Ativo`);
    console.log('');

    return {
      success: true,
      account_id: accountId,
      driver_id: testDriverData.id,
      plan_type: testDriverData.plan_type
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
 * Teste de limpeza de dados de teste
 */
async function cleanupTestData() {
  console.log('🧹 LIMPEZA DE DADOS DE TESTE');
  console.log('==============================\n');

  try {
    // Buscar motoristas de teste
    const testDrivers = await db.collection('users')
      .where('email', '==', 'joao.silva@teste.com')
      .get();

    console.log(`Encontrados ${testDrivers.size} motoristas de teste`);

    for (const doc of testDrivers.docs) {
      await doc.ref.delete();
      console.log(`✅ Motorista removido: ${doc.id}`);
    }

    // Buscar transações de teste
    const testTransactions = await db.collection('baas_transactions')
      .where('driver_id', '==', 'test_driver_' + Date.now())
      .get();

    console.log(`Encontradas ${testTransactions.size} transações de teste`);

    for (const doc of testTransactions.docs) {
      await doc.ref.delete();
      console.log(`✅ Transação removida: ${doc.id}`);
    }

    console.log('✅ Limpeza concluída');
    console.log('');

  } catch (error) {
    console.error('❌ Erro na limpeza:', error.message);
  }
}

/**
 * Função principal
 */
async function main() {
  console.log('🏦 LEAF APP - TESTE BaaS ACCOUNT CREATION');
  console.log('==========================================\n');

  // Verificar variáveis de ambiente
  if (!process.env.WOOVI_API_KEY) {
    console.error('❌ ERRO: WOOVI_API_KEY não configurada');
    console.log('Configure a variável de ambiente WOOVI_API_KEY');
    process.exit(1);
  }

  if (!process.env.WOOVI_APP_ID) {
    console.error('❌ ERRO: WOOVI_APP_ID não configurada');
    console.log('Configure a variável de ambiente WOOVI_APP_ID');
    process.exit(1);
  }

  console.log('✅ Variáveis de ambiente configuradas');
  console.log('');

  // Executar teste
  const result = await testLeafAccountCreation();

  if (result.success) {
    console.log('🎯 TESTE CONCLUÍDO COM SUCESSO!');
    console.log('================================');
    console.log('');
    console.log('📋 PRÓXIMOS PASSOS:');
    console.log('1. Implementar integração no mobile app');
    console.log('2. Criar telas de seleção de planos');
    console.log('3. Implementar split automático');
    console.log('4. Testar cobrança semanal');
    console.log('');
  } else {
    console.log('❌ TESTE FALHOU!');
    console.log('================');
    console.log('');
    console.log('🔧 VERIFICAÇÕES:');
    console.log('1. Verificar configuração da API Woovi');
    console.log('2. Verificar permissões da conta');
    console.log('3. Verificar conectividade de rede');
    console.log('4. Verificar logs do Firebase');
    console.log('');
  }

  // Limpeza opcional
  const args = process.argv.slice(2);
  if (args.includes('--cleanup')) {
    await cleanupTestData();
  }

  process.exit(result.success ? 0 : 1);
}

// Executar se chamado diretamente
if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  testLeafAccountCreation,
  cleanupTestData
}; 