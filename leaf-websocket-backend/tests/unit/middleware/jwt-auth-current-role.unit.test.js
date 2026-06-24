const mockVerify = jest.fn();
const mockGetAdminUser = jest.fn();

jest.mock('jsonwebtoken', () => ({
  verify: (...args) => mockVerify(...args)
}));

jest.mock('firebase-admin', () => ({}));

jest.mock('../../../utils/jwt-secret-resolver', () => ({
  resolveJwtSecret: jest.fn(() => 'unit-secret')
}));

jest.mock('../../../utils/admin-user-cache', () => ({
  getAdminUser: (...args) => mockGetAdminUser(...args)
}));

jest.mock('../../../utils/logger', () => ({
  logError: jest.fn()
}));

describe('jwt-auth current role authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVerify.mockReturnValue({
      userId: 'admin_1',
      email: 'admin@leaf.test',
      role: 'admin',
      permissions: ['drivers:approve']
    });
    mockGetAdminUser.mockResolvedValue({
      exists: true,
      data: {
        email: 'admin@leaf.test',
        role: 'viewer',
        permissions: []
      }
    });
  });

  it('hydrates role and permissions from the current admin record instead of stale JWT claims', async () => {
    const { authenticateJWT } = require('../../../middleware/jwt-auth');
    const req = {
      headers: {
        authorization: 'Bearer stale-admin-token'
      }
    };
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };
    const next = jest.fn();

    await authenticateJWT(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual({
      id: 'admin_1',
      email: 'admin@leaf.test',
      role: 'viewer',
      permissions: []
    });
  });
});
