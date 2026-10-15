// Gerado a partir de services/payment-service.js (divisão mecânica, código idêntico).
// Bypass, normalização de valores, intenção de pagamento antecipado e split Woovi

const {
  firebaseConfig,
  admin,
  crypto,
  FINANCIAL_COLLECTIONS,
  sealFinancialContext,
  resolveFinancialContext,
  getFinancialCollections,
  contextsMatch,
  logStructured,
} = require('./shared');

class PaymentServiceIntentAndSplitMethods {
  isPassengerAllowedForForcedBypass(passengerId) {
    if (this.PAYMENT_FORCE_BYPASS_PASSENGERS.size === 0) {
      return true;
    }

    const normalizedPassengerId = String(passengerId || '').trim();
    if (!normalizedPassengerId) {
      return false;
    }

    return this.PAYMENT_FORCE_BYPASS_PASSENGERS.has(normalizedPassengerId);
  }

  shouldForceBypass(paymentData = {}) {
    if (!this.PAYMENT_FORCE_BYPASS) {
      return false;
    }

    return this.isPassengerAllowedForForcedBypass(paymentData.passengerId);
  }

  resolveAdvanceChargeExpiresInSeconds(paymentIntent = {}) {
    const ttlSeconds = Number.parseInt(paymentIntent.paymentDriverReservationTtlSeconds, 10);
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return null;
    return Math.max(ttlSeconds, this.WOOVI_MIN_CHARGE_EXPIRES_IN_SECONDS);
  }

  buildWooviAdditionalInfo(entries = []) {
    return entries
      .map((entry = {}) => ({
        key: String(entry.key || '').trim(),
        value: String(entry.value ?? '').trim()
      }))
      .filter((entry) => entry.key && entry.value);
  }

  buildBypassAdvancePaymentResult(paymentData = {}, bypassReason = 'forced_bypass') {
    const rideId = paymentData.rideId || `ride_${Date.now()}`;
    const mockChargeId = `mock_review_${rideId}_${Date.now()}`;

    return {
      success: true,
      bypass: true,
      bypassReason,
      message: 'Pagamento em modo review (bypass controlado)',
      chargeId: mockChargeId,
      qrCode: null,
      paymentLink: 'leaf://payment/review-bypass',
      rideId,
      amount: paymentData.amount,
      grossAmountInCents: paymentData.grossAmountInCents || paymentData.amount || null,
      payableAmountInCents: paymentData.payableAmountInCents || paymentData.amount || null,
      discountBenefit: paymentData.discountBenefit || null
    };
  }

  /**
   * Retry logic genérico
   */
  async retryOperation(operation, operationName, maxRetries = this.maxRetries) {
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) {
          const delay = this.retryDelay * attempt; // Backoff exponencial
          logStructured('warn', `Tentativa ${attempt}/${maxRetries} falhou`, {
            service: 'payment',
            operation: operationName,
            attempt,
            maxRetries,
            delay,
            error: error.message
          });
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    logStructured('error', `Falhou após ${maxRetries} tentativas`, {
      service: 'payment',
      operation: operationName,
      maxRetries,
      error: lastError.message
    });
    throw lastError;
  }

  normalizePixKey(value) {
    return String(value || '').trim();
  }

  isWooviSubaccountSplitEnabled() {
    return String(process.env.WOOVI_SUBACCOUNT_SPLIT_ENABLED || 'true').toLowerCase() !== 'false';
  }

  shouldRequireWooviSplitForDriverPayment() {
    return String(process.env.WOOVI_REQUIRE_SUBACCOUNT_SPLIT || 'false').toLowerCase() === 'true';
  }

  isWooviDirectTransferOnRideCompletionEnabled() {
    const requested =
      String(process.env.WOOVI_DIRECT_TRANSFER_ON_RIDE_COMPLETION || 'false').toLowerCase() === 'true';
    const legacyExplicitOptIn =
      String(process.env.ENABLE_LEGACY_RIDE_COMPLETION_PIXOUT || 'false').toLowerCase() === 'true';
    return requested && legacyExplicitOptIn;
  }

  normalizePaymentAmountCents(value) {
    const amountCents = Math.round(Number(value));
    return Number.isFinite(amountCents) ? amountCents : 0;
  }

  normalizeMoneyReais(value) {
    if (value === undefined || value === null || value === '') return null;
    const normalized = typeof value === 'string'
      ? value.replace(/[^\d,.-]/g, '').replace(',', '.')
      : value;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Number(parsed.toFixed(2)));
  }

  resolveTollFeeCents(paymentData = {}) {
    const quoteLockSnapshot = paymentData.quoteLockSnapshot || {};
    const lockedCents = quoteLockSnapshot.tollFeeCents;
    if (Number.isFinite(Number(lockedCents))) {
      return Math.max(0, Math.round(Number(lockedCents)));
    }

    const lockedReais = this.normalizeMoneyReais(
      quoteLockSnapshot.tollFee ??
        quoteLockSnapshot.tollAmount ??
        quoteLockSnapshot.pricingPayload?.toll_fee ??
        quoteLockSnapshot.pricingPayload?.tollFee
    );
    if (lockedReais !== null) {
      return this.toCents(lockedReais);
    }

    if (Number.isFinite(Number(paymentData.tollFeeCents))) {
      return Math.max(0, Math.round(Number(paymentData.tollFeeCents)));
    }

    const incomingReais = this.normalizeMoneyReais(
      paymentData.tollFee ??
        paymentData.rideDetails?.tollFee ??
        paymentData.rideDetails?.tollAmount ??
        paymentData.rideDetails?.pricingPayload?.toll_fee ??
        paymentData.rideDetails?.pricingPayload?.tollFee
    );
    return this.toCents(incomingReais || 0);
  }

  normalizeQuoteVersion(paymentData = {}) {
    const raw =
      paymentData.quoteVersion ||
      paymentData.quote_version ||
      paymentData.rideDetails?.quoteVersion ||
      paymentData.rideDetails?.quote_version ||
      paymentData.rideDetails?.pricingVersion ||
      'v1';
    const normalized = String(raw || '').trim();
    return normalized || 'v1';
  }

  buildAdvancePaymentIntentId(rideId) {
    const hash = crypto
      .createHash('sha256')
      .update(`advance_payment:${rideId || 'unknown-ride'}`)
      .digest('hex')
      .slice(0, 32);
    return `advance_${hash}`;
  }

  resolveAdvancePaymentSession(paymentData = {}) {
    const paymentSessionId = String(paymentData.paymentSessionId || '').trim();
    const suppliedRideId = String(paymentData.rideId || '').trim();
    if (!paymentSessionId) {
      return {
        success: Boolean(suppliedRideId),
        rideId: suppliedRideId,
        paymentSessionId: null,
        paymentContextKey: null,
        quoteSessionId: null,
        code: suppliedRideId ? null : 'PAYMENT_RIDE_REFERENCE_REQUIRED',
        error: suppliedRideId ? null : 'Referência da corrida obrigatória'
      };
    }

    if (!/^[a-zA-Z0-9_-]{12,128}$/.test(paymentSessionId)) {
      return {
        success: false,
        code: 'PAYMENT_SESSION_INVALID',
        error: 'Sessão de pagamento inválida'
      };
    }

    const passengerId = String(paymentData.passengerId || '').trim();
    if (!passengerId) {
      return {
        success: false,
        code: 'PAYMENT_PASSENGER_REQUIRED',
        error: 'Passageiro obrigatório para a sessão de pagamento'
      };
    }

    const hash = crypto
      .createHash('sha256')
      .update(`advance_payment_session:${passengerId}:${paymentSessionId}`)
      .digest('hex')
      .slice(0, 28);

    return {
      success: true,
      rideId: `temp_ride_session_${hash}`,
      paymentSessionId,
      paymentContextKey: String(paymentData.paymentContextKey || '').trim().slice(0, 512) || null,
      quoteSessionId: String(paymentData.quoteSessionId || '').trim().slice(0, 160) || null
    };
  }

  buildAdvanceChargeCorrelationID(paymentData = {}) {
    const rideId = String(paymentData.rideId || '').trim() || 'unknown-ride';
    const quoteVersion = this.normalizeQuoteVersion(paymentData);
    const hash = crypto
      .createHash('sha256')
      .update(`leaf_ride_charge:${rideId}:${quoteVersion}`)
      .digest('hex')
      .slice(0, 24);
    return `leaf_ride_${hash}`;
  }

  buildAdvancePaymentIntentResponse(existing = {}) {
    return {
      success: true,
      idempotentReplay: true,
      message: 'Cobrança Pix já criada para esta corrida',
      chargeId: existing.chargeId || existing.paymentId || null,
      qrCode: existing.qrCode || null,
      qrCodeImage: existing.qrCodeImage || existing.qrCode || null,
      brCode: existing.brCode || existing.qrCodeText || null,
      qrCodeText: existing.qrCodeText || existing.brCode || null,
      paymentLink: existing.paymentLink || null,
      paymentLinkUrl: existing.paymentLinkUrl || existing.paymentLink || null,
      rideId: existing.rideId || null,
      amount: existing.amountCents || existing.amount || null,
      grossAmountInCents: existing.grossAmountInCents || existing.amountCents || existing.amount || null,
      payableAmountInCents: existing.payableAmountInCents || existing.amountCents || existing.amount || null,
      discountBenefit: existing.discountBenefit || null,
      paymentIntentId: existing.paymentIntentId || null,
      correlationID: existing.correlationID || null,
      provider: existing.provider || 'woovi',
      providerEnvironment: existing.providerEnvironment || existing.wooviEnvironment || null,
      paymentProfileId: existing.paymentProfileId || null,
      financialContext: existing.financialContext || null,
      financialNamespace: existing.financialNamespace || existing.financialContext?.namespace || null,
      financialContextId: existing.financialContextId || existing.financialContext?.contextId || null,
      paymentSessionId: existing.paymentSessionId || null,
      paymentContextKey: existing.paymentContextKey || null,
      quoteSessionId: existing.quoteSessionId || null,
      quoteLockId: existing.quoteLockId || null,
      paymentDriverReservationId: existing.paymentDriverReservationId || null,
      paymentDriverReservationDriverId: existing.paymentDriverReservationDriverId || null,
      paymentDriverReservationExpiresAt: existing.paymentDriverReservationExpiresAt || null,
      paymentDriverReservationTtlSeconds: existing.paymentDriverReservationTtlSeconds || null,
      passengerName: existing.passengerName || null,
      customerName: existing.customerName || existing.passengerName || null,
      passengerEmail: existing.passengerEmail || null,
      splitApplied: false,
      splitDeferred: true,
      settlementPolicy: 'post_ride_ledger',
      splitTarget: null,
      splitCalculation: null
    };
  }

  async resolveFinancialContextForPayment(input = {}) {
    const explicitResult = input.financialContext
      ? resolveFinancialContext({
        financialContext: input.financialContext,
        providerEnvironment: input.providerEnvironment,
        testUserSandbox: input.testUserSandbox
      })
      : null;
    if (explicitResult && !explicitResult.ok) return explicitResult;

    let intent = null;
    if (input.chargeId) {
      intent = await this.getAdvancePaymentIntentByChargeId(input.chargeId);
      if (intent?.code && intent.code !== 'PAYMENT_INTENT_LOOKUP_FAILED') {
        return { ok: false, code: intent.code, error: intent.error || 'Payment intent inválida' };
      }
    }
    if ((!intent || !intent.found) && input.rideId) {
      intent = await this.getAdvancePaymentIntent(input.rideId);
    }

    if (intent?.found) {
      const intentResult = resolveFinancialContext(intent, { allowLegacyOperational: true });
      if (!intentResult.ok) return intentResult;
      const legacyOperationalCompatible =
        (intentResult.legacy === true || intent.financialContextLegacy === true) &&
        explicitResult?.context?.namespace === 'operational';
      if (
        explicitResult &&
        !legacyOperationalCompatible &&
        !contextsMatch(explicitResult.context, intentResult.context)
      ) {
        return {
          ok: false,
          code: 'FINANCIAL_CONTEXT_CONFLICT',
          error: 'Contexto financeiro diverge da payment intent'
        };
      }
      return legacyOperationalCompatible ? explicitResult : intentResult;
    }

    if (intent?.code && intent.code !== 'PAYMENT_INTENT_LOOKUP_FAILED') {
      return { ok: false, code: intent.code, error: intent.error || 'Payment intent inválida' };
    }

    if (explicitResult?.context?.namespace === 'sandbox') {
      return {
        ok: false,
        code: 'FINANCIAL_SANDBOX_INTENT_REQUIRED',
        error: 'Payment intent sandbox não encontrada para confirmar o contexto financeiro'
      };
    }
    if (explicitResult) return explicitResult;
    return resolveFinancialContext(input, { allowLegacyOperational: true });
  }

  async beginAdvancePaymentIntent(paymentData = {}, paymentProfile = {}) {
    const firestore = firebaseConfig.getFirestore();
    const financialContext = sealFinancialContext({
      providerEnvironment: paymentProfile.environment || 'production',
      paymentProfileId: paymentProfile.profileId || null,
      paymentProfileSource: paymentProfile.source || null,
      testUserSandbox: paymentProfile.testUserSandbox === true
    });
    const { collections } = getFinancialCollections(financialContext);
    const rideId = String(paymentData.rideId || '').trim();
    const passengerId = String(paymentData.passengerId || '').trim();
    const amountCents = this.normalizePaymentAmountCents(paymentData.amount);
    const grossAmountInCents = paymentData.grossAmountInCents !== undefined && paymentData.grossAmountInCents !== null
      ? this.normalizePaymentAmountCents(paymentData.grossAmountInCents)
      : (paymentData.grossAmount !== undefined && paymentData.grossAmount !== null
        ? this.toCents(paymentData.grossAmount)
        : amountCents);
    const payableAmountInCents = this.normalizePaymentAmountCents(
      paymentData.payableAmountInCents || amountCents
    );
    const quoteVersion = this.normalizeQuoteVersion(paymentData);
    const paymentSessionId = String(paymentData.paymentSessionId || '').trim() || null;
    const paymentContextKey = String(paymentData.paymentContextKey || '').trim() || null;
    const quoteSessionId = String(paymentData.quoteSessionId || '').trim() || null;
    const quoteLockId = String(
      paymentData.quoteLockId ||
      paymentData.quote_lock_id ||
      paymentData.rideDetails?.quoteLockId ||
      ''
    ).trim() || null;
    const paymentDriverReservationId = String(paymentData.paymentDriverReservationId || '').trim() || null;
    const paymentDriverReservationDriverId = String(paymentData.paymentDriverReservationDriverId || '').trim() || null;
    const paymentDriverReservationExpiresAt = String(paymentData.paymentDriverReservationExpiresAt || '').trim() || null;
    const paymentDriverReservationTtlSeconds = Number.parseInt(
      paymentData.paymentDriverReservationTtlSeconds ||
      process.env.PAYMENT_DRIVER_RESERVATION_TTL_SECONDS ||
      String(this.WOOVI_MIN_CHARGE_EXPIRES_IN_SECONDS),
      10
    ) || null;
    const passengerName = String(
      paymentData.passengerName ||
      paymentData.customerName ||
      ''
    ).trim() || null;
    const customerName = String(
      paymentData.customerName ||
      paymentData.passengerName ||
      ''
    ).trim() || null;
    const passengerEmail = String(paymentData.passengerEmail || '').trim() || null;
    const paymentIntentId = this.buildAdvancePaymentIntentId(rideId);
    const correlationID = this.buildAdvanceChargeCorrelationID(paymentData);
    const nowIso = new Date().toISOString();
    const inProgressTtlMs = Math.max(
      15,
      Number.parseInt(process.env.PAYMENT_INTENT_IN_PROGRESS_TTL_SECONDS || '120', 10) || 120
    ) * 1000;

    if (!firestore) {
      if (this.productionRuntime || financialContext.namespace === 'sandbox') {
        return {
          success: false,
          code: 'PAYMENT_INTENT_STORE_UNAVAILABLE',
          error: 'Não foi possível registrar a intenção de pagamento com segurança',
          paymentIntentId,
          correlationID
        };
      }

      return {
        success: true,
        firestoreAvailable: false,
        paymentIntentId,
        correlationID,
        amountCents,
        provider: 'woovi',
        providerEnvironment: paymentProfile.environment || 'production',
        paymentProfileId: paymentProfile.profileId || null,
        paymentProfileSource: paymentProfile.source || null,
        financialContext,
        financialNamespace: financialContext.namespace,
        financialContextId: financialContext.contextId,
        paymentSessionId,
        paymentContextKey,
        quoteSessionId,
        quoteLockId,
        paymentDriverReservationId,
        paymentDriverReservationDriverId,
        paymentDriverReservationExpiresAt,
        paymentDriverReservationTtlSeconds,
        passengerName,
        customerName,
        passengerEmail,
        quoteVersion
      };
    }

    const intentRef = firestore.collection(collections.paymentIntents).doc(paymentIntentId);

    try {
      return await firestore.runTransaction(async (transaction) => {
        const intentDoc = await transaction.get(intentRef);
        if (intentDoc.exists) {
          const existing = intentDoc.data() || {};
          const existingAmountCents = this.normalizePaymentAmountCents(existing.amountCents || existing.amount);
          const existingPassengerId = String(existing.passengerId || '').trim();
          const existingRideId = String(existing.rideId || '').trim();
          const existingProviderEnvironment = String(existing.providerEnvironment || '').trim().toLowerCase();
          const incomingProviderEnvironment = String(paymentProfile.environment || '').trim().toLowerCase();
          const existingPaymentSessionId = String(existing.paymentSessionId || '').trim();
          const existingPaymentContextKey = String(existing.paymentContextKey || '').trim();
          const existingQuoteLockId = String(existing.quoteLockId || '').trim();
          const existingPaymentDriverReservationId = String(existing.paymentDriverReservationId || '').trim();
          const existingContextResult = resolveFinancialContext(existing, { allowLegacyOperational: true });
          const legacyOperationalCompatible =
            existingContextResult.ok &&
            existingContextResult.legacy === true &&
            financialContext.namespace === 'operational';

          if (
            !existingContextResult.ok ||
            (!legacyOperationalCompatible && !contextsMatch(existingContextResult.context, financialContext)) ||
            existingRideId !== rideId ||
            existingAmountCents !== amountCents ||
            (existingPassengerId && existingPassengerId !== passengerId) ||
            (existingPaymentSessionId && paymentSessionId && existingPaymentSessionId !== paymentSessionId) ||
            (existingPaymentContextKey && paymentContextKey && existingPaymentContextKey !== paymentContextKey) ||
            (existingQuoteLockId && quoteLockId && existingQuoteLockId !== quoteLockId) ||
            (existingPaymentDriverReservationId && paymentDriverReservationId && existingPaymentDriverReservationId !== paymentDriverReservationId) ||
            (existingProviderEnvironment && incomingProviderEnvironment && existingProviderEnvironment !== incomingProviderEnvironment)
          ) {
            return {
              success: false,
              code: 'PAYMENT_INTENT_CONFLICT',
              error: 'Já existe uma cobrança para esta corrida com dados diferentes',
              paymentIntentId,
              existingAmountCents,
              incomingAmountCents: amountCents,
              existingQuoteLockId: existingQuoteLockId || null,
              incomingQuoteLockId: quoteLockId || null,
              existingPaymentDriverReservationId: existingPaymentDriverReservationId || null,
              incomingPaymentDriverReservationId: paymentDriverReservationId || null,
              existingProviderEnvironment: existingProviderEnvironment || null,
              incomingProviderEnvironment: incomingProviderEnvironment || null
            };
          }

          if (existing.status === 'consumed') {
            return {
              success: false,
              code: 'PAYMENT_SESSION_CONSUMED',
              error: 'Este pagamento já está vinculado a uma corrida',
              paymentIntentId,
              bookingId: existing.bookingId || null,
              chargeId: existing.chargeId || null
            };
          }

          if (existing.status === 'charge_created' && existing.chargeId) {
            return {
              success: true,
              firestoreAvailable: true,
              idempotentReplay: true,
              existing,
              paymentIntentId,
              correlationID: existing.correlationID || correlationID,
              amountCents,
              grossAmountInCents: existing.grossAmountInCents || grossAmountInCents,
              payableAmountInCents: existing.payableAmountInCents || payableAmountInCents,
              discountBenefit: existing.discountBenefit || paymentData.discountBenefit || null,
              provider: existing.provider || 'woovi',
              providerEnvironment: existing.providerEnvironment || paymentProfile.environment || null,
              paymentProfileId: existing.paymentProfileId || paymentProfile.profileId || null,
              paymentProfileSource: existing.paymentProfileSource || paymentProfile.source || null,
              financialContext: existingContextResult.context,
              financialNamespace: existingContextResult.context.namespace,
              financialContextId: existingContextResult.context.contextId,
              quoteLockId: existing.quoteLockId || quoteLockId || null,
              paymentDriverReservationId: existing.paymentDriverReservationId || paymentDriverReservationId || null,
              paymentDriverReservationDriverId: existing.paymentDriverReservationDriverId || paymentDriverReservationDriverId || null,
              paymentDriverReservationExpiresAt: existing.paymentDriverReservationExpiresAt || paymentDriverReservationExpiresAt || null,
              paymentDriverReservationTtlSeconds: existing.paymentDriverReservationTtlSeconds || paymentDriverReservationTtlSeconds || null,
              passengerName: existing.passengerName || passengerName || null,
              customerName: existing.customerName || customerName || null,
              passengerEmail: existing.passengerEmail || passengerEmail || null,
              quoteVersion
            };
          }

          const lastAttemptMs = Date.parse(existing.lastAttemptAtIso || existing.updatedAtIso || '');
          const stillInProgress =
            existing.status === 'creating_charge' &&
            Number.isFinite(lastAttemptMs) &&
            Date.now() - lastAttemptMs < inProgressTtlMs;

          if (stillInProgress) {
            return {
              success: false,
              code: 'PAYMENT_INTENT_IN_PROGRESS',
              error: 'A cobrança Pix desta corrida ainda está sendo criada',
              paymentIntentId
            };
          }
        }

        const intentPayload = {
          paymentIntentId,
          rideId,
          passengerId,
          amountCents,
          grossAmountInCents,
          payableAmountInCents,
          discountBenefit: paymentData.discountBenefit || null,
          paymentSessionId,
          paymentContextKey,
          quoteSessionId,
          quoteLockId,
          quoteLockSnapshot: paymentData.quoteLockSnapshot || null,
          paymentDriverReservationId,
          paymentDriverReservationDriverId,
          paymentDriverReservationExpiresAt,
          paymentDriverReservationTtlSeconds,
          passengerName,
          customerName,
          passengerEmail,
          quoteVersion,
          correlationID,
          status: 'creating_charge',
          provider: 'woovi',
          providerEnvironment: paymentProfile.environment || 'production',
          paymentProfileId: paymentProfile.profileId || null,
          paymentProfileSource: paymentProfile.source || null,
          paymentProfileReason: paymentProfile.reason || null,
          financialContext,
          financialNamespace: financialContext.namespace,
          financialContextId: financialContext.contextId,
          settlementPolicy: 'post_ride_ledger',
          driverSettlement: 'deferred_until_ride_completed',
          lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
          lastAttemptAtIso: nowIso,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtIso: nowIso
        };

        if (!intentDoc.exists) {
          intentPayload.createdAt = admin.firestore.FieldValue.serverTimestamp();
          intentPayload.createdAtIso = nowIso;
        }

        transaction.set(intentRef, intentPayload, { merge: true });

        return {
          success: true,
          firestoreAvailable: true,
          paymentIntentId,
          correlationID,
          amountCents,
          grossAmountInCents,
          payableAmountInCents,
          discountBenefit: paymentData.discountBenefit || null,
          paymentSessionId,
          paymentContextKey,
          quoteSessionId,
          quoteLockId,
          paymentDriverReservationId,
          paymentDriverReservationDriverId,
          paymentDriverReservationExpiresAt,
          paymentDriverReservationTtlSeconds,
          passengerName,
          customerName,
          passengerEmail,
          provider: 'woovi',
          providerEnvironment: paymentProfile.environment || 'production',
          paymentProfileId: paymentProfile.profileId || null,
          paymentProfileSource: paymentProfile.source || null,
          paymentProfileReason: paymentProfile.reason || null,
          financialContext,
          financialNamespace: financialContext.namespace,
          financialContextId: financialContext.contextId,
          quoteVersion
        };
      });
    } catch (error) {
      if (this.productionRuntime) {
        return {
          success: false,
          code: 'PAYMENT_INTENT_STORE_UNAVAILABLE',
          error: 'Não foi possível registrar a intenção de pagamento com segurança',
          paymentIntentId,
          correlationID,
          details: error.message
        };
      }

      logStructured('warn', 'Falha ao iniciar payment intent; seguindo com correlationID determinístico', {
        service: 'PaymentService',
        rideId,
        paymentIntentId,
        error: error.message
      });
      return {
        success: true,
        firestoreAvailable: false,
        paymentIntentId,
        correlationID,
        amountCents,
        grossAmountInCents,
        payableAmountInCents,
        discountBenefit: paymentData.discountBenefit || null,
        provider: 'woovi',
        providerEnvironment: paymentProfile.environment || 'production',
        paymentProfileId: paymentProfile.profileId || null,
        paymentProfileSource: paymentProfile.source || null,
        paymentProfileReason: paymentProfile.reason || null,
        financialContext,
        financialNamespace: financialContext.namespace,
        financialContextId: financialContext.contextId,
        paymentSessionId,
        paymentContextKey,
        quoteSessionId,
        quoteLockId,
        paymentDriverReservationId,
        paymentDriverReservationDriverId,
        paymentDriverReservationExpiresAt,
        paymentDriverReservationTtlSeconds,
        passengerName,
        customerName,
        passengerEmail,
        quoteVersion,
        intentPersistenceError: error.message
      };
    }
  }

  async markAdvancePaymentIntentFailed(intent = {}, errorPayload = {}) {
    if (!intent.firestoreAvailable || !intent.paymentIntentId) {
      return false;
    }

    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) return false;
      const contextResult = resolveFinancialContext(intent, { allowLegacyOperational: true });
      if (!contextResult.ok) return false;
      const { collections } = getFinancialCollections(contextResult.context);
      await firestore.collection(collections.paymentIntents).doc(intent.paymentIntentId).set({
        status: 'charge_failed',
        error: errorPayload?.message || errorPayload?.error || errorPayload || 'Falha ao criar cobrança',
        errorPayload,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtIso: new Date().toISOString()
      }, { merge: true });
      return true;
    } catch (error) {
      logStructured('warn', 'Falha ao persistir erro da payment intent', {
        service: 'PaymentService',
        paymentIntentId: intent.paymentIntentId,
        error: error.message
      });
      return false;
    }
  }

  async completeAdvancePaymentIntent(intent = {}, chargeData = {}) {
    if (!intent.firestoreAvailable || !intent.paymentIntentId) {
      return false;
    }

    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) return false;
      const contextResult = resolveFinancialContext(intent, { allowLegacyOperational: true });
      if (!contextResult.ok) return false;
      const { collections } = getFinancialCollections(contextResult.context);
      const chargeCreatedAtIso = chargeData.chargeCreatedAtIso || new Date().toISOString();
      const chargeExpiresInSeconds = Number.parseInt(chargeData.chargeExpiresInSeconds, 10);
      const chargeExpiresAtIso = chargeData.chargeExpiresAtIso || (
        Number.isFinite(chargeExpiresInSeconds) && chargeExpiresInSeconds > 0
          ? new Date(Date.parse(chargeCreatedAtIso) + chargeExpiresInSeconds * 1000).toISOString()
          : null
      );
      await this.retryOperation(
        async () => {
          await firestore.collection(collections.paymentIntents).doc(intent.paymentIntentId).set({
            status: 'charge_created',
            chargeId: chargeData.chargeId || null,
            qrCode: chargeData.qrCode || null,
            qrCodeImage: chargeData.qrCodeImage || chargeData.qrCode || null,
            brCode: chargeData.brCode || chargeData.qrCodeText || null,
            qrCodeText: chargeData.qrCodeText || chargeData.brCode || null,
            paymentLink: chargeData.paymentLink || null,
            paymentLinkUrl: chargeData.paymentLinkUrl || chargeData.paymentLink || null,
            provider: intent.provider || 'woovi',
            providerEnvironment: intent.providerEnvironment || null,
            paymentProfileId: intent.paymentProfileId || null,
            paymentProfileSource: intent.paymentProfileSource || null,
            paymentProfileReason: intent.paymentProfileReason || null,
            financialContext: contextResult.context,
            financialNamespace: contextResult.context.namespace,
            financialContextId: contextResult.context.contextId,
            chargeCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
            chargeCreatedAtIso,
            chargeExpiresInSeconds: Number.isFinite(chargeExpiresInSeconds) && chargeExpiresInSeconds > 0
              ? chargeExpiresInSeconds
              : null,
            chargeExpiresAtIso,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtIso: chargeCreatedAtIso
          }, { merge: true });
        },
        'completeAdvancePaymentIntent'
      );
      return true;
    } catch (error) {
      logStructured('error', 'Falha ao persistir cobrança criada na payment intent', {
        service: 'PaymentService',
        paymentIntentId: intent.paymentIntentId,
        chargeId: chargeData.chargeId || null,
        error: error.message
      });
      return false;
    }
  }

  async markAdvancePaymentIntentConsumed({ rideId, bookingId, chargeId } = {}) {
    const safeRideId = String(rideId || '').trim();
    const safeBookingId = String(bookingId || '').trim();
    if (!safeRideId || !safeBookingId) return false;

    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) return false;
      const paymentIntentId = this.buildAdvancePaymentIntentId(safeRideId);
      const resolvedIntent = await this.getAdvancePaymentIntent(safeRideId);
      if (!resolvedIntent.found || !resolvedIntent.financialContext) return false;
      const { collections } = getFinancialCollections(resolvedIntent.financialContext);
      const intentRef = firestore.collection(collections.paymentIntents).doc(paymentIntentId);
      const safeChargeId = String(chargeId || '').trim();
      return await firestore.runTransaction(async (transaction) => {
        const intentDoc = await transaction.get(intentRef);
        if (!intentDoc.exists) return false;

        const existing = intentDoc.data() || {};
        const existingStatus = String(existing.status || '').trim().toLowerCase();
        const existingBookingId = String(existing.bookingId || existing.canonicalRideId || '').trim();
        const existingChargeId = String(existing.chargeId || existing.consumedChargeId || '').trim();

        if (existingStatus === 'consumed' && existingBookingId && existingBookingId !== safeBookingId) {
          logStructured('warn', 'Payment intent já consumida por outro booking', {
            service: 'PaymentService',
            paymentIntentId,
            bookingId: safeBookingId,
            existingBookingId
          });
          return false;
        }

        if (existingChargeId && safeChargeId && existingChargeId !== safeChargeId) {
          logStructured('warn', 'Payment intent não consumida por divergência de chargeId', {
            service: 'PaymentService',
            paymentIntentId,
            bookingId: safeBookingId,
            existingChargeId,
            incomingChargeId: safeChargeId
          });
          return false;
        }

        const nowIso = new Date().toISOString();
        transaction.set(intentRef, {
          status: 'consumed',
          bookingId: safeBookingId,
          canonicalRideId: safeBookingId,
          consumedChargeId: safeChargeId || existingChargeId || null,
          consumedAt: admin.firestore.FieldValue.serverTimestamp(),
          consumedAtIso: nowIso,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtIso: nowIso
        }, { merge: true });
        return true;
      });
    } catch (error) {
      logStructured('warn', 'Falha ao marcar payment intent como consumida', {
        service: 'PaymentService',
        rideId: safeRideId,
        bookingId: safeBookingId,
        error: error.message
      });
      return false;
    }
  }

  async getAdvancePaymentIntent(rideId) {
    const safeRideId = String(rideId || '').trim();
    if (!safeRideId) return { found: false };

    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        return {
          found: false,
          unavailable: true,
          code: 'PAYMENT_INTENT_STORE_UNAVAILABLE'
        };
      }
      const paymentIntentId = this.buildAdvancePaymentIntentId(safeRideId);
      const matches = [];
      for (const namespace of ['operational', 'sandbox']) {
        const collectionName = FINANCIAL_COLLECTIONS[namespace].paymentIntents;
        const intentDoc = await firestore.collection(collectionName).doc(paymentIntentId).get();
        if (intentDoc.exists) matches.push({ namespace, intentDoc });
      }
      if (matches.length === 0) return { found: false, paymentIntentId };
      if (matches.length > 1) {
        return {
          found: false,
          code: 'PAYMENT_INTENT_NAMESPACE_CONFLICT',
          error: 'Payment intent existe em mais de um namespace financeiro',
          paymentIntentId
        };
      }
      const [{ intentDoc }] = matches;
      const data = intentDoc.data() || {};
      const contextResult = resolveFinancialContext(data, { allowLegacyOperational: true });
      if (!contextResult.ok) return { found: false, paymentIntentId, ...contextResult };
      return {
        found: true,
        paymentIntentId,
        ...data,
        financialContext: contextResult.context,
        financialNamespace: contextResult.context.namespace,
        financialContextId: contextResult.context.contextId,
        financialContextLegacy: contextResult.legacy === true
      };
    } catch (error) {
      logStructured('warn', 'Falha ao consultar payment intent', {
        service: 'PaymentService',
        rideId: safeRideId,
        error: error.message
      });
      return {
        found: false,
        unavailable: true,
        code: 'PAYMENT_INTENT_LOOKUP_FAILED'
      };
    }
  }

  async getAdvancePaymentIntentByChargeId(chargeId) {
    const safeChargeId = String(chargeId || '').trim();
    if (!safeChargeId) return { found: false };

    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        return {
          found: false,
          unavailable: true,
          code: 'PAYMENT_INTENT_STORE_UNAVAILABLE'
        };
      }

      // Consultas independentes por namespace: em paralelo, preservando a ordem dos resultados.
      const snapshots = await Promise.all(['operational', 'sandbox'].map((namespace) => firestore
        .collection(FINANCIAL_COLLECTIONS[namespace].paymentIntents)
        .where('chargeId', '==', safeChargeId)
        .limit(1)
        .get()));
      const matches = [];
      for (const snapshot of snapshots) {
        if (!snapshot.empty && snapshot.docs?.length) matches.push(snapshot.docs[0]);
      }
      if (matches.length === 0) return { found: false };
      if (matches.length > 1) {
        return {
          found: false,
          code: 'PAYMENT_INTENT_NAMESPACE_CONFLICT',
          error: 'Cobrança existe em mais de um namespace financeiro'
        };
      }
      const doc = matches[0];
      const data = doc.data() || {};
      const contextResult = resolveFinancialContext(data, { allowLegacyOperational: true });
      if (!contextResult.ok) return { found: false, ...contextResult };
      return {
        found: true,
        paymentIntentId: data.paymentIntentId || doc.id,
        ...data,
        financialContext: contextResult.context,
        financialNamespace: contextResult.context.namespace,
        financialContextId: contextResult.context.contextId,
        financialContextLegacy: contextResult.legacy === true
      };
    } catch (error) {
      logStructured('warn', 'Falha ao consultar payment intent por chargeId', {
        service: 'PaymentService',
        chargeId: safeChargeId,
        error: error.message
      });
      return {
        found: false,
        unavailable: true,
        code: 'PAYMENT_INTENT_LOOKUP_FAILED'
      };
    }
  }

  async resolveDriverSplitTarget(paymentData = {}) {
    const directPixKey = this.normalizePixKey(
      paymentData.driverSubaccountPixKey ||
      paymentData.wooviSubaccountPixKey ||
      paymentData.subaccountPixKey ||
      paymentData.driverPixKey
    );

    if (directPixKey) {
      return {
        success: true,
        source: 'payment_payload',
        driverId: paymentData.driverId || null,
        pixKey: directPixKey
      };
    }

    const driverId = this.normalizePixKey(paymentData.driverId);
    if (!driverId) {
      return {
        success: false,
        reason: 'driver_not_known'
      };
    }

    try {
      const DriverApprovalService = require('../driver-approval-service');
      const driverApprovalService = new DriverApprovalService();
      const accountData = await driverApprovalService.getDriverWooviAccountId(driverId);
      const pixKey = this.normalizePixKey(
        accountData?.wooviSubaccountPixKey ||
        accountData?.subaccountPixKey ||
        accountData?.pixKey ||
        accountData?.driverPixKey
      );

      if (!pixKey) {
        return {
          success: false,
          reason: 'driver_subaccount_pix_key_missing',
          driverId
        };
      }

      return {
        success: true,
        source: 'driver_account',
        driverId,
        pixKey,
        accountData
      };
    } catch (error) {
      logStructured('warn', 'Falha ao resolver subconta Woovi do motorista', {
        service: 'PaymentService',
        driverId,
        error: error.message
      });
      return {
        success: false,
        reason: 'driver_account_lookup_failed',
        driverId,
        error: error.message
      };
    }
  }

  async buildWooviSubaccountSplitPlan(paymentData = {}, totalAmountCents = 0) {
    if (!this.isWooviSubaccountSplitEnabled()) {
      return {
        success: false,
        reason: 'split_disabled'
      };
    }

    const target = await this.resolveDriverSplitTarget(paymentData);
    if (!target.success) {
      return target;
    }

    const tollFeeCents = this.resolveTollFeeCents(paymentData);
    const calculation = this.calculateNetAmount(totalAmountCents, tollFeeCents);

    if (!calculation.netAmount || calculation.netAmount <= 0) {
      return {
        success: false,
        reason: 'driver_net_amount_not_positive',
        driverId: target.driverId,
        calculation
      };
    }

    return {
      success: true,
      target,
      calculation,
      splits: [
        {
          pixKey: target.pixKey,
          value: calculation.netAmount,
          splitType: 'SPLIT_SUB_ACCOUNT'
        }
      ]
    };
  }
}

module.exports = PaymentServiceIntentAndSplitMethods;
