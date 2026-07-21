const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const componentPath = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "components",
  "kyc",
  "KycIdentityReviewPanel.jsx",
);
const source = fs.readFileSync(componentPath, "utf8");
const pageSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "app", "drivers", "[id]", "documents", "page.js"),
  "utf8",
);
const apiSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "src", "services", "api.js"),
  "utf8",
);

assert.match(source, /^"use client";/, "the identity review panel must be an interactive client component");

for (const propName of [
  "approvedCnhPortraitUrl",
  "failedReferenceImageUrl",
  "reviewStatus",
  "evidence",
  "retentionExpiresAt",
  "onLoadEvidence",
  "onStartReview",
  "onAuthorizeRetry",
  "onConfirmPermanentBlock",
]) {
  assert.match(source, new RegExp(`\\b${propName}\\b`), `missing reusable input contract: ${propName}`);
}

assert.match(source, /Retrato da CNH aprovada/, "the canonical CNH portrait must be identified");
assert.match(source, /Selfie usada na comparação/, "the failed liveness ReferenceImage must be identified");
assert.match(
  source,
  /gridTemplateColumns: "repeat\(auto-fit, minmax\(260px, 1fr\)\)"/,
  "the two identity images must use the side-by-side evidence grid",
);

const biometricImageTags = source.match(/<img\s[\s\S]*?\/>/g) || [];
assert.equal(biometricImageTags.length, 1, "the reusable EvidenceImage renderer should be the only image surface");
assert.match(biometricImageTags[0], /referrerPolicy="no-referrer"/, "biometric images must suppress referrer data");
assert.match(biometricImageTags[0], /draggable=\{false\}/, "biometric images must not be draggable");
assert.doesNotMatch(source, /<a\b|\bhref=|\bdownload=/, "biometric evidence must not expose a download link");
assert.doesNotMatch(source, /window\.open\s*\(/, "biometric evidence must not open in a separate browser surface");

assert.match(source, /Acesso restrito e auditado/, "the panel must explain restricted access");
assert.match(source, /expira automaticamente/, "the panel must explain evidence expiry");
assert.match(source, /Selfies aprovadas não são armazenadas/, "the panel must state the failure-only retention boundary");
assert.match(source, /Expiração da evidência/, "the evidence expiry timestamp must be visible");

assert.match(source, /name="kycReviewTicketId"[\s\S]*?required/, "ticket ID must be required");
assert.match(source, /name="kycReviewJustification"[\s\S]*?minLength=\{MIN_KYC_REVIEW_JUSTIFICATION_LENGTH\}[\s\S]*?required/, "typed justification must be required");
assert.match(
  source,
  /cleanTicketId && cleanJustification\.length >= MIN_KYC_REVIEW_JUSTIFICATION_LENGTH/,
  "all decisions must be gated by a non-empty ticket and substantive justification",
);

assert.match(source, /Iniciar análise/, "reviewers must be able to claim and start a review");
assert.match(source, /Carregar evidências restritas/, "restricted images must require an explicit load action");
assert.match(source, /decision: "load_evidence"/, "evidence access must receive the ticket and justification context");
assert.match(source, /Marcar falso positivo e autorizar tentativa/, "reviewers must be able to authorize a controlled retry");
assert.match(source, /Confirmar fraude e bloquear permanentemente/, "reviewers must be able to apply the permanent fraud block");
assert.match(source, /decision: "start_review"/, "start-review callback must receive an explicit decision");
assert.match(source, /decision: "false_positive_retry"/, "retry callback must receive an explicit decision");
assert.match(source, /decision: "fraud_confirmed_permanent_block"/, "block callback must receive an explicit decision");

assert.match(
  source,
  /PERMANENT_FRAUD_BLOCK_CONFIRMATION_PHRASE = "CONFIRMAR FRAUDE E BLOQUEAR"/,
  "permanent blocking must require an explicit fixed phrase",
);
assert.match(
  source,
  /confirmationPhrase !== PERMANENT_FRAUD_BLOCK_CONFIRMATION_PHRASE/,
  "the permanent-block callback must be guarded by the exact phrase",
);
assert.match(source, /<ConfirmActionDialog[\s\S]*?tone="danger"/, "permanent blocking must use a danger confirmation dialog");

assert.doesNotMatch(source, /\bfetch\s*\(|\baxios\b|from\s+["'][^"']*services\/api/, "the presentation component must not call Leaf APIs or providers directly");
assert.doesNotMatch(source, /rekognition|compareFaces\s*\(|createFaceLiveness/i, "the dashboard must not call a paid provider directly");

assert.match(pageSource, /import KycIdentityReviewPanel/, "the driver documents page must mount the review panel");
assert.match(pageSource, /getDriverKycIdentityReviews\(id\)/, "the page must load driver-scoped review cases");
assert.match(
  pageSource,
  /getDriverKycIdentityEvidence\(id, selectedIdentityReview\.caseId, "cnh", context\)/,
  "the page must load the canonical CNH through the Leaf API",
);
assert.match(
  pageSource,
  /getDriverKycIdentityEvidence\(id, selectedIdentityReview\.caseId, "selfie", context\)/,
  "the page must load the failed selfie through the Leaf API",
);
assert.match(pageSource, /URL\.revokeObjectURL\(url\)/, "temporary biometric blob URLs must be revoked");
assert.match(
  pageSource,
  /decision === "CONFIRMED_FRAUD"[\s\S]*?confirmPermanentBlock:[\s\S]*?confirmationPhrase/,
  "the page must send reinforced permanent-block confirmation",
);
assert.match(
  pageSource,
  /const refreshResults = await Promise\.allSettled\(\[load\(\), loadIdentityReviews\(\)\]\)/,
  "a successful identity decision must not be reported as failed only because refresh failed",
);

for (const methodName of [
  "getDriverKycIdentityReviews",
  "reconcileDriverKycIdentityReview",
  "getDriverKycIdentityEvidence",
  "startDriverKycIdentityReview",
  "decideDriverKycIdentityReview",
]) {
  assert.match(apiSource, new RegExp(`async ${methodName}\\b`), `missing Leaf API method: ${methodName}`);
}
assert.match(
  apiSource,
  /async reconcileDriverKycIdentityReview[\s\S]*?kyc\/identity-reviews\/reconcile[\s\S]*?method: "POST"/,
  "pending support tickets must be reconciled through the driver-scoped Leaf endpoint",
);
assert.match(
  pageSource,
  /getSupportTickets\([\s\S]*?\{ userId: id, limit: 100 \}[\s\S]*?\{ scope: "operational" \}/,
  "pending identity tickets must be discovered only from operational support scope",
);
assert.match(
  pageSource,
  /identityReviewLinkStatus[\s\S]*?=== "pending"[\s\S]*?metadata\.kycEvidenceId/,
  "only durable support tickets with a pending identity link and evidence ID may be reconciled",
);
assert.match(
  pageSource,
  /MIN_IDENTITY_RECONCILIATION_REASON_LENGTH = 20/,
  "manual reconciliation must require a substantive audit reason",
);
assert.match(
  pageSource,
  /reconcileDriverKycIdentityReview\(id, \{[\s\S]*?ticketId,[\s\S]*?evidenceId,[\s\S]*?reason,/,
  "reconciliation must send the exact ticket, evidence, and typed reason",
);
assert.match(
  pageSource,
  /Chamado KYC ainda não vinculado/,
  "the documents page must warn reviewers about durable pending tickets",
);
assert.match(
  pageSource,
  /name="identityReviewReconciliationReason"[\s\S]*?minLength=\{MIN_IDENTITY_RECONCILIATION_REASON_LENGTH\}/,
  "the reconciliation UI must enforce the minimum reason length",
);
assert.match(
  pageSource,
  /Vincular chamado ao caso/,
  "the pending ticket warning must expose an explicit reconciliation action",
);
assert.match(
  apiSource,
  /async getDriverKycIdentityEvidence[\s\S]*?return this\.requestFile\(/,
  "biometric evidence must use the authenticated file transport",
);
assert.match(
  apiSource,
  /kyc\/identity-reviews\/\$\{encodeURIComponent\(caseId\)\}\/decision/,
  "identity decisions must use the case-scoped Leaf endpoint",
);
assert.doesNotMatch(
  `${pageSource}\n${source}`,
  /rekognition|compareFaces\s*\(|createFaceLiveness/i,
  "dashboard identity review surfaces must not call AWS directly",
);

console.log("kyc identity review panel contract: ok");
