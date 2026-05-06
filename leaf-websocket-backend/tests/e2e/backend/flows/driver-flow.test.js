/**
 * Teste E2E: Fluxo Motorista Completo
 * 
 * Testa o fluxo completo do modo motorista:
 * Online → Receber → Aceitar → Navegar → Iniciar → Finalizar
 */

const WebSocketTestClient = require('../__helpers__/websocket-test-client');
const testData = require('../__fixtures__/test-data');
const RedisDriverSimulator = require('../__helpers__/redis-driver-simulator');
const GeoHashUtils = require('../../../../utils/geohash-utils');

jest.setTimeout(180000);

const RUN_TAG = String(process.env.E2E_RUN_ID || Date.now()).replace(/[^a-zA-Z0-9]/g, '');
const TEST_CUSTOMER_UID = `test_customer_${RUN_TAG}`;
const TEST_DRIVER_UID = `test_driver_${RUN_TAG}`;
const DEFAULT_REGION_HASH = GeoHashUtils.getRegionHashFromLocation(testData.locations.pickup, 5);
const DEFAULT_PENDING_QUEUE_KEY = `ride_queue:${DEFAULT_REGION_HASH}:pending`;
const DEFAULT_ACTIVE_QUEUE_KEY = `ride_queue:${DEFAULT_REGION_HASH}:active`;

describe('Fluxo Motorista Completo', () => {
  let driverClient;
  let passengerClient;
  let bookingId;
  let driverSimulator;
  const createdBookingIds = new Set();
  
  const WS_URL = process.env.WS_URL || 'http://localhost:3001';

  async function cleanupBookingArtifacts(bookingIds = []) {
    const normalizedBookingIds = Array.from(new Set((bookingIds || []).filter(Boolean)));
    if (normalizedBookingIds.length === 0) return;

    await Promise.allSettled(
      normalizedBookingIds.map((targetBookingId) =>
        driverSimulator.del(
          `booking:${targetBookingId}`,
          `booking_search:${targetBookingId}`,
          `ride_notifications:${targetBookingId}`,
          `ride_excluded_drivers:${targetBookingId}`
        )
      )
    );

    if (driverSimulator.useRemoteRedis) {
      await Promise.allSettled(
        normalizedBookingIds.map((targetBookingId) =>
          Promise.allSettled([
            driverSimulator.zrem(DEFAULT_PENDING_QUEUE_KEY, targetBookingId),
            driverSimulator.hdel(DEFAULT_ACTIVE_QUEUE_KEY, targetBookingId)
          ])
        )
      );
      return;
    }

    const [pendingQueues, activeQueues] = await Promise.all([
      driverSimulator.keys('ride_queue:*:pending'),
      driverSimulator.keys('ride_queue:*:active')
    ]);

    await Promise.allSettled(
      normalizedBookingIds.map(async (targetBookingId) => {
        await Promise.allSettled([
          ...pendingQueues.map((queueKey) => driverSimulator.zrem(queueKey, targetBookingId)),
          ...activeQueues.map((queueKey) => driverSimulator.hdel(queueKey, targetBookingId))
        ]);
      })
    );
  }
  
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
      TEST_DRIVER_UID,
      testData.users.driver.userType
    );
    
    await passengerClient.authenticate(
      TEST_CUSTOMER_UID,
      testData.users.customer.userType
    );
    
    // Aguardar autenticação estabilizar
    await testData.helpers.sleep(200);
    
    // ✅ SIMULAR MOTORISTA ONLINE NO REDIS (como comportamento real)
    await driverSimulator.setDriverOnline(
      TEST_DRIVER_UID,
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
    const driverStatus = await driverSimulator.isDriverOnline(TEST_DRIVER_UID);
    console.log(`✅ [Test] Motorista online no Redis:`, driverStatus);
  });
  
  afterAll(async () => {
    await cleanupBookingArtifacts(Array.from(createdBookingIds));

    // Limpar motorista do Redis
    if (driverSimulator && TEST_DRIVER_UID) {
      try {
        await driverSimulator.removeDriver(TEST_DRIVER_UID);
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
  
  beforeEach(async () => {
    // Limpar eventos antes de cada teste
    driverClient.clearEvents();
    passengerClient.clearEvents();

    if (driverSimulator.useRemoteRedis) {
      await cleanupBookingArtifacts(Array.from(createdBookingIds));
      createdBookingIds.clear();
    } else {
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
    }

    await driverSimulator.del(
      `driver_lock:${TEST_DRIVER_UID}`,
      `driver_active_notification:${TEST_DRIVER_UID}`,
      `active_trip_by_driver:${TEST_DRIVER_UID}`,
      `active_trip_customer_by_driver:${TEST_DRIVER_UID}`,
      'bookings:active',
      'activeRides'
    );

    await driverSimulator.setDriverOnline(
      TEST_DRIVER_UID,
      testData.locations.pickup.lat,
      testData.locations.pickup.lng,
      0,
      0,
      true,
      false
    );
    await testData.helpers.sleep(150);
  }, 90000);

  afterEach(async () => {
    await cleanupBookingArtifacts(Array.from(createdBookingIds));
    createdBookingIds.clear();
    bookingId = null;
  }, 120000);
  
  test('deve completar fluxo completo do motorista', async () => {
    // ========== ETAPA 1: PASSAGEIRO SOLICITA CORRIDA ==========
    console.log('\n📋 ETAPA 1: Passageiro solicita corrida');
    
    const bookingData = testData.booking.createBookingData(null, null, TEST_CUSTOMER_UID);
    const bookingResponse = await passengerClient.createBooking(bookingData);
    
    expect(bookingResponse.success).toBe(true);
    expect(bookingResponse.bookingId).toBeDefined();
    bookingId = bookingResponse.bookingId;
    createdBookingIds.add(bookingId);
    
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
    const notification = await driverClient.waitForEvent(
      'newRideRequest',
      30000,
      (event) => (event?.bookingId || event?.rideId) === bookingId
    );
    
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
    
    await driverClient.arrivedAtPickup(bookingId);
    await testData.helpers.sleep(300);
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
      
      driverClient.socket.emit('updateLocation', {
        driverId: TEST_DRIVER_UID,
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
  }, 120000); // Timeout ampliado para execução remota/VPS
});
