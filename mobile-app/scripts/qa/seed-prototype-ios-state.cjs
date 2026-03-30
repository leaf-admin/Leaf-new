#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const APP_ID = 'br.com.leaf.ride';
const DEVICE_MAP = {
  '17pro': '9AB733E4-FCD7-456F-A02F-7AE7F1903566',
  '16e': '6B0D8017-35A1-4579-BF2B-2E357078DDE3'
};
const PASSENGER_UID = 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
const DRIVER_UID = '8vg2kxxqi3TYKlpD6eBlWgYseIq2';
const PREFIX = '@prototype_runtime_session_';
const QA_PREFIX = '@prototype_runtime_qa_seed_';

const BASE_COORDS = {
  pickup: { latitude: 37.779026, longitude: -122.419906 },
  interruption: { latitude: 37.772516, longitude: -122.414233 },
  destination: { latitude: 37.759703, longitude: -122.428093 },
  driverHome: { latitude: 37.785834, longitude: -122.406417 },
  passengerHome: { latitude: 37.77986, longitude: -122.41517 },
  inTransit: { latitude: 37.76888, longitude: -122.42171 }
};

const LABELS = {
  pickupAddress: '1280 Market Street, Civic Center, San Francisco, CA',
  interruptionAddress: 'Mission Street & 8th Street, San Francisco, CA',
  destinationAddress: 'Dolores Park, 19th & Dolores Street, Mission District, San Francisco, CA',
  newDestinationAddress: 'Oracle Park, 24 Willie Mays Plaza, San Francisco, CA'
};

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function md5(value) {
  return crypto.createHash('md5').update(String(value)).digest('hex');
}

function deepMerge(base, patch) {
  if (Array.isArray(patch)) {
    return patch.slice();
  }
  if (!patch || typeof patch !== 'object') {
    return patch;
  }

  const seed = base && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (Array.isArray(value)) {
      seed[key] = value.slice();
    } else if (value && typeof value === 'object') {
      seed[key] = deepMerge(seed[key], value);
    } else {
      seed[key] = value;
    }
  }
  return seed;
}

function run(command, args) {
  return execFileSync(command, args, { encoding: 'utf8' }).trim();
}

function runBestEffort(command, args) {
  try {
    return run(command, args);
  } catch (error) {
    const stderr = String(error?.stderr || '');
    if (stderr.includes('found nothing to terminate')) {
      return '';
    }
    throw error;
  }
}

function acceptOpenPromptIfNeeded(deviceId) {
  try {
    const flowPath = path.resolve(__dirname, '..', '..', '.maestro', 'flows', 'qa', '_accept-open-prompt.yaml');
    execFileSync('maestro', ['test', flowPath, '--device', deviceId], {
      cwd: path.resolve(__dirname, '..', '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (_error) {
    // best effort only
  }
}

function getContainerData(deviceId) {
  return run('xcrun', ['simctl', 'get_app_container', deviceId, APP_ID, 'data']);
}

function getRuntimeFilePath(dataContainer, uid) {
  return getStorageFilePath(dataContainer, `${PREFIX}${uid}`);
}

function getQaSeedFilePath(dataContainer, uid) {
  return getStorageFilePath(dataContainer, `${QA_PREFIX}${uid}`);
}

function getStorageFilePath(dataContainer, key) {
  return path.join(
    dataContainer,
    'Library',
    'Application Support',
    APP_ID,
    'RCTAsyncLocalStorage_V1',
    md5(String(key))
  );
}

function loadRuntimeSnapshot(runtimeFilePath) {
  if (!fs.existsSync(runtimeFilePath)) {
    return {};
  }
  return JSON.parse(fs.readFileSync(runtimeFilePath, 'utf8'));
}

function saveRuntimeSnapshot(runtimeFilePath, snapshot) {
  fs.mkdirSync(path.dirname(runtimeFilePath), { recursive: true });
  fs.writeFileSync(runtimeFilePath, `${JSON.stringify(snapshot)}\n`);
}

function buildDriverReceipt() {
  return {
    id: 'trip-driver-proof-1',
    date: '28/03 23:12',
    route: '1280 Market Street -> Dolores Park',
    value: 'R$ 12,50',
    fare: 12.5,
    grossAmount: 12.5,
    distanceKm: 2.4,
    durationMin: 11,
    paymentMethod: 'pix',
    driverId: DRIVER_UID,
    driverName: 'Leaf Motorista Teste',
    passengerId: PASSENGER_UID,
    passengerName: 'Leaf Passageiro Teste',
    baseFare: 7.4,
    variableFare: 5.1,
    operationalFee: 1.15,
    paymentIntermediationFee: 0.55,
    totalFees: 1.7,
    driverNetAmount: 10.8,
    pickup: LABELS.pickupAddress,
    drop: LABELS.destinationAddress,
    pickupCoordinate: BASE_COORDS.pickup,
    destinationCoordinate: BASE_COORDS.destination,
    routeCoordinates: [BASE_COORDS.pickup, BASE_COORDS.inTransit, BASE_COORDS.destination]
  };
}

function buildPassengerReceipt() {
  return {
    id: 'trip-passenger-proof-1',
    date: '28/03 23:15',
    route: '1280 Market Street -> Dolores Park',
    value: 'R$ 27,50',
    fare: 27.5,
    grossAmount: 27.5,
    distanceKm: 5.1,
    durationMin: 16,
    paymentMethod: 'pix',
    driverId: DRIVER_UID,
    driverName: 'Leaf Motorista Teste',
    passengerId: PASSENGER_UID,
    passengerName: 'Leaf Passageiro Teste',
    operationalFee: 1.15,
    paymentIntermediationFee: 0.55,
    totalFees: 1.7,
    driverNetAmount: 25.8,
    pickup: LABELS.pickupAddress,
    drop: LABELS.destinationAddress,
    pickupCoordinate: BASE_COORDS.pickup,
    destinationCoordinate: BASE_COORDS.destination,
    routeCoordinates: [BASE_COORDS.pickup, BASE_COORDS.inTransit, BASE_COORDS.destination]
  };
}

function buildDriverActiveRide(status) {
  return {
    bookingId: 'booking-proof-driver-1',
    id: 'booking-proof-driver-1',
    status,
    passenger: 'Leaf Passageiro Teste',
    passengerName: 'Leaf Passageiro Teste',
    passengerId: PASSENGER_UID,
    pickup: LABELS.pickupAddress,
    pickupAddress: LABELS.pickupAddress,
    pickupCoordinate: BASE_COORDS.pickup,
    dropoff: LABELS.destinationAddress,
    dropoffAddress: LABELS.destinationAddress,
    destinationCoordinate: BASE_COORDS.destination,
    fare: 12.5,
    driverNetAmount: 10.8,
    estimatedDriverNetAmount: 10.8,
    distanceKm: 2.4
  };
}

function buildDriverTripMeta(status) {
  return {
    leg: status === 'started' ? 'destination' : 'pickup',
    initialMeters: status === 'started' ? 2400 : 850,
    initialEtaMinutes: status === 'started' ? 8 : 4,
    pickupAddress: LABELS.pickupAddress,
    destinationAddress: LABELS.destinationAddress,
    pickupCoordinate: BASE_COORDS.pickup,
    destinationCoordinate: BASE_COORDS.destination,
    fare: 12.5,
    fareLabel: 'R$ 12,50'
  };
}

function buildDriverOffer() {
  return {
    bookingId: 'booking-proof-offer-1',
    id: 'booking-proof-offer-1',
    passenger: 'Leaf Passageiro Teste',
    passengerName: 'Leaf Passageiro Teste',
    passengerId: PASSENGER_UID,
    pickup: LABELS.pickupAddress,
    pickupAddress: LABELS.pickupAddress,
    dropoff: LABELS.destinationAddress,
    dropoffAddress: LABELS.destinationAddress,
    fare: 12.5,
    payout: 'R$ 12,50',
    distanceKm: 2.4,
    eta: '6 min',
    paymentMethod: 'pix'
  };
}

function buildPassengerTripBase() {
  return {
    bookingStatus: 'started',
    activeBookingId: 'booking-proof-passenger-1',
    activeBooking: {
      bookingId: 'booking-proof-passenger-1',
      id: 'booking-proof-passenger-1',
      driverId: DRIVER_UID,
      driverName: 'Leaf Motorista Teste',
      pickupLocation: { ...BASE_COORDS.pickup, add: LABELS.pickupAddress },
      destinationLocation: { ...BASE_COORDS.destination, add: LABELS.destinationAddress },
      estimatedFare: 27.5,
      paymentMethod: 'pix'
    },
    selectedDestination: {
      name: 'Dolores Park',
      address: LABELS.destinationAddress,
      coordinate: BASE_COORDS.destination
    },
    selectedVehicle: 'Leaf Plus',
    selectedFare: 27.5,
    tripDistanceKm: 5.1,
    tripDurationMin: 16,
    paymentMethod: 'pix',
    driverInfo: {
      id: DRIVER_UID,
      name: 'Leaf Motorista Teste',
      plate: 'TES8888',
      model: 'Toyota Prius'
    },
    currentAddress: LABELS.pickupAddress
  };
}

function scenarioPatch(name) {
  switch (name) {
    case 'passenger-home':
      return {
        bookingStatus: 'idle',
        activeBookingId: null,
        activeBooking: null,
        selectedDestination: null,
        rideExtension: { status: 'idle' },
        operationalContinuation: { status: 'idle' },
        tripHistory: [buildPassengerReceipt()],
        lastReceipt: buildPassengerReceipt()
      };
    case 'passenger-extension':
      return deepMerge(buildPassengerTripBase(), {
        rideExtension: {
          status: 'pending_payment',
          bookingId: 'booking-proof-passenger-1',
          requestId: 'ext-proof-1',
          currentFare: 27.5,
          newFare: 34.75,
          diffFare: 7.25,
          destination: {
            name: 'Oracle Park',
            address: LABELS.newDestinationAddress,
            coordinate: { latitude: 37.778595, longitude: -122.38927 }
          },
          chargeId: 'charge-extension-proof-1',
          paymentLink: 'https://pix.leaf.local/extension-proof-1',
          brCode: '000201010212extensionproof',
          requestedAt: '2026-03-28T23:10:00.000Z',
          decidedAt: '2026-03-28T23:10:30.000Z',
          expiresAt: '2026-03-28T23:12:00.000Z',
          message: 'O motorista aceitou. Pague o complemento Pix para seguir ao novo destino.'
        },
        operationalContinuation: { status: 'idle' }
      });
    case 'passenger-operational':
      return deepMerge(buildPassengerTripBase(), {
        bookingStatus: 'operational_interrupted',
        operationalContinuation: {
          status: 'passenger_decision_pending',
          bookingId: 'booking-proof-passenger-1',
          reason: 'VEHICLE_BREAKDOWN',
          note: 'Falha mecânica em teste controlado',
          previousDriverId: DRIVER_UID,
          pickupLocation: {
            lat: BASE_COORDS.interruption.latitude,
            lng: BASE_COORDS.interruption.longitude,
            address: LABELS.interruptionAddress
          },
          estimatedRefund: 20.62,
          remainingReservedAmount: 27.5,
          rideLegs: [],
          message: 'Seu motorista não consegue continuar. Deseja seguir com outro motorista parceiro?'
        },
        rideExtension: { status: 'idle' }
      });
    case 'passenger-receipt':
      return {
        bookingStatus: 'completed',
        activeBookingId: null,
        activeBooking: null,
        selectedDestination: {
          name: 'Dolores Park',
          address: LABELS.destinationAddress,
          coordinate: BASE_COORDS.destination
        },
        tripHistory: [buildPassengerReceipt()],
        lastReceipt: buildPassengerReceipt(),
        rideExtension: { status: 'idle' },
        operationalContinuation: { status: 'idle' }
      };
    case 'driver-home':
      return {
        bookingStatus: 'idle',
        activeBookingId: null,
        activeBooking: null,
        driverOnline: true,
        driverOffers: [],
        driverActiveRide: null,
        rideExtension: { status: 'idle' },
        operationalContinuation: { status: 'idle' }
      };
    case 'driver-offer':
      return {
        bookingStatus: 'searching',
        activeBookingId: 'booking-proof-offer-1',
        driverOnline: true,
        driverOffers: [buildDriverOffer()],
        driverActiveRide: null,
        rideExtension: { status: 'idle' },
        operationalContinuation: { status: 'idle' }
      };
    case 'driver-accepted':
      return {
        bookingStatus: 'accepted',
        activeBookingId: 'booking-proof-driver-1',
        driverOnline: true,
        driverOffers: [],
        driverActiveRide: buildDriverActiveRide('accepted'),
        driverTripMeta: buildDriverTripMeta('accepted'),
        driverCoordinate: { latitude: 37.78205, longitude: -122.41231 },
        boardingRemainingSec: 0
      };
    case 'driver-arrived':
      return {
        bookingStatus: 'arrived',
        activeBookingId: 'booking-proof-driver-1',
        driverOnline: true,
        driverOffers: [],
        driverActiveRide: buildDriverActiveRide('arrived'),
        driverTripMeta: buildDriverTripMeta('arrived'),
        driverCoordinate: BASE_COORDS.pickup,
        boardingRemainingSec: 120
      };
    case 'driver-started':
      return {
        bookingStatus: 'started',
        activeBookingId: 'booking-proof-driver-1',
        driverOnline: true,
        driverOffers: [],
        driverActiveRide: buildDriverActiveRide('started'),
        driverTripMeta: buildDriverTripMeta('started'),
        driverCoordinate: BASE_COORDS.inTransit,
        boardingRemainingSec: 0
      };
    case 'driver-receipt':
      return {
        bookingStatus: 'completed',
        activeBookingId: null,
        activeBooking: null,
        driverOnline: true,
        driverOffers: [],
        driverActiveRide: null,
        tripHistory: [buildDriverReceipt()],
        lastReceipt: buildDriverReceipt()
      };
    default:
      throw new Error(`unknown_scenario:${name}`);
  }
}

function scenarioRoute(name) {
  if (name === 'passenger-extension' || name === 'passenger-operational') {
    return 'leafapp://robotaxi/trip';
  }
  if (name === 'driver-receipt' || name === 'passenger-receipt') {
    return 'leafapp://robotaxi/receipt';
  }
  return null;
}

function main() {
  const deviceKey = String(arg('--device', '17pro')).toLowerCase();
  const scenario = String(arg('--scenario', 'passenger-home')).trim();
  const screenshotPath = arg('--screenshot', '');
  const freezeMs = Math.max(0, Number(arg('--freeze-ms', '14000')) || 14000);
  const deviceId = DEVICE_MAP[deviceKey] || deviceKey;
  const isDriverScenario = scenario.startsWith('driver-');
  const uid = isDriverScenario ? DRIVER_UID : PASSENGER_UID;
  const dataContainer = getContainerData(deviceId);
  const runtimeFilePath = getRuntimeFilePath(dataContainer, uid);
  const qaSeedFilePath = getQaSeedFilePath(dataContainer, uid);
  const baseline = loadRuntimeSnapshot(runtimeFilePath);
  const nextSnapshot = deepMerge(baseline, scenarioPatch(scenario));
  const route = scenarioRoute(scenario);
  const qaSeedSnapshot = {
    scenario,
    route,
    seededAt: Date.now(),
    freezeUntil: Date.now() + freezeMs
  };

  saveRuntimeSnapshot(runtimeFilePath, nextSnapshot);
  saveRuntimeSnapshot(qaSeedFilePath, qaSeedSnapshot);

  runBestEffort('xcrun', ['simctl', 'terminate', deviceId, APP_ID]);
  run('xcrun', ['simctl', 'launch', deviceId, APP_ID]);
  sleep(6500);

  if (route) {
    run('xcrun', ['simctl', 'openurl', deviceId, route]);
    sleep(1200);
    acceptOpenPromptIfNeeded(deviceId);
    sleep(4000);
  }

  if (screenshotPath) {
    fs.mkdirSync(path.dirname(path.resolve(screenshotPath)), { recursive: true });
    run('xcrun', ['simctl', 'io', deviceId, 'screenshot', path.resolve(screenshotPath)]);
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, deviceId, scenario, screenshotPath: screenshotPath ? path.resolve(screenshotPath) : null }, null, 2)}\n`
  );
}

main();
