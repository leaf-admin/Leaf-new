jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockAuthenticateSupport = jest.fn((req, _res, next) => {
  req.user = { id: 'admin_1', uid: 'admin_1', role: 'admin', email: 'admin@leaf.test' };
  next();
});
const mockRequireSupportRoles = jest.fn(() => (_req, _res, next) => next());
const mockLoggerWarn = jest.fn();
const mockIsLaunchFeatureEnabled = jest.fn(() => true);

jest.mock('../../../middleware/support-auth', () => ({
  authenticateSupport: mockAuthenticateSupport,
  requireSupportRoles: mockRequireSupportRoles
}));

jest.mock('../../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: mockLoggerWarn,
    error: jest.fn()
  },
  logStructured: jest.fn()
}));

jest.mock('../../../utils/pilot-launch-flags', () => ({
  isLaunchFeatureEnabled: mockIsLaunchFeatureEnabled,
  buildLaunchFeatureDisabledPayload: jest.fn((feature, error) => ({
    success: false,
    code: 'FEATURE_DISABLED_IN_LAUNCH_PROFILE',
    feature,
    error
  }))
}));

jest.mock('../../../services/city-activation-state-service', () => ({
  getConfig: jest.fn()
}));

jest.mock('firebase-admin', () => ({
  apps: [],
  firestore: jest.fn(() => ({
    collection: jest.fn()
  }))
}));

function createApp() {
  const waitlistRoutes = require('../../../routes/waitlist');
  const app = express();
  app.use(express.json());
  app.use(waitlistRoutes);
  return app;
}

describe('waitlist admin mutation guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsLaunchFeatureEnabled.mockImplementation((feature) => feature !== 'adminMutationsEnabled');
  });

  it('blocks landing waitlist status updates behind the admin mutation flag', async () => {
    const response = await request(createApp())
      .patch('/api/waitlist/landing/lead_1/status')
      .send({ status: 'contacted' });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      feature: 'admin_mutations'
    });
    expect(mockRequireSupportRoles).toHaveBeenCalledWith(['admin', 'manager', 'super-admin']);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      'Mutação admin da waitlist bloqueada por feature flag',
      expect.objectContaining({
        action: 'waitlist.admin_mutation.blocked',
        entity: { type: 'waitlist', id: null },
        operator: expect.objectContaining({ id: 'admin_1', role: 'admin' })
      })
    );
  });
});
