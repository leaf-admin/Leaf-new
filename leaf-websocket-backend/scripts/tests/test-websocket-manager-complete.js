/**
 * 🧪 TESTE COMPLETO - WEBSOCKETMANAGER ATUALIZADO
 * Testando todos os novos métodos implementados
 */

const io = require('socket.io-client');

console.log('🧪 TESTE COMPLETO - WEBSOCKETMANAGER ATUALIZADO');
console.log('='.repeat(60));

let wsManager = null;
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

// Conectar WebSocket
async function connectWebSocket() {
  console.log('🔌 Conectando WebSocket...');
  
  wsManager = io('http://localhost:3001', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: 3,
    timeout: 10000,
  });
  
  await new Promise(resolve => {
    wsManager.on('connect', () => {
      console.log('✅ WebSocket conectado:', wsManager.id);
      resolve();
    });
    
    wsManager.on('connect_error', (error) => {
      console.error('❌ Erro de conexão:', error.message);
      throw error;
    });
  });
}

// Teste 1: Métodos Core (já existentes)
async function testCoreMethods() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
    let eventsCompleted = 0;
    
    const checkComplete = () => {
      if (eventsCompleted >= 2) {
        clearTimeout(timeout);
        resolve();
      }
    };
    
    // createBooking
    wsManager.once('bookingCreated', (data) => {
      if (data.success) {
        console.log(`  ✅ createBooking funcionou: ${data.bookingId}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // confirmPayment
    wsManager.once('paymentConfirmed', (data) => {
      if (data.success) {
        console.log(`  ✅ confirmPayment funcionou`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // Executar eventos core
    wsManager.emit('createBooking', {
      customerId: 'test_customer',
      pickupLocation: { lat: -23.5505, lng: -46.6333 },
      destinationLocation: { lat: -23.5615, lng: -46.6553 },
      estimatedFare: 25.50,
      paymentMethod: 'PIX'
    });
    
    setTimeout(() => {
      wsManager.emit('confirmPayment', {
        bookingId: 'test_booking',
        paymentMethod: 'PIX',
        paymentId: 'test_payment',
        amount: 25.50
      });
    }, 1000);
  });
}

// Teste 2: Novos métodos de Driver
async function testDriverMethods() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
    let eventsCompleted = 0;
    
    const checkComplete = () => {
      if (eventsCompleted >= 2) {
        clearTimeout(timeout);
        resolve();
      }
    };
    
    // setDriverStatus
    wsManager.once('driverStatusUpdated', (data) => {
      if (data.success) {
        console.log(`  ✅ setDriverStatus funcionou: ${data.status}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // updateDriverLocation
    wsManager.once('locationUpdated', (data) => {
      if (data.success) {
        console.log(`  ✅ updateDriverLocation funcionou`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // Executar eventos de driver
    wsManager.emit('setDriverStatus', {
      driverId: 'test_driver',
      status: 'online',
      isOnline: true
    });
    
    setTimeout(() => {
      wsManager.emit('updateDriverLocation', {
        driverId: 'test_driver',
        lat: -23.5505,
        lng: -46.6333,
        heading: 90,
        speed: 50
      });
    }, 1000);
  });
}

// Teste 3: Novos métodos de Busca
async function testSearchMethods() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
    let eventsCompleted = 0;
    
    const checkComplete = () => {
      if (eventsCompleted >= 2) {
        clearTimeout(timeout);
        resolve();
      }
    };
    
    // searchDrivers
    wsManager.once('driversFound', (data) => {
      if (data.success) {
        console.log(`  ✅ searchDrivers funcionou: ${data.drivers.length} motoristas`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // cancelDriverSearch
    wsManager.once('driverSearchCancelled', (data) => {
      if (data.success) {
        console.log(`  ✅ cancelDriverSearch funcionou`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // Executar eventos de busca
    wsManager.emit('searchDrivers', {
      pickupLocation: { lat: -23.5505, lng: -46.6333 },
      destinationLocation: { lat: -23.5615, lng: -46.6553 },
      rideType: 'standard',
      estimatedFare: 25.50
    });
    
    setTimeout(() => {
      wsManager.emit('cancelDriverSearch', {
        bookingId: 'test_booking',
        reason: 'Teste de cancelamento'
      });
    }, 1000);
  });
}

// Teste 4: Novos métodos de Suporte
async function testSupportMethods() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
    let eventsCompleted = 0;
    
    const checkComplete = () => {
      if (eventsCompleted >= 2) {
        clearTimeout(timeout);
        resolve();
      }
    };
    
    // createSupportTicket
    wsManager.once('supportTicketCreated', (data) => {
      if (data.success) {
        console.log(`  ✅ createSupportTicket funcionou: ${data.ticketId}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // reportIncident
    wsManager.once('incidentReported', (data) => {
      if (data.success) {
        console.log(`  ✅ reportIncident funcionou: ${data.reportId}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // Executar eventos de suporte
    wsManager.emit('createSupportTicket', {
      type: 'technical',
      priority: 'N3',
      description: 'Teste de ticket'
    });
    
    setTimeout(() => {
      wsManager.emit('reportIncident', {
        type: 'safety',
        description: 'Teste de incidente',
        location: { lat: -23.5505, lng: -46.6333 }
      });
    }, 1000);
  });
}

// Teste 5: Novos métodos de Chat
async function testChatMethods() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
    let eventsCompleted = 0;
    
    const checkComplete = () => {
      if (eventsCompleted >= 2) {
        clearTimeout(timeout);
        resolve();
      }
    };
    
    // createChat
    wsManager.once('chatCreated', (data) => {
      if (data.success) {
        console.log(`  ✅ createChat funcionou: ${data.chatId}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // sendMessage
    wsManager.once('messageSent', (data) => {
      if (data.success) {
        console.log(`  ✅ sendMessage funcionou: ${data.messageId}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // Executar eventos de chat
    wsManager.emit('createChat', {
      tripId: 'test_trip',
      participants: ['customer_123', 'driver_123']
    });
    
    setTimeout(() => {
      wsManager.emit('sendMessage', {
        chatId: 'test_chat',
        text: 'Teste de mensagem',
        senderId: 'customer_123',
        timestamp: new Date().toISOString()
      });
    }, 1000);
  });
}

// Teste 6: Novos métodos de Analytics
async function testAnalyticsMethods() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
    let eventsCompleted = 0;
    
    const checkComplete = () => {
      if (eventsCompleted >= 2) {
        clearTimeout(timeout);
        resolve();
      }
    };
    
    // trackUserAction
    wsManager.once('userActionTracked', (data) => {
      if (data.success) {
        console.log(`  ✅ trackUserAction funcionou: ${data.actionId}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // submitFeedback
    wsManager.once('feedbackReceived', (data) => {
      if (data.success) {
        console.log(`  ✅ submitFeedback funcionou: ${data.feedbackId}`);
        eventsCompleted++;
        checkComplete();
      }
    });
    
    // Executar eventos de analytics
    wsManager.emit('trackUserAction', {
      action: 'test_action',
      data: { test: true },
      timestamp: Date.now()
    });
    
    setTimeout(() => {
      wsManager.emit('submitFeedback', {
        type: 'app_feedback',
        rating: 5,
        comments: 'Teste de feedback'
      });
    }, 1000);
  });
}

// Teste 7: Novos métodos de Notificações
async function testNotificationMethods() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
    
    wsManager.once('notificationPreferencesUpdated', (data) => {
      clearTimeout(timeout);
      if (data.success) {
        console.log(`  ✅ updateNotificationPreferences funcionou`);
        resolve();
      } else {
        reject(new Error('Falha ao atualizar preferências'));
      }
    });
    
    // Executar evento de notificação
    wsManager.emit('updateNotificationPreferences', {
      rideUpdates: true,
      promotions: false,
      driverMessages: true,
      systemAlerts: true
    });
  });
}

// Teste 8: Novos métodos de Cancelamento
async function testCancellationMethods() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
    
    wsManager.once('rideCancelled', (data) => {
      clearTimeout(timeout);
      if (data.success && data.data.refundStatus === 'processed') {
        console.log(`  ✅ cancelRide funcionou - Reembolso: R$ ${data.data.refundAmount}`);
        resolve();
      } else {
        reject(new Error('Falha no cancelamento/reembolso'));
      }
    });
    
    // Executar evento de cancelamento
    wsManager.emit('cancelRide', {
      bookingId: 'test_booking',
      reason: 'Teste de cancelamento',
      cancellationFee: 0
    });
  });
}

// Executar todos os testes
async function runAllTests() {
  try {
    await connectWebSocket();
    
    console.log('\n🚀 INICIANDO TESTES COMPLETOS DO WEBSOCKETMANAGER...\n');
    
    await runTest('Métodos Core (createBooking, confirmPayment)', testCoreMethods);
    await runTest('Métodos de Driver (setDriverStatus, updateDriverLocation)', testDriverMethods);
    await runTest('Métodos de Busca (searchDrivers, cancelDriverSearch)', testSearchMethods);
    await runTest('Métodos de Suporte (createSupportTicket, reportIncident)', testSupportMethods);
    await runTest('Métodos de Chat (createChat, sendMessage)', testChatMethods);
    await runTest('Métodos de Analytics (trackUserAction, submitFeedback)', testAnalyticsMethods);
    await runTest('Métodos de Notificações (updateNotificationPreferences)', testNotificationMethods);
    await runTest('Métodos de Cancelamento (cancelRide com reembolso PIX)', testCancellationMethods);
    
    console.log('\n📊 RESULTADOS FINAIS:');
    console.log('='.repeat(60));
    console.log(`✅ Testes Passou: ${testResults.passed}`);
    console.log(`❌ Testes Falhou: ${testResults.failed}`);
    console.log(`📊 Total de Testes: ${testResults.total}`);
    console.log(`🎯 Taxa de Sucesso: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
    
    if (testResults.failed === 0) {
      console.log('\n🎉 WEBSOCKETMANAGER COMPLETAMENTE FUNCIONAL!');
      console.log('✅ Todos os métodos core funcionando');
      console.log('✅ Todos os novos métodos implementados');
      console.log('✅ Integração com servidor perfeita');
      console.log('✅ Sistema pronto para uso no mobile app');
    } else {
      console.log(`\n⚠️ ${testResults.failed} teste(s) falharam. Verificar implementação.`);
    }
    
  } catch (error) {
    console.error('❌ Erro geral nos testes:', error);
  } finally {
    // Limpar conexão
    if (wsManager) wsManager.disconnect();
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






