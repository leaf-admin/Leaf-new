#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../../..');
const MOBILE_DIR = path.join(ROOT_DIR, 'mobile-app');
const APP_ID = 'br.com.leaf.ride';
const DEFAULT_SIMCTL_BIN =
  '/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl';
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const ENV_FILES = ['.env', '.env.local', '.env.production', '.env.production.local'];

const CANONICAL_DEBUG_FLAGS = [
  'EXPO_PUBLIC_E2E_TEST',
  'EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS',
  'EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW',
  'EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK',
  'LEAF_DISABLE_UPDATES_FOR_SIMULATOR',
  'LEAF_INCLUDE_DEV_CLIENT',
  'EXPO_PUBLIC_LEAF_LAUNCH_PROFILE',
  'EXPO_PUBLIC_ENABLE_DRIVER_WITHDRAWALS',
  'EXPO_PUBLIC_ENABLE_REFERRAL_PROGRAMS',
  'EXPO_PUBLIC_ENABLE_LEAF_DELAS',
  'EXPO_PUBLIC_ENABLE_DRIVER_DESTINATION_MODE',
  'EXPO_PUBLIC_ENABLE_DYNAMIC_PRICING',
  'EXPO_PUBLIC_ENABLE_SMART_PUSH',
  'EXPO_PUBLIC_FORCE_PAYMENT_BYPASS',
  'EXPO_PUBLIC_BYPASS_PAYMENTS',
];

const REQUIRED_ENDPOINT_KEYS = [
  'EXPO_PUBLIC_API_URL',
  'EXPO_PUBLIC_BACKEND_URL',
  'EXPO_PUBLIC_WS_URL',
  'EXPO_PUBLIC_SOCKET_URL',
  'EXPO_PUBLIC_DASHBOARD_URL',
];

function readArg(flag, fallback = '') {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return fallback;
  }
  return process.argv[index + 1] || fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function normalizeFlag(value) {
  return TRUTHY.has(String(value ?? '').trim().toLowerCase());
}

function stripQuotes(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return raw;
  }
  const first = raw[0];
  const last = raw[raw.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return raw.slice(1, -1);
  }
  return raw;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const parsed = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const separator = normalized.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = normalized.slice(0, separator).trim();
    const value = stripQuotes(normalized.slice(separator + 1));
    if (key) {
      parsed[key] = value;
    }
  }

  return parsed;
}

function loadMobileEnv() {
  const values = {};
  const sources = {};

  for (const fileName of ENV_FILES) {
    const filePath = path.join(MOBILE_DIR, fileName);
    const parsed = parseEnvFile(filePath);
    for (const [key, value] of Object.entries(parsed)) {
      if (values[key] === undefined) {
        values[key] = value;
        sources[key] = fileName;
      }
    }
  }

  for (const [key, value] of Object.entries(process.env)) {
    if (values[key] === undefined) {
      values[key] = value;
      sources[key] = 'process';
    }
  }

  if (!values.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY && values.GOOGLE_MAPS_API_KEY) {
    values.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = values.GOOGLE_MAPS_API_KEY;
    sources.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY = sources.GOOGLE_MAPS_API_KEY || 'derived';
  }

  return { values, sources };
}

function summarizeEnv(env, keys) {
  return keys.map((key) => {
    const value = env.values[key];
    const isBooleanish =
      /^(EXPO_PUBLIC_ENABLE_|EXPO_PUBLIC_FORCE_|EXPO_PUBLIC_BYPASS_|LEAF_DISABLE_|LEAF_INCLUDE_|APP_REVIEW|EXPO_PUBLIC_E2E_TEST)/.test(
        key,
      );

    return {
      key,
      present: value !== undefined && value !== '',
      source: env.sources[key] || '',
      booleanValue: isBooleanish ? normalizeFlag(value) : undefined,
      valuePreview:
        value && !/(TOKEN|SECRET|KEY|PASSWORD|URL|WS|SOCKET|BACKEND|DASHBOARD)/i.test(key)
          ? String(value).slice(0, 80)
          : undefined,
    };
  });
}

function commandExists(command) {
  const result = spawnSync('/bin/zsh', ['-lc', `command -v ${JSON.stringify(command)}`], {
    encoding: 'utf8',
    timeout: 3000,
  });
  return result.status === 0 ? result.stdout.trim() : '';
}

function resolveAdbBin() {
  const candidates = [
    process.env.ADB_BIN,
    path.join(process.env.ANDROID_HOME || '', 'platform-tools', 'adb'),
    path.join(process.env.ANDROID_SDK_ROOT || '', 'platform-tools', 'adb'),
    path.join(os.homedir(), 'Android', 'Sdk', 'platform-tools', 'adb'),
    path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
    commandExists('adb'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return '';
}

function resolveSimctlBin() {
  const xcrunSimctl = spawnSync('/bin/zsh', ['-lc', 'DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer xcrun --find simctl'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  const resolved = xcrunSimctl.status === 0 ? xcrunSimctl.stdout.trim() : '';
  if (resolved && fs.existsSync(resolved)) {
    return resolved;
  }
  if (fs.existsSync(DEFAULT_SIMCTL_BIN)) {
    return DEFAULT_SIMCTL_BIN;
  }
  return '';
}

function run(command, args, options = {}) {
  if (!command) {
    return {
      ok: false,
      status: 127,
      stdout: '',
      stderr: 'command missing',
    };
  }

  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeout || 10000,
    cwd: options.cwd || ROOT_DIR,
    env: options.env || process.env,
  });

  return {
    ok: result.status === 0,
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
  };
}

function requestUrl(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      resolve({ ok: false, status: 0, error: `invalid url: ${error.message}` });
      return;
    }

    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(
      parsed,
      {
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          accept: 'application/json,text/plain,*/*',
          'user-agent': 'leaf-current-flow-e2e-lab',
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(body);
          } catch (_error) {
            json = null;
          }
          resolve({
            ok: response.statusCode >= 200 && response.statusCode < 400,
            status: response.statusCode,
            bodyPreview: json ? undefined : body.slice(0, 240),
            json,
          });
        });
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error(`timeout after ${timeoutMs}ms`));
    });
    request.on('error', (error) => {
      resolve({ ok: false, status: 0, error: error.message });
    });
    request.end();
  });
}

function parseAndroidDevices(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\t(device|offline|unauthorized)$/.test(line))
    .map((line) => {
      const [id, state] = line.split(/\s+/);
      return { id, state };
    });
}

function parseBootedIosDevices(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\(Booted\)/.test(line))
    .map((line) => {
      const match = line.match(/^(.+?)\s+\(([0-9A-F-]+)\)\s+\(Booted\)/i);
      return match ? { name: match[1].trim(), udid: match[2].trim(), state: 'Booted' } : { raw: line };
    });
}

function statArtifact(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      path: filePath,
      exists: false,
    };
  }

  const stat = fs.statSync(filePath);
  return {
    path: filePath,
    exists: true,
    sizeBytes: stat.isDirectory() ? null : stat.size,
    modifiedAt: stat.mtime.toISOString(),
    ageMinutes: Math.round((Date.now() - stat.mtime.getTime()) / 60000),
  };
}

function extractNavigatorRoutes() {
  const sourcePath = path.join(MOBILE_DIR, 'src', 'navigation', 'AppNavigator.js');
  const source = fs.existsSync(sourcePath) ? fs.readFileSync(sourcePath, 'utf8') : '';
  const routeMatches = [...source.matchAll(/name=["'](Robotaxi[^"']+)["']/g)];
  const linkingMatches = [...source.matchAll(/(Robotaxi[A-Za-z0-9]+):\s+['"]([^'"]+)['"]/g)];

  return {
    registeredPrototypeRoutes: [...new Set(routeMatches.map((match) => match[1]))].sort(),
    deepLinks: linkingMatches
      .map((match) => ({ route: match[1], path: match[2] }))
      .sort((a, b) => a.route.localeCompare(b.route)),
  };
}

function extractPrototypeTestIds() {
  const searchRoots = [
    path.join(MOBILE_DIR, 'src', 'screens', 'prototype'),
    path.join(MOBILE_DIR, 'src', 'components', 'prototype'),
  ];
  const ids = new Set();
  for (const root of searchRoots) {
    if (!fs.existsSync(root)) {
      continue;
    }
    const stack = [root];
    while (stack.length) {
      const current = stack.pop();
      const stat = fs.statSync(current);
      if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(current)) {
          stack.push(path.join(current, entry));
        }
        continue;
      }
      if (!current.endsWith('.js')) {
        continue;
      }
      const source = fs.readFileSync(current, 'utf8');
      for (const match of source.matchAll(/testID=["']([^"']+)["']/g)) {
        ids.add(match[1]);
      }
    }
  }

  return [...ids].sort();
}

function buildFindings({ envSummary, backend, devices, artifacts, metro }) {
  const findings = [];
  const envByKey = new Map(envSummary.map((item) => [item.key, item]));
  const runtimeFlags = backend.runtimeFlags?.json || {};
  const guards = runtimeFlags.guards || {};

  for (const key of REQUIRED_ENDPOINT_KEYS) {
    if (!envByKey.get(key)?.present) {
      findings.push({ severity: 'blocker', code: `missing_${key}`, message: `${key} nao esta definido no ambiente mobile.` });
    }
  }

  if (!backend.health?.ok) {
    findings.push({ severity: 'blocker', code: 'backend_health_unreachable', message: 'API /health nao respondeu com sucesso.' });
  }

  if (!backend.runtimeFlags?.ok) {
    findings.push({
      severity: 'blocker',
      code: 'runtime_flags_unreachable',
      message: 'API /health/runtime-flags nao respondeu com sucesso.',
    });
  }

  if (guards.requirePaymentBeforeBooking && !guards.mockPaymentForTests && !guards.paymentForceBypass) {
    findings.push({
      severity: 'decision',
      code: 'payment_strategy_required',
      message:
        'Backend exige pagamento confirmado antes da reserva. O E2E atual precisa rodar Pix sandbox real ou um ambiente QA com bypass explicitamente ligado.',
    });
  }

  if (guards.authTestOtpBypassEnabled === false) {
    findings.push({
      severity: 'decision',
      code: 'backend_test_otp_bypass_off',
      message:
        'Runtime flags informam authTestOtpBypassEnabled=false. Para login UI automatizado, validar se custom OTP dos telefones QA esta habilitado por endpoint ou ligar ambiente QA.',
    });
  }

  if (!devices.android.some((device) => device.state === 'device')) {
    findings.push({ severity: 'warn', code: 'no_android_device', message: 'Nenhum Android em estado device foi detectado.' });
  }

  if (!devices.ios.length) {
    findings.push({ severity: 'warn', code: 'no_ios_booted', message: 'Nenhum simulador iOS bootado foi detectado.' });
  }

  if (!artifacts.androidDebug.exists) {
    findings.push({ severity: 'blocker', code: 'missing_android_debug_apk', message: 'APK debug local ainda nao existe.' });
  }

  if (!artifacts.iosDebug.exists) {
    findings.push({ severity: 'blocker', code: 'missing_ios_debug_app', message: 'Build debug iOS simulator ainda nao existe.' });
  }

  if (!metro.ok) {
    findings.push({ severity: 'warn', code: 'metro_not_confirmed', message: 'Metro nao respondeu em http://127.0.0.1:8081/status.' });
  }

  return findings;
}

function writeReport(report, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'current-flow-e2e-doctor.json');
  const mdPath = path.join(outDir, 'current-flow-e2e-doctor.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [];
  lines.push('# Current Flow E2E Doctor');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push('');
  lines.push('## Status');
  lines.push('');
  for (const finding of report.findings) {
    lines.push(`- ${finding.severity.toUpperCase()}: ${finding.code} - ${finding.message}`);
  }
  if (!report.findings.length) {
    lines.push('- OK: nenhum bloqueio encontrado no doctor.');
  }
  lines.push('');
  lines.push('## Canonical Debug Env');
  lines.push('');
  lines.push('- `EXPO_PUBLIC_E2E_TEST=1`');
  lines.push('- `EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS=1`');
  lines.push('- `EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW=1`');
  lines.push('- `EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK=1`');
  lines.push('- `LEAF_DISABLE_UPDATES_FOR_SIMULATOR=1`');
  lines.push('- `LEAF_INCLUDE_DEV_CLIENT=1`');
  lines.push('- Payment: escolher explicitamente `Pix sandbox real` ou `EXPO_PUBLIC_FORCE_PAYMENT_BYPASS=1` com backend QA preparado.');
  lines.push('');
  lines.push('## Devices');
  lines.push('');
  lines.push(`- Android: ${report.devices.android.map((d) => `${d.id} (${d.state})`).join(', ') || 'nenhum'}`);
  lines.push(`- iOS booted: ${report.devices.ios.map((d) => `${d.name || 'iPhone'} ${d.udid}`).join(', ') || 'nenhum'}`);
  lines.push('');
  lines.push('## Next Manual E2E Sequence');
  lines.push('');
  lines.push('1. Parar Metro antigo e iniciar Metro com as flags canonicas de debug.');
  lines.push('2. Gerar build debug Android e iOS a partir da arvore atual.');
  lines.push('3. Instalar APK debug no Android e `.app` debug nos simuladores iOS.');
  lines.push('4. Abrir passageiro e motorista com contas QA distintas.');
  lines.push('5. Interagir via simulador/computer-use: login, motorista online, passageiro escolhe destino, categoria, Pix, busca, aceite, chegada, embarque, finalizacao, recibo e avaliacao.');
  lines.push('6. Gravar tela e capturar runtime state entre estados; sem Maestro como orquestrador principal.');
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);

  return { jsonPath, mdPath };
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '');
  const outDir = path.resolve(readArg('--out-dir', path.join(MOBILE_DIR, 'test-results', 'current-flow-e2e', timestamp)));
  const env = loadMobileEnv();
  const adbBin = resolveAdbBin();
  const simctlBin = resolveSimctlBin();
  const apiBaseUrl = String(env.values.EXPO_PUBLIC_API_URL || env.values.EXPO_PUBLIC_BACKEND_URL || '').replace(/\/+$/, '');
  const socketBaseUrl = String(env.values.EXPO_PUBLIC_WS_URL || env.values.EXPO_PUBLIC_SOCKET_URL || '').replace(/\/+$/, '');

  const androidDevices = parseAndroidDevices(run(adbBin, ['devices']).stdout);
  const iosDevices = parseBootedIosDevices(run(simctlBin, ['list', 'devices', 'booted']).stdout);
  const metro = await requestUrl('http://127.0.0.1:8081/status', 3000);
  const health = apiBaseUrl ? await requestUrl(`${apiBaseUrl}/health`) : { ok: false, error: 'missing api url' };
  const runtimeFlags = apiBaseUrl
    ? await requestUrl(`${apiBaseUrl}/health/runtime-flags`)
    : { ok: false, error: 'missing api url' };
  const socketProbe = socketBaseUrl
    ? await requestUrl(`${socketBaseUrl}/socket.io/?EIO=4&transport=polling`)
    : { ok: false, error: 'missing socket url' };

  const envSummary = summarizeEnv(env, [...REQUIRED_ENDPOINT_KEYS, ...CANONICAL_DEBUG_FLAGS]);
  const artifacts = {
    androidDebug: statArtifact(path.join(MOBILE_DIR, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')),
    iosDebug: statArtifact(path.join(MOBILE_DIR, 'ios', 'build', 'Build', 'Products', 'Debug-iphonesimulator', 'Leaf.app')),
    iosReleaseSimulator: statArtifact(
      path.join(MOBILE_DIR, 'ios', 'build', 'Build', 'Products', 'Release-iphonesimulator', 'Leaf.app'),
    ),
  };

  const devices = {
    android: androidDevices,
    ios: iosDevices,
  };
  const backend = {
    health,
    runtimeFlags,
    socketProbe,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    appId: APP_ID,
    tools: {
      adbBin: adbBin || null,
      simctlBin: simctlBin || null,
    },
    env: envSummary,
    devices,
    metro,
    backend,
    artifacts,
    navigation: extractNavigatorRoutes(),
    prototypeTestIds: extractPrototypeTestIds(),
    findings: [],
  };
  report.findings = buildFindings({ envSummary, backend, devices, artifacts, metro });

  const paths = writeReport(report, outDir);
  const strict = hasFlag('--strict');

  if (hasFlag('--json')) {
    process.stdout.write(`${JSON.stringify({ ...report, paths }, null, 2)}\n`);
  } else {
    process.stdout.write(`current-flow-e2e doctor written:\n${paths.jsonPath}\n${paths.mdPath}\n`);
    for (const finding of report.findings) {
      process.stdout.write(`[${finding.severity}] ${finding.code}: ${finding.message}\n`);
    }
  }

  if (strict && report.findings.some((finding) => finding.severity === 'blocker')) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
