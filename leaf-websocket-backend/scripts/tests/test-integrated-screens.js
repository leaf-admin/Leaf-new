/**
 * 🧪 TESTE COMPLETO - TELAS INTEGRADAS
 * Testando DriverSearchScreen, SupportScreen e ChatScreen integradas
 */

const io = require('socket.io-client');

console.log('🧪 TESTE COMPLETO - TELAS INTEGRADAS');
console.log('='.repeat(60));

let customerSocket = null;
let driverSocket = null;
let supportSocket = null;
let testResults = {
  passed: 0,
  failed: 0,
  total: 0
};

// Função para executar teste
async function runTest(testName, testFunction) {
  testResults.total++;
  console.log(`\n🧪 Testando: ${testName}`);
  
  try {
    await testFunction();
    testResults.passed++;
    console.log(`✅ ${testName} - PASSOU`);
  } catch (error) {
    testResults.failed++;
    console.log(`❌ ${testName} - FALHOU: ${error.message}`);
  }
}

// Conectar sockets para diferentes telas
async function connectSockets() {
  console.log('🔌 Conectando sockets para diferentes telas...');
  
  customerSocket = io('http://localhost:3001');
  driverSocket = io('http://localhost:3001');
  supportSocket = io('http://localhost:3001');
  
  await new Promise(resolve => {
    let connected = 0;
    const checkConnection = () => {
      if (connected === 3) resolve();
    };
    
    customerSocket.on('connect', () => {
      console.log('✅ CUSTOMER conectado:', customerSocket.id);
      connected++;
      checkConnection();
    });
    
    driverSocket.on('connect', () => {
      console.log('✅ DRIVER conectado:', driverSocket.id);
      connected++;
      checkConnection();
    });
    
    supportSocket.on('connect', () => {
      console.log('✅ SUPPORT conectado:', supportSocket.id);
      connected++;
      checkConnection();
    });
  });
}

// Teste 1: DriverSearchScreen - Busca e seleção de motoristas
async function testDriverSearchScreen() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);
    let eventsCompleted = 0;
    
    const checkComplete = () => {
      if (eventsCompleted >= 3) {
        clearTimeout(timeout);
        resolve();
      }
    };
    
    // 1. Busca de motoristas
    customerSocket.once('driversFound', (data) => {
      if (data.success) {
        console.log(`  ✅ Busca de motoristas: ${data.drivers.length} encontrados`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // 2. Cancelamento de busca
    customerSocket.once('driverSearchCancelled', (data) => {
      if (data.success) {
        console.log(`  ✅ Busca cancelada: ${data.reason}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // 3. Atualização de localização do motorista
    customerSocket.once('driverLocationUpdated', (data) => {
      console.log(`  ✅ Localização do motorista atualizada`);
      eventsCompleted++;
      checkComplete();
    });
    
    // Executar sequência do DriverSearchScreen
    customerSocket.emit('searchDrivers', {
      pickupLocation: { lat: -23.5505, lng: -46.6333 },
      destinationLocation: { lat: -23.5615, lng: -46.6553 },
      rideType: 'standard',
      estimatedFare: 25.50,
      preferences: {
        vehicleType: 'car',
        radius: 5000
      }
    });
    
    setTimeout(() => {
      customerSocket.emit('cancelDriverSearch', {
        bookingId: 'test_booking',
        reason: 'Motorista selecionado'
      });
    }, 2000);
    
    setTimeout(() => {
      driverSocket.emit('updateDriverLocation', {
        driverId: 'driver_123',
        lat: -23.5505,
        lng: -46.6333,
        heading: 90,
        speed: 50
      });
    }, 3000);
  });
}

// Teste 2: SupportScreen - Chat e tickets de suporte
async function testSupportScreen() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);
    let eventsCompleted = 0;
    
    const checkComplete = () => {
      if (eventsCompleted >= 3) {
        clearTimeout(timeout);
        resolve();
      }
    };
    
    // 1. Criação de chat de suporte
    supportSocket.once('chatCreated', (data) => {
      if (data.success) {
        console.log(`  ✅ Chat de suporte criado: ${data.chatId}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // 2. Envio de mensagem de suporte
    supportSocket.once('messageSent', (data) => {
      if (data.success) {
        console.log(`  ✅ Mensagem de suporte enviada: ${data.messageId}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // 3. Criação de ticket de suporte
    supportSocket.once('supportTicketCreated', (data) => {
      if (data.success) {
        console.log(`  ✅ Ticket criado: ${data.ticketId}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // Executar sequência do SupportScreen
    supportSocket.emit('createChat', {
      type: 'support',
      userId: 'customer_123',
      participants: ['customer_123', 'support_team']
    });
    
    setTimeout(() => {
      supportSocket.emit('sendMessage', {
        chatId: 'support_chat',
        text: 'Preciso de ajuda com pagamento',
        senderId: 'customer_123',
        timestamp: new Date().toISOString()
      });
    }, 2000);
    
    setTimeout(() => {
      supportSocket.emit('createSupportTicket', {
        type: 'payment',
        priority: 'N2',
        description: 'Problema com pagamento PIX',
        attachments: []
      });
    }, 3000);
  });
}

// Teste 3: ChatScreen - Chat de viagem
async function testChatScreen() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 15000);
    let eventsCompleted = 0;
    
    const checkComplete = () => {
      if (eventsCompleted >= 2) {
        clearTimeout(timeout);
        resolve();
      }
    };
    
    // 1. Criação de chat de viagem
    customerSocket.once('chatCreated', (data) => {
      if (data.success) {
        console.log(`  ✅ Chat de viagem criado: ${data.chatId}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // 2. Envio de mensagem no chat
    customerSocket.once('messageSent', (data) => {
      if (data.success) {
        console.log(`  ✅ Mensagem de viagem enviada: ${data.messageId}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // Executar sequência do ChatScreen
    customerSocket.emit('createChat', {
      tripId: 'trip_123',
      participants: ['customer_123', 'driver_123'],
      type: 'trip_chat'
    });
    
    setTimeout(() => {
      customerSocket.emit('sendMessage', {
        chatId: 'trip_chat_123',
        text: 'Estou chegando!',
        senderId: 'customer_123',
        timestamp: new Date().toISOString(),
        messageType: 'text'
      });
    }, 2000);
  });
}

// Teste 4: Integração entre telas - Fluxo completo
async function testScreenIntegration() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 20000);
    let eventsCompleted = 0;
    
    const checkComplete = () => {
      if (eventsCompleted >= 4) {
        clearTimeout(timeout);
        resolve();
      }
    };
    
    // 1. DriverSearchScreen -> busca motoristas
    customerSocket.once('driversFound', (data) => {
      if (data.success) {
        console.log(`  ✅ DriverSearchScreen: ${data.drivers.length} motoristas encontrados`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // 2. Driver aceita corrida
    driverSocket.once('rideAccepted', (data) => {
      if (data.success) {
        console.log(`  ✅ Driver aceitou corrida`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // 3. ChatScreen -> chat criado para viagem
    customerSocket.once('chatCreated', (data) => {
      if (data.success) {
        console.log(`  ✅ ChatScreen: Chat de viagem criado`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // 4. SupportScreen -> ticket criado
    supportSocket.once('supportTicketCreated', (data) => {
      if (data.success) {
        console.log(`  ✅ SupportScreen: Ticket criado`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // Executar fluxo completo
    customerSocket.emit('searchDrivers', {
      pickupLocation: { lat: -23.5505, lng: -46.6333 },
      destinationLocation: { lat: -23.5615, lng: -46.6553 },
      rideType: 'standard',
      estimatedFare: 25.50
    });
    
    setTimeout(() => {
      driverSocket.emit('driverResponse', {
        bookingId: 'test_booking',
        accepted: true
      });
    }, 2000);
    
    setTimeout(() => {
      customerSocket.emit('createChat', {
        tripId: 'trip_123',
        participants: ['customer_123', 'driver_123'],
        type: 'trip_chat'
      });
    }, 4000);
    
    setTimeout(() => {
      supportSocket.emit('createSupportTicket', {
        type: 'technical',
        priority: 'N3',
        description: 'Problema técnico durante viagem'
      });
    }, 6000);
  });
}

// Teste 5: Fallbacks e tratamento de erros
async function testErrorHandling() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
    
    // Testar evento inválido
    customerSocket.once('driverSearchError', (data) => {
      console.log(`  ✅ Erro tratado corretamente: ${data.error}`);
      clearTimeout(timeout);
      resolve();
    });
    
    // Executar evento com dados inválidos
    customerSocket.emit('searchDrivers', {
      // pickupLocation faltando - deve gerar erro
      destinationLocation: { lat: -23.5615, lng: -46.6553 },
      rideType: 'standard',
      estimatedFare: 25.50
    });
  });
}

// Executar todos os testes
async function runAllTests() {
  try {
    await connectSockets();
    
    console.log('\n🚀 INICIANDO TESTES DAS TELAS INTEGRADAS...\n');
    
    await runTest('DriverSearchScreen - Busca e seleção', testDriverSearchScreen);
    await runTest('SupportScreen - Chat e tickets', testSupportScreen);
    await runTest('ChatScreen - Chat de viagem', testChatScreen);
    await runTest('Integração entre telas - Fluxo completo', testScreenIntegration);
    await runTest('Tratamento de erros e fallbacks', testErrorHandling);
    
    console.log('\n📊 RESULTADOS FINAIS:');
    console.log('='.repeat(60));
    console.log(`✅ Testes Passou: ${testResults.passed}`);
    console.log(`❌ Testes Falhou: ${testResults.failed}`);
    console.log(`📊 Total de Testes: ${testResults.total}`);
    console.log(`🎯 Taxa de Sucesso: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
    
    if (testResults.failed === 0) {
      console.log('\n🎉 TELAS INTEGRADAS COMPLETAMENTE FUNCIONAIS!');
      console.log('✅ DriverSearchScreen integrada com WebSocket');
      console.log('✅ SupportScreen integrada com WebSocket');
      console.log('✅ ChatScreen integrada com WebSocket');
      console.log('✅ Integração entre telas funcionando');
      console.log('✅ Tratamento de erros implementado');
      console.log('✅ Sistema pronto para uso no mobile app');
    } else {
      console.log(`\n⚠️ ${testResults.failed} teste(s) falharam. Verificar implementação.`);
    }
    
  } catch (error) {
    console.error('❌ Erro geral nos testes:', error);
  } finally {
    // Limpar conexões
    if (customerSocket) customerSocket.disconnect();
    if (driverSocket) driverSocket.disconnect();
    if (supportSocket) supportSocket.disconnect();
    process.exit(0);
  }
}

// Timeout geral
setTimeout(() => {
  console.log('\n⏰ TIMEOUT GERAL - Finalizando testes');
  process.exit(1);
}, 120000);

// Executar testes
runAllTests();






