const mockStorageFileSave = jest.fn();
const mockStorageFileGetSignedUrl = jest.fn();
const mockStorageFile = jest.fn(() => ({
  save: mockStorageFileSave,
  getSignedUrl: mockStorageFileGetSignedUrl
}));
const mockStorageBucket = jest.fn(() => ({
  file: mockStorageFile
}));
const mockGetStorage = jest.fn(() => ({
  bucket: mockStorageBucket
}));

jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null),
  getStorage: mockGetStorage
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const campaignCenterService = require('../../../services/campaign-center-service');

describe('campaign-center-service', () => {
  beforeEach(() => {
    campaignCenterService.__resetForTests();
    mockStorageFileSave.mockReset();
    mockStorageFileGetSignedUrl.mockReset().mockResolvedValue(['https://storage.leaf.test/campaign.webp']);
    mockStorageFile.mockClear();
    mockStorageBucket.mockClear();
    mockGetStorage.mockClear();
  });

  it('seeds Figma campaigns as paused so they do not publish by accident', async () => {
    const campaigns = await campaignCenterService.listCampaigns();

    expect(campaigns.length).toBeGreaterThan(0);
    expect(campaigns.every((campaign) => campaign.status === 'paused')).toBe(true);
    expect(campaigns.map((campaign) => campaign.id)).toContain('cmp_leaf_welcome_passenger');
  });

  it('exposes and resolves the ride map vehicle marker campaign slot', async () => {
    const slot = campaignCenterService
      .getSlotDefinitions()
      .find((candidate) => candidate.id === 'ride_map_vehicle_marker');

    expect(slot).toEqual(
      expect.objectContaining({
        surface: 'ride_map',
        placement: 'vehicle_marker',
        role: 'all',
        template: 'map_vehicle_marker'
      })
    );

    await campaignCenterService.createCampaign({
      id: 'cmp_ride_map_marker',
      name: 'Marcador de carro no mapa',
      status: 'active',
      template: 'map_vehicle_marker',
      priority: 100,
      surfaces: ['ride_map'],
      placements: ['vehicle_marker'],
      audience: { roles: ['all'] },
      content: {
        imageUrl: 'https://cdn.leaf.test/markers/car.webp',
        imageAlt: 'Marcador de carro Leaf'
      }
    });

    const result = await campaignCenterService.resolveEligibleCampaigns({
      userId: 'driver_1',
      role: 'driver',
      surface: 'ride_map',
      placement: 'vehicle_marker',
      limit: 1
    });

    expect(result.campaigns).toHaveLength(1);
    expect(result.campaigns[0]).toEqual(
      expect.objectContaining({
        id: 'cmp_ride_map_marker',
        template: 'map_vehicle_marker',
        content: expect.objectContaining({
          imageUrl: 'https://cdn.leaf.test/markers/car.webp'
        })
      })
    );
  });

  it('returns only active campaigns that match surface, placement and role', async () => {
    await campaignCenterService.createCampaign({
      id: 'cmp_passenger_home',
      name: 'Passageiro home',
      status: 'active',
      priority: 50,
      surfaces: ['passenger_home'],
      placements: ['above_search_card'],
      audience: { roles: ['customer'] },
      content: {
        title: 'Hoje a taxa e nossa',
        body: 'Campanha disponivel antes da corrida.',
        cta: { label: 'Ver', action: 'open_campaign_details' }
      }
    });
    await campaignCenterService.createCampaign({
      id: 'cmp_driver_home',
      name: 'Motorista home',
      status: 'active',
      priority: 80,
      surfaces: ['driver_home'],
      placements: ['above_driver_card'],
      audience: { roles: ['driver'] },
      content: {
        title: 'Corrida perto',
        body: 'Fique online para receber chamadas.',
        cta: { label: 'Ficar online', action: 'driver_go_online' }
      }
    });

    const result = await campaignCenterService.resolveEligibleCampaigns({
      userId: 'user_1',
      role: 'customer',
      surface: 'passenger_home',
      placement: 'above_search_card'
    });

    expect(result.campaigns).toHaveLength(1);
    expect(result.campaigns[0]).toEqual(
      expect.objectContaining({
        id: 'cmp_passenger_home',
        surface: 'passenger_home',
        placement: 'above_search_card'
      })
    );
  });

  it('returns up to three home banner campaigns with creative metadata for the carousel', async () => {
    await campaignCenterService.createCampaign({
      id: 'cmp_home_banner_a',
      name: 'Home banner A',
      status: 'active',
      template: 'home_banner_card',
      priority: 999,
      priority: 90,
      surfaces: ['passenger_home'],
      placements: ['below_search_card'],
      audience: { roles: ['customer'] },
      rules: {
        autoRotateSeconds: 5,
        rotationWeight: 1
      },
      content: {
        title: 'Banner A',
        body: 'Primeira peca',
        imageUrl: 'https://cdn.leaf.test/banner-a.webp',
        imageAlt: 'Banner A',
        displayMode: 'image_only',
        backgroundColor: '#FBFCF8',
        cta: { label: 'Ver', action: 'open_campaign_details' }
      }
    });
    await campaignCenterService.createCampaign({
      id: 'cmp_home_banner_b',
      name: 'Home banner B',
      status: 'active',
      template: 'home_banner_card',
      priority: 80,
      surfaces: ['passenger_home'],
      placements: ['below_search_card'],
      audience: { roles: ['customer'] },
      content: {
        title: 'Banner B',
        body: 'Segunda peca',
        cta: { label: 'Ver', action: 'open_campaign_details' }
      }
    });

    const result = await campaignCenterService.resolveEligibleCampaigns({
      userId: 'user_banner',
      role: 'customer',
      surface: 'passenger_home',
      placement: 'below_search_card',
      limit: 3
    });

    expect(result.campaigns.map((campaign) => campaign.id)).toEqual([
      'cmp_home_banner_a',
      'cmp_home_banner_b'
    ]);
    expect(result.campaigns[0]).toEqual(
      expect.objectContaining({
        template: 'home_banner_card',
        content: expect.objectContaining({
          imageUrl: 'https://cdn.leaf.test/banner-a.webp',
          imageAlt: 'Banner A',
          displayMode: 'image_only',
          hideTextOverlay: true
        }),
        rules: expect.objectContaining({
          autoRotateSeconds: 5,
          rotationWeight: 1
        })
      })
    );
  });

  it('uploads campaign images to the configured Firebase Storage bucket', async () => {
    const asset = await campaignCenterService.uploadAsset(
      {
        buffer: Buffer.from('fake-webp'),
        size: 9,
        mimetype: 'image/webp',
        originalname: 'banner rio.webp'
      },
      { id: 'admin_1', email: 'admin@leaf.test' }
    );

    expect(mockGetStorage).toHaveBeenCalled();
    expect(mockStorageBucket).toHaveBeenCalledWith('leaf-reactnative.firebasestorage.app');
    expect(mockStorageFile).toHaveBeenCalledWith(expect.stringMatching(/^campaign-center\/assets\/asset_/));
    expect(mockStorageFileSave).toHaveBeenCalledWith(
      Buffer.from('fake-webp'),
      expect.objectContaining({
        resumable: false,
        metadata: expect.objectContaining({
          contentType: 'image/webp',
          cacheControl: 'public, max-age=31536000, immutable'
        })
      })
    );
    expect(asset).toEqual(
      expect.objectContaining({
        imageUrl: 'https://storage.leaf.test/campaign.webp',
        contentType: 'image/webp',
        fileSize: 9
      })
    );
  });

  it('builds commercial report with CTR, CPM, CPC and delivery pacing', async () => {
    await campaignCenterService.createCampaign({
      id: 'cmp_paid_home_banner',
      name: 'Patrocinio home',
      status: 'active',
      template: 'home_banner_card',
      surfaces: ['passenger_home'],
      placements: ['below_search_card'],
      audience: { roles: ['customer'] },
      startAt: '2026-05-20T00:00:00.000Z',
      endAt: '2026-05-30T00:00:00.000Z',
      commercial: {
        advertiser: 'Marca Teste',
        campaignValueCents: 150000,
        contractedImpressions: 10000,
        contractedClicks: 200,
        soldCpmCents: 15000,
        soldCpcCents: 750,
        costModel: 'fixed_fee'
      },
      content: {
        title: 'Campanha paga',
        body: 'Banner vendido no home.',
        cta: { label: 'Ver', action: 'open_campaign_details' }
      }
    });

    for (let index = 0; index < 10; index += 1) {
      await campaignCenterService.recordEvent({
        eventType: 'impression',
        campaignId: 'cmp_paid_home_banner',
        surface: 'passenger_home',
        placement: 'below_search_card',
        role: 'customer'
      });
    }
    for (let index = 0; index < 2; index += 1) {
      await campaignCenterService.recordEvent({
        eventType: 'click',
        campaignId: 'cmp_paid_home_banner',
        surface: 'passenger_home',
        placement: 'below_search_card',
        role: 'customer'
      });
    }

    const report = await campaignCenterService.getCommercialReport({
      surface: 'passenger_home'
    });

    expect(report.totals).toEqual(
      expect.objectContaining({
        campaignValueCents: 150000,
        impressions: 10,
        clicks: 2,
        ctr: 0.2,
        effectiveCpmCents: 15000000,
        effectiveCpcCents: 75000
      })
    );
    expect(report.rows[0]).toEqual(
      expect.objectContaining({
        id: 'cmp_paid_home_banner',
        advertiser: 'Marca Teste',
        costModel: 'fixed_fee',
        contractedImpressions: 10000,
        soldCpmCents: 15000,
        deliveryProgress: 0.001
      })
    );
  });

  it('respects user impression caps and dismiss cooldowns', async () => {
    await campaignCenterService.createCampaign({
      id: 'cmp_capped',
      name: 'Cap test',
      status: 'active',
      surfaces: ['passenger_home'],
      placements: ['above_search_card'],
      audience: { roles: ['customer'] },
      rules: {
        maxImpressionsPerUser: 1,
        maxImpressionsPerDay: 1,
        dismissCooldownHours: 24
      },
      content: {
        title: 'Limite de exibicao',
        body: 'Nao deve reaparecer depois do cap.',
        cta: { label: 'Ok', action: 'dismiss' }
      }
    });

    const first = await campaignCenterService.resolveEligibleCampaigns({
      userId: 'user_2',
      role: 'customer',
      surface: 'passenger_home',
      placement: 'above_search_card'
    });
    expect(first.campaigns).toHaveLength(1);

    await campaignCenterService.recordEvent({
      eventType: 'impression',
      campaignId: 'cmp_capped',
      userId: 'user_2',
      surface: 'passenger_home',
      placement: 'above_search_card',
      role: 'customer'
    });

    const capped = await campaignCenterService.resolveEligibleCampaigns({
      userId: 'user_2',
      role: 'customer',
      surface: 'passenger_home',
      placement: 'above_search_card'
    });
    expect(capped.campaigns).toHaveLength(0);

    await campaignCenterService.createCampaign({
      id: 'cmp_dismissed',
      name: 'Dismiss test',
      status: 'active',
      priority: 99,
      surfaces: ['passenger_home'],
      placements: ['above_search_card'],
      audience: { roles: ['customer'] },
      rules: {
        maxImpressionsPerUser: 10,
        maxImpressionsPerDay: 10,
        dismissCooldownHours: 24
      },
      content: {
        title: 'Dispensar campanha',
        body: 'Nao deve voltar durante cooldown.',
        cta: { label: 'Fechar', action: 'dismiss' }
      }
    });

    await campaignCenterService.recordEvent({
      eventType: 'dismiss',
      campaignId: 'cmp_dismissed',
      userId: 'user_3',
      surface: 'passenger_home',
      placement: 'above_search_card',
      role: 'customer'
    });

    const dismissed = await campaignCenterService.resolveEligibleCampaigns({
      userId: 'user_3',
      role: 'customer',
      surface: 'passenger_home',
      placement: 'above_search_card'
    });
    expect(dismissed.campaigns.map((campaign) => campaign.id)).not.toContain('cmp_dismissed');
  });

  it('does not show active campaigns gated by disabled launch flags', async () => {
    const previousFlag = process.env.ENABLE_DEMAND_PREDICTION;
    process.env.ENABLE_DEMAND_PREDICTION = 'false';

    await campaignCenterService.createCampaign({
      id: 'cmp_flagged',
      name: 'Flag test',
      status: 'active',
      surfaces: ['passenger_home'],
      placements: ['above_search_card'],
      audience: { roles: ['customer'] },
      rules: {
        requiresFeatureFlag: 'demandPredictionEnabled'
      },
      content: {
        title: 'Campanha com flag',
        body: 'Nao deve aparecer com a flag desligada.',
        cta: { label: 'Ok', action: 'dismiss' }
      }
    });

    const blocked = await campaignCenterService.resolveEligibleCampaigns({
      userId: 'user_4',
      role: 'customer',
      surface: 'passenger_home',
      placement: 'above_search_card'
    });

    expect(blocked.campaigns.map((campaign) => campaign.id)).not.toContain('cmp_flagged');

    if (previousFlag === undefined) {
      delete process.env.ENABLE_DEMAND_PREDICTION;
    } else {
      process.env.ENABLE_DEMAND_PREDICTION = previousFlag;
    }
  });
});
