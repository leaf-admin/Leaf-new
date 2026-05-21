jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockAuthenticateJWT = jest.fn((req, _res, next) => {
  req.user = { id: 'admin_1', role: 'admin', email: 'admin@leaf.test' };
  next();
});
const mockRequireRole = jest.fn(() => (_req, _res, next) => next());
const mockLogStructured = jest.fn();
const mockIsLaunchFeatureEnabled = jest.fn(() => true);
const mockGetConfig = jest.fn();
const mockExtendFreeMonthsForUser = jest.fn();
const mockUpdateUserProfile = jest.fn();

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: mockAuthenticateJWT,
  requireRole: mockRequireRole
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: mockLogStructured,
  logError: jest.fn()
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

jest.mock('../../../services/referral-program-state-service', () => ({
  getConfig: mockGetConfig,
  saveConfig: jest.fn(),
  listCampaigns: jest.fn(),
  createCampaign: jest.fn(),
  getCampaign: jest.fn(),
  updateCampaign: jest.fn(),
  listInvites: jest.fn(),
  getInvite: jest.fn(),
  findInviteByCode: jest.fn(),
  createInvite: jest.fn(),
  updateInvite: jest.fn(),
  extendFreeMonthsForUser: mockExtendFreeMonthsForUser,
  savePassengerBenefit: jest.fn(),
  updateUserProfile: mockUpdateUserProfile
}));

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: jest.fn()
  }))
}));

function createApp() {
  const referralRoutes = require('../../../routes/referral-programs');
  const app = express();
  app.use(express.json());
  app.use('/api/referral-programs', referralRoutes);
  return app;
}

describe('referral-programs admin mutation guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsLaunchFeatureEnabled.mockReturnValue(true);
    mockGetConfig.mockResolvedValue({
      founder: {
        enabled: true,
        freeMonths: 6,
        waveTag: 'founder-wave-1'
      }
    });
    mockExtendFreeMonthsForUser.mockResolvedValue('2026-12-31T00:00:00.000Z');
    mockUpdateUserProfile.mockResolvedValue(undefined);
  });

  it('blocks founder assignment when admin mutations are disabled', async () => {
    mockIsLaunchFeatureEnabled.mockImplementation((feature) => feature !== 'adminMutationsEnabled');

    const response = await request(createApp())
      .post('/api/referral-programs/founder/assign')
      .send({ driverId: 'driver_1', months: 3 });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      feature: 'admin_mutations'
    });
    expect(mockExtendFreeMonthsForUser).not.toHaveBeenCalled();
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
    expect(mockLogStructured).toHaveBeenCalledWith(
      'warn',
      'Mutacao admin de referral bloqueada por feature flag',
      expect.objectContaining({
        action: 'referral_programs.admin_mutation.blocked',
        entity: { type: 'referral_programs', id: null },
        operator: expect.objectContaining({ id: 'admin_1', role: 'admin' })
      })
    );
  });

  it('audits successful founder assignment with operator entity and action', async () => {
    const response = await request(createApp())
      .post('/api/referral-programs/founder/assign')
      .send({ driverId: 'driver_1', months: 3, waveTag: 'founder-wave-2' });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      driverId: 'driver_1',
      freeMonths: 3,
      freeUntil: '2026-12-31T00:00:00.000Z'
    });
    expect(mockExtendFreeMonthsForUser).toHaveBeenCalledWith(
      'driver_1',
      3,
      expect.objectContaining({
        source: 'founder_plan',
        waveTag: 'founder-wave-2'
      })
    );
    expect(mockLogStructured).toHaveBeenCalledWith(
      'info',
      'Auditoria admin referral programs',
      expect.objectContaining({
        action: 'referral_programs.founder.assign',
        entity: { type: 'driver', id: 'driver_1' },
        operator: expect.objectContaining({ id: 'admin_1', role: 'admin' }),
        freeMonths: 3,
        waveTag: 'founder-wave-2'
      })
    );
  });
});
