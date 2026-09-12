#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REQUIRED_SOURCE_NAMES = Object.freeze(["quote", "payment", "receipt", "dashboard", "ledger"]);
const CONFIRMED_PAYMENT_STATUSES = new Set([
  "confirmed",
  "completed",
  "paid",
  "succeeded",
  "settled",
]);
const REQUIRED_SETTLEMENT_ACCOUNTS = Object.freeze({
  driverNetAmountCents: "liability:driver_balance_payable",
  operationalFeeCents: "revenue:leaf_operational_fee",
  paymentIntermediationFeeCents: "contra_revenue:payment_intermediation_fee",
  subscriptionRetainedFeeCents: "revenue:driver_subscription_settlement",
});

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasSource(value) {
  return isRecord(value) || Array.isArray(value);
}

function normalizeId(value) {
  const normalized = String(value == null ? "" : value).trim();
  return normalized || null;
}

function normalizeStatus(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed;
  } catch (_) {
    return value;
  }
}

function readPath(root, dottedPath) {
  if (!root) return undefined;
  const parts = Array.isArray(dottedPath) ? dottedPath : String(dottedPath).split(".");
  let current = root;
  for (const part of parts) {
    if (current == null) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(Object(current), part)) return undefined;
    current = current[part];
  }
  return current;
}

function parseCents(value) {
  if (value == null || typeof value === "boolean" || isRecord(value) || Array.isArray(value)) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric) || numeric < 0) return null;
  return numeric;
}

function parseBrlCents(value) {
  if (value == null || typeof value === "boolean" || isRecord(value) || Array.isArray(value)) {
    return null;
  }

  let normalized = String(value).trim();
  if (!normalized) return null;
  normalized = normalized.replace(/R\$|BRL|\s/gi, "");
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  const cents = Math.round(numeric * 100);
  return Math.abs(numeric * 100 - cents) <= 0.001 ? cents : null;
}

function readAmount(root, candidates) {
  for (const candidate of candidates) {
    const descriptor = typeof candidate === "string" ? { path: candidate, unit: "cents" } : candidate;
    const value = readPath(root, descriptor.path);
    if (value == null) continue;
    const cents = descriptor.unit === "brl" ? parseBrlCents(value) : parseCents(value);
    if (cents != null) {
      return {
        cents,
        path: Array.isArray(descriptor.path) ? descriptor.path.join(".") : descriptor.path,
        unit: descriptor.unit,
      };
    }
  }
  return null;
}

function readAmountFromVariants(variants, candidates) {
  for (const variant of variants) {
    const result = readAmount(variant.value, candidates);
    if (result) return { ...result, sourcePath: `${variant.label}.${result.path}` };
  }
  return null;
}

function readString(root, candidates) {
  for (const candidate of candidates) {
    const value = readPath(root, candidate);
    const normalized = normalizeId(value);
    if (normalized) return { value: normalized, path: candidate };
  }
  return null;
}

function readStringFromVariants(variants, candidates) {
  for (const variant of variants) {
    const result = readString(variant.value, candidates);
    if (result) return { ...result, sourcePath: `${variant.label}.${result.path}` };
  }
  return null;
}

function readBoolean(root, candidates) {
  for (const candidate of candidates) {
    const value = readPath(root, candidate);
    if (value === true) return { value: true, path: candidate };
    if (typeof value === "string" && ["true", "1", "yes", "sim"].includes(value.trim().toLowerCase())) {
      return { value: true, path: candidate };
    }
  }
  return null;
}

function readBooleanFromVariants(variants, candidates) {
  for (const variant of variants) {
    const result = readBoolean(variant.value, candidates);
    if (result) return { ...result, sourcePath: `${variant.label}.${result.path}` };
  }
  return null;
}

function collectStringValues(root, candidates) {
  const values = [];
  for (const candidate of candidates) {
    const value = readPath(root, candidate);
    if (Array.isArray(value)) {
      value.forEach((item) => {
        const normalized = normalizeId(item);
        if (normalized && !values.includes(normalized)) values.push(normalized);
      });
      continue;
    }
    const normalized = normalizeId(value);
    if (normalized && !values.includes(normalized)) values.push(normalized);
  }
  return values;
}

function collectStringValuesFromVariants(variants, candidates) {
  const values = [];
  for (const variant of variants) {
    collectStringValues(variant.value, candidates).forEach((value) => {
      if (!values.includes(value)) values.push(value);
    });
  }
  return values;
}

function getVariants(source, label) {
  const variants = [];
  const add = (value, suffix) => {
    if (hasSource(value) && !variants.some((item) => item.value === value)) {
      variants.push({ label: suffix ? `${label}.${suffix}` : label, value });
    }
  };

  add(source, "root");
  add(source?.payload, "payload");
  add(source?.data, "data");
  add(source?.quote, "quote");
  add(source?.payment, "payment");
  add(source?.receipt, "receipt");
  add(source?.response, "response");
  add(source?.response?.charge, "response.charge");
  add(source?.charge, "charge");
  return variants;
}

const COMMON_RIDE_ID_PATHS = Object.freeze([
  "rideId",
  "canonicalRideId",
  "bookingId",
  "payload.rideId",
  "payload.canonicalRideId",
  "payload.bookingId",
  "data.rideId",
  "data.canonicalRideId",
  "data.bookingId",
]);

const PAYMENT_RIDE_ID_PATHS = Object.freeze([
  ...COMMON_RIDE_ID_PATHS,
  "paymentReferenceRideId",
  "temporaryRideId",
  "materializedFrom",
  "charge.rideId",
  "charge.canonicalRideId",
  "charge.paymentReferenceRideId",
  "charge.temporaryRideId",
  "response.rideId",
  "response.canonicalRideId",
  "response.paymentReferenceRideId",
  "response.temporaryRideId",
  "response.charge.rideId",
  "response.charge.canonicalRideId",
]);

const PAYMENT_REFERENCE_PATHS = Object.freeze([
  "paymentReferenceRideId",
  "temporaryRideId",
  "materializedFrom",
  "charge.paymentReferenceRideId",
  "charge.temporaryRideId",
  "response.paymentReferenceRideId",
  "response.temporaryRideId",
]);

const RECEIPT_RIDE_ID_PATHS = Object.freeze([
  ...COMMON_RIDE_ID_PATHS,
  "receipt.rideId",
  "receipt.canonicalRideId",
  "receipt.bookingId",
  "payload.receipt.rideId",
  "payload.receipt.canonicalRideId",
]);

const ENVIRONMENT_PATHS = Object.freeze([
  "providerEnvironment",
  "environment",
  "financialNamespace",
  "financialContext.providerEnvironment",
  "financialContext.namespace",
  "financialContext.environment",
  "metadata.providerEnvironment",
  "metadata.financialNamespace",
  "metadata.financialContext.providerEnvironment",
  "metadata.financialContext.namespace",
  "charge.providerEnvironment",
  "charge.environment",
  "charge.financialNamespace",
  "response.providerEnvironment",
  "response.environment",
  "response.financialNamespace",
  "response.charge.providerEnvironment",
  "response.charge.environment",
]);

function collectRideIdentity(source, kind) {
  const variants = getVariants(source, kind);
  const paths = kind === "payment"
    ? PAYMENT_RIDE_ID_PATHS
    : kind === "receipt"
      ? RECEIPT_RIDE_ID_PATHS
      : COMMON_RIDE_ID_PATHS;
  const ids = collectStringValuesFromVariants(variants, paths);
  const referenceIds = collectStringValuesFromVariants(variants, PAYMENT_REFERENCE_PATHS);
  return { ids, referenceIds };
}

function resolveDashboardPayload(source) {
  const variants = getVariants(source, "dashboard");
  const direct = variants.find((variant) => isRecord(variant.value?.sourceDocuments))?.value;
  const api = source?.reconciliation?.json && isRecord(source.reconciliation.json)
    ? source.reconciliation.json
    : direct || (isRecord(source?.reconciliation) ? source.reconciliation : source);
  const report = isRecord(api?.report) ? api.report : null;
  const sourceDocuments = isRecord(api?.sourceDocuments) ? api.sourceDocuments : null;
  const ledgerEvents = Array.isArray(api?.ledgerEvents)
    ? api.ledgerEvents
    : Array.isArray(source?.ledgerEvents)
      ? source.ledgerEvents
      : [];
  const ledgerRideIds = [
    ...(Array.isArray(api?.ledgerRideIds) ? api.ledgerRideIds : []),
    ...(Array.isArray(source?.ledgerRideIds) ? source.ledgerRideIds : []),
  ].map(normalizeId).filter(Boolean);
  const allVariants = [
    { label: "dashboard.root", value: source },
    { label: "dashboard.api", value: api },
    { label: "dashboard.report", value: report },
    { label: "dashboard.sourceDocuments", value: sourceDocuments },
  ].filter((variant) => hasSource(variant.value));
  return { api, report, sourceDocuments, ledgerEvents, ledgerRideIds, variants: allVariants };
}

function resolveLedgerPayload(source, dashboard) {
  const sourceVariants = getVariants(source, "ledger");
  const events = sourceVariants
    .flatMap((variant) => Array.isArray(variant.value?.events) ? variant.value.events : [])
    .concat(sourceVariants.flatMap((variant) => Array.isArray(variant.value?.ledgerEvents) ? variant.value.ledgerEvents : []));
  const dedupedEvents = [];
  events.forEach((event) => {
    if (isRecord(event) && !dedupedEvents.includes(event)) dedupedEvents.push(event);
  });
  const resolvedEvents = dedupedEvents.length > 0 ? dedupedEvents : dashboard.ledgerEvents;
  const ledgerRideIds = [
    ...dashboard.ledgerRideIds,
    ...sourceVariants.flatMap((variant) => collectStringValues(variant.value, ["ledgerRideIds", "rideIds"])),
  ];
  return {
    events: resolvedEvents,
    ledgerRideIds: [...new Set(ledgerRideIds.filter(Boolean))],
    variants: [
      { label: "ledger.root", value: source },
      ...resolvedEvents.map((event, index) => ({ label: `ledger.events[${index}]`, value: event })),
    ].filter((variant) => hasSource(variant.value)),
  };
}

function findFinancialSnapshot(dashboard) {
  const candidates = [
    ["dashboard.sourceDocuments.paymentDistribution.calculation.financialContract", dashboard.sourceDocuments?.paymentDistribution?.calculation?.financialContract],
    ["dashboard.sourceDocuments.paymentDistribution.financialSnapshot", dashboard.sourceDocuments?.paymentDistribution?.financialSnapshot],
    ["dashboard.sourceDocuments.ridePayment.financialSnapshot", dashboard.sourceDocuments?.ridePayment?.financialSnapshot],
    ["dashboard.report.financialSnapshot", dashboard.report?.financialSnapshot],
  ];
  for (const [sourcePath, value] of candidates) {
    const parsed = parseMaybeJson(value);
    if (isRecord(parsed)) return { value: parsed, sourcePath };
  }
  return null;
}

const SNAPSHOT_FIELD_CANDIDATES = Object.freeze({
  passengerPaidCents: [{ path: "passengerPaidCents", unit: "cents" }],
  tollFeeCents: [{ path: "tollFeeCents", unit: "cents" }],
  operationalFeeCents: [{ path: "operationalFeeCents", unit: "cents" }],
  paymentIntermediationFeeCents: [{ path: "paymentIntermediationFeeCents", unit: "cents" }],
  subscriptionRetainedFeeCents: [{ path: "subscriptionRetainedFeeCents", unit: "cents" }],
  driverNetAmountCents: [{ path: "driverNetAmountCents", unit: "cents" }],
  retainedTotalCents: [{ path: "retainedTotalCents", unit: "cents" }],
  allocatedTotalCents: [{ path: "allocatedTotalCents", unit: "cents" }],
});

function normalizeSnapshot(snapshot) {
  if (!isRecord(snapshot)) return null;
  const normalized = {};
  for (const [field, candidates] of Object.entries(SNAPSHOT_FIELD_CANDIDATES)) {
    const value = readAmount(snapshot, candidates);
    normalized[field] = value ? value.cents : null;
  }
  normalized.authoritativeSnapshot = readBoolean(snapshot, ["authoritativeSnapshot"])?.value === true;
  normalized.financialSnapshotSource = normalizeId(snapshot.financialSnapshotSource);
  normalized.balanced = snapshot.balanced === true;
  return normalized;
}

function extractQuote(source) {
  const variants = getVariants(source, "quote");
  return {
    identity: collectRideIdentity(source, "quote"),
    amount: readAmountFromVariants(variants, [
      { path: "passengerPaidCents", unit: "cents" },
      { path: "grossAmountCents", unit: "cents" },
      { path: "totalAmountCents", unit: "cents" },
      { path: "amountCents", unit: "cents" },
      { path: "fareCents", unit: "cents" },
      { path: "quote.passengerPaidCents", unit: "cents" },
      { path: "quote.grossAmountCents", unit: "cents" },
      { path: "quote.totalAmountCents", unit: "cents" },
      { path: "quote.amountCents", unit: "cents" },
      { path: "quote.fareCents", unit: "cents" },
      { path: "amountBrl", unit: "brl" },
      { path: "totalAmountBrl", unit: "brl" },
      { path: "quote.amountBrl", unit: "brl" },
      { path: "quote.totalAmountBrl", unit: "brl" },
    ]),
    quoteLockId: readStringFromVariants(variants, ["quoteLockId", "quoteLock.id", "quote.quoteLockId", "quote.quoteLock.id"]),
  };
}

function extractPayment(source) {
  const variants = getVariants(source, "payment");
  const statusPaths = [
    "status",
    "paymentStatus",
    "charge.status",
    "response.status",
    "response.charge.status",
    "providerConfirmation.status",
    "response.providerConfirmation.status",
  ];
  const status = readStringFromVariants(variants, statusPaths);
  const statuses = collectStringValuesFromVariants(variants, statusPaths);
  return {
    identity: collectRideIdentity(source, "payment"),
    amount: readAmountFromVariants(variants, [
      { path: "charge.value", unit: "cents" },
      { path: "charge.amountCents", unit: "cents" },
      { path: "amountInCents", unit: "cents" },
      { path: "amountCents", unit: "cents" },
      { path: "response.amountInCents", unit: "cents" },
      { path: "response.amountCents", unit: "cents" },
      { path: "response.charge.value", unit: "cents" },
      { path: "response.charge.amountCents", unit: "cents" },
    ]),
    chargeId: readStringFromVariants(variants, [
      "charge.identifier",
      "charge.chargeId",
      "charge.id",
      "chargeId",
      "response.chargeId",
      "response.charge.id",
    ]),
    environment: readStringFromVariants(variants, ENVIRONMENT_PATHS),
    status,
    statuses,
  };
}

function extractReceipt(source) {
  const variants = getVariants(source, "receipt");
  return {
    identity: collectRideIdentity(source, "receipt"),
    amount: readAmountFromVariants(variants, [
      { path: "financialSnapshot.passengerPaidCents", unit: "cents" },
      { path: "financial.passengerPaidCents", unit: "cents" },
      { path: "financial.totalPaid.amount", unit: "brl" },
      { path: "financial.totals.customerPaid", unit: "brl" },
      { path: "financial.breakdown.tripFare.amount", unit: "brl" },
      { path: "grossAmount", unit: "brl" },
      { path: "totalPaid", unit: "brl" },
    ]),
    components: {
      tollFeeCents: readAmountFromVariants(variants, [
        { path: "financialSnapshot.tollFeeCents", unit: "cents" },
        { path: "financial.totals.tollPassThrough", unit: "brl" },
        { path: "financial.breakdown.tollPassThrough.amount", unit: "brl" },
      ]),
      operationalFeeCents: readAmountFromVariants(variants, [
        { path: "financialSnapshot.operationalFeeCents", unit: "cents" },
        { path: "financial.totals.leafOperational", unit: "brl" },
        { path: "financial.breakdown.operationalCost.amount", unit: "brl" },
      ]),
      paymentIntermediationFeeCents: readAmountFromVariants(variants, [
        { path: "financialSnapshot.paymentIntermediationFeeCents", unit: "cents" },
        { path: "financial.totals.wooviFee", unit: "brl" },
        { path: "financial.breakdown.wooviFee.amount", unit: "brl" },
      ]),
      subscriptionRetainedFeeCents: readAmountFromVariants(variants, [
        { path: "financialSnapshot.subscriptionRetainedFeeCents", unit: "cents" },
        { path: "financial.totals.subscriptionRetainedFee", unit: "brl" },
      ]),
      driverNetAmountCents: readAmountFromVariants(variants, [
        { path: "financialSnapshot.driverNetAmountCents", unit: "cents" },
        { path: "financial.totals.driverReceived", unit: "brl" },
        { path: "financial.breakdown.driverAmount.amount", unit: "brl" },
      ]),
      retainedTotalCents: readAmountFromVariants(variants, [
        { path: "financialSnapshot.retainedTotalCents", unit: "cents" },
        { path: "financial.totals.retainedFees", unit: "brl" },
      ]),
    },
    authoritativeSnapshot: readBooleanFromVariants(variants, [
      "authoritativeSnapshot",
      "financial.authoritativeSnapshot",
      "metadata.authoritativeSnapshot",
      "financialSnapshot.authoritativeSnapshot",
    ]),
    financialSnapshotSource: readStringFromVariants(variants, [
      "financialSnapshotSource",
      "financial.financialSnapshotSource",
      "metadata.financialSnapshotSource",
      "financialSnapshot.financialSnapshotSource",
    ]),
    environment: readStringFromVariants(variants, ENVIRONMENT_PATHS),
  };
}

function extractDashboardFinancials(dashboard) {
  const snapshotRecord = findFinancialSnapshot(dashboard);
  const snapshot = normalizeSnapshot(snapshotRecord?.value);
  const api = dashboard.api;
  const reportOk = api?.success === true && dashboard.report?.ok === true;
  const sourceDocuments = dashboard.sourceDocuments;
  const grossFromReport = readAmount(dashboard.report?.totals, [
    { path: "passengerGrossCents", unit: "cents" },
  ]);
  return {
    identity: {
      ids: collectStringValuesFromVariants(dashboard.variants, [
        "rideId",
        "canonicalRideId",
        "bookingId",
        "report.rideId",
        "sourceDocuments.ridePayment.rideId",
        "sourceDocuments.ridePayment.canonicalRideId",
        "sourceDocuments.paymentHolding.rideId",
        "sourceDocuments.paymentDistribution.rideId",
      ]),
      referenceIds: collectStringValuesFromVariants(dashboard.variants, [
        "sourceDocuments.ridePayment.paymentReferenceRideId",
        "sourceDocuments.ridePayment.temporaryRideId",
        "sourceDocuments.paymentHolding.materializedFrom",
      ]),
    },
    reportOk,
    sourceDocuments,
    snapshot,
    snapshotPath: snapshotRecord?.sourcePath || null,
    gross: snapshot?.passengerPaidCents != null ? { cents: snapshot.passengerPaidCents, path: `${snapshotRecord.sourcePath}.passengerPaidCents` } : grossFromReport,
    environmentValues: collectStringValuesFromVariants(dashboard.variants, ENVIRONMENT_PATHS),
    paymentDocumentAmount: readAmount(sourceDocuments?.ridePayment, [{ path: "amount", unit: "cents" }]),
    distributionDocumentAmount: readAmount(sourceDocuments?.paymentDistribution, [
      { path: "calculation.totalAmount", unit: "cents" },
      { path: "totalAmount", unit: "cents" },
    ]),
  };
}

function eventType(event) {
  return normalizeStatus(event?.eventType || event?.type);
}

function eventAmount(event) {
  return readAmount(event, [
    { path: "totalDebitCents", unit: "cents" },
    { path: "amountCents", unit: "cents" },
  ]);
}

function sumLedgerCredits(event, account) {
  return (Array.isArray(event?.lines) ? event.lines : [])
    .filter((line) => line?.account === account && normalizeStatus(line?.direction) === "credit")
    .reduce((total, line) => total + (parseCents(line?.amountCents) || 0), 0);
}

function extractLedgerFinancials(ledger) {
  const paymentEvent = ledger.events.find((event) => eventType(event) === "payment_received") || null;
  const settlementEvent = ledger.events.find((event) => eventType(event) === "ride_settlement") || null;
  return {
    events: ledger.events,
    paymentEvent,
    settlementEvent,
    paymentAmount: eventAmount(paymentEvent),
    settlementAmount: eventAmount(settlementEvent),
    settlementCredits: settlementEvent
      ? Object.fromEntries(
          Object.entries(REQUIRED_SETTLEMENT_ACCOUNTS).map(([field, account]) => [field, sumLedgerCredits(settlementEvent, account)]),
        )
      : null,
    environmentValues: ledger.variants.flatMap((variant) => collectStringValues(variant.value, ENVIRONMENT_PATHS)),
  };
}

function addUnique(values, value) {
  const normalized = normalizeId(value);
  if (normalized && !values.includes(normalized)) values.push(normalized);
}

function compareCents(values) {
  const present = values.filter((item) => Number.isInteger(item?.cents));
  if (present.length < values.length || present.length === 0) return { ok: false, present };
  const first = present[0].cents;
  return { ok: present.every((item) => item.cents === first), present, value: first };
}

function validateSameRideReconciliation(input = {}) {
  const rideId = normalizeId(input.rideId);
  const sources = {
    quote: input.quote || null,
    payment: input.payment || null,
    receipt: input.receipt || null,
    dashboard: input.dashboard || null,
    ledger: input.ledger || null,
  };
  const checks = [];
  const failures = [];
  const failureCodes = [];
  const addFailure = (code, message, details = {}) => {
    if (!failureCodes.includes(code)) {
      failureCodes.push(code);
      failures.push({ code, message, details });
    }
  };
  const addCheck = (name, ok, code, message, details = {}, statusWhenMissing = "FAIL") => {
    if (ok === true) {
      checks.push({ name, status: "PASS", details });
      return true;
    }
    const status = ok == null ? statusWhenMissing : "FAIL";
    checks.push({ name, status, details });
    if (code) addFailure(code, message, details);
    return false;
  };

  if (!rideId) {
    addFailure("ride_id_missing", "RIDE_ID é obrigatório para reconciliação exata.");
  }
  for (const loadError of Array.isArray(input.sourceLoadErrors) ? input.sourceLoadErrors : []) {
    addFailure(`source_${loadError.source}_unreadable`, `Evidência ${loadError.source} não pôde ser lida.`, { error: loadError.error });
  }

  const sourcePresence = Object.fromEntries(REQUIRED_SOURCE_NAMES.map((name) => [name, hasSource(sources[name])]));
  const dashboard = resolveDashboardPayload(sources.dashboard);
  const ledger = resolveLedgerPayload(sources.ledger, dashboard);
  const effectiveLedgerPresent = ledger.events.length > 0;
  sourcePresence.ledger = sourcePresence.ledger || effectiveLedgerPresent;
  const missingSources = REQUIRED_SOURCE_NAMES.filter((name) => !sourcePresence[name]);
  addCheck(
    "required_sources_present",
    missingSources.length === 0 ? true : null,
    "required_evidence_missing",
    "E3 exige quote, Pix, receipt, dashboard e ledger da mesma corrida; evidência ausente não pode virar PASS.",
    { sourcePresence, missingSources },
    "NOT_RUN",
  );

  if (!rideId) {
    addCheck("ride_id_defined", null, null, "rideId ausente", {}, "NOT_RUN");
  } else {
    addCheck("ride_id_defined", true, null, "", { rideId });
  }

  const quote = extractQuote(sources.quote);
  const payment = extractPayment(sources.payment);
  const receipt = extractReceipt(sources.receipt);
  const dashboardFinancials = extractDashboardFinancials(dashboard);
  const ledgerFinancials = extractLedgerFinancials(ledger);

  const aliases = [];
  payment.identity.referenceIds.forEach((id) => addUnique(aliases, id));
  dashboardFinancials.identity.referenceIds.forEach((id) => addUnique(aliases, id));
  ledger.ledgerRideIds.forEach((id) => {
    if (id !== rideId) addUnique(aliases, id);
  });
  const allowedRideIds = [rideId, ...aliases].filter(Boolean);

  const sourceIdentity = {
    quote: quote.identity.ids,
    payment: payment.identity.ids,
    receipt: receipt.identity.ids,
    dashboard: dashboardFinancials.identity.ids,
    ledger: ledgerFinancials.events.flatMap((event) => [event?.rideId, event?.canonicalRideId]).map(normalizeId).filter(Boolean),
  };
  const identityFailures = [];
  for (const name of ["quote", "payment", "receipt", "dashboard"]) {
    const ids = sourceIdentity[name];
    if (ids.length === 0) {
      identityFailures.push(`${name}:missing`);
      addFailure(`source_${name}_ride_id_missing`, `A evidência ${name} não contém rideId canônico ou referência verificável.`);
      continue;
    }
    const linked = ids.includes(rideId) || (name === "payment" && ids.some((id) => allowedRideIds.includes(id)) && payment.identity.referenceIds.length > 0);
    if (!linked) {
      identityFailures.push(`${name}:${ids.join(",")}`);
      addFailure(`source_${name}_ride_id_mismatch`, `A evidência ${name} aponta para outra corrida.`, { rideId, ids });
    }
  }
  const ledgerIdentityIds = sourceIdentity.ledger;
  if (ledgerIdentityIds.length === 0) {
    identityFailures.push("ledger:missing");
    addFailure("source_ledger_ride_id_missing", "O ledger não contém rideId nos eventos observados.");
  }
  if (ledgerIdentityIds.some((id) => !allowedRideIds.includes(id))) {
    identityFailures.push(`ledger:unexpected:${ledgerIdentityIds.join(",")}`);
    addFailure("source_ledger_ride_id_mismatch", "O ledger contém evento de outra corrida.", { rideId, ids: ledgerIdentityIds, allowedRideIds });
  }
  addCheck(
    "same_ride_identity",
    identityFailures.length === 0 ? true : sourcePresence.quote && sourcePresence.payment && sourcePresence.receipt && sourcePresence.dashboard && effectiveLedgerPresent ? false : null,
    "same_ride_identity_mismatch",
    "As evidências não apontam para o mesmo rideId canônico; aliases só são aceitos quando declarados pelo backend.",
    { canonicalRideId: rideId, allowedRideIds, sourceIdentity, identityFailures },
    "NOT_RUN",
  );

  const quoteAmount = quote.amount;
  const paymentAmount = payment.amount;
  const receiptAmount = receipt.amount;
  const dashboardAmount = dashboardFinancials.gross;
  const grossValues = [
    { source: "quote", cents: quoteAmount?.cents },
    { source: "pix", cents: paymentAmount?.cents },
    { source: "receipt", cents: receiptAmount?.cents },
    { source: "dashboard", cents: dashboardAmount?.cents },
  ];
  const grossMissing = grossValues.filter((item) => !Number.isInteger(item.cents)).map((item) => item.source);
  const grossComparison = grossMissing.length > 0
    ? { ok: null, present: grossValues.filter((item) => Number.isInteger(item.cents)) }
    : compareCents(grossValues);
  addCheck(
    "gross_amounts_present_and_equal",
    grossComparison.ok,
    "gross_amount_missing_or_mismatch",
    "Quote, Pix, receipt e dashboard precisam apresentar o mesmo bruto em centavos.",
    { values: grossComparison.present, missing: grossMissing },
    "NOT_RUN",
  );

  // Operation success does not prove settlement. Every supplied payment status
  // must agree on confirmation; contradictory or incomplete artifacts fail closed.
  const paymentConfirmed = payment.statuses.length > 0 && payment.statuses.every(
    (status) => CONFIRMED_PAYMENT_STATUSES.has(normalizeStatus(status)),
  );
  const paymentEnvironment = normalizeStatus(payment.environment?.value);
  const paymentEnvironmentCheck = payment.environment ? paymentEnvironment === "sandbox" : null;
  const paymentConfirmedCheck = payment.statuses.length > 0 ? paymentConfirmed : null;
  addCheck(
    "pix_provider_sandbox",
    paymentEnvironmentCheck,
    "pix_provider_not_sandbox",
    "A reconciliação E3 exige confirmação Pix do provider em sandbox; produção é bloqueada.",
    {
      environment: payment.environment?.value || null,
    },
    "NOT_RUN",
  );
  addCheck(
    "pix_confirmed",
    paymentConfirmedCheck,
    "pix_not_confirmed",
    "O Pix da corrida não possui confirmação inequívoca.",
    {
      confirmed: paymentConfirmed,
      status: payment.status?.value || null,
      statuses: payment.statuses,
    },
    "NOT_RUN",
  );

  const snapshot = dashboardFinancials.snapshot;
  const snapshotComplete = snapshot == null ? null : Boolean(snapshot)
    && snapshot.authoritativeSnapshot === true
    && snapshot.financialSnapshotSource === "backend_final"
    && snapshot.balanced === true
    && Object.values(SNAPSHOT_FIELD_CANDIDATES).every((candidates, index) => {
      const field = Object.keys(SNAPSHOT_FIELD_CANDIDATES)[index];
      return Number.isInteger(snapshot[field]);
    })
    && snapshot.tollFeeCents <= snapshot.passengerPaidCents
    && snapshot.driverNetAmountCents + snapshot.retainedTotalCents === snapshot.passengerPaidCents
    && snapshot.allocatedTotalCents === snapshot.passengerPaidCents;
  addCheck(
    "dashboard_backend_final_snapshot",
    snapshotComplete,
    "dashboard_backend_final_snapshot_missing_or_invalid",
    "Dashboard precisa expor o snapshot financeiro autoritativo backend_final, balanceado e completo.",
    { snapshotPath: dashboardFinancials.snapshotPath, snapshot },
    "NOT_RUN",
  );

  const hasReceiptProvenance = Boolean(receipt.authoritativeSnapshot || receipt.financialSnapshotSource);
  const receiptSnapshotOk = !sourcePresence.receipt || !hasReceiptProvenance
    ? null
    : receipt.authoritativeSnapshot?.value === true && receipt.financialSnapshotSource?.value === "backend_final";
  addCheck(
    "receipt_backend_final_provenance",
    receiptSnapshotOk,
    "receipt_backend_final_provenance_missing",
    "O recibo não pode ser aceito como final sem authoritativeSnapshot=true e financialSnapshotSource=backend_final.",
    {
      authoritativeSnapshot: receipt.authoritativeSnapshot?.value || false,
      financialSnapshotSource: receipt.financialSnapshotSource?.value || null,
    },
    "NOT_RUN",
  );

  const dashboardDocumentsOk = Boolean(dashboardFinancials.sourceDocuments)
    && Boolean(dashboardFinancials.sourceDocuments.ridePayment)
    && Boolean(dashboardFinancials.sourceDocuments.paymentHolding)
    && Boolean(dashboardFinancials.sourceDocuments.paymentDistribution);
  const dashboardDocumentsCheck = !sourcePresence.dashboard
    ? null
    : dashboardFinancials.reportOk && dashboardDocumentsOk;
  addCheck(
    "dashboard_source_documents_complete",
    dashboardDocumentsCheck,
    !dashboardFinancials.reportOk ? "dashboard_reconciliation_report_not_ok" : "dashboard_source_documents_missing",
    !dashboardFinancials.reportOk
      ? "O relatório de reconciliação do dashboard não está OK."
      : "Dashboard precisa incluir payment, holding e distribution da mesma corrida.",
    {
      apiSuccess: dashboard.api?.success === true,
      reportOk: dashboardFinancials.reportOk,
      sourceDocuments: {
        ridePayment: Boolean(dashboardFinancials.sourceDocuments?.ridePayment),
        paymentHolding: Boolean(dashboardFinancials.sourceDocuments?.paymentHolding),
        paymentDistribution: Boolean(dashboardFinancials.sourceDocuments?.paymentDistribution),
      },
    },
    "NOT_RUN",
  );

  const contextValues = [
    ...dashboardFinancials.environmentValues,
    ...ledgerFinancials.environmentValues,
    ...collectStringValuesFromVariants(getVariants(sources.receipt, "receipt"), ENVIRONMENT_PATHS),
  ].map(normalizeStatus).filter(Boolean);
  const hasProductionContext = contextValues.some((value) => ["production", "operational"].includes(value));
  const hasSandboxContext = contextValues.includes("sandbox");
  const financialContextCheck = contextValues.length === 0
    ? null
    : hasSandboxContext && !hasProductionContext;
  addCheck(
    "financial_context_sandbox",
    financialContextCheck,
    hasProductionContext ? "financial_context_production" : "financial_context_sandbox_missing",
    hasProductionContext
      ? "A evidência financeira da corrida está em contexto operacional/produção; não é aceita como E3 sandbox."
      : "A evidência não comprova namespace financeiro sandbox para dashboard/ledger/receipt.",
    { contextValues: [...new Set(contextValues)], hasSandboxContext, hasProductionContext },
    "NOT_RUN",
  );

  const ledgerEventsPresent = effectiveLedgerPresent && Boolean(ledgerFinancials.paymentEvent) && Boolean(ledgerFinancials.settlementEvent);
  const ledgerEventsPosted = !effectiveLedgerPresent
    ? null
    : ledgerEventsPresent
      && [ledgerFinancials.paymentEvent, ledgerFinancials.settlementEvent].every((event) => normalizeStatus(event.status) === "posted");
  addCheck(
    "ledger_payment_and_settlement_posted",
    ledgerEventsPosted,
    ledgerEventsPresent ? "ledger_event_not_posted" : "ledger_events_missing",
    ledgerEventsPresent
      ? "Os eventos payment_received e ride_settlement precisam estar posted."
      : "Ledger precisa registrar payment_received e ride_settlement para a mesma corrida.",
    {
      eventCount: ledgerFinancials.events.length,
      eventTypes: ledgerFinancials.events.map((event) => eventType(event)),
      paymentStatus: ledgerFinancials.paymentEvent?.status || null,
      settlementStatus: ledgerFinancials.settlementEvent?.status || null,
    },
    "NOT_RUN",
  );

  const ledgerAmountValues = [
    { source: "pix", cents: paymentAmount?.cents },
    { source: "ledger.payment_received", cents: ledgerFinancials.paymentAmount?.cents },
    { source: "ledger.ride_settlement", cents: ledgerFinancials.settlementAmount?.cents },
    { source: "dashboard.payment_document", cents: dashboardFinancials.paymentDocumentAmount?.cents },
    { source: "dashboard.distribution_document", cents: dashboardFinancials.distributionDocumentAmount?.cents },
  ];
  const ledgerAmountMissing = ledgerAmountValues.filter((item) => !Number.isInteger(item.cents)).map((item) => item.source);
  const ledgerAmountComparison = ledgerAmountMissing.length > 0
    ? { ok: null, present: ledgerAmountValues.filter((item) => Number.isInteger(item.cents)) }
    : compareCents(ledgerAmountValues);
  addCheck(
    "ledger_and_documents_amounts_equal",
    ledgerAmountComparison.ok,
    "ledger_or_document_amount_mismatch",
    "Pix, ledger e documentos financeiros do dashboard precisam fechar o mesmo bruto.",
    { values: ledgerAmountComparison.present, missing: ledgerAmountMissing },
    "NOT_RUN",
  );

  const components = {
    tollFeeCents: snapshot?.tollFeeCents,
    operationalFeeCents: snapshot?.operationalFeeCents,
    paymentIntermediationFeeCents: snapshot?.paymentIntermediationFeeCents,
    subscriptionRetainedFeeCents: snapshot?.subscriptionRetainedFeeCents,
    driverNetAmountCents: snapshot?.driverNetAmountCents,
  };
  const receiptComponentValues = {
    tollFeeCents: receipt.components.tollFeeCents?.cents,
    operationalFeeCents: receipt.components.operationalFeeCents?.cents,
    paymentIntermediationFeeCents: receipt.components.paymentIntermediationFeeCents?.cents,
    subscriptionRetainedFeeCents: receipt.components.subscriptionRetainedFeeCents?.cents,
    driverNetAmountCents: receipt.components.driverNetAmountCents?.cents,
  };
  const componentMismatches = Object.keys(components).filter((field) => {
    const expected = components[field];
    const actual = receiptComponentValues[field];
    // The current receipt schema omits subscription retention when it is zero.
    // A positive retained amount must always be explicitly present.
    if (actual == null && field === "subscriptionRetainedFeeCents" && expected === 0) return false;
    return expected !== actual;
  });
  addCheck(
    "receipt_components_match_backend_final",
    !sourcePresence.receipt || !snapshot
      ? null
      : snapshotComplete === true && componentMismatches.length === 0,
    "receipt_components_missing_or_mismatch",
    "Taxas, pedágio e líquido do motorista do recibo precisam coincidir com o snapshot backend_final.",
    { backendFinal: components, receipt: receiptComponentValues, componentMismatches },
    "NOT_RUN",
  );

  const settlementCredits = ledgerFinancials.settlementCredits;
  const ledgerComponentMismatches = snapshotComplete && settlementCredits
    ? Object.keys(REQUIRED_SETTLEMENT_ACCOUNTS).filter((field) => settlementCredits[field] !== snapshot[field])
    : Object.keys(REQUIRED_SETTLEMENT_ACCOUNTS);
  addCheck(
    "ledger_settlement_components_match_backend_final",
    !effectiveLedgerPresent || !snapshot
      ? null
      : snapshotComplete === true && Boolean(settlementCredits) && ledgerComponentMismatches.length === 0,
    "ledger_settlement_components_missing_or_mismatch",
    "As linhas de settlement do ledger precisam coincidir com o snapshot backend_final; passageiro bruto não é confundido com líquido.",
    { backendFinal: snapshot ? Object.fromEntries(Object.keys(REQUIRED_SETTLEMENT_ACCOUNTS).map((field) => [field, snapshot[field]])) : null, ledger: settlementCredits, componentMismatches: ledgerComponentMismatches },
    "NOT_RUN",
  );

  if (Array.isArray(input.expectedQuoteLockIds) && input.expectedQuoteLockIds.length > 0) {
    const expectedQuoteLockIds = input.expectedQuoteLockIds.map(normalizeId).filter(Boolean);
    const lockMatches = quote.quoteLockId?.value && expectedQuoteLockIds.includes(quote.quoteLockId.value);
    addCheck(
      "quote_lock_reference",
      lockMatches,
      "quote_lock_reference_mismatch",
      "O quote lock apresentado precisa ser o mesmo lock que o cenário E3 autorizou.",
      { expectedQuoteLockIds, actual: quote.quoteLockId?.value || null },
      "NOT_RUN",
    );
  }

  const hasBlockingMissingEvidence = missingSources.length > 0 || failures.some((failure) => failure.code.endsWith("_missing") || failure.code.includes("unreadable"));
  return {
    contract: "same_ride_reconciliation_v1",
    evidenceLevel: "E3",
    integrated: failures.length === 0,
    ok: failures.length === 0,
    status: failures.length === 0 ? "PASS" : hasBlockingMissingEvidence ? "BLOCKED" : "FAIL",
    rideId,
    allowedRideIds,
    sources: {
      quote: { present: sourcePresence.quote, rideIds: quote.identity.ids, amount: quote.amount },
      payment: { present: sourcePresence.payment, rideIds: payment.identity.ids, amount: payment.amount, environment: payment.environment, status: payment.status },
      receipt: { present: sourcePresence.receipt, rideIds: receipt.identity.ids, amount: receipt.amount },
      dashboard: { present: sourcePresence.dashboard, rideIds: dashboardFinancials.identity.ids, amount: dashboardFinancials.gross, snapshotPath: dashboardFinancials.snapshotPath },
      ledger: { present: sourcePresence.ledger, rideIds: sourceIdentity.ledger, eventTypes: ledgerFinancials.events.map((event) => eventType(event)) },
    },
    checks,
    failures,
    failureCodes,
    generatedAt: new Date().toISOString(),
  };
}

function readJsonEvidence(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { data: null, exists: false, path: filePath || null, error: null };
  }
  try {
    return { data: JSON.parse(fs.readFileSync(filePath, "utf8")), exists: true, path: filePath, error: null };
  } catch (error) {
    return { data: null, exists: true, path: filePath, error: error.message };
  }
}

function resolveArtifactPath(artifactsDir, envName, fallbackName) {
  return process.env[envName] || path.join(artifactsDir, fallbackName);
}

function buildMarkdown(result, artifactPaths) {
  return [
    "# Same-Ride Reconciliation",
    "",
    `- Contract: ${result.contract}`,
    `- Evidence level: ${result.evidenceLevel}`,
    `- Ride: ${result.rideId || "not defined"}`,
    `- Status: ${result.status}`,
    `- Integrated: ${result.integrated ? "yes" : "no"}`,
    "",
    "## Evidence files",
    ...Object.entries(artifactPaths).map(([name, filePath]) => `- ${name}: ${filePath}`),
    "",
    "## Checks",
    ...result.checks.map((check) => `- ${check.status}: ${check.name}`),
    "",
    "## Failures",
    ...(result.failures.length
      ? result.failures.map((failure) => `- ${failure.code}: ${failure.message}`)
      : ["- None"]),
    "",
  ].join("\n");
}

function main() {
  const artifactsDir = process.env.ARTIFACTS_DIR || path.join(process.cwd(), "test-results", "same-ride-reconciliation");
  const artifactPaths = {
    quote: resolveArtifactPath(artifactsDir, "QUOTE_EVIDENCE_PATH", "quote-evidence.json"),
    payment: resolveArtifactPath(artifactsDir, "PAYMENT_EVIDENCE_PATH", "sandbox-payment-confirmation.json"),
    receipt: resolveArtifactPath(artifactsDir, "RECEIPT_EVIDENCE_PATH", "receipt-evidence.json"),
    dashboard: resolveArtifactPath(artifactsDir, "DASHBOARD_EVIDENCE_PATH", "dashboard-evidence.json"),
    ledger: resolveArtifactPath(artifactsDir, "LEDGER_EVIDENCE_PATH", "ledger-evidence.json"),
  };
  const loaded = Object.fromEntries(Object.entries(artifactPaths).map(([name, filePath]) => [name, readJsonEvidence(filePath)]));
  const sourceLoadErrors = Object.entries(loaded)
    .filter(([, item]) => item.error)
    .map(([source, item]) => ({ source, error: item.error }));
  const rideId = process.env.RIDE_ID || process.env.BOOKING_ID || "";
  const result = validateSameRideReconciliation({
    rideId,
    quote: loaded.quote.data,
    payment: loaded.payment.data,
    receipt: loaded.receipt.data,
    dashboard: loaded.dashboard.data,
    ledger: loaded.ledger.data,
    sourceLoadErrors,
  });

  fs.mkdirSync(artifactsDir, { recursive: true });
  const jsonPath = path.join(artifactsDir, "same-ride-reconciliation.json");
  const markdownPath = path.join(artifactsDir, "same-ride-reconciliation.md");
  fs.writeFileSync(jsonPath, JSON.stringify(result, null, 2));
  fs.writeFileSync(markdownPath, buildMarkdown(result, artifactPaths));
  console.log(`[same-ride-reconciliation] ${markdownPath}`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = {
  REQUIRED_SOURCE_NAMES,
  buildMarkdown,
  extractDashboardFinancials,
  extractLedgerFinancials,
  validateSameRideReconciliation,
};
