#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
  const args = {
    runDir: '',
    scenario: '',
    status: '',
    evidence: '',
    notes: ''
  };

  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--run-dir') {
      args.runDir = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--scenario') {
      args.scenario = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--status') {
      args.status = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--evidence') {
      args.evidence = argv[index + 1] || '';
      index += 1;
      continue;
    }
    if (token === '--notes') {
      args.notes = argv[index + 1] || '';
      index += 1;
    }
  }

  return args;
}

function escapeCell(value) {
  return String(value || '').replace(/\|/g, '\\|').trim();
}

function main() {
  const args = parseArgs(process.argv);
  if (!args.runDir || !args.scenario || !args.status) {
    console.error('usage: update-tracker --run-dir <dir> --scenario <id> --status <status> [--evidence <path>] [--notes <text>]');
    process.exit(1);
  }

  const trackerPath = path.join(args.runDir, 'tracker.md');
  const tracker = fs.readFileSync(trackerPath, 'utf8').split('\n');
  const scenarioPrefix = `| ${args.scenario} |`;
  const nextRow = `| ${args.scenario} |`;

  const updated = tracker.map((line) => {
    if (!line.startsWith(scenarioPrefix)) {
      return line;
    }

    const parts = line.split('|').slice(1, -1).map((part) => part.trim());
    if (parts.length < 7) {
      return line;
    }

    parts[4] = escapeCell(args.status);
    parts[5] = escapeCell(args.evidence);
    parts[6] = escapeCell(args.notes);
    return `| ${parts.join(' | ')} |`;
  });

  const found = updated.some((line) => line.startsWith(nextRow) && line.includes(`| ${escapeCell(args.status)} |`));
  if (!found) {
    console.error(`scenario not found in tracker: ${args.scenario}`);
    process.exit(2);
  }

  fs.writeFileSync(trackerPath, `${updated.join('\n')}\n`);
}

main();
