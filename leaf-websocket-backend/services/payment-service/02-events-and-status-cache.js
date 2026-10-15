// Gerado a partir de services/payment-service.js (divisão mecânica, código idêntico).
// Transições de estado, eventos, holding (leitura), aliases e cache de status

const {
  firebaseConfig,
  admin,
  getWooviConfig,
  FINANCIAL_COLLECTIONS,
  resolveFinancialContext,
  getFinancialCollections,
  contextsMatch,
  logStructured,
  logError,
  redisPool,
} = require('./shared');

class PaymentServiceEventsAndStatusCacheMethods {
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

      const contextResult = resolveFinancialContext(eventData, { allowLegacyOperational: true });
      if (!contextResult.ok) return false;
      const { collections } = getFinancialCollections(contextResult.context);
      const eventRef = firestore.collection(collections.paymentHistory).doc();

      const eventPayload = {
        rideId: rideId,
        eventType: eventType, // confirmed, distributed, refunded, cancelled
        status: eventData.status || null,
        amount: eventData.amount || null,
        amountInReais: eventData.amount ? (eventData.amount / 100) : null,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        actor: eventData.actor || 'system', // system, passenger, driver, admin
        actorId: eventData.actorId || null,
        financialContext: contextResult.context,
        financialNamespace: contextResult.context.namespace,
        financialContextId: contextResult.context.contextId,
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

      // Leituras independentes por namespace: em paralelo, preservando a ordem dos resultados.
      const holdingDocs = await Promise.all(['operational', 'sandbox'].map((namespace) => firestore
        .collection(FINANCIAL_COLLECTIONS[namespace].paymentHoldings)
        .doc(rideId)
        .get()));
      const matches = [];
      for (const holdingDoc of holdingDocs) {
        if (holdingDoc.exists) matches.push(holdingDoc.data() || {});
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
      logError(error, 'Erro ao buscar payment holding', { service: 'PaymentService' });
      return null;
    }
  }

  resolveMaterializedPaymentAliasId(record = {}, canonicalRideId = null) {
    const normalizedCanonicalRideId = String(canonicalRideId || '').trim();
    const candidates = [
      record.paymentReferenceRideId,
      record.temporaryRideId,
      record.materializedFrom
    ]
      .map((value) => String(value || '').trim())
      .filter((value) => value && value !== normalizedCanonicalRideId);
    const uniqueCandidates = Array.from(new Set(candidates));
    return uniqueCandidates.length === 1 ? uniqueCandidates[0] : null;
  }

  async updateSandboxCanonicalRecordAndAlias({
    firestore,
    collectionName,
    canonicalRideId,
    updatePayload,
    financialContext
  }) {
    const normalizedCanonicalRideId = String(canonicalRideId || '').trim();
    if (!firestore || !collectionName || !normalizedCanonicalRideId) {
      throw new Error('Referência canônica sandbox inválida para sincronização de alias');
    }
    if (financialContext?.namespace !== 'sandbox') {
      throw new Error('Sincronização de alias restrita ao namespace sandbox');
    }

    const canonicalRef = firestore.collection(collectionName).doc(normalizedCanonicalRideId);
    const result = await firestore.runTransaction(async (transaction) => {
      const canonicalSnapshot = await transaction.get(canonicalRef);
      const canonicalRecord = canonicalSnapshot.exists ? canonicalSnapshot.data() || {} : {};
      const canonicalContextResult = canonicalSnapshot.exists
        ? resolveFinancialContext(canonicalRecord)
        : { ok: true, context: financialContext };
      if (!canonicalContextResult.ok || !contextsMatch(canonicalContextResult.context, financialContext)) {
        const error = new Error('Contexto financeiro do registro canônico sandbox diverge da atualização');
        error.code = 'FINANCIAL_CONTEXT_CONFLICT';
        throw error;
      }

      const aliasId = this.resolveMaterializedPaymentAliasId(
        canonicalRecord,
        normalizedCanonicalRideId
      );
      let aliasRef = null;
      let aliasRecord = null;
      let aliasSkippedReason = aliasId ? null : 'ALIAS_REFERENCE_MISSING_OR_AMBIGUOUS';

      if (aliasId) {
        aliasRef = firestore.collection(collectionName).doc(aliasId);
        const aliasSnapshot = await transaction.get(aliasRef);
        if (!aliasSnapshot.exists) {
          aliasSkippedReason = 'ALIAS_DOCUMENT_MISSING';
          aliasRef = null;
        } else {
          aliasRecord = aliasSnapshot.data() || {};
          const aliasContextResult = resolveFinancialContext(aliasRecord);
          const canonicalChargeId = String(
            canonicalRecord.chargeId || canonicalRecord.paymentId || ''
          ).trim();
          const aliasChargeId = String(aliasRecord.chargeId || aliasRecord.paymentId || '').trim();
          if (!aliasContextResult.ok || !contextsMatch(aliasContextResult.context, financialContext)) {
            aliasSkippedReason = 'ALIAS_FINANCIAL_CONTEXT_MISMATCH';
            aliasRef = null;
          } else if (canonicalChargeId && aliasChargeId && canonicalChargeId !== aliasChargeId) {
            aliasSkippedReason = 'ALIAS_CHARGE_MISMATCH';
            aliasRef = null;
          }
        }
      }

      transaction.set(canonicalRef, updatePayload, { merge: true });
      if (aliasRef) {
        transaction.set(aliasRef, {
          ...updatePayload,
          canonicalRideId: normalizedCanonicalRideId,
          bookingId: normalizedCanonicalRideId,
          temporaryRideId: aliasId,
          paymentReferenceRideId: aliasId,
          financialContext,
          financialNamespace: financialContext.namespace,
          financialContextId: financialContext.contextId
        }, { merge: true });
      }

      return {
        aliasId: aliasId || null,
        aliasUpdated: Boolean(aliasRef),
        aliasSkippedReason
      };
    });

    if (result.aliasSkippedReason && result.aliasSkippedReason !== 'ALIAS_REFERENCE_MISSING_OR_AMBIGUOUS') {
      logStructured('warn', 'Alias sandbox de pagamento não foi sincronizado', {
        service: 'payment-service',
        collectionName,
        canonicalRideId: normalizedCanonicalRideId,
        aliasId: result.aliasId,
        reason: result.aliasSkippedReason
      });
    }
    return result;
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
      const paymentIntent = await this.getAdvancePaymentIntentByChargeId(normalizedChargeId);
      if (!paymentIntent.found) return null;
      const providerEnvironment = String(paymentIntent.providerEnvironment || '').trim().toLowerCase();
      if (!providerEnvironment) return null;

      return {
        wooviConfig: getWooviConfig({ environment: providerEnvironment }),
        paymentIntentId: paymentIntent.paymentIntentId,
        providerEnvironment,
        paymentProfileId: paymentIntent.paymentProfileId || null,
        financialContext: paymentIntent.financialContext
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
}

module.exports = PaymentServiceEventsAndStatusCacheMethods;
