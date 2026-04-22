#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');

function parseArgs(argv) {
  const args = {
    tracker: '',
    mobileEnv: '',
    backendEnv: '',
    healthUrl: '',
    report: '',
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--tracker') {
      args.tracker = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--mobile-env') {
      args.mobileEnv = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--backend-env') {
      args.backendEnv = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--health-url') {
      args.healthUrl = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--report') {
      args.report = argv[index + 1] || '';
      index += 1;
    }
  }

  return args;
}

function normalizeBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  const env = {};
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = value;
  }
  return env;
}

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  return raw.replace(/\/+$/, '');
}

function resolveHealthUrl(explicitHealthUrl, mobileEnv, backendEnv) {
  if (explicitHealthUrl) {
    return explicitHealthUrl;
  }

  const candidates = [
    mobileEnv.EXPO_PUBLIC_API_URL,
    mobileEnv.EXPO_PUBLIC_BACKEND_URL,
    backendEnv.API_URL,
    backendEnv.BACKEND_URL,
    'https://api.147.182.204.181.sslip.io',
  ]
    .map(normalizeBaseUrl)
    .filter(Boolean);

  if (candidates.length === 0) {
    return '';
  }

  return `${candidates[0]}/health`;
}

function findLatestTracker(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return '';
  }

  const found = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
      continue;
    }

    if (path.basename(current) === 'tracker.md') {
      found.push({ file: current, mtimeMs: stat.mtimeMs });
    }
  }

  found.sort((left, right) => right.mtimeMs - left.mtimeMs);
  return found[0]?.file || '';
}

function parseTrackerRows(markdown) {
  return markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length >= 8 && /^W\d/.test(cells[1] || ''))
    .map((cells) => ({
      id: cells[1],
      scenario: cells[2],
      mode: cells[3],
      priority: cells[4],
      status: String(cells[5] || '').toLowerCase(),
      evidence: cells[6],
      notes: cells[7],
    }));
}

function isPilotRequiredScenario(row) {
  return (
    row.priority === 'P0' &&
    (
      row.id.startsWith('W1-') ||
      row.id.startsWith('W2-') ||
      row.id.startsWith('W3-') ||
      row.id.startsWith('W4-')
    )
  );
}

function runPilotGoGate(rootDir, trackerPath) {
  try {
    const output = execFileSync(
      'node',
      [
        path.join(rootDir, 'scripts', 'validation', 'check-pilot-go.cjs'),
        '--tracker',
        trackerPath,
      ],
      {
        cwd: rootDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          LEAF_LAUNCH_PROFILE: 'pilot_controlled',
        },
      },
    );

    const resultLine = output
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('result:'));

    return {
      ok: String(resultLine || '').includes('GO_CANDIDATE'),
      output,
    };
  } catch (error) {
    return {
      ok: false,
      output: String(error?.stdout || error?.message || ''),
    };
  }
}

function httpGetOnce(url) {
  return new Promise((resolve) => {
    if (!url) {
      resolve({
        status: 'skipped',
        code: null,
        body: '',
        healthState: '',
        notes: 'health url not provided',
      });
      return;
    }

    const client = url.startsWith('https://') ? https : http;
    const request = client.get(url, { timeout: 8000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        let parsedStatus = '';
        try {
          const parsed = JSON.parse(body);
          parsedStatus = String(parsed?.status || '').trim().toLowerCase();
        } catch (_error) {
          parsedStatus = '';
        }

        resolve({
          status:
            response.statusCode >= 200 && response.statusCode < 300
              ? 'pass'
              : 'fail',
          code: response.statusCode,
          body,
          healthState: parsedStatus,
          notes: '',
        });
      });
    });

    request.on('timeout', () => {
      request.destroy(new Error('timeout'));
    });

    request.on('error', (error) => {
      resolve({
        status: 'fail',
        code: null,
        body: '',
        healthState: '',
        notes: error.message || 'health request failed',
      });
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function httpGet(url, { attempts = 3, delayMs = 1500 } = {}) {
  if (!url) {
    return httpGetOnce(url);
  }

  const samples = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await httpGetOnce(url);
    samples.push({
      attempt,
      code: result.code,
      status: result.status,
      healthState: result.healthState,
      notes: result.notes,
    });

    if (attempt < attempts) {
      await wait(delayMs);
    }
  }

  const passSamples = samples.filter((sample) => sample.status === 'pass');
  const unhealthySamples = samples.filter((sample) => sample.healthState === 'unhealthy');
  const warningSamples = samples.filter((sample) => sample.healthState === 'warning');
  const mixedCodes = new Set(samples.map((sample) => `${sample.code}:${sample.status}`)).size > 1;
  const last = samples[samples.length - 1];

  let status = 'fail';
  let notes = last.notes || '';

  if (passSamples.length === samples.length && unhealthySamples.length === 0) {
    status = 'pass';
    if (warningSamples.length > 0) {
      notes = 'health returned warning state';
    }
  } else if (passSamples.length > 0 && unhealthySamples.length === 0 && mixedCodes) {
    status = 'fail';
    notes = 'health flapping between success and failure';
  } else if (unhealthySamples.length > 0) {
    status = 'fail';
    notes = 'health reported unhealthy state';
  } else if (!notes) {
    notes = 'health request failed in all attempts';
  }

  return {
    status,
    code: last.code,
    body: last.body || '',
    healthState: last.healthState || '',
    notes,
    attempts: samples,
  };
}

function evaluateLaunchFlags(label, env, expectedProfileKey, expectedFeatureKeys) {
  const findings = [];
  const launchProfile = String(env[expectedProfileKey] || '').trim().toLowerCase();

  if (launchProfile !== 'pilot_controlled') {
    findings.push(`${label}: ${expectedProfileKey} should be pilot_controlled`);
  }

  for (const featureKey of expectedFeatureKeys) {
    const enabled = normalizeBoolean(env[featureKey], null);
    if (enabled !== false) {
      findings.push(`${label}: ${featureKey} should be false during pilot`);
    }
  }

  return {
    ok: findings.length === 0,
    findings,
    launchProfile,
  };
}

function ensureReportPath(rootDir, explicitPath) {
  if (explicitPath) {
    return path.resolve(rootDir, explicitPath);
  }

  const stamp = new Date().toISOString().replace(/[:]/g, '-');
  return path.join(rootDir, 'reports', 'pilot-preflight', `pilot-preflight-${stamp}.md`);
}

async function main() {
  const rootDir = process.cwd();
  const args = parseArgs(process.argv);
  const trackerPath = args.tracker
    ? path.resolve(rootDir, args.tracker)
    : findLatestTracker(path.join(rootDir, 'reports', 'validation-runs'));

  if (!trackerPath || !fs.existsSync(trackerPath)) {
    console.error('tracker.md nao encontrado. Informe --tracker.');
    process.exit(2);
  }

  const mobileEnvPath = args.mobileEnv
    ? path.resolve(rootDir, args.mobileEnv)
    : path.join(rootDir, 'mobile-app', '.env.pilot.example');
  const backendEnvPath = args.backendEnv
    ? path.resolve(rootDir, args.backendEnv)
    : path.join(rootDir, 'leaf-websocket-backend', 'config', 'pilot-controlled.env.example');
  const reportPath = ensureReportPath(rootDir, args.report);

  const trackerRows = parseTrackerRows(fs.readFileSync(trackerPath, 'utf8'));
  const p0Rows = trackerRows.filter((row) => row.priority === 'P0');
  const openP0Rows = p0Rows.filter((row) => row.status !== 'pass');
  const requiredP0Rows = trackerRows.filter(isPilotRequiredScenario);
  const openRequiredP0Rows = requiredP0Rows.filter((row) => row.status !== 'pass');
  const mobileEnv = parseEnvFile(mobileEnvPath);
  const backendEnv = parseEnvFile(backendEnvPath);
  const gate = runPilotGoGate(rootDir, trackerPath);
  const healthUrl = resolveHealthUrl(args.healthUrl, mobileEnv, backendEnv);
  const health = await httpGet(healthUrl);

  const mobileFlags = evaluateLaunchFlags('mobile', mobileEnv, 'EXPO_PUBLIC_LEAF_LAUNCH_PROFILE', [
    'EXPO_PUBLIC_ENABLE_DRIVER_WITHDRAWALS',
    'EXPO_PUBLIC_ENABLE_REFERRAL_PROGRAMS',
    'EXPO_PUBLIC_ENABLE_SOFT_BAN_ENFORCEMENT',
    'EXPO_PUBLIC_ENABLE_ADMIN_MUTATIONS',
  ]);
  const backendFlags = evaluateLaunchFlags('backend', backendEnv, 'LEAF_LAUNCH_PROFILE', [
    'ENABLE_DRIVER_WITHDRAWALS',
    'ENABLE_REFERRAL_PROGRAMS',
    'ENABLE_SOFT_BAN_ENFORCEMENT',
    'ENABLE_ADMIN_MUTATIONS',
  ]);

  const blockers = [
    ...mobileFlags.findings,
    ...backendFlags.findings,
  ];

  if (health.status === 'fail') {
    blockers.push(`health: ${health.notes || `unexpected status ${health.code}`}`);
  }

  const overallPass = gate.ok && blockers.length === 0;
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });

  const report = `# Pilot Controlled Preflight

- Date: ${new Date().toISOString()}
- Tracker: ${trackerPath}
- Report status: ${overallPass ? 'PASS' : 'FAIL'}
- Gate result: ${gate.ok ? 'GO_CANDIDATE' : 'NO_GO'}

## Tracker

- P0 rows total: ${p0Rows.length}
- Open P0 rows total: ${openP0Rows.length}
- Pilot required P0 rows: ${requiredP0Rows.length}
- Pilot required open rows: ${openRequiredP0Rows.length}

## Launch profile

- Mobile env: ${mobileEnvPath}
- Mobile profile: ${mobileFlags.launchProfile || 'missing'}
- Backend env: ${backendEnvPath}
- Backend profile: ${backendFlags.launchProfile || 'missing'}

## Health

- URL: ${healthUrl || 'n/a'}
- Status: ${health.status}
- HTTP code: ${health.code ?? 'n/a'}
- Health state: ${health.healthState || 'n/a'}
- Notes: ${health.notes || 'ok'}
- Attempts:
${Array.isArray(health.attempts) && health.attempts.length > 0
  ? health.attempts
      .map((sample) => `  - #${sample.attempt}: code=${sample.code ?? 'n/a'} status=${sample.status} health_state=${sample.healthState || 'n/a'} notes=${sample.notes || 'ok'}`)
      .join('\n')
  : '  - none'}

## Blockers

${blockers.length === 0 ? '- none' : blockers.map((item) => `- ${item}`).join('\n')}

## Gate output

\`\`\`
${gate.output.trim()}
\`\`\`
`;

  fs.writeFileSync(reportPath, `${report}\n`);

  console.log(`# Pilot preflight`);
  console.log(`tracker: ${trackerPath}`);
  console.log(`report: ${reportPath}`);
  console.log(`status: ${overallPass ? 'PASS' : 'FAIL'}`);
  console.log(`gate: ${gate.ok ? 'GO_CANDIDATE' : 'NO_GO'}`);
  console.log(`pilot_required_p0_rows: ${requiredP0Rows.length}`);
  console.log(`pilot_required_open_rows: ${openRequiredP0Rows.length}`);
  console.log(`health_url: ${healthUrl || 'n/a'}`);
  console.log(`health: ${health.status}`);
  console.log(`health_state: ${health.healthState || 'n/a'}`);
  if (Array.isArray(health.attempts) && health.attempts.length > 0) {
    console.log(`health_attempts: ${health.attempts.map((sample) => `${sample.code ?? 'n/a'}/${sample.healthState || 'n/a'}`).join(',')}`);
  }
  console.log(`mobile_profile: ${mobileFlags.launchProfile || 'missing'}`);
  console.log(`backend_profile: ${backendFlags.launchProfile || 'missing'}`);
  console.log(`blockers: ${blockers.length}`);

  if (!overallPass) {
    process.exit(1);
  }
}

main();
