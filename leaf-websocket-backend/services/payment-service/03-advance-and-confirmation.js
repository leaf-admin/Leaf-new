// Gerado a partir de services/payment-service.js (divisão mecânica, código idêntico).
// Cobrança antecipada, confirmação e pagamentos armazenados

const {
  firebaseConfig,
  admin,
  FINANCIAL_COLLECTIONS,
  sealFinancialContext,
  resolveFinancialContext,
  getFinancialCollections,
  contextsMatch,
  logStructured,
  logError,
  redisPool,
  evaluateRideFlowValidationPaymentProfile,
  resolveRidePersistenceScope,
  resolveBookingCompatibilityCollection,
} = require('./shared');

class PaymentServiceAdvanceAndConfirmationMethods {
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

      const paymentProfile = await this.paymentRuntimeProfileService.resolveProfile({
        passengerId: paymentData.passengerId,
        userId: paymentData.passengerId,
        phone: paymentData.passengerPhone || paymentData.phone || paymentData.phoneNumber,
        phoneNumber: paymentData.passengerPhone || paymentData.phone || paymentData.phoneNumber,
        rideId: paymentData.rideId,
        actor: paymentData.actor || null,
        appReview: String(process.env.APP_REVIEW || '').toLowerCase() === 'true'
      });

      if (paymentData.financialContext) {
        let incomingScope;
        try {
          incomingScope = resolveRidePersistenceScope(paymentData);
        } catch (contextError) {
          return {
            success: false,
            code: contextError.code || 'FINANCIAL_CONTEXT_INVALID',
            error: contextError.message || 'Contexto financeiro inválido'
          };
        }

        const profileContext = sealFinancialContext({
          providerEnvironment: paymentProfile.environment,
          paymentProfileId: paymentProfile.profileId || null,
          paymentProfileSource: paymentProfile.source || null,
          testUserSandbox: paymentProfile.testUserSandbox === true
        });
        if (!contextsMatch(incomingScope.financialContext, profileContext)) {
          return {
            success: false,
            code: 'FINANCIAL_CONTEXT_CONFLICT',
            error: 'Perfil de pagamento diverge do contexto classificado pela rota',
            provider: paymentProfile.provider || 'woovi',
            providerEnvironment: paymentProfile.environment,
            paymentProfileId: paymentProfile.profileId || null
          };
        }
      }

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

      if (this.shouldForceBypass(paymentData) && paymentProfile.environment !== 'sandbox') {
        const bypassResult = this.buildBypassAdvancePaymentResult(paymentData, 'force_bypass_enabled');
        logStructured('warn', 'Bypass de pagamento forçado por configuração', {
          service: 'PaymentService',
          rideId: paymentData.rideId,
          passengerId: paymentData.passengerId,
          chargeId: bypassResult.chargeId
        });
        return bypassResult;
      }
      if (this.shouldForceBypass(paymentData) && paymentProfile.environment === 'sandbox') {
        logStructured('warn', 'Bypass ignorado para preservar isolamento financeiro sandbox', {
          service: 'PaymentService',
          rideId: paymentData.rideId,
          passengerId: paymentData.passengerId,
          paymentProfileId: paymentProfile.profileId
        });
      }

      const rideFlowValidationGuard = evaluateRideFlowValidationPaymentProfile(paymentProfile);
      if (!rideFlowValidationGuard.allowed) {
        logStructured('warn', 'Pagamento bloqueado pelo perfil de validação de corrida', {
          service: 'PaymentService',
          rideId: paymentData.rideId,
          passengerId: paymentData.passengerId,
          providerEnvironment: paymentProfile.environment,
          paymentProfileId: paymentProfile.profileId,
          code: rideFlowValidationGuard.code
        });
        return {
          success: false,
          error: rideFlowValidationGuard.message,
          code: rideFlowValidationGuard.code,
          provider: paymentProfile.provider,
          providerEnvironment: paymentProfile.environment,
          paymentProfileId: paymentProfile.profileId
        };
      }

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
      const chargeExpiresIn = this.resolveAdvanceChargeExpiresInSeconds(paymentIntent);

      logStructured('debug', 'Usando correlationID determinístico para cobrança', {
        service: 'PaymentService',
        correlationID: uniqueCorrelationID,
        paymentIntentId: paymentIntent.paymentIntentId || null
      });

      const chargeData = {
        value: paymentIntent.amountCents || paymentData.amount,
        comment,
        correlationID: uniqueCorrelationID,
        ...(chargeExpiresIn
          ? { expiresIn: chargeExpiresIn }
          : {}),
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
          { key: 'quote_lock_id', value: paymentIntent.quoteLockId || paymentData.quoteLockId || '' },
          { key: 'payment_driver_reservation_id', value: paymentIntent.paymentDriverReservationId || '' },
          { key: 'payment_driver_reservation_driver_id', value: paymentIntent.paymentDriverReservationDriverId || '' },
          { key: 'payment_driver_reservation_expires_at', value: paymentIntent.paymentDriverReservationExpiresAt || '' },
          { key: 'quote_version', value: paymentIntent.quoteVersion || this.normalizeQuoteVersion(paymentData) },
          { key: 'payment_type', value: 'advance_payment' },
          { key: 'provider_environment', value: paymentIntent.providerEnvironment || paymentProfile.environment || 'production' },
          { key: 'payment_profile_id', value: paymentIntent.paymentProfileId || paymentProfile.profileId || '' },
          { key: 'financial_namespace', value: paymentIntent.financialNamespace || '' },
          { key: 'financial_context_id', value: paymentIntent.financialContextId || '' },
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
        expiresIn: chargeData.expiresIn || null,
        paymentDriverReservationTtlSeconds: paymentIntent.paymentDriverReservationTtlSeconds || null,
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
        if (paymentIntent.paymentDriverReservationId) {
          try {
            const {
              releasePaymentDriverReservation
            } = require('../payment-driver-reservation-service');
            await redisPool.ensureConnection();
            await releasePaymentDriverReservation(
              redisPool.getConnection(),
              paymentIntent.paymentDriverReservationId
            );
          } catch (reservationReleaseError) {
            logStructured('warn', 'Falha ao liberar reserva de motorista após erro na cobrança Pix', {
              service: 'PaymentService',
              rideId: paymentData.rideId,
              paymentIntentId: paymentIntent.paymentIntentId || null,
              paymentDriverReservationId: paymentIntent.paymentDriverReservationId,
              error: reservationReleaseError.message
            });
          }
        }
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

        if (
          this.PAYMENT_BYPASS_ON_WOOVI_FAILURE &&
          paymentProfile.environment !== 'sandbox'
        ) {
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
          code: 'PAYMENT_PROVIDER_CHARGE_FAILED',
          provider: 'woovi',
          providerEnvironment: paymentProfile.environment,
          paymentProfileId: paymentProfile.profileId,
          paymentIntentId: paymentIntent.paymentIntentId || null,
          details: chargeResult.error || chargeResult.details
        };
      }

      const chargePayload = chargeResult?.charge || {};
      const pixPayload = chargePayload?.paymentMethods?.pix || chargePayload?.pix || {};
      const chargeId =
        chargeResult.chargeId ||
        chargePayload.identifier ||
        chargePayload.id ||
        chargePayload.transactionID ||
        chargePayload.correlationID ||
        pixPayload.identifier ||
        pixPayload.transactionID ||
        null;
      const qrCodeImage =
        chargeResult.qrCodeImage ||
        chargePayload.qrCodeImage ||
        pixPayload.qrCodeImage ||
        null;
      const brCode =
        chargeResult.brCode ||
        chargeResult.qrCodeText ||
        chargePayload.brCode ||
        pixPayload.brCode ||
        pixPayload.qrCode ||
        null;
      const paymentLink =
        chargeResult.paymentLink ||
        chargeResult.paymentLinkUrl ||
        chargePayload.paymentLinkUrl ||
        pixPayload.paymentLinkUrl ||
        null;

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
          code: 'PAYMENT_PROVIDER_CHARGE_ID_MISSING',
          provider: 'woovi',
          providerEnvironment: paymentProfile.environment,
          paymentProfileId: paymentProfile.profileId,
          paymentIntentId: paymentIntent.paymentIntentId || null,
          details: {
            message: 'A Woovi retornou cobrança sem identificador',
            correlationID: chargeData.correlationID
          }
        };
      }

      if (!qrCodeImage && !brCode && !paymentLink) {
        await this.markAdvancePaymentIntentFailed(paymentIntent, {
          message: 'A Woovi retornou cobrança sem artefato Pix utilizável',
          chargeId,
          correlationID: chargeData.correlationID
        });
        if (paymentIntent.paymentDriverReservationId) {
          try {
            const {
              releasePaymentDriverReservation
            } = require('../payment-driver-reservation-service');
            await redisPool.ensureConnection();
            await releasePaymentDriverReservation(
              redisPool.getConnection(),
              paymentIntent.paymentDriverReservationId
            );
          } catch (reservationReleaseError) {
            logStructured('warn', 'Falha ao liberar reserva de motorista após resposta Pix sem artefato', {
              service: 'PaymentService',
              rideId: paymentData.rideId,
              paymentIntentId: paymentIntent.paymentIntentId || null,
              paymentDriverReservationId: paymentIntent.paymentDriverReservationId,
              error: reservationReleaseError.message
            });
          }
        }
        logStructured('error', 'Woovi retornou cobrança sem artefato Pix utilizável', {
          service: 'PaymentService',
          chargeId,
          correlationID: chargeData.correlationID,
          providerEnvironment: paymentProfile.environment,
          paymentProfileId: paymentProfile.profileId
        });
        return {
          success: false,
          error: 'A Woovi não retornou QR Code, código Pix ou link de pagamento',
          code: 'PAYMENT_PROVIDER_PIX_ARTIFACT_MISSING',
          provider: 'woovi',
          providerEnvironment: paymentProfile.environment,
          paymentProfileId: paymentProfile.profileId,
          paymentIntentId: paymentIntent.paymentIntentId || null,
          chargeId,
          details: {
            message: 'A cobrança foi criada, mas não trouxe artefato Pix utilizável',
            correlationID: chargeData.correlationID
          }
        };
      }

      // Apenas cria a cobrança. O webhook materializa o holding e o crédito do
      // motorista acontece somente após ride.completed no worker de billing.
      await this.completeAdvancePaymentIntent(paymentIntent, {
        chargeId,
        qrCode: qrCodeImage,
        qrCodeImage,
        brCode,
        qrCodeText: brCode,
        paymentLink,
        paymentLinkUrl: paymentLink,
        chargeExpiresInSeconds: chargeExpiresIn
      });

      return {
        success: true,
        message: 'Pagamento antecipado processado com sucesso',
        chargeId,
        qrCode: qrCodeImage,
        qrCodeImage,
        brCode,
        qrCodeText: brCode,
        paymentLink,
        paymentLinkUrl: paymentLink,
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
        financialContext: paymentIntent.financialContext,
        financialNamespace: paymentIntent.financialNamespace,
        financialContextId: paymentIntent.financialContextId,
        paymentSessionId: paymentIntent.paymentSessionId || null,
        paymentContextKey: paymentIntent.paymentContextKey || null,
        quoteSessionId: paymentIntent.quoteSessionId || null,
        quoteLockId: paymentIntent.quoteLockId || paymentData.quoteLockId || null,
        paymentDriverReservationId: paymentIntent.paymentDriverReservationId || null,
        paymentDriverReservationDriverId: paymentIntent.paymentDriverReservationDriverId || null,
        paymentDriverReservationExpiresAt: paymentIntent.paymentDriverReservationExpiresAt || null,
        paymentDriverReservationTtlSeconds: paymentIntent.paymentDriverReservationTtlSeconds || null,
        passengerName: paymentIntent.passengerName || paymentData.passengerName || null,
        customerName: paymentIntent.customerName || paymentData.customerName || paymentData.passengerName || null,
        passengerEmail: paymentIntent.passengerEmail || paymentData.passengerEmail || null,
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
        code: 'PAYMENT_ADVANCE_INTERNAL_ERROR',
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

      const contextResult = await this.resolveFinancialContextForPayment({
        rideId,
        chargeId,
        financialContext: paymentInfo.financialContext || metadata.financialContext,
        providerEnvironment: paymentInfo.providerEnvironment || metadata.providerEnvironment,
        testUserSandbox: paymentInfo.testUserSandbox === true || metadata.testUserSandbox === true
      });
      if (!contextResult.ok) {
        return { success: false, code: contextResult.code, error: contextResult.error };
      }
      const financialContext = contextResult.context;
      const { collections } = getFinancialCollections(financialContext);
      const bookingCompatibility = resolveBookingCompatibilityCollection({
        financialContext,
        financialNamespace:
          paymentInfo.financialNamespace ||
          metadata.financialNamespace ||
          financialContext.namespace,
        financialContextId:
          paymentInfo.financialContextId ||
          metadata.financialContextId ||
          financialContext.contextId,
        providerEnvironment:
          paymentInfo.providerEnvironment ||
          metadata.providerEnvironment ||
          financialContext.providerEnvironment,
        testUserSandbox: Object.prototype.hasOwnProperty.call(paymentInfo, 'testUserSandbox')
          ? paymentInfo.testUserSandbox
          : (Object.prototype.hasOwnProperty.call(metadata, 'testUserSandbox')
            ? metadata.testUserSandbox
            : financialContext.testUserSandbox)
      });

      const paymentsCollection = firestore.collection(collections.ridePayments);
      const paymentRef = paymentsCollection.doc(rideId);
      const existingDoc = await paymentRef.get();
      const existingData = existingDoc.exists ? existingDoc.data() : {};
      if (existingDoc.exists) {
        const existingContextResult = resolveFinancialContext(existingData, { allowLegacyOperational: true });
        const legacyOperationalCompatible =
          existingContextResult.ok &&
          existingContextResult.legacy === true &&
          financialContext.namespace === 'operational';
        if (
          !existingContextResult.ok ||
          (!legacyOperationalCompatible && !contextsMatch(existingContextResult.context, financialContext))
        ) {
          return {
            success: false,
            code: 'FINANCIAL_CONTEXT_CONFLICT',
            error: 'Pagamento confirmado já existe com outro contexto financeiro'
          };
        }
      }

      const now = admin.firestore.FieldValue.serverTimestamp();

      const resolvedAmount = typeof amount === 'number' ? amount : existingData.amount;
      const resolvedPassengerId = passengerId || existingData.passengerId;
      const ledgerResult = await this.financialLedgerService.recordPaymentReceived({
        rideId,
        chargeId,
        amountCents: resolvedAmount,
        passengerId: resolvedPassengerId,
        financialContext,
        metadata: {
          source: 'storeConfirmedPayment',
          webhookEvent: metadata?.event || null,
          correlationID: metadata?.correlationID || null
        }
      });
      const ledgerPosted = Boolean(ledgerResult.success);
      const ledgerStatus = ledgerPosted ? 'posted' : 'pending_retry';

      const paymentPayload = {
        rideId,
        chargeId: chargeId || existingData.chargeId,
        amount: resolvedAmount,
        passengerId: resolvedPassengerId,
        status: ledgerPosted ? 'CONFIRMED' : 'LEDGER_PENDING',
        credited: typeof existingData.credited === 'boolean' ? existingData.credited : false,
        metadata: metadata || {},
        financialContext,
        financialNamespace: financialContext.namespace,
        financialContextId: financialContext.contextId,
        ledgerStatus,
        ledgerEventId: ledgerResult.eventId || null,
        ledgerError: ledgerPosted ? null : ledgerResult.error || ledgerResult.code || 'Falha ao registrar ledger de pagamento',
        ledgerRetryable: !ledgerPosted,
        updatedAt: now
      };

      if (!existingData.confirmedAt) {
        paymentPayload.confirmedAt = now;
      }

      await paymentRef.set(paymentPayload, { merge: true });
      logStructured('debug', 'Registro/atualização em ride_payments', { service: 'PaymentService', paymentPayload });

      // Atualizar documento da corrida para refletir status do pagamento
      const bookingsRef = firestore.collection(bookingCompatibility.collectionName).doc(rideId);
      await bookingsRef.set({
        paymentStatus: ledgerPosted ? 'confirmed' : 'ledger_pending',
        paymentChargeId: chargeId,
        paymentAmount: resolvedAmount || null,
        paymentConfirmedAt: now,
        paymentLedgerStatus: ledgerStatus,
        paymentLedgerEventId: ledgerResult.eventId || null,
        paymentLedgerError: ledgerPosted ? null : ledgerResult.error || ledgerResult.code || 'Falha ao registrar ledger de pagamento',
        paymentDispatchBlockedReason: ledgerPosted ? null : 'PAYMENT_LEDGER_PENDING',
        financialContext,
        financialNamespace: financialContext.namespace,
        financialContextId: financialContext.contextId
      }, { merge: true });

      if (!ledgerResult.success) {
        logStructured('error', 'Pagamento confirmado sem ledger financeiro canônico; dispatch bloqueado', {
          service: 'PaymentService',
          rideId,
          chargeId,
          ledgerError: ledgerResult.error || ledgerResult.code
        });
      }

      logStructured('info', 'Pagamento confirmado armazenado', {
        service: 'PaymentService',
        rideId,
        chargeId,
        ledgerStatus,
        financialNamespace: financialContext.namespace
      });

      return {
        success: true,
        ledgerPosted,
        ledgerStatus,
        ledgerEventId: ledgerResult.eventId || null,
        ledgerError: ledgerPosted ? null : ledgerResult.error || ledgerResult.code || null,
        financialContext,
        payment: {
          ...existingData,
          ...paymentPayload
        }
      };
    } catch (error) {
      logError(error, 'Erro ao armazenar pagamento confirmado', { service: 'PaymentService' });
      return {
        success: false,
        code: error.code || undefined,
        error: error.message
      };
    }
  }

  /**
   * Obtém dados do pagamento armazenado
   * @param {string} rideId
   */
  async getStoredPayment(rideId, financialContext = null) {
    try {
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) {
        return null;
      }

      const collectionNames = financialContext
        ? [getFinancialCollections(financialContext).collections.ridePayments]
        : [
          FINANCIAL_COLLECTIONS.operational.ridePayments,
          FINANCIAL_COLLECTIONS.sandbox.ridePayments
        ];
      const matches = [];
      for (const collectionName of collectionNames) {
        const paymentDoc = await firestore.collection(collectionName).doc(rideId).get();
        if (paymentDoc.exists) matches.push(paymentDoc.data() || {});
      }
      if (matches.length !== 1) return null;
      const contextResult = resolveFinancialContext(matches[0], { allowLegacyOperational: true });
      if (!contextResult.ok) return null;
      return {
        ...matches[0],
        financialContext: contextResult.context,
        financialContextLegacy: contextResult.legacy === true
      };
    } catch (error) {
      logError(error, 'Erro ao buscar pagamento armazenado', { service: 'PaymentService' });
      return null;
    }
  }

  async findStoredPaymentByChargeId(chargeId, financialContext = null) {
    const normalizedChargeId = String(chargeId || '').trim();
    if (!normalizedChargeId) return null;

    try {
      const contextResult = resolveFinancialContext(
        { financialContext },
        { allowLegacyOperational: true }
      );
      if (!contextResult.ok) return null;
      const { collections } = getFinancialCollections(contextResult.context);
      const firestore = firebaseConfig.getFirestore();
      if (!firestore) return null;

      const searchCollection = async (collectionName, fieldName) => {
        const collection = firestore.collection(collectionName);
        if (!collection || typeof collection.where !== 'function') return null;

        const snapshot = await collection
          .where(fieldName, '==', normalizedChargeId)
          .limit(1)
          .get();

        if (!snapshot || snapshot.empty || !snapshot.docs?.length) return null;

        const doc = snapshot.docs[0];
        const data = doc.data() || {};
        const resolvedRideId = contextResult.context.namespace === 'sandbox'
          ? (
            data.canonicalRideId ||
            data.bookingId ||
            data.rideId ||
            doc.id
          )
          : (data.rideId || data.bookingId || doc.id);
        return {
          ...data,
          rideId: resolvedRideId,
          chargeId: data.chargeId || data.paymentId || normalizedChargeId
        };
      };

      return (
        await searchCollection(collections.ridePayments, 'chargeId') ||
        await searchCollection(collections.ridePayments, 'paymentId') ||
        await searchCollection(collections.paymentHoldings, 'chargeId') ||
        await searchCollection(collections.paymentHoldings, 'paymentId')
      );
    } catch (error) {
      logStructured('warn', 'Falha ao resolver pagamento por chargeId para refund', {
        service: 'PaymentService',
        chargeId: normalizedChargeId,
        error: error.message
      });
      return null;
    }
  }

  async resolveStoredPaymentForRefund({ rideId, chargeId, financialContext = null } = {}) {
    const normalizedRideId = String(rideId || '').trim();
    const normalizedChargeId = String(chargeId || '').trim();
    const contextResult = resolveFinancialContext(
      { financialContext },
      { allowLegacyOperational: true }
    );
    if (!contextResult.ok) {
      return { success: false, ...contextResult };
    }
    const sealedFinancialContext = contextResult.context;

    let paymentRecord = normalizedRideId
      ? await this.getStoredPayment(normalizedRideId, sealedFinancialContext)
      : null;
    let resolvedRideId = normalizedRideId;

    if (!paymentRecord && normalizedChargeId) {
      paymentRecord = await this.findStoredPaymentByChargeId(
        normalizedChargeId,
        sealedFinancialContext
      );
      resolvedRideId = paymentRecord?.rideId || paymentRecord?.bookingId || null;
    }

    if (!paymentRecord || !resolvedRideId) {
      return {
        success: false,
        code: 'PAYMENT_RECORD_NOT_FOUND',
        error: 'Pagamento da corrida não encontrado para reembolso canônico'
      };
    }

    const paymentContextResult = resolveFinancialContext(
      paymentRecord,
      { allowLegacyOperational: true }
    );
    if (!paymentContextResult.ok) {
      return { success: false, ...paymentContextResult };
    }
    const legacyOperationalCompatible =
      paymentContextResult.legacy === true &&
      sealedFinancialContext.namespace === 'operational';
    if (
      !legacyOperationalCompatible &&
      !contextsMatch(paymentContextResult.context, sealedFinancialContext)
    ) {
      return {
        success: false,
        code: 'FINANCIAL_CONTEXT_CONFLICT',
        error: 'Contexto financeiro do pagamento diverge do reembolso'
      };
    }

    const recordChargeId = String(paymentRecord.chargeId || paymentRecord.paymentId || '').trim();
    if (normalizedChargeId && recordChargeId && normalizedChargeId !== recordChargeId) {
      return {
        success: false,
        code: 'PAYMENT_CHARGE_MISMATCH',
        error: 'chargeId informado diverge do pagamento da corrida'
      };
    }

    return {
      success: true,
      rideId: resolvedRideId,
      chargeId: normalizedChargeId || recordChargeId,
      paymentRecord: {
        ...paymentRecord,
        financialContext: paymentContextResult.context,
        financialContextLegacy: paymentContextResult.legacy === true
      },
      financialContext: sealedFinancialContext
    };
  }
}

module.exports = PaymentServiceAdvanceAndConfirmationMethods;
