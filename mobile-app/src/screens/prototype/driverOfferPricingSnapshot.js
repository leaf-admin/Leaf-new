import { formatCurrencyBRL } from './tripFinancialSummary';

export function toFiniteMoney(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickPreferredMoneyValue(...candidates) {
  const finiteValues = candidates
    .map((candidate) => toFiniteMoney(candidate))
    .filter((candidate) => candidate !== null);
  return (
    finiteValues.find((candidate) => candidate > 0) ??
    finiteValues[0] ??
    null
  );
}

export function formatCurrencyBR(value) {
  return formatCurrencyBRL(value);
}

function roundMoney(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Number(parsed.toFixed(2));
}

function resolveOfferGrossAmount(offer = {}) {
  return (
    toFiniteMoney(offer?.grossFare) ??
    toFiniteMoney(offer?.grossAmount) ??
    toFiniteMoney(offer?.totalAmount) ??
    toFiniteMoney(offer?.finalFare) ??
    toFiniteMoney(offer?.finalPrice) ??
    toFiniteMoney(offer?.fare) ??
    toFiniteMoney(offer?.amount)
  );
}

function resolveOfferTotalFees(offer = {}) {
  const totalFees = pickPreferredMoneyValue(
    offer?.estimatedTotalFees,
    offer?.totalFees,
    offer?.retainedFeesInReais,
    offer?.paymentBreakdown?.totalFees,
    offer?.paymentDistribution?.retainedFeesInReais,
  );
  if (totalFees !== null) {
    return totalFees;
  }

  const operationalFee =
    toFiniteMoney(offer?.estimatedOperationalFee) ??
    toFiniteMoney(offer?.operationalFee);
  const paymentIntermediationFee =
    toFiniteMoney(offer?.estimatedPaymentIntermediationFee) ??
    toFiniteMoney(offer?.paymentIntermediationFee);
  if (operationalFee !== null || paymentIntermediationFee !== null) {
    return Number(operationalFee || 0) + Number(paymentIntermediationFee || 0);
  }

  return null;
}

export function hasLockedPricingSnapshot(offer = {}) {
  if (!offer || typeof offer !== "object") {
    return false;
  }

  if (offer?.pricingSnapshotLocked === true) {
    return true;
  }

  return [
    offer?.estimatedOperationalFee,
    offer?.estimatedPaymentIntermediationFee,
    offer?.estimatedTotalFees,
    offer?.estimatedDriverNetAmount,
    offer?.operationalFee,
    offer?.paymentIntermediationFee,
    offer?.totalFees,
    offer?.driverNetAmount,
    offer?.netAmount,
    offer?.driver_share,
  ].some((value) => Number.isFinite(Number(value)));
}

export function getDriverOfferNetAmount(offer = {}) {
  if (!offer || typeof offer !== "object") {
    return null;
  }

  const explicitNet = pickPreferredMoneyValue(
    offer?.estimatedDriverNetAmount,
    offer?.driverNetAmount,
    offer?.driverNetAmountLocked,
    offer?.lockedDriverNetAmount,
    offer?.netAmount,
    offer?.netAmountInReais,
    offer?.driver_share,
    offer?.paymentBreakdown?.driverNetAmount,
    offer?.paymentDistribution?.netAmountInReais,
  );
  if (explicitNet !== null) {
    return explicitNet;
  }

  const grossFare = resolveOfferGrossAmount(offer);
  const totalFees = resolveOfferTotalFees(offer);
  if (grossFare !== null && totalFees !== null) {
    return roundMoney(Math.max(0, grossFare - totalFees));
  }

  return null;
}

export function hasAuthoritativeDriverOfferPricing(offer = {}) {
  if (!offer || typeof offer !== "object") {
    return false;
  }

  const netAmount = getDriverOfferNetAmount(offer);
  if (netAmount !== null && netAmount >= 0) {
    return true;
  }

  return false;
}

export function getDriverOfferPayoutLabel(offer = {}) {
  const normalizedOffer = normalizeDriverOfferPricingSnapshot(offer);
  if (!hasAuthoritativeDriverOfferPricing(normalizedOffer)) {
    return null;
  }

  const netAmount = getDriverOfferNetAmount(normalizedOffer);
  if (netAmount !== null && netAmount >= 0) {
    return formatCurrencyBR(netAmount);
  }

  const payoutLabel = String(normalizedOffer?.payout || "").trim();
  return payoutLabel || null;
}

export function selectDisplayableDriverOffer(driverOffers = []) {
  if (!Array.isArray(driverOffers) || driverOffers.length === 0) {
    return null;
  }

  const normalizedOffers = driverOffers
    .filter(Boolean)
    .map((offer) => normalizeDriverOfferPricingSnapshot(offer));

  return (
    normalizedOffers.find((offer) => {
      const offerKey = offer?.bookingId || offer?.id;
      return Boolean(offerKey) && hasAuthoritativeDriverOfferPricing(offer);
    }) || null
  );
}

export function normalizeDriverOfferPricingSnapshot(offer = {}) {
  if (!offer || typeof offer !== "object") {
    return offer;
  }

  const grossFare = resolveOfferGrossAmount(offer);
  const operationalFee =
    toFiniteMoney(offer?.estimatedOperationalFee) ??
    toFiniteMoney(offer?.operationalFee);
  const paymentIntermediationFee =
    toFiniteMoney(offer?.estimatedPaymentIntermediationFee) ??
    toFiniteMoney(offer?.paymentIntermediationFee);
  const totalFees = resolveOfferTotalFees(offer);
  const explicitDriverNetAmount = pickPreferredMoneyValue(
    offer?.estimatedDriverNetAmount,
    offer?.driverNetAmount,
    offer?.driverNetAmountLocked,
    offer?.lockedDriverNetAmount,
    offer?.netAmount,
    offer?.netAmountInReais,
    offer?.driver_share,
    offer?.paymentBreakdown?.driverNetAmount,
    offer?.paymentDistribution?.netAmountInReais,
  );
  const driverNetAmount =
    explicitDriverNetAmount !== null
      ? explicitDriverNetAmount
      : grossFare !== null && totalFees !== null
        ? roundMoney(Math.max(0, grossFare - totalFees))
        : null;
  const payoutLabel = String(offer?.payout || "").trim();
  const hasAuthoritativeSnapshot = hasLockedPricingSnapshot({
    ...offer,
    ...(operationalFee !== null ? { estimatedOperationalFee: operationalFee } : {}),
    ...(paymentIntermediationFee !== null
      ? { estimatedPaymentIntermediationFee: paymentIntermediationFee }
      : {}),
    ...(totalFees !== null ? { estimatedTotalFees: totalFees } : {}),
    ...(driverNetAmount !== null ? { estimatedDriverNetAmount: driverNetAmount } : {}),
  });

  return {
    ...offer,
    ...(grossFare !== null ? { grossFare, fare: grossFare } : {}),
    ...(operationalFee !== null
      ? {
          estimatedOperationalFee: operationalFee,
          operationalFee,
        }
      : {}),
    ...(paymentIntermediationFee !== null
      ? {
          estimatedPaymentIntermediationFee: paymentIntermediationFee,
          paymentIntermediationFee,
        }
      : {}),
    ...(totalFees !== null
      ? {
          estimatedTotalFees: totalFees,
          totalFees,
        }
      : {}),
    ...(driverNetAmount !== null
      ? {
          estimatedDriverNetAmount: driverNetAmount,
          driverNetAmount,
          payout: formatCurrencyBR(driverNetAmount),
        }
      : payoutLabel
        ? { payout: payoutLabel }
        : {}),
    ...(hasAuthoritativeSnapshot ? { pricingSnapshotLocked: true } : {}),
  };
}

const LOCKED_PRICING_KEYS = Object.freeze([
  "fare",
  "grossFare",
  "payout",
  "estimatedOperationalFee",
  "estimatedPaymentIntermediationFee",
  "estimatedTotalFees",
  "estimatedDriverNetAmount",
  "operationalFee",
  "paymentIntermediationFee",
  "totalFees",
  "driverNetAmount",
  "pricingSnapshotLocked",
  "pricingSnapshotLockedAt",
]);

function preserveLockedPricingFields(baseOffer, sourceOffer) {
  const next = { ...baseOffer };
  for (const key of LOCKED_PRICING_KEYS) {
    const value = sourceOffer?.[key];
    if (typeof value === "boolean") {
      next[key] = value;
      continue;
    }
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      next[key] = value;
    }
  }
  return next;
}

export function mergeDriverOfferEntry(existingOffer, incomingOffer) {
  const normalizedExisting =
    normalizeDriverOfferPricingSnapshot(existingOffer) || {};
  const normalizedIncoming =
    normalizeDriverOfferPricingSnapshot(incomingOffer) || {};
  const merged = {
    ...normalizedExisting,
    ...normalizedIncoming,
  };

  if (hasLockedPricingSnapshot(normalizedExisting)) {
    return preserveLockedPricingFields(merged, normalizedExisting);
  }

  if (hasLockedPricingSnapshot(normalizedIncoming)) {
    return preserveLockedPricingFields(merged, normalizedIncoming);
  }

  return normalizeDriverOfferPricingSnapshot(merged);
}

export function mergeDriverOffers(previousOffers = [], incomingOffer) {
  if (!incomingOffer) {
    return previousOffers;
  }

  const normalizedIncoming =
    normalizeDriverOfferPricingSnapshot(incomingOffer) || incomingOffer;
  const incomingKey = normalizedIncoming?.bookingId || normalizedIncoming?.id;
  if (!incomingKey) {
    return [normalizedIncoming, ...(previousOffers || []).filter(Boolean)];
  }

  const remainingOffers = [];
  const seen = new Set([incomingKey]);
  let nextIncoming = normalizedIncoming;
  let mergedExisting = false;

  for (const item of previousOffers || []) {
    if (!item) {
      continue;
    }

    const itemKey = item.bookingId || item.id;
    if (!itemKey) {
      remainingOffers.push(item);
      continue;
    }

    if (itemKey === incomingKey && !mergedExisting) {
      nextIncoming = mergeDriverOfferEntry(item, normalizedIncoming);
      mergedExisting = true;
      continue;
    }

    if (seen.has(itemKey)) {
      continue;
    }
    seen.add(itemKey);
    remainingOffers.push(normalizeDriverOfferPricingSnapshot(item));
  }

  return [nextIncoming, ...remainingOffers];
}
