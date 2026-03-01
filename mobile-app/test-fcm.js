#!/usr/bin/env node

/**
 * 🧪 TESTE FCM - FIREBASE CLOUD MESSAGING
 * 
 * Este script testa o sistema de notificações FCM do Leaf App
 * Simula o fluxo completo de notificações de corrida
 */

const admin = require('firebase-admin');

// Configuração do Firebase Admin
const serviceAccount = {
  "type": "service_account",
  "project_id": "leaf-reactnative",
  "private_key_id": "YOUR_PRIVATE_KEY_ID",
  "private_key": "YOUR_PRIVATE_KEY",
  "client_email": "firebase-adminsdk-xxxxx@leaf-reactnative.iam.gserviceaccount.com",
  "client_id": "YOUR_CLIENT_ID",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xxxxx%40leaf-reactnative.iam.gserviceaccount.com"
};

// Inicializar Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'leaf-reactnative'
  });
}

class FCMTester {
  constructor() {
    this.db = admin.firestore();
    this.messaging = admin.messaging();
    this.testResults = [];
  }

  // Teste 1: Enviar notificação de nova corrida
  async testNewRideNotification() {
    console.log('🧪 TESTE 1: Notificação de Nova Corrida');
    
    try {
      const message = {
        token: 'DEVICE_TOKEN_AQUI', // Token do dispositivo do motorista
        notification: {
          title: '🚗 Nova Corrida Disponível',
          body: 'Você tem uma nova corrida próxima!'
        },
        data: {
          type: 'new_ride',
          bookingId: 'test_booking_123',
          pickupAddress: 'Rua das Flores, 123',
          dropAddress: 'Shopping Center',
          estimatedFare: '25.50',
          distance: '5.2 km',
          timestamp: new Date().toISOString()
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'ride_notifications'
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
      console.log('✅ Notificação enviada com sucesso:', response);
      
      this.testResults.push({
        test: 'new_ride_notification',
        status: 'success',
        messageId: response
      });

    } catch (error) {
      console.error('❌ Erro ao enviar notificação:', error);
      this.testResults.push({
        test: 'new_ride_notification',
        status: 'error',
        error: error.message
      });
    }
  }

  // Teste 2: Notificação de pagamento confirmado
  async testPaymentConfirmedNotification() {
    console.log('🧪 TESTE 2: Notificação de Pagamento Confirmado');
    
    try {
      const message = {
        token: 'DEVICE_TOKEN_AQUI', // Token do dispositivo do passageiro
        notification: {
          title: '💳 Pagamento Confirmado',
          body: 'Seu pagamento foi processado com sucesso!'
        },
        data: {
          type: 'payment_confirmed',
          bookingId: 'test_booking_123',
          amount: '25.50',
          paymentMethod: 'woovi',
          timestamp: new Date().toISOString()
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'payment_notifications'
          }
        }
      };

      const response = await this.messaging.send(message);
      console.log('✅ Notificação de pagamento enviada:', response);
      
      this.testResults.push({
        test: 'payment_confirmed_notification',
        status: 'success',
        messageId: response
      });

    } catch (error) {
      console.error('❌ Erro ao enviar notificação de pagamento:', error);
      this.testResults.push({
        test: 'payment_confirmed_notification',
        status: 'error',
        error: error.message
      });
    }
  }

  // Teste 3: Notificação de motorista aceitou corrida
  async testRideAcceptedNotification() {
    console.log('🧪 TESTE 3: Notificação de Corrida Aceita');
    
    try {
      const message = {
        token: 'DEVICE_TOKEN_AQUI', // Token do dispositivo do passageiro
        notification: {
          title: '✅ Motorista Aceitou sua Corrida',
          body: 'João está a caminho do local de embarque'
        },
        data: {
          type: 'ride_accepted',
          bookingId: 'test_booking_123',
          driverName: 'João Silva',
          driverPhone: '+5511999999999',
          estimatedArrival: '5 minutos',
          driverLocation: JSON.stringify({
            lat: -23.5505,
            lng: -46.6333
          }),
          timestamp: new Date().toISOString()
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'ride_status_notifications'
          }
        }
      };

      const response = await this.messaging.send(message);
      console.log('✅ Notificação de corrida aceita enviada:', response);
      
      this.testResults.push({
        test: 'ride_accepted_notification',
        status: 'success',
        messageId: response
      });

    } catch (error) {
      console.error('❌ Erro ao enviar notificação de corrida aceita:', error);
      this.testResults.push({
        test: 'ride_accepted_notification',
        status: 'error',
        error: error.message
      });
    }
  }

  // Teste 4: Notificação de motorista chegou
  async testDriverArrivedNotification() {
    console.log('🧪 TESTE 4: Notificação de Motorista Chegou');
    
    try {
      const message = {
        token: 'DEVICE_TOKEN_AQUI', // Token do dispositivo do passageiro
        notification: {
          title: '📍 Motorista Chegou',
          body: 'João está aguardando no local de embarque'
        },
        data: {
          type: 'driver_arrived',
          bookingId: 'test_booking_123',
          driverName: 'João Silva',
          driverPhone: '+5511999999999',
          pickupAddress: 'Rua das Flores, 123',
          timestamp: new Date().toISOString()
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'ride_status_notifications'
          }
        }
      };

      const response = await this.messaging.send(message);
      console.log('✅ Notificação de motorista chegou enviada:', response);
      
      this.testResults.push({
        test: 'driver_arrived_notification',
        status: 'success',
        messageId: response
      });

    } catch (error) {
      console.error('❌ Erro ao enviar notificação de motorista chegou:', error);
      this.testResults.push({
        test: 'driver_arrived_notification',
        status: 'error',
        error: error.message
      });
    }
  }

  // Teste 5: Notificação de viagem iniciada
  async testTripStartedNotification() {
    console.log('🧪 TESTE 5: Notificação de Viagem Iniciada');
    
    try {
      const message = {
        token: 'DEVICE_TOKEN_AQUI', // Token do dispositivo do passageiro
        notification: {
          title: '🚀 Viagem Iniciada',
          body: 'Você está a caminho do destino'
        },
        data: {
          type: 'trip_started',
          bookingId: 'test_booking_123',
          driverName: 'João Silva',
          dropAddress: 'Shopping Center',
          estimatedDuration: '15 minutos',
          timestamp: new Date().toISOString()
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'ride_status_notifications'
          }
        }
      };

      const response = await this.messaging.send(message);
      console.log('✅ Notificação de viagem iniciada enviada:', response);
      
      this.testResults.push({
        test: 'trip_started_notification',
        status: 'success',
        messageId: response
      });

    } catch (error) {
      console.error('❌ Erro ao enviar notificação de viagem iniciada:', error);
      this.testResults.push({
        test: 'trip_started_notification',
        status: 'error',
        error: error.message
      });
    }
  }

  // Teste 6: Notificação de viagem finalizada
  async testTripCompletedNotification() {
    console.log('🧪 TESTE 6: Notificação de Viagem Finalizada');
    
    try {
      const message = {
        token: 'DEVICE_TOKEN_AQUI', // Token do dispositivo do passageiro
        notification: {
          title: '✅ Viagem Finalizada',
          body: 'Avalie sua experiência com o motorista'
        },
        data: {
          type: 'trip_completed',
          bookingId: 'test_booking_123',
          driverName: 'João Silva',
          finalFare: '25.50',
          distance: '5.2 km',
          duration: '15 minutos',
          timestamp: new Date().toISOString()
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            channelId: 'ride_status_notifications'
          }
        }
      };

      const response = await this.messaging.send(message);
      console.log('✅ Notificação de viagem finalizada enviada:', response);
      
      this.testResults.push({
        test: 'trip_completed_notification',
        status: 'success',
        messageId: response
      });

    } catch (error) {
      console.error('❌ Erro ao enviar notificação de viagem finalizada:', error);
      this.testResults.push({
        test: 'trip_completed_notification',
        status: 'error',
        error: error.message
      });
    }
  }

  // Executar todos os testes
  async runAllTests() {
    console.log('🚀 INICIANDO TESTES FCM - LEAF APP');
    console.log('=====================================');
    
    await this.testNewRideNotification();
    await this.testPaymentConfirmedNotification();
    await this.testRideAcceptedNotification();
    await this.testDriverArrivedNotification();
    await this.testTripStartedNotification();
    await this.testTripCompletedNotification();
    
    this.printResults();
  }

  // Imprimir resultados
  printResults() {
    console.log('\n📊 RESULTADOS DOS TESTES FCM');
    console.log('=============================');
    
    const successCount = this.testResults.filter(r => r.status === 'success').length;
    const errorCount = this.testResults.filter(r => r.status === 'error').length;
    
    console.log(`✅ Sucessos: ${successCount}`);
    console.log(`❌ Erros: ${errorCount}`);
    console.log(`📈 Taxa de sucesso: ${((successCount / this.testResults.length) * 100).toFixed(1)}%`);
    
    console.log('\n📋 DETALHES:');
    this.testResults.forEach((result, index) => {
      const status = result.status === 'success' ? '✅' : '❌';
      console.log(`${status} ${result.test}: ${result.status}`);
      if (result.error) {
        console.log(`   Erro: ${result.error}`);
      }
    });
  }
}

// Executar testes se chamado diretamente
if (require.main === module) {
  const tester = new FCMTester();
  tester.runAllTests().catch(console.error);
}

module.exports = FCMTester;


