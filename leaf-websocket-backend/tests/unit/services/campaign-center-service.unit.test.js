jest.mock('../../../firebase-config', () => ({
  getFirestore: jest.fn(() => null)
}));

jest.mock('../../../utils/logger', () => ({
  logStructured: jest.fn(),
  logError: jest.fn()
}));

const campaignCenterService = require('../../../services/campaign-center-service');

describe('campaign-center-service', () => {
  beforeEach(() => {
    campaignCenterService.__resetForTests();
  });

  it('seeds Figma campaigns as paused so they do not publish by accident', async () => {
    const campaigns = await campaignCenterService.listCampaigns();

    expect(campaigns.length).toBeGreaterThan(0);
    expect(campaigns.every((campaign) => campaign.status === 'paused')).toBe(true);
    expect(campaigns.map((campaign) => campaign.id)).toContain('cmp_leaf_welcome_passenger');
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
