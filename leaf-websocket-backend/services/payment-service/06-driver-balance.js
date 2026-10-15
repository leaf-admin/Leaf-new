// Gerado a partir de services/payment-service.js (divisão mecânica, código idêntico).
// Saldo do motorista, créditos e taxas

const {
  firebaseConfig,
  admin,
  crypto,
  subscriptionStateService,
  resolveFinancialContext,
  getFinancialCollections,
  logStructured,
  logError,
} = require('./shared');

class PaymentServiceDriverBalanceMethods {
  buildDriverBalanceCreditId(driverId, rideId, amountInCents) {
    const source = `${driverId || 'unknown-driver'}:${rideId || 'unknown-ride'}:${amountInCents || 0}`;
    const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 32);
    return `ride_credit_${hash}`;
  }

  buildWithdrawalIdempotencyKey(driverId, requestId) {
    return crypto
      .createHash('sha256')
      .update(`${driverId || 'unknown-driver'}:${requestId || 'unknown-request'}`)
      .digest('hex');
  }

  buildWithdrawalPixKeyHash(pixKey) {
    return crypto
      .createHash('sha256')
      .update(String(pixKey || '').trim().toLowerCase())
      .digest('hex');
  }

  isLegacyDirectDriverCreditEnabled() {
    return String(process.env.ENABLE_LEGACY_DIRECT_DRIVER_CREDIT || 'false').toLowerCase() === 'true';
  }

  normalizeStoredCents(value) {
    if (value === undefined || value === null || value === '') {
      return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return Math.max(0, Math.round(parsed));
  }

  getCanonicalBalanceCents(balanceData = {}) {
    const balanceCents = this.normalizeStoredCents(balanceData.balanceCents);
    if (balanceCents !== null) {
      return balanceCents;
    }
    return this.toCents(balanceData.balance || 0);
  }

  getCanonicalTotalEarningsCents(balanceData = {}) {
    const totalEarningsCents = this.normalizeStoredCents(balanceData.totalEarningsCents);
    if (totalEarningsCents !== null) {
      return totalEarningsCents;
    }
    return this.toCents(balanceData.totalEarnings || 0);
  }

  async recordDriverWithdrawalDenial({ driverId, amountCents = 0, pixKey = '', requestId = '', reason = 'unknown', code = null, actorId = null, metadata = {} } = {}) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore || !driverId) {
      return { success: false, error: !driverId ? 'driverId obrigatório' : 'Firestore não disponível' };
    }

    const normalizedReason = String(reason || 'unknown').trim() || 'unknown';
    const safeAmountCents = Math.max(0, Math.round(Number(amountCents || 0)));
    const denialRef = firestore.collection('driver_withdrawal_denials').doc();
    const summaryRef = firestore.collection('driver_withdrawal_denial_summaries').doc(driverId);

    try {
      const payload = {
        driverId,
        amountCents: safeAmountCents,
        pixKeyHash: pixKey ? this.buildWithdrawalPixKeyHash(pixKey) : null,
        requestId: requestId || null,
        reason: normalizedReason,
        code: code || null,
        actorId: actorId || null,
        metadata,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtIso: new Date().toISOString()
      };

      await denialRef.set(payload);
      await summaryRef.set({
        driverId,
        lastReason: normalizedReason,
        lastCode: code || null,
        lastDeniedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastDeniedAtIso: payload.createdAtIso,
        deniedCount: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      logStructured('warn', 'Tentativa de saque negada registrada', {
        service: 'payment-service',
        driverId,
        reason: normalizedReason,
        code: code || null,
        amountCents: safeAmountCents
      });

      return { success: true, denialId: denialRef.id };
    } catch (error) {
      logStructured('warn', 'Falha ao registrar tentativa de saque negada', {
        service: 'payment-service',
        driverId,
        reason: normalizedReason,
        error: error.message
      });
      return { success: false, error: error.message };
    }
  }

  /**
   * Credita saldo diretamente no Firestore vinculado ao ID do motorista
   * Substitui BaaS temporariamente até API MASTER estar disponível
   * @param {string} driverId - ID do motorista
   * @param {number} amount - Valor em centavos a creditar
   * @param {string} rideId - ID da corrida (para histórico)
   * @returns {Promise<Object>} - Resultado do crédito
   */
  async creditDriverBalance(driverId, amount, rideId, financialContext = null) {
    try {
      const firestore = firebaseConfig.getFirestore();

      if (!firestore) {
        return {
          success: false,
          error: 'Firestore não disponível'
        };
      }

      if (!driverId || !amount || amount <= 0) {
        return {
          success: false,
          error: 'Dados inválidos para crédito'
        };
      }

      if (!rideId) {
        return {
          success: false,
          error: 'rideId obrigatório para crédito idempotente'
        };
      }

      const amountInCents = Math.round(Number(amount));
      if (!Number.isFinite(amountInCents) || amountInCents <= 0) {
        return {
          success: false,
          error: 'Valor inválido para crédito'
        };
      }

      const contextResult = resolveFinancialContext(
        { financialContext },
        { allowLegacyOperational: true }
      );
      if (!contextResult.ok) {
        return { success: false, code: contextResult.code, error: contextResult.error };
      }
      const { collections } = getFinancialCollections(contextResult.context);
      const balanceRef = firestore.collection(collections.driverBalances).doc(driverId);
      const amountInReais = amountInCents / 100; // Converter centavos para reais
      const creditTransactionId = this.buildDriverBalanceCreditId(driverId, rideId, amountInCents);
      const creditTransactionRef = balanceRef.collection('transactions').doc(creditTransactionId);

      // Usar transação para garantir consistência
      const result = await firestore.runTransaction(async (transaction) => {
        const creditTransactionDoc = await transaction.get(creditTransactionRef);

        if (creditTransactionDoc.exists) {
          const creditData = creditTransactionDoc.data() || {};
          return {
            success: true,
            duplicate: true,
            previousBalance: creditData.previousBalance ?? null,
            previousBalanceCents: creditData.previousBalanceCents ?? null,
            newBalance: creditData.newBalance ?? null,
            newBalanceCents: creditData.newBalanceCents ?? null,
            creditAmount: amountInReais,
            creditAmountCents: amountInCents,
            balanceId: driverId,
            transactionId: creditTransactionId
          };
        }

        const balanceDoc = await transaction.get(balanceRef);

        let currentBalanceCents = 0;
        let totalEarningsCents = 0;

        if (balanceDoc.exists) {
          const data = balanceDoc.data();
          currentBalanceCents = this.getCanonicalBalanceCents(data);
          totalEarningsCents = this.getCanonicalTotalEarningsCents(data);
        }

        const currentBalance = this.toReais(currentBalanceCents);
        const totalEarnings = this.toReais(totalEarningsCents);
        const newBalanceCents = currentBalanceCents + amountInCents;
        const newTotalEarningsCents = totalEarningsCents + amountInCents;
        const newBalance = this.toReais(newBalanceCents);
        const newTotalEarnings = this.toReais(newTotalEarningsCents);

        // Atualizar saldo
        transaction.set(balanceRef, {
          driverId: driverId,
          balance: newBalance,
          balanceCents: newBalanceCents,
          totalEarnings: newTotalEarnings,
          totalEarningsCents: newTotalEarningsCents,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          lastRideId: rideId,
          lastCreditAmount: amountInReais,
          lastCreditAmountCents: amountInCents,
          financialContext: contextResult.context,
          financialNamespace: contextResult.context.namespace,
          financialContextId: contextResult.context.contextId
        }, { merge: true });

        transaction.set(creditTransactionRef, {
          type: 'credit',
          amount: amountInReais,
          amountInCents,
          rideId,
          previousBalance: currentBalance,
          previousBalanceCents: currentBalanceCents,
          newBalance,
          newBalanceCents,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          description: `Ganhos da corrida ${rideId}`,
          idempotencyKey: creditTransactionId,
          financialContext: contextResult.context,
          financialNamespace: contextResult.context.namespace,
          financialContextId: contextResult.context.contextId
        });

        return {
          success: true,
          previousBalance: currentBalance,
          previousBalanceCents: currentBalanceCents,
          newBalance,
          newBalanceCents,
          creditAmount: amountInReais,
          creditAmountCents: amountInCents,
          balanceId: driverId,
          transactionId: creditTransactionId
        };
      });

      if (result.success) {
        logStructured('info', result.duplicate ? 'Crédito de saldo idempotente já aplicado' : 'Saldo creditado para motorista', {
          service: 'payment-service',
          driverId,
          rideId,
          amount: amountInReais.toFixed(2),
          previousBalance:
            typeof result.previousBalance === 'number'
              ? result.previousBalance.toFixed(2)
              : null,
          newBalance:
            typeof result.newBalance === 'number'
              ? result.newBalance.toFixed(2)
              : null,
          duplicate: Boolean(result.duplicate),
          transactionId: result.transactionId
        });
      }

      return result;

    } catch (error) {
      logError(error, 'Erro ao creditar saldo do motorista', { service: 'payment-service', driverId, rideId });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Salva dados de distribuição no Firestore
   * @param {Object} distributionData - Dados da distribuição
   */
  async saveDistributionToFirestore(distributionData, financialContext = null) {
    try {
      const firestore = firebaseConfig.getFirestore();

      if (!firestore) {
        logStructured('warn', 'Firestore não disponível para salvar distribuição', { service: 'payment-service' });
        return false;
      }

      const contextResult = resolveFinancialContext(
        { financialContext: financialContext || distributionData.financialContext },
        { allowLegacyOperational: true }
      );
      if (!contextResult.ok) return false;
      const { collections } = getFinancialCollections(contextResult.context);
      const distributionRef = firestore
        .collection(collections.paymentDistributions)
        .doc(distributionData.rideId);

      await distributionRef.set({
        ...distributionData,
        financialContext: contextResult.context,
        financialNamespace: contextResult.context.namespace,
        financialContextId: contextResult.context.contextId,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      logStructured('info', 'Distribuição salva no Firestore', { service: 'payment-service', rideId: distributionData.rideId });
      return true;

    } catch (error) {
      logError(error, 'Erro ao salvar distribuição no Firestore', { service: 'payment-service' });
      return false;
    }
  }

  /**
   * Obtém saldo atual do motorista
   * @param {string} driverId - ID do motorista
   * @returns {Promise<Object>} - Saldo do motorista
   */
  async getDriverBalance(driverId) {
    try {
      const firestore = firebaseConfig.getFirestore();

      if (!firestore) {
        return {
          success: false,
          error: 'Firestore não disponível'
        };
      }

      const balanceRef = firestore.collection('driver_balances').doc(driverId);
      const balanceDoc = await balanceRef.get();
      const subscriptionBilling = await this.getDriverSubscriptionBillingData(driverId);
      const subscriptionDailyFeeSuspended = !this.SUBSCRIPTION_DAILY_BILLING_ENABLED;
      const rawPendingFeeCents = Math.max(0, Number(subscriptionBilling.pendingFeeCents || 0));
      const effectivePendingFeeCents = subscriptionDailyFeeSuspended
        ? 0
        : Math.max(0, rawPendingFeeCents);
      const rawDailyFeeCents = Math.max(0, Number(subscriptionBilling.dailyFeeCents || 0));
      const nominalDailyFeeCents = this.SUBSCRIPTION_DAILY_FEE_NOMINAL_CENTS;
      const effectiveDailyFeeCents = subscriptionDailyFeeSuspended
        ? 0
        : Math.max(0, rawDailyFeeCents || nominalDailyFeeCents);

      if (!balanceDoc.exists) {
        const availableAfterSubscriptionCents = Math.max(0, 0 - effectivePendingFeeCents);
        return {
          success: true,
          balance: 0,
          balanceCents: 0,
          totalEarnings: 0,
          totalEarningsCents: 0,
          subscriptionPendingFeeCents: effectivePendingFeeCents,
          subscriptionPendingFee: this.toReais(effectivePendingFeeCents),
          subscriptionPendingFeeRawCents: Math.max(0, rawPendingFeeCents),
          subscriptionPendingFeeRaw: this.toReais(rawPendingFeeCents),
          subscriptionStatus: subscriptionBilling.subscriptionStatus || 'active',
          billingStatus: subscriptionBilling.billingStatus || 'active',
          subscriptionCollectionMode: subscriptionBilling.collectionMode || 'withdrawal',
          subscriptionDailyFeeCents: effectiveDailyFeeCents,
          subscriptionDailyFee: this.toReais(effectiveDailyFeeCents),
          subscriptionDailyFeeNominalCents: nominalDailyFeeCents,
          subscriptionDailyFeeNominal: this.toReais(nominalDailyFeeCents),
          subscriptionDailyFeeEffectiveCents: effectiveDailyFeeCents,
          subscriptionDailyFeeEffective: this.toReais(effectiveDailyFeeCents),
          subscriptionDailyFeeSuspended,
          subscriptionDailyBillingEnabled: this.SUBSCRIPTION_DAILY_BILLING_ENABLED,
          subscriptionWaveId: subscriptionBilling.waveId || null,
          availableAfterSubscriptionCents,
          availableAfterSubscription: this.toReais(availableAfterSubscriptionCents),
          message: 'Motorista ainda não possui saldo'
        };
      }

      const data = balanceDoc.data();
      const balanceCents = this.getCanonicalBalanceCents(data);
      const totalEarningsCents = this.getCanonicalTotalEarningsCents(data);
      const pendingFeeCents = effectivePendingFeeCents;
      const availableAfterSubscriptionCents = Math.max(0, balanceCents - pendingFeeCents);

      return {
        success: true,
        balance: this.toReais(balanceCents),
        balanceCents,
        totalEarnings: this.toReais(totalEarningsCents),
        totalEarningsCents,
        lastUpdated: data.lastUpdated?.toDate?.() || null,
        lastRideId: data.lastRideId || null,
        subscriptionPendingFeeCents: pendingFeeCents,
        subscriptionPendingFee: this.toReais(pendingFeeCents),
        subscriptionPendingFeeRawCents: Math.max(0, rawPendingFeeCents),
        subscriptionPendingFeeRaw: this.toReais(rawPendingFeeCents),
        subscriptionStatus: subscriptionBilling.subscriptionStatus || 'active',
        billingStatus: subscriptionBilling.billingStatus || 'active',
        subscriptionCollectionMode: subscriptionBilling.collectionMode || 'withdrawal',
        subscriptionDailyFeeCents: effectiveDailyFeeCents,
        subscriptionDailyFee: this.toReais(effectiveDailyFeeCents),
        subscriptionDailyFeeNominalCents: nominalDailyFeeCents,
        subscriptionDailyFeeNominal: this.toReais(nominalDailyFeeCents),
        subscriptionDailyFeeEffectiveCents: effectiveDailyFeeCents,
        subscriptionDailyFeeEffective: this.toReais(effectiveDailyFeeCents),
        subscriptionDailyFeeSuspended,
        subscriptionDailyBillingEnabled: this.SUBSCRIPTION_DAILY_BILLING_ENABLED,
        subscriptionWaveId: subscriptionBilling.waveId || null,
        availableAfterSubscriptionCents,
        availableAfterSubscription: this.toReais(availableAfterSubscriptionCents)
      };

    } catch (error) {
      logError(error, 'Erro ao obter saldo do motorista', { service: 'payment-service', driverId });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Calcula taxa de saque para motorista.
   * Regra aprovada: R$ 1,00 fixo por saque, qualquer valor.
   * @param {number} amountCents
   */
  calculateWithdrawFee(amountCents) {
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return 0;
    }
    return this.WITHDRAW_FEE_FLAT_CENTS;
  }

  toReais(cents) {
    return Number((Number(cents || 0) / 100).toFixed(2));
  }

  toCents(valueInReais) {
    return Math.round(Number(valueInReais || 0) * 100);
  }

  async getDriverSubscriptionBillingData(driverId) {
    return subscriptionStateService.getBillingData(driverId);
  }

  async settleSubscriptionPendingOnWithdrawal(driverId, settlementCents) {
    return subscriptionStateService.settlePendingOnWithdrawal(driverId, settlementCents);
  }

  async ensureWithdrawalRequestLedger({
    firestore,
    withdrawalId,
    driverId,
    amountCents,
    withdrawFeeCents = 0,
    subscriptionSettlementCents = 0,
    requestId
  }) {
    const normalizedAmountCents = Math.round(Number(amountCents || 0));
    const normalizedWithdrawFeeCents = Math.max(0, Math.round(Number(withdrawFeeCents || 0)));
    const normalizedSubscriptionSettlementCents = Math.max(
      0,
      Math.round(Number(subscriptionSettlementCents || 0))
    );
    if (
      !firestore ||
      !withdrawalId ||
      !driverId ||
      !requestId ||
      normalizedAmountCents <= 0
    ) {
      return {
        success: false,
        code: 'WITHDRAWAL_LEDGER_REPAIR_DATA_INVALID',
        error: 'Dados insuficientes para registrar o ledger do saque',
        status: 'ledger_pending',
        ledgerStatus: 'pending_retry'
      };
    }

    const withdrawalRef = firestore.collection('driver_withdrawals').doc(withdrawalId);
    const idempotencyKey = this.buildWithdrawalIdempotencyKey(driverId, requestId);
    const idempotencyRef = firestore.collection('driver_withdrawal_idempotency').doc(idempotencyKey);
    const ledgerResult = await this.financialLedgerService.recordWithdrawalRequested({
      withdrawalId,
      driverId,
      amountCents: normalizedAmountCents,
      withdrawFeeCents: normalizedWithdrawFeeCents,
      subscriptionSettlementCents: normalizedSubscriptionSettlementCents,
      requestId,
      metadata: {
        totalDebitCents:
          normalizedAmountCents +
          normalizedWithdrawFeeCents +
          normalizedSubscriptionSettlementCents,
        source: 'requestDriverWithdrawal'
      }
    });
    const ledgerPosted = Boolean(ledgerResult.success);
    const ledgerError = ledgerPosted
      ? null
      : ledgerResult.error || ledgerResult.code || 'Falha ao registrar ledger de saque';
    const statePatch = ledgerPosted
      ? {
          status: 'pending',
          ledgerStatus: 'posted',
          ledgerEventId: ledgerResult.eventId || null,
          ledgerError: null,
          ledgerRetryable: false,
          ledgerPostedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }
      : {
          status: 'ledger_pending',
          ledgerStatus: 'pending_retry',
          ledgerError,
          ledgerRetryable: true,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        };

    try {
      await withdrawalRef.set(statePatch, { merge: true });
      await idempotencyRef.set({
        status: statePatch.status,
        ledgerStatus: statePatch.ledgerStatus,
        ledgerEventId: statePatch.ledgerEventId || null,
        ledgerError,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (stateError) {
      logStructured('error', 'Falha ao persistir estado do ledger do saque', {
        service: 'payment-service',
        withdrawalId,
        driverId,
        ledgerPosted,
        error: stateError.message
      });
      return {
        success: false,
        code: 'WITHDRAWAL_LEDGER_STATE_PERSIST_FAILED',
        error: stateError.message,
        eventId: ledgerResult.eventId || null,
        status: 'ledger_pending',
        ledgerStatus: 'pending_retry'
      };
    }

    if (!ledgerPosted) {
      logStructured('error', 'Saque solicitado sem ledger financeiro canônico; Pix Out bloqueado até conciliação', {
        service: 'payment-service',
        driverId,
        withdrawalId,
        ledgerError
      });
    }

    this.financialLedgerService.reconcileWithdrawalFinancials({ withdrawalId })
      .catch((reconciliationError) => {
        logStructured('warn', 'Falha ao reconciliar saque após atualização do ledger', {
          service: 'payment-service',
          withdrawalId,
          error: reconciliationError.message
        });
      });

    return {
      success: ledgerPosted,
      code: ledgerResult.code || null,
      error: ledgerError,
      eventId: ledgerResult.eventId || null,
      status: statePatch.status,
      ledgerStatus: statePatch.ledgerStatus
    };
  }
}

module.exports = PaymentServiceDriverBalanceMethods;
