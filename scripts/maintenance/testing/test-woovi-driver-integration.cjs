const axios = require('axios');

// Configuração da API
const API_BASE_URL = 'http://localhost:3003/api';

// Dados de teste para motorista
const testDriverData = {
  name: 'João Silva Motorista',
  email: 'joao.motorista@teste.com',
  phone: '11999999999',
  cpf: '12345678901',
  driverId: 'driver_test_123'
};

// Dados de teste para corrida
const testRideData = {
  wooviClientId: null, // Será preenchido após criar o cliente
  value: 2500, // R$ 25,00 em centavos
  description: 'Ganhos da corrida #123 - Centro para Aeroporto',
  rideId: 'ride_test_123'
};

// Função para testar criação de cliente
async function testCreateDriverClient() {
  console.log('🚗 Testando criação de cliente Woovi para motorista...');
  
  try {
    const response = await axios.post(`${API_BASE_URL}/driver/create-client`, testDriverData);
    
    if (response.data.success) {
      console.log('✅ Cliente criado com sucesso!');
      console.log('📊 ID do cliente:', response.data.wooviClientId);
      console.log('👤 Dados do cliente:', JSON.stringify(response.data.customer, null, 2));
      
      // Salvar o ID do cliente para usar nos próximos testes
      testRideData.wooviClientId = response.data.wooviClientId;
      return response.data.wooviClientId;
    } else {
      throw new Error(response.data.error);
    }
  } catch (error) {
    console.error('❌ Erro ao criar cliente:', error.response?.data || error.message);
    return null;
  }
}

// Função para testar criação de cobrança de ganhos
async function testCreateRideEarnings(wooviClientId) {
  console.log('\n💰 Testando criação de cobrança de ganhos...');
  
  try {
    const rideData = {
      ...testRideData,
      wooviClientId: wooviClientId
    };
    
    const response = await axios.post(`${API_BASE_URL}/driver/create-earnings`, rideData);
    
    if (response.data.success) {
      console.log('✅ Cobrança de ganhos criada com sucesso!');
      console.log('📊 ID da cobrança:', response.data.charge.id);
      console.log('💰 Valor:', `R$ ${(response.data.charge.value / 100).toFixed(2)}`);
      console.log('📝 Descrição:', response.data.charge.comment);
      return response.data.charge.id;
    } else {
      throw new Error(response.data.error);
    }
  } catch (error) {
    console.error('❌ Erro ao criar cobrança de ganhos:', error.response?.data || error.message);
    return null;
  }
}

// Função para testar listagem de cobranças
async function testGetDriverCharges(wooviClientId) {
  console.log('\n📋 Testando listagem de cobranças do motorista...');
  
  try {
    const response = await axios.get(`${API_BASE_URL}/driver/${wooviClientId}/charges`);
    
    if (response.data.success) {
      console.log('✅ Cobranças listadas com sucesso!');
      console.log(`📊 Total de cobranças: ${response.data.charges.length}`);
      
      // Mostrar as últimas 3 cobranças
      const recentCharges = response.data.charges.slice(-3);
      console.log('\n📋 Últimas 3 cobranças:');
      recentCharges.forEach((charge, index) => {
        console.log(`${index + 1}. ${charge.comment} - R$ ${(charge.value / 100).toFixed(2)} - ${charge.status}`);
      });
      
      return response.data.charges;
    } else {
      throw new Error(response.data.error);
    }
  } catch (error) {
    console.error('❌ Erro ao listar cobranças:', error.response?.data || error.message);
    return [];
  }
}

// Função para testar verificação de saldo
async function testGetDriverBalance(wooviClientId) {
  console.log('\n💳 Testando verificação de saldo do motorista...');
  
  try {
    const response = await axios.get(`${API_BASE_URL}/driver/${wooviClientId}/balance`);
    
    if (response.data.success) {
      console.log('✅ Saldo verificado com sucesso!');
      console.log(`💰 Saldo total: R$ ${(response.data.balance / 100).toFixed(2)}`);
      console.log(`📊 Total de transações: ${response.data.totalCharges}`);
      return response.data.balance;
    } else {
      throw new Error(response.data.error);
    }
  } catch (error) {
    console.error('❌ Erro ao verificar saldo:', error.response?.data || error.message);
    return 0;
  }
}

// Função para testar atualização de cliente
async function testUpdateDriverClient(wooviClientId) {
  console.log('\n✏️ Testando atualização de dados do cliente...');
  
  try {
    const updateData = {
      name: 'João Silva Motorista Atualizado',
      phone: '11988888888'
    };
    
    const response = await axios.put(`${API_BASE_URL}/driver/${wooviClientId}/update`, updateData);
    
    if (response.data.success) {
      console.log('✅ Cliente atualizado com sucesso!');
      console.log('👤 Nome atualizado:', response.data.customer.name);
      console.log('📞 Telefone atualizado:', response.data.customer.phone);
      return true;
    } else {
      throw new Error(response.data.error);
    }
  } catch (error) {
    console.error('❌ Erro ao atualizar cliente:', error.response?.data || error.message);
    return false;
  }
}

// Função para testar simulação de pagamento
async function testSimulatePayment(chargeId) {
  console.log('\n🔄 Testando simulação de pagamento...');
  
  try {
    const response = await axios.post(`${API_BASE_URL}/driver/simulate-payment`, {
      chargeId: chargeId
    });
    
    if (response.data.success) {
      console.log('✅ Pagamento simulado com sucesso!');
      console.log('📊 ID da cobrança:', response.data.chargeId);
      return true;
    } else {
      throw new Error(response.data.error);
    }
  } catch (error) {
    console.error('❌ Erro ao simular pagamento:', error.response?.data || error.message);
    return false;
  }
}

// Função principal de teste
async function runDriverIntegrationTests() {
  console.log('🚀 Iniciando testes de integração Woovi para motoristas...\n');
  
  // Teste 1: Criar cliente
  const wooviClientId = await testCreateDriverClient();
  if (!wooviClientId) {
    console.log('❌ Falha na criação do cliente. Abortando testes.');
    return;
  }
  
  // Teste 2: Criar cobrança de ganhos
  const chargeId = await testCreateRideEarnings(wooviClientId);
  if (!chargeId) {
    console.log('⚠️ Falha na criação da cobrança, mas continuando os testes...');
  }
  
  // Teste 3: Listar cobranças
  const charges = await testGetDriverCharges(wooviClientId);
  
  // Teste 4: Verificar saldo
  const balance = await testGetDriverBalance(wooviClientId);
  
  // Teste 5: Atualizar cliente
  const updateSuccess = await testUpdateDriverClient(wooviClientId);
  
  // Teste 6: Simular pagamento (se houver cobrança)
  if (chargeId) {
    await testSimulatePayment(chargeId);
  }
  
  // Resumo final
  console.log('\n🎯 RESUMO DOS TESTES:');
  console.log(`✅ Cliente criado: ${wooviClientId ? 'Sim' : 'Não'}`);
  console.log(`✅ Cobrança criada: ${chargeId ? 'Sim' : 'Não'}`);
  console.log(`✅ Cobranças listadas: ${charges.length} encontradas`);
  console.log(`✅ Saldo verificado: R$ ${(balance / 100).toFixed(2)}`);
  console.log(`✅ Cliente atualizado: ${updateSuccess ? 'Sim' : 'Não'}`);
  
  console.log('\n🔗 Acesse o painel sandbox para ver os dados:');
  console.log('https://app.woovi-sandbox.com/');
  
  console.log('\n✅ Testes de integração concluídos!');
}

// Executar testes
runDriverIntegrationTests().catch(console.error);










