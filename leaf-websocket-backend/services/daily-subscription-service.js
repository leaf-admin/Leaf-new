/**
 * DAILY SUBSCRIPTION SERVICE
 *
 * Modelo vigente:
 * - Cobrança diária por plano/onda.
 * - Valor acumula como pendência diária.
 * - Liquidação da pendência ocorre no saque (PaymentService).
 */

const { logger } = require('../utils/logger');
const firebaseConfig = require('../firebase-config');
const subscriptionStateService = require('./subscription-state-service');

class DailySubscriptionService {
  constructor() {
    this.BILLING_CONFIG_PATH =
      String(process.env.SUBSCRIPTION_BILLING_CONFIG_PATH || 'subscription_billing/config').trim();
    this.COLLECTION_MODE = 'withdrawal';

    this.DEFAULT_PLUS_WAVE_1_CENTS = this.parseCents(process.env.SUBSCRIPTION_PLUS_WAVE_1_DAILY_CENTS, 990);
    this.DEFAULT_PLUS_WAVE_2_CENTS = this.parseCents(process.env.SUBSCRIPTION_PLUS_WAVE_2_DAILY_CENTS, 1290);
    this.DEFAULT_PLUS_WAVE_3_CENTS = this.parseCents(process.env.SUBSCRIPTION_PLUS_WAVE_3_DAILY_CENTS, 1490);
    this.DEFAULT_PLUS_DAILY_CENTS = this.parseCents(process.env.SUBSCRIPTION_PLUS_DAILY_CENTS, this.DEFAULT_PLUS_WAVE_3_CENTS);
    this.DEFAULT_ELITE_DAILY_CENTS = this.parseCents(process.env.SUBSCRIPTION_ELITE_DAILY_CENTS, 0);

    logger.info('DailySubscriptionService inicializado', {
      billingConfigPath: this.BILLING_CONFIG_PATH,
      collectionMode: this.COLLECTION_MODE,
      defaults: {
        plusWave1Cents: this.DEFAULT_PLUS_WAVE_1_CENTS,
        plusWave2Cents: this.DEFAULT_PLUS_WAVE_2_CENTS,
        plusWave3Cents: this.DEFAULT_PLUS_WAVE_3_CENTS,
        plusDefaultCents: this.DEFAULT_PLUS_DAILY_CENTS,
        eliteDefaultCents: this.DEFAULT_ELITE_DAILY_CENTS
      }
    });
  }

  parseCents(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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
      plans: {
        plus: {
          defaultDailyFeeCents: this.DEFAULT_PLUS_DAILY_CENTS,
          waves: {
            wave_1: { dailyFeeCents: this.DEFAULT_PLUS_WAVE_1_CENTS },
            wave_2: { dailyFeeCents: this.DEFAULT_PLUS_WAVE_2_CENTS },
            wave_3: { dailyFeeCents: this.DEFAULT_PLUS_WAVE_3_CENTS }
          }
        },
        elite: {
          defaultDailyFeeCents: this.DEFAULT_ELITE_DAILY_CENTS,
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

  resolveDailyFeePolicy({
    planType,
    driverData = {},
    subscriptionData = {},
    billingConfig = null,
    now = new Date()
  }) {
    const config = billingConfig || this.getDefaultBillingConfig();
    const normalizedPlanType = planType === 'elite' ? 'elite' : 'plus';
    const planConfig = config?.plans?.[normalizedPlanType] || this.getDefaultBillingConfig().plans[normalizedPlanType];
    const waveId = this.resolveWaveId(driverData, subscriptionData) || (normalizedPlanType === 'plus' ? 'wave_3' : null);
    const waveConfig = this.resolveWaveConfig(planConfig, waveId);

    const overrideDailyFeeCents = this.parseCents(
      subscriptionData.dailyFeeOverrideCents ??
      subscriptionData.dailyFeeCentsOverride ??
      driverData.daily_fee_override_cents ??
      driverData.subscription_daily_fee_override_cents,
      -1
    );

    const hasManualOverride = Number.isFinite(overrideDailyFeeCents) && overrideDailyFeeCents >= 0;

    const dailyFeeCents = hasManualOverride
      ? overrideDailyFeeCents
      : this.parseCents(
        waveConfig?.dailyFeeCents,
        this.parseCents(planConfig?.defaultDailyFeeCents, 0)
      );

    const exemption = this.isInManualExemption(driverData, subscriptionData, waveConfig, now);

    return {
      planType: normalizedPlanType,
      waveId,
      dailyFeeCents,
      weeklyFeeCents: dailyFeeCents * 7,
      collectionMode: String(config?.collectionMode || this.COLLECTION_MODE).toLowerCase() === 'balance'
        ? 'balance'
        : this.COLLECTION_MODE,
      isExempt: exemption.active,
      exemptionReason: exemption.reason,
      exemptionEndsAt: exemption.endsAt || null,
      source: hasManualOverride
        ? 'driver_override'
        : (waveConfig ? 'wave_config' : 'plan_default')
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
      const policy = this.resolveDailyFeePolicy({
        planType,
        driverData,
        subscriptionData: currentSubscription,
        billingConfig,
        now
      });

      const isFreePeriod = this.isInFreePeriod(driverData, now);
      if (isFreePeriod || policy.isExempt || policy.dailyFeeCents <= 0) {
        const skippedReason = isFreePeriod
          ? 'free_period'
          : (policy.isExempt ? 'manual_exemption' : 'no_fee_configured');

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
            weeklyFeeCents: policy.weeklyFeeCents,
            dailyFeeCents: policy.dailyFeeCents,
            collectionMode: policy.collectionMode,
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

      const chargeDateKey = this.getDayKey(now);
      let alreadyChargedToday = false;

      const updateResult = await this.updateRealtimeSubscriptionAndBilling(driverId, (state) => {
        if (String(state.lastChargeDateKey || '') === chargeDateKey) {
          alreadyChargedToday = true;
          return {
            planType: policy.planType,
            waveId: policy.waveId || null,
            weeklyFeeCents: policy.weeklyFeeCents,
            dailyFeeCents: policy.dailyFeeCents,
            collectionMode: policy.collectionMode,
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
          weeklyFeeCents: policy.weeklyFeeCents,
          dailyFeeCents: policy.dailyFeeCents,
          collectionMode: policy.collectionMode,
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
