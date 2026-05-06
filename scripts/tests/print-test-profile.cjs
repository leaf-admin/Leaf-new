#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const profileId = process.argv[2] || 'default';
const rootDir = path.resolve(__dirname, '..', '..');
const docPath = path.join(rootDir, 'docs', 'TEST_EXECUTION_CANONICAL_PROFILE.md');

function readCmd(cmd, args) {
  const result = spawnSync(cmd, args, {
    cwd: rootDir,
    encoding: 'utf8'
  });
  if (result.status !== 0) return null;
  return String(result.stdout || '').trim();
}

function maskSecret(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '(unset)';
  if (normalized.length <= 6) return '***';
  return `${normalized.slice(0, 3)}***${normalized.slice(-2)}`;
}

function resolveExistingPath(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch (_error) {
      // ignore invalid paths
    }
  }
  return null;
}

function looksRemoteWsUrl(wsUrl) {
  const normalized = String(wsUrl || '').trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.includes('sslip.io')) return true;
  if (normalized.startsWith('https://')) return true;
  if (normalized.startsWith('http://') && !normalized.includes('localhost') && !normalized.includes('127.0.0.1')) {
    return true;
  }
  return false;
}

const wsUrl = String(process.env.WS_URL || 'https://socket.62.169.31.231.sslip.io').trim();
const apiBaseUrl = String(process.env.API_BASE_URL || 'https://api.62.169.31.231.sslip.io').trim();
const remoteSshHost = String(process.env.E2E_REMOTE_SSH_HOST || '62.169.31.231').trim();
const remoteSshUser = String(process.env.E2E_REMOTE_SSH_USER || 'root').trim();
const runId = String(process.env.E2E_RUN_ID || '(auto: Date.now())').trim();
const appReview = String(process.env.APP_REVIEW || 'false').trim().toLowerCase();
const mockPayment = String(process.env.E2E_MOCK_PAYMENT || 'true').trim().toLowerCase();
const generateFirebaseToken = String(process.env.E2E_GENERATE_FIREBASE_TOKEN || 'true').trim().toLowerCase();
const driverSimMode = String(process.env.E2E_DRIVER_SIM_MODE || '(auto)').trim();
const strictMode = String(process.env.TEST_PROFILE_STRICT || 'false').trim().toLowerCase() === 'true';

const detectedSshKey = resolveExistingPath([
  process.env.E2E_REMOTE_SSH_KEY_PATH,
  process.env.CONTABO_SSH_KEY_PATH,
  path.join(process.env.HOME || '', '.ssh/leaf_contabo_20260412_ed25519'),
  path.join(process.env.HOME || '', '.ssh/serafy_contabo_ed25519'),
  path.join(rootDir, 'contabokey')
]);

const gitSha = readCmd('git', ['rev-parse', '--short', 'HEAD']) || '(unknown)';
const gitBranch = readCmd('git', ['rev-parse', '--abbrev-ref', 'HEAD']) || '(unknown)';
const gitDirty = Boolean(readCmd('git', ['status', '--porcelain']));
const nodeVersion = process.version;

const remoteMode = looksRemoteWsUrl(wsUrl);
const warnings = [];
const blockers = [];

if (appReview === 'true') {
  warnings.push('APP_REVIEW=true ativo. Isso altera autenticação/pagamento e pode mascarar falhas reais.');
}

if (remoteMode && !detectedSshKey) {
  const message = 'Execução remota detectada, mas nenhuma chave SSH Contabo foi encontrada.';
  warnings.push(message);
  blockers.push(message);
}

if (remoteMode && !String(process.env.E2E_REMOTE_REDIS_PASSWORD || '').trim()) {
  warnings.push('E2E_REMOTE_REDIS_PASSWORD não definido explicitamente (fallback local será usado).');
}

if (remoteMode && !String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()) {
  warnings.push('GOOGLE_APPLICATION_CREDENTIALS não definido. Geração de token Firebase pode falhar.');
}

const line = '='.repeat(88);
console.log(line);
console.log(`TEST EXECUTION PROFILE :: ${profileId}`);
console.log(line);
console.log(`repo: ${rootDir}`);
console.log(`timestamp: ${new Date().toISOString()}`);
console.log(`git: ${gitBranch} @ ${gitSha}${gitDirty ? ' (dirty)' : ''}`);
console.log(`node: ${nodeVersion}`);
console.log(`mode: ${remoteMode ? 'remote-shared (contabo)' : 'local'}`);
console.log(`WS_URL: ${wsUrl}`);
console.log(`API_BASE_URL: ${apiBaseUrl}`);
console.log(`E2E_REMOTE_SSH_HOST: ${remoteSshHost}`);
console.log(`E2E_REMOTE_SSH_USER: ${remoteSshUser}`);
console.log(`E2E_REMOTE_SSH_KEY_PATH(resolved): ${detectedSshKey || '(not found)'}`);
console.log(`E2E_REMOTE_REDIS_PASSWORD: ${maskSecret(process.env.E2E_REMOTE_REDIS_PASSWORD)}`);
console.log(`E2E_RUN_ID: ${runId}`);
console.log(`E2E_DRIVER_SIM_MODE: ${driverSimMode}`);
console.log(`E2E_GENERATE_FIREBASE_TOKEN: ${generateFirebaseToken}`);
console.log(`E2E_MOCK_PAYMENT: ${mockPayment}`);
console.log(`APP_REVIEW: ${appReview}`);
console.log(line);

if (warnings.length) {
  console.log('WARNINGS:');
  warnings.forEach((warning) => console.log(`- ${warning}`));
  console.log(line);
}

if (fs.existsSync(docPath)) {
  console.log(`CANONICAL DOC: ${docPath}`);
  console.log(line);
  console.log(fs.readFileSync(docPath, 'utf8'));
  console.log(line);
} else {
  console.log(`Canonical profile doc not found at ${docPath}`);
  console.log(line);
}

if (strictMode && blockers.length) {
  console.error('Strict mode enabled and blockers were found. Aborting test execution.');
  process.exit(2);
}
