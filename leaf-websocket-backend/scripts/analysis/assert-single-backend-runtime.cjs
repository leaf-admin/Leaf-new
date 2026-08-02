#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..', '..');
const repositoryRoot = path.resolve(backendRoot, '..');
const requiredFiles = [
  'leaf-websocket-backend/package.json',
  'leaf-websocket-backend/docker-compose.production.yml',
  'leaf-websocket-backend/docker-compose.gateway-scale.yml',
  'leaf-websocket-backend/docker-compose.realtime-secondary.yml',
  'leaf-websocket-backend/docker-compose.ops-workers.yml',
  'leaf-websocket-backend/scripts/runtime/start-server.sh',
  'leaf-websocket-backend/scripts/deploy-contabo-docker.sh',
  'scripts/validation/run-wave9-production-readiness.sh'
];
const forbiddenPatterns = [
  { pattern: /server\.vps\.js/, reason: 'entrada alternativa server.vps.js' },
  { pattern: /LEAF_SERVER_RUNTIME/, reason: 'seletor de runtime LEAF_SERVER_RUNTIME' },
  { pattern: /LEAF_SERVER_ENTRY/, reason: 'entrada customizável LEAF_SERVER_ENTRY' }
];
const findings = [];

function collectOperationalFiles(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectOperationalFiles(absolutePath);
    }
    if (!/\.(?:c?js|mjs|sh|json|ya?ml)$/.test(entry.name)) {
      return [];
    }
    return [path.relative(repositoryRoot, absolutePath)];
  });
}

const activeFiles = [...new Set([
  ...requiredFiles,
  ...collectOperationalFiles(path.join(backendRoot, 'scripts')),
  ...collectOperationalFiles(path.join(backendRoot, 'tests')),
  ...collectOperationalFiles(path.join(repositoryRoot, 'scripts'))
])].filter((relativePath) => relativePath !== 'leaf-websocket-backend/scripts/analysis/assert-single-backend-runtime.cjs');

if (fs.existsSync(path.join(backendRoot, 'server.vps.js'))) {
  findings.push({ file: 'leaf-websocket-backend/server.vps.js', line: 1, reason: 'arquivo executável alternativo' });
}

for (const relativePath of activeFiles) {
  const filePath = path.join(repositoryRoot, relativePath);
  if (!fs.existsSync(filePath)) {
    findings.push({ file: relativePath, line: 1, reason: 'arquivo operacional esperado não encontrado' });
    continue;
  }

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const { pattern, reason } of forbiddenPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        findings.push({ file: relativePath, line: index + 1, reason, text: line.trim() });
      }
    }
  });
}

const launcherPath = path.join(backendRoot, 'scripts/runtime/start-server.sh');
const launcher = fs.readFileSync(launcherPath, 'utf8');
if (!launcher.includes('exec node "$ENTRY_FILE"') || !launcher.includes('ENTRY_FILE="server.js"')) {
  findings.push({
    file: 'leaf-websocket-backend/scripts/runtime/start-server.sh',
    line: 1,
    reason: 'launcher não fixa explicitamente server.js'
  });
}

if (findings.length > 0) {
  console.error(JSON.stringify({ ok: false, message: 'Backend não possui entrada operacional única.', findings }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  entrypoint: 'leaf-websocket-backend/server.js',
  checkedFileCount: activeFiles.length
}, null, 2));
