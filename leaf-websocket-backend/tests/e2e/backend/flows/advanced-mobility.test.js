/**
 * ADVANCED MOBILITY STRESS TEST - LEAF BACKEND (V9)
 */

const WebSocketTestClient = require('../__helpers__/websocket-test-client');
const RedisDriverSimulator = require('../__helpers__/redis-driver-simulator');
const testData = require('../__fixtures__/test-data');

const WS_URL = process.env.WS_URL || 'http://localhost:3001';

describe('Advanced Mobility Stress Tests', () => {
    let drivers = [];
    let createdBookingIds = [];
    const driverSim = new RedisDriverSimulator();
    const isRemoteEnvironment =
        driverSim.useRemoteRedis ||
        WS_URL.includes('sslip.io') ||
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
        const keys = await driverSim.keys('booking_search:*');
        if (keys.length > 0) await driverSim.del(...keys);
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
        const HOTSPOT = { lat: -23.5505, lng: -46.6333, address: 'Hotspot' };

        const runRequest = async (i) => {
            const client = new WebSocketTestClient(WS_URL);
            try {
                await client.connect();
                const cid = `pa_${i}_${Date.now()}`;
                await client.authenticate(cid, 'customer');
                const booking = await client.createBooking(testData.booking.createBookingData(HOTSPOT, null, cid));
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

        await Promise.all(Array.from({ length: 20 }, (_, i) => runRequest(i)));
        console.log('✅ Scenario A done and cleaned.');
    }, 120000);

    test('Scenario B: Churn Cleanup (Resilience)', async () => {
        console.log('\n🚀 Scenario B: Churn/Cleanup (5 Cycles)...');
        const testBookingIds = [];

        for (let i = 1; i <= 5; i++) {
            const cid = `pb_${i}_${Date.now()}`;
            const client = new WebSocketTestClient(WS_URL);
            try {
                await client.connect();
                await client.authenticate(cid, 'customer');
                const booking = await client.createBooking(testData.booking.createBookingData(null, null, cid));
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

            const remotePickup = { lat: -23.75, lng: -46.35, address: 'Remote' };
            const booking = await client.createBooking(testData.booking.createBookingData(remotePickup, null, cid));
            createdBookingIds.push(booking.bookingId);

            console.log(`🔍 Waiting for exhaust event for ${booking.bookingId}...`);
            const isTargetBooking = (payload) => payload?.bookingId === booking.bookingId;
            const event = await client.waitForEvent(
                'rideSearchExpanded',
                timings.radiusEventTimeoutMs,
                isTargetBooking
            );

            expect(event.bookingId).toBe(booking.bookingId);
        } finally {
            client.disconnect();
        }
    }, timings.radiusScenarioTimeoutMs);

    test('Scenario D: Lock Expiry Resumption', async () => {
        console.log('\n🚀 Scenario D: Resumption...');
        const did = `dd_${Date.now()}`;
        const cid = `pd_${Date.now()}`;
        await driverSim.setDriverOnline(did, -23.5505, -46.6333);
        drivers.push(did);

        const client = new WebSocketTestClient(WS_URL);
        const dClient = new WebSocketTestClient(WS_URL);

        try {
            await client.connect();
            await client.authenticate(cid, 'customer');
            await dClient.connect();
            await dClient.authenticate(did, 'driver');

            const booking = await client.createBooking(testData.booking.createBookingData(null, null, cid));
            createdBookingIds.push(booking.bookingId);
            await client.confirmPayment(testData.payment.createPaymentData(booking.bookingId));

            await dClient.waitForEvent('newRideRequest', 10000);
            dClient.disconnect();

            console.log('⏳ Waiting for lock to expire (22s)...');
            await new Promise(r => setTimeout(r, 22000));

            const state = await driverSim.hget(`booking:${booking.bookingId}`, 'state');
            expect(['SEARCHING', 'EXPANDED']).toContain(state);
        } finally {
            client.disconnect();
            dClient.disconnect();
        }
    }, 60000);
});
