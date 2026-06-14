/**
 * DAILY SUBSCRIPTION SERVICE
 *
 * Modelo vigente:
 * - Cobrança diária operacional por faixa de faturamento bruto diário na Leaf.
 * - Valor acumula como pendência apenas quando a flag global, a cidade e a coorte estão elegíveis.
 * - Liquidação da pendência ocorre exclusivamente no saque (PaymentService).
 * - Suspensa por padrão até maturidade operacional da cidade e comunicação prévia mínima.
 */

const { logger } = require('../utils/logger');
const firebaseConfig = require('../firebase-config');
const subscriptionStateService = require('./subscription-state-service');

class DailySubscriptionService {
  constructor() {
    this.BILLING_CONFIG_PATH =
      String(process.env.SUBSCRIPTION_BILLING_CONFIG_PATH || 'subscription_billing/config').trim();
    this.COLLECTION_MODE = 'withdrawal';
    this.DAILY_BILLING_ENABLED =
      String(process.env.SUBSCRIPTION_DAILY_BILLING_ENABLED || 'false').toLowerCase() === 'true';

    this.DEFAULT_DAILY_FEE_TIERS = [
      { id: 'up_to_100', minGrossCents: 0, maxGrossCents: 10000, dailyFeeCents: 0 },
      { id: '100_to_200', minGrossCents: 10001, maxGrossCents: 20000, dailyFeeCents: 490 },
      { id: '200_to_300', minGrossCents: 20001, maxGrossCents: 30000, dailyFeeCents: 790 },
      { id: '300_to_500', minGrossCents: 30001, maxGrossCents: 50000, dailyFeeCents: 1290 },
      { id: 'above_500', minGrossCents: 50001, maxGrossCents: null, dailyFeeCents: 1490 }
    ];
    this.DEFAULT_PLUS_WAVE_1_CENTS = this.parseCents(process.env.SUBSCRIPTION_PLUS_WAVE_1_DAILY_CENTS, 490);
    this.DEFAULT_PLUS_WAVE_2_CENTS = this.parseCents(process.env.SUBSCRIPTION_PLUS_WAVE_2_DAILY_CENTS, 790);
    this.DEFAULT_PLUS_WAVE_3_CENTS = this.parseCents(process.env.SUBSCRIPTION_PLUS_WAVE_3_DAILY_CENTS, 1490);
    this.DEFAULT_PLUS_DAILY_CENTS = this.parseCents(process.env.SUBSCRIPTION_PLUS_DAILY_CENTS, 1490);
    this.DEFAULT_ELITE_DAILY_CENTS = this.parseCents(process.env.SUBSCRIPTION_ELITE_DAILY_CENTS, 0);
    this.DEFAULT_MIN_ACCOUNT_AGE_DAYS = this.parseCents(process.env.SUBSCRIPTION_DAILY_MIN_ACCOUNT_AGE_DAYS, 60);
    this.DEFAULT_NOTICE_DAYS = this.parseCents(process.env.SUBSCRIPTION_DAILY_NOTICE_DAYS, 60);
    this.REQUIRE_CITY_ACTIVATION =
      String(process.env.SUBSCRIPTION_DAILY_REQUIRE_CITY_ACTIVATION || 'true').toLowerCase() !== 'false';
    this.ALLOW_MANUAL_DAILY_FEE_OVERRIDE =
      String(process.env.SUBSCRIPTION_DAILY_ALLOW_MANUAL_OVERRIDE || 'false').toLowerCase() === 'true';
    this.DEFAULT_ELIGIBLE_CITIES = this.parseCsv(process.env.SUBSCRIPTION_DAILY_ELIGIBLE_CITIES);

    logger.info('DailySubscriptionService inicializado', {
      billingConfigPath: this.BILLING_CONFIG_PATH,
      collectionMode: this.COLLECTION_MODE,
      dailyBillingEnabled: this.DAILY_BILLING_ENABLED,
      defaults: {
        plusWave1Cents: this.DEFAULT_PLUS_WAVE_1_CENTS,
        plusWave2Cents: this.DEFAULT_PLUS_WAVE_2_CENTS,
        plusWave3Cents: this.DEFAULT_PLUS_WAVE_3_CENTS,
        plusDefaultCents: this.DEFAULT_PLUS_DAILY_CENTS,
        eliteDefaultCents: this.DEFAULT_ELITE_DAILY_CENTS,
        dailyFeeTiers: this.DEFAULT_DAILY_FEE_TIERS,
        minAccountAgeDays: this.DEFAULT_MIN_ACCOUNT_AGE_DAYS,
        noticeDays: this.DEFAULT_NOTICE_DAYS,
        requireCityActivation: this.REQUIRE_CITY_ACTIVATION,
        eligibleCities: this.DEFAULT_ELIGIBLE_CITIES
      }
    });
  }

  parseCents(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  parseCsv(value) {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  toReais(cents) {
    return Number((Number(cents || 0) / 100).toFixed(2));
  }

  nowIso() {
    return new Date().toISOString();
  }

  getDayKey(date = new Date()) {
    return new Date(date).toISOString().slice(0, 10);
  }

  getWeekStartSunday(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d;
  }

  getWeekKey(date = new Date()) {
    const sunday = this.getWeekStartSunday(date);
    const y = sunday.getUTCFullYear();
    const m = String(sunday.getUTCMonth() + 1).padStart(2, '0');
    const d = String(sunday.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  getDefaultBillingConfig() {
    return {
      collectionMode: this.COLLECTION_MODE,
      activation: {
        minAccountAgeDays: this.DEFAULT_MIN_ACCOUNT_AGE_DAYS,
        noticeDays: this.DEFAULT_NOTICE_DAYS,
        requireCityActivation: this.REQUIRE_CITY_ACTIVATION,
        eligibleCities: this.DEFAULT_ELIGIBLE_CITIES,
        excludedDriverIds: [],
        enabledDriverIds: []
      },
      dailyFeeTiers: this.DEFAULT_DAILY_FEE_TIERS,
      plans: {
        plus: {
          defaultDailyFeeCents: this.DEFAULT_PLUS_DAILY_CENTS,
          dailyFeeTiers: this.DEFAULT_DAILY_FEE_TIERS,
          waves: {
            wave_1: { dailyFeeCents: this.DEFAULT_PLUS_WAVE_1_CENTS },
            wave_2: { dailyFeeCents: this.DEFAULT_PLUS_WAVE_2_CENTS },
            wave_3: { dailyFeeCents: this.DEFAULT_PLUS_WAVE_3_CENTS }
          }
        },
        elite: {
          defaultDailyFeeCents: this.DEFAULT_ELITE_DAILY_CENTS,
          dailyFeeTiers: this.DEFAULT_DAILY_FEE_TIERS,
          waves: {}
        }
      }
    };
  }

  normalizeWaveId(rawValue) {
    if (!rawValue && rawValue !== 0) return null;
    const raw = String(rawValue).trim().toLowerCase();
    if (!raw) return null;

    const digitsOnly = raw.match(/^\d+$/);
    if (digitsOnly) {
      return `wave_${digitsOnly[0]}`;
    }

    const normalized = raw
      .replace(/-/g, '_')
      .replace(/\s+/g, '_')
      .replace(/^onda_/, 'wave_')
      .replace(/^onda/, 'wave_')
      .replace(/^wave/, 'wave_')
      .replace(/__+/g, '_');

    return normalized;
  }

  normalizeWaveConfigEntry(rawValue, fallbackDailyFeeCents) {
    if (rawValue === null || rawValue === undefined) {
      return { dailyFeeCents: fallbackDailyFeeCents };
    }

    if (typeof rawValue === 'number' || typeof rawValue === 'string') {
      return { dailyFeeCents: this.parseCents(rawValue, fallbackDailyFeeCents) };
    }

    const entry = {};
    entry.dailyFeeCents = this.parseCents(rawValue.dailyFeeCents, fallbackDailyFeeCents);
    if (rawValue.feeExemptUntil) entry.feeExemptUntil = String(rawValue.feeExemptUntil);
    if (rawValue.exemptUntil) entry.feeExemptUntil = String(rawValue.exemptUntil);
    if (rawValue.isFeeExempt === true || rawValue.feeExempt === true) entry.isFeeExempt = true;
    return entry;
  }

  normalizeFeeTier(rawTier = {}, index = 0) {
    if (!rawTier || typeof rawTier !== 'object') {
      return null;
    }

    const dailyFeeCents = this.parseCents(rawTier.dailyFeeCents ?? rawTier.feeCents, -1);
    if (dailyFeeCents < 0) return null;

    const minGrossCents = this.parseCents(rawTier.minGrossCents ?? rawTier.minCents, 0);
    const rawMax = rawTier.maxGrossCents ?? rawTier.maxCents;
    const maxGrossCents = rawMax === null || rawMax === undefined || rawMax === ''
      ? null
      : this.parseCents(rawMax, null);

    return {
      id: String(rawTier.id || rawTier.key || `tier_${index + 1}`),
      minGrossCents,
      maxGrossCents,
      dailyFeeCents
    };
  }

  normalizeFeeTiers(rawTiers, fallbackTiers = this.DEFAULT_DAILY_FEE_TIERS) {
    if (!Array.isArray(rawTiers)) {
      return fallbackTiers.map((tier) => ({ ...tier }));
    }

    const tiers = rawTiers
      .map((tier, index) => this.normalizeFeeTier(tier, index))
      .filter(Boolean)
      .sort((a, b) => a.minGrossCents - b.minGrossCents);

    return tiers.length > 0 ? tiers : fallbackTiers.map((tier) => ({ ...tier }));
  }

  mergeBillingConfig(rawConfig = {}) {
    const defaults = this.getDefaultBillingConfig();
    const merged = JSON.parse(JSON.stringify(defaults));

    if (!rawConfig || typeof rawConfig !== 'object') {
      return merged;
    }

    const configuredCollectionMode = String(rawConfig.collectionMode || rawConfig.billingCollectionMode || '').toLowerCase();
    if (configuredCollectionMode === 'withdrawal' || configuredCollectionMode === 'balance') {
      merged.collectionMode = configuredCollectionMode;
    }

    merged.dailyFeeTiers = this.normalizeFeeTiers(rawConfig.dailyFeeTiers, merged.dailyFeeTiers);
    const rawActivation = rawConfig.activation && typeof rawConfig.activation === 'object'
      ? rawConfig.activation
      : rawConfig;
    merged.activation = {
      ...merged.activation,
      minAccountAgeDays: this.parseCents(
        rawActivation.minAccountAgeDays ?? rawActivation.minDriverAccountAgeDays,
        merged.activation.minAccountAgeDays
      ),
      noticeDays: this.parseCents(
        rawActivation.noticeDays ?? rawActivation.noticePeriodDays ?? rawActivation.advanceNoticeDays,
        merged.activation.noticeDays
      ),
      requireCityActivation: rawActivation.requireCityActivation === undefined
        ? merged.activation.requireCityActivation
        : String(rawActivation.requireCityActivation).toLowerCase() !== 'false',
      eligibleCities: Array.isArray(rawActivation.eligibleCities)
        ? rawActivation.eligibleCities.map((item) => String(item || '').trim()).filter(Boolean)
        : (rawActivation.eligibleCities ? this.parseCsv(rawActivation.eligibleCities) : merged.activation.eligibleCities),
      enabledDriverIds: Array.isArray(rawActivation.enabledDriverIds)
        ? rawActivation.enabledDriverIds.map((item) => String(item || '').trim()).filter(Boolean)
        : (rawActivation.enabledDriverIds ? this.parseCsv(rawActivation.enabledDriverIds) : merged.activation.enabledDriverIds),
      excludedDriverIds: Array.isArray(rawActivation.excludedDriverIds)
        ? rawActivation.excludedDriverIds.map((item) => String(item || '').trim()).filter(Boolean)
        : (rawActivation.excludedDriverIds ? this.parseCsv(rawActivation.excludedDriverIds) : merged.activation.excludedDriverIds)
    };

    const sourcePlans = rawConfig.plans && typeof rawConfig.plans === 'object'
      ? rawConfig.plans
      : rawConfig;

    for (const planType of ['plus', 'elite']) {
      const sourcePlan = sourcePlans[planType];
      if (!sourcePlan || typeof sourcePlan !== 'object') continue;

      const fallbackPlan = merged.plans[planType];
      fallbackPlan.defaultDailyFeeCents = this.parseCents(
        sourcePlan.defaultDailyFeeCents ?? sourcePlan.dailyFeeCents,
        fallbackPlan.defaultDailyFeeCents
      );
      fallbackPlan.dailyFeeTiers = this.normalizeFeeTiers(sourcePlan.dailyFeeTiers, merged.dailyFeeTiers);

      const sourceWaves = sourcePlan.waves && typeof sourcePlan.waves === 'object'
        ? sourcePlan.waves
        : {};

      for (const [waveKey, waveValue] of Object.entries(sourceWaves)) {
        const normalizedWave = this.normalizeWaveId(waveKey);
        if (!normalizedWave) continue;
        fallbackPlan.waves[normalizedWave] = this.normalizeWaveConfigEntry(
          waveValue,
          fallbackPlan.defaultDailyFeeCents
        );
      }
    }

    return merged;
  }

  async loadBillingConfig(db) {
    const fallback = this.getDefaultBillingConfig();
    if (!db) {
      return fallback;
    }

    try {
      const configSnapshot = await db.ref(this.BILLING_CONFIG_PATH).once('value');
      const config = configSnapshot.val() || {};
      return this.mergeBillingConfig(config);
    } catch (error) {
      logger.warn('Falha ao carregar config de billing, usando padrão', {
        error: error.message,
        path: this.BILLING_CONFIG_PATH
      });
      return fallback;
    }
  }

  resolvePlanType(driverData = {}, subscriptionData = {}) {
    const explicit = String(
      subscriptionData.planType ||
      driverData.planType ||
      driverData.subscription?.planType ||
      ''
    ).toLowerCase();

    if (explicit === 'elite') return 'elite';
    if (explicit === 'plus') return 'plus';

    const carType = String(driverData.carType || '').toLowerCase();
    if (carType.includes('elite')) return 'elite';
    if (carType.includes('plus')) return 'plus';

    return 'plus';
  }

  resolveWaveId(driverData = {}, subscriptionData = {}) {
    const candidates = [
      subscriptionData.waveId,
      subscriptionData.waveTag,
      subscriptionData.subscriptionWave,
      subscriptionData.subscriptionWaveId,
      subscriptionData.driverWave,
      driverData.waveId,
      driverData.waveTag,
      driverData.subscriptionWave,
      driverData.subscriptionWaveId,
      driverData.driverWave
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeWaveId(candidate);
      if (normalized) return normalized;
    }

    return null;
  }

  resolveWaveConfig(planConfig = {}, waveId = null) {
    if (!planConfig || !planConfig.waves) return null;
    if (!waveId) return null;

    const direct = planConfig.waves[waveId];
    if (direct) return direct;

    const compact = waveId.replace(/^wave_/, 'wave');
    if (planConfig.waves[compact]) return planConfig.waves[compact];

    const numeric = waveId.match(/^wave_(\d+)$/);
    if (numeric) {
      const n = numeric[1];
      return planConfig.waves[`wave_${n}`] || planConfig.waves[`wave${n}`] || null;
    }

    return null;
  }

  parseDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  isInFreePeriod(driverData = {}, now = new Date()) {
    const freeTrialEnd = this.parseDate(driverData.free_trial_end);
    if (driverData.is_first_500 === true && freeTrialEnd && now < freeTrialEnd) {
      return true;
    }

    const freeMonthsRemaining = Number(driverData.free_months || 0);
    const freeMonthsEnd = this.parseDate(driverData.free_months_end);
    if (freeMonthsRemaining > 0 && freeMonthsEnd && now < freeMonthsEnd) {
      return true;
    }

    const promotionFreeEnd = this.parseDate(driverData.promotion_free_end);
    if (promotionFreeEnd && now < promotionFreeEnd) {
      return true;
    }

    return false;
  }

  isInManualExemption(driverData = {}, subscriptionData = {}, waveConfig = {}, now = new Date()) {
    if (subscriptionData.isFeeExempt === true || subscriptionData.feeExempt === true) {
      return { active: true, reason: 'driver_manual_exempt' };
    }

    if (driverData.subscription_fee_exempt === true || driverData.subscriptionFeeExempt === true) {
      return { active: true, reason: 'driver_profile_exempt' };
    }

    if (waveConfig?.isFeeExempt === true) {
      return { active: true, reason: 'wave_config_exempt' };
    }

    const exemptionCandidates = [
      subscriptionData.feeExemptUntil,
      subscriptionData.exemptUntil,
      driverData.subscription_fee_exempt_until,
      driverData.subscriptionFeeExemptUntil,
      waveConfig?.feeExemptUntil
    ];

    for (const candidate of exemptionCandidates) {
      const endAt = this.parseDate(candidate);
      if (endAt && now < endAt) {
        return { active: true, reason: 'exempt_until', endsAt: endAt.toISOString() };
      }
    }

    return { active: false, reason: null, endsAt: null };
  }

  normalizeCity(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ');
  }

  resolveDriverCity(driverData = {}, subscriptionData = {}) {
    const candidates = [
      subscriptionData.city,
      subscriptionData.operatingCity,
      subscriptionData.marketCity,
      subscriptionData.activationCity,
      driverData.city,
      driverData.operatingCity,
      driverData.marketCity,
      driverData.activationCity,
      driverData.address?.city,
      driverData.profile?.city
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeCity(candidate);
      if (normalized) return normalized;
    }

    return null;
  }

  resolveDriverCreatedAt(driverData = {}, subscriptionData = {}) {
    const candidates = [
      subscriptionData.driverCreatedAt,
      subscriptionData.createdAt,
      subscriptionData.joinedAt,
      driverData.createdAt,
      driverData.created_at,
      driverData.registeredAt,
      driverData.approvedAt,
      driverData.joinedAt
    ];

    for (const candidate of candidates) {
      const parsed = this.parseDate(candidate);
      if (parsed) return parsed;
    }

    return null;
  }

  getAccountAgeDays(createdAt, now = new Date()) {
    if (!createdAt) return null;
    const ms = now.getTime() - createdAt.getTime();
    if (!Number.isFinite(ms) || ms < 0) return 0;
    return Math.floor(ms / 86400000);
  }

  resolveNoticeSentAt(driverData = {}, subscriptionData = {}) {
    const candidates = [
      subscriptionData.dailyFeeNoticeSentAt,
      subscriptionData.subscriptionDailyFeeNoticeSentAt,
      subscriptionData.billingNoticeSentAt,
      subscriptionData.operationalDailyFeeNoticeSentAt,
      driverData.dailyFeeNoticeSentAt,
      driverData.subscriptionDailyFeeNoticeSentAt,
      driverData.billing_notice_sent_at,
      driverData.subscription_daily_fee_notice_sent_at
    ];

    for (const candidate of candidates) {
      const parsed = this.parseDate(candidate);
      if (parsed) return parsed;
    }

    return null;
  }

  resolveGrossDailyRevenueCents(driverData = {}, subscriptionData = {}, dayKey = null, explicitValue = null) {
    const todayGrossMaps = [
      subscriptionData.dailyGrossRevenueByDate,
      subscriptionData.grossRevenueByDate,
      subscriptionData.dailyGrossCentsByDate,
      driverData.dailyGrossRevenueByDate,
      driverData.grossRevenueByDate,
      driverData.dailyGrossCentsByDate
    ];

    const candidates = [
      explicitValue,
      subscriptionData.dailyGrossRevenueCents,
      subscriptionData.grossDailyRevenueCents,
      subscriptionData.dailyGrossCents,
      subscriptionData.todayGrossRevenueCents,
      subscriptionData.leafDailyGrossRevenueCents,
      driverData.dailyGrossRevenueCents,
      driverData.grossDailyRevenueCents,
      driverData.dailyGrossCents,
      driverData.todayGrossRevenueCents,
      driverData.leafDailyGrossRevenueCents
    ];

    if (dayKey) {
      for (const map of todayGrossMaps) {
        if (map && typeof map === 'object' && map[dayKey] !== undefined) {
          candidates.unshift(map[dayKey]);
        }
      }
    }

    for (const candidate of candidates) {
      const parsed = this.parseCents(candidate, -1);
      if (parsed >= 0) return parsed;
    }

    return 0;
  }

  resolveDailyFeeFromGrossCents(grossDailyRevenueCents = 0, tiers = this.DEFAULT_DAILY_FEE_TIERS) {
    const gross = Math.max(0, Number(grossDailyRevenueCents || 0) || 0);
    const normalizedTiers = this.normalizeFeeTiers(tiers, this.DEFAULT_DAILY_FEE_TIERS);
    const tier = normalizedTiers.find((entry) => {
      const min = Math.max(0, Number(entry.minGrossCents || 0) || 0);
      const max = entry.maxGrossCents === null || entry.maxGrossCents === undefined
        ? null
        : Math.max(0, Number(entry.maxGrossCents || 0) || 0);
      return gross >= min && (max === null || gross <= max);
    }) || normalizedTiers[normalizedTiers.length - 1] || this.DEFAULT_DAILY_FEE_TIERS[0];

    return {
      tierId: tier.id,
      tierMinGrossCents: tier.minGrossCents,
      tierMaxGrossCents: tier.maxGrossCents,
      dailyFeeCents: this.parseCents(tier.dailyFeeCents, 0)
    };
  }

  resolveActivationEligibility({
    driverId = null,
    driverData = {},
    subscriptionData = {},
    billingConfig = null,
    now = new Date()
  }) {
    const config = billingConfig || this.getDefaultBillingConfig();
    const activation = config.activation || {};
    const driverKey = String(driverId || driverData.uid || driverData.id || subscriptionData.driverId || '').trim();
    const enabledDriverIds = new Set((activation.enabledDriverIds || []).map((id) => String(id || '').trim()).filter(Boolean));
    const excludedDriverIds = new Set((activation.excludedDriverIds || []).map((id) => String(id || '').trim()).filter(Boolean));

    if (driverKey && excludedDriverIds.has(driverKey)) {
      return { eligible: false, reason: 'driver_excluded', accountAgeDays: null, noticeAgeDays: null };
    }

    const forceIncluded = driverKey && enabledDriverIds.has(driverKey);

    const eligibleCities = (activation.eligibleCities || []).map((city) => this.normalizeCity(city)).filter(Boolean);
    const driverCity = this.resolveDriverCity(driverData, subscriptionData);
    const requireCityActivation = activation.requireCityActivation !== false;
    if (!forceIncluded && requireCityActivation && eligibleCities.length === 0) {
      return { eligible: false, reason: 'city_activation_not_configured', driverCity, accountAgeDays: null, noticeAgeDays: null };
    }

    if (!forceIncluded && eligibleCities.length > 0 && (!driverCity || !eligibleCities.includes(driverCity))) {
      return { eligible: false, reason: 'city_not_enabled', driverCity, accountAgeDays: null, noticeAgeDays: null };
    }

    const minAccountAgeDays = this.parseCents(activation.minAccountAgeDays, this.DEFAULT_MIN_ACCOUNT_AGE_DAYS);
    const createdAt = this.resolveDriverCreatedAt(driverData, subscriptionData);
    const accountAgeDays = this.getAccountAgeDays(createdAt, now);
    if (!forceIncluded && minAccountAgeDays > 0 && accountAgeDays === null) {
      return { eligible: false, reason: 'missing_driver_created_at', driverCity, accountAgeDays, noticeAgeDays: null };
    }

    if (!forceIncluded && minAccountAgeDays > 0 && accountAgeDays < minAccountAgeDays) {
      return { eligible: false, reason: 'min_account_age_not_met', driverCity, accountAgeDays, noticeAgeDays: null };
    }

    const noticeDays = this.parseCents(activation.noticeDays, this.DEFAULT_NOTICE_DAYS);
    const noticeSentAt = this.resolveNoticeSentAt(driverData, subscriptionData);
    const noticeAgeDays = this.getAccountAgeDays(noticeSentAt, now);
    if (!forceIncluded && noticeDays > 0 && noticeAgeDays === null) {
      return { eligible: false, reason: 'notice_not_sent', driverCity, accountAgeDays, noticeAgeDays };
    }

    if (!forceIncluded && noticeDays > 0 && noticeAgeDays < noticeDays) {
      return { eligible: false, reason: 'notice_period_not_met', driverCity, accountAgeDays, noticeAgeDays };
    }

    return {
      eligible: true,
      reason: forceIncluded ? 'driver_force_included' : 'eligible',
      driverCity,
      accountAgeDays,
      noticeAgeDays
    };
  }

  resolveDailyFeePolicy({
    driverId = null,
    planType,
    driverData = {},
    subscriptionData = {},
    billingConfig = null,
    now = new Date(),
    dayKey = null,
    dailyGrossRevenueCents = null
  }) {
    const config = billingConfig || this.getDefaultBillingConfig();
    const normalizedPlanType = planType === 'elite' ? 'elite' : 'plus';
    const planConfig = config?.plans?.[normalizedPlanType] || this.getDefaultBillingConfig().plans[normalizedPlanType];
    const waveId = this.resolveWaveId(driverData, subscriptionData) || (normalizedPlanType === 'plus' ? 'wave_3' : null);
    const waveConfig = this.resolveWaveConfig(planConfig, waveId);
    const grossDailyRevenueCents = this.resolveGrossDailyRevenueCents(
      driverData,
      subscriptionData,
      dayKey || this.getDayKey(now),
      dailyGrossRevenueCents
    );
    const tierPolicy = this.resolveDailyFeeFromGrossCents(
      grossDailyRevenueCents,
      planConfig?.dailyFeeTiers || config.dailyFeeTiers || this.DEFAULT_DAILY_FEE_TIERS
    );

    const overrideDailyFeeCents = this.parseCents(
      subscriptionData.dailyFeeOverrideCents ??
      subscriptionData.dailyFeeCentsOverride ??
      driverData.daily_fee_override_cents ??
      driverData.subscription_daily_fee_override_cents,
      -1
    );

    const hasManualOverride =
      this.ALLOW_MANUAL_DAILY_FEE_OVERRIDE &&
      Number.isFinite(overrideDailyFeeCents) &&
      overrideDailyFeeCents >= 0;

    const dailyFeeCents = hasManualOverride
      ? overrideDailyFeeCents
      : tierPolicy.dailyFeeCents;

    const exemption = this.isInManualExemption(driverData, subscriptionData, waveConfig, now);
    const activation = this.resolveActivationEligibility({
      driverId,
      driverData,
      subscriptionData,
      billingConfig: config,
      now
    });
    const activationEligible = activation.eligible === true;
    const effectiveDailyFeeCents = activationEligible ? dailyFeeCents : 0;

    return {
      planType: normalizedPlanType,
      waveId,
      dailyFeeCents: effectiveDailyFeeCents,
      nominalDailyFeeCents: dailyFeeCents,
      weeklyFeeCents: effectiveDailyFeeCents * 7,
      collectionMode: String(config?.collectionMode || this.COLLECTION_MODE).toLowerCase() === 'balance'
        ? 'balance'
        : this.COLLECTION_MODE,
      isExempt: exemption.active,
      exemptionReason: exemption.reason,
      exemptionEndsAt: exemption.endsAt || null,
      grossDailyRevenueCents,
      dailyFeeTierId: tierPolicy.tierId,
      dailyFeeTierMinGrossCents: tierPolicy.tierMinGrossCents,
      dailyFeeTierMaxGrossCents: tierPolicy.tierMaxGrossCents,
      activationEligible,
      activationBlockedReason: activationEligible ? null : activation.reason,
      activationDriverCity: activation.driverCity || null,
      activationAccountAgeDays: activation.accountAgeDays,
      activationNoticeAgeDays: activation.noticeAgeDays,
      source: hasManualOverride
        ? 'driver_override'
        : 'daily_gross_revenue_tier'
    };
  }

  async updateRealtimeSubscriptionAndBilling(driverId, updater) {
    const db = firebaseConfig.getRealtimeDB();
    return subscriptionStateService.runTransaction(driverId, (state) => ({
      ...state,
      ...(updater({ ...(state || {}) }) || {}),
      updatedAt: this.nowIso()
    }), { db, syncReadModel: true });
  }

  buildPolicyStateFields(policy = {}) {
    return {
      weeklyFeeCents: policy.weeklyFeeCents,
      dailyFeeCents: policy.dailyFeeCents,
      nominalDailyFeeCents: policy.nominalDailyFeeCents,
      collectionMode: policy.collectionMode,
      dailyGrossRevenueCents: policy.grossDailyRevenueCents,
      dailyFeeTierId: policy.dailyFeeTierId || null,
      dailyFeeTierMinGrossCents: policy.dailyFeeTierMinGrossCents,
      dailyFeeTierMaxGrossCents: policy.dailyFeeTierMaxGrossCents ?? null,
      dailyFeeActivationEligible: policy.activationEligible === true,
      dailyFeeActivationBlockedReason: policy.activationBlockedReason || null,
      dailyFeeActivationDriverCity: policy.activationDriverCity || null,
      dailyFeeActivationAccountAgeDays: policy.activationAccountAgeDays ?? null,
      dailyFeeActivationNoticeAgeDays: policy.activationNoticeAgeDays ?? null
    };
  }

  async processDailyCharge(driverId, driverData, options = {}) {
    try {
      const db = options.db || firebaseConfig.getRealtimeDB();
      const currentSubscription = options.currentSubscription || {};
      const now = options.now || new Date();
      const nowIso = now.toISOString();

      if (driverData.approved !== true) {
        return { success: true, skipped: true, reason: 'not_approved' };
      }

      const billingConfig = options.billingConfig || await this.loadBillingConfig(db);
      const planType = this.resolvePlanType(driverData, currentSubscription);
      const chargeDateKey = this.getDayKey(now);
      const policy = this.resolveDailyFeePolicy({
        driverId,
        planType,
        driverData,
        subscriptionData: currentSubscription,
        billingConfig,
        now,
        dayKey: chargeDateKey,
        dailyGrossRevenueCents: options.dailyGrossRevenueCents
      });

      if (!this.DAILY_BILLING_ENABLED) {
        const updateResult = await this.updateRealtimeSubscriptionAndBilling(driverId, (state) => {
          const pending = Number(state.pendingFeeCents || 0);
          const existingStatus = String(state.status || '').toLowerCase();
          const keepSuspended = ['blocked', 'cancelled', 'suspended'].includes(existingStatus);
          const status = keepSuspended ? existingStatus : 'active';
          const billingStatus = status === 'active'
            ? (pending > 0 ? 'overdue' : 'active')
            : 'suspended';

          return {
            planType: policy.planType,
            waveId: policy.waveId || null,
            ...this.buildPolicyStateFields(policy),
            status,
            billingStatus,
            dailyBillingEnabled: false,
            subscriptionDailyBillingSuspended: true,
            isInFreePeriod: false,
            isInManualExemption: false,
            lastChargeAt: nowIso,
            lastChargeStatus: 'skipped_daily_billing_suspended',
            lastChargeAmountCents: 0
          };
        });

        if (!updateResult.success) {
          return {
            success: false,
            error: updateResult.error || 'Falha ao atualizar assinatura'
          };
        }

        return {
          success: true,
          skipped: true,
          reason: 'daily_billing_suspended',
          planType: policy.planType,
          waveId: policy.waveId,
          dailyFeeCents: policy.dailyFeeCents,
          pendingFeeCents: 0,
          rawPendingFeeCents: updateResult.subscription?.pendingFeeCents || 0
        };
      }

      const isFreePeriod = this.isInFreePeriod(driverData, now);
      if (isFreePeriod || policy.isExempt || policy.dailyFeeCents <= 0) {
        const skippedReason = isFreePeriod
          ? 'free_period'
          : (policy.isExempt
            ? 'manual_exemption'
            : (policy.activationEligible === false ? policy.activationBlockedReason || 'activation_guard' : 'no_fee_configured'));

        const updateResult = await this.updateRealtimeSubscriptionAndBilling(driverId, (state) => {
          const pending = Number(state.pendingFeeCents || 0);
          const existingStatus = String(state.status || '').toLowerCase();
          const keepSuspended = ['blocked', 'cancelled', 'suspended'].includes(existingStatus);
          const status = keepSuspended ? existingStatus : 'active';
          const billingStatus = status === 'active'
            ? (pending > 0 ? 'overdue' : 'active')
            : 'suspended';

          return {
            planType: policy.planType,
            waveId: policy.waveId || null,
            ...this.buildPolicyStateFields(policy),
            status,
            billingStatus,
            isInFreePeriod: isFreePeriod,
            isInManualExemption: policy.isExempt,
            feeExemptReason: policy.exemptionReason || null,
            feeExemptUntil: policy.exemptionEndsAt || state.feeExemptUntil || null,
            lastChargeAt: nowIso,
            lastChargeStatus: `skipped_${skippedReason}`,
            lastChargeAmountCents: 0
          };
        });

        if (!updateResult.success) {
          return {
            success: false,
            error: updateResult.error || 'Falha ao atualizar assinatura'
          };
        }

        return {
          success: true,
          skipped: true,
          reason: skippedReason,
          planType: policy.planType,
          waveId: policy.waveId,
          dailyFeeCents: policy.dailyFeeCents,
          pendingFeeCents: updateResult.subscription?.pendingFeeCents || 0
        };
      }

      let alreadyChargedToday = false;

      const updateResult = await this.updateRealtimeSubscriptionAndBilling(driverId, (state) => {
        if (String(state.lastChargeDateKey || '') === chargeDateKey) {
          alreadyChargedToday = true;
          return {
            planType: policy.planType,
            waveId: policy.waveId || null,
            ...this.buildPolicyStateFields(policy),
            isInFreePeriod: false,
            isInManualExemption: false
          };
        }

        const pending = Number(state.pendingFeeCents || 0);
        const nextPending = Math.max(0, pending + policy.dailyFeeCents);
        const existingStatus = String(state.status || '').toLowerCase();
        const keepSuspended = ['blocked', 'cancelled', 'suspended'].includes(existingStatus);
        const status = keepSuspended ? existingStatus : 'active';
        const billingStatus = status === 'active'
          ? (nextPending > 0 ? 'overdue' : 'active')
          : 'suspended';

        return {
          planType: policy.planType,
          waveId: policy.waveId || null,
          ...this.buildPolicyStateFields(policy),
          status,
          billingStatus,
          pendingFeeCents: nextPending,
          isInFreePeriod: false,
          isInManualExemption: false,
          lastChargeAt: nowIso,
          lastChargeStatus: 'accrued_pending_withdrawal',
          lastChargeAmountCents: policy.dailyFeeCents,
          lastChargeDateKey: chargeDateKey,
          lastChargeSource: policy.source
        };
      });

      if (!updateResult.success) {
        return {
          success: false,
          error: updateResult.error || 'Falha ao atualizar assinatura'
        };
      }

      if (alreadyChargedToday) {
        return {
          success: true,
          skipped: true,
          reason: 'already_charged_today',
          planType: policy.planType,
          waveId: policy.waveId,
          pendingFeeCents: updateResult.subscription?.pendingFeeCents || 0
        };
      }

      return {
        success: true,
        planType: policy.planType,
        waveId: policy.waveId,
        dailyFeeCents: policy.dailyFeeCents,
        dailyFee: this.toReais(policy.dailyFeeCents),
        pendingFeeCents: updateResult.subscription?.pendingFeeCents || 0,
        subscription: updateResult.subscription
      };
    } catch (error) {
      logger.error(`Erro ao processar cobrança diária para ${driverId}`, { error: error.message });
      return { success: false, error: error.message || 'Erro interno do servidor' };
    }
  }

  async processAllDailyCharges() {
    try {
      if (!this.DAILY_BILLING_ENABLED) {
        logger.info('Cobrança diária de assinatura suspensa por configuração', {
          service: 'daily-subscription',
          reason: 'SUBSCRIPTION_DAILY_BILLING_ENABLED=false'
        });
        return {
          success: true,
          total: 0,
          processed: 0,
          skipped: 0,
          failed: 0,
          overdue: 0,
          reason: 'daily_billing_suspended',
          details: []
        };
      }

      const db = firebaseConfig.getRealtimeDB();
      if (!db) {
        return { success: false, error: 'Realtime DB não disponível' };
      }

      const [usersSnapshot, subscriptionsSnapshot, billingConfig] = await Promise.all([
        db.ref('users').once('value'),
        db.ref('subscriptions').once('value'),
        this.loadBillingConfig(db)
      ]);

      const users = usersSnapshot.val() || {};
      const subscriptions = subscriptionsSnapshot.val() || {};

      const results = {
        total: 0,
        processed: 0,
        skipped: 0,
        failed: 0,
        overdue: 0,
        details: []
      };

      for (const [driverId, driverData] of Object.entries(users)) {
        if (driverData.usertype !== 'driver') continue;

        results.total += 1;
        const chargeResult = await this.processDailyCharge(driverId, driverData, {
          db,
          billingConfig,
          currentSubscription: subscriptions[driverId] || {}
        });

        if (chargeResult.success) {
          if (chargeResult.skipped) {
            results.skipped += 1;
          } else {
            results.processed += 1;
          }
        } else {
          results.failed += 1;
        }

        if (Number(chargeResult.pendingFeeCents || 0) > 0) {
          results.overdue += 1;
        }

        results.details.push({ driverId, result: chargeResult });
      }

      logger.info('Processamento diário de assinatura concluído', {
        total: results.total,
        processed: results.processed,
        skipped: results.skipped,
        failed: results.failed,
        overdue: results.overdue
      });

      return { success: true, ...results };
    } catch (error) {
      logger.error('Erro ao processar cobranças diárias', { error: error.message });
      return { success: false, error: error.message || 'Erro interno do servidor' };
    }
  }
}

module.exports = new DailySubscriptionService();
