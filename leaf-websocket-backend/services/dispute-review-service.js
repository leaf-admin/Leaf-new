const firebaseConfig = require('../firebase-config');
const PaymentService = require('./payment-service');

const DISPUTE_COLLECTION = 'ops_payment_disputes';
const DEFAULT_STATUS = 'OPEN';
const ALLOWED_STATUSES = new Set([
  'OPEN',
  'UNDER_REVIEW',
  'APPROVED_REFUND',
  'PARTIAL_REFUND',
  'DENIED',
  'CHARGEBACK_MONITORING',
  'CLOSED'
]);

function toIso(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    const dt = new Date(value);
    return Number.isNaN(dt.getTime()) ? fallback : dt.toISOString();
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    const dt = value.toDate();
    return Number.isNaN(dt.getTime()) ? fallback : dt.toISOString();
  }
  return fallback;
}

function normalizeDispute(disputeId, raw = {}) {
  const createdAt = toIso(raw.createdAt, new Date().toISOString());
  const updatedAt = toIso(raw.updatedAt, createdAt);
  const status = String(raw.status || DEFAULT_STATUS).toUpperCase();
  return {
    disputeId,
    bookingId: raw.bookingId || null,
    chargeId: raw.chargeId || null,
    userId: String(raw.userId || ''),
    userType: String(raw.userType || 'passenger'),
    incidentId: raw.incidentId || null,
    ticketId: raw.ticketId || null,
    reasonCode: raw.reasonCode || 'SERVICE_FAILURE',
    description: raw.description || '',
    currency: raw.currency || 'BRL',
    amount: Number.isFinite(Number(raw.amount)) ? Number(raw.amount) : null,
    refundAmount: Number.isFinite(Number(raw.refundAmount)) ? Number(raw.refundAmount) : null,
    status: ALLOWED_STATUSES.has(status) ? status : DEFAULT_STATUS,
    decisionBy: raw.decisionBy || null,
    decisionNote: raw.decisionNote || null,
    refundResult: raw.refundResult || null,
    metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : {},
    createdAt,
    updatedAt,
    timeline: Array.isArray(raw.timeline) ? raw.timeline : []
  };
}

class DisputeReviewService {
  constructor({ firebase = firebaseConfig, paymentService = null } = {}) {
    this.firebase = firebase;
    this.paymentService = paymentService || new PaymentService();
  }

  getFirestore() {
    return this.firebase?.getFirestore ? this.firebase.getFirestore() : null;
  }

  disputeCollection() {
    const firestore = this.getFirestore();
    return firestore ? firestore.collection(DISPUTE_COLLECTION) : null;
  }

  async createDispute({
    bookingId = null,
    chargeId = null,
    userId,
    userType = 'passenger',
    incidentId = null,
    ticketId = null,
    reasonCode = 'SERVICE_FAILURE',
    description = '',
    amount = null,
    currency = 'BRL',
    metadata = {}
  } = {}) {
    if (!userId) {
      throw new Error('userId é obrigatório');
    }

    const collection = this.disputeCollection();
    if (!collection) {
      throw new Error('Firestore indisponível para disputas operacionais');
    }

    const disputeId = `DISPUTE-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const createdAt = new Date().toISOString();
    const dispute = normalizeDispute(disputeId, {
      bookingId,
      chargeId,
      userId,
      userType,
      incidentId,
      ticketId,
      reasonCode,
      description,
      amount,
      currency,
      status: 'OPEN',
      metadata,
      createdAt,
      updatedAt: createdAt,
      timeline: [{
        action: 'opened',
        at: createdAt,
        actorId: userId
      }]
    });

    await collection.doc(disputeId).set(dispute, { merge: true });
    return dispute;
  }

  async getDispute(disputeId) {
    const collection = this.disputeCollection();
    if (!collection) return null;
    const snapshot = await collection.doc(String(disputeId)).get();
    if (!snapshot.exists) return null;
    return normalizeDispute(snapshot.id, snapshot.data());
  }

  async listDisputes({ status = null, reasonCode = null, limit = 100 } = {}) {
    const collection = this.disputeCollection();
    if (!collection) return [];
    const snapshot = await collection.get();
    let disputes = snapshot.docs.map((doc) => normalizeDispute(doc.id, doc.data()));

    if (status) {
      const statuses = new Set(String(status).split(',').map((item) => item.trim().toUpperCase()).filter(Boolean));
      disputes = disputes.filter((dispute) => statuses.has(dispute.status));
    }
    if (reasonCode) {
      disputes = disputes.filter((dispute) => dispute.reasonCode === reasonCode);
    }

    disputes.sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime());
    return disputes.slice(0, Number.parseInt(limit, 10) || 100);
  }

  async decideDispute(disputeId, {
    decision,
    actorId,
    resolutionNote = '',
    refundAmount = null
  } = {}) {
    const current = await this.getDispute(disputeId);
    if (!current) {
      throw new Error('Disputa não encontrada');
    }

    const normalizedDecision = String(decision || '').toUpperCase();
    if (!ALLOWED_STATUSES.has(normalizedDecision) || normalizedDecision === 'OPEN') {
      throw new Error('Decisão inválida para disputa');
    }

    const now = new Date().toISOString();
    let refundResult = current.refundResult || null;
    const nextRefundAmount = Number.isFinite(Number(refundAmount)) ? Number(refundAmount) : current.refundAmount;

    if (['APPROVED_REFUND', 'PARTIAL_REFUND'].includes(normalizedDecision) && current.chargeId && nextRefundAmount) {
      refundResult = await this.paymentService.processRideRefund({
        rideId: current.bookingId,
        chargeId: current.chargeId,
        amount: nextRefundAmount,
        reason: resolutionNote || `Operação manual ${normalizedDecision}`,
        status: normalizedDecision === 'PARTIAL_REFUND' ? 'REFUNDED_PARTIAL' : 'REFUNDED_FULL',
        passengerId: current.userType === 'passenger' ? current.userId : null,
        metadata: {
          source: 'dispute_review_service',
          disputeId,
          decision: normalizedDecision,
          actorId: actorId || 'ops'
        }
      });
    }

    const next = normalizeDispute(disputeId, {
      ...current,
      status: normalizedDecision,
      refundAmount: nextRefundAmount,
      refundResult,
      decisionBy: actorId || 'ops',
      decisionNote: resolutionNote || null,
      updatedAt: now,
      timeline: [
        ...current.timeline,
        {
          action: 'decision',
          at: now,
          actorId: actorId || 'ops',
          decision: normalizedDecision
        }
      ]
    });

    await this.disputeCollection().doc(disputeId).set(next, { merge: true });
    return next;
  }

  async getSummary() {
    const disputes = await this.listDisputes({ limit: 500 });
    const open = disputes.filter((dispute) => ['OPEN', 'UNDER_REVIEW', 'CHARGEBACK_MONITORING'].includes(dispute.status));
    return {
      openCount: open.length,
      byStatus: {
        OPEN: disputes.filter((dispute) => dispute.status === 'OPEN').length,
        UNDER_REVIEW: disputes.filter((dispute) => dispute.status === 'UNDER_REVIEW').length,
        APPROVED_REFUND: disputes.filter((dispute) => dispute.status === 'APPROVED_REFUND').length,
        PARTIAL_REFUND: disputes.filter((dispute) => dispute.status === 'PARTIAL_REFUND').length,
        DENIED: disputes.filter((dispute) => dispute.status === 'DENIED').length,
        CHARGEBACK_MONITORING: disputes.filter((dispute) => dispute.status === 'CHARGEBACK_MONITORING').length,
        CLOSED: disputes.filter((dispute) => dispute.status === 'CLOSED').length
      },
      disputes
    };
  }
}

const disputeReviewService = new DisputeReviewService();
module.exports = disputeReviewService;
module.exports.DisputeReviewService = DisputeReviewService;
module.exports.normalizeDispute = normalizeDispute;
