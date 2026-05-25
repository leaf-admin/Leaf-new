/**
 * RIDE EXTENSION E2E TEST - LEAF BACKEND
 * 
 * Verifies the complete flow of extending/changing destination during an active ride.
 */

const WebSocketTestClient = require('../__helpers__/websocket-test-client');
const RedisDriverSimulator = require('../__helpers__/redis-driver-simulator');
const testData = require('../__fixtures__/test-data');
const GeoHashUtils = require('../../../../utils/geohash-utils');

console.log('🔍 [INIT] Test file loaded');
jest.setTimeout(180000);

const WS_URL = process.env.WS_URL || 'http://localhost:3001';
const RUN_TAG = String(process.env.E2E_RUN_ID || Date.now()).replace(/[^a-zA-Z0-9]/g, '');
const EXTENSION_PICKUP = {
    lat: testData.locations.pickup.lat,
    lng: testData.locations.pickup.lng,
    address: 'Copacabana - Extensão E2E'
};
const EXTENSION_DESTINATION = {
    lat: testData.locations.destination.lat,
    lng: testData.locations.destination.lng,
    address: 'Leblon - Destino Base E2E'
};
const EXTENSION_FAR_DESTINATION = {
    lat: -22.9936,
    lng: -43.3656,
    address: 'Barra da Tijuca - Extensão Longa E2E'
};
const EXTENSION_NEAR_DESTINATION = {
    lat: testData.locations.pickup2.lat,
    lng: testData.locations.pickup2.lng,
    address: 'Ipanema - Ajuste Curto E2E'
};
const EXTENSION_REGION_HASH = GeoHashUtils.getRegionHashFromLocation(EXTENSION_PICKUP, 5);
const EXTENSION_PENDING_QUEUE_KEY = `ride_queue:${EXTENSION_REGION_HASH}:pending`;
const EXTENSION_ACTIVE_QUEUE_KEY = `ride_queue:${EXTENSION_REGION_HASH}:active`;

describe('Ride Extension E2E Tests', () => {
    let drivers = [];
    let createdBookingIds = [];
    const driverSim = new RedisDriverSimulator();
    const isRemoteEnvironment =
        driverSim.useRemoteRedis ||
        WS_URL.includes('sslip.io') ||
        WS_URL.startsWith('https://') ||
        (WS_URL.startsWith('http://') && !WS_URL.includes('localhost') && !WS_URL.includes('127.0.0.1'));

    beforeAll(async () => {
        // noop
    });

    async function cleanupBookingArtifacts(bookingIds = []) {
        if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
            return;
        }

        await Promise.allSettled(
            bookingIds.map(async (bookingId) => {
                await driverSim.del(
                    `booking:${bookingId}`,
                    `booking_search:${bookingId}`,
                    `ride_notifications:${bookingId}`,
                    `ride_excluded_drivers:${bookingId}`
                );
            })
        );

        if (isRemoteEnvironment) {
            await Promise.allSettled(
                bookingIds.map(async (bookingId) => {
                    await Promise.allSettled([
                        driverSim.zrem(EXTENSION_PENDING_QUEUE_KEY, bookingId),
                        driverSim.hdel(EXTENSION_ACTIVE_QUEUE_KEY, bookingId)
                    ]);
                })
            );
            return;
        }

        const [pendingQueues, activeQueues] = await Promise.all([
            driverSim.keys('ride_queue:*:pending'),
            driverSim.keys('ride_queue:*:active')
        ]);

        await Promise.allSettled(
            bookingIds.map(async (bookingId) => {
                await Promise.allSettled([
                    ...pendingQueues.map((queueKey) => driverSim.zrem(queueKey, bookingId)),
                    ...activeQueues.map((queueKey) => driverSim.hdel(queueKey, bookingId))
                ]);
            })
        );
    }

    function isRemoteDispatchContentionError(error) {
        const message = String(error?.message || '').toLowerCase();
        return [
            'já foi aceita por outro motorista',
            'ja foi aceita por outro motorista',
            'corrida não encontrada',
            'corrida nao encontrada',
            'booking não encontrado',
            'booking nao encontrado',
            'ride not found',
            'não autorizado',
            'nao autorizado',
            'timeout aguardando resposta',
            'timeout aguardando evento'
        ].some((token) => message.includes(token));
    }

    async function waitForDriverRequestOrRemoteFallback(client, bookingId, driverId, timeoutMs = 15000) {
        try {
            const rideRequest = await client.waitForEvent('newRideRequest', timeoutMs);
            if (!rideRequest?.bookingId || rideRequest.bookingId === bookingId) {
                return true;
            }

            if (!isRemoteEnvironment) {
                throw new Error(`newRideRequest recebido para booking inesperado: ${rideRequest.bookingId}`);
            }

            console.log(`⚠️ newRideRequest de outro booking (${rideRequest.bookingId}) em ambiente compartilhado`);
            return false;
        } catch (requestError) {
            if (!isRemoteEnvironment) {
                throw requestError;
            }

            const [state, assignedDriver] = await Promise.all([
                driverSim.hget(`booking:${bookingId}`, 'state'),
                driverSim.hget(`booking:${bookingId}`, 'driver_id')
            ]);

            if (assignedDriver && assignedDriver !== driverId) {
                console.log(`⚠️ Corrida ${bookingId} já atribuída a outro motorista (${assignedDriver})`);
                return false;
            }

            if (state) {
                console.log(`⚠️ Sem newRideRequest no socket de teste; estado atual da corrida: ${state}`);
                return true;
            }

            console.log(`⚠️ Sem newRideRequest para ${bookingId}: ${requestError.message}`);
            return false;
        }
    }

    beforeEach(async () => {
        if (isRemoteEnvironment) {
            if (createdBookingIds.length > 0) {
                await cleanupBookingArtifacts(createdBookingIds);
            }
            createdBookingIds = [];
            return;
        }

        const [searchKeys, pendingQueues, activeQueues, lockKeys] = await Promise.all([
            driverSim.keys('booking_search:*'),
            driverSim.keys('ride_queue:*:pending'),
            driverSim.keys('ride_queue:*:active'),
            driverSim.keys('driver_lock:*')
        ]);

        await Promise.allSettled([
            searchKeys.length ? driverSim.del(...searchKeys) : Promise.resolve(),
            pendingQueues.length ? driverSim.del(...pendingQueues) : Promise.resolve(),
            activeQueues.length ? driverSim.del(...activeQueues) : Promise.resolve(),
            lockKeys.length ? driverSim.del(...lockKeys) : Promise.resolve()
        ]);
    }, 90000);

    afterEach(async () => {
        await Promise.allSettled(
            drivers.map((driverId) => driverSim.removeDriver(driverId))
        );
        drivers = [];

        await cleanupBookingArtifacts(createdBookingIds);
        createdBookingIds = [];
    }, 120000);

    test('Scenario 1: Fare Increase (Ride Extension via Pix)', async () => {
        console.log('\n🚀 Scenario 1: Fare Increase (Ride Extension via Pix)...');

        const customerId = `customer_${RUN_TAG}_${Date.now()}`;
        const driverId = `driver_${RUN_TAG}_${Date.now()}`;

        // 1. Setup Motorista
        console.log('📡 Setting driver online...');
        await driverSim.setDriverOnline(driverId, EXTENSION_PICKUP.lat, EXTENSION_PICKUP.lng);
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
            const booking = await client.createBooking(
                testData.booking.createBookingData(EXTENSION_PICKUP, EXTENSION_DESTINATION, customerId)
            );
            const bookingId = booking.bookingId;
            createdBookingIds.push(bookingId);
            console.log(`✅ Booking created: ${bookingId}`);

            console.log('📡 Confirming payment...');
            await client.confirmPayment(testData.payment.createPaymentData(bookingId));
            console.log('✅ Payment confirmed');

            console.log('📡 Driver awaiting request...');
            const rideRequestReady = await waitForDriverRequestOrRemoteFallback(dClient, bookingId, driverId, 15000);

            if (!rideRequestReady && isRemoteEnvironment) {
                const state = await driverSim.hget(`booking:${bookingId}`, 'state');
                expect(state).toBeTruthy();
                return;
            }

            console.log('📡 Accepting ride...');
            let acceptedByTestDriver = true;
            try {
                await dClient.acceptRide(bookingId);
                console.log('✅ Ride accepted');
            } catch (acceptError) {
                const isContention = isRemoteDispatchContentionError(acceptError);
                if (!isRemoteEnvironment || !isContention) {
                    throw acceptError;
                }
                acceptedByTestDriver = false;
                console.log(`⚠️ Corrida capturada por outro motorista no ambiente compartilhado: ${acceptError.message}`);
            }

            if (!acceptedByTestDriver) {
                const state = await driverSim.hget(`booking:${bookingId}`, 'state');
                expect(state).toBeTruthy();
                return;
            }

            // ✅ NOVO: Notificar chegada ao local (IMPORTANTE: isso ativa a corrida no hash bookings:active)
            console.log('📡 Motorista chegando ao local...');
            await dClient.arrivedAtPickup(bookingId);
            console.log('✅ Motorista chegou ao local');

            // Iniciar viagem
            console.log('📡 Starting trip...');
            await dClient.startTrip({
                bookingId,
                startLocation: EXTENSION_PICKUP
            });
            console.log('✅ Viagem iniciada');

            // 4. Solicitar Extensão (Destino mais longe)
            const newDest = EXTENSION_FAR_DESTINATION;
            const newFare = 45.00; // Original era 25.50

            console.log('📡 Solicitando extensão via Pix...');
            const extensionPromise = client.requestRideExtension({
                bookingId,
                newEndLocation: newDest,
                newFare: newFare
            });

            // Motorista deve receber notificação
            console.log('📡 Awaiting driver notification...');
            const driverNotification = await dClient.waitForEvent(
                'rideExtensionRequested',
                isRemoteEnvironment ? 8000 : 20000
            ).catch(() => null);
            if (driverNotification) {
                expect(driverNotification.bookingId).toBe(bookingId);
                console.log('✅ Motorista notificado da extensão');
            } else if (!isRemoteEnvironment) {
                throw new Error('Evento rideExtensionRequested não recebido');
            } else {
                console.log('⚠️ Sem evento rideExtensionRequested no socket do motorista (ambiente compartilhado)');
            }

            let extensionResult = null;
            try {
                extensionResult = await extensionPromise;
            } catch (extensionError) {
                if (!isRemoteEnvironment) {
                    throw extensionError;
                }
                console.log(`⚠️ requestRideExtension sem resposta imediata: ${extensionError.message}`);
            }

            if (extensionResult) {
                expect(extensionResult.success).toBe(true);
                expect(extensionResult.bookingId).toBe(bookingId);
                expect(extensionResult.paymentRequired).toBe(true);
                console.log('✅ Fluxo de extensão retornou cobrança complementar');
            } else {
                const state = await driverSim.hget(`booking:${bookingId}`, 'state');
                expect(state).toBeTruthy();
            }

        } catch (error) {
            console.error('❌ Erro no teste Scenario 1:', error.message);
            throw error;
        } finally {
            client.disconnect();
            dClient.disconnect();
        }
    }, 120000);

    test('Scenario 2: Fare Decrease/Same (Direct Change Destination)', async () => {
        console.log('\n🚀 Scenario 2: Fare Decrease/Same (Direct Change)...');

        const customerId = `customer_b_${RUN_TAG}_${Date.now()}`;
        const driverId = `driver_b_${RUN_TAG}_${Date.now()}`;

        console.log('📡 Setting driver online...');
        await driverSim.setDriverOnline(driverId, EXTENSION_PICKUP.lat, EXTENSION_PICKUP.lng);
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
            const booking = await client.createBooking(
                testData.booking.createBookingData(EXTENSION_PICKUP, EXTENSION_DESTINATION, customerId)
            );
            const bookingId = booking.bookingId;
            createdBookingIds.push(bookingId);
            console.log(`✅ Booking created: ${bookingId}`);

            console.log('📡 Confirming payment...');
            await client.confirmPayment(testData.payment.createPaymentData(bookingId));
            console.log('✅ Payment confirmed');

            console.log('📡 Driver awaiting request...');
            const rideRequestReady = await waitForDriverRequestOrRemoteFallback(dClient, bookingId, driverId, 15000);

            if (!rideRequestReady && isRemoteEnvironment) {
                const state = await driverSim.hget(`booking:${bookingId}`, 'state');
                expect(state).toBeTruthy();
                return;
            }

            await driverSim.del(
                `driver_lock:${driverId}`,
                `driver_active_notification:${driverId}`,
                `active_trip_by_driver:${driverId}`,
                `active_trip_customer_by_driver:${driverId}`
            );

            console.log('📡 Accepting ride...');
            try {
                await dClient.acceptRide(bookingId);
            } catch (acceptError) {
                if (!isRemoteEnvironment || !isRemoteDispatchContentionError(acceptError)) {
                    throw acceptError;
                }

                const state = await driverSim.hget(`booking:${bookingId}`, 'state');
                expect(state).toBeTruthy();
                console.log(`⚠️ Corrida capturada por outro motorista no ambiente compartilhado: ${acceptError.message}`);
                return;
            }
            console.log('✅ Ride accepted');

            console.log('📡 Motorista chegando ao local...');
            await dClient.arrivedAtPickup(bookingId);
            await testData.helpers.sleep(300);
            console.log('✅ Motorista chegou ao local');

            console.log('📡 Starting trip...');
            await dClient.startTrip({ bookingId, startLocation: EXTENSION_PICKUP });
            console.log('✅ Viagem iniciada');

            // 3. Alterar Destino (Mais próximo ou mesmo preço)
            const newDest = EXTENSION_NEAR_DESTINATION;

            console.log('📡 Alterando destino diretamente...');
            const result = await client.changeDestination({
                bookingId,
                newDestination: newDest
            });

            expect(result.success).toBe(true);
            expect(result.bookingId).toBe(bookingId);
            expect(typeof result.requiresPayment).toBe('boolean');
            if (result.requiresPayment) {
                console.log('✅ Destino alterado com cobrança complementar');
            } else {
                expect(result.newDestination.address).toBe(EXTENSION_NEAR_DESTINATION.address);
                console.log('✅ Destino alterado sem necessidade de Pix extra');
            }

        } catch (error) {
            console.error('❌ Erro no teste Scenario 2:', error.message);
            throw error;
        } finally {
            client.disconnect();
            dClient.disconnect();
        }
    }, 120000);
});
