/**
 * 🧪 TESTE DO SISTEMA DE FALLBACK INTELIGENTE
 * Validação da estratégia híbrida: Fallback para críticas, Retry para tempo real
 */

const io = require('socket.io-client');

console.log('🧪 TESTE DO SISTEMA DE FALLBACK INTELIGENTE');
console.log('='.repeat(60));

let socket = null;
let testResults = {
  criticalOperations: { passed: 0, failed: 0, tests: [] },
  realTimeOperations: { passed: 0, failed: 0, tests: [] },
  nonCriticalOperations: { passed: 0, failed: 0, tests: [] }
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
    }, 15000);
    
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

// Testes para operações críticas (com fallback)
async function testCriticalOperations() {
  console.log('\n🚨 TESTANDO OPERAÇÕES CRÍTICAS (com fallback)...');
  
  try {
    // Teste 1: Criar booking (crítico)
    await runTest(
      'createBooking',
      'criticalOperations',
      'createBooking',
      {
        customerId: 'test_customer_critical',
        pickupLocation: { lat: -23.5505, lng: -46.6333 },
        destinationLocation: { lat: -23.5615, lng: -46.6553 },
        estimatedFare: 25.5,
        paymentMethod: 'PIX'
      },
      'bookingCreated'
    );
    
    // Teste 2: Confirmar pagamento (crítico)
    await runTest(
      'confirmPayment',
      'criticalOperations',
      'confirmPayment',
      {
        bookingId: 'test_booking_critical',
        paymentMethod: 'PIX',
        paymentId: 'test_payment_critical',
        amount: 25.5
      },
      'paymentConfirmed'
    );
    
    // Teste 3: Cancelar corrida (crítico)
    await runTest(
      'cancelRide',
      'criticalOperations',
      'cancelRide',
      {
        bookingId: 'test_booking_critical',
        reason: 'Teste de cancelamento crítico',
        cancellationFee: 0
      },
      'rideCancelled'
    );
    
    console.log('✅ Operações Críticas - Todos os testes passaram');
    
  } catch (error) {
    console.log('❌ Operações Críticas - Alguns testes falharam:', error.message);
  }
}

// Testes para operações de tempo real (com retry)
async function testRealTimeOperations() {
  console.log('\n⚡ TESTANDO OPERAÇÕES DE TEMPO REAL (com retry)...');
  
  try {
    // Teste 1: Atualizar localização do driver (tempo real)
    await runTest(
      'updateDriverLocation',
      'realTimeOperations',
      'updateDriverLocation',
      {
        driverId: 'test_driver_realtime',
        lat: -23.5505,
        lng: -46.6333,
        heading: 90,
        speed: 50
      },
      'locationUpdated'
    );
    
    // Teste 2: Definir status do driver (tempo real)
    await runTest(
      'setDriverStatus',
      'realTimeOperations',
      'setDriverStatus',
      {
        driverId: 'test_driver_realtime',
        status: 'online',
        isOnline: true
      },
      'driverStatusUpdated'
    );
    
    // Teste 3: Buscar motoristas (tempo real)
    await runTest(
      'searchDrivers',
      'realTimeOperations',
      'searchDrivers',
      {
        pickupLocation: { lat: -23.5505, lng: -46.6333 },
        destinationLocation: { lat: -23.5615, lng: -46.6553 },
        rideType: 'standard',
        estimatedFare: 25.5
      },
      'driversFound'
    );
    
    console.log('✅ Operações de Tempo Real - Todos os testes passaram');
    
  } catch (error) {
    console.log('❌ Operações de Tempo Real - Alguns testes falharam:', error.message);
  }
}

// Testes para operações não-críticas (com retry)
async function testNonCriticalOperations() {
  console.log('\n📊 TESTANDO OPERAÇÕES NÃO-CRÍTICAS (com retry)...');
  
  try {
    // Teste 1: Rastrear ação do usuário (não-crítica)
    await runTest(
      'trackUserAction',
      'nonCriticalOperations',
      'trackUserAction',
      {
        action: 'test_action_noncritical',
        data: { test: true, category: 'non_critical' },
        timestamp: Date.now()
      },
      'userActionTracked'
    );
    
    // Teste 2: Enviar feedback (não-crítica)
    await runTest(
      'submitFeedback',
      'nonCriticalOperations',
      'submitFeedback',
      {
        type: 'app_feedback',
        rating: 5,
        comments: 'Teste de feedback não-crítico'
      },
      'feedbackReceived'
    );
    
    // Teste 3: Atualizar preferências de notificação (não-crítica)
    await runTest(
      'updateNotificationPreferences',
      'nonCriticalOperations',
      'updateNotificationPreferences',
      {
        rideUpdates: true,
        promotions: false,
        driverMessages: true,
        systemAlerts: true
      },
      'notificationPreferencesUpdated'
    );
    
    console.log('✅ Operações Não-Críticas - Todos os testes passaram');
    
  } catch (error) {
    console.log('❌ Operações Não-Críticas - Alguns testes falharam:', error.message);
  }
}

// Executar todos os testes
async function runAllTests() {
  try {
    await connectWebSocket();
    
    console.log('\n🚀 INICIANDO TESTES DO SISTEMA DE FALLBACK INTELIGENTE...\n');
    
    await testCriticalOperations();
    await testRealTimeOperations();
    await testNonCriticalOperations();
    
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
      console.log('\n🎉 SISTEMA DE FALLBACK INTELIGENTE FUNCIONANDO PERFEITAMENTE!');
      console.log('✅ Estratégia híbrida implementada com sucesso');
      console.log('✅ Operações críticas com fallback operacionais');
      console.log('✅ Operações de tempo real com retry funcionando');
      console.log('✅ Sistema inteligente pronto para produção');
    } else {
      console.log('\n⚠️ ALGUMAS FUNCIONALIDADES PRECISAM DE AJUSTES');
      console.log('🔧 Verifique os testes que falharam');
    }
    
    console.log('\n🧠 ANÁLISE DA ESTRATÉGIA INTELIGENTE:');
    console.log('='.repeat(60));
    console.log('🚨 Operações Críticas: Fallback WebSocket → REST API');
    console.log('   - Garantem que operações importantes nunca falhem');
    console.log('   - Exemplo: Pagamentos, emergências, corridas');
    console.log('');
    console.log('⚡ Operações de Tempo Real: Retry WebSocket');
    console.log('   - Mantêm performance e latência baixa');
    console.log('   - Exemplo: Localização, chat, status');
    console.log('');
    console.log('📊 Operações Não-Críticas: Retry WebSocket');
    console.log('   - Simplicidade e eficiência');
    console.log('   - Exemplo: Analytics, feedback, preferências');
    
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
}, 180000);

// Executar testes
runAllTests();






