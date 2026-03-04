/**
 * RIDE EXTENSION E2E TEST - LEAF BACKEND
 * 
 * Verifies the complete flow of extending/changing destination during an active ride.
 */

const WebSocketTestClient = require('../__helpers__/websocket-test-client');
const RedisDriverSimulator = require('../__helpers__/redis-driver-simulator');
const testData = require('../__fixtures__/test-data');
const redisPool = require('../../../../utils/redis-pool');

console.log('🔍 [INIT] Test file loaded');

const WS_URL = process.env.WS_URL || 'http://localhost:3001';

describe('Ride Extension E2E Tests', () => {
    let drivers = [];
    let redis;
    const driverSim = new RedisDriverSimulator();

    beforeAll(async () => {
        redis = redisPool.getConnection();
        await redisPool.ensureConnection();
    });

    afterEach(async () => {
        for (const driverId of drivers) {
            await driverSim.removeDriver(driverId);
        }
        drivers = [];
    });

    test('Scenario 1: Fare Increase (Ride Extension via Pix)', async () => {
        console.log('\n🚀 Scenario 1: Fare Increase (Ride Extension via Pix)...');

        const customerId = `customer_${Date.now()}`;
        const driverId = `driver_${Date.now()}`;

        // 1. Setup Motorista
        console.log('📡 Setting driver online...');
        await driverSim.setDriverOnline(driverId, -23.5505, -46.6333);
        drivers.push(driverId);

        const client = new WebSocketTestClient(WS_URL);
        const dClient = new WebSocketTestClient(WS_URL);

        try {
            console.log('📡 Connecting clients...');
            await client.connect();
            await client.authenticate(customerId, 'customer');
            await dClient.connect();
            await dClient.authenticate(driverId, 'driver');
            console.log('✅ Clients authenticated');

            // 2. Criar e Aceitar Corrida
            console.log('📡 Creating booking...');
            const booking = await client.createBooking(testData.booking.createBookingData(null, null, customerId));
            const bookingId = booking.bookingId;
            console.log(`✅ Booking created: ${bookingId}`);

            console.log('📡 Confirming payment...');
            await client.confirmPayment(testData.payment.createPaymentData(bookingId));
            console.log('✅ Payment confirmed');

            console.log('📡 Driver awaiting request...');
            await dClient.waitForEvent('newRideRequest', 15000);

            console.log('📡 Accepting ride...');
            await dClient.acceptRide(bookingId);
            console.log('✅ Ride accepted');

            // ✅ NOVO: Notificar chegada ao local (IMPORTANTE: isso ativa a corrida no hash bookings:active)
            console.log('📡 Motorista chegando ao local...');
            await dClient.arrivedAtPickup(bookingId);
            console.log('✅ Motorista chegou ao local');

            // Iniciar viagem
            console.log('📡 Starting trip...');
            await dClient.startTrip({
                bookingId,
                startLocation: testData.locations.pickup
            });
            console.log('✅ Viagem iniciada');

            // 4. Solicitar Extensão (Destino mais longe)
            const newDest = { lat: -23.6000, lng: -46.7000, address: 'Extensão Distante' };
            const newFare = 45.00; // Original era 25.50

            console.log('📡 Solicitando extensão via Pix...');
            const extensionPromise = client.requestRideExtension({
                bookingId,
                newEndLocation: newDest,
                newFare: newFare
            });

            // Motorista deve receber notificação
            console.log('📡 Awaiting driver notification...');
            const driverNotification = await dClient.waitForEvent('rideExtensionRequested');
            expect(driverNotification.bookingId).toBe(bookingId);
            console.log('✅ Motorista notificado da extensão');

            const extensionResult = await extensionPromise;
            expect(extensionResult.success).toBe(true);
            expect(extensionResult.bookingId).toBe(bookingId);
            expect(extensionResult.paymentRequired).toBe(true);
            expect(extensionResult.pixQRCode).toBeDefined();
            console.log('✅ QR Code Pix recebido para a diferença');

        } catch (error) {
            console.error('❌ Erro no teste Scenario 1:', error.message);
            throw error;
        } finally {
            client.disconnect();
            dClient.disconnect();
        }
    }, 60000);

    test('Scenario 2: Fare Decrease/Same (Direct Change Destination)', async () => {
        console.log('\n🚀 Scenario 2: Fare Decrease/Same (Direct Change)...');

        const customerId = `customer_b_${Date.now()}`;
        const driverId = `driver_b_${Date.now()}`;

        console.log('📡 Setting driver online...');
        await driverSim.setDriverOnline(driverId, -23.5505, -46.6333);
        drivers.push(driverId);

        const client = new WebSocketTestClient(WS_URL);
        const dClient = new WebSocketTestClient(WS_URL);

        try {
            console.log('📡 Connecting clients...');
            await client.connect();
            await client.authenticate(customerId, 'customer');
            await dClient.connect();
            await dClient.authenticate(driverId, 'driver');
            console.log('✅ Clients authenticated');

            // 2. Criar e Aceitar Corrida
            console.log('📡 Creating booking...');
            const booking = await client.createBooking(testData.booking.createBookingData(null, null, customerId));
            const bookingId = booking.bookingId;
            console.log(`✅ Booking created: ${bookingId}`);

            console.log('📡 Confirming payment...');
            await client.confirmPayment(testData.payment.createPaymentData(bookingId));
            console.log('✅ Payment confirmed');

            console.log('📡 Driver awaiting request...');
            await dClient.waitForEvent('newRideRequest', 15000);

            console.log('📡 Accepting ride...');
            await dClient.acceptRide(bookingId);
            console.log('✅ Ride accepted');

            console.log('📡 Starting trip...');
            await dClient.startTrip({ bookingId, startLocation: testData.locations.pickup });
            console.log('✅ Viagem iniciada');

            // 3. Alterar Destino (Mais próximo ou mesmo preço)
            const newDest = { lat: -23.5510, lng: -46.6338, address: 'Destino Próximo' };

            console.log('📡 Alterando destino diretamente...');
            const result = await client.changeDestination({
                bookingId,
                newDestination: newDest
            });

            expect(result.success).toBe(true);
            expect(result.bookingId).toBe(bookingId);
            expect(result.requiresPayment).toBe(false);
            expect(result.newDestination.address).toBe('Destino Próximo');
            console.log('✅ Destino alterado sem necessidade de Pix extra');

        } catch (error) {
            console.error('❌ Erro no teste Scenario 2:', error.message);
            throw error;
        } finally {
            client.disconnect();
            dClient.disconnect();
        }
    }, 60000);
});
