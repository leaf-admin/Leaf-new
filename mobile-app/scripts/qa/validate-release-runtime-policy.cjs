#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const EAS_PATH = path.join(ROOT, 'eas.json');

const PRODUCTION_PROFILE_NAMES = new Set([
  'release-test',
  'production',
  'production-apk'
]);

const REVIEW_PROFILE_NAMES = new Set([
  'production-review'
]);

const BLOCKED_TRUE_FLAGS = [
  'EXPO_PUBLIC_FORCE_PAYMENT_BYPASS',
  'EXPO_PUBLIC_BYPASS_PAYMENTS',
  'EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS',
  'EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK',
  'EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW',
  'EXPO_PUBLIC_E2E_TEST',
  'EXPO_PUBLIC_ALLOW_INSECURE_HTTP'
];

const REQUIRED_FALSE_FLAGS = [
  'APP_REVIEW',
  'EXPO_PUBLIC_APP_REVIEW',
  ...BLOCKED_TRUE_FLAGS
];

const ASSISTED_LAUNCH_PROFILES = new Set(['pilot_controlled', 'ride_flow_validation']);

function validateAssistedLaunchProfile(name, env, issues) {
  const launchProfile = normalize(env.EXPO_PUBLIC_LEAF_LAUNCH_PROFILE);
  if (!ASSISTED_LAUNCH_PROFILES.has(launchProfile)) {
    issues.push(`${name}: perfil de lançamento deve ser pilot_controlled ou ride_flow_validation durante o piloto assistido`);
  }
  if (launchProfile === 'pilot_controlled' && !isTruthy(env.EXPO_PUBLIC_PILOT_CONTROLLED)) {
    issues.push(`${name}: EXPO_PUBLIC_PILOT_CONTROLLED=true obrigatório no perfil pilot_controlled`);
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalize(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on', 'sim'].includes(normalize(value));
}

function validateProductionProfile(name, profile = {}) {
  const env = profile.env || {};
  const issues = [];

  REQUIRED_FALSE_FLAGS.forEach((flag) => {
    if (!(flag in env)) {
      issues.push(`${name}: ${flag} ausente; defina explicitamente como false`);
      return;
    }

    if (isTruthy(env[flag])) {
      issues.push(`${name}: ${flag}=true bloqueado para release pública`);
    }
  });

  validateAssistedLaunchProfile(name, env, issues);

  ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_WS_URL', 'EXPO_PUBLIC_SOCKET_URL'].forEach((flag) => {
    const value = String(env[flag] || '').trim();
    if (!/^https:\/\//i.test(value)) {
      issues.push(`${name}: ${flag} deve usar HTTPS em release pública`);
    }
  });

  return issues;
}

function validateReviewProfile(name, profile = {}) {
  const env = profile.env || {};
  const issues = [];

  BLOCKED_TRUE_FLAGS.forEach((flag) => {
    if (isTruthy(env[flag])) {
      issues.push(`${name}: ${flag}=true bloqueado mesmo em review`);
    }
  });

  if (!isTruthy(env.APP_REVIEW)) {
    issues.push(`${name}: APP_REVIEW deve estar true em profile de review`);
  }

  validateAssistedLaunchProfile(name, env, issues);

  return issues;
}

function main() {
  const eas = readJson(EAS_PATH);
  const buildProfiles = eas.build || {};
  const issues = [];

  PRODUCTION_PROFILE_NAMES.forEach((profileName) => {
    issues.push(...validateProductionProfile(profileName, buildProfiles[profileName] || {}));
  });
  REVIEW_PROFILE_NAMES.forEach((profileName) => {
    issues.push(...validateReviewProfile(profileName, buildProfiles[profileName] || {}));
  });

  const result = {
    ok: issues.length === 0,
    checkedProfiles: {
      production: Array.from(PRODUCTION_PROFILE_NAMES),
      review: Array.from(REVIEW_PROFILE_NAMES)
    },
    issues
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = { validateProductionProfile, validateReviewProfile };
