#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const REPORTS_DIR = path.join(ROOT_DIR, 'reports');

function ensureDirectory(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function findLatestLegacySurfaceReport() {
  const files = fs.readdirSync(REPORTS_DIR)
    .filter((name) => /^legacy-runtime-surface-\d+\.json$/.test(name))
    .sort();

  if (files.length === 0) {
    throw new Error('Nenhum relatório legacy-runtime-surface encontrado em reports/');
  }

  return path.join(REPORTS_DIR, files[files.length - 1]);
}

function parseGitStatus() {
  const output = execFileSync('git', ['-C', path.resolve(ROOT_DIR, '..'), 'status', '--porcelain'], {
    encoding: 'utf8'
  });

  const statusMap = new Map();
  output
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => {
      const status = line.slice(0, 2);
      const file = line.slice(3).trim();
      if (!file) return;
      statusMap.set(file, status);
    });

  return statusMap;
}

function normalizeEntry(entry, statusMap) {
  const file = `leaf-websocket-backend/${entry.file}`;
  const gitStatus = statusMap.get(file) || 'clean';

  return {
    file: entry.file,
    totalMatches: entry.totalMatches,
    gitStatus,
    dirty: gitStatus !== 'clean'
  };
}

function buildMarkdown(report) {
  const lines = [
    '# Mixed Legacy Hotspots',
    '',
    `- generatedAt: ${report.generatedAt}`,
    `- sourceLegacySurface: ${report.sourceLegacySurface}`,
    `- dirtyHotspots: ${report.summary.dirtyHotspots}`,
    `- cleanHotspots: ${report.summary.cleanHotspots}`,
    ''
  ];

  lines.push('## Dirty Hotspots');
  if (!report.dirtyHotspots.length) {
    lines.push('- none');
  } else {
    report.dirtyHotspots.forEach((entry) => {
      lines.push(`- ${entry.file}: matches=${entry.totalMatches}, gitStatus=${entry.gitStatus}`);
    });
  }
  lines.push('');

  lines.push('## Clean Hotspots');
  if (!report.cleanHotspots.length) {
    lines.push('- none');
  } else {
    report.cleanHotspots.forEach((entry) => {
      lines.push(`- ${entry.file}: matches=${entry.totalMatches}`);
    });
  }
  lines.push('');

  return `${lines.join('\n')}\n`;
}

function main() {
  ensureDirectory(REPORTS_DIR);
  const sourcePath = findLatestLegacySurfaceReport();
  const legacySurface = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const statusMap = parseGitStatus();

  const normalized = (legacySurface.topFiles || []).map((entry) => normalizeEntry(entry, statusMap));
  const dirtyHotspots = normalized.filter((entry) => entry.dirty);
  const cleanHotspots = normalized.filter((entry) => !entry.dirty);

  const timestamp = Date.now();
  const report = {
    generatedAt: new Date().toISOString(),
    sourceLegacySurface: path.basename(sourcePath),
    summary: {
      dirtyHotspots: dirtyHotspots.length,
      cleanHotspots: cleanHotspots.length
    },
    dirtyHotspots,
    cleanHotspots
  };

  const jsonPath = path.join(REPORTS_DIR, `mixed-legacy-hotspots-${timestamp}.json`);
  const mdPath = path.join(REPORTS_DIR, `mixed-legacy-hotspots-${timestamp}.md`);

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, buildMarkdown(report));

  process.stdout.write(`${JSON.stringify({ jsonPath, mdPath, report }, null, 2)}\n`);
}

main();
