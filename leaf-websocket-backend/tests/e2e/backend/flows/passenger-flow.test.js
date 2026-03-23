/**
 * Teste E2E: Fluxo Passageiro Completo
 * 
 * Testa o fluxo completo do modo passageiro:
 * Solicitar → Pagar → Buscar → Aceitar → Iniciar → Finalizar
 */

const WebSocketTestClient = require('../__helpers__/websocket-test-client');
const testData = require('../__fixtures__/test-data');
const RedisDriverSimulator = require('../__helpers__/redis-driver-simulator');

describe('Fluxo Passageiro Completo', () => {
  let passengerClient;
  let driverClient;
  let bookingId;
  let driverSimulator;

  const WS_URL = process.env.WS_URL || 'http://localhost:3001';

  beforeAll(async () => {
    // Aguardar um pouco para garantir que servidor está pronto
    await testData.helpers.sleep(500);

    // Criar simulador de motorista Redis
    driverSimulator = new RedisDriverSimulator();

    // Criar clientes
    passengerClient = new WebSocketTestClient(WS_URL);
    driverClient = new WebSocketTestClient(WS_URL);

    // Conectar
    await passengerClient.connect();
    await driverClient.connect();

    // Aguardar conexão estabilizar
    await testData.helpers.sleep(200);

    // Autenticar
    await passengerClient.authenticate(
      testData.users.customer.uid,
      testData.users.customer.userType
    );

    await driverClient.authenticate(
      testData.users.driver.uid,
      testData.users.driver.userType
    );

    // Aguardar autenticação estabilizar
    await testData.helpers.sleep(200);

    // ✅ SIMULAR MOTORISTA ONLINE NO REDIS (como comportamento real)
    // Isso replica exatamente o que o servidor faz quando um motorista fica online
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
    if (passengerClient) passengerClient.disconnect();
    if (driverClient) driverClient.disconnect();

    // Aguardar limpeza
    await testData.helpers.sleep(1000);
  });

  beforeEach(async () => {
    // Limpar eventos antes de cada teste
    passengerClient.clearEvents();
    driverClient.clearEvents();

    const [bookingKeys, searchKeys, notificationKeys, excludedDriverKeys, pendingQueues, activeQueues] = await Promise.all([
      driverSimulator.keys('booking:*'),
      driverSimulator.keys('booking_search:*'),
      driverSimulator.keys('ride_notifications:*'),
      driverSimulator.keys('ride_excluded_drivers:*'),
      driverSimulator.keys('ride_queue:*:pending'),
      driverSimulator.keys('ride_queue:*:active')
    ]);

    await Promise.allSettled([
      bookingKeys.length ? driverSimulator.del(...bookingKeys) : Promise.resolve(),
      searchKeys.length ? driverSimulator.del(...searchKeys) : Promise.resolve(),
      notificationKeys.length ? driverSimulator.del(...notificationKeys) : Promise.resolve(),
      excludedDriverKeys.length ? driverSimulator.del(...excludedDriverKeys) : Promise.resolve(),
      pendingQueues.length ? driverSimulator.del(...pendingQueues) : Promise.resolve(),
      activeQueues.length ? driverSimulator.del(...activeQueues) : Promise.resolve()
    ]);

    // Reforçar estado online para evitar flakiness após testes que finalizam corrida
    await driverSimulator.del(
      `driver_lock:${testData.users.driver.uid}`,
      `driver_active_notification:${testData.users.driver.uid}`,
      `active_trip_by_driver:${testData.users.driver.uid}`,
      `active_trip_customer_by_driver:${testData.users.driver.uid}`
    );
    await driverSimulator.setDriverOnline(
      testData.users.driver.uid,
      testData.locations.pickup.lat,
      testData.locations.pickup.lng,
      0,
      0,
      true,
      false
    );
    await testData.helpers.sleep(150);
  });

  test('deve completar fluxo completo de corrida', async () => {
    // ========== ETAPA 1: SOLICITAR CORRIDA ==========
    console.log('\n📋 ETAPA 1: Solicitar corrida');

    const bookingData = testData.booking.createBookingData();
    const bookingResponse = await passengerClient.createBooking(bookingData);

    expect(bookingResponse.success).toBe(true);
    expect(bookingResponse.bookingId).toBeDefined();
    bookingId = bookingResponse.bookingId;

    console.log(`✅ Corrida criada: ${bookingId}`);

    // ========== ETAPA 2: CONFIRMAR PAGAMENTO ==========
    console.log('\n💳 ETAPA 2: Confirmar pagamento');

    const paymentData = testData.payment.createPaymentData(bookingId);
    const paymentResponse = await passengerClient.confirmPayment(paymentData);

    expect(paymentResponse.success).toBe(true);
    expect(paymentResponse.bookingId).toBe(bookingId);

    console.log(`✅ Pagamento confirmado: R$ ${paymentData.amount}`);

    // ========== ETAPA 3: DRIVER RECEBE NOTIFICAÇÃO ==========
    console.log('\n🔔 ETAPA 3: Driver recebe notificação');

    // Motorista já está online no Redis (simulado no beforeAll)
    // Verificar se está realmente disponível
    const driverStatus = await driverSimulator.isDriverOnline(testData.users.driver.uid);
    expect(driverStatus.exists).toBe(true);
    expect(driverStatus.isOnline).toBe(true);
    console.log(`✅ Motorista verificado online no Redis antes de criar corrida`);

    // Aguardar notificação de nova corrida (evento: newRideRequest)
    const notification = await driverClient.waitForEvent(
      'newRideRequest',
      45000,
      (event) => (event?.bookingId || event?.rideId) === bookingId
    );

    expect(notification).toBeDefined();
    console.log(`[DEBUG Teste 1] Recebeu notificação para bookingId:`, notification.bookingId || notification.rideId, 'Esperado:', bookingId);

    console.log(`✅ Driver recebeu notificação da corrida ${bookingId}`);

    // ========== ETAPA 4: DRIVER ACEITA CORRIDA ==========
    console.log('\n✅ ETAPA 4: Driver aceita corrida');

    const acceptResponse = await driverClient.acceptRide(bookingId);

    expect(acceptResponse).toBeDefined();
    // Pode retornar sucesso ou apenas emitir evento

    // Passageiro deve receber confirmação
    const rideAccepted = await passengerClient.waitForEvent('rideAccepted', 10000);

    expect(rideAccepted).toBeDefined();
    expect(rideAccepted.bookingId || rideAccepted.rideId).toBe(bookingId);

    console.log(`✅ Driver aceitou corrida. Passageiro recebeu confirmação.`);

    // ========== ETAPA 5: INICIAR VIAGEM ==========
    console.log('\n🚀 ETAPA 5: Iniciar viagem');

    // Reforço de estado: alguns fluxos exigem marcação explícita de chegada antes do startTrip.
    await driverClient.arrivedAtPickup(bookingId);
    await testData.helpers.sleep(400);

    const startTripData = testData.trip.createStartTripData(
      bookingId,
      testData.locations.pickup
    );

    const startResponse = await driverClient.startTrip(startTripData);

    expect(startResponse).toBeDefined();
    // Pode retornar sucesso ou apenas emitir evento

    // Passageiro deve receber notificação
    const tripStarted = await passengerClient.waitForEvent('tripStarted', 10000);

    expect(tripStarted).toBeDefined();
    expect(tripStarted.bookingId || tripStarted.rideId).toBe(bookingId);

    console.log(`✅ Viagem iniciada. Passageiro recebeu notificação.`);

    // ========== ETAPA 6: ATUALIZAR LOCALIZAÇÃO (Simular durante viagem) ==========
    console.log('\n📍 ETAPA 6: Atualizar localização durante viagem');

    // Simular algumas atualizações de localização
    for (let i = 0; i < 3; i++) {
      const intermediateLocation = {
        lat: testData.locations.pickup.lat + (i * 0.001),
        lng: testData.locations.pickup.lng + (i * 0.001)
      };

      driverClient.socket.emit('updateLocation', {
        driverId: testData.users.driver.uid,
        lat: intermediateLocation.lat,
        lng: intermediateLocation.lng,
        heading: 90,
        speed: 30
      });

      await testData.helpers.sleep(500);
    }

    console.log(`✅ ${3} atualizações de localização enviadas`);

    // ========== ETAPA 7: FINALIZAR VIAGEM ==========
    console.log('\n🏁 ETAPA 7: Finalizar viagem');

    const finishTripData = testData.trip.createFinishTripData(
      bookingId,
      testData.locations.destination,
      5.5, // distância em km
      25.50 // valor em reais
    );

    const finishResponse = await driverClient.finishTrip(finishTripData);

    expect(finishResponse).toBeDefined();

    // Passageiro deve receber notificação
    const tripCompleted = await passengerClient.waitForEvent('tripCompleted', 10000);

    expect(tripCompleted).toBeDefined();
    expect(tripCompleted.bookingId || tripCompleted.rideId).toBe(bookingId);

    console.log(`✅ Viagem finalizada. Passageiro recebeu notificação.`);

    // ========== VALIDAÇÕES FINAIS ==========
    console.log('\n✅ VALIDAÇÕES FINAIS');

    // Verificar que todos os eventos esperados foram recebidos
    expect(passengerClient.hasReceivedEvent('bookingCreated')).toBe(true);
    expect(passengerClient.hasReceivedEvent('paymentConfirmed')).toBe(true);
    expect(passengerClient.hasReceivedEvent('rideAccepted')).toBe(true);
    expect(passengerClient.hasReceivedEvent('tripStarted')).toBe(true);
    expect(passengerClient.hasReceivedEvent('tripCompleted')).toBe(true);

    console.log('✅ Todos os eventos esperados foram recebidos');
    console.log(`✅ Fluxo completo concluído com sucesso!`);
  }, 120000); // Timeout ampliado para execução estável em VPS real

  test('deve validar cada etapa do fluxo individualmente', async () => {
    // Teste mais granular para debug
    // Motorista já está online no Redis (simulado no beforeAll)

    const bookingData = testData.booking.createBookingData();

    // Etapa 1: Criar booking
    const booking = await passengerClient.createBooking(bookingData);
    expect(booking.success).toBe(true);

    // Etapa 2: Confirmar pagamento
    const payment = await passengerClient.confirmPayment(
      testData.payment.createPaymentData(booking.bookingId)
    );
    expect(payment.success).toBe(true);

    // Etapa 3: Driver recebe notificação (evento correto: newRideRequest)
    // Motorista já está online no Redis, então deve receber notificação
    const notification = await driverClient.waitForEvent(
      'newRideRequest',
      45000,
      (event) => (event?.bookingId || event?.rideId) === booking.bookingId
    );
    expect(notification).toBeDefined();
    console.log(`[DEBUG Teste 2] Recebeu notificação para bookingId:`, notification.bookingId || notification.rideId, 'Esperado:', booking.bookingId);

    // Etapa 4: Driver aceita
    await driverClient.acceptRide(booking.bookingId);
    const accepted = await passengerClient.waitForEvent('rideAccepted', 10000);
    expect(accepted).toBeDefined();
  }, 90000);
});
