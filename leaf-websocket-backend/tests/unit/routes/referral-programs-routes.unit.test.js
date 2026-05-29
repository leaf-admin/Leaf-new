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
const mockFindInviteByCode = jest.fn();
const mockCreateInviteWithUniqueCode = jest.fn();
const mockAcceptInvite = jest.fn();
const mockGetUserProfile = jest.fn();
const mockSavePassengerBenefit = jest.fn();
const mockVerifyIdToken = jest.fn();

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
  findInviteByCode: mockFindInviteByCode,
  createInvite: jest.fn(),
  createInviteWithUniqueCode: mockCreateInviteWithUniqueCode,
  updateInvite: jest.fn(),
  acceptInvite: mockAcceptInvite,
  getUserProfile: mockGetUserProfile,
  extendFreeMonthsForUser: mockExtendFreeMonthsForUser,
  savePassengerBenefit: mockSavePassengerBenefit,
  updateUserProfile: mockUpdateUserProfile
}));

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: mockVerifyIdToken
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
    mockFindInviteByCode.mockResolvedValue(null);
    mockCreateInviteWithUniqueCode.mockResolvedValue(null);
    mockAcceptInvite.mockResolvedValue(null);
    mockGetUserProfile.mockResolvedValue(null);
    mockSavePassengerBenefit.mockResolvedValue(null);
    mockVerifyIdToken.mockResolvedValue({
      uid: 'user_2',
      phone_number: '+5521999999999',
      email: 'user@leaf.test'
    });
  });

  it('returns a sanitized public passenger invite preview', async () => {
    mockFindInviteByCode.mockResolvedValue({
      id: 'invite_1',
      code: 'PSG-ABC',
      type: 'passenger_referral',
      status: 'pending',
      inviterId: 'secret_inviter',
      inviteePhone: '+5521999999999',
      discountPercent: 12,
      maxDiscountRides: 4
    });

    const response = await request(createApp())
      .get('/api/referral-programs/invites/public/psg-abc');

    expect(response.status).toBe(200);
    expect(mockFindInviteByCode).toHaveBeenCalledWith('PSG-ABC');
    expect(response.body).toMatchObject({
      success: true,
      invite: {
        code: 'PSG-ABC',
        kind: 'passenger',
        status: 'pending',
        canAccept: true,
        passengerBenefit: {
          discountPercent: 12,
          maxDiscountRides: 4,
          nonCumulative: true
        }
      }
    });
    expect(response.body.invite.inviterId).toBeUndefined();
    expect(response.body.invite.inviteePhone).toBeUndefined();
  });

  it('returns a sanitized public driver invite preview', async () => {
    mockFindInviteByCode.mockResolvedValue({
      id: 'invite_2',
      code: 'DRV-XYZ',
      type: 'driver_referral',
      status: 'accepted',
      inviterId: 'secret_inviter',
      acceptedBy: 'secret_driver',
      requiredCompletedTrips: 25,
      rewardMonths: 2,
      qualificationWindowDays: 45
    });

    const response = await request(createApp())
      .get('/api/referral-programs/invites/public/drv-xyz');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      invite: {
        code: 'DRV-XYZ',
        kind: 'driver',
        status: 'accepted',
        canAccept: false,
        driverReward: {
          requiredCompletedTrips: 25,
          rewardMonths: 2,
          qualificationWindowDays: 45
        }
      }
    });
    expect(response.body.invite.inviterId).toBeUndefined();
    expect(response.body.invite.acceptedBy).toBeUndefined();
  });

  it('does not leak invite existence details beyond a generic not found response', async () => {
    const response = await request(createApp())
      .get('/api/referral-programs/invites/public/PSG-MISSING');

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      error: 'Convite nao encontrado'
    });
  });

  it('marks expired public invites as unavailable without leaking private fields', async () => {
    mockFindInviteByCode.mockResolvedValue({
      id: 'invite_expired',
      code: 'PSG-OLD',
      type: 'passenger_referral',
      status: 'pending',
      inviterId: 'secret_inviter',
      inviteePhone: '+5521999999999',
      expiresAt: '2020-01-01T00:00:00.000Z'
    });

    const response = await request(createApp())
      .get('/api/referral-programs/invites/public/psg-old');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      invite: {
        code: 'PSG-OLD',
        kind: 'passenger',
        status: 'expired',
        canAccept: false
      }
    });
    expect(response.body.invite.inviteePhone).toBeUndefined();
  });

  it('blocks accepting an invite tied to another phone number', async () => {
    mockFindInviteByCode.mockResolvedValue({
      id: 'invite_phone',
      code: 'PSG-PHONE',
      type: 'passenger_referral',
      status: 'pending',
      inviterId: 'user_1',
      inviteePhone: '+5521888888888'
    });

    const response = await request(createApp())
      .post('/api/referral-programs/invites/accept')
      .set('Authorization', 'Bearer firebase-token')
      .send({ code: 'PSG-PHONE' });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      error: 'Este convite pertence a outro telefone'
    });
    expect(mockAcceptInvite).not.toHaveBeenCalled();
  });

  it('accepts a matching invite through the atomic state service path', async () => {
    mockFindInviteByCode.mockResolvedValue({
      id: 'invite_driver',
      code: 'DRV-OK',
      type: 'driver_referral',
      status: 'pending',
      inviterId: 'user_1',
      inviteePhone: '+5521999999999',
      requiredCompletedTrips: 20,
      rewardMonths: 1,
      qualificationWindowDays: 30
    });
    mockAcceptInvite.mockResolvedValue({
      id: 'invite_driver',
      code: 'DRV-OK',
      type: 'driver_referral',
      status: 'accepted',
      inviterId: 'user_1',
      acceptedBy: 'user_2',
      acceptedAt: '2026-05-26T00:00:00.000Z'
    });

    const response = await request(createApp())
      .post('/api/referral-programs/invites/accept')
      .set('Authorization', 'Bearer firebase-token')
      .send({ code: 'DRV-OK' });

    expect(response.status).toBe(200);
    expect(mockAcceptInvite).toHaveBeenCalledWith(
      'invite_driver',
      expect.objectContaining({
        status: 'accepted',
        acceptedBy: 'user_2'
      }),
      { expectedCode: 'DRV-OK' }
    );
    expect(mockUpdateUserProfile).toHaveBeenCalledWith(
      'user_2',
      expect.objectContaining({
        invitedBy: 'user_1'
      })
    );
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
