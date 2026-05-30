#!/usr/bin/env node

/**
 * Mede latência entre createBooking e newRideRequest no mesmo fluxo.
 *
 * Uso:
 *   node scripts/tests/measure-new-ride-request-latency.js
 *
 * Variáveis úteis:
 *   WS_URL=https://socket.leaf.app.br
 *   API_BASE_URL=https://api.leaf.app.br
 *   TEST_PASSENGER_UID=iDiAKrLjeDWbIOYFEqkHLS3JBGN2
 *   TEST_DRIVER_UID=5zgeX92yleYa2wH8JnMvqOU76fX2
 */

const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');

const WS_URL = process.env.WS_URL || 'https://socket.leaf.app.br';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.leaf.app.br';
const PASSENGER_UID = process.env.TEST_PASSENGER_UID || 'iDiAKrLjeDWbIOYFEqkHLS3JBGN2';
const DRIVER_UID = process.env.TEST_DRIVER_UID || '5zgeX92yleYa2wH8JnMvqOU76fX2';

const PICKUP = {
    lat: Number(process.env.TEST_PICKUP_LAT || -22.9075),
    lng: Number(process.env.TEST_PICKUP_LNG || -43.1736),
    address: process.env.TEST_PICKUP_ADDRESS || 'Centro - Rio de Janeiro'
};

const DESTINATION = {
    lat: Number(process.env.TEST_DEST_LAT || -22.9121),
    lng: Number(process.env.TEST_DEST_LNG || -43.1825),
    address: process.env.TEST_DEST_ADDRESS || 'Lapa - Rio de Janeiro'
};

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJson(url, body, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });
        const data = await response.json().catch(() => ({}));
        return { ok: response.ok, status: response.status, data };
    } finally {
        clearTimeout(timer);
    }
}

async function run() {
    const passenger = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });
    const driver = new WebSocketTestClient(WS_URL, { transports: ['websocket'], timeout: 30000, reconnection: false });

    let bookingId = null;

    try {
        await passenger.connect();
        await driver.connect();

        await passenger.authenticate(PASSENGER_UID, 'customer');
        await driver.authenticate(DRIVER_UID, 'driver');

        // Sinaliza disponibilidade do motorista.
        driver.socket.emit('updateLocation', {
            lat: PICKUP.lat + 0.0002,
            lng: PICKUP.lng + 0.0002,
            tripStatus: 'idle',
            isInTrip: false,
            seq: Date.now() % 100000
        });

        const driverStatusError = await driver.waitForEvent('driverStatusError', 1500).catch(() => null);
        if (driverStatusError) {
            console.warn(`driver_status_warning: ${JSON.stringify(driverStatusError)}`);
        }

        await sleep(1200);

        const startedAt = Date.now();
        const rideId = `ride_${Date.now()}`;
        const paymentAdvance = await postJson(`${API_BASE_URL}/api/payment/advance`, {
            passengerId: PASSENGER_UID,
            amount: 2750,
            rideId,
            rideDetails: {
                origin: PICKUP.address,
                destination: DESTINATION.address
            },
            passengerName: 'Leaf Passageiro Teste',
            passengerEmail: 'qa@leaf.local'
        }, 20000);
        const chargeId = String(paymentAdvance?.data?.chargeId || '').trim();
        if (!paymentAdvance.ok || !chargeId) {
            throw new Error(paymentAdvance?.data?.message || 'payment_advance_failed');
        }

        const booking = await passenger.createBooking({
            customerId: PASSENGER_UID,
            pickupLocation: PICKUP,
            destinationLocation: DESTINATION,
            estimatedFare: 27.5,
            paymentMethod: 'pix',
            paymentStatus: 'confirmed',
            paymentData: {
                chargeId,
                rideId,
                amountInCents: 2750
            },
            idempotencyKey: `latency_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        });

        bookingId = booking?.bookingId;
        if (!bookingId) {
            throw new Error(`bookingId ausente na resposta: ${JSON.stringify(booking)}`);
        }

        const request = await driver.waitForEvent(
            'newRideRequest',
            30000,
            (payload) => (payload?.bookingId || payload?.rideId) === bookingId
        );

        const elapsedMs = Date.now() - startedAt;

        console.log(JSON.stringify({
            success: true,
            wsUrl: WS_URL,
            bookingId,
            elapsedMs,
            eventBookingId: request?.bookingId || request?.rideId || null
        }, null, 2));

        try {
            await passenger.cancelRide(bookingId, 'cleanup_after_latency_measure');
        } catch (cleanupError) {
            console.warn(`cleanup_warning: ${cleanupError.message}`);
        }
    } catch (error) {
        console.error(JSON.stringify({
            success: false,
            wsUrl: WS_URL,
            bookingId,
            error: error.message
        }, null, 2));
        process.exitCode = 1;
    } finally {
        driver.disconnect();
        passenger.disconnect();
    }
}

run();
