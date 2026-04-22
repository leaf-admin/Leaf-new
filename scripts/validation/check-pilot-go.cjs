#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function firstDefined(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function normalizeFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function resolveLaunchProfile() {
  const raw = firstDefined(
    process.env.LEAF_LAUNCH_PROFILE,
    process.env.EXPO_PUBLIC_LEAF_LAUNCH_PROFILE
  );

  const normalized = String(raw || 'full').trim().toLowerCase();
  if (['pilot', 'pilot_controlled', 'controlled_pilot'].includes(normalized)) {
    return 'pilot_controlled';
  }

  return normalized || 'full';
}

function resolvePilotFeature(envKey, enabledOutsidePilot = true) {
  const pilotControlled =
    resolveLaunchProfile() === 'pilot_controlled' ||
    normalizeFlag(firstDefined(process.env.LEAF_PILOT_CONTROLLED, process.env.EXPO_PUBLIC_PILOT_CONTROLLED), false);
  const fallback = pilotControlled ? false : enabledOutsidePilot;
  return normalizeFlag(process.env[envKey], fallback);
}

function parseArgs(argv) {
  const args = { tracker: '' };
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--tracker') {
      args.tracker = argv[index + 1] || '';
      index += 1;
    }
  }
  return args;
}

function listTrackerFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const results = [];
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
      results.push({
        file: current,
        mtimeMs: stat.mtimeMs,
      });
    }
  }

  return results.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

function parseTracker(markdown) {
  return markdown
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('|'))
    .map(line => line.split('|').map(cell => cell.trim()))
    .filter(cells => cells.length >= 8 && /^W\d/.test(cells[1] || ''))
    .map(cells => ({
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

function waivedScenarioIds() {
  const waived = new Set();
  if (!resolvePilotFeature('ENABLE_DRIVER_WITHDRAWALS', true)) {
    waived.add('W6-WD-001');
    waived.add('W6-FEE-001');
  }

  if (!resolvePilotFeature('ENABLE_REFERRAL_PROGRAMS', true)) {
    waived.add('W6-INV-001');
  }

  if (!resolvePilotFeature('ENABLE_SOFT_BAN_ENFORCEMENT', true)) {
    waived.add('W6-BAN-001');
  }

  return waived;
}

function main() {
  const args = parseArgs(process.argv);
  const trackersRoot = path.join(process.cwd(), 'reports', 'validation-runs');
  const trackerFile = args.tracker
    ? path.resolve(process.cwd(), args.tracker)
    : listTrackerFiles(trackersRoot)[0]?.file;

  if (!trackerFile || !fs.existsSync(trackerFile)) {
    console.error('Nenhum tracker.md encontrado. Use --tracker para apontar um arquivo específico.');
    process.exit(2);
  }

  const tracker = parseTracker(fs.readFileSync(trackerFile, 'utf8'));
  const waived = waivedScenarioIds();
  const requiredRows = tracker.filter(isPilotRequiredScenario);
  const blockers = requiredRows.filter(row => !waived.has(row.id) && row.status !== 'pass');

  console.log(`# Pilot GO gate`);
  console.log(`tracker: ${trackerFile}`);
  console.log(`launch_profile: ${resolveLaunchProfile()}`);
  console.log(`required_p0_rows: ${requiredRows.length}`);
  console.log(`blockers: ${blockers.length}`);

  if (blockers.length === 0) {
    console.log('result: GO_CANDIDATE');
    process.exit(0);
  }

  console.log('result: NO_GO');
  blockers.forEach(row => {
    console.log(`- ${row.id} [${row.status || 'unknown'}] ${row.scenario}`);
  });
  process.exit(1);
}

main();
