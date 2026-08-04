describe('GraphQL resolver auth without Apollo runtime', () => {
  const originalJwtSecret = process.env.JWT_SECRET;
  let graphqlAuth;

  beforeAll(() => {
    process.env.JWT_SECRET = 'graphql-auth-unit-test-secret-32-bytes';
    jest.resetModules();
    graphqlAuth = require('../../../middleware/graphql-auth');
  });

  afterAll(() => {
    if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalJwtSecret;
    jest.resetModules();
  });

  it('returns the canonical unauthenticated GraphQL error code', () => {
    try {
      graphqlAuth.verifyToken(null);
      throw new Error('verifyToken should fail without a token');
    } catch (error) {
      expect(error.name).toBe('AuthenticationError');
      expect(error.extensions).toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });

  it('returns the canonical forbidden GraphQL error code', async () => {
    const resolver = graphqlAuth.requireAuth('read:all_users')(jest.fn());

    await expect(resolver(null, {}, {
      isAuthenticated: true,
      permissions: []
    }, {})).rejects.toMatchObject({
      name: 'ForbiddenError',
      extensions: { code: 'FORBIDDEN' }
    });
  });
});
