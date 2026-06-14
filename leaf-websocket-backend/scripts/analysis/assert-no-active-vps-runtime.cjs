#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const backendRoot = path.resolve(__dirname, '..', '..');
const files = [
  'docker-compose.production.yml',
  'docker-compose.gateway-scale.yml',
  'docker-compose.realtime-secondary.yml',
  'docker-compose.ops-workers.yml'
];

const findings = [];

for (const relativePath of files) {
  const filePath = path.join(backendRoot, relativePath);
  if (!fs.existsSync(filePath)) continue;

  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes('LEAF_SERVER_RUNTIME=vps')) {
      findings.push({
        file: relativePath,
        line: index + 1,
        text: line.trim()
      });
    }
  });
}

if (findings.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    message: 'Runtime VPS legado encontrado em compose ativo. Use LEAF_SERVER_RUNTIME=modular; VPS só deve existir como rollback manual/documentado.',
    findings
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  checkedFiles: files
}, null, 2));
