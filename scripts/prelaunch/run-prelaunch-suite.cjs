#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const mobileDir = path.join(rootDir, 'mobile-app');
const backendDir = path.join(rootDir, 'leaf-websocket-backend');

function parseArgs(argv) {
  const parsed = {
    mode: process.env.PRELAUNCH_MODE || 'audit',
    rides: null,
    rideMaxAttempts: Number(process.env.PRELAUNCH_RIDE_MAX_ATTEMPTS || ''),
    strict: true,
    skipBuilds: false,
    skipMaestro: false,
    evidenceFile: process.env.PRELAUNCH_EVIDENCE_FILE || '',
    apiBaseUrl: process.env.PRELAUNCH_API_BASE_URL || process.env.API_BASE_URL || 'https://api.leaf.app.br',
    wsUrl: process.env.PRELAUNCH_WS_URL || process.env.WS_URL || 'https://socket.leaf.app.br',
    rideServerUrl: process.env.PRELAUNCH_RIDE_SERVER_URL || process.env.API_BASE_URL || 'https://api.leaf.app.br',
    metricsUrl: process.env.PRELAUNCH_METRICS_URL || '',
    metricsToken: process.env.PRELAUNCH_METRICS_TOKEN || process.env.AUTH_TOKEN || process.env.LEAF_ADMIN_BEARER_TOKEN || '',
    reportDir: process.env.PRELAUNCH_REPORT_DIR || ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const [flag, inlineValue] = item.split('=');
    const nextValue = inlineValue !== undefined ? inlineValue : argv[index + 1];

    switch (flag) {
      case '--mode':
        parsed.mode = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case '--rides':
        parsed.rides = Number(nextValue);
        if (inlineValue === undefined) index += 1;
        break;
      case '--ride-max-attempts':
        parsed.rideMaxAttempts = Number(nextValue);
        if (inlineValue === undefined) index += 1;
        break;
      case '--evidence-file':
        parsed.evidenceFile = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case '--api-base-url':
        parsed.apiBaseUrl = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case '--ws-url':
        parsed.wsUrl = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case '--ride-server-url':
        parsed.rideServerUrl = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case '--metrics-url':
        parsed.metricsUrl = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case '--metrics-token':
        parsed.metricsToken = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case '--report-dir':
        parsed.reportDir = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case '--no-strict':
        parsed.strict = false;
        break;
      case '--skip-builds':
        parsed.skipBuilds = true;
        break;
      case '--skip-maestro':
        parsed.skipMaestro = true;
        break;
      default:
        break;
    }
  }

  if (!Number.isFinite(parsed.rides)) {
    parsed.rides = parsed.mode === 'full' || parsed.mode === 'rides' ? 10 : 0;
  }
  if (!Number.isFinite(parsed.rideMaxAttempts) || parsed.rideMaxAttempts < parsed.rides) {
    parsed.rideMaxAttempts = parsed.rides + Math.max(3, Math.ceil(parsed.rides * 0.5));
  }

  return parsed;
}

function timestampTag(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function runGit(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch (_error) {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function defaultMetricsUrl(options) {
  return options.metricsUrl || `${trimTrailingSlash(options.apiBaseUrl)}/api/metrics/prometheus`;
}

function markdownTable(rows, columns) {
  const header = `| ${columns.map((column) => column.label).join(' |')} |`;
  const divider = `| ${columns.map(() => '---').join(' |')} |`;
  const body = rows.map((row) => `| ${columns.map((column) => String(row[column.key] ?? '').replace(/\n/g, '<br>')).join(' |')} |`);
  return [header, divider, ...body].join('\n');
}

function flattenEvidenceBooleans(value, prefix = '') {
  const rows = [];
  if (!value || typeof value !== 'object') return rows;

  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'boolean') {
      rows.push({ key: fullKey, ok: child });
    } else if (child && typeof child === 'object' && !Array.isArray(child)) {
      rows.push(...flattenEvidenceBooleans(child, fullKey));
    }
  }
  return rows;
}

function extractJsonObject(text) {
  const raw = String(text || '').trim();
  const reportIndex = raw.lastIndexOf('{\n  "reportFile"');
  const start = reportIndex >= 0 ? reportIndex : raw.lastIndexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;
  for (let index = start; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        end = index + 1;
        break;
      }
    }
  }

  const candidate = raw.slice(start, end > start ? end : undefined).trim();
  try {
    return JSON.parse(candidate);
  } catch (_error) {
    return null;
  }
}

function statusIcon(status) {
  if (status === 'passed') return 'PASS';
  if (status === 'failed') return 'FAIL';
  if (status === 'skipped') return 'SKIP';
  if (status === 'manual_required') return 'MANUAL';
  return status.toUpperCase();
}

async function runCommandGate({ id, title, command, cwd = rootDir, env = {}, enabled = true, required = true, timeoutMs = 0 }, context) {
  const startedAt = Date.now();
  const logFile = path.join(context.logsDir, `${id}.log`);

  if (!enabled) {
    return {
      id,
      title,
      required: false,
      status: 'skipped',
      durationMs: 0,
      logFile: ''
    };
  }

  ensureDir(path.dirname(logFile));
  const out = fs.createWriteStream(logFile, { flags: 'w' });
  out.write(`$ ${command}\n\n`);

  return new Promise((resolve) => {
    let timedOut = false;
    const child = spawn(command, {
      cwd,
      env: {
        ...process.env,
        PRELAUNCH_RUN_ID: context.runId,
        ...env
      },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, timeoutMs);
    }

    child.stdout.on('data', (chunk) => out.write(chunk));
    child.stderr.on('data', (chunk) => out.write(chunk));

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      out.end(`\n[prelaunch] exit=${code}${timedOut ? ' timeout=true' : ''}\n`);
      resolve({
        id,
        title,
        required,
        status: code === 0 && !timedOut ? 'passed' : 'failed',
        exitCode: code,
        durationMs: Date.now() - startedAt,
        logFile,
        error: timedOut ? 'timeout' : code === 0 ? '' : `exit_${code}`
      });
    });
  });
}

async function runFunctionGate({ id, title, fn, enabled = true, required = true }, context) {
  const startedAt = Date.now();
  const logFile = path.join(context.logsDir, `${id}.log`);

  if (!enabled) {
    return { id, title, required: false, status: 'skipped', durationMs: 0, logFile: '' };
  }

  ensureDir(path.dirname(logFile));

  try {
    const details = await fn(context, logFile);
    fs.writeFileSync(logFile, `${JSON.stringify(details || {}, null, 2)}\n`);
    return {
      id,
      title,
      required,
      status: 'passed',
      durationMs: Date.now() - startedAt,
      logFile,
      details
    };
  } catch (error) {
    fs.writeFileSync(logFile, `${error.stack || error.message}\n`);
    return {
      id,
      title,
      required,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      logFile,
      error: error.message
    };
  }
}

function redactAuthPayload(text) {
  try {
    const parsed = JSON.parse(text);
    return {
      success: parsed.success,
      error: parsed.error,
      user: parsed.user
        ? {
          id: parsed.user.id,
          email: parsed.user.email,
          role: parsed.user.role
        }
        : undefined
    };
  } catch (_error) {
    return { raw: String(text || '').slice(0, 500) };
  }
}

async function loginForAdminBearer(context) {
  const autoLogin = String(process.env.AUTO_LOGIN_ADMIN_TOKEN || 'true').toLowerCase() !== 'false';
  if (!autoLogin) {
    return { token: '', source: 'disabled' };
  }

  const email = process.env.ADMIN_AUTH_EMAIL || process.env.TEST_ADMIN_EMAIL || process.env.SMOKE_ADMIN_EMAIL || 'admin@leaf.com';
  const password = process.env.ADMIN_AUTH_PASSWORD || process.env.TEST_ADMIN_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD || 'admin123';
  const url = `${trimTrailingSlash(context.options.apiBaseUrl)}/api/admin/auth/login`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();

  const artifact = path.join(context.artifactsDir, 'metrics-admin-login.json');
  const sanitized = {
    url,
    status: response.status,
    ok: response.ok,
    ...redactAuthPayload(text)
  };
  fs.writeFileSync(artifact, `${JSON.stringify(sanitized, null, 2)}\n`);

  if (!response.ok) {
    return { token: '', source: 'admin_login_failed', artifact };
  }

  try {
    const parsed = JSON.parse(text);
    return parsed.accessToken
      ? { token: parsed.accessToken, source: 'admin_login', artifact }
      : { token: '', source: 'admin_login_missing_token', artifact };
  } catch (_error) {
    return { token: '', source: 'admin_login_invalid_json', artifact };
  }
}

async function resolveMetricsBearer(context) {
  if (context.options.metricsToken) {
    return { token: context.options.metricsToken, source: 'env' };
  }

  return loginForAdminBearer(context);
}

async function fetchTextArtifact(context, name, url, headers = {}) {
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(15000)
  });
  const text = await response.text();
  const artifact = path.join(context.artifactsDir, `${name}.txt`);
  fs.writeFileSync(artifact, text);
  return { status: response.status, ok: response.ok, artifact, url };
}

async function checkObservability(context) {
  const apiBaseUrl = trimTrailingSlash(context.options.apiBaseUrl);
  const urls = {
    health: `${apiBaseUrl}/health`,
    runtimeFlags: `${apiBaseUrl}/health/runtime-flags`,
    metrics: defaultMetricsUrl(context.options)
  };

  const results = {};

  for (const [name, url] of Object.entries({ health: urls.health, runtimeFlags: urls.runtimeFlags })) {
    const result = await fetchTextArtifact(context, name, url);
    results[name] = result;
    if (!result.ok) {
      throw new Error(`${name}_http_${result.status}`);
    }
  }

  let metricsAuth = { token: context.options.metricsToken, source: context.options.metricsToken ? 'env' : 'none' };
  let metricsHeaders = metricsAuth.token ? { Authorization: `Bearer ${metricsAuth.token}` } : {};
  results.metrics = await fetchTextArtifact(context, 'metrics', urls.metrics, metricsHeaders);

  if ((results.metrics.status === 401 || results.metrics.status === 403) && !metricsAuth.token) {
    metricsAuth = await resolveMetricsBearer(context);
    metricsHeaders = metricsAuth.token ? { Authorization: `Bearer ${metricsAuth.token}` } : {};
    if (metricsAuth.token) {
      results.metrics = await fetchTextArtifact(context, 'metrics', urls.metrics, metricsHeaders);
    }
  }

  if (!results.metrics.ok) {
    const hint = results.metrics.status === 401 || results.metrics.status === 403
      ? `_token_source_${metricsAuth.source || 'none'}`
      : '';
    throw new Error(`metrics_http_${results.metrics.status}${hint}`);
  }

  const metricsText = fs.readFileSync(results.metrics.artifact, 'utf8');
  const expectedMetrics = [
    'leaf_rides_requested_total',
    'leaf_rides_accepted_total',
    'leaf_rides_completed_total',
    'leaf_command_total',
    'leaf_redis_duration_seconds'
  ];
  const missingMetrics = expectedMetrics.filter((metric) => !metricsText.includes(metric));

  const requiredFiles = [
    'observability/prometheus/prometheus.yml',
    'observability/prometheus/alert-rules.yml',
    'observability/tempo-config.yaml'
  ];
  const missingFiles = requiredFiles.filter((relativeFile) => !fs.existsSync(path.join(rootDir, relativeFile)));

  if (missingMetrics.length || missingFiles.length) {
    throw new Error(`observability_incomplete missingMetrics=${missingMetrics.join(',') || 'none'} missingFiles=${missingFiles.join(',') || 'none'}`);
  }

  return {
    urls,
    metricsAuthSource: metricsAuth.source,
    expectedMetrics,
    requiredFiles
  };
}

async function runRideLoop(context) {
  const rides = [];
  const attempts = [];
  const targetRides = context.options.rides;
  const maxAttempts = context.options.rideMaxAttempts;

  for (let attempt = 1; rides.length < targetRides && attempt <= maxAttempts; attempt += 1) {
    const rideNumber = rides.length + 1;
    const id = `ride_${String(rideNumber).padStart(2, '0')}_attempt_${String(attempt).padStart(2, '0')}`;
    const gate = await runCommandGate({
      id,
      title: `Corrida completa ${rideNumber}/${targetRides} (tentativa ${attempt}/${maxAttempts})`,
      cwd: backendDir,
      command: 'node scripts/tests/run-real-core-e2e-cost.cjs',
      env: {
        REAL_CORE_SERVER_URL: context.options.wsUrl,
        REAL_CORE_WS_URL: context.options.wsUrl,
        REAL_CORE_API_BASE_URL: context.options.apiBaseUrl,
        REAL_CORE_METRICS_URL: defaultMetricsUrl(context.options),
        PRELAUNCH_METRICS_TOKEN: context.options.metricsToken,
        WS_URL: context.options.wsUrl,
        API_BASE_URL: context.options.apiBaseUrl
      },
      required: false,
      timeoutMs: 360000
    }, context);

    let summary = null;
    if (gate.logFile && fs.existsSync(gate.logFile)) {
      summary = extractJsonObject(fs.readFileSync(gate.logFile, 'utf8'));
    }

    const attemptSummary = {
      attempt,
      ride: rideNumber,
      status: gate.status,
      bookingId: summary?.bookingId || '',
      reportFile: summary?.reportFile || '',
      passengerId: summary?.passengerId || '',
      driverId: summary?.driverId || '',
      logFile: gate.logFile
    };

    attempts.push(attemptSummary);
    if (gate.status === 'passed') {
      rides.push({
        ...attemptSummary,
        index: rides.length + 1
      });
    }
    context.gates.push(gate);
  }

  const rideSummaryPath = path.join(context.artifactsDir, 'ride-loop-summary.json');
  fs.writeFileSync(rideSummaryPath, `${JSON.stringify({
    targetRides,
    maxAttempts,
    successfulRides: rides.length,
    attempts,
    rides
  }, null, 2)}\n`);

  return {
    id: 'ride_loop_10',
    title: `${targetRides} corridas completas`,
    required: true,
    status: rides.length === targetRides ? 'passed' : 'failed',
    durationMs: 0,
    logFile: rideSummaryPath,
    rides,
    attempts,
    error: rides.length === targetRides ? '' : `${targetRides - rides.length}_rides_missing_after_${attempts.length}_attempts`
  };
}

function loadEvidence(context) {
  if (!context.options.evidenceFile) {
    return {
      status: context.options.mode === 'full' ? 'manual_required' : 'skipped',
      rows: [],
      missing: context.options.mode === 'full' ? ['PRELAUNCH_EVIDENCE_FILE nao informado'] : []
    };
  }

  const absoluteFile = path.resolve(rootDir, context.options.evidenceFile);
  if (!fs.existsSync(absoluteFile)) {
    return {
      status: 'manual_required',
      rows: [],
      missing: [`Arquivo de evidencias nao encontrado: ${absoluteFile}`]
    };
  }

  const evidence = JSON.parse(fs.readFileSync(absoluteFile, 'utf8'));
  const rows = flattenEvidenceBooleans(evidence.manualEvidence || {});
  const missing = rows.filter((row) => !row.ok).map((row) => row.key);
  return {
    status: missing.length ? 'manual_required' : 'passed',
    rows,
    missing,
    file: absoluteFile
  };
}

function writeReport(context, evidence) {
  const reportFile = path.join(context.reportDir, 'prelaunch-report.md');
  const gatesForTable = context.gates.map((gate) => ({
    status: statusIcon(gate.status),
    gate: gate.title,
    required: gate.required ? 'yes' : 'no',
    duration: `${Math.round((gate.durationMs || 0) / 1000)}s`,
    artifact: gate.logFile ? path.relative(rootDir, gate.logFile) : ''
  }));

  const rideRows = context.rides.map((ride) => ({
    ride: ride.index,
    status: statusIcon(ride.status),
    bookingId: ride.bookingId,
    passengerId: ride.passengerId,
    driverId: ride.driverId,
    artifact: ride.reportFile ? path.relative(rootDir, ride.reportFile) : path.relative(rootDir, ride.logFile || '')
  }));

  const failedRequired = context.gates.filter((gate) => gate.required && gate.status === 'failed');
  const skippedRequired = context.gates.filter((gate) => gate.required && gate.status === 'skipped');
  const manualMissing = evidence.missing || [];
  const tenRidesOk = context.options.rides > 0
    ? context.rides.length === context.options.rides && context.rides.every((ride) => ride.status === 'passed')
    : context.options.mode !== 'full';
  const goNoGo = failedRequired.length === 0 && skippedRequired.length === 0 && tenRidesOk && manualMissing.length === 0;

  const lines = [
    `# Prelaunch Leaf Brasil - ${context.runId}`,
    '',
    `- Status: **${goNoGo ? 'GO' : 'NO-GO'}**`,
    `- Modo: \`${context.options.mode}\``,
    `- Commit: \`${context.git.commit || 'unknown'}\``,
    `- Branch: \`${context.git.branch || 'unknown'}\``,
    `- API: ${context.options.apiBaseUrl}`,
    `- Socket: ${context.options.wsUrl}`,
    `- Ride server: ${context.options.rideServerUrl}`,
    `- Metrics: ${defaultMetricsUrl(context.options)}`,
    `- Iniciado em: ${context.startedAt}`,
    `- Finalizado em: ${new Date().toISOString()}`,
    '',
    '## Gates automatizados',
    '',
    markdownTable(gatesForTable, [
      { key: 'status', label: 'Status' },
      { key: 'gate', label: 'Gate' },
      { key: 'required', label: 'Obrigatorio' },
      { key: 'duration', label: 'Duracao' },
      { key: 'artifact', label: 'Evidencia' }
    ]),
    '',
    '## Corridas completas',
    '',
    context.rides.length
      ? markdownTable(rideRows, [
        { key: 'ride', label: '#' },
        { key: 'status', label: 'Status' },
        { key: 'bookingId', label: 'Booking' },
        { key: 'passengerId', label: 'Passageiro' },
        { key: 'driverId', label: 'Motorista' },
        { key: 'artifact', label: 'Evidencia' }
      ])
      : '_Nao executado neste modo._',
    '',
    '## Evidencias manuais',
    '',
    evidence.file ? `Arquivo: \`${path.relative(rootDir, evidence.file)}\`` : '_Arquivo de evidencias nao informado._',
    '',
    evidence.status === 'skipped'
      ? '- Evidencias manuais nao avaliadas neste modo.'
      : manualMissing.length
      ? manualMissing.map((item) => `- Pendente: ${item}`).join('\n')
      : '- Todas as evidencias manuais marcadas como concluidas.',
    '',
    '## Bloqueadores',
    '',
    failedRequired.length || skippedRequired.length || manualMissing.length
      ? [
        ...failedRequired.map((gate) => `- Gate falhou: ${gate.title} (${gate.error || 'ver log'})`),
        ...skippedRequired.map((gate) => `- Gate obrigatorio pulado: ${gate.title}`),
        ...manualMissing.map((item) => `- Evidencia manual pendente: ${item}`)
      ].join('\n')
      : '- Nenhum bloqueador encontrado.',
    ''
  ];

  fs.writeFileSync(reportFile, `${lines.join('\n')}\n`);
  return { reportFile, goNoGo };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = process.env.PRELAUNCH_RUN_ID || `prelaunch-${timestampTag()}`;
  const reportDir = options.reportDir ? path.resolve(rootDir, options.reportDir) : path.join(rootDir, 'reports', 'prelaunch', runId);
  const logsDir = path.join(reportDir, 'logs');
  const artifactsDir = path.join(reportDir, 'artifacts');

  ensureDir(logsDir);
  ensureDir(artifactsDir);

  const context = {
    options,
    runId,
    reportDir,
    logsDir,
    artifactsDir,
    startedAt: new Date().toISOString(),
    git: {
      branch: runGit(['rev-parse', '--abbrev-ref', 'HEAD']),
      commit: runGit(['rev-parse', '--short', 'HEAD']),
      statusFile: path.join(artifactsDir, 'git-status.txt')
    },
    gates: [],
    rides: []
  };

  fs.writeFileSync(context.git.statusFile, `${runGit(['status', '--short'], 'git status unavailable')}\n`);

  const auditMode = options.mode === 'audit';
  const fullMode = options.mode === 'full';
  const ridesMode = options.mode === 'rides';

  const commonEnv = {
    BACKEND_URL: options.apiBaseUrl,
    API_BASE_URL: options.apiBaseUrl,
    WS_URL: options.wsUrl
  };

  const gates = [
    {
      id: 'onboarding_copy',
      title: 'Copy do onboarding sem termos tecnicos',
      command: 'node scripts/prelaunch/assert-onboarding-copy.cjs',
      required: true,
      enabled: auditMode || fullMode || ridesMode
    },
    {
      id: 'mobile_testids',
      title: 'Seletores E2E mobile obrigatorios',
      command: 'node scripts/prelaunch/assert-mobile-testids.cjs',
      required: true,
      enabled: auditMode || fullMode || ridesMode
    },
    {
      id: 'store_preflight',
      title: 'Preflight App Store / Play Store',
      command: 'bash scripts/store-console-preflight.sh',
      cwd: mobileDir,
      env: commonEnv,
      required: true,
      enabled: auditMode || fullMode
    },
    {
      id: 'backend_real_sandbox',
      title: 'Backend strict real-sandbox',
      command: `bash scripts/qa/assert-backend-real-sandbox.sh ${shellQuote(options.apiBaseUrl)} ${shellQuote(path.join(artifactsDir, 'backend-runtime-flags.json'))}`,
      cwd: mobileDir,
      env: commonEnv,
      required: true,
      enabled: auditMode || fullMode || ridesMode
    },
    {
      id: 'observability',
      title: 'Observabilidade Prometheus + dashboards locais',
      fn: checkObservability,
      required: true,
      enabled: auditMode || fullMode || ridesMode
    },
    {
      id: 'mobile_unit',
      title: 'Mobile unit tests',
      command: 'npm run test:unit --workspace mobile-app',
      required: true,
      enabled: fullMode
    },
    {
      id: 'backend_unit_integration',
      title: 'Backend unit + integration',
      command: 'npm test --workspace leaf-websocket-backend',
      required: true,
      enabled: fullMode
    },
    {
      id: 'backend_e2e',
      title: 'Backend E2E',
      command: 'npm run test:e2e --workspace leaf-websocket-backend',
      required: true,
      enabled: fullMode,
      timeoutMs: 900000
    },
    {
      id: 'support_smoke',
      title: 'Suporte usuario/admin smoke',
      command: 'node scripts/tests/smoke-support-two-profiles.cjs',
      cwd: backendDir,
      env: {
        ...commonEnv,
        SMOKE_SERVER_URL: options.apiBaseUrl
      },
      required: true,
      enabled: fullMode
    },
    {
      id: 'mobile_core_audit',
      title: 'Mobile core audit Maestro',
      command: 'npm run qa:core:audit --workspace mobile-app',
      env: commonEnv,
      required: true,
      enabled: fullMode && !options.skipMaestro,
      timeoutMs: 900000
    },
    {
      id: 'android_release_build',
      title: 'Android release build',
      command: 'npm run build:local:android:release --workspace mobile-app',
      required: true,
      enabled: fullMode && !options.skipBuilds,
      timeoutMs: 1200000
    },
    {
      id: 'android_release_install',
      title: 'Android release install/open',
      command: 'bash scripts/prelaunch/install-android-release.sh',
      required: true,
      enabled: fullMode && !options.skipBuilds,
      timeoutMs: 180000
    },
    {
      id: 'ios_release_simulator_build',
      title: 'iOS release simulator build',
      command: 'npm run build:local:ios:simulator --workspace mobile-app',
      required: true,
      enabled: fullMode && !options.skipBuilds,
      timeoutMs: 1200000
    },
    {
      id: 'ios_release_simulator_install',
      title: 'iOS release simulator install/open',
      command: 'bash scripts/prelaunch/install-ios-simulator-release.sh',
      required: true,
      enabled: fullMode && !options.skipBuilds,
      timeoutMs: 180000
    }
  ];

  for (const gate of gates) {
    const result = gate.fn
      ? await runFunctionGate(gate, context)
      : await runCommandGate(gate, context);
    context.gates.push(result);
    console.log(`${statusIcon(result.status)} ${result.title}`);
  }

  if ((fullMode || ridesMode) && options.rides > 0) {
    const rideLoopGate = await runRideLoop(context);
    context.rides = rideLoopGate.rides || [];
    context.gates.push(rideLoopGate);
    console.log(`${statusIcon(rideLoopGate.status)} ${rideLoopGate.title}`);
  }

  const evidence = loadEvidence(context);
  context.gates.push({
    id: 'manual_evidence',
    title: 'Evidencias manuais de incidentes, financeiro, suporte e lojas',
    required: fullMode,
    status: evidence.status,
    durationMs: 0,
    logFile: evidence.file || ''
  });

  const { reportFile, goNoGo } = writeReport(context, evidence);
  console.log(`\nRelatorio: ${reportFile}`);
  console.log(`Status final: ${goNoGo ? 'GO' : 'NO-GO'}`);

  if (options.strict && !goNoGo) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
