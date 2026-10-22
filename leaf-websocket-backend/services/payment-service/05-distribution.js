// Gerado a partir de services/payment-service.js (divisão mecânica, código idêntico).
// Contrato financeiro da corrida e distribuição líquida/cancelamento

const {
  firebaseConfig,
  circuitBreakerService,
  subscriptionStateService,
  resolveFinancialContext,
  getFinancialCollections,
  contextsMatch,
  buildRideFinancialContract,
  validateAuthoritativeFinancialSnapshot,
  logStructured,
  logError,
  isRefundedPaymentStatus,
  isCapturedPaymentStatus,
} = require('./shared');

class PaymentServiceDistributionMethods {
  /**
   * Constroi o contrato financeiro canonico da corrida.
   * O pedágio é passthrough do motorista e as taxas são calculadas sobre a corrida sem pedágio.
   */
  buildRideFinancialContract({ passengerPaidCents, tollFeeCents = 0, subscriptionRetainedFeeCents = 0, driverIntroFee = null } = {}) {
    return buildRideFinancialContract({
      passengerPaidCents,
      tollFeeCents,
      subscriptionRetainedFeeCents,
      driverIntroFee,
      policy: {
        operationalFeeUpTo10Cents: this.OPERATIONAL_FEE_UP_TO_10,
        operationalFee10To25Cents: this.OPERATIONAL_FEE_10_TO_25,
        operationalFee25To50Cents: this.OPERATIONAL_FEE_25_TO_50,
        operationalFeeAbove50Percentage: this.OPERATIONAL_FEE_ABOVE_50_PERCENTAGE,
        threshold10Cents: this.THRESHOLD_10,
        threshold25Cents: this.THRESHOLD_25,
        threshold50Cents: this.THRESHOLD_50,
        paymentIntermediationPercentage: this.WOOVI_FEE_PERCENTAGE,
        paymentIntermediationMinimumCents: this.WOOVI_FEE_MINIMUM
      }
    });
  }

  /**
   * Calcula valor líquido para o motorista (Imunizando Pedágio)
   * @param {number} totalAmount - Valor total da corrida em centavos
   * @param {number} tollFee - Valor do pedágio em centavos (padrão 0)
   * @returns {Object} - Cálculo detalhado
   */
  calculateNetAmount(totalAmount, tollFee = 0, subscriptionRetainedFee = 0, options = {}) {
    const financialContract = this.buildRideFinancialContract({
      passengerPaidCents: totalAmount,
      tollFeeCents: tollFee,
      subscriptionRetainedFeeCents: subscriptionRetainedFee,
      driverIntroFee: options.driverIntroFee
    });
    const totalAmountCents = financialContract.passengerPaidCents;
    const operationalFee = financialContract.leafOperationalFeeCents;
    const wooviFee = financialContract.paymentIntermediationFeeCents;
    const netAmount = financialContract.driverNetAmountCents;
    const tollFeeCents = financialContract.tollFeeCents;

    return {
      totalAmount: totalAmountCents,
      tollFee: tollFeeCents,
      operationalFee: operationalFee,
      wooviFee: wooviFee,
      netAmount: netAmount, // Não pode ser negativo
      financialContract,
      breakdown: {
        total: (totalAmountCents / 100).toFixed(2),
        tollFee: (tollFeeCents / 100).toFixed(2),
        operationalFeeType: financialContract.feePolicy.operationalFeeType,
        operationalFee: (operationalFee / 100).toFixed(2),
        wooviFee: (wooviFee / 100).toFixed(2),
        net: (netAmount / 100).toFixed(2)
      }
    };
  }

  /**
   * Constrói breakdown financeiro em reais a partir do valor total da corrida.
   * Usa o cálculo central em centavos e devolve valores em reais para payload.
   * @param {number} totalFareReais
   * @param {number} tollFeeReais
   */
  calculateFareBreakdownFromReais(totalFareReais, tollFeeReais = 0, options = {}) {
    const normalizedFareReais = Number.isFinite(Number(totalFareReais)) ? Math.max(0, Number(totalFareReais)) : 0;
    const normalizedTollReais = Number.isFinite(Number(tollFeeReais)) ? Math.max(0, Number(tollFeeReais)) : 0;
    const totalAmountCents = this.toCents(normalizedFareReais);
    const tollFeeCents = this.toCents(normalizedTollReais);
    const subscriptionRetainedFeeCents = Number.isFinite(Number(options.subscriptionRetainedFeeCents))
      ? Math.max(0, Math.round(Number(options.subscriptionRetainedFeeCents)))
      : this.toCents(options.subscriptionRetainedFeeReais || 0);
    const calculation = this.calculateNetAmount(totalAmountCents, tollFeeCents, subscriptionRetainedFeeCents, options);

    const operationalFee = this.toReais(calculation.operationalFee);
    const paymentIntermediationFee = this.toReais(calculation.wooviFee);
    const subscriptionRetainedFee = this.toReais(
      calculation.financialContract.subscriptionRetainedFeeCents || 0
    );
    const totalFees = this.toReais(
      calculation.operationalFee +
        calculation.wooviFee +
        (calculation.financialContract.subscriptionRetainedFeeCents || 0)
    );
    const driverNetAmount = this.toReais(calculation.netAmount);
    const tollFee = this.toReais(calculation.tollFee);

    return {
      totalFare: this.toReais(totalAmountCents),
      tollFee,
      operationalFee,
      paymentIntermediationFee,
      subscriptionRetainedFee,
      totalFees,
      driverNetAmount,
      calculation
    };
  }

  resolveAuthoritativeNetCalculation(financialSnapshot, expected = {}) {
    const validation = validateAuthoritativeFinancialSnapshot(financialSnapshot, expected);
    if (!validation.valid) {
      return {
        success: false,
        code: validation.code || 'FINANCIAL_SNAPSHOT_INVALID',
        error: validation.error || 'Snapshot financeiro final inválido'
      };
    }

    const snapshot = validation.snapshot;
    return {
      success: true,
      calculation: {
        totalAmount: snapshot.passengerPaidCents,
        tollFee: snapshot.tollFeeCents,
        operationalFee: snapshot.operationalFeeCents,
        wooviFee: snapshot.paymentIntermediationFeeCents,
        netAmount: snapshot.driverNetAmountCents,
        financialContract: snapshot,
        breakdown: {
          total: (snapshot.passengerPaidCents / 100).toFixed(2),
          tollFee: (snapshot.tollFeeCents / 100).toFixed(2),
          operationalFeeType: 'locked_backend_final',
          operationalFee: (snapshot.operationalFeeCents / 100).toFixed(2),
          wooviFee: (snapshot.paymentIntermediationFeeCents / 100).toFixed(2),
          net: (snapshot.driverNetAmountCents / 100).toFixed(2)
        }
      }
    };
  }

  /**
   * Classifica a falha do estorno parcial do encerramento antecipado.
   *
   * A chamada de reembolso da Woovi não leva id de idempotência, então só é
   * repetida a falha que com certeza não chegou ao provedor (`NOT_SENT`).
   * Recusa do provedor, timeout, 5xx, resultado desconhecido ou reembolso feito
   * sem registro ficam para revisão manual.
   */
  classifyPassengerRefundFailure(refundResult = {}) {
    if (refundResult.providerRefunded === true) return 'MANUAL_REVIEW_REQUIRED';
    return refundResult.providerDelivery === 'NOT_SENT' ? 'RETRY_PENDING' : 'MANUAL_REVIEW_REQUIRED';
  }

  /**
   * Decide se o estorno parcial pode ser enviado à Woovi nesta execução.
   * Qualquer rastro de tentativa anterior que não seja uma falha sabidamente
   * não enviada bloqueia a nova chamada.
   */
  resolvePassengerRefundAttemptGate(paymentRecord = {}) {
    const pending = paymentRecord.passengerRefundPending || null;
    if (pending?.status === 'MANUAL_REVIEW_REQUIRED') {
      return { allowed: false, reason: 'PASSENGER_REFUND_MANUAL_REVIEW_REQUIRED' };
    }
    if (paymentRecord.refundInProgress === true) {
      // Reserva de reembolso sem desfecho: a execução anterior pode ter parado
      // depois de chamar o provedor.
      return { allowed: false, reason: 'PASSENGER_REFUND_PREVIOUS_ATTEMPT_UNRESOLVED' };
    }
    if (String(paymentRecord.refundStatus || '').toUpperCase() === 'FAILED' && pending?.status !== 'RETRY_PENDING') {
      return { allowed: false, reason: 'PASSENGER_REFUND_PREVIOUS_FAILURE_UNCLASSIFIED' };
    }
    return { allowed: true, reason: null };
  }

  /**
   * Grava no pagamento da corrida o estorno parcial que ficou pendente
   * (`passengerRefundPending`). É esse registro que a reconciliação financeira
   * lê para mostrar a pendência no dashboard.
   */
  async recordPassengerRefundPending({
    rideId,
    financialContext = null,
    status,
    chargeId = null,
    amountCents = 0,
    code = null,
    error = null,
    providerDelivery = null,
    previous = null
  } = {}) {
    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore || !rideId) return { success: false, error: 'Firestore não disponível' };
      const contextResult = resolveFinancialContext(
        { financialContext },
        { allowLegacyOperational: true }
      );
      if (!contextResult.ok) return { success: false, code: contextResult.code, error: contextResult.error };
      const { collections } = getFinancialCollections(contextResult.context);
      const nowIso = new Date().toISOString();
      const resolved = status === 'RESOLVED';
      const pending = {
        status,
        rideId,
        chargeId: chargeId || previous?.chargeId || null,
        amountCents: Number(amountCents) || Number(previous?.amountCents) || 0,
        code: resolved ? (previous?.code || null) : (code || null),
        error: resolved ? (previous?.error || null) : (error || null),
        providerDelivery: resolved ? (previous?.providerDelivery || null) : (providerDelivery || null),
        attempts: (Number(previous?.attempts) || 0) + (resolved ? 0 : 1),
        firstFailedAtIso: previous?.firstFailedAtIso || (resolved ? null : nowIso),
        lastFailedAtIso: resolved ? (previous?.lastFailedAtIso || null) : nowIso,
        resolvedAtIso: resolved ? nowIso : null,
        source: 'processNetDistribution'
      };
      await firestore.collection(collections.ridePayments).doc(rideId).set({
        passengerRefundPending: pending
      }, { merge: true });
      return { success: true, pending };
    } catch (recordError) {
      logError(recordError, 'Erro ao registrar estorno parcial pendente', {
        service: 'PaymentService',
        rideId
      });
      return { success: false, error: recordError.message };
    }
  }

  /**
   * Processa distribuição líquida para o motorista após corrida finalizada
   * @param {Object} rideData - Dados da corrida finalizada
   * @param {string} rideData.rideId - ID da corrida
   * @param {string} rideData.driverId - ID do motorista
   * @param {string} rideData.wooviClientId - ID do cliente Woovi do motorista
   * @param {number} rideData.totalAmount - Valor total em centavos
   * @returns {Promise<Object>} - Resultado da distribuição
   */
  async processNetDistribution(rideData) {
    try {
      const storedPayment = await this.getStoredPayment(rideData.rideId, rideData.financialContext || null);
      const contextResult = await this.resolveFinancialContextForPayment({
        rideId: rideData.rideId,
        chargeId: storedPayment?.chargeId || storedPayment?.paymentId,
        financialContext: rideData.financialContext || storedPayment?.financialContext,
        providerEnvironment: rideData.providerEnvironment || storedPayment?.providerEnvironment
      });
      if (!contextResult.ok) {
        return { success: false, code: contextResult.code, error: contextResult.error };
      }
      const financialContext = contextResult.context;
      if (!storedPayment && financialContext.namespace === 'sandbox') {
        return {
          success: false,
          code: 'PAYMENT_RECORD_NOT_FOUND',
          error: 'Pagamento sandbox não encontrado para liquidação'
        };
      }
      const legacyOperationalCompatible =
        storedPayment?.financialContextLegacy === true &&
        financialContext.namespace === 'operational';
      if (
        storedPayment &&
        !legacyOperationalCompatible &&
        !contextsMatch(storedPayment.financialContext, financialContext)
      ) {
        return {
          success: false,
          code: 'FINANCIAL_CONTEXT_CONFLICT',
          error: 'Contexto financeiro da corrida diverge do pagamento confirmado'
        };
      }

      logStructured('info', 'Processando distribuição líquida', {
        service: 'PaymentService',
        rideId: rideData.rideId,
        driverId: rideData.driverId,
        totalAmount: rideData.totalAmount,
        tollFee: rideData.tollFee || 0
      });

      // 0. ✅ Valor final menor que o pago: encerramento antecipado ou pedágio
      // contratado que não foi cruzado. A diferença volta ao passageiro.
      let passengerRefundAmount = 0;
      let passengerRefundResult = null;
      // Rastro do estorno parcial: acompanha o resultado da liquidação (cache de idempotência
      // e payment_distributions) para que uma corrida possa ser auditada sem depender de logs.
      const passengerRefundTrace = {
        attempted: false,
        success: false,
        skippedReason: null,
        storedAmountCents: null,
        finalAmountCents: Number.isFinite(Number(rideData.totalAmount)) ? Number(rideData.totalAmount) : null,
        refundAmountCents: 0,
        refundId: null,
        code: null,
        error: null,
        // 'RETRY_PENDING' (o worker repete) ou 'MANUAL_REVIEW_REQUIRED' (fica para o suporte).
        pendingStatus: null,
        manualReviewRequired: false,
        pendingRecorded: null,
        providerDelivery: null
      };
      try {
        const paymentRecord = storedPayment;
        const chargeIdToRefund = paymentRecord?.chargeId || paymentRecord?.paymentId;
        const storedAmountCents = Number(paymentRecord?.amount);
        passengerRefundTrace.storedAmountCents = Number.isFinite(storedAmountCents) ? storedAmountCents : null;
        const refundDue = Boolean(
          paymentRecord && isCapturedPaymentStatus(paymentRecord.status) && chargeIdToRefund && paymentRecord.amount > rideData.totalAmount
        );
        const refundAttemptGate = refundDue
          ? this.resolvePassengerRefundAttemptGate(paymentRecord)
          : { allowed: true, reason: null };
        if (refundDue && !refundAttemptGate.allowed) {
          // Uma tentativa anterior pode ter chegado à Woovi: não chamar o provedor de novo.
          // O crédito do motorista segue (é idempotente) e a pendência fica para o suporte.
          passengerRefundAmount = paymentRecord.amount - rideData.totalAmount;
          passengerRefundTrace.refundAmountCents = passengerRefundAmount;
          passengerRefundTrace.skippedReason = refundAttemptGate.reason;
          passengerRefundTrace.pendingStatus = 'MANUAL_REVIEW_REQUIRED';
          passengerRefundTrace.manualReviewRequired = true;
          const previousPending = paymentRecord.passengerRefundPending || null;
          passengerRefundTrace.code = previousPending?.code || null;
          passengerRefundTrace.error = previousPending?.error || paymentRecord.refundFailure || null;
          if (previousPending?.status === 'MANUAL_REVIEW_REQUIRED') {
            passengerRefundTrace.pendingRecorded = true;
          } else {
            const recordResult = await this.recordPassengerRefundPending({
              rideId: rideData.rideId,
              financialContext,
              status: 'MANUAL_REVIEW_REQUIRED',
              chargeId: chargeIdToRefund,
              amountCents: passengerRefundAmount,
              code: refundAttemptGate.reason,
              error: typeof paymentRecord.refundFailure === 'string'
                ? paymentRecord.refundFailure
                : (paymentRecord.refundFailure ? JSON.stringify(paymentRecord.refundFailure) : null),
              providerDelivery: 'UNKNOWN',
              previous: previousPending
            });
            passengerRefundTrace.pendingRecorded = recordResult.success === true;
          }
          logStructured('error', 'Estorno parcial do passageiro aguardando revisão manual', {
            service: 'PaymentService',
            rideId: rideData.rideId,
            chargeId: chargeIdToRefund,
            refundAmount: passengerRefundAmount,
            reason: refundAttemptGate.reason
          });
        } else if (refundDue) {
          passengerRefundAmount = paymentRecord.amount - rideData.totalAmount;
          passengerRefundTrace.attempted = true;
          passengerRefundTrace.refundAmountCents = passengerRefundAmount;
          logStructured('info', 'Valor final menor que o pago: processando estorno parcial para o passageiro', {
            service: 'PaymentService',
            rideId: rideData.rideId,
            originalAmount: paymentRecord.amount,
            finalAmount: rideData.totalAmount,
            refundAmount: passengerRefundAmount
          });

          passengerRefundResult = await this.processRideRefund({
            rideId: rideData.rideId,
            chargeId: chargeIdToRefund,
            amount: passengerRefundAmount,
            reason: 'Estorno parcial da corrida (valor final menor que o pago)',
            status: 'REFUNDED_PARTIAL',
            passengerId: paymentRecord.passengerId || rideData.passengerId || null,
            financialContext,
            metadata: {
              source: 'processNetDistribution',
              originalAmountCents: paymentRecord.amount,
              finalAmountCents: rideData.totalAmount
            }
          });
          passengerRefundTrace.success = passengerRefundResult.success === true;
          passengerRefundTrace.refundId = passengerRefundResult.refundId || null;
          passengerRefundTrace.code = passengerRefundResult.code || null;
          if (passengerRefundResult.success) {
            logStructured('info', 'Estorno parcial do passageiro realizado com sucesso', {
              service: 'PaymentService',
              rideId: rideData.rideId,
              refundId: passengerRefundResult.refundId
            });
            if (paymentRecord.passengerRefundPending?.status === 'RETRY_PENDING') {
              await this.recordPassengerRefundPending({
                rideId: rideData.rideId,
                financialContext,
                status: 'RESOLVED',
                previous: paymentRecord.passengerRefundPending
              });
            }
          } else {
            const refundError = passengerRefundResult.error || passengerRefundResult.details || null;
            passengerRefundTrace.error = typeof refundError === 'string'
              ? refundError
              : (refundError ? JSON.stringify(refundError) : null);
            logStructured('error', 'Falha ao processar estorno parcial do passageiro', {
              service: 'PaymentService',
              rideId: rideData.rideId,
              chargeId: chargeIdToRefund,
              refundAmount: passengerRefundAmount,
              code: passengerRefundResult.code || null,
              error: passengerRefundResult.error
            });

            // A falha não pode ficar só no log: fica gravada no pagamento da corrida.
            const pendingStatus = this.classifyPassengerRefundFailure(passengerRefundResult);
            passengerRefundTrace.pendingStatus = pendingStatus;
            passengerRefundTrace.manualReviewRequired = pendingStatus === 'MANUAL_REVIEW_REQUIRED';
            passengerRefundTrace.providerDelivery = passengerRefundResult.providerDelivery || 'UNKNOWN';
            const refundDetails = passengerRefundResult.details || null;
            const recordResult = await this.recordPassengerRefundPending({
              rideId: rideData.rideId,
              financialContext,
              status: pendingStatus,
              chargeId: chargeIdToRefund,
              amountCents: passengerRefundAmount,
              code: passengerRefundResult.code || null,
              error: [
                passengerRefundTrace.error,
                typeof refundDetails === 'string' ? refundDetails : (refundDetails ? JSON.stringify(refundDetails) : null)
              ].filter(Boolean).join(' | ') || null,
              providerDelivery: passengerRefundTrace.providerDelivery,
              previous: paymentRecord.passengerRefundPending || null
            });
            passengerRefundTrace.pendingRecorded = recordResult.success === true;
          }
        } else if (paymentRecord && storedAmountCents > rideData.totalAmount) {
          // Valor pago maior que o final, mas o estorno não foi tentado: registrar o motivo
          // em vez de seguir em silêncio.
          const alreadyRefunded = paymentRecord.refunded === true || isRefundedPaymentStatus(paymentRecord.status);
          passengerRefundTrace.skippedReason = alreadyRefunded
            ? 'PAYMENT_ALREADY_REFUNDED'
            : (!chargeIdToRefund ? 'PAYMENT_CHARGE_ID_MISSING' : 'PAYMENT_STATUS_NOT_CAPTURED');
          if (alreadyRefunded) {
            passengerRefundTrace.refundId = paymentRecord.refundId || null;
            passengerRefundTrace.refundAmountCents = Number(paymentRecord.refundAmount || 0) || 0;
          }
          logStructured(alreadyRefunded ? 'info' : 'warn', 'Estorno parcial do passageiro não tentado na liquidação', {
            service: 'PaymentService',
            rideId: rideData.rideId,
            reason: passengerRefundTrace.skippedReason,
            paymentStatus: paymentRecord.status || null,
            originalAmount: storedAmountCents,
            finalAmount: rideData.totalAmount
          });
        } else {
          passengerRefundTrace.skippedReason = paymentRecord
            ? 'NO_REFUND_DUE'
            : 'PAYMENT_RECORD_NOT_FOUND';
        }
      } catch (refundCheckErr) {
        passengerRefundTrace.code = 'REFUND_CHECK_EXCEPTION';
        passengerRefundTrace.error = refundCheckErr.message;
        logStructured('error', 'Erro ao checar necessidade de estorno parcial', {
          service: 'PaymentService',
          rideId: rideData.rideId,
          error: refundCheckErr.message
        });
        if (passengerRefundTrace.attempted && !passengerRefundTrace.success) {
          // A exceção veio depois de o estorno ter sido iniciado: não dá para saber se
          // a Woovi recebeu o pedido. Vai para revisão manual, sem nova tentativa.
          passengerRefundTrace.pendingStatus = 'MANUAL_REVIEW_REQUIRED';
          passengerRefundTrace.manualReviewRequired = true;
          passengerRefundTrace.providerDelivery = 'UNKNOWN';
          const recordResult = await this.recordPassengerRefundPending({
            rideId: rideData.rideId,
            financialContext,
            status: 'MANUAL_REVIEW_REQUIRED',
            chargeId: storedPayment?.chargeId || storedPayment?.paymentId || null,
            amountCents: passengerRefundAmount,
            code: 'REFUND_CHECK_EXCEPTION',
            error: refundCheckErr.message,
            providerDelivery: 'UNKNOWN',
            previous: storedPayment?.passengerRefundPending || null
          });
          passengerRefundTrace.pendingRecorded = recordResult.success === true;
        }
      }

      // 1. Liquidar o snapshot final quando o evento canônico o fornece.
      // Recalcular é mantido apenas para caminhos legados que não passam pelo worker canônico.
      const hasAuthoritativeFinancialSnapshot = Boolean(rideData.financialSnapshot);
      let netCalculation;
      if (hasAuthoritativeFinancialSnapshot) {
        const snapshotResult = this.resolveAuthoritativeNetCalculation(rideData.financialSnapshot, {
          passengerPaidCents: rideData.totalAmount,
          tollFeeCents: rideData.tollFee || 0,
          driverId: rideData.driverId
        });
        if (!snapshotResult.success) {
          return {
            success: false,
            error: 'Snapshot financeiro final inválido para liquidação',
            code: snapshotResult.code,
            details: snapshotResult.error
          };
        }
        netCalculation = snapshotResult.calculation;
      } else {
        // Legacy path without a final snapshot: settle with the accepted intro
        // fee context so settlement matches the offer and the receipt.
        let driverIntroFee = null;
        try {
          driverIntroFee = require('../driver-intro-fee-service').acceptedContext(rideData);
        } catch (error) {
          return {
            success: false,
            error: 'Contexto da tarifa promocional inválido para liquidação',
            code: error.code || 'DRIVER_INTRO_FEE_CONTEXT_INVALID'
          };
        }
        netCalculation = this.calculateNetAmount(rideData.totalAmount, rideData.tollFee || 0, 0, { driverIntroFee });
      }

      if (netCalculation.netAmount <= 0) {
        return {
          success: false,
          error: 'Valor líquido insuficiente para distribuição',
          details: 'Taxas excedem o valor da corrida'
        };
      }

      // 1.5. Lógica de retenção em corridas (desabilitada por padrão).
      // O modelo vigente prioriza liquidação de assinatura no saque.
      let retainedFees = hasAuthoritativeFinancialSnapshot
        ? Math.max(0, Number(netCalculation.financialContract?.subscriptionRetainedFeeCents || 0) || 0)
        : 0;
      if (this.SUBSCRIPTION_SPLIT_RETENTION_ENABLED && hasAuthoritativeFinancialSnapshot) {
        return {
          success: false,
          error: 'Retenção de assinatura exige snapshot financeiro gerado com a retenção incluída',
          code: 'FINANCIAL_SNAPSHOT_SUBSCRIPTION_RETENTION_UNSUPPORTED'
        };
      }
      if (
        financialContext.namespace === 'operational' &&
        this.SUBSCRIPTION_SPLIT_RETENTION_ENABLED &&
        rideData.driverId
      ) {
        try {
          const subscriptionBilling = await subscriptionStateService.getBillingData(rideData.driverId);
          if (subscriptionBilling.subscriptionStatus === 'grace_period' && subscriptionBilling.pendingFeeCents > 0) {
            // Retém até 50% do valor líquido ou total da dívida, o que for menor
            const maxSplit = Math.floor(netCalculation.netAmount / 2);
            retainedFees = Math.min(maxSplit, subscriptionBilling.pendingFeeCents);

            const retentionResult = await subscriptionStateService.runTransaction(rideData.driverId, (current) => {
              const pendingFeeCents = Math.max(0, Number(current.pendingFeeCents || 0));
              const debit = Math.min(pendingFeeCents, retainedFees);
              const remainingDebt = Math.max(0, pendingFeeCents - debit);
              const nextStatus = remainingDebt === 0 ? 'active' : 'grace_period';
              const nextBillingStatus = remainingDebt === 0 ? 'active' : 'overdue';
              const nowIso = new Date().toISOString();

              return {
                pendingFeeCents: remainingDebt,
                status: nextStatus,
                billingStatus: nextBillingStatus,
                lastRetentionAt: nowIso,
                lastRetentionAmountCents: debit,
                updatedAt: nowIso
              };
            });

            if (!retentionResult.success) {
              throw new Error(retentionResult.error || 'Falha ao registrar retenção de assinatura');
            }

            retainedFees = Math.max(0, Number(retentionResult.subscription?.lastRetentionAmountCents || retainedFees) || 0);
            netCalculation.netAmount -= retainedFees; // Atualiza o valor que vai pro motorista

            logStructured('info', 'Retenção de Carência Aplicada', {
              service: 'PaymentService',
              driverId: rideData.driverId,
              retainedAmount: retainedFees,
              remainingDebt: Number(retentionResult.subscription?.pendingFeeCents || 0),
              newNetAmount: netCalculation.netAmount
            });
          }
        } catch (err) {
          logStructured('warn', 'Falha ao processar Split Punitivo', { service: 'PaymentService', error: err.message });
        }
      }

      if (retainedFees > 0 && !hasAuthoritativeFinancialSnapshot) {
        const finalContract = this.buildRideFinancialContract({
          passengerPaidCents: netCalculation.totalAmount,
          tollFeeCents: netCalculation.tollFee,
          subscriptionRetainedFeeCents: retainedFees
        });
        netCalculation.operationalFee = finalContract.leafOperationalFeeCents;
        netCalculation.wooviFee = finalContract.paymentIntermediationFeeCents;
        netCalculation.netAmount = finalContract.driverNetAmountCents;
        netCalculation.financialContract = finalContract;
        netCalculation.breakdown.net = (finalContract.driverNetAmountCents / 100).toFixed(2);
      }

      // 2. Buscar chave Pix do motorista (necessária para transferência)
      let driverPixKey = rideData.driverPixKey || null;

      // Se não tiver chave Pix, tentar buscar do banco de dados
      if (financialContext.namespace === 'operational' && !driverPixKey && rideData.driverId) {
        try {
          const DriverApprovalService = require('../driver-approval-service');
          const driverApprovalService = new DriverApprovalService();
          const accountData = await driverApprovalService.getDriverWooviAccountId(rideData.driverId);

          if (accountData && accountData.pixKey) {
            driverPixKey = accountData.pixKey;
            logStructured('info', 'Chave Pix do motorista encontrada', { service: 'PaymentService', driverPixKey });
          } else {
            logStructured('warn', 'Chave Pix do motorista não encontrada. Usando fallback', { service: 'PaymentService' });
          }
        } catch (pixKeyError) {
          logStructured('warn', 'Erro ao buscar chave Pix do motorista', { service: 'PaymentService', error: pixKeyError.message });
        }
      }

      // 3. ✅ MVP: Creditar saldo diretamente no Firestore (substitui BaaS temporariamente)
      // O saldo fica disponível para o motorista consultar e usar
      // Quando BaaS estiver disponível, podemos migrar os saldos

      let transferId = null;
      let finalResult = null;

      // Tentar transferência BaaS apenas se chaves Pix estiverem disponíveis
      // Se não estiver, usar apenas crédito no Firestore
      if (
        this.isWooviDirectTransferOnRideCompletionEnabled() &&
        financialContext.namespace === 'operational' &&
        driverPixKey &&
        this.LEAF_PIX_KEY &&
        this.LEAF_PIX_KEY !== 'test@leaf.app.br'
      ) {
        logStructured('info', 'Tentando transferência BaaS (se disponível)', { service: 'PaymentService' });

        // Transferência BaaS com circuit breaker
        const transferResult = await circuitBreakerService.execute(
          'woovi_transfer',
          async () => {
            return await this.wooviDriverService.transferDirectToDriver(
              rideData.wooviAccountId || rideData.wooviClientId,
              netCalculation.netAmount,
              `Ganhos da corrida ${rideData.rideId}`,
              rideData.rideId,
              driverPixKey,
              this.LEAF_PIX_KEY,
              {
                correlationID: `leaf_ride_completion_${rideData.rideId}_${rideData.driverId}`
              }
            );
          },
          async () => {
            // Fallback: retornar erro se circuit breaker aberto
            return {
              success: false,
              error: 'Serviço de transferência temporariamente indisponível'
            };
          },
          {
            failureThreshold: 5,
            timeout: 60000
          }
        );

        if (transferResult.success) {
          transferId = transferResult.transferId;
          finalResult = transferResult;
          logStructured('info', 'Transferência BaaS realizada com sucesso', { service: 'PaymentService' });
        } else {
          logStructured('warn', 'Transferência BaaS não disponível, usando apenas crédito no Firestore', { service: 'PaymentService' });
        }
      } else {
        logStructured('info', 'Usando sistema de saldo no Firestore/subconta Woovi sem Pix Out por corrida', {
          service: 'PaymentService',
          directTransferEnabled: this.isWooviDirectTransferOnRideCompletionEnabled(),
          hasDriverPixKey: Boolean(driverPixKey)
        });
      }

      const plannedBalanceCreditId = this.buildDriverBalanceCreditId(
        rideData.driverId,
        rideData.rideId,
        netCalculation.netAmount
      );
      const ledgerResult = await this.financialLedgerService.recordRideSettlement({
        rideId: rideData.rideId,
        driverId: rideData.driverId,
        totalAmountCents: netCalculation.totalAmount,
        netAmountCents: netCalculation.netAmount,
        operationalFeeCents: netCalculation.operationalFee,
        wooviFeeCents: netCalculation.wooviFee,
        retainedFeeCents: retainedFees,
        financialContext,
        metadata: {
          transferId: transferId || null,
          balanceCreditId: plannedBalanceCreditId,
          refundAmountCents: passengerRefundAmount || 0,
          refundId: passengerRefundResult?.refundId || null
        }
      });

      if (!ledgerResult.success) {
        logStructured('error', 'Falha ao registrar ledger financeiro do settlement', {
          service: 'PaymentService',
          rideId: rideData.rideId,
          driverId: rideData.driverId,
          ledgerError: ledgerResult.error || ledgerResult.code
        });
        return {
          success: false,
          error: 'Falha ao registrar ledger financeiro do settlement',
          details: ledgerResult.error || ledgerResult.code,
          retryable: true
        };
      }

      // 3. ✅ Creditar saldo somente depois do ledger canônico do settlement estar postado.
      const creditResult = await this.creditDriverBalance(
        rideData.driverId,
        netCalculation.netAmount,
        rideData.rideId,
        financialContext
      );

      if (!creditResult.success) {
        logError(new Error(creditResult.error), 'Erro ao creditar saldo do motorista após ledger postado', {
          service: 'PaymentService',
          rideId: rideData.rideId,
          driverId: rideData.driverId,
          ledgerEventId: ledgerResult.eventId || null
        });
        return {
          success: false,
          error: 'Falha ao creditar saldo do motorista',
          details: creditResult.error || 'Crédito interno não confirmado',
          retryable: true,
          ledgerStatus: 'posted',
          ledgerEventId: ledgerResult.eventId || null
        };
      }

      logStructured('info', 'Saldo creditado com sucesso', { service: 'PaymentService', balance: creditResult.balance });

      // 4. Atualizar status do holding para distribuído
      const distributionData = {
        rideId: rideData.rideId,
        driverId: rideData.driverId,
        status: 'distributed',
        distributedAt: new Date().toISOString(),
        netAmount: netCalculation.netAmount,
        subscriptionRetainedFee: retainedFees,
        transferId: transferId || null, // ID da transferência (se BaaS estiver disponível)
        balanceCreditId: creditResult.transactionId || plannedBalanceCreditId,
        ledgerEventId: ledgerResult.eventId || null,
        calculation: netCalculation,
        passengerRefund: passengerRefundTrace,
        financialContext,
        financialNamespace: financialContext.namespace,
        financialContextId: financialContext.contextId,
        // Taxas retidas na conta Leaf (não transferidas)
        retainedFees: {
          operationalFee: netCalculation.operationalFee,
          wooviFee: netCalculation.wooviFee,
          subscriptionRetainedFee: retainedFees,
          totalRetained: netCalculation.operationalFee + netCalculation.wooviFee + retainedFees
        }
      };

      // ✅ Salvar distribuição no Firestore
      await this.saveDistributionToFirestore(distributionData, financialContext);

      // ✅ NOVO: Atualizar status do payment_holding para distributed
      await this.updatePaymentHolding(rideData.rideId, {
        status: 'distributed',
        distributedAt: new Date().toISOString(),
        distributionData: {
          netAmount: netCalculation.netAmount,
          transferId: transferId,
          balanceCreditId: creditResult.transactionId || plannedBalanceCreditId,
          ledgerEventId: ledgerResult.eventId || null,
          retainedFees: distributionData.retainedFees
        },
        financialContext,
        financialNamespace: financialContext.namespace,
        financialContextId: financialContext.contextId
      });

      this.financialLedgerService.reconcileRideFinancials({
        rideId: rideData.rideId,
        financialContext
      })
        .catch((reconciliationError) => {
          logStructured('warn', 'Falha ao reconciliar corrida após settlement', {
            service: 'PaymentService',
            rideId: rideData.rideId,
            error: reconciliationError.message
          });
        });

      logStructured('info', 'Distribuição líquida processada', {
        service: 'payment-service',
        rideId: distributionData.rideId,
        netAmount: distributionData.netAmount,
        driverAmount: distributionData.driverAmount,
        retainedFees: distributionData.retainedFees,
        financialNamespace: financialContext.namespace
      });

      // O motorista já foi creditado (uma única vez: ledger e crédito são idempotentes).
      // Estorno parcial pendente não pode sair daqui como sucesso silencioso.
      if (passengerRefundTrace.pendingStatus === 'RETRY_PENDING') {
        // Falha que não chegou à Woovi: o worker de billing repete a liquidação
        // (retry com backoff e, esgotado, DLQ).
        return {
          success: false,
          code: 'PASSENGER_REFUND_RETRY_PENDING',
          error: 'Estorno parcial do passageiro pendente (motorista já creditado)',
          details: passengerRefundTrace.error,
          retryable: true,
          driverCredited: true,
          netAmount: netCalculation.netAmount,
          passengerRefund: passengerRefundTrace
        };
      }
      if (passengerRefundTrace.manualReviewRequired && passengerRefundTrace.pendingRecorded !== true) {
        // Sem o registro durável a pendência se perderia: repetir até gravar. A nova
        // execução não chama a Woovi de novo (resolvePassengerRefundAttemptGate).
        return {
          success: false,
          code: 'PASSENGER_REFUND_PENDING_RECORD_FAILED',
          error: 'Estorno parcial do passageiro em revisão manual não pôde ser registrado',
          retryable: true,
          driverCredited: true,
          netAmount: netCalculation.netAmount,
          passengerRefund: passengerRefundTrace
        };
      }

      return {
        success: true,
        ...(passengerRefundTrace.manualReviewRequired
          ? { passengerRefundManualReviewRequired: true }
          : {}),
        message: passengerRefundTrace.manualReviewRequired
          ? 'Distribuição processada; estorno parcial do passageiro aguardando revisão manual'
          : 'Distribuição líquida processada com sucesso',
        netAmount: netCalculation.netAmount,
        netAmountInReais: (netCalculation.netAmount / 100).toFixed(2),
        transferId: transferId || null, // Pode ser null se BaaS não estiver disponível
        balanceCreditId: creditResult.balanceId || rideData.driverId, // ID do crédito no Firestore
        balance: creditResult.newBalance || null, // Novo saldo do motorista
        calculation: netCalculation,
        retainedFees: distributionData.retainedFees,
        passengerRefund: passengerRefundTrace,
        financialContext
      };

    } catch (error) {
      logError(error, 'Erro ao processar distribuição líquida', { service: 'payment-service' });
      return {
        success: false,
        error: 'Erro interno do servidor',
        details: error.message
      };
    }
  }

  /**
   * Processa a distribuição do recebimento de uma taxa de cancelamento ou No-Show para o motorista
   * Garante que não aplica os R$ 1,50 padrão de operação, cobrando apenas o custo Woovi
   * @param {Object} rideData - Dados da corrida cancelada
   * @param {string} rideData.rideId - ID da corrida
   * @param {string} rideData.driverId - ID do motorista
   * @param {number} rideData.cancellationFee - Valor da multa cobrada do passageiro (em centavos)
   * @returns {Promise<Object>} - Resultado da distribuição de No-Show
   */
  async processCancellationDistribution(rideData) {
    try {
      const paymentRecord = await this.getStoredPayment(rideData.rideId, rideData.financialContext || null);
      const contextResult = await this.resolveFinancialContextForPayment({
        rideId: rideData.rideId,
        chargeId: paymentRecord?.chargeId || paymentRecord?.paymentId,
        financialContext: rideData.financialContext || paymentRecord?.financialContext,
        providerEnvironment: rideData.providerEnvironment || paymentRecord?.providerEnvironment
      });
      if (!contextResult.ok) return { success: false, ...contextResult };
      const financialContext = contextResult.context;
      if (!paymentRecord && financialContext.namespace === 'sandbox') {
        return {
          success: false,
          code: 'PAYMENT_RECORD_NOT_FOUND',
          error: 'Pagamento sandbox não encontrado para liquidação de cancelamento'
        };
      }
      logStructured('info', 'Processando distribuição de Multa de Cancelamento/No-Show', {
        service: 'PaymentService',
        rideId: rideData.rideId,
        driverId: rideData.driverId,
        cancellationFee: rideData.cancellationFee
      });

      if (!rideData.cancellationFee || rideData.cancellationFee <= this.WOOVI_FEE_MINIMUM) {
        return {
          success: false,
          error: 'Taxa de cancelamento muito baixa para distribuição'
        };
      }

      // O motorista recebe a taxa menos o custo de transação da Woovi gerado pelo estorno parcial
      const netAmount = rideData.cancellationFee - this.WOOVI_FEE_MINIMUM;

      const cancellationCreditRideId = `cancel_${rideData.rideId}`;
      const plannedBalanceCreditId = this.buildDriverBalanceCreditId(
        rideData.driverId,
        cancellationCreditRideId,
        netAmount
      );
      const ledgerResult = await this.financialLedgerService.recordCancellationSettlement({
        rideId: rideData.rideId,
        driverId: rideData.driverId,
        cancellationFeeCents: rideData.cancellationFee,
        netAmountCents: netAmount,
        wooviFeeCents: this.WOOVI_FEE_MINIMUM,
        financialContext,
        metadata: {
          balanceCreditId: plannedBalanceCreditId
        }
      });

      if (!ledgerResult.success) {
        logStructured('error', 'Falha ao registrar ledger financeiro do cancelamento', {
          service: 'PaymentService',
          rideId: rideData.rideId,
          driverId: rideData.driverId,
          ledgerError: ledgerResult.error || ledgerResult.code
        });
        return {
          success: false,
          error: 'Falha ao registrar ledger financeiro do cancelamento',
          details: ledgerResult.error || ledgerResult.code,
          retryable: true
        };
      }

      // Creditar via Firestore somente após ledger canônico do cancelamento.
      const creditResult = await this.creditDriverBalance(
        rideData.driverId,
        netAmount,
        cancellationCreditRideId,
        financialContext
      );

      if (!creditResult.success) {
        throw new Error(creditResult.error);
      }

      // Atualizar status do holding/distribuir
      const distributionData = {
        rideId: rideData.rideId,
        driverId: rideData.driverId,
        status: 'distributed_cancellation',
        distributedAt: new Date().toISOString(),
        netAmount: netAmount,
        balanceCreditId: creditResult.transactionId || plannedBalanceCreditId,
        ledgerEventId: ledgerResult.eventId || null,
        financialContext,
        financialNamespace: financialContext.namespace,
        financialContextId: financialContext.contextId,
        calculation: {
          totalAmount: rideData.cancellationFee,
          operationalFee: 0,
          wooviFee: this.WOOVI_FEE_MINIMUM,
          netAmount: netAmount
        },
        retainedFees: {
          operationalFee: 0,
          wooviFee: this.WOOVI_FEE_MINIMUM,
          totalRetained: this.WOOVI_FEE_MINIMUM
        }
      };

      await this.saveDistributionToFirestore(distributionData, financialContext);

      logStructured('info', 'Distribuição de multa processada com sucesso', {
        service: 'payment-service',
        rideId: distributionData.rideId,
        netAmount: distributionData.netAmount
      });

      return {
        success: true,
        message: 'Distribuição de multa processada com sucesso',
        netAmount: netAmount,
        balance: creditResult.newBalance
      };

    } catch (error) {
      logError(error, 'Erro ao processar distribuição de cancelamento', { service: 'payment-service' });
      return {
        success: false,
        error: 'Erro interno',
        details: error.message
      };
    }
  }
}

module.exports = PaymentServiceDistributionMethods;
