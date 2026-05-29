const admin = require('firebase-admin');
const firebaseConfig = require('../firebase-config');
const { logStructured } = require('../utils/logger');

const PASSENGER_BENEFITS_COLLECTION = 'passenger_discount_benefits';

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeMoneyCents(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function toCentsFromReais(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed * 100));
}

function toMoney(cents) {
  return Math.round(normalizeMoneyCents(cents)) / 100;
}

function toIso(value, fallback = null) {
  if (!value) return fallback;
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value?.toDate === 'function') return value.toDate().toISOString();
  return fallback;
}

function normalizeBenefit(raw = {}, fallbackId = '') {
  return {
    id: normalizeId(raw.id || fallbackId),
    userId: normalizeId(raw.userId),
    inviteId: normalizeId(raw.inviteId),
    campaignId: normalizeId(raw.campaignId),
    discountPercent: Math.min(100, Math.max(0, Number(raw.discountPercent || 0) || 0)),
    maxRides: Math.max(0, Number.parseInt(String(raw.maxRides || 0), 10) || 0),
    remainingRides: Math.max(0, Number.parseInt(String(raw.remainingRides || 0), 10) || 0),
    nonCumulative: raw.nonCumulative !== false,
    status: String(raw.status || 'active').trim().toLowerCase(),
    usageByRide: raw.usageByRide && typeof raw.usageByRide === 'object' ? raw.usageByRide : {},
    usedRidesCount: Math.max(0, Number.parseInt(String(raw.usedRidesCount || 0), 10) || 0),
    createdAt: toIso(raw.createdAt, null),
    updatedAt: toIso(raw.updatedAt, null),
  };
}

class PassengerDiscountBenefitService {
  getFirestore() {
    return firebaseConfig?.getFirestore ? firebaseConfig.getFirestore() : null;
  }

  getCollection() {
    const firestore = this.getFirestore();
    if (!firestore) return null;
    return firestore.collection(PASSENGER_BENEFITS_COLLECTION);
  }

  async getActiveBenefitsForUser(userId) {
    const safeUserId = normalizeId(userId);
    const collection = this.getCollection();
    if (!safeUserId || !collection) return [];

    const snapshot = await collection.where('userId', '==', safeUserId).get();
    return snapshot.docs
      .map((doc) => normalizeBenefit(doc.data(), doc.id))
      .filter((benefit) =>
        benefit.status === 'active' &&
        benefit.remainingRides > 0 &&
        benefit.discountPercent > 0
      )
      .sort((a, b) => {
        if (b.discountPercent !== a.discountPercent) {
          return b.discountPercent - a.discountPercent;
        }
        return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
      });
  }

  selectBenefit(benefits = [], requestedBenefitId = '') {
    const safeRequestedId = normalizeId(requestedBenefitId);
    if (safeRequestedId) {
      const requested = benefits.find((benefit) => benefit.id === safeRequestedId);
      if (requested) return requested;
    }
    return benefits[0] || null;
  }

  async previewDiscount({
    userId,
    grossAmountCents,
    grossFare,
    benefitId = '',
  } = {}) {
    const safeUserId = normalizeId(userId);
    const normalizedGrossAmountInCents =
      grossAmountCents !== undefined && grossAmountCents !== null
        ? normalizeMoneyCents(grossAmountCents)
        : toCentsFromReais(grossFare);

    const basePayload = {
      applied: false,
      grossAmountInCents: normalizedGrossAmountInCents,
      grossFare: toMoney(normalizedGrossAmountInCents),
      payableAmountInCents: normalizedGrossAmountInCents,
      payableFare: toMoney(normalizedGrossAmountInCents),
      discountAmountInCents: 0,
      discountAmount: 0,
    };

    if (!safeUserId || normalizedGrossAmountInCents <= 0) {
      return basePayload;
    }

    try {
      const benefits = await this.getActiveBenefitsForUser(safeUserId);
      const selected = this.selectBenefit(benefits, benefitId);
      if (!selected) {
        return basePayload;
      }

      const discountAmountInCents = Math.min(
        normalizedGrossAmountInCents,
        normalizeMoneyCents((normalizedGrossAmountInCents * selected.discountPercent) / 100)
      );
      const payableAmountInCents = Math.max(0, normalizedGrossAmountInCents - discountAmountInCents);

      return {
        ...basePayload,
        applied: discountAmountInCents > 0,
        benefitId: selected.id,
        inviteId: selected.inviteId || null,
        campaignId: selected.campaignId || null,
        discountPercent: selected.discountPercent,
        maxRides: selected.maxRides,
        remainingRides: selected.remainingRides,
        status: selected.status,
        source: PASSENGER_BENEFITS_COLLECTION,
        discountAmountInCents,
        discountAmount: toMoney(discountAmountInCents),
        payableAmountInCents,
        payableFare: toMoney(payableAmountInCents),
      };
    } catch (error) {
      logStructured('warn', 'Falha ao calcular preview de desconto de passageiro', {
        service: 'passenger-discount-benefit-service',
        userId: safeUserId,
        error: error.message,
      });
      return basePayload;
    }
  }

  async consumeDiscountForRide({
    userId,
    benefitId,
    rideId,
    grossAmountInCents,
    payableAmountInCents,
    discountAmountInCents,
  } = {}) {
    const safeUserId = normalizeId(userId);
    const safeBenefitId = normalizeId(benefitId);
    const safeRideId = normalizeId(rideId);
    const firestore = this.getFirestore();

    if (!firestore || !safeUserId || !safeBenefitId || !safeRideId) {
      return { success: false, code: 'DISCOUNT_CONSUME_INPUT_INVALID' };
    }

    const benefitRef = firestore.collection(PASSENGER_BENEFITS_COLLECTION).doc(safeBenefitId);

    return firestore.runTransaction(async (transaction) => {
      const doc = await transaction.get(benefitRef);
      if (!doc.exists) {
        return { success: false, code: 'DISCOUNT_BENEFIT_NOT_FOUND' };
      }

      const benefit = normalizeBenefit(doc.data(), doc.id);
      if (benefit.userId !== safeUserId) {
        return { success: false, code: 'DISCOUNT_BENEFIT_USER_MISMATCH' };
      }

      const usageByRide = benefit.usageByRide || {};
      if (usageByRide[safeRideId]) {
        return {
          success: true,
          idempotentReplay: true,
          benefit,
          usage: usageByRide[safeRideId],
        };
      }

      if (benefit.status !== 'active' || benefit.remainingRides <= 0) {
        return { success: false, code: 'DISCOUNT_BENEFIT_NOT_ACTIVE' };
      }

      const nextRemainingRides = Math.max(0, benefit.remainingRides - 1);
      const usage = {
        rideId: safeRideId,
        usedAt: new Date().toISOString(),
        grossAmountInCents: normalizeMoneyCents(grossAmountInCents),
        payableAmountInCents: normalizeMoneyCents(payableAmountInCents),
        discountAmountInCents: normalizeMoneyCents(discountAmountInCents),
      };

      transaction.set(benefitRef, {
        remainingRides: nextRemainingRides,
        usedRidesCount: admin.firestore.FieldValue.increment(1),
        status: nextRemainingRides > 0 ? 'active' : 'consumed',
        [`usageByRide.${safeRideId}`]: usage,
        lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: new Date().toISOString(),
      }, { merge: true });

      return {
        success: true,
        benefit: {
          ...benefit,
          remainingRides: nextRemainingRides,
          status: nextRemainingRides > 0 ? 'active' : 'consumed',
        },
        usage,
      };
    });
  }
}

module.exports = new PassengerDiscountBenefitService();
module.exports.normalizeMoneyCents = normalizeMoneyCents;
module.exports.toCentsFromReais = toCentsFromReais;
