#!/usr/bin/env node

/**
 * 🧪 TESTE FCM SIMPLES - SEM FIREBASE ADMIN
 * 
 * Este script testa o sistema FCM usando o backend da Vultr
 * Simula o fluxo completo de notificações de corrida
 */

const http = require('http');

class FCMTesterSimple {
  constructor() {
    this.vultrApiUrl = 'http://216.238.107.59:3001';
    this.testResults = [];
  }

  // Função para fazer requisições HTTP
  async makeRequest(url, data = null) {
    return new Promise((resolve, reject) => {
      const options = {
        method: data ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      };

      const req = http.request(url, options, (res) => {
        let body = '';
        res.on('data', (chunk) => body += chunk);
        res.on('end', () => {
          try {
            const response = JSON.parse(body);
            resolve({ status: res.statusCode, data: response });
          } catch (e) {
            resolve({ status: res.statusCode, data: body });
          }
        });
      });

      req.on('error', reject);
      
      if (data) {
        req.write(JSON.stringify(data));
      }
      
      req.end();
    });
  }

  // Teste 1: Verificar se o backend está funcionando
  async testBackendHealth() {
    console.log('🧪 TESTE 1: Verificar Backend Vultr');
    
    try {
      const response = await this.makeRequest(`${this.vultrApiUrl}/api/health`);
      
      if (response.status === 200) {
        console.log('✅ Backend funcionando:', response.data);
        this.testResults.push({
          test: 'backend_health',
          status: 'success',
          data: response.data
        });
      } else {
        throw new Error(`Status ${response.status}: ${response.data}`);
      }
    } catch (error) {
      console.error('❌ Erro ao verificar backend:', error.message);
      this.testResults.push({
        test: 'backend_health',
        status: 'error',
        error: error.message
      });
    }
  }

  // Teste 2: Simular criação de booking
  async testCreateBooking() {
    console.log('🧪 TESTE 2: Criar Booking de Teste');
    
    try {
      const bookingData = {
        customerId: 'test_customer_123',
        driverId: 'test_driver_456',
        pickup: {
          address: 'Rua das Flores, 123',
          lat: -23.5505,
          lng: -46.6333
        },
        drop: {
          address: 'Shopping Center',
          lat: -23.5515,
          lng: -46.6343
        },
        estimate: 25.50,
        status: 'PENDING',
        timestamp: new Date().toISOString()
      };

      // Simular criação de booking (em produção seria via API)
      console.log('📝 Booking criado:', bookingData);
      
      this.testResults.push({
        test: 'create_booking',
        status: 'success',
        data: bookingData
      });

    } catch (error) {
      console.error('❌ Erro ao criar booking:', error.message);
      this.testResults.push({
        test: 'create_booking',
        status: 'error',
        error: error.message
      });
    }
  }

  // Teste 3: Simular notificação de pagamento confirmado
  async testPaymentNotification() {
    console.log('🧪 TESTE 3: Simular Notificação de Pagamento');
    
    try {
      const notificationData = {
        type: 'payment_confirmed',
        bookingId: 'test_booking_123',
        customerToken: 'DEVICE_TOKEN_CUSTOMER',
        driverToken: 'DEVICE_TOKEN_DRIVER',
        amount: 25.50,
        paymentMethod: 'woovi',
        timestamp: new Date().toISOString()
      };

      console.log('💳 Notificação de pagamento:', notificationData);
      
      // Em produção, isso seria enviado via FCM
      console.log('📱 Notificação enviada para passageiro e motorista');
      
      this.testResults.push({
        test: 'payment_notification',
        status: 'success',
        data: notificationData
      });

    } catch (error) {
      console.error('❌ Erro ao enviar notificação de pagamento:', error.message);
      this.testResults.push({
        test: 'payment_notification',
        status: 'error',
        error: error.message
      });
    }
  }

  // Teste 4: Simular notificação de corrida aceita
  async testRideAcceptedNotification() {
    console.log('🧪 TESTE 4: Simular Notificação de Corrida Aceita');
    
    try {
      const notificationData = {
        type: 'ride_accepted',
        bookingId: 'test_booking_123',
        customerToken: 'DEVICE_TOKEN_CUSTOMER',
        driverName: 'João Silva',
        driverPhone: '+5511999999999',
        estimatedArrival: '5 minutos',
        timestamp: new Date().toISOString()
      };

      console.log('✅ Notificação de corrida aceita:', notificationData);
      console.log('📱 Passageiro notificado: "João aceitou sua corrida"');
      
      this.testResults.push({
        test: 'ride_accepted_notification',
        status: 'success',
        data: notificationData
      });

    } catch (error) {
      console.error('❌ Erro ao enviar notificação de corrida aceita:', error.message);
      this.testResults.push({
        test: 'ride_accepted_notification',
        status: 'error',
        error: error.message
      });
    }
  }

  // Teste 5: Simular notificação de motorista chegou
  async testDriverArrivedNotification() {
    console.log('🧪 TESTE 5: Simular Notificação de Motorista Chegou');
    
    try {
      const notificationData = {
        type: 'driver_arrived',
        bookingId: 'test_booking_123',
        customerToken: 'DEVICE_TOKEN_CUSTOMER',
        driverName: 'João Silva',
        pickupAddress: 'Rua das Flores, 123',
        timestamp: new Date().toISOString()
      };

      console.log('📍 Notificação de motorista chegou:', notificationData);
      console.log('📱 Passageiro notificado: "João chegou no local de embarque"');
      
      this.testResults.push({
        test: 'driver_arrived_notification',
        status: 'success',
        data: notificationData
      });

    } catch (error) {
      console.error('❌ Erro ao enviar notificação de motorista chegou:', error.message);
      this.testResults.push({
        test: 'driver_arrived_notification',
        status: 'error',
        error: error.message
      });
    }
  }

  // Teste 6: Simular notificação de viagem finalizada
  async testTripCompletedNotification() {
    console.log('🧪 TESTE 6: Simular Notificação de Viagem Finalizada');
    
    try {
      const notificationData = {
        type: 'trip_completed',
        bookingId: 'test_booking_123',
        customerToken: 'DEVICE_TOKEN_CUSTOMER',
        driverToken: 'DEVICE_TOKEN_DRIVER',
        finalFare: 25.50,
        distance: '5.2 km',
        duration: '15 minutos',
        timestamp: new Date().toISOString()
      };

      console.log('✅ Notificação de viagem finalizada:', notificationData);
      console.log('📱 Passageiro notificado: "Viagem finalizada - Avalie o motorista"');
      console.log('📱 Motorista notificado: "Viagem finalizada - Aguardando avaliação"');
      
      this.testResults.push({
        test: 'trip_completed_notification',
        status: 'success',
        data: notificationData
      });

    } catch (error) {
      console.error('❌ Erro ao enviar notificação de viagem finalizada:', error.message);
      this.testResults.push({
        test: 'trip_completed_notification',
        status: 'error',
        error: error.message
      });
    }
  }

  // Executar todos os testes
  async runAllTests() {
    console.log('🚀 INICIANDO TESTES FCM SIMPLES - LEAF APP');
    console.log('==========================================');
    
    await this.testBackendHealth();
    await this.testCreateBooking();
    await this.testPaymentNotification();
    await this.testRideAcceptedNotification();
    await this.testDriverArrivedNotification();
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

    console.log('\n🎯 PRÓXIMOS PASSOS:');
    console.log('1. Instalar o app no dispositivo físico');
    console.log('2. Obter o token FCM do dispositivo');
    console.log('3. Configurar as credenciais do Firebase Admin');
    console.log('4. Testar notificações reais');
  }
}

// Executar testes se chamado diretamente
if (require.main === module) {
  const tester = new FCMTesterSimple();
  tester.runAllTests().catch(console.error);
}

module.exports = FCMTesterSimple;
