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

  it('resolves runtime hosts from env list without implicit VPS defaults', () => {
    const hosts = resolveRuntimeCorsHosts({
      env: {
        CORS_RUNTIME_HOSTS: '10.0.0.1,10.0.0.2'
      },
      defaultHosts: [],
      allowLegacyFlagName: 'ALLOW_LEGACY_VULTR_CORS'
    });

    expect(hosts).toEqual(['10.0.0.1', '10.0.0.2']);
  });

  it('includes an explicit legacy host only when explicit flag is enabled', () => {
    const hosts = resolveRuntimeCorsHosts({
      env: {
        CORS_RUNTIME_HOSTS: '10.0.0.1',
        ALLOW_LEGACY_VULTR_CORS: 'true'
      },
      defaultHosts: [],
      allowLegacyFlagName: 'ALLOW_LEGACY_VULTR_CORS',
      legacyHost: '10.0.0.9'
    });

    expect(hosts).toContain('10.0.0.9');
  });

  it('builds sslip and direct origins for each runtime host', () => {
    const hosts = ['10.0.0.1'];
    expect(buildRuntimeSslipOrigins(hosts)).toEqual([
      'https://dashboard.10.0.0.1.sslip.io',
      'https://api.10.0.0.1.sslip.io',
      'https://socket.10.0.0.1.sslip.io'
    ]);
    expect(buildRuntimeDirectOrigins(hosts, { port: 3001 })).toEqual([
      'http://10.0.0.1:3001',
      'https://10.0.0.1:3001'
    ]);
  });

  it('builds regexes that match direct and sslip origins', () => {
    const { runtimeDirectOriginRegex, runtimeSslipOriginRegex } = buildRuntimeOriginRegexes(['10.0.0.1']);

    expect(runtimeDirectOriginRegex.test('https://10.0.0.1:3001')).toBe(true);
    expect(runtimeDirectOriginRegex.test('https://example.com')).toBe(false);
    expect(runtimeSslipOriginRegex.test('https://api.10.0.0.1.sslip.io')).toBe(true);
    expect(runtimeSslipOriginRegex.test('https://api.10.0.0.9.sslip.io')).toBe(false);
  });
});
