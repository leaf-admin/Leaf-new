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
const reviewQueueSource = fs.readFileSync(
  path.join(__dirname, "..", "..", "app", "drivers", "review-queue", "page.js"),
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
assert.match(
  pageSource,
  /getDriverKycIdentityReviews\(id, kycRequestContext\)/,
  "the page must load driver-scoped review cases with an explicit runtime context",
);
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
  "authorizeDriverKycOrphanHoldRecovery",
  "reconcileDriverKycIdentityReview",
  "getDriverKycIdentityEvidence",
  "startDriverKycIdentityReview",
  "decideDriverKycIdentityReview",
]) {
  assert.match(apiSource, new RegExp(`async ${methodName}\\b`), `missing Leaf API method: ${methodName}`);
}
assert.match(
  apiSource,
  /async authorizeDriverKycOrphanHoldRecovery[\s\S]*?kyc\/orphan-identity-hold\/recovery[\s\S]*?method: "POST"/,
  "orphan holds must be recovered only through the explicit driver-scoped Leaf endpoint",
);
assert.match(
  pageSource,
  /orphanRecoveryCandidate[\s\S]*?failureEvidenceId:[\s\S]*?expectedStateRevision:[\s\S]*?expectedRevokedAt:[\s\S]*?explicitRecovery: true/,
  "the recovery action must preserve the server-projected optimistic binding and explicit confirmation",
);
assert.match(
  pageSource,
  /MIN_ORPHAN_RECOVERY_REASON_LENGTH = 20/,
  "orphan recovery must require a substantive audit reason",
);
assert.match(
  pageSource,
  /ORPHAN_RECOVERY_CONFIRMATION_PHRASE = "AUTORIZAR NOVA VALIDAÇÃO"/,
  "orphan recovery must require a fixed human confirmation phrase",
);
assert.match(
  pageSource,
  /orphanRecoveryConfirmation !== ORPHAN_RECOVERY_CONFIRMATION_PHRASE/,
  "the recovery request must be blocked until the exact phrase is entered",
);
assert.match(
  pageSource,
  /backend manterá o motorista bloqueado para corridas/,
  "the confirmation must explain that recovery does not bypass the ride guard",
);
assert.match(
  apiSource,
  /async reconcileDriverKycIdentityReview[\s\S]*?kyc\/identity-reviews\/reconcile[\s\S]*?method: "POST"/,
  "pending support tickets must be reconciled through the driver-scoped Leaf endpoint",
);
assert.match(
  pageSource,
  /getSupportTickets\([\s\S]*?\{ userId: id, limit: 100 \}[\s\S]*?kycRequestContext/,
  "pending identity tickets must be discovered from the same explicit KYC scope",
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
  /async getDriverKycIdentityEvidence[\s\S]*?return this\.requestKycFile\(/,
  "biometric evidence must use the authenticated file transport",
);
assert.match(
  apiSource,
  /async getDriverDocumentFile[\s\S]*?return this\.requestKycFile\([\s\S]*?documents\/\$\{encodeURIComponent\(documentType\)\}\/content/,
  "current driver documents must use the authenticated Leaf file transport",
);
assert.match(
  pageSource,
  /getDriverDocumentFile\(id, normalizedType, kycRequestContext\)/,
  "the documents page must request the current object through the Leaf API",
);
assert.doesNotMatch(
  pageSource,
  /resolveDocumentUrl|window\.open\(backgroundCheckUrl|window\.open\(docUrl/,
  "the documents page must not open persisted provider URLs",
);
assert.match(
  reviewQueueSource,
  /getDriverDocumentFile\(driverId, documentType, kycRequestContext\)/,
  "the review queue must open documents through the authenticated Leaf file transport",
);
assert.doesNotMatch(
  reviewQueueSource,
  /\bfileUrl\b|window\.open\(item\.fileUrl/,
  "the review queue must not consume or open persisted provider URLs",
);
assert.match(
  apiSource,
  /async getDriverDocumentReviewQueue[\s\S]*?return this\.requestKyc\(/,
  "the review queue must propagate the explicit KYC runtime scope",
);
assert.match(
  reviewQueueSource,
  /searchParams\.get\("kycScope"\)[\s\S]*?Abrir fila sandbox/,
  "the review queue must visibly separate operational and sandbox records",
);
assert.match(
  apiSource,
  /"X-Leaf-KYC-Scope": "sandbox"/,
  "sandbox KYC requests must carry a dedicated explicit header",
);
assert.match(
  apiSource,
  /endpoint: `\$\{endpoint\}\$\{separator\}scope=sandbox`/,
  "sandbox KYC requests must also carry an explicit query scope",
);
assert.match(
  pageSource,
  /searchParams\.get\("kycScope"\)/,
  "the documents page must opt into sandbox through an explicit URL scope",
);
assert.match(
  apiSource,
  /async reviewDriverDocument\(driverId, documentType, action, rejectionReason = "", context = \{\}\)[\s\S]*?return this\.requestKyc\(/,
  "CNH review mutations must use the explicit KYC scope",
);
assert.match(
  pageSource,
  /reviewDriverDocument\([\s\S]*?reason \|\| "",[\s\S]*?kycRequestContext/,
  "the documents page must propagate the selected KYC scope to CNH review",
);
assert.match(
  pageSource,
  /Sandbox KYC[\s\S]*?isolados do ambiente operacional/,
  "the selected sandbox context must be visibly identified to reviewers",
);
assert.match(
  pageSource,
  /documents\?kycScope=sandbox[\s\S]*?Abrir KYC sandbox/,
  "the documents page must expose a visible explicit sandbox entrypoint",
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
