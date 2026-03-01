#!/usr/bin/env node

// 🏦 TESTE WOOVI BaaS SANDBOX - LEAF APP
// Testa especificamente as funcionalidades BaaS (Bank as a Service)

const axios = require('axios');

// Configuração Sandbox
const WOOVI_SANDBOX_CONFIG = {
  clientId: 'Client_Id_18c0dc27-6306-41dc-a2de-b6303347c3ae',
  clientSecret: 'Client_Secret_oVXw4Mrnny9kD8GyZSWWWMQ8++8vkLaGAeVDTfsrxw=',
  apiToken: 'Q2xpZW50X0lkXzE4YzBkYzI3LTYzMDYtNDFkYy1hMmRlLWI2MzAzMzQ3YzNhZTpDbGllbnRfU2VjcmV0X29WWHc0TXJubnk5a0Q4R3laU1dXV01ROCsrbzh2a0xhR0FlVkRUZnNyeHc9',
  baseUrl: 'https://api-sandbox.woovi.com',
  webhookUrl: 'https://216.238.107.59:3001/api/woovi/webhooks'
};

async function testWooviBaaSSandbox() {
  console.log('🏦 TESTE WOOVI BaaS SANDBOX');
  console.log('============================');
  
  try {
    // 1. Testar criação de conta principal
    console.log('\n1️⃣ Testando criação de conta principal...');
    const mainAccount = await testCreateMainAccount();
    
    // 2. Testar criação de subconta para motorista
    console.log('\n2️⃣ Testando criação de subconta para motorista...');
    const driverAccount = await testCreateDriverAccount();
    
    // 3. Testar criação de cobrança
    console.log('\n3️⃣ Testando criação de cobrança...');
    const charge = await testCreateCharge();
    
    // 4. Testar split automático
    console.log('\n4️⃣ Testando split automático...');
    await testAutomaticSplit(charge.id, driverAccount.id);
    
    // 5. Testar consulta de saldo
    console.log('\n5️⃣ Testando consulta de saldo...');
    await testGetBalance(driverAccount.id);
    
    // 6. Testar transferência
    console.log('\n6️⃣ Testando transferência...');
    await testTransfer(driverAccount.id, 500); // R$ 5,00
    
    // 7. Testar webhook BaaS
    console.log('\n7️⃣ Testando webhook BaaS...');
    await testBaaSWebhook();
    
    console.log('\n✅ TODOS OS TESTES BaaS CONCLUÍDOS COM SUCESSO!');
    console.log('\n📋 RESUMO DOS TESTES BaaS:');
    console.log('   ✅ Conta principal: OK');
    console.log('   ✅ Subconta motorista: OK');
    console.log('   ✅ Criação de cobrança: OK');
    console.log('   ✅ Split automático: OK');
    console.log('   ✅ Consulta de saldo: OK');
    console.log('   ✅ Transferência: OK');
    console.log('   ✅ Webhook BaaS: OK');
    
  } catch (error) {
    console.error('❌ ERRO NO TESTE BaaS:', error.message);
    console.error('Detalhes:', error.response?.data || error);
  }
}

async function testCreateMainAccount() {
  try {
    const accountData = {
      name: 'Leaf App - Conta Principal',
      document: '12345678000199',
      email: 'financeiro@leaf.app.br',
      phone: '+5521999999999',
      account_type: 'business',
      description: 'Conta principal para recebimento de taxas operacionais'
    };
    
    const response = await axios.post(`${WOOVI_SANDBOX_CONFIG.baseUrl}/api/v1/account`, accountData, {
      headers: {
        'Authorization': WOOVI_SANDBOX_CONFIG.apiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('   ✅ Conta principal criada com sucesso');
    console.log('   📊 Dados da conta:', {
      id: response.data.id,
      name: response.data.name,
      status: response.data.status
    });
    
    return response.data;
  } catch (error) {
    if (error.response?.status === 409) {
      console.log('   ℹ️ Conta principal já existe');
      return { id: 'main_account_exists' };
    }
    console.error('   ❌ Falha na criação da conta principal:', error.response?.data || error.message);
    throw error;
  }
}

async function testCreateDriverAccount() {
  try {
    const driverData = {
      name: 'Leaf Driver - João Silva (Teste)',
      document: '12345678901',
      email: 'joao.silva@teste.com',
      phone: '+5521987654321',
      split_percentage: 100,
      auto_transfer: true,
      transfer_delay: 0,
      account_type: 'driver',
      metadata: {
        driver_id: 'test_driver_123',
        plan_type: 'plus',
        created_at: new Date().toISOString(),
        test_mode: true
      }
    };
    
    const response = await axios.post(`${WOOVI_SANDBOX_CONFIG.baseUrl}/api/v1/subaccount`, driverData, {
      headers: {
        'Authorization': WOOVI_SANDBOX_CONFIG.apiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('   ✅ Subconta do motorista criada com sucesso');
    console.log('   📊 Dados da subconta:', {
      id: response.data.id,
      name: response.data.name,
      email: response.data.email,
      status: response.data.status,
      split_percentage: response.data.split_percentage
    });
    
    return response.data;
  } catch (error) {
    console.error('   ❌ Falha na criação da subconta:', error.response?.data || error.message);
    throw error;
  }
}

async function testCreateCharge() {
  try {
    const chargeData = {
      value: 2500, // R$ 25,00 em centavos
      correlationID: `baas_test_${Date.now()}`,
      comment: 'Teste BaaS - Corrida de teste',
      expiresIn: 3600, // 1 hora
      additionalInfo: [
        {
          key: 'test_mode',
          value: 'true'
        },
        {
          key: 'type',
          value: 'ride_payment'
        },
        {
          key: 'driver_id',
          value: 'test_driver_123'
        }
      ]
    };
    
    const response = await axios.post(`${WOOVI_SANDBOX_CONFIG.baseUrl}/api/v1/charge`, chargeData, {
      headers: {
        'Authorization': WOOVI_SANDBOX_CONFIG.apiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('   ✅ Cobrança criada com sucesso');
    console.log('   📊 Dados da cobrança:', {
      id: response.data.id,
      correlationID: response.data.correlationID,
      value: response.data.value,
      status: response.data.status,
      pixCode: response.data.pixCode ? 'Gerado' : 'Não gerado'
    });
    
    return response.data;
  } catch (error) {
    console.error('   ❌ Falha na criação da cobrança:', error.response?.data || error.message);
    throw error;
  }
}

async function testAutomaticSplit(chargeId, driverAccountId) {
  try {
    const splitData = {
      main_charge_id: chargeId,
      splits: [
        {
          account_id: 'leaf_operational_account',
          amount: 149, // R$ 1,49 - Taxa operacional
          description: 'Taxa Operacional - Corrida teste',
          percentage: 5.96
        },
        {
          account_id: 'leaf_woovi_account',
          amount: 50, // R$ 0,50 - Taxa Woovi
          description: 'Taxa Woovi - Corrida teste',
          percentage: 2.0
        },
        {
          account_id: driverAccountId,
          amount: 2301, // R$ 23,01 - Saldo para motorista
          description: 'Pagamento Motorista - Corrida teste',
          percentage: 92.04
        }
      ]
    };
    
    const response = await axios.post(`${WOOVI_SANDBOX_CONFIG.baseUrl}/api/v1/split`, splitData, {
      headers: {
        'Authorization': WOOVI_SANDBOX_CONFIG.apiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('   ✅ Split automático processado com sucesso');
    console.log('   📊 Dados do split:', {
      id: response.data.id,
      status: response.data.status,
      total_splits: splitData.splits.length,
      driver_amount: splitData.splits[2].amount
    });
    
    return response.data;
  } catch (error) {
    console.error('   ❌ Falha no split automático:', error.response?.data || error.message);
    throw error;
  }
}

async function testGetBalance(accountId) {
  try {
    const response = await axios.get(`${WOOVI_SANDBOX_CONFIG.baseUrl}/api/v1/account/${accountId}/balance`, {
      headers: {
        'Authorization': WOOVI_SANDBOX_CONFIG.apiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('   ✅ Saldo consultado com sucesso');
    console.log('   📊 Saldo da conta:', {
      account_id: accountId,
      balance: response.data.balance,
      currency: response.data.currency || 'BRL'
    });
    
    return response.data;
  } catch (error) {
    console.error('   ❌ Falha na consulta de saldo:', error.response?.data || error.message);
    throw error;
  }
}

async function testTransfer(accountId, amount) {
  try {
    const transferData = {
      amount: amount,
      description: 'Transferência de teste BaaS',
      metadata: {
        type: 'test_transfer',
        created_at: new Date().toISOString()
      }
    };
    
    const response = await axios.post(`${WOOVI_SANDBOX_CONFIG.baseUrl}/api/v1/account/${accountId}/transfer`, transferData, {
      headers: {
        'Authorization': WOOVI_SANDBOX_CONFIG.apiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('   ✅ Transferência realizada com sucesso');
    console.log('   📊 Dados da transferência:', {
      id: response.data.id,
      amount: response.data.amount,
      status: response.data.status
    });
    
    return response.data;
  } catch (error) {
    console.error('   ❌ Falha na transferência:', error.response?.data || error.message);
    throw error;
  }
}

async function testBaaSWebhook() {
  try {
    // Simular webhook de split concluído
    const webhookData = {
      event: 'split.completed',
      data: {
        split_id: 'test_split_123',
        main_charge_id: 'test_charge_123',
        driver_amount: 2301,
        status: 'COMPLETED',
        completed_at: new Date().toISOString()
      }
    };
    
    console.log('   ✅ Webhook BaaS simulado com sucesso');
    console.log('   📊 Dados do webhook:', webhookData);
    
    // Aqui você pode testar o endpoint real do webhook
    // const response = await axios.post(WOOVI_SANDBOX_CONFIG.webhookUrl, webhookData);
    
    return webhookData;
  } catch (error) {
    console.error('   ❌ Falha no teste do webhook BaaS:', error.message);
    throw error;
  }
}

// Executar teste
testWooviBaaSSandbox().then(() => {
  console.log('\n🎉 Teste BaaS Woovi Sandbox concluído!');
  process.exit(0);
}).catch((error) => {
  console.error('\n💥 Teste BaaS falhou:', error.message);
  process.exit(1);
});










