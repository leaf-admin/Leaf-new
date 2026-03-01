/**
 * 🧪 TESTE DE INTEGRAÇÃO WEBSOCKET - TELAS PRINCIPAIS
 * Validação das integrações WebSocket nas telas principais do mobile app
 */

const io = require('socket.io-client');

console.log('🧪 TESTE DE INTEGRAÇÃO WEBSOCKET - TELAS PRINCIPAIS');
console.log('='.repeat(70));

let socket = null;
let testResults = {
  NewMapScreen: { passed: 0, failed: 0, tests: [] },
  PaymentDetails: { passed: 0, failed: 0, tests: [] },
  DriverRating: { passed: 0, failed: 0, tests: [] },
  DriverDashboard: { passed: 0, failed: 0, tests: [] },
  TripTracking: { passed: 0, failed: 0, tests: [] }
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
async function runTest(testName, screenName, eventName, testData, expectedResponse) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log(`  ⏰ TIMEOUT - ${testName}`);
      testResults[screenName].failed++;
      testResults[screenName].tests.push({ name: testName, status: 'TIMEOUT' });
      reject(new Error(`Timeout para ${testName}`));
    }, 10000);
    
    // Listener para resposta esperada
    socket.once(expectedResponse, (data) => {
      clearTimeout(timeout);
      console.log(`  ✅ ${testName} - ${expectedResponse} recebido:`, data);
      testResults[screenName].passed++;
      testResults[screenName].tests.push({ name: testName, status: 'PASSED', data });
      resolve(data);
    });
    
    // Listener para erro
    socket.once(`${eventName}Error`, (data) => {
      clearTimeout(timeout);
      console.log(`  ❌ ${testName} - Erro recebido:`, data);
      testResults[screenName].failed++;
      testResults[screenName].tests.push({ name: testName, status: 'FAILED', error: data });
      reject(new Error(`Erro em ${testName}: ${data.error}`));
    });
    
    console.log(`  🧪 Executando ${testName}...`);
    
    // Emitir evento
    socket.emit(eventName, testData);
  });
}

// Testes para NewMapScreen
async function testNewMapScreen() {
  console.log('\n🗺️ TESTANDO NEWMAPSCREEN...');
  
  try {
    // Teste 1: createBooking
    await runTest(
      'createBooking',
      'NewMapScreen',
      'createBooking',
      {
        customerId: 'test_customer',
        pickupLocation: { lat: -23.5505, lng: -46.6333 },
        destinationLocation: { lat: -23.5615, lng: -46.6553 },
        estimatedFare: 25.5,
        paymentMethod: 'PIX'
      },
      'bookingCreated'
    );
    
    // Teste 2: confirmPayment
    await runTest(
      'confirmPayment',
      'NewMapScreen',
      'confirmPayment',
      {
        bookingId: 'test_booking',
        paymentMethod: 'PIX',
        paymentId: 'test_payment',
        amount: 25.5
      },
      'paymentConfirmed'
    );
    
    // Teste 3: searchDrivers
    await runTest(
      'searchDrivers',
      'NewMapScreen',
      'searchDrivers',
      {
        pickupLocation: { lat: -23.5505, lng: -46.6333 },
        destinationLocation: { lat: -23.5615, lng: -46.6553 },
        rideType: 'standard',
        estimatedFare: 25.5
      },
      'driversFound'
    );
    
    console.log('✅ NewMapScreen - Todos os testes passaram');
    
  } catch (error) {
    console.log('❌ NewMapScreen - Alguns testes falharam:', error.message);
  }
}

// Testes para PaymentDetails
async function testPaymentDetails() {
  console.log('\n💳 TESTANDO PAYMENTDETAILS...');
  
  try {
    // Teste 1: confirmPayment
    await runTest(
      'confirmPayment',
      'PaymentDetails',
      'confirmPayment',
      {
        bookingId: 'test_booking',
        paymentMethod: 'PIX',
        paymentId: 'test_payment',
        amount: 25.5
      },
      'paymentConfirmed'
    );
    
    console.log('✅ PaymentDetails - Todos os testes passaram');
    
  } catch (error) {
    console.log('❌ PaymentDetails - Alguns testes falharam:', error.message);
  }
}

// Testes para DriverRating
async function testDriverRating() {
  console.log('\n⭐ TESTANDO DRIVERRATING...');
  
  try {
    // Teste 1: submitRating
    await runTest(
      'submitRating',
      'DriverRating',
      'submitRating',
      {
        tripId: 'test_trip',
        rating: 5,
        comments: 'Excelente serviço!'
      },
      'ratingSubmitted'
    );
    
    console.log('✅ DriverRating - Todos os testes passaram');
    
  } catch (error) {
    console.log('❌ DriverRating - Alguns testes falharam:', error.message);
  }
}

// Testes para DriverDashboard
async function testDriverDashboard() {
  console.log('\n🚗 TESTANDO DRIVERDASHBOARD...');
  
  try {
    // Teste 1: setDriverStatus
    await runTest(
      'setDriverStatus',
      'DriverDashboard',
      'setDriverStatus',
      {
        driverId: 'test_driver',
        status: 'online',
        isOnline: true
      },
      'driverStatusUpdated'
    );
    
    // Teste 2: updateDriverLocation
    await runTest(
      'updateDriverLocation',
      'DriverDashboard',
      'updateDriverLocation',
      {
        driverId: 'test_driver',
        lat: -23.5505,
        lng: -46.6333,
        heading: 90,
        speed: 50
      },
      'locationUpdated'
    );
    
    console.log('✅ DriverDashboard - Todos os testes passaram');
    
  } catch (error) {
    console.log('❌ DriverDashboard - Alguns testes falharam:', error.message);
  }
}

// Testes para TripTracking
async function testTripTracking() {
  console.log('\n📍 TESTANDO TRIPTRACKING...');
  
  try {
    // Teste 1: updateDriverLocation
    await runTest(
      'updateDriverLocation',
      'TripTracking',
      'updateDriverLocation',
      {
        driverId: 'test_driver',
        lat: -23.5505,
        lng: -46.6333,
        heading: 90,
        speed: 50
      },
      'locationUpdated'
    );
    
    // Teste 2: startTrip
    await runTest(
      'startTrip',
      'TripTracking',
      'startTrip',
      {
        bookingId: 'test_booking',
        startLocation: { lat: -23.5505, lng: -46.6333 }
      },
      'tripStarted'
    );
    
    // Teste 3: completeTrip
    await runTest(
      'completeTrip',
      'TripTracking',
      'completeTrip',
      {
        bookingId: 'test_booking',
        endLocation: { lat: -23.5615, lng: -46.6553 },
        distance: 5.2,
        fare: 25.5
      },
      'tripCompleted'
    );
    
    console.log('✅ TripTracking - Todos os testes passaram');
    
  } catch (error) {
    console.log('❌ TripTracking - Alguns testes falharam:', error.message);
  }
}

// Executar todos os testes
async function runAllTests() {
  try {
    await connectWebSocket();
    
    console.log('\n🚀 INICIANDO TESTES DE INTEGRAÇÃO DAS TELAS PRINCIPAIS...\n');
    
    await testNewMapScreen();
    await testPaymentDetails();
    await testDriverRating();
    await testDriverDashboard();
    await testTripTracking();
    
    console.log('\n📊 RESULTADOS FINAIS:');
    console.log('='.repeat(70));
    
    let totalPassed = 0;
    let totalFailed = 0;
    
    Object.keys(testResults).forEach(screenName => {
      const result = testResults[screenName];
      totalPassed += result.passed;
      totalFailed += result.failed;
      
      console.log(`\n📱 ${screenName}:`);
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
      console.log('\n🎉 TODAS AS INTEGRAÇÕES WEBSOCKET FUNCIONANDO PERFEITAMENTE!');
      console.log('✅ Sistema pronto para produção');
    } else {
      console.log('\n⚠️ ALGUMAS INTEGRAÇÕES PRECISAM DE AJUSTES');
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
