#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
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
const SIMCTL_BIN =
  process.env.SIMCTL_BIN ||
  '/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl';
const DEVICE_MAP = {
  '17pro': '195D2C57-87DC-4953-ABF1-4FD351ADBBEF',
  '17promax': '2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C',
  'driver': '2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C',
  '16e': '2E44BC8E-9AA8-43BE-BD5E-D0B5A73E543C'
};
const PREFIX = '@prototype_runtime_session_';
const QA_PREFIX = '@prototype_runtime_qa_seed_';
const DRIVER_ACTIVATION_STORAGE_PREFIX = '@prototype_driver_activation_';
const CONFIRMED_DESTINATIONS_STORAGE_KEY = 'confirmedDestinations';
const AUTH_UID_STORAGE_KEY = '@auth_uid';
const USER_DATA_STORAGE_KEY = '@user_data';
const TEST_MODE_STORAGE_KEY = '@test_mode';
const QA_SOCKET_ID_TOKEN_STORAGE_KEY = '@qa_socket_id_token';
const DEFAULT_QA_FREEZE_MS = 600000;
const REALTIME_DRIVER_SCENARIOS = new Set(['driver-home']);

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

const QA_PREFLIGHT_USERS = readJsonIfExists(
  path.join(ROOT_DIR, 'mobile-app', 'test-results', 'qa-preflight', 'ensure-users.json'),
  {},
);
const PASSENGER_UID = String(
  QA_PREFLIGHT_USERS?.passenger?.uid || 'OjML1wSzdNRaynjqMRlSW1Y0LVy2'
).trim();
const DRIVER_UID = String(
  QA_PREFLIGHT_USERS?.driver?.uid || '8vg2kxxqi3TYKlpD6eBlWgYseIq2'
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
  interruption: { latitude: -22.976794, longitude: -43.197329 },
  destination: lastRouteCoordinate(REAL_DESTINATION_ROUTE_COORDINATES, { latitude: -22.984843, longitude: -43.221972 }),
  driverHome: routeCoordinateAt(REAL_PICKUP_ROUTE_COORDINATES, 0, { latitude: -22.9708, longitude: -43.1819 }),
  pickupManeuver: routeCoordinateAt(REAL_PICKUP_ROUTE_COORDINATES, 10, { latitude: -22.971382, longitude: -43.182156 }),
  destinationManeuver: routeCoordinateAt(REAL_DESTINATION_ROUTE_COORDINATES, 32, { latitude: -22.976142, longitude: -43.19608 }),
  passengerHome: lastRouteCoordinate(REAL_PICKUP_ROUTE_COORDINATES, { latitude: -22.971964, longitude: -43.182543 }),
  inTransit: routeCoordinateAt(REAL_DESTINATION_ROUTE_COORDINATES, 80, { latitude: -22.980013, longitude: -43.207186 })
};

const LABELS = {
  pickupAddress: 'Copacabana Palace, Rio de Janeiro, RJ',
  interruptionAddress: 'Av. Vieira Souto, Ipanema, Rio de Janeiro, RJ',
  destinationAddress: 'Leblon, Rio de Janeiro, RJ',
  newDestinationAddress: 'Barra da Tijuca, Rio de Janeiro, RJ'
};

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

function defaultFreezeMsForScenario(scenario) {
  return REALTIME_DRIVER_SCENARIOS.has(String(scenario || '').trim())
    ? 0
    : DEFAULT_QA_FREEZE_MS;
}

function parseCoordinateOverride(latitudeArg, longitudeArg) {
  if (
    latitudeArg === undefined ||
    latitudeArg === null ||
    longitudeArg === undefined ||
    longitudeArg === null ||
    String(latitudeArg).trim() === '' ||
    String(longitudeArg).trim() === ''
  ) {
    return null;
  }

  const latitude = Number(latitudeArg);
  const longitude = Number(longitudeArg);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    latitude,
    longitude,
  };
}

function buildDestinationOverride(nameArg, addressArg, latitudeArg, longitudeArg) {
  const coordinate = parseCoordinateOverride(latitudeArg, longitudeArg);
  const name = String(nameArg || '').trim();
  const address = String(addressArg || '').trim();

  if (!coordinate || (!name && !address)) {
    return null;
  }

  return {
    id: `${name || address}-${coordinate.latitude},${coordinate.longitude}`,
    name: name || address,
    address: address || name,
    coordinate,
    sourceType: 'confirmed_destination',
    previewMode: 'local_only',
    skipGooglePreview: true
  };
}

function formatSimctlLocationCoordinate(coordinate) {
  const latitude = Number(coordinate?.latitude ?? coordinate?.lat);
  const longitude = Number(coordinate?.longitude ?? coordinate?.lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return `${latitude.toFixed(6)},${longitude.toFixed(6)}`;
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

function runSimctl(args) {
  return run(SIMCTL_BIN, args);
}

function runSimctlBestEffort(args) {
  return runBestEffort(SIMCTL_BIN, args);
}

function runSimctlIgnoringFailure(args) {
  return runIgnoringFailure(SIMCTL_BIN, args);
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
    runSimctlBestEffort([
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
  runSimctlBestEffort(['terminate', deviceId, APP_ID]);
  runSimctlIgnoringFailure(['shutdown', deviceId]);
  sleep(1000);
  runSimctlIgnoringFailure(['boot', deviceId]);
  runSimctlIgnoringFailure(['bootstatus', deviceId, '-b']);
  runIgnoringFailure('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', deviceId]);
  sleep(1200);
}

function ensureSimulatorReady(deviceId) {
  runSimctlIgnoringFailure(['boot', deviceId]);
  runSimctlIgnoringFailure(['bootstatus', deviceId, '-b']);
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
  return runSimctl(['get_app_container', deviceId, APP_ID, 'data']);
}

function getRuntimeFilePath(dataContainer, uid) {
  return getStorageFilePath(dataContainer, `${PREFIX}${uid}`);
}

function getQaSeedFilePath(dataContainer, uid) {
  return getStorageFilePath(dataContainer, `${QA_PREFIX}${uid}`);
}

function getDriverActivationFilePath(dataContainer, uid) {
  return getStorageFilePath(
    dataContainer,
    `${DRIVER_ACTIVATION_STORAGE_PREFIX}${uid}`
  );
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
    route: 'Copacabana Palace -> Leblon',
    value: 'R$ 27,50',
    fare: 27.5,
    grossAmount: 27.5,
    distanceKm: 5.1,
    durationMin: 16,
    paymentMethod: 'pix',
    driverId: DRIVER_UID,
    driverName: 'Carlos Motorista Teste',
    passengerId: PASSENGER_UID,
    passengerName: 'Leaf Passageiro Teste',
    baseFare: 22.4,
    variableFare: 5.1,
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

function buildPassengerReceipt() {
  return {
    id: 'trip-passenger-proof-1',
    date: '28/03 23:15',
    route: 'Copacabana Palace -> Leblon',
    value: 'R$ 27,50',
    fare: 27.5,
    grossAmount: 27.5,
    distanceKm: 5.1,
    durationMin: 16,
    paymentMethod: 'pix',
    driverId: DRIVER_UID,
    driverName: 'Carlos Motorista Teste',
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
    notifications: [
      {
        id: 'seed-driver-activation-approved',
        title: 'Ativação aprovada',
        message: 'Motorista liberado para ficar online.',
        kind: 'driver',
        scope: 'driver',
        read: false,
        createdAt: timestamp,
      },
    ],
    updatedAt: timestamp,
  };
}

function buildSeedUserData(uid, isDriverScenario) {
  if (isDriverScenario) {
    const driverActivation = buildApprovedDriverActivation();
    const driverSeed = QA_PREFLIGHT_USERS?.driver || {};
    const fallbackPlate = `TES${String(uid || '').replace(/\W/g, '').slice(-4) || '6789'}`;
    const vehicleId = String(driverSeed.vehicleId || `test_vehicle_${uid.slice(0, 12)}`).trim();
    const userVehicleId = String(driverSeed.userVehicleId || `uv_${vehicleId}`).trim();
    const carPlate = String(driverSeed.carPlate || fallbackPlate).trim().toUpperCase();
    const carType = String(driverSeed.carType || 'Leaf Plus').trim();
    const baseProfile = {
      uid,
      id: uid,
      phone: String(driverSeed.phone || '+5521123456789').trim(),
      phoneNumber: String(driverSeed.phone || '+5521123456789').trim(),
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
      vehicleId,
      activeVehicleId: vehicleId,
      userVehicleId,
      carPlate,
      vehiclePlate: carPlate,
      vehicleNumber: carPlate,
      carModel: driverSeed.carModel || 'Tesla Model 3',
      carType,
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

  const baseProfile = {
    uid,
    id: uid,
    phone: '+5521102938475',
    phoneNumber: '+5521102938475',
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
    isTestUser: true,
  };

  return {
    ...baseProfile,
    profile: {
      ...baseProfile,
    },
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
    grossFare: 12.5,
    payout: 'R$ 10,80',
    driverNetAmount: 10.8,
    estimatedDriverNetAmount: 10.8,
    estimatedOperationalFee: 0.99,
    estimatedPaymentIntermediationFee: 0.71,
    estimatedTotalFees: 1.7,
    pricingSnapshotLocked: true,
    pricingSnapshotLockedAt: '2026-05-19T12:00:00.000Z',
    pickupEtaMin: 5,
    tripDurationMin: 20,
    distanceKm: 6.7
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
    routePlan: buildDriverRoutePlan()
  };
}

function buildDriverRideContext(status) {
  const normalizedStatus = String(status || 'accepted').trim().toLowerCase();
  const isStarted = normalizedStatus === 'started';
  const isArrived = normalizedStatus === 'arrived';
  const currentCoordinate = isStarted
    ? BASE_COORDS.pickup
    : isArrived
      ? BASE_COORDS.pickup
      : BASE_COORDS.driverHome;
  const tripDistanceKm = isStarted ? 6.7 : 1.3;
  const tripDurationMin = isStarted ? 20 : isArrived ? 2 : 5;

  return {
    activeRole: 'driver',
    connecting: false,
    isSocketConnected: false,
    isSocketAuthenticated: false,
    socketError: null,
    lastError: null,
    selectedDestination: {
      name: 'Leblon',
      address: LABELS.destinationAddress,
      coordinate: BASE_COORDS.destination
    },
    selectedVehicle: 'Leaf Plus',
    selectedFare: 12.5,
    tripDistanceKm,
    tripDurationMin,
    tripArrivalText: `Chegada estimada em ${tripDurationMin} min`,
    paymentMethod: 'pix',
    currentAddress: LABELS.pickupAddress,
    currentCoordinate,
    driverCoordinate: currentCoordinate,
    driverActivation: buildApprovedDriverActivation(),
    driverActivationResolved: true,
    driverCanGoOnline: true
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
    pickupCoordinate: BASE_COORDS.pickup,
    dropoff: LABELS.destinationAddress,
    dropoffAddress: LABELS.destinationAddress,
    destinationCoordinate: BASE_COORDS.destination,
    fare: 12.5,
    grossFare: 12.5,
    totalAmount: 12.5,
    amount: 12.5,
    payout: 'R$ 10,80',
    driverNetAmount: 10.8,
    estimatedDriverNetAmount: 10.8,
    estimatedOperationalFee: 0.99,
    estimatedPaymentIntermediationFee: 0.71,
    estimatedTotalFees: 1.7,
    pricingSnapshotLocked: true,
    pricingSnapshotLockedAt: '2026-05-19T12:00:00.000Z',
    distanceKm: 1.3,
    tripDistanceKm: 6.7,
    pickupEtaMin: 5,
    tripDurationMin: 20,
    passengerRating: 4.9,
    expiresInSec: 18,
    eta: '6 min',
    paymentMethod: 'pix'
  };
}

function buildPassengerTripBase(status = 'started') {
  const normalizedStatus = String(status || 'started').trim().toLowerCase();
  const isAccepted = normalizedStatus === 'accepted';
  const isArrived = normalizedStatus === 'arrived';
  const isPickupPhase = isAccepted || isArrived;
  const routePlan = buildDriverRoutePlan();
  const activeRouteCoordinates = isPickupPhase
    ? routePlan.pickupCoordinates
    : routePlan.destinationCoordinates;
  const driverCoordinate = isPickupPhase
    ? { latitude: -22.9746, longitude: -43.1903 }
    : BASE_COORDS.pickup;
  const tripDistanceKm = isArrived ? 0.1 : isAccepted ? 1.2 : 5.1;
  const tripDurationMin = isArrived ? 2 : isAccepted ? 4 : 16;

  return {
    bookingStatus: normalizedStatus,
    activeBookingId: 'booking-proof-passenger-1',
    activeBooking: {
      bookingId: 'booking-proof-passenger-1',
      id: 'booking-proof-passenger-1',
      driverId: DRIVER_UID,
      driverName: 'Carlos Motorista Teste',
      status: normalizedStatus,
      pickupLocation: { ...BASE_COORDS.pickup, add: LABELS.pickupAddress },
      destinationLocation: { ...BASE_COORDS.destination, add: LABELS.destinationAddress },
      routePlan,
      routeCoordinates: activeRouteCoordinates,
      estimatedFare: 27.5,
      paymentMethod: 'pix',
      boardingPin: '4821'
    },
    selectedDestination: {
      name: 'Leblon',
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
    driverActiveRide: {
      ...buildDriverActiveRide(normalizedStatus),
      routePlan,
      routeCoordinates: activeRouteCoordinates,
    },
    driverInfo: {
      id: DRIVER_UID,
      name: 'Carlos Motorista Teste',
      plate: 'TES8888',
      model: 'Toyota Prius'
    },
    currentAddress: LABELS.pickupAddress
  };
}

function buildPassengerQuoteBase() {
  return {
    activeRole: 'customer',
    bookingStatus: 'idle',
    activeBookingId: null,
    activeBooking: null,
    quoteLock: null,
    selectedDestination: {
      name: 'Leblon',
      address: LABELS.destinationAddress,
      coordinate: BASE_COORDS.destination,
    },
    selectedVehicle: 'Leaf Plus',
    selectedFare: 22.43,
    tripDistanceKm: 2.8,
    tripDurationMin: 4,
    tripArrivalText: 'Chegada estimada em 4 min',
    paymentMethod: 'pix',
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

function scenarioPatch(name) {
  switch (name) {
    case 'passenger-home':
      return {
        bookingStatus: 'idle',
        activeBookingId: null,
        activeBooking: null,
        quoteLock: null,
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
        currentCoordinate: BASE_COORDS.destination,
        currentAddress: LABELS.pickupAddress,
        tripHistory: [buildPassengerReceipt()],
        lastReceipt: buildPassengerReceipt()
      };
    case 'passenger-booking':
    case 'passenger-payment':
      return buildPassengerQuoteBase();
    case 'passenger-searching':
    case 'passenger-requesting':
      return deepMerge(buildPassengerQuoteBase(), {
        bookingStatus: name === 'passenger-requesting' ? 'requesting' : 'searching',
        activeBookingId: 'booking-proof-searching-1',
        searchingElapsedSeconds: 4
      });
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
            name: 'Barra da Tijuca',
            address: LABELS.newDestinationAddress,
            coordinate: { latitude: -23.00037, longitude: -43.365895 }
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
          name: 'Leblon',
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
    case 'passenger-arrived':
      return deepMerge(buildPassengerTripBase('arrived'), {
        boardingRemainingSec: 120,
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
        currentCoordinate: BASE_COORDS.destination,
        driverCoordinate: BASE_COORDS.destination,
        currentAddress: LABELS.pickupAddress,
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
      return deepMerge(buildDriverRideContext('accepted'), {
        bookingStatus: 'searching',
        activeBookingId: 'booking-proof-offer-1',
        driverOnline: false,
        driverOnlinePending: false,
        driverOnlineMutationSource: 'qa_seed',
        driverOffers: [buildDriverOffer()],
        driverActiveRide: null,
        driverTripMeta: buildDriverTripMeta('accepted'),
        boardingRemainingSec: 0,
        rideExtension: { status: 'idle' },
        operationalContinuation: { status: 'idle' }
      });
    case 'driver-accepted':
      return deepMerge(buildDriverRideContext('accepted'), {
        bookingStatus: 'accepted',
        activeBookingId: 'booking-proof-driver-1',
        driverOnline: false,
        driverOnlinePending: false,
        driverOnlineMutationSource: 'qa_seed',
        driverOffers: [],
        driverActiveRide: buildDriverActiveRide('accepted'),
        driverTripMeta: buildDriverTripMeta('accepted'),
        boardingRemainingSec: 0
      });
    case 'driver-arrived':
      return deepMerge(buildDriverRideContext('arrived'), {
        bookingStatus: 'arrived',
        activeBookingId: 'booking-proof-driver-1',
        driverOnline: false,
        driverOnlinePending: false,
        driverOnlineMutationSource: 'qa_seed',
        driverOffers: [],
        driverActiveRide: buildDriverActiveRide('arrived'),
        driverTripMeta: buildDriverTripMeta('arrived'),
        boardingRemainingSec: 120
      });
    case 'driver-started':
      return deepMerge(buildDriverRideContext('started'), {
        bookingStatus: 'started',
        activeBookingId: 'booking-proof-driver-1',
        driverOnline: false,
        driverOnlinePending: false,
        driverOnlineMutationSource: 'qa_seed',
        driverOffers: [],
        driverActiveRide: buildDriverActiveRide('started'),
        driverTripMeta: buildDriverTripMeta('started'),
        boardingRemainingSec: 0
      });
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
  const passengerQuoteParams = () => {
    const params = new URLSearchParams({
      destination: 'Leblon',
      destinationAddress: LABELS.destinationAddress,
      destinationCoordinate: JSON.stringify(BASE_COORDS.destination),
      originAddress: LABELS.pickupAddress,
      vehicle: 'Leaf Plus',
      fare: '24.9',
      selectedFare: '24.9',
      initialSelectedPlan: 'plus',
    });
    return params.toString();
  };

  const passengerTripParams = (status) => {
    const trip = buildPassengerTripBase(status);
    const driver = trip.driverInfo || {};
    const activeBooking = trip.activeBooking || {};
    const params = new URLSearchParams({
      status,
      qaStatus: status,
      destination: 'Leblon',
      destinationAddress: LABELS.destinationAddress,
      destinationCoordinate: JSON.stringify(BASE_COORDS.destination),
      originAddress: LABELS.pickupAddress,
      pickupCoordinate: JSON.stringify(BASE_COORDS.pickup),
      driverCoordinate: JSON.stringify(trip.driverCoordinate || BASE_COORDS.pickupManeuver),
      driverName: driver.name || activeBooking.driverName || 'Carlos Motorista Teste',
      vehicle: 'Leaf Plus',
      vehicleModel: driver.model || activeBooking.vehicleModel || 'Toyota Prius',
      vehiclePlate: driver.plate || activeBooking.vehiclePlate || 'TES8888',
      vehicleColor: 'Prata',
      tripDistanceKm: String(trip.tripDistanceKm || 5.1),
      tripDurationMin: String(trip.tripDurationMin || 16),
      tripArrivalText: trip.tripArrivalText || 'Chegada estimada em 16 min',
      selectedFare: '27.5',
      fare: '27.5',
      passengerPaidAmount: '27.5',
      boardingPin: activeBooking.boardingPin || '4821',
    });
    return params.toString();
  };

  const passengerReceiptParams = (activeRole = 'customer') => {
    const receipt = buildPassengerReceipt();
    const params = new URLSearchParams({
      activeRole,
      receiptId: receipt.id,
      date: receipt.date,
      fare: String(receipt.fare),
      grossAmount: String(receipt.grossAmount),
      distanceKm: String(receipt.distanceKm),
      durationMin: String(receipt.durationMin),
      paymentMethod: receipt.paymentMethod,
      driverId: receipt.driverId,
      driverName: receipt.driverName,
      vehicleLabel: 'Toyota Prius prata · 4,9',
      vehiclePlate: 'TES8888',
      passengerId: receipt.passengerId,
      passengerName: receipt.passengerName,
      operationalFee: String(receipt.operationalFee),
      paymentIntermediationFee: String(receipt.paymentIntermediationFee),
      totalFees: String(receipt.totalFees),
      driverNetAmount: String(receipt.driverNetAmount),
      pickupAddress: receipt.pickup,
      destinationAddress: receipt.drop,
      pickupCoordinate: JSON.stringify(receipt.pickupCoordinate),
      destinationCoordinate: JSON.stringify(receipt.destinationCoordinate),
    });
    return params.toString();
  };

  const driverTripParams = (status, bookingId = 'booking-proof-driver-1', extra = {}) => {
    const isStartedTrip = String(status || '').trim().toLowerCase() === 'started';
    const qaDriverCoordinate = isStartedTrip
      ? BASE_COORDS.inTransit
      : { latitude: -22.9746, longitude: -43.1903 };
    const qaRouteCoordinates = isStartedTrip
      ? [BASE_COORDS.inTransit, BASE_COORDS.destination]
      : [qaDriverCoordinate, BASE_COORDS.pickup];
    const request = {
      bookingId,
      id: bookingId,
      status,
      passengerName: 'Leaf Passageiro Teste',
      passenger: 'Leaf Passageiro Teste',
      pickupAddress: LABELS.pickupAddress,
      pickup: LABELS.pickupAddress,
      pickupCoordinate: BASE_COORDS.pickup,
      dropoffAddress: LABELS.destinationAddress,
      dropoff: LABELS.destinationAddress,
      destinationCoordinate: BASE_COORDS.destination,
      driverCoordinate: qaDriverCoordinate,
      routeCoordinates: qaRouteCoordinates,
      fare: 12.5,
      grossFare: 12.5,
      driverNetAmount: 10.8,
      estimatedDriverNetAmount: 10.8,
      estimatedOperationalFee: 0.99,
      estimatedPaymentIntermediationFee: 0.71,
      estimatedTotalFees: 1.7,
      distanceKm: 1.3,
      tripDistanceKm: 6.7,
      pickupEtaMin: 5,
      tripDurationMin: 20,
      passengerRating: 4.9,
      pricingSnapshotLocked: true,
      ...extra
    };
    return `request=${encodeURIComponent(JSON.stringify(request))}`;
  };

  if (name === 'passenger-home' || name === 'driver-home') {
    return 'leafapp://robotaxi/home';
  }
  if (name === 'passenger-booking' || name === 'passenger-payment') {
    // Booking/payment deep links still resolve to standalone legacy surfaces.
    // QA must start from the current home runtime and reach the next surface
    // through the canonical interaction, never through those stale routes.
    return 'leafapp://robotaxi/home';
  }
  if (
    name === 'passenger-searching' ||
    name === 'passenger-requesting' ||
    name === 'passenger-extension' ||
    name === 'passenger-operational' ||
    name === 'passenger-accepted' ||
    name === 'passenger-arrived' ||
    name === 'passenger-started'
  ) {
    // Passenger lifecycle state is rendered by the current home runtime.
    // Opening robotaxi/trip would bypass it for the standalone legacy screen.
    return 'leafapp://robotaxi/home';
  }
  if (name === 'driver-offer') {
    return `leafapp://robotaxi/driver/offer?${driverTripParams('searching', 'booking-proof-offer-1', { expiresInSec: 18 })}&qaKeepVisible=1`;
  }
  if (name === 'driver-accepted' || name === 'driver-arrived' || name === 'driver-started') {
    const status = name.replace('driver-', '');
    return `leafapp://robotaxi/driver/trip?${driverTripParams(status)}`;
  }
  if (name === 'passenger-receipt') {
    return `leafapp://robotaxi/receipt?${passengerReceiptParams('customer')}`;
  }
  if (name === 'driver-receipt') {
    return `leafapp://robotaxi/receipt?${passengerReceiptParams('driver')}`;
  }
  return null;
}

async function main() {
  const deviceKey = String(arg('--device', '17pro')).toLowerCase();
  const scenario = String(arg('--scenario', 'passenger-home')).trim();
  const screenshotPath = arg('--screenshot', '');
  const skipLaunch = hasFlag('--skip-launch');
  const currentCoordinateOverride = parseCoordinateOverride(
    arg('--current-lat', ''),
    arg('--current-lng', '')
  );
  const currentAddressOverride = String(arg('--current-address', '')).trim();
  const destinationOverride = buildDestinationOverride(
    arg('--destination-name', ''),
    arg('--destination-address', ''),
    arg('--destination-lat', ''),
    arg('--destination-lng', '')
  );
  const artifactDir = path.resolve(
    arg(
      '--artifact-dir',
      screenshotPath ? path.dirname(path.resolve(screenshotPath)) : process.cwd()
    )
  );
  const defaultFreezeMs = defaultFreezeMsForScenario(scenario);
  const rawFreezeMs = arg('--freeze-ms', String(defaultFreezeMs));
  const parsedFreezeMs = Number(rawFreezeMs);
  const freezeMs = Math.max(
    0,
    Number.isFinite(parsedFreezeMs) ? parsedFreezeMs : defaultFreezeMs
  );
  const postLaunchWaitMs = Math.max(
    0,
    Number(arg('--post-launch-wait-ms', '0')) || 0
  );
  const skipSocketToken = hasFlag('--skip-socket-token');
  const deviceId = DEVICE_MAP[deviceKey] || deviceKey;
  const isDriverScenario = scenario.startsWith('driver-');
  const defaultUid = isDriverScenario ? DRIVER_UID : PASSENGER_UID;
  const uid = String(arg('--uid', defaultUid)).trim() || defaultUid;
  const dataContainer = getContainerData(deviceId);
  if (!skipLaunch) {
    runSimctlBestEffort(['terminate', deviceId, APP_ID]);
    sleep(500);
  }
  const runtimeFilePath = getRuntimeFilePath(dataContainer, uid);
  const qaSeedFilePath = getQaSeedFilePath(dataContainer, uid);
  const driverActivationFilePath = getDriverActivationFilePath(dataContainer, uid);
  const authUidFilePath = getAuthUidFilePath(dataContainer);
  const userDataFilePath = getUserDataFilePath(dataContainer);
  const testModeFilePath = getTestModeFilePath(dataContainer);
  const baseline = loadRuntimeSnapshot(runtimeFilePath);
  const nextSnapshot = deepMerge(baseline, scenarioPatch(scenario));
  if (currentCoordinateOverride) {
    nextSnapshot.currentCoordinate = currentCoordinateOverride;
    if (isDriverScenario) {
      nextSnapshot.driverCoordinate = currentCoordinateOverride;
    } else if (!nextSnapshot.driverCoordinate) {
      nextSnapshot.driverCoordinate = currentCoordinateOverride;
    }
  }
  if (currentAddressOverride) {
    nextSnapshot.currentAddress = currentAddressOverride;
  }
  if (destinationOverride) {
    nextSnapshot.selectedDestination = destinationOverride;
  }
  const route = scenarioRoute(scenario);
  const qaSeedSnapshot = {
    scenario,
    route,
    seededAt: Date.now(),
    freezeUntil: Date.now() + freezeMs
  };

  saveRuntimeSnapshot(runtimeFilePath, nextSnapshot);
  saveRuntimeSnapshot(qaSeedFilePath, qaSeedSnapshot);
  if (isDriverScenario) {
    saveRuntimeSnapshot(driverActivationFilePath, buildApprovedDriverActivation());
    saveAsyncStorageValue(
      dataContainer,
      `${DRIVER_ACTIVATION_STORAGE_PREFIX}${uid}`,
      buildApprovedDriverActivation()
    );
  }
  saveAsyncStorageValue(dataContainer, `${PREFIX}${uid}`, nextSnapshot);
  saveAsyncStorageValue(dataContainer, `${QA_PREFIX}${uid}`, qaSeedSnapshot);
  if (destinationOverride) {
    saveAsyncStorageValue(dataContainer, CONFIRMED_DESTINATIONS_STORAGE_KEY, [
      destinationOverride
    ]);
  }
  saveAsyncStorageValue(dataContainer, AUTH_UID_STORAGE_KEY, uid);
  saveAsyncStorageValue(
    dataContainer,
    USER_DATA_STORAGE_KEY,
    buildSeedUserData(uid, isDriverScenario)
  );
  saveAsyncStorageValue(dataContainer, TEST_MODE_STORAGE_KEY, 'true');
  if (!skipSocketToken) {
    const qaSocketIdToken = await getIdTokenForUid(uid);
    saveAsyncStorageValue(
      dataContainer,
      QA_SOCKET_ID_TOKEN_STORAGE_KEY,
      qaSocketIdToken
    );
  }
  fs.mkdirSync(artifactDir, { recursive: true });

  let launchPid = null;
  if (!skipLaunch) {
    const maxLaunchAttempts = 2;
    const simulatedLocation = formatSimctlLocationCoordinate(
      nextSnapshot.driverCoordinate || nextSnapshot.currentCoordinate,
    );

    for (let attempt = 1; attempt <= maxLaunchAttempts; attempt += 1) {
      const baselineCrash = latestCrashReport('Leaf');

      if (attempt > 1) {
        process.stderr.write(
          `[ios-seed][retry] restarting simulator runtime before retry ${attempt}/${maxLaunchAttempts}\n`
        );
        recoverSimulatorRuntime(deviceId);
      }

      ensureSimulatorReady(deviceId);
      runSimctlBestEffort(['terminate', deviceId, APP_ID]);
      runSimctlBestEffort(['privacy', deviceId, 'grant', 'location', APP_ID]);
      if (simulatedLocation) {
        runSimctlBestEffort(['location', deviceId, 'set', simulatedLocation]);
      }
      let launchOutput = '';
      try {
        launchOutput = runSimctl(['launch', deviceId, APP_ID]);
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
          runSimctl(['openurl', deviceId, route]);
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
  }

  if (screenshotPath) {
    if (postLaunchWaitMs > 0) {
      sleep(postLaunchWaitMs);
    }
    fs.mkdirSync(path.dirname(path.resolve(screenshotPath)), { recursive: true });
    runSimctl(['io', deviceId, 'screenshot', path.resolve(screenshotPath)]);
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, deviceId, scenario, screenshotPath: screenshotPath ? path.resolve(screenshotPath) : null, launchPid, skipLaunch }, null, 2)}\n`
  );
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
