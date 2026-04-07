#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const APP_ID = 'br.com.leaf.ride';
const DEVICE_MAP = {
  '17pro': '195D2C57-87DC-4953-ABF1-4FD351ADBBEF',
  '17promax': '2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C',
  'driver': '2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C',
  '16e': '2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C'
};
const PASSENGER_UID = 'OjML1wSzdNRaynjqMRlSW1Y0LVy2';
const DRIVER_UID = '8vg2kxxqi3TYKlpD6eBlWgYseIq2';
const PREFIX = '@prototype_runtime_session_';
const QA_PREFIX = '@prototype_runtime_qa_seed_';
const AUTH_UID_STORAGE_KEY = '@auth_uid';
const USER_DATA_STORAGE_KEY = '@user_data';
const TEST_MODE_STORAGE_KEY = '@test_mode';

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

function runIgnoringFailure(command, args) {
  try {
    return run(command, args);
  } catch (error) {
    return String(error?.stderr || error?.stdout || error?.message || '').trim();
  }
}

function latestCrashReport(appName = 'Leaf') {
  try {
    const reportsDir = path.join(
      process.env.HOME || '',
      'Library',
      'Logs',
      'DiagnosticReports'
    );
    if (!reportsDir || !fs.existsSync(reportsDir)) {
      return null;
    }

    const matches = fs
      .readdirSync(reportsDir)
      .filter((name) => name.startsWith(`${appName}-`) && name.endsWith('.ips'))
      .map((name) => {
        const reportPath = path.join(reportsDir, name);
        return {
          path: reportPath,
          mtimeMs: fs.statSync(reportPath).mtimeMs
        };
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs);

    return matches[0] || null;
  } catch (_error) {
    return null;
  }
}

function parseLaunchPid(output) {
  const match = String(output || '').match(/:\s*(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

function copyCrashArtifacts(deviceId, artifactDir, crashReportPath) {
  if (!artifactDir) {
    return crashReportPath || null;
  }

  fs.mkdirSync(artifactDir, { recursive: true });

  let copiedCrashPath = null;
  if (crashReportPath && fs.existsSync(crashReportPath)) {
    copiedCrashPath = path.join(artifactDir, path.basename(crashReportPath));
    fs.copyFileSync(crashReportPath, copiedCrashPath);
  }

  try {
    runBestEffort('xcrun', [
      'simctl',
      'io',
      deviceId,
      'screenshot',
      path.join(artifactDir, 'launch-crash-screen.png')
    ]);
  } catch (_error) {
    // best effort
  }

  return copiedCrashPath || crashReportPath || null;
}

function waitForNewCrashReport(baselineCrash = null, appName = 'Leaf', graceMs = 4000) {
  const deadline = Date.now() + Math.max(0, Number(graceMs) || 0);
  const baselineMtimeMs = Number(baselineCrash?.mtimeMs || 0);

  while (Date.now() < deadline) {
    const latest = latestCrashReport(appName);
    const hasNewCrash =
      latest &&
      Number(latest.mtimeMs || 0) > baselineMtimeMs &&
      latest.path !== baselineCrash?.path;
    if (hasNewCrash) {
      return latest;
    }
    sleep(250);
  }

  return null;
}

function parseIpsObjects(reportPath) {
  if (!reportPath || !fs.existsSync(reportPath)) {
    return [];
  }

  const raw = fs.readFileSync(reportPath, 'utf8');
  const objects = [];
  let buffer = '';
  let depth = 0;

  for (const char of raw) {
    if (char === '{') {
      depth += 1;
    }
    if (depth > 0) {
      buffer += char;
    }
    if (char === '}') {
      depth -= 1;
      if (depth === 0 && buffer.trim()) {
        try {
          objects.push(JSON.parse(buffer));
        } catch (_error) {
          return objects;
        }
        buffer = '';
      }
    }
  }

  return objects;
}

function summarizeCrashReport(reportPath) {
  const objects = parseIpsObjects(reportPath);
  const header = objects[0] || {};
  const report = objects[objects.length - 1] || {};
  const faultingThreadId = Number(report?.faultingThread);
  const faultingThread =
    (Array.isArray(report?.threads) &&
      report.threads.find(
        (thread) => thread?.triggered || Number(thread?.id) === faultingThreadId
      )) ||
    null;
  const frames = Array.isArray(faultingThread?.frames)
    ? faultingThread.frames.slice(0, 8)
    : [];
  const usedImages = Array.isArray(report?.usedImages) ? report.usedImages : [];
  const frameImages = frames
    .map((frame) => usedImages[Number(frame?.imageIndex)]?.name || null)
    .filter(Boolean);
  const frameSymbols = frames
    .map((frame) => String(frame?.symbol || '').trim())
    .filter(Boolean);
  const firstSymbol = frameSymbols[0] || '';
  const reportNotes = Array.isArray(report?.reportNotes) ? report.reportNotes : [];
  const hasDyldSignature =
    firstSymbol.includes('DyldSharedCache::getUUID') ||
    frameSymbols.some((symbol) => symbol.includes('_dyld_sim_prepare')) ||
    frameImages.includes('dyld_sim');
  const hasOnlyDyldFrames =
    frameImages.length > 0 &&
    frameImages.every((imageName) => ['dyld', 'dyld_sim'].includes(imageName));
  const hasSharedCacheNote = reportNotes.some((note) =>
    String(note || '').includes('dyld_process_snapshot_get_shared_cache failed')
  );

  return {
    appName: header?.app_name || null,
    incidentId: header?.incident_id || null,
    timestamp: header?.timestamp || null,
    exception: report?.exception || null,
    termination: report?.termination || null,
    faultingThread: Number.isFinite(faultingThreadId) ? faultingThreadId : null,
    threadName: faultingThread?.name || null,
    queue: faultingThread?.queue || null,
    frameImages,
    frameSymbols,
    reportNotes,
    kind:
      hasDyldSignature || hasOnlyDyldFrames || hasSharedCacheNote
        ? 'simulator_runtime'
        : 'app_runtime'
  };
}

function writeCrashMetadata(artifactDir, metadata) {
  if (!artifactDir) {
    return;
  }

  fs.mkdirSync(artifactDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactDir, 'launch-crash-metadata.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8'
  );
}

function recoverSimulatorRuntime(deviceId) {
  runBestEffort('xcrun', ['simctl', 'terminate', deviceId, APP_ID]);
  runIgnoringFailure('xcrun', ['simctl', 'shutdown', deviceId]);
  sleep(1000);
  runIgnoringFailure('xcrun', ['simctl', 'boot', deviceId]);
  runIgnoringFailure('xcrun', ['simctl', 'bootstatus', deviceId, '-b']);
  runIgnoringFailure('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', deviceId]);
  sleep(1200);
}

function ensureSimulatorReady(deviceId) {
  runIgnoringFailure('xcrun', ['simctl', 'boot', deviceId]);
  runIgnoringFailure('xcrun', ['simctl', 'bootstatus', deviceId, '-b']);
  runIgnoringFailure('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', deviceId]);
  sleep(1200);
}

function isRetryableLaunchError(error) {
  const stderr = String(error?.stderr || '');
  const stdout = String(error?.stdout || '');
  const combined = `${stderr}\n${stdout}`;
  return (
    combined.includes('FBSOpenApplicationServiceErrorDomain') ||
    combined.includes('SBMainWorkspace') ||
    combined.includes('request was denied by service delegate')
  );
}

function waitForProcessOrCrash({
  pid,
  deviceId,
  waitMs,
  artifactDir = '',
  appName = 'Leaf',
  baselineCrash = null
}) {
  const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);

  while (Date.now() < deadline) {
    if (pid) {
      try {
        process.kill(pid, 0);
      } catch (_error) {
        const latest = waitForNewCrashReport(baselineCrash, appName, 4000);
        const hasNewCrash = Boolean(latest?.path);

        if (hasNewCrash) {
          const crashSummary = summarizeCrashReport(latest.path);
          const copiedCrashPath = copyCrashArtifacts(
            deviceId,
            artifactDir,
            latest.path
          );
          writeCrashMetadata(artifactDir, {
            ...crashSummary,
            originalCrashReportPath: latest.path,
            copiedCrashReportPath: copiedCrashPath || latest.path
          });
          const error = new Error(
            `App crashed during simulator launch: ${copiedCrashPath || latest.path}`
          );
          error.code = 'IOS_SIM_APP_CRASH';
          error.crashReportPath = copiedCrashPath || latest.path;
          error.crashKind = crashSummary.kind;
          error.crashSummary = crashSummary;
          throw error;
        }

        const error = new Error(
          `App exited during simulator launch before settling (pid ${pid}).`
        );
        error.code = 'IOS_SIM_APP_EXIT';
        throw error;
      }
    }

    sleep(250);
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

function getAuthUidFilePath(dataContainer) {
  return getStorageFilePath(dataContainer, AUTH_UID_STORAGE_KEY);
}

function getUserDataFilePath(dataContainer) {
  return getStorageFilePath(dataContainer, USER_DATA_STORAGE_KEY);
}

function getTestModeFilePath(dataContainer) {
  return getStorageFilePath(dataContainer, TEST_MODE_STORAGE_KEY);
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

function getManifestFilePath(dataContainer) {
  return path.join(
    dataContainer,
    'Library',
    'Application Support',
    APP_ID,
    'RCTAsyncLocalStorage_V1',
    'manifest.json'
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

function loadManifest(manifestFilePath) {
  if (!fs.existsSync(manifestFilePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(manifestFilePath, 'utf8'));
  } catch (_error) {
    return {};
  }
}

function saveAsyncStorageValue(dataContainer, key, value) {
  const manifestFilePath = getManifestFilePath(dataContainer);
  const filePath = getStorageFilePath(dataContainer, key);
  const serialized =
    typeof value === 'string' ? value : JSON.stringify(value);

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${serialized}\n`);

  const manifest = loadManifest(manifestFilePath);
  manifest[String(key)] = serialized;
  fs.writeFileSync(manifestFilePath, JSON.stringify(manifest));
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

function buildSeedUserData(uid, isDriverScenario) {
  if (isDriverScenario) {
    return {
      uid,
      id: uid,
      phone: '+5511888888888',
      phoneNumber: '+5511888888888',
      email: 'motorista.teste@leafapp.com',
      name: 'Motorista',
      firstName: 'Leaf',
      lastName: 'Motorista Teste',
      usertype: 'driver',
      userType: 'driver',
      role: 'driver',
      approved: true,
      isApproved: true,
      canGoOnline: true,
      isTestUser: true
    };
  }

  return {
    uid,
    id: uid,
    phone: '+5511999999999',
    phoneNumber: '+5511999999999',
    email: 'passageiro.teste@leafapp.com',
    name: 'Leaf Passageiro Teste',
    firstName: 'Leaf',
    lastName: 'Passageiro Teste',
    usertype: 'customer',
    userType: 'customer',
    role: 'customer',
    approved: true,
    isApproved: true,
    canGoOnline: true,
    isTestUser: true
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

function buildPassengerTripBase(status = 'started') {
  const normalizedStatus = String(status || 'started').trim().toLowerCase();
  const isAccepted = normalizedStatus === 'accepted';
  const driverCoordinate = isAccepted
    ? { latitude: 37.78205, longitude: -122.41231 }
    : BASE_COORDS.inTransit;
  const tripDistanceKm = isAccepted ? 1.2 : 5.1;
  const tripDurationMin = isAccepted ? 4 : 16;

  return {
    bookingStatus: normalizedStatus,
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
    tripDistanceKm,
    tripDurationMin,
    tripArrivalText: `Chegada estimada em ${tripDurationMin} min`,
    paymentMethod: 'pix',
    driverCoordinate,
    driverActiveRide: buildDriverActiveRide(normalizedStatus),
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
        tripDistanceKm: null,
        tripDurationMin: null,
        tripArrivalText: '',
        boardingDeadlineAt: null,
        boardingRemainingSec: 0,
        selectedFare: null,
        selectedVehicle: '',
        driverInfo: null,
        driverCoordinate: null,
        driverActiveRide: null,
        searchingElapsedSeconds: 0,
        rideExtension: { status: 'idle' },
        operationalContinuation: { status: 'idle' },
        tripHistory: [buildPassengerReceipt()],
        lastReceipt: buildPassengerReceipt()
      };
    case 'passenger-extension':
      return deepMerge(buildPassengerTripBase('started'), {
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
      return deepMerge(buildPassengerTripBase('started'), {
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
    case 'passenger-accepted':
      return deepMerge(buildPassengerTripBase('accepted'), {
        rideExtension: { status: 'idle' },
        operationalContinuation: { status: 'idle' }
      });
    case 'passenger-started':
      return deepMerge(buildPassengerTripBase('started'), {
        rideExtension: { status: 'idle' },
        operationalContinuation: { status: 'idle' }
      });
    case 'driver-home':
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
        driverOffers: [],
        driverActiveRide: null,
        driverCoordinate: null,
        driverTripMeta: {
          leg: null,
          initialMeters: null,
          initialEtaMinutes: null,
          pickupAddress: '',
          destinationAddress: '',
          pickupCoordinate: null,
          destinationCoordinate: null,
          fare: 0,
          fareLabel: ''
        },
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
        activeRole: 'driver',
        bookingStatus: 'accepted',
        activeBookingId: 'booking-proof-driver-1',
        driverOnline: true,
        driverOffers: [],
        driverActiveRide: buildDriverActiveRide('accepted'),
        driverTripMeta: buildDriverTripMeta('accepted'),
        currentCoordinate: { latitude: 37.78205, longitude: -122.41231 },
        driverCoordinate: { latitude: 37.78205, longitude: -122.41231 },
        boardingRemainingSec: 0
      };
    case 'driver-arrived':
      return {
        activeRole: 'driver',
        bookingStatus: 'arrived',
        activeBookingId: 'booking-proof-driver-1',
        driverOnline: true,
        driverOffers: [],
        driverActiveRide: buildDriverActiveRide('arrived'),
        driverTripMeta: buildDriverTripMeta('arrived'),
        currentCoordinate: BASE_COORDS.pickup,
        driverCoordinate: BASE_COORDS.pickup,
        boardingRemainingSec: 120
      };
    case 'driver-started':
      return {
        activeRole: 'driver',
        bookingStatus: 'started',
        activeBookingId: 'booking-proof-driver-1',
        driverOnline: true,
        driverOffers: [],
        driverActiveRide: buildDriverActiveRide('started'),
        driverTripMeta: buildDriverTripMeta('started'),
        currentCoordinate: BASE_COORDS.inTransit,
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
  if (name === 'passenger-home' || name === 'driver-home') {
    return 'leafapp://robotaxi/home';
  }
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
  const artifactDir = path.resolve(
    arg(
      '--artifact-dir',
      screenshotPath ? path.dirname(path.resolve(screenshotPath)) : process.cwd()
    )
  );
  const freezeMs = Math.max(0, Number(arg('--freeze-ms', '14000')) || 14000);
  const deviceId = DEVICE_MAP[deviceKey] || deviceKey;
  const isDriverScenario = scenario.startsWith('driver-');
  const uid = isDriverScenario ? DRIVER_UID : PASSENGER_UID;
  const dataContainer = getContainerData(deviceId);
  const runtimeFilePath = getRuntimeFilePath(dataContainer, uid);
  const qaSeedFilePath = getQaSeedFilePath(dataContainer, uid);
  const authUidFilePath = getAuthUidFilePath(dataContainer);
  const userDataFilePath = getUserDataFilePath(dataContainer);
  const testModeFilePath = getTestModeFilePath(dataContainer);
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
  saveAsyncStorageValue(dataContainer, `${PREFIX}${uid}`, nextSnapshot);
  saveAsyncStorageValue(dataContainer, `${QA_PREFIX}${uid}`, qaSeedSnapshot);
  saveAsyncStorageValue(dataContainer, AUTH_UID_STORAGE_KEY, uid);
  saveAsyncStorageValue(
    dataContainer,
    USER_DATA_STORAGE_KEY,
    buildSeedUserData(uid, isDriverScenario)
  );
  saveAsyncStorageValue(dataContainer, TEST_MODE_STORAGE_KEY, 'true');
  fs.mkdirSync(artifactDir, { recursive: true });

  let launchPid = null;
  const maxLaunchAttempts = 2;

  for (let attempt = 1; attempt <= maxLaunchAttempts; attempt += 1) {
    const baselineCrash = latestCrashReport('Leaf');

    if (attempt > 1) {
      process.stderr.write(
        `[ios-seed][retry] restarting simulator runtime before retry ${attempt}/${maxLaunchAttempts}\n`
      );
      recoverSimulatorRuntime(deviceId);
    }

    ensureSimulatorReady(deviceId);
    runBestEffort('xcrun', ['simctl', 'terminate', deviceId, APP_ID]);
    let launchOutput = '';
    try {
      launchOutput = run('xcrun', ['simctl', 'launch', deviceId, APP_ID]);
    } catch (error) {
      const retryableLaunchFailure =
        isRetryableLaunchError(error) && attempt < maxLaunchAttempts;
      if (retryableLaunchFailure) {
        process.stderr.write(
          `[ios-seed][retry] simulator denied app launch; retrying after runtime recovery (${attempt}/${maxLaunchAttempts})\n`
        );
        continue;
      }
      throw error;
    }
    launchPid = parseLaunchPid(launchOutput);

    try {
      waitForProcessOrCrash({
        pid: launchPid,
        deviceId,
        waitMs: 6500,
        artifactDir,
        baselineCrash
      });

      if (route) {
        run('xcrun', ['simctl', 'openurl', deviceId, route]);
        sleep(1200);
        acceptOpenPromptIfNeeded(deviceId);
        waitForProcessOrCrash({
          pid: launchPid,
          deviceId,
          waitMs: 4000,
          artifactDir,
          baselineCrash
        });
      }

      break;
    } catch (error) {
      const retryableSimulatorCrash =
        error?.code === 'IOS_SIM_APP_CRASH' &&
        error?.crashKind === 'simulator_runtime' &&
        attempt < maxLaunchAttempts;

      if (retryableSimulatorCrash) {
        process.stderr.write(
          `[ios-seed][retry] detected simulator runtime crash (${error.crashReportPath || 'unknown report'})\n`
        );
        continue;
      }

      throw error;
    }
  }

  if (screenshotPath) {
    fs.mkdirSync(path.dirname(path.resolve(screenshotPath)), { recursive: true });
    run('xcrun', ['simctl', 'io', deviceId, 'screenshot', path.resolve(screenshotPath)]);
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, deviceId, scenario, screenshotPath: screenshotPath ? path.resolve(screenshotPath) : null, launchPid }, null, 2)}\n`
  );
}

main();
