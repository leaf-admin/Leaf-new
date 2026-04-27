const {
  parseEnvList,
  resolveRuntimeCorsHosts,
  buildRuntimeSslipOrigins,
  buildRuntimeDirectOrigins,
  buildRuntimeOriginRegexes
} = require('../../../utils/runtime-cors-origins');

describe('runtime-cors-origins', () => {
  it('parses comma-separated env values with trim and empty filtering', () => {
    expect(parseEnvList(' a, ,b ,, c ')).toEqual(['a', 'b', 'c']);
  });

  it('resolves runtime hosts from defaults and env list', () => {
    const hosts = resolveRuntimeCorsHosts({
      env: {
        CORS_RUNTIME_HOSTS: '10.0.0.1,10.0.0.2'
      },
      defaultHosts: ['62.169.31.231'],
      allowLegacyFlagName: 'ALLOW_LEGACY_VULTR_CORS'
    });

    expect(hosts).toEqual(['62.169.31.231', '10.0.0.1', '10.0.0.2']);
  });

  it('includes legacy host only when explicit flag is enabled', () => {
    const hosts = resolveRuntimeCorsHosts({
      env: {
        CORS_RUNTIME_HOSTS: '62.169.31.231',
        ALLOW_LEGACY_VULTR_CORS: 'true'
      },
      defaultHosts: [],
      allowLegacyFlagName: 'ALLOW_LEGACY_VULTR_CORS',
      legacyHost: '147.182.204.181'
    });

    expect(hosts).toContain('147.182.204.181');
  });

  it('builds sslip and direct origins for each runtime host', () => {
    const hosts = ['62.169.31.231'];
    expect(buildRuntimeSslipOrigins(hosts)).toEqual([
      'https://dashboard.62.169.31.231.sslip.io',
      'https://api.62.169.31.231.sslip.io',
      'https://socket.62.169.31.231.sslip.io'
    ]);
    expect(buildRuntimeDirectOrigins(hosts, { port: 3001 })).toEqual([
      'http://62.169.31.231:3001',
      'https://62.169.31.231:3001'
    ]);
  });

  it('builds regexes that match direct and sslip origins', () => {
    const { runtimeDirectOriginRegex, runtimeSslipOriginRegex } = buildRuntimeOriginRegexes(['62.169.31.231']);

    expect(runtimeDirectOriginRegex.test('https://62.169.31.231:3001')).toBe(true);
    expect(runtimeDirectOriginRegex.test('https://example.com')).toBe(false);
    expect(runtimeSslipOriginRegex.test('https://api.62.169.31.231.sslip.io')).toBe(true);
    expect(runtimeSslipOriginRegex.test('https://api.147.182.204.181.sslip.io')).toBe(false);
  });
});
