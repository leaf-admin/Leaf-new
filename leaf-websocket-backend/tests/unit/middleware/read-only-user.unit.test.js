const mockVerify = jest.fn();
const mockGetAdminUser = jest.fn();

jest.mock('jsonwebtoken', () => ({
  verify: (...args) => mockVerify(...args)
}));

jest.mock('firebase-admin', () => ({}));

jest.mock('../../../firebase-config', () => ({
  initializeFirebase: jest.fn()
}));

jest.mock('../../../utils/jwt-secret-resolver', () => ({
  resolveJwtSecret: jest.fn(() => 'unit-secret'),
  resolveJwtSecretList: jest.fn(() => ['unit-secret'])
}));

jest.mock('../../../utils/admin-user-cache', () => ({
  getAdminUser: (...args) => mockGetAdminUser(...args)
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn()
}));

const { authenticateSupport } = require('../../../middleware/support-auth');
const { authenticateJWT } = require('../../../middleware/jwt-auth');

function call(middleware, method) {
  const req = { method, headers: { authorization: 'Bearer bots-token' } };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  const next = jest.fn();
  return middleware(req, res, next).then(() => ({ req, res, next }));
}

describe('read-only admin users', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerify.mockReturnValue({ userId: 'bots_1', role: 'support' });
    mockGetAdminUser.mockResolvedValue({ exists: true, data: { role: 'support', readOnly: true } });
  });

  it.each([
    ['support auth', authenticateSupport],
    ['jwt auth', authenticateJWT],
  ])('%s lets a read-only user read and refuses any write', async (_label, middleware) => {
    const read = await call(middleware, 'GET');
    expect(read.next).toHaveBeenCalledTimes(1);
    expect(read.req.user.readOnly).toBe(true);

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const write = await call(middleware, method);
      expect(write.next).not.toHaveBeenCalled();
      expect(write.res.status).toHaveBeenCalledWith(403);
      expect(write.res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'READ_ONLY_USER' }));
    }
  });

  it('keeps writes for a normal support user', async () => {
    mockGetAdminUser.mockResolvedValue({ exists: true, data: { role: 'support' } });

    const write = await call(authenticateSupport, 'POST');

    expect(write.next).toHaveBeenCalledTimes(1);
    expect(write.req.user.readOnly).toBeUndefined();
  });
});
