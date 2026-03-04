const WooviDriverService = require('./woovi-driver-service');
const firebaseConfig = require('../firebase-config');
const admin = require('firebase-admin');
const circuitBreakerService = require('./circuit-breaker-service');
const { logStructured, logError } = require('../utils/logger');
const traceContext = require('../utils/trace-context');

class PaymentService {
  constructor() {
    this.LEAF_ACCOUNT_ID = process.env.LEAF_WOOVI_ACCOUNT_ID || 'leaf-main-account';
    // Chave Pix da conta Leaf (origem das transferências)
    // ⚠️ ATENÇÃO: Configurar LEAF_PIX_KEY em produção via variável de ambiente
    this.LEAF_PIX_KEY = process.env.LEAF_PIX_KEY || 'test@leaf.app.br'; // ⚠️ Valor de teste - configurar em produção
    // Criar instância do WooviDriverService
    this.wooviDriverService = new WooviDriverService();
    // Taxas operacionais por faixa de valor
    this.OPERATIONAL_FEE_UP_TO_10 = 79; // R$ 0,79 para corridas até R$ 10,00 (em centavos)
    this.OPERATIONAL_FEE_10_TO_25 = 99; // R$ 0,99 para corridas acima de R$ 10,00 e abaixo de R$ 25,00 (em centavos)
    this.OPERATIONAL_FEE_ABOVE_25 = 149; // R$ 1,49 para corridas acima de R$ 25,00 (em centavos)
    this.THRESHOLD_10 = 1000; // R$ 10,00 em centavos
    this.THRESHOLD_25 = 2500; // R$ 25,00 em centavos
    this.WOOVI_FEE_PERCENTAGE = 0.008; // 0,8% da transação
    this.WOOVI_FEE_MINIMUM = 50; // R$ 0,50 mínimo (em centavos)

    // Configuração de retry
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 segundo

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
      logStructured('info', 'Processando pagamento antecipado', {
        service: 'PaymentService',
        passengerId: paymentData.passengerId,
        amount: paymentData.amount,
        rideId: paymentData.rideId,
        passengerName: paymentData.passengerName,
        passengerEmail: paymentData.passengerEmail
      });

      // 1. Criar cobrança PIX para o passageiro
      const commentRaw = `Corrida Leaf - ${paymentData.rideDetails.origin} para ${paymentData.rideDetails.destination}`;
      const comment =
        commentRaw.length > 140 ? `${commentRaw.slice(0, 137)}...` : commentRaw;

      // ✅ Garantir correlationID único (inclui timestamp + random para evitar duplicatas)
      const timestamp = Date.now();
      const randomSuffix = Math.random().toString(36).substring(2, 9);
      const uniqueCorrelationID = `ride_${paymentData.rideId}_${timestamp}_${randomSuffix}`;

      logStructured('debug', 'Gerando correlationID único', { service: 'PaymentService', correlationID: uniqueCorrelationID });

      const chargeData = {
        value: paymentData.amount,
        comment,
        correlationID: uniqueCorrelationID,
        additionalInfo: [
          { key: 'passenger_id', value: paymentData.passengerId },
          { key: 'ride_id', value: paymentData.rideId },
          { key: 'payment_type', value: 'advance_payment' },
          { key: 'service', value: 'ride_sharing' }
        ],
        customer: {
          name: paymentData.passengerName || 'Passageiro Leaf',
          email: paymentData.passengerEmail || 'passenger@leaf.com'
        }
      };

      logStructured('info', 'Enviando cobrança para Woovi', {
        service: 'PaymentService',
        value: chargeData.value,
        comment: chargeData.comment,
        correlationID: chargeData.correlationID,
        customerName: chargeData.customer.name,
        customerEmail: chargeData.customer.email
      });

      const chargeResult = await this.wooviDriverService.createCharge(chargeData);

      if (!chargeResult.success) {
        logError(error, 'Erro ao criar cobrança na Woovi', {
          service: 'PaymentService',
          error: chargeResult.error,
          details: chargeResult.details,
          correlationID: chargeData.correlationID
        });
        return {
          success: false,
          error: 'Falha ao criar cobrança PIX',
          details: chargeResult.error || chargeResult.details
        };
      }

      logStructured('info', 'Cobrança criada com sucesso', {
        service: 'PaymentService',
        chargeId: chargeResult.charge?.id,
        correlationID: chargeData.correlationID
      });

      // ✅ SIMPLIFICADO: Apenas criar cobrança, sem holding
      // Quando pagamento for confirmado, creditar saldo diretamente no motorista

      return {
        success: true,
        message: 'Pagamento antecipado processado com sucesso',
        chargeId: chargeResult.charge.id,
        qrCode: chargeResult.charge.qrCodeImage,
        paymentLink: chargeResult.charge.paymentLinkUrl,
        rideId: paymentData.rideId,
        amount: paymentData.amount
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

      await firestore.collection('ride_payments').doc(rideId).set(updates, { merge: true });

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
   * Calcula valor líquido para o motorista (Imunizando Pedágio)
   * @param {number} totalAmount - Valor total da corrida em centavos
   * @param {number} tollFee - Valor do pedágio em centavos (padrão 0)
   * @returns {Object} - Cálculo detalhado
   */
  calculateNetAmount(totalAmount, tollFee = 0) {
    const grossFare = Math.max(0, totalAmount - tollFee);

    // Calcular taxa operacional baseada no valor da corrida (sem o pedágio)
    let operationalFee;
    let operationalFeeType;

    if (grossFare <= this.THRESHOLD_10) {
      // Até R$ 10,00
      operationalFee = this.OPERATIONAL_FEE_UP_TO_10;
      operationalFeeType = 'up_to_10';
    } else if (grossFare <= this.THRESHOLD_25) {
      // Acima de R$ 10,00 e abaixo de R$ 25,00
      operationalFee = this.OPERATIONAL_FEE_10_TO_25;
      operationalFeeType = '10_to_25';
    } else {
      // Acima de R$ 25,00
      operationalFee = this.OPERATIONAL_FEE_ABOVE_25;
      operationalFeeType = 'above_25';
    }

    // Taxa Woovi: 0,8% com mínimo de R$ 0,50 (calculada livre de pedágio)
    const wooviFeePercentage = Math.round(grossFare * this.WOOVI_FEE_PERCENTAGE);
    const wooviFee = Math.max(wooviFeePercentage, this.WOOVI_FEE_MINIMUM);

    // Retenho do lucro da plataforma, o pedágio volta 100% pro motorista
    const netGross = grossFare - operationalFee - wooviFee;
    const netAmount = Math.max(0, netGross) + tollFee;

    return {
      totalAmount: totalAmount,
      tollFee: tollFee,
      operationalFee: operationalFee,
      wooviFee: wooviFee,
      netAmount: Math.max(0, netAmount), // Não pode ser negativo
      breakdown: {
        total: (totalAmount / 100).toFixed(2),
        tollFee: (tollFee / 100).toFixed(2),
        operationalFeeType: operationalFeeType,
        operationalFee: (operationalFee / 100).toFixed(2),
        wooviFee: (wooviFee / 100).toFixed(2),
        net: (Math.max(0, netAmount) / 100).toFixed(2)
      }
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

      // 1.5. Lógica de Retenção Punitiva (Split de Carência - 50%)
      let retainedFees = 0;
      if (rideData.driverId) {
        try {
          const firestore = firebaseConfig.getFirestore();
          const userRef = firestore.collection('users').doc(rideData.driverId);

          await firestore.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (userDoc.exists) {
              const userData = userDoc.data();
              const driverProfile = userData.driverProfile || {};

              if (driverProfile.subscriptionStatus === 'GRACE_PERIOD' && driverProfile.pendingFee > 0) {
                // Retém até 50% do valor líquido ou o total da dívida, o que for menor
                const maxSplit = Math.floor(netCalculation.netAmount / 2);
                retainedFees = Math.min(maxSplit, driverProfile.pendingFee);

                driverProfile.pendingFee -= retainedFees;
                if (driverProfile.pendingFee <= 0) {
                  driverProfile.subscriptionStatus = 'ACTIVE';
                }

                transaction.set(userRef, { driverProfile }, { merge: true });

                netCalculation.netAmount -= retainedFees; // Atualiza o valor que vai pro motorista

                logStructured('info', 'Retenção de Carência Aplicada', {
                  service: 'PaymentService',
                  driverId: rideData.driverId,
                  retainedAmount: retainedFees,
                  remainingDebt: driverProfile.pendingFee,
                  newNetAmount: netCalculation.netAmount
                });
              }
            }
          });
        } catch (err) {
          logStructured('warn', 'Falha ao processar Split Punitivo', { service: 'PaymentService', error: err.message });
        }
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
      if (driverPixKey && this.LEAF_PIX_KEY && this.LEAF_PIX_KEY !== 'test@leaf.app.br') {
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
              this.LEAF_PIX_KEY
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
        logStructured('info', 'Usando sistema de saldo no Firestore (BaaS não configurado)', { service: 'PaymentService' });
      }

      // 3. ✅ NOVO: Creditar saldo diretamente no Firestore (substitui BaaS temporariamente)
      const creditResult = await this.creditDriverBalance(
        rideData.driverId,
        netCalculation.netAmount,
        rideData.rideId
      );

      if (!creditResult.success) {
        logError(new Error(creditResult.error), 'Erro ao creditar saldo do motorista', { service: 'PaymentService' });
        // Continuar mesmo se falhar (não bloquear distribuição)
      } else {
        logStructured('info', 'Saldo creditado com sucesso', { service: 'PaymentService', balance: creditResult.balance });
      }

      // 4. Atualizar status do holding para distribuído
      const distributionData = {
        rideId: rideData.rideId,
        driverId: rideData.driverId,
        status: 'distributed',
        distributedAt: new Date().toISOString(),
        netAmount: netCalculation.netAmount,
        retainedFees: retainedFees,
        transferId: transferId || null, // ID da transferência (se BaaS estiver disponível)
        balanceCreditId: creditResult.balanceId || null, // ID do crédito no Firestore
        calculation: netCalculation,
        // Taxas retidas na conta Leaf (não transferidas)
        retainedFees: {
          operationalFee: netCalculation.operationalFee,
          wooviFee: netCalculation.wooviFee,
          totalRetained: netCalculation.operationalFee + netCalculation.wooviFee
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
          balanceCreditId: creditResult.balanceId,
          retainedFees: distributionData.retainedFees
        }
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

      // Creditar via Firestore
      const creditResult = await this.creditDriverBalance(
        rideData.driverId,
        netAmount,
        `cancel_${rideData.rideId}` // prefix para rastreabilidade
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
        balanceCreditId: creditResult.balanceId || null,
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

      const balanceRef = firestore.collection('driver_balances').doc(driverId);
      const amountInReais = amount / 100; // Converter centavos para reais

      // Usar transação para garantir consistência
      const result = await firestore.runTransaction(async (transaction) => {
        const balanceDoc = await transaction.get(balanceRef);

        let currentBalance = 0;
        let totalEarnings = 0;

        if (balanceDoc.exists) {
          const data = balanceDoc.data();
          currentBalance = data.balance || 0;
          totalEarnings = data.totalEarnings || 0;
        }

        const newBalance = currentBalance + amountInReais;
        const newTotalEarnings = totalEarnings + amountInReais;

        // Atualizar saldo
        transaction.set(balanceRef, {
          driverId: driverId,
          balance: newBalance,
          totalEarnings: newTotalEarnings,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
          lastRideId: rideId,
          lastCreditAmount: amountInReais
        }, { merge: true });

        return {
          success: true,
          previousBalance: currentBalance,
          newBalance: newBalance,
          creditAmount: amountInReais,
          balanceId: driverId
        };
      });

      // Salvar histórico da transação
      if (result.success) {
        const historyRef = firestore
          .collection('driver_balances')
          .doc(driverId)
          .collection('transactions')
          .doc();

        await historyRef.set({
          type: 'credit',
          amount: amountInReais,
          amountInCents: amount,
          rideId: rideId,
          previousBalance: result.previousBalance,
          newBalance: result.newBalance,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          description: `Ganhos da corrida ${rideId}`
        });

        logStructured('info', 'Saldo creditado para motorista', {
          service: 'payment-service',
          driverId,
          rideId,
          amount: amountInReais.toFixed(2),
          previousBalance: result.previousBalance.toFixed(2),
          newBalance: result.newBalance.toFixed(2)
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

      if (!balanceDoc.exists) {
        return {
          success: true,
          balance: 0,
          totalEarnings: 0,
          message: 'Motorista ainda não possui saldo'
        };
      }

      const data = balanceDoc.data();

      return {
        success: true,
        balance: data.balance || 0,
        totalEarnings: data.totalEarnings || 0,
        lastUpdated: data.lastUpdated?.toDate?.() || null,
        lastRideId: data.lastRideId || null
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
   * Verifica status de um pagamento via chargeId na Woovi
   * @param {string} chargeId - ID da cobrança na Woovi (ou bookingId para testes)
   * @returns {Promise<Object>} - Status do pagamento
   */
  async getPaymentStatus(chargeId) {
    try {
      if (!chargeId) {
        return {
          success: false,
          error: 'chargeId é obrigatório'
        };
      }

      // ✅ NOVO: Primeiro verificar se existe payment holding no Firestore (para testes)
      try {
        const firestore = firebaseConfig.getFirestore();
        if (firestore) {
          const holdingRef = firestore.collection('payment_holdings').doc(chargeId);
          const holdingDoc = await holdingRef.get();

          if (holdingDoc.exists) {
            const holdingData = holdingDoc.data();
            logStructured('info', 'Payment holding encontrado no Firestore', { service: 'payment-service', chargeId, status: holdingData.status });
            return {
              success: true,
              status: holdingData.status, // in_holding, distributed, etc
              amount: holdingData.amount || 0,
              amountInReais: holdingData.amount ? (holdingData.amount / 100) : 0,
              chargeId: chargeId,
              paidAt: holdingData.paidAt || null
            };
          } else {
            // ✅ NOVO: Se não encontrou no Firestore, retornar "não encontrado" explicitamente
            logStructured('warn', 'Payment holding não encontrado no Firestore', { service: 'payment-service', chargeId });
            return {
              success: false,
              error: 'Pagamento não encontrado',
              status: null,
              code: 'PAYMENT_NOT_FOUND'
            };
          }
        }
      } catch (firestoreError) {
        logStructured('debug', 'Erro ao verificar Firestore (continuando para Woovi)', { service: 'payment-service', error: firestoreError.message });
      }

      // Verificar status diretamente na Woovi (produção)
      // ✅ Se Woovi falhar, não retornar erro se não for crítico
      try {
        const chargeStatus = await this.wooviDriverService.getChargeStatus(chargeId);

        if (chargeStatus.success) {
          return {
            success: true,
            status: chargeStatus.status === 'COMPLETED' ? 'in_holding' : chargeStatus.status, // Converter COMPLETED para in_holding
            amount: chargeStatus.amount,
            amountInReais: chargeStatus.amount ? (chargeStatus.amount / 100) : 0,
            chargeId: chargeId,
            paidAt: chargeStatus.status === 'COMPLETED' ? chargeStatus.paidAt : null
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
