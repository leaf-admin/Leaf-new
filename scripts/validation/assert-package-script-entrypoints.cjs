#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const packageFiles = [
  'package.json',
  'leaf-websocket-backend/package.json',
  'leaf-dashboard-js/package.json',
  'mobile-app/package.json',
  'services/support-agent-orchestrator/package.json'
];
const commandPattern = /(?:^|&&|\|\||;)\s*(?:(?:[A-Za-z_][A-Za-z0-9_]*)=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*(?:node(?:\s+--[^\s]+)*|bash|sh)\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))/g;

function isVersionedLocalEntrypoint(candidate) {
  if (!candidate || candidate.startsWith('-')) return false;
  if (path.isAbsolute(candidate) || candidate.includes('node_modules')) return false;
  if (/[${}*?]/.test(candidate)) return false;
  return /\.(?:c?js|mjs|sh)$/.test(candidate);
}

function collectMissingEntrypoints(packageFile) {
  const absolutePackagePath = path.join(repositoryRoot, packageFile);
  const packageDirectory = path.dirname(absolutePackagePath);
  const manifest = JSON.parse(fs.readFileSync(absolutePackagePath, 'utf8'));
  const findings = [];

  for (const [scriptName, command] of Object.entries(manifest.scripts || {})) {
    commandPattern.lastIndex = 0;
    for (const match of String(command).matchAll(commandPattern)) {
      const candidate = match[1] || match[2] || match[3];
      if (!isVersionedLocalEntrypoint(candidate)) continue;
      const absoluteEntrypoint = path.resolve(packageDirectory, candidate);
      if (!fs.existsSync(absoluteEntrypoint)) {
        findings.push({
          packageFile,
          scriptName,
          entrypoint: candidate
        });
      }
    }
  }

  return findings;
}

const missingEntrypoints = packageFiles.flatMap(collectMissingEntrypoints);

if (missingEntrypoints.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    message: 'Scripts npm apontam para entrypoints locais inexistentes.',
    missingEntrypoints
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  checkedPackageFiles: packageFiles,
  missingEntrypoints: []
}, null, 2));
