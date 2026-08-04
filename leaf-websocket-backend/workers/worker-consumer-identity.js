const os = require('os');

const MAX_CONSUMER_NAME_LENGTH = 128;

function normalizeIdentityPart(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function resolveWorkerInstanceId({ env = process.env, hostname = os.hostname() } = {}) {
  return normalizeIdentityPart(
    env.LEAF_WORKER_INSTANCE_ID
      || env.WORKER_INSTANCE_ID
      || env.HOSTNAME
      || hostname,
    'unknown-instance'
  );
}

function buildWorkerConsumerName(
  prefix,
  {
    env = process.env,
    hostname = os.hostname(),
    pid = process.pid,
    includePid = true
  } = {}
) {
  const normalizedPrefix = normalizeIdentityPart(prefix, 'worker');
  const instanceId = resolveWorkerInstanceId({ env, hostname });
  const parts = [normalizedPrefix, instanceId];

  if (includePid) {
    parts.push(normalizeIdentityPart(pid, '0'));
  }

  return parts
    .join('-')
    .slice(0, MAX_CONSUMER_NAME_LENGTH)
    .replace(/-+$/g, '');
}

module.exports = {
  MAX_CONSUMER_NAME_LENGTH,
  normalizeIdentityPart,
  resolveWorkerInstanceId,
  buildWorkerConsumerName
};
