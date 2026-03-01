const axios = require('axios');

// Configuração Sandbox Woovi
const WOOVI_CONFIG = {
  apiToken: 'Q2xpZW50X0lkXzE4YzBkYzI3LTYzMDYtNDFkYy1hMmRlLWI2MzAzMzQ3YzNhZTpDbGllbnRfU2VjcmV0X29WWHc0TXJubnk5a0Q4R3laU1dXV01ROCsrbzh2a0xhR0FlVkRUZnNyeHc9',
  baseUrl: 'https://api.woovi-sandbox.com/api/v1',
  appId: 'Client_Id_18c0dc27-6306-41dc-a2de-b6303347c3ae',
  environment: 'sandbox'
};

// Função para gerar valores aleatórios
function getRandomValue() {
  const values = [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000, 5500, 6000, 6500, 7000, 7500, 8000, 8500, 9000, 9500, 10000];
  return values[Math.floor(Math.random() * values.length)];
}

// Função para gerar nomes aleatórios
function getRandomName() {
  const names = ['João Silva', 'Maria Santos', 'Pedro Oliveira', 'Ana Costa', 'Carlos Lima', 'Lucia Ferreira', 'Roberto Alves', 'Fernanda Rocha', 'Marcos Pereira', 'Juliana Souza'];
  return names[Math.floor(Math.random() * names.length)];
}

// Função para gerar emails aleatórios
function getRandomEmail() {
  const domains = ['gmail.com', 'hotmail.com', 'yahoo.com', 'outlook.com'];
  const names = ['joao', 'maria', 'pedro', 'ana', 'carlos', 'lucia', 'roberto', 'fernanda', 'marcos', 'juliana'];
  const name = names[Math.floor(Math.random() * names.length)];
  const domain = domains[Math.floor(Math.random() * domains.length)];
  return `${name}${Math.floor(Math.random() * 1000)}@${domain}`;
}

// Função para gerar CPF aleatório
function getRandomCPF() {
  const cpf = Math.floor(Math.random() * 900000000) + 100000000;
  return cpf.toString().padStart(11, '0');
}

// Teste 1: Verificar conexão com a API
async function testConnection() {
  console.log('🔍 Testando conexão com a API Woovi...');
  
  try {
    const response = await axios.get(`${WOOVI_CONFIG.baseUrl}/charge`, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiToken,
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ Conexão estabelecida com sucesso!');
    console.log(`📊 Total de cobranças existentes: ${response.data.charges.length}`);
    return true;
  } catch (error) {
    console.error('❌ Erro na conexão:', error.response?.data || error.message);
    return false;
  }
}

// Teste 2: Criar 25 cobranças aleatórias
async function createRandomCharges() {
  console.log('\n💰 Criando 25 cobranças aleatórias...');
  
  const charges = [];
  const promises = [];
  
  for (let i = 0; i < 25; i++) {
    const value = getRandomValue();
    const correlationID = `leaf_test_${Date.now()}_${i}`;
    
    const chargeData = {
      value: value,
      correlationID: correlationID,
      comment: `Teste Leaf App - Cobrança ${i + 1}`,
      expiresIn: 3600,
      additionalInfo: [
        {
          key: 'app',
          value: 'leaf'
        },
        {
          key: 'test',
          value: 'true'
        }
      ]
    };
    
    promises.push(
      axios.post(`${WOOVI_CONFIG.baseUrl}/charge`, chargeData, {
        headers: {
          'Authorization': WOOVI_CONFIG.apiToken,
          'Content-Type': 'application/json'
        }
      }).then(response => {
        console.log(`✅ Cobrança ${i + 1} criada: R$ ${(value / 100).toFixed(2)} - ID: ${response.data.charge.id}`);
        charges.push({
          id: response.data.charge.id,
          value: value,
          correlationID: correlationID,
          qrCode: response.data.charge.qrCodeImage
        });
      }).catch(error => {
        console.error(`❌ Erro na cobrança ${i + 1}:`, error.response?.data || error.message);
      })
    );
  }
  
  await Promise.all(promises);
  console.log(`\n📊 Total de cobranças criadas: ${charges.length}/25`);
  return charges;
}

// Teste 3: Criar 10 clientes BaaS
async function createBaaSClients() {
  console.log('\n👥 Criando 10 clientes BaaS...');
  
  const clients = [];
  const promises = [];
  
  for (let i = 0; i < 10; i++) {
    const clientData = {
      name: getRandomName(),
      email: getRandomEmail(),
      document: getRandomCPF(),
      phone: `119${Math.floor(Math.random() * 90000000) + 10000000}`,
      additionalInfo: [
        {
          key: 'app',
          value: 'leaf'
        },
        {
          key: 'type',
          value: 'driver'
        },
        {
          key: 'test',
          value: 'true'
        }
      ]
    };
    
    promises.push(
      axios.post(`${WOOVI_CONFIG.baseUrl}/customer`, clientData, {
        headers: {
          'Authorization': WOOVI_CONFIG.apiToken,
          'Content-Type': 'application/json'
        }
      }).then(response => {
        console.log(`✅ Cliente ${i + 1} criado: ${clientData.name} - ID: ${response.data.customer.id}`);
        clients.push({
          id: response.data.customer.id,
          name: clientData.name,
          email: clientData.email,
          document: clientData.document
        });
      }).catch(error => {
        console.error(`❌ Erro no cliente ${i + 1}:`, error.response?.data || error.message);
      })
    );
  }
  
  await Promise.all(promises);
  console.log(`\n📊 Total de clientes criados: ${clients.length}/10`);
  return clients;
}

// Teste 4: Listar cobranças criadas
async function listCharges() {
  console.log('\n📋 Listando cobranças criadas...');
  
  try {
    const response = await axios.get(`${WOOVI_CONFIG.baseUrl}/charge`, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiToken,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Total de cobranças encontradas: ${response.data.charges.length}`);
    
    // Mostrar as últimas 5 cobranças
    const recentCharges = response.data.charges.slice(-5);
    console.log('\n📊 Últimas 5 cobranças:');
    recentCharges.forEach((charge, index) => {
      console.log(`${index + 1}. ID: ${charge.id} | Valor: R$ ${(charge.value / 100).toFixed(2)} | Status: ${charge.status}`);
    });
    
    return response.data.charges;
  } catch (error) {
    console.error('❌ Erro ao listar cobranças:', error.response?.data || error.message);
    return [];
  }
}

// Teste 5: Listar clientes criados
async function listCustomers() {
  console.log('\n👥 Listando clientes criados...');
  
  try {
    const response = await axios.get(`${WOOVI_CONFIG.baseUrl}/customer`, {
      headers: {
        'Authorization': WOOVI_CONFIG.apiToken,
        'Content-Type': 'application/json'
      }
    });
    
    console.log(`✅ Total de clientes encontrados: ${response.data.customers.length}`);
    
    // Mostrar os últimos 5 clientes
    const recentCustomers = response.data.customers.slice(-5);
    console.log('\n📊 Últimos 5 clientes:');
    recentCustomers.forEach((customer, index) => {
      console.log(`${index + 1}. Nome: ${customer.name} | Email: ${customer.email} | Documento: ${customer.document}`);
    });
    
    return response.data.customers;
  } catch (error) {
    console.error('❌ Erro ao listar clientes:', error.response?.data || error.message);
    return [];
  }
}

// Função principal
async function runTests() {
  console.log('🚀 Iniciando testes da API Woovi Sandbox...\n');
  
  // Teste 1: Conexão
  const connectionOk = await testConnection();
  if (!connectionOk) {
    console.log('❌ Falha na conexão. Abortando testes.');
    return;
  }
  
  // Teste 2: Criar cobranças
  const charges = await createRandomCharges();
  
  // Teste 3: Criar clientes
  const clients = await createBaaSClients();
  
  // Teste 4: Listar cobranças
  const allCharges = await listCharges();
  
  // Teste 5: Listar clientes
  const allCustomers = await listCustomers();
  
  // Resumo final
  console.log('\n🎯 RESUMO DOS TESTES:');
  console.log(`✅ Cobranças criadas: ${charges.length}/25`);
  console.log(`✅ Clientes criados: ${clients.length}/10`);
  console.log(`📊 Total de cobranças na conta: ${allCharges.length}`);
  console.log(`👥 Total de clientes na conta: ${allCustomers.length}`);
  
  console.log('\n🔗 Acesse o painel sandbox para ver os dados:');
  console.log('https://app.woovi-sandbox.com/');
  
  console.log('\n✅ Testes concluídos!');
}

// Executar testes
runTests().catch(console.error);
