const { buildRuntimeCorsConfig } = require('../../../utils/runtime-cors-config');

describe('runtime-cors-config', () => {
  it('enables local origins by default in non-production', () => {
    const config = buildRuntimeCorsConfig({
      env: {
        NODE_ENV: 'development'
      }
    });

    expect(config.flags.allowLocalCors).toBe(true);
    expect(config.allowedOrigins).toContain('http://localhost:3000');
  });

  it('disables local origins by default in production', () => {
    const config = buildRuntimeCorsConfig({
      env: {
        NODE_ENV: 'production'
      }
    });

    expect(config.flags.allowLocalCors).toBe(false);
    expect(config.allowedOrigins).not.toContain('http://localhost:3000');
  });

  it('allows runtime sslip hosts from explicit env values', () => {
    const config = buildRuntimeCorsConfig({
      env: {
        NODE_ENV: 'production',
        CORS_RUNTIME_HOSTS: '10.0.0.1'
      }
    });

    expect(config.allowedOrigins).toContain('https://api.10.0.0.1.sslip.io');
    expect(config.allowedOrigins).not.toContain('https://api.10.0.0.9.sslip.io');
  });

  it('honors explicit env whitelist additions via CORS_ORIGIN', () => {
    const config = buildRuntimeCorsConfig({
      env: {
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://custom.example.com'
      }
    });

    expect(config.allowedOrigins).toContain('https://custom.example.com');
  });

  it('blocks unknown web origin and accepts explicit runtime sslip origin', (done) => {
    const config = buildRuntimeCorsConfig({
      env: {
        NODE_ENV: 'production',
        CORS_RUNTIME_HOSTS: '10.0.0.1'
      }
    });

    config.corsOptions.origin('https://api.10.0.0.1.sslip.io', (errAllowed, okAllowed) => {
      expect(errAllowed).toBeNull();
      expect(okAllowed).toBe(true);

      config.corsOptions.origin('https://evil.example.com', (errBlocked, okBlocked) => {
        expect(errBlocked).toBeInstanceOf(Error);
        expect(String(errBlocked.message || '')).toContain('Não permitido pelo CORS');
        expect(okBlocked).toBeUndefined();
        done();
      });
    });
  });
});
