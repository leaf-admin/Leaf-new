// Gerado a partir de services/payment-service.js (divisão mecânica, código idêntico).
// Reembolsos, associação e liberação de pagamento ao motorista

const {
  firebaseConfig,
  admin,
  crypto,
  circuitBreakerService,
  resolveFinancialContext,
  getFinancialCollections,
  contextsMatch,
  logStructured,
  logError,
  resolveRidePersistenceScope,
  resolveBookingCompatibilityCollection,
  isRefundedPaymentStatus,
} = require('./shared');

class PaymentServiceRefundsAndReleaseMethods {
  buildRefundRequestId({ rideId, chargeId, amount, reason, status }) {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify({
        rideId: String(rideId || ''),
        chargeId: String(chargeId || ''),
        amount: this.normalizePaymentAmountCents(amount),
        reason: String(reason || ''),
        status: String(status || 'REFUNDED')
      }))
      .digest('hex')
      .slice(0, 32);
  }

  async claimRideRefund({ rideId, chargeId, amount, reason, status, financialContext = null }) {
    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        return { success: false, code: 'FIRESTORE_UNAVAILABLE', error: 'Firestore não disponível' };
      }

      const contextResult = resolveFinancialContext(
        { financialContext },
        { allowLegacyOperational: true }
      );
      if (!contextResult.ok) return { success: false, ...contextResult };
      const { collections } = getFinancialCollections(contextResult.context);
      const refundRequestId = this.buildRefundRequestId({ rideId, chargeId, amount, reason, status });
      const paymentRef = firestore.collection(collections.ridePayments).doc(rideId);

      return await firestore.runTransaction(async (transaction) => {
        const paymentDoc = await transaction.get(paymentRef);
        const current = paymentDoc.exists ? paymentDoc.data() || {} : {};

        if (current.refunded || isRefundedPaymentStatus(current.status)) {
          return {
            success: true,
            alreadyRefunded: true,
            refundRequestId,
            refundId: current.refundId || null,
            refundAmount: current.refundAmount || 0
          };
        }

        if (current.refundInProgress && current.refundRequestId !== refundRequestId) {
          return {
            success: false,
            code: 'REFUND_ALREADY_IN_PROGRESS',
            error: 'Já existe um reembolso em processamento para esta corrida',
            refundRequestId: current.refundRequestId || null
          };
        }

        transaction.set(paymentRef, {
          refundInProgress: true,
          refundRequestId,
          refundStatus: 'PROCESSING',
          refundRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
          refundChargeId: chargeId,
          refundAmount: this.normalizePaymentAmountCents(amount),
          refundReason: reason || null
        }, { merge: true });

        return { success: true, refundRequestId };
      });
    } catch (error) {
      logError(error, 'Erro ao reservar reembolso da corrida', { service: 'PaymentService', rideId, chargeId });
      return { success: false, code: 'REFUND_CLAIM_FAILED', error: error.message };
    }
  }

  async clearRideRefundClaim({ rideId, refundRequestId, status = 'FAILED', error = null, financialContext = null } = {}) {
    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore || !rideId) return;

      const contextResult = resolveFinancialContext(
        { financialContext },
        { allowLegacyOperational: true }
      );
      if (!contextResult.ok) return;
      const { collections } = getFinancialCollections(contextResult.context);
      await firestore.collection(collections.ridePayments).doc(rideId).set({
        refundInProgress: false,
        refundStatus: status,
        refundRequestId,
        refundFailure: error || null,
        refundFailedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    } catch (claimError) {
      logError(claimError, 'Erro ao limpar reserva de reembolso', {
        service: 'PaymentService',
        rideId,
        refundRequestId
      });
    }
  }

  /**
   * Associa o driverId ao pagamento já confirmado
   * @param {string} rideId
   * @param {string} driverId
   */
  async associateDriverToPayment(rideId, driverId, financialScopeInput = null) {
    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        logStructured('warn', 'Firestore indisponível ao associar driver ao pagamento', { service: 'PaymentService' });
        return { success: false, error: 'Firestore não disponível' };
      }

      if (!rideId || !driverId) {
        return { success: false, error: 'rideId e driverId são obrigatórios' };
      }

      let requestedScope = null;
      if (financialScopeInput && typeof financialScopeInput === 'object') {
        try {
          requestedScope = resolveRidePersistenceScope(financialScopeInput);
        } catch (contextError) {
          return {
            success: false,
            code: contextError.code || 'FINANCIAL_CONTEXT_INVALID',
            error: contextError.message || 'Contexto financeiro inválido'
          };
        }
      }

      const paymentRecord = await this.getStoredPayment(
        rideId,
        requestedScope?.financialContext || null
      );
      if (!paymentRecord) return { success: false, error: 'Pagamento não encontrado' };
      const contextResult = resolveFinancialContext(paymentRecord, { allowLegacyOperational: true });
      if (!contextResult.ok) return { success: false, ...contextResult };
      if (
        requestedScope?.financialContext &&
        !contextsMatch(requestedScope.financialContext, contextResult.context)
      ) {
        return {
          success: false,
          code: 'FINANCIAL_CONTEXT_CONFLICT',
          error: 'Contexto financeiro diverge do pagamento armazenado'
        };
      }
      const { collections } = getFinancialCollections(contextResult.context);
      const bookingCompatibility = resolveBookingCompatibilityCollection(paymentRecord);
      await firestore.collection(collections.ridePayments).doc(rideId).set({
        rideId,
        assignedDriverId: driverId,
        driverAssociatedAt: admin.firestore.FieldValue.serverTimestamp(),
        financialContext: contextResult.context,
        financialNamespace: contextResult.context.namespace,
        financialContextId: contextResult.context.contextId
      }, { merge: true });
      logStructured('info', 'driverId associado ao pagamento confirmado', { service: 'PaymentService', rideId, driverId });

      await firestore.collection(bookingCompatibility.collectionName).doc(rideId).set({
        driverId,
        financialContext: contextResult.context,
        financialNamespace: contextResult.context.namespace,
        financialContextId: contextResult.context.contextId
      }, { merge: true });

      logStructured('info', 'Driver associado ao pagamento', { service: 'PaymentService', rideId, driverId });

      return { success: true };
    } catch (error) {
      logError(error, 'Erro ao associar motorista ao pagamento', { service: 'PaymentService' });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Libera pagamento armazenado para o motorista após a conclusão da corrida
   * @param {string} rideId
   * @param {string} driverId
   */
  async releasePaymentToDriver(rideId, driverId) {
    if (!this.isLegacyDirectDriverCreditEnabled()) {
      return {
        success: false,
        error: 'Liberacao direta legada desativada',
        code: 'LEGACY_DIRECT_DRIVER_CREDIT_DISABLED',
        settlementPolicy: 'post_ride_ledger',
        details: 'Use ride.completed + worker de billing para liquidar holding e creditar o motorista.'
      };
    }

    try {
      if (!rideId || !driverId) {
        return {
          success: false,
          error: 'rideId e driverId são obrigatórios'
        };
      }

      const paymentRecord = await this.getStoredPayment(rideId);
      if (!paymentRecord) {
        return {
          success: false,
          error: 'Pagamento não encontrado',
          details: 'Nenhum pagamento confirmado para esta corrida'
        };
      }
      const paymentContextResult = resolveFinancialContext(paymentRecord, { allowLegacyOperational: true });
      if (!paymentContextResult.ok) return { success: false, ...paymentContextResult };
      if (paymentContextResult.context.namespace === 'sandbox') {
        return {
          success: false,
          code: 'SANDBOX_LEGACY_DIRECT_CREDIT_DISABLED',
          error: 'Crédito direto legado não é permitido no sandbox'
        };
      }

      if (paymentRecord.credited) {
        return {
          success: true,
          alreadyCredited: true,
          message: 'Pagamento já creditado anteriormente',
          paymentRecord
        };
      }

      if (!paymentRecord.chargeId) {
        return {
          success: false,
          error: 'chargeId não encontrado',
          details: 'Não é possível liberar pagamento sem chargeId'
        };
      }

      const creditResult = await this.confirmPaymentAndCreditDriver(
        paymentRecord.chargeId,
        rideId,
        driverId
      );

      if (!creditResult.success) {
        return creditResult;
      }

      // ✅ NOVO: Usar transação para garantir integridade
      const firestore = firebaseConfig.getFirestore();
      if (firestore) {
        try {
          await firestore.runTransaction(async (transaction) => {
            // 1. Atualizar payment holding
            const holdingRef = firestore.collection('payment_holdings').doc(rideId);
            const holdingDoc = await transaction.get(holdingRef);

            if (!holdingDoc.exists) {
              throw new Error('Payment holding não encontrado');
            }

            const holdingData = holdingDoc.data();

            // Validar que está em holding
            if (holdingData.status !== 'in_holding') {
              throw new Error(`Payment não está em holding. Status atual: ${holdingData.status}`);
            }

            // Atualizar holding
            transaction.update(holdingRef, {
              status: 'distributed',
              driverId: driverId,
              distributedAt: admin.firestore.FieldValue.serverTimestamp(),
              distribution: {
                netAmount: creditResult.netAmount,
                netAmountInReais: creditResult.netAmountInReais,
                transferId: creditResult.transferId || null,
                balanceCreditId: creditResult.balanceCreditId || driverId,
                retainedFees: creditResult.retainedFees || null
              },
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // 2. Criar evento no histórico
            const eventRef = firestore.collection('payment_history').doc();
            transaction.set(eventRef, {
              rideId: rideId,
              eventType: 'payment_distributed',
              status: 'distributed',
              amount: holdingData.amount,
              amountInReais: holdingData.amount ? (holdingData.amount / 100) : null,
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              actor: 'system',
              actorId: driverId,
              metadata: {
                previousStatus: 'in_holding',
                newStatus: 'distributed',
                netAmount: creditResult.netAmount,
                netAmountInReais: creditResult.netAmountInReais,
                transferId: creditResult.transferId || null,
                balanceCreditId: creditResult.balanceCreditId || driverId,
                chargeId: holdingData.chargeId || holdingData.paymentId,
                paymentId: holdingData.paymentId
              }
            });

            // 3. Atualizar ride_payments (compatibilidade)
            const ridePaymentRef = firestore.collection('ride_payments').doc(rideId);
            transaction.set(ridePaymentRef, {
              credited: true,
              creditedAt: admin.firestore.FieldValue.serverTimestamp(),
              creditedDriverId: driverId,
              status: 'CREDITED',
              netAmount: creditResult.netAmount,
              netAmountInReais: creditResult.netAmountInReais
            }, { merge: true });

            // 4. Atualizar bookings (compatibilidade)
            const bookingRef = firestore.collection('bookings').doc(rideId);
            transaction.set(bookingRef, {
              paymentStatus: 'credited',
              paymentCreditedAt: admin.firestore.FieldValue.serverTimestamp(),
              driverId: driverId
            }, { merge: true });
          });

          logStructured('info', 'Payment distribuído com transação atômica', {
            service: 'PaymentService',
            rideId,
            driverId,
            netAmount: creditResult.netAmount,
            netAmountInReais: creditResult.netAmountInReais
          });
        } catch (transactionError) {
          logError(transactionError, 'Erro na transação de distribuição', { service: 'PaymentService' });
          // Fallback: tentar atualização simples (sem transação)
          const now = admin.firestore.FieldValue.serverTimestamp();
          await firestore.collection('payment_holdings').doc(rideId).update({
            status: 'distributed',
            driverId: driverId,
            distributedAt: now,
            updatedAt: now
          });
          await this.savePaymentEvent(rideId, 'payment_distributed', {
            status: 'distributed',
            driverId: driverId,
            previousStatus: 'in_holding',
            newStatus: 'distributed'
          });
        }
      }

      logStructured('info', 'Pagamento liberado para o motorista', {
        service: 'PaymentService',
        rideId,
        driverId
      });

      return {
        success: true,
        ...creditResult,
        paymentRecord,
        chargeId: paymentRecord.chargeId
      };
    } catch (error) {
      logError(error, 'Erro ao liberar pagamento para o motorista', { service: 'PaymentService' });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Marca pagamento como reembolsado (total ou parcial)
   * @param {string} rideId
   * @param {Object} refundData
   */
  async markPaymentRefunded(rideId, refundData = {}) {
    try {
      const firestore = firebaseConfig.getFirestore();

      if (!firestore) {
        return {
          success: false,
          error: 'Firestore não disponível'
        };
      }

      if (!rideId) {
        return {
          success: false,
          error: 'rideId é obrigatório'
        };
      }

      const status = refundData.status || 'REFUNDED';
      const refundAmount = refundData.refundAmount || 0;
      const cancellationFee = refundData.cancellationFee || 0;
      const contextResult = resolveFinancialContext(
        { financialContext: refundData.financialContext },
        { allowLegacyOperational: true }
      );
      if (!contextResult.ok) return { success: false, ...contextResult };
      const financialContext = contextResult.context;
      const { collections } = getFinancialCollections(financialContext);
      const paymentRef = firestore.collection(collections.ridePayments).doc(rideId);
      const existingPaymentDoc = await paymentRef.get();
      const existingPayment = existingPaymentDoc.exists ? existingPaymentDoc.data() : {};
      const chargeId = refundData.chargeId || existingPayment.chargeId || existingPayment.paymentId || null;
      const hasProviderRefund = refundAmount > 0 || isRefundedPaymentStatus(status);
      const closedAt = admin.firestore.FieldValue.serverTimestamp();

      const updates = {
        status,
        refunded: hasProviderRefund,
        refundInProgress: false,
        refundStatus: status,
        refundAmount,
        refundAmountInReais: (refundAmount / 100).toFixed(2),
        cancellationFee,
        cancellationFeeInReais: (cancellationFee / 100).toFixed(2),
        refundRequestId: refundData.refundRequestId || existingPayment.refundRequestId || null,
        refundId: refundData.refundId || null,
        refundReason: refundData.reason || null,
        refundMetadata: refundData.metadata || null,
        refundClosedAt: closedAt,
        financialContext,
        financialNamespace: financialContext.namespace,
        financialContextId: financialContext.contextId
      };
      if (hasProviderRefund) {
        updates.refundedAt = closedAt;
      } else {
        updates.noRefundRequiredAt = closedAt;
      }

      if (financialContext.namespace === 'sandbox') {
        await this.retryOperation(
          () => this.updateSandboxCanonicalRecordAndAlias({
            firestore,
            collectionName: collections.ridePayments,
            canonicalRideId: rideId,
            updatePayload: updates,
            financialContext
          }),
          'markPaymentRefundedSandboxAlias'
        );
      } else {
        await paymentRef.set(updates, { merge: true });
      }

      // ✅ NOVO: Atualizar payment_holdings também
      const holdingUpdate = {
        status: hasProviderRefund ? 'refunded' : 'cancelled',
        refunded: hasProviderRefund,
        refundInProgress: false,
        refundStatus: status,
        refundAmount: refundAmount,
        refundAmountInReais: (refundAmount / 100).toFixed(2),
        cancellationFee: cancellationFee,
        cancellationFeeInReais: (cancellationFee / 100).toFixed(2),
        refundRequestId: refundData.refundRequestId || existingPayment.refundRequestId || null,
        refundId: refundData.refundId || null,
        refundReason: refundData.reason || null,
        refundClosedAt: closedAt
      };
      if (hasProviderRefund) {
        holdingUpdate.refundedAt = closedAt;
      } else {
        holdingUpdate.noRefundRequiredAt = closedAt;
      }
      await this.updatePaymentHolding(rideId, holdingUpdate);

      let ledgerRecorded = false;
      let ledgerError = null;

      if (refundAmount > 0 && chargeId) {
        const ledgerResult = await this.financialLedgerService.recordRefund({
          rideId,
          chargeId,
          refundId: refundData.refundId || null,
          amountCents: refundAmount,
          passengerId: refundData.passengerId || existingPayment.passengerId || null,
          financialContext,
          reason: refundData.reason || null,
          metadata: refundData.metadata || {}
        });

        ledgerRecorded = Boolean(ledgerResult.success);
        if (!ledgerRecorded) {
          ledgerError = ledgerResult.error || ledgerResult.code || 'LEDGER_RECORD_FAILED';
          logStructured('warn', 'Reembolso registrado sem ledger financeiro canônico', {
            service: 'PaymentService',
            rideId,
            chargeId,
            ledgerError
          });
        }

        await paymentRef.set({
          refundLedgerStatus: ledgerRecorded ? 'recorded' : 'pending',
          refundLedgerError: ledgerError
        }, { merge: true });
      }

      logStructured('info', 'Pagamento marcado como reembolsado', {
        service: 'PaymentService',
        rideId,
        updates
      });

      return {
        success: true,
        ledgerRecorded,
        ledgerError
      };
    } catch (error) {
      logError(error, 'Erro ao marcar pagamento como reembolsado', { service: 'PaymentService' });
      return {
        success: false,
        error: error.message
      };
    }
  }

  async processRideRefund({
    rideId,
    bookingId,
    chargeId,
    amount,
    reason = 'No driver found',
    status = 'REFUNDED',
    cancellationFee = 0,
    passengerId = null,
    financialContext = null,
    metadata = {}
  } = {}) {
    const resolvedRideInput = String(rideId || bookingId || '').trim();
    const refundAmount = this.normalizePaymentAmountCents(amount);

    if (refundAmount <= 0) {
      return {
        success: false,
        code: 'REFUND_AMOUNT_REQUIRED',
        error: 'Valor de reembolso deve ser maior que zero',
        providerDelivery: 'NOT_SENT'
      };
    }

    const resolvedPayment = await this.resolveStoredPaymentForRefund({
      rideId: resolvedRideInput,
      chargeId,
      financialContext
    });

    // `providerDelivery: 'NOT_SENT'` marca as falhas anteriores à chamada da Woovi:
    // nada foi enviado, então repetir o reembolso não pode estornar em dobro.
    if (!resolvedPayment.success) {
      return { ...resolvedPayment, providerDelivery: 'NOT_SENT' };
    }

    const canonicalRideId = resolvedPayment.rideId;
    const canonicalChargeId = resolvedPayment.chargeId;
    const paymentRecord = resolvedPayment.paymentRecord || {};
    const contextResult = resolveFinancialContext({
      financialContext: resolvedPayment.financialContext
    });
    if (!contextResult.ok) return { success: false, ...contextResult, providerDelivery: 'NOT_SENT' };
    const legacyOperationalCompatible =
      paymentRecord.financialContextLegacy === true &&
      contextResult.context.namespace === 'operational';
    if (!legacyOperationalCompatible && !contextsMatch(paymentRecord.financialContext, contextResult.context)) {
      return {
        success: false,
        code: 'FINANCIAL_CONTEXT_CONFLICT',
        error: 'Contexto financeiro do reembolso diverge do pagamento',
        providerDelivery: 'NOT_SENT'
      };
    }

    if (!canonicalChargeId) {
      return {
        success: false,
        code: 'PAYMENT_CHARGE_NOT_FOUND',
        error: 'chargeId não encontrado para reembolso canônico',
        providerDelivery: 'NOT_SENT'
      };
    }

    if (paymentRecord.refunded || isRefundedPaymentStatus(paymentRecord.status)) {
      return {
        success: true,
        alreadyRefunded: true,
        code: 'ALREADY_REFUNDED',
        rideId: canonicalRideId,
        chargeId: canonicalChargeId,
        refundId: paymentRecord.refundId || null,
        amount: paymentRecord.refundAmount || 0
      };
    }

    const claim = await this.claimRideRefund({
      rideId: canonicalRideId,
      chargeId: canonicalChargeId,
      amount: refundAmount,
      reason,
      status,
      financialContext: contextResult.context
    });

    if (!claim.success || claim.alreadyRefunded) {
      return {
        ...claim,
        rideId: canonicalRideId,
        chargeId: canonicalChargeId,
        amount: claim.refundAmount || refundAmount,
        ...(claim.success ? {} : { providerDelivery: 'NOT_SENT' })
      };
    }

    const refundResult = await this.processRefund(
      canonicalChargeId,
      refundAmount,
      reason,
      contextResult.context
    );
    if (!refundResult.success) {
      await this.clearRideRefundClaim({
        rideId: canonicalRideId,
        refundRequestId: claim.refundRequestId,
        status: 'FAILED',
        error: refundResult.error || refundResult.details || 'Falha ao processar reembolso',
        financialContext: contextResult.context
      });
      return refundResult;
    }

    const markResult = await this.markPaymentRefunded(canonicalRideId, {
      refundAmount,
      cancellationFee,
      chargeId: canonicalChargeId,
      refundId: refundResult.refundId,
      status,
      reason,
      passengerId: passengerId || paymentRecord.passengerId || null,
      refundRequestId: claim.refundRequestId,
      financialContext: contextResult.context,
      metadata: {
        ...metadata,
        refundRequestId: claim.refundRequestId,
        provider: 'woovi'
      }
    });

    if (!markResult.success) {
      return {
        success: false,
        code: 'REFUND_RECORD_FAILED',
        providerRefunded: true,
        providerDelivery: 'SENT',
        rideId: canonicalRideId,
        chargeId: canonicalChargeId,
        refundId: refundResult.refundId,
        amount: refundAmount,
        error: markResult.error || 'Reembolso processado, mas registro canônico falhou'
      };
    }

    return {
      ...refundResult,
      success: true,
      rideId: canonicalRideId,
      chargeId: canonicalChargeId,
      refundId: refundResult.refundId,
      amount: refundAmount,
      refundRequestId: claim.refundRequestId,
      ledgerRecorded: Boolean(markResult.ledgerRecorded),
      ledgerError: markResult.ledgerError || null
    };
  }

  /**
   * Processa reembolso quando não encontra motorista
   * @param {string} chargeId - ID da cobrança na Woovi
   * @param {number} amount - Valor em centavos a reembolsar
   * @param {string} reason - Motivo do reembolso
   * @returns {Promise<Object>} - Resultado do reembolso
   */
  async processRefund(chargeId, amount, reason = 'No driver found', financialContext = null) {
    // Vira true imediatamente antes de chamar a Woovi. Enquanto for false, qualquer
    // falha aconteceu aqui dentro e o reembolso com certeza não foi enviado.
    let providerCallStarted = false;
    try {
      logStructured('info', 'Processando reembolso', { service: 'PaymentService', chargeId, amount, reason });

      if (!chargeId || !amount) {
        return {
          success: false,
          error: 'chargeId e amount são obrigatórios',
          providerDelivery: 'NOT_SENT'
        };
      }

      if (String(chargeId || '').startsWith('mock_review_')) {
        if (String(process.env.APP_REVIEW || '').toLowerCase() !== 'true') {
          return {
            success: false,
            error: 'Cobrança mock permitida apenas em APP_REVIEW=true',
            providerDelivery: 'NOT_SENT'
          };
        }

        const mockRefundId = `mock_refund_${Date.now()}`;
        logStructured('warn', 'Reembolso em modo review/bypass processado localmente', {
          service: 'PaymentService',
          chargeId,
          amount,
          reason,
          refundId: mockRefundId
        });

        return {
          success: true,
          bypass: true,
          message: 'Reembolso em modo review processado com sucesso',
          refundId: mockRefundId,
          amount
        };
      }

      // Processar reembolso diretamente na Woovi (com circuit breaker)
      const contextResult = resolveFinancialContext(
        { financialContext },
        { allowLegacyOperational: true }
      );
      if (!contextResult.ok) return { success: false, ...contextResult, providerDelivery: 'NOT_SENT' };
      const chargeRuntime = await this.resolveWooviConfigForCharge(chargeId);
      if (
        contextResult.context.namespace === 'sandbox' &&
        (!chargeRuntime?.financialContext || !contextsMatch(chargeRuntime.financialContext, contextResult.context))
      ) {
        return {
          success: false,
          code: 'FINANCIAL_SANDBOX_CONTEXT_LOST',
          error: 'Não foi possível confirmar o ambiente sandbox do reembolso',
          providerDelivery: 'NOT_SENT'
        };
      }
      const refundResult = await circuitBreakerService.execute(
        'woovi_refund',
        async () => {
          const refundArgs = [chargeId, amount, `Reembolso Leaf - ${reason}`];
          if (contextResult.context.namespace === 'sandbox') {
            refundArgs.push({ wooviConfig: chargeRuntime.wooviConfig });
          }
          providerCallStarted = true;
          return await this.wooviDriverService.processRefund(...refundArgs);
        },
        async () => {
          // Fallback: circuit breaker aberto (nada enviado) ou a chamada lançou erro
          // depois de iniciada (resultado desconhecido).
          return {
            success: false,
            error: 'Serviço de pagamento temporariamente indisponível',
            providerDelivery: providerCallStarted ? 'UNKNOWN' : 'NOT_SENT'
          };
        },
        {
          failureThreshold: 5,
          timeout: 60000
        }
      );

      if (!refundResult.success) {
        return {
          success: false,
          error: 'Falha ao processar reembolso',
          details: refundResult.error,
          httpStatus: refundResult.httpStatus || null,
          errorCode: refundResult.errorCode || null,
          // Sem classificação explícita o resultado é tratado como desconhecido.
          providerDelivery: refundResult.providerDelivery || 'UNKNOWN'
        };
      }

      logStructured('info', 'Reembolso processado com sucesso', {
        service: 'PaymentService',
        chargeId,
        amount,
        refundId: refundResult.refundId
      });

      return {
        success: true,
        message: 'Reembolso processado com sucesso',
        refundId: refundResult.refundId,
        amount: amount
      };

    } catch (error) {
      logError(error, 'Erro ao processar reembolso', { service: 'PaymentService' });
      return {
        success: false,
        error: 'Erro interno do servidor',
        details: error.message,
        providerDelivery: providerCallStarted ? 'UNKNOWN' : 'NOT_SENT'
      };
    }
  }
}

module.exports = PaymentServiceRefundsAndReleaseMethods;
