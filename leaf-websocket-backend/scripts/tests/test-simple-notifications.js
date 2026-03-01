/**
 * 🧪 TESTE SIMPLES - NOTIFICAÇÕES FCM
 * Teste direto dos eventos de notificação
 */

const io = require('socket.io-client');

console.log('🧪 TESTE SIMPLES - NOTIFICAÇÕES FCM');
console.log('='.repeat(50));

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

// Teste 1: Registrar token FCM
async function testRegisterFCMToken() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log('  ⏰ TIMEOUT - registerFCMToken');
      reject(new Error('Timeout para registerFCMToken'));
    }, 10000);
    
    socket.once('fcmTokenRegistered', (data) => {
      clearTimeout(timeout);
      console.log('  ✅ fcmTokenRegistered recebido:', data);
      resolve(data);
    });
    
    socket.once('fcmTokenError', (data) => {
      clearTimeout(timeout);
      console.log('  ❌ fcmTokenError recebido:', data);
      reject(new Error(`fcmTokenError: ${data.error}`));
    });
    
    console.log('  🧪 Enviando registerFCMToken...');
    
    socket.emit('registerFCMToken', {
      userId: 'test_user_123',
      userType: 'customer',
      fcmToken: 'test_fcm_token_123456789',
      platform: 'ios',
      timestamp: new Date().toISOString()
    });
  });
}

// Teste 2: Enviar notificação
async function testSendNotification() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log('  ⏰ TIMEOUT - sendNotification');
      reject(new Error('Timeout para sendNotification'));
    }, 10000);
    
    socket.once('notificationSent', (data) => {
      clearTimeout(timeout);
      console.log('  ✅ notificationSent recebido:', data);
      resolve(data);
    });
    
    socket.once('notificationError', (data) => {
      clearTimeout(timeout);
      console.log('  ❌ notificationError recebido:', data);
      reject(new Error(`notificationError: ${data.error}`));
    });
    
    console.log('  🧪 Enviando sendNotification...');
    
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
  });
}

// Executar todos os testes
async function runAllTests() {
  try {
    await connectWebSocket();
    
    console.log('\n🚀 INICIANDO TESTES SIMPLES DE NOTIFICAÇÕES...\n');
    
    // Teste 1: Registrar token FCM
    try {
      await testRegisterFCMToken();
      console.log('✅ Teste 1 - registerFCMToken: PASSOU');
    } catch (error) {
      console.log('❌ Teste 1 - registerFCMToken: FALHOU -', error.message);
    }
    
    // Teste 2: Enviar notificação
    try {
      await testSendNotification();
      console.log('✅ Teste 2 - sendNotification: PASSOU');
    } catch (error) {
      console.log('❌ Teste 2 - sendNotification: FALHOU -', error.message);
    }
    
    console.log('\n📊 ANÁLISE DO PROBLEMA:');
    console.log('='.repeat(50));
    console.log('🔍 Possíveis causas dos timeouts:');
    console.log('  1. Eventos não estão sendo registrados no servidor');
    console.log('  2. Servidor não está respondendo aos eventos');
    console.log('  3. Problema de sincronização entre cliente e servidor');
    console.log('  4. Eventos estão sendo processados mas não emitem resposta');
    
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






