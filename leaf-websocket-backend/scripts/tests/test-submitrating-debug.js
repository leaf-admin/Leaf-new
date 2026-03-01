/**
 * 🧪 TESTE ESPECÍFICO - SUBMITRATING
 * Investigando o problema com o evento submitRating
 */

const io = require('socket.io-client');

console.log('🧪 TESTE ESPECÍFICO - SUBMITRATING');
console.log('='.repeat(60));

let socket = null;

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

// Teste 1: submitRating com dados corretos
async function testSubmitRatingCorrect() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log('  ⏰ TIMEOUT - submitRating não respondeu');
      reject(new Error('Timeout para submitRating'));
    }, 10000);
    
    // Listener para ratingSubmitted
    socket.once('ratingSubmitted', (data) => {
      clearTimeout(timeout);
      console.log('  ✅ ratingSubmitted recebido:', data);
      if (data.success) {
        resolve(data);
      } else {
        reject(new Error('ratingSubmitted retornou success: false'));
      }
    });
    
    // Listener para ratingError
    socket.once('ratingError', (data) => {
      clearTimeout(timeout);
      console.log('  ❌ ratingError recebido:', data);
      reject(new Error(`ratingError: ${data.error}`));
    });
    
    console.log('  🧪 Enviando submitRating com dados corretos...');
    
    // Enviar submitRating com dados corretos
    socket.emit('submitRating', {
      tripId: 'test_trip_123',
      customerId: 'customer_123',
      driverId: 'driver_123',
      customerRating: 5,
      driverRating: 4,
      customerComment: 'Excelente serviço!',
      driverComment: 'Passageiro educado'
    });
  });
}

// Teste 2: submitRating com dados mínimos
async function testSubmitRatingMinimal() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log('  ⏰ TIMEOUT - submitRating (mínimo) não respondeu');
      reject(new Error('Timeout para submitRating mínimo'));
    }, 10000);
    
    socket.once('ratingSubmitted', (data) => {
      clearTimeout(timeout);
      console.log('  ✅ ratingSubmitted (mínimo) recebido:', data);
      resolve(data);
    });
    
    socket.once('ratingError', (data) => {
      clearTimeout(timeout);
      console.log('  ❌ ratingError (mínimo) recebido:', data);
      reject(new Error(`ratingError: ${data.error}`));
    });
    
    console.log('  🧪 Enviando submitRating com dados mínimos...');
    
    // Enviar submitRating com apenas tripId
    socket.emit('submitRating', {
      tripId: 'test_trip_minimal'
    });
  });
}

// Teste 3: submitRating sem tripId (deve falhar)
async function testSubmitRatingNoTripId() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log('  ⏰ TIMEOUT - submitRating (sem tripId) não respondeu');
      reject(new Error('Timeout para submitRating sem tripId'));
    }, 10000);
    
    socket.once('ratingSubmitted', (data) => {
      clearTimeout(timeout);
      console.log('  ❌ ratingSubmitted (sem tripId) recebido - não deveria acontecer:', data);
      reject(new Error('ratingSubmitted não deveria ser chamado sem tripId'));
    });
    
    socket.once('ratingError', (data) => {
      clearTimeout(timeout);
      console.log('  ✅ ratingError (sem tripId) recebido - correto:', data);
      resolve(data);
    });
    
    console.log('  🧪 Enviando submitRating sem tripId...');
    
    // Enviar submitRating sem tripId
    socket.emit('submitRating', {
      rating: 5,
      comment: 'Teste sem tripId'
    });
  });
}

// Teste 4: Verificar se o evento está sendo registrado
async function testEventRegistration() {
  return new Promise((resolve, reject) => {
    console.log('  🧪 Verificando se submitRating está registrado...');
    
    // Verificar se o socket tem o evento registrado
    const hasEvent = socket._callbacks && socket._callbacks['submitRating'];
    console.log('  📋 Socket callbacks:', Object.keys(socket._callbacks || {}));
    
    if (hasEvent) {
      console.log('  ✅ submitRating está registrado no cliente');
    } else {
      console.log('  ❌ submitRating NÃO está registrado no cliente');
    }
    
    resolve();
  });
}

// Executar todos os testes
async function runAllTests() {
  try {
    await connectWebSocket();
    
    console.log('\n🚀 INICIANDO TESTES ESPECÍFICOS DO SUBMITRATING...\n');
    
    // Teste 1: Dados corretos
    try {
      await testSubmitRatingCorrect();
      console.log('✅ Teste 1 - submitRating com dados corretos: PASSOU');
    } catch (error) {
      console.log('❌ Teste 1 - submitRating com dados corretos: FALHOU -', error.message);
    }
    
    // Teste 2: Dados mínimos
    try {
      await testSubmitRatingMinimal();
      console.log('✅ Teste 2 - submitRating com dados mínimos: PASSOU');
    } catch (error) {
      console.log('❌ Teste 2 - submitRating com dados mínimos: FALHOU -', error.message);
    }
    
    // Teste 3: Sem tripId
    try {
      await testSubmitRatingNoTripId();
      console.log('✅ Teste 3 - submitRating sem tripId: PASSOU');
    } catch (error) {
      console.log('❌ Teste 3 - submitRating sem tripId: FALHOU -', error.message);
    }
    
    // Teste 4: Verificar registro
    try {
      await testEventRegistration();
      console.log('✅ Teste 4 - Verificação de registro: PASSOU');
    } catch (error) {
      console.log('❌ Teste 4 - Verificação de registro: FALHOU -', error.message);
    }
    
    console.log('\n📊 ANÁLISE DO PROBLEMA:');
    console.log('='.repeat(60));
    console.log('🔍 Possíveis causas do timeout:');
    console.log('  1. Evento não está sendo emitido corretamente');
    console.log('  2. Servidor não está respondendo ao evento');
    console.log('  3. Listener não está sendo registrado');
    console.log('  4. Problema de sincronização entre cliente e servidor');
    console.log('  5. Evento está sendo processado mas não emite resposta');
    
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
}, 60000);

// Executar testes
runAllTests();






