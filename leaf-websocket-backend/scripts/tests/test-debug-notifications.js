/**
 * 🧪 TESTE DE DEBUG - VERIFICAR EVENTOS NO SERVIDOR
 * Verificar se os eventos de notificação estão sendo processados
 */

const io = require('socket.io-client');

console.log('🧪 TESTE DE DEBUG - VERIFICAR EVENTOS NO SERVIDOR');
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

// Teste: Verificar se eventos estão sendo processados
async function testEventProcessing() {
  return new Promise((resolve, reject) => {
    console.log('  🧪 Testando processamento de eventos...');
    
    // Listener para qualquer resposta
    const responseHandler = (eventName, data) => {
      console.log(`  📨 Resposta recebida: ${eventName}`, data);
    };
    
    // Registrar listeners para todos os possíveis eventos de resposta
    socket.on('fcmTokenRegistered', (data) => responseHandler('fcmTokenRegistered', data));
    socket.on('fcmTokenUnregistered', (data) => responseHandler('fcmTokenUnregistered', data));
    socket.on('notificationSent', (data) => responseHandler('notificationSent', data));
    socket.on('notificationSentToUser', (data) => responseHandler('notificationSentToUser', data));
    socket.on('notificationSentToUserType', (data) => responseHandler('notificationSentToUserType', data));
    socket.on('fcmTokenError', (data) => responseHandler('fcmTokenError', data));
    socket.on('notificationError', (data) => responseHandler('notificationError', data));
    
    // Testar evento que sabemos que funciona
    console.log('  🧪 Testando evento que sabemos que funciona (createBooking)...');
    socket.emit('createBooking', {
      customerId: 'test_customer',
      pickupLocation: { lat: -23.5505, lng: -46.6333 },
      destinationLocation: { lat: -23.5615, lng: -46.6553 },
      estimatedFare: 25.5,
      paymentMethod: 'PIX'
    });
    
    // Aguardar um pouco para ver se há resposta
    setTimeout(() => {
      console.log('  ⏰ Aguardando respostas...');
      
      // Agora testar eventos de notificação
      console.log('  🧪 Testando registerFCMToken...');
      socket.emit('registerFCMToken', {
        userId: 'test_user_123',
        userType: 'customer',
        fcmToken: 'test_fcm_token_123456789',
        platform: 'ios',
        timestamp: new Date().toISOString()
      });
      
      setTimeout(() => {
        console.log('  🧪 Testando sendNotification...');
        socket.emit('sendNotification', {
          userId: 'test_user_123',
          userType: 'customer',
          notification: {
            title: '🚗 Nova Corrida!',
            body: 'Sua corrida foi aceita',
            data: { type: 'ride_accepted', bookingId: 'booking_123' },
            channelId: 'trip_updates'
          },
          timestamp: new Date().toISOString()
        });
        
        setTimeout(() => {
          console.log('  ✅ Teste de processamento concluído');
          resolve();
        }, 5000);
        
      }, 2000);
      
    }, 2000);
  });
}

// Executar teste
async function runTest() {
  try {
    await connectWebSocket();
    
    console.log('\n🚀 INICIANDO TESTE DE DEBUG...\n');
    
    await testEventProcessing();
    
    console.log('\n📊 RESULTADO DO TESTE:');
    console.log('='.repeat(60));
    console.log('🔍 Se você viu respostas acima, os eventos estão funcionando');
    console.log('🔍 Se não viu respostas, os eventos não estão sendo processados');
    
  } catch (error) {
    console.error('❌ Erro no teste:', error);
  } finally {
    if (socket) socket.disconnect();
    process.exit(0);
  }
}

// Timeout geral
setTimeout(() => {
  console.log('\n⏰ TIMEOUT GERAL - Finalizando teste');
  process.exit(1);
}, 30000);

// Executar teste
runTest();






