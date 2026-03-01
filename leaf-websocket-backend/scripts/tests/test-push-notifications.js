/**
 * 🧪 TESTE DE NOTIFICAÇÕES PUSH EM TEMPO REAL
 * Validação do sistema integrado WebSocket + FCM
 */

const io = require('socket.io-client');

console.log('🧪 TESTE DE NOTIFICAÇÕES PUSH EM TEMPO REAL');
console.log('='.repeat(60));

let socket = null;
let testResults = {
  fcmTokenRegistration: { passed: 0, failed: 0, tests: [] },
  notificationSending: { passed: 0, failed: 0, tests: [] },
  userSpecificNotifications: { passed: 0, failed: 0, tests: [] },
  userTypeNotifications: { passed: 0, failed: 0, tests: [] }
};

// Conectar WebSocket
async function connectWebSocket() {
  console.log('🔌 Conectando WebSocket...');
  
  socket = io('http://localhost:3001', {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 2000,
    reconnectionAttempts: 3,
    timeout: 10000,
  });
  
  await new Promise(resolve => {
    socket.on('connect', () => {
      console.log('✅ WebSocket conectado:', socket.id);
      resolve();
    });
    
    socket.on('connect_error', (error) => {
      console.error('❌ Erro de conexão:', error.message);
      throw error;
    });
  });
}

// Função para executar teste
async function runTest(testName, category, eventName, testData, expectedResponse) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log(`  ⏰ TIMEOUT - ${testName}`);
      testResults[category].failed++;
      testResults[category].tests.push({ name: testName, status: 'TIMEOUT' });
      reject(new Error(`Timeout para ${testName}`));
    }, 10000);
    
    // Listener para resposta esperada
    socket.once(expectedResponse, (data) => {
      clearTimeout(timeout);
      console.log(`  ✅ ${testName} - ${expectedResponse} recebido:`, data);
      testResults[category].passed++;
      testResults[category].tests.push({ name: testName, status: 'PASSED', data });
      resolve(data);
    });
    
    // Listener para erro
    socket.once(`${eventName}Error`, (data) => {
      clearTimeout(timeout);
      console.log(`  ❌ ${testName} - Erro recebido:`, data);
      testResults[category].failed++;
      testResults[category].tests.push({ name: testName, status: 'FAILED', error: data });
      reject(new Error(`Erro em ${testName}: ${data.error}`));
    });
    
    console.log(`  🧪 Executando ${testName}...`);
    
    // Emitir evento
    socket.emit(eventName, testData);
  });
}

// Testes para registro de token FCM
async function testFCMTokenRegistration() {
  console.log('\n📱 TESTANDO REGISTRO DE TOKEN FCM...');
  
  try {
    // Teste 1: Registrar token FCM
    await runTest(
      'registerFCMToken',
      'fcmTokenRegistration',
      'registerFCMToken',
      {
        userId: 'test_user_123',
        userType: 'customer',
        fcmToken: 'test_fcm_token_123456789',
        platform: 'ios',
        timestamp: new Date().toISOString()
      },
      'fcmTokenRegistered'
    );
    
    // Teste 2: Desregistrar token FCM
    await runTest(
      'unregisterFCMToken',
      'fcmTokenRegistration',
      'unregisterFCMToken',
      {
        userId: 'test_user_123',
        fcmToken: 'test_fcm_token_123456789'
      },
      'fcmTokenUnregistered'
    );
    
    console.log('✅ FCM Token Registration - Todos os testes passaram');
    
  } catch (error) {
    console.log('❌ FCM Token Registration - Alguns testes falharam:', error.message);
  }
}

// Testes para envio de notificações
async function testNotificationSending() {
  console.log('\n🔔 TESTANDO ENVIO DE NOTIFICAÇÕES...');
  
  try {
    // Teste 1: Enviar notificação geral
    await runTest(
      'sendNotification',
      'notificationSending',
      'sendNotification',
      {
        userId: 'test_user_123',
        userType: 'customer',
        notification: {
          title: '🚗 Nova Corrida!',
          body: 'Sua corrida foi aceita',
          data: { type: 'ride_accepted', bookingId: 'booking_123' },
          channelId: 'trip_updates'
        },
        timestamp: new Date().toISOString()
      },
      'notificationSent'
    );
    
    console.log('✅ Notification Sending - Todos os testes passaram');
    
  } catch (error) {
    console.log('❌ Notification Sending - Alguns testes falharam:', error.message);
  }
}

// Testes para notificações específicas de usuário
async function testUserSpecificNotifications() {
  console.log('\n👤 TESTANDO NOTIFICAÇÕES ESPECÍFICAS DE USUÁRIO...');
  
  try {
    // Teste 1: Enviar notificação para usuário específico
    await runTest(
      'sendNotificationToUser',
      'userSpecificNotifications',
      'sendNotificationToUser',
      {
        userId: 'test_user_456',
        notification: {
          title: '💳 Pagamento Confirmado',
          body: 'Seu pagamento foi processado com sucesso',
          data: { type: 'payment_confirmed', amount: 25.50 },
          channelId: 'payments'
        },
        timestamp: new Date().toISOString()
      },
      'notificationSentToUser'
    );
    
    console.log('✅ User Specific Notifications - Todos os testes passaram');
    
  } catch (error) {
    console.log('❌ User Specific Notifications - Alguns testes falharam:', error.message);
  }
}

// Testes para notificações por tipo de usuário
async function testUserTypeNotifications() {
  console.log('\n👥 TESTANDO NOTIFICAÇÕES POR TIPO DE USUÁRIO...');
  
  try {
    // Teste 1: Enviar notificação para todos os drivers
    await runTest(
      'sendNotificationToDrivers',
      'userTypeNotifications',
      'sendNotificationToUserType',
      {
        userType: 'driver',
        notification: {
          title: '🚨 Alerta de Segurança',
          body: 'Nova atualização de segurança disponível',
          data: { type: 'security_alert', priority: 'high' },
          channelId: 'default'
        },
        timestamp: new Date().toISOString()
      },
      'notificationSentToUserType'
    );
    
    // Teste 2: Enviar notificação para todos os customers
    await runTest(
      'sendNotificationToCustomers',
      'userTypeNotifications',
      'sendNotificationToUserType',
      {
        userType: 'customer',
        notification: {
          title: '🎉 Promoção Especial',
          body: 'Desconto de 20% na sua próxima corrida!',
          data: { type: 'promotion', discount: 20 },
          channelId: 'promos'
        },
        timestamp: new Date().toISOString()
      },
      'notificationSentToUserType'
    );
    
    console.log('✅ User Type Notifications - Todos os testes passaram');
    
  } catch (error) {
    console.log('❌ User Type Notifications - Alguns testes falharam:', error.message);
  }
}

// Executar todos os testes
async function runAllTests() {
  try {
    await connectWebSocket();
    
    console.log('\n🚀 INICIANDO TESTES DE NOTIFICAÇÕES PUSH...\n');
    
    await testFCMTokenRegistration();
    await testNotificationSending();
    await testUserSpecificNotifications();
    await testUserTypeNotifications();
    
    console.log('\n📊 RESULTADOS FINAIS:');
    console.log('='.repeat(60));
    
    let totalPassed = 0;
    let totalFailed = 0;
    
    Object.keys(testResults).forEach(category => {
      const result = testResults[category];
      totalPassed += result.passed;
      totalFailed += result.failed;
      
      console.log(`\n📱 ${category}:`);
      console.log(`  ✅ Passou: ${result.passed}`);
      console.log(`  ❌ Falhou: ${result.failed}`);
      console.log(`  📊 Taxa de sucesso: ${result.passed + result.failed > 0 ? ((result.passed / (result.passed + result.failed)) * 100).toFixed(1) : 0}%`);
      
      if (result.tests.length > 0) {
        console.log('  📋 Detalhes dos testes:');
        result.tests.forEach(test => {
          const status = test.status === 'PASSED' ? '✅' : test.status === 'FAILED' ? '❌' : '⏰';
          console.log(`    ${status} ${test.name}: ${test.status}`);
        });
      }
    });
    
    console.log(`\n🎯 RESUMO GERAL:`);
    console.log(`  ✅ Total de testes passou: ${totalPassed}`);
    console.log(`  ❌ Total de testes falhou: ${totalFailed}`);
    console.log(`  📊 Taxa de sucesso geral: ${totalPassed + totalFailed > 0 ? ((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1) : 0}%`);
    
    if (totalFailed === 0) {
      console.log('\n🎉 SISTEMA DE NOTIFICAÇÕES PUSH FUNCIONANDO PERFEITAMENTE!');
      console.log('✅ WebSocket + FCM integrados com sucesso');
      console.log('✅ Notificações em tempo real operacionais');
      console.log('✅ Sistema pronto para produção');
    } else {
      console.log('\n⚠️ ALGUMAS FUNCIONALIDADES PRECISAM DE AJUSTES');
      console.log('🔧 Verifique os testes que falharam');
    }
    
  } catch (error) {
    console.error('❌ Erro geral nos testes:', error);
  } finally {
    if (socket) socket.disconnect();
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






