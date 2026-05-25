#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const manifestPath = path.join(rootDir, 'docs', 'validation', 'master-validation-manifest.json');
const reportsRoot = path.join(rootDir, 'reports', 'validation-runs');

function parseArgs(argv) {
  const args = { label: 'validation-run', printEnv: false };
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--label') {
      args.label = argv[index + 1] || args.label;
      index += 1;
      continue;
    }
    if (token === '--print-env') {
      args.printEnv = true;
    }
  }
  return args;
}

function slugify(input) {
  return String(input || 'validation-run')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'validation-run';
}

function timestampNow() {
  const date = new Date();
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

function renderTracker(manifest, runLabel, runDir) {
  const header = [
    '# Validation Tracker',
    '',
    `- Label: ${runLabel}`,
    `- Created at: ${new Date().toISOString()}`,
    `- Run directory: ${runDir}`,
    `- Screenshot delay default: ${manifest.defaults?.screenshotDelaySec || 15}s`,
    '',
    'Use this file to track scenario execution with evidence paths and findings.',
    ''
  ];

  const sections = [];
  for (const wave of manifest.waves || []) {
    sections.push(`## ${wave.id.toUpperCase()} — ${wave.title}`);
    sections.push('');
    sections.push('| ID | Scenario | Mode | Priority | Status | Evidence | Notes |');
    sections.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const scenario of wave.scenarios || []) {
      sections.push(`| ${scenario.id} | ${scenario.title} | ${scenario.mode} | ${scenario.priority} | pending |  |  |`);
    }
    sections.push('');
  }

  return `${header.join('\n')}${sections.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const runLabel = slugify(args.label);
  const runDir = path.join(reportsRoot, `${timestampNow()}_${runLabel}`);

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(runDir, 'artifacts'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'logs'), { recursive: true });

  fs.copyFileSync(manifestPath, path.join(runDir, 'manifest.snapshot.json'));
  fs.writeFileSync(path.join(runDir, 'tracker.md'), renderTracker(manifest, args.label, runDir));
  fs.writeFileSync(path.join(runDir, 'notes.md'), '# Validation Notes\n\n');
  fs.writeFileSync(
    path.join(runDir, 'run.json'),
    JSON.stringify(
      {
        label: args.label,
        runDir,
        createdAt: new Date().toISOString(),
        manifestPath
      },
      null,
      2
    ) + '\n'
  );

  if (args.printEnv) {
    process.stdout.write(`RUN_DIR=${JSON.stringify(runDir)}\n`);
    process.stdout.write(`TRACKER_PATH=${JSON.stringify(path.join(runDir, 'tracker.md'))}\n`);
    return;
  }

  process.stdout.write(`${runDir}\n`);
}

main();
