const crypto = require('crypto');
const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const { validateAuthoritativeFinancialSnapshot } = require('./ride-financial-contract');
const { logStructured, logError } = require('../utils/logger');

class FinancialLedgerService {
  toCents(value) {
    const cents = Math.round(Number(value));
    return Number.isFinite(cents) ? cents : 0;
  }

  buildEventId(namespace, parts = []) {
    const source = [namespace, ...parts].map((part) => String(part || '')).join(':');
    const hash = crypto.createHash('sha256').update(source).digest('hex').slice(0, 32);
    return `${namespace}_${hash}`;
  }

  isTestRideId(rideId) {
    return /(^|_)ride_e2e_|^ride_normal_|dispatch_smoke|_smoke$|(^|_)test(_|$)|(^|_)mock(_|$)/i.test(String(rideId || ''));
  }

  normalizeBoolean(value) {
    return ['true', '1', 'yes', 'sim'].includes(String(value || '').toLowerCase());
  }

  sumLedgerLineAmounts(event = {}, account) {
    return (Array.isArray(event?.lines) ? event.lines : [])
      .filter((line) => line?.account === account && line?.direction === 'credit')
      .reduce((sum, line) => sum + this.toCents(line.amountCents), 0);
  }

  normalizeLine(line = {}, index = 0) {
    const direction = String(line.direction || '').toLowerCase();
    const amountCents = this.toCents(line.amountCents);

    return {
      lineIndex: index,
      account: String(line.account || '').trim(),
      direction,
      amountCents,
      entityType: line.entityType || null,
      entityId: line.entityId || null,
      memo: line.memo || null
    };
  }

  validateLines(lines = []) {
    const normalizedLines = lines.map((line, index) => this.normalizeLine(line, index));
    const invalidLine = normalizedLines.find((line) => (
      !line.account ||
      !['debit', 'credit'].includes(line.direction) ||
      !Number.isFinite(line.amountCents) ||
      line.amountCents <= 0
    ));

    if (invalidLine) {
      return {
        ok: false,
        code: 'LEDGER_INVALID_LINE',
        error: 'Linha contábil inválida',
        invalidLine
      };
    }

    const totalDebitCents = normalizedLines
      .filter((line) => line.direction === 'debit')
      .reduce((sum, line) => sum + line.amountCents, 0);
    const totalCreditCents = normalizedLines
      .filter((line) => line.direction === 'credit')
      .reduce((sum, line) => sum + line.amountCents, 0);

    if (totalDebitCents <= 0 || totalDebitCents !== totalCreditCents) {
      return {
        ok: false,
        code: 'LEDGER_UNBALANCED_EVENT',
        error: 'Evento contábil não está balanceado',
        totalDebitCents,
        totalCreditCents
      };
    }

    return {
      ok: true,
      lines: normalizedLines,
      totalDebitCents,
      totalCreditCents
    };
  }

  buildBalanceHash({ eventType, rideId, driverId, passengerId, chargeId, withdrawalId, refundId, lines }) {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify({
        eventType,
        rideId: rideId || null,
        driverId: driverId || null,
        passengerId: passengerId || null,
        chargeId: chargeId || null,
        withdrawalId: withdrawalId || null,
        refundId: refundId || null,
        lines: lines.map((line) => ({
          account: line.account,
          direction: line.direction,
          amountCents: line.amountCents,
          entityType: line.entityType,
          entityId: line.entityId
        }))
      }))
      .digest('hex');
  }

  async recordBalancedEvent(event = {}) {
    const validation = this.validateLines(event.lines || []);
    if (!validation.ok) {
      return {
        success: false,
        ...validation
      };
    }

    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      return {
        success: false,
        code: 'LEDGER_FIRESTORE_UNAVAILABLE',
        error: 'Firestore não disponível para ledger financeiro'
      };
    }

    const eventId = event.eventId || this.buildEventId(event.eventType || 'ledger_event', [
      event.rideId,
      event.driverId,
      event.passengerId,
      event.chargeId,
      event.withdrawalId,
      event.refundId,
      validation.totalDebitCents
    ]);
    const balanceHash = this.buildBalanceHash({
      ...event,
      lines: validation.lines
    });
    const eventRef = firestore.collection('financial_ledger_events').doc(eventId);
    const lineCollection = firestore.collection('financial_ledger_lines');

    try {
      const result = await firestore.runTransaction(async (transaction) => {
        const eventDoc = await transaction.get(eventRef);
        if (eventDoc.exists) {
          const existing = eventDoc.data() || {};
          if (existing.balanceHash && existing.balanceHash !== balanceHash) {
            return {
              success: false,
              code: 'LEDGER_EVENT_CONFLICT',
              error: 'Evento contábil já existe com outro conteúdo',
              eventId
            };
          }

          return {
            success: true,
            idempotentReplay: true,
            eventId,
            totalDebitCents: existing.totalDebitCents || validation.totalDebitCents,
            totalCreditCents: existing.totalCreditCents || validation.totalCreditCents
          };
        }

        const nowIso = new Date().toISOString();
        transaction.set(eventRef, {
          eventId,
          eventType: event.eventType || 'ledger_event',
          source: event.source || 'system',
          rideId: event.rideId || null,
          driverId: event.driverId || null,
          passengerId: event.passengerId || null,
          chargeId: event.chargeId || null,
          withdrawalId: event.withdrawalId || null,
          refundId: event.refundId || null,
          status: 'posted',
          currency: 'BRL',
          totalDebitCents: validation.totalDebitCents,
          totalCreditCents: validation.totalCreditCents,
          lineCount: validation.lines.length,
          balanced: true,
          balanceHash,
          lines: validation.lines,
          metadata: event.metadata || {},
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          createdAtIso: nowIso,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtIso: nowIso
        });

        validation.lines.forEach((line) => {
          const lineRef = lineCollection.doc(`${eventId}_${line.lineIndex}`);
          transaction.set(lineRef, {
            ...line,
            eventId,
            eventType: event.eventType || 'ledger_event',
            rideId: event.rideId || null,
            driverId: event.driverId || null,
            passengerId: event.passengerId || null,
            chargeId: event.chargeId || null,
            withdrawalId: event.withdrawalId || null,
            refundId: event.refundId || null,
            currency: 'BRL',
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdAtIso: nowIso
          });
        });

        return {
          success: true,
          eventId,
          totalDebitCents: validation.totalDebitCents,
          totalCreditCents: validation.totalCreditCents
        };
      });

      if (result.success) {
        logStructured('info', result.idempotentReplay ? 'Ledger financeiro já registrado' : 'Ledger financeiro registrado', {
          service: 'financial-ledger-service',
          eventId,
          eventType: event.eventType || 'ledger_event',
          rideId: event.rideId || null,
          idempotentReplay: Boolean(result.idempotentReplay)
        });
      }

      return result;
    } catch (error) {
      logError(error, 'Erro ao registrar ledger financeiro', {
        service: 'financial-ledger-service',
        eventId,
        eventType: event.eventType || 'ledger_event',
        rideId: event.rideId || null
      });
      return {
        success: false,
        code: 'LEDGER_WRITE_FAILED',
        error: error.message,
        eventId
      };
    }
  }

  recordPaymentReceived({ rideId, chargeId, amountCents, passengerId, metadata = {} }) {
    const amount = this.toCents(amountCents);
    return this.recordBalancedEvent({
      eventId: this.buildEventId('payment_received', [rideId, chargeId, amount]),
      eventType: 'payment_received',
      source: 'woovi_webhook',
      rideId,
      chargeId,
      passengerId,
      metadata,
      lines: [
        {
          account: 'asset:leaf_cash_pix',
          direction: 'debit',
          amountCents: amount,
          entityType: 'charge',
          entityId: chargeId,
          memo: 'Pix recebido do passageiro'
        },
        {
          account: 'liability:ride_payment_holding',
          direction: 'credit',
          amountCents: amount,
          entityType: 'ride',
          entityId: rideId,
          memo: 'Valor recebido aguardando conclusão da corrida'
        }
      ]
    });
  }

  recordRideSettlement({ rideId, driverId, totalAmountCents, netAmountCents, operationalFeeCents, wooviFeeCents, retainedFeeCents = 0, metadata = {} }) {
    const totalAmount = this.toCents(totalAmountCents);
    const netAmount = this.toCents(netAmountCents);
    const operationalFee = this.toCents(operationalFeeCents);
    const wooviFee = this.toCents(wooviFeeCents);
    const retainedFee = Math.max(0, this.toCents(retainedFeeCents));
    const lines = [
      {
        account: 'liability:ride_payment_holding',
        direction: 'debit',
        amountCents: totalAmount,
        entityType: 'ride',
        entityId: rideId,
        memo: 'Baixa do holding após corrida concluída'
      }
    ];

    if (netAmount > 0) {
      lines.push({
        account: 'liability:driver_balance_payable',
        direction: 'credit',
        amountCents: netAmount,
        entityType: 'driver',
        entityId: driverId,
        memo: 'Saldo líquido devido ao motorista'
      });
    }

    if (operationalFee > 0) {
      lines.push({
        account: 'revenue:leaf_operational_fee',
        direction: 'credit',
        amountCents: operationalFee,
        entityType: 'ride',
        entityId: rideId,
        memo: 'Taxa operacional Leaf'
      });
    }

    if (wooviFee > 0) {
      lines.push({
        account: 'contra_revenue:payment_intermediation_fee',
        direction: 'credit',
        amountCents: wooviFee,
        entityType: 'ride',
        entityId: rideId,
        memo: 'Custo/intermediação de pagamento retido no settlement'
      });
    }

    if (retainedFee > 0) {
      lines.push({
        account: 'revenue:driver_subscription_settlement',
        direction: 'credit',
        amountCents: retainedFee,
        entityType: 'driver',
        entityId: driverId,
        memo: 'Retenção de assinatura no settlement'
      });
    }

    return this.recordBalancedEvent({
      eventId: this.buildEventId('ride_settlement', [rideId, driverId, totalAmount]),
      eventType: 'ride_settlement',
      source: 'billing_worker',
      rideId,
      driverId,
      metadata,
      lines
    });
  }

  recordCancellationSettlement({ rideId, driverId, cancellationFeeCents, netAmountCents, wooviFeeCents, metadata = {} }) {
    const cancellationFee = this.toCents(cancellationFeeCents);
    const netAmount = this.toCents(netAmountCents);
    const wooviFee = this.toCents(wooviFeeCents);

    return this.recordBalancedEvent({
      eventId: this.buildEventId('cancellation_settlement', [rideId, driverId, cancellationFee]),
      eventType: 'cancellation_settlement',
      source: 'billing_worker',
      rideId,
      driverId,
      metadata,
      lines: [
        {
          account: 'liability:ride_payment_holding',
          direction: 'debit',
          amountCents: cancellationFee,
          entityType: 'ride',
          entityId: rideId,
          memo: 'Baixa do holding por multa de cancelamento/no-show'
        },
        {
          account: 'liability:driver_balance_payable',
          direction: 'credit',
          amountCents: netAmount,
          entityType: 'driver',
          entityId: driverId,
          memo: 'Saldo líquido de multa devido ao motorista'
        },
        {
          account: 'contra_revenue:payment_intermediation_fee',
          direction: 'credit',
          amountCents: wooviFee,
          entityType: 'ride',
          entityId: rideId,
          memo: 'Custo/intermediação de pagamento retido no cancelamento'
        }
      ]
    });
  }

  recordRefund({ rideId, chargeId, refundId, amountCents, passengerId, reason, metadata = {} }) {
    const amount = this.toCents(amountCents);
    return this.recordBalancedEvent({
      eventId: this.buildEventId('refund_processed', [rideId, chargeId, refundId, amount]),
      eventType: 'refund_processed',
      source: 'payment_service',
      rideId,
      chargeId,
      refundId,
      passengerId,
      metadata: {
        ...metadata,
        reason: reason || null
      },
      lines: [
        {
          account: 'liability:ride_payment_holding',
          direction: 'debit',
          amountCents: amount,
          entityType: 'ride',
          entityId: rideId,
          memo: 'Baixa do holding por reembolso'
        },
        {
          account: 'asset:leaf_cash_pix',
          direction: 'credit',
          amountCents: amount,
          entityType: 'charge',
          entityId: chargeId,
          memo: 'Saída de caixa para reembolso'
        }
      ]
    });
  }

  recordWithdrawalRequested({ withdrawalId, driverId, amountCents, withdrawFeeCents = 0, subscriptionSettlementCents = 0, requestId, metadata = {} }) {
    const amount = this.toCents(amountCents);
    const fee = Math.max(0, this.toCents(withdrawFeeCents));
    const subscription = Math.max(0, this.toCents(subscriptionSettlementCents));
    const totalDebit = amount + fee + subscription;
    const lines = [
      {
        account: 'liability:driver_balance_payable',
        direction: 'debit',
        amountCents: totalDebit,
        entityType: 'driver',
        entityId: driverId,
        memo: 'Baixa do saldo disponível por solicitação de saque'
      },
      {
        account: 'liability:driver_withdrawal_pending',
        direction: 'credit',
        amountCents: amount,
        entityType: 'withdrawal',
        entityId: withdrawalId,
        memo: 'Saque solicitado e pendente de Pix Out'
      }
    ];

    if (fee > 0) {
      lines.push({
        account: 'revenue:withdrawal_fee',
        direction: 'credit',
        amountCents: fee,
        entityType: 'withdrawal',
        entityId: withdrawalId,
        memo: 'Tarifa de saque abaixo do limite'
      });
    }

    if (subscription > 0) {
      lines.push({
        account: 'revenue:driver_subscription_settlement',
        direction: 'credit',
        amountCents: subscription,
        entityType: 'driver',
        entityId: driverId,
        memo: 'Liquidação de assinatura no saque'
      });
    }

    return this.recordBalancedEvent({
      eventId: this.buildEventId('withdrawal_requested', [driverId, requestId, withdrawalId, totalDebit]),
      eventType: 'withdrawal_requested',
      source: 'mobile_app',
      driverId,
      withdrawalId,
      metadata: {
        ...metadata,
        requestId: requestId || null
      },
      lines
    });
  }

  recordWithdrawalProcessed({ withdrawalId, driverId, amountCents, transferId, metadata = {} }) {
    const amount = this.toCents(amountCents);
    return this.recordBalancedEvent({
      eventId: this.buildEventId('withdrawal_processed', [driverId, withdrawalId, transferId, amount]),
      eventType: 'withdrawal_processed',
      source: 'payment_service',
      driverId,
      withdrawalId,
      metadata: {
        ...metadata,
        transferId: transferId || null
      },
      lines: [
        {
          account: 'liability:driver_withdrawal_pending',
          direction: 'debit',
          amountCents: amount,
          entityType: 'withdrawal',
          entityId: withdrawalId,
          memo: 'Baixa de saque pendente após Pix Out'
        },
        {
          account: 'asset:leaf_cash_pix',
          direction: 'credit',
          amountCents: amount,
          entityType: 'withdrawal',
          entityId: withdrawalId,
          memo: 'Saída de caixa para motorista'
        }
      ]
    });
  }

  async listLedgerEventsByRide(firestore, rideId) {
    const snapshot = await firestore
      .collection('financial_ledger_events')
      .where('rideId', '==', rideId)
      .limit(100)
      .get();
    const events = [];
    snapshot.forEach((doc) => events.push({ id: doc.id, ...doc.data() }));
    return events;
  }

  resolveLedgerRideIds({ rideId, payment = null, holding = null } = {}) {
    const rideIds = new Set();
    const addRideId = (value) => {
      const normalized = String(value || '').trim();
      if (normalized) rideIds.add(normalized);
    };
    const addDocumentReferences = (document) => {
      if (!document || typeof document !== 'object') return;
      addRideId(document.rideId);
      addRideId(document.canonicalRideId);
      addRideId(document.paymentReferenceRideId);
      addRideId(document.temporaryRideId);
      addRideId(document.materializedFrom);

      const additionalInfo = Array.isArray(document.metadata?.additionalInfo)
        ? document.metadata.additionalInfo
        : [];
      additionalInfo.forEach((item) => {
        if (String(item?.key || '').trim().toLowerCase() === 'ride_id') {
          addRideId(item?.value);
        }
      });
    };

    addRideId(rideId);
    addDocumentReferences(payment);
    addDocumentReferences(holding);
    return Array.from(rideIds);
  }

  async listLedgerEventsByRideIds(firestore, rideIds = []) {
    const eventGroups = await Promise.all(
      rideIds.map((currentRideId) => this.listLedgerEventsByRide(firestore, currentRideId))
    );
    const eventsById = new Map();
    eventGroups.flat().forEach((event) => {
      const key = event.id || event.eventId;
      if (key && !eventsById.has(key)) {
        eventsById.set(key, event);
      }
    });
    return Array.from(eventsById.values());
  }

  async listLedgerEventsByWithdrawal(firestore, withdrawalId) {
    const snapshot = await firestore
      .collection('financial_ledger_events')
      .where('withdrawalId', '==', withdrawalId)
      .limit(100)
      .get();
    const events = [];
    snapshot.forEach((doc) => events.push({ id: doc.id, ...doc.data() }));
    return events;
  }

  async reconcileWithdrawalFinancials({ withdrawalId } = {}) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore || !withdrawalId) {
      return {
        success: false,
        error: !withdrawalId ? 'withdrawalId é obrigatório' : 'Firestore não disponível'
      };
    }

    try {
      const withdrawalDoc = await firestore.collection('driver_withdrawals').doc(withdrawalId).get();
      const ledgerEvents = await this.listLedgerEventsByWithdrawal(firestore, withdrawalId);
      const issues = [];
      const withdrawal = withdrawalDoc.exists ? withdrawalDoc.data() : null;
      const requestedEvent = ledgerEvents.find((event) => event.eventType === 'withdrawal_requested');
      const processedEvent = ledgerEvents.find((event) => event.eventType === 'withdrawal_processed');
      const amountCents = this.toCents(withdrawal?.amountCents || 0);
      const totalDebitCents = this.toCents(
        withdrawal?.totalDebitCents
        || (amountCents + this.toCents(withdrawal?.feeCents || 0) + this.toCents(withdrawal?.subscriptionSettlementCents || 0))
      );

      if (!withdrawal) {
        issues.push({
          code: 'WITHDRAWAL_NOT_FOUND',
          severity: 'high',
          message: 'Saque não encontrado para reconciliação'
        });
      }

      if (withdrawal && amountCents > 0 && !requestedEvent) {
        issues.push({
          code: 'WITHDRAWAL_REQUEST_WITHOUT_LEDGER_EVENT',
          severity: 'high',
          message: 'Saque criado sem evento withdrawal_requested no ledger'
        });
      }

      if (withdrawal && withdrawal.ledgerStatus !== 'posted') {
        issues.push({
          code: 'WITHDRAWAL_REQUEST_LEDGER_NOT_POSTED',
          severity: 'high',
          message: 'Saque ainda não possui ledger de solicitação postado',
          ledgerStatus: withdrawal.ledgerStatus || null,
          status: withdrawal.status || null
        });
      }

      if (requestedEvent && totalDebitCents > 0 && this.toCents(requestedEvent.totalDebitCents) !== totalDebitCents) {
        issues.push({
          code: 'WITHDRAWAL_REQUEST_AMOUNT_MISMATCH',
          severity: 'high',
          message: 'Valor debitado no ledger diverge do total debitado no saque',
          ledgerAmountCents: this.toCents(requestedEvent.totalDebitCents),
          withdrawalTotalDebitCents: totalDebitCents
        });
      }

      if (withdrawal?.status === 'processed' && !processedEvent) {
        issues.push({
          code: 'WITHDRAWAL_PROCESSED_WITHOUT_LEDGER_EVENT',
          severity: 'critical',
          message: 'Saque marcado como processado sem evento withdrawal_processed no ledger'
        });
      }

      if (withdrawal?.status === 'processed_ledger_pending') {
        issues.push({
          code: 'WITHDRAWAL_PROCESSED_LEDGER_PENDING',
          severity: 'critical',
          message: 'Pix Out foi processado e o ledger de processamento segue pendente'
        });
      }

      if (processedEvent && amountCents > 0 && this.toCents(processedEvent.totalDebitCents) !== amountCents) {
        issues.push({
          code: 'WITHDRAWAL_PROCESSED_AMOUNT_MISMATCH',
          severity: 'critical',
          message: 'Valor do Pix Out no ledger diverge do valor solicitado para saque',
          ledgerAmountCents: this.toCents(processedEvent.totalDebitCents),
          withdrawalAmountCents: amountCents
        });
      }

      const report = {
        withdrawalId,
        driverId: withdrawal?.driverId || null,
        ok: issues.length === 0,
        issues,
        totals: {
          amountCents,
          totalDebitCents,
          ledgerEventCount: ledgerEvents.length,
          hasRequestedLedger: Boolean(requestedEvent),
          hasProcessedLedger: Boolean(processedEvent)
        },
        status: withdrawal?.status || null,
        ledgerStatus: withdrawal?.ledgerStatus || null,
        checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        checkedAtIso: new Date().toISOString()
      };

      await firestore.collection('financial_withdrawal_reconciliation_reports').doc(withdrawalId).set(report, { merge: true });

      return {
        success: true,
        report
      };
    } catch (error) {
      logError(error, 'Erro ao reconciliar fluxo financeiro de saque', {
        service: 'financial-ledger-service',
        withdrawalId
      });
      return {
        success: false,
        error: error.message,
        withdrawalId
      };
    }
  }

  async reconcileRideFinancials({ rideId } = {}) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore || !rideId) {
      return {
        success: false,
        error: !rideId ? 'rideId é obrigatório' : 'Firestore não disponível'
      };
    }

    try {
      const [paymentDoc, holdingDoc, distributionDoc] = await Promise.all([
        firestore.collection('ride_payments').doc(rideId).get(),
        firestore.collection('payment_holdings').doc(rideId).get(),
        firestore.collection('payment_distributions').doc(rideId).get()
      ]);
      const issues = [];
      const payment = paymentDoc.exists ? paymentDoc.data() : null;
      const holding = holdingDoc.exists ? holdingDoc.data() : null;
      const distribution = distributionDoc.exists ? distributionDoc.data() : null;
      const ledgerRideIds = this.resolveLedgerRideIds({ rideId, payment, holding });
      const ledgerEvents = await this.listLedgerEventsByRideIds(firestore, ledgerRideIds);

      const paymentAmount = this.toCents(payment?.amount || holding?.amount || 0);
      const distributionTotal = this.toCents(distribution?.calculation?.totalAmount || distribution?.totalAmount || 0);
      const settlementEvent = ledgerEvents.find((event) => event.eventType === 'ride_settlement');
      const paymentChargeId = String(payment?.chargeId || holding?.chargeId || '').trim();
      const paymentEvent = ledgerEvents.find((event) => (
        event.eventType === 'payment_received'
        && (!paymentChargeId || String(event.chargeId || '').trim() === paymentChargeId)
      ));

      if (payment && paymentAmount > 0 && !paymentEvent) {
        issues.push({
          code: 'PAYMENT_WITHOUT_LEDGER_EVENT',
          severity: 'high',
          message: 'Pagamento confirmado sem evento payment_received no ledger'
        });
      }

      if (paymentEvent && paymentAmount > 0 && this.toCents(paymentEvent.totalDebitCents) !== paymentAmount) {
        issues.push({
          code: 'PAYMENT_LEDGER_AMOUNT_MISMATCH',
          severity: 'high',
          message: 'Valor do pagamento no ledger diverge do pagamento confirmado',
          ledgerAmountCents: this.toCents(paymentEvent.totalDebitCents),
          paymentAmountCents: paymentAmount
        });
      }

      if (distribution && distributionTotal > 0 && !settlementEvent) {
        issues.push({
          code: 'DISTRIBUTION_WITHOUT_LEDGER_EVENT',
          severity: 'high',
          message: 'Distribuição registrada sem evento ride_settlement no ledger'
        });
      }

      if (settlementEvent && distributionTotal > 0 && this.toCents(settlementEvent.totalDebitCents) !== distributionTotal) {
        issues.push({
          code: 'SETTLEMENT_AMOUNT_MISMATCH',
          severity: 'high',
          message: 'Valor do settlement no ledger diverge da distribuição',
          ledgerAmountCents: this.toCents(settlementEvent.totalDebitCents),
          distributionTotalCents: distributionTotal
        });
      }

      const isManualOrMultiLegDistribution = ['manual_settlement_required', 'multi_leg']
        .includes(String(distribution?.mode || '').toLowerCase());
      const shouldRequireFinancialSnapshot = Boolean(distribution && distributionTotal > 0 && !isManualOrMultiLegDistribution);
      let financialSnapshot = null;
      if (shouldRequireFinancialSnapshot) {
        const snapshotValidation = validateAuthoritativeFinancialSnapshot(
          distribution?.calculation?.financialContract || distribution?.financialSnapshot || {},
          { passengerPaidCents: distributionTotal }
        );
        if (!snapshotValidation.valid) {
          issues.push({
            code: 'DISTRIBUTION_FINANCIAL_SNAPSHOT_INVALID',
            severity: 'high',
            message: 'Distribuição concluída sem snapshot financeiro backend_final válido',
            snapshotCode: snapshotValidation.code
          });
        } else {
          financialSnapshot = snapshotValidation.snapshot;
          const distributionNetAmount = this.toCents(distribution?.netAmount);
          const distributionOperationalFee = this.toCents(distribution?.retainedFees?.operationalFee);
          const distributionWooviFee = this.toCents(distribution?.retainedFees?.wooviFee);
          const distributionSubscriptionFee = this.toCents(distribution?.subscriptionRetainedFee);

          if (distributionNetAmount !== financialSnapshot.driverNetAmountCents) {
            issues.push({
              code: 'DISTRIBUTION_DRIVER_NET_MISMATCH',
              severity: 'high',
              message: 'Valor líquido da distribuição diverge do snapshot final',
              distributionNetAmountCents: distributionNetAmount,
              snapshotDriverNetAmountCents: financialSnapshot.driverNetAmountCents
            });
          }
          if (
            distributionOperationalFee !== financialSnapshot.operationalFeeCents ||
            distributionWooviFee !== financialSnapshot.paymentIntermediationFeeCents ||
            distributionSubscriptionFee !== financialSnapshot.subscriptionRetainedFeeCents
          ) {
            issues.push({
              code: 'DISTRIBUTION_RETAINED_FEES_MISMATCH',
              severity: 'high',
              message: 'Taxas retidas na distribuição divergem do snapshot final',
              distributionOperationalFeeCents: distributionOperationalFee,
              distributionWooviFeeCents: distributionWooviFee,
              distributionSubscriptionFeeCents: distributionSubscriptionFee,
              snapshotOperationalFeeCents: financialSnapshot.operationalFeeCents,
              snapshotWooviFeeCents: financialSnapshot.paymentIntermediationFeeCents,
              snapshotSubscriptionFeeCents: financialSnapshot.subscriptionRetainedFeeCents
            });
          }
          if (settlementEvent) {
            const ledgerDriverNetAmount = this.sumLedgerLineAmounts(
              settlementEvent,
              'liability:driver_balance_payable'
            );
            const ledgerOperationalFee = this.sumLedgerLineAmounts(
              settlementEvent,
              'revenue:leaf_operational_fee'
            );
            const ledgerWooviFee = this.sumLedgerLineAmounts(
              settlementEvent,
              'contra_revenue:payment_intermediation_fee'
            );
            const ledgerSubscriptionFee = this.sumLedgerLineAmounts(
              settlementEvent,
              'revenue:driver_subscription_settlement'
            );

            if (ledgerDriverNetAmount !== financialSnapshot.driverNetAmountCents) {
              issues.push({
                code: 'SETTLEMENT_DRIVER_NET_MISMATCH',
                severity: 'high',
                message: 'Valor líquido do ledger diverge do snapshot final',
                ledgerDriverNetAmountCents: ledgerDriverNetAmount,
                snapshotDriverNetAmountCents: financialSnapshot.driverNetAmountCents
              });
            }
            if (
              ledgerOperationalFee !== financialSnapshot.operationalFeeCents ||
              ledgerWooviFee !== financialSnapshot.paymentIntermediationFeeCents ||
              ledgerSubscriptionFee !== financialSnapshot.subscriptionRetainedFeeCents
            ) {
              issues.push({
                code: 'SETTLEMENT_RETAINED_FEES_MISMATCH',
                severity: 'high',
                message: 'Taxas do ledger divergem do snapshot final',
                ledgerOperationalFeeCents: ledgerOperationalFee,
                ledgerWooviFeeCents: ledgerWooviFee,
                ledgerSubscriptionFeeCents: ledgerSubscriptionFee,
                snapshotOperationalFeeCents: financialSnapshot.operationalFeeCents,
                snapshotWooviFeeCents: financialSnapshot.paymentIntermediationFeeCents,
                snapshotSubscriptionFeeCents: financialSnapshot.subscriptionRetainedFeeCents
              });
            }
          }
        }
      }

      const report = {
        rideId,
        ok: issues.length === 0,
        testData: this.isTestRideId(rideId),
        issues,
        totals: {
          paymentAmountCents: paymentAmount,
          distributionTotalCents: distributionTotal,
          ledgerEventCount: ledgerEvents.length,
          passengerGrossCents: financialSnapshot?.passengerPaidCents || null,
          driverNetAmountCents: financialSnapshot?.driverNetAmountCents || null,
          operationalFeeCents: financialSnapshot?.operationalFeeCents || null,
          wooviFeeCents: financialSnapshot?.paymentIntermediationFeeCents || null,
          subscriptionRetainedFeeCents: financialSnapshot?.subscriptionRetainedFeeCents || null
        },
        references: {
          ledgerRideIds,
          paymentLedgerRideId: paymentEvent?.rideId || null
        },
        checkedAt: admin.firestore.FieldValue.serverTimestamp(),
        checkedAtIso: new Date().toISOString()
      };

      await firestore.collection('financial_reconciliation_reports').doc(rideId).set(report, { merge: true });

      return {
        success: true,
        report
      };
    } catch (error) {
      logError(error, 'Erro ao reconciliar fluxo financeiro da corrida', {
        service: 'financial-ledger-service',
        rideId
      });
      return {
        success: false,
        error: error.message,
        rideId
      };
    }
  }

  getSnapshotDocs(snapshot) {
    if (!snapshot) return [];
    if (Array.isArray(snapshot.docs)) {
      return snapshot.docs.map((doc) => ({
        id: doc.id,
        data: typeof doc.data === 'function' ? doc.data() : {}
      }));
    }

    const docs = [];
    if (typeof snapshot.forEach === 'function') {
      snapshot.forEach((doc) => {
        docs.push({
          id: doc.id,
          data: typeof doc.data === 'function' ? doc.data() : {}
        });
      });
    }
    return docs;
  }

  async reconcileRecentRideFinancials({ rideId = null, limit = 100, includeTestData = false } = {}) {
    const firestore = firebaseConfig.getFirestore();
    if (!firestore) {
      return {
        success: false,
        error: 'Firestore não disponível'
      };
    }

    const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 500);
    const shouldIncludeTestData = this.normalizeBoolean(includeTestData);

    try {
      const rideIds = [];
      let skippedTestRideCount = 0;
      if (rideId) {
        rideIds.push(String(rideId));
      } else {
        let query = firestore.collection('ride_payments');
        if (typeof query.limit === 'function') {
          query = query.limit(shouldIncludeTestData ? safeLimit : Math.min(safeLimit * 5, 500));
        }

        const snapshot = await query.get();
        this.getSnapshotDocs(snapshot).forEach((doc) => {
          const resolvedRideId = doc.data?.rideId || doc.id;
          if (!resolvedRideId) return;
          if (!shouldIncludeTestData && this.isTestRideId(resolvedRideId)) {
            skippedTestRideCount += 1;
            return;
          }
          rideIds.push(String(resolvedRideId));
        });
      }

      const uniqueRideIds = Array.from(new Set(rideIds)).slice(0, safeLimit);
      const results = [];

      for (const currentRideId of uniqueRideIds) {
        const result = await this.reconcileRideFinancials({ rideId: currentRideId });
        results.push({
          rideId: currentRideId,
          success: Boolean(result.success),
          ok: Boolean(result.report?.ok),
          issueCount: result.report?.issues?.length || 0,
          error: result.error || null,
          report: result.report || null
        });
      }

      const failed = results.filter((result) => !result.success);
      const divergent = results.filter((result) => result.success && !result.ok);

      return {
        success: failed.length === 0,
        scannedRideCount: uniqueRideIds.length,
        reconciledRideCount: results.length - failed.length,
        divergentRideCount: divergent.length,
        failedRideCount: failed.length,
        skippedTestRideCount,
        includeTestData: shouldIncludeTestData,
        results
      };
    } catch (error) {
      logError(error, 'Erro ao reconciliar lote financeiro de corridas', {
        service: 'financial-ledger-service',
        rideId,
        limit: safeLimit
      });
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = FinancialLedgerService;
