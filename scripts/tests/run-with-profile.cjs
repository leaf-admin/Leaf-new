#!/usr/bin/env node

const path = require('path');
const { spawnSync } = require('child_process');

const [, , profileId = 'default', ...commandParts] = process.argv;
const command = commandParts.join(' ').trim();

if (!command) {
  console.error('Usage: node run-with-profile.cjs <profile-id> "<command>"');
  process.exit(1);
}

const shouldPrintProfile = String(process.env.TEST_PROFILE_SHOWN || '0') !== '1';

if (shouldPrintProfile) {
  const printScriptPath = path.join(__dirname, 'print-test-profile.cjs');
  const preflight = spawnSync(process.execPath, [printScriptPath, profileId], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env
  });

  if (preflight.error) {
    console.error(preflight.error.message);
    process.exit(1);
  }

  if (typeof preflight.status === 'number' && preflight.status !== 0) {
    process.exit(preflight.status);
  }
}

const execResult = spawnSync(command, {
  shell: true,
  stdio: 'inherit',
  cwd: process.cwd(),
  env: {
    ...process.env,
    TEST_PROFILE_SHOWN: '1'
  }
});

if (execResult.error) {
  console.error(execResult.error.message);
  process.exit(1);
}

process.exit(typeof execResult.status === 'number' ? execResult.status : 1);
