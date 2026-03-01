/**
 * Teste E2E: Fluxo Motorista Completo
 * 
 * Testa o fluxo completo do modo motorista:
 * Online → Receber → Aceitar → Navegar → Iniciar → Finalizar
 */

const WebSocketTestClient = require('../__helpers__/websocket-test-client');
const testData = require('../__fixtures__/test-data');
const RedisDriverSimulator = require('../__helpers__/redis-driver-simulator');

describe('Fluxo Motorista Completo', () => {
  let driverClient;
  let passengerClient;
  let bookingId;
  let driverSimulator;
  
  const WS_URL = process.env.WS_URL || 'http://localhost:3001';
  
  beforeAll(async () => {
    // Aguardar um pouco para garantir que servidor está pronto
    await testData.helpers.sleep(500);
    
    // Criar simulador de motorista Redis
    driverSimulator = new RedisDriverSimulator();
    
    // Criar clientes
    driverClient = new WebSocketTestClient(WS_URL);
    passengerClient = new WebSocketTestClient(WS_URL);
    
    // Conectar
    await driverClient.connect();
    await passengerClient.connect();
    
    // Aguardar conexão estabilizar
    await testData.helpers.sleep(200);
    
    // Autenticar
    await driverClient.authenticate(
      testData.users.driver.uid,
      testData.users.driver.userType
    );
    
    await passengerClient.authenticate(
      testData.users.customer.uid,
      testData.users.customer.userType
    );
    
    // Aguardar autenticação estabilizar
    await testData.helpers.sleep(200);
    
    // ✅ SIMULAR MOTORISTA ONLINE NO REDIS (como comportamento real)
    await driverSimulator.setDriverOnline(
      testData.users.driver.uid,
      testData.locations.pickup.lat,
      testData.locations.pickup.lng,
      0, // heading
      0, // speed
      true, // isOnline
      false // isInTrip
    );
    
    // Aguardar Redis processar
    await testData.helpers.sleep(500);
    
    // Verificar se motorista está realmente online
    const driverStatus = await driverSimulator.isDriverOnline(testData.users.driver.uid);
    console.log(`✅ [Test] Motorista online no Redis:`, driverStatus);
  });
  
  afterAll(async () => {
    // Limpar motorista do Redis
    if (driverSimulator && testData.users.driver.uid) {
      try {
        await driverSimulator.removeDriver(testData.users.driver.uid);
      } catch (error) {
        console.warn('⚠️ Erro ao limpar motorista do Redis:', error.message);
      }
    }
    
    // Desconectar clientes
    if (driverClient) driverClient.disconnect();
    if (passengerClient) passengerClient.disconnect();
    
    // Aguardar limpeza
    await testData.helpers.sleep(1000);
  });
  
  beforeEach(() => {
    // Limpar eventos antes de cada teste
    driverClient.clearEvents();
    passengerClient.clearEvents();
  });
  
  test('deve completar fluxo completo do motorista', async () => {
    // ========== ETAPA 1: PASSAGEIRO SOLICITA CORRIDA ==========
    console.log('\n📋 ETAPA 1: Passageiro solicita corrida');
    
    const bookingData = testData.booking.createBookingData();
    const bookingResponse = await passengerClient.createBooking(bookingData);
    
    expect(bookingResponse.success).toBe(true);
    expect(bookingResponse.bookingId).toBeDefined();
    bookingId = bookingResponse.bookingId;
    
    console.log(`✅ Corrida criada: ${bookingId}`);
    
    // ========== ETAPA 2: PASSAGEIRO CONFIRMA PAGAMENTO ==========
    console.log('\n💳 ETAPA 2: Passageiro confirma pagamento');
    
    const paymentData = testData.payment.createPaymentData(bookingId);
    const paymentResponse = await passengerClient.confirmPayment(paymentData);
    
    expect(paymentResponse.success).toBe(true);
    
    console.log(`✅ Pagamento confirmado`);
    
    // ========== ETAPA 3: MOTORISTA RECEBE NOTIFICAÇÃO ==========
    console.log('\n🔔 ETAPA 3: Motorista recebe notificação');
    
    // Aguardar notificação de nova corrida
    const notification = await driverClient.waitForEvent('newRideRequest', 20000);
    
    expect(notification).toBeDefined();
    expect(notification.bookingId || notification.rideId).toBe(bookingId);
    
    console.log(`✅ Motorista recebeu notificação da corrida ${bookingId}`);
    
    // ========== ETAPA 4: MOTORISTA ACEITA CORRIDA ==========
    console.log('\n✅ ETAPA 4: Motorista aceita corrida');
    
    const acceptResponse = await driverClient.acceptRide(bookingId);
    
    expect(acceptResponse).toBeDefined();
    
    // Passageiro deve receber confirmação
    const rideAccepted = await passengerClient.waitForEvent('rideAccepted', 10000);
    
    expect(rideAccepted).toBeDefined();
    expect(rideAccepted.bookingId || rideAccepted.rideId).toBe(bookingId);
    
    console.log(`✅ Motorista aceitou corrida. Passageiro recebeu confirmação.`);
    
    // ========== ETAPA 5: MOTORISTA INICIA VIAGEM ==========
    console.log('\n🚀 ETAPA 5: Motorista inicia viagem');
    
    const startTripData = testData.trip.createStartTripData(
      bookingId,
      testData.locations.pickup
    );
    
    const startResponse = await driverClient.startTrip(startTripData);
    
    expect(startResponse).toBeDefined();
    
    // Passageiro deve receber notificação
    const tripStarted = await passengerClient.waitForEvent('tripStarted', 10000);
    
    expect(tripStarted).toBeDefined();
    expect(tripStarted.bookingId || tripStarted.rideId).toBe(bookingId);
    
    console.log(`✅ Viagem iniciada. Passageiro recebeu notificação.`);
    
    // ========== ETAPA 6: MOTORISTA ATUALIZA LOCALIZAÇÃO ==========
    console.log('\n📍 ETAPA 6: Motorista atualiza localização durante viagem');
    
    // Simular atualizações de localização durante viagem
    for (let i = 0; i < 5; i++) {
      const intermediateLocation = {
        lat: testData.locations.pickup.lat + (i * 0.001),
        lng: testData.locations.pickup.lng + (i * 0.001)
      };
      
      driverClient.socket.emit('updateDriverLocation', {
        driverId: testData.users.driver.uid,
        lat: intermediateLocation.lat,
        lng: intermediateLocation.lng,
        heading: 90,
        speed: 30,
        timestamp: Date.now()
      });
      
      await testData.helpers.sleep(500);
    }
    
    console.log(`✅ ${5} atualizações de localização enviadas`);
    
    // ========== ETAPA 7: MOTORISTA FINALIZA VIAGEM ==========
    console.log('\n🏁 ETAPA 7: Motorista finaliza viagem');
    
    const finishTripData = testData.trip.createFinishTripData(
      bookingId,
      testData.locations.destination,
      5.5, // distância em km
      25.50 // valor em reais
    );
    
    const finishResponse = await driverClient.finishTrip(finishTripData);
    
    expect(finishResponse).toBeDefined();
    
    // Passageiro deve receber notificação
    const tripCompleted = await passengerClient.waitForEvent('tripCompleted', 15000);
    
    expect(tripCompleted).toBeDefined();
    expect(tripCompleted.bookingId || tripCompleted.rideId).toBe(bookingId);
    
    console.log(`✅ Viagem finalizada. Passageiro recebeu notificação.`);
    
    // ========== VALIDAÇÕES FINAIS ==========
    console.log('\n✅ VALIDAÇÕES FINAIS');
    
    // Verificar que todos os eventos esperados foram recebidos
    expect(driverClient.hasReceivedEvent('newRideRequest')).toBe(true);
    expect(driverClient.hasReceivedEvent('rideAccepted')).toBe(true);
    expect(driverClient.hasReceivedEvent('tripStarted')).toBe(true);
    expect(driverClient.hasReceivedEvent('tripCompleted')).toBe(true);
    
    console.log('✅ Todos os eventos esperados foram recebidos');
    console.log(`✅ Fluxo completo do motorista concluído com sucesso!`);
  }, 60000); // Timeout de 60 segundos para teste completo
});

