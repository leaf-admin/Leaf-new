jest.unmock('express');

const express = require('express');
const request = require('supertest');

const mockAuthenticateJWT = jest.fn((req, _res, next) => {
  req.user = { id: 'admin_1', role: 'admin', email: 'admin@leaf.test' };
  next();
});
const mockRequireRole = jest.fn(() => (_req, _res, next) => next());
const mockListCampaigns = jest.fn();
const mockGetStats = jest.fn();
const mockCreateCampaign = jest.fn();
const mockResolveEligibleCampaigns = jest.fn();
const mockRecordEvent = jest.fn();
const mockGetSlotDefinitions = jest.fn();
const mockUploadAsset = jest.fn();
const mockGetCommercialReport = jest.fn();
const mockLogStructured = jest.fn();
const mockIsLaunchFeatureEnabled = jest.fn(() => true);

jest.mock('../../../middleware/jwt-auth', () => ({
  authenticateJWT: mockAuthenticateJWT,
  requireRole: mockRequireRole
}));

jest.mock('../../../services/campaign-center-service', () => ({
  listCampaigns: mockListCampaigns,
  getStats: mockGetStats,
  createCampaign: mockCreateCampaign,
  getCampaign: jest.fn(),
  updateCampaign: jest.fn(),
  resolveEligibleCampaigns: mockResolveEligibleCampaigns,
  recordEvent: mockRecordEvent,
  getSlotDefinitions: mockGetSlotDefinitions,
  uploadAsset: mockUploadAsset,
  getCommercialReport: mockGetCommercialReport
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: mockLogStructured,
  logError: jest.fn()
}));

jest.mock('../../../utils/pilot-launch-flags', () => ({
  isLaunchFeatureEnabled: mockIsLaunchFeatureEnabled,
  buildLaunchFeatureDisabledPayload: jest.fn((feature, error) => ({
    success: false,
    feature,
    error
  }))
}));

jest.mock('firebase-admin', () => ({
  auth: jest.fn(() => ({
    verifyIdToken: jest.fn().mockRejectedValue(new Error('invalid token'))
  }))
}));

function createApp() {
  const campaignRoutes = require('../../../routes/campaign-center');
  const app = express();
  app.use(express.json());
  app.use('/api/campaign-center', campaignRoutes);
  return app;
}

describe('campaign-center routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListCampaigns.mockResolvedValue([
      { id: 'cmp_1', name: 'Teste', status: 'active' }
    ]);
    mockGetStats.mockResolvedValue({ total: 1, active: 1 });
    mockCreateCampaign.mockResolvedValue({ id: 'cmp_new', name: 'Nova' });
    mockIsLaunchFeatureEnabled.mockReturnValue(true);
    mockResolveEligibleCampaigns.mockResolvedValue({
      campaigns: [{ id: 'cmp_1', content: { title: 'Teste' } }],
      evaluatedAt: '2026-05-20T12:00:00.000Z'
    });
    mockRecordEvent.mockResolvedValue({ id: 'evt_1', campaignId: 'cmp_1' });
    mockUploadAsset.mockResolvedValue({
      id: 'asset_1',
      imageUrl: 'https://storage.leaf.test/campaign.webp',
      filePath: 'campaign-center/assets/asset_1.webp',
      fileSize: 9,
      contentType: 'image/webp'
    });
    mockGetSlotDefinitions.mockReturnValue([
      {
        id: 'passenger_home_banner_stack',
        surface: 'passenger_home',
        placement: 'below_search_card',
        dimensions: { heightDp: 188 }
      }
    ]);
    mockGetCommercialReport.mockResolvedValue({
      generatedAt: '2026-05-22T00:00:00.000Z',
      totals: {
        campaignValueCents: 150000,
        impressions: 10000,
        clicks: 250,
        ctr: 0.025,
        effectiveCpmCents: 15000,
        effectiveCpcCents: 600
      },
      rows: [{ id: 'cmp_1', name: 'Teste', impressions: 10000, clicks: 250 }]
    });
  });

  it('lists admin campaigns with stats', async () => {
    const response = await request(createApp())
      .get('/api/campaign-center/campaigns?status=active');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      campaigns: [{ id: 'cmp_1' }],
      stats: { total: 1, active: 1 }
    });
    expect(mockAuthenticateJWT).toHaveBeenCalled();
    expect(mockRequireRole).toHaveBeenCalledWith(['admin', 'super-admin', 'manager', 'development']);
    expect(mockListCampaigns).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }));
  });

  it('creates campaigns behind admin auth', async () => {
    const response = await request(createApp())
      .post('/api/campaign-center/campaigns')
      .send({
        name: 'Nova',
        status: 'paused',
        content: { title: 'Nova', body: 'Texto' }
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      campaign: { id: 'cmp_new' }
    });
    expect(mockCreateCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Nova' }),
      expect.objectContaining({ id: 'admin_1' })
    );
    expect(mockLogStructured).toHaveBeenCalledWith(
      'info',
      'Campanha in-app criada',
      expect.objectContaining({
        action: 'campaign_center.campaign.create',
        entity: { type: 'campaign', id: 'cmp_new' },
        operator: expect.objectContaining({ id: 'admin_1', role: 'admin' })
      })
    );
  });

  it('blocks campaign admin mutations behind the launch admin mutation flag', async () => {
    mockIsLaunchFeatureEnabled.mockImplementation((feature) => feature !== 'adminMutationsEnabled');

    const response = await request(createApp())
      .post('/api/campaign-center/campaigns')
      .send({ name: 'Bloqueada' });

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      success: false,
      feature: 'admin_mutations'
    });
    expect(mockCreateCampaign).not.toHaveBeenCalled();
    expect(mockLogStructured).toHaveBeenCalledWith(
      'warn',
      'Mutacao admin de Campaign Center bloqueada por feature flag',
      expect.objectContaining({
        action: 'campaign_center.admin_mutation.blocked',
        entity: { type: 'campaign_center', id: null },
        operator: expect.objectContaining({ id: 'admin_1', role: 'admin' })
      })
    );
  });

  it('returns eligible app campaigns without blocking on admin JWT', async () => {
    const response = await request(createApp())
      .get('/api/campaign-center/eligible?surface=passenger_home&placement=above_search_card&role=customer&userId=spoofed_user');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      campaigns: [{ id: 'cmp_1' }]
    });
    expect(mockResolveEligibleCampaigns).toHaveBeenCalledWith(
      expect.objectContaining({
        surface: 'passenger_home',
        placement: 'above_search_card',
        role: 'customer',
        userId: null
      })
    );
  });

  it('records app campaign events', async () => {
    const response = await request(createApp())
      .post('/api/campaign-center/events')
      .send({
        eventType: 'impression',
        campaignId: 'cmp_1',
        surface: 'passenger_home'
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      event: { id: 'evt_1', campaignId: 'cmp_1' }
    });
    expect(mockRecordEvent).toHaveBeenCalledWith(
      expect.objectContaining({
          eventType: 'impression',
          campaignId: 'cmp_1',
          userId: null
      })
    );
  });

  it('lists campaign slot definitions for the dashboard', async () => {
    const response = await request(createApp())
      .get('/api/campaign-center/slots');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      slots: [
        {
          id: 'passenger_home_banner_stack',
          placement: 'below_search_card',
          dimensions: { heightDp: 188 }
        }
      ]
    });
    expect(mockGetSlotDefinitions).toHaveBeenCalled();
  });

  it('returns commercial campaign report for future ad sales', async () => {
    const response = await request(createApp())
      .get('/api/campaign-center/commercial-report?surface=passenger_home');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      report: {
        totals: {
          campaignValueCents: 150000,
          impressions: 10000,
          clicks: 250,
          ctr: 0.025,
          effectiveCpmCents: 15000,
          effectiveCpcCents: 600
        }
      }
    });
    expect(mockGetCommercialReport).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'passenger_home' })
    );
  });

  it('uploads campaign assets through admin auth', async () => {
    const response = await request(createApp())
      .post('/api/campaign-center/assets')
      .attach('file', Buffer.from('fake-webp'), {
        filename: 'banner.webp',
        contentType: 'image/webp'
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      success: true,
      asset: {
        id: 'asset_1',
        imageUrl: 'https://storage.leaf.test/campaign.webp'
      }
    });
    expect(mockUploadAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        originalname: 'banner.webp',
        mimetype: 'image/webp'
      }),
      expect.objectContaining({ id: 'admin_1' })
    );
    expect(mockLogStructured).toHaveBeenCalledWith(
      'info',
      'Asset de campanha enviado',
      expect.objectContaining({
        action: 'campaign_center.asset.upload',
        entity: { type: 'campaign_asset', id: 'asset_1' }
      })
    );
  });
});
