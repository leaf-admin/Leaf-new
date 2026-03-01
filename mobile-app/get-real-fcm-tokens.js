#!/usr/bin/env node

/**
 * 🔍 BUSCAR TOKENS FCM REAIS DO FIREBASE
 * 
 * Este script busca tokens FCM reais dos usuários no Firebase Realtime Database
 */

const admin = require('firebase-admin');

// Configuração do Firebase Admin (você precisa das credenciais reais)
const serviceAccount = {
  "type": "service_account",
  "project_id": "leaf-reactnative",
  "private_key_id": "YOUR_PRIVATE_KEY_ID",
  "private_key": "YOUR_PRIVATE_KEY",
  "client_email": "firebase-adminsdk-xxxxx@leaf-reactnative.iam.gserviceaccount.com",
  "client_id": "YOUR_CLIENT_ID",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token"
};

// Inicializar Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://leaf-reactnative-default-rtdb.firebaseio.com'
  });
}

class FCMTokenFinder {
  constructor() {
    this.db = admin.database();
    this.messaging = admin.messaging();
  }

  // Buscar todos os usuários com tokens FCM
  async findUsersWithFCMTokens() {
    console.log('🔍 Buscando usuários com tokens FCM...');
    
    try {
      const usersRef = this.db.ref('users');
      const snapshot = await usersRef.once('value');
      const users = snapshot.val();
      
      const usersWithTokens = [];
      
      if (users) {
        Object.keys(users).forEach(uid => {
          const user = users[uid];
          if (user.pushToken || user.fcmToken) {
            usersWithTokens.push({
              uid: uid,
              name: user.firstName + ' ' + user.lastName,
              email: user.email,
              usertype: user.usertype,
              pushToken: user.pushToken,
              fcmToken: user.fcmToken,
              platform: user.platform || user.userPlatform,
              lastSeen: user.lastSeen || 'N/A'
            });
          }
        });
      }
      
      console.log(`✅ Encontrados ${usersWithTokens.length} usuários com tokens FCM`);
      return usersWithTokens;
      
    } catch (error) {
      console.error('❌ Erro ao buscar usuários:', error);
      return [];
    }
  }

  // Testar envio de notificação para um token específico
  async testNotificationToToken(token, userInfo) {
    console.log(`🧪 Testando notificação para ${userInfo.name} (${userInfo.usertype})`);
    
    try {
      const message = {
        token: token,
        notification: {
          title: '🧪 Teste FCM - Leaf App',
          body: `Olá ${userInfo.name}! Este é um teste do sistema de notificações.`
        },
        data: {
          type: 'test_notification',
          userId: userInfo.uid,
          timestamp: new Date().toISOString()
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'test_notifications'
          }
        },
        apns: {
          payload: {
            aps: {
              sound: 'default',
              badge: 1
            }
          }
        }
      };

      const response = await this.messaging.send(message);
      console.log(`✅ Notificação enviada com sucesso para ${userInfo.name}:`, response);
      
      return {
        success: true,
        messageId: response,
        user: userInfo
      };

    } catch (error) {
      console.error(`❌ Erro ao enviar notificação para ${userInfo.name}:`, error.message);
      
      return {
        success: false,
        error: error.message,
        user: userInfo
      };
    }
  }

  // Testar notificação de corrida para motoristas
  async testRideNotificationToDrivers() {
    console.log('🚗 Testando notificação de corrida para motoristas...');
    
    const users = await this.findUsersWithFCMTokens();
    const drivers = users.filter(user => user.usertype === 'driver');
    
    console.log(`📊 Encontrados ${drivers.length} motoristas com tokens FCM`);
    
    const results = [];
    
    for (const driver of drivers.slice(0, 3)) { // Testar apenas os primeiros 3
      const token = driver.fcmToken || driver.pushToken;
      if (token) {
        const result = await this.testRideNotificationToDriver(token, driver);
        results.push(result);
        
        // Aguardar 2 segundos entre envios
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    return results;
  }

  // Testar notificação de corrida específica para motorista
  async testRideNotificationToDriver(token, driverInfo) {
    console.log(`🚗 Enviando notificação de corrida para ${driverInfo.name}`);
    
    try {
      const message = {
        token: token,
        notification: {
          title: '🚗 Nova Corrida Disponível',
          body: 'Você tem uma nova corrida próxima! Toque para ver detalhes.'
        },
        data: {
          type: 'new_ride',
          bookingId: 'test_booking_' + Date.now(),
          pickupAddress: 'Rua das Flores, 123 - Centro',
          dropAddress: 'Shopping Center - Zona Sul',
          estimatedFare: '25.50',
          distance: '5.2 km',
          timestamp: new Date().toISOString()
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'ride_notifications',
            clickAction: 'FLUTTER_NOTIFICATION_CLICK'
          }
        }
      };

      const response = await this.messaging.send(message);
      console.log(`✅ Notificação de corrida enviada para ${driverInfo.name}:`, response);
      
      return {
        success: true,
        messageId: response,
        driver: driverInfo,
        type: 'ride_notification'
      };

    } catch (error) {
      console.error(`❌ Erro ao enviar notificação de corrida para ${driverInfo.name}:`, error.message);
      
      return {
        success: false,
        error: error.message,
        driver: driverInfo,
        type: 'ride_notification'
      };
    }
  }

  // Executar todos os testes
  async runAllTests() {
    console.log('🚀 INICIANDO TESTES COM TOKENS FCM REAIS');
    console.log('=========================================');
    
    // 1. Buscar usuários com tokens
    const users = await this.findUsersWithFCMTokens();
    
    if (users.length === 0) {
      console.log('⚠️ Nenhum usuário com token FCM encontrado');
      return;
    }
    
    // 2. Mostrar estatísticas
    const drivers = users.filter(u => u.usertype === 'driver');
    const customers = users.filter(u => u.usertype === 'customer');
    
    console.log('\n📊 ESTATÍSTICAS:');
    console.log(`   Total de usuários: ${users.length}`);
    console.log(`   Motoristas: ${drivers.length}`);
    console.log(`   Passageiros: ${customers.length}`);
    
    // 3. Mostrar alguns tokens (primeiros 3)
    console.log('\n🔑 TOKENS FCM ENCONTRADOS:');
    users.slice(0, 3).forEach((user, index) => {
      const token = user.fcmToken || user.pushToken;
      console.log(`${index + 1}. ${user.name} (${user.usertype})`);
      console.log(`   Token: ${token ? token.substring(0, 50) + '...' : 'N/A'}`);
      console.log(`   Platform: ${user.platform || 'N/A'}`);
    });
    
    // 4. Testar notificações de corrida
    console.log('\n🧪 TESTANDO NOTIFICAÇÕES DE CORRIDA...');
    const rideResults = await this.testRideNotificationToDrivers();
    
    // 5. Mostrar resultados
    console.log('\n📊 RESULTADOS DOS TESTES:');
    const successCount = rideResults.filter(r => r.success).length;
    const errorCount = rideResults.filter(r => !r.success).length;
    
    console.log(`✅ Sucessos: ${successCount}`);
    console.log(`❌ Erros: ${errorCount}`);
    console.log(`📈 Taxa de sucesso: ${((successCount / rideResults.length) * 100).toFixed(1)}%`);
    
    // 6. Detalhes dos resultados
    console.log('\n📋 DETALHES:');
    rideResults.forEach((result, index) => {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} ${result.driver.name}: ${result.success ? 'Enviada' : result.error}`);
    });
    
    return {
      totalUsers: users.length,
      drivers: drivers.length,
      customers: customers.length,
      testResults: rideResults
    };
  }
}

// Executar se chamado diretamente
if (require.main === module) {
  const finder = new FCMTokenFinder();
  finder.runAllTests().catch(console.error);
}

module.exports = FCMTokenFinder;


