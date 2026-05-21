#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../../..');
const MAX_TEXT_BYTES = 1024 * 1024;
const STRICT_CONTENT = process.argv.includes('--strict-content');
const TRACKED_ONLY = process.argv.includes('--tracked-only');

const SKIP_DIRS = new Set([
  '.git',
  '.next',
  '.expo',
  '.gradle',
  '.local-tools',
  '.codex-artifacts',
  '.maestro',
  '.tmp',
  '.venv_image',
  'android-sdk',
  'build',
  'coverage',
  'dist',
  'dist-export-android',
  'dist-export-android-bytecode',
  'node_modules',
  'Pods',
  'reports',
  'results',
  'test-results',
  'tmp',
  'venv',
  'web-build',
  'web-report'
]);

const SENSITIVE_ARTIFACT_RE = /(^|\/)(\.env(?:$|[._-])|[^/]*(?:\.keystore|\.jks|\.p12|\.pfx|\.pem|\.key)$|google-services\.json$|GoogleService-Info\.plist$|firebase-credentials\.json$|leaf-reactnative-firebase-adminsdk-[^/]+\.json$)/i;
const ALLOWED_EXAMPLE_RE = /(\.env(?:[._-][^/]*)?\.(?:example|sample)$|\.example\.(?:json|plist)$|google-services\.example\.json$|GoogleService-Info\.example\.plist$)/i;

const TEXT_FILE_RE = /\.(?:cjs|js|mjs|ts|tsx|jsx|json|yml|yaml|env|example|sample|md|sh|bash|zsh|properties|gradle|conf|config|txt)$/i;

const CONTENT_RULES = [
  {
    id: 'known-redis-default-password',
    severity: 'high',
    pattern: /(?:leaf_redis_2024|leaf_password_production_2025_secure)/g,
    help: 'Senha Redis default conhecida; usar segredo externo e rotacionar se ja foi usada.'
  },
  {
    id: 'jwt-secret-fallback',
    severity: 'high',
    pattern: /JWT_SECRET\s*=\s*(?:process\.env\.[A-Z0-9_]+\s*\|\||\$\{JWT_SECRET:-)/g,
    help: 'JWT_SECRET nao pode ter fallback estatico em runtime de producao.'
  },
  {
    id: 'cors-wildcard',
    severity: 'high',
    pattern: /(?:CORS_ORIGIN\s*=\s*\*|cors\s*\(\s*\))/g,
    help: 'CORS wildcard ou cors() irrestrito deve ficar fora de runtime de producao.'
  },
  {
    id: 'woovi-unsigned-prod-risk',
    severity: 'high',
    pattern: /WOOVI_WEBHOOK_ALLOW_UNSIGNED\s*=\s*true/g,
    help: 'Webhook Woovi sem assinatura deve ser restrito a sandbox/runbook controlado.'
  },
  {
    id: 'woovi-signature-disabled',
    severity: 'high',
    pattern: /WOOVI_WEBHOOK_REQUIRE_SIGNATURE\s*=\s*false/g,
    help: 'Webhook Woovi em producao deve exigir assinatura ou verificacao equivalente.'
  },
  {
    id: 'payment-bypass-enabled',
    severity: 'medium',
    pattern: /(?:PAYMENT_BYPASS_ON_WOOVI_FAILURE|FORCE_PAYMENT_BYPASS|EXPO_PUBLIC_FORCE_PAYMENT_BYPASS)\s*[:=]\s*["']?true["']?/g,
    help: 'Bypass de pagamento deve ser proibido em prod e isolado em testes/review.'
  },
  {
    id: 'hardcoded-test-password',
    severity: 'medium',
    pattern: /(?:Leaf@Review2026!|Leaf12345|teste123)/g,
    help: 'Credenciais de teste hardcoded precisam ficar em env local/secret manager.'
  },
  {
    id: 'private-key-material',
    severity: 'critical',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)?PRIVATE KEY-----/g,
    help: 'Material de chave privada no workspace exige remocao e rotacao externa.'
  }
];

const findings = [];

function rel(filePath) {
  return path.relative(ROOT, filePath).split(path.sep).join('/');
}

function addFinding({ severity, id, file, line, help }) {
  findings.push({ severity, id, file: rel(file), line, help });
}

function getTrackedFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], {
      cwd: ROOT,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .map((entry) => path.join(ROOT, entry));
  } catch {
    return [];
  }
}

function shouldSkipDir(dirName) {
  return SKIP_DIRS.has(dirName) || dirName.startsWith('.tmp-');
}

function shouldScanContent(file) {
  const relative = rel(file);
  if (relative === 'scripts/maintenance/security/scan-secrets.cjs') return false;
  if (relative.startsWith('docs/') || relative.includes('/docs/')) return false;
  if (relative.includes('/tests/') || relative.includes('/__tests__/')) return false;
  if (relative.includes('/.maestro/')) return false;
  if (relative.includes('/coverage/')) return false;
  if (relative.includes('/reports/')) return false;
  if (/\.(?:example|sample)(?:\.[^.]+)?$/i.test(relative)) return false;

  return (
    relative.startsWith('.github/workflows/') ||
    relative.startsWith('scripts/maintenance/deploy/') ||
    relative.startsWith('scripts/maintenance/security/') ||
    relative.startsWith('scripts/maintenance/server') ||
    relative.startsWith('scripts/prelaunch/') ||
    relative.startsWith('leaf-websocket-backend/bootstrap/') ||
    relative.startsWith('leaf-websocket-backend/config/') ||
    relative.startsWith('leaf-websocket-backend/middleware/') ||
    relative.startsWith('leaf-websocket-backend/routes/') ||
    relative.startsWith('leaf-websocket-backend/services/') ||
    relative.startsWith('leaf-websocket-backend/utils/') ||
    relative.startsWith('leaf-websocket-backend/scripts/deploy/') ||
    relative.startsWith('leaf-websocket-backend/scripts/runtime/') ||
    relative === 'leaf-websocket-backend/server.js' ||
    relative === 'leaf-websocket-backend/server.vps.js' ||
    relative.startsWith('services/support-agent-orchestrator/src/') ||
    relative.startsWith('services/kyc-service/src/') ||
    relative.startsWith('services/kyc-microservice/src/') ||
    relative === 'mobile-app/eas.json' ||
    relative === 'mobile-app/app.config.js' ||
    relative.startsWith('mobile-app/config/') ||
    relative.startsWith('mobile-app/plugins/') ||
    relative === 'docker-compose.observability.yml' ||
    relative === '.do/app.yaml'
  );
}

function walk(dir, files = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {
        walk(path.join(dir, entry.name), files);
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(path.join(dir, entry.name));
    }
  }
  return files;
}

function looksTextual(file) {
  if (TEXT_FILE_RE.test(file)) return true;
  try {
    const sample = fs.readFileSync(file, { encoding: null, flag: 'r' }).subarray(0, 256);
    return !sample.includes(0);
  } catch {
    return false;
  }
}

function lineForIndex(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function scanSensitiveArtifact(file) {
  const relative = rel(file);
  if (!SENSITIVE_ARTIFACT_RE.test(relative) || ALLOWED_EXAMPLE_RE.test(relative)) return;
  addFinding({
    severity: 'critical',
    id: 'sensitive-artifact-present',
    file,
    help: 'Arquivo sensivel presente no workspace; remover do repo/worktree operacional e rotacionar se exposto.'
  });
}

function scanContent(file) {
  if (!shouldScanContent(file)) return;

  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return;
  }
  if (stat.size > MAX_TEXT_BYTES || !looksTextual(file)) return;

  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }

  for (const rule of CONTENT_RULES) {
    rule.pattern.lastIndex = 0;
    let match;
    while ((match = rule.pattern.exec(content)) !== null) {
      addFinding({
        severity: rule.severity,
        id: rule.id,
        file,
        line: lineForIndex(content, match.index),
        help: rule.help
      });
    }
  }
}

function main() {
  const trackedFiles = getTrackedFiles();
  const workspaceFiles = TRACKED_ONLY ? [] : walk(ROOT);
  const filesToScan = new Set([...trackedFiles, ...workspaceFiles]);
  const scanScope = TRACKED_ONLY ? 'tracked files' : 'workspace';

  for (const file of filesToScan) {
    scanSensitiveArtifact(file);
    scanContent(file);
  }

  findings.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return (
      severityOrder[a.severity] - severityOrder[b.severity] ||
      a.file.localeCompare(b.file) ||
      String(a.line || '').localeCompare(String(b.line || '')) ||
      a.id.localeCompare(b.id)
    );
  });

  const uniqueFindings = [];
  const seen = new Set();
  for (const finding of findings) {
    const key = `${finding.severity}:${finding.id}:${finding.file}:${finding.line || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueFindings.push(finding);
  }

  if (uniqueFindings.length === 0) {
    console.log(`[security-scan] ok (${scanScope}): nenhum artefato sensivel ou fallback inseguro encontrado.`);
    return;
  }

  const blockingFindings = uniqueFindings.filter(
    (finding) => finding.severity === 'critical' || (STRICT_CONTENT && ['high', 'medium'].includes(finding.severity))
  );
  const channel = blockingFindings.length > 0 ? console.error : console.warn;
  channel(
    `[security-scan] ${blockingFindings.length > 0 ? 'falhou' : 'avisos'} (${scanScope}): ${uniqueFindings.length} achado(s). Valores foram omitidos.`
  );
  for (const finding of uniqueFindings) {
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    channel(`[${finding.severity}] ${finding.id} ${location}`);
    channel(`  ${finding.help}`);
  }

  if (blockingFindings.length > 0) {
    process.exitCode = 1;
  }
}

main();
