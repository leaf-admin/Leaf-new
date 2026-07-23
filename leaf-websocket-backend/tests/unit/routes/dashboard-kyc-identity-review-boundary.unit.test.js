const fs = require('fs');
const path = require('path');

describe('dashboard KYC identity review boundary', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../../routes/dashboard.js'),
    'utf8'
  );
  const start = source.indexOf("'/api/drivers/:driverId/kyc/identity-reviews/reconcile'");
  const recoveryStart = source.indexOf(
    "'/api/drivers/:driverId/kyc/orphan-identity-hold/recovery'"
  );
  const listStart = source.indexOf("'/api/drivers/:driverId/kyc/identity-reviews'", start);
  const evidenceStart = source.indexOf(
    "'/api/drivers/:driverId/kyc/identity-reviews/:caseId/evidence/:kind'",
    listStart
  );
  const end = source.indexOf("router.post('/api/drivers/:driverId/approve'", start);
  const reviewRoutes = source.slice(start, end > start ? end : undefined);
  const recoveryRoute = source.slice(recoveryStart, start);
  const listRoute = source.slice(listStart, evidenceStart);
  const allIdentityReviewRoutes = source.slice(recoveryStart, end > recoveryStart ? end : undefined);

  it('keeps list, evidence, reconcile and decisions behind the restricted KYC role', () => {
    expect(start).toBeGreaterThan(0);
    expect(reviewRoutes).toContain('authenticateJWT');
    expect(reviewRoutes.match(/requireRole\(DASHBOARD_KYC_REVIEW_ROLES\)/g)).toHaveLength(5);
    expect(source).toContain("const DASHBOARD_KYC_REVIEW_ROLES = ['admin', 'super-admin', 'manager']");
  });

  it('reconciles a durable pending ticket with reviewer audit instead of losing the request', () => {
    expect(reviewRoutes).toContain('reconciledBy: reviewerContext');
    expect(reviewRoutes).toContain("identityReviewLinkStatus: 'registered'");
    expect(reviewRoutes).toContain("action: 'KYC_IDENTITY_REVIEW_TICKET_RECONCILED'");
  });

  it('returns a reviewer-scoped orphan recovery candidate without exposing provider data', () => {
    expect(listRoute).toContain('getOrphanHoldRecoveryCandidate');
    expect(listRoute).toContain('orphanRecoveryCandidate');
    expect(listRoute).not.toMatch(/referenceImageSha256|documentSha256/);
  });

  it('streams only integrity-checked evidence through Leaf with no public provider URL', () => {
    expect(reviewRoutes).toContain("'Cache-Control': 'private, no-store, max-age=0'");
    expect(reviewRoutes).toContain("'X-Content-Type-Options': 'nosniff'");
    expect(reviewRoutes).toContain('sha256Buffer(imageBuffer)');
    expect(reviewRoutes).not.toMatch(/RekognitionClient|CompareFacesCommand|getSignedUrl/);
  });

  it('requires explicit fraud confirmation and applies all decisions outside active trips', () => {
    expect(source).toContain("const KYC_PERMANENT_BLOCK_CONFIRMATION = 'CONFIRMAR FRAUDE E BLOQUEAR'");
    expect(reviewRoutes).toContain('req.body?.explicitDecision !== true');
    expect(reviewRoutes).toContain('req.body?.confirmPermanentBlock !== true');
    expect(reviewRoutes).toContain('runOutsideActiveTrip(driverId');
  });

  it('blocks both CNH review mutations and replacement uploads during an identity hold', () => {
    expect(source.match(/assertCnhUploadAllowed\(driverId\)/g)?.length || 0).toBeGreaterThanOrEqual(2);
    expect(source).toContain('A CNH não pode ser alterada enquanto a identidade está bloqueada ou em análise.');
    expect(source).toContain('A CNH não pode ser substituída enquanto a identidade está bloqueada ou em análise.');
  });

  it('authorizes an orphan hold recovery only through an explicit audited one-time admin route', () => {
    expect(recoveryStart).toBeGreaterThan(0);
    expect(recoveryRoute).toContain('authenticateJWT');
    expect(recoveryRoute).toContain('requireRole(DASHBOARD_KYC_REVIEW_ROLES)');
    expect(recoveryRoute).toContain('req.body?.explicitRecovery !== true');
    expect(recoveryRoute).toContain('authorizeOrphanHoldRecovery');
    expect(recoveryRoute).toContain('expectedStateRevision');
    expect(recoveryRoute).toContain('expectedRevokedAt');
    expect(recoveryRoute).toContain('failureEvidenceId');
    expect(recoveryRoute).toContain('abortOrphanHoldRecoverySetup');
    expect(recoveryRoute).toContain("action: 'KYC_ORPHAN_IDENTITY_HOLD_RECOVERY_CHALLENGE_CREATED'");
    expect(recoveryRoute).not.toMatch(/delete\(|\.delete\(|recordCanonicalSuccess/);
  });

  it('imports the policy service used to create recovery and false-positive retry challenges', () => {
    expect(source).toContain(
      "const kycPolicyService = require('../services/kyc-policy-service')"
    );
  });

  it('defaults dashboard KYC to operational and accepts sandbox only as an explicit scope', () => {
    expect(source).toContain("const DASHBOARD_KYC_SCOPES = new Set(['operational', 'sandbox'])");
    expect(source).toContain("return distinctScopes[0] || 'operational'");
    expect(source).toContain("req.get?.('X-Leaf-KYC-Scope')");
    expect(source).toContain("'KYC_DASHBOARD_SCOPE_INVALID'");
    expect(source).toContain("'KYC_DASHBOARD_SCOPE_CONFLICT'");
    expect(source).toContain('DASHBOARD_OPERATIONAL_KYC_RUNTIME');
  });

  it('requires support:sandbox and authoritative sandbox test-user classification', () => {
    expect(source).toContain("const DASHBOARD_KYC_SANDBOX_PERMISSION = 'support:sandbox'");
    expect(source).toContain('canAccessDashboardKycSandbox(req.user)');
    expect(source).toContain('kycRuntimeScopeService.resolveForUser({');
    expect(source).toContain("runtime?.scope?.namespace !== 'sandbox'");
    expect(source).toContain('runtime?.scope?.financialContext?.testUserSandbox !== true');
    expect(source).toContain("'KYC_DASHBOARD_SANDBOX_ACCESS_DENIED'");
    expect(source).toContain("'KYC_DASHBOARD_SANDBOX_USER_MISMATCH'");
  });

  it('resolves scoped workflow, evidence and trust for every identity-review route', () => {
    expect(allIdentityReviewRoutes.match(/resolveDashboardKycRuntime\(/g)).toHaveLength(6);
    expect(allIdentityReviewRoutes).toContain('kycRuntime.workflow.authorizeOrphanHoldRecovery');
    expect(reviewRoutes).toContain('kycRuntime.workflow.openCaseFromTicket');
    expect(reviewRoutes).toContain('kycRuntime.workflow.listCasesForDriver');
    expect(reviewRoutes).toContain('kycRuntime.workflow.getReviewContext');
    expect(reviewRoutes).toContain('kycRuntime.workflow.runOutsideActiveTrip');
    expect(reviewRoutes).toContain('kycRuntime.evidence.getMetadata');
    expect(reviewRoutes).toContain('kycRuntime.evidence.recordReviewOutcome');
    expect(allIdentityReviewRoutes).not.toContain('kycIdentityReviewWorkflowService.');
    expect(allIdentityReviewRoutes).not.toContain('kycFailedBiometricEvidenceService.');
  });

  it('keeps ticket metadata and audit writes in the resolved KYC scope', () => {
    expect(reviewRoutes).toContain(
      '}, dashboardKycPersistenceContext(kycRuntime));'
    );
    expect(allIdentityReviewRoutes.match(/dashboardKycAuditEnvelope\(kycRuntime\)/g)).toHaveLength(2);
    expect(allIdentityReviewRoutes).toContain('persistenceScope: kycRuntime.scope.namespace');
    expect(reviewRoutes).toContain("'X-Leaf-KYC-Scope': kycRuntime.scope.namespace");
  });

  it('requires a capable policy in the same sandbox context before challenge mutations', () => {
    expect(allIdentityReviewRoutes.match(/requireDashboardKycScopedPolicy\(kycRuntime\)/g)).toHaveLength(2);
    expect(source).toContain("'KYC_DASHBOARD_SANDBOX_POLICY_UNAVAILABLE'");
    expect(source).toContain("'KYC_DASHBOARD_SANDBOX_POLICY_SCOPE_MISMATCH'");
    expect(source).toContain('runtime?.capabilities?.challengePolicyMutations !== true');
    expect(source).toContain("policy.scope?.namespace !== 'sandbox'");
    expect(source).toContain('policy.scope?.financialContextId !== runtime.scope.financialContextId');
    expect(recoveryRoute.indexOf('requireDashboardKycScopedPolicy(kycRuntime)'))
      .toBeLessThan(recoveryRoute.indexOf('authorizeOrphanHoldRecovery'));
    const decisionRoute = reviewRoutes.slice(
      reviewRoutes.indexOf("'/api/drivers/:driverId/kyc/identity-reviews/:caseId/decision'")
    );
    expect(decisionRoute.indexOf('requireDashboardKycScopedPolicy(kycRuntime)'))
      .toBeLessThan(decisionRoute.indexOf('service.decideCase'));
  });

  it('uses the native operational policy or the isolated sandbox challenge adapter', () => {
    expect(source).toContain("typeof policy.applyIdentityReverificationGate === 'function'");
    expect(source).toContain('return policy.applyIdentityReverificationGate(input)');
    expect(source).toContain('return policy.getOrCreateStepUpChallenge({');
    expect(source).toContain("requirement: 'IDENTITY_REVERIFICATION'");
    expect(source).toContain("signals: ['manual_identity_review']");
    expect(allIdentityReviewRoutes.match(/applyDashboardIdentityReverificationGate\(kycRuntime/g))
      .toHaveLength(2);
  });

  it('never mirrors sandbox fraud or retry decisions into operational user projections', () => {
    expect(reviewRoutes).toContain("kycRuntime.scope.namespace === 'operational'");
    expect(reviewRoutes).toContain('operationalMirrorApplied:');
    expect(reviewRoutes).not.toMatch(/scope\.namespace === 'sandbox'[\s\S]{0,240}applyConfirmedIdentityFraudBlock/);
    expect(reviewRoutes).toMatch(
      /if \(kycRuntime\.scope\.namespace === 'operational'\) \{[\s\S]{0,320}applyFalsePositiveRetryAuthorization/
    );
  });
});
