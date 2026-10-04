#!/usr/bin/env node

const path = require('path');
const { loadConfigEnv } = require('../../config/loadConfigEnv');

const MOBILE_ROOT = path.resolve(__dirname, '../..');
const TRUTHY = new Set(['1', 'true', 'yes', 'on']);
const PRODUCTION_HOSTS = new Set([
  'api.leaf.app.br',
  'socket.leaf.app.br',
]);
const QA_HOST_MARKER = /(^|[.-])(qa|sandbox|staging|stage|test|dev)([.-]|$)/i;

function parseOrigin(raw) {
  try {
    const url = new URL(String(raw || '').trim());
    return { origin: url.origin, hostname: url.hostname.toLowerCase(), protocol: url.protocol };
  } catch (_error) {
    return null;
  }
}

function normalizeExpectedOrigin(raw) {
  return parseOrigin(raw)?.origin || '';
}

function isTruthy(value) {
  return TRUTHY.has(String(value ?? '').trim().toLowerCase());
}

function validateTarget({ env = {}, appConfig = {} } = {}) {
  const blockers = [];
  const extra = appConfig.extra || {};
  const directApiUrl = String(env.EXPO_PUBLIC_API_URL || env.EXPO_PUBLIC_BACKEND_URL || '').trim();
  const api = parseOrigin(extra.apiUrl || extra.backendUrl || directApiUrl);
  const expectedApiOrigin = normalizeExpectedOrigin(env.LEAF_QA_TARGET_API_ORIGIN);

  if (!String(env.LEAF_ENV_FILE || '').trim()) {
    blockers.push('explicit_qa_env_file_required');
  }
  if (!directApiUrl) {
    blockers.push('explicit_api_url_required');
  }
  if (!api) {
    blockers.push('api_url_invalid_or_missing');
  } else {
    if (api.protocol !== 'https:') blockers.push('api_https_required');
    if (PRODUCTION_HOSTS.has(api.hostname)) blockers.push('api_is_production_host');
    if (api.hostname.endsWith('.leaf.app.br') && !QA_HOST_MARKER.test(api.hostname)) {
      blockers.push('api_leaf_host_not_marked_qa');
    }
    if (!expectedApiOrigin) blockers.push('qa_api_origin_allowlist_required');
    else if (api.origin !== expectedApiOrigin) blockers.push('api_origin_allowlist_mismatch');
  }

  const socketUrl = String(extra.wsUrl || extra.socketUrl || env.EXPO_PUBLIC_WS_URL || env.EXPO_PUBLIC_SOCKET_URL || '').trim();
  const socket = parseOrigin(socketUrl);
  const expectedSocketOrigin = normalizeExpectedOrigin(
    env.LEAF_QA_TARGET_WS_ORIGIN || env.LEAF_QA_TARGET_API_ORIGIN,
  );
  if (!socket) {
    blockers.push('socket_url_invalid_or_missing');
  } else {
    if (socket.protocol !== 'https:') blockers.push('socket_https_required');
    if (PRODUCTION_HOSTS.has(socket.hostname)) blockers.push('socket_is_production_host');
    if (socket.hostname.endsWith('.leaf.app.br') && !QA_HOST_MARKER.test(socket.hostname)) {
      blockers.push('socket_leaf_host_not_marked_qa');
    }
    if (!expectedSocketOrigin) blockers.push('qa_socket_origin_allowlist_required');
    else if (socket.origin !== expectedSocketOrigin) blockers.push('socket_origin_allowlist_mismatch');
  }

  if (String(extra.launchProfile || '').trim().toLowerCase() !== 'pilot_controlled') {
    blockers.push('pilot_controlled_launch_profile_required');
  }
  if (extra.pilotControlled !== true) blockers.push('pilot_controlled_flag_required');
  if (extra.e2eTest === true) blockers.push('e2e_test_mode_must_be_off');
  if (extra.enableTestUserTools === true) blockers.push('test_user_tools_must_be_off');
  if (extra.forcePaymentBypass === true) blockers.push('payment_bypass_must_be_off');

  for (const key of [
    'EXPO_PUBLIC_ENABLE_QA_OTP_FORCE_FLOW',
    'EXPO_PUBLIC_ENABLE_CUSTOM_OTP_FALLBACK',
    'EXPO_PUBLIC_FORCE_PAYMENT_BYPASS',
    'EXPO_PUBLIC_BYPASS_PAYMENTS',
    'EXPO_PUBLIC_E2E_TEST',
    'EXPO_PUBLIC_ENABLE_TEST_USER_TOOLS',
  ]) {
    if (isTruthy(env[key])) blockers.push(`${key.toLowerCase()}_must_be_off`);
  }

  return { ok: blockers.length === 0, blockers };
}

function main() {
  if (!String(process.env.LEAF_ENV_FILE || '').trim()) {
    console.error('[real-qa-target][blocked] explicit_qa_env_file_required');
    process.exitCode = 1;
    return;
  }

  let appConfig;
  try {
    loadConfigEnv(MOBILE_ROOT);
    appConfig = require('../../app.config');
  } catch (_error) {
    console.error('[real-qa-target][blocked] qa_env_file_could_not_be_loaded');
    process.exitCode = 1;
    return;
  }

  const result = validateTarget({ env: process.env, appConfig });
  if (!result.ok) {
    for (const blocker of result.blockers) {
      console.error(`[real-qa-target][blocked] ${blocker}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[real-qa-target][pass] explicit controlled-pilot QA target verified.');
}

if (require.main === module) main();

module.exports = { validateTarget };
