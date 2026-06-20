const WooviDriverService = require('./woovi-driver-service');
const firebaseConfig = require('../firebase-config');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { getWooviConfig } = require('../config/woovi-config');
const circuitBreakerService = require('./circuit-breaker-service');
const subscriptionStateService = require('./subscription-state-service');
const FinancialLedgerService = require('./financial-ledger-service');
const { buildRideFinancialContract } = require('./ride-financial-contract');
const paymentRuntimeProfileService = require('./payment-runtime-profile-service');
const { logStructured, logError } = require('../utils/logger');
const traceContext = require('../utils/trace-context');
const redisPool = require('../utils/redis-pool');

class PaymentService {
  constructor() {
    const appReviewMode = String(process.env.APP_REVIEW || '').toLowerCase() === 'true';
    const productionRuntime = [
      process.env.NODE_ENV,
      process.env.APP_ENV,
      process.env.LEAF_ENV,
      process.env.ENVIRONMENT
    ].some((value) => ['production', 'prod'].includes(String(value || '').toLowerCase()));
    this.productionRuntime = productionRuntime;
    this.LEAF_ACCOUNT_ID = process.env.LEAF_WOOVI_ACCOUNT_ID || 'leaf-main-account';
    // Chave Pix da conta Leaf (origem das transferências)
    // ⚠️ ATENÇÃO: Configurar LEAF_PIX_KEY em produção via variável de ambiente
    this.LEAF_PIX_KEY = process.env.LEAF_PIX_KEY || 'test@leaf.app.br'; // ⚠️ Valor de teste - configurar em produção
    // Criar instância do WooviDriverService
    this.wooviDriverService = new WooviDriverService();
    this.paymentRuntimeProfileService = paymentRuntimeProfileService;
    this.financialLedgerService = new FinancialLedgerService();
    // Taxas operacionais por faixa de valor (regra vigente)
    this.OPERATIONAL_FEE_UP_TO_10 = 79; // R$ 0,79 para corridas até R$ 10,00 (em centavos)
    this.OPERATIONAL_FEE_10_TO_25 = 99; // R$ 0,99 para corridas acima de R$ 10,00 até R$ 25,00 (em centavos)
    this.OPERATIONAL_FEE_25_TO_50 = 149; // R$ 1,49 para corridas acima de R$ 25,00 até R$ 50,00 (em centavos)
    this.OPERATIONAL_FEE_ABOVE_50_PERCENTAGE = 0.03; // 3% para corridas acima de R$ 50,00
    this.THRESHOLD_10 = 1000; // R$ 10,00 em centavos
    this.THRESHOLD_25 = 2500; // R$ 25,00 em centavos
    this.THRESHOLD_50 = 5000; // R$ 50,00 em centavos
    this.WOOVI_FEE_PERCENTAGE = 0.008; // 0,8% da transação
    this.WOOVI_FEE_MINIMUM = 50; // R$ 0,50 mínimo (em centavos)
    this.WITHDRAW_FEE_THRESHOLD_CENTS = 50000; // R$ 500,00
    this.WITHDRAW_FEE_BELOW_THRESHOLD_CENTS = 100; // R$ 1,00
    this.SUBSCRIPTION_DAILY_BILLING_ENABLED =
      String(process.env.SUBSCRIPTION_DAILY_BILLING_ENABLED || 'false').toLowerCase() === 'true';
    this.SUBSCRIPTION_DAILY_FEE_NOMINAL_CENTS = Math.max(
      0,
      Number.parseInt(
        process.env.SUBSCRIPTION_DAILY_FEE_NOMINAL_CENTS ||
        process.env.SUBSCRIPTION_DAILY_MAX_FEE_CENTS ||
        '1490',
        10
      ) || 1490
    );
    this.SUBSCRIPTION_SETTLE_ON_WITHDRAW =
      String(process.env.SUBSCRIPTION_SETTLE_ON_WITHDRAW || 'true').toLowerCase() !== 'false';
    this.SUBSCRIPTION_SPLIT_RETENTION_ENABLED =
      String(process.env.SUBSCRIPTION_SPLIT_RETENTION_ENABLED || 'false').toLowerCase() === 'true';
    this.PAYMENT_BYPASS_ON_WOOVI_FAILURE =
      appReviewMode ||
      (!productionRuntime && String(process.env.PAYMENT_BYPASS_ON_WOOVI_FAILURE || '').toLowerCase() === 'true');
    this.PAYMENT_FORCE_BYPASS =
      appReviewMode ||
      (!productionRuntime && String(process.env.PAYMENT_FORCE_BYPASS || '').toLowerCase() === 'true');
    const bypassPassengersRaw =
      process.env.PAYMENT_FORCE_BYPASS_PASSENGERS ||
      process.env.PAYMENT_FORCE_BYPASS_USER_IDS ||
      '';
    this.PAYMENT_FORCE_BYPASS_PASSENGERS = new Set(
      String(bypassPassengersRaw)
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    );

    // Configuração de retry
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 segundo
    this.PAYMENT_STATUS_CACHE_TTL_SECONDS = Number.parseInt(
      process.env.PAYMENT_STATUS_CACHE_TTL_SECONDS || '900',
      10
    );

    // Estados válidos de payment holding
    this.PAYMENT_STATES = {
      PENDING: 'pending',
      IN_HOLDING: 'in_holding',
      DISTRIBUTED: 'distributed',
      REFUNDED: 'refunded',
      CANCELLED: 'cancelled'
    };

    // Transições de estado válidas
    this.VALID_TRANSITIONS = {
      [this.PAYMENT_STATES.PENDING]: [this.PAYMENT_STATES.IN_HOLDING, this.PAYMENT_STATES.CANCELLED],
      [this.PAYMENT_STATES.IN_HOLDING]: [this.PAYMENT_STATES.DISTRIBUTED, this.PAYMENT_STATES.REFUNDED, this.PAYMENT_STATES.CANCELLED],
      [this.PAYMENT_STATES.DISTRIBUTED]: [], // Estado final
      [this.PAYMENT_STATES.REFUNDED]: [], // Estado final
      [this.PAYMENT_STATES.CANCELLED]: [] // Estado final
    };
  }

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
      paymentLink: existing.paymentLink || null,
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
      paymentSessionId: existing.paymentSessionId || null,
      paymentContextKey: existing.paymentContextKey || null,
      quoteSessionId: existing.quoteSessionId || null,
      splitApplied: false,
      splitDeferred: true,
      settlementPolicy: 'post_ride_ledger',
      splitTarget: null,
      splitCalculation: null
    };
  }

  async beginAdvancePaymentIntent(paymentData = {}, paymentProfile = {}) {
    const firestore = firebaseConfig.getFirestore();
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
    const paymentIntentId = this.buildAdvancePaymentIntentId(rideId);
    const correlationID = this.buildAdvanceChargeCorrelationID(paymentData);
    const nowIso = new Date().toISOString();
    const inProgressTtlMs = Math.max(
      15,
      Number.parseInt(process.env.PAYMENT_INTENT_IN_PROGRESS_TTL_SECONDS || '120', 10) || 120
    ) * 1000;

    if (!firestore) {
      if (this.productionRuntime) {
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
        paymentSessionId,
        paymentContextKey,
        quoteSessionId,
        quoteVersion
      };
    }

    const intentRef = firestore.collection('payment_intents').doc(paymentIntentId);

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

          if (
            existingRideId !== rideId ||
            existingAmountCents !== amountCents ||
            (existingPassengerId && existingPassengerId !== passengerId) ||
            (existingPaymentSessionId && paymentSessionId && existingPaymentSessionId !== paymentSessionId) ||
            (existingPaymentContextKey && paymentContextKey && existingPaymentContextKey !== paymentContextKey) ||
            (existingProviderEnvironment && incomingProviderEnvironment && existingProviderEnvironment !== incomingProviderEnvironment)
          ) {
            return {
              success: false,
              code: 'PAYMENT_INTENT_CONFLICT',
              error: 'Já existe uma cobrança para esta corrida com dados diferentes',
              paymentIntentId,
              existingAmountCents,
              incomingAmountCents: amountCents,
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
          quoteVersion,
          correlationID,
          status: 'creating_charge',
          provider: 'woovi',
          providerEnvironment: paymentProfile.environment || 'production',
          paymentProfileId: paymentProfile.profileId || null,
          paymentProfileSource: paymentProfile.source || null,
          paymentProfileReason: paymentProfile.reason || null,
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
          provider: 'woovi',
          providerEnvironment: paymentProfile.environment || 'production',
          paymentProfileId: paymentProfile.profileId || null,
          paymentProfileSource: paymentProfile.source || null,
          paymentProfileReason: paymentProfile.reason || null,
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
        paymentSessionId,
        paymentContextKey,
        quoteSessionId,
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
      await firestore.collection('payment_intents').doc(intent.paymentIntentId).set({
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
      await this.retryOperation(
        async () => {
          await firestore.collection('payment_intents').doc(intent.paymentIntentId).set({
            status: 'charge_created',
            chargeId: chargeData.chargeId || null,
            qrCode: chargeData.qrCode || null,
            paymentLink: chargeData.paymentLink || null,
            provider: intent.provider || 'woovi',
            providerEnvironment: intent.providerEnvironment || null,
            paymentProfileId: intent.paymentProfileId || null,
            paymentProfileSource: intent.paymentProfileSource || null,
            paymentProfileReason: intent.paymentProfileReason || null,
            chargeCreatedAt: admin.firestore.FieldValue.serverTimestamp(),
            chargeCreatedAtIso: new Date().toISOString(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtIso: new Date().toISOString()
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
      const intentRef = firestore.collection('payment_intents').doc(paymentIntentId);
      const intentDoc = await intentRef.get();
      if (!intentDoc.exists) return false;

      const existing = intentDoc.data() || {};
      const existingChargeId = String(existing.chargeId || '').trim();
      const safeChargeId = String(chargeId || '').trim();
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
      await intentRef.set({
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
      const intentDoc = await firestore.collection('payment_intents').doc(paymentIntentId).get();
      if (!intentDoc.exists) return { found: false, paymentIntentId };
      return {
        found: true,
        paymentIntentId,
        ...(intentDoc.data() || {})
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
      const DriverApprovalService = require('./driver-approval-service');
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

    const tollFeeCents = Number.isFinite(Number(paymentData.tollFeeCents))
      ? Math.max(0, Math.round(Number(paymentData.tollFeeCents)))
      : this.toCents(paymentData.tollFee || paymentData.rideDetails?.tollFee || 0);
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

  /**
   * Valida se uma transição de estado é válida
   * @param {string} currentStatus - Estado atual
   * @param {string} newStatus - Novo estado
   * @returns {boolean} - true se transição é válida
   */
  isValidStateTransition(currentStatus, newStatus) {
    if (!currentStatus || !newStatus) {
      return false;
    }

    const validNextStates = this.VALID_TRANSITIONS[currentStatus];
    if (!validNextStates) {
      return false;
    }

    return validNextStates.includes(newStatus);
  }

  /**
   * Salva evento no histórico de pagamentos
   * @param {string} rideId - ID da corrida
   * @param {string} eventType - Tipo do evento (confirmed, distributed, refunded, cancelled)
   * @param {Object} eventData - Dados do evento
   * @returns {Promise<boolean>} - true se salvo com sucesso
   */
  async savePaymentEvent(rideId, eventType, eventData = {}) {
    try {
      const firestore = firebaseConfig.getFirestore();

      if (!firestore) {
        logStructured('warn', 'Firestore não disponível para salvar evento de pagamento', {
          service: 'payment',
          operation: 'savePaymentEvent',
          rideId,
          eventType
        });
        return false;
      }

      const eventRef = firestore.collection('payment_history').doc();

      const eventPayload = {
        rideId: rideId,
        eventType: eventType, // confirmed, distributed, refunded, cancelled
        status: eventData.status || null,
        amount: eventData.amount || null,
        amountInReais: eventData.amount ? (eventData.amount / 100) : null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        actor: eventData.actor || 'system', // system, passenger, driver, admin
        actorId: eventData.actorId || null,
        metadata: {
          previousStatus: eventData.previousStatus || null,
          newStatus: eventData.newStatus || null,
          reason: eventData.reason || null,
          chargeId: eventData.chargeId || null,
          paymentId: eventData.paymentId || null,
          driverId: eventData.driverId || null,
          ...eventData.metadata
        }
      };

      // Salvar com retry
      await this.retryOperation(
        async () => {
          await eventRef.set(eventPayload);
        },
        'savePaymentEvent'
      );

      logStructured('info', 'Evento de pagamento salvo', {
        service: 'payment',
        operation: 'savePaymentEvent',
        rideId,
        eventType
      });
      return true;

    } catch (error) {
      logStructured('error', 'Erro ao salvar evento de pagamento', {
        service: 'payment',
        operation: 'savePaymentEvent',
        rideId,
        eventType,
        error: error.message
      });
      // Não bloquear operação principal se histórico falhar
      return false;
    }
  }

  /**
   * Busca payment holding do Firestore
   * @param {string} rideId - ID da corrida
   * @returns {Promise<Object|null>} - Dados do holding ou null
   */
  async getPaymentHolding(rideId) {
    try {
      const firestore = firebaseConfig.getFirestore();

      if (!firestore) {
        return null;
      }

      const holdingRef = firestore.collection('payment_holdings').doc(rideId);
      const holdingDoc = await holdingRef.get();

      if (!holdingDoc.exists) {
        return null;
      }

      return holdingDoc.data();

    } catch (error) {
      logError(error, 'Erro ao buscar payment holding', { service: 'PaymentService' });
      return null;
    }
  }

  async writePaymentStatusCache(reference, payload = {}) {
    const normalizedReference = String(reference || '').trim();
    if (!normalizedReference) {
      return false;
    }

    try {
      await redisPool.ensureConnection();
      const redis = redisPool.getConnection();
      const cacheKey = `payment_status_cache:${normalizedReference}`;
      const cachePayload = {
        ...payload,
        updatedAt: new Date().toISOString()
      };

      await redis.set(
        cacheKey,
        JSON.stringify(cachePayload),
        'EX',
        this.PAYMENT_STATUS_CACHE_TTL_SECONDS
      );
      return true;
    } catch (error) {
      logStructured('debug', 'Falha ao gravar payment status cache', {
        service: 'payment-service',
        reference: normalizedReference,
        error: error.message
      });
      return false;
    }
  }

  async readPaymentStatusCache(reference) {
    const normalizedReference = String(reference || '').trim();
    if (!normalizedReference) {
      return null;
    }

    try {
      await redisPool.ensureConnection();
      const redis = redisPool.getConnection();
      const cacheKey = `payment_status_cache:${normalizedReference}`;
      const raw = await redis.get(cacheKey);

      if (!raw) {
        return null;
      }

      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      return parsed;
    } catch (error) {
      logStructured('debug', 'Falha ao ler payment status cache', {
        service: 'payment-service',
        reference: normalizedReference,
        error: error.message
      });
      return null;
    }
  }

  async resolveWooviConfigForCharge(chargeId) {
    const normalizedChargeId = String(chargeId || '').trim();
    if (!normalizedChargeId) return null;

    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) return null;

      const snapshot = await firestore
        .collection('payment_intents')
        .where('chargeId', '==', normalizedChargeId)
        .limit(1)
        .get();

      if (snapshot.empty) return null;

      const paymentIntent = snapshot.docs[0].data() || {};
      const providerEnvironment = String(paymentIntent.providerEnvironment || '').trim().toLowerCase();
      if (!providerEnvironment) return null;

      return {
        wooviConfig: getWooviConfig({ environment: providerEnvironment }),
        paymentIntentId: paymentIntent.paymentIntentId || snapshot.docs[0].id,
        providerEnvironment,
        paymentProfileId: paymentIntent.paymentProfileId || null
      };
    } catch (error) {
      logStructured('debug', 'Falha ao resolver ambiente Woovi da cobrança', {
        service: 'payment-service',
        chargeId: normalizedChargeId,
        error: error.message
      });
      return null;
    }
  }

  /**
   * Processa pagamento antecipado do passageiro
   * @param {Object} paymentData - Dados do pagamento
   * @param {string} paymentData.passengerId - ID do passageiro
   * @param {number} paymentData.amount - Valor em centavos
   * @param {string} paymentData.rideId - ID da corrida
   * @param {Object} paymentData.rideDetails - Detalhes da corrida
   * @returns {Promise<Object>} - Resultado do pagamento
   */
  async processAdvancePayment(paymentData) {
    try {
      const paymentSession = this.resolveAdvancePaymentSession(paymentData);
      if (!paymentSession.success) {
        return paymentSession;
      }
      paymentData = {
        ...paymentData,
        rideId: paymentSession.rideId,
        paymentSessionId: paymentSession.paymentSessionId,
        paymentContextKey: paymentSession.paymentContextKey,
        quoteSessionId: paymentSession.quoteSessionId
      };

      logStructured('info', 'Processando pagamento antecipado', {
        service: 'PaymentService',
        passengerId: paymentData.passengerId,
        amount: paymentData.amount,
        rideId: paymentData.rideId,
        passengerName: paymentData.passengerName,
        passengerEmail: paymentData.passengerEmail
      });

      if (this.shouldForceBypass(paymentData)) {
        const bypassResult = this.buildBypassAdvancePaymentResult(paymentData, 'force_bypass_enabled');
        logStructured('warn', 'Bypass de pagamento forçado por configuração', {
          service: 'PaymentService',
          rideId: paymentData.rideId,
          passengerId: paymentData.passengerId,
          chargeId: bypassResult.chargeId
        });
        return bypassResult;
      }

      const paymentProfile = await this.paymentRuntimeProfileService.resolveProfile({
        passengerId: paymentData.passengerId,
        userId: paymentData.passengerId,
        phone: paymentData.passengerPhone || paymentData.phone || paymentData.phoneNumber,
        phoneNumber: paymentData.passengerPhone || paymentData.phone || paymentData.phoneNumber,
        rideId: paymentData.rideId,
        actor: paymentData.actor || null,
        appReview: String(process.env.APP_REVIEW || '').toLowerCase() === 'true'
      });

      logStructured('info', 'Perfil de pagamento resolvido', {
        service: 'PaymentService',
        rideId: paymentData.rideId,
        passengerId: paymentData.passengerId,
        provider: paymentProfile.provider,
        providerEnvironment: paymentProfile.environment,
        paymentProfileId: paymentProfile.profileId,
        paymentProfileSource: paymentProfile.source,
        paymentProfileReason: paymentProfile.reason
      });

      if (!paymentProfile.wooviConfig?.apiToken) {
        return {
          success: false,
          error: 'Perfil de pagamento sem credenciais Woovi configuradas',
          code: 'PAYMENT_PROFILE_CREDENTIALS_MISSING',
          provider: 'woovi',
          providerEnvironment: paymentProfile.environment,
          paymentProfileId: paymentProfile.profileId
        };
      }

      const paymentIntent = await this.beginAdvancePaymentIntent(paymentData, paymentProfile);
      if (!paymentIntent.success) {
        logStructured('warn', 'Payment intent recusou criação de cobrança', {
          service: 'PaymentService',
          rideId: paymentData.rideId,
          passengerId: paymentData.passengerId,
          paymentIntentId: paymentIntent.paymentIntentId || null,
          code: paymentIntent.code || null
        });
        return {
          success: false,
          error: paymentIntent.error || 'Não foi possível criar a cobrança Pix',
          code: paymentIntent.code || 'PAYMENT_INTENT_ERROR',
          paymentIntentId: paymentIntent.paymentIntentId || null,
          bookingId: paymentIntent.bookingId || null,
          chargeId: paymentIntent.chargeId || null,
          details: paymentIntent
        };
      }

      if (paymentIntent.idempotentReplay) {
        logStructured('info', 'Reutilizando cobrança Pix já criada para a corrida', {
          service: 'PaymentService',
          rideId: paymentData.rideId,
          paymentIntentId: paymentIntent.paymentIntentId,
          chargeId: paymentIntent.existing?.chargeId || null
        });
        return this.buildAdvancePaymentIntentResponse({
          ...paymentIntent.existing,
          paymentIntentId: paymentIntent.paymentIntentId,
          correlationID: paymentIntent.correlationID
        });
      }

      // 1. Criar cobrança PIX para o passageiro
      const commentRaw = `Corrida Leaf - ${paymentData.rideDetails.origin} para ${paymentData.rideDetails.destination}`;
      const comment =
        commentRaw.length > 140 ? `${commentRaw.slice(0, 137)}...` : commentRaw;

      const uniqueCorrelationID = paymentIntent.correlationID || this.buildAdvanceChargeCorrelationID(paymentData);

      logStructured('debug', 'Usando correlationID determinístico para cobrança', {
        service: 'PaymentService',
        correlationID: uniqueCorrelationID,
        paymentIntentId: paymentIntent.paymentIntentId || null
      });

      const chargeData = {
        value: paymentIntent.amountCents || paymentData.amount,
        comment,
        correlationID: uniqueCorrelationID,
        additionalInfo: this.buildWooviAdditionalInfo([
          { key: 'passenger_id', value: paymentData.passengerId },
          { key: 'ride_id', value: paymentData.rideId },
          { key: 'gross_amount_cents', value: String(paymentData.grossAmountInCents || paymentIntent.grossAmountInCents || '') },
          { key: 'payable_amount_cents', value: String(paymentData.payableAmountInCents || paymentIntent.payableAmountInCents || paymentIntent.amountCents || '') },
          { key: 'discount_benefit_id', value: String(paymentData.discountBenefit?.benefitId || '') },
          { key: 'discount_amount_cents', value: String(paymentData.discountBenefit?.discountAmountInCents || 0) },
          { key: 'payment_intent_id', value: paymentIntent.paymentIntentId || '' },
          { key: 'payment_session_id', value: paymentIntent.paymentSessionId || '' },
          { key: 'quote_session_id', value: paymentIntent.quoteSessionId || '' },
          { key: 'quote_version', value: paymentIntent.quoteVersion || this.normalizeQuoteVersion(paymentData) },
          { key: 'payment_type', value: 'advance_payment' },
          { key: 'provider_environment', value: paymentIntent.providerEnvironment || paymentProfile.environment || 'production' },
          { key: 'payment_profile_id', value: paymentIntent.paymentProfileId || paymentProfile.profileId || '' },
          { key: 'service', value: 'ride_sharing' },
          { key: 'settlement_model', value: 'post_ride_ledger' },
          { key: 'driver_settlement', value: 'deferred_until_ride_completed' }
        ]),
        customer: {
          name: paymentData.passengerName || 'Passageiro Leaf',
          email: paymentData.passengerEmail || 'passenger@leaf.com'
        }
      };

      // O pagamento da Leaf é antecipado: no momento da cobrança o motorista pode
      // ainda não existir, pode trocar, cancelar ou ser reatribuído. Por isso a
      // cobrança inicial nunca envia split Woovi. O direito financeiro do motorista
      // nasce só na conclusão da corrida e é liquidado pelo worker de billing no ledger.
      const splitPlan = {
        success: false,
        reason: 'driver_settlement_deferred_until_ride_completed'
      };

      logStructured('info', 'Enviando cobrança para Woovi', {
        service: 'PaymentService',
        value: chargeData.value,
        comment: chargeData.comment,
        correlationID: chargeData.correlationID,
        customerName: chargeData.customer.name,
        customerEmail: chargeData.customer.email,
        splitEnabled: false,
        splitReason: splitPlan.reason
      });

      const chargeResult = await this.wooviDriverService.createCharge({
        ...chargeData,
        wooviConfig: paymentProfile.wooviConfig
      });

      if (!chargeResult.success) {
        await this.markAdvancePaymentIntentFailed(paymentIntent, chargeResult.error || chargeResult.details || {});
        logStructured('warn', 'Erro ao criar cobrança na Woovi', {
          service: 'PaymentService',
          error: chargeResult.error,
          details: chargeResult.details,
          correlationID: chargeData.correlationID
        });

        const wooviStatus = Number(chargeResult?.details?.status || 0);
        const rawMessage =
          chargeResult?.error?.error ||
          chargeResult?.error?.message ||
          chargeResult?.error ||
          chargeResult?.details?.data?.error ||
          chargeResult?.details?.message ||
          '';
        const wooviMessage = String(rawMessage).toLowerCase();
        const featureBlocked =
          wooviStatus === 403 ||
          wooviMessage.includes('feature is not enabled') ||
          wooviMessage.includes('não estão habilitados');

        if (this.PAYMENT_BYPASS_ON_WOOVI_FAILURE) {
          const bypassResult = this.buildBypassAdvancePaymentResult(
            paymentData,
            'woovi_feature_or_auth_unavailable'
          );
          logStructured('warn', 'Bypass de pagamento ativado para review', {
            service: 'PaymentService',
            rideId: paymentData.rideId,
            mockChargeId: bypassResult.chargeId,
            wooviStatus,
            featureBlocked
          });
          return bypassResult;
        }
        return {
          success: false,
          error: 'Falha ao criar cobrança PIX',
          details: chargeResult.error || chargeResult.details
        };
      }

      const chargePayload = chargeResult?.charge || {};
      const chargeId =
        chargePayload.identifier ||
        chargePayload.id ||
        chargePayload.transactionID ||
        chargePayload.correlationID ||
        chargePayload?.paymentMethods?.pix?.identifier ||
        chargePayload?.paymentMethods?.pix?.transactionID ||
        null;
      const qrCode =
        chargePayload.qrCodeImage ||
        chargePayload?.paymentMethods?.pix?.qrCodeImage ||
        null;
      const paymentLink = chargePayload.paymentLinkUrl || null;

      logStructured('info', 'Cobrança criada com sucesso', {
        service: 'PaymentService',
        chargeId,
        correlationID: chargeData.correlationID
      });

      if (!chargeId) {
        await this.markAdvancePaymentIntentFailed(paymentIntent, {
          message: 'A Woovi retornou cobrança sem identificador',
          correlationID: chargeData.correlationID
        });
        return {
          success: false,
          error: 'Falha ao identificar cobrança PIX',
          details: {
            message: 'A Woovi retornou cobrança sem identificador',
            correlationID: chargeData.correlationID
          }
        };
      }

      // Apenas cria a cobrança. O webhook materializa o holding e o crédito do
      // motorista acontece somente após ride.completed no worker de billing.
      await this.completeAdvancePaymentIntent(paymentIntent, {
        chargeId,
        qrCode,
        paymentLink
      });

      return {
        success: true,
        message: 'Pagamento antecipado processado com sucesso',
        chargeId,
        qrCode,
        paymentLink,
        rideId: paymentData.rideId,
        amount: paymentIntent.amountCents || paymentData.amount,
        grossAmountInCents: paymentData.grossAmountInCents || paymentIntent.grossAmountInCents || null,
        payableAmountInCents: paymentData.payableAmountInCents || paymentIntent.payableAmountInCents || paymentIntent.amountCents || paymentData.amount,
        discountBenefit: paymentData.discountBenefit || paymentIntent.discountBenefit || null,
        paymentIntentId: paymentIntent.paymentIntentId || null,
        correlationID: chargeData.correlationID,
        provider: paymentIntent.provider || 'woovi',
        providerEnvironment: paymentIntent.providerEnvironment || paymentProfile.environment,
        paymentProfileId: paymentIntent.paymentProfileId || paymentProfile.profileId || null,
        paymentSessionId: paymentIntent.paymentSessionId || null,
        paymentContextKey: paymentIntent.paymentContextKey || null,
        quoteSessionId: paymentIntent.quoteSessionId || null,
        splitApplied: false,
        splitDeferred: true,
        settlementPolicy: 'post_ride_ledger',
        splitTarget: null,
        splitCalculation: null
      };

    } catch (error) {
      logError(error, 'Erro ao processar pagamento antecipado', { service: 'PaymentService' });
      return {
        success: false,
        error: 'Erro interno do servidor',
        details: error.message
      };
    }
  }

  /**
   * Confirma pagamento e credita saldo no motorista
   * @param {string} chargeId - ID da cobrança
   * @param {string} rideId - ID da corrida
   * @param {string} driverId - ID do motorista
   * @returns {Promise<Object>} - Resultado da confirmação
   */
  async confirmPaymentAndCreditDriver(chargeId, rideId, driverId) {
    if (!this.isLegacyDirectDriverCreditEnabled()) {
      return {
        success: false,
        error: 'Credito direto legado desativado',
        code: 'LEGACY_DIRECT_DRIVER_CREDIT_DISABLED',
        settlementPolicy: 'post_ride_ledger',
        details: 'Use ride.completed + worker de billing para liquidar holding e creditar o motorista.'
      };
    }

    try {
      logStructured('info', 'Confirmando pagamento e creditando saldo', { service: 'PaymentService', chargeId, rideId, driverId });

      // 1. Verificar status da cobrança na Woovi
      const chargeStatus = await this.wooviDriverService.getChargeStatus(chargeId);

      if (!chargeStatus.success || chargeStatus.status !== 'COMPLETED') {
        return {
          success: false,
          error: 'Pagamento não confirmado',
          details: 'Cobrança não foi paga ou não existe'
        };
      }

      // 2. Calcular valor líquido para o motorista (descontar taxas)
      // Nota: Como não temos o tollFee aqui, passamos 0 como fallback,
      // mas o ideal é que esse método não recalcule, devia apenas consultar a holding.
      // Futuro refactoring recomendado.
      const netCalculation = this.calculateNetAmount(chargeStatus.amount, 0);

      // 3. Creditar saldo diretamente no motorista
      const creditResult = await this.creditDriverBalance(
        driverId,
        netCalculation.netAmount, // Valor líquido em centavos
        rideId
      );

      if (!creditResult.success) {
        return {
          success: false,
          error: 'Erro ao creditar saldo',
          details: creditResult.error
        };
      }

      logStructured('info', 'Saldo creditado com sucesso', {
        service: 'PaymentService',
        driverId,
        netAmount: netCalculation.netAmount,
        newBalance: creditResult.newBalance
      });

      return {
        success: true,
        message: 'Pagamento confirmado e saldo creditado',
        driverId,
        netAmount: netCalculation.netAmount,
        netAmountInReais: (netCalculation.netAmount / 100).toFixed(2),
        newBalance: creditResult.newBalance,
        calculation: netCalculation
      };

    } catch (error) {
      logError(error, 'Erro ao confirmar pagamento', { service: 'PaymentService' });
      return {
        success: false,
        error: 'Erro interno do servidor',
        details: error.message
      };
    }
  }

  /**
   * Armazena o pagamento confirmado até que a corrida seja concluída
   * @param {Object} paymentInfo
   * @param {string} paymentInfo.rideId
   * @param {string} paymentInfo.chargeId
   * @param {number} paymentInfo.amount
   * @param {string} paymentInfo.passengerId
   * @param {Object} paymentInfo.metadata
   */
  async storeConfirmedPayment(paymentInfo) {
    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        logStructured('warn', 'Firestore indisponível ao armazenar pagamento confirmado', { service: 'PaymentService' });
        return { success: false, error: 'Firestore não disponível' };
      }

      const { rideId, chargeId, amount, passengerId, metadata = {} } = paymentInfo;
      if (!rideId || !chargeId) {
        return { success: false, error: 'rideId e chargeId são obrigatórios' };
      }

      const paymentsCollection = firestore.collection('ride_payments');
      const paymentRef = paymentsCollection.doc(rideId);
      const existingDoc = await paymentRef.get();
      const existingData = existingDoc.exists ? existingDoc.data() : {};

      const now = admin.firestore.FieldValue.serverTimestamp();

      const paymentPayload = {
        rideId,
        chargeId: chargeId || existingData.chargeId,
        amount: typeof amount === 'number' ? amount : existingData.amount,
        passengerId: passengerId || existingData.passengerId,
        status: 'CONFIRMED',
        credited: typeof existingData.credited === 'boolean' ? existingData.credited : false,
        metadata: metadata || {},
        updatedAt: now
      };

      if (!existingData.confirmedAt) {
        paymentPayload.confirmedAt = now;
      }

      await paymentRef.set(paymentPayload, { merge: true });
      logStructured('debug', 'Registro/atualização em ride_payments', { service: 'PaymentService', paymentPayload });

      // Atualizar documento da corrida para refletir status do pagamento
      const bookingsRef = firestore.collection('bookings').doc(rideId);
      await bookingsRef.set({
        paymentStatus: 'confirmed',
        paymentChargeId: chargeId,
        paymentAmount: typeof amount === 'number' ? amount : existingData.amount || null,
        paymentConfirmedAt: now
      }, { merge: true });

      const ledgerResult = await this.financialLedgerService.recordPaymentReceived({
        rideId,
        chargeId,
        amountCents: typeof amount === 'number' ? amount : existingData.amount,
        passengerId: passengerId || existingData.passengerId,
        metadata: {
          source: 'storeConfirmedPayment',
          webhookEvent: metadata?.event || null,
          correlationID: metadata?.correlationID || null
        }
      });

      if (!ledgerResult.success) {
        logStructured('warn', 'Pagamento confirmado sem ledger financeiro canônico', {
          service: 'PaymentService',
          rideId,
          chargeId,
          ledgerError: ledgerResult.error || ledgerResult.code
        });
      }

      logStructured('info', 'Pagamento confirmado armazenado', {
        service: 'PaymentService',
        rideId,
        chargeId
      });

      return {
        success: true,
        payment: {
          ...existingData,
          ...paymentPayload
        }
      };
    } catch (error) {
      logError(error, 'Erro ao armazenar pagamento confirmado', { service: 'PaymentService' });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Obtém dados do pagamento armazenado
   * @param {string} rideId
   */
  async getStoredPayment(rideId) {
    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        return null;
      }

      const paymentRef = firestore.collection('ride_payments').doc(rideId);
      const paymentDoc = await paymentRef.get();
      if (!paymentDoc.exists) {
        return null;
      }

      return paymentDoc.data();
    } catch (error) {
      logError(error, 'Erro ao buscar pagamento armazenado', { service: 'PaymentService' });
      return null;
    }
  }

  /**
   * Associa o driverId ao pagamento já confirmado
   * @param {string} rideId
   * @param {string} driverId
   */
  async associateDriverToPayment(rideId, driverId) {
    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        logStructured('warn', 'Firestore indisponível ao associar driver ao pagamento', { service: 'PaymentService' });
        return { success: false, error: 'Firestore não disponível' };
      }

      if (!rideId || !driverId) {
        return { success: false, error: 'rideId e driverId são obrigatórios' };
      }

      await firestore.collection('ride_payments').doc(rideId).set({
        rideId,
        assignedDriverId: driverId,
        driverAssociatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      logStructured('info', 'driverId associado ao pagamento confirmado', { service: 'PaymentService', rideId, driverId });

      await firestore.collection('bookings').doc(rideId).set({
        driverId
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
      const paymentRef = firestore.collection('ride_payments').doc(rideId);
      const existingPaymentDoc = await paymentRef.get();
      const existingPayment = existingPaymentDoc.exists ? existingPaymentDoc.data() : {};
      const chargeId = refundData.chargeId || existingPayment.chargeId || existingPayment.paymentId || null;

      const updates = {
        status,
        refunded: status === 'REFUNDED',
        refundAmount,
        refundAmountInReais: (refundAmount / 100).toFixed(2),
        cancellationFee,
        cancellationFeeInReais: (cancellationFee / 100).toFixed(2),
        refundId: refundData.refundId || null,
        refundReason: refundData.reason || null,
        refundMetadata: refundData.metadata || null,
        refundedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await paymentRef.set(updates, { merge: true });

      // ✅ NOVO: Atualizar payment_holdings também
      await this.updatePaymentHolding(rideId, {
        status: 'refunded',
        refunded: true,
        refundAmount: refundAmount,
        refundAmountInReais: (refundAmount / 100).toFixed(2),
        cancellationFee: cancellationFee,
        cancellationFeeInReais: (cancellationFee / 100).toFixed(2),
        refundId: refundData.refundId || null,
        refundReason: refundData.reason || null,
        refundedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      if (refundAmount > 0 && chargeId) {
        const ledgerResult = await this.financialLedgerService.recordRefund({
          rideId,
          chargeId,
          refundId: refundData.refundId || null,
          amountCents: refundAmount,
          passengerId: refundData.passengerId || existingPayment.passengerId || null,
          reason: refundData.reason || null,
          metadata: refundData.metadata || {}
        });

        if (!ledgerResult.success) {
          logStructured('warn', 'Reembolso registrado sem ledger financeiro canônico', {
            service: 'PaymentService',
            rideId,
            chargeId,
            ledgerError: ledgerResult.error || ledgerResult.code
          });
        }
      }

      logStructured('info', 'Pagamento marcado como reembolsado', {
        service: 'PaymentService',
        rideId,
        updates
      });

      return {
        success: true
      };
    } catch (error) {
      logError(error, 'Erro ao marcar pagamento como reembolsado', { service: 'PaymentService' });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Processa reembolso quando não encontra motorista
   * @param {string} chargeId - ID da cobrança na Woovi
   * @param {number} amount - Valor em centavos a reembolsar
   * @param {string} reason - Motivo do reembolso
   * @returns {Promise<Object>} - Resultado do reembolso
   */
  async processRefund(chargeId, amount, reason = 'No driver found') {
    try {
      logStructured('info', 'Processando reembolso', { service: 'PaymentService', chargeId, amount, reason });

      if (!chargeId || !amount) {
        return {
          success: false,
          error: 'chargeId e amount são obrigatórios'
        };
      }

      if (String(chargeId || '').startsWith('mock_review_')) {
        if (String(process.env.APP_REVIEW || '').toLowerCase() !== 'true') {
          return {
            success: false,
            error: 'Cobrança mock permitida apenas em APP_REVIEW=true'
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
      const refundResult = await circuitBreakerService.execute(
        'woovi_refund',
        async () => {
          return await this.wooviDriverService.processRefund(
            chargeId,
            amount,
            `Reembolso Leaf - ${reason}`
          );
        },
        async () => {
          // Fallback: retornar erro se circuit breaker aberto
          return {
            success: false,
            error: 'Serviço de pagamento temporariamente indisponível'
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
          details: refundResult.error
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
        details: error.message
      };
    }
  }

  /**
   * Constroi o contrato financeiro canonico da corrida.
   * O pedágio é passthrough do motorista e as taxas são calculadas sobre a corrida sem pedágio.
   */
  buildRideFinancialContract({ passengerPaidCents, tollFeeCents = 0, subscriptionRetainedFeeCents = 0 } = {}) {
    return buildRideFinancialContract({
      passengerPaidCents,
      tollFeeCents,
      subscriptionRetainedFeeCents,
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
  calculateNetAmount(totalAmount, tollFee = 0) {
    const financialContract = this.buildRideFinancialContract({
      passengerPaidCents: totalAmount,
      tollFeeCents: tollFee
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
  calculateFareBreakdownFromReais(totalFareReais, tollFeeReais = 0) {
    const normalizedFareReais = Number.isFinite(Number(totalFareReais)) ? Math.max(0, Number(totalFareReais)) : 0;
    const normalizedTollReais = Number.isFinite(Number(tollFeeReais)) ? Math.max(0, Number(tollFeeReais)) : 0;
    const totalAmountCents = this.toCents(normalizedFareReais);
    const tollFeeCents = this.toCents(normalizedTollReais);
    const calculation = this.calculateNetAmount(totalAmountCents, tollFeeCents);

    const operationalFee = this.toReais(calculation.operationalFee);
    const paymentIntermediationFee = this.toReais(calculation.wooviFee);
    const totalFees = this.toReais(calculation.operationalFee + calculation.wooviFee);
    const driverNetAmount = this.toReais(calculation.netAmount);
    const tollFee = this.toReais(calculation.tollFee);

    return {
      totalFare: this.toReais(totalAmountCents),
      tollFee,
      operationalFee,
      paymentIntermediationFee,
      totalFees,
      driverNetAmount,
      calculation
    };
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
      logStructured('info', 'Processando distribuição líquida', {
        service: 'PaymentService',
        rideId: rideData.rideId,
        driverId: rideData.driverId,
        totalAmount: rideData.totalAmount,
        tollFee: rideData.tollFee || 0
      });

      // 0. ✅ CAOS SCENARIO: Checar se o valor cobrado final é menor que o estimado pago (Encerramento Antecipado)
      let passengerRefundAmount = 0;
      let passengerRefundResult = null;
      try {
        const paymentRecord = await this.getStoredPayment(rideData.rideId);
        const chargeIdToRefund = paymentRecord?.chargeId || paymentRecord?.paymentId;
        if (paymentRecord && paymentRecord.status === 'PAID' && chargeIdToRefund && paymentRecord.amount > rideData.totalAmount) {
          passengerRefundAmount = paymentRecord.amount - rideData.totalAmount;
          logStructured('info', 'Encerramento Antecipado detectado: processando estorno parcial para o passageiro', {
            service: 'PaymentService',
            rideId: rideData.rideId,
            originalAmount: paymentRecord.amount,
            finalAmount: rideData.totalAmount,
            refundAmount: passengerRefundAmount
          });

          passengerRefundResult = await this.processRefund(chargeIdToRefund, passengerRefundAmount, 'Estorno de Encerramento Antecipado (recalculo de rota)');
          if (passengerRefundResult.success) {
            logStructured('info', 'Estorno parcial do passageiro realizado com sucesso', { service: 'PaymentService', refundId: passengerRefundResult.refundId });
          } else {
            logStructured('error', 'Falha ao processar estorno parcial do passageiro', { service: 'PaymentService', error: passengerRefundResult.error });
          }
        }
      } catch (refundCheckErr) {
        logStructured('error', 'Erro ao checar necessidade de estorno parcial', { service: 'PaymentService', error: refundCheckErr.message });
      }

      // 1. Calcular valor líquido
      const netCalculation = this.calculateNetAmount(rideData.totalAmount, rideData.tollFee || 0);

      if (netCalculation.netAmount <= 0) {
        return {
          success: false,
          error: 'Valor líquido insuficiente para distribuição',
          details: 'Taxas excedem o valor da corrida'
        };
      }

      // 1.5. Lógica de retenção em corridas (desabilitada por padrão).
      // O modelo vigente prioriza liquidação de assinatura no saque.
      let retainedFees = 0;
      if (this.SUBSCRIPTION_SPLIT_RETENTION_ENABLED && rideData.driverId) {
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

      if (retainedFees > 0) {
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
      if (!driverPixKey && rideData.driverId) {
        try {
          const DriverApprovalService = require('./driver-approval-service');
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
        rideData.rideId
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
        // Taxas retidas na conta Leaf (não transferidas)
        retainedFees: {
          operationalFee: netCalculation.operationalFee,
          wooviFee: netCalculation.wooviFee,
          subscriptionRetainedFee: retainedFees,
          totalRetained: netCalculation.operationalFee + netCalculation.wooviFee + retainedFees
        }
      };

      // ✅ Salvar distribuição no Firestore
      await this.saveDistributionToFirestore(distributionData);

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
        }
      });

      this.financialLedgerService.reconcileRideFinancials({ rideId: rideData.rideId })
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
        retainedFees: distributionData.retainedFees
      });

      return {
        success: true,
        message: 'Distribuição líquida processada com sucesso',
        netAmount: netCalculation.netAmount,
        netAmountInReais: (netCalculation.netAmount / 100).toFixed(2),
        transferId: transferId || null, // Pode ser null se BaaS não estiver disponível
        balanceCreditId: creditResult.balanceId || rideData.driverId, // ID do crédito no Firestore
        balance: creditResult.newBalance || null, // Novo saldo do motorista
        calculation: netCalculation,
        retainedFees: distributionData.retainedFees
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
        cancellationCreditRideId
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

      await this.saveDistributionToFirestore(distributionData);

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
  async creditDriverBalance(driverId, amount, rideId) {
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

      const balanceRef = firestore.collection('driver_balances').doc(driverId);
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
          lastCreditAmountCents: amountInCents
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
          idempotencyKey: creditTransactionId
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
  async saveDistributionToFirestore(distributionData) {
    try {
      const firestore = firebaseConfig.getFirestore();

      if (!firestore) {
        logStructured('warn', 'Firestore não disponível para salvar distribuição', { service: 'payment-service' });
        return false;
      }

      const distributionRef = firestore
        .collection('payment_distributions')
        .doc(distributionData.rideId);

      await distributionRef.set({
        ...distributionData,
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
   * Regra: abaixo de R$ 500,00 cobra R$ 1,00.
   * @param {number} amountCents
   */
  calculateWithdrawFee(amountCents) {
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return 0;
    }
    if (amountCents < this.WITHDRAW_FEE_THRESHOLD_CENTS) {
      return this.WITHDRAW_FEE_BELOW_THRESHOLD_CENTS;
    }
    return 0;
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
            description: 'Taxa de saque abaixo de R$ 500,00'
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
          ledgerStatus: transactionResult.ledgerStatus || 'unknown',
          ledgerEventId: transactionResult.ledgerEventId || null,
          settlementSyncStatus: 'unchanged'
        };
      }

      const withdrawalLedgerResult = await this.financialLedgerService.recordWithdrawalRequested({
        withdrawalId: transactionResult.withdrawalId || withdrawalRef.id,
        driverId,
        amountCents,
        withdrawFeeCents,
        subscriptionSettlementCents: transactionResult.subscriptionSettlementCents || 0,
        requestId,
        metadata: {
          totalDebitCents,
          source: 'requestDriverWithdrawal'
        }
      });

      const withdrawalDocRef = firestore.collection('driver_withdrawals').doc(transactionResult.withdrawalId || withdrawalRef.id);
      const ledgerPosted = Boolean(withdrawalLedgerResult.success);
      const ledgerStatusPatch = ledgerPosted
        ? {
            ledgerStatus: 'posted',
            ledgerEventId: withdrawalLedgerResult.eventId || null,
            ledgerPostedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }
        : {
            status: 'ledger_pending',
            ledgerStatus: 'pending_retry',
            ledgerError: withdrawalLedgerResult.error || withdrawalLedgerResult.code || 'Falha ao registrar ledger de saque',
            ledgerRetryable: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          };

      await withdrawalDocRef.set(ledgerStatusPatch, { merge: true });
      await idempotencyRef.set({
        status: ledgerPosted ? 'pending' : 'ledger_pending',
        ledgerStatus: ledgerStatusPatch.ledgerStatus,
        ledgerEventId: ledgerStatusPatch.ledgerEventId || null,
        ledgerError: ledgerStatusPatch.ledgerError || null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      if (!ledgerPosted) {
        logStructured('error', 'Saque solicitado sem ledger financeiro canônico; Pix Out bloqueado até conciliação', {
          service: 'payment-service',
          driverId,
          withdrawalId: transactionResult.withdrawalId || withdrawalRef.id,
          ledgerError: withdrawalLedgerResult.error || withdrawalLedgerResult.code
        });
      }

      this.financialLedgerService.reconcileWithdrawalFinancials({
        withdrawalId: transactionResult.withdrawalId || withdrawalRef.id
      }).catch((reconciliationError) => {
        logStructured('warn', 'Falha ao reconciliar saque após solicitação', {
          service: 'payment-service',
          withdrawalId: transactionResult.withdrawalId || withdrawalRef.id,
          error: reconciliationError.message
        });
      });

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
   * Lista saques pendentes para processamento operacional.
   * @param {number} limit
   */
  async listPendingWithdrawals(limit = 50) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      return { success: false, error: 'Firestore não disponível' };
    }

    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
    const snapshot = await firestore
      .collection('driver_withdrawals')
      .where('status', '==', 'pending')
      .limit(safeLimit)
      .get();

    const withdrawals = [];
    snapshot.forEach((doc) => {
      const data = doc.data() || {};
      if (data.ledgerStatus !== 'posted') {
        return;
      }
      withdrawals.push({
        id: doc.id,
        ...data
      });
    });
    withdrawals.sort((a, b) => {
      const aMs = Number(a?.createdAt?.toMillis?.() || 0);
      const bMs = Number(b?.createdAt?.toMillis?.() || 0);
      return aMs - bMs;
    });

    return {
      success: true,
      withdrawals
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
    const claimResult = await firestore.runTransaction(async (transaction) => {
      const withdrawalDoc = await transaction.get(withdrawalRef);
      if (!withdrawalDoc.exists) {
        return { success: false, error: 'Saque não encontrado' };
      }

      const withdrawal = withdrawalDoc.data() || {};
      if (withdrawal.status !== 'pending') {
        return {
          success: true,
          alreadyProcessed: true,
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

  /**
   * Verifica status de um pagamento via chargeId na Woovi
   * @param {string} chargeId - ID da cobrança na Woovi (ou bookingId para testes)
   * @returns {Promise<Object>} - Status do pagamento
   */
  async getPaymentStatus(chargeId) {
    try {
      if (String(chargeId || '').startsWith('mock_review_')) {
        if (String(process.env.APP_REVIEW || '').toLowerCase() !== 'true') {
          return {
            success: false,
            error: 'Cobrança mock permitida apenas em APP_REVIEW=true',
            status: null,
            chargeId
          };
        }

        return {
          success: true,
          status: 'in_holding',
          amount: 0,
          amountInReais: 0,
          chargeId: chargeId,
          paidAt: new Date().toISOString(),
          mock: true
        };
      }

      if (!chargeId) {
        return {
          success: false,
          error: 'chargeId é obrigatório'
        };
      }

      const cachedPaymentStatus = await this.readPaymentStatusCache(chargeId);
      if (cachedPaymentStatus) {
        const cachedAmountInCents = Number.isFinite(Number(cachedPaymentStatus.amount))
          ? Math.round(Number(cachedPaymentStatus.amount))
          : 0;

        return {
          success: true,
          status: String(cachedPaymentStatus.status || 'in_holding').trim().toLowerCase(),
          amount: cachedAmountInCents,
          amountInReais: cachedAmountInCents > 0 ? (cachedAmountInCents / 100) : 0,
          chargeId,
          paidAt:
            cachedPaymentStatus.paidAt ||
            cachedPaymentStatus.confirmedAt ||
            cachedPaymentStatus.updatedAt ||
            null,
          source: 'payment_status_cache'
        };
      }

      // Fallback rápido: booking já marcado como pago no Redis.
      // Útil para a janela logo após pagamento confirmado e antes do Firestore.
      try {
        await redisPool.ensureConnection();
        const redis = redisPool.getConnection();
        const bookingHash = await redis.hgetall(`booking:${chargeId}`);
        if (bookingHash && Object.keys(bookingHash).length > 0) {
          const bookingPaymentStatus = String(bookingHash.paymentStatus || '').toLowerCase();
          const amountInCents = Number.parseInt(bookingHash.paymentAmountInCents || '0', 10);

          if (['confirmed', 'paid', 'in_holding'].includes(bookingPaymentStatus)) {
            return {
              success: true,
              status: 'in_holding',
              amount: Number.isFinite(amountInCents) ? amountInCents : 0,
              amountInReais: Number.isFinite(amountInCents) ? (amountInCents / 100) : 0,
              chargeId,
              paidAt: bookingHash.paymentConfirmedAt || bookingHash.updatedAt || null,
              source: 'booking_cache'
            };
          }
        }
      } catch (redisLookupError) {
        logStructured('debug', 'Falha ao consultar status de pagamento no cache Redis', {
          service: 'payment-service',
          chargeId,
          error: redisLookupError.message
        });
      }

      const buildPaymentStatusResponseFromRecord = (record = {}, source = null) => {
        const normalizedStatus = String(record.status || '').trim().toLowerCase();
        const amountInCents = Number.isFinite(Number(record.amount))
          ? Math.round(Number(record.amount))
          : 0;

        return {
          success: true,
          status: normalizedStatus || 'in_holding',
          amount: amountInCents,
          amountInReais: amountInCents > 0 ? (amountInCents / 100) : 0,
          chargeId: chargeId,
          paidAt: record.paidAt || record.confirmedAt || record.updatedAt || null,
          ...(source ? { source } : {})
        };
      };

      // ✅ NOVO: Primeiro verificar se existe payment holding no Firestore (para testes)
      try {
        const firestore = firebaseConfig.getFirestore();
        if (firestore) {
          const holdingRef = firestore.collection('payment_holdings').doc(chargeId);
          const holdingDoc = await holdingRef.get();

          if (holdingDoc.exists) {
            const holdingData = holdingDoc.data();
            logStructured('info', 'Payment holding encontrado no Firestore', { service: 'payment-service', chargeId, status: holdingData.status });
            return buildPaymentStatusResponseFromRecord(holdingData, 'payment_holding_doc');
          } else {
            const [holdingByPaymentIdSnapshot, holdingByChargeIdSnapshot] = await Promise.all([
              firestore
                .collection('payment_holdings')
                .where('paymentId', '==', chargeId)
                .limit(1)
                .get(),
              firestore
                .collection('payment_holdings')
                .where('chargeId', '==', chargeId)
                .limit(1)
                .get()
            ]);

            const holdingByFieldDoc = !holdingByPaymentIdSnapshot.empty
              ? holdingByPaymentIdSnapshot.docs[0]
              : (!holdingByChargeIdSnapshot.empty ? holdingByChargeIdSnapshot.docs[0] : null);

            if (holdingByFieldDoc) {
              const holdingData = holdingByFieldDoc.data();
              logStructured('info', 'Payment holding encontrado no Firestore por campo', {
                service: 'payment-service',
                chargeId,
                rideId: holdingData.rideId || holdingByFieldDoc.id,
                status: holdingData.status
              });
              return buildPaymentStatusResponseFromRecord(holdingData, 'payment_holding_query');
            }

            const ridePaymentSnapshot = await firestore
              .collection('ride_payments')
              .where('chargeId', '==', chargeId)
              .limit(1)
              .get();

            if (!ridePaymentSnapshot.empty) {
              const ridePaymentData = ridePaymentSnapshot.docs[0].data();
              const normalizedRidePaymentStatus = String(ridePaymentData.status || '').trim().toUpperCase();
              if (['CONFIRMED', 'CREDITED', 'DISTRIBUTED', 'IN_HOLDING'].includes(normalizedRidePaymentStatus)) {
                logStructured('info', 'Pagamento confirmado encontrado em ride_payments', {
                  service: 'payment-service',
                  chargeId,
                  rideId: ridePaymentData.rideId || ridePaymentSnapshot.docs[0].id,
                  status: normalizedRidePaymentStatus
                });
                return buildPaymentStatusResponseFromRecord({
                  ...ridePaymentData,
                  status: normalizedRidePaymentStatus === 'CONFIRMED' ? 'in_holding' : normalizedRidePaymentStatus.toLowerCase(),
                  paidAt: ridePaymentData.confirmedAt || ridePaymentData.updatedAt || null
                }, 'ride_payments_query');
              }
            }

            // Sem holding local: continua para consulta direta na Woovi.
            logStructured('warn', 'Payment holding não encontrado no Firestore', { service: 'payment-service', chargeId });
          }
        }
      } catch (firestoreError) {
        logStructured('debug', 'Erro ao verificar Firestore (continuando para Woovi)', { service: 'payment-service', error: firestoreError.message });
      }

      // Verificar status diretamente na Woovi (produção)
      // ✅ Se Woovi falhar, não retornar erro se não for crítico
      try {
        const chargeRuntime = await this.resolveWooviConfigForCharge(chargeId);
        const chargeStatus = await this.wooviDriverService.getChargeStatus(chargeId, {
          wooviConfig: chargeRuntime?.wooviConfig
        });

        if (chargeStatus.success) {
          return {
            success: true,
            status: chargeStatus.status === 'COMPLETED' ? 'in_holding' : chargeStatus.status, // Converter COMPLETED para in_holding
            amount: chargeStatus.amount,
            amountInReais: chargeStatus.amount ? (chargeStatus.amount / 100) : 0,
            chargeId: chargeId,
            paidAt: chargeStatus.status === 'COMPLETED' ? chargeStatus.paidAt : null,
            providerEnvironment: chargeRuntime?.providerEnvironment || null,
            paymentProfileId: chargeRuntime?.paymentProfileId || null
          };
        } else {
          // Se Woovi não encontrou, mas pode ser um bookingId (não chargeId)
          // Retornar erro apenas se realmente não encontrar
          logStructured('warn', 'Woovi não encontrou charge (pode ser bookingId)', { service: 'payment-service', chargeId });
          return {
            success: false,
            error: chargeStatus.error || 'Cobrança não encontrada na Woovi'
          };
        }
      } catch (wooviError) {
        // Se erro na Woovi, verificar novamente no Firestore (pode ter sido salvo entre as tentativas)
        logStructured('warn', 'Erro ao buscar na Woovi, verificando Firestore novamente', { service: 'payment-service', error: wooviError.message });

        try {
          const firestore = firebaseConfig.getFirestore();
          if (firestore) {
            const holdingRef = firestore.collection('payment_holdings').doc(chargeId);
            const holdingDoc = await holdingRef.get();

            if (holdingDoc.exists) {
              const holdingData = holdingDoc.data();
              logStructured('info', 'Payment holding encontrado no Firestore (retry)', { service: 'payment-service', chargeId, status: holdingData.status });
              return {
                success: true,
                status: holdingData.status,
                amount: holdingData.amount || 0,
                amountInReais: holdingData.amount ? (holdingData.amount / 100) : 0,
                chargeId: chargeId,
                paidAt: holdingData.paidAt || null
              };
            }
          }
        } catch (retryError) {
          logStructured('debug', 'Erro ao verificar Firestore (retry)', { service: 'payment-service', error: retryError.message });
        }

        // Se tudo falhar, retornar "não encontrado" explicitamente
        logStructured('warn', 'Payment não encontrado (nem no Firestore nem na Woovi)', { service: 'payment-service', chargeId });
        return {
          success: false,
          error: 'Pagamento não encontrado',
          status: null,
          code: 'PAYMENT_NOT_FOUND'
        };
      }

    } catch (error) {
      logError(error, 'Erro ao verificar status do pagamento', { service: 'payment-service', chargeId });
      return {
        success: false,
        error: 'Erro interno do servidor',
        details: error.message
      };
    }
  }

  /**
   * Salva payment holding no Firestore (para testes e produção)
   * @param {string} rideId - ID da corrida
   * @param {Object} holdingData - Dados do holding
   * @returns {Promise<{success: boolean, error?: string}>} Resultado da operação
   */
  async savePaymentHolding(rideId, holdingData) {
    try {
      const cachePayload = {
        status: holdingData.status || this.PAYMENT_STATES.PENDING,
        amount: Number.isFinite(Number(holdingData.amount))
          ? Math.round(Number(holdingData.amount))
          : 0,
        paymentId: holdingData.paymentId || null,
        chargeId: holdingData.chargeId || holdingData.paymentId || null,
        paidAt: holdingData.paidAt || null,
        confirmedAt: holdingData.confirmedAt || null,
        rideId
      };

      await Promise.allSettled([
        this.writePaymentStatusCache(rideId, cachePayload),
        cachePayload.chargeId
          ? this.writePaymentStatusCache(cachePayload.chargeId, cachePayload)
          : Promise.resolve(false),
        cachePayload.paymentId && cachePayload.paymentId !== cachePayload.chargeId
          ? this.writePaymentStatusCache(cachePayload.paymentId, cachePayload)
          : Promise.resolve(false)
      ]);

      const firestore = firebaseConfig.getFirestore();

      if (!firestore) {
        logStructured('warn', 'Firestore não disponível para salvar payment holding', { service: 'payment-service' });
        return { success: false, error: 'Firestore não disponível' };
      }

      if (!rideId) {
        return { success: false, error: 'rideId é obrigatório' };
      }

      const holdingRef = firestore.collection('payment_holdings').doc(rideId);

      // Preparar dados completos
      const holdingPayload = {
        ...holdingData,
        rideId: rideId,
        amountInReais: holdingData.amount ? (holdingData.amount / 100) : null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      // Salvar com retry
      await this.retryOperation(
        async () => {
          await holdingRef.set(holdingPayload, { merge: true });
        },
        'savePaymentHolding'
      );

      logStructured('info', 'Payment holding salvo no Firestore', { service: 'payment-service', rideId, status: holdingData.status });

      // Salvar evento no histórico
      await this.savePaymentEvent(rideId, holdingData.status === 'in_holding' ? 'payment_confirmed' : 'payment_created', {
        status: holdingData.status,
        amount: holdingData.amount,
        previousStatus: null,
        newStatus: holdingData.status,
        chargeId: holdingData.paymentId,
        paymentId: holdingData.paymentId,
        actor: 'system',
        actorId: holdingData.passengerId || null
      });

      return { success: true };

    } catch (error) {
      logError(error, 'Erro ao salvar payment holding', { service: 'payment-service', rideId });
      return { success: false, error: error.message };
    }
  }

  /**
   * Atualiza payment holding no Firestore com validações
   * @param {string} rideId - ID da corrida
   * @param {Object} updateData - Dados para atualizar
   * @returns {Promise<{success: boolean, error?: string}>} Resultado da operação
   */
  async updatePaymentHolding(rideId, updateData) {
    try {
      const firestore = firebaseConfig.getFirestore();

      if (!firestore) {
        logStructured('warn', 'Firestore não disponível para atualizar payment holding', { service: 'payment-service' });
        return { success: false, error: 'Firestore não disponível' };
      }

      if (!rideId) {
        return { success: false, error: 'rideId é obrigatório' };
      }

      // 1. Buscar estado atual
      const currentHolding = await this.getPaymentHolding(rideId);

      if (!currentHolding) {
        return { success: false, error: 'Payment holding não encontrado' };
      }

      // 2. Validar transição de estado se status está sendo alterado
      if (updateData.status && updateData.status !== currentHolding.status) {
        if (!this.isValidStateTransition(currentHolding.status, updateData.status)) {
          const error = `Transição de estado inválida: ${currentHolding.status} → ${updateData.status}`;
          logError(new Error(error), 'Transição de estado inválida', { service: 'payment-service', rideId, currentStatus: currentHolding.status, newStatus: updateData.status });
          return { success: false, error };
        }
      }

      const holdingRef = firestore.collection('payment_holdings').doc(rideId);

      // Preparar dados de atualização
      const updatePayload = {
        ...updateData,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      // Se amount está sendo atualizado, calcular amountInReais
      if (updateData.amount !== undefined) {
        updatePayload.amountInReais = updateData.amount / 100;
      }

      // Atualizar com retry
      await this.retryOperation(
        async () => {
          await holdingRef.update(updatePayload);
        },
        'updatePaymentHolding'
      );

      logStructured('info', 'Payment holding atualizado no Firestore', { service: 'payment-service', rideId });

      // 3. Salvar evento no histórico se status mudou
      if (updateData.status && updateData.status !== currentHolding.status) {
        let eventType = 'payment_updated';

        // Mapear status para tipo de evento
        if (updateData.status === 'distributed') {
          eventType = 'payment_distributed';
        } else if (updateData.status === 'refunded') {
          eventType = 'payment_refunded';
        } else if (updateData.status === 'cancelled') {
          eventType = 'payment_cancelled';
        }

        await this.savePaymentEvent(rideId, eventType, {
          status: updateData.status,
          amount: updateData.amount || currentHolding.amount,
          previousStatus: currentHolding.status,
          newStatus: updateData.status,
          chargeId: currentHolding.chargeId || currentHolding.paymentId,
          paymentId: currentHolding.paymentId,
          driverId: updateData.driverId || currentHolding.driverId,
          actor: 'system',
          actorId: updateData.actorId || null,
          reason: updateData.reason || null,
          metadata: updateData.metadata || {}
        });
      }

      return { success: true };

    } catch (error) {
      logError(error, 'Erro ao atualizar payment holding', { service: 'payment-service', rideId });
      return { success: false, error: error.message };
    }
  }
}

module.exports = PaymentService;
