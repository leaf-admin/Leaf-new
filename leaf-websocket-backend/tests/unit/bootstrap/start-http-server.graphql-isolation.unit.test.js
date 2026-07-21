const startHttpServer = require('../../../bootstrap/start-http-server');

const { initializeGraphQL, isLegacyGraphqlEnabled } = startHttpServer;

function createHarness() {
  return {
    app: {},
    applyMiddleware: jest.fn().mockResolvedValue(undefined),
    logStructured: jest.fn(),
    logError: jest.fn()
  };
}

describe('start-http-server GraphQL legacy isolation', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLegacyGraphqlFlag = process.env.ENABLE_LEGACY_GRAPHQL;

  beforeEach(() => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENABLE_LEGACY_GRAPHQL;
  });

  afterAll(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;

    if (originalLegacyGraphqlFlag === undefined) delete process.env.ENABLE_LEGACY_GRAPHQL;
    else process.env.ENABLE_LEGACY_GRAPHQL = originalLegacyGraphqlFlag;
  });

  it('does not mount GraphQL in production when the legacy gate is absent', async () => {
    const harness = createHarness();

    await expect(initializeGraphQL(harness)).resolves.toBe(false);

    expect(isLegacyGraphqlEnabled()).toBe(false);
    expect(harness.applyMiddleware).not.toHaveBeenCalled();
    expect(harness.logStructured).toHaveBeenCalledWith(
      'info',
      'GraphQL legado desabilitado neste runtime',
      expect.objectContaining({ endpoint: 'disabled' })
    );
  });

  it('mounts GraphQL outside production to preserve local legacy diagnostics', async () => {
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_LEGACY_GRAPHQL = 'false';
    const harness = createHarness();

    await expect(initializeGraphQL(harness)).resolves.toBe(true);

    expect(isLegacyGraphqlEnabled()).toBe(true);
    expect(harness.applyMiddleware).toHaveBeenCalledWith(harness.app);
  });

  it('cannot be reopened in production by environment drift', () => {
    process.env.ENABLE_LEGACY_GRAPHQL = 'true';

    expect(isLegacyGraphqlEnabled()).toBe(false);
  });
});
