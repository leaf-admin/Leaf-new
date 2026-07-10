#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const https = require('https');
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
const REALTIME_DRIVER_SCENARIOS = new Set(['driver-home']);
const ADB_BIN = resolveAdbBin();
const AUTH_FLOW_STALE_STORAGE_KEYS = [
  '@onboarding_data',
  '@onboarding_encrypted_data',
  '@onboarding_progress',
  '@onboarding_current_step',
  'onboarding_phone_validation',
  'onboarding_profile_selection',
  'onboarding_profile_data',
  'onboarding_driver_email',
  'onboarding_document_data',
  'onboarding_credentials',
];
const DEV_MENU_PREFERENCES_XML = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <boolean name="isOnboardingFinished" value="true" />
    <boolean name="showsAtLaunch" value="false" />
    <boolean name="showFab" value="false" />
    <boolean name="motionGestureEnabled" value="false" />
    <boolean name="touchGestureEnabled" value="false" />
    <boolean name="keyCommandsEnabled" value="false" />
</map>
`;

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

function defaultFreezeMsForScenario(scenario) {
  return REALTIME_DRIVER_SCENARIOS.has(String(scenario || '').trim())
    ? 0
    : DEFAULT_QA_FREEZE_MS;
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

function logSeed(message) {
  process.stderr.write(`[seed-android] ${message}\n`);
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

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function boundedNumber(value, fallback, min, max) {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(Math.max(finite, min), max);
}

function parseUrl(value) {
  try {
    return new URL(String(value || ''));
  } catch (_error) {
    return null;
  }
}

function extractDevClientBundleUrl(launchUrl) {
  const parsed = parseUrl(launchUrl);
  if (!parsed) {
    return null;
  }

  const nestedBundleUrl = parsed.searchParams.get('url');
  if (nestedBundleUrl) {
    return parseUrl(nestedBundleUrl);
  }

  if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
    return parsed;
  }

  return null;
}

function isLoopbackHost(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(
    String(hostname || '').trim().toLowerCase(),
  );
}

function resolveLocalMetroEndpoint(launchUrl) {
  const bundleUrl = extractDevClientBundleUrl(launchUrl);
  if (!bundleUrl || !isLoopbackHost(bundleUrl.hostname)) {
    return null;
  }

  const port = Number(bundleUrl.port || (bundleUrl.protocol === 'https:' ? '443' : '80'));
  if (!Number.isInteger(port) || port <= 0) {
    return null;
  }

  const statusUrl = new URL(bundleUrl.toString());
  statusUrl.pathname = '/status';
  statusUrl.search = '';
  statusUrl.hash = '';

  return {
    bundleUrl: bundleUrl.toString(),
    port,
    statusUrl: statusUrl.toString(),
  };
}

function requestText(url, timeoutMs) {
  return new Promise((resolve) => {
    const parsed = parseUrl(url);
    if (!parsed) {
      resolve({ ok: false, statusCode: 0, body: '', error: 'invalid_url' });
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(
      parsed,
      { method: 'GET', timeout: timeoutMs },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 300,
            statusCode: response.statusCode || 0,
            body,
            error: '',
          });
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });
    request.on('error', (error) => {
      resolve({ ok: false, statusCode: 0, body: '', error: error.message });
    });
    request.end();
  });
}

async function waitForLocalMetroReady(launchUrl, timeoutMs) {
  const endpoint = resolveLocalMetroEndpoint(launchUrl);
  if (!endpoint) {
    return null;
  }

  const startedAt = Date.now();
  let lastProbe = null;
  while (Date.now() - startedAt <= timeoutMs) {
    lastProbe = await requestText(endpoint.statusUrl, 1800);
    if (lastProbe.ok && /packager-status:running|running/i.test(lastProbe.body)) {
      logSeed(`[launch] Metro ready at ${endpoint.statusUrl}`);
      return endpoint;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  const detail = lastProbe?.error || `status=${lastProbe?.statusCode || 'unknown'}`;
  throw new Error(
    `Metro local nao respondeu em ${timeoutMs}ms (${endpoint.statusUrl}; ${detail}). ` +
      'Inicie o Metro ou ajuste --dev-client-url antes de abrir o dev-client.',
  );
}

function ensureAndroidMetroReverse(deviceId, launchUrl) {
  const endpoint = resolveLocalMetroEndpoint(launchUrl);
  if (!endpoint) {
    return null;
  }

  run(ADB_BIN, adbArgs(deviceId, ['wait-for-device']));
  const result = spawnSync(
    ADB_BIN,
    adbArgs(deviceId, ['reverse', `tcp:${endpoint.port}`, `tcp:${endpoint.port}`]),
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );

  if (result.status !== 0) {
    throw new Error(
      `Falha ao configurar adb reverse tcp:${endpoint.port}. ` +
        `${result.stderr || result.stdout || ''}`.trim(),
    );
  }

  logSeed(`[launch] adb reverse tcp:${endpoint.port} -> tcp:${endpoint.port} ok`);
  return endpoint;
}

function summarizeAmStartOutput(output) {
  const summary = String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^(Status|Activity|TotalTime|WaitTime|Complete|Warning|Error):/i.test(line))
    .join('; ');
  return summary || 'am start completed';
}

function startAndroidViewIntent(deviceId, launchUrl, label) {
  const amStartTimeoutMs = boundedNumber(
    arg('--am-start-timeout-ms', '45000'),
    45000,
    5000,
    120000,
  );
  const result = spawnSync(
    ADB_BIN,
    adbArgs(deviceId, [
      'shell',
      'am',
      'start',
      '-W',
      '--ez',
      'EXDevMenuDisableAutoLaunch',
      'true',
      '-a',
      'android.intent.action.VIEW',
      '-d',
      shellQuote(launchUrl),
      APP_ID,
    ]),
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 4, timeout: amStartTimeoutMs },
  );
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim();

  if (result.error) {
    throw new Error(`Timeout ao abrir ${label} no Android apos ${amStartTimeoutMs}ms.\n${output}`);
  }

  if (result.status !== 0) {
    throw new Error(`Falha ao abrir ${label} no Android.\n${output}`);
  }

  logSeed(`[launch] ${label}: ${summarizeAmStartOutput(output)}`);
  return output;
}

function dumpAndroidUi(deviceId) {
  const remoteDumpPath = `/data/local/tmp/leaf-qa-window-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.xml`;
  const dumpResult = spawnSync(
    ADB_BIN,
    adbArgs(deviceId, ['shell', 'uiautomator', 'dump', remoteDumpPath]),
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 4, timeout: 6000 },
  );
  if (dumpResult.status !== 0) {
    return '';
  }

  const catResult = spawnSync(
    ADB_BIN,
    adbArgs(deviceId, ['shell', 'cat', remoteDumpPath]),
    { encoding: 'utf8', maxBuffer: 1024 * 1024 * 4, timeout: 6000 },
  );
  spawnSync(ADB_BIN, adbArgs(deviceId, ['shell', 'rm', '-f', remoteDumpPath]), {
    encoding: 'utf8',
    timeout: 3000,
  });

  if (catResult.status !== 0) {
    return `${dumpResult.stdout || ''}${dumpResult.stderr || ''}`.replace(/\r/g, '');
  }

  return `${catResult.stdout || ''}${dumpResult.stdout || ''}${dumpResult.stderr || ''}`.replace(/\r/g, '');
}

function isLikelyExpoDevelopmentBuildScreen(uiDump) {
  return /Development Build|Recently opened|Open from Clipboard|Enter URL manually|No compatible development build|No development servers/i.test(
    String(uiDump || ''),
  );
}

function isLikelyAndroidAnrDialog(uiDump) {
  return /isn(?:'|&apos;|&#39;)?t responding|is not responding|Close app|Wait/i.test(
    String(uiDump || ''),
  );
}

function parseUiBounds(value) {
  const match = String(value || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) {
    return null;
  }

  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  if (![left, top, right, bottom].every(Number.isFinite)) {
    return null;
  }

  return { left, top, right, bottom };
}

function findUiNodeBounds(uiDump, textPattern) {
  const nodes = String(uiDump || '').match(/<node\b[^>]*>/g) || [];
  for (const node of nodes) {
    if (!textPattern.test(node)) {
      continue;
    }

    const boundsMatch = node.match(/\bbounds="([^"]+)"/);
    const bounds = parseUiBounds(boundsMatch?.[1]);
    if (bounds) {
      return bounds;
    }
  }

  return null;
}

function tapUiBounds(deviceId, bounds) {
  if (!bounds) {
    return false;
  }

  const x = Math.round((bounds.left + bounds.right) / 2);
  const y = Math.round((bounds.top + bounds.bottom) / 2);
  spawnSync(ADB_BIN, adbArgs(deviceId, ['shell', 'input', 'tap', String(x), String(y)]), {
    encoding: 'utf8',
    timeout: 5000,
  });
  return true;
}

function dismissAndroidAnrWaitDialog(deviceId, artifactDir, label = 'android-anr') {
  const uiDump = dumpAndroidUi(deviceId);
  if (!isLikelyAndroidAnrDialog(uiDump)) {
    return false;
  }

  const diagnosticPath = writeLaunchUiDiagnostic(deviceId, artifactDir, label, uiDump);
  const waitBounds = findUiNodeBounds(
    uiDump,
    /\b(text|content-desc)="Wait"|\btext="Aguardar"|\bcontent-desc="Aguardar"/i,
  );
  const tapped = tapUiBounds(deviceId, waitBounds);
  logSeed(
    `[launch][warn] Dialogo Android ANR detectado; ${tapped ? 'toquei em Wait' : 'nao encontrei o botao Wait'}; uiDump=${diagnosticPath}`,
  );
  return tapped;
}

function isLikelyAndroidTransientLoading(uiDump) {
  return /Bundling(?:\s+\d+(?:\.\d+)?%)?|Downloading|Loading JavaScript|Connecting to Metro|Reloading/i.test(
    String(uiDump || ''),
  );
}

function waitForAndroidTransientLoadingToClear(deviceId, artifactDir, timeoutMs) {
  if (!timeoutMs) {
    return true;
  }

  const startedAt = Date.now();
  let lastDump = '';
  let attempts = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    attempts += 1;
    if (dismissAndroidAnrWaitDialog(deviceId, artifactDir, `app-ready-android-anr-${attempts}`)) {
      sleep(1500);
    }

    lastDump = dumpAndroidUi(deviceId);
    if (!lastDump || !isLikelyAndroidTransientLoading(lastDump)) {
      return true;
    }

    sleep(1000);
  }

  const diagnosticPath = writeLaunchUiDiagnostic(
    deviceId,
    artifactDir,
    'app-ready-timeout',
    lastDump,
  );
  logSeed(
    `[launch][warn] UI ainda em estado transitorio apos ${timeoutMs}ms; uiDump=${diagnosticPath}`,
  );
  return false;
}

function defaultReadyTextsForScenario(scenario) {
  if (scenario === 'passenger-home') {
    return ['Para onde vamos?'];
  }
  if (scenario === 'driver-home') {
    return ['Ficar online', 'Meus ganhos'];
  }
  return [];
}

function defaultGoneTextsForScenario(scenario) {
  if (scenario === 'passenger-home' || scenario === 'driver-home') {
    return ['Bem vindo(a),'];
  }
  return [];
}

function waitForAndroidUiTextToAppear(deviceId, artifactDir, texts, timeoutMs) {
  const expectedTexts = (Array.isArray(texts) ? texts : [])
    .map((text) => String(text || '').trim())
    .filter(Boolean);
  if (!expectedTexts.length || !timeoutMs) {
    return true;
  }

  const startedAt = Date.now();
  let lastDump = '';

  while (Date.now() - startedAt <= timeoutMs) {
    lastDump = dumpAndroidUi(deviceId);
    if (expectedTexts.some((text) => lastDump.includes(text))) {
      return true;
    }
    sleep(1000);
  }

  const diagnosticPath = writeLaunchUiDiagnostic(
    deviceId,
    artifactDir,
    'ui-ready-timeout',
    lastDump,
  );
  logSeed(
    `[launch][warn] Nenhum texto de UI esperado apareceu apos ${timeoutMs}ms (${expectedTexts.join(
      ' | ',
    )}); uiDump=${diagnosticPath}`,
  );
  return false;
}

function waitForAndroidUiTextToDisappear(deviceId, artifactDir, texts, timeoutMs) {
  const blockedTexts = (Array.isArray(texts) ? texts : [])
    .map((text) => String(text || '').trim())
    .filter(Boolean);
  if (!blockedTexts.length || !timeoutMs) {
    return true;
  }

  const startedAt = Date.now();
  let lastDump = '';

  while (Date.now() - startedAt <= timeoutMs) {
    lastDump = dumpAndroidUi(deviceId);
    if (!blockedTexts.some((text) => lastDump.includes(text))) {
      return true;
    }
    sleep(1000);
  }

  const diagnosticPath = writeLaunchUiDiagnostic(
    deviceId,
    artifactDir,
    'ui-gone-timeout',
    lastDump,
  );
  logSeed(
    `[launch][warn] Texto de loading ainda visivel apos ${timeoutMs}ms (${blockedTexts.join(
      ' | ',
    )}); uiDump=${diagnosticPath}`,
  );
  return false;
}

function writeLaunchUiDiagnostic(deviceId, artifactDir, label, uiDump) {
  const diagnosticPath = path.join(artifactDir, `${label}-ui-dump.xml`);
  fs.mkdirSync(path.dirname(diagnosticPath), { recursive: true });
  fs.writeFileSync(diagnosticPath, uiDump || dumpAndroidUi(deviceId) || '');
  return diagnosticPath;
}

function waitForDevLauncherToClear(deviceId, timeoutMs) {
  const startedAt = Date.now();
  let lastDump = '';

  while (Date.now() - startedAt <= timeoutMs) {
    lastDump = dumpAndroidUi(deviceId);
    if (!lastDump || !isLikelyExpoDevelopmentBuildScreen(lastDump)) {
      return { cleared: true, elapsedMs: Date.now() - startedAt, lastDump };
    }
    sleep(1200);
  }

  return { cleared: false, elapsedMs: Date.now() - startedAt, lastDump };
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
      coordinate: BASE_COORDS.destination,
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
    driverCanGoOnline: true,
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
    paymentMethod: 'pix',
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
    routeCoordinates: [BASE_COORDS.pickup, BASE_COORDS.inTransit, BASE_COORDS.destination],
  };
}

function buildPassengerTripBase(status = 'started') {
  const normalizedStatus = String(status || 'started').trim().toLowerCase();
  const isAccepted = normalizedStatus === 'accepted';
  const isArrived = normalizedStatus === 'arrived';
  const isPickupPhase = isAccepted || isArrived;
  const driverCoordinate = isPickupPhase
    ? BASE_COORDS.pickupManeuver
    : BASE_COORDS.inTransit;
  const tripDistanceKm = isArrived ? 0.1 : isAccepted ? 1.2 : 5.1;
  const tripDurationMin = isArrived ? 2 : isAccepted ? 4 : 16;

  return {
    activeRole: 'customer',
    bookingStatus: normalizedStatus,
    activeBookingId: 'booking-proof-passenger-1',
    activeBooking: {
      bookingId: 'booking-proof-passenger-1',
      id: 'booking-proof-passenger-1',
      status: normalizedStatus,
      driverId: DRIVER_UID,
      driverName: 'Carlos Motorista Teste',
      pickupLocation: { ...BASE_COORDS.pickup, add: LABELS.pickupAddress },
      destinationLocation: { ...BASE_COORDS.destination, add: LABELS.destinationAddress },
      estimatedFare: 27.5,
      paymentMethod: 'pix',
      boardingPin: '4821',
      driverPhoto: '',
      vehicleModel: 'Toyota Prius',
      vehiclePlate: 'TES8888',
    },
    selectedDestination: {
      name: 'Leblon',
      address: LABELS.destinationAddress,
      coordinate: BASE_COORDS.destination,
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
      name: 'Carlos Motorista Teste',
      plate: 'TES8888',
      model: 'Toyota Prius',
      rating: 4.9,
    },
    currentCoordinate: BASE_COORDS.pickup,
    currentAddress: LABELS.pickupAddress,
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

function buildScenarioPatch(scenario) {
  if (scenario === 'passenger-home') {
    return {
      activeRole: 'customer',
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
      selectedFare: 15.06,
      selectedVehicle: 'Leaf Plus',
      driverInfo: null,
      driverCoordinate: null,
      driverActiveRide: null,
      searchingElapsedSeconds: 0,
      rideExtension: { status: 'idle' },
      operationalContinuation: { status: 'idle' },
      currentCoordinate: BASE_COORDS.destination,
      currentAddress: LABELS.pickupAddress,
    };
  }

  if (scenario === 'passenger-booking' || scenario === 'passenger-payment') {
    return buildPassengerQuoteBase();
  }

  if (scenario === 'passenger-searching' || scenario === 'passenger-requesting') {
    return {
      ...buildPassengerQuoteBase(),
      bookingStatus: scenario === 'passenger-requesting' ? 'requesting' : 'searching',
      activeBookingId: 'booking-proof-searching-1',
      searchingElapsedSeconds: 4,
    };
  }

  if (scenario === 'passenger-accepted') {
    return {
      ...buildPassengerTripBase('accepted'),
      rideExtension: { status: 'idle' },
      operationalContinuation: { status: 'idle' },
      boardingRemainingSec: 0,
    };
  }

  if (scenario === 'passenger-arrived') {
    return {
      ...buildPassengerTripBase('arrived'),
      rideExtension: { status: 'idle' },
      operationalContinuation: { status: 'idle' },
      boardingRemainingSec: 120,
    };
  }

  if (scenario === 'passenger-started') {
    return {
      ...buildPassengerTripBase('started'),
      rideExtension: { status: 'idle' },
      operationalContinuation: { status: 'idle' },
      boardingRemainingSec: 0,
    };
  }

  if (scenario === 'passenger-receipt') {
    return {
      activeRole: 'customer',
      bookingStatus: 'completed',
      activeBookingId: null,
      activeBooking: null,
      selectedDestination: {
        name: 'Leblon',
        address: LABELS.destinationAddress,
        coordinate: BASE_COORDS.destination,
      },
      tripHistory: [buildPassengerReceipt()],
      lastReceipt: buildPassengerReceipt(),
      rideExtension: { status: 'idle' },
      operationalContinuation: { status: 'idle' },
      currentCoordinate: BASE_COORDS.pickup,
      currentAddress: LABELS.pickupAddress,
    };
  }

  if (scenario === 'driver-receipt') {
    return {
      activeRole: 'driver',
      bookingStatus: 'completed',
      activeBookingId: null,
      activeBooking: null,
      tripHistory: [buildPassengerReceipt()],
      lastReceipt: {
        ...buildPassengerReceipt(),
        id: 'trip-driver-proof-1',
      },
      driverOnline: true,
      driverOnlinePending: false,
      driverOnlineMutationSource: 'qa_seed',
      driverActivation: buildApprovedDriverActivation(),
      driverActivationResolved: true,
      driverCanGoOnline: true,
      driverOffers: [],
      driverActiveRide: null,
      currentCoordinate: BASE_COORDS.destination,
      driverCoordinate: BASE_COORDS.destination,
      currentAddress: LABELS.destinationAddress,
      rideExtension: { status: 'idle' },
      operationalContinuation: { status: 'idle' },
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
      driverCoordinate: BASE_COORDS.destination,
      currentCoordinate: BASE_COORDS.destination,
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

  if (scenario === 'driver-offer') {
    return {
      ...buildDriverRideContext('accepted'),
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
      operationalContinuation: { status: 'idle' },
    };
  }

  const status =
    scenario === 'driver-started'
      ? 'started'
      : scenario === 'driver-arrived'
        ? 'arrived'
        : 'accepted';

  return {
    ...buildDriverRideContext(status),
    bookingStatus: status,
    activeBookingId: 'booking-proof-driver-1',
    driverOnline: false,
    driverOnlinePending: false,
    driverOnlineMutationSource: 'qa_seed',
    driverOffers: [],
    driverActiveRide: buildDriverActiveRide(status),
    driverTripMeta: buildDriverTripMeta(status),
    boardingRemainingSec: status === 'arrived' ? 120 : 0,
  };
}

function scenarioRoute(scenario) {
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

  if (scenario === 'driver-offer') {
    return `leafapp://robotaxi/driver/offer?${driverTripParams('searching', 'booking-proof-offer-1', { expiresInSec: 18 })}&qaKeepVisible=1`;
  }
  if (scenario === 'passenger-accepted' || scenario === 'passenger-arrived' || scenario === 'passenger-started') {
    // Passenger lifecycle state is rendered by the current home runtime.
    // Opening robotaxi/trip would bypass it for the standalone legacy screen.
    return 'leafapp://robotaxi/home';
  }
  if (scenario === 'passenger-booking' || scenario === 'passenger-payment') {
    // Booking/payment deep links still resolve to standalone legacy surfaces.
    // QA must start from the current home runtime and reach the next surface
    // through the canonical interaction, never through those stale routes.
    return 'leafapp://robotaxi/home';
  }
  if (scenario === 'passenger-receipt') {
    return `leafapp://robotaxi/receipt?${passengerReceiptParams('customer')}`;
  }
  if (scenario === 'driver-receipt') {
    return `leafapp://robotaxi/receipt?${passengerReceiptParams('driver')}`;
  }
  if (scenario === 'driver-accepted' || scenario === 'driver-arrived' || scenario === 'driver-started') {
    const status = scenario.replace('driver-', '');
    return `leafapp://robotaxi/driver/trip?${driverTripParams(status)}`;
  }
  return 'leafapp://robotaxi/home';
}

function sqliteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function buildStorageSql(entries, deleteKeys = []) {
  const statements = [
    'CREATE TABLE IF NOT EXISTS android_metadata (locale TEXT);',
    'DELETE FROM android_metadata;',
    "INSERT INTO android_metadata (locale) VALUES ('en_US');",
    'CREATE TABLE IF NOT EXISTS catalystLocalStorage (key TEXT PRIMARY KEY, value TEXT NOT NULL);',
    'PRAGMA user_version = 1;',
  ];

  deleteKeys.forEach((key) => {
    statements.push(`DELETE FROM catalystLocalStorage WHERE key = ${sqliteLiteral(key)};`);
  });

  entries.forEach(([key, value]) => {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    statements.push(
      `INSERT OR REPLACE INTO catalystLocalStorage (key, value) VALUES (${sqliteLiteral(key)}, ${sqliteLiteral(serialized)});`,
    );
  });

  return `${statements.join('\n')}\n`;
}

function writeAsyncStorage(deviceId, entries, deleteKeys = []) {
  const sql = buildStorageSql(entries, deleteKeys);
  spawnSync(
    ADB_BIN,
    adbArgs(deviceId, ['shell', 'run-as', APP_ID, 'mkdir', 'databases']),
    { encoding: 'utf8' },
  );
  let result = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    result = spawnSync(
      ADB_BIN,
      adbArgs(deviceId, ['shell', 'run-as', APP_ID, 'sqlite3', 'databases/RKStorage']),
      {
        input: sql,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 4,
      },
    );

    const output = `${result.stderr || ''}${result.stdout || ''}`;
    if (result.status === 0 || !/database is locked/i.test(output)) {
      break;
    }
    sleep(650 + attempt * 250);
  }

  if (!result || result.status !== 0) {
    const output = `${result?.stderr || ''}${result?.stdout || ''}`;
    if (/permission denied|not found|inaccessible/i.test(output)) {
      writeAsyncStorageViaRunAsCopy(deviceId, entries, deleteKeys);
      return;
    }

    throw new Error(
      `Falha ao gravar AsyncStorage Android. Use build debug/e2e para permitir run-as.\n${output}`,
    );
  }
}

function writeAsyncStorageViaRunAsCopy(deviceId, entries, deleteKeys = []) {
  const sql = buildStorageSql(entries, deleteKeys);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-android-run-as-storage-'));
  const tempDbPath = path.join(tempDir, 'RKStorage');
  const remoteTempDbPath = `/data/local/tmp/leaf-rkstorage-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.db`;

  try {
    const localResult = spawnSync('sqlite3', [tempDbPath], {
      input: sql,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 4,
    });

    if (localResult.status !== 0) {
      throw new Error(`Falha ao criar SQLite local.\n${localResult.stderr || localResult.stdout}`);
    }

    run(ADB_BIN, adbArgs(deviceId, ['push', tempDbPath, remoteTempDbPath]));
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'chmod', '644', remoteTempDbPath]));
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'run-as', APP_ID, 'mkdir', '-p', 'databases']));
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'run-as', APP_ID, 'cp', remoteTempDbPath, 'databases/RKStorage']));
    run(
      ADB_BIN,
      adbArgs(deviceId, [
        'shell',
        'run-as',
        APP_ID,
        'rm',
        '-f',
        'databases/RKStorage-journal',
        'databases/RKStorage-wal',
        'databases/RKStorage-shm',
      ]),
    );
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'rm', '-f', remoteTempDbPath]));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function writeAsyncStorageRoot(deviceId, entries, deleteKeys = []) {
  const databaseDir = `/data/data/${APP_ID}/databases`;
  const databasePath = `${databaseDir}/RKStorage`;
  const sql = buildStorageSql(entries, deleteKeys);

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
  const appDataContext = run(
    ADB_BIN,
    adbArgs(deviceId, ['shell', 'stat', '-c', '%C', `/data/data/${APP_ID}`]),
  ).trim();

  if (owner) {
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'chown', '-R', owner, databaseDir]));
  }
  if (appDataContext) {
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'chcon', appDataContext, databasePath]));
  }
  run(ADB_BIN, adbArgs(deviceId, ['shell', 'chmod', '700', databaseDir]));
  run(ADB_BIN, adbArgs(deviceId, ['shell', 'chmod', '600', databasePath]));
}

function suppressAndroidDevMenu(deviceId) {
  const sharedPrefsDir = `/data/data/${APP_ID}/shared_prefs`;
  const prefsPath = `${sharedPrefsDir}/expo.modules.devmenu.sharedpreferences.xml`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-android-devmenu-'));
  const tempPrefsPath = path.join(tempDir, 'expo.modules.devmenu.sharedpreferences.xml');

  try {
    fs.writeFileSync(tempPrefsPath, DEV_MENU_PREFERENCES_XML);
    run(ADB_BIN, adbArgs(deviceId, ['root']));
    run(ADB_BIN, adbArgs(deviceId, ['wait-for-device']));
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'mkdir', '-p', sharedPrefsDir]));
    run(ADB_BIN, adbArgs(deviceId, ['push', tempPrefsPath, prefsPath]));

    const owner = run(
      ADB_BIN,
      adbArgs(deviceId, ['shell', 'stat', '-c', '%u:%g', `/data/data/${APP_ID}`]),
    ).trim();
    const appDataContext = run(
      ADB_BIN,
      adbArgs(deviceId, ['shell', 'stat', '-c', '%C', `/data/data/${APP_ID}`]),
    ).trim();

    if (owner) {
      run(ADB_BIN, adbArgs(deviceId, ['shell', 'chown', '-R', owner, sharedPrefsDir]));
    }
    if (appDataContext) {
      run(ADB_BIN, adbArgs(deviceId, ['shell', 'chcon', appDataContext, prefsPath]));
    }
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'chmod', '700', sharedPrefsDir]));
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'chmod', '660', prefsPath]));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
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

function clearAndroidNotifications(deviceId) {
  spawnSync(
    ADB_BIN,
    adbArgs(deviceId, ['shell', 'cmd', 'notification', 'cancel-all']),
    { encoding: 'utf8' },
  );
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
  const defaultFreezeMs = defaultFreezeMsForScenario(scenario);
  const parsedFreezeMs = Number(arg('--freeze-ms', String(defaultFreezeMs)));
  const freezeMs = Math.max(
    0,
    Number.isFinite(parsedFreezeMs) ? parsedFreezeMs : defaultFreezeMs
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
  const noForceStop = hasFlag('--no-force-stop');
  const devClientUrl = String(arg('--dev-client-url', '')).trim();
  const snapshot = buildScenarioPatch(scenario);
  const route = scenarioRoute(scenario);
  const currentLatArg = arg('--current-lat', null);
  const currentLngArg = arg('--current-lng', null);
  const hasCurrentCoordinateOverride =
    currentLatArg !== null &&
    currentLngArg !== null &&
    String(currentLatArg).trim() !== '' &&
    String(currentLngArg).trim() !== '';
  const currentLat = Number(currentLatArg);
  const currentLng = Number(currentLngArg);
  const currentAddress = String(arg('--current-address', '')).trim();
  if (hasCurrentCoordinateOverride && Number.isFinite(currentLat) && Number.isFinite(currentLng)) {
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
    route,
    seededAt: Date.now(),
    freezeUntil: Date.now() + freezeMs,
  };

  fs.mkdirSync(artifactDir, { recursive: true });

  if (hasFlag('--clear')) {
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'pm', 'clear', APP_ID]));
  }

  if (!noForceStop) {
    run(ADB_BIN, adbArgs(deviceId, ['shell', 'am', 'force-stop', APP_ID]));
  }
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
    writeAsyncStorageRoot(deviceId, storageEntries, AUTH_FLOW_STALE_STORAGE_KEYS);
  } else {
    writeAsyncStorage(deviceId, storageEntries, AUTH_FLOW_STALE_STORAGE_KEYS);
  }
  try {
    suppressAndroidDevMenu(deviceId);
  } catch (error) {
    console.warn(
      `[seed-android][warn] Nao foi possivel suprimir o onboarding do Dev Client: ${error.message}`,
    );
  }

  let launchOutput = '';
  if (!hasFlag('--skip-launch')) {
    setAndroidEmulatorLocation(deviceId, snapshot.driverCoordinate || snapshot.currentCoordinate);
    const launchUrl = devClientUrl || route;
    const totalCaptureDelayMs = Math.min(Math.max(freezeMs, 5000), 36000);
    const launchOutputs = [];
    const skipMetroReverse = hasFlag('--skip-metro-reverse');
    const metroReadyTimeoutMs = boundedNumber(
      arg('--metro-ready-timeout-ms', '15000'),
      15000,
      0,
      60000,
    );
    const devClientLaunchTimeoutMs = boundedNumber(
      arg('--dev-client-launch-timeout-ms', '16000'),
      16000,
      3000,
      45000,
    );
    const maxDevClientLaunchAttempts = devClientUrl
      ? Math.round(boundedNumber(arg('--dev-client-launch-attempts', '2'), 2, 1, 3))
      : 1;

    if (devClientUrl && !hasFlag('--skip-metro-ready-check')) {
      await waitForLocalMetroReady(devClientUrl, metroReadyTimeoutMs);
    }

    for (let attempt = 1; attempt <= maxDevClientLaunchAttempts; attempt += 1) {
      if (attempt > 1) {
        logSeed(`[launch][retry] reabrindo dev-client (${attempt}/${maxDevClientLaunchAttempts})`);
      }

      if (devClientUrl && !skipMetroReverse) {
        ensureAndroidMetroReverse(deviceId, devClientUrl);
      }

      launchOutputs.push(
        startAndroidViewIntent(
          deviceId,
          launchUrl,
          devClientUrl ? `dev-client (${attempt}/${maxDevClientLaunchAttempts})` : 'route',
        ),
      );

      if (!devClientUrl || route === devClientUrl) {
        sleep(totalCaptureDelayMs);
        break;
      }

      const routeWarmupMs =
        scenario === 'driver-offer'
          ? Math.min(Math.max(freezeMs - 4000, 9000), 14000)
          : boundedNumber(arg('--route-warmup-ms', '12000'), 12000, 5000, 24000);
      sleep(routeWarmupMs);

      if (!skipMetroReverse) {
        ensureAndroidMetroReverse(deviceId, devClientUrl);
      }

      launchOutputs.push(
        startAndroidViewIntent(
          deviceId,
          route,
          `route ${scenario} (${attempt}/${maxDevClientLaunchAttempts})`,
        ),
      );

      const routeSettleBudgetMs = Math.max(3000, totalCaptureDelayMs - routeWarmupMs);
      const launcherState = waitForDevLauncherToClear(
        deviceId,
        Math.min(devClientLaunchTimeoutMs, routeSettleBudgetMs),
      );

      if (!launcherState.cleared) {
        const diagnosticPath = writeLaunchUiDiagnostic(
          deviceId,
          artifactDir,
          `dev-client-launch-attempt-${attempt}`,
          launcherState.lastDump,
        );
        logSeed(
          `[launch][warn] Expo Development Build ainda visivel apos ${launcherState.elapsedMs}ms; uiDump=${diagnosticPath}`,
        );

        if (attempt < maxDevClientLaunchAttempts) {
          run(ADB_BIN, adbArgs(deviceId, ['shell', 'am', 'force-stop', APP_ID]));
          sleep(1200);
          continue;
        }

        throw new Error(
          `Dev-client Android nao saiu da tela Expo Development Build apos ${maxDevClientLaunchAttempts} tentativa(s). ` +
            `Diagnostico: ${diagnosticPath}`,
        );
      }

      sleep(Math.max(0, routeSettleBudgetMs - launcherState.elapsedMs));
      break;
    }

    launchOutput = launchOutputs.join('\n');
  }

  if (dismissAndroidAnrWaitDialog(deviceId, artifactDir, 'pre-screenshot-android-anr')) {
    sleep(3000);
    dismissAndroidAnrWaitDialog(deviceId, artifactDir, 'pre-screenshot-android-anr-recheck');
  }

  const appReadyTimeoutMs = boundedNumber(
    arg('--app-ready-timeout-ms', '30000'),
    30000,
    0,
    90000,
  );
  waitForAndroidTransientLoadingToClear(deviceId, artifactDir, appReadyTimeoutMs);
  const explicitReadyText = String(arg('--wait-for-text', '') || '').trim();
  const readyTexts = explicitReadyText
    ? explicitReadyText.split('|').map((text) => text.trim())
    : defaultReadyTextsForScenario(scenario);
  const uiReadyTimeoutMs = boundedNumber(
    arg('--ui-ready-timeout-ms', '25000'),
    25000,
    0,
    90000,
  );
  waitForAndroidUiTextToAppear(deviceId, artifactDir, readyTexts, uiReadyTimeoutMs);
  const explicitGoneText = String(arg('--wait-for-text-gone', '') || '').trim();
  const goneTexts = explicitGoneText
    ? explicitGoneText.split('|').map((text) => text.trim())
    : defaultGoneTextsForScenario(scenario);
  waitForAndroidUiTextToDisappear(deviceId, artifactDir, goneTexts, uiReadyTimeoutMs);
  const postUiReadySettleMs = boundedNumber(
    arg('--post-ui-ready-settle-ms', '2500'),
    2500,
    0,
    15000,
  );
  sleep(postUiReadySettleMs);
  clearAndroidNotifications(deviceId);
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
