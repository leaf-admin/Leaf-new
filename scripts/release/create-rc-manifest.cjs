#!/usr/bin/env node

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');

function git(...args) {
  return execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
}

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optional(name) {
  return String(process.env[name] || '').trim() || null;
}

function main() {
  const dirty = git('status', '--porcelain');
  if (dirty) {
    throw new Error('RC manifest requires a clean worktree');
  }

  const sha = git('rev-parse', 'HEAD');
  const shortSha = git('rev-parse', '--short=12', 'HEAD');
  const branch = git('branch', '--show-current');
  const rcVersion = required('RC_VERSION');
  const outputArgIndex = process.argv.indexOf('--output');
  const outputPath = outputArgIndex >= 0 && process.argv[outputArgIndex + 1]
    ? path.resolve(repoRoot, process.argv[outputArgIndex + 1])
    : path.join(repoRoot, 'QA', 'release-candidates', `${rcVersion}-${shortSha}.json`);

  if (fs.existsSync(outputPath)) {
    throw new Error(`RC manifest already exists and is immutable: ${outputPath}`);
  }

  const manifest = {
    schemaVersion: 1,
    rcVersion,
    createdAt: new Date().toISOString(),
    git: { sha, shortSha, branch, clean: true },
    runtime: {
      node: process.version,
      launchProfile: required('LEAF_LAUNCH_PROFILE'),
      runtimePolicyVersion: required('LEAF_RUNTIME_POLICY_VERSION'),
      financialPolicyVersion: required('LEAF_APPROVED_FINANCIAL_POLICY_ID')
    },
    builds: {
      backend: required('RC_BACKEND_BUILD_ID'),
      dashboard: required('RC_DASHBOARD_BUILD_ID'),
      android: required('RC_ANDROID_BUILD_ID'),
      ios: required('RC_IOS_BUILD_ID')
    },
    ota: {
      androidGroup: required('RC_ANDROID_OTA_GROUP'),
      iosGroup: required('RC_IOS_OTA_GROUP')
    },
    rollback: {
      backend: required('ROLLBACK_BACKEND_REF'),
      dashboard: required('ROLLBACK_DASHBOARD_REF'),
      androidOta: required('ROLLBACK_ANDROID_OTA_GROUP'),
      iosOta: required('ROLLBACK_IOS_OTA_GROUP')
    },
    evidence: {
      ciRunUrl: required('RC_CI_RUN_URL'),
      simulatorMatrix: optional('RC_SIMULATOR_MATRIX_PATH'),
      physicalE2e: optional('RC_PHYSICAL_E2E_PATH'),
      reconciliation: optional('RC_RECONCILIATION_PATH')
    }
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  process.stdout.write(`${outputPath}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[rc-manifest] ${error.message}\n`);
  process.exit(2);
}
