const admin = require('firebase-admin');
const crypto = require('crypto');
const path = require('path');
const firebaseConfig = require('../firebase-config');
const { logStructured } = require('../utils/logger');
const { isLaunchFeatureEnabled } = require('../utils/pilot-launch-flags');

const CAMPAIGNS_COLLECTION = 'campaign_center_campaigns';
const USER_STATE_COLLECTION = 'campaign_center_user_state';
const EVENTS_COLLECTION = 'campaign_center_events';
const DAILY_STATS_COLLECTION = 'campaign_center_daily_stats';

const VALID_STATUSES = ['draft', 'active', 'paused', 'archived', 'completed'];
const VALID_EVENT_TYPES = ['impression', 'click', 'dismiss', 'conversion', 'close', 'deep_link_open'];
const VALID_COMMERCIAL_MODELS = ['internal', 'fixed_fee', 'cpm', 'cpc', 'cpa', 'barter'];
const DEFAULT_DISMISS_COOLDOWN_HOURS = 48;
const DEFAULT_MAX_IMPRESSIONS_PER_USER = 5;
const MAX_ASSET_BYTES = 4 * 1024 * 1024;
const VALID_ASSET_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function nowIso() {
  return new Date().toISOString();
}

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeSlug(value, fallback = '') {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_./:-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = normalizeSlug(value);
    if (['true', '1', 'yes', 'sim', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'nao', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeDisplayMode(value, fallback = 'text_overlay') {
  const normalized = normalizeSlug(value, fallback);
  if (['image_only', 'creative_only', 'full_art', 'arte_completa'].includes(normalized)) return 'image_only';
  return 'text_overlay';
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeStatus(value, fallback = 'draft') {
  const safe = normalizeSlug(value, fallback);
  return VALID_STATUSES.includes(safe) ? safe : fallback;
}

function normalizeCommercialModel(value, fallback = 'internal') {
  const safe = normalizeSlug(value, fallback);
  return VALID_COMMERCIAL_MODELS.includes(safe) ? safe : fallback;
}

function normalizeArray(value, fallback = []) {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeSlug(item))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => normalizeSlug(item))
      .filter(Boolean);
  }
  return [...fallback];
}

function normalizeIso(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? fallback : value.toISOString();
  }
  if (typeof value === 'number') {
    const normalized = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
  }
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') {
      const parsed = value.toDate();
      return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
    }
    if (typeof value._seconds === 'number') {
      return new Date((value._seconds * 1000) + Math.round((value._nanoseconds || 0) / 1e6)).toISOString();
    }
  }
  return fallback;
}

function parseTs(value) {
  const iso = normalizeIso(value, null);
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  return Number.isFinite(ts) ? ts : null;
}

function buildCampaignId(name = '') {
  const slug = normalizeSlug(name, 'campaign').slice(0, 32) || 'campaign';
  const stamp = Date.now().toString(36);
  const random = crypto.randomBytes(3).toString('hex');
  return `cmp_${slug}_${stamp}_${random}`;
}

function sanitizeFilename(value = 'campaign-asset') {
  const safe = String(value || 'campaign-asset')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return safe || 'campaign-asset';
}

function extensionFromMimeType(mimetype = '') {
  if (mimetype === 'image/jpeg') return '.jpg';
  if (mimetype === 'image/png') return '.png';
  if (mimetype === 'image/webp') return '.webp';
  return '';
}

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

const CAMPAIGN_SLOT_DEFINITIONS = Object.freeze({
  passenger_home_banner_stack: {
    id: 'passenger_home_banner_stack',
    label: 'Passageiro home - card abaixo de partida/destino',
    surface: 'passenger_home',
    placement: 'below_search_card',
    role: 'customer',
    template: 'home_banner_card',
    maxItems: 3,
    autoRotateSeconds: 6,
    dimensions: {
      widthDp: 'screen_width_minus_48',
      horizontalInsetDp: 24,
      heightDp: 188,
      borderRadiusDp: 28,
      gapFromSearchCardDp: 12,
      innerPaddingHorizontalDp: 24,
      innerPaddingTopDp: 22,
      innerPaddingBottomDp: 18,
      referenceFramePx: { width: 345, height: 188 },
      exportPx: {
        '@1x': { width: 345, height: 188 },
        '@2x': { width: 690, height: 376 },
        '@3x': { width: 1035, height: 564 }
      },
      safeContentPx: {
        '@1x': { width: 297, height: 148 },
        '@2x': { width: 594, height: 296 },
        '@3x': { width: 891, height: 444 }
      }
    }
  },
  driver_home_banner_stack: {
    id: 'driver_home_banner_stack',
    label: 'Motorista home - card abaixo do painel inicial',
    surface: 'driver_home',
    placement: 'below_home_card',
    role: 'driver',
    template: 'home_banner_card',
    maxItems: 3,
    autoRotateSeconds: 6,
    dimensions: {
      widthDp: 'screen_width_minus_48',
      horizontalInsetDp: 24,
      heightDp: 188,
      borderRadiusDp: 32,
      gapFromDriverCardDp: 12,
      innerPaddingHorizontalDp: 24,
      innerPaddingTopDp: 22,
      innerPaddingBottomDp: 18,
      referenceFramePx: { width: 345, height: 188 },
      exportPx: {
        '@1x': { width: 345, height: 188 },
        '@2x': { width: 690, height: 376 },
        '@3x': { width: 1035, height: 564 }
      },
      safeContentPx: {
        '@1x': { width: 297, height: 148 },
        '@2x': { width: 594, height: 296 },
        '@3x': { width: 891, height: 444 }
      }
    }
  },
  ride_map_vehicle_marker: {
    id: 'ride_map_vehicle_marker',
    label: 'Mapa da corrida - marcador de veiculo',
    surface: 'ride_map',
    placement: 'vehicle_marker',
    role: 'all',
    template: 'map_vehicle_marker',
    maxItems: 1,
    autoRotateSeconds: 0,
    dimensions: {
      widthPx: 512,
      heightPx: 512,
      transparentBackground: true,
      safeContentPx: { width: 392, height: 456 },
      notes: [
        'Use PNG ou WebP transparente.',
        'Preserve rodas, vidros e sombra para leitura no mapa.',
        'O app usa o asset remoto somente após prefetch; sem asset ativo, usa o marcador local por cor do veiculo.'
      ]
    }
  }
});

function rolesMatch(campaignRoles = [], requestedRole = '') {
  const role = normalizeSlug(requestedRole);
  if (campaignRoles.length === 0 || campaignRoles.includes('all')) return true;
  if (role === 'customer' || role === 'passenger') {
    return campaignRoles.includes('customer') || campaignRoles.includes('passenger');
  }
  return campaignRoles.includes(role);
}

function resolveLaunchFeatureKey(value = '') {
  const raw = normalizeText(value);
  if (!raw) return '';
  const normalized = normalizeSlug(raw);
  const aliases = {
    admin_mutations_enabled: 'adminMutationsEnabled',
    adminmutationsenabled: 'adminMutationsEnabled',
    campaign_center_enabled: 'campaignCenterEnabled',
    campaigncenterenabled: 'campaignCenterEnabled',
    demand_prediction_enabled: 'demandPredictionEnabled',
    demandpredictionenabled: 'demandPredictionEnabled',
    driver_destination_mode_enabled: 'driverDestinationModeEnabled',
    driverdestinationmodeenabled: 'driverDestinationModeEnabled',
    driver_withdrawals_enabled: 'driverWithdrawalsEnabled',
    driverwithdrawalsenabled: 'driverWithdrawalsEnabled',
    dynamic_pricing_enabled: 'dynamicPricingEnabled',
    dynamicpricingenabled: 'dynamicPricingEnabled',
    leaf_delas_enabled: 'leafDelasEnabled',
    leafdelasenabled: 'leafDelasEnabled',
    referral_programs_enabled: 'referralProgramsEnabled',
    referralprogramsenabled: 'referralProgramsEnabled',
    smart_push_enabled: 'smartPushEnabled',
    smartpushenabled: 'smartPushEnabled',
    soft_ban_enforcement_enabled: 'softBanEnforcementEnabled',
    softbanenforcementenabled: 'softBanEnforcementEnabled'
  };
  return aliases[normalized] || raw;
}

function normalizeContent(raw = {}) {
  const cta = raw.cta && typeof raw.cta === 'object' ? raw.cta : {};
  const displayMode = normalizeDisplayMode(
    raw.displayMode || raw.creativeMode || raw.renderMode,
    normalizeBoolean(raw.hideTextOverlay) ? 'image_only' : 'text_overlay'
  );
  return {
    eyebrow: normalizeText(raw.eyebrow),
    title: normalizeText(raw.title),
    body: normalizeText(raw.body),
    footnote: normalizeText(raw.footnote),
    accent: normalizeText(raw.accent, '#1A330E'),
    assetKey: normalizeSlug(raw.assetKey),
    imageUrl: normalizeText(raw.imageUrl || raw.imageURL || raw.assetUrl || raw.assetURL),
    imageAlt: normalizeText(raw.imageAlt || raw.altText),
    displayMode,
    hideTextOverlay: displayMode === 'image_only' || normalizeBoolean(raw.hideTextOverlay),
    backgroundColor: normalizeText(raw.backgroundColor, '#FBFCF8'),
    textColor: normalizeText(raw.textColor, '#171412'),
    cta: {
      label: normalizeText(cta.label || raw.ctaLabel),
      action: normalizeSlug(cta.action || raw.ctaAction),
      url: normalizeText(cta.url || raw.ctaUrl),
      route: normalizeText(cta.route || raw.ctaRoute),
      payload: cta.payload && typeof cta.payload === 'object' ? cta.payload : {}
    }
  };
}

function normalizeAudience(raw = {}) {
  return {
    roles: normalizeArray(raw.roles || raw.role || raw.userTypes || raw.userType, ['all']),
    platforms: normalizeArray(raw.platforms || raw.platform, []),
    cities: normalizeArray(raw.cities || raw.city, []),
    userIds: Array.isArray(raw.userIds)
      ? raw.userIds.map(normalizeId).filter(Boolean)
      : [],
    excludeUserIds: Array.isArray(raw.excludeUserIds)
      ? raw.excludeUserIds.map(normalizeId).filter(Boolean)
      : [],
    minCompletedTrips: raw.minCompletedTrips ?? null,
    maxCompletedTrips: raw.maxCompletedTrips ?? null
  };
}

function normalizeRules(raw = {}) {
  return {
    dismissCooldownHours: Math.max(0, normalizeNumber(raw.dismissCooldownHours, DEFAULT_DISMISS_COOLDOWN_HOURS)),
    maxImpressionsPerUser: Math.max(0, normalizeNumber(raw.maxImpressionsPerUser, DEFAULT_MAX_IMPRESSIONS_PER_USER)),
    maxImpressionsPerDay: Math.max(0, normalizeNumber(raw.maxImpressionsPerDay, 2)),
    cooldownHours: Math.max(0, normalizeNumber(raw.cooldownHours, 0)),
    autoRotateSeconds: Math.max(0, normalizeNumber(raw.autoRotateSeconds, 6)),
    rotationWeight: Math.max(0, normalizeNumber(raw.rotationWeight, 1)),
    requiresFeatureFlag: normalizeSlug(raw.requiresFeatureFlag),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {}
  };
}

function normalizeCommercial(raw = {}) {
  return {
    advertiser: normalizeText(raw.advertiser || raw.sponsor || raw.brand),
    campaignValueCents: Math.max(0, normalizeInteger(raw.campaignValueCents || raw.valueCents || raw.budgetCents, 0)),
    contractedImpressions: Math.max(0, normalizeInteger(raw.contractedImpressions || raw.impressionsGoal, 0)),
    contractedClicks: Math.max(0, normalizeInteger(raw.contractedClicks || raw.clicksGoal, 0)),
    soldCpmCents: Math.max(0, normalizeInteger(raw.soldCpmCents || raw.cpmCents, 0)),
    soldCpcCents: Math.max(0, normalizeInteger(raw.soldCpcCents || raw.cpcCents, 0)),
    costModel: normalizeCommercialModel(raw.costModel || raw.pricingModel, 'internal'),
    invoiceId: normalizeText(raw.invoiceId),
    notes: normalizeText(raw.notes)
  };
}

function normalizeCampaign(raw = {}, fallbackId = '') {
  const createdAt = normalizeIso(raw.createdAt, nowIso());
  const id = normalizeId(raw.id || fallbackId || buildCampaignId(raw.name || raw.content?.title));
  const content = normalizeContent(raw.content || raw);
  const audience = normalizeAudience(raw.audience || raw);
  const rules = normalizeRules(raw.rules || {});
  const commercial = normalizeCommercial(raw.commercial || raw.monetization || {});
  const surfaces = normalizeArray(raw.surfaces || raw.surface, ['passenger_home']);
  const placements = normalizeArray(raw.placements || raw.placement, ['default']);

  return {
    id,
    name: normalizeText(raw.name, content.title || id),
    status: normalizeStatus(raw.status, 'draft'),
    template: normalizeSlug(raw.template || raw.type, 'compact_banner'),
    priority: normalizeNumber(raw.priority, 0),
    surfaces,
    placements,
    audience,
    rules,
    commercial,
    content,
    startAt: normalizeIso(raw.startAt || raw.startDate, null),
    endAt: normalizeIso(raw.endAt || raw.endDate, null),
    metrics: raw.metrics && typeof raw.metrics === 'object'
      ? raw.metrics
      : {
          impressions: 0,
          clicks: 0,
          dismissals: 0,
          conversions: 0
        },
    source: normalizeText(raw.source, 'firestore'),
    createdAt,
    createdBy: normalizeText(raw.createdBy, 'admin'),
    updatedAt: normalizeIso(raw.updatedAt, createdAt),
    updatedBy: normalizeText(raw.updatedBy || raw.createdBy, 'admin')
  };
}

function normalizeEvent(raw = {}) {
  const eventType = normalizeSlug(raw.eventType || raw.type, 'impression');
  return {
    id: normalizeId(raw.id || raw.eventId || `evt_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`),
    campaignId: normalizeId(raw.campaignId),
    eventType: VALID_EVENT_TYPES.includes(eventType) ? eventType : 'impression',
    userId: normalizeId(raw.userId),
    surface: normalizeSlug(raw.surface),
    placement: normalizeSlug(raw.placement),
    role: normalizeSlug(raw.role || raw.userType),
    platform: normalizeSlug(raw.platform),
    appVersion: normalizeText(raw.appVersion),
    sessionId: normalizeText(raw.sessionId),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    createdAt: normalizeIso(raw.createdAt, nowIso())
  };
}

function buildClientCampaign(campaign, context = {}) {
  const surface = normalizeSlug(context.surface) || campaign.surfaces[0] || 'default';
  const placement = normalizeSlug(context.placement) || campaign.placements[0] || 'default';
  return {
    id: campaign.id,
    name: campaign.name,
    template: campaign.template,
    surface,
    placement,
    priority: campaign.priority,
    content: campaign.content,
    rules: {
      autoRotateSeconds: Number(campaign.rules?.autoRotateSeconds || 6),
      rotationWeight: Number(campaign.rules?.rotationWeight || 1)
    },
    tracking: {
      campaignId: campaign.id,
      surface,
      placement
    }
  };
}

function buildDefaultCampaigns() {
  const createdAt = nowIso();
  const base = {
    status: 'paused',
    startAt: null,
    endAt: null,
    createdAt,
    updatedAt: createdAt,
    createdBy: 'system:figma_seed',
    updatedBy: 'system:figma_seed',
    source: 'figma:Leaf Ride Lifecycle UX Study 5 Variations',
    rules: {
      dismissCooldownHours: 72,
      maxImpressionsPerUser: 6,
      maxImpressionsPerDay: 2
    }
  };

  return [
    normalizeCampaign({
      ...base,
      id: 'cmp_leaf_welcome_passenger',
      name: 'Bem-vindo passageiro',
      template: 'compact_banner',
      priority: 30,
      surfaces: ['passenger_home'],
      placements: ['above_search_card'],
      audience: { roles: ['customer', 'passenger'] },
      content: {
        eyebrow: 'Bem-vindo',
        title: 'Bem-vindo à Leaf.',
        body: 'Peça sua corrida com clareza no valor, no trajeto e no acompanhamento.',
        cta: { label: 'Escolher destino', action: 'open_destination' },
        assetKey: 'figma_hero_welcome_leaf'
      }
    }),
    normalizeCampaign({
      ...base,
      id: 'cmp_leaf_zero_fee_passenger',
      name: 'Taxa zero passageiro',
      template: 'hero_banner',
      priority: 45,
      surfaces: ['passenger_home', 'payment'],
      placements: ['above_search_card', 'payment_top'],
      audience: { roles: ['customer', 'passenger'] },
      content: {
        eyebrow: 'Hoje',
        title: 'Hoje a taxa é nossa.',
        body: 'Quando a campanha estiver ativa, a condição aparece antes de confirmar a corrida.',
        cta: { label: 'Ver condição', action: 'open_campaign_details' },
        assetKey: 'figma_hero_zero_fee'
      }
    }),
    normalizeCampaign({
      ...base,
      id: 'cmp_leaf_rio_comfort_home_1',
      name: 'Home banner Rio conforto 1',
      template: 'home_banner_card',
      priority: 60,
      surfaces: ['passenger_home'],
      placements: ['below_search_card'],
      audience: { roles: ['customer', 'passenger'], cities: ['rio_de_janeiro'] },
      rules: {
        ...base.rules,
        autoRotateSeconds: 6,
        rotationWeight: 1,
        metadata: {
          slot: 'passenger_home_banner_stack',
          creativeSpec: CAMPAIGN_SLOT_DEFINITIONS.passenger_home_banner_stack.dimensions
        }
      },
      content: {
        eyebrow: 'Leaf no Rio',
        title: 'Viaje com mais conforto',
        body: 'Motoristas verificados, ar ligado e uma experiência mais calma para chegar bem.',
        cta: { label: 'Novidades', action: 'open_campaign_details' },
        assetKey: 'figma_home_banner_rio_comfort_1',
        backgroundColor: '#FBFCF8',
        imageAlt: 'Campanha de conforto da Leaf no Rio de Janeiro'
      }
    }),
    normalizeCampaign({
      ...base,
      id: 'cmp_leaf_rio_safety_home_2',
      name: 'Home banner Rio seguranca 2',
      template: 'home_banner_card',
      priority: 55,
      surfaces: ['passenger_home'],
      placements: ['below_search_card'],
      audience: { roles: ['customer', 'passenger'], cities: ['rio_de_janeiro'] },
      rules: {
        ...base.rules,
        autoRotateSeconds: 6,
        rotationWeight: 1,
        metadata: {
          slot: 'passenger_home_banner_stack',
          creativeSpec: CAMPAIGN_SLOT_DEFINITIONS.passenger_home_banner_stack.dimensions
        }
      },
      content: {
        eyebrow: 'Segurança',
        title: 'Motoristas verificados',
        body: 'A Leaf acompanha a qualidade da operação para cada viagem começar melhor.',
        cta: { label: 'Saiba mais', action: 'open_campaign_details' },
        assetKey: 'figma_home_banner_rio_safety_2',
        backgroundColor: '#FBFCF8',
        imageAlt: 'Campanha de segurança e verificação de motoristas'
      }
    }),
    normalizeCampaign({
      ...base,
      id: 'cmp_leaf_rio_zero_fee_home_3',
      name: 'Home banner Rio taxa zero 3',
      template: 'home_banner_card',
      priority: 50,
      surfaces: ['passenger_home'],
      placements: ['below_search_card'],
      audience: { roles: ['customer', 'passenger'], cities: ['rio_de_janeiro'] },
      rules: {
        ...base.rules,
        autoRotateSeconds: 6,
        rotationWeight: 1,
        metadata: {
          slot: 'passenger_home_banner_stack',
          creativeSpec: CAMPAIGN_SLOT_DEFINITIONS.passenger_home_banner_stack.dimensions
        }
      },
      content: {
        eyebrow: 'Campanha',
        title: 'Condição especial',
        body: 'Ative campanhas por cidade sem precisar publicar uma nova versão do app.',
        cta: { label: 'Ver oferta', action: 'open_campaign_details' },
        assetKey: 'figma_home_banner_rio_zero_fee_3',
        backgroundColor: '#FBFCF8',
        imageAlt: 'Campanha promocional Leaf para passageiros'
      }
    }),
    normalizeCampaign({
      ...base,
      id: 'cmp_leaf_driver_online_nearby',
      name: 'Motorista ficar online',
      template: 'compact_banner',
      priority: 40,
      surfaces: ['driver_home'],
      placements: ['below_home_card'],
      audience: { roles: ['driver'] },
      rules: {
        ...base.rules,
        autoRotateSeconds: 6,
        rotationWeight: 1,
        metadata: {
          slot: 'driver_home_banner_stack',
          creativeSpec: CAMPAIGN_SLOT_DEFINITIONS.driver_home_banner_stack.dimensions
        }
      },
      content: {
        eyebrow: 'Perto de você',
        title: 'Corrida perto. Fica online?',
        body: 'Ative quando estiver pronto para receber chamadas no seu raio.',
        cta: { label: 'Ficar online', action: 'driver_go_online' },
        assetKey: 'figma_compact_driver_online'
      }
    }),
    normalizeCampaign({
      ...base,
      id: 'cmp_leaf_driver_pix',
      name: 'Motorista Pix',
      template: 'compact_banner',
      priority: 25,
      surfaces: ['driver_home', 'driver_earnings'],
      placements: ['below_home_card', 'earnings_top'],
      audience: { roles: ['driver'] },
      content: {
        eyebrow: 'Ganhos',
        title: 'Seu dinheiro, direto no PIX.',
        body: 'Acompanhe o saldo e solicite saque quando estiver disponível.',
        cta: { label: 'Ver ganhos', action: 'open_earnings' },
        assetKey: 'figma_compact_driver_pix'
      }
    }),
    normalizeCampaign({
      ...base,
      id: 'cmp_leaf_comfort_passenger',
      name: 'Conforto em viagem',
      template: 'bottom_sheet',
      priority: 20,
      surfaces: ['passenger_home', 'trip_active'],
      placements: ['comfort_tip', 'trip_tip'],
      audience: { roles: ['customer', 'passenger'] },
      content: {
        eyebrow: 'Conforto',
        title: 'Viagem leve do início ao fim.',
        body: 'Preferências de ar, conversa e som ajudam a deixar a corrida do seu jeito.',
        cta: { label: 'Entendi', action: 'dismiss' },
        assetKey: 'figma_compact_comfort'
      }
    })
  ];
}

class CampaignCenterService {
  constructor() {
    this.firestore = null;
    this.memoryCampaigns = new Map();
    this.memoryUserState = new Map();
    this.memoryEvents = new Map();
    this.memorySeeded = false;
  }

  getFirestore() {
    if (!this.firestore && firebaseConfig?.getFirestore) {
      this.firestore = firebaseConfig.getFirestore();
    }
    return this.firestore;
  }

  campaignsCollection() {
    const firestore = this.getFirestore();
    return firestore ? firestore.collection(CAMPAIGNS_COLLECTION) : null;
  }

  userStateCollection() {
    const firestore = this.getFirestore();
    return firestore ? firestore.collection(USER_STATE_COLLECTION) : null;
  }

  eventsCollection() {
    const firestore = this.getFirestore();
    return firestore ? firestore.collection(EVENTS_COLLECTION) : null;
  }

  dailyStatsCollection() {
    const firestore = this.getFirestore();
    return firestore ? firestore.collection(DAILY_STATS_COLLECTION) : null;
  }

  async seedDefaultsIfEmpty() {
    const collection = this.campaignsCollection();
    const defaults = buildDefaultCampaigns();

    if (!collection) {
      if (!this.memorySeeded && this.memoryCampaigns.size === 0) {
        defaults.forEach((campaign) => this.memoryCampaigns.set(campaign.id, campaign));
      }
      this.memorySeeded = true;
      return defaults;
    }

    const snapshot = await collection.limit(1).get();
    if (!snapshot.empty) return [];

    const batch = this.getFirestore().batch();
    defaults.forEach((campaign) => {
      batch.set(collection.doc(campaign.id), campaign, { merge: true });
    });
    await batch.commit();
    return defaults;
  }

  async listCampaigns(filters = {}) {
    await this.seedDefaultsIfEmpty();
    const collection = this.campaignsCollection();
    const rows = collection
      ? (await collection.get()).docs.map((doc) => normalizeCampaign(doc.data(), doc.id))
      : Array.from(this.memoryCampaigns.values()).map((row) => normalizeCampaign(row, row.id));

    const status = normalizeSlug(filters.status);
    const surface = normalizeSlug(filters.surface);
    const role = normalizeSlug(filters.role || filters.userType);
    const query = String(filters.query || '').trim().toLowerCase();

    return rows
      .filter((campaign) => !status || status === 'all' || campaign.status === status)
      .filter((campaign) => !surface || campaign.surfaces.includes(surface))
      .filter((campaign) => !role || rolesMatch(campaign.audience.roles, role))
      .filter((campaign) => {
        if (!query) return true;
        return `${campaign.id} ${campaign.name} ${campaign.content.title} ${campaign.content.body}`
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => {
        const priorityDelta = b.priority - a.priority;
        if (priorityDelta !== 0) return priorityDelta;
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      });
  }

  async getCampaign(campaignId) {
    const safeId = normalizeId(campaignId);
    if (!safeId) return null;
    await this.seedDefaultsIfEmpty();
    const collection = this.campaignsCollection();
    if (!collection) {
      const row = this.memoryCampaigns.get(safeId);
      return row ? normalizeCampaign(row, safeId) : null;
    }
    const doc = await collection.doc(safeId).get();
    return doc.exists ? normalizeCampaign(doc.data(), doc.id) : null;
  }

  async createCampaign(payload = {}, actor = {}) {
    const normalized = normalizeCampaign({
      ...payload,
      id: payload.id || buildCampaignId(payload.name || payload.content?.title),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: actor.id || actor.email || payload.createdBy || 'admin',
      updatedBy: actor.id || actor.email || payload.updatedBy || 'admin',
      source: 'dashboard'
    });

    const collection = this.campaignsCollection();
    if (!collection) {
      this.memoryCampaigns.set(normalized.id, normalized);
      return normalized;
    }
    await collection.doc(normalized.id).set(normalized, { merge: true });
    return normalized;
  }

  async updateCampaign(campaignId, patch = {}, actor = {}) {
    const current = await this.getCampaign(campaignId);
    if (!current) return null;
    const normalized = normalizeCampaign({
      ...current,
      ...(patch || {}),
      content: {
        ...(current.content || {}),
        ...((patch && patch.content) || {})
      },
      audience: {
        ...(current.audience || {}),
        ...((patch && patch.audience) || {})
      },
      commercial: {
        ...(current.commercial || {}),
        ...((patch && (patch.commercial || patch.monetization)) || {})
      },
      rules: {
        ...(current.rules || {}),
        ...((patch && patch.rules) || {})
      },
      metrics: current.metrics || {},
      updatedAt: nowIso(),
      updatedBy: actor.id || actor.email || patch.updatedBy || current.updatedBy || 'admin',
      source: 'dashboard'
    }, current.id);

    const collection = this.campaignsCollection();
    if (!collection) {
      this.memoryCampaigns.set(normalized.id, normalized);
      return normalized;
    }
    await collection.doc(normalized.id).set(normalized, { merge: true });
    return normalized;
  }

  async getUserState(userId, campaignId) {
    const safeUserId = normalizeId(userId);
    const safeCampaignId = normalizeId(campaignId);
    if (!safeUserId || !safeCampaignId) return null;
    const stateId = `${safeUserId}__${safeCampaignId}`;
    const collection = this.userStateCollection();
    if (!collection) {
      return this.memoryUserState.get(stateId) || null;
    }
    const doc = await collection.doc(stateId).get();
    return doc.exists ? { id: doc.id, ...(doc.data() || {}) } : null;
  }

  campaignIsActive(campaign, nowTs = Date.now()) {
    if (!campaign || campaign.status !== 'active') return false;
    const startTs = parseTs(campaign.startAt);
    const endTs = parseTs(campaign.endAt);
    if (startTs && nowTs < startTs) return false;
    if (endTs && nowTs > endTs) return false;
    return true;
  }

  async campaignPassesUserState(campaign, context = {}) {
    const userId = normalizeId(context.userId);
    if (!userId) return true;
    const state = await this.getUserState(userId, campaign.id);
    if (!state) return true;

    const nowTs = Date.now();
    const dismissCooldownMs = (campaign.rules.dismissCooldownHours || DEFAULT_DISMISS_COOLDOWN_HOURS) * 60 * 60 * 1000;
    const lastDismissedTs = parseTs(state.lastDismissedAt);
    if (lastDismissedTs && dismissCooldownMs > 0 && nowTs - lastDismissedTs < dismissCooldownMs) {
      return false;
    }

    const maxImpressions = Number(campaign.rules.maxImpressionsPerUser || 0);
    if (maxImpressions > 0 && Number(state.impressions || 0) >= maxImpressions) {
      return false;
    }

    const maxDaily = Number(campaign.rules.maxImpressionsPerDay || 0);
    if (maxDaily > 0 && state.lastImpressionDay === todayKey() && Number(state.impressionsToday || 0) >= maxDaily) {
      return false;
    }

    const cooldownMs = Number(campaign.rules.cooldownHours || 0) * 60 * 60 * 1000;
    const lastImpressionTs = parseTs(state.lastImpressionAt);
    if (lastImpressionTs && cooldownMs > 0 && nowTs - lastImpressionTs < cooldownMs) {
      return false;
    }

    return true;
  }

  campaignMatchesContext(campaign, context = {}) {
    const surface = normalizeSlug(context.surface);
    const placement = normalizeSlug(context.placement);
    const role = normalizeSlug(context.role || context.userType);
    const platform = normalizeSlug(context.platform);
    const city = normalizeSlug(context.city);
    const userId = normalizeId(context.userId);
    const completedTrips = normalizeNumber(context.completedTrips, null);
    const requiredFeatureFlag = resolveLaunchFeatureKey(campaign.rules?.requiresFeatureFlag);

    if (surface && !campaign.surfaces.includes(surface)) return false;
    if (placement && !campaign.placements.includes(placement) && !campaign.placements.includes('default')) return false;
    if (!rolesMatch(campaign.audience.roles, role)) return false;
    if (campaign.audience.platforms.length > 0 && platform && !campaign.audience.platforms.includes(platform)) return false;
    if (campaign.audience.cities.length > 0 && city && !campaign.audience.cities.includes(city)) return false;
    if (campaign.audience.userIds.length > 0 && !campaign.audience.userIds.includes(userId)) return false;
    if (userId && campaign.audience.excludeUserIds.includes(userId)) return false;
    if (completedTrips !== null && campaign.audience.minCompletedTrips !== null && completedTrips < Number(campaign.audience.minCompletedTrips)) return false;
    if (completedTrips !== null && campaign.audience.maxCompletedTrips !== null && completedTrips > Number(campaign.audience.maxCompletedTrips)) return false;
    if (requiredFeatureFlag && !isLaunchFeatureEnabled(requiredFeatureFlag, false)) return false;
    return true;
  }

  async resolveEligibleCampaigns(context = {}) {
    const limit = Math.max(1, Math.min(10, normalizeNumber(context.limit, 1)));
    const campaigns = await this.listCampaigns({
      status: 'active',
      surface: context.surface,
      role: context.role || context.userType
    });

    const nowTs = Date.now();
    const eligible = [];
    for (const campaign of campaigns) {
      if (!this.campaignIsActive(campaign, nowTs)) continue;
      if (!this.campaignMatchesContext(campaign, context)) continue;
      if (!(await this.campaignPassesUserState(campaign, context))) continue;
      eligible.push(buildClientCampaign(campaign, context));
      if (eligible.length >= limit) break;
    }

    return {
      campaigns: eligible,
      evaluatedAt: nowIso(),
      context: {
        surface: normalizeSlug(context.surface),
        placement: normalizeSlug(context.placement),
        role: normalizeSlug(context.role || context.userType),
        platform: normalizeSlug(context.platform)
      }
    };
  }

  async recordEvent(payload = {}) {
    const event = normalizeEvent(payload);
    if (!event.campaignId) {
      throw new Error('campaignId obrigatório');
    }

    const collection = this.eventsCollection();
    if (!collection) {
      this.memoryEvents.set(event.id, event);
      await this.updateMemoryStateForEvent(event);
      return event;
    }

    const eventRef = collection.doc(event.id);
    const existing = await eventRef.get();
    if (existing.exists) {
      return normalizeEvent(existing.data());
    }

    await eventRef.set(event, { merge: true });
    await this.updateStateForEvent(event);
    return event;
  }

  async updateMemoryStateForEvent(event) {
    const campaign = this.memoryCampaigns.get(event.campaignId);
    if (campaign) {
      const metricKey = {
        impression: 'impressions',
        click: 'clicks',
        dismiss: 'dismissals',
        conversion: 'conversions',
        close: 'closes',
        deep_link_open: 'deepLinkOpens'
      }[event.eventType] || 'events';
      const nextCampaign = normalizeCampaign({
        ...campaign,
        metrics: {
          ...(campaign.metrics || {}),
          [metricKey]: Number(campaign.metrics?.[metricKey] || 0) + 1
        },
        updatedAt: nowIso()
      }, campaign.id);
      this.memoryCampaigns.set(event.campaignId, nextCampaign);
    }

    if (!event.userId) return;
    const stateId = `${event.userId}__${event.campaignId}`;
    const current = this.memoryUserState.get(stateId) || {
      id: stateId,
      userId: event.userId,
      campaignId: event.campaignId,
      impressions: 0,
      clicks: 0,
      dismissals: 0,
      conversions: 0,
      impressionsToday: 0,
      lastImpressionDay: todayKey()
    };
    const day = todayKey(new Date(event.createdAt));
    const next = {
      ...current,
      updatedAt: nowIso()
    };
    if (event.eventType === 'impression') {
      next.impressions = Number(next.impressions || 0) + 1;
      next.lastImpressionAt = event.createdAt;
      next.impressionsToday = next.lastImpressionDay === day ? Number(next.impressionsToday || 0) + 1 : 1;
      next.lastImpressionDay = day;
    }
    if (event.eventType === 'click') {
      next.clicks = Number(next.clicks || 0) + 1;
      next.lastClickedAt = event.createdAt;
    }
    if (event.eventType === 'dismiss') {
      next.dismissals = Number(next.dismissals || 0) + 1;
      next.lastDismissedAt = event.createdAt;
    }
    if (event.eventType === 'conversion') {
      next.conversions = Number(next.conversions || 0) + 1;
      next.lastConvertedAt = event.createdAt;
    }
    this.memoryUserState.set(stateId, next);
  }

  async updateStateForEvent(event) {
    const firestore = this.getFirestore();
    if (!firestore) {
      return this.updateMemoryStateForEvent(event);
    }

    const increments = {};
    let userPatch = null;
    if (event.eventType === 'impression') {
      increments.impressions = admin.firestore.FieldValue.increment(1);
    }
    if (event.eventType === 'click') {
      increments.clicks = admin.firestore.FieldValue.increment(1);
    }
    if (event.eventType === 'dismiss') {
      increments.dismissals = admin.firestore.FieldValue.increment(1);
    }
    if (event.eventType === 'conversion') {
      increments.conversions = admin.firestore.FieldValue.increment(1);
    }

    const writes = [];
    if (event.userId) {
      const stateId = `${event.userId}__${event.campaignId}`;
      const stateRef = this.userStateCollection().doc(stateId);
      const stateSnapshot = await stateRef.get();
      const current = stateSnapshot.exists ? (stateSnapshot.data() || {}) : {};
      const day = todayKey(new Date(event.createdAt));
      userPatch = {
        ...current,
        id: stateId,
        userId: event.userId,
        campaignId: event.campaignId,
        updatedAt: nowIso()
      };
      if (event.eventType === 'impression') {
        userPatch.impressions = Number(current.impressions || 0) + 1;
        userPatch.lastImpressionAt = event.createdAt;
        userPatch.impressionsToday = current.lastImpressionDay === day
          ? Number(current.impressionsToday || 0) + 1
          : 1;
        userPatch.lastImpressionDay = day;
      }
      if (event.eventType === 'click') {
        userPatch.clicks = Number(current.clicks || 0) + 1;
        userPatch.lastClickedAt = event.createdAt;
      }
      if (event.eventType === 'dismiss') {
        userPatch.dismissals = Number(current.dismissals || 0) + 1;
        userPatch.lastDismissedAt = event.createdAt;
      }
      if (event.eventType === 'conversion') {
        userPatch.conversions = Number(current.conversions || 0) + 1;
        userPatch.lastConvertedAt = event.createdAt;
      }
      writes.push(stateRef.set(userPatch, { merge: true }));
    }
    if (Object.keys(increments).length > 0) {
      writes.push(this.campaignsCollection().doc(event.campaignId).set({
        metrics: increments,
        updatedAt: nowIso()
      }, { merge: true }));
      const statsId = `${event.campaignId}__${todayKey(new Date(event.createdAt))}`;
      const eventCounterKey = {
        impression: 'impressions',
        click: 'clicks',
        dismiss: 'dismissals',
        conversion: 'conversions',
        close: 'closes',
        deep_link_open: 'deepLinkOpens'
      }[event.eventType] || 'events';
      writes.push(this.dailyStatsCollection().doc(statsId).set({
        campaignId: event.campaignId,
        date: todayKey(new Date(event.createdAt)),
        [eventCounterKey]: admin.firestore.FieldValue.increment(1),
        updatedAt: nowIso()
      }, { merge: true }));
    }

    await Promise.all(writes);
    return null;
  }

  async getStats(filters = {}) {
    const campaigns = await this.listCampaigns(filters);
    const impressions = campaigns.reduce((sum, campaign) => sum + Number(campaign.metrics?.impressions || 0), 0);
    const clicks = campaigns.reduce((sum, campaign) => sum + Number(campaign.metrics?.clicks || 0), 0);
    const campaignValueCents = campaigns.reduce((sum, campaign) => sum + Number(campaign.commercial?.campaignValueCents || 0), 0);
    return {
      total: campaigns.length,
      active: campaigns.filter((campaign) => campaign.status === 'active').length,
      paused: campaigns.filter((campaign) => campaign.status === 'paused').length,
      draft: campaigns.filter((campaign) => campaign.status === 'draft').length,
      archived: campaigns.filter((campaign) => campaign.status === 'archived').length,
      impressions,
      clicks,
      dismissals: campaigns.reduce((sum, campaign) => sum + Number(campaign.metrics?.dismissals || 0), 0),
      conversions: campaigns.reduce((sum, campaign) => sum + Number(campaign.metrics?.conversions || 0), 0),
      campaignValueCents,
      ctr: impressions > 0 ? clicks / impressions : 0,
      effectiveCpmCents: impressions > 0 ? (campaignValueCents / impressions) * 1000 : 0,
      effectiveCpcCents: clicks > 0 ? campaignValueCents / clicks : 0
    };
  }

  buildCommercialReportRow(campaign) {
    const impressions = Number(campaign.metrics?.impressions || 0);
    const clicks = Number(campaign.metrics?.clicks || 0);
    const dismissals = Number(campaign.metrics?.dismissals || 0);
    const conversions = Number(campaign.metrics?.conversions || 0);
    const campaignValueCents = Number(campaign.commercial?.campaignValueCents || 0);
    const contractedImpressions = Number(campaign.commercial?.contractedImpressions || 0);
    const contractedClicks = Number(campaign.commercial?.contractedClicks || 0);
    const startTs = parseTs(campaign.startAt);
    const endTs = parseTs(campaign.endAt);
    const nowTs = Date.now();
    const totalDays = startTs && endTs
      ? Math.max(1, Math.ceil((endTs - startTs) / 86_400_000))
      : null;
    const elapsedDays = startTs
      ? Math.max(0, Math.ceil((Math.min(nowTs, endTs || nowTs) - startTs) / 86_400_000))
      : null;
    const remainingDays = endTs
      ? Math.max(0, Math.ceil((endTs - nowTs) / 86_400_000))
      : null;
    const expectedProgress = totalDays && elapsedDays !== null
      ? Math.min(1, Math.max(0, elapsedDays / totalDays))
      : null;
    const deliveryProgress = contractedImpressions > 0
      ? Math.min(1, impressions / contractedImpressions)
      : null;

    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      template: campaign.template,
      advertiser: campaign.commercial?.advertiser || 'Leaf',
      costModel: campaign.commercial?.costModel || 'internal',
      surface: campaign.surfaces?.[0] || '',
      placement: campaign.placements?.[0] || '',
      startAt: campaign.startAt || null,
      endAt: campaign.endAt || null,
      totalDays,
      elapsedDays,
      remainingDays,
      campaignValueCents,
      contractedImpressions,
      contractedClicks,
      impressions,
      clicks,
      dismissals,
      conversions,
      ctr: impressions > 0 ? clicks / impressions : 0,
      cvr: clicks > 0 ? conversions / clicks : 0,
      effectiveCpmCents: impressions > 0 ? (campaignValueCents / impressions) * 1000 : 0,
      effectiveCpcCents: clicks > 0 ? campaignValueCents / clicks : 0,
      soldCpmCents: Number(campaign.commercial?.soldCpmCents || 0),
      soldCpcCents: Number(campaign.commercial?.soldCpcCents || 0),
      deliveryProgress,
      expectedProgress,
      pacing: expectedProgress !== null && deliveryProgress !== null
        ? deliveryProgress - expectedProgress
        : null
    };
  }

  async getCommercialReport(filters = {}) {
    const campaigns = await this.listCampaigns(filters);
    const rows = campaigns.map((campaign) => this.buildCommercialReportRow(campaign));
    const totals = rows.reduce((acc, row) => {
      acc.campaigns += 1;
      acc.campaignValueCents += row.campaignValueCents;
      acc.contractedImpressions += row.contractedImpressions;
      acc.contractedClicks += row.contractedClicks;
      acc.impressions += row.impressions;
      acc.clicks += row.clicks;
      acc.dismissals += row.dismissals;
      acc.conversions += row.conversions;
      return acc;
    }, {
      campaigns: 0,
      campaignValueCents: 0,
      contractedImpressions: 0,
      contractedClicks: 0,
      impressions: 0,
      clicks: 0,
      dismissals: 0,
      conversions: 0
    });

    return {
      generatedAt: nowIso(),
      filters: {
        status: normalizeSlug(filters.status),
        surface: normalizeSlug(filters.surface),
        role: normalizeSlug(filters.role || filters.userType),
        query: normalizeText(filters.query)
      },
      totals: {
        ...totals,
        ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
        cvr: totals.clicks > 0 ? totals.conversions / totals.clicks : 0,
        effectiveCpmCents: totals.impressions > 0 ? (totals.campaignValueCents / totals.impressions) * 1000 : 0,
        effectiveCpcCents: totals.clicks > 0 ? totals.campaignValueCents / totals.clicks : 0,
        deliveryProgress: totals.contractedImpressions > 0
          ? Math.min(1, totals.impressions / totals.contractedImpressions)
          : null
      },
      rows
    };
  }

  getSlotDefinitions() {
    return Object.values(CAMPAIGN_SLOT_DEFINITIONS);
  }

  async uploadAsset(file = {}, actor = {}) {
    if (!file?.buffer || !file?.size) {
      const error = new Error('Arquivo de imagem obrigatório');
      error.statusCode = 400;
      throw error;
    }
    if (!VALID_ASSET_MIME_TYPES.has(file.mimetype)) {
      const error = new Error('Use uma imagem JPG, PNG ou WebP');
      error.statusCode = 400;
      throw error;
    }
    if (Number(file.size || 0) > MAX_ASSET_BYTES) {
      const error = new Error('Imagem muito grande. Limite atual: 4MB');
      error.statusCode = 400;
      throw error;
    }

    const storage = firebaseConfig.getStorage();
    if (!storage) {
      const error = new Error('Firebase Storage não configurado');
      error.statusCode = 503;
      throw error;
    }

    const bucketName = process.env.FIREBASE_STORAGE_BUCKET || 'leaf-reactnative.firebasestorage.app';
    const bucket = storage.bucket(bucketName);
    const originalName = sanitizeFilename(file.originalname || 'campaign-asset');
    const originalExtension = path.extname(originalName);
    const extension = originalExtension || extensionFromMimeType(file.mimetype);
    const basename = sanitizeFilename(originalName.replace(originalExtension, ''));
    const assetId = `asset_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
    const objectPath = `campaign-center/assets/${assetId}_${basename}${extension}`;
    const storageFile = bucket.file(objectPath);

    await storageFile.save(file.buffer, {
      resumable: false,
      metadata: {
        contentType: file.mimetype,
        cacheControl: 'public, max-age=31536000, immutable',
        metadata: {
          uploadedBy: String(actor.id || actor.email || 'admin'),
          uploadedByEmail: String(actor.email || ''),
          source: 'campaign-center'
        }
      }
    });

    const [imageUrl] = await storageFile.getSignedUrl({
      action: 'read',
      expires: '2035-01-01'
    });

    return {
      id: assetId,
      imageUrl,
      filePath: objectPath,
      bucket: bucketName,
      contentType: file.mimetype,
      fileName: originalName,
      fileSize: Number(file.size || file.buffer.length || 0),
      uploadedAt: nowIso(),
      uploadedBy: actor.id || actor.email || 'admin'
    };
  }

  __resetForTests() {
    this.firestore = null;
    this.memoryCampaigns = new Map();
    this.memoryUserState = new Map();
    this.memoryEvents = new Map();
    this.memorySeeded = false;
  }
}

module.exports = new CampaignCenterService();
module.exports.normalizeCampaign = normalizeCampaign;
module.exports.buildDefaultCampaigns = buildDefaultCampaigns;
module.exports.CAMPAIGN_SLOT_DEFINITIONS = CAMPAIGN_SLOT_DEFINITIONS;
