/**
 * DAILY SUBSCRIPTION SERVICE
 *
 * Cobrança pró-rata diária com ciclo semanal:
 * - Leaf Plus: R$ 49,90/semana
 * - Leaf Elite: R$ 99,90/semana
 *
 * Regras:
 * - Debita diariamente (pró-rata) para evitar cobrança pesada no fim da semana.
 * - Se não conseguir debitar, entra em GRACE PERIOD de 3 dias.
 * - Após o grace period sem regularização, motorista fica bloqueado para ficar online.
 * - Durante grace period, parte da dívida pode ser abatida via retenção de corridas (PaymentService).
 */

const { logger } = require('../utils/logger');
const firebaseConfig = require('../firebase-config');
const admin = require('firebase-admin');

class DailySubscriptionService {
  constructor() {
    this.WEEKLY_FEE_PLUS_CENTS = 4990;
    this.WEEKLY_FEE_ELITE_CENTS = 9990;

    this.DAILY_FEE_PLUS_CENTS = Math.round(this.WEEKLY_FEE_PLUS_CENTS / 7);
    this.DAILY_FEE_ELITE_CENTS = Math.round(this.WEEKLY_FEE_ELITE_CENTS / 7);

    this.GRACE_PERIOD_DAYS = 3;

    logger.info('DailySubscriptionService inicializado', {
      weeklyPlusCents: this.WEEKLY_FEE_PLUS_CENTS,
      weeklyEliteCents: this.WEEKLY_FEE_ELITE_CENTS,
      dailyPlusCents: this.DAILY_FEE_PLUS_CENTS,
      dailyEliteCents: this.DAILY_FEE_ELITE_CENTS,
      graceDays: this.GRACE_PERIOD_DAYS
    });
  }

  toReais(cents) {
    return Number((cents / 100).toFixed(2));
  }

  nowIso() {
    return new Date().toISOString();
  }

  getWeekStartSunday(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 = domingo
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

  resolvePlanType(driverData = {}) {
    const explicit = String(driverData.planType || driverData.subscription?.planType || '').toLowerCase();
    if (explicit === 'elite') return 'elite';
    if (explicit === 'plus') return 'plus';

    const carType = String(driverData.carType || '').toLowerCase();
    if (carType.includes('elite')) return 'elite';
    if (carType.includes('plus')) return 'plus';

    return 'plus';
  }

  getDailyFeeCents(planType) {
    return planType === 'elite' ? this.DAILY_FEE_ELITE_CENTS : this.DAILY_FEE_PLUS_CENTS;
  }

  getWeeklyFeeCents(planType) {
    return planType === 'elite' ? this.WEEKLY_FEE_ELITE_CENTS : this.WEEKLY_FEE_PLUS_CENTS;
  }

  isInFreePeriod(driverData = {}) {
    const now = new Date();

    const freeTrialEnd = driverData.free_trial_end ? new Date(driverData.free_trial_end) : null;
    if (driverData.is_first_500 === true && freeTrialEnd && now < freeTrialEnd) {
      return true;
    }

    const freeMonthsRemaining = driverData.free_months || 0;
    const freeMonthsEnd = driverData.free_months_end ? new Date(driverData.free_months_end) : null;
    if (freeMonthsRemaining > 0 && freeMonthsEnd && now < freeMonthsEnd) {
      return true;
    }

    const promotionFreeEnd = driverData.promotion_free_end ? new Date(driverData.promotion_free_end) : null;
    if (promotionFreeEnd && now < promotionFreeEnd) {
      return true;
    }

    return false;
  }

  async debitDriverBalanceCents(driverId, amountCents) {
    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        return { success: false, error: 'Firestore não disponível' };
      }

      const balanceRef = firestore.collection('driver_balances').doc(driverId);

      const txResult = await firestore.runTransaction(async (transaction) => {
        const balanceDoc = await transaction.get(balanceRef);
        const currentBalanceCents = Math.round(Number((balanceDoc.data()?.balance || 0) * 100));

        if (currentBalanceCents < amountCents) {
          return {
            success: false,
            error: 'Saldo insuficiente',
            currentBalanceCents,
            requiredAmountCents: amountCents,
            shortfallCents: amountCents - currentBalanceCents
          };
        }

        const newBalanceCents = currentBalanceCents - amountCents;
        const newBalance = this.toReais(newBalanceCents);
        const previousBalance = this.toReais(currentBalanceCents);

        transaction.set(balanceRef, {
          driverId,
          balance: newBalance,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          lastDebitAmount: this.toReais(amountCents),
          lastDebitType: 'daily_subscription_prorata'
        }, { merge: true });

        return {
          success: true,
          previousBalance,
          newBalance,
          previousBalanceCents: currentBalanceCents,
          newBalanceCents
        };
      });

      if (txResult.success) {
        const historyRef = firestore
          .collection('driver_balances')
          .doc(driverId)
          .collection('transactions')
          .doc();

        await historyRef.set({
          type: 'debit',
          amount: -this.toReais(amountCents),
          amountInCents: -amountCents,
          description: 'Cobrança diária pró-rata de assinatura',
          subscriptionType: 'daily_prorata',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          previousBalance: txResult.previousBalance,
          newBalance: txResult.newBalance
        });
      }

      return txResult;
    } catch (error) {
      logger.error(`Erro ao debitar saldo do motorista ${driverId}`, { error: error.message });
      return { success: false, error: error.message || 'Erro interno do servidor' };
    }
  }

  async updateRealtimeSubscriptionAndBilling(driverId, updater) {
    const db = firebaseConfig.getRealtimeDB();
    if (!db) {
      return { success: false, error: 'Realtime DB não disponível' };
    }

    const subscriptionRef = db.ref(`subscriptions/${driverId}`);
    const userRef = db.ref(`users/${driverId}`);

    const result = await subscriptionRef.transaction((current) => {
      const state = current || {};
      const next = updater(state) || state;
      return {
        ...state,
        ...next,
        updatedAt: this.nowIso()
      };
    });

    if (!result.committed) {
      return { success: false, error: 'Falha ao atualizar assinatura' };
    }

    const subscription = result.snapshot.val() || {};
    const status = subscription.status || 'active';
    const billingStatus = status === 'blocked' ? 'suspended' : (status === 'grace_period' ? 'overdue' : 'active');

    await userRef.update({
      billing_status: billingStatus,
      subscriptionStatus: status,
      subscription_pending_fee_cents: Number(subscription.pendingFeeCents || 0),
      subscription_grace_period_ends_at: subscription.gracePeriodEndsAt || null,
      ...(billingStatus === 'suspended' ? { driverActiveStatus: false } : {})
    });

    return { success: true, subscription, billingStatus };
  }

  async processDailyCharge(driverId, driverData) {
    try {
      const db = firebaseConfig.getRealtimeDB();
      const currentSubscriptionSnapshot = db
        ? await db.ref(`subscriptions/${driverId}`).once('value')
        : { val: () => ({}) };
      const currentSubscription = currentSubscriptionSnapshot.val() || {};

      if (driverData.approved !== true) {
        return { success: true, skipped: true, reason: 'not_approved' };
      }

      const planType = this.resolvePlanType(driverData);
      const weeklyFeeCents = this.getWeeklyFeeCents(planType);
      const dailyFeeCents = this.getDailyFeeCents(planType);

      if (this.isInFreePeriod(driverData)) {
        await this.updateRealtimeSubscriptionAndBilling(driverId, (state) => ({
          planType,
          weeklyFeeCents,
          dailyFeeCents,
          weekKey: this.getWeekKey(),
          status: 'active',
          gracePeriodStartsAt: null,
          gracePeriodEndsAt: null,
          isInFreePeriod: true
        }));

        return { success: true, skipped: true, reason: 'free_period', planType };
      }

      const now = new Date();
      const nowIso = this.nowIso();
      const weekKey = this.getWeekKey(now);
      const weekStartIso = this.getWeekStartSunday(now).toISOString();

      const debitResult = await this.debitDriverBalanceCents(driverId, dailyFeeCents);

      if (debitResult.success) {
        let recoveredPendingCents = 0;
        const currentPending = Number(currentSubscription.pendingFeeCents || 0);

        // Se houver dívida pendente de assinatura, tenta regularizar imediatamente com saldo disponível.
        if (currentPending > 0) {
          const recoveryAttempt = await this.debitDriverBalanceCents(driverId, currentPending);
          if (recoveryAttempt.success) {
            recoveredPendingCents = currentPending;
          } else if (String(recoveryAttempt.error || '').toLowerCase().includes('saldo insuficiente')) {
            const available = Number(recoveryAttempt.currentBalanceCents || 0);
            if (available > 0) {
              const partialRecovery = await this.debitDriverBalanceCents(driverId, available);
              if (partialRecovery.success) {
                recoveredPendingCents = available;
              }
            }
          }
        }

        const updateResult = await this.updateRealtimeSubscriptionAndBilling(driverId, (state) => {
          const currentWeekKey = state.weekKey;
          const resetCycle = currentWeekKey !== weekKey;

          const cycleDebitedCents = Number(resetCycle ? 0 : (state.cycleDebitedCents || 0)) + dailyFeeCents;
          const pendingFeeCents = Number(state.pendingFeeCents || 0);
          const nextPending = Math.max(0, pendingFeeCents - recoveredPendingCents);

          return {
            planType,
            weeklyFeeCents,
            dailyFeeCents,
            weekKey,
            weekStartAt: weekStartIso,
            cycleDebitedCents,
            status: nextPending > 0 ? (state.status === 'blocked' ? 'blocked' : 'grace_period') : 'active',
            gracePeriodStartsAt: nextPending > 0 ? (state.gracePeriodStartsAt || nowIso) : null,
            gracePeriodEndsAt: nextPending > 0 ? (state.gracePeriodEndsAt || new Date(now.getTime() + (this.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000)).toISOString()) : null,
            pendingFeeCents: nextPending,
            isInFreePeriod: false,
            lastChargeAt: nowIso,
            lastChargeStatus: 'paid',
            lastChargeAmountCents: dailyFeeCents
          };
        });

        return {
          success: true,
            planType,
            dailyFeeCents,
            dailyFee: this.toReais(dailyFeeCents),
            recoveredPendingCents,
            previousBalance: debitResult.previousBalance,
            newBalance: debitResult.newBalance,
            subscription: updateResult.subscription
        };
      }

      if (String(debitResult.error || '').toLowerCase().includes('saldo insuficiente')) {
        const updateResult = await this.updateRealtimeSubscriptionAndBilling(driverId, (state) => {
          const graceStart = state.gracePeriodStartsAt ? new Date(state.gracePeriodStartsAt) : now;
          const graceEnd = state.gracePeriodEndsAt
            ? new Date(state.gracePeriodEndsAt)
            : new Date(graceStart.getTime() + (this.GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000));

          const newPending = Number(state.pendingFeeCents || 0) + dailyFeeCents;
          const isBlocked = now > graceEnd;

          return {
            planType,
            weeklyFeeCents,
            dailyFeeCents,
            weekKey,
            weekStartAt: weekStartIso,
            status: isBlocked ? 'blocked' : 'grace_period',
            gracePeriodStartsAt: state.gracePeriodStartsAt || nowIso,
            gracePeriodEndsAt: graceEnd.toISOString(),
            pendingFeeCents: newPending,
            isInFreePeriod: false,
            lastChargeAt: nowIso,
            lastChargeStatus: 'failed_insufficient_balance',
            lastChargeAmountCents: dailyFeeCents
          };
        });

        return {
          success: false,
          error: 'Saldo insuficiente',
          planType,
          dailyFeeCents,
          dailyFee: this.toReais(dailyFeeCents),
          status: updateResult.subscription?.status,
          pendingFeeCents: updateResult.subscription?.pendingFeeCents || 0,
          gracePeriodEndsAt: updateResult.subscription?.gracePeriodEndsAt || null
        };
      }

      return {
        success: false,
        error: debitResult.error || 'Erro ao debitar assinatura diária'
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

      const usersSnapshot = await db.ref('users').once('value');
      const users = usersSnapshot.val() || {};

      const results = {
        total: 0,
        processed: 0,
        skipped: 0,
        failed: 0,
        blocked: 0,
        gracePeriod: 0,
        details: []
      };

      for (const [driverId, driverData] of Object.entries(users)) {
        if (driverData.usertype !== 'driver') continue;

        results.total += 1;
        const chargeResult = await this.processDailyCharge(driverId, driverData);

        if (chargeResult.success) {
          if (chargeResult.skipped) {
            results.skipped += 1;
          } else {
            results.processed += 1;
          }
        } else {
          results.failed += 1;
        }

        if (chargeResult.status === 'blocked') results.blocked += 1;
        if (chargeResult.status === 'grace_period') results.gracePeriod += 1;

        results.details.push({ driverId, result: chargeResult });
      }

      logger.info('Processamento diário de assinatura concluído', {
        total: results.total,
        processed: results.processed,
        skipped: results.skipped,
        failed: results.failed,
        blocked: results.blocked,
        gracePeriod: results.gracePeriod
      });

      return { success: true, ...results };
    } catch (error) {
      logger.error('Erro ao processar cobranças diárias', { error: error.message });
      return { success: false, error: error.message || 'Erro interno do servidor' };
    }
  }
}

module.exports = new DailySubscriptionService();
