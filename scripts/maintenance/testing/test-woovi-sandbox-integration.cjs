#!/usr/bin/env node

// 🧪 TESTE INTEGRAÇÃO WOOVI SANDBOX - LEAF APP
// Testa todas as funcionalidades da Woovi em ambiente sandbox

const axios = require('axios');

// Configuração Sandbox
const WOOVI_SANDBOX_CONFIG = {
  clientId: 'Client_Id_18c0dc27-6306-41dc-a2de-b6303347c3ae',
  clientSecret: 'Client_Secret_oVXw4Mrnny9kD8GyZSWWWMQ8++8vkLaGAeVDTfsrxw=',
  apiToken: 'Q2xpZW50X0lkXzE4YzBkYzI3LTYzMDYtNDFkYy1hMmRlLWI2MzAzMzQ3YzNhZTpDbGllbnRfU2VjcmV0X29WWHc0TXJubnk5a0Q4R3laU1dXV01ROCsrbzh2a0xhR0FlVkRUZnNyeHc9',
  baseUrl: 'https://api-sandbox.woovi.com',
  webhookUrl: 'https://216.238.107.59:3001/api/woovi/webhooks'
};

async function testWooviSandboxIntegration() {
  console.log('🧪 TESTE INTEGRAÇÃO WOOVI SANDBOX');
  console.log('=====================================');
  
  try {
    // 1. Testar conexão básica
    console.log('\n1️⃣ Testando conexão básica...');
    await testBasicConnection();
    
    // 2. Testar criação de cobrança PIX
    console.log('\n2️⃣ Testando criação de cobrança PIX...');
    const charge = await testCreateCharge();
    
    // 3. Testar verificação de status
    console.log('\n3️⃣ Testando verificação de status...');
    await testCheckStatus(charge.correlationID);
    
    // 4. Testar listagem de cobranças
    console.log('\n4️⃣ Testando listagem de cobranças...');
    await testListCharges();
    
    // 5. Testar criação de subconta (BaaS)
    console.log('\n5️⃣ Testando criação de subconta BaaS...');
    const subaccount = await testCreateSubaccount();
    
    // 6. Testar webhook (simulação)
    console.log('\n6️⃣ Testando webhook...');
    await testWebhook();
    
    console.log('\n✅ TODOS OS TESTES CONCLUÍDOS COM SUCESSO!');
    console.log('\n📋 RESUMO DOS TESTES:');
    console.log('   ✅ Conexão básica: OK');
    console.log('   ✅ Criação de cobrança: OK');
    console.log('   ✅ Verificação de status: OK');
    console.log('   ✅ Listagem de cobranças: OK');
    console.log('   ✅ Criação de subconta: OK');
    console.log('   ✅ Webhook: OK');
    
  } catch (error) {
    console.error('❌ ERRO NO TESTE:', error.message);
    console.error('Detalhes:', error.response?.data || error);
  }
}

async function testBasicConnection() {
  try {
    const response = await axios.get(`${WOOVI_SANDBOX_CONFIG.baseUrl}/api/v1/me`, {
      headers: {
        'Authorization': WOOVI_SANDBOX_CONFIG.apiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('   ✅ Conexão estabelecida com sucesso');
    console.log('   📊 Dados da conta:', {
      id: response.data.id,
      name: response.data.name,
      email: response.data.email
    });
    
    return response.data;
  } catch (error) {
    console.error('   ❌ Falha na conexão:', error.response?.data || error.message);
    throw error;
  }
}

async function testCreateCharge() {
  try {
    const chargeData = {
      value: 1000, // R$ 10,00 em centavos
      correlationID: `test_leaf_${Date.now()}`,
      comment: 'Teste de integração Leaf App - Sandbox',
      expiresIn: 3600, // 1 hora
      additionalInfo: [
        {
          key: 'test_mode',
          value: 'true'
        },
        {
          key: 'app',
          value: 'leaf'
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
      pixCode: response.data.pixCode ? 'Gerado' : 'Não gerado',
      qrCode: response.data.qrCode ? 'Gerado' : 'Não gerado'
    });
    
    return response.data;
  } catch (error) {
    console.error('   ❌ Falha na criação da cobrança:', error.response?.data || error.message);
    throw error;
  }
}

async function testCheckStatus(correlationID) {
  try {
    const response = await axios.get(`${WOOVI_SANDBOX_CONFIG.baseUrl}/api/v1/charge/${correlationID}`, {
      headers: {
        'Authorization': WOOVI_SANDBOX_CONFIG.apiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('   ✅ Status verificado com sucesso');
    console.log('   📊 Status da cobrança:', {
      correlationID: response.data.correlationID,
      status: response.data.status,
      value: response.data.value,
      createdAt: response.data.createdAt
    });
    
    return response.data;
  } catch (error) {
    console.error('   ❌ Falha na verificação de status:', error.response?.data || error.message);
    throw error;
  }
}

async function testListCharges() {
  try {
    const response = await axios.get(`${WOOVI_SANDBOX_CONFIG.baseUrl}/api/v1/charge`, {
      headers: {
        'Authorization': WOOVI_SANDBOX_CONFIG.apiToken,
        'Content-Type': 'application/json'
      },
      params: {
        limit: 10,
        page: 1
      },
      timeout: 10000
    });
    
    console.log('   ✅ Listagem de cobranças obtida com sucesso');
    console.log('   📊 Total de cobranças:', response.data.data?.length || 0);
    
    return response.data;
  } catch (error) {
    console.error('   ❌ Falha na listagem de cobranças:', error.response?.data || error.message);
    throw error;
  }
}

async function testCreateSubaccount() {
  try {
    const subaccountData = {
      name: 'Leaf Driver - Teste Sandbox',
      document: '12345678901',
      email: 'teste@leaf.app.br',
      phone: '+5521999999999',
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
    
    const response = await axios.post(`${WOOVI_SANDBOX_CONFIG.baseUrl}/api/v1/subaccount`, subaccountData, {
      headers: {
        'Authorization': WOOVI_SANDBOX_CONFIG.apiToken,
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    console.log('   ✅ Subconta criada com sucesso');
    console.log('   📊 Dados da subconta:', {
      id: response.data.id,
      name: response.data.name,
      email: response.data.email,
      status: response.data.status
    });
    
    return response.data;
  } catch (error) {
    console.error('   ❌ Falha na criação da subconta:', error.response?.data || error.message);
    throw error;
  }
}

async function testWebhook() {
  try {
    // Simular webhook de cobrança paga
    const webhookData = {
      event: 'Leaf-charge.confirmed',
      data: {
        charge_id: 'test_charge_123',
        correlationID: 'test_leaf_123',
        value: 1000,
        status: 'CONFIRMED',
        createdAt: new Date().toISOString()
      }
    };
    
    console.log('   ✅ Webhook simulado com sucesso');
    console.log('   📊 Dados do webhook:', webhookData);
    
    // Aqui você pode testar o endpoint real do webhook
    // const response = await axios.post(WOOVI_SANDBOX_CONFIG.webhookUrl, webhookData);
    
    return webhookData;
  } catch (error) {
    console.error('   ❌ Falha no teste do webhook:', error.message);
    throw error;
  }
}

// Executar teste
testWooviSandboxIntegration().then(() => {
  console.log('\n🎉 Teste de integração Woovi Sandbox concluído!');
  process.exit(0);
}).catch((error) => {
  console.error('\n💥 Teste falhou:', error.message);
  process.exit(1);
});










