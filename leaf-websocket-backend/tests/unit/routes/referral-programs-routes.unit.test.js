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
const mockListCampaigns = jest.fn();
const mockGetCampaign = jest.fn();
const mockListInvites = jest.fn();
const mockVerifyIdToken = jest.fn();
const mockFindPersonalCode = jest.fn();
const mockEnsurePersonalCode = jest.fn();
const mockGetPersonalCodeForOwner = jest.fn();
const mockRecordPersonalCodeShare = jest.fn();
const mockAcceptPersonalCode = jest.fn();
const mockListPersonalCodes = jest.fn();
const mockRecordSourceCodeVisit = jest.fn();

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
  listCampaigns: mockListCampaigns,
  createCampaign: jest.fn(),
  getCampaign: mockGetCampaign,
  updateCampaign: jest.fn(),
  listInvites: mockListInvites,
  getInvite: jest.fn(),
  findInviteByCode: mockFindInviteByCode,
  createInvite: jest.fn(),
  createInviteWithUniqueCode: mockCreateInviteWithUniqueCode,
  updateInvite: jest.fn(),
  acceptInvite: mockAcceptInvite,
  getUserProfile: mockGetUserProfile,
  extendFreeMonthsForUser: mockExtendFreeMonthsForUser,
  savePassengerBenefit: mockSavePassengerBenefit,
  updateUserProfile: mockUpdateUserProfile,
  findPersonalCode: mockFindPersonalCode,
  ensurePersonalCode: mockEnsurePersonalCode,
  getPersonalCodeForOwner: mockGetPersonalCodeForOwner,
  recordPersonalCodeShare: mockRecordPersonalCodeShare,
  acceptPersonalCode: mockAcceptPersonalCode,
  listPersonalCodes: mockListPersonalCodes,
  recordSourceCodeVisit: mockRecordSourceCodeVisit,
  listPassengerBenefits: jest.fn(async () => [])
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
    mockListCampaigns.mockResolvedValue([]);
    mockGetCampaign.mockResolvedValue(null);
    mockListInvites.mockResolvedValue([]);
    mockFindPersonalCode.mockResolvedValue(null);
    mockListPersonalCodes.mockResolvedValue([]);
    mockRecordSourceCodeVisit.mockResolvedValue(null);
    mockAcceptPersonalCode.mockImplementation(async (code, inviteeId, payload) => ({
      id: `personal_${code}_${inviteeId}`,
      code: `${code}-X`,
      personalCode: code,
      type: 'driver_referral',
      status: 'accepted',
      inviterId: 'owner_1',
      acceptedBy: inviteeId,
      acceptedAt: '2026-11-09T00:00:00.000Z',
      ...payload
    }));
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

  it('blocks accepting an invite whose campaign is paused', async () => {
    mockFindInviteByCode.mockResolvedValue({
      id: 'invite_driver',
      code: 'DRV-PAUSED',
      type: 'driver_referral',
      status: 'pending',
      inviterId: 'user_1',
      inviteePhone: '+5521999999999',
      campaignId: 'campaign_paused'
    });
    mockGetCampaign.mockResolvedValue({
      id: 'campaign_paused',
      type: 'driver_referral',
      status: 'paused',
      name: 'Campanha pausada'
    });

    const response = await request(createApp())
      .post('/api/referral-programs/invites/accept')
      .set('Authorization', 'Bearer firebase-token')
      .send({ code: 'DRV-PAUSED' });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'REFERRAL_CAMPAIGN_INACTIVE',
      campaign: {
        id: 'campaign_paused',
        status: 'paused'
      }
    });
    expect(mockAcceptInvite).not.toHaveBeenCalled();
  });

  it('blocks passenger invite creation when the same target already has an active invite', async () => {
    mockGetConfig.mockResolvedValue({
      passenger: {
        enabled: true,
        avoidDuplicateInvitees: true
      }
    });
    mockListInvites.mockResolvedValue([
      {
        id: 'invite_existing',
        type: 'passenger_referral',
        status: 'pending',
        inviteePhone: '+5521999999999'
      }
    ]);

    const response = await request(createApp())
      .post('/api/referral-programs/invites/passenger')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        inviterId: 'user_1',
        inviteePhone: '+55 (21) 99999-9999'
      });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain('convite ativo');
    expect(mockCreateInviteWithUniqueCode).not.toHaveBeenCalled();
  });

  it('creates a passenger invite without any discount while rewards are off', async () => {
    mockGetConfig.mockResolvedValue({ passenger: { enabled: true } });
    mockCreateInviteWithUniqueCode.mockImplementation(async (payload) => payload);

    const response = await request(createApp())
      .post('/api/referral-programs/invites/passenger')
      .set('Authorization', 'Bearer firebase-token')
      .send({ inviteePhone: '+55 21 98888-7777' });

    expect(response.status).toBe(200);
    expect(mockCreateInviteWithUniqueCode).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'passenger_referral', discountPercent: 0, maxDiscountRides: 0 })
    );
  });

  it('caps passenger invites per person', async () => {
    mockGetConfig.mockResolvedValue({ passenger: { enabled: true, maxInvitesPerPassenger: 2 } });
    mockListInvites.mockResolvedValue([
      { id: 'a', type: 'passenger_referral', status: 'pending', inviterId: 'user_2', inviteePhone: '+5521911111111' },
      { id: 'b', type: 'passenger_referral', status: 'accepted', inviterId: 'user_2', inviteePhone: '+5521922222222' },
    ]);

    const response = await request(createApp())
      .post('/api/referral-programs/invites/passenger')
      .set('Authorization', 'Bearer firebase-token')
      .send({ inviteePhone: '+55 21 93333-3333' });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ limit: 2 });
    expect(mockCreateInviteWithUniqueCode).not.toHaveBeenCalled();
  });

  it('accepts a passenger invite without granting a benefit while rewards are off', async () => {
    mockGetConfig.mockResolvedValue({ passenger: { enabled: true } });
    mockFindInviteByCode.mockResolvedValue({
      id: 'invite_passenger', code: 'PAX-OK', type: 'passenger_referral', status: 'pending',
      inviterId: 'user_1', inviteePhone: '+5521999999999', discountPercent: 0, maxDiscountRides: 0,
    });
    mockAcceptInvite.mockResolvedValue({
      id: 'invite_passenger', code: 'PAX-OK', type: 'passenger_referral', status: 'accepted',
      inviterId: 'user_1', acceptedBy: 'user_2',
    });

    const response = await request(createApp())
      .post('/api/referral-programs/invites/accept')
      .set('Authorization', 'Bearer firebase-token')
      .send({ code: 'PAX-OK' });

    expect(response.status).toBe(200);
    expect(mockSavePassengerBenefit).not.toHaveBeenCalled();
  });

  it('blocks invite creation when a matching campaign exists but is not active', async () => {
    mockListCampaigns.mockResolvedValue([
      {
        id: 'campaign_paused',
        type: 'passenger_referral',
        status: 'paused',
        name: 'Campanha pausada'
      }
    ]);

    const response = await request(createApp())
      .post('/api/referral-programs/invites/passenger')
      .set('Authorization', 'Bearer firebase-token')
      .send({
        inviterId: 'user_1',
        inviteePhone: '+5521999999999'
      });

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: 'REFERRAL_CAMPAIGN_INACTIVE',
      type: 'passenger_referral'
    });
    expect(mockCreateInviteWithUniqueCode).not.toHaveBeenCalled();
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

  describe('personal reusable driver code', () => {
    const activeDriverCampaign = {
      id: 'camp_driver',
      name: 'Convite de motorista',
      type: 'driver_referral',
      status: 'active',
      startAt: '2026-01-01T00:00:00.000Z',
      params: { requiredCompletedTrips: 20, qualificationWindowDays: 30 }
    };
    const personalCode = {
      code: 'K7M2QX',
      ownerId: 'owner_1',
      type: 'driver_referral',
      status: 'active',
      shareCount: 4,
      acceptedCount: 1
    };

    it('returns the owner code, link and counters', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'owner_1' });
      mockEnsurePersonalCode.mockResolvedValue({ ...personalCode, createdAt: '2026-11-09T00:00:00.000Z' });
      mockListCampaigns.mockResolvedValue([activeDriverCampaign]);

      const response = await request(createApp())
        .get('/api/referral-programs/invites/personal')
        .set('Authorization', 'Bearer firebase-token');

      expect(response.status).toBe(200);
      expect(response.body.personal).toEqual({
        code: 'K7M2QX',
        kind: 'driver',
        link: 'https://leaf.app.br/motorista/convite/K7M2QX',
        campaignActive: true,
        stats: { shared: 4, accepted: 1 },
        createdAt: '2026-11-09T00:00:00.000Z'
      });
      expect(mockEnsurePersonalCode).toHaveBeenCalledWith('owner_1', expect.any(Function), expect.objectContaining({ type: 'driver_referral' }));
      const generator = mockEnsurePersonalCode.mock.calls[0][1];
      expect(generator()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    });

    it('counts a share only for the code owner', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'owner_1' });
      mockGetPersonalCodeForOwner.mockResolvedValue(personalCode);
      mockRecordPersonalCodeShare.mockResolvedValue({ ...personalCode, shareCount: 5 });

      const response = await request(createApp())
        .post('/api/referral-programs/invites/personal/share')
        .set('Authorization', 'Bearer firebase-token')
        .send({ channel: 'whatsapp' });

      expect(response.status).toBe(200);
      expect(response.body.stats).toEqual({ shared: 5, accepted: 1 });
      expect(mockRecordPersonalCodeShare).toHaveBeenCalledWith('K7M2QX', 'owner_1');
    });

    it('shows a public preview of a personal code without the owner', async () => {
      mockFindPersonalCode.mockResolvedValue(personalCode);
      mockListCampaigns.mockResolvedValue([activeDriverCampaign]);

      const response = await request(createApp())
        .get('/api/referral-programs/invites/public/k7m2qx');

      expect(response.status).toBe(200);
      expect(response.body.invite).toMatchObject({
        code: 'K7M2QX',
        kind: 'driver',
        reusable: true,
        canAccept: true,
        driverReward: { rewardMonths: 0 }
      });
      expect(JSON.stringify(response.body)).not.toContain('owner_1');
      expect(mockFindInviteByCode).not.toHaveBeenCalled();
    });

    it('accepts the same personal code for different people and links the inviter', async () => {
      mockFindPersonalCode.mockResolvedValue(personalCode);
      mockListCampaigns.mockResolvedValue([activeDriverCampaign]);

      const response = await request(createApp())
        .post('/api/referral-programs/invites/accept')
        .set('Authorization', 'Bearer firebase-token')
        .send({ code: 'K7M2QX' });

      expect(response.status).toBe(200);
      expect(response.body.invite).toMatchObject({ personalCode: 'K7M2QX', acceptedBy: 'user_2', rewardMonths: 0 });
      expect(mockAcceptPersonalCode).toHaveBeenCalledWith('K7M2QX', 'user_2', expect.objectContaining({
        campaignId: 'camp_driver',
        qualification: expect.objectContaining({ status: 'tracking' })
      }));
      expect(mockUpdateUserProfile).toHaveBeenCalledWith('user_2', expect.objectContaining({
        invitedBy: 'owner_1',
        invitedByCode: 'K7M2QX'
      }));
      expect(mockFindInviteByCode).not.toHaveBeenCalled();
    });

    it('blocks the owner from accepting their own code', async () => {
      mockVerifyIdToken.mockResolvedValue({ uid: 'owner_1' });
      mockFindPersonalCode.mockResolvedValue(personalCode);

      const response = await request(createApp())
        .post('/api/referral-programs/invites/accept')
        .set('Authorization', 'Bearer firebase-token')
        .send({ code: 'K7M2QX' });

      expect(response.status).toBe(400);
      expect(mockAcceptPersonalCode).not.toHaveBeenCalled();
    });

    it('blocks a driver who already entered through another driver invite', async () => {
      mockFindPersonalCode.mockResolvedValue(personalCode);
      mockListCampaigns.mockResolvedValue([activeDriverCampaign]);
      mockListInvites.mockResolvedValue([{
        id: 'invite_old',
        type: 'driver_referral',
        status: 'accepted',
        inviterId: 'someone_else',
        acceptedBy: 'user_2'
      }]);

      const response = await request(createApp())
        .post('/api/referral-programs/invites/accept')
        .set('Authorization', 'Bearer firebase-token')
        .send({ code: 'K7M2QX' });

      expect(response.status).toBe(409);
      expect(mockAcceptPersonalCode).not.toHaveBeenCalled();
    });

    it('blocks acceptance while the driver campaign is paused', async () => {
      mockFindPersonalCode.mockResolvedValue(personalCode);
      mockListCampaigns.mockResolvedValue([{ ...activeDriverCampaign, status: 'paused' }]);

      const response = await request(createApp())
        .post('/api/referral-programs/invites/accept')
        .set('Authorization', 'Bearer firebase-token')
        .send({ code: 'K7M2QX' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('REFERRAL_CAMPAIGN_INACTIVE');
      expect(mockAcceptPersonalCode).not.toHaveBeenCalled();
    });
  });
  describe('group source links', () => {
    const activeDriverCampaign = {
      id: 'camp_driver',
      name: 'Convite de motorista',
      type: 'driver_referral',
      status: 'active',
      startAt: '2026-01-01T00:00:00.000Z',
      params: { requiredCompletedTrips: 20, qualificationWindowDays: 30, rewardMonths: 2 }
    };
    const groupCode = {
      code: 'GRP4ZA',
      ownerId: 'leaf-source:facebook_group:motoristas-uber-rio',
      type: 'driver_referral',
      status: 'active',
      sourceKind: 'group',
      label: 'Motoristas Uber Rio',
      channel: 'facebook_group',
      shareCount: 0,
      acceptedCount: 2,
      visitCount: 15
    };

    it('creates a link for a group with a synthetic owner and no person behind it', async () => {
      mockGetPersonalCodeForOwner.mockResolvedValue(null);
      mockEnsurePersonalCode.mockResolvedValue({ ...groupCode, acceptedCount: 0, visitCount: 0 });

      const response = await request(createApp())
        .post('/api/referral-programs/sources')
        .send({ label: '  Motoristas   Uber Rio ', channel: 'facebook_group' });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        created: true,
        source: { code: 'GRP4ZA', label: 'Motoristas Uber Rio', link: 'https://leaf.app.br/motorista/convite/GRP4ZA' }
      });
      expect(mockEnsurePersonalCode).toHaveBeenCalledWith(
        'leaf-source:facebook_group:motoristas-uber-rio',
        expect.any(Function),
        expect.objectContaining({
          sourceFields: expect.objectContaining({ sourceKind: 'group', label: 'Motoristas Uber Rio', channel: 'facebook_group', createdBy: 'admin_1' })
        })
      );
    });

    it('returns the existing link when the same group is registered again', async () => {
      mockGetPersonalCodeForOwner.mockResolvedValue(groupCode);

      const response = await request(createApp())
        .post('/api/referral-programs/sources')
        .send({ label: 'Motoristas Uber Rio', channel: 'facebook_group' });

      expect(response.status).toBe(200);
      expect(response.body.created).toBe(false);
      expect(mockEnsurePersonalCode).not.toHaveBeenCalled();
    });

    it('rejects an unknown channel or a short name', async () => {
      const badChannel = await request(createApp()).post('/api/referral-programs/sources').send({ label: 'Grupo X', channel: 'instagram' });
      const shortName = await request(createApp()).post('/api/referral-programs/sources').send({ label: 'ab', channel: 'whatsapp_group' });
      expect(badChannel.status).toBe(400);
      expect(shortName.status).toBe(400);
      expect(mockEnsurePersonalCode).not.toHaveBeenCalled();
    });

    it('blocks creating a group link when admin mutations are disabled', async () => {
      mockIsLaunchFeatureEnabled.mockImplementation((feature) => feature !== 'adminMutationsEnabled');
      const response = await request(createApp())
        .post('/api/referral-programs/sources')
        .send({ label: 'Motoristas Uber Rio', channel: 'facebook_group' });
      expect(response.status).toBe(503);
      expect(mockEnsurePersonalCode).not.toHaveBeenCalled();
    });

    it('counts a visit when the public page of a group link opens, and not for a personal link', async () => {
      mockListCampaigns.mockResolvedValue([activeDriverCampaign]);
      mockFindPersonalCode.mockResolvedValueOnce(groupCode);
      const groupPreview = await request(createApp()).get('/api/referral-programs/invites/public/GRP4ZA');
      expect(groupPreview.status).toBe(200);
      expect(JSON.stringify(groupPreview.body)).not.toContain('leaf-source');
      expect(mockRecordSourceCodeVisit).toHaveBeenCalledWith('GRP4ZA');

      mockRecordSourceCodeVisit.mockClear();
      mockFindPersonalCode.mockResolvedValueOnce({ ...groupCode, code: 'K7M2QX', ownerId: 'owner_1', sourceKind: null });
      await request(createApp()).get('/api/referral-programs/invites/public/K7M2QX');
      expect(mockRecordSourceCodeVisit).not.toHaveBeenCalled();
    });

    it('never grants a reward through a group link, even with rewards on', async () => {
      mockGetConfig.mockResolvedValue({ rewardsEnabled: true, driver: { enabled: true, rewardMonths: 2 } });
      mockFindPersonalCode.mockResolvedValue(groupCode);
      mockListCampaigns.mockResolvedValue([activeDriverCampaign]);

      const response = await request(createApp())
        .post('/api/referral-programs/invites/accept')
        .set('Authorization', 'Bearer firebase-token')
        .send({ code: 'GRP4ZA' });

      expect(response.status).toBe(200);
      expect(mockAcceptPersonalCode).toHaveBeenCalledWith('GRP4ZA', 'user_2', expect.objectContaining({ rewardMonths: 0 }));
      expect(mockUpdateUserProfile).toHaveBeenCalledWith('user_2', expect.objectContaining({ invitedByCode: 'GRP4ZA' }));
    });

    it('lists group links with visits, sign-ups and approvals, apart from personal links', async () => {
      mockListPersonalCodes.mockResolvedValue([
        groupCode,
        { code: 'K7M2QX', ownerId: 'owner_1', type: 'driver_referral', status: 'active', shareCount: 3, acceptedCount: 1, visitCount: 0 }
      ]);
      mockListInvites.mockResolvedValue([
        { id: 'personal_GRP4ZA_u1', type: 'driver_referral', status: 'accepted', personalCode: 'GRP4ZA', acceptedBy: 'u1', acceptedAt: '2026-11-09T00:00:00.000Z' },
        { id: 'personal_GRP4ZA_u2', type: 'driver_referral', status: 'accepted', personalCode: 'GRP4ZA', acceptedBy: 'u2', acceptedAt: '2026-11-09T00:00:00.000Z' },
        { id: 'personal_K7M2QX_u3', type: 'driver_referral', status: 'accepted', personalCode: 'K7M2QX', acceptedBy: 'u3' }
      ]);
      mockGetUserProfile.mockImplementation(async (uid) => ({ approved: uid === 'u1' }));

      const response = await request(createApp()).get('/api/referral-programs/sources');

      expect(response.status).toBe(200);
      expect(response.body.sources).toHaveLength(1);
      expect(response.body.sources[0]).toMatchObject({
        code: 'GRP4ZA', label: 'Motoristas Uber Rio', channel: 'facebook_group', visits: 15, accepted: 2, approved: 1
      });
      expect(JSON.stringify(response.body)).not.toMatch(/"u1"|"u2"|leaf-source/);

      const summary = await request(createApp()).get('/api/referral-programs/summary');
      expect(summary.body.summary.personalCodes.map((item) => item.code)).toEqual(['K7M2QX']);
    });
  });
});
