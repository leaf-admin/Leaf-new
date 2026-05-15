#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { getIdTokenForUid } = require(path.join(
  __dirname,
  '..',
  '..',
  '..',
  'leaf-websocket-backend',
  'tests',
  'e2e',
  'backend',
  '__helpers__',
  'firebase-id-token.js',
));

const APP_ID = 'br.com.leaf.ride';
const ROOT_DIR = path.resolve(__dirname, '../../..');
const QA_PREFLIGHT_USERS = readJsonIfExists(
  path.join(ROOT_DIR, 'mobile-app', 'test-results', 'qa-preflight', 'ensure-users.json'),
  {},
);
const PASSENGER_UID = String(
  QA_PREFLIGHT_USERS?.passenger?.uid || 'OjML1wSzdNRaynjqMRlSW1Y0LVy2',
).trim();
const DRIVER_UID = String(
  QA_PREFLIGHT_USERS?.driver?.uid || '8vg2kxxqi3TYKlpD6eBlWgYseIq2',
).trim();

const REAL_PICKUP_ROUTE_POLYLINE =
  "vjekC~`qfGoBaDe@w@wAiCe@TR`@jAxB`CbElC~DfArAdCvCxEpEn@f@Zc@e@c@m@g@m@k@cAaAgAkAyCsD";
const REAL_DESTINATION_ROUTE_POLYLINE =
  "joekCbgqfG_AoAkAgBwBmDe@w@wAiCe@TURaG~EgDlCeDnCE@lAzChBrEp@`Bn@`BpCxG\\x@vAdCnAtBpBlDr@hAh@d@t@f@d@T~EzA`A\\v@d@fBfAdFpBhBj@|Ad@hAf@pDbBb@VLN^j@Tl@XdAX~ALdADzA?p@CbAWhB_@zBIdAKjCEz@ET[d@[Te@Ls@De@KMGMQK[?_@J[RURKbAGdBGbACjACn@@fANf@RNJf@\\b@`@TXZx@XzAEHZ~AjArGb@xBh@lCl@rDDp@Jj@r@pDp@pDTpCBjBSlISfJE|DAxDInF@d@Kl@KXqB|EaC|Gc@vAAd@@NHVNPl@fFvAlLb@pDNZNIPIn@w@d@k@JNTV~B`C`Em@bAOdAOtHcAlAQ";

function decodePolylinePoints(encoded) {
  const value = String(encoded || '');
  const coordinates = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;

  while (index < value.length) {
    let byte = 0;
    let shift = 0;
    let result = 0;

    do {
      byte = value.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < value.length);

    latitude += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;

    do {
      byte = value.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < value.length);

    longitude += result & 1 ? ~(result >> 1) : result >> 1;
    coordinates.push({
      latitude: Number((latitude / 1e5).toFixed(6)),
      longitude: Number((longitude / 1e5).toFixed(6)),
    });
  }

  return coordinates;
}

const REAL_PICKUP_ROUTE_COORDINATES = decodePolylinePoints(REAL_PICKUP_ROUTE_POLYLINE);
const REAL_DESTINATION_ROUTE_COORDINATES = decodePolylinePoints(REAL_DESTINATION_ROUTE_POLYLINE);

function routeCoordinateAt(coordinates, index, fallback) {
  const candidate = Array.isArray(coordinates) ? coordinates[index] : null;
  if (Number.isFinite(candidate?.latitude) && Number.isFinite(candidate?.longitude)) {
    return candidate;
  }
  return fallback;
}

function lastRouteCoordinate(coordinates, fallback) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return fallback;
  }
  return routeCoordinateAt(coordinates, coordinates.length - 1, fallback);
}

const BASE_COORDS = {
  pickup: lastRouteCoordinate(REAL_PICKUP_ROUTE_COORDINATES, { latitude: -22.971964, longitude: -43.182543 }),
  destination: lastRouteCoordinate(REAL_DESTINATION_ROUTE_COORDINATES, { latitude: -22.984843, longitude: -43.221972 }),
  driverHome: routeCoordinateAt(REAL_PICKUP_ROUTE_COORDINATES, 0, { latitude: -22.9708, longitude: -43.1819 }),
  pickupManeuver: routeCoordinateAt(REAL_PICKUP_ROUTE_COORDINATES, 10, { latitude: -22.971382, longitude: -43.182156 }),
  destinationManeuver: routeCoordinateAt(REAL_DESTINATION_ROUTE_COORDINATES, 32, { latitude: -22.976142, longitude: -43.19608 }),
  inTransit: routeCoordinateAt(REAL_DESTINATION_ROUTE_COORDINATES, 80, { latitude: -22.980013, longitude: -43.207186 }),
};

const LABELS = {
  pickupAddress: 'Copacabana Palace, Rio de Janeiro, RJ',
  destinationAddress: 'Leblon, Rio de Janeiro, RJ',
};

const PREFIX = '@prototype_runtime_session_';
const QA_PREFIX = '@prototype_runtime_qa_seed_';
const DRIVER_ACTIVATION_STORAGE_PREFIX = '@prototype_driver_activation_';
const AUTH_UID_STORAGE_KEY = '@auth_uid';
const USER_DATA_STORAGE_KEY = '@user_data';
const TEST_MODE_STORAGE_KEY = '@test_mode';
const QA_SOCKET_ID_TOKEN_STORAGE_KEY = '@qa_socket_id_token';
const CONFIRMED_DESTINATIONS_STORAGE_KEY = 'confirmedDestinations';
const DEFAULT_QA_FREEZE_MS = 600000;
const ADB_BIN = resolveAdbBin();

function readJsonIfExists(filePath, fallbackValue = {}) {
  try {
    if (!fs.existsSync(filePath)) {
      return fallbackValue;
    }
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_error) {
    return fallbackValue;
  }
}

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) {
    return process.argv[index + 1];
  }
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function resolveAdbBin() {
  const candidates = [
    process.env.ADB_BIN,
    path.join(process.env.ANDROID_HOME || '', 'platform-tools', 'adb'),
    path.join(process.env.ANDROID_SDK_ROOT || '', 'platform-tools', 'adb'),
    path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
    'adb',
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'adb') {
      return candidate;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return 'adb';
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', ...options }).trim();
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function firstAndroidDevice() {
  const output = run(ADB_BIN, ['devices']);
  const deviceLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /\tdevice$/.test(line));
  return deviceLine ? deviceLine.split(/\s+/)[0] : '';
}

function adbArgs(deviceId, args) {
  return deviceId ? ['-s', deviceId, ...args] : args;
}

function buildApprovedDriverActivation() {
  const timestamp = new Date().toISOString();
  return {
    version: 2,
    preRegistrationCompleted: true,
    currentStage: 'vehicle_activation',
    canGoOnline: true,
    driverProfileStatus: 'approved',
    vehicleProfileStatus: 'approved',
    stages: {
      driver_data_activation: {
        status: 'approved',
        completedAt: timestamp,
        updatedAt: timestamp,
        checklist: {
          cnhEar: true,
          vehicleRegistration: true,
          inssOrMei: true,
          backgroundCheckConsent: true,
        },
      },
      face_validation: {
        status: 'approved',
        completedAt: timestamp,
        updatedAt: timestamp,
        checklist: {
          facialValidation: true,
        },
      },
      vehicle_activation: {
        status: 'approved',
        completedAt: timestamp,
        updatedAt: timestamp,
        checklist: {
          crlv: true,
        },
      },
    },
    notifications: [],
    updatedAt: timestamp,
  };
}

function resolveQaUserByUid(uid, preferredRole) {
  const normalizedUid = String(uid || '').trim();
  const entries = Object.entries(QA_PREFLIGHT_USERS || {});
  const matched = entries.find(([, value]) => String(value?.uid || '').trim() === normalizedUid);
  if (matched?.[1]) {
    return matched[1];
  }

  const rolePrefix = preferredRole === 'driver' ? 'driver' : 'passenger';
  const fallback = entries.find(([key]) => key.toLowerCase().startsWith(rolePrefix));
  return fallback?.[1] || {};
}

function buildSeedUserData(uid, isDriverScenario) {
  if (!isDriverScenario) {
    const passengerSeed = resolveQaUserByUid(uid, 'passenger');
    const phone = String(passengerSeed.phone || '+5521102938475').trim();
    const suffix = phone.replace(/\D/g, '').slice(-4) || 'Teste';
    const baseProfile = {
      uid,
      id: uid,
      phone,
      phoneNumber: phone,
      email: 'passageiro.teste@leafapp.com',
      name: `Leaf Passageiro ${suffix}`,
      firstName: 'Leaf',
      lastName: `Passageiro ${suffix}`,
      usertype: 'customer',
      userType: 'customer',
      role: 'customer',
      approved: true,
      isApproved: true,
      canGoOnline: true,
      isTestUser: true,
    };

    return {
      ...baseProfile,
      profile: {
        ...baseProfile,
      },
    };
  }

  const driverActivation = buildApprovedDriverActivation();
  const driverSeed = resolveQaUserByUid(uid, 'driver');
  const vehicleId = String(driverSeed.vehicleId || `test_vehicle_${uid.slice(0, 12)}`).trim();
  const phone = String(driverSeed.phone || '+5521123456789').trim();
  const suffix = phone.replace(/\D/g, '').slice(-4) || 'Teste';
  const carPlate = String(driverSeed.carPlate || `TES${suffix}`).trim().toUpperCase();
  const userVehicleId = String(driverSeed.userVehicleId || `uv_${vehicleId}`).trim();
  const baseProfile = {
    uid,
    id: uid,
    phone,
    phoneNumber: phone,
    email: 'motorista.teste@leafapp.com',
    name: `Leaf Motorista ${suffix}`,
    firstName: 'Leaf',
    lastName: `Motorista ${suffix}`,
    usertype: 'driver',
    userType: 'driver',
    role: 'driver',
    approved: true,
    isApproved: true,
    canGoOnline: true,
    vehicleId,
    activeVehicleId: vehicleId,
    userVehicleId,
    carPlate,
    vehiclePlate: carPlate,
    vehicleNumber: carPlate,
    carModel: driverSeed.carModel || 'Tesla Model 3',
    carType: driverSeed.carType || 'Leaf Plus',
    isTestUser: true,
  };

  return {
    ...baseProfile,
    driverActivation,
    profile: {
      ...baseProfile,
      driverActivation,
    },
  };
}

function buildDriverRoutePlan() {
  const pickupCoordinates =
    REAL_PICKUP_ROUTE_COORDINATES.length >= 2
      ? REAL_PICKUP_ROUTE_COORDINATES
      : [
          BASE_COORDS.driverHome,
          BASE_COORDS.pickupManeuver,
          BASE_COORDS.pickup,
        ];
  const destinationCoordinates =
    REAL_DESTINATION_ROUTE_COORDINATES.length >= 2
      ? REAL_DESTINATION_ROUTE_COORDINATES
      : [
          BASE_COORDS.pickup,
          BASE_COORDS.destinationManeuver,
          BASE_COORDS.inTransit,
          BASE_COORDS.destination,
        ];
  const pickupManeuver = routeCoordinateAt(pickupCoordinates, 10, BASE_COORDS.pickupManeuver);
  const destinationManeuver = routeCoordinateAt(destinationCoordinates, 32, BASE_COORDS.destinationManeuver);

  return {
    pickupCoordinates,
    destinationCoordinates,
    combinedCoordinates: [
      ...pickupCoordinates,
      ...destinationCoordinates.slice(1),
    ],
    pickupSteps: [
      {
        instruction: 'Vire à direita na Av. Atlântica',
        startLocation: routeCoordinateAt(pickupCoordinates, 0, BASE_COORDS.driverHome),
        endLocation: pickupManeuver,
        distanceMeters: 760,
        durationSeconds: 150,
        polylinePoints: null,
      },
      {
        instruction: 'Siga em frente até o local de embarque',
        startLocation: pickupManeuver,
        endLocation: lastRouteCoordinate(pickupCoordinates, BASE_COORDS.pickup),
        distanceMeters: 549,
        durationSeconds: 109,
        polylinePoints: null,
      },
    ],
    destinationSteps: [
      {
        instruction: 'Vire à esquerda na Rua Jardim Botânico',
        startLocation: routeCoordinateAt(destinationCoordinates, 0, BASE_COORDS.pickup),
        endLocation: destinationManeuver,
        distanceMeters: 1830,
        durationSeconds: 315,
        polylinePoints: null,
      },
      {
        instruction: 'Siga em frente até o destino',
        startLocation: destinationManeuver,
        endLocation: lastRouteCoordinate(destinationCoordinates, BASE_COORDS.destination),
        distanceMeters: 4887,
        durationSeconds: 840,
        polylinePoints: null,
      },
    ],
    pickupDistanceKm: 1.309,
    pickupDurationMinutes: 5,
    destinationDistanceKm: 6.717,
    destinationDurationMinutes: 20,
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
    distanceKm: 6.7,
  };
}

function buildDriverTripMeta(status) {
  return {
    leg: status === 'started' ? 'destination' : 'pickup',
    initialMeters: status === 'started' ? 6717 : 1309,
    initialEtaMinutes: status === 'started' ? 20 : 5,
    pickupAddress: LABELS.pickupAddress,
    destinationAddress: LABELS.destinationAddress,
    pickupCoordinate: BASE_COORDS.pickup,
    destinationCoordinate: BASE_COORDS.destination,
    fare: 12.5,
    fareLabel: 'R$ 12,50',
    routePlan: buildDriverRoutePlan(),
  };
}

function buildScenarioPatch(scenario) {
  if (scenario === 'passenger-home') {
    return {
      activeRole: 'customer',
      bookingStatus: 'idle',
      activeBookingId: null,
      activeBooking: null,
      selectedDestination: null,
      tripDistanceKm: null,
      tripDurationMin: null,
      tripArrivalText: '',
      boardingDeadlineAt: null,
      boardingRemainingSec: 0,
      selectedFare: 15.06,
      selectedVehicle: 'Leaf Plus',
      driverInfo: null,
      driverCoordinate: null,
      driverActiveRide: null,
      searchingElapsedSeconds: 0,
      rideExtension: { status: 'idle' },
      operationalContinuation: { status: 'idle' },
      currentCoordinate: BASE_COORDS.pickup,
      currentAddress: LABELS.pickupAddress,
    };
  }

  if (scenario === 'driver-home') {
    return {
      activeRole: 'driver',
      bookingStatus: 'idle',
      activeBookingId: null,
      activeBooking: null,
      tripDistanceKm: null,
      tripDurationMin: null,
      tripArrivalText: '',
      boardingDeadlineAt: null,
      boardingRemainingSec: 0,
      driverOnline: false,
      driverOnlinePending: false,
      driverOnlineMutationSource: '',
      driverActivation: buildApprovedDriverActivation(),
      driverActivationResolved: true,
      driverCanGoOnline: true,
      driverOffers: [],
      driverActiveRide: null,
      driverCoordinate: BASE_COORDS.driverHome,
      currentCoordinate: BASE_COORDS.driverHome,
      driverTripMeta: {
        leg: null,
        initialMeters: null,
        initialEtaMinutes: null,
        pickupAddress: '',
        destinationAddress: '',
        pickupCoordinate: null,
        destinationCoordinate: null,
        fare: 0,
        fareLabel: '',
      },
      rideExtension: { status: 'idle' },
      operationalContinuation: { status: 'idle' },
    };
  }

  const status = scenario === 'driver-started' ? 'started' : 'accepted';
  const coordinate = status === 'started' ? BASE_COORDS.pickup : BASE_COORDS.driverHome;

  return {
    activeRole: 'driver',
    bookingStatus: status,
    activeBookingId: 'booking-proof-driver-1',
    driverOnline: true,
    driverActivation: buildApprovedDriverActivation(),
    driverActivationResolved: true,
    driverCanGoOnline: true,
    driverOffers: [],
    driverActiveRide: buildDriverActiveRide(status),
    driverTripMeta: buildDriverTripMeta(status),
    currentCoordinate: coordinate,
    driverCoordinate: coordinate,
    boardingRemainingSec: 0,
  };
}

function sqliteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildStorageSql(entries) {
  const statements = [
    'CREATE TABLE IF NOT EXISTS android_metadata (locale TEXT);',
    'DELETE FROM android_metadata;',
    "INSERT INTO android_metadata (locale) VALUES ('en_US');",
    'CREATE TABLE IF NOT EXISTS catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
  ];

  entries.forEach(([key, value]) => {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    statements.push(
      `INSERT OR REPLACE INTO catalystLocalStorage (key, value) VALUES (${sqliteLiteral(key)}, ${sqliteLiteral(serialized)});`,
    );
  });

  return `${statements.join('\n')}\n`;
}

function writeAsyncStorage(deviceId, entries) {
  const sql = buildStorageSql(entries);
  spawnSync(
    ADB_BIN,
    adbArgs(deviceId, ['shell', 'run-as', APP_ID, 'mkdir', 'databases']),
    { encoding: 'utf8' },
  );
  const result = spawnSync(
    ADB_BIN,
    adbArgs(deviceId, ['shell', 'run-as', APP_ID, 'sqlite3', 'databases/RKStorage']),
    {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 4,
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Falha ao gravar AsyncStorage Android. Use build debug/e2e para permitir run-as.\n${result.stderr || result.stdout}`,
    );
  }
}

function writeAsyncStorageRoot(deviceId, entries) {
  const databaseDir = `/data/data/${APP_ID}/databases`;
  const databasePath = `${databaseDir}/RKStorage`;
  const sql = buildStorageSql(entries);

  run(ADB_BIN, adbArgs(deviceId, ['root']));
  run(ADB_BIN, adbArgs(deviceId, ['wait-for-device']));
  run(ADB_BIN, adbArgs(deviceId, ['shell', 'mkdir', '-p', databaseDir]));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-android-storage-'));
  const tempDbPath = path.join(tempDir, 'RKStorage');

  try {
    spawnSync(ADB_BIN, adbArgs(deviceId, ['pull', databasePath, tempDbPath]), {
      encoding: 'utf8',
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    const localResult = spawnSync('sqlite3', [tempDbPath], {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 4,
    });

    if (localResult.status !== 0) {
      throw new Error(`Falha ao criar SQLite local.\n${localResult.stderr || localResult.stdout}`);
    }

    run(ADB_BIN, adbArgs(deviceId, ['push', tempDbPath, databasePath]));
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'rm', '-f', `${databasePath}-journal`, `${databasePath}-wal`, `${databasePath}-shm`]));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const owner = run(
    ADB_BIN,
    adbArgs(deviceId, ['shell', 'stat', '-c', '%u:%g', `/data/data/${APP_ID}`]),
  ).trim();

  if (owner) {
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'chown', '-R', owner, databaseDir]));
  }
  run(ADB_BIN, adbArgs(deviceId, ['shell', 'chmod', '-R', '700', databaseDir]));
}

function captureScreenshot(deviceId, screenshotPath) {
  if (!screenshotPath) {
    return null;
  }

  fs.mkdirSync(path.dirname(path.resolve(screenshotPath)), { recursive: true });
  const result = spawnSync(
    ADB_BIN,
    adbArgs(deviceId, ['exec-out', 'screencap', '-p']),
    { encoding: 'buffer', maxBuffer: 1024 * 1024 * 16 },
  );

  if (result.status !== 0) {
    throw new Error(`Falha ao capturar screenshot Android: ${String(result.stderr || '')}`);
  }

  fs.writeFileSync(path.resolve(screenshotPath), result.stdout);
  return path.resolve(screenshotPath);
}

function setAndroidEmulatorLocation(deviceId, coordinate) {
  const latitude = Number(coordinate?.latitude ?? coordinate?.lat);
  const longitude = Number(coordinate?.longitude ?? coordinate?.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return;
  }

  spawnSync(
    ADB_BIN,
    adbArgs(deviceId, [
      'emu',
      'geo',
      'fix',
      longitude.toFixed(6),
      latitude.toFixed(6),
    ]),
    { encoding: 'utf8' },
  );
}

async function main() {
  const deviceId = String(arg('--device', firstAndroidDevice())).trim();
  if (!deviceId) {
    throw new Error('Nenhum device Android conectado.');
  }

  const scenario = String(arg('--scenario', 'driver-accepted')).trim();
  const isDriverScenario = scenario.startsWith('driver-');
  const defaultUid = isDriverScenario ? DRIVER_UID : PASSENGER_UID;
  const screenshotPath = arg('--screenshot', '');
  const parsedFreezeMs = Number(arg('--freeze-ms', String(DEFAULT_QA_FREEZE_MS)));
  const freezeMs = Math.max(
    0,
    Number.isFinite(parsedFreezeMs) ? parsedFreezeMs : DEFAULT_QA_FREEZE_MS
  );
  const artifactDir = path.resolve(
    arg(
      '--artifact-dir',
      screenshotPath ? path.dirname(path.resolve(screenshotPath)) : process.cwd(),
    ),
  );
  const uid = String(arg('--uid', defaultUid)).trim() || defaultUid;
  const useRootWrite = hasFlag('--root-write');
  const skipSocketToken = hasFlag('--skip-socket-token');
  const snapshot = buildScenarioPatch(scenario);
  const currentLat = Number(arg('--current-lat', ''));
  const currentLng = Number(arg('--current-lng', ''));
  const currentAddress = String(arg('--current-address', '')).trim();
  if (Number.isFinite(currentLat) && Number.isFinite(currentLng)) {
    snapshot.currentCoordinate = { latitude: currentLat, longitude: currentLng };
    if (isDriverScenario) {
      snapshot.driverCoordinate = snapshot.currentCoordinate;
    }
  }
  if (currentAddress) {
    snapshot.currentAddress = currentAddress;
  }
  const seedUserData = buildSeedUserData(uid, isDriverScenario);
  snapshot.profileUid = uid;
  snapshot.profileName = String(seedUserData.name || seedUserData.firstName || '').trim();
  snapshot.riderProfile = {
    name: String(seedUserData.name || seedUserData.firstName || 'Leaf').trim(),
    phone: String(seedUserData.phoneNumber || seedUserData.phone || '').trim(),
    email: String(seedUserData.email || '').trim(),
    preference: isDriverScenario ? 'Motorista Leaf' : 'Corridas silenciosas',
  };
  const qaSeedSnapshot = {
    scenario,
    route: 'leafapp://robotaxi/home',
    seededAt: Date.now(),
    freezeUntil: Date.now() + freezeMs,
  };

  fs.mkdirSync(artifactDir, { recursive: true });

  if (hasFlag('--clear')) {
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'pm', 'clear', APP_ID]));
  }

  run(ADB_BIN, adbArgs(deviceId, ['shell', 'am', 'force-stop', APP_ID]));
  setAndroidEmulatorLocation(deviceId, snapshot.driverCoordinate || snapshot.currentCoordinate);
  const qaSocketIdToken = skipSocketToken ? '' : await getIdTokenForUid(uid);
  const storageEntries = [
    [`${PREFIX}${uid}`, snapshot],
    [`${QA_PREFIX}${uid}`, qaSeedSnapshot],
    [AUTH_UID_STORAGE_KEY, uid],
    [USER_DATA_STORAGE_KEY, seedUserData],
    [TEST_MODE_STORAGE_KEY, 'true'],
  ];
  if (!isDriverScenario) {
    storageEntries.push([
      CONFIRMED_DESTINATIONS_STORAGE_KEY,
      [
        {
          id: 'qa-destination-leblon',
          name: 'Leblon',
          address: LABELS.destinationAddress,
          coordinate: BASE_COORDS.destination,
          sourceType: 'qa_seed',
          previewMode: 'local_only',
          skipGooglePreview: true,
        },
      ],
    ]);
  }
  if (qaSocketIdToken) {
    storageEntries.push([QA_SOCKET_ID_TOKEN_STORAGE_KEY, qaSocketIdToken]);
  }
  if (isDriverScenario) {
    storageEntries.splice(2, 0, [`${DRIVER_ACTIVATION_STORAGE_PREFIX}${uid}`, buildApprovedDriverActivation()]);
  }

  if (useRootWrite) {
    writeAsyncStorageRoot(deviceId, storageEntries);
  } else {
    writeAsyncStorage(deviceId, storageEntries);
  }

  let launchOutput = '';
  if (!hasFlag('--skip-launch')) {
    setAndroidEmulatorLocation(deviceId, snapshot.driverCoordinate || snapshot.currentCoordinate);
    launchOutput = run(
      ADB_BIN,
      adbArgs(deviceId, [
        'shell',
        'am',
        'start',
        '-W',
        '-a',
        'android.intent.action.VIEW',
        '-d',
        'leafapp://robotaxi/home',
        APP_ID,
      ]),
    );
    sleep(Math.min(Math.max(freezeMs, 5000), 18000));
  }

  const resolvedScreenshotPath = captureScreenshot(deviceId, screenshotPath);
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        deviceId,
        scenario,
        screenshotPath: resolvedScreenshotPath,
        launchOutput,
      },
      null,
      2,
    )}\n`,
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
