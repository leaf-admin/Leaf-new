#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const reportsRoot = path.join(rootDir, 'reports', 'canary-preflight');

function timestampTag(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseArgs(argv) {
  const options = {
    reportDir: '',
    skipMobileUnit: false,
    skipBackendTest: false,
    skipDashboardBuild: false,
    skipFinancialLive: false,
    skipWooviSandbox: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    const [flag, inlineValue] = item.split('=');
    const nextValue = inlineValue !== undefined ? inlineValue : argv[index + 1];
    switch (flag) {
      case '--report-dir':
        options.reportDir = nextValue;
        if (inlineValue === undefined) index += 1;
        break;
      case '--skip-mobile-unit':
        options.skipMobileUnit = true;
        break;
      case '--skip-backend-test':
        options.skipBackendTest = true;
        break;
      case '--skip-dashboard-build':
        options.skipDashboardBuild = true;
        break;
      case '--skip-financial-live':
        options.skipFinancialLive = true;
        break;
      case '--skip-woovi-sandbox':
        options.skipWooviSandbox = true;
        break;
      default:
        break;
    }
  }

  return options;
}

function statusLabel(status) {
  if (status === 'passed') return 'PASS';
  if (status === 'failed') return 'FAIL';
  if (status === 'skipped') return 'SKIP';
  return status.toUpperCase();
}

function markdownTable(rows) {
  const header = '| Gate | Status | Duração | Log |';
  const divider = '| --- | --- | --- | --- |';
  const body = rows.map((row) => {
    const duration = row.durationMs ? `${(row.durationMs / 1000).toFixed(1)}s` : '-';
    const log = row.logFile ? path.relative(rootDir, row.logFile) : '-';
    return `| ${row.title} | ${statusLabel(row.status)} | ${duration} | ${log} |`;
  });
  return [header, divider, ...body].join('\n');
}

async function runGate(gate, context) {
  const startedAt = Date.now();
  const logFile = path.join(context.logsDir, `${gate.id}.log`);

  if (gate.enabled === false) {
    return {
      ...gate,
      status: 'skipped',
      durationMs: 0,
      logFile: '',
    };
  }

  ensureDir(path.dirname(logFile));
  const stream = fs.createWriteStream(logFile, { flags: 'w' });
  stream.write(`$ ${gate.command}\n\n`);

  return new Promise((resolve) => {
    let timedOut = false;
    let timer = null;
    const child = spawn(gate.command, {
      cwd: gate.cwd || rootDir,
      shell: true,
      env: {
        ...process.env,
        CANARY_PREFLIGHT_RUN_ID: context.runId,
        ...(gate.env || {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (gate.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, gate.timeoutMs);
    }

    child.stdout.on('data', (chunk) => stream.write(chunk));
    child.stderr.on('data', (chunk) => stream.write(chunk));
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      stream.end(`\n[canary-preflight] exit=${code}${timedOut ? ' timeout=true' : ''}\n`);
      resolve({
        ...gate,
        status: code === 0 && !timedOut ? 'passed' : 'failed',
        exitCode: code,
        durationMs: Date.now() - startedAt,
        logFile,
        error: timedOut ? 'timeout' : code === 0 ? '' : `exit_${code}`,
      });
    });
  });
}

function buildGates(options) {
  const backendDir = path.join(rootDir, 'leaf-websocket-backend');
  const mobileDir = path.join(rootDir, 'mobile-app');

  return [
    {
      id: 'git_diff_check',
      title: 'Git diff sem whitespace inválido',
      command: 'git diff --check',
    },
    {
      id: 'backend_route_guards',
      title: 'Backend sensitive route guards',
      command: 'npm run test:route-guards',
      cwd: backendDir,
    },
    {
      id: 'woovi_sandbox_smoke',
      title: 'Woovi Pix sandbox real',
      command: 'npm run smoke:woovi-sandbox -- --out reports/woovi-sandbox-${CANARY_PREFLIGHT_RUN_ID:-manual}.json',
      cwd: backendDir,
      enabled: !options.skipWooviSandbox,
      timeoutMs: 60000,
    },
    {
      id: 'backend_unit_integration',
      title: 'Backend unit + integration',
      command: 'npm test',
      cwd: backendDir,
      enabled: !options.skipBackendTest,
      timeoutMs: 900000,
    },
    {
      id: 'mobile_static_copy',
      title: 'Mobile onboarding copy',
      command: 'npm run prelaunch:copy',
    },
    {
      id: 'mobile_testids',
      title: 'Mobile testIDs essenciais',
      command: 'npm run prelaunch:testids',
    },
    {
      id: 'app_links_contract',
      title: 'Universal Links e App Links publicos',
      command: 'npm run prelaunch:app-links',
    },
    {
      id: 'mobile_unit',
      title: 'Mobile unit tests',
      command: 'npm run test:mobile',
      enabled: !options.skipMobileUnit,
      timeoutMs: 600000,
    },
    {
      id: 'mobile_release_preflight',
      title: 'Mobile release preflight estático',
      command: 'bash scripts/release-preflight.sh production',
      cwd: mobileDir,
    },
    {
      id: 'dashboard_lint',
      title: 'Dashboard lint',
      command: 'npm run lint:dashboard',
    },
    {
      id: 'dashboard_build',
      title: 'Dashboard build',
      command: 'npm run build:dashboard',
      enabled: !options.skipDashboardBuild,
      timeoutMs: 600000,
    },
    {
      id: 'support_orchestrator_check',
      title: 'Support orchestrator syntax check',
      command: 'npm run check:orchestrator',
    },
    {
      id: 'financial_cleanup_dry_run',
      title: 'Dry-run limpeza financeira de teste',
      command: 'node scripts/ops/cleanup-prod-test-data.js --financial-only',
      cwd: backendDir,
      enabled: !options.skipFinancialLive,
      timeoutMs: 180000,
    },
    {
      id: 'financial_reconciliation',
      title: 'Reconciliação financeira live',
      command: 'npm run ops:financial-reconcile -- --limit 100 --out reports/financial-reconciliation-canary-preflight.json',
      cwd: backendDir,
      enabled: !options.skipFinancialLive,
      timeoutMs: 180000,
    },
  ];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const runId = `canary-preflight-${timestampTag()}`;
  const reportDir = options.reportDir ? path.resolve(rootDir, options.reportDir) : path.join(reportsRoot, runId);
  const logsDir = path.join(reportDir, 'logs');
  ensureDir(logsDir);

  const context = { runId, reportDir, logsDir };
  const gates = buildGates(options);
  const results = [];

  for (const gate of gates) {
    const result = await runGate(gate, context);
    results.push(result);
    console.log(`${statusLabel(result.status)} ${result.title}`);
  }

  const failed = results.filter((result) => result.status === 'failed');
  const summary = {
    runId,
    generatedAt: new Date().toISOString(),
    status: failed.length === 0 ? 'GO' : 'NO-GO',
    reportDir,
    results: results.map((result) => ({
      id: result.id,
      title: result.title,
      status: result.status,
      exitCode: result.exitCode ?? null,
      durationMs: result.durationMs,
      logFile: result.logFile ? path.relative(rootDir, result.logFile) : '',
      error: result.error || '',
    })),
  };

  const jsonPath = path.join(reportDir, 'summary.json');
  const mdPath = path.join(reportDir, 'report.md');
  fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2));
  fs.writeFileSync(mdPath, [
    `# Canary preflight sem device - ${summary.generatedAt}`,
    '',
    `Status: ${summary.status}`,
    '',
    markdownTable(summary.results),
    '',
    '## Próxima etapa',
    '',
    summary.status === 'GO'
      ? 'Gerar builds release iOS/Android e executar o canary test em aparelho/simulador.'
      : 'Corrigir gates com FAIL antes de gerar builds release.',
    '',
  ].join('\n'));

  console.log(`\nRelatório: ${mdPath}`);
  console.log(`Status final: ${summary.status}`);

  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
