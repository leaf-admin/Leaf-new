/**
 * ADVANCED MOBILITY STRESS TEST - LEAF BACKEND (V9)
 */

const WebSocketTestClient = require('../__helpers__/websocket-test-client');
const RedisDriverSimulator = require('../__helpers__/redis-driver-simulator');
const testData = require('../__fixtures__/test-data');
const redisPool = require('../../../../utils/redis-pool');

const WS_URL = process.env.WS_URL || 'http://localhost:3001';

describe('Advanced Mobility Stress Tests', () => {
    let drivers = [];
    let redis;
    const driverSim = new RedisDriverSimulator();

    beforeAll(async () => {
        redis = redisPool.getConnection();
        await redisPool.ensureConnection();
        const keys = await redis.keys('booking_search:*');
        if (keys.length > 0) await redis.del(...keys);
    });

    afterEach(async () => {
        for (const driverId of drivers) {
            await driverSim.removeDriver(driverId);
        }
        drivers = [];
    });

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

                // Garantir o cancelamento COMPLETO (await resposta do servidor) para não vazar para outros testes
                await new Promise(r => setTimeout(r, 1000));
                await client.cancelRide(booking.bookingId, 'Stress End');
            } finally {
                client.disconnect();
            }
        };

        await Promise.all(Array.from({ length: 20 }, (_, i) => runRequest(i)));
        console.log('✅ Scenario A done and cleaned.');
    }, 60000);

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
                await client.cancelRide(booking.bookingId, 'Test B');
                // Aumentado para 4s para garantir que o worker processou
                await new Promise(r => setTimeout(r, 4000));
            } finally {
                client.disconnect();
            }
        }

        // Delay final antes de checar vazamentos
        await new Promise(r => setTimeout(r, 5000));

        let leaked = 0;
        for (const bid of testBookingIds) {
            if (await redis.exists(`booking_search:${bid}`)) leaked++;
        }
        console.log(`🔍 Leaked keys: ${leaked}`);
        expect(leaked).toBe(0);
    }, 60000);

    test('Scenario C: Radius Exhaustion (Fast Track)', async () => {
        console.log('\n🚀 Scenario C: Exhaustion (120s timeout)...');
        const cid = `pc_stress_${Date.now()}`;
        const client = new WebSocketTestClient(WS_URL);
        try {
            await client.connect();
            await client.authenticate(cid, 'customer');

            // Aumentado timeout para 110s
            const expansionPromise = client.waitForEvent('rideSearchExpanded', 110000);

            const remotePickup = { lat: -23.75, lng: -46.35, address: 'Remote' };
            const booking = await client.createBooking(testData.booking.createBookingData(remotePickup, null, cid));

            console.log(`🔍 Waiting for exhaust event for ${booking.bookingId}...`);
            const event = await expansionPromise;
            expect(event.bookingId).toBe(booking.bookingId);
        } finally {
            client.disconnect();
        }
    }, 120000);

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
            await client.confirmPayment(testData.payment.createPaymentData(booking.bookingId));

            await dClient.waitForEvent('newRideRequest', 10000);
            dClient.disconnect();

            console.log('⏳ Waiting for lock to expire (22s)...');
            await new Promise(r => setTimeout(r, 22000));

            const state = await redis.hget(`booking:${booking.bookingId}`, 'state');
            expect(['SEARCHING', 'EXPANDED']).toContain(state);
        } finally {
            client.disconnect();
            dClient.disconnect();
        }
    }, 60000);
});
