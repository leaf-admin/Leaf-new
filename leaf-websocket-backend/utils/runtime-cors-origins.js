function parseEnvList(rawValue) {
  return String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveRuntimeCorsHosts(options = {}) {
  const {
    env = process.env,
    defaultHosts = ['62.169.31.231'],
    runtimeHostEnvKeys = ['CORS_RUNTIME_HOSTS', 'RUNTIME_CORS_HOSTS'],
    allowLegacyFlagName = 'ALLOW_LEGACY_VULTR_CORS',
    legacyHost = '147.182.204.181'
  } = options;

  const hosts = [...defaultHosts];

  for (const envKey of runtimeHostEnvKeys) {
    hosts.push(...parseEnvList(env[envKey]));
  }

  const allowLegacy = String(env[allowLegacyFlagName] || 'false').toLowerCase() === 'true';
  if (allowLegacy) {
    hosts.push(legacyHost);
  }

  return Array.from(new Set(hosts.filter(Boolean).map((host) => String(host).trim()).filter(Boolean)));
}

function buildRuntimeSslipOrigins(hosts = []) {
  const origins = [];
  for (const host of hosts) {
    origins.push(
      `https://dashboard.${host}.sslip.io`,
      `https://api.${host}.sslip.io`,
      `https://socket.${host}.sslip.io`
    );
  }
  return origins;
}

function buildRuntimeDirectOrigins(hosts = [], options = {}) {
  const port = String(options.port || '3001');
  const origins = [];
  for (const host of hosts) {
    origins.push(`http://${host}:${port}`, `https://${host}:${port}`);
  }
  return origins;
}

function buildRuntimeOriginRegexes(hosts = []) {
  const hostPattern = hosts.map(escapeRegExp).join('|');
  if (!hostPattern) {
    return {
      runtimeDirectOriginRegex: null,
      runtimeSslipOriginRegex: null
    };
  }

  return {
    runtimeDirectOriginRegex: new RegExp(`^https?:\\/\\/(?:${hostPattern})(?::\\d+)?$`),
    runtimeSslipOriginRegex: new RegExp(`^https?:\\/\\/(?:api|socket|dashboard)\\.(?:${hostPattern})\\.sslip\\.io$`)
  };
}

module.exports = {
  parseEnvList,
  resolveRuntimeCorsHosts,
  buildRuntimeSslipOrigins,
  buildRuntimeDirectOrigins,
  buildRuntimeOriginRegexes
};
