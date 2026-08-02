const subscriptionStateService = require('./subscription-state-service');
const { logStructured } = require('../utils/logger');

class SubscriptionOnlineGateService {
  constructor({ stateService = subscriptionStateService, now = () => Date.now() } = {}) {
    this.stateService = stateService;
    this.now = now;
  }

  async enforce(driverId) {
    if (!driverId) {
      return { allowed: false, reason: 'driverId ausente', code: 'driverIdMissing' };
    }

    if (process.env.SUBSCRIPTION_ONLINE_GATE_ENABLED === 'false') {
      return {
        allowed: true,
        reason: 'Gate de assinatura desabilitado',
        code: 'subscriptionGateDisabled'
      };
    }

    try {
      const state = await this.stateService.getGateState(driverId);
      const billingStatus = String(state.billingStatus || '').toLowerCase();
      const subscriptionStatus = String(state.subscriptionStatus || '').toLowerCase();
      const pendingFeeCents = Math.max(0, Number(state.pendingFeeCents || 0) || 0);
      const gracePeriodEndsAtRaw = state.gracePeriodEndsAt || null;
      const gracePeriodEndsAtTs = gracePeriodEndsAtRaw ? Date.parse(gracePeriodEndsAtRaw) : Number.NaN;
      const gracePeriodExpired = Number.isFinite(gracePeriodEndsAtTs)
        ? gracePeriodEndsAtTs < this.now()
        : false;
      const blockAfterGraceEnabled =
        String(process.env.SUBSCRIPTION_BLOCK_ON_GRACE_EXPIRY || 'false').toLowerCase() === 'true';
      const statusBlocked = ['blocked', 'cancelled', 'suspended'].includes(subscriptionStatus)
        || billingStatus === 'suspended';
      const blockedAfterGrace = blockAfterGraceEnabled
        && subscriptionStatus === 'grace_period'
        && gracePeriodExpired;

      if (statusBlocked || blockedAfterGrace) {
        return {
          allowed: false,
          reason: 'Assinatura bloqueada para ficar online',
          code: 'subscriptionBlocked',
          details: {
            billingStatus,
            subscriptionStatus,
            pendingFeeCents,
            gracePeriodEndsAt: gracePeriodEndsAtRaw,
            source: state.source
          }
        };
      }

      return {
        allowed: true,
        reason: 'Assinatura válida',
        code: 'subscriptionActive',
        details: {
          billingStatus: billingStatus || 'active',
          subscriptionStatus: subscriptionStatus || 'active',
          pendingFeeCents,
          source: state.source
        }
      };
    } catch (error) {
      logStructured('warn', 'Autoridade de assinatura indisponível; gate fechado', {
        service: 'subscription-online-gate-service',
        driverId,
        error: error.message
      });
      return {
        allowed: false,
        reason: 'Não foi possível validar a assinatura agora',
        code: 'subscriptionAuthorityUnavailable',
        retryable: true
      };
    }
  }
}

module.exports = new SubscriptionOnlineGateService();
module.exports.SubscriptionOnlineGateService = SubscriptionOnlineGateService;
