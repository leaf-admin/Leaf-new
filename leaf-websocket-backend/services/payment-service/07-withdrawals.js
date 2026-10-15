// Gerado a partir de services/payment-service.js (divisão mecânica, código idêntico).
// Saques do motorista

const {
  sortDriverWithdrawals,
  toDriverWithdrawalView,
  firebaseConfig,
  admin,
  logStructured,
  logError,
} = require('./shared');

class PaymentServiceWithdrawalsMethods {
  /**
   * Solicita saque do saldo do motorista.
   * Debita imediatamente do saldo e registra pedido para processamento.
   * @param {Object} data
   * @param {string} data.driverId
   * @param {number} data.amountCents - valor que motorista deseja receber
   * @param {string} data.pixKey
   */
  async requestDriverWithdrawal(data) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      return { success: false, error: 'Firestore não disponível' };
    }

    const driverId = data?.driverId;
    const amountCents = Number.parseInt(data?.amountCents, 10);
    const pixKey = String(data?.pixKey || '').trim();
    const requestId = String(data?.requestId || '').trim();

    if (!driverId || !Number.isFinite(amountCents) || amountCents <= 0 || !pixKey || !requestId) {
      return { success: false, error: 'Dados inválidos para saque' };
    }

    const subscriptionBilling = await this.getDriverSubscriptionBillingData(driverId);
    const shouldSettleSubscriptionNow =
      this.SUBSCRIPTION_DAILY_BILLING_ENABLED &&
      this.SUBSCRIPTION_SETTLE_ON_WITHDRAW &&
      String(subscriptionBilling.collectionMode || 'withdrawal') === 'withdrawal';

    const withdrawFeeCents = this.calculateWithdrawFee(amountCents);
    const subscriptionSettlementCents = shouldSettleSubscriptionNow
      ? Math.max(0, Number(subscriptionBilling.pendingFeeCents || 0))
      : 0;
    const totalDebitCents = amountCents + withdrawFeeCents + subscriptionSettlementCents;
    const amountInReais = this.toReais(amountCents);
    const feeInReais = this.toReais(withdrawFeeCents);
    const subscriptionSettlementInReais = this.toReais(subscriptionSettlementCents);
    const totalDebitInReais = this.toReais(totalDebitCents);

    const balanceRef = firestore.collection('driver_balances').doc(driverId);
    const withdrawalRef = firestore.collection('driver_withdrawals').doc();
    const pixKeyHash = this.buildWithdrawalPixKeyHash(pixKey);
    const idempotencyKey = this.buildWithdrawalIdempotencyKey(driverId, requestId);
    const idempotencyRef = firestore.collection('driver_withdrawal_idempotency').doc(idempotencyKey);

    try {
      const transactionResult = await firestore.runTransaction(async (transaction) => {
        const idempotencyDoc = await transaction.get(idempotencyRef);
        if (idempotencyDoc.exists) {
          const existing = idempotencyDoc.data() || {};
          const existingAmountCents = Number(existing.amountCents || 0);
          const existingPixKeyHash = String(existing.pixKeyHash || '');
          if (
            existingAmountCents !== amountCents ||
            (existingPixKeyHash && existingPixKeyHash !== pixKeyHash)
          ) {
            return {
              idempotentReplay: true,
              parameterConflict: true,
              withdrawalId: existing.withdrawalId || null,
              status: existing.status || 'pending',
              existingAmountCents,
              incomingAmountCents: amountCents
            };
          }

          return {
            idempotentReplay: true,
            withdrawalId: existing.withdrawalId || null,
            previousBalance: existing.previousBalance || null,
            newBalance: existing.newBalance || null,
            withdrawFeeCents: Number(existing.withdrawFeeCents || 0),
            subscriptionSettlementCents: Number(existing.subscriptionSettlementCents || 0),
            totalDebitCents: Number(existing.totalDebitCents || 0),
            status: existing.status || 'pending',
            ledgerStatus: existing.ledgerStatus || null,
            ledgerEventId: existing.ledgerEventId || null
          };
        }

        const balanceDoc = await transaction.get(balanceRef);
        const balanceData = balanceDoc.exists ? balanceDoc.data() : {};
        const currentBalanceCents = this.getCanonicalBalanceCents(balanceData);
        const currentBalance = this.toReais(currentBalanceCents);

        if (currentBalanceCents < totalDebitCents) {
          const maxWithdrawableCents = Math.max(0, currentBalanceCents - withdrawFeeCents - subscriptionSettlementCents);
          const error = new Error('Saldo insuficiente para saque + taxa + assinatura pendente');
          error.code = 'WITHDRAWAL_INSUFFICIENT_BALANCE';
          error.details = {
            currentBalanceCents,
            amountCents,
            withdrawFeeCents,
            subscriptionSettlementCents,
            totalDebitCents,
            shortfallCents: totalDebitCents - currentBalanceCents,
            maxWithdrawableCents,
            maxWithdrawableInReais: this.toReais(maxWithdrawableCents).toFixed(2)
          };
          throw error;
        }

        const newBalanceCents = currentBalanceCents - totalDebitCents;
        const newBalance = this.toReais(newBalanceCents);

        transaction.set(balanceRef, {
          driverId,
          balance: newBalance,
          balanceCents: newBalanceCents,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          lastWithdrawalAt: admin.firestore.FieldValue.serverTimestamp(),
          lastWithdrawalAmount: amountInReais,
          lastWithdrawalAmountCents: amountCents,
          lastWithdrawalFee: feeInReais,
          lastWithdrawalFeeCents: withdrawFeeCents,
          lastWithdrawalSubscriptionSettlement: subscriptionSettlementInReais,
          lastWithdrawalSubscriptionSettlementCents: subscriptionSettlementCents
        }, { merge: true });

        const baseTransactionData = {
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          withdrawalId: withdrawalRef.id,
          requestId,
          idempotencyKey,
          pixKey,
          pixKeyHash
        };

        const txCollection = balanceRef.collection('transactions');
        const withdrawalTxRef = txCollection.doc();
        transaction.set(withdrawalTxRef, {
          ...baseTransactionData,
          type: 'withdrawal',
          amount: -amountInReais,
          amountInCents: -amountCents,
          previousBalance: currentBalance,
          previousBalanceCents: currentBalanceCents,
          newBalance: newBalance,
          newBalanceCents,
          description: `Saque solicitado (${pixKey})`
        });

        if (withdrawFeeCents > 0) {
          const feeTxRef = txCollection.doc();
          transaction.set(feeTxRef, {
            ...baseTransactionData,
            type: 'withdrawal_fee',
            amount: -feeInReais,
            amountInCents: -withdrawFeeCents,
            previousBalance: this.toReais(currentBalanceCents - amountCents),
            previousBalanceCents: currentBalanceCents - amountCents,
            newBalance: newBalance,
            newBalanceCents,
            description: 'Taxa de saque'
          });
        }

        if (subscriptionSettlementCents > 0) {
          const settlementTxRef = txCollection.doc();
          transaction.set(settlementTxRef, {
            ...baseTransactionData,
            type: 'subscription_settlement',
            amount: -subscriptionSettlementInReais,
            amountInCents: -subscriptionSettlementCents,
            previousBalance: this.toReais(currentBalanceCents - amountCents - withdrawFeeCents),
            previousBalanceCents: currentBalanceCents - amountCents - withdrawFeeCents,
            newBalance,
            newBalanceCents,
            description: 'Liquidação de assinatura diária pendente no saque'
          });
        }

        transaction.set(withdrawalRef, {
          driverId,
          requestId,
          idempotencyKey,
          pixKey,
          amountCents,
          amountInReais,
          feeCents: withdrawFeeCents,
          feeInReais,
          subscriptionSettlementCents,
          subscriptionSettlementInReais,
          totalDebitCents,
          totalDebitInReais,
          status: 'pending',
          ledgerStatus: 'pending',
          source: 'mobile_app',
          subscriptionCollectionMode: subscriptionBilling.collectionMode || 'withdrawal',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        transaction.set(idempotencyRef, {
          driverId,
          requestId,
          amountCents,
          pixKey,
          pixKeyHash,
          withdrawalId: withdrawalRef.id,
          withdrawFeeCents,
          subscriptionSettlementCents,
          totalDebitCents,
          previousBalance: currentBalance,
          previousBalanceCents: currentBalanceCents,
          newBalance,
          newBalanceCents,
          status: 'pending',
          ledgerStatus: 'pending',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return {
          idempotentReplay: false,
          withdrawalId: withdrawalRef.id,
          previousBalance: currentBalance,
          previousBalanceCents: currentBalanceCents,
          newBalance,
          newBalanceCents,
          withdrawFeeCents,
          subscriptionSettlementCents,
          totalDebitCents
        };
      });

      if (transactionResult.idempotentReplay) {
        if (transactionResult.parameterConflict) {
          return {
            success: false,
            error: 'Esta solicitação de saque já foi usada com outros dados. Revise e tente novamente.',
            code: 'WITHDRAWAL_IDEMPOTENCY_CONFLICT',
            withdrawalId: transactionResult.withdrawalId || null,
            status: transactionResult.status || null,
            details: {
              existingAmountCents: transactionResult.existingAmountCents,
              incomingAmountCents: transactionResult.incomingAmountCents
            }
          };
        }

        const replayLedgerResult = await this.ensureWithdrawalRequestLedger({
          firestore,
          withdrawalId: transactionResult.withdrawalId,
          driverId,
          amountCents,
          withdrawFeeCents: transactionResult.withdrawFeeCents || 0,
          subscriptionSettlementCents: transactionResult.subscriptionSettlementCents || 0,
          requestId
        });

        if (!replayLedgerResult.success) {
          return {
            success: false,
            idempotentReplay: true,
            withdrawalId: transactionResult.withdrawalId,
            requestId,
            code: replayLedgerResult.code || 'WITHDRAWAL_LEDGER_NOT_POSTED',
            error: replayLedgerResult.error || 'Ledger de solicitação de saque ainda não confirmado',
            status: replayLedgerResult.status || 'ledger_pending',
            ledgerStatus: replayLedgerResult.ledgerStatus || 'pending_retry'
          };
        }

        return {
          success: true,
          idempotentReplay: true,
          withdrawalId: transactionResult.withdrawalId,
          requestId,
          amountCents,
          withdrawFeeCents: transactionResult.withdrawFeeCents || 0,
          subscriptionSettlementCents: transactionResult.subscriptionSettlementCents || 0,
          totalDebitCents: transactionResult.totalDebitCents || amountCents,
          amountInReais: amountInReais.toFixed(2),
          withdrawFeeInReais: this.toReais(transactionResult.withdrawFeeCents || 0).toFixed(2),
          subscriptionSettlementInReais: this.toReais(transactionResult.subscriptionSettlementCents || 0).toFixed(2),
          totalDebitInReais: this.toReais(transactionResult.totalDebitCents || amountCents).toFixed(2),
          previousBalance: transactionResult.previousBalance,
          newBalance: transactionResult.newBalance,
          subscriptionCollectionMode: subscriptionBilling.collectionMode || 'withdrawal',
          status: replayLedgerResult.status,
          ledgerStatus: replayLedgerResult.ledgerStatus,
          ledgerEventId: replayLedgerResult.eventId || null,
          settlementSyncStatus: 'unchanged'
        };
      }

      const withdrawalId = transactionResult.withdrawalId || withdrawalRef.id;
      const withdrawalLedgerResult = await this.ensureWithdrawalRequestLedger({
        firestore,
        withdrawalId,
        driverId,
        amountCents,
        withdrawFeeCents,
        subscriptionSettlementCents: transactionResult.subscriptionSettlementCents || 0,
        requestId
      });

      const withdrawalDocRef = firestore.collection('driver_withdrawals').doc(withdrawalId);
      const ledgerPosted = Boolean(withdrawalLedgerResult.success);

      let settlementSync = {
        success: true,
        settledCents: 0,
        remainingCents: 0
      };

      if (transactionResult.subscriptionSettlementCents > 0) {
        try {
          settlementSync = await this.settleSubscriptionPendingOnWithdrawal(
            driverId,
            transactionResult.subscriptionSettlementCents
          );
        } catch (syncError) {
          settlementSync = {
            success: false,
            error: syncError.message || 'Erro ao sincronizar assinatura'
          };
        }

        try {
          if (!settlementSync.success) {
              await withdrawalDocRef.set({
                settlementSyncStatus: 'pending_retry',
                settlementSyncError: settlementSync.error || 'Erro ao sincronizar assinatura',
                settlementSyncUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
            } else {
              await withdrawalDocRef.set({
                settlementSyncStatus: 'synced',
                subscriptionPendingRemainingCents: settlementSync.remainingCents,
                settlementSyncUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
              }, { merge: true });
          }
        } catch (syncPersistError) {
          logStructured('warn', 'Falha ao persistir status de sincronização da assinatura no saque', {
            service: 'payment-service',
            driverId,
            withdrawalId: withdrawalRef.id,
            error: syncPersistError.message
          });
        }
      }

      await idempotencyRef.set({
        status: ledgerPosted ? 'pending' : 'ledger_pending',
        ledgerStatus: ledgerPosted ? 'posted' : 'pending_retry',
        ledgerEventId: withdrawalLedgerResult.eventId || null,
        settlementSyncStatus: settlementSync.success ? 'synced' : 'pending_retry',
        subscriptionPendingRemainingCents: settlementSync.remainingCents || 0,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch((syncPersistError) => {
        logStructured('warn', 'Falha ao persistir status da idempotencia do saque', {
          service: 'payment-service',
          driverId,
          withdrawalId: transactionResult.withdrawalId || withdrawalRef.id,
          error: syncPersistError.message
        });
      });

      logStructured('info', 'Saque solicitado com sucesso', {
        service: 'payment-service',
        driverId,
        withdrawalId: transactionResult.withdrawalId || withdrawalRef.id,
        requestId,
        amountCents,
        withdrawFeeCents,
        subscriptionSettlementCents: transactionResult.subscriptionSettlementCents || 0,
        totalDebitCents
      });

      return {
        success: true,
        withdrawalId: transactionResult.withdrawalId || withdrawalRef.id,
        requestId,
        amountCents,
        withdrawFeeCents,
        subscriptionSettlementCents: transactionResult.subscriptionSettlementCents || 0,
        totalDebitCents,
        amountInReais: amountInReais.toFixed(2),
        withdrawFeeInReais: feeInReais.toFixed(2),
        subscriptionSettlementInReais: this.toReais(transactionResult.subscriptionSettlementCents || 0).toFixed(2),
        totalDebitInReais: totalDebitInReais.toFixed(2),
        previousBalance: transactionResult.previousBalance,
        newBalance: transactionResult.newBalance,
        subscriptionCollectionMode: subscriptionBilling.collectionMode || 'withdrawal',
        status: ledgerPosted ? 'pending' : 'ledger_pending',
        ledgerStatus: ledgerPosted ? 'posted' : 'pending_retry',
        ledgerEventId: withdrawalLedgerResult.eventId || null,
        settlementSyncStatus: settlementSync.success ? 'synced' : 'pending_retry'
      };
    } catch (error) {
      logError(error, 'Erro ao solicitar saque', { service: 'payment-service', driverId });
      if (error?.code === 'WITHDRAWAL_INSUFFICIENT_BALANCE') {
        return {
          success: false,
          error: error.message || 'Saldo insuficiente para saque',
          code: error.code,
          details: error.details || null
        };
      }
      return {
        success: false,
        error: error.message || 'Erro ao solicitar saque',
        code: error?.code || null
      };
    }
  }

  /**
   * Saques do próprio motorista (mais recentes primeiro), no formato que o app mostra.
   * Só leitura: não altera saldo nem o saque.
   */
  async listDriverWithdrawals(driverId, limit = 20) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      return { success: false, error: 'Firestore não disponível' };
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 20, 50));
    // Sem orderBy para não depender de índice composto; ordena em memória.
    const snapshot = await firestore
      .collection('driver_withdrawals')
      .where('driverId', '==', String(driverId))
      .limit(200)
      .get();

    const withdrawals = sortDriverWithdrawals(
      snapshot.docs.map((doc) => toDriverWithdrawalView(doc.id, doc.data() || {}))
    ).slice(0, safeLimit);

    return { success: true, withdrawals };
  }

  /**
   * Lista saques pendentes para processamento operacional.
   * @param {number} limit
   */
  async listPendingWithdrawals(limit = 50) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      return { success: false, error: 'Firestore não disponível' };
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    const snapshots = await Promise.all(
      ['pending', 'ledger_pending'].map((status) => firestore
        .collection('driver_withdrawals')
        .where('status', '==', status)
        .limit(safeLimit)
        .get())
    );

    const withdrawals = [];
    snapshots.forEach((snapshot) => {
      snapshot.docs.forEach((doc) => {
        const data = doc.data() || {};
        withdrawals.push({
          id: doc.id,
          ...data
        });
      });
    });
    withdrawals.sort((a, b) => {
      const aMs = Number(a?.createdAt?.toMillis?.() || 0);
      const bMs = Number(b?.createdAt?.toMillis?.() || 0);
      return aMs - bMs;
    });

    return {
      success: true,
      withdrawals: withdrawals.slice(0, safeLimit)
    };
  }

  /**
   * Processa um saque pendente.
   * Fluxo:
   * 1) tenta Pix Out via Woovi
   * 2) se sucesso, marca processed
   * 3) se falhar, mantém pending para retry operacional
   */
  async processDriverWithdrawal(withdrawalId, actorId = 'system') {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      return { success: false, error: 'Firestore não disponível' };
    }

    if (!withdrawalId) {
      return { success: false, error: 'withdrawalId é obrigatório' };
    }

    const withdrawalRef = firestore.collection('driver_withdrawals').doc(withdrawalId);
    const initialWithdrawalDoc = await withdrawalRef.get();
    if (!initialWithdrawalDoc.exists) {
      return { success: false, error: 'Saque não encontrado' };
    }

    const initialWithdrawal = initialWithdrawalDoc.data() || {};
    if (initialWithdrawal.status === 'ledger_pending') {
      const ledgerRepair = await this.ensureWithdrawalRequestLedger({
        firestore,
        withdrawalId,
        driverId: initialWithdrawal.driverId,
        amountCents: Number(initialWithdrawal.amountCents || 0),
        withdrawFeeCents: Number(initialWithdrawal.feeCents || 0),
        subscriptionSettlementCents: Number(initialWithdrawal.subscriptionSettlementCents || 0),
        requestId: initialWithdrawal.requestId
      });
      if (!ledgerRepair.success) {
        return {
          success: false,
          error: ledgerRepair.error || 'Ledger de solicitação de saque ainda não confirmado',
          code: ledgerRepair.code || 'WITHDRAWAL_LEDGER_NOT_POSTED',
          status: ledgerRepair.status || 'ledger_pending',
          ledgerStatus: ledgerRepair.ledgerStatus || 'pending_retry'
        };
      }
    }

    const claimResult = await firestore.runTransaction(async (transaction) => {
      const withdrawalDoc = await transaction.get(withdrawalRef);
      if (!withdrawalDoc.exists) {
        return { success: false, error: 'Saque não encontrado' };
      }

      const withdrawal = withdrawalDoc.data() || {};
      if (['processed', 'processed_ledger_pending'].includes(withdrawal.status)) {
        return {
          success: true,
          alreadyProcessed: true,
          status: withdrawal.status
        };
      }

      if (withdrawal.status === 'processing') {
        return {
          success: false,
          error: 'Saque já está em processamento',
          code: 'WITHDRAWAL_ALREADY_PROCESSING',
          status: withdrawal.status
        };
      }

      if (withdrawal.status !== 'pending') {
        return {
          success: false,
          error: 'Estado do saque não permite processamento',
          code: 'WITHDRAWAL_INVALID_PROCESSING_STATE',
          status: withdrawal.status
        };
      }

      if (withdrawal.ledgerStatus !== 'posted') {
        return {
          success: false,
          error: 'Ledger de solicitação de saque ainda não confirmado',
          code: 'WITHDRAWAL_LEDGER_NOT_POSTED',
          status: withdrawal.status,
          ledgerStatus: withdrawal.ledgerStatus || 'missing'
        };
      }

      transaction.set(withdrawalRef, {
        status: 'processing',
        processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
        processingBy: actorId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return {
        success: true,
        claimed: true,
        withdrawal
      };
    });

    if (!claimResult.success || !claimResult.claimed) {
      return claimResult;
    }

    const withdrawal = claimResult.withdrawal;

    if (!this.LEAF_PIX_KEY || this.LEAF_PIX_KEY === 'test@leaf.app.br') {
      await withdrawalRef.set({
        status: 'pending',
        lastError: 'LEAF_PIX_KEY não configurada para processamento automático',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return {
        success: false,
        error: 'LEAF_PIX_KEY não configurada para processamento automático'
      };
    }

    const amountCents = Number(withdrawal.amountCents || 0);
    const driverPixKey = String(withdrawal.pixKey || '').trim();
    if (!amountCents || !driverPixKey) {
      await withdrawalRef.set({
        status: 'pending',
        lastError: 'Dados do saque inválidos',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return { success: false, error: 'Dados do saque inválidos' };
    }

    const transferResult = await this.wooviDriverService.transferDirectToDriver(
      withdrawal.wooviAccountId || withdrawal.wooviClientId || withdrawal.driverId,
      amountCents,
      `Saque motorista ${withdrawal.driverId} - ${withdrawalId}`,
      withdrawal.rideId || `withdraw_${withdrawalId}`,
      driverPixKey,
      this.LEAF_PIX_KEY,
      {
        correlationID: `leaf_withdrawal_${withdrawalId}`
      }
    );

    if (!transferResult.success) {
      await withdrawalRef.set({
        status: 'pending',
        lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
        attempts: admin.firestore.FieldValue.increment(1),
        lastError: transferResult.error || transferResult.details || 'Falha na transferência Woovi',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      logStructured('warn', 'Falha ao processar saque na Woovi (mantido pendente)', {
        service: 'payment-service',
        withdrawalId,
        driverId: withdrawal.driverId,
        error: transferResult.error || transferResult.details
      });

      return {
        success: false,
        error: transferResult.error || 'Falha ao transferir saque'
      };
    }

    const processedLedgerResult = await this.financialLedgerService.recordWithdrawalProcessed({
      withdrawalId,
      driverId: withdrawal.driverId,
      amountCents,
      transferId: transferResult.transferId || transferResult.transactionId || null,
      metadata: {
        actorId,
        source: 'processDriverWithdrawal'
      }
    });

    if (!processedLedgerResult.success) {
      await withdrawalRef.set({
        status: 'processed_ledger_pending',
        processedAt: admin.firestore.FieldValue.serverTimestamp(),
        processedBy: actorId,
        transferId: transferResult.transferId || transferResult.transactionId || null,
        ledgerProcessedStatus: 'pending_retry',
        ledgerProcessedError: processedLedgerResult.error || processedLedgerResult.code || 'Falha ao registrar ledger de Pix Out',
        ledgerRetryable: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      logStructured('error', 'Saque processado na Woovi com ledger financeiro pendente', {
        service: 'payment-service',
        withdrawalId,
        driverId: withdrawal.driverId,
        ledgerError: processedLedgerResult.error || processedLedgerResult.code
      });

      this.financialLedgerService.reconcileWithdrawalFinancials({ withdrawalId })
        .catch((reconciliationError) => {
          logStructured('warn', 'Falha ao reconciliar saque com ledger pendente', {
            service: 'payment-service',
            withdrawalId,
            error: reconciliationError.message
          });
        });

      return {
        success: true,
        withdrawalId,
        transferId: transferResult.transferId || transferResult.transactionId || null,
        status: 'processed_ledger_pending',
        ledgerProcessedStatus: 'pending_retry',
        ledgerError: processedLedgerResult.error || processedLedgerResult.code || null
      };
    }

    await withdrawalRef.set({
      status: 'processed',
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      processedBy: actorId,
      transferId: transferResult.transferId || transferResult.transactionId || null,
      ledgerProcessedStatus: 'posted',
      ledgerProcessedEventId: processedLedgerResult.eventId || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    this.financialLedgerService.reconcileWithdrawalFinancials({ withdrawalId })
      .catch((reconciliationError) => {
        logStructured('warn', 'Falha ao reconciliar saque após processamento', {
          service: 'payment-service',
          withdrawalId,
          error: reconciliationError.message
        });
      });

    logStructured('info', 'Saque processado com sucesso', {
      service: 'payment-service',
      withdrawalId,
      driverId: withdrawal.driverId,
      amountCents
    });

    return {
      success: true,
      withdrawalId,
      transferId: transferResult.transferId || transferResult.transactionId || null,
      ledgerProcessedStatus: 'posted',
      ledgerProcessedEventId: processedLedgerResult.eventId || null
    };
  }
}

module.exports = PaymentServiceWithdrawalsMethods;
