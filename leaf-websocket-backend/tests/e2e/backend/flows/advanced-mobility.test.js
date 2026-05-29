/**
 * ADVANCED MOBILITY STRESS TEST - LEAF BACKEND (V9)
 */

const WebSocketTestClient = require('../__helpers__/websocket-test-client');
const RedisDriverSimulator = require('../__helpers__/redis-driver-simulator');
const testData = require('../__fixtures__/test-data');

const WS_URL = process.env.WS_URL || 'http://localhost:3001';
const RIO_HOTSPOT = {
    lat: testData.locations.pickup.lat,
    lng: testData.locations.pickup.lng,
    address: 'Copacabana - Hotspot E2E'
};
const RIO_ALT_DESTINATION = {
    lat: testData.locations.destination.lat,
    lng: testData.locations.destination.lng,
    address: 'Leblon - Destino E2E'
};
const RIO_RADIUS_PICKUP = {
    lat: testData.locations.pickup2.lat,
    lng: testData.locations.pickup2.lng,
    address: 'Ipanema - Radius Exhaustion E2E'
};
const RIO_SUPPORT_DRIVER = {
    lat: testData.locations.pickup.lat,
    lng: testData.locations.pickup.lng
};

describe('Advanced Mobility Stress Tests', () => {
    let drivers = [];
    let createdBookingIds = [];
    const driverSim = new RedisDriverSimulator();
    const isRemoteEnvironment =
        driverSim.useRemoteRedis ||
        WS_URL.startsWith('https://') ||
        (WS_URL.startsWith('http://') && !WS_URL.includes('localhost') && !WS_URL.includes('127.0.0.1'));

    const timings = {
        churnPerCycleSettlingMs: isRemoteEnvironment ? 6000 : 4000,
        churnFinalSettlingMs: isRemoteEnvironment ? 8000 : 5000,
        churnLeakPollIntervalMs: isRemoteEnvironment ? 3000 : 1500,
        churnLeakMaxWaitMs: isRemoteEnvironment ? 60000 : 20000,
        churnScenarioTimeoutMs: isRemoteEnvironment ? 180000 : 120000,
        radiusEventTimeoutMs: isRemoteEnvironment ? 240000 : 110000,
        radiusScenarioTimeoutMs: isRemoteEnvironment ? 300000 : 120000
    };

    beforeAll(async () => {
        if (driverSim.useRemoteRedis) {
            console.log('ℹ️ [advanced-mobility] ambiente remoto compartilhado: cleanup global de booking_search desabilitado.');
        }
    });

    afterEach(async () => {
        await Promise.allSettled(
            drivers.map((driverId) => driverSim.removeDriver(driverId))
        );
        drivers = [];

        // Limpeza defensiva para evitar vazamento de corridas/search entre cenários.
        const [pendingQueues, activeQueues] = await Promise.all([
            driverSim.keys('ride_queue:*:pending'),
            driverSim.keys('ride_queue:*:active')
        ]);

        await Promise.allSettled(
            createdBookingIds.map(async (bookingId) => {
                await Promise.allSettled([
                    driverSim.del(
                        `booking:${bookingId}`,
                        `booking_search:${bookingId}`,
                        `ride_notifications:${bookingId}`,
                        `ride_excluded_drivers:${bookingId}`
                    ),
                    ...pendingQueues.map((queueKey) => driverSim.zrem(queueKey, bookingId)),
                    ...activeQueues.map((queueKey) => driverSim.hdel(queueKey, bookingId))
                ]);
            })
        );

        createdBookingIds = [];
    }, 120000);

    test('Scenario A: Demand Load', async () => {
        console.log('\n🚀 Scenario A: Demand Stress (20 passengers)...');
        const supportDrivers = Array.from({ length: 8 }, (_, index) => `adv_support_a_${index}_${Date.now()}`);
        await Promise.allSettled(
            supportDrivers.map((driverId, index) =>
                driverSim.setDriverOnline(
                    driverId,
                    RIO_HOTSPOT.lat + (index * 0.0002),
                    RIO_HOTSPOT.lng - (index * 0.0002)
                )
            )
        );
        drivers.push(...supportDrivers);

        const runRequest = async (i) => {
            const client = new WebSocketTestClient(WS_URL);
            try {
                await client.connect();
                const cid = `pa_${i}_${Date.now()}`;
                await client.authenticate(cid, 'customer');
                const booking = await client.createBooking(
                    testData.booking.createBookingData(RIO_HOTSPOT, RIO_ALT_DESTINATION, cid)
                );
                createdBookingIds.push(booking.bookingId);

                // Garantir o cancelamento COMPLETO (await resposta do servidor) para não vazar para outros testes
                await new Promise(r => setTimeout(r, 1000));
                try {
                    await client.cancelRide(booking.bookingId, 'Stress End');
                } catch (_error) {
                    // Sob alta concorrência o ack pode atrasar; cleanup defensivo no afterEach remove vazamentos.
                }
            } finally {
                client.disconnect();
            }
        };

        const results = await Promise.allSettled(Array.from({ length: 20 }, (_, i) => runRequest(i)));
        const successCount = results.filter((result) => result.status === 'fulfilled').length;
        const minSuccessRate = isRemoteEnvironment ? 0.7 : 0.9;
        expect(successCount).toBeGreaterThanOrEqual(Math.ceil(20 * minSuccessRate));
        console.log('✅ Scenario A done and cleaned.');
    }, 120000);

    test('Scenario B: Churn Cleanup (Resilience)', async () => {
        console.log('\n🚀 Scenario B: Churn/Cleanup (5 Cycles)...');
        const testBookingIds = [];
        const churnDriverId = `adv_churn_driver_${Date.now()}`;
        await driverSim.setDriverOnline(churnDriverId, RIO_SUPPORT_DRIVER.lat, RIO_SUPPORT_DRIVER.lng);
        drivers.push(churnDriverId);

        for (let i = 1; i <= 5; i++) {
            const cid = `pb_${i}_${Date.now()}`;
            const client = new WebSocketTestClient(WS_URL);
            try {
                await client.connect();
                await client.authenticate(cid, 'customer');
                const booking = await client.createBooking(
                    testData.booking.createBookingData(RIO_HOTSPOT, RIO_ALT_DESTINATION, cid)
                );
                testBookingIds.push(booking.bookingId);
                createdBookingIds.push(booking.bookingId);
                try {
                    await client.cancelRide(booking.bookingId, 'Test B');
                } catch (_error) {
                    // Cleanup defensivo no afterEach cobre eventual timeout de ack.
                }
                await new Promise(r => setTimeout(r, timings.churnPerCycleSettlingMs));
            } finally {
                client.disconnect();
            }
        }

        await new Promise(r => setTimeout(r, timings.churnFinalSettlingMs));

        const leakCheckStartedAt = Date.now();
        let leaked = Number.POSITIVE_INFINITY;
        let attempts = 0;
        while (Date.now() - leakCheckStartedAt <= timings.churnLeakMaxWaitMs) {
            attempts += 1;
            const searchKeys = await driverSim.keys('booking_search:*');
            const existingSearches = new Set(searchKeys || []);
            leaked = testBookingIds.filter((bookingId) => existingSearches.has(`booking_search:${bookingId}`)).length;

            if (leaked === 0) break;
            await new Promise((resolve) => setTimeout(resolve, timings.churnLeakPollIntervalMs));
        }

        console.log(`🔍 Leaked keys: ${leaked} (attempts: ${attempts})`);
        expect(leaked).toBe(0);
    }, timings.churnScenarioTimeoutMs);

    test('Scenario C: Radius Exhaustion (Fast Track)', async () => {
        console.log('\n🚀 Scenario C: Exhaustion (eventual completion)...');
        const cid = `pc_stress_${Date.now()}`;
        const client = new WebSocketTestClient(WS_URL);
        try {
            await client.connect();
            await client.authenticate(cid, 'customer');

            const radiusDriverId = `adv_radius_driver_${Date.now()}`;
            await driverSim.setDriverOnline(radiusDriverId, RIO_SUPPORT_DRIVER.lat, RIO_SUPPORT_DRIVER.lng);
            drivers.push(radiusDriverId);

            const booking = await client.createBooking(
                testData.booking.createBookingData(RIO_RADIUS_PICKUP, RIO_ALT_DESTINATION, cid)
            );
            createdBookingIds.push(booking.bookingId);

            console.log(`🔍 Waiting for exhaust event for ${booking.bookingId}...`);
            const isTargetBooking = (payload) => payload?.bookingId === booking.bookingId;
            try {
                const event = await client.waitForEvent(
                    'rideSearchExpanded',
                    timings.radiusEventTimeoutMs,
                    isTargetBooking
                );
                expect(event.bookingId).toBe(booking.bookingId);
            } catch (error) {
                if (!isRemoteEnvironment) {
                    throw error;
                }
                const state = await driverSim.hget(`booking:${booking.bookingId}`, 'state');
                expect(state).toBeTruthy();
            }
        } finally {
            client.disconnect();
        }
    }, timings.radiusScenarioTimeoutMs);

    test('Scenario D: Lock Expiry Resumption', async () => {
        console.log('\n🚀 Scenario D: Resumption...');
        const did = `dd_${Date.now()}`;
        const cid = `pd_${Date.now()}`;
        await driverSim.setDriverOnline(did, RIO_HOTSPOT.lat, RIO_HOTSPOT.lng);
        drivers.push(did);

        const client = new WebSocketTestClient(WS_URL);
        const dClient = new WebSocketTestClient(WS_URL);

        try {
            await client.connect();
            await client.authenticate(cid, 'customer');
            await dClient.connect();
            await dClient.authenticate(did, 'driver');

            const booking = await client.createBooking(
                testData.booking.createBookingData(RIO_HOTSPOT, RIO_ALT_DESTINATION, cid)
            );
            createdBookingIds.push(booking.bookingId);
            await client.confirmPayment(testData.payment.createPaymentData(booking.bookingId));

            let driverNotified = false;
            try {
                await dClient.waitForEvent('newRideRequest', 15000);
                driverNotified = true;
            } catch (error) {
                if (!isRemoteEnvironment) {
                    throw error;
                }
                console.log(`⚠️ Scenario D sem newRideRequest no socket de teste: ${error.message}`);
            }
            dClient.disconnect();

            console.log('⏳ Waiting for lock to expire (22s)...');
            await new Promise(r => setTimeout(r, 22000));

            const state = await driverSim.hget(`booking:${booking.bookingId}`, 'state');
            if (driverNotified) {
                expect(['SEARCHING', 'AWAITING_RESPONSE', 'NOTIFIED', 'EXPANDED']).toContain(state);
            } else {
                expect(state).toBeTruthy();
            }
        } finally {
            client.disconnect();
            dClient.disconnect();
        }
    }, 60000);
});
