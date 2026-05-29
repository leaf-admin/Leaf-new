#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const WebSocketTestClient = require('../../tests/e2e/backend/__helpers__/websocket-test-client');

const WS_URL = process.env.WS_URL || 'https://socket.leaf.app.br';
const API_BASE_URL = process.env.API_BASE_URL || 'https://api.leaf.app.br';
const PASSENGER_UIDS = Object.freeze({
  passenger: String(process.env.TEST_PASSENGER_UID || '').trim(),
  passengerTwo: String(process.env.TEST_PASSENGER_TWO_UID || '').trim(),
  passengerThree: String(process.env.TEST_PASSENGER_THREE_UID || '').trim(),
  passengerFour: String(process.env.TEST_PASSENGER_FOUR_UID || '').trim(),
});
const PASSENGER_PROFILES = Object.freeze({
  passenger: {
    key: 'passenger',
    uid: PASSENGER_UIDS.passenger,
    name: 'Leaf Passageiro Teste',
    email: 'qa+passenger@leaf.local',
  },
  passengerTwo: {
    key: 'passengerTwo',
    uid: PASSENGER_UIDS.passengerTwo,
    name: 'Leaf Passageiro Teste 2',
    email: 'qa+passenger2@leaf.local',
  },
  passengerThree: {
    key: 'passengerThree',
    uid: PASSENGER_UIDS.passengerThree,
    name: 'Leaf Passageiro Teste 3',
    email: 'qa+passenger3@leaf.local',
  },
  passengerFour: {
    key: 'passengerFour',
    uid: PASSENGER_UIDS.passengerFour,
    name: 'Leaf Passageiro Teste 4',
    email: 'qa+passenger4@leaf.local',
  },
});

function readArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return '';
  }
  return String(process.argv[index + 1] || '').trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nowIso() {
  return new Date().toISOString();
}

function resolvePassengerProfile(ride, index) {
  const requestedKey = String(ride?.passengerKey || 'passenger').trim() || 'passenger';
  const explicitUid = String(ride?.passengerUid || '').trim();
  const explicitName = String(ride?.passengerName || '').trim();
  const explicitEmail = String(ride?.passengerEmail || '').trim();

  if (explicitUid) {
    return {
      key: requestedKey || `passenger-${index + 1}`,
      uid: explicitUid,
      name: explicitName || `Leaf Passageiro Custom ${index + 1}`,
      email: explicitEmail || `qa+custom${index + 1}@leaf.local`,
    };
  }

  const profile = PASSENGER_PROFILES[requestedKey];
  if (!profile || !profile.uid) {
    throw new Error(`missing_passenger_uid_${requestedKey}`);
  }
  return profile;
}

async function postJson(url, body, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
  } finally {
    clearTimeout(timer);
  }
}

function loadRides() {
  const ridesFile = readArg('--rides-file');
  const ridesJson = String(process.env.RIDES_JSON || '').trim();

  if (ridesFile) {
    return JSON.parse(fs.readFileSync(path.resolve(ridesFile), 'utf8'));
  }

  if (ridesJson) {
    return JSON.parse(ridesJson);
  }

  return [
    {
      label: 'ride-1',
      fare: 27.5,
      pickup: {
        lat: 37.7749,
        lng: -122.4194,
        address: 'SF Pickup 1',
      },
      destination: {
        lat: 37.7849,
        lng: -122.4094,
        address: 'SF Destination 1',
      },
    },
  ];
}

async function createBookingWithTimeout(passengerClient, payload, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('create_booking_timeout'));
    }, timeoutMs);

    const successHandler = (response) => {
      clearTimeout(timeout);
      passengerClient.socket.removeListener('bookingError', errorHandler);
      resolve(response);
    };

    const errorHandler = (error) => {
      clearTimeout(timeout);
      passengerClient.socket.removeListener('bookingCreated', successHandler);
      reject(new Error(error?.error || error?.message || 'create_booking_error'));
    };

    passengerClient.socket.once('bookingCreated', successHandler);
    passengerClient.socket.once('bookingError', errorHandler);
    passengerClient.socket.emit('createBooking', payload);
  });
}

async function confirmAdvancePaymentByWebhook({ rideId, chargeId, amountInCents, passengerId }) {
  const webhookPayload = {
    event: 'OPENPIX:CHARGE_COMPLETED',
    charge: {
      identifier: chargeId,
      correlationID: `ride_${rideId}_${Date.now()}_dual_driver`,
      value: amountInCents,
      status: 'COMPLETED',
      paidAt: nowIso(),
      additionalInfo: [
        { key: 'ride_id', value: rideId },
        { key: 'passenger_id', value: passengerId },
        { key: 'payment_type', value: 'advance_payment' },
      ],
    },
    pix: {
      status: 'COMPLETED',
    },
  };

  const webhookResponse = await postJson(`${API_BASE_URL}/api/woovi/webhook`, webhookPayload, 20000);
  if (!webhookResponse.ok) {
    throw new Error(`advance_payment_webhook_failed:${webhookResponse.status}`);
  }
  await sleep(400);
  return webhookResponse;
}

async function createRide(passengerClient, passengerProfile, ride, index) {
  const fare = Number(ride?.fare || 0);
  const amountInCents = Math.max(1, Math.round(fare * 100));
  const label = String(ride?.label || `ride-${index + 1}`).trim() || `ride-${index + 1}`;
  const rideId = `dual_driver_${Date.now()}_${index}_${passengerProfile.key}_${label}`;

  const pickup = {
    lat: Number(ride?.pickup?.lat),
    lng: Number(ride?.pickup?.lng),
    address: String(ride?.pickup?.address || `Pickup ${index + 1}`).trim(),
  };

  const destination = {
    lat: Number(ride?.destination?.lat),
    lng: Number(ride?.destination?.lng),
    address: String(ride?.destination?.address || `Destination ${index + 1}`).trim(),
  };

  if (!Number.isFinite(pickup.lat) || !Number.isFinite(pickup.lng)) {
    throw new Error(`invalid_pickup_${label}`);
  }
  if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) {
    throw new Error(`invalid_destination_${label}`);
  }
  if (!Number.isFinite(fare) || fare <= 0) {
    throw new Error(`invalid_fare_${label}`);
  }

  const paymentAdvance = await postJson(`${API_BASE_URL}/api/payment/advance`, {
    passengerId: passengerProfile.uid,
    amount: fare,
    rideId,
    rideDetails: {
      origin: pickup.address,
      destination: destination.address,
    },
    passengerName: passengerProfile.name,
    passengerEmail: passengerProfile.email,
  }, 20000);

  const chargeId = String(paymentAdvance?.data?.chargeId || '').trim();
  if (!paymentAdvance.ok || !chargeId) {
    throw new Error(paymentAdvance?.data?.message || `payment_advance_failed_${label}`);
  }

  await confirmAdvancePaymentByWebhook({
    rideId,
    chargeId,
    amountInCents,
    passengerId: passengerProfile.uid,
  });

  const booking = await createBookingWithTimeout(passengerClient, {
    customerId: passengerProfile.uid,
    pickupLocation: pickup,
    destinationLocation: destination,
    estimatedFare: fare,
    paymentMethod: 'pix',
    paymentStatus: 'confirmed',
    paymentData: {
      chargeId,
      rideId,
      amountInCents,
    },
    idempotencyKey: `dual_driver_${Date.now()}_${index}_${passengerProfile.key}_${label}`,
  });

  const bookingId = String(booking?.bookingId || '').trim();
  if (!bookingId) {
    throw new Error(`booking_id_missing_${label}`);
  }

  await passengerClient.confirmPayment({
    bookingId,
    paymentMethod: 'pix',
    paymentId: chargeId,
    chargeId,
    rideId,
    amount: fare,
  });

  return {
    label,
    passengerKey: passengerProfile.key,
    passengerUid: passengerProfile.uid,
    bookingId,
    estimatedFare: fare,
    pickup,
    destination,
    rideId,
    chargeId,
  };
}

async function main() {
  if (!PASSENGER_PROFILES.passenger.uid) {
    throw new Error('missing_TEST_PASSENGER_UID');
  }

  const rides = loadRides();
  if (!Array.isArray(rides) || rides.length === 0) {
    throw new Error('rides_required');
  }

  const delayBetweenMs = Math.max(0, Number(readArg('--delay-ms-between') || process.env.DELAY_MS_BETWEEN || 0) || 0);
  const passengerClients = new Map();

  async function getPassengerClient(passengerProfile) {
    const existing = passengerClients.get(passengerProfile.uid);
    if (existing) {
      return existing;
    }

    const passengerClient = new WebSocketTestClient(WS_URL);
    await passengerClient.connect();
    await passengerClient.authenticate(passengerProfile.uid, 'customer');
    passengerClients.set(passengerProfile.uid, passengerClient);
    return passengerClient;
  }

  try {
    const createdRides = [];
    for (let index = 0; index < rides.length; index += 1) {
      const passengerProfile = resolvePassengerProfile(rides[index], index);
      const passengerClient = await getPassengerClient(passengerProfile);
      const created = await createRide(passengerClient, passengerProfile, rides[index], index);
      createdRides.push(created);
      if (delayBetweenMs > 0 && index < rides.length - 1) {
        await sleep(delayBetweenMs);
      }
    }

    console.log(JSON.stringify({
      ok: true,
      passengerUid: PASSENGER_PROFILES.passenger.uid,
      passengers: Object.values(PASSENGER_PROFILES)
        .filter((profile) => profile.uid)
        .map((profile) => ({
          key: profile.key,
          uid: profile.uid,
        })),
      count: createdRides.length,
      rides: createdRides,
    }, null, 2));
  } finally {
    await Promise.all(Array.from(passengerClients.values()).map((client) => client.disconnect()));
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
    stack: error?.stack || null,
  }, null, 2));
  process.exit(1);
});
