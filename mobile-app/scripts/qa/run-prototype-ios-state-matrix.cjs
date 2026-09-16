#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT_DIR = path.resolve(__dirname, '../../..');
const MOBILE_DIR = path.join(ROOT_DIR, 'mobile-app');
const IOS_SEED_SCRIPT = path.join(MOBILE_DIR, 'scripts/qa/seed-prototype-ios-state.cjs');
const {
  getContainerData,
  scenarioRoute,
  writeRuntimeDebugHistoryArtifact,
} = require(IOS_SEED_SCRIPT);
const APP_ID = 'br.com.leaf.ride';
const SIMCTL_BIN =
  process.env.SIMCTL_BIN ||
  '/Library/Developer/PrivateFrameworks/CoreSimulator.framework/Versions/A/Resources/bin/simctl';
const ASSERT_FLOW = path.join(
  MOBILE_DIR,
  '.maestro/flows/qa/ui-ux-lifecycle-state-assert-ios.yaml',
);
const APP_READY_FLOW = path.join(
  MOBILE_DIR,
  '.maestro/flows/qa/boot-app-ready-ios.yaml',
);
const QA_SESSION_BOOTSTRAP_FLOW = path.join(
  MOBILE_DIR,
  '.maestro/flows/qa/qa-session-bootstrap-ios.yaml',
);
const QA_SESSION_RESET_FLOW = path.join(
  MOBILE_DIR,
  '.maestro/flows/qa/qa-session-reset-ios.yaml',
);
const DEFAULT_MAESTRO_BIN = path.join(os.homedir(), '.maestro/bin/maestro');
const DEFAULT_JAVA_HOME = path.join(
  os.homedir(),
  '.local/jdks/temurin17/jdk-17.0.18+8/Contents/Home',
);
const DEFAULT_METRO_URL = 'http://127.0.0.1:8097';
const DEFAULT_IOS_BUNDLE_PATH = '/mobile-app/index.bundle';
const DEFAULT_QA_SIMULATOR_LOCATION = '-22.97104,-43.18349';
const READY_SCREEN_ID_PATTERNS = Object.freeze({
  passenger: '^(passenger-home-destination-input|passenger-trip-screen|passenger-driver-search-sheet|passenger-no-drivers-screen|passenger-payment-failed-screen|passenger-cancellation-screen|passenger-receipt-screen|payment-modal-content)$',
  driver: '^(driver-home-toggle-online|driver-live-ride-overlay-wrap|driver-live-trip-screen|driver-offer-screen|driver-receipt-screen)$',
});
const APP_READY_RECOVERY_SETTLE_MS = 15000;

const PASSENGER_SCENARIOS = Object.freeze([
  'passenger-home',
  'passenger-destination-search',
  'passenger-booking',
  'passenger-category',
  'passenger-payment',
  'passenger-searching',
  'passenger-requesting',
  'passenger-no-drivers',
  'passenger-payment-failed',
  'passenger-extension',
  'passenger-operational',
  'passenger-searching-replacement',
  'passenger-receipt',
  'passenger-cancelled-refund',
  'passenger-accepted',
  'passenger-arrived',
  'passenger-started',
]);

const DRIVER_SCENARIOS = Object.freeze([
  'driver-home',
  'driver-online-waiting',
  'driver-offer',
  'driver-accepted',
  'driver-arrived',
  'driver-started',
  'driver-operational',
  'driver-searching-replacement',
  'driver-completed-home',
  'driver-receipt',
]);

const ASSERTIONS = Object.freeze({
  'passenger-home': ['passenger-home-destination-input', 'passenger-home-destination-input'],
  'passenger-destination-search': [
    'passenger-home-destination-search-input',
    'passenger-home-destination-search-input',
  ],
  'passenger-booking': ['passenger-home-category-card', 'passenger-home-category-confirm'],
  'passenger-category': ['passenger-home-category-card', 'passenger-home-category-confirm'],
  'passenger-payment': ['payment-modal-content', 'payment-modal-pending-state'],
  'passenger-searching': ['passenger-driver-search-sheet', 'passenger-driver-search-sheet'],
  'passenger-requesting': ['passenger-driver-search-sheet', 'passenger-driver-search-sheet'],
  'passenger-no-drivers': ['passenger-no-drivers-screen', 'passenger-no-drivers-retry-button'],
  'passenger-payment-failed': [
    'passenger-payment-failed-screen',
    'payment-failed-button-Tentar novamente',
  ],
  'passenger-extension': ['payment-modal-content', 'payment-modal-copy-code-button'],
  'passenger-operational': ['passenger-trip-screen', 'passenger-trip-operational-title'],
  'passenger-searching-replacement': [
    'passenger-trip-screen',
    'passenger-trip-searching-replacement-title',
  ],
  'passenger-receipt': ['passenger-receipt-screen', 'receipt-recovery-state-card'],
  'passenger-cancelled-refund': [
    'passenger-cancellation-screen',
    'passenger-cancellation-keep-button',
  ],
  'passenger-accepted': ['passenger-trip-screen', 'passenger-trip-driver-identity'],
  'passenger-arrived': ['passenger-trip-screen', 'passenger-trip-driver-identity'],
  'passenger-started': ['passenger-trip-screen', 'passenger-trip-started-action-dock'],
  'driver-home': ['driver-home-toggle-online', 'driver-home-toggle-online'],
  'driver-online-waiting': ['driver-home-toggle-online', 'driver-home-online-state'],
  'driver-offer': ['driver-live-ride-overlay-wrap', 'driver-live-offer-accept-button'],
  'driver-accepted': [
    'driver-live-ride-overlay-wrap',
    'driver-live-primary-action-arrive-button',
  ],
  'driver-arrived': [
    'driver-live-ride-overlay-wrap',
    'driver-live-primary-action-start-button',
  ],
  'driver-started': [
    'driver-live-ride-overlay-wrap',
    'driver-live-primary-action-complete-button',
  ],
  'driver-operational': [
    'driver-live-ride-overlay-wrap',
    'driver-live-operational-hold-title',
  ],
  'driver-searching-replacement': [
    'driver-live-ride-overlay-wrap',
    'driver-live-searching-replacement-title',
  ],
  'driver-completed-home': ['driver-receipt-screen', 'receipt-recovery-state-card'],
  'driver-receipt': ['driver-receipt-screen', 'receipt-recovery-state-card'],
});

const RUNTIME_HISTORY_REQUIRED_STEPS = Object.freeze({
  'passenger-receipt': [],
  'driver-completed-home': [],
  'driver-receipt': [],
});

function arg(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function printUsage() {
  process.stdout.write([
    'Uso: run-prototype-ios-state-matrix.cjs --passenger-device <udid> --driver-device <udid>',
    '  --role passenger|driver|all       roda somente o papel selecionado',
    '  --scenario <nome>                 roda somente um cenário',
    '  --out-dir <dir>                   diretório dos screenshots e relatório',
    '  --freeze-ms <ms>                  janela de fixture; padrão 600000',
    '  --metro-url <url>                 servidor Metro; padrão METRO_URL ou 127.0.0.1:8097',
    '  --bundle-url <url>                bundle iOS completo; padrão Metro + /mobile-app/index.bundle',
    '  --expect-reduced-motion           exige evidência de rota estática por reduced motion',
    '  --help                            mostra esta ajuda',
    '',
    'A execução é E2 isolada: usa --skip-socket-token e nunca cria cobrança.',
  ].join('\n') + '\n');
}

function resolveJavaHome() {
  const candidates = [process.env.JAVA_HOME, DEFAULT_JAVA_HOME].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, 'bin', 'java'))) || '';
}

function resolveMaestro() {
  const candidates = [process.env.MAESTRO_BIN, DEFAULT_MAESTRO_BIN].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function run(command, args, env, timeout = 180000) {
  if (!command) {
    return { status: 127, stdout: '', stderr: 'command missing' };
  }

  // Some CoreSimulator/Maestro processes can fork a child that inherits the
  // stdout/stderr pipes. With spawnSync's default pipes, a timed-out parent
  // may be killed while Node keeps waiting for EOF from that orphan. Use
  // file-backed stdio so a hung host command becomes a bounded NOT_RUN
  // result instead of freezing the matrix indefinitely.
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'leaf-qa-run-'));
  const stdoutPath = path.join(outputDir, 'stdout.log');
  const stderrPath = path.join(outputDir, 'stderr.log');
  let stdoutFd = null;
  let stderrFd = null;
  let result;
  try {
    stdoutFd = fs.openSync(stdoutPath, 'w');
    stderrFd = fs.openSync(stderrPath, 'w');
    const watchdogSeconds = Math.max(1, Math.ceil(Number(timeout) / 1000));
    const processGroupLauncher = fs.existsSync('/usr/bin/python3')
      ? [
          '/usr/bin/python3',
          '-c',
          "import os, sys; os.setsid(); os.execvp(sys.argv[1], sys.argv[1:])",
        ]
      : null;
    const launchCommand = processGroupLauncher
      ? `${processGroupLauncher[0]} -c '${processGroupLauncher[2]}' "$@" &`
      : '"$@" &';
    const cleanupCommand = processGroupLauncher
      ? [
          '    kill -TERM "-$child" 2>/dev/null || kill -TERM "$child" 2>/dev/null || true',
          '    sleep 1',
          '    kill -KILL "-$child" 2>/dev/null || kill -KILL "$child" 2>/dev/null || true',
        ]
      : [
          '    kill -TERM "$child" 2>/dev/null || true',
          '    sleep 1',
          '    kill -KILL "$child" 2>/dev/null || true',
        ];
    const watchdogScript = [
      'child=',
      'cleanup() {',
      '  if [ -n "${child:-}" ]; then',
      ...cleanupCommand,
      '  fi',
      '}',
      "trap 'cleanup; exit 143' INT TERM",
      'trap cleanup EXIT',
      launchCommand,
      'child=$!',
      `deadline=$(($(date +%s) + ${watchdogSeconds}))`,
      'while :; do',
      '  state=$(ps -p "$child" -o stat= 2>/dev/null | tr -d " ")',
      '  # macOS may report a transient E (exiting) state while XCUITest is',
      '  # finishing normally; only a vanished/zombie child is reaped here.',
      '  case "$state" in',
      '    ""|Z*) wait "$child"; status=$?; cleanup; child=; exit "$status" ;;',
      '  esac',
      '  if [ "$(date +%s)" -ge "$deadline" ]; then',
      '    cleanup',
      '    child=',
      `    echo "command timeout after ${Number(timeout)} ms" >&2`,
      '    exit 124',
      '  fi',
      '  sleep 1',
      'done',
    ].join('\n');
    result = spawnSync('/bin/sh', ['-c', watchdogScript, 'leaf-qa-watchdog', command, ...args], {
      cwd: ROOT_DIR,
      env,
      encoding: 'utf8',
      timeout: Number(timeout) + 10000,
      killSignal: 'SIGKILL',
      stdio: ['ignore', stdoutFd, stderrFd],
    });
  } finally {
    if (stdoutFd !== null) {
      fs.closeSync(stdoutFd);
    }
    if (stderrFd !== null) {
      fs.closeSync(stderrFd);
    }
  }

  const stdout = fs.readFileSync(stdoutPath, 'utf8');
  const stderr = fs.readFileSync(stderrPath, 'utf8');
  fs.rmSync(outputDir, { recursive: true, force: true });
  const status =
    result?.status !== null && result?.status !== undefined
      ? result.status
      : result?.error?.code === 'ETIMEDOUT'
        ? 124
        : 1;
  return {
    status,
    stdout,
    stderr: String(stderr || result?.error?.message || ''),
  };
}

function runSimctl(args, timeout = 30000) {
  const result = run(SIMCTL_BIN, args, { ...process.env }, timeout);
  const detachedOnly = /^(command timeout after \d+ ms|command entered exiting state)\s*$/.test(
    String(result.stderr || '').trim(),
  );
  if (![124, 125].includes(result.status) || !detachedOnly) {
    return result;
  }

  const operation = String(args[0] || '');
  if (operation === 'list') {
    try {
      const parsed = JSON.parse(result.stdout);
      if (parsed && parsed.devices && typeof parsed.devices === 'object') {
        return {
          ...result,
          status: 0,
          stderr: '',
          simctlDetachedCompletion: 'valid_device_inventory_after_timeout',
        };
      }
    } catch (_error) {
      return result;
    }
  }

  if (operation === 'get_app_container' && fs.existsSync(String(result.stdout || '').trim())) {
    return {
      ...result,
      status: 0,
      stderr: '',
      simctlDetachedCompletion: 'existing_app_container_after_timeout',
    };
  }

  if (['boot', 'bootstatus'].includes(operation)) {
    const deviceId = String(args[1] || '').trim();
    const inventory = readSimulatorInventory();
    const device = inventory.ok ? findSimulator(inventory, deviceId) : null;
    if (device?.state === 'Booted') {
      return {
        ...result,
        status: 0,
        stderr: '',
        simctlDetachedCompletion: 'verified_booted_after_timeout',
      };
    }
  }

  if (operation === 'io' && args[2] === 'screenshot') {
    const screenshotPath = String(args[args.length - 1] || '');
    if (screenshotPath && fs.existsSync(screenshotPath)) {
      return {
        ...result,
        status: 0,
        stderr: '',
        simctlDetachedCompletion: 'existing_screenshot_after_timeout',
      };
    }
  }

  return result;
}

function buildIosBundleUrl(metroUrl, explicitBundleUrl = '') {
  const explicit = String(explicitBundleUrl || '').trim();
  if (explicit) {
    return explicit;
  }

  const bundleUrl = new URL(String(metroUrl || DEFAULT_METRO_URL));
  if (!bundleUrl.pathname.endsWith('.bundle')) {
    bundleUrl.pathname = DEFAULT_IOS_BUNDLE_PATH;
    bundleUrl.search = 'platform=ios&dev=true&minify=false';
  }
  return bundleUrl.toString();
}

function buildDevClientDeepLink(bundleUrl) {
  return `exp+leafapp-reactnative://expo-development-client/?url=${encodeURIComponent(
    String(bundleUrl || '').trim(),
  )}&disableOnboarding=1`;
}

function resolveMetroUrl() {
  return String(
    arg('--metro-url', process.env.METRO_URL || DEFAULT_METRO_URL),
  ).trim();
}

function resolveBundleUrl(metroUrl) {
  return buildIosBundleUrl(
    metroUrl,
    arg('--bundle-url', process.env.METRO_BUNDLE_URL || ''),
  );
}

function checkMetroReady(bundleUrl) {
  try {
    new URL(bundleUrl);
  } catch (error) {
    return {
      ok: false,
      reason: `invalid_bundle_url:${error?.message || String(error)}`,
      bundleUrl: null,
      diagnostics: '',
    };
  }

  const result = run(
    '/usr/bin/curl',
    [
      '--fail',
      '--silent',
      '--show-error',
      '--max-time',
      '120',
      '--output',
      '/dev/null',
      bundleUrl,
    ],
    { ...process.env },
    150000,
  );
  return {
    ok: result.status === 0,
    reason: result.status === 0 ? null : 'metro_bundle_unavailable',
    bundleUrl,
    diagnostics: tail(result.stderr || result.stdout),
  };
}

function readSimulatorInventory() {
  const result = runSimctl(['list', 'devices', 'available', '--json'], 30000);
  if (result.status !== 0) {
    return {
      ok: false,
      reason: `simulator_inventory_failed:${tail(result.stderr || result.stdout)}`,
      devices: [],
    };
  }

  try {
    const parsed = JSON.parse(result.stdout);
    return {
      ok: true,
      reason: null,
      devices: Object.values(parsed?.devices || {}).flat(),
    };
  } catch (error) {
    return {
      ok: false,
      reason: `simulator_inventory_invalid_json:${error?.message || String(error)}`,
      devices: [],
    };
  }
}

function findSimulator(inventory, deviceId) {
  return inventory.devices.find((device) => device?.udid === deviceId) || null;
}

function ensureSimulatorBooted(deviceId) {
  const inventory = readSimulatorInventory();
  if (!inventory.ok) {
    return { ok: false, reason: inventory.reason, deviceId, state: null };
  }

  const device = findSimulator(inventory, deviceId);
  if (!device) {
    return {
      ok: false,
      reason: `simulator_not_found:${deviceId}`,
      deviceId,
      state: null,
    };
  }

  if (device.state !== 'Booted') {
    const boot = runSimctl(['boot', deviceId], 30000);
    if (boot.status !== 0 && !/already booted/i.test(`${boot.stdout}\n${boot.stderr}`)) {
      return {
        ok: false,
        reason: `simulator_boot_failed:${tail(boot.stderr || boot.stdout)}`,
        deviceId,
        state: device.state,
      };
    }
  }

  const bootstatus = runSimctl(['bootstatus', deviceId, '-b'], 180000);
  if (bootstatus.status !== 0) {
    return {
      ok: false,
      reason: `simulator_bootstatus_failed:${tail(bootstatus.stderr || bootstatus.stdout)}`,
      deviceId,
      state: device.state,
    };
  }

  const afterBoot = readSimulatorInventory();
  const bootedDevice = afterBoot.ok ? findSimulator(afterBoot, deviceId) : null;
  if (!bootedDevice || bootedDevice.state !== 'Booted') {
    return {
      ok: false,
      reason: `simulator_not_booted_after_wait:${deviceId}`,
      deviceId,
      state: bootedDevice?.state || null,
    };
  }

  return { ok: true, reason: null, deviceId, state: 'Booted' };
}

function ensureAppInstalled(deviceId) {
  const result = runSimctl(['get_app_container', deviceId, APP_ID, 'app'], 30000);
  if (result.status === 0) {
    return {
      ok: true,
      reason: null,
      deviceId,
      bundlePath: String(result.stdout || '').trim() || null,
      verification: 'simctl_get_app_container',
      detachedCompletion: result.simctlDetachedCompletion || null,
    };
  }

  // CoreSimulator can leave get_app_container in an exiting state even while
  // the installed bundle is present and the app is launchable. Read the
  // simulator's bundle registry directly as a read-only fallback, and verify
  // the bundle identifier from its Info.plist. This prevents a host-side
  // simctl hang from blocking a valid boot while still rejecting an unknown
  // or stale app bundle.
  const deviceDataPath = path.join(
    os.homedir(),
    'Library/Developer/CoreSimulator/Devices',
    deviceId,
    'data',
  );
  const applicationsPath = path.join(
    deviceDataPath,
    'Containers/Bundle/Application',
  );
  let fallbackBundlePath = '';
  try {
    const appDirectories = fs.readdirSync(applicationsPath, { withFileTypes: true });
    for (const appDirectory of appDirectories) {
      if (!appDirectory.isDirectory()) continue;
      const candidate = path.join(applicationsPath, appDirectory.name, 'Leaf.app');
      const plistPath = path.join(candidate, 'Info.plist');
      if (!fs.existsSync(plistPath)) continue;
      const plist = run('/usr/bin/plutil', ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', plistPath], { ...process.env }, 10000);
      if (plist.status === 0 && plist.stdout.trim() === APP_ID) {
        fallbackBundlePath = candidate;
        break;
      }
    }
  } catch (_error) {
    fallbackBundlePath = '';
  }

  if (fallbackBundlePath) {
    return {
      ok: true,
      reason: null,
      deviceId,
      bundlePath: fallbackBundlePath,
      verification: 'filesystem_bundle_registry',
      detachedCompletion: result.simctlDetachedCompletion || null,
    };
  }

  return {
    ok: false,
    reason: `app_not_installed:${tail(result.stderr || result.stdout)}`,
    deviceId,
    bundlePath: null,
    verification: 'simctl_and_filesystem_failed',
    detachedCompletion: result.simctlDetachedCompletion || null,
  };
}

function launchInstalledApp(deviceId) {
  const result = runSimctl(['launch', deviceId, APP_ID], 30000);
  return {
    ok: result.status === 0,
    reason:
      result.status === 0
        ? null
        : `app_launch_failed:${tail(result.stderr || result.stdout)}`,
    deviceId,
    detachedCompletion: result.simctlDetachedCompletion || null,
  };
}

function isAlreadyStoppedTerminationOutput(output) {
  return /no such process|not running|could not find application|found nothing to terminate/i.test(
    String(output || ''),
  );
}

function setQaSimulatorLocation(deviceId) {
  const location = String(
    process.env.QA_SIMULATOR_LOCATION || DEFAULT_QA_SIMULATOR_LOCATION,
  ).trim();
  const [latitude, longitude] = location.split(',').map(Number);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return {
      ok: false,
      reason: `invalid_qa_simulator_location:${location}`,
      deviceId,
      location,
    };
  }

  const result = runSimctl(['location', deviceId, 'set', location], 30000);
  return {
    ok: result.status === 0,
    reason:
      result.status === 0
        ? null
        : `qa_simulator_location_failed:${tail(result.stderr || result.stdout)}`,
    deviceId,
    location,
    detachedCompletion: result.simctlDetachedCompletion || null,
  };
}

function terminateInstalledApp(deviceId) {
  const result = runSimctl(['terminate', deviceId, APP_ID], 30000);
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  const alreadyStopped = isAlreadyStoppedTerminationOutput(output);
  return {
    ok: result.status === 0 || alreadyStopped,
    reason:
      result.status === 0 || alreadyStopped
        ? null
        : `app_terminate_failed:${tail(result.stderr || result.stdout)}`,
    deviceId,
    alreadyStopped,
    detachedCompletion: result.simctlDetachedCompletion || null,
  };
}

function reloadDevClientAfterStateSeed({ deviceId, bundleUrl }) {
  // State injection writes AsyncStorage while the app is alive. A plain
  // openurl is not a guaranteed JS-runtime reload, so the current runtime
  // can keep the previous scenario in memory. Restart only Leaf (never the
  // simulator), relaunch the installed app, and then reopen the explicit
  // bundle URL so hydration happens before the readiness gate.
  const terminate = terminateInstalledApp(deviceId);
  if (!terminate.ok) {
    return {
      ok: false,
      reason: terminate.reason,
      deviceId,
      terminate,
      appLaunch: null,
      devClientOpen: null,
    };
  }

  const appLaunch = launchInstalledApp(deviceId);
  if (!appLaunch.ok) {
    return {
      ok: false,
      reason: appLaunch.reason,
      deviceId,
      terminate,
      appLaunch,
      devClientOpen: null,
    };
  }

  const devClientOpen = runSimctl(
    ['openurl', deviceId, buildDevClientDeepLink(bundleUrl)],
    30000,
  );
  if (devClientOpen.status !== 0) {
    return {
      ok: false,
      reason: `dev_client_reload_failed:${tail(devClientOpen.stderr || devClientOpen.stdout)}`,
      deviceId,
      terminate,
      appLaunch,
      devClientOpen,
    };
  }

  sleep(1500);
  return {
    ok: true,
    reason: null,
    deviceId,
    terminate,
    appLaunch,
    devClientOpen: {
      status: devClientOpen.status,
      detachedCompletion: devClientOpen.simctlDetachedCompletion || null,
    },
  };
}

function resolveQaSessionEnv(role) {
  const normalizedRole = role === 'driver' ? 'driver' : 'passenger';
  const prefix = normalizedRole === 'driver' ? 'QA_DRIVER' : 'QA_PASSENGER';
  const defaultPhone = normalizedRole === 'driver' ? '21123456789' : '21102938475';
  const defaultOtp = normalizedRole === 'driver' ? '992000' : '992111';
  const otp = String(process.env[`${prefix}_OTP`] || process.env.QA_OTP || defaultOtp)
    .trim()
    .padStart(6, '0')
    .slice(0, 6)
    .split('');

  return {
    QA_PHONE: String(
      process.env[`${prefix}_PHONE`] || process.env.QA_PHONE || defaultPhone,
    ).trim(),
    QA_PASSWORD: String(
      process.env[`${prefix}_PASSWORD`] ||
        process.env.QA_PASSWORD ||
        process.env[
          normalizedRole === 'driver'
            ? 'REVIEW_DRIVER_PASSWORD'
            : 'REVIEW_PASSENGER_PASSWORD'
        ] ||
        '',
    ),
    QA_PROFILE_OPTION: normalizedRole === 'driver' ? 'driver' : 'customer',
    QA_OTP_0: otp[0] || '',
    QA_OTP_1: otp[1] || '',
    QA_OTP_2: otp[2] || '',
    QA_OTP_3: otp[3] || '',
    QA_OTP_4: otp[4] || '',
    QA_OTP_5: otp[5] || '',
  };
}

function runQaSessionBootstrap({
  deviceId,
  role,
  runDir,
  maestroBin,
  javaHome,
  readyScreenIdPattern,
}) {
  const bootstrapDir = path.join(
    runDir,
    '_preflight',
    deviceId.replace(/[^A-Za-z0-9_.-]/g, '_'),
    'qa-session-bootstrap',
  );
  fs.mkdirSync(bootstrapDir, { recursive: true });
  const maestroEnv = {
    ...process.env,
    JAVA_HOME: javaHome,
  };
  const maestroArgs = [
    'test',
    '--no-ansi',
    '--device',
    deviceId,
    `--debug-output=${path.join(bootstrapDir, 'maestro-debug')}`,
    `--test-output-dir=${bootstrapDir}`,
    '--env',
    `READY_SCREEN_ID=${readyScreenIdPattern}`,
  ];
  Object.entries(resolveQaSessionEnv(role)).forEach(([key, value]) => {
    maestroArgs.push('--env', `${key}=${value}`);
  });
  maestroArgs.push(QA_SESSION_BOOTSTRAP_FLOW);
  const maestro = run(maestroBin, maestroArgs, maestroEnv, 180000);

  return {
    ok: maestro.status === 0,
    status: maestro.status,
    role,
    reason:
      maestro.status === 0
        ? null
        : `qa_session_bootstrap_failed:${tail(maestro.stderr || maestro.stdout)}`,
    output: tail(maestro.stdout || maestro.stderr),
    artifactDir: bootstrapDir,
  };
}

function runQaSessionReset({
  deviceId,
  runDir,
  maestroBin,
  javaHome,
}) {
  const resetDir = path.join(
    runDir,
    '_preflight',
    deviceId.replace(/[^A-Za-z0-9_.-]/g, '_'),
    'qa-session-reset',
  );
  fs.mkdirSync(resetDir, { recursive: true });
  const maestroEnv = {
    ...process.env,
    JAVA_HOME: javaHome,
  };
  const maestro = run(
    maestroBin,
    [
      'test',
      '--no-ansi',
      '--device',
      deviceId,
      `--debug-output=${path.join(resetDir, 'maestro-debug')}`,
      `--test-output-dir=${resetDir}`,
      QA_SESSION_RESET_FLOW,
    ],
    maestroEnv,
    180000,
  );

  return {
    ok: maestro.status === 0,
    status: maestro.status,
    reason:
      maestro.status === 0
        ? null
        : `qa_session_reset_failed:${tail(maestro.stderr || maestro.stdout)}`,
    output: tail(maestro.stdout || maestro.stderr),
    artifactDir: resetDir,
  };
}

function preflightAppOnSimulator({
  deviceId,
  role,
  runDir,
  maestroBin,
  javaHome,
  bundleUrl,
}) {
  const readyScreenIdPattern = READY_SCREEN_ID_PATTERNS[role];
  if (!readyScreenIdPattern) {
    return {
      ok: false,
      reason: `invalid_preflight_role:${role}`,
      role,
      readyScreenIdPattern: null,
      boot: null,
      app: null,
      maestro: null,
    };
  }

  const boot = ensureSimulatorBooted(deviceId);
  if (!boot.ok) {
    return { ok: false, reason: boot.reason, role, readyScreenIdPattern, boot, app: null, maestro: null };
  }

  const simulatorLocation = setQaSimulatorLocation(deviceId);
  if (!simulatorLocation.ok) {
    return {
      ok: false,
      reason: simulatorLocation.reason,
      role,
      readyScreenIdPattern,
      boot,
      simulatorLocation,
      app: null,
      maestro: null,
    };
  }

  const app = ensureAppInstalled(deviceId);
  if (!app.ok) {
    return {
      ok: false,
      reason: app.reason,
      role,
      readyScreenIdPattern,
      boot,
      simulatorLocation,
      app,
      maestro: null,
    };
  }

  // A sequential passenger/driver run reuses one authorized simulator. Clear
  // persisted auth and ride state before bootstrapping the requested role, so
  // a previous passenger trip cannot make the driver preflight look like a
  // geofence or readiness failure.
  const sessionReset = runQaSessionReset({
    deviceId,
    runDir,
    maestroBin,
    javaHome,
  });
  if (!sessionReset.ok) {
    return {
      ok: false,
      reason: sessionReset.reason,
      role,
      readyScreenIdPattern,
      boot,
      simulatorLocation,
      app,
      sessionReset,
      maestro: null,
    };
  }

  const appLaunch = launchInstalledApp(deviceId);
  if (!appLaunch.ok) {
    return {
      ok: false,
      reason: appLaunch.reason,
      role,
      readyScreenIdPattern,
      boot,
      simulatorLocation,
      app,
      sessionReset,
      appLaunch,
      maestro: null,
    };
  }

  const devClientLink = buildDevClientDeepLink(bundleUrl);
  const openDevClient = runSimctl(['openurl', deviceId, devClientLink], 30000);
  if (openDevClient.status !== 0) {
    return {
      ok: false,
      reason: `dev_client_open_failed:${tail(openDevClient.stderr || openDevClient.stdout)}`,
      role,
      readyScreenIdPattern,
      boot,
      simulatorLocation,
      app,
      sessionReset,
      appLaunch,
      maestro: null,
    };
  }

  const sessionBootstrap = runQaSessionBootstrap({
    deviceId,
    role,
    runDir,
    maestroBin,
    javaHome,
    readyScreenIdPattern,
  });
  if (!sessionBootstrap.ok) {
    return {
      ok: false,
      reason: sessionBootstrap.reason,
      role,
      readyScreenIdPattern,
      boot,
      simulatorLocation,
      app,
      sessionReset,
      appLaunch,
      sessionBootstrap,
      maestro: null,
    };
  }

  // Maestro may leave the simulator on the iOS Home screen when its
  // bootstrap process exits, even though the final bootstrap assertion
  // passed. Re-activate the installed Leaf app before the independent
  // readiness gate; otherwise that gate would correctly reject the Home
  // screen and mark every scenario NOT_RUN.
  const postBootstrapAppLaunch = launchInstalledApp(deviceId);
  if (!postBootstrapAppLaunch.ok) {
    return {
      ok: false,
      reason: postBootstrapAppLaunch.reason,
      role,
      readyScreenIdPattern,
      boot,
      simulatorLocation,
      app,
      sessionReset,
      appLaunch,
      sessionBootstrap,
      postBootstrapAppLaunch,
      maestro: null,
    };
  }

  const deviceDir = path.join(
    runDir,
    '_preflight',
    deviceId.replace(/[^A-Za-z0-9_.-]/g, '_'),
  );
  fs.mkdirSync(deviceDir, { recursive: true });
  let bundle;
  try {
    bundle = new URL(bundleUrl);
  } catch (_error) {
    bundle = null;
  }
  const maestroEnv = {
    ...process.env,
    JAVA_HOME: javaHome,
    MAESTRO_METRO_HOST: bundle?.hostname || '127.0.0.1',
    MAESTRO_METRO_PORT: bundle?.port || '80',
  };
  const maestro = run(
    maestroBin,
    [
      'test',
      '--no-ansi',
      '--device',
      deviceId,
      `--debug-output=${path.join(deviceDir, 'maestro-debug')}`,
      `--test-output-dir=${deviceDir}`,
      '--env',
      `READY_SCREEN_ID=${readyScreenIdPattern}`,
      APP_READY_FLOW,
    ],
    maestroEnv,
    150000,
  );
  if (maestro.status !== 0) {
    return {
      ok: false,
      reason: `app_ready_assertion_failed:${tail(maestro.stderr || maestro.stdout)}`,
      role,
      readyScreenIdPattern,
      boot,
      simulatorLocation,
      app,
      sessionReset,
      appLaunch,
      sessionBootstrap,
      postBootstrapAppLaunch,
      maestro: { status: maestro.status, output: tail(maestro.stderr || maestro.stdout) },
    };
  }

  return {
    ok: true,
    reason: null,
    role,
    readyScreenIdPattern,
    boot,
    simulatorLocation,
    app,
    sessionReset,
    appLaunch,
    sessionBootstrap,
    postBootstrapAppLaunch,
    maestro: { status: maestro.status, output: tail(maestro.stdout || maestro.stderr) },
  };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function relativeToRun(runDir, filePath) {
  return path.relative(runDir, filePath).split(path.sep).join('/');
}

function tail(value, max = 1200) {
  const normalized = String(value || '').trim();
  return normalized.length > max ? normalized.slice(-max) : normalized;
}

function sleep(milliseconds) {
  const delay = Math.max(0, Number(milliseconds) || 0);
  if (delay === 0) {
    return;
  }

  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay);
}

function validateRuntimeHistoryArtifact(filePath, scenario, { expectReducedMotion = false } = {}) {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      reason: 'missing_runtime_history',
      entryCount: 0,
      steps: [],
      requiredSteps: [],
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      reason: `invalid_runtime_history_json:${error?.message || String(error)}`,
      entryCount: 0,
      steps: [],
      requiredSteps: [],
    };
  }

  const history = Array.isArray(parsed)
    ? parsed
    : parsed && Array.isArray(parsed.history)
      ? parsed.history
      : null;
  const parseError = Array.isArray(parsed) ? null : parsed?.parseError;
  const entries = Array.isArray(history)
    ? history.filter((entry) => entry && typeof entry.step === 'string')
    : [];
  const steps = [...new Set(entries.map((entry) => entry.step))];
  const requiredSteps = Object.prototype.hasOwnProperty.call(
    RUNTIME_HISTORY_REQUIRED_STEPS,
    scenario,
  )
    ? RUNTIME_HISTORY_REQUIRED_STEPS[scenario]
    : ['map_route_animation'];
  const reducedMotionExpectationApplicable = requiredSteps.includes('map_route_animation');
  const missingSteps = requiredSteps.filter((step) => !steps.includes(step));
  const mapAnimationEntries = entries.filter((entry) => entry.step === 'map_route_animation');
  const reducedMotionEntries = mapAnimationEntries.filter(
    (entry) => entry.data?.reducedMotion === true,
  );
  const reducedMotionStaticEntries = reducedMotionEntries.filter(
    (entry) => entry.data?.reason === 'reduced_motion' && entry.data?.phase === 'static',
  );

  if (parseError) {
    return {
      ok: false,
      reason: `runtime_history_parse_error:${String(parseError)}`,
      entryCount: entries.length,
      steps,
      requiredSteps,
      missingSteps,
      reducedMotionExpectationApplicable,
    };
  }

  if (!Array.isArray(history)) {
    return {
      ok: false,
      reason: 'runtime_history_not_an_array',
      entryCount: entries.length,
      steps,
      requiredSteps,
      missingSteps,
      reducedMotionExpectationApplicable,
    };
  }

  if (missingSteps.length > 0) {
    return {
      ok: false,
      reason: `runtime_history_missing_steps:${missingSteps.join(',')}`,
      entryCount: entries.length,
      steps,
      requiredSteps,
      missingSteps,
      reducedMotionExpectationApplicable,
      reducedMotionObserved: reducedMotionEntries.length > 0,
      reducedMotionStaticEntryCount: reducedMotionStaticEntries.length,
    };
  }

  if (
    expectReducedMotion &&
    reducedMotionExpectationApplicable &&
    reducedMotionStaticEntries.length === 0
  ) {
    return {
      ok: false,
      reason: 'runtime_history_missing_reduced_motion_static_route',
      entryCount: entries.length,
      steps,
      requiredSteps,
      missingSteps,
      reducedMotionExpectationApplicable,
      reducedMotionObserved: reducedMotionEntries.length > 0,
      reducedMotionStaticEntryCount: reducedMotionStaticEntries.length,
    };
  }

  return {
    ok: true,
    reason: null,
    entryCount: entries.length,
    steps,
    requiredSteps,
    missingSteps: [],
    reducedMotionExpectationApplicable,
    reducedMotionObserved: reducedMotionEntries.length > 0,
    reducedMotionStaticEntryCount: reducedMotionStaticEntries.length,
  };
}

function captureRuntimeHistoryArtifact(deviceId, scenarioDir) {
  try {
    const dataContainer = getContainerData(deviceId);
    const filePath = writeRuntimeDebugHistoryArtifact(dataContainer, scenarioDir);
    return {
      ok: true,
      filePath,
      reason: null,
    };
  } catch (error) {
    return {
      ok: false,
      filePath: path.join(scenarioDir, 'runtime-debug-history.json'),
      reason: `runtime_history_capture_failed:${error?.message || String(error)}`,
    };
  }
}

function runScenarioAppReadyAssertion({
  deviceId,
  role,
  scenarioDir,
  maestroBin,
  javaHome,
  bundleUrl,
}) {
  const readyScreenIdPattern = READY_SCREEN_ID_PATTERNS[role];
  const readinessDir = path.join(scenarioDir, 'app-ready');
  fs.mkdirSync(readinessDir, { recursive: true });
  const maestroEnv = {
    ...process.env,
    JAVA_HOME: javaHome,
  };
  const attempts = [];
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptDir =
      attempt === 1
        ? readinessDir
        : path.join(readinessDir, `recovery-${attempt}`);
    fs.mkdirSync(attemptDir, { recursive: true });
    const maestro = run(
      maestroBin,
      [
        'test',
        '--no-ansi',
        '--device',
        deviceId,
        `--debug-output=${path.join(attemptDir, 'maestro-debug')}`,
        `--test-output-dir=${attemptDir}`,
        '--env',
        `READY_SCREEN_ID=${readyScreenIdPattern}`,
        APP_READY_FLOW,
      ],
      maestroEnv,
      150000,
    );
    const attemptResult = {
      attempt,
      status: maestro.status,
      output: tail(maestro.stdout || maestro.stderr),
    };
    attempts.push(attemptResult);

    if (maestro.status === 0) {
      return {
        ok: true,
        status: maestro.status,
        reason: null,
        output: attemptResult.output,
        attempts,
      };
    }

    if (attempt === maxAttempts) {
      return {
        ok: false,
        status: maestro.status,
        reason: `app_ready_assertion_failed:${attemptResult.output}`,
        output: attemptResult.output,
        attempts,
      };
    }

    // A failed readiness assertion can leave XCUITest on the iOS Home screen
    // even though the installed app and bundle are healthy. Recover only the
    // app foreground and explicit dev-client URL, then run the same strict
    // readiness assertion again. This cannot turn Home or a loading surface
    // into a pass: the exact operational ID assertion still has to complete.
    const appLaunch = launchInstalledApp(deviceId);
    if (!appLaunch.ok) {
      return {
        ok: false,
        status: maestro.status,
        reason: `app_ready_recovery_launch_failed:${appLaunch.reason}`,
        output: attemptResult.output,
        attempts,
        recovery: { appLaunch, devClientOpen: null },
      };
    }
    const devClientOpen = runSimctl(
      ['openurl', deviceId, buildDevClientDeepLink(bundleUrl)],
      30000,
    );
    if (devClientOpen.status !== 0) {
      return {
        ok: false,
        status: maestro.status,
        reason: `app_ready_recovery_open_failed:${tail(
          devClientOpen.stderr || devClientOpen.stdout,
        )}`,
        output: attemptResult.output,
        attempts,
        recovery: {
          appLaunch,
          devClientOpen: {
            status: devClientOpen.status,
            output: tail(devClientOpen.stderr || devClientOpen.stdout),
          },
        },
      };
    }
    sleep(APP_READY_RECOVERY_SETTLE_MS);
  }

  return {
    ok: false,
    status: 1,
    reason: 'app_ready_assertion_failed:readiness_attempts_exhausted',
    output: '',
    attempts,
  };
}

function captureScenarioScreenshot(deviceId, screenshotPath) {
  const result = runSimctl(
    ['io', deviceId, 'screenshot', '--mask=ignored', screenshotPath],
    30000,
  );
  return {
    ok: result.status === 0 && fs.existsSync(screenshotPath),
    reason:
      result.status === 0
        ? fs.existsSync(screenshotPath)
          ? null
          : 'scenario_screenshot_not_created'
        : `scenario_screenshot_capture_failed:${tail(result.stderr || result.stdout)}`,
  };
}

function buildNotRunResult({
  scenario,
  deviceId,
  reason,
  preflight = null,
  expectReducedMotion = false,
}) {
  return {
    scenario,
    deviceId,
    evidenceLevel: 'E0',
    integrated: false,
    status: 'NOT_RUN',
    checks: {
      preflightPassed: false,
      seedExitCode: null,
      maestroExitCode: null,
      screenshotExists: false,
      assertedScreenshotExists: false,
      runtimeHistoryExists: false,
      expectedReducedMotion: Boolean(expectReducedMotion),
      reducedMotionExpectationApplicable: false,
      runtimeHistoryReducedMotionObserved: false,
      runtimeHistoryReducedMotionStaticEntryCount: 0,
      screenId: ASSERTIONS[scenario]?.[0] || null,
      primaryId: ASSERTIONS[scenario]?.[1] || null,
    },
    artifacts: {
      screenshot: null,
      assertedScreenshot: null,
      runtimeDebugHistory: null,
    },
    diagnostics: {
      preflight: reason,
      preflightDetail: preflight,
    },
    runtimeHistoryCaptureOk: false,
  };
}

function runScenario({
  scenario,
  deviceId,
  runDir,
  freezeMs,
  maestroBin,
  javaHome,
  expectReducedMotion,
  bundleUrl,
  preflightDevice = null,
}) {
  const scenarioDir = path.join(runDir, scenario);
  fs.mkdirSync(scenarioDir, { recursive: true });
  // The global preflight already proved that this exact simulator is booted.
  // Re-querying CoreSimulator before every state adds no safety because the
  // per-scenario launch below still fails closed if the device is no longer
  // booted, and it used to create avoidable inventory timeout/NOT_RUN results.
  const boot = preflightDevice?.boot?.ok
    ? { ...preflightDevice.boot, reusedFromPreflight: true }
    : ensureSimulatorBooted(deviceId);
  if (!boot.ok) {
    return buildNotRunResult({
      scenario,
      deviceId,
      reason: boot.reason,
      preflight: { boot },
      expectReducedMotion,
    });
  }
  const app = preflightDevice?.app?.ok
    ? { ...preflightDevice.app, reusedFromPreflight: true }
    : ensureAppInstalled(deviceId);
  if (!app.ok) {
    return buildNotRunResult({
      scenario,
      deviceId,
      reason: app.reason,
      preflight: { boot, app },
      expectReducedMotion,
    });
  }
  // The global preflight proves that both roles can load the development
  // client, but a previous assertion can leave the app backgrounded or
  // terminated. Re-activate the installed app before every seed. The seed
  // then reloads the explicit bundle URL after injecting state; if this
  // reactivation fails, do not attempt openurl, state injection, or Maestro.
  const appLaunch = launchInstalledApp(deviceId);
  if (!appLaunch.ok) {
    return buildNotRunResult({
      scenario,
      deviceId,
      reason: appLaunch.reason,
      preflight: { boot, app, appLaunch },
      expectReducedMotion,
    });
  }
  const screenshotPath = path.join(scenarioDir, 'screenshot.png');
  const assertedScreenshotPath = path.join(
    scenarioDir,
    'screenshots',
    `${scenario}-asserted.png`,
  );
  const [screenId, primaryId] = ASSERTIONS[scenario] || [];
  const seedEnv = { ...process.env };
  const seed = run(
    process.execPath,
    [
      IOS_SEED_SCRIPT,
      '--device',
      deviceId,
      '--scenario',
      scenario,
      '--skip-socket-token',
      '--skip-launch',
      '--skip-route',
      '--dev-client-url',
      buildDevClientDeepLink(bundleUrl),
      '--freeze-ms',
      String(freezeMs),
      '--post-launch-wait-ms',
      '1000',
      '--artifact-dir',
      scenarioDir,
    ],
    seedEnv,
  );

  let maestro = { status: 125, stdout: '', stderr: 'seed failed; assertion not run' };
  let appReady = null;
  let stateReload = null;
  let routeOpen = { ok: false, reason: 'scenario_route_not_opened' };
  let screenshotCapture = { ok: false, reason: 'scenario_screenshot_not_captured' };
  if (seed.status === 0 && screenId && primaryId) {
    const role = scenario.startsWith('driver-') ? 'driver' : 'passenger';
    stateReload = reloadDevClientAfterStateSeed({ deviceId, bundleUrl });
    if (!stateReload.ok) {
      return buildNotRunResult({
        scenario,
        deviceId,
        reason: stateReload.reason,
        preflight: { boot, app, appLaunch, seed, stateReload },
        expectReducedMotion,
      });
    }
    appReady = runScenarioAppReadyAssertion({
      deviceId,
      role,
      scenarioDir,
      maestroBin,
      javaHome,
      bundleUrl,
    });

    if (!appReady.ok) {
      return buildNotRunResult({
        scenario,
        deviceId,
        reason: appReady.reason,
        preflight: { boot, app, appLaunch, seed, appReady },
        expectReducedMotion,
      });
    }

    const route = scenarioRoute(scenario);
    const routeResult = runSimctl(['openurl', deviceId, route], 30000);
    routeOpen = {
      ok: routeResult.status === 0,
      route,
      reason:
        routeResult.status === 0
          ? null
          : `scenario_route_open_failed:${tail(routeResult.stderr || routeResult.stdout)}`,
    };
    if (!routeOpen.ok) {
      return buildNotRunResult({
        scenario,
        deviceId,
        reason: routeOpen.reason,
        preflight: { boot, app, appLaunch, seed, appReady, routeOpen },
        expectReducedMotion,
      });
    }

    // The route event is delivered only after the development client has
    // passed readiness. Give navigation/automation one render before taking
    // the seed screenshot and starting the target assertion.
    sleep(1800);
    screenshotCapture = captureScenarioScreenshot(deviceId, screenshotPath);

    const maestroEnv = {
      ...process.env,
      JAVA_HOME: javaHome,
    };
    maestro = run(
      maestroBin,
      [
        'test',
        '--no-ansi',
        '--device',
        deviceId,
        `--debug-output=${path.join(scenarioDir, 'maestro-debug')}`,
        `--test-output-dir=${scenarioDir}`,
        '--env',
        `SCREEN_ID=${screenId}`,
        '--env',
        `PRIMARY_ID=${primaryId}`,
        '--env',
        `SHOT_NAME=${scenario}-asserted`,
        ASSERT_FLOW,
      ],
      maestroEnv,
    );
  }

  // The seed process captures an initial history snapshot, but a development
  // client may finish loading only after Maestro starts. Re-read the simulator
  // container after the assertion so animation/state evidence is not lost.
  const runtimeHistoryCapture = captureRuntimeHistoryArtifact(deviceId, scenarioDir);
  const seedOk = seed.status === 0;
  const maestroOk = maestro.status === 0;
  const screenshotOk = screenshotCapture.ok && fs.existsSync(screenshotPath);
  const assertedScreenshotOk = fs.existsSync(assertedScreenshotPath);
  const runtimeDebugHistoryPath = path.join(scenarioDir, 'runtime-debug-history.json');
  const runtimeHistoryEvidence = validateRuntimeHistoryArtifact(
    runtimeDebugHistoryPath,
    scenario,
    { expectReducedMotion },
  );
  const runtimeHistoryOk = runtimeHistoryEvidence.ok;
  return {
    scenario,
    deviceId,
    evidenceLevel: 'E2',
    integrated: false,
    status:
      seedOk && maestroOk && screenshotOk && assertedScreenshotOk && runtimeHistoryOk
        ? 'PASS'
        : 'FAIL',
    checks: {
      seedExitCode: seed.status,
      maestroExitCode: maestro.status,
      screenshotExists: screenshotOk,
      assertedScreenshotExists: assertedScreenshotOk,
      runtimeHistoryExists: runtimeHistoryOk,
      runtimeHistoryEntryCount: runtimeHistoryEvidence.entryCount,
      runtimeHistoryRequiredSteps: runtimeHistoryEvidence.requiredSteps,
      runtimeHistoryMissingSteps: runtimeHistoryEvidence.missingSteps,
      expectedReducedMotion: Boolean(expectReducedMotion),
      reducedMotionExpectationApplicable:
        runtimeHistoryEvidence.reducedMotionExpectationApplicable,
      runtimeHistoryReducedMotionObserved: runtimeHistoryEvidence.reducedMotionObserved,
      runtimeHistoryReducedMotionStaticEntryCount:
        runtimeHistoryEvidence.reducedMotionStaticEntryCount,
      screenId,
      primaryId,
    },
    artifacts: {
      screenshot: screenshotOk ? relativeToRun(runDir, screenshotPath) : null,
      assertedScreenshot: assertedScreenshotOk
        ? relativeToRun(runDir, assertedScreenshotPath)
        : null,
      runtimeDebugHistory: runtimeHistoryOk
        ? relativeToRun(runDir, runtimeDebugHistoryPath)
        : null,
    },
      diagnostics: {
      preflight: {
        boot,
        app,
        simulatorLocation: preflightDevice?.simulatorLocation || null,
        appLaunch,
        stateReload,
        appReady,
        routeOpen,
        screenshotCapture,
        scenarioDevClientUrl: buildDevClientDeepLink(bundleUrl),
      },
      seed: tail(seed.stderr || seed.stdout),
      maestro: tail(maestro.stderr || maestro.stdout),
      appReady: appReady?.reason || null,
      routeOpen: routeOpen.reason,
      screenshotCapture: screenshotCapture.reason,
      runtimeHistory: runtimeHistoryEvidence.reason,
      runtimeHistoryCapture: runtimeHistoryCapture.reason,
    },
      runtimeHistoryCaptureOk: runtimeHistoryCapture.ok,
  };
}

function writeReport(runDir, results, metadata) {
  const report = {
    generatedAt: new Date().toISOString(),
    evidenceLevel: 'E2',
    integrated: false,
    rules: {
      stateInjectionCountsAsIntegratedE2E: false,
      skipSocketToken: true,
      paymentProviderCalled: false,
      passRequiresSeedScreenshotAssertedScreenshotAndRuntimeHistory: true,
      runtimeHistoryCapturedAfterAssertions: true,
      runtimeHistoryMustContainMapAnimationForMapScenarios: true,
      reducedMotionExpectationIsOptIn: true,
      preflightRequiresAllSelectedSimulatorsBooted: true,
      preflightRequiresQaSimulatorLocation: true,
      bilateralRunRequiresPassengerAndDriverDevices: true,
      sequentialSingleDeviceRunsAllowed: true,
      preflightRequiresAppInstalledAndReady: true,
      preflightRequiresAppReactivationBeforeEachScenario: true,
      scenarioRequiresPostSeedAppReadyBeforeRoute: true,
      scenarioRouteOpenedOnlyAfterReadiness: true,
      scenarioScreenshotCapturedAfterRoute: true,
      simctlTimeoutAcceptedOnlyWithSemanticEvidence: true,
      scenarioIsNotRunWhenPreflightFails: true,
      scenarioIsNotRunWhenPerScenarioAppLaunchFails: true,
      scenarioIsNotRunWhenPostSeedAppReadyFails: true,
    },
    metadata,
    summary: {
      total: results.length,
      passed: results.filter((item) => item.status === 'PASS').length,
      failed: results.filter((item) => item.status === 'FAIL').length,
      notRun: results.filter((item) => item.status === 'NOT_RUN').length,
    },
    results,
  };
  const jsonPath = path.join(runDir, 'matrix.json');
  const mdPath = path.join(runDir, 'MATRIX_REPORT.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    '# Prototype iOS state matrix',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    'This is E2 isolated evidence. It uses state injection and `--skip-socket-token`; it is not authenticated E3 and does not prove quote, Pix, Socket.IO, receipt or ledger behavior.',
    '',
    `Summary: ${report.summary.passed}/${report.summary.total} PASS; ${report.summary.failed} FAIL; ${report.summary.notRun} NOT_RUN`,
    '',
    '| Scenario | Status | Screen ID | Primary ID | Seed screenshot | Asserted screenshot | Runtime history |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  results.forEach((item) => {
    lines.push(
      `| ${item.scenario} | ${item.status} | ${item.checks.screenId || ''} | ${item.checks.primaryId || ''} | ${item.artifacts.screenshot || ''} | ${item.artifacts.assertedScreenshot || ''} | ${item.artifacts.runtimeDebugHistory || ''} |`,
    );
  });
  lines.push('', '## Execution metadata', '');
  lines.push(`- Passenger device: ${metadata.passengerDevice || 'not selected'}`);
  lines.push(`- Driver device: ${metadata.driverDevice || 'not selected'}`);
  lines.push(`- Java home: ${metadata.javaHome || 'not resolved'}`);
  lines.push(`- Maestro: ${metadata.maestro || 'not resolved'}`);
  lines.push(`- Freeze: ${metadata.freezeMs} ms`);
  lines.push(`- Metro: ${metadata.metroUrl || 'not resolved'}`);
  lines.push(`- iOS bundle: ${metadata.bundleUrl || 'not resolved'}`);
  lines.push(`- Preflight: ${metadata.preflightPassed ? 'PASS' : 'FAIL/NOT_RUN'}`);
  fs.writeFileSync(mdPath, `${lines.join('\n')}\n`);
  return { jsonPath, mdPath };
}

function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    printUsage();
    return;
  }

  const passengerDevice = arg('--passenger-device', '').trim();
  const driverDevice = arg('--driver-device', '').trim();
  const role = arg('--role', 'all').trim().toLowerCase();
  const requestedScenario = arg('--scenario', '').trim();
  const expectReducedMotion = hasFlag('--expect-reduced-motion');
  const freezeMs = Math.max(30000, Number(arg('--freeze-ms', '600000')) || 600000);
  const javaHome = resolveJavaHome();
  const maestroBin = resolveMaestro();

  if (!['all', 'passenger', 'driver'].includes(role)) {
    throw new Error(`invalid_role:${role}; expected all, passenger or driver`);
  }
  if (!javaHome) {
    throw new Error('JAVA_17_NOT_FOUND: set JAVA_HOME or install Temurin 17 before running Maestro');
  }
  if (!maestroBin) {
    throw new Error('MAESTRO_NOT_FOUND: set MAESTRO_BIN or install Maestro');
  }

  const scenarios = requestedScenario
    ? [requestedScenario]
    : [
        ...(role === 'driver' ? [] : PASSENGER_SCENARIOS),
        ...(role === 'passenger' ? [] : DRIVER_SCENARIOS),
      ];
  scenarios.forEach((scenario) => {
    if (!ASSERTIONS[scenario]) {
      throw new Error(`unknown_scenario_or_assertion:${scenario}`);
    }
  });
  const needsPassenger = scenarios.some((scenario) => scenario.startsWith('passenger-'));
  const needsDriver = scenarios.some((scenario) => scenario.startsWith('driver-'));
  if (needsPassenger && !passengerDevice) {
    throw new Error('--passenger-device is required for passenger scenarios');
  }
  if (needsDriver && !driverDevice) {
    throw new Error('--driver-device is required for driver scenarios');
  }

  const runDir = path.resolve(
    arg('--out-dir', path.join(MOBILE_DIR, 'test-results/ux-lab', `${timestamp()}-current-state-matrix`)),
  );
  fs.mkdirSync(runDir, { recursive: true });
  const metroUrl = resolveMetroUrl();
  const bundleUrl = resolveBundleUrl(metroUrl);
  const metro = checkMetroReady(bundleUrl);
  const selectedDevices = [...new Set(
    scenarios.map((scenario) =>
      scenario.startsWith('driver-') ? driverDevice : passengerDevice,
    ),
  )];
  const preflight = {
    metro,
    devices: {},
  };
  const deviceRoles = {};
  scenarios.forEach((scenario) => {
    const deviceId = scenario.startsWith('driver-') ? driverDevice : passengerDevice;
    deviceRoles[deviceId] = scenario.startsWith('driver-') ? 'driver' : 'passenger';
  });

  if (needsPassenger && needsDriver && passengerDevice && driverDevice && passengerDevice === driverDevice) {
    throw new Error('PASSENGER_AND_DRIVER_DEVICES_MUST_BE_DIFFERENT');
  }

  if (metro.ok) {
    selectedDevices.forEach((deviceId) => {
      preflight.devices[deviceId] = preflightAppOnSimulator({
        deviceId,
        role: deviceRoles[deviceId],
        runDir,
        maestroBin,
        javaHome,
        bundleUrl,
      });
    });
  }

  const preflightPassed =
    metro.ok &&
    selectedDevices.length > 0 &&
    selectedDevices.every((deviceId) => preflight.devices[deviceId]?.ok);
  const results = preflightPassed
    ? scenarios.map((scenario) =>
        runScenario({
          scenario,
          deviceId: scenario.startsWith('driver-') ? driverDevice : passengerDevice,
          runDir,
          freezeMs,
          maestroBin,
          javaHome,
          expectReducedMotion,
          bundleUrl,
          preflightDevice: preflight.devices[
            scenario.startsWith('driver-') ? driverDevice : passengerDevice
          ],
        }),
      )
    : scenarios.map((scenario) => {
        const deviceId = scenario.startsWith('driver-') ? driverDevice : passengerDevice;
        const devicePreflight = preflight.devices[deviceId] || null;
        const reason = !metro.ok
          ? metro.reason
          : devicePreflight?.reason || 'simulator_preflight_failed';
        return buildNotRunResult({
          scenario,
          deviceId,
          reason,
          preflight: {
            metro,
            device: devicePreflight,
          },
          expectReducedMotion,
        });
      });
  const paths = writeReport(runDir, results, {
    role,
    passengerDevice,
    driverDevice,
    javaHome,
    maestro: maestroBin,
    freezeMs,
    metroUrl,
    bundleUrl,
    selectedDevices,
    executionMode: selectedDevices.length > 1 ? 'bilateral' : 'sequential_single_device',
    preflightPassed,
    preflight,
    expectReducedMotion,
  });
  process.stdout.write(`${JSON.stringify({
    ok: results.every((item) => item.status === 'PASS'),
    runDir,
    paths,
    summary: {
      total: results.length,
      passed: results.filter((item) => item.status === 'PASS').length,
      failed: results.filter((item) => item.status === 'FAIL').length,
      notRun: results.filter((item) => item.status === 'NOT_RUN').length,
    },
  }, null, 2)}\n`);
  if (results.some((item) => item.status === 'FAIL')) {
    process.exitCode = 1;
  } else if (results.some((item) => item.status === 'NOT_RUN')) {
    process.exitCode = 2;
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  ASSERTIONS,
  buildDevClientDeepLink,
  buildIosBundleUrl,
  captureRuntimeHistoryArtifact,
  DRIVER_SCENARIOS,
  isAlreadyStoppedTerminationOutput,
  PASSENGER_SCENARIOS,
  resolveJavaHome,
  validateRuntimeHistoryArtifact,
};
