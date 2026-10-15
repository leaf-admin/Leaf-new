// Gerado a partir de services/payment-service.js (divisão mecânica, código idêntico).
// Status de pagamento e holding (escrita)

const {
  firebaseConfig,
  admin,
  getWooviConfig,
  resolveFinancialContext,
  getFinancialCollections,
  contextsMatch,
  logStructured,
  logError,
  redisPool,
  assertStoredRecordMatchesScope,
  resolveRidePersistenceScope,
} = require('./shared');

class PaymentServiceStatusAndHoldingMethods {
  /**
   * Verifica status de um pagamento via chargeId na Woovi
   * @param {string} chargeId - ID da cobrança na Woovi (ou bookingId para testes)
   * @returns {Promise<Object>} - Status do pagamento
   */
  async getPaymentStatus(chargeId, paymentContext = null) {
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

      let persistenceScope;
      let paymentCollections;
      const paymentScopeInput = paymentContext || {};
      try {
        persistenceScope = resolveRidePersistenceScope(paymentScopeInput);
        paymentCollections = getFinancialCollections(
          persistenceScope.financialContext
        ).collections;
      } catch (contextError) {
        return {
          success: false,
          error: contextError.message || 'Contexto financeiro inválido',
          code: contextError.code || 'FINANCIAL_CONTEXT_INVALID',
          status: null,
          chargeId
        };
      }

      const sandboxScope = persistenceScope.namespace === 'sandbox';
      const recordMatchesPaymentScope = (record) => {
        if (!record) return false;
        if (!sandboxScope) return true;
        try {
          assertStoredRecordMatchesScope(record, paymentScopeInput);
          return true;
        } catch (_error) {
          return false;
        }
      };

      const cachedPaymentStatus = await this.readPaymentStatusCache(chargeId);
      if (recordMatchesPaymentScope(cachedPaymentStatus)) {
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
        if (
          bookingHash &&
          Object.keys(bookingHash).length > 0 &&
          recordMatchesPaymentScope(bookingHash)
        ) {
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
          const holdingRef = firestore
            .collection(paymentCollections.paymentHoldings)
            .doc(chargeId);
          const holdingDoc = await holdingRef.get();

          if (holdingDoc.exists && recordMatchesPaymentScope(holdingDoc.data())) {
            const holdingData = holdingDoc.data();
            logStructured('info', 'Payment holding encontrado no Firestore', { service: 'payment-service', chargeId, status: holdingData.status });
            return buildPaymentStatusResponseFromRecord(holdingData, 'payment_holding_doc');
          } else {
            const [holdingByPaymentIdSnapshot, holdingByChargeIdSnapshot] = await Promise.all([
              firestore
                .collection(paymentCollections.paymentHoldings)
                .where('paymentId', '==', chargeId)
                .limit(1)
                .get(),
              firestore
                .collection(paymentCollections.paymentHoldings)
                .where('chargeId', '==', chargeId)
                .limit(1)
                .get()
            ]);

            const holdingByFieldDoc = [
              ...(holdingByPaymentIdSnapshot.docs || []),
              ...(holdingByChargeIdSnapshot.docs || [])
            ].find((candidate) => recordMatchesPaymentScope(candidate?.data?.())) || null;

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
              .collection(paymentCollections.ridePayments)
              .where('chargeId', '==', chargeId)
              .limit(1)
              .get();

            if (!ridePaymentSnapshot.empty) {
              const ridePaymentData = ridePaymentSnapshot.docs[0].data();
              const normalizedRidePaymentStatus = String(ridePaymentData.status || '').trim().toUpperCase();
              if (
                recordMatchesPaymentScope(ridePaymentData) &&
                ['CONFIRMED', 'CREDITED', 'DISTRIBUTED', 'IN_HOLDING'].includes(normalizedRidePaymentStatus)
              ) {
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
        const chargeRuntime = sandboxScope
          ? {
            wooviConfig: getWooviConfig({
              environment: persistenceScope.financialContext.providerEnvironment
            }),
            providerEnvironment: persistenceScope.financialContext.providerEnvironment,
            paymentProfileId: persistenceScope.financialContext.paymentProfileId || null,
            financialContext: persistenceScope.financialContext
          }
          : await this.resolveWooviConfigForCharge(chargeId);
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
            source: 'woovi_provider',
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
            const holdingRef = firestore
              .collection(paymentCollections.paymentHoldings)
              .doc(chargeId);
            const holdingDoc = await holdingRef.get();

            if (holdingDoc.exists && recordMatchesPaymentScope(holdingDoc.data())) {
              const holdingData = holdingDoc.data();
              logStructured('info', 'Payment holding encontrado no Firestore (retry)', { service: 'payment-service', chargeId, status: holdingData.status });
              return {
                success: true,
                status: holdingData.status,
                amount: holdingData.amount || 0,
                amountInReais: holdingData.amount ? (holdingData.amount / 100) : 0,
                chargeId: chargeId,
                paidAt: holdingData.paidAt || null,
                source: 'payment_holding_retry'
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
      const contextResult = await this.resolveFinancialContextForPayment({
        rideId,
        chargeId: holdingData.chargeId || holdingData.paymentId,
        financialContext: holdingData.financialContext,
        providerEnvironment: holdingData.providerEnvironment,
        testUserSandbox: holdingData.testUserSandbox === true
      });
      if (!contextResult.ok) {
        return { success: false, code: contextResult.code, error: contextResult.error };
      }
      let paymentPersistenceScope;
      try {
        paymentPersistenceScope = resolveRidePersistenceScope({
          ...holdingData,
          financialContext: contextResult.context
        });
      } catch (contextError) {
        return {
          success: false,
          code: contextError.code || 'FINANCIAL_CONTEXT_INVALID',
          error: contextError.message || 'Contexto financeiro inválido'
        };
      }
      const financialContext = paymentPersistenceScope.financialContext;
      const { collections } = getFinancialCollections(financialContext);
      const cachePayload = {
        status: holdingData.status || this.PAYMENT_STATES.PENDING,
        amount: Number.isFinite(Number(holdingData.amount))
          ? Math.round(Number(holdingData.amount))
          : 0,
        paymentId: holdingData.paymentId || null,
        chargeId: holdingData.chargeId || holdingData.paymentId || null,
        paidAt: holdingData.paidAt || null,
        confirmedAt: holdingData.confirmedAt || null,
        rideId,
        financialContext,
        financialNamespace: financialContext.namespace,
        financialContextId: financialContext.contextId
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

      const holdingRef = firestore.collection(collections.paymentHoldings).doc(rideId);

      // Preparar dados completos
      const holdingPayload = {
        ...holdingData,
        rideId: rideId,
        financialContext,
        financialNamespace: financialContext.namespace,
        financialContextId: financialContext.contextId,
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
        financialContext,
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

      const contextResult = resolveFinancialContext(currentHolding, { allowLegacyOperational: true });
      if (!contextResult.ok) {
        return { success: false, code: contextResult.code, error: contextResult.error };
      }
      const legacyOperationalCompatible =
        currentHolding.financialContextLegacy === true &&
        contextResult.context.namespace === 'operational';
      if (
        updateData.financialContext &&
        !legacyOperationalCompatible &&
        !contextsMatch(updateData.financialContext, contextResult.context)
      ) {
        return {
          success: false,
          code: 'FINANCIAL_CONTEXT_CONFLICT',
          error: 'Contexto financeiro diverge do payment holding'
        };
      }
      const { collections } = getFinancialCollections(contextResult.context);
      const holdingRef = firestore.collection(collections.paymentHoldings).doc(rideId);

      // Preparar dados de atualização
      const updatePayload = {
        ...updateData,
        financialContext: contextResult.context,
        financialNamespace: contextResult.context.namespace,
        financialContextId: contextResult.context.contextId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      // Se amount está sendo atualizado, calcular amountInReais
      if (updateData.amount !== undefined) {
        updatePayload.amountInReais = updateData.amount / 100;
      }

      // Atualizar com retry. No sandbox, o alias temporário acompanha o estado
      // terminal do booking canônico sem gerar um segundo evento financeiro.
      if (contextResult.context.namespace === 'sandbox') {
        await this.retryOperation(
          () => this.updateSandboxCanonicalRecordAndAlias({
            firestore,
            collectionName: collections.paymentHoldings,
            canonicalRideId: rideId,
            updatePayload,
            financialContext: contextResult.context
          }),
          'updatePaymentHoldingSandboxAlias'
        );
      } else {
        await this.retryOperation(
          async () => {
            await holdingRef.update(updatePayload);
          },
          'updatePaymentHolding'
        );
      }

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
          metadata: updateData.metadata || {},
          financialContext: contextResult.context
        });
      }

      return { success: true };

    } catch (error) {
      logError(error, 'Erro ao atualizar payment holding', { service: 'payment-service', rideId });
      return { success: false, error: error.message };
    }
  }
}

module.exports = PaymentServiceStatusAndHoldingMethods;
